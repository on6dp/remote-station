/*
 * log-popup.js — carnet de trafic (logbook.js) dans sa propre fenêtre (/ftdx101/log.html), ouverte par l'onglet
 * LOGBOOKS de la page des modes numériques de la face avant. Pas de connexion à elle : elle se raccroche à la page
 * qui l'a ouverte (window.opener.RSLOGHOST), qui lui passe les messages du carnet, l'état du TRX et son « api ».
 */
(function () {
  'use strict';
  const op = window.opener;
  const host = op && !op.closed && op.RSLOGHOST;
  if (!host || !window.RSLOG) { document.getElementById('lgOrphan').hidden = false; return; }
  window.RSLOG.mount(document.getElementById('lgRoot'));
  const toast = (msg, level, ms) => {
    const el = document.getElementById('dgToast');
    el.textContent = msg || '';
    el.className = 'dg-toast ' + (level || '');
    if (msg) { void el.offsetWidth; el.classList.add('blink'); }
    clearTimeout(toast.t);
    if (msg) toast.t = setTimeout(() => { el.textContent = ''; }, Math.max(6000, Number(ms) || 0));
  };
  host.attach(window, window.RSLOG, toast);
  window.RSLOG.show();
  window.addEventListener('pagehide', () => { try { host.detach(window.RSLOG); } catch (e) { /* page des modes numériques fermée */ } });
})();
