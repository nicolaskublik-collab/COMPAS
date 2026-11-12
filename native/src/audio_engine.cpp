#ifndef NOMINMAX
#define NOMINMAX
#endif

#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"

#include "RtAudio.h"
#include "realtime.h"
#include <condition_variable>
#include <future>
#include <optional>
#include "json.hpp"
#include "signalsmith-stretch/signalsmith-stretch.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <climits>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <thread>
#include <vector>

using json = nlohmann::json;
constexpr unsigned int kSampleRate = 48000;
constexpr unsigned int kChannels = 2;

struct AudioTrack {
  std::string id;
  std::string name;
  std::vector<float> samples;
  bool pitchEnabled{true};
  double analyzedBpm{0.0};
  double tempoConfidence{0.0};
  bool tempoSynced{false};
  std::vector<float> waveformMinimum;
  std::vector<float> waveformMaximum;
  bool cacheHit{false};
  std::string cacheWarning;
  std::atomic<float> volume{1.0F};
  std::atomic<float> pan{0.0F};
  std::atomic<int> outputChannel{-1};
};

using TrackSet = std::vector<std::shared_ptr<AudioTrack>>;

struct PreparedSong {
  std::shared_ptr<TrackSet> tracks;
  json request;
  json metadata;
  uint64_t duration{0};
  uint64_t activationId{0};
  double preparationMs{0};
  float master{1}, setlist{1}, clickVolume{0};
  bool clickEnabled{false};
  double clickBpm{120};
  int clickBeats{4}, clickRoute{-1};
};
struct AudioCommand {
  enum Type { Activate, Pause, Resume, Stop, Seek, Pads, Loop, Mix, Bus } type{Pause};
  PreparedSong* song{nullptr};
  uint64_t position{0}, end{0};
  int key{-1}, route{-1};
  double volume{0}, fade{1};
  float master{1}, setlist{1}, clickVolume{0};
  bool clickEnabled{false};
  double clickBpm{120};
  int clickBeats{4}, clickRoute{-1};
};
struct AudioEngine {
  std::shared_ptr<const TrackSet> tracks{std::make_shared<const TrackSet>()};
  std::unique_ptr<RtAudio> audio;
  std::string api;
  unsigned int deviceId{0}, sampleRate{kSampleRate}, outputChannels{2};
  unsigned int bufferFrames{512}, requestedBufferFrames{512}, requestedSampleRate{0};
  std::atomic<bool> playing{false}, finished{false};
  std::atomic<int> transportEvent{0};
  std::atomic<uint64_t> position{0}, duration{0}, underruns{0}, liveFloor{0}, startedId{0};
  std::atomic<float> masterVolume{1}, setlistVolume{1}, clickVolume{0};
  std::atomic<int> clickOutputChannel{-1}, clickBeats{4};
  std::atomic<double> clickBpm{120};
  std::atomic<bool> clickEnabled{false};
  AudioQueue<AudioCommand, 128> commands;
  // Control owns these objects. Callback only borrows raw pointers until liveFloor advances.
  std::vector<std::shared_ptr<PreparedSong>> liveSongs;
  uint64_t nextActivation{0};
  // The following state belongs exclusively to the callback while the stream is running.
  PreparedSong* current{nullptr};
  PreparedSong* outgoing{nullptr};
  uint64_t cursor{0}, outgoingCursor{0}, loopStart{0}, loopEnd{0};
  uint64_t pendingStartId{0};
  bool running{false}, stopAfterFade{false};
  AudioRamp transport, crossfade;
  AmbientPads pads;
};
static_assert(std::atomic<uint64_t>::is_always_lock_free, "Audio requires lock-free 64-bit atomics");

std::mutex outputMutex;

void emit(const json& message) {
  std::lock_guard<std::mutex> lock(outputMutex);
  std::cout << message.dump() << std::endl;
}

RtAudio::Api parseApi(const std::string& value) {
  if (value == "asio") return RtAudio::WINDOWS_ASIO;
  if (value == "wasapi") return RtAudio::WINDOWS_WASAPI;
  if (value == "directsound") return RtAudio::WINDOWS_DS;
  throw std::runtime_error("API de audio no reconocida.");
}

std::string apiName(RtAudio::Api api) {
  switch (api) {
    case RtAudio::WINDOWS_ASIO: return "asio";
    case RtAudio::WINDOWS_WASAPI: return "wasapi";
    case RtAudio::WINDOWS_DS: return "directsound";
    default: return "unknown";
  }
}

json listDevices(const std::string& apiString) {
  RtAudio::Api api = parseApi(apiString);
  RtAudio audio(api, [](RtAudioErrorType, const std::string&) {});
  json devices = json::array();
  for (const unsigned int deviceId : audio.getDeviceIds()) {
    const RtAudio::DeviceInfo info = audio.getDeviceInfo(deviceId);
    if (info.outputChannels == 0 || info.name.empty()) continue;
    devices.push_back({
      {"id", deviceId},
      {"name", info.name},
      {"api", apiName(api)},
      {"outputChannels", info.outputChannels},
      {"sampleRate", info.preferredSampleRate == 0 ? kSampleRate : info.preferredSampleRate},
      {"sampleRates", info.sampleRates},
      {"isDefault", info.isDefaultOutput}
    });
  }
  return {{"devices", devices}};
}

struct TempoEstimate {
  double bpm{0.0};
  double confidence{0.0};
};

TempoEstimate analyzeTempo(const std::vector<float>& samples, unsigned int sampleRate) {
  constexpr unsigned int envelopeRate = 100;
  const size_t frameCount = samples.size() / kChannels;
  const size_t windowFrames = std::max<size_t>(1, sampleRate / envelopeRate);
  const size_t windowCount = (frameCount + windowFrames - 1) / windowFrames;
  if (windowCount < 200) return {};

  std::vector<double> envelope(windowCount);
  for (size_t window = 0; window < windowCount; ++window) {
    const size_t start = window * windowFrames;
    const size_t end = std::min(frameCount, start + windowFrames);
    double energy = 0.0;
    for (size_t frame = start; frame < end; ++frame) {
      const double left = samples[frame * kChannels];
      const double right = samples[frame * kChannels + 1];
      energy += (left * left + right * right) * 0.5;
    }
    envelope[window] = std::sqrt(energy / std::max<size_t>(1, end - start));
  }

  std::vector<double> onsets(windowCount, 0.0);
  for (size_t index = 1; index < windowCount; ++index) {
    onsets[index] = std::max(0.0, envelope[index] - envelope[index - 1]);
  }

  double bestScore = 0.0;
  size_t bestLag = 0;
  const size_t shortestLag = envelopeRate * 60 / 200;
  const size_t longestLag = envelopeRate * 60 / 55;
  for (size_t lag = shortestLag; lag <= longestLag && lag < windowCount / 3; ++lag) {
    double cross = 0.0;
    double firstEnergy = 0.0;
    double secondEnergy = 0.0;
    for (size_t index = lag; index < windowCount; ++index) {
      const double first = onsets[index];
      const double second = onsets[index - lag];
      cross += first * second;
      firstEnergy += first * first;
      secondEnergy += second * second;
    }
    const double denominator = std::sqrt(firstEnergy * secondEnergy);
    const double score = denominator > 0.0 ? cross / denominator : 0.0;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag == 0 || bestScore < 0.12) return {0.0, bestScore};
  return {static_cast<double>(envelopeRate * 60) / bestLag, bestScore};
}

