'use strict';
/*
 * jtty.js — réception JTTY en continu avec le décodeur de WSJT-X 3.3 (interface jtty_rx_*, GPL v3),
 * compilé en programme Linux autonome (lib/bin/jttyd, source native/wsjtx/jttyd.c). La BF lui est
 * envoyée en continu (16 bits, 12 kHz) ; il renvoie chaque mise à jour de message : le texte grandit
 * trame après trame (1,888 s), puis le message est marqué terminé. Processus séparé : un problème du
 * décodeur ne touche pas le serveur.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Linux x86-64 : bin/jttyd ; Windows x64 : bin/jttyd.exe (compilé avec MinGW-w64, voir windows/build.sh)
const WIN = process.platform === 'win32';
const BIN = path.join(__dirname, 'bin', 'jttyd' + (WIN ? '.exe' : ''));

function available() {
  try { fs.accessSync(BIN, WIN ? fs.constants.R_OK : fs.constants.X_OK); return (process.platform === 'linux' || WIN) && process.arch === 'x64'; } catch (e) { return false; }
}

class JttyDecoder {
  /** @param {(u:object)=>void} onUpdate  @param {(msg:string)=>void} onLog */
  constructor(onUpdate, onLog) {
    this.onUpdate = onUpdate;
    this.onLog = onLog || (() => {});
    this.proc = null;
    this.t0 = null;          // heure (s, époque UNIX) du premier échantillon envoyé
    this.sid = 0;            // numéro de session (les identifiants de messages repartent à 1 à chaque démarrage)
    this.buf = '';
  }
  start() {
    if (this.proc || !available()) return !!this.proc;
    this.sid = Date.now();
    this.t0 = null;
    this.buf = '';
    const p = spawn(BIN, ['384', '200', '2800', '1500', '1300'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = p;
    p.stdout.setEncoding('latin1');
    p.stdout.on('data', (d) => this._data(d));
    p.stderr.on('data', (d) => this.onLog('JTTY : ' + String(d).trim()));
    p.stdin.on('error', () => {});
    p.on('exit', (code) => {
      if (this.proc === p) { this.proc = null; if (code) this.onLog('JTTY : décodeur arrêté (code ' + code + ')'); }
    });
    return true;
  }
  stop() {
    const p = this.proc;
    this.proc = null;
    if (p) { try { p.stdin.end(); } catch (e) {} setTimeout(() => { try { p.kill(); } catch (e) {} }, 2000); }
  }
  /** samples : Float32Array 12 kHz ; tFirst : heure (s) du premier échantillon */
  feed(samples, tFirst) {
    const p = this.proc;
    if (!p || !p.stdin.writable) return;
    if (this.t0 == null) this.t0 = tFirst;
    const b = Buffer.allocUnsafe(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      let v = samples[i];
      v = v > 1 ? 1 : v < -1 ? -1 : v;
      b.writeInt16LE(Math.round(v * 32767), i * 2);
    }
    p.stdin.write(b);
  }
  _data(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      const a = line.split('\t');
      if (a[0] !== 'U' || a.length < 8) continue;
      const start = Number(a[5]);
      this.onUpdate({
        key: this.sid + ':' + a[1],
        f: Math.round(Number(a[2])),
        db: Number(a[3]),
        done: Number(a[4]) !== 0,
        t: Math.round(((this.t0 || 0) + start) * 1000),
        text: a.slice(7).join(' ')
      });
    }
  }
}

module.exports = { JttyDecoder, available };
