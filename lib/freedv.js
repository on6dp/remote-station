'use strict';
/*
 * freedv.js — FreeDV (phonie numérique HF) : RADE (V1), 700D, 700E et 1600, avec lib/bin/fdvd (rade_c + FARGAN d'Opus,
 * bibliothèque codec2 de FreeDV ; voir native/freedv). Processus séparés : un problème du codec ne touche pas le serveur.
 *
 * Réception (FdvRx) : la BF du TRX (12 kHz) est ramenée à 8 kHz et lue en continu par « fdvd rx » : tous les modes
 * écoutent en même temps, celui qui se synchronise est entendu. La voix décodée (16 kHz) revient en 12 kHz, par trames
 * de 20 ms (240 échantillons), pour l'écoute des membres ; l'état (synchro, SNR, écart de fréquence, constellation)
 * et l'indicatif reçu arrivent à part.
 * Émission (FdvTx) : la voix de l'opérateur (12 kHz) passe à 16 kHz dans « fdvd tx MODE INDICATIF », le signal FreeDV
 * (8 kHz) revient en 12 kHz, en trames de 20 ms, pour la page Station.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const WIN = process.platform === 'win32';
const BIN = path.join(__dirname, 'bin', 'fdvd' + (WIN ? '.exe' : ''));
function available() {
  try { fs.accessSync(BIN, WIN ? fs.constants.R_OK : fs.constants.X_OK); } catch (e) { return false; }
  return (process.platform === 'linux' || WIN) && process.arch === 'x64';
}
const MODES = ['RADE', '700D', '700E', '1600'];

/** Filtre passe-bas (fenêtre de Blackman) : fc en fraction de la fréquence d'échantillonnage */
function lowpass(n, fc) {
  const h = new Float32Array(n);
  const m = (n - 1) / 2;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const x = i - m;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (n - 1));
    h[i] = sinc * w;
    s += h[i];
  }
  for (let i = 0; i < n; i++) h[i] /= s;
  return h;
}
/** Changement de fréquence d'échantillonnage up/down (polyphase), en flux continu */
class Resampler {
  constructor(up, down, taps) {
    this.up = up; this.down = down;
    const n = (taps || 48) * up;
    this.h = lowpass(n, 0.45 / Math.max(up, down)); // coupure sous la plus basse des deux moitiés de bande
    for (let i = 0; i < n; i++) this.h[i] *= up;
    this.hist = new Float32Array(Math.ceil(n / up) + 1);
    this.phase = 0; // position dans la suite suréchantillonnée
  }
  process(x) {
    const { up, down, h } = this;
    const L = this.hist.length;
    const buf = new Float32Array(L + x.length);
    buf.set(this.hist, 0);
    buf.set(x, L);
    const out = [];
    const total = (L + x.length) * up;
    // p : indice dans la suite suréchantillonnée (xup non nul aux multiples de up), avance de « down » ;
    // y[p] = Σ h[k] · xup[p − k] ; this.phase = position de la sortie suivante par rapport au début du nouveau bloc
    let p;
    for (p = this.phase + L * up; p < total; p += down) {
      let acc = 0;
      for (let k = p % up; k < h.length; k += up) {
        const j = (p - k) / up;
        if (j < 0) break;
        acc += h[k] * buf[j];
      }
      out.push(acc);
    }
    this.phase = p - total;
    this.hist = buf.slice(buf.length - L);
    return Float32Array.from(out);
  }
}

const f2s = (f) => {
  const b = Buffer.allocUnsafe(f.length * 2);
  for (let i = 0; i < f.length; i++) { let v = f[i]; v = v > 1 ? 1 : v < -1 ? -1 : v; b.writeInt16LE(Math.round(v * 32767), i * 2); }
  return b;
};
const s2f = (b) => { const n = b.length >> 1, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = b.readInt16LE(i * 2) / 32768; return o; };

/** Découpe un flux Float32 12 kHz en trames de 240 échantillons (20 ms) */
class Framer {
  constructor(onFrame) { this.on = onFrame; this.buf = new Float32Array(0); }
  push(f) {
    const b = new Float32Array(this.buf.length + f.length);
    b.set(this.buf); b.set(f, this.buf.length);
    let i = 0;
    for (; i + 240 <= b.length; i += 240) this.on(b.slice(i, i + 240));
    this.buf = b.slice(i);
  }
  flush() { if (this.buf.length) { const f = new Float32Array(240); f.set(this.buf); this.buf = new Float32Array(0); this.on(f); } }
}

