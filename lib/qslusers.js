'use strict';
/*
 * qslusers.js — qui utilise LoTW et eQSL : listes publiques, pour la croix rouge du carnet (pas de confirmation à attendre).
 *   LoTW : https://lotw.arrl.org/lotw-user-activity.csv (ARRL ; « INDICATIF,AAAA-MM-JJ,HH:MM:SS » = dernier envoi à LoTW,
 *          mise à jour hebdomadaire). Utilisateur actif : un envoi dans les 365 derniers jours.
 *   eQSL : https://www.eqsl.cc/qslcard/DownloadedFiles/AGMemberList.txt (membres « Authenticity Guaranteed », un indicatif
 *          par ligne). Un indicatif absent peut avoir un compte eQSL sans AG : la croix le dit dans son infobulle.
 * Gardées dans refdata/ (lotw-user-activity.csv, eqsl-ag.txt), relues au démarrage, retéléchargées toutes les 24 h.
 */
const fs = require('fs');
const path = require('path');
const { fetchUrl } = require('./refdata');

const SRC = {
  lotw: { url: 'https://lotw.arrl.org/lotw-user-activity.csv', file: 'lotw-user-activity.csv', min: 50000 },
  eqsl: { url: 'https://www.eqsl.cc/qslcard/DownloadedFiles/AGMemberList.txt', file: 'eqsl-ag.txt', min: 20000 }
};
const ACTIVE_DAYS = 365;

/** Indicatif de base pour la recherche : sans préfixe ni suffixe portable (EA8/ON4ABC → ON4ABC, F5OYA/P → F5OYA) */
function base(call) {
  const parts = String(call || '').toUpperCase().replace(/[<>]/g, '').split('/').filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  return parts.slice().sort((a, b) => b.length - a.length)[0];
}

class QslUsers {
  constructor(dir, log) {
    this.dir = dir;
    this.log = log || (() => {});
    this.lotw = new Map(); // indicatif → date du dernier envoi (AAAAMMJJ, nombre)
    this.eqsl = new Set();
    this.at = { lotw: 0, eqsl: 0 };
    this.busy = {};
  }
  file(k) { return path.join(this.dir, SRC[k].file); }
  parse(k, txt) {
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
      const v = this.parse(k, fs.readFileSync(this.file(k), 'latin1'));
      if (v.size) { this[k] = v; this.at[k] = st.mtimeMs; }
    } catch (e) { /* pas encore téléchargée */ }
  }
  async update(k) {
    if (this.busy[k]) return;
    this.busy[k] = true;
    try {
      const buf = await fetchUrl(SRC[k].url);
      const v = this.parse(k, buf.toString('latin1'));
      if (v.size < SRC[k].min) throw new Error('liste trop courte (' + v.size + ')');
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file(k) + '.tmp', buf);
      fs.renameSync(this.file(k) + '.tmp', this.file(k));
      this[k] = v;
      this.at[k] = Date.now();
      this.log((k === 'lotw' ? 'Utilisateurs LoTW' : 'Membres eQSL AG') + ' : ' + v.size + ' indicatifs');
    } catch (e) {
      this.log((k === 'lotw' ? 'Utilisateurs LoTW' : 'Membres eQSL AG') + ' : téléchargement impossible (' + e.message + ')');
      if (!this.at[k]) this.at[k] = Date.now() - 23 * 3600000; // nouvel essai dans 1 h
    } finally { this.busy[k] = false; }
  }
  start() {
    for (const k of Object.keys(SRC)) this.load(k);
    const tick = () => { for (const k of Object.keys(SRC)) if (Date.now() - this.at[k] > 24 * 3600000) this.update(k); };
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
  eqslUser(call) {
    if (!this.eqsl.size) return null;
    const c = String(call || '').toUpperCase();
    return { ok: this.eqsl.has(c) || this.eqsl.has(base(c)) };
  }
}

module.exports = { QslUsers, base };
