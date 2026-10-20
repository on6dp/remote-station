/*
 * digi.js — fenêtres des modes numériques : onglets Activité / FT8·FT4 / RTTY / WSPR / JT65 / Synchro,
 * et fenêtre FT8 / FT4 (cascade, activité de bande, fréquence RX).
 * Le décodage se fait sur le serveur ; cette page affiche les messages et la cascade qu'il envoie.
 * app.js appelle RSDIGI.init(api) au démarrage, puis onMessage / onBinary / onState / onHello.
 * Fenêtre séparée (digi.html) : ce même fichier s'y accroche au dashboard qui l'a ouverte (window.opener.RSHOST)
 * et utilise sa connexion ; le dashboard lui transmet les messages tant qu'elle est ouverte.
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

  const POPUP = document.body.dataset.digiPopup === '1';
  let api = null;
  let detached = false;  // dashboard : les modes numériques sont dans la fenêtre séparée
  let needHist = true;   // demander l'historique des décodages à la prochaine annonce
  let clockOff = 0;      // écart horloge du serveur − horloge de ce PC (ms)
  let bestRtt = Infinity;
  let tab = store.get(POPUP ? 'ptab' : 'tab', POPUP ? 'ftx' : 'events');
  let mode = store.get('mode', 'FT8') === 'FT4' ? 'FT4' : 'FT8';
  let rxF = Number(store.get('rxf', '1500')) || 1500;
  let txF = Number(store.get('txf', '1500')) || 1500; // fréquence audio d'émission (split : différente de RX)
  const SCALE_H = 30;
  let lastDecode = 0;
  let lastBand = 0;
  let stationCalls = ['ON5VL', 'OR0L'];


  // ------------------------------------------------------------------ construction des onglets et des fenêtres
  // Même code pour le centre du dashboard et pour la fenêtre séparée (digi.html, sans l'onglet Activité).
  const TABS = [
    ['events', 'Activité'], ['ftx', 'FT8 · FT4'], ['rtty', 'RTTY'], ['wspr', 'WSPR'], ['jt65', 'JT65'], ['gap', ''], ['sync', 'Synchro']
  ];
  const MODE_TABS = ['ftx', 'rtty', 'wspr', 'jt65', 'sync'];
  const SOON = {
    rtty: '<b>RTTY</b> (45,45 bauds, shift 170 Hz) : texte reçu en continu, zone d’émission et macros (CQ, RST, 73…).',
    wspr: '<b>WSPR</b> (périodes de 2 minutes, signaux très faibles) : liste des balises entendues avec indicatif, locator, puissance et distance.',
    jt65: '<b>JT65</b> (périodes d’une minute) : décodage et QSO, comme dans WSJT-X.'
  };
  const FTX_PANE = `
    <div class="dg-bar">
      <div class="seg" id="dgModes">
        <button class="btn" type="button" data-mode="FT8" aria-pressed="true">FT8</button>
        <button class="btn" type="button" data-mode="FT4" aria-pressed="false">FT4</button>
      </div>
      <select id="dgDial" aria-label="Fréquence d'appel"></select>
      <button class="btn" type="button" id="dgQsy" title="Met le VFO A sur la fréquence choisie, en DATA-U">QSY</button>
      <span class="dg-split">
        <span class="dg-f rx">RX <b id="dgRxF2">1500</b> Hz</span>
        <button class="btn" type="button" id="dgTxRx" title="Émettre sur la fréquence de réception">TX ← RX</button>
        <button class="btn" type="button" id="dgRxTx" title="Recevoir sur la fréquence d'émission">RX ← TX</button>
        <span class="dg-f tx">TX <b id="dgTxF">1500</b> Hz</span>
      </span>
      <span class="dg-clock" id="dgClock">--:--:--</span>
      <span class="dg-status" id="dgStatus"></span>
    </div>
    <div class="dg-wf">
      <canvas id="dgScale" height="30"></canvas>
      <canvas id="dgWf" height="140"></canvas>
      <i class="dg-mk dg-mk-tx" id="dgMkTx"></i><i class="dg-mk dg-mk-rx" id="dgMkRx"></i>
    </div>
    <div class="dg-cols">
      <div class="dg-col">
        <div class="dg-h"><span>Activité de bande</span><button class="dg-mini" type="button" id="dgClear">Effacer</button></div>
        <div class="dg-th"><span>UTC</span><span>dB</span><span>DT</span><span>Fréq</span><span>Message</span></div>
        <div class="dg-list" id="dgBand"></div>
      </div>
      <div class="dg-col">
        <div class="dg-h"><span>Fréquence RX <b id="dgRxF">1500 Hz</b></span><span class="dg-note">clic gauche : RX · clic droit : TX</span></div>
        <div class="dg-th"><span>UTC</span><span>dB</span><span>DT</span><span>Fréq</span><span>Message</span></div>
        <div class="dg-list" id="dgRx"></div>
      </div>
    </div>
    <p class="dg-tx">Émission FT8 / FT4 sous l'indicatif <b>ON5VL</b> : prochaine étape (messages Tx1 à Tx6, séquence automatique).</p>`;
  const SYNC_PANE = `
    <div class="sy-grid">
      <div class="sy-box"><span>Heure du serveur (UTC)</span><b id="syVps">--:--:--</b><small>référence de tous les décodages</small></div>
      <div class="sy-box"><span>Votre PC</span><b id="syPc">—</b><small id="syPcNote">écart avec le serveur</small></div>
      <div class="sy-box"><span>Liaison station → serveur</span><b id="syLat">—</b><small>délai mesuré et corrigé automatiquement</small></div>
      <div class="sy-box"><span>DT médian</span><b id="syDt">—</b><small id="syDtNote">derniers décodages FT8 / FT4</small></div>
    </div>
    <p class="sy-note">Le décodage se cale sur l'horloge du serveur (synchronisée par NTP) : l'heure du PC du club et celle de votre PC
      n'interviennent pas. Le délai de la liaison est mesuré d'après les stations décodées ; un DT médian proche de 0,0 s montre que tout est calé.</p>`;

  function buildDom() {
    const bar = $('ctabs');
    bar.textContent = '';
    for (const [id, label] of TABS) {
      if (id === 'events' && POPUP) continue;
      if (id === 'gap') { const g = document.createElement('span'); g.className = 'ctab-gap'; bar.appendChild(g); continue; }
      const b = document.createElement('button');
      b.className = 'ctab';
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.tab = id;
      b.textContent = label;
      bar.appendChild(b);
    }
    const det = document.createElement('button');
    det.className = 'ctab-detach';
    det.type = 'button';
    det.id = 'dgDetach';
    det.textContent = POPUP ? '⧉ Ramener dans le dashboard' : '⧉';
    det.title = POPUP ? 'Fermer cette fenêtre et ramener les modes numériques dans le dashboard' : 'Ouvrir les modes numériques dans une fenêtre séparée';
    bar.appendChild(det);
    const panel = $('centerPanel');
    const add = (id, cls, html) => {
      const d = document.createElement('div');
      d.className = 'ctab-pane ' + cls;
      d.dataset.pane = id;
      d.hidden = true;
      d.innerHTML = html;
      panel.appendChild(d);
    };
    add('ftx', 'dg', FTX_PANE);
    for (const k in SOON) add(k, 'dg-soon', '<p>' + SOON[k] + '</p><p class="dg-note">En préparation.</p>');
    add('sync', 'dg-sync', SYNC_PANE);
    add('away', 'dg-soon', '<p>Les modes numériques sont ouverts dans une <b>fenêtre séparée</b>.</p><p><button class="btn" type="button" id="dgBack">Ramener ici</button></p>');
  }

  // ------------------------------------------------------------------ onglets
  function showTab(t) {
    if (!document.querySelector('#centerPanel .ctab[data-tab="' + t + '"]')) t = POPUP ? 'ftx' : 'events';
    tab = t;
    store.set(POPUP ? 'ptab' : 'tab', t);
    const pane = detached && MODE_TABS.indexOf(t) >= 0 ? 'away' : t;
    document.querySelectorAll('#centerPanel .ctab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    document.querySelectorAll('#centerPanel .ctab-pane').forEach((p) => { p.hidden = p.dataset.pane !== pane; });
    if (pane === 'ftx') sizeCanvas();
    if (pane === 'sync') drawSync();
    announce();
  }
  function setDetached(on) {
    detached = !!on;
    if (!on) needHist = true; // retour de la fenêtre séparée : on récupère ce qui a été décodé entre-temps
    // Fenêtre séparée ouverte : le centre du dashboard revient sur l'activité de la station
    showTab(on && !POPUP && MODE_TABS.indexOf(tab) >= 0 ? 'events' : tab);
  }
  // Le serveur ne décode (et la station n'envoie la BF) que si au moins un membre regarde la fenêtre
  function announce() {
    if (!api || (detached && !POPUP)) return; // la fenêtre séparée annonce elle-même
    const watching = tab === 'ftx' && !$('centerPanel').classList.contains('collapsed') && !document.hidden;
    api.send({ t: 'digi', mode: watching ? mode : null, hist: watching && needHist });
    if (watching) needHist = false;
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
    if (tab !== 'ftx' || detached || !wf.ctx) return;
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
    const H = SCALE_H;
    c.clearRect(0, 0, w, H);
    c.fillStyle = '#0b1018';
    c.fillRect(0, 0, w, H);
    c.font = '10px "Roboto Mono", monospace';
    c.textBaseline = 'top';
    for (let f = 0; f <= WF_MAX_HZ; f += 100) {
      const x = Math.round((f / WF_MAX_HZ) * (w - 1)) + 0.5;
      const big = f % 500 === 0;
      c.strokeStyle = big ? '#5a6878' : '#2b3644';
      c.beginPath();
      c.moveTo(x, big ? 12 : 17);
      c.lineTo(x, H);
      c.stroke();
      if (big && f > 0 && f < WF_MAX_HZ) {
        c.fillStyle = '#8b98a8';
        c.fillText(String(f), x - c.measureText(String(f)).width / 2, 1);
      }
    }
    // Largeur d'un signal FT8 (50 Hz) / FT4 (83 Hz) : TX en rouge (haut), RX en vert (bas)
    const bw = mode === 'FT4' ? 83 : 50;
    const mark = (f, y, h, fill, edge) => {
      const x0 = (f / WF_MAX_HZ) * w;
      const x1 = ((f + bw) / WF_MAX_HZ) * w;
      c.fillStyle = fill;
      c.fillRect(x0, y, Math.max(2, x1 - x0), h);
      c.fillStyle = edge;
      c.fillRect(x0, y, 2, h);
    };
    mark(txF, 12, 8, 'rgba(255, 32, 32, .45)', '#ff5a4a');
    mark(rxF, 21, 9, 'rgba(0, 204, 102, .45)', '#4ED37B');
    // Repères sur la cascade
    const pos = (el, f) => { el.style.left = (f / WF_MAX_HZ) * 100 + '%'; el.style.width = (bw / WF_MAX_HZ) * 100 + '%'; };
    pos($('dgMkRx'), rxF);
    pos($('dgMkTx'), txF);
    $('dgRxF').textContent = Math.round(rxF) + ' Hz';
    $('dgRxF2').textContent = Math.round(rxF);
    $('dgTxF').textContent = Math.round(txF);
  }
  function setTx(f) {
    txF = Math.max(100, Math.min(WF_MAX_HZ - 100, Math.round(f)));
    store.set('txf', txF);
    drawScale();
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
    r.title = d.f + ' Hz · clic gauche : réception ici · clic droit : émission ici';
    const cells = [utc(slot), (d.db >= 0 ? '+' : '') + d.db, d.dt.toFixed(1), d.f, d.msg];
    for (const v of cells) {
      const s = document.createElement('span');
      s.textContent = String(v);
      r.appendChild(s);
    }
    r.addEventListener('click', () => setRx(d.f));
    r.addEventListener('contextmenu', (e) => { e.preventDefault(); setTx(d.f); });
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
    else if (f) {
      // Pas de fréquence d'appel de ce mode sur la bande du TRX (ex. FT4 sur 70 cm) : on le dit au lieu d'afficher 80 m
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'Pas de fréquence ' + mode + ' sur cette bande';
      o.disabled = true;
      sel.insertBefore(o, sel.firstChild);
      sel.value = '';
    } else if (saved) sel.value = saved;
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
    if (!khz) return api.say('Choisissez d’abord une fréquence d’appel dans la liste.', 'warn');
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
  const now = () => Date.now() + clockOff; // heure du serveur
  function clock() {
    const d = new Date(now());
    const L = mode === 'FT8' ? 15 : 7.5;
    const s = (d.getTime() / 1000) % L;
    $('dgClock').textContent = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' UTC · ' + (L - s).toFixed(0).padStart(2, ' ') + ' s';
  }

  // ------------------------------------------------------------------ synchro
  function medianDt() {
    const v = [];
    for (let i = hist.length - 1; i >= 0 && v.length < 80; i--) for (const d of hist[i].list) if (Math.abs(d.dt) < 2.5) v.push(d.dt);
    if (v.length < 3) return null;
    v.sort((a, b) => a - b);
    return { med: v[v.length >> 1], n: v.length };
  }
  function drawSync() {
    if (tab !== 'sync' || detached) return;
    const d = new Date(now());
    $('syVps').textContent = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
    if (bestRtt < Infinity) {
      const s = -clockOff / 1000; // positif : ce PC est en avance
      $('syPc').textContent = (Math.abs(s) < 0.05 ? '0,0' : (s > 0 ? '+' : '−') + Math.abs(s).toFixed(1).replace('.', ',')) + ' s';
      $('syPc').className = Math.abs(s) < 1 ? 'ok' : 'warn';
      $('syPcNote').textContent = Math.abs(s) < 1 ? 'à l’heure (aucune incidence sur le décodage)' : (s > 0 ? 'en avance' : 'en retard') + ' sur le serveur (aucune incidence sur le décodage)';
    }
    const st = api && api.state();
    const lat = st && st.digi && st.digi.latency;
    $('syLat').textContent = lat != null ? lat + ' ms' : '—';
    const m = medianDt();
    $('syDt').textContent = m ? (m.med >= 0 ? '+' : '−') + Math.abs(m.med).toFixed(1).replace('.', ',') + ' s' : '—';
    $('syDt').className = m ? (Math.abs(m.med) <= 0.3 ? 'ok' : 'warn') : '';
    $('syDtNote').textContent = m ? m.n + ' messages récents' + (Math.abs(m.med) > 0.3 ? ' · recalage en cours' : ' · calé') : 'en attente de décodages FT8 / FT4';
  }

  // ------------------------------------------------------------------ interface avec app.js
  window.RSDIGI = {
    setDetached,
    isPopup: POPUP,
    init(a) {
      const again = !!api;
      api = a;
      if (again) { announce(); return; } // fenêtre séparée raccrochée à un dashboard rechargé
      buildDom();
      document.querySelectorAll('#centerPanel .ctab').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); showTab(b.dataset.tab); }));
      $('dgDetach').addEventListener('click', (e) => {
        e.stopPropagation();
        if (POPUP) return window.close();
        const w = window.open('/digi.html', 'rs-digi', 'width=1200,height=860');
        if (!w) api.say('Fenêtre bloquée par Chrome : autorisez les fenêtres pop-up pour ce site.', 'warn');
      });
      $('dgBack').addEventListener('click', () => { if (window.RSHOST) window.RSHOST.closePopup(); });
      document.querySelectorAll('#dgModes .btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
      $('dgQsy').addEventListener('click', qsy);
      $('dgDial').addEventListener('change', () => store.set('dial.' + mode, $('dgDial').value));
      $('dgClear').addEventListener('click', () => { hist.length = 0; redrawAll(); });
      // Split : clic gauche = fréquence de réception, clic droit = fréquence d'émission
      const fAt = (e) => { const r = e.currentTarget.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * WF_MAX_HZ; };
      for (const id of ['dgWf', 'dgScale']) {
        $(id).addEventListener('click', (e) => setRx(fAt(e)));
        $(id).addEventListener('contextmenu', (e) => { e.preventDefault(); setTx(fAt(e)); });
      }
      $('dgTxRx').addEventListener('click', () => setTx(rxF));
      $('dgRxTx').addEventListener('click', () => setRx(txF));
      // Repli du panneau ou onglet du navigateur caché : le serveur arrête de décoder pour ce membre
      new MutationObserver(announce).observe($('centerPanel'), { attributes: true, attributeFilter: ['class'] });
      document.addEventListener('visibilitychange', announce);
      window.addEventListener('resize', () => { if (tab === 'ftx') sizeCanvas(); });
      fillDial();
      setMode(mode);
      showTab(tab);
      setInterval(() => {
        if (detached) return;
        if (tab === 'ftx') { clock(); status(); followBand(); }
        if (tab === 'sync') drawSync();
      }, 500);
    },
    onHello(me, info) {
      needHist = true;
      if (info && info.stationCall) stationCalls = String(info.stationCall).toUpperCase().split(/[\s/,]+/).filter(Boolean);
      announce(); // reprise après reconnexion
    },
    onMessage(m) {
      if (m.t === 'pong' && Number.isFinite(m.now) && Number.isFinite(m.ts)) {
        // Écart d'horloge avec le serveur, d'après l'aller-retour le plus court
        const rtt = Date.now() - m.ts;
        if (rtt >= 0 && rtt <= bestRtt * 1.5 + 20) {
          bestRtt = Math.min(bestRtt, rtt);
          clockOff = m.now - (m.ts + rtt / 2);
        }
        return false;
      }
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
    onState() { if (tab === 'ftx') { status(); followBand(); } }
  };
  // Le TRX a changé de bande : la liste des fréquences d'appel suit (vérifié aussi chaque demi-seconde)
  function followBand() {
      const st = api && api.state();
      const f = st && st.radio && st.radio.freq;
      if (!f) return;
      const band = f ? DIAL[mode].reduce((a, x) => (Math.abs(x[1] * 1000 - f) < Math.abs(a[1] * 1000 - f) ? x : a))[1] : 0;
      if (band !== lastBand) { lastBand = band; fillDial(); }
  }

  // ------------------------------------------------------------------ fenêtre séparée (digi.html)
  if (POPUP) {
    let host = null;
    const toast = (msg, level) => {
      const el = $('dgToast');
      el.textContent = msg || '';
      el.className = 'dg-toast ' + (level || '');
      clearTimeout(toast.t);
      if (msg) toast.t = setTimeout(() => { el.textContent = ''; }, 6000);
    };
    const link = () => {
      const op = window.opener;
      const h = op && !op.closed && op.RSHOST;
      if (h && h !== host) {
        host = h;
        // Même connexion que le dashboard ; les messages d'alerte s'affichent dans cette fenêtre
        h.attach(window, window.RSDIGI, Object.assign({}, h.api, { say: toast }));
        $('dgOrphan').hidden = true;
      } else if (!h) {
        host = null;
        $('dgOrphan').hidden = false;
      }
    };
    window.addEventListener('pagehide', () => { if (host) try { host.detach(window.RSDIGI); } catch (e) {} });
    link();
    setInterval(link, 1000); // dashboard rechargé : on s'y raccroche ; fermé : avertissement
  }
})();
