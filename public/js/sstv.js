/*
 * sstv.js — modes SSTV et codeur (image → signal audio), commun au navigateur et au serveur.
 *
 * Temps des modes d'après J. L. Barber (N7CXI), « Proposal for SSTV mode specifications » (Dayton 2000),
 * et MMSSTV. Fréquences : synchro 1200 Hz, noir 1500 Hz, blanc 2300 Hz.
 * Chaque mode décrit une « ligne radio » (d'une synchro à la suivante) en segments ; le décodeur
 * (lib/sstv-dec.js) utilise les mêmes positions de canaux.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SSTV = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const F_SYNC = 1200;
  const F_BLACK = 1500;
  const F_WHITE = 2300;
  const F_LEADER = 1900;

  // Canal : { c: composante (G, B, R, Y, Y1, CR, CB, C = chrominance alternée), at: début (ms depuis le début de la ligne), len: durée (ms) }
  function martin(name, vis, scan) {
    const sync = 4.862;
    const gap = 0.572;
    const g = sync + gap;
    const b = g + scan + gap;
    const r = b + scan + gap;
    return {
      name, vis, w: 320, h: 256, rows: 1, sync, syncAt: 0, line: r + scan + gap,
      chans: [{ c: 'G', at: g, len: scan }, { c: 'B', at: b, len: scan }, { c: 'R', at: r, len: scan }],
      seg(px) { // px(c, x) → valeur 0..255
        return [[F_SYNC, sync], [F_BLACK, gap], ...scanSeg(px, 'G', scan, 320), [F_BLACK, gap], ...scanSeg(px, 'B', scan, 320), [F_BLACK, gap], ...scanSeg(px, 'R', scan, 320), [F_BLACK, gap]];
      }
    };
  }
  function scottie(name, vis, scan) {
    const sync = 9;
    const gap = 1.5;
    const g = gap;
    const b = g + scan + gap;
    const syncAt = b + scan;
    const r = syncAt + sync + gap;
    return {
      name, vis, w: 320, h: 256, rows: 1, sync, syncAt, line: r + scan, first: [[F_SYNC, sync]],
      chans: [{ c: 'G', at: g, len: scan }, { c: 'B', at: b, len: scan }, { c: 'R', at: r, len: scan }],
      seg(px) {
        return [[F_BLACK, gap], ...scanSeg(px, 'G', scan, 320), [F_BLACK, gap], ...scanSeg(px, 'B', scan, 320), [F_SYNC, sync], [F_BLACK, gap], ...scanSeg(px, 'R', scan, 320)];
      }
    };
  }
  function robot36() {
    return {
      name: 'Robot 36', vis: 8, w: 320, h: 240, rows: 1, sync: 9, syncAt: 0, line: 150, yuv: 'R36',
      chans: [{ c: 'Y', at: 12, len: 88 }, { c: 'C', at: 106, len: 44 }, { c: 'SEP', at: 100, len: 4.5 }],
      seg(px, y) {
        const odd = y % 2 === 1; // lignes paires : R-Y, impaires : B-Y
        return [[F_SYNC, 9], [F_BLACK, 3], ...scanSeg(px, 'Y', 88, 320), [odd ? F_WHITE : F_BLACK, 4.5], [F_LEADER, 1.5], ...scanSeg(px, odd ? 'CB' : 'CR', 44, 320)];
      }
    };
  }
  function robot72() {
    return {
      name: 'Robot 72', vis: 12, w: 320, h: 240, rows: 1, sync: 9, syncAt: 0, line: 300, yuv: 'R72',
      chans: [{ c: 'Y', at: 12, len: 138 }, { c: 'CR', at: 156, len: 69 }, { c: 'CB', at: 231, len: 69 }],
      seg(px) {
        return [[F_SYNC, 9], [F_BLACK, 3], ...scanSeg(px, 'Y', 138, 320), [F_BLACK, 4.5], [F_LEADER, 1.5], ...scanSeg(px, 'CR', 69, 320),
          [F_WHITE, 4.5], [F_LEADER, 1.5], ...scanSeg(px, 'CB', 69, 320)];
      }
    };
  }
  function pd(name, vis, w, h, pxMs) {
    const L = w * pxMs;
    const s = 20 + 2.08;
    return {
      name, vis, w, h, rows: 2, sync: 20, syncAt: 0, line: s + 4 * L, yuv: 'PD',
      chans: [{ c: 'Y', at: s, len: L }, { c: 'CR', at: s + L, len: L }, { c: 'CB', at: s + 2 * L, len: L }, { c: 'Y1', at: s + 3 * L, len: L }],
      seg(px) {
        return [[F_SYNC, 20], [F_BLACK, 2.08], ...scanSeg(px, 'Y', L, w), ...scanSeg(px, 'CR', L, w), ...scanSeg(px, 'CB', L, w), ...scanSeg(px, 'Y1', L, w)];
      }
    };
  }
  function scanSeg(px, c, len, w) {
    const t = len / w;
    const out = new Array(w);
    for (let x = 0; x < w; x++) out[x] = [F_BLACK + (F_WHITE - F_BLACK) * px(c, x) / 255, t];
    return out;
  }

  const MODES = {
    M1: martin('Martin M1', 44, 146.432),
    M2: martin('Martin M2', 40, 73.216),
    S1: scottie('Scottie S1', 60, 138.24),
    S2: scottie('Scottie S2', 56, 88.064),
    SDX: scottie('Scottie DX', 76, 345.6),
    R36: robot36(),
    R72: robot72(),
    PD50: pd('PD 50', 93, 320, 256, 0.286),
    PD90: pd('PD 90', 99, 320, 256, 0.532),
    PD120: pd('PD 120', 95, 640, 496, 0.19),
    PD160: pd('PD 160', 98, 512, 400, 0.382),
    PD180: pd('PD 180', 96, 640, 496, 0.286),
    PD240: pd('PD 240', 97, 640, 496, 0.382),
    PD290: pd('PD 290', 94, 800, 616, 0.286)
  };
  const BY_VIS = {};
  for (const k of Object.keys(MODES)) { MODES[k].id = k; BY_VIS[MODES[k].vis] = k; }
  /** Durée totale d'une image (s), en-tête VIS compris */
  function duration(id) {
    const m = MODES[id];
    return (8 * 100 + 300 + 10 + 300 + 300 + (m.first ? m.first[0][1] : 0) + m.line * m.h / m.rows) / 1000;
  }

  // YCbCr (pleine échelle, comme JPEG) ↔ RGB
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  function rgb2ycc(r, g, b) {
    return [0.299 * r + 0.587 * g + 0.114 * b, 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, 128 + 0.5 * r - 0.418688 * g - 0.081312 * b];
  }
  function ycc2rgb(y, cb, cr) {
    return [clamp(y + 1.402 * (cr - 128)), clamp(y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128)), clamp(y + 1.772 * (cb - 128))];
  }

  /**
   * Segments (fréquence Hz, durée ms) d'une image complète, en-tête VOX et VIS compris.
   * rgb : Uint8Array / Uint8ClampedArray (largeur × hauteur du mode, 3 octets par point, ou 4 avec alpha si stride = 4)
   */
  function segments(id, rgb, stride) {
    const m = MODES[id];
    const st = stride || 3;
    const W = m.w;
    const P = (x, y) => { const i = (y * W + x) * st; return [rgb[i], rgb[i + 1], rgb[i + 2]]; };
    const out = [];
    for (const f of [1900, 1500, 1900, 1500, 2300, 1500, 2300, 1500]) out.push([f, 100]);
    out.push([F_LEADER, 300], [F_SYNC, 10], [F_LEADER, 300], [F_SYNC, 30]);
    let ones = 0;
    for (let i = 0; i < 7; i++) { const b = (m.vis >> i) & 1; ones += b; out.push([b ? 1100 : 1300, 30]); }
    out.push([ones % 2 ? 1100 : 1300, 30], [F_SYNC, 30]);
    if (m.first) out.push(...m.first);
    for (let y = 0; y < m.h; y += m.rows) {
      let px;
      if (!m.yuv) {
        px = (c, x) => { const p = P(x, y); return c === 'R' ? p[0] : c === 'G' ? p[1] : p[2]; };
      } else if (m.rows === 2) {
        px = (c, x) => {
          const a = rgb2ycc(...P(x, y));
          const b = rgb2ycc(...P(x, Math.min(m.h - 1, y + 1)));
          if (c === 'Y') return a[0];
          if (c === 'Y1') return b[0];
          return c === 'CB' ? (a[1] + b[1]) / 2 : (a[2] + b[2]) / 2;
        };
      } else {
        px = (c, x) => { const a = rgb2ycc(...P(x, y)); return c === 'Y' ? a[0] : c === 'CB' ? a[1] : a[2]; };
      }
      out.push(...m.seg(px, y));
    }
    return out;
  }
  /** Signal audio (Float32Array, amplitude 0,8) à la fréquence d'échantillonnage demandée */
  function encode(id, rgb, rate, stride) {
    const segs = segments(id, rgb, stride);
    let total = 0;
    for (const s of segs) total += s[1];
    const out = new Float32Array(Math.ceil(total / 1000 * rate) + 1);
    let t = 0;      // temps écoulé (ms, exact)
    let n = 0;      // échantillons écrits
    let ph = 0;
    for (const [f, ms] of segs) {
      t += ms;
      const end = Math.round(t / 1000 * rate);
      const dph = 2 * Math.PI * f / rate;
      for (; n < end; n++) { out[n] = 0.8 * Math.sin(ph); ph += dph; }
      if (ph > 1e6) ph %= 2 * Math.PI;
    }
    return out.subarray(0, n);
  }

  return { MODES, BY_VIS, duration, encode, segments, rgb2ycc, ycc2rgb, F_SYNC, F_BLACK, F_WHITE };
});
