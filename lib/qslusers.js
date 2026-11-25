'use strict';
/*
 * qslusers.js — qui utilise LoTW et eQSL : listes publiques, pour la croix rouge du carnet (pas de confirmation à attendre).
 *   LoTW : https://lotw.arrl.org/lotw-user-activity.csv (ARRL ; « INDICATIF,AAAA-MM-JJ,HH:MM:SS » = dernier envoi à LoTW,
 *          mise à jour hebdomadaire). Utilisateur actif : un envoi dans les 365 derniers jours.
 *   eQSL : https://www.eqsl.cc/qslcard/DownloadedFiles/AGMemberList.txt (membres « Authenticity Guaranteed », un indicatif
 *          par ligne). Un indicatif absent peut avoir un compte eQSL sans AG : la croix le dit dans son infobulle.
 *   Club Log : fichier public https://cdn.clublog.org/clublog-users.json.zip (zip d'un JSON { INDICATIF: { firstqso, lastqso,
 *          lastupload, locator, oqrs, last-lotw } }, refait chaque semaine) ; s'il n'est pas lisible : le même fichier par
 *          l'API REST (GET /api/v1/reference/clublog-users, jeton cl_… du club), sinon globallogcheck.php (clé API classique).
 *          Utilisateur actif : un envoi de son log dans les 365 derniers jours.
 * Gardées dans refdata/ (lotw-user-activity.csv, eqsl-ag.txt, clublog-users.json.zip), relues au démarrage, retéléchargées
 * toutes les 24 h (Club Log : tous les 3 jours, le fichier est refait chaque semaine).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { fetchUrl } = require('./refdata');

/** Premier fichier d'une archive zip (répertoire central : tailles justes même avec un « data descriptor ») */
function unzipFirst(buf) {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return buf; // pas un zip : déjà le JSON
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('zip illisible');
  const cd = buf.readUInt32LE(e + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('zip illisible');
  const meth = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), lh = buf.readUInt32LE(cd + 42);
  const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
  const data = buf.subarray(start, start + csize);
  if (meth === 0) return data;
  if (meth === 8) return zlib.inflateRawSync(data);
  throw new Error('zip : compression ' + meth + ' pas prise en charge');
}
/** GET avec jeton (API REST de Club Log) : Buffer, ou erreur « HTTP n » */
function getBearer(url, tok, n) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Authorization: 'Bearer ' + tok, 'User-Agent': 'RemoteStation-UBA-LGE', Accept: '*/*' }, timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (n || 0) < 3) {
        res.resume();
        // Redirection vers le fichier (CDN) : sans le jeton
        const to = new URL(res.headers.location, url).toString();
        return resolve(new URL(to).host === new URL(url).host ? getBearer(to, tok, (n || 0) + 1) : fetchUrl(to));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => resolve(Buffer.concat(parts)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
  });
}

const SRC = {
  lotw: { url: 'https://lotw.arrl.org/lotw-user-activity.csv', file: 'lotw-user-activity.csv', min: 50000 },
  eqsl: { url: 'https://www.eqsl.cc/qslcard/DownloadedFiles/AGMemberList.txt', file: 'eqsl-ag.txt', min: 20000 },
  clublog: { url: 'https://cdn.clublog.org/clublog-users.json.zip', file: 'clublog-users.json.zip', min: 5000, every: 3 * 86400000,
    rest: 'https://clublog.org/api/v1/reference/clublog-users', old: 'https://clublog.org/globallogcheck.php' }
};
const NAME = { lotw: 'Utilisateurs LoTW', eqsl: 'Membres eQSL AG', clublog: 'Utilisateurs Club Log' };
const ACTIVE_DAYS = 365;

/** Indicatif de base pour la recherche : sans préfixe ni suffixe portable (EA8/ON4ABC → ON4ABC, F5OYA/P → F5OYA) */
function base(call) {
  const parts = String(call || '').toUpperCase().replace(/[<>]/g, '').split('/').filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  return parts.slice().sort((a, b) => b.length - a.length)[0];
}

