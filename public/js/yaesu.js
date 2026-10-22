/*
 * yaesu.js — base commune des pilotes CAT texte Yaesu (FTX-1, FTDX10…)
 *
 * Chaque pilote décrit seulement ses différences (puissance, atténuateur, processeur, largeurs…) ;
 * ce module fournit le reste : lectures, réglages, analyse des réponses, simulateur.
 *
 * Format CAT : 2 lettres + paramètres + ';'. Erreur renvoyée par la radio : "?;".
 * Références : manuels CAT Yaesu (FTX-1 2508-C, FTDX10) et RigPlane Core (MIT, voir TIERS.md).
 */
(function (root) {
  'use strict';

  const pad = (n, w) => String(Math.abs(Math.round(Number(n)))).padStart(w, '0');
  const signed4 = (v) => (Number(v) < 0 ? '-' : '+') + pad(v, 4);
  const sgn = (s) => (s === '-' ? -1 : 1);

  // Codes P2 de la commande MD, communs aux Yaesu récents
  const MODES = {
    '1': 'LSB', '2': 'USB', '3': 'CW-U', '4': 'FM', '5': 'AM',
    '6': 'RTTY-L', '7': 'CW-L', '8': 'DATA-L', '9': 'RTTY-U', 'A': 'DATA-FM',
    'B': 'FM-N', 'C': 'DATA-U', 'D': 'AM-N', 'E': 'PSK', 'F': 'DATA-FM-N'
  };
  const SETTABLE = ['1', '2', '3', '7', '4', 'B', '5', 'D', '8', 'C', 'A', 'F', '6', '9', 'E'];
  // Touches de mode de la face avant : [code, libellé]
  const MODE_KEYS = [
    ['1', 'LSB'], ['2', 'USB'], ['7', 'CW-L'], ['3', 'CW-U'], ['6', 'RTTY-L'], ['9', 'RTTY-U'],
    ['8', 'DATA-L'], ['C', 'DATA-U'], ['E', 'PSK'], ['5', 'AM'], ['D', 'AM-N'], ['4', 'FM'],
    ['B', 'FM-N'], ['A', 'DATA-FM']
  ];

  // Largeurs de filtre (code 1..n → Hz)
  const WIDTH_SSB = [300, 400, 600, 850, 1100, 1200, 1500, 1650, 1800, 1950, 2100, 2250, 2400, 2450, 2500, 2600, 2700, 2800, 2900, 3000, 3200, 3500, 4000];
  const WIDTH_NARROW = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 800, 1200, 1400, 1700, 2000, 2400, 3000, 3200, 3500, 4000];
  const NARROW_MODES = ['CW-U', 'CW-L', 'DATA-L', 'DATA-U', 'RTTY-L', 'RTTY-U', 'PSK'];

  // Étalonnages indicatifs (RigPlane, mesurés sur FTX-1)
  const S_CAL = [[0, 'S0'], [26, 'S1'], [39, 'S2'], [52, 'S3'], [65, 'S4'], [78, 'S5'], [91, 'S6'], [103, 'S7'], [117, 'S8'], [130, 'S9'], [165, 'S9+10'], [200, 'S9+20'], [240, 'S9+40']];
  const SWR_CAL = [[0, 1.0], [48, 1.5], [96, 2.0], [160, 3.0], [255, 5.0]];

  /** Lectures communes (toutes les secondes). Chaque entrée : commande, motif de réponse, analyse, réponse simulée. */
  function baseReads() {
    return [
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
  }

  /** Réglages communs. type : toggle, select, level, width, action. when(st) : disponibilité. transmits : émission. */
  function baseControls(widthTable) {
    return [
      { id: 'split', g: 'vfo', label: 'SPLIT', type: 'toggle', write: (v) => 'ST' + v + ';' },
      { id: 'vfoSel', g: 'vfo', label: 'VFO active', type: 'select', options: [[0, 'MAIN (A)'], [1, 'SUB (B)']], write: (v) => 'VS' + v + ';' },
      { id: 'swap', g: 'vfo', label: 'A ⇄ B', type: 'action', write: () => 'SV;' },
      { id: 'aToB', g: 'vfo', label: 'A → B', type: 'action', write: () => 'AB;' },
      { id: 'bToA', g: 'vfo', label: 'B → A', type: 'action', write: () => 'BA;' },
      { id: 'rit', g: 'vfo', label: 'RIT', type: 'toggle', write: (v, s) => 'CF000' + v + (s.xit || 0) + '000;' },
      { id: 'xit', g: 'vfo', label: 'XIT', type: 'toggle', write: (v, s) => 'CF000' + (s.rit || 0) + v + '000;' },
      { id: 'clar', g: 'vfo', label: 'Décalage RIT/XIT', type: 'level', min: -9999, max: 9999, step: 10, unit: 'Hz', write: (v) => 'CF001' + signed4(v) + ';' },
      { id: 'clarClr', g: 'vfo', label: 'CLEAR (décalage RIT/XIT à zéro)', type: 'action', write: () => 'CF001+0000;' },
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
  }

  /** Découpe un flux série (texte ou octets) en réponses terminées par ';'. */
  class Splitter {
    constructor() { this.acc = ''; }
    push(chunk) {
      if (typeof chunk !== 'string') {
        let s = '';
        for (let i = 0; i < chunk.length; i++) s += String.fromCharCode(chunk[i]);
        chunk = s;
      }
      this.acc += chunk;
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

  /**
   * Construit un pilote Yaesu.
   * spec : ID, NAME, FREQ_MAX, extraModes, power {read, re, parse, range, step, cmd, fakeRead, fakeWrite},
   *        readOverrides {cmd: lecture|null}, controlOverrides {id: modifs|null}, extraReads, extraControls,
   *        widthTable, tuneCmd, serial, hint
   */
  function build(spec) {
    const ID = spec.ID;
    const NAME = spec.NAME;
    const FREQ_MIN = 30000;
    const FREQ_MAX = spec.FREQ_MAX;
    const MODES_ALL = Object.assign({}, MODES, spec.extraModes || {});
    const widthTable = spec.widthTable || function (mode) {
      if (mode === 'LSB' || mode === 'USB') return WIDTH_SSB;
      if (NARROW_MODES.indexOf(mode) >= 0) return WIDTH_NARROW;
      return null;
    };
    const P = spec.power;

    // Lectures : puissance du modèle + lectures communes, éventuellement remplacées
    const READS = [{ cmd: P.read, re: P.re, parse: P.parse, sim: null, power: true }];
    for (const r of baseReads()) {
      const o = spec.readOverrides && Object.prototype.hasOwnProperty.call(spec.readOverrides, r.cmd) ? spec.readOverrides[r.cmd] : r;
      if (o) READS.push(Object.assign({ cmd: r.cmd }, o));
    }
    for (const r of spec.extraReads || []) READS.push(r);
    // Les commandes partent une par une, espacées (FRAME_GAP_MS) : une rafale de 30 commandes
    // déborde le tampon CAT de la radio, qui en perd une partie (mode non lu, « plus de réponse »…)
    const FAST = ['FA;', 'MD0;', 'FB;', 'MD1;', 'SM0;', 'TX;', 'FT;'];
    // En émission : mesures COMP, ALC, PO, SWR, et aussi puissance et VOX (contrôles de sécurité plus rapides)
    const TXMETERS = ['RM3;', 'RM4;', 'RM5;', 'RM6;', P.read, 'VX;'];
    const SLOW = READS.map((r) => r.cmd).concat(['RM7;', 'RM8;']); // + IDD, VDD
    // Commande de lecture de chaque clé d'état : relue juste après un réglage, sans attendre le tour complet
    const READ_FOR = {};
    function readFor(id) {
      if (!Object.keys(READ_FOR).length) {
        for (const r of READS) {
          const m = r.sim && r.re.exec(r.sim);
          if (m) for (const k of Object.keys(r.parse(m))) READ_FOR[k] = r.cmd;
        }
        READ_FOR.power = P.read;
        READ_FOR.powerHead = P.read;
        // CLEAR : relire le décalage tout de suite
        if (READ_FOR.clar) READ_FOR.clarClr = READ_FOR.clar;
        if (READ_FOR.clarB) READ_FOR.clarClrB = READ_FOR.clarB;
      }
      return READ_FOR[id] || null;
    }
    const STATE_KEYS = ['txVfo', 'split', 'vfoSel', 'rit', 'xit', 'clar', 'lock', 'width', 'narrow', 'shift', 'contour', 'apf',
      'dnf', 'notch', 'notchFreq', 'nb', 'nr', 'af', 'rf', 'sql', 'agc', 'preamp', 'att', 'mic', 'proc', 'procLvl', 'vox',
      'tuner', 'tuning', 'ant', 'ritB', 'xitB', 'clarB', 'hwSplit', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];

    // Réglages
    const CONTROLS = [];
    for (const c of baseControls(widthTable)) {
      const ov = spec.controlOverrides && Object.prototype.hasOwnProperty.call(spec.controlOverrides, c.id) ? spec.controlOverrides[c.id] : undefined;
      if (ov === null) continue;
      CONTROLS.push(Object.assign({}, c, ov || {}));
    }
    for (const c of spec.extraControls || []) CONTROLS.push(c);
    for (const c of spec.extraControlsLate || []) CONTROLS.push(c);
    const CONTROL = {};
    CONTROLS.forEach((c) => { CONTROL[c.id] = c; });

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
    const cmdPower = P.cmd;
    function cmdPtt(on) { return on ? 'TX1;' : 'TX0;'; } // TX1 = CAT TX ON, TX0 = CAT TX OFF
    // Changement de bande par BS (BAND SELECT), comme la touche BAND : la radio rappelle sa propre mémoire de bande
    // (dernière fréquence et dernier mode). Seulement pour les modèles qui déclarent leurs codes de bande.
    const BAND_CODES = spec.bandCodes || null;
    function cmdBand(name, sub) {
      if (!BAND_CODES || !Object.prototype.hasOwnProperty.call(BAND_CODES, name)) throw new Error('bande inconnue');
      return 'BS' + (sub ? '1' : '0') + BAND_CODES[name][0] + ';';
    }

    function parse(tok) {
      let m;
      if ((m = /^FA(\d{9})$/.exec(tok))) return { freq: parseInt(m[1], 10) };
      if ((m = /^FB(\d{9})$/.exec(tok))) return { freqB: parseInt(m[1], 10) };
      if ((m = /^MD0([0-9A-Z])$/.exec(tok))) return { modeCode: m[1], mode: MODES_ALL[m[1]] || ('?' + m[1]) };
      if ((m = /^MD1([0-9A-Z])$/.exec(tok))) return { modeCodeB: m[1], modeB: MODES_ALL[m[1]] || ('?' + m[1]) };
      if ((m = /^SM0(\d{3})$/.exec(tok))) return { smeter: parseInt(m[1], 10) };
      if ((m = /^TX([0-2])$/.exec(tok))) return { tx: parseInt(m[1], 10) }; // 0 RX, 1 TX par CAT, 2 TX par la radio
      // FT : VFO d'émission. Modèles « splitIsFT » (FTX-1) : le SPLIT, c'est FT1 (TX sur SUB), jamais ST1
      if ((m = /^FT([01])$/.exec(tok))) return spec.splitIsFT ? { txVfo: +m[1], split: +m[1] } : { txVfo: +m[1] };
      if ((m = /^RM([3-8])(\d{3})(\d{3})$/.exec(tok))) return { ['m' + m[1]]: +m[2] };
      if (tok === '?') return { error: true };
      for (const r of READS) if ((m = r.re.exec(tok))) return r.parse(m);
      return null;
    }

    function smeterLabel(v) {
      if (v == null) return '—';
      let l = 'S0';
      for (const [raw, lab] of S_CAL) if (v >= raw) l = lab;
      return l;
    }
    function swrValue(raw) {
      if (raw == null) return null;
      for (let i = 1; i < SWR_CAL.length; i++) {
        const [r0, s0] = SWR_CAL[i - 1];
        const [r1, s1] = SWR_CAL[i];
        if (raw <= r1) return s0 + ((raw - r0) / (r1 - r0)) * (s1 - s0);
      }
      return 5;
    }
    function vdValue(raw) { return raw == null ? null : (raw / 210) * 13.8; }
    function idValue(raw) { return raw == null ? null : raw / 29; }

    // ---------------------------------------------------------- simulateur
    class Fake {
      constructor() {
        this.freq = 14250000;
        this.mode = '2';
        this.freqB = 7074000;
        this.modeB = 'C';
        this.power = 100;
        this.head = P.fakeHead;
        this.tx = 0;
        this.ans = {};
        for (const r of READS) if (!r.power) this.ans[r.cmd] = r.sim;
        this.onData = null;
        this.sp = new Splitter();
        this.t = 0;
        this.swrRaw = 40; // ROS simulé (40 ≈ 1,4:1) ; un accord le ramène à 40
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
          else if ((m = /^MD0([0-9A-Z])$/.exec(c)) && MODES_ALL[m[1]]) this.mode = m[1];
          else if ((m = /^MD1([0-9A-Z])$/.exec(c)) && MODES_ALL[m[1]]) this.modeB = m[1];
          else if (c === 'SM0') {
            this.t += 0.15;
            const v = this.tx ? 0 : Math.round(70 + 45 * Math.sin(this.t) + 20 * Math.random());
            out.push('SM0' + pad(Math.max(0, Math.min(255, v)), 3) + ';');
          } else if (c === 'TX') out.push('TX' + this.tx + ';');
          else if (c === 'TX1') this.tx = 1;
          else if (c === 'TX0') this.tx = 0;
          else if (c === 'FT') out.push('FT' + (spec.splitIsFT ? this.txv || 0 : this.split ? 1 : 0) + ';');
          else if ((m = /^FT([0-3])$/.exec(c))) { if (this.ftMode === 'deaf') { /* essai : TRX qui ignore FT */ } else if (this.ftMode === 'x23' ? +m[1] >= 2 : +m[1] < 2) this.txv = +m[1] % 2; else if (this.ftMode === 'x23') out.push('?;'); }
          else if (spec.splitIsFT && /^ST[0-2]$/.test(c)) { this.ans['ST;'] = c; if (c !== 'ST0') this.tx = 2; } // ST1 par CAT : le FTX-1 émet sur le SUB
          else if ((m = /^RM([3-8])$/.exec(c))) {
            const raw = m[1] === '8' ? (this.tx ? 205 : 212) : m[1] === '7' ? (this.tx ? Math.round(this.power * 0.6) : 0)
              : !this.tx ? 0 : { 3: 20, 4: 60, 5: this.silent ? 0 : Math.round(this.power * 2.4), 6: this.swrRaw }[m[1]];
            out.push('RM' + m[1] + pad(raw, 3) + '000;');
          } else if (c + ';' === P.read) out.push(P.fakeRead(this) + ';');
          else if (P.re.test(c)) { if (!P.fakeWrite(this, c)) out.push('?;'); }
          else if (c === 'SV') {
            [this.freq, this.freqB, this.mode, this.modeB] = [this.freqB, this.freq, this.modeB, this.mode];
          } else if (c === 'AB') { this.freqB = this.freq; this.modeB = this.mode; }
          else if (c === 'BA') { this.freq = this.freqB; this.mode = this.modeB; }
          else if (CONTROL.tune && c + ';' === CONTROL.tune.write()) { this.ans['AC;'] = spec.fakeTuning || 'AC001'; this.swrRaw = 40; }
          else if (c === 'AI0') { /* auto-information coupée */ }
          else if ((m = /^BS([01])(\d\d)$/.exec(c)) && BAND_CODES) {
            const b = Object.keys(BAND_CODES).find((k) => BAND_CODES[k][0] === m[2]);
            if (!b) out.push('?;');
            else if (m[1] === '1') this.freqB = BAND_CODES[b][1];
            else this.freq = BAND_CODES[b][1];
          }
          else if (this.ans[c + ';'] != null) out.push(this.ans[c + ';'] + ';');
          else {
            const r = READS.find((x) => !x.power && x.re.test(c));
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

    return {
      ID, NAME, MODES: MODES_ALL, SETTABLE, MODE_KEYS, FREQ_MIN, FREQ_MAX,
      POWER_RANGE: P.range, POWER_STEP: P.step, INIT: spec.splitIsFT ? 'AI0;ST0;' : 'AI0;', UNKEY_EXTRA: spec.splitIsFT ? 'ST0;' : '',
      // SPLIT « virtuel » (FTX-1) : le VFO d'émission n'est envoyé au TRX qu'au moment d'émettre (FT), puis remis
      // Lectures CAT autorisées depuis la console de diagnostic (administrateurs) : lectures seulement
      CAT_QUERIES: Array.from(new Set(READS.map((r) => r.cmd).concat(FAST, TXMETERS, ['IF;', 'OI;', 'FR;', 'ID;', 'VS;', 'FT;', 'ST;', 'FA;', 'FB;']))),
      VIRTUAL_SPLIT: !!spec.virtualSplit, cmdTxVfo: spec.virtualSplit ? (v) => 'FT' + (v ? 1 : 0) + ';' : null,
      // Façons de désigner le VFO d'émission, essayées dans l'ordre jusqu'à ce que « FT; » relu le confirme
      // (FT0/FT1 comme Hamlib ; FT2/FT3 comme les FTDX10 / FT-991 ; VS puis FT si le TRX lie les deux)
      txVfoTries: spec.virtualSplit ? (v) => ['FT' + (v ? 1 : 0) + ';', 'FT' + (v ? 3 : 2) + ';', 'VS' + (v ? 1 : 0) + ';FT' + (v ? 1 : 0) + ';'] : null,
      cmdVfoSel: (v) => 'VS' + (v ? 1 : 0) + ';', // FTX-1 : sortir d'un éventuel ST1 (SUB bloqué en émission)
      FAST, SLOW, TXMETERS, POLL: FAST, READS, STATE_KEYS,
      FRAME_GAP_MS: 20, SLOW_PER_TICK: 4, POLL_MS: 250, readFor,
      GROUPS: [['vfo', 'VFO et SPLIT'], ['flt', 'Filtres et DSP'], ['rx', 'Réception'], ['tx', 'Émission']],
      CONTROLS, CONTROL, validate, widthTable, cmdFreq, cmdFreqB, cmdMode, cmdPower, cmdPtt, parse, Splitter,
      BAND_CODES, cmdBand: BAND_CODES ? cmdBand : null,
      smeterLabel, swrValue, vdValue, idValue, Fake, FakeFTX1: Fake,
      serial: spec.serial, hint: spec.hint
    };
  }

  const api = { build, pad, signed4, sgn, WIDTH_SSB, WIDTH_NARROW, NARROW_MODES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.YAESU = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