void processTrack(AudioTrack& track, int semitones, double durationRatio, unsigned int sampleRate) {
  if ((semitones == 0 && std::abs(durationRatio - 1.0) < 0.001) || track.samples.empty()) return;

  const size_t frames = track.samples.size() / kChannels;
  const size_t outputFrames = std::max<size_t>(1, static_cast<size_t>(std::llround(frames * durationRatio)));
  if (frames > static_cast<size_t>(INT_MAX) || outputFrames > static_cast<size_t>(INT_MAX)) {
    throw std::runtime_error("La pista es demasiado larga para el procesamiento de tiempo y tono.");
  }
  std::vector<std::vector<float>> input(kChannels, std::vector<float>(frames));
  std::vector<std::vector<float>> output(kChannels, std::vector<float>(outputFrames));
  for (size_t frame = 0; frame < frames; ++frame) {
    input[0][frame] = track.samples[frame * kChannels];
    input[1][frame] = track.samples[frame * kChannels + 1];
  }

  float* inputChannels[kChannels] = {input[0].data(), input[1].data()};
  float* outputChannels[kChannels] = {output[0].data(), output[1].data()};
  signalsmith::stretch::SignalsmithStretch<float> stretcher;
  stretcher.presetDefault(kChannels, static_cast<float>(sampleRate));
  stretcher.setTransposeSemitones(static_cast<float>(semitones));
  if (std::abs(durationRatio - 1.0) >= 0.001) {
    if (!stretcher.exact(inputChannels, static_cast<int>(frames), outputChannels, static_cast<int>(outputFrames))) {
      throw std::runtime_error("La pista es demasiado corta para sincronizar su tempo sin alterar el tono.");
    }
  } else {
    stretcher.process(inputChannels, static_cast<int>(frames), outputChannels, static_cast<int>(outputFrames));
  }

  track.samples.resize(outputFrames * kChannels);
  for (size_t frame = 0; frame < outputFrames; ++frame) {
    track.samples[frame * kChannels] = output[0][frame];
    track.samples[frame * kChannels + 1] = output[1][frame];
  }
}

json testPitchShift() {
  AudioTrack testTrack;
  constexpr double inputFrequency = 440.0;
  constexpr size_t frames = kSampleRate;
  testTrack.samples.resize(frames * kChannels);
  for (size_t frame = 0; frame < frames; ++frame) {
    const float sample = static_cast<float>(std::sin(6.283185307179586 * inputFrequency * frame / kSampleRate));
    testTrack.samples[frame * kChannels] = sample;
    testTrack.samples[frame * kChannels + 1] = sample;
  }
  processTrack(testTrack, 12, 1.0, kSampleRate);
  size_t crossings = 0;
  constexpr size_t startFrame = 10000;
  constexpr size_t endFrame = 40000;
  for (size_t frame = startFrame + 1; frame < endFrame; ++frame) {
    if (testTrack.samples[(frame - 1) * kChannels] <= 0.0F
        && testTrack.samples[frame * kChannels] > 0.0F) {
      ++crossings;
    }
  }
  const double measuredFrequency = static_cast<double>(crossings) * kSampleRate / (endFrame - startFrame);
  return {
    {"passed", std::abs(measuredFrequency - 880.0) < 40.0 && testTrack.samples.size() == frames * kChannels},
    {"inputHz", inputFrequency},
    {"outputHz", measuredFrequency},
    {"inputFrames", frames},
    {"outputFrames", testTrack.samples.size() / kChannels}
  };
}

json testTempoSync() {
  AudioTrack testTrack;
  constexpr double sourceBpm = 100.0;
  constexpr size_t inputFrames = kSampleRate * 10;
  testTrack.samples.resize(inputFrames * kChannels);
  const size_t beatFrames = static_cast<size_t>(kSampleRate * 60.0 / sourceBpm);
  for (size_t frame = 0; frame < inputFrames; ++frame) {
    float sample = static_cast<float>(0.15 * std::sin(6.283185307179586 * 440.0 * frame / kSampleRate));
    const size_t frameInBeat = frame % beatFrames;
    if (frameInBeat < kSampleRate / 20) {
      const float envelope = static_cast<float>(std::exp(-20.0 * frameInBeat / kSampleRate));
      sample += envelope * static_cast<float>(std::sin(6.283185307179586 * 900.0 * frame / kSampleRate));
    }
    testTrack.samples[frame * kChannels] = sample;
    testTrack.samples[frame * kChannels + 1] = sample;
  }

  const auto estimate = analyzeTempo(testTrack.samples, kSampleRate);
  processTrack(testTrack, 0, estimate.bpm / 120.0, kSampleRate);
  const size_t expectedFrames = static_cast<size_t>(std::llround(inputFrames * sourceBpm / 120.0));
  size_t crossings = 0;
  constexpr size_t measurementStart = kSampleRate / 10;
  constexpr size_t measurementEnd = kSampleRate / 3;
  for (size_t frame = measurementStart + 1; frame < measurementEnd; ++frame) {
    if (testTrack.samples[(frame - 1) * kChannels] <= 0.0F
        && testTrack.samples[frame * kChannels] > 0.0F) {
      ++crossings;
    }
  }
  const double measuredFrequency = static_cast<double>(crossings) * kSampleRate / (measurementEnd - measurementStart);
  const bool passed = std::abs(estimate.bpm - sourceBpm) < 3.0
    && estimate.confidence >= 0.12
    && std::abs(measuredFrequency - 440.0) < 40.0
    && testTrack.samples.size() / kChannels == expectedFrames;
  return {
    {"passed", passed},
    {"expectedBpm", sourceBpm},
    {"detectedBpm", estimate.bpm},
    {"confidence", estimate.confidence},
    {"targetBpm", 120.0},
    {"toneHzAfterStretch", measuredFrequency},
    {"inputFrames", inputFrames},
    {"outputFrames", testTrack.samples.size() / kChannels}
  };
}

int effectivePitch(int semitones, bool enabled) {
  return enabled ? semitones : 0;
}

double effectiveDurationRatio(double durationRatio, bool dspEnabled) {
  return dspEnabled ? durationRatio : 1.0;
}

template<class Sample>
void addRoutedClick(Sample* output, unsigned int outputChannels, int route, double sample) {
  if (route >= 0) {
    if (static_cast<unsigned int>(route) < outputChannels) {
      output[route] += static_cast<Sample>(sample);
    }
  } else if (route <= -2) {
    const unsigned int firstChannel = static_cast<unsigned int>(-route - 2);
    if (firstChannel + 1 < outputChannels) {
      output[firstChannel] += static_cast<Sample>(sample);
      output[firstChannel + 1] += static_cast<Sample>(sample);
    }
  } else if (outputChannels >= 2) {
    output[0] += static_cast<Sample>(sample);
    output[1] += static_cast<Sample>(sample);
  }
}

int routedChannelCount(int route) {
  if (route >= 0) return route + 1;
  if (route <= -2) return -route;
  return 2;
}

template<class Sample>
void mixTrackFrame(Sample* output, unsigned int outputChannels, const AudioTrack& track,
                   uint64_t frame, float gain) {
  const size_t sourceIndex = static_cast<size_t>(frame) * kChannels;
  if (sourceIndex + 1 >= track.samples.size()) return;
  const float left = track.samples[sourceIndex];
  const float right = track.samples[sourceIndex + 1];
  const int route = track.outputChannel.load();
  if (route >= 0) {
    if (static_cast<unsigned int>(route) < outputChannels) {
      output[route] += (left + right) * 0.5F * gain;
    }
  } else if (route <= -2) {
    const unsigned int firstChannel = static_cast<unsigned int>(-route - 2);
    if (firstChannel + 1 < outputChannels) {
      output[firstChannel] += left * gain;
      output[firstChannel + 1] += right * gain;
    }
  } else if (outputChannels >= 2) {
    const float pan = std::clamp(track.pan.load(), -1.0F, 1.0F);
    const float leftGain = pan > 0.0F ? 1.0F - pan : 1.0F;
    const float rightGain = pan < 0.0F ? 1.0F + pan : 1.0F;
    output[0] += left * leftGain * gain;
    output[1] += right * rightGain * gain;
  }
}

float clickSample(uint64_t frame, unsigned int sampleRate, double bpm, int beats, float volume) {
  const double beatFrames = static_cast<double>(sampleRate) * 60.0 / bpm;
  const auto beat = static_cast<uint64_t>(static_cast<double>(frame) / beatFrames);
  const double beatPosition = static_cast<double>(frame) - static_cast<double>(beat) * beatFrames;
  if (beatPosition >= sampleRate * 0.035) return 0.0F;
  const float accent = beat % static_cast<uint64_t>(std::max(1, beats)) == 0 ? 1.0F : 0.65F;
  const float envelope = static_cast<float>(1.0 - beatPosition / (sampleRate * 0.035));
  const double frequency = accent > 0.9F ? 1560.0 : 1040.0;
  return static_cast<float>(std::sin(6.283185307179586 * frequency * beatPosition / sampleRate))
    * envelope * volume * accent * 0.65F;
}

float transitionFadeGain(uint64_t remaining, uint64_t frameOffset, uint64_t total) {
  if (remaining <= frameOffset) return 0.0F;
  return static_cast<float>(remaining - frameOffset) / static_cast<float>(std::max<uint64_t>(1, total));
}

