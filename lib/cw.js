'use strict';
/*
 * cw.js — décodeur CW (Morse) et générateur de test, sans dépendance.
 *
 * Mélange complexe sur la tonalité choisie puis deux moyennes glissantes en cascade (filtre passe-bas
 * de la largeur demandée) ; l'enveloppe est mesurée toutes les 2 ms. Planchers de bruit et crêtes suivis
 * en continu (seuil automatique avec hystérésis, silencieux en dB au-dessus du bruit). La vitesse est
 * apprise sur les durées des points et des traits (5 à 60 mots/minute), les espaces séparent les
 * caractères (≥ 2 points) et les mots (≥ 5 points).
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

const TICK = 24; // échantillons par mesure d'enveloppe (2 ms à 12 kHz)
// Niveau affiché (et silencieux) : crête du signal par rapport aux plus fortes pointes du bruit seul
// (moyenne + 3 écarts-types de l'enveloppe hors des tops) ; 0 dB = rien que du bruit.

class CwDecoder {
  /** @param {{rate?:number, f:number, bw?:number, squelch?:number}} o */
  constructor(o) {
    this.rate = o.rate || 12000;
    this.w = 2 * Math.PI * o.f / this.rate;
    this.ph = 0;
    const bw = o.bw || 100;
    this.n = Math.max(4, Math.round(this.rate / bw));
    this.b1 = new Float64Array(this.n * 2);
    this.b2 = new Float64Array(this.n * 2);
    this.s1 = [0, 0];
    this.s2 = [0, 0];
    this.p1 = 0;
    this.p2 = 0;
    this.k = 0;
    this.tickMs = (TICK / this.rate) * 1000;
    this.squelch = Number.isFinite(o.squelch) ? o.squelch : 5;
    // Enveloppe
    this.noise = 0;
    this.nsq = 0;
    this.sd = 0;
    this.peak = 0;
    this.started = 0;
    this.on = false;
    this.dur = 0;                 // durée de l'état en cours (ms)
    this.dit = 60;                // durée d'un point (ms) : 20 mots/minute au départ
    this.code = '';
    this.wordDone = true;
    this.out = '';
    this.snr = 0;
    this.lastMark = 0;
    // Temps de propagation du filtre : les tops très courts sont des parasites
    this.minMark = Math.max(6, (this.n / this.rate) * 1000 * 0.6);
  }

  /** Indicateur : niveau (dB au-dessus du bruit), vitesse (mots/minute), état de la porteuse */
  levels() { return { s: Math.round(this.snr), wpm: Math.round(1200 / this.speedDit()), on: this.on && this.open() }; }

  // Vitesse affichée : le filtre allonge les tops et raccourcit d'autant les silences ; un point plus le
  // silence qui le suit dans un caractère valent exactement deux points.
  // Seuils des silences : fin de caractère (2 points) et espace entre mots (5 points), corrigés du
  // raccourcissement des silences par le filtre
  gapThr() {
    const g = this.gaps;
    if (!g || g.length < 4 || !this.dotMean) return { ch: this.dit * 2.3, word: this.dit * 5.5 };
    const gm = g.reduce((a, b) => a + b, 0) / g.length;
    const d = (this.dotMean + gm) / 2;
    const short = Math.max(0, (this.dotMean - gm) / 2);
    return { ch: Math.max(d * 2 - short, gm * 1.5), word: d * 5 - short };
  }
  speedDit() {
    const g = this.gaps;
    if (!g || g.length < 4 || !this.dotMean) return this.dit;
    const gm = g.reduce((a, b) => a + b, 0) / g.length;
    const d = (this.dotMean + gm) / 2;
    return d > 15 && d < 260 ? d : this.dit;
  }

  open() { return this.snr >= this.squelch; }

  _char() {
    if (!this.code) return;
    const c = MORSE[this.code];
    this.out += c || '*';
    this.code = '';
    this.wordDone = false;
  }

  _tick(raw) {
    // Lissage après détection sur ~1/4 de point (s'adapte à la vitesse) : gain sur les signaux faibles
    const h = this.hist || (this.hist = new Float64Array(64));
    this.hp = ((this.hp || 0) + 1) & 63;
    h[this.hp] = raw;
    const L = Math.max(1, Math.min(32, Math.round(this.dit / 4 / this.tickMs)));
    let mag = 0;
    for (let i = 0; i < L; i++) mag += h[(this.hp - i) & 63];
    mag /= L;
    // Bruit : moyenne de l'enveloppe hors des tops (les 200 premières ms : apprentissage) ;
    // crête : monte vite sur les tops, redescend en ~2 s
    if (this.started < 100) {
      this.started++;
      this.noise += (mag - this.noise) / this.started;
      this.nsq = (this.nsq || 0) + (mag * mag - (this.nsq || 0)) / this.started;
      this.peak = Math.max(this.peak, mag);
      return;
    }
    if (!this.on && mag < this.noise + 4 * this.sd) {
      const a = mag < this.noise ? 0.02 : 0.004;
      this.noise += (mag - this.noise) * a;
      this.nsq += (mag * mag - this.nsq) * a;
    }
    if (this.noise < 1e-9) this.noise = 1e-9;
    this.sd = Math.sqrt(Math.max(0, this.nsq - this.noise * this.noise));
    const floor = this.noise + 3 * this.sd;
    // Pendant un top, la crête suit aussi le signal vers le bas (évanouissements, QSB)
    this.peak += (mag - this.peak) * (mag > this.peak ? 0.2 : this.on ? 0.012 : 0.001);
    if (this.peak < this.noise) this.peak = this.noise;
    this.snr = Math.max(0, 20 * Math.log10(this.peak / floor));
    const span = this.peak - this.noise;
    // Après un long silence (> 8 points), un nouveau top doit être plus franc : moins de parasites
    const hi = Math.max(this.noise + span * (!this.on && this.dur > this.dit * 8 ? 0.68 : 0.5), floor);
    const lo = Math.max(this.noise + span * 0.35, this.noise + 2 * this.sd);
    const open = this.open();
    // Silencieux fermé plus d'une seconde : l'apprentissage de la vitesse repart pour le prochain signal
    if (!open) { if ((this.closed = (this.closed || 0) + this.tickMs) > 1000 && this.marks) { this.marks.length = 0; this.code = ''; if (this.gaps) this.gaps.length = 0; } }
    else this.closed = 0;
    const want = open && (this.on ? mag > lo : mag > hi);
    this.dur += this.tickMs;
    if (want === this.on) {
      // Silence : fin de caractère après 2 points (plus une marge), espace après 5 points
      if (!this.on) {
        const t = this.gapThr();
        if (this.code && this.dur > t.ch) this._char();
        if (!this.wordDone && this.dur > t.word) { this.out += ' '; this.wordDone = true; }
      }
      return;
    }
    if (want) {
      // Début d'un top ; silence à l'intérieur d'un caractère : mémorisé pour la vitesse
      if (this.code && this.dur < this.dit * 1.6) {
        const g = this.gaps || (this.gaps = []);
        g.push(this.dur);
        if (g.length > 16) g.shift();
      }
      this.on = true;
      this.gap = this.dur;
      this.dur = 0;
      return;
    }
    // Fin d'un top
    const d = this.dur;
    this.on = false;
    this.dur = 0;
    if (d < this.minMark) {
      // Parasite : on le compte comme silence
      this.dur = (this.gap || 0) + d;
      return;
    }
    if (this.code.length > 9) this.code = '';
    this._learn(d);
    this.code += d < this.dit * 2 ? '.' : '-';
  }

  // Vitesse : les 16 derniers tops sont classés en points et traits (deux groupes) ; un point = moyenne
  // des points et du tiers des traits. Tops tous semblables : on garde l'estimation précédente pour
  // savoir s'il s'agit de points ou de traits.
  _learn(d) {
    const m = this.marks || (this.marks = []);
    m.push(d);
    if (m.length > 10) m.shift();
    let lo = Math.min.apply(null, m);
    let hi = Math.max.apply(null, m);
    let dit;
    if (hi / lo < 2) {
      const avg = m.reduce((a, b) => a + b, 0) / m.length;
      dit = avg < this.dit * 2 ? avg : avg / 3;
      if (m.length < 3) dit = this.dit + (dit - this.dit) * 0.3;
      if (avg < this.dit * 2) this.dotMean = avg;
    } else {
      for (let it = 0; it < 6; it++) {
        const t = Math.sqrt(lo * hi);
        let sl = 0, nl = 0, sh = 0, nh = 0;
        for (const x of m) { if (x < t) { sl += x; nl++; } else { sh += x; nh++; } }
        lo = sl / nl;
        hi = sh / nh;
      }
      this.dotMean = lo;
      const t = Math.sqrt(lo * hi);
      let sum = 0;
      for (const x of m) sum += x < t ? x : x / 3;
      dit = sum / m.length;
    }
    this.dit = Math.max(20, Math.min(240, dit));
  }

  /** Échantillons (Float32Array, 12 kHz) → texte décodé depuis l'appel précédent */
  process(x) {
    const n = this.n;
    const b1 = this.b1;
    const b2 = this.b2;
    const s1 = this.s1;
    const s2 = this.s2;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const re = v * Math.cos(this.ph);
      const im = -v * Math.sin(this.ph);
      this.ph += this.w;
      if (this.ph > 6.283185307179586) this.ph -= 6.283185307179586;
      // 1re moyenne glissante
      let p = this.p1 * 2;
      s1[0] += re - b1[p]; s1[1] += im - b1[p + 1];
      b1[p] = re; b1[p + 1] = im;
      this.p1 = (this.p1 + 1) % n;
      // 2e moyenne glissante
      p = this.p2 * 2;
      s2[0] += s1[0] - b2[p]; s2[1] += s1[1] - b2[p + 1];
      b2[p] = s1[0]; b2[p + 1] = s1[1];
      this.p2 = (this.p2 + 1) % n;
      if (++this.k === TICK) {
        this.k = 0;
        this._tick(Math.hypot(s2[0], s2[1]) / (n * n));
      }
    }
    const o = this.out;
    this.out = '';
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

module.exports = { CwDecoder, generate, MORSE, TO_MORSE };
