/* Page Station : Web Serial (port CAT du TRX) + WebSocket (VPS) autour de StationCore */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('rs.st.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rs.st.' + k, v); } catch (e) {} }
  };

  // ------------------------------------------------------------ journal
  function log(msg, cls) {
    const el = $('log');
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = new Date().toLocaleTimeString('fr-BE') + '  ' + msg;
    el.prepend(line);
    while (el.children.length > 300) el.lastChild.remove();
  }
  function lamp(id, cls) {
    const e = $(id);
    e.classList.remove('on', 'warn', 'tx');
    if (cls) e.classList.add(cls);
  }

  // ------------------------------------------------------------ cœur
  let ws = null;
  let wsRetry = 0;
  let wsTimer = null;
  let port = null;
  let reader = null;
  let writer = null;
  let writeChain = Promise.resolve();
  let sim = null;
  const enc = new TextEncoder();

  // ------------------------------------------------------------ jeton
  // Le jeton peut aussi être donné dans l'adresse : https://remote.op0p.be/station#jeton=XXXX
  // (raccourci de démarrage du PC du club). La partie après « # » n'est jamais envoyée au serveur.
  let hashToken = '';
  {
    const m = /(?:^|[#&])(?:jeton|token)=([A-Za-z0-9_-]{20,})/.exec(location.hash);
    if (m) {
      hashToken = m[1];
      store.set('token', hashToken);
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} // ne pas laisser le jeton visible
    }
  }
  const getToken = () => hashToken || store.get('token', '');

  // ------------------------------------------------------------ modèle de radio
  const MODEL = (window.RIGS && window.RIGS[store.get('model', 'ftx1')]) ? store.get('model', 'ftx1') : 'ftx1';
  const RIG = window.RIGS[MODEL];
  // Port série mémorisé par modèle : si plusieurs TRX restent branchés au PC, changer de modèle rouvre le bon port
  const PORT_KEY = 'port.' + MODEL;
  if (store.get(PORT_KEY, null) == null && store.get('portIndex', null) != null && MODEL === 'ftx1') store.set(PORT_KEY, store.get('portIndex', '-1'));
  $('rigName').textContent = RIG.NAME;
  const sel = $('cfgModel');
  for (const r of window.RIG_CATALOG) {
    const o = document.createElement('option');
    o.value = r.id;
    o.textContent = r.name + (r.ready && window.RIGS[r.id] ? '' : ' (prévu)');
    o.disabled = !(r.ready && window.RIGS[r.id]);
    sel.appendChild(o);
  }
  sel.value = MODEL;
  // Changer de modèle recharge la page avec le bon pilote (la vitesse série mémorisée pour ce modèle est reprise)
  sel.addEventListener('change', () => {
    if (sel.value === MODEL) return;
    store.set('model', sel.value);
    core.stop();
    setTimeout(() => location.reload(), 200);
  });
  $('rigHint').textContent = RIG.hint || '';
  $('rigHint').hidden = !RIG.hint;

  const core = new StationCore({
    rig: RIG,
    writeSerial(s) {
      if (sim) return sim.write(s);
      if (!writer) return;
      const bytes = typeof s === 'string' ? enc.encode(s) : s;
      writeChain = writeChain.then(() => writer && writer.write(bytes)).catch((e) => log('Écriture série : ' + e.message, 'st-bad'));
    },
    sendWs(o) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
    },
    log: (m) => log(m, /TX ON/.test(m) ? 'st-warn' : /Sécurité|TX OFF —/.test(m) ? 'st-warn' : ''),
    onRadio(r) {
      lamp('lTrx', r.connected ? (r.tx ? 'tx' : 'on') : (port || sim) ? 'warn' : null);
      $('tTrx').textContent = r.connected ? (sim ? 'Simulation active' : 'La radio répond') : (port || sim) ? 'Port ouvert, pas de réponse' : 'Aucun port choisi';
      $('read').textContent = r.connected && r.freq
        ? (r.freq / 1e6).toFixed(6).replace(/(\d)(\d{3})$/, '$1 $2') + ' MHz · ' + (r.mode || '?') + (r.split ? ' · SPLIT' : '') + ' · ' + (r.tx ? 'TX' : RIG.smeterLabel(r.smeter))
        : '—';
    }
  });

  // Modèles dont le port série a déjà été choisi sur ce PC (le changement à distance ne marche que pour eux)
  function rememberedPorts() {
    const out = {};
    for (const r of window.RIG_CATALOG) if (r.ready && window.RIGS[r.id]) out[r.id] = Number(store.get('port.' + r.id, '-1')) >= 0;
    return out;
  }
  // Changement de TRX demandé à distance par un administrateur : on recharge la page avec l'autre pilote
  function switchModel(model, by) {
    if (!window.RIGS[model] || model === MODEL) return;
    log('Changement de TRX demandé par ' + (by || '?') + ' : ' + window.RIGS[model].NAME, 'st-warn');
    store.set('model', model);
    core.stop();
    setTimeout(() => location.reload(), 300);
  }

  // ------------------------------------------------------------ WebSocket vers le VPS
  function connectWs() {
    clearTimeout(wsTimer);
    const token = getToken();
    if (!token) {
      $('tVps').textContent = 'Entrez le jeton de la station ci-dessous';
      return;
    }
    if (ws) { ws.onclose = null; ws.close(); }
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => ws.send(JSON.stringify({ t: 'station', token, model: MODEL, ports: rememberedPorts() }));
    lastServerMsg = Date.now();
    ws.onmessage = (e) => {
      lastServerMsg = Date.now();
      let m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.t === 'welcome') {
        wsRetry = 0;
        lamp('lVps', 'on');
        $('tVps').textContent = 'Connecté — station ' + (m.stationCall || '');
        log('Connecté au serveur');
        core.wsOpened();
        if (aud.ctx) ws.send(JSON.stringify({ t: 'audio_state', active: true }));
      } else if (m.t === 'audio_want') {
        aud.want = !!m.on;
        drawAudio();
      } else if (m.t === 'switch') {
        switchModel(m.model, m.by);
      } else if (m.t === 'error') {
        log('Serveur : ' + m.msg, 'st-bad');
        $('tVps').textContent = m.msg;
      } else {
        core.onWsMessage(m);
      }
    };
    ws.onclose = (e) => {
      core.wsClosed();
      lamp('lVps', null);
      if (e.code === 4001) {
        $('tVps').textContent = 'Jeton refusé : vérifiez-le dans les réglages';
        return;
      }
      if (e.code === 4002) {
        // Une autre page Station (autre PC ou autre onglet) a pris le relais : ne pas se reconnecter en boucle
        $('tVps').textContent = 'Remplacée par une autre page Station. « Enregistrer et reconnecter » pour reprendre ici.';
        log('Une autre page Station s’est connectée : celle-ci se met en retrait', 'st-warn');
        return;
      }
      $('tVps').textContent = 'Liaison perdue, nouvelle tentative…';
      wsRetry = Math.min(wsRetry + 1, 6);
      wsTimer = setTimeout(connectWs, 1000 * Math.pow(2, wsRetry - 1));
    };
  }

  // Contrôle de vie : une connexion peut mourir sans prévenir (changement d'adresse IP chez Starlink, box qui
  // redémarre…). Le navigateur croit alors être connecté et envoie dans le vide. On demande un « pong » au
  // serveur toutes les 5 s ; sans aucune nouvelle pendant 15 s, on abandonne cette connexion et on se reconnecte.
  let lastServerMsg = Date.now();
  setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    if (Date.now() - lastServerMsg > 15000) {
      log('Plus de nouvelles du serveur depuis 15 s : reconnexion automatique', 'st-warn');
      const old = ws;
      old.onclose = null;
      old.onmessage = null;
      try { old.close(); } catch (e) {}
      ws = null;
      core.wsClosed();
      lamp('lVps', null);
      $('tVps').textContent = 'Liaison perdue, reconnexion…';
      connectWs();
      return;
    }
    try { ws.send(JSON.stringify({ t: 'ping', ts: Date.now() })); } catch (e) {}
  }, 5000);

  // ------------------------------------------------------------ Web Serial
  async function openPort(p) {
    const baudRate = Number(store.get('baud.' + MODEL, String(RIG.serial.baudRate)));
    const stopBits = Number(store.get('stop.' + MODEL, String(RIG.serial.stopBits)));
    try {
      await p.open({ baudRate, dataBits: 8, stopBits, parity: 'none', flowControl: 'none', bufferSize: 4096 });
    } catch (e) {
      log('Ouverture du port impossible : ' + e.message + ' (port déjà utilisé par un autre logiciel ?)', 'st-bad');
      return;
    }
    // RTS/DTR au repos : évite toute émission accidentelle si RPTT SELECT est configuré
    try { await p.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch (e) {}
    port = p;
    writer = p.writable.getWriter();
    reader = p.readable.getReader();
    core.serialOpened();
    const info = p.getInfo ? p.getInfo() : {};
    log('Port ouvert à ' + baudRate + ' bps, ' + stopBits + ' bit(s) de stop' + (info.usbVendorId ? ' (USB ' + info.usbVendorId.toString(16) + ':' + (info.usbProductId || 0).toString(16) + ')' : ''));
    readLoop();
  }

  async function readLoop() {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) core.onSerialData(value); // octets bruts : le pilote les découpe (texte Yaesu ou trames CI-V)
      }
    } catch (e) {
      log('Lecture série interrompue : ' + e.message, 'st-warn');
    }
    await closePort(false);
  }

  async function closePort(manual) {
    if (!port) return;
    const p = port;
    port = null;
    core.serialClosed();
    try { if (reader) { await reader.cancel(); reader.releaseLock(); } } catch (e) {}
    try { if (writer) { await writeChain; writer.releaseLock(); } } catch (e) {}
    reader = null;
    writer = null;
    try { await p.close(); } catch (e) {}
    if (manual) log('Port libéré');
  }

  async function reopenRemembered() {
    if (!('serial' in navigator)) return;
    const ports = await navigator.serial.getPorts();
    const idx = Number(store.get(PORT_KEY, '-1'));
    if (ports.length && idx >= 0 && idx < ports.length) {
      log('Réouverture du port mémorisé pour ' + RIG.NAME);
      await openPort(ports[idx]);
    } else if (idx < 0) {
      log('Aucun port mémorisé pour ' + RIG.NAME + ' : cliquez sur « Choisir le port du TRX »');
    }
  }

  $('btnPort').addEventListener('click', async () => {
    if (!('serial' in navigator)) return;
    stopSim();
    try {
      const p = await navigator.serial.requestPort();
      await closePort(false);
      const ports = await navigator.serial.getPorts();
      store.set(PORT_KEY, String(ports.indexOf(p)));
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ports', ports: rememberedPorts() }));
      await openPort(p);
    } catch (e) {
      if (e.name !== 'NotFoundError') log('Choix du port : ' + e.message, 'st-bad');
    }
  });
  $('btnClose').addEventListener('click', () => { stopSim(); store.set(PORT_KEY, '-1'); closePort(true); });

  if ('serial' in navigator) {
    navigator.serial.addEventListener('disconnect', (e) => {
      if (port && e.target === port) { log(RIG.NAME + ' débranché (USB)', 'st-warn'); closePort(false); }
    });
    navigator.serial.addEventListener('connect', () => {
      log('Périphérique USB rebranché');
      setTimeout(() => { if (!port && !sim) reopenRemembered(); }, 1500);
    });
  } else {
    $('noSerial').hidden = false;
    $('btnPort').disabled = true;
  }

  // ------------------------------------------------------------ simulation
  function stopSim() {
    if (!sim) return;
    sim.onData = null;
    sim = null;
    core.serialClosed();
    $('btnSim').textContent = 'Tester sans radio (simulation)';
    log('Simulation arrêtée');
  }
  $('btnSim').addEventListener('click', async () => {
    if (sim) return stopSim();
    await closePort(false);
    sim = new RIG.Fake();
    sim.onData = (s) => core.onSerialData(s);
    core.serialOpened();
    $('btnSim').textContent = 'Arrêter la simulation';
    log('Simulation : ' + RIG.NAME + ' virtuel actif (aucune émission réelle)', 'st-warn');
  });

  // ------------------------------------------------------------ audio BF du TRX → VPS
  // Capture de l'entrée son choisie, rééchantillonnée à 8 kHz par le navigateur, codée en µ-law,
  // envoyée par paquets de 40 ms (320 échantillons) seulement quand un membre écoute.
  const aud = { ctx: null, stream: null, want: false, sent: 0, peak: 0 };
  const CAPTURE_WORKLET = `
    class RsCapture extends AudioWorkletProcessor {
      constructor() { super(); this.buf = new Float32Array(320); this.n = 0; }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch) for (let i = 0; i < ch.length; i++) {
          this.buf[this.n++] = ch[i];
          if (this.n === 320) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
        }
        return true;
      }
    }
    registerProcessor('rs-capture', RsCapture);`;

  function drawAudio() {
    $('tAudio').textContent = !aud.ctx ? 'Audio arrêté'
      : aud.ctx.state !== 'running' ? 'Audio en pause : cliquez n’importe où sur la page pour le relancer'
      : aud.want ? 'Audio envoyé aux membres à l’écoute' : 'Audio prêt (personne n’écoute en ce moment, rien n’est envoyé)';
    $('btnAudio').textContent = aud.ctx ? 'Arrêter l’audio' : 'Activer l’audio';
  }

  async function listInputs(selectId) {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    const sel = $('audDev');
    sel.textContent = '';
    for (const d of devs) {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || 'Entrée son ' + (sel.length + 1);
      sel.appendChild(o);
    }
    const saved = store.get('audio.label', '');
    const pick = devs.find((d) => d.deviceId === selectId) || devs.find((d) => saved && d.label === saved)
      || devs.find((d) => /usb audio codec|codec|yaesu|ftx|ftdx|ic-?7300|icom/i.test(d.label));
    if (pick) sel.value = pick.deviceId;
    return devs;
  }

  async function startAudio() {
    if (!navigator.mediaDevices || !window.AudioWorkletNode) return log('Audio impossible : navigateur trop ancien', 'st-bad');
    try {
      // Première fois : demander l'autorisation pour connaître le nom des entrées, puis choisir celle du TRX
      if (!$('audDev').value || !$('audDev').selectedOptions[0] || !$('audDev').selectedOptions[0].textContent.trim()) {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
        await listInputs();
      }
      const deviceId = $('audDev').value;
      aud.stream = await navigator.mediaDevices.getUserMedia({
        audio: Object.assign({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
          deviceId ? { deviceId: { exact: deviceId } } : {})
      });
      const track = aud.stream.getAudioTracks()[0];
      await listInputs(track && track.getSettings().deviceId);
      if (track) store.set('audio.label', track.label);
      aud.ctx = new AudioContext({ sampleRate: ULAW.RATE });
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
      await aud.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const src = aud.ctx.createMediaStreamSource(aud.stream);
      const node = new AudioWorkletNode(aud.ctx, 'rs-capture');
      const mute = aud.ctx.createGain();
      mute.gain.value = 0; // rien n'est joué sur le PC du club
      src.connect(node);
      node.connect(mute).connect(aud.ctx.destination);
      node.port.onmessage = (e) => {
        const buf = e.data;
        let p = 0;
        for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
        aud.peak = Math.max(p, aud.peak * 0.85);
        if (aud.want && ws && ws.readyState === 1 && ws.bufferedAmount < 65536) {
          ws.send(ULAW.encodeFrame(buf));
          aud.sent++;
        }
      };
      aud.ctx.onstatechange = drawAudio;
      store.set('audio.on', '1');
      log('Audio activé : ' + (track ? track.label : 'entrée par défaut'));
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'audio_state', active: true }));
    } catch (e) {
      log('Audio : ' + (e.name === 'NotAllowedError' ? 'accès au son refusé (autorisez le micro pour ce site)' : e.message), 'st-bad');
      stopAudio(false);
    }
    drawAudio();
  }

  function stopAudio(manual) {
    if (aud.stream) aud.stream.getTracks().forEach((t) => t.stop());
    if (aud.ctx) aud.ctx.close().catch(() => {});
    aud.stream = null;
    aud.ctx = null;
    aud.peak = 0;
    if (manual) {
      store.set('audio.on', '0');
      log('Audio arrêté');
    }
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'audio_state', active: false }));
    drawAudio();
  }

  $('btnAudio').addEventListener('click', () => (aud.ctx ? stopAudio(true) : startAudio()));
  $('audDev').addEventListener('change', () => {
    const o = $('audDev').selectedOptions[0];
    if (o) store.set('audio.label', o.textContent);
    if (aud.ctx) { stopAudio(false); startAudio(); }
  });
  // Chrome peut suspendre l'audio d'une page sans clic : le premier clic le relance
  document.addEventListener('click', () => { if (aud.ctx && aud.ctx.state === 'suspended') aud.ctx.resume().then(drawAudio); });
  setInterval(() => { $('audLvl').style.width = Math.min(100, Math.round(aud.peak * 100)) + '%'; aud.peak *= 0.9; }, 100);
  if (navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener('devicechange', () => listInputs($('audDev').value).catch(() => {}));
    // Réactivation automatique si l'audio était en marche (l'autorisation du site est mémorisée par Chrome)
    if (store.get('audio.on', '0') === '1') listInputs().catch(() => {}).then(startAudio);
  }
  drawAudio();

  // ------------------------------------------------------------ réglages
  $('cfgToken').value = getToken();
  // Vitesse et bits de stop mémorisés par modèle (FTX-1/FTDX10 : 38400 ; IC-7300 : 115200)
  $('cfgBaud').value = store.get('baud.' + MODEL, String(RIG.serial.baudRate));
  $('cfgStop').value = store.get('stop.' + MODEL, String(RIG.serial.stopBits));
  $('btnSave').addEventListener('click', async () => {
    // Le jeton n'est remplacé que par une valeur plausible (jamais vidé ni écrasé par autre chose par erreur)
    const tok = $('cfgToken').value.trim().replace(/^"|",?$/g, '');
    if (tok && tok !== getToken()) {
      if (/^[0-9a-f]{32,}$/i.test(tok) || /^[A-Za-z0-9_-]{20,}$/.test(tok)) {
        store.set('token', tok);
        hashToken = tok;
        log('Nouveau jeton enregistré');
      } else {
        log('Jeton non enregistré : il doit faire au moins 20 caractères (chiffres et lettres), sans espace ni guillemet', 'st-bad');
        $('cfgToken').value = getToken();
      }
    }
    store.set('baud.' + MODEL, $('cfgBaud').value);
    store.set('stop.' + MODEL, $('cfgStop').value);
    if ($('cfgModel').value !== MODEL) {
      store.set('model', $('cfgModel').value);
      log('Modèle changé : rechargement de la page');
      core.stop();
      return setTimeout(() => location.reload(), 300);
    }
    log('Réglages enregistrés');
    connectWs();
    if (port) {
      const idx = store.get(PORT_KEY, '-1');
      await closePort(false);
      store.set(PORT_KEY, idx);
      reopenRemembered();
    }
  });

  // ------------------------------------------------------------ garder la station éveillée
  let wake = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wake && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) {}
  }
  document.addEventListener('visibilitychange', keepAwake);

  window.addEventListener('beforeunload', () => core.stop());

  // ------------------------------------------------------------ démarrage
  log('Page Station chargée' + (window.RS_WORKER_TIMERS ? ' (fonctionne aussi en arrière-plan)' : ''));
  try {
    localStorage.setItem('rs.st.test', '1');
    localStorage.removeItem('rs.st.test');
  } catch (e) {
    log('Chrome n’enregistre pas les données de ce site : le jeton et le port seront oubliés à chaque fois (voir Paramètres → Confidentialité → Données des sites)', 'st-bad');
  }
  keepAwake();
  connectWs();
  reopenRemembered();
})();
