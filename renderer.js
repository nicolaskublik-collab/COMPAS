const elements = {
  setlistsButton: document.querySelector('#setlists-button'),
  libraryButton: document.querySelector('#library-button'),
  setlistCards: document.querySelector('#setlist-cards'),
  setlistOverviewCount: document.querySelector('#setlist-overview-count'),
  createSetlistHeading: document.querySelector('#create-setlist-heading'),
  setlistDetailTitle: document.querySelector('#setlist-detail-title'),
  setlistDetailDescription: document.querySelector('#setlist-detail-description'),
  setlistSongsList: document.querySelector('#setlist-songs-list'),
  setlistSongCount: document.querySelector('#setlist-song-count'),
  setlistAddSongs: document.querySelector('#setlist-add-songs'),
  importSetlistButton: document.querySelector('#import-setlist-button'),
  exportSetlistButton: document.querySelector('#export-setlist-button'),
  libraryReturn: document.querySelector('.library-return'),
  activeSetlistSelect: document.querySelector('#active-setlist-select'),
  openCurrentSetlist: document.querySelector('#open-current-setlist'),
  setlistQueueHeading: document.querySelector('[data-setlist-queue-heading]'),
  currentViewLabel: document.querySelector('[data-current-view-label]'),
  waveformCanvas: document.querySelector('#song-waveform'),
  waveformStatus: document.querySelector('#waveform-status'),
  cueName: document.querySelector('#cue-name'),
  addMarkerButton: document.querySelector('#add-marker-button'),
  regionStartButton: document.querySelector('#region-start-button'),
  regionEndButton: document.querySelector('#region-end-button'),
  regionStartStatus: document.querySelector('#region-start-status'),
  songMarkers: document.querySelector('#song-markers'),
  songRegions: document.querySelector('#song-regions'),
  libraryResultsList: document.querySelector('#library-results-list'),
  libraryResultsCount: document.querySelector('#library-results-count'),
  librarySearch: document.querySelector('#library-search'),
  libraryFilterArtist: document.querySelector('#library-filter-artist'),
  libraryFilterBpm: document.querySelector('#library-filter-bpm'),
  libraryFilterKey: document.querySelector('#library-filter-key'),
  importSongDialog: document.querySelector('#import-song-dialog'),
  importSongForm: document.querySelector('.song-import-form'),
  importSongName: document.querySelector('#import-song-name'),
  importSongArtist: document.querySelector('#import-song-artist'),
  importSongBpm: document.querySelector('#import-song-bpm'),
  importSongKey: document.querySelector('#import-song-key'),
  importSongFiles: document.querySelector('#import-song-files'),
  saveImportedSongButton: document.querySelector('#save-imported-song-button'),
  setlistList: document.querySelector('#setlist-list'),
  setlistForm: document.querySelector('[data-create-setlist-form]'),
  setlistName: document.querySelector('#setlist-name'),
  clickSongForm: document.querySelector('[data-create-click-song-form]'),
  clickSongTitle: document.querySelector('#click-song-title'),
  songTitle: document.querySelector('#song-title'),
  songMeta: document.querySelector('#song-meta'),
  songPitch: document.querySelector('#song-pitch'),
  songPitchValue: document.querySelector('[data-song-pitch-value]'),
  songKeySource: document.querySelector('#song-key-source'),
  playButton: document.querySelector('#play-button'),
  stopButton: document.querySelector('#stop-button'),
  restartButton: document.querySelector('#restart-button'),
  position: document.querySelector('#position-display'),
  progress: document.querySelector('#progress-bar'),
  duration: document.querySelector('[data-duration]'),
  masterVolume: document.querySelector('#master-volume'),
  masterVolumeValue: document.querySelector('[data-master-volume-value]'),
  setlistMasterVolume: document.querySelector('#setlist-master-volume'),
  setlistMasterVolumeValue: document.querySelector('[data-setlist-master-volume-value]'),
  trackList: document.querySelector('#track-list'),
  trackCount: document.querySelector('[data-track-count]'),
  status: document.querySelector('#status-message'),
  clickBpm: document.querySelector('#click-bpm'),
  clickBeats: document.querySelector('#click-beats'),
  clickStatus: document.querySelector('[data-click-status]'),
  settingsButton: document.querySelector('#settings-button'),
  helpButton: document.querySelector('.help-button'),
  moreButton: document.querySelector('.more-button'),
  helpDialog: document.querySelector('#app-help-dialog'),
  closeHelpDialog: document.querySelector('#close-help-dialog'),
  playerView: document.querySelector('#player-view'),
  settingsView: document.querySelector('#settings-view'),
  settingsReturnButton: document.querySelector('.settings-return'),
  mixerPanel: document.querySelector('.mixer-panel'),
  audioApiSelect: document.querySelector('#audio-api-select'),
  asioDriverSelect: document.querySelector('#asio-driver-select'),
  audioSampleRate: document.querySelector('#audio-sample-rate'),
  audioBufferSize: document.querySelector('#audio-buffer-size'),
  refreshAudioDevices: document.querySelector('#refresh-audio-devices'),
  audioDriverStatus: document.querySelector('#audio-driver-status'),
  asioChannelStatus: document.querySelector('#asio-channel-status'),
  midiEnableButton: document.querySelector('#midi-enable-button'),
  midiInputSelect: document.querySelector('#midi-input-select'),
  midiLearnAction: document.querySelector('#midi-learn-action'),
  midiLearnButton: document.querySelector('#midi-learn-button'),
  midiCancelLearn: document.querySelector('#midi-cancel-learn'),
  midiStatus: document.querySelector('#midi-status'),
  midiMappingsList: document.querySelector('#midi-mappings-list'),
  keyboardLearnAction: document.querySelector('#keyboard-learn-action'),
  keyboardLearnButton: document.querySelector('#keyboard-learn-button'),
  keyboardCancelLearn: document.querySelector('#keyboard-cancel-learn'),
  keyboardStatus: document.querySelector('#keyboard-status'),
  keyboardMappingsList: document.querySelector('#keyboard-mappings-list'),
  audioRouteStatus: document.querySelector('#audio-route-status')
};

const state = {
  library: { songs: [], setlists: [] },
  selectedSongId: null,
  activeSetlistId: null,
  isPlaying: false,
  startedAt: 0,
  offset: 0,
  duration: 0,
  timer: null,
  saveTimer: null,
  settings: { selectedAudioApi: 'asio', selectedAudioDevice: '', selectedSampleRate: 0, bufferFrames: 512, midiMappings: [], keyMappings: [] },
  audioDevices: [],
  audioPrepared: false,
  pitchRefreshTimer: null,
  lastStatusRequest: 0,
  midiAccess: null,
  midiLearningAction: null,
  midiLearningInputId: null,
  keyLearningAction: null,
  pendingRegionStart: null,
  loopRegionId: null,
  midiLastValues: new Map(),
  importInProgress: false,
  settingsReturnHash: '#setlists-view',
  waveformTracks: [],
  trackTempoAnalysis: [],
  waveformDuration: 0,
  waveformLastDraw: 0,
  pendingSongSwitch: null,
  lastCacheWarning: ''
};

if (!window.location.hash) window.location.hash = 'setlists-view';

const TRACK_COLORS = ['#c1f06b', '#e9a86e', '#92a7ea', '#d28de1', '#77c9b9', '#ec8585'];

function drawWaveform(force = false) {
  const canvas = elements.waveformCanvas;
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return;
  const now = performance.now();
  if (!force && now - state.waveformLastDraw < 90) return;
  state.waveformLastDraw = now;

  const scale = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.round(bounds.width * scale);
  const height = Math.round(bounds.height * scale);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    force = true;
  }
  const context = canvas.getContext('2d');
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  context.fillStyle = '#111513';
  context.fillRect(0, 0, bounds.width, bounds.height);

  const left = 54;
  const right = bounds.width - 12;
  const top = 10;
  const bottom = bounds.height - 19;
  const plotWidth = Math.max(0, right - left);
  const rows = state.waveformTracks;
  const song = selectedSong();
  if (state.waveformDuration > 0 && song) {
    for (const region of song.regions ?? []) {
      const start = left + plotWidth * Math.min(1, region.start / state.waveformDuration);
      const end = left + plotWidth * Math.min(1, region.end / state.waveformDuration);
      context.fillStyle = region.id === state.loopRegionId ? '#c1f06b24' : '#c1f06b12';
      context.fillRect(start, top, Math.max(1, end - start), bottom - top);
    }
  }
  if (!rows.length) {
    context.fillStyle = '#778178';
    context.font = '11px Segoe UI, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(song?.clickOnly
      ? 'El click no contiene pistas de audio para mostrar.'
      : 'Pulsa Reproducir para preparar el espectro de las pistas.',
    bounds.width / 2, bounds.height / 2);
    return;
  }

  const rowHeight = (bottom - top) / rows.length;
  context.font = '9px Segoe UI, sans-serif';
  rows.forEach((track, rowIndex) => {
    const rowTop = top + rowIndex * rowHeight;
    const center = rowTop + rowHeight / 2;
    context.fillStyle = '#9aa49b';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    const label = track.name.length > 10 ? `${track.name.slice(0, 9)}…` : track.name;
    context.fillText(label, left - 8, center, left - 12);
    context.strokeStyle = '#29312c';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left, center);
    context.lineTo(right, center);
    context.stroke();

    const values = track.values;
    if (!Array.isArray(values) || values.length === 0 || plotWidth <= 0) return;
    const amplitude = Math.max(2, Math.min(12, rowHeight * 0.43));
    context.strokeStyle = TRACK_COLORS[rowIndex % TRACK_COLORS.length];
    context.globalAlpha = 0.9;
    context.beginPath();
    for (let x = 0; x < Math.floor(plotWidth); x += 1) {
      const bin = Math.min(values.length - 1, Math.floor(x * values.length / plotWidth));
      const level = Math.min(1, Math.sqrt(Math.max(0, values[bin])));
      const half = level * amplitude;
      context.moveTo(left + x + 0.5, center - half);
      context.lineTo(left + x + 0.5, center + half);
    }
    context.stroke();
    context.globalAlpha = 1;
  });

  for (let index = 0; index <= 4; index += 1) {
    const x = left + plotWidth * index / 4;
    context.strokeStyle = '#ffffff10';
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.stroke();
    context.fillStyle = '#758077';
    context.font = '8px Consolas, monospace';
    context.textAlign = index === 0 ? 'left' : index === 4 ? 'right' : 'center';
    context.textBaseline = 'bottom';
    context.fillText(formatTime(state.waveformDuration * index / 4), x, bounds.height - 1);
  }

  if (state.waveformDuration > 0) {
    for (const marker of song?.markers ?? []) {
      const markerX = left + plotWidth * Math.min(1, marker.position / state.waveformDuration);
      context.strokeStyle = '#f2c879';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(markerX, top);
      context.lineTo(markerX, bottom);
      context.stroke();
    }
    const position = Math.min(state.waveformDuration, currentPosition());
    const x = left + plotWidth * position / state.waveformDuration;
    context.strokeStyle = '#f2f5ee';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(x, 3);
    context.lineTo(x, bottom);
    context.stroke();
    context.fillStyle = '#f2f5ee';
    context.beginPath();
    context.arc(x, 4, 3, 0, Math.PI * 2);
    context.fill();
  }
}

function setStatus(message) {
  elements.status.textContent = message;
}

function selectedSong() {
  return state.library.songs.find((song) => song.id === state.selectedSongId) ?? null;
}

