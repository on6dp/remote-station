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
    setTimeout(() => reloadPage(), 200);
  });
  $('rigHint').textContent = RIG.hint || '';
  $('rigHint').hidden = !RIG.hint;

  const core = new StationCore({
    rig: RIG,
    txAudio: { prepare: (...a) => txPrepare(...a), prepareSamples: (...a) => txPrepareSamples(...a), play: (...a) => txPlay(...a), stop: () => txStop() },
    writeSerial(s) {
      if (sim) return sim.write(s);
      if (!writer) return;
      const bytes = typeof s === 'string' ? enc.encode(s) : s;
      writeChain = writeChain.then(() => writer && writer.write(bytes)).catch((e) => log('Écriture série : ' + e.message, 'st-bad'));
    },
    sendWs(o) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
    },
    log: (m, cls) => log(m, cls || (/TX ON/.test(m) ? 'st-warn' : /Sécurité|TX OFF —/.test(m) ? 'st-warn' : '')),
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
    setTimeout(() => reloadPage(), 300);
  }

  // ------------------------------------------------------------ WebSocket vers le VPS
  let loadedCode = ''; // empreinte du programme de la page Station, donnée par le serveur à la première connexion
  function connectWs() {
    clearTimeout(wsTimer);
    const token = getToken();
    if (!token) {
      $('tVps').textContent = 'Entrez le jeton de la station ci-dessous';
      return;
    }
    // L'ancienne connexion n'est fermée qu'une fois la nouvelle acceptée : le serveur passe de l'une à l'autre
    // sans annoncer « station hors ligne » au dashboard (pas de trou à l'écran pendant une reconnexion).
    const prev = ws;
    if (prev) {
      prev.onclose = null;
      prev.onmessage = null;
      if (!lastDrop) lastDrop = { how: 'reconnexion demandée sur la page', at: Date.now() };
    }
    const closePrev = () => { if (prev) { try { prev.close(); } catch (e) {} } };
    setTimeout(closePrev, 10000);
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    // caps : ce que sait faire cette version de la page (ftsplit : SPLIT du FTX-1 par FT0 / FT1, sans ST1)
    ws.onopen = () => ws.send(JSON.stringify({ t: 'station', token, model: MODEL, ports: rememberedPorts(), page: PAGE_ID, caps: ['ftsplit', 'autoreload', 'txsel', 'catq', 'ftxtx', 'audiotx'] }));
    lastServerMsg = Date.now();
    ws.onmessage = (e) => {
      lastServerMsg = Date.now();
      let m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.t === 'welcome') {
        // Serveur mis à jour depuis le chargement de cette page : on recharge pour avoir les nouveaux pilotes
        if (m.code && loadedCode && m.code !== loadedCode && !core.catKeyed) {
          log('Nouvelle version du serveur : rechargement de la page Station', 'st-warn');
          core.stop();
          return setTimeout(() => reloadPage(), 500);
        }
        if (m.code && !loadedCode) loadedCode = m.code;
        ALC_MAX = Number(m.alcMax) > 0 ? Number(m.alcMax) : 0;
        closePrev();
        wsRetry = 0;
        lamp('lVps', 'on');
        $('tVps').textContent = 'Connecté — station ' + (m.stationCall || '');
        log('Connecté au serveur');
        core.setTxLimits(m.txSilenceSeconds, m.txHardMaxSeconds);
        // Diagnostic : le serveur note pourquoi la liaison précédente est tombée et combien de temps elle l'a été
        while (pendingDiag.length) ws.send(JSON.stringify(Object.assign({ t: 'diag' }, pendingDiag.shift())));
        if (lastDrop) {
          const d = lastDrop;
          lastDrop = null;
          const down = Math.round((Date.now() - d.at) / 1000);
          ws.send(JSON.stringify({ t: 'diag', how: d.how, code: d.code || null, reason: d.reason || '', down, tries: d.tries || 0 }));
          if (down >= 5) log('Liaison rétablie après ' + down + ' s (' + d.how + ')', 'st-warn');
        }
        core.wsOpened();
        if (aud.ctx) ws.send(JSON.stringify({ t: 'audio_state', active: true }));
        try { ws.send(JSON.stringify({ t: 'ping', ts: Date.now() })); } catch (e) {} // première mesure de l'horloge
      } else if (m.t === 'pong') {
        onPong(m);
      } else if (m.t === 'audio_want') {
        aud.want = !!m.on;
        drawAudio();
      } else if (m.t === 'switch') {
        switchModel(m.model, m.by);
      } else if (m.t === 'reload') {
        if (core.catKeyed) return;
        log('Rechargement de la page demandé par ' + (m.by || '?'), 'st-warn');
        core.stop();
        setTimeout(() => reloadPage(), 300);
      } else if (m.t === 'error') {
        log('Serveur : ' + m.msg, 'st-bad');
        $('tVps').textContent = m.msg;
      } else {
        core.onWsMessage(m);
      }
    };
    ws.onclose = (e) => {
      closePrev();
      if (!lastDrop) lastDrop = { how: 'fermeture', code: e.code, reason: e.reason, at: Date.now() };
      lastDrop.tries = (lastDrop.tries || 0) + 1;
      log('Liaison avec le serveur fermée (code ' + e.code + (e.reason ? ', ' + e.reason : '') + ')', e.code === 1000 ? '' : 'st-warn');
      core.wsClosed();
      lamp('lVps', null);
      if (e.code === 4001) {
        $('tVps').textContent = 'Jeton refusé : vérifiez-le dans les réglages';
        return;
      }
      if (e.code === 4004) {
        // Une autre page Station a déjà le TRX : on réessaie seulement de temps en temps (si elle disparaît, on prend le relais)
        $('tVps').textContent = 'Une autre page Station (avec le TRX) est déjà en service ailleurs : nouvel essai dans 15 s';
        log('Refusée : une autre page Station, avec le TRX connecté, est déjà en service sur un autre PC', 'st-warn');
        wsTimer = setTimeout(connectWs, 15000);
        return;
      }
      if (e.code === 4002) {
        // Une autre page Station (autre PC ou autre onglet) a pris le relais : ne pas se reconnecter en boucle
        $('tVps').textContent = 'Remplacée par une autre page Station. « Enregistrer et reconnecter » pour reprendre ici.';
        log('Une autre page Station s’est connectée : celle-ci se met en retrait', 'st-warn');
        return;
      }
      // La station doit revenir vite : nouvel essai après 1, 2, 4 puis toutes les 5 s
      wsRetry = Math.min(wsRetry + 1, 6);
      const wait = Math.min(5000, 1000 * Math.pow(2, wsRetry - 1));
      $('tVps').textContent = 'Liaison perdue (code ' + e.code + '), nouvel essai dans ' + Math.round(wait / 1000) + ' s…';
      wsTimer = setTimeout(connectWs, wait);
    };
  }

  // Contrôle de vie : une connexion peut mourir sans prévenir (changement d'adresse IP chez Starlink, box qui
  // redémarre…). Le navigateur croit alors être connecté et envoie dans le vide. On demande un « pong » au
  // serveur toutes les 5 s ; sans aucune nouvelle pendant 15 s, on abandonne cette connexion et on se reconnecte.
  let lastServerMsg = Date.now();
  let lastDrop = null; // dernière coupure de la liaison (pour le diagnostic envoyé au serveur)
  const pendingDiag = [];
  function sendDiag(o) {
    if (ws && ws.readyState === 1 && core.wsUp) ws.send(JSON.stringify(Object.assign({ t: 'diag' }, o)));
    else if (pendingDiag.length < 10) pendingDiag.push(o);
  }

  // Chrome peut mettre en pause (« figer ») ou décharger un onglet en arrière-plan pour économiser l'énergie
  // ou la mémoire : la page Station ne fait alors plus rien. On le détecte pour l'afficher et le signaler au serveur.
  let tick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const gap = now - tick;
    tick = now;
    if (gap > 6000) {
      const s = Math.round(gap / 1000);
      log('La page Station a été mise en pause pendant ' + s + ' s (Chrome, veille du PC…)', 'st-bad');
      sendDiag({ how: 'page Station en pause (Chrome ou veille du PC)', down: s });
    }
  }, 1000);
  document.addEventListener('freeze', () => store.set('frozenAt', String(Date.now())));
  document.addEventListener('resume', () => {
    const at = Number(store.get('frozenAt', '0'));
    const s = at ? Math.round((Date.now() - at) / 1000) : null;
    log('Chrome avait figé cette page' + (s != null ? ' pendant ' + s + ' s' : '') + ' (économiseur d’énergie / onglet en arrière-plan)', 'st-bad');
    sendDiag({ how: 'page figée par Chrome (freeze)', down: s });
  });
  window.addEventListener('pagehide', () => store.set('hiddenAt', String(Date.now())));
  (function () {
    const at = Number(store.get('hiddenAt', '0'));
    const s = at ? Math.round((Date.now() - at) / 1000) : null;
    if (document.wasDiscarded) {
      log('Chrome avait déchargé cette page' + (s != null ? ' (' + s + ' s sans page Station)' : '') + ' : économiseur de mémoire. Voir le guide pour garder remote.op0p.be toujours actif.', 'st-bad');
      sendDiag({ how: 'page déchargée par Chrome (économiseur de mémoire)', down: s });
    } else if (s != null && s < 3600) {
      sendDiag({ how: 'page Station rechargée ou rouverte', down: s });
    }
  })();
  // Identifiant de cette page : sa propre reconnexion peut remplacer son ancienne connexion, pas une autre page
  const PAGE_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
  setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    if (Date.now() - lastServerMsg > 15000) {
      log('Plus de nouvelles du serveur depuis 15 s : reconnexion automatique', 'st-warn');
      lastDrop = { how: 'aucune réponse du serveur pendant 15 s', at: Date.now() };
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

  // Port mémorisé : reconnu par son identité USB (fabricant, produit, rang parmi les ports identiques), pas seulement
  // par sa place dans la liste de Chrome — cette place change quand on autorise un autre port (autre TRX, autre appareil USB),
  // et le TRX ne répondait plus (port d'un autre appareil rouvert à sa place).
  function portIdent(p, ports) {
    const i = (p && p.getInfo && p.getInfo()) || {};
    const same = ports.filter((q) => { const j = (q.getInfo && q.getInfo()) || {}; return j.usbVendorId === i.usbVendorId && j.usbProductId === i.usbProductId; });
    return { v: i.usbVendorId || 0, p: i.usbProductId || 0, n: same.indexOf(p) };
  }
  function rememberPort(p, ports) {
    store.set(PORT_KEY, String(ports.indexOf(p)));
    store.set(PORT_KEY + '.id', JSON.stringify(portIdent(p, ports)));
  }
  function findRemembered(ports) {
    if (Number(store.get(PORT_KEY, '-1')) < 0) return null;
    let id = null;
    try { id = JSON.parse(store.get(PORT_KEY + '.id', 'null')); } catch (e) { id = null; }
    if (id && (id.v || id.p)) {
      const same = ports.filter((q) => { const j = (q.getInfo && q.getInfo()) || {}; return j.usbVendorId === id.v && j.usbProductId === id.p; });
      return same[id.n] || same[0] || null;
    }
    // Ancienne mémoire (place dans la liste seulement) : on la complète par l'identité USB
    const idx = Number(store.get(PORT_KEY, '-1'));
    const p = idx >= 0 && idx < ports.length ? ports[idx] : null;
    if (p) store.set(PORT_KEY + '.id', JSON.stringify(portIdent(p, ports)));
    return p;
  }
  async function reopenRemembered() {
    if (!('serial' in navigator)) return;
    const ports = await navigator.serial.getPorts();
    const idx = Number(store.get(PORT_KEY, '-1'));
    const rp = findRemembered(ports);
    if (rp) {
      log('Réouverture du port mémorisé pour ' + RIG.NAME);
      await openPort(rp);
    } else if (idx >= 0) {
      log('Port mémorisé pour ' + RIG.NAME + ' introuvable (TRX débranché ou éteint ?) : branchez-le, ou « Choisir le port du TRX »', 'st-warn');
    } else if (idx < 0) {
      log('Aucun port mémorisé pour ' + RIG.NAME + ' : cliquez sur « Choisir le port du TRX »');
    }
  }

  // Surveillance du port : si le TRX ne répond plus (câble USB, mise en veille USB de Windows, radio redémarrée…)
  // ou si le port s'est fermé, la page le rouvre toute seule, sans intervention au club.
  let radioDownSince = 0;
  let recycleWait = 10000;
  let recycling = false;
  let lastPortTry = 0;
  setInterval(async () => {
    if (sim || recycling || !('serial' in navigator)) return;
    const now = Date.now();
    const remembered = Number(store.get(PORT_KEY, '-1')) >= 0;
    if (port) {
      if (core.radio.connected) { radioDownSince = 0; recycleWait = 10000; return; }
      if (!radioDownSince) { radioDownSince = now; return; }
      if (now - radioDownSince < recycleWait || !remembered) return;
      recycling = true;
      log('Le TRX ne répond plus depuis ' + Math.round(recycleWait / 1000) + ' s : réouverture automatique du port', 'st-warn');
      recycleWait = Math.min(recycleWait * 2, 60000); // si la radio est éteinte, on espace les essais
      radioDownSince = now;
      try {
        const idx = store.get(PORT_KEY, '-1');
        await closePort(false);
        store.set(PORT_KEY, idx);
        await new Promise((r) => setTimeout(r, 800));
        await reopenRemembered();
      } catch (e) { log('Réouverture : ' + e.message, 'st-bad'); }
      recycling = false;
    } else if (remembered && now - lastPortTry > 10000) {
      // Port fermé (câble débranché puis rebranché, erreur de lecture…) : nouvel essai toutes les 10 s
      lastPortTry = now;
      recycling = true;
      try { await reopenRemembered(); } catch (e) {}
      recycling = false;
    }
  }, 3000);

  $('btnPort').addEventListener('click', async () => {
    if (!('serial' in navigator)) return;
    stopSim();
    try {
      const p = await navigator.serial.requestPort();
      await closePort(false);
      const ports = await navigator.serial.getPorts();
      rememberPort(p, ports);
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
      // Voie gauche (ou unique) ; voie droite gardée à part quand elle existe (FTDX101 : récepteur SUB)
      constructor() { super(); this.buf = new Float32Array(480); this.bufR = new Float32Array(480); this.n = 0; }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        const r = inputs[0] && inputs[0][1];
        if (ch) for (let i = 0; i < ch.length; i++) {
          this.buf[this.n] = ch[i];
          this.bufR[this.n] = r ? r[i] : 0;
          if (++this.n === 480) { this.port.postMessage({ l: this.buf.slice(0), r: r ? this.bufR.slice(0) : null }); this.n = 0; }
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

  const isAlias = (d) => d.deviceId === 'default' || d.deviceId === 'communications';
  const unAlias = (l) => String(l || '').replace(/^(Communications|Par défaut|Default)\s*-\s*/i, '');
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
    // « Par défaut - … » et « Communications - … » ne sont que des alias de Windows : ils changent de carte son quand
    // Windows change de périphérique par défaut (ex. un autre TRX branché) — on retient toujours la carte réelle
    const real = devs.filter((d) => !isAlias(d));
    const saved = unAlias(store.get('audio.label', ''));
    const asked = devs.find((d) => d.deviceId === selectId);
    const pick = (asked && isAlias(asked) ? real.find((d) => d.groupId === asked.groupId) || asked : asked)
      || real.find((d) => saved && d.label === saved)
      // Carte son USB du TRX : « USB Audio CODEC » (Icom, FTDX10), « USB Audio Device » (FTX-1)… jamais « Mixage stéréo »
      || real.find((d) => /usb audio|codec|yaesu|ftx|ftdx|ic-?7300|icom/i.test(d.label) && !/mixage|stereo mix/i.test(d.label));
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
      // Alias Windows choisi (« Communications - … », « Par défaut - … ») : on prend la carte son réelle qu'il désigne
      const ins = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      const selIn = ins.find((d) => d.deviceId === $('audDev').value);
      if (selIn && isAlias(selIn)) {
        const r = ins.find((d) => !isAlias(d) && d.groupId === selIn.groupId);
        if (r) { $('audDev').value = r.deviceId; log('Entrée son : « ' + selIn.label + ' » est un alias de Windows, remplacé par « ' + r.label + ' »'); }
      }
      const deviceId = $('audDev').value;
      aud.stream = await navigator.mediaDevices.getUserMedia({
        // TRX à deux récepteurs avec son USB en stéréo (FTDX101 : MAIN à gauche, SUB à droite) : les deux voies
        audio: Object.assign({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: RIG.DUAL_AUDIO ? 2 : 1 },
          deviceId ? { deviceId: { exact: deviceId } } : {})
      });
      const track = aud.stream.getAudioTracks()[0];
      await listInputs(track && track.getSettings().deviceId);
      if (track) store.set('audio.label', unAlias(track.label));
      if (!tx.ctx) listOutputs().then(() => startTxOut()).catch(() => {});
      // 12 kHz, PCM 16 bits : qualité nécessaire au décodage FT8 / FT4 / RTTY sur le serveur (trames de 40 ms)
      aud.ctx = new AudioContext({ sampleRate: ULAW.RATE_HQ });
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
        const buf = e.data.l;
        const bufR = RIG.DUAL_AUDIO ? e.data.r : null;
        let p = 0;
        for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
        if (bufR) for (let i = 0; i < bufR.length; i++) { const a = Math.abs(bufR[i]); if (a > p) p = a; }
        aud.peak = Math.max(p, aud.peak * 0.85);
        if (aud.want && ws && ws.readyState === 1 && ws.bufferedAmount < 65536) {
          ws.send(ULAW.encodePcm(buf));
          if (bufR) ws.send(ULAW.encodePcm(bufR, 0x04)); // voie droite : récepteur SUB (décodage RTTY B, écoute en double réception)
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
    if (o) store.set('audio.label', unAlias(o.textContent));
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

  // ------------------------------------------------------------ horloge du VPS
  // L'émission FT8 / FT4 / FT2 part à l'heure du VPS (synchronisé par NTP) : l'horloge de Windows peut être
  // décalée de plusieurs secondes. Écart mesuré à chaque « pong » (aller-retour le plus court = mesure la plus fiable).
  const clk = { best: Infinity, at: 0, off: null };
  function onPong(m) {
    if (!Number.isFinite(m.now) || !Number.isFinite(m.ts)) return;
    const t = Date.now();
    const rtt = t - m.ts;
    if (rtt < 0 || rtt > 5000) return;
    if (rtt > clk.best && t - clk.at < 120000) return;
    clk.best = rtt;
    clk.at = t;
    const off = Math.round(m.now - (m.ts + rtt / 2));
    if (clk.off == null || Math.abs(off - clk.off) > 500) {
      if (Math.abs(off) > 1000) log('L’horloge de ce PC est décalée de ' + (off / 1000).toFixed(1).replace('.', ',') + ' s par rapport au VPS : corrigé pour l’émission numérique', 'st-warn');
    }
    clk.off = off;
    core.setClock(off);
  }

  // ------------------------------------------------------------ audio vers le TRX (émission numérique)
  // Le signal FT8 / FT4 / FT2 est fabriqué ici (ft8_lib en WebAssembly) et joué sur la carte son USB du TRX,
  // pendant que le TRX est en émission (PTT par CAT). Rien n'est joué sur les haut-parleurs du PC.
  const tx = { ctx: null, gain: null, enc: null, prep: null, src: null, label: '' };
  if (window.RSFTXENC) {
    window.RSFTXENC.load('/js/ftx-enc.wasm').then((e) => { tx.enc = e; }).catch((e) => log('Codeur FT8 / FT4 / FT2 non chargé : ' + e.message, 'st-bad'));
  }
  const txLevel = () => Math.max(1, Math.min(100, Number(store.get('txlevel', '30')) || 30));
  function drawTxOut() {
    $('audTxLvl').value = String(txLevel());
    $('audTxPct').textContent = txLevel() + ' %';
    $('tAudioOut').textContent = !tx.ctx ? 'Sortie vers le TRX : aucune (émission FT8 / FT4 / FT2 impossible)'
      : tx.ctx.state !== 'running' ? 'Sortie vers le TRX en pause : cliquez n’importe où sur la page pour la relancer'
      : 'Sortie vers le TRX : ' + tx.label + (tx.src ? ' · émission en cours' : '');
  }
  async function listOutputs() {
    if (!navigator.mediaDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    const outs = all.filter((d) => d.kind === 'audiooutput');
    const sel = $('audOut');
    const cur = sel.value;
    sel.textContent = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '— aucune (pas d’émission numérique) —';
    sel.appendChild(none);
    for (const d of outs) {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || 'Sortie son ' + sel.length;
      sel.appendChild(o);
    }
    let saved = store.get('audio.outLabel', null);
    if (saved) saved = unAlias(saved); // alias Windows (« Communications - … ») : la carte réelle
    const real = outs.filter((d) => !isAlias(d));
    const inDev = all.find((d) => d.kind === 'audioinput' && d.deviceId === $('audDev').value);
    // Choix mémorisé, sinon la même carte son que l'entrée du TRX, sinon un nom de carte son de TRX (jamais les haut-parleurs du PC)
    const pick = (saved != null ? real.find((d) => d.label === saved) : null)
      || (saved == null && inDev && inDev.groupId ? real.find((d) => d.groupId === inDev.groupId) : null)
      || (saved == null ? real.find((d) => /usb audio|codec|yaesu|ftx|ftdx|ic-?7300|icom/i.test(d.label)) : null);
    sel.value = pick ? pick.deviceId : (saved === '' ? '' : cur && outs.find((d) => d.deviceId === cur) ? cur : '');
    return outs;
  }
  function stopTxOut() {
    txStop();
    if (tx.ctx) tx.ctx.close().catch(() => {});
    tx.ctx = null;
    tx.gain = null;
    tx.prep = null;
  }
  async function startTxOut() {
    stopTxOut();
    const o = $('audOut').selectedOptions[0];
    if (!o || !o.value) { drawTxOut(); return; }
    try {
      const ctx = new AudioContext({ sampleRate: 48000 });
      if (!ctx.setSinkId) { ctx.close(); throw new Error('Chrome trop ancien pour choisir la sortie son (version 110 ou plus récente nécessaire)'); }
      await ctx.setSinkId(o.value);
      tx.gain = ctx.createGain();
      tx.gain.gain.value = txLevel() / 100;
      tx.gain.connect(ctx.destination);
      tx.ctx = ctx;
      tx.label = o.textContent;
      ctx.onstatechange = drawTxOut;
      log('Sortie son vers le TRX : ' + o.textContent);
    } catch (e) {
      log('Sortie son vers le TRX : ' + e.message, 'st-bad');
    }
    drawTxOut();
  }
  function txPrepare(id, mode, text, f0) {
    if (!tx.enc) return { ok: false, err: 'codeur FT8 / FT4 / FT2 pas encore chargé sur la page Station' };
    if (!tx.ctx) return { ok: false, err: 'aucune sortie son vers le TRX choisie sur la page Station' };
    if (tx.ctx.state !== 'running') { tx.ctx.resume().catch(() => {}); return { ok: false, err: 'sortie son vers le TRX en pause sur la page Station (un clic sur la page au club la relance)' }; }
    const f = Number(f0);
    if (!(f >= 100 && f <= 3000)) return { ok: false, err: 'fréquence audio hors plage (100 à 3000 Hz)' };
    const r = tx.enc.encode(mode, text, tx.ctx.sampleRate, f);
    if (!r) return { ok: false, err: 'message impossible à coder en ' + mode + ' : « ' + String(text).slice(0, 40) + ' »' };
    tx.prep = { id, samples: r.samples };
    return { ok: true, text: r.text, seconds: r.seconds };
  }
  // RTTY / JTTY : signal déjà fabriqué par le serveur (entiers 16 bits en base64, `rate` Hz)
  function txPrepareSamples(id, rate, b64) {
    if (!tx.ctx) return { ok: false, err: 'aucune sortie son vers le TRX choisie sur la page Station' };
    if (tx.ctx.state !== 'running') { tx.ctx.resume().catch(() => {}); return { ok: false, err: 'sortie son vers le TRX en pause sur la page Station (un clic sur la page au club la relance)' }; }
    const bin = atob(b64);
    const n = bin.length >> 1;
    if (!n || !(rate >= 3000 && rate <= 96000)) return { ok: false, err: 'signal vide ou invalide' };
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; s[i] = v / 32768; }
    tx.prep = { id, samples: s, rate };
    return { ok: true, text: '', seconds: n / rate };
  }
  function txPlay(id, atLocal, onEnd) {
    const ctx = tx.ctx;
    if (!tx.prep || tx.prep.id !== id || !ctx || ctx.state !== 'running') return false;
    const s = tx.prep.samples;
    const rate = tx.prep.rate || ctx.sampleRate;
    tx.prep = null;
    txStop();
    const buf = ctx.createBuffer(1, s.length, rate);
    buf.copyToChannel(s, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(tx.gain);
    // Heure de départ dans l'horloge audio, en tenant compte du retard de la sortie son
    const lat = ctx.outputLatency || ctx.baseLatency || 0;
    const when = Math.max(ctx.currentTime + 0.02, ctx.currentTime + (atLocal - Date.now()) / 1000 - lat);
    src.onended = () => { if (tx.src === src) { tx.src = null; alcStop(); drawTxOut(); onEnd(); } };
    src.start(when);
    tx.src = src;
    alcStart();
    drawTxOut();
    return true;
  }
  // ALC en émission numérique : au-delà de ALC_MAX %, le signal est déformé (harmoniques, signaux parasites).
  // Pendant l'émission, le niveau BF envoyé au TRX baisse tout seul tant que l'ALC dépasse ALC_MAX % ; le niveau
  // atteint est gardé pour les émissions suivantes. Il ne remonte jamais tout seul (ALC à 0 = réglage idéal).
  // Réglé par le serveur (config.json « digiAlcMax », par ex. 8) ; 0 = limiteur coupé.
  let ALC_MAX = 0;
  let alcTimer = null;
  let alcLast = 0;
  function alcStart() {
    alcStop();
    alcLast = Date.now();
    alcTimer = setInterval(() => {
      const r = core.radio;
      if (!ALC_MAX || !tx.src || !r || !r.tx || r.m4 == null || !tx.gain) return;
      const pct = (r.m4 / 255) * 100;
      if (pct <= ALC_MAX || Date.now() - alcLast < 700) return; // laisser la mesure suivre le réglage précédent
      alcLast = Date.now();
      const was = txLevel();
      // Baisse proportionnelle à l'excès (au moins 10 %, au plus de moitié), 1 % au minimum
      const k = Math.max(0.5, Math.min(0.9, Math.sqrt(ALC_MAX / pct)));
      const now = Math.max(1, Math.min(was - 1, Math.round(was * k)));
      if (now >= was) return;
      store.set('txlevel', String(now));
      tx.gain.gain.setTargetAtTime(now / 100, tx.ctx.currentTime, 0.05);
      drawTxOut();
      const text = 'ALC ' + Math.round(pct) + ' % en émission numérique (max ' + ALC_MAX + ' %) : niveau BF vers le TRX ramené de ' + was + ' à ' + now + ' %';
      log(text, 'st-warn');
      if (core.wsUp) core.sendWs({ t: 'trx_note', text });
    }, 250);
  }
  function alcStop() {
    if (alcTimer) clearInterval(alcTimer);
    alcTimer = null;
  }
  function txStop() {
    const src = tx.src;
    tx.src = null;
    alcStop();
    if (src) { src.onended = null; try { src.stop(); } catch (e) {} }
  }
  $('audOut').addEventListener('change', async () => {
    let o = $('audOut').selectedOptions[0];
    // Alias Windows (« Communications - … », « Par défaut - … ») : la carte son réelle qu'il désigne
    if (o && (o.value === 'default' || o.value === 'communications')) {
      const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
      const a = outs.find((d) => d.deviceId === o.value);
      const r = a && outs.find((d) => !isAlias(d) && d.groupId === a.groupId);
      if (r) { $('audOut').value = r.deviceId; log('Sortie son : « ' + a.label + ' » est un alias de Windows, remplacé par « ' + r.label + ' »'); o = $('audOut').selectedOptions[0]; }
    }
    store.set('audio.outLabel', o && o.value ? unAlias(o.textContent) : '');
    startTxOut();
  });
  $('audTxLvl').addEventListener('input', () => {
    store.set('txlevel', $('audTxLvl').value);
    if (tx.gain) tx.gain.gain.value = txLevel() / 100;
    drawTxOut();
  });
  document.addEventListener('click', () => { if (tx.ctx && tx.ctx.state === 'suspended') tx.ctx.resume().then(drawTxOut); });
  if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', () => { if (!tx.src) listOutputs().catch(() => {}); });
  drawTxOut();

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
      return setTimeout(() => reloadPage(), 300);
    }
    log('Réglages enregistrés');
    lastDrop = { how: 'bouton Enregistrer et reconnecter', at: Date.now() };
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

  // Garde-fou : quitter cette page (taper une autre adresse dans cet onglet, le fermer…) coupe la station.
  // Chrome demande alors confirmation. Les rechargements voulus par la page elle-même passent sans question.
  let leaving = false;
  function reloadPage() { leaving = true; location.reload(); }
  window.addEventListener('beforeunload', (e) => {
    if (leaving || (!port && !sim)) return;
    e.preventDefault();
    e.returnValue = 'Quitter la page Station coupe la station : le dashboard n’aura plus le TRX.';
    return e.returnValue;
  });
  window.addEventListener('pagehide', () => core.stop());
  $('btnDash').addEventListener('click', () => window.open('/', 'rs-dashboard', 'width=1400,height=900'));

  // ------------------------------------------------------------ démarrage
  // Une seule page Station par navigateur : un 2e onglet /station ne se connecte pas (il volerait la place du premier)
  log('Page Station chargée' + (window.RS_WORKER_TIMERS ? ' (fonctionne aussi en arrière-plan)' : ''));
  try {
    localStorage.setItem('rs.st.test', '1');
    localStorage.removeItem('rs.st.test');
  } catch (e) {
    log('Chrome n’enregistre pas les données de ce site : le jeton et le port seront oubliés à chaque fois (voir Paramètres → Confidentialité → Données des sites)', 'st-bad');
  }
  keepAwake();
  const start = () => { connectWs(); reopenRemembered(); };
  if (navigator.locks) {
    navigator.locks.request('remote-station-page', { ifAvailable: true }, (lock) => {
      if (lock) { start(); return new Promise(() => {}); } // verrou gardé tant que la page est ouverte
      $('tVps').textContent = 'Une autre page Station est déjà ouverte dans ce navigateur : celle-ci attend';
      log('Une autre page Station est déjà ouverte dans ce navigateur (autre onglet). Fermez celle en trop.', 'st-bad');
      navigator.locks.request('remote-station-page', () => {
        log('L’autre page Station a été fermée : celle-ci prend le relais');
        start();
        return new Promise(() => {});
      });
      return undefined;
    });
  } else {
    start();
  }
})();
