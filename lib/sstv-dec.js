'use strict';
/*
 * sstv-dec.js — décodeur SSTV en continu (12 kHz), sans dépendance.
 *
 * 1. Démodulation FM : mélange complexe à 1750 Hz, passe-bas FIR, écart de phase entre échantillons
 *    → fréquence instantanée.
 * 2. Code VIS : moyennes de 10 ms ; amorce 1900 Hz, bit de départ 1200 Hz, 7 bits (1100 = 1, 1300 = 0),
 *    parité paire, bit d'arrêt. Le décalage de l'amorce (TRX mal calé) est corrigé sur toute l'image.
 * 3. Image : chaque synchro (1200 Hz) est recherchée autour de sa place prévue ; les synchros trouvées
 *    donnent la durée réelle d'une ligne (régression linéaire : correction de pente si les horloges de la
 *    carte son et du codeur diffèrent). Les lignes sont rendues au fur et à mesure, puis l'image entière
 *    est recalculée à la fin avec la pente définitive.
 *
 * Événements : onEvent({ t:'start', id, mode, name, w, h }) · ({ t:'line', id, y, rgb }) ·
 *              ({ t:'end', id, ok, lines, rgb? (image recalculée) })
 */
const SSTV = require('../public/js/sstv.js');

const RATE = 12000;
const F0 = 1750;
const NTAP = 41;

function lowpass(n, fc) {
  const h = new Float64Array(n);
  const m = (n - 1) / 2;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const x = i - m;
    const sinc = x === 0 ? 2 * fc / RATE : Math.sin(2 * Math.PI * fc / RATE * x) / (Math.PI * x);
    h[i] = sinc * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (n - 1)));
    s += h[i];
  }
  for (let i = 0; i < n; i++) h[i] /= s;
  return h;
}

class SstvDecoder {
  constructor(onEvent) {
    this.on = onEvent || (() => {});
    this.h = lowpass(NTAP, 850);
    this.re = new Float64Array(NTAP);
    this.im = new Float64Array(NTAP);
    this.k = 0;
    this.ph = 0;
    this.dph = 2 * Math.PI * F0 / RATE;
    this.pre = 0;
    this.pim = 0;
    this.n = 0;               // échantillons traités (index absolu)
    this.last = -1;           // dernier échantillon de fréquence disponible
    // Historique de fréquence (8 s) pour le VIS ; pendant une image, toute l'image est gardée
    this.RING = RATE * 8;
    this.ring = new Float32Array(this.RING);
    this.raw = new Float32Array(this.RING);   // audio brut (bits du VIS par détection de tonalité)
    // VIS : moyennes de 10 ms
    this.binBuf = new Float32Array(120);
    this.binN = 0;
    this.bins = [];           // { f, n: index du dernier échantillon }
    this.lastVis = -1e9;
    this.img = null;
    this.seq = 0;
    this.level = 0;
  }

  freqAt(i) {
    // Fréquence à l'échantillon absolu i (ou NaN si hors de l'historique)
    if (!(i <= this.last)) return NaN;
    const im = this.img;
    if (im && i >= im.s0 && i - im.s0 < im.buf.length) return im.buf[i - im.s0];
    if (i < this.last - this.RING + 1) return NaN;
    return this.ring[i % this.RING];
  }

  process(x) {
    const h = this.h;
    for (let j = 0; j < x.length; j++) {
      const v = x[j];
      this.raw[this.n % this.RING] = v;
      this.level += (v * v - this.level) * 0.001;
      this.re[this.k] = v * Math.cos(this.ph);
      this.im[this.k] = -v * Math.sin(this.ph);
      this.ph += this.dph;
      if (this.ph > 2 * Math.PI) this.ph -= 2 * Math.PI;
      let a = 0;
      let b = 0;
      let idx = this.k;
      for (let t = 0; t < NTAP; t++) {
        a += h[t] * this.re[idx];
        b += h[t] * this.im[idx];
        if (--idx < 0) idx = NTAP - 1;
      }
      this.k = (this.k + 1) % NTAP;
      // Écart de phase : arg(z[n] · conj(z[n-1]))
      const dr = a * this.pre + b * this.pim;
      const di = b * this.pre - a * this.pim;
      this.pre = a;
      this.pim = b;
      let f = F0 + Math.atan2(di, dr) * RATE / (2 * Math.PI);
      if (!(f > 800 && f < 2700)) f = f > 2700 ? 2700 : 800;
      // Le filtre retarde le signal de (NTAP-1)/2 échantillons : on date la fréquence en conséquence
      const i = this.n - (NTAP - 1) / 2;
      this.last = i;
      this.ring[(i + this.RING) % this.RING] = f;
      if (this.img && i >= this.img.s0 && i - this.img.s0 < this.img.buf.length) this.img.buf[i - this.img.s0] = f;
      this.n++;
      // Médiane par 10 ms : insensible aux « clics » du discriminateur sur les signaux faibles
      this.binBuf[this.binN] = f;
      if (++this.binN === 120) {
        this.binBuf.sort();
        this.bins.push({ f: (this.binBuf[59] + this.binBuf[60]) / 2, n: i });
        if (this.bins.length > 120) this.bins.shift();
        this.binN = 0;
        this.checkVis();
      }
    }
    if (this.img) this.renderReady();
  }

