/* Page Station : Web Serial (FTX-1) + WebSocket (VPS) autour de StationCore */
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

  const core = new StationCore({
    writeSerial(s) {
      if (sim) return sim.write(s);
      if (!writer) return;
      writeChain = writeChain.then(() => writer && writer.write(enc.encode(s))).catch((e) => log('Écriture série : ' + e.message, 'st-bad'));
    },
    sendWs(o) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
    },
    log: (m) => log(m, /TX ON/.test(m) ? 'st-warn' : /Sécurité|TX OFF —/.test(m) ? 'st-warn' : ''),
    onRadio(r) {
      lamp('lTrx', r.connected ? (r.tx ? 'tx' : 'on') : (port || sim) ? 'warn' : null);
      $('tTrx').textContent = r.connected ? (sim ? 'Simulation active' : 'Le FTX-1 répond') : (port || sim) ? 'Port ouvert, pas de réponse' : 'Aucun port choisi';
      $('read').textContent = r.connected && r.freq
        ? (r.freq / 1e6).toFixed(6).replace(/(\d)(\d{3})$/, '$1 $2') + ' MHz · ' + (r.mode || '?') + ' · ' + (r.tx ? 'TX' : FTX1.smeterLabel(r.smeter))
        : '—';
    }
  });

  // ------------------------------------------------------------ WebSocket vers le VPS
  function connectWs() {
    clearTimeout(wsTimer);
    const token = store.get('token', '');
    if (!token) {
      $('tVps').textContent = 'Entrez le jeton de la station ci-dessous';
      return;
    }
    if (ws) { ws.onclose = null; ws.close(); }
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => ws.send(JSON.stringify({ t: 'station', token }));
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.t === 'welcome') {
        wsRetry = 0;
        lamp('lVps', 'on');
        $('tVps').textContent = 'Connecté — station ' + (m.stationCall || '');
        log('Connecté au serveur');
        core.wsOpened();
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
      $('tVps').textContent = 'Liaison perdue, nouvelle tentative…';
      wsRetry = Math.min(wsRetry + 1, 6);
      wsTimer = setTimeout(connectWs, 1000 * Math.pow(2, wsRetry - 1));
    };
  }

  // ------------------------------------------------------------ Web Serial
  async function openPort(p) {
    const baudRate = Number(store.get('baud', '38400'));
    const stopBits = Number(store.get('stop', '1'));
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
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) core.onSerialData(dec.decode(value, { stream: true }));
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
    const idx = Number(store.get('portIndex', '-1'));
    if (ports.length && idx >= 0 && idx < ports.length) {
      log('Réouverture du port mémorisé');
      await openPort(ports[idx]);
    }
  }

  $('btnPort').addEventListener('click', async () => {
    if (!('serial' in navigator)) return;
    stopSim();
    try {
      const p = await navigator.serial.requestPort();
      await closePort(false);
      const ports = await navigator.serial.getPorts();
      store.set('portIndex', String(ports.indexOf(p)));
      await openPort(p);
    } catch (e) {
      if (e.name !== 'NotFoundError') log('Choix du port : ' + e.message, 'st-bad');
    }
  });
  $('btnClose').addEventListener('click', () => { stopSim(); store.set('portIndex', '-1'); closePort(true); });

  if ('serial' in navigator) {
    navigator.serial.addEventListener('disconnect', (e) => {
      if (port && e.target === port) { log('FTX-1 débranché (USB)', 'st-warn'); closePort(false); }
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
    sim = new FTX1.FakeFTX1();
    sim.onData = (s) => core.onSerialData(s);
    core.serialOpened();
    $('btnSim').textContent = 'Arrêter la simulation';
    log('Simulation : FTX-1 virtuel actif (aucune émission réelle)', 'st-warn');
  });

  // ------------------------------------------------------------ réglages
  $('cfgToken').value = store.get('token', '');
  $('cfgBaud').value = store.get('baud', '38400');
  $('cfgStop').value = store.get('stop', '1');
  $('btnSave').addEventListener('click', async () => {
    store.set('token', $('cfgToken').value.trim());
    store.set('baud', $('cfgBaud').value);
    store.set('stop', $('cfgStop').value);
    log('Réglages enregistrés');
    connectWs();
    if (port) {
      const idx = store.get('portIndex', '-1');
      await closePort(false);
      store.set('portIndex', idx);
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
  log('Page Station chargée');
  keepAwake();
  connectWs();
  reopenRemembered();
})();
