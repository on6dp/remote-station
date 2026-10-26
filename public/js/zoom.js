/*
 * zoom.js — taille du dashboard adaptée à l'écran.
 * Le dashboard est dessiné pour un écran 1920 × 1080. Sur un écran plus grand (2560 × 1440, 4K…), « Auto » agrandit
 * tout dans la même proportion pour remplir l'écran, sans rien déplacer ; on peut aussi choisir la taille soi-même.
 * Réglage gardé dans ce navigateur. Sur un écran plus petit que 1920, la mise en page s'adapte déjà toute seule
 * (et Ctrl + / Ctrl − de Chrome reste possible).
 */
(function () {
  'use strict';
  const KEY = 'rs_zoom';
  const REF_W = 1920, REF_H = 1000;   // place utile d'un écran 1920 × 1080 dans Chrome
  const MIN_W = 1800, MIN_H = 860;    // en dessous, la mise en page « grand écran » ne tient plus
  const CHOICES = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.33, 1.5, 1.75, 2];
  const ZMIN = 0.5, ZMAX = 2;
  let pref = 'auto';
  try { pref = localStorage.getItem(KEY) || 'auto'; } catch (e) { /* stockage bloqué */ }
  let cur = 1;

  // Plus grand agrandissement qui garde la place de la mise en page grand écran
  function maxZoom() {
    return Math.max(1, Math.min(window.innerWidth / MIN_W, window.innerHeight / MIN_H));
  }
  function autoZoom() {
    const z = Math.min(window.innerWidth / REF_W, window.innerHeight / REF_H);
    return z < 1.05 ? 1 : Math.floor(z * 20) / 20;
  }
  function apply() {
    let z = pref === 'auto' ? Math.max(1, Math.min(autoZoom(), maxZoom())) : Number(pref) || 1;
    z = Math.max(ZMIN, Math.min(ZMAX, z)); // choix manuel : de 50 à 200 %, même si cela dépasse l'écran
    z = Math.round(z * 100) / 100;
    const changed = z !== cur;
    cur = z;
    const root = document.documentElement;
    root.style.zoom = z === 1 ? '' : String(z);
    root.style.setProperty('--zoom', String(z));
    label();
    if (changed) window.dispatchEvent(new Event('resize')); // cascades et carte de bande redimensionnées
  }
  function label() {
    const b = document.getElementById('zoomBtn');
    if (!b) return;
    b.textContent = (pref === 'auto' ? 'Auto ' : '') + Math.round(cur * 100) + ' %';
    const m = document.getElementById('zoomMenu');
    if (!m) return;
    const mx = maxZoom();
    const inf = document.getElementById('zoomInfo');
    if (inf) {
      // devicePixelRatio = mise à l'échelle de Windows (Paramètres › Affichage › Échelle) × zoom de Chrome (Ctrl + / Ctrl −)
      const dpr = window.devicePixelRatio || 1;
      const sw = Math.round(window.screen.width * dpr), sh = Math.round(window.screen.height * dpr);
      const za = Math.round(Math.max(1, Math.min(autoZoom(), mx)) * 100);
      const win = Math.round(dpr * 100);
      let t = 'Votre écran : ' + sw + ' × ' + sh + '.';
      if (win > 102) t += ' Windows (échelle d’affichage) ou Chrome agrandit déjà à ' + win + ' % ; Auto ajoute ' + za + ' %, soit environ ' + Math.round(win * za / 100) + ' % en tout.';
      else t += ' Auto = ' + za + ' %' + (za === 100 && sh <= 1200 ? ' (la hauteur décide : ' + sh + ' de haut, comme un écran 1920 × 1080).' : '.');
      inf.textContent = t;
    }
    m.querySelectorAll('button').forEach((x) => {
      x.setAttribute('aria-checked', String(x.dataset.z === String(pref)));
      // au-delà de ce que l'écran permet sans serrer la mise en page : signalé, mais permis
      x.classList.toggle('zoom-big', x.dataset.z !== 'auto' && Number(x.dataset.z) > mx + 0.001);
    });
  }
  function set(v) {
    pref = v === 'auto' ? 'auto' : String(v);
    try { localStorage.setItem(KEY, pref); } catch (e) { /* stockage bloqué */ }
    apply();
  }
  function build() {
    const help = document.getElementById('helpBtn');
    if (!help || document.getElementById('zoomBtn')) return;
    const wrap = document.createElement('span');
    wrap.className = 'dxc-wrap zoom-wrap';
    wrap.innerHTML = '<button class="btn zoom-btn" id="zoomBtn" type="button" aria-haspopup="true" aria-expanded="false"'
      + ' title="Taille du dashboard : Auto = adaptée à l’écran (agrandie sur un écran plus grand que 1920 × 1080) ; 50 à 200 % au choix"></button>'
      + '<span class="dxc-menu zoom-menu" id="zoomMenu" role="menu" hidden></span>';
    help.parentNode.insertBefore(wrap, help);
    const m = wrap.querySelector('#zoomMenu');
    const add = (z, txt, sub) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitemradio');
      b.dataset.z = String(z);
      b.innerHTML = '<span></span><small></small>';
      b.firstChild.textContent = txt;
      b.lastChild.textContent = sub || '';
      m.appendChild(b);
    };
    // Écran de ce PC et taille choisie par Auto (la hauteur décide : 1080 de haut = 100 %, même en 2560 × 1080)
    const info = document.createElement('div');
    info.className = 'zoom-info';
    info.id = 'zoomInfo';
    m.appendChild(info);
    add('auto', 'Auto', 'adaptée à l’écran');
    for (const z of CHOICES) add(z, Math.round(z * 100) + ' %', z === 1 ? 'taille d’origine' : z === 0.67 ? 'portable : tout voir' : '');
    const btn = wrap.querySelector('#zoomBtn');
    const show = (on) => { m.hidden = !on; btn.setAttribute('aria-expanded', String(on)); if (on) label(); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); show(m.hidden); });
    m.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      set(b.dataset.z);
      show(false);
    });
    document.addEventListener('click', (e) => { if (!m.hidden && !e.target.closest('.zoom-wrap')) show(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') show(false); });
    label();
  }
  let t = 0;
  window.addEventListener('resize', (e) => {
    if (!e.isTrusted) return; // notre propre signal après un changement de taille
    clearTimeout(t);
    t = setTimeout(apply, 150);
  });
  window.RSZOOM = { z: () => cur, set };
  apply();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
