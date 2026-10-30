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
    svg.setAttribute('viewBox', '0 0 ' + FACE.w + ' ' + FACE.h);
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
    el('image', { href: FACE.image, x: 0, y: 0, width: FACE.w, height: FACE.h }, svg);
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
      if (k.led) {
        const e = k.r != null
          ? el('circle', { cx: k.cx, cy: k.cy, r: k.r + (k.ring ? 4 : 1), class: 'led' + (k.ring ? ' ring' : ''), style: '--c:' + (k.ledColor || '#ffb020') }, leds)
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
    const box = { x: sc.x + 8, y: sc.y + 165, w: sc.w - 16, h: 129 };
    const cv = $('scope');
    cv.style.left = (box.x / FACE.w * 100) + '%';
    cv.style.top = (box.y / FACE.h * 100) + '%';
    cv.style.width = (box.w / FACE.w * 100) + '%';
    cv.style.height = (box.h / FACE.h * 100) + '%';
    LCD.scopeBox = box;
  }
  function toImg(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  }

  // Écran du TRX (positions relatives à FACE.lcd)
  function buildLcd() {
    const c = FACE.lcd;
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const g = el('g', { class: 'lcd' }, svg);
    el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 6, fill: 'url(#lcdbg)' }, g);
    const half = (c.w - 16) / 2;
    // Mètres
    for (const [i, side] of [[0, 'A'], [1, 'B']]) {
      const x0 = X(8 + i * (half + 0));
      const m = LCD['m' + side] = {};
      el('rect', { x: x0, y: Y(6), width: half - 6, height: 11, rx: 2, class: 'lcd-tbar' }, g);
      m.title = el('text', { x: x0 + (half - 6) / 2, y: Y(15), class: 'lcd-ttl', 'text-anchor': 'middle' }, g, side === 'A' ? 'MAIN · S-MÈTRE' : 'SUB · S-MÈTRE');
      el('rect', { x: x0 + 4, y: Y(26), width: half - 50, height: 11, rx: 2, class: 'lcd-track' }, g);
      m.fill = el('rect', { x: x0 + 4, y: Y(26), width: 0, height: 11, rx: 2, class: 'lcd-fill' }, g);
      m.scale = el('text', { x: x0 + 4, y: Y(48), class: 'lcd-scale' }, g, '');
      el('rect', { x: x0 + 4, y: Y(54), width: half - 50, height: 7, rx: 2, class: 'lcd-track' }, g);
      m.fill2 = el('rect', { x: x0 + 4, y: Y(54), width: 0, height: 7, rx: 2, class: 'lcd-fill2' }, g);
      m.lab2 = el('text', { x: x0 + 4, y: Y(73), class: 'lcd-scale' }, g, '');
      m.val = el('text', { x: x0 + half - 10, y: Y(38), class: 'lcd-mval', 'text-anchor': 'end' }, g, '');
      m.val2 = el('text', { x: x0 + half - 10, y: Y(62), class: 'lcd-mval2', 'text-anchor': 'end' }, g, '');
      m.w = half - 50;
    }
    // Ligne VFO
    for (const [i, side] of [[0, 'A'], [1, 'B']]) {
      const x0 = X(8 + i * half);
      const v = LCD['v' + side] = {};
      el('text', { x: x0 + 2, y: Y(97), class: 'lcd-vfo' }, g, 'VFO');
      v.tx = el('text', { x: x0 + 36, y: Y(97), class: 'lcd-txb' }, g, '');
      v.badge = el('rect', { x: x0 + 1, y: Y(101), width: 52, height: 15, rx: 2, class: 'lcd-mode' }, g);
      v.mode = el('text', { x: x0 + 27, y: Y(113), class: 'lcd-modet', 'text-anchor': 'middle' }, g, '—');
      v.freq = el('text', { x: x0 + half - 8, y: Y(118), class: 'lcd-freq', 'text-anchor': 'end' }, g, '—');
      v.sel = el('rect', { x: x0 + 58, y: Y(121), width: half - 66, height: 2, class: 'lcd-sel' }, g);
      v.hit = el('rect', { x: x0 + 58, y: Y(86), width: half - 66, height: 34, class: 'hs lcd-hit' }, g);
      el('title', {}, v.hit, 'Taper une fréquence pour le VFO ' + side);
      v.hit.addEventListener('click', () => askFreq(side));
    }
    // ANT / ATT / IPO / R.FIL / AGC
    const CELLS = [['ANT', 'ant', 'ant'], ['ATT', 'att', 'attB'], ['IPO', 'preamp', 'preampB'], ['R.FIL', 'roof', 'roofB'], ['AGC', 'agc', 'agcB']];
    for (const [i, side] of [[0, 'A'], [1, 'B']]) {
      const x0 = X(8 + i * half);
      const cw = (half - 6) / 5;
      LCD['c' + side] = CELLS.map(([lab, ka, kb], j) => {
        const id = side === 'A' ? ka : kb;
        const x = x0 + j * cw;
        el('rect', { x: x + 1, y: Y(124), width: cw - 2, height: 24, rx: 2, class: 'lcd-cell' }, g);
        el('text', { x: x + cw / 2, y: Y(133), class: 'lcd-clab', 'text-anchor': 'middle' }, g, lab);
        const t = el('text', { x: x + cw / 2, y: Y(145), class: 'lcd-cval', 'text-anchor': 'middle' }, g, '—');
        const h = el('rect', { x: x + 1, y: Y(124), width: cw - 2, height: 24, class: 'hs lcd-hit' }, g);
        el('title', {}, h, lab + ' ' + (side === 'A' ? 'MAIN' : 'SUB') + ' : clic pour changer');
        h.addEventListener('click', () => cycleCell(id));
        return { id, t };
      });
    }
    // Bandeau MAIN / SUB + état
    el('rect', { x: X(8), y: Y(151), width: c.w - 16, height: 12, rx: 2, class: 'lcd-tbar' }, g);
    LCD.side = el('text', { x: X(14), y: Y(160), class: 'lcd-side' }, g, 'MAIN');
    LCD.flags = el('text', { x: X(c.w - 14), y: Y(160), class: 'lcd-flags', 'text-anchor': 'end' }, g, '');
    // Zone du scope : état des réglages (le spectre de l'écoute la recouvre)
    const sy = Y(165);
    el('rect', { x: X(8), y: sy, width: c.w - 16, height: 129, rx: 3, class: 'lcd-scope' }, g);
    LCD.dsp = {};
    for (const [i, side] of [[0, 'A'], [1, 'B']]) {
      const x0 = X(16 + i * half);
      LCD.dsp[side] = [0, 1, 2, 3, 4].map((j) => el('text', { x: x0, y: sy + 18 + j * 17, class: 'lcd-dsp' }, g, ''));
    }
    LCD.hint = el('text', { x: X(c.w / 2), y: sy + 120, class: 'lcd-hint', 'text-anchor': 'middle' }, g, 'PHONES (prise à gauche) : écouter le TRX et voir le spectre de la BF');
    // Touches de l'écran : réglages utiles sans touche sur la face avant
    const SOFT = [['PWR −', () => power(-5)], ['PWR', null], ['PWR +', () => power(5)], ['TUNER', () => setCtl('tuner', S().tuner ? 0 : 1)],
      ['NAR', () => { const id = activeSide() === 'B' ? 'narrowB' : 'narrow'; setCtl(id, S()[id] ? 0 : 1); }], ['A → B', () => setCtl('aToB', null)], ['B → A', () => setCtl('bToA', null)]];
    const sw = (c.w - 16) / SOFT.length;
    LCD.soft = SOFT.map(([lab, fn], j) => {
      const x = X(8) + j * sw;
      const r = el('rect', { x: x + 2, y: Y(298), width: sw - 4, height: 19, rx: 3, class: 'lcd-soft' + (fn ? '' : ' ro') }, g);
      const t = el('text', { x: x + sw / 2, y: Y(311), class: 'lcd-softt', 'text-anchor': 'middle' }, g, lab);
      if (fn) {
        const h = el('rect', { x: x + 2, y: Y(298), width: sw - 4, height: 19, class: 'hs lcd-hit' }, g);
        el('title', {}, h, lab);
        h.addEventListener('click', fn);
      }
      return { r, t, lab };
    });
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
      drag = { part: knobPart(k, p), y: ev.clientY, a: Math.atan2(p.y - k.cy, p.x - k.cx), acc: 0 };
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
      if (n) { drag.acc -= n; turn(k, drag.part, n, ev); }
    });
    const end = () => { drag = null; g.classList.remove('grab'); hideTip(600); };
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
    for (const side of ['A', 'B']) {
      const m = LCD['m' + side];
      const sm = side === 'A' ? s.smeter : s.smeterB;
      if (tx && side === 'A') {
        const pw = s.m5 != null ? Math.round(s.m5 / 255 * ((R.POWER_RANGE && R.POWER_RANGE[s.powerHead] ? R.POWER_RANGE[s.powerHead][1] : 100))) : null;
        m.title.textContent = 'PO · COMP';
        m.fill.setAttribute('width', m.w * sFrac(s.m5));
        m.fill.classList.add('tx');
        m.scale.textContent = '0     25     50     75    100 %';
        m.val.textContent = pw != null ? pw + ' W' : 'TX';
        m.fill2.setAttribute('width', m.w * sFrac(s.m3));
        m.lab2.textContent = 'COMP';
        m.val2.textContent = s.m3 != null ? Math.round(s.m3 / 255 * 30) + ' dB' : '';
      } else if (tx && side === 'B') {
        const swr = R.swrValue ? R.swrValue(s.m6) : null;
        m.title.textContent = 'ALC · SWR';
        m.fill.setAttribute('width', m.w * sFrac(s.m4));
        m.fill.classList.add('tx');
        m.scale.textContent = 'ALC';
        m.val.textContent = s.m4 != null ? Math.round(s.m4 / 255 * 100) + ' %' : '';
        m.fill2.setAttribute('width', m.w * Math.min(1, swr ? (swr - 1) / 2 : 0));
        m.lab2.textContent = 'SWR';
        m.val2.textContent = swr ? swr.toFixed(1) : '';
      } else {
        m.title.textContent = (side === 'A' ? 'MAIN' : 'SUB') + ' · S-MÈTRE';
        m.fill.classList.remove('tx');
        const show = live && (side === 'A' || subOn);
        m.fill.setAttribute('width', show ? m.w * sFrac(sm) : 0);
        m.scale.textContent = 'S 1   3   5   7   9  +20  +40  +60';
        m.val.textContent = show ? R.smeterLabel(sm) : side === 'B' && !subOn ? 'SUB coupé' : '—';
        m.fill2.setAttribute('width', 0);
        m.lab2.textContent = side === 'A' ? 'PWR ' + (s.power != null ? s.power + ' W' : '—') : (s.vdd ? '' : '');
        m.val2.textContent = '';
      }
      const v = LCD['v' + side];
      const mode = side === 'A' ? s.mode : s.modeB;
      const f = side === 'A' ? s.freq : s.freqB;
      v.mode.textContent = mode || '—';
      v.freq.textContent = f ? fmtFreq(f) : '—';
      const active = (s.vfoSel === 1) === (side === 'B');
      v.freq.classList.toggle('dim', side === 'B' && !subOn);
      v.sel.classList.toggle('on', active);
      const txSide = s.split ? 'B' : 'A';
      v.tx.textContent = txSide === side ? (tx ? 'TX ●' : 'TX') : '';
      v.tx.classList.toggle('on', tx && txSide === side);
      for (const c of LCD['c' + side]) c.t.textContent = cellText(c.id, s[c.id]);
      // Réglages DSP
      const sfx = side === 'B' ? 'B' : '';
      const on = (k) => (s[k + sfx] ? '●' : '○');
      const wc = R.CONTROL['width' + sfx];
      const lines = [
        (side === 'A' ? 'MAIN' : 'SUB') + (active ? '  ◀ actif' : ''),
        'NB ' + on('nb') + '  DNR ' + on('nr') + '  DNF ' + on('dnf') + '  NAR ' + on('narrow'),
        'NOTCH ' + on('notch') + ' ' + (s['notchFreq' + sfx] != null ? s['notchFreq' + sfx] + ' Hz' : '') + '  CONT ' + on('contour') + '  APF ' + on('apf'),
        'WIDTH ' + (wc ? fmtVal(wc, s['width' + sfx], s) : '—') + '  SHIFT ' + (s['shift' + sfx] != null ? (s['shift' + sfx] > 0 ? '+' : '') + s['shift' + sfx] + ' Hz' : '—'),
        'AF ' + (s[side === 'A' ? 'af' : 'afB'] != null ? Math.round(s[side === 'A' ? 'af' : 'afB'] / 255 * 100) + ' %' : '—') + '  RF ' + (s['rf' + sfx] != null ? Math.round(s['rf' + sfx] / 255 * 100) + ' %' : '—')
      ];
      LCD.dsp[side].forEach((t, j) => { t.textContent = live ? lines[j] : ''; });
    }
    LCD.side.textContent = s.vfoSel === 1 ? 'SUB' : 'MAIN';
    const fl = [];
    if (tx) fl.push('● TX');
    if (s.split) fl.push('SPLIT');
    if (s.rit || s.xit) fl.push((s.rit ? 'RIT' : '') + (s.rit && s.xit ? '/' : '') + (s.xit ? 'XIT' : '') + ' ' + ((s.clar || 0) > 0 ? '+' : '') + ((s.clar || 0) / 1000).toFixed(2) + 'k');
    if (s.lock) fl.push('LOCK');
    if (s.tuner) fl.push('TUNER');
    if (s.proc) fl.push('PROC');
    if (L.fine) fl.push('FINE'); else if (L.fast) fl.push('FAST');
    fl.push('PWR ' + (s.power != null ? s.power + ' W' : '—'));
    LCD.flags.textContent = live ? fl.join('  ·  ') : (st.station ? 'TRX muet (éteint ou câble ?)' : 'Station hors ligne');
    LCD.flags.classList.toggle('tx', tx);
    for (const b of LCD.soft) {
      if (b.lab === 'PWR') b.t.textContent = s.power != null ? s.power + ' W' : 'PWR';
      if (b.lab === 'TUNER') b.r.classList.toggle('on', !!s.tuner);
      if (b.lab === 'NAR') b.r.classList.toggle('on', !!s[activeSide() === 'B' ? 'narrowB' : 'narrow']);
    }
    LCD.hint.style.display = L.listening ? 'none' : '';
    $('scope').style.visibility = L.listening ? 'visible' : 'hidden';
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
    // Autre TRX en service : cette face avant n'est pas la bonne
    const cover = $('cover');
    const wrong = st && st.rigModel && st.rigModel !== MODEL;
    cover.hidden = !wrong;
    if (wrong) cover.innerHTML = '<p>Le TRX en service est le <b>' + esc(st.rigName || st.rigModel) + '</b>.<br>Cette page est la face avant du <b>' + esc(FACE.name) + '</b>.</p><p><a class="btn accent" href="/">Revenir au dashboard</a></p>';
  }
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------ écoute (prise PHONES) et spectre
  const player = { ctx: null, gain: null, an: null, next: 0 };
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
      player.an = player.ctx.createAnalyser();
      player.an.fftSize = 2048;
      player.an.smoothingTimeConstant = 0.5;
      player.gain.connect(player.an);
      player.an.connect(player.ctx.destination);
      volume();
    }
    player.ctx.resume();
    L.listening = true;
    player.next = 0;
    send({ t: 'listen', on: true });
    if (st && st.audio && !st.audio.active) say('La station n’envoie pas encore de son (audio pas activé sur la page Station).', 'warn');
    render();
    scopeLoop();
  }
  function stopListen() {
    L.listening = false;
    send({ t: 'listen', on: false });
    if (player.ctx) player.ctx.suspend();
    render();
  }
  function onAudio(data) {
    if (!L.listening || !player.ctx) return;
    const pcm = window.ULAW && ULAW.decodeFrame(new Uint8Array(data));
    if (!pcm) return;
    const ctx = player.ctx;
    const now = ctx.currentTime;
    if (player.next < now + 0.05) player.next = now + 0.2;
    else if (player.next > now + 0.8) return;
    const buf = ctx.createBuffer(1, pcm.length, pcm.rate || ULAW.RATE);
    buf.copyToChannel(pcm, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(player.gain);
    src.start(player.next);
    player.next += buf.duration;
  }
  let scopeOn = false;
  function scopeLoop() {
    if (scopeOn) return;
    scopeOn = true;
    const cv = $('scope');
    const c2 = cv.getContext('2d');
    let wf = null;
    const tick = () => {
      if (!L.listening || !player.an) { scopeOn = false; return; }
      const r = cv.getBoundingClientRect();
      const W = Math.max(50, Math.round(r.width)), H = Math.max(40, Math.round(r.height));
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; wf = null; }
      const bins = new Uint8Array(player.an.frequencyBinCount);
      player.an.getByteFrequencyData(bins);
      const nyq = player.ctx.sampleRate / 2;
      const maxHz = 4000;
      const nb = Math.max(2, Math.floor(bins.length * maxHz / nyq));
      const sh = Math.round(H * 0.45);
      // Cascade (moitié basse) : on décale d'une ligne vers le bas
      if (!wf) { c2.fillStyle = '#05070c'; c2.fillRect(0, 0, W, H); wf = true; }
      c2.drawImage(cv, 0, sh, W, H - sh - 1, 0, sh + 1, W, H - sh - 1);
      for (let x = 0; x < W; x++) {
        const v = bins[Math.floor(x / W * nb)] / 255;
        c2.fillStyle = 'hsl(' + Math.round(250 - v * 250) + ',90%,' + Math.round(8 + v * 55) + '%)';
        c2.fillRect(x, sh, 1, 1);
      }
      // Spectre (moitié haute)
      c2.fillStyle = '#05070c';
      c2.fillRect(0, 0, W, sh);
      c2.strokeStyle = 'rgba(80,110,160,.35)';
      c2.lineWidth = 1;
      for (let k = 1; k < 4; k++) { const x = Math.round(W * k * 1000 / maxHz) + 0.5; c2.beginPath(); c2.moveTo(x, 0); c2.lineTo(x, sh); c2.stroke(); }
      c2.fillStyle = 'rgba(140,170,220,.7)';
      c2.font = '10px "Roboto Mono", monospace';
      for (let k = 1; k < 4; k++) c2.fillText(k + 'k', W * k * 1000 / maxHz + 3, sh - 4);
      const gr = c2.createLinearGradient(0, 0, 0, sh);
      gr.addColorStop(0, '#ff5bd6'); gr.addColorStop(1, '#4a5cff');
      c2.fillStyle = gr;
      c2.beginPath();
      c2.moveTo(0, sh);
      for (let x = 0; x < W; x++) c2.lineTo(x, sh - (bins[Math.floor(x / W * nb)] / 255) * (sh - 4));
      c2.lineTo(W, sh);
      c2.closePath();
      c2.fill();
      setTimeout(() => requestAnimationFrame(tick), 50);
    };
    tick();
  }

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
      if (m.t === 'hello') {
        me = m;
        $('login').hidden = true;
        $('meCall').textContent = m.call;
        if (m.stationCall) $('stationCall').textContent = m.stationCall;
        if (m.clubName) $('clubName').textContent = m.clubName;
        if (m.session) { creds = { session: m.session }; store.set('rs.sess', m.session); }
        if (L.listening) send({ t: 'listen', on: true });
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
      } else if (m.t === 'notice') {
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
    turn(dial, 'outer', e.key === 'ArrowUp' ? 1 : -1, { clientX: r.left + r.width * dial.cx / FACE.w, clientY: r.top + r.height * (dial.cy - dial.ro) / FACE.h });
  });

  // ------------------------------------------------------------ démarrage
  if (!FACE || !R) {
    say('Pas de face avant pour « ' + MODEL + ' ».', 'error', 0);
    return;
  }
  document.title = FACE.name + ' · Remote Station';
  build();
  const sess = store.get('rs.sess', '');
  if (sess) creds = { session: sess };
  else showLogin('');
  connect();
  window.RSFACE = { state: () => S(), L, face: FACE }; // essais
})();
