/*
 * ulaw.js — codage audio G.711 µ-law (8 bits par échantillon), utilisé pour la BF du TRX.
 * À 8 kHz : 64 kbit/s, bande 300–3400 Hz, suffisant pour la SSB, la CW et la FM phonie.
 * Trame audio échangée : 1 octet d'en-tête (0x01) + échantillons µ-law.
 */
(function (root) {
  'use strict';
  const BIAS = 0x84;
  const CLIP = 32635;

  function encodeSample(pcm) {
    const sign = pcm < 0 ? 0x80 : 0;
    if (sign) pcm = -pcm;
    if (pcm > CLIP) pcm = CLIP;
    pcm += BIAS;
    let exponent = 7;
    for (let mask = 0x4000; (pcm & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
    const mantissa = (pcm >> (exponent + 3)) & 0x0f;
    return ~(sign | (exponent << 4) | mantissa) & 0xff;
  }

  const DECODE = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff;
    const exponent = (u >> 4) & 7;
    let s = (((u & 0x0f) << 3) + BIAS) << exponent;
    s -= BIAS;
    DECODE[i] = ((u & 0x80) ? -s : s) / 32768;
  }

  /** Float32 (-1..1) → trame [0x01, µ-law…] */
  function encodeFrame(samples) {
    const out = new Uint8Array(samples.length + 1);
    out[0] = 0x01;
    for (let i = 0; i < samples.length; i++) {
      let v = samples[i];
      v = v > 1 ? 1 : v < -1 ? -1 : v;
      out[i + 1] = encodeSample(Math.round(v * 32767));
    }
    return out;
  }

  /** Trame [0x01, µ-law…] → Float32 (-1..1), ou null si ce n'est pas une trame audio */
  function decodeFrame(bytes) {
    if (!bytes || bytes.length < 2 || bytes[0] !== 0x01) return null;
    const out = new Float32Array(bytes.length - 1);
    for (let i = 1; i < bytes.length; i++) out[i - 1] = DECODE[bytes[i]];
    return out;
  }

  const api = { RATE: 8000, encodeFrame, decodeFrame };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ULAW = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
