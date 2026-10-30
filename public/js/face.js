/*
 * face.js — page « Face avant » (ex. https://remote.op0p.be/ftdx101) : la photo de la face avant du TRX, avec une zone
 * cliquable sur chaque touche et chaque bouton rotatif ; chaque touche fait la même chose que sur le TRX, par les mêmes
 * commandes que le dashboard (même serveur, mêmes droits, mêmes sécurités). L'écran du TRX est recouvert par un affichage
 * vivant : fréquences, modes, mètres, ANT / ATT / IPO / R.FIL / AGC, réglages DSP ; le spectre de l'écoute (prise PHONES)
 * remplace le scope, qui ne passe pas par la liaison CAT.
 *
 * Description de chaque face avant : faces/<modèle>.js (positions en pixels de la photo). ?zones=1 montre les zones.
 * Le dashboard (/) reste la page principale : cette page est une autre façon de piloter, à côté.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const MODEL = (location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || 'ftdx101').toLowerCase();
  const FACE = (window.RS_FACES || {})[MODEL];
  const R = (window.RIGS || {})[MODEL];
  const ZONES = /[?&]zones=1/.test(location.search);
  // Partie de la photo affichée (face avant seule) : les positions restent celles de la photo d'origine
  const V = FACE ? (FACE.img || { x: 0, y: 0, w: FACE.w, h: FACE.h }) : { x: 0, y: 0, w: 1, h: 1 };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage bloqué */ } }
  };

  // ------------------------------------------------------------ état
  let ws = null, me = null, st = null, creds = null, retry = 0, lastMsg = 0;
  const pend = {};                       // réglage → { v, at } : affichage immédiat, avant la relecture du TRX
  const pendF = { A: null, B: null, atA: 0, atB: 0 };
  const sendTimers = {};
  const BANDS = [['160M', 1.8e6, 2.0e6], ['80M', 3.5e6, 4.0e6], ['60M', 5.25e6, 5.45e6], ['40M', 7.0e6, 7.3e6], ['30M', 10.1e6, 10.15e6],
    ['20M', 14.0e6, 14.35e6], ['17M', 18.068e6, 18.168e6], ['15M', 21.0e6, 21.45e6], ['12M', 24.89e6, 24.99e6], ['10M', 28.0e6, 29.7e6],
    ['6M', 50e6, 54e6], ['4M', 70e6, 70.5e6]];
  const L = {
    fast: store.get('rs.face.fast', '0') === '1',
    fine: store.get('rs.face.fine', '0') === '1',
    listening: false,
    bandOf(hz) { const b = BANDS.find((x) => hz >= x[1] && hz <= x[2]); return b ? b[0] : ''; },
    activeMode(s) { return (s.vfoSel === 1 ? s.modeB : s.mode) || ''; }
  };
  function S() {
    const s = Object.assign({}, (st && st.radio) || {});
    const now = Date.now();
    for (const k in pend) { if (now - pend[k].at < 1500) s[k] = pend[k].v; else delete pend[k]; }
    if (pendF.A != null && now - pendF.atA < 1500) s.freq = pendF.A;
    if (pendF.B != null && now - pendF.atB < 1500) s.freqB = pendF.B;
    return s;
  }
  const iControl = () => !!(st && me && st.controllerCid != null && st.controllerCid === me.cid);
  const otherTab = () => !!(st && me && st.controller === me.call && st.controllerCid !== me.cid);

  // ------------------------------------------------------------ messages
  let msgTimer = 0;
  function say(t, cls, ms) {
    const m = $('msg');
    m.textContent = t || '';
    m.className = 'fc-msg' + (cls ? ' ' + cls : '');
    clearTimeout(msgTimer);
    if (t && ms !== 0) msgTimer = setTimeout(() => { m.textContent = ''; m.className = 'fc-msg'; }, ms || 5000);
  }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  function needControl() {
    if (iControl()) return true;
    say(st && st.controller && !otherTab() ? st.controller + ' a la main : demandez-la, ou attendez qu’elle soit libre.' : 'Prenez d’abord la main (bouton en haut à droite).', 'warn');
    const b = $('ctrlBtn');
    b.classList.remove('fc-pulse'); void b.offsetWidth; b.classList.add('fc-pulse');
    return false;
  }

  // ------------------------------------------------------------ commandes vers le TRX
  function setCtl(id, v) {
    if (!needControl()) return;
    const c = R && R.CONTROL[id];
    if (!c) return say('Commande non disponible sur ce TRX.', 'warn');
    let val = v;
    try { val = R.validate(id, v, S()); } catch (e) { return say(e.message, 'warn'); }
    if (c.type !== 'action') pend[id] = { v: val, at: Date.now() };
    clearTimeout(sendTimers[id]);
    sendTimers[id] = setTimeout(() => send({ t: 'set', ctl: id, value: val }), c.type === 'level' || c.type === 'width' ? 90 : 0);
    render();
  }
  function tuneTo(side, hz) {
    if (!needControl()) return;
    hz = Math.round(Math.max(R.FREQ_MIN || 30000, Math.min(R.FREQ_MAX || 75e6, hz)));
    if (side === 'B') { pendF.B = hz; pendF.atB = Date.now(); } else { pendF.A = hz; pendF.atA = Date.now(); }
    if (!sendTimers.freq) {
      sendTimers.freq = setTimeout(() => {
        sendTimers.freq = 0;
        const m = { t: 'set' };
        if (pendF.A != null && Date.now() - pendF.atA < 1500) m.freq = pendF.A;
        if (pendF.B != null && Date.now() - pendF.atB < 1500) m.freqB = pendF.B;
        send(m);
      }, 70);
    }
    render();
  }
  const activeSide = () => (S().vfoSel === 1 ? 'B' : 'A');
  function setMode(name) {
    if (!needControl()) return;
    const code = Object.keys(R.MODES).find((k) => R.MODES[k] === name);
    if (!code) return say('Mode ' + name + ' non disponible.', 'warn');
    send({ t: 'set', mode: code, sub: activeSide() === 'B' });
  }
  const CYCLE = ['LSB', 'USB', 'CW-U', 'CW-L', 'AM', 'FM', 'DATA-U', 'DATA-L', 'RTTY-L', 'RTTY-U', 'PSK'];
  function doAct(k, long) {
    const a = k.act || {};
    const s = S();
    if (a.info) return say(a.info, '', 6000);
    if (a.local === 'listen') return L.listening ? stopListen() : startListen();
    if (a.local === 'func') { L.func = !L.func; return render(); }
    if (a.local === 'vc') {
      // VC TUNE (présélecteur) du récepteur actif ; en marche, MULTI l'accorde
      const id = activeSide() === 'B' ? 'vcB' : 'vc';
      if (!R.CONTROL[id]) return say('VC TUNE : pas disponible sur ce TRX.', 'warn');
      if (!needControl()) return;
      const sk = id === 'vcB' ? 'vcOkB' : 'vcOk';
      if (s[sk] === 0) return say('VC TUNE : pas installé sur ce TRX (le TRX répond « non installé »).', 'warn', 5000);
      const on = s[id] ? 0 : 1;
      setCtl(id, on);
      say('VC TUNE ' + (id === 'vcB' ? 'SUB' : 'MAIN') + (on ? ' en marche (grande touche VC TUNE : l’accorder avec la bague du grand bouton).' : ' arrêté.'), '', 4000);
      return;
    }
    if (a.local === 'ringVc') {
      // Grande touche VC TUNE : la bague extérieure du grand bouton accorde le présélecteur (indépendant de sa mise en marche)
      L.ringVc = !L.ringVc;
      say(L.ringVc ? 'Bague du grand bouton : VC TUNE' + (s[activeSide() === 'B' ? 'vcB' : 'vc'] ? '.' : ' (mettez d’abord le VC TUNE en marche : petite touche VC TUNE).') : 'Bague du grand bouton : fréquence.', '', 4000);
      return render();
    }
    if (a.local === 'smenu') return L.smenu ? closeSmenu() : openSmenu();
    if (a.local === 'disp') {
      // Comme la touche DISP du TRX : 4 présentations de l'écran, l'une après l'autre
      L.disp = (L.disp + 1) % DISPS.length;
      store.set('rs.face.disp', String(L.disp));
      WF.drawn = false;
      say('DISP : ' + DISPS[L.disp] + ((L.disp === 1 || L.disp === 2) && !WF.two ? ' (SUB : bouton 🎧 Stéréo MAIN | SUB)' : ''), '', 3000);
      return render();
    }
    if (a.local === 'sync') {
      if (L.sync) { L.sync = false; say('SYNC coupé.', '', 2500); return render(); }
      if (!needControl()) return;
      const side = activeSide(), hz = side === 'B' ? s.freqB : s.freq;
      if (hz == null) return;
      tuneTo(side === 'B' ? 'A' : 'B', hz);
      L.sync = true;
      say('SYNC : les deux VFO sur ' + fmtFreq(hz) + ' ; le grand bouton les accorde ensemble.', '', 4000);
      return render();
    }
    if (a.local === 'mox') return L.mox ? pttUp() : (pttDown() ? (L.mox = true, render()) : null);
    if (a.local === 'moni') {
      const VX = window.RSVOICE;
      if (!VX || !VX.micOn()) return say('MONI = « M’écouter » : activez d’abord votre micro (Configuration micro, à droite de la face avant).', 'warn', 5000);
      VX.monitor(!VX.monitorOn());
      say(VX.monitorOn() ? 'MONI : vous entendez votre micro tel qu’il part (au casque).' : 'MONI coupé.', '', 3000);
      return render();
    }
    if (a.local === 'fast' || a.local === 'fine') {
      L[a.local] = !L[a.local];
      if (a.local === 'fine' && L.fine) L.fast = false;
      if (a.local === 'fast' && L.fast) L.fine = false;
      store.set('rs.face.fast', L.fast ? '1' : '0');
      store.set('rs.face.fine', L.fine ? '1' : '0');
      say(L.fine ? 'Accord fin : 10 Hz par cran.' : L.fast ? 'Accord rapide : 1 kHz par cran.' : 'Accord normal : 100 Hz par cran.', '', 2500);
      return render();
    }
    if (a.band) {
      if (!needControl()) return;
      return send({ t: 'set', band: a.band, sub: activeSide() === 'B' });
    }
    if (a.mode) {
      const cur = L.activeMode(s);
      const hz = activeSide() === 'B' ? s.freqB : s.freq;
      if (a.mode === 'ssb') return setMode(cur === 'LSB' ? 'USB' : cur === 'USB' ? 'LSB' : (hz && hz < 10e6 ? 'LSB' : 'USB'));
      if (a.mode === 'cw') return setMode(cur === 'CW-U' ? 'CW-L' : 'CW-U');
      const i = CYCLE.indexOf(cur);
      return setMode(CYCLE[(i + 1) % CYCLE.length]);
    }
    if (a.toggle) return setCtl(a.toggle, s[a.toggle] ? 0 : 1);
    if (a.set) return setCtl(a.set[0], a.set[1]);
    if (a.action) {
      if (a.action === 'tune' && !confirm('TUNE : le TRX émet quelques secondes pour accorder l’antenne. Continuer ?')) return;
      return setCtl(a.action, null);
    }
    if (a.toggleSel) return setCtl('vfoSel', s.vfoSel === 1 ? 0 : 1);
    if (a.clar) {
      if (long) return setCtl('clarClr', null);
      return setCtl('rit', s.rit ? 0 : 1);
    }
  }

  // ------------------------------------------------------------ dessin (SVG)
  const svg = $('face');
  function el(tag, attrs, parent, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  const LCD = {};
  const ledEls = [];   // { el, on(s,L), bright? }
  const keyEls = {};
  function build() {
    svg.setAttribute('viewBox', V.x + ' ' + V.y + ' ' + V.w + ' ' + V.h);
    svg.textContent = '';
    if (ZONES) svg.classList.add('zones');
    const defs = el('defs', {}, svg);
    const glow = el('filter', { id: 'glow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    el('feGaussianBlur', { stdDeviation: '2.2', result: 'b' }, glow);
    const mg = el('feMerge', {}, glow);
    el('feMergeNode', { in: 'b' }, mg);
    el('feMergeNode', { in: 'SourceGraphic' }, mg);
    const lg = el('linearGradient', { id: 'lcdbg', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    el('stop', { offset: '0', 'stop-color': '#0c1220' }, lg);
    el('stop', { offset: '1', 'stop-color': '#04060b' }, lg);
    el('image', { href: FACE.image, x: V.x, y: V.y, width: V.w, height: V.h }, svg);
    buildLcd();
    // Boutons rotatifs (sous les touches : une touche posée sur le bord du grand bouton reste cliquable)
    for (const k of FACE.knobs || []) {
      const g = el('g', { class: 'kn' + (k.dial ? ' dial' : ''), 'data-knob': k.id }, svg);
      el('circle', { cx: k.cx, cy: k.cy, r: k.ro, class: 'kn-o' }, g);
      if (k.ri) el('circle', { cx: k.cx, cy: k.cy, r: k.ri, class: 'kn-i' }, g);
      el('title', {}, g, k.tip || [k.inner && k.inner.label, k.outer && k.outer.label].filter(Boolean).join(' (centre) · ') + ' (bague) — molette ou glisser');
      knobEvents(g, k);
    }
    // Voyants des touches (sous les zones cliquables)
    const leds = el('g', { class: 'leds' }, svg);
    for (const k of FACE.keys) {
      if (k.led && k.lit) {
        // Touche éclairée comme sur le TRX (MAIN blanc, SUB bleu) : forme de la touche, fond plein et son nom
        const e = el('g', { class: 'lit' }, leds);
        el('path', { d: k.lit.d, fill: k.lit.bg, stroke: k.lit.edge || 'none', 'stroke-width': 1, 'stroke-linejoin': 'round' }, e);
        el('text', { x: k.lit.tx, y: k.lit.ty, fill: k.lit.fg, class: 'lit-t', 'text-anchor': 'middle' }, e, k.lit.label);
        ledEls.push({ el: e, on: k.led });
      } else if (k.led) {
        const e = k.r != null
          ? el('circle', { cx: k.cx, cy: k.cy, r: k.ledR || k.r + (k.ring ? 4 : 1), class: 'led' + (k.ring ? ' ring' : '') + (k.ledStrong ? ' strong' : ''), style: '--c:' + (k.ledColor || '#ffb020') }, leds)
          : el('rect', { x: k.x + 2, y: k.y + 2, width: k.w - 4, height: k.h - 4, rx: 4, class: 'led', style: '--c:' + (k.ledColor || '#ffb020') }, leds);
        ledEls.push({ el: e, on: k.led });
      }
      for (const d of k.leds || []) {
        const e = el('rect', { x: d.x, y: d.y, width: d.w, height: d.h, rx: 1.5, class: 'led bar', style: '--c:' + d.color }, leds);
        ledEls.push({ el: e, on: d.on, bright: d.bright });
      }
    }
    // Zones cliquables
    const hs = el('g', { class: 'hss' }, svg);
    for (const k of FACE.keys) {
      const e = k.r != null ? el('circle', { cx: k.cx, cy: k.cy, r: k.r, class: 'hs' }, hs)
        : el('rect', { x: k.x, y: k.y, width: k.w, height: k.h, rx: 4, class: 'hs' + (k.act && k.act.info ? ' off' : '') }, hs);
      el('title', {}, e, k.tip || k.id);
      keyEls[k.id] = e;
      keyEvents(e, k);
    }
    if (ZONES) {
      svg.addEventListener('pointermove', (e) => {
        const p = toImg(e);
        $('zoneInfo').textContent = ' · Zones : x ' + Math.round(p.x) + ', y ' + Math.round(p.y);
      });
    }
    // Spectre de l'écoute : à la place du scope du TRX
    const sc = FACE.lcd;
    const box = { x: sc.x + 5, y: sc.y + 170, w: sc.w - 10, h: 124 };
    const cv = $('scope');
    cv.style.left = ((box.x - V.x) / V.w * 100) + '%';
    cv.style.top = ((box.y - V.y) / V.h * 100) + '%';
    cv.style.width = (box.w / V.w * 100) + '%';
    cv.style.height = (box.h / V.h * 100) + '%';
    LCD.scopeBox = box;
    // S.MENU : SCOPE MENU posé sur le haut du scope (en HTML, au-dessus de la cascade, qui reste visible)
    const sm = document.createElement('div');
    sm.className = 'fc-smenu';
    sm.id = 'smenu';
    sm.hidden = true;
    sm.style.left = ((box.x + 22 - V.x) / V.w * 100) + '%';
    sm.style.top = ((box.y + 4 - V.y) / V.h * 100) + '%';
    sm.style.width = ((box.w - 44) / V.w * 100) + '%';
    sm.innerHTML = '<div class="fc-sm-t">SCOPE MENU</div><div class="fc-sm-row">' + SMENU.map((m) => '<button type="button" data-sm="' + m[0] + '" title="' + m[3] + '"><b>' + m[1] + '</b><i></i></button>').join('') + '</div>';
    $('facePanel').appendChild(sm);
    sm.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sm]');
      if (!b) return;
      const r = b.getBoundingClientRect();
      smAdjust(b.dataset.sm, b.dataset.sm === 'level' && e.clientX < r.left + r.width / 2 ? -1 : 1);
    });
    sm.addEventListener('wheel', (e) => {
      const b = e.target.closest('[data-sm]');
      if (!b) return;
      e.preventDefault();
      smAdjust(b.dataset.sm, e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    sm.addEventListener('pointerenter', () => { L.smHover = true; clearTimeout(L.smT); });
    sm.addEventListener('pointerleave', () => { L.smHover = false; smArm(); });
  }
  // SCOPE MENU (touche S.MENU) : comme sur le TRX, il se ferme seul 3 s après la dernière action
  const PEAKS = ['OFF', 'LV1', 'LV2', 'LV3'];
  const SMENU = [['spd', 'SPEED', () => WF_SPEEDS[L.wfSpeed][0], 'Vitesse de la cascade (clic : suivante ; molette)'],
    ['peak', 'PEAK', () => PEAKS[L.peak], 'Crêtes du spectre gardées un moment : OFF, LV1 (longtemps) … LV3 (brièvement)'],
    ['marker', 'MARKER', () => (L.marker ? 'ON' : 'OFF'), 'Bande passante du filtre et repère central sur le spectre'],
    ['color', 'COLOR', () => String(L.wfColor), 'Couleurs de la cascade : 1 rouge (comme le TRX), 2 bleu / violet, 3 arc-en-ciel'],
    ['level', 'LEVEL', () => (L.wfLevel >= 0 ? '+' : '') + L.wfLevel.toFixed(1) + 'dB', 'Niveau de la cascade : clic à gauche −, à droite + (ou molette)']];
  L.peak = Math.max(0, Math.min(3, Number(store.get('rs.face.peak', '0')) || 0));
  L.marker = store.get('rs.face.marker', '1') !== '0';
  function smAdjust(id, d) {
    if (id === 'spd') { L.wfSpeed = (L.wfSpeed + (d > 0 ? 1 : 3)) % 4; store.set('rs.face.wfspd', L.wfSpeed); }
    else if (id === 'peak') { L.peak = (L.peak + (d > 0 ? 1 : 3)) % 4; store.set('rs.face.peak', L.peak); WF.peak = {}; }
    else if (id === 'marker') { L.marker = !L.marker; store.set('rs.face.marker', L.marker ? '1' : '0'); }
    else if (id === 'color') { L.wfColor = ((L.wfColor - 1 + (d > 0 ? 1 : 2)) % 3) + 1; store.set('rs.face.wfcol', L.wfColor); }
    else if (id === 'level') { L.wfLevel = Math.max(-20, Math.min(20, L.wfLevel + d * 0.5)); store.set('rs.face.wflvl', L.wfLevel); }
    smDraw();
    render();
    smArm();
  }
  function smDraw() {
    const sm = $('smenu');
    if (!sm) return;
    for (const [id, , val] of SMENU) { const b = sm.querySelector('[data-sm="' + id + '"] i'); if (b) b.textContent = val(); }
  }
  function smArm() { clearTimeout(L.smT); if (!L.smHover) L.smT = setTimeout(closeSmenu, 3000); }
  function openSmenu() {
    const sm = $('smenu');
    if (!sm) return;
    L.smenu = true;
    L.func = false;
    // Taille du texte : suit la taille de la photo
    sm.style.fontSize = Math.max(8, Math.round($('facePanel').clientWidth / V.w * 11)) + 'px';
    smDraw();
    sm.hidden = false;
    smArm();
    render();
  }
  function closeSmenu() { clearTimeout(L.smT); L.smenu = false; L.smHover = false; const sm = $('smenu'); if (sm) sm.hidden = true; render(); }
  function toImg(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  }

  // Écran du TRX (positions relatives à FACE.lcd), dans le style de l'écran du FTDX101 :
  // deux galvanomètres (MAIN à gauche, SUB à droite) avec leur filtre, fréquences en 7 segments, ANT / ATT / IPO / R.FIL / AGC,
  // puis le spectre et la cascade (de la BF reçue : le scope du TRX ne passe pas par la liaison CAT)
  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g' };
  /** Chaîne « 14.074.000 » → chemin SVG en 7 segments penchés, aligné à droite sur xr ; h = hauteur des chiffres */
  function seg7(text, xr, y, h) {
    const w = h * 0.52, t = h * 0.13, sk = h * 0.12, gap = h * 0.24, dot = h * 0.3, g = t * 0.18;
    let x = xr, d = '';
    const P = (pts) => 'M' + pts.map((p) => (p[0] + sk * (1 - (p[1] - y) / h)).toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + 'Z';
    const H = (x0, x1, yy) => P([[x0 + g, yy], [x0 + t / 2 + g, yy - t / 2], [x1 - t / 2 - g, yy - t / 2], [x1 - g, yy], [x1 - t / 2 - g, yy + t / 2], [x0 + t / 2 + g, yy + t / 2]]);
    const Vt = (xx, y0, y1) => P([[xx, y0 + g], [xx + t / 2, y0 + t / 2 + g], [xx + t / 2, y1 - t / 2 - g], [xx, y1 - g], [xx - t / 2, y1 - t / 2 - g], [xx - t / 2, y0 + t / 2 + g]]);
    for (const ch of String(text).split('').reverse()) {
      if (ch === '.') {
        x -= dot;
        d += P([[x + dot * 0.2, y + h - t], [x + dot * 0.2 + t, y + h - t], [x + dot * 0.2 + t, y + h], [x + dot * 0.2, y + h]]);
        continue;
      }
      x -= w + gap;
      const L0 = x + t / 2, R0 = x + w - t / 2, T = y + t / 2, M = y + h / 2, B = y + h - t / 2;
      const segs = { a: H(L0, R0, T), g: H(L0, R0, M), d: H(L0, R0, B), f: Vt(L0, T, M), b: Vt(R0, T, M), e: Vt(L0, M, B), c: Vt(R0, M, B) };
      for (const k of SEG[ch] || '') d += segs[k];
    }
    return d || 'M0 0';
  }
  // Galvanomètre : arcs concentriques autour d'un pivot sous le cadran, aiguille rouge
  const ARC_SPAN = 19 * Math.PI / 180;
  function arcPt(cx, cy, r, f) { const a = -ARC_SPAN + 2 * ARC_SPAN * f; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; }
  function arcPath(cx, cy, r, f0, f1) {
    const p0 = arcPt(cx, cy, r, f0), p1 = arcPt(cx, cy, r, f1);
    return 'M' + p0[0].toFixed(1) + ' ' + p0[1].toFixed(1) + 'A' + r + ' ' + r + ' 0 0 1 ' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1);
  }
  const S_POS = (raw) => (raw == null ? 0 : raw <= 130 ? raw / 130 * 0.55 : Math.min(1, 0.55 + (raw - 130) / 125 * 0.45));
  function buildMeter(g, x0, y0, w, side) {
    const cx = x0 + w / 2 + 4, cy = y0 + 268, m = { cx, cy };
    el('rect', { x: x0, y: y0, width: w, height: 10, class: 'lcd-tbar' }, g);
    m.title = el('text', { x: cx, y: y0 + 8, class: 'lcd-ttl', 'text-anchor': 'middle' }, g, side === 'A' ? 'PO METER' : 'ALC METER');
    const scales = side === 'A'
      ? [['S', 244, [[0.05, '1'], [0.17, '3'], [0.29, '5'], [0.41, '7'], [0.55, '9'], [0.7, '+20', 1], [0.84, '+40', 1], [0.97, '+60', 1]], true],
        ['PO', 231, [[0.03, '0'], [0.2, '10'], [0.38, '50'], [0.52, '100'], [0.64, '150'], [0.76, '200'], [0.88, '250']]],
        ['COMP', 218, [[0.05, '0'], [0.25, '5'], [0.45, '10'], [0.65, '15'], [0.85, '20']]],
        ['TEMP', 205, [[0.05, '0'], [0.2, '20'], [0.36, '40'], [0.52, '60'], [0.68, '80'], [0.86, '100']]]]
      : [['S', 244, [[0.05, '1'], [0.17, '3'], [0.29, '5'], [0.41, '7'], [0.55, '9'], [0.7, '+20', 1], [0.84, '+40', 1], [0.97, '+60', 1]], true],
        ['ALC', 231, [[0.82, '50']]],
        ['ID', 218, [[0.05, '0'], [0.3, '5'], [0.55, '10'], [0.8, '15']]],
        ['SWR', 205, [[0.05, '1.0'], [0.24, '1.5'], [0.36, '2'], [0.5, '3'], [0.66, '5'], [0.95, '∞']]]];
    for (const [name, r, ticks, isS] of scales) {
      if (isS) {
        el('path', { d: arcPath(cx, cy, r, 0, 0.55), class: 'mtr-arc' }, g);
        el('path', { d: arcPath(cx, cy, r, 0.55, 1), class: 'mtr-arc blue' }, g);
      } else el('path', { d: arcPath(cx, cy, r, 0, name === 'ALC' ? 0.5 : 0.92), class: 'mtr-arc' + (name === 'ALC' ? ' thick' : '') }, g);
      for (const [f, lab, blue] of ticks) {
        const p = arcPt(cx, cy, r, f), q = arcPt(cx, cy, isS ? r + 4 : r - 3, f);
        el('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], class: 'mtr-tick' + (blue ? ' blue' : '') }, g);
        const tp = arcPt(cx, cy, isS ? r + 8 : r - 5, f);
        el('text', { x: tp[0], y: tp[1], class: 'mtr-num' + (blue ? ' blue' : '') + (isS ? ' big' : ''), 'text-anchor': 'middle' }, g, lab);
      }
      const lp = arcPt(cx, cy, r - (isS ? 0 : 3), -0.04);
      el('text', { x: lp[0] - 2, y: lp[1] + 3, class: 'mtr-name' + (isS ? ' big' : ''), 'text-anchor': 'end' }, g, name);
    }
    m.needle = el('line', { x1: cx, y1: cy, x2: cx, y2: cy - 250, class: 'mtr-needle' }, g);
    m.val = el('text', { x: x0 + w - 4, y: y0 + 82, class: 'mtr-val', 'text-anchor': 'end' }, g, '');
    // Le cadran est découpé à la taille du cadre
    const cid = 'clipm' + side;
    const cp = el('clipPath', { id: cid }, g);
    el('rect', { x: x0, y: y0 + 10, width: w, height: 76 }, cp);
    m.needle.setAttribute('clip-path', 'url(#' + cid + ')');
    return m;
  }
  function buildFilter(g, x0, y0, w, h) {
    const f = { x0, y0, w, h };
    g = f.g = el('g', { class: 'flt' }, g); // caché en DISP « filtres agrandis » (ils sont alors dans le grand cadre)
    el('rect', { x: x0, y: y0, width: w, height: h, class: 'flt-box' }, g);
    f.bars = el('path', { d: '', class: 'flt-bars' }, g);
    f.trap = el('path', { d: '', class: 'flt-trap' }, g);
    f.center = el('line', { x1: x0 + w / 2, y1: y0 + 6, x2: x0 + w / 2, y2: y0 + h - 4, class: 'flt-ctr' }, g);
    f.nline = el('line', { x1: x0, y1: y0 + 6, x2: x0, y2: y0 + h - 6, class: 'flt-notch', style: 'display:none' }, g);
    f.base = el('rect', { x: x0 + 6, y: y0 + h - 4, width: w - 12, height: 2.5, class: 'flt-base' }, g);
    return f;
  }
  // Fréquence BF du centre de la bande passante (sans le décalage SHIFT), selon le mode
  const FLT_SPAN = 3200; // largeur (Hz de BF) représentée par le cadre du filtre
  function audioCenter(md, hz) { return /CW/.test(md) ? 700 : /DATA|RTTY|PSK/.test(md) ? 1500 : /AM|FM/.test(md) ? hz / 2 : 300 + hz / 2; }
  // NOTCH du récepteur (MAIN : notch / notchFreq ; SUB : notchB / notchFreqB) : fréquence BF et place dans le cadre du filtre
  // (cadre = 4 kHz de large ; en bande latérale inférieure, le TRX montre la bande à l'envers)
  function notchOf(s, side, md, hz, sh) {
    const on = side === 'B' ? s.notchB : s.notch, f = side === 'B' ? s.notchFreqB : s.notchFreq;
    if (!on || !f || /FM/.test(md)) return null;
    const rev = /^LSB$|-L$/.test(md) ? -1 : 1;
    return { f, rel: rev * (f - (audioCenter(md, hz) + (sh || 0))) / FLT_SPAN };
  }
  // Trapèze du filtre (points), avec le creux du NOTCH s'il tombe dans la bande passante
  function trapPts(x0, w, cx, tw, top, bot, sl, nx, nw) {
    const a = cx - tw / 2, b = cx + tw / 2;
    const pts = [[x0 + 3, bot], [a, bot], [a + sl, top]];
    if (nx != null && nx - nw > a + sl && nx + nw < b - sl) pts.push([nx - nw, top], [nx, bot - 1], [nx + nw, top]);
    pts.push([b - sl, top], [b, bot], [x0 + w - 3, bot]);
    return pts;
  }
  function buildLcd() {
    const c = FACE.lcd;
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const g = el('g', { class: 'lcd' }, svg);
    LCD.c0y = c.y;
    el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 6, fill: 'url(#lcdbg)' }, g);
    // Galvanomètres et filtres : MAIN | filtre MAIN | SUB | filtre SUB
    LCD.mA = buildMeter(g, X(5), Y(4), 190, 'A');
    LCD.fA = buildFilter(g, X(199), Y(14), 82, 72);
    LCD.mB = buildMeter(g, X(289), Y(4), 190, 'B');
    LCD.fB = buildFilter(g, X(483), Y(14), 82, 72);
    // Fréquences
    const half = (c.w - 10) / 2;
    for (const [i, side] of [[0, 'A'], [1, 'B']]) {
      const x0 = X(5 + i * half);
      const v = LCD['v' + side] = {};
      el('text', { x: x0 + 3, y: Y(103), class: 'lcd-vfo' }, g, 'VFO');
      v.tx = el('text', { x: x0 + 38, y: Y(103), class: 'lcd-txb' }, g, '');
      v.badge = el('rect', { x: x0 + 1, y: Y(106), width: 52, height: 15, rx: 1.5, class: 'lcd-mode' }, g);
      v.mode = el('text', { x: x0 + 27, y: Y(118), class: 'lcd-modet', 'text-anchor': 'middle' }, g, '—');
      v.freq = el('path', { d: '', class: 'lcd-seg' }, g);
      v.xr = x0 + half - 6;
      v.sel = el('rect', { x: x0 + 58, y: Y(126), width: half - 64, height: 1.6, class: 'lcd-sel' }, g);
      v.hit = el('rect', { x: x0 + 58, y: Y(92), width: half - 64, height: 34, class: 'hs lcd-hit' }, g);
      el('title', {}, v.hit, 'Taper une fréquence pour le VFO ' + side);
      v.hit.addEventListener('click', () => askFreq(side));
    }
    // ANT / ATT / IPO / R.FIL / AGC
    const CELLS = [['ANT', 'ant', 'ant'], ['ATT', 'att', 'attB'], ['IPO', 'preamp', 'preampB'], ['R.FIL', 'roof', 'roofB'], ['AGC', 'agc', 'agcB']];
    for (const [i, side] of [[0, 'A'], [1, 'B']]) {
      const x0 = X(5 + i * half);
      const cw = (half - 4) / 5;
      LCD['c' + side] = CELLS.map(([lab, ka, kb], j) => {
        const id = side === 'A' ? ka : kb;
        const x = x0 + j * cw;
        el('rect', { x: x + 0.5, y: Y(130), width: cw - 1, height: 24, class: 'lcd-cell' }, g);
        el('text', { x: x + cw / 2, y: Y(139), class: 'lcd-clab', 'text-anchor': 'middle' }, g, lab);
        const t = el('text', { x: x + cw / 2, y: Y(151), class: 'lcd-cval', 'text-anchor': 'middle' }, g, '—');
        const h = el('rect', { x: x + 0.5, y: Y(130), width: cw - 1, height: 24, class: 'hs lcd-hit' }, g);
        el('title', {}, h, lab + ' ' + (side === 'A' ? 'MAIN' : 'SUB') + ' : clic pour changer');
        h.addEventListener('click', () => cycleCell(id));
        return { id, t };
      });
    }
    // Bandeau du scope : récepteur actif, état, échelle
    el('rect', { x: X(5), y: Y(157), width: c.w - 10, height: 11, class: 'lcd-tbar' }, g);
    LCD.side = el('text', { x: X(10), y: Y(165.5), class: 'lcd-side' }, g, 'MAIN');
    LCD.flags = el('text', { x: X(c.w / 2), y: Y(165.5), class: 'lcd-flags', 'text-anchor': 'middle' }, g, '');
    LCD.span = el('text', { x: X(c.w - 10), y: Y(165.5), class: 'lcd-side', 'text-anchor': 'end' }, g, 'BF | 0–4 kHz');
    el('rect', { x: X(5), y: Y(170), width: c.w - 10, height: 124, class: 'lcd-scope' }, g);
    // Rangée du bas, comme sur l'écran du TRX ; la dernière case montre la fonction réglée par le bouton MULTI
    const BOT = [['CENTER'], ['SPAN', () => { L.wfSpan = (L.wfSpan + 1) % SPANS.length; store.set('rs.face.span', L.wfSpan); WF.drawn = false; render(); }],
      ['3DSS'], ['MONO', () => { L.wfColor = L.wfColor === 1 ? 2 : 1; store.set('rs.face.wfcol', L.wfColor); render(); }], ['MULTI', () => { L.func = !L.func; render(); }],
      ['EXPAND'], ['HOLD', () => { L.hold = !L.hold; render(); }], ['MULTI']];
    const bw = (c.w - 10) / BOT.length;
    LCD.bot = BOT.map(([lab, fn], j) => {
      const x = X(5) + j * bw, last = j === BOT.length - 1;
      const r = el('rect', { x: x + 0.5, y: Y(297), width: bw - 1, height: 21, rx: last ? 2 : 0, class: 'lcd-bot' + (last ? ' multi' : '') }, g);
      const t = el('text', { x: x + bw / 2, y: Y(last ? 305.5 : 311), class: 'lcd-bott', 'text-anchor': 'middle' }, g, lab);
      const t2 = last ? el('text', { x: x + bw / 2, y: Y(315), class: 'lcd-bott2', 'text-anchor': 'middle' }, g, '') : null;
      const h = el('rect', { x: x + 0.5, y: Y(297), width: bw - 1, height: 21, class: 'hs lcd-hit' + (fn || last ? '' : ' off') }, g);
      el('title', {}, h, last ? 'MULTI : fonction réglée par le bouton MULTI (choisie dans FUNC)' : lab + (fn ? '' : ' : pas disponible à distance'));
      h.addEventListener('click', () => {
        if (last) { L.func = true; return render(); }
        if (fn) return fn();
        say(lab + ' : réglage du scope du TRX, pas disponible à distance (la cascade est celle de la BF).', '', 3500);
      });
      return { r, t, t2, lab };
    });
    LCD.hint = el('text', { x: X(c.w / 2), y: Y(236), class: 'lcd-hint', 'text-anchor': 'middle' }, g, 'Cascade : en attente du son de la station…');
    buildFunc(g, c);
    buildModeMenu(g, c);
  }
  // Tableau MODE (appui d'au moins 1 s sur MODE), comme sur le TRX : clic sur un mode pour le récepteur actif
  const MODE_GRID = [['LSB', 'USB', 'CW-L', 'CW-U'], ['AM', 'AM-N', 'FM', 'FM-N'], ['DATA-L', 'DATA-U', 'DATA-FM', 'DATA-FM-N'], ['RTTY-L', 'RTTY-U', 'PSK', null]];
  function buildModeMenu(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = LCD.modeMenu = el('g', { class: 'mode-menu', style: 'display:none' }, g);
    const x0 = X(40), y0 = Y(70), w = c.w - 80, h = 214;
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 6, class: 'mm-bg' }, m);
    el('rect', { x: x0 + 4, y: y0 + 4, width: w - 8, height: 18, rx: 3, class: 'mm-title' }, m);
    el('text', { x: x0 + w / 2, y: y0 + 17, class: 'mm-ttl', 'text-anchor': 'middle' }, m, 'MODE');
    const cw = (w - 12) / 4, rh = 46;
    LCD.modeCells = {};
    MODE_GRID.forEach((row, ri) => row.forEach((name, ci) => {
      const x = x0 + 6 + ci * cw, y = y0 + 28 + ri * rh;
      const box = el('rect', { x: x + 2, y, width: cw - 4, height: rh - 7, rx: 3, class: 'mm-cell' + (name ? '' : ' preset') }, m);
      const lab = el('text', { x: x + cw / 2, y: y + 24, class: 'mm-lab' + (name ? '' : ' preset'), 'text-anchor': 'middle' }, m, name ? name.replace('DATA-FM-N', 'D-FM-N') : 'PRESET');
      const hit = el('rect', { x: x + 2, y, width: cw - 4, height: rh - 7, class: 'hs lcd-hit' }, m);
      el('title', {}, hit, name ? 'Mode ' + name : 'PRESET : réglages du TRX, au club');
      hit.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!name) return say('PRESET : réglages du TRX, pas disponibles à distance.', '', 3500);
        closeModeMenu();
        setMode(name);
      });
      if (name) LCD.modeCells[name] = [box, lab];
    }));
    const close = el('rect', { x: x0 + w - 24, y: y0 + 5, width: 18, height: 16, class: 'hs lcd-hit' }, m);
    el('text', { x: x0 + w - 15, y: y0 + 17, class: 'mm-ttl', 'text-anchor': 'middle' }, m, '✕');
    close.addEventListener('click', (ev) => { ev.stopPropagation(); closeModeMenu(); });
  }
  function openModeMenu() {
    if (!LCD.modeMenu) return;
    L.modeMenu = true;
    render();
    setTimeout(() => document.addEventListener('pointerdown', outsideMode, true), 0);
  }
  function closeModeMenu() { L.modeMenu = false; document.removeEventListener('pointerdown', outsideMode, true); render(); }
  function outsideMode(ev) { if (!ev.target.closest || !ev.target.closest('.mode-menu')) closeModeMenu(); }
  // Menu FUNC (comme sur le TRX, mais à la souris) : clic = choisir la case (ou basculer / changer une valeur à choix),
  // molette sur la case ou bouton MULTI = régler la case choisie. Cases grises : pas disponibles à distance.
  const WF_SPEEDS = [['FAST1', 30], ['FAST2', 50], ['MID', 80], ['SLOW', 140]];
  const STEPS = [[10, '10Hz'], [100, '100Hz'], [1000, '1kHz']];
  L.wfSpeed = Math.max(0, Math.min(3, Number(store.get('rs.face.wfspd', '1')) || 0));
  L.wfColor = Math.max(1, Math.min(3, Number(store.get('rs.face.wfcol', '1')) || 1));
  L.wfLevel = Math.max(-20, Math.min(20, Number(store.get('rs.face.wflvl', '0')) || 0));
  L.func = false;
  const SPANS = [2000, 3000, 4000, 6000];
  // Touche DISP : présentations de l'écran (comme sur le FTDX101)
  const DISPS = ['cascade du MAIN', 'SUB au-dessus, MAIN en dessous', 'MAIN | SUB côte à côte', 'filtres agrandis (MAIN | SUB)'];
  L.disp = Math.max(0, Math.min(3, Number(store.get('rs.face.disp', '0')) || 0));
  L.wfSpan = Math.max(0, Math.min(3, Number(store.get('rs.face.span', '2')) || 0));
  L.hold = false;
  L.funcSel = store.get('rs.face.funcsel', 'power');
  const stepNow = () => (L.fine ? 0 : L.fast ? 2 : 1);
  function setStepIdx(i) { L.fine = i === 0; L.fast = i === 2; store.set('rs.face.fine', L.fine ? '1' : '0'); store.set('rs.face.fast', L.fast ? '1' : '0'); }
  const FUNC = [
    // [id, libellé, valeur affichée (s), réglage (s, pas) | null, couleur du trait, basculer au clic]
    [['spd', 'SPEED', () => WF_SPEEDS[L.wfSpeed][0], (s, d) => { L.wfSpeed = Math.max(0, Math.min(3, L.wfSpeed + d)); store.set('rs.face.wfspd', L.wfSpeed); }, '#ff8a1f'],
      ['peak', 'PEAK', () => '—', null, '#ff8a1f'],
      ['marker', 'MARKER', () => 'ON', null, '#ff8a1f'],
      ['color', 'COLOR', () => String(L.wfColor), (s, d) => { L.wfColor = ((L.wfColor - 1 + d + 30) % 3) + 1; store.set('rs.face.wfcol', L.wfColor); }, '#ff8a1f', true],
      ['level', 'LEVEL', () => (L.wfLevel >= 0 ? '+' : '') + L.wfLevel.toFixed(1) + 'dB', (s, d) => { L.wfLevel = Math.max(-20, Math.min(20, L.wfLevel + d * 0.5)); store.set('rs.face.wflvl', L.wfLevel); }, '#ff8a1f']],
    [['power', 'RF POWER', (s) => (s.power != null ? s.power + 'W' : '—'), (s, d) => power(d * 5), '#8a5cff'],
      ['moni', 'MONI LEVEL', () => '—', null, '#8a5cff'],
      ['nrLvl', 'DNR LEVEL', (s) => (s.nrLvl != null ? String(s.nrLvl) : '—'), (s, d) => setCtl('nrLvl', Math.max(1, Math.min(15, (s.nrLvl || 1) + d))), '#8a5cff'],
      ['nbLvl', 'NB LEVEL', (s) => (s.nbLvl != null ? String(s.nbLvl) : '—'), (s, d) => setCtl('nbLvl', Math.max(0, Math.min(10, (s.nbLvl || 0) + d))), '#8a5cff'],
      ['voxg', 'VOX GAIN', () => '—', null, '#8a5cff'],
      ['voxd', 'VOX DELAY', () => '—', null, '#8a5cff'],
      ['avox', 'ANTI VOX', () => '—', null, '#8a5cff'],
      ['step', 'STEP DIAL', () => STEPS[stepNow()][1], (s, d) => setStepIdx(Math.max(0, Math.min(2, stepNow() + d))), '#8a5cff', true]],
    [['memch', 'MEM CH', () => '', null, '#8a5cff'],
      ['group', 'GROUP', () => '', null, '#8a5cff'],
      ['rfil', 'R.FIL', (s) => cellText('roof', s[activeSide() === 'B' ? 'roofB' : 'roof']), (s, d) => { const id = activeSide() === 'B' ? 'roofB' : 'roof'; setCtl(id, ((s[id] || 1) - 1 + d + 50) % 5 + 1); }, '#8a5cff', true],
      ['scan', 'SCAN', () => '', null, '#3ddc5a'],
      ['decode', 'DECODE', () => '', null, '#3ddc5a'],
      ['rpt', 'RPT', () => '', null, '#ff3b30'],
      ['miceq', 'MIC EQ', (s) => (s.micEq ? 'ON' : 'OFF'), (s) => setCtl('micEq', s.micEq ? 0 : 1), '#ff3b30', true],
      ['encdec', 'ENC/DEC', () => '', null, '#38b6ff']],
    [['tone', 'TONE FREQ', () => '', null, '#38b6ff'],
      ['rec', 'REC/PLAY', () => '', null, '#38b6ff'],
      ['qmb', 'QMB LIST', () => '', null, '#38b6ff'],
      ['radio', 'RADIO SETTING', () => '', null, '#ffb020'],
      ['cwset', 'CW SETTING', () => '', null, '#ffb020'],
      ['opset', 'OPERATION SETTING', () => '', null, '#ffb020'],
      ['disp', 'DISPLAY SETTING', () => '', null, '#ffb020'],
      ['ext', 'EXTENSION SETTING', () => '', null, '#ffb020']]
  ];
  const FUNC_BY = {};
  for (const row of FUNC) for (const c of row) FUNC_BY[c[0]] = c;
  function funcAdjust(id, d) {
    const c = FUNC_BY[id];
    if (!c || !c[3]) return false;
    const local = ['spd', 'color', 'level', 'step'].indexOf(id) >= 0;
    if (!local && !needControl()) return true;
    c[3](S(), d);
    render();
    return true;
  }
  function buildFunc(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const f = LCD.func = el('g', { class: 'func', style: 'display:none' }, g);
    el('rect', { x: X(3), y: Y(130), width: c.w - 6, height: 166, class: 'func-bg' }, f);
    const cw = (c.w - 10) / 8, rh = 41;
    LCD.funcCells = {};
    FUNC.forEach((row, ri) => {
      const y = Y(132 + ri * rh);
      row.forEach(([id, lab, , adj, col, flip], ci) => {
        const x = X(5) + ci * cw;
        const box = el('rect', { x: x + 1, y, width: cw - 2, height: rh - 7, rx: 2, class: 'func-cell' + (adj ? '' : ' off') }, f);
        const two = lab.indexOf(' SETTING') > 0;
        const t1 = el('text', { x: x + cw / 2, y: y + (two ? 14 : 13), class: 'func-lab', 'text-anchor': 'middle' }, f, two ? lab.replace(' SETTING', '') : lab);
        const t2 = el('text', { x: x + cw / 2, y: y + 27, class: two ? 'func-lab' : 'func-val', 'text-anchor': 'middle' }, f, two ? 'SETTING' : '');
        el('rect', { x: x + (ci === 0 ? 1 : 0), y: y + rh - 5, width: cw - (ci === 0 ? 1 : 0), height: 2, fill: col, opacity: 0.9 }, f);
        // Case choisie : « − » à gauche et « + » à droite, cliquables (en plus de la molette et du bouton MULTI)
        const minus = adj && !flip ? el('text', { x: x + 9, y: y + 26, class: 'func-pm', 'text-anchor': 'middle' }, f, '−') : null;
        const plus = adj && !flip ? el('text', { x: x + cw - 9, y: y + 26, class: 'func-pm', 'text-anchor': 'middle' }, f, '+') : null;
        const hit = el('rect', { x: x + 1, y, width: cw - 2, height: rh - 7, class: 'hs lcd-hit' }, f);
        el('title', {}, hit, adj ? lab + (flip ? ' : clic pour changer' : ' : clic pour la choisir, puis clic sur − / +, molette ou bouton MULTI') : lab + ' : pas disponible à distance');
        hit.addEventListener('click', (ev) => {
          if (!adj) return say(lab + ' : pas disponible à distance (menus du TRX : au club).', '', 3500);
          const wasSel = L.funcSel === id;
          L.funcSel = id;
          store.set('rs.face.funcsel', id);
          if (flip) funcAdjust(id, 1);
          else if (wasSel) {
            const px = toImg(ev).x - x;
            if (px < cw * 0.38) funcAdjust(id, -1);
            else if (px > cw * 0.62) funcAdjust(id, 1);
          } else say(lab + ' : cliquez sur − ou + dans la case, ou tournez la molette sur la case ou le bouton MULTI.', '', 4000);
          render();
        });
        let wacc = 0;
        hit.addEventListener('wheel', (ev) => {
          ev.preventDefault();
          if (!adj) return;
          L.funcSel = id;
          wacc += ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
          const n = Math.trunc(wacc / 60);
          if (!n) return;
          wacc -= n * 60;
          funcAdjust(id, -n);
          showTip(ev, lab + ' ' + FUNC_BY[id][2](S()));
        }, { passive: false });
        LCD.funcCells[id] = { box, t1, t2, two, minus, plus };
      });
    });
  }
  function drawFunc(s) {
    if (!LCD.func) return;
    LCD.func.style.display = L.func ? '' : 'none';
    if (!L.func) return;
    for (const id in LCD.funcCells) {
      const c = LCD.funcCells[id];
      c.box.classList.toggle('sel', L.funcSel === id);
      if (c.minus) { c.minus.style.display = L.funcSel === id ? '' : 'none'; c.plus.style.display = L.funcSel === id ? '' : 'none'; }
      if (!c.two) c.t2.textContent = FUNC_BY[id][2](s);
    }
  }
  function power(d) {
    const s = S();
    if (!needControl()) return;
    const w = Math.max(5, Math.min((me && me.maxWatts) || 100, (s.power || 0) + d));
    send({ t: 'set', power: w });
  }
  function askFreq(side) {
    if (!needControl()) return;
    const s = S();
    const cur = side === 'B' ? s.freqB : s.freq;
    const v = prompt('Fréquence du VFO ' + side + ' en MHz (ex. 14.074) :', cur ? (cur / 1e6).toFixed(4) : '');
    if (v == null) return;
    const mhz = Number(String(v).replace(',', '.').trim());
    if (!(mhz > 0)) return say('Fréquence invalide.', 'warn');
    tuneTo(side, mhz * 1e6);
  }
  function cycleCell(id) {
    const c = R.CONTROL[id];
    if (!c) return say('Réglage non disponible.', 'warn');
    const s = S();
    if (c.type === 'select') {
      const i = c.options.findIndex((o) => o[0] === s[id]);
      return setCtl(id, c.options[(i + 1) % c.options.length][0]);
    }
    if (c.type === 'toggle') return setCtl(id, s[id] ? 0 : 1);
  }

  // ------------------------------------------------------------ touches : clic, appui long
  function keyEvents(e, k) {
    let t = 0, long = false;
    e.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      long = false;
      clearTimeout(t);
      if (k.act && k.act.clar) t = setTimeout(() => { long = true; doAct(k, true); }, 700);
      if (k.act && k.act.longMenu) t = setTimeout(() => { long = true; openModeMenu(); }, 900);
      if (k.act && k.act.long) t = setTimeout(() => { long = true; doAct({ act: k.act.long }, true); }, 900);
      e.classList.add('down');
    });
    const up = () => { clearTimeout(t); e.classList.remove('down'); };
    e.addEventListener('pointerup', up);
    e.addEventListener('pointerleave', up);
    e.addEventListener('click', (ev) => { ev.preventDefault(); if (!long) doAct(k, false); });
  }

  // ------------------------------------------------------------ boutons rotatifs : molette, glisser
  function knobPart(k, p) {
    if (!k.ri) return k.inner ? 'inner' : 'outer';
    const d = Math.hypot(p.x - k.cx, p.y - k.cy);
    return d <= k.ri + 3 ? 'inner' : 'outer';
  }
  function turn(k, part, notches, ev) {
    if (!notches) return;
    const s = S();
    // Grande touche VC TUNE : la bague extérieure du grand bouton accorde le présélecteur (un pas par cran)
    const vcSide = activeSide() === 'B' ? 'B' : '';
    if (k.dial && part === 'outer' && L.ringVc && R.CONTROL['vcUp' + vcSide]) {
      if (!needControl()) return;
      if (!s['vc' + vcSide]) return say('VC TUNE arrêté : mettez-le en marche avec la petite touche VC TUNE.', 'warn', 4000);
      for (let i = 0; i < Math.min(9, Math.abs(notches)); i++) send({ t: 'set', ctl: (notches > 0 ? 'vcUp' : 'vcDn') + vcSide, value: null });
      const pos = s['vcPos' + vcSide];
      return showTip(ev, 'VC TUNE ' + (vcSide ? 'SUB' : 'MAIN') + (notches > 0 ? ' +' : ' −') + (pos != null ? ' · ' + pos : ''));
    }
    if (k.multi && !(s.rit || s.xit) && FUNC_BY[L.funcSel] && FUNC_BY[L.funcSel][3]) {
      funcAdjust(L.funcSel, notches);
      return showTip(ev, FUNC_BY[L.funcSel][1] + ' ' + FUNC_BY[L.funcSel][2](S()));
    }
    if (k.dial || k.multi) {
      if (k.multi && (s.rit || s.xit)) {
        const v = Math.max(-9999, Math.min(9999, (s.clar || 0) + notches * 10));
        setCtl('clar', v);
        return showTip(ev, 'CLAR ' + (v > 0 ? '+' : '') + v + ' Hz');
      }
      const side = activeSide();
      const cur = side === 'B' ? s.freqB : s.freq;
      if (cur == null) return;
      const step = k.multi ? (L.fast ? 10000 : 1000) : (L.fine ? 10 : L.fast ? 1000 : 100);
      const hz = Math.round((cur + notches * step) / step) * step;
      tuneTo(side, hz);
      if (L.sync && !k.multi) tuneTo(side === 'B' ? 'A' : 'B', hz); // SYNC : les deux VFO ensemble
      return showTip(ev, (side === 'B' ? 'SUB ' : 'MAIN ') + fmtFreq(hz) + ' MHz');
    }
    const spec = k[part];
    if (!spec) return;
    if (spec.info) return say(spec.info, '', 4000);
    const c = R.CONTROL[spec.ctl];
    if (!c) return say(spec.label + ' : non disponible sur ce TRX.', 'warn');
    let v;
    if (c.type === 'width') {
      const tab = R.widthTable(s[c.modeKey || 'mode']) || [];
      if (!tab.length) return say(spec.label + ' : pas de réglage de largeur dans ce mode.', 'warn');
      v = Math.max(0, Math.min(tab.length, (s[spec.ctl] || 0) + notches * (spec.per || 1)));
      try { R.validate(spec.ctl, v, s); } catch (e) { v = Math.max(1, v); }
    } else if (c.type === 'level') {
      v = Math.max(c.min, Math.min(c.max, (s[spec.ctl] != null ? s[spec.ctl] : c.min) + notches * (spec.per || c.step)));
    } else return;
    setCtl(spec.ctl, v);
    showTip(ev, spec.label + ' ' + fmtVal(c, v, s));
  }
  function knobEvents(g, k) {
    let acc = 0;
    g.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      acc += ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
      const n = Math.trunc(acc / 60);
      if (!n) return;
      acc -= n * 60;
      turn(k, knobPart(k, toImg(ev)), -n, ev);
    }, { passive: false });
    let drag = null;
    g.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      const p = toImg(ev);
      drag = { part: knobPart(k, p), y: ev.clientY, a: Math.atan2(p.y - k.cy, p.x - k.cx), acc: 0, t0: Date.now(), moved: false };
      g.setPointerCapture(ev.pointerId);
      g.classList.add('grab');
    });
    g.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      if (k.dial) {
        // Grand bouton : on le fait tourner (10° = un cran)
        const p = toImg(ev);
        const a = Math.atan2(p.y - k.cy, p.x - k.cx);
        let d = a - drag.a;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        drag.a = a;
        drag.acc += d * 180 / Math.PI / 10;
      } else {
        drag.acc += (drag.y - ev.clientY) / 8; // vers le haut : plus
        drag.y = ev.clientY;
      }
      const n = Math.trunc(drag.acc);
      if (n) { drag.acc -= n; drag.moved = true; turn(k, drag.part, n, ev); }
    });
    const end = (ev) => {
      // Clic sans tourner sur un bouton qui se pousse (ex. WIDTH : NAR)
      if (drag && k.push && ev && ev.type === 'pointerup' && Math.abs(drag.acc) < 0.3 && Date.now() - drag.t0 < 500 && !drag.moved) {
        const s0 = S();
        const id = typeof k.push === 'function' ? k.push(s0, L) : k.push;
        const lab = typeof k.pushLabel === 'function' ? k.pushLabel(s0, L) : (k.pushLabel || id);
        if (id) { const v = s0[id] ? 0 : 1; setCtl(id, v); showTip(ev, lab + (v ? ' ON' : ' OFF')); }
      }
      drag = null; g.classList.remove('grab'); hideTip(600);
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
    g.addEventListener('pointerleave', () => { if (!drag) hideTip(400); });
  }
  let tipT = 0;
  function showTip(ev, text) {
    const t = $('tip');
    const box = $('facePanel').getBoundingClientRect();
    t.textContent = text;
    t.hidden = false;
    t.style.left = Math.max(0, Math.min(box.width - 160, ev.clientX - box.left + 14)) + 'px';
    t.style.top = Math.max(0, ev.clientY - box.top - 34) + 'px';
    hideTip(1600);
  }
  function hideTip(ms) { clearTimeout(tipT); tipT = setTimeout(() => { $('tip').hidden = true; }, ms || 0); }

  // ------------------------------------------------------------ affichage
  const fmtFreq = (hz) => (hz / 1e6).toFixed(6).replace(/(\d)(\d{3})$/, '$1.$2').replace(/\.(\d{3})\./, '.$1.');
  function fmtVal(c, v, s) {
    if (v == null) return '—';
    if (c.type === 'width') {
      const tab = R.widthTable(s[c.modeKey || 'mode']) || [];
      return v === 0 ? 'défaut' : tab[v - 1] != null ? tab[v - 1] + ' Hz' : String(v);
    }
    if (c.pct) return Math.round(v / 255 * 100) + ' %';
    return v + (c.unit ? ' ' + c.unit : '');
  }
  const ATT = ['OFF', '6dB', '12dB', '18dB'], IPO = ['IPO', 'AMP1', 'AMP2'], ROOF = ['', '12kHz', '3kHz', '1.2kHz', '600Hz', '300Hz'], AGC = ['OFF', 'FAST', 'MID', 'SLOW', 'AUTO'];
  function cellText(id, v) {
    if (v == null) return '—';
    if (/^att/.test(id)) return ATT[v] || String(v);
    if (/^preamp/.test(id)) return IPO[v] || String(v);
    if (/^roof/.test(id)) return ROOF[v] || '—';
    if (/^agc/.test(id)) return AGC[v] || String(v);
    return String(v);
  }
  function sFrac(v) { return v == null ? 0 : Math.max(0, Math.min(1, v / 255)); }
  let raf = 0;
  function render() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
  function draw() {
    drawTop();
    if (!FACE || !st) return;
    const s = S();
    const live = !!s.connected;
    const tx = !!s.tx;
    // Voyants
    for (const d of ledEls) {
      let on = false;
      try { on = live && !!d.on(s, L); } catch (e) { on = false; }
      d.el.classList.toggle('on', on || (d.on === undefined));
      if (d.bright) { let b = false; try { b = live && !!d.bright(s, L); } catch (e) { b = false; } d.el.classList.toggle('bright', b); }
    }
    // Écran
    const subOn = s.dualRx !== 0;
    const maxW = R.POWER_RANGE && R.POWER_RANGE[s.powerHead] ? R.POWER_RANGE[s.powerHead][1] : 100;
    for (const side of ['A', 'B']) {
      const m = LCD['m' + side];
      const sm = side === 'A' ? s.smeter : s.smeterB;
      let f = 0, val = '';
      if (tx && side === 'A') {
        // PO : 0–250 W sur l'échelle du TRX (0,03 … 0,88)
        const w = s.m5 != null ? s.m5 / 255 * maxW : 0;
        f = w <= 10 ? 0.03 + w / 10 * 0.17 : w <= 50 ? 0.2 + (w - 10) / 40 * 0.18 : w <= 100 ? 0.38 + (w - 50) / 50 * 0.14 : Math.min(0.88, 0.52 + (w - 100) / 150 * 0.36);
        val = Math.round(w) + ' W';
        m.title.textContent = 'PO METER';
      } else if (tx && side === 'B') {
        const swr = R.swrValue ? R.swrValue(s.m6) : null;
        f = swr ? Math.min(0.95, swr <= 1.5 ? 0.05 + (swr - 1) / 0.5 * 0.19 : swr <= 2 ? 0.24 + (swr - 1.5) / 0.5 * 0.12 : swr <= 3 ? 0.36 + (swr - 2) * 0.14 : 0.5 + (swr - 3) / 2 * 0.16) : 0.05;
        val = swr ? 'SWR ' + swr.toFixed(1) : '';
        m.title.textContent = 'SWR METER';
      } else {
        const show = live && (side === 'A' || subOn);
        f = show ? S_POS(sm) : 0;
        val = show ? R.smeterLabel(sm) : side === 'B' && !subOn ? 'SUB OFF' : '';
        m.title.textContent = side === 'A' ? 'PO METER' : 'ALC METER';
      }
      m.f = m.f == null ? f : m.f + (f - m.f) * 0.6; // aiguille amortie
      const p = arcPt(m.cx, m.cy, 250, m.f);
      m.needle.setAttribute('x2', p[0].toFixed(1));
      m.needle.setAttribute('y2', p[1].toFixed(1));
      m.val.textContent = val;
      m.val.classList.toggle('tx', tx);
      // Filtre : largeur et décalage du récepteur
      const fl = LCD['f' + side];
      const sfx = side === 'B' ? 'B' : '';
      const mode = side === 'A' ? s.mode : s.modeB;
      const tab = R.widthTable(mode) || null;
      const wi = s['width' + sfx];
      const hz = tab && wi ? tab[wi - 1] : /CW|RTTY|PSK|DATA/.test(mode || '') && !/DATA-U|DATA-L/.test(mode || '') ? 500 : /AM|FM/.test(mode || '') ? 6000 : 2400;
      const sh = s['shift' + sfx] || 0;
      const fr = Math.max(0.08, Math.min(0.9, hz / FLT_SPAN));
      const cx = fl.x0 + fl.w / 2 + Math.max(-0.4, Math.min(0.4, sh / 2400)) * fl.w;
      const tw = fl.w * fr, top = fl.y0 + 8, bot = fl.y0 + fl.h - 5, sl = Math.min(8, tw * 0.15);
      // NOTCH en service : creux étroit dans la bande passante, à sa fréquence (comme sur l'écran du TRX)
      const nf = notchOf(s, side, mode || '', hz, sh);
      const nx = nf ? cx + nf.rel * fl.w : null;
      fl.trap.setAttribute('d', 'M' + trapPts(fl.x0, fl.w, cx, tw, top, bot, sl, nx, 3).map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L'));
      // NOTCH hors de la bande passante (sur les flancs ou au-delà) : simple trait rouge à sa place (au bord du cadre si plus loin)
      const inPass = nx != null && nx - 3 > cx - tw / 2 + sl && nx + 3 < cx + tw / 2 - sl;
      const nxc = nx == null ? 0 : Math.max(fl.x0 + 2, Math.min(fl.x0 + fl.w - 2, nx));
      fl.nline.setAttribute('x1', nxc); fl.nline.setAttribute('x2', nxc);
      fl.nline.style.display = nx != null && !inPass ? '' : 'none';
      LCD.flt = LCD.flt || {};
      LCD.flt[side] = { fr, off: Math.max(-0.4, Math.min(0.4, sh / 2400)), hz, sh, mode: mode || '', notch: nf };
      fl.center.setAttribute('x1', cx); fl.center.setAttribute('x2', cx);
      fl.base.setAttribute('x', cx - tw / 2 + 2); fl.base.setAttribute('width', Math.max(4, tw - 4));
      const v = LCD['v' + side];
      const fq = side === 'A' ? s.freq : s.freqB;
      v.mode.textContent = mode || '—';
      v.freq.setAttribute('d', fq ? seg7(fmtFreq(fq), v.xr, LCD.c0y + 95, 26) : '');
      const active = (s.vfoSel === 1) === (side === 'B');
      v.freq.classList.toggle('dim', side === 'B' && !subOn);
      v.sel.classList.toggle('on', active);
      const txSide = s.split ? 'B' : 'A';
      v.tx.textContent = txSide === side ? (tx ? 'TX ●' : 'TX') : '';
      v.tx.classList.toggle('on', tx && txSide === side);
      for (const c of LCD['c' + side]) c.t.textContent = cellText(c.id, s[c.id]);
    }
    LCD.side.textContent = s.vfoSel === 1 ? 'SUB' : 'MAIN';
    const fl = [];
    if (tx) fl.push('● TX');
    if (s.split) fl.push('SPLIT');
    if (s.rit || s.xit) fl.push((s.rit ? 'RIT' : '') + (s.rit && s.xit ? '/' : '') + (s.xit ? 'XIT' : '') + ' ' + ((s.clar || 0) > 0 ? '+' : '') + ((s.clar || 0) / 1000).toFixed(2) + 'k');
    if (s.lock) fl.push('LOCK');
    if (s.proc) fl.push('PROC');
    if (L.fine) fl.push('FINE'); else if (L.fast) fl.push('FAST');
    LCD.flags.textContent = live ? fl.join('  ·  ') : (st.station ? 'TRX muet (éteint ou câble ?)' : 'Station hors ligne');
    LCD.flags.classList.toggle('tx', tx);
    LCD.span.textContent = ['', 'SUB / MAIN · ', 'MAIN | SUB · ', 'FILTRES · '][L.disp] + 'BF 0–' + SPANS[L.wfSpan] / 1000 + ' kHz' + (L.hold ? ' · HOLD' : '');
    for (const sd of ['A', 'B']) if (LCD['f' + sd]) LCD['f' + sd].g.style.display = L.disp === 3 ? 'none' : '';
    drawFunc(s);
    for (const b of LCD.bot || []) {
      if (b.t2) b.t2.textContent = FUNC_BY[L.funcSel] ? FUNC_BY[L.funcSel][1] : '';
      if (b.lab === 'HOLD') b.r.classList.toggle('on', !!L.hold);
      if (b.lab === 'SPAN') b.t.textContent = 'SPAN ' + SPANS[L.wfSpan] / 1000 + 'k';
      if (b.lab === 'MULTI' && !b.t2) b.r.classList.toggle('on', !!L.func);
      // DISP « filtres agrandis » : comme sur le TRX, seuls MULTI, HOLD et la case MULTI restent
      b.t.style.opacity = L.disp === 3 && !b.t2 && b.lab !== 'MULTI' && b.lab !== 'HOLD' ? '0' : '';
    }
    if (LCD.modeMenu) {
      LCD.modeMenu.style.display = L.modeMenu ? '' : 'none';
      const cur = L.activeMode(s);
      for (const n in LCD.modeCells) for (const e of LCD.modeCells[n]) e.classList.toggle('on', n === cur);
    }
    const fresh = Date.now() - WF.at < 3000;
    LCD.hint.style.display = fresh ? 'none' : '';
    LCD.hint.textContent = !live ? '' : st.audio && !st.audio.active ? 'Cascade : l’audio n’est pas activé sur la page Station' : 'Cascade : en attente du son de la station…';
    $('scope').style.visibility = fresh && !L.func && !L.modeMenu ? 'visible' : 'hidden';
  }
  function lamp(id, cls) { const e = $(id); e.classList.remove('on', 'warn', 'tx'); if (cls) e.classList.add(cls); }
  function drawTop() {
    lamp('lampLink', ws && ws.readyState === 1 && me ? 'on' : null);
    const r = (st && st.radio) || {};
    lamp('lampStation', st && st.station ? 'on' : null);
    lamp('lampTrx', r.connected ? (r.tx ? 'tx' : 'on') : st && st.station ? 'warn' : null);
    $('rigLabel').textContent = (st && st.rigName) || 'TRX';
    const cb = $('ctrlBtn');
    const mine = iControl(), other = otherTab();
    cb.textContent = !st ? 'Prendre la main' : mine ? 'Libérer la main' : other ? 'Prendre la main ici' : !st.controller ? 'Prendre la main' : me && me.admin ? 'Reprendre la main' : 'Main : ' + st.controller;
    cb.disabled = !!(st && st.controller && !mine && !other && !(me && me.admin));
    const state = !st ? 'busy' : mine ? 'mine' : other ? 'here' : !st.controller ? 'free' : me && me.admin ? 'admin' : 'busy';
    if (cb.dataset.state !== state) cb.dataset.state = state;
    const lb = $('listenBtn');
    lb.setAttribute('aria-pressed', String(L.listening));
    lb.textContent = L.listening ? '🔇 Arrêter l’écoute' : '🔊 Écouter le TRX';
    $('stereoBtn').setAttribute('aria-pressed', String(L.stereo));
    $('stereoBtn').hidden = !(R && R.DUAL_AUDIO);
    // Autre TRX en service : cette face avant n'est pas la bonne
    const cover = $('cover');
    const wrong = st && st.rigModel && st.rigModel !== MODEL;
    cover.hidden = !wrong;
    if (wrong) cover.innerHTML = '<p>Le TRX en service est le <b>' + esc(st.rigName || st.rigModel) + '</b>.<br>Cette page est la face avant du <b>' + esc(FACE.name) + '</b>.</p><p><a class="btn accent" href="/">Revenir au dashboard</a></p>';
  }
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------ émission : PTT (bouton ou barre d'espace), MOX maintenu
  let pttHeld = false, hbTimer = 0;
  L.mox = false;
  function pttReason() {
    if (!me) return 'Connectez-vous';
    if (!me.allowTx) return 'Émission désactivée sur ce serveur';
    if (me.rxOnly) return 'Indicatif d’écouteur : émission interdite';
    if (!me.canTx) return 'Votre compte est en écoute seule';
    if (!st || !st.station) return 'Station hors ligne';
    if (!st.radio.connected) return 'TRX non connecté';
    if (!iControl()) return 'Prenez la main pour émettre';
    if (st.radio.vox) return 'VOX actif au club : coupez-le d’abord';
    if (!st.txOk) return st.radio.txVfo === 1 ? 'VFO B (SPLIT) hors des bandes autorisées' : 'Hors des bandes autorisées';
    if (st.radio.power != null && st.radio.power > me.maxWatts) return 'Puissance au-delà de votre limite (' + me.maxWatts + ' W)';
    if (st.swrLock) return st.swrLock.text || 'ROS trop élevé ici';
    return null;
  }
  function pttDown() {
    if (pttHeld) return true;
    const why = pttReason();
    if (why) { say(why, 'warn'); return false; }
    pttHeld = true;
    const voice = !!(window.RSVOICE && window.RSVOICE.txStart());
    send({ t: 'ptt', on: true, voice });
    hbTimer = setInterval(() => send({ t: 'ptt', on: true, voice }), 400);
    $('ptt').classList.add('held');
    render();
    return true;
  }
  function pttUp() {
    L.mox = false;
    if (!pttHeld) return render();
    pttHeld = false;
    clearInterval(hbTimer);
    if (window.RSVOICE) window.RSVOICE.txEnd();
    send({ t: 'ptt', on: false });
    $('ptt').classList.remove('held');
    render();
  }
  {
    const b = $('ptt');
    b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); b.setPointerCapture(ev.pointerId); pttDown(); });
    b.addEventListener('pointerup', pttUp);
    b.addEventListener('pointercancel', pttUp);
    b.addEventListener('lostpointercapture', () => { if (!L.mox) pttUp(); });
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());
    const typing = (ev) => /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName) && ev.target.type !== 'range';
    document.addEventListener('keydown', (ev) => { if (ev.code === 'Space' && !ev.repeat && !typing(ev)) { ev.preventDefault(); pttDown(); } });
    document.addEventListener('keyup', (ev) => { if (ev.code === 'Space' && !typing(ev)) { ev.preventDefault(); pttUp(); } });
    window.addEventListener('blur', () => { if (!L.mox) pttUp(); });
  }

  // ------------------------------------------------------------ écoute (prise PHONES), stéréo et cascade
  // La page reçoit toujours la BF (cascade dans l'écran du TRX) ; le son n'est joué qu'avec « Écouter » / la prise PHONES.
  // Stéréo (TRX à deux récepteurs, double réception) : MAIN dans l'oreille gauche, SUB dans la droite, comme au casque.
  L.stereo = store.get('rs.face.stereo', '0') === '1';
  const player = { ctx: null, gain: null, next: 0 };
  function wantAudio() {
    if (!me) return;
    const on = document.visibilityState !== 'hidden' || L.listening; // onglet caché : plus de cascade, sauf si on écoute
    send({ t: 'listen', on, mute: !L.listening, stereo: L.stereo });
  }
  function volume() {
    const v = Number($('listenVol').value) / 100;
    if (player.gain) player.gain.gain.value = v;
    $('listenVolOut').textContent = Math.round(v * 100) + ' %';
    store.set('rs.vol', String($('listenVol').value));
  }
  function startListen() {
    if (!player.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return say('Ce navigateur ne peut pas jouer le son.', 'warn');
      player.ctx = new AC();
      player.gain = player.ctx.createGain();
      player.gain.connect(player.ctx.destination);
      volume();
    }
    player.ctx.resume();
    L.listening = true;
    player.next = 0;
    wantAudio();
    if (st && st.audio && !st.audio.active) say('La station n’envoie pas encore de son (audio pas activé sur la page Station).', 'warn');
    render();
  }
  function stopListen() {
    L.listening = false;
    wantAudio();
    if (player.ctx) player.ctx.suspend();
    render();
  }
  function setStereo(on) {
    L.stereo = !!on;
    store.set('rs.face.stereo', L.stereo ? '1' : '0');
    wantAudio();
    const s = S();
    if (L.stereo && s.dualRx === 0) {
      // Les deux récepteurs en service (double réception) pour entendre MAIN à gauche et SUB à droite
      if (iControl()) { setCtl('dualRx', 1); say('Stéréo : double réception en marche ; MAIN dans l’oreille gauche, SUB dans l’oreille droite.', '', 5000); }
      else say('Stéréo : prenez la main pour mettre en marche le récepteur SUB (double réception).', 'warn', 6000);
    } else if (L.stereo) say('Stéréo : MAIN dans l’oreille gauche, SUB dans l’oreille droite.', '', 4000);
    render();
  }
  function play(pcm) {
    if (!L.listening || !player.ctx) return;
    if (window.RSVOICE && window.RSVOICE.talking()) { player.next = 0; return; } // pas d'écho de sa propre émission
    const ctx = player.ctx;
    const now = ctx.currentTime;
    if (player.next < now + 0.05) player.next = now + 0.2;
    else if (player.next > now + 0.8) return;
    const two = !!pcm.r;
    const buf = ctx.createBuffer(two ? 2 : 1, pcm.length, pcm.rate || ULAW.RATE);
    buf.copyToChannel(pcm, 0);
    if (two) buf.copyToChannel(pcm.r, 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(player.gain);
    src.start(player.next);
    player.next += buf.duration;
  }
  function onAudio(data) {
    const u8 = new Uint8Array(data);
    if (DG() && DG().onBinary(u8)) return; // lignes de cascade des modes numériques
    const pcm = window.ULAW && ULAW.decodeFrame(u8);
    if (!pcm) return;
    feedWf(pcm, pcm.rate || 12000);
    play(pcm);
  }

  // Cascade : FFT de 512 points sur la BF reçue (12 kHz → 0 à 4 kHz), une ligne toutes les 50 ms
  // FFT de 2048 points : à 12 kHz, un point tous les 5,9 Hz (spectre fin)
  const NFFT = 2048;
  const WF = { at: 0, rate: 12000, l: new Float32Array(NFFT), r: new Float32Array(NFFT), two: false, pos: 0, drawn: false };
  function feedWf(pcm, rate) {
    WF.at = Date.now();
    WF.rate = rate;
    WF.two = !!pcm.r;
    const n = pcm.length;
    if (n >= NFFT) { WF.l.set(pcm.subarray(n - NFFT)); if (pcm.r) WF.r.set(pcm.r.subarray(n - NFFT)); return; }
    WF.l.copyWithin(0, n); WF.l.set(pcm, NFFT - n);
    if (pcm.r) { WF.r.copyWithin(0, n); WF.r.set(pcm.r, NFFT - n); }
  }
  const HANN = new Float32Array(NFFT).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (NFFT - 1)));
  function spectrum(x) {
    // FFT radix 2 en place (re, im), puis amplitude en dB ramenée à 0..1
    const N = NFFT, re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 0; i < N; i++) re[i] = x[i] * HANN[i];
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const ang = -2 * Math.PI / len;
      for (let i = 0; i < N; i += len) {
        for (let k = 0; k < len / 2; k++) {
          const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
          const a = i + k, b = a + len / 2;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    // Niveau automatique comme le scope du TRX : le bruit de fond (médiane) reste sombre, les signaux ressortent
    const db = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) db[i] = 10 * Math.log10(re[i] * re[i] + im[i] * im[i] + 1e-12);
    const srt = Array.from(db.subarray(16, Math.floor(N * 0.35))).sort((a, b) => a - b);
    const med = srt[srt.length >> 1];
    WF.floor = WF.floor == null ? med : WF.floor + (med - WF.floor) * 0.05;
    const out = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) out[i] = Math.max(0, Math.min(1, 0.3 + (db[i] - WF.floor) / 40));
    return out;
  }
  // Palettes de la cascade (FUNC → COLOR) : 1 = rouge comme l'écran du FTDX101, 2 = bleu / violet, 3 = arc-en-ciel
  function mkPal(stops) {
    const out = [];
    for (let i = 0; i < 256; i++) {
      const v = i / 255;
      let k = 0;
      while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
      const [v0, c0] = stops[k], [v1, c1] = stops[k + 1];
      const t = Math.max(0, Math.min(1, (v - v0) / (v1 - v0)));
      out.push([0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * t)));
    }
    return out;
  }
  const PALS = {
    1: mkPal([[0, [8, 0, 2]], [0.3, [110, 0, 10]], [0.55, [215, 20, 30]], [0.78, [255, 70, 120]], [1, [255, 235, 245]]]),
    2: mkPal([[0, [2, 4, 25]], [0.35, [30, 40, 170]], [0.6, [150, 60, 230]], [0.82, [255, 90, 210]], [1, [255, 240, 255]]]),
    3: mkPal([[0, [0, 0, 40]], [0.25, [0, 60, 200]], [0.5, [0, 200, 160]], [0.75, [255, 220, 0]], [1, [255, 40, 0]]])
  };
  // Zones du scope selon DISP : MAIN seul ; SUB au-dessus de MAIN ; MAIN | SUB côte à côte
  function scopeRegions(W, H, specs) {
    const sub = WF.two ? specs[1] : null;
    if (L.disp === 1) {
      const h1 = Math.floor(H / 2) - 1;
      return [{ sp: sub, x0: 0, y0: 0, w: W, h: h1, name: 'SUB' }, { sp: specs[0], x0: 0, y0: h1 + 2, w: W, h: H - h1 - 2, name: 'MAIN', sep: 'h' }];
    }
    if (L.disp === 2) {
      const w1 = Math.floor(W / 2) - 1;
      return [{ sp: specs[0], x0: 0, y0: 0, w: w1, h: H, name: 'MAIN' }, { sp: sub, x0: w1 + 2, y0: 0, w: W - w1 - 2, h: H, name: 'SUB', sep: 'v' }];
    }
    return [{ sp: specs[0], x0: 0, y0: 0, w: W, h: H, name: '' }];
  }
  // Un scope : spectre en haut, cascade en dessous (elle descend d'une ligne à chaque tour), échelle en bas
  function drawScope(c2, rg, pal, nb, lvl, maxHz) {
    const { sp, x0, y0, w, h, name } = rg;
    const lab = 11, sh = Math.round((h - lab) * (h < 90 ? 0.5 : 0.6));
    if (rg.sep === 'h') { c2.fillStyle = '#2b3546'; c2.fillRect(x0, y0 - 2, w, 2); }
    if (rg.sep === 'v') { c2.fillStyle = '#2b3546'; c2.fillRect(x0 - 2, y0, 2, h); }
    if (!sp) {
      // SUB sans la BF du SUB : l'écoute stéréo (double réception) l'envoie séparément
      c2.fillStyle = '#000'; c2.fillRect(x0, y0, w, h);
      c2.fillStyle = '#6f86ff'; c2.font = 'bold 10px "Roboto Mono", monospace'; c2.textAlign = 'left'; c2.fillText(name, x0 + 4, y0 + 11);
      c2.fillStyle = '#8a97ab'; c2.font = '11px system-ui, sans-serif'; c2.textAlign = 'center';
      c2.fillText('SUB : bouton « 🎧 Stéréo MAIN | SUB » (double réception)', x0 + w / 2, y0 + h / 2 + 4);
      return;
    }
    // Cascade : le contenu descend d'une ligne, nouvelle ligne en haut
    if (h - lab - sh - 1 > 0) c2.drawImage(c2.canvas, x0, y0 + sh, w, h - lab - sh - 1, x0, y0 + sh + 1, w, h - lab - sh - 1);
    c2.fillStyle = '#000';
    c2.fillRect(x0, y0, w, sh);
    c2.fillRect(x0, y0 + h - lab, w, lab);
    // Un point d'écran = le plus fort des points de la FFT qu'il couvre (les pics fins restent visibles)
    const col = new Float32Array(w);
    for (let px = 0; px < w; px++) {
      const i0 = Math.floor(px / w * nb), i1 = Math.max(i0 + 1, Math.floor((px + 1) / w * nb));
      let m = 0;
      for (let i = i0; i < i1 && i < nb; i++) if (sp[i] > m) m = sp[i];
      col[px] = Math.max(0, Math.min(1, m + lvl));
    }
    // Grille
    c2.strokeStyle = 'rgba(120,130,145,.45)';
    c2.lineWidth = 1;
    for (let k = 1; k < 8; k++) { const gx = Math.round(x0 + w * k / 8) + 0.5; c2.beginPath(); c2.moveTo(gx, y0); c2.lineTo(gx, y0 + sh); c2.stroke(); }
    for (let k = 1; k < 5; k++) { const gy = Math.round(y0 + sh * k / 5) + 0.5; c2.beginPath(); c2.moveTo(x0, gy); c2.lineTo(x0 + w, gy); c2.stroke(); }
    // MARKER (S.MENU) : bande passante du filtre de ce récepteur et repère central, sur l'échelle de la BF
    const fl = L.marker && LCD.flt && LCD.flt[name === 'SUB' ? 'B' : 'A'];
    if (fl) {
      const md = fl.mode;
      let c = /CW/.test(md) ? 700 : /DATA|RTTY|PSK/.test(md) ? 1500 : /AM|FM/.test(md) ? fl.hz / 2 : 300 + fl.hz / 2;
      c += fl.sh || 0;
      const lo = Math.max(0, c - fl.hz / 2), hi = Math.min(maxHz, c + fl.hz / 2);
      const xa = x0 + lo / maxHz * w, xb = x0 + hi / maxHz * w;
      if (xb > xa) {
        c2.fillStyle = 'rgba(70,130,255,.16)'; c2.fillRect(xa, y0, xb - xa, sh);
        c2.strokeStyle = 'rgba(110,160,255,.7)'; c2.beginPath(); c2.moveTo(xa + 0.5, y0); c2.lineTo(xa + 0.5, y0 + sh); c2.moveTo(xb - 0.5, y0); c2.lineTo(xb - 0.5, y0 + sh); c2.stroke();
      }
      const xc = x0 + Math.max(0, Math.min(maxHz, c)) / maxHz * w;
      c2.strokeStyle = '#ff9a1f'; c2.beginPath(); c2.moveTo(xc + 0.5, y0); c2.lineTo(xc + 0.5, y0 + sh); c2.stroke();
      // NOTCH : trait rouge à sa fréquence BF
      if (fl.notch && fl.notch.f < maxHz) {
        const xn = x0 + fl.notch.f / maxHz * w;
        c2.strokeStyle = '#ff2b1c'; c2.setLineDash([3, 2]); c2.beginPath(); c2.moveTo(xn + 0.5, y0); c2.lineTo(xn + 0.5, y0 + sh); c2.stroke(); c2.setLineDash([]);
        c2.fillStyle = '#ff5a3c'; c2.font = 'bold 9px "Roboto Mono", monospace'; c2.textAlign = 'left'; c2.fillText('N', xn + 3, y0 + 20);
      }
    }
    // Spectre : traits blancs bleutés depuis la ligne de base
    c2.strokeStyle = 'rgba(205,220,255,.9)';
    c2.beginPath();
    for (let px = 0; px < w; px++) {
      const v = col[px];
      c2.moveTo(x0 + px + 0.5, y0 + sh - 1);
      c2.lineTo(x0 + px + 0.5, y0 + sh - 1 - v * v * (sh - 5));
    }
    c2.stroke();
    // PEAK (S.MENU) : crêtes gardées, qui redescendent lentement (LV1) … vite (LV3)
    if (L.peak) {
      WF.peak = WF.peak || {};
      const key = name || 'M';
      let pk = WF.peak[key];
      if (!pk || pk.length !== w) pk = WF.peak[key] = new Float32Array(w);
      const dec = [0, 0.003, 0.009, 0.025][L.peak];
      c2.fillStyle = 'rgba(120,205,255,.95)';
      for (let px = 0; px < w; px++) {
        pk[px] = Math.max(col[px], pk[px] - dec);
        if (pk[px] > 0.02) c2.fillRect(x0 + px, y0 + sh - 1 - pk[px] * pk[px] * (sh - 5) - 1, 1, 1.5);
      }
    }
    const line = c2.createImageData(w, 1);
    for (let px = 0; px < w; px++) {
      const cc = pal[Math.round(col[px] * 255)];
      line.data[px * 4] = cc[0]; line.data[px * 4 + 1] = cc[1]; line.data[px * 4 + 2] = cc[2]; line.data[px * 4 + 3] = 255;
    }
    c2.putImageData(line, x0, y0 + sh);
    c2.strokeStyle = 'rgba(160,170,185,.7)';
    c2.beginPath(); c2.moveTo(x0, y0 + sh - 0.5); c2.lineTo(x0 + w, y0 + sh - 0.5); c2.stroke();
    // Échelle : 0 à 4 kHz de BF
    c2.fillStyle = 'rgba(200,210,225,.85)';
    c2.font = '9px "Roboto Mono", monospace';
    c2.textAlign = 'center';
    for (let k = 1; k < maxHz / 1000; k++) c2.fillText(k + 'k', x0 + w * k * 1000 / maxHz, y0 + h - 2);
    if (name) { c2.textAlign = 'left'; c2.fillStyle = '#6f86ff'; c2.font = 'bold 10px "Roboto Mono", monospace'; c2.fillText(name, x0 + 4, y0 + 11); }
  }
  // DISP « filtres agrandis » : le filtre de chaque récepteur (largeur, décalage) avec le spectre de sa BF
  function drawFilters(c2, W, H, specs, nb, lvl) {
    c2.fillStyle = '#000';
    c2.fillRect(0, 0, W, H);
    const half = Math.floor(W / 2);
    for (const [i, side, sp, color] of [[0, 'A', specs[0], '#ff2b1c'], [1, 'B', WF.two ? specs[1] : null, '#d8e6ff']]) {
      const x0 = i * half + 6, w = half - 12, y0 = 8, h = H - 26;
      c2.strokeStyle = '#2a3140'; c2.lineWidth = 1; c2.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h);
      const f = (LCD.flt && LCD.flt[side]) || { fr: 0.6, off: 0 };
      const cx = x0 + w / 2 + f.off * w, tw = w * f.fr, top = y0 + 14, bot = y0 + h - 4, sl = Math.min(14, tw * 0.12);
      // Spectre de la BF : barres
      if (sp) {
        c2.strokeStyle = 'rgba(215,225,240,.85)'; c2.lineWidth = 2;
        c2.beginPath();
        const n = Math.floor(w / 4);
        for (let k = 0; k < n; k++) {
          const i0 = Math.floor(k / n * nb), i1 = Math.max(i0 + 1, Math.floor((k + 1) / n * nb));
          let m = 0;
          for (let j = i0; j < i1 && j < nb; j++) if (sp[j] > m) m = sp[j];
          const v = Math.max(0, Math.min(1, m + lvl));
          const x = x0 + 4 + k * (w - 8) / n;
          c2.moveTo(x, bot); c2.lineTo(x, bot - v * v * (bot - top - 6));
        }
        c2.stroke();
      } else if (side === 'B') {
        c2.fillStyle = '#8a97ab'; c2.font = '11px system-ui, sans-serif'; c2.textAlign = 'center';
        c2.fillText('SUB : bouton « 🎧 Stéréo MAIN | SUB »', x0 + w / 2, y0 + h / 2);
      }
      // Bande passante (trapèze), repère central, base bleue
      c2.strokeStyle = color; c2.lineWidth = 2.5; c2.lineJoin = 'round';
      c2.beginPath();
      trapPts(x0, w, cx, tw, top, bot, sl, f.notch ? cx + f.notch.rel * w : null, 5).forEach((p, j) => (j ? c2.lineTo(p[0], p[1]) : c2.moveTo(p[0], p[1])));
      c2.stroke();
      if (f.notch) {
        const nx = cx + f.notch.rel * w;
        if (!(nx - 5 > cx - tw / 2 + sl && nx + 5 < cx + tw / 2 - sl)) {
          const xc = Math.max(x0 + 3, Math.min(x0 + w - 3, nx));
          c2.strokeStyle = '#ff2b1c'; c2.lineWidth = 2; c2.setLineDash([4, 3]);
          c2.beginPath(); c2.moveTo(xc, top); c2.lineTo(xc, bot); c2.stroke(); c2.setLineDash([]);
        }
      }
      c2.strokeStyle = '#ff9a1f'; c2.lineWidth = 2;
      c2.beginPath(); c2.moveTo(cx, top - 6); c2.lineTo(cx, bot); c2.stroke();
      c2.fillStyle = '#3b6dff'; c2.fillRect(cx - tw / 2 + 3, bot + 2, Math.max(4, tw - 6), 3);
      c2.fillStyle = '#6f86ff'; c2.font = 'bold 10px "Roboto Mono", monospace'; c2.textAlign = 'left';
      c2.fillText(side === 'A' ? 'MAIN' : 'SUB', x0 + 4, y0 + 11);
    }
  }
  function wfTick() {
    const cv = $('scope');
    const fresh = Date.now() - WF.at < 3000;
    if (fresh) {
      const maxHz = Math.min(SPANS[L.wfSpan], WF.rate / 2);
      const lvl = L.wfLevel / 70;
      const specs = [spectrum(WF.l), WF.two ? spectrum(WF.r) : null];
      const nb = Math.max(2, Math.floor((NFFT / 2) * maxHz / (WF.rate / 2)));
      // Petit spectre dans le cadre du filtre (MAIN à gauche, SUB à droite)
      for (const [side, sp] of [['A', specs[0]], ['B', specs[1] || (S().dualRx !== 0 && !WF.two ? null : null)]]) {
        const fl = LCD['f' + side];
        if (!fl) continue;
        if (!sp) { fl.bars.setAttribute('d', ''); continue; }
        let d = '';
        const n = 34, bot = fl.y0 + fl.h - 6, hh = fl.h - 16;
        for (let i = 0; i < n; i++) {
          const v = Math.max(0, Math.min(1, sp[Math.floor(i / n * nb)] + lvl));
          const x = fl.x0 + 6 + i * (fl.w - 12) / n;
          d += 'M' + x.toFixed(1) + ' ' + bot + 'V' + (bot - v * v * hh).toFixed(1);
        }
        fl.bars.setAttribute('d', d);
      }
      if (cv.style.visibility !== 'hidden' && !L.hold) {
        const c2 = cv.getContext('2d');
        const r = cv.getBoundingClientRect();
        const W = Math.max(50, Math.round(r.width)), H = Math.max(40, Math.round(r.height));
        if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; WF.drawn = false; }
        if (!WF.drawn) { c2.fillStyle = '#000'; c2.fillRect(0, 0, W, H); WF.drawn = true; }
        const pal = PALS[L.wfColor] || PALS[1];
        if (L.disp === 3) drawFilters(c2, W, H, specs, nb, lvl, maxHz);
        else for (const rg of scopeRegions(W, H, specs)) drawScope(c2, rg, pal, nb, lvl, maxHz);
      }
    } else {
      for (const side of ['A', 'B']) if (LCD['f' + side]) LCD['f' + side].bars.setAttribute('d', '');
    }
    setTimeout(wfTick, WF_SPEEDS[L.wfSpeed][1]);
  }
  document.addEventListener('visibilitychange', wantAudio);

  // ------------------------------------------------------------ liaison avec le serveur
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { retry = 0; if (creds) send(creds.session ? { t: 'login', session: creds.session } : { t: 'login', call: creds.call, pass: creds.pass }); render(); };
    ws.onmessage = (e) => {
      lastMsg = Date.now();
      if (typeof e.data !== 'string') return onAudio(e.data);
      let m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if ((m.t === 'mic_profile' || m.t === 'trxeq' || m.t === 'trxeq_values') && window.RSVOICE) { window.RSVOICE.onMessage(m); return; }
      if (DG() && m.t !== 'hello' && m.t !== 'state' && DG().onMessage(m)) return;
      if (m.t === 'hello') {
        me = m;
        $('login').hidden = true;
        $('meCall').textContent = m.call;
        if (m.stationCall) $('stationCall').textContent = m.stationCall;
        if (m.clubName) $('clubName').textContent = m.clubName;
        if (m.session) { creds = { session: m.session }; store.set('rs.sess', m.session); }
        wantAudio();
        if (DG()) DG().onHello(m, m);
        if (window.RSVOICE) window.RSVOICE.onHello(m);
        send({ t: 'plan_pref', on: store.get('rs.planauto', '1') !== '0' }); // MODE AUTO : même choix que dans le dashboard
        render();
      } else if (m.t === 'login_fail') {
        creds = null;
        if (m.session) store.set('rs.sess', '');
        showLogin(m.msg);
      } else if (m.t === 'session_end') {
        creds = null;
        store.set('rs.sess', '');
        showLogin(m.msg);
      } else if (m.t === 'idle_warn') {
        say('Inactivité : vous serez déconnecté dans ' + (m.seconds || 60) + ' s. Cliquez n’importe où pour rester.', 'warn', 0);
        document.addEventListener('pointerdown', () => { send({ t: 'stay' }); say(''); }, { once: true });
      } else if (m.t === 'state') {
        st = m;
        render();
        if (DG()) DG().onState(st);
        if (window.RSVOICE) window.RSVOICE.onState(st);
        if (pttHeld && !iControl()) pttUp();
      } else if (m.t === 'notice') {
        if (m.pttCut) pttUp();
        say(m.msg, m.level === 'error' ? 'error' : m.level === 'info' ? '' : 'warn', 7000);
      }
    };
    ws.onclose = () => {
      me = me && Object.assign({}, me, { cid: null });
      render();
      if (!creds) return;
      say('Liaison perdue avec le serveur, reconnexion…', 'warn', 0);
      retry = Math.min(retry + 1, 6);
      setTimeout(connect, 500 * Math.pow(2, retry - 1));
    };
  }
  setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    if (lastMsg && Date.now() - lastMsg > 15000) { try { ws.close(); } catch (e) { /* */ } return; }
    send({ t: 'ping', ts: Date.now() });
  }, 5000);
  function showLogin(msg) {
    $('login').hidden = false;
    $('loginErr').textContent = msg || '';
    $('loginBtn').disabled = false;
    setTimeout(() => $('loginCall').focus(), 50);
  }
  $('loginForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    creds = { call: $('loginCall').value.trim().toUpperCase(), pass: $('loginPass').value };
    $('loginPass').value = '';
    $('loginBtn').disabled = true;
    if (ws && ws.readyState === 1) send({ t: 'login', call: creds.call, pass: creds.pass });
    else connect();
  });
  $('ctrlBtn').addEventListener('click', () => {
    if (!st) return;
    if (iControl()) send({ t: 'release' });
    else if (!st.controller || otherTab()) send({ t: 'take' });
    else if (me && me.admin && confirm('Reprendre la main à ' + st.controller + ' ?')) send({ t: 'take', force: true });
  });
  $('listenBtn').addEventListener('click', () => (L.listening ? stopListen() : startListen()));
  $('stereoBtn').addEventListener('click', () => setStereo(!L.stereo));
  $('listenVol').value = store.get('rs.vol', '100');
  $('listenVol').addEventListener('input', volume);
  volume();
  // Flèches du clavier : accord du récepteur actif (comme le grand bouton)
  document.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const dial = (FACE.knobs || []).find((k) => k.dial);
    if (!dial) return;
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    turn(dial, 'inner', e.key === 'ArrowUp' ? 1 : -1, { clientX: r.left + r.width * (dial.cx - V.x) / V.w, clientY: r.top + r.height * (dial.cy - dial.ro - V.y) / V.h });
  });

  // ------------------------------------------------------------ fenêtres séparées (modes numériques, carte de bande)
  // Modes numériques : bouton ⧉ des onglets → /digi.html, qui se raccroche à cette page (window.opener.RSHOST)
  // et utilise sa connexion, comme depuis le dashboard ; sous la face avant : « Ramener ici ».
  const digiApi = { send, say, iControl, state: () => st, rig: () => R, setFreq: (hz, which) => tuneTo(which === 'B' ? 'B' : 'A', hz) };
  const digiHost = { win: null, inst: null };
  function DG() {
    if (digiHost.inst && digiHost.win && !digiHost.win.closed) return digiHost.inst;
    if (digiHost.inst) releaseDigi();
    return window.RSDIGI || null;
  }
  window.DG = DG;
  function releaseDigi() {
    digiHost.inst = null;
    digiHost.win = null;
    if (window.RSDIGI) { window.RSDIGI.setDetached(false); if (me) window.RSDIGI.onHello(me, me); if (st) window.RSDIGI.onState(st); }
  }
  window.RSHOST = {
    api: digiApi,
    attach(win, inst, popupApi) {
      if (digiHost.win && digiHost.win !== win && !digiHost.win.closed) { try { digiHost.win.close(); } catch (e) {} }
      bmPopClose(); // la carte de bande part avec les modes numériques (dans leur fenêtre)
      digiHost.win = win;
      digiHost.inst = inst;
      if (window.RSDIGI) window.RSDIGI.setDetached(true);
      inst.init(popupApi || digiApi);
      if (me) inst.onHello(me, me);
      if (st) inst.onState(st);
    },
    detach(inst) { if (digiHost.inst === inst) releaseDigi(); },
    closePopup() { const w = digiHost.win; releaseDigi(); if (w && !w.closed) try { w.close(); } catch (e) {} }
  };

  // Carte de bande : la colonne de droite (#fcBm) est déplacée telle quelle dans une fenêtre à elle (bouton ⧉ de son en-tête)
  const BMKEY = 'rs.face.bmwin';
  const bmPop = { win: null, el: null, ph: null };
  // digi.js cherche ses éléments par id : aussi dans la fenêtre de la carte de bande
  window.RSPANELS = {
    find(id) {
      const el = bmPop.el;
      if (!el || el.ownerDocument === document) return null;
      return el.id === id ? el : el.querySelector('#' + CSS.escape(id));
    },
    all(sel) {
      const out = Array.from(document.querySelectorAll(sel));
      if (bmPop.el && bmPop.el.ownerDocument !== document) out.push(...bmPop.el.querySelectorAll(sel));
      return out;
    }
  };
  const bmSaved = () => { try { return JSON.parse(store.get(BMKEY, '') || 'null'); } catch (e) { return null; } };
  const redraw = () => window.dispatchEvent(new Event('resize'));
  function bmPopBtn() {
    const b = window.RSPANELS.find('bmPop') || document.getElementById('bmPop');
    if (!b) return;
    const on = !!bmPop.win;
    b.textContent = on ? '⧉ Ramener' : '⧉';
    b.classList.toggle('on', on);
    b.title = on ? 'Ramener la carte de bande à droite de la face avant (ou fermer cette fenêtre)' : 'Ouvrir la carte de bande dans une fenêtre séparée (autre écran…)';
  }
  function bmPopOpen(quiet) {
    const el = document.getElementById('fcBm');
    if (!el || bmPop.win) return true;
    if (DG() !== window.RSDIGI) { if (!quiet) say('La carte de bande est dans la fenêtre séparée des modes numériques.', '', 5000); return true; }
    const g = bmSaved() || { w: 380, h: Math.max(400, (screen.availHeight || 900) - 120), x: window.screenX + Math.max(0, window.outerWidth - 420), y: window.screenY + 80 };
    const win = window.open('', 'rs-face-bm', 'popup,width=' + g.w + ',height=' + g.h + ',left=' + g.x + ',top=' + g.y);
    if (!win) {
      if (!quiet) say('Fenêtre bloquée par Chrome : autorisez les fenêtres pop-up pour ce site (icône à droite de la barre d’adresse).', 'warn', 8000);
      return false;
    }
    const doc = win.document;
    doc.title = 'Carte de bande — ' + (FACE ? FACE.name : 'Remote Station');
    doc.documentElement.lang = 'fr';
    if (!doc.body) doc.documentElement.appendChild(doc.createElement('body'));
    doc.body.textContent = '';
    doc.body.className = 'face-page bm-popup';
    for (const f of ['rp-tokens.css', 'rp.css', 'face.css']) {
      if (doc.querySelector('link[data-rs="' + f + '"]')) continue;
      const l = doc.createElement('link');
      l.rel = 'stylesheet';
      l.href = location.origin + '/css/' + f;
      l.dataset.rs = f;
      l.onload = () => setTimeout(redraw, 0); // dimensions connues : on redessine
      doc.head.appendChild(l);
    }
    if (!doc.querySelector('script[data-rs]')) {
      // Face avant fermée : la fenêtre se ferme toute seule
      const sc = doc.createElement('script');
      sc.dataset.rs = '1';
      sc.textContent = 'setInterval(function(){try{if(!opener||opener.closed)window.close();}catch(e){window.close();}},2000);';
      doc.head.appendChild(sc);
    }
    const ph = document.createComment('place de la carte de bande');
    el.before(ph);
    try {
      doc.body.appendChild(doc.adoptNode(el));
    } catch (e) {
      if (el.ownerDocument !== document) document.adoptNode(el);
      ph.replaceWith(el);
      try { win.close(); } catch (x) {}
      return false;
    }
    Object.assign(bmPop, { win, el, ph });
    document.body.classList.add('bm-popped');
    // Barre d'espace (PTT), Échap et clics : transmis à la page (menus « Filtres », émission…)
    const fwd = (type) => (e) => {
      const t = e.target;
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      if (e.code !== 'Space' && e.key !== 'Escape' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (e.code === 'Space' || e.key.indexOf('Arrow') === 0) e.preventDefault();
      document.dispatchEvent(new KeyboardEvent(type, { key: e.key, code: e.code, repeat: e.repeat, bubbles: true }));
    };
    doc.addEventListener('keydown', fwd('keydown'));
    doc.addEventListener('keyup', fwd('keyup'));
    doc.addEventListener('click', () => document.dispatchEvent(new MouseEvent('click')));
    win.addEventListener('resize', redraw);
    win.addEventListener('pagehide', () => setTimeout(() => { if (bmPop.win === win) bmPopClose(); }, 50));
    store.set(BMKEY, JSON.stringify(g));
    bmPopBtn();
    setTimeout(redraw, 50);
    return true;
  }
  function bmPopClose(keep) {
    const w = bmPop.win;
    if (!w) return;
    const el = bmPop.el, ph = bmPop.ph;
    bmPop.win = null;
    try { document.adoptNode(el); } catch (e) {}
    ph.replaceWith(el);
    bmPop.el = null;
    document.body.classList.remove('bm-popped');
    if (!keep) store.set(BMKEY, '');
    try { if (!w.closed) w.close(); } catch (e) {}
    bmPopBtn();
    redraw();
  }
  // Fenêtre déplacée ou agrandie : mémorisée ; fermée par la croix : la carte revient
  setInterval(() => {
    const w = bmPop.win;
    if (!w) return;
    if (w.closed) { bmPopClose(); return; }
    const g = { x: w.screenX, y: w.screenY, w: w.outerWidth, h: w.outerHeight };
    if (g.w > 0 && store.get(BMKEY, '') !== JSON.stringify(g)) store.set(BMKEY, JSON.stringify(g));
  }, 1000);
  // Page rechargée ou fermée : la carte revient (la fenêtre se ferme) mais reste mémorisée et se rouvre au chargement
  window.addEventListener('pagehide', () => bmPopClose(true));
  document.addEventListener('rs-bm-pop', () => { if (bmPop.win) bmPopClose(); else bmPopOpen(); });
  function bmPopRestore() {
    if (!bmSaved()) return;
    if (bmPopOpen(true) === false) say('La carte de bande n’a pas pu être rouverte dans sa fenêtre : autorisez les fenêtres pop-up pour ce site, puis rechargez la page.', 'warn', 9000);
  }

  // ------------------------------------------------------------ démarrage
  if (!FACE || !R) {
    say('Pas de face avant pour « ' + MODEL + ' ».', 'error', 0);
    return;
  }
  document.title = FACE.name + ' · Remote Station';
  build();
  wfTick();
  // Modes numériques (FT8, RTTY, CW…) sous l'image du TRX : le même module que le dashboard, sur la connexion de cette page
  if (window.RSDIGI) window.RSDIGI.init(digiApi);
  bmPopRestore();
  if (window.RSVOICE) {
    window.RSVOICE.init({ send, say, iControl, state: () => st, me: () => me, rig: () => R,
      sendBin: (buf) => { if (ws && ws.readyState === 1) ws.send(buf); } });
  }
  const sess = store.get('rs.sess', '');
  if (sess) creds = { session: sess };
  else showLogin('');
  connect();
  window.RSFACE = { state: () => S(), L, face: FACE }; // essais
})();
