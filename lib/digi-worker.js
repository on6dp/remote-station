'use strict';
/*
 * digi-worker.js — décodage des modes numériques (FT8, FT4) dans un fil séparé du serveur.
 *
 * Reçoit la BF du TRX (12 kHz) avec l'heure d'arrivée de chaque trame, la date sur l'horloge du VPS
 * (synchronisée NTP : l'heure du PC du club n'intervient pas), découpe les périodes UTC (15 s en FT8,
 * 7,5 s en FT4), les décode et renvoie les messages. Produit aussi les lignes de la cascade (6,25 Hz, 160 ms).
 *
 * Messages reçus :  { t:'audio', samples:Float32Array, at:ms }  { t:'modes', modes:['FT8',…] }  { t:'latency', ms }
 * Messages émis :   { t:'wf', row:Uint8Array, f0, df }  { t:'decodes', mode, slot:ms, list, latency }
 */
const { parentPort } = require('worker_threads');
const ftxLib = require('./ftx.js');

const RATE = 12000;
const ftx = ftxLib.load();
const RING = RATE * 45;                    // 45 s d'audio en mémoire
const ring = new Float32Array(RING);
let written = 0;                           // nombre total d'échantillons reçus
let base = null;                           // heure (s, époque UNIX) de l'échantillon n° 0
let latency = 0.15;                        // délai capture + réseau estimé (s), ajusté d'après le DT des décodages
let modes = new Set();
const done = { FT8: 0, FT4: 0 };           // dernière période décodée (ms)
const dtHist = [];                         // DT récents, pour recaler le délai

// ------------------------------------------------------------------ cascade
const wfBlock = ftx.wfBlock();
const wfBuf = new Float32Array(wfBlock);
let wfN = 0;
const WF_F0 = ftx.wfF0();

function pushAudio(samples, at) {
  const arrive = at / 1000 - latency;      // heure de capture du dernier échantillon de la trame
  const end = written + samples.length;
  if (base === null) base = arrive - end / RATE;
  else {
    const err = arrive - (base + end / RATE);
    // Trou ou dérive importante (coupure, page Station rechargée) : on se recale ; sinon correction douce
    if (Math.abs(err) > 0.5) base += err;
    else base += err * 0.01;
  }
  for (let i = 0; i < samples.length; i++) {
    ring[(written + i) % RING] = samples[i];
    wfBuf[wfN++] = samples[i];
    if (wfN === wfBlock) {
      wfN = 0;
      const row = ftx.wfRow(wfBuf);
      parentPort.postMessage({ t: 'wf', row, f0: WF_F0, df: 6.25 }, [row.buffer]);
    }
  }
  written = end;
}

function extract(t0, n) {
  // t0 : heure (s) du premier échantillon voulu
  const out = new Float32Array(n);
  const start = Math.round((t0 - base) * RATE);
  for (let i = 0; i < n; i++) {
    const k = start + i;
    if (k >= 0 && k < written && k >= written - RING) out[i] = ring[k % RING];
  }
  return out;
}

function tick() {
  if (base === null || !modes.size) return;
  const newest = base + written / RATE;    // heure du dernier échantillon reçu
  for (const mode of modes) {
    const g = ftx.geometry(mode);
    const L = g.slot * 1000;
    const dur = (g.block * g.blocks) / RATE;
    // Période terminée la plus récente dont tout l'audio est arrivé
    let slot = Math.floor((newest - dur) * 1000 / L) * L;
    if (slot <= done[mode]) continue;
    if (Date.now() - slot > 3 * L) { done[mode] = slot; continue; } // trop ancien
    done[mode] = slot;
    const t0 = Date.now();
    const list = ftx.decode(mode, extract(slot / 1000, g.block * g.blocks));
    // Recalage automatique : le DT médian d'une bande active est proche de 0 (stations synchronisées)
    for (const d of list) if (Math.abs(d.dt) < 2.5) dtHist.push(d.dt);
    while (dtHist.length > 60) dtHist.shift();
    if (dtHist.length >= 15) {
      const s = dtHist.slice().sort((a, b) => a - b);
      const med = s[s.length >> 1];
      if (Math.abs(med) > 0.15) {
        const adj = Math.max(-0.3, Math.min(0.3, med * 0.5));
        latency = Math.max(-1, Math.min(3, latency + adj));
        base -= adj; // les échantillons déjà reçus suivent le nouveau délai
        for (let i = 0; i < dtHist.length; i++) dtHist[i] -= adj;
      }
    }
    parentPort.postMessage({ t: 'decodes', mode, slot, list, ms: Date.now() - t0, latency: Math.round(latency * 1000) });
  }
}
setInterval(tick, 200);

parentPort.on('message', (m) => {
  if (m.t === 'audio' && m.samples) pushAudio(m.samples, m.at);
  else if (m.t === 'modes') modes = new Set((m.modes || []).filter((x) => x === 'FT8' || x === 'FT4'));
  else if (m.t === 'latency' && Number.isFinite(m.ms)) latency = m.ms / 1000;
  else if (m.t === 'reset') { base = null; written = 0; }
});
