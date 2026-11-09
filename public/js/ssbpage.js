/*
 * Page « TRX SSB » (ssb.html) : contests en phonie. Choix du contest (public/js/contests.js) et de la catégorie
 * (en-tête Cabrillo), échange à annoncer avec le n° de série, log du contest à la manière de N1MM (doublons,
 * compteurs, cadence), mémoires vocales T1 à T8 (VOICE TX), fichier Cabrillo. Les QSO vont dans le carnet général.
 * Même connexion que le dashboard qui l'a ouverte (window.opener.RSHOST), comme le TRX CW.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('rs.dg.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rs.dg.' + k, String(v)); } catch (e) {} }
  };
  const C = window.RSCONTESTS || { SSB: [], BANDS: ['ALL'] };
  let hostWin = null;
  let host = null;
  let untap = null;

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
    state: () => { try { return host ? host.api.state() : null; } catch (e) { return null; } }
  };
  function kit() { try { const d = (hostWin.DG && hostWin.DG()) || hostWin.RSDIGI; return (d && d.cwKit) || null; } catch (e) { return null; } }
  function chain() {
    const out = [];
    let w = window.opener;
    for (let i = 0; i < 4 && w; i++) { try { if (w.closed) break; out.push(w); w = w.opener; } catch (e) { break; } }
    return out;
  }

  // ------------------------------------------------------------------ contest, catégorie, échange
  const S = { id: LS.get('ssbc', ''), vm: null, playing: null };
  const def = () => C.SSB.find((c) => c.id === S.id) || null;
  const catKey = () => 'ssbcat_' + S.id;
  function catState() {
    let o = {};
    try { o = JSON.parse(LS.get(catKey(), '{}')) || {}; } catch (e) { o = {}; }
    return o;
  }
  function saveCat(o) { LS.set(catKey(), JSON.stringify(o)); }
  const exchTpl = () => { const d = def(); return LS.get('ssbx_' + S.id, d ? d.exch : '59 <CNTR>'); };
  function exchShown() {
    const k = kit();
    const z = k ? k.zones() : { cqz: '14', itu: '27', name: '' };
    const n = k ? k.serial() : 1;
    return exchTpl().replace(/<CNTR>|<SERNO>/g, String(n).padStart(3, '0')).replace(/<CQZ>/g, String(z.cqz).padStart(2, '0'))
      .replace(/<ITUZ>/g, String(z.itu).padStart(2, '0')).replace(/<MYNAME>/g, String(z.name || 'NOM').toUpperCase()).toUpperCase();
  }
  function fillContests() {
    const sel = $('ssCtst');
    for (const c of C.SSB) sel.add(new Option(c.name + (c.verif ? '' : ' *'), c.id));
    sel.value = S.id;
    const bs = $('ssBand');
    for (const b of C.BANDS) bs.add(new Option(b === 'ALL' ? 'toutes' : b.toLowerCase(), b));
  }
  // Catégorie Cabrillo : valeurs de la catégorie choisie, puissance / bande / assistance / overlay de la page
  function cabCat() {
    const d = def();
    if (!d) return null;
    const st = catState();
    const c = d.cat.find((x) => x[0] === st.k) || d.cat[0];
    const v = Object.assign({}, c[2]);
    if (!v.POWER && v.OPERATOR !== 'CHECKLOG') v.POWER = st.pw || 'LOW';
    if (d.bands && v.OPERATOR === 'SINGLE-OP') v.BAND = st.band || 'ALL'; else if (v.OPERATOR !== 'CHECKLOG') v.BAND = 'ALL';
    if (d.assisted && v.OPERATOR === 'SINGLE-OP' && !v.ASSISTED) v.ASSISTED = st.ass ? 'ASSISTED' : 'NON-ASSISTED';
    if (!v.MODE) v.MODE = d.mode || 'SSB';
    if (st.ov && (d.overlays || []).indexOf(st.ov) >= 0 && v.OPERATOR === 'SINGLE-OP') v.OVERLAY = st.ov;
    return v;
  }
  function drawContest() {
    const d = def();
    const k = kit();
    document.body.classList.toggle('cwp-inctst', !!d);
    $('cwpCtBody').hidden = !d;
    // Pas de contest : la fiche du carnet pour noter les QSO à la main
    const qb = $('ssQso');
    if (qb.hidden !== !!d) { qb.hidden = !!d; if (!d && LOG && LOG.mounted) LOG.show(); if (!d) askSsb(); }
    const cs = $('ssCat');
    cs.textContent = '';
    const st = catState();
    if (d) for (const c of d.cat) cs.add(new Option(c[1], c[0]));
    if (d) cs.value = d.cat.some((c) => c[0] === st.k) ? st.k : d.cat[0][0];
    const cur = d ? d.cat.find((c) => c[0] === cs.value) : null;
    const so = cur && cur[2].OPERATOR === 'SINGLE-OP';
    $('ssPwrW').hidden = !d || !cur || !!cur[2].POWER || cur[2].OPERATOR === 'CHECKLOG';
    $('ssPwr').value = st.pw || 'LOW';
    $('ssBandW').hidden = !d || !d.bands || !so;
    $('ssBand').value = st.band || 'ALL';
    $('ssAssW').hidden = !d || !d.assisted || !so || !!(cur && cur[2].ASSISTED);
    $('ssAss').checked = !!st.ass;
    const ov = $('ssOv');
    ov.length = 1;
    if (d) for (const o of d.overlays || []) ov.add(new Option(o, o));
    $('ssOvW').hidden = !d || !(d.overlays || []).length || !so;
    ov.value = st.ov || '';
    const r = $('ssRules');
    r.hidden = !d || !d.url;
    if (d && d.url) r.href = d.url;
    const ex = $('ssExch');
    if (document.activeElement !== ex) ex.value = d ? exchTpl() : '';
    ex.disabled = !d;
    $('ssExchSh').textContent = d ? '→ ' + exchShown() : '';
    fillStx(false);
    $('ssNote').textContent = d ? (d.when ? d.when + ' · ' : '') + (d.note || '') + (d.verif ? '' : ' * Catégories habituelles : à vérifier dans le règlement de l’année.') : 'Choisissez un contest.';
    if (k) {
      const set = (el, v) => { if (document.activeElement !== el && el.value !== v) el.value = v; };
      set($('ssNr'), String(k.serial()).padStart(3, '0'));
      const z = k.zones();
      set($('ssCqz'), z.cqz);
      set($('ssItu'), z.itu);
      if ($('ssName')) set($('ssName'), z.name);
    }
    logSync(S.id);
  }
  $('ssCtst').addEventListener('change', () => {
    S.id = $('ssCtst').value;
    LS.set('ssbc', S.id);
    drawContest();
    const d = def();
    if (d) toast(d.name + ' : échange « ' + exchShown() + ' ».', '', 5000);
  });
  $('ssCat').addEventListener('change', () => { const o = catState(); o.k = $('ssCat').value; saveCat(o); drawContest(); });
  $('ssPwr').addEventListener('change', () => { const o = catState(); o.pw = $('ssPwr').value; saveCat(o); });
  $('ssBand').addEventListener('change', () => { const o = catState(); o.band = $('ssBand').value; saveCat(o); });
  $('ssAss').addEventListener('change', () => { const o = catState(); o.ass = $('ssAss').checked; saveCat(o); });
  $('ssOv').addEventListener('change', () => { const o = catState(); o.ov = $('ssOv').value; saveCat(o); });
  $('ssExch').addEventListener('change', () => { if (S.id) LS.set('ssbx_' + S.id, $('ssExch').value.toUpperCase().trim() || (def() || {}).exch || '59 <CNTR>'); drawContest(); });
  $('ssNr').addEventListener('change', () => { const k = kit(); if (k) { k.setSerial($('ssNr').value); drawContest(); } });
  $('ssNrM').addEventListener('click', () => { const k = kit(); if (k) { k.setSerial(k.serial() - 1); drawContest(); } });
  $('ssNrP').addEventListener('click', () => { const k = kit(); if (k) { k.setSerial(k.serial() + 1); drawContest(); } });
  for (const [id, key] of [['ssCqz', 'cqz'], ['ssItu', 'itu'], ['ssName', 'name']]) {
    if (!$(id)) continue;
    $(id).addEventListener('change', () => { const k = kit(); if (k) { k.setZones({ [key]: $(id).value }); drawContest(); } });
  }

  // ------------------------------------------------------------------ mémoires vocales (VOICE TX)
  function drawVk() {
    const box = $('ssVk');
    const meta = S.vm;
    const pl = S.playing ? S.playing.n : 0;
    const sig = JSON.stringify(meta) + '|' + pl + '|' + JSON.stringify(S.tts || {});
    if (sig === box.dataset.sig) return;
    box.dataset.sig = sig;
    box.textContent = '';
    for (let n = 1; n <= 8; n++) {
      const t = meta && meta.t && meta.t[n - 1];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cwp-macro ssb-vm' + (t && t.ms ? ' tx' : ' empty') + (pl === n ? ' play' : '');
      b.innerHTML = '<small></small><span></span>';
      b.querySelector('small').textContent = 'F' + n + ' · T' + n + (t && t.ms ? ' · ' + (t.ms / 1000).toFixed(1).replace('.', ',') + ' s' : '');
      b.querySelector('span').textContent = (t && t.name) || (t && t.ms ? 'T' + n : 'vide');
      const tt = S.tts && S.tts[n];
      if (tt) b.classList.add('tts');
      b.title = t && t.ms ? 'Émet la mémoire vocale T' + n + (tt ? ' (message en anglais, ' + tt.call + ')' : '') : 'Mémoire T' + n + ' vide : l’enregistrer sur la face avant (MENU → VOICE → REC) ou « Messages en anglais »';
      b.addEventListener('click', () => playVm(n));
      box.appendChild(b);
    }
  }
  // Messages standard en anglais (fabriqués sur le serveur par espeak-ng, TX call épelé)
  const TTS_DEF = [
    { name: 'CQ TEST', text: 'CQ contest, CQ contest, this is {CALL}, {CALL}, contest.' },
    { name: 'CQ', text: 'CQ, CQ, CQ, this is {CALL}, {CALL}, {CALL}, calling CQ and standing by.' },
    { name: 'TU QRZ', text: 'Thank you, {CALL}, QRZ?' },
    { name: 'MY CALL', text: '{CALL}' },
    { name: 'AGN', text: 'Again please?' },
    { name: 'NR AGN', text: 'Your number again please?' },
    { name: 'QRL?', text: 'Is this frequency in use? This is {CALL}.' },
    { name: '73', text: 'Thank you for the QSO, 73, {CALL} clear.' }
  ];
  function ttsLoad() {
    let o = null;
    try { o = JSON.parse(LS.get('ssbtts', 'null')); } catch (e) { o = null; }
    if (!o || !Array.isArray(o.items) || o.items.length !== 8) o = { items: TTS_DEF.map((x) => Object.assign({ on: true }, x)), voice: 'en-us+f2', speed: 175 };
    return o;
  }
  const TT = ttsLoad();
  const ttsSave = () => LS.set('ssbtts', JSON.stringify(TT));
  const PHON = { A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike',
    N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu' };
  const DIGW = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const txNow = () => { const st = api.state(); return String((st && st.txCall) || '').toUpperCase(); };
  function ttsDraw() {
    const L = $('ssTtsL');
    L.textContent = '';
    TT.items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'ssb-ttsi';
      row.innerHTML = '<label><input type="checkbox"> T' + (i + 1) + '</label><input class="nm" maxlength="16" spellcheck="false"><input class="tx" maxlength="200" spellcheck="false">';
      const [cb, nm, tx] = row.querySelectorAll('input');
      cb.checked = it.on !== false;
      nm.value = it.name;
      tx.value = it.text;
      cb.addEventListener('change', () => { it.on = cb.checked; ttsSave(); });
      nm.addEventListener('input', () => { it.name = nm.value.toUpperCase(); ttsSave(); });
      tx.addEventListener('input', () => { it.text = tx.value; ttsSave(); });
      L.appendChild(row);
    });
    $('ssTtsV').value = TT.voice;
    $('ssTtsS').value = TT.speed;
    $('ssTtsSo').textContent = TT.speed + ' mots/min';
    ttsCall();
  }
  function ttsCall() {
    const c = txNow();
    $('ssTtsEx').textContent = c ? c + ' → ' + c.split('').map((x) => (/\d/.test(x) ? DIGW[+x] : PHON[x] || x)).join(' ') : 'TX call inconnu';
    $('ssTtsGo').textContent = 'GÉNÉRER' + (c ? ' POUR ' + c : '');
  }
  $('ssTtsX').addEventListener('click', () => { $('ssTts').hidden = true; });
  $('ssTtsBtn').addEventListener('click', () => { const p = $('ssTts'); p.hidden = !p.hidden; if (!p.hidden) ttsDraw(); });
  $('ssTtsV').addEventListener('change', () => { TT.voice = $('ssTtsV').value; ttsSave(); });
  $('ssTtsS').addEventListener('input', () => { TT.speed = Number($('ssTtsS').value); $('ssTtsSo').textContent = TT.speed + ' mots/min'; ttsSave(); });
  $('ssTtsDef').addEventListener('click', () => { TT.items = TTS_DEF.map((x) => Object.assign({ on: true }, x)); ttsSave(); ttsDraw(); });
  $('ssTtsGo').addEventListener('click', () => {
    if (!host) return toast('Page d’origine fermée.', 'warn');
    const items = TT.items.map((it, i) => ({ n: i + 1, name: it.name, text: it.text, voice: TT.voice, speed: TT.speed, on: it.on })).filter((x) => x.on !== false && x.text.trim());
    if (!items.length) return toast('Cochez au moins une mémoire.', 'warn');
    const busy = items.filter((x) => vmFilled(x.n) && !(S.tts && S.tts[x.n])).map((x) => 'T' + x.n);
    if (busy.length && !window.confirm('Remplacer ' + busy.join(', ') + ' (enregistrées au micro) par les messages en anglais ?')) return;
    api.send({ t: 'vm_tts', items: items.map(({ on, ...x }) => x) });
    $('ssTts').hidden = true; // réglages gardés : le cadre se referme
    toast('Fabrication des messages pour ' + txNow() + '…', '', 4000);
  });
  setInterval(() => { if (!$('ssTts').hidden) ttsCall(); }, 1000);
  // ▶ Écouter : la voix choisie sur le message T1 (ou le premier coché), joué dans ce PC
  $('ssTtsTry').addEventListener('click', () => {
    if (!host) return toast('Page d’origine fermée.', 'warn');
    const it = TT.items.find((x) => x.on !== false && x.text.trim()) || TT.items[0];
    api.send({ t: 'vm_tts_try', text: it.text, voice: TT.voice, speed: TT.speed });
    toast('Voix « ' + $('ssTtsV').selectedOptions[0].textContent + ' » : préparation…', '', 2500);
  });
  let ttsCtx = null;
  function ttsPlay(b64) {
    try {
      const raw = atob(b64);
      const pcm = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i++) pcm[i] = ULAW_DEC[raw.charCodeAt(i)];
      ttsCtx = ttsCtx || new AudioContext();
      const buf = ttsCtx.createBuffer(1, pcm.length, 12000);
      buf.copyToChannel(pcm, 0);
      const src = ttsCtx.createBufferSource();
      src.buffer = buf;
      src.connect(ttsCtx.destination);
      src.start();
    } catch (e) { toast('Lecture impossible dans ce navigateur.', 'warn'); }
  }
  const ULAW_DEC = (() => {
    const t = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const u = ~i & 0xff; const e = (u >> 4) & 7; let s2 = (((u & 0x0f) << 3) + 0x84) << e; s2 -= 0x84; t[i] = ((u & 0x80) ? -s2 : s2) / 32768; }
    return t;
  })();
  function vmFilled(n) { const t = S.vm && S.vm.t && S.vm.t[n - 1]; return !!(t && t.ms); }
  function playVm(n) {
    if (!host) return toast('Dashboard non raccroché.', 'warn');
    if (!vmFilled(n)) return toast('Mémoire T' + n + ' vide : l’enregistrer sur la face avant (MENU → VOICE → REC).', 'warn');
    api.send({ t: 'vm_play', n });
  }

  // ------------------------------------------------------------------ log du contest (comme le TRX CW)
  const CL = { id: '', items: [], esm: LS.get('ssesm', 'run') === 'sp' ? 'sp' : 'run' };
  const E = { call: $('cwpECall'), rs: $('cwpERs'), stx: $('cwpEStx'), rr: $('cwpERr'), srx: $('cwpESrx') };
  const BANDS = [[1.8, 2, '160m'], [3.5, 4, '80m'], [5.3, 5.5, '60m'], [7, 7.3, '40m'], [10.1, 10.15, '30m'], [14, 14.35, '20m'], [18.068, 18.168, '17m'],
    [21, 21.45, '15m'], [24.89, 24.99, '12m'], [28, 29.7, '10m'], [50, 54, '6m'], [144, 146, '2m'], [430, 440, '70cm']];
  const bandOf = (mhz) => { const b = BANDS.find((x) => mhz >= x[0] && mhz <= x[1]); return b ? b[2] : ''; };
  const ymd = (d) => d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
  const stripRs = (x) => String(x || '').toUpperCase().replace(/^5[1-9]\s+/, '').trim();
  // Case « Envoyé » : toujours l'échange à annoncer (zone, puissance… ou le n° de série de ce QSO), sauf si vous l'avez changé
  function fillStx(force) {
    if (!def()) return;
    if (force) delete E.stx.dataset.manual;
    if (E.stx.dataset.manual || document.activeElement === E.stx) return;
    const v = stripRs(exchShown());
    if (E.stx.value !== v) E.stx.value = v;
  }
  E.stx.addEventListener('input', () => { E.stx.value = E.stx.value.toUpperCase(); E.stx.dataset.manual = '1'; });
  function trxMhz() { const st = api.state(); const r = (st && st.radio) || {}; return (Number(r.vfoSel === 1 ? r.freqB : r.freq) || 0) / 1e6; }
  function fromDate() {
    let v = LS.get('ssbfrom_' + CL.id, '');
    if (!/^\d{8}$/.test(v)) v = ymd(new Date(Date.now() - 3 * 86400000));
    return v;
  }
  function askList() { if (CL.id) api.send({ t: 'ctst_list', contest: CL.id, from: fromDate() }); }
  function logSync(id) {
    if (id === CL.id) return;
    CL.id = id;
    CL.items = [];
    const f = fromDate();
    $('cwpFrom').value = f.slice(0, 4) + '-' + f.slice(4, 6) + '-' + f.slice(6, 8);
    drawLog();
    askList();
  }
  function checkDupe() {
    const call = E.call.value.trim().toUpperCase();
    const el = $('cwpDupe');
    if (!call || call.length < 3) { el.textContent = ''; el.className = 'cwp-dupe'; return false; }
    const band = bandOf(trxMhz());
    const d = CL.items.filter((q) => q.call === call && q.band === band);
    const other = CL.items.filter((q) => q.call === call && q.band !== band).map((q) => q.band);
    el.textContent = d.length ? 'DOUBLON ' + band + ' (' + d[d.length - 1].t.slice(0, 2) + ':' + d[d.length - 1].t.slice(2, 4) + ')' : other.length ? 'déjà sur ' + Array.from(new Set(other)).join(', ') : 'nouveau';
    el.className = 'cwp-dupe ' + (d.length ? 'dup' : 'new');
    return d.length > 0;
  }
  function drawLog() {
    const tb = $('cwpCLog');
    tb.textContent = '';
    for (const q of CL.items.slice(-1500).reverse()) {
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
    drawScore();
    drawProb();
  }

  // ------------------------------------------------------------------ score estimé (règlement de chaque contest)
  // Chaque QSO du log du contest porte le pays DXCC et le continent du correspondant (dx, ct) et de la station (mp, mc).
  const LOWB = { '160m': 1, '80m': 1, '40m': 1 };
  const BAND_ORDER = ['160m', '80m', '40m', '20m', '15m', '10m', '60m', '30m', '17m', '12m', '6m', '2m', '70cm'];
  // Pays de l'Union européenne (UBA DX : 2 points pour une station belge)
  const EU_UNION = new Set(['DL', 'F', 'I', 'IS', 'EA', 'EA6', 'EA8', 'EA9', 'CT', 'CT3', 'CU', 'PA', 'LX', 'OE', 'OK', 'OM', 'SP', 'HA', 'YO', 'LZ', 'SV', 'SV5', 'SV9',
    '5B', '9H', 'OH', 'OH0', 'SM', 'OZ', 'EI', 'ES', 'YL', 'LY', 'S5', '9A', 'TK', 'ON']);
  const num = (x) => { const m = /(\d+)/.exec(String(x || '')); return m ? Number(m[1]) : NaN; };
  const section = (x) => { const m = /([A-Z]{2,4})\s*$/.exec(String(x || '').toUpperCase()); return m && m[1] !== 'XXX' ? m[1] : ''; };
  // Préfixe WPX : « ON6DP » → ON6, « W1AW/3 » → W3, « PA/ON6DP » → PA0, sans chiffre : + 0
  function wpxPfx(call) {
    let c = String(call || '').toUpperCase().replace(/\/(P|M|MM|AM|QRP|A|B)$/, '');
    const parts = c.split('/');
    if (parts.length > 1) {
      const a = parts[0], b = parts[1];
      if (/^\d$/.test(b)) { const m = /^([A-Z0-9]*?[A-Z])\d*[A-Z]*$/.exec(a.replace(/\d+[A-Z]*$/, '')); return (m ? m[1] : a.replace(/\d.*$/, '')) + b; }
      c = a.length <= b.length ? a : b;
      if (!/\d/.test(c)) return c.slice(0, 2) + '0';
      return c; // indicatif de préfixe (« VP2E/W1XX », « N8BJQ/KH9 ») : il devient le préfixe
    }
    if (!/\d/.test(c)) return c.slice(0, 2) + '0'; // sans chiffre : 2 premières lettres + 0
    const m = /^(.*\d)[A-Z]+$/.exec(c);
    return m ? m[1] : c;
  }
  // Règles : points d'un QSO et multiplicateurs (par bande ou sur tout le contest)
  const RULES = {
    'CQ-WW-SSB': { note: '0 / 1 / 3 points (même pays / même continent / autre continent) × (zones CQ + pays DXCC) par bande',
      pts: (q) => (q.dx && q.dx === q.mp ? 0 : q.ct === q.mc ? 1 : 3), mul: (q) => { const z = num(q.srx); return [z >= 1 && z <= 40 ? 'Z' + z : '', q.dx ? 'C' + q.dx : '']; } },
    'CQ-WPX-SSB': { note: 'même pays 1 point ; même continent 1 (2 sur 40-160 m) ; autre continent 3 (6 sur 40-160 m) × préfixes WPX (une fois)', all: true,
      pts: (q) => (q.dx && q.dx === q.mp ? 1 : q.ct === q.mc ? (LOWB[q.band] ? 2 : 1) : (LOWB[q.band] ? 6 : 3)), mul: (q) => ['P' + wpxPfx(q.call)] },
    'ARRL-DX-SSB': { note: '3 points par QSO avec W / VE × États et provinces par bande',
      pts: (q) => (q.dx === 'K' || q.dx === 'VE' ? 3 : 0), mul: (q) => { const x = String(q.srx || '').toUpperCase().replace(/[^A-Z]/g, ''); return (q.dx === 'K' || q.dx === 'VE') && x ? ['S' + x] : []; } },
    'IARU-HF': { note: 'même zone ITU 1 point, même continent 3, autre continent 5, sièges IARU 1 × (zones ITU + sièges) par bande',
      pts: (q, my) => { if (/^[A-Z]/.test(String(q.srx || '').trim())) return 1; const z = num(q.srx); return z === my.itu ? 1 : q.ct === q.mc ? 3 : 5; },
      mul: (q) => { const x = String(q.srx || '').toUpperCase().trim(); return [/^[A-Z]/.test(x) ? 'H' + x.replace(/[^A-Z0-9]/g, '') : Number.isFinite(num(x)) ? 'Z' + num(x) : '']; } },
    'DARC-WAEDC-SSB': { note: 'station européenne : 1 point par QSO hors Europe (QTC non comptés) × pays par bande (×4 sur 80 m, ×3 sur 40 m, ×2 au-dessus)',
      pts: (q) => (q.ct && q.ct !== 'EU' ? 1 : 0), mul: (q) => (q.ct && q.ct !== 'EU' ? ['C' + q.dx] : []), w: (b) => ({ '80m': 4, '40m': 3, '160m': 4 }[b] || 2) },
    'UBA-DX-SSB': { note: 'station belge : ON 1 point, Union européenne 2, autres 3 × (pays DXCC + sections UBA) par bande',
      pts: (q) => (q.dx === 'ON' ? 1 : EU_UNION.has(q.dx) ? 2 : 3), mul: (q) => [q.dx ? 'C' + q.dx : '', q.dx === 'ON' && section(q.srx) ? 'S' + section(q.srx) : ''] },
    'ON-CONTEST-SSB': { note: '3 points par QSO (au plus 10 avec votre section par bande) × (sections UBA + pays DXCC hors ON) par bande',
      pts: () => 3, mul: (q) => [section(q.srx) ? 'S' + section(q.srx) : '', q.dx && q.dx !== 'ON' ? 'C' + q.dx : ''] },
    'EU-HF': { note: '1 point par QSO avec l’Europe × années de première licence différentes par bande',
      pts: (q) => (q.ct === 'EU' ? 1 : 0), mul: (q) => { const y = num(q.srx); return q.ct === 'EU' && Number.isFinite(y) ? ['Y' + String(y % 100).padStart(2, '0')] : []; } }
  };
  const GENERIC = { generic: true, note: 'règle générique (1 point par QSO × pays DXCC par bande) : indication seulement, voir le règlement',
    pts: () => 1, mul: (q) => [q.dx ? 'C' + q.dx : ''] };
  const tOf = (q) => q.d + (q.t || '').slice(0, 4);
  function scoreOf(list, R, my) {
    const seen = new Set();
    const bands = {};
    const glob = new Set();
    let Q = 0, P = 0;
    for (const q of list) {
      const k = q.call + '|' + q.band;
      if (seen.has(k)) continue;
      seen.add(k);
      const b = bands[q.band] || (bands[q.band] = { q: 0, p: 0, m: new Set() });
      const p = R.pts(q, my) || 0;
      b.q++; b.p += p; Q++; P += p;
      for (const x of R.mul(q, my) || []) if (x) { if (R.all) { if (!glob.has(x)) { glob.add(x); b.m.add(x); } } else b.m.add(x); }
    }
    let M = 0;
    for (const bn in bands) M += R.all ? 0 : bands[bn].m.size * (R.w ? R.w(bn) : 1);
    if (R.all) M = glob.size;
    return { bands, Q, P, M, S: P * M };
  }
  const fmtN = (n) => Number(n || 0).toLocaleString('fr-BE');
  function drawScore() {
    const d = def();
    if (!d) return;
    const R = RULES[d.id] || GENERIC;
    const k = kit();
    const my = { itu: k ? Number(k.zones().itu) : 27, cqz: k ? Number(k.zones().cqz) : 14 };
    const list = CL.items.slice().sort((a, b) => (tOf(a) < tOf(b) ? -1 : tOf(a) > tOf(b) ? 1 : 0));
    const sc = scoreOf(list, R, my);
    $('ssScNote').textContent = R.generic ? '(estimation)' : '';
    $('ssScNote').title = R.note;
    const tb = $('ssScB');
    tb.textContent = '';
    for (const bn of BAND_ORDER) {
      const b = sc.bands[bn];
      if (!b) continue;
      const tr = document.createElement('tr');
      for (const v of [bn, fmtN(b.q), fmtN(b.p), R.all ? '+' + b.m.size : fmtN(b.m.size * (R.w ? R.w(bn) : 1))]) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
      tb.appendChild(tr);
    }
    if (!tb.children.length) tb.innerHTML = '<tr><td colspan="4">Aucun QSO</td></tr>';
    $('ssScQ').textContent = fmtN(sc.Q);
    $('ssScP').textContent = fmtN(sc.P);
    $('ssScM').textContent = fmtN(sc.M);
    $('ssScT').textContent = fmtN(sc.S);
    $('ssScT').parentElement.title = R.note;
    // Évolution heure par heure (UTC) : QSO de l'heure, cumul et score à la fin de l'heure
    const hours = [];
    for (const q of list) { const h = q.d + (q.t || '').slice(0, 2); if (!hours.length || hours[hours.length - 1] !== h) hours.push(h); }
    const ev = $('ssEvo');
    ev.textContent = '';
    let cum = 0;
    const rows = [];
    for (const h of Array.from(new Set(hours))) {
      const inH = list.filter((q) => q.d + (q.t || '').slice(0, 2) === h).length;
      cum += inH;
      const upTo = list.filter((q) => q.d + (q.t || '').slice(0, 2) <= h);
      rows.push([h.slice(6, 8) + '/' + h.slice(4, 6) + ' ' + h.slice(8, 10) + ' h', fmtN(inH), fmtN(cum), fmtN(scoreOf(upTo, R, my).S)]);
    }
    for (const r of rows.slice(-24).reverse()) {
      const tr = document.createElement('tr');
      for (const v of r) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
      ev.appendChild(tr);
    }
    if (!rows.length) ev.innerHTML = '<tr><td colspan="4">—</td></tr>';
  }

  // ------------------------------------------------------------------ indicatifs probables (Super Check Partial + spots)
  const PR = { q: '', list: [], n: 0, asked: '' };
  // Plages SSB des bandes (kHz) : spots du DX cluster à afficher
  const SSB_SEG = { '160m': [1840, 2000], '80m': [3600, 3800], '40m': [7060, 7200], '20m': [14100, 14350], '17m': [18111, 18168], '15m': [21151, 21450],
    '12m': [24931, 24990], '10m': [28300, 29000], '6m': [50100, 50500] };
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
    // Spot cliqué : le TRX va sur sa fréquence (en LSB / USB) si vous avez la main
    if (spot && api.iControl()) {
      try { host.api.setFreq(Math.round(spot.f * 1000)); setTimeout(() => { try { if (hostWin.RSDIGI) hostWin.RSDIGI.modeFor('ssb'); } catch (e) {} }, 500); } catch (e) {}
    }
    drawProb();
    if (CL.esm === 'sp' && vmFilled(4)) toast('Entrée : votre indicatif (T4).', '', 2500);
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
    const box = $('ssPr');
    if (!box || !def()) return;
    const band = bandOf(trxMhz());
    const worked = new Set(CL.items.filter((q) => q.band === band).map((q) => q.call));
    const any = new Set(CL.items.map((q) => q.call));
    box.textContent = '';
    const typed = E.call.value.trim().toUpperCase();
    if (typed.length >= 2) {
      $('ssPrH').textContent = 'Indicatifs probables · « ' + typed + ' »';
      // Déjà dans le log du contest d'abord, puis la liste Super Check Partial
      const mine = Array.from(any).filter((c) => c.indexOf(typed) >= 0);
      const scp = PR.q === typed ? PR.list : [];
      const all = Array.from(new Set(mine.concat(scp))).slice(0, 40);
      for (const c of all) {
        const dup = worked.has(c);
        box.appendChild(chip(c, dup ? 'dup' : any.has(c) ? '' : 'new', dup ? band : any.has(c) ? 'autre bande' : '', dup ? 'Déjà contacté sur ' + band : 'Cliquer : dans la case Indicatif', () => pickCall(c)));
      }
      $('ssPrNote').textContent = all.length ? 'Vert : pas encore contacté · barré : doublon sur ' + (band || 'cette bande') + '.' : (PR.n ? 'Aucun indicatif connu ne contient « ' + typed + ' ».' : 'Liste Super Check Partial pas encore téléchargée par le serveur.');
      return;
    }
    // Rien de tapé : stations spotées en SSB sur la bande du TRX (DX cluster), les plus récentes d'abord
    const seg = SSB_SEG[band];
    $('ssPrH').textContent = 'Stations spotées ' + (band ? 'sur ' + band : '') + ' (SSB)';
    const k = kit();
    let spots = [];
    try { spots = k && k.spots ? k.spots() : []; } catch (e) { spots = []; }
    spots = spots.filter((s) => seg && s.f >= seg[0] && s.f <= seg[1] && !s.skim && !/\b(CW|FT[48]|RTTY|PSK|WPM|DIGI|JT65|SSTV)\b/i.test(s.cmt))
      .sort((a, b) => b.at - a.at);
    const seen = new Set();
    for (const s of spots) {
      if (seen.has(s.call)) continue;
      seen.add(s.call);
      const dup = worked.has(s.call);
      box.appendChild(chip(s.call, dup ? 'dup' : 'new', (s.f / 1000).toFixed(3).replace('.', ','), (dup ? 'Déjà contacté sur ' + band + ' · ' : 'Cliquer : indicatif + TRX sur ') + s.f.toFixed(1) + ' kHz' + (s.cmt ? ' · ' + s.cmt : ''), () => pickCall(s.call, s)));
      if (seen.size >= 60) break;
    }
    $('ssPrNote').textContent = seen.size ? 'Vert : à contacter · barré : déjà dans le log sur ' + band + '. Tapez le début d’un indicatif : liste Super Check Partial.' : 'Aucun spot SSB sur cette bande pour l’instant. Tapez le début d’un indicatif : liste Super Check Partial (indicatifs actifs en contest).';
  }
  setInterval(() => { if (def() && E.call.value.trim().length < 2) drawProb(); }, 5000);
  function wipe() {
    for (const k of ['call', 'stx', 'srx']) E[k].value = '';
    fillStx(true);
    askScp();
    const k = kit();
    if (k) k.setCall('');
    drawState.kc = '';
    checkDupe();
    E.call.focus();
  }
  function logEntry() {
    const k = kit();
    if (!k || !CL.id) return false;
    const call = E.call.value.trim().toUpperCase();
    if (!/^(?=.*[0-9])[A-Z0-9/]{3,15}$/.test(call)) { toast('Indicatif du correspondant ?', 'warn'); E.call.focus(); return false; }
    if (!E.srx.value.trim()) { toast('Échange reçu ?', 'warn'); E.srx.focus(); return false; }
    const mhz = trxMhz();
    if (!(mhz > 0)) { toast('Fréquence du TRX inconnue : QSO non enregistré.', 'warn'); return false; }
    if (!E.stx.value.trim()) E.stx.value = stripRs(exchShown());
    const d = new Date(k.utcNow());
    const hms = String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0') + String(d.getUTCSeconds()).padStart(2, '0');
    const stx = stripRs(E.stx.value);
    const srx = stripRs(E.srx.value);
    const st = api.state();
    const r = (st && st.radio) || {};
    const md = String((r.vfoSel === 1 ? r.modeB : r.mode) || '');
    const qso = { call, qso_date: ymd(d), time_on: hms, time_off: hms, freq: Math.round(mhz * 1e6) / 1e6,
      mode: /^LSB/.test(md) ? 'LSB' : /^USB/.test(md) ? 'USB' : mhz < 10 ? 'LSB' : 'USB',
      rst_sent: E.rs.value.trim() || '59', rst_rcvd: E.rr.value.trim() || '59', contest_id: CL.id, stx_string: stx, srx_string: srx, station: k.myCall() };
    if (/^\d{1,5}$/.test(stx)) qso.stx = stx;
    if (/^\d{1,5}$/.test(srx)) qso.srx = srx;
    api.send({ t: 'log_add', qso, force: true, tag: 'ssbpage' });
    CL.items.push({ call, band: bandOf(mhz), d: qso.qso_date, t: hms, stx, srx });
    if (/<CNTR>|<SERNO>/.test(exchTpl())) k.afterLog(call); // n° de série suivant (seulement s'il fait partie de l'échange)
    drawLog();
    for (const x of ['call', 'stx', 'srx']) E[x].value = '';
    delete E.stx.dataset.manual;
    k.setCall('');
    drawState.kc = '';
    checkDupe();
    drawContest();
    return true;
  }
  // Entrée (ESM de N1MM, en phonie) : RUN : vide → T1 (CQ) ; indicatif → échange reçu à taper (vous annoncez le vôtre
  // au micro) ; échange reçu → QSO enregistré + T3 (TU). S&P : indicatif → T4 (votre indicatif) ; échange reçu → QSO enregistré.
  function esmEnter() {
    const call = E.call.value.trim();
    const srx = E.srx.value.trim();
    if (CL.esm === 'run') {
      if (!call) return playVm(1);
      if (!srx) { E.stx.value = stripRs(exchShown()); E.srx.focus(); return; }
      if (logEntry()) { if (vmFilled(3)) playVm(3); E.call.focus(); }
      return;
    }
    if (!call) return toast('Tapez l’indicatif de la station qui appelle CQ.', 'warn');
    if (!srx) { if (vmFilled(4)) playVm(4); E.stx.value = stripRs(exchShown()); E.srx.focus(); return; }
    if (logEntry()) E.call.focus();
  }
  function esmShow() { $('cwpRun').classList.toggle('on', CL.esm === 'run'); $('cwpSp').classList.toggle('on', CL.esm === 'sp'); }
  const esmSet = (v) => { CL.esm = v; LS.set('ssesm', v); esmShow(); E.call.focus(); };
  $('cwpRun').addEventListener('click', () => esmSet('run'));
  $('cwpSp').addEventListener('click', () => esmSet('sp'));
  esmShow();
  for (const key of Object.keys(E)) {
    E[key].addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); esmEnter(); }
      else if (e.key === ' ' && key === 'call') { e.preventDefault(); E.srx.focus(); }
      else if (e.key === ' ' && key === 'srx' && !E.srx.value.trim()) { e.preventDefault(); E.call.focus(); }
    });
  }
  E.call.addEventListener('input', () => {
    E.call.value = E.call.value.toUpperCase().replace(/[^A-Z0-9/?]/g, '');
    askScp();
    drawProb();
    const k = kit();
    if (k) k.setCall(E.call.value);
    drawState.kc = E.call.value.trim().toUpperCase(); // tapé ici : pas à recopier depuis le dashboard
    checkDupe();
  });
  E.srx.addEventListener('input', () => { E.srx.value = E.srx.value.toUpperCase(); });
  E.rs.value = E.rr.value = '59';
  $('cwpELog').addEventListener('click', () => { if (logEntry()) E.call.focus(); });
  $('cwpEWipe').addEventListener('click', wipe);
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'w' || e.key === 'W') && e.altKey) { e.preventDefault(); wipe(); return; }
    const f = /^F([1-8])$/.exec(e.key);
    if (f && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); playVm(Number(f[1])); return; }
    if (e.key === 'Escape') api.send({ t: 'vm_stop' });
  });
  $('cwpFrom').addEventListener('change', () => {
    const v = $('cwpFrom').value.replace(/\D/g, '');
    if (/^\d{8}$/.test(v)) LS.set('ssbfrom_' + CL.id, v);
    askList();
  });
  $('cwpCab').addEventListener('click', () => {
    const k = kit();
    const d = def();
    if (!k || !d) return;
    const f = fromDate();
    api.send({ t: 'log_export', fmt: 'cabrillo', callsign: k.myCall(), mine: true, contest: d.id, contestOnly: true, cat: cabCat(), location: d.location || '',
      from: f.slice(0, 4) + '-' + f.slice(4, 6) + '-' + f.slice(6, 8), tag: 'ssbpage' });
  });
  // ADIF (.adi) : QSO du contest (même choix que le Cabrillo) ; sans contest : QSO en phonie hors contest
  $('ssAdi').addEventListener('click', () => {
    const k = kit();
    const d = def();
    if (!k || !d) return;
    const f = fromDate();
    api.send({ t: 'log_export', fmt: 'adif', callsign: k.myCall(), mine: true, contest: d.id, contestOnly: true,
      from: f.slice(0, 4) + '-' + f.slice(4, 6) + '-' + f.slice(6, 8), tag: 'ssbpage' });
  });
  {
    const qf = $('ssQFrom');
    let v = LS.get('ssbqfrom', '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { const d0 = new Date(Date.now() - 30 * 86400000); v = d0.toISOString().slice(0, 10); }
    qf.value = v;
    qf.addEventListener('change', () => LS.set('ssbqfrom', qf.value));
    $('ssQAdi').addEventListener('click', () => {
      const k = kit();
      if (!k) return;
      api.send({ t: 'log_export', fmt: 'adif', callsign: k.myCall(), mine: true, phoneOnly: true, from: qf.value || '', tag: 'ssbpage' });
    });
  }
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

  // ------------------------------------------------------------------ phonie : micro, égaliseurs (SSB CONFIGURATION) et PTT
  // Même module que la face avant (voice.js), ici dans cette page : la voix part par la connexion de la page d'origine.
  const VX = window.RSVOICE || null;
  const P = { held: false, hb: null, voiceOn: false };
  function voiceInit() {
    if (!VX || !host) return;
    VX.init({ compact: true, send: api.send, say: (msg, lvl, ms) => toast(msg, lvl === 'warn' || lvl === 'error' ? 'warn' : '', ms),
      iControl: api.iControl, state: api.state, me: () => { try { return host.me ? host.me() : null; } catch (e) { return null; } },
      rig: () => { try { return host.api.rig(); } catch (e) { return {}; } },
      setSink: (id) => { try { if (host.setSink) host.setSink(id); } catch (e) {} },
      sendBin: (buf) => { try { if (host.sendBin) host.sendBin(buf); } catch (e) {} } });
    try { VX.onHello(host.me ? host.me() : {}); } catch (e) {}
  }
  function pttReason() {
    const st = api.state();
    const me = host && host.me ? host.me() : null;
    if (!host) return 'Page d’origine fermée';
    if (!st || !st.station) return 'Station hors ligne';
    if (!st.radio || !st.radio.connected) return 'TRX non connecté';
    if (!api.iControl()) return 'Prenez la main pour émettre';
    if (st.radio.vox) return 'VOX actif au club : coupez-le d’abord';
    if (!st.txOk) return st.radio.txVfo === 1 ? 'VFO B (SPLIT) hors des bandes autorisées' : 'Hors des bandes autorisées';
    if (me && st.radio.power != null && st.radio.power > me.maxWatts) return 'Puissance au-delà de votre limite (' + me.maxWatts + ' W)';
    if (st.swrLock) return st.swrLock.text || 'ROS trop élevé ici';
    return null;
  }
  function pttDown() {
    if (P.held) return;
    const why = pttReason();
    if (why) return toast(why, 'warn');
    P.held = true;
    P.voiceOn = !!(VX && VX.txStart());
    if (host) host.extTalk = P.voiceOn;
    api.send({ t: 'ptt', on: true, voice: P.voiceOn });
    P.hb = setInterval(() => api.send({ t: 'ptt', on: true, voice: P.voiceOn }), 400);
    $('ptt').classList.add('held');
    if (!P.voiceOn) toast('PTT sans votre micro : activez « MICRO » (SSB CONFIGURATION) pour parler depuis ce PC.', 'warn', 5000);
  }
  function pttUp() {
    if (!P.held) return;
    P.held = false;
    clearInterval(P.hb);
    if (VX) VX.txEnd();
    try { if (host) host.extTalk = false; } catch (e) {}
    api.send({ t: 'ptt', on: false });
    $('ptt').classList.remove('held');
  }
  {
    const b = $('ptt');
    b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); try { b.setPointerCapture(ev.pointerId); } catch (e) {} pttDown(); });
    b.addEventListener('pointerup', pttUp);
    b.addEventListener('pointercancel', pttUp);
    b.addEventListener('lostpointercapture', pttUp);
    // Barre d'espace = PTT, hors des cases de saisie (où elle passe au champ suivant)
    const typing = (e) => e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    document.addEventListener('keydown', (e) => { if (e.key === ' ' && !typing(e)) { e.preventDefault(); if (!e.repeat) pttDown(); } });
    document.addEventListener('keyup', (e) => { if (e.key === ' ' && P.held) { e.preventDefault(); pttUp(); } });
    window.addEventListener('blur', pttUp); // sécurité : fenêtre quittée pendant l'émission
  }

  // ------------------------------------------------------------------ fiche de QSO du carnet (sans contest)
  const LOG = window.RSLOG || null;
  function logInit() {
    if (!LOG || !host) return;
    LOG.init({ send: api.send, state: api.state, iControl: api.iControl, tag: 'ssbpage', formOnly: true, phone: true,
      say: (msg, lvl, ms) => toast(msg, lvl === 'warn' || lvl === 'error' ? 'warn' : '', ms) });
    if (!LOG.mounted) { LOG.mount($('ssLog')); LOG.mounted = true; }
    try { const me = host.me ? host.me() : null; if (me) LOG.onHello(me); } catch (e) {}
    if (!$('ssQso').hidden) LOG.show();
  }

  // QSO en phonie hors contest (ceux du carnet général) : liste sous la fiche
  function askSsb() { if (host && !def()) api.send({ t: 'ssb_list', n: 300 }); }
  function drawSsb(items) {
    const tb = $('ssQLog');
    tb.textContent = '';
    const fd = (d) => d.slice(6, 8) + '/' + d.slice(4, 6) + '/' + d.slice(0, 4);
    for (const q of items) {
      const tr = document.createElement('tr');
      for (const v of [fd(q.d), q.t.slice(0, 2) + ':' + q.t.slice(2, 4), q.call, q.band, q.freq, q.mode, q.rs, q.rr, q.name, q.qth, q.country, q.st, q.op]) {
        const td = document.createElement('td');
        td.textContent = v == null ? '' : String(v);
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
    if (!items.length) tb.innerHTML = '<tr><td colspan="13">Aucun QSO en phonie hors contest dans le carnet.</td></tr>';
    const today = ymd(new Date());
    $('ssQStats').innerHTML = '<b>' + items.length + '</b> derniers QSO en phonie (hors contest) · aujourd’hui <b>' + items.filter((q) => q.d === today).length + '</b> · aussi dans le carnet général (Logbooks)';
  }

  // ------------------------------------------------------------------ messages du serveur, état
  function onMsg(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'vm') { S.vm = m.meta || null; S.tts = m.tts || {}; S.playing = m.playing || null; drawVk(); }
    else if ((m.t === 'mic_profile' || m.t === 'trxeq' || m.t === 'trxeq_values' || m.t === 'profile') && VX) VX.onMessage(m);
    else if (m.t === 'hello') { if (VX) VX.onHello(m); if (LOG && LOG.mounted) LOG.onHello(m); }
    else if (m.t === 'state') { if (VX) VX.onState(); if (LOG && LOG.mounted) LOG.onState(); if (P.held && !api.iControl()) pttUp(); }
    else if (m.t === 'qrz_info' && LOG && LOG.mounted && LOG.onQrz) LOG.onQrz(m);
    else if (m.t === 'notice' && m.msg) toast(m.msg, m.level === 'error' ? 'warn' : '', 6000);
    else if (m.t === 'ssb_list') drawSsb(m.items || []);
    else if (m.t === 'tts_audio' && m.d) ttsPlay(m.d);
    else if (m.t === 'scp') { PR.q = m.q; PR.list = m.list || []; PR.n = m.n || 0; drawProb(); }
    else if (m.t === 'ctst_list' && m.contest === CL.id) { CL.items = m.items || []; drawLog(); checkDupe(); }
    else if ((m.t === 'log_saved' || m.t === 'log_changed') && CL.id) { clearTimeout(onMsg.lt); onMsg.lt = setTimeout(askList, 400); }
    else if ((m.t === 'log_saved' || m.t === 'log_changed') && !def()) { clearTimeout(onMsg.st); onMsg.st = setTimeout(askSsb, 400); }
    else if (m.t === 'log_export' && m.tag === 'ssbpage') saveFile(m);
    // Fiche du carnet (sans contest) : réponses à ses QSO, liste des TX call, références
    if (LOG && LOG.mounted && /^(log_saved|log_dupe|log_cfg|log_refs)$/.test(m.t)) LOG.onMessage(m);
  }
  const fmtF = (hz) => { if (!hz) return '—'; const s = String(Math.round(hz)).padStart(7, '0'); return s.slice(0, -6) + '.' + s.slice(-6, -3) + '.' + s.slice(-3); };
  function drawState() {
    const st = api.state();
    const r = (st && st.radio) || {};
    const B = r.vfoSel === 1;
    $('cwpFreq').textContent = fmtF(B ? r.freqB : r.freq);
    const md = (B ? r.modeB : r.mode) || '—';
    $('cwpMode').textContent = md;
    $('cwpMode').classList.toggle('bad', !!st && !/^(USB|LSB)/.test(md));
    const me = api.iControl();
    $('cwpCtl').textContent = !host ? 'dashboard non raccroché' : me ? 'Vous avez la main' : st && st.controller ? 'Main : ' + st.controller : 'Personne n’a la main';
    $('cwpCtl').className = me ? 'ok' : '';
    $('cwpTake').hidden = !host || me || !!(st && st.controller);
    const tx = !!(st && st.ptt && st.ptt.active) || !!r.tx;
    $('cwpTx').textContent = tx ? 'TX' : 'RX';
    // Grand PTT en rouge dès que le TRX émet (PTT de cette page, mémoire vocale, PTT d'une autre page)
    $('ptt').classList.toggle('on-air', tx);
    $('ptt').textContent = tx ? 'PTT · ÉMISSION' : 'PTT';
    $('cwpTx').classList.toggle('on', tx);
    $('cwpTxSt').textContent = 'Émission : ' + (st && st.ptt && st.ptt.active ? (st.ptt.voice ? 'phonie / mémoire vocale de ' : 'PTT de ') + (st.ptt.by || '?') : 'aucune');
    $('cwpLink').textContent = 'Liaison : ' + (host ? 'par la page d’origine' : 'aucune');
    // Indicatif du titre : le TX call choisi dans la fiche (sans contest), sinon celui d'émission de la station
    const fsel = !$('ssQso').hidden ? document.querySelector('#ssLog select[name="station"]') : null;
    const tcall = (fsel && fsel.dataset.manual && fsel.value) || (st && st.txCall) || '';
    $('ssTxc').textContent = tcall ? String(tcall).toUpperCase() + ' ' : '';
    const k = kit();
    if (k) {
      // Indicatif choisi ailleurs (spot cliqué dans une BAND MAP…) : dans la case Indicatif
      const kc = String(k.call() || '').toUpperCase();
      if (kc !== drawState.kc) {
        const was = drawState.kc;
        drawState.kc = kc;
        if (was !== undefined && kc && E.call.value.trim().toUpperCase() !== kc) { E.call.value = kc; E.srx.value = ''; checkDupe(); }
      }
      const n = String(k.serial()).padStart(3, '0');
      if (document.activeElement !== $('ssNr') && $('ssNr').value !== n) { $('ssNr').value = n; $('ssExchSh').textContent = def() ? '→ ' + exchShown() : ''; fillStx(false); }
    }
  }
  $('cwpTake').addEventListener('click', () => api.send({ t: 'take' }));
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
    // La fiche du carnet (sans contest) prend le même indicatif
    const fs = document.querySelector('#ssLog select[name="station"]');
    if (fs) { delete fs.dataset.manual; if ([...fs.options].some((o) => o.value === v)) fs.value = v; }
    toast('TX call : ' + v + ' (émission et QSO enregistrés).', '', 4000);
  });
  setInterval(drawTxCall, 500);
  function link() {
    const w = chain().find((x) => { try { return !!x.RSHOST; } catch (e) { return false; } }) || null;
    const h = w ? w.RSHOST : null;
    if (h && h !== host) {
      if (untap) try { untap(); } catch (e) {}
      hostWin = w;
      host = h;
      untap = h.tap ? h.tap(onMsg) : null;
      $('cwpOrphan').hidden = true;
      voiceInit();
      logInit();
      askSsb();
      api.send({ t: 'vm_list' });
      drawContest();
    } else if (!h) { host = null; hostWin = null; $('cwpOrphan').hidden = false; }
  }
  window.addEventListener('pagehide', () => { pttUp(); if (untap) try { untap(); } catch (e) {} });
  fillContests();
  link();
  drawVk();
  drawContest();
  setInterval(link, 1000);
  setInterval(drawState, 250);
  setInterval(() => { if (host) api.send({ t: 'vm_list' }); }, 30000);
})();
