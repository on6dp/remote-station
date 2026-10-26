/*
 * rs-qsy-client.js — à inclure dans un site de DX cluster (dx.op0p.be, cluster.op0p.be) :
 *   <script src="https://remote.op0p.be/js/rs-qsy-client.js"></script>
 * puis, au clic sur un spot :
 *   window.remoteStationQsy(14074.0, 'FT8', 'DL1ABC')      // fréquence en kHz, mode, indicatif
 * Le spot passe par un relais invisible (iframe /qsy.html de la Remote Station) au dashboard ouvert dans ce même
 * navigateur ; le dashboard ne l'applique que si son utilisateur a la main (règles habituelles).
 * Pour les membres de la Remote Station (déjà connectés au dashboard dans ce navigateur), un petit badge en bas à
 * droite indique « Remote Station <-> DX Cluster » : <-> vert = dashboard ouvert avec la main, rouge sinon ; après un
 * clic, il dit si le TRX s'est calé. Rien n'est affiché pour les autres visiteurs.
 * Le site du cluster doit être autorisé (qsyOrigins dans config.json du serveur) et servi en https.
 */
(function () {
  'use strict';
  const me = document.currentScript && document.currentScript.src;
  const RS = me ? new URL(me).origin : 'https://remote.op0p.be';
  let fr = null, ready = false, badge = null, arrow = null, note = null, noteT = 0, linked = false;
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
  function mkBadge() {
    if (badge) return;
    badge = document.createElement('div');
    badge.setAttribute('role', 'status');
    badge.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483000;background:rgba(11,16,24,.92);color:#dfe7f2;'
      + 'border:1px solid #2c3b50;border-radius:6px;padding:5px 10px;font:600 12px/1.35 system-ui,Segoe UI,Arial,sans-serif;'
      + 'box-shadow:0 2px 8px rgba(0,0,0,.4);max-width:320px;cursor:default;user-select:none';
    const line = document.createElement('div');
    line.append('Remote Station ');
    arrow = document.createElement('b');
    arrow.textContent = '<->';
    arrow.style.cssText = 'color:#ef4444;margin:0 2px';
    line.append(arrow, ' DX Cluster');
    note = document.createElement('div');
    note.style.cssText = 'font-weight:400;font-size:11px;color:#9fb0c6;display:none';
    badge.append(line, note);
    document.body.appendChild(badge);
  }
  function setLinked(on, dash) {
    linked = on;
    if (!badge) return;
    arrow.style.color = on ? '#22c55e' : '#ef4444';
    badge.title = on ? 'Liaison active : un clic sur la fréquence d’un spot cale le TRX de la Remote Station'
      : dash ? 'Dashboard de la Remote Station ouvert, mais sans la main : prenez la main pour que les spots calent le TRX'
        : 'Dashboard de la Remote Station non ouvert dans ce navigateur (ou sans connexion)';
  }
  function say(t, color) {
    if (!badge) return;
    note.textContent = t;
    note.style.color = color || '#9fb0c6';
    note.style.display = 'block';
    clearTimeout(noteT);
    noteT = setTimeout(() => { note.style.display = 'none'; }, 5000);
  }
  window.addEventListener('message', (e) => {
    if (e.origin !== RS || !e.data) return;
    const d = e.data;
    if (d.type === 'rs-qsy-ready') {
      ready = true;
      fr.contentWindow.postMessage({ type: 'rs-qsy-hello' }, RS); // le relais apprend l'adresse de ce site
      queue.splice(0).forEach((m) => fr.contentWindow.postMessage(m, RS));
    }
    if (d.type === 'rs-qsy-status') {
      if (d.member) mkBadge();
      setLinked(!!d.control, !!d.dash);
    }
    if (d.type === 'rs-qsy-ack') {
      if (d.reason === 'ok') say('TRX calé sur le spot', '#22c55e');
      else if (d.reason === 'nocontrol') say('Prenez la main sur le dashboard de la Remote Station', '#f59e0b');
      else say('Dashboard de la Remote Station non ouvert dans ce navigateur', '#ef4444');
      if (typeof window.onRemoteStationAck === 'function') window.onRemoteStationAck(!!d.ok, d.reason);
    }
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
