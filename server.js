'use strict';
/*
 * Remote Station — serveur VPS
 * Relie la page "Station" (au club, FTX-1 en Web Serial) aux opérateurs (navigateur).
 * Aucune dépendance externe : modules Node natifs uniquement.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ws = require('./lib/ws-lite');
const auth = require('./lib/auth');
const ULAW = require('./public/js/ulaw.js');
// Pilotes de radio disponibles (le modèle est annoncé par la page Station)
const DRIVERS = {
  ftx1: require('./public/js/ftx1.js'),
  ftdx10: require('./public/js/ftdx10.js'),
  ic7300: require('./public/js/ic7300.js')
};
const DEFAULT_RIG = DRIVERS.ftx1;
const rig = () => (station && station.rig) || DEFAULT_RIG;

// ---------------------------------------------------------------- configuration
const ROOT = __dirname;
const CFG_PATH = process.env.RS_CONFIG || path.join(ROOT, 'config.json');
const DEFAULTS = {
  listen: '127.0.0.1',
  port: 9000,
  clubName: 'Remote Station',
  stationCall: 'OP0P',
  stationToken: '',
  allowTx: false,
  maxTxSeconds: 120,
  pttHeartbeatMs: 1500,
  controlIdleMinutes: 15,
  // Protection du PA : émission coupée si le ROS dépasse maxSwr pendant swrHoldMs (0 = pas de protection).
  // Le PTT reste ensuite refusé sur cette fréquence (±25 kHz) jusqu'à un accord (TUNE).
  // Chien de garde de la page Station : retour en réception si le TRX émet sans modulation pendant txSilenceSeconds,
  // ou sans interruption pendant txHardMaxSeconds (PTT ou micro bloqué au club…)
  txSilenceSeconds: 120,
  txHardMaxSeconds: 300,
  maxSwr: 2.5,
  swrHoldMs: 700,
  // Déconnexion automatique d'un membre resté inactif (0 = jamais). Jamais pendant une émission.
  sessionIdleMinutes: 15,
  // Modes numériques : indicatif émis (FT8, FT4, RTTY, CW) et locator de la station (messages CQ)
  digiCall: 'ON5VL',
  stationGrid: '',
  stationQth: 'LIEGE',
  // QO-100 : fréquence de la FI (MHz) qui correspond à 2400,000 MHz pour chaque convertisseur 2,4 GHz
  // (432,5 = OL 1967,5 MHz, ex. DXpatrol ; mettre 432 pour un OL 1968 MHz ; 0 = pas de convertisseur sur cette bande)
  qo100If: { '2m': 144.5, '70cm': 432.5, '23cm': 1296.5 },
  // Un membre reste connecté quand il actualise la page ou revient plus tard (sur le même navigateur),
  // jusqu'à rememberDays jours après sa dernière visite (0 = mot de passe à chaque fois). « Déconnexion » l'oublie.
  rememberDays: 7,
  usersFile: 'users.json',
  logDir: 'logs',
  txRanges: [],
  // Seuls ces préfixes peuvent se connecter
  allowedPrefixes: ['ON', 'OO', 'OP', 'OQ', 'OR', 'OS', 'OT'],
  // Puissance maximale par début d'indicatif (première règle qui correspond), sinon defaultMaxWatts
  powerRules: [{ prefix: 'ON3', maxWatts: 25 }],
  defaultMaxWatts: 1500,
  // Indicatifs qui ne peuvent jamais émettre (écouteurs ONL), quel que soit leur compte
  rxOnlyPrefixes: ['ONL']
};
let cfg;
try {
  cfg = Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')));
} catch (e) {
  console.error('Impossible de lire ' + CFG_PATH + ' : ' + e.message);
  console.error('Lancez d’abord : node init-config.js');
  process.exit(1);
}
if (!cfg.stationToken || cfg.stationToken.length < 24) {
  console.error('stationToken absent ou trop court (24 caractères minimum) dans ' + CFG_PATH);
  process.exit(1);
}
const USERS_FILE = path.resolve(ROOT, cfg.usersFile);
const LOG_DIR = path.resolve(ROOT, cfg.logDir);
fs.mkdirSync(LOG_DIR, { recursive: true });

// ---------------------------------------------------------------- journal des accès
// Événements visibles par les membres connectés (sans adresse IP)
const PUBLIC_EVENTS = ['login', 'logout', 'control_take', 'control_release', 'tx_start', 'tx_stop', 'tune', 'power_limit', 'rig_switch', 'swr_cut', 'tx_watchdog',
  'station_online', 'station_offline', 'trx_online', 'trx_offline'];
const recentEvents = [];
function journal(ev, data) {
  const d = new Date();
  const line = JSON.stringify(Object.assign({ ts: d.toISOString(), ev }, data)) + '\n';
  if (PUBLIC_EVENTS.indexOf(ev) >= 0) {
    const e = Object.assign({ ts: d.toISOString(), ev }, data);
    delete e.ip;
    recentEvents.unshift(e);
    if (recentEvents.length > 40) recentEvents.pop();
    if (typeof ops !== 'undefined') {
      const msg = JSON.stringify({ t: 'event', e });
      for (const c of ops) if (c.open) c.send(msg);
    }
  }
  const f = path.join(LOG_DIR, 'access-' + d.toISOString().slice(0, 7) + '.log');
  fs.appendFile(f, line, () => {});
  console.log('[' + ev + ']', JSON.stringify(data));
}

// ---------------------------------------------------------------- HTTP statique
const PUB = path.join(ROOT, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};
const ROUTES = { '/': '/index.html', '/station': '/station.html', '/digi': '/digi.html', '/aide': '/aide.html', '/help': '/help.html' };

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// HTTPS direct (serveur Windows sans nginx) : "tls": { "cert": "cert.pem", "key": "key.pem" } dans config.json
function makeServer(handler) {
  const t = cfg.tls;
  if (t && t.cert && t.key) {
    try {
      return require('https').createServer({ cert: fs.readFileSync(path.resolve(ROOT, t.cert)), key: fs.readFileSync(path.resolve(ROOT, t.key)) }, handler);
    } catch (e) {
      console.error('Certificat TLS illisible (' + e.message + ') : serveur en HTTP');
    }
  }
  return http.createServer(handler);
}
const server = makeServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (e) {
    res.writeHead(400);
    return res.end();
  }
  if (req.method === 'POST' && p === '/station/login') return stationLoginPost(req, res);
  if (req.method === 'POST' && p === '/station/logout') return stationLogout(req, res);
  if (req.method === 'POST' && p === '/station/token') return stationTokenPost(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  if (p === '/station/whoami') {
    const a = stationAdmin(req);
    return sendJson(res, a ? 200 : 401, a || {});
  }
  if (p === '/api/info') {
    return sendJson(res, 200, {
      clubName: cfg.clubName,
      stationCall: cfg.stationCall,
      allowTx: cfg.allowTx,
      maxTxSeconds: cfg.maxTxSeconds,
      txRanges: cfg.txRanges,
      version: VERSION
    });
  }
  p = ROUTES[p] || p;
  const fp = path.normalize(path.join(PUB, p));
  if (!fp.startsWith(PUB + path.sep) || /[:\0]/.test(path.relative(PUB, fp))) {
    res.writeHead(404);
    return res.end();
  }
  const key = pubKey(fp);
  if (key === 'station-login.html') { res.writeHead(404); return res.end(); }
  if (ST_GATED.indexOf(key) >= 0 && !stationAdmin(req)) {
    if (key === 'station.html') return sendStationLogin(res, '');
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('Réservé aux administrateurs');
  }
  fs.readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Introuvable');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

// ---------------------------------------------------------------- état
let station = null; // { conn, ip, since }
let lastHwSplit = null; // dernier état du SPLIT de la face avant (FTX-1)
let txMismatchAt = 0; // SPLIT virtuel : depuis quand le TRX émet sur un autre VFO que celui choisi
let txSel = 0; // SPLIT virtuel (FTX-1) : VFO d'émission choisi (0 = A, 1 = B), envoyé au TRX seulement en émission
let radio = { connected: false, freq: null, mode: null, modeCode: null, freqB: null, modeB: null, modeCodeB: null, tx: 0, smeter: 0 };
const ops = new Set(); // connexions opérateurs authentifiées
let controller = null; // connexion qui a la main
let swrLock = null;     // { freq, swr } : ROS trop élevé constaté à cette fréquence
let swrHighSince = 0;
// Audio BF du TRX : la station n'envoie le son que si au moins un membre écoute
let audio = { active: false, want: false, frames: 0 };
function listeners() {
  let n = 0;
  for (const c of ops) if (c.listen) n++;
  return n;
}
function audioWanted() { return listeners() > 0 || digiModes().size > 0; }
function updateAudioWant() {
  // La station envoie la BF s'il y a un membre à l'écoute ou une fenêtre de décodage ouverte
  const want = audioWanted();
  if (want !== audio.want) {
    audio.want = want;
    toStation({ t: 'audio_want', on: want });
  }
}
// Trame audio de la station → décodeur et chaque membre à l'écoute (un client trop lent saute des trames
// au lieu d'accumuler du retard). 0x01 : µ-law 8 kHz (ancienne page Station), 0x02 : PCM 16 bits 12 kHz.
function relayAudio(buf) {
  if (!buf || buf.length < 2 || buf.length > 4000) return;
  audio.frames++;
  let out = buf;
  if (buf[0] === 0x02) {
    const pcm = ULAW.decodeFrame(buf);
    if (!pcm) return;
    if (digi.worker && digiModes().size) digi.worker.postMessage({ t: 'audio', samples: pcm, at: Date.now() }, [pcm.buffer]);
    if (!listeners()) return;
    out = Buffer.from(ULAW.encodeFrame(ULAW.decodeFrame(buf), 12000)); // µ-law 12 kHz pour l'écoute (96 kbit/s)
  } else if (buf[0] !== 0x01) {
    return;
  }
  for (const c of ops) if (c.listen && c.backlog < 32768) c.send(out);
}

// ---------------------------------------------------------------- modes numériques (FT8 / FT4)
// Le décodage tourne dans un Worker (lib/digi-worker.js) dès qu'un membre ouvre la fenêtre FT8/FT4.
const digi = { worker: null, hist: { FT8: [], FT4: [], FT2: [], WSPR: [], JT65: [] }, latency: null, ms: 0, last: 0, dial: 0, jtty: new Map() };
const DIGI_MODES = ['FT8', 'FT4', 'FT2', 'RTTY', 'WSPR', 'JT65', 'JTTY', 'CW', 'SSTV'];
// Images SSTV reçues (mémoire + dossier sstv/)
const { SstvStore } = require('./lib/sstv-store.js');
const sstvStore = new SstvStore(path.join(ROOT, 'sstv'), (m) => console.error(m));
function sstvSendImage(conn, it) {
  send(conn, { t: 'sstv_img', img: sstvStore.meta(it) });
  for (let y = 0; y < it.lines; y++) conn.send(sstvStore.frame(it, y));
}
// Réglages CW d'un membre : tonalité (Hz), largeur du filtre, silencieux → clé du décodeur
function cwCfg(r) {
  if (!r || typeof r !== 'object') return null;
  const f = Math.round(Number(r.f));
  const bw = [50, 100, 200, 400].indexOf(Number(r.bw)) >= 0 ? Number(r.bw) : 100;
  const squelch = Math.max(0, Math.min(20, Math.round(Number(r.squelch))));
  if (!(f >= 200 && f <= 2800) || !Number.isFinite(squelch)) return null;
  return { f, bw, squelch, key: [f, bw, squelch].join('/') };
}
// Réglages RTTY d'un membre (chacun peut suivre un signal différent) → clé du démodulateur
function rttyCfg(r) {
  if (!r || typeof r !== 'object') return null;
  const f = Math.round(Number(r.f));
  const shift = [170, 200, 425, 850].indexOf(Number(r.shift)) >= 0 ? Number(r.shift) : 170;
  const baud = [45.45, 50, 75, 100].indexOf(Number(r.baud)) >= 0 ? Number(r.baud) : 45.45;
  const squelch = Math.max(4, Math.min(25, Math.round(Number(r.squelch) || 12)));
  if (!(f >= 200 && f <= 2900)) return null;
  const c = { f, shift, baud, rev: !!r.rev, squelch };
  c.key = [f, shift, baud, c.rev ? 1 : 0, squelch].join('/');
  return c;
}
function digiModes() {
  const s = new Set();
  for (const c of ops) if (c.digi) s.add(c.digi);
  return s;
}
function startDigi() {
  if (digi.worker) return;
  try {
    const { Worker } = require('worker_threads');
    digi.worker = new Worker(path.join(ROOT, 'lib', 'digi-worker.js'));
  } catch (e) {
    console.error('Décodeur FT8/FT4 indisponible : ' + e.message);
    return;
  }
  digi.worker.on('message', onDigi);
  digi.worker.on('error', (e) => console.error('Décodeur FT8/FT4 : ' + e.message));
  digi.worker.on('exit', () => { digi.worker = null; });
}
function updateDigi() {
  const modes = digiModes();
  if (modes.size) startDigi();
  if (digi.worker) {
    digi.worker.postMessage({ t: 'modes', modes: Array.from(modes) });
    digi.worker.postMessage({ t: 'dial', hz: radio.freq || 0 });
    const cfgs = {};
    for (const c of ops) if (c.digi === 'RTTY' && c.rtty) cfgs[c.rtty.key] = c.rtty;
    digi.worker.postMessage({ t: 'rtty', cfgs: Object.values(cfgs) });
    const cwc = {};
    for (const c of ops) if (c.digi === 'CW' && c.cw) cwc[c.cw.key] = c.cw;
    digi.worker.postMessage({ t: 'cw', cfgs: Object.values(cwc) });
  }
  updateAudioWant();
}
function onDigi(m) {
  if (m.t === 'wf') {
    // Ligne de cascade : [0x10, octets dB*2+240 par case de 6,25 Hz depuis 0 Hz]
    const fr = Buffer.allocUnsafe(m.row.length + 1);
    fr[0] = 0x10;
    Buffer.from(m.row.buffer, m.row.byteOffset, m.row.length).copy(fr, 1);
    for (const c of ops) if (c.digi && c.backlog < 65536) c.send(fr);
    return;
  }
  if (m.t === 'log') return console.error(m.msg);
  if (m.t === 'jtty') {
    // Messages JTTY : dernière version de chaque message (le texte grandit trame après trame)
    digi.jtty.set(m.u.key, m.u);
    if (digi.jtty.size > 150) digi.jtty.delete(digi.jtty.keys().next().value);
    const msg = JSON.stringify({ t: 'jtty', u: m.u });
    for (const c of ops) if (c.digi === 'JTTY') c.send(msg);
    return;
  }
  if (m.t === 'rtty_text' || m.t === 'rtty_lvl') {
    const msg = JSON.stringify(m.t === 'rtty_text' ? { t: 'rtty', text: m.text } : { t: 'rtty_lvl', m: m.m, s: m.s, c: m.c });
    for (const c of ops) if (c.digi === 'RTTY' && c.rtty && c.rtty.key === m.key) c.send(msg);
    return;
  }
  if (m.t === 'sstv') {
    const e = m.e;
    const watchers = Array.from(ops).filter((c) => c.digi === 'SSTV');
    if (e.t === 'start') {
      const it = sstvStore.start(e);
      journal('sstv_rx', { mode: e.mode, shift: e.shift });
      for (const c of watchers) send(c, { t: 'sstv_start', img: sstvStore.meta(it), shift: e.shift });
    } else if (e.t === 'line') {
      const it = sstvStore.line(e);
      if (it) { const fr = sstvStore.frame(it, e.y); for (const c of watchers) c.send(fr); }
    } else if (e.t === 'end') {
      const it = sstvStore.end(e);
      if (it) for (const c of watchers) send(c, { t: 'sstv_end', img: sstvStore.meta(it), refreshed: !!e.rgb, slant: e.slant, why: e.why });
    }
    return;
  }
  if (m.t === 'cw_text' || m.t === 'cw_lvl') {
    const msg = JSON.stringify(m.t === 'cw_text' ? { t: 'cw', text: m.text } : { t: 'cw_lvl', s: m.s, wpm: m.wpm, on: m.on });
    for (const c of ops) if (c.digi === 'CW' && c.cw && c.cw.key === m.key) c.send(msg);
    return;
  }
  if (m.t === 'decodes') {
    const item = { slot: m.slot, list: m.list };
    const h = digi.hist[m.mode];
    if (!h) return;
    h.push(item);
    while (h.length > (m.mode === 'FT2' ? 120 : 40)) h.shift();
    digi.latency = m.latency;
    digi.ms = m.ms;
    digi.last = Date.now();
    const msg = JSON.stringify({ t: 'ftx', mode: m.mode, slot: m.slot, list: m.list, latency: m.latency });
    for (const c of ops) if (c.digi === m.mode) c.send(msg);
  }
}

// ---------------------------------------------------------------- carnet de trafic et carnets en ligne (version « extended »)
const LB = require('./lib/logbook.js');
const { Sync, SERVICES: LOG_SERVICES } = require('./lib/logsync.js');
const VERSION = (() => { try { return require('./package.json').version; } catch (e) { return '0'; } })();
// Dans le dossier des journaux par défaut : le seul où le service systemd du VPS peut écrire (ReadWritePaths)
const book = new LB.Logbook(cfg.logbookFile ? path.resolve(ROOT, cfg.logbookFile) : path.join(LOG_DIR, 'logbook.json'));
const LOGCFG_FILE = cfg.logbookConfig ? path.resolve(ROOT, cfg.logbookConfig) : path.join(LOG_DIR, 'logbook-config.json');
const LOGCFG_DEFAULT = {
  clublog: { auto: false, email: '', password: '', api: '', delay: 15 },
  eqsl: { auto: false, user: '', password: '', nickname: '', delay: 5 },
  qrz: { auto: false, keys: {}, delay: 5 },
  lotw: { auto: false, tqsl: process.platform === 'win32' ? 'C:\\Program Files (x86)\\TrustedQSL\\tqsl.exe' : '/usr/bin/tqsl', tqslDir: '', location: '', password: '', login: '', webPassword: '', delay: 0, lastConfirm: '' },
  udp: []
};
let logCfg = (() => {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(LOGCFG_FILE, 'utf8')); } catch (e) { /* pas encore réglé */ }
  const out = {};
  for (const k of Object.keys(LOGCFG_DEFAULT)) out[k] = Array.isArray(LOGCFG_DEFAULT[k]) ? (Array.isArray(c[k]) ? c[k] : []) : Object.assign({}, LOGCFG_DEFAULT[k], c[k] || {});
  return out;
})();
function saveLogCfg() {
  fs.writeFileSync(LOGCFG_FILE, JSON.stringify(logCfg, null, 2) + '\n', { mode: 0o600 });
}
// Champs secrets : jamais renvoyés au navigateur (seulement « déjà enregistré »)
const SECRETS = { clublog: ['password', 'api'], eqsl: ['password'], lotw: ['password', 'webPassword'] };
function logCfgPublic() {
  const o = JSON.parse(JSON.stringify(logCfg));
  for (const [s, keys] of Object.entries(SECRETS)) for (const k of keys) { o[s]['has_' + k] = !!o[s][k]; o[s][k] = ''; }
  o.qrz.has_keys = {};
  for (const [c, v] of Object.entries(o.qrz.keys || {})) o.qrz.has_keys[c] = !!v;
  o.qrz.keys = {};
  return o;
}
function setLogCfg(n) {
  if (!n || typeof n !== 'object') return;
  const str = (v, max) => String(v == null ? '' : v).slice(0, max || 200);
  for (const s of ['clublog', 'eqsl', 'qrz', 'lotw']) {
    const src = n[s];
    if (!src || typeof src !== 'object') continue;
    const dst = logCfg[s];
    dst.auto = !!src.auto;
    const d = Number(src.delay);
    if (Number.isFinite(d)) dst.delay = Math.max(0, Math.min(120, Math.round(d)));
    for (const k of Object.keys(LOGCFG_DEFAULT[s])) {
      if (k === 'auto' || k === 'delay' || k === 'keys' || k === 'lastConfirm' || src[k] === undefined) continue;
      const secret = (SECRETS[s] || []).indexOf(k) >= 0;
      if (secret && src[k] === '') continue;               // champ laissé vide : on garde l'ancien
      dst[k] = src[k] === '__effacer__' ? '' : str(src[k], 300);
    }
    if (s === 'qrz' && src.keys && typeof src.keys === 'object') {
      for (const [c, v] of Object.entries(src.keys)) {
        const call = String(c).toUpperCase().replace(/[^A-Z0-9/]/g, '').slice(0, 15);
        if (!call || v === '') continue;
        if (v === '__effacer__') delete dst.keys[call]; else dst.keys[call] = str(v, 80);
      }
    }
  }
  // Le serveur n'exécute que TQSL (pas n'importe quel programme choisi depuis le dashboard)
  if (!/^tqsl(\.exe)?$/i.test(path.basename(String(logCfg.lotw.tqsl || '').replace(/\\/g, '/')))) logCfg.lotw.tqsl = LOGCFG_DEFAULT.lotw.tqsl;
  if (Array.isArray(n.udp)) {
    logCfg.udp = n.udp.slice(0, 8).map((u) => ({
      enabled: !!u.enabled, host: str(u.host, 100).trim(), port: Math.max(0, Math.min(65535, parseInt(u.port, 10) || 0)),
      format: ['wsjtx-adif', 'wsjtx-qso', 'n1mm', 'adif'].indexOf(u.format) >= 0 ? u.format : 'wsjtx-adif', label: str(u.label, 40)
    })).filter((u) => u.host && u.port);
  }
  saveLogCfg();
  sync.resetStops();
}
const stationCalls = () => Array.from(new Set([cfg.digiCall].concat(String(cfg.stationCall || '').split(/[\s/,]+/)).map((c) => String(c || '').toUpperCase()).filter((c) => /^[A-Z0-9]{3,10}$/.test(c))));
const sync = new Sync({
  book, version: VERSION, station: String(cfg.digiCall || 'ON5VL').toUpperCase(), urls: cfg.logUrls, // logUrls : essais seulement
  getCfg: () => logCfg,
  setLastConfirm: (d) => { logCfg.lotw.lastConfirm = d; saveLogCfg(); },
  log: (m) => console.error('Logs : ' + m),
  onJob: (job, ev) => {
    const msg = { t: 'log_job', job: { id: job.id, service: job.service, name: job.name, total: job.total, done: job.done, ok: job.ok, fail: job.fail, auto: job.auto, by: job.by }, line: ev.line, fin: !!ev.fin, step: ev.step };
    for (const c of ops) if (c.user.admin || (job.by && c.user.call === job.by)) send(c, msg);
    if (ev.fin) {
      if (job.fail && job.auto) journal('log_sync_fail', { service: job.service, line: ev.line });
      for (const c of ops) send(c, { t: 'log_changed' });
    }
  }
});
function logCtx(conn, m) {
  const calls = stationCalls();
  const st = String((m && m.station) || cfg.digiCall || calls[0] || '').toUpperCase();
  return { operator: conn.user.call, stationCallsign: calls.indexOf(st) >= 0 ? st : calls[0], myGrid: cfg.stationGrid || '' };
}
function logCanEdit(conn, q) { return conn.user.admin || (q && q.by === conn.user.call); }
function qsoForClient(q) { return Object.assign({}, q); }

