const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { createHash, randomUUID } = require('node:crypto');
const { promisify } = require('node:util');

const PLAYABLE_AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.ogg']);
const AUDIO_EXTENSIONS = new Set([...PLAYABLE_AUDIO_EXTENSIONS, '.opus', '.m4a', '.aac', '.aiff', '.aif']);
const MUSICAL_KEYS = new Set([
  'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B',
  'Cm', 'C#m', 'Dbm', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm', 'F#m', 'Gbm', 'Gm', 'G#m', 'Abm', 'Am', 'A#m', 'Bbm', 'Bm'
]);
const LIBRARY_FILE = 'library.json';
const SETTINGS_FILE = 'settings.json';
const DEFAULT_METRONOME = Object.freeze({ enabled: false, bpm: 120, beats: 4, volume: 0.6, outputChannel: -1 });
const DEFAULT_SETTINGS = Object.freeze({
  selectedAudioApi: 'asio',
  selectedAudioDevice: '',
  selectedSampleRate: 0,
  bufferFrames: 512,
  midiMappings: [],
  keyMappings: []
});
const execFileAsync = promisify(execFile);
let window;
let libraryPath;
let settingsPath;
let library = { songs: [], setlists: [] };
let settings = { ...DEFAULT_SETTINGS, midiMappings: [] };
let allowedTrackPaths = new Set();
let audioEngineProcess = null;
let audioEngineReadyPromise = null;
let resolveAudioEngineReady = null;
let rejectAudioEngineReady = null;

