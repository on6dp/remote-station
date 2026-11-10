/*
 * faces/ftdx5000.js — face avant du Yaesu FTDX5000 pour la page https://remote.op0p.be/ftdx5000
 *
 * Image : faces/ftdx5000.webp (1100 × 648, à partir de y = 36 : dessus du TRX coupé) = photo de la face avant (www.rigpix.com, fond rendu transparent, pieds coupés)
 * en haut (1100 × 346), et dessous le cadre de l'écran de la page (le FTDX5000 n'a qu'un petit afficheur : l'écran de la
 * page — fréquences, mètres, scope de la BF reçue — est posé sous la face, comme un moniteur de station).
 * Positions en pixels de cette image (x, y = coin haut gauche ; cx, cy = centre). ?zones=1 : contours visibles.
 * Deux récepteurs (MAIN = VFO-A, SUB = VFO-B), comme le FTDX101. Même format que faces/ftdx101.js (act / led / leds / knobs).
 * Pilote CAT en essai (pas encore vu sur un vrai FTDX5000) : les touches sans commande CAT donnent une explication.
 */
(function () {
  'use strict';
  const F = window.RS_FACES = window.RS_FACES || {};
  const info = (t) => ({ info: t });
  const OR = '#ff9a1f';
  // 14250000 → « 14.250.000 »
  const fmtF = (hz) => { const t = String(Math.round(hz)).padStart(7, '0'); return t.slice(0, -6) + '.' + t.slice(-6, -3) + '.' + t.slice(-3); };
  // Voyant d'une touche : petit trait orange au milieu, en bas de la touche
  const dot = (k, on, color) => [{ x: k.x + k.w / 2 - 5, y: k.y + k.h - 4, w: 10, h: 2.5, color: color || OR, on, bright: on }];
  const key = (o) => Object.assign(o, o.on ? { leds: dot(o, o.on, o.ledColor) } : {});
  // Touches de bande (3 colonnes × 4 rangées, à droite de l'afficheur)
  const COLS = [734, 774, 814], ROWS = [62, 85, 108, 131];
  const BANDS = [['1.8', '160M'], ['3.5', '80M'], ['7.0', '40M'], ['10', '30M'], ['14', '20M'], ['18', '17M'], ['21', '15M'], ['24.5', '12M'], ['28/29', '10M'],
    ['GEN', null], ['50', '6M'], ['ENT', null]];
  const bandKeys = BANDS.map(([lab, b], i) => {
    const k = { id: 'band' + lab.replace(/\W/g, ''), x: COLS[i % 3], y: ROWS[Math.floor(i / 3)], w: 27, h: 16 };
    if (!b) return Object.assign(k, lab === 'GEN' ? { tip: 'GEN : couverture générale — tableau des bandes sur l’écran', act: { local: 'bandMenu' } } : { tip: 'ENT', act: info('ENT : entrée directe de fréquence — tapez-la dans la case kHz du VFO, sous l’écran, ou cliquez sur un spot.') });
    return key(Object.assign(k, { tip: 'Bande ' + lab + ' MHz (VFO actif : A ou B)', act: { band: b }, on: (s, L) => L.bandOf(s.vfoSel === 1 ? s.freqB : s.freq) === b }));
  });
  // Touches de mode (le récepteur actif)
  const modeKey = (id, x, y, w, lab, list, test) => key({ id, x, y, w, h: 17, tip: lab, act: { mode: list }, on: (s, L) => test.test(L.activeMode(s) || '') });
  // Réglages DSP d'un côté (A = MAIN, B = SUB) : VRF, SHIFT, CONT/APF / NOTCH, WIDTH, RESET, DNR, DNF
  function dsp(x0, sd) {
    const b = sd === 'B' ? 'B' : '', nm = sd === 'B' ? 'VFO-B (SUB)' : 'VFO-A (MAIN)';
    return [
      { id: 'vrf' + sd, x: x0, y: 205, w: 28, h: 15, tip: 'VRF/μ-T ' + nm, act: info('VRF / μ-TUNE (présélecteur) : pas de commande CAT sur le FTDX5000, réglage au club.') },
      key({ id: 'shift' + sd, x: x0 + 36, y: 205, w: 28, h: 15, tip: 'SHIFT ' + nm + ' : se règle avec le centre du bouton dessous ; clic : SHIFT à 0', act: { set: ['shift' + b, 0] }, on: (s) => !!s['shift' + b] }),
      { id: 'cont' + sd, x: x0 + 72, y: 205, w: 28, h: 15, tip: 'CONT/APF ' + nm, act: info('CONTOUR / APF : pas encore relié pour le FTDX5000 (format CAT à vérifier sur le TRX).') },
      key({ id: 'notch' + sd, x: x0, y: 230, w: 28, h: 15, tip: 'NOTCH ' + nm + ' (manuel)', act: { toggle: 'notch' + b }, on: (s) => !!s['notch' + b] }),
      key({ id: 'width' + sd, x: x0 + 36, y: 230, w: 28, h: 15, tip: 'WIDTH ' + nm + ' : se règle avec la bague du bouton dessous ; clic : NARROW', act: { toggle: 'narrow' + b }, on: (s) => !!s['narrow' + b] }),
      { id: 'reset' + sd, x: x0 + 72, y: 230, w: 28, h: 15, tip: 'RESET ' + nm + ' : SHIFT à 0 et NARROW coupé', act: { set: ['shift' + b, 0], long: { set: ['narrow' + b, 0] } } }
    ];
  }
  const dspDots = (x, y, sd) => {
    const b = sd === 'B' ? 'B' : '';
    return [
      { id: 'dnr' + sd, cx: x, cy: y, r: 7, tip: 'DNR ' + (sd === 'B' ? 'VFO-B' : 'VFO-A') + ' — appui d’au moins 1 s : niveau DNR', act: Object.assign({ toggle: 'nr' + b }, b ? {} : { long: { pop: 'nrLvl' } }), led: (s) => !!s['nr' + b], ledColor: '#ff3b30' },
      { id: 'dnf' + sd, cx: x + (sd === 'B' ? 94 : 96), cy: y, r: 7, tip: 'DNF ' + (sd === 'B' ? 'VFO-B' : 'VFO-A') + ' (notch automatique)', act: { toggle: 'dnf' + b }, led: (s) => !!s['dnf' + b], ledColor: '#ff3b30' }
    ];
  };
  // Réplique de l'afficheur principal du FTDX5000, en bas à gauche (cadre, étiquettes et voyants éteints dessinés dans
  // l'image) : MAIN et SUB (ANT, ATT, IPO, AGC, NB, DNR), fréquences, modes, voyants TX / DUAL / SPLIT / NAR / LOCK / FAST / CLAR
  const VAL = { color: '#c8f05a', size: 12, anchor: 'middle', font: '700 12px DejaVu Sans,Arial,sans-serif' };
  const ATTS = ['OFF', '6dB', '12dB', '18dB'], IPOS = ['IPO1', 'AMP1', 'AMP2', 'IPO2'], AGCS = ['OFF', 'FAST', 'MID', 'SLOW', 'AUTO'];
  const onOff = (v) => (v == null ? '' : v ? 'ON' : 'OFF');
  const cellsOf = (b) => [(s) => (s.ant != null ? String(s.ant) : ''), (s) => ATTS[s['att' + b]] || '', (s) => IPOS[s['preamp' + b]] || '',
    (s) => AGCS[s['agc' + b]] || '', (s) => onOff(s['nb' + b]), (s) => onOff(s['nr' + b])];
  const VFD = [];
  [['', 410], ['B', 478]].forEach(([b, y]) => cellsOf(b).forEach((fn, i) => VFD.push(Object.assign({}, VAL, { x: 78 + i * 37, y, text: (s) => (b && s.dualRx === 0 ? '—' : fn(s)) }))));
  const ind = (lab, x, on, color) => ({ x, y: 520, anchor: 'middle', color: color || '#ffb347', font: '700 11px DejaVu Sans,Arial,sans-serif', text: (s, L) => (on(s, L) ? lab : '') });
  VFD.push(
    { seg: true, x: 496, y: 380, size: 29, color: '#a9bcff', text: (s) => (s.freq ? fmtF(s.freq) : '') },
    { seg: true, x: 496, y: 446, size: 20, color: '#7f96e0', text: (s) => (s.freqB ? fmtF(s.freqB) : '') },
    { x: 310, y: 432, anchor: 'start', color: '#8fd0ff', font: '700 12px DejaVu Sans,Arial,sans-serif', text: (s) => s.mode || '' },
    { x: 310, y: 470, anchor: 'start', color: '#6f9ad0', font: '700 11px DejaVu Sans,Arial,sans-serif', text: (s) => s.modeB || '' },
    { x: 496, y: 432, anchor: 'end', color: '#ff7a6a', font: '700 11px DejaVu Sans,Arial,sans-serif', text: (s, L) => (s.vfoSel === 1 ? '◀ B' : '') },
    ind('TX', 34, (s) => !!s.tx, '#ff4a3a'), ind('DUAL', 80, (s) => !!s.dualRx), ind('SPLIT', 133, (s) => !!s.split), ind('NAR', 184, (s) => !!(s.vfoSel === 1 ? s.narrowB : s.narrow)),
    ind('LOCK', 230, (s) => !!(s.vfoSel === 1 ? s.lockB : s.lock)), ind('FAST', 277, (s, L) => !!L.fast), ind('RX CLAR', 338, (s) => !!s.rit), ind('TX CLAR', 405, (s) => !!s.xit),
    { x: 492, y: 520, anchor: 'end', color: '#d8f06a', font: '700 12px DejaVu Sans,Arial,sans-serif', text: (s) => ((s.clar || 0) >= 0 ? '+' : '−') + (Math.abs(s.clar || 0) / 1000).toFixed(3) },
  );
  F.ftdx5000 = {
    model: 'ftdx5000',
    name: 'Yaesu FTDX5000',
    image: '/faces/ftdx5000.webp',
    w: 1100,
    h: 684,
    // Le dessus du TRX (perspective) n'est pas gardé : l'image commence au bord de la face avant (y = 36) ;
    // les positions ci-dessous restent celles de la photo entière
    img: { x: 0, y: 36, w: 1100, h: 648 },
    // Écran de la page : dans le cadre dessiné sous la face avant
    lcd: { x: 522, y: 356, w: 570, h: 321 },
    // Cases de l'écran (pas de R.FLT par CAT) ; préampli IPO1 / AMP1 / AMP2 / IPO2
    cells: [['ANT', 'ant'], ['ATT', 'att'], ['IPO', 'preamp'], ['AGC', 'agc']],
    ipo: ['IPO1', 'AMP1', 'AMP2', 'IPO2'],
    modes: [['LSB', 'USB', 'CW-L', 'CW-U'], ['AM', 'FM', 'FM-N', null], ['DATA-L', 'DATA-U', 'DATA-FM', null], ['RTTY-L', 'RTTY-U', null, null]],
    cycle: ['LSB', 'USB', 'CW-U', 'CW-L', 'AM', 'FM', 'DATA-U', 'DATA-L', 'RTTY-L', 'RTTY-U'],
    // Afficheurs de la photo remplis en direct : fréquence du VFO-A (7 segments), décalage du clarifier, fréquence du VFO-B
    texts: [
      { seg: true, x: 687, y: 87, size: 26, color: '#a9bcff', text: (s) => (s.freq ? fmtF(s.freq) : '') },
      { x: 683, y: 138, size: 12, color: '#d8f06a', text: (s) => ((s.clar || 0) / 1000).toFixed(3) },
      { x: 817, y: 188, size: 12, font: '500 12px ui-monospace,Consolas,monospace', color: '#a9bcff', text: (s) => (s.freqB ? fmtF(s.freqB) : '') }
    ].concat(VFD),
    // Voyants RX (vert) et TX (rouge) au-dessus du grand bouton ; RX / TX du VFO-B sous son afficheur
    leds: [
      { x: 515, y: 174, w: 17, h: 6, color: '#3ddc5a', on: (s) => !!s.connected && !s.tx && !s.mainMute, bright: (s) => !!s.connected && !s.tx && !s.mainMute },
      { x: 633, y: 175, w: 17, h: 5, color: '#ff3b30', on: (s) => !!s.tx, bright: (s) => !!s.tx }
    ],
    keys: bandKeys.concat(dsp(862, 'A'), dsp(984, 'B'), dspDots(863, 270, 'A'), dspDots(986, 270, 'B'), [
      { id: 'onoff', x: 20, y: 70, w: 37, h: 52, tip: 'ON/OFF : la mise en marche se fait au club', act: info('Le TRX ne s’allume et ne s’éteint qu’au club.') },
      { id: 'meterArea', x: 68, y: 60, w: 192, h: 76, tip: 'Galvanomètre du TRX : les mesures (S, PO, ALC, SWR…) sont sur l’écran de la page, dessous', act: info('Les mesures du TRX (S-mètre, PO, ALC, COMP, SWR, Id, Vdd) sont affichées sur l’écran de la page, sous la face avant.') },
      // Bloc de gauche
      { id: 'dim', x: 76, y: 186, w: 29, h: 15, tip: 'DIM', act: info('DIM (luminosité des afficheurs) : réglage au club.') },
      key({ id: 'tune', x: 118, y: 186, w: 29, h: 15, tip: 'TUNE : coupleur d’antenne en service / hors service ; appui d’au moins 1 s : accord (émission courte, avec la main)', act: { toggle: 'tuner', long: { action: 'tune' } }, on: (s) => !!(s.tuner || s.tuning) }),
      key({ id: 'mox', x: 76, y: 217, w: 29, h: 15, tip: 'MOX : émission maintenue (clic : émission, clic suivant : réception) ; avec votre micro si « MICRO » est actif', act: { local: 'mox' }, on: (s, L) => !!L.mox, ledColor: '#ff3b30' }),
      key({ id: 'moni', x: 118, y: 217, w: 29, h: 15, tip: 'MONI : entendre sa propre modulation (« M’écouter », au casque)', act: { local: 'moni' }, on: () => !!(window.RSVOICE && window.RSVOICE.monitorOn()) }),
      key({ id: 'vox', x: 76, y: 248, w: 29, h: 15, tip: 'VOX (ne peut être que coupé à distance)', act: { toggle: 'vox' }, on: (s) => !!s.vox }),
      key({ id: 'proc', x: 118, y: 248, w: 29, h: 15, tip: 'PROC : processeur de modulation', act: { toggle: 'proc' }, on: (s) => !!s.proc }),
      // RX ANT, ANT 1-4, ATT, IPO, R.FLT, AGC (récepteur MAIN)
      { id: 'rxAnt', x: 166, y: 186, w: 33, h: 22, tip: 'RX (antenne de réception séparée)', act: info('RX ANT : prise d’antenne de réception séparée, réglage au club.') },
      key({ id: 'ant', x: 206, y: 186, w: 35, h: 22, tip: 'ANT 1-4 : antenne suivante (pas pendant une émission)', act: { cycle: 'ant' }, on: (s) => s.ant != null && s.ant > 1 }),
      key({ id: 'att', x: 248, y: 186, w: 36, h: 22, tip: 'ATT : OFF → 6 → 12 → 18 dB (récepteur MAIN)', act: { cycle: 'att' }, on: (s) => !!s.att }),
      key({ id: 'ipo', x: 305, y: 186, w: 40, h: 22, tip: 'IPO : IPO1 → AMP1 → AMP2 → IPO2 (récepteur MAIN)', act: { cycle: 'preamp' }, on: (s) => s.preamp === 1 || s.preamp === 2 }),
      { id: 'rflt', x: 355, y: 186, w: 34, h: 22, tip: 'R.FLT (filtre de toit)', act: info('R.FLT (filtre de toit 3 / 6 / 15 kHz) : pas encore relié pour le FTDX5000.') },
      key({ id: 'agc', x: 395, y: 186, w: 36, h: 22, tip: 'AGC : OFF → FAST → MID → SLOW → AUTO (récepteur MAIN)', act: { cycle: 'agc' }, on: (s) => s.agc != null && s.agc !== 4 }),
      // Prises
      { id: 'phones', cx: 34, cy: 207, r: 13, tip: 'PHONES : écouter le TRX (clic : marche / arrêt)', act: { local: 'listen' }, led: (s, L) => L.listening, ledColor: '#3ddc5a', ring: true },
      { id: 'keyJack', cx: 34, cy: 258, r: 13, tip: 'KEY', act: info('Manipulateur : la CW se fait par la page TRX CW.') },
      { id: 'mic', cx: 34, cy: 322, r: 21, tip: 'MIC', act: info('Micro : phonie à distance par le bouton PTT sous la face avant (Configuration micro).') },
      { id: 'meterSel', cx: 185, cy: 250, r: 19, tip: 'METER : choix de la mesure du galvanomètre', act: info('METER : les mesures (PO, ALC, COMP, SWR, Id, Vdd) sont toutes sur l’écran de la page.') },
      // Autour du grand bouton
      key({ id: 'vfoA', x: 450, y: 182, w: 26, h: 15, tip: 'A : le grand bouton et les touches agissent sur le VFO-A (MAIN)', act: { set: ['vfoSel', 0] }, on: (s) => s.vfoSel !== 1, ledColor: '#ff6040' }),
      key({ id: 'vfoB', x: 480, y: 182, w: 26, h: 15, tip: 'B : le grand bouton et les touches agissent sur le VFO-B (SUB)', act: { set: ['vfoSel', 1] }, on: (s) => s.vfoSel === 1, ledColor: '#d8e4ff' }),
      { id: 'sto', x: 456, y: 206, w: 41, h: 14, tip: 'STO', act: info('Mémoires (STO / RCL) : pas encore reliées.') },
      { id: 'rcl', x: 456, y: 229, w: 41, h: 13, tip: 'RCL', act: info('Mémoires (STO / RCL) : pas encore reliées.') },
      key({ id: 'nar', x: 457, y: 252, w: 28, h: 14, tip: 'NAR : filtre étroit du récepteur actif', act: { toggleSide: 'narrow' }, on: (s) => !!(s.vfoSel === 1 ? s.narrowB : s.narrow) }),
      key({ id: 'split', x: 457, y: 274, w: 28, h: 14, tip: 'SPLIT : émission sur l’autre VFO (voyant TX rouge et fréquence d’émission en rouge)', act: { local: 'split' }, on: (s) => !!s.split }),
      { id: 'txw', x: 457, y: 295, w: 28, h: 13, tip: 'TXW', act: info('TXW (écoute de la fréquence d’émission) : pas encore relié pour le FTDX5000.') },
      { id: 'classA', x: 456, y: 318, w: 29, h: 15, tip: 'CLASS-A', act: info('CLASS-A (classe A de l’étage final) : réglage au club.') },
      { id: 'cs', x: 491, y: 319, w: 25, h: 14, tip: 'C.S', act: info('C.S (touche personnalisable) : pas disponible à distance.') },
      key({ id: 'fast', x: 660, y: 186, w: 28, h: 12, tip: 'FAST : accord rapide (1 kHz par cran)', act: { local: 'fast' }, on: (s, L) => !!L.fast }),
      key({ id: 'lock', x: 692, y: 186, w: 27, h: 12, tip: 'LOCK : verrouille le grand bouton du TRX (administrateurs)', act: { local: 'lock' }, on: (s) => !!(s.vfoSel === 1 ? s.lockB : s.lock) }),
      { id: 'aToB', x: 670, y: 210, w: 40, h: 13, tip: 'A ► B : copie le VFO-A dans le VFO-B', act: { action: 'aToB' } },
      { id: 'bToA', x: 670, y: 231, w: 40, h: 13, tip: 'A ◄ B : copie le VFO-B dans le VFO-A', act: { action: 'bToA' } },
      { id: 'vm', x: 670, y: 252, w: 40, h: 13, tip: 'V/M', act: info('Mémoires : pas encore reliées.') },
      { id: 'mToA', x: 670, y: 273, w: 40, h: 13, tip: 'M ► A', act: info('Mémoires : pas encore reliées.') },
      { id: 'aToM', x: 670, y: 294, w: 40, h: 13, tip: 'A ► M', act: info('Mémoires : pas encore reliées.') },
      { id: 'menu', x: 648, y: 316, w: 62, h: 18, tip: 'MENU : menu des fonctions sur l’écran (RF POWER, MONI, VOX…)', act: { local: 'func' }, led: (s, L) => L.func },
      // Mode et fonctions (en haut à droite)
      modeKey('lsb', 862, 63, 43, 'LSB', ['LSB'], /^LSB$/), modeKey('usb', 919, 63, 40, 'USB', ['USB'], /^USB$/),
      Object.assign(modeKey('cw', 862, 96, 43, 'CW : CW-U ⇄ CW-L', ['CW-U'], /^CW/), { act: { mode: 'cw' } }),
      modeKey('amfm', 919, 96, 40, 'AM/FM : AM ⇄ FM', ['AM', 'FM'], /^(AM|FM)/), modeKey('rtty', 862, 129, 43, 'RTTY : RTTY-L ⇄ RTTY-U', ['RTTY-L', 'RTTY-U'], /^RTTY/),
      modeKey('pkt', 919, 129, 40, 'PKT (DATA) : DATA-U → DATA-L → DATA-FM', ['DATA-U', 'DATA-L', 'DATA-FM'], /^DATA/),
      key({ id: 'nb', x: 987, y: 63, w: 40, h: 17, tip: 'NB du récepteur actif — appui d’au moins 1 s : niveau NB', act: { toggleSide: 'nb', long: { pop: 'nbLvl' } }, on: (s) => !!(s.vfoSel === 1 ? s.nbB : s.nb) }),
      { id: 'spot', x: 1041, y: 63, w: 39, h: 17, tip: 'SPOT', act: info('SPOT (tonalité de repérage CW) : pas disponible à distance.') },
      key({ id: 'keyer', x: 987, y: 95, w: 40, h: 18, tip: 'KEYER : manipulateur électronique', act: { toggle: 'keyer' }, on: (s) => !!s.keyer }),
      key({ id: 'bkin', x: 1041, y: 95, w: 39, h: 18, tip: 'BK-IN : break-in CW', act: { toggle: 'bkin' }, on: (s) => !!s.bkin }),
      { id: 'down', x: 988, y: 128, w: 40, h: 18, tip: 'DOWN : bande précédente', act: { local: 'bandDown' } },
      { id: 'up', x: 1041, y: 128, w: 39, h: 18, tip: 'UP : bande suivante', act: { local: 'bandUp' } },
      // VFO-B : clarifier, CLEAR, A/B, RX / TX
      key({ id: 'rxClar', x: 740, y: 206, w: 28, h: 14, tip: 'RX CLAR (RIT) : le bouton CLAR/VFO-B règle alors le décalage', act: { toggle: 'rit' }, on: (s) => !!s.rit }),
      { id: 'clear', x: 775, y: 206, w: 30, h: 14, tip: 'CLEAR : décalage du clarifier à zéro', act: { action: 'clarClr' } },
      key({ id: 'txClar', x: 810, y: 206, w: 28, h: 14, tip: 'TX CLAR (XIT) : le bouton CLAR/VFO-B règle alors le décalage', act: { toggle: 'xit' }, on: (s) => !!s.xit }),
      { id: 'clarGrp', x: 740, y: 229, w: 28, h: 14, tip: 'CLAR/GRP', act: info('CLAR : allumez RX CLAR ou TX CLAR, puis tournez le bouton CLAR/VFO-B ; CLEAR remet à zéro.') },
      { id: 'bandMch', x: 775, y: 229, w: 30, h: 14, tip: 'BAND/MCH : tableau des bandes', act: { local: 'bandMenu' } },
      { id: 'ab', x: 810, y: 229, w: 28, h: 14, tip: 'A/B : échange les fréquences des VFO A et B', act: { action: 'swap' } },
      { id: 'rxB', x: 724, y: 259, w: 26, h: 14, tip: 'RX (VFO-B) : récepteur SUB en marche / arrêt (double réception, voyant vert)', act: { toggle: 'dualRx' },
        leds: [{ x: 731, y: 262, w: 17, h: 7, rx: 1.5, color: '#3ddc5a', on: (s) => !!s.dualRx, bright: (s) => !!s.dualRx }] },
      { id: 'txB', x: 823, y: 259, w: 24, h: 14, tip: 'TX (VFO-B) : émission sur le VFO-B (SPLIT)', act: { local: 'split' },
        leds: [{ x: 827, y: 262, w: 17, h: 7, rx: 1.5, color: '#ff3b30', on: (s, L) => L.txSide(s) === 'B', bright: (s, L) => !!s.tx && L.txSide(s) === 'B' }] }
    ]),
    knobs: [
      { id: 'dial', cx: 582, cy: 260, ro: 80, ri: 80, dial: true, tip: 'Grand bouton : fréquence du VFO actif (touche A ou B) ; molette ou glisser en tournant' },
      { id: 'clarB', cx: 787, cy: 305, ro: 42, subDial: true, clar: true, tip: 'CLAR/VFO-B : fréquence du VFO-B ; RX CLAR ou TX CLAR en service : décalage du clarifier' },
      { id: 'swA', cx: 915, cy: 305, ri: 27, ro: 45, inner: { ctl: 'shift', label: 'SHIFT VFO-A', per: 20 }, outer: { ctl: 'width', label: 'WIDTH VFO-A', per: 1 }, longReset: 'A' },
      { id: 'swB', cx: 1035, cy: 305, ri: 27, ro: 45, inner: { ctl: 'shiftB', label: 'SHIFT VFO-B', per: 20 }, outer: { ctl: 'widthB', label: 'WIDTH VFO-B', per: 1 }, longReset: 'B' },
      { id: 'afRfB', cx: 320, cy: 323, ri: 14, ro: 25, inner: { ctl: 'afB', label: 'AF GAIN VFO-B', per: 5 }, outer: { ctl: 'rfB', label: 'RF GAIN VFO-B', per: 5 } },
      { id: 'afRfA', cx: 395, cy: 323, ri: 14, ro: 25, inner: { ctl: 'af', label: 'AF GAIN VFO-A', per: 5 }, outer: { ctl: 'rf', label: 'RF GAIN VFO-A', per: 5 } },
      { id: 'nbSqlB', cx: 330, cy: 257, ri: 10, ro: 19, inner: { ctl: 'nbLvlB', label: 'NB VFO-B', per: 5 }, outer: { ctl: 'sqlB', label: 'SQL VFO-B', per: 5 } },
      { id: 'nbSqlA', cx: 400, cy: 257, ri: 10, ro: 19, inner: { ctl: 'nbLvl', label: 'NB VFO-A', per: 5 }, outer: { ctl: 'sql', label: 'SQL VFO-A', per: 5 } },
      { id: 'moniProc', cx: 257, cy: 257, ri: 10, ro: 19, inner: { ctl: 'moniLvl', label: 'MONI', per: 5 }, outer: { ctl: 'procLvl', label: 'PROC', per: 5 } },
      { id: 'micPwr', cx: 105, cy: 323, ri: 12, ro: 23, inner: { ctl: 'mic', label: 'MIC GAIN', per: 5 }, outer: { fn: 'power', label: 'RF PWR' } },
      { id: 'speedPitch', cx: 178, cy: 323, ri: 12, ro: 23, inner: { ctl: 'keySpeed', label: 'KEY SPEED', per: 1 }, outer: { ctl: 'cwPitch', label: 'PITCH', per: 10 } },
      { id: 'voxDelay', cx: 248, cy: 323, ri: 12, ro: 23, inner: { ctl: 'voxGain', label: 'VOX GAIN', per: 5 }, outer: { ctl: 'voxDelay', label: 'VOX DELAY', per: 20 } }
    ]
  };
})();
