/*
 * rs-qsy-client.js — à inclure dans un site de DX cluster (dx.op0p.be, cluster.op0p.be) :
 *   <script src="https://remote.op0p.be/js/rs-qsy-client.js"></script>
 * puis, au clic sur un spot :
 *   window.remoteStationQsy(14074.0, 'FT8', 'DL1ABC')      // fréquence en kHz, mode, indicatif
 * Le spot passe par un relais invisible (iframe /qsy.html de la Remote Station) au dashboard ouvert dans ce même
 * navigateur ; le dashboard ne l'applique que si son utilisateur a la main (règles habituelles).
 * Pour les membres de la Remote Station (déjà connectés au dashboard dans ce navigateur), un badge indique
 * « Remote Station <-> DX Cluster » : <-> vert = dashboard ouvert avec la main, rouge sinon ; après un clic, il dit si
 * le TRX s'est calé. Rien n'est affiché pour les autres visiteurs. Le badge se place dans l'élément id="rs-qsy-badge"
 * s'il existe (ex. colonne Alert / Show Only / Hide de dx.op0p.be), sinon en bas à droite de la page.
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
  const BASE = 'background:rgba(11,16,24,.94);color:#e8eef7;border:1px solid #2c3b50;border-radius:8px;'
    + 'font:700 15px/1.4 system-ui,Segoe UI,Arial,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.45);cursor:default;user-select:none;';
  // Dans l'emplacement prévu par le site (pleine largeur) ou, à défaut, en bas à droite de la page
  function place() {
    if (!badge || !document.body) return;
    const host = document.getElementById('rs-qsy-badge');
    if (host) {
      if (badge.parentNode !== host) host.appendChild(badge);
      badge.style.cssText = BASE + 'position:static;display:block;width:100%;box-sizing:border-box;padding:9px 6px;margin:0 0 10px;text-align:center;font-size:14px';
    } else {
      if (badge.parentNode !== document.body) document.body.appendChild(badge);
      badge.style.cssText = BASE + 'position:fixed;right:14px;bottom:14px;z-index:2147483000;padding:8px 14px;max-width:360px';
    }
  }
  function mkBadge() {
    if (!badge) {
      badge = document.createElement('div');
      badge.setAttribute('role', 'status');
      const line = document.createElement('div');
      line.style.cssText = 'white-space:nowrap;letter-spacing:.2px';
      line.append('Remote Station ');
      arrow = document.createElement('b');
      arrow.textContent = '<->';
      arrow.style.cssText = 'color:#ef4444;margin:0 4px;font-size:19px;vertical-align:-1px';
      line.append(arrow, ' DX Cluster');
      note = document.createElement('div');
      note.style.cssText = 'font-weight:600;font-size:13px;color:#9fb0c6;display:none;margin-top:3px;white-space:normal';
      badge.append(line, note);
    }
    place(); // la page peut avoir reconstruit sa colonne (application React) : on se remet dedans
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
