/*
 * Page « Poste CW » (cw.html), dans l'esprit du W1VE Keyer Suite : clé de l'opérateur (public/js/paddle.js) en grand,
 * macros CW, texte à émettre, réception CW décodée, état de la liaison. Elle utilise la connexion du dashboard qui
 * l'a ouverte (window.opener.RSHOST, comme la fenêtre des modes numériques) : mêmes sécurités, même main.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  // Mêmes réglages que l'onglet CW du dashboard (clé, vitesse des macros)
  const store = {
    get(k, d) { try { const v = localStorage.getItem('rs.dg.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rs.dg.' + k, String(v)); } catch (e) {} }
  };
  let hostWin = null;
  let host = null;
  let untap = null;
  let pad = null;
  let rtt = null;

  const toast = (msg, level, ms) => {
    const el = $('cwpToast');
    el.textContent = msg || '';
    el.className = 'dg-toast ' + (level || '');
    if (msg) { void el.offsetWidth; el.classList.add('blink'); }
    clearTimeout(toast.t);
    if (msg) toast.t = setTimeout(() => { el.textContent = ''; }, Math.max(6000, Number(ms) || 0));
  };
  const api = {
    send: (m) => { try { if (host) host.api.send(m); } catch (e) {} },
    iControl: () => { try { return !!(host && host.api.iControl()); } catch (e) { return false; } },
    state: () => { try { return host ? host.api.state() : null; } catch (e) { return null; } },
    say: toast
  };
  function kit() {
    try { const d = (hostWin.DG && hostWin.DG()) || hostWin.RSDIGI; return (d && d.cwKit) || null; } catch (e) { return null; }
  }
  // Fenêtres du dashboard (et fenêtre séparée des modes numériques) : leur clé se met en veille tant que cette page est ouverte
  function chain() {
    const out = [];
    let w = window.opener;
    for (let i = 0; i < 4 && w; i++) {
      try { if (w.closed) break; out.push(w); w = w.opener; } catch (e) { break; }
    }
    return out;
  }
  function suspendOthers(on) {
    for (const w of chain()) { try { if (w.RSPADDLE) w.RSPADDLE.suspended = on; } catch (e) {} }
  }

  // ------------------------------------------------------------------ réception CW (+ texte manipulé à la clé)
  const rx = $('cwpRx');
  let keyLine = null;
  function follow(atEnd) {
    if (atEnd || Date.now() - (Number(rx.dataset.hold) || 0) > 10000) rx.scrollTop = rx.scrollHeight;
  }
  function rxAppend(text) {
    if (!text) return;
    const atEnd = rx.scrollHeight - rx.scrollTop - rx.clientHeight < 30;
    rx.appendChild(document.createTextNode(text));
    let len = rx.textContent.length;
    while (len > 12000 && rx.firstChild) { len -= rx.firstChild.textContent.length; rx.removeChild(rx.firstChild); }
    follow(atEnd);
  }
  function echo(t, practice) {
    if (keyLine && keyLine.isConnected && keyLine.dataset.practice !== (practice ? '1' : '')) keyLine = null;
    if (!keyLine || !keyLine.isConnected) {
      const sp = document.createElement('span');
      sp.className = practice ? 'rt-txline cwk-practice' : 'rt-txline';
      keyLine = document.createElement('span');
      keyLine.className = 'rt-done';
      keyLine.dataset.practice = practice ? '1' : '';
      if (practice) keyLine.textContent = '(entraînement) ';
      sp.append('\n', keyLine, '\n');
      rx.appendChild(sp);
    }
    keyLine.textContent += t;
    follow(true);
  }
  rx.addEventListener('wheel', () => { rx.dataset.hold = String(Date.now()); }, { passive: true });
  rx.addEventListener('pointerdown', (e) => { if (e.offsetX > rx.clientWidth) rx.dataset.hold = String(Date.now()); });
  $('cwpClear').addEventListener('click', () => { rx.textContent = ''; keyLine = null; });

  function onMsg(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'cw' && m.ch !== 1) rxAppend(m.text || '');
    else if (m.t === 'notice' && m.msg) toast(m.msg, m.level === 'error' ? 'warn' : '', 6000); // refus, fin d'émission…
    else if (m.t === 'pong' && Number.isFinite(m.ts)) {
      const r = Date.now() - m.ts;
      if (r >= 0 && r < 10000) rtt = rtt == null ? r : Math.round(rtt * 0.7 + r * 0.3);
    }
  }

  // ------------------------------------------------------------------ macros (habituelles et contest)
  const macSig = {};
  function drawMacroBox(boxId, set) {
    const k = kit();
    const box = $(boxId);
    const list = k ? k.macros(set) : [];
    const fkeys = (set === 'CWC') === !!(k && k.contest()); // les touches F1–F12 vont à ce jeu de macros
    const sig = JSON.stringify(list) + fkeys;
    if (sig === macSig[boxId]) return;
    macSig[boxId] = sig;
    box.textContent = '';
    list.forEach((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cwp-macro' + (m.tx ? ' tx' : '') + (set === 'CWC' ? ' ctst' : '');
      b.innerHTML = '<small></small><span></span>';
      b.querySelector('small').textContent = fkeys ? 'F' + (m.i + 1) : '';
      b.querySelector('span').textContent = m.name;
      b.title = m.preview + '\n' + (m.tx ? 'clic : émission immédiate' : m.log ? 'clic : fiche du QSO' : 'clic : ajouter au texte') + ' · clic droit : modifier';
      b.addEventListener('click', () => useMacro(m.i, set));
      b.addEventListener('mouseenter', () => { clearTimeout(b._p); b._p = setTimeout(() => { const kk = kit(); if (kk) kk.prep(m.i, set); }, 120); });
      b.addEventListener('mouseleave', () => clearTimeout(b._p));
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); const kk = kit(); if (kk) kk.editSet(document, set, m.i); });
      box.appendChild(b);
    });
    const ed = document.createElement('button');
    ed.type = 'button';
    ed.className = 'cwp-macro cwp-edit';
    ed.textContent = '✎ Éditer';
    ed.addEventListener('click', () => { const kk = kit(); if (kk) kk.editSet(document, set, 0); });
    box.appendChild(ed);
  }
  function drawMacros() {
    const k = kit();
    const on = !!(k && k.contest());
    $('cwpCMacros').hidden = !on;
    $('cwpMacHint').textContent = on ? 'au clic (F1 à F12 : macros contest) · clic droit ou ✎ : modifier' : 'F1 à F12 · clic droit ou ✎ : modifier';
    drawMacroBox('cwpMacros', 'CW');
    if (on) drawMacroBox('cwpCMacros', 'CWC');
  }
  function useMacro(i, set) {
    const k = kit();
    if (!k) return toast('Dashboard non raccroché : rouvrez cette page depuis l’onglet CW.', 'warn');
    const r = k.use(i, set, document);
    if (typeof r === 'string' && r) { const t = $('cwpTxt'); t.value += r; t.focus(); }
  }

  // ------------------------------------------------------------------ contest CW
  function ctstInit() {
    const k = kit();
    const sel = $('cwpCtst');
    if (!k || sel.options.length > 1) return;
    for (const c of k.contests()) sel.add(new Option(c.name, c.id));
  }
  function ctstDraw() {
    const k = kit();
    if (!k) return;
    ctstInit();
    const id = k.contest();
    const sel = $('cwpCtst');
    if (document.activeElement !== sel) sel.value = id;
    const set = (el, v) => { if (document.activeElement !== el && el.value !== v) el.value = v; };
    set($('cwpExch'), id ? k.exch() : '');
    $('cwpExch').disabled = !id;
    $('cwpExchSh').textContent = id ? '→ ' + k.exchShown() : '';
    set($('cwpNr'), String(k.serial()).padStart(3, '0'));
    const z = k.zones();
    set($('cwpCqz'), z.cqz);
    set($('cwpItu'), z.itu);
    set($('cwpName'), z.name);
    document.body.classList.toggle('cwp-inctst', !!id);
  }
  $('cwpCtst').addEventListener('change', () => {
    const k = kit();
    if (!k) return;
    k.setContest($('cwpCtst').value);
    macSig.cwpMacros = macSig.cwpCMacros = '';
    ctstDraw();
    drawMacros();
    if ($('cwpCtst').value) toast('Contest ' + $('cwpCtst').selectedOptions[0].text + ' : touches F1 à F12 = macros contest, échange « ' + k.exchShown() + ' ».', '', 5000);
  });
  $('cwpExch').addEventListener('change', () => { const k = kit(); if (k) { k.setExch($('cwpExch').value); macSig.cwpCMacros = ''; ctstDraw(); } });
  $('cwpNr').addEventListener('change', () => { const k = kit(); if (k) { k.setSerial($('cwpNr').value); ctstDraw(); } });
  $('cwpNrM').addEventListener('click', () => { const k = kit(); if (k) { k.setSerial(k.serial() - 1); ctstDraw(); } });
  $('cwpNrP').addEventListener('click', () => { const k = kit(); if (k) { k.setSerial(k.serial() + 1); ctstDraw(); } });
  for (const [id, key] of [['cwpCqz', 'cqz'], ['cwpItu', 'itu'], ['cwpName', 'name']]) {
    $(id).addEventListener('change', () => { const k = kit(); if (k) { k.setZones({ [key]: $(id).value }); macSig.cwpCMacros = ''; ctstDraw(); } });
  }
  function sendText() {
    const t = $('cwpTxt');
    const v = t.value.trim();
    if (!v) return;
    const k = kit();
    if (!k) return;
    k.send(v);
    t.value = '';
  }
  $('cwpSend').addEventListener('click', sendText);
  $('cwpTxt').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendText(); } });
  $('cwpStop').addEventListener('click', () => api.send({ t: 'cw_stop' }));
  $('cwpCall').addEventListener('input', () => { const k = kit(); if (k) k.setCall($('cwpCall').value); });
  document.addEventListener('keydown', (e) => {
    const f = /^F([1-9]|1[0-2])$/.exec(e.key);
    if (f && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const k = kit();
      useMacro(Number(f[1]) - 1, k && k.contest() ? 'CWC' : 'CW');
      return;
    }
    if (e.key === 'Escape') { const s = api.state(); if (s && s.cw) api.send({ t: 'cw_stop' }); }
  });
  $('cwpTake').addEventListener('click', () => api.send({ t: 'take' }));

  // ------------------------------------------------------------------ état (TRX, main, émission, liaison)
  const fmtF = (hz) => {
    if (!hz) return '—';
    const s = String(Math.round(hz)).padStart(7, '0');
    return s.slice(0, -6) + '.' + s.slice(-6, -3) + '.' + s.slice(-3);
  };
  function drawState() {
    const st = api.state();
    const r = (st && st.radio) || {};
    const B = r.vfoSel === 1;
    $('cwpFreq').textContent = fmtF(B ? r.freqB : r.freq);
    const md = (B ? r.modeB : r.mode) || '—';
    $('cwpMode').textContent = md;
    $('cwpMode').classList.toggle('bad', !!st && !/^CW/.test(md));
    const me = api.iControl();
    $('cwpCtl').textContent = !host ? 'dashboard non raccroché' : me ? 'Vous avez la main' : st && st.controller ? 'Main : ' + st.controller : 'Personne n’a la main';
    $('cwpCtl').className = me ? 'ok' : '';
    $('cwpTake').hidden = !host || me || !!(st && st.controller);
    const cw = st && st.cw;
    // Macro ou texte émis : affiché dans la réception, en couleur d'émission (comme sur le dashboard)
    if (cw && !cw.live && cw.id !== drawState.lastId && cw.text) {
      drawState.lastId = cw.id;
      const sp = document.createElement('span');
      sp.className = 'rt-txline';
      sp.textContent = '\n' + cw.text + '\n';
      rx.appendChild(sp);
      keyLine = null;
      follow(true);
    }
    const tx = !!(cw && cw.state === 'tx') || !!(st && st.ptt && st.ptt.active) || !!r.tx;
    const big = $('cwpTx');
    big.textContent = tx ? 'TX' : 'RX';
    big.classList.toggle('on', tx);
    $('cwpTxSt').textContent = 'Émission : ' + (cw ? (cw.live ? 'clé de ' + cw.by : 'macro de ' + cw.by) + (cw.state === 'tx' ? ' (en cours)' : ' (préparation)') : 'aucune');
    $('cwpLink').textContent = 'Liaison : ' + (host ? 'par le dashboard' : 'aucune');
    $('cwpRtt').textContent = 'Aller-retour : ' + (rtt == null ? '—' : rtt + ' ms');
    $('cwpRtt').className = rtt == null ? '' : rtt < 150 ? 'ok' : rtt < 400 ? 'warn' : 'bad';
    const p = pad && pad.get();
    $('cwpKeySt').textContent = 'Clé : ' + (p && p.key ? 'baissée' : 'levée') + (p && p.armed ? '' : ' (entraînement)');
    const k = kit();
    if (k) {
      const c = $('cwpCall');
      if (document.activeElement !== c && c.value !== k.call()) c.value = k.call();
      $('cwpNote').textContent = 'Macros émises par le manipulateur du TRX sous ' + k.myCall() + ' à ' + k.speed() + ' mots/min. Toucher la clé arrête une macro en cours.';
    }
    drawMacros();
    ctstDraw();
  }

  // ------------------------------------------------------------------ raccrochage au dashboard
  function link() {
    const ws = chain();
    const w = ws.find((x) => { try { return !!x.RSHOST; } catch (e) { return false; } }) || null;
    const h = w ? w.RSHOST : null;
    if (h && h !== host) {
      if (untap) try { untap(); } catch (e) {}
      hostWin = w;
      host = h;
      untap = h.tap ? h.tap(onMsg) : null;
      suspendOthers(true);
      $('cwpOrphan').hidden = true;
      api.send({ t: 'ping', ts: Date.now() });
    } else if (!h) {
      host = null;
      hostWin = null;
      $('cwpOrphan').hidden = false;
    } else suspendOthers(true);
  }
  window.addEventListener('pagehide', () => {
    suspendOthers(false);
    if (untap) try { untap(); } catch (e) {}
    if (pad) pad.stop();
  });

  link();
  pad = window.RSPADDLE.mount($('cwpKey'), {
    layout: 'page',
    store,
    api,
    echo,
    echoEnd: () => { keyLine = null; },
    onChange: (k, v) => { if (k === 'wpm') { const kk = kit(); if (kk) kk.setSpeed(v); } }
  });
  // Vitesse : une seule pour la clé et les macros (celle de la clé au départ)
  { const kk = kit(); if (kk && pad) kk.setSpeed(pad.get().wpm); }
  setInterval(link, 1000);
  setInterval(drawState, 250);
  setInterval(() => api.send({ t: 'ping', ts: Date.now() }), 3000);
  drawState();
})();
