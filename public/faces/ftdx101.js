/*
 * faces/ftdx101.js — face avant du Yaesu FTDX101D / MP pour la page https://remote.op0p.be/ftdx101
 *
 * Image : faces/ftdx101.webp (face avant seule, découpée dans la photo 1560 × 580 px fournie par ON6DP).
 * Toutes les positions sont en pixels de cette image (x, y = coin haut gauche ; cx, cy = centre).
 * Pour une autre photo : ouvrir la page avec ?zones=1 (contours visibles, position de la souris affichée) et corriger ici.
 *
 * Touches : act = ce que fait la touche, led = quand son voyant est allumé (s = état du TRX, L = état local de la page).
 *   act : { band: '20M' } · { toggle: 'nb' } · { set: ['vfoSel', 1] } · { action: 'swap' } · { mode: 'ssb' | 'cw' | 'cycle' }
 *         { local: 'fast' | 'fine' | 'listen' | 'func' | 'mox' | 'moni' } · { clar: true } (RX CLAR ; appui long : décalage à zéro) · { info: 'texte' }
 * Boutons rotatifs : inner = bouton central, outer = bague extérieure ; { ctl, label, per } (per = pas par cran de molette) ;
 *   push = réglage basculé par un clic sans tourner (le bouton qu'on pousse), ex. NAR sur SHIFT/WIDTH.
 * Touches : act.long = action d'un appui d'au moins 1 s (ex. TUNE : accord ; MAIN⇄SUB : A → B).
 *   dial : grand bouton d'accord (VFO actif) ; multi : bouton MULTI (décalage du clarifier s'il est actif, sinon la fonction choisie dans FUNC).
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
    // Photo d'origine 1560 × 580 (avec le capot et les pieds) ; seule la face avant est gardée : 1556 × 482 à partir de (4, 66).
    // Les positions ci-dessous restent celles de la photo d'origine.
    w: 1560,
    h: 580,
    img: { x: 4, y: 66, w: 1556, h: 482 },
    // Écran du TRX : recouvert par l'affichage de la page (fréquences, modes, mètres, réglages)
    lcd: { x: 142, y: 131, w: 570, h: 321 },
    keys: bandKeys.concat(dspKeys, [
      { id: 'onoff', x: 25, y: 112, w: 67, h: 46, tip: 'ON/OFF : la mise en marche se fait au club', act: info('Le TRX ne s’allume et ne s’éteint qu’au club.') },
      // Rangée sous l'écran
      { id: 'tune', x: 150, y: 472, w: 67, h: 20, tip: 'TUNE : coupleur d’antenne en service / hors service ; appui d’au moins 1 s : accord (émission courte, avec la main)', act: { toggle: 'tuner', long: { action: 'tune' } }, led: (s) => !!(s.tuner || s.tuning), ledColor: '#ff8a1f' },
      { id: 'vox', x: 230, y: 472, w: 68, h: 20, tip: 'VOX (ne peut être que coupé à distance)', act: { toggle: 'vox' }, led: (s) => !!s.vox },
      { id: 'mox', x: 311, y: 472, w: 67, h: 20, tip: 'MOX : émission maintenue (clic : émission, clic suivant : réception) ; avec votre micro si « Configuration micro » est actif', act: { local: 'mox' }, led: (s, L) => L.mox || !!s.tx, ledColor: '#ff3b30' },
      { id: 'zin', x: 392, y: 472, w: 69, h: 20, tip: 'ZIN/SPOT', act: info('ZIN / SPOT : pas disponible à distance.') },
      { id: 'disp', x: 473, y: 472, w: 69, h: 20, tip: 'DISP : affichage de l’écran, comme sur le TRX — cascade MAIN → SUB au-dessus de MAIN → MAIN | SUB côte à côte → filtres agrandis → retour', act: { local: 'disp' } },
      { id: 'smenu', x: 556, y: 472, w: 69, h: 20, tip: 'S.MENU : SCOPE MENU (SPEED, PEAK, MARKER, COLOR, LEVEL), comme sur le TRX ; se ferme seul après 3 s', act: { local: 'smenu' } },
      { id: 'func', x: 636, y: 472, w: 70, h: 20, tip: 'FUNC : menu des fonctions dans l’écran (clic sur une case, puis molette ou MULTI)', act: { local: 'func' }, led: (s, L) => L.func },
      // Colonne MODE
      { id: 'mode', x: 767, y: 219, w: 28, h: 18, tip: 'MODE : mode suivant (récepteur actif) ; appui d’au moins 1 s : tableau de tous les modes', act: { mode: 'cycle', longMenu: true } },
      { id: 'ssb', x: 767, y: 262, w: 28, h: 18, tip: 'SSB : LSB ⇄ USB', act: { mode: 'ssb' }, led: (s, L) => /SB$/.test(L.activeMode(s)) },
      { id: 'cw', x: 767, y: 304, w: 28, h: 17, tip: 'CW : CW-U ⇄ CW-L', act: { mode: 'cw' }, led: (s, L) => /^CW/.test(L.activeMode(s)) },
      { id: 'bkin', x: 767, y: 372, w: 28, h: 18, tip: 'BK-IN : break-in CW', act: { toggle: 'bkin' }, led: (s) => !!s.bkin },
      { id: 'moni', x: 767, y: 414, w: 28, h: 18, tip: 'MONI : entendre sa propre modulation (« M’écouter », au casque)', act: { local: 'moni' }, led: () => !!(window.RSVOICE && window.RSVOICE.monitorOn()) },
      // SYNC, SPLIT, CLAR RX / TX, FAST, LOCK
      { id: 'sync', x: 819, y: 221, w: 43, h: 16, tip: 'SYNC : met les deux VFO sur la même fréquence (celle du récepteur actif), puis le grand bouton les accorde ensemble ; nouveau clic : arrêt', act: { local: 'sync' },
        leds: [{ x: 835, y: 203.5, w: 12.5, h: 4.5, color: '#ff9a1f', on: (s, L) => !!L.sync, bright: (s, L) => !!L.sync }] },
      { id: 'split', x: 874, y: 221, w: 44, h: 16, tip: 'SPLIT : émission sur le SUB (VFO B)', act: { toggle: 'split' },
        leds: [{ x: 889.5, y: 203.5, w: 12.5, h: 4.5, color: '#ff9a1f', on: (s) => !!s.split, bright: (s) => !!s.split }] },
      { id: 'clarRx', x: 819, y: 262, w: 43, h: 18, tip: 'CLAR RX (RIT)', act: { toggle: 'rit' },
        leds: [{ x: 835, y: 245, w: 12.5, h: 4.5, color: '#ff9a1f', on: (s) => !!s.rit, bright: (s) => !!s.rit }] },
      { id: 'clarTx', x: 874, y: 262, w: 44, h: 18, tip: 'CLAR TX (XIT)', act: { toggle: 'xit' },
        leds: [{ x: 889.5, y: 245, w: 12.5, h: 4.5, color: '#ff9a1f', on: (s) => !!s.xit, bright: (s) => !!s.xit }] },
      { id: 'fast', x: 819, y: 415, w: 43, h: 17, tip: 'FAST : accord rapide (×10)', act: { local: 'fast' },
        leds: [{ x: 835, y: 403.5, w: 12.5, h: 4.5, color: '#ff9a1f', on: (s, L) => !!L.fast, bright: (s, L) => !!L.fast }] },
      { id: 'lock', x: 874, y: 415, w: 44, h: 17, tip: 'LOCK : verrouille le grand bouton du TRX', act: { toggle: 'lock' },
        leds: [{ x: 889.5, y: 403.5, w: 12.5, h: 4.5, color: '#ff9a1f', on: (s) => !!s.lock, bright: (s) => !!s.lock }] },
      // RX / TX / MAIN⇆SUB au-dessus du grand bouton
      { id: 'rxMain', x: 937, y: 192, w: 63, h: 18, tip: 'RX MAIN : le récepteur MAIN est toujours en service', act: info('Le récepteur MAIN reste toujours en service.'),
        leds: [{ x: 955, y: 190, w: 31, h: 4, color: '#3ddc5a', on: (s) => !!s.connected }] },
      { id: 'txMain', x: 1012, y: 192, w: 45, h: 18, tip: 'TX MAIN : émission sur le MAIN (SPLIT coupé)', act: { set: ['split', 0] },
        leds: [{ x: 1024, y: 190, w: 20, h: 4, color: '#ff3b30', on: (s) => !s.split, bright: (s) => !!s.tx && !s.split }] },
      { id: 'swap', x: 1068, y: 192, w: 95, h: 18, tip: 'MAIN ⇄ SUB : échange les fréquences des deux VFO ; appui d’au moins 1 s : copie MAIN → SUB (A → B)', act: { action: 'swap', long: { action: 'aToB' } } },
      { id: 'txSub', x: 1172, y: 192, w: 50, h: 18, tip: 'TX SUB : émission sur le SUB (SPLIT)', act: { set: ['split', 1] },
        leds: [{ x: 1190, y: 190, w: 18, h: 4, color: '#ff3b30', on: (s) => !!s.split, bright: (s) => !!s.tx && !!s.split }] },
      { id: 'rxSub', x: 1230, y: 192, w: 65, h: 18, tip: 'RX SUB : double réception (DUAL RX) en marche / arrêt', act: { toggle: 'dualRx' },
        leds: [{ x: 1247, y: 190, w: 31, h: 4, color: '#3ddc5a', on: (s) => !!s.dualRx }] },
      { id: 'main', x: 947, y: 221, w: 88, h: 28, tip: 'MAIN : le grand bouton et les touches agissent sur le MAIN (VFO A)', act: { set: ['vfoSel', 0] }, led: (s) => s.vfoSel !== 1,
        lit: { d: 'M951 222.5H1031L1019 249H951Q949 249 949 247V224.5Q949 222.5 951 222.5Z', bg: '#f4f6f8', fg: '#000', edge: '#ffffff', label: 'MAIN', tx: 988, ty: 240 } },
      { id: 'sub', x: 1197, y: 221, w: 85, h: 28, tip: 'SUB : le grand bouton et les touches agissent sur le SUB (VFO B)', act: { set: ['vfoSel', 1] }, led: (s) => s.vfoSel === 1,
        lit: { d: 'M1201 222.5H1281Q1283 222.5 1283 224.5V247Q1283 249 1281 249H1213Z', bg: '#1e6fe0', fg: '#fff', edge: '#7fb6ff', label: 'SUB', tx: 1243, ty: 240 } },
      { id: 'clar', x: 940, y: 275, w: 70, h: 38, tip: 'CLAR : clarifier de réception (appui long : décalage à zéro) ; MULTI règle le décalage', act: { clar: true }, led: (s) => !!(s.rit || s.xit) },
      { id: 'qmb', x: 932, y: 360, w: 23, h: 50, tip: 'QMB', act: info('QMB (mémoires rapides) : pas disponible à distance.') },
      { id: 'fine', x: 935, y: 450, w: 70, h: 40, tip: 'FINE TUNING : accord fin (pas de 1 Hz)', act: { local: 'fine' }, led: (s, L) => L.fine },
      // VC TUNE (présélecteur, VT) : marche / arrêt sur le récepteur actif ; en marche, le bouton MULTI l'accorde (voyant orange)
      // Grande touche VC TUNE (autour du grand bouton) : la bague extérieure du grand bouton (MPVD) accorde le VC TUNE (voyant orange à gauche)
      { id: 'vcTune', x: 1225, y: 270, w: 70, h: 55, tip: 'VC TUNE (grande touche) : la bague extérieure du grand bouton accorde le présélecteur ; nouveau clic : la bague revient à la fréquence', act: { local: 'ringVc' },
        leds: [{ x: 1239.5, y: 305.5, w: 5, h: 5, color: '#ff9a1f', on: (s, L) => !!L.ringVc, bright: (s, L) => !!L.ringVc }] },
      // Petite touche VC TUNE : présélecteur du récepteur actif en marche / arrêt (voyant orange au-dessus)
      { id: 'vcTune2', x: 1270, y: 340, w: 30, h: 40, tip: 'VC TUNE (petite touche) : présélecteur du récepteur actif en marche / arrêt', act: { local: 'vc' },
        leds: [{ x: 1280.5, y: 348.5, w: 12, h: 3.5, color: '#ff9a1f', on: (s) => !!(s.vfoSel === 1 ? s.vcB : s.vc), bright: (s) => !!(s.vfoSel === 1 ? s.vcB : s.vc) }] },
      { id: 'cs', x: 1272, y: 390, w: 28, h: 40, tip: 'C.S', act: info('C.S (touche personnalisable) : pas disponible à distance.') },
      { id: 'mainSub', x: 1255, y: 450, w: 45, h: 50, tip: 'MAIN/SUB : passe le grand bouton de MAIN à SUB et inversement', act: { toggleSel: true } },
      // Mémoires
      { id: 'vm', x: 1310, y: 220, w: 30, h: 20, tip: 'V/M', act: info('Mémoires : pas encore reliées.') },
      { id: 'mv', x: 1349, y: 220, w: 32, h: 20, tip: 'M▸V', act: info('Mémoires : pas encore reliées.') },
      { id: 'vmw', x: 1386, y: 220, w: 32, h: 20, tip: 'V▸M', act: info('Mémoires : pas encore reliées.') },
      // Petites touches PROC et KEYER (au-dessus du bouton MIC/SPEED)
      { id: 'proc', cx: 1451, cy: 149, r: 8, tip: 'PROC : processeur de modulation', act: { toggle: 'proc' }, led: (s) => !!s.proc, ledColor: '#ff7a00', ledStrong: true, ledR: 3.6 },
      { id: 'keyer', cx: 1529, cy: 149, r: 8, tip: 'KEYER : manipulateur électronique (en CW ; aussi : pousser le bouton MIC/SPEED)', act: { toggle: 'keyer' }, led: (s) => !!s.keyer, ledColor: '#ff7a00', ledStrong: true, ledR: 3.6 },
      // Prises
      { id: 'key', cx: 56, cy: 337, r: 20, tip: 'KEY', act: info('Manipulateur : la CW se fait par l’onglet CW du dashboard.') },
      { id: 'phones', cx: 56, cy: 410, r: 20, tip: 'PHONES : écouter le TRX (clic : marche / arrêt)', act: { local: 'listen' }, led: (s, L) => L.listening, ledColor: '#3ddc5a', ring: true },
      { id: 'mic', cx: 56, cy: 490, r: 32, tip: 'MIC', act: info('Micro : phonie à distance par le dashboard (Configuration micro).') }
    ]),
    knobs: [
      { id: 'dial', cx: 1118, cy: 380, ro: 140, ri: 116, dial: true, tip: 'Grand bouton : fréquence du récepteur actif (molette ou glisser en tournant) ; bague extérieure : idem, ou VC TUNE après la grande touche VC TUNE' },
      { id: 'multi', cx: 762, cy: 510, ro: 30, multi: true, tip: 'MULTI : décalage du clarifier (CLAR actif), sinon la fonction de la case MULTI de l’écran (choisie dans FUNC, ex. RF POWER)' },
      { id: 'afSub', cx: 871, cy: 350, ri: 20, ro: 44, inner: { ctl: 'afB', label: 'AF SUB', per: 5 }, outer: { ctl: 'rfB', label: 'RF SUB', per: 5 } },
      { id: 'afMain', cx: 871, cy: 500, ri: 20, ro: 44, inner: { ctl: 'af', label: 'AF MAIN', per: 5 }, outer: { ctl: 'rf', label: 'RF MAIN', per: 5 } },
      { id: 'swSub', cx: 1365, cy: 350, ri: 18, ro: 44, inner: { ctl: 'shiftB', label: 'SHIFT SUB', per: 20 }, outer: { ctl: 'widthB', label: 'WIDTH SUB', per: 1 }, push: 'narrowB', pushLabel: 'NAR SUB',
        // Petits voyants orange : SHIFT décalé (≠ 0) à gauche, WIDTH changé (≠ largeur par défaut) à droite
        leds: [{ x: 1321.0, y: 307.0, w: 7, h: 7, rx: 3.5, color: '#ff9a1f', on: (s) => !!s.shiftB, bright: (s) => !!s.shiftB },
          { x: 1399.5, y: 307.0, w: 7, h: 7, rx: 3.5, color: '#ff9a1f', on: (s) => !!s.widthB, bright: (s) => !!s.widthB }] },
      { id: 'swMain', cx: 1365, cy: 500, ri: 18, ro: 44, inner: { ctl: 'shift', label: 'SHIFT MAIN', per: 20 }, outer: { ctl: 'width', label: 'WIDTH MAIN', per: 1 }, push: 'narrow', pushLabel: 'NAR MAIN',
        // Petits voyants orange : SHIFT décalé (≠ 0) à gauche, WIDTH changé (≠ largeur par défaut) à droite
        leds: [{ x: 1321.0, y: 457.0, w: 7, h: 7, rx: 3.5, color: '#ff9a1f', on: (s) => !!s.shift, bright: (s) => !!s.shift },
          { x: 1399.5, y: 457.0, w: 7, h: 7, rx: 3.5, color: '#ff9a1f', on: (s) => !!s.width, bright: (s) => !!s.width }] },
      { id: 'notchSub', cx: 1492, cy: 350, ri: 18, ro: 44, inner: { ctl: 'notchFreqB', label: 'NOTCH SUB', per: 10 }, outer: { ctl: 'contourFreqB', label: 'CONT SUB', per: 10, offKey: 'contourB', offName: 'CONT',
        alt: { when: (s) => /^CW/.test(s.modeB || '') && !!s.apfB, ctl: 'apfFreqB', label: 'APF SUB', per: 1 } } },
      { id: 'notchMain', cx: 1492, cy: 500, ri: 18, ro: 44, inner: { ctl: 'notchFreq', label: 'NOTCH MAIN', per: 10 }, outer: { ctl: 'contourFreq', label: 'CONT MAIN', per: 10, offKey: 'contour', offName: 'CONT',
        alt: { when: (s) => /^CW/.test(s.mode || '') && !!s.apf, ctl: 'apfFreq', label: 'APF MAIN', per: 1 } } },
      { id: 'micProc', cx: 1492, cy: 195, ri: 18, ro: 44, inner: { ctl: 'mic', label: 'MIC GAIN', per: 2 }, outer: { ctl: 'procLvl', label: 'PROC', per: 2 },
        // Pousser le bouton : KEYER en CW, PROC en phonie (voyant au-dessus du bouton)
        push: (s) => (/^CW/.test((s.split ? s.modeB : s.mode) || '') ? 'keyer' : 'proc'), pushLabel: (s) => (/^CW/.test((s.split ? s.modeB : s.mode) || '') ? 'KEYER' : 'PROC') }
    ]
  };
})();
