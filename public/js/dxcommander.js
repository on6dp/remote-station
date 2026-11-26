/*
 * dxcommander.js — « TRX » DX Commander (DXLab Suite) : la page Station passe par Commander, qui pilote le TRX du club
 * (n'importe quel modèle qu'il connaît) et le partage avec les autres logiciels du PC (DXKeeper, Swisslog, WSJT-X…).
 *
 * Liaison : page Station → assistant Windows du club (http://127.0.0.1:18099/dxc, version 7 ou plus)
 *           → DX Commander sur le même PC (TCP 127.0.0.1, port 52002 par défaut : « TCP Network Service » de Commander).
 * Messages : ceux de « Commander TCP/IP Messages » (DXLab), écrits comme WSJT-X les écrit :
 *   <command:N>Nom<parameters:M>paramètres, chaque paramètre <nom:longueur>valeur.
 *   Lectures : CmdGetFreq → <CmdFreq:n>14,074.000 (kHz, virgule des milliers, point décimal), CmdGetTXFreq → <CmdTXFreq:n>…,
 *   CmdSendMode → <CmdMode:n>USB, CmdSendSplit → <CmdSplit:n>ON / OFF, CmdSendTx → <CmdTX:n>ON / OFF (pas sur tous les TRX).
 *   Réglages : CmdSetFreq (xcvrfreq en kHz, séparateur décimal de Windows au club), CmdSetMode, CmdTX / CmdRX.
 * Ce que Commander ne transmet pas : mesures (S-mètre, puissance, ROS, ALC), filtres, DSP, menus, puissance d'émission,
 * accord, spectre du TRX. La puissance réglée sur le TRX est déclarée sur la page Station (contrôle de la limite de
 * licence de chaque opérateur). SPLIT et VFO B non commandés : derrière Commander, le modèle du TRX n'est pas connu
 * (sur le FTX-1, le split, ST1, ferait émettre le côté SUB).
 */
