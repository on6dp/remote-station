#!/usr/bin/env node
'use strict';
/*
 * agent-lotw.js — Agent LoTW de Remote Station (ON5VL / OR0L).
 *
 * Tourne sur le PC où TQSL et le certificat LoTW du membre sont déjà installés. Il ouvre lui-même une liaison
 * chiffrée (WSS) vers le serveur Remote Station : rien à ouvrir dans le routeur, fonctionne derrière un CGNAT
 * (Starlink…). Le serveur lui envoie les QSO à signer (ADIF) ; l'agent les fait signer et envoyer à LoTW par TQSL
 * de ce PC, puis renvoie le résultat : le serveur note alors les QSO « envoyés ». Le certificat et son mot de passe
 * ne quittent jamais ce PC.
 *
 * Utilisation :
 *   node agent-lotw.js --serveur https://remote.op0p.be --appairer ABCD-EFGH   appairage (une fois, code du carnet)
 *   node agent-lotw.js                                                         fonctionnement (service)
 *   node agent-lotw.js --etat                                                  réglages, TQSL et lieux de station trouvés
 *   node agent-lotw.js --oublier                                               retire l'appairage de ce PC
 *   node agent-lotw.js --mdp-certificat                                        mot de passe du certificat TQSL (s'il en a un),
 *                                                                              demandé au clavier et gardé seulement sur ce PC
 * Options : --tqsl CHEMIN (programme TQSL), --tqsldir DOSSIER (données TQSL), --nom NOM (nom de ce PC),
 *           --config FICHIER (réglages ; par défaut agent-lotw.json à côté de ce programme)
 *
 * Sans dépendance : Node.js 22 ou plus (WebSocket intégré).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const dgram = require('dgram');

const AGENT_VERSION = 3;
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const has = (n) => argv.indexOf(n) >= 0;
const CFG_FILE = path.resolve(arg('--config') || process.env.RS_AGENT_CONFIG || path.join(__dirname, 'agent-lotw.json'));
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' ') + ' ' + a.join(' '));

if (parseInt(process.versions.node, 10) < 22 || typeof WebSocket !== 'function') {
  console.error('Agent LoTW : Node.js 22 ou plus est nécessaire (trouvé : ' + process.version + ').');
  process.exit(2);
}

// ------------------------------------------------------------------ réglages (fichier local, jamais envoyé)
function loadCfg() {
  try { return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveCfg(c) {
  const tmp = CFG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, CFG_FILE);
}
function normServer(s) {
  s = String(s || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  return s;
}
const wsUrl = (server) => server.replace(/^http/i, 'ws') + '/ws';

// ------------------------------------------------------------------ TQSL de ce PC
function tqslCandidates(c) {
  const l = [];
  if (c.tqsl) l.push(c.tqsl);
  if (process.platform === 'win32') {
    for (const pf of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, 'C:\\Program Files (x86)', 'C:\\Program Files']) if (pf) l.push(path.join(pf, 'TrustedQSL', 'tqsl.exe'));
  } else if (process.platform === 'darwin') {
    l.push('/Applications/TrustedQSL/tqsl.app/Contents/MacOS/tqsl', '/Applications/tqsl.app/Contents/MacOS/tqsl');
  } else {
    l.push('/usr/bin/tqsl', '/usr/local/bin/tqsl', '/snap/bin/tqsl');
  }
  return l;
}
function findTqsl(c) { return tqslCandidates(c).find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || ''; }
// Dossier des données de TQSL (certificats, lieux de station « station_data »). Le service Windows tourne sous le
// compte Système : on cherche aussi dans le profil des utilisateurs du PC.
function dataCandidates(c) {
  const l = [];
  if (c.tqslDir) l.push(c.tqslDir);
  if (process.env.TQSLDIR) l.push(process.env.TQSLDIR);
  if (process.platform === 'win32') {
    if (process.env.APPDATA) l.push(path.join(process.env.APPDATA, 'TrustedQSL'));
    const users = path.join(process.env.SystemDrive || 'C:', 'Users');
    try { for (const u of fs.readdirSync(users)) l.push(path.join(users, u, 'AppData', 'Roaming', 'TrustedQSL')); } catch (e) { /* pas de dossier Users */ }
  } else if (process.platform === 'darwin') {
    l.push(path.join(os.homedir(), 'Library', 'Application Support', 'TrustedQSL'), path.join(os.homedir(), '.tqsl'));
  } else {
    l.push(path.join(os.homedir(), '.tqsl'));
  }
  return Array.from(new Set(l));
}
function findDataDir(c) { return dataCandidates(c).find((d) => fs.existsSync(path.join(d, 'station_data'))) || ''; }
const xmlText = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
/** Lieux de station de TQSL : [{ name, call, grid }] */
function readLocations(dir) {
  if (!dir) return [];
  let x = '';
  try { x = fs.readFileSync(path.join(dir, 'station_data'), 'utf8'); } catch (e) { return []; }
  const out = [];
  const re = /<StationData\s+name="([^"]*)"\s*>([\s\S]*?)<\/StationData>/gi;
  let m;
  while ((m = re.exec(x))) {
    const tag = (t) => { const r = new RegExp('<' + t + '>([^<]*)</' + t + '>', 'i').exec(m[2]); return r ? xmlText(r[1]).trim() : ''; };
    out.push({ name: xmlText(m[1]).slice(0, 80), call: tag('CALL').toUpperCase().slice(0, 15), grid: tag('GRIDSQUARE').toUpperCase().slice(0, 6) });
  }
  return out.slice(0, 50);
}
function info(c) {
  const tqsl = findTqsl(c);
  const dir = findDataDir(c);
  return { tqsl: !!tqsl, dir: !!dir, os: process.platform, locations: readLocations(dir) };
}

