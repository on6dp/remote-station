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
  const signed4 = (v) => (Number(v) < 0 ? '-' : '+') + pad(v, 4);

  // Puissance : la réponse PC indique la tête. P1 = 1 tête Field (0,5–10 W, dixièmes sous 10 W : "PC10.5;"),
  // P1 = 2 ampli SPA-1 (5–100 W : "PC2025;").
  const RANGE = { '1': [0.5, 10], '2': [5, 100] };
  // SQL TYPE (CT) : manuel CAT FTX-1
  const SQLT = [[0, 'OFF'], [1, 'ENC'], [2, 'TSQ'], [3, 'DCS'], [4, 'PR FREQ'], [5, 'REV TONE']];

  // ------------------------------------------------------------ menus du TRX (FUNC → … SETTING de la face avant)
  // Manuel CAT FTX-1, Table 3 (commande EX P1P2P3 + valeur). Chaque réglage : [n°, nom, type] ; type L([libellés], base) = liste,
  // C([[code, libellé]…]) = liste à codes, N(min, max, pas, unité, diviseur, signe) = nombre, T = texte (lecture seule).
  // Réservés aux administrateurs (ON6DP, ON4LUC) : contrôle du serveur. ro : lu seulement (liaison CAT, phonie et CW à distance,
  // puissances maximales, émission, étalonnage, extinction… : au club).
  const MENU = (() => {
    const L = (labels, base) => ({ k: 'l', labels, base: base || 0 });
    const C = (pairs) => ({ k: 'l', codes: pairs.map((p) => p[0]), labels: pairs.map((p) => p[1]) });
    const N = (min, max, step, unit, div, sign) => ({ k: 'n', min, max, step: step || 1, unit: unit || '', div: div || 1, sign: !!sign });
    // Menus réservés aux administrateurs (ON6DP, ON4LUC) : ils peuvent tout régler, sauf ce qui casserait la station à distance
    // (LOCK : liaison CAT-1 / CAT-3, phonie et CW à distance, égaliseur des profils, extinction automatique du TRX).
    // RO garde l'ancienne marque « réglage du club » mais reste réglable par un administrateur.
    const LOCK = (d, why) => Object.assign({}, d, { ro: why || 'au club seulement' });
    const RO = (d) => d;
    const T = { k: 't', ro: 'texte : au club' };
    const OFFON = L(['OFF', 'ON']), NR = L(['NOR', 'REV']);
    const TONE = N(-20, 10), AGC = N(20, 4000, 20, 'msec'), LVL = N(0, 100);
    const LCUT = C([[0, 'OFF']].concat(Array.from({ length: 19 }, (_, i) => [i + 1, (100 + i * 50) + 'Hz'])));
    const HCUT = C([[0, 'OFF']].concat(Array.from({ length: 67 }, (_, i) => [i + 1, (700 + i * 50) + 'Hz'])));
    const SLOPE = L(['6dB/oct', '18dB/oct']);
    const BPF = L(['50-3050Hz', '100-2900Hz', '200-2800Hz', '300-2700Hz', '400-2600Hz']);
    const MOD = LOCK(L(['MIC', 'USB', 'Bluetooth', 'AUTO']), 'source de modulation : gérée par la phonie à distance');
    const MODG = LOCK(LVL, 'niveau de l’entrée USB : réglé pour la phonie à distance');
    const RPTT = LOCK(L(['OFF', 'RTS', 'DTR']), 'commande d’émission de la liaison (CW à distance)');
    const NARS = L([300, 400, 600, 850, 1100, 1200, 1500, 1650, 1800, 1950, 2100, 2250, 2400, 2450, 2500, 2600, 2700, 2800, 2900, 3000, 3200, 3500, 4000].map((x) => x + 'Hz'));
    const NARD = L([50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 800, 1200, 1400, 1700, 2000, 2400, 3000, 3200, 3500, 4000].map((x) => x + 'Hz'));
    const RATE = LOCK(L(['4800bps', '9600bps', '19200bps', '38400bps', '115200bps']), 'liaison CAT : la changer couperait la station');
    const TOT = LOCK(L(['10msec', '100msec', '1000msec', '3000msec']), 'liaison CAT');
    const STOPB = LOCK(L(['1bit', '2bit']), 'liaison CAT');
    const MAXP = (a, b) => RO(N(a, b, 1, 'W'), 'puissance maximale : réglée par le club');
    const MAXP10 = (a, b) => RO(N(a, b, 1, 'W', 10), 'puissance maximale : réglée par le club');
    const TUNT = L(['INT', 'INT(FAST)', 'EXT', 'ATAS']);
    const DSTEP = L(['5Hz', '10Hz', '20Hz']);
    const EQF = [C([[0, 'OFF']].concat(Array.from({ length: 7 }, (_, i) => [i + 1, (100 + i * 100) + 'Hz']))),
      C([[0, 'OFF']].concat(Array.from({ length: 9 }, (_, i) => [i + 1, (700 + i * 100) + 'Hz']))),
      C([[0, 'OFF']].concat(Array.from({ length: 18 }, (_, i) => [i + 1, (1500 + i * 100) + 'Hz'])))];
    const eqRo = (d) => LOCK(d, 'réglé par EQUALIZER TRX (Profil de …)');
    const eq = (a, p) => [0, 1, 2].flatMap((b) => [[a + b * 3, p + 'PRMTRC EQ' + (b + 1) + ' FREQ', eqRo(EQF[b])], [a + b * 3 + 1, p + 'PRMTRC EQ' + (b + 1) + ' LEVEL', eqRo(TONE)], [a + b * 3 + 2, p + 'PRMTRC EQ' + (b + 1) + ' BWTH', eqRo(N(0, 10))]]);
    const MICK = L(['LOCK', 'QMB', '>/<', 'V/M', 'TUNER', 'VOX/MOX', 'MODE', 'ZIN/SPOT', 'SPLIT', 'FINE', 'NAR', 'NB', 'DNR', 'FREQ UP', 'FREQ DOWN', 'BAND UP', 'BAND DOWN', 'ATT', 'IPO', 'DNF', 'AGC']);
    // CTCSS (Table 1) et DCS (Table 2) du manuel CAT ; mémoires DTMF : texte, relu, modifié par l'écran DTMF (FUNC → DTMF)
    const CTCSS = [67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8, 118.8, 123.0, 127.3,
      131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 159.8, 162.2, 165.5, 167.9, 171.3, 173.8, 177.3, 179.9, 183.5, 186.2, 189.9, 192.8, 196.6, 199.5,
      203.5, 206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8, 250.3, 254.1];
    const DCS = ('023 025 026 031 032 036 043 047 051 053 054 065 071 072 073 074 114 115 116 122 125 131 132 134 143 145 152 155 156 162 165 172 174 ' +
      '205 212 223 225 226 243 244 245 246 251 252 255 261 263 265 266 271 274 306 311 315 325 331 332 343 346 351 356 364 365 371 411 412 413 423 431 432 ' +
      '445 446 452 454 455 462 464 465 466 503 506 516 523 526 532 546 565 606 612 624 627 631 632 654 662 664 703 712 723 731 732 734 743 754').split(' ');
    const DTM = { k: 't', read: true, ro: 'se règle dans l’écran DTMF (FUNC → DTMF)' };
    const TXT = { k: 't', read: true, ro: 'texte : à changer au TRX' }; // texte relu sur le TRX (indicatif APRS, messages…)
    // Symboles APRS (manuel CAT, Table 4) : P4 = les 2 caractères du symbole (« /> » = Car)
    const SYMS = [["/#", "DIGI"], ["/&", "HF Gateway"], ["/'", "Small Aircraft"], ["/-", "House QTH (VHF)"], ["/.", "X"], ["/0", "Circle"], ["/:", "Fire"], ["/;", "Campground"], ["/<", "Motorcycle"], ["/=", "Railroad Engine"], ["/>", "Car"], ["/C", "Canoe"], ["/E", "Eyeball"], ["/I", "TCP/IP"], ["/K", "School"], ["/O", "Balloon"], ["/P", "Police"], ["/R", "REC.Vehicle"], ["/T", "SSTV"], ["/U", "Bus"], ["/V", "ATV"], ["/W", "NWS Site"], ["/X", "Helicopter"], ["/Y", "Yacht(sailboat)"], ["/[", "Human/Person"], ["/\\", "Triangle(DF)"], ["/^", "Large Aircraft"], ["/_", "Weather Station"], ["/a", "Ambulance"], ["/b", "Bycycle"], ["/f", "Fire Truck"], ["/g", "Glider"], ["/j", "Jeep"], ["/k", "School"], ["/m", "Mic-E Repeater"], ["/r", "REC.Vehicle"], ["/s", "Ship(powerboat)"], ["/u", "Bus"], ["/v", "ATV"], ["/y", "Yacht(sailboat)"], ["\\#", "Overlay DIGI"], ["\\&", "Overlay Gate"], ["\\-", "House (HF)"], ["\\.", "Ambiguous"], ["\\0", "Circle"], ["\\;", "Park/Picnic Area"], ["\\=", "APRStt"], ["\\>", "Overlayed Car"], ["\\A", "APRStt"], ["\\K", "Kenwood HT"], ["\\W", "NWS Site"], ["\\Y", "Radios & Devices"], ["\\^", "Aircraft"], ["\\_", "WX Site"], ["\\m", "Value Signpost"], ["\\n", "Overlay Triangle"], ["\\s", "Overlayed Ship"], ["\\u", "Overlayed Truck"], ["\\v", "Overlayed Van"], ["\\x", "Obstruction"]];
    const SYM = { k: 's', codes: SYMS.map((x) => x[0]), labels: SYMS.map((x) => x[0] + ' (' + x[1] + ')') };
    const SAVER = L(['OFF', '1min', '2min', '5min', '15min', '30min', '60min']);
    // Début commun des modes (réception) : tonalité, AGC, filtres
    const rx = [[1, 'AF TREBLE GAIN', TONE], [2, 'AF MIDDLE TONE GAIN', TONE], [3, 'AF BASS GAIN', TONE], [4, 'AGC FAST DELAY', AGC], [5, 'AGC MID DELAY', AGC],
      [6, 'AGC SLOW DELAY', AGC], [7, 'LCUT FREQ', LCUT], [8, 'LCUT SLOPE', SLOPE], [9, 'HCUT FREQ', HCUT], [10, 'HCUT SLOPE', SLOPE], [11, 'USB OUT LEVEL', LVL]];
    const G = (id, group, name, items, pfx) => ({ id, group, name, items: items.map(([n, label, d]) => ({ id: (pfx || id) + String(n).padStart(2, '0'), n, label, d })) });
    const EXT = 'EXTENSION SETTING : au club seulement';
    const NOCAT = { k: 't', ro: 'pas de commande CAT : au TRX' };
    const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const DTP = (src, a, b, names) => ({ k: 'dt', src, a, b, names, ro: 'avec le bouton « Mettre à l’heure de votre PC »' });
    return [
      G('0101', 'RADIO SETTING', 'MODE SSB', rx.concat([[12, 'TX BPF SEL', BPF], [13, 'MOD SOURCE', MOD], [14, 'USB MOD GAIN', MODG], [15, 'RPTT SELECT', RPTT],
        [16, 'NAR WIDTH', NARS], [17, 'CW AUTO MODE', L(['OFF', '50MHz', 'ON'])]])),
      G('0102', 'RADIO SETTING', 'MODE AM', rx.concat([[12, 'TX BPF SEL', BPF], [13, 'MOD SOURCE', MOD], [14, 'USB MOD GAIN', MODG], [15, 'RPTT SELECT', RPTT]])),
      G('0103', 'RADIO SETTING', 'MODE FM', rx.concat([[12, 'MOD SOURCE', MOD], [13, 'USB MOD GAIN', MODG], [14, 'RPTT SELECT', RPTT],
        [15, 'RPT SHIFT', L(['-', 'SIMPLEX', '+', 'ARS'])], [16, 'RPT SFT FREQ(28MHz)', N(0, 1000, 10, 'kHz')], [17, 'RPT SFT FREQ(50MHz)', N(0, 4000, 10, 'kHz')],
        // 144 / 430 MHz : pas de 50 kHz (« 0012 » = 0.60MHz, « 0152 » = 7.60MHz, vérifié au club). Le manuel écrit « 0 - 100MHz
        // (P4 = 0000 - 0100) » : 0100 est faux, la valeur va au-delà ; 0 à 2000 (100 MHz) permis, le TRX refuse le reste (valeur relue)
        [18, 'RPT SFT FREQ(144MHz)', Object.assign(N(0, 2000), { fmt: (v) => (v * 0.05).toFixed(2) + 'MHz' })],
        [19, 'RPT SFT FREQ(430MHz)', Object.assign(N(0, 2000), { fmt: (v) => (v * 0.05).toFixed(2) + 'MHz' })],
        [20, 'SQL TYPE', L(['OFF', 'ENC', 'TSQ', 'DCS', 'PR FREQ', 'REV TONE'])], [21, 'TONE FREQ', L(CTCSS.map((x) => x.toFixed(1) + 'Hz'))],
        [22, 'DCS CODE', L(DCS)], [23, 'DCS RX REVERS', L(['NORMAL', 'REVERS', 'BOTH'])],
        [24, 'DCS TX REVERS', L(['NORMAL', 'REVERS'])], [25, 'PR FREQ', N(300, 3000, 100, 'Hz')], [26, 'DTMF DELAY', L(['50ms', '250ms', '450ms', '750ms', '1000ms'])],
        [27, 'DTMF SPEED', L(['50ms', '100ms'])]].concat(Array.from({ length: 10 }, (_, i) => [28 + i, 'DTMF MEMORY' + (i + 1), DTM])))),
      G('0104', 'RADIO SETTING', 'MODE DATA', rx.concat([[12, 'TX BPF SEL', BPF], [13, 'MOD SOURCE', MOD], [14, 'USB MOD GAIN', MODG], [15, 'RPTT SELECT', RPTT],
        [16, 'NAR WIDTH', NARD], [17, 'PSK TONE', L(['1000Hz', '1500Hz', '2000Hz'])], [18, 'DATA SHIFT (SSB)', N(0, 3000, 10, 'Hz')]])),
      G('0105', 'RADIO SETTING', 'MODE RTTY', rx.concat([[12, 'RPTT SELECT', RPTT], [13, 'NAR WIDTH', NARD], [14, 'MARK FREQUENCY', L(['1275Hz', '2125Hz'])],
        [15, 'SHIFT FREQUENCY', L(['170Hz', '200Hz', '425Hz', '850Hz'])], [16, 'POLARITY TX', NR]])),
      G('0106', 'RADIO SETTING', 'DIGITAL', [[1, 'DIGITAL POPUP', C([[0, 'OFF']].concat(Array.from({ length: 59 }, (_, i) => [i + 1, (i + 2) + 'sec']), [[60, 'CONTINUE']]))],
        [2, 'LOCATION SERVICE', OFFON], [3, 'STANDBY BEEP', OFFON], [4, 'DP-ID LIST', { k: 't', ro: 'pas de commande CAT : au TRX' }],
        [5, 'RADIO ID', { k: 't', ro: 'pas de commande CAT : au TRX' }]]),
      // WIRES-X (firmware récent) : absent du manuel CAT 2508-C → aucune commande envoyée, valeurs à lire au TRX
      G('WX', 'RADIO SETTING', 'WIRES-X', [[1, 'PRESET SEARCH', NOCAT], [2, 'VHF PRESET FREQ', NOCAT], [3, 'UHF PRESET FREQ', NOCAT],
        [4, 'WIRES-X DG-ID', NOCAT], [5, 'SEARCH SETUP', NOCAT], [6, 'Node Mode', NOCAT]]),
      G('0201', 'CW SETTING', 'MODE CW', rx.concat([[12, 'RPTT SELECT', RPTT], [13, 'NAR WIDTH', NARD], [14, 'PC KEYING', LOCK(L(['OFF', 'RTS', 'DTR']), 'utilisé par la CW à distance')],
        [15, 'CW BK-IN TYPE', L(['SEMI', 'FULL'])], [16, 'CW FREQ DISPLAY', L(['DIRECT FREQ', 'PITCH OFFSET'])], [17, 'QSK DELAY TIME', L(['15msec', '20msec', '25msec', '30msec'])],
        [18, 'CW INDICATOR', OFFON]])),
      G('0202', 'CW SETTING', 'KEYER', [[1, 'KEYER TYPE', L(['OFF', 'BUG', 'ELEKEY-A', 'ELEKEY-B', 'ELEKEY-Y', 'ACS'])], [2, 'KEYER DOT/DASH', NR],
        [3, 'CW WEIGHT', N(25, 45, 1, '', 10)], [4, 'NUMBER STYLE', L(['1290', 'AUNO', 'AUNT', 'A2NO', 'A2NT', '12NO', '12NT'])], [5, 'CONTEST NUMBER', N(1, 9999)],
        [6, 'CW MEMORY 1', L(['TEXT', 'MESSAGE'])], [7, 'CW MEMORY 2', L(['TEXT', 'MESSAGE'])], [8, 'CW MEMORY 3', L(['TEXT', 'MESSAGE'])], [9, 'CW MEMORY 4', L(['TEXT', 'MESSAGE'])],
        [10, 'CW MEMORY 5', LOCK(L(['TEXT', 'MESSAGE']), 'utilisée par la CW au clavier du dashboard')], [11, 'REPEAT INTERVAL', N(1, 60, 1, 'sec')]]),
      G('0301', 'OPERATION SETTING', 'GENERAL', [[1, 'BEEP LEVEL', LVL], [2, 'RF/SQL VR', L(['RF', 'SQL', 'AUTO'])] /* 2 : « SQL (FM MODE only) » dans le manuel, AUTO sur l'écran du TRX */,
        [3, 'TUN/LIN PORT SELECT', RO(L(['OPTION', 'BAND DATA', 'CAT-3', 'GPO']) /* libellés de l'écran du TRX (manuel : EXT-TUNER, LINEAR…) */, 'câblage de la station (ampli SPA-1, tuner)')],
        [4, 'TUNER SELECT', RO(L(['OPTION', 'ATAS']), 'câblage de la station (ampli SPA-1, tuner)')] /* écran du TRX : OPTION, ATAS (manuel : INT, INT(FAST), EXT, ATAS) */, [5, 'CAT-1 RATE', RATE], [6, 'CAT-1 TIME OUT TIMER', TOT], [7, 'CAT-1 CAT-3 STOP BIT', STOPB],
        // CAT-2 (port « Standard COM ») : la station du club pilote par CAT-1 seulement → réglable (administrateurs)
        [8, 'CAT-2 RATE', L(['4800bps', '9600bps', '19200bps', '38400bps', '115200bps'])], [9, 'CAT-2 TIME OUT TIMER', L(['10msec', '100msec', '1000msec', '3000msec'])], [10, 'CAT-3 RATE', RATE], [11, 'CAT-3 TIME OUT TIMER', TOT],
        [12, 'TX TIME OUT TIMER', C([[0, 'OFF']].concat(Array.from({ length: 30 }, (_, i) => [i + 1, (i + 1) + 'min'])))],
        [13, 'REF FREQ ADJ', RO(N(-25, 25, 1, '', 1, true), 'étalonnage : au club')], [14, 'CHARGE CONTROL', RO(OFFON, 'alimentation : au club')],
        [15, 'SUB BAND MUTE', OFFON], [16, 'SPEAKER SELECT', L(['Auto', 'INT', 'BOTH'])], [17, 'DITHER', OFFON]]),
      G('0302', 'OPERATION SETTING', 'BAND-SCAN', [[1, 'QMB CH', L(['5ch', '10ch'])], [2, 'BAND STACK', OFFON], [3, 'BAND EDGE', OFFON],
        [4, 'SCAN RESUME', L(['BUSY', 'HOLD', '1sec', '3sec', '5sec'])]]),
      G('0303', 'OPERATION SETTING', 'RX-DSP', [[1, 'IF NOTCH WIDTH', L(['NARROW', 'WIDE'])], [2, 'NB REJECTION', L(['LOW', 'MID', 'HIGH'])],
        [3, 'NB WIDTH', L(['NARROW', 'MEDIUM', 'WIDE'])], [4, 'APF WIDTH', L(['NARROW', 'MEDIUM', 'WIDE'])], [5, 'CONTOUR LEVEL', N(-40, 20, 1, 'dB')], [6, 'CONTOUR WIDTH', N(1, 11)]]),
      G('0304', 'OPERATION SETTING', 'TX AUDIO', [[1, 'AMC RELEASE TIME', L(['FAST', 'MID', 'SLOW'])]].concat(eq(2, ''), eq(11, 'P '))),
      // TX GENERAL = tête Field seule (0,5 à 10 W) : valeurs en dixièmes de watt (« 060 » = 6.0W sur batterie, « 100 » = 10.0W en HF, vérifié au club)
      G('0305', 'OPERATION SETTING', 'TX GENERAL', [[1, 'MAX POWER (BAT)', MAXP10(5, 60)], [2, 'QRP MODE', RO(OFFON, 'puissance : réglée par le club')],
        [3, 'HF MAX POWER', MAXP10(5, 100)], [4, '50M MAX POWER', MAXP10(5, 100)], [5, '70M MAX POWER', MAXP10(5, 60)], [6, '144M MAX POWER', MAXP10(5, 100)],
        [7, '430M MAX POWER', MAXP10(5, 100)], [8, 'AM HF/50 MAX POWER', MAXP10(5, 25)], [9, 'AM V/U MAX POWER', MAXP10(5, 25)],
        [10, 'VOX SELECT', RO(L(['MIC', 'USB', 'Bluetooth']), 'pas de VOX à distance')], [11, 'EMERGENCY FREQ TX', RO(OFFON, 'au club')],
        [12, 'TX INHIBIT', RO(OFFON, 'émission : au club')], [13, 'METER DETECTOR', L(['AVERAGE', 'PEAK'])]]),
      G('0306', 'OPERATION SETTING', 'KEY/DIAL', [[1, 'SSB/CW DIAL STEP', DSTEP], [2, 'RTTY/PSK DIAL STEP', DSTEP],
        [3, 'FM DIAL STEP', L(['5kHz', '6.25kHz', '10kHz', '12.5kHz', '20kHz', '25kHz', 'Auto'])], [4, 'CH STEP', L(['1kHz', '2.5kHz', '5kHz', '10kHz'])],
        [5, 'AM CH STEP', L(['2.5kHz', '5kHz', '9kHz', '10kHz', '12.5kHz', '25kHz'])], [6, 'FM CH STEP', L(['5kHz', '6.25kHz', '10kHz', '12.5kHz', '20kHz', '25kHz'])],
        [7, 'MAIN STEPS PER REV.', L(['50', '100', '200'])], [8, 'MIC P1', MICK], [9, 'MIC P2', MICK], [10, 'MIC P3', MICK], [11, 'MIC P4', MICK],
        [12, 'MIC UP', MICK], [13, 'MIC DOWN', MICK], [14, 'MIC SCAN', OFFON]]),
      G('0307', 'OPERATION SETTING', 'OPTION', [[1, 'TUNER TYPE SEL ANT1', RO(TUNT, 'câblage de la station (tuner)')], [2, 'TUNER TYPE SEL ANT2', RO(TUNT, 'câblage de la station (tuner)')],
        [3, 'ANT2 OPERATION', RO(L(['TRX', 'TX-ANT1, RX-ANT2', 'TRX-ANT1, RX-ANT2']), 'câblage des antennes : au club')], [4, 'HF ANT SELECT', L(['ANT1', 'ANT2'])],
        [5, 'HF MAX POWER', MAXP(5, 100)], [6, '50M MAX POWER', MAXP(5, 100)], [7, '70M MAX POWER', MAXP(5, 50)], [8, '144M MAX POWER', MAXP(5, 50)],
        [9, '430M MAX POWER', MAXP(5, 50)], [10, 'AM MAX POWER', MAXP(5, 25)], [11, 'AM V/U MAX POWER', MAXP(5, 13)], [12, 'GPS', OFFON], [13, 'GPS PINNING', OFFON],
        [14, 'GPS BAUDRATE', RO(L(['4800bps', '9600bps', '19200bps', '38400bps', '115200bps']), 'liaison du GPS : au club')]]),
      G('0401', 'DISPLAY SETTING', 'DISPLAY', [[1, 'MY CALL', T], [2, 'MY CALL TIME', L(['OFF', '1sec', '2sec', '3sec', '4sec', '5sec'])], [3, 'POP-UP TIME', L(['FAST', 'MID', 'SLOW'])],
        [4, 'SCREEN SAVER', SAVER], [5, 'SCREEN SAVER(BAT)', SAVER], [6, 'SAVER TYPE', L(['Logo', 'DIMMER', 'DISP OFF'])],
        [7, 'AUTO POWER OFF', LOCK(C([[0, 'OFF']].concat(Array.from({ length: 24 }, (_, i) => [i + 1, ((i + 1) / 2) + 'h']))), 'éteindrait le TRX : au club')], [8, 'LED DIMMER', N(0, 20)]]),
      G('0402', 'DISPLAY SETTING', 'UNIT', [[1, 'POSITION UNIT', L(['dd°MM.mm\'', 'dd°mm\'ss"'])], [2, 'DISTANCE UNIT', L(['km', 'mile'])],
        [3, 'SPEED UNIT', C([[0, 'km/h'], [1, 'knot'], [3, 'mph']])], [4, 'ALTITUDE UNIT', L(['m', 'ft'])], [5, 'TEMP UNIT', L(['°C', '°F'])], [6, 'RAIN UNIT', L(['mm', 'INCH'])],
        [7, 'WIND UNIT', C([[0, 'm/s'], [2, 'mph']])]]),
      G('0403', 'DISPLAY SETTING', 'SCOPE', [[1, 'RBW', L(['HIGH', 'MID', 'LOW'])], [2, 'SCOPE CTR', L(['FILTER', 'CARRIER'])], [3, '2D DISP SENSITIVITY', L(['NORMAL', 'HI'])],
        [4, '3DSS DISP SENSITIVITY', L(['NORMAL', 'HI'])], [5, 'AVERAGE', L(['OFF', '2', '4', '8'])]]),
      G('0404', 'DISPLAY SETTING', 'VFO IND COLOR', [[1, 'VMI COLOR VFO', L(['BLUE', 'GREEN', 'WHITE', 'NONE'])], [2, 'VMI COLOR MEMORY', L(['BLUE', 'GREEN', 'WHITE', 'NONE'])],
        [3, 'VMI COLOR CLAR', L(['RED', 'NONE'])]]),
      // EXTENSION SETTING : tout en lecture seule ou au club (date, position, carte SD, version, étalonnage, remise à zéro)
      G('0501', 'EXTENSION SETTING', 'DATE&TIME', [[1, 'TIME ZONE', RO(Object.assign(N(-120, 140, 5), { fmt: (v) => (v / 10).toFixed(1) }), EXT)],
        // DAY à MINUTE : pas de menu EX, mais la commande DT (DT0 date, DT1 heure locale) — lus, et mis à l'heure du PC par un bouton
        [2, 'DAY', DTP('DT0', 6, 8)], [3, 'MONTH', DTP('DT0', 4, 6, MON)], [4, 'YEAR', DTP('DT0', 0, 4)], [5, 'HOUR', DTP('DT1', 0, 2)], [6, 'MINUTE', DTP('DT1', 2, 4)], [7, 'GPS TIME SET', RO(L(['AUTO', 'MANUAL']), EXT)]]),
      G('0501P', 'EXTENSION SETTING', 'MY POSITION', [[8, 'MY POSITION', RO(L(['GPS', 'MANUAL']), EXT)], [9, 'MY POSITION LATITUDE', NOCAT], [10, 'MY POSITION LONGITUDE', NOCAT]], '0501'),
      G('0502', 'EXTENSION SETTING', 'SD CARD', []), G('0503', 'EXTENSION SETTING', 'SOFT VERSION', []),
      G('0504', 'EXTENSION SETTING', 'CALIBRATION', []), G('0505', 'EXTENSION SETTING', 'RESET', []),
      // APRS SETTING : comme sur le TRX — GENERAL, MSG TEMPLATE, MY SYMBOL, DIGI PATH (textes relus, pas modifiés à distance)
      G('0601', 'APRS SETTING', 'GENERAL', [[1, 'MODEM SELECT', L(['OFF', 'AUTO', 'MAIN', 'SUB'])], [2, 'MODEM TYPE', L(['1200bps', '9600bps'])], [3, 'APRS AF MUTE', OFFON],
        [4, 'APRS TX DELAY', L(['100ms', '200ms', '300ms', '400ms', '500ms', '750ms', '1000ms'])], [5, 'CALLSIGN (APRS)', TXT], [9, 'APRS DESTINATION', TXT]]),
      G('0602', 'APRS SETTING', 'MSG TEMPLATE', Array.from({ length: 8 }, (_, i) => [i + 1, 'MESSAGE TEXT' + (i + 1), TXT])),
      G('0603', 'APRS SETTING', 'MY SYMBOL', [[1, 'MY SYMBOL', L(['ICON1', 'ICON2', 'ICON3', 'USER'])], [2, 'ICON1', SYM], [3, 'ICON2', SYM], [4, 'ICON3', SYM], [5, 'USER', TXT]]),
      G('0604', 'APRS SETTING', 'DIGI PATH', [[1, 'PATH SELECT', L(['OFF', 'WIDE1-1', 'WIDE1-1.WIDE2-1'])]]),
      G('0701', 'APRS BEACON', 'BEACON SET.', [[1, 'BEACON TYPE', RO(L(['OFF', 'AUTO', 'SMART']), 'balise automatique (émission) : au club')],
        [2, 'INFO AMBIGUITY', L(['OFF', '1dig', '2dig', '3dig', '4dig'])], [3, 'INFO SPEED/COURSE', OFFON], [4, 'INFO ALTITUDE', OFFON],
        [5, 'POSITION COMMENT', L(['Off duty', 'En Route', 'In Service', 'Returning', 'Committed', 'Special', 'Priority', 'Custom 0', 'Custom 1', 'Custom 2', 'Custom 3', 'Custom 4', 'Custom 5', 'Custom 6', 'EMERGENCY!'])],
        [6, 'EMERGENCY BEACON', RO(OFFON, 'balise d’urgence (émission) : au club')]]),
      G('0702', 'APRS BEACON', 'AUTO BEACON', [[1, 'INTERVAL TIME', L(['30sec', '1min', '2min', '3min', '5min', '10min', '15min', '20min', '30min', '60min'])],
        [2, 'PROPORTIONAL', OFFON], [3, 'DECAY', OFFON], [4, 'AUTO LOW SPEED', N(1, 99, 1, 'km/h')], [5, 'BEACON DELAY', N(5, 180, 1, 'sec')]]),
      G('0703', 'APRS BEACON', 'SmartBeac.', [[1, 'SMART LOW SPEED', N(2, 30, 1, 'km/h')], [2, 'SMART HIGH SPEED', N(3, 90, 1, 'km/h')],
        [3, 'SMART SLOW RATE', N(1, 100, 1, 'min')], [4, 'SMART FAST RATE', N(10, 180, 1, 'sec')], [5, 'SMART TURN ANGLE', N(5, 90, 1, 'degree')],
        [6, 'SMART TURN SLOPE', N(1, 255)], [7, 'SMART TURN TIME', N(5, 180, 1, 'sec')]]),
      G('0704', 'APRS BEACON', 'BEACON TEXT', [[1, 'STATUS TEXT SELECT', L(['OFF', 'TEXT1', 'TEXT2', 'TEXT3', 'TEXT4', 'TEXT5'])],
        [2, 'TX RATE', L(['1/1', '1/2', '1/3', '1/4', '1/5', '1/6', '1/7', '1/8'])], [3, 'BEACON FREQUENCY', L(['None', 'FREQUENCY', 'FREQ & SQL & SHIFT'])]]
        .concat(Array.from({ length: 5 }, (_, i) => [4 + i, 'STATUS TEXT' + (i + 1), TXT]))),
      G('0801', 'APRS FILTER', 'LIST SETTING', [[1, 'STATION LIST SORT', L(['TIME', 'CALLSIGN', 'DISTANCE'])]]),
      G('0802', 'APRS FILTER', 'STATION LIST', [[1, 'Mic-E', OFFON], [2, 'POSITION', OFFON], [3, 'WEATHER', OFFON], [4, 'OBJECT', OFFON], [5, 'ITEM', OFFON],
        [6, 'STATUS', OFFON], [7, 'OTHER', OFFON], [8, 'ALTNET', OFFON]]),
      G('0803', 'APRS FILTER', 'POPUP', [[1, 'BEACON', L(['OFF', '3sec', '5sec', '10sec', 'HOLD'])], [2, 'MESSAGE', L(['OFF', '3sec', '5sec', '10sec', 'HOLD'])], [3, 'MY PACKET', OFFON]]),
      G('0804', 'APRS FILTER', 'RINGER', [[1, 'TX BEACON', OFFON], [2, 'RX BEACON', OFFON], [3, 'TX MESSAGE', OFFON], [4, 'RX MESSAGE', OFFON], [7, 'MY PACKET', OFFON]]),
      G('0806', 'APRS FILTER', 'MSG FIL.', Array.from({ length: 6 }, (_, i) => [i + 1, 'MESSAGE GROUP' + (i + 1), TXT])
        .concat([[7, 'BULLETIN 1', TXT], [8, 'BULLETIN 2', TXT], [9, 'BULLETIN 3', TXT]]))
    ];
  })();
  const menuItem = (id) => { for (const g of MENU) for (const it of g.items) if (it.id === id) return it; return null; };
  /** Valeur lue (« 0300 », « +08 ») → texte affiché, comme sur l'écran du TRX (« 300msec », « 8 », « 6dB/oct ») */
  function menuShow(d, raw) {
    if (raw == null || raw === '') return '—';
    if (d.k === 's') { const i = d.codes.indexOf(String(raw)); return i >= 0 ? d.labels[i] : String(raw); }
    if (d.k === 't') return String(raw).replace(/-/g, ' ');
    if (d.k === 'dt') { const p = String(raw).slice(d.a, d.b); return d.names ? d.names[parseInt(p, 10) - 1] || p : p; }
    const v = parseInt(raw, 10);
    if (!Number.isFinite(v)) return String(raw);
    if (d.k === 'l') { const i = d.codes ? d.codes.indexOf(v) : v - d.base; return d.labels[i] != null ? d.labels[i] : String(v); }
    if (d.fmt) return d.fmt(v);
    return (d.div > 1 ? (v / d.div).toFixed(1) : String(v)).replace(/^(?=\d)/, d.sign && v > 0 ? '+' : '') + d.unit;
  }
  /** Valeur suivante (pas : +1 / −1) dans le format de la valeur lue (même nombre de chiffres, signe si besoin) */
  function menuStep(d, raw, step) {
    if (d.k === 's') { const i = d.codes.indexOf(String(raw)); return d.codes[Math.max(0, Math.min(d.codes.length - 1, (i < 0 ? 0 : i) + step))]; }
    const v = parseInt(raw, 10);
    if (!Number.isFinite(v) || d.k === 't') return null;
    let nv;
    if (d.k === 'l') {
      const codes = d.codes || d.labels.map((_, i) => i + d.base);
      const i = codes.indexOf(v);
      nv = codes[Math.max(0, Math.min(codes.length - 1, (i < 0 ? 0 : i) + step))];
    } else nv = Math.max(d.min, Math.min(d.max, Math.round((v + step * d.step) / d.step) * d.step));
    const s = String(raw), sign = /^[+-]/.test(s), w = s.replace(/^[+-]/, '').length;
    const body = String(Math.abs(nv)).padStart(w, '0');
    return sign ? (nv < 0 ? '-' : '+') + body : body;
  }
  /** Valeur permise pour ce réglage (contrôle du serveur avant d'écrire au TRX) */
  function menuOk(d, raw) {
    if (d && !d.ro && d.k === 's') return d.codes.indexOf(String(raw)) >= 0;
    if (!d || d.ro || !/^[+-]?\d{1,4}$/.test(String(raw))) return false;
    const v = parseInt(raw, 10);
    if (d.k === 'l') return (d.codes || d.labels.map((_, i) => i + d.base)).indexOf(v) >= 0;
    return v >= d.min && v <= d.max && (v - d.min) % d.step === 0;
  }

  const api = Y.build({
    ID: 'ftx1',
    NAME: 'Yaesu FTX-1',
    menu: { groups: MENU, item: menuItem, show: menuShow, step: menuStep, ok: menuOk, admin: true },
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
      { cmd: 'CF101;', re: /^CF101([+-])(\d{4})$/, parse: (m) => ({ clarB: (m[1] === '-' ? -1 : 1) * +m[2] }), sim: 'CF101+0000' },
      // Préampli : PA P1 = gamme (0 HF/50 MHz : IPO/AMP1/AMP2 ; 1 = 144 MHz, 2 = 430 MHz : OFF/ON), pas MAIN/SUB
      // (Hamlib rigs/yaesu/ftx1/ftx1_preamp.c). Réglage propre à chaque gamme, commun aux deux côtés.
      { cmd: 'PA1;', re: /^PA1([01])$/, parse: (m) => ({ preampV: +m[1] }), sim: 'PA11' },
      { cmd: 'PA2;', re: /^PA2([01])$/, parse: (m) => ({ preampU: +m[1] }), sim: 'PA21' },
      // Côté SUB (VFO B) : P1 = 1 (Hamlib ftx1_noise.c, ftx1_filter.c, ftx1_audio.c) — affichés sur l'écran du VFO B
      { cmd: 'NL1;', re: /^NL1(\d{3})$/, parse: (m) => ({ nbB: +m[1] }), sim: 'NL1000' },
      { cmd: 'RL1;', re: /^RL1(\d{2})$/, parse: (m) => ({ nrB: +m[1] }), sim: 'RL100' },
      { cmd: 'BP10;', re: /^BP10(\d{3})$/, parse: (m) => ({ notchB: +m[1] ? 1 : 0 }), sim: 'BP10000' },
      { cmd: 'BC1;', re: /^BC1([01])$/, parse: (m) => ({ dnfB: +m[1] }), sim: 'BC10' },
      { cmd: 'NA1;', re: /^NA1([01])$/, parse: (m) => ({ narrowB: +m[1] }), sim: 'NA10' },
      { cmd: 'GT1;', re: /^GT1(\d)$/, parse: (m) => ({ agcB: Math.min(4, +m[1]) }), sim: 'GT14' },
      { cmd: 'SH1;', re: /^SH1(\d{3})$/, parse: (m) => ({ widthB: +m[1] }), sim: 'SH1013' },
      { cmd: 'RG1;', re: /^RG1(\d{3})$/, parse: (m) => ({ rfB: +m[1] }), sim: 'RG1255' },
      // AF du SUB : bouton SUB DSP AF/RF/SQL de la page Face avant /ftx1
      { cmd: 'AG1;', re: /^AG1(\d{3})$/, parse: (m) => ({ afB: +m[1] }), sim: 'AG1128' },
      { cmd: 'BP11;', re: /^BP11(\d{3})$/, parse: (m) => ({ notchFreqB: +m[1] * 10 }), sim: 'BP11150' },
      { cmd: 'IS1;', re: /^IS1[01]([+-])(\d{4})$/, parse: (m) => ({ shiftB: (m[1] === '-' ? -1 : 1) * +m[2] }), sim: 'IS10+0000' },
      { cmd: 'CO10;', re: /^CO10(\d{4})$/, parse: (m) => ({ contourB: +m[1] ? 1 : 0 }), sim: 'CO100000' },
      { cmd: 'CO12;', re: /^CO12(\d{4})$/, parse: (m) => ({ apfB: +m[1] ? 1 : 0 }), sim: 'CO120000' },
      // FUNCTION RX : FR00 double réception (S-mètre SUB lisible par SM1), FR01 réception simple
      { cmd: 'FR;', re: /^FR0([01])$/, parse: (m) => ({ dualRx: m[1] === '0' ? 1 : 0 }), sim: 'FR00' },
      // RADIO INFORMATION (manuel CAT) : RI0 P2 … P8 — P2 1 = Hi-SWR, P6 1 = tuner en cours d'accord
      { cmd: 'RI0;', re: /^RI0(\d)(\d)(\d)(\d)(\d)(\d)(\d)$/, parse: (m) => ({ hiSwr: m[1] === '1' ? 1 : 0, tuningRi: m[5] === '1' ? 1 : 0 }), sim: 'RI00000000' },
      // Écran FUNC de la face avant /ftx1 (appui long sur FUNC) — manuel CAT FTX-1 : lus en tournante lente
      { cmd: 'DA;', re: /^DA00(\d\d)(\d\d)(\d\d)$/, parse: (m) => ({ dContrast: +m[1], dimmer: +m[2], dimLed: +m[3] }), sim: 'DA00151515' },
      { cmd: 'PR1;', re: /^PR1([12])$/, parse: (m) => ({ micEq: m[1] === '2' ? 1 : 0 }), sim: 'PR11' },
      { cmd: 'TS;', re: /^TS([01])$/, parse: (m) => ({ txw: +m[1] }), sim: 'TS0' },
      { cmd: 'AO;', re: /^AO(\d{3})$/, parse: (m) => ({ amc: +m[1] }), sim: 'AO038' },
      { cmd: 'VG;', re: /^VG(\d{3})$/, parse: (m) => ({ voxGain: +m[1] }), sim: 'VG050' },
      { cmd: 'VD;', re: /^VD(\d\d)$/, parse: (m) => ({ voxDelay: +m[1] }), sim: 'VD06' },
      { cmd: 'ML1;', re: /^ML1(\d{3})$/, parse: (m) => ({ moniLvl: +m[1] }), sim: 'ML1005' },
      { cmd: 'KR;', re: /^KR([01])$/, parse: (m) => ({ keyer: +m[1] }), sim: 'KR0' },
      { cmd: 'BI;', re: /^BI([01])$/, parse: (m) => ({ bkin: +m[1] }), sim: 'BI0' },
      { cmd: 'KS;', re: /^KS(\d{3})$/, parse: (m) => ({ keySpeed: +m[1] }), sim: 'KS022' },
      { cmd: 'KP;', re: /^KP(\d\d)$/, parse: (m) => ({ cwPitch: 300 + 10 * +m[1] }), sim: 'KP45' },
      { cmd: 'SD;', re: /^SD(\d\d)$/, parse: (m) => ({ bkDelay: +m[1] }), sim: 'SD06' },
      { cmd: 'CS;', re: /^CS([01])$/, parse: (m) => ({ cwSpot: +m[1] }), sim: 'CS0' },
      // FINE / FAST du TRX (FN : 0 normal, 1 FINE, 2 FAST) : la touche FINE/FAST de la page /ftx1 le suit
      // Fréquences CONTOUR et APF (écran DSP de /ftx1) : CO P1 (0 MAIN, 1 SUB) P2 (1 CONTOUR FREQ 10–3200 Hz, 3 APF FREQ 0–50 = −250…+250 Hz)
      { cmd: 'CO01;', re: /^CO01(\d{4})$/, parse: (m) => ({ contourFreq: +m[1] }), sim: 'CO011000' },
      { cmd: 'CO11;', re: /^CO11(\d{4})$/, parse: (m) => ({ contourFreqB: +m[1] }), sim: 'CO111000' },
      { cmd: 'CO03;', when: (st) => /^CW/.test(st.mode || ''), re: /^CO03(\d{4})$/, parse: (m) => ({ apfFreq: +m[1] }), sim: 'CO030025' },
      { cmd: 'CO13;', when: (st) => /^CW/.test(st.modeB || ''), re: /^CO13(\d{4})$/, parse: (m) => ({ apfFreqB: +m[1] }), sim: 'CO130025' },
      // D-MODE du scope (SS06 : 0/4 CENTER, 1/7 CURSOR, 2/A FIX ; 0-2 avec 3DSS, 4/7/A cascade normale)
      // SPAN du scope du TRX (SS05 : 2 = 5 kHz … 9 = 1 MHz, mêmes rangs que la page) : un seul scope (P1 fixe), valeur des deux côtés
      { cmd: 'SS05;', re: /^SS05([2-9])0000$/, parse: (m) => ({ ssSpanA: +m[1], ssSpanB: +m[1] }), sim: 'SS0560000' },
      { cmd: 'SS06;', re: /^SS06([0-9A-B])0000$/, parse: (m) => { const c = parseInt(m[1], 16); return { dMode: c === 1 || c === 7 ? 1 : c === 2 || c === 10 ? 2 : 0 }; }, sim: 'SS0640000' },
      { cmd: 'FN;', re: /^FN([0-2])$/, parse: (m) => ({ tuneStep: +m[1] }), sim: 'FN0' },
      // METER (MS) : mesure de l'échelle sous l'S-mètre, MAIN puis SUB (0 PO, 1 COMP, 2 ALC, 3 VDD, 4 ID, 5 SWR)
      { cmd: 'MS;', re: /^MS([0-5])([0-5])$/, parse: (m) => ({ meterSw: +m[1], meterSwB: +m[2] }), sim: 'MS55' },
      // FM : décalage relais (lu en FM seulement) ; SQL TYPE, tonalité CTCSS et code DCS lus dans tous les modes
      // (le TRX les affiche aussi hors FM, cases grisées ; un « ? » éventuel n'est noté qu'une fois au journal)
      { cmd: 'OS0;', when: (st) => /FM/.test(st.mode || ''), re: /^OS0([0-3])$/, parse: (m) => ({ rpt: +m[1] }), sim: 'OS00' },
      { cmd: 'OS1;', when: (st) => /FM/.test(st.modeB || ''), re: /^OS1([0-3])$/, parse: (m) => ({ rptB: +m[1] }), sim: 'OS10' },
      { cmd: 'CT0;', re: /^CT0([0-5])$/, parse: (m) => ({ encDec: +m[1] }), sim: 'CT00' },
      { cmd: 'CT1;', re: /^CT1([0-5])$/, parse: (m) => ({ encDecB: +m[1] }), sim: 'CT10' },
      { cmd: 'CN00;', re: /^CN00(\d{3})$/, parse: (m) => ({ toneIdx: +m[1] }), sim: 'CN00012' },
      { cmd: 'CN10;', re: /^CN10(\d{3})$/, parse: (m) => ({ toneIdxB: +m[1] }), sim: 'CN10012' },
      { cmd: 'CN01;', re: /^CN01(\d{3})$/, parse: (m) => ({ dcsIdx: +m[1] }), sim: 'CN01000' },
      { cmd: 'CN11;', re: /^CN11(\d{3})$/, parse: (m) => ({ dcsIdxB: +m[1] }), sim: 'CN11000' }
    ],
    // Console CAT : lectures supplémentaires pour le diagnostic (ATT / préampli par côté)
    // + tuner : AC (état), RI0 (accord en cours), menus TUN/LIN PORT SELECT (EX030103), TUNER SELECT (EX030104),
    // TUNER TYPE SEL ANT1 / ANT2 (EX030701 / EX030702) — numéros du manuel CAT FTX-1 (Table 3)
    extraQueries: ['RA1;', 'PA0;', 'PA1;', 'PA2;', 'AC;', 'RI0;', 'EX030103;', 'EX030104;', 'EX030701;', 'EX030702;'],
    extraStateKeys: ['ssSpanA', 'ssSpanB', 'attB', 'preampB', 'notchFreqB', 'shiftB', 'contourB', 'apfB', 'widthB', 'preampV', 'preampU', 'preampVU', 'nbB', 'nrB', 'notchB', 'dnfB', 'narrowB', 'agcB', 'rfB', 'afB', 'hiSwr', 'tuningRi',
      'dContrast', 'dimmer', 'dimLed', 'micEq', 'txw', 'amc', 'voxGain', 'voxDelay', 'moniLvl', 'keyer', 'bkin', 'keySpeed', 'cwPitch', 'bkDelay', 'cwSpot', 'tuneStep', 'dMode', 'meterSw', 'meterSwB', 'contourFreq', 'contourFreqB', 'apfFreq', 'apfFreqB',
      'rpt', 'rptB', 'encDec', 'encDecB', 'toneIdx', 'toneIdxB', 'dcsIdx', 'dcsIdxB'],
    subBadges: true,
    // CW : mémoire TEXTE 5 du manipulateur (écrasée), lue par KY05 ; KY00 = arrêt (manuel CAT FTX-1, Hamlib ftx1_cw.c)
    // EX020210 = menu CW MEMORY 5 (0 : TEXT, 1 : MESSAGE) : en MESSAGE (mémoire enregistrée au manipulateur), le texte
    // écrit par KM5 n'est ni gardé ni joué ; le dashboard la met en TEXT avant chaque émission
    // Manipulation par le port « Standard COM Port » (DTR) : menu PC KEYING (EX020114) sur DTR pendant l'émission seulement,
    // RPTT SELECT (EX020112) sur OFF pour que DTR ne commande jamais l'émission phonie
    // Phonie à distance : MOD SOURCE (0 MIC, 1 USB, 2 Bluetooth, 3 AUTO) du mode d'émission, mis sur USB le temps de l'émission
    // Égaliseur paramétrique : EX030402 à EX030419 (niveau −20 à +10, largeur 0 à 10)
    trxEq: { menu: '0304', first: 2, lvl: [-20, 10], bw: [0, 10] },
    voice: { LSB: [['010113', '1']], USB: [['010113', '1']], AM: [['010213', '1']], 'AM-N': [['010213', '1']], FM: [['010312', '1']], 'FM-N': [['010312', '1']] },
    cw: { pre: ['EX0202100;'], mem: 'KM5', play: 'KY05;', stop: 'KY00;', // KY15 (mémoire MESSAGE, enregistrée au manipulateur) ne joue pas notre texte : retiré
      dtr: { on: ['EX0201120;', 'EX0201142;', 'BI1;'], off: ['EX0201140;'] } },
    // PA0 / RA0 lus avec le côté SUB actif : ce sont l'ATT et le préampli du VFO B
    remapRead(p, r) {
      if (r.vfoSel !== 1) return;
      if (p.preamp != null) { p.preampB = p.preamp; delete p.preamp; }
      if (p.att != null) { p.attB = p.att; delete p.att; }
    },
    // Préampli de la gamme du VFO A (144 / 430 MHz), pour le bouton AMP
    derive(r) {
      const f = r.freq;
      r.preampVU = f == null ? null : f >= 420000000 ? r.preampU : f >= 144000000 ? r.preampV : null;
    },
    readForState: (id, s) => (id === 'preampVU' ? (s.freq >= 420000000 ? 'PA2;' : 'PA1;') : null),
    // Texte du badge préampli d'un VFO : [texte, allumé]
    preampText(r, w) {
      const f = w === 'B' ? r.freqB : r.freq;
      if (f == null) return null;
      if (f >= 144000000) {
        const v = f >= 420000000 ? r.preampU : r.preampV;
        return v == null ? null : ['AMP', !!v];
      }
      if (r.preamp == null) return null;
      return [['IPO', 'AMP1', 'AMP2'][r.preamp] || 'IPO', r.preamp > 0];
    },
    extraControls: [
      // Double réception (FR00) / réception simple (FR01). En double réception, la BF USB du TRX contient aussi le côté SUB
      // (ex. 14 074 kHz entendu pendant un trafic QO-100 sur MAIN) : réception simple pour n'avoir que le côté actif
      { id: 'dualRx', g: 'vfo', label: 'DUAL RX', type: 'toggle', write: (v) => 'FR0' + (v ? '0' : '1') + ';' },
      { id: 'ant', g: 'rx', label: 'Antenne', type: 'select', noTx: true, options: [[1, 'ANT 1'], [2, 'ANT 2']], write: (v) => 'EX030704' + (v - 1) + ';' },
      { id: 'ritB', g: 'vfo', label: 'RIT (VFO B)', type: 'toggle', write: (v, s) => 'CF100' + v + (s.xitB || 0) + '000;' },
      { id: 'xitB', g: 'vfo', label: 'XIT (VFO B)', type: 'toggle', write: (v, s) => 'CF100' + (s.ritB || 0) + v + '000;' },
      { id: 'clarB', g: 'vfo', label: 'Décalage RIT/XIT (VFO B)', type: 'level', min: -9999, max: 9999, step: 10, unit: 'Hz',
        write: (v) => 'CF101' + (v < 0 ? '-' : '+') + pad(Math.abs(v), 4) + ';' },
      // CLAR de la face avant /ftx1 : 0 arrêt, 1 RX, 2 TX, 3 RXTX — RIT et XIT dans la même commande CF (pas d'état intermédiaire)
      { id: 'clarMode', g: 'vfo', label: 'CLAR (RX / TX / RXTX)', type: 'select', face: true, options: [[0, 'OFF'], [1, 'RX'], [2, 'TX'], [3, 'RXTX']], write: (v) => 'CF000' + (v & 1) + ((v >> 1) & 1) + '000;' },
      { id: 'clarModeB', g: 'vfo', label: 'CLAR VFO B (RX / TX / RXTX)', type: 'select', face: true, options: [[0, 'OFF'], [1, 'RX'], [2, 'TX'], [3, 'RXTX']], write: (v) => 'CF100' + (v & 1) + ((v >> 1) & 1) + '000;' },
      { id: 'clarClrB', g: 'vfo', label: 'CLEAR (décalage VFO B à zéro)', type: 'action', write: () => 'CF101+0000;' },
      // Largeur de filtre du côté SUB (VFO B) : SH1 0 nn (Hamlib ftx1_audio.c) — molette sur « BW » de l'écran du VFO B
      { id: 'widthB', g: 'flt', label: 'WIDTH (VFO B)', type: 'width', modeKey: 'modeB', write: (v) => 'SH1' + pad(v, 3) + ';',
        when: (s) => !!api.widthTableFn && !!api.widthTableFn(s.modeB) && !s.narrowB },
      // ATT et préampli du côté SUB : PA0 / RA0 agissent sur le côté actif. Côté MAIN actif, la page Station passe sur SUB
      // (FT confirmé avant VS1), envoie RA0 / PA0, puis revient sur MAIN. Lus quand SUB est actif (remapRead).
      { id: 'attB', g: 'rx', label: 'ATT (VFO B)', type: 'toggle', viaSub: true, write: (v) => 'RA0' + v + ';',
        when: (s) => s.freqB != null && s.freqB < 144000000 },
      { id: 'preampB', g: 'rx', label: 'Préampli (VFO B)', type: 'select', options: [[0, 'IPO'], [1, 'AMP1'], [2, 'AMP2']], viaSub: true,
        write: (v) => 'PA0' + v + ';', when: (s) => s.freqB != null && s.freqB < 144000000 },
      // Côté SUB (VFO B) : réglés d'un clic sur les badges de l'écran du VFO B (P1 = 1, comme les lectures NL1, RL1, BP10, BC1, NA1)
      { id: 'narrowB', g: 'flt', label: 'NARROW (VFO B)', type: 'toggle', write: (v) => 'NA1' + v + ';' },
      { id: 'nbB', g: 'flt', label: 'NB (VFO B)', type: 'level', min: 0, max: 10, step: 1, off0: true, write: (v) => 'NL1' + pad(v, 3) + ';' },
      { id: 'nrB', g: 'flt', label: 'DNR (VFO B)', type: 'level', min: 0, max: 10, step: 1, off0: true, write: (v) => 'RL1' + pad(v, 2) + ';' },
      { id: 'notchB', g: 'flt', label: 'NOTCH (VFO B)', type: 'toggle', write: (v) => 'BP10' + pad(v, 3) + ';' },
      { id: 'dnfB', g: 'flt', label: 'DNF (VFO B)', type: 'toggle', write: (v) => 'BC1' + v + ';' },
      { id: 'notchFreqB', g: 'flt', label: 'Fréquence NOTCH (VFO B)', type: 'level', min: 10, max: 3200, step: 10, unit: 'Hz', write: (v) => 'BP11' + pad(v / 10, 3) + ';', when: (s) => !/FM/.test(s.modeB || '') },
      { id: 'shiftB', g: 'flt', label: 'IF SHIFT (VFO B)', type: 'level', min: -1200, max: 1200, step: 20, unit: 'Hz', write: (v) => 'IS10' + signed4(v) + ';' },
      { id: 'contourB', g: 'flt', label: 'CONTOUR (VFO B)', type: 'toggle', write: (v) => 'CO10' + pad(v, 4) + ';' },
      { id: 'apfB', g: 'flt', label: 'APF (VFO B)', type: 'toggle', write: (v) => 'CO12' + pad(v, 4) + ';', when: (s) => /^CW/.test(s.modeB || '') },
      { id: 'agcB', g: 'rx', label: 'AGC (VFO B)', type: 'select', options: [[0, 'OFF'], [1, 'FAST'], [2, 'MID'], [3, 'SLOW'], [4, 'AUTO']], write: (v) => 'GT1' + v + ';' },
      { id: 'rfB', g: 'rx', label: 'RF gain (VFO B)', type: 'level', min: 0, max: 255, step: 1, pct: true, write: (v) => 'RG1' + pad(v, 3) + ';' },
      { id: 'afB', g: 'rx', label: 'AF (VFO B)', type: 'level', min: 0, max: 255, step: 1, pct: true, face: true, write: (v) => 'AG1' + pad(v, 3) + ';' },
      // 144 / 430 MHz : un seul préampli, AMP ON / OFF (AMP1 / AMP2 n'existent qu'en HF et 50 MHz)
      { id: 'preampVU', g: 'rx', label: 'AMP (144 / 430 MHz)', type: 'toggle', write: (v, s) => 'PA' + (s.freq >= 420000000 ? 2 : 1) + v + ';',
        when: (s) => s.freq != null && s.freq >= 144000000, hideUnavail: true },
      // Écran FUNC de la face avant /ftx1 (face : pas dans la disposition du dashboard). MOX n'existe pas à distance (PTT de la page),
      // le VOX ne peut qu'être coupé (contrôle « vox » commun)
      { id: 'dContrast', g: 'disp', label: 'D-CONTRAST', type: 'level', min: 0, max: 20, step: 1, face: true,
        write: (v, s) => 'DA00' + pad(v, 2) + pad(s.dimmer != null ? s.dimmer : 15, 2) + pad(s.dimLed != null ? s.dimLed : 15, 2) + ';' },
      { id: 'dimmer', g: 'disp', label: 'DIMMER', type: 'level', min: 0, max: 20, step: 1, face: true,
        write: (v, s) => 'DA00' + pad(s.dContrast != null ? s.dContrast : 15, 2) + pad(v, 2) + pad(s.dimLed != null ? s.dimLed : 15, 2) + ';' },
      { id: 'micEq', g: 'tx', label: 'MIC EQ', type: 'toggle', face: true, write: (v) => 'PR1' + (v ? 2 : 1) + ';' },
      { id: 'txw', g: 'tx', label: 'TXW', type: 'toggle', face: true, write: (v) => 'TS' + v + ';' },
      { id: 'amc', g: 'tx', label: 'AMC LEVEL', type: 'level', min: 1, max: 100, step: 1, face: true, write: (v) => 'AO' + pad(v, 3) + ';' },
      { id: 'voxGain', g: 'tx', label: 'VOX GAIN', type: 'level', min: 0, max: 100, step: 1, face: true, write: (v) => 'VG' + pad(v, 3) + ';' },
      { id: 'voxDelay', g: 'tx', label: 'VOX DELAY', type: 'level', min: 0, max: 33, step: 1, face: true, write: (v) => 'VD' + pad(v, 2) + ';' },
      { id: 'moniLvl', g: 'tx', label: 'MONI LEVEL', type: 'level', min: 0, max: 100, step: 1, face: true, write: (v) => 'ML1' + pad(v, 3) + ';' },
      { id: 'keyer', g: 'tx', label: 'KEYER', type: 'toggle', face: true, write: (v) => 'KR' + v + ';' },
      { id: 'bkin', g: 'tx', label: 'BK-IN', type: 'toggle', face: true, write: (v) => 'BI' + v + ';' },
      { id: 'keySpeed', g: 'tx', label: 'CW SPEED', type: 'level', min: 4, max: 60, step: 1, face: true, write: (v) => 'KS' + pad(v, 3) + ';' },
      { id: 'cwPitch', g: 'tx', label: 'CW PITCH', type: 'level', min: 300, max: 1050, step: 10, face: true, write: (v) => 'KP' + pad(Math.round((v - 300) / 10), 2) + ';' },
      { id: 'bkDelay', g: 'tx', label: 'BK-DELAY', type: 'level', min: 0, max: 33, step: 1, face: true, write: (v) => 'SD' + pad(v, 2) + ';' },
      { id: 'cwSpot', g: 'tx', label: 'CW SPOT', type: 'toggle', face: true, write: (v) => 'CS' + v + ';' },
      { id: 'contourFreq', g: 'flt', label: 'CONTOUR FREQ', type: 'level', min: 10, max: 3200, step: 10, face: true, write: (v) => 'CO01' + pad(v, 4) + ';' },
      { id: 'contourFreqB', g: 'flt', label: 'CONTOUR FREQ (SUB)', type: 'level', min: 10, max: 3200, step: 10, face: true, write: (v) => 'CO11' + pad(v, 4) + ';' },
      { id: 'apfFreq', g: 'flt', label: 'APF FREQ', type: 'level', min: 0, max: 50, step: 1, face: true, write: (v) => 'CO03' + pad(v, 4) + ';' },
      { id: 'apfFreqB', g: 'flt', label: 'APF FREQ (SUB)', type: 'level', min: 0, max: 50, step: 1, face: true, write: (v) => 'CO13' + pad(v, 4) + ';' },
      { id: 'ssSpd', g: 'disp', label: 'SCOPE SPEED', type: 'level', min: 0, max: 5, step: 1, face: true, write: (v) => 'SS00' + v + '0000;' }, // 0 SLOW1 … 4 FAST3, 5 STOP
      { id: 'ssSpan', g: 'disp', label: 'SCOPE SPAN', type: 'level', min: 2, max: 9, step: 1, face: true, write: (v) => 'SS05' + v + '0000;' },
      { id: 'dMode', g: 'disp', label: 'D-MODE (code SS06)', type: 'level', min: 0, max: 10, step: 1, face: true, write: (v) => 'SS06' + Number(v).toString(16).toUpperCase() + '0000;' },
      // METER : toucher l'S-mètre sur /ftx1 → tableau PO / COMP / ALC / VDD / ID / SWR, comme sur le TRX (MS P1 MAIN, P2 SUB)
      { id: 'meterSw', g: 'disp', label: 'METER (MAIN)', type: 'select', face: true, options: [[0, 'PO'], [1, 'COMP'], [2, 'ALC'], [3, 'VDD'], [4, 'ID'], [5, 'SWR']], write: (v, st) => 'MS' + v + (st && st.meterSwB != null ? st.meterSwB : 5) + ';' },
      { id: 'meterSwB', g: 'disp', label: 'METER (SUB)', type: 'select', face: true, options: [[0, 'PO'], [1, 'COMP'], [2, 'ALC'], [3, 'VDD'], [4, 'ID'], [5, 'SWR']], write: (v, st) => 'MS' + (st && st.meterSw != null ? st.meterSw : 5) + v + ';' },
      { id: 'tuneStep', g: 'vfo', label: 'FINE / FAST', type: 'select', face: true, options: [[0, 'NORMAL'], [1, 'FINE'], [2, 'FAST']], write: (v) => 'FN' + v + ';' },
      // ZIN (CW AUTO ZERO IN) : le récepteur sélectionné se cale sur le signal CW
      { id: 'zin', g: 'tx', label: 'ZIN', type: 'action', face: true, write: (v, s) => 'ZI' + (s && s.vfoSel === 1 ? 1 : 0) + ';' },
      { id: 'rpt', g: 'vfo', label: 'RPT SHIFT (MAIN)', type: 'select', face: true, options: [[0, 'SIMP'], [1, '+'], [2, '−'], [3, 'ARS']], write: (v) => 'OS0' + v + ';' },
      { id: 'rptB', g: 'vfo', label: 'RPT SHIFT (SUB)', type: 'select', face: true, options: [[0, 'SIMP'], [1, '+'], [2, '−'], [3, 'ARS']], write: (v) => 'OS1' + v + ';' },
      { id: 'encDec', g: 'vfo', label: 'SQL TYPE (MAIN)', type: 'select', face: true, options: SQLT, write: (v) => 'CT0' + v + ';' },
      { id: 'encDecB', g: 'vfo', label: 'SQL TYPE (SUB)', type: 'select', face: true, options: SQLT, write: (v) => 'CT1' + v + ';' },
      { id: 'toneIdx', g: 'vfo', label: 'TONE FREQ (MAIN)', type: 'level', min: 0, max: 49, step: 1, face: true, write: (v) => 'CN00' + pad(v, 3) + ';' },
      { id: 'toneIdxB', g: 'vfo', label: 'TONE FREQ (SUB)', type: 'level', min: 0, max: 49, step: 1, face: true, write: (v) => 'CN10' + pad(v, 3) + ';' },
      { id: 'dcsIdx', g: 'vfo', label: 'DCS (MAIN)', type: 'level', min: 0, max: 103, step: 1, face: true, write: (v) => 'CN01' + pad(v, 3) + ';' },
      { id: 'dcsIdxB', g: 'vfo', label: 'DCS (SUB)', type: 'level', min: 0, max: 103, step: 1, face: true, write: (v) => 'CN11' + pad(v, 3) + ';' }
    ],
    // SPLIT : sur le FTX-1, ST1 met le côté SUB en émission (PTT) — défaut connu du firmware, signalé par Hamlib
    // (rigs/yaesu/ftx1/ftx1_vfo.c). Le choix du VFO d'émission passe donc par FT0 (TX MAIN) / FT1 (TX SUB) ; ST n'est ni lu ni envoyé.
    splitIsFT: true,
    // SPLIT mis sur la face avant du TRX : lu (hwSplit) pour l'afficher ; jamais activé par CAT (ST1), seulement coupé (ST0)
    readOverrides: { 'ST;': { re: /^ST([0-2])$/, parse: (m) => ({ hwSplit: m[1] === '0' ? 0 : 1 }), sim: 'ST0' } },
    // Sur le FTX-1, réception (VS) et émission (FT) basculent ensemble d'un côté à l'autre, et un VFO d'émission
    // différent de celui de réception peut faire émettre le TRX. Le choix du VFO d'émission (SPLIT, clic sur TX) est
    // donc gardé par le serveur (« SPLIT virtuel », comme Hamlib) et n'est envoyé au TRX qu'au moment d'émettre :
    // FT du VFO choisi, TX1… puis TX0 et retour de FT / VS sur le VFO de réception.
    // MAIN / SUB (clic sur RX) : FT puis VS sur le même côté — VS seul laisserait FT sur l'autre côté, et ce
    // désaccord fait émettre le FTX-1 (constaté au club).
    virtualSplit: true,
    // SPLIT par échange A ⇄ B (depuis 0.22.63) : au PTT, SV (les VFO s'échangent), émission sur le côté actif, puis TX0
    // vérifié et SV de retour. Plus aucun FT / VS autour de l'émission : en réception simple, le FTX-1 refusait FT1 ou
    // restait en émission dans l'état FT0 + VS1 (constaté au club le 25/10).
    splitSwap: true,
    controlOverrides: {
      // FTX-1 : ATT et IPO / AMP1 / AMP2 sous 144 MHz, un seul préampli AMP (ON / OFF) en 144 et 430 MHz (constaté au club)
      // ATT et IPO / AMP1 / AMP2 propres à chaque côté ; le CAT (PA0 / RA0) agit sur le côté actif (constaté au club) :
      // côté SUB actif, la page Station repasse un instant sur MAIN pour régler ceux du VFO A (viaMain)
      preamp: { hideUnavail: true, viaMain: true, when: (s) => s.freq != null && s.freq < 144000000 },
      att: { viaMain: true, when: (s) => s.freq != null && s.freq < 144000000 }, split: { write: (v) => 'FT' + (v ? 1 : 0) + ';' }, // MAIN / SUB : jamais l'état « émission sur MAIN, opération sur SUB » (FT0 avec VS1), qui met le FTX-1 en émission
      // (constaté au club : VS1 seul, puis FT0 avant VS0). Vers SUB : FT1 puis VS1 ; vers MAIN : VS0 puis FT0.
      vfoSel: { write: (v) => (v ? 'FT1;VS1;' : 'VS0;FT0;') } },
    extraControlsLate: [{ id: 'splitHw', g: 'vfo', label: 'SPLIT du TRX (coupure)', type: 'toggle', offOnly: true, write: () => 'ST0;' }],
    serial: { baudRate: 38400, stopBits: 1, portHint: 'Enhanced COM Port (CAT-1)' },
    hint: 'FTX-1 : menu Operation setting → General, « CAT-1 RATE » et « CAT-1 CAT-3 STOP BIT » doivent correspondre à ces valeurs. Choisissez le port Enhanced COM Port (CAT-1).'
  });

  // Son USB en stéréo : récepteur MAIN à gauche, SUB à droite (comme le FTDX101). En double réception, l'écoute
  // en stéréo, le décodage RTTY / FT du SUB lisent la voie droite. L'émission reste celle du FTX-1 (pas de DUAL_TX :
  // l'émission auto FT8 part toujours du VFO principal, le SPLIT virtuel du FTX-1 ne change pas)
  api.DUAL_AUDIO = true;
  // Double réception (MAIN + SUB) : seulement si l'un des VFO est au-delà de 118 MHz ; deux fréquences HF = un seul récepteur
  api.dualRxOk = (s) => (s.freq || 0) >= 118e6 || (s.freqB || 0) >= 118e6;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.FTX1 = api;
    root.RIGS = root.RIGS || {};
    root.RIGS[api.ID] = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
