/* Remote Station — page opérateur (disposition inspirée de RigPlane Core, licence MIT) */
(function () {
  'use strict';
  // Élément du dashboard, ou d'un cadre détaché dans sa propre fenêtre (panels.js)
  const $ = (id) => document.getElementById(id) || (window.RSPANELS ? window.RSPANELS.find(id) : null);
  const $$ = (sel) => (window.RSPANELS ? window.RSPANELS.all(sel) : Array.from(document.querySelectorAll(sel)));

  // ------------------------------------------------------------ données
  // Les touches de mode viennent du pilote de la radio connectée (codes différents chez Yaesu et Icom)
  // [libellé, kHz par défaut, mode conseillé (libellé) ou null, limites en kHz]
  const BANDS = [
    ['160M', 1840, 'LSB', 1800, 2000], ['80M', 3700, 'LSB', 3500, 4000], ['60M', 5357, null, 5250, 5450],
    ['40M', 7100, 'LSB', 7000, 7300], ['30M', 10136, null, 10100, 10150], ['20M', 14200, 'USB', 14000, 14350],
    ['17M', 18130, 'USB', 18068, 18168], ['15M', 21250, 'USB', 21000, 21450], ['12M', 24950, 'USB', 24890, 24990],
    ['10M', 28500, 'USB', 28000, 29700], ['6M', 50150, 'USB', 50000, 54000], ['2M', 144300, 'USB', 144000, 148000],
    ['70CM', 432200, 'USB', 430000, 440000]
  ];
  const STEPS = [[10, '10 Hz'], [100, '100 Hz'], [1000, '1 kHz'], [10000, '10 kHz'], [100000, '100 kHz']];
  // Où placer chaque réglage du pilote dans la page
  const LAYOUT = {
    ant: ['ant'],
    front: ['rf', 'agc'],
    filter: ['width', 'shift', 'contour', 'apf'],
    dual: ['vfoSel', 'split', 'dualRx', 'aToB', 'bToA', 'swap', 'lock'],
    audio: ['af', 'sql'],
    dsp: ['nb', 'nr', 'notch', 'notchFreq', 'dnf'],
    tune: ['tuner', 'tune'],
    tx: ['mic', 'proc', 'procLvl', 'vox']
  };
  // Réglages affichés sur les écrans VFO eux-mêmes (pas de bouton dans les cadres)
  // ATT, préampli (IPO / AMP1 / AMP2, AMP) et NARROW : un clic sur leur badge de l'écran VFO (plus de bouton dans les cadres)
  const IN_VFO = ['rit', 'xit', 'clar', 'clarClr', 'ritB', 'xitB', 'clarB', 'clarClrB', 'splitHw', 'widthB',
    'att', 'preamp', 'preampVU', 'narrow', 'narrowB', 'nbB', 'nrB', 'notchB', 'dnfB', 'attB', 'preampB', 'agcB', 'rfB', 'notchFreqB', 'shiftB', 'contourB', 'apfB'];
  // Réglages des cadres (RF front end, Filtre, DSP) qui suivent le VFO sélectionné (A / B) quand le TRX a leur équivalent côté SUB
  const SIDE_B = { nb: 'nbB', nr: 'nrB', notch: 'notchB', dnf: 'dnfB', narrow: 'narrowB', agc: 'agcB', rf: 'rfB', width: 'widthB',
    notchFreq: 'notchFreqB', shift: 'shiftB', contour: 'contourB', apf: 'apfB' };
  const SHORT = { clarClr: 'CLEAR', ant: 'ANT', aToB: 'A → B', bToA: 'B → A', swap: 'A ⇄ B', lock: 'LOCK', clar: 'Décal.', notchFreq: 'Fréq. notch', procLvl: 'Niveau proc', mic: 'Gain micro', sql: 'Squelch', af: 'AF level', rf: 'RF gain', width: 'BW', shift: 'IF shift', preamp: 'PRE', preampVU: 'AMP' };

  // Bouton HELP : manuel en français, ou en anglais si le navigateur n'est pas en français
  try { if (!/^fr\b/i.test(navigator.language || 'fr')) document.getElementById('helpBtn').href = '/help'; } catch (e) {}
  let ws = null;
  let creds = null;          // gardés en mémoire uniquement, pour se reconnecter
  let me = null;
  let st = null;
  let step = 100;
  let target = 'A';
  const pend = { A: null, B: null };
  const pendAt = { A: 0, B: 0 };
  let sendTimer = null;
  let retry = 0;
  let pttHeld = false;
  let pttCut = false;
  let hbTimer = null;
  let txLocalSince = 0;
  let msgTimer = null;
  let ctlRefs = {};
  let ctlModel = null;
  const ctlPending = {};
  const ctlTimers = {};
  const digits = { A: [], B: [] };

  const RIG = () => (st && st.radio && window.RIGS && window.RIGS[st.radio.model]) || window.FTX1;
  try { const s = Number(localStorage.getItem('rs.step')); if (STEPS.some((x) => x[0] === s)) step = s; } catch (e) {}

  // ------------------------------------------------------------ outils
  // La main appartient à une connexion (un onglet) : un même indicatif peut avoir plusieurs onglets ouverts
  const iControl = () => !!(st && me && (st.controllerCid != null ? st.controllerCid === me.cid : st.controller === me.call));
  const otherTab = () => !!(st && me && st.controller === me.call && !iControl());
  let hadControl = false; // cet onglet avait la main quand la liaison a été coupée
  function send(o) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
    if (o.t !== 'ping') hideIdle(); // toute action compte comme activité côté serveur
  }
  // Avertissement avant déconnexion pour inactivité
  let idleTimer = null;
  function idleBanner() {
    let el = $('idleBanner');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'idleBanner';
    el.className = 'idle-banner';
    el.setAttribute('role', 'alertdialog');
    el.hidden = true;
    const t = document.createElement('span');
    t.id = 'idleText';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn accent';
    b.textContent = 'Rester connecté';
    b.addEventListener('click', () => send({ t: 'stay' }));
    el.append(t, b);
    document.body.appendChild(el);
    return el;
  }
  function showIdle(seconds) {
    const el = idleBanner();
    let left = seconds;
    const draw = () => { $('idleText').textContent = 'Sans activité, vous serez déconnecté dans ' + left + ' s.'; };
    draw();
    el.hidden = false;
    clearInterval(idleTimer);
    idleTimer = setInterval(() => { left = Math.max(0, left - 1); draw(); }, 1000);
  }
  function hideIdle() {
    clearInterval(idleTimer);
    const el = $('idleBanner');
    if (el) el.hidden = true;
  }
  function say(text, level, ms) {
    const el = $('msg');
    el.textContent = text || '';
    el.className = 'msg' + (level ? ' ' + level : '');
    clearTimeout(msgTimer);
    if (text && ms !== 0) msgTimer = setTimeout(() => { el.textContent = ''; el.className = 'msg'; }, ms || 5000);
  }
  function lamp(id, cls) {
    const el = $(id);
    el.classList.remove('on', 'warn', 'tx');
    if (cls) el.classList.add(cls);
  }
  function bandName(hz) {
    if (hz == null) return '—';
    const b = BANDS.find((x) => hz >= x[3] * 1000 && hz <= x[4] * 1000);
    return b ? b[0] : 'GEN';
  }
  function powerRangeText(r) {
    const range = RIG().POWER_RANGE && RIG().POWER_RANGE[r.powerHead];
    if (!range) return '';
    const fmt = (w) => String(w).replace('.', ',');
    return ' · ' + (r.powerHead === '1' ? 'tête Field' : RIG().NAME.replace(/^\S+ /, '')) + ' ' + fmt(range[0]) + '–' + fmt(range[1]) + ' W';
  }
  function badge(el, text, cls) {
    el.textContent = text;
    el.className = 'badge' + (cls ? ' ' + cls : '');
  }

  // ------------------------------------------------------------ afficheurs de fréquence
  function buildFreq(which) {
    const box = $(which === 'A' ? 'freqA' : 'freqB');
    for (let i = 0; i < 9; i++) {
      const place = Math.pow(10, 8 - i);
      const d = document.createElement('span');
      d.className = 'd';
      d.dataset.place = place;
      d.textContent = '-';
      d.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        setTarget(which);
        tune((ev.deltaY < 0 ? 1 : -1) * Math.max(place, 10), which);
      }, { passive: false });
      // glisser vertical (souris ou doigt) : un pas tous les 14 px ; simple clic = choisir ce pas
      d.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        d.setPointerCapture(ev.pointerId);
        d._y = ev.clientY;
        d._moved = false;
      });
      d.addEventListener('pointermove', (ev) => {
        if (d._y == null) return;
        const dy = d._y - ev.clientY;
        if (Math.abs(dy) >= 14) {
          d._moved = true;
          d._y = ev.clientY;
          setTarget(which);
          tune(Math.sign(dy) * Math.max(place, 10), which);
        }
      });
      d.addEventListener('pointerup', () => {
        if (d._y != null && !d._moved) { setTarget(which); setStep(Math.max(10, Math.min(100000, place))); }
        d._y = null;
      });
      d.addEventListener('pointercancel', () => { d._y = null; });
      box.appendChild(d);
      digits[which].push(d);
      if (i === 2 || i === 5) {
        const s = document.createElement('span');
        s.className = 'sep';
        s.textContent = '.';
        box.appendChild(s);
      }
    }
  }
  // La fréquence doit tenir entre « VFO / mode » et RIT / XIT, quelle que soit la police (Verdana est plus large
  // que les polices à chasse fixe) : taille réduite si elle déborde, recalculée seulement si la largeur change
  const fitKey = { A: '', B: '' };
  function fitFreq(w) {
    const el = $('freq' + w);
    const wrap = el && el.parentElement;
    if (!wrap) return;
    const n = el.querySelectorAll('.d:not(.lead)').length;
    const key = n + ':' + wrap.clientWidth;
    if (fitKey[w] === key) return;
    fitKey[w] = key;
    el.style.fontSize = '';
    const unit = wrap.querySelector('.unit');
    const need = () => el.offsetWidth + (unit ? unit.offsetWidth + 6 : 0);
    for (let i = 0; i < 6 && need() > wrap.clientWidth; i++) {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      el.style.fontSize = Math.max(14, Math.floor(fs * (wrap.clientWidth / need()) * 0.98)) + 'px';
    }
  }
  window.addEventListener('resize', () => { fitKey.A = ''; fitKey.B = ''; });
  function drawFreq(which, hz) {
    const s = hz == null ? '---------' : String(hz).padStart(9, '0');
    let lead = true;
    digits[which].forEach((d, i) => {
      const ch = s[i];
      if (ch !== '0' || i >= 2) lead = false;
      d.textContent = ch;
      d.classList.toggle('lead', hz != null && lead);
      d.classList.toggle('cur', which === target && Number(d.dataset.place) === step);
    });
  }

  // ------------------------------------------------------------ accord
  function currentFreq(which) {
    if (pend[which] != null && Date.now() - pendAt[which] < 1500) return pend[which];
    return st && st.radio ? (which === 'B' ? st.radio.freqB : st.radio.freq) : null;
  }
  function tune(delta, which) {
    which = which || target;
    if (!iControl()) return say('Prenez la main pour régler la radio.', 'warn');
    if (st.ptt && st.ptt.active) return say('Réglage bloqué pendant l’émission.', 'warn');
    const f = currentFreq(which);
    if (f == null) return;
    setFreq(f + delta, which);
  }
  function setFreq(hz, which) {
    which = which || target;
    hz = Math.round(Math.min(RIG().FREQ_MAX, Math.max(RIG().FREQ_MIN, hz)));
    pend[which] = hz;
    pendAt[which] = Date.now();
    render();
    if (sendTimer) return;
    sendTimer = setTimeout(() => {
      sendTimer = null;
      const msg = { t: 'set' };
      if (pend.A != null && Date.now() - pendAt.A < 1500) msg.freq = pend.A;
      if (pend.B != null && Date.now() - pendAt.B < 1500) msg.freqB = pend.B;
      send(msg);
    }, 120);
  }
  function setTarget(w) {
    if (target === w) return;
    target = w;
    render();
  }
  function setStep(s) {
    step = s;
    try { localStorage.setItem('rs.step', String(s)); } catch (e) {}
    render();
  }

  // ------------------------------------------------------------ touches fixes
  function mkBtn(label, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn' + (cls ? ' ' + cls : '');
    b.textContent = label;
    return b;
  }
  // Touches de mode et de bande : dépendent du modèle connecté (codes de mode, couverture)
  function buildKeys(R) {
    $('modeKeys').textContent = '';
    $('bandKeys').textContent = '';
    for (const [code, name] of R.MODE_KEYS || []) {
      const b = mkBtn(name);
      b.dataset.code = code;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        if (!iControl()) return say('Prenez la main pour changer de mode.', 'warn');
        if (st.ptt && st.ptt.active) return say('Réglage bloqué pendant l’émission.', 'warn');
        send({ t: 'set', mode: code, sub: target === 'B' });
      });
      $('modeKeys').appendChild(b);
    }
    for (const [name, khz, modeName] of BANDS) {
      if (khz * 1000 > R.FREQ_MAX) continue;
      const mk = modeName && (R.MODE_KEYS || []).find((x) => x[1] === modeName);
      const b = mkBtn(name);
      b.dataset.band = name;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        if (!iControl()) return say('Prenez la main pour changer de bande.', 'warn');
        if (st.ptt && st.ptt.active) return say('Réglage bloqué pendant l’émission.', 'warn');
        // TRX avec sélection de bande (FTX-1) : comme la touche BAND, il rappelle sa dernière fréquence et son mode
        // FTX-1 en réception simple avec MAIN actif : le côté SUB est arrêté et refuse la sélection de bande (BS1…, « ? ») ;
        // on règle alors directement la fréquence du VFO B (fréquence habituelle de la bande)
        const r0 = (st && st.radio) || {};
        const subOff = target === 'B' && R.ID === 'ftx1' && r0.dualRx === 0 && r0.vfoSel !== 1;
        if (R.cmdBand && R.BAND_CODES && R.BAND_CODES[name] && !subOff) return send({ t: 'set', band: name, sub: target === 'B' });
        setFreq(khz * 1000, target);
        if (mk) setTimeout(() => send({ t: 'set', mode: mk[0], sub: target === 'B' }), 200);
      });
      $('bandKeys').appendChild(b);
    }
  }
  function buildStatic() {
    for (const [s, label] of STEPS) {
      const b = mkBtn(label, 'accent');
      b.dataset.step = s;
      b.addEventListener('click', () => setStep(s));
      $('stepKeys').appendChild(b);
    }
    $('lampStation').addEventListener('click', (ev) => { ev.stopPropagation(); toggleRigMenu(); });
    $('usersBtn').addEventListener('click', (ev) => { ev.stopPropagation(); closeRigMenu(); toggleUsersMenu(); });
    $('usersMenu').addEventListener('click', (ev) => ev.stopPropagation());
    $('badgesA').addEventListener('click', badgeClick);
    $('badgesB').addEventListener('click', badgeClick);
    document.addEventListener('click', () => { $('usersMenu').hidden = true; $('usersBtn').setAttribute('aria-expanded', 'false'); });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('usersMenu').hidden) toggleUsersMenu(false); });
    $('rigMenu').addEventListener('click', (ev) => ev.stopPropagation());
    document.addEventListener('click', closeRigMenu);
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeRigMenu(); });
    $('listenBtn').addEventListener('click', () => (player.on ? stopListen() : startListen()));
    try { const v = localStorage.getItem('rs.vol'); if (v != null) $('listenVol').value = v; } catch (e) {}
    $('listenVol').addEventListener('input', playerVolume);
    playerVolume();
    $('askBtn').addEventListener('click', () => {
      send({ t: 'ask' });
      $('askBtn').disabled = true;
      setTimeout(() => { $('askBtn').disabled = false; }, 15000);
    });
    $('chatForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = $('chatInput').value.trim();
      if (!v) return;
      send({ t: 'chat', text: v });
      $('chatInput').value = '';
    });
    // Touches A / B : VFO réglé ; sur un TRX qui choisit son côté par CAT (FTX-1 : MAIN / SUB), aussi le côté actif
    const pickVfo = (w) => {
      setTarget(w);
      const c = RIG().CONTROL && RIG().CONTROL.vfoSel;
      // FTX-1 : passage sur SUB par CAT bloqué si le serveur le demande (ftx1SubCat: false) ; B ne choisit alors que le VFO réglé
      const subOk = !(RIG().ID === 'ftx1' && me && !me.subCat);
      // FTX-1 en réception simple (deux bandes HF) : pas de changement de côté par CAT (il a fait émettre le TRX) ;
      // A / B ne choisissent que le VFO réglé (molette, flèches, bandes), le TRX reste sur son côté actif
      const single = RIG().ID === 'ftx1' && st && st.radio && st.radio.dualRx !== 1 && !(me && me.subSingle);
      if (single && Number(ctlValue('vfoSel')) !== (w === 'B' ? 1 : 0)) {
        return say('VFO ' + w + ' réglé (molette, flèches, bandes). Le TRX reste sur ' + (Number(ctlValue('vfoSel')) === 1 ? 'SUB' : 'MAIN') +
          ' : en réception simple, le changement de côté par le dashboard est bloqué (il a mis le FTX-1 en émission) ; pour écouter la fréquence du VFO B : A ⇄ B.', '', 8000);
      }
      if (c && RIG().VIRTUAL_SPLIT && iControl() && (w === 'A' || subOk) && Number(ctlValue('vfoSel')) !== (w === 'B' ? 1 : 0)) sendCtl(c, w === 'B' ? 1 : 0);
    };
    $('tgtA').addEventListener('click', () => pickVfo('A'));
    $('tgtB').addEventListener('click', () => pickVfo('B'));
    $('tuneUp').addEventListener('click', () => tune(step));
    $('tuneDown').addEventListener('click', () => tune(-step));
    $('vfoA').addEventListener('click', (ev) => { if (!ev.target.closest('.d')) setTarget('A'); });
    $('vfoB').addEventListener('click', (ev) => { if (!ev.target.closest('.d')) setTarget('B'); });
    // RIT / XIT / CLEAR sur chaque écran VFO (VFO B : FTX-1 seulement, clarifier du côté SUB)
    const ctlOr = (id, what) => {
      const c = RIG().CONTROL && RIG().CONTROL[id];
      if (!c) say('Le ' + (RIG().NAME || 'TRX') + ' n’a pas de ' + what + ' pilotable pour ce VFO', 'warn');
      return c;
    };
    const clickOn = (id, fn) => $(id).addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
    for (const [w, sfx] of [['A', ''], ['B', 'B']]) {
      clickOn(w === 'A' ? 'ritBadge' : 'ritBBadge', () => { const c = ctlOr('rit' + sfx, 'RIT'); if (c) sendCtl(c, ctlValue('rit' + sfx) ? 0 : 1); });
      clickOn(w === 'A' ? 'xitBadge' : 'xitBBadge', () => { const c = ctlOr('xit' + sfx, 'XIT'); if (c) sendCtl(c, ctlValue('xit' + sfx) ? 0 : 1); });
      clickOn('clr' + w, () => { const c = ctlOr('clarClr' + sfx, 'CLEAR'); if (c) { ctlPending['clar' + sfx] = { v: 0, at: Date.now() }; sendCtl(c, null); } });
      // Molette sur le décalage : ± 10 Hz (± 100 Hz avec Maj)
      for (const id of w === 'A' ? ['ritVal', 'xitVal'] : ['ritBVal', 'xitBVal']) {
        $(id).addEventListener('wheel', (ev) => {
          const c = RIG().CONTROL && RIG().CONTROL['clar' + sfx];
          if (!c) return;
          ev.preventDefault();
          if (ctlBlocked()) return say(ctlBlocked(), 'warn');
          const d = (ev.deltaY < 0 ? 1 : -1) * (ev.shiftKey ? 100 : 10);
          const v = Math.max(c.min, Math.min(c.max, Number(ctlValue('clar' + sfx) || 0) + d));
          ctlPending[c.id] = { v, at: Date.now() };
          sendCtlThrottled(c);
          render();
        }, { passive: false });
      }
    }
    // Molette sur « BW » de chaque écran VFO : largeur de filtre de ce VFO (VFO B : FTX-1, côté SUB)
    for (const w of ['A', 'B']) {
      $('width' + w).addEventListener('wheel', (ev) => {
        const R = RIG();
        const C = R.CONTROL || {};
        const id = w === 'A' ? (C.width ? 'width' : C.fil ? 'fil' : null) : (C.widthB ? 'widthB' : null);
        if (!id) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (ctlBlocked()) return say(ctlBlocked(), 'warn');
        const c = C[id];
        const r = (st && st.radio) || {};
        const up = ev.deltaY < 0;
        let v;
        if (c.type === 'width') {
          const t = R.widthTable && R.widthTable(r[c.modeKey || 'mode']);
          if (!t) return say('Pas de réglage de largeur dans ce mode (' + (r[c.modeKey || 'mode'] || '?') + ')', 'warn');
          if (c.when && !c.when(r)) return say(c.label + ' indisponible (NARROW enclenché ?)', 'warn');
          v = Math.max(1, Math.min(t.length, (Number(ctlValue(id)) || 1) + (up ? 1 : -1)));
        } else if (c.type === 'select') {
          const o = c.options.map((x) => x[0]);
          const i = Math.max(0, o.indexOf(Number(ctlValue(id))));
          v = o[Math.max(0, Math.min(o.length - 1, i + (up ? 1 : -1)))];
        } else return;
        if (v === Number(ctlValue(id))) return;
        ctlPending[c.id] = { v, at: Date.now() };
        sendCtlThrottled(c);
        render();
      }, { passive: false });
    }
    // Voyants TX / RX cliquables : TX = VFO d'émission (SPLIT : TX sur B), RX = VFO de réception (MAIN / SUB)
    for (const w of ['A', 'B']) {
      $('tx' + w).addEventListener('click', (ev) => {
        ev.stopPropagation();
        const c = RIG().CONTROL && RIG().CONTROL.split;
        if (!c) return say('Choix du VFO d’émission non disponible sur ce TRX', 'warn');
        // FTX-1 : émettre sur ce VFO = SPLIT si on écoute sur l'autre ; autres TRX : VFO d'émission
        const rxB = Number(ctlValue('vfoSel')) === 1;
        const v = RIG().VIRTUAL_SPLIT ? ((w === 'B') !== rxB ? 1 : 0) : w === 'B' ? 1 : 0;
        if (Number(ctlValue('split')) !== v) sendCtl(c, v);
      });
      $('rx' + w).addEventListener('click', (ev) => {
        ev.stopPropagation();
        const c = RIG().CONTROL && RIG().CONTROL.vfoSel;
        if (!c) return say('Le ' + (RIG().NAME || 'TRX') + ' ne permet pas de choisir le VFO de réception par CAT : il reçoit sur le VFO A', 'warn');
        const v = w === 'B' ? 1 : 0;
        if (Number(ctlValue('vfoSel')) !== v) sendCtl(c, v);
      });
    }
    $('ctrlBtn').addEventListener('click', () => {
      if (!st) return;
      if (iControl()) send({ t: 'release' });
      else if (!st.controller || otherTab()) send({ t: 'take' });
      else if (me.admin && confirm('Reprendre la main à ' + st.controller + ' ?')) send({ t: 'take', force: true });
    });
    const nudgePower = (dir) => {
      if (!iControl()) return say('Prenez la main pour régler la puissance.', 'warn');
      const r = st.radio || {};
      const range = RIG().POWER_RANGE[r.powerHead];
      if (!range || r.power == null) return say('Puissance du TRX pas encore lue.', 'warn');
      const stepW = (RIG().POWER_STEP && RIG().POWER_STEP[r.powerHead]) || 5;
      const top = Math.min(range[1], me.maxWatts);
      const w = Math.max(range[0], Math.min(top, Math.round((r.power + dir * stepW) / stepW) * stepW));
      if (w === r.power) return say(dir > 0 ? 'Maximum atteint : ' + top + ' W' + (me.maxWatts < range[1] ? ' (limite de votre licence)' : '') : 'Minimum atteint : ' + range[0] + ' W', 'warn');
      send({ t: 'set', power: w });
    };
    $('pwrDown').addEventListener('click', () => nudgePower(-1));
    $('pwrUp').addEventListener('click', () => nudgePower(1));
    $('logout').addEventListener('click', () => {
      if (ws && ws.readyState === 1) send({ t: 'logout' }); // le serveur oublie la session mémorisée
      forgetSession();
      creds = null;
      hadControl = false;
      if (player.on) stopListen();
      if (ws) ws.close();
      me = null;
      showLogin('');
    });
    const bars = (id) => { for (let i = 0; i < 30; i++) $(id).appendChild(document.createElement('i')); };
    bars('barsA');
    bars('barsB');
    buildFreq('A');
    buildFreq('B');
  }

  // ------------------------------------------------------------ réglages générés depuis le pilote
  // Badge d'un écran VFO lié à un réglage : un clic l'enclenche / le coupe (liste : valeur suivante ; niveau : 0 ↔ dernier niveau)
  const badgeLvl = {};
  function badgeCtl(el, c, r) {
    if (!c) return;
    const ok = !c.when || c.when(r);
    if (!ok) return;
    el.dataset.ctl = c.id;
    el.classList.add('clk');
    el.title = c.label + ' : clic pour ' + (c.type === 'select' ? 'passer au réglage suivant' : 'enclencher / couper');
  }
  function badgeClick(ev) {
    const el = ev.target.closest('[data-ctl]');
    if (!el) return;
    const c = (RIG().CONTROL || {})[el.dataset.ctl];
    if (!c) return;
    if (ctlBlocked()) return say(ctlBlocked(), 'warn');
    const cur = Number(ctlValue(c.id)) || 0;
    let v;
    if (c.type === 'toggle') v = cur ? 0 : 1;
    else if (c.type === 'select') { const o = c.options.map((x) => x[0]); v = o[(o.indexOf(cur) + 1) % o.length]; }
    else if (c.type === 'level') {
      if (cur) badgeLvl[c.id] = cur;
      v = cur ? (c.off0 ? 0 : c.min) : badgeLvl[c.id] || Math.round((c.min + c.max) / 2) || c.max;
    } else return;
    sendCtl(c, v);
  }
  // Côté réglé par les cadres RF front end / Filtre / DSP : le côté actif du TRX (MAIN / SUB)
  const panelSide = () => (Number(ctlValue('vfoSel')) === 1 ? 'B' : 'A');
  // Réglage effectivement visé : celui du côté SUB quand SUB est actif et que le TRX le permet
  function sc(c) {
    const b = panelSide() === 'B' && SIDE_B[c.id] && RIG().CONTROL && RIG().CONTROL[SIDE_B[c.id]];
    return b || c;
  }
  let lastSide = null;
  function ctlValue(id) {
    const p = ctlPending[id];
    if (p && Date.now() - p.at < 1500) return p.v;
    return st && st.radio ? st.radio[id] : null;
  }
  function fmtCtl(c, v, r) {
    if (v == null) return '—';
    if (c.type === 'width') {
      const t = RIG().widthTable(r && r[c.modeKey || 'mode']);
      const hz = t && t[v - 1];
      return hz ? (hz >= 1000 ? (hz / 1000).toFixed(hz % 100 ? 2 : 1) + ' kHz' : hz + ' Hz') : '—';
    }
    if (c.fmt) return c.fmt(v);
    if (c.pct) return Math.round((v / 255) * 100) + ' %';
    if (c.off0 && v === 0) return 'OFF';
    if (c.unit) return (c.min < 0 && v > 0 ? '+' : '') + v + ' ' + c.unit;
    return String(v);
  }
  function ctlBlocked() {
    if (!iControl()) return 'Prenez la main pour régler la radio.';
    if (st.ptt && st.ptt.active) return 'Réglage bloqué pendant l’émission.';
    return null;
  }
  function sendCtl(c, v) {
    const why = ctlBlocked();
    if (why) return say(why, 'warn');
    // FTX-1 : passage sur SUB par CAT désactivé (il faisait émettre le TRX) — refus immédiat, sans faire clignoter SUB
    if (RIG().ID === 'ftx1' && me && !me.subCat && (c.id === 'vfoSel' && v === 1 || (c.viaSub && Number(ctlValue('vfoSel')) !== 1) || (c.viaMain && Number(ctlValue('vfoSel')) === 1))) {
      return say('Passage MAIN ↔ SUB par le dashboard désactivé (il mettait le FTX-1 en émission) : choisissez MAIN / SUB sur la face avant du TRX ; le dashboard suit.', 'warn', 8000);
    }
    // FTX-1 en réception simple (DUAL RX coupé) : aucun passage MAIN ↔ SUB par CAT (VS1 a mis le TRX en émission, 24 et 25/10)
    if (RIG().ID === 'ftx1' && st && st.radio && st.radio.dualRx !== 1 && !(me && me.subSingle)) {
      const sel = Number(ctlValue('vfoSel')) === 1 ? 1 : 0;
      if ((c.id === 'vfoSel' && v != null && Number(v) !== sel) || (c.viaSub && sel !== 1) || (c.viaMain && sel === 1)) {
        if (c.id === 'vfoSel' && Number(v) === 1) setTarget('B');
        return say('Passage MAIN ↔ SUB refusé en réception simple (DUAL RX coupé) : le 25/10, il a mis le FTX-1 en émission. En HF, le FTX-1 n’écoute qu’un côté à la fois ; pour écouter la fréquence du VFO B, utilisez A ⇄ B. Un administrateur peut l’autoriser pour des essais (ftx1SubSingle). Le VFO B se règle quand même (molette, flèches, bandes).', 'warn', 12000);
      }
    }
    // FTX-1 : pas de double réception avec MAIN et SUB tous deux en HF / 50 MHz, même sur la même bande
    // (constaté au club : 14 + 21 MHz refusé le 24/10, 7,074 + 7,090 MHz refusé le 25/10 ; 432 + 21 MHz accepté)
    if (c.id === 'dualRx' && v === 1 && RIG().ID === 'ftx1') {
      const r0 = (st && st.radio) || {};
      if (r0.freq && r0.freqB && r0.freq < 60e6 && r0.freqB < 60e6) {
        return say('DUAL RX : le FTX-1 n’accepte pas la double réception avec les deux VFO en HF / 50 MHz, même sur la même bande. Pour écouter deux stations de la même bande : les deux décodeurs de l’onglet RTTY (même bande passante) ; sinon, mettez l’un des VFO en 144 ou 430 MHz.', 'warn', 12000);
      }
    }
    if (c.id === 'vfoSel' && v != null) target = v ? 'B' : 'A'; // MAIN / SUB : les cadres suivent ce VFO
    if (c.type !== 'action') ctlPending[c.id] = { v, at: Date.now() };
    send({ t: 'set', ctl: c.id, value: v });
    // Tuner mis en service mais relu « hors service » : le TRX ne l'a pas pris (menu du TRX, tuner absent…)
    if (c.id === 'tuner' && v === 1) {
      setTimeout(() => {
        const r = (st && st.radio) || {};
        if (r.connected && !r.tuner) say('Le TRX n’a pas mis son tuner en service. Vérifiez : FTX-1 raccordé au SPA-1 (le tuner interne est dans le SPA-1) ou tuner externe branché, menu TUNER SELECT (INT / INT FAST / EXT / ATAS) et TUNER TYPE SEL de l’antenne.', 'warn', 12000);
      }, 3500);
    }
    render();
  }
  function sendCtlThrottled(c) {
    if (ctlTimers[c.id]) return;
    ctlTimers[c.id] = setTimeout(() => {
      ctlTimers[c.id] = null;
      const p = ctlPending[c.id];
      if (p && !ctlBlocked()) send({ t: 'set', ctl: c.id, value: p.v });
    }, 200);
  }
  function rowFor(box) {
    const last = box.lastElementChild;
    if (last && last.classList.contains('ctl-row') && last.children.length < 2) return last;
    const row = document.createElement('div');
    row.className = 'ctl-row';
    box.appendChild(row);
    return row;
  }
  function buildControls() {
    const R = RIG();
    ctlModel = R.ID;
    ctlRefs = {};
    buildKeys(R);
    const boxes = { ant: 'sec-ant', front: 'sec-front', filter: 'sec-filter', dual: 'sec-dual', audio: 'sec-audio', dsp: 'sec-dsp', tune: 'sec-tune', tx: 'sec-tx' };
    // TXW (placé dans la rangée MAIN / SUB) mis de côté avant de vider les cadres, puis remis par render()
    if ($('txwBtn') && $('txwBtn').closest('#sec-dual')) $('sec-dual').after($('txwBtn'));
    for (const k in boxes) $(boxes[k]).textContent = '';
    $('sec-other').textContent = '';
    const where = {};
    const order = [];
    for (const k in LAYOUT) for (const id of LAYOUT[k]) { where[id] = boxes[k]; if (R.CONTROL && R.CONTROL[id]) order.push(R.CONTROL[id]); }
    for (const c of R.CONTROLS || []) if (order.indexOf(c) < 0) order.push(c);
    for (const c of order) {
      if (IN_VFO.indexOf(c.id) >= 0) continue; // RIT / XIT / CLEAR : sur les écrans VFO
      const box = $(where[c.id] || boxes[c.sec] || 'sec-other');
      const label = SHORT[c.id] || c.label;
      const ref = { c };
      if (c.type === 'toggle' || c.type === 'action') {
        const b = mkBtn(label, c.transmits ? 'btn-tx' : 'accent');
        if (c.type === 'toggle') b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => { const k = sc(c); sendCtl(k, k.type === 'action' ? null : (ctlValue(k.id) ? 0 : 1)); });
        rowFor(box).appendChild(b);
        ref.btn = b;
        ref.cell = b;
      } else if (c.type === 'select') {
        const cell = document.createElement('div');
        cell.className = 'ctl';
        if (where[c.id] !== 'sec-dual') {
          const h = document.createElement('div');
          h.className = 'ctl-head';
          const l = document.createElement('span');
          l.className = 'ctl-label';
          l.textContent = label;
          h.appendChild(l);
          cell.appendChild(h);
        }
        const grp = document.createElement('div');
        grp.className = 'seg seg-fill';
        ref.opts = c.options.map(([v, l]) => {
          const b = mkBtn(l.replace(/ \(.\)$/, ''), 'accent');
          b.setAttribute('aria-pressed', 'false');
          b.addEventListener('click', () => sendCtl(sc(c), v));
          grp.appendChild(b);
          return [v, b];
        });
        cell.appendChild(grp);
        box.appendChild(cell);
        ref.cell = cell;
      } else {
        const cell = document.createElement('div');
        cell.className = 'ctl';
        const head = document.createElement('div');
        head.className = 'ctl-head';
        const l = document.createElement('span');
        l.className = 'ctl-label';
        l.textContent = label;
        const out = document.createElement('output');
        out.className = 'ctl-val';
        head.append(l, out);
        const inp = document.createElement('input');
        inp.type = 'range';
        inp.min = c.type === 'level' ? c.min : 1;
        inp.max = c.type === 'level' ? c.max : 1;
        inp.step = c.type === 'level' ? c.step : 1;
        inp.setAttribute('aria-label', c.label);
        inp.addEventListener('input', () => {
          if (ctlBlocked()) return;
          const v = Number(inp.value);
          const k = sc(c);
          ctlPending[k.id] = { v, at: Date.now() };
          out.textContent = fmtCtl(k, v, st && st.radio);
          sendCtlThrottled(k);
        });
        inp.addEventListener('change', () => sendCtl(sc(c), Number(inp.value)));
        cell.append(head, inp);
        box.appendChild(cell);
        Object.assign(ref, { cell, inp, out });
      }
      if (ref.cell) ref.cell.dataset.ctl = c.id; // placement CSS (colonne DUAL compacte)
      ctlRefs[c.id] = ref;
    }
    // TRX sans choix d'antenne par CAT (FTDX10, IC-7300) : on l'indique au lieu de cacher la ligne
    if (!(R.CONTROL && R.CONTROL.ant)) {
      const cell = document.createElement('div');
      cell.className = 'ctl ctl-na';
      cell.title = 'Le ' + (R.NAME || 'TRX') + ' ne permet pas de choisir l’antenne par CAT : le faire sur la face avant (ou un commutateur d’antennes séparé).';
      const h = document.createElement('div');
      h.className = 'ctl-head';
      h.innerHTML = '<span class="ctl-label">ANT</span><span class="ctl-val">non pilotable à distance</span>';
      const grp = document.createElement('div');
      grp.className = 'seg seg-fill';
      for (const l of ['ANT 1', 'ANT 2']) { const b = mkBtn(l, 'accent'); b.disabled = true; grp.appendChild(b); }
      cell.append(h, grp);
      $(boxes.ant).appendChild(cell);
    }
  }
  let trxSince = 0;
  let lastBand = null, warnBand = null, warnAt = 0; // bande affichée / bande changée en attente d'un TUNE
  function updateControls(r, onAir) {
    const blocked = !iControl() || onAir;
    if (!r.connected) trxSince = 0; else if (!trxSince) trxSince = Date.now();
    // Pas de boîte d'accord (ex. FTX-1 sans l'ampli SPA-1) : la radio ne répond pas à la lecture du tuner → on cache TUNER et TUNE
    const noTuner = !!r.connected && r.tuner == null && Date.now() - trxSince > 4000;
    // Encart « Accord » visible seulement si le TRX a une boîte d'accord
    $('panelTune').hidden = noTuner || !(ctlRefs.tuner || ctlRefs.tune);
    for (const id in ctlRefs) {
      const c0 = ctlRefs[id].c;
      const { cell, btn, opts, inp, out } = ctlRefs[id];
      const c = sc(c0); // VFO B sélectionné : réglage du côté SUB
      // Réglage remplacé par un autre selon la bande (FTX-1 : préampli HF / AMP 144-430) : caché plutôt que grisé
      cell.hidden = (noTuner && (id === 'tuner' || id === 'tune')) || (!!c.hideUnavail && !!r.connected && !!c.when && !c.when(r));
      const v = ctlValue(c.id);
      const avail = !!r.connected && (!c.when || c.when(r)) && (c.type === 'action' || v != null);
      cell.classList.toggle('unavail', !avail);
      if (btn) {
        btn.disabled = blocked || !avail || (c.offOnly && !v);
        // Fonction inactive dans ce mode (ex. APF hors CW) : pas affichée comme enclenchée, même si la radio la garde en mémoire
        if (c.type === 'toggle') btn.setAttribute('aria-pressed', String(!!v && avail));
        if (c.type === 'toggle' && !c.offOnly) btn.title = v && !avail ? c.label + ' : activé dans la radio, sans effet dans ce mode' : '';
        if (c.offOnly) btn.title = v ? 'Couper ' + c.label : c.label + ' ne peut pas être activé à distance';
        if (c.transmits) {
          const why = pttReason();
          btn.disabled = btn.disabled || !!why;
          btn.title = why || 'Lance l’accord (émission de quelques secondes)';
          btn.classList.toggle('busy', !!r.tuning);
        }
      }
      if (opts) for (const [ov, b] of opts) { b.setAttribute('aria-pressed', String(v === ov)); b.disabled = blocked || !avail; }
      if (inp) {
        if (c.type === 'width') { const t = RIG().widthTable(r[c.modeKey || 'mode']); inp.max = t ? t.length : 1; }
        inp.disabled = blocked || !avail;
        const p = ctlPending[c.id];
        if (!(p && Date.now() - p.at < 1500) && v != null) inp.value = v;
        out.textContent = avail ? fmtCtl(c, v, r) : '—';
      }
    }
  }

  // ------------------------------------------------------------ PTT
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
    if (st.swrLock) return st.swrLock.text || 'ROS trop élevé ici : ' + (st.radio.tuner == null ? 'changez de fréquence ou vérifiez l’antenne' : 'faites TUNE d’abord');
    return null;
  }
  function pttDown() {
    if (pttHeld) return;
    const why = pttReason();
    if (why) return say(why, 'warn');
    pttHeld = true;
    pttCut = false;
    send({ t: 'ptt', on: true });
    hbTimer = setInterval(() => { if (!pttCut) send({ t: 'ptt', on: true }); }, 400);
    render();
  }
  function pttUp() {
    if (!pttHeld) return;
    pttHeld = false;
    clearInterval(hbTimer);
    send({ t: 'ptt', on: false });
    render();
  }
  function bindPtt() {
    const b = $('ptt');
    b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); b.setPointerCapture(ev.pointerId); pttDown(); });
    b.addEventListener('pointerup', pttUp);
    b.addEventListener('pointercancel', pttUp);
    b.addEventListener('lostpointercapture', pttUp);
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());
    const typing = (ev) => /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName) && ev.target.type !== 'range';
    document.addEventListener('keydown', (ev) => {
      if (typing(ev) || !me) return;
      if (ev.code === 'Space') { ev.preventDefault(); if (!ev.repeat) pttDown(); return; }
      if (ev.target.type === 'range') return;
      if (ev.key === 'ArrowUp') { ev.preventDefault(); tune(step); }
      if (ev.key === 'ArrowDown') { ev.preventDefault(); tune(-step); }
    });
    document.addEventListener('keyup', (ev) => { if (ev.code === 'Space') pttUp(); });
    window.addEventListener('blur', pttUp);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pttUp(); });
  }

  // ------------------------------------------------------------ rendu
  function meter(id, live, text, frac) {
    const el = $(id);
    el.classList.toggle('live', !!live);
    el.querySelector('.mt-v').textContent = text;
    el.querySelector('.mt-bar i').style.width = Math.max(0, Math.min(100, (frac || 0) * 100)) + '%';
  }

  // ------------------------------------------------------------ TRX du club (barre du haut, changement par un admin)
  const shortName = (n) => String(n).replace(/^\S+\s/, '');
  function rigList() { return (me && me.rigs) || []; }
  function drawRigList() {
    const el = $('rigLabel');
    const list = rigList();
    el.textContent = '';
    if (!list.length) { el.textContent = st && st.rigName ? st.rigName : 'TRX'; return; }
    for (const r of list) {
      const s = document.createElement('span');
      s.className = 'rig' + (st && st.rigModel === r.id ? ' cur' : '');
      s.textContent = shortName(r.name);
      el.appendChild(s);
    }
  }
  function drawRigMenu() {
    const box = $('rigMenu');
    box.textContent = '';
    const h = document.createElement('h3');
    h.textContent = 'TRX du club';
    box.appendChild(h);
    const onAir = !!(st && ((st.ptt && st.ptt.active) || (st.radio && st.radio.tx)));
    for (const r of rigList()) {
      const cur = !!(st && st.rigModel === r.id);
      const port = !!(st && st.rigPorts && st.rigPorts[r.id]);
      const b = mkBtn('', 'accent rig-opt' + (cur ? ' cur' : ''));
      const name = document.createElement('span');
      name.textContent = r.name;
      const note = document.createElement('small');
      note.textContent = cur ? '✓ en service' : !st || !st.station ? 'station hors ligne' : port ? 'disponible' : 'port à choisir au club';
      b.append(name, note);
      b.setAttribute('role', 'menuitem');
      b.setAttribute('aria-pressed', String(cur));
      b.disabled = cur || !st || !st.station || !port || onAir;
      b.addEventListener('click', () => {
        if (!confirm('Passer sur le ' + r.name + ' ?\nLa station redémarre quelques secondes et la main est conservée.')) return;
        send({ t: 'switch_rig', model: r.id });
        closeRigMenu();
      });
      box.appendChild(b);
    }
    const p = document.createElement('p');
    p.textContent = onAir ? 'Changement impossible pendant une émission.'
      : 'Le TRX choisi doit être branché au PC du club, et son port déjà choisi une fois sur la page Station.';
    box.appendChild(p);
    // Recharger à distance la page Station du club (nouvelle version, page bloquée…)
    const rl = mkBtn('↻ Recharger la page Station', 'accent rig-opt');
    rl.disabled = !st || !st.station || onAir;
    rl.title = 'La page Station du PC du club se recharge (programme à jour) ; la station revient en une dizaine de secondes';
    rl.addEventListener('click', () => {
      if (!confirm('Recharger la page Station du PC du club ?\nLa station est coupée une dizaine de secondes, puis revient toute seule.')) return;
      send({ t: 'station_reload' });
      closeRigMenu();
    });
    box.appendChild(rl);
    // Console CAT de diagnostic : lecture d'une valeur brute du TRX (FB;, VS;, FT;, IF;…)
    if (RIG().CAT_QUERIES) {
      const cq = mkBtn('⌨ Lecture CAT…', 'accent rig-opt');
      cq.disabled = !st || !st.station;
      cq.title = 'Diagnostic : lire une valeur brute du TRX (lecture seulement)';
      cq.addEventListener('click', () => { closeRigMenu(); catConsole(); });
      box.appendChild(cq);
    }
  }
  // Console de lecture CAT (fenêtre dans la page, réponses listées) : lectures seulement, commandes de la liste du pilote
  function catConsole() {
    let dlg = document.getElementById('catDlg');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'catDlg';
      dlg.className = 'macro-dlg cat-dlg';
      dlg.innerHTML = '<form method="dialog"><h3>Lecture CAT (diagnostic, lecture seulement)</h3>' +
        '<div class="cat-row"><input name="cmd" maxlength="12" value="PA0;" autocomplete="off" spellcheck="false"><button class="btn btn-primary" type="button" data-a="go">Lire</button></div>' +
        '<div class="cat-quick"></div>' +
        '<pre class="cat-out"></pre>' +
        '<p class="md-prev cat-help"></p><div class="md-act"><span></span><button class="btn" type="button" data-a="clr">Effacer</button><button class="btn" value="close">Fermer</button></div></form>';
      document.body.appendChild(dlg);
      const f = dlg.querySelector('form');
      // Plusieurs lectures à la suite acceptées : « VS;FT;ST; » ou « VS, FT, ST »
      const go = (c) => {
        const list = String(c || f.cmd.value).toUpperCase().split(/[;,\s]+/).filter(Boolean).map((x) => x + ';');
        list.forEach((x, i) => setTimeout(() => { catOut('→ ' + x); send({ t: 'cat_query', cmd: x }); }, i * 400));
      };
      dlg.querySelector('[data-a="go"]').addEventListener('click', () => go());
      dlg.querySelector('[data-a="clr"]').addEventListener('click', () => { dlg.querySelector('.cat-out').textContent = ''; f.cmd.focus(); });
      const t = dlg.querySelector('[data-a="sidetest"]');
      if (t) t.addEventListener('click', () => sideTest(t));
      f.cmd.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      for (const c of ['VS;', 'FT;', 'ST;', 'FA;', 'FB;', 'IF;', 'PA0;', 'RA0;', 'AC;', 'RI0;', 'EX030103;', 'EX030104;', 'EX030701;', 'EX030702;']) {
        if (RIG().CAT_QUERIES.indexOf(c) < 0) continue;
        const b = mkBtn(c, 'accent');
        b.type = 'button';
        b.addEventListener('click', () => go(c));
        dlg.querySelector('.cat-quick').appendChild(b);
      }
      dlg.querySelector('.cat-help').textContent = 'Lectures possibles : ' + RIG().CAT_QUERIES.join(' ');
    }
    try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
    dlg.querySelector('input').focus();
  }
  // Lecture CAT qui attend sa réponse (test automatique)
  let catWait = null;
  function catAsk(cmd) {
    return new Promise((res) => {
      catWait = res;
      send({ t: 'cat_query', cmd });
      setTimeout(() => { if (catWait === res) { catWait = null; res(null); } }, 3000);
    });
  }
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  // FTX-1 : PA0 / RA0 suivent-ils le côté actif ? Lecture côté MAIN, passage sur SUB (ordre FT / VS sûr), lecture, retour sur MAIN
  async function sideTest(btn) {
    if (!iControl()) return catOut('Prenez d’abord la main.');
    if (st.ptt && st.ptt.active) return catOut('Pas pendant une émission.');
    const sel = (st.radio || {}).vfoSel ? 1 : 0;
    const c = RIG().CONTROL.vfoSel;
    btn.disabled = true;
    catOut('— Test : lecture côté MAIN, puis côté SUB, puis retour —');
    try {
      if (sel) { sendCtl(c, 0); await pause(1500); }
      const ok = (x) => (x && /^(PA|RA)\d/.test(x) ? x : null);
      const pm = ok(await catAsk('PA0;')); const am = ok(await catAsk('RA0;'));
      catOut('MAIN : préampli ' + pm + ' · ATT ' + am);
      sendCtl(c, 1); await pause(1500);
      const ps = ok(await catAsk('PA0;')); const as = ok(await catAsk('RA0;'));
      catOut('SUB  : préampli ' + ps + ' · ATT ' + as);
      sendCtl(c, sel); await pause(800);
      const name = (r) => { const m = /^PA0(\d)/.exec(r || ''); return m ? ['IPO', 'AMP1', 'AMP2'][+m[1]] : '?'; };
      const att = (r) => { const m = /^RA0(\d)/.exec(r || ''); return m ? (+m[1] ? 'ON' : 'OFF') : '?'; };
      catOut('Lu par CAT — MAIN : ' + name(pm) + ', ATT ' + att(am) + ' · SUB : ' + name(ps) + ', ATT ' + att(as));
      if (!pm || !ps || !am || !as) catOut('⚠ Une lecture sans réponse du TRX : test à refaire.');
      else if (pm !== ps || am !== as) catOut('✔ RÉSULTAT : le CAT lit le côté actif. ATT et préampli peuvent être réglés séparément pour chaque VFO.');
      else catOut('✘ RÉSULTAT : même lecture des deux côtés. Si l’écran du TRX montre des réglages différents pour MAIN et SUB, le CAT ne voit que MAIN.');
      catOut('Comparez avec l’écran du TRX (bas des cadres MAIN et SUB) et envoyez une capture de cette fenêtre.');
    } finally { btn.disabled = false; }
  }
  function catOut(line) {
    const o = document.querySelector('#catDlg .cat-out');
    if (!o) return false;
    o.textContent += line + '\n';
    o.scrollTop = o.scrollHeight;
    return true;
  }
  // Membres connectés : nombre dans la barre du haut, liste au clic
  function drawUsersMenu() {
    const box = $('usersList');
    box.textContent = '';
    const h = document.createElement('h3');
    const list = (st && st.users) || [];
    h.textContent = list.length + (list.length > 1 ? ' membres connectés' : ' membre connecté');
    box.appendChild(h);
    for (const call of list) {
      const row = document.createElement('div');
      const isCtrl = st.controller === call;
      row.className = 'u' + (me && call === me.call ? ' me' : '') + (isCtrl ? ' ctrl' : '');
      const b = document.createElement('b');
      b.textContent = call;
      const note = document.createElement('small');
      const tx = st.ptt && st.ptt.active && st.ptt.by === call;
      note.textContent = tx ? 'en émission' : isCtrl ? 'a la main' : me && call === me.call ? 'vous' : /^ONL/.test(call) ? 'écouteur' : '';
      row.append(b, note);
      box.appendChild(row);
    }
    if (st && st.audio && st.audio.listeners) {
      const p = document.createElement('p');
      p.textContent = '🔊 ' + st.audio.listeners + ' à l’écoute de la BF';
      box.appendChild(p);
    }
  }
  function toggleUsersMenu(force) {
    const open = force != null ? force : $('usersMenu').hidden;
    if (open) { drawUsersMenu(); $('usersDot').hidden = true; }
    $('usersMenu').hidden = !open;
    $('usersBtn').setAttribute('aria-expanded', String(open));
    if (open) $('chat').scrollTop = $('chat').scrollHeight;
  }
  function closeRigMenu() {
    $('rigMenu').hidden = true;
    $('lampStation').setAttribute('aria-expanded', 'false');
  }
  function toggleRigMenu() {
    if (!me || !me.admin) return;
    const open = $('rigMenu').hidden;
    if (open) drawRigMenu();
    $('rigMenu').hidden = !open;
    $('lampStation').setAttribute('aria-expanded', String(open));
  }

  // « TX call » : indicatif des émissions numériques (station ou le sien), choisi par celui qui a la main
  let txcSent = null;
  function drawTxCall() {
    const sel = $('txCallSel');
    if (!sel || !me) return;
    const club = String(me.digiCall || 'ON5VL').toUpperCase();
    const mine = String(me.call || '').toUpperCase();
    const opts = [club].concat(me.canTx && !me.rxOnly && mine && mine !== club ? [mine] : []);
    if (sel.dataset.opts !== opts.join(',')) {
      sel.dataset.opts = opts.join(',');
      sel.textContent = '';
      for (const c of opts) sel.add(new Option(c === club ? c + ' (station)' : c, c));
    }
    const cur = String((st && st.txCall) || club).toUpperCase();
    if (opts.indexOf(cur) < 0) { sel.add(new Option(cur, cur)); sel.dataset.opts = ''; }
    sel.value = cur;
    sel.disabled = !iControl() || opts.length < 2;
    // Avec la main : le choix gardé dans ce navigateur est rappelé au serveur
    let want = null;
    try { want = localStorage.getItem('rs.txown'); } catch (x) {}
    if (iControl() && opts.length > 1 && want != null) {
      const own = want === '1';
      if ((cur === mine) !== own && txcSent !== want) { txcSent = want; send({ t: 'txcall', own }); }
    }
    if (!iControl()) txcSent = null;
  }
  function render() {
    lamp('lampLink', ws && ws.readyState === 1 && me ? 'on' : null);
    drawTxCall();
    if ($('txwBtn')) {
      // TXW juste à droite de DUAL RX (sinon de SPLIT) dans la rangée MAIN / SUB / SPLIT…
      const anchor = document.querySelector('#sec-dual [data-ctl="dualRx"]') || document.querySelector('#sec-dual [data-ctl="split"]');
      const cell = anchor && (anchor.closest('#sec-dual > *') || anchor);
      if (cell && cell.nextElementSibling !== $('txwBtn')) cell.after($('txwBtn'));
      const hasSwap = !!(RIG().CONTROL && RIG().CONTROL.swap);
      $('txwBtn').hidden = !hasSwap;
      $('txwBtn').setAttribute('aria-pressed', String(!!(st && st.txw)));
      $('txwBtn').disabled = !iControl() || !!(st && st.ptt && st.ptt.active);
    }
    const r = (st && st.radio) || {};
    // Côté actif du TRX changé (dashboard ou face avant) : la molette, les bandes et le mode suivent ce VFO
    if (r.connected && r.vfoSel != null) {
      const side = r.vfoSel === 1 ? 'B' : 'A';
      if (lastSide !== null && side !== lastSide) target = side;
      lastSide = side;
    }
    const live = !!(st && r.connected);
    const onAir = !!(st && st.ptt && st.ptt.active);
    const txing = onAir || !!r.tx;
    if (st) {
      lamp('lampStation', st.station ? 'on' : null);
      lamp('lampTrx', r.connected ? (txing ? 'tx' : 'on') : st.station ? 'warn' : null);
      $('lampTrx').title = r.connected ? 'TRX connecté' : st.station
        ? 'La page Station est en ligne mais le TRX ne répond pas : elle rouvre le port toute seule (radio éteinte ? câble USB ?)'
        : 'Station hors ligne : la page Station n’est pas ouverte au club';
      drawRigList();
      $('usersCount').textContent = String((st.users || []).length);
      if (!$('usersMenu').hidden) drawUsersMenu();
      $('lampStation').classList.toggle('admin', !!(me && me.admin));
      $('lampStation').title = me && me.admin ? 'Station — cliquer pour changer de TRX' : 'Station';
      if (!$('rigMenu').hidden) drawRigMenu();
    }

    // VFO A et B : deux écrans, émission signalée sur celui qui émet (VFO B en SPLIT)
    // Choix en cours d'envoi (clic sur TX / RX) affiché tout de suite, sans attendre la relecture du TRX
    const pSplit = ctlPending.split && Date.now() - ctlPending.split.at < 1500 ? ctlPending.split.v : null;
    const pSel = ctlPending.vfoSel && Date.now() - ctlPending.vfoSel.at < 1500 ? ctlPending.vfoSel.v : null;
    // FTX-1 (SPLIT virtuel) : émission sur le VFO de réception, ou sur l'autre en SPLIT ; autres TRX : VFO d'émission lu
    const rxOnB = (pSel != null ? Number(pSel) : r.vfoSel) === 1;
    const txOnB = RIG().VIRTUAL_SPLIT
      ? ((pSplit != null ? Number(pSplit) : r.split ? 1 : 0) ? !rxOnB : rxOnB)
      : pSplit != null ? Number(pSplit) === 1 : r.txVfo === 1;
    // Pendant l'émission : chiffres rouges sur le VFO qui émet vraiment d'après le TRX (FT relu), pas sur le choix affiché
    const airOnB = txing && (r.txReal === 0 || r.txReal === 1) ? r.txReal === 1 : txOnB;
    const rxW = (pSel != null ? Number(pSel) : r.vfoSel) === 1 ? 'B' : 'A'; // VFO en réception (MAIN, sauf si le TRX opère sur SUB)
    // FTX-1 en double réception (FR00) : les deux côtés reçoivent (RX vert, fréquence pas grisée), comme sur l'écran du TRX
    const dual = r.dualRx === 1;
    for (const w of ['A', 'B']) {
      const el = $('vfo' + w);
      const isTx = w === 'B' ? txOnB : !txOnB;
      el.classList.toggle('live', live);
      el.classList.toggle('target', w === target);   // VFO réglé (molette, flèches, bandes)
      el.classList.toggle('txsel', live && isTx);     // cadre : VFO désigné pour l'émission
      el.classList.toggle('idle', live && !isTx && w !== rxW && !dual); // VFO ni en réception ni en émission (B hors SPLIT) : grisé
      el.classList.toggle('on-air', live && txing && (w === 'B' ? airOnB : !airOnB));
      const f = live || pend[w] != null ? currentFreq(w) : null;
      drawFreq(w, f);
      fitFreq(w);
      $('band' + w).textContent = bandName(f);
      // TX en rouge sur le VFO d'émission (rouge vif pendant l'émission), RX en vert sur le VFO de réception
      badge($('tx' + w), 'TX', live && isTx ? (txing ? 'b-tx live' : 'b-tx armed') : 'b-tx');
      $('txOn' + w).hidden = !(live && isTx);
      $('side' + w).classList.toggle('on', live && w === rxW); // MAIN / SUB : côté actif mis en évidence
      const sends = txing && (w === 'B' ? airOnB : !airOnB);
      badge($('rx' + w), 'RX', live && (dual ? !sends : w === rxW && !txing) ? 'b-rx on' : 'b-rx');
      badge($('mode' + w), live ? (w === 'A' ? r.mode : r.modeB) || '---' : '---', 'b-mode');
    }
    const wt = RIG().widthTable && RIG().widthTable(r.mode);
    const wA = Number(ctlValue('width')) || r.width;
    $('widthA').textContent = RIG().bwText ? (live ? RIG().bwText(Object.assign({}, r, { fil: ctlValue('fil') != null ? ctlValue('fil') : r.fil })) : '—') : 'BW ' + (live && r.narrow ? 'NAR' : live && wt && wA && wt[wA - 1] ? (wt[wA - 1] / 1000).toFixed(1) + 'K' : live && r.mode && /AM|FM/.test(r.mode) ? 'FIX' : '—');
    // Largeur de filtre du récepteur SUB (FTX-1)
    $('widthB').hidden = !RIG().SUB_BADGES;
    if (RIG().SUB_BADGES) {
      const wtB = RIG().widthTable && RIG().widthTable(r.modeB);
      const wB = Number(ctlValue('widthB')) || r.widthB;
      $('widthB').textContent = 'BW ' + (live && r.narrowB ? 'NAR' : live && wtB && wB && wtB[wB - 1] ? (wtB[wB - 1] / 1000).toFixed(1) + 'K' : live && r.modeB && /AM|FM/.test(r.modeB) ? 'FIX' : '—');
    }
    // S-mètre en réception, puissance relative en émission (sur le VFO qui émet) ; VFO B : S-mètre du côté SUB (FTX-1)
    const txB = txing && r.txVfo === 1;
    const hasSmB = r.smeterB != null;
    const meterOn = (bars, sId, isTx, val) => {
      const raw = isTx ? r.m5 : val;
      const n = live ? Math.round((Math.min(255, raw || 0) / 255) * 30) : 0;
      [...$(bars).children].forEach((b, i) => { b.classList.toggle('lit', i < n); b.classList.toggle('hot', isTx || i >= 16); });
      $(sId).textContent = live ? (isTx ? 'PO' : val != null ? RIG().smeterLabel(val).replace(/^S/, 'S ') : 'S —') : 'S —';
    };
    // Double réception (FTX-1 FR00) : S-mètre de chaque côté ; réception simple : celui du côté actif (SM0), sur son VFO
    // Réception simple : SM0 = côté actif ; SUB actif → S-mètre sur le VFO B, VFO A grisé ; MAIN actif → VFO B grisé
    // (avec la valeur RM2 du côté SUB si le TRX la donne)
    const single = r.dualRx === 0 && RIG().SUB_BADGES;
    const onB = single && r.vfoSel === 1;
    meterOn('barsA', 'sA', txing && (!txB || !hasSmB) && !onB, onB ? null : r.smeter);
    $('smA') && $('smA').classList.toggle('smeter-dim', onB);
    $('smB').classList.toggle('smeter-dim', onB ? false : !hasSmB || single);
    if (onB) meterOn('barsB', 'sB', txing, r.smeter);
    else if (hasSmB) meterOn('barsB', 'sB', txB, r.smeterB);
    else { [...$('barsB').children].forEach((b) => b.classList.remove('lit')); $('sB').textContent = 'S —'; }
    // RIT / XIT / SPLIT
    const kHz = (v) => { v = Number(v) || 0; return (v >= 0 ? '+' : '−') + (Math.abs(v) / 1000).toFixed(2) + ' kHz'; };
    const hasB = !!(RIG().CONTROL && RIG().CONTROL.ritB);
    for (const [w, sfx, ids] of [['A', '', ['ritBadge', 'xitBadge', 'ritVal', 'xitVal']], ['B', 'B', ['ritBBadge', 'xitBBadge', 'ritBVal', 'xitBVal']]]) {
      const on = (k) => !!(live && Number(ctlValue(k + sfx)));
      badge($(ids[0]), 'RIT', on('rit') ? 'b-clar amber' : 'b-clar');
      badge($(ids[1]), 'XIT', on('xit') ? 'b-clar amber' : 'b-clar');
      $(ids[2]).textContent = kHz(ctlValue('clar' + sfx));
      $(ids[3]).textContent = kHz(ctlValue('clar' + sfx));
      $(ids[2]).classList.toggle('on', on('rit'));
      $(ids[3]).classList.toggle('on', on('xit'));
      // TRX sans clarifier séparé pour le VFO B (FTDX10, IC-7300) : place gardée, rien d'affiché
      if (w === 'B') $('vfoB').querySelector('.vfo-side').classList.toggle('na', !hasB);
    }
    // badges d'état du récepteur MAIN
    const bA = $('badgesA');
    bA.textContent = '';
    if (live) {
      const C = RIG().CONTROL || {};
      const add = (txt, cls, ctl) => { const s = document.createElement('span'); badge(s, txt, cls); badgeCtl(s, C[ctl], r); bA.appendChild(s); };
      const optLabel = (id, v) => { const o = C[id] && C[id].options && C[id].options.find((x) => x[0] === v); return o ? o[1] : null; };
      // Interrupteur seul (« NB ») ou niveau avec arrêt à 0 (« NB 3 ») selon le pilote
      const flag = (id, txt, cls) => { if (!C[id]) return; const t = C[id].badge || txt; add(r[id] && C[id].type === 'level' ? t + ' ' + r[id] : t, r[id] ? cls : '', id); };
      if (C.att) add(r.att && C.att.type === 'select' ? 'ATT ' + optLabel('att', r.att) : C.att.badge || 'ATT', r.att ? 'green' : '', 'att');
      const pa = RIG().preampText && RIG().preampText(r, 'A');
      if (pa) add(pa[0], pa[1] ? 'green' : '', r.freq >= 144000000 ? 'preampVU' : 'preamp');

      else if (C.preamp && !RIG().preampText) add(optLabel('preamp', r.preamp) || 'PRE', r.preamp ? 'green' : '', 'preamp');
      flag('nb', 'NB', 'amber');
      flag('nr', 'DNR', 'amber');
      flag('notch', 'NOTCH', 'amber');
      flag('dnf', 'DNF', 'amber');
      flag('narrow', 'NAR', 'cyan');
      if (r.agc != null && optLabel('agc', r.agc)) add('AGC ' + optLabel('agc', r.agc), 'cyan');
      if (r.rf != null && r.rf < 255) add('RFG ' + Math.round((r.rf / 255) * 100), 'amber');
      if (r.lock) add('LOCK', 'amber');
    }
    // badges d'état du récepteur SUB (TRX à deux récepteurs : FTX-1)
    const bB = $('badgesB');
    bB.textContent = '';
    if (live && RIG().SUB_BADGES && r.freqB != null) {
      const C = RIG().CONTROL || {};
      const add = (txt, cls, ctl) => { const s = document.createElement('span'); badge(s, txt, cls); badgeCtl(s, C[ctl], r); bB.appendChild(s); };
      const optLabel = (id, v) => { const o = C[id] && C[id].options && C[id].options.find((x) => x[0] === v); return o ? o[1] : null; };
      // ATT et préampli du côté SUB (essai) : le CAT ne les lit pas ; affichés d'après le dernier réglage envoyé (« ? » si aucun)
      if (C.attB) add(r.attB == null ? 'ATT ?' : 'ATT', r.attB ? 'green' : '', 'attB');
      if (C.preampB && r.freqB < 144000000) add(r.preampB == null ? 'IPO ?' : ['IPO', 'AMP1', 'AMP2'][r.preampB] || 'IPO', r.preampB ? 'green' : '', 'preampB');
      if (r.nbB != null) add(r.nbB ? 'NB ' + r.nbB : 'NB', r.nbB ? 'amber' : '', 'nbB');
      if (r.nrB != null) add(r.nrB ? 'DNR ' + r.nrB : 'DNR', r.nrB ? 'amber' : '', 'nrB');
      if (r.notchB != null) add('NOTCH', r.notchB ? 'amber' : '', 'notchB');
      if (r.dnfB != null) add('DNF', r.dnfB ? 'amber' : '', 'dnfB');
      if (r.narrowB != null) add('NAR', r.narrowB ? 'cyan' : '', 'narrowB');
      if (r.agcB != null && optLabel('agc', r.agcB)) add('AGC ' + optLabel('agc', r.agcB), 'cyan');
      if (r.rfB != null && r.rfB < 255) add('RFG ' + Math.round((r.rfB / 255) * 100), 'amber');
    }

    // touches
    const mc = target === 'B' ? r.modeCodeB : r.modeCode;
    $$('#modeKeys .btn').forEach((b) => b.setAttribute('aria-pressed', String(live && b.dataset.code === mc)));
    const bn = bandName(currentFreq(target));
    $$('#bandKeys .btn').forEach((b) => b.setAttribute('aria-pressed', String(live && b.dataset.band === bn)));
    // Rappel « TUNE obligatoire » : affiché à chaque changement de bande (touche, VFO, face avant), jusqu'au TUNE
    // HF / 6 m : TUNE obligatoire ; 2 m / 70 cm (pas de tuner, FTX-1 + SPA-1 : HF et 6 m seulement) : SWR seulement, 20 s
    const fNow = currentFreq(target);
    if (live && bn !== '—' && !(st && st.txw)) { // TXW : VFO échangés un instant, pas un changement de bande
      if (lastBand && bn !== lastBand && bn !== 'GEN') { warnBand = bn; warnAt = Date.now(); }
      lastBand = bn;
    }
    if (r.tuning) warnBand = null;
    const vhf = fNow != null && fNow > 60e6;
    if (vhf && Date.now() - warnAt > 20000) warnBand = null;
    // TUNE sans accord (HI-SWR) : émission bloquée sur la bande, affiché en rouge tant que ça dure
    const lockT = live && st.swrLock && st.swrLock.tune ? st.swrLock.band || '' : null;
    const showW = lockT != null || !!(live && warnBand && warnBand === bn && !$('panelTune').hidden);
    const kind = lockT != null ? 'lock:' + lockT : String(vhf);
    if (showW && $('bandWarn').dataset.kind !== kind) {
      $('bandWarn').dataset.kind = kind;
      $('bandWarn').classList.toggle('lock', lockT != null);
      $('bandWarn').innerHTML = lockT != null ? '⛔ TUNE sans accord (HI-SWR)' + (lockT ? ' sur le ' + lockT : '') + ' : <b>émission bloquée</b>. Refaites TUNE ou essayez l’autre antenne.'
        : vhf ? '⚠ Changement de bande : vérifiez le <b>SWR</b> (en bas à gauche) avant d’émettre.'
        : '⚠ Changement de bande : <b>TUNE obligatoire</b>, puis vérifiez le <b>SWR</b> (en bas à gauche) avant d’émettre.';
    }
    $('bandWarn').hidden = !showW;
    $$('#stepKeys .btn').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.step) === step)));
    $('tgtA').setAttribute('aria-pressed', String(target === 'A'));
    $('tgtB').setAttribute('aria-pressed', String(target === 'B'));
    $('modeTarget').textContent = 'VFO ' + target;
    // Cadres RF front end, Filtre, DSP : VFO réglé indiqué dans le titre (TRX avec réglages propres au côté SUB)
    const sideB = !!(RIG().CONTROL && RIG().CONTROL.nbB);
    for (const k of ['rf', 'filter', 'dsp']) {
      const h = document.querySelector('[data-panel="' + k + '"] > .panel-h');
      if (!h) continue;
      let t = h.querySelector('.ph-side');
      if (!t) { t = document.createElement('span'); t.className = 'ph-side'; h.appendChild(t); }
      t.hidden = !sideB;
      // Court (« A · MAIN ») pour tenir sur la ligne du titre dans la colonne étroite
      t.textContent = panelSide() + (panelSide() === 'B' ? ' · SUB' : ' · MAIN');
      t.title = 'Réglages du VFO ' + panelSide() + (panelSide() === 'B' ? ' (côté SUB)' : ' (côté MAIN)');
      t.classList.toggle('b', panelSide() === 'B');
    }

    // puissance
    $('pwrRead').textContent = live && r.power != null ? String(r.power).replace('.', ',') + ' W' : '-- W';
    const pwrOk = iControl() && !!RIG().POWER_RANGE[r.powerHead] && !onAir && !(me && me.rxOnly);
    $('pwrDown').disabled = !pwrOk;
    $('pwrUp').disabled = !pwrOk;
    $('pwrLimit').textContent = !me ? '' : me.rxOnly ? 'Écouteur : émission interdite' : !me.canTx ? 'Compte en écoute seule' : 'Votre limite : ' + me.maxWatts + ' W' + powerRangeText(r);

    // RX / TX
    $('rxtx').classList.toggle('tx', live && txing);
    $('rxtxText').textContent = live && txing ? 'TX' + (txOnB ? ' · VFO B' : '') : 'RX';
    const p = $('ptt');
    const why = pttReason();
    const myTx = onAir && me && st.ptt.by === me.call;
    p.disabled = !!why && !pttHeld;
    p.classList.toggle('held', pttHeld);
    p.classList.toggle('on-air', !!myTx);
    $('pttHint').textContent = why || (myTx ? 'En émission — relâchez pour repasser en réception' : pttCut ? 'Relâchez puis réappuyez' : 'Maintenir (ou barre d’espace)');

    // mesures de la station
    const R = RIG();
    $('mMode').textContent = live && txing ? 'TX' : 'RX';
    $('mMode').classList.toggle('tx', live && txing);
    const tx = live && txing;
    const po = r.m5 == null ? null : R.poFrac ? R.poFrac(r.m5) : r.m5 / 255;
    meter('mtPo', tx && po != null, tx && po != null ? Math.round(po * 100) + ' %' : '0 W', tx && po != null ? po : 0);
    const swr = R.swrValue && r.m6 != null ? R.swrValue(r.m6) : null;
    meter('mtSwr', tx && swr != null, tx && swr != null ? swr.toFixed(1) : '1.0', tx && swr != null ? (swr - 1) / 4 : 0);
    meter('mtAlc', tx && r.m4 != null, tx && r.m4 != null ? Math.round((r.m4 / 255) * 100) + ' %' : '0 %', tx && r.m4 != null ? r.m4 / 255 : 0);
    const idA = R.idValue ? R.idValue(r.m7) : null;
    meter('mtId', live && idA != null && idA > 0.05, live && idA != null ? idA.toFixed(1) + ' A' : '—', live && idA != null ? idA / 25 : 0);
    const vd = R.vdValue ? R.vdValue(r.m8) : null;
    meter('mtVd', live && vd != null, live && vd != null ? vd.toFixed(1) + ' V' : '—', live && vd != null ? vd / 16 : 0);
    meter('mtComp', tx && r.m3 != null, tx && r.m3 != null ? Math.round((r.m3 / 255) * 100) + ' %' : '0 %', tx && r.m3 != null ? r.m3 / 255 : 0);
    meter('mtS', live && !txing, live ? (txing ? 'TX' : R.smeterLabel(r.smeter)) : '—', live && !txing ? (r.smeter || 0) / 255 : 0);

    if (!st) return;
    // qui a la main
    const mine = iControl();
    const other = otherTab();
    $('ctrlText').textContent = mine ? 'Vous pilotez la station.' : other ? 'Vous pilotez depuis un autre onglet ou appareil.' : st.controller ? st.controller + ' pilote la station.' : 'Personne n’a la main.';
    const cb = $('ctrlBtn');
    cb.textContent = mine ? 'Libérer la main' : other ? 'Prendre la main ici' : !st.controller ? 'Prendre la main' : me && me.admin ? 'Reprendre la main' : 'Main occupée';
    cb.disabled = !!(st.controller && !mine && !other && !(me && me.admin));
    cb.classList.toggle('on', mine);
    updateChatButtons();
    drawListen();
    const who = $('who');
    who.textContent = '';
    for (const c of st.users || []) {
      const s = document.createElement('span');
      s.textContent = c;
      if (me && c === me.call) s.classList.add('me');
      if (c === st.controller) s.classList.add('ctrl');
      who.appendChild(s);
    }
    updateControls(r, onAir);

    // minuterie TX (horloge locale)
    if (onAir) {
      if (!txLocalSince) txLocalSince = Date.now();
      const s = Math.floor((Date.now() - txLocalSince) / 1000);
      const max = me ? me.maxTxSeconds : 0;
      const f = (x) => Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0');
      $('txTimer').textContent = (st.ptt.by || '') + ' en émission ' + f(s) + (max ? ' / ' + f(max) : '');
    } else {
      txLocalSince = 0;
      $('txTimer').textContent = '';
    }
  }

  // ------------------------------------------------------------ journal d'activité
  const MHZ = (hz) => (hz ? (hz / 1e6).toFixed(3) + ' MHz' : '');
  function evText(e) {
    const c = e.call ? '<b>' + e.call + '</b> ' : '';
    switch (e.ev) {
      case 'login': return [c + 'connecté', ''];
      case 'logout': return [c + 'déconnecté', ''];
      case 'control_take': return [c + (e.force ? 'reprend la main (admin)' : e.from ? 'reçoit la main de ' + e.from : 'prend la main'), 'ok'];
      case 'control_release': return [c + 'libère la main' + (e.reason && e.reason !== 'volontaire' ? ' (' + e.reason + ')' : ''), ''];
      case 'tx_start': return [c + 'émet sur ' + MHZ(e.freq) + (e.mode ? ' ' + e.mode : '') + (e.watts != null ? ' · ' + e.watts + ' W' : '') + (e.split ? ' · SPLIT' : ''), 'tx'];
      case 'tx_stop': return [c + 'fin d’émission (' + e.durationS + ' s)' + (e.reason && e.reason !== 'relâché' ? ' — ' + e.reason : ''), e.reason && e.reason !== 'relâché' ? 'warn' : ''];
      case 'tune': return [c + 'lance l’accord sur ' + MHZ(e.freq), 'tx'];
      case 'power_limit': return [c + 'puissance ramenée de ' + e.from + ' à ' + e.to + ' W', 'warn'];
      case 'rig_switch': return [c + 'passe sur le ' + (e.name || e.to), 'warn'];
      case 'tx_watchdog': return ['Sécurité : ' + (e.reason || 'retour en réception forcé'), 'warn'];
      case 'swr_cut': return [c + 'émission coupée : ' + (e.swr != null ? 'ROS ' + String(e.swr).replace('.', ',') + ':1' : 'HI-SWR signalé par le TRX') + ' sur ' + MHZ(e.freq), 'warn'];
      case 'tune_fail': return [c + 'TUNE sans accord (HI-SWR) sur ' + MHZ(e.freq) + ' : émission bloquée sur cette bande', 'warn'];
      case 'station_online': return ['Station en ligne' + (e.model ? ' (' + e.model + ')' : ''), 'ok'];
      case 'station_offline': return ['Station hors ligne' + (e.why ? ' (' + e.why + ')' : ''), 'warn'];
      case 'trx_online': return ['TRX connecté', 'ok'];
      case 'trx_offline': return ['TRX déconnecté', 'warn'];
      default: return null;
    }
  }
  function addEvent(e, top) {
    if (e.ev === 'tune' && top) warnBand = null; // accord lancé : rappel retiré
    const t = evText(e);
    if (!t) return;
    const box = $('events');
    const empty = box.querySelector('.ev-empty');
    if (empty) empty.remove();
    const row = document.createElement('div');
    row.className = 'ev' + (t[1] ? ' ' + t[1] : '');
    const tm = document.createElement('time');
    tm.textContent = new Date(e.ts).toLocaleTimeString('fr-BE');
    const tx = document.createElement('span');
    tx.innerHTML = t[0].replace(/<(?!\/?b>)/g, '&lt;');
    row.append(tm, tx);
    if (top) box.prepend(row); else box.appendChild(row);
    while (box.children.length > 60) box.lastChild.remove();
  }

  // ------------------------------------------------------------ écoute de la BF du TRX
  // Trames µ-law à 8 kHz reçues du serveur, jouées avec un petit tampon (~0,2 s) contre les à-coups du réseau.
  const player = { on: false, ctx: null, gain: null, next: 0, got: 0, late: 0 };
  function playerVolume() {
    const v = Number($('listenVol').value) / 100;
    if (player.gain) player.gain.gain.value = v;
    $('listenVolOut').textContent = Math.round(v * 100) + ' %';
    try { localStorage.setItem('rs.vol', String($('listenVol').value)); } catch (e) {}
  }
  function startListen() {
    if (!player.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return say('Votre navigateur ne peut pas jouer le son.', 'warn');
      player.ctx = new AC();
      player.gain = player.ctx.createGain();
      player.gain.connect(player.ctx.destination);
      playerVolume();
    }
    player.ctx.resume();
    player.on = true;
    player.next = 0;
    send({ t: 'listen', on: true });
    drawListen();
  }
  function stopListen() {
    player.on = false;
    send({ t: 'listen', on: false });
    if (player.ctx) player.ctx.suspend();
    drawListen();
  }
  function onAudio(data) {
    const bytes = new Uint8Array(data);
    if (DG() && DG().onBinary(bytes)) return; // ligne de cascade FT8/FT4
    if (!player.on || !player.ctx) return;
    const pcm = ULAW.decodeFrame(bytes);
    if (!pcm) return;
    player.got++;
    const ctx = player.ctx;
    const now = ctx.currentTime;
    if (player.next < now + 0.05) player.next = now + 0.2;      // démarrage ou trou : on se recale avec 0,2 s d'avance
    else if (player.next > now + 0.8) { player.late++; return; } // trop de retard accumulé : on saute ce paquet
    const buf = ctx.createBuffer(1, pcm.length, pcm.rate || ULAW.RATE);
    buf.copyToChannel(pcm, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(player.gain);
    src.start(player.next);
    player.next += buf.duration;
  }
  function drawListen() {
    const b = $('listenBtn');
    b.setAttribute('aria-pressed', String(player.on));
    b.textContent = player.on ? '🔇 Arrêter l’écoute' : '🔊 Écouter le TRX';
    const a = (st && st.audio) || {};
    $('listenInfo').textContent = !player.on
      ? (a.active ? 'Cliquez pour entendre la BF du TRX.' : 'La station n’envoie pas de son en ce moment.') + (a.listeners ? ' ' + a.listeners + ' à l’écoute.' : '')
      : !a.active ? 'En attente du son : l’audio n’est pas activé sur la page Station.'
      : 'En écoute' + (a.listeners > 1 ? ' avec ' + (a.listeners - 1) + ' autre(s)' : '') + '.';
  }

  // ------------------------------------------------------------ messages entre membres
  const chatItems = [];
  let chatKey = '';
  function chatRow(m) {
    const row = document.createElement('div');
    row.className = 'cm' + (m.kind !== 'msg' ? ' ' + m.kind : '') + (me && m.call === me.call ? ' me' : '');
    const tm = document.createElement('time');
    tm.textContent = new Date(m.ts).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
    const who = document.createElement('b');
    who.textContent = m.call;
    const txt = document.createElement('span');
    txt.textContent = m.kind === 'ask' ? 'demande la main à ' + m.to : m.kind === 'give' ? 'passe la main à ' + m.to : m.text;
    row.append(tm, who, txt);
    // Celui qui pilote peut passer la main directement au demandeur (pas pendant une émission)
    const onAir = !!(st && ((st.ptt && st.ptt.active) || (st.radio && st.radio.tx)));
    const last = chatItems.filter((x) => x.kind === 'ask' && x.cid === m.cid).pop() === m;
    const done = chatItems.some((x) => x.kind === 'give' && x.to === m.call && x.ts > m.ts);
    if (m.kind === 'ask' && last && !done && iControl() && st.users && st.users.indexOf(m.call) >= 0) {
      const b = mkBtn('Passer la main à ' + m.call, 'accent');
      b.disabled = onAir;
      b.title = onAir ? 'Terminez d’abord votre émission' : '';
      b.addEventListener('click', () => send({ t: 'handover', cid: m.cid }));
      row.appendChild(b);
    }
    return row;
  }
  function drawChat() {
    const box = $('chat');
    const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
    box.textContent = '';
    if (!chatItems.length) { box.innerHTML = '<p class="chat-empty">Aucun message.</p>'; return; }
    for (const m of chatItems) box.appendChild(chatRow(m));
    if (atEnd) box.scrollTop = box.scrollHeight;
  }
  function addChat(m, live) {
    chatItems.push(m);
    while (chatItems.length > 40) chatItems.shift();
    drawChat();
    $('chat').scrollTop = $('chat').scrollHeight;
    // Volet Opérateurs fermé : pastille rouge sur 👥 ; demande de la main à celui qui pilote : volet ouvert
    if (live && (!me || m.call !== me.call) && $('usersMenu').hidden) $('usersDot').hidden = false;
    if (live && m.kind === 'ask' && iControl()) { toggleUsersMenu(true); say(m.call + ' vous demande la main (volet 👥 en haut)', 'warn', 10000); }
  }
  // Redessine les boutons « Passer la main » seulement quand la situation change
  function updateChatButtons() {
    const onAir = !!(st && ((st.ptt && st.ptt.active) || (st.radio && st.radio.tx)));
    const key = [iControl(), onAir, (st && st.users || []).join(',')].join('|');
    if (key !== chatKey) { chatKey = key; drawChat(); }
    const ask = $('askBtn');
    ask.hidden = !(st && st.controller && !iControl() && !otherTab());
    if (!ask.hidden) ask.textContent = 'Demander la main à ' + st.controller;
  }

  // ------------------------------------------------------------ panneaux repliables
  // Clic (ou Entrée / Espace) sur le titre d'un panneau : il se replie ou se déplie ; l'état est mémorisé.
  function initCollapsible() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('rs.collapsed') || '{}') || {}; } catch (e) { saved = {}; }
    document.querySelectorAll('.panel > .panel-h').forEach((h) => {
      const panel = h.parentElement;
      const key = h.textContent.trim();
      h.setAttribute('role', 'button');
      h.tabIndex = 0;
      const apply = (c) => { panel.classList.toggle('collapsed', c); h.setAttribute('aria-expanded', String(!c)); };
      apply(!!saved[key]);
      const toggle = () => {
        const c = !panel.classList.contains('collapsed');
        apply(c);
        if (c) saved[key] = 1; else delete saved[key];
        try { localStorage.setItem('rs.collapsed', JSON.stringify(saved)); } catch (e) {}
      };
      h.addEventListener('click', toggle);
      // Entrée seulement : la barre d'espace reste le PTT, même quand un titre a le focus
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); toggle(); } });
    });
  }

  // ------------------------------------------------------------ connexion
  function forgetSession() {
    try { localStorage.removeItem('rs.sess'); } catch (e) {}
  }
  function savedSession() {
    try { return localStorage.getItem('rs.sess') || ''; } catch (e) { return ''; }
  }
  function showLogin(err) {
    $('login').hidden = false;
    $('loginErr').textContent = err || '';
    $('loginBtn').disabled = false;
    setTimeout(() => ($('loginCall').value ? $('loginPass') : $('loginCall')).focus(), 50);
  }
  // Contrôle de vie (même principe que la page Station) : ping toutes les 5 s, reconnexion si 15 s sans nouvelles
  let lastServerMsg = Date.now();
  setInterval(() => {
    if (!ws || ws.readyState !== 1 || !creds) return;
    if (Date.now() - lastServerMsg > 15000) {
      const old = ws;
      old.onclose = null;
      old.onmessage = null;
      try { old.close(); } catch (e) {}
      say('Liaison perdue avec le serveur, reconnexion…', 'warn', 0);
      connect();
      return;
    }
    send({ t: 'ping', ts: Date.now() });
  }, 5000);
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => { retry = 0; if (creds) send(creds.session ? { t: 'login', session: creds.session } : { t: 'login', call: creds.call, pass: creds.pass }); };
    ws.binaryType = 'arraybuffer';
    lastServerMsg = Date.now();
    ws.onmessage = (e) => {
      lastServerMsg = Date.now();
      if (typeof e.data !== 'string') return onAudio(e.data);
      let m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (window.RSLOG && /^log_/.test(m.t)) { window.RSLOG.onMessage(m); return; }
      if (DG() && DG().onMessage(m)) return;
      if (m.t === 'hello') {
        me = m;
        if (window.RSLOG) window.RSLOG.onHello(m);
        if (DG()) DG().onHello(m, m);
        if (/^Liaison perdue/.test($('msg').textContent)) say('');
        $('login').hidden = true;
        $('meCall').textContent = m.call;
        try { localStorage.setItem('rs.call', m.call); } catch (x) {}
        // Session mémorisée : la page actualisée se reconnecte seule (le mot de passe n'est plus gardé)
        if (m.session) {
          creds = { session: m.session };
          try { localStorage.setItem('rs.sess', m.session); } catch (x) {}
        }
        if (!m.allowTx) say('Émission désactivée sur ce serveur : réglages et écoute uniquement.', 'warn', 8000);
        if (player.on) send({ t: 'listen', on: true }); // reprise de l'écoute après une reconnexion
        render();
      } else if (m.t === 'login_fail') {
        creds = null;
        if (m.session) forgetSession();
        showLogin(m.msg);
      } else if (m.t === 'idle_warn') {
        showIdle(m.seconds || 60);
      } else if (m.t === 'session_end') {
        // Déconnexion pour inactivité : pas de reconnexion automatique
        creds = null;
        forgetSession();
        hadControl = false;
        player.on = false;
        if (player.ctx) player.ctx.suspend();
        hideIdle();
        showLogin(m.msg);
      } else if (m.t === 'state') {
        st = m;
        // Après une coupure (redémarrage du serveur, réseau…), l'onglet qui avait la main la reprend si elle est libre
        if (hadControl && me && me.cid != null) {
          hadControl = false;
          if (!st.controller) send({ t: 'take' });
        }
        for (const w of ['A', 'B']) if (pend[w] != null && (w === 'A' ? st.radio.freq : st.radio.freqB) === pend[w]) pend[w] = null;
        if (RIG().ID !== ctlModel) buildControls();
        render();
        if (DG()) DG().onState(st);
        if (window.RSLOG && window.RSLOG.onState) window.RSLOG.onState();
      } else if (m.t === 'events') {
        $('events').textContent = '';
        (m.list || []).forEach((e) => addEvent(e, false)); // déjà du plus récent au plus ancien
        if (!$('events').children.length) $('events').innerHTML = '<p class="ev-empty">Aucune activité pour l’instant.</p>';
      } else if (m.t === 'event') {
        addEvent(m.e, true);
      } else if (m.t === 'chatlog') {
        chatItems.length = 0;
        (m.list || []).forEach((x) => chatItems.push(x));
        drawChat();
        $('chat').scrollTop = $('chat').scrollHeight;
      } else if (m.t === 'chat') {
        addChat(m.m, true);
      } else if (m.t === 'cat_answer') {
        if (catWait) { const w = catWait; catWait = null; w(m.reply); }
        else if (!catOut('← ' + m.reply)) say('CAT ' + m.cmd + ' → ' + m.reply, '', 10000);
      } else if (m.t === 'notice') {
        if (m.pttCut) pttCut = true;
        say(m.msg, m.level === 'error' ? 'error' : m.level === 'info' ? '' : 'warn', 7000);
        render();
      }
    };
    ws.onclose = () => {
      hadControl = !!creds && (hadControl || iControl()); // reste vrai si plusieurs tentatives de reconnexion échouent
      me = me && Object.assign({}, me, { cid: null });
      if (pttHeld) { pttHeld = false; clearInterval(hbTimer); }
      render();
      if (!creds) return;
      say('Liaison perdue avec le serveur, reconnexion…', 'warn', 0);
      retry = Math.min(retry + 1, 6);
      setTimeout(connect, 500 * Math.pow(2, retry - 1));
    };
  }
  $('loginForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    creds = { call: $('loginCall').value.trim().toUpperCase(), pass: $('loginPass').value };
    $('loginPass').value = '';
    $('loginBtn').disabled = true;
    $('loginErr').textContent = '';
    if (ws && ws.readyState === 1) send({ t: 'login', call: creds.call, pass: creds.pass });
    else { if (ws) { ws.onclose = null; ws.close(); } connect(); }
  });

  // ------------------------------------------------------------ démarrage
  buildStatic();
  initCollapsible();
  if (window.RSPANELS) window.RSPANELS.init({ say });
  // Modes numériques : au centre, ou dans une fenêtre séparée (digi.html) qui utilise cette connexion
  const digiApi = { send, say, setFreq, iControl: () => iControl(), state: () => st, rig: () => RIG() };
  const digiHost = { win: null, inst: null };
  window.DG = function () {
    if (digiHost.inst && digiHost.win && !digiHost.win.closed) return digiHost.inst;
    if (digiHost.inst) releasePopup();
    return window.RSDIGI || null;
  };
  function releasePopup() {
    digiHost.inst = null;
    digiHost.win = null;
    if (window.RSDIGI) { window.RSDIGI.setDetached(false); if (me) window.RSDIGI.onHello(me, me); }
  }
  window.RSHOST = {
    api: digiApi,
    attach(win, inst, popupApi) {
      if (digiHost.win && digiHost.win !== win && !digiHost.win.closed) { try { digiHost.win.close(); } catch (e) {} }
      digiHost.win = win;
      digiHost.inst = inst;
      if (window.RSDIGI) window.RSDIGI.setDetached(true);
      inst.init(popupApi || digiApi);
      if (me) inst.onHello(me, me);
      if (st) inst.onState(st);
    },
    detach(inst) { if (digiHost.inst === inst) releasePopup(); },
    closePopup() { const w = digiHost.win; releasePopup(); if (w && !w.closed) try { w.close(); } catch (e) {} }
  };
  if (window.RSLOG) window.RSLOG.init(digiApi); // onglet « Logs » (monté par digi.js)
  if (window.RSDIGI) window.RSDIGI.init(digiApi);
  // TXW : maintenir le bouton (ou la touche W) pour écouter la fréquence d'émission ; nouvelles toutes les 0,7 s au serveur
  let txwHold = null;
  const txwDown = (e) => {
    if (e) e.preventDefault();
    if (txwHold) return;
    if (!iControl()) return say('Prenez la main pour utiliser TXW.', 'warn');
    send({ t: 'txw', on: true });
    txwHold = setInterval(() => send({ t: 'txw', on: true }), 700);
    $('txwBtn').classList.add('held');
  };
  const txwUp = () => {
    if (!txwHold) return;
    clearInterval(txwHold);
    txwHold = null;
    $('txwBtn').classList.remove('held');
    send({ t: 'txw', on: false });
  };
  $('txwBtn').addEventListener('pointerdown', txwDown);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('txwBtn').addEventListener(ev, txwUp);
  window.addEventListener('blur', txwUp);
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'w' || e.key === 'W') && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) txwDown(e);
  });
  document.addEventListener('keyup', (e) => { if (e.key === 'w' || e.key === 'W') txwUp(); });
  // DX Cluster : menu de deux liens (nouvel onglet)
  const dxcShow = (on) => { $('dxcMenu').hidden = !on; $('dxcBtn').setAttribute('aria-expanded', String(on)); };
  $('dxcBtn').addEventListener('click', (e) => { e.stopPropagation(); dxcShow($('dxcMenu').hidden); });
  $('dxcMenu').addEventListener('click', () => dxcShow(false));
  document.addEventListener('click', (e) => { if (!$('dxcMenu').hidden && !e.target.closest('.dxc-wrap')) dxcShow(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dxcShow(false); });
  $('txCallSel').addEventListener('change', () => {
    if (!iControl()) return render();
    const own = !!me && $('txCallSel').value === String(me.call).toUpperCase();
    try { localStorage.setItem('rs.txown', own ? '1' : '0'); } catch (x) {}
    txcSent = own ? '1' : '0';
    send({ t: 'txcall', own });
  });
  buildControls();
  bindPtt();
  render();
  try { $('loginCall').value = localStorage.getItem('rs.call') || ''; } catch (e) {}
  fetch('/api/info').then((r) => r.json()).then((i) => {
    // Titre : indicatif(s) de la station puis nom, ex. « ON5VL / OR0L  Remote Station UBA-LGE »
    const full = (i.stationCall ? i.stationCall + '  ' : '') + i.clubName;
    document.title = full;
    $('clubName').textContent = i.clubName;
    // Version du serveur, visible au survol du titre et dans le bouton HELP
    if (i.version) { $('clubName').title = 'Remote Station v' + i.version; $('helpBtn').title = 'Mode d’emploi · Remote Station v' + i.version; }
    $('stationCall').textContent = i.stationCall || '';
    const lt = $('loginTitle');
    lt.textContent = '';
    if (i.stationCall) {
      const c = document.createElement('span');
      c.className = 'login-call';
      c.textContent = i.stationCall;
      lt.append(c, document.createElement('br'));
    }
    lt.append(document.createTextNode(i.clubName));
  }).catch(() => {});
  // Navigateur : Chrome ou Edge exigés (détection simple ; Brave, Opera… se présentent comme Chrome)
  (() => {
    const ua = navigator.userAgent;
    const brands = (navigator.userAgentData && navigator.userAgentData.brands || []).map((b) => b.brand).join(' ');
    const ok = /Google Chrome|Microsoft Edge/.test(brands) || (/Chromium/.test(brands) && !/Brave|Opera|Vivaldi|Yandex|Samsung/.test(brands)) || (!navigator.userAgentData && /Edg\//.test(ua)) ||
      (/Chrome\//.test(ua) && !/OPR\/|Brave|SamsungBrowser|Firefox|FxiOS/.test(ua) && !!window.chrome) || /CriOS|EdgiOS/.test(ua);
    $('browserBad').hidden = ok;
  })();
  // Déjà identifié sur ce navigateur : reconnexion directe, sans indicatif ni mot de passe
  const sess = savedSession();
  if (sess) {
    creds = { session: sess };
    $('login').hidden = true;
    connect();
  } else {
    showLogin('');
  }
  setInterval(() => { if (st && st.ptt && st.ptt.active) render(); }, 500);
})();
