/*
 * Page « TRX CW » (cw.html), dans l'esprit du W1VE Keyer Suite : clé de l'opérateur (public/js/paddle.js) en grand,
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
    else if (m.t === 'ctst_list' && m.contest === CL.id) { CL.items = m.items || []; drawLog(); checkDupe(); drawProb(); }
    else if (m.t === 'scp') { PR.q = m.q; PR.list = m.list || []; PR.n = m.n || 0; drawProb(); }
    else if ((m.t === 'log_saved' || m.t === 'log_changed') && CL.id) { clearTimeout(onMsg.lt); onMsg.lt = setTimeout(askList, 400); }
    else if (m.t === 'log_export' && m.tag === 'cwpage') saveFile(m);
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
      b.addEventListener('click', () => (set === 'CWC' ? ctstMacro(m.i) : useMacro(m.i, set)));
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
    $('cwpCtBody').hidden = !on;
    document.querySelector('.cwp-call').hidden = on; // en contest : l'indicatif se tape dans la ligne du log
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
    if ($('cwpName')) set($('cwpName'), z.name);
    document.body.classList.toggle('cwp-inctst', !!id);
    ctstLogSync(id);
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
    if (!$(id)) continue;
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
      if (k && k.contest()) ctstMacro(Number(f[1]) - 1); else useMacro(Number(f[1]) - 1, 'CW');
      return;
    }
    if (e.key === 'Escape') { const s = api.state(); if (s && s.cw) api.send({ t: 'cw_stop' }); }
  });
  $('cwpTake').addEventListener('click', () => api.send({ t: 'take' }));
  // Les deux VFO (SPLIT) : même main et mêmes commandes que le dashboard
  if (window.RSVFOBOX) window.RSVFOBOX.mount($('cwpVfo'), { api, toast });
  // Carte de bande à gauche : spots CW de la bande du TRX ; clic = indicatif + TRX sur la fréquence du spot (avec la main)
  if (window.RSBMAP) setTimeout(() => window.RSBMAP.mount($('xBm'), { api, kit, mode: 'CW',
    worked: (call, band) => (CL.id && CL.items.some((q) => q.call === call && q.band === band) ? 'dup' : ''),
    onPick: (call, s) => {
      const k = kit();
      if (k) k.setCall(call);
      if (api.iControl() && host && host.api.setFreq) {
        try { host.api.setFreq(Math.round(s.f * 1000)); setTimeout(() => { try { if (hostWin.RSDIGI) hostWin.RSDIGI.modeFor('cw'); } catch (e) {} }, 500); } catch (e) {}
      } else if (!api.iControl()) toast('Indicatif repris ; prenez la main pour aller sur sa fréquence.', 'warn', 4000);
    } }), 0);
  // TX CALL : indicatif d'émission (et des QSO enregistrés), comme dans la page TRX DIGI ; avec la main
  function drawTxCall() {
    const sel = $('cwpTxCall');
    const k = kit();
    const st = api.state();
    const opts = k && k.txCalls ? k.txCalls() : [];
    const cur = String((st && st.txCall) || opts[0] || '').toUpperCase();
    const all = opts.indexOf(cur) < 0 && cur ? opts.concat(cur) : opts;
    if (sel.dataset.opts !== all.join(',')) {
      sel.dataset.opts = all.join(',');
      sel.textContent = '';
      for (const c of all) sel.add(new Option(k && k.isClubCall && k.isClubCall(c) ? c + ' (station)' : c, c));
    }
    if (document.activeElement !== sel && sel.value !== cur) sel.value = cur;
    const me = api.iControl();
    sel.disabled = !me || all.length < 2;
    sel.parentElement.title = me ? 'TX CALL : indicatif sous lequel on émet et sous lequel les QSO vont dans le carnet (exports ADIF / Cabrillo)' : 'TX CALL : prenez la main pour le changer';
  }
  $('cwpTxCall').addEventListener('change', () => {
    const k = kit();
    const v = $('cwpTxCall').value;
    if (!k || !k.setTxCall || !k.setTxCall(v)) { toast('Prenez d’abord la main pour choisir le TX call.', 'warn'); drawTxCall(); return; }
    toast('TX call : ' + v + ' (émission et QSO enregistrés).', '', 4000);
  });
  setInterval(drawTxCall, 500);

  // ------------------------------------------------------------------ log du contest (à la manière de N1MM)
  // Les QSO vont dans le carnet général (identifiant du contest, échanges envoyé / reçu) ; la page relit ceux du
  // contest pour les doublons, les compteurs et la liste, et en tire le fichier Cabrillo.
  const CL = { id: '', items: [], esm: 'run', sentFor: '', sent: '' };
  const E = { call: $('cwpECall'), rs: $('cwpERs'), stx: $('cwpEStx'), rr: $('cwpERr'), srx: $('cwpESrx') };
  const BANDS = [[1.8, 2, '160m'], [3.5, 4, '80m'], [5.3, 5.5, '60m'], [7, 7.3, '40m'], [10.1, 10.15, '30m'], [14, 14.35, '20m'], [18.068, 18.168, '17m'],
    [21, 21.45, '15m'], [24.89, 24.99, '12m'], [28, 29.7, '10m'], [50, 54, '6m'], [144, 146, '2m'], [430, 440, '70cm']];
  const bandOf = (mhz) => { const b = BANDS.find((x) => mhz >= x[0] && mhz <= x[1]); return b ? b[2] : ''; };
  const ymd = (d) => d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
  function trxMhz() {
    const st = api.state();
    const r = (st && st.radio) || {};
    return (Number(r.vfoSel === 1 ? r.freqB : r.freq) || 0) / 1e6;
  }
  const stripRst = (x) => String(x || '').toUpperCase().replace(/^(5NN|599|ENN|5NT)\s+/, '').replace(/\b5NN\b/g, '599').trim();
  function fromKey() { return 'rs.dg.cwcfrom_' + CL.id; }
  function fromDate() {
    let v = '';
    try { v = localStorage.getItem(fromKey()) || ''; } catch (e) {}
    if (!/^\d{8}$/.test(v)) v = ymd(new Date(Date.now() - 3 * 86400000)); // contest de 48 h au plus : les 3 derniers jours
    return v;
  }
  function askList() { if (CL.id) api.send({ t: 'ctst_list', contest: CL.id, from: fromDate() }); }
  function ctstLogSync(id) {
    if (id === CL.id) return;
    CL.id = id;
    CL.items = [];
    const f = fromDate();
    $('cwpFrom').value = f.slice(0, 4) + '-' + f.slice(4, 6) + '-' + f.slice(6, 8);
    drawLog();
    askList();
  }
  function dupeOf(call, band) { return CL.items.filter((q) => q.call === call && q.band === band); }
  function checkDupe() {
    const call = E.call.value.trim().toUpperCase();
    const el = $('cwpDupe');
    if (!call || call.length < 3) { el.textContent = ''; el.className = 'cwp-dupe'; return false; }
    const band = bandOf(trxMhz());
    const d = dupeOf(call, band);
    const other = CL.items.filter((q) => q.call === call && q.band !== band).map((q) => q.band);
    // Seulement les doublons : « DUPE » clignotant (rien d'affiché = QSO valable)
    el.textContent = d.length ? 'DUPE' : '';
    el.title = d.length ? call + ' déjà contacté sur ' + band + ' à ' + d[d.length - 1].t.slice(0, 2) + ':' + d[d.length - 1].t.slice(2, 4) + ' UTC' + (other.length ? ' (aussi sur ' + Array.from(new Set(other)).join(', ') + ')' : '') : '';
    el.className = 'cwp-dupe' + (d.length ? ' dup' : '');
    return d.length > 0;
  }
  function drawLog() {
    const tb = $('cwpCLog');
    tb.textContent = '';
    const last = CL.items.slice(-60).reverse();
    for (const q of last) {
      const tr = document.createElement('tr');
      for (const v of [q.t.slice(0, 2) + ':' + q.t.slice(2, 4), q.band, q.call, q.stx, q.srx]) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
      tb.appendChild(tr);
    }
    const per = {};
    const seen = new Set();
    let dup = 0;
    for (const q of CL.items) { const k = q.call + '|' + q.band; if (seen.has(k)) dup++; else { seen.add(k); per[q.band] = (per[q.band] || 0) + 1; } }
    const now = Date.now();
    const t = (q) => Date.UTC(+q.d.slice(0, 4), +q.d.slice(4, 6) - 1, +q.d.slice(6, 8), +q.t.slice(0, 2), +q.t.slice(2, 4), +(q.t.slice(4, 6) || 0));
    const r10 = CL.items.filter((q) => now - t(q) < 600000).length;
    const r60 = CL.items.filter((q) => now - t(q) < 3600000).length;
    $('cwpCStats').innerHTML = '<b>' + CL.items.length + '</b> QSO' + (dup ? ' · <span class="dup">' + dup + ' doublon(s)</span>' : '') +
      ' · ' + (Object.keys(per).map((b) => b + ' ' + per[b]).join(' · ') || '—') + ' · cadence <b>' + (r10 * 6) + '</b>/h (10 min), <b>' + r60 + '</b>/h';
  }
  function wipe() {
    for (const k of ['call', 'stx', 'srx']) E[k].value = '';
    CL.sentFor = '';
    const k = kit();
    if (k) k.setCall('');
    drawState.kc = '';
    checkDupe();
    askScp();
    E.call.focus();
  }
  // ------------------------------------------------------------------ indicatifs probables (Super Check Partial + spots CW), comme la page TRX SSB
  const PR = { q: '', list: [], n: 0, asked: '' };
  const CW_SEG = { '160m': [1810, 1850], '80m': [3500, 3600], '40m': [7000, 7040], '30m': [10100, 10140], '20m': [14000, 14070], '17m': [18068, 18095],
    '15m': [21000, 21070], '12m': [24890, 24915], '10m': [28000, 28070], '6m': [50000, 50100] };
  function askScp() {
    const q = E.call.value.trim().toUpperCase();
    if (q.length < 2) { PR.q = ''; PR.list = []; PR.asked = ''; return drawProb(); }
    if (q === PR.asked) return;
    PR.asked = q;
    clearTimeout(askScp.t);
    askScp.t = setTimeout(() => api.send({ t: 'scp', q, n: 40 }), 120);
  }
  function pickCall(call, spot) {
    E.call.value = call;
    const k = kit();
    if (k) k.setCall(call);
    drawState.kc = call;
    checkDupe();
    askScp();
    // Spot cliqué : le TRX va sur sa fréquence (en CW) si vous avez la main
    if (spot && api.iControl() && host && host.api.setFreq) {
      try { host.api.setFreq(Math.round(spot.f * 1000)); setTimeout(() => { try { if (hostWin.RSDIGI) hostWin.RSDIGI.modeFor('cw'); } catch (e) {} }, 500); } catch (e) {}
    }
    drawProb();
    E.srx.focus();
  }
  function chip(call, cls, sub, title, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ssb-pc ' + cls;
    b.textContent = call;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; b.appendChild(s); }
    b.title = title || '';
    b.addEventListener('click', onClick);
    return b;
  }
  function drawProb() {
    const box = $('cwpPr');
    if (!box || !CL.id) return;
    const band = bandOf(trxMhz());
    const worked = new Set(CL.items.filter((q) => q.band === band).map((q) => q.call));
    const any = new Set(CL.items.map((q) => q.call));
    box.textContent = '';
    const typed = E.call.value.trim().toUpperCase();
    if (typed.length >= 2) {
      $('cwpPrH').textContent = 'Indicatifs probables · « ' + typed + ' »';
      // Déjà dans le log du contest d'abord, puis la liste Super Check Partial
      const mine = Array.from(any).filter((c) => c.indexOf(typed) >= 0);
      const scp = PR.q === typed ? PR.list : [];
      const all = Array.from(new Set(mine.concat(scp))).slice(0, 40);
      for (const c of all) {
        const dup = worked.has(c);
        box.appendChild(chip(c, dup ? 'dup' : any.has(c) ? '' : 'new', dup ? band : any.has(c) ? 'autre bande' : '', dup ? 'Déjà contacté sur ' + band : 'Cliquer : dans la case Indicatif', () => pickCall(c)));
      }
      $('cwpPrNote').textContent = all.length ? 'Vert : pas encore contacté · barré : doublon sur ' + (band || 'cette bande') + '.' : (PR.n ? 'Aucun indicatif connu ne contient « ' + typed + ' ».' : 'Liste Super Check Partial pas encore téléchargée par le serveur.');
      return;
    }
    // Rien de tapé : stations spotées en CW sur la bande du TRX (DX cluster et Reverse Beacon Network), les plus récentes d'abord
    const seg = CW_SEG[band];
    $('cwpPrH').textContent = 'Stations spotées ' + (band ? 'sur ' + band : '') + ' (CW)';
    const k = kit();
    let spots = [];
    try { spots = k && k.spots ? k.spots() : []; } catch (e) { spots = []; }
    spots = spots.filter((s) => seg && s.f >= seg[0] && s.f <= seg[1] && !/\b(FT[248]|RTTY|PSK|JT65|JS8|SSTV|USB|LSB|SSB)\b/i.test(s.cmt || ''))
      .sort((a, b) => b.at - a.at);
    const seen = new Set();
    for (const s of spots) {
      if (seen.has(s.call)) continue;
      seen.add(s.call);
      const dup = worked.has(s.call);
      box.appendChild(chip(s.call, dup ? 'dup' : 'new', s.f.toFixed(1), (dup ? 'Déjà contacté sur ' + band + ' · ' : 'Cliquer : indicatif + TRX sur ') + s.f.toFixed(1) + ' kHz' + (s.cmt ? ' · ' + s.cmt : ''), () => pickCall(s.call, s)));
      if (seen.size >= 60) break;
    }
    $('cwpPrNote').textContent = seen.size ? 'Vert : à contacter · barré : déjà dans le log sur ' + band + '. Tapez le début d’un indicatif : liste Super Check Partial.' : 'Aucun spot CW sur cette bande pour l’instant. Tapez le début d’un indicatif : liste Super Check Partial (indicatifs actifs en contest).';
  }
  setInterval(() => { if (CL.id && E.call.value.trim().length < 2) drawProb(); }, 5000);
  function snapshotSent() {
    const k = kit();
    if (!k) return;
    E.stx.value = stripRst(k.exchShown());
    CL.sentFor = E.call.value.trim().toUpperCase();
  }
  function logEntry() {
    const k = kit();
    if (!k) return false;
    const call = E.call.value.trim().toUpperCase();
    if (!/^(?=.*[0-9])[A-Z0-9/]{3,15}$/.test(call)) { toast('Indicatif du correspondant ?', 'warn'); E.call.focus(); return false; }
    if (!E.srx.value.trim()) { toast('Échange reçu ?', 'warn'); E.srx.focus(); return false; }
    const mhz = trxMhz();
    if (!(mhz > 0)) { toast('Fréquence du TRX inconnue : QSO non enregistré.', 'warn'); return false; }
    if (!E.stx.value.trim() || CL.sentFor !== call) snapshotSent();
    const d = new Date(k.utcNow());
    const hms = String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0') + String(d.getUTCSeconds()).padStart(2, '0');
    const stx = stripRst(E.stx.value);
    const srx = stripRst(E.srx.value);
    const qso = { call, qso_date: ymd(d), time_on: hms, time_off: hms, freq: Math.round(mhz * 1e6) / 1e6, mode: 'CW',
      rst_sent: (E.rs.value.trim() || '599').replace(/N/gi, '9'), rst_rcvd: (E.rr.value.trim() || '599').replace(/N/gi, '9'),
      contest_id: CL.id, stx_string: stx, srx_string: srx, station: k.myCall() };
    if (/^\d{1,5}$/.test(stx)) qso.stx = stx;
    if (/^\d{1,5}$/.test(srx)) qso.srx = srx;
    api.send({ t: 'log_add', qso, force: true, spot: !!(window.RSSPOT && RSSPOT.on()) }); // doublons du contest : signalés ici (N1MM les garde aussi, à 0 point)
    // Affiché tout de suite ; la liste est relue quand le serveur confirme
    CL.items.push({ call, band: bandOf(mhz), mode: 'CW', d: qso.qso_date, t: hms, stx, srx });
    // N° de série suivant dès que le QSO est enregistré (une fois par correspondant), si l'échange en contient un
    if (/<CNTR>|<SERNO>/i.test(String(k.exch() || ''))) k.afterLog(call);
    drawLog();
    for (const x of ['call', 'stx', 'srx']) E[x].value = '';
    CL.sentFor = '';
    checkDupe();
    return true;
  }
  // Macro contest : celles qui envoient l'échange gardent ce qui a été envoyé ; « Log » enregistre la ligne
  function ctstMacro(i) {
    const k = kit();
    if (!k) return;
    const m = k.macros('CWC')[i];
    if (!m) return;
    if (m.log && !m.tx) { if (logEntry()) E.call.focus(); return; }
    if (m.exch) snapshotSent(); // macro qui envoie l'échange : c'est lui qui sera enregistré
    useMacro(i, 'CWC');
  }
  function esmEnter(from) {
    const call = E.call.value.trim();
    const srx = E.srx.value.trim();
    if (CL.esm === 'run') {
      if (!call) return ctstMacro(0);                             // CQ
      if (!srx) { ctstMacro(1); E.srx.focus(); return; }          // indicatif + échange
      if (logEntry()) { ctstMacro(2); E.call.focus(); }           // TU (+ n° suivant), QSO enregistré
      return;
    }
    if (!call) return toast('Tapez l’indicatif de la station qui appelle CQ.', 'warn');
    if (!srx) { ctstMacro(3); E.srx.focus(); return; }            // votre indicatif
    snapshotSent();
    ctstMacro(5);                                                  // TU + échange
    if (logEntry()) E.call.focus();
  }
  function esmShow() {
    $('cwpRun').classList.toggle('on', CL.esm === 'run');
    $('cwpSp').classList.toggle('on', CL.esm === 'sp');
  }
  const esmSet = (v) => { CL.esm = v; try { localStorage.setItem('rs.dg.cwesm', v); } catch (e) {} esmShow(); E.call.focus(); };
  $('cwpRun').addEventListener('click', () => esmSet('run'));
  $('cwpSp').addEventListener('click', () => esmSet('sp'));
  try { if (localStorage.getItem('rs.dg.cwesm') === 'sp') CL.esm = 'sp'; } catch (e) {}
  esmShow();
  for (const key of Object.keys(E)) {
    E[key].addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); esmEnter(key); }
      else if (e.key === ' ' && key === 'call') { e.preventDefault(); E.srx.focus(); }
      else if (e.key === ' ' && key === 'srx' && !E.srx.value.trim()) { e.preventDefault(); E.call.focus(); }
      else if ((e.key === 'w' || e.key === 'W') && e.altKey) { e.preventDefault(); wipe(); }
    });
  }
  E.call.addEventListener('input', () => {
    E.call.value = E.call.value.toUpperCase().replace(/[^A-Z0-9/?]/g, '');
    const k = kit();
    if (k) k.setCall(E.call.value);
    drawState.kc = E.call.value.trim().toUpperCase(); // tapé ici : pas à recopier depuis le dashboard
    checkDupe();
    askScp();
  });
  E.srx.addEventListener('input', () => { E.srx.value = E.srx.value.toUpperCase(); });
  E.rs.value = E.rr.value = '599';
  $('cwpELog').addEventListener('click', () => { if (logEntry()) E.call.focus(); });
  $('cwpEWipe').addEventListener('click', wipe);
  document.addEventListener('keydown', (e) => { if ((e.key === 'w' || e.key === 'W') && e.altKey && CL.id) { e.preventDefault(); wipe(); } });
  $('cwpFrom').addEventListener('change', () => {
    const v = $('cwpFrom').value.replace(/\D/g, '');
    try { if (/^\d{8}$/.test(v)) localStorage.setItem(fromKey(), v); } catch (e) {}
    askList();
  });
  $('cwpCab').addEventListener('click', () => {
    const k = kit();
    if (!k || !CL.id) return;
    const f = fromDate();
    api.send({ t: 'log_export', fmt: 'cabrillo', callsign: k.myCall(), mine: true, contest: CL.id, contestOnly: true, from: f.slice(0, 4) + '-' + f.slice(4, 6) + '-' + f.slice(6, 8), tag: 'cwpage' });
  });
  $('cwpAdi').addEventListener('click', () => {
    const k = kit();
    if (!k || !CL.id) return;
    const f = fromDate();
    api.send({ t: 'log_export', fmt: 'adif', callsign: k.myCall(), mine: true, contest: CL.id, contestOnly: true, from: f.slice(0, 4) + '-' + f.slice(4, 6) + '-' + f.slice(6, 8), tag: 'cwpage' });
  });
  function saveFile(m) {
    const blob = new Blob([m.data], { type: (m.mime || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast(m.count + ' QSO dans ' + m.name + (/\.adi$/.test(m.name) ? ' (ADIF).' : ' (Cabrillo).'), '', 5000);
  }

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
    $('cwpTxc').textContent = st && st.txCall ? String(st.txCall).toUpperCase() + ' ' : '';
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
      // Indicatif choisi ailleurs (spot CW cliqué dans une BAND MAP, double-clic dans la réception…) : aussi dans la
      // ligne de saisie du log du contest, prête pour Entrée
      const kc = String(k.call() || '').toUpperCase();
      if (kc !== drawState.kc) {
        const was = drawState.kc;
        drawState.kc = kc;
        if (was !== undefined && kc && E.call.value.trim().toUpperCase() !== kc) {
          E.call.value = kc;
          E.srx.value = '';
          CL.sentFor = '';
          checkDupe();
          if (k.contest()) { try { window.focus(); } catch (e) {} E.call.focus(); }
        }
      }
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
  // Signal « page CW ouverte » (localStorage) : le dashboard / la page des modes numériques demandent alors le décodage CW
  const alive = () => { try { localStorage.setItem('rs.dg.cwpageAt', String(Date.now())); } catch (e) {} };
  alive();
  setInterval(alive, 1000);
  window.addEventListener('pagehide', () => {
    try { localStorage.removeItem('rs.dg.cwpageAt'); } catch (e) {}
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
