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
  onUpdate: cb => ipcRenderer.on('update', (e, d) => cb(d)),
  backupNow: () => ipcRenderer.sendSync('backup-now'),
  dbStatus: () => ipcRenderer.invoke('db-status'),
  dbConnect: c => ipcRenderer.invoke('db-connect', c),
  dbCode: () => ipcRenderer.invoke('db-code'),
  dbDisconnect: () => ipcRenderer.invoke('db-disconnect'),
  dbReq: o => ipcRenderer.invoke('db-req', o),
  gStatus: () => ipcRenderer.invoke('g-status'),
  gLogin: () => ipcRenderer.invoke('g-login'),
  gLogout: () => ipcRenderer.invoke('g-logout'),
  gApi: o => ipcRenderer.invoke('g-api', o)
});
