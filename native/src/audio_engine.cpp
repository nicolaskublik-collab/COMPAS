#ifndef NOMINMAX
#define NOMINMAX
#endif

#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"

#include "RtAudio.h"
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
  std::vector<float> waveform;
  bool cacheHit{false};
  std::string cacheWarning;
  std::atomic<float> volume{1.0F};
  std::atomic<float> pan{0.0F};
  std::atomic<int> outputChannel{-1};
};

using TrackSet = std::vector<std::shared_ptr<AudioTrack>>;

struct TransitionDeck {
  std::shared_ptr<const TrackSet> tracks;
  std::atomic<uint64_t> position{0};
  uint64_t duration{0};
  float masterVolume{1.0F};
  float setlistVolume{1.0F};
  float clickVolume{0.0F};
  bool clickEnabled{false};
  int clickOutputChannel{-1};
  double clickBpm{120.0};
  int clickBeats{4};
  unsigned int sampleRate{kSampleRate};
  std::atomic<uint64_t> fadeRemaining{0};
};

struct AudioEngine {
  std::shared_ptr<const TrackSet> tracks{std::make_shared<const TrackSet>()};
  std::vector<std::shared_ptr<const TrackSet>> retiredTrackSets;
  std::shared_ptr<TransitionDeck> transition;
  std::unique_ptr<RtAudio> audio;
  std::string api;
  unsigned int deviceId{0};
  std::atomic<uint64_t> playbackGeneration{0};
  std::atomic<bool> playing{false};
  std::atomic<bool> finished{false};
  std::atomic<uint64_t> position{0};
  std::atomic<uint64_t> duration{0};
  std::atomic<float> masterVolume{1.0F};
  std::atomic<float> setlistVolume{1.0F};
  std::atomic<float> clickVolume{0.0F};
  std::atomic<int> clickOutputChannel{-1};
  std::atomic<double> clickBpm{120.0};
  std::atomic<int> clickBeats{4};
  std::atomic<bool> clickEnabled{false};
  unsigned int outputChannels{2};
  unsigned int sampleRate{kSampleRate};
  unsigned int bufferFrames{512};
  unsigned int requestedSampleRate{0};
};

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

void addRoutedClick(float* output, unsigned int outputChannels, int route, float sample) {
  if (route >= 0) {
    if (static_cast<unsigned int>(route) < outputChannels) {
      output[route] += sample;
    }
  } else if (route <= -2) {
    const unsigned int firstChannel = static_cast<unsigned int>(-route - 2);
    if (firstChannel + 1 < outputChannels) {
      output[firstChannel] += sample;
      output[firstChannel + 1] += sample;
    }
  } else if (outputChannels >= 2) {
    output[0] += sample;
    output[1] += sample;
  }
}

int routedChannelCount(int route) {
  if (route >= 0) return route + 1;
  if (route <= -2) return -route;
  return 2;
}

void mixTrackFrame(float* output, unsigned int outputChannels, const AudioTrack& track,
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
  const size_t expectedFrames = static_cast<size_t>(std::llround(frames * durationRatio));
  processTrack(testTrack, effectivePitch(12, testTrack.pitchEnabled), durationRatio, kSampleRate);
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
      && testTrack.samples.size() == expectedFrames * kChannels},
    {"inputHz", inputFrequency},
    {"outputHz", measuredFrequency},
    {"inputFrames", frames},
    {"outputFrames", testTrack.samples.size() / kChannels}
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
constexpr char kCacheMagic[] = "COMPAS01";

struct TrackCacheHeader {
  char magic[8]{};
  char key[65]{};
  uint32_t sampleRate{0};
  uint32_t waveformBins{0};
  double analyzedBpm{0.0};
  double tempoConfidence{0.0};
  uint64_t frameCount{0};
};

