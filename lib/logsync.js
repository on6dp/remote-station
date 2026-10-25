'use strict';
/*
 * logsync.js — envoi des QSO aux carnets en ligne et aux logbooks du PC (UDP).
 *
 *  - Club Log : https://clublog.org/realtime.php (un QSO, envoi automatique) et putlogs.php (lot de QSO, fichier ADIF).
 *    Paramètres email, password (mot de passe d'application conseillé), callsign, api (clé API demandée au helpdesk).
 *    403 = accès refusé : on arrête tout de suite les envois automatiques (sinon Club Log bloque l'adresse IP).
 *  - eQSL : https://www.eQSL.cc/qslcard/ImportADIF.cfm (GET, ADIFData + EQSL_USER + EQSL_PSWD), un QSO par requête.
 *    « Result: x out of y records added » ; « Duplicate » = déjà reçu.
 *  - QRZ Logbook : https://logbook.qrz.com/api (POST KEY, ACTION=INSERT, ADIF) ; RESULT=OK / REPLACE / FAIL&REASON=…
 *  - LoTW : programme TQSL du PC où le certificat est installé, en mode lot :
 *    tqsl -x -u -d -a compliant -l "<lieu>" [-p <mot de passe>] fichier.adi ; codes de sortie 0 / 8 / 9 = accepté.
 *  - UDP : protocole WSJT-X (message 12 « Logged ADIF » ou 5 « QSO Logged »), XML contactinfo de N1MM, ou ADIF brut.
 */
const https = require('https');
const http = require('http');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const LB = require('./logbook.js');

const SERVICES = ['lotw', 'eqsl', 'clublog', 'qrz'];
const NAMES = { lotw: 'LoTW', eqsl: 'eQSL', clublog: 'Club Log', qrz: 'QRZ.com' };
const DEFAULT_URLS = {
  clublogRealtime: 'https://clublog.org/realtime.php',
  clublogPutlogs: 'https://clublog.org/putlogs.php',
  eqsl: 'https://www.eQSL.cc/qslcard/ImportADIF.cfm',
  lotwReport: 'https://lotw.arrl.org/lotwuser/lotwreport.adi',
  qrz: 'https://logbook.qrz.com/api'
};

// ------------------------------------------------------------------ HTTP minimal (sans dépendance)
function request(url, opts, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, Object.assign({ method: 'GET', timeout: 30000 }, opts), (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', (e) => resolve({ status: 0, text: e.message }));
    if (body) req.write(body);
    req.end();
  });
}
const form = (o) => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v == null ? '' : v)).join('&');
const short = (s, n) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200);

