// StockInfos — processus principal Electron (logiciel libre)
const { app, BrowserWindow, ipcMain, dialog, shell, net, Menu, nativeTheme } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

app.setAppUserModelId('app.stockinfos');

// Une seule fenêtre à la fois
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ---- journal de démarrage : %APPDATA%\StockInfos\journal.txt ----
function journal(msg) {
  try {
    const f = path.join(app.getPath('userData'), 'journal.txt');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (fs.existsSync(f) && fs.statSync(f).size > 200000) fs.renameSync(f, f + '.ancien');
    fs.appendFileSync(f, `${new Date().toISOString()}  ${msg}\n`);
  } catch (e) { /* rien */ }
}
process.on('uncaughtException', err => {
  journal('ERREUR ' + (err && err.stack || err));
  try { dialog.showErrorBox('StockInfos', 'Une erreur est survenue :\n' + (err && err.message || err)); } catch (e) { /* rien */ }
});

// Si la carte graphique a planté au lancement précédent, on démarre sans accélération
const noGpuFlag = () => path.join(app.getPath('userData'), 'sans-acceleration-graphique');
if (fs.existsSync(noGpuFlag())) app.disableHardwareAcceleration();

let win = null;
const dataDir = () => app.getPath('userData'); // %APPDATA%\StockInfos
const dataFile = () => path.join(dataDir(), 'donnees.json');
const backupDir = () => path.join(dataDir(), 'sauvegardes');

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveData(obj) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const f = dataFile();
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, f); // écriture atomique : pas de fichier à moitié écrit en cas de coupure
}

