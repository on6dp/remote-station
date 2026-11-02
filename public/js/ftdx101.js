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
  // APF : 0000-0050 → −250 … +250 Hz (25 = centre)
  const apfHz = (v) => { const h = (v - 25) * 10; return (h > 0 ? '+' : '') + h + ' Hz'; };
  // Puissance : 3 chiffres sans tête (PC005…PC200). Le modèle vient de la réponse à ID : 0681 = D (100 W), 0682 = MP (200 W).
  // Tant que ID n'est pas lu, on reste prudent : plage du D.
  const RANGE = { D: [5, 100], M: [5, 200] };
  // Largeurs du FTDX101 (manuel CAT 1912-D, table 3) : SH P1 0 P3P3 ; 00 = largeur par défaut du TRX (voyant WIDTH éteint).
  // Différentes du FTX-1 au-delà de 2100 Hz en SSB, et 18 pas seulement (50 … 3000 Hz) en CW / RTTY / PSK / DATA.
  const SSB_23 = [300, 400, 600, 850, 1100, 1200, 1500, 1650, 1800, 1950, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900, 3000, 3200, 3500, 4000];
  const ENCDEC = [[0, 'OFF'], [1, 'ENC/DEC'], [2, 'ENC']]; // CT P2 (manuel CAT) : CTCSS seulement
  const NARROW_21 = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 800, 1200, 1400, 1700, 2000, 2400, 3000, 3200, 3500, 4000];

  // ------------------------------------------------------------ menus du TRX (touche FUNC → … SETTING de la face avant)
  // Manuel CAT FTDX101 (1904-A), commande EX P1P2P3 + valeur. Chaque réglage : [n°, nom, type] ;
  // type L([libellés], base) = liste (code = base + rang), N(min, max, pas, unité, diviseur) = nombre, T = texte (lecture seule).
  // ro : lu seulement (liaison CAT, phonie et CW à distance, puissance maximale, étalonnage… : au club).
  const MENU = (() => {
    const L = (labels, base) => ({ k: 'l', labels, base: base || 0 });
    const C = (pairs) => ({ k: 'l', codes: pairs.map((p) => p[0]), labels: pairs.map((p) => p[1]) });
    const N = (min, max, step, unit, div) => ({ k: 'n', min, max, step: step || 1, unit: unit || '', div: div || 1 });
    const RO = (d, why) => Object.assign({}, d, { ro: why || 'au club seulement' });
    const T = { k: 't', ro: 'texte' };
    const OFFON = L(['OFF', 'ON']), MS = L(['MAIN', 'SUB']), NR = L(['NOR', 'REV']);
    const AGC = N(20, 4000, 20, 'msec');
    const LCUT = C([[0, 'OFF']].concat(Array.from({ length: 19 }, (_, i) => [i + 1, (100 + i * 50) + 'Hz'])));
    const HCUT = C([[0, 'OFF']].concat(Array.from({ length: 67 }, (_, i) => [i + 1, (700 + i * 50) + 'Hz'])));
    const SLOPE = L(['6dB/oct', '18dB/oct']);
    const BPF = L(['50-3050', '100-2900', '200-2800', '300-2700', '400-2600']);
    const LVL = N(0, 100);
    const MOD = RO(L(['MIC', 'REAR']), 'source de modulation : gérée par la phonie à distance');
    const REAR = RO(L(['DATA', 'USB']), 'gérée par la phonie à distance');
    const RPORT = RO(N(0, 100), 'niveau de l’entrée USB : réglé pour la phonie à distance');
    const RPTT = RO(L(['DAKY', 'RTS', 'DTR']), 'commande d’émission de la liaison');
    const MICG = C([[1000, 'MCVR']].concat(Array.from({ length: 101 }, (_, i) => [i, String(i)])));
    const flt = (a) => [[a, 'LCUT FREQ', LCUT], [a + 1, 'LCUT SLOPE', SLOPE], [a + 2, 'HCUT FREQ', HCUT], [a + 3, 'HCUT SLOPE', SLOPE]];
    const agc = [[1, 'AGC FAST DELAY', AGC], [2, 'AGC MID DELAY', AGC], [3, 'AGC SLOW DELAY', AGC]];
    const KTYPE = L(['OFF', 'BUG', 'ELEKEY-A', 'ELEKEY-B', 'ELEKEY-Y', 'ACS']);
    const EQF = [L(['OFF', '100', '200', '300', '400', '500', '600', '700']), L(['OFF', '700', '800', '900', '1000', '1100', '1200', '1300', '1400', '1500']),
      L(['OFF'].concat(Array.from({ length: 18 }, (_, i) => String(1500 + i * 100))))];
    const eqRo = (d) => RO(d, 'réglé par EQUALIZER TRX (Profil de …)');
    const eq = (a, p) => [0, 1, 2].flatMap((b) => [[a + b * 3, p + 'PRMTRC EQ' + (b + 1) + ' FREQ', eqRo(EQF[b])], [a + b * 3 + 1, p + 'PRMTRC EQ' + (b + 1) + ' LEVEL', eqRo(N(-10, 10, 1, 'dB'))], [a + b * 3 + 2, p + 'PRMTRC EQ' + (b + 1) + ' BWTH', eqRo(N(1, 10))]]);
    const G = (id, group, name, items) => ({ id, group, name, items: items.map(([n, label, d]) => ({ id: id + String(n).padStart(2, '0'), n, label, d })) });
    return [
      G('0101', 'RADIO SETTING', 'MODE SSB', agc.concat(flt(4), [[8, 'SSB OUT SELECT', MS], [9, 'SSB OUT LEVEL', LVL], [10, 'TX BPF SEL', BPF],
        [11, 'SSB MOD SOURCE', MOD], [12, 'REAR SELECT', REAR], [13, 'RPORT GAIN', RPORT], [14, 'RPTT SELECT', RPTT]])),
      G('0102', 'RADIO SETTING', 'MODE AM', agc.concat(flt(4), [[8, 'AM OUT SELECT', MS], [9, 'AM OUT LEVEL', LVL], [10, 'TX BPF SEL', BPF],
        [11, 'AM MOD SOURCE', MOD], [12, 'MIC GAIN', MICG], [13, 'REAR SELECT', REAR], [14, 'RPORT GAIN', RPORT], [15, 'RPTT SELECT', RPTT]])),
      G('0103', 'RADIO SETTING', 'MODE FM', agc.concat(flt(4), [[8, 'FM OUT SELECT', MS], [9, 'FM OUT LEVEL', LVL], [10, 'FM MOD SOURCE', MOD],
        [11, 'MIC GAIN', MICG], [12, 'REAR SELECT', REAR], [13, 'RPORT GAIN', RPORT], [14, 'RPTT SELECT', RPTT],
        [15, 'RPT SHIFT(28MHz)', N(0, 1000, 10, 'kHz')], [16, 'RPT SHIFT(50MHz)', N(0, 4000, 10, 'kHz')]])),
      G('0104', 'RADIO SETTING', 'MODE PSK/DATA', agc.concat([[4, 'DATA MODE', L(['PSK', 'OTHERS'])], [5, 'OTHER SHIFT SSB', N(0, 3000, 10, 'Hz')]], flt(6),
        [[10, 'DATA OUT SELECT', MS], [11, 'DATA OUT LEVEL', LVL], [12, 'TX BPF SEL', BPF], [13, 'DATA MOD SOURCE', MOD], [14, 'REAR SELECT', REAR],
          [15, 'RPORT GAIN', RPORT], [16, 'RPTT SELECT', RPTT]])),
      G('0105', 'RADIO SETTING', 'MODE RTTY', agc.concat([[4, 'POLARITY-RX', NR], [5, 'POLARITY-TX', NR]], flt(6),
        [[10, 'RTTY OUT SELECT', MS], [11, 'RTTY OUT LEVEL', LVL], [12, 'SHIFT PORT', RO(L(['SHIFT', 'DTR', 'RTS']), 'utilisé par le RTTY à distance')],
          [13, 'MARK FREQUENCY', C([[1, '1275Hz'], [2, '2125Hz']])], [14, 'SHIFT FREQUENCY', L(['170Hz', '200Hz', '425Hz', '850Hz'])]])),
      G('0106', 'RADIO SETTING', 'ENCDEC PSK', [[1, 'PSK MODE', L(['BPSK', 'QPSK'])], [2, 'DECODE AFC RANGE', L(['8Hz', '15Hz', '30Hz'])],
        [3, 'QPSK POLARITY RX', NR], [4, 'QPSK POLARITY TX', NR], [5, 'PSK TX LEVEL', LVL]]),
      G('0107', 'RADIO SETTING', 'ENCDEC RTTY', [[1, 'RX USOS', OFFON], [2, 'TX USOS', OFFON], [3, 'RX NEW LINE CODE', L(['CR,LF,CR+LF', 'CR+LF'])],
        [4, 'TX AUTO CR+LF', OFFON], [5, 'TX DIDDLE', L(['OFF', 'BLANK', 'LTRS'])], [6, 'BAUDOT CODE', L(['CCITT', 'US'])]]),
      G('0201', 'CW SETTING', 'MODE CW', agc.concat(flt(4), [[8, 'CW OUT SELECT', MS], [9, 'CW OUT LEVEL', LVL], [10, 'CW AUTO MODE', L(['OFF', '50MHz', 'ON'])],
        [11, 'CW BK-IN TYPE', L(['SEMI', 'FULL'])], [12, 'CW BK-IN DELAY', N(30, 3000, 10, 'msec')], [13, 'CW WAVE SHAPE', L(['1msec', '2msec', '4msec', '6msec'])],
        [14, 'CW FREQ DISPLAY', L(['DIRECT FREQ', 'PITCH OFFSET'])], [15, 'PC KEYING', RO(L(['OFF', 'DAKY', 'RTS', 'DTR']), 'utilisé par la CW à distance')],
        [16, 'QSK DELAY TIME', L(['15msec', '20msec', '25msec', '30msec'])]])),
      G('0202', 'CW SETTING', 'KEYER', [[1, 'F KEYER TYPE', KTYPE], [2, 'F KEYER DOT/DASH', NR], [3, 'R KEYER TYPE', KTYPE], [4, 'R KEYER DOT/DASH', NR],
        [5, 'CW WEIGHT', N(25, 45, 1, '', 10)], [6, 'NUMBER STYLE', L(['1290', 'AUNO', 'AUNT', 'A2NO', 'A2NT', '12NO', '12NT'])], [7, 'CONTEST NUMBER', N(1, 999)],
        [8, 'CW MEMORY 1', RO(L(['TEXT', 'MESSAGE']), 'utilisée par la CW au clavier')], [9, 'CW MEMORY 2', L(['TEXT', 'MESSAGE'])], [10, 'CW MEMORY 3', L(['TEXT', 'MESSAGE'])],
        [11, 'CW MEMORY 4', L(['TEXT', 'MESSAGE'])], [12, 'CW MEMORY 5', L(['TEXT', 'MESSAGE'])], [13, 'REPEAT INTERVAL', N(1, 60, 1, 'sec')]]),
      G('0203', 'CW SETTING', 'DECODE CW', [[1, 'CW DECODE BW', L(['25Hz', '50Hz', '100Hz', '250Hz'])]]),
      G('0301', 'OPERATION SETTING', 'GENERAL', [[1, 'DECODE RX SELECT', MS], [2, 'HEADPHONE MIX', L(['SEPARATE', 'COMBINE-1', 'COMBINE-2'])],
        [3, 'ANT3 SELECT', L(['TRX', 'RX ANT'])], [4, 'NB WIDTH', L(['1msec', '3msec', '10msec'])], [5, 'NB REJECTION', L(['10dB', '30dB', '50dB'])],
        [6, 'BEEP LEVEL', LVL], [7, 'RF/SQL VR', L(['RF', 'SQL'])], [8, 'TUNER/232C SELECT', RO(L(['TUNER', 'RS232C']), 'liaison')],
        [9, '232C RATE', RO(L(['4800bps', '9600bps', '19200bps', '38400bps']), 'liaison')], [10, '232C TIME OUT TIMER', RO(L(['10msec', '100msec', '1000msec', '3000msec']), 'liaison')],
        [11, 'CAT RATE', RO(L(['4800bps', '9600bps', '19200bps', '38400bps']), 'liaison CAT : la changer couperait la station')],
        [12, 'CAT TIME OUT TIMER', RO(L(['10msec', '100msec', '1000msec', '3000msec']), 'liaison CAT')], [13, 'CAT RTS', RO(OFFON, 'liaison CAT')],
        [14, 'QMB CH', L(['5ch', '10ch'])], [15, 'MEM GROUP', OFFON], [16, 'QUICK SPLIT INPUT', OFFON], [17, 'QUICK SPLIT FREQ', N(-20, 20, 1, 'kHz')],
        [18, 'TX TIME OUT TIMER', N(0, 30, 1, 'min')], [19, 'MIC SCAN', OFFON], [20, 'MIC SCAN RESUME', L(['PAUSE', 'TIME'])],
        [21, 'REF FREQ ADJ', RO(N(-25, 25), 'étalonnage : au club')], [22, 'CS DIAL', RO(N(0, 10), 'au club')], [23, 'KEYBOARD LANGUAGE', RO(N(0, 10), 'au club')]]),
      G('0302', 'OPERATION SETTING', 'RX-DSP', [[1, 'APF WIDTH', L(['NARROW', 'MEDIUM', 'WIDE'])], [2, 'CONTOUR LEVEL', N(-40, 20, 1, 'dB')],
        [3, 'CONTOUR WIDTH', N(1, 11)], [4, 'DNR LEVEL', N(1, 15)], [5, 'IF NOTCH WIDTH', L(['NARROW', 'WIDE'])]]),
      G('0303', 'OPERATION SETTING', 'TX AUDIO', [[1, 'PROC TYPE', L(['COMP', 'AMC'])], [2, 'AMC RELEASE TIME', L(['FAST', 'MID', 'SLOW'])]].concat(eq(3, ''), eq(12, 'P '))),
      G('0304', 'OPERATION SETTING', 'TX GNRL', [[1, 'HF MAX POWER', RO(N(5, 100, 1, 'W'), 'puissance maximale : réglée par le club')],
        [2, '50M MAX POWER', RO(N(5, 100, 1, 'W'), 'réglée par le club')], [3, '70M MAX POWER', RO(N(5, 50, 1, 'W'), 'réglée par le club')],
        [4, 'AM MAX POWER', RO(N(5, 25, 1, 'W'), 'réglée par le club')], [5, 'VOX SELECT', RO(L(['MIC', 'DATA']), 'pas de VOX à distance')],
        [6, 'DATA VOX GAIN', RO(N(0, 100), 'pas de VOX à distance')], [7, 'EMERGENCY FREQ TX', RO(OFFON, 'au club')]]),
      G('0305', 'OPERATION SETTING', 'TUNING', [[1, 'SSB/CW DIAL STEP', L(['5Hz', '10Hz'])], [2, 'RTTY/PSK DIAL STEP', L(['5Hz', '10Hz'])],
        [3, 'CH STEP', L(['1kHz', '2.5kHz', '5kHz'])], [4, 'AM CH STEP', L(['2.5kHz', '5kHz', '9kHz', '10kHz', '12.5kHz', '25kHz'])],
        [5, 'FM CH STEP', L(['5kHz', '6.25kHz', '10kHz', '12.5kHz', '20kHz', '25kHz'])], [6, 'MAIN STEPS PER REV', L(['250', '500', '1000'])],
        [7, 'MPVD STEPS PER REV', L(['250', '500'])]]),
      G('0401', 'DISPLAY SETTING', 'DISPLAY', [[1, 'MY CALL', T], [2, 'MY CALL TIME', L(['OFF', '0.5sec', '1sec', '2sec', '3sec', '5sec'])],
        [3, 'SCREEN SAVER', L(['OFF', '15min', '30min', '60min'])], [4, 'TFT CONTRAST', N(0, 20)], [5, 'DIMMER TFT', N(0, 20)], [6, 'DIMMER LED', N(0, 20)],
        [7, 'MOUSE POINTER SPEED', N(0, 20)], [8, 'FREQ STYLE', L(['LIGHT', 'BOLD'])]]),
      G('0402', 'DISPLAY SETTING', 'SCOPE', [[1, 'RBW', L(['HIGH', 'MID', 'LOW'])], [2, 'SCOPE CTR', L(['FILTER', 'CARRIER POINT'])],
        [3, '2D DISP SENSITIVITY', L(['NORMAL', 'HI'])], [4, '3DSS DISP SENSITIVITY', L(['NORMAL', 'HI'])]]),
      G('0403', 'DISPLAY SETTING', 'EXT-MONITOR', [[1, 'EXT DISPLAY', RO(OFFON, 'écran externe du club : au club seulement')], [2, 'PIXEL', RO(L(['800x480', '800x600']), 'écran externe du club : au club seulement')]])
    ];
  })();
  /** Réglage d'un menu par son numéro (« 030201 ») */
  const menuItem = (id) => { for (const g of MENU) for (const it of g.items) if (it.id === id) return it; return null; };
  /** Valeur lue (« 0500 », « +05 ») → code numérique ; texte affiché */
  function menuShow(d, raw) {
    if (raw == null || raw === '') return '—';
    if (d.k === 't') return String(raw);
    const v = parseInt(raw, 10);
    if (!Number.isFinite(v)) return String(raw);
    if (d.k === 'l') { const i = d.codes ? d.codes.indexOf(v) : v - d.base; return d.labels[i] != null ? d.labels[i] : String(v); }
    return (d.div > 1 ? (v / d.div).toFixed(1) : (d.min < 0 && v > 0 ? '+' : '') + v) + (d.unit ? d.unit : '');
  }
  /** Valeur suivante (pas : +1 / −1) dans le format de la valeur lue (même nombre de chiffres, signe si besoin) */
  function menuStep(d, raw, step) {
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
    if (!d || d.ro || !/^[+-]?\d{1,4}$/.test(String(raw))) return false;
    const v = parseInt(raw, 10);
    if (d.k === 'l') return (d.codes || d.labels.map((_, i) => i + d.base)).indexOf(v) >= 0;
    return v >= d.min && v <= d.max && (v - d.min) % d.step === 0;
  }

  const api = Y.build({
    ID: 'ftdx101',
    NAME: 'Yaesu FTDX101D / MP',
    FREQ_MAX: 75000000,
    headNames: { D: 'FTDX101D', M: 'FTDX101MP' },
    menu: { groups: MENU, item: menuItem, show: menuShow, step: menuStep, ok: menuOk },
    // SPLIT affiché : « ST1 » relu alors que l'émission est sur le VFO sélectionné (ex. SUB sélectionné, TX sur SUB) n'est pas
    // un SPLIT pour le TRX (son voyant SPLIT reste éteint) ; la valeur relue brute reste dans stSplit
    // Relecture juste après un réglage du clarifier : IF (MAIN) ou OI (SUB) selon le côté sélectionné
    readForState: (id, st) => (['rit', 'xit', 'clar', 'clarClr'].indexOf(id) >= 0 ? (st.vfoSel === 1 ? 'OI;' : 'IF;') : id === 'fastStep' ? 'FS;' : id === 'lock' || id === 'lockB' ? 'LK;' : null),
    derive(r) {
      const b = r.vfoSel === 1;
      for (const k of ['clar', 'rit', 'xit']) { const v = b ? r[k + 'B'] : r[k + 'A']; if (v != null) r[k] = v; }
      { const v = b ? r.fastB : r.fastA; if (v != null) r.fastStep = v; }
      r.stSplit = r.split;
      if (r.split === 1 && r.txVfo != null && r.vfoSel != null && r.txVfo === (r.vfoSel === 1 ? 1 : 0)) r.split = 0;
    },
    // FT (VFO d'émission), comme Hamlib pour les FTDX101 D / MP : lecture « FT0 » = émission sur MAIN, « FT1 » = sur SUB
    // (absolu, quel que soit le VFO sélectionné) ; réglage par FT2 (MAIN) / FT3 (SUB) — FT0 / FT1 servent à basculer
    // l'émission et ont des effets de bord (SPLIT qui se rallume, VFO d'émission inversé avec SUB sélectionné).
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
      // LK 0–7 : bits — 1 = grand bouton MAIN verrouillé, 2 = SUB verrouillé (4 : toujours là sur ce TRX ; Hamlib : 4 = rien, 7 = tout)
      'LK;': { re: /^LK([0-7])$/, parse: (m) => ({ lockRaw: +m[1], lock: +m[1] & 1, lockB: (+m[1] >> 1) & 1 }), sim: 'LK4' },
      // NB et DNR : interrupteur (NB0 / NR0) et niveau (NL0 / RL0) séparés, comme le FTDX10
      'NL0;': { re: /^NL0(\d{3})$/, parse: (m) => ({ nbLvl: +m[1] }), sim: 'NL0005' },
      'RL0;': { re: /^RL0(\d{2})$/, parse: (m) => ({ nrLvl: +m[1] }), sim: 'RL008' }
    },
    extraReads: [
      // Modèle (D ou MP) : plage de puissance
      { cmd: 'ID;', re: /^ID(\d{4})$/, parse: (m) => ({ powerHead: m[1] === '0682' ? 'M' : 'D' }), sim: 'ID0682' },
      // INFORMATION : P3 = décalage du clarifier (±0000–9999 Hz), P4 = RIT, P5 = XIT
      // Clarifier : IF = MAIN (VFO A), OI = SUB (VFO B) (Hamlib : « OI always returns VFOB and IF always VFOA ») ;
      // RT / XT / RC / RU / RD agissent sur le côté sélectionné → rit / xit / clar affichés = ceux du côté sélectionné (derive)
      { cmd: 'IF;', re: /^IF[0-9A-Z]{3}\d{9}([+-])(\d{4})([01])([01])[0-9A-F]/, parse: (m) => ({ clarA: Y.sgn(m[1]) * +m[2], ritA: +m[3], xitA: +m[4] }), sim: 'IF001014250000+00000020000000' },
      { cmd: 'OI;', re: /^OI[0-9A-Z]{3}\d{9}([+-])(\d{4})([01])([01])[0-9A-F]/, parse: (m) => ({ clarB: Y.sgn(m[1]) * +m[2], ritB: +m[3], xitB: +m[4] }), sim: 'OI001007074000+00000020000000' },
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
      // Face avant : fréquence du CONTOUR (CO P1 1 : 0010-3200 Hz) et de l'APF (CO P1 3 : 0000-0050 = −250…+250 Hz), MAIN et SUB
      // Bague extérieure du grand bouton (MPVD) : SF0 P2 = 1 CLAR, 2 VC TUNE, 3 SUB, 4 CS (grande touche VC TUNE allumée = 2)
      // Face avant : niveaux NB et DNR du SUB (P1 = 1)
      { cmd: 'NL1;', re: /^NL1(\d{3})$/, parse: (m) => ({ nbLvlB: +m[1] }), sim: 'NL1005' },
      { cmd: 'RL1;', re: /^RL1(\d{2})$/, parse: (m) => ({ nrLvlB: +m[1] }), sim: 'RL108' },
      { cmd: 'SF0;', re: /^SF0([1-4])$/, parse: (m) => ({ mpvd: +m[1] }), sim: 'SF03' },
      { cmd: 'CO01;', re: /^CO01(\d{4})$/, parse: (m) => ({ contourFreq: +m[1] }), sim: 'CO011000' },
      { cmd: 'CO11;', re: /^CO11(\d{4})$/, parse: (m) => ({ contourFreqB: +m[1] }), sim: 'CO111000' },
      // Lectures sans objet dans le mode (le TRX y répond « ?; ») : APF hors CW, RPT / ENC/DEC / TONE hors FM — pas lues
      { cmd: 'CO03;', when: (st) => /^CW/.test(st.mode || ''), re: /^CO03(\d{4})$/, parse: (m) => ({ apfFreq: +m[1] }), sim: 'CO030025' },
      { cmd: 'CO13;', when: (st) => /^CW/.test(st.modeB || ''), re: /^CO13(\d{4})$/, parse: (m) => ({ apfFreqB: +m[1] }), sim: 'CO130025' },
      { cmd: 'RA1;', re: /^RA1([0-3])$/, parse: (m) => ({ attB: +m[1] }), sim: 'RA10' },
      { cmd: 'PA1;', re: /^PA1([0-2])$/, parse: (m) => ({ preampB: +m[1] }), sim: 'PA10' },
      // Filtre de toit (ROOFING) : réglé par RF P1 1–5, relu en RF P1 6–A (12 kHz, 3 kHz, 1,2 kHz, 600 Hz, 300 Hz)
      { cmd: 'RF0;', re: /^RF0([6-9A])$/, parse: (m) => ({ roof: '6789A'.indexOf(m[1]) + 1 }), sim: 'RF06' },
      { cmd: 'RF1;', re: /^RF1([6-9A])$/, parse: (m) => ({ roofB: '6789A'.indexOf(m[1]) + 1 }), sim: 'RF16' },
      // MIC EQ (égaliseur paramétrique du TRX) : PR1 1 = coupé, PR1 2 = en service
      { cmd: 'PR1;', re: /^PR1([12])$/, parse: (m) => ({ micEq: m[1] === '2' ? 1 : 0 }), sim: 'PR11' },
      // Face avant (page /ftdx101) : volume du récepteur SUB (AF GAIN P1 = 1), BREAK-IN (BI), manipulateur électronique (KR)
      { cmd: 'AG1;', re: /^AG1(\d{3})$/, parse: (m) => ({ afB: +m[1] }), sim: 'AG1128' },
      { cmd: 'BI;', re: /^BI([01])$/, parse: (m) => ({ bkin: +m[1] }), sim: 'BI0' },
      { cmd: 'KR;', re: /^KR([01])$/, parse: (m) => ({ keyer: +m[1] }), sim: 'KR0' },
      // VC TUNE (présélecteur) : VT P1 P2 P5P5P5 P6 (P1 0 MAIN / 1 SUB, P2 marche, P5 position 000-255, P6 0 = pas installé)
      { cmd: 'VT0;', re: /^VT0([01])(\d{3})?(\d)?/, parse: (m) => ({ vc: +m[1], vcPos: m[2] != null ? +m[2] : null, vcOk: m[3] == null ? null : +m[3] }), sim: 'VT001281' },
      { cmd: 'VT1;', re: /^VT1([01])(\d{3})?(\d)?/, parse: (m) => ({ vcB: +m[1], vcPosB: m[2] != null ? +m[2] : null, vcOkB: m[3] == null ? null : +m[3] }), sim: 'VT101281' },
      // Menu FUNC de la face avant : MONI LEVEL (ML1), VOX GAIN (VG), VOX DELAY (VD, ms), ANTI VOX (AV),
      // décalage relais FM (OS P1 : 0 simplex, 1 +, 2 −), CTCSS (CT P1 : 0 OFF, 1 ENC/DEC, 2 ENC) — en FM seulement (le TRX refuse sinon),
      // tonalité CTCSS (CN P1 0 P3P3P3 : numéro 000–049)
      // FAST (accord rapide du grand bouton) : FS P1 0 = OFF, 1 = ON
      // FAST (manuel CAT FTDX101) : réglage FS0 / FS1 = MAIN OFF / ON, FS2 / FS3 = SUB OFF / ON ;
      // lecture « FS4 »…« FS7 » : bit 1 = MAIN, bit 2 = SUB → FAST affiché = celui du côté sélectionné (derive)
      { cmd: 'FS;', re: /^FS([0-7])$/, parse: (m) => ({ fastA: +m[1] & 1, fastB: (+m[1] >> 1) & 1 }), sim: 'FS4' },
      { cmd: 'ML1;', re: /^ML1(\d{3})$/, parse: (m) => ({ moniLvl: +m[1] }), sim: 'ML1050' },
      { cmd: 'VG;', re: /^VG(\d{3})$/, parse: (m) => ({ voxGain: +m[1] }), sim: 'VG050' },
      { cmd: 'VD;', re: /^VD(\d{2,4})$/, parse: (m) => ({ voxDelay: +m[1] }), sim: 'VD0500' },
      { cmd: 'AV;', re: /^AV(\d{3})$/, parse: (m) => ({ antiVox: +m[1] }), sim: 'AV050' },
      { cmd: 'OS0;', when: (st) => /FM/.test(st.mode || ''), re: /^OS0([0-2])$/, parse: (m) => ({ rpt: +m[1] }), sim: 'OS00' },
      { cmd: 'OS1;', when: (st) => /FM/.test(st.modeB || ''), re: /^OS1([0-2])$/, parse: (m) => ({ rptB: +m[1] }), sim: 'OS10' },
      { cmd: 'CT0;', when: (st) => /FM/.test(st.mode || ''), re: /^CT0([0-2])$/, parse: (m) => ({ encDec: +m[1] }), sim: 'CT00' },
      { cmd: 'CT1;', when: (st) => /FM/.test(st.modeB || ''), re: /^CT1([0-2])$/, parse: (m) => ({ encDecB: +m[1] }), sim: 'CT10' },
      { cmd: 'CN00;', when: (st) => /FM/.test(st.mode || ''), re: /^CN00(\d{3})$/, parse: (m) => ({ toneIdx: +m[1] }), sim: 'CN00012' },
      { cmd: 'CN10;', when: (st) => /FM/.test(st.modeB || ''), re: /^CN10(\d{3})$/, parse: (m) => ({ toneIdxB: +m[1] }), sim: 'CN10012' }
    ],
    extraQueries: ['RF0;', 'RF1;', 'ID;', 'IF;', 'AN0;', 'AN1;', 'FR;', 'FT;', 'SM1;', 'RM1;', 'RM2;', 'RM9;'],
    extraStateKeys: ['fastA', 'fastB', 'clarA', 'ritA', 'xitA', 'clarB', 'ritB', 'xitB', 'lockB', 'lockRaw', 'fastStep', 'moniLvl', 'voxGain', 'voxDelay', 'antiVox', 'rpt', 'rptB', 'encDec', 'encDecB', 'toneIdx', 'toneIdxB', 'nbLvlB', 'nrLvlB', 'mpvd', 'contourFreq', 'contourFreqB', 'apfFreq', 'apfFreqB', 'vc', 'vcB', 'vcPos', 'vcPosB', 'vcOk', 'vcOkB', 'afB', 'bkin', 'keyer', 'micEq', 'roof', 'roofB', 'nbLvl', 'nrLvl', 'attB', 'preampB', 'notchFreqB', 'shiftB', 'contourB', 'apfB', 'widthB', 'nbB', 'nrB', 'notchB', 'dnfB', 'narrowB', 'agcB', 'rfB'],
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
      // LOCK (manuel CAT FTDX101) : LK0 / LK1 = MAIN OFF / ON, LK2 / LK3 = SUB OFF / ON ; lecture LK4…LK7 (bits MAIN, SUB)
      lock: { write: (v) => 'LK' + (v ? 1 : 0) + ';' },
      tuner: { write: (v) => 'AC00' + v + ';' },
      tune: { write: () => 'AC002;' }
    },
    extraControls: [
      { id: 'lockB', g: 'vfo', label: 'LOCK (SUB)', type: 'toggle', face: true, write: (v) => 'LK' + (v ? 3 : 2) + ';' },
      { id: 'fastStep', g: 'rx', label: 'FAST', type: 'toggle', face: true, write: (v, st) => 'FS' + ((st && st.vfoSel === 1 ? 2 : 0) + (v ? 1 : 0)) + ';' }, // côté sélectionné
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
      { id: 'keyer', g: 'tx', label: 'KEYER', type: 'toggle', face: true, write: (v) => 'KR' + v + ';' },
      // VC TUNE : marche / arrêt (pas de déplacement : +0), puis MULTI déplace l'accord du présélecteur (+ / − 1 pas)
      { id: 'nbLvlB', g: 'flt', label: 'Niveau NB (VFO B)', type: 'level', min: 0, max: 10, step: 1, face: true, write: (v) => 'NL1' + pad(v, 3) + ';' },
      { id: 'nrLvlB', g: 'flt', label: 'Niveau DNR (VFO B)', type: 'level', min: 1, max: 15, step: 1, face: true, write: (v) => 'RL1' + pad(v, 2) + ';' },
      // VFO d'émission (touches TX MAIN / TX SUB de la face avant) : FT0 = MAIN, FT1 = SUB
      { id: 'txVfo', g: 'vfo', label: 'TX sur le SUB', type: 'toggle', face: true, write: (v) => 'FT' + (v ? 3 : 2) + ';' }, // FT2 = TX sur MAIN, FT3 = TX sur SUB (Hamlib)
      { id: 'mpvd', g: 'vfo', label: 'Bague du grand bouton (MPVD)', type: 'select', face: true, options: [[1, 'CLAR'], [2, 'VC TUNE'], [3, 'SUB'], [4, 'CS']], write: (v) => 'SF0' + v + ';' },
      { id: 'contourFreq', g: 'flt', label: 'Fréquence CONTOUR', type: 'level', min: 10, max: 3200, step: 10, unit: 'Hz', face: true, write: (v) => 'CO01' + pad(v, 4) + ';' },
      { id: 'contourFreqB', g: 'flt', label: 'Fréquence CONTOUR (VFO B)', type: 'level', min: 10, max: 3200, step: 10, unit: 'Hz', face: true, write: (v) => 'CO11' + pad(v, 4) + ';' },
      { id: 'apfFreq', g: 'flt', label: 'Fréquence APF', type: 'level', min: 0, max: 50, step: 1, face: true, fmt: apfHz, write: (v) => 'CO03' + pad(v, 4) + ';' },
      { id: 'apfFreqB', g: 'flt', label: 'Fréquence APF (VFO B)', type: 'level', min: 0, max: 50, step: 1, face: true, fmt: apfHz, write: (v) => 'CO13' + pad(v, 4) + ';' },
      { id: 'vc', g: 'rx', label: 'VC TUNE (MAIN)', type: 'toggle', face: true, write: (v) => 'VT0' + v + '+0;' },
      { id: 'vcB', g: 'rx', label: 'VC TUNE (SUB)', type: 'toggle', face: true, write: (v) => 'VT1' + v + '+0;' },
      { id: 'vcUp', g: 'rx', label: 'VC TUNE + (MAIN)', type: 'action', face: true, write: () => 'VT01+1;' },
      { id: 'vcDn', g: 'rx', label: 'VC TUNE − (MAIN)', type: 'action', face: true, write: () => 'VT01-1;' },
      { id: 'vcUpB', g: 'rx', label: 'VC TUNE + (SUB)', type: 'action', face: true, write: () => 'VT11+1;' },
      { id: 'vcDnB', g: 'rx', label: 'VC TUNE − (SUB)', type: 'action', face: true, write: () => 'VT11-1;' },
      // Menu FUNC (face avant)
      { id: 'moniLvl', g: 'tx', label: 'MONI LEVEL', type: 'level', min: 0, max: 100, step: 1, face: true, write: (v) => 'ML1' + pad(v, 3) + ';' },
      { id: 'voxGain', g: 'tx', label: 'VOX GAIN', type: 'level', min: 0, max: 100, step: 1, face: true, write: (v) => 'VG' + pad(v, 3) + ';' },
      { id: 'voxDelay', g: 'tx', label: 'VOX DELAY', type: 'level', min: 30, max: 3000, step: 10, unit: 'ms', face: true, write: (v) => 'VD' + pad(v, 4) + ';' },
      { id: 'antiVox', g: 'tx', label: 'ANTI VOX', type: 'level', min: 0, max: 100, step: 1, face: true, write: (v) => 'AV' + pad(v, 3) + ';' },
      { id: 'rpt', g: 'vfo', label: 'RPT (MAIN)', type: 'select', face: true, options: [[0, 'SIMP'], [1, '+'], [2, '−']], write: (v) => 'OS0' + v + ';' },
      { id: 'rptB', g: 'vfo', label: 'RPT (SUB)', type: 'select', face: true, options: [[0, 'SIMP'], [1, '+'], [2, '−']], write: (v) => 'OS1' + v + ';' },
      { id: 'encDec', g: 'vfo', label: 'ENC/DEC (MAIN)', type: 'select', face: true, options: ENCDEC, write: (v) => 'CT0' + v + ';' },
      { id: 'encDecB', g: 'vfo', label: 'ENC/DEC (SUB)', type: 'select', face: true, options: ENCDEC, write: (v) => 'CT1' + v + ';' },
      { id: 'toneIdx', g: 'vfo', label: 'TONE FREQ (MAIN)', type: 'level', min: 0, max: 49, step: 1, face: true, write: (v) => 'CN00' + pad(v, 3) + ';' },
      { id: 'toneIdxB', g: 'vfo', label: 'TONE FREQ (SUB)', type: 'level', min: 0, max: 49, step: 1, face: true, write: (v) => 'CN10' + pad(v, 3) + ';' },
      { id: 'rfB', g: 'rx', label: 'RF gain (VFO B)', type: 'level', min: 0, max: 255, step: 1, pct: true, write: (v) => 'RG1' + pad(v, 3) + ';' }
    ],
    fakeTuning: 'AC002',
    // Simulateur : clarifier (RT / XT / RC / RU / RD) relu dans IF
    fakeCmd(f, c, out) {
      // Un clarifier par côté ; les réglages vont au côté sélectionné (VS)
      const ka = f.clar101 || (f.clar101 = { off: 0, rit: 0, xit: 0 }), kb = f.clar101B || (f.clar101B = { off: 0, rit: 0, xit: 0 });
      const k = f.ans && f.ans['VS;'] === 'VS1' ? kb : ka;
      let m;
      if (c === 'IF') { out.push('IF001' + pad(f.freq, 9) + (ka.off < 0 ? '-' : '+') + pad(ka.off, 4) + ka.rit + ka.xit + f.mode + '00000;'); return true; }
      // FAST et LOCK : un bit par côté (MAIN = 1, SUB = 2), lus « FS4 »…« FS7 » / « LK4 »…« LK7 »
      if ((m = /^(FS|LK)([0-3])$/.exec(c))) { const k = m[1] === 'FS' ? 'fs101' : 'lk101', bit = +m[2] >> 1 ? 2 : 1; f[k] = ((f[k] || 0) & ~bit) | (+m[2] & 1 ? bit : 0); return true; }
      if (c === 'FS' || c === 'LK') { out.push(c + (4 + (f[c === 'FS' ? 'fs101' : 'lk101'] || 0)) + ';'); return true; }
      if (c === 'OI') { out.push('OI001' + pad(f.freqB || 7074000, 9) + (kb.off < 0 ? '-' : '+') + pad(kb.off, 4) + kb.rit + kb.xit + (f.modeB || '2') + '00000;'); return true; }
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
