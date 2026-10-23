'use strict';
/*
 * rtty.js — démodulateur RTTY (AFSK, code Baudot ITA2) et générateur de test, sans dépendance.
 *
 * Deux filtres adaptés (mélange complexe puis moyenne glissante sur une durée de bit) mesurent
 * l'énergie sur les fréquences Mark et Space ; leur différence normalisée (suivi automatique du seuil)
 * alimente un récepteur série : bit de départ (Space), 5 bits de données, bit d'arrêt (Mark).
 * En USB / DATA-U, Mark est la tonalité haute (Mark = centre + shift/2) ; « inversé » échange les deux.
 */

// ITA2 : lettres et chiffres (variante européenne courante pour les signes)
const LTRS = ['\0', 'E', '\n', 'A', ' ', 'S', 'I', 'U', '\r', 'D', 'R', 'J', 'N', 'F', 'C', 'K',
  'T', 'Z', 'L', 'W', 'H', 'Y', 'P', 'Q', 'O', 'B', 'G', null, 'M', 'X', 'V', null];
const FIGS = ['\0', '3', '\n', '-', ' ', '\'', '8', '7', '\r', '$', '4', '\x07', ',', '!', ':', '(',
  '5', '+', ')', '2', '#', '6', '0', '1', '9', '?', '&', null, '.', '/', ';', null];
const C_FIGS = 27;
const C_LTRS = 31;

class RttyDemod {
  /**
   * @param {{rate:number, f:number, shift:number, baud:number, rev?:boolean, usos?:boolean}} o
   *   f : fréquence centrale (Hz) entre Mark et Space
   */
  constructor(o) {
    this.rate = o.rate || 12000;
    this.baud = o.baud || 45.45;
    const half = (o.shift || 170) / 2;
    const fm = o.rev ? o.f - half : o.f + half;
    const fs = o.rev ? o.f + half : o.f - half;
    this.usos = o.usos !== false;
    this.squelch = Number.isFinite(o.squelch) ? o.squelch : 12; // dB de contraste moyen
    this.c = 0;
    this.lm = 0; this.ls = 0; this.lmMin = 1; this.lsMin = 1;
    this.spb = this.rate / this.baud; // échantillons par bit
    this.n = Math.max(8, Math.round(this.spb));
    this.wm = 2 * Math.PI * fm / this.rate;
    this.ws = 2 * Math.PI * fs / this.rate;
    // Moyennes glissantes complexes (filtres adaptés d'une durée de bit)
    this.buf = new Float32Array(this.n * 4);
    this.sum = [0, 0, 0, 0];
    this.pos = 0;
    this.k = 0;
    // Suivi des niveaux Mark / Space (seuil automatique)
    this.mAvg = 1e-6;
    this.sAvg = 1e-6;
    // Récepteur série
    this.state = 0; // 0 : attente du départ, 1 : réception
    this.t = 0;
    this.bits = 0;
    this.nb = 0;
    this.q = 0;
    this.prev = 1;
    this.figs = false;
    this.out = '';
  }

  /** Niveaux pour l'indicateur d'accord : Mark et Space (dB au-dessus de leur plancher), contraste (dB) */
  levels() {
    const db = (x) => 10 * Math.log10(x + 1e-12);
    return { m: Math.round(db(this.lm) - db(Math.min(this.lmMin, this.lsMin))), s: Math.round(db(this.ls) - db(Math.min(this.lmMin, this.lsMin))), c: Math.round(this.c) };
  }

