#pragma once
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>

// Exactly one producer (control) and one consumer (audio). No allocation or locks.
#ifdef _MSC_VER
#pragma warning(push)
#pragma warning(disable: 4324) // Intentional cache-line padding between producer and consumer.
#endif
template<class T, size_t Capacity> class AudioQueue {
  std::array<T, Capacity> slots{};
  alignas(64) std::atomic<size_t> write{0};
  alignas(64) std::atomic<size_t> read{0};
public:
  bool push(const T& value) {
    const size_t w = write.load(std::memory_order_relaxed);
    const size_t next = (w + 1) % Capacity;
    if (next == read.load(std::memory_order_acquire)) return false;
    slots[w] = value;
    write.store(next, std::memory_order_release);
    return true;
  }
  bool pop(T& value) {
    const size_t r = read.load(std::memory_order_relaxed);
    if (r == write.load(std::memory_order_acquire)) return false;
    value = slots[r];
    read.store((r + 1) % Capacity, std::memory_order_release);
    return true;
  }
};
#ifdef _MSC_VER
#pragma warning(pop)
#endif

struct AudioRamp {
  double value{0}, target{0}, step{0};
  uint64_t remaining{0};
  void set(double next, uint64_t frames) {
    target = next;
    remaining = frames;
    step = frames ? (next - value) / static_cast<double>(frames) : 0;
    if (!frames) value = next;
  }
  double tick() {
    if (remaining && --remaining == 0) value = target;
    else if (remaining) value += step;
    return value;
  }
};

// Twelve permanent voices: phase continuity and gain ramps prevent clicks on key changes.
// Generated locally; no samples, decoding, licensing or disk work in the callback.
struct AmbientPads {
  std::array<AudioRamp, 12> voices;
  std::array<std::array<double, 3>, 12> phases{};
  std::array<std::array<double, 3>, 12> increments{};
  AudioRamp level;
  int route{-1};
  int selected{-1};
  int nextRoute{-1};
  double nextVolume{0.3};
  bool routing{false};
  void select(int key, double volume, int output, unsigned int rate, double fadeSeconds) {
    selected = key;
    nextRoute = output;
    nextVolume = volume;
    if (route != output) {
      routing = true;
      level.set(0, std::max(1U, rate / 100));
    } else level.set(volume, std::max(1U, rate / 100));
    const auto frames = static_cast<uint64_t>(rate * fadeSeconds);
    for (int i = 0; i < 12; ++i) {
      const double target = i == key ? 1.0 : 0.0;
      if (voices[i].target != target) voices[i].set(target, frames);
      const double root = 130.81278265 * std::pow(2.0, i / 12.0);
      increments[i] = {6.283185307179586 * root / rate,
        6.283185307179586 * root * 1.5015 / rate, 6.283185307179586 * root * 1.998 / rate};
    }
  }
  void sample(unsigned int rate, double& left, double& right) {
    left = right = 0;
    constexpr double tau = 6.283185307179586;
    for (int key = 0; key < 12; ++key) {
      const double gain = voices[key].tick();
      if (!gain && !voices[key].remaining) continue;
      for (int partial = 0; partial < 3; ++partial) {
        auto& phase = phases[key][partial];
        const double tone = std::sin(phase) * gain * (partial == 0 ? 0.13 : 0.065);
        left += tone * (partial == 1 ? 0.7 : 1.0);
        right += tone * (partial == 2 ? 0.7 : 1.0);
        phase += increments[key][partial];
        if (phase >= tau) phase -= tau;
      }
    }
    const double gain = level.tick();
    left *= gain;
    right *= gain;
    if (routing && !level.remaining) {
      route = nextRoute; routing = false;
      level.set(nextVolume, std::max(1U, rate / 100));
    }
  }
};
