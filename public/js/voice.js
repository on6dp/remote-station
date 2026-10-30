/*
 * voice.js — phonie à distance (dashboard).
 * Le micro de l'opérateur (navigateur) passe par un égaliseur réglable (coupe-bas, 3 bandes paramétriques, coupe-haut,
 * gain), puis part en µ-law 12 kHz (trames de 20 ms, en-tête 0x05) vers le serveur, seulement pendant l'appui sur PTT.
 * La page Station du club joue cette voix sur l'entrée USB du TRX, après avoir mis la source de modulation sur USB.
 * Le nom de l'entrée son est reconnu (micro-casque, micro USB, webcam, Bluetooth, micro du PC…) : réglages gardés sur
 * le serveur pour chaque membre et chaque micro, repris tout seuls au prochain branchement, sur n'importe quel PC.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const RATE = 12000;
  const FRAME = 240; // 20 ms
  const store = {
    get(k, d) { try { const v = localStorage.getItem('rs.vx.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rs.vx.' + k, String(v)); } catch (e) { /* stockage bloqué */ } }
  };

  // ------------------------------------------------------------ types de micro reconnus d'après le nom de l'entrée son
  // (le navigateur ne voit que ce nom : un micro branché sur la prise jack du PC apparaît comme la carte son du PC)
  const TYPES = [
    { id: 'bt', name: 'Micro Bluetooth', re: /bluetooth|hands-?free|mains libres|airpods|buds|wh-1000|wf-1000|headset \(bt|bose qc|soundcore/i,
      note: 'Bluetooth en mode micro = qualité téléphone (bande étroite, compression). Préférez un micro filaire ou USB si possible.', preset: 'bt' },
    { id: 'ham', name: 'Micro radioamateur (adaptateur USB)', re: /heil|\bpr-?\d{2,3}|yaesu|icom|kenwood|\bm-?1\b|md-?1\d0|md-?200|sm-?50|ssm-?\d/i,
      note: 'Micro radioamateur : courbe déjà taillée pour la SSB, égaliseur léger.', preset: 'neutre' },
    { id: 'studio', name: 'Micro USB de studio / podcast', re: /yeti|blue snowball|\brode\b|nt-usb|podmic|shure|mv7|mv5|at20\d\d|audio-technica|fifine|samson|q2u|elgato|wave:?\d|quadcast|tonor|maono|razer seiren|hyperx solocast|zoom|focusrite|scarlett|behringer|umc\d|motu|steinberg|presonus/i,
      note: 'Micro large bande : coupe-bas et coupe-haut serrés et un peu de présence pour une SSB qui porte.', preset: 'dx' },
    { id: 'headset', name: 'Micro-casque', re: /headset|casque|jabra|plantronics|\bpoly\b|logitech (h|g|zone)|g pro|hyperx|steelseries|arctis|razer|kraken|corsair|sennheiser|epos|beyerdynamic|\bsony\b|cloud/i,
      note: 'Micro-casque : le plus sûr (pas d’effet Larsen, voix proche).', preset: 'headset' },
    { id: 'webcam', name: 'Micro de webcam', re: /webcam|c9[0-9]{2}|c270|brio|camera|cam\b|kiyo|facecam|streamcam/i,
      note: 'Micro de webcam : loin de la bouche, il prend la pièce. Réduction de bruit conseillée.', preset: 'pc' },
    { id: 'usb', name: 'Adaptateur son USB', re: /usb audio|usb pnp|usb sound|c-media|cm108|cm119|generalplus|usb advanced audio|usb2\.0 device|codec/i,
      note: 'Adaptateur son USB : le micro branché derrière est inconnu, réglage neutre au départ.', preset: 'neutre' },
    { id: 'pc', name: 'Micro du PC (intégré ou prise jack)', re: /realtek|high definition audio|conexant|intel|smart sound|array|réseau de micro|microphone array|internal|intégré|idt|cirrus|sound blaster|built-?in|macbook/i,
      note: 'Micro du PC : souvent loin de la bouche et sensible au bruit du ventilateur. Un micro-casque fait beaucoup mieux.', preset: 'pc' }
  ];
  const PRESETS = {
    neutre: { name: 'Neutre', lo: 100, hi: 2900, gain: 100, bands: [{ f: 250, g: 0, q: 1 }, { f: 1100, g: 0, q: 1 }, { f: 2400, g: 0, q: 1 }] },
    dx: { name: 'DX (qui porte)', lo: 200, hi: 2800, gain: 100, bands: [{ f: 300, g: -3, q: 1 }, { f: 1200, g: 2, q: 1 }, { f: 2400, g: 5, q: 1.4 }] },
    ragchew: { name: 'Ragchew (chaud)', lo: 80, hi: 3000, gain: 100, bands: [{ f: 200, g: 3, q: 0.8 }, { f: 1000, g: 0, q: 1 }, { f: 2500, g: 2, q: 1 }] },
    headset: { name: 'Micro-casque', lo: 150, hi: 2900, gain: 100, bands: [{ f: 250, g: -2, q: 1 }, { f: 1200, g: 1, q: 1 }, { f: 2600, g: 4, q: 1.2 }] },
    pc: { name: 'Micro du PC', lo: 200, hi: 2800, gain: 120, ns: true, bands: [{ f: 300, g: -4, q: 0.9 }, { f: 1500, g: 2, q: 1 }, { f: 2700, g: 3, q: 1.2 }] },
    bt: { name: 'Bluetooth', lo: 250, hi: 2800, gain: 110, ns: true, bands: [{ f: 400, g: -2, q: 1 }, { f: 1500, g: 2, q: 1 }, { f: 2500, g: 3, q: 1.2 }] }
  };
  const BAND_RANGE = [[80, 700], [500, 1600], [1400, 3200]];
  function micType(label) {
    for (const t of TYPES) if (t.re.test(label || '')) return t;
    return { id: 'other', name: 'Micro', note: '', preset: 'neutre' };
  }
  function presetEq(id) {
    const p = PRESETS[id] || PRESETS.neutre;
    return { on: true, lo: p.lo, hi: p.hi, gain: p.gain, ns: !!p.ns, ec: false, agc: false, bands: p.bands.map((b) => Object.assign({}, b)), name: p.name };
  }

  // ------------------------------------------------------------ état
  const V = {
    api: null, ctx: null, stream: null, src: null, n: null, node: null, mon: null, monOn: false,
    on: false, label: '', devId: '', type: null, eq: presetEq('neutre'), saved: false, fromServer: false,
    peak: 0, clipAt: 0, tx: false, sent: 0, raf: 0, starting: false
  };
  const WORKLET = `
    class RsMic extends AudioWorkletProcessor {
      constructor() { super(); this.buf = new Float32Array(${FRAME}); this.n = 0; }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch) for (let i = 0; i < ch.length; i++) {
          this.buf[this.n] = ch[i];
          if (++this.n === ${FRAME}) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
        }
        return true;
      }
    }
    registerProcessor('rs-mic', RsMic);`;

  // ------------------------------------------------------------ interface (cadre TX, sous le PTT)
  function build() {
    if ($('vxBox')) return;
    const anchor = $('ptt');
    if (!anchor) return;
    const box = document.createElement('div');
    box.className = 'vx';
    box.id = 'vxBox';
    box.hidden = true;
    box.innerHTML =
      '<div class="vx-h"><span class="vx-title">SSB configuration</span></div>' +
      '<button class="btn vx-on" id="vxOn" type="button" aria-pressed="false" title="Activer votre micro : votre voix part vers le TRX pendant l’appui sur PTT (LSB / USB…) ; un nouveau clic le coupe">Configuration micro</button>' +
      '<button class="btn vx-trx" id="vxTrxBtn" type="button" hidden title="Égaliseur paramétrique du TRX (menus PRMTRC) : votre profil, mis au TRX quand vous prenez la main">Equalizer TRX</button>' +
      '<div class="vx-b" id="vxBody" hidden>' +
      '<select id="vxDev" aria-label="Entrée son (micro)"></select>' +
      '<div class="vx-type" id="vxType"></div>' +
      '<div class="vx-meter" title="Niveau de votre micro après l’égaliseur : visez le vert, jamais le rouge"><i id="vxLvl"></i><b id="vxClip">SAT</b></div>' +
      '<div class="vx-row"><button class="btn" id="vxEqBtn" type="button" title="Égaliseur de votre micro (dans le navigateur) : réglages gardés pour ce micro">Equalizer micro</button></div>' +
      '<div class="vx-note" id="vxNote"></div>' +
      '<div class="vx-mon"><button class="btn" id="vxMonBtn" type="button" aria-pressed="false" title="Entendre votre micro tel qu’il partira (au casque seulement : effet Larsen avec des haut-parleurs)">🎧 M’écouter</button></div>' +
      '<label class="vx-monvol" title="Volume de « M’écouter » dans votre casque (ne change pas ce qui part vers le TRX)">Volume <input type="range" id="vxMonVol" min="0" max="300" step="5" aria-label="Volume de M’écouter"><output id="vxMonVolV"></output></label>' +
      '</div>';
    anchor.after(box);
    $('vxOn').addEventListener('click', () => (V.on ? stop(true) : start()));
    $('vxDev').addEventListener('change', () => { const o = $('vxDev').selectedOptions[0]; store.set('dev', o ? o.textContent : ''); start($('vxDev').value); });
    $('vxEqBtn').addEventListener('click', openEq);
    $('vxTrxBtn').addEventListener('click', openTrx);
    $('vxMonBtn').addEventListener('click', () => setMonitor(!V.monOn));
    $('vxMonVol').value = String(monVol());
    $('vxMonVolV').textContent = monVol() + ' %';
    $('vxMonVol').addEventListener('input', () => {
      store.set('monvol', $('vxMonVol').value);
      $('vxMonVolV').textContent = monVol() + ' %';
      if (V.mon && V.monOn) V.mon.gain.setTargetAtTime(monVol() / 100, V.ctx.currentTime, 0.02);
    });
  }
  function note(t, warn) {
    const n = $('vxNote');
    if (!n) return;
    n.textContent = t || '';
    n.classList.toggle('warn', !!warn);
  }
  function draw() {
    const box = $('vxBox');
    if (!box || !V.api) return;
    const st = V.api.state();
    const modes = st && st.voice;
    const R = V.api.rig && V.api.rig();
    const trxEq = !!(st && st.trxEq && R && R.TRX_EQ);
    box.hidden = (!modes && !trxEq) || !V.api.me() || !V.api.me().canTx || V.api.me().rxOnly;
    $('vxTrxBtn').hidden = !trxEq;
    $('vxOn').hidden = !modes;
    if (!trxEq && $('vxTrx')) $('vxTrx').remove();
    if ($('vxTrx')) trxDrawState();
    $('vxOn').setAttribute('aria-pressed', String(V.on));
    $('vxOn').textContent = 'Configuration micro';
    $('vxOn').title = V.on ? 'Micro actif : votre voix part vers le TRX pendant l’appui sur PTT. Clic : couper le micro' : 'Activer votre micro : votre voix part vers le TRX pendant l’appui sur PTT (LSB / USB…)';
    $('vxBody').hidden = !V.on;
    if (!V.on) return;
    const md = txMode(st);
    if (V.tx) note('● Votre voix part vers le TRX — parlez quand « TX » passe au rouge', false);
    else if (modes && modes.indexOf(md) < 0) note('PTT = micro du club en ' + (md || '?') + ' : la phonie à distance marche en ' + modes.join(' / ') + '.', true);
    else if (!V.api.iControl()) note('Prenez la main, puis PTT (ou barre d’espace) pour parler.', false);
    else note('Prêt : maintenez PTT (ou la barre d’espace) et parlez.', false);
  }
  const txMode = (st) => (st && st.radio ? (st.radio.txVfo === 1 ? st.radio.modeB : st.radio.mode) : '') || '';

  // ------------------------------------------------------------ micro
  async function listDevices(cur) {
    const sel = $('vxDev');
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    sel.textContent = '';
    for (const d of devs) {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || 'Micro ' + (sel.length + 1);
      sel.appendChild(o);
    }
    if (cur && devs.find((d) => d.deviceId === cur)) sel.value = cur;
    return devs;
  }
  async function start(devId) {
    if (V.starting) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return V.api.say('Ce navigateur ne donne pas accès au micro.', 'warn');
    if (!window.isSecureContext) return V.api.say('Accès au micro refusé : la page doit être ouverte en https.', 'warn');
    V.starting = true;
    try {
      stop(false);
      let id = devId || '';
      if (!id) {
        // Micro choisi la dernière fois (par son nom) ; sinon celui de Windows par défaut
        const want = store.get('dev', '');
        if (want) {
          let devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
          if (!devs.some((d) => d.label)) { const t = await navigator.mediaDevices.getUserMedia({ audio: true }); t.getTracks().forEach((x) => x.stop()); devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); }
          const d = devs.find((x) => x.label === want);
          if (d) id = d.deviceId;
        }
      }
      // Options du micro (réduction de bruit…) : celles du profil de ce micro si on le connaît déjà
      const eq = V.eq;
      V.stream = await navigator.mediaDevices.getUserMedia({
        audio: Object.assign({ echoCancellation: !!eq.ec, noiseSuppression: !!eq.ns, autoGainControl: !!eq.agc, channelCount: 1 }, id ? { deviceId: { exact: id } } : {})
      });
      const track = V.stream.getAudioTracks()[0];
      const set = track ? track.getSettings() : {};
      await listDevices(set.deviceId);
      V.devId = set.deviceId || '';
      V.label = (track && track.label) || 'Micro';
      V.type = micType(V.label);
      V.ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await V.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      V.src = V.ctx.createMediaStreamSource(V.stream);
      const c = V.ctx;
      V.n = { gain: c.createGain(), lo: c.createBiquadFilter(), b: [c.createBiquadFilter(), c.createBiquadFilter(), c.createBiquadFilter()], hi: c.createBiquadFilter(), hi2: c.createBiquadFilter() };
      V.n.lo.type = 'highpass';
      V.n.hi.type = 'lowpass';
      V.n.hi2.type = 'lowpass';
      for (const b of V.n.b) b.type = 'peaking';
      V.node = new AudioWorkletNode(c, 'rs-mic');
      V.mon = c.createGain();
      V.mon.gain.value = 0;
      const mute = c.createGain();
      mute.gain.value = 0;
      V.src.connect(V.n.gain).connect(V.n.lo).connect(V.n.b[0]).connect(V.n.b[1]).connect(V.n.b[2]).connect(V.n.hi).connect(V.n.hi2);
      V.n.hi2.connect(V.node);
      V.node.connect(mute).connect(c.destination);
      V.n.hi2.connect(V.mon).connect(c.destination);
      V.node.port.onmessage = (e) => onFrame(e.data);
      if (c.state !== 'running') await c.resume().catch(() => {});
      V.on = true;
      V.saved = false;
      V.fromServer = false;
      store.set('dev', V.label);
      store.set('on', '1');
      applyEq();
      // Réglages gardés pour ce micro (serveur) ; en attendant, ceux de ce PC, sinon ceux proposés pour ce type de micro
      const local = store.get('eq.' + V.label, '');
      if (local) { try { V.eq = Object.assign(presetEq('neutre'), JSON.parse(local)); V.saved = true; applyEq(); } catch (e) { /* */ } }
      else { V.eq = presetEq(V.type.preset); applyEq(); }
      V.api.send({ t: 'mic_get', label: V.label });
      drawType();
      meterLoop();
      draw();
    } catch (e) {
      stop(false);
      V.api.say(/denied|permission|NotAllowed/i.test(e.name + e.message) ? 'Micro refusé par le navigateur : cliquez sur le cadenas à gauche de l’adresse → Micro → Autoriser.' : 'Micro indisponible : ' + e.message, 'warn', 9000);
    } finally {
      V.starting = false;
    }
  }
  function stop(byUser) {
    if (V.tx) txEnd();
    setMonitor(false);
    if (V.stream) V.stream.getTracks().forEach((t) => t.stop());
    if (V.ctx) V.ctx.close().catch(() => {});
    V.stream = null;
    V.ctx = null;
    V.node = null;
    V.n = null;
    V.mon = null;
    const was = V.on;
    V.on = false;
    cancelAnimationFrame(V.raf);
    if (byUser) {
      store.set('on', '0');
      if (was && V.api) V.api.send({ t: 'mic_off' }); // le micro du club peut être remis tout de suite
    }
    draw();
  }
  function drawType() {
    const t = V.type || micType(V.label);
    const set = V.stream && V.stream.getAudioTracks()[0] ? V.stream.getAudioTracks()[0].getSettings() : {};
    const opts = [set.noiseSuppression ? 'réduction de bruit' : '', set.echoCancellation ? 'anti-écho' : '', set.autoGainControl ? 'gain auto' : ''].filter(Boolean);
    $('vxType').innerHTML = '<b>' + esc(t.name) + '</b> · ' + esc(V.label) +
      '<br><span>' + (V.saved ? (V.fromServer ? 'vos réglages pour ce micro' : 'réglages gardés sur ce PC') : 'réglage proposé : ' + esc(V.eq.name || PRESETS[t.preset].name)) +
      (V.eq.on ? '' : ' · égaliseur coupé') + (opts.length ? ' · ' + opts.join(', ') : '') + '</span>' +
      (t.note ? '<br><i>' + esc(t.note) + '</i>' : '');
  }

  // ------------------------------------------------------------ égaliseur
  function applyEq() {
    if (!V.n || !V.ctx) return;
    const e = V.eq;
    const t = V.ctx.currentTime;
    V.n.gain.gain.setTargetAtTime((e.gain || 100) / 100, t, 0.02);
    V.n.lo.frequency.setTargetAtTime(e.on && e.lo > 0 ? e.lo : 20, t, 0.02);
    V.n.lo.Q.value = 0.707;
    // Coupe-haut doublé (pente raide) : rien au-delà de la bande SSB, et pas de repliement à 12 kHz
    V.n.hi.frequency.setTargetAtTime(e.on ? e.hi : 5000, t, 0.02);
    V.n.hi2.frequency.setTargetAtTime(e.on ? e.hi : 5000, t, 0.02);
    V.n.hi.Q.value = 0.707;
    V.n.hi2.Q.value = 0.707;
    e.bands.forEach((b, i) => {
      const n = V.n.b[i];
      n.frequency.setTargetAtTime(b.f, t, 0.02);
      n.gain.setTargetAtTime(e.on ? b.g : 0, t, 0.02);
      n.Q.setTargetAtTime(b.q, t, 0.02);
    });
    if ($('vxEq')) drawCurve();
  }
  function saveEq() {
    if (!V.label) return;
    store.set('eq.' + V.label, JSON.stringify(V.eq));
    V.api.send({ t: 'mic_set', label: V.label, eq: V.eq });
    V.saved = true;
    V.fromServer = true;
    drawType();
  }
  function openEq() {
    if (!V.on) return;
    let d = $('vxEq');
    if (d) { d.remove(); return; }
    d = document.createElement('div');
    d.className = 'vx-eq';
    d.id = 'vxEq';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', 'Equalizer micro');
    const bandRow = (i) => {
      const r = BAND_RANGE[i];
      return '<fieldset class="vx-band"><legend>EQ' + (i + 1) + '</legend>' +
        '<label>Fréquence <output data-o="f' + i + '"></output><input type="range" data-k="f' + i + '" min="' + r[0] + '" max="' + r[1] + '" step="10"></label>' +
        '<label>Niveau <output data-o="g' + i + '"></output><input type="range" data-k="g' + i + '" min="-15" max="15" step="0.5"></label>' +
        '<label>Largeur (Q) <output data-o="q' + i + '"></output><input type="range" data-k="q' + i + '" min="0.3" max="6" step="0.1"></label></fieldset>';
    };
    d.innerHTML =
      '<div class="vx-eq-h"><b>Equalizer micro</b><span id="vxEqMic"></span><button class="btn" type="button" data-a="close" aria-label="Fermer">✕</button></div>' +
      '<canvas id="vxCurve" width="560" height="150" aria-label="Courbe de l’égaliseur"></canvas>' +
      '<div class="vx-eq-meter"><i id="vxLvl2"></i></div>' +
      '<div class="vx-eq-top"><label><input type="checkbox" data-k="on"> Égaliseur en service</label>' +
      '<label>Réglages proposés <select data-k="preset"><option value="">—</option>' + Object.keys(PRESETS).map((k) => '<option value="' + k + '">' + esc(PRESETS[k].name) + '</option>').join('') + '</select></label></div>' +
      '<div class="vx-cuts">' +
      '<label>Coupe-bas <output data-o="lo"></output><input type="range" data-k="lo" min="0" max="500" step="10"></label>' +
      '<label>Coupe-haut <output data-o="hi"></output><input type="range" data-k="hi" min="1800" max="4000" step="50"></label>' +
      '<label>Gain du micro <output data-o="gain"></output><input type="range" data-k="gain" min="20" max="400" step="5"></label></div>' +
      '<div class="vx-bands">' + bandRow(0) + bandRow(1) + bandRow(2) + '</div>' +
      '<div class="vx-eq-top"><label><input type="checkbox" data-k="ns"> Réduction de bruit</label><label><input type="checkbox" data-k="ec"> Anti-écho (haut-parleurs)</label><label><input type="checkbox" data-k="agc"> Gain automatique</label></div>' +
      '<p class="vx-hint">Réglez en écoutant au casque (« 🎧 M’écouter »). La SSB passe 300 à 2700 Hz environ : un peu de coupe vers 300 Hz et de la présence vers 2 à 2,5 kHz font une voix qui porte. Gardez le niveau dans le vert. Le gain, la réduction de bruit et les autres options du micro valent pour ce micro seulement.</p>' +
      '<div class="vx-eq-f"><button class="btn" type="button" data-a="mon" aria-pressed="false">🎧 M’écouter</button><button class="btn accent" type="button" data-a="save">Enregistrer pour ce micro</button><button class="btn" type="button" data-a="close">Fermer</button></div>';
    document.body.appendChild(d);
    d.querySelector('#vxEqMic').textContent = ' — ' + V.label;
    const fill = () => {
      const e = V.eq;
      const set = (k, v) => { const x = d.querySelector('[data-k="' + k + '"]'); if (x) { if (x.type === 'checkbox') x.checked = !!v; else x.value = v; } };
      const out = (k, t) => { const o = d.querySelector('[data-o="' + k + '"]'); if (o) o.textContent = t; };
      set('on', e.on); set('lo', e.lo); set('hi', e.hi); set('gain', e.gain); set('ns', e.ns); set('ec', e.ec); set('agc', e.agc);
      out('lo', e.lo ? e.lo + ' Hz' : 'aucun'); out('hi', e.hi + ' Hz'); out('gain', e.gain + ' %');
      e.bands.forEach((b, i) => { set('f' + i, b.f); set('g' + i, b.g); set('q' + i, b.q); out('f' + i, b.f + ' Hz'); out('g' + i, (b.g > 0 ? '+' : '') + b.g + ' dB'); out('q' + i, String(b.q)); });
      d.querySelector('[data-a="mon"]').setAttribute('aria-pressed', String(V.monOn));
    };
    d.addEventListener('input', (ev) => {
      const k = ev.target.dataset.k;
      if (!k || k === 'preset') return;
      const e = V.eq;
      const v = ev.target.type === 'checkbox' ? ev.target.checked : Number(ev.target.value);
      let m;
      if ((m = /^([fgq])(\d)$/.exec(k))) e.bands[+m[2]][m[1]] = v;
      else e[k] = v;
      e.name = 'Personnel';
      V.saved = false;
      applyEq();
      fill();
      if (k === 'ns' || k === 'ec' || k === 'agc') micOptions();
    });
    d.addEventListener('change', (ev) => {
      if (ev.target.dataset.k !== 'preset' || !ev.target.value) return;
      V.eq = presetEq(ev.target.value);
      ev.target.value = '';
      V.saved = false;
      applyEq();
      fill();
      micOptions();
    });
    d.addEventListener('click', (ev) => {
      const a = ev.target.dataset && ev.target.dataset.a;
      if (a === 'close') { d.remove(); drawType(); }
      if (a === 'save') { saveEq(); V.api.say('Réglages enregistrés pour « ' + V.label + ' » : repris tout seuls avec ce micro, sur n’importe quel PC.', 'ok', 5000); }
      if (a === 'mon') { setMonitor(!V.monOn); fill(); }
    });
    fill();
    drawCurve();
  }
  // Options du micro (réduction de bruit, anti-écho, gain auto) : appliquées sur l'entrée en cours
  function micOptions() {
    const t = V.stream && V.stream.getAudioTracks()[0];
    if (!t || !t.applyConstraints) return;
    t.applyConstraints({ echoCancellation: !!V.eq.ec, noiseSuppression: !!V.eq.ns, autoGainControl: !!V.eq.agc }).then(drawType).catch(() => {});
  }
  function drawCurve() {
    const cv = $('vxCurve');
    if (!cv || !V.n) return;
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const N = 200;
    const f = new Float32Array(N);
    for (let i = 0; i < N; i++) f[i] = 60 * Math.pow(5000 / 60, i / (N - 1));
    const tot = new Float32Array(N).fill(0);
    const mag = new Float32Array(N), ph = new Float32Array(N);
    // Courbe calculée sur les réglages voulus (les filtres glissent vers eux en quelques ms)
    const e = V.eq;
    const tmp = new OfflineAudioContext(1, 1, RATE);
    const mk = (type, fr, q, gain) => { const b = tmp.createBiquadFilter(); b.type = type; b.frequency.value = fr; b.Q.value = q; b.gain.value = gain || 0; return b; };
    const list = e.on ? [mk('highpass', e.lo > 0 ? e.lo : 20, 0.707)].concat(e.bands.map((b) => mk('peaking', b.f, b.q, b.g)), [mk('lowpass', e.hi, 0.707), mk('lowpass', e.hi, 0.707)]) : [mk('lowpass', 5000, 0.707)];
    for (const n of list) { n.getFrequencyResponse(f, mag, ph); for (let i = 0; i < N; i++) tot[i] += 20 * Math.log10(Math.max(1e-6, mag[i])); }
    const css = getComputedStyle(document.documentElement);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.fillRect(0, 0, W, H);
    const yOf = (db) => H / 2 - db * (H / 2 - 10) / 18;
    const xOf = (hz) => Math.log(hz / 60) / Math.log(5000 / 60) * W;
    // Bande SSB (300–2700 Hz)
    g.fillStyle = 'rgba(0, 212, 255, .07)';
    g.fillRect(xOf(300), 0, xOf(2700) - xOf(300), H);
    g.strokeStyle = 'rgba(255,255,255,.12)';
    g.fillStyle = 'rgba(255,255,255,.45)';
    g.font = '10px sans-serif';
    for (const hz of [100, 200, 300, 500, 1000, 2000, 3000]) { const x = xOf(hz); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.fillText(hz >= 1000 ? hz / 1000 + 'k' : String(hz), x + 2, H - 3); }
    for (const db of [-12, -6, 0, 6, 12]) { const y = yOf(db); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.fillText((db > 0 ? '+' : '') + db, 2, y - 2); }
    g.strokeStyle = (css.getPropertyValue('--v2-accent-yellow') || '#f2cf4a').trim() || '#f2cf4a';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < N; i++) { const x = xOf(f[i]); const y = Math.max(0, Math.min(H, yOf(tot[i]))); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
  }
  // Volume de « M’écouter » (casque) : 0 à 300 %, gardé dans ce navigateur
  function monVol() { const v = Number(store.get('monvol', '100')); return Number.isFinite(v) ? Math.max(0, Math.min(300, v)) : 100; }
  function setMonitor(on) {
    V.monOn = !!on && !!V.mon;
    if (V.mon) V.mon.gain.value = V.monOn ? monVol() / 100 : 0;
    const b = $('vxMonBtn');
    if (b) b.setAttribute('aria-pressed', String(V.monOn));
  }

  // ------------------------------------------------------------ trames et niveau
  function onFrame(buf) {
    let p = 0;
    for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
    V.peak = Math.max(p, V.peak * 0.9);
    if (p > 0.97) V.clipAt = Date.now();
    if (V.tx && V.api) { V.api.sendBin(ULAW.encodeFrame(buf, RATE, 0x05)); V.sent++; }
  }
  function meterLoop() {
    cancelAnimationFrame(V.raf);
    const step = () => {
      if (!V.on) return;
      const db = V.peak > 0 ? 20 * Math.log10(V.peak) : -60;
      const w = Math.max(0, Math.min(100, (db + 48) / 48 * 100));
      const clip = Date.now() - V.clipAt < 1200;
      for (const id of ['vxLvl', 'vxLvl2']) { const l = $(id); if (l) { l.style.width = w + '%'; l.classList.toggle('hot', db > -6); } }
      const c = $('vxClip');
      if (c) c.classList.toggle('on', clip);
      V.raf = requestAnimationFrame(step);
    };
    V.raf = requestAnimationFrame(step);
  }

  // ------------------------------------------------------------ PTT
  /** PTT appuyé : true si la voix doit partir (micro actif, mode prévu). */
  function wantVoice() {
    if (!V.on || !V.api) return false;
    const st = V.api.state();
    return !!(st && st.voice && st.voice.indexOf(txMode(st)) >= 0);
  }
  function txStart() {
    if (!wantVoice()) return false;
    if (V.ctx && V.ctx.state !== 'running') V.ctx.resume().catch(() => {});
    V.tx = true;
    V.sent = 0;
    draw();
    return true;
  }
  function txEnd() {
    if (!V.tx) return;
    V.tx = false;
    draw();
  }

  // ------------------------------------------------------------ égaliseur paramétrique du TRX (Yaesu, menus PRMTRC)
  const T = { info: null, pr: null };
  const BAND_NAMES = ['EQ1 (grave)', 'EQ2 (médium)', 'EQ3 (aigu)'];
  function trxBlank() {
    const E = V.api.rig().TRX_EQ;
    const one = () => ({ f: 0, l: 0, w: Math.max(E.BW[0], 5) });
    return { n: [one(), one(), one()], p: [one(), one(), one()] };
  }
  function openTrx() {
    const R = V.api.rig();
    const E = R && R.TRX_EQ;
    if (!E) return;
    let d = $('vxTrx');
    if (d) { d.remove(); return; }
    d = document.createElement('div');
    d.className = 'vx-eq vx-trxeq';
    d.id = 'vxTrx';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', 'Equalizer TRX');
    const set = (k, title) => '<fieldset class="vx-set"><legend>' + title + '</legend><div class="vx-bands">' + [0, 1, 2].map((b) =>
      '<fieldset class="vx-band"><legend>' + BAND_NAMES[b] + '</legend>' +
      '<label>Fréquence <select data-t="' + k + b + 'f"><option value="0">coupée</option>' + E.FREQS[b].map((hz, i) => '<option value="' + (i + 1) + '">' + hz + ' Hz</option>').join('') + '</select></label>' +
      '<label>Niveau <output data-o="' + k + b + 'l"></output><input type="range" data-t="' + k + b + 'l" min="' + E.LVL[0] + '" max="' + E.LVL[1] + '" step="1"></label>' +
      '<label>Largeur <output data-o="' + k + b + 'w"></output><input type="range" data-t="' + k + b + 'w" min="' + E.BW[0] + '" max="' + E.BW[1] + '" step="1"></label></fieldset>').join('') + '</div></fieldset>';
    d.innerHTML =
      '<div class="vx-eq-h"><b>Equalizer TRX</b><span>— ' + esc(R.NAME) + '</span><button class="btn" type="button" data-a="close" aria-label="Fermer">✕</button></div>' +
      '<p class="vx-hint" id="vxTrxState"></p>' +
      set('n', 'PROC coupé (menus PRMTRC EQ)') + set('p', 'PROC en service (menus P PRMTRC EQ)') +
      '<p class="vx-hint">Ce sont les menus du TRX lui-même : votre profil y est mis quand vous prenez la main, et le réglage du club est remis quand vous la rendez. Il agit sur la modulation du TRX (micro du club et, si le TRX l’applique aussi à l’entrée USB, votre phonie à distance : à vérifier à l’écoute). Un essai part tout de suite au TRX ; « Enregistrer » le garde pour vos prochaines prises de main.</p>' +
      '<div class="vx-eq-f"><button class="btn" type="button" data-a="read">Lire le TRX</button><button class="btn" type="button" data-a="try">Essayer sur le TRX</button>' +
      '<button class="btn accent" type="button" data-a="save">Enregistrer mon profil</button><button class="btn" type="button" data-a="del">Supprimer mon profil</button>' +
      '<button class="btn" type="button" data-a="club" hidden>Enregistrer comme réglage du club</button><button class="btn" type="button" data-a="close">Fermer</button></div>';
    document.body.appendChild(d);
    T.pr = null;
    trxFill();
    d.addEventListener('input', (ev) => {
      const k = ev.target.dataset.t;
      if (!k || !T.pr) return;
      const m = /^([np])(\d)([flw])$/.exec(k);
      T.pr[m[1]][+m[2]][m[3]] = Number(ev.target.value);
      T.dirty = true;
      trxFill();
    });
    d.addEventListener('click', (ev) => {
      const a = ev.target.dataset && ev.target.dataset.a;
      if (!a) return;
      if (a === 'close') return d.remove();
      if (a === 'read') return V.api.send({ t: 'trxeq_read' });
      if (a === 'try') return V.api.send({ t: 'trxeq_try', profile: T.pr });
      if (a === 'save') { T.dirty = false; return V.api.send({ t: 'trxeq_save', profile: T.pr }); }
      if (a === 'club' && confirm('Enregistrer ces valeurs comme réglage du club pour le ' + V.api.rig().NAME + ' ?\nElles seront remises au TRX chaque fois qu’un opérateur rend la main.')) return V.api.send({ t: 'trxeq_club', profile: T.pr });
      if (a === 'del' && confirm('Supprimer votre profil d’égaliseur du TRX ?')) return V.api.send({ t: 'trxeq_del' });
    });
    V.api.send({ t: 'trxeq_get' });
  }
  function trxFill() {
    const d = $('vxTrx');
    if (!d) return;
    if (!T.pr) T.pr = trxBlank();
    for (const k of ['n', 'p']) T.pr[k].forEach((x, b) => {
      for (const f of ['f', 'l', 'w']) {
        const el = d.querySelector('[data-t="' + k + b + f + '"]');
        if (el && document.activeElement !== el) el.value = String(x[f]);
      }
      const o = (f, t) => { const el = d.querySelector('[data-o="' + k + b + f + '"]'); if (el) el.textContent = t; };
      o('l', (x.l > 0 ? '+' : '') + x.l + ' dB');
      o('w', String(x.w));
      d.querySelectorAll('[data-t^="' + k + b + '"]').forEach((el) => { if (el.dataset.t.slice(-1) !== 'f') el.disabled = !x.f; });
    });
    trxDrawState();
  }
  function trxDrawState() {
    const d = $('vxTrx');
    if (!d) return;
    const st = V.api.state();
    const on = st && st.trxEq ? st.trxEq.on : null;
    const me = V.api.me();
    const i = T.info || {};
    const ctl = V.api.iControl();
    d.querySelector('#vxTrxState').innerHTML = 'Au TRX maintenant : <b>' + (on && on[0] !== '#' ? 'profil de ' + esc(on) : 'réglage du club') + '</b>' +
      ' · votre profil : <b>' + (i.mine ? 'enregistré' : 'aucun') + '</b>' + (i.club ? '' : ' · réglage du club : pas encore lu') +
      (T.dirty ? ' · <span class="warn">modifié, pas enregistré</span>' : '') + (ctl ? '' : '<br><span class="warn">Prenez la main pour lire le TRX ou y faire un essai.</span>') +
      (st && st.radio && st.radio.micEq === 0 ? '<br><span class="warn">MIC EQ est coupé au TRX : l’égaliseur n’agit pas. Bouton « MIC EQ » du cadre TX pour le mettre en service.</span>' : '');
    d.querySelector('[data-a="read"]').disabled = !ctl;
    d.querySelector('[data-a="try"]').disabled = !ctl;
    d.querySelector('[data-a="del"]').disabled = !i.mine;
    d.querySelector('[data-a="club"]').hidden = !(me && me.admin);
  }

  window.RSVOICE = {
    init(api) {
      V.api = api;
      build();
      draw();
    },
    onState() { build(); draw(); },
    onHello() {
      build();
      draw();
      // Micro remis tout seul s'il était actif avant (le navigateur se souvient de l'autorisation)
      if (store.get('on', '0') === '1' && !V.on) setTimeout(() => { const st = V.api.state(); if (st && st.voice) start().catch(() => {}); }, 800);
    },
    onMessage(m) {
      if (m.t === 'trxeq') {
        T.info = m;
        if (!T.pr || !T.dirty) T.pr = JSON.parse(JSON.stringify(m.mine || m.club || trxBlank()));
        trxFill();
        return true;
      }
      if (m.t === 'trxeq_values') {
        T.pr = m.profile;
        T.dirty = true;
        trxFill();
        V.api.say('Égaliseur lu sur le TRX.', 'ok', 3000);
        return true;
      }
      if (m.t !== 'mic_profile' || m.label !== V.label) return false;
      if (m.eq) {
        V.eq = Object.assign(presetEq('neutre'), m.eq);
        V.saved = true;
        V.fromServer = true;
        store.set('eq.' + V.label, JSON.stringify(V.eq));
        applyEq();
        micOptions();
      }
      drawType();
      return true;
    },
    wantVoice,
    txStart,
    txEnd,
    talking: () => V.tx,
    // Page Face avant : touche MONI = « M'écouter »
    micOn: () => !!V.on,
    monitor(on) { setMonitor(on); return V.monOn; },
    monitorOn: () => !!V.monOn,
    // essais
    _v: V, micType
  };
})();