(function (root) {
  'use strict';
  const ID = 'dxcommander';
  const NAME = 'DX Commander (DXLab)';
  const FREQ_MIN = 30000;
  const FREQ_MAX = 470000000;

  const msg = (cmd, p) => { p = p || ''; return '<command:' + cmd.length + '>' + cmd + '<parameters:' + p.length + '>' + p; };
  const par = (k, v) => { v = String(v); return '<' + k + ':' + v.length + '>' + v; };
  // Séparateur décimal de Windows au club (donné par l'assistant) : xcvrfreq écrit comme WSJT-X l'écrit pour Commander
  let DEC = '.';
  // Puissance réglée sur le TRX, déclarée sur la page Station (Commander ne la lit pas)
  let WATTS = 100;
  // SPLIT lu sur Commander : la fréquence d'émission n'est montrée en VFO B qu'en SPLIT
  let SPLIT = 0;

  // ------------------------------------------------------------ modes (code court ↔ nom de Commander)
  const MODE_LIST = [['L', 'LSB'], ['U', 'USB'], ['C', 'CW'], ['CR', 'CW-R'], ['A', 'AM'], ['F', 'FM'], ['R', 'RTTY'], ['RR', 'RTTY-R'],
    ['DL', 'DATA-L'], ['DU', 'DATA-U']];
  const MODES = {};
  for (const [c, n] of MODE_LIST) MODES[c] = n;
  const MODE_KEYS = MODE_LIST.map((x) => x.slice());
  const SETTABLE = MODE_LIST.map((x) => x[0]);
  // Noms renvoyés par Commander selon le TRX (comme WSJT-X les reconnaît)
  const MODE_IN = { AM: 'A', CW: 'C', 'CW-R': 'CR', FM: 'F', WBFM: 'F', LSB: 'L', USB: 'U', RTTY: 'R', 'RTTY-R': 'RR',
    PKT: 'DL', 'DATA-L': 'DL', 'DIGL': 'DL', 'PKT-R': 'DU', 'DATA-U': 'DU', 'DIGU': 'DU' };

  // ------------------------------------------------------------ lectures
  const Q = { freq: msg('CmdGetFreq'), txf: msg('CmdGetTXFreq'), mode: msg('CmdSendMode'), split: msg('CmdSendSplit'), tx: msg('CmdSendTx') };
  const FAST = [Q.freq, Q.mode, Q.tx];
  const SLOW = [Q.split, Q.txf];
  const SLOW_PER_TICK = 1;
  const TXMETERS = [];
  const POLL_MS = 400;
  const FRAME_GAP_MS = 30;
  const INIT = [];
  const CAT_QUERIES = Object.keys(Q).map((k) => Q[k]);
  const STATE_KEYS = ['split', 'txVfo'];
  const STR_KEYS = [];

  // ------------------------------------------------------------ commandes
  function checkFreq(hz) {
    hz = Math.round(Number(hz));
    if (!(hz >= FREQ_MIN && hz <= FREQ_MAX)) throw new Error('fréquence hors limites');
    return hz;
  }
  const khz = (hz) => (checkFreq(hz) / 1000).toFixed(3).replace('.', DEC);
  const cmdFreq = (hz) => msg('CmdSetFreq', par('xcvrfreq', khz(hz)));
  function cmdFreqB() { throw new Error('VFO B : pas commandé par DX Commander (réglez-le sur le TRX ou dans Commander)'); }
  function cmdMode(code, sub) {
    if (sub) throw new Error('VFO B : pas commandé par DX Commander');
    const n = MODES[code];
    if (!n) throw new Error('mode inconnu');
    return msg('CmdSetMode', par('1', n));
  }
  const cmdPtt = (on) => msg(on ? 'CmdTX' : 'CmdRX');
  function cmdPower() { throw new Error('puissance : à régler sur le TRX (DX Commander ne la transmet pas)'); }
  // Puissance « réglée sur le TRX » déclarée : tête fictive C, plage fixe (jamais commandée)
  const POWER_RANGE = { C: [1, 2000] };
  const POWER_STEP = { C: 1 };

  // Aucun réglage par Commander (filtres, DSP, menus…) : liste vide
  const GROUPS = [];
  const CONTROLS = [];
  const CONTROL = {};
  function validate() { throw new Error('réglage pas disponible par DX Commander'); }
  const readFor = () => null;

  // ------------------------------------------------------------ réponses
  /** Découpe le flux en réponses, une par ligne (l'assistant met chaque réponse de Commander sur sa ligne). */
  class Splitter {
    constructor() { this.acc = ''; }
    push(chunk) {
      this.acc += typeof chunk === 'string' ? chunk : String.fromCharCode.apply(null, Array.from(chunk));
      if (this.acc.length > 65536) this.acc = this.acc.slice(-4096);
      const out = [];
      let i;
      while ((i = this.acc.indexOf('\n')) >= 0) {
        const l = this.acc.slice(0, i).replace(/\r$/, '');
        this.acc = this.acc.slice(i + 1);
        if (l) out.push(l);
      }
      return out;
    }
  }
  // kHz de Commander (« 14,074.000 », ou « 14074,000 » selon Windows) → Hz
  function hzOf(s) {
    s = String(s).replace(/[\s  �]/g, '');
    if (s.indexOf('.') >= 0) s = s.replace(/,/g, ''); // virgule des milliers, point décimal
    else if (/,\d{1,3}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // virgule décimale
    const k = parseFloat(s);
    return Number.isFinite(k) && k > 0 ? Math.round(k * 1000) : null;
  }
  function parse(t) {
    if (typeof t !== 'string') return null;
    const m = /^<(\w+):(\d+)>(.*)$/.exec(t.trim());
    if (!m) return null;
    const k = m[1].toLowerCase(), v = m[3].slice(0, Number(m[2]) || m[3].length).trim();
    // Puissance déclarée jointe aux lectures : contrôle de la limite de licence côté serveur
    const pw = { power: WATTS, powerHead: 'C' };
    if (k === 'cmdfreq') { const hz = hzOf(v); return hz ? Object.assign({ freq: hz }, pw) : { ok: true }; }
    if (k === 'cmdtxfreq') { const hz = hzOf(v); return hz && SPLIT ? { freqB: hz } : { freqB: null }; }
    if (k === 'cmdmode') {
      const c = MODE_IN[v.toUpperCase()] || MODE_IN[v];
      return c ? { modeCode: c, mode: MODES[c] } : { ok: true };
    }
    if (k === 'cmdsplit') { const s = /^ON$/i.test(v) ? 1 : 0; SPLIT = s; return s ? { split: 1, txVfo: 1 } : { split: 0, txVfo: 0, freqB: null }; }
    if (k === 'cmdtx') { if (/^ON$/i.test(v)) return { tx: 1 }; if (/^OFF$/i.test(v)) return { tx: 0 }; return { ok: true }; }
    return { ok: true };
  }

  // ------------------------------------------------------------ simulateur (« Tester sans radio »)
  class Fake {
    constructor() { this.v = { freq: 14074000, mode: 'USB', tx: 0, split: 0, txf: 14074000 }; this.onData = null; }
    write(s) {
      const v = this.v;
      const out = [];
      const rep = (name, val) => out.push('<' + name + ':' + String(val).length + '>' + val);
      for (const m0 of String(s).split('\n')) {
        const m = /^<command:\d+>(\w+)<parameters:\d+>(.*)$/.exec(m0);
        if (!m) continue;
        const c = m[1], p = m[2];
        const pv = (k) => { const r = new RegExp('<' + k + ':(\\d+)>').exec(p); return r ? p.substr(r.index + r[0].length, +r[1]) : null; };
        if (c === 'CmdGetFreq') rep('CmdFreq', (v.freq / 1000).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
        else if (c === 'CmdGetTXFreq') rep('CmdTXFreq', (v.txf / 1000).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
        else if (c === 'CmdSendMode') rep('CmdMode', v.mode);
        else if (c === 'CmdSendSplit') rep('CmdSplit', v.split ? 'ON' : 'OFF');
        else if (c === 'CmdSendTx') rep('CmdTX', v.tx ? 'ON' : 'OFF');
        else if (c === 'CmdSetFreq') { const f = hzOf(String(pv('xcvrfreq') || '').replace(',', '.')); if (f) { v.freq = f; v.txf = f; } }
        else if (c === 'CmdSetMode') { const n = pv('1'); if (n) v.mode = n; }
        else if (c === 'CmdTX') v.tx = 1;
        else if (c === 'CmdRX') v.tx = 0;
      }
      if (out.length && this.onData) { const txt = out.join('\n') + '\n'; setTimeout(() => this.onData && this.onData(txt), 10); }
    }
  }

  const api = {
    ID, NAME, MODES, SETTABLE, MODE_KEYS, FREQ_MIN, FREQ_MAX, POWER_RANGE, POWER_STEP, INIT,
    FAST, SLOW, SLOW_PER_TICK, TXMETERS, POLL_MS, FRAME_GAP_MS, readFor, CAT_QUERIES, STATE_KEYS, STR_KEYS,
    GROUPS, CONTROLS, CONTROL, validate, cmdFreq, cmdFreqB, cmdMode, cmdPower, cmdPtt, parse, Splitter,
    widthTable: () => null,
    bwText: () => '—',
    // Pas de mesures par Commander
    smeterLabel: () => 'S —',
    smeterDb: () => null,
    // Particularités de cette liaison (page Station, serveur)
    TRANSPORT: 'dxc', // pas de port série : l'assistant Windows du club relaie vers Commander
    NO_METERS: true, // pas de mesure de puissance de sortie : pas de coupure « en émission sans modulation »
    TX_UNCONFIRMED: true, // CmdSendTx pas toujours pris en charge : pas de « TX1 renvoyé » si l'émission n'est pas relue
    NO_POWER_SET: true, // puissance jamais commandée (déclarée sur la page Station)
    NO_SPLIT: true,
    setDecimal: (d) => { if (d === ',' || d === '.') DEC = d; },
    setWatts: (w) => { w = Math.round(Number(w)); if (w >= 1 && w <= 2000) WATTS = w; },
    hzOf,
    CW: null, VOICE: null, SCOPE: null, TRX_EQ: null,
    Fake,
    serial: { baudRate: 0, stopBits: 1, portHint: 'DX Commander (TCP 52002, sur ce PC)' },
    hint: 'DX Commander (DXLab) : Commander pilote le TRX et le partage avec les autres logiciels de ce PC. Dans Commander : Configuration → Ports → « TCP Network Service » : « Accept commands » coché (port de base 52000, commandes sur 52002). Il faut l’assistant Windows du club version 7 (il relaie vers Commander). Indiquez ci-dessous la puissance réglée sur le TRX : Commander ne la transmet pas, elle sert au contrôle de la limite de licence de chaque opérateur.'
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.RIGS = root.RIGS || {};
    root.RIGS[ID] = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