function activeSetlist() {
  return state.library.setlists.find((setlist) => setlist.id === state.activeSetlistId) ?? null;
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safeSeconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

function escapeText(value) {
  const span = document.createElement('span');
  span.textContent = value;
  return span.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}

function keyLabel(key) {
  return key ? key.replace(/#/g, '♯').replace(/b/g, '♭').replace(/m$/, ' menor') : 'Tonalidad pendiente';
}

function semitonesBetweenKeys(source, target) {
  const roots = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  if (!source || !target || source.endsWith('m') !== target.endsWith('m')) return 0;
  const sourceRoot = source.replace(/m$/, '');
  const targetRoot = target.replace(/m$/, '');
  const difference = roots[targetRoot] - roots[sourceRoot];
  return ((difference + 18) % 12) - 6;
}

function renderSongs() {
  renderLibraryResults();
}

function isSongInActiveSetlist(songId) {
  const setlist = state.library.setlists.find((item) => item.id === state.activeSetlistId);
  return Boolean(setlist?.songIds.includes(songId));
}

function openSetlist(setlistId) {
  const setlist = state.library.setlists.find((item) => item.id === setlistId);
  if (!setlist) return;
  const wasPlaying = state.isPlaying;
  state.activeSetlistId = setlist.id;
  const keepsCurrentSong = setlist.songIds.includes(state.selectedSongId);
  if (!keepsCurrentSong) {
    const nextSongId = setlist.songIds[0] ?? null;
    if (wasPlaying && nextSongId) {
      chooseSong(nextSongId);
      return;
    }
    if (wasPlaying || state.audioPrepared) stopPlayback();
    state.selectedSongId = null;
    state.offset = 0;
    state.duration = 0;
    state.waveformTracks = [];
    state.trackTempoAnalysis = [];
  }
  renderAll();
  window.location.hash = wasPlaying ? 'player-view' : 'setlist-detail-view';
  setStatus(`Setlist «${setlist.name}» seleccionado.`);
}

function renderSetlistDetail() {
  const setlist = state.library.setlists.find((item) => item.id === state.activeSetlistId);
  elements.setlistSongsList.replaceChildren();
  if (!setlist) {
    elements.setlistDetailTitle.textContent = 'Elige un setlist';
    elements.setlistDetailDescription.textContent = 'Crea o selecciona una lista para organizar sus canciones.';
    elements.setlistSongCount.textContent = '0';
    elements.setlistAddSongs.setAttribute('aria-label', 'Explorar canciones de la biblioteca');
    elements.setlistSongsList.innerHTML = '<li class="setlist-empty">Selecciona un setlist para ver sus canciones.</li>';
    return;
  }

  const songs = setlist.songIds
    .map((songId) => state.library.songs.find((song) => song.id === songId))
    .filter(Boolean);
  elements.setlistDetailTitle.textContent = setlist.name;
  elements.setlistDetailDescription.textContent = songs.length === 1
    ? '1 canción en este setlist. Selecciónala para abrirla.'
    : `${songs.length} canciones en este setlist. Selecciona una para abrirla.`;
  elements.setlistSongCount.textContent = String(songs.length);
  elements.setlistAddSongs.setAttribute('aria-label', `Explorar canciones para agregar a ${setlist.name}`);

  if (songs.length === 0) {
    elements.setlistSongsList.innerHTML = '<li class="setlist-empty">Este setlist todavía está vacío. Usa «Explorar canciones» para agregar temas de tu biblioteca.</li>';
    return;
  }

  songs.forEach((song, index) => {
    const item = document.createElement('li');
    item.className = 'setlist-song-item';
    const playButton = document.createElement('button');
    playButton.className = 'setlist-song-play';
    playButton.type = 'button';
    playButton.dataset.playSetlistSongId = song.id;
    playButton.setAttribute('aria-label', `Abrir ${song.name} en el reproductor`);
    const order = document.createElement('span');
    order.className = 'setlist-song-order';
    order.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('span');
    copy.className = 'setlist-song-copy';
    const title = document.createElement('strong');
    title.textContent = song.name;
    const metadata = document.createElement('span');
    metadata.textContent = song.clickOnly
      ? 'Solo click'
      : [song.artist, song.bpm ? `${song.bpm} BPM` : '', song.key ? keyLabel(song.key) : ''].filter(Boolean).join(' · ');
    copy.append(title, metadata);
    const play = document.createElement('span');
    play.className = 'setlist-song-open';
    play.setAttribute('aria-hidden', 'true');
    play.textContent = 'Abrir mezcla →';
    playButton.append(order, copy, play);

    const removeButton = document.createElement('button');
    removeButton.className = 'setlist-song-remove';
    removeButton.type = 'button';
    removeButton.dataset.removeSetlistSongId = song.id;
    removeButton.textContent = 'Quitar';
    removeButton.setAttribute('aria-label', `Quitar ${song.name} de ${setlist.name}`);
    const reorder = document.createElement('span');
    reorder.className = 'setlist-song-reorder';
    for (const [direction, label, title] of [[-1, '↑', 'Subir canción'], [1, '↓', 'Bajar canción']]) {
      const moveButton = document.createElement('button');
      moveButton.type = 'button';
      moveButton.dataset.moveSongId = song.id;
      moveButton.dataset.moveDirection = String(direction);
      moveButton.disabled = direction < 0 ? index === 0 : index === songs.length - 1;
      moveButton.textContent = label;
      moveButton.title = title;
      moveButton.setAttribute('aria-label', `${title}: ${song.name}`);
      reorder.append(moveButton);
    }
    item.append(playButton, reorder, removeButton);
    elements.setlistSongsList.append(item);
  });
}

function renderLibraryResults() {
  if (!elements.libraryResultsList) return;
  const query = normalizeSearchText(elements.librarySearch.value);
  const artistFilter = normalizeSearchText(elements.libraryFilterArtist.value);
  const bpmFilter = elements.libraryFilterBpm.value ? Number(elements.libraryFilterBpm.value) : null;
  const keyFilter = elements.libraryFilterKey.value;
  const songs = state.library.songs.filter((song) => {
    const searchable = normalizeSearchText(`${song.name} ${song.artist}`);
    return (!query || searchable.includes(query))
      && (!artistFilter || normalizeSearchText(song.artist).includes(artistFilter))
      && (bpmFilter === null || song.bpm === bpmFilter)
      && (!keyFilter || song.key === keyFilter);
  });

  elements.libraryResultsCount.textContent = String(songs.length);
  elements.libraryResultsList.replaceChildren();
  if (songs.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-library-results';
    empty.textContent = state.library.songs.length === 0
      ? 'Tu biblioteca está vacía. Importa una canción para comenzar.'
      : 'No hay canciones que coincidan con esos filtros.';
    elements.libraryResultsList.append(empty);
    return;
  }

  for (const song of songs) {
    const item = document.createElement('li');
    item.className = 'library-result-item';
    const art = document.createElement('span');
    art.className = 'library-result-art';
    art.setAttribute('aria-hidden', 'true');
    art.textContent = '♫';
    const copy = document.createElement('span');
    copy.className = 'library-result-copy';
    const title = document.createElement('strong');
    title.className = 'library-result-title';
    title.textContent = song.name;
    const metadata = document.createElement('span');
    metadata.className = 'library-result-meta';
    const details = [song.artist || (song.clickOnly ? 'Solo click' : 'Artista pendiente')];
    if (song.bpm) details.push(`${song.bpm} BPM`);
    if (song.key) details.push(keyLabel(song.key));
    metadata.textContent = details.join(' · ');
    copy.append(title, metadata);

    const songInfo = document.createElement('div');
    songInfo.className = 'library-result-select';
    songInfo.append(art, copy);

    const addButton = document.createElement('button');
    addButton.className = 'library-result-add';
    addButton.type = 'button';
    addButton.dataset.addLibrarySongId = song.id;
    const alreadyAdded = isSongInActiveSetlist(song.id);
    addButton.disabled = alreadyAdded;
    addButton.textContent = alreadyAdded ? 'Añadida' : '+';
    addButton.setAttribute('aria-label', alreadyAdded
      ? `${song.name} ya está en el setlist seleccionado`
      : `Añadir ${song.name} al setlist seleccionado`);

    const deleteButton = document.createElement('button');
    deleteButton.className = 'library-delete-button';
    deleteButton.type = 'button';
    deleteButton.dataset.deleteSongId = song.id;
    deleteButton.setAttribute('aria-label', `Eliminar ${song.name} de la biblioteca`);
    deleteButton.title = 'Eliminar de la biblioteca (no borra los archivos)';
    deleteButton.innerHTML = '<svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M4.5 6h11M8 6V4.5h4V6m2.5 0-.6 10H6.1L5.5 6m3 3v4m3-4v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    item.append(songInfo, addButton, deleteButton);
    elements.libraryResultsList.append(item);
  }
}

function renderSetlists() {
  elements.setlistList.replaceChildren();
  const activeSetlist = state.library.setlists.find((item) => item.id === state.activeSetlistId);
  elements.activeSetlistSelect.replaceChildren(new Option('Selecciona un setlist', ''));
  for (const setlist of state.library.setlists) {
    elements.activeSetlistSelect.add(new Option(setlist.name, setlist.id));
  }
  elements.activeSetlistSelect.value = state.activeSetlistId ?? '';
  elements.activeSetlistSelect.disabled = state.library.setlists.length === 0;
  elements.openCurrentSetlist.disabled = !state.activeSetlistId;
  elements.exportSetlistButton.disabled = !activeSetlist;
  elements.openCurrentSetlist.textContent = activeSetlist
    ? `Setlist: ${activeSetlist.name}`
    : 'Setlist actual';
  document.querySelector('.library-count').textContent = String(
    state.library.setlists.find((item) => item.id === state.activeSetlistId)?.songIds.length ?? 0
  );
  elements.setlistOverviewCount.textContent = String(state.library.setlists.length);
  elements.createSetlistHeading.textContent = state.library.setlists.length === 0
    ? 'Crea tu primer setlist'
    : 'Crea otro setlist';
  elements.setlistQueueHeading.textContent = activeSetlist ? 'CANCIONES DE LA LISTA' : 'SELECCIONA UN SETLIST';
  const queueSongs = activeSetlist
    ? activeSetlist.songIds.map((id) => state.library.songs.find((song) => song.id === id)).filter(Boolean)
    : [];
  if (queueSongs.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-setlists';
    empty.textContent = activeSetlist
      ? 'Agrega canciones desde Explorar para verlas aquí.'
      : 'Selecciona un setlist para ver sus canciones.';
    elements.setlistList.append(empty);
  } else {
    queueSongs.forEach((song, index) => {
      const item = document.createElement('li');
      item.className = 'queue-song-item';
      item.setAttribute('aria-current', String(song.id === state.selectedSongId));
      const button = document.createElement('button');
      button.className = 'queue-song-select';
      button.type = 'button';
      button.dataset.playSetlistSongId = song.id;
      button.disabled = Boolean(state.pendingSongSwitch);
      button.setAttribute('aria-label', `Reproducir ${song.name}`);
      const order = document.createElement('span');
      order.className = 'queue-song-order';
      order.textContent = String(index + 1);
      const copy = document.createElement('span');
      copy.className = 'queue-song-copy';
      const title = document.createElement('strong');
      title.textContent = song.name;
      const metadata = document.createElement('span');
      metadata.textContent = song.clickOnly
        ? 'Solo click'
        : [song.bpm ? `${song.bpm} BPM` : '', song.key ? keyLabel(song.key) : ''].filter(Boolean).join(' · ');
      copy.append(title, metadata);
      button.append(order, copy);
      item.append(button);
      elements.setlistList.append(item);
    });
  }
  elements.setlistCards.replaceChildren();
  elements.libraryReturn.href = state.activeSetlistId ? '#setlist-detail-view' : '#setlists-view';
  elements.libraryReturn.textContent = state.activeSetlistId ? 'Volver al setlist' : 'Volver a setlists';
  elements.libraryReturn.setAttribute('aria-controls', state.activeSetlistId ? 'setlist-detail-view' : 'setlists-view');
  if (state.library.setlists.length === 0) {
    elements.setlistCards.innerHTML = '<li class="setlist-overview-empty">Todavía no hay listas. Crea una arriba para empezar.</li>';
  } else {
    for (const setlist of state.library.setlists) {
      const card = document.createElement('li');
      card.className = 'setlist-card';
      const openButton = document.createElement('button');
      openButton.className = 'setlist-card-open';
      openButton.type = 'button';
      openButton.dataset.openSetlistId = setlist.id;
      openButton.setAttribute('aria-label', `Abrir ${setlist.name}`);
      const icon = document.createElement('span');
      icon.className = 'setlist-card-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '♫';
      const copy = document.createElement('span');
      copy.className = 'setlist-card-copy';
      const title = document.createElement('strong');
      title.textContent = setlist.name;
      const description = document.createElement('span');
      description.textContent = `${setlist.songIds.length} ${setlist.songIds.length === 1 ? 'canción' : 'canciones'}`;
      copy.append(title, description);
      const arrow = document.createElement('span');
      arrow.className = 'setlist-card-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      openButton.append(icon, copy, arrow);
      const deleteButton = document.createElement('button');
      deleteButton.className = 'setlist-card-delete';
      deleteButton.type = 'button';
      deleteButton.dataset.deleteSetlistId = setlist.id;
      deleteButton.textContent = 'Eliminar';
      deleteButton.setAttribute('aria-label', `Eliminar setlist ${setlist.name}`);
      card.append(openButton, deleteButton);
      elements.setlistCards.append(card);
    }
  }
  renderSetlistDetail();
}

function deleteSetlist(setlistId) {
  const setlist = state.library.setlists.find((item) => item.id === setlistId);
  if (!setlist || !window.confirm(`¿Eliminar el setlist «${setlist.name}»? Las canciones seguirán en la biblioteca.`)) return;
  if (state.activeSetlistId === setlistId && (state.isPlaying || state.audioPrepared)) stopPlayback();
  state.library.setlists = state.library.setlists.filter((item) => item.id !== setlistId);
  if (state.activeSetlistId === setlistId) {
    state.activeSetlistId = state.library.setlists[0]?.id ?? null;
    state.selectedSongId = null;
    state.waveformTracks = [];
    state.trackTempoAnalysis = [];
    state.duration = 0;
    window.location.hash = 'setlists-view';
  }
  renderAll();
  scheduleSave();
  setStatus(`Setlist «${setlist.name}» eliminado. Las canciones siguen en la biblioteca.`);
}

function addSongMarker() {
  const song = selectedSong();
  if (!song) return;
  const name = (elements.cueName.value.trim() || `Punto ${(song.markers ?? []).length + 1}`).slice(0, 80);
  song.markers ??= [];
  song.markers.push({ id: crypto.randomUUID(), name, position: currentPosition() });
  elements.cueName.value = '';
  renderCues();
  drawWaveform(true);
  scheduleSave();
  setStatus(`Punto «${name}» guardado en ${formatTime(currentPosition())}.`);
}

function setRegionStart() {
  if (!selectedSong()) return;
  state.pendingRegionStart = currentPosition();
  elements.regionStartStatus.textContent = `Inicio: ${formatTime(state.pendingRegionStart)}. Marca el fin.`;
}

function finishSongRegion() {
  const song = selectedSong();
  if (!song || state.pendingRegionStart === null) {
    setStatus('Primero marca el inicio de la región.');
    return;
  }
  const end = currentPosition();
  if (end <= state.pendingRegionStart) {
    setStatus('El final de la región debe estar después del inicio.');
    return;
  }
  const cleanName = (elements.cueName.value.trim() || `Región ${(song.regions ?? []).length + 1}`).slice(0, 80);
  song.regions ??= [];
  const region = { id: crypto.randomUUID(), name: cleanName, start: state.pendingRegionStart, end };
  song.regions.push(region);
  elements.cueName.value = '';
  state.loopRegionId = region.id;
  state.pendingRegionStart = null;
  elements.regionStartStatus.textContent = '';
  renderCues();
  drawWaveform(true);
  scheduleSave();
  setStatus(`Región «${cleanName}» guardada y en repetición.`);
}

function renderCues() {
  const song = selectedSong();
  elements.addMarkerButton.disabled = !song;
  elements.regionStartButton.disabled = !song;
  elements.regionEndButton.disabled = !song;
  elements.regionStartStatus.textContent = state.pendingRegionStart === null
    ? ''
    : `Inicio: ${formatTime(state.pendingRegionStart)}. Marca el fin.`;
  elements.songMarkers.replaceChildren();
  elements.songRegions.replaceChildren();
  if (!song) return;

  for (const marker of song.markers ?? []) {
    const item = document.createElement('li');
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.dataset.seekMarkerId = marker.id;
    jump.textContent = `${marker.name} · ${formatTime(marker.position)}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.removeMarkerId = marker.id;
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Quitar punto ${marker.name}`);
    item.append(jump, remove);
    elements.songMarkers.append(item);
  }
  for (const region of song.regions ?? []) {
    const item = document.createElement('li');
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.dataset.seekRegionId = region.id;
    jump.textContent = `${region.name} · ${formatTime(region.start)}–${formatTime(region.end)}`;
    const loop = document.createElement('button');
    loop.type = 'button';
    loop.dataset.loopRegionId = region.id;
    loop.setAttribute('aria-pressed', String(state.loopRegionId === region.id));
    loop.textContent = state.loopRegionId === region.id ? 'Repitiendo' : 'Repetir';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.removeRegionId = region.id;
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Quitar región ${region.name}`);
    item.append(jump, loop, remove);
    elements.songRegions.append(item);
  }
}

function renderSongHeader() {
  const song = selectedSong();
  if (!song) {
    state.pendingRegionStart = null;
    state.loopRegionId = null;
    elements.songTitle.textContent = 'Selecciona una canción';
    elements.songMeta.textContent = 'Añade pistas a tu biblioteca para empezar';
    elements.trackCount.textContent = '—';
    elements.duration.textContent = '--:--';
    elements.progress.disabled = true;
    elements.songPitch.disabled = true;
    elements.songKeySource.textContent = 'desde —';
    elements.clickBpm.disabled = true;
    elements.clickBeats.disabled = true;
    elements.clickBpm.value = '120';
    elements.clickBeats.value = '4';
    elements.clickStatus.textContent = 'Selecciona una canción';
    elements.trackList.innerHTML = '<div class="tracks-empty"><h3>Las pistas aparecerán aquí</h3><p>Selecciona una canción de tu biblioteca para controlar cada instrumento.</p></div>';
    elements.waveformStatus.textContent = 'Selecciona una canción';
    renderCues();
    drawWaveform(true);
    return;
  }

  elements.songTitle.textContent = song.name;
  song.pitchTargetKey ??= song.key;
  elements.songPitch.disabled = !song.key;
  elements.songKeySource.textContent = `desde ${keyLabel(song.key)}`;
  for (const option of elements.songPitch.options) {
    if (option.value) option.hidden = option.value.endsWith('m') !== song.key.endsWith('m');
  }
  elements.clickBpm.disabled = false;
  elements.clickBeats.disabled = false;
  elements.progress.disabled = song.clickOnly;
  elements.songPitch.value = song.pitchTargetKey || '';
  elements.songPitchValue.value = `${song.pitchSemitones > 0 ? '+' : ''}${song.pitchSemitones} st`;
  elements.clickBpm.value = String(song.bpm);
  elements.clickBeats.value = String(song.metronome.beats);
  updateClickStatus();
  elements.songMeta.textContent = song.clickOnly
    ? 'Solo click · ejecución hasta detener'
    : `${song.artist || 'Artista pendiente'} · ${song.bpm} BPM · ${keyLabel(song.key)} · ${song.tracks.length} pistas`;
  elements.trackCount.textContent = song.clickOnly ? 'CLICK' : `${song.tracks.length} + CLICK`;
  elements.duration.textContent = song.clickOnly ? '∞ · hasta detener' : '--:--';
  elements.waveformStatus.textContent = song.clickOnly
    ? 'Canción solo con click'
    : state.waveformTracks.length
      ? `${state.waveformTracks.length} pistas analizadas`
      : 'Se analiza al iniciar la reproducción';
  renderCues();
  drawWaveform(true);
}

function renderTracks() {
  const song = selectedSong();
  renderSongHeader();
  if (!song) return;

  elements.trackList.replaceChildren();
  if (song.clickOnly) {
    appendClickTrack(song);
    drawWaveform(true);
    return;
  }
  song.tracks.forEach((track, index) => {
    const row = document.createElement('article');
    row.className = 'track-row';
    row.style.setProperty('--track-color', TRACK_COLORS[index % TRACK_COLORS.length]);
    row.innerHTML = `
      <div class="track-identity">
        <span class="track-color" aria-hidden="true"></span>
        <div class="track-copy">
          <div class="track-name" title="${escapeText(track.name)}">${escapeText(track.name)}</div>
          <div class="track-detail">Pista de audio</div>
        </div>
        <label class="track-output-control">
          <span>Salida</span>
          <select data-track-control="outputChannel" data-track-id="${escapeText(track.id)}" aria-label="Salida de ${escapeText(track.name)}">
            ${renderOutputOptions(track.outputChannel ?? -1)}
          </select>
        </label>
        <label class="track-pitch-bypass" title="Desactiva esta opción para conservar el tono original de una guía.">
          <input type="checkbox" data-track-control="pitchEnabled" data-track-id="${escapeText(track.id)}" aria-label="Aplicar pitch de canción a ${escapeText(track.name)}"${track.pitchEnabled === false ? '' : ' checked'}>
          <span>Pitch canción</span>
          <small>Desactiva para proteger la guía</small>
        </label>
      </div>
      <label class="track-control track-volume">
        <span class="track-control-label">Volumen</span>
        <input class="range-input" type="range" min="0" max="100" value="${Math.round(track.volume * 100)}" data-track-control="volume" data-track-id="${escapeText(track.id)}" aria-label="Volumen de ${escapeText(track.name)}">
      </label>
      <label class="track-control track-pan">
        <span class="track-control-label">Pan</span>
        <input class="range-input" type="range" min="-100" max="100" value="${Math.round(track.pan * 100)}" data-track-control="pan" data-track-id="${escapeText(track.id)}" aria-label="Paneo de ${escapeText(track.name)}">
      </label>
      <button class="track-action" type="button" data-track-control="solo" data-track-id="${escapeText(track.id)}" aria-pressed="${track.solo}" aria-label="Solo ${escapeText(track.name)}">S</button>
      <button class="track-action" type="button" data-track-control="muted" data-track-id="${escapeText(track.id)}" aria-pressed="${track.muted}" aria-label="Silenciar ${escapeText(track.name)}">M</button>
    `;
    const analysis = state.trackTempoAnalysis.find((item) => item.id === track.id);
    const detail = row.querySelector('.track-detail');
    if (analysis) {
      detail.textContent = analysis.bpm > 0
        ? `${Math.round(analysis.bpm)} BPM detectados · ${analysis.synced ? 'sincronizada' : 'fuera del rango de ajuste'}`
        : 'No se detectó un pulso fiable';
    }
    elements.trackList.append(row);
  });
  appendClickTrack(song);
  updateSongDuration();
  drawWaveform(true);
}

function appendClickTrack(song) {
  const row = document.createElement('article');
  row.className = 'track-row click-track-row';
  row.innerHTML = `
    <div class="track-identity">
      <span class="track-color" aria-hidden="true"></span>
      <div class="track-copy">
        <div class="track-name">Click</div>
        <div class="track-detail">${song.clickOnly ? 'Solo click' : `${song.metronome.bpm} BPM · ${song.metronome.beats === 6 ? '6/8' : `${song.metronome.beats}/4`}`}</div>
      </div>
      <label class="track-output-control">
        <span>Salida</span>
        <select data-track-control="click-outputChannel" aria-label="Salida del click">
          ${renderOutputOptions(song.metronome.outputChannel ?? -1)}
        </select>
      </label>
    </div>
    <label class="track-control track-volume">
      <span class="track-control-label">Volumen</span>
      <input class="range-input" type="range" min="0" max="100" value="${Math.round(song.metronome.volume * 100)}" data-track-control="click-volume" aria-label="Volumen del click">
    </label>
    <span class="click-track-spacer" aria-hidden="true"></span>
    <button class="track-action click-track-toggle" type="button" data-track-control="click-enabled" aria-pressed="${song.metronome.enabled}" aria-label="${song.metronome.enabled ? 'Silenciar' : 'Activar'} click">C</button>
  `;
  elements.trackList.append(row);
}

function renderAll() {
  renderSongs();
  renderSetlists();
  renderTracks();
  updateSetlistMasterControl();
  updateCurrentViewLabel();
}

function updateSetlistMasterControl() {
  const setlist = activeSetlist();
  const volume = setlist?.masterVolume ?? 1;
  elements.setlistMasterVolume.value = String(Math.round(volume * 100));
  elements.setlistMasterVolume.disabled = !setlist;
  elements.setlistMasterVolumeValue.value = `${Math.round(volume * 100)}%`;
}

function updateCurrentViewLabel() {
  const view = window.location.hash.slice(1);
  const labels = {
    'setlists-view': 'Setlists',
    'setlist-detail-view': state.library.setlists.find((item) => item.id === state.activeSetlistId)?.name ?? 'Setlist',
    'library-view': 'Explorar',
    'player-view': selectedSong()?.name ?? 'Reproducción',
    'settings-view': 'Configuración'
  };
  elements.currentViewLabel.textContent = labels[view] ?? 'Setlists';
}

window.addEventListener('hashchange', updateCurrentViewLabel);

function renderOutputOptions(selectedChannel) {
  const selected = Number.isInteger(selectedChannel) ? selectedChannel : -1;
  const options = [`<option value="-1"${selected === -1 ? ' selected' : ''}>Master · estéreo</option>`];
  const device = state.audioDevices.find((item) => String(item.id) === state.settings.selectedAudioDevice);
  for (let channel = 0; channel < (device?.outputChannels ?? 0); channel += 1) {
    options.push(`<option value="${channel}"${selected === channel ? ' selected' : ''}>Salida ${channel + 1} · mono</option>`);
  }
  for (let channel = 0; channel + 1 < (device?.outputChannels ?? 0); channel += 1) {
    const route = -(channel + 2);
    options.push(`<option value="${route}"${selected === route ? ' selected' : ''}>Salidas ${channel + 1}–${channel + 2} · estéreo</option>`);
  }
  return options.join('');
}

function renderMidiMappings() {
  elements.midiMappingsList.replaceChildren();
  const actionNames = {
    play: 'Reproducir / pausar', stop: 'Detener', next: 'Siguiente canción',
    previous: 'Canción anterior', restart: 'Reiniciar canción', addMarker: 'Agregar punto',
    regionStart: 'Marcar inicio de región', regionEnd: 'Marcar fin de región'
  };
  for (const mapping of state.settings.midiMappings) {
    const item = document.createElement('li');
    const message = mapping.messageType === 'note' ? 'Nota' : 'CC';
    const description = document.createElement('span');
    description.textContent = `${actionNames[mapping.action]} · ${mapping.inputName} · ${message} ${mapping.number}, canal ${mapping.channel + 1}`;
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.dataset.midiRemoveAction = mapping.action;
    removeButton.textContent = 'Quitar';
    removeButton.setAttribute('aria-label', `Quitar asignación de ${actionNames[mapping.action]}`);
    item.append(description, removeButton);
    elements.midiMappingsList.append(item);
  }
  if (state.settings.midiMappings.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'Todavía no hay controles asignados.';
    elements.midiMappingsList.append(item);
  }
}

function renderKeyboardMappings() {
  elements.keyboardMappingsList.replaceChildren();
  const actionNames = {
    play: 'Reproducir / pausar', stop: 'Detener', next: 'Siguiente canción',
    previous: 'Canción anterior', restart: 'Reiniciar canción', addMarker: 'Agregar punto',
    regionStart: 'Marcar inicio de región', regionEnd: 'Marcar fin de región'
  };
  for (const mapping of state.settings.keyMappings) {
    const item = document.createElement('li');
    const description = document.createElement('span');
    const modifiers = [mapping.ctrl && 'Ctrl', mapping.alt && 'Alt', mapping.shift && 'Mayús'].filter(Boolean);
    description.textContent = `${actionNames[mapping.action]} · ${[...modifiers, mapping.code].join(' + ')}`;
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.dataset.keyRemoveAction = mapping.action;
    removeButton.textContent = 'Quitar';
    removeButton.setAttribute('aria-label', `Quitar asignación de ${actionNames[mapping.action]}`);
    item.append(description, removeButton);
    elements.keyboardMappingsList.append(item);
  }
  if (state.settings.keyMappings.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'Todavía no hay asignaciones personalizadas.';
    elements.keyboardMappingsList.append(item);
  }
}

async function persistSettings() {
  try {
    const savedSettings = await window.multitracks.saveSettings(state.settings);
    state.settings = {
      ...state.settings,
      ...savedSettings,
      selectedSampleRate: Number(savedSettings?.selectedSampleRate ?? state.settings.selectedSampleRate) || 0,
      bufferFrames: Number(savedSettings?.bufferFrames ?? state.settings.bufferFrames) || 512,
      midiMappings: Array.isArray(savedSettings?.midiMappings) ? savedSettings.midiMappings : state.settings.midiMappings,
      keyMappings: Array.isArray(savedSettings?.keyMappings) ? savedSettings.keyMappings : state.settings.keyMappings
    };
    renderMidiMappings();
    renderKeyboardMappings();
  } catch (error) {
    setStatus(`No se pudo guardar la configuración: ${error.message}`);
    elements.midiStatus.textContent = `No se pudo guardar: ${error.message}`;
  }
}

async function refreshAsioDrivers() {
  const api = elements.audioApiSelect.value;
  elements.audioDriverStatus.textContent = `Buscando dispositivos ${api.toUpperCase()}…`;
  try {
    const devices = await window.multitracks.listAudioDevices(api);
    state.audioDevices = devices;
    elements.asioDriverSelect.replaceChildren(new Option('Selecciona un dispositivo', ''));
    for (const device of devices) {
      const label = `${device.name} · ${device.outputChannels} salidas${device.isDefault ? ' · predeterminado' : ''}`;
      elements.asioDriverSelect.add(new Option(label, String(device.id)));
    }
    const selected = devices.some((device) => String(device.id) === state.settings.selectedAudioDevice);
    if (!selected) {
      const preferred = devices.find((device) => device.isDefault) ?? devices[0];
      state.settings.selectedAudioDevice = preferred ? String(preferred.id) : '';
    }
    elements.asioDriverSelect.value = state.settings.selectedAudioDevice;
    const device = devices.find((item) => String(item.id) === state.settings.selectedAudioDevice);
    const supportedRates = [...new Set((device?.sampleRates ?? []).filter((rate) => [44100, 48000, 88200, 96000].includes(rate)))];
    if (device && supportedRates.length === 0) supportedRates.push(device.sampleRate);
    elements.audioSampleRate.replaceChildren(new Option('Predeterminada del dispositivo', '0'));
    for (const rate of supportedRates) {
      elements.audioSampleRate.add(new Option(`${rate / 1000} kHz`, String(rate)));
    }
    if (state.settings.selectedSampleRate && !supportedRates.includes(state.settings.selectedSampleRate)) {
      state.settings.selectedSampleRate = 0;
    }
    elements.audioSampleRate.value = String(state.settings.selectedSampleRate);
    elements.audioBufferSize.value = String(state.settings.bufferFrames);
    elements.audioDriverStatus.textContent = devices.length > 0
      ? `${devices.length} dispositivo(s) ${api.toUpperCase()} disponible(s).`
      : `No se encontraron dispositivos ${api.toUpperCase()} de salida.`;
    elements.asioChannelStatus.textContent = device
      ? `${device.name}: ${device.outputChannels} salidas · ${state.settings.selectedSampleRate || device.sampleRate} Hz · búfer ${state.settings.bufferFrames} muestras.`
      : 'Selecciona un dispositivo con salidas disponibles.';
    elements.audioRouteStatus.textContent = device
      ? 'El ruteo por pista ya está disponible: master estéreo, mono o par estéreo.'
      : 'Selecciona un dispositivo para habilitar las salidas por pista.';
    renderTracks();
    await persistSettings();
  } catch (error) {
    elements.audioDriverStatus.textContent = `No se pudieron consultar los dispositivos ${api.toUpperCase()}: ${error.message}`;
  }
}

function refreshMidiInputOptions() {
  if (!state.midiAccess) return;
  for (const input of state.midiAccess.inputs.values()) {
    input.onmidimessage = (event) => handleMidiMessage(input, event);
  }
  const selectedId = elements.midiInputSelect.value;
  elements.midiInputSelect.replaceChildren(new Option('Selecciona una entrada MIDI', ''));
  for (const input of state.midiAccess.inputs.values()) {
    elements.midiInputSelect.add(new Option(input.name || input.manufacturer || input.id, input.id));
  }
  if ([...state.midiAccess.inputs.keys()].includes(selectedId)) {
    elements.midiInputSelect.value = selectedId;
  }
  if (state.midiAccess.inputs.size === 0) {
    elements.midiStatus.textContent = 'No se detectaron entradas MIDI. Conecta un controlador y vuelve a comprobar.';
  } else {
    elements.midiStatus.textContent = `${state.midiAccess.inputs.size} entrada(s) MIDI disponible(s).`;
  }
}

function executeMidiAction(action) {
  if (action === 'play') {
    elements.playButton.click();
    return;
  }
  if (action === 'stop') {
    elements.stopButton.click();
    return;
  }
  if (action === 'next' || action === 'previous') {
    navigateSetlist(action === 'next' ? 1 : -1);
    return;
  }
  if (action === 'restart') {
    restartPlayback();
    return;
  }
  if (action === 'addMarker') addSongMarker();
  else if (action === 'regionStart') setRegionStart();
  else if (action === 'regionEnd') finishSongRegion();
}

function navigateSetlist(direction) {
  const songIds = activeSetlist()?.songIds ?? [];
  const currentIndex = songIds.indexOf(state.selectedSongId);
  const nextId = songIds[currentIndex + direction];
  if (!nextId) {
    setStatus(direction > 0 ? 'No hay otra canción en la lista actual.' : 'Ya estás al inicio del setlist.');
    return;
  }
  chooseSong(nextId);
}

function chooseSongByNumber(number) {
  const songId = activeSetlist()?.songIds[number - 1];
  if (songId) chooseSong(songId);
  else setStatus(`No hay una canción asignada al número ${number} en este setlist.`);
}

function handleMidiMessage(input, event) {
  const [statusByte, number, value] = event.data;
  const command = statusByte & 0xf0;
  const channel = statusByte & 0x0f;
  const isNoteOn = command === 0x90 && value > 0;
  const isControlChange = command === 0xb0;
  const messageType = isNoteOn ? 'note' : isControlChange ? 'cc' : null;
  const messageNumber = number;

  if (state.midiLearningAction && input.id === state.midiLearningInputId && messageType) {
    const mapping = {
      action: state.midiLearningAction,
      inputId: input.id,
      inputName: input.name || input.manufacturer || input.id,
      messageType,
      channel,
      number: messageNumber
    };
    state.settings.midiMappings = [
      ...state.settings.midiMappings.filter((item) => item.action !== mapping.action),
      mapping
    ];
    state.midiLearningAction = null;
    state.midiLearningInputId = null;
    elements.midiLearnButton.disabled = false;
    elements.midiCancelLearn.hidden = true;
    elements.midiStatus.textContent = `${mapping.inputName}: ${messageType === 'note' ? 'nota' : 'CC'} ${messageNumber}, canal ${channel + 1} asignado.`;
    renderMidiMappings();
    persistSettings();
    return;
  }

  for (const mapping of state.settings.midiMappings) {
    if (mapping.inputId !== input.id
      || mapping.messageType !== messageType
      || mapping.channel !== channel
      || mapping.number !== messageNumber) continue;

    if (messageType === 'cc') {
      const key = `${input.id}:${channel}:${messageNumber}`;
      const wasPressed = state.midiLastValues.get(key) > 0;
      state.midiLastValues.set(key, value);
      if (value === 0 || wasPressed) continue;
    }
    if (isNoteOn || isControlChange) executeMidiAction(mapping.action);
  }
}

async function enableMidi() {
  if (typeof navigator.requestMIDIAccess !== 'function') {
    elements.midiStatus.textContent = 'Web MIDI no está disponible en este sistema.';
    return;
  }
  try {
    state.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    state.midiAccess.onstatechange = refreshMidiInputOptions;
    for (const input of state.midiAccess.inputs.values()) {
      input.onmidimessage = (event) => handleMidiMessage(input, event);
    }
    refreshMidiInputOptions();
  } catch (error) {
    elements.midiStatus.textContent = `No se pudo acceder a MIDI: ${error.message}`;
  }
}

function setTransportButton(playing) {
  const button = elements.playButton;
  button.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
  button.title = playing ? 'Pausar' : 'Reproducir';
  const icon = button.querySelector('svg');
  icon.innerHTML = playing
    ? '<rect x="7" y="6" width="3.5" height="12" rx="1"/><rect x="13.5" y="6" width="3.5" height="12" rx="1"/>'
    : '<path d="M8.2 5.8a1 1 0 0 1 1.5-.86l9.1 5.2a1 1 0 0 1 0 1.72l-9.1 5.2a1 1 0 0 1-1.5-.86V5.8Z"/>';
}

function updateSongDuration() {
  const song = selectedSong();
  if (!song) {
    state.duration = 0;
    elements.duration.textContent = '--:--';
    return;
  }
  if (song.clickOnly) {
    state.duration = 0;
    elements.duration.textContent = '∞ · hasta detener';
    return;
  }
  if (!state.audioPrepared) state.duration = 0;
  elements.duration.textContent = state.duration > 0 ? formatTime(state.duration) : '--:--';
}

function effectiveTrackGain(track) {
  const song = selectedSong();
  const soloActive = song?.tracks.some((item) => item.solo) ?? false;
  return track.muted || (soloActive && !track.solo) ? 0 : track.volume;
}

function applyTrackSettings(track) {
  if (!track) return;
  sendNativeMix();
}

function applyAllTrackGains() {
  sendNativeMix();
}

function audioTrackMix(song) {
  const soloActive = song.tracks.some((track) => track.solo);
  return song.tracks.map((track) => ({
    id: track.id,
    volume: track.muted || (soloActive && !track.solo) ? 0 : track.volume,
    pan: track.pan,
    outputChannel: track.outputChannel ?? -1,
    pitchEnabled: track.pitchEnabled !== false
  }));
}

function sendNativeMix() {
  if (!state.audioPrepared && !state.isPlaying) return;
  const song = selectedSong();
  if (!song) return;
  const setlist = activeSetlist();
  if (!setlist) return;
  window.multitracks.audioCommand({
    action: 'mix',
    songId: song.id,
    setlistId: setlist.id,
    masterVolume: Number(elements.masterVolume.value) / 100,
    setlistVolume: setlist.masterVolume,
    tracks: audioTrackMix(song)
  }).catch((error) => setStatus(`No se pudo actualizar la mezcla: ${error.message}`));
}

function updateClickStatus() {
  const song = selectedSong();
  if (!song) {
    elements.clickStatus.textContent = 'Selecciona una canción';
    return;
  }
  const syncedTracks = state.trackTempoAnalysis.filter((track) => track.synced).length;
  const analyzedTracks = state.trackTempoAnalysis.length;
  elements.clickStatus.textContent = analyzedTracks
    ? `${song.metronome.enabled ? 'Click activado' : 'Click silenciado'} · ${syncedTracks}/${analyzedTracks} pistas sincronizadas`
    : `${song.metronome.enabled ? 'Click activado' : 'Click silenciado'} · ${song.bpm} BPM`;
}

function currentPosition() {
  if (!state.isPlaying) return state.offset;
  return state.offset + performance.now() / 1000 - state.startedAt;
}

function updateTimeline() {
  const position = currentPosition();
  elements.position.textContent = formatTime(position);
  const song = selectedSong();
  const maxPosition = song?.clickOnly ? 86400 : Math.max(state.duration, 1);
  elements.progress.max = String(maxPosition);
  elements.progress.value = String(song?.clickOnly ? Math.min(position, 86400) : Math.min(position, state.duration));
  elements.waveformCanvas.setAttribute('aria-valuemax', String(maxPosition));
  elements.waveformCanvas.setAttribute('aria-valuenow', String(Math.min(position, maxPosition)));
  elements.waveformCanvas.setAttribute('aria-valuetext', formatTime(position));
  drawWaveform();
  const loopRegion = selectedSong()?.regions?.find((region) => region.id === state.loopRegionId);
  if (state.isPlaying && loopRegion && position >= loopRegion.end) {
    seekFromWaveform(loopRegion.start);
    return;
  }
  if (state.isPlaying && !song?.clickOnly && state.duration > 0 && position >= state.duration) {
    state.offset = 0;
    state.isPlaying = false;
    window.clearInterval(state.timer);
    state.timer = null;
    setTransportButton(false);
    elements.position.textContent = '00:00';
    elements.progress.value = '0';
    setStatus('Reproducción finalizada.');
  }
}

function startPlaybackStatusTimer() {
  window.clearInterval(state.timer);
  state.timer = window.setInterval(() => {
    updateTimeline();
    const now = performance.now();
    if (now - state.lastStatusRequest >= 250) {
      state.lastStatusRequest = now;
      window.multitracks.audioCommand({ action: 'status' })
        .catch((error) => setStatus(`No se pudo consultar el motor de audio: ${error.message}`));
    }
  }, 25);
}

async function startPlayback() {
  const song = selectedSong();
  if (!song) {
    setStatus('Primero añade una canción a la biblioteca.');
    return false;
  }
  const setlist = activeSetlist();
  if (!setlist || !setlist.songIds.includes(song.id)) {
    setStatus('Abre el setlist de esta canción antes de reproducirla.');
    return false;
  }
  if (!song.clickOnly && song.tracks.length === 0) {
    setStatus('Esta canción no tiene pistas.');
    return false;
  }
  if (song.clickOnly && !song.metronome.enabled) {
    setStatus('Activa el metrónomo para reproducir esta canción solo con click.');
    return false;
  }

  if (!state.settings.selectedAudioDevice) {
    setStatus('Selecciona un dispositivo de audio en Configuración.');
    return false;
  }
  if (state.audioPrepared) {
    await window.multitracks.audioCommand({ action: 'resume' });
    state.startedAt = performance.now() / 1000;
    state.isPlaying = true;
    setTransportButton(true);
    startPlaybackStatusTimer();
    setStatus('Reproduciendo.');
    return true;
  }

  setStatus('Preparando pistas y cambio de tono…');
  await window.multitracks.audioCommand({
    action: 'play',
    songId: song.id,
    setlistId: setlist.id,
    startOffsetSeconds: state.offset,
    masterVolume: Number(elements.masterVolume.value) / 100,
    setlistVolume: setlist.masterVolume,
    tracks: audioTrackMix(song)
  });
  state.startedAt = performance.now() / 1000;
  state.isPlaying = true;
  setTransportButton(true);
  startPlaybackStatusTimer();
  return true;
}

function pausePlayback() {
  state.offset = Math.min(currentPosition(), state.duration);
  state.isPlaying = false;
  window.clearInterval(state.timer);
  state.timer = null;
  window.multitracks.audioCommand({ action: 'pause' })
    .catch((error) => setStatus(`No se pudo pausar el audio: ${error.message}`));
  setTransportButton(false);
  setStatus('Reproducción pausada.');
}

async function restartPlayback() {
  if (!selectedSong()) return;
  if (!state.audioPrepared) {
    state.offset = 0;
    updateTimeline();
    return;
  }
  const shouldResume = state.isPlaying;
  await window.multitracks.audioCommand({ action: 'seek', positionFrames: 0 });
  state.offset = 0;
  state.startedAt = performance.now() / 1000;
  state.isPlaying = shouldResume;
  if (shouldResume) startPlaybackStatusTimer();
  setTransportButton(shouldResume);
  updateTimeline();
  setStatus('Canción reiniciada.');
}

function stopPlayback() {
  state.isPlaying = false;
  state.pendingSongSwitch = null;
  state.offset = 0;
  window.clearInterval(state.timer);
  state.timer = null;
  state.audioPrepared = false;
  window.multitracks.audioCommand({ action: 'stop' })
    .catch((error) => setStatus(`No se pudo detener el audio: ${error.message}`));
  setTransportButton(false);
  elements.position.textContent = '00:00';
  elements.progress.value = '0';
  setStatus('Reproducción detenida.');
}

function restorePendingSongSwitch(songId, message) {
  const pending = state.pendingSongSwitch;
  if (!pending || pending.songId !== songId) return false;
  state.pendingSongSwitch = null;
  state.selectedSongId = pending.previous.songId;
  state.offset = pending.previous.offset;
  state.startedAt = pending.previous.startedAt;
  state.duration = pending.previous.duration;
  state.waveformTracks = pending.previous.waveformTracks;
  state.waveformDuration = pending.previous.waveformDuration;
  state.trackTempoAnalysis = pending.previous.trackTempoAnalysis;
  state.audioPrepared = true;
  state.isPlaying = true;
  renderAll();
  setTransportButton(true);
  startPlaybackStatusTimer();
  setStatus(message);
  return true;
}

async function chooseSong(songId) {
  if (!isSongInActiveSetlist(songId)) {
    setStatus('Abre un setlist y selecciona una de sus canciones para reproducirla.');
    return;
  }
  if (state.selectedSongId === songId) {
    window.location.hash = 'player-view';
    return;
  }
  const continuePlayback = state.isPlaying;
  const now = performance.now() / 1000;
  const previous = continuePlayback
    ? state.pendingSongSwitch?.previous ?? {
      songId: state.selectedSongId,
      offset: currentPosition(),
      startedAt: now,
      duration: state.duration,
      waveformTracks: state.waveformTracks,
      waveformDuration: state.waveformDuration,
      trackTempoAnalysis: state.trackTempoAnalysis
    }
    : null;
  state.pendingSongSwitch = continuePlayback ? { songId, previous } : null;
  window.clearInterval(state.timer);
  state.timer = null;
  state.isPlaying = false;
  state.audioPrepared = false;
  state.selectedSongId = songId;
  state.offset = 0;
  state.duration = 0;
  state.waveformTracks = [];
  state.trackTempoAnalysis = [];
  state.waveformDuration = 0;
  state.pendingRegionStart = null;
  state.loopRegionId = null;
  elements.position.textContent = '00:00';
  elements.progress.value = '0';
  renderAll();
  window.location.hash = 'player-view';
  const song = selectedSong();
  if (continuePlayback) {
    state.isPlaying = true;
    setTransportButton(true);
    setStatus(`Cambiando a «${song?.name ?? 'la canción siguiente'}»…`);
    try {
      const started = await startPlayback();
      if (!started) {
        restorePendingSongSwitch(songId, elements.status.textContent);
      }
    } catch (error) {
      if (!restorePendingSongSwitch(songId, `No se pudo cambiar de canción: ${error.message}`)) {
        state.isPlaying = false;
        state.audioPrepared = false;
        setTransportButton(false);
        setStatus(`No se pudo cambiar de canción: ${error.message}`);
      }
    }
  } else if (song) {
    setTransportButton(false);
    setStatus(`${song.name} lista para reproducir.`);
  }
}

function scheduleSave() {
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(async () => {
    try {
      state.library = await window.multitracks.saveLibrary(state.library);
      renderSetlists();
    } catch (error) {
      setStatus(`No se pudo guardar la biblioteca: ${error.message}`);
    }
  }, 180);
}

function addSongToSetlist(songId) {
  const setlist = state.library.setlists.find((item) => item.id === state.activeSetlistId);
  if (!setlist) {
    window.location.hash = 'setlists-view';
    setStatus('Primero crea o selecciona un setlist. Después vuelve a Explorar para agregar canciones.');
    return;
  }
  if (setlist.songIds.includes(songId)) {
    setStatus('La canción ya está en este setlist.');
    return;
  }
  setlist.songIds.push(songId);
  renderAll();
  scheduleSave();
  const song = state.library.songs.find((item) => item.id === songId);
  setStatus(`«${song?.name ?? 'Canción'}» añadida a «${setlist.name}».`);
}

function moveSongInSetlist(songId, direction) {
  const setlist = activeSetlist();
  if (!setlist) return;
  const index = setlist.songIds.indexOf(songId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= setlist.songIds.length) return;
  [setlist.songIds[index], setlist.songIds[nextIndex]] = [setlist.songIds[nextIndex], setlist.songIds[index]];
  renderSetlists();
  scheduleSave();
}

async function importSongFromForm(event) {
  event?.preventDefault();
  if (state.importInProgress || !elements.importSongForm.reportValidity()) return;

  const metadata = {
    name: elements.importSongName.value.trim(),
    artist: elements.importSongArtist.value.trim(),
    bpm: Number(elements.importSongBpm.value),
    key: elements.importSongKey.value
  };
  if (!metadata.name || !metadata.artist || !metadata.key
    || !Number.isInteger(metadata.bpm) || metadata.bpm < 30 || metadata.bpm > 300) {
    setStatus('Completa nombre, artista, BPM entre 30 y 300 y tonalidad.');
    return;
  }

  state.importInProgress = true;
  elements.saveImportedSongButton.disabled = true;
  elements.importSongFiles.disabled = true;
  try {
    const song = await window.multitracks.importSong(metadata);
    if (!song) return;
    state.library = await window.multitracks.loadLibrary();
    elements.importSongForm.reset();
    elements.importSongDialog.open = false;
    renderAll();
    setStatus(`«${song.name}» quedó en la biblioteca. Usa + para agregarla al setlist seleccionado.`);
  } catch (error) {
    setStatus(`No se pudo importar la canción: ${error.message}`);
  } finally {
    state.importInProgress = false;
    elements.saveImportedSongButton.disabled = false;
    elements.importSongFiles.disabled = false;
  }
}

elements.importSongForm.addEventListener('submit', importSongFromForm);
elements.importSongFiles.addEventListener('click', () => elements.importSongForm.requestSubmit());

elements.libraryResultsList.addEventListener('click', async (event) => {
  const addButton = event.target.closest('[data-add-library-song-id]');
  if (addButton) {
    addSongToSetlist(addButton.dataset.addLibrarySongId);
    return;
  }

  const deleteButton = event.target.closest('[data-delete-song-id]');
  if (deleteButton) {
    const song = state.library.songs.find((item) => item.id === deleteButton.dataset.deleteSongId);
    if (!song) return;
    if (!window.confirm(`¿Quitar «${song.name}» de la biblioteca?\n\nLos archivos de audio originales no se borrarán.`)) return;

    try {
      if (song.id === state.selectedSongId && (state.isPlaying || state.audioPrepared)) {
        await window.multitracks.audioCommand({ action: 'stop' });
        window.clearInterval(state.timer);
        state.timer = null;
        state.isPlaying = false;
        state.audioPrepared = false;
        state.offset = 0;
        setTransportButton(false);
      }
      window.clearTimeout(state.saveTimer);
      state.library = await window.multitracks.deleteSong(song.id);
      if (song.id === state.selectedSongId) {
        state.selectedSongId = state.library.songs[0]?.id ?? null;
        state.offset = 0;
        state.duration = 0;
        state.waveformTracks = [];
        state.trackTempoAnalysis = [];
      }
      renderAll();
      setStatus(`«${song.name}» se quitó de la biblioteca. Los archivos siguen en su ubicación.`);
    } catch (error) {
      setStatus(`No se pudo quitar «${song.name}»: ${error.message}`);
    }
    return;
  }

});

for (const filter of [elements.librarySearch, elements.libraryFilterArtist, elements.libraryFilterBpm, elements.libraryFilterKey]) {
  filter.addEventListener('input', renderLibraryResults);
  filter.addEventListener('change', renderLibraryResults);
}

elements.setlistList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-play-setlist-song-id]');
  if (button) chooseSong(button.dataset.playSetlistSongId);
});

elements.activeSetlistSelect.addEventListener('change', () => {
  if (elements.activeSetlistSelect.value) openSetlist(elements.activeSetlistSelect.value);
});

elements.openCurrentSetlist.addEventListener('click', () => {
  if (state.activeSetlistId) openSetlist(state.activeSetlistId);
});

elements.setlistCards.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-delete-setlist-id]');
  if (removeButton) {
    deleteSetlist(removeButton.dataset.deleteSetlistId);
    return;
  }
  const button = event.target.closest('[data-open-setlist-id]');
  if (button) openSetlist(button.dataset.openSetlistId);
});

elements.setlistSongsList.addEventListener('click', (event) => {
  const moveButton = event.target.closest('[data-move-song-id]');
  if (moveButton) {
    moveSongInSetlist(moveButton.dataset.moveSongId, Number(moveButton.dataset.moveDirection));
    return;
  }
  const removeButton = event.target.closest('[data-remove-setlist-song-id]');
  if (removeButton) {
    const setlist = state.library.setlists.find((item) => item.id === state.activeSetlistId);
    if (!setlist) return;
    const removingCurrentSong = removeButton.dataset.removeSetlistSongId === state.selectedSongId;
    const wasPlaying = state.isPlaying;
    setlist.songIds = setlist.songIds.filter((songId) => songId !== removeButton.dataset.removeSetlistSongId);
    renderAll();
    scheduleSave();
    if (removingCurrentSong) {
      state.selectedSongId = null;
      state.waveformTracks = [];
      state.trackTempoAnalysis = [];
      if (wasPlaying && setlist.songIds[0]) {
        chooseSong(setlist.songIds[0]);
      } else {
        if (wasPlaying || state.audioPrepared) stopPlayback();
        renderAll();
        setStatus('Canción quitada de este setlist. Sigue disponible en la biblioteca.');
      }
    } else {
      setStatus('Canción quitada de este setlist. Sigue disponible en la biblioteca.');
    }
    return;
  }
  const playButton = event.target.closest('[data-play-setlist-song-id]');
  if (playButton) chooseSong(playButton.dataset.playSetlistSongId);
});

elements.setlistForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = elements.setlistName.value.trim();
  if (!name) {
    elements.setlistName.focus();
    return;
  }
  const setlist = { id: crypto.randomUUID(), name, songIds: [], masterVolume: 1 };
  state.library.setlists.push(setlist);
  state.activeSetlistId = setlist.id;
  state.selectedSongId = null;
  state.waveformTracks = [];
  state.trackTempoAnalysis = [];
  state.waveformDuration = 0;
  elements.setlistName.value = '';
  renderAll();
  scheduleSave();
  window.location.hash = 'setlist-detail-view';
  setStatus(`Setlist «${name}» creado.`);
});

elements.importSetlistButton.addEventListener('click', async () => {
  elements.importSetlistButton.disabled = true;
  try {
    const imported = await window.multitracks.importSetlist();
    if (!imported) return;
    state.library = await window.multitracks.loadLibrary();
    renderAll();
    openSetlist(imported.setlistId);
    window.location.hash = state.isPlaying && imported.songCount > 0 ? 'player-view' : 'setlist-detail-view';
    setStatus(`Setlist «${imported.name}» importado con ${imported.songCount} canción(es).`);
  } catch (error) {
    setStatus(`No se pudo importar el setlist: ${error.message}`);
  } finally {
    elements.importSetlistButton.disabled = false;
  }
});

elements.exportSetlistButton.addEventListener('click', async () => {
  if (!state.activeSetlistId) {
    setStatus('Selecciona un setlist antes de exportarlo.');
    return;
  }
  elements.exportSetlistButton.disabled = true;
  try {
    const filePath = await window.multitracks.exportSetlist(state.activeSetlistId);
    if (filePath) {
      const setlist = state.library.setlists.find((item) => item.id === state.activeSetlistId);
      setStatus(`Setlist «${setlist?.name ?? ''}» exportado correctamente.`);
    }
  } catch (error) {
    setStatus(`No se pudo exportar el setlist: ${error.message}`);
  } finally {
    elements.exportSetlistButton.disabled = !state.library.setlists.some((item) => item.id === state.activeSetlistId);
  }
});

elements.clickSongForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = elements.clickSongTitle.value.trim();
  if (!name) {
    elements.clickSongTitle.focus();
    return;
  }
  try {
    const song = await window.multitracks.createClickSong(name);
    state.library = await window.multitracks.loadLibrary();
    elements.clickSongTitle.value = '';
    renderAll();
    setStatus(`Canción «${song.name}» creada en la biblioteca. Agrégala al setlist con +.`);
  } catch (error) {
    setStatus(`No se pudo crear la canción con click: ${error.message}`);
  }
});

elements.trackList.addEventListener('input', (event) => {
  const input = event.target.closest('[data-track-control]');
  if (!input) return;
  const song = selectedSong();
  if (input.dataset.trackControl === 'click-volume') {
    if (!song) return;
    song.metronome.volume = Number(input.value) / 100;
    sendNativeMix();
    scheduleSave();
    return;
  }
  const track = song?.tracks.find((item) => item.id === input.dataset.trackId);
  if (!track) return;

  const control = input.dataset.trackControl;
  if (control === 'volume') track.volume = Number(input.value) / 100;
  else if (control === 'pan') track.pan = Number(input.value) / 100;
  else return;
  applyTrackSettings(track);
  scheduleSave();
});

elements.trackList.addEventListener('change', (event) => {
  const control = event.target.closest('[data-track-control]');
  if (!control) return;
  const song = selectedSong();
  if (!song) return;
  if (control.dataset.trackControl === 'click-outputChannel') {
    song.metronome.outputChannel = Number(control.value);
    sendNativeMix();
    scheduleSave();
    return;
  }
  const track = song.tracks.find((item) => item.id === control.dataset.trackId);
  if (!track) return;
  if (control.dataset.trackControl === 'outputChannel') {
    track.outputChannel = Number(control.value);
    sendNativeMix();
    scheduleSave();
  } else if (control.dataset.trackControl === 'pitchEnabled') {
    track.pitchEnabled = control.checked;
    scheduleSave();
    reprocessPitchSettings();
  }
});

elements.trackList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-track-control="solo"], [data-track-control="muted"], [data-track-control="click-enabled"]');
  if (!button) return;
  if (button.dataset.trackControl === 'click-enabled') {
    const song = selectedSong();
    if (!song) return;
    song.metronome.enabled = !song.metronome.enabled;
    button.setAttribute('aria-pressed', String(song.metronome.enabled));
    button.setAttribute('aria-label', `${song.metronome.enabled ? 'Silenciar' : 'Activar'} click`);
    updateClickStatus();
    sendNativeMix();
    scheduleSave();
    return;
  }
  const track = selectedSong()?.tracks.find((item) => item.id === button.dataset.trackId);
  if (!track) return;
  const control = button.dataset.trackControl;
  track[control] = !track[control];
  button.setAttribute('aria-pressed', String(track[control]));
  applyAllTrackGains();
  scheduleSave();
});

elements.playButton.addEventListener('click', async () => {
  try {
    if (state.isPlaying) {
      pausePlayback();
    } else {
      await startPlayback();
    }
  } catch (error) {
    state.isPlaying = false;
    setTransportButton(false);
    setStatus(`No se pudo reproducir el audio: ${error.message}`);
  }
});

elements.stopButton.addEventListener('click', stopPlayback);
elements.restartButton.addEventListener('click', () => {
  restartPlayback().catch((error) => setStatus(`No se pudo reiniciar la canción: ${error.message}`));
});

elements.progress.addEventListener('input', () => {
  elements.position.textContent = formatTime(Number(elements.progress.value));
});

elements.progress.addEventListener('change', () => {
  const nextPosition = Number(elements.progress.value);
  const shouldResume = state.isPlaying;
  state.offset = nextPosition;
  state.isPlaying = false;
  window.clearInterval(state.timer);
  state.timer = null;
  if (state.audioPrepared) {
    const sampleRate = state.settings.selectedSampleRate
      || state.audioDevices.find((device) => String(device.id) === state.settings.selectedAudioDevice)?.sampleRate
      || 48000;
    window.multitracks.audioCommand({
      action: 'seek',
      positionFrames: Math.round(nextPosition * sampleRate)
    }).then(() => (shouldResume
      ? window.multitracks.audioCommand({ action: 'resume' })
      : true)).then(() => {
      state.isPlaying = shouldResume;
      state.startedAt = performance.now() / 1000;
      setTransportButton(shouldResume);
      if (shouldResume) startPlaybackStatusTimer();
    }).catch((error) => setStatus(`No se pudo cambiar la posición: ${error.message}`));
  }
  elements.position.textContent = formatTime(nextPosition);
});

function seekFromWaveform(position) {
  elements.progress.value = String(Math.max(0, Math.min(position, state.duration)));
  elements.progress.dispatchEvent(new Event('input', { bubbles: true }));
  elements.progress.dispatchEvent(new Event('change', { bubbles: true }));
}

elements.waveformCanvas.addEventListener('click', (event) => {
  if (state.duration <= 0 || !state.waveformTracks.length) return;
  const bounds = elements.waveformCanvas.getBoundingClientRect();
  const left = 54;
  const right = bounds.width - 12;
  const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left - left) / (right - left)));
  seekFromWaveform(state.duration * fraction);
});

elements.waveformCanvas.addEventListener('keydown', (event) => {
  if (state.duration <= 0 || !state.waveformTracks.length) return;
  let position = currentPosition();
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') position -= 5;
  else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') position += 5;
  else if (event.key === 'Home') position = 0;
  else if (event.key === 'End') position = state.duration;
  else return;
  event.preventDefault();
  seekFromWaveform(position);
});

elements.addMarkerButton.addEventListener('click', addSongMarker);
elements.regionStartButton.addEventListener('click', setRegionStart);
elements.regionEndButton.addEventListener('click', finishSongRegion);

elements.songMarkers.addEventListener('click', (event) => {
  const seekButton = event.target.closest('[data-seek-marker-id]');
  const removeButton = event.target.closest('[data-remove-marker-id]');
  const song = selectedSong();
  if (!song) return;
  if (seekButton) {
    const marker = song.markers.find((item) => item.id === seekButton.dataset.seekMarkerId);
    if (marker) seekFromWaveform(marker.position);
  } else if (removeButton) {
    song.markers = song.markers.filter((item) => item.id !== removeButton.dataset.removeMarkerId);
    renderCues();
    drawWaveform(true);
    scheduleSave();
  }
});

elements.songRegions.addEventListener('click', (event) => {
  const seekButton = event.target.closest('[data-seek-region-id]');
  const loopButton = event.target.closest('[data-loop-region-id]');
  const removeButton = event.target.closest('[data-remove-region-id]');
  const song = selectedSong();
  if (!song) return;
  if (seekButton) {
    const region = song.regions.find((item) => item.id === seekButton.dataset.seekRegionId);
    if (region) seekFromWaveform(region.start);
  } else if (loopButton) {
    state.loopRegionId = state.loopRegionId === loopButton.dataset.loopRegionId ? null : loopButton.dataset.loopRegionId;
    renderCues();
    drawWaveform(true);
  } else if (removeButton) {
    song.regions = song.regions.filter((item) => item.id !== removeButton.dataset.removeRegionId);
    if (state.loopRegionId === removeButton.dataset.removeRegionId) state.loopRegionId = null;
    renderCues();
    drawWaveform(true);
    scheduleSave();
  }
});

elements.masterVolume.addEventListener('input', () => {
  const value = Number(elements.masterVolume.value);
  elements.masterVolumeValue.value = `${value}%`;
  sendNativeMix();
});

elements.setlistMasterVolume.addEventListener('input', () => {
  const setlist = activeSetlist();
  if (!setlist) return;
  const value = Number(elements.setlistMasterVolume.value);
  setlist.masterVolume = value / 100;
  elements.setlistMasterVolumeValue.value = `${value}%`;
  sendNativeMix();
  scheduleSave();
});

function reprocessPitchSettings() {
  if (!state.audioPrepared && !state.isPlaying) return;
  state.offset = currentPosition();
  window.clearTimeout(state.pitchRefreshTimer);
  state.pitchRefreshTimer = window.setTimeout(async () => {
    const offset = state.offset;
    state.isPlaying = false;
    state.audioPrepared = false;
    window.clearInterval(state.timer);
    state.timer = null;
    state.offset = offset;
    setTransportButton(false);
    try {
      await startPlayback();
    } catch (error) {
      setStatus(`No se pudo aplicar el pitch: ${error.message}`);
    }
  }, 350);
}

elements.songPitch.addEventListener('change', () => {
  const song = selectedSong();
  if (!song || !song.key) return;
  song.pitchTargetKey = elements.songPitch.value || song.key;
  song.pitchSemitones = semitonesBetweenKeys(song.key, song.pitchTargetKey);
  elements.songPitchValue.value = `${song.pitchSemitones > 0 ? '+' : ''}${song.pitchSemitones} st`;
  updateSongDuration();
  scheduleSave();
  reprocessPitchSettings();
});

elements.clickBpm.addEventListener('change', () => {
  const song = selectedSong();
  if (!song) return;
  const value = Math.min(300, Math.max(30, Number(elements.clickBpm.value) || 120));
  elements.clickBpm.value = String(value);
  song.bpm = value;
  song.metronome.bpm = value;
  const clickTrackDetail = elements.trackList.querySelector('.click-track-row .track-detail');
  if (clickTrackDetail) clickTrackDetail.textContent = `${value} BPM · ${song.metronome.beats === 6 ? '6/8' : `${song.metronome.beats}/4`}`;
  renderLibraryResults();
  updateClickStatus();
  sendNativeMix();
  scheduleSave();
});
elements.clickBeats.addEventListener('change', () => {
  const song = selectedSong();
  if (!song) return;
  song.metronome.beats = Number(elements.clickBeats.value);
  const clickTrackDetail = elements.trackList.querySelector('.click-track-row .track-detail');
  if (clickTrackDetail) clickTrackDetail.textContent = `${song.metronome.bpm} BPM · ${song.metronome.beats === 6 ? '6/8' : `${song.metronome.beats}/4`}`;
  sendNativeMix();
  scheduleSave();
});

async function showSettingsView(showSettings) {
  document.body.classList.toggle('settings-active', showSettings);
  elements.settingsView.hidden = !showSettings;
  elements.playerView.hidden = showSettings;
  elements.mixerPanel.hidden = showSettings;
  elements.settingsButton.setAttribute('aria-expanded', String(showSettings));
  if (!showSettings) document.body.classList.remove('settings-active');
  if (showSettings) {
    renderMidiMappings();
    renderKeyboardMappings();
    await refreshAsioDrivers();
  }
}

elements.settingsButton.addEventListener('click', (event) => {
  event.preventDefault();
  state.settingsReturnHash = window.location.hash || '#setlists-view';
  showSettingsView(true);
});

function showAppHelp() {
  if (!elements.helpDialog.open) elements.helpDialog.showModal();
}

elements.helpButton.addEventListener('click', showAppHelp);
elements.moreButton.addEventListener('click', showAppHelp);
elements.closeHelpDialog.addEventListener('click', () => elements.helpDialog.close());

elements.settingsReturnButton.addEventListener('click', (event) => {
  event.preventDefault();
  showSettingsView(false);
  window.location.hash = state.settingsReturnHash.slice(1);
});

for (const navigationButton of [elements.setlistsButton, elements.libraryButton]) {
  navigationButton.addEventListener('click', () => {
    if (!document.body.classList.contains('settings-active')) return;
    showSettingsView(false);
  });
}

elements.refreshAudioDevices.addEventListener('click', refreshAsioDrivers);

elements.audioApiSelect.addEventListener('change', async () => {
  const wasPrepared = state.audioPrepared;
  if (wasPrepared || state.isPlaying) stopPlayback();
  state.settings.selectedAudioApi = elements.audioApiSelect.value;
  state.settings.selectedAudioDevice = '';
  state.settings.selectedSampleRate = 0;
  await persistSettings();
  await refreshAsioDrivers();
});

elements.asioDriverSelect.addEventListener('change', async () => {
  if (state.audioPrepared || state.isPlaying) stopPlayback();
  state.settings.selectedAudioDevice = elements.asioDriverSelect.value;
  persistSettings();
  const device = state.audioDevices.find((item) => String(item.id) === state.settings.selectedAudioDevice);
  elements.asioChannelStatus.textContent = device
    ? `${device.name}: ${device.outputChannels} salidas · ${state.settings.selectedSampleRate || device.sampleRate} Hz · búfer ${state.settings.bufferFrames} muestras.`
    : 'Selecciona un dispositivo con salidas disponibles.';
  renderTracks();
});

elements.audioSampleRate.addEventListener('change', () => {
  const sampleRate = Number(elements.audioSampleRate.value);
  const device = state.audioDevices.find((item) => String(item.id) === state.settings.selectedAudioDevice);
  const supported = device && (sampleRate === 0 || (device.sampleRates ?? [device.sampleRate]).includes(sampleRate));
  if (!supported) {
    elements.audioDriverStatus.textContent = 'La frecuencia seleccionada no está disponible en este dispositivo.';
    elements.audioSampleRate.value = String(state.settings.selectedSampleRate);
    return;
  }
  if (state.audioPrepared || state.isPlaying) stopPlayback();
  state.settings.selectedSampleRate = sampleRate;
  elements.asioChannelStatus.textContent = `${device.name}: ${device.outputChannels} salidas · ${sampleRate || device.sampleRate} Hz · búfer ${state.settings.bufferFrames} muestras.`;
  persistSettings();
});

elements.audioBufferSize.addEventListener('change', () => {
  if (state.audioPrepared || state.isPlaying) stopPlayback();
  state.settings.bufferFrames = Number(elements.audioBufferSize.value);
  const device = state.audioDevices.find((item) => String(item.id) === state.settings.selectedAudioDevice);
  if (device) {
    elements.asioChannelStatus.textContent = `${device.name}: ${device.outputChannels} salidas · ${state.settings.selectedSampleRate || device.sampleRate} Hz · búfer ${state.settings.bufferFrames} muestras.`;
  }
  persistSettings();
});

elements.midiEnableButton.addEventListener('click', enableMidi);

elements.midiInputSelect.addEventListener('change', () => {
  elements.midiStatus.textContent = elements.midiInputSelect.value
    ? 'Entrada seleccionada. Elige una acción y pulsa Aprender.'
    : 'Selecciona la entrada MIDI que quieres usar.';
});

elements.midiLearnButton.addEventListener('click', () => {
  if (!state.midiAccess) {
    elements.midiStatus.textContent = 'Primero activa y selecciona una entrada MIDI.';
    return;
  }
  const inputId = elements.midiInputSelect.value;
  if (!inputId) {
    elements.midiStatus.textContent = 'Selecciona una entrada MIDI antes de aprender un control.';
    return;
  }
  const input = state.midiAccess.inputs.get(inputId);
  if (!input) {
    elements.midiStatus.textContent = 'La entrada MIDI seleccionada ya no está disponible.';
    return;
  }
  state.midiLearningAction = elements.midiLearnAction.value;
  state.midiLearningInputId = inputId;
  elements.midiLearnButton.disabled = true;
  elements.midiCancelLearn.hidden = false;
  elements.midiStatus.textContent = `Pulsa ahora el botón físico para «${elements.midiLearnAction.selectedOptions[0].textContent}».`;
});

elements.midiCancelLearn.addEventListener('click', () => {
  state.midiLearningAction = null;
  state.midiLearningInputId = null;
  elements.midiLearnButton.disabled = false;
  elements.midiCancelLearn.hidden = true;
  elements.midiStatus.textContent = 'Aprendizaje MIDI cancelado.';
});

elements.midiMappingsList.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-midi-remove-action]');
  if (!removeButton) return;
  state.settings.midiMappings = state.settings.midiMappings.filter((mapping) => mapping.action !== removeButton.dataset.midiRemoveAction);
  renderMidiMappings();
  persistSettings();
});

elements.keyboardLearnButton.addEventListener('click', () => {
  state.keyLearningAction = elements.keyboardLearnAction.value;
  elements.keyboardLearnButton.disabled = true;
  elements.keyboardCancelLearn.hidden = false;
  elements.keyboardStatus.textContent = `Pulsa ahora la tecla que quieres asignar a «${elements.keyboardLearnAction.selectedOptions[0].textContent}».`;
});

elements.keyboardCancelLearn.addEventListener('click', () => {
  state.keyLearningAction = null;
  elements.keyboardLearnButton.disabled = false;
  elements.keyboardCancelLearn.hidden = true;
  elements.keyboardStatus.textContent = 'Aprendizaje de teclado cancelado.';
});

elements.keyboardMappingsList.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-key-remove-action]');
  if (!removeButton) return;
  state.settings.keyMappings = state.settings.keyMappings.filter((mapping) => mapping.action !== removeButton.dataset.keyRemoveAction);
  renderKeyboardMappings();
  persistSettings();
});

window.addEventListener('keydown', (event) => {
  if (state.keyLearningAction) {
    if (['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'].includes(event.code)) return;
    event.preventDefault();
    if (!/^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|Space|Arrow(?:Up|Down|Left|Right)|Home|End|Enter|Escape|F(?:[1-9]|1[0-2]))$/.test(event.code)) {
      state.keyLearningAction = null;
      elements.keyboardLearnButton.disabled = false;
      elements.keyboardCancelLearn.hidden = true;
      elements.keyboardStatus.textContent = 'Esa tecla no se puede asignar; prueba con letras, números, flechas o teclas F.';
      return;
    }
    const mapping = {
      action: state.keyLearningAction,
      code: event.code,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey
    };
    state.settings.keyMappings = [
      ...state.settings.keyMappings.filter((item) => item.action !== mapping.action
        && !(item.code === mapping.code && item.ctrl === mapping.ctrl && item.alt === mapping.alt && item.shift === mapping.shift)),
      mapping
    ];
    state.keyLearningAction = null;
    elements.keyboardLearnButton.disabled = false;
    elements.keyboardCancelLearn.hidden = true;
    elements.keyboardStatus.textContent = `Tecla ${[mapping.ctrl && 'Ctrl', mapping.alt && 'Alt', mapping.shift && 'Mayús', mapping.code].filter(Boolean).join(' + ')} asignada.`;
    renderKeyboardMappings();
    persistSettings();
    return;
  }
  if (event.defaultPrevented || event.repeat
    || (event.target instanceof Element && event.target.matches('input, textarea, select, [contenteditable="true"]'))) return;
  const mapping = state.settings.keyMappings.find((item) => item.code === event.code
    && item.ctrl === event.ctrlKey && item.alt === event.altKey && item.shift === event.shiftKey);
  if (mapping) {
    event.preventDefault();
    executeMidiAction(mapping.action);
    return;
  }
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.code === 'Space') {
    event.preventDefault();
    elements.playButton.click();
  } else if (event.code === 'ArrowRight' || event.code === 'ArrowDown') {
    event.preventDefault();
    navigateSetlist(1);
  } else if (event.code === 'ArrowLeft' || event.code === 'ArrowUp') {
    event.preventDefault();
    navigateSetlist(-1);
  } else if (/^(?:Digit|Numpad)[1-9]$/.test(event.code)) {
    event.preventDefault();
    chooseSongByNumber(Number(event.code.slice(-1)));
  }
});

window.multitracks.onAudioEvent((event) => {
  if (event.event === 'cache-warning') {
    if (!event.songId || event.songId === selectedSong()?.id) {
      state.lastCacheWarning = event.message;
      setStatus(event.message);
    }
    return;
  }
  if (event.event === 'preparing') {
    if (event.songId && event.songId !== selectedSong()?.id) return;
    setStatus(`Preparando «${event.track}» y ajustando el pitch…`);
    return;
  }
  if (event.event === 'playing') {
    if (event.songId && event.songId !== selectedSong()?.id) return;
    state.pendingSongSwitch = null;
    renderSetlists();
    const song = selectedSong();
    const sampleRate = Number(event.sampleRate) || 48000;
    state.duration = song?.clickOnly ? 0 : Number(event.durationFrames) / sampleRate;
    state.waveformDuration = state.duration;
    state.waveformTracks = Array.isArray(event.waveforms)
      ? event.waveforms.filter((track) => track
        && typeof track.id === 'string'
        && typeof track.name === 'string'
        && Array.isArray(track.values)
        && track.values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1))
      : [];
    state.trackTempoAnalysis = Array.isArray(event.trackAnalysis)
      ? event.trackAnalysis.filter((track) => track
        && typeof track.id === 'string'
        && Number.isFinite(track.bpm)
        && Number.isFinite(track.confidence)
        && typeof track.synced === 'boolean')
      : [];
    const cachedTracks = Number(event.cachedTracks) || 0;
    elements.waveformStatus.textContent = song?.clickOnly
      ? 'Canción solo con click'
      : state.waveformTracks.length
        ? `${cachedTracks ? `${cachedTracks} desde caché · ` : ''}${state.waveformTracks.length} pistas analizadas · ${state.trackTempoAnalysis.filter((track) => track.synced).length} sincronizadas`
        : 'No se pudo analizar el espectro';
    state.offset = Number(event.positionFrames ?? 0) / sampleRate;
    state.startedAt = performance.now() / 1000;
    state.audioPrepared = true;
    state.isPlaying = true;
    renderTracks();
    setTransportButton(true);
    updateSongDuration();
    setStatus(state.lastCacheWarning || (song?.clickOnly
      ? 'Reproduciendo click. Pulsa Detener para terminar.'
      : cachedTracks
        ? `${cachedTracks} pistas cargadas desde caché. Reproduciendo por ${state.settings.selectedAudioApi.toUpperCase()}.`
        : `Reproduciendo por ${state.settings.selectedAudioApi.toUpperCase()}.`));
    state.lastCacheWarning = '';
    drawWaveform(true);
    return;
  }
  if (event.event === 'status') {
    const sampleRate = Number(event.sampleRate) || 48000;
    if (!selectedSong()?.clickOnly) state.duration = Number(event.durationFrames) / sampleRate;
    state.offset = Number(event.positionFrames) / sampleRate;
    state.isPlaying = event.playing === true;
    state.startedAt = performance.now() / 1000;
    state.audioPrepared = state.audioPrepared || event.playing === true;
    setTransportButton(state.isPlaying);
    updateSongDuration();
    drawWaveform();
    return;
  }
  if (event.event === 'paused') {
    state.offset = Number(event.positionFrames ?? 0) / (state.audioDevices.find((device) => String(device.id) === state.settings.selectedAudioDevice)?.sampleRate ?? 48000);
    state.isPlaying = false;
    setTransportButton(false);
    return;
  }
  if (event.event === 'stopped') {
    state.offset = 0;
    state.isPlaying = false;
    state.audioPrepared = false;
    setTransportButton(false);
    return;
  }
  if (event.event === 'ended') {
    state.offset = 0;
    state.isPlaying = false;
    state.audioPrepared = false;
    window.clearInterval(state.timer);
    state.timer = null;
    setTransportButton(false);
    elements.position.textContent = '00:00';
    elements.progress.value = '0';
    setStatus('Reproducción finalizada.');
    return;
  }
  if (event.event === 'engine-exit') {
    state.isPlaying = false;
    state.audioPrepared = false;
    setTransportButton(false);
    setStatus(event.message);
    return;
  }
  if (event.event === 'error') {
    if (event.songId && event.songId !== selectedSong()?.id) return;
    if (restorePendingSongSwitch(event.songId, `No se pudo cambiar de canción: ${event.message}`)) return;
    state.isPlaying = false;
    state.pendingSongSwitch = null;
    state.audioPrepared = false;
    window.clearInterval(state.timer);
    state.timer = null;
    setTransportButton(false);
    updateSongDuration();
    setStatus(`Error de audio: ${event.message}`);
  }
});

window.multitracks.loadLibrary().then((library) => {
  state.library = library;
  state.activeSetlistId = library.setlists[0]?.id ?? null;
  state.selectedSongId = null;
  renderAll();
  elements.masterVolumeValue.value = `${elements.masterVolume.value}%`;
  updateClickStatus();
  return window.multitracks.loadSettings();
}).then((loadedSettings) => {
  if (!loadedSettings) return;
  state.settings = {
    ...state.settings,
    ...loadedSettings,
    selectedSampleRate: Number(loadedSettings.selectedSampleRate) || 0,
    bufferFrames: Number(loadedSettings.bufferFrames) || 512,
    midiMappings: Array.isArray(loadedSettings.midiMappings) ? loadedSettings.midiMappings : [],
    keyMappings: Array.isArray(loadedSettings.keyMappings) ? loadedSettings.keyMappings : []
  };
  elements.audioApiSelect.value = state.settings.selectedAudioApi;
  elements.audioBufferSize.value = String(state.settings.bufferFrames);
  renderMidiMappings();
  renderKeyboardMappings();
  return refreshAsioDrivers();
}).catch((error) => {
  setStatus(`No se pudieron cargar la biblioteca y la configuración: ${error.message}`);
});
