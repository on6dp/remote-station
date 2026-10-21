/*
 * panels.js — disposition personnalisable du dashboard.
 *
 * 1. Écran large (1920 × 1080 et plus) : les messages pré-enregistrés passent dans la 4e colonne,
 *    sous les opérateurs, pour laisser toute la hauteur au centre (voir rp.css).
 * 2. Chaque cadre (data-panel) peut être détaché dans sa propre fenêtre (bouton ⧉) et ramené.
 *    Le cadre est déplacé tel quel dans la fenêtre (même page, mêmes commandes) : tout continue
 *    de fonctionner. La disposition (cadres détachés, position et taille des fenêtres) est mémorisée
 *    et rétablie au prochain chargement si Chrome autorise les fenêtres pop-up pour ce site.
 * Les recherches d'éléments d'app.js et digi.js passent par RSPANELS.find() pour trouver aussi
 * les éléments des fenêtres détachées.
 */
(function () {
  'use strict';
  const NAMES = {
    ant: 'Antenne', rf: 'RF front end', mode: 'Mode', filter: 'Filtre', meters: 'Station meters', vfo: 'VFO', bands: 'Step et bandes',
    audio: 'RX audio', dsp: 'DSP', tune: 'Accord (tuner)', tx: 'TX', ops: 'Opérateurs', msgs: 'Messages pré-enregistrés'
  };
  const store = {
    get() { try { return JSON.parse(localStorage.getItem('rs.detached') || '{}') || {}; } catch (e) { return {}; } },
    set(v) { try { localStorage.setItem('rs.detached', JSON.stringify(v)); } catch (e) {} }
  };
  const open = new Map(); // clé → { win, el, ph }
  let say = () => {};

  // ------------------------------------------------------------------ recherche dans toutes les fenêtres
  function find(id) {
    for (const o of open.values()) {
      if (o.win && !o.win.closed) {
        const el = o.win.document.getElementById(id);
        if (el) return el;
      } else if (o.el) {
        // Fenêtre en train de se fermer : le cadre revient au prochain contrôle ; on écrit dans le cadre lui-même
        const el = o.el.id === id ? o.el : o.el.querySelector('#' + CSS.escape(id));
        if (el) return el;
      }
    }
    return null;
  }
  function all(sel) {
    const out = Array.from(document.querySelectorAll(sel));
    for (const o of open.values()) if (o.win && !o.win.closed) out.push(...o.win.document.querySelectorAll(sel));
    return out;
  }

  // ------------------------------------------------------------------ messages dans la 4e colonne (écran large)
  const WIDE = window.matchMedia('(min-width: 1800px) and (min-height: 860px)');
  const msgs = document.getElementById('msgs');
  const msgsHome = document.createComment('place des messages pré-enregistrés');
  if (msgs) msgs.before(msgsHome);
  function placeMsgs() {
    if (!msgs || open.has('msgs')) return;
    const far = document.querySelector('.side-far');
    if (WIDE.matches && far) { if (msgs.parentElement !== far) far.appendChild(msgs); }
    else if (msgs.previousSibling !== msgsHome) msgsHome.after(msgs);
  }
  WIDE.addEventListener('change', placeMsgs);

  // ------------------------------------------------------------------ fenêtres détachées
  function geometry(el, saved) {
    if (saved && saved.w) return saved;
    const r = el.getBoundingClientRect();
    return { w: Math.max(260, Math.round(r.width) + 24), h: Math.max(160, Math.round(r.height) + 60), x: window.screenX + Math.round(r.left) + 40, y: window.screenY + Math.round(r.top) + 60 };
  }
  // La fenêtre (about:blank, même origine) est préparée par le DOM : feuilles de style, titre, surveillance du dashboard
  function skeleton(win, key) {
    const doc = win.document;
    doc.title = (NAMES[key] || key) + ' — Remote Station';
    if (!doc.body) doc.documentElement.appendChild(doc.createElement('body'));
    doc.body.textContent = '';
    doc.body.className = 'panel-popup';
    doc.documentElement.lang = 'fr';
    for (const f of ['rp-tokens.css', 'rp.css']) {
      if (doc.querySelector('link[data-rs="' + f + '"]')) continue;
      const l = doc.createElement('link');
      l.rel = 'stylesheet';
      l.href = location.origin + '/css/' + f;
      l.dataset.rs = f;
      doc.head.appendChild(l);
    }
    if (!doc.querySelector('script[data-rs]')) {
      // Dashboard fermé : la fenêtre se ferme toute seule
      const sc = doc.createElement('script');
      sc.dataset.rs = '1';
      sc.textContent = 'setInterval(function(){try{if(!opener||opener.closed)window.close();}catch(e){window.close();}},2000);';
      doc.head.appendChild(sc);
    }
  }
  function detach(key, quiet) {
    if (open.has(key)) return;
    const el = document.querySelector('[data-panel="' + key + '"]');
    if (!el) return;
    const saved = store.get()[key];
    const g = geometry(el, saved);
    const win = window.open('', 'rs-panel-' + key, 'popup,width=' + g.w + ',height=' + g.h + ',left=' + g.x + ',top=' + g.y);
    if (!win) {
      if (!quiet) say('Fenêtre bloquée par Chrome : autorisez les fenêtres pop-up pour ce site (icône à droite de la barre d’adresse).', 'warn', 8000);
      return false;
    }
    skeleton(win, key);
    const ph = document.createElement('div');
    ph.className = 'panel detached-ph';
    ph.dataset.ph = key;
    ph.innerHTML = '<span>⧉ ' + (NAMES[key] || key) + ' : fenêtre séparée</span>';
    const back = document.createElement('button');
    back.className = 'btn';
    back.type = 'button';
    back.textContent = 'Ramener';
    back.addEventListener('click', () => attach(key));
    ph.appendChild(back);
    el.before(ph);
    try {
      win.document.body.appendChild(win.document.adoptNode(el));
    } catch (e) {
      // Échec (fenêtre fermée entre-temps…) : le cadre reste dans le dashboard
      if (!el.isConnected || el.ownerDocument !== document) document.adoptNode(el);
      ph.replaceWith(el);
      try { win.close(); } catch (x) {}
      return false;
    }
    const o = { win, el, ph };
    open.set(key, o);
    setButton(el, true);
    forwardKeys(win);
    win.addEventListener('pagehide', () => setTimeout(() => { if (open.get(key) === o) attach(key); }, 50));
    const all2 = store.get();
    all2[key] = g;
    store.set(all2);
    return true;
  }
  function attach(key, keepSaved) {
    const o = open.get(key);
    if (!o) return;
    open.delete(key);
    const el = document.adoptNode(o.el);
    o.ph.replaceWith(el);
    setButton(el, false);
    if (key === 'msgs') placeMsgs();
    if (!keepSaved) { const s = store.get(); delete s[key]; store.set(s); }
    try { if (!o.win.closed) o.win.close(); } catch (e) {}
  }
  // Barre d'espace (PTT) et flèches depuis une fenêtre détachée : transmises au dashboard (sauf en saisie)
  function forwardKeys(win) {
    const fwd = (type) => (e) => {
      const t = e.target;
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName) && t.type !== 'range') return;
      if (e.code !== 'Space' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      document.dispatchEvent(new KeyboardEvent(type, { key: e.key, code: e.code, repeat: e.repeat, bubbles: true }));
    };
    win.document.addEventListener('keydown', fwd('keydown'));
    win.document.addEventListener('keyup', fwd('keyup'));
  }
  // Suivi : fenêtre fermée par l'utilisateur, position et taille mémorisées
  setInterval(() => {
    const s = store.get();
    let changed = false;
    for (const [key, o] of open) {
      if (o.win.closed) { attach(key); continue; }
      const g = { x: o.win.screenX, y: o.win.screenY, w: o.win.outerWidth, h: o.win.outerHeight };
      const p = s[key] || {};
      if (g.w > 0 && (p.x !== g.x || p.y !== g.y || p.w !== g.w || p.h !== g.h)) { s[key] = g; changed = true; }
    }
    if (changed) store.set(s);
  }, 1000);
  // Dashboard fermé ou rechargé : les cadres reviennent (les fenêtres se ferment) mais la disposition reste mémorisée
  window.addEventListener('pagehide', () => { for (const key of Array.from(open.keys())) attach(key, true); });

  // ------------------------------------------------------------------ boutons ⧉
  function setButton(el, detached) {
    const b = el.querySelector('.detach-btn');
    if (!b) return;
    b.textContent = detached ? '⧉ Ramener' : '⧉';
    b.title = detached ? 'Remettre ce cadre dans le dashboard' : 'Ouvrir ce cadre dans une fenêtre séparée';
  }
  function addButtons() {
    document.querySelectorAll('[data-panel]').forEach((el) => {
      const key = el.dataset.panel;
      if (el.querySelector('.detach-btn')) return;
      const b = document.createElement('button');
      b.className = 'detach-btn';
      b.type = 'button';
      b.addEventListener('click', (e) => {
        e.stopPropagation(); // ne pas replier le cadre
        if (open.has(key)) attach(key); else detach(key);
      });
      const host = el.querySelector(':scope > .panel-h, :scope > .msgs-h, :scope > .toolbar') || el;
      if (host === el) b.classList.add('floating');
      host.appendChild(b);
      setButton(el, false);
    });
  }

  window.RSPANELS = {
    find,
    all,
    init(opts) {
      say = (opts && opts.say) || say;
      addButtons();
      placeMsgs();
      // Disposition mémorisée : on rouvre les cadres détachés (possible si les pop-ups sont autorisées)
      const saved = store.get();
      let blocked = false;
      for (const key of Object.keys(saved)) if (detach(key, true) === false) blocked = true;
      if (blocked) say('Vos cadres détachés n’ont pas pu être rouverts : autorisez les fenêtres pop-up pour ce site, puis rechargez la page.', 'warn', 9000);
    }
  };
})();