  // ------------------------------------------------------------------ VIS
  checkVis() {
    const B = this.bins;
    const n = B.length - 1;
    // Milieu du bit d'arrêt = avant-dernière case ; milieu du bit k = n - 1 - 3·(9 - k)
    const mid = (k) => n - 1 - 3 * (9 - k);
    if (mid(0) - 22 < 0) return;
    if (B[n].n - this.lastVis < RATE) return;
    // Amorce : ~200 ms à 1900 Hz (± décalage) avant le bit de départ
    const lead = [];
    for (let i = mid(0) - 22; i <= mid(0) - 3; i++) lead.push(B[i].f);
    lead.sort((p, q) => p - q);
    const lf = lead[lead.length >> 1];
    const shift = lf - 1900;
    if (Math.abs(shift) > 200) return;
    let good = 0;
    for (const f of lead) if (Math.abs(f - lf) < 80) good++;
    if (good < lead.length * 0.6) return;
    const near = (f, t, tol) => Math.abs(f - shift - t) < tol;
    for (const k of [0, 9]) if (!near(B[mid(k)].f, 1200, 110)) return;
    for (let k = 1; k <= 8; k++) { const f = B[mid(k)].f - shift; if (f < 950 || f > 1450) return; }
    // Front précis du bit de départ (passage de 1900 à 1200 Hz), lissé sur 2 ms
    const approx = B[mid(0)].n - 180; // ~ début du bit de départ
    const thr = 1550 + shift;
    let edge = approx;
    let best = 1e9;
    for (let i = approx - 240; i <= approx + 240; i++) {
      let s = 0;
      for (let d = -12; d < 12; d++) s += this.freqAt(i + d);
      s /= 24;
      const e = Math.abs(s - thr);
      if (e < best) { best = e; edge = i; }
    }
    // Bits : énergie à 1100 et 1300 Hz (+ décalage) sur les 20 ms centrales de chaque bit
    const E = (c, f) => this.tone(c - 120, 240, f + shift);
    const c0 = edge + 180;
    if (E(c0, 1200) < E(c0, 1900) || E(c0 + 9 * 360, 1200) < E(c0 + 9 * 360, 1500)) return;
    let code = 0;
    let ones = 0;
    for (let k = 1; k <= 8; k++) {
      const c = c0 + k * 360;
      const bit = E(c, 1100) > E(c, 1300) ? 1 : 0;
      if (k <= 7) code |= bit << (k - 1);
      ones += bit;
    }
    if (ones % 2) return; // parité paire (bits de données + parité)
    const id = SSTV.BY_VIS[code];
    if (!id) return;
    this.lastVis = B[n].n;
    // Décalage précis : fréquence de l'amorce mesurée sur l'audio (200 ms avant le bit de départ) ;
    // la médiane du discriminateur peut être tirée par un signal voisin
    let bf = 1900 + shift;
    let be = -1;
    const e = [];
    for (let f = 1700; f <= 2100; f += 2) { const v = this.tone(edge - 2520, 2400, f); e.push(v); if (v > be) { be = v; bf = f; } }
    const k = (bf - 1700) / 2;
    if (k > 0 && k < e.length - 1) { const a = e[k - 1], b = e[k], c = e[k + 1]; const d = a - 2 * b + c; if (d < 0) bf += ((a - c) / (2 * d)) * 2; }
    const sh = bf - 1900;
    this.startImage(id, edge + 0.3 * RATE, Math.abs(sh - shift) < 80 ? sh : shift);
  }