// Signature et envoi d'un lot par TQSL en mode ligne de commande (même appel que le serveur avec TQSL)
function sign(c, location, adif) {
  return new Promise((resolve) => {
    const tqsl = findTqsl(c);
    if (!tqsl) return resolve({ code: -1, err: 'TQSL introuvable sur ce PC (réglez-le : node agent-lotw.js --tqsl CHEMIN)' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-agent-lotw-'));
    const file = path.join(dir, 'remote-station.adi');
    fs.writeFileSync(file, adif);
    const args = ['-x', '-u', '-d', '-a', 'compliant', '-l', location];
    if (c.certPassword) args.push('-p', c.certPassword); // mot de passe du certificat : seulement dans le fichier local
    args.push(file);
    let cmd = tqsl;
    let full = args;
    // Linux sans écran (service) : TQSL a besoin d'un affichage, même en mode lot
    if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      const xr = ['/usr/bin/xvfb-run', '/usr/local/bin/xvfb-run'].find((p) => fs.existsSync(p));
      if (xr) { cmd = xr; full = ['-a', tqsl].concat(args); }
    }
    const data = findDataDir(c);
    const env = data ? Object.assign({}, process.env, { TQSLDIR: data }) : process.env;
    execFile(cmd, full, { timeout: 240000, windowsHide: true, env, encoding: 'buffer' }, (err, stdout, stderr) => {
      fs.rm(dir, { recursive: true, force: true }, () => {});
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      const out = decodeOut(stderr && stderr.length ? stderr : stdout).split(/\r?\n/).filter(Boolean).slice(-3).join(' ').slice(0, 300);
      resolve({ code, out, err: code === -1 && err ? String(err.message).slice(0, 200) : '' });
    });
  });
}

// Sortie de TQSL : UTF-8, sinon page de codes Windows (TQSL en français sous Windows : « télécharger » en cp1252)
function decodeOut(b) {
  if (!b || !b.length) return '';
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { /* pas de l'UTF-8 */ }
  try { return new TextDecoder('windows-1252').decode(b); } catch (e) { return Buffer.from(b).toString('latin1'); }
}

// ------------------------------------------------------------------ commandes ponctuelles
async function pair() {
  const c = loadCfg();
  const server = normServer(arg('--serveur') || c.server);
  const code = String(arg('--appairer') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!server) { console.error('Indiquez le serveur : --serveur https://remote.op0p.be'); process.exit(2); }
  if (code.length !== 8) { console.error('Code d’appairage invalide : 8 lettres et chiffres, comme ABCD-EFGH (carnet → Opérations LoTW → Agent LoTW).'); process.exit(2); }
  const name = String(arg('--nom') || c.name || os.hostname()).slice(0, 40);
  const r = await new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(wsUrl(server)); } catch (e) { return resolve({ ok: false, msg: e.message }); }
    const t = setTimeout(() => { try { ws.close(); } catch (e) { /* */ } resolve({ ok: false, msg: 'pas de réponse du serveur' }); }, 20000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'lotw_agent_pair', code, name, v: AGENT_VERSION, info: info(c) }));
    ws.onerror = () => { clearTimeout(t); resolve({ ok: false, msg: 'serveur injoignable (' + server + ')' }); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'lotw_agent_paired') { clearTimeout(t); resolve({ ok: true, m }); ws.close(); }
      if (m.t === 'lotw_agent_fail') { clearTimeout(t); resolve({ ok: false, msg: m.msg }); ws.close(); }
    };
  });
  if (!r.ok) { console.error('Appairage refusé : ' + r.msg); process.exit(1); }
  Object.assign(c, { server, id: r.m.id, token: r.m.token, owner: r.m.owner, name });
  if (arg('--tqsl')) c.tqsl = arg('--tqsl');
  if (arg('--tqsldir')) c.tqslDir = arg('--tqsldir');
  saveCfg(c);
  console.log('Agent LoTW appairé au compte ' + r.m.owner + ' sur ' + server + ' (PC « ' + name + ' »).');
  showState(c);
}
function showState(c) {
  const i = info(c);
  console.log('Réglages      : ' + CFG_FILE);
  console.log('Serveur       : ' + (c.server || '(aucun)') + (c.token ? ' — appairé (' + (c.owner || '?') + ')' : ' — pas appairé'));
  console.log('TQSL          : ' + (findTqsl(c) || 'INTROUVABLE (--tqsl CHEMIN)'));
  console.log('Données TQSL  : ' + (findDataDir(c) || 'INTROUVABLES (--tqsldir DOSSIER)'));
  console.log('Lieux station : ' + (i.locations.length ? i.locations.map((l) => l.name + ' (' + (l.call || '?') + ')').join(', ') : 'aucun'));
}

