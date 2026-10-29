/*
 * bandplan.js — plan de bande IARU Région 1 (HF, 6 m, 4 m, 2 m, 70 cm) : mode d'usage de chaque portion de bande.
 * Sert au « MODE AUTO » : quand le VFO entre dans une autre portion, le TRX prend le mode de cette portion
 * (CW, DATA = DATA-U / USB-D, SSB = LSB sous 10 MHz et USB au-dessus, 60 m en USB, FM). Portions « null » (balises,
 * satellites, segments mixtes) : on ne touche à rien.
 * Les fréquences des modes numériques (FT8, FT4, WSPR, JT65, JTTY) et de SSTV situées dans une portion phonie ou CW
 * sont des exceptions (DATA-U), cherchées en premier.
 */
(function (root) {
  'use strict';
  // [début kHz, fin kHz, mode]
  const SEGMENTS = [
    // 160 m
    [1810, 1838, 'CW'], [1838, 1843, 'DATA'], [1843, 2000, 'SSB'],
    // 80 m
    [3500, 3570, 'CW'], [3570, 3600, 'DATA'], [3600, 3800, 'SSB'],
    // 60 m (USB pour la phonie)
    [5351.5, 5354, 'CW'], [5354, 5366.5, 'SSB'],
    // 40 m
    [7000, 7040, 'CW'], [7040, 7050, 'DATA'], [7050, 7200, 'SSB'],
    // 30 m (pas de phonie)
    [10100, 10130, 'CW'], [10130, 10150, 'DATA'],
    // 20 m
    [14000, 14070, 'CW'], [14070, 14099, 'DATA'], [14099, 14101, null], [14101, 14350, 'SSB'],
    // 17 m
    [18068, 18095, 'CW'], [18095, 18109, 'DATA'], [18109, 18111, null], [18111, 18168, 'SSB'],
    // 15 m
    [21000, 21070, 'CW'], [21070, 21149, 'DATA'], [21149, 21151, null], [21151, 21450, 'SSB'],
    // 12 m
    [24890, 24915, 'CW'], [24915, 24929, 'DATA'], [24929, 24931, null], [24931, 24990, 'SSB'],
    // 10 m
    [28000, 28070, 'CW'], [28070, 28190, 'DATA'], [28190, 28225, null], [28225, 29100, 'SSB'], [29100, 29200, 'FM'],
    [29200, 29510, null], [29510, 29700, 'FM'],
    // 6 m
    [50000, 50100, 'CW'], [50100, 50300, 'SSB'], [50300, 50400, 'DATA'], [50400, 50500, null],
    // 4 m
    [70000, 70090, null], [70090, 70100, 'CW'], [70100, 70250, 'SSB'], [70250, 70500, 'FM'],
    // 2 m
    [144000, 144150, 'CW'], [144150, 144400, 'SSB'], [144400, 145000, null], [145000, 146000, 'FM'],
    // 70 cm
    [432000, 432100, 'CW'], [432100, 432400, 'SSB'], [432400, 433000, null], [433000, 434000, 'FM'], [438000, 440000, 'FM']
  ];
  // Fréquences des modes numériques (fréquence affichée du TRX, signal dans les 3 kHz au-dessus) et de SSTV
  const FT8 = [1840, 3573, 5357, 7074, 10136, 14074, 18100, 21074, 24915, 28074, 50313, 70154, 144174, 432174];
  const FT4 = [3575.5, 7047.5, 10140, 14080, 18104, 21140, 24919, 28180, 50318, 144170];
  const WSPR = [1836.6, 3568.6, 5364.7, 7038.6, 10138.7, 14095.6, 18104.6, 21094.6, 24924.6, 28124.6, 50293, 144489, 432300];
  const JT = [1839, 3570, 3572, 7076, 7078, 10138, 10140, 14076, 14090, 18102, 18104, 21076, 21090, 24917, 28076, 28090, 50276];
  const SSTV = [3735, 7165, 14230, 14233, 18160, 21340, 24975, 28680, 50510];
  // Fenêtres qui se chevauchent ou se touchent (ex. FT8 7074, JT65 7076, JTTY 7078) : une seule portion
  const raw = [];
  for (const f of FT8.concat(FT4, JT)) raw.push([f, f + 3, 'numérique']);
  for (const f of WSPR) raw.push([f, f + 2.5, 'WSPR']);
  for (const f of SSTV) raw.push([f - 3, f + 3, 'SSTV']);
  raw.sort((a, b) => a[0] - b[0]);
  const EXC = [];
  for (const [lo, hi, what] of raw) {
    const last = EXC[EXC.length - 1];
    if (last && lo <= last[1] && (last[3] === 'SSTV') === (what === 'SSTV')) { last[1] = Math.max(last[1], hi); if (last[3] !== what) last[3] = 'numérique'; }
    else EXC.push([lo, hi, 'DATA', what]);
  }
  const NAMES = { CW: 'CW', DATA: 'modes numériques', SSB: 'phonie', FM: 'FM' };

  /** Portion de bande de la fréquence hz : { id, mode, label } ; mode null = rien d'imposé ; null hors du plan. */
  function segment(hz) {
    const k = Number(hz) / 1000;
    if (!(k > 0)) return null;
    for (const [lo, hi, mode, what] of EXC) {
      if (k >= lo && k < hi) {
        // Portions SSTV / numériques contiguës (ex. 7074–7081) : même identifiant, pas de changement de mode entre elles
        return { id: 'X' + Math.floor(lo) + (what === 'SSTV' ? 'S' : ''), mode, label: what === 'SSTV' ? 'SSTV' : what === 'WSPR' ? 'WSPR' : 'modes numériques', lo: lo * 1000, hi: hi * 1000 };
      }
    }
    for (const [lo, hi, mode] of SEGMENTS) {
      if (k >= lo && k < hi) return { id: lo + '-' + hi, mode, label: mode ? NAMES[mode] : 'balises / segment mixte', lo: lo * 1000, hi: hi * 1000 };
    }
    return null;
  }
  /** Nom du mode du TRX pour une portion : CW-L / CW-U, LSB / USB (60 m : USB), DATA-U, FM. */
  function modeName(mode, hz) {
    const low = hz < 10000000;
    const m60 = hz >= 5250000 && hz <= 5450000;
    if (mode === 'CW') return low ? 'CW-L' : 'CW-U';
    if (mode === 'SSB') return low && !m60 ? 'LSB' : 'USB';
    if (mode === 'DATA') return 'DATA-U';
    if (mode === 'FM') return 'FM';
    return null;
  }
  /** Code de mode du TRX (MODE_KEYS du pilote) : noms Yaesu et Icom (CW-R / CW, USB-D). */
  function modeKey(R, mode, hz) {
    const n = modeName(mode, hz);
    if (!n) return null;
    const keys = (R && R.MODE_KEYS) || [];
    const alt = { 'CW-L': /^(CW-L|CW-R|CW-LSB)$/i, 'CW-U': /^(CW-U|CW|CW-USB)$/i, 'DATA-U': /^(DATA-U|USB-D|D-U|USB-DATA)$/i, LSB: /^LSB$/i, USB: /^USB$/i, FM: /^FM$/i }[n];
    const k = keys.find((x) => alt.test(x[1])) || (n === 'CW-L' ? keys.find((x) => /^(CW-U|CW)$/i.test(x[1])) : null);
    return k || null; // [code, nom]
  }

  const api = { SEGMENTS, segment, modeName, modeKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BANDPLAN = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