  // Énergie (Goertzel) de la tonalité f sur n échantillons d'audio brut à partir de l'échantillon i
  tone(i, n, f) {
    if (i < this.n - this.RING || i + n > this.n) return 0;
    const w = 2 * Math.cos(2 * Math.PI * f / RATE);
    let s1 = 0;
    let s2 = 0;
    for (let k = 0; k < n; k++) {
      const s0 = this.raw[(i + k) % this.RING] + w * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return s1 * s1 + s2 * s2 - w * s1 * s2;
  }

  // ------------------------------------------------------------------ image
  startImage(id, t0, shift) {
    if (this.img) this.endImage(false, 'nouvelle image');
    const m = SSTV.MODES[id];
    const syncs = m.h / m.rows;
    const spl = (m.line / 1000) * RATE;
    const firstExtra = m.first ? (m.first[0][1] / 1000) * RATE : 0;
    const len = Math.ceil(firstExtra + spl * syncs * 1.02 + RATE * 2);
    const s0 = Math.floor(t0 - RATE);
    const buf = new Float32Array(len + RATE);
    // Recopie de ce qui est déjà reçu depuis s0
    for (let i = s0; i <= this.last; i++) { const f = this.freqAt(i); if (f === f) buf[i - s0] = f; }
    this.img = {
      id: ++this.seq, mode: id, m, s0, buf, t0: t0 + firstExtra, shift, spl, syncs,
      pts: [],             // [ligne, début mesuré]
      next: 0,             // prochaine ligne radio à rendre
      miss: 0,
      rgb: new Uint8Array(m.w * m.h * 3),
      chroma: null
    };
    this.on({ t: 'start', id: this.img.id, mode: id, name: m.name, w: m.w, h: m.h, shift: Math.round(shift) });
  }

  // Début prévu de la ligne radio i (échantillons) d'après les synchros trouvées
  predict(i) {
    const im = this.img;
    const p = im.pts;
    if (p.length >= 4) {
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const [x, y] of p) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
      const n = p.length;
      const d = n * sxx - sx * sx;
      if (d > 0) {
        const b = (n * sxy - sx * sy) / d;
        if (Math.abs(b / im.spl - 1) < 0.01) return { a: (sy - b * sx) / n, b };
      }
    }
    if (p.length) { const [x, y] = p[p.length - 1]; return { a: y - x * im.spl, b: im.spl }; }
    return { a: im.t0, b: im.spl };
  }

  // Recherche de la synchro de la ligne i autour de sa place prévue ; renvoie le début de ligne mesuré ou null
  findSync(i, P) {
    const im = this.img;
    const m = im.m;
    const len = Math.round((m.sync / 1000) * RATE);
    const off = Math.round((m.syncAt / 1000) * RATE * (P.b / im.spl));
    const W = Math.round(RATE * (i < 2 ? 0.025 : 0.006));
    const c = P.a + i * P.b;
    const thr = 1350 + im.shift;
    const g = (f) => { const v = (thr - f) / 120; return v > 1 ? 1 : v < -1 || v !== v ? -1 : v; };
    // Gabarit : +1 pendant la synchro, -1 juste après (palier puis image, jamais à 1200 Hz) : le front
    // de fin de synchro fixe la position, même collée au bit d'arrêt du VIS (ligne 0)
    const len2 = Math.max(6, Math.round(len / 2));
    let best = -1e9;
    let bi = 0;
    const start = Math.round(c) - W + off;
    let s1 = 0;
    let s2 = 0;
    for (let k = 0; k < len; k++) s1 += g(this.freqAt(start + k));
    for (let k = 0; k < len2; k++) s2 += g(this.freqAt(start + len + k));
    for (let t = start; t <= start + 2 * W; t++) {
      const sc = s1 - s2;
      if (sc > best) { best = sc; bi = t; }
      const a = g(this.freqAt(t + len));
      s1 += a - g(this.freqAt(t));
      s2 += g(this.freqAt(t + len + len2)) - a;
    }
    if (!(best === best) || best < (len + len2) * 0.45) return null;
    return bi - off;
  }

  renderReady() {
    const im = this.img;
    while (im && im.next < im.syncs) {
      const i = im.next;
      const P = this.predict(i);
      const end = P.a + (i + 1) * P.b + RATE * 0.03;
      if (end >= this.last) return; // pas encore reçu
      const st = this.findSync(i, P);
      if (st != null) {
        const pr = P.a + i * P.b;
        if (im.pts.length < 4 || Math.abs(st - pr) < RATE * 0.004) im.pts.push([i, st]);
        im.miss = 0;
      } else im.miss++;
      const P2 = this.predict(i);
      const ls = im.pts.length >= 4 ? P2.a + i * P2.b : (st != null ? st : P2.a + i * P2.b);
      this.renderLine(i, ls, P2.b / im.spl, true);
      im.next++;
      // Plus aucune synchro depuis ~20 s : le signal est perdu (QRM ou QSB plus courts : l'image continue)
      if (im.miss * im.m.line > 20000 && im.miss >= 8) { this.endImage(false, 'signal perdu'); return; }
    }
    if (im && im.next >= im.syncs) this.endImage(true);
  }

