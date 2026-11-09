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
    if (qb.hidden !== !!d) { qb.hidden = !!d; if (!d && LOG && LOG.mounted) LOG.show(); }
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
      set($('ssName'), z.name);
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
    $(id).addEventListener('change', () => { const k = kit(); if (k) { k.setZones({ [key]: $(id).value }); drawContest(); } });
  }

  // ------------------------------------------------------------------ mémoires vocales (VOICE TX)
  function drawVk() {
    const box = $('ssVk');
    const meta = S.vm;
    const pl = S.playing ? S.playing.n : 0;
    const sig = JSON.stringify(meta) + '|' + pl;
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
      b.title = t && t.ms ? 'Émet la mémoire vocale T' + n : 'Mémoire T' + n + ' vide : l’enregistrer sur la face avant (MENU → VOICE → REC)';
      b.addEventListener('click', () => playVm(n));
      box.appendChild(b);
    }
  }
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
    for (const q of CL.items.slice(-60).reverse()) {
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
    fillStx(true);
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
      from: f.slice(0, 4) + '-' + f.slice(4, 6) + '-' + f.slice(6, 8), tag: 'cwpage' });
  });
  function saveFile(m) {
    const blob = new Blob([m.data], { type: (m.mime || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast(m.count + ' QSO dans ' + m.name + ' (Cabrillo).', '', 5000);
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
    LOG.init({ send: api.send, state: api.state, iControl: api.iControl, tag: 'ssbpage', formOnly: true,
      say: (msg, lvl, ms) => toast(msg, lvl === 'warn' || lvl === 'error' ? 'warn' : '', ms) });
    if (!LOG.mounted) { LOG.mount($('ssLog')); LOG.mounted = true; }
    try { const me = host.me ? host.me() : null; if (me) LOG.onHello(me); } catch (e) {}
    if (!$('ssQso').hidden) LOG.show();
  }

  // ------------------------------------------------------------------ messages du serveur, état
  function onMsg(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'vm') { S.vm = m.meta || null; S.playing = m.playing || null; drawVk(); }
    else if ((m.t === 'mic_profile' || m.t === 'trxeq' || m.t === 'trxeq_values' || m.t === 'profile') && VX) VX.onMessage(m);
    else if (m.t === 'hello') { if (VX) VX.onHello(m); if (LOG && LOG.mounted) LOG.onHello(m); }
    else if (m.t === 'state') { if (VX) VX.onState(); if (LOG && LOG.mounted) LOG.onState(); if (P.held && !api.iControl()) pttUp(); }
    else if (m.t === 'qrz_info' && LOG && LOG.mounted && LOG.onQrz) LOG.onQrz(m);
    else if (m.t === 'notice' && m.msg) toast(m.msg, m.level === 'error' ? 'warn' : '', 6000);
    else if (m.t === 'ctst_list' && m.contest === CL.id) { CL.items = m.items || []; drawLog(); checkDupe(); }
    else if ((m.t === 'log_saved' || m.t === 'log_changed') && CL.id) { clearTimeout(onMsg.lt); onMsg.lt = setTimeout(askList, 400); }
    else if (m.t === 'log_export' && m.tag === 'cwpage') saveFile(m);
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
    $('cwpTx').classList.toggle('on', tx);
    $('cwpTxSt').textContent = 'Émission : ' + (st && st.ptt && st.ptt.active ? (st.ptt.voice ? 'phonie / mémoire vocale de ' : 'PTT de ') + (st.ptt.by || '?') : 'aucune');
    $('cwpLink').textContent = 'Liaison : ' + (host ? 'par la page d’origine' : 'aucune');
    $('ssTxc').textContent = st && st.txCall ? String(st.txCall).toUpperCase() + ' ' : '';
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
