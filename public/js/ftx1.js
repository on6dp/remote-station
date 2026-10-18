/*
 * ftx1.js — protocole CAT du Yaesu FTX-1 (port Enhanced / CAT-1)
 * Référence : FTX-1 CAT Operation Reference Manual (édition 2508-C).
 * Format : 2 lettres + paramètres + ';'. Erreur renvoyée par la radio : "?;".
 *
 * Utilisable dans le navigateur (window.FTX1) et dans Node (require).
 */
(function (root) {
  'use strict';

  // Codes du paramètre P2 de la commande MD (MODE) — manuel CAT FTX-1, MD
  const MODES = {
    '1': 'LSB', '2': 'USB', '3': 'CW-U', '4': 'FM', '5': 'AM',
    '6': 'RTTY-L', '7': 'CW-L', '8': 'DATA-L', '9': 'RTTY-U', 'A': 'DATA-FM',
    'B': 'FM-N', 'C': 'DATA-U', 'D': 'AM-N', 'E': 'PSK', 'F': 'DATA-FM-N',
    'H': 'C4FM-DN', 'I': 'C4FM-VW'
  };
  // Modes que l'on autorise à sélectionner à distance (C4FM : affichage seulement)
  const SETTABLE = ['1', '2', '3', '7', '4', 'B', '5', 'D', '8', 'C', 'A', 'F', '6', '9', 'E'];

  const FREQ_MIN = 30000;       // 30 kHz
  const FREQ_MAX = 470000000;   // 470 MHz

  // Commandes de lecture envoyées à chaque cycle de polling
  const POLL = 'FA;MD0;FB;MD1;SM0;TX;PC;';

  function cmdFreq(hz) {
    hz = Math.round(Number(hz));
    if (!(hz >= FREQ_MIN && hz <= FREQ_MAX)) throw new Error('fréquence hors limites');
    return 'FA' + String(hz).padStart(9, '0') + ';';   // 9 chiffres obligatoires
  }
  function cmdMode(code) {
    code = String(code).toUpperCase();
    if (SETTABLE.indexOf(code) < 0) throw new Error('mode non autorisé');
    return 'MD0' + code + ';';
  }
  /**
   * Réglage de puissance. Le FTX-1 indique sa tête dans la réponse PC :
   *  P1 = 1 : tête Field, 0,5 à 10 W (dixièmes sous 10 W : "PC10.5;" = 0,5 W, "PC1005;" = 5 W)
   *  P1 = 2 : ampli SPA-1, 5 à 100 W ("PC2025;" = 25 W)
   */
  const POWER_RANGE = { '1': [0.5, 10], '2': [5, 100] };
  function cmdPower(watts, head) {
    const r = POWER_RANGE[head];
    if (!r) throw new Error('type de tête inconnu, puissance non réglable');
    let w = Math.round(Number(watts) * 2) / 2;
    if (!(w >= r[0] && w <= r[1])) throw new Error('puissance hors plage (' + r[0] + '–' + r[1] + ' W)');
    if (head === '2') w = Math.round(w);
    const p = Number.isInteger(w) ? String(w).padStart(3, '0') : w.toFixed(1);
    return 'PC' + head + p + ';';
  }
  function cmdPtt(on) {
    // TX1 = "CAT TX ON", TX0 = "CAT TX OFF"
    return on ? 'TX1;' : 'TX0;';
  }

  /** Analyse une réponse (sans le ';'). Retourne un objet partiel ou null. */
  function parse(tok) {
    let m;
    if ((m = /^FA(\d{9})$/.exec(tok))) return { freq: parseInt(m[1], 10) };
    if ((m = /^FB(\d{9})$/.exec(tok))) return { freqB: parseInt(m[1], 10) };
    if ((m = /^MD0([0-9A-Z])$/.exec(tok))) return { modeCode: m[1], mode: MODES[m[1]] || ('?' + m[1]) };
    if ((m = /^MD1([0-9A-Z])$/.exec(tok))) return { modeCodeB: m[1], modeB: MODES[m[1]] || ('?' + m[1]) };
    if ((m = /^SM0(\d{3})$/.exec(tok))) return { smeter: parseInt(m[1], 10) };
    if ((m = /^TX([0-2])$/.exec(tok))) return { tx: parseInt(m[1], 10) }; // 0 off, 1 CAT TX, 2 TX radio
    if ((m = /^PC([12])(\d{3}|\d\.\d)$/.exec(tok))) return { powerHead: m[1], power: parseFloat(m[2]) };
    if (tok === '?') return { error: true };
    return null;
  }

  /** Découpe un flux série en réponses terminées par ';'. */
  class Splitter {
    constructor() { this.acc = ''; }
    push(text) {
      this.acc += text;
      if (this.acc.length > 4096) this.acc = this.acc.slice(-256); // garde-fou
      const out = [];
      let i;
      while ((i = this.acc.indexOf(';')) >= 0) {
        const tok = this.acc.slice(0, i).replace(/[\r\n\s]/g, '').toUpperCase();
        this.acc = this.acc.slice(i + 1);
        if (tok) out.push(tok);
      }
      return out;
    }
  }

  /**
   * Conversion approximative de la valeur SM (000–255) en S-mètre.
   * Échelle indicative : S9 vers 130, puis jusqu'à S9+60 à 255. À calibrer sur la radio.
   */
  function smeterLabel(v) {
    if (v == null) return '—';
    if (v <= 130) return 'S' + Math.max(0, Math.min(9, Math.round(v / 14.4)));
    return 'S9+' + Math.round(((v - 130) / 125) * 60);
  }

  /** Simulateur de FTX-1 : répond aux commandes comme la vraie radio (pour tester sans TRX). */
  class FakeFTX1 {
    constructor() {
      this.freq = 14250000;
      this.mode = '2';
      this.freqB = 7074000;
      this.head = '2';
      this.power = 100;
      this.modeB = 'C';
      this.tx = 0;
      this.onData = null;
      this.sp = new Splitter();
      this.t = 0;
    }
    write(str) {
      const out = [];
      for (const c of this.sp.push(str)) {
        let m;
        if (c === 'FA') out.push('FA' + String(this.freq).padStart(9, '0') + ';');
        else if ((m = /^FA(\d{9})$/.exec(c))) this.freq = parseInt(m[1], 10);
        else if (c === 'FB') out.push('FB' + String(this.freqB).padStart(9, '0') + ';');
        else if ((m = /^FB(\d{9})$/.exec(c))) this.freqB = parseInt(m[1], 10);
        else if (c === 'MD0') out.push('MD0' + this.mode + ';');
        else if (c === 'MD1') out.push('MD1' + this.modeB + ';');
        else if ((m = /^MD1([0-9A-Z])$/.exec(c)) && MODES[m[1]]) this.modeB = m[1];
        else if ((m = /^MD0([0-9A-Z])$/.exec(c)) && MODES[m[1]]) this.mode = m[1];
        else if (c === 'SM0') {
          this.t += 0.15;
          const v = this.tx ? 0 : Math.round(70 + 45 * Math.sin(this.t) + 20 * Math.random());
          out.push('SM0' + String(Math.max(0, Math.min(255, v))).padStart(3, '0') + ';');
        } else if (c === 'TX') out.push('TX' + this.tx + ';');
        else if (c === 'PC') out.push('PC' + this.head + String(this.power).padStart(3, '0') + ';');
        else if ((m = /^PC([12])(\d{3}|\d\.\d)$/.exec(c)) && m[1] === this.head) {
          const w = parseFloat(m[2]);
          if (w >= POWER_RANGE[this.head][0] && w <= POWER_RANGE[this.head][1]) this.power = w;
          else out.push('?;');
        }
        else if (c === 'TX1') this.tx = 1;
        else if (c === 'TX0') this.tx = 0;
        else if (c === 'AI0') { /* auto-information off */ }
        else out.push('?;');
      }
      if (out.length && this.onData) {
        const s = out.join('');
        setTimeout(() => this.onData && this.onData(s), 5);
      }
    }
  }

  const api = { MODES, SETTABLE, POLL, FREQ_MIN, FREQ_MAX, POWER_RANGE, cmdFreq, cmdMode, cmdPower, cmdPtt, parse, Splitter, smeterLabel, FakeFTX1 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FTX1 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
