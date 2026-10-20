/* Remote Station — page opérateur (disposition inspirée de RigPlane Core, licence MIT) */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

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
    front: ['rf', 'att', 'preamp', 'agc'],
    filter: ['width', 'narrow', 'shift', 'contour', 'apf'],
    dual: ['vfoSel', 'aToB', 'bToA', 'swap', 'split', 'rit', 'xit', 'clar', 'lock'],
    audio: ['af', 'sql'],
    dsp: ['nb', 'nr', 'notch', 'notchFreq', 'dnf'],
    tx: ['mic', 'proc', 'procLvl', 'vox', 'tuner', 'tune']
  };
  const SHORT = { aToB: 'A → B', bToA: 'B → A', swap: 'A ⇄ B', lock: 'LOCK', clar: 'Décalage', notchFreq: 'Fréq. notch', procLvl: 'Niveau proc', mic: 'Gain micro', sql: 'Squelch', af: 'AF level', rf: 'RF gain', width: 'BW', shift: 'IF shift', preamp: 'PRE' };

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
        if (me && me.canTx && R.CONTROL && R.CONTROL.tune) say('Nouvelle bande : faites un accord (TUNE) avant d’émettre si l’antenne n’est pas accordée.', 'warn', 6000);
        if (R.cmdBand && R.BAND_CODES && R.BAND_CODES[name]) return send({ t: 'set', band: name, sub: target === 'B' });
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
    $('tgtA').addEventListener('click', () => setTarget('A'));
    $('tgtB').addEventListener('click', () => setTarget('B'));
    $('tuneUp').addEventListener('click', () => tune(step));
    $('tuneDown').addEventListener('click', () => tune(-step));
    $('vfoA').addEventListener('click', (ev) => { if (!ev.target.closest('.d')) setTarget('A'); });
    $('vfoB').addEventListener('click', (ev) => { if (!ev.target.closest('.d')) setTarget('B'); });
    $('gotoForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = parseFloat($('gotoInput').value.replace(/\s/g, '').replace(',', '.'));
      if (!isFinite(v)) return say('Entrez une fréquence en kHz, par exemple 14195,5.', 'warn');
      if (!iControl()) return say('Prenez la main pour régler la radio.', 'warn');
      setFreq(v * 1000, target);
      $('gotoInput').value = '';
    });
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
  function ctlValue(id) {
    const p = ctlPending[id];
    if (p && Date.now() - p.at < 1500) return p.v;
    return st && st.radio ? st.radio[id] : null;
  }
  function fmtCtl(c, v, r) {
    if (v == null) return '—';
    if (c.type === 'width') {
      const t = RIG().widthTable(r && r.mode);
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
    if (c.type !== 'action') ctlPending[c.id] = { v, at: Date.now() };
    send({ t: 'set', ctl: c.id, value: v });
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
    const boxes = { front: 'sec-front', filter: 'sec-filter', dual: 'sec-dual', audio: 'sec-audio', dsp: 'sec-dsp', tx: 'sec-tx' };
    for (const k in boxes) $(boxes[k]).textContent = '';
    $('sec-other').textContent = '';
    const where = {};
    const order = [];
    for (const k in LAYOUT) for (const id of LAYOUT[k]) { where[id] = boxes[k]; if (R.CONTROL && R.CONTROL[id]) order.push(R.CONTROL[id]); }
    for (const c of R.CONTROLS || []) if (order.indexOf(c) < 0) order.push(c);
    for (const c of order) {
      const box = $(where[c.id] || boxes[c.sec] || 'sec-other');
      const label = SHORT[c.id] || c.label;
      const ref = { c };
      if (c.type === 'toggle' || c.type === 'action') {
        const b = mkBtn(label, c.transmits ? 'btn-tx' : 'accent');
        if (c.type === 'toggle') b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => sendCtl(c, c.type === 'action' ? null : (ctlValue(c.id) ? 0 : 1)));
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
          b.addEventListener('click', () => sendCtl(c, v));
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
          ctlPending[c.id] = { v, at: Date.now() };
          out.textContent = fmtCtl(c, v, st && st.radio);
          sendCtlThrottled(c);
        });
        inp.addEventListener('change', () => sendCtl(c, Number(inp.value)));
        cell.append(head, inp);
        box.appendChild(cell);
        Object.assign(ref, { cell, inp, out });
      }
      ctlRefs[c.id] = ref;
    }
  }
  function updateControls(r, onAir) {
    const blocked = !iControl() || onAir;
    for (const id in ctlRefs) {
      const { c, cell, btn, opts, inp, out } = ctlRefs[id];
      const v = ctlValue(id);
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
        if (c.type === 'width') { const t = RIG().widthTable(r.mode); inp.max = t ? t.length : 1; }
        inp.disabled = blocked || !avail;
        const p = ctlPending[id];
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
    if (st.swrLock) return 'ROS trop élevé ici (' + String(st.swrLock.swr).replace('.', ',') + ':1) : faites TUNE d’abord';
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

  function render() {
    lamp('lampLink', ws && ws.readyState === 1 && me ? 'on' : null);
    const r = (st && st.radio) || {};
    const live = !!(st && r.connected);
    const onAir = !!(st && st.ptt && st.ptt.active);
    const txing = onAir || !!r.tx;
    if (st) {
      lamp('lampStation', st.station ? 'on' : null);
      lamp('lampTrx', r.connected ? (txing ? 'tx' : 'on') : st.station ? 'warn' : null);
      drawRigList();
      $('lampStation').classList.toggle('admin', !!(me && me.admin));
      $('lampStation').title = me && me.admin ? 'Station — cliquer pour changer de TRX' : 'Station';
      if (!$('rigMenu').hidden) drawRigMenu();
    }

    // VFO A et B : deux écrans, émission signalée sur celui qui émet (VFO B en SPLIT)
    const txOnB = r.txVfo === 1;
    for (const w of ['A', 'B']) {
      const el = $('vfo' + w);
      const isTx = w === 'B' ? txOnB : !txOnB;
      el.classList.toggle('live', live);
      el.classList.toggle('target', w === target);
      el.classList.toggle('on-air', live && txing && isTx);
      const f = live || pend[w] != null ? currentFreq(w) : null;
      drawFreq(w, f);
      $('band' + w).textContent = bandName(f);
      badge($('tx' + w), live && isTx ? 'TX' : 'RX', live && isTx ? (txing ? 'b-tx live' : 'b-tx armed') : 'b-tx');
      badge($('mode' + w), live ? (w === 'A' ? r.mode : r.modeB) || '---' : '---', 'b-mode');
    }
    const wt = RIG().widthTable && RIG().widthTable(r.mode);
    $('widthA').textContent = RIG().bwText ? (live ? RIG().bwText(r) : '—') : 'BW ' + (live && r.narrow ? 'NAR' : live && wt && r.width && wt[r.width - 1] ? (wt[r.width - 1] / 1000).toFixed(1) + 'K' : live && r.mode && /AM|FM/.test(r.mode) ? 'FIX' : '—');
    // S-mètre en réception, puissance relative en émission
    const raw = txing ? r.m5 : r.smeter;
    const n = live ? Math.round((Math.min(255, raw || 0) / 255) * 30) : 0;
    [...$('barsA').children].forEach((b, i) => { b.classList.toggle('lit', i < n); b.classList.toggle('hot', txing || i >= 16); });
    $('sA').textContent = live ? (txing ? 'PO' : RIG().smeterLabel(r.smeter).replace(/^S/, 'S ')) : 'S —';
    // RIT / XIT / SPLIT
    const clar = r.clar || 0;
    const clarTxt = (clar >= 0 ? '+' : '−') + (Math.abs(clar) / 1000).toFixed(2) + ' kHz';
    badge($('ritBadge'), 'RIT', live && r.rit ? 'amber' : '');
    badge($('xitBadge'), 'XIT', live && r.xit ? 'amber' : '');
    $('ritVal').textContent = clarTxt;
    $('xitVal').textContent = clarTxt;
    $('ritVal').classList.toggle('on', !!(live && r.rit));
    $('xitVal').classList.toggle('on', !!(live && r.xit));
    badge($('splitBadge'), 'SPLIT TX', live && r.split ? 'amber' : '');
    // badges d'état du récepteur MAIN
    const bA = $('badgesA');
    bA.textContent = '';
    if (live) {
      const add = (txt, cls) => { const s = document.createElement('span'); badge(s, txt, cls); bA.appendChild(s); };
      const C = RIG().CONTROL || {};
      const optLabel = (id, v) => { const o = C[id] && C[id].options && C[id].options.find((x) => x[0] === v); return o ? o[1] : null; };
      // Interrupteur seul (« NB ») ou niveau avec arrêt à 0 (« NB 3 ») selon le pilote
      const flag = (id, txt, cls) => { if (!C[id]) return; const t = C[id].badge || txt; add(r[id] && C[id].type === 'level' ? t + ' ' + r[id] : t, r[id] ? cls : ''); };
      if (C.att) add(r.att && C.att.type === 'select' ? 'ATT ' + optLabel('att', r.att) : C.att.badge || 'ATT', r.att ? 'green' : '');
      if (C.preamp) add(optLabel('preamp', r.preamp) || 'PRE', r.preamp ? 'green' : '');
      flag('nb', 'NB', 'amber');
      flag('nr', 'DNR', 'amber');
      flag('notch', 'NOTCH', 'amber');
      flag('dnf', 'DNF', 'amber');
      flag('narrow', 'NAR', 'cyan');
      if (r.agc != null && optLabel('agc', r.agc)) add('AGC ' + optLabel('agc', r.agc), 'cyan');
      if (r.rf != null && r.rf < 255) add('RFG ' + Math.round((r.rf / 255) * 100), 'amber');
      if (r.lock) add('LOCK', 'amber');
    }
    const bB = $('badgesB');
    bB.textContent = '';
    if (live && r.split) { const s = document.createElement('span'); badge(s, 'Émission sur B', 'amber'); bB.appendChild(s); }

    // touches
    const mc = target === 'B' ? r.modeCodeB : r.modeCode;
    document.querySelectorAll('#modeKeys .btn').forEach((b) => b.setAttribute('aria-pressed', String(live && b.dataset.code === mc)));
    const bn = bandName(currentFreq(target));
    document.querySelectorAll('#bandKeys .btn').forEach((b) => b.setAttribute('aria-pressed', String(live && b.dataset.band === bn)));
    document.querySelectorAll('#stepKeys .btn').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.step) === step)));
    $('tgtA').setAttribute('aria-pressed', String(target === 'A'));
    $('tgtB').setAttribute('aria-pressed', String(target === 'B'));
    $('modeTarget').textContent = 'VFO ' + target;

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
      case 'swr_cut': return [c + 'émission coupée : ROS ' + String(e.swr).replace('.', ',') + ':1 sur ' + MHZ(e.freq), 'warn'];
      case 'station_online': return ['Station en ligne' + (e.model ? ' (' + e.model + ')' : ''), 'ok'];
      case 'station_offline': return ['Station hors ligne', 'warn'];
      case 'trx_online': return ['TRX connecté', 'ok'];
      case 'trx_offline': return ['TRX déconnecté', 'warn'];
      default: return null;
    }
  }
  function addEvent(e, top) {
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
    if (!player.on || !player.ctx) return;
    const pcm = ULAW.decodeFrame(new Uint8Array(data));
    if (!pcm) return;
    player.got++;
    const ctx = player.ctx;
    const now = ctx.currentTime;
    if (player.next < now + 0.05) player.next = now + 0.2;      // démarrage ou trou : on se recale avec 0,2 s d'avance
    else if (player.next > now + 0.8) { player.late++; return; } // trop de retard accumulé : on saute ce paquet
    const buf = ctx.createBuffer(1, pcm.length, ULAW.RATE);
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
    if (live && m.kind === 'ask' && iControl()) say(m.call + ' vous demande la main (voir Opérateurs)', 'warn', 10000);
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

  // ------------------------------------------------------------ connexion
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
    ws.onopen = () => { retry = 0; if (creds) send({ t: 'login', call: creds.call, pass: creds.pass }); };
    ws.binaryType = 'arraybuffer';
    lastServerMsg = Date.now();
    ws.onmessage = (e) => {
      lastServerMsg = Date.now();
      if (typeof e.data !== 'string') return onAudio(e.data);
      let m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.t === 'hello') {
        me = m;
        if (/^Liaison perdue/.test($('msg').textContent)) say('');
        $('login').hidden = true;
        $('meCall').textContent = m.call;
        try { localStorage.setItem('rs.call', m.call); } catch (x) {}
        if (!m.allowTx) say('Émission désactivée sur ce serveur : réglages et écoute uniquement.', 'warn', 8000);
        if (player.on) send({ t: 'listen', on: true }); // reprise de l'écoute après une reconnexion
        render();
      } else if (m.t === 'login_fail') {
        creds = null;
        showLogin(m.msg);
      } else if (m.t === 'idle_warn') {
        showIdle(m.seconds || 60);
      } else if (m.t === 'session_end') {
        // Déconnexion pour inactivité : pas de reconnexion automatique
        creds = null;
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
      } else if (m.t === 'notice') {
        if (m.pttCut) pttCut = true;
        say(m.msg, m.level === 'error' ? 'error' : 'warn', 7000);
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
  buildControls();
  bindPtt();
  render();
  try { $('loginCall').value = localStorage.getItem('rs.call') || ''; } catch (e) {}
  fetch('/api/info').then((r) => r.json()).then((i) => {
    // Titre : indicatif(s) de la station puis nom, ex. « ON5VL / OR0L  Remote Station UBA-LGE »
    const full = (i.stationCall ? i.stationCall + '  ' : '') + i.clubName;
    document.title = full;
    $('clubName').textContent = i.clubName;
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
  showLogin('');
  setInterval(() => { if (st && st.ptt && st.ptt.active) render(); }, 500);
})();
