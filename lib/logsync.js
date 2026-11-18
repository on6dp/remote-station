'use strict';
/*
 * logsync.js — envoi des QSO aux carnets en ligne et aux logbooks du PC (UDP).
 *
 *  - Club Log : https://clublog.org/realtime.php (un QSO, envoi automatique) et putlogs.php (lot de QSO, fichier ADIF).
 *    Paramètres email, password (mot de passe d'application conseillé), callsign, api (clé API demandée au helpdesk).
 *    403 = accès refusé : on arrête tout de suite les envois automatiques (sinon Club Log bloque l'adresse IP).
 *    Ou, si la « clé API » commence par cl_ : jeton de la nouvelle API REST (https://clublog.org/api/v1, Bearer) :
 *    POST /qso (un QSO), POST /qso/batch (100 au plus), POST /logs/{call}/uploads (fichier ADIF, clear=1), GET /me/usage (test).
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
  clublogCheck: 'https://clublog.org/check.php', // refus et blocages récents de l'adresse IP qui demande (ce serveur)
  clublogApi: 'https://clublog.org/api/v1', // nouvelle API : jeton « cl_… » (Bearer)
  eqsl: 'https://www.eQSL.cc/qslcard/ImportADIF.cfm',
  lotwReport: 'https://lotw.arrl.org/lotwuser/lotwreport.adi',
  qrz: 'https://logbook.qrz.com/api'
};

// ------------------------------------------------------------------ HTTP minimal (sans dépendance)
function request(url, opts, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const o2 = Object.assign({ method: 'GET', timeout: 30000 }, opts);
    const onData = o2.onData; delete o2.onData;
    let got = 0;
    const req = mod.request(u, o2, (res) => {
      const chunks = [];
      // Suivi facultatif (gros téléchargements : confirmations LoTW) ; renvoie true pour abandonner
      if (onData && onData(0, req)) { req.destroy(new Error('arrêté à la demande')); return; }
      res.on('data', (c) => { chunks.push(c); got += c.length; if (onData && onData(got, req)) req.destroy(new Error('arrêté à la demande')); });
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
// Refus de Club Log (403) : e-mail du compte, mot de passe d'application, indicatif de ce compte ou clé API refusés ;
// après plusieurs refus, le pare-feu de Club Log bloque l'adresse IP du serveur environ une heure (page « nginx »)
// Pare-feu (adresse IP bloquée) : page « 403 Forbidden » de nginx, ou texte qui parle de blocage. Une page HTML de
// Club Log lui-même (identifiants refusés) n'en est pas une : son texte est montré tel quel.
const clublogFw = (text) => /nginx|firewall|blocked|banned/i.test(String(text || ''));
function clublog403(text, call) {
  const fw = clublogFw(text);
  const said = short(String(text || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' '), 160);
  return 'accès refusé par Club Log (403)' + (fw ? ' : adresse IP de ce serveur bloquée par le pare-feu de Club Log (environ 1 heure)' : '') +
    (said ? ' — réponse de Club Log : « ' + said + ' »' : '') +
    '. Vérifiez : e-mail du compte Club Log (pas l’indicatif), mot de passe d’APPLICATION (Club Log exige un mot de passe d’application pour les envois, pas celui du site : Club Log → Settings → App Passwords), ' + (call || 'l’indicatif') + ' bien enregistré dans ce compte, clé API ; enregistrez-les, puis réessayez' + (fw ? ' dans une heure' : '') + '.';
}
// ---- Nouvelle API de Club Log (api/v1) : jeton « cl_… » créé par le titulaire du compte (Club Log → Settings → API →
// Tokens), envoyé en « Authorization: Bearer ». Ni e-mail, ni mot de passe, ni clé API du helpdesk.
const clublogTok = (c) => (/^cl_[A-Za-z0-9_-]{8,}$/.test(String(c.api || '').trim()) ? String(c.api).trim() : '');
function clublogTokErr(r) {
  let said = '';
  try { const j = JSON.parse(r.text); said = j.message || (typeof j.error === 'string' ? j.error : j.error && j.error.message) || j.detail || ''; } catch (e) { said = short(r.text, 160); }
  return short(said, 200);
}
async function clublogTokSend(path, method, tok, ua, urls, obj, multi) {
  const body = multi ? multi.body : obj ? JSON.stringify(obj) : null;
  const h = { Authorization: 'Bearer ' + tok, Accept: 'application/json', 'User-Agent': ua };
  if (body) { h['Content-Type'] = multi ? 'multipart/form-data; boundary=' + multi.boundary : 'application/json'; h['Content-Length'] = Buffer.byteLength(body); }
  return request(urls.clublogApi + path, { method, headers: h, timeout: 60000 }, body);
}
// Refus du jeton (401/403), trop de requêtes (429), autre erreur de la requête entière : résultat commun
function clublogTokFail(r, call) {
  const said = clublogTokErr(r);
  if (r.status === 401 || r.status === 403) {
    const fw = r.status === 403 && /<html/i.test(r.text) && clublogFw(r.text);
    return { ok: false, stop: true, fw, msg: 'jeton Club Log refusé (' + r.status + ')' + (said ? ' — « ' + said + ' »' : '') + (fw ? ' : adresse IP du serveur bloquée environ 1 heure' : '') + '. Vérifiez le jeton (Club Log → Settings → API → Tokens) et que ' + (call || 'l’indicatif') + ' est bien un indicatif de ce compte Club Log, puis enregistrez-le.' };
  }
  if (r.status === 429) {
    const ra = Number((/retry-after"?\s*[:=]\s*"?(\d+)/i.exec(r.text) || [])[1]) || 0;
    return { ok: false, stop: true, msg: 'Club Log : trop de requêtes (429), envois arrêtés' + (ra ? ' — réessayer dans ' + Math.ceil(ra / 60) + ' min' : '') + (said ? ' — « ' + said + ' »' : '') };
  }
  return { ok: false, stop: r.status >= 400 && r.status < 500 && r.status !== 422, msg: (r.status ? 'Club Log HTTP ' + r.status : 'Club Log injoignable : ' + short(r.text, 80)) + (said ? ' — « ' + said + ' »' : '') };
}
// Réponse d'un QSO (POST /qso, ou un élément de /qso/batch) : created / updated / duplicate = reçu ; rejected = refusé
function clublogTokItem(j, http) {
  const st = String((j && j.status) || '').toLowerCase();
  const warn = j && j.warning ? ' (' + short(j.warning, 100) + ')' : '';
  if (st === 'created' || (!st && http === 201)) return { ok: true, msg: 'QSO enregistré dans Club Log' + warn, qsoid: j && j.qsoid };
  if (st === 'updated') return { ok: true, msg: 'QSO mis à jour dans Club Log' + warn, qsoid: j && j.qsoid };
  if (st === 'duplicate') return { ok: true, msg: 'déjà dans le log Club Log (doublon)', qsoid: j && j.qsoid };
  return { ok: false, msg: 'refusé par Club Log' + (j && (j.message || j.error) ? ' : « ' + short(j.message || j.error, 160) + ' »' : st ? ' (' + st + ')' : '') };
}
// Corps d'un QSO : indicatif du log (doit appartenir au compte du jeton) + l'enregistrement ADIF complet
const clublogTokQso = (q) => ({ call: String(q.station_callsign || '').toUpperCase(), adif: LB.adifRecord(q) });
/** Un QSO (envoi automatique) : POST /api/v1/qso */
async function clublogTokOne(q, tok, ua, urls) {
  const r = await clublogTokSend('/qso', 'POST', tok, ua, urls, clublogTokQso(q));
  let j = null; try { j = JSON.parse(r.text); } catch (e) { /* */ }
  if (r.status === 200 || r.status === 201) return clublogTokItem(j, r.status);
  if (r.status === 422) return { ok: false, msg: 'refusé par Club Log' + (clublogTokErr(r) ? ' : « ' + clublogTokErr(r) + ' »' : '') };
  return clublogTokFail(r, q.station_callsign);
}
/** Lot : POST /api/v1/qso/batch, 100 QSO au plus par requête ; chaque QSO a son propre résultat */
async function clublogTokBatch(list, tok, ua, urls) {
  const results = [];
  for (let i = 0; i < list.length; i += 100) {
    const part = list.slice(i, i + 100);
    const r = await clublogTokSend('/qso/batch', 'POST', tok, ua, urls, { qsos: part.map(clublogTokQso) });
    let j = null; try { j = JSON.parse(r.text); } catch (e) { /* */ }
    const arr = Array.isArray(j) ? j : j && (j.results || j.qsos || j.items || j.data);
    if ((r.status === 200 || r.status === 201 || r.status === 207) && Array.isArray(arr)) {
      part.forEach((q, k) => results.push([q, arr[k] ? clublogTokItem(arr[k], 0) : { ok: false, nomark: true, msg: 'pas de résultat de Club Log pour ce QSO' }]));
      continue;
    }
    const res = r.status >= 200 && r.status < 300 ? { ok: false, nomark: true, stop: true, msg: 'réponse inattendue de Club Log : ' + short(r.text, 160) } : clublogTokFail(r, part[0].station_callsign);
    for (const q of list.slice(i)) results.push([q, res]);
    break;
  }
  return results;
}
/** « Effacer le log existant » : fichier ADIF complet, POST /api/v1/logs/{call}/uploads avec clear=1 (traité en file d'attente) */
async function clublogTokReplace(list, call, tok, ua, urls) {
  const boundary = '----RemoteStation' + Date.now().toString(16);
  const body = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="clear"\r\n\r\n1\r\n' +
    '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="remote-station.adi"\r\nContent-Type: text/plain\r\n\r\n' +
    LB.toAdif(list, 'RemoteStation') + '\r\n--' + boundary + '--\r\n', 'utf8');
  const r = await clublogTokSend('/logs/' + encodeURIComponent(call) + '/uploads', 'POST', tok, ua, urls, null, { body, boundary });
  if (r.status === 202 || r.status === 200 || r.status === 201) return { ok: true, msg: 'log de ' + call + ' remplacé : fichier en file d’attente chez Club Log (importé dans quelques minutes)' };
  if (r.status === 409) return { ok: true, msg: 'fichier identique déjà traité par Club Log ces 3 derniers jours' };
  return clublogTokFail(r, call);
}
async function clublogTokTest(tok, ua, urls) {
  const r = await clublogTokSend('/me/usage?days=1', 'GET', tok, ua, urls);
  if (r.status === 200) {
    let j = null; try { j = JSON.parse(r.text); } catch (e) { /* */ }
    if (j && !j.error) return { ok: true, msg: 'jeton accepté par Club Log' };
    return { ok: false, msg: 'réponse inattendue de Club Log : ' + short(r.text, 120) };
  }
  if (r.status === 401 || r.status === 403) return { ok: false, msg: 'jeton refusé par Club Log (' + r.status + ')' + (clublogTokErr(r) ? ' — « ' + clublogTokErr(r) + ' »' : '') };
  if (r.status === 429) return { ok: false, msg: 'Club Log : trop de requêtes (429), réessayez plus tard' };
  return { ok: false, msg: (r.status ? 'HTTP ' + r.status + ' ' : '') + clublogTokErr(r) };
}
async function clublogOne(q, c, ua, urls) {
  if (clublogTok(c)) return clublogTokOne(q, clublogTok(c), ua, urls);
  if (!c.email || !c.password || !c.api) return { ok: false, msg: 'Club Log non configuré (jeton Club Log, ou e-mail + mot de passe + clé API)' };
  const body = form({ email: c.email, password: c.password, callsign: q.station_callsign, api: c.api, adif: LB.adifRecord(q) });
  const r = await request(urls.clublogRealtime, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': ua } }, body);
  if (r.status === 200) return { ok: true, msg: short(r.text, 80) || 'QSO OK' };
  if (r.status === 403) return { ok: false, stop: true, fw: clublogFw(r.text), msg: clublog403(r.text, q.station_callsign) };
  return { ok: false, msg: (r.status ? 'HTTP ' + r.status + ' ' : '') + short(r.text, 150) };
}
/** Page « authentication failure checker » de Club Log, demandée par ce serveur : ses refus récents (adresse IP du serveur) */
async function clublogCheck(ua, urls) {
  const r = await request(urls.clublogCheck, { headers: { 'User-Agent': ua }, timeout: 20000 });
  if (r.status === 403) return { ok: false, msg: 'Club Log bloque en ce moment l’adresse IP de ce serveur (pare-feu) : attendez environ une heure sans aucun essai' };
  if (r.status !== 200) return { ok: false, msg: 'page de vérification de Club Log injoignable' + (r.status ? ' (HTTP ' + r.status + ')' : ' : ' + short(r.text, 80)) };
  const ent = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', nbsp: ' ', copy: '©', rsquo: '’', lsquo: '‘' };
  const t = short(r.text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' '), 20000).replace(/&(#\d+|[a-z]+);/gi, (m0, k) => (k[0] === '#' ? String.fromCharCode(Number(k.slice(1))) : ent[k.toLowerCase()] || m0));
  const i = t.search(/Entries Filtered by IP/i);
  const j = t.search(/©|&copy;|Copyright|Michael Wells/i);
  const body = (i >= 0 ? t.slice(i, j > i ? j : i + 900) : t.slice(0, 600)).trim().slice(0, 900);
  return { ok: /No recent problems/i.test(body), msg: 'Club Log, vérification de l’adresse de ce serveur : ' + body };
}
async function clublogBatch(list, c, ua, urls, clear) {
  const results = [];
  if (!c.email || !c.password || !c.api) return { ok: false, msg: 'Club Log non configuré (jeton Club Log, ou e-mail + mot de passe + clé API)' };
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
      : { ok: false, stop: r.status === 403, fw: r.status === 403 && clublogFw(r.text), msg: r.status === 403 ? clublog403(r.text, call) : (r.status ? 'HTTP ' + r.status + ' ' : '') + short(r.text, 150) };
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
  // QTH Nickname inconnu de ce compte eQSL : même erreur pour chaque QSO → arrêt et explication
  if (err && /No match on APP_EQSL_QTH_NICKNAME/i.test(err[1])) return { ok: false, stop: true, msg: 'QTH Nickname « ' + c.nickname + ' » inconnu du compte eQSL ' + c.user + ' : mettez le surnom exact d’un QTH de ce compte (eQSL.cc → My Profile → QTH Nicknames), ou laissez le champ vide si le compte n’a qu’un QTH, puis « Enregistrer pour cet indicatif ».' };
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
      resolve(tqslResult(code, String(stderr || stdout).split(/\r?\n/).filter(Boolean).slice(-2).join(' '), code === -1 && err ? err.message : ''));
    });
  });
}
// Code de sortie de TQSL (mode lot) → { ok, msg } ; aussi pour l'Agent LoTW (TQSL du PC du membre)
const tslMismatch = (t) => { const m = /\b(MY_[A-Z_]+|STATION_CALLSIGN|OPERATOR)\s*:\s*([^\s]+)/.exec(String(t || '')); return m ? m[1] + ' ' + m[2] : ''; };
function tqslResult(code, out, errMsg) {
  const tail = short(String(out || ''), 200);
  const TXT = { 0: 'signé et envoyé', 8: 'déjà envoyé (doublons ou hors des dates du certificat)', 9: 'envoyé (quelques doublons ignorés)',
    1: 'annulé', 2: 'refusé par LoTW', 3: 'réponse inattendue du serveur LoTW', 4: 'erreur TQSL', 5: 'erreur TQSLlib',
    6: 'fichier illisible', 7: 'écriture impossible', 10: 'paramètres refusés par TQSL', 11: 'LoTW injoignable (réseau)' };
  if (code === -1) return { ok: false, msg: 'TQSL introuvable ou bloqué : ' + short(errMsg || tail, 120) };
  // Code 8 avec un champ MY_… dans la réponse : TQSL a écarté les QSO (mode « compliant ») parce que leur lieu
  // (MY_GRIDSQUARE, zones…) ne correspond pas au lieu de station choisi : rien n'est parti, ils restent « à envoyer »
  const mis = code === 8 && tslMismatch(tail);
  if (mis) return { ok: false, mismatch: true, msg: 'TQSL 8 : QSO écartés par TQSL, rien n’est parti vers LoTW — le lieu de station TQSL ne correspond pas au lieu des QSO (' + mis + '). Vérifiez dans TQSL le lieu de station de cet indicatif (locator, zones CQ / ITU) et son nom exact dans « Lieu de station TQSL » (cadre jaune), puis relancez : depuis la 0.42.94, le locator envoyé est celui du lieu de station TQSL.' };
  return { ok: code === 0 || code === 8 || code === 9, msg: 'TQSL ' + code + ' : ' + (TXT[code] || 'erreur') + (tail && code !== 0 ? ' — ' + tail : '') };
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
async function lotwConfirm(book, c, since, ua, urls, owner, prog) {
  if (!c.login || !c.webPassword) return { ok: false, msg: 'identifiant / mot de passe du site LoTW non renseignés (confirmations non lues)' };
  owner = String(owner || '').toUpperCase();
  const p = { login: c.login, password: c.webPassword, qso_query: '1', qso_qsl: 'yes', qso_qslsince: since || '1900-01-01' };
  if (owner) p.qso_owncall = owner; // seulement les QSO de cet indicatif
  // LoTW prépare parfois longtemps son rapport (premier rapport depuis 1900 : plusieurs minutes) : 5 min sans aucune donnée au plus
  const r = await request(urls.lotwReport + '?' + form(p), { headers: { 'User-Agent': ua }, timeout: 300000, onData: prog });
  if (r.status === 0 && /arrêté/.test(r.text)) return { ok: false, msg: 'lecture des confirmations arrêtée à la demande' };
  if (r.status === 0) return { ok: false, msg: 'LoTW ne répond pas (' + short(r.text, 60) + ') : réessayez plus tard (lotw.arrl.org est parfois très lent)' };
  // 502 / 503 / 504 : LoTW surchargé ou en maintenance (fréquent) ; la lecture automatique réessaie toutes les heures
  if (r.status >= 502 && r.status <= 504) return { ok: false, msg: 'LoTW indisponible pour le moment (HTTP ' + r.status + ' : site surchargé ou en maintenance). Rien n’est perdu : réessayez plus tard avec CONFIRMATIONS ; la lecture automatique réessaie toutes les heures.' };
  if (r.status !== 200 || !/<eoh>/i.test(r.text)) return { ok: false, msg: /password|incorrect/i.test(r.text) ? 'identifiant ou mot de passe LoTW refusé' : 'réponse LoTW inattendue (HTTP ' + r.status + ')' };
  const recs = parseAdif(r.text);
  const t = (d, h) => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +h.slice(0, 2), +h.slice(2, 4));
  // Index « INDICATIF|bande » : un carnet de 200 000 QSO et des milliers de confirmations restent instantanés
  const idx = new Map();
  for (const y of book.qsos) { const k = y.call + '|' + y.band; const a = idx.get(k); if (a) a.push(y); else idx.set(k, [y]); }
  let n = 0;
  for (const x of recs) {
    if (!x.call || !x.qso_date || !x.time_on) continue;
    const call = x.call.toUpperCase();
    const band = (x.band || '').toLowerCase();
    // Confirmation d'un indicatif : jamais reportée sur un QSO fait sous un autre (club / membre)
    const own = String(x.station_callsign || x.app_lotw_owncall || owner || '').toUpperCase();
    const q = (idx.get(call + '|' + band) || []).find((y) => y.call === call && y.band === band && MODE_GROUP(y.mode) === MODE_GROUP((x.mode || '').toUpperCase()) &&
      (!own || String(y.station_callsign || '').toUpperCase() === own) &&
      Math.abs(t(y.qso_date, y.time_on) - t(x.qso_date, x.time_on)) <= 30 * 60000);
    if (q && q.lotw_qsl_rcvd !== 'Y') { q.lotw_qsl_rcvd = 'Y'; q.lotw_qslrdate = (x.qslrdate || '').replace(/\D/g, ''); if (book.touch) book.touch(q); n++; }
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
    this.stopped = {};   // « service|INDICATIF » bloqué après une erreur d'accès (jusqu'à la prochaine modification des réglages)
    this.jobBy = {};     // service → indicatif du membre qui a lancé l'envoi en cours
    this.urls = Object.assign({}, DEFAULT_URLS, o.urls || {});
    // Avant 0.42.90 : QSO écartés par TQSL (lieu de station différent, code 8 + MY_…) notés « envoyés » à tort → de nouveau « à envoyer »
    try {
      let n = 0;
      for (const q of (o.book && o.book.qsos) || []) {
        const u = q.up && q.up.lotw;
        if (u && u.ok && /^TQSL 8 /.test(u.msg || '') && tslMismatch(u.msg)) { u.ok = false; u.msg = 'TQSL 8 : écarté par TQSL (lieu de station différent), à renvoyer — ' + tslMismatch(u.msg); if (o.book.touch) o.book.touch(q); n++; }
      }
      if (n) { (o.book.flush ? o.book.flush() : o.book.save()); if (o.log) o.log('LoTW : ' + n + ' QSO écartés par TQSL (lieu de station) remis « à envoyer »'); }
    } catch (e) { /* carnet indisponible : rien à corriger */ }
    // Blocage du pare-feu de Club Log : gardé même si le serveur redémarre (mise à jour), sinon un essai le prolongeait
    this.clublogFw = Number(((o.getCfg && o.getCfg().clublog) || {}).fwUntil) || 0;
  }
  setClublogFw(t) { this.clublogFw = t; if (this.o.setClublogFw) this.o.setClublogFw(t); }
  ua() { return 'RemoteStation/' + (this.o.version || '0') + ' (' + (this.o.station || 'ON5VL') + ')'; }
  // Identifiants enregistrés de nouveau : envois permis à nouveau (refus d'accès et attente du pare-feu oubliés)
  resetStops() { this.stopped = {}; if (this.clublogFw) this.setClublogFw(0); }
  // Un refus d'accès ne bloque que l'indicatif concerné (un mauvais mot de passe d'un membre n'arrête pas le club)
  stopKey(s, call) { return s + '|' + String(call || '').toUpperCase(); }
  isStopped(s, call) {
    if (call) return !!this.stopped[this.stopKey(s, call)];
    return Object.keys(this.stopped).some((k) => k.indexOf(s + '|') === 0 && this.stopped[k]);
  }
  stop(s) { if (this.busy[s] || (s === 'lotw' && this.confBusy)) this.cancel[s] = true; }
  // Suivi de la lecture des confirmations : « LoTW répond », puis les Mo reçus (toutes les 10 s), et ARRÊT
  confProg(emit) {
    const t0 = Date.now();
    let last = 0, started = false;
    return (bytes) => {
      if (this.cancel.lotw) return true;
      const now = Date.now();
      if (!started) { started = true; last = now; emit('LoTW répond après ' + Math.round((now - t0) / 1000) + ' s : réception des confirmations…'); return false; }
      if (now - last >= 10000) { last = now; emit('… ' + (bytes / 1048576).toFixed(1).replace('.', ',') + ' Mo reçus (' + Math.round((now - t0) / 60000) + ' min)'); }
      return false;
    };
  }
  /** Lecture seule des confirmations LoTW (bouton « Confirmations ») */
  async confirmLotw(by, call, auto) {
    const c = this.cred('lotw', call || '');
    const job = { id: Date.now().toString(36), service: 'lotw', name: 'LoTW', total: 0, done: 0, ok: 0, fail: 0, by: by || '', auto: !!auto };
    this.o.onJob(job, { line: 'Lecture des confirmations LoTW' + (call ? ' de ' + call : '') + ' depuis le ' + (c.lastConfirm || 'début') + '…', step: { id: 'fetch', state: 'run' } });
    // Une seule lecture à la fois par indicatif (la lecture automatique horaire attend qu'une lecture en cours finisse)
    this.confCalls = this.confCalls || new Set();
    const ck = String(call || '').toUpperCase();
    if (this.confCalls.has(ck)) {
      if (!auto) this.o.onJob(job, { line: 'Une lecture des confirmations de ' + (call || 'cet indicatif') + ' est déjà en cours : attendez sa fin.', fin: true, step: { id: 'fetch', state: 'run' } });
      return { ok: false, msg: 'lecture déjà en cours' };
    }
    this.confCalls.add(ck);
    this.confBusy = true; this.cancel.lotw = false;
    if (!c.lastConfirm) this.o.onJob(job, { line: 'Première lecture (depuis le début) : LoTW peut mettre plusieurs minutes à préparer le rapport. ARRÊT l’interrompt.' });
    const r = await lotwConfirm(this.o.book, c, c.lastConfirm || '1900-01-01', this.ua(), this.urls, call, auto ? null : this.confProg((l) => this.o.onJob(job, { line: l })));
    this.confBusy = false; this.cancel.lotw = false; this.confCalls.delete(ck);
    if (r.ok) { (this.o.book.flush ? this.o.book.flush() : this.o.book.save()); if (this.o.setLastConfirm) this.o.setLastConfirm(new Date(Date.now() - 86400000).toISOString().slice(0, 10), call); }
    this.o.onJob(job, { line: (r.ok ? '✓ ' : '✗ ') + r.msg, step: { id: 'fetch', state: r.ok ? 'ok' : 'fail' } });
    this.o.onJob(job, { line: '', step: { id: 'import', state: r.ok ? 'ok' : 'fail' } });
    this.o.onJob(job, { line: 'Terminé.', fin: true, step: { id: 'status', state: r.ok ? 'ok' : 'fail' } });
    return r;
  }
  mark(q, s, r) {
    q.up = q.up || {};
    q.up[s] = { t: Date.now(), ok: !!r.ok, msg: String(r.msg || '').slice(0, 200) };
    if (r.qsoid) q.up[s].id = String(r.qsoid).slice(0, 40); // Club Log (nouvelle API) : identifiant du QSO chez Club Log
    if (this.o.book.touch) this.o.book.touch(q); // base SQLite : ce QSO sera réécrit au prochain save()
  }
  /** QSO à envoyer : jamais envoyés ou en échec (filtres facultatifs) */
  pending(s, f) {
    f = f || {};
    return this.o.book.query({ from: f.from, to: f.to }).filter((q) => (!f.callsign || q.station_callsign === f.callsign) && (f.all || !(q.up && q.up[s] && q.up[s].ok)));
  }
  /** Envoi automatique d'un QSO qui vient d'être enregistré */
  auto(q, opts) {
    opts = opts || {};
    const cfg = this.o.getCfg();
    if (opts.udp !== false) { try { sendUdp(q, cfg.udp, this.o.log); } catch (e) { this.o.log('UDP : ' + e.message); } }
    for (const s of SERVICES) {
      const on = this.o.getAuto ? this.o.getAuto(s, q.station_callsign) : !!(cfg[s] && cfg[s].auto);
      if (on && !this.isStopped(s, q.station_callsign)) this.run(s, [q], { auto: true, by: opts.by || '' });
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
    if (!list.length) { emit('Aucun QSO à envoyer.', true); return job; }
    // Un envoi à la fois par service (les automatiques attendent leur tour)
    while (this.busy[s]) await new Promise((r) => setTimeout(r, 500));
    this.busy[s] = true;
    this.jobBy[s] = opts.auto ? '' : (opts.by || '');
    const d = opts.delay != null && opts.delay !== '' && Number.isFinite(Number(opts.delay)) ? Number(opts.delay) : c0.delay != null ? c0.delay : 5;
    const delay = Math.max(0, Math.min(120, Number(d))) * 1000;
    // Pare-feu de Club Log : adresse IP bloquée ; chaque nouvel essai prolonge le blocage, donc aucun envoi pendant une heure
    if (s === 'clublog' && this.clublogFw > Date.now()) {
      const h = new Date(this.clublogFw);
      emit('ℹ Club Log bloque encore l’adresse IP de ce serveur : aucun essai avant ' + h.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }) + ' (chaque essai prolongerait le blocage). Corrigez d’ici là les identifiants (e-mail du compte, mot de passe d’application, clé API). Les ' + list.length + ' QSO restent à envoyer.', true);
      this.busy[s] = false; this.jobBy[s] = '';
      return job;
    }
    emit(NAMES[s] + ' : ' + list.length + ' QSO à envoyer');
    // Un groupe par indicatif (TX call) : chacun avec ses propres identifiants
    const groups = new Map();
    for (const q of list) { const k = q.station_callsign || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(q); }
    for (const [call, glist] of groups) {
    if (this.cancel[s]) break;
    const c = this.cred(s, call);
    list = glist;
    if (groups.size > 1) emit('— ' + (call || '(sans indicatif)') + ' : ' + glist.length + ' QSO');
    if (this.isStopped(s, call)) {
      job.done += glist.length; job.fail += glist.length;
      emit('✗ ' + NAMES[s] + ' ' + (call || '') + ' : envois arrêtés après un refus d\'accès — vérifiez les identifiants de cet indicatif puis enregistrez-les.');
      continue;
    }
    // LoTW : Agent LoTW connecté (TQSL du PC du membre), sinon TQSL de ce serveur
    const agent = s === 'lotw' && this.o.lotwAgent ? this.o.lotwAgent(call) : null;
    // Serveur sans TQSL (VPS) et pas d'agent : le certificat reste sur le PC de l'opérateur ; rien n'est marqué en échec
    if (s === 'lotw' && !agent && (!c.tqsl || !fs.existsSync(c.tqsl))) {
      job.done += glist.length;
      if (opts.auto) emit('ℹ ' + (call || '?') + ' : en attente de l’Agent LoTW (PC avec TQSL éteint ou pas encore appairé) — envoi dès sa connexion.');
      else emit('ℹ Pas d’Agent LoTW connecté pour ' + (call || '?') + ' et ce serveur n’a pas TQSL (le certificat reste sur votre PC). Installez l’Agent LoTW sur le PC où TQSL est installé (onglet Détails → « Agent LoTW »), ou : « EXPORTER POUR TQSL (.ADI) », signez le fichier avec TQSL, puis « MARQUER COMME ENVOYÉS ».', false, { id: 'export', state: 'info' });
      continue;
    }
    if (s === 'lotw' && !agent && !c.location) {
      for (const q of glist) { this.mark(q, s, { ok: false, msg: 'LoTW non configuré pour ' + call }); job.done++; job.fail++; }
      emit('✗ LoTW non configuré pour ' + call + ' : Synchronisation → LoTW → identifiants de l’indicatif (lieu de station TQSL), programme TQSL dans ⚙ Configuration. Serveur sans TQSL : « Exporter pour TQSL ».', false, { id: 'export', state: 'fail' });
      continue;
    }
    try {
      // Jeton Club Log (nouvelle API) : lots de 100 QSO, ou fichier ADIF complet pour remplacer le log
      const tok = s === 'clublog' && clublogTok(c);
      if (s === 'lotw' || (s === 'clublog' && (list.length > 1 || opts.clear))) {
        if (s === 'lotw') step('export', 'ok', 'Export de ' + list.length + ' QSO en ADIF');
        const r = s === 'lotw' ? await this.lotwSend(list, c, agent, step, s)
          : tok ? (opts.clear ? await clublogTokReplace(list, call, tok, this.ua(), this.urls) : await clublogTokBatch(list, tok, this.ua(), this.urls))
            : await clublogBatch(list, c, this.ua(), this.urls, opts.clear);
        const pairs = Array.isArray(r) ? r : list.map((q) => [q, r]);
        const allOk = pairs.length > 0 && pairs.every((p) => p[1].ok);
        if (s === 'lotw') { step('sign', allOk ? 'ok' : 'fail'); step('upload', allOk ? 'ok' : 'fail'); }
        for (const [q, res] of pairs) {
          if (!res.nomark) this.mark(q, s, res); // agent injoignable, lieu de station à choisir : le QSO reste « à envoyer »
          job.done++;
          if (res.ok) job.ok++; else job.fail++;
          if (res.stop) this.stopped[this.stopKey(s, call)] = true;
          if (res.fw) this.setClublogFw(Date.now() + 65 * 60000);
        }
        // Jeton Club Log : un résultat par QSO ; les QSO refusés sont nommés, les acceptés résumés
        const lab = (q) => q.call + ' ' + q.qso_date.slice(6, 8) + '/' + q.qso_date.slice(4, 6) + ' ' + q.time_on.slice(0, 2) + ':' + q.time_on.slice(2, 4) + ' ' + q.band + ' ' + LB.modeName(q);
        const msgs = tok && !opts.clear
          ? Object.entries(pairs.filter((p) => p[1].ok).reduce((a, p) => { a[p[1].msg] = (a[p[1].msg] || 0) + 1; return a; }, {})).map(([m, n]) => '✓ ' + n + ' QSO : ' + m)
            .concat(pairs.filter((p) => !p[1].ok && !p[1].stop).map((p) => '✗ ' + lab(p[0]) + ' — ' + p[1].msg), Array.from(new Set(pairs.filter((p) => p[1].stop).map((p) => '✗ ' + p[1].msg))))
          : Array.from(new Set(pairs.map((p) => (p[1].ok ? '✓ ' : '✗ ') + p[1].msg)));
        for (const m of msgs) emit(m);
        if (s === 'lotw' && !opts.auto && c.login) {
          step('fetch', 'run', 'Lecture des confirmations LoTW…');
          const since = c.lastConfirm || '1900-01-01';
          if (since === '1900-01-01') emit('Première lecture (depuis le début) : LoTW peut mettre plusieurs minutes à préparer le rapport. ARRÊT l’interrompt.');
          this.confCalls = this.confCalls || new Set();
          const ck = String(call || '').toUpperCase();
          const cr = this.confCalls.has(ck) ? { ok: false, msg: 'une lecture des confirmations de ' + call + ' est déjà en cours (elle continue) ' }
            : await (async () => { this.confCalls.add(ck); try { return await lotwConfirm(this.o.book, c, since, this.ua(), this.urls, call, this.confProg(emit)); } finally { this.confCalls.delete(ck); } })();
          step('fetch', cr.ok ? 'ok' : 'fail', (cr.ok ? '✓ ' : '✗ ') + cr.msg);
          step('import', cr.ok ? 'ok' : 'fail');
          if (cr.ok && this.o.setLastConfirm) this.o.setLastConfirm(new Date(Date.now() - 86400000).toISOString().slice(0, 10), call);
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
          if (res.fw) this.setClublogFw(Date.now() + 65 * 60000);
          if (res.stop) { this.stopped[this.stopKey(s, call)] = true; emit('Envois arrêtés pour ' + (call || '?') + ' : ' + res.msg); break; }
          if (this.cancel[s]) { emit('Arrêté à la demande.'); break; }
          if (q !== list[list.length - 1] && delay) await new Promise((r) => setTimeout(r, delay));
        }
      }
    } catch (e) {
      emit('✗ ' + e.message);
    }
    }
    this.busy[s] = false;
    this.jobBy[s] = '';
    this.cancel[s] = false;
    (this.o.book.flush ? this.o.book.flush() : this.o.book.save());
    emit('Terminé : ' + job.ok + ' envoyé(s), ' + job.fail + ' en échec.', true, s === 'lotw' ? { id: 'status', state: job.fail ? 'fail' : 'ok' } : undefined);
    return job;
  }
  /** Signature et envoi LoTW : par l'Agent LoTW (lots de 100 QSO) ou par TQSL de ce serveur */
  async lotwSend(list, c, agent, step) {
    if (!agent) {
      step('sign', 'run', 'Signature par TQSL (lieu de station « ' + (c.location || '?') + ' ») et envoi vers LoTW…');
      step('upload', 'run');
      return lotwBatch(list, c);
    }
    const loc = agent.location(c.location);
    if (loc.err) return { ok: false, msg: 'Agent LoTW : ' + loc.err, nomark: true };
    step('sign', 'run', 'Signature par l’Agent LoTW (PC « ' + agent.name + ' », lieu de station « ' + loc.name + ' ») et envoi vers LoTW…');
    step('upload', 'run');
    const pairs = [];
    // Locator envoyé à LoTW = celui du lieu de station TQSL (celui déjà connu de LoTW pour cet indicatif), quel que
    // soit celui noté dans le QSO ; le carnet est mis à jour une fois le QSO accepté
    const grid = String(loc.grid || '').toUpperCase();
    for (let i = 0; i < list.length; i += 100) {
      const part = list.slice(i, i + 100);
      let res;
      try {
        const sent = grid ? part.map((q) => Object.assign({}, q, { my_gridsquare: grid })) : part;
        const a = await agent.sign(loc.name, LB.toAdif(sent, 'RemoteStation'), part.length);
        res = tqslResult(a.code, a.out, a.err);
        if (res.ok && grid) for (const q of part) if (q.my_gridsquare !== grid) { q.my_gridsquare = grid; if (this.o.book.touch) this.o.book.touch(q); }
        res.msg += ' (Agent LoTW « ' + agent.name + ' »)';
      } catch (e) {
        res = { ok: false, msg: 'Agent LoTW : ' + e.message, nomark: true };
      }
      for (const q of part) pairs.push([q, res]);
      if (res.nomark) { for (const q of list.slice(i + 100)) pairs.push([q, res]); break; }
    }
    return pairs;
  }
  async test(s) {
    const c = (this.o.getCfg()[s]) || {};
    if (s === 'qrz') return qrzTest(c, this.ua(), this.urls);
    if (s === 'lotw') {
      if (c.tqsl && fs.existsSync(c.tqsl)) return lotwTest(c);
      // Serveur sans TQSL (VPS) : c'est l'Agent LoTW qui signe
      const call = String(this.o.station || '').toUpperCase();
      const ag = this.o.lotwAgent ? this.o.lotwAgent(call) : null;
      if (!ag) return { ok: false, msg: 'pas de TQSL sur ce serveur et aucun Agent LoTW connecté pour ' + call + ' : installez l’Agent LoTW sur le PC où TQSL et le certificat du club sont installés (ou exportez à la main)' };
      const loc = ag.location(c.location);
      return loc.err ? { ok: false, msg: 'Agent LoTW « ' + ag.name + ' » connecté, mais ' + loc.err } : { ok: true, msg: 'Agent LoTW « ' + ag.name + ' » connecté : ' + call + ' signé avec le lieu de station « ' + loc.name + ' »' };
    }
    if (s === 'eqsl') return c.user && c.password ? { ok: true, msg: 'réglages présents (eQSL n\'a pas de test sans envoi : le premier envoi le confirmera)' } : { ok: false, msg: 'indicatif ou mot de passe manquant' };
    if (s === 'clublog') {
      // Jetons (nouvelle API) : celui de ⚙ Configuration et ceux des indicatifs du club, chacun vérifié sans rien envoyer
      const calls = [''].concat(this.o.clubCalls ? this.o.clubCalls() : []);
      const toks = new Map();
      for (const call of calls) { const t = clublogTok(call ? this.cred(s, call) : c); if (t && !toks.has(t)) toks.set(t, call || 'Configuration'); }
      if (toks.size) {
        const out = [];
        let ok = true;
        for (const [t, who] of toks) { const r = await clublogTokTest(t, this.ua(), this.urls); ok = ok && r.ok; out.push(who + ' : ' + r.msg); }
        return { ok, msg: out.join(' · ') };
      }
      const pres = c.email && c.password && c.api ? 'réglages présents (Club Log n\'a pas de test sans envoi : le premier envoi le confirmera)' : 'e-mail, mot de passe ou clé API manquant';
      const ck = await clublogCheck(this.ua(), this.urls);
      return { ok: !!(c.email && c.password && c.api) && ck.ok, msg: pres + ' · ' + ck.msg };
    }
    return { ok: false, msg: 'service inconnu' };
  }
}

module.exports = { Sync, SERVICES, NAMES, udpPacket, sendUdp, parseAdif, DEFAULT_URLS };
