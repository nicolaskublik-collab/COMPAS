const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('multitracks', {
  loadLibrary: () => ipcRenderer.invoke('library:load'),
  importSong: (metadata) => ipcRenderer.invoke('library:import', metadata),
  createClickSong: (name) => ipcRenderer.invoke('library:create-click-song', name),
  deleteSong: (songId) => ipcRenderer.invoke('library:delete-song', songId),
  saveLibrary: (library) => ipcRenderer.invoke('library:save', library),
  exportSetlist: (setlistId) => ipcRenderer.invoke('setlist:export', setlistId),
  importSetlist: () => ipcRenderer.invoke('setlist:import'),
  readTrack: (filePath) => ipcRenderer.invoke('track:read', filePath),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  listAudioDevices: (api) => ipcRenderer.invoke('audio:list-devices', api),
  audioCommand: (command) => ipcRenderer.invoke('audio:command', command),
  onAudioEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('audio:event', listener);
    return () => ipcRenderer.removeListener('audio:event', listener);
  }
});
