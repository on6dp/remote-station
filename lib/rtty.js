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
   * Démodulateur « grande sensibilité » (idées de 2Tone / W7AY) :
   *  - filtres adaptés d'une durée de bit sur Mark et Space (mélange complexe + moyenne glissante) ;
   *  - AFC : le décodeur se recale tout seul jusqu'à ±40 Hz (rotation de phase des tonalités) ;
   *  - ATC « optimal » de W7AY : enveloppes écrêtées entre plancher de bruit et crête, décision équilibrée
   *    même quand une tonalité s'efface (fading sélectif) ;
   *  - synchronisation par caractère à plusieurs hypothèses de temps (décisions pondérées) : on garde celle
   *    dont la trame (départ, 5 bits, arrêt) est la plus nette ;
   *  - silencieux à hystérésis : seuil normal pour ouvrir, plus bas tant que le signal est suivi.
   * @param {{rate:number, f:number, shift:number, baud:number, rev?:boolean, usos?:boolean, squelch?:number}} o
   */
  constructor(o) {
    this.rate = o.rate || 12000;
    this.baud = o.baud || 45.45;
    this.half = (o.shift || 170) / 2;
    this.rev = !!o.rev;
    this.f0 = o.f;
    this.afc = 0; // écart de fréquence corrigé (Hz)
    this.afcOn = o.afc !== false;
    this.afcGate = o.afcGate || 'mix'; this.afcSt = o.afcSt != null ? o.afcSt : 0.3;
    this.afcCoh = o.afcCoh != null ? o.afcCoh : 0.7; this.afcGain = o.afcGain != null ? o.afcGain : 0.3;
    this.dec = o.dec || 'w7ay'; this.multi = o.multi !== false; this.mAvg = 1e-6; this.sAvg = 1e-6;
    this.usos = o.usos !== false;
    // Silencieux : contraste Mark / Space moyen (dB) d'un caractère ; le réglage de la page (9 par défaut) + 3, car plusieurs
    // hypothèses sont essayées par caractère (le bruit en passerait plus souvent une) ; 2,5 s de seuil plus bas (−3 dB) après un caractère net
    this.squelch = (Number.isFinite(o.squelch) ? o.squelch : 9) + 3;
    this.spb = this.rate / this.baud;
    this.n = Math.max(8, Math.round(this.spb));
    this._tones();
    this.ph = [0, 0]; // phases des oscillateurs (continues, même quand l'AFC change la fréquence)
    this.buf = new Float32Array(this.n * 4);
    this.sum = [0, 0, 0, 0];
    this.pos = 0;
    // Historique (≈ 10 bits) : décision, enveloppes Mark / Space, sorties complexes (AFC)
    this.H = Math.ceil(this.spb * 10);
    this.NS = 3; // décisions : 0 enveloppes (Mark − Space), 1 ATC normalisé (puissances), 2 ATC de W7AY
    this.hd = [0, 1, 2].map(() => new Float32Array(this.H));
    this.ma = [1e-6, 1e-6, 1e-6]; // moyenne de |décision| de chaque voie (normalisation)
    this.streams = o.streams || [0, 1, 2];
    this.eng = this._engines(o.engines || [{ det: [0], cand: [0], bias: 1.2 }, { det: [0, 2], cand: ['sum', 2] }]);
    this.pend = [];
    this.holdS = o.holdS != null ? o.holdS : 1.5; this.holdD = o.holdD != null ? o.holdD : 3;
    this.hm = new Float32Array(this.H);
    this.hs = new Float32Array(this.H);
    this.hz = new Float32Array(this.H * 4);
    this.t = 0; // échantillons traités
    // ATC : crêtes et planchers des enveloppes
    this.pm = 1e-6; this.ps = 1e-6; this.nm = 0; this.ns = 0;
    this.c = 0; this.lm = 0; this.ls = 0; this.lmMin = 1; this.lsMin = 1;
    // Synchronisation
    this.prevD = 1;
    this.frameAt = -1; // instant (échantillon) du passage Mark → Space qui ouvre un caractère, -1 : en attente
    this.figs = false;
    this.out = '';
    this.okAt = -1e12; // dernier caractère sûr (silencieux à hystérésis)
    this.afcAcc = [0, 0, 0, 0, 0]; this.afcStrong = 0; // AFC : somme des rotations Mark (re, im) et Space (re, im)
  }
  _tones() {
    const f = this.f0 + this.afc;
    const fm = this.rev ? f - this.half : f + this.half;
    const fs = this.rev ? f + this.half : f - this.half;
    this.wm = 2 * Math.PI * fm / this.rate;
    this.ws = 2 * Math.PI * fs / this.rate;
  }

  /** Niveaux pour l'indicateur d'accord : Mark et Space (dB au-dessus de leur plancher), contraste (dB), AFC (Hz) */
  levels() {
    const db = (x) => 10 * Math.log10(x + 1e-12);
    return { m: Math.round(db(this.lm) - db(Math.min(this.lmMin, this.lsMin))), s: Math.round(db(this.ls) - db(Math.min(this.lmMin, this.lsMin))), c: Math.round(this.c), afc: Math.round(this.afc) };
  }

  /** Démodule un bloc d'échantillons ; renvoie le texte décodé depuis le dernier appel. */
  process(x) {
    const n = this.n, b = this.buf, H = this.H, spb = this.spb;
    const aPk = 1 / (spb * 0.5), dPk = 1 / (spb * 16), aFl = 1 / (spb * 16);
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      this.ph[0] += this.wm; this.ph[1] += this.ws;
      if (this.ph[0] > 6.283185307179586) this.ph[0] -= 6.283185307179586;
      if (this.ph[1] > 6.283185307179586) this.ph[1] -= 6.283185307179586;
      const mr = v * Math.cos(this.ph[0]), mi = -v * Math.sin(this.ph[0]);
      const sr = v * Math.cos(this.ph[1]), si = -v * Math.sin(this.ph[1]);
      const p = this.pos * 4;
      this.sum[0] += mr - b[p]; this.sum[1] += mi - b[p + 1]; this.sum[2] += sr - b[p + 2]; this.sum[3] += si - b[p + 3];
      b[p] = mr; b[p + 1] = mi; b[p + 2] = sr; b[p + 3] = si;
      this.pos = (this.pos + 1) % n;
      const M2 = this.sum[0] * this.sum[0] + this.sum[1] * this.sum[1];
      const S2 = this.sum[2] * this.sum[2] + this.sum[3] * this.sum[3];
      const m = Math.sqrt(M2), s = Math.sqrt(S2);
      // ATC (W7AY) : crête (montée rapide, descente lente) et plancher (bruit) de chaque enveloppe
      this.pm = m > this.pm ? this.pm + (m - this.pm) * aPk : this.pm + (m - this.pm) * dPk;
      this.ps = s > this.ps ? this.ps + (s - this.ps) * aPk : this.ps + (s - this.ps) * dPk;
      this.nm = m < this.nm ? this.nm + (m - this.nm) * aPk : this.nm + (m - this.nm) * aFl;
      this.ns = s < this.ns ? this.ns + (s - this.ns) * aPk : this.ns + (s - this.ns) * aFl;
      const mc = Math.min(Math.max(m, this.nm), this.pm) - this.nm, sc = Math.min(Math.max(s, this.ns), this.ps) - this.ns;
      const a16 = 1 / (spb * 16);
      this.mAvg = M2 > this.mAvg ? this.mAvg + (M2 - this.mAvg) * 0.05 : this.mAvg * (1 - a16);
      this.sAvg = S2 > this.sAvg ? this.sAvg + (S2 - this.sAvg) * 0.05 : this.sAvg * (1 - a16);
      const D0 = m - s, D1 = M2 / (this.mAvg + 1e-12) - S2 / (this.sAvg + 1e-12), D2 = mc - sc - 0.5 * ((this.pm - this.nm) - (this.ps - this.ns));
      const aM = 1 / (spb * 8);
      this.ma[0] += (Math.abs(D0) - this.ma[0]) * aM; this.ma[1] += (Math.abs(D1) - this.ma[1]) * aM; this.ma[2] += (Math.abs(D2) - this.ma[2]) * aM;
      let d = 0;
      for (const q of this.streams) d += [D0, D1, D2][q] / (this.ma[q] + 1e-12);
      // Indicateur d'accord
      this.lm += (M2 - this.lm) * 0.01; this.ls += (S2 - this.ls) * 0.01;
      this.lmMin = Math.min(this.lm, this.lmMin * 1.00002 + 1e-15); this.lsMin = Math.min(this.ls, this.lsMin * 1.00002 + 1e-15);
      this.c = Math.abs(10 * Math.log10((M2 + 1e-12) / (S2 + 1e-12)));
      const k = this.t % H;
      this.hd[0][k] = D0 / (this.ma[0] + 1e-12); this.hd[1][k] = D1 / (this.ma[1] + 1e-12); this.hd[2][k] = D2 / (this.ma[2] + 1e-12); this.hm[k] = m; this.hs[k] = s;
      this.hsum = this.hsum || new Float32Array(this.H); this.hsum[k] = d;
      const z = k * 4; this.hz[z] = this.sum[0]; this.hz[z + 1] = this.sum[1]; this.hz[z + 2] = this.sum[2]; this.hz[z + 3] = this.sum[3];
      this._afc(k, m, s);
      this._sync();
      this.t++;
    }
    const o = this.out;
    this.out = '';
    return o;
  }
  flush() { this._merge(true); const o = this.out; this.out = ''; return o; }

  // AFC : rotation de phase de la tonalité dominante sur un demi-bit (Z(t)·conj(Z(t − L))), pondérée par sa puissance
  _afc(k, m, s) {
    if (!this.afcOn) return;
    const L = Math.round(this.spb / 2);
    if (this.t < this.H) return;
    const j = ((this.t - L) % this.H) * 4, z = k * 4, hz = this.hz, A = this.afcAcc;
    if ((m > 6 * this.nm && m > 3 * s) || (s > 6 * this.ns && s > 3 * m)) this.afcStrong += 1 / 1200;
    if (m > 3 * s && m > 2 * this.nm) {
      const re = hz[z] * hz[j] + hz[z + 1] * hz[j + 1], im = hz[z + 1] * hz[j] - hz[z] * hz[j + 1];
      A[0] += re; A[1] += im; A[4] = (A[4] || 0) + Math.hypot(re, im);
    } else if (s > 3 * m && s > 2 * this.ns) {
      const re = hz[z + 2] * hz[j + 2] + hz[z + 3] * hz[j + 3], im = hz[z + 3] * hz[j + 2] - hz[z + 2] * hz[j + 3];
      A[2] += re; A[3] += im; A[4] = (A[4] || 0) + Math.hypot(re, im);
    }
    if (this.t % 1200) return; // tous les 100 ms
    // Mark et Space séparément puis moyennés : la fuite de l'autre tonalité (à ±shift) biaise chacune en sens contraire
    const wM = Math.hypot(A[0], A[1]), wS = Math.hypot(A[2], A[3]);
    const angM = Math.atan2(A[1], A[0]), angS = Math.atan2(A[3], A[2]);
    const re = A[0] + A[2], im = A[1] + A[3], tot = A[4] || 0;
    const ang = wM > 0.2 * wS && wS > 0.2 * wM ? (angM + angS) / 2 : wM >= wS ? angM : angS;
    this.afcAcc = [0, 0, 0, 0, 0];
    // Cohérence : une vraie tonalité tourne toujours du même angle (proche de 1) ; le bruit, au hasard (proche de 0)
    const coh = tot ? Math.hypot(re, im) / tot : 0;
    // Signal présent : un caractère net décodé il y a moins de 2 s, ou une tonalité bien au-dessus du bruit
    const sig = this.afcGate === 'strong' ? this.afcStrong > this.afcSt : (this.t - this.okAt < 2 * this.rate && this.afcStrong > this.afcSt * 0.3) || this.afcStrong > this.afcSt;
    this.afcStrong = 0;
    if (coh < this.afcCoh || !sig) {
      // Pas de signal net depuis 5 s : retour lent vers la fréquence choisie
      if (this.t - (this.afcAt || 0) > 5 * this.rate) { this.afc *= 0.97; this._tones(); }
      return;
    }
    const err = ang * this.rate / (2 * Math.PI * L); // Hz
    if (!Number.isFinite(err)) return;
    this.afcAt = this.t;
    this.afc = Math.max(-40, Math.min(40, this.afc + this.afcGain * err));
    this._tones();
  }
  // Plusieurs décodeurs de trames (comme 2Tone) sur le même historique : chacun cherche ses départs sur sa propre décision
  // et propose ses caractères avec une note ; la fusion garde, pour un même caractère, celui de meilleure note
  _engines(list) {
    return list.map((e) => ({ det: e.det, cand: e.cand, bias: e.bias || 1, frameAt: -1, prevD: 1 }));
  }
  _val(tt, q, det) {
    if (q !== 'sum') return this._at(tt, q);
    let v = 0;
    for (const k of det) v += this._at(tt, k);
    return v / det.length;
  }
  _sync() {
    const spb = this.spb, k = this.t % this.H;
    const OFF = this.multi ? [-0.3, -0.15, 0, 0.15, 0.3] : [0];
    for (const E of this.eng) {
      let d = 0;
      for (const q of E.det) d += this.hd[q][k];
      if (E.frameAt < 0) {
        if (E.prevD > 0 && d <= 0) E.frameAt = this.t;
        E.prevD = d;
        continue;
      }
      E.prevD = d;
      if (this.t === E.frameAt + Math.round(0.5 * spb)) {
        const f = (x) => this._val(E.frameAt + x * spb, 'sum', E.det);
        if (f(0.5) > 0 && f(0.35) > 0 && f(0.65) > 0) { E.frameAt = -1; continue; } // faux départ
      }
      if (this.t < E.frameAt + Math.ceil(6.8 * spb)) continue;
      let best = null;
      for (const q of E.cand) for (const o of OFF) {
        const v = [];
        for (let bit = 0; bit < 7; bit++) v.push(this._val(E.frameAt + (bit + 0.5 + o) * spb, q, E.det));
        if (v[0] >= 0 || v[6] <= 0) continue; // départ Space, arrêt Mark
        let qq = 0, mn = Infinity;
        for (const y of v) { const a = Math.min(2, Math.abs(y)); qq += a; if (a < mn) mn = a; }
        qq = (qq + 2 * mn) * E.bias;
        if (!best || qq > best.q) best = { q: qq, v, o };
      }
      const at = E.frameAt;
      E.frameAt = -1;
      E.prevD = this._val(this.t - 1, 'sum', E.det);
      if (!best) continue;
      let code = 0;
      for (let bit = 1; bit <= 5; bit++) if (best.v[bit] > 0) code |= 1 << (bit - 1);
      let cs = 0;
      for (let bit = 0; bit < 7; bit++) {
        const tt = at + (bit + 0.5 + best.o) * spb;
        const mm = this._env(this.hm, tt), ss = this._env(this.hs, tt);
        cs += Math.min(30, Math.abs(10 * Math.log10((mm * mm + 1e-12) / (ss * ss + 1e-12))));
      }
      this.pend.push({ at: at + best.o * spb, code, q: best.q, cs: cs / 7, e: E });
    }
    this._merge(false);
  }
  // Fusion : deux propositions à moins de 3,5 bits l'une de l'autre = le même caractère (la meilleure note gagne) ;
  // une proposition est rendue quand les autres décodeurs ont eu le temps de proposer la leur
  _merge(all) {
    const spb = this.spb, P = this.pend;
    P.sort((a, b) => a.at - b.at);
    while (P.length) {
      const a = P[0];
      if (!all && this.t < a.at + 11 * spb) break;
      let best = a, n = 1;
      while (n < P.length && P[n].at - a.at < 3.5 * spb) { if (P[n].q > best.q) best = P[n]; n++; }
      P.splice(0, n);
      const held = this.t - this.okAt < (this.holdS + 1) * this.rate;
      const thr = held ? Math.max(3, this.squelch - this.holdD) : this.squelch;
      if (best.cs >= thr) {
        if (best.cs >= this.squelch) this.okAt = this.t;
        this._char(best.code);
      }
    }
  }
  _at(tt, q) {
    const H = this.H, i = Math.floor(tt), f = tt - i;
    if (this.t - i >= H - 1 || i >= this.t) return 0;
    const A = q == null ? this.hsum : this.hd[q];
    const a = A[((i % H) + H) % H], b = A[(((i + 1) % H) + H) % H];
    return a + (b - a) * f;
  }
  _env(arr, tt) {
    const H = this.H, i = Math.round(tt);
    if (this.t - i >= H || i >= this.t) return 0;
    return arr[((i % H) + H) % H];
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