std::vector<float> makeWaveform(const std::vector<float>& samples) {
  std::vector<double> powers(kWaveformBins, 0.0);
  std::vector<uint64_t> counts(kWaveformBins, 0);
  const size_t frameCount = samples.size() / kChannels;
  for (size_t frame = 0; frame < frameCount; ++frame) {
    const size_t bin = std::min(kWaveformBins - 1, frame * kWaveformBins / frameCount);
    const double left = samples[frame * kChannels];
    const double right = samples[frame * kChannels + 1];
    powers[bin] += (left * left + right * right) * 0.5;
    ++counts[bin];
  }
  double peakPower = 0.0;
  for (size_t bin = 0; bin < kWaveformBins; ++bin) {
    if (counts[bin] != 0) powers[bin] /= static_cast<double>(counts[bin]);
    peakPower = std::max(peakPower, powers[bin]);
  }
  std::vector<float> values(kWaveformBins, 0.0F);
  for (size_t bin = 0; bin < kWaveformBins; ++bin) {
    values[bin] = peakPower > 0.0 ? static_cast<float>(powers[bin] / peakPower) : 0.0F;
  }
  return values;
}

bool readTrackCache(AudioTrack& track, const std::string& cacheDirectory, const std::string& cacheKey,
                    unsigned int sampleRate) {
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
  track.waveform.resize(header.waveformBins);
  track.samples.resize(static_cast<size_t>(header.frameCount) * kChannels);
  if (!input.read(reinterpret_cast<char*>(track.waveform.data()),
                  static_cast<std::streamsize>(track.waveform.size() * sizeof(float)))
      || !input.read(reinterpret_cast<char*>(track.samples.data()),
                     static_cast<std::streamsize>(track.samples.size() * sizeof(float)))) {
    track.waveform.clear();
    track.samples.clear();
    track.cacheWarning = "La caché de «" + track.name + "» está incompleta; se analizará de nuevo.";
    return false;
  }
  if (std::any_of(track.waveform.begin(), track.waveform.end(), [](float value) {
        return !std::isfinite(value) || value < 0.0F || value > 1.0F;
      })
      || std::any_of(track.samples.begin(), track.samples.end(), [](float value) {
        return !std::isfinite(value);
      })) {
    track.waveform.clear();
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
  header.waveformBins = static_cast<uint32_t>(track.waveform.size());
  header.analyzedBpm = track.analyzedBpm;
  header.tempoConfidence = track.tempoConfidence;
  header.frameCount = track.samples.size() / kChannels;

  {
    std::ofstream output(temporaryPath, std::ios::binary | std::ios::trunc);
    if (!output
        || !output.write(reinterpret_cast<const char*>(&header), sizeof(header))
        || !output.write(reinterpret_cast<const char*>(track.waveform.data()),
                         static_cast<std::streamsize>(track.waveform.size() * sizeof(float)))
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
  original.waveform = makeWaveform(original.samples);
  const std::string key(64, 'a');
  std::string warning;
  writeTrackCache(original, directory.u8string(), key, kSampleRate, warning);
  AudioTrack restored;
  restored.name = original.name;
  const bool loaded = readTrackCache(restored, directory.u8string(), key, kSampleRate);
  const bool passed = warning.empty() && loaded && restored.cacheHit
    && restored.samples == original.samples && restored.waveform == original.waveform
    && restored.analyzedBpm == original.analyzedBpm;
  std::error_code fileError;
  std::filesystem::remove(directory / (key + ".cmpcache"), fileError);
  fileError.clear();
  std::filesystem::remove(directory, fileError);
  return {{"passed", passed}, {"cacheHit", loaded}, {"waveformBins", restored.waveform.size()}};
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
  const bool cacheHit = readTrackCache(*track, cacheDirectory, cacheKey, targetRate);
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
    track->waveform = makeWaveform(track->samples);
    writeTrackCache(*track, cacheDirectory, cacheKey, targetRate, track->cacheWarning);
  }
  double durationRatio = 1.0;
  if (track->analyzedBpm > 0.0 && targetBpm >= 30.0 && targetBpm <= 300.0) {
    const double candidateRatio = track->analyzedBpm / targetBpm;
    if (candidateRatio >= 0.75 && candidateRatio <= 1.5) {
      durationRatio = candidateRatio;
      track->tempoSynced = true;
    }
  }
  processTrack(*track, effectivePitch(semitones, track->pitchEnabled), durationRatio, targetRate);
  return track;
}

int audioCallback(void* outputBuffer, void*, unsigned int frames,
                  double, RtAudioStreamStatus, void* userData) {
  auto* engine = static_cast<AudioEngine*>(userData);
  auto* output = static_cast<float*>(outputBuffer);
  const size_t outputSamples = static_cast<size_t>(frames) * engine->outputChannels;
  std::fill(output, output + outputSamples, 0.0F);
  if (!engine->playing.load()) return 0;

  const uint64_t generation = engine->playbackGeneration.load();
  const auto tracks = std::atomic_load(&engine->tracks);
  const auto transition = std::atomic_load(&engine->transition);
  const uint64_t startFrame = engine->position.load();
  const uint64_t endFrame = engine->duration.load();
  const float master = engine->masterVolume.load();
  const float setlistMaster = engine->setlistVolume.load();

  for (unsigned int frame = 0; frame < frames && startFrame + frame < endFrame; ++frame) {
    const uint64_t songFrame = startFrame + frame;
    for (const auto& track : *tracks) {
      mixTrackFrame(output + static_cast<size_t>(frame) * engine->outputChannels,
        engine->outputChannels, *track, songFrame, track->volume.load() * master);
    }

    if (engine->clickEnabled.load()) {
      const float click = clickSample(songFrame, engine->sampleRate, engine->clickBpm.load(),
        engine->clickBeats.load(), engine->clickVolume.load());
      addRoutedClick(output + static_cast<size_t>(frame) * engine->outputChannels,
        engine->outputChannels, engine->clickOutputChannel.load(), click);
    }
    float* mixedFrame = output + static_cast<size_t>(frame) * engine->outputChannels;
    for (unsigned int channel = 0; channel < engine->outputChannels; ++channel) {
      mixedFrame[channel] *= setlistMaster;
    }

    if (transition) {
      const uint64_t remaining = transition->fadeRemaining.load();
      const uint64_t transitionFrame = transition->position.load() + frame;
      if (remaining > frame && transitionFrame < transition->duration) {
        const uint64_t fadeTotal = static_cast<uint64_t>(transition->sampleRate) * 35 / 100;
        const float fade = transitionFadeGain(remaining, frame, fadeTotal);
        float* transitionOutput = output + static_cast<size_t>(frame) * engine->outputChannels;
        for (const auto& track : *transition->tracks) {
          mixTrackFrame(transitionOutput, engine->outputChannels, *track, transitionFrame,
            track->volume.load() * transition->masterVolume * fade * transition->setlistVolume);
        }
        if (transition->clickEnabled) {
          const float click = clickSample(transitionFrame, transition->sampleRate, transition->clickBpm,
            transition->clickBeats, transition->clickVolume) * fade * transition->setlistVolume;
          addRoutedClick(transitionOutput, engine->outputChannels, transition->clickOutputChannel, click);
        }
      }
    }
  }
  if (transition) {
    const uint64_t remaining = transition->fadeRemaining.load();
    const uint64_t consumed = std::min<uint64_t>(remaining, frames);
    transition->position.store(std::min(transition->position.load() + frames, transition->duration));
    transition->fadeRemaining.store(remaining - consumed);
    if (remaining <= frames) std::atomic_store(&engine->transition, std::shared_ptr<TransitionDeck>{});
  }
  if (generation == engine->playbackGeneration.load()) {
    engine->position.store(std::min(startFrame + frames, endFrame));
    if (startFrame + frames >= endFrame) {
      engine->playing.store(false);
      engine->finished.store(true);
    }
  }
  return 0;
}

json testDualDeckCrossfade() {
  AudioEngine engine;
  engine.outputChannels = 2;
  engine.sampleRate = 1000;
  engine.duration.store(1000);
  engine.playing.store(true);
  auto currentTrack = std::make_shared<AudioTrack>();
  auto outgoingTrack = std::make_shared<AudioTrack>();
  currentTrack->samples.assign(1000 * kChannels, 0.2F);
  outgoingTrack->samples.assign(1000 * kChannels, 0.8F);
  auto currentTracks = std::make_shared<TrackSet>();
  currentTracks->push_back(currentTrack);
  std::atomic_store(&engine.tracks, std::shared_ptr<const TrackSet>(currentTracks));
  auto outgoing = std::make_shared<TransitionDeck>();
  auto outgoingTracks = std::make_shared<TrackSet>();
  outgoingTracks->push_back(outgoingTrack);
  outgoing->tracks = outgoingTracks;
  outgoing->duration = 1000;
  outgoing->sampleRate = 1000;
  outgoing->fadeRemaining.store(350);
  std::atomic_store(&engine.transition, outgoing);
  std::vector<float> output(100 * kChannels, 0.0F);
  audioCallback(output.data(), nullptr, 100, 0.0, RTAUDIO_INPUT_OVERFLOW, &engine);
  const float firstFrame = output[0];
  const float lastFrame = output[(99 * kChannels)];
  return {{"passed", std::abs(firstFrame - 1.0F) < 0.001F
      && lastFrame < firstFrame && lastFrame > 0.2F},
    {"firstFrame", firstFrame}, {"lastFrame", lastFrame}};
}

void closeStream(AudioEngine& engine) {
  if (!engine.audio) return;
  try {
    if (engine.audio->isStreamRunning()) engine.audio->stopStream();
    if (engine.audio->isStreamOpen()) engine.audio->closeStream();
  } catch (const std::exception& error) {
    throw std::runtime_error(error.what());
  }
  engine.audio.reset();
}

void startPlayback(AudioEngine& engine, const json& request) {
  const std::string apiString = request.value("api", "asio");
  const RtAudio::Api api = parseApi(apiString);
  const unsigned int deviceId = request.at("deviceId").get<unsigned int>();
  const unsigned int requestedSampleRate = request.value("sampleRate", 0U);
  const unsigned int requestedBufferFrames = request.value("bufferFrames", 512U);
  if (requestedSampleRate != 0
      && requestedSampleRate != 44100 && requestedSampleRate != 48000
      && requestedSampleRate != 88200 && requestedSampleRate != 96000) {
    throw std::runtime_error("La frecuencia de muestreo seleccionada no está permitida.");
  }
  if (requestedBufferFrames != 64 && requestedBufferFrames != 128
      && requestedBufferFrames != 256 && requestedBufferFrames != 512
      && requestedBufferFrames != 1024 && requestedBufferFrames != 2048) {
    throw std::runtime_error("El tamaño del búfer seleccionado no está permitido.");
  }
  const bool reuseStream = engine.audio
    && engine.audio->isStreamOpen()
    && engine.api == apiString
    && engine.deviceId == deviceId
    && engine.requestedSampleRate == requestedSampleRate
    && engine.bufferFrames == requestedBufferFrames;
  std::unique_ptr<RtAudio> nextAudio;
  if (!reuseStream) nextAudio = std::make_unique<RtAudio>(api, [](RtAudioErrorType, const std::string&) {});
  RtAudio* audio = reuseStream ? engine.audio.get() : nextAudio.get();
  const auto devices = audio->getDeviceIds();
  if (std::find(devices.begin(), devices.end(), deviceId) == devices.end()) {
    throw std::runtime_error("El dispositivo de audio seleccionado ya no está disponible.");
  }

  const RtAudio::DeviceInfo device = audio->getDeviceInfo(deviceId);
  if (device.name.empty() || device.outputChannels == 0) {
    throw std::runtime_error("El dispositivo seleccionado no ofrece salidas de audio.");
  }
  const unsigned int preferredSampleRate = device.preferredSampleRate == 0 ? kSampleRate : device.preferredSampleRate;
  const unsigned int sampleRate = requestedSampleRate == 0 ? preferredSampleRate : requestedSampleRate;
  if (requestedSampleRate != 0 && !device.sampleRates.empty()
      && std::find(device.sampleRates.begin(), device.sampleRates.end(), requestedSampleRate) == device.sampleRates.end()) {
    throw std::runtime_error("El dispositivo no admite la frecuencia de muestreo seleccionada.");
  }

  const int semitones = request.value("pitchSemitones", 0);
  const double targetBpm = request.value("targetBpm", 120.0);
  if (!std::isfinite(targetBpm) || targetBpm < 30.0 || targetBpm > 300.0) {
    throw std::runtime_error("El tempo objetivo de sincronización no es válido.");
  }
  const auto& trackRequests = request.at("tracks");
  if (!trackRequests.is_array()) throw std::runtime_error("La lista de pistas no es válida.");
  const std::string cacheDirectory = request.value("cacheDirectory", std::string{});
  auto nextTracks = std::make_shared<TrackSet>();
  nextTracks->reserve(trackRequests.size());
  for (const auto& trackRequest : trackRequests) {
    emit({{"event", "preparing"}, {"songId", request.value("songId", std::string{})},
      {"track", trackRequest.value("name", "")}});
    auto track = loadTrack(trackRequest, semitones, sampleRate, targetBpm, cacheDirectory);
    if (!track->cacheWarning.empty()) {
      emit({{"event", "cache-warning"}, {"songId", request.value("songId", std::string{})},
        {"message", track->cacheWarning}});
    }
    nextTracks->emplace_back(std::move(track));
  }

  uint64_t duration = 0;
  size_t cachedTracks = 0;
  int requiredChannels = 2;
  json waveforms = json::array();
  json trackAnalysis = json::array();
  for (const auto& track : *nextTracks) {
    if (track->cacheHit) ++cachedTracks;
    duration = std::max<uint64_t>(duration, track->samples.size() / kChannels);
    const int route = track->outputChannel.load();
    requiredChannels = std::max(requiredChannels, routedChannelCount(route));

    json values = json::array();
    for (const float value : track->waveform) values.push_back(value);
    waveforms.push_back({{"id", track->id}, {"name", track->name}, {"values", std::move(values)}});
    trackAnalysis.push_back({
      {"id", track->id},
      {"bpm", track->analyzedBpm},
      {"confidence", track->tempoConfidence},
      {"synced", track->tempoSynced}
    });
  }
  const auto click = request.value("metronome", json::object());
  requiredChannels = std::max(requiredChannels,
    routedChannelCount(click.value("outputChannel", -1)));
  if (requiredChannels > static_cast<int>(device.outputChannels)) {
    throw std::runtime_error("La asignación requiere " + std::to_string(requiredChannels)
      + " salidas, pero el dispositivo solo ofrece " + std::to_string(device.outputChannels) + ".");
  }
  if (device.outputChannels < static_cast<unsigned int>(requiredChannels)) {
    throw std::runtime_error("El número de salidas seleccionado no es válido para este dispositivo.");
  }

  if (reuseStream && engine.playing.load()) {
    auto outgoing = std::make_shared<TransitionDeck>();
    outgoing->tracks = std::atomic_load(&engine.tracks);
    outgoing->position.store(engine.position.load());
    outgoing->duration = engine.duration.load();
    outgoing->masterVolume = engine.masterVolume.load();
    outgoing->setlistVolume = engine.setlistVolume.load();
    outgoing->clickEnabled = engine.clickEnabled.load();
    outgoing->clickVolume = engine.clickVolume.load();
    outgoing->clickOutputChannel = engine.clickOutputChannel.load();
    outgoing->clickBpm = engine.clickBpm.load();
    outgoing->clickBeats = engine.clickBeats.load();
    outgoing->sampleRate = engine.sampleRate;
    outgoing->fadeRemaining.store(static_cast<uint64_t>(engine.sampleRate) * 35 / 100);
    std::atomic_store(&engine.transition, std::move(outgoing));
  } else {
    std::atomic_store(&engine.transition, std::shared_ptr<TransitionDeck>{});
  }

  const bool clickOnly = request.value("clickOnly", false);
  const uint64_t playbackDuration = clickOnly ? UINT64_MAX : duration;
  const double startOffset = request.value("startOffsetSeconds", 0.0);
  if (!std::isfinite(startOffset) || startOffset < 0.0) {
    throw std::runtime_error("La posición inicial de la canción no es válida.");
  }
  const uint64_t startFrame = static_cast<uint64_t>(startOffset * sampleRate);

  if (!reuseStream) {
    engine.playbackGeneration.fetch_add(1);
    engine.playing.store(false);
    std::atomic_store(&engine.transition, std::shared_ptr<TransitionDeck>{});
    closeStream(engine);
    engine.audio = std::move(nextAudio);
    engine.api = apiString;
    engine.deviceId = deviceId;
    engine.sampleRate = sampleRate;
    engine.bufferFrames = requestedBufferFrames;
    engine.requestedSampleRate = requestedSampleRate;
    engine.outputChannels = device.outputChannels;
  }

  auto previousTracks = std::atomic_load(&engine.tracks);
  if (previousTracks && !previousTracks->empty()) engine.retiredTrackSets.push_back(previousTracks);
  engine.playbackGeneration.fetch_add(1);
  if (!reuseStream) engine.playing.store(false);
  engine.finished.store(false);
  engine.position.store(std::min(startFrame, playbackDuration));
  engine.duration.store(playbackDuration);
  engine.masterVolume.store(request.value("masterVolume", 1.0F));
  engine.setlistVolume.store(request.value("setlistVolume", 1.0F));
  engine.clickEnabled.store(click.value("enabled", false));
  engine.clickVolume.store(click.value("volume", 0.6F));
  engine.clickOutputChannel.store(click.value("outputChannel", -1));
  engine.clickBpm.store(click.value("bpm", 120.0));
  engine.clickBeats.store(click.value("beats", 4));
  std::shared_ptr<const TrackSet> immutableTracks = std::move(nextTracks);
  std::atomic_store(&engine.tracks, std::move(immutableTracks));

  engine.retiredTrackSets.erase(std::remove_if(engine.retiredTrackSets.begin(), engine.retiredTrackSets.end(),
    [](const auto& trackSet) { return trackSet.use_count() == 1; }), engine.retiredTrackSets.end());

  if (!reuseStream) {
    RtAudio::StreamParameters output;
    output.deviceId = deviceId;
    output.nChannels = engine.outputChannels;
    output.firstChannel = 0;
    unsigned int bufferFrames = requestedBufferFrames;
    auto result = engine.audio->openStream(&output, nullptr, RTAUDIO_FLOAT32, engine.sampleRate,
      &bufferFrames, audioCallback, &engine);
    if (result != RTAUDIO_NO_ERROR) throw std::runtime_error(engine.audio->getErrorText());
    result = engine.audio->startStream();
    if (result != RTAUDIO_NO_ERROR) throw std::runtime_error(engine.audio->getErrorText());
  }
  engine.playing.store(true);
  emit({{"event", "playing"}, {"durationFrames", duration},
    {"positionFrames", engine.position.load()},
    {"sampleRate", engine.sampleRate}, {"outputChannels", engine.outputChannels},
    {"bufferFrames", engine.bufferFrames}, {"cachedTracks", cachedTracks},
    {"songId", request.value("songId", std::string{})},
    {"waveforms", std::move(waveforms)}, {"trackAnalysis", std::move(trackAnalysis)}});
}

void applyMix(AudioEngine& engine, const json& request) {
  engine.masterVolume.store(request.value("masterVolume", engine.masterVolume.load()));
  engine.setlistVolume.store(request.value("setlistVolume", engine.setlistVolume.load()));
  const auto& values = request.at("tracks");
  const auto tracks = std::atomic_load(&engine.tracks);
  if (!values.is_array() || values.size() != tracks->size()) {
    throw std::runtime_error("La mezcla enviada no coincide con las pistas cargadas.");
  }
  for (size_t index = 0; index < values.size(); ++index) {
    (*tracks)[index]->volume.store(values[index].value("volume", 1.0F));
    (*tracks)[index]->pan.store(values[index].value("pan", 0.0F));
    (*tracks)[index]->outputChannel.store(values[index].value("outputChannel", -1));
  }
  const auto metronome = request.value("metronome", json::object());
  engine.clickEnabled.store(metronome.value("enabled", engine.clickEnabled.load()));
  engine.clickVolume.store(metronome.value("volume", engine.clickVolume.load()));
  engine.clickOutputChannel.store(metronome.value("outputChannel", engine.clickOutputChannel.load()));
  engine.clickBpm.store(metronome.value("bpm", engine.clickBpm.load()));
  engine.clickBeats.store(metronome.value("beats", engine.clickBeats.load()));
}

void runEngine() {
  AudioEngine engine;
  std::mutex queueMutex;
  std::queue<std::string> commands;
  std::atomic<bool> inputEnded{false};

  std::thread inputThread([&] {
    std::string line;
    while (std::getline(std::cin, line)) {
      std::lock_guard<std::mutex> lock(queueMutex);
      commands.push(line);
    }
    inputEnded.store(true);
  });

  emit({{"event", "ready"}});
  while (true) {
    std::string line;
    {
      std::lock_guard<std::mutex> lock(queueMutex);
      if (!commands.empty()) {
        line = std::move(commands.front());
        commands.pop();
      }
    }
    if (line.empty()) {
      if (inputEnded.load()) break;
      if (engine.finished.exchange(false)) emit({{"event", "ended"}});
      std::this_thread::sleep_for(std::chrono::milliseconds(10));
      continue;
    }

    std::string songId;
    try {
      const json request = json::parse(line);
      songId = request.value("songId", std::string{});
      const auto action = request.at("action").get<std::string>();
      if (action == "play") {
        startPlayback(engine, request);
      } else if (action == "pause") {
        engine.playing.store(false);
        emit({{"event", "paused"}, {"positionFrames", engine.position.load()}});
      } else if (action == "resume") {
        if (engine.audio && engine.audio->isStreamOpen()) {
          engine.finished.store(false);
          engine.playing.store(true);
          emit({{"event", "playing"}, {"positionFrames", engine.position.load()}});
        } else {
          throw std::runtime_error("No hay una canción preparada para reanudar.");
        }
      } else if (action == "stop") {
        engine.playing.store(false);
        engine.position.store(0);
        emit({{"event", "stopped"}});
      } else if (action == "seek") {
        engine.position.store(std::min<uint64_t>(request.at("positionFrames").get<uint64_t>(), engine.duration.load()));
      } else if (action == "mix") {
        applyMix(engine, request);
      } else if (action == "status") {
        emit({{"event", "status"}, {"playing", engine.playing.load()},
          {"positionFrames", engine.position.load()}, {"durationFrames", engine.duration.load()},
          {"sampleRate", engine.sampleRate}});
      } else if (action == "shutdown") {
        break;
      } else {
        throw std::runtime_error("Comando de audio desconocido.");
      }
    } catch (const std::exception& error) {
      emit({{"event", "error"}, {"message", error.what()},
        {"songId", songId}});
    }
  }

  engine.playing.store(false);
  try {
    closeStream(engine);
  } catch (const std::exception& error) {
    emit({{"event", "error"}, {"message", error.what()}});
  }
  if (inputThread.joinable()) {
    inputThread.detach();
  }
}

int main(int argc, char** argv) {
  try {
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
