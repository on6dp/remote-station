/* Page Station : Web Serial (port CAT du TRX) + WebSocket (VPS) autour de StationCore */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  // Carte son mémorisée par modèle de TRX (deux TRX branchés au même PC ont chacun leur carte son USB)
  const PER_RIG = { 'audio.label': 1, 'audio.outLabel': 1, 'audio.usb': 1 };
  const skey = (k) => 'rs.st.' + k + (PER_RIG[k] && typeof MODEL === 'string' ? '.' + MODEL : '');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(skey(k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(skey(k), v); } catch (e) {} }
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
  // Ancienne mémoire de la carte son (commune à tous les TRX) : reprise pour le TRX en service à la mise à jour
  try {
    if (!localStorage.getItem('rs.st.audio.perRig')) {
      for (const k of Object.keys(PER_RIG)) { const v = localStorage.getItem('rs.st.' + k); if (v != null && store.get(k, null) == null) store.set(k, v); }
      localStorage.setItem('rs.st.audio.perRig', MODEL);
    }
  } catch (e) { /* stockage indisponible */ }
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
  // DX Commander : pas de port série (l'assistant Windows relaie vers Commander) ; port TCP et puissance déclarée
  const DXC = RIG.TRANSPORT === 'dxc';
  if (DXC) {
    $('btnPort').textContent = 'Se connecter à DX Commander';
    $('btnClose').textContent = 'Fermer la liaison';
    for (const id of ['cfgBaudL', 'cfgStopL']) { const el = $(id); if (el) el.hidden = true; }
    for (const id of ['cfgDxcPortL', 'cfgDxcWattsL']) { const el = $(id); if (el) el.hidden = false; }
    $('cfgDxcPort').value = store.get('dxc.port', '52002');
    $('cfgDxcWatts').value = store.get('dxc.watts', '100');
    const cwRow = $('cwPortRow'); if (cwRow) cwRow.style.display = 'none'; // pas de manipulation CW par Commander
    RIG.setWatts(Number(store.get('dxc.watts', '100')));
  }
  // ------------------------------------------------------------ DX Commander (par l'assistant Windows du club)
  // Messages de Commander envoyés par paquets à http://127.0.0.1:18099/dxc ; ses réponses reviennent au pilote ligne par
  // ligne. Jamais de réglage perdu : seules de vieilles lectures sont oubliées si Commander prend du retard.
  const dxc = { q: [], busy: false, fails: 0 };
  const isQuery = (l) => /^<command:\d+>Cmd(Get|Send)/.test(l);
  function dxcWrite(s) {
    if (typeof s !== 'string') return;
    for (const l of s.split('\n')) if (l) dxc.q.push(l);
    while (dxc.q.length > 40) { const i = dxc.q.findIndex(isQuery); if (i < 0) break; dxc.q.splice(i, 1); }
    dxcPump();
  }
  async function dxcPump() {
    if (dxc.busy || !dxc.q.length || !port || !port.dxc) return;
    dxc.busy = true;
    const batch = dxc.q.splice(0, 8);
    try {
      const r = await fetch(HELPER + '/dxc', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: batch.join('\n'), cache: 'no-store' });
      const j = await r.json();
      if (!j || !j.ok) throw new Error((j && j.msg) || 'réponse inattendue de l’assistant');
      dxc.fails = 0;
      const rep = (j.r || []).filter((x) => typeof x === 'string' && x);
      if (rep.length && port && port.dxc) core.onSerialData(enc.encode(rep.join('\n') + '\n'));
    } catch (e) {
      dxc.fails++;
      if (dxc.fails === 1 || dxc.fails % 20 === 0) log('DX Commander : ' + e.message, 'st-warn');
      // Retour en réception jamais perdu : renvoyé
      const rx = batch.filter((l) => /CmdRX/.test(l));
      if (rx.length) dxc.q.unshift(...rx);
      if (dxc.fails >= 10) {
        log('DX Commander ne répond plus : liaison fermée, nouvel essai dans 10 s', 'st-bad');
        dxc.busy = false;
        await closePort(false);
        return;
      }
      await new Promise((res) => setTimeout(res, 300));
    }
    dxc.busy = false;
    if (dxc.q.length) setTimeout(dxcPump, 0);
  }
  async function dxcConnect(manual) {
    const p = Math.round(Number(store.get('dxc.port', '52002'))) || 52002;
    let j = null;
    try {
      const r = await fetch(HELPER + '/dxc/hello?port=' + p, { cache: 'no-store' });
      j = await r.json();
    } catch (e) {
      log('DX Commander : assistant Windows du club injoignable (http://127.0.0.1:18099) — installé et lancé ? (version 7 ou plus)', 'st-bad');
      return false;
    }
    if (!j || j.msg === 'inconnu' || Number(j.version) < 7) {
      log('DX Commander : il faut l’assistant Windows du club version 7 (celui-ci : ' + ((j && j.version) || '?') + ') — retéléchargez-le et refaites installer-carte-son.cmd', 'st-bad');
      return false;
    }
    if (!j.ok) {
      // Essais automatiques toutes les 10 s : même message une seule fois
      if (manual || dxc.why !== j.msg) log('DX Commander : ' + (j.msg || 'ne répond pas'), manual ? 'st-bad' : 'st-warn');
      dxc.why = j.msg;
      return false;
    }
    dxc.why = '';
    // Séparateur décimal attendu par Commander (celui de la session Windows où il tourne) : lu sur CmdSendFreq, qui écrit
    // la fréquence à la façon de Windows (« 14 074,000 » ou « 14,074.000 ») ; sinon celui de l'assistant
    let dec = j.dec;
    try {
      const r2 = await fetch(HELPER + '/dxc', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '<command:11>CmdSendFreq<parameters:0>', cache: 'no-store' });
      const j2 = await r2.json();
      const m = j2 && j2.ok && /^<CmdFreq:\d+>(.*)$/.exec(String((j2.r || [])[0] || ''));
      const d = m && /\d([.,])\d{3}\s*$/.exec(m[1]);
      if (d) dec = d[1];
    } catch (e) { /* lu plus tard */ }
    RIG.setDecimal(dec);
    j.dec = dec;
    port = { dxc: true };
    dxc.q = []; dxc.fails = 0; dxc.busy = false;
    core.serialOpened();
    log('Liaison avec DX Commander ouverte (port ' + p + ', séparateur décimal « ' + (j.dec || '.') + ' »)');
    return true;
  }

  // Manipulation CW par la ligne DTR du 2e port USB du TRX (FTX-1 : « Standard COM Port ») : ouvert à côté du port CAT
  let cwPort = null;
  const CWPORT_KEY = 'cwport.' + MODEL;
  const keyer = {
    available: () => !!cwPort,
    set: (on) => (cwPort ? cwPort.setSignals({ dataTerminalReady: !!on, requestToSend: false }).catch((e) => log('Manipulation DTR : ' + e.message, 'st-bad')) : Promise.resolve())
  };
  const core = new StationCore({
    rig: RIG,
    keyer,
    txAudio: { prepare: (...a) => txPrepare(...a), prepareSamples: (...a) => txPrepareSamples(...a), play: (...a) => txPlay(...a), stop: () => txStop(), retune: (...a) => txRetune(...a), late: () => tx.lastLate,
      voiceReady: () => voiceReady(), voiceStart: () => voiceStart(), voiceStop: () => voiceStop() },
    writeSerial(s) {
      if (sim) return sim.write(s);
      if (port && port.dxc) return dxcWrite(s);
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
    ws.onopen = () => ws.send(JSON.stringify({ t: 'station', token, model: MODEL, ports: rememberedPorts(), page: PAGE_ID, caps: ['ftsplit', 'autoreload', 'txsel', 'catq', 'ftxtx', 'audiotx', 'audioreset', 'cwtx', 'cwprep', 'cwkey', 'voicetx', 'exrw', 'rfscope', 'timesync', 'ftxdx', 'ftxdx2', 'vbuf', 'ftxmulti'] }));
    ws.binaryType = 'arraybuffer';
    lastServerMsg = Date.now();
    ws.onmessage = (e) => {
      lastServerMsg = Date.now();
      // Binaire : voix de l'opérateur (phonie à distance), jouée vers l'entrée USB du TRX
      if (typeof e.data !== 'string') { voiceFrame(new Uint8Array(e.data)); return; }
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
        txOutSent = ''; sendTxOut();
        try { ws.send(JSON.stringify({ t: 'ping', ts: Date.now() })); } catch (e) {} // première mesure de l'horloge
      } else if (m.t === 'tx_set') {
        // Administrateur (page FT) : limite d'ALC et niveau BF vers le TRX
        if (Number.isFinite(m.alcMax)) { ALC_MAX = m.alcMax > 0 ? m.alcMax : 0; log('Limite d’ALC en émission numérique : ' + (ALC_MAX ? ALC_MAX + ' %' : 'sans limite') + ' (administrateur)'); }
        if (Number.isFinite(m.level) && m.level >= 1 && m.level <= 100) {
          store.set('txlevel', String(m.level));
          if (tx.gain && tx.ctx) tx.gain.gain.setTargetAtTime(txLevel() / 100, tx.ctx.currentTime, 0.05);
          log('Niveau d’émission : ' + m.level + ' % (administrateur)');
        }
        drawTxOut();
      } else if (m.t === 'pong') {
        onPong(m);
      } else if (m.t === 'audio_want') {
        aud.want = !!m.on;
        drawAudio();
      } else if (m.t === 'switch') {
        switchModel(m.model, m.by);
      } else if (m.t === 'audio_reset') {
        audioReset(m.by || '?');
      } else if (m.t === 'time_sync') {
        timeSync(m.by || '?');
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
      return false;
    }
    // RTS/DTR au repos : évite toute émission accidentelle si RPTT SELECT est configuré
    try { await p.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch (e) {}
    port = p;
    writer = p.writable.getWriter();
    reader = p.readable.getReader();
    core.serialOpened();
    const info = p.getInfo ? p.getInfo() : {};
    log('Port ouvert à ' + baudRate + ' bps, ' + stopBits + ' bit(s) de stop' + (info.usbVendorId ? ' (USB ' + info.usbVendorId.toString(16) + ':' + (info.usbProductId || 0).toString(16) + ')' : ' (port virtuel : VSPE, com0com… — même vitesse à régler dans le partage du port)'));
    readLoop();
    return true;
  }

  async function readLoop() {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) { if (idTap) idTap.feed(value); core.onSerialData(value); } // octets bruts : le pilote les découpe (texte Yaesu ou trames CI-V)
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
    if (p.dxc) { dxc.q = []; if (manual) log('Liaison avec DX Commander fermée'); return; }
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
  // Ports virtuels (VSPE, com0com… pour partager le port CAT avec d'autres logiciels) : Chrome n'en donne ni le nom
  // (COM16) ni d'identité USB, et leur ordre dans sa liste peut changer. Le port mémorisé est donc vérifié à la
  // réouverture : on essaie les ports virtuels autorisés (le mémorisé d'abord) et on garde celui où CE TRX répond
  // (Icom : son adresse CI-V ; Yaesu : la même réponse à « ID; » que lors du choix du port).
  const isVirt = (p) => { const i = (p && p.getInfo && p.getInfo()) || {}; return !i.usbVendorId && !i.usbProductId; };
  const YAESU_ID = (RIG.CAT_QUERIES || []).indexOf('ID;') >= 0;
  let idTap = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function waitId(ms) {
    return new Promise((resolve) => {
      let buf = '';
      const t = setTimeout(() => { idTap = null; resolve(''); }, ms);
      idTap = { feed: (v) => {
        for (const b of v) buf += String.fromCharCode(b);
        const m = buf.match(/ID(\d{3,4});/);
        if (m) { clearTimeout(t); idTap = null; resolve(m[1]); } else if (buf.length > 4000) buf = buf.slice(-200);
      } };
    });
  }
  // Port virtuel choisi à la main : réponse à « ID; » retenue (Yaesu) pour le reconnaître ensuite
  async function learnId() {
    if (!YAESU_ID || !port || !isVirt(port)) return;
    await sleep(1500);
    if (!port || !core.radio.connected) return;
    const w = waitId(3000);
    core._write('ID;', true);
    const id = await w;
    if (id) { store.set(PORT_KEY + '.idr', id); log('Port virtuel : ' + RIG.NAME + ' reconnu (ID ' + id + ')'); }
  }
  async function probeVirtual(ports, first) {
    const virt = ports.filter(isVirt);
    const order = [first].concat(virt.filter((q) => q !== first)).filter(Boolean);
    const want = YAESU_ID ? store.get(PORT_KEY + '.idr', '') : '';
    for (const q of order) {
      if (!(await openPort(q))) continue;
      const t0 = Date.now();
      while (Date.now() - t0 < 3500 && port === q && !core.radio.connected) await sleep(150);
      let id = '';
      if (want && port === q && core.radio.connected) { const w = waitId(2500); core._write('ID;', true); id = await w; }
      if (port === q && core.radio.connected && (!want || id === want)) {
        rememberPort(q, ports);
        if (q !== first) log('Port virtuel du ' + RIG.NAME + ' retrouvé (le ' + (virt.indexOf(q) + 1) + 'e des ports virtuels autorisés)');
        return true;
      }
      log('Port virtuel ' + (virt.indexOf(q) + 1) + ' de ' + virt.length + ' : ' + (core.radio.connected ? 'un autre TRX y répond (ID ' + (id || '?') + ')' : 'le ' + RIG.NAME + ' n’y répond pas') + ' — essai du suivant', 'st-warn');
      await closePort(false);
      await sleep(300);
    }
    return false;
  }
  async function reopenRemembered() {
    if (DXC) { if (Number(store.get(PORT_KEY, '-1')) >= 0) await dxcConnect(); else log('DX Commander : cliquez sur « Se connecter à DX Commander »'); return; }
    if (!('serial' in navigator)) return;
    const ports = await navigator.serial.getPorts();
    const idx = Number(store.get(PORT_KEY, '-1'));
    const rp = findRemembered(ports);
    if (rp && isVirt(rp) && ports.filter(isVirt).length > 1) {
      log('Réouverture du port virtuel mémorisé pour ' + RIG.NAME + ' (vérifié : c’est bien lui qui répond ?)');
      if (!(await probeVirtual(ports, rp))) log('Aucun des ports virtuels autorisés ne répond comme le ' + RIG.NAME + ' : partage du port (VSPE) démarré ? vitesse ? sinon « Choisir le port du TRX »', 'st-bad');
    } else if (rp) {
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
    if (sim || recycling || (!DXC && !('serial' in navigator))) return;
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
    if (DXC) {
      stopSim();
      await closePort(false);
      store.set(PORT_KEY, '0');
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ports', ports: rememberedPorts() }));
      await dxcConnect(true);
      return;
    }
    if (!('serial' in navigator)) return;
    stopSim();
    try {
      const p = await navigator.serial.requestPort();
      await closePort(false);
      const ports = await navigator.serial.getPorts();
      rememberPort(p, ports);
      store.set(PORT_KEY + '.idr', '');
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ports', ports: rememberedPorts() }));
      if (await openPort(p)) learnId();
    } catch (e) {
      if (e.name !== 'NotFoundError') log('Choix du port : ' + e.message, 'st-bad');
    }
  });
  $('btnClose').addEventListener('click', () => { stopSim(); store.set(PORT_KEY, '-1'); closePort(true); });

  // ---------- port de manipulation CW (DTR)
  function drawCwPort() {
    const can = !!(RIG.CW && RIG.CW.dtr) && 'serial' in navigator;
    $('cwPortRow').hidden = !can;
    $('btnCwPortOff').hidden = !cwPort && !store.get(CWPORT_KEY, '');
    $('tCwPort').textContent = cwPort ? 'CW manipulée par DTR (port ouvert)' : store.get(CWPORT_KEY, '') ? 'Port de manipulation CW mémorisé, pas encore ouvert'
      : 'CW par la mémoire du manipulateur du TRX (sans port DTR)';
  }
  async function openCwPort(p) {
    if (p === port) { log('Port de manipulation CW : c’est le port CAT ; choisissez l’autre port du TRX (FTX-1 : Standard COM Port)', 'st-bad'); return false; }
    try {
      await p.open({ baudRate: 9600 });
      await p.setSignals({ dataTerminalReady: false, requestToSend: false });
      cwPort = p;
      log('Port de manipulation CW ouvert (DTR relâché)');
    } catch (e) {
      log('Port de manipulation CW : ' + e.message, 'st-bad');
      cwPort = null;
    }
    drawCwPort();
    return !!cwPort;
  }
  async function closeCwPort() {
    const p = cwPort;
    cwPort = null;
    if (p) { try { await p.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch (e) {} try { await p.close(); } catch (e) {} }
    drawCwPort();
  }
  async function reopenCwPort() {
    if (cwPort || !('serial' in navigator) || !(RIG.CW && RIG.CW.dtr)) return;
    let id = null;
    try { id = JSON.parse(store.get(CWPORT_KEY, 'null')); } catch (e) { id = null; }
    if (!id) return;
    const ports = await navigator.serial.getPorts();
    const same = ports.filter((q) => { const j = (q.getInfo && q.getInfo()) || {}; return j.usbVendorId === id.v && j.usbProductId === id.p; });
    const p = same[id.n];
    if (p && p !== port) await openCwPort(p);
  }
  $('btnCwPort').addEventListener('click', async () => {
    try {
      const p = await navigator.serial.requestPort();
      const ports = await navigator.serial.getPorts();
      if (p === port) return log('C’est le port CAT : choisissez l’autre port du TRX (FTX-1 : Standard COM Port)', 'st-bad');
      await closeCwPort();
      store.set(CWPORT_KEY, JSON.stringify(portIdent(p, ports)));
      await openCwPort(p);
    } catch (e) {
      if (e.name !== 'NotFoundError') log('Port de manipulation CW : ' + e.message, 'st-bad');
    }
  });
  $('btnCwPortOff').addEventListener('click', async () => { store.set(CWPORT_KEY, ''); await closeCwPort(); log('CW : manipulation par DTR abandonnée (mémoire du manipulateur du TRX)'); });
  drawCwPort();
  setTimeout(() => reopenCwPort().catch(() => {}), 2500);
  setInterval(() => { if (!cwPort) reopenCwPort().catch(() => {}); }, 15000);
  if ('serial' in navigator) navigator.serial.addEventListener('disconnect', (e) => { if (cwPort && e.target === cwPort) { cwPort = null; drawCwPort(); } });

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
  const aud = { ctx: null, stream: null, want: false, sent: 0, peak: 0, hf: 0, quietSince: 0, silent: false, resetting: false };
  // Phonie à distance (voix des membres, mémoires vocales) : lecteur continu dans la carte son vers le TRX. La voix arrive
  // par trames de 20 ms (12 kHz) ; elle est mise en file et lue sans interruption, rééchantillonnée en continu (pas de
  // raccord toutes les 20 ms). File d'attente : 0,15 s au départ ; si le son arrive par à-coups (liaison internet,
  // serveur occupé), la lecture s'arrête le temps de remplir de nouveau la file, qui grandit de 0,1 s (0,6 s au plus) :
  // un seul trou au lieu d'une voix hachée. Trop d'avance (plus de 0,9 s au-delà de la file) : le plus ancien est jeté.
  const VOICE_WORKLET = `
    class RsVoice extends AudioWorkletProcessor {
      constructor() {
        super();
        this.cap = 12000 * 4; this.q = new Float32Array(this.cap); this.r = 0; this.w = 0; this.n = 0;
        this.step = 12000 / sampleRate; this.pos = 0; this.last = 0;
        this.play = false; this.started = false; this.tgt = 0.15; this.under = 0; this.late = 0; this.frames = 0; this.maxTgt = 0.15;
        this.pend = false; this.fade = 1; // pend : file vidée, compté comme trou seulement si la voix continue (sinon c'est la fin)
        this.port.onmessage = (e) => {
          const m = e.data;
          if (m && m.s) this.push(m.s);
          else if (m && m.t === 'stats') this.port.postMessage({ frames: this.frames, under: this.under, late: this.late, tgt: this.maxTgt });
        };
      }
      push(s) {
        this.frames++;
        if (this.pend) { this.pend = false; this.under++; this.tgt = Math.min(0.6, this.tgt + 0.1); this.maxTgt = Math.max(this.maxTgt, this.tgt); }
        for (let i = 0; i < s.length; i++) {
          if (this.n >= this.cap) { this.r = (this.r + 1) % this.cap; this.n--; }
          this.q[this.w] = s[i]; this.w = (this.w + 1) % this.cap; this.n++;
        }
        if (this.play && this.n > (this.tgt + 0.9) * 12000) {
          const drop = this.n - Math.round(this.tgt * 12000);
          this.r = (this.r + drop) % this.cap; this.n -= drop; this.late++;
        }
      }
      process(inputs, outputs) {
        const out = outputs[0][0];
        if (!out) return true;
        let i = 0;
        if (!this.play) {
          if (this.n >= this.tgt * 12000) { this.play = true; this.fade = this.started ? 0 : 1; } // reprise en fondu (pas de clic)
          else { for (; i < out.length; i++) { this.last *= 0.97; out[i] = this.last; } return true; }
        }
        for (; i < out.length; i++) {
          if (this.n < 2) {
            // File vide : on attend de la remplir de nouveau (une file plus grande si ce n'est pas le début)
            this.play = false;
            if (this.started) this.pend = true;
            for (; i < out.length; i++) { this.last *= 0.97; out[i] = this.last; }
            break;
          }
          const a = this.q[this.r], b = this.q[(this.r + 1) % this.cap];
          if (this.fade < 1) this.fade = Math.min(1, this.fade + 1 / 240);
          const v = (a + (b - a) * this.pos) * this.fade;
          out[i] = v; this.last = v; this.started = true;
          this.pos += this.step;
          while (this.pos >= 1) { this.pos -= 1; this.r = (this.r + 1) % this.cap; this.n--; }
        }
        return true;
      }
    }
    registerProcessor('rs-voice', RsVoice);`;
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

  // ------------------------------------------------------------ carte son figée : alerte et relance
  // Entrée muette (rien que du ronflement) pendant 45 s alors que le TRX est connecté : alerte ici et sur le dashboard
  const SILENT_HF = 0.0015, SILENT_S = 45;
  function silentTick() {
    const now = Date.now();
    const live = !!aud.ctx && aud.ctx.state === 'running' && !aud.resetting;
    if (!live || aud.hf > SILENT_HF) aud.quietSince = 0;
    else if (!aud.quietSince) aud.quietSince = now;
    aud.hf = 0;
    const silent = !!aud.quietSince && now - aud.quietSince > SILENT_S * 1000 && !!(core.radio && core.radio.connected);
    if (silent !== aud.silent) {
      aud.silent = silent;
      if (silent) log('Entrée son muette depuis ' + SILENT_S + ' s (TRX connecté) : carte son du TRX figée ? « Relancer la carte son du TRX », sinon éteindre et rallumer le TRX', 'st-warn');
      // Relance automatique par l'assistant (s'il est là), jamais en émission, une fois toutes les 10 min au plus
      if (silent && !core.catKeyed && !(core.radio && core.radio.tx) && Date.now() - (aud.autoAt || 0) > 600000) {
        aud.autoAt = Date.now();
        helperCheck().then((ok) => { if (ok && aud.silent && !aud.resetting) audioReset('relance automatique (entrée son muette ' + SILENT_S + ' s)'); });
      }
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'audio_silent', on: silent }));
    }
    const t = $('tSilent');
    if (aud.waitTrx) return;
    t.hidden = !silent;
    t.textContent = silent ? '⚠ Entrée son muette alors que le TRX est connecté : la carte son du TRX s’est sans doute figée. Cliquez sur « Relancer la carte son du TRX » (sinon : éteindre et rallumer le TRX).' : '';
  }
  setInterval(silentTick, 5000);

  // Assistant Windows (rs-carte-son.ps1, http://127.0.0.1:18099) : seul capable de redémarrer un périphérique
  const HELPER = 'http://127.0.0.1:18099';
  let helperOk = null;
  async function helperFetch(path, opts, ms) {
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), ms || 4000);
    try {
      const r = await fetch(HELPER + path, Object.assign({ signal: ac.signal, cache: 'no-store' }, opts || {}));
      return await r.json();
    } finally { clearTimeout(tm); }
  }
  async function helperCheck() {
    let r = null;
    try { r = await helperFetch('/etat'); helperOk = !!(r && r.ok); } catch (e) { helperOk = false; }
    const v2 = helperOk && Number(r.version) >= 3;
    const hr = helperOk && r.heure && r.heure.ecart != null ? ' — heure du PC (NTP) : écart ' + r.heure.ecart + ' ms (' + r.heure.quand + ')' : '';
    if (helperOk && v2) {
      // L'assistant surveille lui-même la carte son du TRX (même page fermée) : on lui donne son identifiant USB
      audioUsbId().then((id) => {
        if (id && r.surveille !== id.vid + ':' + id.pid) {
          helperFetch('/surveiller', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vid: id.vid, pid: id.pid }) }).catch(() => {});
        }
      }).catch(() => {});
    }
    const carte = { ok: 'en bon état', erreur: 'EN ERREUR', 'son absent': 'partie son absente', absente: 'débranchée ou TRX éteint' }[r && r.carte] || '';
    $('tHelper').textContent = helperOk ? 'Assistant carte son : en marche (version ' + r.version + ' ; relance d’ici ou depuis le dashboard, seule après 45 s de silence' +
      (v2 ? ' ; surveille la carte son et la répare seule si Windows la met en erreur)' : ')') +
      (v2 ? ' — veille USB : ' + (r.veille || '?') + (carte ? ' — carte son du TRX : ' + carte : '') + (r.reparation ? ' — dernière réparation : ' + r.reparation : '') + hr +
        (DXC && Number(r.version) < 7 ? ' — version 7 NÉCESSAIRE pour DX Commander (relais vers Commander) : retélécharger l’assistant et refaire installer-carte-son.cmd'
          : Number(r.version) < 6 ? ' — version 6 disponible (mise à l’heure de Windows directe comme NetTime, toutes les 15 min ; priorité basse) : retélécharger l’assistant et refaire installer-carte-son.cmd' : '')
        : ' — version 3 disponible (répare seule la carte son mise en erreur par Windows, coupe la veille USB) : retélécharger l’assistant et refaire installer-carte-son.cmd')
      : 'Assistant carte son : non installé sur ce PC (fichier installer-carte-son.cmd, voir l’aide) — pour relancer la carte son, éteindre et rallumer le TRX';
    $('btnAudReset').disabled = !helperOk || aud.resetting;
    $('helperDl').hidden = helperOk && Number(r.version) >= (DXC ? 7 : 6);
    return helperOk;
  }
  setTimeout(helperCheck, 1500);
  setInterval(helperCheck, 60000);
  // Identifiant USB de la carte son du TRX : Chrome l'ajoute au nom sous Windows, ex. « Microphone (USB Audio Device) (0d8c:0016) »
  async function audioUsbId() {
    const re = /\(([0-9a-f]{4}):([0-9a-f]{4})\)\s*$/i;
    const devs = await navigator.mediaDevices.enumerateDevices();
    const inDev = devs.find((d) => d.kind === 'audioinput' && d.deviceId === $('audDev').value);
    const cands = [inDev, devs.find((d) => d.kind === 'audiooutput' && d.deviceId === $('audOut').value)]
      .concat(inDev ? devs.filter((d) => d.groupId === inDev.groupId) : []);
    for (const d of cands) { const m = d && re.exec(d.label); if (m) return { vid: m[1].toLowerCase(), pid: m[2].toLowerCase() }; }
    const saved = store.get('audio.usb', '');
    return /^[0-9a-f]{4}:[0-9a-f]{4}$/.test(saved) ? { vid: saved.slice(0, 4), pid: saved.slice(5) } : null;
  }
  // Mise à l'heure de Windows par l'assistant (version 4, comme NetTime), demandée depuis l'onglet Synchro
  async function timeSync(by) {
    const done = (ok, msg) => {
      log('Heure du PC : ' + msg, ok ? '' : 'st-bad');
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'time_sync_result', ok, msg: String(msg).slice(0, 300) }));
    };
    log('Mise à l’heure du PC demandée par ' + by);
    try {
      const ok = await helperCheck();
      if (!ok) return done(false, 'assistant carte son non installé sur le PC du club (il fait aussi la mise à l’heure, version 4)');
      const r = await helperFetch('/heure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 40000);
      if (!r || r.ok == null) return done(false, 'assistant trop ancien : installer la version 4 (installer-carte-son.cmd)');
      done(!!r.ok, r.msg || '?');
      // Nouvelle mesure de l'écart avec le VPS tout de suite
      clk.best = Infinity;
      try { ws.send(JSON.stringify({ t: 'ping', ts: Date.now() })); } catch (e) {}
    } catch (e) { done(false, e.message); }
  }
  function resetResult(ok, msg) {
    log('Carte son du TRX : ' + msg, ok ? '' : 'st-bad');
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'audio_reset_result', ok, msg: String(msg).slice(0, 300) }));
  }
  async function audioReset(by) {
    if (aud.resetting) return;
    if (core.catKeyed || (core.radio && core.radio.tx)) return resetResult(false, 'relance refusée pendant une émission');
    if (!(await helperCheck())) return resetResult(false, 'assistant carte son absent sur le PC du club (installer-carte-son.cmd) : éteindre et rallumer le TRX');
    const id = await audioUsbId();
    if (!id) return resetResult(false, 'identifiant USB de la carte son inconnu (choisissez l’entrée son du TRX)');
    store.set('audio.usb', id.vid + ':' + id.pid);
    const wasOn = !!aud.ctx;
    aud.resetting = true;
    $('btnAudReset').disabled = true;
    log('Relance de la carte son du TRX (' + id.vid + ':' + id.pid + ') demandée par ' + by, 'st-warn');
    // La carte son doit être libérée avant d'être redémarrée (entrée et sortie)
    stopAudio(false);
    stopTxOut();
    let r;
    try { r = await helperFetch('/relancer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vid: id.vid, pid: id.pid, by }) }, 30000); }
    catch (e) { r = { ok: false, msg: 'pas de réponse de l’assistant (' + (e.name === 'AbortError' ? 'délai dépassé' : e.message) + ')' }; }
    // Windows remet la carte son en place en quelques secondes : on réessaie jusqu'à la retrouver
    let back = false;
    for (let i = 0; i < 12 && !back; i++) {
      await new Promise((ok) => setTimeout(ok, 2500));
      try {
        await listInputs();
        const o = $('audDev').selectedOptions[0];
        back = !!(o && o.value && unAlias(o.textContent) === unAlias(store.get('audio.label', '')));
      } catch (e) { /* carte son pas encore revenue */ }
    }
    aud.resetting = false;
    aud.quietSince = 0;
    if (wasOn || store.get('audio.on', '0') === '1') await startAudio();
    listOutputs().then(() => startTxOut()).catch(() => {});
    helperCheck();
    resetResult(!!(r && r.ok) && back, (r && r.msg ? r.msg : 'échec') + (back ? ' ; audio relancé' : ' ; la carte son n’est pas revenue dans Chrome'));
  }
  $('btnAudReset').addEventListener('click', () => {
    if (!confirm('Redémarrer la carte son USB du TRX ?\nLe son est coupé quelques secondes, le TRX reste allumé.')) return;
    audioReset('page Station');
  });

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

  // Carte son du TRX mémorisée mais absente de Windows (figée, en erreur, câble débranché) : on ne prend JAMAIS une
  // autre carte à sa place (son du PC, « Mixage stéréo »…) ; on attend qu'elle revienne (l'assistant la répare)
  const PC_CARD = /realtek|intel|nvidia|amd high|hdmi|display|mixage|stereo mix|webcam|camera/i;
  function trxCardMissing(devs) {
    const saved = unAlias(store.get('audio.label', ''));
    // Noms des entrées inconnus (autorisation du micro pas encore donnée) : pas de conclusion
    return !!saved && devs.length > 0 && !devs.some((d) => !isAlias(d) && d.label === saved) ? saved : '';
  }
  function waitTrxCard(saved) {
    if (!aud.waitTrx) {
      log('Carte son du TRX « ' + saved + ' » absente de Windows : audio en attente (aucune autre carte son n’est prise à sa place). ' +
        (helperOk ? 'L’assistant carte son la répare ; ' : '') + 'sinon : éteindre le TRX, débrancher et rebrancher son câble USB.', 'st-bad');
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'audio_silent', on: true }));
      // Réparation par l'assistant tout de suite (au plus une fois toutes les 10 min)
      if (Date.now() - (aud.autoAt || 0) > 600000) {
        aud.autoAt = Date.now();
        helperCheck().then((ok) => { if (ok && !aud.resetting) audioReset('relance automatique (carte son du TRX absente)'); });
      }
    }
    aud.waitTrx = saved;
    const t = $('tSilent');
    t.hidden = false;
    t.textContent = '⚠ Carte son du TRX « ' + saved + ' » absente de Windows : audio en attente de son retour (réparation par l’assistant carte son ; sinon éteindre le TRX et rebrancher son câble USB).';
    clearTimeout(aud.waitTm);
    aud.waitTm = setTimeout(() => { if (aud.waitTrx && !aud.ctx) startAudio(); }, 15000);
  }
  // Une seule capture à la fois : deux démarrages en même temps (relance, retour de la carte son, rechargement)
  // donnaient deux captures qui envoyaient leurs trames mélangées → raies verticales tous les 25 Hz sur la cascade
  function startAudio(manual) {
    if (aud.starting) return aud.starting;
    aud.starting = startAudioOnce(manual).finally(() => { aud.starting = null; });
    return aud.starting;
  }
  async function startAudioOnce(manual) {
    if (!navigator.mediaDevices || !window.AudioWorkletNode) return log('Audio impossible : navigateur trop ancien', 'st-bad');
    if (aud.ctx) return;
    try {
      if (!manual) {
        const miss = trxCardMissing((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.label));
        if (miss) return waitTrxCard(miss);
        await listInputs(); // la carte son mémorisée du TRX, pas la sélection du moment
      }
      if (aud.waitTrx) {
        log('Carte son du TRX revenue : audio relancé', 'st-ok');
        aud.waitTrx = '';
        clearTimeout(aud.waitTm);
        $('tSilent').hidden = true;
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'audio_silent', on: false }));
      }
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
      if (track && PC_CARD.test(track.label)) log('Attention : « ' + track.label + ' » est une carte son du PC, pas celle du TRX (« USB Audio CODEC » / « USB Audio Device »)', 'st-warn');
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
      const myCtx = aud.ctx;
      node.port.onmessage = (e) => {
        // Capture qui n'est plus la capture en service : arrêtée, rien n'est envoyé
        if (aud.ctx !== myCtx) { node.port.onmessage = null; myCtx.close().catch(() => {}); return; }
        const buf = e.data.l;
        const bufR = RIG.DUAL_AUDIO ? e.data.r : null;
        let p = 0;
        for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
        if (bufR) for (let i = 0; i < bufR.length; i++) { const a = Math.abs(bufR[i]); if (a > p) p = a; }
        aud.peak = Math.max(p, aud.peak * 0.85);
        // Carte son figée : il ne reste qu'un ronflement très grave. On mesure l'écart d'un échantillon au suivant,
        // presque nul pour un ronflement à 50 Hz, net pour le souffle de la bande
        let hf = 0;
        for (let i = 1; i < buf.length; i++) { const a = Math.abs(buf[i] - buf[i - 1]); if (a > hf) hf = a; }
        aud.hf = Math.max(aud.hf, hf);
        if (aud.want && ws && ws.readyState === 1 && ws.bufferedAmount < 65536) {
          ws.send(ULAW.encodePcm(buf));
          if (bufR) ws.send(ULAW.encodePcm(bufR, 0x04)); // voie droite : récepteur SUB (décodage RTTY B, écoute en double réception)
          aud.sent++;
        }
      };
      aud.ctx.onstatechange = drawAudio;
      store.set('audio.on', '1');
      log('Audio activé : ' + (track ? track.label : 'entrée par défaut'));
      // Identifiant USB retenu : il sert à réparer la carte son même quand elle a disparu de Windows
      audioUsbId().then((id) => { if (id && !PC_CARD.test(track ? track.label : '')) store.set('audio.usb', id.vid + ':' + id.pid); }).catch(() => {});
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

  $('btnAudio').addEventListener('click', () => (aud.ctx ? stopAudio(true) : startAudio(true)));
  $('audDev').addEventListener('change', () => {
    const o = $('audDev').selectedOptions[0];
    if (o) store.set('audio.label', unAlias(o.textContent));
    if (aud.ctx) { stopAudio(false); startAudio(true); }
  });
  // Chrome peut suspendre l'audio d'une page sans clic : le premier clic le relance
  document.addEventListener('click', () => { if (aud.ctx && aud.ctx.state === 'suspended') aud.ctx.resume().then(drawAudio); });
  setInterval(() => { $('audLvl').style.width = Math.min(100, Math.round(aud.peak * 100)) + '%'; aud.peak *= 0.9; }, 100);
  if (navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      listInputs($('audDev').value).catch(() => {}).then(() => {
        // Carte son du TRX revenue (réparée par l'assistant, câble rebranché) : l'audio repart seul
        if (aud.waitTrx && !aud.ctx && !aud.resetting) setTimeout(() => { if (aud.waitTrx && !aud.ctx) startAudio(); }, 1500);
      });
    });
    // Réactivation automatique si l'audio était en marche (l'autorisation du site est mémorisée par Chrome)
    if (store.get('audio.on', '0') === '1') listInputs().catch(() => {}).then(() => startAudio());
  }
  drawAudio();

  // ------------------------------------------------------------ horloge du VPS
  // L'émission FT8 / FT4 / FT2 part à l'heure du VPS (synchronisé par NTP) : l'horloge de Windows peut être
  // décalée de plusieurs secondes. Écart mesuré à chaque « pong » (aller-retour le plus court = mesure la plus fiable).
  const clk = { best: Infinity, at: 0, off: null, wall: null };
  // Saut de l'horloge de Windows (NetTime, assistant, service Windows Time) : Date.now() saute, pas performance.now().
  // L'écart avec le VPS est corrigé tout de suite du même saut, puis remesuré (avant : jusqu'à 2 min d'émissions
  // décalées du saut après chaque mise à l'heure).
  setInterval(() => {
    const w = Date.now() - performance.now();
    if (clk.wall == null) { clk.wall = w; return; }
    const jump = w - clk.wall;
    clk.wall = w;
    if (Math.abs(jump) < 25) return;
    // Plus d'une minute : sortie de veille plutôt qu'une mise à l'heure → seulement une nouvelle mesure
    if (clk.off != null && Math.abs(jump) < 60000) { clk.off = Math.round(clk.off - jump); core.setClock(clk.off); }
    clk.best = Infinity;
    log('Horloge de Windows ' + (jump > 0 ? 'avancée' : 'reculée') + ' de ' + Math.abs(Math.round(jump)) + ' ms : écart avec le VPS corrigé pour l’émission numérique');
    try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', ts: Date.now() })); } catch (e) {}
  }, 1000);
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
    // Écart de l'horloge de ce PC avec le VPS : affiché dans l'onglet Synchro du dashboard
    if (ws && ws.readyState === 1 && (clk.sent == null || Math.abs(off - clk.sent) >= 3 || t - clk.sentAt > 60000)) {
      clk.sent = off;
      clk.sentAt = t;
      ws.send(JSON.stringify({ t: 'clock', off, rtt }));
    }
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
      : 'Sortie vers le TRX : ' + tx.label + ' · limite d’ALC ' + (ALC_MAX ? ALC_MAX + ' %' : 'aucune') + (tx.src ? ' · émission en cours' : voice && voice.on ? ' · phonie à distance en cours' : '');
    sendTxOut();
  }
  // État de la sortie son vers le TRX, montré aux opérateurs sur la page FT8 / FT4 / FT2 (« Émission FT : … »)
  let txOutSent = '';
  function sendTxOut() {
    const o = { t: 'tx_out', ok: !!(tx.ctx && tx.ctx.state === 'running'), paused: !!(tx.ctx && tx.ctx.state !== 'running'), label: tx.ctx ? String(tx.label || '').slice(0, 80) : '', level: txLevel(), alcMax: ALC_MAX };
    const k = JSON.stringify(o);
    if (k === txOutSent || !ws || ws.readyState !== 1) return;
    txOutSent = k;
    ws.send(k);
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
      || (saved == null && inDev && inDev.groupId && !PC_CARD.test(inDev.label) ? real.find((d) => d.groupId === inDev.groupId) : null)
      || (saved == null ? real.find((d) => /usb audio|codec|yaesu|ftx|ftdx|ic-?7300|icom/i.test(d.label) && !PC_CARD.test(d.label)) : null);
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
      // Lecteur continu de la phonie à distance (sinon : ancienne lecture trame par trame)
      tx.voiceWk = false;
      try {
        const url = URL.createObjectURL(new Blob([VOICE_WORKLET], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        tx.voiceWk = tx.ctx === ctx;
      } catch (e) { log('Phonie à distance : lecteur continu indisponible (' + e.message + '), lecture trame par trame', 'st-warn'); }
      ctx.onstatechange = drawTxOut;
      log('Sortie son vers le TRX : ' + o.textContent);
      if (PC_CARD.test(o.textContent)) log('Attention : « ' + o.textContent + ' » est une carte son du PC : la modulation numérique n’ira pas dans le TRX', 'st-warn');
    } catch (e) {
      log('Sortie son vers le TRX : ' + e.message, 'st-bad');
    }
    drawTxOut();
  }
  function txPrepare(id, mode, text, f0, extra) {
    if (!tx.enc) return { ok: false, err: 'codeur FT8 / FT4 / FT2 pas encore chargé sur la page Station' };
    if (!tx.ctx) return { ok: false, err: 'aucune sortie son vers le TRX choisie sur la page Station' };
    if (tx.ctx.state !== 'running') { tx.ctx.resume().catch(() => {}); return { ok: false, err: 'sortie son vers le TRX en pause sur la page Station (un clic sur la page au club la relance)' }; }
    const f = Number(f0);
    if (!(f >= 100 && f <= 3000)) return { ok: false, err: 'fréquence audio hors plage (100 à 3000 Hz)' };
    const r = tx.enc.encode(mode, text, tx.ctx.sampleRate, f);
    if (!r) return { ok: false, err: 'message impossible à coder en ' + mode + ' : « ' + String(text).slice(0, 40) + ' »' };
    // « 2 à la fois » (comme MSHV) : 2e message sur une autre fréquence audio, joué en même temps ; chaque signal à la
    // moitié de l'amplitude (même puissance crête qu'un seul signal)
    const xs = Array.isArray(extra) ? extra.slice(0, 1) : [];
    if (xs.length) {
      const mix = new Float32Array(r.samples.length);
      for (let i = 0; i < mix.length; i++) mix[i] = r.samples[i] * 0.5;
      const texts = [r.text];
      for (const e of xs) {
        const fe = Number(e.f0);
        const r2 = fe >= 100 && fe <= 3000 ? tx.enc.encode(mode, e.text, tx.ctx.sampleRate, fe) : null;
        if (!r2) return { ok: false, err: '2e message impossible à coder en ' + mode + ' : « ' + String(e.text).slice(0, 40) + ' »' };
        for (let i = 0; i < mix.length && i < r2.samples.length; i++) mix[i] += r2.samples[i] * 0.5;
        texts.push(r2.text);
      }
      tx.prep = { id, samples: mix, mode, text, f0: f, multi: true };
      return { ok: true, text: r.text, texts, seconds: r.seconds };
    }
    tx.prep = { id, samples: r.samples, mode, text, f0: f };
    return { ok: true, text: r.text, seconds: r.seconds };
  }
  // Nouvelle fréquence audio pendant l'émission FT8 / FT4 / FT2 (clic sur la cascade) : le signal est refait à la nouvelle
  // fréquence et repris au même instant du message, sans attendre la période suivante (comme WSJT-X)
  function txRetune(id, f0) {
    const c = tx.cur, ctx = tx.ctx;
    const f = Number(f0);
    if (!c || c.id !== id || !tx.src || !ctx || !tx.enc || !(f >= 100 && f <= 3000) || f === c.f0 || c.multi) return false; // deux signaux : à la période suivante
    const r = tx.enc.encode(c.mode, c.text, ctx.sampleRate, f);
    if (!r) return false;
    const t = ctx.currentTime + 0.01;
    const off = Math.max(0, t - c.when);
    if (off >= r.samples.length / ctx.sampleRate - 0.05) return false; // message presque fini
    const buf = ctx.createBuffer(1, r.samples.length, ctx.sampleRate);
    buf.copyToChannel(r.samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(tx.gain);
    const old = tx.src;
    src.onended = old.onended;
    old.onended = null;
    tx.src = src;
    src.start(Math.max(t, c.when), off);
    try { old.stop(t); } catch (e) { /* déjà fini */ }
    c.f0 = f;
    log('Fréquence d’émission changée pendant l’émission : ' + f + ' Hz (reprise à ' + off.toFixed(1).replace('.', ',') + ' s)');
    return true;
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
    const p = tx.prep;
    const s = p.samples;
    const rate = p.rate || ctx.sampleRate;
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
    // Retard réel du départ du signal sur l'heure demandée (ms) : TRX passé en émission trop tard, page occupée…
    tx.lastLate = Math.round((when - ctx.currentTime + lat) * 1000 + Date.now() - atLocal);
    const cur = tx.cur = { id, when, mode: p.mode, text: p.text, f0: p.f0, multi: !!p.multi };
    // Fin du signal dans l'horloge audio : la carte son a encore « lat » secondes de son à sortir vers le TRX. Le PTT
    // n'est relâché qu'après (plus 0,2 s de marge), sinon la fin du message RTTY / JTTY / SSTV était coupée
    src.onended = () => { if (tx.cur === cur) { tx.src = null; tx.cur = null; alcStop(); drawTxOut(); setTimeout(onEnd, Math.round(lat * 1000) + 200); } };
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
  var ALC_MAX = 0; // var : lu par sendTxOut() avant cette ligne
  let alcTimer = null;
  let alcLast = 0;
  function alcStart() {
    alcStop();
    alcLast = Date.now();
    alcTimer = setInterval(() => {
      const r = core.radio;
      if (!ALC_MAX || !tx.src || !r || !r.tx || r.m4 == null || !tx.gain) return;
      const pct = Math.min(100, (r.m4 / ((core.rig && core.rig.ALC_FULL) || 255)) * 100); // Icom : 0 à 120 = zone ALC
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
  // ------------------------------------------------------------ phonie à distance
  // Voix de l'opérateur (µ-law 12 kHz, trames de 20 ms) jouée sur la sortie son vers le TRX, seulement pendant une
  // émission en phonie (TRX en émission, source de modulation USB). Petite réserve (0,15 s) contre les à-coups du
  // réseau ; au-delà de 0,6 s de retard, on repart à zéro (on garde le direct plutôt que d'accumuler du retard).
  var voice = { on: false, gain: null, next: 0, frames: 0, late: 0, under: 0 }; // var : la liaison VPS peut s'ouvrir avant cette ligne
  const voiceLevel = () => Math.max(1, Math.min(100, Number(store.get('voicelevel', '50')) || 50));
  function voiceReady() { return !!(tx.ctx && tx.ctx.state === 'running'); }
  function voiceStart() {
    if (!tx.ctx) return;
    if (!voice.gain || voice.gain.context !== tx.ctx) {
      voice.gain = tx.ctx.createGain();
      voice.gain.connect(tx.ctx.destination);
    }
    voice.gain.gain.value = voiceLevel() / 100;
    voice.node = null;
    if (tx.voiceWk) {
      try { voice.node = new AudioWorkletNode(tx.ctx, 'rs-voice', { numberOfInputs: 0, outputChannelCount: [1] }); voice.node.connect(voice.gain); } catch (e) { voice.node = null; }
    }
    voice.on = true;
    voice.next = 0;
    voice.last = null;
    voice.frames = 0;
    voice.late = 0;
    voice.under = 0;
    drawTxOut();
  }
  function voiceStop() {
    if (!voice.on) return;
    voice.on = false;
    const node = voice.node, gain = voice.gain;
    voice.node = null;
    voice.gain = null;
    const done = (st) => {
      try { if (node) node.disconnect(); } catch (e) {}
      try { if (gain) gain.disconnect(); } catch (e) {} // coupe aussi la fin déjà prévue
      const fr = st ? st.frames : voice.frames, un = st ? st.under : voice.under, la = st ? st.late : voice.late;
      log('Phonie à distance : ' + fr + ' trames jouées' + (un ? ', ' + un + ' trou(s) réseau' : '') + (la ? ', ' + la + ' rattrapage(s) du retard' : '') + (st && st.tgt > 0.15 ? ', file portée à ' + st.tgt.toFixed(2) + ' s' : ''), un || la ? 'st-warn' : '');
      // Au serveur : l'opérateur sait si sa voix est arrivée par à-coups au club
      if (fr && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'voice_stats', frames: fr, under: un, late: la, tgt: st ? st.tgt : 0.15, wk: !!st }));
      drawTxOut();
    };
    if (!node) return done(null);
    let ok = false;
    node.port.onmessage = (e) => { if (!ok) { ok = true; done(e.data); } };
    node.port.postMessage({ t: 'stats' });
    setTimeout(() => { if (!ok) { ok = true; done(null); } }, 300);
  }
  function voiceFrame(u8) {
    if (!voice || !voice.on || !core.catKeyed || !tx.ctx || !voice.gain || u8[0] !== 0x05) return;
    const s = ULAW.decodeFrame(u8);
    if (!s || !s.length) return;
    if (voice.node) { voice.frames++; voice.node.port.postMessage({ s }, [s.buffer]); return; } // lecteur continu
    const ctx = tx.ctx;
    const now = ctx.currentTime;
    if (voice.next < now + 0.02) { if (voice.frames) voice.under++; voice.next = now + 0.15; voice.last = null; }
    else if (voice.next - now > 0.6) { voice.late++; voice.next = now + 0.15; voice.last = null; }
    // Rééchantillonnage 12 kHz → fréquence de la carte son ICI, en continu d'une trame à l'autre (dernier échantillon
    // gardé) : laissé au navigateur trame par trame (20 ms), chaque raccord fait un petit clic, 50 fois par seconde,
    // et la voix sort « robotique » sur l'air
    const R = ctx.sampleRate, ratio = R / 12000;
    const n = Math.max(1, Math.round(s.length * ratio));
    const out = new Float32Array(n);
    const prev = voice.last == null ? s[0] : voice.last;
    for (let i = 0; i < n; i++) {
      const p = i / ratio, j = Math.floor(p), f = p - j;
      const a0 = j === 0 ? prev : s[j - 1], a1 = s[Math.min(j, s.length - 1)];
      out[i] = a0 + (a1 - a0) * f;
    }
    voice.last = s[s.length - 1];
    const buf = ctx.createBuffer(1, n, R);
    buf.copyToChannel(out, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(voice.gain);
    src.start(voice.next);
    voice.next += n / R;
    voice.frames++;
  }
  function txStop() {
    const src = tx.src;
    tx.src = null;
    tx.cur = null;
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
  if ($('audVoiceLvl')) {
    $('audVoiceLvl').value = String(voiceLevel());
    $('audVoicePct').textContent = voiceLevel() + ' %';
    $('audVoiceLvl').addEventListener('input', () => {
      store.set('voicelevel', $('audVoiceLvl').value);
      $('audVoicePct').textContent = voiceLevel() + ' %';
      if (voice.gain) voice.gain.gain.value = voiceLevel() / 100;
    });
  }
  $('audTxLvl').addEventListener('input', () => {
    store.set('txlevel', $('audTxLvl').value);
    if (tx.gain) tx.gain.gain.value = txLevel() / 100;
    drawTxOut();
  });
  document.addEventListener('click', () => { if (tx.ctx && tx.ctx.state === 'suspended') tx.ctx.resume().then(drawTxOut); });
  if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', () => {
    if (tx.src) return;
    listOutputs().then((outs) => {
      if (tx.ctx && tx.label && !outs.some((d) => d.label === tx.label)) {
        // Sortie du TRX disparue : Chrome jouerait sur les haut-parleurs du PC → sortie fermée (émission numérique refusée)
        stopTxOut();
        log('Sortie son vers le TRX « ' + tx.label + ' » disparue : émission numérique impossible jusqu’à son retour', 'st-bad');
        drawTxOut();
      } else if (!tx.ctx) {
        const o = $('audOut').selectedOptions[0];
        if (o && o.value) startTxOut();
      }
    }).catch(() => {});
  });
  drawTxOut();

  // ------------------------------------------------------------ réglages
  $('cfgToken').value = getToken();
  // Vitesse et bits de stop mémorisés par modèle (FTX-1/FTDX10 : 38400 ; IC-7300 : 115200)
  $('cfgBaud').value = store.get('baud.' + MODEL, String(RIG.serial.baudRate));
  $('cfgStop').value = store.get('stop.' + MODEL, String(RIG.serial.stopBits));
  // Choix d'un autre modèle : appliqué tout de suite (la page se recharge avec le pilote de ce TRX)
  $('cfgModel').addEventListener('change', () => {
    if ($('cfgModel').value === MODEL) return;
    store.set('model', $('cfgModel').value);
    log('Modèle changé : ' + (window.RIGS[$('cfgModel').value] || {}).NAME + ', rechargement de la page');
    try { core.stop(); } catch (e) { /* */ }
    setTimeout(() => reloadPage(), 300);
  });
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
    if (DXC) {
      const tp = Math.round(Number($('cfgDxcPort').value));
      if (tp >= 1 && tp <= 65535) store.set('dxc.port', String(tp)); else log('Port TCP de DX Commander : 1 à 65535', 'st-bad');
      const w = Math.round(Number($('cfgDxcWatts').value));
      if (w >= 1 && w <= 2000) { store.set('dxc.watts', String(w)); RIG.setWatts(w); } else log('Puissance réglée sur le TRX : 1 à 2000 W', 'st-bad');
    }
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
  $('btnDash').addEventListener('click', () => window.open('/', 'rs-dashboard', (window.RSWINPOS ? RSWINPOS.feat('rs-dashboard', 1400, 900) : 'width=1400,height=900')));

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
  // Jeton repris du serveur (page ouverte par un administrateur connecté) : rien à recopier, même sur un autre PC
  const start = () => {
    fetch('/station/token', { credentials: 'same-origin', cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
      const tok = j && typeof j.token === 'string' ? j.token : '';
      if (tok && /^[A-Za-z0-9_-]{20,}$/.test(tok) && tok !== getToken()) {
        store.set('token', tok);
        hashToken = tok;
        if ($('cfgToken')) $('cfgToken').value = tok;
        log('Jeton de la station repris du serveur');
      }
      connectWs();
      reopenRemembered();
    });
  };
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
