// Pont sécurisé entre l'interface et le système (fichiers, Google Agenda, mises à jour)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  version: ipcRenderer.sendSync('version'),
  load: () => ipcRenderer.sendSync('load'),
  save: data => ipcRenderer.sendSync('save', data),
  fetchICS: url => ipcRenderer.invoke('fetch-ics', url),
  exportData: json => ipcRenderer.invoke('export', json),
  importData: () => ipcRenderer.invoke('import'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  saveFile: o => ipcRenderer.invoke('save-file', o),
  savePdf: o => ipcRenderer.invoke('save-pdf', o),
  print: () => ipcRenderer.invoke('print'),
  theme: dark => ipcRenderer.send('theme', dark),
  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateInstall: () => ipcRenderer.invoke('update-install'),
  updateState: () => ipcRenderer.sendSync('update-state'),
  onUpdate: cb => ipcRenderer.on('update', (e, d) => cb(d))
});