  // Valeur (0..255) moyenne d'un point entre les instants a et b (échantillons)
  val(a, b) {
    const im = this.img;
    let i0 = Math.round(a);
    let i1 = Math.round(b);
    if (i1 < i0) i1 = i0;
    let s = 0;
    let n = 0;
    for (let i = i0; i <= i1; i++) {
      const f = this.freqAt(i);
      if (f === f) { s += f; n++; }
    }
    if (!n) return 0;
    const v = ((s / n - im.shift - 1500) / 800) * 255;
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  renderLine(i, ls, scale, emit) {
    const im = this.img;
    const m = im.m;
    const W = m.w;
    const ch = {};
    for (const c of m.chans) {
      const arr = new Float32Array(W);
      const at = ls + (c.at / 1000) * RATE * scale;
      const px = ((c.len / 1000) * RATE * scale) / W;
      if (c.c === 'SEP') { ch.SEP = this.val(at + px * W * 0.2, at + px * W * 0.8); continue; }
      // Partie centrale de chaque point (les bords sont adoucis par le filtre du démodulateur)
      for (let x = 0; x < W; x++) arr[x] = this.val(at + px * (x + 0.2), at + px * (x + 0.8));
      // Derniers points : le filtre du démodulateur y mélange déjà le palier ou la synchro suivante
      const e = Math.min(W - 1, Math.ceil(RATE * 0.0006 / px));
      for (let x = W - e; x < W; x++) arr[x] = arr[W - e - 1];
      ch[c.c] = arr;
    }
    const rows = [];
    if (!m.yuv) {
      const row = new Uint8Array(W * 3);
      for (let x = 0; x < W; x++) { row[x * 3] = ch.R[x]; row[x * 3 + 1] = ch.G[x]; row[x * 3 + 2] = ch.B[x]; }
      rows.push([i, row]);
    } else if (m.yuv === 'PD') {
      for (const [y, Y] of [[2 * i, ch.Y], [2 * i + 1, ch.Y1]]) {
        const row = new Uint8Array(W * 3);
        for (let x = 0; x < W; x++) { const c = SSTV.ycc2rgb(Y[x], ch.CB[x], ch.CR[x]); row[x * 3] = c[0]; row[x * 3 + 1] = c[1]; row[x * 3 + 2] = c[2]; }
        rows.push([y, row]);
      }
    } else {
      let cr = ch.CR;
      let cb = ch.CB;
      if (m.yuv === 'R36') {
        // Séparateur à 1500 Hz : R-Y ; à 2300 Hz : B-Y ; l'autre composante vient de la ligne précédente
        const isCb = ch.SEP != null ? ch.SEP > 128 : i % 2 === 1;
        const prev = im.chroma || { CR: new Float32Array(W).fill(128), CB: new Float32Array(W).fill(128) };
        if (isCb) { cb = ch.C; cr = prev.CR; } else { cr = ch.C; cb = prev.CB; }
        im.chroma = { CR: cr, CB: cb };
      }
      const row = new Uint8Array(W * 3);
      for (let x = 0; x < W; x++) { const c = SSTV.ycc2rgb(ch.Y[x], cb[x], cr[x]); row[x * 3] = c[0]; row[x * 3 + 1] = c[1]; row[x * 3 + 2] = c[2]; }
      rows.push([i, row]);
    }
    for (const [y, row] of rows) {
      if (y >= m.h) continue;
      im.rgb.set(row, y * W * 3);
      if (emit) this.on({ t: 'line', id: im.id, y, rgb: row });
    }
  }

  endImage(ok, why) {
    const im = this.img;
    if (!im) return;
    let rgb;
    if (ok && im.pts.length >= 4) {
      // Image recalculée avec la pente finale (lignes droites même si les premières étaient décalées)
      const P = this.predict(0);
      im.chroma = null;
      for (let i = 0; i < im.syncs; i++) this.renderLine(i, P.a + i * P.b, P.b / im.spl, false);
      rgb = im.rgb;
    }
    const lines = Math.min(im.m.h, im.next * im.m.rows);
    this.img = null;
    this.on({ t: 'end', id: im.id, ok, why, lines, rgb, slant: im.pts.length >= 4 ? Math.round((this.predictOf(im).b / im.spl - 1) * 1e6) : null });
  }
  predictOf(im) {
    const save = this.img;
    this.img = im;
    const P = this.predict(0);
    this.img = save;
    return P;
  }
}

module.exports = { SstvDecoder };
