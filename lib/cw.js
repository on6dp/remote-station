'use strict';
/*
 * cw.js — décodeur CW (Morse) et générateur de test, sans dépendance.
 * Voir CwOne (un décodeur) et CwDecoder (trois plages de vitesse en parallèle) plus bas.
 * Banc d'essai (bruit blanc, SNR dans 2500 Hz, 10 à 40 mots/min, main humaine, QSB, QRM, QRN) : taux d'erreur
 * moyen ramené de 86 % à 18 % ; à −6 dB, 0 à 4 % d'erreurs de 10 à 30 mots/min (l'ancien décodeur : 64 à 92 %).
 */

const MORSE = {
  '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F', '--.': 'G', '....': 'H', '..': 'I',
  '.---': 'J', '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R',
  '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X', '-.--': 'Y', '--..': 'Z',
  '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4', '.....': '5', '-....': '6', '--...': '7',
  '---..': '8', '----.': '9',
  '.-.-.-': '.', '--..--': ',', '..--..': '?', '-..-.': '/', '-...-': '=', '.-.-.': '+', '-....-': '-',
  '---...': ':', '.----.': '\'', '-.--.-': ')', '.-..-.': '"', '.--.-.': '@', '-.-.-.': ';', '-.-.--': '!',
  '...-.-': '<SK>', '-.--.': '<KN>', '.-...': '<AS>', '-.-.-': '<KA>', '...-.': '<SN>', '........': '<HH>',
  '.-.-': 'Ä', '---.': 'Ö', '..--': 'Ü', '.--.-': 'À', '..-..': 'É'
};
const TO_MORSE = {};
for (const k of Object.keys(MORSE)) if (!TO_MORSE[MORSE[k]]) TO_MORSE[MORSE[k]] = k;

const TICK = 24; // échantillons par mesure (2 ms à 12 kHz)

/*
 * Un décodeur, pour une plage de vitesses :
 *  1. mélange complexe sur la tonalité suivie (AFC : se recale sur le signal, jusqu'à ± 25 à 80 Hz du réglage) ;
 *  2. filtre large (largeur choisie, 2 moyennes glissantes), puis filtre « adapté » à la vitesse : moyenne cohérente
 *     sur 0,8 point (environ 1 / point de bande : le gain de l'oreille sur un signal faible) ;
 *  3. décision top / silence : seuil entre la moyenne des silences et celle des tops, hystérésis, anti-rebond
 *     de 0,35 point (parasites, creux d'un top) ;
 *  4. vitesse : 30e centile des durées récentes (tops et silences : la plupart valent un point) ;
 *  5. lettres : point / trait à 2 points, fin de lettre après 2,2 points de silence, espace après 5,2 points.
 * Le silencieux (dB) ne coupe que l'affichage : le décodeur suit le signal en permanence.
 */
