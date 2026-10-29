/*
 * logbook.js — onglet « Logs » du dashboard (version extended).
 *
 *  - Saisie d'un QSO, pré-remplie avec la fréquence et le mode du TRX et la ligne Correspondant.
 *  - Carnet de trafic de la station (serveur : logbook.json), état des envois LoTW / eQSL / Club Log / QRZ.
 *  - Menu Synchronisation (administrateurs) : fenêtres « Télécharger vers … » (Détails / Traitement), comme Swisslog.
 *  - Exporter : ADIF (.adi) ou Cabrillo (.log).
 *  - Configuration (administrateurs) : un onglet par service + UDP vers les logbooks du PC (Swisslog, N1MM, Log4OM…).
 *    Les mots de passe et clés restent sur le serveur : la page ne reçoit que « enregistré / non enregistré ».
 * app.js appelle RSLOG.init(api), onHello(m), onMessage(m) ; digi.js crée l'onglet et appelle mount(el) et show().
 */
(function () {
  'use strict';
  const SV = ['lotw', 'eqsl', 'clublog', 'qrz'];
  const NAMES = { lotw: 'LoTW', eqsl: 'eQSL', clublog: 'Club Log', qrz: 'QRZ.com' };
  const SHORT = { lotw: 'LoTW', eqsl: 'eQSL', clublog: 'CL', qrz: 'QRZ' };
  const MODES = ['SSB', 'USB', 'LSB', 'CW', 'AM', 'FM', 'RTTY', 'FT8', 'FT4', 'FT2', 'JT65', 'JTTY', 'SSTV', 'PSK31', 'WSPR', 'C4FM', 'DATA'];
  const DIGI = ['FT8', 'FT4', 'FT2', 'JT65', 'JTTY', 'WSPR'];
  const PHONE = ['SSB', 'USB', 'LSB', 'AM', 'FM', 'C4FM'];
  const CONTESTS = ['DX', 'UBA-DX-CW', 'UBA-DX-SSB', 'UBA-SPRING-CW', 'UBA-SPRING-SSB', 'ON-CONTEST', 'IARU-HF', 'CQ-WW-CW', 'CQ-WW-SSB', 'CQ-WPX-CW',
    'CQ-WPX-SSB', 'ARRL-DX-CW', 'ARRL-DX-SSB', 'WAE-CW', 'WAE-SSB', 'EU-HF', 'IARU-VHF', 'IARU-UHF'];

  let api = null;
  let root = null;
  let me = { call: '', admin: false, rxOnly: false };
  let calls = [];
  let items = [];
  let total = 0;
  // Colonnes du carnet : largeur par défaut (px), réglable à la souris (bord droit de l'en-tête), gardée dans ce navigateur
  const LG_COLS = [['date', 98], ['utc', 58], ['call', 96], ['band', 70], ['mhz', 82], ['mode', 66], ['env', 58], ['recu', 64], ['nom', 116],
    ['qth', 136], ['dxcc', 116], ['pfx', 76], ['txc', 84], ['op', 84], ['lotw', 62], ['eqsl', 62], ['cl', 46], ['qrz', 54], ['fill', 0]];
  let editing = null;      // QSO en cours de modification
  let lastTxCall = '';     // dernier TX call de la ligne Correspondant reporté dans la fiche
  let filt = {};           // filtres par colonne { date: '20261025', band: '20m', … }
  let fltMenu = null;      // menu ouvert : { col, el }
  let stale = true;        // liste à recharger à la prochaine ouverture de l'onglet
  let listTimer = 0;
  let sdlg = null;         // fenêtre de synchronisation ouverte { service, el, job }
  let cdlg = null;         // fenêtre de configuration ouverte
  let lastExport = null;   // dernier export « QSO non envoyés à LoTW » (identifiants, pour les marquer envoyés)
  let pendingDupe = null;
  let lastLogged = '';     // dernier indicatif enregistré : pas repris de la ligne Correspondant juste après

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const q$ = (sel, el) => (el || root).querySelector(sel);
  const pad = (n, l) => String(n).padStart(l || 2, '0');
  const say = (t, lvl) => { if (api) api.say(t, lvl || '', 6000); };
  function utcNow() {
    const d = new Date();
    return { date: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()), time: pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) };
  }
  function loadDx() { try { return JSON.parse(localStorage.getItem('rs.dg.dx') || '{}') || {}; } catch (e) { return {}; } }
  const fmtDate = (d) => d.slice(6, 8) + '/' + d.slice(4, 6) + '/' + d.slice(0, 4);
  const fmtTime = (t) => t.slice(0, 2) + ':' + t.slice(2, 4);
  const modeName = (q) => (q.submode && q.mode !== 'SSB' ? q.submode : q.submode || q.mode);
  function mhz(v) {
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }

  // ------------------------------------------------------------------ onglet
  const PANE = `
    <form class="lg-form" id="lgForm" autocomplete="off" spellcheck="false">
      <div class="lg-row">
        <label class="lg-call">Indicatif <input name="call" maxlength="15" required placeholder="ON4XX"></label>
        <label>Date UTC <input name="date" type="date" required></label>
        <label class="lg-w5">Heure UTC <input name="time" maxlength="5" required placeholder="HH:MM"></label>
        <button class="btn" type="button" data-a="now" title="Date et heure actuelles (UTC)">⟳ Maintenant</button>
        <label class="lg-w8">Fréquence MHz <input name="freq" inputmode="decimal" required placeholder="14.074"></label>
        <label>Mode <select name="mode"></select></label>
        <button class="btn" type="button" data-a="trx" title="Fréquence et mode du TRX, ligne Correspondant">⇩ TRX</button>
        <label class="lg-w5">RST env. <input name="rst_sent" maxlength="8"></label>
        <label class="lg-w5">RST reçu <input name="rst_rcvd" maxlength="8"></label>
        <label class="lg-txc">TX call <select name="station" title="Indicatif sous lequel le QSO a été fait (STATION_CALLSIGN)"></select></label>
        <label class="lg-chk lg-qo" title="QSO via le satellite QO-100 : fréquence de montée 2400,xxx MHz (la FI du convertisseur est convertie)"><input type="checkbox" name="qo100"> QO-100</label>
      </div>
      <div class="lg-row">
        <label>Nom <input name="name" maxlength="40"></label>
        <label>QTH <input name="qth" maxlength="60"></label>
        <label class="lg-w6">Locator <input name="gridsquare" maxlength="8"></label>
        <label class="lg-w5">Puiss. W <input name="tx_pwr" inputmode="decimal" maxlength="5"></label>
        <label class="lg-rem">Remarque <input name="comment" maxlength="200"></label>
      </div>
      <div class="lg-row lg-act">
        <button class="btn btn-primary" type="submit" data-a="save">Enregistrer le QSO</button>
        <button class="btn" type="button" data-a="cancel" hidden>Annuler</button>
        <button class="btn" type="button" data-a="del" hidden>Supprimer</button>
        <span class="lg-fmsg" id="lgFmsg"></span>
      </div>
    </form>
    <div class="lg-bar">
      <input class="lg-search" id="lgSearch" placeholder="Rechercher (indicatif, nom, opérateur)" aria-label="Rechercher dans le carnet">
      <span class="lg-count" id="lgCount"></span>
      <button class="btn lg-fclr" type="button" id="lgFclr" hidden title="Retirer tous les filtres de colonne">✕ Filtres</button>
      <span class="lg-sp"></span>
      <div class="lg-menu">
        <button class="btn" type="button" data-m="sync" aria-haspopup="true" aria-expanded="false">Synchronisation ▾</button>
        <div class="lg-mlist" role="menu" hidden>
          <button type="button" role="menuitem" data-s="lotw">Synchronisation LoTW…</button>
          <button type="button" role="menuitem" data-s="eqsl">Synchronisation eQSL…</button>
          <button type="button" role="menuitem" data-s="clublog">Club Log…</button>
          <button type="button" role="menuitem" data-s="qrz">QRZ…</button>
          <hr class="lg-msep">
          <button type="button" role="menuitem" data-a="cfg" title="Réglages des carnets en ligne, de QRZ.com et des ports UDP">⚙ Configuration…</button>
        </div>
      </div>
      <div class="lg-menu">
        <button class="btn" type="button" data-m="exp" aria-haspopup="true" aria-expanded="false">Exporter ▾</button>
        <div class="lg-mlist" role="menu" hidden>
          <button type="button" role="menuitem" data-xm="1">Mes QSO (.adi)</button>
          <button type="button" role="menuitem" data-x="adif">ADIF (.adi)…</button>
          <button type="button" role="menuitem" data-x="cabrillo">Cabrillo (.log)…</button>
        </div>
      </div>
    </div>
    <div class="lg-tw">
      <table class="lg-table">
        <colgroup>${LG_COLS.map(([k]) => '<col data-c="' + k + '">').join('')}</colgroup>
        <thead><tr><th>Date</th><th>UTC</th><th>Indicatif</th><th>Bande</th><th class="r">MHz</th><th>Mode</th><th>Env.</th><th>Reçu</th><th class="grow">Nom</th><th class="lg-qth">QTH</th><th class="lg-cty" title="Pays DXCC (fichier cty.dat)">DXCC</th><th title="Préfixe principal de l'entité DXCC (ex. ON pour la Belgique, LA pour la Norvège)">Préfixe</th><th title="Indicatif sous lequel le QSO a été fait (celui de TX CALL du dashboard)">TX call</th><th title="Opérateur : indicatif personnel du membre qui a fait le QSO (même sous l'indicatif du club)">OP</th>
          <th class="c" title="LoTW (★ = confirmé)">LoTW</th><th class="c">eQSL</th><th class="c" title="Club Log">CL</th><th class="c">QRZ</th><th class="lg-fill"></th></tr></thead>
        <tbody id="lgBody"><tr><td colspan="19" class="lg-empty">Chargement du carnet…</td></tr></tbody>
      </table>
    </div>
    <p class="lg-job" id="lgJob" aria-live="polite"></p>`;

  function mount(el) {
    root = el;
    root.innerHTML = PANE;
    if (getComputedStyle(root).position === 'static') root.style.position = 'relative'; // menus des filtres de colonne
    initCols();
    document.addEventListener('click', () => closeFlt());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFlt(); });
    q$('#lgFclr').addEventListener('click', () => { filt = {}; reload(); });
    const f = q$('#lgForm');
    for (const m of MODES) f.mode.add(new Option(m, m));
    f.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
    f.querySelector('[data-a="now"]').addEventListener('click', () => { const n = utcNow(); f.date.value = n.date; f.time.value = n.time; });
    f.querySelector('[data-a="trx"]').addEventListener('click', () => fromTrx(true));
    f.querySelector('[data-a="cancel"]').addEventListener('click', () => endEdit());
    f.querySelector('[data-a="del"]').addEventListener('click', () => {
      if (!editing) return;
      if (!window.confirm('Supprimer le QSO avec ' + editing.call + ' du ' + fmtDate(editing.qso_date) + ' ' + fmtTime(editing.time_on) + ' UTC ?\nLes carnets en ligne ne sont pas modifiés.')) return;
      api.send({ t: 'log_del', id: editing.id });
      endEdit();
    });
    f.mode.addEventListener('change', () => defaultRst(true));
    f.call.addEventListener('input', () => {
      f.call.value = f.call.value.toUpperCase();
      // Début du QSO : l'heure est prise à la première lettre tapée (sauf si elle a été écrite à la main)
      if (!editing && f.call.value.length === 1 && !f.time.dataset.manual) { const n = utcNow(); f.date.value = n.date; f.time.value = n.time; }
    });
    f.time.addEventListener('input', () => { f.time.dataset.manual = '1'; });
    // Indicatif tapé : nom, QTH et locator cherchés sur QRZ.com (si un compte QRZ est réglé), cases vides seulement
    f.call.addEventListener('change', () => { const c = f.call.value.trim(); if (/^[A-Z0-9/]{3,15}$/.test(c) && api) api.send({ t: 'qrz', call: c }); });
    // TX call du carnet = TX call de la ligne Correspondant : avec la main, le choix fait ici change aussi l'indicatif d'émission
    f.station.addEventListener('change', () => {
      if (editing) return;
      // Sans la main : choix gardé pour ce QSO seulement (l'indicatif d'émission est celui de l'opérateur qui a la main)
      if (!api || !api.iControl || !api.iControl()) { f.station.dataset.manual = '1'; return; }
      const v = f.station.value;
      const mine = String(me.call || '').toUpperCase();
      const clubs = (Array.isArray(me.clubCalls) && me.clubCalls.length ? me.clubCalls : [me.digiCall || '']).map((c) => String(c).toUpperCase());
      if (v !== mine && clubs.indexOf(v) < 0) return;
      try { localStorage.setItem('rs.txcall', v); } catch (e) { /* */ }
      api.send({ t: 'txcall', call: v });
    });
    f.gridsquare.addEventListener('input', () => { f.gridsquare.value = f.gridsquare.value.toUpperCase(); });
    f.freq.addEventListener('change', qoCheck);
    // Fréquence ou mode tapés à la main : ils ne suivent plus le TRX jusqu'au prochain QSO (ou ⇩ TRX)
    f.freq.addEventListener('input', () => { f.freq.dataset.manual = '1'; });
    f.mode.addEventListener('change', () => { f.mode.dataset.manual = '1'; });
    const search = q$('#lgSearch');
    search.addEventListener('input', () => { clearTimeout(listTimer); listTimer = setTimeout(reload, 300); });
    // Menus déroulants
    root.querySelectorAll('.lg-menu > .btn').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const l = b.nextElementSibling;
      const open = l.hidden;
      closeMenus();
      l.hidden = !open;
      b.setAttribute('aria-expanded', String(open));
    }));
    document.addEventListener('click', closeMenus);
    root.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { closeMenus(); openSync(b.dataset.s); }));
    root.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => { closeMenus(); openExport(b.dataset.x); }));
    // « Mes QSO » : tous les QSO faits sous mon indicatif personnel (TX call), en ADIF, tout de suite
    root.querySelectorAll('[data-xm]').forEach((b) => b.addEventListener('click', () => { closeMenus(); api.send({ t: 'log_export', fmt: 'adif', callsign: me.call }); }));
    root.querySelector('.lg-mlist [data-a="cfg"]').addEventListener('click', () => { closeMenus(); openCfg(); });
    q$('#lgBody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) startEdit(tr.dataset.id);
    });
    fromTrx(false);
    rights();
  }
  function closeMenus() {
    if (!root) return;
    root.querySelectorAll('.lg-mlist').forEach((l) => { l.hidden = true; });
    root.querySelectorAll('.lg-menu > .btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }
  function rights() {
    if (!root) return;
    const f = q$('#lgForm');
    const ro = !!me.rxOnly;
    f.querySelector('[data-a="save"]').disabled = ro;
    if (ro) fmsg('Indicatif d’écouteur : consultation du carnet seulement.', 'warn');
    q$('[data-m="sync"]').disabled = !me.admin;
    q$('[data-m="sync"]').title = me.admin ? '' : 'Réservé aux administrateurs';
    const sel = f.station;
    const keep = sel.value;
    sel.textContent = '';
    for (const c of calls) sel.add(new Option(c, c));
    if (keep && calls.indexOf(keep) >= 0) sel.value = keep;
  }
  function initCols() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('rs.lgcols') || '{}') || {}; } catch (e) { saved = {}; }
    const cols = Array.from(root.querySelectorAll('.lg-table col'));
    const ths = Array.from(root.querySelectorAll('.lg-table thead th'));
    const store = () => { try { localStorage.setItem('rs.lgcols', JSON.stringify(saved)); } catch (e) { /* */ } };
    const apply = () => cols.forEach((c, i) => { const [k, w] = LG_COLS[i]; const v = saved[k] || w; c.style.width = v ? v + 'px' : ''; });
    apply();
    ths.forEach((th, i) => {
      const [k, w] = LG_COLS[i] || [];
      if (!k || !w) return;
      // Choix d'une valeur (filtre) à côté du titre
      const fb = document.createElement('b');
      fb.className = 'lg-flt';
      fb.textContent = '▾';
      fb.title = 'Choisir une valeur de cette colonne';
      fb.addEventListener('click', (e) => { e.stopPropagation(); if (fltMenu && fltMenu.col === k) closeFlt(); else openFlt(k, th); });
      th.insertBefore(fb, th.firstChild ? th.firstChild.nextSibling : null);
      const h = document.createElement('i');
      h.className = 'lg-rz';
      h.title = 'Glisser : largeur de la colonne · double-clic : largeur d’origine';
      th.appendChild(h);
      h.addEventListener('click', (e) => e.stopPropagation());
      h.addEventListener('dblclick', (e) => { e.stopPropagation(); delete saved[k]; apply(); store(); });
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        h.setPointerCapture(e.pointerId);
        const x0 = e.clientX;
        const zf = (window.RSZOOM && window.RSZOOM.z()) || 1; // zoom du dashboard (zoom.js)
        const w0 = th.getBoundingClientRect().width / zf || saved[k] || w;
        const mv = (ev) => { saved[k] = Math.max(24, Math.min(600, Math.round(w0 + (ev.clientX - x0) / zf))); cols[i].style.width = saved[k] + 'px'; };
        const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); store(); };
        h.addEventListener('pointermove', mv);
        h.addEventListener('pointerup', up);
        h.addEventListener('pointercancel', up);
      });
    });
  }
  function fmsg(t, cls) {
    const el = q$('#lgFmsg');
    if (!el) return;
    el.textContent = t || '';
    el.className = 'lg-fmsg' + (cls ? ' ' + cls : '');
  }

  // ------------------------------------------------------------------ pré-remplissage (TRX + correspondant)
  function trxMode(rm) {
    const m = String(rm || '').toUpperCase();
    if (/^CW/.test(m)) return 'CW';
    if (/^RTTY/.test(m)) return 'RTTY';
    if (m === 'PSK') return 'PSK31';
    if (/DATA|-D$/.test(m)) return window.RSDIGI && window.RSDIGI.logMode ? window.RSDIGI.logMode() : 'FT8';
    if (/^LSB/.test(m)) return 'LSB';
    if (/^USB/.test(m)) return 'USB';
    if (/^AM/.test(m)) return 'AM';
    if (/^FM/.test(m)) return 'FM';
    return '';
  }
  function defaultRst(force) {
    const f = q$('#lgForm');
    const m = f.mode.value;
    const dx = loadDx();
    const want = DIGI.indexOf(m) >= 0 ? [dx.rpt || '-10', ''] : PHONE.indexOf(m) >= 0 ? ['59', '59'] : m === 'SSTV' ? ['595', '595'] : [dx.rst || '599', '599'];
    if (force || !f.rst_sent.value) f.rst_sent.value = want[0];
    if (force || !f.rst_rcvd.value) f.rst_rcvd.value = want[1];
  }
  function fromTrx(withDx) {
    if (!root || editing) return;
    const f = q$('#lgForm');
    const st = api && api.state && api.state();
    const r = st && st.radio;
    // VFO actif du TRX (côté SUB → VFO B)
    const hz = r && (r.vfoSel === 1 && r.freqB ? r.freqB : r.freq);
    if (hz) {
      f.freq.value = (hz / 1e6).toFixed(6).replace(/0{1,3}$/, '');
      const m = trxMode(r.vfoSel === 1 && r.modeB ? r.modeB : r.mode);
      if (m && (withDx || !f.mode.dataset.manual)) f.mode.value = m;
      if (r.power && !f.tx_pwr.value) f.tx_pwr.value = String(Math.round(r.power));
      delete f.freq.dataset.manual;
      qoCheck();
    }
    if (withDx || !f.call.value) {
      const dx = loadDx();
      if (dx.call && (withDx || String(dx.call).toUpperCase() !== lastLogged)) {
        f.call.value = String(dx.call).toUpperCase();
        f.name.value = dx.name || '';
        f.qth.value = dx.qth || '';
        f.gridsquare.value = dx.grid || '';
      }
    }
    if (!f.date.value || withDx) { const n = utcNow(); f.date.value = n.date; f.time.value = n.time; delete f.time.dataset.manual; }
    // Station : l'indicatif sous lequel on émet (« TX call ») s'il est dans la liste
    if (st && st.txCall && [...f.station.options].some((o) => o.value === st.txCall)) f.station.value = st.txCall;
    defaultRst(withDx);
    qoCheck();
  }
  // Fréquence sur la FI du convertisseur QO-100 (ex. 432,540 MHz) : QO-100 coché, fréquence de montée 2400,xxx
  function qoUp(f) {
    const fi = window.RSDIGI && window.RSDIGI.qo100If ? window.RSDIGI.qo100If() : { '2m': 144.5, '70cm': 432.5, '23cm': 1296.5 };
    for (const k of Object.keys(fi)) {
      const base = Number(fi[k]);
      if (base > 0 && f >= base && f <= base + 0.5) return 2400 + (f - base);
    }
    return 0;
  }
  function qoCheck() {
    const f = q$('#lgForm');
    const v = mhz(f.freq.value);
    if (!(v > 0)) return;
    const up = qoUp(v);
    if (up) {
      f.qo100.checked = true;
      fmsg('QO-100 : FI ' + v.toFixed(3) + ' MHz → montée ' + up.toFixed(3) + ' MHz (descente ' + (up + 8089.5).toFixed(3) + ' MHz)', '');
    } else if (v >= 2400 && v <= 2400.5) f.qo100.checked = true;
  }

  // ------------------------------------------------------------------ enregistrement / modification
  function formQso() {
    const f = q$('#lgForm');
    let fr = mhz(f.freq.value);
    if (f.qo100.checked && fr < 2400) { const up = qoUp(fr); if (up) fr = up; }
    const t = f.time.value.replace(/\D/g, '');
    return {
      call: f.call.value.trim().toUpperCase(), qso_date: f.date.value.replace(/\D/g, ''), time_on: (t.length === 3 ? '0' + t : t).padEnd(6, '0'),
      freq: Math.round(fr * 1e6) / 1e6, mode: f.mode.value, rst_sent: f.rst_sent.value.trim(), rst_rcvd: f.rst_rcvd.value.trim(),
      name: f.name.value.trim(), qth: f.qth.value.trim(), gridsquare: f.gridsquare.value.trim(), tx_pwr: f.tx_pwr.value.trim(),
      comment: f.comment.value.trim(), station: f.station.value, qo100: f.qo100.checked
    };
  }
  function save(force) {
    if (!api || viewOnly) return;
    const qso = formQso();
    if (!qso.call) return fmsg('Indicatif du correspondant ?', 'err');
    if (!(qso.freq > 0)) return fmsg('Fréquence en MHz ? (ex. 14.074)', 'err');
    if (editing) api.send({ t: 'log_edit', id: editing.id, qso });
    else api.send({ t: 'log_add', qso, force: !!force });
    fmsg('Enregistrement…', '');
  }
  let viewOnly = false; // fiche ouverte en consultation (pas le droit de modifier ce QSO)
  function startEdit(id) {
    const q = items.find((x) => x.id === id);
    if (!q) return;
    // Tout le monde peut ouvrir la fiche ; modifier / supprimer : administrateur, ou auteur du QSO avec la main
    const ctl = !!(api && api.iControl && api.iControl());
    const can = me.admin || (!me.rxOnly && q.by === me.call && ctl);
    editing = q;
    viewOnly = !can;
    const f = q$('#lgForm');
    f.call.value = q.call;
    f.date.value = q.qso_date.slice(0, 4) + '-' + q.qso_date.slice(4, 6) + '-' + q.qso_date.slice(6, 8);
    f.time.value = fmtTime(q.time_on);
    f.freq.value = q.freq;
    f.mode.value = MODES.indexOf(modeName(q)) >= 0 ? modeName(q) : q.mode === 'SSB' ? 'SSB' : 'DATA';
    for (const k of ['rst_sent', 'rst_rcvd', 'name', 'qth', 'gridsquare', 'tx_pwr', 'comment']) f[k].value = q[k] || '';
    if (calls.indexOf(q.station_callsign) >= 0) f.station.value = q.station_callsign;
    f.qo100.checked = q.sat_name === 'QO-100';
    f.querySelector('[data-a="save"]').textContent = 'Modifier le QSO';
    f.querySelector('[data-a="save"]').hidden = viewOnly;
    f.querySelector('[data-a="del"]').hidden = viewOnly;
    f.querySelector('[data-a="cancel"]').hidden = false;
    f.querySelector('[data-a="cancel"]').textContent = viewOnly ? 'Fermer' : 'Annuler';
    for (const el of f.querySelectorAll('input, select, textarea')) el.disabled = viewOnly;
    for (const el of f.querySelectorAll('button[data-a="now"], button[data-a="trx"]')) el.disabled = viewOnly;
    f.classList.add('editing');
    f.classList.toggle('viewonly', viewOnly);
    const info = ' — opérateur ' + (q.operator || '?') + ', enregistré par ' + (q.by || '?') + (q.country ? ', ' + q.country : '') + '.';
    if (viewOnly) {
      const why = me.rxOnly ? 'indicatif d’écouteur' : q.by !== me.call ? 'QSO d’un autre opérateur' : 'prenez la main pour le modifier';
      fmsg('Consultation du QSO avec ' + q.call + info + ' Lecture seule (' + why + ').', 'warn');
    } else {
      fmsg('Modification du QSO avec ' + q.call + info + ' Les carnets en ligne déjà servis ne sont pas modifiés : renvoyez-le si nécessaire.', 'warn');
    }
    drawList();
  }
  function endEdit() {
    editing = null;
    const f = q$('#lgForm');
    if (viewOnly) {
      viewOnly = false;
      for (const el of f.querySelectorAll('input, select, textarea, button')) el.disabled = false;
      f.querySelector('[data-a="save"]').hidden = false;
      f.classList.remove('viewonly');
    }
    f.querySelector('[data-a="cancel"]').textContent = 'Annuler';
    f.reset();
    delete f.freq.dataset.manual;
    delete f.mode.dataset.manual;
    f.querySelector('[data-a="save"]').textContent = 'Enregistrer le QSO';
    f.querySelector('[data-a="del"]').hidden = true;
    f.querySelector('[data-a="cancel"]').hidden = true;
    f.classList.remove('editing');
    rights();
    fmsg('');
    fromTrx(false);
    drawList();
  }

  // ------------------------------------------------------------------ liste
  function reload() {
    if (!api || !root) return;
    stale = false;
    api.send({ t: 'log_list', q: q$('#lgSearch').value.trim(), limit: 300, f: filt });
    drawFilt();
  }
  // ------------------------------------------------------------------ filtres par colonne (choix sous chaque titre)
  const FLT_FMT = {
    date: (v) => fmtDate(v), utc: (v) => (v ? v + ' h UTC' : '—'),
    lotw: (v) => v, eqsl: (v) => v, cl: (v) => v, qrz: (v) => v
  };
  const fltLabel = (col, v) => (v === '' ? '(vide)' : FLT_FMT[col] ? FLT_FMT[col](v) : v);
  function drawFilt() {
    if (!root) return;
    root.querySelectorAll('.lg-table thead th').forEach((th, i) => {
      const k = (LG_COLS[i] || [])[0];
      const b = th.querySelector('.lg-flt');
      if (!b) return;
      const on = filt[k] != null;
      th.classList.toggle('flt-on', on);
      b.textContent = on ? '●' : '▾';
      b.title = on ? 'Filtre : ' + fltLabel(k, filt[k]) + ' (clic : changer)' : 'Choisir une valeur de cette colonne';
    });
    const c = q$('#lgFclr');
    if (c) c.hidden = !Object.keys(filt).length;
  }
  function closeFlt() { if (fltMenu) { fltMenu.el.remove(); fltMenu = null; } }
  function openFlt(col, th) {
    closeFlt();
    const el = document.createElement('div');
    el.className = 'lg-fmenu';
    el.innerHTML = '<input class="lg-fq" placeholder="Rechercher…" aria-label="Rechercher une valeur"><div class="lg-fl"><p class="lg-fw">Chargement…</p></div>';
    root.appendChild(el);
    const r = th.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    el.style.left = Math.max(0, Math.min(r.left - rr.left, rr.width - 240)) + 'px';
    el.style.top = (r.bottom - rr.top + 2) + 'px';
    fltMenu = { col, el, values: [] };
    el.addEventListener('click', (e) => e.stopPropagation());
    el.querySelector('.lg-fq').addEventListener('input', () => fillFlt());
    el.querySelector('.lg-fq').focus();
    api.send({ t: 'log_values', col, q: q$('#lgSearch').value.trim(), f: filt });
  }
  function fillFlt() {
    if (!fltMenu) return;
    const { col, el, values } = fltMenu;
    const qq = el.querySelector('.lg-fq').value.trim().toUpperCase();
    const list = el.querySelector('.lg-fl');
    list.textContent = '';
    const add = (label, n, v, cur) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lg-fi' + (cur ? ' cur' : '');
      b.innerHTML = '<span></span><small></small>';
      b.firstChild.textContent = label;
      b.lastChild.textContent = n == null ? '' : n;
      b.addEventListener('click', () => {
        if (v == null) delete filt[col]; else filt[col] = v;
        closeFlt();
        reload();
      });
      list.appendChild(b);
    };
    add('(tous)', null, null, filt[col] == null);
    for (const [v, n] of values) {
      const lab = fltLabel(col, v);
      if (qq && String(lab).toUpperCase().indexOf(qq) < 0) continue;
      add(lab, n, v, filt[col] === v);
    }
  }
  function upCell(q, s) {
    const u = q.up && q.up[s];
    if (s === 'lotw' && q.lotw_qsl_rcvd === 'Y') return '<td class="c ok" title="Confirmé sur LoTW' + (q.lotw_qslrdate ? ' le ' + fmtDate(q.lotw_qslrdate) : '') + '">★</td>';
    if (!u) return '<td class="c no" title="Pas encore envoyé">·</td>';
    const when = new Date(u.t).toLocaleString('fr-BE');
    return '<td class="c ' + (u.ok ? 'ok' : 'ko') + '" title="' + esc(when + ' — ' + u.msg) + '">' + (u.ok ? '✓' : '✗') + '</td>';
  }
  function drawList() {
    const body = q$('#lgBody');
    if (!body) return;
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="19" class="lg-empty">' + (total ? 'Aucun QSO ne correspond à la recherche ou aux filtres.' : 'Carnet vide : enregistrez votre premier QSO ci-dessus.') + '</td></tr>';
    } else {
      body.innerHTML = items.map((q) => '<tr data-id="' + esc(q.id) + '"' + (editing && editing.id === q.id ? ' class="sel"' : '') + ' title="Cliquer pour modifier">' +
        '<td>' + fmtDate(q.qso_date) + '</td><td>' + fmtTime(q.time_on) + '</td><td class="call">' + esc(q.call) + '</td><td>' + esc(q.band) +
        (q.sat_name ? ' <span class="sat">' + esc(q.sat_name) + '</span>' : '') + '</td><td class="r">' + esc(q.freq) + '</td><td>' + esc(modeName(q)) +
        '</td><td>' + esc(q.rst_sent || '') + '</td><td>' + esc(q.rst_rcvd || '') + '</td><td class="grow">' + esc(q.name || '') + '</td><td class="lg-qth" title="' + esc(q.qth || '') + '">' + esc(q.qth || '') +
        '</td><td class="lg-cty" title="' + esc(q.country || '') + '">' + esc(q.country || '') + '</td><td>' + esc(q.dxcc_pfx || '') + '</td><td class="txc">' + esc(q.station_callsign || '') + '</td><td class="op" title="' + esc(q.by && q.by !== q.operator ? 'Enregistré par ' + q.by : '') + '">' + esc(q.operator || q.by || '') + '</td>' +
        SV.map((s) => upCell(q, s)).join('') + '<td class="lg-fill"></td></tr>').join('');
    }
    const c = q$('#lgCount');
    if (c) c.textContent = total + ' QSO au carnet' + (items.length < total ? ' · ' + items.length + ' affichés' : '');
  }

  // ------------------------------------------------------------------ fenêtres (dialog)
  function mkDlg(cls, html) {
    const d = document.createElement('dialog');
    d.className = 'macro-dlg lg-dlg ' + cls;
    d.innerHTML = html;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove());
    d.addEventListener('cancel', (e) => { if (d.dataset.busy === '1') e.preventDefault(); });
    d.showModal();
    return d;
  }
  function tabs(d) {
    d.querySelectorAll('.lg-tabs [data-t]').forEach((b) => b.addEventListener('click', () => showDlgTab(d, b.dataset.t)));
  }
  function showDlgTab(d, t) {
    d.querySelectorAll('.lg-tabs [data-t]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === t)));
    d.querySelectorAll('[data-p]').forEach((p) => { p.hidden = p.dataset.p !== t; });
  }
  // Export : administrateurs = tous les TX call du carnet ; membres = leur indicatif et leurs QSO sous les indicatifs du club
  let txcalls = [];
  let stCalls = [];
  function exportOptions() {
    const mine = String(me.call || '').toUpperCase();
    if (me.admin) {
      const l = Array.from(new Set([mine].concat(stCalls, txcalls).filter(Boolean)));
      return '<option value="">Tous les TX call</option>' + l.map((c) => '<option value="' + esc(c) + '"' + (c === mine ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
        stCalls.map((c) => '<option value="' + esc(c) + '|mine">' + esc(c) + ' — mes QSO</option>').join('');
    }
    return '<option value="' + esc(mine) + '">' + esc(mine) + ' (mon indicatif)</option>' +
      stCalls.map((c) => '<option value="' + esc(c) + '|mine">' + esc(c) + ' — mes QSO sous cet indicatif</option>').join('');
  }
  const callOptions = (all) => (all ? '<option value="">' + esc(all) + '</option>' : '') + calls.map((c) => '<option>' + esc(c) + '</option>').join('');

  // ---------- Synchronisation (Télécharger vers …)
  const STEPS = [['export', 'Exporter les QSOs'], ['sign', 'Signer les QSOs (TQSL)'], ['upload', 'Téléchargement vers LoTW'], ['fetch', 'Obtenir les confirmations LoTW'],
    ['import', 'Importer les confirmations'], ['status', 'Statut d’actualisation']];
  function openSync(s) {
    if (!me.admin) return say('Synchronisation : réservée aux administrateurs.', 'warn');
    if (sdlg && sdlg.el.open) sdlg.el.close();
    const lotw = s === 'lotw';
    const title = lotw ? 'Opérations LoTW' : 'Télécharger vers ' + NAMES[s];
    const d = mkDlg('lg-sync', '<form method="dialog">' +
      '<h3>' + title + '</h3>' +
      '<div class="lg-tabs" role="tablist"><button type="button" data-t="det" aria-selected="true">Détails</button><button type="button" data-t="proc" aria-selected="false">Traitement</button></div>' +
      '<div data-p="det" class="lg-pp">' +
      '<label>Indicatif (TX call) <select name="callsign">' + callOptions('Tous les indicatifs') + '</select></label>' +
      // Identifiants du service pour l'indicatif choisi : à vérifier avant chaque synchronisation (un compte par indicatif)
      '<fieldset class="lg-acct"><legend>Identifiants ' + NAMES[s] + ' de <b data-acall>—</b></legend><div class="lg-acf"></div><p class="lg-anote"></p>' +
      '<div class="lg-btns"><button type="button" class="btn" data-a="acct">Enregistrer pour cet indicatif</button></div></fieldset>' +
      '<fieldset><legend>Plage de dates (facultatif)</legend><label>Du <input type="date" name="from"></label><label>Au <input type="date" name="to"></label></fieldset>' +
      '<label class="lg-chk"><input type="checkbox" name="all"> Renvoyer aussi les QSO déjà envoyés</label>' +
      (s === 'clublog' ? '<label class="lg-chk warn"><input type="checkbox" name="clear"> Effacer le log ClubLog existant (remplacé par tout le carnet de l’indicatif)</label>' : '') +
      (lotw ? '' : '<label class="lg-w8">Temporisation (secondes) <input type="number" name="delay" min="0" max="120" step="1"></label>') +
      '<p class="lg-pend">…</p>' +
      (lotw ? '<div class="lg-alt"><p><b>Serveur sans TQSL</b> (VPS) : le certificat LoTW reste sur le PC du club. Exportez les QSO non envoyés, signez-les avec TQSL sur ce PC, puis notez-les comme envoyés.</p>' +
        '<div class="lg-btns"><button class="btn" type="button" data-a="exp">Exporter pour TQSL (.adi)</button><button class="btn" type="button" data-a="mark" disabled>Marquer comme envoyés</button></div></div>' : '') +
      '</div>' +
      '<div data-p="proc" class="lg-pp" hidden>' +
      (lotw ? '<ol class="lg-steps">' + STEPS.map(([id, t]) => '<li data-s="' + id + '">' + t + '</li>').join('') + '</ol>' : '') +
      '<div class="lg-prog"><div></div></div><p class="lg-cnt"></p><pre class="lg-log"></pre>' +
      '</div>' +
      '<div class="md-act">' + (lotw ? '<button class="btn" type="button" data-a="confirm" title="Lire seulement les confirmations reçues sur LoTW">Confirmations</button>' : '') +
      '<span></span><button class="btn" type="button" data-a="stop" disabled>Arrêt</button><button class="btn" value="cancel" data-a="close">Fermer</button>' +
      '<button class="btn btn-primary" type="button" data-a="go">' + (lotw ? 'Synchronisation LoTW' : 'Télécharger') + '</button></div></form>');
    sdlg = { service: s, el: d, job: null };
    tabs(d);
    const f = d.querySelector('form');
    // Indicatif proposé : le TX call actuel (ou le premier de la liste), pour voir tout de suite ses identifiants
    const stx = api && api.state && api.state();
    const cur = stx && stx.txCall && calls.indexOf(stx.txCall) >= 0 ? stx.txCall : calls[0];
    if (cur) f.callsign.value = cur;
    const acctAsk = () => {
      const c = f.callsign.value;
      d.querySelector('[data-acall]').textContent = c || '—';
      const box = d.querySelector('.lg-acf');
      d.querySelector('[data-a="acct"]').hidden = !c;
      if (!c) { box.innerHTML = ''; d.querySelector('.lg-anote').textContent = 'Choisissez un indicatif pour voir et régler ses identifiants : chaque indicatif est envoyé avec les siens.'; return; }
      box.innerHTML = '<p class="lg-anote">Chargement…</p>';
      api.send({ t: 'log_acct_get', service: s, call: c });
    };
    f.callsign.addEventListener('change', acctAsk);
    acctAsk();
    d.querySelector('[data-a="acct"]').addEventListener('click', () => {
      const c = f.callsign.value;
      if (!c) return;
      const fields = {};
      d.querySelectorAll('.lg-acf [data-af]').forEach((i) => { fields[i.dataset.af] = i.dataset.clear === '1' && !i.value.trim() ? '__effacer__' : i.value.trim(); });
      api.send({ t: 'log_acct_set', service: s, call: c, fields });
    });
    const filt = () => ({ callsign: f.callsign.value, from: f.from.value, to: f.to.value, all: f.all.checked || !!(f.clear && f.clear.checked) });
    const askPending = () => api.send(Object.assign({ t: 'log_pending', service: s }, filt()));
    for (const n of ['callsign', 'from', 'to', 'all', 'clear']) if (f[n]) f[n].addEventListener('change', askPending);
    askPending();
    api.send({ t: 'log_cfg_get', quiet: true });
    if (f.clear) f.clear.addEventListener('change', () => {
      if (f.clear.checked && !window.confirm('Club Log : le log existant de l’indicatif sera EFFACÉ puis remplacé par tous les QSO de ce carnet.\nÀ n’utiliser que si ce carnet est complet. Continuer ?')) f.clear.checked = false;
      askPending();
    });
    const go = (action) => {
      sdlg.job = 'wait';
      showDlgTab(d, 'proc');
      d.querySelector('.lg-log').textContent = '';
      d.querySelectorAll('.lg-steps li').forEach((li) => { li.className = ''; });
      d.querySelector('.lg-prog > div').style.width = '0%';
      busy(true);
      const m = Object.assign({ t: 'log_sync', service: s, action }, filt());
      if (f.clear) m.clear = f.clear.checked;
      if (f.delay && f.delay.value !== '') m.delay = Number(f.delay.value);
      api.send(m);
    };
    d.querySelector('[data-a="go"]').addEventListener('click', () => go('send'));
    if (lotw) d.querySelector('[data-a="confirm"]').addEventListener('click', () => go('confirm'));
    d.querySelector('[data-a="stop"]').addEventListener('click', () => { api.send({ t: 'log_sync', service: s, action: 'stop' }); syncLog('Arrêt demandé…'); });
    if (lotw) {
      d.querySelector('[data-a="exp"]').addEventListener('click', () => api.send(Object.assign({ t: 'log_export', fmt: 'adif', pending: 'lotw' }, filt())));
      d.querySelector('[data-a="mark"]').addEventListener('click', () => {
        if (!lastExport || !lastExport.ids.length) return;
        if (!window.confirm(lastExport.ids.length + ' QSO notés comme envoyés à LoTW (après leur signature avec TQSL) ?')) return;
        api.send({ t: 'log_mark', service: 'lotw', ids: lastExport.ids });
        lastExport = null;
        d.querySelector('[data-a="mark"]').disabled = true;
        askPending();
      });
    }
  }
  function busy(on) {
    if (!sdlg) return;
    const d = sdlg.el;
    d.dataset.busy = on ? '1' : '';
    d.querySelector('[data-a="stop"]').disabled = !on;
    d.querySelector('[data-a="go"]').disabled = on;
    d.querySelector('[data-a="close"]').disabled = on;
    const c = d.querySelector('[data-a="confirm"]');
    if (c) c.disabled = on;
  }
  function syncLog(line) {
    if (!sdlg || !line) return;
    const pre = sdlg.el.querySelector('.lg-log');
    pre.textContent += line + '\n';
    pre.scrollTop = pre.scrollHeight;
  }
  function onJob(m) {
    const j = m.job || {};
    // Envois automatiques : dernière ligne sous la liste
    if (j.auto) {
      const el = q$('#lgJob');
      if (el && m.line && !/QSO à envoyer$/.test(m.line)) { el.textContent = NAMES[j.service] + ' · ' + m.line; el.classList.toggle('err', /^✗|arrêtés/.test(m.line)); }
    }
    if (!sdlg || !sdlg.el.open || sdlg.service !== j.service || j.auto || !sdlg.job) return;
    if (sdlg.job === 'wait') sdlg.job = j.id;
    if (sdlg.job !== j.id) return;
    const d = sdlg.el;
    syncLog(m.line);
    if (m.step) {
      const li = d.querySelector('.lg-steps li[data-s="' + m.step.id + '"]');
      if (li) li.className = m.step.state;
    }
    if (j.total) {
      d.querySelector('.lg-prog > div').style.width = Math.round(100 * j.done / j.total) + '%';
      d.querySelector('.lg-cnt').textContent = j.done + ' / ' + j.total + ' · ' + j.ok + ' envoyé(s) · ' + j.fail + ' en échec';
    }
    if (m.fin) {
      busy(false);
      sdlg.job = null;
      api.send({ t: 'log_pending', service: sdlg.service });
    }
  }

  // ---------- Export ADIF / Cabrillo
  function openExport(fmt) {
    const d = mkDlg('lg-exp', '<form method="dialog"><h3>Exporter le carnet</h3><div class="lg-pp">' +
      '<label>Format <select name="fmt"><option value="adif">ADIF 3 (.adi) — logbooks, LoTW, eQSL, Club Log…</option><option value="cabrillo">Cabrillo 3 (.log) — concours</option></select></label>' +
      '<label>TX call <select name="callsign">' + exportOptions() + '</select></label>' +
      '<fieldset><legend>Plage de dates (facultatif)</legend><label>Du <input type="date" name="from"></label><label>Au <input type="date" name="to"></label></fieldset>' +
      '<label data-cab>Concours (CONTEST) <input name="contest" list="lgContests" placeholder="DX" maxlength="40"></label>' +
      '<datalist id="lgContests">' + CONTESTS.map((c) => '<option value="' + c + '">').join('') + '</datalist>' +
      '<p class="lg-note" data-cab>Cabrillo : un seul indicatif par fichier ; l’échange envoyé / reçu vient des champs « numéro » ou du locator (4 caractères).</p>' +
      '</div><div class="md-act"><span></span><button class="btn" value="cancel">Annuler</button><button class="btn btn-primary" type="button" data-a="go">Exporter</button></div></form>');
    const f = d.querySelector('form');
    f.fmt.value = fmt;
    const upd = () => {
      d.querySelectorAll('[data-cab]').forEach((x) => { x.hidden = f.fmt.value !== 'cabrillo'; });
      if (f.fmt.value === 'cabrillo' && !f.callsign.value && calls[0]) f.callsign.value = calls[0];
    };
    f.fmt.addEventListener('change', upd);
    upd();
    d.querySelector('[data-a="go"]').addEventListener('click', () => {
      const [cs, mine] = String(f.callsign.value).split('|');
      api.send({ t: 'log_export', fmt: f.fmt.value, callsign: cs, mine: mine === 'mine', from: f.from.value, to: f.to.value, contest: f.contest.value.trim() });
      d.close();
    });
  }
  function download(m) {
    const blob = new Blob([m.data], { type: (m.mime || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    say(m.count + ' QSO exportés dans ' + m.name, '');
    if (m.pending === 'lotw') {
      lastExport = { ids: m.ids || [] };
      if (sdlg && sdlg.service === 'lotw' && sdlg.el.open) sdlg.el.querySelector('[data-a="mark"]').disabled = !lastExport.ids.length;
    }
  }

  // ---------- Configuration
  const SECRET_PH = '•••••• enregistré — vide = inchangé';
  function secretField(label, svc, key, cfg, hint) {
    const has = cfg[svc] && cfg[svc]['has_' + key];
    return '<label>' + label + '<span class="lg-pw"><input type="password" name="' + svc + '.' + key + '" autocomplete="new-password" placeholder="' + (has ? SECRET_PH : '') + '">' +
      '<button type="button" class="lg-eye" title="Afficher / masquer" aria-label="Afficher le mot de passe">👁</button>' +
      (has ? '<button type="button" class="lg-clr" data-clr="' + svc + '.' + key + '" title="Effacer la valeur enregistrée">✕</button>' : '') + '</span>' +
      (hint ? '<small>' + hint + '</small>' : '') + '</label>';
  }
  const textField = (label, name, v, hint, extra) => '<label>' + label + '<input name="' + name + '" value="' + esc(v) + '" ' + (extra || '') + '>' + (hint ? '<small>' + hint + '</small>' : '') + '</label>';
  const common = (s, c) => '<label class="lg-chk"><input type="checkbox" name="' + s + '.auto"' + (c.auto ? ' checked' : '') + '> Télécharger automatiquement les QSO lors de leur enregistrement</label>' +
    '<label class="lg-w8">Temporisation (secondes) <input type="number" min="0" max="120" name="' + s + '.delay" value="' + esc(c.delay) + '"><small>Pause entre deux QSO lors d’un envoi en lot.</small></label>';
  function udpRow(u) {
    const fmts = [['wsjtx-adif', 'WSJT-X « Logged ADIF » (type 12)'], ['wsjtx-qso', 'WSJT-X « QSO Logged » (type 5)'], ['n1mm', 'N1MM Logger+ (XML contactinfo)'], ['adif', 'ADIF brut']];
    return '<tr><td><input type="checkbox" data-k="enabled"' + (u.enabled ? ' checked' : '') + ' aria-label="Actif"></td>' +
      '<td><input data-k="label" value="' + esc(u.label || '') + '" placeholder="Swisslog" maxlength="40"></td>' +
      '<td><input data-k="host" value="' + esc(u.host || '') + '" placeholder="127.0.0.1" maxlength="100"></td>' +
      '<td><input data-k="port" type="number" min="1" max="65535" value="' + esc(u.port || '') + '" placeholder="2237"></td>' +
      '<td><select data-k="format">' + fmts.map(([v, t]) => '<option value="' + v + '"' + (u.format === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></td>' +
      '<td><button type="button" class="lg-clr" data-a="rm" title="Retirer">✕</button></td></tr>';
  }
  function qrzRow(call, has) {
    return '<tr><td><input data-k="call" value="' + esc(call) + '" placeholder="ON5VL" maxlength="15"></td>' +
      '<td><span class="lg-pw"><input type="password" data-k="key" autocomplete="new-password" placeholder="' + (has ? SECRET_PH : 'XXXX-XXXX-XXXX-XXXX') + '">' +
      '<button type="button" class="lg-eye" title="Afficher / masquer">👁</button></span></td>' +
      '<td><button type="button" class="lg-clr" data-a="rmq" title="Retirer cette clé">✕</button></td></tr>';
  }
  function openCfg() {
    if (!me.admin) return say('Configuration des carnets en ligne : réservée aux administrateurs.', 'warn');
    cdlg = { el: null };
    api.send({ t: 'log_cfg_get' });
  }
  function drawCfg(cfg, saved) {
    if (cdlg && cdlg.el && cdlg.el.open) {
      if (saved) { cdlg.el.close(); say('Réglages des carnets en ligne enregistrés.', ''); }
      return;
    }
    const keys = Object.assign({}, cfg.qrz.has_keys || {});
    for (const c of calls) if (!(c in keys)) keys[c] = false;
    const d = mkDlg('lg-cfg', '<form method="dialog" autocomplete="off"><h3>Configuration de carnets de trafic en ligne</h3>' +
      '<div class="lg-tabs" role="tablist">' + [['clublog', 'CLUBLOG'], ['eqsl', 'eQSL'], ['lotw', 'LoTW'], ['qrz', 'QRZ'], ['udp', 'UDP']].map(([k, t], i) =>
        '<button type="button" data-t="' + k + '" aria-selected="' + (i === 0) + '">' + t + '</button>').join('') + '</div>' +
      // Club Log
      '<div data-p="clublog" class="lg-pp">' + common('clublog', cfg.clublog) +
      textField('Adresse e-mail', 'clublog.email', cfg.clublog.email, '', 'type="email" maxlength="200"') +
      secretField('Mot de passe', 'clublog', 'password', cfg, 'Un <b>mot de passe d’application</b> (Club Log → Settings → App Passwords) est conseillé.') +
      secretField('Clé API', 'clublog', 'api', cfg, 'Clé de l’application Remote Station, demandée une fois au helpdesk de Club Log.') +
      '<p class="lg-note">Un refus d’accès (erreur 403) arrête les envois automatiques jusqu’au prochain « OK » de cette fenêtre : Club Log bloque les programmes qui insistent.</p>' + testRow('clublog') + '</div>' +
      // eQSL
      '<div data-p="eqsl" class="lg-pp" hidden>' + common('eqsl', cfg.eqsl) +
      textField('Indicatif (identifiant eQSL)', 'eqsl.user', cfg.eqsl.user, '', 'maxlength="20" style="text-transform:uppercase"') +
      secretField('Mot de passe', 'eqsl', 'password', cfg) +
      textField('QTH Nickname (facultatif)', 'eqsl.nickname', cfg.eqsl.nickname, 'Si le compte eQSL a plusieurs QTH : le surnom exact du QTH du club.', 'maxlength="60"') +
      testRow('eqsl') + '</div>' +
      // LoTW
      '<div data-p="lotw" class="lg-pp" hidden>' + common('lotw', cfg.lotw) +
      textField('Programme TQSL', 'lotw.tqsl', cfg.lotw.tqsl, 'Sur le PC où le <b>certificat LoTW</b> est installé (serveur Windows du club). Le certificat et son mot de passe ne quittent jamais ce PC.', 'maxlength="300"') +
      textField('Dossier TrustedQSL (facultatif)', 'lotw.tqslDir', cfg.lotw.tqslDir, 'Serveur Windows en service : dossier du compte où le certificat est importé, ex. C:\\Users\\Club\\AppData\\Roaming\\TrustedQSL.', 'maxlength="300"') +
      textField('Lieu de station TQSL (Station Location)', 'lotw.location', cfg.lotw.location, 'Nom exact du lieu créé dans TQSL (ex. ON5VL Liège).', 'maxlength="100"') +
      secretField('Mot de passe du certificat (si protégé)', 'lotw', 'password', cfg) +
      textField('Identifiant du site LoTW', 'lotw.login', cfg.lotw.login, 'Pour lire les confirmations (lotwreport.adi).', 'maxlength="40"') +
      secretField('Mot de passe du site LoTW', 'lotw', 'webPassword', cfg) +
      '<p class="lg-note">Confirmations lues jusqu’au : <b>' + esc(cfg.lotw.lastConfirm || 'jamais') + '</b>. Serveur sans TQSL (VPS) : utilisez « Exporter pour TQSL » dans Synchronisation LoTW.</p>' +
      testRow('lotw') + '</div>' +
      // QRZ
      '<div data-p="qrz" class="lg-pp" hidden>' + common('qrz', cfg.qrz) +
      '<p class="lg-note">Une clé API du carnet QRZ par indicatif de station (QRZ.com → Logbook → Settings → API Key ; abonnement XML ou supérieur).</p>' +
      '<table class="lg-grid" data-g="qrz"><thead><tr><th>Indicatif</th><th>Clé API</th><th></th></tr></thead><tbody>' +
      Object.entries(keys).map(([c, h]) => qrzRow(c, h)).join('') + '</tbody></table>' +
      '<div class="lg-btns"><button class="btn" type="button" data-a="addq">+ Ajouter un indicatif</button></div>' + testRow('qrz') +
      '<h4 class="lg-h4">Recherche des correspondants (nom, QTH, locator)</h4>' +
      '<p class="lg-note">Compte QRZ.com utilisé pour remplir tout seul le nom et le QTH du correspondant (ligne Correspondant, carnet). ' +
      'Sans abonnement XML, QRZ ne donne que le prénom, le nom, la ville et le pays ; avec, aussi le locator. Gardé sur le serveur, jamais renvoyé au navigateur.</p>' +
      textField('Identifiant QRZ.com', 'qrz.lookupUser', cfg.qrz.lookupUser, '', 'maxlength="40" autocomplete="off"') +
      secretField('Mot de passe QRZ.com', 'qrz', 'lookupPassword', cfg) +
      testRow('qrzxml') + '</div>' +
      // UDP
      '<div data-p="udp" class="lg-pp" hidden>' +
      '<p class="lg-note">Chaque QSO enregistré est aussi envoyé en UDP aux logbooks du PC (Swisslog, HRD Logbook, Log4OM, N1MM Logger+, DXKeeper…). ' +
      'Les paquets partent du <b>serveur</b> : avec le serveur Windows sur le PC du club, adresse 127.0.0.1 ; depuis le VPS, il faut une adresse joignable depuis internet (redirection de port).</p>' +
      '<table class="lg-grid" data-g="udp"><thead><tr><th>Actif</th><th>Nom</th><th>Adresse</th><th>Port</th><th>Format</th><th></th></tr></thead><tbody>' +
      (cfg.udp || []).map(udpRow).join('') + '</tbody></table>' +
      '<div class="lg-btns"><button class="btn" type="button" data-u="wsjtx">+ WSJT-X (port 2237)</button><button class="btn" type="button" data-u="n1mm">+ N1MM Logger+ (port 12060)</button>' +
      '<button class="btn" type="button" data-u="adif">+ ADIF brut</button></div>' +
      '<p class="lg-note">Ports habituels, à vérifier dans les réglages du logbook. Swisslog, Log4OM et HRD Logbook acceptent le format WSJT-X.</p></div>' +
      '<div class="md-act"><span></span><button class="btn" value="cancel">Annuler</button><button class="btn btn-primary" type="button" data-a="ok">OK</button></div></form>');
    cdlg = { el: d };
    d.addEventListener('close', () => { if (cdlg && cdlg.el === d) cdlg = null; });
    tabs(d);
    const f = d.querySelector('form');
    d.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('lg-eye')) {
        const i = b.parentElement.querySelector('input');
        i.type = i.type === 'password' ? 'text' : 'password';
      } else if (b.dataset.clr) {
        const i = f.elements[b.dataset.clr];
        i.value = '';
        i.dataset.clear = '1';
        i.placeholder = 'sera effacé à l’enregistrement';
        b.remove();
      } else if (b.dataset.a === 'rm' || b.dataset.a === 'rmq') {
        const tr = b.closest('tr');
        if (b.dataset.a === 'rmq') { const c = tr.querySelector('[data-k="call"]').value.trim().toUpperCase(); if (c) (f._delq = f._delq || []).push(c); }
        tr.remove();
      } else if (b.dataset.a === 'addq') {
        d.querySelector('[data-g="qrz"] tbody').insertAdjacentHTML('beforeend', qrzRow('', false));
      } else if (b.dataset.u) {
        const p = { wsjtx: { label: 'Swisslog', port: 2237, format: 'wsjtx-adif' }, n1mm: { label: 'N1MM', port: 12060, format: 'n1mm' }, adif: { label: '', port: '', format: 'adif' } }[b.dataset.u];
        d.querySelector('[data-g="udp"] tbody').insertAdjacentHTML('beforeend', udpRow(Object.assign({ enabled: true, host: '127.0.0.1' }, p)));
      } else if (b.dataset.test) {
        const out = d.querySelector('[data-tr="' + b.dataset.test + '"]');
        out.textContent = 'Enregistrez d’abord (OK) les réglages modifiés · test en cours…';
        out.className = 'lg-tres';
        api.send(b.dataset.test === 'qrzxml' ? { t: 'qrz_test' } : { t: 'log_test', service: b.dataset.test });
      } else if (b.dataset.a === 'ok') {
        api.send({ t: 'log_cfg_set', cfg: readCfg(f) });
      }
    });
  }
  const testRow = (s) => '<div class="lg-btns"><button class="btn" type="button" data-test="' + s + '">Tester</button><span class="lg-tres" data-tr="' + s + '"></span></div>';
  function readCfg(f) {
    const v = (n) => { const i = f.elements[n]; if (!i) return undefined; if (i.type === 'checkbox') return i.checked; if (i.dataset.clear === '1' && !i.value) return '__effacer__'; return i.value.trim(); };
    const out = {};
    const fields = { clublog: ['auto', 'delay', 'email', 'password', 'api'], eqsl: ['auto', 'delay', 'user', 'password', 'nickname'], qrz: ['auto', 'delay', 'lookupUser', 'lookupPassword'],
      lotw: ['auto', 'delay', 'tqsl', 'tqslDir', 'location', 'password', 'login', 'webPassword'] };
    for (const [s, ks] of Object.entries(fields)) { out[s] = {}; for (const k of ks) { const x = v(s + '.' + k); if (x !== undefined) out[s][k] = x; } }
    if (out.eqsl.user) out.eqsl.user = out.eqsl.user.toUpperCase();
    out.qrz.keys = {};
    for (const c of f._delq || []) out.qrz.keys[c] = '__effacer__';
    f.querySelectorAll('[data-g="qrz"] tbody tr').forEach((tr) => {
      const c = tr.querySelector('[data-k="call"]').value.trim().toUpperCase();
      const k = tr.querySelector('[data-k="key"]').value.trim();
      if (c && k) out.qrz.keys[c] = k;
    });
    out.udp = [];
    f.querySelectorAll('[data-g="udp"] tbody tr').forEach((tr) => {
      const g = (k) => tr.querySelector('[data-k="' + k + '"]');
      out.udp.push({ enabled: g('enabled').checked, label: g('label').value.trim(), host: g('host').value.trim(), port: Number(g('port').value), format: g('format').value });
    });
    return out;
  }

  // ------------------------------------------------------------------ messages du serveur
  function onMessage(m) {
    if (m.t === 'log_values') {
      if (fltMenu && fltMenu.col === m.col) { fltMenu.values = m.values || []; fillFlt(); }
      return;
    }
    if (m.t === 'log_list') {
      items = m.items || [];
      total = m.total || 0;
      if (Array.isArray(m.calls)) { calls = m.calls; rights(); }
      if (Array.isArray(m.txcalls)) txcalls = m.txcalls;
      if (Array.isArray(m.stationCalls)) stCalls = m.stationCalls;
      if (editing) editing = items.find((x) => x.id === editing.id) || editing;
      drawList();
    } else if (m.t === 'log_changed') {
      if (root && !root.hidden) { clearTimeout(listTimer); listTimer = setTimeout(reload, 200); } else stale = true;
    } else if (m.t === 'log_saved') {
      const q = m.qso || {};
      if (m.edited) { lastLogged = q.call; endEdit(); say('QSO avec ' + q.call + ' modifié.', ''); return; }
      const auto = SV.filter((s) => m.auto && m.auto[s]);
      const okMsg = '✓ QSO avec ' + q.call + ' enregistré (' + q.band + ' ' + modeName(q) + ').' + (auto.length ? ' Envoi automatique : ' + auto.map((s) => NAMES[s]).join(', ') + '.' : '');
      lastLogged = q.call;
      // Enregistré depuis un autre onglet (fiche du QSO RTTY / JTTY / CW, FT8 auto) : message en bas de l'écran
      if (!root || root.hidden || !root.offsetParent) say(okMsg, 'ok');
      if (!root) return;
      // Fiche en cours de modification d'un autre QSO (QSO enregistré ailleurs, ex. fin de QSO FT8) : on n'y touche pas
      if (editing) { say(okMsg, 'ok'); return; }
      const f = q$('#lgForm');
      for (const k of ['call', 'name', 'qth', 'gridsquare', 'comment', 'rst_rcvd']) f[k].value = '';
      delete f.time.dataset.manual;
      delete f.freq.dataset.manual;
      delete f.mode.dataset.manual;
      defaultRst(true);
      fmsg(okMsg, 'ok');
      f.call.focus();
    } else if (m.t === 'log_dupe') {
      const p = m.prev || {};
      pendingDupe = m.qso;
      // Même QSO déjà enregistré (ex. en fin de QSO) : on complète la fiche existante (nom, QTH, locator…) plutôt qu'un 2e QSO
      const q = m.qso || {};
      const extra = ['name', 'qth', 'gridsquare', 'rst_rcvd', 'comment', 'tx_pwr'].filter((k) => q[k] && !p[k]);
      const LBL = { name: 'nom', qth: 'QTH', gridsquare: 'locator', rst_rcvd: 'RST reçu', comment: 'remarque', tx_pwr: 'puissance' };
      if (p.id && extra.length && window.confirm(p.call + ' est déjà dans le carnet (' + p.band + ' ' + modeName(p) + ', ' + fmtDate(p.qso_date) + ' à ' + fmtTime(p.time_on) + ' UTC).\n' +
          'Compléter ce QSO avec : ' + extra.map((k) => LBL[k] + ' « ' + q[k] + ' »').join(', ') + ' ?')) {
        api.send({ t: 'log_merge', id: p.id, qso: q });
        pendingDupe = null;
        return;
      }
      if (window.confirm('Doublon possible : ' + p.call + ' déjà dans le carnet sur ' + p.band + ' ' + modeName(p) + ' le ' + fmtDate(p.qso_date) + ' à ' + fmtTime(p.time_on) + ' UTC.\nEnregistrer quand même ?')) {
        api.send({ t: 'log_add', qso: pendingDupe, force: true });
      } else if (root && !root.hidden && root.offsetParent) fmsg('QSO non enregistré (doublon).', 'warn'); else say('QSO non enregistré (doublon).', 'warn');
      pendingDupe = null;
    } else if (m.t === 'log_export') {
      download(m);
    } else if (m.t === 'log_job') {
      onJob(m);
    } else if (m.t === 'log_pending') {
      if (sdlg && sdlg.el.open && sdlg.service === m.service) {
        const p = sdlg.el.querySelector('.lg-pend');
        p.textContent = m.n + ' QSO à envoyer vers ' + NAMES[m.service] + (m.busy ? ' · un envoi est déjà en cours' : '') + (m.stopped ? ' · envois arrêtés après un refus d’accès : vérifiez la configuration' : '');
        p.classList.toggle('warn', !!m.stopped);
      }
    } else if (m.t === 'log_acct') {
      if (!sdlg || !sdlg.el.open || sdlg.service !== m.service) return;
      const f = sdlg.el.querySelector('form');
      if (f.callsign.value !== m.call) return;
      const UI = {
        clublog: [['email', 'E-mail du compte Club Log'], ['password', 'Mot de passe', 1], ['api', 'Clé API (application)', 1]],
        eqsl: [['user', 'Indicatif / identifiant eQSL'], ['password', 'Mot de passe', 1], ['nickname', 'QTH nickname (facultatif)']],
        lotw: [['location', 'Lieu de station TQSL (Station Location)'], ['password', 'Mot de passe du certificat (facultatif)', 1], ['login', 'Identifiant du site LoTW (confirmations)'], ['webPassword', 'Mot de passe du site LoTW', 1]],
        qrz: [['key', 'Clé API du logbook QRZ.com', 1]]
      }[m.service] || [];
      const box = sdlg.el.querySelector('.lg-acf');
      box.innerHTML = UI.map(([k, lab, sec]) => '<label>' + esc(lab) + ' ' + (sec
        ? '<span class="lg-pw"><input data-af="' + k + '" type="password" autocomplete="new-password" placeholder="' + (m.has && m.has[k] ? SECRET_PH : 'à renseigner') + '">' +
          '<button type="button" class="lg-eye" title="Afficher / masquer" aria-label="Afficher le mot de passe">👁</button>' +
          (m.source === 'compte' && m.has && m.has[k] ? '<button type="button" class="lg-clr" data-aclr="' + k + '" title="Effacer la valeur enregistrée pour cet indicatif">✕</button>' : '') + '</span>'
        : '<input data-af="' + k + '" value="' + esc((m.fields || {})[k] || '') + '" autocomplete="off">') + '</label>').join('');
      box.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const i = b.parentElement.querySelector('input');
        if (b.classList.contains('lg-eye')) i.type = i.type === 'password' ? 'text' : 'password';
        else if (b.dataset.aclr) { i.value = ''; i.dataset.clear = '1'; i.placeholder = 'sera effacé à l’enregistrement'; b.remove(); }
      };
      const missing = UI.filter(([k, , sec]) => k !== 'nickname' && k !== 'login' && k !== 'webPassword' && !(m.service === 'lotw' && k === 'password') && !(sec ? m.has && m.has[k] : (m.fields || {})[k]));
      const note = sdlg.el.querySelector('.lg-anote');
      note.textContent = (m.source === 'compte' ? 'Identifiants propres à ' + m.call + '.' : m.source === 'club' ? 'Identifiants généraux du club (⚙ Configuration), utilisés pour ' + m.call + ' ; vous pouvez lui en donner de propres ici.' : 'Aucun identifiant pour ' + m.call + ' : à renseigner avant la synchronisation.') +
        (missing.length ? ' Manque : ' + missing.map((x) => x[1].toLowerCase()).join(', ') + '.' : '') + (m.saved ? ' ✓ Enregistré.' : '');
      note.classList.toggle('warn', !!missing.length);
    } else if (m.t === 'log_cfg') {
      calls = m.calls || calls;
      if (sdlg && sdlg.el.open) {
        const c = m.cfg[sdlg.service] || {};
        const f = sdlg.el.querySelector('form');
        if (f.delay && f.delay.value === '') f.delay.value = c.delay;
      }
      if (cdlg && !m.quiet) drawCfg(m.cfg, m.saved);
    } else if (m.t === 'log_test') {
      const out = cdlg && cdlg.el && cdlg.el.querySelector('[data-tr="' + m.service + '"]');
      if (out) { out.textContent = (m.ok ? '✓ ' : '✗ ') + m.msg; out.className = 'lg-tres ' + (m.ok ? 'ok' : 'err'); }
    }
  }

  window.RSLOG = {
    init(a) { api = a; },
    // Fiche du carnet : fréquence et mode suivent tout seuls le VFO actif du TRX (sauf saisie à la main ou modification d'un QSO)
    onState() {
      if (!root || editing) return;
      // TX call de la ligne Correspondant → TX call du carnet (dès qu'il change)
      const s0 = api && api.state && api.state();
      const tc = s0 && s0.txCall ? String(s0.txCall).toUpperCase() : '';
      const f0 = q$('#lgForm');
      if (f0 && tc && [...f0.station.options].some((o) => o.value === tc)) {
        if (tc !== lastTxCall) { delete f0.station.dataset.manual; lastTxCall = tc; }
        if (!f0.station.dataset.manual && f0.station.value !== tc) f0.station.value = tc;
      }
      if (root.hidden) return;
      const f = q$('#lgForm');
      if (!f || f.freq.dataset.manual || f.contains(document.activeElement) && document.activeElement === f.freq) return;
      const st = api && api.state && api.state();
      const r = st && st.radio;
      const hz = r && (r.vfoSel === 1 && r.freqB ? r.freqB : r.freq);
      if (!hz) return;
      const v = (hz / 1e6).toFixed(6).replace(/0{1,3}$/, '');
      if (f.freq.value !== v) { f.freq.value = v; qoCheck(); }
      const m = trxMode(r.vfoSel === 1 && r.modeB ? r.modeB : r.mode);
      if (m && !f.mode.dataset.manual && f.mode.value !== m) f.mode.value = m;
    },
    onQrz(m) {
      const f = root && q$('#lgForm');
      if (!f || !m.ok || !m.info || String(f.call.value).toUpperCase() !== String(m.call).toUpperCase()) return;
      const v = m.info;
      const first = (v.nick || v.fname || '').split(/\s+/)[0];
      if (!f.name.value && first) f.name.value = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
      if (!f.qth.value && v.qth) f.qth.value = v.qth;
      if (!f.gridsquare.value && v.grid) f.gridsquare.value = v.grid;
    },
    mount,
    onHello(h) {
      me = { call: h.call, admin: !!h.admin, rxOnly: !!h.rxOnly, digiCall: h.digiCall || '', clubCalls: Array.isArray(h.clubCalls) ? h.clubCalls : [] };
      if (h.digiCall && calls.indexOf(h.digiCall) < 0) calls = [h.digiCall].concat(calls);
      rights();
      stale = true;
      if (root && !root.hidden) reload();
    },
    show() {
      if (stale || !items.length) reload();
      if (!editing) {
        const f = q$('#lgForm');
        if (!f.call.value) fromTrx(false);
      }
    },
    onMessage
  };
})();
