/*
 * contests.js — contests SSB (page TRX SSB) : identifiant Cabrillo, période habituelle, échange envoyé par une
 * station belge (ON5VL / OR0L), catégories d'inscription et valeurs Cabrillo correspondantes.
 *
 * Balises de l'échange : <CNTR> n° de série, <CQZ> zone CQ (14), <ITUZ> zone ITU (27), <MYNAME> prénom.
 * « verif: true » : règlement relu (sources en commentaire) ; sinon catégories habituelles, à vérifier dans le
 * règlement de l'année (les organisateurs les changent de temps en temps).
 * Sources relues le 9 novembre 2026 : cqww.com/rules.htm, cqwpx.com/rules (2025), contests.arrl.org (IARU HF),
 * ARRL DX, darc.de (WAEDC 2026), uba.be (UBA DX Contest, ON Contest), euhf.s5cc.eu (EU HF Championship).
 */
(function () {
  'use strict';
  // Catégories : [clé, libellé, { OPERATOR, POWER, ASSISTED, TRANSMITTER, STATION, MODE, TIME }]
  const SO = (pw, lbl) => [pw === 'HIGH' ? 'SOHP' : pw === 'LOW' ? 'SOLP' : 'SOQRP', lbl, { OPERATOR: 'SINGLE-OP', POWER: pw, TRANSMITTER: 'ONE' }];
  const SO3 = (hp, lp, qrp) => [SO('HIGH', 'Mono-opérateur, forte puissance (' + hp + ')'), SO('LOW', 'Mono-opérateur, faible puissance (' + lp + ')'), SO('QRP', 'Mono-opérateur QRP (' + qrp + ')')];
  const CHECK = ['CHECK', 'Checklog (log de contrôle, pas classé)', { OPERATOR: 'CHECKLOG' }];
  const MULTI = ['MULTI', 'Multi-opérateur', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'ONE' }];
  const GENERIC = SO3('> 100 W', '≤ 100 W', '≤ 5 W').concat([MULTI, CHECK]);

  const SSB = [
    { id: 'CQ-WW-SSB', name: 'CQ World Wide DX SSB', when: 'fin octobre (48 h)', exch: '59 <CQZ>', verif: true, bands: true, assisted: true,
      overlays: ['CLASSIC', 'ROOKIE', 'YOUTH'], url: 'https://cqww.com/rules.htm', location: 'DX',
      note: 'Tout le monde contacte tout le monde. Échange : RS + zone CQ (14 pour la Belgique).',
      cat: SO3('≤ 1500 W', '≤ 100 W', '≤ 5 W').concat([
        ['MSHP', 'Multi-single, forte puissance', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'ONE', POWER: 'HIGH' }],
        ['MSLP', 'Multi-single, faible puissance', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'ONE', POWER: 'LOW' }],
        ['M2', 'Multi-two', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'TWO', POWER: 'HIGH' }],
        ['MM', 'Multi-multi', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'UNLIMITED', POWER: 'HIGH' }],
        ['MD', 'Multi-distributed', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'UNLIMITED', POWER: 'HIGH', STATION: 'DISTRIBUTED' }], CHECK]) },
    { id: 'CQ-WPX-SSB', name: 'CQ WPX SSB', when: 'fin mars (48 h, 36 h pour un mono-op)', exch: '59 <CNTR>', verif: true, bands: true, assisted: true,
      overlays: ['TB-WIRES', 'ROOKIE', 'CLASSIC', 'YOUTH'], url: 'https://www.cqwpx.com/rules/', location: 'DX',
      note: 'Multiplicateurs : préfixes. Échange : RS + n° de série (aide aux spots permise sauf overlay Classic).',
      cat: SO3('≤ 1500 W', '≤ 100 W', '≤ 5 W').concat([
        ['M1HP', 'Multi-one, forte puissance', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'ONE', POWER: 'HIGH' }],
        ['M1LP', 'Multi-one, faible puissance', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'ONE', POWER: 'LOW' }],
        ['M2', 'Multi-two', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'TWO', POWER: 'HIGH' }],
        ['MU', 'Multi-unlimited', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'UNLIMITED', POWER: 'HIGH' }],
        ['MD', 'Multi-distributed', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'UNLIMITED', POWER: 'HIGH', STATION: 'DISTRIBUTED' }], CHECK]) },
    { id: 'CQ-160-SSB', name: 'CQ World Wide 160 m SSB', when: 'fin février (160 m seulement)', exch: '59 <CQZ>', bands: false, assisted: true,
      url: 'https://cq160.com/rules.htm', location: 'DX', note: 'Bande 160 m seulement. Échange des stations hors USA / VE : RS + zone CQ.', cat: GENERIC },
    { id: 'ARRL-DX-SSB', name: 'ARRL International DX SSB', when: '1er week-end de mars (48 h)', exch: '59 100', verif: true, bands: true, assisted: true,
      url: 'https://contests.arrl.org/', note: 'Les stations DX ne contactent que les W / VE (USA et Canada). Échange : RS + puissance d’émission (ex. 100).',
      cat: SO3('> 100 W', '≤ 100 W', '≤ 5 W').concat([
        ['MS', 'Multi-op, un émetteur', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'ONE', POWER: 'HIGH' }],
        ['M2', 'Multi-op, deux émetteurs', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'TWO', POWER: 'HIGH' }],
        ['MM', 'Multi-op, multi-émetteurs', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'UNLIMITED', POWER: 'HIGH' }], CHECK]) },
    { id: 'IARU-HF', name: 'IARU HF World Championship', when: '2e week-end complet de juillet (24 h, CW et SSB)', exch: '59 <ITUZ>', verif: true, bands: false, assisted: true, mode: 'MIXED',
      url: 'https://contests.arrl.org/ContestRules/IARU-HF-Rules.pdf', note: 'Échange : RS + zone ITU (27 pour la Belgique). Stations HQ : sigle de l’association. Mono-op : phonie seule, CW seule ou mixte.',
      cat: [
        ['SOPH', 'Mono-op, phonie seule', { OPERATOR: 'SINGLE-OP', TRANSMITTER: 'ONE', MODE: 'SSB' }],
        ['SOMX', 'Mono-op, mixte CW + phonie', { OPERATOR: 'SINGLE-OP', TRANSMITTER: 'ONE', MODE: 'MIXED' }],
        ['MS', 'Multi-op, un émetteur (forte puissance)', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'ONE', POWER: 'HIGH', MODE: 'MIXED' }],
        ['M2', 'Multi-op, deux émetteurs (≤ 100 W)', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'TWO', POWER: 'LOW', MODE: 'MIXED' }], CHECK], power: true },
    { id: 'DARC-WAEDC-SSB', name: 'WAE DX SSB (DARC)', when: '2e week-end de septembre (48 h)', exch: '59 <CNTR>', verif: true, bands: false, assisted: false,
      url: 'https://www.darc.de/der-club/referate/conteste/wae-dx-contest/en/wae-rules/',
      note: 'Les Européens ne contactent que les non-Européens. Les QTC (renvoi de QSO aux Européens) ne sont pas gérés ici.',
      cat: [SO('LOW', 'Mono-op, faible puissance (≤ 100 W)'), SO('HIGH', 'Mono-op, forte puissance (> 100 W)'), ['MULTI', 'Multi-op (changement de bande toutes les 10 min)', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'ONE' }], CHECK] },
    { id: 'UBA-DX-SSB', name: 'UBA DX Contest SSB', when: 'dernier week-end de janvier, 13:00 → 13:00 UTC', exch: '59 <CNTR> LGE', verif: true, bands: false, assisted: false,
      url: 'https://www.uba.be/en/hf/contest-rules/uba-dx-contest', time: true,
      note: 'Stations belges : RS + n° de série + abréviation de la section UBA (LGE ; XXX pour un non-membre ; ON4UBA : UBA). L’en-tête Cabrillo doit indiquer la durée (6, 12 ou 24 h).',
      cat: [
        ['CH', 'CH — mono-op 24 h, forte puissance (HAREC)', { OPERATOR: 'SINGLE-OP', POWER: 'HIGH', TRANSMITTER: 'ONE', TIME: '24-HOURS' }],
        ['CL', 'CL — mono-op 24 h, faible puissance (HAREC, ON2)', { OPERATOR: 'SINGLE-OP', POWER: 'LOW', TRANSMITTER: 'ONE', TIME: '24-HOURS' }],
        ['BH', 'BH — mono-op 12 h, forte puissance', { OPERATOR: 'SINGLE-OP', POWER: 'HIGH', TRANSMITTER: 'ONE', TIME: '12-HOURS' }],
        ['BL', 'BL — mono-op 12 h, faible puissance', { OPERATOR: 'SINGLE-OP', POWER: 'LOW', TRANSMITTER: 'ONE', TIME: '12-HOURS' }],
        ['AH', 'AH — mono-op 6 h, forte puissance', { OPERATOR: 'SINGLE-OP', POWER: 'HIGH', TRANSMITTER: 'ONE', TIME: '6-HOURS' }],
        ['AL', 'AL — mono-op 6 h, faible puissance', { OPERATOR: 'SINGLE-OP', POWER: 'LOW', TRANSMITTER: 'ONE', TIME: '6-HOURS' }],
        ['D', 'D — multi-opérateur, toutes bandes', { OPERATOR: 'MULTI-OP', TRANSMITTER: 'ONE', TIME: '24-HOURS' }],
        ['E', 'E — mono-op QRP (≤ 10 W en SSB, 18 h max)', { OPERATOR: 'SINGLE-OP', POWER: 'QRP', TRANSMITTER: 'ONE' }],
        ['BASE', 'BASE — licence de base (ON3), 24 h', { OPERATOR: 'SINGLE-OP', POWER: 'LOW', TRANSMITTER: 'ONE', TIME: '24-HOURS' }], CHECK] },
    { id: 'ON-CONTEST-SSB', name: 'UBA ON Contest SSB (80 / 40 m)', when: '1er dimanche d’octobre, 06:00 → 10:00 UTC', exch: '59 <CNTR> LGE', verif: true, bands: false, assisted: false,
      url: 'https://www.uba.be/fr/hf/reglement-des-contests/on-contest',
      note: 'Stations belges : RS + n° de série + section UBA (LGE ; XXX pour un non-membre). Nom Cabrillo non fixé par le règlement : à confirmer auprès du responsable.',
      cat: [['A', 'a — station ON', { OPERATOR: 'SINGLE-OP', TRANSMITTER: 'ONE' }], ['A2', 'a2 — station ON QRP (≤ 10 W en SSB)', { OPERATOR: 'SINGLE-OP', POWER: 'QRP', TRANSMITTER: 'ONE' }], CHECK] },
    { id: 'EU-HF', name: 'EU HF Championship', when: '1er samedi d’août, 12:00 → 24:00 UTC (CW et SSB)', exch: '59 00', verif: true, bands: false, assisted: false, mode: 'MIXED',
      url: 'https://euhf.s5cc.eu/rules/euhfc_rules_latest.pdf', note: 'Échange : RS + 2 derniers chiffres de l’année de la 1re licence de l’opérateur (remplacer 00).',
      cat: [
        ['SSBHP', 'Mono-op SSB seule, forte puissance', { OPERATOR: 'SINGLE-OP', POWER: 'HIGH', MODE: 'SSB', TRANSMITTER: 'ONE' }],
        ['SSBLP', 'Mono-op SSB seule, faible puissance', { OPERATOR: 'SINGLE-OP', POWER: 'LOW', MODE: 'SSB', TRANSMITTER: 'ONE' }],
        ['MXHP', 'Mono-op mixte, forte puissance', { OPERATOR: 'SINGLE-OP', POWER: 'HIGH', MODE: 'MIXED', TRANSMITTER: 'ONE' }],
        ['MXLP', 'Mono-op mixte, faible puissance', { OPERATOR: 'SINGLE-OP', POWER: 'LOW', MODE: 'MIXED', TRANSMITTER: 'ONE' }],
        ['UNL', 'Unlimited (mixte)', { OPERATOR: 'SINGLE-OP', ASSISTED: 'ASSISTED', MODE: 'MIXED', TRANSMITTER: 'ONE' }],
        ['QRP', 'QRP (mixte)', { OPERATOR: 'SINGLE-OP', POWER: 'QRP', MODE: 'MIXED', TRANSMITTER: 'ONE' }], CHECK] },
    { id: 'RDXC', name: 'Russian DX Contest', url: 'https://rdxc.srr.ru/rules.html', when: '3e week-end de mars (CW et SSB)', exch: '59 <CNTR>', bands: true, assisted: true, mode: 'MIXED', cat: GENERIC },
    { id: 'SPDX', name: 'SP DX Contest SSB', url: 'https://spdxcontest.pzk.org.pl/', when: '1er week-end d’avril', exch: '59 <CNTR>', bands: true, assisted: true, note: 'Les stations hors Pologne ne contactent que les SP.', cat: GENERIC },
    { id: 'HA-DX', name: 'HA DX Contest', when: '3e week-end de janvier (CW et SSB)', exch: '59 <CNTR>', bands: true, assisted: true, mode: 'MIXED', cat: GENERIC },
    { id: 'OK-OM-DX', name: 'OK/OM DX Contest SSB', when: '2e week-end de décembre', exch: '59 <CNTR>', bands: true, assisted: true, cat: GENERIC },
    { id: 'YODX-HF', name: 'YO DX HF Contest', when: 'fin août (CW et SSB)', exch: '59 <CNTR>', bands: true, assisted: true, mode: 'MIXED', cat: GENERIC },
    { id: 'EA-MAJESTAD-SSB', name: 'S.M. El Rey de España SSB', when: 'juin', exch: '59 <CNTR>', bands: true, assisted: true, cat: GENERIC },
    { id: 'HELVETIA', name: 'Helvetia Contest', when: 'fin avril (CW et SSB)', exch: '59 <CNTR>', bands: true, assisted: true, mode: 'MIXED', note: 'Les stations hors Suisse ne contactent que les HB.', cat: GENERIC },
    { id: 'PACC', name: 'PACC (Pays-Bas)', when: '2e week-end de février (CW et SSB)', exch: '59 <CNTR>', bands: true, assisted: true, mode: 'MIXED', note: 'Les stations hors Pays-Bas ne contactent que les PA.', cat: GENERIC },
    { id: 'WAG', name: 'Worked All Germany', when: '3e week-end d’octobre (CW et SSB)', exch: '59 <CNTR>', bands: true, assisted: true, mode: 'MIXED', note: 'Les stations hors Allemagne ne contactent que les DL.', cat: GENERIC },
    { id: 'REF-SSB', name: 'Coupe du REF SSB', when: 'fin février', exch: '59 <CNTR>', bands: true, assisted: true, note: 'Les stations hors France ne contactent que les F.', cat: GENERIC },
    { id: 'ARI-INTL-DX', name: 'ARI International DX', when: '1er week-end de mai (CW, SSB, RTTY)', exch: '59 <CNTR>', bands: true, assisted: true, mode: 'MIXED', cat: GENERIC },
    { id: 'UKRAINIAN-DX', name: 'Ukrainian DX Contest', url: 'https://urdxc.org/', when: '1er week-end de novembre (CW et SSB)', exch: '59 <CNTR>', bands: true, assisted: true, mode: 'MIXED', cat: GENERIC },
    { id: 'CQ-M', name: 'CQ-M International DX', when: '2e week-end de mai (CW et SSB)', exch: '59 <CNTR>', bands: true, assisted: true, mode: 'MIXED', cat: GENERIC },
    { id: 'ARRL-10', name: 'ARRL 10 m', url: 'https://www.arrl.org/10-meter', when: '2e week-end de décembre (CW et SSB)', exch: '59 <CNTR>', bands: false, assisted: true, mode: 'MIXED', note: 'Bande 10 m seulement.', cat: GENERIC },
    { id: 'AADX-SSB', name: 'All Asian DX Phone', url: 'https://www.jarl.org/English/4_Library/A-4-3_Contests/aadx_eng.html', when: '1er week-end de septembre', exch: '59 00', bands: true, assisted: true, note: 'Échange : RS + âge de l’opérateur (remplacer 00). Les stations hors Asie ne contactent que les Asiatiques.', cat: GENERIC },
    { id: 'JIDX-SSB', name: 'JIDX Phone', url: 'https://jidx.org/', when: '2e week-end de novembre', exch: '59 <CQZ>', bands: true, assisted: true, note: 'Les stations hors Japon ne contactent que les JA.', cat: GENERIC },
    { id: 'LZ-DX', name: 'LZ DX Contest', url: 'https://lzdx.bfra.bg/', when: '3e week-end de novembre (CW et SSB)', exch: '59 <ITUZ>', bands: true, assisted: true, mode: 'MIXED', cat: GENERIC },
    { id: 'SSB-OTHER', name: 'Autre contest (échange libre)', when: '', exch: '59 <CNTR>', bands: true, assisted: true, cat: GENERIC }
  ];
  const BANDS = ['ALL', '160M', '80M', '40M', '20M', '15M', '10M'];
  window.RSCONTESTS = { SSB, BANDS };
})();
