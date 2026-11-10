/*
 * ftdx5000.js — pilote CAT du Yaesu FTDX5000 (D / MP / Limited)
 *
 * Référence : FTDX5000 CAT Operation Reference Book (Yaesu). Seulement les commandes de ce manuel.
 * Pas de port USB sur ce TRX : prise CAT RS-232C (4800 à 38400 bps, menu 032) + adaptateur USB ↔ série côté PC ;
 * le son passe par une interface séparée (RigExpert TI-5000, SignaLink…) branchée sur la prise DATA (PACKET).
 * Deux récepteurs complets (MAIN = VFO-A, SUB = VFO-B, P1 = 0 / 1), comme le FTDX101. Différences avec les Yaesu récents :
 * fréquences FA / FB sur 8 chiffres, modes sans AM-N / PSK / DATA-FM-N, pas de ST (SPLIT = VFO d'émission par FT2 / FT3),
 * pas de CF (clarifier : RT / XT / RC / RU / RD, décalage lu dans IF / OI), FR sur un chiffre (0 à 3), largeurs SH sur
 * 2 chiffres, IF SHIFT ±1000 Hz, préampli IPO1 / AMP1 / AMP2 / IPO2, PR sans côté, RM et SM sur 3 chiffres,
 * menus EX sur 3 chiffres (001-176), puissance PC 005-200 W, couverture 30 kHz – 60 MHz.
 */
