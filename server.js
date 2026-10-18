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
const FTX1 = require('./public/js/ftx1.js');

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
  txRanges: []
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
let radio = { connected: false, freq: null, mode: null, modeCode: null, tx: 0, smeter: 0 };
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

function inTxRange(hz) {
  return cfg.txRanges.some((r) => hz >= r[0] && hz <= r[1]);
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
    txOk: radio.freq != null && inTxRange(radio.freq)
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
  journal('tx_stop', { call: who.user.call, durationS: dur, reason, freq: radio.freq, mode: radio.mode });
  if (reason !== 'relâché') {
    // Coupure forcée : l'opérateur doit relâcher le PTT avant de pouvoir réémettre
    who.needRelease = true;
    send(who, { t: 'notice', level: 'warn', msg: 'Émission coupée : ' + reason, pttCut: true });
  }
  broadcast();
}

function startPtt(conn) {
  const why =
    !cfg.allowTx ? 'émission désactivée sur ce serveur' :
    !conn.user.tx ? 'votre compte n’est pas autorisé à émettre' :
    controller !== conn ? 'prenez d’abord la main' :
    !station ? 'station hors ligne' :
    !radio.connected ? 'TRX non connecté' :
    radio.freq == null || !inTxRange(radio.freq) ? 'fréquence hors des bandes autorisées' :
    null;
  if (why) return send(conn, { t: 'notice', level: 'error', msg: 'PTT refusé : ' + why });
  const now = Date.now();
  ptt = { active: true, conn, since: now, lastBeat: now };
  lastCtrlActivity = now;
  toStation({ t: 'cmd', op: 'ptt', on: true, by: conn.user.call });
  toStation({ t: 'txka' });
  journal('tx_start', { call: conn.user.call, ip: conn.ip, freq: radio.freq, mode: radio.mode });
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
  const rec = auth.validCall(call) ? users[call] : null;
  const ok = rec && !rec.disabled && (await auth.verifyPassword(m.pass, rec));
  if (!ok) {
    const expired = f && f.until && f.until <= now;
    const n = (f && !expired ? f.n : 0) + 1;
    fails.set(conn.ip, { n, until: n >= 5 ? now + 10 * 60000 : 0 });
    journal('login_fail', { call, ip: conn.ip });
    return setTimeout(() => send(conn, { t: 'login_fail', msg: 'Indicatif ou mot de passe incorrect' }), 600);
  }
  fails.delete(conn.ip);
  conn.user = { call, admin: !!rec.admin, tx: rec.tx !== false };
  ops.add(conn);
  journal('login', { call, ip: conn.ip });
  send(conn, {
    t: 'hello',
    call,
    admin: conn.user.admin,
    canTx: conn.user.tx,
    allowTx: cfg.allowTx,
    maxTxSeconds: cfg.maxTxSeconds,
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
        if (!(hz >= FTX1.FREQ_MIN && hz <= FTX1.FREQ_MAX)) {
          return send(conn, { t: 'notice', level: 'error', msg: 'Fréquence hors de la couverture du TRX' });
        }
        toStation({ t: 'cmd', op: 'freq', hz });
        radio.freq = hz; // affichage optimiste, corrigé au prochain polling
      }
      if (m.mode != null) {
        const code = String(m.mode).toUpperCase();
        if (FTX1.SETTABLE.indexOf(code) < 0) return send(conn, { t: 'notice', level: 'error', msg: 'Mode non disponible' });
        toStation({ t: 'cmd', op: 'mode', code });
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
  if (station) {
    send(station.conn, { t: 'error', msg: 'Remplacée par une nouvelle connexion station' });
    station.conn.close(4002, 'remplacée');
  }
  station = { conn, ip: conn.ip, since: Date.now() };
  conn.isStation = true;
  journal('station_online', { ip: conn.ip });
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
    tx: [0, 1, 2].indexOf(r.tx) >= 0 ? r.tx : 0,
    smeter: Number.isFinite(r.smeter) ? r.smeter : 0
  };
  if (was !== radio.connected) journal(radio.connected ? 'trx_online' : 'trx_offline', {});
  // Sécurité : la radio est en CAT TX alors qu'aucun PTT n'est actif côté serveur
  if (radio.tx === 1 && !ptt.active) toStation({ t: 'cmd', op: 'ptt', on: false, reason: 'incohérence serveur' });
  // Sécurité : sortie de bande pendant l'émission
  if (ptt.active && radio.freq != null && !inTxRange(radio.freq)) stopPtt('fréquence hors bande');
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
