/*
 * faces/ftdx101.js — face avant du Yaesu FTDX101D / MP pour la page https://remote.op0p.be/ftdx101
 *
 * Image : faces/ftdx101.webp (photo de la face avant, 1560 × 580 px, fournie par ON6DP).
 * Toutes les positions sont en pixels de cette image (x, y = coin haut gauche ; cx, cy = centre).
 * Pour une autre photo : ouvrir la page avec ?zones=1 (contours visibles, position de la souris affichée) et corriger ici.
 *
 * Touches : act = ce que fait la touche, led = quand son voyant est allumé (s = état du TRX, L = état local de la page).
 *   act : { band: '20M' } · { toggle: 'nb' } · { set: ['vfoSel', 1] } · { action: 'swap' } · { mode: 'ssb' | 'cw' | 'cycle' }
 *         { local: 'fast' | 'fine' | 'listen' } · { clar: true } (RX CLAR ; appui long : décalage à zéro) · { info: 'texte' }
 * Boutons rotatifs : inner = bouton central, outer = bague extérieure ; { ctl, label, per } (per = pas par cran de molette).
 *   dial : grand bouton d'accord (VFO actif) ; multi : bouton MULTI (décalage du clarifier s'il est actif, sinon pas de 1 kHz).
 */
(function () {
  'use strict';
  const F = window.RS_FACES = window.RS_FACES || {};
  // Touches de bande : de gauche à droite, pas de 50,25 px
  const BANDS = [['1.8', '160M'], ['3.5', '80M'], ['5.0', '60M'], ['7.0', '40M'], ['10', '30M'], ['14', '20M'], ['18', '17M'], ['21', '15M'],
    ['24.5', '12M'], ['28/29', '10M'], ['50', '6M'], ['70/GEN', '4M']];
  const bandKeys = BANDS.map(([lab, b], i) => ({
    id: 'band' + b, x: 790 + 50.25 * i, y: 140, w: 44, h: 22, tip: 'Bande ' + lab + ' MHz (récepteur actif : MAIN ou SUB)', act: { band: b },
    // Voyants : bleu au-dessus = bande du SUB, blanc en dessous = bande du MAIN
    leds: [{ x: 790 + 50.25 * i + 5, y: 131, w: 37, h: 5, color: '#38b6ff', on: (s, L) => L.bandOf(s.freqB) === b && s.dualRx !== 0 },
      { x: 790 + 50.25 * i + 5, y: 169, w: 37, h: 5, color: '#d9dcff', on: (s, L) => L.bandOf(s.freq) === b }]
  }));
  // Rangées DSP : en haut = SUB (VFO B), en bas = MAIN (VFO A), comme sur le TRX
  const DSP = [['NB', 1310, 30, 'nb'], ['DNR', 1349, 31, 'nr'], ['DNF', 1387, 31, 'dnf'], ['NOTCH', 1439, 30, 'notch'], ['CONT', 1477, 31, 'contour'], ['APF', 1515, 31, 'apf']];
  const dspKeys = [];
  for (const [side, y, suf] of [['SUB', 260, 'B'], ['MAIN', 412, '']]) {
    for (const [lab, x, w, id] of DSP) {
      const ctl = id + suf;
      dspKeys.push({ id: 'dsp' + lab + side, x, y, w, h: 23, tip: lab + ' ' + side, act: { toggle: ctl }, led: (s) => !!s[ctl] });
    }
  }
  const info = (t) => ({ info: t });
  F.ftdx101 = {
    model: 'ftdx101',
    name: 'Yaesu FTDX101D / MP',
    image: '/faces/ftdx101.webp',
    w: 1560,
    h: 580,
    // Écran du TRX : recouvert par l'affichage de la page (fréquences, modes, mètres, réglages)
    lcd: { x: 142, y: 131, w: 570, h: 321 },
    keys: bandKeys.concat(dspKeys, [
      { id: 'onoff', x: 25, y: 112, w: 67, h: 46, tip: 'ON/OFF : la mise en marche se fait au club', act: info('Le TRX ne s’allume et ne s’éteint qu’au club.') },
      // Rangée sous l'écran
      { id: 'tune', x: 150, y: 472, w: 67, h: 20, tip: 'TUNE : accord de l’antenne (émission courte, avec la main)', act: { action: 'tune' }, led: (s) => !!s.tuning, ledColor: '#ff3b30' },
      { id: 'vox', x: 230, y: 472, w: 68, h: 20, tip: 'VOX (ne peut être que coupé à distance)', act: { toggle: 'vox' }, led: (s) => !!s.vox },
      { id: 'mox', x: 311, y: 472, w: 67, h: 20, tip: 'MOX : émission à la main', act: info('Émission en phonie : utilisez le PTT du dashboard (barre d’espace), avec la phonie à distance.') },
      { id: 'zin', x: 392, y: 472, w: 69, h: 20, tip: 'ZIN/SPOT', act: info('ZIN / SPOT : pas disponible à distance.') },
      { id: 'disp', x: 473, y: 472, w: 69, h: 20, tip: 'DISP', act: info('DISP : réglages de l’écran du TRX, pas disponible à distance.') },
      { id: 'smenu', x: 556, y: 472, w: 69, h: 20, tip: 'S.MENU', act: info('Menus du TRX : pas disponibles depuis la face avant à distance.') },
      { id: 'func', x: 636, y: 472, w: 70, h: 20, tip: 'FUNC', act: info('FUNC : fonctions de l’écran tactile, pas disponibles à distance.') },
      // Colonne MODE
      { id: 'mode', x: 767, y: 219, w: 28, h: 18, tip: 'MODE : mode suivant (récepteur actif)', act: { mode: 'cycle' } },
      { id: 'ssb', x: 767, y: 262, w: 28, h: 18, tip: 'SSB : LSB ⇄ USB', act: { mode: 'ssb' }, led: (s, L) => /SB$/.test(L.activeMode(s)) },
      { id: 'cw', x: 767, y: 304, w: 28, h: 17, tip: 'CW : CW-U ⇄ CW-L', act: { mode: 'cw' }, led: (s, L) => /^CW/.test(L.activeMode(s)) },
      { id: 'bkin', x: 767, y: 372, w: 28, h: 18, tip: 'BK-IN : break-in CW', act: { toggle: 'bkin' }, led: (s) => !!s.bkin },
      { id: 'moni', x: 767, y: 414, w: 28, h: 18, tip: 'MONI', act: info('MONI : pas encore relié.') },
      // SYNC, SPLIT, CLAR RX / TX, FAST, LOCK
      { id: 'sync', x: 819, y: 221, w: 43, h: 16, tip: 'SYNC', act: info('SYNC : pas disponible par la liaison CAT.') },
      { id: 'split', x: 874, y: 221, w: 44, h: 16, tip: 'SPLIT : émission sur le SUB (VFO B)', act: { toggle: 'split' }, led: (s) => !!s.split },
      { id: 'clarRx', x: 819, y: 262, w: 43, h: 18, tip: 'CLAR RX (RIT)', act: { toggle: 'rit' }, led: (s) => !!s.rit },
      { id: 'clarTx', x: 874, y: 262, w: 44, h: 18, tip: 'CLAR TX (XIT)', act: { toggle: 'xit' }, led: (s) => !!s.xit },
      { id: 'fast', x: 819, y: 415, w: 43, h: 17, tip: 'FAST : accord rapide (×10)', act: { local: 'fast' }, led: (s, L) => L.fast },
      { id: 'lock', x: 874, y: 415, w: 44, h: 17, tip: 'LOCK : verrouille le grand bouton du TRX', act: { toggle: 'lock' }, led: (s) => !!s.lock },
      // RX / TX / MAIN⇆SUB au-dessus du grand bouton
      { id: 'rxMain', x: 937, y: 192, w: 63, h: 18, tip: 'RX MAIN : le récepteur MAIN est toujours en service', act: info('Le récepteur MAIN reste toujours en service.'),
        leds: [{ x: 955, y: 190, w: 31, h: 4, color: '#3ddc5a', on: (s) => !!s.connected }] },
      { id: 'txMain', x: 1012, y: 192, w: 45, h: 18, tip: 'TX MAIN : émission sur le MAIN (SPLIT coupé)', act: { set: ['split', 0] },
        leds: [{ x: 1024, y: 190, w: 20, h: 4, color: '#ff3b30', on: (s) => !s.split, bright: (s) => !!s.tx && !s.split }] },
      { id: 'swap', x: 1068, y: 192, w: 95, h: 18, tip: 'MAIN ⇄ SUB : échange les fréquences des deux VFO', act: { action: 'swap' } },
      { id: 'txSub', x: 1172, y: 192, w: 50, h: 18, tip: 'TX SUB : émission sur le SUB (SPLIT)', act: { set: ['split', 1] },
        leds: [{ x: 1190, y: 190, w: 18, h: 4, color: '#ff3b30', on: (s) => !!s.split, bright: (s) => !!s.tx && !!s.split }] },
      { id: 'rxSub', x: 1230, y: 192, w: 65, h: 18, tip: 'RX SUB : double réception (DUAL RX) en marche / arrêt', act: { toggle: 'dualRx' },
        leds: [{ x: 1247, y: 190, w: 31, h: 4, color: '#3ddc5a', on: (s) => !!s.dualRx }] },
      { id: 'main', x: 947, y: 221, w: 88, h: 28, tip: 'MAIN : le grand bouton et les touches agissent sur le MAIN (VFO A)', act: { set: ['vfoSel', 0] }, led: (s) => s.vfoSel !== 1, ledColor: '#5fb3ff' },
      { id: 'sub', x: 1197, y: 221, w: 85, h: 28, tip: 'SUB : le grand bouton et les touches agissent sur le SUB (VFO B)', act: { set: ['vfoSel', 1] }, led: (s) => s.vfoSel === 1, ledColor: '#5fb3ff' },
      { id: 'clar', x: 940, y: 275, w: 70, h: 38, tip: 'CLAR : clarifier de réception (appui long : décalage à zéro) ; MULTI règle le décalage', act: { clar: true }, led: (s) => !!(s.rit || s.xit) },
      { id: 'qmb', x: 932, y: 360, w: 23, h: 50, tip: 'QMB', act: info('QMB (mémoires rapides) : pas disponible à distance.') },
      { id: 'fine', x: 935, y: 450, w: 70, h: 40, tip: 'FINE TUNING : accord fin (pas de 1 Hz)', act: { local: 'fine' }, led: (s, L) => L.fine },
      { id: 'vcTune', x: 1225, y: 270, w: 70, h: 55, tip: 'VC TUNE', act: info('VC TUNE : pas disponible par la liaison CAT.') },
      { id: 'vcTune2', x: 1270, y: 340, w: 30, h: 40, tip: 'VC TUNE', act: info('VC TUNE : pas disponible par la liaison CAT.') },
      { id: 'cs', x: 1272, y: 390, w: 28, h: 40, tip: 'C.S', act: info('C.S (touche personnalisable) : pas disponible à distance.') },
      { id: 'mainSub', x: 1255, y: 450, w: 45, h: 50, tip: 'MAIN/SUB : passe le grand bouton de MAIN à SUB et inversement', act: { toggleSel: true } },
      // Mémoires
      { id: 'vm', x: 1310, y: 220, w: 30, h: 20, tip: 'V/M', act: info('Mémoires : pas encore reliées.') },
      { id: 'mv', x: 1349, y: 220, w: 32, h: 20, tip: 'M▸V', act: info('Mémoires : pas encore reliées.') },
      { id: 'vmw', x: 1386, y: 220, w: 32, h: 20, tip: 'V▸M', act: info('Mémoires : pas encore reliées.') },
      // Petites touches PROC et KEYER (au-dessus du bouton MIC/SPEED)
      { id: 'proc', cx: 1451, cy: 149, r: 8, tip: 'PROC : processeur de modulation', act: { toggle: 'proc' }, led: (s) => !!s.proc },
      { id: 'keyer', cx: 1529, cy: 149, r: 8, tip: 'KEYER', act: info('KEYER : réglé par la page CW du dashboard.') },
      // Prises
      { id: 'key', cx: 56, cy: 337, r: 20, tip: 'KEY', act: info('Manipulateur : la CW se fait par l’onglet CW du dashboard.') },
      { id: 'phones', cx: 56, cy: 410, r: 20, tip: 'PHONES : écouter le TRX (clic : marche / arrêt)', act: { local: 'listen' }, led: (s, L) => L.listening, ledColor: '#3ddc5a', ring: true },
      { id: 'mic', cx: 56, cy: 490, r: 32, tip: 'MIC', act: info('Micro : phonie à distance par le dashboard (Configuration micro).') }
    ]),
    knobs: [
      { id: 'dial', cx: 1118, cy: 380, ro: 140, dial: true, tip: 'Grand bouton : fréquence du récepteur actif (molette ou glisser en tournant)' },
      { id: 'multi', cx: 762, cy: 510, ro: 30, multi: true, tip: 'MULTI : décalage du clarifier (CLAR actif), sinon fréquence par pas de 1 kHz' },
      { id: 'afSub', cx: 871, cy: 350, ri: 20, ro: 44, inner: { ctl: 'afB', label: 'AF SUB', per: 5 }, outer: { ctl: 'rfB', label: 'RF SUB', per: 5 } },
      { id: 'afMain', cx: 871, cy: 500, ri: 20, ro: 44, inner: { ctl: 'af', label: 'AF MAIN', per: 5 }, outer: { ctl: 'rf', label: 'RF MAIN', per: 5 } },
      { id: 'swSub', cx: 1365, cy: 350, ri: 18, ro: 44, inner: { ctl: 'shiftB', label: 'SHIFT SUB', per: 20 }, outer: { ctl: 'widthB', label: 'WIDTH SUB', per: 1 } },
      { id: 'swMain', cx: 1365, cy: 500, ri: 18, ro: 44, inner: { ctl: 'shift', label: 'SHIFT MAIN', per: 20 }, outer: { ctl: 'width', label: 'WIDTH MAIN', per: 1 } },
      { id: 'notchSub', cx: 1492, cy: 350, ri: 18, ro: 44, inner: { ctl: 'notchFreqB', label: 'NOTCH SUB', per: 50 }, outer: { info: 'CONT / APF : niveau pas encore relié' } },
      { id: 'notchMain', cx: 1492, cy: 500, ri: 18, ro: 44, inner: { ctl: 'notchFreq', label: 'NOTCH MAIN', per: 50 }, outer: { info: 'CONT / APF : niveau pas encore relié' } },
      { id: 'micProc', cx: 1492, cy: 195, ri: 18, ro: 44, inner: { ctl: 'mic', label: 'MIC GAIN', per: 2 }, outer: { ctl: 'procLvl', label: 'PROC', per: 2 } }
    ]
  };
})();
