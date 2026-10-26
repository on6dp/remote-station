/*
 * rs-qsy-client.js — à inclure dans un site de DX cluster (dx.op0p.be, cluster.op0p.be) :
 *   <script src="https://remote.op0p.be/js/rs-qsy-client.js"></script>
 * puis, au clic sur un spot :
 *   window.remoteStationQsy(14074.0, 'FT8', 'DL1ABC')      // fréquence en kHz, mode, indicatif
 * Le spot passe par un relais invisible (iframe /qsy.html de la Remote Station) au dashboard ouvert dans ce même
 * navigateur ; le dashboard ne l'applique que si son utilisateur a la main (règles habituelles).
 * Le site du cluster doit être autorisé (qsyOrigins dans config.json du serveur) et servi en https.
 */
(function () {
  'use strict';
  const me = document.currentScript && document.currentScript.src;
  const RS = me ? new URL(me).origin : 'https://remote.op0p.be';
  let fr = null, ready = false;
  const queue = [];
  function relay() {
    if (fr || !document.body) return;
    fr = document.createElement('iframe');
    fr.src = RS + '/qsy.html';
    fr.title = 'Remote Station';
    fr.setAttribute('aria-hidden', 'true');
    fr.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(fr);
  }
  window.addEventListener('message', (e) => {
    if (e.origin !== RS || !e.data) return;
    if (e.data.type === 'rs-qsy-ready') { ready = true; queue.splice(0).forEach((m) => fr.contentWindow.postMessage(m, RS)); }
    if (e.data.type === 'rs-qsy-ack' && typeof window.onRemoteStationAck === 'function') window.onRemoteStationAck(!!e.data.ok);
  });
  window.remoteStationQsy = function (freqKhz, mode, call) {
    const m = { type: 'rs-qsy', freq: Number(freqKhz), mode: String(mode || ''), call: String(call || '') };
    relay();
    if (ready && fr) fr.contentWindow.postMessage(m, RS);
    else queue.push(m);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', relay);
  else relay();
})();
