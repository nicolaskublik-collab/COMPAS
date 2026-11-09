# Compas project instructions

Compas is a local Electron multitrack player for Windows. The UI is plain HTML, CSS, and JavaScript; `main.cjs` owns Electron IPC and local library persistence; `native/src/audio_engine.cpp` uses RtAudio, miniaudio, and Signalsmith Stretch for playback, routing, pitch, and tempo sync.

## Development

- Install dependencies with `npm ci`.
- Run `npm run check` for JavaScript syntax and a native MSVC build.
- Run `npm run test:native` for pitch-preservation and tempo-sync checks.
- Run `npm start` to rebuild and launch the app.
- Run `npm run dist:win` to produce the Windows x64 installer.
- Keep saved songs, audio paths, and user settings in the existing local user-data storage; never add user audio or library data to the repository.

## Audio behavior

- Song BPM is the shared tempo for the native click and the track tempo analyzer.
- Tempo analysis may time-stretch tracks while preserving pitch; do not silently substitute sample-rate playback speed changes.
- Keep the native click as a per-song channel strip in the mixer and preserve per-song click, pitch, and setlist settings.

## Licensing and distribution

- The project is GPL-3.0-only. Preserve dependency notices and source licenses under `native/vendor`.
- The extracted Steinberg ASIO SDK in `native/vendor/asiosdk` is intentionally excluded from version control and builds; do not add it to commits or releases.
- `native/build` and `dist` are generated artifacts. GitHub Actions builds the installer and attaches it to version-tagged Releases.