json testPitchProtection() {
  AudioTrack testTrack;
  testTrack.pitchEnabled = false;
  constexpr double inputFrequency = 440.0;
  constexpr size_t frames = kSampleRate;
  testTrack.samples.resize(frames * kChannels);
  for (size_t frame = 0; frame < frames; ++frame) {
    const float sample = static_cast<float>(std::sin(6.283185307179586 * inputFrequency * frame / kSampleRate));
    testTrack.samples[frame * kChannels] = sample;
    testTrack.samples[frame * kChannels + 1] = sample;
  }
  constexpr double durationRatio = 0.9;
  processTrack(testTrack, effectivePitch(12, testTrack.pitchEnabled),
    effectiveDurationRatio(durationRatio, testTrack.pitchEnabled), kSampleRate);
  size_t crossings = 0;
  constexpr size_t startFrame = 10000;
  constexpr size_t endFrame = 40000;
  for (size_t frame = startFrame + 1; frame < endFrame; ++frame) {
    if (testTrack.samples[(frame - 1) * kChannels] <= 0.0F
        && testTrack.samples[frame * kChannels] > 0.0F) {
      ++crossings;
    }
  }
  const double measuredFrequency = static_cast<double>(crossings) * kSampleRate / (endFrame - startFrame);
  return {
    {"passed", std::abs(measuredFrequency - inputFrequency) < 20.0
      && testTrack.samples.size() == frames * kChannels},
    {"inputHz", inputFrequency},
    {"outputHz", measuredFrequency},
    {"inputFrames", frames},
    {"outputFrames", testTrack.samples.size() / kChannels},
    {"expectedFrames", frames}
  };
}

json testClickRouting() {
  std::vector<float> output(6, 0.0F);
  addRoutedClick(output.data(), 6, 4, 0.5F);
  const bool monoPassed = output[4] == 0.5F && output[3] == 0.0F;
  std::fill(output.begin(), output.end(), 0.0F);
  addRoutedClick(output.data(), 6, -4, 0.5F);
  const bool stereoPassed = output[2] == 0.5F && output[3] == 0.5F
    && output[1] == 0.0F;
  std::fill(output.begin(), output.end(), 0.0F);
  addRoutedClick(output.data(), 6, -1, 0.5F);
  const bool masterPassed = output[0] == 0.5F && output[1] == 0.5F
    && routedChannelCount(4) == 5 && routedChannelCount(-4) == 4;
  return {{"passed", monoPassed && stereoPassed && masterPassed}};
}

constexpr size_t kWaveformBins = 1024;
constexpr char kCacheMagic[] = "COMPAS02";

struct TrackCacheHeader {
  char magic[8]{};
  char key[65]{};
  uint32_t sampleRate{0};
  uint32_t waveformBins{0};
  double analyzedBpm{0.0};
  double tempoConfidence{0.0};
  uint64_t frameCount{0};
};

struct WaveformPeaks {
  std::vector<float> minimum;
  std::vector<float> maximum;
};

WaveformPeaks makeWaveform(const std::vector<float>& samples) {
  WaveformPeaks peaks{
    std::vector<float>(kWaveformBins, std::numeric_limits<float>::max()),
    std::vector<float>(kWaveformBins, std::numeric_limits<float>::lowest())
  };
  const size_t frameCount = samples.size() / kChannels;
  for (size_t frame = 0; frame < frameCount; ++frame) {
    const size_t bin = std::min(kWaveformBins - 1, frame * kWaveformBins / frameCount);
    const float left = samples[frame * kChannels];
    const float right = samples[frame * kChannels + 1];
    peaks.minimum[bin] = std::min(peaks.minimum[bin], std::min(left, right));
    peaks.maximum[bin] = std::max(peaks.maximum[bin], std::max(left, right));
  }
  float peak = 0.0F;
  for (size_t bin = 0; bin < kWaveformBins; ++bin) {
    if (peaks.minimum[bin] == std::numeric_limits<float>::max()) peaks.minimum[bin] = 0.0F;
    if (peaks.maximum[bin] == std::numeric_limits<float>::lowest()) peaks.maximum[bin] = 0.0F;
    peak = std::max(peak, std::max(std::abs(peaks.minimum[bin]), std::abs(peaks.maximum[bin])));
  }
  if (peak > 0.0F) {
    for (size_t bin = 0; bin < kWaveformBins; ++bin) {
      peaks.minimum[bin] /= peak;
      peaks.maximum[bin] /= peak;
    }
  }
  return peaks;
}

bool readTrackCache(AudioTrack& track, const std::string& cacheDirectory, const std::string& cacheKey,
                    unsigned int sampleRate, uint64_t maxBytes = UINT64_MAX) {
  if (cacheDirectory.empty() || cacheKey.size() != 64) return false;
  const std::filesystem::path cachePath = std::filesystem::u8path(cacheDirectory)
    / (cacheKey + ".cmpcache");
  std::error_code fileError;
  if (!std::filesystem::exists(cachePath, fileError)) {
    if (fileError) track.cacheWarning = "No se pudo consultar la caché: " + fileError.message();
    return false;
  }
  std::ifstream input(cachePath, std::ios::binary);
  TrackCacheHeader header{};
  if (!input.read(reinterpret_cast<char*>(&header), sizeof(header))
      || std::string(header.magic, sizeof(header.magic)) != kCacheMagic
      || std::string(header.key) != cacheKey
      || header.sampleRate != sampleRate
      || header.waveformBins != kWaveformBins
      || !std::isfinite(header.analyzedBpm) || header.analyzedBpm < 0.0
      || !std::isfinite(header.tempoConfidence) || header.tempoConfidence < 0.0 || header.tempoConfidence > 1.0
      || header.frameCount == 0
      || header.frameCount > static_cast<uint64_t>(INT_MAX / kChannels)) {
    track.cacheWarning = "La caché de «" + track.name + "» no es válida; se analizará de nuevo.";
    return false;
  }
  track.waveformMinimum.resize(header.waveformBins);
  track.waveformMaximum.resize(header.waveformBins);
  if (header.frameCount > maxBytes / (kChannels * sizeof(float)))
    throw std::runtime_error("La precarga excede el presupuesto de memoria.");
  track.samples.resize(static_cast<size_t>(header.frameCount) * kChannels);
  if (!input.read(reinterpret_cast<char*>(track.waveformMinimum.data()),
                  static_cast<std::streamsize>(track.waveformMinimum.size() * sizeof(float)))
      || !input.read(reinterpret_cast<char*>(track.waveformMaximum.data()),
                     static_cast<std::streamsize>(track.waveformMaximum.size() * sizeof(float)))
      || !input.read(reinterpret_cast<char*>(track.samples.data()),
                     static_cast<std::streamsize>(track.samples.size() * sizeof(float)))) {
    track.waveformMinimum.clear();
    track.waveformMaximum.clear();
    track.samples.clear();
    track.cacheWarning = "La caché de «" + track.name + "» está incompleta; se analizará de nuevo.";
    return false;
  }
  if (std::any_of(track.waveformMinimum.begin(), track.waveformMinimum.end(), [](float value) {
        return !std::isfinite(value) || value < -1.0F || value > 1.0F;
      })
      || std::any_of(track.waveformMaximum.begin(), track.waveformMaximum.end(), [](float value) {
        return !std::isfinite(value) || value < -1.0F || value > 1.0F;
      })
      || std::any_of(track.samples.begin(), track.samples.end(), [](float value) {
        return !std::isfinite(value);
      })) {
    track.waveformMinimum.clear();
    track.waveformMaximum.clear();
    track.samples.clear();
    track.cacheWarning = "La caché de «" + track.name + "» contiene datos inválidos; se analizará de nuevo.";
    return false;
  }
  track.analyzedBpm = header.analyzedBpm;
  track.tempoConfidence = header.tempoConfidence;
  track.cacheHit = true;
  return true;
}

