/* Remote Station — frontend opérateur */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ données
  const MODE_KEYS = [
    ['1', 'LSB'], ['2', 'USB'], ['3', 'CW-U'], ['7', 'CW-L'], ['5', 'AM'],
    ['4', 'FM'], ['B', 'FM-N'], ['C', 'DATA-U'], ['8', 'DATA-L']
  ];
  // [libellé, kHz, mode conseillé (code MD) ou null pour garder le mode courant]
  const BANDS = [
    ['160 m', 1840, '1'], ['80 m', 3700, '1'], ['60 m', 5357, null], ['40 m', 7100, '1'],
    ['30 m', 10136, null], ['20 m', 14200, '2'], ['17 m', 18130, '2'], ['15 m', 21250, '2'],
    ['12 m', 24950, '2'], ['10 m', 28500, '2'], ['6 m', 50150, '2'], ['2 m', 144300, '2'],
    ['70 cm', 432200, '2']
  ];
  // limites (kHz) servant seulement à éclairer la touche de la bande en cours
  const BAND_EDGES = {
    '160 m': [1800, 2000], '80 m': [3500, 4000], '60 m': [5250, 5450], '40 m': [7000, 7300],
    '30 m': [10100, 10150], '20 m': [14000, 14350], '17 m': [18068, 18168], '15 m': [21000, 21450],
    '12 m': [24890, 24990], '10 m': [28000, 29700], '6 m': [50000, 54000], '2 m': [144000, 148000],
    '70 cm': [430000, 440000]
  };
  const STEPS = [10, 100, 1000, 10000, 100000, 1000000];
  const NDIG = 9; // jusqu'à 470 MHz

  let ws = null;
  let creds = null;          // gardés en mémoire uniquement, pour se reconnecter
  let me = null;             // { call, admin, canTx, allowTx, maxTxSeconds }
  let st = null;             // dernier état serveur
  let step = 100;
  let pending = null;        // fréquence réglée localement, pas encore relue
  let pendingAt = 0;
  let sendTimer = null;
  let retry = 0;
  let pttHeld = false;
  let pttCut = false;
  let hbTimer = null;
  let txLocalSince = 0;
  let msgTimer = null;

  try { const s = Number(localStorage.getItem('rs.step')); if (STEPS.indexOf(s) >= 0) step = s; } catch (e) {}

  // ------------------------------------------------------------ afficheur 7 segments
  const H = (x1, x2, y) => `${x1 + 4},${y} ${x1 + 9},${y - 5} ${x2 - 9},${y - 5} ${x2 - 4},${y} ${x2 - 9},${y + 5} ${x1 + 9},${y + 5}`;
  const V = (x, y1, y2) => `${x},${y1 + 4} ${x + 5},${y1 + 9} ${x + 5},${y2 - 9} ${x},${y2 - 4} ${x - 5},${y2 - 9} ${x - 5},${y1 + 9}`;
  const SEGS = {
    a: H(8, 52, 8), g: H(8, 52, 50), d: H(8, 52, 92),
    f: V(8, 8, 50), b: V(52, 8, 50), e: V(8, 50, 92), c: V(52, 50, 92)
  };
  const MAP = ['abcdef', 'bc', 'abged', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
  let digitEls = [];
  let digitElsB = [];

  // interactive = true pour la VFO A (réglage au clic / à la molette), false pour la VFO B
  function buildDigits(box, interactive) {
    const els = [];
    for (let i = 0; i < NDIG; i++) {
      const place = Math.pow(10, NDIG - 1 - i);
      const b = document.createElement(interactive ? 'button' : 'span');
      b.className = 'digit';
      b.dataset.place = place;
      let svg = '<svg viewBox="0 0 60 100" aria-hidden="true"><g transform="skewX(-6) translate(6 0)">';
      for (const k of 'abcdefg') svg += `<polygon class="seg" data-s="${k}" points="${SEGS[k]}"/>`;
      svg += '</g></svg>';
      b.innerHTML = svg;
      if (interactive) {
        b.type = 'button';
        b.setAttribute('aria-label', 'Chiffre, pas ' + fmtStep(place));
        b.addEventListener('click', () => setStep(place >= 10 ? place : 10));
        b.addEventListener('wheel', (ev) => {
          ev.preventDefault();
          tune((ev.deltaY < 0 ? 1 : -1) * Math.max(place, 10));
        }, { passive: false });
      }
      box.appendChild(b);
      els.push(b);
      if (i === 2 || i === 5) {
        const dp = document.createElement('span');
        dp.className = 'dp';
        box.appendChild(dp);
      }
    }
    const u = document.createElement('span');
    u.className = 'unit';
    u.textContent = 'MHz';
    box.appendChild(u);
    return els;
  }

  function buildDisplay() {
    digitEls = buildDigits($('freq'), true);
    digitElsB = buildDigits($('freqB'), false);

    const bars = $('bars');
    for (let i = 0; i < 30; i++) bars.appendChild(document.createElement('span'));
  }

  function drawFreq(hz, els, withCursor) {
    els = els || digitEls;
    const s = hz == null ? '' : String(hz).padStart(NDIG, ' ');
    els.forEach((el, i) => {
      const ch = s[i];
      // les zéros de tête restent éteints, comme sur une vraie radio
      const lit = ch && ch !== ' ' && !(ch === '0' && s.slice(0, i).trim() === '' && i < 2) ? MAP[Number(ch)] : '';
      el.querySelectorAll('.seg').forEach((p) => p.classList.toggle('lit', lit.indexOf(p.dataset.s) >= 0));
      el.classList.toggle('cursor', withCursor !== false && els === digitEls && Number(el.dataset.place) === step);
    });
  }

  function drawMeter(v, tx) {
    const n = tx ? 0 : Math.round((Math.min(255, Math.max(0, v || 0)) / 255) * 30);
    const kids = $('bars').children;
    for (let i = 0; i < kids.length; i++) {
      kids[i].classList.toggle('lit', i < n);
      kids[i].classList.toggle('over', i >= 16); // au-delà de S9
    }
    $('sRead').textContent = tx ? 'TX' : FTX1.smeterLabel(v);
  }

  // ------------------------------------------------------------ helpers
  function fmtStep(s) {
    return s >= 1000000 ? s / 1000000 + ' MHz' : s >= 1000 ? s / 1000 + ' kHz' : s + ' Hz';
  }
  function fmtKHz(hz) {
    return (hz / 1000).toLocaleString('fr-BE', { minimumFractionDigits: 1, maximumFractionDigits: 3 }) + ' kHz';
  }
  function iControl() {
    return st && me && st.controller === me.call;
  }
  function say(text, level, ms) {
    const el = $('msg');
    el.textContent = text || '';
    el.className = 'g-msg' + (level ? ' ' + level : '');
    clearTimeout(msgTimer);
    if (text && ms !== 0) msgTimer = setTimeout(() => { el.textContent = ''; el.className = 'g-msg'; }, ms || 5000);
  }
  function send(o) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
  }
  function setStep(s) {
    step = s;
    try { localStorage.setItem('rs.step', String(s)); } catch (e) {}
    $('stepRead').textContent = fmtStep(s);
    render();
  }

  // ------------------------------------------------------------ accord
  function currentFreq() {
    if (pending != null && Date.now() - pendingAt < 1500) return pending;
    return st && st.radio ? st.radio.freq : null;
  }

  function tune(delta) {
    if (!iControl()) return say('Prenez la main pour régler la radio.', 'warn');
    if (st.ptt && st.ptt.active) return say('Réglage bloqué pendant l’émission.', 'warn');
    const f = currentFreq();
    if (f == null) return;
    setFreq(f + delta);
  }

  function setFreq(hz) {
    hz = Math.round(Math.min(FTX1.FREQ_MAX, Math.max(FTX1.FREQ_MIN, hz)));
    pending = hz;
    pendingAt = Date.now();
    render();
    if (!sendTimer) {
      sendTimer = setTimeout(() => {
        sendTimer = null;
        send({ t: 'set', freq: pending });
      }, 120);
    }
  }

  // bouton VFO : un cran tous les 12°
  function bindKnob() {
    const k = $('knob');
    const cap = $('knobCap');
    let rot = 0;
    let acc = 0;
    let last = null;
    const angle = (ev) => {
      const r = k.getBoundingClientRect();
      return Math.atan2(ev.clientY - (r.top + r.height / 2), ev.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
    };
    const turn = (deg) => {
      rot += deg;
      cap.style.setProperty('--rot', rot + 'deg');
      acc += deg;
      while (acc >= 12) { acc -= 12; tune(step); }
      while (acc <= -12) { acc += 12; tune(-step); }
    };
    k.addEventListener('pointerdown', (ev) => {
      k.setPointerCapture(ev.pointerId);
      last = angle(ev);
    });
    k.addEventListener('pointermove', (ev) => {
      if (last == null) return;
      const a = angle(ev);
      let d = a - last;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      last = a;
      turn(d);
    });
    const end = () => { last = null; };
    k.addEventListener('pointerup', end);
    k.addEventListener('pointercancel', end);
    k.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      turn(ev.deltaY < 0 ? 12 : -12);
    }, { passive: false });
    k.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowRight') { ev.preventDefault(); turn(12); }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowLeft') { ev.preventDefault(); turn(-12); }
    });
  }

  // ------------------------------------------------------------ touches
  function buildKeys() {
    const mk = $('modeKeys');
    for (const [code, name] of MODE_KEYS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'key';
      b.textContent = name;
      b.dataset.code = code;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        if (!iControl()) return say('Prenez la main pour changer de mode.', 'warn');
        send({ t: 'set', mode: code });
      });
      mk.appendChild(b);
    }
    const bk = $('bandKeys');
    for (const [name, khz, mode] of BANDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'key';
      b.textContent = name;
      b.dataset.lo = BAND_EDGES[name][0] * 1000;
      b.dataset.hi = BAND_EDGES[name][1] * 1000;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        if (!iControl()) return say('Prenez la main pour changer de bande.', 'warn');
        if (st.ptt && st.ptt.active) return say('Réglage bloqué pendant l’émission.', 'warn');
        setFreq(khz * 1000);
        if (mode) setTimeout(() => send({ t: 'set', mode }), 200);
      });
      bk.appendChild(b);
    }
    $('gotoForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = parseFloat($('gotoInput').value.replace(/\s/g, '').replace(',', '.'));
      if (!isFinite(v)) return say('Entrez une fréquence en kHz, par exemple 14195,5.', 'warn');
      if (!iControl()) return say('Prenez la main pour régler la radio.', 'warn');
      setFreq(v * 1000);
      $('gotoInput').value = '';
    });
    $('ctrlBtn').addEventListener('click', () => {
      if (!st) return;
      if (iControl()) send({ t: 'release' });
      else if (!st.controller) send({ t: 'take' });
      else if (me.admin && confirm('Reprendre la main à ' + st.controller + ' ?')) send({ t: 'take', force: true });
    });
    const nudgePower = (dir) => {
      if (!iControl()) return say('Prenez la main pour régler la puissance.', 'warn');
      const r = st.radio || {};
      const range = FTX1.POWER_RANGE[r.powerHead];
      if (!range || r.power == null) return say('Puissance du TRX pas encore lue.', 'warn');
      const stepW = r.powerHead === '2' ? 5 : 0.5;
      const top = Math.min(range[1], me.maxWatts);
      const w = Math.max(range[0], Math.min(top, Math.round((r.power + dir * stepW) / stepW) * stepW));
      if (w === r.power) return say(dir > 0 ? 'Maximum atteint : ' + top + ' W' + (me.maxWatts < range[1] ? ' (limite de votre licence)' : '') : 'Minimum atteint : ' + range[0] + ' W', 'warn');
      send({ t: 'set', power: w });
    };
    $('pwrDown').addEventListener('click', () => nudgePower(-1));
    $('pwrUp').addEventListener('click', () => nudgePower(1));
    $('logout').addEventListener('click', () => {
      creds = null;
      if (ws) ws.close();
      me = null;
      showLogin('');
    });
  }

  // ------------------------------------------------------------ PTT
  function pttReason() {
    if (!me) return 'Connectez-vous';
    if (!me.allowTx) return 'Émission désactivée sur ce serveur';
    if (!me.canTx) return 'Votre compte est en écoute seule';
    if (!st || !st.station) return 'Station hors ligne';
    if (!st.radio.connected) return 'TRX non connecté';
    if (!iControl()) return 'Prenez la main pour émettre';
    if (!st.txOk) return 'Hors des bandes autorisées';
    if (st.radio.power != null && st.radio.power > me.maxWatts) return 'Puissance au-delà de votre limite (' + me.maxWatts + ' W)';
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
    const typing = (ev) => /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName);
    document.addEventListener('keydown', (ev) => {
      if (typing(ev) || !me) return;
      if (ev.code === 'Space') { ev.preventDefault(); if (!ev.repeat) pttDown(); }
      if (ev.target.id === 'knob') return;
      if (ev.key === 'ArrowUp') { ev.preventDefault(); tune(step); }
      if (ev.key === 'ArrowDown') { ev.preventDefault(); tune(-step); }
    });
    document.addEventListener('keyup', (ev) => { if (ev.code === 'Space') pttUp(); });
    window.addEventListener('blur', pttUp);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pttUp(); });
  }

  // ------------------------------------------------------------ rendu
  function lamp(id, cls) {
    const el = $(id);
    el.classList.remove('on', 'warn', 'tx');
    if (cls) el.classList.add(cls);
  }

  function render() {
    const linked = ws && ws.readyState === 1 && me;
    lamp('lampLink', linked ? 'on' : null);
    if (!st) { drawFreq(null); return; }
    const r = st.radio || {};
    const onAir = st.ptt && st.ptt.active;
    lamp('lampStation', st.station ? 'on' : null);
    lamp('lampTrx', r.connected ? 'on' : st.station ? 'warn' : null);
    lamp('lampTx', onAir || r.tx ? 'tx' : null);

    drawFreq(r.connected || pending != null ? currentFreq() : null);
    drawFreq(r.connected ? r.freqB : null, digitElsB);
    drawMeter(r.smeter, onAir || r.tx);
    $('modeTag').textContent = r.connected && r.mode ? r.mode : '---';
    $('modeTagB').textContent = r.connected && r.modeB ? r.modeB : '---';
    const pw = r.connected && r.power != null ? String(r.power).replace('.', ',') + ' W' : '-- W';
    $('pwrTag').textContent = pw;
    $('pwrRead').textContent = pw;
    const pwrOk = iControl() && !!FTX1.POWER_RANGE[r.powerHead] && !(st.ptt && st.ptt.active);
    $('pwrDown').disabled = !pwrOk;
    $('pwrUp').disabled = !pwrOk;
    $('pwrLimit').textContent = me ? 'Votre limite : ' + me.maxWatts + ' W' + (r.powerHead === '1' ? ' · tête Field 0,5–10 W' : r.powerHead === '2' ? ' · TRX 5–100 W' : '') : '';
    $('txTag').className = 'tag ' + (onAir || r.tx ? 'txtag' : 'ghost');
    $('glass').classList.toggle('tx', !!(onAir || r.tx));
    document.querySelectorAll('#modeKeys .key').forEach((b) => b.setAttribute('aria-pressed', String(!!r.connected && b.dataset.code === r.modeCode)));
    const fNow = currentFreq();
    document.querySelectorAll('#bandKeys .key').forEach((b) => {
      const on = !!r.connected && fNow != null && fNow >= Number(b.dataset.lo) && fNow <= Number(b.dataset.hi);
      b.setAttribute('aria-pressed', String(on));
    });

    // contrôle
    const mine = iControl();
    $('ctrlTag').textContent = mine ? 'Vous avez la main' : st.controller ? st.controller + ' a la main' : 'Lecture seule';
    $('ctrlText').textContent = mine ? 'Vous pilotez la station.' : st.controller ? st.controller + ' pilote la station.' : 'Personne n’a la main.';
    const cb = $('ctrlBtn');
    cb.textContent = mine ? 'Libérer la main' : !st.controller ? 'Prendre la main' : me && me.admin ? 'Reprendre la main' : 'Main occupée';
    cb.disabled = !!(st.controller && !mine && !(me && me.admin));
    $('knob').setAttribute('aria-disabled', String(!mine));
    $('knob').setAttribute('aria-valuetext', r.freq ? fmtKHz(r.freq) : '');

    // opérateurs
    const who = $('who');
    who.textContent = '';
    for (const c of st.users || []) {
      const s = document.createElement('span');
      s.textContent = c;
      if (me && c === me.call) s.classList.add('me');
      if (c === st.controller) s.classList.add('ctrl');
      who.appendChild(s);
    }

    // PTT
    const p = $('ptt');
    const why = pttReason();
    const myTx = onAir && me && st.ptt.by === me.call;
    p.disabled = !!why && !pttHeld;
    p.classList.toggle('held', pttHeld);
    p.classList.toggle('on-air', !!myTx);
    $('pttHint').textContent = why ? why : myTx ? 'En émission — relâchez pour repasser en réception' : pttCut ? 'Relâchez puis réappuyez' : 'Maintenir pour émettre';

    // minuterie TX (horloge locale, pour éviter les décalages d'horloge)
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

  // ------------------------------------------------------------ connexion
  function showLogin(err) {
    $('login').hidden = false;
    $('loginErr').textContent = err || '';
    $('loginBtn').disabled = false;
    setTimeout(() => ($('loginCall').value ? $('loginPass') : $('loginCall')).focus(), 50);
  }

  function connect() {
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 0;
      if (creds) send({ t: 'login', call: creds.call, pass: creds.pass });
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.t === 'hello') {
        me = m;
        $('login').hidden = true;
        $('meCall').textContent = m.call;
        try { localStorage.setItem('rs.call', m.call); } catch (x) {}
        if (!m.allowTx) say('Émission désactivée sur ce serveur : réglages et écoute uniquement.', 'warn', 8000);
        render();
      } else if (m.t === 'login_fail') {
        creds = null;
        showLogin(m.msg);
      } else if (m.t === 'state') {
        st = m;
        if (pending != null && st.radio && st.radio.freq === pending) pending = null;
        render();
      } else if (m.t === 'notice') {
        if (m.pttCut) { pttCut = true; }
        say(m.msg, m.level === 'error' ? 'error' : 'warn', 7000);
        render();
      }
    };
    ws.onclose = () => {
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
  buildDisplay();
  buildKeys();
  bindKnob();
  bindPtt();
  $('stepRead').textContent = fmtStep(step);
  drawFreq(null);
  drawMeter(0, false);
  try { $('loginCall').value = localStorage.getItem('rs.call') || ''; } catch (e) {}
  fetch('/api/info').then((r) => r.json()).then((i) => {
    document.title = i.clubName;
    $('clubName').firstChild.textContent = i.clubName;
    $('stationCall').textContent = i.stationCall;
    $('loginTitle').textContent = i.clubName;
  }).catch(() => {});
  showLogin('');
  setInterval(() => { if (st && st.ptt && st.ptt.active) render(); }, 500);
})();
