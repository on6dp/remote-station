/*
 * faces/ftx1.js — face avant du Yaesu FTX-1 (tête Field avec l'ampli Optima) pour la page https://remote.op0p.be/ftx1
 *
 * Image : faces/ftx1.webp (1920 × 721 px, fournie par ON6DP). Positions dans un repère réduit aux 2/3 (1280 × 481) :
 * l'écran y a la même taille que celui du FTDX101 (571 × 320), pour le même dessin de l'écran.
 * x, y = coin haut gauche ; cx, cy = centre. ?zones=1 : contours visibles. Même format que faces/ftdx101.js.
 * Deux récepteurs (MAIN et SUB, DUAL RX) comme le FTDX101 ; sur l'écran du FTX-1, le SUB est à gauche et le MAIN à droite.
 * Sécurités propres au FTX-1 (pilote ftx1.js et serveur) inchangées : SPLIT virtuel (jamais ST1), passage MAIN ↔ SUB encadré.
 */
(function () {
  'use strict';
  const F = window.RS_FACES = window.RS_FACES || {};
  const info = (t) => ({ info: t });
  F.ftx1 = {
    model: 'ftx1',
    name: 'Yaesu FTX-1 Optima',
    image: '/faces/ftx1.webp',
    w: 1280,
    h: 481,
    // Écran : SUB à gauche, MAIN à droite (comme sur le TRX)
    subLeft: true,
    lcd: { x: 168, y: 99, w: 571, h: 320 },
    // Cases sous les fréquences : pas de R.FIL sur le FTX-1
    // Pas de cases ANT / ATT / IPO / NAR / AGC sous les fréquences sur l'écran du FTX-1 : le scope monte à leur place
    cells: [],
    lay: { lowY: 146, scopeY: 159, scopeH: 135 },
    statusBar: true, // barre d'état du TRX en haut de l'écran (FAST, VOX, TUNE ANT1, fonction du bouton FUNC)
    clarRight: true,
    // Tableau BAND du FTX-1 (appui sur MAG BAND) : [bande, libellé, kHz, mode] ; sans bande = pas à distance
    bandGrid: [['160M', '1.8', 1840, 'LSB'], ['80M', '3.5', 3700, 'LSB'], ['60M', '5.0', 5357, null], ['40M', '7.0', 7100, 'LSB'],
      ['30M', '10', 10136, null], ['20M', '14', 14200, 'USB'], ['17M', '18', 18130, 'USB'], ['15M', '21', 21250, 'USB'],
      ['12M', '24.5', 24950, 'USB'], ['10M', '28/29', 28500, 'USB'], ['6M', '50', 50150, 'USB'], [null, '70/GEN'],
      [null, 'AIR'], ['2M', '144', 144300, null], ['70CM', '430', 432200, null]],
    clarCycle: true, // CLAR : RX → TX → RXTX → arrêt, comme sur le TRX // « CLAR RXTX » à droite, juste avant le décalage
    vfoDy: 16, clarUp: 6, // fréquences 16 px plus bas, « CLAR RXTX  0Hz » 6 px au-dessus : bien dégagé des chiffres
    // Rangée du bas de l'écran du FTX-1
    bot: ['CENTER', '3DSS', 'MULTI', 'SCOPE', 'SPAN', 'SPEED'],
    // Voyants BUSY/TX au-dessus du grand bouton : SUB à gauche, MAIN à droite (vert = réception, rouge = émission)
    leds: [
      // Bandes lumineuses de part et d'autre du grand bouton : rouges quand le CLAR est en service (côté sélectionné)
      { path: 'M844.5 358.5A155 155 0 0 1 844.5 203.5L860.1 212.5A137 137 0 0 0 860.1 349.5Z', color: '#ff2a1a', on: (s) => !!(s.vfoSel === 1 ? s.ritB || s.xitB : s.rit || s.xit), bright: (s) => !!(s.vfoSel === 1 ? s.ritB || s.xitB : s.rit || s.xit) },
      { path: 'M1113.0 203.5A155 155 0 0 1 1113.0 358.5L1097.4 349.5A137 137 0 0 0 1097.4 212.5Z', color: '#ff2a1a', on: (s) => !!(s.vfoSel === 1 ? s.ritB || s.xitB : s.rit || s.xit), bright: (s) => !!(s.vfoSel === 1 ? s.ritB || s.xitB : s.rit || s.xit) },
      { x: 966, y: 112, w: 12, h: 17, rx: 2, color: '#3ddc5a', on: (s) => !!s.connected && !!s.dualRx && !(s.tx && s.txVfo === 1), bright: (s) => !!s.connected && !!s.dualRx },
      { x: 966, y: 112, w: 12, h: 17, rx: 2, color: '#ff3b30', on: (s, L) => !!s.tx && L.txSide(s) === 'B', bright: (s, L) => !!s.tx && L.txSide(s) === 'B' },
      { x: 984, y: 112, w: 12, h: 17, rx: 2, color: '#3ddc5a', on: (s) => !!s.connected && !(s.tx && s.txVfo !== 1), bright: (s) => !!s.connected },
      { x: 984, y: 112, w: 12, h: 17, rx: 2, color: '#ff3b30', on: (s, L) => !!s.tx && L.txSide(s) === 'A', bright: (s, L) => !!s.tx && L.txSide(s) === 'A' }
    ],
    keys: [
      // Touches au-dessus de l'écran
      { id: 'top1', x: 170, y: 10, w: 80, h: 31, tip: 'Touche du FTX-1', act: info('Cette touche du FTX-1 n’est pas disponible à distance.') },
      { id: 'sdx', x: 270, y: 10, w: 103, h: 31, tip: 'S-DX', act: info('S-DX : pas disponible à distance.') },
      { id: 'pmg', x: 393, y: 10, w: 113, h: 31, tip: 'PMG', act: info('PMG (mémoires) : pas disponible à distance.') },
      { id: 'band', x: 527, y: 10, w: 113, h: 31, tip: 'MAG BAND : tableau des bandes sur l’écran, comme l’appui d’1 s sur le TRX (clic sur une bande)', act: { local: 'bandMenu' } },
      { id: 'mode', x: 657, y: 10, w: 80, h: 31, tip: 'MODE : mode suivant (récepteur actif) ; appui d’au moins 1 s : tableau de tous les modes', act: { mode: 'cycle', longMenu: true } },
      { id: 'split', x: 803, y: 20, w: 93, h: 28, tip: 'SPLIT : émission sur l’autre VFO ; appui de plus d’1 s : SPLIT inversé (VFO échangés) (SPLIT virtuel du FTX-1 : rien n’est envoyé au TRX avant l’émission)', act: { local: 'split', long: { local: 'splitRev' } }, led: (s) => !!s.split },
      { id: 'vm', x: 920, y: 20, w: 107, h: 28, tip: 'V/M', act: info('Mémoires : pas encore reliées.') },
      { id: 'mv', x: 1053, y: 20, w: 93, h: 28, tip: 'M▸V', act: info('Mémoires : pas encore reliées.') },
      // Autour du grand bouton
      { id: 'qmb', x: 807, y: 83, w: 127, h: 70, tip: 'QMB', act: info('QMB (mémoires rapides) : pas disponible à distance.') },
      { id: 'clar', x: 1020, y: 83, w: 127, h: 70, tip: 'CLAR : 1er appui CLAR RX, 2e CLAR TX, 3e CLAR RXTX, 4e arrêt (appui long : décalage à zéro) ; le bouton FUNC règle le décalage', act: { clar: true }, led: (s) => !!(s.rit || s.xit) },
      { id: 'disp', x: 1163, y: 247, w: 57, h: 60, tip: 'DISP : affichage de l’écran — cascade MAIN → SUB au-dessus de MAIN → MAIN | SUB côte à côte → filtres agrandis → retour', act: { local: 'disp' } },
      { id: 'back', x: 810, y: 400, w: 120, h: 67, tip: 'BACK : ferme le tableau ou le menu ouvert', act: { local: 'exit' } },
      { id: 'fine', x: 1027, y: 400, w: 120, h: 67, tip: 'FINE/FAST : accord fin (pas de 1 Hz) ; appui d’au moins 1 s : accord rapide', act: { local: 'fine', long: { local: 'fast' } } },
      // À gauche de l'écran
      { id: 'lock', x: 20, y: 250, w: 87, h: 47, tip: 'LOCK : verrouille le grand bouton du TRX (la mise en marche se fait au club)', act: { local: 'lock' }, led: (s) => !!s.lock }
    ],
    knobs: [
      { id: 'dial', cx: 983, cy: 280, ro: 160, ri: 160, dial: true, tip: 'Grand bouton : fréquence du récepteur actif (molette ou glisser en tournant) ; CLAR en service : décalage' },
      { id: 'subDial', cx: 63, cy: 163, ro: 50, subDial: true, pushAct: { action: 'swap' }, pushTip: 'A ⇄ B', tip: 'SUB DIAL : tourner = fréquence du VFO B (SUB) ; clic = échange les deux VFO (A ⇄ B)' },
      // FUNC : comme le bouton MULTI du FTDX101 (fonction choisie dans le menu FUNC, décalage du clarifier) ; le pousser = menu FUNC
      { id: 'func', cx: 1215, cy: 170, ro: 50, multi: true, pushLocal: 'func', longLocal: 'funcLong', longMs: 1500, tip: 'FUNC : appui de 2 s = écran FUNC (et sortie) ; dans l’écran : tourner = choisir la case, pousser = la régler (tourner), pousser = fini. Écran fermé : tourner = la fonction choisie (ex. RF POWER) ou le clarifier' },
      { id: 'afSub', cx: 63, cy: 410, ri: 28, ro: 50, inner: { ctl: 'afB', label: 'AF SUB', per: 5 }, outer: { ctl: 'rfB', label: 'RF SUB', per: 5 } },
      { id: 'afMain', cx: 1220, cy: 410, ri: 28, ro: 50, inner: { ctl: 'af', label: 'AF MAIN', per: 5 }, outer: { ctl: 'rf', label: 'RF MAIN', per: 5 } }
    ]
  };
})();
