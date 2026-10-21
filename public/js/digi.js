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
  const $ = (id) => document.getElementById(id) || (window.RSPANELS ? window.RSPANELS.find(id) : null);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('rs.dg.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rs.dg.' + k, String(v)); } catch (e) {} }
  };

  // Fréquences d'appel usuelles (kHz, VFO en DATA-U / USB)
  const DIAL = {
    FT8: [['160 m', 1840], ['80 m', 3573], ['60 m', 5357], ['40 m', 7074], ['30 m', 10136], ['20 m', 14074], ['17 m', 18100],
      ['15 m', 21074], ['12 m', 24915], ['10 m', 28074], ['6 m', 50313], ['2 m', 144174], ['70 cm', 432174]],
    JT65: [['160 m', 1838], ['80 m', 3576], ['40 m', 7076], ['30 m', 10138], ['20 m', 14076], ['17 m', 18102], ['15 m', 21076],
      ['12 m', 24917], ['10 m', 28076], ['6 m', 50310]],
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
  let mode = store.get('ftmode', store.get('mode', 'FT8')) === 'FT4' ? 'FT4' : 'FT8';
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
    <div class="dg-wf-slot" data-slot="ftx"><div class="dg-wf">
      <canvas id="dgScale" height="30"></canvas>
      <canvas id="dgWf" height="140"></canvas>
      <i class="dg-mk dg-mk-tx" id="dgMkTx"></i><i class="dg-mk dg-mk-rx" id="dgMkRx"></i>
    </div></div>
    <div class="dg-cols">
      <div class="dg-col">
        <div class="dg-h"><span>Activité de bande</span><button class="dg-mini" type="button" id="dgClear">Effacer</button></div>
        <div class="dg-th"><span>UTC</span><span>dB</span><span>DT</span><span>Fréq</span><span>Message</span></div>
        <div class="dg-list" id="dgBand"></div>
      </div>
      <div class="dg-col">
        <div class="dg-h"><span>Fréquence RX <b id="dgRxF">1500 Hz</b></span><span class="dg-note">clic gauche : RX · clic droit : TX · double-clic : correspondant</span></div>
        <div class="dg-th"><span>UTC</span><span>dB</span><span>DT</span><span>Fréq</span><span>Message</span></div>
        <div class="dg-list" id="dgRx"></div>
      </div>
    </div>
    <p class="dg-tx">Émission FT8 / FT4 sous l'indicatif <b>ON5VL</b> : prochaine étape (messages Tx1 à Tx6, séquence automatique).</p>`;
  const RTTY_PANE = `
    <div class="dg-bar">
      <select id="rtShift" aria-label="Shift"><option value="170">Shift 170 Hz</option><option value="200">Shift 200 Hz</option><option value="425">Shift 425 Hz</option><option value="850">Shift 850 Hz</option></select>
      <select id="rtBaud" aria-label="Vitesse"><option value="45.45">45,45 bauds</option><option value="50">50 bauds</option><option value="75">75 bauds</option><option value="100">100 bauds</option></select>
      <button class="btn" type="button" id="rtRev" aria-pressed="false" title="Échange Mark et Space (signal reçu « à l'envers »)">Inversé</button>
      <label class="rt-sq" title="Seuil de contraste Mark/Space : plus haut = moins de caractères au hasard sur le bruit">Silencieux
        <input type="range" id="rtSq" min="4" max="25" step="1" aria-label="Silencieux"><output id="rtSqV">12</output></label>
      <select id="rtDial" aria-label="Fréquence RTTY"></select>
      <button class="btn" type="button" id="rtQsy" title="Met le VFO A sur la fréquence choisie, en DATA-U">QSY</button>
      <span class="rt-tune" title="Accord : les deux barres doivent battre en alternance"><span>M</span><i><b id="rtM"></b></i><span>S</span><i><b id="rtS"></b></i></span>
      <span class="dg-f rx">Centre <b id="rtF">1500</b> Hz</span>
      <span class="dg-status" id="rtStatus"></span>
    </div>
    <div class="dg-wf-slot" data-slot="rtty"></div>
    <div class="rt-grid">
      <div class="dg-col rt-rx-col">
        <div class="dg-h"><span>Réception RTTY</span><span class="dg-note">clic sur la cascade : se caler · double-clic sur un indicatif : le reprendre</span><button class="dg-mini" type="button" id="rtClear">Effacer</button></div>
        <pre class="rt-rx" id="rtRx"></pre>
      </div>
      <div class="dg-col rt-tx-col">
        <div class="dg-h"><span>Émission</span><label class="rt-call">Correspondant <input id="rtCall" maxlength="12" placeholder="indicatif" autocomplete="off" spellcheck="false"></label></div>
        <div class="rt-macros" id="rtMacros"></div>
        <textarea id="rtTxt" rows="4" placeholder="Texte à émettre (les macros s'ajoutent ici)…" spellcheck="false"></textarea>
        <div class="rt-tx-act">
          <button class="btn btn-tx" type="button" id="rtSend" disabled>Émettre</button>
          <button class="btn" type="button" id="rtTxClear">Effacer</button>
          <span class="dg-note">Émission RTTY sous <b>ON5VL</b> : avec l'émission des modes numériques (prochaine version).</span>
        </div>
      </div>
    </div>`;
  const WSPR_PANE = `
    <div class="dg-bar">
      <select id="wsDial" aria-label="Fréquence WSPR"></select>
      <button class="btn" type="button" id="wsQsy" title="Met le VFO A sur la fréquence WSPR choisie">QSY</button>
      <span class="dg-f">Bande WSPR : <b>1400 – 1600 Hz</b> audio</span>
      <span class="dg-clock" id="wsClock">--:--</span>
      <span class="dg-status" id="wsStatus"></span>
    </div>
    <div class="dg-wf-slot" data-slot="wspr"></div>
    <div class="dg-col ws-col">
      <div class="dg-h"><span>Stations WSPR entendues <b id="wsCount"></b></span><span class="dg-note">périodes de 2 minutes · décodage une dizaine de secondes après la minute paire</span><button class="dg-mini" type="button" id="wsClear">Effacer</button></div>
      <div class="ws-th"><span>UTC</span><span>dB</span><span>DT</span><span>Fréquence</span><span>Dérive</span><span>Indicatif</span><span>Locator</span><span>Puiss.</span><span>Distance</span></div>
      <div class="dg-list ws-list" id="wsList"></div>
    </div>`;
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
    add('rtty', 'dg rt', RTTY_PANE);
    add('wspr', 'dg ws', WSPR_PANE);
    for (const k in SOON) add(k, 'dg-soon', '<p>' + SOON[k] + '</p><p class="dg-note">En préparation.</p>');
    add('sync', 'dg-sync', SYNC_PANE);
    add('away', 'dg-soon', '<p>Les modes numériques sont ouverts dans une <b>fenêtre séparée</b>.</p><p><button class="btn" type="button" id="dgBack">Ramener ici</button></p>');
  }

  // ------------------------------------------------------------------ onglets
  function showTab(t) {
    if (!document.querySelector('#centerPanel .ctab[data-tab="' + t + '"]')) t = POPUP ? 'ftx' : 'events';
    tab = t;
    store.set(POPUP ? 'ptab' : 'tab', t);
    // JT65 utilise la même fenêtre que FT8 / FT4 (cascade, activité de bande, fréquence RX, split)
    let pane = detached && MODE_TABS.indexOf(t) >= 0 ? 'away' : t === 'jt65' ? 'ftx' : t;
    if (pane === 'ftx') {
      const want = t === 'jt65' ? 'JT65' : (store.get('ftmode', 'FT8') === 'FT4' ? 'FT4' : 'FT8');
      if (mode !== want) { mode = want; modeChanged(); if (api && t === 'jt65' && api.iControl()) setTimeout(autoQsy, 0); }
      const seg = $('dgModes');
      if (seg) seg.style.display = t === 'jt65' ? 'none' : ''; // JT65 : pas de choix FT8 / FT4
    }
    document.querySelectorAll('#centerPanel .ctab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    document.querySelectorAll('#centerPanel .ctab-pane').forEach((p) => { p.hidden = p.dataset.pane !== pane; });
    // Une seule cascade, déplacée dans la fenêtre affichée (FT8/FT4 ou RTTY)
    if (pane === 'ftx' || pane === 'rtty' || pane === 'wspr') {
      const slot = document.querySelector('.dg-wf-slot[data-slot="' + pane + '"]');
      const el = document.querySelector('.dg-wf');
      if (slot && el && el.parentElement !== slot) slot.appendChild(el);
      el.classList.toggle('is-rtty', pane === 'rtty');
      sizeCanvas();
    }
    if (pane === 'sync') drawSync();
    announce();
  }
  function setDetached(on) {
    detached = !!on;
    if (!on) { needHist = true; wsNeedHist = true; } // retour de la fenêtre séparée : on récupère ce qui a été décodé entre-temps
    // Fenêtre séparée ouverte : le centre du dashboard revient sur l'activité de la station
    showTab(on && !POPUP && MODE_TABS.indexOf(tab) >= 0 ? 'events' : tab);
  }
  // Le serveur ne décode (et la station n'envoie la BF) que si au moins un membre regarde la fenêtre
  function announce() {
    if (!api || (detached && !POPUP)) return; // la fenêtre séparée annonce elle-même
    const watching = (tab === 'ftx' || tab === 'jt65' || tab === 'rtty' || tab === 'wspr') && !$('centerPanel').classList.contains('collapsed') && !document.hidden;
    if (watching && tab === 'rtty') return api.send({ t: 'digi', mode: 'RTTY', rtty: rt });
    if (watching && tab === 'wspr') { api.send({ t: 'digi', mode: 'WSPR', hist: wsNeedHist }); wsNeedHist = false; return; }
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
    if ((tab !== 'ftx' && tab !== 'jt65' && tab !== 'rtty' && tab !== 'wspr') || detached || !wf.ctx) return;
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
    if (tab === 'rtty') return drawRttyMarks(c, w);
    if (tab === 'wspr') return drawWsprMarks(c, w);
    // Largeur d'un signal FT8 (50 Hz) / FT4 (83 Hz) : TX en rouge (haut), RX en vert (bas)
    const bw = mode === 'FT4' ? 83 : mode === 'JT65' ? 178 : 50;
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
  // ------------------------------------------------------------------ RTTY
  const RTTY_DIAL = [['80 m', 3590], ['40 m', 7040], ['30 m', 10142], ['20 m', 14085], ['17 m', 18101], ['15 m', 21085], ['12 m', 24910], ['10 m', 28085]];
  const rt = (() => {
    let o = {};
    try { o = JSON.parse(store.get('rtty', '{}')) || {}; } catch (e) { o = {}; }
    return { f: Number(o.f) || 1500, shift: [170, 200, 425, 850].indexOf(o.shift) >= 0 ? o.shift : 170,
      baud: [45.45, 50, 75, 100].indexOf(o.baud) >= 0 ? o.baud : 45.45, rev: !!o.rev, squelch: Number(o.squelch) || 12 };
  })();
  const RTTY_MACROS = [
    ['CQ', 'CQ CQ CQ DE {MY} {MY} {MY}\nCQ CQ CQ DE {MY} {MY} {MY} PSE K\n'],
    ['Appel', '{CALL} {CALL} DE {MY} {MY} {MY} K\n'],
    ['Report', '{CALL} DE {MY} TNX FER CALL UR RST 599 599 QTH LIEGE LIEGE BTU {CALL} DE {MY} K\n'],
    ['Contest', '{CALL} TU 599 599 {CALL}\n'],
    ['73', '{CALL} DE {MY} TNX FER QSO 73 GL {CALL} DE {MY} SK\n'],
    ['QRZ?', 'QRZ? DE {MY} K\n']
  ];
  function saveRtty(reannounce) {
    store.set('rtty', JSON.stringify(rt));
    if (reannounce) announce();
  }
  function drawRttyMarks(c, w) {
    const half = rt.shift / 2;
    const fm = rt.rev ? rt.f - half : rt.f + half;
    const fs = rt.rev ? rt.f + half : rt.f - half;
    const bw = Math.max(20, rt.baud);
    const bar = (f, y, h, fill, edge) => {
      const x0 = ((f - bw / 2) / WF_MAX_HZ) * w;
      c.fillStyle = fill;
      c.fillRect(x0, y, Math.max(2, (bw / WF_MAX_HZ) * w), h);
      c.fillStyle = edge;
      c.fillRect((f / WF_MAX_HZ) * w - 1, y, 2, h);
    };
    bar(fm, 14, 16, 'rgba(242, 207, 74, .35)', '#F2CF4A');
    bar(fs, 14, 16, 'rgba(0, 212, 255, .3)', '#00D4FF');
    const pos = (el, f) => { el.style.left = ((f - bw / 2) / WF_MAX_HZ) * 100 + '%'; el.style.width = (bw / WF_MAX_HZ) * 100 + '%'; };
    pos($('dgMkRx'), fm);
    pos($('dgMkTx'), fs);
    $('rtF').textContent = Math.round(rt.f);
  }
  function setRttyF(f) {
    rt.f = Math.max(200 + rt.shift / 2, Math.min(WF_MAX_HZ - 100 - rt.shift / 2, Math.round(f)));
    saveRtty(true);
    drawScale();
  }
  function rttyAppend(text) {
    const el = $('rtRx');
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    el.appendChild(document.createTextNode(text));
    if (el.textContent.length > 20000) el.textContent = el.textContent.slice(-15000);
    if (atEnd) el.scrollTop = el.scrollHeight;
  }
  function rttyLevels(m) {
    // Barres Mark / Space : 0 à 40 dB au-dessus du plancher
    $('rtM').style.width = Math.max(0, Math.min(100, (m.m / 40) * 100)) + '%';
    $('rtS').style.width = Math.max(0, Math.min(100, (m.s / 40) * 100)) + '%';
  }
  function macroText(t) {
    const call = (dx.call || '').trim().toUpperCase() || '???';
    return t.replace(/\{MY\}/g, myCall).replace(/\{CALL\}/g, call);
  }
  function initRtty() {
    $('rtShift').value = String(rt.shift);
    $('rtBaud').value = String(rt.baud);
    $('rtRev').setAttribute('aria-pressed', String(rt.rev));
    $('rtSq').value = String(rt.squelch);
    $('rtSqV').textContent = String(rt.squelch);
    $('rtShift').addEventListener('change', () => { rt.shift = Number($('rtShift').value); setRttyF(rt.f); });
    $('rtBaud').addEventListener('change', () => { rt.baud = Number($('rtBaud').value); saveRtty(true); drawScale(); });
    $('rtRev').addEventListener('click', () => { rt.rev = !rt.rev; $('rtRev').setAttribute('aria-pressed', String(rt.rev)); saveRtty(true); drawScale(); });
    $('rtSq').addEventListener('input', () => { $('rtSqV').textContent = $('rtSq').value; });
    $('rtSq').addEventListener('change', () => { rt.squelch = Number($('rtSq').value); saveRtty(true); });
    const dial = $('rtDial');
    for (const [b, khz] of RTTY_DIAL) {
      const o = document.createElement('option');
      o.value = String(khz);
      o.textContent = b + ' · ' + khz.toLocaleString('fr-BE') + ' kHz';
      dial.appendChild(o);
    }
    dial.value = store.get('rtdial', '14085');
    // Choisir une bande dans la liste y envoie directement le TRX (QSY)
    dial.addEventListener('change', () => { store.set('rtdial', dial.value); qsyTo(Number(dial.value)); });
    $('rtQsy').addEventListener('click', () => qsyTo(Number(dial.value)));
    $('rtClear').addEventListener('click', () => { $('rtRx').textContent = ''; });
    $('rtTxClear').addEventListener('click', () => { $('rtTxt').value = ''; });
    // Double-clic sur un mot reçu qui ressemble à un indicatif : il devient le correspondant
    $('rtRx').addEventListener('dblclick', () => {
      const w = String(window.getSelection() || '').trim().toUpperCase();
      if (CALL_RE.test(w)) setDx({ call: w });
    });
    for (const [name, t] of RTTY_MACROS) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.type = 'button';
      b.textContent = name;
      b.title = macroText(t).replace(/\n/g, ' ⏎ ');
      b.addEventListener('mouseenter', () => { b.title = macroText(t).replace(/\n/g, ' ⏎ '); });
      b.addEventListener('click', () => {
        const ta = $('rtTxt');
        ta.value += macroText(t);
        ta.scrollTop = ta.scrollHeight;
        ta.focus();
      });
      $('rtMacros').appendChild(b);
    }
  }


  // ------------------------------------------------------------------ WSPR
  const WSPR_DIAL = [['160 m', 1836.6], ['80 m', 3568.6], ['60 m', 5364.7], ['40 m', 7038.6], ['30 m', 10138.7], ['20 m', 14095.6],
    ['17 m', 18104.6], ['15 m', 21094.6], ['12 m', 24924.6], ['10 m', 28124.6], ['6 m', 50293], ['2 m', 144489], ['70 cm', 432300]];
  let wsNeedHist = true;
  const wsHist = []; // { slot, list }
  let wsLast = 0;
  // Locator Maidenhead → latitude / longitude (centre du carré)
  function grid2ll(g) {
    g = String(g || '').toUpperCase();
    if (!/^[A-R]{2}\d{2}([A-X]{2})?$/.test(g)) return null;
    let lon = (g.charCodeAt(0) - 65) * 20 - 180 + Number(g[2]) * 2;
    let lat = (g.charCodeAt(1) - 65) * 10 - 90 + Number(g[3]);
    if (g.length === 6) { lon += (g.charCodeAt(4) - 65) / 12 + 1 / 24; lat += (g.charCodeAt(5) - 65) / 24 + 1 / 48; }
    else { lon += 1; lat += 0.5; }
    return [lat, lon];
  }
  function distKm(a, b) {
    const r = Math.PI / 180;
    const d = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
    return Math.round(6371 * 2 * Math.asin(Math.sqrt(d)));
  }
  const dbmW = (dbm) => { const w = Math.pow(10, dbm / 10) / 1000; return w >= 1 ? (Math.round(w * 10) / 10) + ' W' : Math.round(w * 1000) + ' mW'; };
  function wsRow(slot, d) {
    const r = document.createElement('div');
    r.className = 'ws-row' + (stationCalls.indexOf(String(d.call).toUpperCase()) >= 0 ? ' me' : '');
    const me = grid2ll(myGrid);
    const them = grid2ll(d.grid);
    const km = me && them ? distKm(me, them) : null;
    const fmtF = d.freq > 100000 ? (d.freq / 1e6).toFixed(6) + ' MHz' : d.f + ' Hz';
    const cells = [utc(slot).slice(0, 4), (d.db >= 0 ? '+' : '') + d.db, Number(d.dt).toFixed(1), fmtF, d.drift, d.call, d.grid || '—',
      d.dbm != null ? d.dbm + ' dBm (' + dbmW(d.dbm) + ')' : '—', km != null ? km.toLocaleString('fr-BE') + ' km' : '—'];
    for (const v of cells) { const s = document.createElement('span'); s.textContent = String(v); r.appendChild(s); }
    r.title = d.msg;
    r.addEventListener('dblclick', () => setDx({ call: d.call, grid: d.grid || '', rpt: fmtRpt(d.db) }));
    return r;
  }
  function wsAdd(item) {
    const el = $('wsList');
    stickToBottom(el, () => {
      if (item.list.length) el.appendChild(sepEl(item.slot, 'WSPR'));
      for (const d of item.list) el.appendChild(wsRow(item.slot, d));
    });
    $('wsCount').textContent = '(' + new Set(wsHist.flatMap((h) => h.list.map((d) => d.call))).size + ' stations)';
  }
  function wsRedraw() {
    $('wsList').textContent = '';
    for (const it of wsHist) wsAdd(it);
  }
  function drawWsprMarks(c, w) {
    // Sous-bande WSPR (1400–1600 Hz audio)
    const x0 = (1400 / WF_MAX_HZ) * w;
    const x1 = (1600 / WF_MAX_HZ) * w;
    c.fillStyle = 'rgba(154, 120, 224, .35)';
    c.fillRect(x0, 14, x1 - x0, 16);
    c.fillStyle = '#b79cf0';
    c.fillRect(x0, 14, 1, 16);
    c.fillRect(x1 - 1, 14, 1, 16);
    const pos = (el, f, bw) => { el.style.left = (f / WF_MAX_HZ) * 100 + '%'; el.style.width = (bw / WF_MAX_HZ) * 100 + '%'; };
    pos($('dgMkRx'), 1400, 200);
    pos($('dgMkTx'), 1400, 0);
  }
  function initWspr() {
    const dial = $('wsDial');
    for (const [b, khz] of WSPR_DIAL) {
      const o = document.createElement('option');
      o.value = String(khz);
      o.textContent = b + ' · ' + khz.toLocaleString('fr-BE', { minimumFractionDigits: khz % 1 ? 1 : 0 }) + ' kHz';
      dial.appendChild(o);
    }
    dial.value = store.get('wsdial', '14095.6');
    dial.addEventListener('change', () => { store.set('wsdial', dial.value); qsyTo(Number(dial.value)); });
    $('wsQsy').addEventListener('click', () => qsyTo(Number(dial.value)));
    $('wsClear').addEventListener('click', () => { wsHist.length = 0; wsRedraw(); $('wsCount').textContent = ''; });
  }
  function wsClock() {
    const t = now() / 1000;
    const s = 120 - (t % 120);
    const st = api && api.state();
    const busy = s > 6 && t % 120 < 115;
    $('wsClock').textContent = 'Prochaine période dans ' + Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    const el = $('wsStatus');
    let txt;
    let warn = false;
    if (!st || !st.station) { txt = 'Station hors ligne'; warn = true; }
    else if (!st.audio || !st.audio.active) { txt = 'La page Station n’envoie pas la BF : « Activer l’audio » sur le PC du club'; warn = true; }
    else txt = wsLast ? 'BF reçue · dernier décodage à ' + utc(wsLast).replace(/(\d\d)(\d\d)(\d\d)/, '$1:$2') + ' UTC' : 'BF reçue · premier décodage à la fin de la période en cours' + (busy ? '' : '…');
    el.textContent = txt;
    el.classList.toggle('warn', warn);
  }

  // ------------------------------------------------------------------ correspondant et messages pré-enregistrés
  // Correspondant commun à tous les modes (bas du dashboard, fenêtre RTTY, fenêtre séparée : synchronisés)
  let myCall = 'ON5VL';
  let myGrid = '';
  const loadDx = () => { try { return Object.assign({ call: '', grid: '', rpt: '-10' }, JSON.parse(store.get('dx', '{}')) || {}); } catch (e) { return { call: '', grid: '', rpt: '-10' }; } };
  let dx = loadDx();
  let ftxSel = Number(store.get('ftxsel', '5')) || 0;
  const CALL_RE = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}[A-Z](\/[A-Z0-9]+)?$/;
  const GRID_RE = /^[A-R]{2}[0-9]{2}([A-X]{2})?$/;
  const fmtRpt = (db) => (db >= 0 ? '+' : '-') + String(Math.min(30, Math.abs(Math.round(db)))).padStart(2, '0');
  function setDx(o) {
    dx = Object.assign(loadDx(), o);
    dx.call = String(dx.call || '').toUpperCase().slice(0, 12);
    dx.grid = String(dx.grid || '').toUpperCase().slice(0, 6);
    store.set('dx', JSON.stringify(dx));
    syncDx();
  }
  function syncDx() {
    const put = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
    put('dxCall', dx.call);
    put('dxGrid', dx.grid);
    put('dxRpt', dx.rpt);
    put('rtCall', dx.call);
    drawMsgs();
  }
  window.addEventListener('storage', (e) => { if (e.key === 'rs.dg.dx') { dx = loadDx(); syncDx(); } });
  // Double-clic sur un message FT8/FT4 : son émetteur devient le correspondant (comme dans WSJT-X)
  function pickFromDecode(d) {
    const w = d.msg.toUpperCase().split(/\s+/).map((x) => x.replace(/^<|>$/g, ''));
    let call = '';
    if (w[0] === 'CQ') call = CALL_RE.test(w[1] || '') ? w[1] : (w[2] || '');
    else call = w[1] || '';
    if (!CALL_RE.test(call)) return api && api.say('Pas d’indicatif à reprendre dans ce message.', 'warn');
    const last = w[w.length - 1];
    setDx({ call, grid: GRID_RE.test(last) && last !== 'RR73' ? last : '', rpt: fmtRpt(d.db) });
    setRx(d.f);
    ftxSel = w[0] === 'CQ' ? 0 : 1;
    store.set('ftxsel', ftxSel);
    drawMsgs();
  }
  function ftxMsgs() {
    const c = dx.call || '{CORRESP}';
    const g = myGrid ? myGrid.slice(0, 4) : '{LOCATOR}'; // FT8 / FT4 : locator à 4 caractères
    const r = /^[+-]?\d{1,2}$/.test(dx.rpt) ? (dx.rpt[0] === '+' || dx.rpt[0] === '-' ? dx.rpt : '+' + dx.rpt) : '-10';
    return [c + ' ' + myCall + ' ' + g, c + ' ' + myCall + ' ' + r, c + ' ' + myCall + ' R' + r, c + ' ' + myCall + ' RR73', c + ' ' + myCall + ' 73', 'CQ ' + myCall + ' ' + g];
  }
  const CW_MACROS = [
    ['CQ', 'CQ CQ CQ DE {MY} {MY} {MY} K'], ['Appel', '{CALL} DE {MY} {MY} K'], ['Report', '{CALL} TU UR 5NN 5NN BK'],
    ['R TU', 'R TU 73 {CALL} DE {MY} SK'], ['73', '{CALL} TNX FER QSO 73 DE {MY} SK'], ['QRZ?', 'QRZ? DE {MY} K'], ['AGN?', 'AGN? AGN?']
  ];
  function drawMsgs() {
    if (!$('msgFtx')) return;
    const mk = (box, label, text, onClick, sel) => {
      const b = document.createElement('button');
      b.className = 'btn' + (sel ? ' sel' : '');
      b.type = 'button';
      if (label) { const s = document.createElement('small'); s.textContent = label; b.appendChild(s); }
      b.appendChild(document.createTextNode(text));
      b.addEventListener('click', onClick);
      box.appendChild(b);
      return b;
    };
    const f = $('msgFtx');
    f.textContent = '';
    ftxMsgs().forEach((t, i) => mk(f, 'Tx' + (i + 1), t, () => { ftxSel = i; store.set('ftxsel', i); drawMsgs(); }, i === ftxSel)
      .title = 'Prochain message FT8/FT4 à émettre (émission : prochaine version)');
    const r = $('msgRtty');
    r.textContent = '';
    for (const [name, t] of RTTY_MACROS) {
      mk(r, '', name, () => {
        const inst = (window.DG && window.DG()) || window.RSDIGI;
        inst.insertRtty(t);
      }).title = macroText(t).replace(/\n/g, ' ⏎ ');
    }
    const cw = $('msgCw');
    cw.textContent = '';
    for (const [name, t] of CW_MACROS) {
      mk(cw, '', name, () => api && api.say('Émission CW (par le manipulateur du TRX) : prochaine version.', 'warn')).title = macroText(t);
    }
  }
  function insertRtty(t) {
    showTab('rtty');
    const ta = $('rtTxt');
    ta.value += macroText(t);
    ta.scrollTop = ta.scrollHeight;
    ta.focus();
  }
  function initMsgs() {
    for (const [id, k] of [['dxCall', 'call'], ['dxGrid', 'grid'], ['dxRpt', 'rpt'], ['rtCall', 'call']]) {
      const el = $(id);
      if (el) el.addEventListener('input', () => setDx({ [k]: el.value.trim() }));
    }
    syncDx();
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
    r.title = d.f + ' Hz · clic gauche : réception ici · clic droit : émission ici · double-clic : répondre à cette station';
    const cells = [utc(slot), (d.db >= 0 ? '+' : '') + d.db, d.dt.toFixed(1), d.f, d.msg];
    for (const v of cells) {
      const s = document.createElement('span');
      s.textContent = String(v);
      r.appendChild(s);
    }
    r.addEventListener('click', () => setRx(d.f));
    r.addEventListener('contextmenu', (e) => { e.preventDefault(); setTx(d.f); });
    r.addEventListener('dblclick', () => pickFromDecode(d));
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
    if (m !== 'JT65') store.set('ftmode', m);
    modeChanged();
    announce();
  }
  function modeChanged() {
    document.querySelectorAll('#dgModes .btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    lastBand = 0;
    fillDial();
    drawScale();
    redrawAll();
  }
  function qsy() {
    if (!api) return;
    if (!api.iControl()) return api.say('Prenez la main pour changer de fréquence.', 'warn');
    const st = api.state();
    if (st && st.ptt && st.ptt.active) return api.say('Réglage bloqué pendant l’émission.', 'warn');
    const khz = Number($('dgDial').value);
    if (!khz) return api.say('Choisissez d’abord une fréquence d’appel dans la liste.', 'warn');
    store.set('dial.' + mode, khz);
    qsyTo(khz);
  }
  function qsyTo(khz) {
    if (!api.iControl()) {
      lastBand = 0; // la liste revient sur la bande réelle du TRX
      if ($('rtDial')) $('rtDial').value = store.get('rtdial', '14085');
      return api.say('Prenez la main pour changer de fréquence.', 'warn');
    }
    const st = api.state();
    if (st && st.ptt && st.ptt.active) return api.say('Réglage bloqué pendant l’émission.', 'warn');
    api.setFreq(Math.round(khz * 1000), 'A');
    // Mode DATA-U (Yaesu) / USB-D (Icom) : le filtre et la sortie audio conviennent aux modes numériques
    const R = api.rig();
    const mk = (R.MODE_KEYS || []).find((x) => /^(DATA-U|USB-D|D-U|USB-DATA)$/i.test(x[1])) || (R.MODE_KEYS || []).find((x) => /^USB$/i.test(x[1]));
    if (mk) setTimeout(() => api.send({ t: 'set', mode: mk[0], sub: false }), 250);
  }
  function autoQsy() {
    const st = api && api.state();
    const f = st && st.radio && st.radio.freq;
    const khz = Number($('dgDial').value);
    if (!f || !khz) return api.say('Pas de fréquence ' + mode + ' sur cette bande : choisissez une bande dans la liste puis QSY.', 'warn');
    if (Math.abs(f - khz * 1000) < 50 && st.radio.mode && /DATA|-D/i.test(st.radio.mode)) return; // déjà dessus
    if (!api.iControl()) return api.say('Prenez la main pour aller sur ' + khz.toLocaleString('fr-BE') + ' kHz (' + mode + ').', 'warn');
    qsy();
  }
  function status() {
    if (!api || (tab !== 'ftx' && tab !== 'jt65' && tab !== 'rtty')) return;
    const st = api.state();
    const el = $(tab === 'rtty' ? 'rtStatus' : 'dgStatus');
    let txt = '';
    let warn = false;
    if (!st || !st.station) { txt = 'Station hors ligne'; warn = true; }
    else if (!st.audio || !st.audio.active) { txt = 'La page Station n’envoie pas la BF : « Activer l’audio » sur le PC du club'; warn = true; }
    else if (tab === 'rtty') txt = 'BF reçue';
    else if (!lastDecode || Date.now() - lastDecode > (mode === 'JT65' ? 130000 : mode === 'FT8' ? 40000 : 20000)) txt = 'BF reçue · décodage au prochain cycle' + (mode === 'JT65' ? ' (vers la 52e seconde de chaque minute)' : '') + '…';
    else txt = 'BF reçue · décodage OK' + (st.digi && st.digi.latency != null ? ' · délai ' + st.digi.latency + ' ms' : '');
    if (st && st.radio && st.radio.mode && !/DATA|USB|-D/i.test(st.radio.mode)) { txt += ' · mode ' + st.radio.mode + ' : passez en DATA-U'; warn = true; }
    el.textContent = txt;
    el.classList.toggle('warn', warn);
  }
  const now = () => Date.now() + clockOff; // heure du serveur
  function clock() {
    const d = new Date(now());
    const L = mode === 'JT65' ? 60 : mode === 'FT8' ? 15 : 7.5;
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
      // Clic sur FT8 / FT4 : comme dans WSJT-X, le TRX va sur la fréquence d'appel de ce mode dans sa bande
      document.querySelectorAll('#dgModes .btn').forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.mode); autoQsy(); }));
      $('dgQsy').addEventListener('click', qsy);
      // Choisir une fréquence dans la liste y envoie directement le TRX (QSY)
      $('dgDial').addEventListener('change', () => { store.set('dial.' + mode, $('dgDial').value); qsy(); });
      $('dgClear').addEventListener('click', () => { hist.length = 0; redrawAll(); });
      // Split : clic gauche = fréquence de réception, clic droit = fréquence d'émission
      const fAt = (e) => { const r = e.currentTarget.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * WF_MAX_HZ; };
      for (const id of ['dgWf', 'dgScale']) {
        $(id).addEventListener('click', (e) => (tab === 'rtty' ? setRttyF(fAt(e)) : setRx(fAt(e))));
        $(id).addEventListener('contextmenu', (e) => { e.preventDefault(); if (tab === 'rtty') setRttyF(fAt(e)); else setTx(fAt(e)); });
      }
      initRtty();
      initWspr();
      initMsgs();
      $('dgTxRx').addEventListener('click', () => setTx(rxF));
      $('dgRxTx').addEventListener('click', () => setRx(txF));
      // Repli du panneau ou onglet du navigateur caché : le serveur arrête de décoder pour ce membre
      new MutationObserver(announce).observe($('centerPanel'), { attributes: true, attributeFilter: ['class'] });
      document.addEventListener('visibilitychange', announce);
      window.addEventListener('resize', () => { if (tab === 'ftx' || tab === 'jt65' || tab === 'rtty' || tab === 'wspr') sizeCanvas(); });
      fillDial();
      setMode(mode);
      showTab(tab);
      setInterval(() => {
        if (detached) return;
        if (tab === 'ftx' || tab === 'jt65') { clock(); status(); followBand(); }
        if (tab === 'rtty') status();
        if (tab === 'wspr') wsClock();
        if (tab === 'sync') drawSync();
      }, 500);
    },
    insertRtty,
    onHello(me, info) {
      needHist = true;
      wsNeedHist = true;
      if (info && info.digiCall) myCall = info.digiCall;
      if (info) myGrid = info.stationGrid || '';
      drawMsgs();
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
      if (m.t === 'rtty') { rttyAppend(m.text || ''); return true; }
      if (m.t === 'rtty_lvl') { rttyLevels(m); return true; }
      if ((m.t === 'ftx_hist' || m.t === 'ftx') && m.mode === 'WSPR') {
        if (m.t === 'ftx_hist') {
          wsHist.length = 0;
          for (const it of m.items || []) wsHist.push({ slot: it.slot, list: it.list || [] });
          wsRedraw();
        } else {
          wsLast = m.slot;
          const it = { slot: m.slot, list: m.list || [] };
          wsHist.push(it);
          while (wsHist.length > 60) wsHist.shift();
          wsAdd(it);
        }
        return true;
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
    onState() { if (tab === 'ftx' || tab === 'jt65') { status(); followBand(); } }
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
