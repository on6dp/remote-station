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
const DRIVERS = { ftx1: require('./public/js/ftx1.js') };
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
  usersFile: 'users.json',
  logDir: 'logs',
  txRanges: [],
  // Seuls ces préfixes peuvent se connecter
  allowedPrefixes: ['ON', 'OO', 'OP', 'OQ', 'OR', 'OS', 'OT'],
  // Puissance maximale par début d'indicatif (première règle qui correspond), sinon defaultMaxWatts
  powerRules: [{ prefix: 'ON3', maxWatts: 25 }],
  defaultMaxWatts: 1500
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
function journal(ev, data) {
  const d = new Date();
  const line = JSON.stringify(Object.assign({ ts: d.toISOString(), ev }, data)) + '\n';
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
  if (!conn || !conn.user || radio.power == null || radio.power <= conn.user.maxWatts) return false;
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

// Raison qui empêche cet opérateur d'émettre (PTT ou TUNE), ou null
function txBlockReason(conn) {
  return !cfg.allowTx ? 'émission désactivée sur ce serveur' :
    !conn.user.tx ? 'votre compte n’est pas autorisé à émettre' :
    controller !== conn ? 'prenez d’abord la main' :
    !station ? 'station hors ligne' :
    !radio.connected ? 'TRX non connecté' :
    radio.vox ? 'VOX actif au club : coupez-le d’abord' :
    !inTxRange(txFreq()) ? 'fréquence d’émission hors des bandes autorisées' + (radio.txVfo === 1 ? ' (VFO B en SPLIT)' : '') :
    radio.power == null ? 'puissance du TRX inconnue' :
    radio.power > conn.user.maxWatts ? 'puissance ' + radio.power + ' W au-delà de votre limite (' + conn.user.maxWatts + ' W)' :
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
    users: calls.sort(),
    ptt: { active: ptt.active, by: ptt.active ? ptt.conn.user.call : null, since: ptt.since },
    txOk: inTxRange(txFreq()),
    txFreq: txFreq(),
    rigName: rig().NAME
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
  if (controller && now - lastCtrlActivity > cfg.controlIdleMinutes * 60000) {
    const c = controller;
    stopPtt('inactivité');
    controller = null;
    send(c, { t: 'notice', level: 'warn', msg: 'Main libérée après ' + cfg.controlIdleMinutes + ' min d’inactivité' });
    journal('control_release', { call: c.user.call, reason: 'inactivité' });
    broadcast();
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
  conn.user = { call, admin: !!rec.admin, tx: rec.tx !== false, maxWatts: maxWattsFor(call) };
  ops.add(conn);
  journal('login', { call, ip: conn.ip });
  send(conn, {
    t: 'hello',
    call,
    admin: conn.user.admin,
    canTx: conn.user.tx,
    allowTx: cfg.allowTx,
    maxTxSeconds: cfg.maxTxSeconds,
    maxWatts: conn.user.maxWatts,
    clubName: cfg.clubName,
    stationCall: cfg.stationCall
  });
  broadcast();
}

function onOperator(conn, m) {
  const now = Date.now();
  switch (m.t) {
    case 'take':
      if (controller && controller !== conn) {
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
          const why = txBlockReason(conn);
          if (why) {
            if (radio.power != null && radio.power > conn.user.maxWatts) limitPower(conn, 'avant ' + c.label);
            return send(conn, { t: 'notice', level: 'error', msg: c.label + ' refusé : ' + why });
          }
          journal('tune', { call: conn.user.call, ip: conn.ip, freq: txFreq(), watts: radio.power });
        }
        toStation({ t: 'cmd', op: 'ctl', id: m.ctl, value: v, by: conn.user.call });
        if (c.type !== 'action') radio[m.ctl] = v; // affichage optimiste
      }
      if (m.power != null) {
        const w = Number(m.power);
        const range = rig().POWER_RANGE[radio.powerHead];
        if (!range) return send(conn, { t: 'notice', level: 'error', msg: 'Puissance non réglable : type de tête du TRX inconnu' });
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
  if (!DRIVERS[model]) {
    send(conn, { t: 'error', msg: 'Modèle de radio non pris en charge par ce serveur : ' + model });
    return setTimeout(() => conn.close(4003, 'modèle inconnu'), 300);
  }
  if (station) {
    send(station.conn, { t: 'error', msg: 'Remplacée par une nouvelle connexion station' });
    station.conn.close(4002, 'remplacée');
  }
  station = { conn, ip: conn.ip, since: Date.now(), rig: DRIVERS[model] };
  conn.isStation = true;
  journal('station_online', { ip: conn.ip, model });
  send(conn, { t: 'welcome', stationCall: cfg.stationCall });
  broadcast();
}

function onStation(conn, m) {
  if (m.t !== 'radio' || !m.radio) return;
  const r = m.radio;
  const was = radio.connected;
  radio = {
    connected: !!r.connected,
    freq: Number.isFinite(r.freq) ? r.freq : null,
    mode: typeof r.mode === 'string' ? r.mode.slice(0, 12) : null,
    modeCode: typeof r.modeCode === 'string' ? r.modeCode.slice(0, 1) : null,
    freqB: Number.isFinite(r.freqB) ? r.freqB : null,
    modeB: typeof r.modeB === 'string' ? r.modeB.slice(0, 12) : null,
    modeCodeB: typeof r.modeCodeB === 'string' ? r.modeCodeB.slice(0, 1) : null,
    tx: [0, 1, 2].indexOf(r.tx) >= 0 ? r.tx : 0,
    smeter: Number.isFinite(r.smeter) ? r.smeter : 0,
    power: Number.isFinite(r.power) ? r.power : null,
    powerHead: r.powerHead === '1' || r.powerHead === '2' ? r.powerHead : null,
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
  broadcast();
}

// ---------------------------------------------------------------- connexions WebSocket
ws.attach(server, {
  path: '/ws',
  maxPayload: 64 * 1024,
  onConnection(conn, req) {
    conn.ip = clientIp(req);
    conn.user = null;
    conn.isStation = false;
    const authTimer = setTimeout(() => {
      if (!conn.user && !conn.isStation) conn.close(4000, 'pas d’authentification');
    }, 15000);

    conn.on('message', (data, isBinary) => {
      if (isBinary) return; // réservé à l'audio (phase 2)
      let m;
      try {
        m = JSON.parse(data);
      } catch (e) {
        return;
      }
      if (!m || typeof m.t !== 'string') return;
      if (conn.isStation) return onStation(conn, m);
      if (conn.user) return onOperator(conn, m);
      if (m.t === 'login') return onLogin(conn, m).catch((e) => console.error(e));
      if (m.t === 'station') return onStationAuth(conn, m);
    });

    conn.on('close', () => {
      clearTimeout(authTimer);
      if (conn.isStation && station && station.conn === conn) {
        if (ptt.active) stopPtt('station déconnectée');
        station = null;
        radio = Object.assign({}, radio, { connected: false, tx: 0 });
        journal('station_offline', { ip: conn.ip });
        broadcast();
      }
      if (conn.user) {
        ops.delete(conn);
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
