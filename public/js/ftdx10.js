/*
 * ftdx10.js — pilote CAT du Yaesu FTDX10 (port Enhanced COM)
 *
 * Référence : FTDX10 CAT Operation Reference Manual (Yaesu).
 * Différences avec le FTX-1 : puissance sur 3 chiffres sans tête (5–100 W), atténuateur 6/12/18 dB,
 * processeur PR0 1/2, NB et DNR avec interrupteur séparé (NB0/NR0), DNR niveau 1–15, squelch 0–100,
 * largeurs CW/RTTY/PSK limitées à 3000 Hz, couverture 30 kHz–75 MHz.
 */
(function (root) {
  'use strict';
  const Y = (typeof module !== 'undefined' && module.exports) ? require('./yaesu.js') : root.YAESU;
  const pad = Y.pad;
  const RANGE = { D: [5, 100] };
  const NARROW_18 = Y.WIDTH_NARROW.slice(0, 18); // 50 … 3000 Hz
  // Scope du TRX (SS 0 P2 P3…P7) : SPEED, PEAK, MARKER, COLOR, LEVEL, SPAN — même codage que le FTDX101
  function ssParse(p2, t) {
    if (p2 === 4) { const v = parseFloat(t); return Number.isFinite(v) && Math.abs(v) <= 30 ? v : null; }
    if (p2 === 3) { if (t[2] === '1' && /[0-6]/.test(t[1])) return 12 + +t[1]; const n = parseInt(t[0], 16); return n >= 0 && n <= 10 ? n + 1 : null; }
    const n = parseInt(t[0], 10);
    return Number.isFinite(n) ? n : null;
  }
  function ssFmt(p2, v) {
    if (p2 === 4) { const a = Math.abs(v); return (v < 0 ? '-' : '+') + pad(Math.floor(a), 2) + '.' + (a % 1 ? '5' : '0'); }
    if (p2 === 3) return v >= 12 ? '0' + (v - 12) + '100' : (v - 1).toString(16).toUpperCase() + '0000';
    return String(v) + '0000';
  }
  const apfHz = (v) => (v - 25) * 10 + ' Hz'; // APF : 0000-0050 = −250…+250 Hz

  const api = Y.build({
    // CW : comme le FTDX101 (mémoire 1 du manipulateur lue par KY6 ; BI0 coupe le break-in pour arrêter)
    // CW : mémoire 1 du manipulateur mise en TEXT (menu CW MEMORY 1 = EX020206), texte écrit par KM1, lu par KY6 (Hamlib ;
    // KY1 essayé si KY6 est refusé). Pas de commande d'arrêt de lecture : break-in coupé. DTR : PC KEYING = EX020116 (3 = DTR).
    // Phonie à distance (SSB) : SSB MOD SOURCE = REAR (EX010113) et REAR SELECT = USB (EX010114) le temps de l'émission
    // Égaliseur paramétrique : EX030302 à EX030319 (niveau −20 à +10, largeur 1 à 10)
    trxEq: { menu: '0303', first: 2, lvl: [-20, 10], bw: [1, 10] },
    voice: { LSB: [['010113', '1'], ['010114', '1']], USB: [['010113', '1'], ['010114', '1']] },
    cw: { pre: ['EX0202060;'], mem: 'KM1', play: 'KY6;', alt: ['KY1;'], stop: 'BI0;',
      dtr: { on: ['EX0201163;', 'BI1;'], off: ['EX0201160;'] } },
    ID: 'ftdx10',
    NAME: 'Yaesu FTDX10',
    FREQ_MAX: 75000000,
    widthTable(mode) {
      if (mode === 'LSB' || mode === 'USB') return Y.WIDTH_SSB;
      if (Y.NARROW_MODES.indexOf(mode) >= 0) return NARROW_18;
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
        if (!(w >= RANGE.D[0] && w <= RANGE.D[1])) throw new Error('puissance hors plage (5–100 W)');
        return 'PC' + pad(w, 3) + ';';
      },
      fakeHead: 'D',
      fakeRead: (f) => 'PC' + pad(f.power, 3),
      fakeWrite(f, c) {
        const w = +/^PC(\d{3})$/.exec(c)[1];
        if (w < 5 || w > 100) return false;
        f.power = w;
        return true;
      }
    },
    readOverrides: {
      'RA0;': { re: /^RA0([0-3])$/, parse: (m) => ({ att: +m[1] }), sim: 'RA00' },
      'PR0;': { re: /^PR0([12])$/, parse: (m) => ({ proc: m[1] === '2' ? 1 : 0 }), sim: 'PR01' },
      'AC;': { re: /^AC0([0-2])([0-2])$/, parse: (m) => ({ tuner: m[2] === '0' ? 0 : 1, tuning: m[2] === '2' ? 1 : 0 }), sim: 'AC000' },
      // NB et DNR : interrupteur et niveau séparés
      'NL0;': { re: /^NL0(\d{3})$/, parse: (m) => ({ nbLvl: +m[1] }), sim: 'NL0005' },
      'RL0;': { re: /^RL0(\d{2})$/, parse: (m) => ({ nrLvl: +m[1] }), sim: 'RL008' }
    },
    controlOverrides: {
      att: { type: 'select', label: 'ATT', options: [[0, 'OFF'], [1, '6 dB'], [2, '12 dB'], [3, '18 dB']], write: (v) => 'RA0' + v + ';', when: (s) => s.freq != null && s.freq <= 60000000 },
      proc: { write: (v) => 'PR0' + (v ? 2 : 1) + ';' },
      sql: { max: 100, pct: false, unit: '%', write: (v) => 'SQ0' + pad(v, 3) + ';' },
      nb: { type: 'toggle', off0: false, write: (v) => 'NB0' + v + ';' },
      nr: { type: 'toggle', off0: false, write: (v) => 'NR0' + v + ';' },
      tuner: { write: (v) => 'AC00' + v + ';' },
      tune: { write: () => 'AC002;' }
    },
    // Face avant (page /ftdx10) : lectures et réglages en plus (manuel CAT FTDX10)
    extraReads: [
      // KEY PITCH (300 à 1050 Hz) : centre du filtre et de l'indicateur d'accord CW de la face avant
      { cmd: 'KP;', when: (st) => /^CW/.test(st.mode || ''), re: /^KP(\d\d)$/, parse: (m) => ({ cwPitch: 300 + 10 * +m[1] }), sim: 'KP40' },
      { cmd: 'BI;', re: /^BI([01])$/, parse: (m) => ({ bkin: +m[1] }), sim: 'BI0' },
      { cmd: 'KR;', re: /^KR([01])$/, parse: (m) => ({ keyer: +m[1] }), sim: 'KR0' },
      // Filtre de toit (R.FIL) : réglé par RF0 1 / 2 / 4 / 5, relu RF0 6 / 7 / 9 / A (12 kHz, 3 kHz, 500 Hz, 300 Hz en option)
      { cmd: 'RF0;', re: /^RF0([6-9A])$/, parse: (m) => ({ roof: '6789A'.indexOf(m[1]) + 1 }), sim: 'RF07' },
      // Fréquence du CONTOUR (10-3200 Hz) et de l'APF (0000-0050 = −250…+250 Hz, en CW)
      { cmd: 'CO01;', re: /^CO01(\d{4})$/, parse: (m) => ({ contourFreq: +m[1] }), sim: 'CO011000' },
      { cmd: 'CO03;', when: (st) => /^CW/.test(st.mode || ''), re: /^CO03(\d{4})$/, parse: (m) => ({ apfFreq: +m[1] }), sim: 'CO030025' },
      // Scope du TRX (P1 = 0)
      ...['Spd', 'Peak', 'Marker', 'Color', 'Level', 'Span'].map((k, p2) => ({
        cmd: 'SS0' + p2 + ';', re: new RegExp('^SS0' + p2 + '(.{5})$'),
        parse: (m) => { const v = ssParse(p2, m[1]); return v == null ? {} : { ['ss' + k + 'A']: v }; },
        sim: 'SS0' + p2 + ['20000', '00000', '10000', '00000', '+00.0', '20000'][p2] })),
      // FINE TUNING du TRX (FN) ; menu FUNC : MONI LEVEL, VOX GAIN, ANTI VOX
      { cmd: 'FN;', re: /^FN([01])$/, parse: (m) => ({ fineTrx: +m[1] }), sim: 'FN0' },
      { cmd: 'ML1;', re: /^ML1(\d{3})$/, parse: (m) => ({ moniLvl: +m[1] }), sim: 'ML1050' },
      { cmd: 'VG;', re: /^VG(\d{3})$/, parse: (m) => ({ voxGain: +m[1] }), sim: 'VG050' },
      { cmd: 'AV;', re: /^AV(\d{3})$/, parse: (m) => ({ antiVox: +m[1] }), sim: 'AV050' }
    ],
    extraStateKeys: ['cwPitch', 'bkin', 'keyer', 'roof', 'contourFreq', 'apfFreq', 'ssSpdA', 'ssPeakA', 'ssMarkerA', 'ssColorA', 'ssLevelA', 'ssSpanA',
      'fineTrx', 'moniLvl', 'voxGain', 'antiVox'],
    extraControls: [
      { id: 'roof', g: 'flt', label: 'ROOFING', type: 'select', face: true, options: [[1, '12k'], [2, '3k'], [4, '500'], [5, '300']], write: (v) => 'RF0' + v + ';' },
      ...['Spd', 'Peak', 'Marker', 'Color', 'Level', 'Span'].map((k, p2) => ({ id: 'ss' + k, g: 'scope', label: 'Scope ' + k, face: true,
        type: p2 === 2 ? 'toggle' : 'level', min: [0, 0, 0, 1, -30, 0][p2], max: [4, 4, 1, 18, 30, 9][p2], step: p2 === 4 ? 0.5 : 1,
        write: (v) => 'SS0' + p2 + ssFmt(p2, v) + ';' })),
      { id: 'bkin', g: 'tx', label: 'BK-IN', type: 'toggle', face: true, write: (v) => 'BI' + v + ';' },
      { id: 'keyer', g: 'tx', label: 'KEYER', type: 'toggle', face: true, write: (v) => 'KR' + v + ';' },
      { id: 'fineTrx', g: 'vfo', label: 'FINE', type: 'toggle', face: true, write: (v) => 'FN' + v + ';' },
      { id: 'contourFreq', g: 'flt', label: 'Fréquence CONTOUR', type: 'level', min: 10, max: 3200, step: 10, unit: 'Hz', face: true, write: (v) => 'CO01' + pad(v, 4) + ';' },
      { id: 'apfFreq', g: 'flt', label: 'Fréquence APF', type: 'level', min: 0, max: 50, step: 1, face: true, fmt: apfHz, write: (v) => 'CO03' + pad(v, 4) + ';' },
      { id: 'moniLvl', g: 'tx', label: 'MONI LEVEL', type: 'level', min: 0, max: 100, step: 1, face: true, write: (v) => 'ML1' + pad(v, 3) + ';' },
      { id: 'voxGain', g: 'tx', label: 'VOX GAIN', type: 'level', min: 0, max: 100, step: 1, face: true, write: (v) => 'VG' + pad(v, 3) + ';' },
      { id: 'antiVox', g: 'tx', label: 'ANTI VOX', type: 'level', min: 0, max: 100, step: 1, face: true, write: (v) => 'AV' + pad(v, 3) + ';' }
    ],
    // Simulateur : filtre de toit réglé 1–5, relu 6–A
    fakeCmd(f, c) {
      const m = /^RF0([1-5])$/.exec(c);
      if (m) { f.ans['RF0;'] = 'RF0' + '6789A'[+m[1] - 1]; return true; }
      return false;
    },
    fakeTuning: 'AC002',
    serial: { baudRate: 38400, stopBits: 1, portHint: 'Enhanced COM Port' },
    hint: 'FTDX10 : menu Operation setting → General, « CAT RATE » doit correspondre à la vitesse choisie ici (38400 conseillé). Choisissez le port Enhanced COM Port. Mettez « CAT RTS » sur OFF (sinon la liaison tombe toutes les 2 secondes).'
  });

  // Lectures et réglages propres au FTDX10 : interrupteurs NB/DNR et leurs niveaux
  api.READS.push(
    { cmd: 'NB0;', re: /^NB0([01])$/, parse: (m) => ({ nb: +m[1] }), sim: 'NB00' },
    { cmd: 'NR0;', re: /^NR0([01])$/, parse: (m) => ({ nr: +m[1] }), sim: 'NR00' },
    // MIC EQ (égaliseur paramétrique du TRX) : PR1 1 = coupé, PR1 2 = en service
    { cmd: 'PR1;', re: /^PR1([12])$/, parse: (m) => ({ micEq: m[1] === '2' ? 1 : 0 }), sim: 'PR11' }
  );
  api.SLOW.push('NB0;', 'NR0;', 'PR1;');
  api.STATE_KEYS.push('nbLvl', 'nrLvl', 'micEq');
  const extra = [
    { id: 'nbLvl', g: 'flt', sec: 'dsp', label: 'Niveau NB', type: 'level', min: 0, max: 10, step: 1, write: (v) => 'NL0' + pad(v, 3) + ';' },
    { id: 'nrLvl', g: 'flt', sec: 'dsp', label: 'Niveau DNR', type: 'level', min: 1, max: 15, step: 1, write: (v) => 'RL0' + pad(v, 2) + ';' },
    { id: 'micEq', g: 'tx', sec: 'tx', label: 'MIC EQ', type: 'toggle', write: (v) => 'PR1' + (v ? 2 : 1) + ';' }
  ];
  for (const c of extra) { api.CONTROLS.push(c); api.CONTROL[c.id] = c; }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.RIGS = root.RIGS || {};
    root.RIGS[api.ID] = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
