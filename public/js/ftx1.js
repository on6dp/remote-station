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
    extraReads: [{ cmd: 'EX030704;', re: /^EX030704([01])$/, parse: (m) => ({ ant: +m[1] + 1 }), sim: 'EX0307040' }],
    extraControls: [{ id: 'ant', g: 'rx', label: 'Antenne', type: 'select', noTx: true, options: [[1, 'ANT 1'], [2, 'ANT 2']], write: (v) => 'EX030704' + (v - 1) + ';' }],
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
