/*
 * faces/ftdx5000.js — face avant du Yaesu FTDX5000 pour la page https://remote.op0p.be/ftdx5000
 *
 * Image : faces/ftdx5000.webp (2200 × 1368, affichée en 1100 × 684) = face avant dessinée par le logiciel Yaesu PCC-5000
 * (vue de face, 1018 × 318, agrandie à 1100 de large), et dessous : à gauche une réplique de l'afficheur, à droite le cadre
 * de l'écran de la page (mètres, fréquences, scope de la BF reçue).
 * Dans l'afficheur de la photo, tout ce qui s'allume a été éteint : la page le rallume selon l'état du TRX (FACE.glows :
 * éclaircissement des mots et valeurs déjà dessinés ; FACE.texts : fréquences et clarifier).
 * Positions relevées sur l'image d'origine 1018 × 318, puis multipliées par K (= 1100 / 1018). ?zones=1 : contours visibles.
 * Deux récepteurs (MAIN = VFO-A, SUB = VFO-B), comme le FTDX101. Même format que faces/ftdx101.js (act / led / leds / knobs).
 * Pilote CAT en essai (pas encore vu sur un vrai FTDX5000) : les touches sans commande CAT donnent une explication.
 */
(function () {
  'use strict';
  const F = window.RS_FACES = window.RS_FACES || {};
  const info = (t) => ({ info: t });
  const OR = '#ff9a1f';
  const K = 1100 / 1018;
  // Positions de l'image d'origine → positions affichées (récursif : voyants des touches)
  const SC = (o) => {
    for (const k of ['x', 'y', 'w', 'h', 'cx', 'cy', 'r', 'ro', 'ri', 'ix', 'iy', 'size']) if (typeof o[k] === 'number') o[k] = +(o[k] * K).toFixed(2);
    if (o.leds) o.leds.forEach(SC);
    return o;
  };
  // 14250000 → « 14.250.000 »
  const fmtF = (hz) => { const t = String(Math.round(hz)).padStart(7, '0'); return t.slice(0, -6) + '.' + t.slice(-6, -3) + '.' + t.slice(-3); };
  // Voyant d'une touche : petit trait orange au milieu, en bas de la touche
  const dot = (k, on, color) => [{ x: k.x + k.w / 2 - 5, y: k.y + k.h - 3.5, w: 10, h: 2.2, color: color || OR, on, bright: on }];
  const key = (o) => Object.assign(o, o.on ? { leds: dot(o, o.on, o.ledColor) } : {});
  // Touches de bande (3 colonnes × 4 rangées)
  const COLS = [662, 702, 740], ROWS = [26, 47, 70, 94];
  const BANDS = [['1.8', '160M'], ['3.5', '80M'], ['7.0', '40M'], ['10', '30M'], ['14', '20M'], ['18', '17M'], ['21', '15M'], ['24.5', '12M'], ['28/29', '10M'],
    ['GEN', null], ['50', '6M'], ['ENT', null]];
  const bandKeys = BANDS.map(([lab, b], i) => {
    const k = { id: 'band' + lab.replace(/\W/g, ''), x: COLS[i % 3], y: ROWS[Math.floor(i / 3)], w: 30, h: 13 };
    if (!b) return Object.assign(k, lab === 'GEN' ? { tip: 'GEN : couverture générale — tableau des bandes sur l’écran', act: { local: 'bandMenu' } } : { tip: 'ENT', act: info('ENT : entrée directe de fréquence — tapez-la dans la case kHz du VFO, sous l’écran, ou cliquez sur un spot.') });
    return key(Object.assign(k, { tip: 'Bande ' + lab + ' MHz (VFO actif : A ou B)', act: { band: b }, on: (s, L) => L.bandOf(s.vfoSel === 1 ? s.freqB : s.freq) === b }));
  });
  // Touches de mode (le récepteur actif)
  const modeKey = (id, x, y, w, lab, list, test) => key({ id, x, y, w, h: 16, tip: lab, act: { mode: list }, on: (s, L) => test.test(L.activeMode(s) || '') });
  // Réglages DSP d'un côté (A = MAIN, B = SUB) : VRF, SHIFT, CONT/APF / NOTCH, WIDTH, RESET
  function dsp(xs, sd) {
    const b = sd === 'B' ? 'B' : '', nm = sd === 'B' ? 'VFO-B (SUB)' : 'VFO-A (MAIN)';
    return [
      { id: 'vrf' + sd, x: xs[0], y: 170, w: 20, h: 11, tip: 'VRF/μ-T ' + nm, act: info('VRF / μ-TUNE (présélecteur) : pas de commande CAT dans le manuel du FTDX5000, réglage au club.') },
      key({ id: 'shift' + sd, x: xs[1], y: 170, w: 20, h: 11, tip: 'SHIFT ' + nm + ' : se règle avec le centre du bouton dessous ; clic : SHIFT à 0', act: { set: ['shift' + b, 0] }, on: (s) => !!s['shift' + b] }),
      { id: 'cont' + sd, x: xs[2], y: 170, w: 20, h: 11, tip: 'CONT/APF ' + nm, act: info('CONTOUR / APF : pas encore relié pour le FTDX5000 (format CAT à vérifier sur le TRX).') },
      key({ id: 'notch' + sd, x: xs[0], y: 196, w: 20, h: 12, tip: 'NOTCH ' + nm + ' (manuel)', act: { toggle: 'notch' + b }, on: (s) => !!s['notch' + b] }),
      key({ id: 'width' + sd, x: xs[1], y: 196, w: 20, h: 12, tip: 'WIDTH ' + nm + ' : se règle avec la bague du bouton dessous ; clic : NARROW', act: { toggle: 'narrow' + b }, on: (s) => !!s['narrow' + b] }),
      { id: 'reset' + sd, x: xs[2], y: 196, w: 20, h: 12, tip: 'RESET ' + nm + ' : SHIFT à 0 et NARROW coupé', act: { set: ['shift' + b, 0], long: { set: ['narrow' + b, 0] } } }
    ];
  }
  const dspDots = (x1, x2, y, sd) => {
    const b = sd === 'B' ? 'B' : '';
    return [
      { id: 'dnr' + sd, cx: x1, cy: y, r: 6, tip: 'DNR ' + (sd === 'B' ? 'VFO-B' : 'VFO-A') + ' — appui d’au moins 1 s : niveau DNR', act: Object.assign({ toggle: 'nr' + b }, b ? {} : { long: { pop: 'nrLvl' } }), led: (s) => !!s['nr' + b], ledColor: '#ff3b30' },
      { id: 'dnf' + sd, cx: x2, cy: y, r: 6, tip: 'DNF ' + (sd === 'B' ? 'VFO-B' : 'VFO-A') + ' (notch automatique)', act: { toggle: 'dnf' + b }, led: (s) => !!s['dnf' + b], ledColor: '#ff3b30' }
    ];
  };
  // Petits afficheurs VFO-A / VFO-B (au-dessus des boutons SHIFT ◎ WIDTH) : largeur du filtre et décalage SHIFT
  const wtxt = (s, b) => {
    if (b && s.dualRx === 0) return '';
    const R = window.RIGS && window.RIGS.ftdx5000;
    const t = R && R.widthTable(b ? s.modeB : s.mode), w = b ? s.widthB : s.width, hz = t && w ? t[w - 1] : null, sh = b ? s.shiftB : s.shift;
    const wk = hz ? (hz >= 1000 ? (hz / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + 'k' : String(hz)) : '';
    return (s['narrow' + b] ? 'NAR' : wk ? 'BW ' + wk : '') + (sh ? '   SHIFT ' + (sh > 0 ? '+' : '') + sh : '');
  };
  // ------------------------------------------------------------------ afficheur de la photo, allumé selon l'état du TRX
  // Couleurs « color-dodge » : jaune = valeur choisie (texte), blanc = case de mode / état, rouge = TUNER / HI-SWR
  const GT = '#b8b84d', GB = '#bfd1e6', GR = '#bf0000';
  const MROW = [[33, 39], [41, 47], [49, 55], [57, 63]], SROW = [[75, 81], [81.5, 87], [87.5, 93], [93.5, 99]];
  const glow = (x0, x1, y0, y1, color, on) => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, color, on });
  const ipoRow = [2, 0, 1, 3]; // préampli 0 IPO1, 1 AMP1, 2 AMP2, 3 IPO2 → rangée AMP1, AMP2, IPO1, IPO2
  const agcRow = (v) => (v === 4 ? 0 : v >= 1 && v <= 3 ? v : -1); // AUTO, FAST, MID, SLOW
  const sideMode = (s, b) => (b ? s.modeB : s.mode) || '';
  const GLOWS = [];
  [['', MROW, [27, 33], [35, 41], [43, 49], [51, 57]], ['B', SROW, [68, 74], [76, 82], [84, 90], [92, 98]]].forEach(([b, R, w1, w2, w3, w4]) => {
    const live = (s) => !b || s.dualRx !== 0;
    for (let i = 0; i < 4; i++) {
      if (!b) GLOWS.push(glow(262, 270, R[i][0], R[i][1], GT, (s) => s.ant === i + 1));
      GLOWS.push(glow(278, 297, R[i][0], R[i][1], GT, (s) => live(s) && s['att' + b] === i));
      GLOWS.push(glow(332, 352, R[i][0], R[i][1], GT, (s) => live(s) && ipoRow[s['preamp' + b]] === i));
      GLOWS.push(glow(382, 404, R[i][0], R[i][1], GT, (s) => live(s) && agcRow(s['agc' + b]) === i));
    }
    const tx = (s) => !!s.tx && (s.txVfo === 1) === !!b;
    const m = (re) => (s) => live(s) && re.test(sideMode(s, b));
    GLOWS.push(
      glow(408, 426, w1[0], w1[1], GR, tx),
      glow(428, 442, w1[0], w1[1], GB, m(/^(LSB|DATA-L|RTTY-L)$/)), glow(442, 455, w1[0], w1[1], GB, m(/^(USB|DATA-U|RTTY-U)$/)), glow(456, 469, w1[0], w1[1], GB, m(/^CW/)),
      glow(408, 426, w2[0], w2[1], GB, (s) => live(s) && (b ? s.smeterB : s.smeter) >= 26),
      glow(428, 439, w2[0], w2[1], GB, m(/^AM/)), glow(439, 451, w2[0], w2[1], GB, m(/^(FM|FM-N|DATA-FM)$/)), glow(452, 469, w2[0], w2[1], GB, (s) => live(s) && !!s['narrow' + b]),
      glow(408, 426, w3[0], w3[1], GB, (s, L) => !b && !!L.fast), glow(428, 447, w3[0], w3[1], GB, m(/^RTTY/)), glow(448, 462, w3[0], w3[1], GB, m(/^DATA/)),
      glow(408, 426, w4[0], w4[1], GB, (s) => !!s['lock' + b]), glow(428, 439, w4[0], w4[1], GB, (s) => live(s) && !!s['nb' + b])
    );
  });
  GLOWS.push(
    glow(487, 507, 25, 33, GB, () => !!(window.RSVOICE && window.RSVOICE.monitorOn())), glow(512, 535, 25, 33, GB, (s) => !!s.keyer),
    glow(538, 562, 25, 33, GB, (s) => !!s.bkin), glow(563, 587, 25, 33, GB, (s) => !!s.proc), glow(590, 615, 25, 33, GR, (s) => !!(s.tuner || s.tuning)),
    glow(616, 640, 25, 33, GR, (s) => !!s.tx && s.m6 != null && s.m6 >= 160)
  );
  // Réplique de l'afficheur principal du FTDX5000, en bas à gauche, sur le modèle de l'afficheur du TRX (cadre, étiquettes,
  // cases éteintes et échelles dessinés dans l'image) : valeurs MAIN / SUB (ANT, ATT, FLT, IPO, R.FLT, AGC), BUSY, mode, NAR,
  // PROC, S-mètre du SUB, FAST, LOCK, NB, fréquence du VFO-A, clarifier ; voyants TX / DUAL / SPLIT / NAR / LOCK / FAST / CLAR
  const FONT = (px) => '700 ' + px + 'px DejaVu Sans,Arial,sans-serif';
  const YEL = '#e8f040';
  const ATTS = ['OFF', '-6dB', '-12dB', '-18dB'], IPOS = ['IPO1', 'AMP1', 'AMP2', 'IPO2'], AGCS = ['OFF', 'FAST', 'MID', 'SLOW', 'AUTO'];
  const MODE_TXT = { 'CW-U': 'CW', 'CW-L': 'CW-R', 'RTTY-L': 'RTTY', 'RTTY-U': 'RTTY-R', 'DATA-U': 'PKT-U', 'DATA-L': 'PKT-L', 'DATA-FM': 'PKT-FM' };
  const modeTxt = (m) => MODE_TXT[m] || m || '';
  const subOn = (s) => s.dualRx !== 0;
  const XS = [35, 69, 105, 143, 183, 223];
  const cellsOf = (b) => [(s) => (s.ant != null ? String(s.ant) : ''), (s) => ATTS[s['att' + b]] || '', () => '', (s) => IPOS[s['preamp' + b]] || '', () => '', (s) => AGCS[s['agc' + b]] || ''];
  const VFD = [];
  [['', 398], ['B', 456]].forEach(([b, y]) => cellsOf(b).forEach((fn, i) => VFD.push({ x: XS[i], y, anchor: 'middle', color: YEL, font: FONT(11), text: (s) => (b && !subOn(s) ? '' : fn(s)) })));
  const lit = (lab, x, y, on, color, px) => ({ x, y, anchor: 'middle', color: color || '#f2f4f8', font: FONT(px || 8), text: (s, L) => (on(s, L) ? lab : '') });
  const bars = (v) => (v == null ? '' : '▮'.repeat(Math.max(0, Math.min(30, Math.round(v / 255 * 30)))));
  const ind = (lab, x, on, color) => ({ x, y: 522, anchor: 'middle', color: color || '#ffb347', font: FONT(11), text: (s, L) => (on(s, L) ? lab : '') });
  VFD.push(
    // MAIN : BUSY, mode, NAR, PROC
    lit('BUSY', 263, 396.6, (s) => s.smeter != null && s.smeter >= 26 && !s.tx),
    { x: 307, y: 380, anchor: 'middle', color: '#f2f4f8', font: FONT(8), text: (s) => modeTxt(s.mode) },
    lit('NAR', 338, 380, (s) => !!s.narrow), lit('PROC', 437, 380, (s) => !!s.proc, '#ff5040'),
    // Fréquence du VFO-A (grands 7 segments), et le VFO actif
    { seg: true, x: 496, y: 389, size: 32, color: '#9fb2ff', text: (s) => (s.freq ? fmtF(s.freq) : '') },
    { x: 496, y: 381, anchor: 'end', color: '#ff7a6a', font: FONT(9), text: (s) => (s.vfoSel === 1 ? 'VFO-B ◀' : '') },
    // SUB : S-mètre, mode, BUSY / FAST / LOCK, NB
    { x: 22, y: 431, anchor: 'start', color: '#7fb0ff', font: FONT(9), text: (s) => (subOn(s) ? bars(s.smeterB) : '') },
    { x: 265, y: 418, anchor: 'middle', color: '#f2f4f8', font: FONT(8), text: (s) => (subOn(s) ? modeTxt(s.modeB) : '') },
    lit('BUSY', 263, 444.6, (s) => subOn(s) && s.smeterB != null && s.smeterB >= 26), lit('FAST', 263, 456.6, (s, L) => !!L.fast),
    lit('LOCK', 263, 468.6, (s) => !!(s.lock || s.lockB)), lit('NB', 232, 468.6, (s) => subOn(s) && !!s.nbB),
    { x: 280, y: 400, anchor: 'end', color: '#7fb0ff', font: FONT(9), text: (s) => (subOn(s) ? '' : 'SUB OFF') },
    // Clarifier : RX / TX et décalage
    { x: 450, y: 456, anchor: 'start', color: '#9fd88a', font: FONT(9), text: (s) => (s.rit && s.xit ? 'RX TX' : s.rit ? 'RX' : s.xit ? 'TX' : '') },
    { x: 496, y: 474, anchor: 'end', color: YEL, font: FONT(14), text: (s) => ((s.clar || 0) < 0 ? '−' : '') + (Math.abs(s.clar || 0) / 1000).toFixed(3) },
    { x: 352, y: 452, anchor: 'middle', color: '#ff4a3a', font: FONT(10), text: (s) => '▼' },
    // Voyants sous l'afficheur
    ind('TX', 34, (s) => !!s.tx, '#ff4a3a'), ind('DUAL', 80, (s) => !!s.dualRx), ind('SPLIT', 133, (s) => !!s.split), ind('NAR', 184, (s) => !!(s.vfoSel === 1 ? s.narrowB : s.narrow)),
    ind('LOCK', 230, (s) => !!(s.vfoSel === 1 ? s.lockB : s.lock)), ind('FAST', 277, (s, L) => !!L.fast), ind('RX CLAR', 338, (s) => !!s.rit), ind('TX CLAR', 405, (s) => !!s.xit)
  );
  F.ftdx5000 = {
    model: 'ftdx5000',
    name: 'Yaesu FTDX5000',
    image: '/faces/ftdx5000.webp',
    w: 1100,
    h: 684,
    // Écran de la page : dans le cadre dessiné sous la face avant, à droite
    lcd: { x: 522, y: 356, w: 570, h: 321 },
    // Cases de l'écran (pas de R.FLT par CAT) ; préampli IPO1 / AMP1 / AMP2 / IPO2
    cells: [['ANT', 'ant'], ['ATT', 'att'], ['IPO', 'preamp'], ['AGC', 'agc']],
    ipo: ['IPO1', 'AMP1', 'AMP2', 'IPO2'],
    modes: [['LSB', 'USB', 'CW-L', 'CW-U'], ['AM', 'FM', 'FM-N', null], ['DATA-L', 'DATA-U', 'DATA-FM', null], ['RTTY-L', 'RTTY-U', null, null]],
    cycle: ['LSB', 'USB', 'CW-U', 'CW-L', 'AM', 'FM', 'DATA-U', 'DATA-L', 'RTTY-L', 'RTTY-U'],
    glows: GLOWS.map(SC),
    // Afficheurs de la photo remplis en direct (VFO-A en 7 segments, clarifier, VFO-B, filtres A / B), puis la réplique
    texts: [
      { seg: true, x: 641, y: 41, size: 28, color: '#93a6ff', text: (s) => (s.freq ? fmtF(s.freq) : '') },
      { x: 640, y: 99, size: 13, anchor: 'end', color: '#f0f040', font: '700 13px DejaVu Sans,Arial,sans-serif', text: (s) => (Math.abs(s.clar || 0) / 1000).toFixed(3) },
      { x: 762, y: 150, size: 17, anchor: 'end', color: '#f2f4f8', font: '700 17px DejaVu Sans,Arial,sans-serif', text: (s) => (s.freqB ? fmtF(s.freqB) : '') },
      { x: 838, y: 147, size: 10, anchor: 'middle', color: '#7fb0ff', font: '700 10px DejaVu Sans,Arial,sans-serif', text: (s) => wtxt(s, '') },
      { x: 956, y: 147, size: 10, anchor: 'middle', color: '#7fb0ff', font: '700 10px DejaVu Sans,Arial,sans-serif', text: (s) => wtxt(s, 'B') }
    ].map((t) => SC(Object.assign(t, t.font ? { font: t.font.replace(/(\d+)px/, (m, n) => (n * K).toFixed(1) + 'px') } : {}))).concat(VFD),
    // Voyants RX (vert) et TX (rouge) au-dessus du grand bouton
    leds: [
      { x: 450, y: 140.5, w: 15, h: 4.5, color: '#3ddc5a', on: (s) => !!s.connected && !s.tx && !s.mainMute, bright: (s) => !!s.connected && !s.tx && !s.mainMute },
      { x: 566, y: 140.5, w: 15, h: 4.5, color: '#ff3b30', on: (s) => !!s.tx, bright: (s) => !!s.tx }
    ].map(SC),
    keys: bandKeys.concat(dsp([790, 825, 860], 'A'), dsp([910, 945, 980], 'B'), dspDots(790, 885, 232, 'A'), dspDots(907, 1002, 232, 'B'), [
      { id: 'onoff', x: 18, y: 35, w: 25, h: 34, tip: 'ON/OFF : la mise en marche se fait au club', act: info('Le TRX ne s’allume et ne s’éteint qu’au club.') },
      { id: 'com', x: 18, y: 86, w: 23, h: 15, tip: 'COM', act: info('COM : réglage au club.') },
      { id: 'meterArea', x: 48, y: 24, w: 184, h: 76, tip: 'Galvanomètre du TRX : les mesures (S, PO, ALC, SWR…) sont sur l’écran de la page, dessous', act: info('Les mesures du TRX (S-mètre, PO, ALC, COMP, SWR, Id, Vdd) sont sur l’écran de la page, sous la face avant.') },
      // Bloc de gauche
      { id: 'dim', x: 22, y: 150, w: 24, h: 15, tip: 'DIM', act: info('DIM (luminosité des afficheurs) : réglage au club.') },
      key({ id: 'tune', x: 58, y: 150, w: 24, h: 15, tip: 'TUNE : coupleur d’antenne en service / hors service ; appui d’au moins 1 s : accord (émission courte, avec la main)', act: { toggle: 'tuner', long: { action: 'tune' } }, on: (s) => !!(s.tuner || s.tuning) }),
      key({ id: 'mox', x: 22, y: 181, w: 24, h: 16, tip: 'MOX : émission maintenue (clic : émission, clic suivant : réception) ; avec votre micro si « MICRO » est actif', act: { local: 'mox' }, on: (s, L) => !!L.mox, ledColor: '#ff3b30' }),
      key({ id: 'moni', x: 58, y: 181, w: 24, h: 16, tip: 'MONI : entendre sa propre modulation (« M’écouter », au casque, page TRX SSB)', act: { local: 'moni' }, on: () => !!(window.RSVOICE && window.RSVOICE.monitorOn()) }),
      key({ id: 'vox', x: 22, y: 212, w: 24, h: 16, tip: 'VOX (ne peut être que coupé à distance)', act: { toggle: 'vox' }, on: (s) => !!s.vox }),
      key({ id: 'proc', x: 58, y: 212, w: 24, h: 16, tip: 'PROC : processeur de modulation', act: { toggle: 'proc' }, on: (s) => !!s.proc }),
      { id: 'rxAnt', x: 108, y: 152, w: 23, h: 24, tip: 'RX (antenne de réception séparée)', act: info('RX ANT : prise d’antenne de réception séparée, réglage au club.') },
      key({ id: 'ant', x: 150, y: 152, w: 29, h: 24, tip: 'ANT 1-4 : antenne suivante (pas pendant une émission)', act: { cycle: 'ant' }, on: (s) => s.ant != null && s.ant > 1 }),
      key({ id: 'att', x: 192, y: 152, w: 28, h: 24, tip: 'ATT : OFF → 6 → 12 → 18 dB (récepteur MAIN)', act: { cycle: 'att' }, on: (s) => !!s.att }),
      key({ id: 'ipo', x: 249, y: 152, w: 28, h: 24, tip: 'IPO : IPO1 → AMP1 → AMP2 → IPO2 (récepteur MAIN)', act: { cycle: 'preamp' }, on: (s) => s.preamp === 1 || s.preamp === 2 }),
      { id: 'rflt', x: 291, y: 152, w: 29, h: 24, tip: 'R.FLT (filtre de toit)', act: info('R.FLT (filtre de toit 300 Hz à 15 kHz) : pas encore relié pour le FTDX5000.') },
      key({ id: 'agc', x: 334, y: 152, w: 28, h: 24, tip: 'AGC : OFF → FAST → MID → SLOW → AUTO (récepteur MAIN)', act: { cycle: 'agc' }, on: (s) => s.agc != null && s.agc !== 4 }),
      { id: 'meterSel', cx: 130, cy: 212, r: 21, tip: 'METER : choix de la mesure du galvanomètre', act: info('METER : les mesures (PO, ALC, COMP, SWR, Id, Vdd) sont toutes sur l’écran de la page.') },
      // Autour du grand bouton
      key({ id: 'vfoA', x: 387, y: 147, w: 23, h: 13, tip: 'A : le grand bouton et les touches agissent sur le VFO-A (MAIN)', act: { set: ['vfoSel', 0] }, on: (s) => s.vfoSel !== 1, ledColor: '#ff6040' }),
      key({ id: 'vfoB', x: 412, y: 147, w: 23, h: 13, tip: 'B : le grand bouton et les touches agissent sur le VFO-B (SUB)', act: { set: ['vfoSel', 1] }, on: (s) => s.vfoSel === 1, ledColor: '#d8e4ff' }),
      { id: 'sto', x: 391, y: 170, w: 41, h: 12, tip: 'STO', act: info('Mémoires (STO / RCL) : pas encore reliées.') },
      { id: 'rcl', x: 391, y: 190, w: 41, h: 13, tip: 'RCL', act: info('Mémoires (STO / RCL) : pas encore reliées.') },
      key({ id: 'nar', x: 391, y: 212, w: 29, h: 14, tip: 'NAR : filtre étroit du récepteur actif', act: { toggleSide: 'narrow' }, on: (s) => !!(s.vfoSel === 1 ? s.narrowB : s.narrow) }),
      key({ id: 'split', x: 391, y: 233, w: 29, h: 14, tip: 'SPLIT : émission sur l’autre VFO (voyant TX rouge et fréquence d’émission en rouge)', act: { local: 'split' }, on: (s) => !!s.split }),
      { id: 'txw', x: 391, y: 254, w: 29, h: 14, tip: 'TXW', act: info('TXW (écoute de la fréquence d’émission) : pas encore relié pour le FTDX5000.') },
      { id: 'classA', x: 391, y: 278, w: 30, h: 13, tip: 'CLASS-A', act: info('CLASS-A (classe A de l’étage final) : réglage au club.') },
      { id: 'cs', x: 425, y: 278, w: 20, h: 13, tip: 'C.S', act: info('C.S (touche personnalisable) : pas disponible à distance.') },
      key({ id: 'fast', x: 589, y: 147, w: 27, h: 13, tip: 'FAST : accord rapide (1 kHz par cran)', act: { local: 'fast' }, on: (s, L) => !!L.fast }),
      key({ id: 'lock', x: 620, y: 147, w: 25, h: 13, tip: 'LOCK : verrouille le grand bouton du TRX (administrateurs)', act: { local: 'lock' }, on: (s) => !!(s.vfoSel === 1 ? s.lockB : s.lock) }),
      { id: 'aToB', x: 600, y: 167, w: 40, h: 13, tip: 'A ► B : copie le VFO-A dans le VFO-B', act: { action: 'aToB' } },
      { id: 'bToA', x: 600, y: 189, w: 40, h: 12, tip: 'A ◄ B : copie le VFO-B dans le VFO-A', act: { action: 'bToA' } },
      { id: 'vm', x: 600, y: 210, w: 40, h: 12, tip: 'V/M', act: info('Mémoires : pas encore reliées.') },
      { id: 'mToA', x: 600, y: 232, w: 40, h: 12, tip: 'M ► A', act: info('Mémoires : pas encore reliées.') },
      { id: 'aToM', x: 600, y: 253, w: 40, h: 13, tip: 'A ► M', act: info('Mémoires : pas encore reliées.') },
      { id: 'menu', x: 582, y: 278, w: 58, h: 14, tip: 'MENU : menu des fonctions sur l’écran (RF POWER, MONI, VOX…)', act: { local: 'func' }, led: (s, L) => L.func },
      // Modes et fonctions
      modeKey('lsb', 792, 26, 40, 'LSB', ['LSB'], /^LSB$/), modeKey('usb', 842, 26, 43, 'USB', ['USB'], /^USB$/),
      Object.assign(modeKey('cw', 792, 58, 40, 'CW : CW-U ⇄ CW-L', ['CW-U'], /^CW/), { act: { mode: 'cw' } }),
      modeKey('amfm', 842, 58, 43, 'AM/FM : AM ⇄ FM', ['AM', 'FM'], /^(AM|FM)/), modeKey('rtty', 792, 91, 40, 'RTTY : RTTY-L ⇄ RTTY-U', ['RTTY-L', 'RTTY-U'], /^RTTY/),
      modeKey('pkt', 842, 91, 43, 'PKT (DATA) : DATA-U → DATA-L → DATA-FM', ['DATA-U', 'DATA-L', 'DATA-FM'], /^DATA/),
      key({ id: 'nb', x: 912, y: 25, w: 38, h: 16, tip: 'NB du récepteur actif — appui d’au moins 1 s : niveau NB', act: { toggleSide: 'nb', long: { pop: 'nbLvl' } }, on: (s) => !!(s.vfoSel === 1 ? s.nbB : s.nb) }),
      { id: 'spot', x: 960, y: 25, w: 42, h: 16, tip: 'SPOT', act: info('SPOT (tonalité de repérage CW) : pas disponible à distance.') },
      key({ id: 'keyer', x: 912, y: 57, w: 38, h: 17, tip: 'KEYER : manipulateur électronique', act: { toggle: 'keyer' }, on: (s) => !!s.keyer }),
      key({ id: 'bkin', x: 960, y: 57, w: 42, h: 17, tip: 'BK-IN : break-in CW', act: { toggle: 'bkin' }, on: (s) => !!s.bkin }),
      { id: 'down', x: 912, y: 88, w: 38, h: 18, tip: 'DOWN : bande précédente', act: { local: 'bandDown' } },
      { id: 'up', x: 960, y: 88, w: 42, h: 18, tip: 'UP : bande suivante', act: { local: 'bandUp' } },
      // VFO-B : clarifier, CLEAR, A/B, RX / TX
      key({ id: 'rxClar', x: 667, y: 170, w: 25, h: 11, tip: 'RX CLAR (RIT) : le bouton CLAR/VFO-B règle alors le décalage', act: { toggle: 'rit' }, on: (s) => !!s.rit }),
      { id: 'clear', x: 704, y: 170, w: 25, h: 11, tip: 'CLEAR : décalage du clarifier à zéro', act: { action: 'clarClr' } },
      key({ id: 'txClar', x: 738, y: 170, w: 25, h: 11, tip: 'TX CLAR (XIT) : le bouton CLAR/VFO-B règle alors le décalage', act: { toggle: 'xit' }, on: (s) => !!s.xit }),
      { id: 'clarGrp', x: 667, y: 196, w: 25, h: 12, tip: 'CLAR/GRP', act: info('CLAR : allumez RX CLAR ou TX CLAR, puis tournez le bouton CLAR/VFO-B ; CLEAR remet à zéro.') },
      { id: 'bandMch', x: 704, y: 196, w: 25, h: 12, tip: 'BAND/MCH : tableau des bandes', act: { local: 'bandMenu' } },
      { id: 'ab', x: 738, y: 196, w: 25, h: 12, tip: 'A/B : échange les fréquences des VFO A et B', act: { action: 'swap' } },
      { id: 'rxB', x: 659, y: 224, w: 19, h: 9, tip: 'RX (VFO-B) : récepteur SUB en marche / arrêt (double réception, voyant vert)', act: { toggle: 'dualRx' },
        leds: [{ x: 661, y: 226, w: 15, h: 5, rx: 1.5, color: '#3ddc5a', on: (s) => !!s.dualRx, bright: (s) => !!s.dualRx }] },
      { id: 'txB', x: 754, y: 224, w: 19, h: 9, tip: 'TX (VFO-B) : émission sur le VFO-B (SPLIT)', act: { local: 'split' },
        leds: [{ x: 756, y: 226, w: 15, h: 5, rx: 1.5, color: '#ff3b30', on: (s, L) => L.txSide(s) === 'B', bright: (s, L) => !!s.tx && L.txSide(s) === 'B' }] },
      // Prises
      { id: 'phones', cx: 3, cy: 3, r: 1, tip: 'PHONES : écouter le TRX (clic : marche / arrêt)', act: { local: 'listen' } }
    ]).filter((k) => k.id !== 'phones').map(SC),
    knobs: [
      { id: 'dial', cx: 515, cy: 222, ro: 78, ri: 78, dial: true, tip: 'Grand bouton : fréquence du VFO actif (touche A ou B) ; molette ou glisser en tournant' },
      { id: 'clarB', cx: 719, cy: 266, ro: 41, subDial: true, clar: true, tip: 'CLAR/VFO-B : fréquence du VFO-B ; RX CLAR ou TX CLAR en service : décalage du clarifier' },
      { id: 'swA', cx: 838, cy: 269, ri: 28, ro: 41, inner: { ctl: 'shift', label: 'SHIFT VFO-A', per: 20 }, outer: { ctl: 'width', label: 'WIDTH VFO-A', per: 1 }, longReset: 'A' },
      { id: 'swB', cx: 953, cy: 271, ri: 28, ro: 41, inner: { ctl: 'shiftB', label: 'SHIFT VFO-B', per: 20 }, outer: { ctl: 'widthB', label: 'WIDTH VFO-B', per: 1 }, longReset: 'B' },
      { id: 'afRfB', cx: 262, cy: 287, ri: 15, ro: 27, inner: { ctl: 'afB', label: 'AF GAIN VFO-B', per: 5 }, outer: { ctl: 'rfB', label: 'RF GAIN VFO-B', per: 5 } },
      { id: 'afRfA', cx: 340, cy: 287, ri: 15, ro: 27, inner: { ctl: 'af', label: 'AF GAIN VFO-A', per: 5 }, outer: { ctl: 'rf', label: 'RF GAIN VFO-A', per: 5 } },
      { id: 'nbSqlB', cx: 267, cy: 212, ri: 10, ro: 19, inner: { ctl: 'nbLvlB', label: 'NB VFO-B', per: 5 }, outer: { ctl: 'sqlB', label: 'SQL VFO-B', per: 5 } },
      { id: 'nbSqlA', cx: 337, cy: 212, ri: 10, ro: 19, inner: { ctl: 'nbLvl', label: 'NB VFO-A', per: 5 }, outer: { ctl: 'sql', label: 'SQL VFO-A', per: 5 } },
      { id: 'moniProc', cx: 197, cy: 212, ri: 10, ro: 19, inner: { ctl: 'moniLvl', label: 'MONI', per: 5 }, outer: { ctl: 'procLvl', label: 'PROC', per: 5 } },
      { id: 'micPwr', cx: 47, cy: 285, ri: 12, ro: 23, inner: { ctl: 'mic', label: 'MIC GAIN', per: 5 }, outer: { fn: 'power', label: 'RF PWR' } },
      { id: 'speedPitch', cx: 117, cy: 285, ri: 12, ro: 23, inner: { ctl: 'keySpeed', label: 'KEY SPEED', per: 1 }, outer: { ctl: 'cwPitch', label: 'PITCH', per: 10 } },
      { id: 'voxDelay', cx: 185, cy: 285, ri: 12, ro: 23, inner: { ctl: 'voxGain', label: 'VOX GAIN', per: 5 }, outer: { ctl: 'voxDelay', label: 'VOX DELAY', per: 20 } }
    ].map(SC)
  };
})();
