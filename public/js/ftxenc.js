/*
 * ftxenc.js — codeur FT8 / FT4 / FT2 (ft8_lib en WebAssembly : public/js/ftx-enc.wasm), commun à la page Station
 * (émission) et au serveur (essais). Aucune dépendance.
 *   const enc = await RSFTXENC.load(bytesOuUrl);  enc.encode('FT8', 'CQ ON5VL JO20', 48000, 1500)
 *   → { samples: Float32Array (-1..1), text: message codé, tones: [...], seconds } ou null si le message n'est pas codable
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RSFTXENC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MODE = { FT8: 0, FT4: 1, FT2: 3 };
  // Période (s) et durée d'émission (s) de chaque mode
  const SLOT = { FT8: 15, FT4: 7.5, FT2: 3.75 };

  function instantiate(bytes) {
    let mem = null;
    const wasi = {
      fd_write: (fd, iovs, n, nw) => {
        const dv = new DataView(mem.buffer);
        let total = 0;
        for (let i = 0; i < n; i++) total += dv.getUint32(iovs + i * 8 + 4, true);
        dv.setUint32(nw, total, true);
        return 0;
      },
      fd_close: () => 0,
      fd_seek: () => 70,
      proc_exit: (c) => { throw new Error('ftxenc: sortie ' + c); }
    };
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { wasi_snapshot_preview1: wasi });
    const x = inst.exports;
    mem = x.memory;
    if (x._initialize) x._initialize();
    return {
      MODES: Object.keys(MODE),
      SLOT,
      /** Message (13 à 37 caractères selon le type) → forme d'onde à `rate` Hz, ton 0 à `f0` Hz */
      encode(mode, text, rate, f0) {
        if (!(mode in MODE)) return null;
        const t = String(text || '').toUpperCase().replace(/[^ -~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 37);
        if (!t) return null;
        const tp = x.enc_text();
        const b = new Uint8Array(mem.buffer, tp, 64);
        b.fill(0);
        for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i);
        const n = x.enc_encode(MODE[mode], Math.round(rate), f0);
        if (n <= 0) return null;
        const samples = new Float32Array(mem.buffer, x.enc_wave(), n).slice();
        const tb = new Uint8Array(mem.buffer, tp, 64);
        let end = tb.indexOf(0);
        if (end < 0) end = 63;
        let sent = '';
        for (let i = 0; i < end; i++) sent += String.fromCharCode(tb[i]);
        const nt = x.enc_ntones();
        const tones = Array.from(new Uint8Array(mem.buffer, x.enc_tones(), nt));
        return { samples, text: sent.trim(), tones, seconds: n / rate };
      }
    };
  }

  return {
    SLOT,
    /** bytes : ArrayBuffer / Uint8Array (serveur) ou URL (navigateur) */
    async load(src) {
      let bytes = src;
      if (typeof src === 'string') bytes = await (await fetch(src, { cache: 'no-cache' })).arrayBuffer();
      return instantiate(bytes);
    },
    loadSync(bytes) { return instantiate(bytes); }
  };
});
