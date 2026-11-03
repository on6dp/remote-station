/*
 * faces/ftdx10.js — face avant du Yaesu FTDX10 pour la page https://remote.op0p.be/ftdx10
 *
 * Image : faces/ftdx10.webp (photo 1483 × 511 px fournie par ON6DP ; voyants VFO-A de la photo éteints).
 * Positions en pixels de cette image (x, y = coin haut gauche ; cx, cy = centre). ?zones=1 : contours visibles.
 * Un seul récepteur : VFO-A et VFO-B se partagent le même récepteur (pas de double réception, pas de SUB).
 * Même format que faces/ftdx101.js (voir ce fichier pour act / led / leds / knobs).
 */
(function () {
  'use strict';
  const F = window.RS_FACES = window.RS_FACES || {};
  const info = (t) => ({ info: t });
  // Voyant orange d'une touche (petit trait au-dessus du nom)
  const dot = (x, y, on) => [{ x, y, w: 10, h: 3, color: '#ff9a1f', on, bright: on }];
  F.ftdx10 = {
    model: 'ftdx10',
    name: 'Yaesu FTDX10',
    image: '/faces/ftdx10.webp',
    w: 1483,
    h: 511,
    // Un seul récepteur : écran du FTDX10 (un S-mètre, VFO-A en grand, VFO-B en petit dessous)
    single: true,
    // R.FIL du FTDX10 (RF0 : 1 = 12 kHz, 2 = 3 kHz, 4 = 500 Hz, 5 = 300 Hz en option) ; cycle de la case R.FIL : 12k → 3k → 500
    roof: { labels: ['', '12kHz', '3kHz', '', '500Hz', '300Hz'], hz: [0, 12000, 3000, 0, 500, 300], std: [1, 2, 4] },
    lcd: { x: 175, y: 63, w: 606, h: 366 },
    // Voyants du bandeau du haut : BUSY, TX, VFO-A et VFO-B (vert = réception, rouge = émission), FINE, STEP
    leds: [
      { x: 947, y: 62, w: 38, h: 11, rx: 2, color: '#ff3b30', on: (s) => !!s.tx, bright: (s) => !!s.tx },
      { x: 1098, y: 70.5, w: 40, h: 5, color: '#3ddc5a', on: (s) => !!s.connected && s.vfoSel !== 1, bright: (s) => !!s.connected && s.vfoSel !== 1 },
      { x: 1146, y: 70.5, w: 40, h: 5, color: '#ff3b30', on: (s, L) => !!s.connected && L.txSide(s) === 'A', bright: (s, L) => !!s.tx && L.txSide(s) === 'A' },
      { x: 1197, y: 70.5, w: 36, h: 5, color: '#3ddc5a', on: (s) => s.vfoSel === 1, bright: (s) => s.vfoSel === 1 },
      { x: 1245, y: 70.5, w: 36, h: 5, color: '#ff3b30', on: (s, L) => !!s.connected && L.txSide(s) === 'B', bright: (s, L) => !!s.tx && L.txSide(s) === 'B' },
      { x: 1305, y: 62, w: 33, h: 11, rx: 2, color: '#ff9a1f', on: (s, L) => !!L.fine, bright: (s, L) => !!L.fine },
      { x: 1351, y: 62, w: 39, h: 11, rx: 2, color: '#ff9a1f', on: (s, L) => !!L.fast, bright: (s, L) => !!L.fast }
    ],
    keys: [
      { id: 'onoff', x: 33, y: 45, w: 80, h: 47, tip: 'ON/OFF : la mise en marche se fait au club', act: info('Le TRX ne s’allume et ne s’éteint qu’au club.') },
      { id: 'tune', x: 33, y: 148, w: 84, h: 40, tip: 'TUNE : coupleur d’antenne en service / hors service ; appui d’au moins 1 s : accord (émission courte, avec la main)', act: { toggle: 'tuner', long: { action: 'tune' } }, led: (s) => !!(s.tuner || s.tuning), ledColor: '#ff8a1f' },
      { id: 'vox', x: 33, y: 205, w: 84, h: 38, tip: 'VOX (ne peut être que coupé à distance) ; appui d’au moins 1 s : MOX, émission maintenue (clic suivant : réception)', act: { toggle: 'vox', long: { local: 'mox' } },
        leds: [{ x: 60, y: 210.5, w: 13, h: 3.5, color: '#ff9a1f', on: (s) => !!s.vox, bright: (s) => !!s.vox }, { x: 33, y: 205, w: 84, h: 38, rx: 5, color: '#ff3b30', on: (s, L) => !!L.mox }] },
      // Rangée du haut
      { id: 'm', x: 927, y: 100, w: 75, h: 28, tip: 'M (mémoires)', act: info('Mémoires : pas encore reliées.') },
      { id: 'vm', x: 1012, y: 100, w: 75, h: 28, tip: 'V/M', act: info('Mémoires : pas encore reliées.') },
      { id: 'ab', x: 1094, y: 100, w: 106, h: 28, tip: 'A/B : échange les fréquences des VFO A et B ; appui d’au moins 1 s : copie A → B', act: { action: 'swap', long: { action: 'aToB' } } },
      { id: 'clarRx', x: 1210, y: 100, w: 70, h: 28, tip: 'CLAR RX (RIT) ; le bouton FUNC règle le décalage', act: { toggle: 'rit' }, led: (s) => !!s.rit },
      { id: 'clarTx', x: 1289, y: 100, w: 70, h: 28, tip: 'CLAR TX (XIT) ; le bouton FUNC règle le décalage', act: { toggle: 'xit' }, led: (s) => !!s.xit },
      { id: 'qmb', x: 942, y: 141, w: 128, h: 35, tip: 'QMB', act: info('QMB (mémoires rapides) : pas disponible à distance.') },
      { id: 'split', x: 1221, y: 141, w: 121, h: 35, tip: 'SPLIT : émission sur le VFO B (voyant VFO-B rouge, fréquence d’émission en rouge)', act: { local: 'split' }, led: (s) => !!s.split },
      { id: 'band', x: 950, y: 191, w: 67, h: 44, tip: 'BAND : tableau des bandes sur l’écran (clic sur une bande)', act: { local: 'bandMenu' } },
      { id: 'mode', x: 1275, y: 191, w: 80, h: 44, tip: 'MODE : mode suivant ; appui d’au moins 1 s : tableau de tous les modes', act: { mode: 'cycle', longMenu: true } },
      { id: 'step', x: 920, y: 250, w: 55, h: 45, tip: 'STEP/MCH : accord rapide (1 kHz par cran), nouveau clic : normal (voyant STEP)', act: { local: 'fast' } },
      { id: 'txw', x: 1322, y: 255, w: 48, h: 40, tip: 'TXW', act: info('TXW (écoute de la fréquence d’émission) : pas disponible à distance.') },
      // DSP
      { id: 'nb', x: 831, y: 272, w: 74, h: 30, tip: 'NB — appui d’au moins 1 s : niveau NB', act: { toggle: 'nb', long: { pop: 'nbLvl' } }, led: (s) => !!s.nb },
      { id: 'dnr', x: 831, y: 324, w: 74, h: 32, tip: 'DNR — appui d’au moins 1 s : niveau DNR', act: { toggle: 'nr', long: { pop: 'nrLvl' } }, led: (s) => !!s.nr },
      { id: 'notch', x: 1386, y: 272, w: 76, h: 32, tip: 'NOTCH (le bouton NOTCH règle sa fréquence)', act: { toggle: 'notch' }, led: (s) => !!s.notch },
      { id: 'cont', x: 1386, y: 324, w: 76, h: 33, tip: 'CONT/APF : CONTOUR (en CW : APF)', act: { contApf: true }, led: (s) => !!(s.contour || (/^CW/.test(s.mode || '') && s.apf)) },
      { id: 'cs', x: 916, y: 309, w: 51, h: 51, tip: 'C.S', act: info('C.S (touche personnalisable) : pas disponible à distance.') },
      { id: 'zin', x: 1325, y: 309, w: 50, h: 51, tip: 'ZIN/SPOT', act: info('ZIN / SPOT : pas disponible à distance.') },
      { id: 'fine', x: 942, y: 425, w: 80, h: 60, tip: 'FINE : accord fin (1 Hz par cran)', act: { local: 'fine' }, leds: dot(975, 430.5, (s, L) => !!L.fine) },
      { id: 'lock', x: 1272, y: 425, w: 78, h: 60, tip: 'LOCK : verrouille le grand bouton du TRX', act: { local: 'lock' }, leds: dot(1332, 430.5, (s) => !!s.lock) },
      // Prises
      { id: 'phones', cx: 72, cy: 310, r: 22, tip: 'PHONES : écouter le TRX (clic : marche / arrêt)', act: { local: 'listen' }, led: (s, L) => L.listening, ledColor: '#3ddc5a', ring: true },
      { id: 'mic', cx: 72, cy: 433, r: 45, tip: 'MIC', act: info('Micro : phonie à distance par le bouton PTT sous la face avant (Configuration micro).') }
    ],
    knobs: [
      { id: 'dial', cx: 1150, cy: 340, ro: 168, ri: 168, dial: true, tip: 'Grand bouton : fréquence du VFO (molette ou glisser en tournant) ; CLAR en service : décalage' },
      // FUNC : comme le bouton MULTI du FTDX101 (fonction choisie dans le menu FUNC, décalage du clarifier) ; le pousser = menu FUNC
      { id: 'func', cx: 882, cy: 202, ro: 50, multi: true, pushLocal: 'func', tip: 'FUNC : tourner = la fonction de la case de l’écran (choisie dans le menu FUNC, ex. RF POWER) ou le décalage du clarifier ; clic = menu FUNC' },
      { id: 'afRf', cx: 874, cy: 460, ri: 28, ro: 50, inner: { ctl: 'af', label: 'AF', per: 5 }, outer: { ctl: 'rf', label: 'RF', per: 5 } },
      { id: 'sw', cx: 1425, cy: 202, ri: 28, ro: 50, inner: { ctl: 'shift', label: 'SHIFT', per: 20 }, outer: { ctl: 'width', label: 'WIDTH', per: 1 }, longReset: 'A',
        // Petits voyants orange : SHIFT décalé (≠ 0) à gauche, WIDTH changé à droite
        leds: [{ x: 1366, y: 144, w: 9, h: 4, color: '#ff9a1f', on: (s) => !!s.shift, bright: (s) => !!s.shift },
          { x: 1454, y: 144, w: 9, h: 4, color: '#ff9a1f', on: (s, L) => L.widthChanged(s, ''), bright: (s, L) => L.widthChanged(s, '') }] },
      { id: 'notchCont', longReset: 'nA', cx: 1417, cy: 460, ri: 28, ro: 50, inner: { ctl: 'notchFreq', label: 'NOTCH', per: 10 }, outer: { ctl: 'contourFreq', label: 'CONT', per: 10, offKey: 'contour', offName: 'CONT',
        alt: { when: (s) => /^CW/.test(s.mode || '') && !!s.apf, ctl: 'apfFreq', label: 'APF', per: 1 } } }
    ]
  };
})();
