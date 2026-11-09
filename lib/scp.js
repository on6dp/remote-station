'use strict';
/*
 * scp.js — « Super Check Partial » (comme N1MM / Win-Test) : liste des indicatifs actifs en contest (MASTER.SCP,
 * supercheckpartial.com). Le serveur la télécharge (au démarrage si elle manque, puis toutes les semaines), la garde
 * dans refdata/MASTER.SCP et y cherche un morceau d'indicatif pour la page TRX SSB (indicatifs probables).
 */
const fs = require('fs');
const path = require('path');
const { fetchUrl } = require('./refdata');

const URL_SCP = 'https://www.supercheckpartial.com/MASTER.SCP';
const DAYS = 7;

class Scp {
  constructor(dir, log) {
    this.file = path.join(dir, 'MASTER.SCP');
    this.log = log || (() => {});
    this.calls = [];
    this.at = 0;
    this.busy = false;
  }
  load() {
    try {
      const st = fs.statSync(this.file);
      const txt = fs.readFileSync(this.file, 'latin1');
      this.calls = txt.split(/\r?\n/).map((l) => l.trim().toUpperCase()).filter((l) => l && l[0] !== '#' && /^[A-Z0-9/]{3,15}$/.test(l));
      this.at = st.mtimeMs;
    } catch (e) { this.calls = []; this.at = 0; }
  }
  async update() {
    if (this.busy) return;
    this.busy = true;
    try {
      const buf = await fetchUrl(URL_SCP);
      const txt = buf.toString('latin1');
      const n = txt.split(/\r?\n/).filter((l) => /^[A-Z0-9/]{3,15}\s*$/i.test(l)).length;
      if (n < 1000) throw new Error('liste trop courte (' + n + ')');
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', buf);
      fs.renameSync(this.file + '.tmp', this.file);
      this.load();
      this.log('SCP : ' + this.calls.length + ' indicatifs (MASTER.SCP)');
    } catch (e) {
      this.log('SCP : téléchargement impossible (' + e.message + ')');
    } finally { this.busy = false; }
  }
  start() {
    this.load();
    const tick = () => { if (!this.at || Date.now() - this.at > DAYS * 86400000) this.update(); };
    setTimeout(tick, 20000);
    setInterval(tick, 6 * 3600000).unref();
  }
  /** Indicatifs contenant ce morceau (début d'abord), au plus n */
  search(q, n) {
    q = String(q || '').toUpperCase().replace(/[^A-Z0-9/]/g, '');
    if (q.length < 2 || !this.calls.length) return [];
    const max = Math.max(1, Math.min(60, n || 30));
    const a = [], b = [];
    for (const c of this.calls) {
      const i = c.indexOf(q);
      if (i < 0) continue;
      (i === 0 ? a : b).push(c);
      if (a.length >= max) break;
    }
    return a.concat(b).slice(0, max);
  }
}
module.exports = { Scp };
