/*
 * Catalogue des transceivers proposés sur la page Station.
 * ready = true : pilote disponible. Les autres sont prévus (protocole et commandes à implémenter).
 */
(function (root) {
  'use strict';
  const RIG_CATALOG = [
    { id: 'ftx1', name: 'Yaesu FTX-1', protocol: 'CAT Yaesu', ready: true },
    { id: 'ftdx10', name: 'Yaesu FTDX10', protocol: 'CAT Yaesu', ready: true },
    { id: 'ic7300', name: 'Icom IC-7300', protocol: 'CI-V', ready: true },
    { id: 'ic705', name: 'Icom IC-705', protocol: 'CI-V', ready: false },
    { id: 'ic7610', name: 'Icom IC-7610', protocol: 'CI-V', ready: false },
    { id: 'ic9700', name: 'Icom IC-9700', protocol: 'CI-V', ready: false },
    { id: 'x6100', name: 'Xiegu X6100', protocol: 'CI-V', ready: false },
    { id: 'x6200', name: 'Xiegu X6200', protocol: 'CI-V', ready: false },
    { id: 'tx500', name: 'Lab599 TX-500', protocol: 'CAT Kenwood', ready: false }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = RIG_CATALOG;
  else root.RIG_CATALOG = RIG_CATALOG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
