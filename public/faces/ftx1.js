/*
 * faces/ftx1.js — face avant du Yaesu FTX-1 (tête Field avec l'ampli Optima) pour la page https://remote.op0p.be/ftx1
 *
 * Image : faces/ftx1.webp (2626 × 996 px : photo Yaesu fournie par ON6DP le 07/11/2026, coins blancs rendus transparents,
 * définition doublée). Positions dans un repère de 1284 × 487 (photo d'origine 1313 × 498 × 571/584) : l'écran y a la même
 * taille que celui du FTDX101 (571 × 320), pour le même dessin de l'écran.
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
    w: 1284,
    h: 487,
    // Écran : SUB à gauche, MAIN à droite (comme sur le TRX)
    subLeft: true,
    lcd: { x: 168, y: 107, w: 571, h: 320 },
    // Cases sous les fréquences : pas de R.FIL sur le FTX-1
    // Pas de cases ANT / ATT / IPO / NAR / AGC sous les fréquences sur l'écran du FTX-1 : le scope monte à leur place
    cells: [],
    lay: { lowY: 141, scopeY: 154, scopeH: 140, expUp: 70 }, // EXPAND : le scope monte jusque sous les fréquences
    meterFtx: true, // galvanomètres du FTX-1 : MAIN = S, SWR et barre VOL ; SUB = S seul
    freqFont: 36, // fréquences en Arial Black penché, comme la police du TRX (taille de la police)
    noMono: true, // pas de MONO ni d'EXPAND sur le FTX-1 (pas de touche EXPAND dans la rangée du bas)
    vfoBadges: true, // [MAIN|SUB][VFO], [RX] / [TXRX], mode encadré, comme sur le TRX
    statusBar: true, // barre d'état du TRX en haut de l'écran (FAST, VOX, TUNE ANT1, fonction du bouton FUNC)
    clarRight: true,
    // Tableau BAND du FTX-1 (appui sur MAG BAND) : [bande, libellé, kHz, mode] ; sans bande = pas à distance
    bandGrid: [['160M', '1.8', 1840, 'LSB'], ['80M', '3.5', 3700, 'LSB'], ['60M', '5.0', 5357, null], ['40M', '7.0', 7100, 'LSB'],
      ['30M', '10', 10136, null], ['20M', '14', 14200, 'USB'], ['17M', '18', 18130, 'USB'], ['15M', '21', 21250, 'USB'],
      ['12M', '24.5', 24950, 'USB'], ['10M', '28/29', 28500, 'USB'], ['6M', '50', 50150, 'USB'], [null, '70/GEN'],
      [null, 'AIR'], ['2M', '144', 144300, null], ['70CM', '430', 432200, null]],
    clarCycle: true, // CLAR : RX → TX → RXTX → arrêt, comme sur le TRX // « CLAR RXTX » à droite, juste avant le décalage
    vfoDy: -62, clarUp: 4, meterDy: 52, actOrange: true, // fréquences en haut (VFO actif en orange), galvanomètres dessous
    // fréquences 16 px plus bas, « CLAR RXTX  0Hz » 6 px au-dessus : bien dégagé des chiffres
    // Rangée du bas de l'écran du FTX-1
    bot: ['D-MODE', '3DSS', 'MULTI', 'SCOPE', 'SPAN', 'SPEED'], botSub: ['D-MODE', 'SCOPE'], // D-MODE : CENTER / CURSOR / FIX
    // Voyants BUSY/TX au-dessus du grand bouton : SUB à gauche, MAIN à droite — éteints en réception (pas de vert sur le TRX),
    // rouges sur le VFO qui émet (SPLIT compris)
    leds: [
      // Bandes bleues du grand bouton : allumées quand le MAIN est actif, éteintes quand le SUB est actif (comme sur le TRX)
      { path: 'M840.4 217.1L837.4 219.0L836.5 221.0L835.5 222.9L834.5 224.9L833.5 226.8L832.5 228.8L831.6 230.7L830.6 232.7L830.6 234.7L829.6 236.6L828.6 238.6L828.6 240.5L827.7 242.5L827.7 244.4L826.7 246.4L826.7 248.3L825.7 250.3L824.7 252.3L824.7 254.2L823.7 256.2L823.7 258.1L823.7 260.1L822.8 262.0L822.8 264.0L821.8 265.9L821.8 267.9L821.8 269.9L821.8 271.8L821.8 273.8L820.8 275.7L820.8 277.7L820.8 279.6L820.8 281.6L820.8 283.5L820.8 285.5L820.8 287.5L820.8 289.4L820.8 291.4L820.8 293.3L820.8 295.3L820.8 297.2L820.8 299.2L820.8 301.1L821.8 303.1L821.8 305.1L821.8 307.0L821.8 309.0L822.8 310.9L822.8 312.9L823.7 314.8L823.7 316.8L823.7 318.7L824.7 320.7L824.7 322.7L825.7 324.6L825.7 326.6L826.7 328.5L827.7 330.5L828.6 332.4L828.6 334.4L829.6 336.3L830.6 338.3L831.6 340.3L831.6 342.2L832.5 344.2L833.5 346.1L834.5 348.1L835.5 350.0L835.5 352.0L836.5 353.9L838.4 355.9L840.4 357.9L847.2 357.9L847.2 355.9L847.2 353.9L846.2 352.0L845.3 350.0L844.3 348.1L843.3 346.1L842.3 344.2L841.3 342.2L840.4 340.3L839.4 338.3L839.4 336.3L838.4 334.4L837.4 332.4L837.4 330.5L836.5 328.5L836.5 326.6L835.5 324.6L835.5 322.7L834.5 320.7L834.5 318.7L834.5 316.8L833.5 314.8L832.5 312.9L832.5 310.9L832.5 309.0L832.5 307.0L831.6 305.1L831.6 303.1L831.6 301.1L830.6 299.2L830.6 297.2L830.6 295.3L830.6 293.3L830.6 291.4L830.6 289.4L830.6 287.5L830.6 285.5L830.6 283.5L830.6 281.6L830.6 279.6L830.6 277.7L830.6 275.7L830.6 273.8L831.6 271.8L831.6 269.9L831.6 267.9L832.5 265.9L832.5 264.0L832.5 262.0L833.5 260.1L833.5 258.1L834.5 256.2L834.5 254.2L835.5 252.3L835.5 250.3L836.5 248.3L836.5 246.4L837.4 244.4L838.4 242.5L838.4 240.5L839.4 238.6L840.4 236.6L841.3 234.7L842.3 232.7L842.3 230.7L843.3 228.8L844.3 226.8L845.3 224.9L846.2 222.9L847.2 221.0L848.2 219.0L846.2 217.1Z', color: '#25282d', cls: 'dark', on: (s) => s.vfoSel === 1 && !(s.ritB || s.xitB), bright: () => false },
      { path: 'M1116.1 217.1L1114.1 219.0L1115.1 221.0L1116.1 222.9L1117.1 224.9L1118.0 226.8L1119.0 228.8L1119.0 230.7L1120.0 232.7L1121.0 234.7L1122.0 236.6L1122.9 238.6L1122.9 240.5L1123.9 242.5L1124.9 244.4L1124.9 246.4L1125.9 248.3L1126.8 250.3L1126.8 252.3L1127.8 254.2L1127.8 256.2L1128.8 258.1L1128.8 260.1L1128.8 262.0L1129.8 264.0L1129.8 265.9L1130.8 267.9L1130.8 269.9L1130.8 271.8L1130.8 273.8L1130.8 275.7L1130.8 277.7L1131.7 279.6L1130.8 281.6L1131.7 283.5L1131.7 285.5L1131.7 287.5L1131.7 289.4L1130.8 291.4L1130.8 293.3L1130.8 295.3L1130.8 297.2L1130.8 299.2L1130.8 301.1L1130.8 303.1L1129.8 305.1L1129.8 307.0L1129.8 309.0L1128.8 310.9L1128.8 312.9L1127.8 314.8L1127.8 316.8L1127.8 318.7L1126.8 320.7L1126.8 322.7L1125.9 324.6L1125.9 326.6L1124.9 328.5L1123.9 330.5L1123.9 332.4L1122.9 334.4L1122.0 336.3L1121.0 338.3L1120.0 340.3L1119.0 342.2L1119.0 344.2L1118.0 346.1L1117.1 348.1L1116.1 350.0L1115.1 352.0L1114.1 353.9L1114.1 355.9L1115.1 357.9L1122.0 357.9L1123.9 355.9L1124.9 353.9L1125.9 352.0L1126.8 350.0L1127.8 348.1L1128.8 346.1L1129.8 344.2L1130.8 342.2L1130.8 340.3L1131.7 338.3L1132.7 336.3L1133.7 334.4L1133.7 332.4L1134.7 330.5L1134.7 328.5L1135.6 326.6L1136.6 324.6L1136.6 322.7L1136.6 320.7L1137.6 318.7L1137.6 316.8L1138.6 314.8L1138.6 312.9L1139.6 310.9L1139.6 309.0L1139.6 307.0L1139.6 305.1L1139.6 303.1L1140.5 301.1L1140.5 299.2L1140.5 297.2L1140.5 295.3L1140.5 293.3L1140.5 291.4L1140.5 289.4L1140.5 287.5L1140.5 285.5L1140.5 283.5L1140.5 281.6L1140.5 279.6L1140.5 277.7L1140.5 275.7L1140.5 273.8L1139.6 271.8L1139.6 269.9L1139.6 267.9L1139.6 265.9L1139.6 264.0L1138.6 262.0L1138.6 260.1L1137.6 258.1L1137.6 256.2L1137.6 254.2L1136.6 252.3L1136.6 250.3L1135.6 248.3L1135.6 246.4L1134.7 244.4L1134.7 242.5L1133.7 240.5L1133.7 238.6L1132.7 236.6L1131.7 234.7L1130.8 232.7L1130.8 230.7L1129.8 228.8L1128.8 226.8L1127.8 224.9L1126.8 222.9L1124.9 221.0L1123.9 219.0L1122.0 217.1Z', color: '#25282d', cls: 'dark', on: (s) => s.vfoSel === 1 && !(s.ritB || s.xitB), bright: () => false },
      // Bandes lumineuses de part et d'autre du grand bouton : rouges quand le CLAR est en service (côté sélectionné)
      { path: 'M840.4 217.1L837.4 219.0L836.5 221.0L835.5 222.9L834.5 224.9L833.5 226.8L832.5 228.8L831.6 230.7L830.6 232.7L830.6 234.7L829.6 236.6L828.6 238.6L828.6 240.5L827.7 242.5L827.7 244.4L826.7 246.4L826.7 248.3L825.7 250.3L824.7 252.3L824.7 254.2L823.7 256.2L823.7 258.1L823.7 260.1L822.8 262.0L822.8 264.0L821.8 265.9L821.8 267.9L821.8 269.9L821.8 271.8L821.8 273.8L820.8 275.7L820.8 277.7L820.8 279.6L820.8 281.6L820.8 283.5L820.8 285.5L820.8 287.5L820.8 289.4L820.8 291.4L820.8 293.3L820.8 295.3L820.8 297.2L820.8 299.2L820.8 301.1L821.8 303.1L821.8 305.1L821.8 307.0L821.8 309.0L822.8 310.9L822.8 312.9L823.7 314.8L823.7 316.8L823.7 318.7L824.7 320.7L824.7 322.7L825.7 324.6L825.7 326.6L826.7 328.5L827.7 330.5L828.6 332.4L828.6 334.4L829.6 336.3L830.6 338.3L831.6 340.3L831.6 342.2L832.5 344.2L833.5 346.1L834.5 348.1L835.5 350.0L835.5 352.0L836.5 353.9L838.4 355.9L840.4 357.9L847.2 357.9L847.2 355.9L847.2 353.9L846.2 352.0L845.3 350.0L844.3 348.1L843.3 346.1L842.3 344.2L841.3 342.2L840.4 340.3L839.4 338.3L839.4 336.3L838.4 334.4L837.4 332.4L837.4 330.5L836.5 328.5L836.5 326.6L835.5 324.6L835.5 322.7L834.5 320.7L834.5 318.7L834.5 316.8L833.5 314.8L832.5 312.9L832.5 310.9L832.5 309.0L832.5 307.0L831.6 305.1L831.6 303.1L831.6 301.1L830.6 299.2L830.6 297.2L830.6 295.3L830.6 293.3L830.6 291.4L830.6 289.4L830.6 287.5L830.6 285.5L830.6 283.5L830.6 281.6L830.6 279.6L830.6 277.7L830.6 275.7L830.6 273.8L831.6 271.8L831.6 269.9L831.6 267.9L832.5 265.9L832.5 264.0L832.5 262.0L833.5 260.1L833.5 258.1L834.5 256.2L834.5 254.2L835.5 252.3L835.5 250.3L836.5 248.3L836.5 246.4L837.4 244.4L838.4 242.5L838.4 240.5L839.4 238.6L840.4 236.6L841.3 234.7L842.3 232.7L842.3 230.7L843.3 228.8L844.3 226.8L845.3 224.9L846.2 222.9L847.2 221.0L848.2 219.0L846.2 217.1Z', color: '#ff2a1a', on: (s) => !!(s.vfoSel === 1 ? s.ritB || s.xitB : s.rit || s.xit), bright: (s) => !!(s.vfoSel === 1 ? s.ritB || s.xitB : s.rit || s.xit) },
      { path: 'M1116.1 217.1L1114.1 219.0L1115.1 221.0L1116.1 222.9L1117.1 224.9L1118.0 226.8L1119.0 228.8L1119.0 230.7L1120.0 232.7L1121.0 234.7L1122.0 236.6L1122.9 238.6L1122.9 240.5L1123.9 242.5L1124.9 244.4L1124.9 246.4L1125.9 248.3L1126.8 250.3L1126.8 252.3L1127.8 254.2L1127.8 256.2L1128.8 258.1L1128.8 260.1L1128.8 262.0L1129.8 264.0L1129.8 265.9L1130.8 267.9L1130.8 269.9L1130.8 271.8L1130.8 273.8L1130.8 275.7L1130.8 277.7L1131.7 279.6L1130.8 281.6L1131.7 283.5L1131.7 285.5L1131.7 287.5L1131.7 289.4L1130.8 291.4L1130.8 293.3L1130.8 295.3L1130.8 297.2L1130.8 299.2L1130.8 301.1L1130.8 303.1L1129.8 305.1L1129.8 307.0L1129.8 309.0L1128.8 310.9L1128.8 312.9L1127.8 314.8L1127.8 316.8L1127.8 318.7L1126.8 320.7L1126.8 322.7L1125.9 324.6L1125.9 326.6L1124.9 328.5L1123.9 330.5L1123.9 332.4L1122.9 334.4L1122.0 336.3L1121.0 338.3L1120.0 340.3L1119.0 342.2L1119.0 344.2L1118.0 346.1L1117.1 348.1L1116.1 350.0L1115.1 352.0L1114.1 353.9L1114.1 355.9L1115.1 357.9L1122.0 357.9L1123.9 355.9L1124.9 353.9L1125.9 352.0L1126.8 350.0L1127.8 348.1L1128.8 346.1L1129.8 344.2L1130.8 342.2L1130.8 340.3L1131.7 338.3L1132.7 336.3L1133.7 334.4L1133.7 332.4L1134.7 330.5L1134.7 328.5L1135.6 326.6L1136.6 324.6L1136.6 322.7L1136.6 320.7L1137.6 318.7L1137.6 316.8L1138.6 314.8L1138.6 312.9L1139.6 310.9L1139.6 309.0L1139.6 307.0L1139.6 305.1L1139.6 303.1L1140.5 301.1L1140.5 299.2L1140.5 297.2L1140.5 295.3L1140.5 293.3L1140.5 291.4L1140.5 289.4L1140.5 287.5L1140.5 285.5L1140.5 283.5L1140.5 281.6L1140.5 279.6L1140.5 277.7L1140.5 275.7L1140.5 273.8L1139.6 271.8L1139.6 269.9L1139.6 267.9L1139.6 265.9L1139.6 264.0L1138.6 262.0L1138.6 260.1L1137.6 258.1L1137.6 256.2L1137.6 254.2L1136.6 252.3L1136.6 250.3L1135.6 248.3L1135.6 246.4L1134.7 244.4L1134.7 242.5L1133.7 240.5L1133.7 238.6L1132.7 236.6L1131.7 234.7L1130.8 232.7L1130.8 230.7L1129.8 228.8L1128.8 226.8L1127.8 224.9L1126.8 222.9L1124.9 221.0L1123.9 219.0L1122.0 217.1Z', color: '#ff2a1a', on: (s) => !!(s.vfoSel === 1 ? s.ritB || s.xitB : s.rit || s.xit), bright: (s) => !!(s.vfoSel === 1 ? s.ritB || s.xitB : s.rit || s.xit) },
      { x: 965.5, y: 121, w: 9.5, h: 17, rx: 2, color: '#ff3b30', on: (s, L) => !!s.tx && L.txSide(s) === 'B', bright: (s, L) => !!s.tx && L.txSide(s) === 'B' },
      { x: 988.5, y: 121, w: 9, h: 17, rx: 2, color: '#ff3b30', on: (s, L) => !!s.tx && L.txSide(s) === 'A', bright: (s, L) => !!s.tx && L.txSide(s) === 'A' }
    ],
    keys: [
      // Touches au-dessus de l'écran
      { id: 'top1', x: 161, y: 4, w: 91, h: 43, tip: 'Touche du FTX-1', act: info('Cette touche du FTX-1 n’est pas disponible à distance.') },
      { id: 'sdx', x: 252, y: 4, w: 132, h: 43, tip: 'S-DX (Super DX) : renforce les signaux faibles en réception ; « S-DX » à côté de FAST / FINE quand il est en service. Pas de commande CAT : seulement au club', act: info('S-DX (Super DX, renfort des signaux faibles) : le FTX-1 n’a pas de commande CAT pour lui, il ne se règle donc qu’au club (appui bref : en service / hors service ; appui long : copie d’écran sur la carte microSD).') },
      { id: 'pmg', x: 384, y: 4, w: 134, h: 43, tip: 'PMG', act: info('PMG (mémoires) : pas disponible à distance.') },
      { id: 'band', x: 518, y: 4, w: 127, h: 43, tip: 'MAG BAND : appui bref = bande suivante (1.8 → 3.5 → 7 → 10 → 14 …) ; appui d’1 s = tableau des bandes (clic sur une bande, pour redescendre)', act: { local: 'bandUp', long: { local: 'bandMenu' } } },
      { id: 'mode', x: 645, y: 4, w: 108, h: 43, tip: 'MODE : mode suivant (récepteur actif) ; appui d’au moins 1 s : tableau de tous les modes', act: { mode: 'cycle', longMenu: true } },
      { id: 'split', x: 797, y: 24, w: 108, h: 32, tip: 'SPLIT : émission sur l’autre VFO ; appui de plus d’1 s : l’autre VFO prend la même fréquence et SPLIT (émission là, ▼ rouge) ; le grand bouton déplace ensuite l’écoute (▼ vert) (SPLIT virtuel du FTX-1 : rien n’est envoyé au TRX avant l’émission)', act: { local: 'split', long: { local: 'splitQuick' } }, led: (s) => !!s.split },
      { id: 'vm', x: 924, y: 24, w: 112, h: 32, tip: 'V/M', act: info('Mémoires : pas encore reliées.') },
      { id: 'mv', x: 1051, y: 24, w: 103, h: 32, tip: 'M▸V', act: info('Mémoires : pas encore reliées.') },
      // Autour du grand bouton
      { id: 'qmb', x: 807, y: 90, w: 127, h: 68, tip: 'QMB', act: info('QMB (mémoires rapides) : pas disponible à distance.') },
      { id: 'clar', x: 1022, y: 90, w: 137, h: 68, tip: 'CLAR : 1er appui CLAR RX, 2e CLAR TX, 3e CLAR RXTX, 4e arrêt (appui long : décalage à zéro) ; le bouton FUNC règle le décalage', act: { clar: true }, led: (s) => !!(s.rit || s.xit) },
      { id: 'disp', x: 1163, y: 244, w: 59, h: 68, tip: 'DISP : comme sur le TRX — écran normal → un VFO et le scope → MAIN et SUB l’un sur l’autre (sans scope) → filtres agrandis → retour', act: { local: 'disp' } },
      { id: 'back', x: 802, y: 411, w: 132, h: 64, tip: 'BACK : ferme le tableau ou le menu ouvert', act: { local: 'exit' } },
      { id: 'fine', x: 1036, y: 411, w: 122, h: 64, tip: 'FINE/FAST : accord fin (pas de 1 Hz) ; appui d’au moins 1 s : accord rapide', act: { local: 'fine', long: { local: 'fast' } } },
      // À gauche de l'écran
      { id: 'lock', x: 22, y: 251, w: 84, h: 52, tip: 'LOCK : verrouille le grand bouton du TRX (la mise en marche se fait au club)', act: { local: 'lock' }, led: (s) => !!s.lock }
    ],
    knobs: [
      { id: 'dial', cx: 1001, cy: 313, ro: 147, ri: 147, dial: true, tip: 'Grand bouton : fréquence du récepteur actif (molette ou glisser en tournant) ; CLAR en service : décalage' },
      { id: 'subDial', cx: 59, cy: 164, ro: 47, subDial: true, pushLocal: 'sideToggle', tip: 'SUB DIAL : tourner = fréquence du VFO B (SUB) ; clic = VFO actif MAIN ⇄ SUB (en double réception seulement, par sécurité)' },
      // FUNC : comme le bouton MULTI du FTDX101 (fonction choisie dans le menu FUNC, décalage du clarifier) ; le pousser = menu FUNC
      { id: 'func', cx: 1217, cy: 184, ro: 49, multi: true, pushLocal: 'func', longLocal: 'funcLong', longMs: 1500, tip: 'FUNC : appui de 2 s = écran FUNC (et sortie) ; dans l’écran : tourner = choisir la case, pousser = la régler (tourner), pousser = fini. Écran fermé : tourner = la fonction choisie (ex. RF POWER) ou le clarifier' },
      { id: 'afSub', cx: 59, cy: 409, ri: 28, ro: 49, dspSide: 'B', longLocal: 'dspB', longMs: 1000, pushLocal: 'dspTab', inner: { ctl: 'afB', label: 'AF SUB', per: 5 }, outer: { ctl: 'rfB', label: 'RF SUB', per: 5 } },
      { id: 'afMain', cx: 1227, cy: 413, ri: 28, ro: 49, dspSide: 'A', longLocal: 'dspA', longMs: 1000, pushLocal: 'dspTab', inner: { ctl: 'af', label: 'AF MAIN', per: 5 }, outer: { ctl: 'rf', label: 'RF MAIN', per: 5 } }
    ]
  };
})();