// Messages entre membres (mémoire seulement, perdus au redémarrage) : discussion, demandes de main, passages de main
const chatLog = [];
function chatPush(item) {
  item.ts = Date.now();
  chatLog.push(item);
  while (chatLog.length > 40) chatLog.shift();
  for (const c of ops) send(c, { t: 'chat', m: item });
}
let connSeq = 0;
let lastCtrlActivity = 0;
let ptt = { active: false, conn: null, since: 0, lastBeat: 0 };
const fails = new Map(); // ip -> { n, until }

// ---------------------------------------------------------------- macros personnelles (RTTY, CW…) de chaque membre
// Comme dans FLDIGI : chaque opérateur garde ses propres messages, quel que soit le PC d'où il se connecte.
const MACROS_FILE = path.join(ROOT, 'macros.json');
let macros = {};
try { macros = JSON.parse(fs.readFileSync(MACROS_FILE, 'utf8')) || {}; } catch (e) { macros = {}; }
function saveMacros() {
  fs.writeFile(MACROS_FILE, JSON.stringify(macros), { mode: 0o600 }, (e) => { if (e) console.error('macros.json : ' + e.message); });
}
function setMacros(call, mode, list) {
  if (['RTTY', 'CW', 'FT8', 'JTTY'].indexOf(mode) < 0 || !Array.isArray(list)) return false;
  const clean = list.slice(0, 24).map((m) => ({
    name: String((m && m.name) || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 14),
    text: String((m && m.text) || '').replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').slice(0, 600)
  }));
  macros[call] = Object.assign({}, macros[call], { [mode]: clean });
  saveMacros();
  return true;
}

