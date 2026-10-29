/*
 * window.js — dashboard dans une fenêtre autonome.
 * « ⧉ Fenêtre » : le dashboard se rouvre dans sa propre fenêtre, sans barre d'adresse ni onglets, à placer où l'on veut
 * (2e écran…) ; sa position et sa taille sont gardées dans ce navigateur et reprises à la prochaine ouverture.
 * L'onglet d'origine affiche alors « Dashboard ouvert dans sa fenêtre autonome » (/detache.html), avec « Ramener ici ».
 * « ⤓ Installer » (Chrome / Edge) : installe Remote Station comme une application (icône sur le bureau, fenêtre à part).
 */
(function () {
  'use strict';
  const NAME = 'rsDash';
  const KEY = 'rs.win';
  const POP = window.name === NAME || /[?&]win=1\b/.test(location.search);
  const APP = !!(window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches));
  let deferred = null;
  const $ = (id) => document.getElementById(id);
  function say(t, cls) {
    const m = $('msg');
    if (!m) return;
    m.textContent = t;
    m.className = 'msg' + (cls ? ' ' + cls : '');
    setTimeout(() => { if (m.textContent === t) { m.textContent = ''; m.className = 'msg'; } }, 8000);
  }
  function geom() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function saveGeom() {
    if (!POP || window.innerWidth < 300) return;
    try { localStorage.setItem(KEY, JSON.stringify({ x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight })); } catch (e) { /* stockage bloqué */ }
  }
  function openWin() {
    const s = window.screen || {};
    const g = geom() || { x: s.availLeft || 0, y: s.availTop || 0, w: Math.min(s.availWidth || 1920, 1920), h: Math.min((s.availHeight || 1040) - 40, 1040) };
    const w = window.open('/?win=1', NAME, 'popup=yes,width=' + Math.round(g.w) + ',height=' + Math.round(g.h) + ',left=' + Math.round(g.x) + ',top=' + Math.round(g.y));
    if (!w) return say('Chrome a bloqué la fenêtre : autorisez les fenêtres pop-up pour ce site (icône à droite de la barre d’adresse → Toujours autoriser), puis recliquez.', 'warn');
    // Cet onglet n'affiche plus le dashboard (une seule connexion, pas de double son)
    location.replace('/detache.html');
  }
  function build() {
    const help = $('helpBtn');
    if (!help || $('winBtn')) return;
    const b = document.createElement('button');
    b.className = 'btn win-btn';
    b.id = 'winBtn';
    b.type = 'button';
    b.textContent = '⧉ Fenêtre';
    b.title = 'Ouvrir tout le dashboard dans sa propre fenêtre, sans barre d’adresse, à placer où vous voulez (2e écran…) ; position et taille retenues';
    b.hidden = POP || APP;
    b.addEventListener('click', openWin);
    help.parentNode.insertBefore(b, help);
    const i = document.createElement('button');
    i.className = 'btn win-btn';
    i.id = 'installBtn';
    i.type = 'button';
    i.textContent = '⤓ Installer';
    i.title = 'Installer Remote Station comme une application (Chrome / Edge) : icône sur le bureau, fenêtre à part';
    i.hidden = true;
    i.addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      try { await deferred.userChoice; } catch (e) { /* */ }
      deferred = null;
      i.hidden = true;
    });
    help.parentNode.insertBefore(i, help);
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    build();
    if ($('installBtn')) $('installBtn').hidden = APP;
  });
  window.addEventListener('appinstalled', () => { deferred = null; if ($('installBtn')) $('installBtn').hidden = true; say('Remote Station est installée : icône sur le bureau et dans le menu Démarrer.', 'ok'); });
  if (POP) {
    document.documentElement.classList.add('win-pop');
    let t = 0;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(saveGeom, 400); });
    setInterval(saveGeom, 3000); // déplacement de la fenêtre (pas d'événement pour cela)
    window.addEventListener('beforeunload', saveGeom);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
  window.RSWIN = { pop: POP, app: APP, open: openWin };
})();