(function (root) {
  'use strict';
  const Y = (typeof module !== 'undefined' && module.exports) ? require('./yaesu.js') : root.YAESU;
  const pad = Y.pad;
  const signed4 = Y.signed4;
  const RANGE = { D: [5, 200] };

  // Modes (MD P1 P2) : 1 LSB, 2 USB, 3 CW, 4 FM, 5 AM, 6 FSK (RTTY-LSB), 7 CW-R, 8 PKT-L, 9 FSK-R (RTTY-USB), A PKT-FM, B FM-N, C PKT-U
  // Noms communs aux autres Yaesu (pages, carte de bande, modes numériques) : PKT = DATA, FSK = RTTY, CW / CW-R = CW-U / CW-L
  const MODES = { '1': 'LSB', '2': 'USB', '3': 'CW-U', '4': 'FM', '5': 'AM', '6': 'RTTY-L', '7': 'CW-L', '8': 'DATA-L', '9': 'RTTY-U', 'A': 'DATA-FM', 'B': 'FM-N', 'C': 'DATA-U' };
  const SETTABLE = ['1', '2', '3', '7', '4', 'B', '5', '8', 'C', 'A', '6', '9'];
  const MODE_KEYS = [['1', 'LSB'], ['2', 'USB'], ['7', 'CW-L'], ['3', 'CW-U'], ['6', 'RTTY-L'], ['9', 'RTTY-U'], ['8', 'DATA-L'], ['C', 'DATA-U'],
    ['5', 'AM'], ['4', 'FM'], ['B', 'FM-N'], ['A', 'DATA-FM']];

  // Largeurs (SH P1 P2P2, manuel CAT) — SSB : codes 01-25 (14 non attribué) ; CW / RTTY / PKT : codes 01-16
  const SSB_24 = [200, 400, 600, 850, 1100, 1350, 1500, 1650, 1800, 1950, 2100, 2250, 2400, 2500, 2600, 2700, 2800, 2900, 3000, 3200, 3400, 3600, 3800, 4000];
  const NAR_16 = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 800, 1200, 1400, 1700, 2000, 2400];
  const isSsb = (mode) => mode === 'LSB' || mode === 'USB';
  // Rang dans la table (1…) ↔ code du TRX : en SSB, les codes 15-25 sont les rangs 14-24
  const wCode = (mode, v) => (isSsb(mode) && v >= 14 ? v + 1 : v);
  const wRank = (mode, code) => (isSsb(mode) && code > 14 ? code - 1 : code);
  const PREAMP = [[0, 'IPO1'], [1, 'AMP1'], [2, 'AMP2'], [3, 'IPO2']];
  const ATT = [[0, 'OFF'], [1, '6 dB'], [2, '12 dB'], [3, '18 dB']];
  const AGC = [[0, 'OFF'], [1, 'FAST'], [2, 'MID'], [3, 'SLOW'], [4, 'AUTO']];
  // FR (FUNCTION RX) : 0 = MAIN seul, 1 = MAIN coupé (SUB coupé), 2 = MAIN + SUB, 3 = SUB seul (MAIN coupé)
  const frCode = (dual, mute) => (dual ? 2 : 0) + (mute ? 1 : 0);

  const api = Y.build({
    ID: 'ftdx5000',
    NAME: 'Yaesu FTDX5000',
    FREQ_MAX: 60000000,
    freqDigits: 8,
    modes: MODES,
    settable: SETTABLE,
    modeKeys: MODE_KEYS,
    rm3: true,
    // Pas de ST : SPLIT = émission sur l'autre VFO que celui de réception (FT relu : 0 = MAIN, 1 = SUB)
    derive(r) {
      const b = r.vfoSel === 1;
      for (const k of ['clar', 'rit', 'xit']) { const v = b ? r[k + 'B'] : r[k + 'A']; if (v != null) r[k] = v; }
      if (r.txVfo != null && r.vfoSel != null) r.split = r.txVfo === (b ? 1 : 0) ? 0 : 1;
      if (r.widthCode != null) r.width = wRank(r.mode, r.widthCode);
      if (r.widthCodeB != null) r.widthB = wRank(r.modeB, r.widthCodeB);
    },
    readForState: (id, st) => (['rit', 'xit', 'clar', 'clarClr'].indexOf(id) >= 0 ? (st.vfoSel === 1 ? 'OI;' : 'IF;')
      : id === 'split' || id === 'txVfo' ? 'FT;' : id === 'width' ? 'SH0;' : id === 'widthB' ? 'SH1;' : id === 'lock' || id === 'lockB' ? 'LK;' : null),
    widthTable(mode) {
      if (isSsb(mode)) return SSB_24;
      if (Y.NARROW_MODES.indexOf(mode) >= 0) return NAR_16;
      return null;
    },
    power: {
      read: 'PC;',
      re: /^PC(\d{3})$/,
      parse: (m) => ({ powerHead: 'D', power: +m[1] }),
      range: RANGE,
      step: { D: 5 },
      cmd(watts) {
        const w = Math.round(Number(watts));
        if (!(w >= RANGE.D[0] && w <= RANGE.D[1])) throw new Error('puissance hors plage (5–200 W)');
        return 'PC' + pad(w, 3) + ';';
      },
      fakeHead: 'D',
      fakeRead: (f) => 'PC' + pad(f.power, 3),
      fakeWrite(f, c) {
        const w = +/^PC(\d{3})$/.exec(c)[1];
        if (w < 5 || w > 200) return false;
        f.power = w;
        return true;
      }
    },
    headNames: { D: 'FTDX5000' },
    // BAND SELECT : « BS P1P1; » sans côté ; pas de 60 m (02 non attribué)
    bandSideless: true,
    bandCodes: {
      '160M': ['00', 1840000], '80M': ['01', 3700000], '40M': ['03', 7100000], '30M': ['04', 10136000], '20M': ['05', 14200000],
      '17M': ['06', 18130000], '15M': ['07', 21250000], '12M': ['08', 24950000], '10M': ['09', 28500000], '6M': ['10', 50150000]
    },
    readOverrides: {
      'ST;': null, // pas de commande ST sur le FTDX5000
      'CF000;': null,
      'CF001;': null,
      'CO00;': null, // CONTOUR / APF : format de CO pas assez clair dans le manuel, pas utilisé
      'CO02;': null,
      'LK;': { re: /^LK([0-7])$/, parse: (m) => { const v = +m[1]; return v >= 4 ? { lock: v & 1, lockB: (v >> 1) & 1 } : { lock: v === 1 ? 1 : 0, lockB: v === 3 ? 1 : 0 }; }, sim: 'LK0' },
      'SH0;': { re: /^SH0(\d{2})$/, parse: (m) => ({ widthCode: +m[1] }), sim: 'SH013' },
      'IS0;': { re: /^IS0([+-])(\d{4})$/, parse: (m) => ({ shift: Y.sgn(m[1]) * +m[2] }), sim: 'IS0+0000' },
      'NL0;': { re: /^NL0(\d{3})$/, parse: (m) => ({ nbLvl: +m[1] }), sim: 'NL0050' },
      'RL0;': { re: /^RL0(\d{2})$/, parse: (m) => ({ nrLvl: +m[1] }), sim: 'RL008' },
      'PA0;': { re: /^PA0([0-3])$/, parse: (m) => ({ preamp: +m[1] }), sim: 'PA00' },
      'RA0;': { re: /^RA0([0-3])$/, parse: (m) => ({ att: +m[1] }), sim: 'RA00' },
      'GT0;': { re: /^GT0(\d)$/, parse: (m) => ({ agc: Math.min(4, +m[1]) }), sim: 'GT04' },
      // PROCESSOR : PR P1 sans côté (0 OFF, 1 ON, 2 MIC EQ)
      'PR0;': null,
      'AC;': { re: /^AC0([0-2])([0-2])$/, parse: (m) => ({ tuner: m[2] === '0' ? 0 : 1, tuning: m[2] === '2' ? 1 : 0 }), sim: 'AC000' }
    },
    extraReads: [
      { cmd: 'PR;', re: /^PR([0-2])$/, parse: (m) => ({ proc: m[1] === '1' ? 1 : 0 }), sim: 'PR0' },
      // INFORMATION : P1 (3) mémoire, P2 (8) fréquence, P3 (±4) décalage du clarifier, P4 RIT, P5 XIT, P6 mode… (IF = MAIN, OI = SUB)
      { cmd: 'IF;', re: /^IF\d{3}\d{8}([+-])(\d{4})([01])([01])[0-9A-C]/, parse: (m) => ({ clarA: Y.sgn(m[1]) * +m[2], ritA: +m[3], xitA: +m[4] }), sim: 'IF00114250000+000000200000' },
      { cmd: 'OI;', re: /^OI\d{3}\d{8}([+-])(\d{4})([01])([01])[0-9A-C]/, parse: (m) => ({ clarB: Y.sgn(m[1]) * +m[2], ritB: +m[3], xitB: +m[4] }), sim: 'OI00107074000+00000C00000' },
      { cmd: 'NB0;', re: /^NB0([0-2])$/, parse: (m) => ({ nb: m[1] === '0' ? 0 : 1 }), sim: 'NB00' },
      { cmd: 'NR0;', re: /^NR0([01])$/, parse: (m) => ({ nr: +m[1] }), sim: 'NR00' },
      // Antenne : AN P1 → AN P1 P3 P4 (P3 = ANT 1-4, P4 = RX ANT)
      { cmd: 'AN0;', re: /^AN0([1-4])([01])?$/, parse: (m) => ({ ant: +m[1] }), sim: 'AN010' },
      { cmd: 'FR;', re: /^FR([0-3])$/, parse: (m) => ({ dualRx: +m[1] >= 2 ? 1 : 0, mainMute: +m[1] & 1 }), sim: 'FR2' },
      // Côté SUB (VFO B) : P1 = 1
      { cmd: 'SH1;', re: /^SH1(\d{2})$/, parse: (m) => ({ widthCodeB: +m[1] }), sim: 'SH113' },
      { cmd: 'NA1;', re: /^NA1([01])$/, parse: (m) => ({ narrowB: +m[1] }), sim: 'NA10' },
      { cmd: 'NB1;', re: /^NB1([0-2])$/, parse: (m) => ({ nbB: m[1] === '0' ? 0 : 1 }), sim: 'NB10' },
      { cmd: 'NR1;', re: /^NR1([01])$/, parse: (m) => ({ nrB: +m[1] }), sim: 'NR10' },
      { cmd: 'BC1;', re: /^BC1([01])$/, parse: (m) => ({ dnfB: +m[1] }), sim: 'BC10' },
      { cmd: 'BP10;', re: /^BP10(\d{3})$/, parse: (m) => ({ notchB: +m[1] ? 1 : 0 }), sim: 'BP10000' },
      { cmd: 'GT1;', re: /^GT1(\d)$/, parse: (m) => ({ agcB: Math.min(4, +m[1]) }), sim: 'GT14' },
      { cmd: 'RG1;', re: /^RG1(\d{3})$/, parse: (m) => ({ rfB: +m[1] }), sim: 'RG1255' },
      { cmd: 'AG1;', re: /^AG1(\d{3})$/, parse: (m) => ({ afB: +m[1] }), sim: 'AG1128' },
      { cmd: 'IS1;', re: /^IS1([+-])(\d{4})$/, parse: (m) => ({ shiftB: Y.sgn(m[1]) * +m[2] }), sim: 'IS1+0000' },
      { cmd: 'RA1;', re: /^RA1([0-3])$/, parse: (m) => ({ attB: +m[1] }), sim: 'RA10' },
      { cmd: 'PA1;', re: /^PA1([0-3])$/, parse: (m) => ({ preampB: +m[1] }), sim: 'PA10' },
      // Face avant : manipulateur, break-in, tonalité CW
      { cmd: 'BI;', re: /^BI([01])$/, parse: (m) => ({ bkin: +m[1] }), sim: 'BI0' },
      { cmd: 'KR;', re: /^KR([01])$/, parse: (m) => ({ keyer: +m[1] }), sim: 'KR0' },
      { cmd: 'KP;', when: (st) => /^CW/.test(st.mode || '') || /^CW/.test(st.modeB || ''), re: /^KP(\d\d)$/, parse: (m) => ({ cwPitch: 300 + 10 * +m[1] }), sim: 'KP40' },
      // Face avant : SQL et niveau NB du SUB, MONI, vitesse du manipulateur, VOX GAIN / DELAY
      { cmd: 'SQ1;', re: /^SQ1(\d{3})$/, parse: (m) => ({ sqlB: +m[1] }), sim: 'SQ1000' },
      { cmd: 'NL1;', re: /^NL1(\d{3})$/, parse: (m) => ({ nbLvlB: +m[1] }), sim: 'NL1050' },
      { cmd: 'ML1;', re: /^ML1(\d{3})$/, parse: (m) => ({ moniLvl: +m[1] }), sim: 'ML1050' },
      { cmd: 'KS;', re: /^KS(\d{3})$/, parse: (m) => ({ keySpeed: +m[1] }), sim: 'KS022' },
      { cmd: 'VG;', re: /^VG(\d{3})$/, parse: (m) => ({ voxGain: +m[1] }), sim: 'VG050' },
      { cmd: 'VD;', re: /^VD(\d{4})$/, parse: (m) => ({ voxDelay: +m[1] }), sim: 'VD0500' }
    ],
    fastExtra: ['FR;'],
    extraQueries: ['ID;', 'IF;', 'OI;', 'AN0;', 'AN1;', 'FR;', 'FT;', 'SM1;', 'RM1;', 'RM2;', 'RI0;', 'BY;'],
    extraStateKeys: ['clarA', 'ritA', 'xitA', 'clarB', 'ritB', 'xitB', 'lockB', 'widthCode', 'widthCodeB', 'widthB', 'narrowB', 'nbB', 'nrB', 'dnfB', 'notchB',
      'agcB', 'rfB', 'afB', 'shiftB', 'attB', 'preampB', 'nbLvl', 'nrLvl', 'mainMute', 'bkin', 'keyer', 'cwPitch',
      'sqlB', 'nbLvlB', 'moniLvl', 'keySpeed', 'voxGain', 'voxDelay'],
    subBadges: true,
    // Phonie à distance : « SSB MIC SELECT » (menu 103) sur DATA (prise de l'interface son) le temps de l'émission,
    // puis remis comme avant (FRONT = micro de la face avant)
    voice: { LSB: [['103', '1']], USB: [['103', '1']] },
    preampText(r, w) {
      const v = w === 'B' ? r.preampB : r.preamp;
      if (v == null) return null;
      return [['IPO1', 'AMP1', 'AMP2', 'IPO2'][v] || 'IPO1', v === 1 || v === 2];
    },
    controlOverrides: {
      split: { write: (v, s) => 'FT' + ((v ? 1 - (s && s.vfoSel === 1 ? 1 : 0) : (s && s.vfoSel === 1 ? 1 : 0)) ? 3 : 2) + ';' },
      rit: { write: (v) => 'RT' + v + ';' },
      xit: { write: (v) => 'XT' + v + ';' },
      clar: { write: (v) => 'RC;' + (v ? (v > 0 ? 'RU' : 'RD') + pad(Math.abs(v), 4) + ';' : '') },
      clarClr: { write: () => 'RC;' },
      lock: { write: (v) => 'LK' + (v ? 1 : 0) + ';' },
      width: { write: (v, s) => 'SH0' + pad(wCode(s && s.mode, v), 2) + ';' },
      shift: { min: -1000, max: 1000, write: (v) => 'IS0' + signed4(v) + ';' },
      contour: null,
      apf: null,
      nb: { type: 'toggle', off0: false, write: (v) => 'NB0' + v + ';' },
      nr: { type: 'toggle', off0: false, write: (v) => 'NR0' + v + ';' },
      preamp: { options: PREAMP, write: (v) => 'PA0' + v + ';', when: (s) => s.freq != null && s.freq <= 60000000 },
      att: { type: 'select', label: 'ATT', options: ATT, write: (v) => 'RA0' + v + ';', when: (s) => s.freq != null && s.freq <= 60000000 },
      mic: { max: 255, pct: true },
      proc: { write: (v) => 'PR' + (v ? 1 : 0) + ';' },
      procLvl: { max: 255, pct: true },
      tuner: { write: (v) => 'AC00' + v + ';' },
      tune: { write: () => 'AC002;' }
    },
    extraControls: [
      { id: 'lockB', g: 'vfo', label: 'LOCK (SUB)', type: 'toggle', face: true, write: (v) => 'LK' + (v ? 3 : 2) + ';' },
      { id: 'dualRx', g: 'vfo', label: 'DUAL RX', type: 'toggle', write: (v, s) => 'FR' + frCode(v, s && s.mainMute) + ';' },
      { id: 'mainMute', g: 'vfo', label: 'RX MAIN coupé', type: 'toggle', write: (v, s) => 'FR' + frCode(s && s.dualRx === 1, v) + ';' },
      { id: 'txVfo', g: 'vfo', label: 'TX sur le SUB', type: 'toggle', face: true, write: (v) => 'FT' + (v ? 3 : 2) + ';' },
      { id: 'nbLvl', g: 'flt', sec: 'dsp', label: 'Niveau NB', type: 'level', min: 0, max: 255, step: 1, pct: true, write: (v) => 'NL0' + pad(v, 3) + ';' },
      { id: 'nrLvl', g: 'flt', sec: 'dsp', label: 'Niveau DNR', type: 'level', min: 1, max: 15, step: 1, write: (v) => 'RL0' + pad(v, 2) + ';' },
      { id: 'ant', g: 'rx', label: 'Antenne', type: 'select', noTx: true, options: [[1, 'ANT 1'], [2, 'ANT 2'], [3, 'ANT 3'], [4, 'ANT 4']], write: (v) => 'AN0' + v + ';' },
      // Côté SUB (VFO B)
      { id: 'widthB', g: 'flt', label: 'WIDTH (VFO B)', type: 'width', modeKey: 'modeB', write: (v, s) => 'SH1' + pad(wCode(s && s.modeB, v), 2) + ';',
        when: (s) => !!api.widthTableFn && !!api.widthTableFn(s.modeB) && !s.narrowB },
      { id: 'attB', g: 'rx', label: 'ATT (VFO B)', type: 'select', options: ATT, write: (v) => 'RA1' + v + ';', when: (s) => s.freqB != null && s.freqB <= 60000000 },
      { id: 'preampB', g: 'rx', label: 'Préampli (VFO B)', type: 'select', options: PREAMP, write: (v) => 'PA1' + v + ';', when: (s) => s.freqB != null && s.freqB <= 60000000 },
      { id: 'narrowB', g: 'flt', label: 'NARROW (VFO B)', type: 'toggle', write: (v) => 'NA1' + v + ';' },
      { id: 'nbB', g: 'flt', label: 'NB (VFO B)', type: 'toggle', write: (v) => 'NB1' + v + ';' },
      { id: 'nrB', g: 'flt', label: 'DNR (VFO B)', type: 'toggle', write: (v) => 'NR1' + v + ';' },
      { id: 'notchB', g: 'flt', label: 'NOTCH (VFO B)', type: 'toggle', write: (v) => 'BP10' + pad(v, 3) + ';' },
      { id: 'dnfB', g: 'flt', label: 'DNF (VFO B)', type: 'toggle', write: (v) => 'BC1' + v + ';' },
      { id: 'shiftB', g: 'flt', label: 'IF SHIFT (VFO B)', type: 'level', min: -1000, max: 1000, step: 20, unit: 'Hz', write: (v) => 'IS1' + signed4(v) + ';' },
      { id: 'agcB', g: 'rx', label: 'AGC (VFO B)', type: 'select', options: AGC, write: (v) => 'GT1' + v + ';' },
      { id: 'rfB', g: 'rx', label: 'RF gain (VFO B)', type: 'level', min: 0, max: 255, step: 1, pct: true, write: (v) => 'RG1' + pad(v, 3) + ';' },
      { id: 'afB', g: 'rx', label: 'AF (VFO B)', type: 'level', min: 0, max: 255, step: 1, pct: true, face: true, write: (v) => 'AG1' + pad(v, 3) + ';' },
      { id: 'bkin', g: 'tx', label: 'BK-IN', type: 'toggle', face: true, write: (v) => 'BI' + v + ';' },
      { id: 'keyer', g: 'tx', label: 'KEYER', type: 'toggle', face: true, write: (v) => 'KR' + v + ';' },
      // Boutons de la face avant (page /ftdx5000)
      { id: 'sqlB', g: 'rx', label: 'SQL (VFO B)', type: 'level', min: 0, max: 255, step: 1, pct: true, face: true, write: (v) => 'SQ1' + pad(v, 3) + ';' },
      { id: 'nbLvlB', g: 'flt', label: 'Niveau NB (VFO B)', type: 'level', min: 0, max: 255, step: 1, pct: true, face: true, write: (v) => 'NL1' + pad(v, 3) + ';' },
      { id: 'moniLvl', g: 'tx', label: 'MONI LEVEL', type: 'level', min: 1, max: 255, step: 1, pct: true, face: true, write: (v) => 'ML1' + pad(v, 3) + ';' },
      { id: 'keySpeed', g: 'tx', label: 'KEY SPEED', type: 'level', min: 4, max: 60, step: 1, unit: 'wpm', face: true, write: (v) => 'KS' + pad(v, 3) + ';' },
      { id: 'cwPitch', g: 'tx', label: 'CW PITCH', type: 'level', min: 300, max: 1050, step: 10, unit: 'Hz', face: true, write: (v) => 'KP' + pad((v - 300) / 10, 2) + ';' },
      { id: 'voxGain', g: 'tx', label: 'VOX GAIN', type: 'level', min: 0, max: 255, step: 1, pct: true, face: true, write: (v) => 'VG' + pad(v, 3) + ';' },
      { id: 'voxDelay', g: 'tx', label: 'VOX DELAY', type: 'level', min: 20, max: 5000, step: 20, unit: 'ms', face: true, write: (v) => 'VD' + pad(v, 4) + ';' }
    ],
    fakeTuning: 'AC002',
    fakeFirst: true,
    // Simulateur : IF / OI sur 8 chiffres, clarifier par côté, FR sur un chiffre, FT relu en absolu, SM1, LK 0-3
    fakeCmd(f, c, out) {
      const ka = f.clar5 || (f.clar5 = { off: 0, rit: 0, xit: 0 }), kb = f.clar5B || (f.clar5B = { off: 0, rit: 0, xit: 0 });
      const k = f.ans && f.ans['VS;'] === 'VS1' ? kb : ka;
      let m;
      const info = (h, fr, kk, md) => h + '001' + pad(fr, 8) + (kk.off < 0 ? '-' : '+') + pad(kk.off, 4) + kk.rit + kk.xit + md + '00000;';
      if (c === 'IF') { out.push(info('IF', f.freq, ka, f.mode)); return true; }
      if (c === 'OI') { out.push(info('OI', f.freqB, kb, f.modeB)); return true; }
      if ((m = /^RT([01])$/.exec(c))) { k.rit = +m[1]; return true; }
      if ((m = /^XT([01])$/.exec(c))) { k.xit = +m[1]; return true; }
      if (c === 'RC') { k.off = 0; return true; }
      if ((m = /^R([UD])(\d{4})$/.exec(c))) { k.off = Math.max(-9999, Math.min(9999, k.off + (m[1] === 'U' ? 1 : -1) * +m[2])); return true; }
      if (c === 'FR') { out.push('FR' + (f.fr5 == null ? 2 : f.fr5) + ';'); return true; }
      if ((m = /^FR([0-3])$/.exec(c))) { f.fr5 = +m[1]; f.single = f.fr5 < 2; return true; }
      if (c === 'FT') { out.push('FT' + (f.txv || 0) + ';'); return true; }
      if ((m = /^FT([23])$/.exec(c))) { f.txv = +m[1] - 2; return true; }
      if (/^FT[01]$/.test(c)) { f.txv = (f.txv || 0) ^ 1; return true; }
      if (c === 'SM1') { out.push('SM1' + pad(f.fr5 != null && f.fr5 < 2 ? 0 : Math.round(60 + 30 * Math.sin((f.t || 0) * 0.5)), 3) + ';'); return true; }
      if ((m = /^LK([0-3])$/.exec(c))) { f.ans['LK;'] = c; return true; }
      if (c === 'ID') { out.push('ID0362;'); return true; }
      return false;
    },
    serial: { baudRate: 38400, stopBits: 2, portHint: 'adaptateur USB ↔ RS-232 (prise CAT du TRX)' },
    hint: 'FTDX5000 : pas de port USB. Prise CAT (RS-232C) du TRX → câble série → adaptateur USB-série (FTDI de préférence) sur ce PC. Menu 032 « CAT RATE » = vitesse choisie ici (38400 conseillé), 034 « CAT RTS » = DISABLE. Si le TRX ne répond pas, essayez 1 bit de stop au lieu de 2. Son : interface USB (RigExpert TI-5000, SignaLink…) sur la prise DATA du TRX, menu 069 « DATA IN SELECT » = DATA ; choisissez sa carte son ici.'
  });

  // Son : une seule voie (sortie DATA du TRX, menu 071 : VFO-A ou VFO-B) → pas de double décodage pour l'instant
  api.DUAL_AUDIO = false;
  api.DUAL_TX = false;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.RIGS = root.RIGS || {};
    root.RIGS[api.ID] = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
