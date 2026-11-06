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
    // Voyants BUSY/TX au-dessus du grand bouton : SUB à gauche, MAIN à droite (vert = réception, rouge = émission)
    // BUSY/TX SUB | MAIN : vert en réception, rouge pour le VFO qui émet (SPLIT compris)
    leds: [
      // Bandes bleues du grand bouton : allumées quand le MAIN est actif, éteintes quand le SUB est actif (comme sur le TRX)
      { path: 'M838.5 210.0L837.3 212.0L834.5 214.0L831.7 216.0L830.1 218.0L830.6 220.0L830.3 222.0L828.3 224.0L827.4 226.0L827.0 228.0L826.5 230.0L826.1 232.0L826.3 234.0L825.9 236.0L825.5 238.0L825.0 240.0L824.6 242.0L824.1 244.0L823.4 246.0L823.0 248.0L822.7 250.0L822.5 252.0L822.1 254.0L821.6 256.0L821.2 258.0L821.0 260.0L820.7 262.0L820.5 264.0L820.2 266.0L820.0 268.0L820.0 270.0L820.0 272.0L819.9 274.0L819.7 276.0L819.4 278.0L819.3 280.0L819.3 282.0L819.3 284.0L819.3 286.0L819.3 288.0L819.4 290.0L819.7 292.0L820.0 294.0L820.0 296.0L820.0 298.0L820.3 300.0L820.8 302.0L821.1 304.0L821.4 306.0L821.7 308.0L822.3 310.0L822.9 312.0L823.2 314.0L823.6 316.0L824.2 318.0L824.8 320.0L825.3 322.0L826.0 324.0L826.8 326.0L827.6 328.0L828.3 330.0L828.9 332.0L829.4 334.0L830.2 336.0L831.0 338.0L832.1 340.0L833.1 342.0L834.0 344.0L834.9 346.0L836.0 348.0L837.9 350.0L838.9 352.0L839.2 353.3L843.7 353.3L844.1 352.0L845.6 350.0L846.0 348.0L845.9 346.0L845.7 344.0L845.5 342.0L845.1 340.0L844.1 338.0L843.0 336.0L842.0 334.0L841.3 332.0L840.7 330.0L839.9 328.0L839.0 326.0L838.2 324.0L838.0 322.0L837.8 320.0L837.5 318.0L837.0 316.0L836.7 314.0L836.1 312.0L835.3 310.0L834.9 308.0L834.4 306.0L833.5 304.0L833.0 302.0L832.9 300.0L832.8 298.0L832.7 296.0L832.4 294.0L832.1 292.0L832.0 290.0L831.8 288.0L831.5 286.0L831.3 284.0L831.3 282.0L831.1 280.0L830.9 278.0L830.7 276.0L830.7 274.0L830.9 272.0L831.1 270.0L831.3 268.0L831.6 266.0L832.1 264.0L832.6 262.0L833.0 260.0L833.6 258.0L834.2 256.0L834.6 254.0L834.7 252.0L834.8 250.0L835.1 248.0L836.1 246.0L837.0 244.0L837.7 242.0L838.3 240.0L839.0 238.0L840.1 236.0L840.9 234.0L841.4 232.0L842.4 230.0L843.4 228.0L844.3 226.0L844.9 224.0L845.3 222.0L846.1 220.0L847.4 218.0L848.4 216.0L847.9 214.0L846.7 212.0L846.2 210.0Z', color: '#25282d', cls: 'dark', on: (s) => s.vfoSel === 1 && !(s.ritB || s.xitB), bright: () => false },
      { path: 'M1114.2 209.3L1113.5 211.3L1113.0 213.3L1113.4 215.3L1113.9 217.3L1114.6 219.3L1115.6 221.3L1116.5 223.3L1117.3 225.3L1118.2 227.3L1119.1 229.3L1120.1 231.3L1120.8 233.3L1121.2 235.3L1121.7 237.3L1122.5 239.3L1123.3 241.3L1123.9 243.3L1124.4 245.3L1124.7 247.3L1125.0 249.3L1125.6 251.3L1126.0 253.3L1126.3 255.3L1126.7 257.3L1127.0 259.3L1127.5 261.3L1127.8 263.3L1128.0 265.3L1128.0 267.3L1128.0 269.3L1127.8 271.3L1127.8 273.3L1128.0 275.3L1128.0 277.3L1127.8 279.3L1127.9 281.3L1128.0 283.3L1127.6 285.3L1127.4 287.3L1128.0 289.3L1128.0 291.3L1127.9 293.3L1127.6 295.3L1127.4 297.3L1127.4 299.3L1127.2 301.3L1127.0 303.3L1126.4 305.3L1125.9 307.3L1125.5 309.3L1125.0 311.3L1124.6 313.3L1124.0 315.3L1123.5 317.3L1123.0 319.3L1122.4 321.3L1121.6 323.3L1120.8 325.3L1119.8 327.3L1118.5 329.3L1117.0 331.3L1116.0 333.3L1114.8 335.3L1113.5 337.3L1112.5 339.3L1112.0 341.3L1112.0 343.3L1112.0 345.3L1112.0 347.3L1112.7 349.3L1113.9 351.3L1114.8 353.3L1114.8 354.0L1119.8 354.0L1119.8 353.3L1120.8 351.3L1122.7 349.3L1124.1 347.3L1125.0 345.3L1125.7 343.3L1126.5 341.3L1127.3 339.3L1128.5 337.3L1129.7 335.3L1130.9 333.3L1131.1 331.3L1131.6 329.3L1132.2 327.3L1132.7 325.3L1133.8 323.3L1135.0 321.3L1135.5 319.3L1135.3 317.3L1136.0 315.3L1137.0 313.3L1137.2 311.3L1136.9 309.3L1137.5 307.3L1138.6 305.3L1139.5 303.3L1139.6 301.3L1139.6 299.3L1139.2 297.3L1138.7 295.3L1138.9 293.3L1139.1 291.3L1139.3 289.3L1139.3 287.3L1139.3 285.3L1139.3 283.3L1139.3 281.3L1139.3 279.3L1139.3 277.3L1139.3 275.3L1139.3 273.3L1139.0 271.3L1138.8 269.3L1138.7 267.3L1138.6 265.3L1138.3 263.3L1138.0 261.3L1138.0 259.3L1137.7 257.3L1137.3 255.3L1137.0 253.3L1136.4 251.3L1136.1 249.3L1135.8 247.3L1135.5 245.3L1135.2 243.3L1135.4 241.3L1135.1 239.3L1134.2 237.3L1133.1 235.3L1132.3 233.3L1131.9 231.3L1132.0 229.3L1131.7 227.3L1131.4 225.3L1131.0 223.3L1130.4 221.3L1129.6 219.3L1128.5 217.3L1126.5 215.3L1123.8 213.3L1122.0 211.3L1121.0 209.3Z', color: '#25282d', cls: 'dark', on: (s) => s.vfoSel === 1 && !(s.ritB || s.xitB), bright: () => false },
      // Bandes lumineuses de part et d'autre du grand bouton : rouges quand le CLAR est en service (côté sélectionné)
      { path: 'M838.5 210.0L837.3 212.0L834.5 214.0L831.7 216.0L830.1 218.0L830.6 220.0L830.3 222.0L828.3 224.0L827.4 226.0L827.0 228.0L826.5 230.0L826.1 232.0L826.3 234.0L825.9 236.0L825.5 238.0L825.0 240.0L824.6 242.0L824.1 244.0L823.4 246.0L823.0 248.0L822.7 250.0L822.5 252.0L822.1 254.0L821.6 256.0L821.2 258.0L821.0 260.0L820.7 262.0L820.5 264.0L820.2 266.0L820.0 268.0L820.0 270.0L820.0 272.0L819.9 274.0L819.7 276.0L819.4 278.0L819.3 280.0L819.3 282.0L819.3 284.0L819.3 286.0L819.3 288.0L819.4 290.0L819.7 292.0L820.0 294.0L820.0 296.0L820.0 298.0L820.3 300.0L820.8 302.0L821.1 304.0L821.4 306.0L821.7 308.0L822.3 310.0L822.9 312.0L823.2 314.0L823.6 316.0L824.2 318.0L824.8 320.0L825.3 322.0L826.0 324.0L826.8 326.0L827.6 328.0L828.3 330.0L828.9 332.0L829.4 334.0L830.2 336.0L831.0 338.0L832.1 340.0L833.1 342.0L834.0 344.0L834.9 346.0L836.0 348.0L837.9 350.0L838.9 352.0L839.2 353.3L843.7 353.3L844.1 352.0L845.6 350.0L846.0 348.0L845.9 346.0L845.7 344.0L845.5 342.0L845.1 340.0L844.1 338.0L843.0 336.0L842.0 334.0L841.3 332.0L840.7 330.0L839.9 328.0L839.0 326.0L838.2 324.0L838.0 322.0L837.8 320.0L837.5 318.0L837.0 316.0L836.7 314.0L836.1 312.0L835.3 310.0L834.9 308.0L834.4 306.0L833.5 304.0L833.0 302.0L832.9 300.0L832.8 298.0L832.7 296.0L832.4 294.0L832.1 292.0L832.0 290.0L831.8 288.0L831.5 286.0L831.3 284.0L831.3 282.0L831.1 280.0L830.9 278.0L830.7 276.0L830.7 274.0L830.9 272.0L831.1 270.0L831.3 268.0L831.6 266.0L832.1 264.0L832.6 262.0L833.0 260.0L833.6 258.0L834.2 256.0L834.6 254.0L834.7 252.0L834.8 250.0L835.1 248.0L836.1 246.0L837.0 244.0L837.7 242.0L838.3 240.0L839.0 238.0L840.1 236.0L840.9 234.0L841.4 232.0L842.4 230.0L843.4 228.0L844.3 226.0L844.9 224.0L845.3 222.0L846.1 220.0L847.4 218.0L848.4 216.0L847.9 214.0L846.7 212.0L846.2 210.0Z', color: '#ff2a1a', on: (s) => !!(s.vfoSel === 1 ? s.ritB || s.xitB : s.rit || s.xit), bright: (s) => !!(s.vfoSel === 1 ? s.ritB || s.xitB : s.rit || s.xit) },
      { path: 'M1114.2 209.3L1113.5 211.3L1113.0 213.3L1113.4 215.3L1113.9 217.3L1114.6 219.3L1115.6 221.3L1116.5 223.3L1117.3 225.3L1118.2 227.3L1119.1 229.3L1120.1 231.3L1120.8 233.3L1121.2 235.3L1121.7 237.3L1122.5 239.3L1123.3 241.3L1123.9 243.3L1124.4 245.3L1124.7 247.3L1125.0 249.3L1125.6 251.3L1126.0 253.3L1126.3 255.3L1126.7 257.3L1127.0 259.3L1127.5 261.3L1127.8 263.3L1128.0 265.3L1128.0 267.3L1128.0 269.3L1127.8 271.3L1127.8 273.3L1128.0 275.3L1128.0 277.3L1127.8 279.3L1127.9 281.3L1128.0 283.3L1127.6 285.3L1127.4 287.3L1128.0 289.3L1128.0 291.3L1127.9 293.3L1127.6 295.3L1127.4 297.3L1127.4 299.3L1127.2 301.3L1127.0 303.3L1126.4 305.3L1125.9 307.3L1125.5 309.3L1125.0 311.3L1124.6 313.3L1124.0 315.3L1123.5 317.3L1123.0 319.3L1122.4 321.3L1121.6 323.3L1120.8 325.3L1119.8 327.3L1118.5 329.3L1117.0 331.3L1116.0 333.3L1114.8 335.3L1113.5 337.3L1112.5 339.3L1112.0 341.3L1112.0 343.3L1112.0 345.3L1112.0 347.3L1112.7 349.3L1113.9 351.3L1114.8 353.3L1114.8 354.0L1119.8 354.0L1119.8 353.3L1120.8 351.3L1122.7 349.3L1124.1 347.3L1125.0 345.3L1125.7 343.3L1126.5 341.3L1127.3 339.3L1128.5 337.3L1129.7 335.3L1130.9 333.3L1131.1 331.3L1131.6 329.3L1132.2 327.3L1132.7 325.3L1133.8 323.3L1135.0 321.3L1135.5 319.3L1135.3 317.3L1136.0 315.3L1137.0 313.3L1137.2 311.3L1136.9 309.3L1137.5 307.3L1138.6 305.3L1139.5 303.3L1139.6 301.3L1139.6 299.3L1139.2 297.3L1138.7 295.3L1138.9 293.3L1139.1 291.3L1139.3 289.3L1139.3 287.3L1139.3 285.3L1139.3 283.3L1139.3 281.3L1139.3 279.3L1139.3 277.3L1139.3 275.3L1139.3 273.3L1139.0 271.3L1138.8 269.3L1138.7 267.3L1138.6 265.3L1138.3 263.3L1138.0 261.3L1138.0 259.3L1137.7 257.3L1137.3 255.3L1137.0 253.3L1136.4 251.3L1136.1 249.3L1135.8 247.3L1135.5 245.3L1135.2 243.3L1135.4 241.3L1135.1 239.3L1134.2 237.3L1133.1 235.3L1132.3 233.3L1131.9 231.3L1132.0 229.3L1131.7 227.3L1131.4 225.3L1131.0 223.3L1130.4 221.3L1129.6 219.3L1128.5 217.3L1126.5 215.3L1123.8 213.3L1122.0 211.3L1121.0 209.3Z', color: '#ff2a1a', on: (s) => !!(s.vfoSel === 1 ? s.ritB || s.xitB : s.rit || s.xit), bright: (s) => !!(s.vfoSel === 1 ? s.ritB || s.xitB : s.rit || s.xit) },
      { x: 966, y: 112, w: 12, h: 17, rx: 2, color: '#3ddc5a', on: (s, L) => !!s.connected && !!s.dualRx && !(s.tx && L.txSide(s) === 'B'), bright: (s, L) => !!s.connected && !!s.dualRx && !(s.tx && L.txSide(s) === 'B') },
      { x: 966, y: 112, w: 12, h: 17, rx: 2, color: '#ff3b30', on: (s, L) => !!s.tx && L.txSide(s) === 'B', bright: (s, L) => !!s.tx && L.txSide(s) === 'B' },
      { x: 984, y: 112, w: 12, h: 17, rx: 2, color: '#3ddc5a', on: (s, L) => !!s.connected && !(s.tx && L.txSide(s) === 'A'), bright: (s, L) => !!s.connected && !(s.tx && L.txSide(s) === 'A') },
      { x: 984, y: 112, w: 12, h: 17, rx: 2, color: '#ff3b30', on: (s, L) => !!s.tx && L.txSide(s) === 'A', bright: (s, L) => !!s.tx && L.txSide(s) === 'A' }
    ],
    keys: [
      // Touches au-dessus de l'écran
      { id: 'top1', x: 170, y: 10, w: 80, h: 31, tip: 'Touche du FTX-1', act: info('Cette touche du FTX-1 n’est pas disponible à distance.') },
      { id: 'sdx', x: 270, y: 10, w: 103, h: 31, tip: 'S-DX', act: info('S-DX : pas disponible à distance.') },
      { id: 'pmg', x: 393, y: 10, w: 113, h: 31, tip: 'PMG', act: info('PMG (mémoires) : pas disponible à distance.') },
      { id: 'band', x: 527, y: 10, w: 113, h: 31, tip: 'MAG BAND : appui bref = bande suivante (1.8 → 3.5 → 7 → 10 → 14 …) ; appui d’1 s = tableau des bandes (clic sur une bande, pour redescendre)', act: { local: 'bandUp', long: { local: 'bandMenu' } } },
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
      { id: 'subDial', cx: 63, cy: 163, ro: 50, subDial: true, pushLocal: 'sideToggle', tip: 'SUB DIAL : tourner = fréquence du VFO B (SUB) ; clic = VFO actif MAIN ⇄ SUB (en double réception seulement, par sécurité)' },
      // FUNC : comme le bouton MULTI du FTDX101 (fonction choisie dans le menu FUNC, décalage du clarifier) ; le pousser = menu FUNC
      { id: 'func', cx: 1215, cy: 170, ro: 50, multi: true, pushLocal: 'func', longLocal: 'funcLong', longMs: 1500, tip: 'FUNC : appui de 2 s = écran FUNC (et sortie) ; dans l’écran : tourner = choisir la case, pousser = la régler (tourner), pousser = fini. Écran fermé : tourner = la fonction choisie (ex. RF POWER) ou le clarifier' },
      { id: 'afSub', cx: 63, cy: 410, ri: 28, ro: 50, dspSide: 'B', longLocal: 'dspB', longMs: 1000, pushLocal: 'dspTab', inner: { ctl: 'afB', label: 'AF SUB', per: 5 }, outer: { ctl: 'rfB', label: 'RF SUB', per: 5 } },
      { id: 'afMain', cx: 1220, cy: 410, ri: 28, ro: 50, dspSide: 'A', longLocal: 'dspA', longMs: 1000, pushLocal: 'dspTab', inner: { ctl: 'af', label: 'AF MAIN', per: 5 }, outer: { ctl: 'rf', label: 'RF MAIN', per: 5 } }
    ]
  };
})();
