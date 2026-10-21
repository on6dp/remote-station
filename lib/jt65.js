'use strict';
/*
 * jt65.js — décodage JT65 avec le décodeur de WSJT-X (programme de test « jt65 », GPL v3), compilé en
 * exécutable Linux x86-64 autonome (lib/bin/jt65, voir native/wsjtx/build.py). Chaque période d'une minute
 * est écrite dans un fichier .wav temporaire et décodée dans un processus séparé : si le décodeur
 * rencontre un problème, le serveur n'est pas touché.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const RATE = 12000;
const LEN = 52; // secondes analysées (émission de 46,8 s commençant à +1 s)
const BIN = path.join(__dirname, 'bin', 'jt65');

function wav16(samples) {
  const n = samples.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  let peak = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
  const g = peak > 0 ? Math.min(30000 / peak, 32768 * 4) : 1;
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * g))), 44 + i * 2);
  return b;
}

function available() {
  try { fs.accessSync(BIN, fs.constants.X_OK); return process.platform === 'linux' && process.arch === 'x64'; } catch (e) { return false; }
}

/**
 * Décode une période JT65A.
 * @param {Float32Array} samples audio 12 kHz à partir du début de la minute
 * @param {number} slotMs début de la période (ms UTC)
 * @param {(err:Error|null, list:Array)=>void} cb
 */
function decode(samples, slotMs, cb) {
  if (!available()) return cb(new Error('décodeur indisponible (lib/bin/jt65 : Linux x86-64 exécutable requis)'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-jt65-'));
  const d = new Date(slotMs);
  const hhmm = String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0');
  const file = path.join(dir, '000000_' + hhmm + '.wav'); // le décodeur lit l'heure dans le nom du fichier
  fs.writeFileSync(file, wav16(samples.subarray(0, Math.min(samples.length, LEN * RATE))));
  execFile(BIN, ['-a', '0', '-d', '3', '-m', 'A', file], { cwd: dir, timeout: 25000, maxBuffer: 1 << 20 }, (err, stdout) => {
    fs.rm(dir, { recursive: true, force: true }, () => {});
    if (err && !stdout) return cb(err, []);
    const list = [];
    // « sync  snr  dt  fréq  dérive  largeur  message  JT65  … »
    for (const line of String(stdout).split('\n')) {
      const m = /^\s*(-?\d+)\s+(-?\d+)\s+(-?[\d.]+)\s+(\d+)\s+(-?\d+)\s+(\d+)\s(.{22})\s*JT65/.exec(line);
      if (!m) continue;
      const msg = m[7].trim();
      if (!msg || list.some((x) => x.msg === msg && Math.abs(x.f - Number(m[4])) < 5)) continue;
      list.push({ db: Number(m[2]), dt: Math.round(Number(m[3]) * 10) / 10, f: Number(m[4]), drift: Number(m[5]), msg });
    }
    list.sort((a, b) => a.f - b.f);
    cb(null, list);
  });
}

module.exports = { decode, available, LEN, RATE };
