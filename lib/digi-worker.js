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
const { Wsjtx } = require('./wsjtx.js');
const { RttyDemod } = require('./rtty.js');
const { CwDecoder } = require('./cw.js');
const { SstvDecoder } = require('./sstv-dec.js');
// SSTV : un seul décodeur (images communes à tous les membres), actif si quelqu'un regarde l'onglet
let sstv = null;
const sstvEvent = (e) => {
  if (e.t === 'line') parentPort.postMessage({ t: 'sstv', e }, [e.rgb.buffer]);
  else if (e.t === 'end' && e.rgb) { const c = new Uint8Array(e.rgb); parentPort.postMessage({ t: 'sstv', e: Object.assign({}, e, { rgb: c }) }, [c.buffer]); }
  else parentPort.postMessage({ t: 'sstv', e });
};
const wspr = require('./wspr.js');
const jt65 = require('./jt65.js');
const { JttyDecoder } = require('./jtty.js');
// JTTY : décodage en continu (messages non synchronisés sur l'UTC)
const jtty = new JttyDecoder((u) => parentPort.postMessage({ t: 'jtty', u }), (msg) => parentPort.postMessage({ t: 'log', msg }));
let dialHz = 0;                            // fréquence du VFO (affichage des fréquences WSPR)

const RATE = 12000;
const ftx = ftxLib.load();
// FT8 / FT4 / FT2 : moteur de WSJT-X (bien plus sensible) ; ft8_lib si le programme natif manque ou s'arrête
const wsj = new Wsjtx((msg) => parentPort.postMessage({ t: 'log', msg }));
// Passe profonde FT8 (la plus lente) dans un second processus : elle ne retarde jamais la passe anticipée ni la normale
const wsjDeep = new Wsjtx((msg) => parentPort.postMessage({ t: 'log', msg: 'passe profonde : ' + msg }));
let apCtx = {};                            // { mycall, hiscall, mygrid, hisgrid, qp, rx, tx } envoyé par le serveur
const utcOf = (ms) => { const d = new Date(ms); return d.getUTCHours() * 10000 + d.getUTCMinutes() * 100 + d.getUTCSeconds(); };
async function decodeFt(mode, samples, slot, phase) {
  if (wsj.ok()) {
    try {
      const r = await wsj.decode(mode, samples, Object.assign({}, apCtx, { phase, utc: utcOf(slot) }));
      return { list: r.list, engine: 'wsjtx' };
    } catch (e) { /* repli sur ft8_lib */ }
  }
  return { list: ftx.decode(mode, samples), engine: 'ft8_lib' };
}
const ftBusy = { FT8: 0, FT4: 0, FT2: 0 }; // décodages en attente par mode (machine trop lente : on saute l'anticipé)
const RING = RATE * 135;                   // 135 s d'audio en mémoire (une période WSPR = 2 min)
const ring = new Float32Array(RING);
let written = 0;                           // nombre total d'échantillons reçus
let base = null;                           // heure (s, époque UNIX) de l'échantillon n° 0
let latency = 0.15;                        // délai capture + réseau estimé (s), ajusté d'après le DT des décodages
let modes = new Set();
const rtty = new Map();                    // clé → { demod, lvlAt } : un démodulateur RTTY par réglage demandé
const cw = new Map();                      // clé → { dec, lvlAt } : un décodeur CW par réglage demandé
const done = { FT8: 0, FT4: 0, FT2: 0, WSPR: 0, JT65: 0 };
// Décodage anticipé (comme WSJT-X) : dès la fin d'un signal parti à l'heure (0,5 s + durée + marge), sans attendre
// la fin de la fenêtre d'analyse — la réponse peut partir dans la période suivante. Le décodage complet suit et
// n'ajoute que les messages nouveaux.
const EARLY_AT = { FT8: 0.5 + 12.64 + 0.3, FT4: 0.5 + 5.04 + 0.3 };
const early = { FT8: 0, FT4: 0 };
const earlySeen = { FT8: new Set(), FT4: new Set() };           // dernière période décodée (ms)
const dtHist = [];                         // DT récents, pour recaler le délai

