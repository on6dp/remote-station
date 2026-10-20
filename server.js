'use strict';
/*
 * Remote Station — serveur VPS
 * Relie la page "Station" (au club, FTX-1 en Web Serial) aux opérateurs (navigateur).
 * Aucune dépendance externe : modules Node natifs uniquement.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const ws = require('./lib/ws-lite');
const auth = require('./lib/auth');
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
const ROUTES = { '/': '/index.html', '/station': '/station.html' };

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (e) {
    res.writeHead(400);
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  if (p === '/api/info') {
    return sendJson(res, 200, {
      clubName: cfg.clubName,
      stationCall: cfg.stationCall,
      allowTx: cfg.allowTx,
      maxTxSeconds: cfg.maxTxSeconds,
      txRanges: cfg.txRanges
    });
  }
  p = ROUTES[p] || p;
  const fp = path.normalize(path.join(PUB, p));
  if (!fp.startsWith(PUB + path.sep)) {
    res.writeHead(404);
    return res.end();
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
function updateAudioWant() {
  const want = listeners() > 0;
  if (want !== audio.want) {
    audio.want = want;
    toStation({ t: 'audio_want', on: want });
  }
}
// Trame audio de la station → chaque membre à l'écoute (un client trop lent saute des trames au lieu d'accumuler du retard)
function relayAudio(buf) {
  if (!buf || buf.length < 2 || buf.length > 4000 || buf[0] !== 0x01) return;
  audio.frames++;
  for (const c of ops) if (c.listen && c.backlog < 32768) c.send(buf);
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
const fails = new Map(); // ip -> { n, until }

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
  const why = txBlockReason(conn);
  if (why && radio.power != null && radio.power > conn.user.maxWatts) limitPower(conn, 'avant émission');
  if (why) return send(conn, { t: 'notice', level: 'error', msg: 'PTT refusé : ' + why });
  const now = Date.now();
  ptt = { active: true, conn, since: now, lastBeat: now };
  lastCtrlActivity = now;
  toStation({ t: 'cmd', op: 'ptt', on: true, by: conn.user.call });
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
        c.close(4005, 'inactivité');
      }
    }
  }
}, 250);

// ---------------------------------------------------------------- messages opérateurs
async function onLogin(conn, m) {
  const now = Date.now();
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
    sessionIdleMinutes: cfg.sessionIdleMinutes
  });
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
      return send(conn, { t: 'pong', ts: m.ts });
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
  station = { conn, ip: conn.ip, since: Date.now(), rig: DRIVERS[model], ports, lastMsg: Date.now(), page: typeof m.page === 'string' ? m.page.slice(0, 40) : '' };
  conn.isStation = true;
  journal('station_online', { ip: conn.ip, model });
  send(conn, { t: 'welcome', stationCall: cfg.stationCall, txSilenceSeconds: cfg.txSilenceSeconds, txHardMaxSeconds: cfg.txHardMaxSeconds });
  audio.active = false;
  send(conn, { t: 'audio_want', on: listeners() > 0 });
  audio.want = listeners() > 0;
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
  if (m.t === 'safety') {
    const reason = String(m.reason || 'sécurité de la station').slice(0, 160);
    journal('tx_watchdog', { reason });
    if (ptt.active) stopPtt(reason);
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
  if (was !== radio.connected) journal(radio.connected ? 'trx_online' : 'trx_offline', {});
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
        return onOperator(conn, m);
      }
      if (m.t === 'login') return onLogin(conn, m).catch((e) => console.error(e));
      if (m.t === 'station') return onStationAuth(conn, m);
    });

    conn.on('close', () => {
      clearTimeout(authTimer);
      if (conn.isStation && station && station.conn === conn) {
        if (ptt.active) stopPtt('station déconnectée');
        station = null;
        radio = Object.assign({}, radio, { connected: false, tx: 0 });
        journal('station_offline', { ip: conn.ip, by: conn.closeBy || '?', code: conn.closeCode || null });
        broadcast();
      }
      if (conn.user) {
        ops.delete(conn);
        if (conn.listen) updateAudioWant();
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
  console.log('Remote Station à l’écoute sur ' + cfg.listen + ':' + cfg.port + ' — TX ' + (cfg.allowTx ? 'AUTORISÉ' : 'désactivé'));
});

process.on('SIGTERM', () => {
  if (ptt.active) stopPtt('arrêt du serveur');
  setTimeout(() => process.exit(0), 300);
});