  /** Démodule un bloc d'échantillons ; renvoie le texte décodé depuis le dernier appel. */
  process(x) {
    const n = this.n;
    const b = this.buf;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const k = this.k++;
      const mr = v * Math.cos(this.wm * k), mi = -v * Math.sin(this.wm * k);
      const sr = v * Math.cos(this.ws * k), si = -v * Math.sin(this.ws * k);
      const p = this.pos * 4;
      this.sum[0] += mr - b[p];
      this.sum[1] += mi - b[p + 1];
      this.sum[2] += sr - b[p + 2];
      this.sum[3] += si - b[p + 3];
      b[p] = mr; b[p + 1] = mi; b[p + 2] = sr; b[p + 3] = si;
      this.pos = (this.pos + 1) % n;
      if (this.k > 1e9) this.k = 0; // évite la perte de précision (phase recalée à un multiple entier)
      const m = this.sum[0] * this.sum[0] + this.sum[1] * this.sum[1];
      const s = this.sum[2] * this.sum[2] + this.sum[3] * this.sum[3];
      // Niveaux de référence : suivent vite les montées, redescendent lentement
      const a = 1 / (this.spb * 16);
      this.mAvg = m > this.mAvg ? this.mAvg + (m - this.mAvg) * 0.05 : this.mAvg * (1 - a);
      this.sAvg = s > this.sAvg ? this.sAvg + (s - this.sAvg) * 0.05 : this.sAvg * (1 - a);
      // Décision normalisée par niveau (corrige un déséquilibre Mark / Space)
      const d = m / (this.mAvg + 1e-12) - s / (this.sAvg + 1e-12); // > 0 : Mark
      // Niveaux lissés pour l'indicateur d'accord, et plancher (minimum lentement remonté)
      this.lm += (m - this.lm) * 0.01;
      this.ls += (s - this.ls) * 0.01;
      this.lmMin = Math.min(this.lm, this.lmMin * 1.00002 + 1e-15);
      this.lsMin = Math.min(this.ls, this.lsMin * 1.00002 + 1e-15);
      // Contraste Mark / Space (dB) : élevé sur un signal RTTY, faible (≈ 6 dB en moyenne) sur du bruit
      this.c = Math.abs(10 * Math.log10((m + 1e-12) / (s + 1e-12)));
      this._bit(d);
    }
    const o = this.out;
    this.out = '';
    return o;
  }

  _bit(d) {
    const spb = this.spb;
    const cur = d > 0 ? 1 : 0;
    if (this.state === 0) {
      // Front Mark → Space : début possible d'un caractère
      if (this.prev === 1 && cur === 0) { this.state = 1; this.t = 0; this.bits = 0; this.nb = 0; this.q = 0; }
    } else {
      this.t++;
      // Le front est vu au milieu du bit de départ (filtre adapté d'un bit) ; chaque bit est lu
      // quand la fenêtre du filtre le couvre entièrement, soit un demi-bit après son milieu
      const at = (this.nb + 0.5) * spb;
      if (this.t >= at) {
        if (this.nb === 0) {
          if (cur !== 0) { this.state = 0; } // faux départ
          else { this.nb = 1; this.q += Math.min(30, this.c); }
        } else if (this.nb <= 5) {
          if (cur) this.bits |= 1 << (this.nb - 1);
          this.q += Math.min(30, this.c);
          this.nb++;
        } else {
          // Bit d'arrêt
          // Silencieux : caractère gardé si le contraste moyen dépasse le seuil (pas de texte au hasard sur le bruit)
          if (cur === 1 && (this.q + Math.min(30, this.c)) / 7 >= this.squelch) this._char(this.bits);
          this.state = 0;
        }
      }
    }
    this.prev = cur;
  }

  _char(c) {
    if (c === C_FIGS) { this.figs = true; return; }
    if (c === C_LTRS) { this.figs = false; return; }
    const ch = (this.figs ? FIGS : LTRS)[c];
    if (ch === ' ' && this.usos) this.figs = false; // retour en lettres après une espace (USOS)
    if (!ch || ch === '\0' || ch === '\x07') return;
    if (ch === '\r') return;
    this.out += ch;
  }
}

/** Générateur AFSK (tests) : texte → échantillons, avec un peu de Mark avant et après. */
function generate(text, o) {
  const rate = o.rate || 12000;
  const baud = o.baud || 45.45;
  const half = (o.shift || 170) / 2;
  const fm = o.rev ? o.f - half : o.f + half;
  const fs = o.rev ? o.f + half : o.f - half;
  const bits = [];
  const mark = (n) => { for (let i = 0; i < n; i++) bits.push(1); };
  mark(8);
  let figs = null;
  const code = (c) => { bits.push(0); for (let i = 0; i < 5; i++) bits.push((c >> i) & 1); bits.push(1, 1); };
  // ends[i] : nombre de bits émis à la fin du caractère i du texte (pour suivre l'émission lettre par lettre)
  const ends = [];
  for (const ch of text.toUpperCase()) {
    if (ch === ' ') { code(4); figs = false; } // le récepteur (USOS) repasse en lettres
    else if (ch === '\n') { code(8); code(2); }
    else {
      const li = LTRS.indexOf(ch);
      const fi = FIGS.indexOf(ch);
      if (li > 0) { if (figs !== false) { code(C_LTRS); figs = false; } code(li); }
      else if (fi > 0) { if (figs !== true) { code(C_FIGS); figs = true; } code(fi); }
    }
    ends.push(bits.length);
  }
  mark(8);
  const spb = rate / baud;
  const out = new Float32Array(Math.ceil(bits.length * spb));
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const bit = bits[Math.min(bits.length - 1, Math.floor(i / spb))];
    ph += 2 * Math.PI * (bit ? fm : fs) / rate;
    out[i] = Math.sin(ph);
  }
  // Fin de chaque caractère, en millisecondes depuis le début du signal
  out.charMs = ends.map((b) => Math.round((b * 1000) / baud));
  return out;
}

module.exports = { RttyDemod, generate, LTRS, FIGS };