class CwOne {
  constructor(o) {
    this.rate = o.rate || 12000;
    this.f0 = o.f;
    this.fc = o.f;
    this.ph = 0;
    const bw = o.bw || 100;
    this.afcSpan = Math.max(25, Math.min(80, bw * 0.6));
    this.nw = Math.max(4, Math.round(this.rate / Math.max(bw, 60) / 2));
    this.b1 = new Float64Array(this.nw * 2);
    this.b2 = new Float64Array(this.nw * 2);
    this.s1 = [0, 0];
    this.s2 = [0, 0];
    this.p1 = 0;
    this.p2 = 0;
    this.k = 0;
    this.tickMs = (TICK / this.rate) * 1000;
    this.squelch = Number.isFinite(o.squelch) ? o.squelch : 5;
    this.zr = new Float64Array(128);
    this.zi = new Float64Array(128);
    this.zp = 0;
    this.lastR = 0;
    this.lastI = 0;
    this.n = 0;
    this.N = 0;
    this.V = 0;
    this.M = 0;
    this.on = false;
    this.raw = false;
    this.cand = false;
    this.candN = 0;
    this.dur = 0;
    this.minDit = o.minDit || 18;
    this.maxDit = o.maxDit || 240;
    this.dit = o.dit0 || 60;
    this.code = '';
    this.wordDone = true;
    this.snr = 0;
    this.marks = [];
    this.allG = [];
    this.qs = [];   // qualité de chaque top (cohérence de sa durée), pour choisir le meilleur décodeur
    this.chq = [];  // lettres décodées [mesure, lettre]
    this.mk = null;
  }
  levels() { return { s: Math.round(this.snr), wpm: Math.round(1200 / this.dit), on: this.on && this.open(), f: Math.round(this.fc) }; }
  open() { return this.snr >= this.squelch; }
  _char() {
    if (!this.code) return;
    const ch = MORSE[this.code];
    if (!ch) this.qs.push([this.n, -1]);
    this.code = '';
    if (!this.open()) return; // silencieux fermé : rien n'est affiché
    this.chq.push([this.n, ch || '*']);
    if (this.chq.length > 300) this.chq.shift();
    this.wordDone = false;
  }
  _learn(d) {
    const m = this.marks;
    m.push(d);
    if (m.length > 16) m.shift();
    const all = m.concat(this.allG);
    if (all.length < 8) return;
    all.sort((a, b) => a - b);
    const p = all[Math.floor(all.length * 0.3)];
    this.dit += (Math.max(this.minDit, Math.min(this.maxDit, p)) - this.dit) * 0.35;
  }
  _tick(zr, zi) {
    const p = this.zp = (this.zp + 1) & 127;
    this.zr[p] = zr;
    this.zi[p] = zi;
    const L = Math.max(2, Math.min(100, Math.round((this.dit * 0.8) / this.tickMs)));
    let sr = 0, si = 0;
    for (let i = 0; i < L; i++) { const q = (p - i) & 127; sr += this.zr[q]; si += this.zi[q]; }
    sr /= L;
    si /= L;
    const env = Math.hypot(sr, si);
    this.n++;
    if (this.n < 150) { // 300 ms : apprentissage du bruit
      this.N += (env - this.N) / this.n;
      this.V += (env * env - this.V) / this.n;
      this.M = Math.max(this.M, env);
      this.lastR = sr;
      this.lastI = si;
      return;
    }
    // Moyennes des silences (et leur dispersion) et des tops, d'après la décision précédente
    if (!this.raw) { this.N += (env - this.N) * 0.01; this.V += (env * env - this.V) * 0.01; }
    else this.M += (env - this.M) * 0.03;
    const sd = Math.sqrt(Math.max(1e-30, this.V - this.N * this.N));
    if (this.M < this.N + 2 * sd) this.M += (this.N + 2 * sd - this.M) * 0.05;
    this.snr = Math.max(0, 20 * Math.log10(Math.max(1e-9, this.M - this.N) / sd) - 6);
    const span = this.M - this.N;
    const det = this.raw ? env > this.N + span * 0.42 : env > this.N + span * 0.55;
    // AFC pendant les tops : écart de phase entre deux mesures
    if (det && this.raw) {
      const dr = sr * this.lastR + si * this.lastI, di = si * this.lastR - sr * this.lastI;
      const err = Math.atan2(di, dr) / (2 * Math.PI * this.tickMs / 1000);
      if (Math.abs(err) < 60) this.fc = Math.max(this.f0 - this.afcSpan, Math.min(this.f0 + this.afcSpan, this.fc + err * 0.004));
    }
    this.lastR = sr;
    this.lastI = si;
    this.raw = det;
    if (this.on && this.mk) { this.mk.s += env; this.mk.n++; }
    // Anti-rebond : un changement d'état doit durer 0,35 point
    const deb = Math.max(2, Math.round((this.dit * 0.35) / this.tickMs));
    this.dur += this.tickMs;
    if (det !== this.on) {
      if (this.cand !== det) { this.cand = det; this.candN = 0; }
      if (++this.candN < deb) { this._idle(); return; }
      const back = this.candN * this.tickMs; // le changement a commencé il y a candN mesures
      const d = this.dur - back;
      this.dur = back;
      this.candN = 0;
      if (det) {
        if (d < 700) { this.allG.push(d); if (this.allG.length > 16) this.allG.shift(); }
        this.on = true;
      } else {
        this.on = false;
        if (this.code.length > 9) this.code = '';
        if (this.open()) this._learn(d);
        this.code += d < this.dit * 2 ? '.' : '-';
        const e = Math.min(Math.abs(d / this.dit - 1), Math.abs(d / (3 * this.dit) - 1));
        this.qs.push([this.n, 1 - 2.5 * Math.min(0.8, e)]);
        if (this.qs.length > 400) this.qs.shift();
      }
      this.mk = { s: 0, n: 0 };
      return;
    }
    this.candN = 0;
    this.cand = det;
    this._idle();
  }
  _idle() {
    if (this.on) return;
    if (this.code && this.dur > this.dit * 2.2) this._char();
    if (!this.wordDone && this.dur > this.dit * 5.2) { this.wordDone = true; this.chq.push([this.n, ' ']); }
  }
  process(x) {
    const n = this.nw, b1 = this.b1, b2 = this.b2, s1 = this.s1, s2 = this.s2;
    const w = (2 * Math.PI * this.fc) / this.rate;
    const norm = 1 / (n * n);
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const re = v * Math.cos(this.ph), im = -v * Math.sin(this.ph);
      this.ph += w;
      if (this.ph > 6.283185307179586) this.ph -= 6.283185307179586;
      let p = this.p1 * 2;
      s1[0] += re - b1[p]; s1[1] += im - b1[p + 1];
      b1[p] = re; b1[p + 1] = im;
      this.p1 = (this.p1 + 1) % n;
      p = this.p2 * 2;
      s2[0] += s1[0] - b2[p]; s2[1] += s1[1] - b2[p + 1];
      b2[p] = s1[0]; b2[p + 1] = s1[1];
      this.p2 = (this.p2 + 1) % n;
      if (++this.k === TICK) { this.k = 0; this._tick(s2[0] * norm, s2[1] * norm); }
    }
  }
}

