'use strict';
/*
 * ftx.js — décodeur FT8 / FT4 (ft8_lib compilé en WebAssembly, lib/ftx.wasm), sans dépendance.
 * Utilisé dans un Worker (lib/digi-worker.js) pour ne jamais bloquer le serveur.
 */
const fs = require('fs');
const path = require('path');

const RATE = 12000;
const PROTO = { FT8: 0, FT4: 1 };
const SLOT = { FT8: 15, FT4: 7.5 };
// Début nominal d'une émission dans sa période (WSJT-X : DT = 0 pour un départ à +0,5 s en FT8, +0,5 s en FT4)
const T0 = { FT8: 0.5, FT4: 0.5 };

function load() {
  const mod = new WebAssembly.Module(fs.readFileSync(path.join(__dirname, 'ftx.wasm')));
  let mem = null;
  // Le décodeur n'écrit rien (pas de fichiers) : appels système neutralisés
  const wasi = {
    // Messages de diagnostic ignorés, mais déclarés « écrits » (sinon la libc C réessaie sans fin)
    fd_write: (fd, iovs, n, nw) => {
      const dv = new DataView(mem.buffer);
      let total = 0;
      for (let i = 0; i < n; i++) total += dv.getUint32(iovs + i * 8 + 4, true);
      dv.setUint32(nw, total, true);
      return 0;
    },
    fd_close: () => 0,
    fd_seek: () => 70,
    proc_exit: (c) => { throw new Error('ftx: sortie ' + c); }
  };
  const inst = new WebAssembly.Instance(mod, { wasi_snapshot_preview1: wasi });
  const x = inst.exports;
  mem = x.memory;
  if (x._initialize) x._initialize();
  const bufPtr = x.ftx_buf();
  const outPtr = x.ftx_out();
  const fbuf = () => new Float32Array(mem.buffer, bufPtr, 4096);
  const text = (n) => {
    const b = new Uint8Array(mem.buffer, outPtr, 6400);
    let end = b.indexOf(0);
    if (end < 0) end = b.length;
    return Buffer.from(b.subarray(0, end)).toString('latin1');
  };
  return {
    RATE,
    /** Échantillons par bloc et nombre de blocs d'une période (FT8 : 1920 × 93) */
    geometry(mode) {
      const h = PROTO[mode];
      return { block: x.ftx_block(h), blocks: x.ftx_blocks(h), slot: SLOT[mode] };
    },
    /**
     * Décode une période complète : samples commence au début de la période (temps 0 = début UTC du créneau).
     * Renvoie [{ db, dt, f, msg }]
     */
    decode(mode, samples) {
      const h = PROTO[mode];
      const block = x.ftx_block(h);
      const blocks = x.ftx_blocks(h);
      x.ftx_reset(h);
      for (let i = 0; i < blocks; i++) {
        const s = i * block;
        const f = fbuf();
        if (s + block <= samples.length) f.set(samples.subarray(s, s + block));
        else { f.fill(0, 0, block); if (s < samples.length) f.set(samples.subarray(s)); }
        x.ftx_process(h);
      }
      x.ftx_decode(h);
      const out = [];
      for (const line of text().split('\n')) {
        if (!line) continue;
        const a = line.split(';');
        if (a.length < 4) continue;
        const score = Number(a[0]);
        out.push({
          // Approximation du rapport signal/bruit WSJT-X (dB dans 2,5 kHz) à partir du score de synchro
          db: Math.max(-28, Math.min(30, Math.round(score * 0.5 - 24))),
          dt: Math.round((Number(a[1]) - T0[mode]) * 10) / 10,
          f: Math.round(Number(a[2])),
          msg: a.slice(3).join(';').trim()
        });
      }
      out.sort((p, q) => p.f - q.f);
      return out;
    },
    /** Cascade : un bloc de 1920 échantillons (160 ms) → une ligne d'octets (6,25 Hz par case, 0–3200 Hz) */
    wfBlock() { return x.ftx_block(2); },
    wfF0() { return x.ftx_wf_f0(); },
    wfRow(samples) {
      fbuf().set(samples.subarray(0, x.ftx_block(2)));
      const n = x.ftx_wf_row();
      return Uint8Array.from(new Uint8Array(mem.buffer, outPtr, n));
    }
  };
}

module.exports = { load, RATE, SLOT };