class FdvRx {
  constructor(onVoice, onStatus, onCall, onLog) {
    this.onVoice = onVoice; this.onStatus = onStatus || (() => {}); this.onCall = onCall || (() => {}); this.onLog = onLog || (() => {});
    this.proc = null;
  }
  start() {
    if (this.proc || !available()) return !!this.proc;
    this.down = new Resampler(2, 3); // BF du TRX : 12 → 8 kHz
    this.up = new Resampler(3, 4);   // voix décodée : 16 → 12 kHz
    this.fr = new Framer((f) => this.onVoice(f));
    this.err = '';
    this.sbuf = Buffer.alloc(0);
    const p = spawn(BIN, ['rx', MODES.join(',')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = p;
    p.stdout.on('data', (d) => {
      this.sbuf = this.sbuf.length ? Buffer.concat([this.sbuf, d]) : d;
      const n = this.sbuf.length & ~1;
      if (!n) return;
      const f = s2f(this.sbuf.subarray(0, n));
      this.sbuf = this.sbuf.subarray(n);
      this.fr.push(this.up.process(f));
    });
    p.stderr.setEncoding('latin1');
    p.stderr.on('data', (d) => {
      this.err += d;
      if (this.err.length > 1e6) this.err = this.err.slice(-1e5);
      let i;
      while ((i = this.err.indexOf('\n')) >= 0) {
        const line = this.err.slice(0, i);
        this.err = this.err.slice(i + 1);
        let m;
        try { m = JSON.parse(line); } catch (e) { continue; }
        if (m.t === 'st') this.onStatus(m);
        else if (m.t === 'txt' && m.call) this.onCall({ call: m.call, mode: m.n });
      }
    });
    p.stdin.on('error', () => {});
    p.on('exit', (code) => { if (this.proc === p) { this.proc = null; if (code) this.onLog('FreeDV : décodeur arrêté (code ' + code + ')'); } });
    return true;
  }
  stop() {
    const p = this.proc;
    this.proc = null;
    if (p) { try { p.stdin.end(); } catch (e) {} setTimeout(() => { try { p.kill(); } catch (e) {} }, 1000); }
  }
  /** samples : Float32Array 12 kHz */
  feed(samples) {
    const p = this.proc;
    if (!p || !p.stdin.writable) return;
    if (p.stdin.writableLength > 64000) return; // décodeur en retard : on saute plutôt que d'accumuler du retard
    p.stdin.write(f2s(this.down.process(samples)));
  }
}

/** Émission : une par passage en émission. onFrame(Float32Array 240 éch. 12 kHz) ; onEnd() quand tout est sorti */
class FdvTx {
  constructor(mode, call, onFrame, onEnd, onLog) {
    this.mode = MODES.indexOf(mode) >= 0 ? mode : 'RADE';
    this.onEnd = onEnd || (() => {});
    this.down = new Resampler(4, 3); // voix : 12 → 16 kHz
    this.up = new Resampler(3, 2);   // signal FreeDV : 8 → 12 kHz
    this.fr = new Framer(onFrame);
    this.sbuf = Buffer.alloc(0);
    this.ended = false;
    const p = spawn(BIN, ['tx', this.mode, String(call || 'NOCALL').replace(/[^A-Z0-9/]/gi, '').slice(0, 12) || 'NOCALL'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = p;
    p.stdout.on('data', (d) => {
      this.sbuf = this.sbuf.length ? Buffer.concat([this.sbuf, d]) : d;
      const n = this.sbuf.length & ~1;
      if (!n) return;
      const f = s2f(this.sbuf.subarray(0, n));
      this.sbuf = this.sbuf.subarray(n);
      this.fr.push(this.up.process(f));
    });
    p.stderr.on('data', () => {});
    p.stdin.on('error', () => {});
    p.on('exit', () => { this.fr.flush(); this.proc = null; if (!this.ended) { this.ended = true; this.onEnd(); } });
    p.on('error', (e) => { if (onLog) onLog('FreeDV : codeur indisponible (' + e.message + ')'); });
  }
  /** Voix de l'opérateur : Float32Array 12 kHz */
  voice(samples) {
    const p = this.proc;
    if (!p || !p.stdin.writable) return;
    p.stdin.write(f2s(this.down.process(samples)));
  }
  /** Fin de la parole : le reste du signal sort, puis onEnd */
  finish() { const p = this.proc; if (p) { try { p.stdin.end(); } catch (e) {} setTimeout(() => { try { p.kill(); } catch (e) {} }, 3000); } else if (!this.ended) { this.ended = true; this.onEnd(); } }
  kill() { this.ended = true; const p = this.proc; this.proc = null; if (p) try { p.kill(); } catch (e) {} }
}

module.exports = { FdvRx, FdvTx, Resampler, available, MODES };