// ------------------------------------------------------------------ services
async function clublogOne(q, c, ua, urls) {
  if (!c.email || !c.password || !c.api) return { ok: false, msg: 'Club Log non configuré (e-mail, mot de passe, clé API)' };
  const body = form({ email: c.email, password: c.password, callsign: q.station_callsign, api: c.api, adif: LB.adifRecord(q) });
  const r = await request(urls.clublogRealtime, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': ua } }, body);
  if (r.status === 200) return { ok: true, msg: short(r.text, 80) || 'QSO OK' };
  if (r.status === 403) return { ok: false, stop: true, msg: 'accès refusé par Club Log (403) : envois arrêtés — ' + short(r.text, 120) };
  return { ok: false, msg: (r.status ? 'HTTP ' + r.status + ' ' : '') + short(r.text, 150) };
}
async function clublogBatch(list, c, ua, urls, clear) {
  if (!c.email || !c.password || !c.api) return { ok: false, msg: 'Club Log non configuré (e-mail, mot de passe, clé API)' };
  const results = [];
  // Un fichier par indicatif de station (le compte Club Log doit posséder chacun d'eux)
  const byCall = {};
  for (const q of list) (byCall[q.station_callsign] = byCall[q.station_callsign] || []).push(q);
  for (const [call, qs] of Object.entries(byCall)) {
    const boundary = '----RemoteStation' + Date.now().toString(16);
    const parts = [];
    for (const [k, v] of Object.entries({ email: c.email, password: c.password, callsign: call, api: c.api, clear: clear ? '1' : '0' })) {
      parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + '\r\n');
    }
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="remote-station.adi"\r\nContent-Type: text/plain\r\n\r\n' +
      LB.toAdif(qs, 'RemoteStation') + '\r\n--' + boundary + '--\r\n');
    const body = Buffer.from(parts.join(''), 'utf8');
    const r = await request(urls.clublogPutlogs, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length, 'User-Agent': ua } }, body);
    const res = r.status === 200 ? { ok: true, msg: 'fichier accepté (traitement par Club Log en quelques secondes)' }
      : { ok: false, stop: r.status === 403, msg: (r.status ? 'HTTP ' + r.status + ' ' : '') + short(r.text, 150) };
    for (const q of qs) results.push([q, res]);
    if (res.stop) break;
  }
  return results;
}
async function eqslOne(q, c, ua, urls) {
  if (!c.user || !c.password) return { ok: false, msg: 'eQSL non configuré (indicatif, mot de passe)' };
  const extra = c.nickname ? { app_eqsl_qth_nickname: c.nickname } : {};
  const adif = LB.adifHeader('RemoteStation') + LB.adifRecord(q, extra);
  const url = urls.eqsl + '?' + form({ ADIFData: adif, EQSL_USER: c.user, EQSL_PSWD: c.password });
  const r = await request(url, { headers: { 'User-Agent': ua } });
  if (r.status !== 200) return { ok: false, msg: 'HTTP ' + r.status + ' ' + short(r.text, 120) };
  const m = /Result:\s*(\d+)\s+out of\s+(\d+)\s+records added/i.exec(r.text);
  if (m && +m[1] >= 1) return { ok: true, msg: 'ajouté' };
  if (/Duplicate/i.test(r.text)) return { ok: true, msg: 'déjà reçu (doublon)' };
  const err = /(Error:[^<\n]*)/i.exec(r.text) || /(Warning:[^<\n]*)/i.exec(r.text);
  return { ok: false, stop: !!(err && /No match on eQSL_User/i.test(err[1])), msg: err ? short(err[1], 160) : short(r.text, 160) };
}
async function qrzOne(q, c, ua, urls) {
  const key = (c.keys || {})[q.station_callsign] || c.key;
  if (!key) return { ok: false, msg: 'QRZ : pas de clé API pour ' + q.station_callsign };
  const body = form({ KEY: key, ACTION: 'INSERT', ADIF: LB.adifRecord(q) });
  const r = await request(urls.qrz, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': ua } }, body);
  const p = Object.fromEntries(new URLSearchParams(r.text.trim()));
  if (p.RESULT === 'OK' || p.RESULT === 'REPLACE') return { ok: true, msg: 'LOGID ' + (p.LOGID || p.LOGIDS || '?') };
  if (/duplicate/i.test(p.REASON || '')) return { ok: true, msg: 'déjà dans le carnet QRZ (doublon)' };
  return { ok: false, stop: /invalid.*key|key.*invalid|not authorized/i.test(p.REASON || ''), msg: p.REASON ? short(p.REASON, 160) : (r.status !== 200 ? 'HTTP ' + r.status + ' ' : '') + short(r.text, 160) };
}
async function qrzTest(c, ua, urls) {
  const keys = Object.entries(c.keys || {}).filter(([, k]) => k);
  if (!keys.length) return { ok: false, msg: 'aucune clé API QRZ' };
  const out = [];
  for (const [call, key] of keys) {
    const r = await request(urls.qrz, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': ua } }, form({ KEY: key, ACTION: 'STATUS' }));
    const p = Object.fromEntries(new URLSearchParams(r.text.trim()));
    out.push(call + ' : ' + (p.RESULT === 'OK' ? 'clé valable' + (p.CALLSIGN ? ' (' + p.CALLSIGN + ')' : '') : 'refusée — ' + short(p.REASON || r.text, 100)));
  }
  return { ok: out.every((x) => /valable/.test(x)), msg: out.join(' · ') };
}
// TQSLDIR : dossier de données de TQSL (certificats, lieux de station) — utile quand le serveur tourne en service Windows
// (compte Système) alors que le certificat a été importé dans le compte de l'utilisateur
const tqslEnv = (c) => (c.tqslDir ? Object.assign({}, process.env, { TQSLDIR: c.tqslDir }) : process.env);
function lotwBatch(list, c) {
  return new Promise((resolve) => {
    if (!c.tqsl || !c.location) return resolve({ ok: false, msg: 'LoTW non configuré (programme TQSL et lieu de station)' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-lotw-'));
    const file = path.join(dir, 'remote-station.adi');
    fs.writeFileSync(file, LB.toAdif(list, 'RemoteStation'));
    const args = ['-x', '-u', '-d', '-a', 'compliant', '-l', c.location];
    if (c.password) args.push('-p', c.password);
    args.push(file);
    execFile(c.tqsl, args, { timeout: 180000, windowsHide: true, env: tqslEnv(c) }, (err, stdout, stderr) => {
      fs.rm(dir, { recursive: true, force: true }, () => {});
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      const tail = short(String(stderr || stdout).split(/\r?\n/).filter(Boolean).slice(-2).join(' '), 200);
      const TXT = { 0: 'signé et envoyé', 8: 'déjà envoyé (doublons ou hors des dates du certificat)', 9: 'envoyé (quelques doublons ignorés)',
        1: 'annulé', 2: 'refusé par LoTW', 3: 'réponse inattendue du serveur LoTW', 4: 'erreur TQSL', 5: 'erreur TQSLlib',
        6: 'fichier illisible', 7: 'écriture impossible', 10: 'paramètres refusés par TQSL', 11: 'LoTW injoignable (réseau)' };
      if (code === -1) return resolve({ ok: false, msg: 'TQSL introuvable ou bloqué : ' + short(err.message, 120) });
      resolve({ ok: code === 0 || code === 8 || code === 9, msg: 'TQSL ' + code + ' : ' + (TXT[code] || 'erreur') + (tail && code !== 0 ? ' — ' + tail : '') });
    });
  });
}
// Lecture d'un fichier ADIF (confirmations LoTW)
function parseAdif(text) {
  const out = [];
  const t = String(text);
  let i = t.search(/<eoh>/i);
  i = i < 0 ? 0 : i + 5;
  let rec = {};
  const re = /<([A-Za-z0-9_]+)(?::(\d+)(?::[A-Za-z])?)?>/g;
  re.lastIndex = i;
  let m;
  while ((m = re.exec(t))) {
    const name = m[1].toLowerCase();
    if (name === 'eor') { out.push(rec); rec = {}; continue; }
    if (name === 'eoh') { rec = {}; continue; }
    const n = m[2] ? parseInt(m[2], 10) : 0;
    rec[name] = t.substr(re.lastIndex, n);
    re.lastIndex += n;
  }
  return out;
}
const MODE_GROUP = (m) => (/^(SSB|AM|FM|DIGITALVOICE)$/.test(m) ? 'PH' : m === 'CW' ? 'CW' : 'DATA');
/** Confirmations LoTW reçues depuis une date : marque les QSO du carnet (lotw_qsl_rcvd = Y) */
async function lotwConfirm(book, c, since, ua, urls) {
  if (!c.login || !c.webPassword) return { ok: false, msg: 'identifiant / mot de passe du site LoTW non renseignés (confirmations non lues)' };
  const p = { login: c.login, password: c.webPassword, qso_query: '1', qso_qsl: 'yes', qso_qsldetail: 'yes', qso_qslsince: since || '1900-01-01' };
  const r = await request(urls.lotwReport + '?' + form(p), { headers: { 'User-Agent': ua }, timeout: 120000 });
  if (r.status !== 200 || !/<eoh>/i.test(r.text)) return { ok: false, msg: /password|incorrect/i.test(r.text) ? 'identifiant ou mot de passe LoTW refusé' : 'réponse LoTW inattendue (HTTP ' + r.status + ')' };
  const recs = parseAdif(r.text);
  const t = (d, h) => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +h.slice(0, 2), +h.slice(2, 4));
  let n = 0;
  for (const x of recs) {
    if (!x.call || !x.qso_date || !x.time_on) continue;
    const call = x.call.toUpperCase();
    const band = (x.band || '').toLowerCase();
    const q = book.qsos.find((y) => y.call === call && y.band === band && MODE_GROUP(y.mode) === MODE_GROUP((x.mode || '').toUpperCase()) &&
      Math.abs(t(y.qso_date, y.time_on) - t(x.qso_date, x.time_on)) <= 30 * 60000);
    if (q && q.lotw_qsl_rcvd !== 'Y') { q.lotw_qsl_rcvd = 'Y'; q.lotw_qslrdate = (x.qslrdate || '').replace(/\D/g, ''); n++; }
  }
  return { ok: true, msg: recs.length + ' confirmation(s) lue(s), ' + n + ' nouvelle(s) dans le carnet', n };
}
function lotwTest(c) {
  return new Promise((resolve) => {
    if (!c.tqsl) return resolve({ ok: false, msg: 'chemin de TQSL vide' });
    execFile(c.tqsl, ['-v'], { timeout: 20000, windowsHide: true, env: tqslEnv(c) }, (err, stdout, stderr) => {
      const t = short(String(stdout || '') + ' ' + String(stderr || ''), 120);
      resolve(err && !/TQSL/i.test(t) ? { ok: false, msg: 'TQSL ne répond pas : ' + short(err.message, 100) } : { ok: true, msg: t || 'TQSL présent' });
    });
  });
}

// ------------------------------------------------------------------ UDP vers les logbooks du PC (Swisslog, N1MM, Log4OM, HRD…)
function qstr(s) {
  const b = Buffer.from(String(s == null ? '' : s), 'utf8');
  const l = Buffer.alloc(4);
  if (s == null) l.writeUInt32BE(0xffffffff); else l.writeUInt32BE(b.length);
  return s == null ? l : Buffer.concat([l, b]);
}
function qdatetime(ms) {
  // QDateTime : jour julien (qint64), millisecondes depuis minuit (quint32), spécification horaire (1 = UTC)
  const d = new Date(ms);
  const jd = Math.floor(ms / 86400000) + 2440588;
  const b = Buffer.alloc(13);
  b.writeBigInt64BE(BigInt(jd), 0);
  b.writeUInt32BE(d.getUTCHours() * 3600000 + d.getUTCMinutes() * 60000 + d.getUTCSeconds() * 1000, 8);
  b.writeUInt8(1, 12);
  return b;
}
function wsjtxHead(type, id) {
  const h = Buffer.alloc(12);
  h.writeUInt32BE(0xadbccbda, 0);
  h.writeUInt32BE(2, 4);
  h.writeUInt32BE(type, 8);
  return Buffer.concat([h, qstr(id)]);
}
const qtime = (q, date, time) => Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), +time.slice(0, 2), +time.slice(2, 4), +time.slice(4, 6) || 0);
function udpPacket(q, format) {
  if (format === 'wsjtx-adif') return Buffer.concat([wsjtxHead(12, 'Remote Station'), qstr(LB.adifHeader('RemoteStation') + LB.adifRecord(q))]);
  if (format === 'wsjtx-qso') {
    const on = qtime(q, q.qso_date, q.time_on);
    const off = q.time_off ? qtime(q, q.qso_date_off || q.qso_date, q.time_off) : on;
    const hz = Buffer.alloc(8);
    hz.writeBigUInt64BE(BigInt(Math.round(Number(q.freq) * 1e6)));
    return Buffer.concat([wsjtxHead(5, 'Remote Station'), qdatetime(off), qstr(q.call), qstr(q.gridsquare || ''), hz, qstr(LB.modeName(q)),
      qstr(q.rst_sent || ''), qstr(q.rst_rcvd || ''), qstr(q.tx_pwr || ''), qstr(q.comment || ''), qstr(q.name || ''), qdatetime(on),
      qstr(q.operator || ''), qstr(q.station_callsign || ''), qstr(q.my_gridsquare || ''), qstr(q.stx_string || q.stx || ''),
      qstr(q.srx_string || q.srx || ''), qstr(q.prop_mode || '')]);
  }
  if (format === 'n1mm') {
    const x = (s) => LB.ascii(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const ts = q.qso_date.slice(0, 4) + '-' + q.qso_date.slice(4, 6) + '-' + q.qso_date.slice(6, 8) + ' ' + q.time_on.slice(0, 2) + ':' + q.time_on.slice(2, 4) + ':' + (q.time_on.slice(4, 6) || '00');
    const f10 = Math.round(Number(q.freq) * 1e5); // N1MM : dizaines de Hz
    const N1MM_BAND = { '2190m': '0.136', '630m': '0.472', '160m': '1.8', '80m': '3.5', '60m': '5', '40m': '7', '30m': '10', '20m': '14', '17m': '18',
      '15m': '21', '12m': '24', '10m': '28', '6m': '50', '4m': '70', '2m': '144', '1.25m': '222', '70cm': '432', '33cm': '902', '23cm': '1296',
      '13cm': '2300', '9cm': '3400', '6cm': '5760', '3cm': '10368', '1.25cm': '24192' };
    const bandMhz = N1MM_BAND[q.band] || String(Math.floor(Number(q.freq)));
    return Buffer.from('<?xml version="1.0" encoding="utf-8"?>\r\n<contactinfo><app>RemoteStation</app><contestname>' + x(q.contest_id || 'DX') +
      '</contestname><contestnr>1</contestnr><timestamp>' + ts + '</timestamp><mycall>' + x(q.station_callsign) + '</mycall><band>' + bandMhz +
      '</band><rxfreq>' + f10 + '</rxfreq><txfreq>' + f10 + '</txfreq><operator>' + x(q.operator) + '</operator><mode>' + x(LB.modeName(q)) +
      '</mode><call>' + x(q.call) + '</call><snt>' + x(q.rst_sent) + '</snt><sntnr>' + x(q.stx || 0) + '</sntnr><rcv>' + x(q.rst_rcvd) +
      '</rcv><rcvnr>' + x(q.srx || 0) + '</rcvnr><gridsquare>' + x(q.gridsquare) + '</gridsquare><comment>' + x(q.comment) + '</comment><name>' +
      x(q.name) + '</name><qth>' + x(q.qth) + '</qth><power>' + x(q.tx_pwr) + '</power><radionr>1</radionr><IsOriginal>True</IsOriginal><ID>' +
      q.id + '</ID><IsClaimedQso>True</IsClaimedQso></contactinfo>', 'utf8');
  }
  return Buffer.from(LB.adifRecord(q), 'utf8'); // ADIF brut
}
function sendUdp(q, dests, onLog) {
  for (const d of dests || []) {
    if (!d || !d.enabled || !d.host || !(d.port > 0 && d.port < 65536)) continue;
    let pkt;
    try { pkt = udpPacket(q, d.format); } catch (e) { onLog('UDP ' + d.host + ':' + d.port + ' : ' + e.message); continue; }
    const s = dgram.createSocket(d.host.includes(':') ? 'udp6' : 'udp4');
    s.on('error', (e) => { onLog('UDP ' + d.host + ':' + d.port + ' : ' + e.message); try { s.close(); } catch (x) {} });
    s.send(pkt, d.port, d.host, () => { try { s.close(); } catch (x) {} });
  }
}

// ------------------------------------------------------------------ files d'envoi
class Sync {
  /**
   * @param {object} o  getCfg(), book (Logbook), version, onJob(job, event) pour l'affichage, log(msg)
   */
  constructor(o) {
    this.o = o;
    this.busy = {};
    this.cancel = {};
    this.stopped = {};   // service bloqué après une erreur d'accès (jusqu'à la prochaine modification des réglages)
    this.urls = Object.assign({}, DEFAULT_URLS, o.urls || {});
  }
  ua() { return 'RemoteStation/' + (this.o.version || '0') + ' (' + (this.o.station || 'ON5VL') + ')'; }
  resetStops() { this.stopped = {}; }
  stop(s) { if (this.busy[s]) this.cancel[s] = true; }
  /** Lecture seule des confirmations LoTW (bouton « Confirmations ») */
  async confirmLotw(by, call) {
    const c = this.cred('lotw', call || '');
    const job = { id: Date.now().toString(36), service: 'lotw', name: 'LoTW', total: 0, done: 0, ok: 0, fail: 0, by: by || '' };
    this.o.onJob(job, { line: 'Lecture des confirmations LoTW depuis le ' + (c.lastConfirm || 'début') + '…', step: { id: 'fetch', state: 'run' } });
    const r = await lotwConfirm(this.o.book, c, c.lastConfirm || '1900-01-01', this.ua(), this.urls);
    if (r.ok) { this.o.book.save(); if (this.o.setLastConfirm) this.o.setLastConfirm(new Date(Date.now() - 86400000).toISOString().slice(0, 10)); }
    this.o.onJob(job, { line: (r.ok ? '✓ ' : '✗ ') + r.msg, step: { id: 'fetch', state: r.ok ? 'ok' : 'fail' } });
    this.o.onJob(job, { line: '', step: { id: 'import', state: r.ok ? 'ok' : 'fail' } });
    this.o.onJob(job, { line: 'Terminé.', fin: true, step: { id: 'status', state: r.ok ? 'ok' : 'fail' } });
    return r;
  }
  mark(q, s, r) {
    q.up = q.up || {};
    q.up[s] = { t: Date.now(), ok: !!r.ok, msg: String(r.msg || '').slice(0, 200) };
  }
  /** QSO à envoyer : jamais envoyés ou en échec (filtres facultatifs) */
  pending(s, f) {
    f = f || {};
    return this.o.book.query({ from: f.from, to: f.to }).filter((q) => (!f.callsign || q.station_callsign === f.callsign) && (f.all || !(q.up && q.up[s] && q.up[s].ok)));
  }
  /** Envoi automatique d'un QSO qui vient d'être enregistré */
  auto(q) {
    const cfg = this.o.getCfg();
    try { sendUdp(q, cfg.udp, this.o.log); } catch (e) { this.o.log('UDP : ' + e.message); }
    for (const s of SERVICES) {
      if (cfg[s] && cfg[s].auto && !this.stopped[s]) this.run(s, [q], { auto: true });
    }
  }
  /** Envoie une liste de QSO à un service ; job = { id, service, total, done, ok, fail, lines[] } */
  /** Réglages d'un service pour un indicatif (identifiants propres à chaque TX call, voir getCred) */
  cred(s, call) { return this.o.getCred ? this.o.getCred(s, call) : (this.o.getCfg()[s] || {}); }
  async run(s, list, opts) {
    opts = opts || {};
    const cfg = this.o.getCfg();
    const c0 = cfg[s] || {};
    const job = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), service: s, name: NAMES[s], total: list.length, done: 0, ok: 0, fail: 0, auto: !!opts.auto, by: opts.by || '' };
    const emit = (line, fin, step) => this.o.onJob(job, { line, fin, step });
    const step = (id, state, line) => emit(line || '', false, { id, state });
    if (this.stopped[s]) { emit(NAMES[s] + ' : envois arrêtés après un refus d\'accès — vérifiez les réglages puis enregistrez-les.', true); return job; }
    if (!list.length) { emit('Aucun QSO à envoyer.', true); return job; }
    // Un envoi à la fois par service (les automatiques attendent leur tour)
    while (this.busy[s]) await new Promise((r) => setTimeout(r, 500));
    this.busy[s] = true;
    const d = opts.delay != null && opts.delay !== '' && Number.isFinite(Number(opts.delay)) ? Number(opts.delay) : c0.delay != null ? c0.delay : 5;
    const delay = Math.max(0, Math.min(120, Number(d))) * 1000;
    emit(NAMES[s] + ' : ' + list.length + ' QSO à envoyer');
    // Un groupe par indicatif (TX call) : chacun avec ses propres identifiants
    const groups = new Map();
    for (const q of list) { const k = q.station_callsign || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(q); }
    for (const [call, glist] of groups) {
    if (this.cancel[s]) break;
    const c = this.cred(s, call);
    list = glist;
    if (groups.size > 1) emit('— ' + (call || '(sans indicatif)') + ' : ' + glist.length + ' QSO');
    if (s === 'lotw' && (!c.tqsl || !c.location)) {
      for (const q of glist) { this.mark(q, s, { ok: false, msg: 'LoTW non configuré pour ' + call }); job.done++; job.fail++; }
      emit('✗ LoTW non configuré pour ' + call + ' : Synchronisation → LoTW → identifiants de l’indicatif (lieu de station TQSL), programme TQSL dans ⚙ Configuration. Serveur sans TQSL : « Exporter pour TQSL ».', false, { id: 'export', state: 'fail' });
      continue;
    }
    try {
      if (s === 'lotw' || (s === 'clublog' && (list.length > 1 || opts.clear))) {
        if (s === 'lotw') {
          step('export', 'ok', 'Export de ' + list.length + ' QSO en ADIF');
          step('sign', 'run', 'Signature par TQSL (lieu de station « ' + (c.location || '?') + ' ») et envoi vers LoTW…');
          step('upload', 'run');
        }
        const r = s === 'lotw' ? await lotwBatch(list, c) : await clublogBatch(list, c, this.ua(), this.urls, opts.clear);
        const pairs = Array.isArray(r) ? r : list.map((q) => [q, r]);
        if (s === 'lotw') { step('sign', r.ok ? 'ok' : 'fail'); step('upload', r.ok ? 'ok' : 'fail'); }
        for (const [q, res] of pairs) {
          this.mark(q, s, res);
          job.done++;
          if (res.ok) job.ok++; else job.fail++;
          if (res.stop) this.stopped[s] = true;
        }
        emit((pairs[0] && pairs[0][1].ok ? '✓ ' : '✗ ') + (pairs[0] ? pairs[0][1].msg : ''));
        if (s === 'lotw' && !opts.auto && c.login) {
          step('fetch', 'run', 'Lecture des confirmations LoTW…');
          const since = c.lastConfirm || '1900-01-01';
          const cr = await lotwConfirm(this.o.book, c, since, this.ua(), this.urls);
          step('fetch', cr.ok ? 'ok' : 'fail', (cr.ok ? '✓ ' : '✗ ') + cr.msg);
          step('import', cr.ok ? 'ok' : 'fail');
          if (cr.ok && this.o.setLastConfirm) this.o.setLastConfirm(new Date(Date.now() - 86400000).toISOString().slice(0, 10));
        } else if (s === 'lotw') {
          step('fetch', 'skip', c.login ? '' : 'Confirmations non lues : identifiant du site LoTW non renseigné.');
          step('import', 'skip');
        }
      } else {
        for (const q of list) {
          const fn = s === 'eqsl' ? eqslOne : s === 'qrz' ? qrzOne : clublogOne;
          const res = await fn(q, c, this.ua(), this.urls);
          this.mark(q, s, res);
          job.done++;
          if (res.ok) job.ok++; else job.fail++;
          emit((res.ok ? '✓ ' : '✗ ') + q.call + ' ' + q.qso_date.slice(6, 8) + '/' + q.qso_date.slice(4, 6) + ' ' + q.time_on.slice(0, 2) + ':' + q.time_on.slice(2, 4) + ' ' + q.band + ' ' + LB.modeName(q) + ' — ' + res.msg);
          if (res.stop) { this.stopped[s] = true; emit('Envois arrêtés : ' + res.msg); break; }
          if (this.cancel[s]) { emit('Arrêté à la demande.'); break; }
          if (job.done < list.length && delay) await new Promise((r) => setTimeout(r, delay));
        }
      }
    } catch (e) {
      emit('✗ ' + e.message);
    }
    }
    this.busy[s] = false;
    this.cancel[s] = false;
    this.o.book.save();
    emit('Terminé : ' + job.ok + ' envoyé(s), ' + job.fail + ' en échec.', true, s === 'lotw' ? { id: 'status', state: job.fail ? 'fail' : 'ok' } : undefined);
    return job;
  }
  async test(s) {
    const c = (this.o.getCfg()[s]) || {};
    if (s === 'qrz') return qrzTest(c, this.ua(), this.urls);
    if (s === 'lotw') return lotwTest(c);
    if (s === 'eqsl') return c.user && c.password ? { ok: true, msg: 'réglages présents (eQSL n\'a pas de test sans envoi : le premier envoi le confirmera)' } : { ok: false, msg: 'indicatif ou mot de passe manquant' };
    if (s === 'clublog') return c.email && c.password && c.api ? { ok: true, msg: 'réglages présents (Club Log n\'a pas de test sans envoi : le premier envoi le confirmera)' } : { ok: false, msg: 'e-mail, mot de passe ou clé API manquant' };
    return { ok: false, msg: 'service inconnu' };
  }
}

module.exports = { Sync, SERVICES, NAMES, udpPacket, sendUdp, parseAdif, DEFAULT_URLS };