void writeTrackCache(const AudioTrack& track, const std::string& cacheDirectory,
                     const std::string& cacheKey, unsigned int sampleRate,
                     std::string& warning) {
  if (cacheDirectory.empty() || cacheKey.size() != 64 || track.samples.empty()) return;
  const std::filesystem::path directory = std::filesystem::u8path(cacheDirectory);
  const std::filesystem::path cachePath = directory / (cacheKey + ".cmpcache");
  const std::filesystem::path temporaryPath = directory / (cacheKey + ".tmp");
  std::error_code fileError;
  std::filesystem::create_directories(directory, fileError);
  if (fileError) {
    warning = "No se pudo crear la caché de análisis: " + fileError.message();
    return;
  }
  TrackCacheHeader header{};
  std::copy(std::begin(kCacheMagic), std::end(kCacheMagic) - 1, header.magic);
  std::copy(cacheKey.begin(), cacheKey.end(), header.key);
  header.sampleRate = sampleRate;
  header.waveformBins = static_cast<uint32_t>(track.waveformMinimum.size());
  header.analyzedBpm = track.analyzedBpm;
  header.tempoConfidence = track.tempoConfidence;
  header.frameCount = track.samples.size() / kChannels;

  {
    std::ofstream output(temporaryPath, std::ios::binary | std::ios::trunc);
    if (!output
        || !output.write(reinterpret_cast<const char*>(&header), sizeof(header))
        || !output.write(reinterpret_cast<const char*>(track.waveformMinimum.data()),
                         static_cast<std::streamsize>(track.waveformMinimum.size() * sizeof(float)))
        || !output.write(reinterpret_cast<const char*>(track.waveformMaximum.data()),
                         static_cast<std::streamsize>(track.waveformMaximum.size() * sizeof(float)))
        || !output.write(reinterpret_cast<const char*>(track.samples.data()),
                         static_cast<std::streamsize>(track.samples.size() * sizeof(float)))
        || !output.flush()) {
      warning = "No se pudo guardar la caché de «" + track.name + "».";
      output.close();
      std::filesystem::remove(temporaryPath, fileError);
      return;
    }
  }
  std::filesystem::remove(cachePath, fileError);
  fileError.clear();
  std::filesystem::rename(temporaryPath, cachePath, fileError);
  if (fileError) {
    warning = "No se pudo finalizar la caché de «" + track.name + "»: " + fileError.message();
    std::filesystem::remove(temporaryPath, fileError);
  }
}

json testTrackCache() {
  const auto token = std::chrono::steady_clock::now().time_since_epoch().count();
  const std::filesystem::path directory = std::filesystem::temp_directory_path()
    / ("compas-cache-test-" + std::to_string(token));
  AudioTrack original;
  original.name = "cache test";
  original.analyzedBpm = 120.0;
  original.tempoConfidence = 0.9;
  original.samples.resize(2048 * kChannels);
  for (size_t frame = 0; frame < 2048; ++frame) {
    const float sample = static_cast<float>(std::sin(6.283185307179586 * 440.0 * frame / kSampleRate));
    original.samples[frame * kChannels] = sample;
    original.samples[frame * kChannels + 1] = sample;
  }
  const auto originalWaveform = makeWaveform(original.samples);
  original.waveformMinimum = originalWaveform.minimum;
  original.waveformMaximum = originalWaveform.maximum;
  const bool hasBipolarPeaks = std::any_of(original.waveformMinimum.begin(), original.waveformMinimum.end(),
      [](float value) { return value < -0.9F; })
    && std::any_of(original.waveformMaximum.begin(), original.waveformMaximum.end(),
      [](float value) { return value > 0.9F; });
  const std::string key(64, 'a');
  std::string warning;
  writeTrackCache(original, directory.u8string(), key, kSampleRate, warning);
  AudioTrack restored;
  restored.name = original.name;
  const bool loaded = readTrackCache(restored, directory.u8string(), key, kSampleRate);
  const bool passed = warning.empty() && loaded && restored.cacheHit
    && hasBipolarPeaks
    && restored.samples == original.samples
    && restored.waveformMinimum == original.waveformMinimum
    && restored.waveformMaximum == original.waveformMaximum
    && restored.analyzedBpm == original.analyzedBpm;
  std::error_code fileError;
  std::filesystem::remove(directory / (key + ".cmpcache"), fileError);
  fileError.clear();
  std::filesystem::remove(directory, fileError);
  return {{"passed", passed},   {"cacheHit", loaded}, {"waveformBins", restored.waveformMinimum.size()}};
}

json testTransitionFade() {
  constexpr uint64_t fadeFrames = 100;
  const bool passed = transitionFadeGain(fadeFrames, 0, fadeFrames) == 1.0F
    && std::abs(transitionFadeGain(fadeFrames, fadeFrames / 2, fadeFrames) - 0.5F) < 0.001F
    && transitionFadeGain(fadeFrames, fadeFrames, fadeFrames) == 0.0F
    && transitionFadeGain(fadeFrames, fadeFrames + 1, fadeFrames) == 0.0F;
  return {{"passed", passed}, {"fadeFrames", fadeFrames}};
}

std::unique_ptr<AudioTrack> loadTrack(const json& request, int semitones, unsigned int targetRate,
                                     double targetBpm, const std::string& cacheDirectory) {
  const std::string path = request.at("path").get<std::string>();
  const std::string name = request.value("name", path);
  auto track = std::make_unique<AudioTrack>();
  track->id = request.value("id", std::string{});
  track->name = name;
  track->volume.store(request.value("volume", 1.0F));
  track->pan.store(request.value("pan", 0.0F));
  track->outputChannel.store(request.value("outputChannel", -1));
  track->pitchEnabled = request.value("pitchEnabled", true);
  const std::string cacheKey = request.value("cacheKey", std::string{});
  const uint64_t maxBytes = request.value("maxPreparedBytes", UINT64_MAX);
  const bool cacheHit = readTrackCache(*track, cacheDirectory, cacheKey, targetRate, maxBytes);
  if (!cacheHit) {
    ma_decoder_config config = ma_decoder_config_init(ma_format_f32, kChannels, targetRate);
    ma_decoder decoder{};
#ifdef _WIN32
    const std::filesystem::path audioPath = std::filesystem::u8path(path);
    ma_result result = ma_decoder_init_file_w(audioPath.c_str(), &config, &decoder);
#else
    ma_result result = ma_decoder_init_file(path.c_str(), &config, &decoder);
#endif
    if (result != MA_SUCCESS) {
      throw std::runtime_error("No se pudo decodificar «" + name + "» (" + ma_result_description(result) + ").");
    }

    ma_uint64 frameCount = 0;
    result = ma_decoder_get_length_in_pcm_frames(&decoder, &frameCount);
    if (result != MA_SUCCESS || frameCount == 0 || frameCount > static_cast<ma_uint64>(INT_MAX / kChannels)) {
      ma_decoder_uninit(&decoder);
      throw std::runtime_error("La duración de «" + name + "» no es válida.");
    }

    if (frameCount > maxBytes / (kChannels * sizeof(float))) {
      ma_decoder_uninit(&decoder);
      throw std::runtime_error("La precarga excede el presupuesto de memoria.");
    }
    track->samples.resize(static_cast<size_t>(frameCount) * kChannels);
    ma_uint64 framesRead = 0;
    result = ma_decoder_read_pcm_frames(&decoder, track->samples.data(), frameCount, &framesRead);
    ma_decoder_uninit(&decoder);
    if (result != MA_SUCCESS || framesRead == 0) {
      throw std::runtime_error("No se pudo leer el audio de «" + name + "».");
    }
    track->samples.resize(static_cast<size_t>(framesRead) * kChannels);
    const auto estimate = analyzeTempo(track->samples, targetRate);
    track->analyzedBpm = estimate.bpm;
    track->tempoConfidence = estimate.confidence;
    auto waveform = makeWaveform(track->samples);
    track->waveformMinimum = std::move(waveform.minimum);
    track->waveformMaximum = std::move(waveform.maximum);
    writeTrackCache(*track, cacheDirectory, cacheKey, targetRate, track->cacheWarning);
  }
  double durationRatio = 1.0;
  if (track->pitchEnabled && track->analyzedBpm > 0.0 && targetBpm >= 30.0 && targetBpm <= 300.0) {
    const double candidateRatio = track->analyzedBpm / targetBpm;
    if (candidateRatio >= 0.75 && candidateRatio <= 1.5) {
      durationRatio = candidateRatio;
      track->tempoSynced = true;
    }
  }
  processTrack(*track, effectivePitch(semitones, track->pitchEnabled),
    effectiveDurationRatio(durationRatio, track->pitchEnabled), targetRate);
  return track;
}

void enqueue(AudioEngine& engine, const AudioCommand& command) {
  if (!engine.commands.push(command)) throw std::runtime_error("La cola de audio esta llena; vuelve a intentar.");
}

