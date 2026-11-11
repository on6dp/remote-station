/*
 * ic7760.js — pilote CI-V de l'Icom IC-7760 (port [USB B] à l'arrière de la tête de commande)
 *
 * Protocole binaire : FE FE <à> <de> <commande> [sous-commande] [données] FD
 *   à  = B2 (adresse par défaut de l'IC-7760), de = E0 (contrôleur)
 *   réponse FB = OK, FA = refusé.
 * Deux récepteurs : MAIN (= VFO-A de Remote Station) et SUB (= VFO-B), comme le FTDX101.
 *   25 00 / 25 01 : fréquence du MAIN / du SUB ; 26 00 / 26 01 : mode, DATA et filtre du MAIN / du SUB
 *   07 D0 / D1 : MAIN / SUB sélectionné (07 D2 : lecture) ; 07 C0 / C1 : Dualwatch (07 C2 : lecture)
 *   07 B0 : échange MAIN ⇄ SUB ; 07 B1 : égalise MAIN et SUB ; 0F : SPLIT (émission sur le SUB)
 *   29 00 / 29 01 + commande : la commande pour le MAIN / le SUB, quel que soit le côté sélectionné (commandes marquées
 *   « 29 » dans le guide : ATT, antenne, AF, RF, SQL, NR, PBT, NOTCH, NB, préampli, AGC, S-mètre, largeur du filtre…)
 * Fréquences : 5 octets BCD, chiffres de poids faible d'abord. Niveaux et mesures : 0000–0255 en BCD sur 2 octets.
 *
 * Référence : IC-7760 CI-V Reference Guide (Icom, octobre 2024, A7788-8EX). Seules les commandes de ce guide sont envoyées.
 * Pilote écrit sans TRX sous la main : à vérifier au premier essai (puissance 14 0A en watts, son USB, port COM).
 * Le pilote expose la même interface que les autres pilotes (ic7300.js, ftdx101.js).
 */
