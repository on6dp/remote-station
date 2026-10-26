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

  const api = Y.build({
    // CW : comme le FTDX101 (mémoire 1 du manipulateur lue par KY6 ; BI0 coupe le break-in pour arrêter)
    cw: { mem: 'KM1', play: 'KY6;', stop: 'BI0;' },
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
    fakeTuning: 'AC002',
    serial: { baudRate: 38400, stopBits: 1, portHint: 'Enhanced COM Port' },
    hint: 'FTDX10 : menu Operation setting → General, « CAT RATE » doit correspondre à la vitesse choisie ici (38400 conseillé). Choisissez le port Enhanced COM Port.'
  });

  // Lectures et réglages propres au FTDX10 : interrupteurs NB/DNR et leurs niveaux
  api.READS.push(
    { cmd: 'NB0;', re: /^NB0([01])$/, parse: (m) => ({ nb: +m[1] }), sim: 'NB00' },
    { cmd: 'NR0;', re: /^NR0([01])$/, parse: (m) => ({ nr: +m[1] }), sim: 'NR00' }
  );
  api.SLOW.push('NB0;', 'NR0;');
  api.STATE_KEYS.push('nbLvl', 'nrLvl');
  const extra = [
    { id: 'nbLvl', g: 'flt', sec: 'dsp', label: 'Niveau NB', type: 'level', min: 0, max: 10, step: 1, write: (v) => 'NL0' + pad(v, 3) + ';' },
    { id: 'nrLvl', g: 'flt', sec: 'dsp', label: 'Niveau DNR', type: 'level', min: 1, max: 15, step: 1, write: (v) => 'RL0' + pad(v, 2) + ';' }
  ];
  for (const c of extra) { api.CONTROLS.push(c); api.CONTROL[c.id] = c; }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.RIGS = root.RIGS || {};
    root.RIGS[api.ID] = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