// ------------------------------------------------------------------ cascade
const wfBlock = ftx.wfBlock();
const wfBuf = new Float32Array(wfBlock);
let wfN = 0;
const WF_F0 = ftx.wfF0();
// Cascade fine (comme JTDX) : FFT de 8192 points (1,46 Hz par case), fenêtre de Hann, une ligne toutes les 160 ms,
// 0–4000 Hz ; chaque ligne porte l'heure de capture (repères de période dans la cascade)
const WFN = 8192;
const WF_DF = RATE / WFN;
const WF_BINS = Math.ceil(4000 / WF_DF); // 0–4000 Hz (cascade RTTY « bande 4 kHz » ; les autres onglets n’en affichent que 3000)
const wfWin = new Float32Array(WFN).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WFN - 1)));
const wfRe = new Float32Array(WFN), wfIm = new Float32Array(WFN);
const wfRev = (() => { const r = new Uint16Array(WFN); const bits = Math.log2(WFN); for (let i = 0; i < WFN; i++) { let x = i, y = 0; for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; } r[i] = y; } return r; })();
const wfCos = new Float32Array(WFN / 2).map((_, i) => Math.cos((-2 * Math.PI * i) / WFN));
const wfSin = new Float32Array(WFN / 2).map((_, i) => Math.sin((-2 * Math.PI * i) / WFN));
const WF_AVG = 5; // 5 lignes de 160 ms ≈ 0,8 s
const wfPow = Array.from({ length: WF_AVG }, () => new Float32Array(WF_BINS));
let wfPi = 0, wfPn = 0;
const WIN_GAIN = 10 * Math.log10((WFN * 0.5) * (WFN * 0.5)); // normalisation (somme de la fenêtre)²
function wfFine(end) {
  if (end < WFN) return null; // pas encore assez d'audio pour une ligne complète
  // end : nombre d'échantillons reçus ; on prend les WFN derniers dans l'anneau
  for (let i = 0; i < WFN; i++) {
    const k = end - WFN + i;
    const v = k >= 0 ? ring[k % RING] : 0;
    const j = wfRev[i];
    wfRe[j] = v * wfWin[i];
    wfIm[j] = 0;
  }
  for (let size = 2; size <= WFN; size <<= 1) {
    const half = size >> 1, step = WFN / size;
    for (let s = 0; s < WFN; s += size) {
      for (let k = 0; k < half; k++) {
        const c = wfCos[k * step], sn = wfSin[k * step];
        const a = s + k, b = a + half;
        const tr = wfRe[b] * c - wfIm[b] * sn, ti = wfRe[b] * sn + wfIm[b] * c;
        wfRe[b] = wfRe[a] - tr; wfIm[b] = wfIm[a] - ti;
        wfRe[a] += tr; wfIm[a] += ti;
      }
    }
  }
  // Moyenne des WF_AVG derniers spectres (comme « Avg » de JTDX) : bruit plus lisse, un signal FT8 devient un bloc plein
  const cur = wfPow[wfPi];
  wfPi = (wfPi + 1) % WF_AVG;
  for (let k = 0; k < WF_BINS; k++) cur[k] = wfRe[k] * wfRe[k] + wfIm[k] * wfIm[k];
  if (wfPn < WF_AVG) wfPn++;
  const row = new Uint8Array(WF_BINS);
  for (let k = 0; k < WF_BINS; k++) {
    let p = 0;
    for (let a = 0; a < wfPn; a++) p += wfPow[a][k];
    p /= wfPn;
    const db = 10 * Math.log10(p + 1e-20) - WIN_GAIN;
    const v = Math.round(db * 2 + 240);
    row[k] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return row;
}

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
      const end = written + i + 1;
      const row = wfFine(end);
      if (!row) continue;
      const at = Math.round((base + end / RATE) * 1000); // heure de capture du dernier échantillon (ms)
      parentPort.postMessage({ t: 'wf', row, f0: 0, df: WF_DF, at }, [row.buffer]);
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
  if (sstv) sstv.process(samples);
  // CW : décodage en continu
  for (const [key, r] of cw) {
    const text = r.dec.process(samples);
    if (text) parentPort.postMessage({ t: 'cw_text', key, text });
    if (now - r.lvlAt > 150) {
      r.lvlAt = now;
      const l = r.dec.levels();
      parentPort.postMessage({ t: 'cw_lvl', key, s: l.s, wpm: l.wpm, on: l.on });
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
    if (mode === 'FT2') { tickFt2(newest); continue; }
    if ((mode === 'FT8' || mode === 'FT4') && wsj.ok()) { tickWsj(mode, newest); continue; }
    const g = ftx.geometry(mode);
    const L = g.slot * 1000;
    const dur = (g.block * g.blocks) / RATE;
    // Décodage anticipé de la période en cours
    if (EARLY_AT[mode]) {
      const es = Math.floor((newest - EARLY_AT[mode]) * 1000 / L) * L;
      if (es > early[mode] && es > done[mode] && Date.now() - es < 2 * L) {
        early[mode] = es;
        if (!ftBusy[mode]) {
          const n = Math.min(g.block * g.blocks, Math.max(0, Math.round((newest - es / 1000) * RATE)));
          const t0 = Date.now();
          ftBusy[mode]++;
          decodeFt(mode, extract(es / 1000, n), es, 'early').then(({ list }) => {
            ftBusy[mode]--;
            earlySeen[mode] = new Set(list.map((d) => d.msg));
            earlySeen[mode].slot = es;
            if (list.length) parentPort.postMessage({ t: 'decodes', mode, slot: es, list, ms: Date.now() - t0, latency: Math.round(latency * 1000), early: true });
          }, () => { ftBusy[mode]--; });
        }
      }
    }
    // Période terminée la plus récente dont tout l'audio est arrivé
    let slot = Math.floor((newest - dur) * 1000 / L) * L;
    if (slot <= done[mode]) continue;
    if (Date.now() - slot > 3 * L) { done[mode] = slot; continue; } // trop ancien
    done[mode] = slot;
    const t0 = Date.now();
    ftBusy[mode]++;
    decodeFt(mode, extract(slot / 1000, g.block * g.blocks), slot, 'final').then(({ list, engine }) => {
      ftBusy[mode]--;
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
      // Messages déjà donnés par le décodage anticipé : pas répétés
      const seen = earlySeen[mode] && earlySeen[mode].slot === slot ? earlySeen[mode] : null;
      const fresh = seen ? list.filter((d) => !seen.has(d.msg)) : list;
      parentPort.postMessage({ t: 'decodes', mode, slot, list: fresh, ms: Date.now() - t0, latency: Math.round(latency * 1000), engine });
    }, () => { ftBusy[mode]--; });
  }
}
// ------------------------------------------------------------------ FT8 / FT4 avec le moteur WSJT-X
// FT8, comme WSJT-X : passe anticipée à 11,8 s d'audio (stade 41 : la réponse peut partir à la période suivante),
// passe normale à 14,4 s (stade 50, signaux de la passe anticipée soustraits), puis passe profonde multi-passes
// (MTD, type JTDX) sur la période complète, qui ajoute les signaux les plus faibles.
// FT4 : une passe à la fin de la fenêtre d'analyse (6,05 s). Chaque message n'est envoyé qu'une fois par période.
const W_AT = { FT8: { early: 141696, normal: 172800, deep: 180000 }, FT4: { normal: 72576 } };
const wsjSlots = { FT8: new Map(), FT4: new Map() };
let deepBusy = 0;   // période (ms) → { id, done:Set(phases), seen:Set(messages) }
function tickWsj(mode, newest) {
  const L = (mode === 'FT8' ? 15 : 7.5) * 1000;
  const map = wsjSlots[mode];
  const cur = Math.floor(newest * 1000 / L) * L;
  for (const slot of [cur - L, cur]) {
    if (Date.now() - slot > 3 * L) continue; // trop ancien (audio arrivé en retard)
    const have = Math.round((newest - slot / 1000) * RATE); // échantillons de la période déjà reçus
    let st = map.get(slot);
    for (const ph of ['early', 'normal', 'deep']) {
      const need = W_AT[mode][ph];
      if (!need || have < need) continue;
      if (!st) { st = { id: 0, done: new Set(), seen: new Set() }; map.set(slot, st); }
      if (st.done.has(ph)) continue;
      st.done.add(ph);
      // Machine trop lente : la passe anticipée est sautée si la précédente n'est pas finie ; la profonde aussi
      const deep = ph === 'deep';
      if (deep && (deepBusy || !wsjDeep.ok())) continue;
      if (ph === 'early' && ftBusy[mode] > 1) continue;
      if (ph === 'normal' && !st.id) st.id = wsj.newId();
      if (ph === 'early') st.id = wsj.newId();
      const t0 = Date.now();
      if (deep) deepBusy++; else ftBusy[mode]++;
      const id = deep ? 0 : st.id;
      // Passes anticipée et normale en profondeur 2 (rapides : la réponse peut partir à la période suivante) ;
      // la passe profonde (profondeur 3 + MTD) ajoute ensuite les signaux les plus faibles
      const depth = mode === 'FT8' && !deep ? 2 : 3;
      (deep ? wsjDeep : wsj).decode(mode, extract(slot / 1000, need), Object.assign({}, apCtx, { phase: ph, id, utc: utcOf(slot), depth })).then((r) => {
        if (deep) deepBusy--; else ftBusy[mode]--;
        if (ph === 'normal') recalDt(r.list);
        const fresh = r.list.filter((d) => !st.seen.has(d.msg));
        for (const d of fresh) st.seen.add(d.msg);
        // La passe normale est toujours envoyée (même vide) : elle marque la fin de la période pour l'affichage
        parentPort.postMessage({ t: 'decodes', mode, slot, list: fresh, ms: Date.now() - t0, latency: Math.round(latency * 1000), early: ph === 'early', engine: 'wsjtx', phase: ph });
      }, () => {
        if (deep) deepBusy--; else ftBusy[mode]--;
        // Moteur indisponible : ft8_lib pour cette période (passe normale seulement)
        if (ph !== 'normal') return;
        const list = ftx.decode(mode, extract(slot / 1000, ftx.geometry(mode).block * ftx.geometry(mode).blocks)).filter((d) => !st.seen.has(d.msg));
        for (const d of list) st.seen.add(d.msg);
        parentPort.postMessage({ t: 'decodes', mode, slot, list, ms: Date.now() - t0, latency: Math.round(latency * 1000), engine: 'ft8_lib' });
      });
    }
  }
  for (const k of map.keys()) if (k < cur - 4 * L) map.delete(k);
}
// Recalage automatique : le DT médian d'une bande active est proche de 0 (stations synchronisées)
function recalDt(list) {
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
}
// FT2 (Decodium) : périodes de 3,75 s, mais beaucoup de stations émettent en « asynchrone » (à n'importe quel
// moment). ft8_lib : fenêtres de 3,75 s analysées toutes les 1,25 s : chaque signal (2,5 s) tient entier dans l'une d'elles.
// Doublons retirés (même message, même fréquence à 20 Hz près, moins de 3 s d'écart).
// Avec le moteur WSJT-X (FT4 étiré ×2, fenêtre de 3,024 s qui accepte un départ entre 0 et 0,75 s) : toutes les 0,5 s.
const ft2Seen = [];
function tickFt2(newest) {
  const g = ftx.geometry('FT2');
  const L = g.slot * 1000;
  const W = wsj.ok();
  const FT2_STEP = W ? 500 : 1250;
  const n = W ? 36288 : g.block * g.blocks;
  const dur = n / RATE;
  const win = Math.floor((newest - dur) * 1000 / FT2_STEP) * FT2_STEP;
  if (win <= done.FT2) return;
  if (Date.now() - win > 4 * L) { done.FT2 = win; return; }
  done.FT2 = win;
  if (ftBusy.FT2 > 1) return; // machine trop lente : fenêtre sautée
  const t0 = Date.now();
  ftBusy.FT2++;
  decodeFt('FT2', extract(win / 1000, n), win, 'final').then(({ list }) => { ftBusy.FT2--; ft2Done(win, list, t0); }, () => { ftBusy.FT2--; });
}
function ft2Done(win, raw, t0) {
  const L = ftx.geometry('FT2').slot * 1000;
  const now = win;
  while (ft2Seen.length && ft2Seen[0].at < now - 6000) ft2Seen.shift();
  const bySlot = new Map();
  for (const d of raw) {
    const start = win + d.t * 1000;                  // début du signal (ms, époque)
    if (ft2Seen.some((s) => s.msg === d.msg && Math.abs(s.f - d.f) < 20 && Math.abs(s.start - start) < 3000)) continue;
    ft2Seen.push({ msg: d.msg, f: d.f, start, at: now });
    const slot = Math.floor((start - 250) / L) * L;  // période dont le signal part (tolérance : 250 ms avant)
    const it = { db: d.db, dt: Math.round((start - slot) / 100 - 5) / 10, f: d.f, msg: d.msg, ap: d.ap || 0 };
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(it);
  }
  for (const [slot, list] of bySlot) {
    list.sort((p, q) => p.f - q.f);
    parentPort.postMessage({ t: 'decodes', mode: 'FT2', slot, list, ms: Date.now() - t0, latency: Math.round(latency * 1000) });
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
    modes = new Set((m.modes || []).filter((x) => ['FT8', 'FT4', 'FT2', 'WSPR', 'JT65'].indexOf(x) >= 0));
    if ((m.modes || []).indexOf('JTTY') >= 0) { if (!jtty.proc && !jtty.start()) parentPort.postMessage({ t: 'log', msg: 'JTTY : décodeur indisponible (lib/bin/jttyd ou jttyd.exe : Linux ou Windows x86-64 requis)' }); }
    else if (jtty.proc) jtty.stop();
    if ((m.modes || []).indexOf('SSTV') >= 0) { if (!sstv) sstv = new SstvDecoder(sstvEvent); }
    else if (sstv) { if (sstv.img) sstv.endImage(false, 'fenêtre fermée'); sstv = null; }
  }
  else if (m.t === 'dial' && Number.isFinite(m.hz)) dialHz = m.hz;
  else if (m.t === 'latency' && Number.isFinite(m.ms)) latency = m.ms / 1000;
  else if (m.t === 'ap') apCtx = { mycall: m.mycall, hiscall: m.hiscall, mygrid: m.mygrid, hisgrid: m.hisgrid, qp: m.qp, rx: m.rx, tx: m.tx };
  else if (m.t === 'rtty') {
    const want = new Map((m.cfgs || []).map((c) => [c.key, c]));
    for (const k of Array.from(rtty.keys())) if (!want.has(k)) rtty.delete(k);
    for (const [k, c] of want) if (!rtty.has(k)) rtty.set(k, { demod: new RttyDemod(Object.assign({ rate: RATE }, c)), lvlAt: 0 });
  }
  else if (m.t === 'cw') {
    const want = new Map((m.cfgs || []).map((c) => [c.key, c]));
    for (const k of Array.from(cw.keys())) if (!want.has(k)) cw.delete(k);
    for (const [k, c] of want) if (!cw.has(k)) cw.set(k, { dec: new CwDecoder(Object.assign({ rate: RATE }, c)), lvlAt: 0 });
  }
  else if (m.t === 'reset') { base = null; written = 0; }
});
