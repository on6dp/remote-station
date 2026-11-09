/*
 * spotlog.js — case « Spot » des pages TRX SSB, TRX CW, TRX DIGI et du carnet : cochée, le QSO enregistré est aussi
 * spoté sur le DX cluster, sous l'indicatif de l'opérateur (compte). Même réglage partout (localStorage rs.spotlog).
 * RSSPOT.on() → true / false ; RSSPOT.html() → la case ; RSSPOT.sync(root) → cases cochées selon le réglage.
 */
(function () {
  'use strict';
  const KEY = 'rs.spotlog';
  const on = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const TITLE = 'Cochée : chaque QSO enregistré est aussi spoté sur le DX cluster (indicatif, fréquence, mode / contest), sous votre indicatif d’opérateur — pas le TX CALL. Même réglage dans toutes les pages.';
  const html = (cls) => '<label class="spotlog' + (cls ? ' ' + cls : '') + '" title="' + TITLE + '"><input type="checkbox" data-spotlog' + (on() ? ' checked' : '') + '> Spot cluster</label>';
  function sync(root) {
    const v = on();
    (root || document).querySelectorAll('input[data-spotlog]').forEach((x) => { x.checked = v; x.closest('.spotlog') && x.closest('.spotlog').classList.toggle('on', v); });
  }
  document.addEventListener('change', (e) => {
    const x = e.target;
    if (!x || !x.matches || !x.matches('input[data-spotlog]')) return;
    try { localStorage.setItem(KEY, x.checked ? '1' : '0'); } catch (err) {}
    sync(x.ownerDocument);
  }, true);
  window.addEventListener('storage', (e) => { if (e.key === KEY) sync(); });
  document.addEventListener('DOMContentLoaded', () => sync());
  window.RSSPOT = { on, html, sync, TITLE };
})();