int audioCallback(void* outputBuffer, void*, unsigned int frames,
                  double, RtAudioStreamStatus status, void* userData) {
  auto& e = *static_cast<AudioEngine*>(userData);
  if (status) e.underruns.fetch_add(1, std::memory_order_relaxed);
  const uint64_t rampFrames = std::max(1U, e.sampleRate / 100); // 10 ms
  AudioCommand command;
  const auto applyMixState = [&](const AudioCommand& mix) {
    e.masterVolume.store(mix.master); e.setlistVolume.store(mix.setlist);
    e.clickEnabled.store(mix.clickEnabled); e.clickVolume.store(mix.clickVolume);
    e.clickBpm.store(mix.clickBpm); e.clickBeats.store(mix.clickBeats); e.clickOutputChannel.store(mix.clickRoute);
  };
  for (size_t count = 0; count < 128 && e.commands.pop(command); ++count) {
    switch (command.type) {
      case AudioCommand::Activate:
        applyMixState(command);
        e.transportEvent.store(0);
        e.outgoing = e.running ? e.current : nullptr;
        e.outgoingCursor = e.cursor;
        e.crossfade.value = e.outgoing ? 1.0 : 0.0;
        e.crossfade.set(0, rampFrames);
        e.current = command.song;
        e.cursor = command.position;
        e.loopStart = e.loopEnd = 0;
        e.running = true;
        e.stopAfterFade = false;
        e.transport.value = 0;
        e.transport.set(1, rampFrames);
        e.pendingStartId = e.current->activationId;
        break;
      case AudioCommand::Pause:
      case AudioCommand::Stop:
        e.transportEvent.store(0);
        e.transport.set(0, rampFrames);
        e.stopAfterFade = command.type == AudioCommand::Stop;
        if (!e.running) {
          if (e.stopAfterFade) e.cursor = 0;
          e.transportEvent.store(e.stopAfterFade ? 2 : 1);
        }
        break;
      case AudioCommand::Resume:
        if (e.current) {
          if (e.stopAfterFade) e.cursor = 0;
          e.running = true; e.stopAfterFade = false; e.transport.set(1, rampFrames);
          e.transportEvent.store(3);
        }
        break;
      case AudioCommand::Seek:
        // Fade old samples out while the destination fades in; no disk access at a seek.
        e.outgoing = e.running ? e.current : nullptr;
        e.outgoingCursor = e.cursor;
        e.crossfade.value = e.outgoing ? e.transport.value : 0;
        e.crossfade.set(0, rampFrames);
        e.cursor = command.position;
        e.transport.value = 0;
        e.transport.set(e.running ? 1 : 0, rampFrames);
        break;
      case AudioCommand::Pads:
        e.pads.select(command.key, command.volume, command.route, e.sampleRate, command.fade);
        break;
      case AudioCommand::Loop: e.loopStart = command.position; e.loopEnd = command.end; break;
      case AudioCommand::Mix: applyMixState(command); break;
      case AudioCommand::Bus: e.setlistVolume.store(static_cast<float>(command.volume)); break;
    }
  }
  auto* output = static_cast<float*>(outputBuffer);
  const double master = e.masterVolume.load();
  const double setlist = e.setlistVolume.load();
  const bool clickEnabled = e.clickEnabled.load();
  const double clickBpm = e.clickBpm.load();
  const int clickBeats = e.clickBeats.load(), clickRoute = e.clickOutputChannel.load();
  const float clickVolume = e.clickVolume.load();
  for (unsigned int frame = 0; frame < frames; ++frame) {
    double mixed[64]{};
    if (e.running && e.current) {
      if (e.loopEnd > e.loopStart && e.cursor >= e.loopEnd) {
        e.outgoing = e.current; e.outgoingCursor = e.cursor;
        e.crossfade.value = e.transport.value; e.crossfade.set(0, rampFrames);
        e.cursor = e.loopStart; e.transport.value = 0; e.transport.set(1, rampFrames);
      }
      const double gain = e.transport.tick();
      const double endFade = e.current->duration == UINT64_MAX ? 1.0
        : std::min(1.0, static_cast<double>(e.current->duration - std::min(e.cursor, e.current->duration)) / rampFrames);
      for (const auto& track : *e.current->tracks)
        mixTrackFrame(mixed, e.outputChannels, *track, e.cursor, static_cast<float>(track->volume.load() * master * gain * endFade));
      if (clickEnabled) addRoutedClick(mixed, e.outputChannels, clickRoute,
        clickSample(e.cursor, e.sampleRate, clickBpm, clickBeats, clickVolume) * gain * endFade);
      ++e.cursor;
      if (!e.transport.remaining && e.transport.target == 0) {
        e.running = false;
        if (e.stopAfterFade) e.cursor = 0;
        e.transportEvent.store(e.stopAfterFade ? 2 : 1);
      } else if (e.cursor >= e.current->duration) {
        e.running = false; e.cursor = 0; e.finished.store(true);
      }
    }
    for (unsigned int channel = 0; channel < e.outputChannels; ++channel) mixed[channel] *= setlist;
    if (e.outgoing) {
      const double gain = e.crossfade.tick();
      for (const auto& track : *e.outgoing->tracks)
        mixTrackFrame(mixed, e.outputChannels, *track, e.outgoingCursor,
          static_cast<float>(track->volume.load() * e.outgoing->master * gain * setlist));
      if (e.outgoing->clickEnabled) addRoutedClick(mixed, e.outputChannels, e.outgoing->clickRoute,
        clickSample(e.outgoingCursor, e.sampleRate, e.outgoing->clickBpm, e.outgoing->clickBeats,
          e.outgoing->clickVolume) * gain * setlist);
      ++e.outgoingCursor;
      if (!e.crossfade.remaining) e.outgoing = nullptr;
    }
    double left, right;
    e.pads.sample(e.sampleRate, left, right);
    if (e.pads.route == -1) { mixed[0] += left * setlist; if (e.outputChannels > 1) mixed[1] += right * setlist; }
    else addRoutedClick(mixed, e.outputChannels, e.pads.route, (left + right) * 0.5 * setlist);
    for (unsigned int channel = 0; channel < e.outputChannels; ++channel)
      output[static_cast<size_t>(frame) * e.outputChannels + channel] = static_cast<float>(mixed[channel]);
  }
  e.position.store(e.cursor, std::memory_order_relaxed);
  e.playing.store(e.running, std::memory_order_relaxed);
  if (e.pendingStartId) {
    e.startedId.store(e.pendingStartId, std::memory_order_release);
    e.pendingStartId = 0;
  }
  e.liveFloor.store(e.outgoing ? std::min(e.current->activationId, e.outgoing->activationId)
    : e.current ? e.current->activationId : 0, std::memory_order_release);
  return 0;
}

void closeStream(AudioEngine& e) {
  if (!e.audio) return;
  if (e.audio->isStreamRunning()) e.audio->stopStream();
  if (e.audio->isStreamOpen()) e.audio->closeStream();
  e.audio.reset();
  e.current = e.outgoing = nullptr;
  AudioCommand discarded;
  while (e.commands.pop(discarded)) {}
  e.liveSongs.clear();
  e.tracks = std::make_shared<const TrackSet>();
  e.running = false; e.playing.store(false); e.position.store(0); e.duration.store(0);
  e.transport = {}; e.pads = {};
  e.pendingStartId = 0;
  e.liveFloor.store(0); e.startedId.store(0); e.transportEvent.store(0);
}

