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
    q(0x16, 0x50), q(0x15, 0x15), q(0x15, 0x16),
    // Face avant (/ic7300) : CW PITCH, KEY SPEED, MONITOR (marche et niveau), BK-IN, IP+, VOX GAIN, ANTI VOX
    q(0x14, 0x09), q(0x14, 0x0C), q(0x14, 0x15), q(0x16, 0x45), q(0x16, 0x47), q(0x16, 0x65), q(0x14, 0x16), q(0x14, 0x17), q(0x16, 0x57),
    q(0x27, 0x15, 0x00), q(0x27, 0x17, 0x00), q(0x27, 0x14, 0x00), q(0x27, 0x16, 0x00), q(0x27, 0x19, 0x00), q(0x27, 0x1A, 0x00), q(0x27, 0x1D, 0x00), // scope du TRX : SPAN, HOLD, CENTER / FIX, EDGE, REF, SPEED
    q(0x16, 0x58) // TBW (largeur d'émission en SSB : 00 WIDE, 01 MID, 02 NAR)
  ];
  const SLOW_PER_TICK = 5;
  const POLL_MS = 250;
  const FRAME_GAP_MS = 15; // laisse le temps à la radio de répondre entre deux trames
  // À l'ouverture du port : TX OFF (au cas où la radio serait restée en émission par CAT)
  const INIT = [q(0x1C, 0x00, 0x00)];

  let abAt = 0;
  // Touche A/B appuyée au TRX : la fréquence en service (25 00) devient celle de l'autre VFO (25 01), qui reprend l'ancienne
  function observe(p, st) {
    if (p.freq == null || !st.freq || !st.freqB || st.freq === st.freqB || Date.now() - abAt < 3000) return;
    if (p.freq === st.freqB) { st.vfoAB = st.vfoAB === 1 ? 0 : 1; p.freqB = st.freq; abAt = Date.now(); }
  }
  const STATE_KEYS = ['vfoAB', 'txVfo', 'split', 'rit', 'xit', 'clar', 'lock', 'fil', 'filB', 'pbtIn', 'pbtOut', 'nb', 'nbLvl', 'nr', 'nrLvl',
    'dnf', 'notch', 'notchPos', 'af', 'rf', 'sql', 'agc', 'preamp', 'att', 'mic', 'proc', 'procLvl', 'vox', 'tuner', 'tuning',
    'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'cwPitch', 'keySpeed', 'moniLvl', 'moni', 'bkin', 'ipPlus', 'voxGain', 'antiVox', 'notchW', 'tbw', 'scSpan', 'scHold', 'scMode', 'scEdge', 'scRef', 'scSpeed', 'scVbw'];
  // SPAN du scope du TRX en mode CENTER (27 15 00 + demi-largeur en BCD) : ±2,5 kHz … ±500 kHz
  const SC_SPANS = [2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000];
  // Textes : mémoires du manipulateur M1 … M8 (écran KEYER)
  // ---- Écran SET de la face avant : réglages 1A 05 (manuel §19), par sous-menu comme sur le TRX.
  // [n°, libellé, type, valeurs, accès] ; accès : 'rw' modifiable à distance, 'ro' lecture seule (Connectors, étalonnage, langue…)
  // Types : liste (octet = n° de la valeur), on (OFF/ON), tone (−5 … +5), pct (0–255 → %), hl (HPF/LPF du RX), tbw (bords de la bande d'émission),
  // nbd (1–10), nbw (1–100), voxd (0,0–2,0 s), hex (adresse), date, time, utc
  const OF = ['OFF', 'ON'];
  const EX_MENUS = {
    tone: ['Tone Control/TBW', [
      [1, 'SSB RX HPF/LPF', 'hl'], [2, 'SSB RX Bass', 'tone'], [3, 'SSB RX Treble', 'tone'],
      [4, 'AM RX HPF/LPF', 'hl'], [5, 'AM RX Bass', 'tone'], [6, 'AM RX Treble', 'tone'],
      [7, 'FM RX HPF/LPF', 'hl'], [8, 'FM RX Bass', 'tone'], [9, 'FM RX Treble', 'tone'],
      [10, 'CW RX HPF/LPF', 'hl'], [11, 'RTTY RX HPF/LPF', 'hl'],
      [12, 'SSB TX Bass', 'tone'], [13, 'SSB TX Treble', 'tone'],
      [14, 'SSB TBW (WIDE)', 'tbw'], [15, 'SSB TBW (MID)', 'tbw'], [16, 'SSB TBW (NAR)', 'tbw'], [196, 'SSB-D TBW', 'tbw'],
      [17, 'AM TX Bass', 'tone'], [18, 'AM TX Treble', 'tone'], [19, 'FM TX Bass', 'tone'], [20, 'FM TX Treble', 'tone']]],
    func: ['Function', [
      [21, 'Beep Level', 'pct'], [22, 'Beep Level Limit', OF], [23, 'Beep (Confirmation)', OF],
      [24, 'Band Edge Beep', ['OFF', 'ON (Default)', 'ON (User)', 'ON (User) & TX Limit']], [25, 'RF/SQL Control', ['AUTO', 'SQL', 'RF+SQL']],
      [193, 'MF Band ATT', OF], [33, 'SPLIT LOCK', OF], [34, '[TUNER] Switch', ['Manual', 'Auto']], [35, 'PTT Start (Tuner)', OF],
      [36, 'RTTY Mark Frequency', ['1275 Hz', '1615 Hz', '2125 Hz']], [37, 'RTTY Shift Width', ['170 Hz', '200 Hz', '425 Hz']], [38, 'RTTY Keying Polarity', ['Normal', 'Reverse']],
      [39, 'Speech Language', ['English', 'Japanese'], 'ro'], [40, 'Speech Speed', ['Slow', 'Fast']], [41, 'S-Level Speech', OF], [42, 'MODE Speech', OF], [43, 'Speech Level', 'pct'],
      [44, '[SPEECH/LOCK] Switch', ['SPEECH/LOCK', 'LOCK/SPEECH']], [45, 'Lock Function', ['MAIN DIAL', 'PANEL']], [46, 'Memo Pad Quantity', ['5', '10']],
      [47, 'MAIN DIAL Auto TS', ['OFF', 'Low', 'High']], [48, 'MIC Up/Down Speed', ['Slow', 'Fast']], [49, 'Quick RIT/ΔTX Clear', OF],
      [50, '[NOTCH] Switch (SSB)', ['Auto', 'Manual', 'Auto/Manual']], [51, '[NOTCH] Switch (AM)', ['Auto', 'Manual', 'Auto/Manual']],
      [52, 'SSB/CW Synchronous Tuning', OF], [53, 'CW Normal Side', ['LSB', 'USB']],
      [54, 'Screen Capture [POWER] Switch', OF], [55, 'Screen Capture File Type', ['PNG', 'BMP']], [56, 'Keyboard Type', ['Ten-key', 'Full Keyboard']],
      [194, 'Keyboard Layout', ['English', 'German', 'French']], [57, 'Calibration Marker', OF, 'ro'], [58, 'REF Adjust', 'pct', 'ro'],
      [189, 'NB Depth', 'nbd'], [190, 'NB Width', 'nbw'], [191, 'VOX Delay', 'voxd'], [192, 'VOX Voice Delay', ['OFF', 'Short', 'Mid', 'Long']],
      [197, 'Inhibit Timer at USB', OF, 'ro']]],
    conn: ['Connectors', [
      [59, 'ACC/USB Output Select', ['AF', 'IF'], 'ro'], [60, 'ACC/USB AF Output Level', 'pct', 'ro'], [61, 'ACC/USB AF SQL', ['OFF (OPEN)', 'ON'], 'ro'],
      [62, 'ACC/USB AF Beep/Speech Output', OF, 'ro'], [63, 'ACC/USB IF Output Level', 'pct', 'ro'], [64, 'ACC MOD Level', 'pct', 'ro'], [65, 'USB MOD Level', 'pct', 'ro'],
      [66, 'DATA OFF MOD', ['MIC', 'ACC', 'MIC,ACC', 'USB', 'MIC,USB'], 'ro'], [67, 'DATA MOD', ['MIC', 'ACC', 'MIC,ACC', 'USB', 'MIC,USB'], 'ro'],
      [68, 'External Keypad VOICE', OF, 'ro'], [69, 'External Keypad KEYER', OF, 'ro'], [70, 'External Keypad RTTY', OF, 'ro'],
      [71, 'CI-V Transceive', OF, 'ro'], [72, 'CI-V USB→REMOTE Transceive Address', 'hex', 'ro'], [73, 'CI-V Output (for ANT)', OF, 'ro'],
      [74, 'CI-V USB Port', ['Link to [REMOTE]', 'Unlink from [REMOTE]'], 'ro'], [75, 'CI-V USB Echo Back', ['ON', 'OFF'], 'ro'],
      [76, 'USB Serial Function', ['CI-V', 'RTTY Decode'], 'ro'], [77, 'RTTY Decode Baudrate', ['4800', '9600', '19200', '38400'], 'ro'],
      [78, 'USB SEND', ['OFF', 'DTR', 'RTS'], 'ro'], [79, 'USB Keying (CW)', ['OFF', 'DTR', 'RTS'], 'ro'], [80, 'USB Keying (RTTY)', ['OFF', 'DTR', 'RTS'], 'ro']]],
    disp: ['Display', [
      [81, 'LCD Backlight', 'pct'], [82, 'Display Type', ['A', 'B']], [83, 'Display Font', ['Basic', 'Round']], [84, 'Meter Peak Hold', OF],
      [85, 'Memory Name', OF], [86, 'MN-Q Popup (MN Width)', OF], [87, 'Bandwidth Popup (PBT)', OF], [88, 'Bandwidth Popup (FIL)', OF],
      [89, 'Screen Saver', ['OFF', '15 min', '30 min', '60 min']], [90, 'Opening Message', OF], [92, 'Power ON Check', OF],
      [93, 'Display Language', ['English', 'Japanese'], 'ro']]],
    time: ['Time Set', [[94, 'Date', 'date'], [95, 'Time', 'time'], [96, 'UTC Offset', 'utc']]],
    // SCOPE SET (appui long sur EXPD/SET de l'écran SCOPE) ; couleurs en lecture seule ; bords FIX : sous-menu Fixed Edges
    scope: ['SCOPE SET', [
      [97, 'Scope during Tx (CENTER Type)', OF], [98, 'Max Hold', ['OFF', '10s Hold', 'ON']], [99, 'CENTER Type Display', ['Filter Center', 'Carrier Point Center', 'Carrier Point Center (Abs. Freq.)']],
      [100, 'Marker Position (FIX Type/SCROLL Type)', ['Filter Center', 'Carrier Point']], [102, 'Averaging', ['OFF', '2', '3', '4']], [103, 'Waveform Type', ['Fill', 'Fill+Line']],
      [104, 'Waveform Color (Current)', 'rgb', 'ro'], [105, 'Waveform Color (Line)', 'rgb', 'ro'], [106, 'Waveform Color (Max Hold)', 'rgb', 'ro'],
      [107, 'Waterfall Display', OF], [108, 'Waterfall Speed', ['Slow', 'Mid', 'Fast']], [109, 'Waterfall Size (Expand Screen)', ['Small', 'Mid', 'Large']],
      [110, 'Waterfall Peak Color Level', ['Grid 1', 'Grid 2', 'Grid 3', 'Grid 4', 'Grid 5', 'Grid 6', 'Grid 7', 'Grid 8']], [111, 'Waterfall Marker Auto-hide', OF]]],
    // AUDIO SCOPE SET (appui long sur EXPD/SET de l'écran AUDIO) : appliqué au dessin de la page ; couleurs en lecture seule
    audio: ['AUDIO SCOPE SET', [[151, 'FFT Scope Waveform Type', ['Fill', 'Line']], [152, 'FFT Scope Waveform Color', 'rgb', 'ro'],
      [153, 'FFT Scope Waterfall Display', OF], [154, 'Oscilloscope Waveform Color', 'rgb', 'ro']]],
    // Fixed Edges : 3 bords par tranche de fréquences (1A 05 0112 … 0150 : bord bas puis bord haut, au kHz)
    edges: ['Fixed Edges', []]
  };
  const EDGE_BANDS = [[30, 1600], [1600, 2000], [2000, 6000], [6000, 8000], [8000, 11000], [11000, 15000], [15000, 20000], [20000, 22000], [22000, 26000], [26000, 30000], [30000, 45000], [45000, 60000], [60000, 74800]];
  EDGE_BANDS.forEach(([lo, hi], i) => { for (let e = 0; e < 3; e++) EX_MENUS.edges[1].push([112 + i * 3 + e, (lo / 1000).toFixed(2) + '–' + (hi / 1000).toFixed(2) + ' MHz · No.' + (e + 1), 'edge']); });
  const EX = {};
  for (const k in EX_MENUS) for (const it of EX_MENUS[k][1]) EX[it[0]] = { n: it[0], label: it[1], type: Array.isArray(it[2]) ? 'list' : it[2], opts: Array.isArray(it[2]) ? it[2] : null, rw: it[3] !== 'ro' && k !== 'conn', menu: k };
  // Bords FIX : plage de la tranche de chaque n°
  for (const n in EX) if (EX[n].type === 'edge') { const b = EDGE_BANDS[Math.floor((n - 112) / 3)]; EX[n].lo = b[0]; EX[n].hi = b[1]; }
  const exFmt = (it, raw) => {
    if (raw == null || raw === '') return '—';
    const v = Number(raw), t = it.type;
    if (t === 'list') return it.opts[v] != null ? it.opts[v] : String(v);
    if (t === 'tone') return (v > 5 ? '+' : '') + (v - 5);
    if (t === 'pct') return Math.round(v * 100 / 255) + '%';
    if (t === 'nbd') return String(v + 1);
    if (t === 'nbw') return String(Math.round(1 + v * 99 / 255));
    if (t === 'voxd') return (v / 10).toFixed(1) + ' s';
    if (t === 'hex') return v.toString(16).toUpperCase().padStart(2, '0') + 'h';
    if (t === 'hl') { const h = Math.floor(v / 100), l = v % 100; return 'HPF ' + (h ? h * 100 : 'Through') + ' · LPF ' + (l >= 25 ? 'Through' : l * 100); }
    if (t === 'tbw') { const lo = Math.floor(v / 10), hi = v % 10; return [100, 200, 300, 500][lo] + ' – ' + [2500, 2700, 2800, 2900][hi] + ' Hz'; }
    if (t === 'date') return String(raw).replace(/^(\d{4})(\d\d)(\d\d)$/, '$1/$2/$3');
    if (t === 'time') return String(raw).padStart(4, '0').replace(/^(\d\d)(\d\d)$/, '$1:$2');
    if (t === 'edge') { const [a, b] = String(raw).split('-').map(Number); return (a / 1000).toFixed(3) + ' – ' + (b / 1000).toFixed(3) + ' MHz'; }
    if (t === 'rgb') { const [r2, g2, b2] = String(raw).split(','); return 'R:' + r2 + '  G:' + g2 + '  B:' + b2; }
    if (t === 'utc') { const m = Number(raw); return (m < 0 ? '−' : '+') + String(Math.floor(Math.abs(m) / 60)).padStart(2, '0') + ':' + String(Math.abs(m) % 60).padStart(2, '0'); }
    return String(raw);
  };
  // Valeur brute (comme lue) → octets du CI-V
  function exBytes(it, raw) {
    const v = Number(raw), t = it.type;
    if (t === 'pct' || t === 'nbw' || t === 'hex') return lvlBytes(v);
    if (t === 'hl') return [bcd(Math.floor(v / 100)), bcd(v % 100)];
    if (t === 'tbw') return [(Math.floor(v / 10) << 4) | (v % 10)];
    if (t === 'date') { const d = String(raw); return [bcd(+d.slice(0, 2)), bcd(+d.slice(2, 4)), bcd(+d.slice(4, 6)), bcd(+d.slice(6, 8))]; }
    if (t === 'time') { const d = String(raw).padStart(4, '0'); return [bcd(+d.slice(0, 2)), bcd(+d.slice(2, 4))]; }
    if (t === 'utc') { const a = Math.abs(v); return [bcd(Math.floor(a / 60)), bcd(a % 60), v < 0 ? 1 : 0]; }
    if (t === 'edge') { const [a, b] = String(raw).split('-').map(Number); return edgeBytes(a).concat(edgeBytes(b)); }
    if (t === 'rgb') return String(raw).split(',').map(Number).reduce((o, x) => o.concat(lvlBytes(x)), []); // R, G, B : 0000–0255 chacun
    return [bcd(v)];
  }
  // Bord du scope FIX : 3 octets BCD [1 kHz|100 Hz=0] [100 kHz|10 kHz] [10 MHz|1 MHz] → kHz
  const edgeKHz = (b, o) => (b[o] >> 4) + unbcd(b[o + 1]) * 10 + unbcd(b[o + 2]) * 1000;
  const edgeBytes = (k) => [((k % 10) << 4), bcd(Math.floor(k / 10) % 100), bcd(Math.floor(k / 1000) % 100)];
  // exSet : n° × 100000 + valeur brute (UTC Offset : minutes + 1000, pour rester positif)
  const exRaw = (it, v) => (it.type === 'utc' ? (v % 100000) - 1000 : v % 100000);
  const exCode = (it, raw) => it.n * 100000 + (it.type === 'utc' ? Number(raw) + 1000 : Number(raw));
  // Plage de chaque type (valeur brute)
  function exOk(it, raw) {
    const v = Number(raw), t = it.type;
    if (t === 'list') return Number.isInteger(v) && v >= 0 && v < it.opts.length;
    if (t === 'tone') return v >= 0 && v <= 10;
    if (t === 'pct' || t === 'nbw') return v >= 0 && v <= 255;
    if (t === 'nbd') return v >= 0 && v <= 9;
    if (t === 'voxd') return v >= 0 && v <= 20;
    if (t === 'hl') { const h = Math.floor(v / 100), l = v % 100; return h >= 0 && h <= 20 && l >= 5 && l <= 25 && (h === 0 || l === 25 || h * 100 < l * 100); }
    if (t === 'tbw') return Math.floor(v / 10) <= 3 && v % 10 <= 3;
    if (t === 'date') return /^20\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(String(raw));
    if (t === 'time') { const d = String(raw).padStart(4, '0'); return /^\d{4}$/.test(d) && +d.slice(0, 2) < 24 && +d.slice(2) < 60; }
    if (t === 'utc') return Number.isInteger(v) && v >= -840 && v <= 840 && v % 15 === 0;
    return false;
  }
  // et canaux mémoire mc1 … mc101 (écran MEMORY : « fréquence|mode|nom »)
  const STR_KEYS = ['km1', 'km2', 'km3', 'km4', 'km5', 'km6', 'km7', 'km8'].concat(Array.from({ length: 101 }, (_, i) => 'mc' + (i + 1)), Object.keys(EX).map((n) => 'ex' + n));

  // Lectures simples : [commande, sous-commande, clé, type] (type : t = 0/1, l = niveau 0–255, b = octet)
  const SIMPLE = [
    [0x14, 0x0A, 'powerRaw', 'l'], [0x14, 0x01, 'af', 'l'], [0x14, 0x02, 'rf', 'l'], [0x14, 0x03, 'sql', 'l'],
    [0x14, 0x12, 'nbLvl', 'l'], [0x14, 0x06, 'nrLvl', 'l'], [0x14, 0x0D, 'notchPos', 'l'], [0x14, 0x07, 'pbtIn', 'l'],
    [0x14, 0x08, 'pbtOut', 'l'], [0x14, 0x0B, 'mic', 'l'], [0x14, 0x0E, 'procLvl', 'l'],
    [0x15, 0x02, 'smeter', 'l'], [0x15, 0x11, 'm5', 'l'], [0x15, 0x12, 'm6', 'l'], [0x15, 0x13, 'm4', 'l'],
    [0x15, 0x14, 'm3', 'l'], [0x15, 0x15, 'm8', 'l'], [0x15, 0x16, 'm7', 'l'],
    [0x16, 0x02, 'preamp', 'b'], [0x16, 0x12, 'agc', 'b'], [0x16, 0x22, 'nb', 't'], [0x16, 0x40, 'nr', 't'],
    [0x16, 0x41, 'dnf', 't'], [0x16, 0x48, 'notch', 't'], [0x16, 0x44, 'proc', 't'], [0x16, 0x46, 'vox', 't'],
    [0x16, 0x50, 'lock', 't'], [0x21, 0x01, 'rit', 't'], [0x21, 0x02, 'xit', 't'],
    [0x14, 0x09, 'cwPitchRaw', 'l'], [0x14, 0x0C, 'keySpeedRaw', 'l'], [0x14, 0x15, 'moniLvl', 'l'], [0x16, 0x45, 'moni', 't'],
    [0x16, 0x47, 'bkin', 'b'], [0x16, 0x65, 'ipPlus', 't'], [0x14, 0x16, 'voxGain', 'l'], [0x14, 0x17, 'antiVox', 'l'], [0x16, 0x57, 'notchW', 'b'], [0x16, 0x58, 'tbw', 'b']
  ];
  // CW PITCH : 0–255 = 300–900 Hz (pas de 5 Hz) ; KEY SPEED : 0–255 = 6–48 mots/min
  const pitchHz = (raw) => Math.round((300 + raw * 600 / 255) / 5) * 5;
  const wpmOf = (raw) => Math.round(6 + raw * 42 / 255);
  const SIMPLE_MAP = {};
  for (const s of SIMPLE) SIMPLE_MAP[s[0] * 256 + s[1]] = s;
  // Trame de lecture de chaque clé d'état : relue juste après un réglage
  const READ_FOR = { power: q(0x14, 0x0A), split: q(0x0F), att: q(0x11), clar: q(0x21, 0x00), clarClr: q(0x21, 0x00), fil: q(0x26, 0x00), tuner: q(0x1C, 0x01),
    cwPitch: q(0x14, 0x09), keySpeed: q(0x14, 0x0C) };
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
    // A/B comme la touche du TRX : passe sur l'autre VFO (07 00 / 07 01). Le CI-V de l'IC-7300 ne dit pas quel VFO est en service :
    // vfoAB (0 = A, 1 = B) est tenu ici, et suivi quand on appuie sur A/B au TRX (fréquence en service = celle de l'autre VFO, voir observe)
    { id: 'swap', g: 'vfo', label: 'A ⇄ B', type: 'action', write: (v, st) => { const b = !(st && st.vfoAB === 1); if (st) st.vfoAB = b ? 1 : 0; abAt = Date.now(); return q(0x07, b ? 0x01 : 0x00); } },
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
    { id: 'tune', g: 'tx', label: 'TUNE', type: 'action', transmits: true, write: () => q(0x1C, 0x01, 0x02) },
    // Écrans FUNCTION / MULTI de la face avant (/ic7300) : hors de la disposition du dashboard
    { id: 'keySpeed', g: 'tx', label: 'KEY SPEED', type: 'level', min: 6, max: 48, step: 1, unit: 'wpm', face: true, write: (v) => q(0x14, 0x0C, ...lvlBytes(Math.round((v - 6) * 255 / 42))) },
    { id: 'cwPitch', g: 'tx', label: 'CW PITCH', type: 'level', min: 300, max: 900, step: 5, unit: 'Hz', face: true, write: (v) => q(0x14, 0x09, ...lvlBytes(Math.round((v - 300) * 255 / 600))) },
    { id: 'moni', g: 'tx', label: 'MONITOR', type: 'toggle', face: true, write: setOn(0x16, 0x45) },
    { id: 'moniLvl', g: 'tx', label: 'Niveau MONITOR', type: 'level', min: 0, max: 255, step: 1, pct: true, face: true, write: setLvl(0x14, 0x15) },
    { id: 'bkin', g: 'tx', label: 'BK-IN', type: 'select', face: true, options: [[0, 'OFF'], [1, 'SEMI'], [2, 'FULL']], write: (v) => q(0x16, 0x47, v) },
    { id: 'ipPlus', g: 'rx', label: 'IP+', type: 'toggle', face: true, write: setOn(0x16, 0x65) },
    { id: 'voxGain', g: 'tx', label: 'VOX GAIN', type: 'level', min: 0, max: 255, step: 1, pct: true, face: true, write: setLvl(0x14, 0x16) },
    // Largeur du NOTCH manuel (16 57 : 00 WIDE, 01 MID, 02 NAR)
    { id: 'notchW', g: 'flt', label: 'Largeur NOTCH', type: 'select', face: true, options: [[0, 'WIDE'], [1, 'MID'], [2, 'NAR']], write: (v) => q(0x16, 0x57, v) },
    { id: 'antiVox', g: 'tx', label: 'ANTI VOX', type: 'level', min: 0, max: 255, step: 1, pct: true, face: true, write: setLvl(0x14, 0x17) },
    // Écran KEYER de la face avant : relit le contenu d'une mémoire du manipulateur (1A 02 : M1 … M8), sans rien changer sur le TRX
    { id: 'kmRead', g: 'tx', label: 'Lecture mémoire KEYER', type: 'level', min: 1, max: 8, step: 1, face: true, write: (v) => q(0x1A, 0x02, v) },
    // Écran SCOPE : SPAN (±2,5k … ±500k) et HOLD du scope du TRX
    { id: 'scSpan', g: 'rx', label: 'SPAN du scope', type: 'select', face: true, options: SC_SPANS.map((h, i) => [i, '±' + (h >= 1000 ? h / 1000 + 'k' : h)]),
      write: (v) => q(0x27, 0x15, 0x00, ...freqBytes(SC_SPANS[v])) },
    { id: 'scHold', g: 'rx', label: 'HOLD du scope', type: 'toggle', face: true, write: (v) => q(0x27, 0x17, 0x00, v ? 1 : 0) },
    // CENT/FIX (27 14 : 00 CENTER, 01 FIX) et EDGE en mode FIX (27 16 : bords 1 à 4 de la bande)
    // 02 SCROLL-C et 03 SCROLL-F (appui long sur CENT/FIX) : valeurs des firmwares récents, pas dans la section 19 du manuel fourni
    { id: 'scMode', g: 'rx', label: 'CENTER / FIX du scope', type: 'select', face: true, options: [[0, 'CENTER'], [1, 'FIX'], [2, 'SCROLL-C'], [3, 'SCROLL-F']], write: (v) => q(0x27, 0x14, 0x00, v) },
    // REF (27 19 00 + dB en BCD XX XX + signe : −20,0 … +20,0 dB par 0,5 dB) et SPEED (27 1A 00 : 00 FAST, 01 MID, 02 SLOW) du scope du TRX
    { id: 'scRef', g: 'rx', label: 'REF du scope', type: 'level', min: -20, max: 20, step: 0.5, unit: 'dB', face: true,
      write: (v) => { const a = Math.round(Math.abs(v) * 10); return q(0x27, 0x19, 0x00, bcd(Math.floor(a / 10)), bcd((a % 10) * 10), v < 0 ? 1 : 0); } },
    { id: 'scSpeed', g: 'rx', label: 'SPEED du scope', type: 'select', face: true, options: [[0, 'FAST'], [1, 'MID'], [2, 'SLOW']], write: (v) => q(0x27, 0x1A, 0x00, v) },
    { id: 'scEdge', g: 'rx', label: 'EDGE du scope (FIX)', type: 'select', face: true, options: [[1, 'EDGE1'], [2, 'EDGE2'], [3, 'EDGE3'], [4, 'EDGE4']], write: (v) => q(0x27, 0x16, 0x00, v) }, // 4 bords sur le TRX (le manuel n'en cite que 3)
    // Écran FUNCTION : TBW, largeur de la bande passante d'émission en SSB (16 58 : 00 WIDE, 01 MID, 02 NAR)
    { id: 'tbw', g: 'tx', label: 'TBW', type: 'select', face: true, options: [[0, 'WIDE'], [1, 'MID'], [2, 'NAR']], write: (v) => q(0x16, 0x58, v) },
    // Écran VOICE TX : émission d'une mémoire vocale du TRX (28 00 01 … 08 = T1 … T8, 28 00 00 = arrêt) ; phonie seulement,
    // mêmes contrôles d'émission que la phonie (main, bandes, puissance, VOX, ROS) côté serveur
    { id: 'voiceTx', g: 'tx', label: 'VOICE TX', type: 'level', min: 1, max: 8, step: 1, face: true, transmits: 'voice',
      when: (st) => /^(LSB|USB|AM|FM)$/.test((st.vfoSel === 1 ? st.modeB : st.mode) || ''), write: (v) => q(0x28, 0x00, v) },
    { id: 'voiceStop', g: 'tx', label: 'Arrêt VOICE TX', type: 'action', face: true, write: () => q(0x28, 0x00, 0x00) },
    // Écran SCAN de la face avant : balayage (réception seulement) — 0E 00 arrêt, 02 programmé (P1 – P2), 03 ΔF, 12 / 13 les mêmes en FINE
    { id: 'scan', g: 'vfo', label: 'SCAN', type: 'select', face: true, options: [[0, 'STOP'], [1, 'PROG'], [2, 'ΔF'], [3, 'PROG FINE'], [4, 'ΔF FINE']], write: (v) => q(0x0E, [0x00, 0x02, 0x03, 0x12, 0x13][v]) },
    // Plage du balayage ΔF : 0E A1 … A7 = ±5, 10, 20, 50, 100, 500 kHz, ±1 MHz
    { id: 'dfSpan', g: 'vfo', label: 'ΔF SPAN', type: 'select', face: true, options: [[1, '±5k'], [2, '±10k'], [3, '±20k'], [4, '±50k'], [5, '±100k'], [6, '±500k'], [7, '±1M']], write: (v) => q(0x0E, 0xA0 + v) },
    // Écran SET : relit un réglage 1A 05 (sans rien changer) ; exSet : n° × 100000 + valeur brute, refusé hors des réglages 'rw' du tableau EX
    { id: 'exRead', g: 'vfo', label: 'Lecture réglage SET', type: 'level', min: 1, max: 199, step: 1, face: true,
      check: (v) => { if (!EX[v]) throw new Error('réglage inconnu'); }, write: (v) => q(0x1A, 0x05, bcd(Math.floor(v / 100)), bcd(v % 100)) },
    { id: 'exSet', g: 'vfo', label: 'Réglage SET', type: 'level', min: 100000, max: 19999999999, step: 1, face: true,
      check: (v) => {
        const it = EX[Math.floor(v / 100000)];
        if (!it) throw new Error('réglage inconnu');
        const raw = exRaw(it, v);
        if (!it.rw) throw new Error(it.label + ' : lecture seule à distance');
        if (it.type !== 'date' && !exOk(it, raw)) throw new Error(it.label + ' : valeur hors plage');
      },
      write: (v) => { const it = EX[Math.floor(v / 100000)]; return q(0x1A, 0x05, bcd(Math.floor(it.n / 100)), bcd(it.n % 100), ...exBytes(it, exRaw(it, v))); } },
    // Bord FIX : n° × 10¹⁰ + bord bas (kHz) × 10⁵ + bord haut (kHz), dans la tranche du n°, bas < haut
    { id: 'exEdge', g: 'rx', label: 'Bord du scope FIX', type: 'level', min: 112e10, max: 150e10 + 9999999999, step: 1, face: true,
      check: (v) => {
        const it = EX[Math.floor(v / 1e10)], a = Math.floor(v / 1e5) % 1e5, b = v % 1e5;
        if (!it || it.type !== 'edge') throw new Error('bord inconnu');
        if (!(a >= it.lo && b <= it.hi && a < b)) throw new Error('bords : ' + it.lo / 1000 + ' à ' + it.hi / 1000 + ' MHz, bas < haut');
      },
      write: (v) => { const it = EX[Math.floor(v / 1e10)]; return q(0x1A, 0x05, 0x01, bcd(it.n % 100), ...edgeBytes(Math.floor(v / 1e5) % 1e5), ...edgeBytes(v % 1e5)); } },
    // VBW du scope (27 1D 00 : 00 Narrow, 01 Wide)
    { id: 'scVbw', g: 'rx', label: 'VBW du scope', type: 'select', face: true, options: [[0, 'Narrow'], [1, 'Wide']], write: (v) => q(0x27, 0x1D, 0x00, v) },
    // Date (AAAAMMJJ, trop grande pour exSet) : réglage à part
    { id: 'exDate', g: 'vfo', label: 'Date du TRX', type: 'level', min: 20000101, max: 20991231, step: 1, face: true,
      check: (v) => { if (!exOk(EX[94], v)) throw new Error('date invalide'); }, write: (v) => q(0x1A, 0x05, 0x00, 0x94, ...exBytes(EX[94], v)) },
    // Écran MEMORY de la face avant : relit un canal mémoire (1A 00 : 0001 … 0099, 0100 = P1, 0101 = P2), sans rien changer sur le TRX
    { id: 'mcRead', g: 'vfo', label: 'Lecture canal mémoire', type: 'level', min: 1, max: 101, step: 1, face: true, write: (v) => q(0x1A, 0x00, bcd(Math.floor(v / 100)), bcd(v % 100)) }
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
      if (c.check) c.check(v);
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
    // Mémoires du manipulateur (1A 02 ch texte) : M1 … M8, texte ASCII (« * » = numéro de concours, « ^ » = signes liés)
    // Scope du TRX (27 00) : division 1 = mode (00 CENTER, 01 FIX) + 2 fréquences (centre et ±SPAN, ou bords) + hors plage ;
    // divisions 2 … 11 = morceaux de la courbe (475 points, 0 à 160 ; USB, « CI-V USB Port » = Unlink from [REMOTE])
    if (c === 0x27 && d[0] === 0x00 && d.length >= 4) {
      const div = unbcd(d[2]), max = unbcd(d[3]);
      if (div === 1) return d.length >= 16 ? { _scope: { div, max, mode: d[4], f0: freqValue(d, 5), f1: freqValue(d, 10), oor: d[15] ? 1 : 0 } } : { ok: true };
      return { _scope: { div, max, data: d.slice(4) } };
    }
    if (c === 0x27 && d[0] === 0x15 && d.length >= 7) { const i = SC_SPANS.indexOf(freqValue(d, 2)); return i >= 0 ? { scSpan: i } : { ok: true }; }
    if (c === 0x27 && d[0] === 0x17 && d.length >= 3) return { scHold: d[2] ? 1 : 0 };
    if (c === 0x27 && d[0] === 0x14 && d.length >= 3) return { scMode: d[2] <= 3 ? d[2] : 0 };
    if (c === 0x27 && d[0] === 0x1D && d.length >= 3) return { scVbw: d[2] ? 1 : 0 };
    if (c === 0x27 && d[0] === 0x19 && d.length >= 5) { const v = unbcd(d[2]) + unbcd(d[3]) / 100; return { scRef: Math.round((d[4] ? -v : v) * 2) / 2 }; }
    if (c === 0x27 && d[0] === 0x1A && d.length >= 3 && d[2] <= 2) return { scSpeed: d[2] };
    if (c === 0x27 && d[0] === 0x16 && d.length >= 3 && d[2] >= 1 && d[2] <= 4) return { scEdge: d[2] };
    if (c === 0x1A && d[0] === 0x02 && d.length >= 2 && d[1] >= 1 && d[1] <= 8) {
      return { ['km' + d[1]]: String.fromCharCode(...d.slice(2).filter((b) => b >= 0x20 && b < 0x7F)).slice(0, 70) };
    }
    // Canal mémoire (1A 00) : « fréquence|mode|nom », vide si le canal est libre (FF)
    if (c === 0x1A && d[0] === 0x00 && d.length >= 4) {
      const ch = unbcd(d[1]) * 100 + unbcd(d[2]);
      if (!(ch >= 1 && ch <= 101)) return { ok: true };
      if (d[3] === 0xFF || d.length < 12) return { ['mc' + ch]: '' };
      const f = freqValue(d, 4), m = parseMode([d[9], d[11] >> 4, d[10]], 0);
      const name = String.fromCharCode(...d.slice(18, 28).filter((b) => b >= 0x20 && b < 0x7F)).trim();
      return { ['mc' + ch]: f + '|' + (m.name || '') + '|' + name };
    }
    // Réglages de l'écran SET (1A 05 n° valeur) : valeur brute en texte (exN)
    if (c === 0x1A && d[0] === 0x05 && d.length >= 4) {
      const n = unbcd(d[1]) * 100 + unbcd(d[2]), it = EX[n];
      if (it) {
        const b = d.slice(3), t = it.type;
        let raw;
        if (t === 'pct' || t === 'nbw' || t === 'hex') raw = b.length >= 2 ? lvlValue(b, 0) : null;
        else if (t === 'hl') raw = b.length >= 2 ? unbcd(b[0]) * 100 + unbcd(b[1]) : null;
        else if (t === 'tbw') raw = (b[0] >> 4) * 10 + (b[0] & 0x0F);
        else if (t === 'date') raw = b.length >= 4 ? b.slice(0, 4).map((x) => String(unbcd(x)).padStart(2, '0')).join('') : null;
        else if (t === 'time') raw = b.length >= 2 ? String(unbcd(b[0])).padStart(2, '0') + String(unbcd(b[1])).padStart(2, '0') : null;
        else if (t === 'utc') raw = b.length >= 3 ? (unbcd(b[0]) * 60 + unbcd(b[1])) * (b[2] ? -1 : 1) : null;
        else if (t === 'edge') raw = b.length >= 6 ? edgeKHz(b, 0) + '-' + edgeKHz(b, 3) : null;
        else if (t === 'rgb') raw = b.length >= 6 ? [lvlValue(b, 0), lvlValue(b, 2), lvlValue(b, 4)].join(',') : null;
        else raw = unbcd(b[0]);
        return raw == null ? { ok: true } : { ['ex' + n]: String(raw) };
      }
    }
    if (c === 0x1A) return { ok: true }; // réglages 1A 05 (source de modulation de la phonie à distance…)
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
          else if ((d[0] === 0x00 || d[0] === 0x01) && (v.sel || 0) !== d[0]) { v.sel = d[0]; [v.freq, v.freqB, v.mode, v.modeB] = [v.freqB, v.freq, v.modeB, v.mode]; } // VFO A / B : 25 00 = celui en service
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
        } else if (c === 0x17) {
          // Manipulateur CW (simulateur) : texte joué en émission « par la radio », FF = arrêt
          if (d[0] === 0xFF) { clearTimeout(this.cwPlay); v.tx = 0; ok(); }
          else {
            const ms = Math.round(d.length * 10 * 1200 / (this.cwWpm || 22));
            setTimeout(() => { v.tx = 1; }, 150);
            clearTimeout(this.cwPlay);
            this.cwPlay = setTimeout(() => { v.tx = 0; }, 150 + ms);
            ok();
          }
        } else if (c === 0x28 && d[0] === 0x00 && d.length === 2) {
          // VOICE TX (simulateur) : 3 s d'émission, 00 = arrêt
          clearTimeout(this.vPlay);
          if (d[1]) { v.tx = 1; this.vPlay = setTimeout(() => { v.tx = 0; }, 3000); } else v.tx = 0;
          ok();
        } else if (c === 0x27 && (d[0] === 0x10 || d[0] === 0x11)) {
          // Scope (simulateur) : 27 11 01 = sortie de la courbe, 10 images par seconde
          if (d.length >= 2 && d[0] === 0x11) {
            clearInterval(this.scT);
            if (d[1]) this.scT = setInterval(() => this.scopeOut(), 100);
          }
          ok();
        } else if (c === 0x27 && d[0] === 0x19) {
          if (d.length === 2) { const a = Math.round(Math.abs(this.scRef || 0) * 10); r(0x19, 0x00, bcd(Math.floor(a / 10)), bcd((a % 10) * 10), (this.scRef || 0) < 0 ? 1 : 0); }
          else { this.scRef = (unbcd(d[2]) + unbcd(d[3]) / 100) * (d[4] ? -1 : 1); ok(); }
        } else if (c === 0x27 && d[0] === 0x1A) {
          if (d.length === 2) r(0x1A, 0x00, this.scSpeed != null ? this.scSpeed : 1); else { this.scSpeed = d[2]; ok(); }
        } else if (c === 0x27 && d[0] === 0x1D) {
          if (d.length === 2) r(0x1D, 0x00, this.scVbw || 0); else { this.scVbw = d[2]; ok(); }
        } else if (c === 0x27 && (d[0] === 0x14 || d[0] === 0x16)) {
          const k = d[0] === 0x14 ? 'scMode' : 'scEdge';
          if (d.length === 2) r(d[0], 0x00, this[k] != null ? this[k] : (k === 'scEdge' ? 1 : 0)); else { this[k] = d[2]; ok(); }
        } else if (c === 0x27 && (d[0] === 0x15 || d[0] === 0x17)) {
          // Scope (simulateur) : SPAN et HOLD
          if (d[0] === 0x15) { if (d.length === 2) r(0x15, 0x00, ...freqBytes(this.scSpan || 25000)); else { this.scSpan = freqValue(d, 2); ok(); } }
          else if (d.length === 2) r(0x17, 0x00, this.scHold || 0); else { this.scHold = d[2]; ok(); }
        } else if (c === 0x0E) {
          ok(); // balayage (simulateur) : accepté, sans effet
        } else if (c === 0x1A && d[0] === 0x05 && d.length >= 3 && EX[unbcd(d[1]) * 100 + unbcd(d[2])] && !(d[1] === 0x00 && d[2] === 0x66)) {
          // Réglages SET (simulateur) : valeurs d'usine approximatives, gardées si on les change
          const n = unbcd(d[1]) * 100 + unbcd(d[2]), it = EX[n];
          this.ex = this.ex || {};
          const def = { pct: 128, nbw: 128, hex: 0, hl: 525, tbw: 13, tone: 5, nbd: 4, voxd: 2, date: '20261104', time: '1430', utc: 60, rgb: '172,191,191', edge: it.lo + '-' + Math.min(it.hi, it.lo + 350) };
          if (d.length === 3) {
            const raw = this.ex[n] != null ? this.ex[n] : n === 74 ? 1 : n === 75 ? 1 : n === 153 ? 1 : n === 152 ? '51,153,255' : n === 154 ? '0,255,0' : n === 66 ? 0 : n === 67 ? 3 : def[it.type] != null ? def[it.type] : 0;
            r(0x05, d[1], d[2], ...exBytes(it, raw));
          } else {
            const b = d.slice(3);
            this.ex[n] = it.type === 'edge' ? edgeKHz(b, 0) + '-' + edgeKHz(b, 3) : it.type === 'pct' || it.type === 'nbw' || it.type === 'hex' ? lvlValue(b, 0) : it.type === 'hl' ? unbcd(b[0]) * 100 + unbcd(b[1]) : it.type === 'tbw' ? (b[0] >> 4) * 10 + (b[0] & 15)
              : it.type === 'date' ? b.map((x) => String(unbcd(x)).padStart(2, '0')).join('') : it.type === 'time' ? String(unbcd(b[0])).padStart(2, '0') + String(unbcd(b[1])).padStart(2, '0')
              : it.type === 'utc' ? (unbcd(b[0]) * 60 + unbcd(b[1])) * (b[2] ? -1 : 1) : it.type === 'rgb' ? [lvlValue(b, 0), lvlValue(b, 2), lvlValue(b, 4)].join(',') : unbcd(b[0]);
            ok();
          }
        } else if (c === 0x1A && d[0] === 0x00 && d.length === 3) {
          // Canaux mémoire (simulateur) : 1 et 2 remplis, les autres libres
          const ch = unbcd(d[1]) * 100 + unbcd(d[2]);
          const MC = { 1: [7074000, 0x01, 1, 'FT8 40M'], 2: [14070000, 0x04, 0, 'PSK'], 100: [500000, 0x01, 0, ''], 101: [29999990, 0x01, 0, ''] };
          const m = MC[ch];
          if (!m) r(0x00, d[1], d[2], 0xFF);
          else r(0x00, d[1], d[2], 0x00, ...freqBytes(m[0]), m[1], 0x01, m[2] << 4, 0, 0x08, 0x85, 0, 0x08, 0x85, ...Array.from(m[3].padEnd(10), (x) => x.charCodeAt(0)));
        } else if (c === 0x1A && d[0] === 0x02 && d.length === 2) {
          // Mémoires du manipulateur (simulateur), comme celles d'un IC-7300 réglé d'usine
          const KM = ['CQ CQ DE ON5VL ON5VL K', 'UR 5NN*', 'CFM TU', 'QRZ?', '', '', '', ''];
          r(0x02, d[1], ...Array.from(KM[d[1] - 1] || '', (ch) => ch.charCodeAt(0)));
        } else if (c === 0x1A && d[0] === 0x05 && d[1] === 0x00 && d[2] === 0x66) {
          // DATA OFF MOD (simulateur) : 00 MIC au départ
          if (d.length === 3) r(0x05, 0x00, 0x66, this.mod66 || 0); else { this.mod66 = d[3]; (this.exLog = this.exLog || []).push('MOD' + d[3] + (v.tx ? '@TX' : '')); ok(); }
        } else if (c === 0x14 && d[0] === 0x0C) {
          if (d.length === 1) r(0x0C, ...lvlBytes(this.cwRaw != null ? this.cwRaw : 96)); else { this.cwRaw = lvlValue(d, 1); this.cwWpm = 6 + this.cwRaw * 42 / 255; ok(); }
        } else if (c === 0x16 && d[0] === 0x47) {
          if (d.length === 1) r(0x47, this.bk || 0); else { this.bk = d[1]; ok(); }
        }
        else if (c === 0x14 && d[0] === 0x0A) {
          if (d.length === 1) r(0x0A, ...lvlBytes(v.power)); else { v.power = lvlValue(d, 1); ok(); }
        } else if (SIMPLE_MAP[c * 256 + d[0]]) {
          const s = SIMPLE_MAP[c * 256 + d[0]];
          const k = c * 256 + d[0];
          if (d.length === 1) r(d[0], ...(s[3] === 'l' ? lvlBytes(this.lv[k]) : [this.lv[k]]));
          else { this.lv[k] = s[3] === 'l' ? lvlValue(d, 1) : d[1]; ok(); }
        } else ng();
      }
      this.flush(out);
    }
    // Simulateur : une image du scope (11 trames), courbe de bruit avec quelques signaux autour du VFO
    scopeOut() {
      const v = this.v, out = [], span = this.scSpan || 25000, fix = (this.scMode || 0) & 1;
      const f0 = fix ? Math.floor(v.freq / 1e6) * 1e6 : v.freq, f1 = fix ? f0 + 350000 : span;
      out.push([CTRL, ADDR, 0x27, 0x00, 0x00, 0x01, 0x11, this.scMode || 0, ...freqBytes(f0), ...freqBytes(f1), 0x00]); // mode 0 – 3 comme le TRX
      this.t2 = (this.t2 || 0) + 1;
      const lo = fix ? f0 : v.freq - span, hi = fix ? f1 : v.freq + span;
      const pts = [];
      for (let i = 0; i < 475; i++) {
        const f = lo + (hi - lo) * i / 474;
        let a = 18 + Math.random() * 14;
        for (const [sf, w, p] of [[14074000, 1500, 70], [14070500, 300, 55], [14255000, 2800, 60], [7074000, 1500, 70], [14080000 + 1000 * Math.sin(this.t2 / 20), 200, 50]]) a = Math.max(a, p * Math.exp(-(((f - sf) / w) ** 2)) + Math.random() * 6);
        pts.push(Math.max(0, Math.min(160, Math.round(a))));
      }
      for (let k = 0; k < 10; k++) out.push([CTRL, ADDR, 0x27, 0x00, 0x00, bcd(k + 2), 0x11, ...pts.slice(k * 48, k === 9 ? 475 : (k + 1) * 48)]);
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
    FAST, SLOW, SLOW_PER_TICK, TXMETERS, POLL_MS, FRAME_GAP_MS, readFor, TX_SOURCE_UNKNOWN: true, STATE_KEYS, STR_KEYS, observe,
    GROUPS, CONTROLS, CONTROL, validate, SC_SPANS, EX, EX_MENUS, exFmt, exOk, exCode, EDGE_BANDS, widthTable: () => null, cmdFreq, cmdFreqB, cmdMode, cmdPower, cmdPtt, parse, Splitter,
    smeterLabel, swrValue, vdValue, idValue, poFrac,
    bwText: (r) => (r.fil ? 'FIL' + r.fil : '—'),
    // Scope du TRX vers la page Station : scope en service et sortie de la courbe par le CI-V (27 10 01, 27 11 01) ; arrêt : 27 11 00
    SCOPE: { on: [q(0x27, 0x10, 0x01), q(0x27, 0x11, 0x01)], off: [q(0x27, 0x11, 0x00)], points: 475, max: 160 },
    // Émission CW par le manipulateur interne (CI-V 17 : 30 caractères au plus par trame, FF = arrêt) ;
    // vitesse 14 0C (0–255 = 6–48 mots/min), break-in semi (16 47 01) pour que le TRX émette tout seul
    CW: {
      max: 30,
      wpmMax: 48, // 14 0C : 6–48 mots/min
      setup: (wpm) => [q(0x14, 0x0C, ...lvlBytes(Math.round((Math.max(6, Math.min(48, wpm)) - 6) * 255 / 42))), q(0x16, 0x47, 0x01)],
      mem: null, read: null, alt: [],
      play: null, text: (t) => q(0x17, ...Array.from(t, (c) => c.charCodeAt(0))),
      stop: () => [q(0x17, 0xFF)]
    },
    // Phonie à distance : « DATA OFF MOD » (1A 05 00 66 : 00 MIC, 01 ACC, 02 MIC/ACC, 03 USB) mis sur USB le temps de
    // l'émission en LSB / USB / AM / FM, puis remis comme avant (le micro du club refonctionne)
    VOICE: {
      modes: ['LSB', 'USB', 'AM', 'FM'],
      steps(mode) {
        if (this.modes.indexOf(mode) < 0) return null;
        return [{ label: 'DATA OFF MOD', read: q(0x1A, 0x05, 0x00, 0x66),
          match: (t) => (t && typeof t !== 'string' && t.length >= 7 && t[1] === ADDR && t[2] === 0x1A && t[3] === 0x05 && t[4] === 0x00 && t[5] === 0x66 ? t[6] : null),
          set: q(0x1A, 0x05, 0x00, 0x66, 0x03), restore: (p) => q(0x1A, 0x05, 0x00, 0x66, p) }];
      }
    },
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
