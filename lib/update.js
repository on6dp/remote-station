'use strict';
/*
 * update.js — nouvelle version de Remote Station disponible ? (dépôt public github.com/on6dp/remote-station)
 *
 * Toutes les 30 minutes, le serveur lit package.json sur la branche main du dépôt et vérifie que le paquet
 * releases/<version>/remote-station-<version>.tar.gz existe ; plus récent que la version en service : les
 * administrateurs voient « 🔔 Mise à jour <version> » au dashboard, avec les nouveautés (CHANGELOG.md).
 *
 * Installation depuis le dashboard (administrateurs) : le serveur écrit seulement le numéro de version dans
 * update/request ; un service systemd de root (deploy/remote-station-update.*, mis en place par install.sh) le voit,
 * télécharge le paquet officiel de GitHub, vérifie son empreinte SHA-256, l'extrait dans /opt et lance install.sh.
 * Le serveur n'a lui-même aucun droit d'administrateur du VPS. Journal : /var/log/remote-station-update.log.
 */
const fs = require('fs');
const path = require('path');

const RAW = 'https://raw.githubusercontent.com/on6dp/remote-station/main/';
const LOG = '/var/log/remote-station-update.log';
const EVERY = 30 * 60 * 1000;

function cmp(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function get(url, head) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url + (head ? '' : '?t=' + Date.now()), { method: head ? 'HEAD' : 'GET', signal: ctl.signal, headers: { 'User-Agent': 'remote-station' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return head ? '' : await r.text();
  } finally { clearTimeout(t); }
}

class Updater {
  /** opt : { root, version, enabled (bool), onChange(state) } */
  constructor(opt) {
    this.root = opt.root;
    this.version = opt.version;
    this.enabled = opt.enabled !== false;
    this.onChange = opt.onChange || (() => {});
    this.dir = path.join(this.root, 'update');
    this.latest = null;
    this.notes = [];
    this.checked = 0;
    this.err = '';
    this.job = null; // { v, at, by, state: 'wait' | 'run' | 'fail', msg }
    if (this.enabled) {
      setTimeout(() => this.check(), 60 * 1000);
      this.timer = setInterval(() => this.check(), EVERY);
    }
  }
  /** Programme de mise à jour installé (install.sh l'a mis en place pour ce dossier) */
  canInstall() { return fs.existsSync(path.join(this.dir, 'enabled')); }
  async check() {
    try {
      const pkg = JSON.parse(await get(RAW + 'package.json'));
      const v = String(pkg.version || '');
      if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error('version illisible');
      if (cmp(v, this.version) > 0) {
        await get(RAW + 'releases/' + v + '/remote-station-' + v + '.tar.gz', true); // paquet bien publié
        let notes = [];
        try {
          const cl = await get(RAW + 'CHANGELOG.md');
          const re = /^- \*\*(\d+\.\d+\.\d+)\*\* — (.+)$/gm;
          let m;
          while ((m = re.exec(cl)) && notes.length < 30) if (cmp(m[1], this.version) > 0 && cmp(m[1], v) <= 0) notes.push({ v: m[1], t: m[2].slice(0, 400) });
        } catch (e) { /* nouveautés seulement */ }
        const changed = this.latest !== v;
        this.latest = v;
        this.notes = notes;
        if (changed) console.log('Mise à jour disponible : ' + v + ' (en service : ' + this.version + ')');
        if (changed) this.onChange(this.state());
      } else if (this.latest) { this.latest = null; this.notes = []; this.onChange(this.state()); }
      this.err = '';
    } catch (e) { this.err = e.message; }
    this.checked = Date.now();
  }
  state() {
    return { t: 'upd', cur: this.version, latest: this.latest, notes: this.notes, can: this.canInstall(), job: this.job ? { v: this.job.v, state: this.job.state, msg: this.job.msg || '', by: this.job.by } : null };
  }
  /** Demande d'installation (administrateur) : retourne un message d'erreur, ou '' */
  install(v, by) {
    if (!this.latest || v !== this.latest) return 'Aucune nouvelle version à installer.';
    if (!this.canInstall()) return 'Programme de mise à jour pas encore installé sur le VPS : faites cette mise à jour une fois à la main (tar + install.sh).';
    if (this.job && (this.job.state === 'wait' || this.job.state === 'run')) return 'Mise à jour déjà en cours.';
    try {
      const f = path.join(this.dir, 'request');
      try { fs.unlinkSync(f); } catch (e) { /* pas de demande */ }
      fs.writeFileSync(f, v + '\n', { mode: 0o644, flag: 'wx' });
    } catch (e) { return 'Demande impossible : ' + e.message; }
    this.job = { v, at: Date.now(), by, state: 'wait', msg: 'Demande envoyée au VPS…' };
    this.onChange(this.state());
    this.follow();
    return '';
  }
  /** Suit l'installation dans le journal de root (le service redémarre à la fin : ce serveur s'arrête alors) */
  follow() {
    clearInterval(this.fw);
    let n = 0;
    this.fw = setInterval(() => {
      const j = this.job;
      if (!j || j.state === 'fail') return clearInterval(this.fw);
      n++;
      const pending = fs.existsSync(path.join(this.dir, 'request'));
      let last = '';
      try {
        const txt = fs.readFileSync(LOG, 'utf8');
        const i = txt.lastIndexOf('=== ' + j.v + ' ');
        if (i >= 0 && fs.statSync(LOG).mtimeMs >= j.at - 2000) last = txt.slice(i).trim().split('\n').pop();
      } catch (e) { /* journal pas encore là */ }
      let st = j.state, msg = j.msg;
      if (/^ECHEC/.test(last)) { st = 'fail'; msg = last.replace(/^ECHEC\s*:?\s*/, ''); }
      else if (last) { st = 'run'; msg = last; }
      else if (pending && n > 12) { st = 'fail'; msg = 'Le programme de mise à jour du VPS ne répond pas (service remote-station-update.path) : faites la mise à jour à la main.'; try { fs.unlinkSync(path.join(this.dir, 'request')); } catch (e) { /* déjà pris */ } }
      else if (!pending) { st = 'run'; msg = 'Téléchargement et installation…'; }
      if (n > 180 && st !== 'fail') { st = 'fail'; msg = 'Installation trop longue : voir sudo tail /var/log/remote-station-update.log'; }
      if (st !== j.state || msg !== j.msg) { j.state = st; j.msg = msg; this.onChange(this.state()); }
      if (st === 'fail') clearInterval(this.fw);
    }, 5000);
  }
}

module.exports = { Updater, cmp };