// Copie de sécurité quotidienne, 30 jours gardés
function dailyBackup() {
  try {
    if (!fs.existsSync(dataFile())) return;
    fs.mkdirSync(backupDir(), { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(backupDir(), `donnees-${day}.json`);
    if (!fs.existsSync(target)) fs.copyFileSync(dataFile(), target);
    const files = fs.readdirSync(backupDir()).filter(n => /^donnees-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
    while (files.length > 30) fs.unlinkSync(path.join(backupDir(), files.shift()));
  } catch (e) {
    console.error('Sauvegarde impossible', e);
  }
}

function overlay(dark) {
  return { color: dark ? '#202021' : '#e6e8ec', symbolColor: dark ? '#f2f2f2' : '#1a1a1a', height: 32 };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'StockInfos',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1b1c' : '#eef0f3',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlay(nativeTheme.shouldUseDarkColors),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Ctrl+R : recharger après une modification · F12 : outils de développement
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.control && input.key.toLowerCase() === 'r') { win.webContents.reloadIgnoringCache(); e.preventDefault(); }
    if (input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  // Affiche la fenêtre dès qu'elle est prête, et au plus tard après 5 secondes
  const showNow = () => { if (win && !win.isDestroyed() && !win.isVisible()) win.show(); };
  win.once('ready-to-show', showNow);
  win.webContents.once('did-finish-load', showNow);
  setTimeout(showNow, 5000);

  win.webContents.on('did-fail-load', (e, code, desc) => journal(`chargement impossible : ${code} ${desc}`));
  win.webContents.on('render-process-gone', (e, d) => {
    journal('interface arrêtée : ' + d.reason);
    if (d.reason !== 'clean-exit' && win && !win.isDestroyed()) setTimeout(() => win.reload(), 500);
  });
  win.on('unresponsive', () => journal('fenêtre bloquée'));

  // Les liens externes s'ouvrent dans le navigateur, jamais dans l'app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
}

// ---- échanges avec l'interface ----
ipcMain.on('load', e => { e.returnValue = loadData(); });

ipcMain.on('save', (e, obj) => {
  try {
    saveData(obj);
    e.returnValue = true;
  } catch (err) {
    e.returnValue = String(err && err.message || err);
  }
});

ipcMain.on('version', e => { e.returnValue = app.getVersion(); });

ipcMain.handle('fetch-ics', async (e, url) => {
  url = String(url || '').trim().replace(/^webcal:\/\//i, 'https://');
  if (!/^https:\/\//i.test(url)) throw new Error('adresse invalide');
  let res;
  try {
    res = await net.fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  } catch (err) {
    throw new Error('Google injoignable : vérifie la connexion internet');
  }
  if (res.status === 404) throw new Error('agenda introuvable (adresse incorrecte ?)');
  if (!res.ok) throw new Error('réponse ' + res.status + ' de Google');
  return await res.text();
});

// ---- logo de l'entreprise : cherche les images probables sur la page d'accueil du site ----
ipcMain.handle('fetch-logo', async (e, site) => {
  let base = String(site || '').trim();
  if (!base) throw new Error('adresse vide');
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
  let u;
  try { u = new URL(base); } catch (err) { throw new Error('adresse invalide'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('adresse invalide');
  const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StockInfos' };
  let html = '', page = u.href;
  try {
    const r = await net.fetch(u.href, { headers: UA });
    if (!r.ok) throw new Error('réponse ' + r.status);
    page = r.url || u.href;
    html = (await r.text()).slice(0, 1500000);
  } catch (err) { throw new Error('site injoignable : ' + (err.message || err)); }
  const abs = v => { try { return new URL(v.trim().split(/\s+/)[0], page).href; } catch (er) { return null; } };
  const attr = (tag, a) => { const m = tag.match(new RegExp('\\s' + a + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : ''; };
  const cand = [];
  const push = (src, why) => { const a = src && abs(src); if (a && /^https?:/i.test(a) && !cand.some(c => c.url === a)) cand.push({ url: a, why }); };
  // 1. images dont le nom, la classe, l'id ou le texte alternatif parlent de logo
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const t = m[0], src = [attr(t, 'data-lazy-src'), attr(t, 'data-src'), (attr(t, 'data-srcset') || '').split(',')[0], attr(t, 'src'), (attr(t, 'srcset') || '').split(',')[0]].find(v => v && !/^data:/i.test(v.trim()));
    if (/logo/i.test(t) && src) push(src, 'logo');
  }
  // 2. balises meta / icônes
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) { const t = m[0]; if (/(og:logo|itemprop=["']?logo)/i.test(t)) push(attr(t, 'content'), 'logo'); }
  const icons = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const t = m[0], rel = attr(t, 'rel').toLowerCase();
    if (/apple-touch-icon|icon/.test(rel)) { const sz = parseInt((attr(t, 'sizes') || '0').split('x')[0], 10) || (/apple/.test(rel) ? 180 : /svg/.test(attr(t, 'type')) ? 512 : 16); icons.push({ src: attr(t, 'href'), sz }); }
  }
  icons.sort((a, b) => b.sz - a.sz).forEach(i => push(i.src, 'icône'));
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) { const t = m[0]; if (/property=["']?og:image/i.test(t)) push(attr(t, 'content'), 'image de partage'); }
  push('/favicon.ico', 'icône');
  // télécharge les premières images valides
  const out = [];
  for (const c of cand.slice(0, 10)) {
    if (out.length >= 5) break;
    try {
      const r = await net.fetch(c.url, { headers: UA });
      if (!r.ok) continue;
      const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 100 || buf.length > 4000000) continue;
      const mime = /^image\//.test(type) ? type : /\.svg(\?|$)/i.test(c.url) ? 'image/svg+xml' : /\.png(\?|$)/i.test(c.url) ? 'image/png' : /\.ico(\?|$)/i.test(c.url) ? 'image/x-icon' : '';
      if (!mime) continue;
      out.push({ url: c.url, why: c.why, data: `data:${mime};base64,${buf.toString('base64')}` });
    } catch (err) { /* image suivante */ }
  }
  if (!out.length) throw new Error('aucune image trouvée sur ce site');
  return out;
});

ipcMain.handle('export', async (e, json) => {
  const day = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(win, {
    title: 'Exporter les données',
    defaultPath: path.join(app.getPath('documents'), `StockInfos-${day}.json`),
    filters: [{ name: 'Sauvegarde StockInfos', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, json);
  return r.filePath;
});

ipcMain.handle('import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Importer une sauvegarde',
    properties: ['openFile'],
    filters: [{ name: 'Sauvegarde StockInfos', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  return fs.readFileSync(r.filePaths[0], 'utf8');
});

ipcMain.handle('save-file', async (e, o) => {
  const ext = String(o && o.ext || 'txt').replace(/[^a-z0-9]/gi, '');
  const r = await dialog.showSaveDialog(win, {
    title: 'Enregistrer',
    defaultPath: path.join(app.getPath('documents'), path.basename(String(o && o.name || ('export.' + ext)))),
    filters: [{ name: String(o && o.label || ext), extensions: [ext] }]
  });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, String(o && o.content || ''));
  if (o && o.open) shell.openPath(r.filePath);
  return r.filePath;
});

ipcMain.handle('save-pdf', async (e, o) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Enregistrer en PDF',
    defaultPath: path.join(app.getPath('documents'), path.basename(String(o && o.name || 'document.pdf'))),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePath) return false;
  // fond blanc pendant l'export (sinon la couleur de la fenêtre apparaît dans les marges)
  const bg = win.getBackgroundColor();
  win.setBackgroundColor('#ffffff');
  let data;
  try { data = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true }); }
  finally { win.setBackgroundColor(bg); }
  fs.writeFileSync(r.filePath, data);
  shell.openPath(r.filePath);
  return r.filePath;
});

ipcMain.handle('open-data-folder', () => shell.openPath(dataDir()));

// impression papier avec fond blanc
ipcMain.handle('print', () => new Promise(res => {
  const bg = win.getBackgroundColor();
  win.setBackgroundColor('#ffffff');
  win.webContents.print({ printBackground: true }, ok => { win.setBackgroundColor(bg); res(ok); });
}));

ipcMain.on('theme', (e, dark) => {
  if (!win) return;
  try { win.setTitleBarOverlay(overlay(!!dark)); } catch (err) { /* plateforme sans overlay */ }
  win.setBackgroundColor(dark ? '#1b1b1c' : '#eef0f3');
});


// ---- mises à jour automatiques (GitHub Releases) ----
// À chaque nouvelle version : créer une « Release » vX.Y.Z sur GitHub et y déposer le .exe d'installation.
const UPDATE_REPO = (() => { try { return require('../package.json').updateRepo; } catch (e) { return null; } })() || 'Weauz/StockInfos';
const UPD = { state: 'idle', version: null, file: null, notes: '', installing: false, error: null };

function newer(a, b) { // a > b ?
  const pa = String(a).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}
function sendUpd() { if (win && !win.isDestroyed()) win.webContents.send('update', { state: UPD.state, version: UPD.version, notes: UPD.notes, error: UPD.error }); }

async function checkUpdate(manual) {
  if (UPD.state === 'downloading' || UPD.state === 'ready') { if (manual) sendUpd(); return; }
  if (!app.isPackaged && !manual) return; // pas en version locale (Lancer.bat)
  UPD.state = 'checking'; UPD.error = null; if (manual) sendUpd();
  try {
    const res = await net.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, { headers: { 'User-Agent': 'StockInfos', 'Accept': 'application/vnd.github+json' } });
    if (res.status === 404) { UPD.state = 'none'; return; }
    if (!res.ok) throw new Error('réponse ' + res.status + ' de GitHub');
    const rel = await res.json();
    const ver = String(rel.tag_name || '').replace(/^v/i, '');
    // n'accepte que l'installateur publié dans les releases de ce dépôt, en https
    const base = `https://github.com/${UPDATE_REPO}/releases/download/`.toLowerCase();
    const asset = (rel.assets || []).find(a => /\.exe$/i.test(a.name) && String(a.browser_download_url || '').toLowerCase().startsWith(base));
    if (!ver || !newer(ver, app.getVersion()) || !asset) { UPD.state = 'none'; return; }
    UPD.version = ver; UPD.notes = String(rel.body || '').slice(0, 600);
    if (!app.isPackaged) { UPD.state = 'available'; return; } // version locale : on signale seulement
    UPD.state = 'downloading'; sendUpd();
    const dl = await net.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'StockInfos' } });
    if (!dl.ok) throw new Error('téléchargement impossible (' + dl.status + ')');
    const buf = Buffer.from(await dl.arrayBuffer());
    if (asset.size && buf.length !== asset.size) throw new Error('fichier incomplet');
    const f = path.join(app.getPath('temp'), `StockInfos-maj-${ver}.exe`);
    fs.writeFileSync(f, buf);
    UPD.file = f; UPD.state = 'ready';
  } catch (e) {
    UPD.state = 'error'; UPD.error = String(e && e.message || e);
  } finally {
    if (UPD.state !== 'none' || manual) sendUpd();
  }
}

function runInstaller(relaunch) {
  if (!UPD.file || UPD.installing || !fs.existsSync(UPD.file)) return false;
  UPD.installing = true;
  const args = ['/S'];
  if (relaunch) args.push('/RELANCER');
  try { spawn(UPD.file, args, { detached: true, stdio: 'ignore' }).unref(); } catch (e) { UPD.installing = false; return false; }
  return true;
}

ipcMain.handle('update-check', () => checkUpdate(true));
ipcMain.handle('update-install', () => { if (runInstaller(true)) setTimeout(() => app.quit(), 300); });
ipcMain.on('update-state', e => { e.returnValue = { state: UPD.state, version: UPD.version, notes: UPD.notes, error: UPD.error }; });

// Si une mise à jour est prête quand on ferme l'app, elle s'installe toute seule
app.on('will-quit', () => { if (UPD.state === 'ready' && !UPD.installing) runInstaller(false); });

// ---- cycle de vie ----
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('child-process-gone', (e, d) => {
  journal(`processus ${d.type} arrêté : ${d.reason}`);
  if (d.type === 'GPU' && d.reason !== 'clean-exit' && !fs.existsSync(noGpuFlag())) {
    try { fs.writeFileSync(noGpuFlag(), 'Créé après un plantage de la carte graphique. Supprimer ce fichier pour réessayer avec accélération.'); } catch (err) { /* rien */ }
    journal('redémarrage sans accélération graphique');
    app.relaunch();
    app.exit(0);
  }
});

app.whenReady().then(() => {
  journal(`démarrage v${app.getVersion()} · Electron ${process.versions.electron} · Windows ${require('os').release()}`);
  Menu.setApplicationMenu(null);
  dailyBackup();
  createWindow();
  setTimeout(() => checkUpdate(false), 8000);
  setInterval(() => checkUpdate(false), 4 * 3600 * 1000);
});

app.on('window-all-closed', () => app.quit());