(function (root) {
  'use strict';

  const ID = 'ic7760';
  const NAME = 'Icom IC-7760';
  const ADDR = 0xB2;
  const CTRL = 0xE0;
  const FREQ_MIN = 30000;
  const FREQ_MAX = 60000000;

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
  const frame = (bytes) => Uint8Array.from([0xFE, 0xFE, ADDR, CTRL].concat(bytes, [0xFD]));
  const q = (...b) => frame(b);
  // Commande pour un récepteur donné (29 00 = MAIN, 29 01 = SUB)
  const qs = (side, ...b) => frame([0x29, side ? 1 : 0].concat(b));

  // ------------------------------------------------------------ modes
  // Code de mode = octet CI-V en hexadécimal, suivi de « D » pour le mode DATA (USB-D… : DATA1 du TRX)
  const MODE_BYTES = { '00': 'LSB', '01': 'USB', '02': 'AM', '03': 'CW', '04': 'RTTY', '05': 'FM', '07': 'CW-R', '08': 'RTTY-R', '12': 'PSK', '13': 'PSK-R' };
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
  // PSK / PSK-R : lus et affichés, pas proposés (les modes numériques passent par USB-D et la carte son)
  const SETTABLE = MODE_KEYS.map((m) => m[0]);
  const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');

  // ------------------------------------------------------------ lectures
  // Réglages d'un récepteur (commande 29) : [commande, sous-commande, clé, type] (t = 0/1, l = niveau 0–255, b = octet)
  // La clé du SUB est la même suivie de « B » (smeterB, attB, preampB…)
  const SIDE = [
    [0x14, 0x01, 'af', 'l'], [0x14, 0x02, 'rf', 'l'], [0x14, 0x03, 'sql', 'l'], [0x14, 0x06, 'nrLvl', 'l'],
    [0x14, 0x07, 'pbtIn', 'l'], [0x14, 0x08, 'pbtOut', 'l'], [0x14, 0x0D, 'notchPos', 'l'], [0x14, 0x12, 'nbLvl', 'l'], [0x14, 0x13, 'dsShift', 'l'],
    [0x15, 0x02, 'smeter', 'l'],
    [0x16, 0x02, 'preamp', 'b'], [0x16, 0x12, 'agc', 'b'], [0x16, 0x22, 'nb', 't'], [0x16, 0x32, 'apf', 'b'], [0x16, 0x40, 'nr', 't'],
    [0x16, 0x41, 'dnf', 't'], [0x16, 0x48, 'notch', 't'], [0x16, 0x56, 'filShape', 'b'], [0x16, 0x4E, 'digiSel', 't'], [0x16, 0x57, 'notchW', 'b'], [0x16, 0x65, 'ipPlus', 't']
  ];
  // Réglages communs (sans 29)
  const COMMON = [
    [0x14, 0x0A, 'powerRaw', 'l'], [0x14, 0x0B, 'mic', 'l'], [0x14, 0x0E, 'procLvl', 'l'], [0x14, 0x09, 'cwPitchRaw', 'l'],
    [0x14, 0x0C, 'keySpeedRaw', 'l'], [0x14, 0x15, 'moniLvl', 'l'], [0x14, 0x16, 'voxGain', 'l'], [0x14, 0x17, 'antiVox', 'l'],
    [0x15, 0x11, 'm5', 'l'], [0x15, 0x12, 'm6', 'l'], [0x15, 0x13, 'm4', 'l'], [0x15, 0x14, 'm3', 'l'], [0x15, 0x15, 'm8', 'l'], [0x15, 0x16, 'm7', 'l'],
    [0x16, 0x44, 'proc', 't'], [0x16, 0x45, 'moni', 't'], [0x16, 0x46, 'vox', 't'], [0x16, 0x47, 'bkin', 'b'], [0x16, 0x50, 'lock', 't'],
    [0x16, 0x58, 'tbw', 'b'], [0x16, 0x5E, 'tracking', 't'], [0x16, 0x67, 'dpd', 't'], [0x21, 0x01, 'rit', 't'], [0x21, 0x02, 'xit', 't']
  ];
  const SIDE_MAP = {}, COMMON_MAP = {};
  for (const s of SIDE) SIDE_MAP[s[0] * 256 + s[1]] = s;
  for (const s of COMMON) COMMON_MAP[s[0] * 256 + s[1]] = s;

  // FAST : à chaque cycle. SLOW : une tranche par cycle. TXMETERS : en émission.
  const FAST = [q(0x25, 0x00), q(0x25, 0x01), qs(0, 0x15, 0x02), qs(1, 0x15, 0x02), q(0x1C, 0x00), q(0x07, 0xD2)];
  const TXMETERS = [q(0x15, 0x11), q(0x15, 0x12), q(0x15, 0x13), q(0x15, 0x14), q(0x14, 0x0A), q(0x16, 0x46)];
  // SPAN du scope en CENTER : ±2,5 kHz à ±500 kHz (27 15)
  const SC_SPANS = [2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000];
  const SLOW = [q(0x26, 0x00), q(0x26, 0x01), q(0x07, 0xC2), q(0x0F), q(0x14, 0x0A), q(0x21, 0x00), q(0x1C, 0x01)];
  for (const side of [0, 1]) {
    SLOW.push(qs(side, 0x11), qs(side, 0x12), qs(side, 0x1A, 0x03), qs(side, 0x1A, 0x04));
    for (const s of SIDE) if (s[0] !== 0x15) SLOW.push(qs(side, s[0], s[1]));
  }
  for (const s of COMMON) if (s[0] !== 0x15 && !(s[0] === 0x14 && s[1] === 0x0A)) SLOW.push(q(s[0], s[1]));
  SLOW.push(q(0x15, 0x15), q(0x15, 0x16));
  // Niveau de la tonalité locale CW (SET > CW-KEY Set > Side Tone Level : 1A 05 02 86, 0000 – 0255)
  const SIDETONE = [0x1A, 0x05, 0x02, 0x86];
  SLOW.push(q(...SIDETONE));
  // NB : DEPTH (1A 05 03 63 : 00 – 09 = 1 – 10) et WIDTH (1A 05 03 64 : 0000 – 0255 = 1 – 100), colonne NB de l'écran
  const NB_DEPTH = [0x1A, 0x05, 0x03, 0x63], NB_WIDTH = [0x1A, 0x05, 0x03, 0x64];
  SLOW.push(q(...NB_DEPTH), q(...NB_WIDTH));
  // Scope du TRX : MAIN/SUB, SINGLE/DUAL, et pour chaque côté CENTER/FIX, SPAN, EDGE, HOLD
  SLOW.push(q(0x27, 0x12), q(0x27, 0x13));
  for (const sd of [0, 1]) SLOW.push(q(0x27, 0x14, sd), q(0x27, 0x15, sd), q(0x27, 0x16, sd), q(0x27, 0x17, sd));
  // Bandeau du scope (vitesse, RBW, VBW) et REF de chaque scope
  for (const sd of [0, 1]) SLOW.push(q(0x27, 0x19, sd), q(0x27, 0x1A, sd), q(0x27, 0x1F, sd), q(0x27, 0x1D, sd));
  const SLOW_PER_TICK = 6;
  const POLL_MS = 250;
  const FRAME_GAP_MS = 15;
  // À l'ouverture du port : TX OFF (au cas où la radio serait restée en émission par CAT)
  const INIT = [q(0x1C, 0x00, 0x00)];

  const STATE_KEYS = ['vfoSel', 'dualRx', 'txVfo', 'split', 'rit', 'xit', 'clar', 'lock', 'tracking', 'dpd', 'tuner', 'tuning',
    'mic', 'proc', 'procLvl', 'vox', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'cwPitch', 'keySpeed', 'moniLvl', 'moni', 'bkin', 'voxGain', 'antiVox', 'tbw',
    'fil', 'filB', 'filWi', 'filWiB', 'filShape', 'filShapeB', 'agcT', 'agcTB', 'sideTone', 'nbDepth', 'nbWidth', 'att', 'attB', 'ant', 'antB', 'rxAnt', 'rxAntB'];
  for (const s of SIDE) if (s[2] !== 'smeter') STATE_KEYS.push(s[2], s[2] + 'B');
  STATE_KEYS.push('smeterB', 'scSel', 'scDual');

  // ------------------------------------------------------------ écran SET (1A 05 xx xx), comme sur le TRX
  // Arborescence : EX_TREE = dossiers (clé → [titre, [[clé, libellé]…]]), EX_MENUS = listes de réglages (clé → [titre, [[n°, libellé, type]…]]),
  // EX_PARENT = dossier du dessus (null : liste SET). Types : hl (HPF/LPF du RX), tone (−5 … +5), tbw6 (bords de la bande d'émission SSB)
  const EX_TREE = {
    tone: ['Tone Control/TBW', [['toneRx', 'RX'], ['toneTx', 'TX']]],
    // SET → Network : lecture seule, administrateurs seulement (réseau du club) ; Remote Settings pas à distance
    net: ['NETWORK (* Valid after Restart)', null],
    toneRx: ['RX', [['rxSsb', 'SSB'], ['rxAm', 'AM'], ['rxFm', 'FM'], ['rxCw', 'CW'], ['rxRtty', 'RTTY'], ['rxPsk', 'PSK']]],
    toneTx: ['TX', [['txSsb', 'SSB'], ['txSsbD', 'SSB-D'], ['txAm', 'AM'], ['txFm', 'FM']]]
  };
  const EX_MENUS = {
    rxSsb: ['SSB', [[1, 'RX HPF/LPF', 'hl', 'SSB RX HPF/LPF'], [2, 'RX Bass', 'tone'], [3, 'RX Treble', 'tone']]],
    rxAm: ['AM', [[4, 'RX HPF/LPF', 'hl', 'AM RX HPF/LPF'], [5, 'RX Bass', 'tone'], [6, 'RX Treble', 'tone']]],
    rxFm: ['FM', [[7, 'RX HPF/LPF', 'hl', 'FM RX HPF/LPF'], [8, 'RX Bass', 'tone'], [9, 'RX Treble', 'tone']]],
    rxCw: ['CW', [[10, 'RX HPF/LPF', 'hl', 'CW RX HPF/LPF']]],
    rxRtty: ['RTTY', [[11, 'RX HPF/LPF', 'hl', 'RTTY RX HPF/LPF']]],
    rxPsk: ['PSK', [[12, 'RX HPF/LPF', 'hl', 'PSK RX HPF/LPF']]],
    txSsb: ['SSB', [[13, 'TX Bass', 'tone'], [14, 'TX Treble', 'tone'], [15, 'TBW (WIDE)', 'tbw6'], [16, 'TBW (MID)', 'tbw6'], [17, 'TBW (NAR)', 'tbw6']]],
    txSsbD: ['SSB-D', [[18, 'TBW', 'tbw6']]],
    txAm: ['AM', [[19, 'TX Bass', 'tone'], [20, 'TX Treble', 'tone']]],
    txFm: ['FM', [[21, 'TX Bass', 'tone'], [22, 'TX Treble', 'tone']]],
    net: ['NETWORK (* Valid after Restart)', [[161, 'DHCP *', ['OFF', 'ON']], [162, 'IP Address (LAN) *', 'ip'], [164, 'IP Address (Controller) *', 'ip'], [165, 'IP Address (RF Deck) *', 'ip'],
      [166, 'Subnet Mask *', 'mask'], [167, 'Default Gateway *', 'ip'], [168, 'Primary DNS Server *', 'ip'], [169, 'Secondary DNS Server *', 'ip'],
      [170, 'Audio Buffer Size (via LAN) *', ['Small', 'Mid', 'Large']], [171, 'Connection from Different Segment *', ['OFF', 'ON']], [176, 'Network Name', 'name']]],
    // Network → Different Segment Settings (réglages en vigueur du bloc RF sur un autre segment) : lecture seule aussi
    netSeg: ['DIFFERENT SEGMENT SETTINGS (* Valid after Restart)', [[172, 'IP Address (RF Deck) *', 'ip'], [173, 'Subnet Mask (RF Deck) *', 'mask'], [174, 'Default Gateway (RF Deck) *', 'ip'], [175, 'Audio Buffer Size *', ['Small', 'Mid', 'Large']]]],
    // SET → Display (1A 05 01 84 … 01 99), dans l'ordre du TRX ; Filter Effect Screen = sous-dossier (01 92, 01 93)
    disp: ['DISPLAY', [[184, 'LCD Backlight', 'pct'], [185, 'LED Bright', 'pct'], [186, 'Display Font', ['Square', 'Round']], [187, 'Meter Response (Standard, Edgewise)', ['Slow', 'Mid', 'Fast']],
      [188, 'Meter Type (Normal Screen)', ['Standard', 'Edgewise', 'Bar']], [189, 'Meter Type (Expand Screen)', ['Edgewise', 'Bar']], [190, 'Meter Peak Hold (Bar)', ['OFF', 'ON']], [191, 'Memory Name', ['OFF', 'ON']],
      [194, 'Screen Saver', ['OFF', '15min', '30min', '60min']], [195, 'External Display', ['OFF', 'ON']], [196, 'External Display Resolution', ['800x480', '800x600']],
      [197, 'Opening Message', ['OFF', 'ON']], [198, 'My Call', 'name'], [199, 'Display Language', ['English', 'Japanese']]]],
    dispFx: ['FILTER EFFECT SCREEN', [[192, 'Waveform Type', ['Line', 'Fill']], [193, 'Waveform Color', 'rgb']]],
    // SCOPE SET (appui d'1 s sur EXPD/SET : 1A 05 02 08 … 02 23), dans l'ordre du TRX ; Fixed Edges (02 24 … 02 71) en sous-dossier
    scope: ['SCOPE SET', [[208, 'Scope during Tx (CENTER Type)', ['OFF', 'ON']], [209, 'Max Hold', ['OFF', '10s Hold', 'ON']],
      [210, 'CENTER Type Display', ['Filter center', 'Carrier point center', 'Carrier point center (Abs. Freq.)']], [211, 'Marker Position (Fix Type/SCROLL Type)', ['Filter center', 'Carrier point']],
      [212, 'Averaging', ['OFF', '2', '3', '4']], [213, 'Waveform Type', ['Fill', 'Fill+Line']], [214, 'Waveform Color (Current)', 'rgb'], [215, 'Waveform Color (Line)', 'rgb'], [216, 'Waveform Color (Max Hold)', 'rgb'],
      [217, 'Waterfall Display', ['OFF', 'ON']], [218, 'Waterfall Speed', ['Slow', 'Mid', 'Fast']], [219, 'Waterfall Size (Expand Screen)', ['Small', 'Mid', 'Large']],
      [220, 'Waterfall Peak Color Level', ['Grid 1', 'Grid 2', 'Grid 3', 'Grid 4', 'Grid 5', 'Grid 6', 'Grid 7', 'Grid 8', 'Grid 9', 'Grid 10']], [221, 'Waterfall Marker Auto-hide', ['OFF', 'ON']],
      [222, 'Dual Scope Type', ['Over/Under', 'Side by Side']], [223, 'Dual Scope Auto Select', ['OFF', 'ON']]]],
    edges: ['Fixed Edges', []],
    // MENU → ANTENNA (1A 05 03 44 … 03 62) : TYPE (connecteurs, lecture seule), ANTENNA MEMORY (antenne de chaque tranche de fréquences :
    // ANT 1 – 4 et RX-ANT), Temporary Memory (TEMP-M) et [ANT] Switch (Manual / Auto) ; écriture réservée aux administrateurs
    ant: ['ANTENNA', [[344, 'ANT2', ['OFF', 'ON']], [345, 'ANT3', ['OFF', 'ON']], [346, 'ANT4', ['OFF', 'ON']], [347, 'RX-ANT Connectors', ['RX-ANT', 'RX-I/O']],
      [348, 'External Antenna Tuner', ['ANT1', 'ANT2', 'ANT3', 'ANT4']],
      [349, '0.03 - 1.60', 'antm'], [350, '1.60 - 2.00', 'antm'], [351, '2.00 - 6.00', 'antm'], [352, '6.00 - 8.00', 'antm'], [353, '8.00 - 11.00', 'antm'], [354, '11.00 - 15.00', 'antm'],
      [355, '15.00 - 20.00', 'antm'], [356, '20.00 - 22.00', 'antm'], [357, '22.00 - 26.00', 'antm'], [358, '26.00 - 30.00', 'antm'], [359, '30.00 - 45.00', 'antm'], [360, '45.00 - 60.00', 'antm'],
      [361, 'Temporary Memory', ['OFF', 'ON']], [362, '[ANT] Switch', ['Manual', 'Auto']]]]
  };
  // Fixed Edges : 12 tranches × 4 bords (No.1 – No.4), 1A 05 02 24 + tranche × 4 + bord ; valeur « bas-haut » en kHz
  const EDGE_BANDS = [[30, 1600], [1600, 2000], [2000, 6000], [6000, 8000], [8000, 11000], [11000, 15000], [15000, 20000], [20000, 22000], [22000, 26000], [26000, 30000], [30000, 45000], [45000, 60000]];
  EDGE_BANDS.forEach(([lo, hi], i) => { for (let e = 0; e < 4; e++) EX_MENUS.edges[1].push([224 + i * 4 + e, (lo / 1000).toFixed(2) + '–' + (hi / 1000).toFixed(2) + ' MHz · No.' + (e + 1), 'edge']); });
  // Tranches de l'ANTENNA MEMORY (MHz) : 1A 05 03 49 + i
  const ANT_SEG = EX_MENUS.ant[1].filter((x) => x[2] === 'antm').map((x) => [x[0], ...x[1].split(' - ').map(Number)]);
  delete EX_TREE.net;
  const EX_PARENT = { tone: null, toneRx: 'tone', toneTx: 'tone', net: null, netSeg: 'net', ant: null, disp: null, dispFx: 'disp' };
  for (const k in EX_MENUS) if (EX_PARENT[k] === undefined && k !== 'scope' && k !== 'edges') EX_PARENT[k] = k.startsWith('rx') ? 'toneRx' : 'toneTx';
  const EX = {};
  for (const k in EX_MENUS) for (const it of EX_MENUS[k][1]) EX[it[0]] = { n: it[0], label: it[1], title: it[3] || (EX_MENUS[k][0] + ' ' + it[1]), type: Array.isArray(it[2]) ? 'list' : it[2], opts: Array.isArray(it[2]) ? it[2] : null, rw: !/^net/.test(k) && !(k === 'ant' && it[0] < 349) && ![198, 199].includes(it[0]), admin: /^net/.test(k), wAdmin: k === 'ant', menu: k };
  for (const n in EX) if (EX[n].type === 'edge') { const b = EDGE_BANDS[Math.floor((n - 224) / 4)]; EX[n].lo = b[0]; EX[n].hi = b[1]; }
  const edgeKHz = (b, o) => (b[o] >> 4) + unbcd(b[o + 1]) * 10 + unbcd(b[o + 2]) * 1000;
  const edgeBytes = (k) => [((k % 10) << 4), bcd(Math.floor(k / 10) % 100), bcd(Math.floor(k / 1000) % 100)];
  const TBW_LO = [100, 120, 150, 200, 300, 500], TBW_HI = [2500, 2700, 2800, 2900];
  const exFmt = (it, raw) => {
    if (raw == null || raw === '') return '—';
    const v = Number(raw), t = it.type;
    if (t === 'tone') return (v > 5 ? '+' : '') + (v - 5);
    if (t === 'hl') { const h = Math.floor(v / 100), l = v % 100; return (h ? h * 100 : '----') + ' - ' + (l >= 25 ? '----' : l * 100); }
    if (t === 'tbw6') { const lo = Math.floor(v / 10), hi = v % 10; return TBW_LO[lo] + ' - ' + TBW_HI[hi]; }
    if (t === 'pct') return Math.round(v / 255 * 100) + '%';
    if (t === 'edge') { const [a, b] = String(raw).split('-').map(Number); return (a / 1000).toFixed(3) + ' – ' + (b / 1000).toFixed(3) + ' MHz'; }
    if (t === 'rgb') { const [r2, g2, b2] = String(raw).split(','); return 'R:' + r2 + '  G:' + g2 + '  B:' + b2; }
    if (t === 'antm') return String(Math.floor(v / 10) + 1) + (v % 10 ? ' + RX' : ''); // ANT 1 – 4 (+ RX-ANT)
    if (t === 'list') return it.n === 161 && v ? 'ON (   .   .   .   )' : it.opts[v] != null ? it.opts[v] : String(raw);
    if (t === 'mask') { const b = []; for (let i = 0; i < 4; i++) b.push(256 - Math.pow(2, 8 - Math.max(0, Math.min(8, v - i * 8)))); return b.map((x) => x % 256).join('.') + ' (' + v + 'bit)'; }
    return String(raw); // ip, name : déjà en texte
  };
  function exOk(it, raw) {
    const v = Number(raw), t = it.type;
    if (!Number.isInteger(v)) return false;
    if (t === 'tone') return v >= 0 && v <= 10;
    if (t === 'hl') { const h = Math.floor(v / 100), l = v % 100; return h >= 0 && h <= 20 && l >= 5 && l <= 25 && (h === 0 || l === 25 || h * 100 < l * 100); }
    if (t === 'tbw6') return Math.floor(v / 10) <= 5 && v % 10 <= 3;
    if (t === 'antm') return v >= 0 && Math.floor(v / 10) <= 3 && v % 10 <= 1;
    if (t === 'pct') return v >= 0 && v <= 255;
    if (t === 'list') return v >= 0 && v < it.opts.length;
    return false;
  }
  function exBytes(it, raw) {
    const v = Number(raw), t = it.type;
    if (t === 'hl') return [bcd(Math.floor(v / 100)), bcd(v % 100)];
    if (t === 'tbw6') return [(Math.floor(v / 10) << 4) | (v % 10)];
    if (t === 'antm') return [bcd(Math.floor(v / 10)), bcd(v % 10)];
    if (t === 'pct') return lvlBytes(v);
    if (t === 'edge') { const [a, b] = String(raw).split('-').map(Number); return edgeBytes(a).concat(edgeBytes(b)); }
    if (t === 'rgb') return String(raw).split(',').map(Number).reduce((o, x) => o.concat(lvlBytes(x)), []);
    return [bcd(v)];
  }
  const exRaw = (it, v) => v % 100000;
  const exCode = (it, raw) => it.n * 100000 + Number(raw);
  const STR_KEYS = Object.keys(EX).map((n) => 'ex' + n);
  for (const k of ['scMode', 'scSpan', 'scEdge', 'scHold', 'scRef', 'scSpeed', 'scRbw', 'scVbw']) STATE_KEYS.push(k, k + 'B');

  // CW PITCH : 0–255 = 300–900 Hz (pas de 5 Hz) ; KEY SPEED : 0–255 = 6–48 mots/min
  const pitchHz = (raw) => Math.round((300 + raw * 600 / 255) / 5) * 5;
  const wpmOf = (raw) => Math.round(6 + raw * 42 / 255);
  // Puissance (14 0A : 0000 = minimum … 0255 = maximum) : 0–255 ↔ 0–200 W (à vérifier sur le TRX)
  const wattsOf = (raw) => Math.round(raw * 200 / 255);

  // Trame de lecture de chaque clé : relue juste après un réglage
  const READ_FOR = { power: q(0x14, 0x0A), split: q(0x0F), clar: q(0x21, 0x00), clarClr: q(0x21, 0x00), tuner: q(0x1C, 0x01), tx: q(0x1C, 0x00),
    cwPitch: q(0x14, 0x09), keySpeed: q(0x14, 0x0C), vfoSel: q(0x07, 0xD2), dualRx: q(0x07, 0xC2), swap: q(0x25, 0x01), aToB: q(0x25, 0x01),
    fil: q(0x26, 0x00), filB: q(0x26, 0x01), att: qs(0, 0x11), attB: qs(1, 0x11), ant: qs(0, 0x12), antB: qs(1, 0x12) };
  for (const s of SIDE) if (s[0] !== 0x15) { READ_FOR[s[2]] = qs(0, s[0], s[1]); READ_FOR[s[2] + 'B'] = qs(1, s[0], s[1]); }
  for (const s of COMMON) if (s[0] !== 0x15 && !/Raw$/.test(s[2])) READ_FOR[s[2]] = q(s[0], s[1]);
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
  // ATT du TRX : OFF, 3 à 45 dB par 3 dB (11 + valeur en BCD)
  const ATT = [[0, 'OFF']];
  for (let d = 3; d <= 45; d += 3) ATT.push([d, d + ' dB']);
  const GROUPS = [['vfo', 'VFO et SPLIT'], ['flt', 'Filtres et DSP'], ['rx', 'Réception'], ['tx', 'Émission']];
  const CONTROLS = [
    { id: 'split', g: 'vfo', label: 'SPLIT', type: 'toggle', write: (v) => q(0x0F, v ? 1 : 0) },
    // Côté sélectionné (07 D0 MAIN / 07 D1 SUB) : la molette, les touches et les commandes sans 29 agissent sur ce côté
    { id: 'vfoSel', g: 'vfo', label: 'VFO active', type: 'select', options: [[0, 'MAIN (A)'], [1, 'SUB (B)']], write: (v) => q(0x07, v ? 0xD1 : 0xD0) },
    { id: 'dualRx', g: 'vfo', label: 'DUAL WATCH', type: 'toggle', write: (v) => q(0x07, v ? 0xC1 : 0xC0) },
    { id: 'swap', g: 'vfo', label: 'A ⇄ B', type: 'action', write: () => q(0x07, 0xB0) },
    { id: 'aToB', g: 'vfo', label: 'A = B', type: 'action', write: () => q(0x07, 0xB1) }, // « Equalize Main and Sub bands »
    // XFC de la face avant : en SPLIT, MAIN et SUB échangés tant qu'on tient la touche (07 B0 à l'appui, 07 B0 au relâchement)
    { id: 'xfc', g: 'vfo', label: 'XFC', type: 'action', face: true, write: () => q(0x07, 0xB0) },
    // Écran SET : relit un réglage 1A 05 (sans rien changer) ; exSet : n° × 100000 + valeur brute, refusé hors du tableau EX
    { id: 'exRead', g: 'vfo', label: 'Lecture réglage SET', type: 'level', min: 1, max: 9999, step: 1, face: true,
      check: (v) => { if (!EX[v]) throw new Error('réglage inconnu'); }, write: (v) => q(0x1A, 0x05, bcd(Math.floor(v / 100)), bcd(v % 100)) },
    { id: 'exSet', g: 'vfo', label: 'Réglage SET', type: 'level', min: 100000, max: 999999999, step: 1, face: true,
      check: (v) => {
        const it = EX[Math.floor(v / 100000)];
        if (!it) throw new Error('réglage inconnu');
        if (!it.rw) throw new Error(it.label + ' : lecture seule à distance');
        if (!exOk(it, exRaw(it, v))) throw new Error(it.label + ' : valeur hors plage');
      },
      write: (v) => { const it = EX[Math.floor(v / 100000)]; return q(0x1A, 0x05, bcd(Math.floor(it.n / 100)), bcd(it.n % 100), ...exBytes(it, exRaw(it, v))); } },
    // SCOPE SET → Fixed Edges : n° × 1e10 + bas (kHz) × 1e5 + haut (kHz)
    { id: 'exEdge', g: 'vfo', label: 'Bord du scope FIX', type: 'level', min: 224e10, max: 271e10 + 9999999999, step: 1, face: true,
      check: (v) => {
        const it = EX[Math.floor(v / 1e10)], a = Math.floor(v / 1e5) % 1e5, b = v % 1e5;
        if (!it || it.type !== 'edge') throw new Error('bord inconnu');
        if (!(a >= it.lo && b <= it.hi && a < b)) throw new Error('bords : ' + it.lo / 1000 + ' à ' + it.hi / 1000 + ' MHz, bas < haut');
      },
      write: (v) => { const it = EX[Math.floor(v / 1e10)]; return q(0x1A, 0x05, bcd(Math.floor(it.n / 100)), bcd(it.n % 100), ...edgeBytes(Math.floor(v / 1e5) % 1e5), ...edgeBytes(v % 1e5)); } },
    // Couleurs (Waveform Color…) : n° × 1e9 + R × 1e6 + G × 1e3 + B (0 – 255 chacun, 3 × 2 octets BCD)
    { id: 'exRgb', g: 'vfo', label: 'Couleur SET', type: 'level', min: 1e9, max: 999999999999, step: 1, face: true,
      check: (v) => { const it = EX[Math.floor(v / 1e9)], c3 = [Math.floor(v / 1e6) % 1000, Math.floor(v / 1e3) % 1000, v % 1000]; if (!it || it.type !== 'rgb') throw new Error('couleur inconnue'); if (!it.rw) throw new Error(it.label + ' : lecture seule à distance'); if (c3.some((x) => x > 255)) throw new Error('R, G, B : 0 à 255'); },
      write: (v) => { const it = EX[Math.floor(v / 1e9)]; return q(0x1A, 0x05, bcd(Math.floor(it.n / 100)), bcd(it.n % 100), ...lvlBytes(Math.floor(v / 1e6) % 1000), ...lvlBytes(Math.floor(v / 1e3) % 1000), ...lvlBytes(v % 1000)); } },
    { id: 'rit', g: 'vfo', label: 'RIT', type: 'toggle', write: setOn(0x21, 0x01) },
    { id: 'xit', g: 'vfo', label: 'XIT', type: 'toggle', write: setOn(0x21, 0x02) },
    {
      id: 'clar', g: 'vfo', label: 'Décalage RIT/XIT', type: 'level', min: -9999, max: 9999, step: 10, unit: 'Hz',
      write: (v) => { const a = Math.abs(v); return q(0x21, 0x00, bcd(a % 100), bcd(Math.floor(a / 100)), v < 0 ? 1 : 0); }
    },
    { id: 'clarClr', g: 'vfo', label: 'CLEAR (décalage RIT/XIT à zéro)', type: 'action', write: () => q(0x21, 0x00, 0, 0, 0) },
    { id: 'lock', g: 'vfo', label: 'LOCK (face avant du club)', type: 'toggle', write: setOn(0x16, 0x50) },
    { id: 'tracking', g: 'vfo', label: 'TRACKING MAIN/SUB', type: 'toggle', face: true, write: setOn(0x16, 0x5E) },
    // DPD (prédistorsion numérique de l'émetteur, 16 67) : touche DPD de l'écran FUNCTION
    { id: 'dpd', g: 'tx', label: 'DPD', type: 'toggle', face: true, write: setOn(0x16, 0x67) },
    { id: 'tuner', g: 'tx', label: 'Tuner', type: 'toggle', write: (v) => q(0x1C, 0x01, v ? 1 : 0) },
    { id: 'tune', g: 'tx', label: 'TUNE', type: 'action', transmits: true, write: () => q(0x1C, 0x01, 0x02) },
    { id: 'mic', g: 'tx', label: 'Gain micro', type: 'level', min: 0, max: 255, step: 1, pct: true, write: setLvl(0x14, 0x0B) },
    { id: 'proc', g: 'tx', label: 'COMP', type: 'toggle', write: setOn(0x16, 0x44) },
    { id: 'procLvl', g: 'tx', label: 'Niveau COMP', type: 'level', min: 0, max: 255, step: 1, pct: true, write: setLvl(0x14, 0x0E) },
    // VOX : on peut le couper à distance, jamais l'activer
    { id: 'vox', g: 'tx', label: 'VOX', type: 'toggle', offOnly: true, write: setOn(0x16, 0x46) },
    { id: 'keySpeed', g: 'tx', label: 'KEY SPEED', type: 'level', min: 6, max: 48, step: 1, unit: 'wpm', face: true, write: (v) => q(0x14, 0x0C, ...lvlBytes(Math.round((v - 6) * 255 / 42))) },
    { id: 'cwPitch', g: 'tx', label: 'CW PITCH', type: 'level', min: 300, max: 900, step: 5, unit: 'Hz', face: true, write: (v) => q(0x14, 0x09, ...lvlBytes(Math.round((v - 300) * 255 / 600))) },
    { id: 'moni', g: 'tx', label: 'MONITOR', type: 'toggle', face: true, write: setOn(0x16, 0x45) },
    { id: 'sideTone', g: 'tx', label: 'Niveau SIDETONE (CW)', type: 'level', min: 0, max: 255, step: 1, pct: true, face: true, write: (v) => q(...SIDETONE, ...lvlBytes(v)) },
    { id: 'nbDepth', g: 'flt', label: 'NB DEPTH', type: 'level', min: 0, max: 9, step: 1, face: true, write: (v) => q(...NB_DEPTH, bcd(v)) },
    { id: 'nbWidth', g: 'flt', label: 'NB WIDTH', type: 'level', min: 0, max: 255, step: 1, face: true, write: (v) => q(...NB_WIDTH, ...lvlBytes(v)) },
    { id: 'moniLvl', g: 'tx', label: 'Niveau MONITOR', type: 'level', min: 0, max: 255, step: 1, pct: true, face: true, write: setLvl(0x14, 0x15) },
    { id: 'bkin', g: 'tx', label: 'BK-IN', type: 'select', face: true, options: [[0, 'OFF'], [1, 'SEMI'], [2, 'FULL']], write: (v) => q(0x16, 0x47, v) },
    { id: 'voxGain', g: 'tx', label: 'VOX GAIN', type: 'level', min: 0, max: 255, step: 1, pct: true, face: true, write: setLvl(0x14, 0x16) },
    { id: 'antiVox', g: 'tx', label: 'ANTI VOX', type: 'level', min: 0, max: 255, step: 1, pct: true, face: true, write: setLvl(0x14, 0x17) },
    { id: 'tbw', g: 'tx', label: 'TBW', type: 'select', face: true, options: [[0, 'WIDE'], [1, 'MID'], [2, 'NAR']], write: (v) => q(0x16, 0x58, v) }
  ];
  // Réglages de chaque récepteur : MAIN (id) et SUB (id + « B »), par la commande 29
  const SIDE_CONTROLS = [
    { id: 'fil', g: 'flt', sec: 'filter', label: 'FILTRE', type: 'select', options: [[1, 'FIL1'], [2, 'FIL2'], [3, 'FIL3']],
      write: (v, s, b) => q(0x26, b ? 0x01 : 0x00, ...modeBytes((s && s['modeCode' + (b ? 'B' : '')]) || '01'), v), when: (s, b) => !!(s && s['modeCode' + (b ? 'B' : '')]) },
    { id: 'pbtIn', g: 'flt', sec: 'filter', label: 'PBT intérieur', type: 'level', min: 0, max: 255, step: 1, fmt: pbtFmt, cmd: [0x14, 0x07] },
    { id: 'pbtOut', g: 'flt', sec: 'filter', label: 'PBT extérieur', type: 'level', min: 0, max: 255, step: 1, fmt: pbtFmt, cmd: [0x14, 0x08] },
    { id: 'nb', g: 'flt', label: 'NB', type: 'toggle', cmd: [0x16, 0x22] },
    { id: 'nbLvl', g: 'flt', sec: 'dsp', label: 'Niveau NB', type: 'level', min: 0, max: 255, step: 1, pct: true, cmd: [0x14, 0x12] },
    { id: 'nr', g: 'flt', label: 'NR', badge: 'NR', type: 'toggle', cmd: [0x16, 0x40] },
    { id: 'nrLvl', g: 'flt', sec: 'dsp', label: 'Niveau NR', type: 'level', min: 0, max: 255, step: 1, pct: true, cmd: [0x14, 0x06] },
    { id: 'notch', g: 'flt', label: 'NOTCH manuel', badge: 'MN', type: 'toggle', cmd: [0x16, 0x48] },
    { id: 'notchPos', g: 'flt', sec: 'dsp', label: 'Position NOTCH', type: 'level', min: 0, max: 255, step: 1, cmd: [0x14, 0x0D] },
    { id: 'notchW', g: 'flt', label: 'Largeur NOTCH', type: 'select', face: true, options: [[0, 'WIDE'], [1, 'MID'], [2, 'NAR']], cmd: [0x16, 0x57], byte: true },
    { id: 'dnf', g: 'flt', label: 'AUTO NOTCH', badge: 'AN', type: 'toggle', cmd: [0x16, 0x41] },
    // Forme du filtre DSP (16 56 : SHARP / SOFT)
    { id: 'filShape', g: 'flt', label: 'Forme du filtre', type: 'select', face: true, options: [[0, 'SHARP'], [1, 'SOFT']], cmd: [0x16, 0x56], byte: true },
    { id: 'apf', g: 'flt', label: 'APF', type: 'select', face: true, options: [[0, 'OFF'], [1, 'WIDE'], [2, 'MID'], [3, 'NAR']], cmd: [0x16, 0x32], byte: true },
    { id: 'af', g: 'rx', label: 'AF', type: 'level', min: 0, max: 255, step: 1, pct: true, cmd: [0x14, 0x01] },
    { id: 'rf', g: 'rx', label: 'RF', type: 'level', min: 0, max: 255, step: 1, pct: true, cmd: [0x14, 0x02] },
    { id: 'sql', g: 'rx', label: 'Squelch', type: 'level', min: 0, max: 255, step: 1, pct: true, cmd: [0x14, 0x03] },
    { id: 'agc', g: 'rx', label: 'AGC', type: 'select', options: [[1, 'FAST'], [2, 'MID'], [3, 'SLOW']], cmd: [0x16, 0x12], byte: true },
    { id: 'preamp', g: 'rx', label: 'Préampli', type: 'select', options: [[0, 'PRE OFF'], [1, 'P.AMP1'], [2, 'P.AMP2']], cmd: [0x16, 0x02], byte: true },
    { id: 'att', g: 'rx', label: 'ATT', type: 'select', options: ATT, write: (v, s, b) => qs(b, 0x11, bcd(v)) },
    // Antenne ANT1 – ANT4 (12 0n + RX ANT gardé comme il est)
    { id: 'ant', g: 'rx', label: 'Antenne', type: 'select', noTx: true, options: [[1, 'ANT 1'], [2, 'ANT 2'], [3, 'ANT 3'], [4, 'ANT 4']],
      write: (v, s, b) => qs(b, 0x12, v - 1, (s && s['rxAnt' + (b ? 'B' : '')]) ? 1 : 0) },
    // RX ANT de l'antenne choisie (12 0n 01) ; refusé par le TRX si le type d'antenne ne le permet pas (RX-I/O)
    { id: 'rxAnt', g: 'rx', label: 'RX ANT', type: 'toggle', noTx: true, face: true,
      write: (v, s, b) => qs(b, 0x12, Math.max(0, ((s && s['ant' + (b ? 'B' : '')]) || 1) - 1), v ? 1 : 0) },
    // Largeur du filtre en service (1A 03 : SSB / CW / PSK 0 – 40, RTTY 0 – 31, AM 0 – 49 ; pas en FM)
    { id: 'filWi', g: 'flt', label: 'Largeur du filtre', type: 'select', face: true, options: Array.from({ length: 50 }, (_, i) => [i, String(i)]),
      write: (v, s, b) => qs(b, 0x1A, 0x03, bcd(v)), when: (s, b) => !/^FM/.test((s && s['mode' + (b ? 'B' : '')]) || '') },
    { id: 'digiSel', g: 'rx', label: 'DIGI-SEL', type: 'toggle', face: true, cmd: [0x16, 0x4E] },
    // Accord du DIGI-SEL (14 13 : 0000 – 0255), réglé au bouton MULTI dans la colonne MULTI
    { id: 'dsShift', g: 'rx', label: 'DIGI-SEL (accord)', type: 'level', min: 0, max: 255, step: 1, face: true, cmd: [0x14, 0x13] },
    // Constante de temps de l'AGC (1A 04) : celle du mode et du FAST / MID / SLOW en cours (appui long sur AGC) ; pas en FM (fixe)
    { id: 'agcT', g: 'rx', label: 'Constante de temps AGC', type: 'select', face: true, options: Array.from({ length: 14 }, (_, i) => [i, i ? String(i) : 'OFF']),
      write: (v, s, b) => qs(b, 0x1A, 0x04, bcd(v)), when: (s, b) => !/^FM/.test((s && s['mode' + (b ? 'B' : '')]) || '') },
    { id: 'ipPlus', g: 'rx', label: 'IP+', type: 'toggle', face: true, cmd: [0x16, 0x65] }
  ];
  for (const sc of SIDE_CONTROLS) {
    for (const b of [0, 1]) {
      const c = Object.assign({}, sc, { id: sc.id + (b ? 'B' : ''), label: sc.label + (b ? ' (VFO B)' : '') });
      delete c.cmd; delete c.byte;
      if (sc.write) c.write = (v, s) => sc.write(v, s, b);
      else if (sc.type === 'level') c.write = (v) => qs(b, sc.cmd[0], sc.cmd[1], ...lvlBytes(v));
      else if (sc.byte) c.write = (v) => qs(b, sc.cmd[0], sc.cmd[1], v);
      else c.write = (v) => qs(b, sc.cmd[0], sc.cmd[1], v ? 1 : 0);
      if (sc.when) c.when = (s) => sc.when(s, b);
      CONTROLS.push(c);
    }
  }
  // Scope du TRX (touches de l'écran) : MAIN/SUB et DUAL, puis CENTER/FIX, SPAN, EDGE, HOLD de chaque scope
  CONTROLS.push(
    { id: 'scSel', g: 'rx', label: 'Scope MAIN / SUB', type: 'select', face: true, options: [[0, 'MAIN'], [1, 'SUB']], write: (v) => q(0x27, 0x12, v) },
    { id: 'scDual', g: 'rx', label: 'Scope SINGLE / DUAL', type: 'toggle', face: true, write: (v) => q(0x27, 0x13, v ? 1 : 0) });
  for (const b of [0, 1]) {
    const x = b ? 'B' : '', n = b ? ' (SUB)' : '';
    CONTROLS.push(
      { id: 'scMode' + x, g: 'rx', label: 'CENTER / FIX du scope' + n, type: 'select', face: true, options: [[0, 'CENTER'], [1, 'FIX'], [2, 'SCROLL-C'], [3, 'SCROLL-F']], write: (v) => q(0x27, 0x14, b, v) },
      { id: 'scSpan' + x, g: 'rx', label: 'SPAN du scope' + n, type: 'select', face: true, options: SC_SPANS.map((h, i) => [i, '±' + (h >= 1000 ? h / 1000 + 'k' : h)]), write: (v) => q(0x27, 0x15, b, ...freqBytes(SC_SPANS[v])) },
      { id: 'scEdge' + x, g: 'rx', label: 'EDGE du scope' + n, type: 'select', face: true, options: [[1, 'EDGE1'], [2, 'EDGE2'], [3, 'EDGE3'], [4, 'EDGE4']], write: (v) => q(0x27, 0x16, b, v) },
      { id: 'scHold' + x, g: 'rx', label: 'HOLD du scope' + n, type: 'toggle', face: true, write: (v) => q(0x27, 0x17, b, v ? 1 : 0) },
      // <MENU2> : REF (27 19 : −30 … +10 dB par 0,5 dB ; valeur × 10), SPEED (27 1A), RBW (27 1F), VBW (27 1D)
      { id: 'scRef' + x, g: 'rx', label: 'REF du scope' + n, type: 'level', min: -300, max: 100, step: 5, face: true,
        write: (v) => { const a = Math.abs(v); return q(0x27, 0x19, b, bcd(Math.floor(a / 10)), bcd((a % 10) * 10), v < 0 ? 1 : 0); } },
      { id: 'scSpeed' + x, g: 'rx', label: 'SPEED du scope' + n, type: 'select', face: true, options: [[0, 'FAST'], [1, 'MID'], [2, 'SLOW']], write: (v) => q(0x27, 0x1A, b, v) },
      { id: 'scRbw' + x, g: 'rx', label: 'RBW du scope' + n, type: 'select', face: true, options: [[0, 'WIDE'], [1, 'MID'], [2, 'NAR']], write: (v) => q(0x27, 0x1F, b, v) },
      { id: 'scVbw' + x, g: 'rx', label: 'VBW du scope' + n, type: 'select', face: true, options: [[0, 'NARROW'], [1, 'WIDE']], write: (v) => q(0x27, 0x1D, b, v) });
    READ_FOR['scRef' + x] = q(0x27, 0x19, b); READ_FOR['scSpeed' + x] = q(0x27, 0x1A, b); READ_FOR['scRbw' + x] = q(0x27, 0x1F, b); READ_FOR['scVbw' + x] = q(0x27, 0x1D, b);
    READ_FOR['scMode' + x] = q(0x27, 0x14, b); READ_FOR['scSpan' + x] = q(0x27, 0x15, b); READ_FOR['scEdge' + x] = q(0x27, 0x16, b); READ_FOR['scHold' + x] = q(0x27, 0x17, b);
  }
  for (const n in EX) READ_FOR['ex' + n] = q(0x1A, 0x05, bcd(Math.floor(n / 100)), bcd(n % 100));
  READ_FOR.sideTone = q(...SIDETONE); READ_FOR.nbDepth = q(...NB_DEPTH); READ_FOR.nbWidth = q(...NB_WIDTH); READ_FOR.filWi = qs(0, 0x1A, 0x03); READ_FOR.filWiB = qs(1, 0x1A, 0x03); READ_FOR.rxAnt = qs(0, 0x12); READ_FOR.rxAntB = qs(1, 0x12); READ_FOR.agcT = qs(0, 0x1A, 0x04); READ_FOR.agcTB = qs(1, 0x1A, 0x04);
  READ_FOR.scSel = q(0x27, 0x12); READ_FOR.scDual = q(0x27, 0x13);
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
  const POWER_RANGE = { I: [5, 200] };
  const POWER_STEP = { I: 5 };
  function cmdPower(watts) {
    const w = Math.round(Number(watts));
    if (!(w >= POWER_RANGE.I[0] && w <= POWER_RANGE.I[1])) throw new Error('puissance hors plage (5–200 W)');
    return q(0x14, 0x0A, ...lvlBytes(Math.round(w * 255 / 200)));
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
        while (p < this.acc.length && this.acc[p] === 0xFE) p++;
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
    const code = m + (b[o + 1] >= 1 && b[o + 1] <= 3 && DATA_OK.indexOf(m) >= 0 ? 'D' : '');
    return { code, name: MODES[code], fil: b[o + 2] };
  }

  // Contenu d'une trame (sans 29) → état
  function parseBody(c, d) {
    if (c === 0xFB) return { ok: true };
    if (c === 0xFA) return { error: true };
    // Scope du TRX (27 00) : MAIN seulement (d[1] = 00) ; division 1 = mode + 2 fréquences + hors plage, puis morceaux de la courbe
    if (c === 0x27 && d[0] === 0x00 && d.length >= 4) {
      // d[1] : 00 = scope du MAIN, 01 = scope du SUB (en DUAL, le TRX envoie les deux, l'un après l'autre)
      const sd = d[1] ? 1 : 0, div = unbcd(d[2]), max = unbcd(d[3]);
      if (div === 1) return d.length >= 15 ? { _scope: { s: sd, div, max, mode: d[4], f0: freqValue(d, 5), f1: freqValue(d, 10), oor: d[15] ? 1 : 0 } } : { ok: true };
      return { _scope: { s: sd, div, max, data: d.slice(4) } };
    }
    // Réglages du scope du TRX (27 12 MAIN/SUB, 27 13 SINGLE/DUAL, 27 14 CENTER/FIX, 27 15 SPAN, 27 16 EDGE, 27 17 HOLD)
    if (c === 0x27 && d[0] === 0x12 && d.length >= 2) return { scSel: d[1] ? 1 : 0 };
    if (c === 0x27 && d[0] === 0x13 && d.length >= 2) return { scDual: d[1] ? 1 : 0 };
    if (c === 0x27 && d[0] === 0x19 && d.length >= 5) return { ['scRef' + (d[1] ? 'B' : '')]: (unbcd(d[2]) * 10 + Math.floor(unbcd(d[3]) / 10)) * (d[4] ? -1 : 1) };
    if (c === 0x27 && (d[0] === 0x1A || d[0] === 0x1F || d[0] === 0x1D) && d.length >= 3) return { [{ 0x1A: 'scSpeed', 0x1F: 'scRbw', 0x1D: 'scVbw' }[d[0]] + (d[1] ? 'B' : '')]: d[2] };
    if (c === 0x27 && d[0] >= 0x14 && d[0] <= 0x17 && d.length >= 3) {
      const b = d[1] ? 'B' : '';
      if (d[0] === 0x14) return { ['scMode' + b]: d[2] <= 3 ? d[2] : 0 };
      if (d[0] === 0x15) { const i = SC_SPANS.indexOf(freqValue(d, 2)); return i >= 0 ? { ['scSpan' + b]: i } : { ok: true }; }
      if (d[0] === 0x16) return d[2] >= 1 && d[2] <= 4 ? { ['scEdge' + b]: d[2] } : { ok: true };
      return { ['scHold' + b]: d[2] ? 1 : 0 };
    }
    if (c === 0x1A && d[0] === 0x03 && d.length >= 2) return { filWi: unbcd(d[1]) };
    // 1A 04 : constante de temps de l'AGC choisie (mode et FAST/MID/SLOW en cours) : 00 OFF, 01 – 13 (tableau p. 19 du guide CI-V)
    if (c === 0x1A && d[0] === 0x04 && d.length >= 2) return { agcT: unbcd(d[1]) };
    if (c === 0x1A && d[0] === 0x05 && d[1] === 0x02 && d[2] === 0x86 && d.length >= 5) return { sideTone: lvlValue(d, 3) };
    if (c === 0x1A && d[0] === 0x05 && d[1] === 0x03 && d[2] === 0x63 && d.length >= 4) return { nbDepth: unbcd(d[3]) };
    if (c === 0x1A && d[0] === 0x05 && d[1] === 0x03 && d[2] === 0x64 && d.length >= 5) return { nbWidth: lvlValue(d, 3) };
    if (c === 0x1A && d[0] === 0x05 && d.length >= 4 && EX[unbcd(d[1]) * 100 + unbcd(d[2])]) {
      const n = unbcd(d[1]) * 100 + unbcd(d[2]), it = EX[n], b = d.slice(3);
      // IP : 4 octets de 2 octets BCD (centaines, dizaines-unités) ; nom : texte (16 caractères au plus)
      const raw = it.type === 'hl' || it.type === 'antm' ? (b.length >= 2 ? unbcd(b[0]) * (it.type === 'antm' ? 10 : 100) + unbcd(b[1]) : null) : it.type === 'tbw6' ? (b[0] >> 4) * 10 + (b[0] & 0x0F)
        : it.type === 'ip' ? (b.length >= 8 ? [0, 2, 4, 6].map((o) => unbcd(b[o]) * 100 + unbcd(b[o + 1])).join('.') : null)
        : it.type === 'name' ? String.fromCharCode(...b.filter((x) => x >= 0x20 && x < 0x7F)).trim()
        : it.type === 'edge' ? (b.length >= 6 ? edgeKHz(b, 0) + '-' + edgeKHz(b, 3) : null)
        : it.type === 'pct' ? (b.length >= 2 ? lvlValue(b, 0) : null) : it.type === 'rgb' ? (b.length >= 6 ? [lvlValue(b, 0), lvlValue(b, 2), lvlValue(b, 4)].join(',') : null) : unbcd(b[0]);
      return raw == null ? { ok: true } : { ['ex' + n]: String(raw) };
    }
    if (c === 0x1A) return { ok: true };
    if (c === 0x00 && d.length >= 5) return { ok: true }; // transceive : relu par 25 00 / 25 01
    if (c === 0x01) return { ok: true };
    if (c === 0x25 && d.length >= 6) return d[0] === 0 ? { freq: freqValue(d, 1) } : { freqB: freqValue(d, 1) };
    if (c === 0x26 && d.length >= 4) {
      const m = parseMode(d, 1);
      return d[0] === 0 ? { modeCode: m.code, mode: m.name, fil: m.fil } : { modeCodeB: m.code, modeB: m.name, filB: m.fil };
    }
    if (c === 0x07 && d[0] === 0xD2 && d.length >= 2) return { vfoSel: d[1] ? 1 : 0 };
    if (c === 0x07 && d[0] === 0xC2 && d.length >= 2) return { dualRx: d[1] ? 1 : 0 };
    if (c === 0x07) return { ok: true };
    if (c === 0x0F && d.length >= 1) { const s = d[0] === 1 ? 1 : 0; return { split: s, txVfo: s }; }
    if (c === 0x11 && d.length >= 1) return { att: unbcd(d[0]) };
    if (c === 0x12 && d.length >= 2 && d[0] <= 3) return { ant: d[0] + 1, rxAnt: d[1] ? 1 : 0 };
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
      const s = SIDE_MAP[c * 256 + d[0]] || COMMON_MAP[c * 256 + d[0]];
      if (s) {
        if (s[3] === 'l' && d.length >= 3) {
          const v = lvlValue(d, 1);
          if (s[2] === 'powerRaw') return { powerHead: 'I', power: wattsOf(v) };
          if (s[2] === 'cwPitchRaw') return { cwPitch: pitchHz(v) };
          if (s[2] === 'keySpeedRaw') return { keySpeed: wpmOf(v) };
          return { [s[2]]: v };
        }
        if (s[3] === 't' && d.length >= 2) return { [s[2]]: d[1] ? 1 : 0 };
        if (s[3] === 'b' && d.length >= 2) return { [s[2]]: d[1] };
      }
    }
    return { ok: true }; // trame valide de la radio mais non utilisée
  }

  function parse(f) {
    if (!f || f.length < 3) return null;
    const to = f[0], from = f[1], c = f[2];
    if (from !== ADDR || (to !== CTRL && to !== 0x00)) return null; // écho de nos propres trames, autre appareil…
    const d = f.slice(3);
    // Réponse pour un récepteur donné (29 00 / 29 01 + commande) : clés du SUB suivies de « B »
    if (c === 0x29 && d.length >= 2) {
      const p = parseBody(d[1], d.slice(2));
      if (!p || p.ok || p.error || p._scope || d[0] !== 1) return p;
      const o = {};
      for (const k in p) o[k + 'B'] = p[k];
      return o;
    }
    return parseBody(c, d);
  }

  // ------------------------------------------------------------ étalonnages (guide CI-V, commande 15)
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
  const vdValue = (raw) => interp([[0, 0], [151, 44], [211, 52], [255, 58]], raw);
  const idValue = (raw) => interp([[0, 0], [77, 5], [165, 10], [241, 15], [255, 16]], raw);
  const poFrac = (raw) => (raw == null ? null : Math.min(1, raw / 212)); // 0212 = 200 W
  // Largeur du filtre en service (1A 03 : n° 0 – 49) en Hz selon le mode
  function filHz(mode, i) {
    if (i == null) return null;
    if (/^AM/.test(mode || '')) return 200 + i * 200;
    return i <= 9 ? 50 + i * 50 : 600 + (i - 10) * 100;
  }
  const kTxt = (hz) => (hz >= 1000 ? (hz / 1000).toFixed(1) + 'k' : String(hz));
  function bwText(r) {
    if (!r.fil) return '—';
    const hz = /FM/.test(r.mode || '') ? null : filHz(r.mode, r.filWi);
    return 'FIL' + r.fil + (hz ? ' ' + kTxt(hz) : '');
  }

  // ------------------------------------------------------------ simulateur
  class Fake {
    constructor() {
      this.v = { freq: 14250000, freqB: 7074000, mode: [0x01, 0, 1], modeB: [0x01, 1, 2], tx: 0, split: 0, power: 128, clar: 0, tuner: 0, sel: 0, dual: 1 };
      this.side = [{}, {}]; // réglages de chaque récepteur, par clé commande*256+sous-commande
      for (const b of [0, 1]) {
        for (const s of SIDE) this.side[b][s[0] * 256 + s[1]] = s[3] === 'l' ? 128 : s[2] === 'agc' ? 2 : 0;
        this.side[b][0x1402] = 255; this.side[b][0x1403] = 0; this.side[b].att = 0; this.side[b].ant = [0, 0];
      }
      this.lv = {};
      for (const s of COMMON) this.lv[s[0] * 256 + s[1]] = s[3] === 'l' ? 128 : 0;
      this.lv[0x1515] = 200; // ≈ 49 V
      this.sp = new Splitter();
      this.onData = null;
      this.t = 0;
    }
    write(data) {
      const out = [];
      for (const f of this.sp.push(data)) {
        if (f[0] !== ADDR || f[1] !== CTRL) continue;
        let c = f[2], d = f.slice(3), pre = [], b = this.v.sel;
        if (c === 0x29 && d.length >= 2) { b = d[0] ? 1 : 0; pre = [0x29, b]; c = d[1]; d = d.slice(2); }
        this.cmd(c, d, b, pre, out);
      }
      this.flush(out);
    }
    cmd(c, d, b, pre, out) {
      const v = this.v, S = this.side[b];
      const ok = () => out.push([CTRL, ADDR, 0xFB]);
      const ng = () => out.push([CTRL, ADDR, 0xFA]);
      const r = (...x) => out.push([CTRL, ADDR].concat(pre, [c], x));
      if (c === 0x25) {
        const k = d[0] === 0 ? 'freq' : 'freqB';
        if (d.length === 1) r(d[0], ...freqBytes(v[k])); else { v[k] = freqValue(d, 1); ok(); }
      } else if (c === 0x26) {
        const k = d[0] === 0 ? 'mode' : 'modeB';
        if (d.length === 1) r(d[0], ...v[k]);
        else if (MODE_BYTES[hex2(d[1])]) { v[k] = [d[1], d[2] || 0, d[3] || 1]; ok(); } else ng();
      } else if (c === 0x07) {
        if (d[0] === 0xD2 && d.length === 1) r(0xD2, v.sel);
        else if (d[0] === 0xC2 && d.length === 1) r(0xC2, v.dual);
        else if (d[0] === 0xD0 || d[0] === 0xD1) { v.sel = d[0] & 1; ok(); }
        else if (d[0] === 0xC0 || d[0] === 0xC1) { v.dual = d[0] & 1; ok(); }
        else if (d[0] === 0xB0) { [v.freq, v.freqB, v.mode, v.modeB] = [v.freqB, v.freq, v.modeB, v.mode]; ok(); }
        else if (d[0] === 0xB1) { v.freqB = v.freq; v.modeB = v.mode.slice(); ok(); }
        else ng();
      } else if (c === 0x0F) {
        if (!d.length) r(v.split); else { v.split = d[0] ? 1 : 0; ok(); }
      } else if (c === 0x11) {
        if (!d.length) r(bcd(S.att)); else { S.att = unbcd(d[0]); ok(); }
      } else if (c === 0x12) {
        if (!d.length) r(...S.ant); else { S.ant = [d[0], d[1] || 0]; ok(); }
      } else if (c === 0x1C && d[0] === 0x00) {
        if (d.length === 1) r(0x00, v.tx); else { v.tx = d[1] ? 1 : 0; ok(); }
      } else if (c === 0x1C && d[0] === 0x01) {
        if (d.length === 1) r(0x01, v.tuner); else { v.tuner = d[1]; ok(); }
      } else if (c === 0x21 && d[0] === 0x00) {
        const a = Math.abs(v.clar);
        if (d.length === 1) r(0x00, bcd(a % 100), bcd(Math.floor(a / 100)), v.clar < 0 ? 1 : 0);
        else { v.clar = (unbcd(d[1]) + unbcd(d[2]) * 100) * (d[3] ? -1 : 1); ok(); }
      } else if (c === 0x15) {
        let val = this.lv[c * 256 + d[0]] || 0;
        if (d[0] === 0x02) {
          this.t += 0.15;
          const on = b === 0 || v.dual;
          val = v.tx || !on ? 0 : Math.max(0, Math.min(241, Math.round((b ? 50 : 70) + 50 * Math.sin(this.t + b) + 20 * Math.random())));
        } else if (d[0] === 0x11) val = v.tx ? Math.round((v.power / 255) * 212) : 0;
        else if (d[0] === 0x12) val = v.tx ? 30 : 0;
        else if (d[0] === 0x13) val = v.tx ? 40 : 0;
        else if (d[0] === 0x14) val = v.tx ? 15 : 0;
        else if (d[0] === 0x16) val = v.tx ? Math.round((v.power / 255) * 200) : 5;
        r(d[0], ...lvlBytes(val));
      } else if (c === 0x17) {
        if (d[0] === 0xFF) { clearTimeout(this.cwPlay); v.tx = 0; ok(); }
        else {
          const ms = Math.round(d.length * 10 * 1200 / (this.cwWpm || 22));
          setTimeout(() => { v.tx = 1; }, 150);
          clearTimeout(this.cwPlay);
          this.cwPlay = setTimeout(() => { v.tx = 0; }, 150 + ms);
          ok();
        }
      } else if (c === 0x27 && (d[0] === 0x10 || d[0] === 0x11)) {
        if (d.length >= 2 && d[0] === 0x11) { clearInterval(this.scT); if (d[1]) this.scT = setInterval(() => this.scopeOut(), 100); }
        ok();
      } else if (c === 0x27 && (d[0] === 0x12 || d[0] === 0x13)) {
        const k = d[0] === 0x12 ? 'scSel' : 'scDual';
        if (this[k] == null) this[k] = d[0] === 0x13 ? 1 : 0;
        if (d.length === 1) r(d[0], this[k]); else { this[k] = d[1] ? 1 : 0; ok(); }
      } else if (c === 0x27 && (d[0] === 0x19 || d[0] === 0x1A || d[0] === 0x1F || d[0] === 0x1D) && d.length >= 2) {
        // Simulateur : REF, SPEED, RBW, VBW de chaque scope
        const t = (this.sc2 = this.sc2 || [{}, {}])[d[1] ? 1 : 0], k = d[0];
        if (d.length === 2) r(k, d[1], ...(k === 0x19 ? [bcd(Math.floor(Math.abs(t[k] || 0) / 10)), bcd((Math.abs(t[k] || 0) % 10) * 10), (t[k] || 0) < 0 ? 1 : 0] : [t[k] != null ? t[k] : k === 0x1A ? 1 : k === 0x1F ? 1 : 0]));
        else { t[k] = k === 0x19 ? (unbcd(d[2]) * 10 + Math.floor(unbcd(d[3]) / 10)) * (d[4] ? -1 : 1) : d[2]; ok(); }
      } else if (c === 0x27 && d[0] >= 0x14 && d[0] <= 0x17 && d.length >= 2) {
        const sc = (this.sc = this.sc || [{ m: 0, sp: 25000, e: 1, h: 0 }, { m: 1, sp: 25000, e: 1, h: 0 }])[d[1] ? 1 : 0];
        const k = { 0x14: 'm', 0x15: 'sp', 0x16: 'e', 0x17: 'h' }[d[0]];
        if (d.length === 2) r(d[0], d[1], ...(k === 'sp' ? freqBytes(sc.sp) : [sc[k]]));
        else { sc[k] = k === 'sp' ? freqValue(d, 2) : d[2]; ok(); }
      } else if (c === 0x1A && d[0] === 0x03) {
        const m = b ? v.modeB : v.mode;
        // Largeur par récepteur et par FIL (au départ 3,0 kHz / 2,4 kHz / 500 Hz)
        const fw = (this.fw = this.fw || [[34, 28, 9], [34, 28, 9]])[b ? 1 : 0], fi = ((m && m[2]) || 1) - 1;
        if (d.length === 1) r(0x03, bcd(fw[fi])); else { fw[fi] = unbcd(d[1]); ok(); }
      } else if (c === 0x1A && d[0] === 0x04) {
        // Constante de temps AGC du simulateur : une valeur par groupe de mode et par FAST / MID / SLOW (valeurs d'usine au départ)
        const m = b ? v.modeB : v.mode, gp = !m ? 0 : m[0] === 0x02 ? 2 : m[0] === 0x05 ? 3 : m[0] === 0x00 || m[0] === 0x01 ? 0 : 1;
        const ag = S[0x1612] || 2, key = gp + '-' + ag;
        if (gp === 3) ng();
        else {
          const t = (this.agcT = this.agcT || [{}, {}])[b ? 1 : 0];
          if (t[key] == null) t[key] = [[3, 8, 13], [1, 4, 6], [8, 10, 12]][gp][ag - 1];
          if (d.length === 1) r(0x04, bcd(t[key])); else { t[key] = unbcd(d[1]); ok(); }
        }
      } else if (c === 0x1A && d[0] === 0x05 && d.length >= 3 && EX[unbcd(d[1]) * 100 + unbcd(d[2])]) {
        // Réglages SET du simulateur : valeurs d'usine, gardées si on les change
        const n = unbcd(d[1]) * 100 + unbcd(d[2]), it = EX[n], ex = (this.ex = this.ex || {});
        if (d.length === 3) {
          // Network (simulateur) : adresses d'exemple, rien de réel
          const ipb = (s4) => s4.split('.').map(Number).reduce((o, x) => o.concat([bcd(Math.floor(x / 100)), bcd(x % 100)]), []);
          if (it.type === 'ip') return r(0x05, d[1], d[2], ...ipb({ 162: '192.168.0.10', 164: '192.168.0.11', 165: '192.168.0.12', 167: '192.168.0.1', 168: '192.168.0.1', 169: '0.0.0.0', 172: '192.168.100.10', 174: '192.168.100.1' }[n] || '0.0.0.0'));
          if (it.type === 'name') return r(0x05, d[1], d[2], ...Array.from(n === 198 ? 'ON5VL' : 'IC-7760 HEAD').map((ch) => ch.charCodeAt(0)));
          const raw = ex[n] != null ? ex[n] : { hl: 525, tone: 5, tbw6: n === 15 ? 1 : n === 16 ? 21 : n === 17 ? 30 : 1, mask: 24, antm: 0, pct: n === 184 ? 128 : 191, rgb: n === 215 ? '0,255,0' : n === 216 ? '255,0,0' : n === 214 ? '0,0,0' : '51,153,255', edge: it.lo + '-' + Math.min(it.hi, it.lo + 350),
            list: n === 220 ? 2 : n === 188 ? 0 : n === 192 || n === 217 || n === 221 || n === 223 || n === 218 || n === 190 || n === 191 || n === 197 || n === 170 || n === 175 || n === 161 || (n >= 344 && n <= 346) || n === 362 ? 1 : 0 }[it.type];
          r(0x05, d[1], d[2], ...exBytes(it, raw));
        }
        else { const b = d.slice(3); ex[n] = it.type === 'rgb' ? [lvlValue(b, 0), lvlValue(b, 2), lvlValue(b, 4)].join(',') : it.type === 'edge' ? edgeKHz(b, 0) + '-' + edgeKHz(b, 3) : it.type === 'pct' ? lvlValue(b, 0) : it.type === 'hl' || it.type === 'antm' ? unbcd(b[0]) * (it.type === 'antm' ? 10 : 100) + unbcd(b[1]) : it.type === 'tbw6' ? (b[0] >> 4) * 10 + (b[0] & 0x0F) : unbcd(b[0]); ok(); }
      } else if (c === 0x1A && d[0] === 0x05 && d[1] === 0x03 && (d[2] === 0x63 || d[2] === 0x64)) {
        const dep = d[2] === 0x63;
        if (d.length === 3) r(0x05, 0x03, d[2], ...(dep ? [bcd(this.nbd != null ? this.nbd : 4)] : lvlBytes(this.nbw != null ? this.nbw : 128)));
        else { if (dep) this.nbd = unbcd(d[3]); else this.nbw = lvlValue(d, 3); ok(); }
      } else if (c === 0x1A && d[0] === 0x05 && d[1] === 0x02 && d[2] === 0x86) {
        if (d.length === 3) r(0x05, 0x02, 0x86, ...lvlBytes(this.st != null ? this.st : 128)); else { this.st = lvlValue(d, 3); ok(); }
      } else if (c === 0x1A && d[0] === 0x05 && d[1] === 0x01 && d[2] === 0x29) {
        // DATA OFF MOD (simulateur) : 00 MIC au départ
        if (d.length === 3) r(0x05, 0x01, 0x29, this.mod || 0); else { this.mod = d[3]; ok(); }
      } else if (c === 0x14 && d[0] === 0x0A) {
        if (d.length === 1) r(0x0A, ...lvlBytes(v.power)); else { v.power = lvlValue(d, 1); ok(); }
      } else if (c === 0x14 && d[0] === 0x0C && d.length > 1) {
        this.lv[0x140C] = lvlValue(d, 1); this.cwWpm = 6 + this.lv[0x140C] * 42 / 255; ok();
      } else if (SIDE_MAP[c * 256 + d[0]]) {
        const s = SIDE_MAP[c * 256 + d[0]], k = c * 256 + d[0];
        if (d.length === 1) r(d[0], ...(s[3] === 'l' ? lvlBytes(S[k]) : [S[k]])); else { S[k] = s[3] === 'l' ? lvlValue(d, 1) : d[1]; ok(); }
      } else if (COMMON_MAP[c * 256 + d[0]]) {
        const s = COMMON_MAP[c * 256 + d[0]], k = c * 256 + d[0];
        if (d.length === 1) r(d[0], ...(s[3] === 'l' ? lvlBytes(this.lv[k]) : [this.lv[k]])); else { this.lv[k] = s[3] === 'l' ? lvlValue(d, 1) : d[1]; ok(); }
      } else ng();
    }
    // Simulateur : une image du scope du MAIN (1 trame d'en-tête + 14 morceaux, 689 points de 0 à 200)
    scopeOut() {
      const v = this.v, out = [];
      this.sc = this.sc || [{ m: 0, sp: 25000, e: 1, h: 0 }, { m: 1, sp: 25000, e: 1, h: 0 }];
      const dual = this.scDual == null ? 1 : this.scDual, sides = dual ? [0, 1] : [this.scSel || 0];
      this.t2 = (this.t2 || 0) + 1;
      for (const sd of sides) {
      const sc = this.sc[sd], fq = sd ? v.freqB : v.freq;
      if (sc.h) continue;
      // CENTER : centre ± SPAN ; FIX : bords de la bande (EDGE)
      const band = [[1800000, 2000000], [3500000, 3800000], [7000000, 7300000], [10100000, 10150000], [14000000, 14350000], [18068000, 18168000], [21000000, 21450000], [24890000, 24990000], [28000000, 29700000], [50000000, 52000000]].find((b) => fq >= b[0] && fq <= b[1]) || [fq - 100000, fq + 100000];
      const lo = sc.m & 1 ? band[0] : fq - sc.sp, hi = sc.m & 1 ? band[1] : fq + sc.sp;
      out.push([CTRL, ADDR, 0x27, 0x00, sd, 0x01, 0x15, sc.m, ...freqBytes(sc.m & 1 ? lo : fq), ...freqBytes(sc.m & 1 ? hi : sc.sp), 0x00]);
      const pts = [];
      for (let i = 0; i < 689; i++) {
        const f = lo + (hi - lo) * i / 688;
        let a = 25 + Math.random() * 18;
        for (const [sf, w, p] of [[14074000, 1500, 90], [14255000, 2800, 80], [14100000, 2400, 70], [14195000, 2600, 75], [14300000, 2600, 72], [7074000, 1500, 90], [7030000, 300, 75], [7155000, 2500, 70], [7200000, 2500, 85], [14240000 + 1000 * Math.sin(this.t2 / 20), 300, 70]]) a = Math.max(a, p * Math.exp(-(((f - sf) / w) ** 2)) + Math.random() * 8);
        pts.push(Math.max(0, Math.min(200, Math.round(a))));
      }
      for (let k = 0; k < 14; k++) out.push([CTRL, ADDR, 0x27, 0x00, sd, bcd(k + 2), 0x15, ...pts.slice(k * 53, k === 13 ? 689 : (k + 1) * 53)]);
      }
      this.flush(out);
    }
    flush(out) {
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
    FAST, SLOW, SLOW_PER_TICK, TXMETERS, POLL_MS, FRAME_GAP_MS, readFor, TX_SOURCE_UNKNOWN: true, STATE_KEYS, STR_KEYS,
    EX, EX_MENUS, EX_TREE, EX_PARENT, exFmt, exOk, exCode, ANT_SEG,
    GROUPS, CONTROLS, CONTROL, validate, widthTable: () => null, cmdFreq, cmdFreqB, cmdMode, cmdPower, cmdPtt, parse, Splitter,
    smeterLabel, swrValue, vdValue, idValue, poFrac, filHz, bwText,
    // Badges du récepteur SUB sur le dashboard (deux récepteurs, comme le FTDX101)
    SUB_BADGES: true,
    preampText: (r, side) => { const v = side === 'B' ? r.preampB : r.preamp; return v == null ? null : [['PRE OFF', 'P.AMP1', 'P.AMP2'][v] || 'PRE', !!v]; },
    // Scope du MAIN vers la page Station : scope en service et sortie de la courbe par le CI-V (27 10 01, 27 11 01) ; arrêt : 27 11 00
    // Par le port [USB B] : 15 trames par image (en-tête + morceaux), 689 points de 0 à 200
    SCOPE: { on: [q(0x27, 0x10, 0x01), q(0x27, 0x11, 0x01)], off: [q(0x27, 0x11, 0x00)], points: 689, max: 200 },
    // Émission CW par le manipulateur interne (CI-V 17 : 30 caractères au plus par trame, FF = arrêt) ;
    // vitesse 14 0C (0–255 = 6–48 mots/min), break-in semi (16 47 01) pour que le TRX émette tout seul
    CW: {
      max: 30,
      wpmMax: 48,
      setup: (wpm) => [q(0x14, 0x0C, ...lvlBytes(Math.round((Math.max(6, Math.min(48, wpm)) - 6) * 255 / 42))), q(0x16, 0x47, 0x01)],
      mem: null, read: null, alt: [],
      play: null, text: (t) => q(0x17, ...Array.from(t, (c) => c.charCodeAt(0))),
      stop: () => [q(0x17, 0xFF)]
    },
    // Phonie à distance : « DATA OFF MOD » (1A 05 01 29 : 00 MIC, 01 USB, 02 LINE-IN, 03 ACC…) mis sur USB le temps de
    // l'émission en LSB / USB / AM / FM, puis remis comme avant (le micro du club refonctionne)
    VOICE: {
      modes: ['LSB', 'USB', 'AM', 'FM'],
      steps(mode) {
        if (this.modes.indexOf(mode) < 0) return null;
        return [{ label: 'DATA OFF MOD', read: q(0x1A, 0x05, 0x01, 0x29),
          match: (t) => (t && typeof t !== 'string' && t.length >= 7 && t[1] === ADDR && t[2] === 0x1A && t[3] === 0x05 && t[4] === 0x01 && t[5] === 0x29 ? t[6] : null),
          set: q(0x1A, 0x05, 0x01, 0x29, 0x01), restore: (p) => q(0x1A, 0x05, 0x01, 0x29, p) }];
      }
    },
    // Son USB : une voie (à vérifier : récepteur MAIN, ou MAIN et SUB en stéréo)
    DUAL_AUDIO: false,
    Fake,
    serial: { baudRate: 115200, stopBits: 1, portHint: 'USB (A) : 1er des deux ports COM du port [USB B] de la tête de commande' },
    hint: 'IC-7760 : câble USB entre le port [USB B] à l’arrière de la tête de commande et le PC (pilote USB Icom). Choisissez le 1er des deux ports COM (USB (A)). MENU → SET → Connectors → CI-V : « CI-V USB (A) Echo Back » = OFF, adresse CI-V B2h. « USB SEND » et « USB Keying » sur OFF. USB AF/IF Output : « Output Select » = AF. Modes numériques : MOD Input → « DATA1 MOD » = USB. Si le TRX ne répond pas : vérifier que le RF deck (le gros boîtier) est alimenté et relié à la tête de commande, puis redémarrer l’IC-7760 (sinon il affiche « The RF deck is not detected »).',
    muteHint: 'TRX muet : RF deck alimenté et relié à la tête ?'
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.RIGS = root.RIGS || {};
    root.RIGS[ID] = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