void configureDevice(AudioEngine& e, const json& request) {
  const std::string api = request.at("api").get<std::string>();
  const unsigned int deviceId = request.at("deviceId").get<unsigned int>();
  const unsigned int rate = request.value("sampleRate", 0U), buffer = request.value("bufferFrames", 512U);
  if (rate && rate != 44100 && rate != 48000 && rate != 88200 && rate != 96000)
    throw std::runtime_error("Frecuencia no permitida.");
  if (buffer != 64 && buffer != 128 && buffer != 256 && buffer != 512 && buffer != 1024 && buffer != 2048)
    throw std::runtime_error("Buffer no permitido.");
  if (e.audio && e.audio->isStreamOpen() && e.api == api && e.deviceId == deviceId
      && e.requestedSampleRate == rate && e.requestedBufferFrames == buffer) return;
  closeStream(e);
  e.audio = std::make_unique<RtAudio>(parseApi(api), [](RtAudioErrorType, const std::string&) {});
  const auto info = e.audio->getDeviceInfo(deviceId);
  if (info.outputChannels < 2 || info.outputChannels > 64) throw std::runtime_error("Se requieren entre 2 y 64 salidas.");
  e.sampleRate = rate ? rate : info.preferredSampleRate ? info.preferredSampleRate : kSampleRate;
  e.outputChannels = info.outputChannels;
  e.api = api; e.deviceId = deviceId; e.requestedSampleRate = rate; e.requestedBufferFrames = buffer;
  e.bufferFrames = buffer;
  RtAudio::StreamParameters output;
  output.deviceId = deviceId; output.nChannels = e.outputChannels; output.firstChannel = 0;
  auto result = e.audio->openStream(&output, nullptr, RTAUDIO_FLOAT32, e.sampleRate, &e.bufferFrames, audioCallback, &e);
  if (result != RTAUDIO_NO_ERROR) throw std::runtime_error(e.audio->getErrorText());
  result = e.audio->startStream();
  if (result != RTAUDIO_NO_ERROR) throw std::runtime_error(e.audio->getErrorText());
  emit({{"event", "device-ready"}, {"sampleRate", e.sampleRate}, {"bufferFrames", e.bufferFrames},
    {"outputChannels", e.outputChannels}, {"latencyFrames", e.audio->getStreamLatency()}});
}

std::shared_ptr<PreparedSong> prepareSong(const json& request, unsigned int rate, unsigned int channels,
    const std::atomic<uint64_t>& generation, uint64_t expected) {
  const auto began = std::chrono::steady_clock::now();
  auto song = std::make_shared<PreparedSong>();
  song->request = request; song->tracks = std::make_shared<TrackSet>();
  json waveforms = json::array(), analysis = json::array();
  size_t cached = 0;
  uint64_t remainingBytes = request.value("maxPreparedBytes", UINT64_MAX);
  for (const auto& trackRequest : request.at("tracks")) {
    if (generation.load() != expected) return nullptr;
    emit({{"event", "preparing"}, {"songId", request.at("songId")}, {"preparationKey", request.at("preparationKey")},
      {"track", trackRequest.value("name", "")}});
    auto boundedRequest = trackRequest;
    boundedRequest["maxPreparedBytes"] = remainingBytes;
    auto track = loadTrack(boundedRequest, request.value("pitchSemitones", 0), rate,
      request.value("targetBpm", 120.0), request.value("cacheDirectory", std::string{}));
    const uint64_t bytes = track->samples.size() * sizeof(float);
    if (bytes > remainingBytes) throw std::runtime_error("La precarga excede el presupuesto de memoria.");
    remainingBytes -= bytes;
    if (routedChannelCount(track->outputChannel.load()) > static_cast<int>(channels))
      throw std::runtime_error("Una pista requiere salidas no disponibles.");
    if (track->cacheHit) ++cached;
    song->duration = std::max<uint64_t>(song->duration, track->samples.size() / kChannels);
    waveforms.push_back({{"id", track->id}, {"name", track->name},
      {"minimum", track->waveformMinimum}, {"maximum", track->waveformMaximum}});
    analysis.push_back({{"id", track->id}, {"bpm", track->analyzedBpm}, {"confidence", track->tempoConfidence}, {"synced", track->tempoSynced}});
    if (!track->cacheWarning.empty()) emit({{"event", "cache-warning"}, {"songId", request.at("songId")}, {"message", track->cacheWarning}});
    song->tracks->emplace_back(std::move(track));
  }
  if (routedChannelCount(request.at("metronome").value("outputChannel", -1)) > static_cast<int>(channels))
    throw std::runtime_error("El click requiere salidas no disponibles.");
  const uint64_t displayDuration = song->duration;
  if (request.value("clickOnly", false)) song->duration = UINT64_MAX;
  song->preparationMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - began).count();
  song->metadata = {{"songId", request.at("songId")}, {"preparationKey", request.at("preparationKey")},
    {"durationFrames", displayDuration}, {"sampleRate", rate}, {"cachedTracks", cached},
    {"waveforms", std::move(waveforms)}, {"trackAnalysis", std::move(analysis)}, {"preparationMs", song->preparationMs}};
  return song;
}

void applyMix(AudioEngine& engine, const json& request, bool publish = true);
void activateSong(AudioEngine& e, const std::shared_ptr<PreparedSong>& prepared, const json& request) {
  auto active = std::make_shared<PreparedSong>(*prepared);
  active->request = request; active->activationId = ++e.nextActivation;
  active->master = request.value("masterVolume", 1.0F);
  active->setlist = request.value("setlistVolume", 1.0F);
  const auto click = request.value("metronome", json::object());
  active->clickEnabled = click.value("enabled", false);
  active->clickVolume = click.value("volume", 0.6F);
  active->clickBpm = click.value("bpm", 120.0);
  active->clickBeats = click.value("beats", 4);
  active->clickRoute = click.value("outputChannel", -1);
  e.liveSongs.push_back(active);
  e.tracks = active->tracks;
  applyMix(e, request, false);
  AudioCommand command; command.type = AudioCommand::Activate; command.song = active.get();
  command.master = active->master; command.setlist = active->setlist;
  command.clickEnabled = active->clickEnabled; command.clickVolume = active->clickVolume;
  command.clickBpm = active->clickBpm; command.clickBeats = active->clickBeats; command.clickRoute = active->clickRoute;
  command.position = std::min<uint64_t>(static_cast<uint64_t>(request.value("startOffsetSeconds", 0.0) * e.sampleRate), active->duration);
  e.duration.store(active->duration); e.finished.store(false);
  enqueue(e, command);
}

json testDualDeckCrossfade() {
  AudioEngine e; e.sampleRate = 1000;
  auto first = std::make_shared<PreparedSong>(); first->tracks = std::make_shared<TrackSet>(); first->duration = 10000; first->activationId = 1;
  auto second = std::make_shared<PreparedSong>(*first); second->tracks = std::make_shared<TrackSet>(); second->activationId = 2;
  for (auto song : {first, second}) { auto track = std::make_shared<AudioTrack>(); track->samples.assign(20000, 0.2F); song->tracks->push_back(track); }
  AudioCommand c; c.type = AudioCommand::Activate; c.song = first.get(); enqueue(e, c);
  float output[200]{}; audioCallback(output, nullptr, 100, 0, 0, &e);
  c.song = second.get(); enqueue(e, c); audioCallback(output, nullptr, 100, 0, 0, &e);
  bool valid = true; for (float v : output) valid &= std::isfinite(v) && std::abs(v - 0.2F) < 0.03F;
  return {{"passed", valid}, {"crossfadeMs", 10}};
}

void applyMix(AudioEngine& engine, const json& request, bool publish) {
  const auto& values = request.at("tracks");
  const auto tracks = engine.tracks;
  if (!values.is_array() || values.size() != tracks->size()) {
    throw std::runtime_error("La mezcla enviada no coincide con las pistas cargadas.");
  }
  for (size_t index = 0; index < values.size(); ++index) {
    if (routedChannelCount(values[index].value("outputChannel", -1)) > static_cast<int>(engine.outputChannels))
      throw std::runtime_error("La pista requiere salidas no disponibles.");
    (*tracks)[index]->volume.store(values[index].value("volume", 1.0F));
    (*tracks)[index]->pan.store(values[index].value("pan", 0.0F));
    (*tracks)[index]->outputChannel.store(values[index].value("outputChannel", -1));
  }
  const auto metronome = request.value("metronome", json::object());
  if (routedChannelCount(metronome.value("outputChannel", -1)) > static_cast<int>(engine.outputChannels))
    throw std::runtime_error("El click requiere salidas no disponibles.");
  if (publish) {
    AudioCommand mix; mix.type = AudioCommand::Mix;
    mix.master = request.value("masterVolume", engine.masterVolume.load());
    mix.setlist = request.value("setlistVolume", engine.setlistVolume.load());
    mix.clickEnabled = metronome.value("enabled", engine.clickEnabled.load());
    mix.clickVolume = metronome.value("volume", engine.clickVolume.load());
    mix.clickRoute = metronome.value("outputChannel", engine.clickOutputChannel.load());
    mix.clickBpm = metronome.value("bpm", engine.clickBpm.load());
    mix.clickBeats = metronome.value("beats", engine.clickBeats.load());
    enqueue(engine, mix);
  }
}

