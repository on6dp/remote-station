/*
 * ftx1.js — pilote CAT du Yaesu FTX-1 (port Enhanced / CAT-1)
 *
 * Références :
 *  - FTX-1 CAT Operation Reference Manual (Yaesu, édition 2508-C)
 *  - Formats vérifiés sur radio réelle par RigPlane Core (rigs/ftx1.toml), licence MIT — voir TIERS.md.
 */
(function (root) {
  'use strict';
  const Y = (typeof module !== 'undefined' && module.exports) ? require('./yaesu.js') : root.YAESU;
  const pad = Y.pad;
  const signed4 = (v) => (Number(v) < 0 ? '-' : '+') + pad(v, 4);

  // Puissance : la réponse PC indique la tête. P1 = 1 tête Field (0,5–10 W, dixièmes sous 10 W : "PC10.5;"),
  // P1 = 2 ampli SPA-1 (5–100 W : "PC2025;").
  const RANGE = { '1': [0.5, 10], '2': [5, 100] };

  const api = Y.build({
    ID: 'ftx1',
    NAME: 'Yaesu FTX-1',
    FREQ_MAX: 470000000,
    extraModes: { 'H': 'C4FM-DN', 'I': 'C4FM-VW' },
    power: {
      read: 'PC;',
      re: /^PC([12])(\d{3}|\d\.\d)$/,
      parse: (m) => ({ powerHead: m[1], power: parseFloat(m[2]) }),
      range: RANGE,
      step: { '1': 0.5, '2': 5 },
      cmd(watts, head) {
        const r = RANGE[head];
        if (!r) throw new Error('type de tête inconnu, puissance non réglable');
        let w = Math.round(Number(watts) * 2) / 2;
        if (!(w >= r[0] && w <= r[1])) throw new Error('puissance hors plage (' + r[0] + '–' + r[1] + ' W)');
        if (head === '2') w = Math.round(w);
        return 'PC' + head + (Number.isInteger(w) ? pad(w, 3) : w.toFixed(1)) + ';';
      },
      fakeHead: '2',
      fakeRead: (f) => 'PC' + f.head + pad(f.power, 3),
      fakeWrite(f, c) {
        const m = /^PC([12])(\d{3}|\d\.\d)$/.exec(c);
        const w = parseFloat(m[2]);
        if (m[1] !== f.head || w < RANGE[f.head][0] || w > RANGE[f.head][1]) return false;
        f.power = w;
        return true;
      }
    },
    // Codes BS (manuel CAT FTX-1 2508-C, BAND SELECT), vérifiés par RigPlane ; 2e valeur = fréquence du simulateur
    bandCodes: {
      '160M': ['00', 1840000], '80M': ['01', 3700000], '60M': ['02', 5357000], '40M': ['03', 7100000],
      '30M': ['04', 10136000], '20M': ['05', 14200000], '17M': ['06', 18130000], '15M': ['07', 21250000],
      '12M': ['08', 24950000], '10M': ['09', 28500000], '6M': ['10', 50150000], '2M': ['13', 144300000],
      '70CM': ['14', 432200000]
    },
    // Choix de l'antenne HF (prises ANT 1 / ANT 2 de l'ampli SPA-1) : menu EX030704 (0 = ANT 1, 1 = ANT 2),
    // vérifié par Hamlib (rigs/yaesu/ftx1). Pas de 3e prise ni d'entrée RX séparée sur le FTX-1.
    // Clarifier du côté SUB (VFO B) : CF1 0 0 = RIT / XIT, CF1 0 1 = décalage (Hamlib rigs/yaesu/ftx1, ftx1_clarifier.c)
    extraReads: [
      { cmd: 'EX030704;', re: /^EX030704([01])$/, parse: (m) => ({ ant: +m[1] + 1 }), sim: 'EX0307040' },
      { cmd: 'CF100;', re: /^CF100([01])([01])\d{3}$/, parse: (m) => ({ ritB: +m[1], xitB: +m[2] }), sim: 'CF10000000' },
      { cmd: 'CF101;', re: /^CF101([+-])(\d{4})$/, parse: (m) => ({ clarB: (m[1] === '-' ? -1 : 1) * +m[2] }), sim: 'CF101+0000' },
      // Préampli : PA P1 = gamme (0 HF/50 MHz : IPO/AMP1/AMP2 ; 1 = 144 MHz, 2 = 430 MHz : OFF/ON), pas MAIN/SUB
      // (Hamlib rigs/yaesu/ftx1/ftx1_preamp.c). Réglage propre à chaque gamme, commun aux deux côtés.
      { cmd: 'PA1;', re: /^PA1([01])$/, parse: (m) => ({ preampV: +m[1] }), sim: 'PA11' },
      { cmd: 'PA2;', re: /^PA2([01])$/, parse: (m) => ({ preampU: +m[1] }), sim: 'PA21' },
      // Côté SUB (VFO B) : P1 = 1 (Hamlib ftx1_noise.c, ftx1_filter.c, ftx1_audio.c) — affichés sur l'écran du VFO B
      { cmd: 'NL1;', re: /^NL1(\d{3})$/, parse: (m) => ({ nbB: +m[1] }), sim: 'NL1000' },
      { cmd: 'RL1;', re: /^RL1(\d{2})$/, parse: (m) => ({ nrB: +m[1] }), sim: 'RL100' },
      { cmd: 'BP10;', re: /^BP10(\d{3})$/, parse: (m) => ({ notchB: +m[1] ? 1 : 0 }), sim: 'BP10000' },
      { cmd: 'BC1;', re: /^BC1([01])$/, parse: (m) => ({ dnfB: +m[1] }), sim: 'BC10' },
      { cmd: 'NA1;', re: /^NA1([01])$/, parse: (m) => ({ narrowB: +m[1] }), sim: 'NA10' },
      { cmd: 'GT1;', re: /^GT1(\d)$/, parse: (m) => ({ agcB: Math.min(4, +m[1]) }), sim: 'GT14' },
      { cmd: 'SH1;', re: /^SH1(\d{3})$/, parse: (m) => ({ widthB: +m[1] }), sim: 'SH1013' },
      { cmd: 'RG1;', re: /^RG1(\d{3})$/, parse: (m) => ({ rfB: +m[1] }), sim: 'RG1255' },
      { cmd: 'BP11;', re: /^BP11(\d{3})$/, parse: (m) => ({ notchFreqB: +m[1] * 10 }), sim: 'BP11150' },
      { cmd: 'IS1;', re: /^IS1[01]([+-])(\d{4})$/, parse: (m) => ({ shiftB: (m[1] === '-' ? -1 : 1) * +m[2] }), sim: 'IS10+0000' },
      { cmd: 'CO10;', re: /^CO10(\d{4})$/, parse: (m) => ({ contourB: +m[1] ? 1 : 0 }), sim: 'CO100000' },
      { cmd: 'CO12;', re: /^CO12(\d{4})$/, parse: (m) => ({ apfB: +m[1] ? 1 : 0 }), sim: 'CO120000' },
      // FUNCTION RX : FR00 double réception (S-mètre SUB lisible par SM1), FR01 réception simple
      { cmd: 'FR;', re: /^FR0([01])$/, parse: (m) => ({ dualRx: m[1] === '0' ? 1 : 0 }), sim: 'FR00' },
      // RADIO INFORMATION (manuel CAT) : RI0 P2 … P8 — P2 1 = Hi-SWR, P6 1 = tuner en cours d'accord
      { cmd: 'RI0;', re: /^RI0(\d)(\d)(\d)(\d)(\d)(\d)(\d)$/, parse: (m) => ({ hiSwr: m[1] === '1' ? 1 : 0, tuningRi: m[5] === '1' ? 1 : 0 }), sim: 'RI00000000' }
    ],
    // Console CAT : lectures supplémentaires pour le diagnostic (ATT / préampli par côté)
    // + tuner : AC (état), RI0 (accord en cours), menus TUN/LIN PORT SELECT (EX030103), TUNER SELECT (EX030104),
    // TUNER TYPE SEL ANT1 / ANT2 (EX030701 / EX030702) — numéros du manuel CAT FTX-1 (Table 3)
    extraQueries: ['RA1;', 'PA0;', 'PA1;', 'PA2;', 'AC;', 'RI0;', 'EX030103;', 'EX030104;', 'EX030701;', 'EX030702;'],
    extraStateKeys: ['attB', 'preampB', 'notchFreqB', 'shiftB', 'contourB', 'apfB', 'widthB', 'preampV', 'preampU', 'preampVU', 'nbB', 'nrB', 'notchB', 'dnfB', 'narrowB', 'agcB', 'rfB', 'hiSwr', 'tuningRi'],
    subBadges: true,
    // CW : mémoire TEXTE 5 du manipulateur (écrasée), lue par KY05 ; KY00 = arrêt (manuel CAT FTX-1, Hamlib ftx1_cw.c)
    cw: { mem: 'KM5', play: 'KY05;', stop: 'KY00;BI0;' },
    // PA0 / RA0 lus avec le côté SUB actif : ce sont l'ATT et le préampli du VFO B
    remapRead(p, r) {
      if (r.vfoSel !== 1) return;
      if (p.preamp != null) { p.preampB = p.preamp; delete p.preamp; }
      if (p.att != null) { p.attB = p.att; delete p.att; }
    },
    // Préampli de la gamme du VFO A (144 / 430 MHz), pour le bouton AMP
    derive(r) {
      const f = r.freq;
      r.preampVU = f == null ? null : f >= 420000000 ? r.preampU : f >= 144000000 ? r.preampV : null;
    },
    readForState: (id, s) => (id === 'preampVU' ? (s.freq >= 420000000 ? 'PA2;' : 'PA1;') : null),
    // Texte du badge préampli d'un VFO : [texte, allumé]
    preampText(r, w) {
      const f = w === 'B' ? r.freqB : r.freq;
      if (f == null) return null;
      if (f >= 144000000) {
        const v = f >= 420000000 ? r.preampU : r.preampV;
        return v == null ? null : ['AMP', !!v];
      }
      if (r.preamp == null) return null;
      return [['IPO', 'AMP1', 'AMP2'][r.preamp] || 'IPO', r.preamp > 0];
    },
    extraControls: [
      // Double réception (FR00) / réception simple (FR01). En double réception, la BF USB du TRX contient aussi le côté SUB
      // (ex. 14 074 kHz entendu pendant un trafic QO-100 sur MAIN) : réception simple pour n'avoir que le côté actif
      { id: 'dualRx', g: 'vfo', label: 'DUAL RX', type: 'toggle', write: (v) => 'FR0' + (v ? '0' : '1') + ';' },
      { id: 'ant', g: 'rx', label: 'Antenne', type: 'select', noTx: true, options: [[1, 'ANT 1'], [2, 'ANT 2']], write: (v) => 'EX030704' + (v - 1) + ';' },
      { id: 'ritB', g: 'vfo', label: 'RIT (VFO B)', type: 'toggle', write: (v, s) => 'CF100' + v + (s.xitB || 0) + '000;' },
      { id: 'xitB', g: 'vfo', label: 'XIT (VFO B)', type: 'toggle', write: (v, s) => 'CF100' + (s.ritB || 0) + v + '000;' },
      { id: 'clarB', g: 'vfo', label: 'Décalage RIT/XIT (VFO B)', type: 'level', min: -9999, max: 9999, step: 10, unit: 'Hz',
        write: (v) => 'CF101' + (v < 0 ? '-' : '+') + pad(Math.abs(v), 4) + ';' },
      { id: 'clarClrB', g: 'vfo', label: 'CLEAR (décalage VFO B à zéro)', type: 'action', write: () => 'CF101+0000;' },
      // Largeur de filtre du côté SUB (VFO B) : SH1 0 nn (Hamlib ftx1_audio.c) — molette sur « BW » de l'écran du VFO B
      { id: 'widthB', g: 'flt', label: 'WIDTH (VFO B)', type: 'width', modeKey: 'modeB', write: (v) => 'SH1' + pad(v, 3) + ';',
        when: (s) => !!api.widthTableFn && !!api.widthTableFn(s.modeB) && !s.narrowB },
      // ATT et préampli du côté SUB : PA0 / RA0 agissent sur le côté actif. Côté MAIN actif, la page Station passe sur SUB
      // (FT confirmé avant VS1), envoie RA0 / PA0, puis revient sur MAIN. Lus quand SUB est actif (remapRead).
      { id: 'attB', g: 'rx', label: 'ATT (VFO B)', type: 'toggle', viaSub: true, write: (v) => 'RA0' + v + ';',
        when: (s) => s.freqB != null && s.freqB < 144000000 },
      { id: 'preampB', g: 'rx', label: 'Préampli (VFO B)', type: 'select', options: [[0, 'IPO'], [1, 'AMP1'], [2, 'AMP2']], viaSub: true,
        write: (v) => 'PA0' + v + ';', when: (s) => s.freqB != null && s.freqB < 144000000 },
      // Côté SUB (VFO B) : réglés d'un clic sur les badges de l'écran du VFO B (P1 = 1, comme les lectures NL1, RL1, BP10, BC1, NA1)
      { id: 'narrowB', g: 'flt', label: 'NARROW (VFO B)', type: 'toggle', write: (v) => 'NA1' + v + ';' },
      { id: 'nbB', g: 'flt', label: 'NB (VFO B)', type: 'level', min: 0, max: 10, step: 1, off0: true, write: (v) => 'NL1' + pad(v, 3) + ';' },
      { id: 'nrB', g: 'flt', label: 'DNR (VFO B)', type: 'level', min: 0, max: 10, step: 1, off0: true, write: (v) => 'RL1' + pad(v, 2) + ';' },
      { id: 'notchB', g: 'flt', label: 'NOTCH (VFO B)', type: 'toggle', write: (v) => 'BP10' + pad(v, 3) + ';' },
      { id: 'dnfB', g: 'flt', label: 'DNF (VFO B)', type: 'toggle', write: (v) => 'BC1' + v + ';' },
      { id: 'notchFreqB', g: 'flt', label: 'Fréquence NOTCH (VFO B)', type: 'level', min: 10, max: 3200, step: 10, unit: 'Hz', write: (v) => 'BP11' + pad(v / 10, 3) + ';', when: (s) => !/FM/.test(s.modeB || '') },
      { id: 'shiftB', g: 'flt', label: 'IF SHIFT (VFO B)', type: 'level', min: -1200, max: 1200, step: 20, unit: 'Hz', write: (v) => 'IS10' + signed4(v) + ';' },
      { id: 'contourB', g: 'flt', label: 'CONTOUR (VFO B)', type: 'toggle', write: (v) => 'CO10' + pad(v, 4) + ';' },
      { id: 'apfB', g: 'flt', label: 'APF (VFO B)', type: 'toggle', write: (v) => 'CO12' + pad(v, 4) + ';', when: (s) => /^CW/.test(s.modeB || '') },
      { id: 'agcB', g: 'rx', label: 'AGC (VFO B)', type: 'select', options: [[0, 'OFF'], [1, 'FAST'], [2, 'MID'], [3, 'SLOW'], [4, 'AUTO']], write: (v) => 'GT1' + v + ';' },
      { id: 'rfB', g: 'rx', label: 'RF gain (VFO B)', type: 'level', min: 0, max: 255, step: 1, pct: true, write: (v) => 'RG1' + pad(v, 3) + ';' },
      // 144 / 430 MHz : un seul préampli, AMP ON / OFF (AMP1 / AMP2 n'existent qu'en HF et 50 MHz)
      { id: 'preampVU', g: 'rx', label: 'AMP (144 / 430 MHz)', type: 'toggle', write: (v, s) => 'PA' + (s.freq >= 420000000 ? 2 : 1) + v + ';',
        when: (s) => s.freq != null && s.freq >= 144000000, hideUnavail: true }
    ],
    // SPLIT : sur le FTX-1, ST1 met le côté SUB en émission (PTT) — défaut connu du firmware, signalé par Hamlib
    // (rigs/yaesu/ftx1/ftx1_vfo.c). Le choix du VFO d'émission passe donc par FT0 (TX MAIN) / FT1 (TX SUB) ; ST n'est ni lu ni envoyé.
    splitIsFT: true,
    // SPLIT mis sur la face avant du TRX : lu (hwSplit) pour l'afficher ; jamais activé par CAT (ST1), seulement coupé (ST0)
    readOverrides: { 'ST;': { re: /^ST([0-2])$/, parse: (m) => ({ hwSplit: m[1] === '0' ? 0 : 1 }), sim: 'ST0' } },
    // Sur le FTX-1, réception (VS) et émission (FT) basculent ensemble d'un côté à l'autre, et un VFO d'émission
    // différent de celui de réception peut faire émettre le TRX. Le choix du VFO d'émission (SPLIT, clic sur TX) est
    // donc gardé par le serveur (« SPLIT virtuel », comme Hamlib) et n'est envoyé au TRX qu'au moment d'émettre :
    // FT du VFO choisi, TX1… puis TX0 et retour de FT / VS sur le VFO de réception.
    // MAIN / SUB (clic sur RX) : FT puis VS sur le même côté — VS seul laisserait FT sur l'autre côté, et ce
    // désaccord fait émettre le FTX-1 (constaté au club).
    virtualSplit: true,
    // SPLIT par échange A ⇄ B (depuis 0.22.63) : au PTT, SV (les VFO s'échangent), émission sur le côté actif, puis TX0
    // vérifié et SV de retour. Plus aucun FT / VS autour de l'émission : en réception simple, le FTX-1 refusait FT1 ou
    // restait en émission dans l'état FT0 + VS1 (constaté au club le 25/10).
    splitSwap: true,
    controlOverrides: {
      // FTX-1 : ATT et IPO / AMP1 / AMP2 sous 144 MHz, un seul préampli AMP (ON / OFF) en 144 et 430 MHz (constaté au club)
      // ATT et IPO / AMP1 / AMP2 propres à chaque côté ; le CAT (PA0 / RA0) agit sur le côté actif (constaté au club) :
      // côté SUB actif, la page Station repasse un instant sur MAIN pour régler ceux du VFO A (viaMain)
      preamp: { hideUnavail: true, viaMain: true, when: (s) => s.freq != null && s.freq < 144000000 },
      att: { viaMain: true, when: (s) => s.freq != null && s.freq < 144000000 }, split: { write: (v) => 'FT' + (v ? 1 : 0) + ';' }, // MAIN / SUB : jamais l'état « émission sur MAIN, opération sur SUB » (FT0 avec VS1), qui met le FTX-1 en émission
      // (constaté au club : VS1 seul, puis FT0 avant VS0). Vers SUB : FT1 puis VS1 ; vers MAIN : VS0 puis FT0.
      vfoSel: { write: (v) => (v ? 'FT1;VS1;' : 'VS0;FT0;') } },
    extraControlsLate: [{ id: 'splitHw', g: 'vfo', label: 'SPLIT du TRX (coupure)', type: 'toggle', offOnly: true, write: () => 'ST0;' }],
    serial: { baudRate: 38400, stopBits: 1, portHint: 'Enhanced COM Port (CAT-1)' },
    hint: 'FTX-1 : menu Operation setting → General, « CAT-1 RATE » et « CAT-1 CAT-3 STOP BIT » doivent correspondre à ces valeurs. Choisissez le port Enhanced COM Port (CAT-1).'
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.FTX1 = api;
    root.RIGS = root.RIGS || {};
    root.RIGS[api.ID] = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
