/*
 * ftx1.js — pilote CAT du Yaesu FTX-1 (port Enhanced / CAT-1)
 *
 * Références :
 *  - FTX-1 CAT Operation Reference Manual (Yaesu, édition 2508-C)
 *  - Formats vérifiés sur radio réelle par RigPlane Core (rigs/ftx1.toml), licence MIT — voir TIERS.md.
 */
(function (root) {
  'use strict';
  const Y = (typeof module !== 'undefined' && module.exports) ? require('./yaesu.js') : root.YAESU;
  const pad = Y.pad;

  // Puissance : la réponse PC indique la tête. P1 = 1 tête Field (0,5–10 W, dixièmes sous 10 W : "PC10.5;"),
  // P1 = 2 ampli SPA-1 (5–100 W : "PC2025;").
  const RANGE = { '1': [0.5, 10], '2': [5, 100] };

  const api = Y.build({
    ID: 'ftx1',
    NAME: 'Yaesu FTX-1',
    FREQ_MAX: 470000000,
    extraModes: { 'H': 'C4FM-DN', 'I': 'C4FM-VW' },
    power: {
      read: 'PC;',
      re: /^PC([12])(\d{3}|\d\.\d)$/,
      parse: (m) => ({ powerHead: m[1], power: parseFloat(m[2]) }),
      range: RANGE,
      step: { '1': 0.5, '2': 5 },
      cmd(watts, head) {
        const r = RANGE[head];
        if (!r) throw new Error('type de tête inconnu, puissance non réglable');
        let w = Math.round(Number(watts) * 2) / 2;
        if (!(w >= r[0] && w <= r[1])) throw new Error('puissance hors plage (' + r[0] + '–' + r[1] + ' W)');
        if (head === '2') w = Math.round(w);
        return 'PC' + head + (Number.isInteger(w) ? pad(w, 3) : w.toFixed(1)) + ';';
      },
      fakeHead: '2',
      fakeRead: (f) => 'PC' + f.head + pad(f.power, 3),
      fakeWrite(f, c) {
        const m = /^PC([12])(\d{3}|\d\.\d)$/.exec(c);
        const w = parseFloat(m[2]);
        if (m[1] !== f.head || w < RANGE[f.head][0] || w > RANGE[f.head][1]) return false;
        f.power = w;
        return true;
      }
    },
    // Codes BS (manuel CAT FTX-1 2508-C, BAND SELECT), vérifiés par RigPlane ; 2e valeur = fréquence du simulateur
    bandCodes: {
      '160M': ['00', 1840000], '80M': ['01', 3700000], '60M': ['02', 5357000], '40M': ['03', 7100000],
      '30M': ['04', 10136000], '20M': ['05', 14200000], '17M': ['06', 18130000], '15M': ['07', 21250000],
      '12M': ['08', 24950000], '10M': ['09', 28500000], '6M': ['10', 50150000], '2M': ['13', 144300000],
      '70CM': ['14', 432200000]
    },
    // Choix de l'antenne HF (prises ANT 1 / ANT 2 de l'ampli SPA-1) : menu EX030704 (0 = ANT 1, 1 = ANT 2),
    // vérifié par Hamlib (rigs/yaesu/ftx1). Pas de 3e prise ni d'entrée RX séparée sur le FTX-1.
    // Clarifier du côté SUB (VFO B) : CF1 0 0 = RIT / XIT, CF1 0 1 = décalage (Hamlib rigs/yaesu/ftx1, ftx1_clarifier.c)
    extraReads: [
      { cmd: 'EX030704;', re: /^EX030704([01])$/, parse: (m) => ({ ant: +m[1] + 1 }), sim: 'EX0307040' },
      { cmd: 'CF100;', re: /^CF100([01])([01])\d{3}$/, parse: (m) => ({ ritB: +m[1], xitB: +m[2] }), sim: 'CF10000000' },
      { cmd: 'CF101;', re: /^CF101([+-])(\d{4})$/, parse: (m) => ({ clarB: (m[1] === '-' ? -1 : 1) * +m[2] }), sim: 'CF101+0000' }
    ],
    extraControls: [
      { id: 'ant', g: 'rx', label: 'Antenne', type: 'select', noTx: true, options: [[1, 'ANT 1'], [2, 'ANT 2']], write: (v) => 'EX030704' + (v - 1) + ';' },
      { id: 'ritB', g: 'vfo', label: 'RIT (VFO B)', type: 'toggle', write: (v, s) => 'CF100' + v + (s.xitB || 0) + '000;' },
      { id: 'xitB', g: 'vfo', label: 'XIT (VFO B)', type: 'toggle', write: (v, s) => 'CF100' + (s.ritB || 0) + v + '000;' },
      { id: 'clarB', g: 'vfo', label: 'Décalage RIT/XIT (VFO B)', type: 'level', min: -9999, max: 9999, step: 10, unit: 'Hz',
        write: (v) => 'CF101' + (v < 0 ? '-' : '+') + pad(Math.abs(v), 4) + ';' },
      { id: 'clarClrB', g: 'vfo', label: 'CLEAR (décalage VFO B à zéro)', type: 'action', write: () => 'CF101+0000;' }
    ],
    // SPLIT : sur le FTX-1, ST1 met le côté SUB en émission (PTT) — défaut connu du firmware, signalé par Hamlib
    // (rigs/yaesu/ftx1/ftx1_vfo.c). Le choix du VFO d'émission passe donc par FT0 (TX MAIN) / FT1 (TX SUB) ; ST n'est ni lu ni envoyé.
    splitIsFT: true,
    readOverrides: { 'ST;': null },
    // Sur le FTX-1, réception (VS) et émission (FT) basculent ensemble d'un côté à l'autre, et un VFO d'émission
    // différent de celui de réception peut faire émettre le TRX. Le choix du VFO d'émission (SPLIT, clic sur TX) est
    // donc gardé par le serveur (« SPLIT virtuel », comme Hamlib) et n'est envoyé au TRX qu'au moment d'émettre :
    // FT du VFO choisi, TX1… puis TX0 et retour de FT / VS sur le VFO de réception.
    // MAIN / SUB (clic sur RX) : FT puis VS sur le même côté — VS seul laisserait FT sur l'autre côté, et ce
    // désaccord fait émettre le FTX-1 (constaté au club).
    virtualSplit: true,
    controlOverrides: { split: { write: (v) => 'FT' + (v ? 1 : 0) + ';' }, vfoSel: { write: (v) => 'FT' + (v ? 1 : 0) + ';VS' + (v ? 1 : 0) + ';' } },
    serial: { baudRate: 38400, stopBits: 1, portHint: 'Enhanced COM Port (CAT-1)' },
    hint: 'FTX-1 : menu Operation setting → General, « CAT-1 RATE » et « CAT-1 CAT-3 STOP BIT » doivent correspondre à ces valeurs. Choisissez le port Enhanced COM Port (CAT-1).'
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.FTX1 = api;
    root.RIGS = root.RIGS || {};
    root.RIGS[api.ID] = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