// ------------------------------------------------------------------ fonctionnement permanent
function run() {
  let c = loadCfg();
  let ws = null;
  let backoff = 5000;
  let lastMsg = 0;
  let sig = '';
  let queue = Promise.resolve();
  let cfgStamp = '';
  const stampOf = () => { const x = loadCfg(); return (x.server || '') + '|' + (x.id || '') + '|' + (x.token || '').slice(0, 6); };
  cfgStamp = stampOf();
  const connect = () => {
    c = loadCfg();
    if (!c.server || !c.id || !c.token) { log('Pas encore appairé : node agent-lotw.js --serveur https://remote.op0p.be --appairer CODE'); return setTimeout(connect, 15000); }
    log('Connexion à ' + c.server + '…');
    try { ws = new WebSocket(wsUrl(c.server)); } catch (e) { log('Erreur : ' + e.message); return retry(); }
    ws.onopen = () => {
      lastMsg = Date.now();
      const i = info(c);
      sig = JSON.stringify(i);
      ws.send(JSON.stringify({ t: 'lotw_agent', id: c.id, token: c.token, name: c.name || os.hostname(), v: AGENT_VERSION, info: i }));
    };
    ws.onmessage = (ev) => {
      lastMsg = Date.now();
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'lotw_agent_ok') {
        backoff = 5000;
        log('Connecté : compte ' + m.owner + ', indicatifs ' + ((m.calls || []).join(', ') || 'aucun'));
        if (m.agentV > AGENT_VERSION) selfUpdate(m.agentV);
      } else if (m.t === 'lotw_agent_fail') {
        log('Refusé par le serveur : ' + m.msg);
        if (m.forget) { const x = loadCfg(); delete x.token; delete x.id; saveCfg(x); cfgStamp = stampOf(); }
      } else if (m.t === 'lotw_udp' && Number.isInteger(m.port) && m.port > 0 && m.port < 65536 && typeof m.data === 'string' && m.data.length < 90000) {
        // QSO à transmettre au logbook de CE PC (Swisslog, Log4OM…) : toujours vers 127.0.0.1, jamais ailleurs
        const buf = Buffer.from(m.data, 'base64');
        const sock = dgram.createSocket('udp4');
        sock.send(buf, m.port, '127.0.0.1', (e) => { if (e) log('UDP ' + m.port + ' : ' + e.message); else log('QSO ' + (m.call || '') + ' transmis au logbook du PC (port ' + m.port + ')'); sock.close(); });
      } else if (m.t === 'lotw_sign' && typeof m.rid === 'string' && typeof m.adif === 'string' && typeof m.location === 'string') {
        // Un lot à la fois (TQSL n'aime pas deux signatures simultanées)
        queue = queue.then(async () => {
          log('Signature de ' + (m.n || '?') + ' QSO (lieu « ' + m.location + ' »)…');
          const r = await sign(c, m.location, m.adif);
          log('TQSL ' + r.code + (r.out ? ' — ' + r.out : '') + (r.err ? ' — ' + r.err : ''));
          if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'lotw_signed', rid: m.rid, code: r.code, out: r.out, err: r.err }));
        });
      }
    };
    ws.onclose = (ev) => { log('Liaison fermée' + (ev && ev.reason ? ' : ' + ev.reason : '')); ws = null; retry(); };
    ws.onerror = () => { /* onclose suit */ };
  };
  const retry = () => { setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 120000); };
  setInterval(() => {
    // Réglages changés (nouvel appairage depuis la ligne de commande) : reconnexion
    const st = stampOf();
    if (st !== cfgStamp) { cfgStamp = st; log('Réglages modifiés : reconnexion'); if (ws) ws.close(); }
    if (!ws || ws.readyState !== 1) return;
    if (Date.now() - lastMsg > 95000) { log('Plus de nouvelles du serveur : reconnexion'); try { ws.close(); } catch (e) { /* */ } return; }
    ws.send(JSON.stringify({ t: 'ping' }));
    // Lieux de station ajoutés ou modifiés dans TQSL : annoncés au serveur
    const i = info(c);
    const s = JSON.stringify(i);
    if (s !== sig) { sig = s; ws.send(JSON.stringify({ t: 'lotw_agent_info', info: i })); }
  }, 30000);
  connect();
}
// Mise à jour de l'agent : nouvelle version proposée par le serveur, reprise depuis lui (HTTPS), puis redémarrage
let updating = false;
async function selfUpdate(v) {
  if (updating || has('--sans-maj')) return;
  updating = true;
  try {
    const c = loadCfg();
    const r = await fetch(c.server + '/agent/agent-lotw.js', { signal: AbortSignal.timeout(30000) });
    const txt = await r.text();
    const mv = /const AGENT_VERSION = (\d+);/.exec(txt);
    if (r.status !== 200 || !mv || Number(mv[1]) <= AGENT_VERSION || !/^#!\/usr\/bin\/env node/.test(txt)) throw new Error('fichier inattendu');
    const me = __filename;
    fs.writeFileSync(me + '.new', txt);
    fs.renameSync(me + '.new', me);
    log('Agent mis à jour (version ' + mv[1] + ') : redémarrage');
    process.exit(75); // le service (WinSW / systemd) relance l'agent
  } catch (e) {
    log('Mise à jour de l’agent impossible : ' + e.message);
    updating = false;
  }
}

// Réglages donnés sur la ligne de commande (sauf appairage, qui les enregistre lui-même) : gardés dans le fichier local
if (!has('--appairer')) {
  const c = loadCfg();
  let ch = false;
  if (arg('--tqsl')) { c.tqsl = arg('--tqsl'); ch = true; }
  if (arg('--tqsldir')) { c.tqslDir = arg('--tqsldir'); ch = true; }
  if (arg('--nom')) { c.name = arg('--nom').slice(0, 40); ch = true; }
  if (arg('--serveur')) { c.server = normServer(arg('--serveur')); ch = true; }
  if (ch) saveCfg(c);
}
if (has('--appairer')) pair().catch((e) => { console.error(e.message); process.exit(1); });
else if (has('--etat')) showState(loadCfg());
else if (has('--mdp-certificat')) {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Mot de passe du certificat TQSL (vide = aucun) : ', (pw) => {
    rl.close();
    const c = loadCfg();
    if (pw) c.certPassword = pw; else delete c.certPassword;
    saveCfg(c);
    console.log(pw ? 'Mot de passe enregistré dans ' + CFG_FILE + ' (ce PC seulement).' : 'Pas de mot de passe de certificat.');
  });
}
else if (has('--oublier')) { const c = loadCfg(); delete c.token; delete c.id; delete c.owner; saveCfg(c); console.log('Appairage retiré de ce PC (retirez-le aussi dans le carnet : Opérations LoTW → Agent LoTW).'); }
else {
  log('Agent LoTW ' + AGENT_VERSION + ' (Node.js ' + process.version + ')');
  showState(loadCfg());
  run();
}
