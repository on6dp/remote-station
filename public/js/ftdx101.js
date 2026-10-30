/*
 * ftdx101.js — pilote CAT du Yaesu FTDX101D / FTDX101MP (port Enhanced COM)
 *
 * Référence : FTDX101D / FTDX101MP CAT Operation Reference Manual (Yaesu, 1912-D).
 * Deux récepteurs complets (MAIN = VFO A, SUB = VFO B) : la plupart des commandes ont P1 = 0 (MAIN) ou 1 (SUB),
 * le côté SUB se règle donc directement (pas de passage par VS comme sur le FTX-1).
 * Différences avec le FTDX10 : puissance 5–100 W (D) ou 5–200 W (MP, reconnu par « ID0682 »), antennes ANT 1 / 2 / 3 (AN),
 * clarifier par RT / XT / RC / RU / RD (pas de CF ; décalage lu dans IF), LK 0–7 (MAIN / SUB), BS sans côté,
 * double réception par FR (FR00 = MAIN et SUB en réception, FR01 = SUB coupé), SPLIT normal par ST (pas le défaut du FTX-1).
 * Couverture 30 kHz–75 MHz (70 MHz en version européenne, BS17).
 */
(function (root) {
  'use strict';
  const Y = (typeof module !== 'undefined' && module.exports) ? require('./yaesu.js') : root.YAESU;
  const pad = Y.pad;
  const signed4 = Y.signed4;
  // Puissance : 3 chiffres sans tête (PC005…PC200). Le modèle vient de la réponse à ID : 0681 = D (100 W), 0682 = MP (200 W).
  // Tant que ID n'est pas lu, on reste prudent : plage du D.
  const RANGE = { D: [5, 100], M: [5, 200] };
  // Largeurs du FTDX101 (manuel CAT 1912-D, table 3) : SH P1 0 P3P3 ; 00 = largeur par défaut du TRX (voyant WIDTH éteint).
  // Différentes du FTX-1 au-delà de 2100 Hz en SSB, et 18 pas seulement (50 … 3000 Hz) en CW / RTTY / PSK / DATA.
  const SSB_23 = [300, 400, 600, 850, 1100, 1200, 1500, 1650, 1800, 1950, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900, 3000, 3200, 3500, 4000];
  const NARROW_21 = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 800, 1200, 1400, 1700, 2000, 2400, 3000, 3200, 3500, 4000];

  const api = Y.build({
    ID: 'ftdx101',
    NAME: 'Yaesu FTDX101D / MP',
    FREQ_MAX: 75000000,
    headNames: { D: 'FTDX101D', M: 'FTDX101MP' },
    widthDefault: true, // WIDTH 00 = largeur par défaut (proposée en bas de l'échelle BW)
    widthTable(mode) {
      if (mode === 'LSB' || mode === 'USB') return SSB_23;
      if (Y.NARROW_MODES.indexOf(mode) >= 0) return NARROW_21;
      return null;
    },
    power: {
      read: 'PC;',
      re: /^PC(\d{3})$/,
      parse: (m) => ({ power: +m[1] }),
      range: RANGE,
      step: { D: 5, M: 5 },
      cmd(watts, head) {
        const r = RANGE[head === 'M' ? 'M' : 'D'];
        const w = Math.round(Number(watts));
        if (!(w >= r[0] && w <= r[1])) throw new Error('puissance hors plage (' + r[0] + '–' + r[1] + ' W)');
        return 'PC' + pad(w, 3) + ';';
      },
      fakeHead: 'M',
      fakeRead: (f) => 'PC' + pad(f.power, 3),
      fakeWrite(f, c) {
        const w = +/^PC(\d{3})$/.exec(c)[1];
        if (w < 5 || w > 200) return false;
        f.power = w;
        return true;
      }
    },
    // BAND SELECT : « BS P1P1; » sans côté (agit sur le côté actif) ; 17 = 70 MHz (version européenne)
    bandSideless: true,
    // Modèle lu dès la connexion : la plage de puissance (100 ou 200 W) est connue tout de suite
    initExtra: 'ID;',
    bandCodes: {
      '160M': ['00', 1840000], '80M': ['01', 3700000], '60M': ['02', 5357000], '40M': ['03', 7100000],
      '30M': ['04', 10136000], '20M': ['05', 14200000], '17M': ['06', 18130000], '15M': ['07', 21250000],
      '12M': ['08', 24950000], '10M': ['09', 28500000], '6M': ['10', 50150000], '4M': ['17', 70200000]
    },
    readOverrides: {
      // Pas de CF sur le FTDX101 : RIT / XIT / décalage lus dans IF (voir extraReads)
      'CF000;': null,
      'CF001;': null,
      'RA0;': { re: /^RA0([0-3])$/, parse: (m) => ({ att: +m[1] }), sim: 'RA00' },
      'PR0;': { re: /^PR0([12])$/, parse: (m) => ({ proc: m[1] === '2' ? 1 : 0 }), sim: 'PR01' },
      'AC;': { re: /^AC0([0-2])([0-2])$/, parse: (m) => ({ tuner: m[2] === '0' ? 0 : 1, tuning: m[2] === '2' ? 1 : 0 }), sim: 'AC000' },
      // LK 0–7 : 1, 5, 7 = MAIN verrouillé
      'LK;': { re: /^LK([0-7])$/, parse: (m) => ({ lock: ['1', '5', '7'].indexOf(m[1]) >= 0 ? 1 : 0 }), sim: 'LK0' },
      // NB et DNR : interrupteur (NB0 / NR0) et niveau (NL0 / RL0) séparés, comme le FTDX10
      'NL0;': { re: /^NL0(\d{3})$/, parse: (m) => ({ nbLvl: +m[1] }), sim: 'NL0005' },
      'RL0;': { re: /^RL0(\d{2})$/, parse: (m) => ({ nrLvl: +m[1] }), sim: 'RL008' }
    },
    extraReads: [
      // Modèle (D ou MP) : plage de puissance
      { cmd: 'ID;', re: /^ID(\d{4})$/, parse: (m) => ({ powerHead: m[1] === '0682' ? 'M' : 'D' }), sim: 'ID0682' },
      // INFORMATION : P3 = décalage du clarifier (±0000–9999 Hz), P4 = RIT, P5 = XIT
      { cmd: 'IF;', re: /^IF[0-9A-Z]{3}\d{9}([+-])(\d{4})([01])([01])[0-9A-F]/, parse: (m) => ({ clar: Y.sgn(m[1]) * +m[2], rit: +m[3], xit: +m[4] }), sim: 'IF001014250000+00000020000000' },
      { cmd: 'NB0;', re: /^NB0([01])$/, parse: (m) => ({ nb: +m[1] }), sim: 'NB00' },
      { cmd: 'NR0;', re: /^NR0([01])$/, parse: (m) => ({ nr: +m[1] }), sim: 'NR00' },
      { cmd: 'AN0;', re: /^AN0([1-3])\d?$/, parse: (m) => ({ ant: +m[1] }), sim: 'AN010' },
      // Double réception : FR00 = MAIN et SUB en réception, FR01 = SUB coupé
      { cmd: 'FR;', re: /^FR0([01])$/, parse: (m) => ({ dualRx: m[1] === '0' ? 1 : 0 }), sim: 'FR00' },
      // Côté SUB (VFO B) : P1 = 1, réglé directement
      { cmd: 'NB1;', re: /^NB1([01])$/, parse: (m) => ({ nbB: +m[1] }), sim: 'NB10' },
      { cmd: 'NR1;', re: /^NR1([01])$/, parse: (m) => ({ nrB: +m[1] }), sim: 'NR10' },
      { cmd: 'BP10;', re: /^BP10(\d{3})$/, parse: (m) => ({ notchB: +m[1] ? 1 : 0 }), sim: 'BP10000' },
      { cmd: 'BP11;', re: /^BP11(\d{3})$/, parse: (m) => ({ notchFreqB: +m[1] * 10 }), sim: 'BP11150' },
      { cmd: 'BC1;', re: /^BC1([01])$/, parse: (m) => ({ dnfB: +m[1] }), sim: 'BC10' },
      { cmd: 'NA1;', re: /^NA1([01])$/, parse: (m) => ({ narrowB: +m[1] }), sim: 'NA10' },
      { cmd: 'GT1;', re: /^GT1(\d)$/, parse: (m) => ({ agcB: Math.min(4, +m[1]) }), sim: 'GT14' },
      { cmd: 'SH1;', re: /^SH10(\d{2})$/, parse: (m) => ({ widthB: +m[1] }), sim: 'SH1013' },
      { cmd: 'RG1;', re: /^RG1(\d{3})$/, parse: (m) => ({ rfB: +m[1] }), sim: 'RG1255' },
      { cmd: 'IS1;', re: /^IS10([+-])(\d{4})$/, parse: (m) => ({ shiftB: Y.sgn(m[1]) * +m[2] }), sim: 'IS10+0000' },
      { cmd: 'CO10;', re: /^CO10(\d{4})$/, parse: (m) => ({ contourB: +m[1] ? 1 : 0 }), sim: 'CO100000' },
      { cmd: 'CO12;', re: /^CO12(\d{4})$/, parse: (m) => ({ apfB: +m[1] ? 1 : 0 }), sim: 'CO120000' },
      { cmd: 'RA1;', re: /^RA1([0-3])$/, parse: (m) => ({ attB: +m[1] }), sim: 'RA10' },
      { cmd: 'PA1;', re: /^PA1([0-2])$/, parse: (m) => ({ preampB: +m[1] }), sim: 'PA10' },
      // Filtre de toit (ROOFING) : réglé par RF P1 1–5, relu en RF P1 6–A (12 kHz, 3 kHz, 1,2 kHz, 600 Hz, 300 Hz)
      { cmd: 'RF0;', re: /^RF0([6-9A])$/, parse: (m) => ({ roof: '6789A'.indexOf(m[1]) + 1 }), sim: 'RF06' },
      { cmd: 'RF1;', re: /^RF1([6-9A])$/, parse: (m) => ({ roofB: '6789A'.indexOf(m[1]) + 1 }), sim: 'RF16' },
      // MIC EQ (égaliseur paramétrique du TRX) : PR1 1 = coupé, PR1 2 = en service
      { cmd: 'PR1;', re: /^PR1([12])$/, parse: (m) => ({ micEq: m[1] === '2' ? 1 : 0 }), sim: 'PR11' },
      // Face avant (page /ftdx101) : volume du récepteur SUB (AF GAIN P1 = 1) et BREAK-IN (BI)
      { cmd: 'AG1;', re: /^AG1(\d{3})$/, parse: (m) => ({ afB: +m[1] }), sim: 'AG1128' },
      { cmd: 'BI;', re: /^BI([01])$/, parse: (m) => ({ bkin: +m[1] }), sim: 'BI0' }
    ],
    extraQueries: ['RF0;', 'RF1;', 'ID;', 'IF;', 'AN0;', 'AN1;', 'FR;', 'FT;', 'SM1;', 'RM1;', 'RM2;', 'RM9;'],
    extraStateKeys: ['afB', 'bkin', 'micEq', 'roof', 'roofB', 'nbLvl', 'nrLvl', 'attB', 'preampB', 'notchFreqB', 'shiftB', 'contourB', 'apfB', 'widthB', 'nbB', 'nrB', 'notchB', 'dnfB', 'narrowB', 'agcB', 'rfB'],
    subBadges: true,
    // CW : mémoire 1 du manipulateur (écrasée), lue par KY6 (« Message Keyer 1 Playback », manuel CAT 1912-D) ;
    // pas de commande d'arrêt de lecture : BI0 coupe le break-in, donc l'émission
    // CW : mémoire 1 du manipulateur mise en TEXT (menu CW MEMORY 1 = EX020208), texte écrit par KM1, lu par KY6 (Hamlib ;
    // KY1 essayé si KY6 est refusé). Pas de commande d'arrêt de lecture : break-in coupé. DTR : PC KEYING = EX020115 (3 = DTR).
    // Phonie à distance (SSB) : SSB MOD SOURCE = REAR (EX010111) et REAR SELECT = USB (EX010112) le temps de l'émission
    // Égaliseur paramétrique : EX030303 à EX030320 (niveau −10 à +10, largeur 1 à 10)
    trxEq: { menu: '0303', first: 3, lvl: [-10, 10], bw: [1, 10] },
    voice: { LSB: [['010111', '1'], ['010112', '1']], USB: [['010111', '1'], ['010112', '1']] },
    cw: { pre: ['EX0202080;'], mem: 'KM1', play: 'KY6;', alt: ['KY1;'], stop: 'BI0;',
      dtr: { on: ['EX0201153;', 'BI1;'], off: ['EX0201150;'] } },
    preampText(r, w) {
      const v = w === 'B' ? r.preampB : r.preamp;
      if (v == null) return null;
      return [['IPO', 'AMP1', 'AMP2'][v] || 'IPO', v > 0];
    },
    controlOverrides: {
      // Clarifier : RT (RIT) / XT (XIT) ; décalage absolu = RC (remise à zéro) puis RU (+) ou RD (−)
      rit: { write: (v) => 'RT' + v + ';' },
      xit: { write: (v) => 'XT' + v + ';' },
      clar: { write: (v) => 'RC;' + (v ? (v > 0 ? 'RU' : 'RD') + pad(Math.abs(v), 4) + ';' : '') },
      clarClr: { write: () => 'RC;' },
      att: { type: 'select', label: 'ATT', options: [[0, 'OFF'], [1, '6 dB'], [2, '12 dB'], [3, '18 dB']], write: (v) => 'RA0' + v + ';', when: (s) => s.freq != null && s.freq <= 75000000 },
      preamp: { when: (s) => s.freq != null && s.freq <= 75000000 },
      proc: { write: (v) => 'PR0' + (v ? 2 : 1) + ';' },
      sql: { max: 100, pct: false, unit: '%', write: (v) => 'SQ0' + pad(v, 3) + ';' },
      nb: { type: 'toggle', off0: false, write: (v) => 'NB0' + v + ';' },
      nr: { type: 'toggle', off0: false, write: (v) => 'NR0' + v + ';' },
      lock: { write: (v) => 'LK' + (v ? 1 : 0) + ';' },
      tuner: { write: (v) => 'AC00' + v + ';' },
      tune: { write: () => 'AC002;' }
    },
    extraControls: [
      { id: 'micEq', g: 'tx', sec: 'tx', label: 'MIC EQ', type: 'toggle', write: (v) => 'PR1' + (v ? 2 : 1) + ';' },
      { id: 'nbLvl', g: 'flt', sec: 'dsp', label: 'Niveau NB', type: 'level', min: 0, max: 10, step: 1, write: (v) => 'NL0' + pad(v, 3) + ';' },
      { id: 'nrLvl', g: 'flt', sec: 'dsp', label: 'Niveau DNR', type: 'level', min: 1, max: 15, step: 1, write: (v) => 'RL0' + pad(v, 2) + ';' },
      { id: 'dualRx', g: 'vfo', label: 'DUAL RX', type: 'toggle', write: (v) => 'FR0' + (v ? '0' : '1') + ';' },
      // Filtre de toit (R.FLT) : 12 kHz (large) … 300 Hz ; 1,2 kHz et 300 Hz en option selon le TRX (refusés s'il ne les a pas)
      { id: 'roof', g: 'flt', label: 'ROOFING (VFO A)', type: 'select', options: [[1, '12k'], [2, '3k'], [3, '1.2k'], [4, '600'], [5, '300']], write: (v) => 'RF0' + v + ';' },
      { id: 'roofB', g: 'flt', label: 'ROOFING (VFO B)', type: 'select', options: [[1, '12k'], [2, '3k'], [3, '1.2k'], [4, '600'], [5, '300']], write: (v) => 'RF1' + v + ';' },
      { id: 'ant', g: 'rx', label: 'Antenne', type: 'select', noTx: true, options: [[1, 'ANT 1'], [2, 'ANT 2'], [3, 'ANT 3']], write: (v) => 'AN0' + v + ';' },
      // Côté SUB (VFO B), réglé directement (P1 = 1)
      { id: 'widthB', g: 'flt', label: 'WIDTH (VFO B)', type: 'width', modeKey: 'modeB', write: (v) => 'SH10' + pad(v, 2) + ';',
        when: (s) => !!api.widthTableFn && !!api.widthTableFn(s.modeB) && !s.narrowB },
      { id: 'attB', g: 'rx', label: 'ATT (VFO B)', type: 'select', options: [[0, 'OFF'], [1, '6 dB'], [2, '12 dB'], [3, '18 dB']], write: (v) => 'RA1' + v + ';',
        when: (s) => s.freqB != null && s.freqB <= 75000000 },
      { id: 'preampB', g: 'rx', label: 'Préampli (VFO B)', type: 'select', options: [[0, 'IPO'], [1, 'AMP1'], [2, 'AMP2']], write: (v) => 'PA1' + v + ';',
        when: (s) => s.freqB != null && s.freqB <= 75000000 },
      { id: 'narrowB', g: 'flt', label: 'NARROW (VFO B)', type: 'toggle', write: (v) => 'NA1' + v + ';' },
      { id: 'nbB', g: 'flt', label: 'NB (VFO B)', type: 'toggle', write: (v) => 'NB1' + v + ';' },
      { id: 'nrB', g: 'flt', label: 'DNR (VFO B)', type: 'toggle', write: (v) => 'NR1' + v + ';' },
      { id: 'notchB', g: 'flt', label: 'NOTCH (VFO B)', type: 'toggle', write: (v) => 'BP10' + pad(v, 3) + ';' },
      { id: 'dnfB', g: 'flt', label: 'DNF (VFO B)', type: 'toggle', write: (v) => 'BC1' + v + ';' },
      { id: 'notchFreqB', g: 'flt', label: 'Fréquence NOTCH (VFO B)', type: 'level', min: 10, max: 3200, step: 10, unit: 'Hz', write: (v) => 'BP11' + pad(v / 10, 3) + ';', when: (s) => !/FM/.test(s.modeB || '') },
      { id: 'shiftB', g: 'flt', label: 'IF SHIFT (VFO B)', type: 'level', min: -1200, max: 1200, step: 20, unit: 'Hz', write: (v) => 'IS10' + signed4(v) + ';' },
      { id: 'contourB', g: 'flt', label: 'CONTOUR (VFO B)', type: 'toggle', write: (v) => 'CO10' + pad(v, 4) + ';' },
      { id: 'apfB', g: 'flt', label: 'APF (VFO B)', type: 'toggle', write: (v) => 'CO12' + pad(v, 4) + ';', when: (s) => /^CW/.test(s.modeB || '') },
      { id: 'agcB', g: 'rx', label: 'AGC (VFO B)', type: 'select', options: [[0, 'OFF'], [1, 'FAST'], [2, 'MID'], [3, 'SLOW'], [4, 'AUTO']], write: (v) => 'GT1' + v + ';' },
      // Pour la page Face avant seulement (hors de la disposition du dashboard : cadre caché)
      { id: 'afB', g: 'rx', label: 'AF (VFO B)', type: 'level', min: 0, max: 255, step: 1, pct: true, face: true, write: (v) => 'AG1' + pad(v, 3) + ';' },
      { id: 'bkin', g: 'tx', label: 'BK-IN', type: 'toggle', face: true, write: (v) => 'BI' + v + ';' },
      { id: 'rfB', g: 'rx', label: 'RF gain (VFO B)', type: 'level', min: 0, max: 255, step: 1, pct: true, write: (v) => 'RG1' + pad(v, 3) + ';' }
    ],
    fakeTuning: 'AC002',
    // Simulateur : clarifier (RT / XT / RC / RU / RD) relu dans IF
    fakeCmd(f, c, out) {
      const k = f.clar101 || (f.clar101 = { off: 0, rit: 0, xit: 0 });
      let m;
      if (c === 'IF') { out.push('IF001' + pad(f.freq, 9) + (k.off < 0 ? '-' : '+') + pad(k.off, 4) + k.rit + k.xit + f.mode + '00000;'); return true; }
      if ((m = /^RT([01])$/.exec(c))) { k.rit = +m[1]; return true; }
      if ((m = /^XT([01])$/.exec(c))) { k.xit = +m[1]; return true; }
      if (c === 'RC') { k.off = 0; return true; }
      if ((m = /^RF([01])([1-5])$/.exec(c))) { f.ans['RF' + m[1] + ';'] = 'RF' + m[1] + '6789A'[+m[2] - 1]; return true; } // roofing : réglage 1–5, relu 6–A
      if ((m = /^R([UD])(\d{4})$/.exec(c))) { k.off = Math.max(-9999, Math.min(9999, k.off + (m[1] === 'U' ? 1 : -1) * +m[2])); return true; }
      return false;
    },
    serial: { baudRate: 38400, stopBits: 1, portHint: 'Enhanced COM Port' },
    hint: 'FTDX101 : menu OPERATION SETTING → GENERAL, « CAT RATE » doit correspondre à la vitesse choisie ici (38400 conseillé). Choisissez le port Enhanced COM Port. Mettez « CAT RTS » sur OFF (sinon la liaison tombe toutes les 2 secondes).'
  });

  // Son USB en stéréo : récepteur MAIN à gauche, SUB à droite. En double réception (FR00), la page Station envoie
  // les deux voies : le décodeur RTTY B lit le récepteur SUB, avec sa propre cascade.
  api.DUAL_AUDIO = true;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.RIGS = root.RIGS || {};
    root.RIGS[api.ID] = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