function isAudioPath(filePath) {
  return typeof filePath === 'string' && path.isAbsolute(filePath) && AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function validateLibrary(value) {
  if (!value || !Array.isArray(value.songs) || !Array.isArray(value.setlists)) {
    throw new Error('La biblioteca tiene un formato inválido.');
  }

  const songIds = new Set();
  for (const song of value.songs) {
    if (!song || typeof song.id !== 'string' || typeof song.name !== 'string' || !Array.isArray(song.tracks)) {
      throw new Error('Hay una canción con datos inválidos.');
    }
    if (typeof song.artist !== 'string'
      || song.artist.length > 120
      || !Number.isInteger(song.bpm)
      || song.bpm < 30
      || song.bpm > 300
      || typeof song.key !== 'string'
      || (song.key !== '' && !MUSICAL_KEYS.has(song.key))
      || typeof song.pitchTargetKey !== 'string'
      || (song.pitchTargetKey !== '' && !MUSICAL_KEYS.has(song.pitchTargetKey))
      || typeof song.clickOnly !== 'boolean'
      || !Number.isInteger(song.pitchSemitones)
      || song.pitchSemitones < -12
      || song.pitchSemitones > 12
      || !song.metronome
      || typeof song.metronome.enabled !== 'boolean'
      || !Number.isInteger(song.metronome.bpm)
      || song.metronome.bpm < 30
      || song.metronome.bpm > 300
      || !Number.isInteger(song.metronome.beats)
      || song.metronome.beats < 1
      || song.metronome.beats > 12
      || typeof song.metronome.volume !== 'number'
      || song.metronome.volume < 0
      || song.metronome.volume > 1
      || !Number.isInteger(song.metronome.outputChannel)
      || song.metronome.outputChannel < -64
      || song.metronome.outputChannel > 63
      || (song.clickOnly && song.tracks.length !== 0)
      || (!song.clickOnly && song.tracks.length === 0)) {
      throw new Error(`La configuración de «${song.name}» es inválida.`);
    }
    if (!Array.isArray(song.markers) || !Array.isArray(song.regions)
      || song.markers.some((marker) => !marker || typeof marker.id !== 'string'
        || typeof marker.name !== 'string' || marker.name.length > 80
        || typeof marker.position !== 'number' || !Number.isFinite(marker.position) || marker.position < 0)
      || song.regions.some((region) => !region || typeof region.id !== 'string'
        || typeof region.name !== 'string' || region.name.length > 80
        || typeof region.start !== 'number' || !Number.isFinite(region.start) || region.start < 0
        || typeof region.end !== 'number' || !Number.isFinite(region.end) || region.end <= region.start)) {
      throw new Error(`Los puntos o regiones de «${song.name}» son inválidos.`);
    }
    if (songIds.has(song.id)) throw new Error('Hay identificadores de canción duplicados.');
    songIds.add(song.id);

    for (const track of song.tracks) {
      if (!track || typeof track.id !== 'string' || typeof track.name !== 'string'       || !isAudioPath(track.path)
      || (track.outputChannel !== undefined
        && (!Number.isInteger(track.outputChannel) || track.outputChannel < -64 || track.outputChannel > 63))
      || typeof track.pitchEnabled !== 'boolean') {
        throw new Error('Hay una pista con datos inválidos.');
      }
    }
  }

  for (const setlist of value.setlists) {
    if (!setlist || typeof setlist.id !== 'string' || typeof setlist.name !== 'string'
      || !Array.isArray(setlist.songIds)
      || typeof setlist.masterVolume !== 'number'
      || !Number.isFinite(setlist.masterVolume)
      || setlist.masterVolume < 0
      || setlist.masterVolume > 1) {
      throw new Error('Hay una lista con datos inválidos.');
    }
    if (setlist.songIds.some((id) => !songIds.has(id))) {
      throw new Error('Una lista contiene una canción que ya no está en la biblioteca.');
    }
  }
}

function keyForTransposition(source, semitones) {
  if (!MUSICAL_KEYS.has(source)) return '';
  const isMinor = source.endsWith('m');
  const root = source.replace(/m$/, '');
  const keys = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const roots = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const target = keys[((roots[root] + semitones) % 12 + 12) % 12];
  return `${target}${isMinor ? 'm' : ''}`;
}

function migrateLibrary(value) {
  return {
    ...value,
    songs: value.songs.map((song) => {
      const bpm = Number.isInteger(song.bpm) && song.bpm >= 30 && song.bpm <= 300
        ? song.bpm
        : (song.metronome?.bpm ?? DEFAULT_METRONOME.bpm);
      const pitchSemitones = Number.isInteger(song.pitchSemitones) ? song.pitchSemitones : 0;
      return {
        ...song,
        artist: typeof song.artist === 'string' ? song.artist : '',
        bpm,
        key: typeof song.key === 'string' && MUSICAL_KEYS.has(song.key) ? song.key : '',
        pitchTargetKey: typeof song.pitchTargetKey === 'string' && MUSICAL_KEYS.has(song.pitchTargetKey)
          ? song.pitchTargetKey
          : keyForTransposition(song.key, pitchSemitones),
        markers: Array.isArray(song.markers) ? song.markers : [],
        regions: Array.isArray(song.regions) ? song.regions : [],
        clickOnly: song.clickOnly === true,
        pitchSemitones,
        metronome: {
          ...DEFAULT_METRONOME,
          ...(song.metronome ?? {}),
          outputChannel: Number.isInteger(song.metronome?.outputChannel)
            && song.metronome.outputChannel >= -64 && song.metronome.outputChannel <= 63
            ? song.metronome.outputChannel : DEFAULT_METRONOME.outputChannel,
          bpm
        },
        tracks: song.tracks.map(({ pitchSemitones, ...track }) => ({
          outputChannel: -1,
          pitchEnabled: true,
          ...track
        }))
      };
    }),
    setlists: value.setlists.map((setlist) => ({
      ...setlist,
      masterVolume: typeof setlist.masterVolume === 'number'
        && Number.isFinite(setlist.masterVolume)
        && setlist.masterVolume >= 0
        && setlist.masterVolume <= 1
        ? setlist.masterVolume : 1
    }))
  };
}

function decodeWindows1252Mojibake(value) {
  const windows1252 = new Map([
    [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
    [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
    [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
    [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
    [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
    [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
    [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f]
  ]);
  const bytes = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x7f || (codePoint >= 0xa0 && codePoint <= 0xff)) {
      bytes.push(codePoint);
    } else if (windows1252.has(codePoint)) {
      bytes.push(windows1252.get(codePoint));
    } else {
      return null;
    }
  }
  const decoded = Buffer.from(bytes).toString('utf8');
  return decoded !== value && !decoded.includes('\ufffd') ? decoded : null;
}

async function repairMissingTrackPaths(value) {
  const directoryEntries = new Map();
  for (const song of value.songs) {
    for (const track of song.tracks) {
      try {
        await fs.access(track.path);
        continue;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }

      const directory = path.dirname(track.path);
      if (!directoryEntries.has(directory)) {
        try {
          directoryEntries.set(directory, await fs.readdir(directory));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          directoryEntries.set(directory, []);
        }
      }

      const originalName = path.basename(track.path);
      const repairedName = decodeWindows1252Mojibake(originalName);
      if (!repairedName || !AUDIO_EXTENSIONS.has(path.extname(repairedName).toLowerCase())) continue;
      const actualName = directoryEntries.get(directory)
        .find((entry) => entry.toLowerCase() === repairedName.toLowerCase());
      if (!actualName) continue;

      track.path = path.join(directory, actualName);
      if (track.name === path.basename(originalName, path.extname(originalName))) {
        track.name = path.basename(actualName, path.extname(actualName));
      }
    }
  }
  return value;
}

function validateSettings(value) {
  if (!value
    || !['asio', 'wasapi'].includes(value.selectedAudioApi)
    || typeof value.selectedAudioDevice !== 'string'
    || ![0, 44100, 48000, 88200, 96000].includes(value.selectedSampleRate)
    || ![64, 128, 256, 512, 1024, 2048].includes(value.bufferFrames)
    || !Array.isArray(value.midiMappings)
    || !Array.isArray(value.keyMappings)) {
    throw new Error('La configuración de audio/MIDI tiene un formato inválido.');
  }
  const allowedActions = new Set(['play', 'stop', 'next', 'previous', 'restart', 'addMarker', 'regionStart', 'regionEnd']);
  const actions = new Set();
  for (const mapping of value.midiMappings) {
    if (!mapping
      || !allowedActions.has(mapping.action)
      || typeof mapping.inputId !== 'string'
      || typeof mapping.inputName !== 'string'
      || !['note', 'cc'].includes(mapping.messageType)
      || !Number.isInteger(mapping.channel)
      || mapping.channel < 0
      || mapping.channel > 15
      || !Number.isInteger(mapping.number)
      || mapping.number < 0
      || mapping.number > 127
      || actions.has(mapping.action)) {
      throw new Error('Hay una asignación MIDI inválida o duplicada.');
    }
    actions.add(mapping.action);
  }
  const keyActions = new Set();
  const keyCodes = new Set();
  for (const mapping of value.keyMappings) {
    const code = mapping?.code;
    if (!mapping || !allowedActions.has(mapping.action)
      || typeof code !== 'string' || !/^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|Space|Arrow(?:Up|Down|Left|Right)|Home|End|Enter|Escape|F(?:[1-9]|1[0-2]))$/.test(code)
      || typeof mapping.ctrl !== 'boolean' || typeof mapping.alt !== 'boolean' || typeof mapping.shift !== 'boolean'
      || keyActions.has(mapping.action)
      || keyCodes.has(`${mapping.code}:${mapping.ctrl}:${mapping.alt}:${mapping.shift}`)) {
      throw new Error('Hay una asignación de teclado inválida o duplicada.');
    }
    keyActions.add(mapping.action);
    keyCodes.add(`${mapping.code}:${mapping.ctrl}:${mapping.alt}:${mapping.shift}`);
  }
}

async function saveLibrary(nextLibrary) {
  validateLibrary(nextLibrary);
  const temporaryPath = `${libraryPath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(nextLibrary, null, 2), 'utf8');
  await fs.rename(temporaryPath, libraryPath);
  library = nextLibrary;
  allowedTrackPaths = new Set(library.songs.flatMap((song) => song.tracks.map((track) => track.path)));
}

async function saveSettings(nextSettings) {
  validateSettings(nextSettings);
  const temporaryPath = `${settingsPath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(nextSettings, null, 2), 'utf8');
  await fs.rename(temporaryPath, settingsPath);
  settings = nextSettings;
}

async function loadLibrary() {
  try {
    const contents = await fs.readFile(libraryPath, 'utf8');
    const parsed = JSON.parse(contents);
    await saveLibrary(await repairMissingTrackPaths(migrateLibrary(parsed)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`No se pudo cargar la biblioteca: ${error.message}`);
    await saveLibrary(library);
  }
}

async function loadSettings() {
  try {
    const contents = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(contents);
    const migrated = {
      selectedAudioApi: parsed.selectedAudioApi ?? 'asio',
      selectedAudioDevice: parsed.selectedAudioDevice ?? '',
      selectedSampleRate: [0, 44100, 48000, 88200, 96000].includes(parsed.selectedSampleRate)
        ? parsed.selectedSampleRate : 0,
      bufferFrames: [64, 128, 256, 512, 1024, 2048].includes(parsed.bufferFrames)
        ? parsed.bufferFrames : 512,
      midiMappings: parsed.midiMappings ?? [],
      keyMappings: Array.isArray(parsed.keyMappings) ? parsed.keyMappings : []
    };
    validateSettings(migrated);
    settings = migrated;
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`No se pudo cargar la configuración: ${error.message}`);
    await saveSettings({ ...DEFAULT_SETTINGS, midiMappings: [] });
  }
}

function getAudioEnginePath() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'native', 'compas-audio.exe');
  return path.join(__dirname, 'native', 'build', 'Release', 'compas-audio.exe');
}

async function listAudioDevices(api) {
  if (!['asio', 'wasapi'].includes(api)) throw new Error('API de audio no reconocida.');
  const { stdout } = await execFileAsync(getAudioEnginePath(), ['--list-devices', api], {
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  const result = JSON.parse(stdout);
  if (!Array.isArray(result.devices)) throw new Error('El motor devolvió una lista de dispositivos inválida.');
  return result.devices;
}

function stopAudioEngineProcess() {
  if (audioEngineProcess && !audioEngineProcess.killed) {
    audioEngineProcess.stdin.end('{"action":"shutdown"}\n');
    audioEngineProcess.kill();
  }
  audioEngineProcess = null;
  audioEngineReadyPromise = null;
  resolveAudioEngineReady = null;
  rejectAudioEngineReady = null;
}

function ensureAudioEngine() {
  if (audioEngineProcess && !audioEngineProcess.killed && audioEngineReadyPromise) {
    return audioEngineReadyPromise;
  }

  const child = spawn(getAudioEnginePath(), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  audioEngineProcess = child;
  audioEngineReadyPromise = new Promise((resolve, reject) => {
    resolveAudioEngineReady = resolve;
    rejectAudioEngineReady = reject;
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8192); });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      const event = JSON.parse(line);
      if (event.event === 'ready') resolveAudioEngineReady?.();
      else if (window && !window.isDestroyed()) window.webContents.send('audio:event', event);
    } catch (error) {
      if (window && !window.isDestroyed()) {
        window.webContents.send('audio:event', {
          event: 'error',
          message: `Respuesta inválida del motor de audio: ${error.message}`
        });
      }
    }
  });
  child.once('error', (error) => {
    rejectAudioEngineReady?.(error);
    if (window && !window.isDestroyed()) {
      window.webContents.send('audio:event', { event: 'error', message: `No se pudo iniciar el motor de audio: ${error.message}` });
    }
  });
  child.once('exit', (code) => {
    if (audioEngineProcess !== child) return;
    audioEngineProcess = null;
    audioEngineReadyPromise = null;
    const message = code === 0 ? 'El motor de audio se cerró.' : `El motor de audio finalizó (${stderr.trim() || `código ${code}`}).`;
    if (window && !window.isDestroyed()) window.webContents.send('audio:event', { event: 'engine-exit', message });
  });
  return audioEngineReadyPromise;
}

function validateTrackMix(song, trackMix) {
  if (!Array.isArray(trackMix) || trackMix.length !== song.tracks.length) {
    throw new Error('La mezcla no coincide con las pistas de la canción.');
  }
  const entries = new Map(trackMix.map((item) => [item.id, item]));
  return song.tracks.map((track) => {
    const item = entries.get(track.id);
    if (!item
      || typeof item.volume !== 'number' || !Number.isFinite(item.volume) || item.volume < 0 || item.volume > 1
      || typeof item.pan !== 'number' || !Number.isFinite(item.pan) || item.pan < -1 || item.pan > 1
      || !Number.isInteger(item.outputChannel) || item.outputChannel < -64 || item.outputChannel > 63
      || typeof item.pitchEnabled !== 'boolean') {
      throw new Error('Una pista contiene una asignación de mezcla inválida.');
    }
    return {
      id: track.id,
      name: track.name,
      path: track.path,
      volume: item.volume,
      pan: item.pan,
      outputChannel: item.outputChannel,
      pitchEnabled: item.pitchEnabled
    };
  });
}

async function addTrackCacheKeys(tracks, sampleRate) {
  return Promise.all(tracks.map(async (track) => {
    const stat = await fs.stat(track.path);
    if (!stat.isFile()) throw new Error(`El archivo de audio «${track.name}» ya no está disponible.`);
    const cacheKey = createHash('sha256').update(JSON.stringify({
      path: path.resolve(track.path),
      size: stat.size,
      modified: stat.mtimeMs,
      sampleRate
    })).digest('hex');
    return { ...track, cacheKey };
  }));
}

async function sendAudioCommand(command) {
  if (!command || typeof command.action !== 'string') throw new Error('Comando de audio inválido.');
  const allowedActions = new Set(['play', 'pause', 'resume', 'stop', 'seek', 'mix', 'status']);
  if (!allowedActions.has(command.action)) throw new Error('Comando de audio no permitido.');
  await ensureAudioEngine();

  let payload = { action: command.action };
  if (command.action === 'play' || command.action === 'mix') {
    const song = library.songs.find((item) => item.id === command.songId);
    if (!song) throw new Error('La canción solicitada ya no está en la biblioteca.');
    const setlist = library.setlists.find((item) => item.id === command.setlistId && item.songIds.includes(song.id));
    if (!setlist) throw new Error('Selecciona el setlist que contiene esta canción.');
    const tracks = validateTrackMix(song, command.tracks);
    const masterVolume = command.masterVolume;
    if (typeof masterVolume !== 'number' || !Number.isFinite(masterVolume) || masterVolume < 0 || masterVolume > 1) {
      throw new Error('El volumen maestro no es válido.');
    }
    const setlistVolume = command.setlistVolume;
    if (typeof setlistVolume !== 'number' || !Number.isFinite(setlistVolume) || setlistVolume < 0 || setlistVolume > 1) {
      throw new Error('El volumen maestro del setlist no es válido.');
    }
    const metronome = song.metronome;
    if (command.action === 'mix') {
      payload = { action: 'mix', masterVolume, setlistVolume, metronome, tracks };
    } else {
      const deviceId = Number(settings.selectedAudioDevice);
      if (!Number.isInteger(deviceId) || deviceId < 0) throw new Error('Selecciona un dispositivo de salida en Configuración.');
      if (typeof command.startOffsetSeconds !== 'number'
        || !Number.isFinite(command.startOffsetSeconds)
        || command.startOffsetSeconds < 0) {
        throw new Error('La posición inicial de la canción no es válida.');
      }
      const pitchSemitones = song.pitchSemitones;
      const tracksWithCache = await addTrackCacheKeys(tracks, settings.selectedSampleRate);
      payload = {
        action: 'play',
        songId: song.id,
        api: settings.selectedAudioApi,
        deviceId,
        sampleRate: settings.selectedSampleRate,
        bufferFrames: settings.bufferFrames,
        cacheDirectory: path.join(app.getPath('userData'), 'audio-cache'),
        clickOnly: song.clickOnly,
        startOffsetSeconds: command.startOffsetSeconds,
        pitchSemitones,
        targetBpm: song.bpm,
        masterVolume,
        setlistVolume,
        metronome,
        tracks: tracksWithCache
      };
    }
  } else if (command.action === 'seek') {
    if (!Number.isSafeInteger(command.positionFrames) || command.positionFrames < 0) {
      throw new Error('La posición solicitada no es válida.');
    }
    payload.positionFrames = command.positionFrames;
  }

  return new Promise((resolve, reject) => {
    audioEngineProcess.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
      if (error) reject(new Error(`No se pudo enviar el comando al motor de audio: ${error.message}`));
      else resolve(true);
    });
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 850,
    minHeight: 640,
    backgroundColor: '#0c1118',
    title: 'Compás — Reproductor multitrack en vivo',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('library:load', () => library);
ipcMain.handle('settings:load', () => settings);
ipcMain.handle('settings:save', async (_event, nextSettings) => {
  await saveSettings(nextSettings);
  return settings;
});
ipcMain.handle('audio:list-devices', (_event, api) => listAudioDevices(api));
ipcMain.handle('audio:command', (_event, command) => sendAudioCommand(command));

ipcMain.handle('library:import', async (_event, metadata) => {
  if (!metadata || typeof metadata !== 'object'
    || typeof metadata.name !== 'string' || metadata.name.trim().length === 0 || metadata.name.trim().length > 120
    || typeof metadata.artist !== 'string' || metadata.artist.trim().length === 0 || metadata.artist.trim().length > 120
    || !Number.isInteger(metadata.bpm) || metadata.bpm < 30 || metadata.bpm > 300
    || typeof metadata.key !== 'string' || !MUSICAL_KEYS.has(metadata.key)) {
    throw new Error('Completa el nombre, artista, BPM (30–300) y tonalidad antes de importar.');
  }

  const result = await dialog.showOpenDialog(window, {
    title: 'Importar pistas de una canción',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio compatible (WAV, MP3, FLAC, OGG/Vorbis)', extensions: [...PLAYABLE_AUDIO_EXTENSIONS].map((extension) => extension.slice(1)) }]
  });
  if (result.canceled) return null;

  const files = [];
  for (const filePath of result.filePaths) {
    if (!PLAYABLE_AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) continue;
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) continue;
    files.push({ path: filePath, name: path.basename(filePath, path.extname(filePath)) });
  }
  if (files.length === 0) throw new Error('No se seleccionaron archivos de audio compatibles.');

  const song = {
    id: randomUUID(),
    name: metadata.name.trim(),
    artist: metadata.artist.trim(),
    bpm: metadata.bpm,
    key: metadata.key,
    clickOnly: false,
    pitchSemitones: 0,
    pitchTargetKey: metadata.key,
    markers: [],
    regions: [],
    metronome: { ...DEFAULT_METRONOME, bpm: metadata.bpm },
    tracks: files.map((file) => ({
      id: randomUUID(),
      name: file.name,
      path: file.path,
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      outputChannel: -1,
      pitchEnabled: true
    }))
  };
  await saveLibrary({ ...library, songs: [...library.songs, song] });
  return song;
});

ipcMain.handle('library:create-click-song', async (_event, name) => {
  if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 120) {
    throw new Error('Escribe un nombre de hasta 120 caracteres para la canción.');
  }
  const song = {
    id: randomUUID(),
    name: name.trim(),
    artist: '',
    bpm: DEFAULT_METRONOME.bpm,
    key: '',
    clickOnly: true,
    pitchSemitones: 0,
    pitchTargetKey: '',
    markers: [],
    regions: [],
    metronome: { ...DEFAULT_METRONOME, enabled: true },
    tracks: []
  };
  await saveLibrary({ ...library, songs: [...library.songs, song] });
  return song;
});

