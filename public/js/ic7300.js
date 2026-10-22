/*
 * ic7300.js — pilote CI-V de l'Icom IC-7300 (port USB intégré)
 *
 * Protocole binaire : FE FE <à> <de> <commande> [sous-commande] [données] FD
 *   à  = 94 (adresse par défaut de l'IC-7300), de = E0 (contrôleur)
 *   réponse FB = OK, FA = refusé.
 * Fréquences : 5 octets BCD, chiffres de poids faible d'abord. Niveaux et mesures : 0000–0255 en BCD sur 2 octets.
 *
 * Références : IC-7300 Full Manual §19 « Control command » (Icom) et RigPlane Core rigs/ic7300.toml (MIT, voir TIERS.md).
 * Le pilote expose la même interface que les pilotes Yaesu (ftx1.js, ftdx10.js).
 */
(function (root) {
  'use strict';

  const ID = 'ic7300';
  const NAME = 'Icom IC-7300';
  const ADDR = 0x94;
  const CTRL = 0xE0;
  const FREQ_MIN = 30000;
  const FREQ_MAX = 74800000;

  // ------------------------------------------------------------ outils BCD
  const bcd = (n) => ((Math.floor(n / 10) % 10) << 4) | (n % 10);
  const unbcd = (b) => (b >> 4) * 10 + (b & 0x0f);
  function freqBytes(hz) {
    const out = [];
    let v = Math.round(hz);
    for (let i = 0; i < 5; i++) { out.push(bcd(v % 100)); v = Math.floor(v / 100); }
    return out;
  }
  function freqValue(b, o) {
    let v = 0;
    for (let i = 4; i >= 0; i--) v = v * 100 + unbcd(b[o + i]);
    return v;
  }
  const lvlBytes = (v) => [bcd(Math.floor(v / 100)), bcd(v % 100)];
  const lvlValue = (b, o) => unbcd(b[o]) * 100 + unbcd(b[o + 1]);
  function frame(bytes) {
    return Uint8Array.from([0xFE, 0xFE, ADDR, CTRL].concat(bytes, [0xFD]));
  }

  // ------------------------------------------------------------ modes
  // Code de mode = octet CI-V en hexadécimal, suivi de « D » pour le mode DATA (USB-D…)
  const MODE_BYTES = { '00': 'LSB', '01': 'USB', '02': 'AM', '03': 'CW', '04': 'RTTY', '05': 'FM', '07': 'CW-R', '08': 'RTTY-R' };
  const DATA_OK = ['00', '01', '02', '05'];
  const MODES = {};
  for (const k in MODE_BYTES) {
    MODES[k] = MODE_BYTES[k];
    if (DATA_OK.indexOf(k) >= 0) MODES[k + 'D'] = MODE_BYTES[k] + '-D';
  }
  const MODE_KEYS = [
    ['00', 'LSB'], ['01', 'USB'], ['03', 'CW'], ['07', 'CW-R'], ['04', 'RTTY'], ['08', 'RTTY-R'],
    ['00D', 'LSB-D'], ['01D', 'USB-D'], ['02', 'AM'], ['02D', 'AM-D'], ['05', 'FM'], ['05D', 'FM-D']
  ];
  const SETTABLE = Object.keys(MODES);
  const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');

  // ------------------------------------------------------------ lectures
  // FAST : à chaque cycle. SLOW : une tranche par cycle (tour complet en ~1,5 s). TXMETERS : en émission.
  const q = (...b) => frame(b);
  const FAST = [q(0x25, 0x00), q(0x26, 0x00), q(0x15, 0x02), q(0x1C, 0x00)];
  // En émission : mesures, plus puissance et VOX (contrôles de sécurité plus rapides)
  const TXMETERS = [q(0x15, 0x11), q(0x15, 0x12), q(0x15, 0x13), q(0x15, 0x14), q(0x14, 0x0A), q(0x16, 0x46)];
  const SLOW = [
    q(0x25, 0x01), q(0x26, 0x01), q(0x0F), q(0x14, 0x0A), q(0x21, 0x00), q(0x21, 0x01), q(0x21, 0x02),
    q(0x14, 0x01), q(0x14, 0x02), q(0x14, 0x03), q(0x11), q(0x16, 0x02), q(0x16, 0x12),
    q(0x16, 0x22), q(0x14, 0x12), q(0x16, 0x40), q(0x14, 0x06), q(0x16, 0x41), q(0x16, 0x48), q(0x14, 0x0D),
    q(0x14, 0x07), q(0x14, 0x08), q(0x14, 0x0B), q(0x16, 0x44), q(0x14, 0x0E), q(0x16, 0x46), q(0x1C, 0x01),
    q(0x16, 0x50), q(0x15, 0x15), q(0x15, 0x16)
  ];
  const SLOW_PER_TICK = 5;
  const POLL_MS = 250;
  const FRAME_GAP_MS = 15; // laisse le temps à la radio de répondre entre deux trames
  // À l'ouverture du port : TX OFF (au cas où la radio serait restée en émission par CAT)
  const INIT = [q(0x1C, 0x00, 0x00)];

  const STATE_KEYS = ['txVfo', 'split', 'rit', 'xit', 'clar', 'lock', 'fil', 'filB', 'pbtIn', 'pbtOut', 'nb', 'nbLvl', 'nr', 'nrLvl',
    'dnf', 'notch', 'notchPos', 'af', 'rf', 'sql', 'agc', 'preamp', 'att', 'mic', 'proc', 'procLvl', 'vox', 'tuner', 'tuning',
    'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];

  // Lectures simples : [commande, sous-commande, clé, type] (type : t = 0/1, l = niveau 0–255, b = octet)
  const SIMPLE = [
    [0x14, 0x0A, 'powerRaw', 'l'], [0x14, 0x01, 'af', 'l'], [0x14, 0x02, 'rf', 'l'], [0x14, 0x03, 'sql', 'l'],
    [0x14, 0x12, 'nbLvl', 'l'], [0x14, 0x06, 'nrLvl', 'l'], [0x14, 0x0D, 'notchPos', 'l'], [0x14, 0x07, 'pbtIn', 'l'],
    [0x14, 0x08, 'pbtOut', 'l'], [0x14, 0x0B, 'mic', 'l'], [0x14, 0x0E, 'procLvl', 'l'],
    [0x15, 0x02, 'smeter', 'l'], [0x15, 0x11, 'm5', 'l'], [0x15, 0x12, 'm6', 'l'], [0x15, 0x13, 'm4', 'l'],
    [0x15, 0x14, 'm3', 'l'], [0x15, 0x15, 'm8', 'l'], [0x15, 0x16, 'm7', 'l'],
    [0x16, 0x02, 'preamp', 'b'], [0x16, 0x12, 'agc', 'b'], [0x16, 0x22, 'nb', 't'], [0x16, 0x40, 'nr', 't'],
    [0x16, 0x41, 'dnf', 't'], [0x16, 0x48, 'notch', 't'], [0x16, 0x44, 'proc', 't'], [0x16, 0x46, 'vox', 't'],
    [0x16, 0x50, 'lock', 't'], [0x21, 0x01, 'rit', 't'], [0x21, 0x02, 'xit', 't']
  ];
  const SIMPLE_MAP = {};
  for (const s of SIMPLE) SIMPLE_MAP[s[0] * 256 + s[1]] = s;
  // Trame de lecture de chaque clé d'état : relue juste après un réglage
  const READ_FOR = { power: q(0x14, 0x0A), split: q(0x0F), att: q(0x11), clar: q(0x21, 0x00), clarClr: q(0x21, 0x00), fil: q(0x26, 0x00), tuner: q(0x1C, 0x01) };
  for (const s of SIMPLE) if (s[2] !== 'powerRaw' && s[0] !== 0x15) READ_FOR[s[2]] = q(s[0], s[1]);
  const readFor = (id) => READ_FOR[id] || null;

  // ------------------------------------------------------------ réglages
  const setLvl = (c, s) => (v) => q(c, s, ...lvlBytes(v));
  const setOn = (c, s) => (v) => q(c, s, v ? 1 : 0);
  const pbtFmt = (v) => (v > 128 ? '+' : '') + (v - 128);
  function modeBytes(code) {
    code = String(code).toUpperCase();
    if (!MODES[code]) throw new Error('mode non autorisé');
    return [parseInt(code.slice(0, 2), 16), /D$/.test(code) ? 1 : 0];
  }
  const GROUPS = [['vfo', 'VFO et SPLIT'], ['flt', 'Filtres et DSP'], ['rx', 'Réception'], ['tx', 'Émission']];
  const CONTROLS = [
    { id: 'split', g: 'vfo', label: 'SPLIT', type: 'toggle', write: (v) => q(0x0F, v ? 1 : 0) },
    { id: 'swap', g: 'vfo', label: 'A ⇄ B', type: 'action', write: () => q(0x07, 0xB0) },
    { id: 'aToB', g: 'vfo', label: 'A → B', type: 'action', write: () => q(0x07, 0xA0) },
    { id: 'rit', g: 'vfo', label: 'RIT', type: 'toggle', write: setOn(0x21, 0x01) },
    { id: 'xit', g: 'vfo', label: 'XIT', type: 'toggle', write: setOn(0x21, 0x02) },
    {
      id: 'clar', g: 'vfo', label: 'Décalage RIT/XIT', type: 'level', min: -9999, max: 9999, step: 10, unit: 'Hz',
      write: (v) => { const a = Math.abs(v); return q(0x21, 0x00, bcd(a % 100), bcd(Math.floor(a / 100)), v < 0 ? 1 : 0); }
    },
    { id: 'clarClr', g: 'vfo', label: 'CLEAR (décalage RIT/XIT à zéro)', type: 'action', write: () => q(0x21, 0x00, 0, 0, 0) },
    { id: 'lock', g: 'vfo', label: 'LOCK (face avant du club)', type: 'toggle', write: setOn(0x16, 0x50) },

    {
      id: 'fil', g: 'flt', sec: 'filter', label: 'FILTRE', type: 'select', options: [[1, 'FIL1'], [2, 'FIL2'], [3, 'FIL3']],
      write: (v, s) => q(0x26, 0x00, ...modeBytes(s.modeCode || '01'), v), when: (s) => !!s.modeCode
    },
    { id: 'pbtIn', g: 'flt', sec: 'filter', label: 'PBT intérieur', type: 'level', min: 0, max: 255, step: 1, fmt: pbtFmt, write: setLvl(0x14, 0x07) },
    { id: 'pbtOut', g: 'flt', sec: 'filter', label: 'PBT extérieur', type: 'level', min: 0, max: 255, step: 1, fmt: pbtFmt, write: setLvl(0x14, 0x08) },
    { id: 'nb', g: 'flt', label: 'NB', type: 'toggle', write: setOn(0x16, 0x22) },
    { id: 'nbLvl', g: 'flt', sec: 'dsp', label: 'Niveau NB', type: 'level', min: 0, max: 255, step: 1, pct: true, write: setLvl(0x14, 0x12) },
    { id: 'nr', g: 'flt', label: 'NR', badge: 'NR', type: 'toggle', write: setOn(0x16, 0x40) },
    { id: 'nrLvl', g: 'flt', sec: 'dsp', label: 'Niveau NR', type: 'level', min: 0, max: 255, step: 1, pct: true, write: setLvl(0x14, 0x06) },
    { id: 'notch', g: 'flt', label: 'NOTCH manuel', badge: 'MN', type: 'toggle', write: setOn(0x16, 0x48) },
    { id: 'notchPos', g: 'flt', sec: 'dsp', label: 'Position NOTCH', type: 'level', min: 0, max: 255, step: 1, write: setLvl(0x14, 0x0D), when: (s) => !!s.notch },
    { id: 'dnf', g: 'flt', label: 'AUTO NOTCH', badge: 'AN', type: 'toggle', write: setOn(0x16, 0x41) },

    { id: 'af', g: 'rx', label: 'AF', type: 'level', min: 0, max: 255, step: 1, pct: true, write: setLvl(0x14, 0x01) },
    { id: 'rf', g: 'rx', label: 'RF', type: 'level', min: 0, max: 255, step: 1, pct: true, write: setLvl(0x14, 0x02) },
    { id: 'sql', g: 'rx', label: 'Squelch', type: 'level', min: 0, max: 255, step: 1, pct: true, write: setLvl(0x14, 0x03) },
    { id: 'agc', g: 'rx', label: 'AGC', type: 'select', options: [[1, 'FAST'], [2, 'MID'], [3, 'SLOW']], write: (v) => q(0x16, 0x12, v) },
    { id: 'preamp', g: 'rx', label: 'Préampli', type: 'select', options: [[0, 'PRE OFF'], [1, 'P.AMP1'], [2, 'P.AMP2']], write: (v) => q(0x16, 0x02, v) },
    { id: 'att', g: 'rx', label: 'ATT 20 dB', badge: 'ATT', type: 'toggle', write: (v) => q(0x11, v ? 0x20 : 0x00) },

    { id: 'mic', g: 'tx', label: 'Gain micro', type: 'level', min: 0, max: 255, step: 1, pct: true, write: setLvl(0x14, 0x0B) },
    { id: 'proc', g: 'tx', label: 'COMP', type: 'toggle', write: setOn(0x16, 0x44) },
    { id: 'procLvl', g: 'tx', label: 'Niveau COMP', type: 'level', min: 0, max: 255, step: 1, pct: true, write: setLvl(0x14, 0x0E) },
    // VOX : on peut le couper à distance, jamais l'activer
    { id: 'vox', g: 'tx', label: 'VOX', type: 'toggle', offOnly: true, write: setOn(0x16, 0x46) },
    { id: 'tuner', g: 'tx', label: 'Tuner', type: 'toggle', write: (v) => q(0x1C, 0x01, v ? 1 : 0) },
    { id: 'tune', g: 'tx', label: 'TUNE', type: 'action', transmits: true, write: () => q(0x1C, 0x01, 0x02) }
  ];
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
    throw new Error('type inconnu');
  }

  // ------------------------------------------------------------ commandes de base
  function checkFreq(hz) {
    hz = Math.round(Number(hz));
    if (!(hz >= FREQ_MIN && hz <= FREQ_MAX)) throw new Error('fréquence hors limites');
    return hz;
  }
  const cmdFreq = (hz) => q(0x25, 0x00, ...freqBytes(checkFreq(hz)));
  const cmdFreqB = (hz) => q(0x25, 0x01, ...freqBytes(checkFreq(hz)));
  function cmdMode(code, sub, st) {
    const fil = st && (sub ? st.filB : st.fil);
    return q(0x26, sub ? 0x01 : 0x00, ...modeBytes(code), fil >= 1 && fil <= 3 ? fil : 1);
  }
  // Puissance RF : 0–255 ↔ 0–100 %, soit 0–100 W sur l'IC-7300
  const POWER_RANGE = { I: [5, 100] };
  const POWER_STEP = { I: 5 };
  function cmdPower(watts) {
    const w = Math.round(Number(watts));
    if (!(w >= POWER_RANGE.I[0] && w <= POWER_RANGE.I[1])) throw new Error('puissance hors plage (5–100 W)');
    return q(0x14, 0x0A, ...lvlBytes(Math.round(w * 2.55)));
  }
  const cmdPtt = (on) => q(0x1C, 0x00, on ? 1 : 0);

  // ------------------------------------------------------------ analyse des trames
  /** Découpe le flux d'octets en trames FE FE … FD. Renvoie le contenu [à, de, commande, …]. */
  class Splitter {
    constructor() { this.acc = []; }
    push(chunk) {
      if (typeof chunk === 'string') chunk = Array.from(chunk, (c) => c.charCodeAt(0) & 0xff);
      for (let i = 0; i < chunk.length; i++) this.acc.push(chunk[i]);
      if (this.acc.length > 4096) this.acc = this.acc.slice(-512);
      const out = [];
      for (;;) {
        let s = -1;
        for (let i = 0; i + 1 < this.acc.length; i++) if (this.acc[i] === 0xFE && this.acc[i + 1] === 0xFE) { s = i; break; }
        if (s < 0) { if (this.acc.length && this.acc[this.acc.length - 1] !== 0xFE) this.acc = []; break; }
        let p = s + 2;
        while (p < this.acc.length && this.acc[p] === 0xFE) p++; // préambule plus long
        const e = this.acc.indexOf(0xFD, p);
        if (e < 0) { this.acc = this.acc.slice(s); break; }
        const body = this.acc.slice(p, e);
        this.acc = this.acc.slice(e + 1);
        if (body.length >= 3 && body.indexOf(0xFC) < 0) out.push(body); // FC = collision sur le bus
      }
      return out;
    }
  }

  function parseMode(b, o) {
    const m = hex2(b[o]);
    if (!MODE_BYTES[m]) return { code: m, name: '?' + m };
    const code = m + (b[o + 1] === 1 && DATA_OK.indexOf(m) >= 0 ? 'D' : '');
    return { code, name: MODES[code], fil: b[o + 2] };
  }

  function parse(f) {
    if (!f || f.length < 3) return null;
    const to = f[0], from = f[1], c = f[2];
    if (from !== ADDR || (to !== CTRL && to !== 0x00)) return null; // écho de nos propres trames, autre appareil…
    const d = f.slice(3);
    if (c === 0xFB) return { ok: true };
    if (c === 0xFA) return { error: true };
    if (c === 0x00 && d.length >= 5) return { freq: freqValue(d, 0) }; // transceive : VFO choisi
    if (c === 0x01) return { ok: true }; // transceive : mode (relu par 26 00 au cycle suivant)
    if (c === 0x25 && d.length >= 6) return d[0] === 0 ? { freq: freqValue(d, 1) } : { freqB: freqValue(d, 1) };
    if (c === 0x26 && d.length >= 4) {
      const m = parseMode(d, 1);
      return d[0] === 0 ? { modeCode: m.code, mode: m.name, fil: m.fil } : { modeCodeB: m.code, modeB: m.name, filB: m.fil };
    }
    if (c === 0x0F && d.length >= 1) { const s = d[0] === 1 ? 1 : 0; return { split: s, txVfo: s }; }
    if (c === 0x11 && d.length >= 1) return { att: d[0] ? 1 : 0 };
    if (c === 0x1C && d.length >= 2) {
      if (d[0] === 0x00) return { tx: d[1] ? 1 : 0 };
      if (d[0] === 0x01) return { tuner: d[1] ? 1 : 0, tuning: d[1] === 2 ? 1 : 0 };
      return { ok: true };
    }
    if (c === 0x21 && d[0] === 0x00 && d.length >= 4) {
      const v = unbcd(d[1]) + unbcd(d[2]) * 100;
      return { clar: d[3] ? -v : v };
    }
    if (d.length >= 1) {
      const s = SIMPLE_MAP[c * 256 + d[0]];
      if (s) {
        if (s[3] === 'l' && d.length >= 3) {
          const v = lvlValue(d, 1);
          if (s[2] === 'powerRaw') return { powerHead: 'I', power: Math.round((v * 100) / 255) };
          return { [s[2]]: v };
        }
        if (s[3] === 't' && d.length >= 2) return { [s[2]]: d[1] ? 1 : 0 };
        if (s[3] === 'b' && d.length >= 2) return { [s[2]]: d[1] };
      }
    }
    return { ok: true }; // trame valide de la radio mais non utilisée
  }

  // ------------------------------------------------------------ étalonnages (manuel §19, commande 15)
  function interp(cal, raw) {
    if (raw == null) return null;
    for (let i = 1; i < cal.length; i++) {
      const [r0, v0] = cal[i - 1];
      const [r1, v1] = cal[i];
      if (raw <= r1) return v0 + ((raw - r0) / (r1 - r0)) * (v1 - v0);
    }
    return cal[cal.length - 1][1];
  }
  function smeterLabel(v) {
    if (v == null) return '—';
    if (v < 120) return 'S' + Math.max(0, Math.min(8, Math.round((v / 120) * 9)));
    const db = Math.round(((v - 120) / 121) * 60 / 10) * 10; // 0120 = S9, 0241 = S9+60 dB
    return db > 0 ? 'S9+' + db : 'S9';
  }
  const swrValue = (raw) => interp([[0, 1.0], [48, 1.5], [80, 2.0], [120, 3.0], [255, 5.0]], raw);
  const vdValue = (raw) => interp([[0, 0], [13, 10], [241, 16]], raw);
  const idValue = (raw) => interp([[0, 0], [97, 10], [146, 15], [241, 25]], raw);
  const poFrac = (raw) => (raw == null ? null : Math.min(1, raw / 213)); // 0213 = 100 %

  // ------------------------------------------------------------ simulateur
  class Fake {
    constructor() {
      this.v = {
        freq: 14250000, freqB: 7074000, mode: [0x01, 0, 1], modeB: [0x01, 1, 2], tx: 0, split: 0, power: 255,
        rit: 0, xit: 0, clar: 0, att: 0, tuner: 0
      };
      this.lv = {}; // niveaux et interrupteurs par clé commande*256+sous-commande
      for (const s of SIMPLE) this.lv[s[0] * 256 + s[1]] = s[3] === 'l' ? 128 : s[2] === 'agc' ? 2 : 0;
      this.lv[0x1402] = 255;
      this.lv[0x1403] = 0;
      this.lv[0x1515] = 157; // 13,8 V environ
      this.sp = new Splitter();
      this.onData = null;
      this.t = 0;
    }
    write(data) {
      const out = [];
      const ok = () => out.push([CTRL, ADDR, 0xFB]);
      const ng = () => out.push([CTRL, ADDR, 0xFA]);
      const v = this.v;
      for (const f of this.sp.push(data)) {
        if (f[0] !== ADDR || f[1] !== CTRL) continue;
        const c = f[2];
        const d = f.slice(3);
        const r = (...b) => out.push([CTRL, ADDR, c].concat(b));
        if (c === 0x25) {
          const k = d[0] === 0 ? 'freq' : 'freqB';
          if (d.length === 1) r(d[0], ...freqBytes(v[k]));
          else { v[k] = freqValue(d, 1); ok(); }
        } else if (c === 0x26) {
          const k = d[0] === 0 ? 'mode' : 'modeB';
          if (d.length === 1) r(d[0], ...v[k]);
          else if (MODE_BYTES[hex2(d[1])]) { v[k] = [d[1], d[2] || 0, d[3] || 1]; ok(); } else ng();
        } else if (c === 0x0F) {
          if (!d.length) r(v.split); else { v.split = d[0] ? 1 : 0; ok(); }
        } else if (c === 0x11) {
          if (!d.length) r(v.att); else { v.att = d[0]; ok(); }
        } else if (c === 0x07) {
          if (d[0] === 0xB0) [v.freq, v.freqB, v.mode, v.modeB] = [v.freqB, v.freq, v.modeB, v.mode];
          else if (d[0] === 0xA0) { v.freqB = v.freq; v.modeB = v.mode.slice(); }
          ok();
        } else if (c === 0x1C && d[0] === 0x00) {
          if (d.length === 1) r(0x00, v.tx); else { v.tx = d[1] ? 1 : 0; ok(); }
        } else if (c === 0x1C && d[0] === 0x01) {
          if (d.length === 1) r(0x01, v.tuner); else { v.tuner = d[1]; if (d[1] === 2) this.swrRaw = 30; ok(); }
        } else if (c === 0x21 && d[0] === 0x00) {
          const a = Math.abs(v.clar);
          if (d.length === 1) r(0x00, bcd(a % 100), bcd(Math.floor(a / 100)), v.clar < 0 ? 1 : 0);
          else { v.clar = (unbcd(d[1]) + unbcd(d[2]) * 100) * (d[3] ? -1 : 1); ok(); }
        } else if (c === 0x15) {
          const k = c * 256 + d[0];
          let val = this.lv[k] || 0;
          if (d[0] === 0x02) { this.t += 0.15; val = v.tx ? 0 : Math.max(0, Math.min(241, Math.round(70 + 50 * Math.sin(this.t) + 20 * Math.random()))); }
          else if (d[0] === 0x11) val = v.tx && !this.silent ? Math.round((v.power / 255) * 213) : 0;
          else if (d[0] === 0x12) val = v.tx ? (this.swrRaw || 30) : 0;
          else if (d[0] === 0x13) val = v.tx ? 40 : 0;
          else if (d[0] === 0x14) val = v.tx ? 15 : 0;
          else if (d[0] === 0x16) val = v.tx ? Math.round((v.power / 255) * 180) : 5;
          r(d[0], ...lvlBytes(val));
        } else if (c === 0x14 && d[0] === 0x0A) {
          if (d.length === 1) r(0x0A, ...lvlBytes(v.power)); else { v.power = lvlValue(d, 1); ok(); }
        } else if (SIMPLE_MAP[c * 256 + d[0]]) {
          const s = SIMPLE_MAP[c * 256 + d[0]];
          const k = c * 256 + d[0];
          if (d.length === 1) r(d[0], ...(s[3] === 'l' ? lvlBytes(this.lv[k]) : [this.lv[k]]));
          else { this.lv[k] = s[3] === 'l' ? lvlValue(d, 1) : d[1]; ok(); }
        } else ng();
      }
      if (out.length && this.onData) {
        const bytes = [];
        for (const o of out) bytes.push(0xFE, 0xFE, ...o, 0xFD);
        const u = Uint8Array.from(bytes);
        setTimeout(() => this.onData && this.onData(u), 5);
      }
    }
  }

  const api = {
    ID, NAME, MODES, SETTABLE, MODE_KEYS, FREQ_MIN, FREQ_MAX, POWER_RANGE, POWER_STEP, INIT,
    FAST, SLOW, SLOW_PER_TICK, TXMETERS, POLL_MS, FRAME_GAP_MS, readFor, TX_SOURCE_UNKNOWN: true, STATE_KEYS,
    GROUPS, CONTROLS, CONTROL, validate, widthTable: () => null, cmdFreq, cmdFreqB, cmdMode, cmdPower, cmdPtt, parse, Splitter,
    smeterLabel, swrValue, vdValue, idValue, poFrac,
    bwText: (r) => (r.fil ? 'FIL' + r.fil : '—'),
    Fake,
    serial: { baudRate: 115200, stopBits: 1, portHint: 'Silicon Labs CP210x (port USB de l’IC-7300)' },
    hint: 'IC-7300 : MENU → SET → Connectors → CI-V : « CI-V USB Baud Rate » = 115200, « CI-V Address » = 94h, « CI-V USB Echo Back » = OFF. Laissez « USB SEND » et « USB Keying » sur OFF.'
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.RIGS = root.RIGS || {};
    root.RIGS[ID] = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
