// StockInfos — processus principal Electron (logiciel libre)
const { app, BrowserWindow, ipcMain, dialog, shell, net, Menu, nativeTheme, safeStorage } = require('electron');
const http = require('http');
const crypto = require('crypto');
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

// Copie juste avant une grosse suppression (10 gardées)
ipcMain.on('backup-now', e => {
  try {
    fs.mkdirSync(backupDir(), { recursive: true });
    const st = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const target = path.join(backupDir(), `avant-suppression-${st}.json`);
    if (fs.existsSync(dataFile())) fs.copyFileSync(dataFile(), target);
    const files = fs.readdirSync(backupDir()).filter(n => /^avant-suppression-/.test(n)).sort();
    while (files.length > 10) fs.unlinkSync(path.join(backupDir(), files.shift()));
    e.returnValue = target;
  } catch (x) { e.returnValue = null; }
});

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
  try {
    if (relaunch && process.platform === 'win32') {
      // cmd attend la fin de l'installation silencieuse, puis relance l'app elle-même
      const cmd = `/d /s /c "start "" /wait "${UPD.file}" /S /RELANCER & start "" "${process.execPath}""`;
      spawn(process.env.ComSpec || 'cmd.exe', [cmd], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
    } else {
      spawn(UPD.file, ['/S'], { detached: true, stdio: 'ignore' }).unref();
    }
    journal('mise à jour lancée' + (relaunch ? ' avec redémarrage' : ''));
  } catch (e) { UPD.installing = false; journal('mise à jour impossible : ' + e); return false; }
  return true;
}

ipcMain.handle('update-check', () => checkUpdate(true));
ipcMain.handle('update-install', () => {
  if (!UPD.file || UPD.installing || !fs.existsSync(UPD.file)) return;
  if (process.platform === 'win32') {
    // Electron lance l'installateur une fois l'app vraiment fermée (il n'est pas tué avec elle),
    // puis l'installateur rouvre StockInfos tout seul (/RELANCER)
    UPD.installing = true;
    try { app.relaunch({ execPath: UPD.file, args: ['/S', '/RELANCER'] }); journal('mise à jour lancée avec redémarrage'); }
    catch (e) { UPD.installing = false; journal('relance impossible : ' + e); if (!runInstaller(true)) return; }
    setTimeout(() => app.quit(), 200);
  } else if (runInstaller(true)) setTimeout(() => app.quit(), 300);
});
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


