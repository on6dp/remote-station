/*
 * faces/ic7760.js — face avant de l'Icom IC-7760 (tête de commande) pour la page https://remote.op0p.be/ic7760
 *
 * Image : faces/ic7760.webp (photo Icom 1634 × 581 fournie par ON6DP : coins blancs retirés, écran principal et petit écran
 * noircis — la page y dessine les siens —, voyants TX/RX éteints). Positions relevées sur cette photo puis multipliées par
 * K (= 570 / 740) : l'écran de la page a ainsi la taille de celui du FTDX101 (570 × 321), dont il reprend la disposition.
 * ?zones=1 : contours visibles.
 * Deux récepteurs (MAIN = VFO-A, SUB = VFO-B) : écran MAIN | SUB comme le FTDX101, avec les réglages Icom de chaque côté
 * (FIL1/2/3, TWIN PBT, P.AMP, ATT 3-45 dB, AGC). Les touches NB, NR, NOTCH, APF, P.AMP… et le TWIN PBT agissent sur le
 * récepteur sélectionné (touches MAIN / SUB au-dessus du grand bouton), comme sur le TRX (« sided »).
 */
(function () {
  'use strict';
  const F = window.RS_FACES = window.RS_FACES || {};
  const info = (t) => ({ info: t });
  const K = 570 / 740;
  // Petit voyant rond (coordonnées de la photo) en chemin SVG à l'échelle de la page
  const circ = (cx, cy, r) => { cx *= K; cy *= K; r *= K; return 'M' + (cx - r).toFixed(2) + ' ' + cy.toFixed(2) + 'a' + r.toFixed(2) + ' ' + r.toFixed(2) + ' 0 1 0 ' + (2 * r).toFixed(2) + ' 0a' + r.toFixed(2) + ' ' + r.toFixed(2) + ' 0 1 0 ' + (-2 * r).toFixed(2) + ' 0Z'; };
  const SC = (o) => {
    for (const k of ['x', 'y', 'w', 'h', 'cx', 'cy', 'r', 'ro', 'ri', 'size']) if (typeof o[k] === 'number') o[k] = +(o[k] * K).toFixed(2);
    if (o.leds) o.leds.forEach(SC);
    return o;
  };
  const sb = (s) => (s.vfoSel === 1 ? 'B' : ''); // suffixe du récepteur sélectionné
  const side = (k) => (s) => s[k + sb(s)];
  const ATT_TXT = (v) => (v ? v + 'dB' : 'OFF');
  const kHz = (hz) => (hz == null ? '—' : hz >= 1000 ? (hz / 1000).toFixed(2).replace(/0$/, '') + 'k' : hz + '');
  const bwOf = (s) => {
    const R = window.RIGS && window.RIGS.ic7760, b = sb(s), md = (b ? s.modeB : s.mode) || '';
    return /FM/.test(md) ? null : R && R.filHz ? R.filHz(md, s['filWi' + b]) : null;
  };
  const FONT = (px) => '700 ' + px + 'px DejaVu Sans,Arial,sans-serif';
  F.ic7760 = {
    model: 'ic7760',
    name: 'Icom IC-7760',
    image: '/faces/ic7760.webp',
    w: +(1634 * K).toFixed(2),
    h: +(581 * K).toFixed(2),
    dualIcom: true,
    // Écran : colonne de touches Icom à gauche (55 unités), scope à sa droite ; pas de MONO ni d'EXPAND (pas de ces touches sur le TRX)
    lay: { lowY: 96, scopeY: 108, scopeH: 184, botY: 295, botH: 21, expUp: 0, scopeX: 58 },
    noMono: true,
    // Rangée du bas comme sous le scope du TRX à l'allumage : <MENU1> (réglages du scope : vitesse, crêtes, repère, couleurs, niveau),
    // SPAN, HOLD, CENT/FIX, MAIN/SUB (récepteur sélectionné), DUAL (DUAL-W), EXPD/SET (écran multi-fonctions, comme M.SCOPE)
    bot: ['<MENU1>', 'SPAN', 'HOLD', 'CENT/FIX', 'MAIN/SUB', 'DUAL', 'EXPD/SET'],
    // Petit écran de la photo : le dessin du filtre du récepteur sélectionné (largeur, TWIN PBT, NOTCH), comme sur le TRX
    // Petit écran entier (galvanomètre à aiguille, « MET Po », date) ; subLcd = zone du dessin du filtre (SUB DISP)
    subMeter: { x: +(1156 * K).toFixed(2), y: +(80 * K).toFixed(2), w: +(228 * K).toFixed(2), h: +(150 * K).toFixed(2) },
    subLcd: { x: +(1162 * K).toFixed(2), y: +(98 * K).toFixed(2), w: +(218 * K).toFixed(2), h: +(70 * K).toFixed(2) },
    lcd: { x: +(322 * K).toFixed(2), y: +(57 * K).toFixed(2), w: 570, h: 318 },
    // Cases de l'écran, pour chaque récepteur
    cells: [['ANT', 'ant'], ['ATT', 'att'], ['P.AMP', 'preamp'], ['FILTER', 'fil'], ['AGC', 'agc']],
    cellText: (id, v) => {
      if (/^att/.test(id)) return ATT_TXT(v);
      if (/^preamp/.test(id)) return ['OFF', 'AMP1', 'AMP2'][v] || String(v);
      if (/^fil/.test(id)) return 'FIL' + v;
      if (/^agc/.test(id)) return ['', 'FAST', 'MID', 'SLOW'][v] || String(v);
      if (/^ant/.test(id)) return 'ANT' + v;
      return null;
    },
    ipo: ['OFF', 'AMP1', 'AMP2'],
    modes: [['LSB', 'USB', 'CW', 'CW-R'], ['AM', 'FM', 'RTTY', 'RTTY-R'], ['LSB-D', 'USB-D', 'AM-D', 'FM-D']],
    cycle: ['LSB', 'USB', 'CW', 'CW-R', 'RTTY', 'RTTY-R', 'AM', 'FM', 'USB-D', 'LSB-D'],
    // Tableau BAND (touche QUICK)
    bandGrid: [['160M', '1.8', 1840, 'LSB'], ['80M', '3.5', 3700, 'LSB'], ['60M', '5.0', 5357, null], ['40M', '7.0', 7100, 'LSB'],
      ['30M', '10', 10136, null], ['20M', '14', 14200, 'USB'], ['17M', '18', 18130, 'USB'], ['15M', '21', 21250, 'USB'],
      ['12M', '24.5', 24950, 'USB'], ['10M', '28', 28500, 'USB'], ['6M', '50', 50150, 'USB'], [null, 'GENE']],
    // Petit écran : dessiné par la page (galvanomètre / filtre / bandes, touche SUB DISP)
    texts: [],
    leds: [
      // POWER : voyant bleu dans la touche quand le TRX est allumé (relié à la station) ; éteint (cache sombre) sinon
      { path: circ(46, 137.5, 6), color: '#141a22', cls: 'dark', on: (s) => !s.connected },
      { path: circ(46, 137.5, 4.6), color: '#3fa9ff', on: (s) => !!s.connected, bright: (s) => !!s.connected },
      // TUNER : petit voyant blanc dans la touche quand le coupleur est en service
      { path: circ(46, 271, 4.4), color: '#ffffff', on: (s) => !!(s.tuner || s.tuning), bright: (s) => !!(s.tuner || s.tuning) },
      // TX/RX de chaque récepteur : vert en réception, rouge en émission
      { x: 255, y: 198, w: 21, h: 7, rx: 3.5, color: '#3ddc5a', on: (s) => !!s.connected && !s.tx, bright: (s) => !!s.connected && !s.tx && (s.smeter || 0) > 0 },
      { x: 255, y: 198, w: 21, h: 7, rx: 3.5, color: '#ff3b30', on: (s, L) => !!s.tx && L.txSide(s) === 'A', bright: (s, L) => !!s.tx && L.txSide(s) === 'A' },
      { x: 257, y: 410, w: 21, h: 7, rx: 3.5, color: '#3ddc5a', on: (s) => !!s.connected && !s.tx && s.dualRx !== 0, bright: (s) => !!s.connected && !s.tx && s.dualRx !== 0 && (s.smeterB || 0) > 0 },
      { x: 257, y: 410, w: 21, h: 7, rx: 3.5, color: '#ff3b30', on: (s, L) => !!s.tx && L.txSide(s) === 'B', bright: (s, L) => !!s.tx && L.txSide(s) === 'B' }
    ].map(SC),
    keys: [
      // Colonne de gauche
      { id: 'power', x: 30, y: 118, w: 75, h: 34, tip: 'POWER : la mise en marche se fait au club', act: info('Le TRX ne s’allume et ne s’éteint qu’au club.') },
      { id: 'timer', x: 198, y: 68, w: 77, h: 30, tip: 'TIMER', act: info('TIMER (minuterie de mise en marche / arrêt) : pas disponible à distance.') },
      { id: 'apf', x: 122, y: 120, w: 73, h: 32, tip: 'APF/TPF : filtre audio de crête (CW) OFF → WIDE → MID → NAR, récepteur sélectionné', act: { cycle: 'apf', sided: true }, led: (s) => !!side('apf')(s) },
      { id: 'notch', x: 203, y: 120, w: 74, h: 32, tip: 'NOTCH : OFF → AN (automatique) → MN (manuel) → OFF, comme sur le TRX (pas d’AN en CW), récepteur sélectionné', act: { local: 'notchCycle' }, led: (s) => !!(side('notch')(s) || side('dnf')(s)) },
      { id: 'transmit', x: 30, y: 186, w: 75, h: 32, tip: 'TRANSMIT : émission maintenue (clic : émission, clic suivant : réception) ; avec votre micro si « MICRO » est actif', act: { local: 'mox' }, led: (s, L) => !!L.mox, ledColor: '#ff3b30' },
      { id: 'tuner', x: 30, y: 254, w: 75, h: 32, tip: 'TUNER : coupleur d’antenne en service / hors service ; appui d’au moins 1 s : accord (émission courte, avec la main)', act: { toggle: 'tuner', long: { action: 'tune' } } },
      { id: 'vox', x: 30, y: 320, w: 75, h: 33, tip: 'VOX/BK-IN : en CW, BK-IN OFF → SEMI → FULL ; en phonie, VOX (à distance, il ne peut être que coupé)', act: { local: 'voxBk' }, led: (s) => (/^CW/.test((s.vfoSel === 1 ? s.modeB : s.mode) || '') ? !!s.bkin : !!s.vox) },
      { id: 'nb', x: 122, y: 320, w: 73, h: 33, tip: 'NB (récepteur sélectionné) — appui d’au moins 1 s : niveau NB', act: { toggle: 'nb', sided: true, long: { pop: 'nbLvl' } }, led: (s) => !!side('nb')(s) },
      { id: 'nr', x: 205, y: 320, w: 72, h: 33, tip: 'NR (récepteur sélectionné) — appui d’au moins 1 s : niveau NR', act: { toggle: 'nr', sided: true, long: { pop: 'nrLvl' } }, led: (s) => !!side('nr')(s) },
      { id: 'phones', cx: 68, cy: 400, r: 22, tip: 'PHONES : écouter le TRX (clic : marche / arrêt)', act: { local: 'listen' }, led: (s, L) => L.listening, ledColor: '#3ddc5a', ring: true },
      { id: 'mic', cx: 75, cy: 510, r: 50, tip: 'MIC', act: info('Micro : phonie à distance par le bouton PTT sous la face avant (page TRX SSB).') },
      // Sous l'écran
      { id: 'menu', x: 320, y: 536, w: 90, h: 20, tip: 'MENU : tableau des modes (le mode se change aussi en cliquant sur le mode à l’écran)', act: { local: 'modeMenu' } },
      { id: 'function', x: 437, y: 536, w: 90, h: 20, tip: 'FUNCTION : écran des fonctions du TRX (P.AMP, ATT, AGC, NOTCH, NB, NR, DIGI-SEL, IP+, APF… du récepteur sélectionné ; VOX/BK-IN, COMP, TBW, MONI, TRACKING, DUAL-W)', act: { local: 'func' }, led: (s, L) => L.func },
      { id: 'mscope', x: 555, y: 536, w: 90, h: 20, tip: 'M.SCOPE : écran multi-fonctions (scope, OSCILLOSCOPE, AF-FFT du son reçu) ; 2e appui : retour', act: { local: 'multiView' }, led: (s, L) => !!L.multi },
      { id: 'quick', x: 675, y: 536, w: 90, h: 20, tip: 'QUICK : tableau des bandes', act: { local: 'bandMenu' } },
      { id: 'exit', x: 792, y: 536, w: 90, h: 20, tip: 'EXIT : ferme le tableau ou le menu ouvert', act: { local: 'exit' } },
      { id: 'rec', x: 920, y: 536, w: 53, h: 20, tip: 'REC', act: info('REC (enregistreur du TRX) : pas disponible à distance.') },
      { id: 'play', x: 988, y: 536, w: 54, h: 20, tip: 'PLAY', act: info('PLAY (enregistreur du TRX) : pas disponible à distance.') },
      { id: 'autotune', x: 1082, y: 537, w: 63, h: 18, tip: 'AUTOTUNE (CW) : accorde le récepteur sur le signal CW reçu, pour qu’il tombe sur votre tonalité (pitch)', act: { local: 'autotune' } },
      { id: 'speech', x: 1390, y: 537, w: 47, h: 19, tip: 'SPEECH', act: info('SPEECH (annonce vocale) : pas disponible à distance.') },
      // Petit écran : touches FIL / SHARP / MN
      { id: 'filKey', x: 1157, y: 196, w: 72, h: 38, tip: 'FIL : FIL1 → FIL2 → FIL3 (récepteur sélectionné)', act: { cycle: 'fil', sided: true } },
      { id: 'sharp', x: 1233, y: 196, w: 76, h: 38, tip: 'SHARP / SOFT', act: info('Forme du filtre DSP (SHARP / SOFT) : réglage au club.') },
      { id: 'mnKey', x: 1313, y: 196, w: 73, h: 38, tip: 'MN / AN : NOTCH du récepteur sélectionné', act: { local: 'notchCycle' } },
      // Autour du grand bouton
      { id: 'xfc', cx: 1142, cy: 300, r: 25, tip: 'XFC : en SPLIT, tant qu’on le tient, on écoute sur la fréquence d’émission (MAIN et SUB échangés, puis remis au relâchement)', act: { hold: 'xfc' } },
      { id: 'mainKey', x: 1207, y: 272, w: 63, h: 24, tip: 'MAIN : le grand bouton et les touches agissent sur le récepteur MAIN (VFO-A)', act: { set: ['vfoSel', 0] }, led: (s) => s.vfoSel !== 1, ledColor: '#ff6040' },
      { id: 'subKey', x: 1274, y: 272, w: 70, h: 24, tip: 'SUB : le grand bouton et les touches agissent sur le récepteur SUB (VFO-B)', act: { set: ['vfoSel', 1] }, led: (s) => s.vfoSel === 1, ledColor: '#38b6ff' },
      { id: 'subDisp', cx: 1375, cy: 282, r: 14, tip: 'SUB DISP : petit écran — galvanomètre, filtre du récepteur sélectionné, touches de bandes (à tour de rôle)', act: { local: 'subDisp' } },
      { id: 'mpad', cx: 1416, cy: 322, r: 14, tip: 'MPAD', act: info('MPAD (bloc-notes de fréquences) : pas encore relié.') },
      // Colonne de droite
      { id: 'change', x: 1460, y: 197, w: 45, h: 23, tip: 'CHANGE : échange MAIN et SUB ; appui d’au moins 1 s : MAIN = SUB', act: { action: 'swap', long: { action: 'aToB' } } },
      { id: 'dualW', x: 1515, y: 197, w: 45, h: 23, tip: 'DUAL-W : double réception (MAIN et SUB ensemble) ; sans DUAL-W, un seul scope (celui du VFO en cours)', act: { local: 'i76dualW' }, led: (s) => !!s.dualRx },
      { id: 'split', x: 1570, y: 197, w: 47, h: 23, tip: 'SPLIT : émission sur le SUB (fréquence d’émission en rouge)', act: { local: 'split' }, led: (s) => !!s.split },
      { id: 'rit', x: 1460, y: 392, w: 45, h: 25, tip: 'RIT ; le bouton RIT/ΔTX règle le décalage', act: { toggle: 'rit' }, led: (s) => !!s.rit },
      { id: 'dtx', x: 1515, y: 392, w: 45, h: 25, tip: 'ΔTX (XIT) ; le bouton RIT/ΔTX règle le décalage', act: { toggle: 'xit' }, led: (s) => !!s.xit },
      { id: 'clear', x: 1570, y: 392, w: 47, h: 25, tip: 'CLEAR : décalage RIT / ΔTX à zéro', act: { action: 'clarClr' } }
    ].map(SC),
    knobs: [
      { id: 'dial', cx: 1282, cy: 452, ro: 135, ri: 135, dial: true, tip: 'Grand bouton : fréquence du récepteur sélectionné (touches MAIN / SUB) ; molette ou glisser en tournant' },
      { id: 'multi', cx: 1537, cy: 117, ro: 55, multi: true, pushLocal: 'multiMenu', tip: 'MULTI : clic = menu MULTI (RF POWER, MIC GAIN, COMP, MONITOR ; en CW KEY SPEED, CW PITCH), tourner = le réglage choisi' },
      // TWIN PBT : centre = PBT intérieur, bague = PBT extérieur, du récepteur sélectionné ; le pousser (CLR) = les deux au milieu
      { id: 'pbt', cx: 1537, cy: 307, ri: 33, ro: 55, inner: { ctl: 'pbtIn', label: 'PBT intérieur', per: 4, sided: true }, outer: { ctl: 'pbtOut', label: 'PBT extérieur', per: 4, sided: true }, pushLocal: 'pbtClr' },
      { id: 'ritKnob', cx: 1537, cy: 497, ro: 55, inner: { ctl: 'clar', label: 'RIT/ΔTX', per: 10 } },
      { id: 'afMain', cx: 200, cy: 240, ri: 37, ro: 58, inner: { ctl: 'af', label: 'AF MAIN', per: 5 }, outer: { ctl: 'rf', label: 'RF MAIN', per: 5 } },
      { id: 'afSub', cx: 200, cy: 450, ri: 37, ro: 58, inner: { ctl: 'afB', label: 'AF SUB', per: 5 }, outer: { ctl: 'rfB', label: 'RF SUB', per: 5 } }
    ].map(SC)
  };
})();
