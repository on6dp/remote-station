/*
 * qsy-relay.js — relais des spots d'un site de DX cluster vers le dashboard (même navigateur).
 * Message attendu du site parent : { type: 'rs-qsy', freq, mode, call } — freq en kHz (aussi accepté : Hz ou MHz).
 * Seuls les sites listés dans qsyOrigins (config.json du serveur) sont écoutés.
 */
(function () {
  'use strict';
  let allowed = [];
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('rs-qsy') : null;
  let dashSeen = 0;
  if (bc) bc.onmessage = (e) => { if (e.data && e.data.type === 'rs-qsy-here') dashSeen = Date.now(); };
  fetch('/api/info', { cache: 'no-store' }).then((r) => r.json()).then((i) => {
    allowed = Array.isArray(i.qsyOrigins) ? i.qsyOrigins : [];
    if (window.parent !== window) window.parent.postMessage({ type: 'rs-qsy-ready' }, '*'); // aucun contenu : simple signal
  }).catch(() => {});
  window.addEventListener('message', (e) => {
    if (allowed.indexOf(e.origin) < 0) return;
    const m = e.data;
    if (!m || m.type !== 'rs-qsy' || !bc) return;
    const freq = Number(m.freq);
    if (!(freq > 0)) return;
    const mode = String(m.mode || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10);
    const call = String(m.call || '').toUpperCase().replace(/[^A-Z0-9/]/g, '').slice(0, 15);
    dashSeen = 0;
    bc.postMessage({ type: 'rs-qsy', freq, mode, call, from: e.origin, at: Date.now() });
    // Réponse au site : le dashboard a-t-il répondu (onglet ouvert dans ce navigateur) ?
    setTimeout(() => { if (e.source) e.source.postMessage({ type: 'rs-qsy-ack', ok: Date.now() - dashSeen < 1000 }, e.origin); }, 400);
  });
})();