class QslUsers {
  constructor(dir, log, o) {
    this.dir = dir;
    this.log = log || (() => {});
    this.o = o || {};
    this.lotw = new Map(); // indicatif → date du dernier envoi (AAAAMMJJ, nombre)
    this.eqsl = new Set();
    this.clublog = new Map(); // indicatif → date du dernier envoi à Club Log (AAAAMMJJ)
    this.at = { lotw: 0, eqsl: 0, clublog: 0 };
    this.busy = {};
  }
  file(k) { return path.join(this.dir, SRC[k].file); }
  parse(k, txt) {
    if (k === 'clublog') {
      // Fichier zip (CDN, API REST) : { INDICATIF: { lastupload, lastqso… } } ; globallogcheck : [[indicatif, 1er, dernier, envoi]]
      const m = new Map();
      let a = null;
      try { a = JSON.parse(Buffer.isBuffer(txt) ? unzipFirst(txt).toString('utf8') : txt); } catch (e) { return m; }
      const day = (v) => Number(String(v || '').slice(0, 10).replace(/-/g, '')) || 0;
      if (Array.isArray(a)) {
        for (const r of a) if (Array.isArray(r) && r[0]) m.set(String(r[0]).toUpperCase(), day(r[3] || r[2]));
      } else if (a && typeof a === 'object') {
        for (const c of Object.keys(a)) { const r = a[c] || {}; m.set(c.toUpperCase(), day(r.lastupload)); }
      }
      return m;
    }
    if (k === 'lotw') {
      const m = new Map();
      for (const l of txt.split('\n')) {
        const a = l.split(',');
        if (a.length < 2) continue;
        const c = a[0].trim().toUpperCase();
        const d = Number(String(a[1]).replace(/-/g, ''));
        if (c && d > 19900000) m.set(c, d);
      }
      return m;
    }
    const s = new Set();
    for (const l of txt.split(/\r?\n/)) { const c = l.trim().toUpperCase(); if (/^[A-Z0-9/]{3,15}$/.test(c)) s.add(c); }
    return s;
  }
  load(k) {
    try {
      const st = fs.statSync(this.file(k));
      const raw = fs.readFileSync(this.file(k));
      const v = this.parse(k, k === 'clublog' ? raw : raw.toString('latin1'));
      if (v.size) { this[k] = v; this.at[k] = st.mtimeMs; }
    } catch (e) { /* pas encore téléchargée */ }
  }
  async update(k) {
    if (this.busy[k]) return;
    this.busy[k] = true;
    try {
      let buf = null, v = null;
      const tries = [() => fetchUrl(SRC[k].url)];
      if (k === 'clublog') {
        // Fichier public du CDN ; sinon l'API REST avec le jeton du club ; sinon l'ancienne API avec la clé classique
        const tok = this.o.clublogToken ? this.o.clublogToken() : '';
        const key = this.o.clublogKey ? this.o.clublogKey() : '';
        if (tok) tries.push(() => getBearer(SRC[k].rest, tok));
        if (key) {
          const d = new Date(Date.now() - 365 * 86400000);
          tries.push(() => fetchUrl(SRC[k].old + '?api=' + encodeURIComponent(key) + '&startyear=' + d.getUTCFullYear() + '&startmonth=' + (d.getUTCMonth() + 1) + '&startday=' + d.getUTCDate()));
        }
      }
      let err = null;
      for (const t of tries) {
        try {
          buf = await t();
          v = this.parse(k, k === 'clublog' ? buf : buf.toString('latin1'));
          if (v.size >= SRC[k].min) break;
          err = new Error('liste trop courte (' + v.size + ')');
        } catch (e) { err = e; }
        v = null;
      }
      if (!v) throw err || new Error('pas de liste');
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file(k) + '.tmp', buf);
      fs.renameSync(this.file(k) + '.tmp', this.file(k));
      this[k] = v;
      this.at[k] = Date.now();
      this.log(NAME[k] + ' : ' + v.size + ' indicatifs');
    } catch (e) {
      this.log(NAME[k] + ' : téléchargement impossible (' + String(e.message).replace(/api=[^&\s]+/g, 'api=…') + ')');
      if (!this.at[k]) this.at[k] = Date.now() - (SRC[k].every || 24 * 3600000) + 3600000; // nouvel essai dans 1 h
    } finally { this.busy[k] = false; }
  }
  start() {
    for (const k of Object.keys(SRC)) this.load(k);
    const tick = () => { for (const k of Object.keys(SRC)) if (Date.now() - this.at[k] > (SRC[k].every || 24 * 3600000)) this.update(k); };
    setTimeout(tick, 30000).unref();
    setInterval(tick, 3600000).unref();
  }
  /**
   * État d'un correspondant : null = liste pas encore là (on ne sait pas) ;
   * LoTW : { ok, last } (last = AAAAMMJJ du dernier envoi, 0 si absent) ; eQSL : { ok } (membre AG ou non).
   */
  lotwUser(call) {
    if (!this.lotw.size) return null;
    const c = String(call || '').toUpperCase();
    const last = this.lotw.get(c) || this.lotw.get(base(c)) || 0;
    const lim = Number(new Date(Date.now() - ACTIVE_DAYS * 86400000).toISOString().slice(0, 10).replace(/-/g, ''));
    return { ok: last >= lim, last };
  }
  clublogUser(call) {
    if (!this.clublog.size) return null;
    const c = String(call || '').toUpperCase();
    const last = this.clublog.get(c) || this.clublog.get(base(c)) || 0;
    const lim = Number(new Date(Date.now() - ACTIVE_DAYS * 86400000).toISOString().slice(0, 10).replace(/-/g, ''));
    return { ok: last >= lim, last };
  }
  eqslUser(call) {
    if (!this.eqsl.size) return null;
    const c = String(call || '').toUpperCase();
    return { ok: this.eqsl.has(c) || this.eqsl.has(base(c)) };
  }
}

module.exports = { QslUsers, base, unzipFirst };
