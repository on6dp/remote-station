'use strict';
/*
 * wspr.js — décodage WSPR avec wsprd (WSJT-X, K9AN / K1JT, licence GNU GPL v3) compilé en WebAssembly
 * (lib/wsprd.wasm, voir native/wspr/). Exécuté avec un WASI en mémoire (lib/wasi-mem.js) : le fichier .wav
 * de la période et la table des indicatifs hachés (conservée d'une période à l'autre) ne touchent pas le disque.
 */
const fs = require('fs');
const path = require('path');

const wasi = require('./wasi-mem.js');
let mod = null;
const files = new Map();
const RATE = 12000;
const SLOT = 120;     // une période WSPR = 2 minutes, début aux minutes paires
const LEN = 114;      // secondes analysées (émission de 110,6 s commençant à +1 s)

function wav16(samples) {
  const n = samples.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  // Normalisation douce : wsprd attend des entiers 16 bits ; on évite l'écrêtage sans modifier le rapport signal/bruit
  let peak = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
  const g = peak > 0 ? Math.min(30000 / peak, 32768 * 4) : 1;
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * g))), 44 + i * 2);
  return b;
}

/**
 * Décode une période WSPR.
 * @param {Float32Array} samples  audio 12 kHz commençant au début de la période (minute paire)
 * @param {number} slotMs         début de la période (ms UTC)
 * @param {number} dialHz         fréquence du VFO (pour afficher la fréquence réelle), 0 si inconnue
 * @returns {{list:Array, ms:number}}
 */
function decode(samples, slotMs, dialHz) {
  if (!mod) mod = new WebAssembly.Module(fs.readFileSync(path.join(__dirname, 'wsprd.wasm')));
  const d = new Date(slotMs);
  const p2 = (n) => String(n).padStart(2, '0');
  // wsprd tire la date et l'heure du nom du fichier : AAMMJJ_HHMM.wav
  const stamp = p2(d.getUTCFullYear() % 100) + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + '_' + p2(d.getUTCHours()) + p2(d.getUTCMinutes());
  const name = '/w/' + stamp + '.wav';
  // Fichiers en mémoire : seule la table des indicatifs hachés est gardée d'une période à l'autre
  for (const k of Array.from(files.keys())) if (k !== '/w/hashtable.txt') files.delete(k);
  files.set(name, wav16(samples.subarray(0, Math.min(samples.length, LEN * RATE))));
  const t0 = Date.now();
  const r = wasi.run(mod, ['wsprd', '-a', '/w', '-f', ((dialHz || 0) / 1e6).toFixed(6), name], files);
  files.delete(name);
  const list = [];
  // Ligne wsprd : « HHMM  SNR   DT   FRÉQ(MHz)  DÉRIVE  MESSAGE »
  for (const line of r.stdout.split('\n')) {
    const m = /^\s*(\d{4})\s+(-?\d+)\s+(-?[\d.]+)\s+([\d.]+)\s+(-?\d+)\s+(.+?)\s*$/.exec(line);
    if (!m || /^<DecodeFinished>/.test(m[6])) continue;
    const w = m[6].split(/\s+/);
    const fMHz = Number(m[4]);
    list.push({
      db: Number(m[2]),
      dt: Number(m[3]),
      freq: Math.round(fMHz * 1e6),          // fréquence réelle (Hz) si le VFO est connu
      f: Math.round(fMHz * 1e6 - (dialHz || 0)), // fréquence audio (Hz)
      drift: Number(m[5]),
      msg: m[6],
      call: (w[0] || '').replace(/^<|>$/g, ''),
      grid: /^[A-R]{2}\d{2}([A-X]{2})?$/i.test(w[1] || '') ? w[1] : '',
      dbm: Number.isFinite(Number(w[w.length - 1])) ? Number(w[w.length - 1]) : null
    });
  }
  return { list, ms: Date.now() - t0 };
}

module.exports = { decode, RATE, SLOT, LEN };
