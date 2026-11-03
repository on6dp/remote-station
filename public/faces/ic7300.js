/*
 * faces/ic7300.js — face avant de l'Icom IC-7300 pour la page https://remote.op0p.be/ic7300
 *
 * Image : faces/ic7300.webp (photo 1500 × 593 px fournie par ON6DP).
 * Positions en pixels de cette image (x, y = coin haut gauche ; cx, cy = centre). ?zones=1 : contours visibles.
 * Un seul récepteur (comme le FTDX10) : même écran « un récepteur », avec les réglages Icom (FIL1/2/3, TWIN PBT,
 * P.AMP / ATT, AGC FAST / MID / SLOW). Même format que faces/ftdx101.js (voir ce fichier pour act / led / leds / knobs).
 */
(function () {
  'use strict';
  const F = window.RS_FACES = window.RS_FACES || {};
  const info = (t) => ({ info: t });
  F.ic7300 = {
    model: 'ic7300',
    name: 'Icom IC-7300',
    image: '/faces/ic7300.webp',
    w: 1500,
    h: 593,
    single: true,
    lcd: { x: 415, y: 92, w: 600, h: 352 },
    // Écran un peu moins haut que celui du FTDX10 : scope et rangée du bas remontés
    // Écran Icom : en-tête (mode, FIL, voyants, S/Po, fréquence) en haut, puis le scope et les mesures jusqu'en bas (pas de rangée de touches)
    lay: { scopeY: 108, scopeH: 238, botY: 400, botH: 0 },
    // Cases de l'écran (pas d'ANT ni de R.FIL sur l'IC-7300)
    cells: [['ATT', 'att'], ['P.AMP', 'preamp'], ['FILTER', 'fil'], ['AGC', 'agc']],
    // Rangée du bas de l'écran
    bot: ['CENTER', 'HOLD', '3DSS', 'EXPAND', 'SPAN', 'SPEED'],
    // Tableau MODE (touche MENU, ou clic sur le mode à l'écran) et touche MODE : modes de l'IC-7300
    modes: [['LSB', 'USB', 'CW', 'CW-R'], ['AM', 'FM', 'RTTY', 'RTTY-R'], ['LSB-D', 'USB-D', 'AM-D', 'FM-D']],
    cycle: ['LSB', 'USB', 'CW', 'CW-R', 'RTTY', 'RTTY-R', 'AM', 'FM', 'USB-D', 'LSB-D'],
    leds: [
      // POWER (vert, allumé sur la photo) et TX/RX : vert en réception, rouge en émission
      { x: 1080, y: 361, w: 32, h: 14, rx: 7, color: '#ff3b30', on: (s) => !!s.tx, bright: (s) => !!s.tx }
    ],
    keys: [
      { id: 'power', x: 43, y: 55, w: 99, h: 42, tip: 'POWER : la mise en marche se fait au club', act: info('Le TRX ne s’allume et ne s’éteint qu’au club.') },
      { id: 'transmit', x: 43, y: 128, w: 102, h: 37, tip: 'TRANSMIT : émission maintenue (clic : émission, clic suivant : réception) ; avec votre micro si « MICRO » est actif', act: { local: 'mox' }, led: (s, L) => !!L.mox, ledColor: '#ff3b30' },
      { id: 'tuner', x: 43, y: 193, w: 102, h: 35, tip: 'TUNER : coupleur d’antenne en service / hors service ; appui d’au moins 1 s : accord (émission courte, avec la main)', act: { toggle: 'tuner', long: { action: 'tune' } }, led: (s) => !!(s.tuner || s.tuning), ledColor: '#ff8a1f' },
      { id: 'vox', x: 43, y: 255, w: 102, h: 37, tip: 'VOX/BK-IN : en CW, BK-IN OFF → SEMI → FULL ; en phonie, VOX (à distance, il ne peut être que coupé)', act: { local: 'voxBk' }, led: (s) => (/^CW/.test(s.mode || '') ? !!s.bkin : !!s.vox) },
      { id: 'pamp', x: 172, y: 232, w: 78, h: 36, tip: 'P.AMP/ATT : préampli OFF → P.AMP1 → P.AMP2 ; appui d’au moins 1 s : ATT 20 dB', act: { cycle: 'preamp', long: { toggle: 'att' } }, led: (s) => !!(s.preamp || s.att) },
      { id: 'notch', x: 270, y: 232, w: 75, h: 36, tip: 'NOTCH : OFF → AN (automatique) → MN (manuel) → OFF, comme sur le TRX (pas d’AN en CW)', act: { local: 'notchCycle' }, led: (s) => !!(s.notch || s.dnf) },
      { id: 'nb', x: 172, y: 282, w: 78, h: 36, tip: 'NB — appui d’au moins 1 s : niveau NB', act: { toggle: 'nb', long: { pop: 'nbLvl' } }, led: (s) => !!s.nb },
      { id: 'nr', x: 270, y: 282, w: 75, h: 36, tip: 'NR — appui d’au moins 1 s : niveau NR', act: { toggle: 'nr', long: { pop: 'nrLvl' } }, led: (s) => !!s.nr },
      { id: 'phones', cx: 90, cy: 362, r: 25, tip: 'PHONES : écouter le TRX (clic : marche / arrêt)', act: { local: 'listen' }, led: (s, L) => L.listening, ledColor: '#3ddc5a', ring: true },
      { id: 'mic', cx: 95, cy: 490, r: 58, tip: 'MIC', act: info('Micro : phonie à distance par le bouton PTT sous la face avant (Configuration micro).') },
      // Sous l'écran
      { id: 'menu', x: 420, y: 517, w: 95, h: 43, tip: 'MENU : écran MENU (KEYER, RTTY, SCOPE, AUDIO, MODE, BAND…) ; le mode se change aussi en cliquant sur le mode à l’écran', act: { local: 'icomMenu' } },
      { id: 'function', x: 542, y: 517, w: 98, h: 43, tip: 'FUNCTION : écran FUNCTION de l’IC-7300 (en préparation) ; niveaux par le bouton MULTI', act: { local: 'func' } },
      { id: 'mscope', x: 665, y: 517, w: 97, h: 43, tip: 'M.SCOPE : grand écran des mesures (grande fréquence, S/Po, ALC, COMP, SWR, Id, Vd, TEMP, sans scope) ; un 2e appui : retour à l’écran par défaut', act: { local: 'scopeMeter' } },
      { id: 'quick', x: 790, y: 517, w: 95, h: 43, tip: 'QUICK : QUICK MENU (BAND, SPLIT, A=B, A/B, TUNER, TUNE, LOCK, 3DSS)', act: { local: 'quickMenu' } },
      { id: 'exit', x: 912, y: 517, w: 98, h: 43, tip: 'EXIT : ferme le tableau ou le menu ouvert', act: { local: 'exit' } },
      // À droite de l'écran
      { id: 'xfc', cx: 1112, cy: 245, r: 38, tip: 'XFC', act: info('XFC (écoute de la fréquence d’émission en SPLIT) : pas disponible à distance.') },
      { id: 'autotune', x: 1067, y: 440, w: 50, h: 33, tip: 'AUTO TUNE', act: info('AUTO TUNE (accord CW automatique) : pas disponible à distance ; cliquez sur le signal dans la cascade CW.') },
      { id: 'speech', x: 1065, y: 530, w: 70, h: 38, tip: 'SPEECH', act: info('SPEECH (annonce vocale) : pas disponible à distance.') },
      { id: 'rit', x: 1202, y: 55, w: 78, h: 33, tip: 'RIT ; le bouton MULTI règle le décalage', act: { toggle: 'rit' }, led: (s) => !!s.rit },
      { id: 'dtx', x: 1302, y: 55, w: 73, h: 33, tip: 'ΔTX (XIT) ; le bouton MULTI règle le décalage', act: { toggle: 'xit' }, led: (s) => !!s.xit },
      { id: 'clear', x: 1397, y: 55, w: 75, h: 33, tip: 'CLEAR : décalage RIT / ΔTX à zéro', act: { action: 'clarClr' } },
      { id: 'split', x: 1202, y: 107, w: 78, h: 33, tip: 'SPLIT : émission sur le VFO B (fréquence d’émission en rouge)', act: { local: 'split' }, led: (s) => !!s.split },
      { id: 'ab', x: 1302, y: 107, w: 73, h: 33, tip: 'A/B : échange les VFO A et B ; appui d’au moins 1 s : A = B', act: { action: 'swap', long: { action: 'aToB' } } },
      { id: 'vm', x: 1397, y: 107, w: 75, h: 33, tip: 'V/M', act: info('Mémoires : pas encore reliées.') },
      { id: 'down', x: 1205, y: 157, w: 75, h: 33, tip: '▼ : bande précédente', act: { local: 'bandDown' } },
      { id: 'up', x: 1302, y: 157, w: 73, h: 33, tip: '▲ : bande suivante', act: { local: 'bandUp' } },
      { id: 'mpad', cx: 1442, cy: 187, r: 32, tip: 'MPAD', act: info('MPAD (mémoires rapides) : pas disponible à distance.') }
    ],
    knobs: [
      { id: 'dial', cx: 1310, cy: 415, ro: 160, ri: 160, dial: true, tip: 'Grand bouton : fréquence du VFO (molette ou glisser en tournant)' },
      // MULTI : la fonction de la case de l'écran (choisie dans le menu FUNCTION) ou le décalage RIT / ΔTX ; le pousser = menu FUNCTION
      { id: 'multi', cx: 1112, cy: 120, ro: 46, multi: true, pushLocal: 'multiMenu', tip: 'MULTI : clic = menu MULTI (RF POWER, MIC GAIN, COMP, MONITOR ; en CW : KEY SPEED, CW PITCH), tourner = le réglage choisi, ou le décalage RIT / ΔTX' },
      // TWIN PBT : centre = PBT intérieur, bague = PBT extérieur ; le pousser (CLR) = les deux au milieu
      { id: 'pbt', cx: 255, cy: 150, ri: 38, ro: 62, inner: { ctl: 'pbtIn', label: 'PBT intérieur', per: 4 }, outer: { ctl: 'pbtOut', label: 'PBT extérieur', per: 4 }, pushLocal: 'pbtClr' },
      { id: 'afRf', cx: 255, cy: 435, ri: 38, ro: 62, inner: { ctl: 'af', label: 'AF', per: 5 }, outer: { ctl: 'rf', label: 'RF', per: 5 } }
    ]
  };
})();
