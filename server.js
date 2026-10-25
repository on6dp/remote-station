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
  // FTX-1 : passage MAIN / SUB par CAT (VS seul, selon le manuel CAT). false pour le bloquer (face avant seulement).
  ftx1SubCat: true,
  // Tuner (boîte d'accord) remis en service tout seul à la connexion du TRX et à chaque changement de bande HF / 6 m,
  // pour ne pas l'oublier ; un clic sur TUNER le coupe jusqu'au prochain changement de bande. false : jamais tout seul.
  tunerAuto: true,
  // FTX-1 : passage MAIN ↔ SUB par le dashboard en réception simple (DUAL RX coupé). Refusé par défaut : le 24/10 puis
  // le 25/10 (deux VFO en HF), un clic sur le VFO B en réception simple a mis le TRX en émission (VS1 seul).
  // true : autorisé (essais au club, en surveillant le TRX).
  ftx1SubSingle: false,
  digiAlcMax: 0, // émission numérique : ALC maximal (%) au-delà duquel la page Station baisse le niveau BF ; 0 = pas de limite
  ftxWatchdogMinutes: 6, // émission auto FT8 / FT4 / FT2 : arrêt si le même message part depuis ce temps (WSJT-X : 6 min)
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
const PUBLIC_EVENTS = ['login', 'logout', 'control_take', 'control_release', 'tx_start', 'tx_stop', 'tune', 'power_limit', 'rig_switch', 'swr_cut', 'tune_fail', 'tx_watchdog',
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
let txSel = 0; // SPLIT virtuel (FTX-1) : SPLIT enclenché (1) ou non ; envoyé au TRX seulement en émission
// Règle des TRX : sans SPLIT on émet sur le VFO où l'on écoute ; avec SPLIT, sur l'autre.
// Le VFO de réception est celui d'avant le PTT (le TRX peut changer de côté actif pendant l'émission).
const rxSide = () => (ptt.active && (ptt.rx === 0 || ptt.rx === 1) ? ptt.rx : radio.vfoSel === 1 ? 1 : 0);
const txSide = () => (txSel ? 1 - rxSide() : rxSide());
let radio = { connected: false, freq: null, mode: null, modeCode: null, freqB: null, modeB: null, modeCodeB: null, tx: 0, smeter: 0 };
const ops = new Set(); // connexions opérateurs authentifiées
let controller = null; // connexion qui a la main
let ctlView = null;
// TXW (écoute de la fréquence d'émission, comme la touche TXW des TRX) : tant que le bouton est maintenu, les VFO sont
// échangés (A ⇄ B) ; au relâchement, sans nouvelles du bouton (2,5 s), au bout de 15 s ou si la main change : échange inverse
let txw = null; // { conn, since, beat }
function txwSwap(by) {
  const R = rig();
  if (!R.CONTROL || !R.CONTROL.swap || !station) return false;
  let v;
  try { v = R.validate('swap', undefined, radio); } catch (e) { return false; }
  toStation({ t: 'cmd', op: 'ctl', id: 'swap', value: v, by, subOk: !!cfg.ftx1SubCat, subSingle: !!cfg.ftx1SubSingle });
  return true;
}
function txwOff(reason) {
  if (!txw) return;
  const t = txw;
  txw = null;
  txwSwap('TXW');
  if (reason && t.conn) t.conn.txwRelease = true; // coupure forcée : relâcher le bouton avant de recommencer
  if (reason && t.conn && t.conn.open !== false) send(t.conn, { t: 'notice', level: 'warn', msg: 'TXW relâché : ' + reason });
  broadcast();
}    // onglet affiché par celui qui a la main { conn, tab, mode } (« Suivre l'opérateur »)
let swrLock = null;     // { freq, swr } : ROS trop élevé constaté à cette fréquence ; { tune: true, band } : accord impossible sur cette bande
let tuneWatch = null;
let tunerAuto = { band: '', until: 0 }; // bande HF / 6 m sur laquelle le tuner a été remis en service tout seul   // accord en cours de suivi { freq, at, saw, endAt, call }
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
  if (seq && seq.on) s.add(seq.mode); // émission auto : il faut décoder les réponses, même panneau replié
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
  digi.apKey = '';
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
    for (const c of ops) if (c.digi === 'RTTY') for (const r of [c.rtty, c.rtty2]) if (r) cfgs[r.key] = r;
    digi.worker.postMessage({ t: 'rtty', cfgs: Object.values(cfgs) });
    const cwc = {};
    for (const c of ops) if (c.digi === 'CW' && c.cw) cwc[c.cw.key] = c.cw;
    digi.worker.postMessage({ t: 'cw', cfgs: Object.values(cwc) });
  }
  updateAudioWant();
}
function onDigi(m) {
  if (m.t === 'wf') {
    // Ligne de cascade : [0x13, largeur de case (mHz, 2 octets), heure de capture (dixièmes de s du jour UTC, 4 octets),
    // octets dB*2+240 par case depuis 0 Hz]
    const fr = Buffer.allocUnsafe(m.row.length + 7);
    fr[0] = 0x13;
    fr.writeUInt16BE(Math.round((m.df || 6.25) * 1000), 1);
    fr.writeUInt32BE(Math.floor(((m.at || Date.now()) % 86400000) / 100), 3);
    Buffer.from(m.row.buffer, m.row.byteOffset, m.row.length).copy(fr, 7);
    for (const c of ops) if (c.digi && c.backlog < 65536) c.send(fr);
    return;
  }
  if (m.t === 'log') return console.error(m.msg);
  if ((m.t === 'jtty' || m.t === 'rtty_text') && rxMuted(m.t === 'jtty' ? 3000 : 1500)) return;
  if (m.t === 'jtty') {
    // Messages JTTY : dernière version de chaque message (le texte grandit trame après trame)
    digi.jtty.set(m.u.key, m.u);
    if (digi.jtty.size > 150) digi.jtty.delete(digi.jtty.keys().next().value);
    const msg = JSON.stringify({ t: 'jtty', u: m.u });
    for (const c of ops) if (c.digi === 'JTTY') c.send(msg);
    return;
  }
  if (m.t === 'rtty_text' || m.t === 'rtty_lvl') {
    // Deux décodeurs par membre (A : VFO-A, B : VFO-B) : ch = 0 ou 1
    const out = (ch) => JSON.stringify(m.t === 'rtty_text' ? { t: 'rtty', ch, text: m.text } : { t: 'rtty_lvl', ch, m: m.m, s: m.s, c: m.c });
    for (const c of ops) {
      if (c.digi !== 'RTTY') continue;
      if (c.rtty && c.rtty.key === m.key) c.send(out(0));
      if (c.rtty2 && c.rtty2.key === m.key) c.send(out(1));
    }
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
    // Notre propre émission décodée (la BF du TRX renvoie le signal émis) : retirée, comme WSJT-X qui n'écoute pas en émission
    if (Array.isArray(m.list) && ftTxSlots.some((x) => x.mode === m.mode && Math.abs(x.slot - m.slot) < 1500)) {
      const mine = myCalls();
      const sent = ftTxSlots.filter((x) => x.mode === m.mode && Math.abs(x.slot - m.slot) < 1500).map((x) => norm(x.text));
      m.list = m.list.filter((d) => {
        const w = norm(d && d.msg).split(' ').map((x) => x.replace(/^<|>$/g, ''));
        return sent.indexOf(norm(d && d.msg)) < 0 && mine.indexOf(w[1]) < 0 && !(w[0] === 'CQ' && (mine.indexOf(w[1]) >= 0 || mine.indexOf(w[2]) >= 0));
      });
    }
    // Pays DXCC, distance et azimut de la station qui émet chaque message (comme JTDX)
    if (Array.isArray(m.list) && m.mode !== 'WSPR' && m.mode !== 'JT65') for (const d of m.list) dxInfo(d);
    const item = { slot: m.slot, list: m.list };
    const h = digi.hist[m.mode];
    if (!h) return;
    h.push(item);
    while (h.length > (m.mode === 'FT2' ? 120 : 40)) h.shift();
    digi.latency = m.latency;
    digi.ms = m.ms;
    if (m.engine) digi.engine = m.engine;
    // Heure d'arrivée de chaque passe FT8 / FT4 (après le début de la période) : affichée dans l'onglet Synchro
    if (m.phase && FTX_SLOT[m.mode]) { digi.timing = digi.timing || {}; digi.timing[m.phase] = { at: Date.now() - m.slot, ms: m.ms, mode: m.mode }; }
    digi.last = Date.now();
    const msg = JSON.stringify({ t: 'ftx', mode: m.mode, slot: m.slot, list: m.list, latency: m.latency });
    for (const c of ops) if (c.digi === m.mode) c.send(msg);
    seqOnDecodes(m.mode, m.slot, m.list);
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
  qrz: { auto: false, keys: {}, delay: 5, lookupUser: '', lookupPassword: '' },
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
const SECRETS = { clublog: ['password', 'api'], eqsl: ['password'], lotw: ['password', 'webPassword'], qrz: ['lookupPassword'] };
// Recherche des indicatifs sur QRZ.com (nom, QTH, locator du correspondant) avec le compte QRZ réglé dans le carnet
const { Qrz } = require('./lib/qrz.js');
const qrzx = new Qrz(() => ({ user: logCfg.qrz.lookupUser, password: logCfg.qrz.lookupPassword }), 'RemoteStation-' + VERSION);
// Identifiants propres à chaque indicatif (TX call) : logCfg[service].accounts[INDICATIF] = { champs du service }.
// Les identifiants « généraux » (⚙ Configuration) restent ceux des indicatifs du club (ON5VL, OR0L) ; un indicatif
// personnel n'utilise que les siens (jamais ceux du club : ses QSO iraient sur le compte du club).
const ACCT_FIELDS = { clublog: ['email', 'password', 'api'], eqsl: ['user', 'password', 'nickname'], lotw: ['location', 'password', 'login', 'webPassword'], qrz: ['key'] };
function credFor(s, call) {
  const base = Object.assign({}, logCfg[s] || {});
  call = String(call || '').toUpperCase();
  const acct = (logCfg[s] && logCfg[s].accounts && logCfg[s].accounts[call]) || null;
  const club = !call || stationCalls().indexOf(call) >= 0;
  if (s === 'qrz') {
    const k = acct && acct.key ? acct.key : (logCfg.qrz.keys || {})[call] || '';
    return Object.assign(base, { key: k, keys: Object.assign({}, logCfg.qrz.keys || {}, k ? { [call]: k } : {}) });
  }
  if (!club) for (const k of ACCT_FIELDS[s]) base[k] = '';
  if (acct) for (const k of ACCT_FIELDS[s]) if (acct[k]) base[k] = acct[k];
  return base;
}
function acctPublic(s, call) {
  const c = credFor(s, call);
  const out = { fields: {}, has: {} };
  const acct = (logCfg[s] && logCfg[s].accounts && logCfg[s].accounts[call]) || null;
  for (const k of ACCT_FIELDS[s]) {
    const secret = (SECRETS[s] || []).indexOf(k) >= 0 || (s === 'qrz' && k === 'key');
    if (secret) out.has[k] = !!c[k]; else out.fields[k] = c[k] || '';
  }
  out.source = acct ? 'compte' : stationCalls().indexOf(call) >= 0 ? 'club' : 'aucun';
  return out;
}
function logCfgPublic() {
  const o = JSON.parse(JSON.stringify(logCfg));
  for (const sv of Object.keys(ACCT_FIELDS)) if (o[sv]) delete o[sv].accounts; // jamais les identifiants par indicatif
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
// Créneaux FT8 / FT4 / FT2 où la station a émis { mode, slot, text } (pour écarter le décodage de notre propre signal)
const ftTxSlots = [];
const norm = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
// « Émettre sous » (modes numériques) : indicatif de celui qui a la main s'il l'a choisi, sinon celui de la station (digiCall)
const txOwn = new Map(); // indicatif du membre → true s'il veut émettre sous son propre indicatif
const ownCallOk = (u) => !!(u && u.tx && !u.rxOnly && /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}[A-Z](\/[A-Z0-9]{1,4})?$/.test(String(u.call || '')));
function txCall() {
  const c = controller;
  if (c && txOwn.get(c.user.call) && ownCallOk(c.user)) return String(c.user.call).toUpperCase();
  return String(cfg.digiCall || 'ON5VL').toUpperCase();
}
// Indicatifs « à nous » pour les modes numériques : ceux de la station + celui sous lequel on émet en ce moment
const myCalls = () => Array.from(new Set(stationCalls().concat(txCall())));
const stationCalls = () => Array.from(new Set([cfg.digiCall].concat(String(cfg.stationCall || '').split(/[\s/,]+/)).map((c) => String(c || '').toUpperCase()).filter((c) => /^[A-Z0-9]{3,10}$/.test(c))));
const sync = new Sync({
  book, version: VERSION, station: String(cfg.digiCall || 'ON5VL').toUpperCase(), urls: cfg.logUrls, // logUrls : essais seulement
  getCfg: () => logCfg,
  getCred: (s, call) => credFor(s, call),
  setLastConfirm: (d) => { logCfg.lotw.lastConfirm = d; saveLogCfg(); },
  log: (m) => console.error('Logs : ' + m),
  onJob: (job, ev) => {
    const msg = { t: 'log_job', job: { id: job.id, service: job.service, name: job.name, total: job.total, done: job.done, ok: job.ok, fail: job.fail, auto: job.auto, by: job.by }, line: ev.line, fin: !!ev.fin, step: ev.step };
    for (const c of ops) if (c.user.admin || (job.by && c.user.call === job.by)) send(c, msg);
    if (ev.fin) {
      if (job.fail && job.auto) journal('log_sync_fail', { service: job.service, line: ev.line });
      for (const c of ops) send(c, { t: 'log_changed' });
      sendWorked(false);
    }
  }
});
function logCtx(conn, m) {
  const calls = logCalls(conn);
  const st = String((m && m.station) || cfg.digiCall || calls[0] || '').toUpperCase();
  return { operator: conn.user.call, stationCallsign: calls.indexOf(st) >= 0 ? st : calls[0], myGrid: cfg.stationGrid || '' };
}
// Indicatifs de station proposés dans le carnet : ceux du club, plus le sien (QSO faits sous son indicatif)
function logCalls(conn) { return Array.from(new Set(stationCalls().concat(ownCallOk(conn.user) ? [String(conn.user.call).toUpperCase()] : []))); }
// Stations déjà contactées sous l'indicatif d'émission actuel (TX CALL) : « INDICATIF|BANDE|MODE », pour les marquer
// dans les listes des modes numériques (vert barré). Renvoyé quand le carnet ou le TX CALL change.
let workedSig = '';
function sendWorked(force, only) {
  const st = txCall();
  const sig = st + ':' + book.rev;
  if (!force && sig === workedSig) return;
  workedSig = sig;
  const set = new Set();
  for (const q of book.qsos) if (String(q.station_callsign || '').toUpperCase() === st) set.add(q.call + '|' + q.band + '|' + (q.submode || q.mode));
  const msg = { t: 'worked', station: st, list: Array.from(set) };
  if (only) return send(only, msg);
  for (const c of ops) send(c, msg);
}
const DXCC = require('./lib/dxcc.js');
const DX_CALL_RE = /^(?=.*\d)(?=.*[A-Z])[A-Z0-9/]{3,15}$/;
/** Ajoute à un décodage FT8 / FT4 / FT2 : cty (pays DXCC), km et az (depuis le locator de la station) ; kmc = d'après le pays seulement */
function dxInfo(d) {
  if (!d || !d.msg) return;
  const w = String(d.msg).toUpperCase().split(/\s+/).map((x) => x.replace(/^<|>$/g, ''));
  const call = w[0] === 'CQ' ? (DX_CALL_RE.test(w[1] || '') ? w[1] : w[2]) : w[1];
  if (!call || !DX_CALL_RE.test(call)) return;
  const e = DXCC.lookup(call);
  if (!e) return;
  d.cty = e.name;
  const me = DXCC.gridLL(String(cfg.stationGrid || '').slice(0, 6));
  if (!me) return;
  const last = w[w.length - 1];
  const g = /^[A-R]{2}\d{2}$/.test(last) && last !== 'RR73' ? DXCC.gridLL(last) : null;
  const r = DXCC.distAz(me, g || { lat: e.lat, lon: e.lon });
  d.km = r.km;
  d.az = r.az;
  if (!g) d.kmc = true;
}
// Filtres par colonne du carnet : valeur d'un QSO pour chaque colonne affichée
const LG_COL = {
  date: (q) => q.qso_date || '', utc: (q) => String(q.time_on || '').slice(0, 2), call: (q) => q.call || '', band: (q) => q.band || '',
  mhz: (q) => String(q.freq || ''), mode: (q) => LB.modeName(q), env: (q) => q.rst_sent || '', recu: (q) => q.rst_rcvd || '',
  nom: (q) => q.name || '', qth: (q) => q.qth || '', dxcc: (q) => q.country || ((DXCC.lookup(q.call) || {}).name || ''),
  pfx: (q) => (DXCC.lookup(q.call) || {}).pfx || '',
  txc: (q) => q.station_callsign || '',
  lotw: (q) => lgUp(q, 'lotw'), eqsl: (q) => lgUp(q, 'eqsl'), cl: (q) => lgUp(q, 'clublog'), qrz: (q) => lgUp(q, 'qrz')
};
function lgUp(q, s) {
  if (s === 'lotw' && q.lotw_qsl_rcvd === 'Y') return 'confirmé';
  const u = q.up && q.up[s];
  return !u ? 'pas envoyé' : u.ok ? 'envoyé' : 'refusé';
}
const lgKey = (q, col) => String(LG_COL[col](q));
function lgFilter(list, f) {
  const fs = Object.entries(f && typeof f === 'object' ? f : {}).filter(([k, v]) => LG_COL[k] && v != null && v !== '');
  if (!fs.length) return list;
  return list.filter((q) => fs.every(([k, v]) => lgKey(q, k) === String(v)));
}
function logCanEdit(conn, q) { return conn.user.admin || (q && q.by === conn.user.call); }
// Pays DXCC du correspondant : enregistré avec le QSO (champ ADIF COUNTRY), ou calculé pour les anciens QSO
function qsoForClient(q) {
  const o = Object.assign({}, q);
  const e = DXCC.lookup(o.call);
  if (!o.country && e) o.country = e.name;
  if (e) o.dxcc_pfx = e.pfx;
  return o;
}

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
// Pendant une émission, la BF du TRX contient notre propre signal : le décodage RTTY / JTTY l'afficherait
// une deuxième fois. Rien n'est affiché pendant l'émission ni juste après (retard de la BF + fin du caractère).
let pttEndAt = 0;
const rxMuted = (tailMs) => ptt.active || Date.now() - pttEndAt < tailMs + (Number(digi.latency) || 150);
const fails = new Map(); // ip -> { n, until }

// ---------------------------------------------------------------- macros personnelles (RTTY, CW…) de chaque membre
// Comme dans FLDIGI : chaque opérateur garde ses propres messages, quel que soit le PC d'où il se connecte.
const MACROS_FILE = path.join(ROOT, 'macros.json');
let macros = {};
try { macros = JSON.parse(fs.readFileSync(MACROS_FILE, 'utf8')) || {}; } catch (e) { macros = {}; }
// Depuis 0.19.1, une macro RTTY / JTTY commençant par <TX> part tout de suite à l'émission (comme FLDIGI).
// Les macros déjà personnalisées sont mises à jour une fois : <TX> en tête, <RX> en fin (repère _tx).
{
  let changed = false;
  for (const call of Object.keys(macros)) {
    const mc = macros[call];
    if (!mc || typeof mc !== 'object' || mc._tx) continue;
    for (const mode of ['RTTY', 'JTTY']) {
      if (!Array.isArray(mc[mode])) continue;
      mc[mode] = mc[mode].map((m) => {
        const t = String((m && m.text) || '');
        if (!t.trim() || /<TX>|<RX>/i.test(t)) return m;
        return Object.assign({}, m, { text: '<TX>' + t + '<RX>' });
      });
    }
    mc._tx = 1;
    changed = true;
  }
  if (changed) setTimeout(() => saveMacros(), 0);
}
function saveMacros() {
  fs.writeFile(MACROS_FILE, JSON.stringify(macros), { mode: 0o600 }, (e) => { if (e) console.error('macros.json : ' + e.message); });
}
function setMacros(call, mode, list) {
  if (['RTTY', 'CW', 'FT8', 'JTTY'].indexOf(mode) < 0 || !Array.isArray(list)) return false;
  const clean = list.slice(0, 24).map((m) => ({
    name: String((m && m.name) || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 14),
    text: String((m && m.text) || '').replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').slice(0, 600)
  }));
  macros[call] = Object.assign({}, macros[call], { [mode]: clean, _tx: 1 });
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
  for (const f of ['station.html', 'js/station.js', 'js/station-core.js', 'js/yaesu.js', 'js/ftx1.js', 'js/ftdx10.js', 'js/ic7300.js', 'js/rigs-catalog.js', 'js/ulaw.js', 'js/ftxenc.js', 'js/ftx-enc.wasm']) {
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

function autoTuner() {
  if (!radio.connected || !station) { tunerAuto = { band: '', until: 0 }; return; }
  if (cfg.tunerAuto === false || !rig().CONTROL || !rig().CONTROL.tuner) return;
  if (txw) return; // TXW : VFO échangés un instant, pas un changement de bande
  const f = txFreq();
  const band = f && f < 54e6 ? LB.bandOf(f / 1e6) : '';
  const now = Date.now();
  const side = radio.vfoSel === 1 ? 1 : 0;
  // Changement de côté MAIN / SUB (la bande du VFO d'émission change sans changement de bande) : rien n'est envoyé
  // (constaté au club : tuner mis en service pendant un passage sur SUB, TRX en émission)
  if (tunerAuto.side != null && tunerAuto.side !== side) { tunerAuto = { band, until: 0, side }; return; }
  tunerAuto.side = side;
  // Nouvelle bande : 4 s pour relire l'état du tuner de cette bande
  if (band && band !== tunerAuto.band) tunerAuto = { band, until: now + 4000, side };
  if (!band) tunerAuto.band = '';
  if (tunerAuto.until && now < tunerAuto.until && radio.tuner === 0 && !radio.tx && !ptt.active && controller) {
    tunerAuto.until = 0;
    toStation({ t: 'cmd', op: 'ctl', id: 'tuner', value: 1, by: 'auto', subOk: !!cfg.ftx1SubCat });
    radio.tuner = 1; // affichage optimiste, relu ensuite
    if (controller) send(controller, { t: 'notice', level: 'info', msg: 'Tuner mis en service (' + band + ').' });
  }
}

// Suivi d'un accord lancé par TUNE : accord vu en cours (AC / RI / émission), puis fini → verdict d'après le HI-SWR du TRX
function checkTune() {
  const w = tuneWatch;
  const now = Date.now();
  const busy = !!(radio.tuning || radio.tuningRi || radio.tx);
  if (busy) { w.saw = true; w.endAt = 0; } else if (w.saw && !w.endAt) w.endAt = now;
  // Accord trop long : pas de verdict
  if (now - w.at > 60000) { tuneWatch = null; return; }
  // Accord jamais vu en cours (trop court pour les lectures) : verdict au bout de 8 s, seulement pour bloquer
  const unseen = !w.saw && now - w.at > 8000;
  // Fin d'accord : on attend une relecture de RI (1 s) avant de conclure
  if (!unseen && (!w.endAt || now - w.endAt < 1600)) return;
  tuneWatch = null;
  if (radio.hiSwr == null) return; // TRX qui ne dit pas s'il a trouvé un accord
  if (unseen && radio.hiSwr !== 1) return;
  const band = LB.bandOf(w.freq / 1e6);
  if (radio.hiSwr === 1) {
    swrLock = { freq: w.freq, swr: null, tune: true, band: band || null };
    journal('tune_fail', { call: w.call, freq: w.freq });
    const msg = 'TUNE : pas d’accord possible (HI-SWR)' + (band ? ' sur le ' + band : '') + '. Émission bloquée' + (band ? ' sur cette bande' : ' sur cette fréquence') +
      ' pour protéger le PA : refaites TUNE, essayez l’autre antenne ou prévenez un responsable de la station.';
    for (const c of ops) send(c, { t: 'notice', level: 'error', msg });
  } else if (swrLock && swrLock.tune) {
    swrLock = null;
    if (w.conn) send(w.conn, { t: 'notice', level: 'info', msg: 'Accord réussi : émission de nouveau possible' + (band ? ' sur le ' + band : '') + '.' });
  }
}

function swrLocked() {
  const f = txFreq();
  if (!swrLock || f == null) return false;
  if (swrLock.band) return LB.bandOf(f / 1e6) === swrLock.band; // accord impossible : toute la bande
  return Math.abs(f - swrLock.freq) < 25000;
}
function swrLockText() {
  if (swrLock.tune) return 'le dernier TUNE n’a pas trouvé d’accord (HI-SWR) sur le ' + swrLock.band +
    ' : émission bloquée sur cette bande — refaites TUNE, essayez l’autre antenne ou prévenez un responsable de la station';
  return 'ROS trop élevé sur cette fréquence' + (swrLock.swr != null ? ' (' + swrLock.swr.toFixed(1).replace('.', ',') + ':1)' : ' (HI-SWR du TRX)') + ' : ' +
    (radio.tuner == null ? 'changez de fréquence ou faites vérifier l’antenne' : 'faites d’abord un accord (TUNE)');
}

// Raison qui empêche cet opérateur d'émettre (PTT ou TUNE), ou null
function txBlockReason(conn, forTune) {
  return txw ? 'TXW enfoncé (écoute de la fréquence d’émission) : relâchez-le d’abord' :
    !cfg.allowTx ? 'émission désactivée sur ce serveur' :
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
    !forTune && swrLocked() ? swrLockText() :
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
    ptt: { active: ptt.active, by: ptt.active ? ptt.conn.user.call : null, since: ptt.since, digi: !!(ptt.active && ptt.digi) },
    // Émission FT8 / FT4 / FT2 programmée ou en cours
    seq: seqPublic(),
    ftx: ftxPend ? { id: ftxPend.id, state: ftxPend.state, mode: ftxPend.mode, text: ftxPend.sent || ftxPend.text, at: ftxPend.at, f0: ftxPend.f0, by: ftxPend.conn.user.call, seconds: ftxPend.seconds } : null,
    txCall: txCall(),
    txw: txw ? txw.conn.user.call : null,
    view: ctlView && controller && ctlView.conn === controller ? { tab: ctlView.tab, mode: ctlView.mode } : null,
    txOk: inTxRange(txFreq()),
    txFreq: txFreq(),
    swrLock: swrLocked() ? { freq: swrLock.freq, swr: swrLock.swr != null ? Math.round(swrLock.swr * 10) / 10 : null, tune: !!swrLock.tune, band: swrLock.band || null, text: swrLockText() } : null,
    maxSwr: cfg.maxSwr,
    audio: { active: !!(station && audio.active), listeners: listeners() },
    digi: { modes: Array.from(digiModes()), latency: digi.latency, engine: digi.engine || '', ms: digi.ms || 0, timing: digi.timing || null },
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
  const digiEnd = !!ptt.digi && reason === FTX_END;
  const sw = !!ptt.digi && reason === FTX_SWITCH;
  let sentP = null;
  if (ptt.digi && ftxPend && ftxPend.id === ptt.digi.id) { clearTimeout(ftxPend.timer); sentP = ftxPend; ftxPend = null; }
  if (ptt.digi && !digiEnd && !sw && seq && seq.on) { seq.on = false; setTimeout(updateDigi, 0); }
  if (digiEnd && sentP) setTimeout(() => seqAfterTx(sentP), 0);
  ptt = { active: false, conn: null, since: 0, lastBeat: 0 };
  pttEndAt = Date.now();
  toStation({ t: 'cmd', op: 'ptt', on: false, reason });
  journal('tx_stop', { call: who.user.call, durationS: dur, reason, freq: txFreq() });
  if (reason !== 'relâché' && !digiEnd && !sw) {
    // Coupure forcée : l'opérateur doit relâcher le PTT avant de pouvoir réémettre
    who.needRelease = true;
    send(who, { t: 'notice', level: 'warn', msg: 'Émission coupée : ' + reason, pttCut: true });
  }
  broadcast();
}

function startPtt(conn) {
  if (rig().VIRTUAL_SPLIT && txSide() && station && station.caps.indexOf('txsel') < 0) {
    return send(conn, { t: 'notice', level: 'error', msg: 'PTT refusé : la page Station du club est une ancienne version (émission sur le VFO B impossible). Rechargez-la : voyant STATION → « Recharger la page Station ».' });
  }
  const why = txBlockReason(conn);
  if (why && radio.power != null && radio.power > conn.user.maxWatts) limitPower(conn, 'avant émission');
  if (why) return send(conn, { t: 'notice', level: 'error', msg: 'PTT refusé : ' + why });
  const now = Date.now();
  ptt = { active: true, conn, since: now, lastBeat: now };
  lastCtrlActivity = now;
  // SPLIT virtuel : VFO d'émission envoyé avec le PTT, sauf si le TRX est déjà en SPLIT par sa face avant (il s'en charge)
  const tv = txSide();
  ptt.rx = rxSide();
  toStation({ t: 'cmd', op: 'ptt', on: true, by: conn.user.call, txVfo: rig().VIRTUAL_SPLIT && radio.hwSplit !== 1 ? tv : undefined });
  toStation({ t: 'txka' });
  journal('tx_start', { call: conn.user.call, ip: conn.ip, freq: txFreq(), mode: radio.txVfo === 1 ? radio.modeB : radio.mode, split: !!radio.split, watts: radio.power });
  broadcast();
}

// ---------------------------------------------------------------- émission FT8 / FT4 / FT2
// Clic sur un message (Tx1…Tx7) : le serveur choisit le créneau (heure du VPS, NTP), la page Station code le
// message tout de suite, puis le serveur met le TRX en émission juste avant le début du créneau ; la page joue le
// signal à l'heure dite et prévient à la fin → retour en réception. Une émission par clic.
const FTX_SLOT = { FT8: 15000, FT4: 7500, FT2: 3750 };
const FTX_T0 = 500; // début du signal après le début de la période (ms), comme WSJT-X
// Départ en retard encore accepté dans la période en cours (réponse cliquée juste après le décodage, comme WSJT-X) :
// le correspondant décode encore (DT jusqu'à +2,5 s en FT8)
const FTX_LATE = { FT8: 2300, FT4: 800, FT2: 250 };
const FTX_KEY_LEAD = 400; // passage en émission avant le début du signal (ms)
// Réponse par clic sur un indicatif : PTT dès que la page Station a préparé le signal (au clic), si le départ du
// signal est assez proche ; le signal part quand même au début de la période (sinon le correspondant ne le décode pas)
// Clic pendant notre propre période d'émission : départ immédiat (comme WSJT-X), message tronqué à la fin de la période.
// Il faut au moins ce temps restant dans la période (ms) ; sinon la période suivante de même parité.
const FTX_CLICK_MIN = { FT8: 2500, FT4: 1500, FT2: 900 };
const FTX_END = 'fin du message';
const FTX_SWITCH = 'message suivant'; // émission coupée pour repartir aussitôt avec le message suivant de la séquence
let ftxPend = null; // { id, conn, mode, text, f0, at, state: 'wait' | 'tx', ready, seconds, sent, timer }
let ftxSeq = 0;

/** Prochain départ du signal : début de période + 0,5 s, parité imposée ou non, au plus tôt dans 0,9 s. */
function ftxSlot(mode, parity, now, lateMax) {
  const P = FTX_SLOT[mode];
  const earliest = now + 700; // le temps que la page Station fabrique le signal
  const late = lateMax != null ? lateMax : FTX_LATE[mode];
  for (let k = Math.floor(now / P); k < Math.floor(now / P) + 4; k++) {
    if (parity != null && k % 2 !== parity) continue;
    const nominal = k * P + FTX_T0;
    if (earliest <= nominal) return { at: nominal, parity: k % 2 };
    if (earliest - nominal <= late) return { at: earliest, parity: k % 2 };
  }
  return null;
}

function ftxCancel(reason, quiet) {
  const p = ftxPend;
  if (!p) return;
  clearTimeout(p.timer);
  ftxPend = null;
  if (!quiet && seq && seq.on && seq.conn === p.conn) { seq.on = false; updateDigi(); }
  if (ptt.active && ptt.digi && ptt.digi.id === p.id) stopPtt(reason);
  else if (!quiet) send(p.conn, { t: 'notice', level: 'warn', msg: 'Émission ' + p.mode + ' annulée : ' + reason });
  broadcast();
}

function ftxRequest(conn, m) {
  const err = (msg) => msg;
  const mode = String(m.mode || '');
  if (!FTX_SLOT[mode]) return err('Mode numérique inconnu');
  const text = String(m.text || '').toUpperCase().replace(/[^ -~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 37);
  if (!text || /[{}]/.test(text)) return err('Message incomplet : ' + (text || '(vide)') + ' — choisissez d’abord le correspondant');
  const f0 = Math.round(Number(m.f0));
  if (!(f0 >= 200 && f0 <= 2900)) return err('Fréquence d’émission audio hors plage (200 à 2900 Hz)');
  if (!station || station.caps.indexOf('ftxtx') < 0) {
    return err('La page Station du club ne sait pas encore émettre en ' + mode + ' (ancienne version) : ' +
      (conn.user.admin ? 'rechargez-la (voyant STATION → « Recharger la page Station »).' : 'un administrateur doit la recharger.'));
  }
  if (ptt.active) return err('Émission déjà en cours : attendez la fin');
  const why = txBlockReason(conn);
  if (why && radio.power != null && radio.power > conn.user.maxWatts) limitPower(conn, 'avant émission');
  if (why) return err('Émission refusée : ' + why);
  const md = (radio.txVfo === 1 ? radio.modeB : radio.mode) || '';
  if (!/DATA|USB|PKT|DIG/i.test(md)) return err('Mettez d’abord le VFO d’émission en DATA-U (mode actuel : ' + (md || '?') + ')');
  const now = Date.now();
  // Réponse cliquée : on peut partir en retard dans notre période (le message est coupé à la fin de la période)
  const lateMax = m.keyNow ? FTX_SLOT[mode] - FTX_T0 - 700 - FTX_CLICK_MIN[mode] : null;
  const slot = ftxSlot(mode, m.parity === 0 || m.parity === 1 ? m.parity : null, now, lateMax);
  if (!slot) return err('Aucun créneau trouvé');
  if (ftxPend) ftxCancel('remplacée par le nouveau message', true);
  const p = { id: ++ftxSeq, conn, mode, text, f0, at: slot.at, parity: slot.parity, state: 'wait', ready: false, seconds: 0, sent: null, timer: null, ntx: m.ntx || 0,
    // PTT tout de suite seulement si le signal part tout de suite (jamais d'émission « à vide » avant la période)
    keyNow: !!m.keyNow && slot.at - now <= 1000 };
  ftxPend = p;
  toStation({ t: 'cmd', op: 'ftxprep', id: p.id, mode, text, f0 });
  p.timer = setTimeout(() => ftxKey(p), Math.max(0, p.at - FTX_KEY_LEAD - now));
  broadcast();
  return null;
}

// ---------------------------------------------------------------- séquence automatique (comme WSJT-X)
// Clic sur Tx1…Tx7 = « Enable Tx » : le message part à chaque période de l'opérateur (paire / impaire) jusqu'à
// la fin du QSO, « ■ Arrêter », la perte de la main ou le chien de garde (même message depuis 6 min).
// « Auto Seq » : les réponses du correspondant décodées font avancer le message (règles de WSJT-X 3.x,
// DecodedMessageReaction::planProcessMessage) ; « Répondre au 1er » (Call 1st) : en appel CQ, celui qui
// répond devient le correspondant. Après l'envoi d'un 73 ou d'un RR73 : fin du QSO, émission auto coupée,
// retour sur Tx6 (CQ) et proposition d'enregistrer le QSO dans le carnet (comme « Prompt me to log QSO »).
const PROG = { CALLING: 0, REPLYING: 1, REPORT: 2, ROGER_REPORT: 3, ROGERS: 4, SIGNOFF: 5 };
const NTX_PROG = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 0 };
let seq = null; // { conn, on, mode, f0, parity, ntx, progress, dx: { call, grid }, rptSent, rptRcvd, free, call1st, watchMsg, watchSince, qsoStart }
const seqMe = () => txCall();
const seqGrid = () => String(cfg.stationGrid || '').toUpperCase().slice(0, 4);
const baseCall = (c) => String(c || '').toUpperCase().replace(/[<>]/g, '').split('/').reduce((a, x) => (x.length > a.length ? x : a), '');
const fmtRpt = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return '-10';
  const k = Math.max(-30, Math.min(30, n));
  return (k >= 0 ? '+' : '-') + String(Math.abs(k)).padStart(2, '0');
};
const RPT_RE = /^[+-]\d{2}$/;
const RRPT_RE = /^R[+-]\d{2}$/;
const GRID4_RE = /^[A-R]{2}[0-9]{2}$/;
const SEQ_CALL_RE = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}[A-Z]$/;

function seqText(s) {
  const me = seqMe();
  const c = s.dx.call;
  const r = s.rptSent || '-10';
  switch (s.ntx) {
    case 1: return c + ' ' + me + ' ' + seqGrid();
    case 2: return c + ' ' + me + ' ' + r;
    case 3: return c + ' ' + me + ' R' + r;
    case 4: return c + ' ' + me + ' RR73';
    case 5: return c + ' ' + me + ' 73';
    case 6: return 'CQ ' + me + ' ' + seqGrid();
    default: return String(s.free || '');
  }
}
function seqPublic() {
  if (!seq) return null;
  return { on: !!seq.on, mode: seq.mode, ntx: seq.ntx, dx: seq.dx.call, grid: seq.dx.grid, rpt: seq.rptSent, rptRcvd: seq.rptRcvd || '',
    parity: seq.parity, call1st: !!seq.call1st, by: seq.conn.user.call, text: seqText(seq) };
}
function seqOff(reason, level) {
  if (!seq || !seq.on) return;
  seq.on = false;
  if (ftxPend && ftxPend.state === 'wait' && ftxPend.conn === seq.conn) ftxCancel(reason || 'arrêt', true);
  if (reason) send(seq.conn, { t: 'notice', level: level || 'warn', msg: 'Émission auto arrêtée : ' + reason });
  updateDigi();
  broadcast();
}
/** Prochaine émission de la séquence (message courant, période de l'opérateur). */
function seqNext() {
  if (!seq || !seq.on || ftxPend || ptt.active) return;
  if (controller !== seq.conn) return seqOff('main perdue');
  if (seq.ntx >= 1 && seq.ntx <= 5 && !SEQ_CALL_RE.test(baseCall(seq.dx.call))) return seqOff('pas de correspondant (double-clic sur son message)', 'error');
  const text = seqText(seq);
  const now = Date.now();
  if (text !== seq.watchMsg) { seq.watchMsg = text; seq.watchSince = now; }
  else if (now - seq.watchSince > cfg.ftxWatchdogMinutes * 60000) {
    return seqOff('même message depuis ' + cfg.ftxWatchdogMinutes + ' min sans réponse (chien de garde, comme WSJT-X)');
  }
  const err = ftxRequest(seq.conn, { mode: seq.mode, text, f0: seq.f0, parity: seq.parity, ntx: seq.ntx, keyNow: seq.keyNow });
  seq.keyNow = false; // seulement pour la première émission après le clic
  if (err) seqOff(err, 'error');
}
/** Message changé par une réponse : l'émission prévue (pas encore partie) est remplacée. */
function seqChanged() {
  if (seq && seq.on && ftxPend && ftxPend.state === 'wait' && ftxPend.conn === seq.conn
      && (ftxPend.text !== seqText(seq) || ftxPend.parity !== seq.parity)) ftxCancel('message changé', true);
  // Réponse décodée alors que notre émission de cette période vient de partir (ex. RR73 reçu pendant qu'on renvoie
  // R-report) : si le nouveau message peut encore partir dans cette période (départ en retard accepté), on coupe
  // et on repart aussitôt avec lui, au lieu de perdre une période (comme le changement de message en cours de WSJT-X)
  const p = ftxPend;
  if (seq && seq.on && p && p.state === 'tx' && p.conn === seq.conn && FTX_SLOT[p.mode] && p.text !== seqText(seq)
      && ptt.active && ptt.digi && ptt.digi.id === p.id) {
    const P = FTX_SLOT[p.mode];
    const nominal = Math.floor(p.at / P) * P + FTX_T0;
    if (Date.now() + 700 + 300 - nominal <= FTX_LATE[p.mode]) {
      stopPtt(FTX_SWITCH);
      seq.parity = Math.floor(p.at / P) % 2;
    }
  }
  seqNext();
  broadcast();
}
function seqSetNtx(n) {
  seq.ntx = n;
  if (NTX_PROG[n] != null) seq.progress = NTX_PROG[n];
}
/** Réponse du correspondant (« MOI LUI xxx ») : message suivant selon WSJT-X. Renvoie true si le QSO est terminé. */
function seqReact(payload, d) {
  const p = String(payload || '').toUpperCase();
  // « RR73 » a la forme d'un locator (RR73 = carré au milieu de l'océan) : c'est toujours la fin de QSO, comme dans WSJT-X
  if (p === 'RR73' || p === 'RRR') {
    seqSetNtx(5);
  } else if (GRID4_RE.test(p)) {
    // Réponse à notre CQ avec son locator → on lui donne son report
    seq.dx.grid = p;
    seq.rptSent = fmtRpt(d.db);
    seqSetNtx(2);
  } else if (RPT_RE.test(p)) {
    // Son report → R + notre report
    seq.rptRcvd = p;
    if (seq.progress <= PROG.REPLYING) seq.rptSent = fmtRpt(d.db);
    seqSetNtx(3);
  } else if (RRPT_RE.test(p)) {
    // R + report → RR73
    seq.rptRcvd = p.slice(1);
    seqSetNtx(4);
  } else if (p === 'RRR' || p === 'RR73') {
    seqSetNtx(5);
  } else if (p === '73') {
    if (seq.progress >= PROG.ROGERS) return true; // il confirme notre RR73 : QSO terminé
    seqSetNtx(5);
  } else return false;
  if (!seq.qsoStart) seq.qsoStart = Date.now();
  return false;
}
/** Décodages d'une période : la séquence avance si le correspondant (ou, en appel CQ, celui qui répond) nous écrit. */
function seqOnDecodes(mode, slot, list) {
  if (!seq || !seq.on || seq.mode !== mode || !Array.isArray(list) || !FTX_SLOT[mode]) return;
  const me = baseCall(seqMe());
  const theirParity = Math.round(slot / FTX_SLOT[mode]) % 2;
  const words = (d) => String(d.msg || '').toUpperCase().replace(/[<>]/g, '').split(/\s+/).filter(Boolean);
  const dxBase = baseCall(seq.dx.call);
  // 1) le correspondant
  if (dxBase && seq.ntx !== 6) {
    for (const d of list) {
      const w = words(d);
      if (w.length < 2 || baseCall(w[1]) !== dxBase) continue;
      if (baseCall(w[0]) === me) {
        seq.parity = 1 - theirParity;
        if (d.f >= 100 && d.f <= 3000) seq.rxf = Math.round(d.f);
        if (seqReact(w[2], d)) return seqQsoDone('73 reçu');
        // RR73 / RRR reçu : la fiche de fin de QSO s'ouvre tout de suite (le 73 part quand même)
        const pl = String(w[2] || '');
        if ((pl === 'RR73' || pl === 'RRR') && seq.qsoStart) seqLogPrompt(seq, pl + ' reçu');
        return seqChanged();
      }
      // On l'appelait (Tx1) et il répond à quelqu'un d'autre sur notre fréquence → arrêt (WSJT-X)
      if (seq.progress === PROG.REPLYING && !/^(CQ|QRZ|DE)$/.test(w[0]) && Math.abs(d.f - seq.f0) <= 100) {
        return seqOff(seq.dx.call + ' répond à ' + w[0]);
      }
    }
  }
  // 2) Appel CQ + « Répondre au 1er » : le plus fort de ceux qui nous répondent devient le correspondant
  if (seq.ntx === 6 && seq.call1st) {
    let best = null;
    for (const d of list) {
      const w = words(d);
      if (w.length < 3 || baseCall(w[0]) !== me || !SEQ_CALL_RE.test(baseCall(w[1]))) continue;
      if (!((GRID4_RE.test(w[2]) && w[2] !== 'RR73') || RPT_RE.test(w[2]) || RRPT_RE.test(w[2]))) continue;
      if (!best || d.db > best.d.db) best = { d, w };
    }
    if (best) {
      seq.dx = { call: best.w[1], grid: '' };
      if (best.d.f >= 100 && best.d.f <= 3000) seq.rxf = Math.round(best.d.f);
      seq.rptSent = fmtRpt(best.d.db);
      seq.rptRcvd = '';
      seq.qsoStart = 0;
      seq.parity = 1 - theirParity;
      seq.progress = PROG.CALLING;
      seqReact(best.w[2], best.d);
      send(seq.conn, { t: 'notice', level: 'info', msg: best.w[1] + ' répond à votre CQ : réponse automatique « ' + seqText(seq) + ' »' });
      return seqChanged();
    }
  }
}
/** Proposition d'enregistrement du QSO dans le carnet (une seule fois par QSO). */
function seqLogPrompt(s, why) {
  const call = s.dx.call;
  if (!SEQ_CALL_RE.test(baseCall(call)) || !s.qsoStart || s.prompted === s.qsoStart) return;
  s.prompted = s.qsoStart;
  const start = new Date(s.qsoStart);
  const end = new Date();
  const d8 = (x) => x.toISOString().slice(0, 10).replace(/-/g, '');
  const t6 = (x) => x.toISOString().slice(11, 19).replace(/:/g, '');
  const dial = s.txDial || txFreq() || 0;
  send(s.conn, { t: 'ftx_qso', why, qso: { call, gridsquare: s.dx.grid || '', mode: s.mode, station: seqMe(),
    freq: ((dial + s.f0) / 1e6).toFixed(6), rst_sent: s.rptSent || '', rst_rcvd: s.rptRcvd || '',
    qso_date: d8(start), time_on: t6(start), qso_date_off: d8(end), time_off: t6(end), tx_pwr: radio.power || '' } });
}
/** Fin du QSO : émission auto coupée, retour sur CQ, proposition d'enregistrement dans le carnet. */
function seqQsoDone(why) {
  const s = seq;
  if (!s) return;
  const call = s.dx.call;
  if (ftxPend && ftxPend.state === 'wait' && ftxPend.conn === s.conn) ftxCancel('QSO terminé', true);
  s.on = false;
  seqSetNtx(6);
  if (s.prompted !== s.qsoStart) seqLogPrompt(s, why);
  s.qsoStart = 0;
  s.rptRcvd = '';
  updateDigi();
  broadcast();
}
/** Fin d'une émission de la séquence : 73 / RR73 envoyé → fin du QSO ; sinon la même chose à la prochaine période. */
function seqAfterTx(p) {
  if (!seq || !seq.on || !p || p.conn !== seq.conn) return;
  seq.txDial = txFreq();
  // Période « auto » sans correspondant (CQ) : on garde celle de la première émission (une période sur deux)
  if (seq.parity == null) seq.parity = p.parity;
  if (p.ntx >= 1 && p.ntx <= 5 && !seq.qsoStart) seq.qsoStart = Date.now();
  if (p.ntx === 4 || p.ntx === 5) return seqQsoDone(p.ntx === 4 ? 'RR73 envoyé' : '73 envoyé');
  setTimeout(seqNext, 50);
}
/** Clic sur Tx1…Tx7 : émission auto de ce message. */
function seqStart(conn, m) {
  const err = (msg) => send(conn, { t: 'notice', level: 'error', msg });
  if (controller !== conn) return err('Prenez d’abord la main');
  const mode = String(m.mode || '');
  if (!FTX_SLOT[mode]) return err('Mode numérique inconnu');
  const ntx = Math.round(Number(m.ntx));
  if (!(ntx >= 1 && ntx <= 7)) return err('Message inconnu');
  const dx = m.dx && typeof m.dx === 'object' ? m.dx : {};
  const call = String(dx.call || '').toUpperCase().trim().slice(0, 13);
  const grid = String(dx.grid || '').toUpperCase().trim().slice(0, 4);
  const free = String(m.free || '').toUpperCase().replace(/[^A-Z0-9 +\-./?]/g, '').trim().slice(0, 13);
  if (ntx <= 5 && !SEQ_CALL_RE.test(baseCall(call))) return err('Choisissez d’abord le correspondant (double-clic sur son message)');
  if (ntx === 7 && !free) return err('Texte libre vide');
  if ((ntx === 1 || ntx === 6) && !GRID4_RE.test(seqGrid())) return err('Locator de la station non configuré sur le serveur (stationGrid)');
  if (ptt.active && !ptt.digi) return err('Émission en cours : attendez la fin');
  const f0 = Math.round(Number(m.f0));
  if (!(f0 >= 200 && f0 <= 2900)) return err('Fréquence d’émission audio hors plage (200 à 2900 Hz)');
  const same = seq && seq.conn === conn && baseCall(seq.dx.call) === baseCall(call) && seq.mode === mode;
  seq = {
    conn, on: true, mode, f0,
    parity: m.parity === 0 || m.parity === 1 ? m.parity : null,
    ntx, progress: NTX_PROG[ntx] != null ? NTX_PROG[ntx] : (same ? seq.progress : 0),
    dx: { call, grid: GRID4_RE.test(grid) ? grid : '' },
    rptSent: RPT_RE.test(String(m.rpt || '')) ? String(m.rpt) : fmtRpt(m.rpt),
    rptRcvd: same ? seq.rptRcvd : '', free, call1st: m.call1st !== false,
    watchMsg: '', watchSince: 0, qsoStart: same ? seq.qsoStart : 0, txDial: 0, keyNow: !!m.keyNow,
    // Fréquence audio du correspondant (fréquence RX) : l'aide AP du décodeur pour ce QSO s'y applique (comme WSJT-X)
    rxf: Number(m.rxf) >= 100 && Number(m.rxf) <= 3000 ? Math.round(Number(m.rxf)) : (same && seq.rxf) || 0
  };
  lastCtrlActivity = Date.now();
  // Émission en cours (message précédent) : le nouveau message part à la période suivante
  if (ftxPend && ftxPend.state === 'wait') ftxCancel('remplacée par le nouveau message', true);
  updateDigi();
  seqNext();
  broadcast();
}
/** Réglages changés pendant l'émission auto (fréquence audio, période, répondre au 1er). */
function seqCfg(conn, m) {
  if (!seq || seq.conn !== conn) return;
  const f0 = Math.round(Number(m.f0));
  if (f0 >= 200 && f0 <= 2900) seq.f0 = f0;
  if (m.parity === 0 || m.parity === 1 || m.parity === null) seq.parity = m.parity;
  if (typeof m.call1st === 'boolean') seq.call1st = m.call1st;
  seqChanged();
}

// ---------------------------------------------------------------- émission RTTY / JTTY
// Pas de créneau : le serveur fabrique le signal (RTTY : AFSK ; JTTY : codeur de WSJT-X, lib/bin/jttygen),
// l'envoie à la page Station, puis met le TRX en émission dès que la page l'a reçu ; retour en réception à la fin.
const RTTY_GEN = require('./lib/rtty.js').generate;
const JTTY_GEN = path.join(ROOT, 'lib', 'bin', 'jttygen' + (process.platform === 'win32' ? '.exe' : ''));
const AUDIO_RATE = 12000;
function jttyWave(text, f0) {
  return new Promise((resolve, reject) => {
    const { execFile } = require('child_process');
    execFile(JTTY_GEN, [String(Math.round(f0)), text], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 10000 }, (err, out, errout) => {
      if (err) return reject(new Error(err.code === 2 ? 'message JTTY impossible à coder : « ' + text + ' »' : 'codeur JTTY indisponible sur le serveur'));
      resolve(new Int16Array(out.buffer.slice(out.byteOffset, out.byteOffset + (out.length & ~1))));
    });
  });
}
async function audioRequest(conn, m) {
  const err = (msg) => send(conn, { t: 'notice', level: 'error', msg });
  const mode = String(m.mode || '');
  if (mode !== 'RTTY' && mode !== 'JTTY') return err('Mode inconnu');
  if (controller !== conn) return err('Prenez d’abord la main');
  if (!station || station.caps.indexOf('audiotx') < 0) {
    return err('La page Station du club ne sait pas encore émettre en ' + mode + ' (ancienne version) : ' +
      (conn.user.admin ? 'rechargez-la (voyant STATION → « Recharger la page Station »).' : 'un administrateur doit la recharger.'));
  }
  if (ptt.active || ftxPend) return err('Émission déjà en cours ou prévue : attendez la fin');
  if (seq && seq.on) return err('Émission automatique FT8 / FT4 / FT2 en cours : arrêtez-la d’abord');
  const why = txBlockReason(conn);
  if (why && radio.power != null && radio.power > conn.user.maxWatts) limitPower(conn, 'avant émission');
  if (why) return err('Émission refusée : ' + why);
  const md = (radio.txVfo === 1 ? radio.modeB : radio.mode) || '';
  if (!/DATA|USB|PKT|DIG/i.test(md)) return err('Mettez d’abord le VFO d’émission en DATA-U (mode actuel : ' + (md || '?') + ') : le signal ' + mode + ' passe par la carte son');
  const f0 = Math.round(Number(m.f0));
  if (!(f0 >= 300 && f0 <= 2800)) return err('Fréquence d’émission audio hors plage (300 à 2800 Hz)');
  let text = String(m.text || '').toUpperCase().replace(/\r/g, '').replace(/[^\n -~]/g, '').replace(/[ \t]+/g, ' ');
  text = mode === 'JTTY' ? text.replace(/\s*\n\s*/g, ' ').trim() : text.replace(/^\n+|\s+$/g, '');
  if (!text) return err('Rien à émettre : tapez un texte ou choisissez une macro');
  if (text.length > (mode === 'JTTY' ? 160 : 600)) return err('Texte trop long (' + (mode === 'JTTY' ? 160 : 600) + ' caractères au plus)');
  let pcm;
  let charMs = null; // RTTY : fin de chaque caractère (ms depuis le début du signal), pour la page de l'opérateur
  try {
    if (mode === 'RTTY') {
      const shift = [170, 200, 425, 850].indexOf(Number(m.shift)) >= 0 ? Number(m.shift) : 170;
      const baud = [45.45, 50, 75, 100].indexOf(Number(m.baud)) >= 0 ? Number(m.baud) : 45.45;
      // Début de ligne propre chez le correspondant : retour chariot + saut de ligne avant le texte
      const w = RTTY_GEN('\n' + text + ' ', { f: f0, shift, baud, rev: !!m.rev, rate: AUDIO_RATE });
      charMs = w.charMs ? w.charMs.slice(1, 1 + text.length) : null;
      pcm = new Int16Array(w.length);
      const ramp = Math.round(AUDIO_RATE * 0.005);
      for (let i = 0; i < w.length; i++) {
        const g = Math.min(1, i / ramp, (w.length - 1 - i) / ramp);
        pcm[i] = Math.round(w[i] * g * 0.85 * 32767);
      }
    } else {
      // JTTY : 80 caractères au plus par message (WSJT-X) ; au-delà, deux messages à la suite
      const parts = [];
      let rest = text;
      while (rest.length > 80) { let cut = rest.lastIndexOf(' ', 80); if (cut < 20) cut = 80; parts.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim(); }
      if (rest) parts.push(rest);
      const waves = [];
      for (const t of parts) waves.push(await jttyWave(t, f0));
      const gap = Math.round(AUDIO_RATE * 0.1);
      pcm = new Int16Array(waves.reduce((a, w) => a + w.length + gap, 0));
      let o = 0;
      for (const w of waves) { pcm.set(w, o); o += w.length + gap; }
    }
  } catch (e) {
    return err('Émission ' + mode + ' impossible : ' + e.message);
  }
  const seconds = pcm.length / AUDIO_RATE;
  if (seconds > cfg.maxTxSeconds - 2) return err('Texte trop long : ' + Math.round(seconds) + ' s d’émission (limite du serveur : ' + cfg.maxTxSeconds + ' s)');
  if (controller !== conn || ptt.active || ftxPend) return; // situation changée pendant la fabrication du signal
  const p = { id: ++ftxSeq, conn, mode, text, f0, at: 0, parity: 0, state: 'wait', ready: false, seconds, sent: text.replace(/\n/g, ' ').slice(0, 60), timer: null, ntx: 0, kind: 'audio' };
  ftxPend = p;
  lastCtrlActivity = Date.now();
  // Texte exact émis et minutage lettre par lettre : la page de l'opérateur colore chaque lettre une fois partie
  send(conn, { t: 'dtx_text', id: p.id, mode, text, ms: charMs, seconds: Math.round(seconds * 10) / 10 });
  toStation({ t: 'cmd', op: 'audioprep', id: p.id, mode, rate: AUDIO_RATE, data: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64') });
  // Page Station trop lente à recevoir le signal : abandon
  p.timer = setTimeout(() => { if (ftxPend === p && !p.ready) ftxCancel('la page Station n’a pas reçu le signal à temps'); }, 20000);
  broadcast();
}

/** Juste avant le créneau : dernières vérifications puis passage en émission avec le signal préparé. */
function ftxKey(p) {
  if (ftxPend !== p) return;
  if (!p.ready) return ftxCancel('la page Station n’a pas préparé le signal à temps');
  if (controller !== p.conn) return ftxCancel('main perdue');
  if (ptt.active) return ftxCancel('émission déjà en cours');
  const why = txBlockReason(p.conn);
  if (why) return ftxCancel(why);
  const now = Date.now();
  p.state = 'tx';
  if (['FT8', 'FT4', 'FT2'].indexOf(p.mode) >= 0) {
    ftTxSlots.push({ mode: p.mode, slot: Math.floor(p.at / FTX_SLOT[p.mode]) * FTX_SLOT[p.mode], text: p.sent || p.text });
    while (ftTxSlots.length > 30) ftTxSlots.shift();
  }
  ptt = { active: true, conn: p.conn, since: now, lastBeat: now, digi: { id: p.id, mode: p.mode } };
  lastCtrlActivity = now;
  const tv = txSide();
  ptt.rx = radio.vfoSel === 1 ? 1 : 0;
  toStation({ t: 'cmd', op: 'ptt', on: true, by: p.conn.user.call, txVfo: rig().VIRTUAL_SPLIT && radio.hwSplit !== 1 ? tv : undefined, digi: { id: p.id, at: p.at } });
  toStation({ t: 'txka' });
  journal('tx_start', { call: p.conn.user.call, ip: p.conn.ip, freq: txFreq(), mode: p.mode, text: p.sent || p.text, f0: p.f0, split: !!radio.split, watts: radio.power });
  // FT8 / FT4 / FT2 : jamais au-delà de la fin de notre période (départ en retard → message tronqué, comme WSJT-X)
  const P = FTX_SLOT[p.mode];
  if (P) {
    const pend = Math.floor(p.at / P) * P + P - 60;
    if (p.at + p.seconds * 1000 > pend) {
      p.cut = setTimeout(() => { if (ptt.active && ptt.digi && ptt.digi.id === p.id) stopPtt(FTX_END); }, Math.max(0, pend - Date.now()));
    }
  }
  // Filet : fin du message non signalée par la page Station
  p.timer = setTimeout(() => { if (ptt.active && ptt.digi && ptt.digi.id === p.id) stopPtt('fin du message non confirmée par la page Station'); },
    Math.max(1000, p.at + p.seconds * 1000 + 2500 - Date.now()));
  broadcast();
}

setInterval(() => {
  const now = Date.now();
  if (txw) {
    if (controller !== txw.conn) txwOff('main perdue');
    else if (!station || !radio.connected) txwOff('station ou TRX hors ligne');
    else if (now - txw.beat > 2500) txwOff('perte de liaison');
    else if (now - txw.since > 15000) txwOff('15 s au plus');
  }
  if (ptt.active) {
    if (!ptt.digi && now - ptt.lastBeat > cfg.pttHeartbeatMs) stopPtt('perte de liaison avec l’opérateur');
    else if (now - ptt.since > cfg.maxTxSeconds * 1000) stopPtt('durée maximale atteinte (' + cfg.maxTxSeconds + ' s)');
    else toStation({ t: 'txka' });
  }
  // Émission numérique programmée : annulée si l'opérateur n'a plus la main ou si la station a disparu
  if (ftxPend && ftxPend.state === 'wait' && (controller !== ftxPend.conn || !station)) ftxCancel(!station ? 'station hors ligne' : 'main perdue');
  if (seq && seq.on && (controller !== seq.conn || !station)) seqOff(!station ? 'station hors ligne' : 'main perdue');
  // Aucune libération ni déconnexion pour inactivité tant que le TRX est en émission
  if (ptt.active || radio.tx || ftxPend || (seq && seq.on)) return;
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
    subCat: !!cfg.ftx1SubCat,
    subSingle: !!cfg.ftx1SubSingle,
    stationGrid: String(cfg.stationGrid || '').toUpperCase(),
    stationQth: String(cfg.stationQth || '').toUpperCase(),
    qo100If: cfg.qo100If && typeof cfg.qo100If === 'object' ? cfg.qo100If : DEFAULTS.qo100If,
    session: sessionTok || null
  });
  send(conn, { t: 'macros', data: macros[call] || {} });
  send(conn, { t: 'events', list: recentEvents });
  send(conn, { t: 'chatlog', list: chatLog });
  sendWorked(true, conn);
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
      if (controller !== conn) tunerAuto.until = Date.now() + 4000; // prise de main : tuner remis en service s'il est coupé (HF / 6 m)
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
      if (catAsk) clearTimeout(catAsk.timer);
      catAsk = { conn, at: Date.now(), timer: setTimeout(() => { if (catAsk && catAsk.conn === conn) { send(conn, { t: 'cat_answer', cmd: q, reply: 'pas de réponse du TRX' }); catAsk = null; } }, 2500) };
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
      const rc2 = mode === 'RTTY' && rc ? rttyCfg(m.rtty2) : null; // 2e décodeur RTTY (VFO-B), facultatif
      if (mode === 'RTTY' && !rc) mode = null;
      const cc = mode === 'CW' ? cwCfg(m.cw) : null;
      if (mode === 'CW' && !cc) mode = null;
      const changed = conn.digi !== mode || (conn.rtty && conn.rtty.key) !== (rc && rc.key) || (conn.rtty2 && conn.rtty2.key) !== (rc2 && rc2.key) ||
        (conn.cw && conn.cw.key) !== (cc && cc.key);
      conn.digi = mode;
      conn.rtty = rc;
      conn.rtty2 = rc2;
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
    case 'log_values': {
      // Valeurs d'une colonne du carnet (choix proposés sous son titre), avec leur nombre de QSO
      const col = String(m.col || '');
      if (!LG_COL[col]) return;
      const f = Object.assign({}, m.f || {});
      delete f[col];
      const cnt = new Map();
      for (const q of lgFilter(book.query({ q: m.q }), f)) { const v = lgKey(q, col); cnt.set(v, (cnt.get(v) || 0) + 1); }
      let vals = Array.from(cnt.entries());
      if (col === 'date') vals.sort((a, b) => b[0].localeCompare(a[0]));
      else if (col === 'utc' || col === 'mhz') vals.sort((a, b) => Number(a[0]) - Number(b[0]));
      else vals.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return send(conn, { t: 'log_values', col, values: vals.slice(0, 400) });
    }
    case 'log_list': {
      const all = lgFilter(book.query({ q: m.q, from: m.from, to: m.to }), m.f);
      // TX call présents dans le carnet (export par indicatif)
      const txcalls = Array.from(new Set(book.qsos.map((q) => String(q.station_callsign || '').toUpperCase()).filter(Boolean))).sort();
      const lim = Math.max(1, Math.min(1000, Number(m.limit) || 200));
      return send(conn, { t: 'log_list', total: book.qsos.length, count: all.length, items: all.slice(-lim).reverse().map(qsoForClient),
        calls: logCalls(conn), txcalls: conn.user.admin ? txcalls : undefined, stationCalls: stationCalls(), admin: !!conn.user.admin, services: LOG_SERVICES, auto: Object.fromEntries(LOG_SERVICES.map((s) => [s, !!logCfg[s].auto])) });
    }
    case 'log_merge': {
      // Doublon : la fiche déjà au carnet (ex. enregistrée en fin de QSO) est complétée (nom, QTH…) au lieu d'un 2e QSO
      if (conn.user.rxOnly) return;
      const old = book.get(String(m.id || ''));
      if (!old) return send(conn, { t: 'notice', level: 'error', msg: 'QSO introuvable' });
      if (!logCanEdit(conn, old)) return send(conn, { t: 'notice', level: 'error', msg: 'Seul l’auteur du QSO ou un administrateur peut le compléter' });
      let q;
      try { q = LB.clean(m.qso, logCtx(conn, m.qso)); } catch (e) { return send(conn, { t: 'notice', level: 'error', msg: 'QSO non complété : ' + e.message }); }
      const added = book.merge(old.id, q);
      journal('log_edit', { call: conn.user.call, qso: old.call });
      send(conn, { t: 'notice', level: 'info', msg: added.length ? 'QSO avec ' + old.call + ' complété (' + added.join(', ') + ').' : 'QSO avec ' + old.call + ' : rien à ajouter.' });
      for (const c of ops) send(c, { t: 'log_changed' });
      sendWorked(false);
      return;
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
        if (!q.country) { const e = DXCC.lookup(q.call); if (e) q.country = e.name; }
        q = book.update(m.id, q);
        journal('log_edit', { call: conn.user.call, qso: q.call });
        send(conn, { t: 'log_saved', qso: qsoForClient(q), edited: true });
      } else {
        const d = !m.force && book.dupe(q);
        if (d) return send(conn, { t: 'log_dupe', qso: m.qso, prev: qsoForClient(d) });
        if (!q.country) { const e = DXCC.lookup(q.call); if (e) q.country = e.name; }
        q = book.add(q, conn.user.call);
        if (book.error) send(conn, { t: 'notice', level: 'error', msg: 'ATTENTION : carnet non écrit sur le disque du serveur (' + book.error + ')' });
        journal('log_add', { call: conn.user.call, qso: q.call, band: q.band, mode: q.mode });
        // QSO fait sous un indicatif personnel : gardé dans le carnet, pas d'envoi automatique vers les comptes du club
        const club = stationCalls().indexOf(q.station_callsign) >= 0;
        if (club) sync.auto(q);
        else send(conn, { t: 'notice', level: 'info', msg: 'QSO enregistré sous ' + q.station_callsign + ' : pas d’envoi automatique vers les logs en ligne du club (export ADIF pour votre propre carnet).' });
        send(conn, { t: 'log_saved', qso: qsoForClient(q), auto: Object.fromEntries(LOG_SERVICES.map((s) => [s, club && !!logCfg[s].auto && !sync.stopped[s]])) });
      }
      for (const c of ops) send(c, { t: 'log_changed' });
      sendWorked(false);
      return;
    }
    case 'log_del': {
      const q = book.get(m.id);
      if (!q) return;
      if (!logCanEdit(conn, q)) return send(conn, { t: 'notice', level: 'error', msg: 'Seul l’auteur du QSO ou un administrateur peut le supprimer' });
      book.remove(m.id);
      journal('log_del', { call: conn.user.call, qso: q.call, date: q.qso_date });
      for (const c of ops) send(c, { t: 'log_changed' });
      sendWorked(false);
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
      sendWorked(false);
      return;
    }
    case 'log_export': {
      // Chaque opérateur récupère ses QSO : son indicatif personnel (TX call), ou ses QSO faits sous l'indicatif du club
      // (« mine ») ; les administrateurs exportent tout, par TX call ou en entier
      const me = String(conn.user.call).toUpperCase();
      m.callsign = String(m.callsign || '').toUpperCase();
      if (!conn.user.admin) {
        if (m.pending) return send(conn, { t: 'notice', level: 'error', msg: 'Export pour les carnets en ligne : administrateurs seulement' });
        if (m.callsign !== me && !(m.mine && stationCalls().indexOf(m.callsign) >= 0)) { m.callsign = me; m.mine = false; }
      }
      let list = book.query({ from: m.from, to: m.to }).filter((q) => (!m.callsign || q.station_callsign === m.callsign) && (!m.mine || q.operator === me || q.by === me));
      if (m.pending && LOG_SERVICES.indexOf(m.pending) >= 0) list = sync.pending(m.pending, { from: m.from, to: m.to, callsign: m.callsign });
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const who = (String(m.callsign || 'TOUS').toUpperCase().replace(/[^A-Z0-9]/g, '')) + (m.mine ? '-' + me.replace(/[^A-Z0-9]/g, '') : '');
      if (m.fmt === 'cabrillo') {
        return send(conn, { t: 'log_export', name: who + '-' + stamp + '.log', mime: 'text/plain', data: LB.toCabrillo(list, { callsign: m.callsign || cfg.digiCall, contest: m.contest, grid: cfg.stationGrid, club: cfg.clubName && /UBA/.test(cfg.clubName) ? 'UBA-LGE' : '', version: VERSION }), count: list.length });
      }
      return send(conn, { t: 'log_export', name: who + '-' + stamp + (m.pending ? '-' + m.pending : '') + '.adi', mime: 'text/plain', data: LB.toAdif(list, 'RemoteStation', VERSION), count: list.length,
        pending: m.pending || '', ids: m.pending ? list.map((q) => q.id) : undefined });
    }
    case 'log_cfg_get':
      if (!conn.user.admin) return send(conn, { t: 'notice', level: 'error', msg: 'Réglages des carnets en ligne : administrateurs seulement' });
      return send(conn, { t: 'log_cfg', cfg: logCfgPublic(), calls: logCalls(conn), quiet: !!m.quiet });
    case 'log_cfg_set':
      if (!conn.user.admin) return send(conn, { t: 'notice', level: 'error', msg: 'Réglages des carnets en ligne : administrateurs seulement' });
      setLogCfg(m.cfg);
      qrzx.reset();
      journal('log_cfg', { call: conn.user.call });
      send(conn, { t: 'log_cfg', cfg: logCfgPublic(), calls: logCalls(conn), saved: true });
      return;
    case 'qrz': {
      // Fiche QRZ.com d'un indicatif (correspondant) : pour tous les membres connectés, une demande par seconde au plus
      const call = String(m.call || '').toUpperCase().replace(/[^A-Z0-9/]/g, '').slice(0, 15);
      if (!/^[A-Z0-9/]{3,15}$/.test(call)) return;
      const now = Date.now();
      if (now - (conn.qrzAt || 0) < 1000) return;
      conn.qrzAt = now;
      if (!qrzx.configured()) return send(conn, { t: 'qrz_info', call, ok: false, off: true });
      qrzx.lookup(call).then((v) => send(conn, { t: 'qrz_info', call, ok: !!v, info: v, msg: v ? '' : call + ' : inconnu sur QRZ.com' }))
        .catch((e) => send(conn, { t: 'qrz_info', call, ok: false, msg: String(e.message || e).slice(0, 200) }));
      return;
    }
    case 'qrz_test':
      if (!conn.user.admin) return;
      qrzx.reset();
      qrzx.login().then((r) => send(conn, { t: 'log_test', service: 'qrzxml', ok: true, msg: 'Connexion QRZ.com réussie' + (r.sub && !/non-subscriber/i.test(r.sub) ? ' (abonnement XML jusqu’au ' + r.sub + ')' : ' — sans abonnement XML : prénom, nom, ville et pays seulement') }))
        .catch((e) => send(conn, { t: 'log_test', service: 'qrzxml', ok: false, msg: String(e.message || e).slice(0, 200) }));
      return;
    case 'log_test':
      if (!conn.user.admin || LOG_SERVICES.indexOf(m.service) < 0) return;
      sync.test(m.service).then((r) => send(conn, { t: 'log_test', service: m.service, ok: r.ok, msg: r.msg }));
      return;
    case 'log_acct_get': {
      if (!conn.user.admin) return;
      const sv = String(m.service || ''), call = String(m.call || '').toUpperCase().replace(/[^A-Z0-9/]/g, '').slice(0, 15);
      if (!ACCT_FIELDS[sv] || !call) return;
      return send(conn, Object.assign({ t: 'log_acct', service: sv, call }, acctPublic(sv, call)));
    }
    case 'log_acct_set': {
      if (!conn.user.admin) return send(conn, { t: 'notice', level: 'error', msg: 'Identifiants des carnets en ligne : administrateurs seulement' });
      const sv = String(m.service || ''), call = String(m.call || '').toUpperCase().replace(/[^A-Z0-9/]/g, '').slice(0, 15);
      if (!ACCT_FIELDS[sv] || !call || !m.fields || typeof m.fields !== 'object') return;
      logCfg[sv].accounts = logCfg[sv].accounts || {};
      const a = Object.assign({}, logCfg[sv].accounts[call] || {});
      for (const k of ACCT_FIELDS[sv]) {
        const v = m.fields[k];
        if (v === undefined) continue;
        const secret = (SECRETS[sv] || []).indexOf(k) >= 0 || (sv === 'qrz' && k === 'key');
        if (secret && v === '') continue;                    // vide : on garde l'ancien
        if (v === '__effacer__' || v === '') delete a[k]; else a[k] = String(v).slice(0, 300);
      }
      if (Object.keys(a).length) logCfg[sv].accounts[call] = a; else delete logCfg[sv].accounts[call];
      saveLogCfg();
      sync.resetStops();
      journal('log_acct', { call: conn.user.call, service: sv, for: call });
      send(conn, { t: 'notice', level: 'info', msg: 'Identifiants ' + sv + ' de ' + call + ' enregistrés.' });
      return send(conn, Object.assign({ t: 'log_acct', service: sv, call, saved: true }, acctPublic(sv, call)));
    }
    case 'log_sync': {
      if (!conn.user.admin) return send(conn, { t: 'notice', level: 'error', msg: 'Synchronisation des carnets : administrateurs seulement' });
      if (m.action === 'stop') return sync.stop(m.service);
      if (m.service === 'lotw' && m.action === 'confirm') { sync.confirmLotw(conn.user.call, m.callsign); return; }
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

    case 'txcall': {
      // Choix « Émettre sous » : son indicatif ou celui de la station (modes numériques)
      const own = !!m.own;
      if (own && !ownCallOk(conn.user)) return send(conn, { t: 'notice', level: 'error', msg: 'Votre indicatif ne peut pas émettre (compte d’écouteur ou sans émission).' });
      if (seq && seq.on && controller === conn && (txOwn.get(conn.user.call) || false) !== own) return send(conn, { t: 'notice', level: 'warn', msg: 'Arrêtez d’abord l’émission automatique en cours (■ Arrêter) pour changer d’indicatif.' });
      txOwn.set(conn.user.call, own);
      return broadcast();
    }

    case 'view': {
      // Onglet des modes numériques affiché par celui qui a la main : les autres peuvent le suivre (formation à distance)
      if (controller !== conn) return;
      const TABS_OK = ['events', 'ftx', 'rtty', 'wspr', 'jt65', 'jtty', 'cw', 'sstv', 'sync', 'log'];
      const tab = TABS_OK.indexOf(m.tab) >= 0 ? m.tab : null;
      const mode = ['FT8', 'FT4', 'FT2', 'JT65'].indexOf(m.mode) >= 0 ? m.mode : null;
      if (!tab) return;
      if (ctlView && ctlView.conn === conn && ctlView.tab === tab && ctlView.mode === mode) return;
      ctlView = { conn, tab, mode };
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
        // FTX-1 : aucun passage sur SUB par CAT (VS1) tant que ftx1SubCat n'est pas activé
        if (R.ID === 'ftx1' && !cfg.ftx1SubCat && ((m.ctl === 'vfoSel' && Number(m.value) === 1) || (c && c.viaSub && radio.vfoSel !== 1) || (c && c.viaMain && radio.vfoSel === 1))) {
          return send(conn, { t: 'notice', level: 'error', msg: 'Passage MAIN ↔ SUB par le dashboard désactivé : il mettait le FTX-1 en émission. Choisissez MAIN / SUB sur la face avant du TRX ; le dashboard suit.' });
        }
        // FTX-1 en réception simple (DUAL RX coupé) : passage MAIN ↔ SUB par CAT refusé (constaté au club le 24/10 :
        // clic sur SUB → le TRX passe en émission) ; DUAL RX d'abord, ou face avant
        const sideMove = (m.ctl === 'vfoSel' && Number(m.value) !== (radio.vfoSel === 1 ? 1 : 0)) || (c && c.viaSub && radio.vfoSel !== 1) || (c && c.viaMain && radio.vfoSel === 1);
        if (R.ID === 'ftx1' && radio.dualRx !== 1 && sideMove && !cfg.ftx1SubSingle) { // réception simple (ou état inconnu) : refusé sauf ftx1SubSingle
          return send(conn, { t: 'notice', level: 'error', msg: 'Passage MAIN ↔ SUB refusé en réception simple (DUAL RX coupé) : il met le FTX-1 en émission. Le VFO B se règle quand même (molette, flèches, bandes) ; pour écouter le VFO B, touche MAIN / SUB du TRX au club.' });
        }
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
          radio.txVfo = txSide();
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
          // ROS mesuré trop haut : l'accord est justement ce qu'il fallait faire (si le ROS reste mauvais, la coupure recommencera).
          // Accord impossible (HI-SWR) : le blocage ne tombe que si ce nouvel accord réussit.
          if (!(swrLock && swrLock.tune)) swrLock = null;
          tuneWatch = { freq: txFreq(), at: Date.now(), saw: false, endAt: 0, call: conn.user.call, conn };
        }
        toStation({ t: 'cmd', op: 'ctl', id: m.ctl, value: v, by: conn.user.call, subOk: !!cfg.ftx1SubCat, subSingle: !!cfg.ftx1SubSingle });
        if (c.type !== 'action') radio[m.ctl] = v; // affichage optimiste
        if (R.VIRTUAL_SPLIT && m.ctl === 'vfoSel') radio.txVfo = txSide(); // l'émission suit la réception (ou l'autre VFO en SPLIT)
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

    case 'txw': {
      if (m.on) {
        if (controller !== conn) return send(conn, { t: 'notice', level: 'warn', msg: 'Prenez la main pour utiliser TXW.' });
        if (txw && txw.conn === conn) { txw.beat = now; return; }
        if (txw || conn.txwRelease) return;
        if (ptt.active || radio.tx || (ftxPend && ftxPend.state === 'tx')) return send(conn, { t: 'notice', level: 'warn', msg: 'TXW : impossible pendant une émission.' });
        if (!txwSwap(conn.user.call)) return send(conn, { t: 'notice', level: 'warn', msg: 'TXW : ce TRX ne permet pas l’échange des VFO.' });
        txw = { conn, since: now, beat: now };
        lastCtrlActivity = now;
        return broadcast();
      }
      conn.txwRelease = false;
      if (txw && txw.conn === conn) txwOff('');
      return;
    }

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

    case 'ftx_tx':
      return seqStart(conn, m);

    case 'ftx_cfg':
      return seqCfg(conn, m);

    case 'dtx':
      audioRequest(conn, m).catch((e) => send(conn, { t: 'notice', level: 'error', msg: 'Émission impossible : ' + e.message }));
      return;

    case 'ftx_stop':
      if (seq && seq.conn === conn && seq.on) { seq.on = false; updateDigi(); }
      if (ftxPend && ftxPend.conn === conn) ftxCancel('arrêt demandé', true);
      if (ptt.active && ptt.digi && ptt.conn === conn) stopPtt('arrêt demandé');
      return broadcast();

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
  send(conn, { t: 'welcome', stationCall: cfg.stationCall, txSilenceSeconds: cfg.txSilenceSeconds, txHardMaxSeconds: cfg.txHardMaxSeconds, code: STATION_CODE, alcMax: Number(cfg.digiAlcMax) || 0 });
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
  if (m.t === 'ping') return send(conn, { t: 'pong', ts: m.ts, now: Date.now() }); // contrôle de vie de la liaison (+ horloge du VPS)
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
  if (m.t === 'ftx_ready') {
    const p = ftxPend;
    if (!p || p.id !== m.id) return;
    if (!m.ok) return ftxCancel(String(m.err || 'message refusé par la page Station').slice(0, 160));
    p.ready = true;
    if (p.kind === 'audio') {
      // RTTY / JTTY : départ 0,6 s après la réception du signal par la page Station
      clearTimeout(p.timer);
      p.at = Date.now() + 600;
      p.timer = setTimeout(() => ftxKey(p), 600 - FTX_KEY_LEAD);
      return broadcast();
    }
    p.seconds = Number(m.seconds) || 0;
    p.sent = String(m.text || p.text).slice(0, 40);
    // Réponse cliquée : le TRX passe en émission tout de suite (le signal part à l'heure prévue)
    if (p.keyNow && p.state === 'wait' && !ptt.active && p.at - Date.now() > FTX_KEY_LEAD) { clearTimeout(p.timer); ftxKey(p); return; }
    return broadcast();
  }
  if (m.t === 'ftx_done') {
    if (ptt.active && ptt.digi && ptt.digi.id === m.id) stopPtt(FTX_END);
    return;
  }
  if (m.t === 'cat_reply') {
    if (catAsk && Date.now() - catAsk.at < 5000) {
      clearTimeout(catAsk.timer);
      send(catAsk.conn, { t: 'cat_answer', cmd: String(m.cmd).slice(0, 12), reply: String(m.reply).slice(0, 60) });
    }
    catAsk = null;
    return;
  }
  if (m.t === 'trx_note') {
    // Déroulé d'un changement de côté MAIN / SUB (FTX-1) : affiché à celui qui pilote, gardé dans le journal
    const text = String(m.text || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 500);
    journal('side_diag', { text });
    // Affiché seulement s'il s'est passé quelque chose d'anormal (émission, FT qui n'a pas suivi, commande refusée « ? »)
    // (un « ? » du TRX pendant un passage MAIN / SUB réussi n'est pas affiché : seulement gardé dans le journal)
    if (controller && /TX[12]|n’a pas suivi|refusé la commande|^ALC/.test(text)) send(controller, { t: 'notice', level: 'warn', msg: 'Station : ' + text });
    return;
  }
  if (m.t === 'safety') {
    const reason = String(m.reason || 'sécurité de la station').slice(0, 400);
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
  if (rig().derive) rig().derive(radio);
  if (rig().VIRTUAL_SPLIT) {
    // SPLIT mis ou retiré sur la face avant du TRX : suivi par le dashboard
    if (radio.hwSplit === 1 && lastHwSplit !== 1) txSel = 1;
    if (radio.hwSplit === 0 && lastHwSplit === 1) txSel = 0;
    lastHwSplit = radio.hwSplit;
    // VFO qui émet réellement d'après le TRX (FT relu), pour afficher la vérité pendant l'émission
    radio.txReal = radio.txVfo === 0 || radio.txVfo === 1 ? radio.txVfo : null;
    if (radio.tx && radio.txReal != null && radio.hwSplit !== 1 && radio.txReal !== txSide()) {
      if (!txMismatchAt) txMismatchAt = Date.now();
      else if (Date.now() - txMismatchAt > 1500 && ptt.active) stopPtt('le TRX émet sur ' + (radio.txReal ? 'SUB (VFO B)' : 'MAIN (VFO A)') + ' au lieu de ' + (txSide() ? 'SUB (VFO B)' : 'MAIN (VFO A)'));
    } else txMismatchAt = 0;
    radio.txVfo = txSide();
    radio.split = txSel; // affichage et contrôles : choix de l'opérateur
  }
  if (was !== radio.connected) journal(radio.connected ? 'trx_online' : 'trx_offline', {});
  // Fréquence du VFO pour les fréquences WSPR affichées
  if (digi.worker && radio.freq && radio.freq !== digi.dial) { digi.dial = radio.freq; digi.worker.postMessage({ t: 'dial', hz: radio.freq }); }
  sendWorked(false);
  // Contexte AP du décodeur WSJT-X (comme WSJT-X / JTDX) : notre indicatif, le correspondant du QSO en cours, l'étape du QSO
  if (digi.worker) {
    const on = !!(seq && seq.on);
    const ap = { t: 'ap', mycall: txCall(), mygrid: String(cfg.stationGrid || ''), hiscall: on ? seq.dx.call : '', hisgrid: on ? seq.dx.grid : '',
      qp: on ? seq.progress || 0 : 0, rx: seq ? seq.rxf || seq.f0 : 1500, tx: seq ? seq.f0 : 1500 };
    const k = JSON.stringify(ap);
    if (k !== digi.apKey) { digi.apKey = k; digi.worker.postMessage(ap); }
  }
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
  // Tuner remis en service tout seul : à la connexion du TRX et à chaque nouvelle bande HF / 6 m (une seule fois par bande)
  autoTuner();
  // Protection du PA : résultat de l'accord. Le TRX signale HI-SWR après le TUNE → émission bloquée sur toute la bande
  if (tuneWatch) checkTune();
  // Protection du PA : le TRX signale lui-même HI-SWR pendant une émission par le PTT
  if (ptt.active && radio.hiSwr === 1 && !radio.tuning && !radio.tuningRi && !tuneWatch) {
    swrLock = { freq: txFreq(), swr: null };
    journal('swr_cut', { call: ptt.conn.user.call, freq: txFreq(), swr: null, hi: true });
    stopPtt('le TRX signale HI-SWR — ' + (radio.tuner == null ? 'changez de fréquence ou faites vérifier l’antenne' : 'faites un accord (TUNE) avant de réémettre'));
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
