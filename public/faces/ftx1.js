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
    lay: { lowY: 141, scopeY: 154, scopeH: 140 },
    vfoDy: 10, // fréquences 10 px plus bas : « CLAR RXTX  0Hz » juste au-dessus, comme sur le TRX
    // Rangée du bas de l'écran du FTX-1
    bot: ['CENTER', '3DSS', 'MULTI', 'SCOPE', 'SPAN', 'SPEED'],
    // Voyants BUSY/TX au-dessus du grand bouton : SUB à gauche, MAIN à droite (vert = réception, rouge = émission)
    leds: [
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
      { id: 'band', x: 527, y: 10, w: 113, h: 31, tip: 'BAND : tableau des bandes sur l’écran (clic sur une bande)', act: { local: 'bandMenu' } },
      { id: 'mode', x: 657, y: 10, w: 80, h: 31, tip: 'MODE : mode suivant (récepteur actif) ; appui d’au moins 1 s : tableau de tous les modes', act: { mode: 'cycle', longMenu: true } },
      { id: 'split', x: 803, y: 20, w: 93, h: 28, tip: 'SPLIT : émission sur l’autre VFO (SPLIT virtuel du FTX-1 : rien n’est envoyé au TRX avant l’émission)', act: { local: 'split' }, led: (s) => !!s.split },
      { id: 'vm', x: 920, y: 20, w: 107, h: 28, tip: 'V/M', act: info('Mémoires : pas encore reliées.') },
      { id: 'mv', x: 1053, y: 20, w: 93, h: 28, tip: 'M▸V', act: info('Mémoires : pas encore reliées.') },
      // Autour du grand bouton
      { id: 'qmb', x: 807, y: 83, w: 127, h: 70, tip: 'QMB', act: info('QMB (mémoires rapides) : pas disponible à distance.') },
      { id: 'clar', x: 1020, y: 83, w: 127, h: 70, tip: 'CLAR : clarifier de réception (appui long : décalage à zéro) ; le bouton FUNC règle le décalage', act: { clar: true }, led: (s) => !!(s.rit || s.xit) },
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
