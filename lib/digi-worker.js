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
const { RttyDemod } = require('./rtty.js');
const wspr = require('./wspr.js');
const jt65 = require('./jt65.js');
const { JttyDecoder } = require('./jtty.js');
// JTTY : décodage en continu (messages non synchronisés sur l'UTC)
const jtty = new JttyDecoder((u) => parentPort.postMessage({ t: 'jtty', u }), (msg) => parentPort.postMessage({ t: 'log', msg }));
let dialHz = 0;                            // fréquence du VFO (affichage des fréquences WSPR)

const RATE = 12000;
const ftx = ftxLib.load();
const RING = RATE * 135;                   // 135 s d'audio en mémoire (une période WSPR = 2 min)
const ring = new Float32Array(RING);
let written = 0;                           // nombre total d'échantillons reçus
let base = null;                           // heure (s, époque UNIX) de l'échantillon n° 0
let latency = 0.15;                        // délai capture + réseau estimé (s), ajusté d'après le DT des décodages
let modes = new Set();
const rtty = new Map();                    // clé → { demod, lvlAt } : un démodulateur RTTY par réglage demandé
const done = { FT8: 0, FT4: 0, WSPR: 0, JT65: 0 };           // dernière période décodée (ms)
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
  if (jtty.proc) jtty.feed(samples, base + written / RATE);
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
  // RTTY : démodulation en continu, texte envoyé dès qu'il arrive
  const now = Date.now();
  for (const [key, r] of rtty) {
    const text = r.demod.process(samples);
    if (text) parentPort.postMessage({ t: 'rtty_text', key, text });
    if (now - r.lvlAt > 200) {
      r.lvlAt = now;
      const l = r.demod.levels();
      parentPort.postMessage({ t: 'rtty_lvl', key, m: l.m, s: l.s, c: l.c });
    }
  }
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
    if (mode === 'WSPR') { tickWspr(newest); continue; }
    if (mode === 'JT65') { tickJt65(newest); continue; }
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
// WSPR : périodes de 2 minutes (minutes paires), 114 s analysées
function tickWspr(newest) {
  const L = wspr.SLOT * 1000;
  const slot = Math.floor((newest - wspr.LEN) * 1000 / L) * L;
  if (slot <= done.WSPR) return;
  done.WSPR = slot;
  if (Date.now() - slot > 2 * L) return; // trop ancien
  try {
    const r = wspr.decode(extract(slot / 1000, wspr.LEN * RATE), slot, dialHz);
    parentPort.postMessage({ t: 'decodes', mode: 'WSPR', slot, list: r.list, ms: r.ms, latency: Math.round(latency * 1000) });
  } catch (e) {
    parentPort.postMessage({ t: 'log', msg: 'WSPR : ' + e.message });
  }
}
// JT65 : périodes d'une minute, 52 s analysées par le décodeur de WSJT-X (programme natif, voir lib/jt65.js)
let jt65Busy = false;
function tickJt65(newest) {
  const L = 60000;
  const slot = Math.floor((newest - jt65.LEN) * 1000 / L) * L;
  if (slot <= done.JT65 || jt65Busy) return;
  done.JT65 = slot;
  if (Date.now() - slot > 2 * L) return;
  jt65Busy = true;
  const t0 = Date.now();
  jt65.decode(extract(slot / 1000, jt65.LEN * RATE), slot, (err, list) => {
    jt65Busy = false;
    if (err) return parentPort.postMessage({ t: 'log', msg: 'JT65 : ' + err.message });
    parentPort.postMessage({ t: 'decodes', mode: 'JT65', slot, list, ms: Date.now() - t0, latency: Math.round(latency * 1000) });
  });
}
setInterval(tick, 200);

parentPort.on('message', (m) => {
  if (m.t === 'audio' && m.samples) pushAudio(m.samples, m.at);
  else if (m.t === 'modes') {
    modes = new Set((m.modes || []).filter((x) => ['FT8', 'FT4', 'WSPR', 'JT65'].indexOf(x) >= 0));
    if ((m.modes || []).indexOf('JTTY') >= 0) { if (!jtty.proc && !jtty.start()) parentPort.postMessage({ t: 'log', msg: 'JTTY : décodeur indisponible (lib/bin/jttyd : Linux x86-64 requis)' }); }
    else if (jtty.proc) jtty.stop();
  }
  else if (m.t === 'dial' && Number.isFinite(m.hz)) dialHz = m.hz;
  else if (m.t === 'latency' && Number.isFinite(m.ms)) latency = m.ms / 1000;
  else if (m.t === 'rtty') {
    const want = new Map((m.cfgs || []).map((c) => [c.key, c]));
    for (const k of Array.from(rtty.keys())) if (!want.has(k)) rtty.delete(k);
    for (const [k, c] of want) if (!rtty.has(k)) rtty.set(k, { demod: new RttyDemod(Object.assign({ rate: RATE }, c)), lvlAt: 0 });
  }
  else if (m.t === 'reset') { base = null; written = 0; }
});