void runEngine() {
  AudioEngine engine;
  std::mutex mutex; std::condition_variable wake;
  std::queue<std::string> commands;
  bool inputEnded = false;
  std::thread input([&] {
    std::string line;
    while (std::getline(std::cin, line)) {
      { std::lock_guard<std::mutex> lock(mutex); commands.push(line); }
      wake.notify_one();
    }
    { std::lock_guard<std::mutex> lock(mutex); inputEnded = true; }
    wake.notify_one();
  });
  std::atomic<uint64_t> generation{0};
  std::future<std::shared_ptr<PreparedSong>> worker;
  std::optional<json> queued, autoplay;
  std::string workerKey, workerSong;
  bool workerPrefetch{false};
  uint64_t workerGeneration = 0, reportedStarted = 0;
  std::shared_ptr<PreparedSong> prepared;
  std::vector<std::shared_ptr<PreparedSong>> readySongs;
  auto launch = [&](const json& request) {
    workerKey = request.at("preparationKey"); workerSong = request.at("songId");
    workerPrefetch = request.value("action", "") == "prefetch";
    workerGeneration = generation.load();
    worker = std::async(std::launch::async, prepareSong, request, engine.sampleRate, engine.outputChannels,
      std::cref(generation), workerGeneration);
  };
  emit({{"event", "ready"}});
  bool quitting = false;
  while (!quitting) {
    if (worker.valid() && worker.wait_for(std::chrono::milliseconds(0)) == std::future_status::ready) {
      try {
        auto result = worker.get();
        if (result && workerGeneration == generation.load()) {
          prepared = result;
          readySongs.push_back(result);
          auto bytes = [](const auto& song) {
            uint64_t total = 0;
            for (const auto& track : *song->tracks) total += track->samples.size() * sizeof(float);
            return total;
          };
          while (readySongs.size() > 2 || (readySongs.size() > 1
              && bytes(readySongs.front()) + bytes(readySongs.back()) > 512ULL * 1024 * 1024))
            readySongs.erase(readySongs.begin());
          auto event = result->metadata; event["event"] = "prepared"; emit(event);
          if (autoplay && autoplay->at("preparationKey") == result->request.at("preparationKey")) {
            activateSong(engine, prepared, *autoplay); autoplay.reset();
          }
        }
      } catch (const std::exception& error) {
        if (workerGeneration == generation.load()) {
          if (autoplay) {
            // A small background prefetch can be upgraded to an unrestricted foreground load.
            if (workerPrefetch && autoplay->at("preparationKey") == workerKey
                && std::string(error.what()).find("presupuesto") != std::string::npos) {
              queued = *autoplay; ++generation;
            } else {
              emit({{"event", "error"}, {"songId", workerSong}, {"preparationKey", workerKey}, {"message", error.what()}});
              autoplay.reset();
            }
          } else emit({{"event", workerPrefetch ? "preparation-warning" : "error"}, {"songId", workerSong},
            {"preparationKey", workerKey}, {"message", error.what()}});
        }
      }
      workerKey.clear();
      if (queued) { auto request = *queued; queued.reset(); launch(request); }
    }
    const auto started = engine.startedId.load(std::memory_order_acquire);
    if (started != reportedStarted) {
      reportedStarted = started;
      for (const auto& song : engine.liveSongs) if (song->activationId == started) {
        auto event = song->metadata; event["event"] = "playing";
        const auto nowMs = std::chrono::duration<double, std::milli>(std::chrono::system_clock::now().time_since_epoch()).count();
        event["acknowledgementMs"] = std::max(0.0, nowMs - song->request.value("requestedAtMs", nowMs));
        event["positionFrames"] = engine.position.load(); event["bufferFrames"] = engine.bufferFrames; emit(event); break;
      }
    }
    std::string activeSongId;
    for (const auto& song : engine.liveSongs) if (song->activationId == started)
      activeSongId = song->request.value("songId", std::string{});
    const int transportEvent = engine.transportEvent.exchange(0);
    if (transportEvent) emit({{"event", transportEvent == 1 ? "paused" : transportEvent == 2 ? "stopped" : "resumed"},
      {"songId", activeSongId}, {"positionFrames", engine.position.load()}, {"sampleRate", engine.sampleRate}});
    const auto floor = engine.liveFloor.load(std::memory_order_acquire);
    engine.liveSongs.erase(std::remove_if(engine.liveSongs.begin(), engine.liveSongs.end(),
      [floor](const auto& song) { return floor && song->activationId < floor; }), engine.liveSongs.end());
    if (engine.finished.exchange(false)) emit({{"event", "ended"}, {"songId", activeSongId}});
    std::string line;
    {
      std::unique_lock<std::mutex> lock(mutex);
      if (commands.empty()) wake.wait_for(lock, std::chrono::milliseconds(2), [&] { return inputEnded || !commands.empty(); });
      if (!commands.empty()) { line = std::move(commands.front()); commands.pop(); }
      else if (inputEnded) break;
    }
    if (line.empty()) continue;
    std::string songId, preparationKey;
    try {
      const json request = json::parse(line);
      songId = request.value("songId", std::string{}); preparationKey = request.value("preparationKey", std::string{});
      const std::string action = request.at("action");
      if (action == "configure") {
        ++generation; queued.reset(); autoplay.reset(); prepared.reset(); readySongs.clear();
        closeStream(engine);
        configureDevice(engine, request);
      } else if (action == "prepare" || action == "play" || action == "prefetch") {
        if (action == "prefetch" && (worker.valid() || queued || autoplay)) continue;
        configureDevice(engine, request);
        for (const auto& ready : readySongs) if (ready->request.at("preparationKey") == preparationKey) prepared = ready;
        if (action == "play") autoplay = request;
        else if (action == "prepare") autoplay.reset();
        if (prepared && prepared->request.at("preparationKey") == preparationKey) {
          if (worker.valid() && workerKey != preparationKey) { ++generation; queued.reset(); }
          if (action == "play") { activateSong(engine, prepared, request); autoplay.reset(); }
          else { auto event = prepared->metadata; event["event"] = "prepared"; emit(event); }
        } else if (worker.valid() && workerKey == preparationKey && workerGeneration == generation.load()) {
          // The existing preparation will satisfy this request.
        } else {
          ++generation;
          if (worker.valid()) queued = request; else launch(request);
        }
      } else if (action == "pause" || action == "resume" || action == "stop" || action == "seek" || action == "loop") {
        AudioCommand c;
        if (action == "pause") { c.type = AudioCommand::Pause; autoplay.reset(); }
        if (action == "resume") {
          if (engine.liveSongs.empty()) throw std::runtime_error("No hay cancion preparada.");
          // Resume keeps the currently active deck and does not reload samples.
          c.type = AudioCommand::Resume;
        }
        if (action == "stop") { c.type = AudioCommand::Stop; autoplay.reset(); }
        if (action == "seek") { c.type = AudioCommand::Seek; c.position = std::min(request.at("positionFrames").get<uint64_t>(), engine.duration.load()); }
        if (action == "loop") { c.type = AudioCommand::Loop; c.position = request.value("startFrame", 0ULL); c.end = request.value("endFrame", 0ULL); }
        enqueue(engine, c);
      } else if (action == "mix") applyMix(engine, request);
      else if (action == "bus") {
        AudioCommand bus; bus.type = AudioCommand::Bus; bus.volume = request.at("volume").get<double>(); enqueue(engine, bus);
      }
      else if (action == "pads") {
        AudioCommand c; c.type = AudioCommand::Pads; c.key = request.value("key", -1);
        c.volume = request.value("volume", 0.3); c.route = request.value("outputChannel", -1); c.fade = request.value("fadeSeconds", 1.0);
        if (c.key < -1 || c.key > 11 || c.volume < 0 || c.volume > 1 || c.fade < 0.01 || c.fade > 10
            || routedChannelCount(c.route) > static_cast<int>(engine.outputChannels)) throw std::runtime_error("Configuracion de pads invalida.");
        if (!engine.audio) throw std::runtime_error("Selecciona un dispositivo antes de usar pads.");
        enqueue(engine, c);
        emit({{"event", "pads"}, {"key", c.key}});
      } else if (action == "status") emit({{"event", "status"}, {"playing", engine.playing.load()}, {"songId", activeSongId},
        {"positionFrames", engine.position.load()}, {"durationFrames", engine.duration.load() == UINT64_MAX ? 0 : engine.duration.load()},
        {"sampleRate", engine.sampleRate}, {"bufferFrames", engine.bufferFrames}, {"underruns", engine.underruns.load()}});
      else if (action == "shutdown") quitting = true;
      else throw std::runtime_error("Comando desconocido.");
    } catch (const std::exception& error) { emit({{"event", "error"}, {"songId", songId}, {"preparationKey", preparationKey}, {"message", error.what()}}); }
  }
  ++generation;
  closeStream(engine);
  if (worker.valid()) worker.wait();
  // stdin is closed by Electron before shutdown, so the reader can finish without a detached thread.
  if (input.joinable()) input.join();
}

