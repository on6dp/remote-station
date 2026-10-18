/*
 * ftx1.js — pilote CAT du Yaesu FTX-1 (port Enhanced / CAT-1)
 *
 * Références :
 *  - FTX-1 CAT Operation Reference Manual (Yaesu, édition 2508-C)
 *  - Formats de commandes vérifiés sur radio réelle par RigPlane Core
 *    (rigs/ftx1.toml) — Copyright (c) 2026 Sergey Morozik (KN4KYD), licence MIT.
 *    Voir TIERS.md pour l'avis de licence.
 *
 * Format : 2 lettres + paramètres + ';'. Erreur renvoyée par la radio : "?;".
 * Utilisable dans le navigateur (window.FTX1, window.RIGS.ftx1) et dans Node (require).
 */
(function (root) {
  'use strict';

  const ID = 'ftx1';
  const NAME = 'Yaesu FTX-1';

  // Codes du paramètre P2 de la commande MD (MODE)
  const MODES = {
    '1': 'LSB', '2': 'USB', '3': 'CW-U', '4': 'FM', '5': 'AM',
    '6': 'RTTY-L', '7': 'CW-L', '8': 'DATA-L', '9': 'RTTY-U', 'A': 'DATA-FM',
    'B': 'FM-N', 'C': 'DATA-U', 'D': 'AM-N', 'E': 'PSK', 'F': 'DATA-FM-N',
    'H': 'C4FM-DN', 'I': 'C4FM-VW'
  };
  // Modes sélectionnables à distance (C4FM : affichage seulement)
  const SETTABLE = ['1', '2', '3', '7', '4', 'B', '5', 'D', '8', 'C', 'A', 'F', '6', '9', 'E'];

  const FREQ_MIN = 30000;
  const FREQ_MAX = 470000000;

  const pad = (n, w) => String(Math.abs(Math.round(Number(n)))).padStart(w, '0');
  const signed4 = (v) => (Number(v) < 0 ? '-' : '+') + pad(v, 4);
  const sgn = (s) => (s === '-' ? -1 : 1);

  // ------------------------------------------------------------ lectures
  // Lues à chaque cycle (250 ms)
  const FAST = 'FA;MD0;FB;MD1;SM0;TX;FT;';
  // Mesures lues uniquement en émission : COMP (3), ALC (4), PO (5), SWR (6)
  const TXMETERS = 'RM3;RM4;RM5;RM6;';
  // Réglages lus toutes les secondes. La réponse a le même format que la commande d'écriture.
  const READS = [
    { cmd: 'PC;', re: /^PC([12])(\d{3}|\d\.\d)$/, parse: (m) => ({ powerHead: m[1], power: parseFloat(m[2]) }), sim: 'PC2100' },
    { cmd: 'ST;', re: /^ST([0-2])$/, parse: (m) => ({ split: m[1] === '0' ? 0 : 1 }), sim: 'ST0' },
    { cmd: 'VS;', re: /^VS([01])$/, parse: (m) => ({ vfoSel: +m[1] }), sim: 'VS0' },
    { cmd: 'CF000;', re: /^CF000([01])([01])\d{3}$/, parse: (m) => ({ rit: +m[1], xit: +m[2] }), sim: 'CF00000000' },
    { cmd: 'CF001;', re: /^CF001([+-])(\d{4})$/, parse: (m) => ({ clar: sgn(m[1]) * +m[2] }), sim: 'CF001+0000' },
    { cmd: 'LK;', re: /^LK([01])$/, parse: (m) => ({ lock: +m[1] }), sim: 'LK0' },
    { cmd: 'SH0;', re: /^SH0(\d{3})$/, parse: (m) => ({ width: +m[1] }), sim: 'SH0013' },
    { cmd: 'NA0;', re: /^NA0([01])$/, parse: (m) => ({ narrow: +m[1] }), sim: 'NA00' },
    { cmd: 'IS0;', re: /^IS00([+-])(\d{4})$/, parse: (m) => ({ shift: sgn(m[1]) * +m[2] }), sim: 'IS00+0000' },
    { cmd: 'CO00;', re: /^CO00(\d{4})$/, parse: (m) => ({ contour: +m[1] ? 1 : 0 }), sim: 'CO000000' },
    { cmd: 'CO02;', re: /^CO02(\d{4})$/, parse: (m) => ({ apf: +m[1] ? 1 : 0 }), sim: 'CO020000' },
    { cmd: 'BC0;', re: /^BC0([01])$/, parse: (m) => ({ dnf: +m[1] }), sim: 'BC00' },
    { cmd: 'BP00;', re: /^BP00(\d{3})$/, parse: (m) => ({ notch: +m[1] ? 1 : 0 }), sim: 'BP00000' },
    { cmd: 'BP01;', re: /^BP01(\d{3})$/, parse: (m) => ({ notchFreq: +m[1] * 10 }), sim: 'BP01150' },
    { cmd: 'NL0;', re: /^NL0(\d{3})$/, parse: (m) => ({ nb: +m[1] }), sim: 'NL0000' },
    { cmd: 'RL0;', re: /^RL0(\d{2})$/, parse: (m) => ({ nr: +m[1] }), sim: 'RL000' },
    { cmd: 'AG0;', re: /^AG0(\d{3})$/, parse: (m) => ({ af: +m[1] }), sim: 'AG0128' },
    { cmd: 'RG0;', re: /^RG0(\d{3})$/, parse: (m) => ({ rf: +m[1] }), sim: 'RG0255' },
    { cmd: 'SQ0;', re: /^SQ0(\d{3})$/, parse: (m) => ({ sql: +m[1] }), sim: 'SQ0000' },
    { cmd: 'GT0;', re: /^GT0(\d)$/, parse: (m) => ({ agc: Math.min(4, +m[1]) }), sim: 'GT04' }, // 5-6 = variantes AUTO
    { cmd: 'PA0;', re: /^PA0([0-2])$/, parse: (m) => ({ preamp: +m[1] }), sim: 'PA00' },
    { cmd: 'RA0;', re: /^RA0([01])$/, parse: (m) => ({ att: +m[1] }), sim: 'RA00' },
    { cmd: 'MG;', re: /^MG(\d{3})$/, parse: (m) => ({ mic: +m[1] }), sim: 'MG050' },
    { cmd: 'PR0;', re: /^PR0([01])$/, parse: (m) => ({ proc: +m[1] }), sim: 'PR00' },
    { cmd: 'PL;', re: /^PL(\d{3})$/, parse: (m) => ({ procLvl: +m[1] }), sim: 'PL050' },
    { cmd: 'VX;', re: /^VX([01])$/, parse: (m) => ({ vox: +m[1] }), sim: 'VX0' },
    { cmd: 'AC;', re: /^AC([01])([0-2])([0-3])$/, parse: (m) => ({ tuner: m[3] === '0' ? 0 : 1, tuning: m[3] === '3' ? 1 : 0 }), sim: 'AC000' }
  ];
  // + tension (RM8, VDD) et courant (RM7, IDD), lisibles aussi en réception
  const SLOW = READS.map((r) => r.cmd).join('') + 'RM7;RM8;';

  // Clés d'état numériques relayées par le serveur (en plus de freq, mode, etc.)
  const STATE_KEYS = ['txVfo', 'split', 'vfoSel', 'rit', 'xit', 'clar', 'lock', 'width', 'narrow', 'shift', 'contour', 'apf',
    'dnf', 'notch', 'notchFreq', 'nb', 'nr', 'af', 'rf', 'sql', 'agc', 'preamp', 'att', 'mic', 'proc', 'procLvl', 'vox',
    'tuner', 'tuning', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];

  // ------------------------------------------------------------ largeurs de filtre (manuel CAT, Table 5)
  const WIDTH_SSB = [300, 400, 600, 850, 1100, 1200, 1500, 1650, 1800, 1950, 2100, 2250, 2400, 2450, 2500, 2600, 2700, 2800, 2900, 3000, 3200, 3500, 4000];
  const WIDTH_NARROW = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 800, 1200, 1400, 1700, 2000, 2400, 3000, 3200, 3500, 4000];
  /** Table des largeurs (code 1..n → Hz) pour un mode, ou null si largeur fixe (AM, FM). */
  function widthTable(mode) {
    if (mode === 'LSB' || mode === 'USB') return WIDTH_SSB;
    if (['CW-U', 'CW-L', 'DATA-L', 'DATA-U', 'RTTY-L', 'RTTY-U', 'PSK'].indexOf(mode) >= 0) return WIDTH_NARROW;
    return null;
  }

  // ------------------------------------------------------------ commandes réglables
  // type : toggle (0/1), select (options), level (min..max/step), width (code de filtre), action (sans valeur)
  // when(st) : disponible seulement si vrai ; transmits : provoque une émission (soumis aux règles du PTT)
  const GROUPS = [['vfo', 'VFO et SPLIT'], ['flt', 'Filtres et DSP'], ['rx', 'Réception'], ['tx', 'Émission']];
  const CONTROLS = [
    { id: 'split', g: 'vfo', label: 'SPLIT', type: 'toggle', write: (v) => 'ST' + v + ';' },
    { id: 'vfoSel', g: 'vfo', label: 'VFO active', type: 'select', options: [[0, 'MAIN (A)'], [1, 'SUB (B)']], write: (v) => 'VS' + v + ';' },
    { id: 'swap', g: 'vfo', label: 'A ⇄ B', type: 'action', write: () => 'SV;' },
    { id: 'aToB', g: 'vfo', label: 'A → B', type: 'action', write: () => 'AB;' },
    { id: 'bToA', g: 'vfo', label: 'B → A', type: 'action', write: () => 'BA;' },
    { id: 'rit', g: 'vfo', label: 'RIT', type: 'toggle', write: (v, s) => 'CF000' + v + (s.xit || 0) + '000;' },
    { id: 'xit', g: 'vfo', label: 'XIT', type: 'toggle', write: (v, s) => 'CF000' + (s.rit || 0) + v + '000;' },
    { id: 'clar', g: 'vfo', label: 'Décalage RIT/XIT', type: 'level', min: -9999, max: 9999, step: 10, unit: 'Hz', write: (v) => 'CF001' + signed4(v) + ';' },
    { id: 'lock', g: 'vfo', label: 'LOCK (face avant du club)', type: 'toggle', write: (v) => 'LK' + v + ';' },

    { id: 'width', g: 'flt', label: 'WIDTH', type: 'width', write: (v) => 'SH0' + pad(v, 3) + ';', when: (s) => !!widthTable(s.mode) && !s.narrow },
    { id: 'narrow', g: 'flt', label: 'NARROW', type: 'toggle', write: (v) => 'NA0' + v + ';' },
    { id: 'shift', g: 'flt', label: 'IF SHIFT', type: 'level', min: -1200, max: 1200, step: 20, unit: 'Hz', write: (v) => 'IS00' + signed4(v) + ';' },
    { id: 'contour', g: 'flt', label: 'CONTOUR', type: 'toggle', write: (v) => 'CO00' + pad(v, 4) + ';' },
    { id: 'apf', g: 'flt', label: 'APF', type: 'toggle', write: (v) => 'CO02' + pad(v, 4) + ';', when: (s) => /^CW/.test(s.mode || '') },
    { id: 'dnf', g: 'flt', label: 'DNF', type: 'toggle', write: (v) => 'BC0' + v + ';' },
    { id: 'notch', g: 'flt', label: 'NOTCH', type: 'toggle', write: (v) => 'BP00' + pad(v, 3) + ';' },
    { id: 'notchFreq', g: 'flt', label: 'Fréquence NOTCH', type: 'level', min: 10, max: 3200, step: 10, unit: 'Hz', write: (v) => 'BP01' + pad(v / 10, 3) + ';', when: (s) => !/FM/.test(s.mode || '') },
    { id: 'nb', g: 'flt', label: 'NB', type: 'level', min: 0, max: 10, step: 1, off0: true, write: (v) => 'NL0' + pad(v, 3) + ';' },
    { id: 'nr', g: 'flt', label: 'DNR', type: 'level', min: 0, max: 10, step: 1, off0: true, write: (v) => 'RL0' + pad(v, 2) + ';' },

    { id: 'af', g: 'rx', label: 'AF', type: 'level', min: 0, max: 255, step: 1, pct: true, write: (v) => 'AG0' + pad(v, 3) + ';' },
    { id: 'rf', g: 'rx', label: 'RF', type: 'level', min: 0, max: 255, step: 1, pct: true, write: (v) => 'RG0' + pad(v, 3) + ';' },
    { id: 'sql', g: 'rx', label: 'Squelch', type: 'level', min: 0, max: 255, step: 1, pct: true, write: (v) => 'SQ0' + pad(v, 3) + ';' },
    { id: 'agc', g: 'rx', label: 'AGC', type: 'select', options: [[0, 'OFF'], [1, 'FAST'], [2, 'MID'], [3, 'SLOW'], [4, 'AUTO']], write: (v) => 'GT0' + v + ';' },
    { id: 'preamp', g: 'rx', label: 'Préampli', type: 'select', options: [[0, 'IPO'], [1, 'AMP1'], [2, 'AMP2']], write: (v) => 'PA0' + v + ';', when: (s) => s.freq != null && s.freq <= 54000000 },
    { id: 'att', g: 'rx', label: 'ATT', type: 'toggle', write: (v) => 'RA0' + v + ';', when: (s) => s.freq != null && s.freq <= 60000000 && !s.vfoSel },

    { id: 'mic', g: 'tx', label: 'Gain micro', type: 'level', min: 0, max: 100, step: 1, write: (v) => 'MG' + pad(v, 3) + ';' },
    { id: 'proc', g: 'tx', label: 'PROC', type: 'toggle', write: (v) => 'PR0' + v + ';' },
    { id: 'procLvl', g: 'tx', label: 'Niveau PROC', type: 'level', min: 0, max: 100, step: 1, write: (v) => 'PL' + pad(v, 3) + ';' },
    // VOX : on peut le couper à distance, jamais l'activer (il pourrait émettre hors du contrôle du PTT)
    { id: 'vox', g: 'tx', label: 'VOX', type: 'toggle', offOnly: true, write: (v) => 'VX' + v + ';' },
    { id: 'tuner', g: 'tx', label: 'Tuner', type: 'toggle', write: (v) => 'AC00' + v + ';' },
    { id: 'tune', g: 'tx', label: 'TUNE', type: 'action', transmits: true, write: () => 'AC003;' }
  ];
  const CONTROL = {};
  CONTROLS.forEach((c) => { CONTROL[c.id] = c; });

  /**
   * Valide et normalise une valeur pour une commande. Lève une erreur en français si invalide.
   * opts.skipWhen : ne pas vérifier la disponibilité (la station, dont l'état peut avoir un cycle de retard,
   * laisse ce contrôle au serveur).
   */
  function validate(id, value, st, opts) {
    const c = CONTROL[id];
    if (!c) throw new Error('commande inconnue');
    st = st || {};
    if (c.when && !(opts && opts.skipWhen) && !c.when(st)) throw new Error(c.label + ' indisponible dans cette configuration');
    if (c.type === 'action') return null;
    const v = Number(value);
    if (c.type === 'toggle') {
      if (v !== 0 && v !== 1) throw new Error('valeur invalide');
      if (c.offOnly && v === 1) throw new Error(c.label + ' ne peut pas être activé à distance');
      return v;
    }
    if (c.type === 'select') {
      if (!c.options.some((o) => o[0] === v)) throw new Error('valeur invalide');
      return v;
    }
    if (c.type === 'level') {
      if (!(v >= c.min && v <= c.max)) throw new Error(c.label + ' : ' + c.min + ' à ' + c.max);
      return Math.round(v / c.step) * c.step;
    }
    if (c.type === 'width') {
      const t = widthTable(st.mode) || (opts && opts.skipWhen ? WIDTH_SSB : null);
      if (!t || !(Number.isInteger(v) && v >= 1 && v <= t.length)) throw new Error('largeur invalide pour ce mode');
      return v;
    }
    throw new Error('type inconnu');
  }

  // ------------------------------------------------------------ commandes de base
  function cmdFreq(hz) {
    hz = Math.round(Number(hz));
    if (!(hz >= FREQ_MIN && hz <= FREQ_MAX)) throw new Error('fréquence hors limites');
    return 'FA' + pad(hz, 9) + ';';
  }
  function cmdFreqB(hz) {
    hz = Math.round(Number(hz));
    if (!(hz >= FREQ_MIN && hz <= FREQ_MAX)) throw new Error('fréquence hors limites');
    return 'FB' + pad(hz, 9) + ';';
  }
  function cmdMode(code, sub) {
    code = String(code).toUpperCase();
    if (SETTABLE.indexOf(code) < 0) throw new Error('mode non autorisé');
    return (sub ? 'MD1' : 'MD0') + code + ';';
  }
  /**
   * Puissance : P1 = 1 tête Field (0,5–10 W, dixièmes sous 10 W : "PC10.5;"), P1 = 2 ampli SPA-1 (5–100 W, "PC2025;").
   */
  const POWER_RANGE = { '1': [0.5, 10], '2': [5, 100] };
  function cmdPower(watts, head) {
    const r = POWER_RANGE[head];
    if (!r) throw new Error('type de tête inconnu, puissance non réglable');
    let w = Math.round(Number(watts) * 2) / 2;
    if (!(w >= r[0] && w <= r[1])) throw new Error('puissance hors plage (' + r[0] + '–' + r[1] + ' W)');
    if (head === '2') w = Math.round(w);
    const p = Number.isInteger(w) ? pad(w, 3) : w.toFixed(1);
    return 'PC' + head + p + ';';
  }
  function cmdPtt(on) {
    return on ? 'TX1;' : 'TX0;'; // TX1 = CAT TX ON, TX0 = CAT TX OFF
  }

  // ------------------------------------------------------------ analyse des réponses
  function parse(tok) {
    let m;
    if ((m = /^FA(\d{9})$/.exec(tok))) return { freq: parseInt(m[1], 10) };
    if ((m = /^FB(\d{9})$/.exec(tok))) return { freqB: parseInt(m[1], 10) };
    if ((m = /^MD0([0-9A-Z])$/.exec(tok))) return { modeCode: m[1], mode: MODES[m[1]] || ('?' + m[1]) };
    if ((m = /^MD1([0-9A-Z])$/.exec(tok))) return { modeCodeB: m[1], modeB: MODES[m[1]] || ('?' + m[1]) };
    if ((m = /^SM0(\d{3})$/.exec(tok))) return { smeter: parseInt(m[1], 10) };
    if ((m = /^TX([0-2])$/.exec(tok))) return { tx: parseInt(m[1], 10) }; // 0 RX, 1 TX par CAT, 2 TX par la radio
    if ((m = /^FT([01])$/.exec(tok))) return { txVfo: +m[1] };
    if ((m = /^RM([3-8])(\d{3})(\d{3})$/.exec(tok))) return { ['m' + m[1]]: +m[2] };
    if (tok === '?') return { error: true };
    for (const r of READS) if ((m = r.re.exec(tok))) return r.parse(m);
    return null;
  }

  /** Découpe un flux série en réponses terminées par ';'. */
  class Splitter {
    constructor() { this.acc = ''; }
    push(text) {
      this.acc += text;
      if (this.acc.length > 4096) this.acc = this.acc.slice(-256);
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

  // ------------------------------------------------------------ étalonnages (indicatifs, d'après RigPlane)
  const S_CAL = [[0, 'S0'], [26, 'S1'], [39, 'S2'], [52, 'S3'], [65, 'S4'], [78, 'S5'], [91, 'S6'], [103, 'S7'], [117, 'S8'], [130, 'S9'], [165, 'S9+10'], [200, 'S9+20'], [240, 'S9+40']];
  function smeterLabel(v) {
    if (v == null) return '—';
    let l = 'S0';
    for (const [raw, lab] of S_CAL) if (v >= raw) l = lab;
    return l;
  }
  const SWR_CAL = [[0, 1.0], [48, 1.5], [96, 2.0], [160, 3.0], [255, 5.0]];
  function swrValue(raw) {
    if (raw == null) return null;
    for (let i = 1; i < SWR_CAL.length; i++) {
      const [r0, s0] = SWR_CAL[i - 1];
      const [r1, s1] = SWR_CAL[i];
      if (raw <= r1) return s0 + ((raw - r0) / (r1 - r0)) * (s1 - s0);
    }
    return 5;
  }

  // Tension et courant : étalonnage à deux points mesuré par RigPlane (210 → 13,8 V ; 29 → 1,0 A)
  function vdValue(raw) { return raw == null ? null : (raw / 210) * 13.8; }
  function idValue(raw) { return raw == null ? null : raw / 29; }

  // ------------------------------------------------------------ simulateur (tests sans radio)
  class FakeFTX1 {
    constructor() {
      this.freq = 14250000;
      this.mode = '2';
      this.freqB = 7074000;
      this.modeB = 'C';
      this.head = '2';
      this.power = 100;
      this.tx = 0;
      this.ans = {};
      for (const r of READS) if (r.cmd !== 'PC;') this.ans[r.cmd] = r.sim;
      this.onData = null;
      this.sp = new Splitter();
      this.t = 0;
    }
    get split() { return this.ans['ST;'] !== 'ST0'; }
    write(str) {
      const out = [];
      for (const c of this.sp.push(str)) {
        let m;
        if (c === 'FA') out.push('FA' + pad(this.freq, 9) + ';');
        else if ((m = /^FA(\d{9})$/.exec(c))) this.freq = parseInt(m[1], 10);
        else if (c === 'FB') out.push('FB' + pad(this.freqB, 9) + ';');
        else if ((m = /^FB(\d{9})$/.exec(c))) this.freqB = parseInt(m[1], 10);
        else if (c === 'MD0') out.push('MD0' + this.mode + ';');
        else if (c === 'MD1') out.push('MD1' + this.modeB + ';');
        else if ((m = /^MD0([0-9A-Z])$/.exec(c)) && MODES[m[1]]) this.mode = m[1];
        else if ((m = /^MD1([0-9A-Z])$/.exec(c)) && MODES[m[1]]) this.modeB = m[1];
        else if (c === 'SM0') {
          this.t += 0.15;
          const v = this.tx ? 0 : Math.round(70 + 45 * Math.sin(this.t) + 20 * Math.random());
          out.push('SM0' + pad(Math.max(0, Math.min(255, v)), 3) + ';');
        } else if (c === 'TX') out.push('TX' + this.tx + ';');
        else if (c === 'TX1') this.tx = 1;
        else if (c === 'TX0') this.tx = 0;
        else if (c === 'FT') out.push('FT' + (this.split ? 1 : 0) + ';');
        else if ((m = /^RM([3-8])$/.exec(c))) {
          const raw = m[1] === '8' ? (this.tx ? 205 : 212) : m[1] === '7' ? (this.tx ? Math.round(this.power * 0.6) : 0)
            : !this.tx ? 0 : { 3: 20, 4: 60, 5: Math.round(this.power * 2.4), 6: 40 }[m[1]];
          out.push('RM' + m[1] + pad(raw, 3) + '000;');
        } else if (c === 'PC') out.push('PC' + this.head + pad(this.power, 3) + ';');
        else if ((m = /^PC([12])(\d{3}|\d\.\d)$/.exec(c))) {
          const w = parseFloat(m[2]);
          if (m[1] === this.head && w >= POWER_RANGE[this.head][0] && w <= POWER_RANGE[this.head][1]) this.power = w;
          else out.push('?;');
        } else if (c === 'SV') {
          [this.freq, this.freqB, this.mode, this.modeB] = [this.freqB, this.freq, this.modeB, this.mode];
        } else if (c === 'AB') { this.freqB = this.freq; this.modeB = this.mode; }
        else if (c === 'BA') { this.freq = this.freqB; this.mode = this.modeB; }
        else if (c === 'AC003') this.ans['AC;'] = 'AC001';
        else if (c === 'AI0') { /* auto-information coupée */ }
        else if (this.ans[c + ';'] != null) out.push(this.ans[c + ';'] + ';');
        else {
          const r = READS.find((x) => x.cmd !== 'PC;' && x.re.test(c));
          if (r) this.ans[r.cmd] = c;
          else out.push('?;');
        }
      }
      if (out.length && this.onData) {
        const s = out.join('');
        setTimeout(() => this.onData && this.onData(s), 5);
      }
    }
  }

  const api = {
    ID, NAME, MODES, SETTABLE, FREQ_MIN, FREQ_MAX, POWER_RANGE, FAST, SLOW, TXMETERS, POLL: FAST, READS, STATE_KEYS,
    GROUPS, CONTROLS, CONTROL, validate, widthTable, cmdFreq, cmdFreqB, cmdMode, cmdPower, cmdPtt, parse, Splitter,
    smeterLabel, swrValue, vdValue, idValue, FakeFTX1, Fake: FakeFTX1,
    serial: { baudRate: 38400, stopBits: 1, portHint: 'Enhanced COM Port (CAT-1)' }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.FTX1 = api;
    root.RIGS = root.RIGS || {};
    root.RIGS[ID] = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