ipcMain.handle('library:delete-song', async (_event, songId) => {
  if (typeof songId !== 'string') throw new Error('La canción que quieres eliminar no es válida.');
  const song = library.songs.find((item) => item.id === songId);
  if (!song) throw new Error('La canción ya no está en la biblioteca.');
  await saveLibrary({
    songs: library.songs.filter((item) => item.id !== songId),
    setlists: library.setlists.map((setlist) => ({
      ...setlist,
      songIds: setlist.songIds.filter((id) => id !== songId)
    }))
  });
  return library;
});

ipcMain.handle('setlist:export', async (_event, setlistId) => {
  const setlist = library.setlists.find((item) => item.id === setlistId);
  if (!setlist) throw new Error('Selecciona un setlist válido para exportar.');

  const songs = setlist.songIds.map((id) => library.songs.find((song) => song.id === id));
  if (songs.some((song) => !song)) throw new Error('El setlist contiene una canción que ya no está en la biblioteca.');
  const tracks = songs.flatMap((song) => song.tracks);
  let rootDirectory = '';

  if (tracks.length > 0) {
    const rootResult = await dialog.showOpenDialog(window, {
      title: 'Selecciona la carpeta raíz que contiene las pistas',
      properties: ['openDirectory']
    });
    if (rootResult.canceled || rootResult.filePaths.length === 0) return null;
    rootDirectory = path.resolve(rootResult.filePaths[0]);
  }

  const exportedSongs = [];
  for (const song of songs) {
    const exportedTracks = [];
    for (const track of song.tracks) {
      const absolutePath = path.resolve(track.path);
      if (rootDirectory) {
        const relativePath = path.relative(rootDirectory, absolutePath);
        if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
          throw new Error(`La pista «${track.name}» no está dentro de la carpeta raíz seleccionada.`);
        }
        try {
          const stat = await fs.stat(absolutePath);
          if (!stat.isFile()) throw new Error('no es un archivo');
        } catch (error) {
          throw new Error(`No se puede exportar «${track.name}»: ${error.message}`);
        }
        exportedTracks.push({ ...track, relativePath });
      } else {
        exportedTracks.push({ ...track, relativePath: '' });
      }
    }
    exportedSongs.push({ ...song, tracks: exportedTracks });
  }

  const defaultName = `${setlist.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.compas`;
  const saveResult = await dialog.showSaveDialog(window, {
    title: 'Exportar setlist Compás',
    defaultPath: defaultName,
    filters: [{ name: 'Setlist Compás', extensions: ['compas'] }]
  });
  if (saveResult.canceled || !saveResult.filePath) return null;

  const document = {
    format: 'compas-setlist',
    version: 1,
    setlist,
    songs: exportedSongs
  };
  await fs.writeFile(saveResult.filePath, JSON.stringify(document, null, 2), 'utf8');
  return saveResult.filePath;
});