json testRealtime() {
  AudioEngine e; e.sampleRate = 1000; e.outputChannels = 4;
  auto song = std::make_shared<PreparedSong>();
  song->activationId = 1; song->duration = 10000; song->tracks = std::make_shared<TrackSet>();
  auto track = std::make_shared<AudioTrack>(); track->samples.assign(20000, 0.2F); song->tracks->push_back(track);
  AudioCommand c; c.type = AudioCommand::Activate; c.song = song.get(); enqueue(e, c);
  float output[400]{};
  auto render = [&] { audioCallback(output, nullptr, 100, 0, 0, &e); };
  render();
  const bool started = e.playing.load() && e.position.load() == 100;
  c.type = AudioCommand::Stop; enqueue(e, c); render();
  const bool stopped = !e.playing.load() && e.position.load() == 0 && output[396] == 0;
  c.type = AudioCommand::Resume; enqueue(e, c); render();
  const bool resumed = e.playing.load() && e.position.load() == 100 && output[396] > 0;
  c.type = AudioCommand::Loop; c.position = 50; c.end = 150; enqueue(e, c); render();
  const bool looped = e.position.load() == 100;
  c.type = AudioCommand::Pause; enqueue(e, c); render();
  const auto pausedAt = e.position.load(); render();
  const bool paused = !e.playing.load() && e.position.load() == pausedAt;
  c.type = AudioCommand::Pads; c.key = 0; c.route = 2; c.volume = 0.5; c.fade = 0.01; enqueue(e, c); render();
  bool routed = false, finite = true;
  for (size_t i = 0; i < 100; ++i) {
    routed |= std::abs(output[i * 4 + 2]) > 0.001;
    finite &= std::isfinite(output[i * 4 + 2]) && output[i * 4] == 0 && output[i * 4 + 1] == 0 && output[i * 4 + 3] == 0;
  }
  c.key = 7; enqueue(e, c); render();
  c.key = -1; enqueue(e, c); render();
  bool silence = true; for (size_t i = 80 * 4; i < 400; ++i) silence &= output[i] == 0;
  AudioQueue<uint64_t, 64> queue;
  constexpr uint64_t count = 100000;
  std::thread producer([&] { for (uint64_t i = 0; i < count; ++i) while (!queue.push(i)) std::this_thread::yield(); });
  bool ordered = true;
  for (uint64_t i = 0; i < count; ++i) { uint64_t value; while (!queue.pop(value)) std::this_thread::yield(); ordered &= value == i; }
  producer.join();
  return {{"passed", started && stopped && resumed && looped && paused && routed && finite && silence && ordered},
    {"start", started}, {"stopKeepsDeck", stopped}, {"resume", resumed}, {"sampleAccurateLoop", looped},
    {"pause", paused}, {"padIndependentRouting", routed && finite}, {"padFadeToSilence", silence}, {"spscOrdered", ordered}};
}

json testPreparation() {
  const auto token = std::chrono::steady_clock::now().time_since_epoch().count();
  const auto directory = std::filesystem::temp_directory_path() / ("compas-prepare-" + std::to_string(token));
  std::filesystem::create_directories(directory);
  const auto file = directory / "test.wav";
  ma_encoder encoder;
  auto config = ma_encoder_config_init(ma_encoding_format_wav, ma_format_f32, 2, 48000);
  if (ma_encoder_init_file(file.string().c_str(), &config, &encoder) != MA_SUCCESS) throw std::runtime_error("Test WAV creation failed");
  std::vector<float> samples(48000 * 2, 0.1F);
  ma_uint64 written = 0;
  ma_encoder_write_pcm_frames(&encoder, samples.data(), 48000, &written); ma_encoder_uninit(&encoder);
  json request = {{"songId", "test"}, {"preparationKey", "test"}, {"cacheDirectory", directory.string()},
    {"targetBpm", 120}, {"pitchSemitones", 0}, {"masterVolume", 1}, {"setlistVolume", 1},
    {"metronome", {{"enabled", false}}}, {"tracks", json::array({{{"id", "track"}, {"path", file.string()},
      {"name", "test"}, {"cacheKey", std::string(64, 'c')}}})}};
  std::atomic<uint64_t> generation{1};
  auto result = prepareSong(request, 48000, 2, generation, 1);
  auto cached = prepareSong(request, 48000, 2, generation, 1);
  generation.store(2);
  const auto cancelled = prepareSong(request, 48000, 2, generation, 1);
  AudioEngine engine;
  request["masterVolume"] = 0.25;
  activateSong(engine, result, request);
  const bool staged = engine.masterVolume.load() == 1.0F;
  float output[512 * 2]{};
  audioCallback(output, nullptr, 512, 0, 0, &engine);
  const auto firstPosition = engine.position.load();
  AudioCommand stop; stop.type = AudioCommand::Stop; enqueue(engine, stop);
  audioCallback(output, nullptr, 512, 0, 0, &engine);
  stop.type = AudioCommand::Resume; enqueue(engine, stop);
  audioCallback(output, nullptr, 512, 0, 0, &engine);
  const bool passed = result && cached && cached->metadata["cachedTracks"] == 1 && !cancelled
    && firstPosition == 512 && engine.position.load() == 512 && written == 48000
    && staged && engine.masterVolume.load() == 0.25F;
  std::filesystem::remove_all(directory);
  return {{"passed", passed}, {"preparedFrames", result->duration}, {"cachedTracks", cached->metadata["cachedTracks"]},
    {"cancelledStalePreparation", !cancelled}, {"restartReusesPCM", engine.position.load() == 512},
    {"blockSynchronousActivation", staged && engine.masterVolume.load() == 0.25F}};
}

int main(int argc, char** argv) {
  try {
    if (argc >= 2 && (std::string(argv[1]) == "--test-realtime" || std::string(argv[1]) == "--test-preparation")) {
      const auto result = std::string(argv[1]) == "--test-realtime" ? testRealtime() : testPreparation();
      std::cout << result.dump() << std::endl;
      return result.at("passed").get<bool>() ? 0 : 1;
    }
    if (argc >= 2 && std::string(argv[1]) == "--list-devices") {
      const std::string api = argc >= 3 ? argv[2] : "asio";
      std::cout << listDevices(api).dump() << std::endl;
      return 0;
    }
    if (argc >= 2 && std::string(argv[1]) == "--test-pitch") {
      const auto result = testPitchShift();
      std::cout << result.dump() << std::endl;
      return result.at("passed").get<bool>() ? 0 : 1;
    }
    if (argc >= 2 && std::string(argv[1]) == "--test-tempo-sync") {
      const auto result = testTempoSync();
      std::cout << result.dump() << std::endl;
      return result.at("passed").get<bool>() ? 0 : 1;
    }
    if (argc >= 2 && std::string(argv[1]) == "--test-pitch-protection") {
      const auto result = testPitchProtection();
      std::cout << result.dump() << std::endl;
      return result.at("passed").get<bool>() ? 0 : 1;
    }
    if (argc >= 2 && std::string(argv[1]) == "--test-click-routing") {
      const auto result = testClickRouting();
      std::cout << result.dump() << std::endl;
      return result.at("passed").get<bool>() ? 0 : 1;
    }
    if (argc >= 2 && std::string(argv[1]) == "--test-transition-fade") {
      const auto result = testTransitionFade();
      std::cout << result.dump() << std::endl;
      return result.at("passed").get<bool>() ? 0 : 1;
    }
    if (argc >= 2 && std::string(argv[1]) == "--test-track-cache") {
      const auto result = testTrackCache();
      std::cout << result.dump() << std::endl;
      return result.at("passed").get<bool>() ? 0 : 1;
    }
    if (argc >= 2 && std::string(argv[1]) == "--test-dual-deck-crossfade") {
      const auto result = testDualDeckCrossfade();
      std::cout << result.dump() << std::endl;
      return result.at("passed").get<bool>() ? 0 : 1;
    }
    runEngine();
    return 0;
  } catch (const std::exception& error) {
    emit({{"event", "error"}, {"message", error.what()}});
    return 1;
  }
}
