/*
 * digi.js — fenêtres du centre du dashboard : onglets Activité / FT8·FT4 / RTTY,
 * et fenêtre FT8 / FT4 (cascade, activité de bande, fréquence RX).
 * Le décodage se fait sur le serveur ; cette page affiche les messages et la cascade qu'il envoie.
 * app.js appelle RSDIGI.init(api) au démarrage, puis onMessage / onBinary / onState / onHello.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('rs.dg.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rs.dg.' + k, String(v)); } catch (e) {} }
  };

  // Fréquences d'appel usuelles (kHz, VFO en DATA-U / USB)
  const DIAL = {
    FT8: [['160 m', 1840], ['80 m', 3573], ['60 m', 5357], ['40 m', 7074], ['30 m', 10136], ['20 m', 14074], ['17 m', 18100],
      ['15 m', 21074], ['12 m', 24915], ['10 m', 28074], ['6 m', 50313], ['2 m', 144174], ['70 cm', 432174]],
    FT4: [['80 m', 3575.5], ['40 m', 7047.5], ['30 m', 10140], ['20 m', 14080], ['17 m', 18104], ['15 m', 21140],
      ['12 m', 24919], ['10 m', 28180], ['6 m', 50318], ['2 m', 144170]]
  };
  const WF_MAX_HZ = 3000;
  const RX_WIDTH = 60; // Hz de part et d'autre de la fréquence RX

  let api = null;
  let tab = store.get('tab', 'events');
  let mode = store.get('mode', 'FT8') === 'FT4' ? 'FT4' : 'FT8';
  let rxF = Number(store.get('rxf', '1500')) || 1500;
  let lastDecode = 0;
  let lastBand = 0;
  let stationCalls = ['ON5VL', 'OR0L'];

  // ------------------------------------------------------------------ onglets
  function showTab(t) {
    tab = t;
    store.set('tab', t);
    document.querySelectorAll('#centerPanel .ctab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    document.querySelectorAll('#centerPanel .ctab-pane').forEach((p) => { p.hidden = p.dataset.pane !== t; });
    if (t === 'ftx') sizeCanvas();
    announce();
  }
  // Le serveur ne décode (et la station n'envoie la BF) que si au moins un membre regarde la fenêtre
  function announce() {
    if (!api) return;
    const watching = tab === 'ftx' && !$('centerPanel').classList.contains('collapsed') && !document.hidden;
    api.send({ t: 'digi', mode: watching ? mode : null });
  }

  // ------------------------------------------------------------------ cascade
  const wf = { ctx: null, sctx: null, w: 0, h: 140, img: null };
  function sizeCanvas() {
    const c = $('dgWf');
    const s = $('dgScale');
    const w = Math.max(200, Math.floor(c.clientWidth || c.parentElement.clientWidth));
    if (w === wf.w && wf.ctx) return drawScale();
    const old = wf.ctx ? wf.ctx.getImageData(0, 0, wf.w, wf.h) : null;
    c.width = w;
    s.width = w;
    wf.w = w;
    wf.ctx = c.getContext('2d');
    wf.sctx = s.getContext('2d');
    wf.ctx.fillStyle = '#05080d';
    wf.ctx.fillRect(0, 0, w, wf.h);
    if (old) wf.ctx.putImageData(old, 0, 0);
    drawScale();
  }
  // Palette : bruit sombre → bleu → cyan → jaune → rouge
  const PAL = (() => {
    const stops = [[0, 5, 8, 13], [0.25, 10, 40, 110], [0.5, 0, 170, 220], [0.75, 240, 220, 70], [1, 255, 60, 30]];
    const p = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      let k = 0;
      while (k < stops.length - 2 && x > stops[k + 1][0]) k++;
      const a = stops[k], b = stops[k + 1];
      const u = (x - a[0]) / (b[0] - a[0]);
      for (let j = 0; j < 3; j++) p[i * 3 + j] = Math.round(a[j + 1] + (b[j + 1] - a[j + 1]) * u);
    }
    return p;
  })();
  let floor = null;
  function onRow(bytes) {
    if (tab !== 'ftx' || !wf.ctx) return;
    // bytes[0] = 0x10, puis une case de 6,25 Hz par octet (dB*2+240), depuis 0 Hz
    const n = Math.min(bytes.length - 1, Math.ceil(WF_MAX_HZ / 6.25));
    const vals = bytes.subarray(1, 1 + n);
    // Plancher de bruit : médiane de la ligne, lissée
    const sorted = Array.from(vals).sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    floor = floor == null ? med : floor * 0.9 + med * 0.1;
    const ctx = wf.ctx;
    ctx.drawImage(ctx.canvas, 0, 0, wf.w, wf.h - 1, 0, 1, wf.w, wf.h - 1); // la cascade descend d'une ligne
    if (!wf.img || wf.img.width !== wf.w) wf.img = ctx.createImageData(wf.w, 1);
    const d = wf.img.data;
    for (let x = 0; x < wf.w; x++) {
      const v = vals[Math.min(n - 1, Math.floor((x / wf.w) * n))];
      // 0 dB au-dessus du bruit → sombre ; +25 dB → rouge (octets : 2 par dB)
      let i = Math.round(((v - floor) / 50 + 0.06) * 255);
      i = i < 0 ? 0 : i > 255 ? 255 : i;
      d[x * 4] = PAL[i * 3];
      d[x * 4 + 1] = PAL[i * 3 + 1];
      d[x * 4 + 2] = PAL[i * 3 + 2];
      d[x * 4 + 3] = 255;
    }
    ctx.putImageData(wf.img, 0, 0);
  }
  function drawScale() {
    const c = wf.sctx;
    if (!c) return;
    const w = wf.w;
    c.clearRect(0, 0, w, 22);
    c.fillStyle = '#0b1018';
    c.fillRect(0, 0, w, 22);
    c.font = '10px "Roboto Mono", monospace';
    c.textBaseline = 'top';
    for (let f = 0; f <= WF_MAX_HZ; f += 100) {
      const x = Math.round((f / WF_MAX_HZ) * (w - 1)) + 0.5;
      const big = f % 500 === 0;
      c.strokeStyle = big ? '#5a6878' : '#2b3644';
      c.beginPath();
      c.moveTo(x, big ? 12 : 16);
      c.lineTo(x, 22);
      c.stroke();
      if (big && f > 0 && f < WF_MAX_HZ) {
        c.fillStyle = '#8b98a8';
        c.fillText(String(f), x - c.measureText(String(f)).width / 2, 1);
      }
    }
    // Fréquence RX (vert) : largeur d'un signal FT8 (50 Hz) / FT4 (83 Hz)
    const bw = mode === 'FT4' ? 83 : 50;
    const x0 = (rxF / WF_MAX_HZ) * w;
    const x1 = ((rxF + bw) / WF_MAX_HZ) * w;
    c.fillStyle = 'rgba(0, 204, 102, .35)';
    c.fillRect(x0, 12, Math.max(2, x1 - x0), 10);
    c.fillStyle = '#4ED37B';
    c.fillRect(x0, 10, 2, 12);
    $('dgRxF').textContent = Math.round(rxF) + ' Hz';
  }
  function setRx(f) {
    rxF = Math.max(100, Math.min(WF_MAX_HZ - 100, Math.round(f)));
    store.set('rxf', rxF);
    drawScale();
    redrawRx();
  }

  // ------------------------------------------------------------------ listes de messages
  const hist = []; // { slot, mode, list }
  const pad = (n) => String(n).padStart(2, '0');
  const utc = (ms) => { const d = new Date(ms); return pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()); };
  const callsIn = (msg) => msg.toUpperCase().split(/\s+/).map((w) => w.replace(/^<|>$/g, ''));
  function cls(msg) {
    const w = callsIn(msg);
    if (w.some((x) => stationCalls.indexOf(x) >= 0)) return 'me';
    if (w[0] === 'CQ') return 'cq';
    return '';
  }
  function rowEl(slot, d) {
    const r = document.createElement('div');
    r.className = 'dg-row ' + cls(d.msg);
    r.title = 'Clic : fréquence RX sur ' + d.f + ' Hz';
    const cells = [utc(slot), (d.db >= 0 ? '+' : '') + d.db, d.dt.toFixed(1), d.f, d.msg];
    for (const v of cells) {
      const s = document.createElement('span');
      s.textContent = String(v);
      r.appendChild(s);
    }
    r.addEventListener('click', () => setRx(d.f));
    return r;
  }
  function sepEl(slot, m) {
    const s = document.createElement('div');
    s.className = 'dg-sep';
    const d = new Date(slot);
    s.textContent = '— ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' UTC · ' + m + ' —';
    return s;
  }
  function stickToBottom(el, fn) {
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    fn();
    while (el.children.length > 400) el.removeChild(el.firstChild);
    if (atEnd) el.scrollTop = el.scrollHeight;
  }
  function addSlot(item, quiet) {
    const band = $('dgBand');
    stickToBottom(band, () => {
      if (item.list.length) band.appendChild(sepEl(item.slot, item.mode));
      for (const d of item.list) band.appendChild(rowEl(item.slot, d));
    });
    const mine = item.list.filter(inRx);
    if (mine.length) {
      const rx = $('dgRx');
      stickToBottom(rx, () => { for (const d of mine) rx.appendChild(rowEl(item.slot, d)); });
    }
  }
  function inRx(d) { return Math.abs(d.f - rxF) <= RX_WIDTH || cls(d.msg) === 'me'; }
  function redrawRx() {
    const rx = $('dgRx');
    rx.textContent = '';
    for (const it of hist) if (it.mode === mode) for (const d of it.list) if (inRx(d)) rx.appendChild(rowEl(it.slot, d));
    rx.scrollTop = rx.scrollHeight;
  }
  function redrawAll() {
    $('dgBand').textContent = '';
    for (const it of hist) if (it.mode === mode) addSlot(it, true);
    redrawRx();
  }

  // ------------------------------------------------------------------ état, horloge, QSY
  function fillDial() {
    const sel = $('dgDial');
    sel.textContent = '';
    for (const [b, khz] of DIAL[mode]) {
      const o = document.createElement('option');
      o.value = String(khz);
      o.textContent = b + ' · ' + khz.toLocaleString('fr-BE', { minimumFractionDigits: khz % 1 ? 1 : 0 }) + ' kHz';
      sel.appendChild(o);
    }
    // Par défaut : la fréquence d'appel de la bande où se trouve le TRX
    const st = api && api.state();
    const f = st && st.radio && st.radio.freq;
    const near = f ? DIAL[mode].reduce((a, x) => (Math.abs(x[1] * 1000 - f) < Math.abs(a[1] * 1000 - f) ? x : a)) : null;
    const saved = store.get('dial.' + mode, '');
    if (near && Math.abs(near[1] * 1000 - f) < 500000) sel.value = String(near[1]);
    else if (saved) sel.value = saved;
  }
  function setMode(m) {
    mode = m;
    store.set('mode', m);
    document.querySelectorAll('#dgModes .btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    fillDial();
    drawScale();
    redrawAll();
    announce();
  }
  function qsy() {
    if (!api) return;
    if (!api.iControl()) return api.say('Prenez la main pour changer de fréquence.', 'warn');
    const st = api.state();
    if (st && st.ptt && st.ptt.active) return api.say('Réglage bloqué pendant l’émission.', 'warn');
    const khz = Number($('dgDial').value);
    store.set('dial.' + mode, khz);
    api.setFreq(Math.round(khz * 1000), 'A');
    // Mode DATA-U (Yaesu) / USB-D (Icom) : le filtre et la sortie audio conviennent aux modes numériques
    const R = api.rig();
    const mk = (R.MODE_KEYS || []).find((x) => /^(DATA-U|USB-D|D-U|USB-DATA)$/i.test(x[1])) || (R.MODE_KEYS || []).find((x) => /^USB$/i.test(x[1]));
    if (mk) setTimeout(() => api.send({ t: 'set', mode: mk[0], sub: false }), 250);
  }
  function status() {
    if (!api || tab !== 'ftx') return;
    const st = api.state();
    const el = $('dgStatus');
    let txt = '';
    let warn = false;
    if (!st || !st.station) { txt = 'Station hors ligne'; warn = true; }
    else if (!st.audio || !st.audio.active) { txt = 'La page Station n’envoie pas la BF : « Activer l’audio » sur le PC du club'; warn = true; }
    else if (!lastDecode || Date.now() - lastDecode > (mode === 'FT8' ? 40000 : 20000)) txt = 'BF reçue · décodage au prochain cycle…';
    else txt = 'BF reçue · décodage OK' + (st.digi && st.digi.latency != null ? ' · délai ' + st.digi.latency + ' ms' : '');
    if (st && st.radio && st.radio.mode && !/DATA|USB|-D/i.test(st.radio.mode)) { txt += ' · mode ' + st.radio.mode + ' : passez en DATA-U'; warn = true; }
    el.textContent = txt;
    el.classList.toggle('warn', warn);
  }
  function clock() {
    const d = new Date();
    const L = mode === 'FT8' ? 15 : 7.5;
    const s = (d.getTime() / 1000) % L;
    $('dgClock').textContent = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' UTC · ' + (L - s).toFixed(0).padStart(2, ' ') + ' s';
  }

  // ------------------------------------------------------------------ interface avec app.js
  window.RSDIGI = {
    init(a) {
      api = a;
      document.querySelectorAll('#centerPanel .ctab').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); showTab(b.dataset.tab); }));
      document.querySelectorAll('#dgModes .btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
      $('dgQsy').addEventListener('click', qsy);
      $('dgDial').addEventListener('change', () => store.set('dial.' + mode, $('dgDial').value));
      $('dgClear').addEventListener('click', () => { hist.length = 0; redrawAll(); });
      const pick = (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setRx(((e.clientX - r.left) / r.width) * WF_MAX_HZ);
      };
      $('dgWf').addEventListener('click', pick);
      $('dgScale').addEventListener('click', pick);
      // Repli du panneau ou onglet du navigateur caché : le serveur arrête de décoder pour ce membre
      new MutationObserver(announce).observe($('centerPanel'), { attributes: true, attributeFilter: ['class'] });
      document.addEventListener('visibilitychange', announce);
      window.addEventListener('resize', () => { if (tab === 'ftx') sizeCanvas(); });
      fillDial();
      setMode(mode);
      showTab(tab === 'ftx' || tab === 'rtty' ? tab : 'events');
      setInterval(() => { if (tab === 'ftx') { clock(); status(); } }, 500);
    },
    onHello(me, info) {
      if (info && info.stationCall) stationCalls = String(info.stationCall).toUpperCase().split(/[\s/,]+/).filter(Boolean);
      announce(); // reprise après reconnexion
    },
    onMessage(m) {
      if (m.t === 'ftx_hist') {
        // Historique à l'ouverture : on remplace ce qu'on a pour ce mode
        for (let i = hist.length - 1; i >= 0; i--) if (hist[i].mode === m.mode) hist.splice(i, 1);
        for (const it of m.items || []) hist.push({ slot: it.slot, mode: m.mode, list: it.list || [] });
        hist.sort((a, b) => a.slot - b.slot);
        if (m.mode === mode) redrawAll();
        return true;
      }
      if (m.t === 'ftx') {
        lastDecode = Date.now();
        const it = { slot: m.slot, mode: m.mode, list: m.list || [] };
        hist.push(it);
        while (hist.length > 120) hist.shift();
        if (m.mode === mode) addSlot(it, false);
        return true;
      }
      return false;
    },
    onBinary(bytes) {
      if (bytes[0] === 0x10) { onRow(bytes); return true; }
      return false;
    },
    onState(st) {
      if (tab !== 'ftx') return;
      status();
      // Le TRX a changé de bande : la liste des fréquences d'appel suit
      const f = st && st.radio && st.radio.freq;
      const band = f ? DIAL[mode].reduce((a, x) => (Math.abs(x[1] * 1000 - f) < Math.abs(a[1] * 1000 - f) ? x : a))[1] : 0;
      if (band !== lastBand) { lastBand = band; fillDial(); }
    }
  };
})();