ipcMain.handle('setlist:import', async () => {
  const openResult = await dialog.showOpenDialog(window, {
    title: 'Importar setlist Compás',
    properties: ['openFile'],
    filters: [{ name: 'Setlist Compás', extensions: ['compas'] }]
  });
  if (openResult.canceled || openResult.filePaths.length === 0) return null;

  let document;
  try {
    document = JSON.parse(await fs.readFile(openResult.filePaths[0], 'utf8'));
  } catch (error) {
    throw new Error(`No se pudo leer el setlist: ${error.message}`);
  }
  if (!document || document.format !== 'compas-setlist' || document.version !== 1
    || !document.setlist || typeof document.setlist.id !== 'string'
    || typeof document.setlist.name !== 'string' || !Array.isArray(document.setlist.songIds)
    || !Array.isArray(document.songs)
    || document.songs.some((song) => !song || typeof song.id !== 'string'
      || typeof song.name !== 'string' || !Array.isArray(song.tracks))) {
    throw new Error('El archivo no es un setlist Compás compatible.');
  }

  const sourceIds = new Set(document.songs.map((song) => song?.id));
  if (sourceIds.size !== document.songs.length
    || document.setlist.songIds.some((id) => !sourceIds.has(id))) {
    throw new Error('El archivo contiene un setlist con canciones inválidas.');
  }

  const trackEntries = document.songs.flatMap((song) => (Array.isArray(song?.tracks) ? song.tracks : []));
  let resolvedTracks = new Map();
  if (trackEntries.length > 0) {
    const missingTracks = [];
    for (const track of trackEntries) {
      if (!track || typeof track.id !== 'string' || typeof track.relativePath !== 'string'
        || !track.relativePath || path.isAbsolute(track.relativePath)
        || path.normalize(track.relativePath).split(path.sep).some((part) => part === '..')
        || !PLAYABLE_AUDIO_EXTENSIONS.has(path.extname(track.relativePath).toLowerCase())) {
        throw new Error('El archivo del setlist contiene una ruta de pista inválida.');
      }
      if (isAudioPath(track.path)) {
        try {
          const stat = await fs.stat(track.path);
          if (stat.isFile()) {
            resolvedTracks.set(track, track.path);
            continue;
          }
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
        }
      }
      missingTracks.push(track);
    }

    while (missingTracks.length > 0) {
      const rootResult = await dialog.showOpenDialog(window, {
        title: 'Selecciona la carpeta raíz de las pistas del setlist',
        properties: ['openDirectory']
      });
      if (rootResult.canceled || rootResult.filePaths.length === 0) return null;
      const rootDirectory = path.resolve(rootResult.filePaths[0]);
      const missing = [];

      for (const track of missingTracks) {
        const candidate = path.resolve(rootDirectory, track.relativePath);
        const relative = path.relative(rootDirectory, candidate);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new Error('El archivo del setlist intenta acceder fuera de la carpeta de pistas.');
        }
        try {
          const stat = await fs.stat(candidate);
          if (!stat.isFile()) throw new Error('no es un archivo');
          resolvedTracks.set(track, candidate);
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
          missing.push(track.relativePath);
        }
      }

      if (missing.length === 0) break;
      for (const track of missingTracks) resolvedTracks.delete(track);
      const response = await dialog.showMessageBox(window, {
        type: 'warning',
        title: 'Faltan pistas del setlist',
        message: `No se encontraron ${missing.length} pista(s) en esa carpeta.`,
        detail: missing.slice(0, 12).join('\n'),
        buttons: ['Relocalizar carpeta raíz', 'Cancelar'],
        defaultId: 0,
        cancelId: 1
      });
      if (response.response !== 0) return null;
    }
  }

  const songIdMap = new Map(document.songs.map((song) => [song.id, randomUUID()]));
  const importedSongs = document.songs.map((song) => ({
    ...song,
    id: songIdMap.get(song.id),
    tracks: song.tracks.map((track) => ({
      ...track,
      id: randomUUID(),
      path: resolvedTracks.get(track)
    }))
  }));
  const importedSetlist = {
    ...document.setlist,
    id: randomUUID(),
    songIds: document.setlist.songIds.map((id) => songIdMap.get(id))
  };
  const importedLibrary = {
    songs: [...library.songs, ...importedSongs],
    setlists: [...library.setlists, importedSetlist]
  };
  validateLibrary(migrateLibrary(importedLibrary));
  await saveLibrary(migrateLibrary(importedLibrary));
  return { setlistId: importedSetlist.id, name: importedSetlist.name, songCount: importedSongs.length };
});

ipcMain.handle('library:save', async (_event, nextLibrary) => {
  validateLibrary(nextLibrary);
  const knownPaths = new Set(allowedTrackPaths);
  for (const song of nextLibrary.songs) {
    for (const track of song.tracks) {
      if (!knownPaths.has(track.path)) throw new Error('No se puede asociar una pista que no se importó desde la app.');
    }
  }
  await saveLibrary(nextLibrary);
  return library;
});

ipcMain.handle('track:read', async (_event, filePath) => {
  if (!allowedTrackPaths.has(filePath) || !isAudioPath(filePath)) {
    throw new Error('La pista solicitada no pertenece a la biblioteca.');
  }
  return new Uint8Array(await fs.readFile(filePath));
});

app.whenReady().then(async () => {
  libraryPath = path.join(app.getPath('userData'), LIBRARY_FILE);
  settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);
  await loadLibrary();
  await loadSettings();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  dialog.showErrorBox('No se pudo iniciar Multitracks Live', error.message);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopAudioEngineProcess);
