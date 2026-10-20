/*
 * ulaw.js — codage audio G.711 µ-law (8 bits par échantillon), utilisé pour la BF du TRX.
 * À 8 kHz : 64 kbit/s, bande 300–3400 Hz, suffisant pour la SSB, la CW et la FM phonie.
 * Trames audio : 1 octet d'en-tête puis les échantillons
 *   0x01 : µ-law 8 kHz (anciennes pages Station)
 *   0x02 : PCM 16 bits 12 kHz (page Station → serveur : qualité suffisante pour décoder FT8 / FT4 / RTTY)
 *   0x03 : µ-law 12 kHz (serveur → membres à l'écoute)
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

  /** Float32 (-1..1) → trame µ-law [0x01 (8 kHz) ou 0x03 (12 kHz), µ-law…] */
  function encodeFrame(samples, rate) {
    const out = new Uint8Array(samples.length + 1);
    out[0] = rate === 12000 ? 0x03 : 0x01;
    for (let i = 0; i < samples.length; i++) {
      let v = samples[i];
      v = v > 1 ? 1 : v < -1 ? -1 : v;
      out[i + 1] = encodeSample(Math.round(v * 32767));
    }
    return out;
  }

  /** Float32 (-1..1) → trame PCM 16 bits [0x02, int16 little-endian…] (12 kHz) */
  function encodePcm(samples) {
    const out = new Uint8Array(samples.length * 2 + 1);
    out[0] = 0x02;
    const dv = new DataView(out.buffer);
    for (let i = 0; i < samples.length; i++) {
      let v = samples[i];
      v = v > 1 ? 1 : v < -1 ? -1 : v;
      dv.setInt16(1 + i * 2, Math.round(v * 32767), true);
    }
    return out;
  }

  /**
   * Trame audio → Float32 (-1..1) avec sa fréquence d'échantillonnage dans .rate,
   * ou null si ce n'est pas une trame audio
   */
  function decodeFrame(bytes) {
    if (!bytes || bytes.length < 2) return null;
    const h = bytes[0];
    let out;
    if (h === 0x01 || h === 0x03) {
      out = new Float32Array(bytes.length - 1);
      for (let i = 1; i < bytes.length; i++) out[i - 1] = DECODE[bytes[i]];
    } else if (h === 0x02) {
      const n = (bytes.length - 1) >> 1;
      out = new Float32Array(n);
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      for (let i = 0; i < n; i++) out[i] = dv.getInt16(1 + i * 2, true) / 32768;
    } else {
      return null;
    }
    out.rate = h === 0x01 ? 8000 : 12000;
    return out;
  }

  const api = { RATE: 8000, RATE_HQ: 12000, encodeFrame, encodePcm, decodeFrame };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ULAW = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