/**
 * Décodeur CW : trois décodeurs en parallèle (rapide 30–65, moyen 14–33, lent 5–16 mots/minute) ; le texte vient
 * de celui dont les durées des tops sont les plus cohérentes sur les 10 dernières secondes (un seul décodeur ne
 * peut pas apprendre la vitesse d'un signal faible : il confond points et traits).
 */
class CwDecoder {
  /** @param {{rate?:number, f:number, bw?:number, squelch?:number}} o */
  constructor(o) {
    this.d = [
      new CwOne(Object.assign({}, o, { dit0: 30, minDit: 18, maxDit: 42 })),
      new CwOne(Object.assign({}, o, { dit0: 55, minDit: 36, maxDit: 85 })),
      new CwOne(Object.assign({}, o, { dit0: 110, minDit: 75, maxDit: 240 }))
    ];
    this.best = 1;
    this.last = -1;
  }
  /** Indicateur : niveau (dB au-dessus du bruit), vitesse (mots/minute), état de la porteuse, tonalité suivie (Hz) */
  levels() { return this.d[this.best].levels(); }
  _score(x) {
    let s = 0, k = 0;
    for (const [t, q] of x.qs) if (t > x.n - 5000) { s += q; k++; }
    return k >= 6 ? s / k : -1;
  }
  /** Échantillons (Float32Array, 12 kHz) → texte décodé depuis l'appel précédent */
  process(x) {
    for (const d of this.d) d.process(x);
    const sc = this.d.map((d) => this._score(d));
    let b = this.best;
    for (let i = 0; i < 3; i++) if (sc[i] > sc[b] + 0.12) b = i;
    this.best = b;
    let o = '';
    for (const [t, ch] of this.d[b].chq) if (t > this.last) { o += ch; this.last = t; }
    return o;
  }
}

/**
 * Génère un signal CW de test (enveloppe à fronts adoucis de 5 ms).
 * @param {string} text  @param {{rate?:number, f?:number, wpm?:number, amp?:number}} o
 */
function generate(text, o = {}) {
  const rate = o.rate || 12000;
  const f = o.f || 600;
  const dit = 1.2 / (o.wpm || 20);
  const amp = o.amp == null ? 1 : o.amp;
  const seq = []; // [on, durée en points]
  const words = String(text).toUpperCase().split(/\s+/).filter(Boolean);
  words.forEach((w, wi) => {
    const toks = w.match(/<[A-Z]{2}>|./g) || [];
    toks.forEach((ch, ci) => {
      const c = TO_MORSE[ch];
      if (!c) return;
      for (let j = 0; j < c.length; j++) {
        seq.push([1, c[j] === '.' ? 1 : 3]);
        if (j < c.length - 1) seq.push([0, 1]);
      }
      if (ci < toks.length - 1) seq.push([0, 3]);
    });
    if (wi < words.length - 1) seq.push([0, 7]);
  });
  seq.push([0, 10]);
  const total = seq.reduce((a, s) => a + s[1], 0);
  const out = new Float32Array(Math.ceil(total * dit * rate));
  const edge = Math.round(0.005 * rate);
  let pos = 0;
  for (const [on, d] of seq) {
    const len = Math.round(d * dit * rate);
    if (on) {
      for (let i = 0; i < len && pos + i < out.length; i++) {
        let e = 1;
        if (i < edge) e = 0.5 - 0.5 * Math.cos(Math.PI * i / edge);
        else if (len - i < edge) e = 0.5 - 0.5 * Math.cos(Math.PI * (len - i) / edge);
        out[pos + i] = amp * e * Math.sin(2 * Math.PI * f * (pos + i) / rate);
      }
    }
    pos += len;
  }
  return out;
}

module.exports = { CwDecoder, CwOne, generate, MORSE, TO_MORSE };