// ---------------------------------------------------------------- sessions mémorisées (« rester connecté »)
// Seule l'empreinte SHA-256 du jeton de session est gardée (sessions.json) : le fichier ne permet pas de se connecter.
const SESS_FILE = path.join(ROOT, 'sessions.json');
let sessions = {};
try { sessions = JSON.parse(fs.readFileSync(SESS_FILE, 'utf8')) || {}; } catch (e) { sessions = {}; }
let sessSaveTimer = null;
function saveSessions() {
  clearTimeout(sessSaveTimer);
  sessSaveTimer = setTimeout(() => {
    const now = Date.now();
    for (const h in sessions) if (!sessions[h] || sessions[h].exp < now) delete sessions[h];
    fs.writeFile(SESS_FILE, JSON.stringify(sessions), { mode: 0o600 }, (e) => { if (e) console.error('sessions.json : ' + e.message); });
  }, 500);
}
const sessHash = (tok) => crypto.createHash('sha256').update(String(tok)).digest('hex');
function newSession(call) {
  if (!(cfg.rememberDays > 0)) return null;
  const tok = crypto.randomBytes(32).toString('base64url');
  sessions[sessHash(tok)] = { call, exp: Date.now() + cfg.rememberDays * 86400000 };
  saveSessions();
  return tok;
}
function dropSession(conn) {
  if (conn.sessHash && sessions[conn.sessHash]) { delete sessions[conn.sessHash]; saveSessions(); }
  conn.sessHash = null;
}

// Empreinte du programme de la page Station (page, pilotes des TRX) : après une mise à jour du serveur, la page Station
// ouverte au club la compare à celle qu'elle a chargée et se recharge toute seule si le programme a changé
// (sinon elle continuerait à envoyer au TRX les commandes de l'ancienne version).
let catAsk = null; // dernière lecture CAT demandée par un administrateur (réponse renvoyée à lui seul)
let stationBounce = null; // rechargement à distance d'une ancienne page Station en cours
const STATION_CODE = (() => {
  const h = crypto.createHash('sha256');
  for (const f of ['station.html', 'js/station.js', 'js/station-core.js', 'js/yaesu.js', 'js/ftx1.js', 'js/ftdx10.js', 'js/ic7300.js', 'js/rigs-catalog.js', 'js/ulaw.js']) {
    try { h.update(fs.readFileSync(path.join(PUB, f))); } catch (e) { h.update(f); }
  }
  return h.digest('hex').slice(0, 16);
})();