// ---- Connexion Google Agenda (envoi des chantiers vers un agenda « Chantiers StockInfos ») ----
// Client OAuth de type « Application de bureau » : pour Google, ces deux valeurs ne sont pas secrètes.
// Les codes sont dans app/google.json (jamais publié sur GitHub)
const GOOGLE = (() => { try { const g = JSON.parse(fs.readFileSync(path.join(__dirname, 'google.json'), 'utf8')); return { id: g.id || '', secret: g.secret || '' }; } catch (e) { return { id: '', secret: '' }; } })();
const G_SCOPE = 'openid email https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const G = { access: null, exp: 0, email: null };
const gFile = () => path.join(app.getPath('userData'), 'google.dat');
function gRead() {
  try {
    const b = fs.readFileSync(gFile());
    const txt = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8');
    return JSON.parse(txt);
  } catch (e) { return null; }
}
function gWrite(o) {
  const txt = JSON.stringify(o);
  fs.writeFileSync(gFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(txt) : Buffer.from(txt));
}
const b64u = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function gEmail(idToken) { try { return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString()).email || null; } catch (e) { return null; } }
async function gToken(params) {
  const r = await net.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: GOOGLE.id, client_secret: GOOGLE.secret, ...params }).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || ('Google a refusé (' + r.status + ')'));
  return j;
}
async function gAccess() {
  if (G.access && Date.now() < G.exp - 60000) return G.access;
  const st = gRead();
  if (!st || !st.refresh) throw new Error('non connecté');
  try {
    const j = await gToken({ grant_type: 'refresh_token', refresh_token: st.refresh });
    G.access = j.access_token; G.exp = Date.now() + (j.expires_in || 3600) * 1000;
    return G.access;
  } catch (e) {
    if (/invalid_grant/i.test(String(e.message))) { try { fs.unlinkSync(gFile()); } catch (x) {} throw new Error('connexion Google expirée, reconnecte-toi'); }
    throw e;
  }
}
ipcMain.handle('g-status', () => {
  const st = gRead();
  return { configured: !!(GOOGLE.id && GOOGLE.secret), connected: !!(st && st.refresh), email: st ? st.email : null };
});
let gLoginBusy = null;
ipcMain.handle('g-login', () => {
  if (!GOOGLE.id || !GOOGLE.secret) throw new Error('connexion Google pas encore configurée dans cette version');
  if (gLoginBusy) { try { gLoginBusy.close(); } catch (e) {} }
  return new Promise((resolve, reject) => {
    const verifier = b64u(crypto.randomBytes(48)), state = b64u(crypto.randomBytes(16));
    const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
    let done = false, redirect = '';
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); setTimeout(() => { try { srv.close(); } catch (e) {} }, 500); gLoginBusy = null; err ? reject(err) : resolve(val); };
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
      const page = (t, m) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><title>StockInfos</title><body style="font-family:system-ui;text-align:center;padding:60px"><h2>${t}</h2><p>${m}</p></body>`); };
      if (u.searchParams.get('state') !== state) { page('Lien invalide', 'Recommence depuis StockInfos.'); return; }
      if (u.searchParams.get('error')) { page('Connexion annulée', 'Tu peux fermer cet onglet.'); finish(new Error('connexion annulée')); return; }
      const code = u.searchParams.get('code');
      try {
        const j = await gToken({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect });
        if (!j.refresh_token) throw new Error('Google n\'a pas donné d\'accès durable, réessaie');
        if (!String(j.scope || '').includes('calendar.app.created')) throw new Error('il faut cocher l\'accès à Google Agenda');
        const email = gEmail(j.id_token || '');
        gWrite({ refresh: j.refresh_token, email });
        G.access = j.access_token; G.exp = Date.now() + (j.expires_in || 3600) * 1000; G.email = email;
        page('C\'est bon !', 'StockInfos est connecté à ton Google Agenda. Tu peux fermer cet onglet.');
        journal('Google connecté');
        finish(null, { email });
        if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
      } catch (e) { page('Connexion impossible', String(e.message || e)); finish(e); }
    });
    gLoginBusy = srv;
    const timer = setTimeout(() => finish(new Error('temps écoulé, réessaie')), 5 * 60000);
    srv.listen(0, '127.0.0.1', () => {
      redirect = 'http://127.0.0.1:' + srv.address().port;
      const q = new URLSearchParams({ client_id: GOOGLE.id, redirect_uri: redirect, response_type: 'code', scope: G_SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent' });
      shell.openExternal('https://accounts.google.com/o/oauth2/v2/auth?' + q.toString());
    });
    srv.on('error', e => finish(e));
  });
});
ipcMain.handle('g-logout', async () => {
  // On oublie seulement la connexion sur ce PC, sans révoquer l'accès chez Google :
  // sinon, à la reconnexion, Google ne laisse plus l'appli écrire dans l'agenda déjà créé et elle en recréerait un.
  try { fs.unlinkSync(gFile()); } catch (e) {}
  G.access = null; G.exp = 0;
  return true;
});
// Appels limités à l'API Google Agenda
ipcMain.handle('g-api', async (e, o) => {
  const method = String(o && o.method || 'GET').toUpperCase(), p = String(o && o.path || '');
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method) || !/^\/(calendars|users\/me\/calendarList)(\/|\?|$)/.test(p) || p.includes('..')) throw new Error('appel refusé');
  const tok = await gAccess();
  const r = await net.fetch('https://www.googleapis.com/calendar/v3' + p, { method, headers: { Authorization: 'Bearer ' + tok, ...(o.body ? { 'Content-Type': 'application/json' } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  const txt = await r.text();
  let json = null; try { json = txt ? JSON.parse(txt) : null; } catch (x) {}
  return { status: r.status, json };
});


// ---- Base de données partagée (Supabase) : code de connexion collé une fois dans Paramètres ----
const dbFile = () => path.join(app.getPath('userData'), 'base.dat');
function dbRead() {
  try { const b = fs.readFileSync(dbFile()); return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8')); } catch (e) { return null; }
}
function dbWrite(o) { const t = JSON.stringify(o); fs.writeFileSync(dbFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : Buffer.from(t)); }
const dbDevice = () => { try { return require('os').hostname().slice(0, 60); } catch (e) { return 'PC'; } };
async function dbFetch(cfg, method, p, body, prefer) {
  const r = await net.fetch(cfg.u + '/rest/v1/' + p, { method, headers: { apikey: cfg.a, 'x-si-key': cfg.k, 'x-si-device': encodeURIComponent(dbDevice()), 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let json = null; try { json = t ? JSON.parse(t) : null; } catch (e) {}
  return { status: r.status, json };
}
function dbParse(code) {
  const m = /^SI1\.([A-Za-z0-9_\-+/=]+)$/.exec(String(code || '').trim());
  if (!m) throw new Error('code de connexion invalide');
  const o = JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(o.u || '') || !o.a || !o.k) throw new Error('code de connexion invalide');
  return { u: o.u, a: o.a, k: o.k };
}
ipcMain.handle('db-status', () => { const c = dbRead(); return { connected: !!c, host: c ? c.u.replace('https://', '') : null, device: dbDevice() }; });
ipcMain.handle('db-connect', async (e, code) => {
  const cfg = dbParse(code);
  // test : une écriture technique, refusée si la clé n'est pas la bonne
  const r = await dbFetch(cfg, 'POST', 'si_items?on_conflict=kind,id', [{ kind: 'setting', id: '_ping', data: { at: new Date().toISOString() } }], 'resolution=merge-duplicates,return=minimal');
  if (r.status >= 300) throw new Error(r.status === 401 || r.status === 403 ? 'clé refusée par la base' : 'base injoignable (' + r.status + ')');
  dbWrite(cfg); journal('base de données connectée');
  return true;
});
ipcMain.handle('db-code', () => { const c = dbRead(); return c ? 'SI1.' + Buffer.from(JSON.stringify({ u: c.u, a: c.a, k: c.k })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_') : null; });
ipcMain.handle('db-disconnect', () => { try { fs.unlinkSync(dbFile()); } catch (e) {} return true; });
ipcMain.handle('db-req', async (e, o) => {
  const cfg = dbRead(); if (!cfg) throw new Error('base non connectée');
  const method = String(o && o.method || 'GET').toUpperCase(), p = String(o && o.path || '');
  if (!['GET', 'POST', 'PATCH'].includes(method) || !/^si_(items|audit)(\?|$)/.test(p)) throw new Error('appel refusé');
  return dbFetch(cfg, method, p, o.body, o.prefer);
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
