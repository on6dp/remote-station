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

  // ---------------------------------------------------------------------------------------------------------------
  // Message DXpédition (type 0.1 de WSJT-X, comme le FOX ou la réponse multiple de MSHV) : « A RR73; B <MOI> -NN » =
  // RR73 à A et report à B dans une seule émission. 77 bits : indicatif A (28) · indicatif B (28) · empreinte 10 bits
  // de notre indicatif · report (5 bits, pair, -30 à +32) · n3 = 1 · i3 = 0 ; puis CRC-14, LDPC (174, 91), tonalités
  // Costas + Gray et synthèse GFSK comme ft8_lib / WSJT-X.
  // Indicatif composé (F5OYA/P, HA/ES3H) : transmis par son empreinte 22 bits (« <HA/ES3H> » chez le correspondant, qui
  // connaît la sienne), comme les indicatifs entre crochets des messages standard
  const DX_RE = /^<?([A-Z0-9/]{3,11})>? RR73; <?([A-Z0-9/]{3,11})>? <([A-Z0-9/]{3,11})> ([+-]\d{2})$/;
  const GEN = ('8329ce11bf31eaf509f27fc0761c264e25c2593354931320dc265902fb277c6410a1bdc01b3f417858cd2dd33ec7f620' +
    '09fda4fee04195fd034783a0077cccc11b8873ed5c3d48a029b62afe3ca036f4fe1a9da06054faf5f35d96d3b0c8c3e0' +
    'e20798e4310eed27884ae900775c9c08e80e26ddae563180b0b811028c2bf997213487c018a0c9231fc60adf5c5ea320' +
    '76471e8302a0721e01b12b80ffbccb80ca8341fafb47b2e066a72a158f9325a2bf671700c4243689fe85b1c51363a180' +
    '0dff739414d1a1b34b1c270015b48830636c8b99894972e029a89c0d3de81d665489b0e04f126f37fa51cbe61bd6b940' +
    '99c47239d0d97d3c84e094001919b75119765621bb4f1e8009db12d731faee0b86df6b80488fc33df43fbdeea4eafb40' +
    '827423ee40b675f756eb5fe0abe197c484cb74757144a9a02b500e4bc0ec5a6d2bdbdd00c474aa53d702187616693600' +
    '8eba1a13db3390bd6718cec0753844673a27782cc42012e006ff83a145c37035a5c126803b37417858cc2dd33ec3f620' +
    '9a4a5a28ee17ca9c324842c0bc29f465309c977e89610a402663ae6ddf8b5ce2bb29488046f231efe457034c18144180' +
    '3fb2ce85abe9b0c72e06fbe0de87481f282c153971a0a2e0fcd7ccf23c69fa99bba14120f0261447e9490ca8e474cec0' +
    '4410115818196f95cdd70120088fc31df4bfbde2a4eafb40b8fef1b6307729fb0a078c005afea7acccb77bbc9d99a900' +
    '49a7016ac653f65ecdc907601944d085be4e7da8d6cc7d00251f62adc4032f0ee714002056471f8702a0721e00b12b80' +
    '2b8e4923f2dd51e2d537fa006b550a40a66f4755de95c260a18ad28d4e27fe92a4f6c84010c2e586388cb82a3d807580' +
    'ef34a41817ee02133db2eb007e9c0c54325a9c15836e00003693e572d1fde4cdf079e860bfb2cec5abe1b0c72e07fbe0' +
    '7ee18230c583cccc57d4b080a066cb2fedafc9f526641260bb23725abc47cc5f4cc4cd20ded9dba3bee40c59b5609b40' +
    'd9a7016ac653e6decdc903609ad46aed5f707f280ab5fc40e5921c77822587316d7d3c204f14da8242a8b86dca733520' +
    '8b8b507ad467d4441df770e022831c9cf1169467ad04b680213b838fe2ae54c38ee718005d926b6dd71f085181a4e120' +
    '66ab79d4b29ee6e69509e560958148682d748a38dd68baa0b8ce020cf069c32a723ab140f4331d6d461607e957527460' +
    '6da23ba424b9596133cf9c80a636bcbc7b30c5fbeae67fe05cb0d86a07df654a9089a200f11f106848780fc9ecdd80a0' +
    '1fbb5364fb8d2c9d730d5ba0fcb86bc70a50c9d02a5d0340a534433029eac15f322e34c0c989d9c7c3d3b8c55d751300' +
    '7bb38b2f0186d46643ae96202644ebadeb44b9467d1f42c0608cc857594bfbb55d696000').match(/.{24}/g).map((h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16))));
  const COSTAS = [3, 1, 4, 0, 6, 5, 2], GRAY = [0, 1, 3, 2, 5, 6, 4, 7];
  const nchar = (c, tbl) => tbl.indexOf(c);
  const T_AS = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', T_A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', T_N = '0123456789', T_LS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  /** Indicatif standard → 28 bits (ft8_lib pack_basecall + NTOKENS + MAX22), -1 sinon */
  function pack28(call) {
    let c6 = null;
    const L = call.length;
    if (/^3DA0/.test(call) && L > 4 && L <= 7) c6 = '3D0' + call.slice(4);
    else if (/^3X[A-Z]/.test(call) && L <= 7) c6 = 'Q' + call.slice(2);
    else if (/^..\d/.test(call) && L <= 6) c6 = call;
    else if (/^.\d/.test(call) && L <= 5) c6 = ' ' + call;
    if (!c6) return -1;
    c6 = (c6 + '      ').slice(0, 6);
    const i = [nchar(c6[0], T_AS), nchar(c6[1], T_A), nchar(c6[2], T_N), nchar(c6[3], T_LS), nchar(c6[4], T_LS), nchar(c6[5], T_LS)];
    if (i.some((x) => x < 0)) return -1;
    const n = ((((i[0] * 36 + i[1]) * 10 + i[2]) * 27 + i[3]) * 27 + i[4]) * 27 + i[5];
    return 2063592 + 4194304 + n;
  }
  /** Indicatif → 28 bits : standard, sinon empreinte 22 bits (NTOKENS + n22, comme pack28 de ft8_lib) */
  function pack28h(call) {
    const n = call.indexOf('/') < 0 ? pack28(call) : -1;
    if (n >= 0) return n;
    const h = hash22(call);
    return h < 0 ? -1 : 2063592 + h;
  }
  function hash22(call) {
    let n58 = 0n;
    const T = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/';
    for (let i = 0; i < 11; i++) {
      const j = i < call.length ? T.indexOf(call[i]) : 0;
      if (j < 0) return -1;
      n58 = n58 * 38n + BigInt(j);
    }
    return Number(((47055833459n * n58) & 0xFFFFFFFFFFFFFFFFn) >> 42n) & 0x3FFFFF;
  }
  /** Empreinte 10 bits d'un indicatif (ihashcall de WSJT-X) */
  function hash10(call) {
    let n58 = 0n;
    const T = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/';
    for (let i = 0; i < 11; i++) {
      const j = i < call.length ? T.indexOf(call[i]) : 0;
      if (j < 0) return -1;
      n58 = n58 * 38n + BigInt(j);
    }
    const n22 = Number(((47055833459n * n58) & 0xFFFFFFFFFFFFFFFFn) >> 42n) & 0x3FFFFF;
    return n22 >> 12;
  }
  function crc14(a, nbits) {
    let r = 0, k = 0;
    for (let b = 0; b < nbits; b++) {
      if (b % 8 === 0) r ^= a[k++] << 6;
      r = r & 0x2000 ? ((r << 1) ^ 0x2757) : r << 1;
    }
    return r & 0x3FFF;
  }
  const parity8 = (x) => { x ^= x >> 4; x ^= x >> 2; x ^= x >> 1; return x & 1; };
  /** 77 bits (10 octets) → 79 tonalités FT8 */
  function ft8Tones(payload) {
    const a91 = new Uint8Array(12);
    a91.set(payload.subarray(0, 10));
    a91[9] &= 0xF8; a91[10] = 0;
    const c = crc14(a91, 82);
    a91[9] |= c >> 11; a91[10] = (c >> 3) & 0xFF; a91[11] = (c << 5) & 0xFF;
    const cw = new Uint8Array(22);
    cw.set(a91);
    let mask = 0x80 >> (91 % 8), idx = 11;
    for (let i = 0; i < 83; i++) {
      let s = 0;
      for (let j = 0; j < 12; j++) s ^= parity8(a91[j] & GEN[i][j]);
      if (s) cw[idx] |= mask;
      mask >>= 1;
      if (!mask) { mask = 0x80; idx++; }
    }
    const tones = new Uint8Array(79);
    let m = 0x80, ib = 0;
    const bit = () => { const v = cw[ib] & m ? 1 : 0; m >>= 1; if (!m) { m = 0x80; ib++; } return v; };
    for (let t = 0; t < 79; t++) {
      if (t < 7) tones[t] = COSTAS[t];
      else if (t >= 36 && t < 43) tones[t] = COSTAS[t - 36];
      else if (t >= 72) tones[t] = COSTAS[t - 72];
      else tones[t] = GRAY[(bit() << 2) | (bit() << 1) | bit()];
    }
    return tones;
  }
  /** Synthèse GFSK FT8 (BT 2, 0,16 s par symbole, rampes d'1/8 de symbole), identique à ftx_enc.c */
  function synthFt8(tones, f0, rate) {
    const nSym = 79, bt = 2, K = 5.336446;
    const nsps = Math.floor(0.5 + rate * 0.16);
    const nWave = nSym * nsps;
    const dphiPeak = 2 * Math.PI / nsps;
    const dphi = new Float64Array(nWave + 2 * nsps).fill(2 * Math.PI * f0 / rate);
    const pulse = new Float64Array(3 * nsps);
    const erf = (x) => { // Abramowitz-Stegun 7.1.26 amélioré (erreur < 1,2e-7)
      const t = 1 / (1 + 0.5 * Math.abs(x));
      const y = 1 - t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
      return x >= 0 ? y : -y;
    };
    for (let i = 0; i < 3 * nsps; i++) { const t = i / nsps - 1.5; pulse[i] = (erf(K * bt * (t + 0.5)) - erf(K * bt * (t - 0.5))) / 2; }
    for (let i = 0; i < nSym; i++) for (let j = 0; j < 3 * nsps; j++) dphi[j + i * nsps] += dphiPeak * tones[i] * pulse[j];
    for (let j = 0; j < 2 * nsps; j++) { dphi[j] += dphiPeak * pulse[j + nsps] * tones[0]; dphi[j + nSym * nsps] += dphiPeak * pulse[j] * tones[nSym - 1]; }
    const wave = new Float32Array(nWave);
    let phi = 0;
    for (let k = 0; k < nWave; k++) { wave[k] = Math.sin(phi); phi = (phi + dphi[k + nsps]) % (2 * Math.PI); }
    const ramp = Math.floor(nsps / 8);
    for (let i = 0; i < ramp; i++) { const env = (1 - Math.cos(2 * Math.PI * i / (2 * ramp))) / 2; wave[i] *= env; wave[nWave - 1 - i] *= env; }
    return wave;
  }
  /** Bits (valeur, largeur) mis bout à bout, poids fort d'abord, dans 10 octets */
  function bits77(fields) {
    const out = new Uint8Array(10);
    let pos = 0;
    for (const [v, w] of fields) for (let b = w - 1; b >= 0; b--, pos++) if (Math.floor(v / 2 ** b) % 2) out[pos >> 3] |= 0x80 >> (pos & 7);
    return out;
  }
  function encodeDx(t, rate, f0) {
    const x = DX_RE.exec(t);
    const a = pack28h(x[1]), b = pack28h(x[2]), h = hash10(x[3]);
    if (a < 0 || b < 0 || h < 0) return null;
    const rpt = Math.max(-30, Math.min(32, 2 * Math.round(Number(x[4]) / 2)));
    const payload = bits77([[a, 28], [b, 28], [h, 10], [(rpt + 30) / 2, 5], [1, 3], [0, 3]]);
    const tones = ft8Tones(payload);
    const samples = synthFt8(tones, f0, Math.round(rate));
    const r2 = (rpt >= 0 ? '+' : '-') + String(Math.abs(rpt)).padStart(2, '0');
    const show = (c) => (c.indexOf('/') < 0 ? c : '<' + c + '>');
    return { samples, text: show(x[1]) + ' RR73; ' + show(x[2]) + ' <' + x[3] + '> ' + r2, tones: Array.from(tones), seconds: samples.length / rate };
  }
  /** Essais : charge utile 77 bits → tonalités (comparaison avec ft8_lib) */
  const _test = { ft8Tones, bits77, pack28, hash10, synthFt8 };

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
        // Message double (« K1ABC RR73; W9XYZ <ON5VL> -08 », type 0.1 DXpédition) : codé ici, ft8_lib ne sait que le lire
        if (DX_RE.test(t)) return mode === 'FT8' ? encodeDx(t, rate, f0) : null;
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
    loadSync(bytes) { return instantiate(bytes); },
    _test
  };
});
