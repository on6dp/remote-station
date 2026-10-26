/*
 * qsy-relay.js — relais des spots d'un site de DX cluster vers le dashboard (même navigateur).
 * Message attendu du site parent : { type: 'rs-qsy', freq, mode, call } — freq en kHz (aussi accepté : Hz ou MHz).
 * Seuls les sites listés dans qsyOrigins (config.json du serveur) sont écoutés.
 * Le relais interroge aussi le dashboard toutes les 3 s (présence, main) et en donne l'état au site du cluster,
 * qui affiche « Remote Station <-> DX Cluster » (vert : dashboard ouvert avec la main ; rouge sinon).
 */
(function () {
  'use strict';
  let allowed = [];
  let parentOrigin = null;
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('rs-qsy') : null;
  let lastAny = 0, lastCtl = 0;
  const member = (() => { try { return localStorage.getItem('rs.member') === '1'; } catch (e) { return false; } })();
  if (bc) bc.onmessage = (e) => {
    const d = e.data;
    if (!d || d.type !== 'rs-qsy-here') return;
    lastAny = Date.now();
    if (d.control) lastCtl = Date.now();
  };
  function status() {
    if (!parentOrigin) return;
    const now = Date.now();
    window.parent.postMessage({ type: 'rs-qsy-status', member, dash: now - lastAny < 7000, control: now - lastCtl < 7000 }, parentOrigin);
  }
  fetch('/api/info', { cache: 'no-store' }).then((r) => r.json()).then((i) => {
    allowed = Array.isArray(i.qsyOrigins) ? i.qsyOrigins : [];
    if (window.parent !== window) window.parent.postMessage({ type: 'rs-qsy-ready' }, '*'); // aucun contenu : simple signal
  }).catch(() => {});
  // Présence du dashboard : question toutes les 3 s, état envoyé au site un peu après les réponses
  setInterval(() => { if (bc && parentOrigin) { bc.postMessage({ type: 'rs-qsy-ping' }); setTimeout(status, 400); } }, 3000);
  window.addEventListener('message', (e) => {
    if (allowed.indexOf(e.origin) < 0) return;
    const m = e.data;
    if (!m) return;
    if (!parentOrigin && e.source === window.parent) {
      parentOrigin = e.origin;
      if (bc) { bc.postMessage({ type: 'rs-qsy-ping' }); setTimeout(status, 400); }
    }
    if (m.type !== 'rs-qsy' || !bc) return;
    const freq = Number(m.freq);
    if (!(freq > 0)) return;
    const mode = String(m.mode || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10);
    const call = String(m.call || '').toUpperCase().replace(/[^A-Z0-9/]/g, '').slice(0, 15);
    const at = Date.now();
    bc.postMessage({ type: 'rs-qsy', freq, mode, call, from: e.origin, at });
    // Réponse au site : le dashboard l'a-t-il pris (main), seulement vu (pas la main), ou pas de dashboard ?
    setTimeout(() => {
      const ok = lastCtl >= at;
      const reason = ok ? 'ok' : lastAny >= at ? 'nocontrol' : 'nodash';
      if (e.source) e.source.postMessage({ type: 'rs-qsy-ack', ok, reason }, e.origin);
      status();
    }, 500);
  });
})();