// ---------------------------------------------------------------- page Station réservée aux administrateurs
// /station (et son programme) n'est envoyée qu'à un navigateur connecté avec un compte administrateur
// (indicatif + mot de passe) ; cookie HttpOnly valable un an sur le PC du club, renouvelé à chaque ouverture.
// Seule l'empreinte du cookie est gardée (logs/station-sessions.json). Le jeton de station reste exigé pour se brancher.
const ST_COOKIE = 'rs_station';
const ST_DAYS = 365;
const ST_GATED = ['station.html', 'js/station.js', 'js/station-core.js'];
// Chemin comparé tel que le système de fichiers le comprend (Windows : majuscules, points et espaces finaux ignorés)
const pubKey = (fp) => path.relative(PUB, fp).split(path.sep).map((x) => x.replace(/[. ]+$/, '')).join('/').toLowerCase();
const ST_FILE = path.join(LOG_DIR, 'station-sessions.json');
let stSess = {};
try { stSess = JSON.parse(fs.readFileSync(ST_FILE, 'utf8')) || {}; } catch (e) { stSess = {}; }
function saveStSess() {
  const now = Date.now();
  for (const h in stSess) if (!stSess[h] || stSess[h].exp < now) delete stSess[h];
  fs.writeFile(ST_FILE, JSON.stringify(stSess), { mode: 0o600 }, (e) => { if (e) console.error('station-sessions.json : ' + e.message); });
}
function readCookie(req, name) {
  const m = new RegExp('(?:^|;\\s*)' + name + '=([A-Za-z0-9_-]{20,100})').exec(req.headers.cookie || '');
  return m ? m[1] : '';
}
const isHttps = (req) => !!(req.socket && req.socket.encrypted) || /^https$/i.test(String(req.headers['x-forwarded-proto'] || ''));
function stCookie(req, val, maxAge) {
  return ST_COOKIE + '=' + val + '; Path=/; Max-Age=' + maxAge + '; HttpOnly; SameSite=Strict' + (isHttps(req) ? '; Secure' : '');
}
/** Administrateur connecté à la page Station sur ce navigateur ? → { call } ou null */
function stationAdmin(req) {
  const tok = readCookie(req, ST_COOKIE);
  if (!tok) return null;
  const h = sessHash(tok);
  const s = stSess[h];
  const now = Date.now();
  // Session ouverte par le jeton de station : valable tant que le jeton n'a pas changé
  if (s && s.token && s.exp > now) {
    if (s.exp - now < (ST_DAYS - 1) * 86400000) { s.exp = now + ST_DAYS * 86400000; saveStSess(); }
    return { call: 'STATION' };
  }
  const rec = s && s.exp > now ? auth.loadUsers(USERS_FILE)[s.call] : null;
  if (!rec || rec.disabled || !rec.admin) {
    if (s) { delete stSess[h]; saveStSess(); }
    return null;
  }
  if (s.exp - now < (ST_DAYS - 1) * 86400000) { s.exp = now + ST_DAYS * 86400000; saveStSess(); }
  return { call: s.call };
}
function readBody(req, max) {
  return new Promise((resolve) => {
    let b = '';
    let over = false;
    req.on('data', (c) => { b += c; if (b.length > max) { over = true; req.destroy(); } });
    req.on('end', () => resolve(over ? null : b));
    req.on('error', () => resolve(null));
  });
}
function sendStationLogin(res, msg, code) {
  fs.readFile(path.join(PUB, 'station-login.html'), 'utf8', (err, html) => {
    if (err) { res.writeHead(500); return res.end(); }
    res.writeHead(code || 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    res.end(html.replace('<!--MSG-->', msg ? '<p class="st-bad" role="alert">' + msg + '</p>' : ''));
  });
}
async function stationLoginPost(req, res) {
  const ip = clientIp(req);
  const origin = req.headers.origin;
  let badOrigin = false;
  try { badOrigin = !!origin && origin !== 'null' && new URL(origin).host !== req.headers.host; } catch (e) { badOrigin = true; }
  if (badOrigin) { res.writeHead(403); return res.end(); }
  const body = await readBody(req, 2048);
  if (body == null) { res.writeHead(413); return res.end(); }
  const f = new URLSearchParams(body);
  const now = Date.now();
  const fl = fails.get(ip);
  if (fl && fl.until > now) return sendStationLogin(res, 'Trop d’essais, réessayez dans quelques minutes.', 429);
  const call = auth.normCall(f.get('call'));
  const rec = auth.validCall(call, cfg.allowedPrefixes) ? auth.loadUsers(USERS_FILE)[call] : null;
  const ok = rec && !rec.disabled && (await auth.verifyPassword(String(f.get('pass') || ''), rec));
  if (!ok) {
    const n = (fl && !(fl.until && fl.until <= now) ? fl.n : 0) + 1;
    fails.set(ip, { n, until: n >= 5 ? now + 10 * 60000 : 0 });
    journal('station_page_fail', { call, ip });
    return setTimeout(() => sendStationLogin(res, 'Indicatif ou mot de passe incorrect.', 401), 600);
  }
  fails.delete(ip);
  if (!rec.admin) {
    journal('station_page_refused', { call, ip });
    return sendStationLogin(res, 'La page Station est réservée aux administrateurs de Remote Station.', 403);
  }
  const tok = crypto.randomBytes(32).toString('base64url');
  stSess[sessHash(tok)] = { call, exp: now + ST_DAYS * 86400000, ip };
  saveStSess();
  journal('station_page_login', { call, ip });
  res.writeHead(303, { Location: '/station', 'Set-Cookie': stCookie(req, tok, ST_DAYS * 86400), 'Cache-Control': 'no-store' });
  res.end();
}
/**
 * Le navigateur du PC du club garde le jeton de station (localStorage) : la page de connexion le présente toute seule,
 * pour que la page Station se rouvre sans personne au club (rechargement à distance, redémarrage de Windows).
 * Le jeton est un secret de 48 caractères connu des seuls administrateurs.
 */
async function stationTokenPost(req, res) {
  const ip = clientIp(req);
  const origin = req.headers.origin;
  let badOrigin = false;
  try { badOrigin = !!origin && origin !== 'null' && new URL(origin).host !== req.headers.host; } catch (e) { badOrigin = true; }
  if (badOrigin) { res.writeHead(403); return res.end(); }
  const body = await readBody(req, 512);
  if (body == null) { res.writeHead(413); return res.end(); }
  const now = Date.now();
  const fl = fails.get(ip);
  if (fl && fl.until > now) { res.writeHead(429); return res.end(); }
  const tok = String(new URLSearchParams(body).get('token') || '');
  if (!tok || !auth.safeEqual(tok, cfg.stationToken)) {
    const n = (fl && !(fl.until && fl.until <= now) ? fl.n : 0) + 1;
    fails.set(ip, { n, until: n >= 5 ? now + 10 * 60000 : 0 });
    journal('station_page_fail', { call: 'jeton', ip });
    res.writeHead(401, { 'Cache-Control': 'no-store' });
    return res.end();
  }
  fails.delete(ip);
  const c = crypto.randomBytes(32).toString('base64url');
  stSess[sessHash(c)] = { call: 'STATION', exp: now + ST_DAYS * 86400000, ip, token: true };
  saveStSess();
  journal('station_page_login', { call: 'jeton de station', ip });
  res.writeHead(204, { 'Set-Cookie': stCookie(req, c, ST_DAYS * 86400), 'Cache-Control': 'no-store' });
  res.end();
}
function stationLogout(req, res) {
  const tok = readCookie(req, ST_COOKIE);
  if (tok && stSess[sessHash(tok)]) { journal('station_page_logout', { call: stSess[sessHash(tok)].call, ip: clientIp(req) }); delete stSess[sessHash(tok)]; saveStSess(); }
  res.writeHead(303, { Location: '/station', 'Set-Cookie': stCookie(req, 'x'.repeat(20), 0), 'Cache-Control': 'no-store' });
  res.end();
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return (xf ? String(xf).split(',')[0] : req.socket.remoteAddress || '').trim();
}

function send(conn, obj) {
  if (conn && conn.open) conn.send(JSON.stringify(obj));
}

function maxWattsFor(call) {
  for (const r of cfg.powerRules || []) {
    if (call.startsWith(String(r.prefix).toUpperCase())) return Number(r.maxWatts);
  }
  return Number(cfg.defaultMaxWatts);
}

// Ramène la puissance du TRX sous la limite de licence de cet opérateur. Retourne true si une commande a été envoyée.
let lastPowerFix = 0;
function limitPower(conn, why) {
  if (!conn || !conn.user || conn.user.rxOnly || radio.power == null || radio.power <= conn.user.maxWatts) return false;
  const range = rig().POWER_RANGE[radio.powerHead];
  if (!range || conn.user.maxWatts < range[0]) return false;
  const now = Date.now();
  if (now - lastPowerFix < 2000) return true;
  lastPowerFix = now;
  const target = Math.min(conn.user.maxWatts, range[1]);
  toStation({ t: 'cmd', op: 'power', watts: target, reason: why + ' ' + conn.user.call });
  send(conn, { t: 'notice', level: 'warn', msg: 'Puissance ramenée à ' + target + ' W (limite de votre licence : ' + conn.user.maxWatts + ' W)' });
  journal('power_limit', { call: conn.user.call, from: radio.power, to: target });
  return true;
}

function inTxRange(hz) {
  return hz != null && cfg.txRanges.some((r) => hz >= r[0] && hz <= r[1]);
}

// Fréquence réellement émise : VFO B si la radio émet sur SUB (SPLIT), plus le décalage XIT s'il est actif
function txFreq() {
  const base = radio.txVfo === 1 ? radio.freqB : radio.freq;
  if (base == null) return null;
  return base + (radio.xit ? radio.clar || 0 : 0);
}

function swrLocked() {
  const f = txFreq();
  return !!(swrLock && f != null && Math.abs(f - swrLock.freq) < 25000);
}

// Raison qui empêche cet opérateur d'émettre (PTT ou TUNE), ou null
function txBlockReason(conn, forTune) {
  return !cfg.allowTx ? 'émission désactivée sur ce serveur' :
    conn.user.rxOnly ? 'indicatif d’écouteur (' + conn.user.call + ') : émission interdite' :
    !conn.user.tx ? 'votre compte n’est pas autorisé à émettre' :
    controller !== conn ? 'prenez d’abord la main' :
    !station ? 'station hors ligne' :
    !radio.connected ? 'TRX non connecté' :
    radio.vox ? 'VOX actif au club : coupez-le d’abord' :
    !inTxRange(txFreq()) ? 'fréquence d’émission hors des bandes autorisées' + (radio.txVfo === 1 ? ' (VFO B en SPLIT)' : '') :
    radio.power == null ? 'puissance du TRX inconnue' :
    radio.power > conn.user.maxWatts ? 'puissance ' + radio.power + ' W au-delà de votre limite (' + conn.user.maxWatts + ' W)' :
    forTune && radio.tuner == null ? 'pas de boîte d’accord sur ce TRX (FTX-1 : ampli SPA-1 débranché ?)' :
    !forTune && swrLocked() ? 'ROS trop élevé sur cette fréquence (' + swrLock.swr.toFixed(1).replace('.', ',') + ':1) : ' +
      (radio.tuner == null ? 'changez de fréquence ou faites vérifier l’antenne' : 'faites d’abord un accord (TUNE)') :
    null;
}

function publicState() {
  const calls = [];
  for (const c of ops) if (calls.indexOf(c.user.call) < 0) calls.push(c.user.call);
  return {
    t: 'state',
    station: !!station,
    radio,
    controller: controller ? controller.user.call : null,
    controllerCid: controller ? controller.cid : null,
    users: calls.sort(),
    ptt: { active: ptt.active, by: ptt.active ? ptt.conn.user.call : null, since: ptt.since },
    txOk: inTxRange(txFreq()),
    txFreq: txFreq(),
    swrLock: swrLocked() ? { freq: swrLock.freq, swr: Math.round(swrLock.swr * 10) / 10 } : null,
    maxSwr: cfg.maxSwr,
    audio: { active: !!(station && audio.active), listeners: listeners() },
    digi: { modes: Array.from(digiModes()), latency: digi.latency },
    rigName: station ? rig().NAME : null,
    rigModel: station ? rig().ID : null,
    // TRX dont le port série est mémorisé sur le PC du club (changement à distance possible)
    rigPorts: station ? station.ports : {}
  };
}

let bcastPending = false;
function broadcast() {
  if (bcastPending) return;
  bcastPending = true;
  setTimeout(() => {
    bcastPending = false;
    const msg = JSON.stringify(publicState());
    for (const c of ops) if (c.open) c.send(msg);
  }, 40);
}

function toStation(obj) {
  if (station) send(station.conn, obj);
}

// ---------------------------------------------------------------- PTT
function stopPtt(reason) {
  if (!ptt.active) return;
  const who = ptt.conn;
  const dur = Math.round((Date.now() - ptt.since) / 100) / 10;
  ptt = { active: false, conn: null, since: 0, lastBeat: 0 };
  toStation({ t: 'cmd', op: 'ptt', on: false, reason });
  journal('tx_stop', { call: who.user.call, durationS: dur, reason, freq: txFreq() });
  if (reason !== 'relâché') {
    // Coupure forcée : l'opérateur doit relâcher le PTT avant de pouvoir réémettre
    who.needRelease = true;
    send(who, { t: 'notice', level: 'warn', msg: 'Émission coupée : ' + reason, pttCut: true });
  }
  broadcast();
}

function startPtt(conn) {
  if (rig().VIRTUAL_SPLIT && txSel && station && station.caps.indexOf('txsel') < 0) {
    return send(conn, { t: 'notice', level: 'error', msg: 'PTT refusé : la page Station du club est une ancienne version (émission sur le VFO B impossible). Rechargez-la : voyant STATION → « Recharger la page Station ».' });
  }
  const why = txBlockReason(conn);
  if (why && radio.power != null && radio.power > conn.user.maxWatts) limitPower(conn, 'avant émission');
  if (why) return send(conn, { t: 'notice', level: 'error', msg: 'PTT refusé : ' + why });
  const now = Date.now();
  ptt = { active: true, conn, since: now, lastBeat: now };
  lastCtrlActivity = now;
  // SPLIT virtuel : VFO d'émission envoyé avec le PTT, sauf si le TRX est déjà en SPLIT par sa face avant (il s'en charge)
  toStation({ t: 'cmd', op: 'ptt', on: true, by: conn.user.call, txVfo: rig().VIRTUAL_SPLIT && radio.hwSplit !== 1 ? txSel : undefined });
  toStation({ t: 'txka' });
  journal('tx_start', { call: conn.user.call, ip: conn.ip, freq: txFreq(), mode: radio.txVfo === 1 ? radio.modeB : radio.mode, split: !!radio.split, watts: radio.power });
  broadcast();
}

setInterval(() => {
  const now = Date.now();
  if (ptt.active) {
    if (now - ptt.lastBeat > cfg.pttHeartbeatMs) stopPtt('perte de liaison avec l’opérateur');
    else if (now - ptt.since > cfg.maxTxSeconds * 1000) stopPtt('durée maximale atteinte (' + cfg.maxTxSeconds + ' s)');
    else toStation({ t: 'txka' });
  }
  // Aucune libération ni déconnexion pour inactivité tant que le TRX est en émission
  if (ptt.active || radio.tx) return;
  if (controller && now - lastCtrlActivity > cfg.controlIdleMinutes * 60000) {
    const c = controller;
    stopPtt('inactivité');
    controller = null;
    send(c, { t: 'notice', level: 'warn', msg: 'Main libérée après ' + cfg.controlIdleMinutes + ' min d’inactivité' });
    journal('control_release', { call: c.user.call, reason: 'inactivité' });
    broadcast();
  }
  const lim = Number(cfg.sessionIdleMinutes) * 60000;
  if (lim > 0) {
    for (const c of ops) {
      const idle = now - (c.lastActive || now);
      const warnMs = Math.min(60000, lim / 4);
      if (idle > lim - warnMs && !c.idleWarned) {
        // Toujours un avertissement une minute avant (même juste après une émission qui a retardé l'échéance)
        c.idleWarned = true;
        c.lastActive = now - Math.min(idle, lim - warnMs);
        send(c, { t: 'idle_warn', seconds: Math.round(warnMs / 1000) });
      } else if (idle > lim) {
        send(c, { t: 'session_end', msg: 'Déconnecté après ' + cfg.sessionIdleMinutes + ' min sans activité' });
        journal('session_idle', { call: c.user.call, ip: c.ip });
        dropSession(c); // après une déconnexion pour inactivité, mot de passe exigé
        c.close(4005, 'inactivité');
      }
    }
  }
}, 250);

// ---------------------------------------------------------------- messages opérateurs
async function onLogin(conn, m) {
  const now = Date.now();
  if (typeof m.session === 'string' && m.session) {
    // Retour d'un membre déjà identifié sur ce navigateur (page actualisée, reconnexion…)
    const h = sessHash(m.session);
    const s = sessions[h];
    const rec = s && s.exp > now ? auth.loadUsers(USERS_FILE)[s.call] : null;
    if (!rec || rec.disabled || !auth.validCall(s.call, cfg.allowedPrefixes)) {
      if (s) { delete sessions[h]; saveSessions(); }
      return send(conn, { t: 'login_fail', session: true, msg: '' });
    }
    s.exp = now + cfg.rememberDays * 86400000;
    saveSessions();
    conn.sessHash = h;
    return loggedIn(conn, s.call, rec, m.session);
  }
  const f = fails.get(conn.ip);
  if (f && f.until > now) {
    return send(conn, { t: 'login_fail', msg: 'Trop d’essais, réessayez dans quelques minutes' });
  }
  const call = auth.normCall(m.call);
  const users = auth.loadUsers(USERS_FILE);
  if (!auth.validCall(call, cfg.allowedPrefixes)) {
    journal('login_refused_prefix', { call, ip: conn.ip });
    return setTimeout(() => send(conn, { t: 'login_fail', msg: 'Accès réservé aux indicatifs belges (' + cfg.allowedPrefixes.join(', ') + ')' }), 600);
  }
  const rec = users[call];
  const ok = rec && !rec.disabled && (await auth.verifyPassword(m.pass, rec));
  if (!ok) {
    const expired = f && f.until && f.until <= now;
    const n = (f && !expired ? f.n : 0) + 1;
    fails.set(conn.ip, { n, until: n >= 5 ? now + 10 * 60000 : 0 });
    journal('login_fail', { call, ip: conn.ip });
    return setTimeout(() => send(conn, { t: 'login_fail', msg: 'Indicatif ou mot de passe incorrect' }), 600);
  }
  fails.delete(conn.ip);
  const tok = newSession(call);
  if (tok) conn.sessHash = sessHash(tok);
  return loggedIn(conn, call, rec, tok);
}

function loggedIn(conn, call, rec, sessionTok) {
  const now = Date.now();
  const rxOnly = auth.isRxOnly(call, cfg.rxOnlyPrefixes);
  conn.user = { call, admin: !!rec.admin, tx: rec.tx !== false && !rxOnly, rxOnly, maxWatts: rxOnly ? 0 : maxWattsFor(call) };
  ops.add(conn);
  conn.lastActive = now;
  conn.idleWarned = false;
  journal('login', { call, ip: conn.ip });
  send(conn, {
    t: 'hello',
    call,
    cid: conn.cid,
    admin: conn.user.admin,
    canTx: conn.user.tx,
    rxOnly: conn.user.rxOnly,
    allowTx: cfg.allowTx,
    maxTxSeconds: cfg.maxTxSeconds,
    maxWatts: conn.user.maxWatts,
    clubName: cfg.clubName,
    stationCall: cfg.stationCall,
    rigs: Object.keys(DRIVERS).map((id) => ({ id, name: DRIVERS[id].NAME })),
    sessionIdleMinutes: cfg.sessionIdleMinutes,
    digiCall: String(cfg.digiCall || '').toUpperCase(),
    stationGrid: String(cfg.stationGrid || '').toUpperCase(),
    stationQth: String(cfg.stationQth || '').toUpperCase(),
    qo100If: cfg.qo100If && typeof cfg.qo100If === 'object' ? cfg.qo100If : DEFAULTS.qo100If,
    session: sessionTok || null
  });
  send(conn, { t: 'macros', data: macros[call] || {} });
  send(conn, { t: 'events', list: recentEvents });
  send(conn, { t: 'chatlog', list: chatLog });
  broadcast();
}

function onOperator(conn, m) {
  const now = Date.now();
  switch (m.t) {
    case 'take':
      if (controller && controller !== conn && controller.user.call === conn.user.call) {
        // même indicatif dans un autre onglet ou sur un autre appareil : la main passe ici, sans forcer
        stopPtt('main passée sur un autre onglet');
        send(controller, { t: 'notice', level: 'warn', msg: 'La main est passée sur un autre onglet ou appareil' });
      } else if (controller && controller !== conn) {
        if (!(m.force && conn.user.admin)) {
          return send(conn, { t: 'notice', level: 'error', msg: controller.user.call + ' a déjà la main' });
        }
        const prev = controller;
        stopPtt('reprise de la main par ' + conn.user.call);
        send(prev, { t: 'notice', level: 'warn', msg: conn.user.call + ' (admin) a repris la main' });
      }
      controller = conn;
      lastCtrlActivity = now;
      journal('control_take', { call: conn.user.call, force: !!m.force });
      limitPower(conn, 'prise de main');
      return broadcast();

    case 'cat_query': {
      // Console CAT de diagnostic (administrateurs) : lectures seulement, réponse brute du TRX
      if (!conn.user.admin) return send(conn, { t: 'notice', level: 'error', msg: 'Réservé aux administrateurs' });
      const cmd = String(m.cmd || '').toUpperCase().replace(/\s+/g, '');
      const q = cmd.endsWith(';') ? cmd : cmd + ';';
      if (!station || station.caps.indexOf('catq') < 0) return send(conn, { t: 'notice', level: 'error', msg: 'Page Station sans console CAT : rechargez-la' });
      if (!rig().CAT_QUERIES || rig().CAT_QUERIES.indexOf(q) < 0) return send(conn, { t: 'notice', level: 'error', msg: 'Lecture non autorisée : ' + q.slice(0, 12) + ' (lectures possibles : ' + (rig().CAT_QUERIES || []).join(' ') + ')' });
      catAsk = { conn, at: Date.now() };
      toStation({ t: 'cmd', op: 'query', cmd: q, id: Date.now() });
      return;
    }

    case 'station_reload': {
      // Recharger à distance la page Station du club (administrateurs, jamais pendant une émission)
      if (!conn.user.admin) return send(conn, { t: 'notice', level: 'error', msg: 'Réservé aux administrateurs' });
      if (!station) return send(conn, { t: 'notice', level: 'error', msg: 'Station hors ligne' });
      if (ptt.active || radio.tx) return send(conn, { t: 'notice', level: 'error', msg: 'Impossible pendant une émission' });
      journal('station_reload', { call: conn.user.call, old: station.caps.indexOf('autoreload') < 0 });
      if (station.caps.indexOf('autoreload') >= 0) send(station.conn, { t: 'reload', by: conn.user.call });
      else {
        // Page d'avant la 0.15.7 : elle ne connaît que « switch ». On la fait passer un instant sur un autre pilote
        // (dont le port n'est pas ouvert : rien n'est envoyé au TRX), ce qui la recharge avec le programme actuel,
        // puis elle est renvoyée tout de suite sur son TRX (voir onStationAuth).
        const back = rig().ID;
        const temp = Object.keys(DRIVERS).find((id) => id !== back && !station.ports[id]) || Object.keys(DRIVERS).find((id) => id !== back);
        stationBounce = { back, temp, at: Date.now() };
        send(station.conn, { t: 'switch', model: temp, by: conn.user.call });
      }
      return send(conn, { t: 'notice', level: 'warn', msg: 'Rechargement de la page Station demandé : la station revient dans une dizaine de secondes' });
    }

    case 'switch_rig': {
      // Changement de TRX à distance : administrateurs seulement, jamais pendant une émission
      const model = typeof m.model === 'string' ? m.model : '';
      if (!conn.user.admin) return send(conn, { t: 'notice', level: 'error', msg: 'Changement de TRX réservé aux administrateurs' });
      if (!station) return send(conn, { t: 'notice', level: 'error', msg: 'Station hors ligne : changement impossible' });
      if (!Object.prototype.hasOwnProperty.call(DRIVERS, model)) return send(conn, { t: 'notice', level: 'error', msg: 'Modèle inconnu' });
      if (ptt.active || radio.tx) return send(conn, { t: 'notice', level: 'error', msg: 'Impossible pendant une émission' });
      if (model === rig().ID) return;
      if (!station.ports[model]) return send(conn, { t: 'notice', level: 'error', msg: 'Port du ' + DRIVERS[model].NAME + ' jamais choisi sur le PC du club : à faire une fois sur place' });
      journal('rig_switch', { call: conn.user.call, from: rig().ID, to: model, name: DRIVERS[model].NAME });
      send(station.conn, { t: 'switch', model, by: conn.user.call });
      return send(conn, { t: 'notice', level: 'warn', msg: 'Passage au ' + DRIVERS[model].NAME + ' demandé : la station redémarre (quelques secondes)' });
    }

    case 'digi': {
      // Fenêtre de décodage ouverte (FT8 / FT4) ou fermée (null) par ce membre
      let mode = DIGI_MODES.indexOf(m.mode) >= 0 ? m.mode : null;
      const rc = mode === 'RTTY' ? rttyCfg(m.rtty) : null;
      if (mode === 'RTTY' && !rc) mode = null;
      const cc = mode === 'CW' ? cwCfg(m.cw) : null;
      if (mode === 'CW' && !cc) mode = null;
      const changed = conn.digi !== mode || (conn.rtty && conn.rtty.key) !== (rc && rc.key) || (conn.cw && conn.cw.key) !== (cc && cc.key);
      conn.digi = mode;
      conn.rtty = rc;
      conn.cw = cc;
      if (changed) updateDigi();
      // Historique : à l'ouverture, ou sur demande (fenêtre séparée qui s'ouvre, retour dans le dashboard)
      if (digi.hist[mode] && (changed || m.hist)) send(conn, { t: 'ftx_hist', mode, items: digi.hist[mode] });
      if (mode === 'JTTY' && (changed || m.hist)) send(conn, { t: 'jtty_hist', items: Array.from(digi.jtty.values()) });
      if (mode === 'SSTV' && (changed || m.hist)) send(conn, { t: 'sstv_list', items: sstvStore.list() });
      return;
    }

    case 'sstv_get': {
      // Image demandée par un membre (galerie, ou image recalculée en fin de réception)
      const it = conn.digi === 'SSTV' && sstvStore.get(Number(m.id));
      if (it) sstvSendImage(conn, it);
      return;
    }

    // ------------------------------------------------------------ carnet de trafic
    case 'log_list': {
      const all = book.query({ q: m.q, from: m.from, to: m.to });
      const lim = Math.max(1, Math.min(1000, Number(m.limit) || 200));
      return send(conn, { t: 'log_list', total: book.qsos.length, count: all.length, items: all.slice(-lim).reverse().map(qsoForClient),
        calls: stationCalls(), admin: !!conn.user.admin, services: LOG_SERVICES, auto: Object.fromEntries(LOG_SERVICES.map((s) => [s, !!logCfg[s].auto])) });
    }
    case 'log_add':
    case 'log_edit': {
      if (conn.user.rxOnly) return send(conn, { t: 'notice', level: 'error', msg: 'Indicatif d’écouteur : pas d’enregistrement de QSO' });
      let q;
      try { q = LB.clean(m.qso, logCtx(conn, m.qso)); } catch (e) { return send(conn, { t: 'notice', level: 'error', msg: 'QSO non enregistré : ' + e.message }); }
      if (m.t === 'log_edit') {
        const old = book.get(m.id);
        if (!old) return send(conn, { t: 'notice', level: 'error', msg: 'QSO introuvable' });
        if (!logCanEdit(conn, old)) return send(conn, { t: 'notice', level: 'error', msg: 'Seul l’auteur du QSO ou un administrateur peut le modifier' });
        q.operator = old.operator;
        q = book.update(m.id, q);
        journal('log_edit', { call: conn.user.call, qso: q.call });
        send(conn, { t: 'log_saved', qso: qsoForClient(q), edited: true });
      } else {
        const d = !m.force && book.dupe(q);
        if (d) return send(conn, { t: 'log_dupe', qso: m.qso, prev: qsoForClient(d) });
        q = book.add(q, conn.user.call);
        if (book.error) send(conn, { t: 'notice', level: 'error', msg: 'ATTENTION : carnet non écrit sur le disque du serveur (' + book.error + ')' });
        journal('log_add', { call: conn.user.call, qso: q.call, band: q.band, mode: q.mode });
        sync.auto(q);
        send(conn, { t: 'log_saved', qso: qsoForClient(q), auto: Object.fromEntries(LOG_SERVICES.map((s) => [s, !!logCfg[s].auto && !sync.stopped[s]])) });
      }
      for (const c of ops) send(c, { t: 'log_changed' });
      return;
    }
    case 'log_del': {
      const q = book.get(m.id);
      if (!q) return;
      if (!logCanEdit(conn, q)) return send(conn, { t: 'notice', level: 'error', msg: 'Seul l’auteur du QSO ou un administrateur peut le supprimer' });
      book.remove(m.id);
      journal('log_del', { call: conn.user.call, qso: q.call, date: q.qso_date });
      for (const c of ops) send(c, { t: 'log_changed' });
      return;
    }
    case 'log_pending':
      if (!conn.user.admin || LOG_SERVICES.indexOf(m.service) < 0) return;
      return send(conn, { t: 'log_pending', service: m.service, n: sync.pending(m.service, { from: m.from, to: m.to, callsign: m.callsign, all: !!m.all }).length,
        busy: !!sync.busy[m.service], stopped: !!sync.stopped[m.service] });
    case 'log_mark': {
      // QSO signés à la main avec TQSL (serveur sans certificat, ex. le VPS) : notés « envoyés »
      if (!conn.user.admin || LOG_SERVICES.indexOf(m.service) < 0 || !Array.isArray(m.ids)) return;
      let n = 0;
      for (const id of m.ids.slice(0, 20000)) { const q = book.get(id); if (q) { sync.mark(q, m.service, { ok: true, msg: 'envoyé à la main (' + conn.user.call + ')' }); n++; } }
      book.save();
      journal('log_mark', { call: conn.user.call, service: m.service, n });
      send(conn, { t: 'notice', level: 'info', msg: n + ' QSO notés comme envoyés à ' + m.service.toUpperCase() });
      for (const c of ops) send(c, { t: 'log_changed' });
      return;
    }
    case 'log_export': {
      let list = book.query({ from: m.from, to: m.to }).filter((q) => !m.callsign || q.station_callsign === m.callsign);
      if (m.pending && LOG_SERVICES.indexOf(m.pending) >= 0) list = sync.pending(m.pending, { from: m.from, to: m.to, callsign: m.callsign });
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const who = String(m.callsign || cfg.digiCall || 'ON5VL').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (m.fmt === 'cabrillo') {
        return send(conn, { t: 'log_export', name: who + '-' + stamp + '.log', mime: 'text/plain', data: LB.toCabrillo(list, { callsign: m.callsign || cfg.digiCall, contest: m.contest, grid: cfg.stationGrid, club: cfg.clubName && /UBA/.test(cfg.clubName) ? 'UBA-LGE' : '', version: VERSION }), count: list.length });
      }
      return send(conn, { t: 'log_export', name: who + '-' + stamp + (m.pending ? '-' + m.pending : '') + '.adi', mime: 'text/plain', data: LB.toAdif(list, 'RemoteStation', VERSION), count: list.length,
        pending: m.pending || '', ids: m.pending ? list.map((q) => q.id) : undefined });
    }
    case 'log_cfg_get':
      if (!conn.user.admin) return send(conn, { t: 'notice', level: 'error', msg: 'Réglages des carnets en ligne : administrateurs seulement' });
      return send(conn, { t: 'log_cfg', cfg: logCfgPublic(), calls: stationCalls(), quiet: !!m.quiet });
    case 'log_cfg_set':
      if (!conn.user.admin) return send(conn, { t: 'notice', level: 'error', msg: 'Réglages des carnets en ligne : administrateurs seulement' });
      setLogCfg(m.cfg);
      journal('log_cfg', { call: conn.user.call });
      send(conn, { t: 'log_cfg', cfg: logCfgPublic(), calls: stationCalls(), saved: true });
      return;
    case 'log_test':
      if (!conn.user.admin || LOG_SERVICES.indexOf(m.service) < 0) return;
      sync.test(m.service).then((r) => send(conn, { t: 'log_test', service: m.service, ok: r.ok, msg: r.msg }));
      return;
    case 'log_sync': {
      if (!conn.user.admin) return send(conn, { t: 'notice', level: 'error', msg: 'Synchronisation des carnets : administrateurs seulement' });
      if (m.action === 'stop') return sync.stop(m.service);
      if (m.service === 'lotw' && m.action === 'confirm') { sync.confirmLotw(conn.user.call); return; }
      if (LOG_SERVICES.indexOf(m.service) < 0) return;
      // Club Log « effacer le log existant » : tout le carnet de l'indicatif, en un seul fichier
      const f = { from: m.from, to: m.to, callsign: m.callsign, all: !!m.all || !!m.clear };
      const list = sync.pending(m.service, f);
      journal('log_sync', { call: conn.user.call, service: m.service, n: list.length, clear: !!m.clear });
      sync.run(m.service, list, { by: conn.user.call, clear: m.service === 'clublog' && !!m.clear, delay: m.delay });
      return;
    }

    case 'macros_set':
      if (!setMacros(conn.user.call, m.mode, m.list)) return;
      // Toutes les fenêtres de ce membre reçoivent la nouvelle liste
      for (const c of ops) if (c.user.call === conn.user.call) send(c, { t: 'macros', data: macros[conn.user.call] || {} });
      return;

    case 'listen':
      conn.listen = !!m.on;
      journal(m.on ? 'listen_on' : 'listen_off', { call: conn.user.call });
      updateAudioWant();
      return broadcast();

    case 'chat': {
      const text = String(m.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
      if (!text) return;
      if (now - (conn.lastChat || 0) < 1000) return send(conn, { t: 'notice', level: 'warn', msg: 'Un message par seconde au maximum' });
      conn.lastChat = now;
      journal('chat', { call: conn.user.call, text });
      return chatPush({ kind: 'msg', call: conn.user.call, text });
    }

    case 'ask': {
      // Demande de la main à celui qui pilote
      if (!controller || controller.user.call === conn.user.call) return;
      if (now - (conn.lastAsk || 0) < 15000) return send(conn, { t: 'notice', level: 'warn', msg: 'Demande déjà envoyée, patientez un peu' });
      conn.lastAsk = now;
      journal('control_ask', { call: conn.user.call, to: controller.user.call });
      return chatPush({ kind: 'ask', call: conn.user.call, cid: conn.cid, to: controller.user.call });
    }

    case 'handover': {
      // Celui qui a la main la passe directement à un membre qui l'a demandée (jamais pendant une émission)
      if (controller !== conn) return send(conn, { t: 'notice', level: 'error', msg: 'Vous n’avez pas la main' });
      if (ptt.active || radio.tx) return send(conn, { t: 'notice', level: 'error', msg: 'Terminez d’abord votre émission' });
      let target = null;
      for (const c of ops) if (c.cid === Number(m.cid)) target = c;
      if (!target || target === conn) return send(conn, { t: 'notice', level: 'error', msg: 'Ce membre n’est plus connecté' });
      controller = target;
      lastCtrlActivity = now;
      journal('control_take', { call: target.user.call, from: conn.user.call });
      chatPush({ kind: 'give', call: conn.user.call, to: target.user.call });
      send(target, { t: 'notice', level: 'warn', msg: conn.user.call + ' vous passe la main' });
      limitPower(target, 'prise de main');
      return broadcast();
    }

    case 'release':
      if (controller !== conn) return;
      stopPtt('main libérée');
      controller = null;
      journal('control_release', { call: conn.user.call, reason: 'volontaire' });
      return broadcast();

    case 'set':
      if (controller !== conn) return send(conn, { t: 'notice', level: 'error', msg: 'Prenez d’abord la main' });
      if (!station) return send(conn, { t: 'notice', level: 'error', msg: 'Station hors ligne' });
      if (ptt.active) return send(conn, { t: 'notice', level: 'error', msg: 'Impossible pendant l’émission' });
      lastCtrlActivity = now;
      if (m.freq != null) {
        const hz = Math.round(Number(m.freq));
        if (!(hz >= rig().FREQ_MIN && hz <= rig().FREQ_MAX)) {
          return send(conn, { t: 'notice', level: 'error', msg: 'Fréquence hors de la couverture du TRX' });
        }
        toStation({ t: 'cmd', op: 'freq', hz });
        radio.freq = hz; // affichage optimiste, corrigé au prochain polling
      }
      if (m.freqB != null) {
        const hz = Math.round(Number(m.freqB));
        if (!(hz >= rig().FREQ_MIN && hz <= rig().FREQ_MAX)) {
          return send(conn, { t: 'notice', level: 'error', msg: 'Fréquence hors de la couverture du TRX' });
        }
        toStation({ t: 'cmd', op: 'freqB', hz });
        radio.freqB = hz;
      }
      if (m.band != null) {
        const R = rig();
        if (!R.cmdBand || !R.BAND_CODES || !Object.prototype.hasOwnProperty.call(R.BAND_CODES, String(m.band))) {
          return send(conn, { t: 'notice', level: 'error', msg: 'Bande non disponible sur ce TRX' });
        }
        toStation({ t: 'cmd', op: 'band', band: String(m.band), sub: !!m.sub });
      }
      if (m.ctl != null) {
        const R = rig();
        const c = R.CONTROL[m.ctl];
        let v;
        try {
          v = R.validate(m.ctl, m.value, radio);
        } catch (e) {
          return send(conn, { t: 'notice', level: 'error', msg: e.message });
        }
        // SPLIT virtuel (FTX-1) : rien n'est envoyé au TRX, le choix sert au prochain passage en émission
        if (m.ctl === 'split' && R.VIRTUAL_SPLIT) {
          if (ptt.active || radio.tx) return send(conn, { t: 'notice', level: 'error', msg: 'Changement du VFO d’émission impossible pendant une émission' });
          txSel = v ? 1 : 0;
          radio.txVfo = txSel;
          radio.split = txSel;
          // SPLIT de la face avant encore actif : on le coupe (ST0 ; ST1 n'est jamais envoyé)
          if (!txSel && radio.hwSplit === 1) toStation({ t: 'cmd', op: 'ctl', id: 'splitHw', value: 0 });
          return broadcast();
        }
        // FTX-1 : une page Station d'avant la 0.15.5 enverrait ST1 pour le SPLIT, ce qui met le TRX en émission
        if (m.ctl === 'split' && R.ID === 'ftx1' && station && station.caps.indexOf('ftsplit') < 0) {
          return send(conn, { t: 'notice', level: 'error', msg: 'SPLIT refusé : la page Station du club est une ancienne version (elle mettrait le FTX-1 en émission). ' +
          (conn.user.admin ? 'Rechargez-la à distance : voyant STATION en haut à gauche → « Recharger la page Station ».' : 'Un administrateur doit la recharger (voyant STATION → « Recharger la page Station »).') });
        }
        // Changer d'antenne pendant une émission : jamais (le PA verrait un circuit ouvert)
        if (c.noTx && (ptt.active || radio.tx)) return send(conn, { t: 'notice', level: 'error', msg: c.label + ' : impossible pendant une émission' });
        if (c.transmits) {
          const why = txBlockReason(conn, true);
          if (why) {
            if (radio.power != null && radio.power > conn.user.maxWatts) limitPower(conn, 'avant ' + c.label);
            return send(conn, { t: 'notice', level: 'error', msg: c.label + ' refusé : ' + why });
          }
          journal('tune', { call: conn.user.call, ip: conn.ip, freq: txFreq(), watts: radio.power });
          swrLock = null; // l'accord est justement ce qu'il fallait faire ; si le ROS reste mauvais, la coupure recommencera
        }
        toStation({ t: 'cmd', op: 'ctl', id: m.ctl, value: v, by: conn.user.call });
        if (c.type !== 'action') radio[m.ctl] = v; // affichage optimiste
      }
      if (m.power != null) {
        const w = Number(m.power);
        const range = rig().POWER_RANGE[radio.powerHead];
        if (!range) return send(conn, { t: 'notice', level: 'error', msg: 'Puissance non réglable : type de tête du TRX inconnu' });
        if (conn.user.rxOnly) return send(conn, { t: 'notice', level: 'error', msg: 'Indicatif d’écouteur : réglage de puissance non autorisé' });
        if (!(w <= conn.user.maxWatts)) return send(conn, { t: 'notice', level: 'error', msg: 'Limite de votre licence : ' + conn.user.maxWatts + ' W' });
        if (!(w >= range[0] && w <= range[1])) return send(conn, { t: 'notice', level: 'error', msg: 'Puissance possible : ' + range[0] + ' à ' + range[1] + ' W' });
        toStation({ t: 'cmd', op: 'power', watts: w });
        radio.power = w; // affichage optimiste
      }
      if (m.mode != null) {
        const code = String(m.mode).toUpperCase();
        if (rig().SETTABLE.indexOf(code) < 0) return send(conn, { t: 'notice', level: 'error', msg: 'Mode non disponible' });
        toStation({ t: 'cmd', op: 'mode', code, sub: !!m.sub });
      }
      return broadcast();

    case 'ptt':
      if (m.on) {
        if (conn.needRelease) return; // relâcher d'abord après une coupure forcée
        if (ptt.active && ptt.conn === conn) {
          ptt.lastBeat = now;
          lastCtrlActivity = now;
        } else if (!ptt.active) {
          startPtt(conn);
        }
      } else {
        conn.needRelease = false;
        if (ptt.active && ptt.conn === conn) stopPtt('relâché');
      }
      return;

    case 'ping':
      return send(conn, { t: 'pong', ts: m.ts, now: Date.now() }); // now : horloge du serveur (onglet Synchro)
  }
}

// ---------------------------------------------------------------- messages station
function onStationAuth(conn, m) {
  if (!auth.safeEqual(m.token || '', cfg.stationToken)) {
    journal('station_auth_fail', { ip: conn.ip });
    send(conn, { t: 'error', msg: 'Jeton de station invalide' });
    return setTimeout(() => conn.close(4001, 'jeton invalide'), 300);
  }
  const model = typeof m.model === 'string' ? m.model : 'ftx1';
  if (!Object.prototype.hasOwnProperty.call(DRIVERS, model)) {
    send(conn, { t: 'error', msg: 'Modèle de radio non pris en charge par ce serveur : ' + model });
    return setTimeout(() => conn.close(4003, 'modèle inconnu'), 300);
  }
  if (station) {
    // Une station vivante avec son TRX connecté garde la place : une 2e page Station (autre onglet, autre PC)
    // ne peut pas la déloger, sinon une page sans radio pourrait prendre la place de celle qui a le TRX.
    const alive = station.conn.open && Date.now() - (station.lastMsg || 0) < 10000;
    const samePage = typeof m.page === 'string' && m.page && station.page === m.page;
    // Même adresse IP = même PC du club (page rechargée avec Ctrl+F5, reconnexion…) : il reprend toujours la place.
    // Le refus ne vise qu'une page Station ouverte ailleurs pendant que celle qui a le TRX tourne.
    const sameSite = station.ip === conn.ip;
    if (alive && radio.connected && !samePage && !sameSite) {
      journal('station_refused', { ip: conn.ip, reason: 'déjà en service' });
      send(conn, { t: 'error', msg: 'Une autre page Station, avec le TRX connecté, est déjà en service. Fermez l’une des deux.' });
      return setTimeout(() => conn.close(4004, 'station déjà en service'), 300);
    }
    const old = station.conn;
    old.isStation = false; // sa fermeture ne doit pas annoncer « station hors ligne »
    send(old, { t: 'error', msg: 'Remplacée par une nouvelle connexion station' });
    old.close(4002, 'remplacée');
    journal('station_replaced', { ip: old.ip });
  }
  const ports = {};
  if (m.ports && typeof m.ports === 'object') for (const id in DRIVERS) ports[id] = m.ports[id] === true;
  station = { conn, ip: conn.ip, since: Date.now(), rig: DRIVERS[model], ports, lastMsg: Date.now(), page: typeof m.page === 'string' ? m.page.slice(0, 40) : '',
    caps: Array.isArray(m.caps) ? m.caps.map(String).slice(0, 20) : [] };
  conn.isStation = true;
  conn.everStation = true;
  journal('station_online', { ip: conn.ip, model });
  // Fin d'un rechargement à distance d'une ancienne page : retour sur le TRX d'origine
  if (stationBounce && model === stationBounce.temp && Date.now() - stationBounce.at < 120000) {
    const b = stationBounce;
    stationBounce = null;
    send(conn, { t: 'switch', model: b.back, by: 'rechargement' });
  } else if (stationBounce && model === stationBounce.back) stationBounce = null;
  send(conn, { t: 'welcome', stationCall: cfg.stationCall, txSilenceSeconds: cfg.txSilenceSeconds, txHardMaxSeconds: cfg.txHardMaxSeconds, code: STATION_CODE });
  audio.active = false;
  // BF voulue s'il y a un écouteur ou une fenêtre FT8/FT4 ouverte (même règle que updateAudioWant)
  audio.want = audioWanted();
  send(conn, { t: 'audio_want', on: audio.want });
  broadcast();
}

function onStation(conn, m) {
  // Seule la station en service est écoutée (une ancienne connexion remplacée ne doit rien écraser)
  if (!station || station.conn !== conn) return;
  station.lastMsg = Date.now();
  if (m.t === 'ping') return send(conn, { t: 'pong', ts: m.ts }); // contrôle de vie de la liaison
  if (m.t === 'diag') {
    // Rapport de la page Station après une reconnexion : cause de la coupure vue côté club
    journal('station_diag', {
      how: String(m.how || '?').slice(0, 80),
      code: Number.isFinite(m.code) ? m.code : null,
      reason: String(m.reason || '').slice(0, 80),
      down_s: Number.isFinite(m.down) ? m.down : null,
      tries: Number.isFinite(m.tries) ? m.tries : 0
    });
    return;
  }
  if (m.t === 'cat_reply') {
    if (catAsk && Date.now() - catAsk.at < 5000) send(catAsk.conn, { t: 'notice', level: 'info', msg: 'CAT ' + String(m.cmd).slice(0, 12) + ' → ' + String(m.reply).slice(0, 60) });
    catAsk = null;
    return;
  }
  if (m.t === 'safety') {
    const reason = String(m.reason || 'sécurité de la station').slice(0, 160);
    journal('tx_watchdog', { reason });
    if (ptt.active) stopPtt(reason);
    else for (const c of ops) send(c, { t: 'notice', level: 'error', msg: 'Station : ' + reason });
    return;
  }
  if (m.t === 'audio_state') {
    audio.active = !!m.active;
    return broadcast();
  }
  if (m.t === 'ports' && m.ports && typeof m.ports === 'object' && station && station.conn === conn) {
    for (const id in DRIVERS) station.ports[id] = m.ports[id] === true;
    return broadcast();
  }
  if (m.t !== 'radio' || !m.radio) return;
  const r = m.radio;
  const was = radio.connected;
  radio = {
    connected: !!r.connected,
    freq: Number.isFinite(r.freq) ? r.freq : null,
    mode: typeof r.mode === 'string' ? r.mode.slice(0, 12) : null,
    modeCode: typeof r.modeCode === 'string' && /^[0-9A-Z]{1,3}$/.test(r.modeCode) ? r.modeCode : null,
    freqB: Number.isFinite(r.freqB) ? r.freqB : null,
    modeB: typeof r.modeB === 'string' ? r.modeB.slice(0, 12) : null,
    modeCodeB: typeof r.modeCodeB === 'string' && /^[0-9A-Z]{1,3}$/.test(r.modeCodeB) ? r.modeCodeB : null,
    tx: [0, 1, 2].indexOf(r.tx) >= 0 ? r.tx : 0,
    smeter: Number.isFinite(r.smeter) ? r.smeter : 0,
    power: Number.isFinite(r.power) ? r.power : null,
    powerHead: typeof r.powerHead === 'string' && Object.prototype.hasOwnProperty.call(rig().POWER_RANGE, r.powerHead) ? r.powerHead : null,
    model: station && station.rig ? station.rig.ID : null
  };
  // Réglages propres au pilote (SPLIT, filtres, mesures…) : nombres uniquement
  for (const k of rig().STATE_KEYS || []) radio[k] = Number.isFinite(r[k]) ? r[k] : null;
  if (rig().VIRTUAL_SPLIT) {
    // SPLIT mis ou retiré sur la face avant du TRX : suivi par le dashboard
    if (radio.hwSplit === 1 && lastHwSplit !== 1) txSel = 1;
    if (radio.hwSplit === 0 && lastHwSplit === 1) txSel = 0;
    lastHwSplit = radio.hwSplit;
    // VFO qui émet réellement d'après le TRX (FT relu), pour afficher la vérité pendant l'émission
    radio.txReal = radio.txVfo === 0 || radio.txVfo === 1 ? radio.txVfo : null;
    if (radio.tx && radio.txReal != null && radio.hwSplit !== 1 && radio.txReal !== txSel) {
      if (!txMismatchAt) txMismatchAt = Date.now();
      else if (Date.now() - txMismatchAt > 1500 && ptt.active) stopPtt('le TRX émet sur ' + (radio.txReal ? 'SUB (VFO B)' : 'MAIN (VFO A)') + ' au lieu de ' + (txSel ? 'SUB (VFO B)' : 'MAIN (VFO A)'));
    } else txMismatchAt = 0;
    radio.txVfo = txSel;
    radio.split = txSel; // affichage et contrôles : choix de l'opérateur
  }
  if (was !== radio.connected) journal(radio.connected ? 'trx_online' : 'trx_offline', {});
  // Fréquence du VFO pour les fréquences WSPR affichées
  if (digi.worker && radio.freq && radio.freq !== digi.dial) { digi.dial = radio.freq; digi.worker.postMessage({ t: 'dial', hz: radio.freq }); }
  // Sécurité : la radio est en CAT TX alors qu'aucun PTT n'est actif côté serveur
  if (radio.tx === 1 && !ptt.active) toStation({ t: 'cmd', op: 'ptt', on: false, reason: 'incohérence serveur' });
  // Sécurité : sortie de bande pendant l'émission
  if (ptt.active && !inTxRange(txFreq())) stopPtt('fréquence d’émission hors bande');
  if (ptt.active && radio.vox) stopPtt('VOX activé au club');
  // Sécurité : puissance au-delà de la licence (ex. bouton tourné au club pendant l'émission)
  if (ptt.active && radio.power != null && radio.power > ptt.conn.user.maxWatts) {
    const c = ptt.conn;
    stopPtt('puissance au-delà de la limite de licence (' + c.user.maxWatts + ' W)');
    limitPower(c, 'dépassement');
  } else if (controller && radio.power != null && radio.power > controller.user.maxWatts) {
    limitPower(controller, 'dépassement');
  }
  // Protection du PA : ROS trop élevé pendant une émission par le PTT (pas pendant un accord)
  const swr = ptt.active && !radio.tuning && radio.m6 != null && rig().swrValue ? rig().swrValue(radio.m6) : null;
  if (swr != null && cfg.maxSwr > 0 && swr >= cfg.maxSwr) {
    const now = Date.now();
    if (!swrHighSince) swrHighSince = now;
    else if (now - swrHighSince >= cfg.swrHoldMs) {
      swrHighSince = 0;
      swrLock = { freq: txFreq(), swr };
      journal('swr_cut', { call: ptt.conn.user.call, freq: txFreq(), swr: Math.round(swr * 10) / 10 });
      stopPtt('ROS trop élevé (' + swr.toFixed(1).replace('.', ',') + ':1) — ' +
        (radio.tuner == null ? 'pas de boîte d’accord : changez de fréquence ou faites vérifier l’antenne' : 'faites un accord (TUNE) avant de réémettre'));
    }
  } else {
    swrHighSince = 0;
  }
  broadcast();
}

// ---------------------------------------------------------------- connexions WebSocket
ws.attach(server, {
  path: '/ws',
  maxPayload: 64 * 1024,
  onConnection(conn, req) {
    conn.ip = clientIp(req);
    conn.openedAt = Date.now();
    conn.cid = ++connSeq; // identifie l'onglet : la main appartient à une connexion, pas seulement à un indicatif
    conn.user = null;
    conn.isStation = false;
    const authTimer = setTimeout(() => {
      if (!conn.user && !conn.isStation) conn.close(4000, 'pas d’authentification');
    }, 15000);

    conn.on('message', (data, isBinary) => {
      if (isBinary) {
        // Seule la station envoie du binaire : la BF du TRX
        if (conn.isStation && station && station.conn === conn) relayAudio(data);
        return;
      }
      let m;
      try {
        m = JSON.parse(data);
      } catch (e) {
        return;
      }
      if (!m || typeof m.t !== 'string') return;
      if (conn.isStation) return onStation(conn, m);
      if (conn.user) {
        // Toute action du membre compte comme activité (sauf les pings automatiques)
        if (m.t !== 'ping') { conn.lastActive = Date.now(); conn.idleWarned = false; }
        if (m.t === 'stay') return;
        if (m.t === 'logout') { dropSession(conn); return conn.close(1000, 'déconnexion'); }
        return onOperator(conn, m);
      }
      if (m.t === 'login') return onLogin(conn, m).catch((e) => console.error(e));
      if (m.t === 'station') return onStationAuth(conn, m);
    });

    conn.on('close', () => {
      clearTimeout(authTimer);
      // Connexion fermée avant toute identification (page Station qui n'arrive pas à s'annoncer, robot…)
      if (!conn.user && !conn.everStation) journal('ws_noauth', { ip: conn.ip, by: conn.closeBy || '?', code: conn.closeCode || null, s: Math.round((Date.now() - conn.openedAt) / 1000) });
      if (conn.isStation && station && station.conn === conn) {
        if (ptt.active) stopPtt('station déconnectée');
        station = null;
        radio = Object.assign({}, radio, { connected: false, tx: 0 });
        // 1001 = page Station fermée, rechargée ou remplacée par une autre adresse dans son onglet
        const why = conn.closeCode === 1001 ? 'page Station fermée ou quittée'
          : conn.closeBy === 'client' ? 'page Station déconnectée'
          : conn.closeBy === 'serveur' ? 'coupée par le serveur' : 'coupure réseau';
        journal('station_offline', { ip: conn.ip, by: conn.closeBy || '?', code: conn.closeCode || null, why });
        broadcast();
      }
      if (conn.user) {
        ops.delete(conn);
        if (conn.digi) updateDigi();
        else if (conn.listen) updateAudioWant();
        if (ptt.active && ptt.conn === conn) stopPtt('opérateur déconnecté');
        if (controller === conn) {
          controller = null;
          journal('control_release', { call: conn.user.call, reason: 'déconnexion' });
        }
        journal('logout', { call: conn.user.call });
        broadcast();
      }
    });
  }
});

// Détection des connexions mortes (ping toutes les 15 s)
const allConns = () => {
  const s = new Set(ops);
  if (station) s.add(station.conn);
  return s;
};
setInterval(() => {
  for (const c of allConns()) {
    if (!c.isAlive) {
      // Plus de réponse depuis 15 à 30 s : liaison morte (coupure réseau, changement d'adresse IP…)
      journal('link_timeout', { who: c.isStation ? 'station' : (c.user ? c.user.call : '?'), ip: c.ip });
      c.terminate();
      continue;
    }
    c.isAlive = false;
    c.ping();
  }
}, 15000);

server.listen(cfg.port, cfg.listen, () => {
  console.log('Remote Station à l’écoute sur ' + (server instanceof require('https').Server ? 'https://' : 'http://') + cfg.listen + ':' + cfg.port + ' — TX ' + (cfg.allowTx ? 'AUTORISÉ' : 'désactivé'));
});

// Arrêt (systemd : SIGTERM ; service Windows : Ctrl+C / SIGINT) : on coupe d'abord une émission en cours
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (ptt.active) stopPtt('arrêt du serveur');
    setTimeout(() => process.exit(0), 300);
  });
}
