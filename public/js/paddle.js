/*
 * Clé CW de l'opérateur : palettes (iambique A / B) ou pioche branchées chez lui, manipulation du TRX du club.
 *
 * Le keyer tourne ici, dans le navigateur, avec l'écoute locale (sidetone) : l'opérateur entend sa manipulation sans
 * retard. Les fronts (clé enfoncée / relâchée) partent horodatés vers le serveur (rafales) ; la page Station du club
 * les rejoue au même rythme sur la ligne DTR du 2e port USB du TRX, avec ~0,1 à 0,3 s de décalage (Internet).
 *
 * Entrées : adaptateur USB qui se présente comme un clavier (Ctrl gauche / Ctrl droit, comme les adaptateurs VBand),
 * touches choisies, adaptateur MIDI, câble USB-série (DSR = point, CTS = trait), palettes à l'écran.
 * « Clé → TRX » éteint : entraînement (écoute locale seule, rien n'est émis).
 */
(function () {
  'use strict';
  const perf = () => performance.now();
  const r1 = (x) => Math.round(x * 10) / 10;

  function mount(root, opt) {
    if (!root || root.dataset.cwk) return null;
    root.dataset.cwk = '1';
    const api = opt.api;
    const store = opt.store;
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    const S = {
      mode: store.get('pd.mode', 'B'), // B, A, S (pioche)
      wpm: Number(store.get('pd.wpm', store.get('cwspeed', '22'))) || 22,
      weight: Number(store.get('pd.weight', '50')) || 50,
      swap: store.get('pd.swap', '0') === '1',
      src: store.get('pd.src', 'ctrl'), // ctrl, keys, midi, serial, screen
      kDit: store.get('pd.kdit', 'BracketLeft'),
      kDah: store.get('pd.kdah', 'BracketRight'),
      mDit: store.get('pd.mdit', 'n1'),
      mDah: store.get('pd.mdah', 'n2'),
      tone: Number(store.get('pd.tone', '600')) || 600,
      vol: Number(store.get('pd.vol', '40')),
      sink: store.get('pd.sink', ''), // sortie son de l'écoute locale (casque…)
      armed: false // jamais armé au chargement de la page
    };
    if (!Number.isFinite(S.vol)) S.vol = 40;
    const save = (k, v) => store.set('pd.' + k, v);

    root.className = 'cwk';
    root.innerHTML = `
      <div class="cwk-bar">
        <button class="btn cwk-arm" type="button" title="Allumé : votre clé manipule le TRX du club (avec la main). Éteint : entraînement, écoute locale seule.">Clé → TRX <b>OFF</b></button>
        <i class="cwk-led" title="Votre clé (écoute locale)"></i><span class="cwk-tx" title="Le TRX du club émet votre manipulation">TX</span>
        <span class="cwk-sum"></span>
        <button class="cwk-pd" type="button" data-p="dit" title="Palette point (souris / écran tactile)">•</button><button class="cwk-pd" type="button" data-p="dah" title="Palette trait (souris / écran tactile)">—</button>
        <button class="dg-mini cwk-cfg" type="button" aria-expanded="false">Réglages</button>
      </div>
      <div class="cwk-set" hidden>
        <label>Clé <select data-k="mode"><option value="B">Palettes, iambique B</option><option value="A">Palettes, iambique A</option><option value="S">Pioche (clé droite)</option></select></label>
        <label>Branchement <select data-k="src">
          <option value="ctrl">Adaptateur USB (Ctrl gauche / droit)</option>
          <option value="keys">Touches du clavier</option>
          <option value="midi">Adaptateur MIDI</option>
          <option value="serial">Câble USB-série (DSR / CTS)</option>
          <option value="screen">Palettes à l’écran seulement</option></select></label>
        <label class="cwk-n">Vitesse <input data-k="wpm" type="number" min="5" max="50" step="1"> mots/min</label>
        <label class="cwk-n">Poids <input data-k="weight" type="number" min="30" max="70" step="1"> %</label>
        <label class="cwk-c"><input data-k="swap" type="checkbox"> Inverser point / trait</label>
        <label class="cwk-n">Écoute <input data-k="tone" type="number" min="300" max="1200" step="10"> Hz</label>
        <label class="cwk-n">Volume <input data-k="vol" type="range" min="0" max="100" step="1"></label>
        <label class="cwk-out">Sortie <select data-k="sink"><option value="">Haut-parleurs par défaut</option></select></label>
        <div class="cwk-src" data-s="keys">Point : <button class="dg-mini" type="button" data-learn="kDit"></button> Trait : <button class="dg-mini" type="button" data-learn="kDah"></button> <span class="cwk-hint">(cliquez puis appuyez sur la touche)</span></div>
        <div class="cwk-src" data-s="midi">Point : <button class="dg-mini" type="button" data-learn="mDit"></button> Trait : <button class="dg-mini" type="button" data-learn="mDah"></button> <span class="cwk-midi"></span></div>
        <div class="cwk-src" data-s="serial"><button class="dg-mini" type="button" data-a="serial">Choisir le port…</button> <span class="cwk-ser">aucun port</span></div>
        <p class="cwk-hint">Pendant une macro, toucher la clé arrête la macro : c’est votre clé qui manipule. Échap arrête l’émission. Gardez cette fenêtre visible pendant le trafic.</p>
      </div>`;
    const q = (s) => root.querySelector(s);
    const armBtn = q('.cwk-arm');
    const led = q('.cwk-led');
    const txLed = q('.cwk-tx');
    const set = q('.cwk-set');

    // ------------------------------------------------------------------ écoute locale (sidetone)
    let ac = null;
    let osc = null;
    let gain = null;
    function audio() {
      try {
        if (!ac) {
          const AC = win.AudioContext || win.webkitAudioContext;
          if (!AC) return;
          ac = new AC({ latencyHint: 'interactive' });
          osc = ac.createOscillator();
          gain = ac.createGain();
          gain.gain.value = 0;
          osc.type = 'sine';
          osc.frequency.value = S.tone;
          osc.connect(gain).connect(ac.destination);
          osc.start();
          sinkApply();
        }
        if (ac.state === 'suspended') ac.resume();
      } catch (e) { ac = null; }
    }
    function sinkApply() {
      if (ac && ac.setSinkId && (S.sink || ac.sinkId)) ac.setSinkId(S.sink || '').catch(() => {});
    }
    // Sorties son du PC (Chrome / Edge) : l'écoute locale peut aller dans un casque différent de la BF du TRX
    function sinkList() {
      const sel = set.querySelector('[data-k="sink"]');
      const box = set.querySelector('.cwk-out');
      const can = !!(win.AudioContext && win.AudioContext.prototype.setSinkId && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices);
      box.hidden = !can;
      if (!can) return;
      navigator.mediaDevices.enumerateDevices().then((ds) => {
        const outs = ds.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId);
        sel.innerHTML = '<option value="">Haut-parleurs par défaut</option>';
        outs.forEach((d, i) => { const o = doc.createElement('option'); o.value = d.deviceId; o.textContent = d.label || 'Sortie ' + (i + 1); sel.appendChild(o); });
        if (S.sink && !outs.some((d) => d.deviceId === S.sink)) { const o = doc.createElement('option'); o.value = S.sink; o.textContent = 'Sortie choisie (débranchée ?)'; sel.appendChild(o); }
        sel.value = S.sink;
      }).catch(() => {});
    }
    const level = () => Math.pow(Math.max(0, Math.min(100, S.vol)) / 100, 2) * 0.6;
    function tone(T, on) {
      if (!ac || !gain) return;
      const at = Math.max(ac.currentTime + 0.002, ac.currentTime + (T - perf()) / 1000);
      const v = level();
      gain.gain.setValueAtTime(on ? 0 : v, at);
      gain.gain.linearRampToValueAtTime(on ? v : 0, at + 0.004); // fronts adoucis : pas de « clic »
    }
    function ledAt(T, on) { win.setTimeout(() => led.classList.toggle('on', on), Math.max(0, T - perf())); }

    // ------------------------------------------------------------------ envoi vers le TRX (rafales)
    const TX = { b: Math.floor(Math.random() * 1e6), on: false, start: 0, last: 0, pend: [], hb: null, said: 0, flushQ: false };
    const idleMs = () => Math.max(1500, 14 * 1200 / S.wpm);
    function flush() {
      TX.flushQ = false;
      if (!TX.on) return;
      api.send({ t: 'cwk', b: TX.b, e: TX.pend, h: r1(perf() - TX.start), wpm: S.wpm });
      TX.pend = [];
    }
    function burstEnd() {
      if (!TX.on) return;
      flush();
      api.send({ t: 'cwk', b: TX.b, e: [], h: r1(perf() - TX.start), end: true });
      TX.on = false;
      win.clearInterval(TX.hb);
      TX.hb = null;
    }
    function edge(T, v) {
      tone(T, v);
      ledAt(T, !!v);
      if (!S.armed || !api) return;
      if (!api.iControl()) {
        if (v && Date.now() - TX.said > 8000) { TX.said = Date.now(); api.say('Clé CW : prenez la main pour émettre (sinon : entraînement, écoute locale seule).', 'warn', 5000); }
        return;
      }
      if (!TX.on) {
        if (!v) return;
        TX.on = true;
        TX.b++;
        TX.start = T;
        TX.last = T;
        TX.hb = win.setInterval(beat, 100);
      }
      TX.pend.push([r1(T - TX.start), v ? 1 : 0]);
      if (T > TX.last) TX.last = T;
      if (!TX.flushQ) { TX.flushQ = true; win.setTimeout(flush, 0); }
    }
    // Battement toutes les 100 ms : la page Station sait que la liaison tient (sinon elle relâche la clé) ; fin de rafale après une pause
    function beat() {
      if (!TX.on) return;
      const now = perf();
      if (!S.armed || !api.iControl()) return burstEnd();
      if (!K.busy && !K.down && now > TX.last + idleMs()) return burstEnd();
      if (!TX.pend.length) api.send({ t: 'cwk', b: TX.b, e: [], h: r1(now - TX.start) });
    }

    // ------------------------------------------------------------------ keyer
    const K = { dit: false, dah: false, memDit: false, memDah: false, busy: false, cur: null, last: null, tNext: 0, timer: null, down: false };
    function timing() {
      const u = 1200 / Math.max(5, Math.min(50, S.wpm));
      const x = u * (Math.max(30, Math.min(70, S.weight)) - 50) / 50;
      return { dit: u + x, dah: 3 * u + x, sp: u - x };
    }
    function decide() {
      K.timer = null;
      const now = perf();
      const dit = K.dit || K.memDit;
      const dah = K.dah || K.memDah;
      let next = null;
      if (K.last === 'dit') next = dah ? 'dah' : dit ? 'dit' : null;
      else if (K.last === 'dah') next = dit ? 'dit' : dah ? 'dah' : null;
      else next = dit ? 'dit' : dah ? 'dah' : null;
      K.memDit = K.memDah = false;
      if (!next) { K.busy = false; K.cur = K.last = null; return; }
      const tm = timing();
      const T = K.busy && now - K.tNext < 20 ? Math.max(K.tNext, now - 20) : now;
      const len = next === 'dit' ? tm.dit : tm.dah;
      K.busy = true;
      K.cur = K.last = next;
      edge(T, 1);
      edge(T + len, 0);
      K.tNext = T + len + tm.sp;
      // Iambique B : palettes serrées pendant le signe → le signe opposé suit même si on les relâche
      if (S.mode === 'B' && K.dit && K.dah) { if (next === 'dit') K.memDah = true; else K.memDit = true; }
      K.timer = win.setTimeout(decide, Math.max(0, K.tNext - perf()));
    }
    function paddle(which, down) {
      if (S.swap && S.mode !== 'S') which = which === 'dit' ? 'dah' : 'dit';
      audio();
      if (S.mode === 'S') {
        // Pioche : l'une ou l'autre entrée manipule directement
        K[which] = down;
        const d = K.dit || K.dah;
        if (d === K.down) return;
        K.down = d;
        edge(perf(), d ? 1 : 0);
        return;
      }
      if (K[which] === down) return;
      K[which] = down;
      if (!down) return;
      if (K.busy) {
        if (which === 'dit') K.memDit = true; else K.memDah = true;
        if (S.mode === 'B' && K.dit && K.dah) { if (K.cur === 'dit') K.memDah = true; else K.memDit = true; }
        return;
      }
      decide();
    }
    function releaseAll() {
      if (S.mode === 'S' && K.down) { K.down = false; edge(perf(), 0); }
      K.dit = K.dah = K.memDit = K.memDah = false;
    }

    // ------------------------------------------------------------------ entrées
    let learn = null; // champ en cours d'apprentissage (kDit, kDah, mDit, mDah)
    // Nom de la touche tel qu'imprimé sur le clavier de l'opérateur (AZERTY, QWERTY…) quand Chrome le donne
    let layout = null;
    if (navigator.keyboard && navigator.keyboard.getLayoutMap) navigator.keyboard.getLayoutMap().then((m) => { layout = m; paint(); }).catch(() => {});
    const KN = { ControlLeft: 'Ctrl gauche', ControlRight: 'Ctrl droit', ShiftLeft: 'Maj gauche', ShiftRight: 'Maj droite', AltLeft: 'Alt',
      AltRight: 'Alt Gr', Space: 'Espace', Enter: 'Entrée', Tab: 'Tab', CapsLock: 'Verr. maj' };
    function keyName(c) {
      if (KN[c]) return KN[c];
      const l = layout && layout.get(c);
      if (l) return l.toUpperCase();
      return c.replace(/^Key|^Digit/, '').replace('BracketLeft', '[').replace('BracketRight', ']');
    }
    function keyMap(code) {
      if (S.src === 'ctrl') return code === 'ControlLeft' ? 'dit' : code === 'ControlRight' ? 'dah' : null;
      if (S.src === 'keys') return code === S.kDit ? 'dit' : code === S.kDah ? 'dah' : null;
      return null;
    }
    function onKey(e, down) {
      if (learn && learn[0] === 'k' && down) {
        e.preventDefault(); e.stopPropagation();
        if (e.code !== 'Escape') { S[learn] = e.code; save(learn === 'kDit' ? 'kdit' : 'kdah', e.code); }
        learn = null; paint(); return;
      }
      if (e.key === 'Escape' && down && TX.on) {
        // Échap : émission arrêtée ; la rafale en cours est abandonnée
        releaseAll();
        burstEnd();
        api.send({ t: 'cw_stop' });
        return;
      }
      const w = keyMap(e.code);
      // Touches prises seulement quand la clé est affichée (onglet CW visible) : Ctrl ailleurs reste un Ctrl ordinaire
      if (!w || (down && !root.offsetParent)) return; // relâchement toujours pris (pas de palette bloquée)
      e.preventDefault(); e.stopPropagation();
      if (e.repeat) return;
      paddle(w, down);
    }
    win.addEventListener('keydown', (e) => onKey(e, true), true);
    win.addEventListener('keyup', (e) => onKey(e, false), true);
    win.addEventListener('blur', releaseAll);

    // Palettes à l'écran (souris, écran tactile)
    root.querySelectorAll('.cwk-pd').forEach((b) => {
      const p = b.dataset.p;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (x) {} b.classList.add('on'); paddle(p, true); });
      const up = () => { if (!b.classList.contains('on')) return; b.classList.remove('on'); paddle(p, false); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    // Adaptateur MIDI : notes (ou contrôleurs) apprises
    let midi = null;
    function onMidi(ev) {
      const d = ev.data;
      if (!d || d.length < 2) return;
      const st = d[0] & 0xf0;
      let id = null;
      let down = false;
      if (st === 0x90 || st === 0x80) { id = 'n' + d[1]; down = st === 0x90 && (d[2] || 0) > 0; }
      else if (st === 0xb0) { id = 'c' + d[1]; down = (d[2] || 0) >= 64; }
      if (!id) return;
      if (learn && learn[0] === 'm') { if (down) { S[learn] = id; save(learn === 'mDit' ? 'mdit' : 'mdah', id); learn = null; paint(); } return; }
      if (S.src !== 'midi') return;
      if (id === S.mDit) paddle('dit', down);
      else if (id === S.mDah) paddle('dah', down);
    }
    function midiOn() {
      if (midi || !navigator.requestMIDIAccess) { paint(); return; }
      navigator.requestMIDIAccess().then((a) => {
        midi = a;
        const bind = () => { a.inputs.forEach((i) => { i.onmidimessage = onMidi; }); paint(); };
        a.onstatechange = bind;
        bind();
      }).catch(() => { q('.cwk-midi').textContent = 'accès MIDI refusé par le navigateur'; });
    }

    // Câble USB-série : contacts de la clé sur DSR (point) et CTS (trait), DTR et RTS à 1 pour les alimenter
    let port = null;
    let serGen = 0;
    async function serialUse(p) {
      const g = ++serGen;
      try {
        if (port) { try { await port.close(); } catch (e) {} }
        port = p;
        await p.open({ baudRate: 9600 });
        await p.setSignals({ dataTerminalReady: true, requestToSend: true });
        const info = p.getInfo ? p.getInfo() : {};
        q('.cwk-ser').textContent = 'port ouvert' + (info.usbVendorId ? ' (USB ' + info.usbVendorId.toString(16) + ':' + (info.usbProductId || 0).toString(16) + ')' : '');
        let pDit = false;
        let pDah = false;
        while (g === serGen && S.src === 'serial') {
          const sg = await p.getSignals();
          if (g !== serGen) break;
          const a = !!sg.dataSetReady;
          const c = !!sg.clearToSend;
          if (a !== pDit) { pDit = a; paddle('dit', a); }
          if (c !== pDah) { pDah = c; paddle('dah', c); }
          await new Promise((res) => win.setTimeout(res, 1));
        }
      } catch (e) {
        q('.cwk-ser').textContent = 'port série : ' + e.message;
        releaseAll();
      }
    }
    function serialAuto() {
      if (!navigator.serial || port) return;
      navigator.serial.getPorts().then((ps) => { if (ps.length && S.src === 'serial') serialUse(ps[0]); }).catch(() => {});
    }

    // ------------------------------------------------------------------ réglages
    function paint() {
      armBtn.querySelector('b').textContent = S.armed ? 'ON' : 'OFF';
      armBtn.classList.toggle('on', S.armed);
      const srcTxt = { ctrl: 'Ctrl G / D', keys: 'touches ' + keyName(S.kDit) + ' / ' + keyName(S.kDah), midi: 'MIDI', serial: 'port série', screen: 'écran' }[S.src] || '';
      q('.cwk-sum').textContent = (S.mode === 'S' ? 'Pioche' : 'Iambique ' + S.mode) + (S.mode === 'S' ? '' : ' · ' + S.wpm + ' mots/min') + ' · ' + srcTxt + (S.armed ? '' : ' · entraînement');
      set.querySelectorAll('[data-k]').forEach((el) => {
        const v = S[el.dataset.k];
        if (el.type === 'checkbox') el.checked = !!v; else if (doc.activeElement !== el) el.value = String(v);
      });
      set.querySelectorAll('.cwk-src').forEach((el) => { el.hidden = el.dataset.s !== S.src; });
      set.querySelectorAll('[data-learn]').forEach((b) => {
        const k = b.dataset.learn;
        b.textContent = learn === k ? 'appuyez…' : k[0] === 'k' ? keyName(S[k]) : (S[k][0] === 'n' ? 'note ' : 'ctrl ') + S[k].slice(1);
        b.classList.toggle('on', learn === k);
      });
      if (S.src === 'midi') {
        const n = midi ? midi.inputs.size : 0;
        q('.cwk-midi').textContent = !navigator.requestMIDIAccess ? 'MIDI non disponible dans ce navigateur' : n ? n + ' appareil(s) MIDI' : 'aucun appareil MIDI branché';
      }
      if (S.src === 'serial' && !navigator.serial) q('.cwk-ser').textContent = 'port série non disponible dans ce navigateur (Chrome ou Edge)';
    }
    set.addEventListener('change', (e) => {
      const el = e.target;
      const k = el.dataset && el.dataset.k;
      if (!k) return;
      if (el.type === 'checkbox') S[k] = el.checked;
      else if (el.tagName === 'SELECT') S[k] = el.value;
      else S[k] = Number(el.value);
      if (k === 'sink') S[k] = el.value;
      if (k === 'wpm') S.wpm = Math.max(5, Math.min(50, Math.round(S.wpm) || 22));
      if (k === 'weight') S.weight = Math.max(30, Math.min(70, Math.round(S.weight) || 50));
      if (k === 'sink') sinkApply();
      if (k === 'tone') { S.tone = Math.max(300, Math.min(1200, S.tone || 600)); if (osc) osc.frequency.value = S.tone; }
      save(k, el.type === 'checkbox' ? (S[k] ? '1' : '0') : S[k]);
      releaseAll();
      if (k === 'src') { serGen++; if (S.src === 'midi') midiOn(); if (S.src === 'serial') serialAuto(); }
      paint();
    });
    set.querySelector('[data-k="vol"]').addEventListener('input', (e) => { S.vol = Number(e.target.value); save('vol', S.vol); });
    set.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.learn) { learn = learn === b.dataset.learn ? null : b.dataset.learn; if (learn && learn[0] === 'm') midiOn(); paint(); }
      if (b.dataset.a === 'serial') {
        if (!navigator.serial) return paint();
        navigator.serial.requestPort().then(serialUse).catch(() => {});
      }
    });
    q('.cwk-cfg').addEventListener('click', () => {
      set.hidden = !set.hidden;
      q('.cwk-cfg').setAttribute('aria-expanded', String(!set.hidden));
      if (!set.hidden) sinkList();
      paint();
    });
    armBtn.addEventListener('click', () => {
      audio();
      S.armed = !S.armed;
      if (!S.armed) burstEnd();
      else if (!api.iControl()) api.say('Clé CW : prenez la main pour que votre clé manipule le TRX.', 'warn', 5000);
      paint();
    });
    // Voyant TX : le TRX du club émet la manipulation de la clé
    win.setInterval(() => {
      const st = api.state && api.state();
      const x = st && st.cw;
      txLed.classList.toggle('on', !!(x && x.live && x.state === 'tx'));
    }, 250);

    if (S.src === 'midi') midiOn();
    if (S.src === 'serial') serialAuto();
    paint();
    return { release: releaseAll, stop: burstEnd };
  }

  window.RSPADDLE = { mount };
})();
