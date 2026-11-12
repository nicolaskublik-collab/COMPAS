// UI-only controls; synthesis and fades run in the native callback.
export const PAD_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const DEFAULT_PADS = { volume: 0.3, outputChannel: -1, fadeSeconds: 1.5, followSong: false };
export function keyIndex(key) {
  const roots = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  return roots[String(key).replace(/m$/, '')] ?? -1;
}
