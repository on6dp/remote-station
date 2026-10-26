'use strict';
/*
 * cluster.js — client telnet d'un DX cluster (CC-Cluster, DXSpider, AR-Cluster…) pour la carte de bande du dashboard.
 * Se connecte, envoie l'indicatif (et les commandes de réglage, ex. « set/skimmer » pour les spots du Reverse Beacon
 * Network), lit les lignes « DX de … » et garde les spots récents en mémoire. Reconnexion automatique.
 * Le texte du cluster vient d'internet : tout est filtré (indicatifs, fréquences, commentaire court, sans contrôle).
 */
const net = require('net');

const CALL_RE = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}(\/[A-Z0-9]{1,4})?$/;
// « DX de K1TTT-#:     14080.0  W1AW         RTTY 25 dB 45 BPS CQ           1234Z »
const SPOT_RE = /^DX de ([A-Z0-9/#-]{3,15}):?\s+(\d{3,8}(?:\.\d{1,3})?)\s+([A-Z0-9/]{3,15})\s+(.*?)\s*(\d{4})Z/i;

class Cluster {
  /**
   * @param {object} o host, port, call (indicatif de connexion, ex. ON5VL-9), cmds (commandes après la connexion),
   *   keepMin (durée de vie d'un spot), onSpot(s), log(msg)
   */
  constructor(o) {
    this.o = Object.assign({ port: 8000, cmds: [], keepMin: 30, onSpot: () => {}, log: () => {} }, o);
    this.spots = new Map(); // « INDICATIF|kHz arrondi » → spot
    this.sock = null;
    this.buf = '';
    this.retry = 0;
    this.timer = null;
    this.state = 'arrêté';
    this.stopped = false;
    this.lastLine = 0;
  }
  start() {
    if (!this.o.host || !this.o.call) { this.state = 'non configuré'; return; }
    this.stopped = false;
    this._connect();
    // Spots trop vieux retirés ; liaison silencieuse depuis 10 min : on se reconnecte
    this.gc = setInterval(() => {
      const lim = Date.now() - this.o.keepMin * 60000;
      for (const [k, s] of this.spots) if (s.at < lim) this.spots.delete(k);
      if (this.sock && this.lastLine && Date.now() - this.lastLine > 600000) { this.o.log('cluster : silencieux depuis 10 min, reconnexion'); this.sock.destroy(); }
    }, 30000);
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.gc);
    if (this.sock) this.sock.destroy();
    this.sock = null;
    this.state = 'arrêté';
  }
  list() {
    return Array.from(this.spots.values()).sort((a, b) => a.f - b.f);
  }
  _connect() {
    if (this.stopped) return;
    this.state = 'connexion';
    const s = net.connect({ host: this.o.host, port: this.o.port });
    this.sock = s;
    this.buf = '';
    let loggedIn = false;
    const login = () => {
      if (loggedIn) return;
      loggedIn = true;
      s.write(this.o.call + '\r\n');
      setTimeout(() => { for (const c of this.o.cmds) if (!s.destroyed) s.write(c + '\r\n'); }, 1500);
    };
    s.setEncoding('latin1');
    s.setKeepAlive(true, 60000);
    s.on('connect', () => {
      this.state = 'connecté';
      this.retry = 0;
      this.o.log('cluster : connecté à ' + this.o.host + ':' + this.o.port + ' (' + this.o.call + ')');
      setTimeout(login, 4000); // pas d'invite reconnue : indicatif envoyé quand même
    });
    s.on('data', (d) => {
      this.lastLine = Date.now();
      this.buf += d;
      if (this.buf.length > 65536) this.buf = this.buf.slice(-8192);
      if (!loggedIn && /(login|call ?sign|your call|indicatif)\s*[:>]?\s*$/i.test(this.buf)) login();
      let i;
      while ((i = this.buf.search(/\r?\n/)) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + (this.buf[i] === '\r' ? 2 : 1));
        this._line(line);
      }
    });
    const again = (why) => {
      if (this.sock !== s) return;
      this.sock = null;
      this.state = 'déconnecté';
      if (this.stopped) return;
      const wait = Math.min(300000, 5000 * Math.pow(2, this.retry++));
      this.o.log('cluster : ' + why + ', nouvel essai dans ' + Math.round(wait / 1000) + ' s');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this._connect(), wait);
    };
    s.on('error', (e) => again(e.code || e.message));
    s.on('close', () => again('liaison fermée'));
  }
  _line(raw) {
    const line = String(raw).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
    const m = SPOT_RE.exec(line);
    if (!m) return;
    const de = m[1].toUpperCase().replace(/-#$/, '');
    const khz = Number(m[2]);
    const call = m[3].toUpperCase();
    if (!(khz >= 1800 && khz <= 450000) || !CALL_RE.test(call)) return;
    const cmt = m[4].replace(/\s+/g, ' ').slice(0, 40);
    const s = { f: Math.round(khz * 10) / 10, call, de: de.slice(0, 15), cmt, at: Date.now(), skim: /-#|#$/.test(m[1]) || /\bdB\b.*\b(WPM|BPS)\b/i.test(cmt) };
    const k = call + '|' + Math.round(khz);
    this.spots.set(k, s);
    if (this.spots.size > 2000) this.spots.delete(this.spots.keys().next().value);
    this.o.onSpot(s);
  }
}

module.exports = { Cluster, SPOT_RE };
