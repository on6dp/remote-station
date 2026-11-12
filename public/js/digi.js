/*
 * digi.js — fenêtres des modes numériques : onglets Activité / FT8·FT4 / RTTY / WSPR / JT65 / Synchro,
 * et fenêtre FT8 / FT4 (cascade, activité de bande, fréquence RX).
 * Le décodage se fait sur le serveur ; cette page affiche les messages et la cascade qu'il envoie.
 * app.js appelle RSDIGI.init(api) au démarrage, puis onMessage / onBinary / onState / onHello.
 * Fenêtre séparée (digi.html) : ce même fichier s'y accroche au dashboard qui l'a ouverte (window.opener.RSHOST)
 * et utilise sa connexion ; le dashboard lui transmet les messages tant qu'elle est ouverte.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id) || (window.RSPANELS ? window.RSPANELS.find(id) : null);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('rs.dg.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rs.dg.' + k, String(v)); } catch (e) {} }
  };

  // Fréquences d'appel usuelles (kHz, VFO en DATA-U / USB)
  const DIAL = {
    FT8: [['160 m', 1840], ['80 m', 3573], ['60 m', 5357], ['40 m', 7074], ['30 m', 10136], ['20 m', 14074], ['17 m', 18100],
      ['15 m', 21074], ['12 m', 24915], ['10 m', 28074], ['6 m', 50313], ['2 m', 144174], ['70 cm', 432174]],
    JT65: [['160 m', 1838], ['80 m', 3576], ['40 m', 7076], ['30 m', 10138], ['20 m', 14076], ['17 m', 18102], ['15 m', 21076],
      ['12 m', 24917], ['10 m', 28076], ['6 m', 50310]],
    FT4: [['80 m', 3575.5], ['40 m', 7047.5], ['30 m', 10140], ['20 m', 14080], ['17 m', 18104], ['15 m', 21140],
      ['12 m', 24919], ['10 m', 28180], ['6 m', 50318], ['2 m', 144170]],
    // FT2 (Decodium, IU8LMC) : fréquences de la liste de Decodium 4.0
    FT2: [['160 m', 1843], ['80 m', 3568], ['60 m', 5360], ['40 m', 7062], ['30 m', 10144], ['20 m', 14084], ['17 m', 18108],
      ['15 m', 21144], ['12 m', 24923], ['10 m', 28184], ['6 m', 50316], ['4 m', 70157], ['2 m', 144177], ['70 cm', 432177]]
  };
  // QO-100 (Es'hail-2) : on émet sur la FI du convertisseur 2,4 GHz (2 m, 70 cm ou 23 cm). qoIf = FI (MHz) qui
  // correspond à 2400,000 MHz (réglage qo100If du serveur ; 432,500 pour un convertisseur à OL 1967,5 MHz).
  let qoIf = { '2m': 144.5, '70cm': 432.5, '23cm': 1296.5 };
  // Fréquences de montée (MHz) : FT8 / FT4 2400,040 (WSJT-X), CW 2400,025, RTTY 2400,090 (plan de bande AMSAT-DL)
  const QO_UP = { FT8: 2400.040, FT4: 2400.040, RTTY: 2400.090, CW: 2400.025 };
  const QO_LBL = { '2m': '2 m', '70cm': '70 cm', '23cm': '23 cm' };
  function qoEntries(m) {
    const up = QO_UP[m];
    if (!up) return [];
    // FI hors de la couverture du TRX (ex. 23 cm sur FTX-1, FTDX10, IC-7300) : pas proposée
    const R = api && api.rig && api.rig();
    const max = R && R.FREQ_MAX ? R.FREQ_MAX : Infinity;
    return Object.keys(QO_LBL).filter((k) => Number(qoIf[k]) > 0).map((k) => ['QO-100 · FI ' + QO_LBL[k], Math.round((Number(qoIf[k]) + up - 2400) * 1e6) / 1000])
      .filter((x) => x[1] * 1000 <= max);
  }
  const withQo = (list, m) => list.filter((x) => !/^QO-100/.test(x[0])).concat(qoEntries(m));
  const dialList = (m) => withQo(DIAL[m], m);
  let lastRig = '';
  function refillQo() {
    if (!$('dgDial')) return;
    lastBand = 0;
    fillDial();
    fillList($('rtDial'), withQo(RTTY_DIAL, 'RTTY'), store.get('rtdial', '14085'));
    fillList($('cwDial'), withQo(CW_DIAL, 'CW'), store.get('cwdial', '14030'));
  }
  // Fréquences candidates pour suivre la bande du TRX : une fréquence QO-100 seulement si le TRX est déjà
  // tout près (± 250 kHz) — on ne bascule pas sur le convertisseur depuis une fréquence terrestre 70 cm
  const nearList = (m, f) => { const l = dialList(m).filter((x) => !x[2] && (!/^QO-100/.test(x[0]) || Math.abs(x[1] * 1000 - f) < 250000)); return l.length ? l : DIAL[m]; };
  // Remplit une liste de fréquences en gardant le choix en cours
  function fillList(sel, list, keep) {
    if (!sel) return;
    sel.textContent = '';
    for (const [b, khz, out] of list) {
      const o = document.createElement('option');
      o.value = String(khz);
      o.textContent = b + ' · ' + khz.toLocaleString('fr-BE', { minimumFractionDigits: khz % 1 ? 1 : 0 }) + ' kHz' + (out ? ' — hors couverture du TRX' : '');
      if (out) o.disabled = true;
      sel.appendChild(o);
    }
    if (keep != null) sel.value = String(keep);
  }
  // Cascade : WF_TOP = bande audio reçue (3000 Hz, ou 4000 en RTTY si choisi), fenêtre affichée = [WF_LO, WF_LO + WF_MAX_HZ]
  // (zoom RTTY ×2 / ×4 : fenêtre plus étroite, centrée sur le décodeur de l'émission). Hors RTTY : 0–3000 Hz.
  let WF_MAX_HZ = 3000;
  let WF_LO = 0;
  let WF_TOP = 3000;
  // FT8 / FT4 / FT2 : plage de chaque cascade (zoom à la molette), gardée dans ce navigateur ; A = VFO-A, B = VFO-B
  const ftViewLoad = (k) => {
    try { const o = JSON.parse(store.get(k, '') || 'null'); if (o && o.span >= 300 && o.span <= 3000 && o.lo >= 0 && o.lo + o.span <= 3000) return { lo: o.lo, span: o.span }; } catch (e) { /* */ }
    return { lo: 0, span: 3000 };
  };
  const ftViewA = ftViewLoad('ftviewa'), ftViewB = ftViewLoad('ftviewb');
  // CW : même zoom à la molette, avec sa propre plage pour chaque cascade
  const cwViewA = ftViewLoad('cwviewa'), cwViewB = ftViewLoad('cwviewb');
  const ZOOM_TABS = ['ftx', 'cw'];
  /** Plage choisie à la molette pour l'onglet affiché (null : pas de zoom dans cet onglet) */
  const zoomView = (side) => (tab === 'ftx' ? (side === 'B' ? ftViewB : ftViewA) : tab === 'cw' ? (side === 'B' ? cwViewB : cwViewA) : null);
  /** Plage affichée par une cascade : celle du VFO-B (double réception) ou la cascade principale */
  const ftV = (side) => (side === 'B' ? (zoomView('B') || { lo: WF_LO, span: WF_MAX_HZ }) : { lo: WF_LO, span: WF_MAX_HZ });
  const RX_WIDTH = 60; // Hz de part et d'autre de la fréquence RX

  const POPUP = document.body.dataset.digiPopup === '1';
  // Page Face avant (/ftdx101…) : modes numériques intégrés sous l'image du TRX, qui peuvent eux aussi partir en fenêtre séparée
  const EMBED = POPUP && document.body.dataset.digiEmbed === '1';
  // Carnet de trafic dans cette page : dashboard, ou page des modes numériques de la face avant (/ftdx101/digi.html) ;
  // la fenêtre séparée du dashboard n'en a pas (l'onglet Logbooks est dans le dashboard)
  // Pages des faces avant (/ftdx101, /ftdx10) : chemin de base (« /ftdx10 »…), '' ailleurs
  const FACEP = (/^\/(ftdx101|ftdx10|ic7300|ic7760|ftx1|ftdx5000)(?=\/|$)/.exec(location.pathname) || [''])[0];
  const LOGP = POPUP && !!FACEP && !EMBED;
  // Onglet Logbooks dans la page (dashboard) ; page des modes numériques de la face avant : le carnet s'ouvre dans
  // une fenêtre à lui (/ftdx101/log.html), raccrochée à cette page (même connexion, voir RSLOGHOST)
  const logHere = () => !!window.RSLOG && !POPUP;
  // Page TRX DIGI ouverte depuis le dashboard : la fiche du carnet (comme « Log QSO ») sert de fenêtre de QSO sous les macros FT
  const QSOFORM = POPUP && !FACEP && !EMBED && !!window.RSLOG;
  let qsoForm = false, qsoTapHost = null, qsoFillKey = '';
  let logWin = null, logInst = null, logMe = null, logSay = null;
  const logApi = (a) => (logSay && a ? Object.assign({}, a, { say: logSay }) : a); // messages dans la fenêtre du carnet
  const LOGW = () => (logInst && logWin && !logWin.closed ? logInst : null);
  if (LOGP) {
    window.RSLOGHOST = {
      attach(win, inst, say) {
        logWin = win;
        logInst = inst;
        logSay = say || null;
        inst.init(logApi(api));
        if (logMe) inst.onHello(logMe);
        if (inst.onState) inst.onState();
      },
      detach(inst) { if (logInst === inst) { logInst = null; logWin = null; } }
    };
  }
  function openLogWin() {
    if (logWin && !logWin.closed) { try { logWin.focus(); } catch (e) { /* */ } return; }
    logWin = window.open(FACEP + '/log.html', 'rs-log', (window.RSWINPOS ? RSWINPOS.feat('rs-log', 1500, 900) : 'width=1500,height=900'));
    if (!logWin && api) api.say('Le navigateur a bloqué la fenêtre du carnet : autorisez les fenêtres (pop-up) pour ce site.', 'warn', 6000);
  }
  const HOST = !POPUP || EMBED; // page qui peut ouvrir la fenêtre séparée (dashboard ou face avant)
  // Fenêtre séparée ouverte depuis la face avant : « Ramener » parle de la face avant
  const FROM_FACE = POPUP && !EMBED && (() => { try { return !!(window.opener && window.opener.document.body.classList.contains('face-page')); } catch (e) { return false; } })();
  // Fenêtre séparée des modes numériques : zoom propre (Ctrl + / Ctrl − / Ctrl 0, Ctrl + molette), gardé à part.
  // Le zoom du navigateur vaut pour tout le site (il agrandirait aussi la face avant) : il est remplacé ici par un zoom CSS de cette page seule.
  if (POPUP && !EMBED) {
    const ZST = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
    let zi = ZST.indexOf(Number(store.get('pzoom', '1')));
    if (zi < 0) zi = ZST.indexOf(1);
    let ztip = null, zt = 0;
    const zset = (i, show) => {
      zi = Math.max(0, Math.min(ZST.length - 1, i));
      document.documentElement.style.zoom = ZST[zi] === 1 ? '' : String(ZST[zi]);
      store.set('pzoom', String(ZST[zi]));
      window.dispatchEvent(new Event('resize')); // cascades et canevas : nouvelles dimensions
      if (!show) return;
      if (!ztip) { ztip = document.createElement('div'); ztip.className = 'dg-zoomtip'; document.body.appendChild(ztip); }
      ztip.textContent = 'Zoom de cette fenêtre : ' + Math.round(ZST[zi] * 100) + ' %  (Ctrl 0 : 100 %)';
      ztip.hidden = false; clearTimeout(zt); zt = setTimeout(() => { ztip.hidden = true; }, 1500);
    };
    zset(zi, false);
    window.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') zset(zi + 1, true);
      else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') zset(zi - 1, true);
      else if (e.key === '0' || e.code === 'Numpad0') zset(ZST.indexOf(1), true);
      else return;
      e.preventDefault();
    }, true);
    // Ctrl + molette : zoom de la page, sauf là où elle sert déjà (barres du filtre CW, zoom des cascades)
    window.addEventListener('wheel', (e) => { if (!e.ctrlKey || e.defaultPrevented) return; e.preventDefault(); zset(zi + (e.deltaY < 0 ? 1 : -1), true); }, { passive: false });
  }
  let api = null;
  let detached = false;  // dashboard : les modes numériques sont dans la fenêtre séparée
  let needHist = true;   // demander l'historique des décodages à la prochaine annonce
  let clockOff = 0;      // écart horloge du serveur − horloge de ce PC (ms)
  let bestRtt = Infinity;
  // Dashboard : il s'ouvre sur le carnet (Logbooks) ; les modes ont chacun leur page (TRX SSB, TRX CW, TRX DIGI)
  let tab = POPUP ? store.get('ptab', 'ftx') : (window.RSLOG ? 'log' : 'events');
  const FT_MODES = ['FT8', 'FT4', 'FT2'];
  const ftStored = () => { const v = store.get('ftmode', store.get('mode', 'FT8')); return FT_MODES.indexOf(v) >= 0 ? v : 'FT8'; };
  let mode = ftStored();
  let rxF = Number(store.get('rxf', '1500')) || 1500;
  let txF = Number(store.get('txf', '1500')) || 1500; // fréquence audio d'émission (split : différente de RX)
  // FTDX101 en double réception (page /ftdx101) : FT8 / FT4 / FT2 décodés aussi sur le récepteur SUB (VFO-B),
  // avec sa cascade et ses deux colonnes ; l'émission part sur le VFO de la station appelée
  let rxFB = Number(store.get('rxfb', '1500')) || 1500;
  let txFB = Number(store.get('txfb', '1500')) || 1500;
  let ftDual = false; // cascade et colonnes du VFO-B affichées
  let ftSide = 'A';   // VFO d'émission choisi : A = MAIN, B = SUB
  const sd = () => (ftDual && ftSide === 'B' ? 'B' : 'A');
  const SCALE_H = 44; // graduations + drapeaux TX / RX avec leur fréquence
  let lastDecode = 0;
  let lastBand = 0;
  let stationCalls = ['ON5VL', 'OR0L'];
  let baseCalls = stationCalls.slice(); // indicatifs de la station ; + celui sous lequel on émet (« TX call »)


  // ------------------------------------------------------------------ construction des onglets et des fenêtres
  // Même code pour le centre du dashboard et pour la fenêtre séparée (digi.html, sans l'onglet Activité).
  const TABS = [
    ['events', 'Modes'], ['ftx', 'FT8 · FT4 · FT2'], ['ssb', 'SSB'], ['rtty', 'RTTY'], ['wspr', 'WSPR'], ['jt65', 'JT65'], ['jtty', 'JTTY'], ['cw', 'CW'], ['sstv', 'SSTV'], ['log', 'Logbooks'], ['sync', 'Synchro']
  ];
  const MODE_TABS = ['ftx', 'rtty', 'wspr', 'jt65', 'jtty', 'cw', 'sstv', 'sync'];
  const WF_TABS = ['ftx', 'jt65', 'rtty', 'wspr', 'jtty', 'cw', 'sstv']; // onglets avec cascade
  const SOON = {
  };
  const FTX_PANE = `
    <div class="dg-bar">
      <div class="seg" id="dgModes">
        <button class="btn" type="button" data-mode="FT8" aria-pressed="true">FT8</button>
        <button class="btn" type="button" data-mode="FT4" aria-pressed="false">FT4</button>
        <button class="btn" type="button" data-mode="FT2" aria-pressed="false" title="FT2 de Decodium (IU8LMC) : périodes de 3,75 s">FT2</button>
      </div>
      <select id="dgDial" aria-label="Fréquence d'appel"></select>
      <button class="btn dg-back" type="button" id="dgQsy" title="Revenir sur cette fréquence (VFO A, en DATA-U)" aria-label="Revenir sur cette fréquence (VFO A, en DATA-U)">↺</button>
      <span class="dg-split">
        <span class="dg-f rx">RX <b id="dgRxF2">1500</b> Hz</span>
        <button class="btn" type="button" id="dgTxRx" title="Émettre sur la fréquence de réception">TX ← RX</button>
        <button class="btn" type="button" id="dgRxTx" title="Recevoir sur la fréquence d'émission">RX ← TX</button>
        <span class="dg-f tx">TX <b id="dgTxF">1500</b> Hz</span>
      </span>
      <span class="dg-f dg-perl">Période</span>
      <select id="dgPar" class="dg-par" aria-label="Période d'émission" title="Période d'émission. Auto : à l'opposé du correspondant choisi (double-clic sur son message), sinon la prochaine période. 1re = 00 / 30 s en FT8.">
        <option value="auto">AUTO</option><option value="0">0/15</option><option value="1">15/30</option>
      </select>
      <label class="dg-hound" id="dgHoundWrap" title="DXpédition en FT8 : HOUND = vous appelez une DXpédition qui trafique en FOX (FOX classique, plusieurs QSO à la fois) ou en SuperFox (un seul signal large de 1,5 kHz, jusqu'à 9 stations à la fois). Choisi par celui qui a la main, pour toute la station."><span class="dg-f">Activité</span> <select id="dgHound"><option value="0">NORMALE</option><option value="1">HOUND · FOX</option><option value="2">HOUND · SuperFox</option></select></label>
      <label class="dg-chk dg-alog" title="Que faire du QSO dans le carnet à la fin du QSO (RR73 / 73) : vous demander (fenêtre « QSO terminé » avec « Enregistrer dans le carnet »), ou l’enregistrer tout seul (« Log automatically » de WSJT-X)">Carnet en fin de QSO <select id="dgAutoLog">
        <option value="">MANUEL : me demander avant d’enregistrer</option>
        <option value="any">AUTOMATIQUE : RR73 reçu ou 73 envoyé</option>
      </select></label>
      <label class="dg-chk spotlog" title="Cochée : chaque QSO FT8 / FT4 / FT2 enregistré dans le carnet (fiche ou log automatique) est aussi spoté sur le DX cluster, sous votre indicatif d’opérateur — pas le TX CALL. Les stations décodées partent de toute façon vers PSK Reporter."><input type="checkbox" data-spotlog> Spot cluster</label>
      <button class="btn dg-dualrx" type="button" id="dgDualRx" hidden aria-pressed="false" title="DUAL RX : deux cascades, quatre colonnes et deux cartes de bande (VFO-A et VFO-B) ; clic : un seul VFO affiché (le TRX garde sa double réception). TRX en réception simple : clic = DUAL RX sur le TRX (avec la main).">DUAL RX</button>
      <span class="seg ft-txside" id="dgTxSide" title="FTDX101 en double réception : VFO d'émission (MAIN = VFO-A, SUB = VFO-B). Un double-clic sur un message choisit tout seul le VFO de la station appelée."><span class="dg-f">TX</span><button class="btn" type="button" data-side="A" aria-pressed="true">VFO-A</button><button class="btn" type="button" data-side="B" aria-pressed="false">VFO-B</button></span>
      <label class="dg-txc" id="dgTxcWrap" title="TX call : indicatif sous lequel partent les émissions numériques (FT8 / FT4 / FT2, RTTY, JTTY…) — celui de la station ou le vôtre. Choisi par celui qui a la main."><span class="dg-f">TX call</span> <select id="dgTxCall"></select></label>
      <button class="btn dg-stop" type="button" id="dgStop" disabled title="Arrête l'émission automatique (Halt Tx)">■ Arrêter</button>
      <span class="dg-tl"><span class="dg-status" id="dgStatus"></span><span class="dg-clock" id="dgClock">--:--:--</span></span>
    </div>
    <div class="ft-wfrow"><div class="dg-wf-slot" data-slot="ftx"><div class="dg-wf">
      <div class="wf-ctl" title="Réglages de la cascade (comme WSJT-X)">
        <span class="ft-wfa"><em class="ft-vtag">VFO-A · MAIN</em> <b id="ftDialA"></b><i class="ft-md" id="ftModeA"></i></span>
        <label title="Contraste : plus à droite, les signaux faibles ressortent davantage">Gain <input id="wfGain" type="range" min="-20" max="20" step="1" value="0"></label>
        <label title="Niveau du bruit de fond : plus à droite, le fond est plus clair">Zéro <input id="wfZero" type="range" min="-20" max="20" step="1" value="0"></label>
        <label title="Aplatit le bruit de fond sur toute la largeur (corrige la pente du filtre du TRX)"><input id="wfFlat" type="checkbox" checked> Plat</label>
        <select id="wfPal" aria-label="Couleurs de la cascade"><option value="jtdx">Couleurs : JTDX</option><option value="classic">Couleurs : bleu</option><option value="wsjtx">Couleurs : arc-en-ciel</option><option value="gray">Couleurs : gris</option></select>
        <select id="wfSpd" aria-label="Vitesse de la cascade" title="Vitesse de défilement (comme « Spd » de JTDX) : plus lent = signaux plus ramassés et plus d'historique"><option value="1">Vitesse : rapide</option><option value="2">Vitesse : normale</option><option value="3">Vitesse : lente</option></select>
        <button class="dg-mini" type="button" id="wfReset" title="Réglages d'origine">↺</button>
      </div>
      <canvas id="dgScale" height="44"></canvas>
      <canvas id="dgWf" height="140"></canvas>
      <canvas id="dgSpec" class="dg-spec" height="70" title="Spectre : niveau de chaque fréquence audio (moyenne des dernières lignes de la cascade, mêmes réglages Gain / Zéro / Plat)"></canvas>
      <i class="dg-mk dg-mk-tx" id="dgMkTx"></i><i class="dg-mk dg-mk-rx" id="dgMkRx"></i><i class="dg-mk dg-mk-n" id="dgMkN" hidden></i>
      <i class="dg-mk dg-mk-bm" id="dgMkBM" hidden></i><i class="dg-mk dg-mk-bs" id="dgMkBS" hidden></i>
      <i class="cw-trx" id="cwTrxA" hidden title="Filtre du TRX (BW) : glisser une barre pour l'élargir ou le rétrécir (Ctrl + molette aussi)"><b></b><b></b><span></span></i>
      <i class="dg-grip" id="dgGrip" title="Glisser vers le haut ou le bas : hauteur de la cascade et des listes de messages (double-clic : taille d'origine)"></i>
<span class="dg-spspd" id="dgSpSpd" title="Vitesse du spectre (la courbe seulement ; la cascade a sa propre « Vitesse ») : X1 = moyenne sur environ 6 s (courbe calme, les signaux réguliers ressortent), X2 = environ 2 s, X4 = presque instantané"><button type="button" data-spspd="1">X1</button><button type="button" data-spspd="2">X2</button><button type="button" data-spspd="4">X4</button></span>
      <i class="dg-grip dg-sgrip" id="dgSGrip" title="Glisser vers le haut ou le bas : hauteur du spectre (double-clic : taille d'origine)"></i>
    </div></div>
      <div class="dg-wf ft-wfb" id="ftWfBox" hidden>
        <div class="wf-ctl ft-wfh" title="Réglages de la cascade du VFO-B">
          <span class="ft-wfbl"><em class="ft-vtag b">VFO-B · SUB</em> <b id="ftDialB"></b><i class="ft-md" id="ftModeB"></i></span>
          <label title="Contraste : plus à droite, les signaux faibles ressortent davantage">Gain <input id="wfGainB" type="range" min="-20" max="20" step="1" value="0"></label>
          <label title="Niveau du bruit de fond : plus à droite, le fond est plus clair">Zéro <input id="wfZeroB" type="range" min="-20" max="20" step="1" value="0"></label>
          <label title="Aplatit le bruit de fond sur toute la largeur (corrige la pente du filtre du TRX)"><input id="wfFlatB" type="checkbox" checked> Plat</label>
          <select id="wfPalB" aria-label="Couleurs de la cascade du VFO-B"><option value="jtdx">Couleurs : JTDX</option><option value="classic">Couleurs : bleu</option><option value="wsjtx">Couleurs : arc-en-ciel</option><option value="gray">Couleurs : gris</option></select>
          <select id="wfSpdB" aria-label="Vitesse de la cascade du VFO-B" title="Vitesse de défilement (comme « Spd » de JTDX) : plus lent = signaux plus ramassés et plus d'historique"><option value="1">Vitesse : rapide</option><option value="2">Vitesse : normale</option><option value="3">Vitesse : lente</option></select>
          <button class="dg-mini" type="button" id="wfResetB" title="Réglages d'origine">↺</button>
        </div>
        <canvas id="ftScaleB" height="44"></canvas>
        <canvas id="ftWfB" height="140" title="Cascade du VFO-B (SUB) : clic gauche = réception, clic droit = émission"></canvas>
        <canvas id="ftSpecB" class="dg-spec" height="70" title="Spectre du VFO-B"></canvas>
        <i class="dg-mk dg-mk-tx" id="ftMkTxB"></i><i class="dg-mk dg-mk-rx" id="ftMkRxB"></i><i class="dg-mk dg-mk-n" id="ftMkNB" hidden></i>
        <i class="cw-trx" id="cwTrxB" hidden title="Filtre du TRX (BW) : glisser une barre pour l'élargir ou le rétrécir (Ctrl + molette aussi)"><b></b><b></b><span></span></i>
        <i class="dg-grip" id="ftGripB" title="Glisser vers le haut ou le bas : hauteur des cascades (double-clic : taille d'origine)"></i>
<span class="dg-spspd" id="ftSpSpdB" title="Vitesse du spectre (la courbe seulement ; la cascade a sa propre « Vitesse ») : X1 = moyenne sur environ 6 s (courbe calme, les signaux réguliers ressortent), X2 = environ 2 s, X4 = presque instantané"><button type="button" data-spspd="1">X1</button><button type="button" data-spspd="2">X2</button><button type="button" data-spspd="4">X4</button></span>
        <i class="dg-grip dg-sgrip" id="ftSGripB" title="Glisser vers le haut ou le bas : hauteur des spectres (double-clic : taille d'origine)"></i>
      </div>
    </div>
    <div class="dg-cols">
      <div class="dg-col">
        <div class="dg-h"><span><i class="ft-sd">VFO-A · </i>Activité de bande</span><button class="dg-mini" type="button" id="dgClear">Effacer</button></div>
        <div class="dg-th ft"><span>UTC</span><span>dB</span><span>DT</span><span>Fréq</span><span>Message</span><span title="Préfixe de l’entité DXCC">Préf.</span><span>Pays</span><span>km</span><span title="Azimut (bearing) depuis le club, en degrés">Az</span></div>
        <div class="dg-list" id="dgBand"></div>
      </div>
      <i class="dg-vsplit" id="dgSplit" title="Glisser à gauche ou à droite : largeur des deux listes (double-clic : moitié-moitié)"></i>
      <div class="dg-col">
        <div class="dg-h"><span><i class="ft-sd">VFO-A · </i>Fréquence RX <b id="dgRxF">1500 Hz</b></span><span class="dg-note">clic gauche : RX · clic droit : TX · double-clic : correspondant</span><button class="dg-mini" type="button" id="dgClearRx" title="Vide cette liste (les messages suivants s'y ajoutent)">Effacer</button></div>
        <div class="dg-th ft"><span>UTC</span><span>dB</span><span>DT</span><span>Fréq</span><span>Message</span><span title="Préfixe de l’entité DXCC">Préf.</span><span>Pays</span><span>km</span><span title="Azimut (bearing) depuis le club, en degrés">Az</span></div>
        <div class="dg-list" id="dgRx"></div>
      </div>
      <!-- FTDX101 en double réception : les mêmes colonnes pour le récepteur SUB (VFO-B) -->
      <div class="dg-col ft-colb dual-colb" hidden>
        <div class="dg-h"><span><i class="ft-sd b">VFO-B · </i>Activité de bande</span><button class="dg-mini" type="button" id="dgClearB">Effacer</button></div>
        <div class="dg-th ft"><span>UTC</span><span>dB</span><span>DT</span><span>Fréq</span><span>Message</span><span title="Préfixe de l’entité DXCC">Préf.</span><span>Pays</span><span>km</span><span title="Azimut (bearing) depuis le club, en degrés">Az</span></div>
        <div class="dg-list" id="dgBandB"></div>
      </div>
      <div class="dg-col ft-colb dual-colb" hidden>
        <div class="dg-h"><span><i class="ft-sd b">VFO-B · </i>Fréquence RX <b id="dgRxFB">1500 Hz</b></span><button class="dg-mini" type="button" id="dgClearRxB" title="Vide cette liste (les messages suivants s'y ajoutent)">Effacer</button></div>
        <div class="dg-th ft"><span>UTC</span><span>dB</span><span>DT</span><span>Fréq</span><span>Message</span><span title="Préfixe de l’entité DXCC">Préf.</span><span>Pays</span><span>km</span><span title="Azimut (bearing) depuis le club, en degrés">Az</span></div>
        <div class="dg-list" id="dgRxB"></div>
      </div>
    </div>
    <div class="dg-prog" id="dgProg" title="Période en cours : vert = réception, rouge = émission"><i id="dgProgBar"></i><span id="dgProgTxt"></span></div>
    <!-- Messages Tx1 à Tx7 dans l'onglet, sous les listes (comme WSJT-X) -->
    <div class="ft-tx"><div class="msgs-b ft-msgs" id="msgFtx"></div>
      <div class="ft-qso" id="ftQso" title="QSO en cours : le correspondant choisi (double-clic sur son message) ; indicatif, locator et reports modifiables à la main">
        <span class="fq-t">QSO</span>
        <label>Indicatif <input id="fqCall" maxlength="12" spellcheck="false" autocomplete="off"></label>
        <label>Locator <input id="fqGrid" maxlength="6" spellcheck="false" autocomplete="off"></label>
        <span class="fq-geo" id="fqGeo"></span>
        <label>Report env. <input id="fqRpt" maxlength="4"></label>
        <label>reçu <input id="fqRptRx" maxlength="4"></label>
        <span class="fq-v" id="fqT0"></span>
        <span class="fq-st" id="fqSt"></span>
        <button class="btn" type="button" id="fqLog" title="Ouvre la fiche « QSO » pour l’enregistrer dans le carnet (heure de début : choix du correspondant ; fin : maintenant)">LOG QSO</button>
        <button class="btn" type="button" id="fqClr" title="Efface le correspondant (indicatif, locator, reports)">EFFACER</button>
      </div>
      <div class="ft-qsolog" id="ftQsoLog" hidden></div></div>
    <p class="dg-tx" id="dgTxState">Émission : cliquez sur un message Tx1 à Tx7 ci-dessus : il part à chaque période jusqu’à la réponse, la séquence avance toute seule.</p>`;
  const RTTY_PANE = `
    <div class="dg-bar">
      <select id="rtDial" aria-label="Fréquence RTTY"></select>
      <button class="btn dg-back" type="button" id="rtQsy" title="Revenir sur cette fréquence (VFO A, en DATA-U)" aria-label="Revenir sur cette fréquence (VFO A, en DATA-U)">↺</button>
      <select id="rtSpan" aria-label="Largeur de la cascade" title="Bande audio affichée. 4 kHz : ouvrez aussi le filtre du TRX (BW 4.0K), sinon le bord droit reste noir"><option value="3000">Bande 3 kHz</option><option value="4000">Bande 4 kHz</option></select>
      <select id="rtZoom" aria-label="Zoom de la cascade" title="Zoom (aussi à la molette sur la cascade : vers soi = plus étroit, vers l'avant = plus large) : plage plus étroite et plus détaillée, comme MixW"><option value="1">Zoom ×1</option><option value="1.5">Zoom ×1,5</option><option value="2">Zoom ×2</option><option value="3">Zoom ×3</option><option value="4">Zoom ×4</option><option value="6">Zoom ×6</option><option value="8">Zoom ×8</option></select>
      <button class="btn" type="button" id="rtSplitBtn" aria-pressed="false" title="SPLIT : réception sur le VFO A, émission sur le VFO B (même bouton que SPLIT sur la ligne Step)">SPLIT</button>
      <span class="dg-note rt-tip" id="rtTip">dans la cascade : bouton gauche (clic ou maintenu en glissant) : décodeur A · bouton droit : décodeur B · molette : zoom · sur la règle des fréquences : molette ou glisser = accorder le VFO · double-clic sur un indicatif : le reprendre</span>
      <span class="dg-status" id="rtStatus"></span>
    </div>
    <!-- Une seule cascade (le TRX n'envoie qu'un son) avec les repères des deux décodeurs -->
    <div class="dg-wf-slot" data-slot="rtty"></div>
    <!-- Deux décodeurs RTTY côte à côte, largeur réglable ; émission sous les deux, sur toute la largeur -->
    <div class="rt-dual" id="rtDual">
      <div class="dg-col rt-side" data-ch="0">
        <div class="dg-h rt-hd">
          <span class="rt-name">VFO-A</span><span class="rt-rf" id="rtRf"></span><span class="rt-sig" id="rtSig"></span>
          <select id="rtShift" aria-label="Shift (VFO-A)"><option value="170">170 Hz</option><option value="200">200 Hz</option><option value="425">425 Hz</option><option value="850">850 Hz</option></select>
          <select id="rtBaud" aria-label="Vitesse (VFO-A)"><option value="45.45">45,45 Bd</option><option value="50">50 Bd</option><option value="75">75 Bd</option><option value="100">100 Bd</option></select>
          <button class="dg-mini" type="button" id="rtRev" aria-pressed="false" title="Échange Mark et Space (signal reçu « à l'envers »)">Inversé</button>
          <label class="rt-sq" title="Seuil de contraste Mark/Space : plus haut = moins de caractères au hasard sur le bruit">Silencieux
            <input type="range" id="rtSq" min="4" max="25" step="1" aria-label="Silencieux (VFO-A)"><output id="rtSqV">12</output></label>
          <span class="rt-tune" title="Accord : les deux barres doivent battre en alternance"><span>M</span><i><b id="rtM"></b></i><span>S</span><i><b id="rtS"></b></i></span>
          <span class="dg-f rx">Centre <b id="rtF">1500</b> Hz</span>
          <button class="dg-mini rt-center" type="button" data-ch="0" title="Centrer : le TRX se déplace pour que le signal de ce décodeur soit au milieu de la cascade (1500 Hz)">⌖ Centrer</button>
          <button class="dg-mini rt-txsel" type="button" data-ch="0" aria-pressed="false" title="L'émission RTTY part avec les réglages de ce décodeur (fréquence audio, shift, vitesse)">TX</button>
          <button class="dg-mini" type="button" id="rtClear">Effacer</button>
        </div>
        <div class="dg-wf-slot" data-slot="rtty-a"></div>
        <pre class="rt-rx" id="rtRx"></pre>
      </div>
      <i class="rt-vsplit" id="rtSplit" title="Glisser à gauche ou à droite : largeur des deux décodeurs (double-clic : moitié-moitié)"></i>
      <div class="dg-col rt-side" data-ch="1">
        <div class="dg-h rt-hd">
          <span class="rt-name">VFO-B</span><span class="rt-rf" id="rtRfB"></span><span class="rt-sig" id="rtSigB"></span>
          <select id="rtShiftB" aria-label="Shift (VFO-B)"><option value="170">170 Hz</option><option value="200">200 Hz</option><option value="425">425 Hz</option><option value="850">850 Hz</option></select>
          <select id="rtBaudB" aria-label="Vitesse (VFO-B)"><option value="45.45">45,45 Bd</option><option value="50">50 Bd</option><option value="75">75 Bd</option><option value="100">100 Bd</option></select>
          <button class="dg-mini" type="button" id="rtRevB" aria-pressed="false" title="Échange Mark et Space (signal reçu « à l'envers »)">Inversé</button>
          <label class="rt-sq" title="Seuil de contraste Mark/Space : plus haut = moins de caractères au hasard sur le bruit">Silencieux
            <input type="range" id="rtSqB" min="4" max="25" step="1" aria-label="Silencieux (VFO-B)"><output id="rtSqVB">12</output></label>
          <span class="rt-tune" title="Accord : les deux barres doivent battre en alternance"><span>M</span><i><b id="rtMB"></b></i><span>S</span><i><b id="rtSB"></b></i></span>
          <span class="dg-f rx">Centre <b id="rtFB">1500</b> Hz</span>
          <button class="dg-mini rt-center" type="button" data-ch="1" title="Centrer : le TRX se déplace pour que le signal de ce décodeur soit au milieu de la cascade (1500 Hz)">⌖ Centrer</button>
          <button class="dg-mini rt-txsel" type="button" data-ch="1" aria-pressed="false" title="L'émission RTTY part avec les réglages de ce décodeur (fréquence audio, shift, vitesse)">TX</button>
          <button class="dg-mini" type="button" id="rtClearB">Effacer</button>
        </div>
        <!-- Cascade propre au décodeur B : pour un TRX qui envoie ses deux récepteurs séparément (ex. FTDX101) ; cachée sinon -->
        <div class="dg-wf rt-wfb" hidden>
          <div class="wf-ctl" title="Réglages de la cascade du VFO-B">
            <label title="Contraste : plus à droite, les signaux faibles ressortent davantage">Gain <input id="wfGainR" type="range" min="-20" max="20" step="1" value="0"></label>
            <label title="Niveau du bruit de fond : plus à droite, le fond est plus clair">Zéro <input id="wfZeroR" type="range" min="-20" max="20" step="1" value="0"></label>
            <label title="Aplatit le bruit de fond sur toute la largeur (corrige la pente du filtre du TRX)"><input id="wfFlatR" type="checkbox" checked> Plat</label>
            <select id="wfPalR" aria-label="Couleurs de la cascade du VFO-B"><option value="jtdx">Couleurs : JTDX</option><option value="classic">Couleurs : bleu</option><option value="wsjtx">Couleurs : arc-en-ciel</option><option value="gray">Couleurs : gris</option></select>
            <select id="wfSpdR" aria-label="Vitesse de la cascade du VFO-B" title="Vitesse de défilement : plus lent = signaux plus ramassés et plus d'historique"><option value="1">Vitesse : rapide</option><option value="2">Vitesse : normale</option><option value="3">Vitesse : lente</option></select>
            <button class="dg-mini" type="button" id="wfResetR" title="Réglages d'origine">↺</button>
          </div>
          <canvas id="rtScaleB" height="44" title="Règle des fréquences : molette ou glisser = accorder le VFO-B (le TRX suit), sur toute la bande"></canvas>
          <canvas id="rtWfB" height="140"></canvas>
          <i class="dg-mk dg-mk-rx" id="rtMkMB"></i><i class="dg-mk dg-mk-tx" id="rtMkSB"></i>
          <i class="dg-grip" id="rtGripB" title="Glisser vers le haut ou le bas : hauteur des cascades (double-clic : taille d'origine)"></i>
        </div>
        <pre class="rt-rx" id="rtRxB"></pre>
      </div>
    </div>
    <i class="rt-hgrip" id="rtHGrip" title="Glisser vers le haut ou le bas : hauteur des fenêtres de décodage (VFO-A et VFO-B) — plus de place pour les macros en dessous (double-clic : taille d'origine)"></i>
    <div class="rt-grid rt-stack">
      <!-- Émission sous la réception, sur toute la largeur (comme JTTY et FLDIGI) : macros F1 à F12 sur une ligne -->
      <div class="dg-col rt-tx-col">
        <div class="rt-macros" id="rtMacros"></div>
        <!-- Contest RTTY : choix du contest, échange envoyé, numéro de série, et ses macros (touches F1 à F12 quand un contest est choisi) -->
        <div class="rt-contest" id="rtContest">
          <label class="rtc-l" title="Contest RTTY : l'échange et les macros contest suivent ; touches F1 à F12 = macros contest">Contest
            <select id="rtcSel" aria-label="Contest RTTY"></select></label>
          <label class="rtc-l" title="Échange envoyé (balise &lt;EXCH&gt; des macros contest) : 599 suivi de ce que demande le contest. &lt;CNTR&gt; = numéro de série, &lt;CQZ&gt; = zone CQ, &lt;ITUZ&gt; = zone ITU, &lt;ZT&gt; = heure UTC">Échange
            <input id="rtcExch" maxlength="40" spellcheck="false"></label>
          <label class="rtc-l rtc-n" title="Votre prénom, pour les contests qui le demandent (balise &lt;MYNAME&gt; : NAQP, NA Sprint, TARA…)">Prénom <input id="rtcName" maxlength="12" spellcheck="false"></label>
          <label class="rtc-l rtc-s" title="Zone CQ de la station (Belgique : 14)">Zone CQ <input id="rtcCqz" maxlength="2" inputmode="numeric"></label>
          <label class="rtc-l rtc-s" title="Zone ITU de la station (Belgique : 27)">ITU <input id="rtcItu" maxlength="2" inputmode="numeric"></label>
          <label class="rtc-l rtc-s" title="Numéro de série envoyé (&lt;CNTR&gt;). Il passe tout seul au suivant avec la macro TU (&lt;INCR&gt;), une seule fois par correspondant ; renvoyer l'échange redonne le même numéro. −1 / +1 : corriger à la main">N° <input id="rtcNr" maxlength="4" inputmode="numeric"></label>
          <button class="dg-mini" type="button" id="rtcNrM" title="Numéro précédent (−1) : renvoyer le même numéro de série">−1</button>
          <button class="dg-mini" type="button" id="rtcNrP" title="Numéro suivant (+1)">+1</button>
          <button class="dg-mini" type="button" id="rtcNr1" title="Remettre le numéro de série à 001 (début du contest)">↺ 001</button>
        </div>
        <div class="rt-macros rtc-macros" id="rtcMacros"></div>
        <div class="rt-tx-row">
          <textarea id="rtTxt" rows="2" placeholder="Message personnalisé, puis « Émettre » (Maj+clic sur une macro : l'ajoute ici)…" spellcheck="false"></textarea>
          <div class="rt-tx-act">
            <button class="btn btn-tx" type="button" id="rtSend" title="Émet le texte en RTTY avec les réglages du décodeur marqué TX (A ou B), puis retour en réception">Émettre</button>
            <div class="rt-tx-act2"><button class="btn" type="button" id="rtTxClear">Effacer</button>
            <button class="btn btn-log" type="button" data-log title="Enregistrer le QSO dans le carnet de la station (correspondant, RST, heure…)">Log QSO</button><label class="spotlog dg-spot" title="Cochée : le QSO enregistré (Log QSO) est aussi spoté sur le DX cluster sous votre indicatif d’opérateur — pas le TX CALL. Même réglage dans toutes les pages."><input type="checkbox" data-spotlog> Spot cluster</label></div>
          </div>
        </div>
        <p class="dg-tx rt-tx-note" id="rtTxState">Émission RTTY sous <b>ON5VL</b> : texte ci-dessus, puis « Émettre » (Ctrl+Entrée).</p>
      </div>
    </div>`;
  const WSPR_PANE = `
    <div class="dg-bar">
      <select id="wsDial" aria-label="Fréquence WSPR"></select>
      <button class="btn dg-back" type="button" id="wsQsy" title="Revenir sur cette fréquence WSPR (VFO A)" aria-label="Revenir sur cette fréquence WSPR (VFO A)">↺</button>
      <span class="dg-f">Bande WSPR : <b>1400 – 1600 Hz</b> audio</span>
      <span class="dg-clock" id="wsClock">--:--</span>
      <span class="dg-status" id="wsStatus"></span>
    </div>
    <div class="ft-wfrow"><div class="dg-wf-slot" data-slot="wspr"></div></div>
    <div class="ws-cols">
    <div class="dg-col ws-col">
      <div class="dg-h"><span><i class="ft-sd">VFO-A · </i>Stations WSPR entendues <b id="wsCount"></b></span><span class="dg-note">périodes de 2 minutes · décodage une dizaine de secondes après la minute paire</span><button class="dg-mini" type="button" id="wsClear">Effacer</button></div>
      <div class="ws-th"><span>UTC</span><span>dB</span><span>DT</span><span>Fréquence</span><span>Dérive</span><span>Indicatif</span><span>Locator</span><span>Puiss.</span><span>Distance</span></div>
      <div class="dg-list ws-list" id="wsList"></div>
    </div>
    <!-- FTDX101 en double réception : les stations entendues par le récepteur SUB (VFO-B) -->
    <div class="dg-col ws-col dual-colb" hidden>
      <div class="dg-h"><span><i class="ft-sd b">VFO-B · </i>Stations WSPR entendues <b id="wsCountB"></b></span><button class="dg-mini" type="button" id="wsClearB">Effacer</button></div>
      <div class="ws-th"><span>UTC</span><span>dB</span><span>DT</span><span>Fréquence</span><span>Dérive</span><span>Indicatif</span><span>Locator</span><span>Puiss.</span><span>Distance</span></div>
      <div class="dg-list ws-list" id="wsListB"></div>
    </div>
    </div>`;
  const JTTY_PANE = `
    <div class="dg-bar">
      <select id="jtDial" aria-label="Fréquence JTTY"></select>
      <button class="btn dg-back" type="button" id="jtQsy" title="Revenir sur cette fréquence JTTY (VFO A, en DATA-U)" aria-label="Revenir sur cette fréquence JTTY (VFO A, en DATA-U)">↺</button>
      <span class="dg-f rx">RX <b id="jtRxF">1500</b> Hz</span>
      <span class="dg-f tx">TX <b id="jtTxF">1500</b> Hz</span>
      <span class="dg-note">4-GFSK · 31,25 bauds · 127 Hz · trames de 1,9 s, à tout moment</span>
      <span class="dg-status" id="jtStatus"></span>
    </div>
    <div class="ft-wfrow"><div class="dg-wf-slot" data-slot="jtty"></div></div>
    <div class="dg-cols jt-cols">
      <div class="dg-col">
        <div class="dg-h"><span><i class="ft-sd">VFO-A · </i>Activité JTTY</span><button class="dg-mini" type="button" id="jtClear">Effacer</button></div>
        <div class="jt-th"><span>UTC</span><span>dB</span><span>Fréq</span><span>Message</span></div>
        <div class="dg-list" id="jtBand"></div>
      </div>
      <i class="dg-vsplit" title="Glisser à gauche ou à droite : largeur des deux listes (double-clic : moitié-moitié)"></i>
      <div class="dg-col">
        <div class="dg-h"><span><i class="ft-sd">VFO-A · </i>Fréquence RX <b id="jtRxF2">1500 Hz</b></span><span class="dg-note">clic gauche : RX · clic droit : TX · double-clic : correspondant</span></div>
        <div class="dg-list jt-chat" id="jtRx"></div>
      </div>
      <!-- FTDX101 en double réception : messages JTTY reçus par le récepteur SUB (VFO-B) -->
      <div class="dg-col ft-colb dual-colb" hidden>
        <div class="dg-h"><span><i class="ft-sd b">VFO-B · </i>Activité JTTY</span><button class="dg-mini" type="button" id="jtClearB">Effacer</button></div>
        <div class="jt-th"><span>UTC</span><span>dB</span><span>Fréq</span><span>Message</span></div>
        <div class="dg-list" id="jtBandB"></div>
      </div>
      <div class="dg-col ft-colb dual-colb" hidden>
        <div class="dg-h"><span><i class="ft-sd b">VFO-B · </i>Fréquence RX <b id="jtRxFB2">1500 Hz</b></span><span class="dg-note">clic gauche : RX · clic droit : TX · double-clic : correspondant</span></div>
        <div class="dg-list jt-chat" id="jtRxB"></div>
      </div>
    </div>
    <div class="jt-tx">
      <div class="rt-macros" id="jtMacros"></div>
      <div class="jt-tx-row">
        <input id="jtTxt" maxlength="160" placeholder="Message personnalisé, puis « Émettre » (macros F1 à F8 : émission directe)…" autocomplete="off" spellcheck="false">
        <button class="btn btn-tx" type="button" id="jtSend" title="Émet le message en JTTY sur la fréquence TX (repère rouge), puis retour en réception">Émettre</button>
        <button class="btn btn-log" type="button" data-log title="Enregistrer le QSO dans le carnet de la station">Log QSO</button><label class="spotlog dg-spot" title="Cochée : le QSO enregistré (Log QSO) est aussi spoté sur le DX cluster sous votre indicatif d’opérateur — pas le TX CALL. Même réglage dans toutes les pages."><input type="checkbox" data-spotlog> Spot cluster</label>
      </div>
      <p class="dg-tx" id="jtTxState">Émission JTTY sous <b>ON5VL</b> : message ci-dessus, puis « Émettre » (Entrée).</p>
    </div>`;
  const CW_PANE = `
    <div class="dg-bar">
      <select id="cwDial" aria-label="Fréquence CW"></select>
      <button class="btn dg-back" type="button" id="cwQsy" title="Revenir sur cette fréquence (VFO A, en CW)" aria-label="Revenir sur cette fréquence (VFO A, en CW)">↺</button>
      <span class="cw-ctl" id="cwCtlA">
      <select id="cwBw" aria-label="Filtre du décodeur" title="Largeur du filtre du décodeur, et (avec la main, TRX en CW) de la largeur BW du TRX au plus près : étroit = moins de bruit et de QRM, mais il faut être bien calé"><option value="50">Filtre 50 Hz</option><option value="100">Filtre 100 Hz</option><option value="200">Filtre 200 Hz</option><option value="400">Filtre 400 Hz</option></select>
      <label class="rt-sq" title="Niveau minimal du signal au-dessus du bruit : plus haut = moins de lettres au hasard sur le bruit">Silencieux
        <input type="range" id="cwSq" min="0" max="20" step="1" aria-label="Silencieux"><output id="cwSqV">5</output></label>
      <span class="cw-lvl" title="Niveau du signal au-dessus du bruit (dB) ; le voyant suit la manipulation"><i class="cw-led" id="cwLed"></i><i class="cw-bar"><b id="cwBar"></b></i><span id="cwDb">0 dB</span></span>
      <span class="dg-f rx">Tonalité <b id="cwF">700</b> Hz</span>
      <span class="dg-f">Vitesse <b id="cwWpm">—</b> mots/min</span>
      </span>
      <span class="dg-status" id="cwStatus"></span>
    </div>
    <div class="ft-wfrow"><div class="dg-wf-slot" data-slot="cw"></div></div>
    <div class="rt-grid rt-stack">
      <div class="cw-rxrow">
        <div class="dg-col rt-rx-col">
          <div class="dg-h"><span><i class="ft-sd">VFO-A · </i>Réception CW</span><span class="cw-slot" id="cwSlotA"></span><span class="dg-note">clic sur la cascade : se caler sur le signal le plus proche · bouton gauche maintenu : glisser le repère · double-clic sur un indicatif : le reprendre</span><button class="dg-mini" type="button" id="cwClear">Effacer</button></div>
          <pre class="rt-rx" id="cwRx"></pre>
        </div>
        <!-- FTDX101 en double réception : 2e décodeur CW sur le récepteur SUB (VFO-B), ses propres réglages -->
        <div class="dg-col rt-rx-col ft-colb dual-colb" hidden>
          <div class="dg-h"><span><i class="ft-sd b">VFO-B · </i>Réception CW</span>
            <span class="cw-ctl">
              <select id="cwBwB" aria-label="Filtre du décodeur (VFO-B)" title="Largeur du filtre du décodeur du VFO-B, et (avec la main, SUB en CW) de la largeur BW du SUB au plus près"><option value="50">Filtre 50 Hz</option><option value="100">Filtre 100 Hz</option><option value="200">Filtre 200 Hz</option><option value="400">Filtre 400 Hz</option></select>
              <label class="rt-sq" title="Niveau minimal du signal au-dessus du bruit : plus haut = moins de lettres au hasard sur le bruit">Silencieux
                <input type="range" id="cwSqB" min="0" max="20" step="1" aria-label="Silencieux (VFO-B)"><output id="cwSqVB">5</output></label>
              <span class="cw-lvl" title="Niveau du signal au-dessus du bruit (dB) ; le voyant suit la manipulation"><i class="cw-led" id="cwLedB"></i><i class="cw-bar"><b id="cwBarB"></b></i><span id="cwDbB">0 dB</span></span>
              <span class="dg-f rx">Tonalité <b id="cwFB">700</b> Hz</span>
              <span class="dg-f">Vitesse <b id="cwWpmB">—</b> mots/min</span>
            </span>
            <button class="dg-mini" type="button" id="cwClearB">Effacer</button></div>
          <pre class="rt-rx" id="cwRxB"></pre>
        </div>
      </div>
      <div class="dg-col rt-tx-col">
        <div class="dg-h"><span>Émission</span><button class="btn cw-stop" type="button" id="cwStop" hidden title="Arrête tout de suite l’émission CW en cours (macro lancée par erreur…) — aussi avec la touche Échap">■ ARRÊTER (Échap)</button><label class="rt-call">Vitesse <input id="cwSpeed" type="number" min="5" max="60" step="1" title="Vitesse du manipulateur du TRX (mots/minute) : 5 à 60 sur les Yaesu, 5 à 48 sur l’IC-7300"> mots/min</label></div>
        <div class="rt-macros" id="cwMacros"></div>
        <div class="rt-tx-row">
          <textarea id="cwTxt" rows="2" placeholder="Texte à émettre (F1 à F12 : macros)…" spellcheck="false"></textarea>
          <div class="rt-tx-act">
            <button class="btn btn-tx" type="button" id="cwSend">Émettre</button>
            <div class="rt-tx-act2"><button class="btn" type="button" id="cwTxClear">Effacer</button>
            <button class="btn btn-log" type="button" data-log title="Enregistrer le QSO dans le carnet de la station">Log QSO</button><label class="spotlog dg-spot" title="Cochée : le QSO enregistré (Log QSO) est aussi spoté sur le DX cluster sous votre indicatif d’opérateur — pas le TX CALL. Même réglage dans toutes les pages."><input type="checkbox" data-spotlog> Spot cluster</label></div>
          </div>
        </div>
        <p class="dg-tx rt-tx-note" id="cwTxState">Émission CW sous <b class="dg-txcall">ON5VL</b> par le manipulateur du TRX : macro (émission directe) ou texte ci-dessus puis « Émettre » (Ctrl+Entrée).</p>
        <div id="cwKey"></div>
      </div>
    </div>`;
  const SSTV_PANE = `
    <div class="dg-bar">
      <select id="ssDial" aria-label="Fréquence SSTV"></select>
      <button class="btn dg-back" type="button" id="ssQsy" title="Revenir sur cette fréquence SSTV (VFO A)" aria-label="Revenir sur cette fréquence SSTV (VFO A)">↺</button>
      <span class="dg-f">Image : <b>1500 – 2300 Hz</b> · synchro 1200 Hz</span>
      <span class="ss-prog"><i><b id="ssProg"></b></i><span id="ssProgT"></span></span>
      <span class="dg-status" id="ssStatus"></span>
    </div>
    <div class="dg-wf-slot" data-slot="sstv"></div>
    <div class="ss-grid">
      <div class="dg-col ss-rx">
        <div class="dg-h"><span>Réception SSTV <b id="ssCap"></b></span><span class="dg-note">Martin, Scottie, Robot, PD : départ automatique sur le code VIS</span><button class="dg-mini" type="button" id="ssSave" title="Enregistrer l'image affichée sur votre PC">PNG</button></div>
        <div class="ss-view"><canvas id="ssCanvas" width="320" height="256"></canvas><p class="ss-empty" id="ssEmpty">En attente d'une image…</p></div>
        <div class="ss-gal" id="ssGal" aria-label="Dernières images reçues"></div>
      </div>
      <i class="ss-vsplit" id="ssSplit" title="Glisser à gauche ou à droite : largeur des fenêtres Réception et Émission (double-clic : moitié-moitié)"></i>
      <div class="dg-col ss-tx">
        <div class="dg-h"><span>Émission</span>
          <select id="ssTxMode" aria-label="Mode d'émission"></select><span class="dg-note" id="ssDur"></span></div>
        <div class="ss-src">
          <label class="btn ss-file" title="Choisir une ou plusieurs images sur votre PC (JPG, PNG…). Format conseillé : 800 × 600 (4:3, paysage) ; une autre taille est recadrée au centre. Les images restent dans votre navigateur (10 au plus) ; seule l'image émise passe par le serveur, sans y être gardée.">Images du PC…<input type="file" id="ssFile" accept="image/*" multiple hidden></label>
          <span class="ss-fmt" title="Format conseillé pour vos images SSTV : 800 × 600 pixels, paysage (4:3). Robot 36 / 72 : sans recadrage ; les autres modes : environ 1 à 3 % coupés à gauche et à droite.">800 × 600 conseillé</span>
          <div class="ss-thumbs" id="ssThumbs"></div>
        </div>
        <div class="ss-txbody">
          <div class="ss-cview"><canvas id="ssCompose" class="ss-compose" width="320" height="256"></canvas><div class="ss-txmask" id="ssTxMask" hidden></div></div>
          <div class="ss-text">
            <input id="ssT0" maxlength="40" spellcheck="false" autocomplete="off" placeholder="Texte en haut" aria-label="Texte en haut" title="Texte en haut de l'image">
            <input id="ssT1" maxlength="40" spellcheck="false" autocomplete="off" placeholder="Texte au centre" aria-label="Texte au centre" title="Texte au centre de l'image">
            <input id="ssT2" maxlength="40" spellcheck="false" autocomplete="off" placeholder="Texte en bas" aria-label="Texte en bas" title="Texte en bas de l'image">
            <div class="ss-opt">
              <select id="ssSize" aria-label="Taille du texte"><option value="0.075">Petit</option><option value="0.1">Moyen</option><option value="0.13">Grand</option></select>
              <input type="color" id="ssColor" value="#ffe14a" aria-label="Couleur du texte" title="Couleur du texte">
            </div>
            <div class="ss-tags" id="ssTags"></div>
            <div class="ss-act">
              <button class="btn" type="button" id="ssPlay" title="Joue le signal SSTV sur les haut-parleurs de votre PC (essai, sans émission)">▶ Écouter</button>
              <button class="btn" type="button" id="ssWav" title="Enregistre le signal SSTV en fichier WAV (essai avec un autre logiciel)">WAV</button>
              <button class="btn btn-tx" type="button" id="ssSend">Émettre</button>
            </div>
          </div>
        </div>
        <p class="dg-tx ss-note" id="ssTxState">Émission SSTV sous <b class="dg-txcall">ON5VL</b> : VFO d'émission en DATA-U, puissance réduite conseillée (émission continue). Images : 800 × 600 conseillé · clic droit sur une vignette : la retirer · glisser-déposer accepté.</p>
      </div>
    </div>`;
  const SYNC_PANE = `
    <div class="sy-grid">
      <div class="sy-box"><span>Heure du serveur (UTC)</span><b id="syVps">--:--:--</b><small>référence de tous les décodages</small></div>
      <div class="sy-box"><span>Serveur : NTP</span><b id="syNtp">—</b><small id="syNtpNote">synchronisation du serveur sur l’heure mondiale</small></div>
      <div class="sy-box"><span>PC du club</span><b id="syClub">—</b><small id="syClubNote">écart avec le serveur</small>
        <small class="sy-res" id="syClubRes"></small>
        <button class="btn sy-btn" type="button" id="syClubSync" title="Met l’horloge de Windows du PC du club à l’heure (serveurs NTP publics, comme NetTime) par l’assistant carte son version 4 — responsables de la station">⟳ Mettre à l’heure</button></div>
      <div class="sy-box"><span>Votre PC</span><b id="syPc">—</b><small id="syPcNote">écart avec le serveur</small></div>
      <div class="sy-box"><span>Liaison station → serveur</span><b id="syLat">—</b><small>délai mesuré et corrigé automatiquement</small></div>
      <div class="sy-box"><span>DT médian</span><b id="syDt">—</b><small id="syDtNote">derniers décodages FT8 / FT4</small></div>
      <div class="sy-box"><span>Décodages (dernière période)</span><b id="syDec">—</b><small id="syDecNote">arrivée de chaque passe après le début de la période</small></div>
    </div>
    <p class="sy-note">Le décodage et l'instant d'émission se calent sur l'horloge du serveur (synchronisée par NTP) : l'écart du PC du club
      est mesuré et corrigé tout seul, celui de votre PC n'intervient pas. Le délai de la liaison est mesuré d'après les stations décodées ;
      un DT médian proche de 0,0 s montre que tout est calé. Le PC du club peut quand même être mis à l'heure à la milliseconde
      (bouton ci-dessus, et tout seul toutes les heures) par l'assistant carte son version 4 : NetTime n'est alors plus nécessaire.</p>`;

  function buildDom() {
    const bar = $('ctabs');
    bar.textContent = '';
    for (const [id, label] of TABS) {
      if (id === 'events' && POPUP) continue;
      if (id === 'log' && !logHere() && !LOGP) continue; // carnet : onglet du dashboard, ou fenêtre à part (face avant)
      if (id === 'gap') { const g = document.createElement('span'); g.className = 'ctab-gap'; bar.appendChild(g); continue; }
      const b = document.createElement('button');
      b.className = 'ctab';
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.tab = id;
      b.textContent = label;
      bar.appendChild(b);
      // Log QSO (ligne Correspondant) : juste à droite de l'onglet Logbooks, avant Synchro
      if (id === 'log') { const lq = document.getElementById('dxLog'); if (lq) { lq.classList.add('ctab-log'); bar.appendChild(lq); } }
    }
    // « Suivre l'opérateur » : l'onglet suit celui de l'opérateur qui a la main (formation à distance)
    const fol = document.createElement('button');
    fol.className = 'ctab-follow';
    fol.type = 'button';
    fol.id = 'dgFollow';
    fol.innerHTML = '👁 Suivre<span class="fol-x"> l’opérateur</span>';
    fol.title = 'Suivre l’opérateur : afficher le même onglet que celui qui a la main (RTTY, FT8, CW…). Un clic sur un autre onglet arrête le suivi.';
    fol.setAttribute('aria-pressed', 'false');
    bar.appendChild(fol);
    { const g = document.createElement('span'); g.className = 'ctab-gap'; bar.appendChild(g); }
    const det = document.createElement('button');
    det.className = 'ctab-detach';
    det.type = 'button';
    det.id = 'dgDetach';
    const WIN = POPUP && !EMBED; // cette page est la fenêtre séparée
    det.textContent = WIN ? (FROM_FACE ? '✕ Fermer' : '⧉ Ramener dans le dashboard') : '⧉';
    det.title = WIN ? (FROM_FACE ? 'Fermer la page des modes numériques (bouton « 📟 Modes numériques » de la face avant pour la rouvrir)' : 'Fermer cette fenêtre et ramener les modes numériques dans le dashboard') : 'Ouvrir les modes numériques dans une fenêtre séparée (autre écran…)';
    bar.appendChild(det);
    const panel = $('centerPanel');
    const add = (id, cls, html) => {
      const d = document.createElement('div');
      d.className = 'ctab-pane ' + cls;
      d.dataset.pane = id;
      d.hidden = true;
      d.innerHTML = html;
      panel.appendChild(d);
    };
    add('ftx', 'dg dg-ftx', FTX_PANE);
    add('rtty', 'dg rt', RTTY_PANE);
    add('wspr', 'dg ws', WSPR_PANE);
    add('jtty', 'dg jt', JTTY_PANE);
    add('cw', 'dg rt cwp', CW_PANE);
    add('sstv', 'dg ss', SSTV_PANE);
    for (const k in SOON) add(k, 'dg-soon', '<p>' + SOON[k] + '</p><p class="dg-note">En préparation.</p>');
    add('sync', 'dg-sync', SYNC_PANE);
    // « TX call » : sur la ligne des onglets, juste après SYNCHRO (il vaut pour tous les modes)
    { const txc = panel.querySelector('#dgTxcWrap'), syt = bar.querySelector('.ctab[data-tab="sync"]'); if (txc && syt) { txc.classList.add('ctab-txc'); syt.after(txc); } }
    if (logHere()) { add('log', 'lg', ''); window.RSLOG.mount(panel.lastElementChild); }
    // Carte de bande (DX cluster) : colonne à droite de la fenêtre, onglet RTTY
    const bm = document.createElement('aside');
    bm.className = 'bm';
    bm.id = 'bandMap';
    bm.hidden = true;
    bm.setAttribute('aria-label', 'Carte de bande');
    bm.innerHTML = '<div class="bm-h"><span class="bm-st" id="bmSt"></span><b id="bmBandT" class="bm-band">—</b><span class="bm-vfo">VFO-A · MAIN</span><span class="bm-t">Spots</span>'
      + '<span class="bm-fw"><button type="button" class="bm-fbtn" id="bmFbtn" aria-haspopup="true" aria-expanded="false" title="Choisir les modes dont les spots sont affichés (liste des modes de cet onglet)">Filtres ▾</button>'
      + '<button type="button" class="bm-all" id="bmAll" aria-pressed="false" title="Tous les spots de la plage, quel que soit leur mode (les filtres sont ignorés)">Tous</button>'
      + '<span class="bm-fmenu" id="bmFmenu" role="menu" hidden></span></span>'
      + (EMBED ? '<button type="button" class="bm-pop" id="bmPop" title="Ouvrir la carte de bande dans une fenêtre séparée (autre écran…) ; dans la fenêtre : la ramener à droite de la face avant">⧉</button>' : '') + '</div>'
      + '<div class="bm-r" title="Plage affichée pour cette bande (kHz), gardée par bande. Molette sur la carte : zoom · glisser : déplacer · double-clic : plage d’origine">'
      + '<input id="bmLo" inputmode="decimal" aria-label="Début de la plage (kHz)"><span>–</span><input id="bmHi" inputmode="decimal" aria-label="Fin de la plage (kHz)"><span>kHz</span></div>'
      + '<div class="bm-body" id="bmBody"><canvas id="bmCv"></canvas><div class="bm-lbls" id="bmLbls"></div><div class="bm-sb" id="bmSb" title="Ascenseur : parcourir la bande (même largeur de plage)"><i></i></div></div>'
      + '<div class="bm-f" id="bmFoot"></div>'
      + '<i class="bm-grip" id="bmGrip" title="Glisser à gauche ou à droite : largeur de la carte de bande (double-clic : largeur d’origine)"></i>';
    panel.appendChild(bm);
    // FTDX101 en double réception (FT8 / FT4 / FT2) : 2e carte de bande, celle de la bande du VFO-B (SUB)
    const bmB = document.createElement('aside');
    bmB.className = 'bm bm-b';
    bmB.id = 'bandMapB';
    bmB.hidden = true;
    bmB.setAttribute('aria-label', 'Carte de bande du VFO-B');
    bmB.innerHTML = '<div class="bm-h"><span class="bm-st" id="bmStB"></span><b id="bmBandTB" class="bm-band">—</b><span class="bm-vfo b">VFO-B · SUB</span><span class="bm-t">Spots</span>'
      + '<span class="bm-fw"><button type="button" class="bm-fbtn" id="bmFbtnB" aria-haspopup="true" aria-expanded="false" title="Choisir les modes dont les spots sont affichés sur cette carte">Filtres ▾</button>'
      + '<button type="button" class="bm-all" id="bmAllB" aria-pressed="false" title="Tous les spots de la plage, quel que soit leur mode (les filtres sont ignorés)">Tous</button>'
      + '<span class="bm-fmenu" id="bmFmenuB" role="menu" hidden></span></span></div>'
      + '<div class="bm-r" title="Plage affichée pour cette bande (kHz), gardée par bande. Molette sur la carte : zoom · glisser : déplacer · double-clic : plage d’origine">'
      + '<input id="bmLoB" inputmode="decimal" aria-label="Début de la plage (kHz)"><span>–</span><input id="bmHiB" inputmode="decimal" aria-label="Fin de la plage (kHz)"><span>kHz</span></div>'
      + '<div class="bm-body" id="bmBodyB"><canvas id="bmCvB"></canvas><div class="bm-lbls" id="bmLblsB"></div><div class="bm-sb" id="bmSbB" title="Ascenseur : parcourir la bande (même largeur de plage)"><i></i></div></div>'
      + '<div class="bm-f" id="bmFootB"></div>'
      + '<i class="bm-grip" id="bmGripB" title="Glisser à gauche ou à droite : largeur des cartes de bande (double-clic : largeur d’origine)"></i>';
    panel.appendChild(bmB);
    add('away', 'dg-soon', '<p>Les modes numériques sont ouverts dans une <b>fenêtre séparée</b>.</p><p><button class="btn" type="button" id="dgBack">Ramener ici</button></p>');
  }

  // ------------------------------------------------------------------ suivre l'opérateur
  let follow = store.get(POPUP ? 'pfollow' : 'follow', '0') === '1';
  let autoFollowDone = false; // une fois par ouverture de la page
  let followCtl = null; // opérateur qui avait la main au dernier passage (nouvel opérateur : suivi remis)
  let viewSent = '';
  function setFollow(on, fromHost) {
    follow = !!on;
    store.set(POPUP ? 'pfollow' : 'follow', follow ? '1' : '0');
    const b = $('dgFollow');
    if (b) b.setAttribute('aria-pressed', String(follow));
    // Face avant : un seul « Suivre l'opérateur » (le bouton de la face avant suit celui-ci, et inversement)
    if (!fromHost && api && api.followFace) api.followFace(follow);
  }
  // Celui qui a la main annonce l'onglet affiché (la fenêtre séparée s'en charge quand les modes y sont ouverts)
  // … avec ses repères sur la cascade (RTTY A / B, CW, RX / TX des modes FT), pour que ceux qui le suivent les voient bouger
  let viewTimer = null;
  function viewMarks() {
    const rt = (r) => ({ f: Math.round(r.f), shift: r.shift, baud: r.baud, rev: !!r.rev });
    return { rtty: [rt(rts[0]), rt(rts[1])], rtTx, cw: { f: Math.round(cwc.f), bw: cwc.bw }, cwB: { f: Math.round(cwcB.f), bw: cwcB.bw }, rx: rxF, tx: txF };
  }
  function sendView() {
    if (!api || !api.iControl() || (detached && HOST)) return;
    const marks = viewMarks();
    const k = tab + '/' + (tab === 'ftx' || tab === 'jt65' ? mode : '') + '/' + JSON.stringify(marks);
    if (k === viewSent) return;
    if (viewTimer) return; // au plus un envoi toutes les 150 ms pendant un glisser
    viewSent = k;
    api.send({ t: 'view', tab, mode: tab === 'ftx' || tab === 'jt65' ? mode : null, marks });
    viewTimer = setTimeout(() => { viewTimer = null; sendView(); }, 150);
  }
  // Repères de l'opérateur suivi, repris ici (et par les décodeurs de cette page, pour lire le même signal)
  let marksSeen = '';
  function followMarks(m) {
    if (!m || typeof m !== 'object') return;
    const k = JSON.stringify(m);
    if (k === marksSeen) return;
    marksSeen = k;
    let rt = false;
    (Array.isArray(m.rtty) ? m.rtty : []).slice(0, 2).forEach((x, ch) => {
      if (!x || !(x.f > 0)) return;
      const r = rts[ch];
      if (r.f === x.f && r.shift === x.shift && r.baud === x.baud && !!r.rev === !!x.rev) return;
      Object.assign(r, { f: x.f, shift: Number(x.shift) || r.shift, baud: Number(x.baud) || r.baud, rev: !!x.rev });
      const sfx = RT_SFX[ch];
      if ($('rtShift' + sfx)) { $('rtShift' + sfx).value = String(r.shift); $('rtBaud' + sfx).value = String(r.baud); $('rtRev' + sfx).setAttribute('aria-pressed', String(r.rev)); }
      rt = true;
    });
    if ((m.rtTx === 0 || m.rtTx === 1) && m.rtTx !== rtTx) { rtTx = m.rtTx; rt = true; if (typeof rtHeads === 'function') rtHeads(); }
    if (rt) { saveRtty(true); applySpan(); }
    if (m.cw && m.cw.f > 0 && (m.cw.f !== Math.round(cwc.f) || m.cw.bw !== cwc.bw)) {
      cwc.f = m.cw.f;
      if ([50, 100, 200, 400].indexOf(m.cw.bw) >= 0) { cwc.bw = m.cw.bw; if ($('cwBw')) $('cwBw').value = String(cwc.bw); }
      saveCw(true);
    }
    if (m.cwB && m.cwB.f > 0 && (m.cwB.f !== Math.round(cwcB.f) || m.cwB.bw !== cwcB.bw)) {
      cwcB.f = m.cwB.f;
      if ([50, 100, 200, 400].indexOf(m.cwB.bw) >= 0) { cwcB.bw = m.cwB.bw; if ($('cwBwB')) $('cwBwB').value = String(cwcB.bw); }
      saveCw(true);
    }
    if (m.rx > 0 && m.rx !== rxF) { rxF = m.rx; redrawRx(); if (tab === 'jtty') jtRedraw(); }
    if (m.tx > 0 && m.tx !== txF) txF = m.tx;
    drawScale();
    bmDraw();
  }
  function followView() {
    const st = api && api.state();
    const v = st && st.view;
    if (!follow || !v || !v.tab || api.iControl() || (detached && HOST)) return;
    if (!document.querySelector('#centerPanel .ctab[data-tab="' + v.tab + '"]')) return; // onglet absent ici (fenêtre séparée : Activité, Logs)
    if (v.tab === 'ftx' && v.mode && v.mode !== mode && ['FT8', 'FT4', 'FT2'].indexOf(v.mode) >= 0) setMode(v.mode);
    if (v.tab !== tab) showTab(v.tab);
    if (v.marks) followMarks(v.marks);
  }

  // ------------------------------------------------------------------ onglets
  let rtTipT = 0;
  let rtDualAudio = false; // RTTY : deux cascades (une par récepteur) — FTDX101 en double réception
  let rtSeen = false; // fenêtre RTTY déjà ouverte depuis le chargement de la page
  let rtBAuto = false; // décodeur B mis à 2100 Hz faute de savoir encore si le TRX envoie ses deux récepteurs
  function showTab(t) {
    if (!document.querySelector('#centerPanel .ctab[data-tab="' + t + '"]')) t = POPUP ? 'ftx' : 'events';
    const rtEnter = t === 'rtty' && (tab !== 'rtty' || !rtSeen) && !detached;
    tab = t;
    // Ligne Correspondant : reports en dB (FT8 / FT4 / FT2, WSPR, JT65) ou RST 599 (RTTY, CW, SSTV, JTTY)
    const mb = document.getElementById('msgs');
    // Dashboard, onglets Modes et Logbooks : pas de ligne QSO (la fiche du carnet a déjà indicatif, reports et TX call)
    if (mb && !POPUP) mb.classList.toggle('qso-off', t === 'log' || t === 'events');
    if (mb && ['ftx', 'wspr', 'jt65'].indexOf(t) >= 0) mb.dataset.rk = 'db';
    else if (mb && ['rtty', 'cw', 'sstv', 'jtty'].indexOf(t) >= 0) mb.dataset.rk = 'rst';
    store.set(POPUP ? 'ptab' : 'tab', t);
    // JT65 utilise la même fenêtre que FT8 / FT4 (cascade, activité de bande, fréquence RX, split)
    let pane = detached && MODE_TABS.indexOf(t) >= 0 ? 'away' : t === 'jt65' ? 'ftx' : t;
    if (pane === 'ftx') {
      const want = t === 'jt65' ? 'JT65' : ftStored();
      if (mode !== want) { mode = want; modeChanged(); if (api && t === 'jt65' && api.iControl()) setTimeout(autoQsy, 0); }
      const seg = $('dgModes');
      if (seg) seg.style.display = t === 'jt65' ? 'none' : ''; // JT65 : pas de choix FT8 / FT4
    }
    document.querySelectorAll('#centerPanel .ctab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    // Synchro (heure du PC, décalage DT) : utile en FT8 / FT4 / FT2, WSPR, JT65 ; pas en RTTY, JTTY, CW, SSTV
    const syb = document.querySelector('#centerPanel .ctab[data-tab="sync"]');
    if (syb) syb.hidden = ['rtty', 'jtty', 'cw', 'sstv'].indexOf(t) >= 0;
    document.querySelectorAll('#centerPanel .ctab-pane').forEach((p) => { p.hidden = p.dataset.pane !== pane; });
    bmShow();
    // RTTY : l'aide de la cascade s'affiche 3 secondes à l'arrivée sur l'onglet, puis s'efface (reste au survol de la cascade)
    if (pane === 'rtty' && $('rtTip')) {
      $('rtTip').hidden = false;
      clearTimeout(rtTipT);
      rtTipT = setTimeout(() => { if ($('rtTip')) { $('rtTip').hidden = true; sizeCanvas(); } }, 3000);
    }
    if ($('dgWf')) $('dgWf').title = pane === 'rtty' && $('rtTip') ? $('rtTip').textContent : '';
    if ($('dgScale')) $('dgScale').style.cursor = pane === 'rtty' ? 'ew-resize' : '';
    if ($('dgScale')) $('dgScale').title = pane === 'rtty' ? 'Règle des fréquences : molette ou glisser = accorder le VFO-A (le TRX suit), sur toute la bande' : '';
    // Une seule cascade, déplacée dans la fenêtre affichée (FT8/FT4 ou RTTY)
    if (WF_TABS.indexOf(pane) >= 0) {
      // RTTY sur un TRX qui envoie ses deux récepteurs séparément (DUAL_AUDIO, ex. FTDX101D / MP) : une cascade par
      // décodeur, côte à côte ; sinon une seule cascade pour les deux décodeurs (FTX-1, FTDX10, IC-7300 : un seul son)
      // (seulement en double réception : en réception simple, la voie droite est muette)
      rtDualAudio = dualAudioOn();
      const dualAudio = rtDualAudio;
      // Ouverture de la fenêtre RTTY : repères des décodeurs sur 1500 Hz (le milieu de la cascade) ;
      // une seule cascade pour les deux décodeurs (TRX à un son) : B un peu plus haut, pour qu'on les distingue
      if (pane === 'rtty' && rtEnter) {
        rtSeen = true;
        rts[0].f = 1500;
        rts[1].f = dualAudio ? 1500 : 2100;
        rtBAuto = !dualAudio; // double réception reconnue juste après (état du TRX arrivé ensuite) : B passe aussi à 1500
        saveRtty(false);
      } else if (pane === 'rtty' && dualAudio && rtBAuto) {
        rtBAuto = false;
        if (rts[1].f === 2100) { rts[1].f = 1500; saveRtty(false); }
      }
      if ($('rtWfB')) $('rtWfB').closest('.rt-wfb').hidden = !dualAudio;
      const slot = document.querySelector('.dg-wf-slot[data-slot="' + (pane === 'rtty' && dualAudio ? 'rtty-a' : pane) + '"]');
      const el = document.querySelector('.dg-wf:not(.rt-wfb):not(.ft-wfb)'); // cascade principale (pas celle du décodeur RTTY B ni du VFO-B en FT)
      if (slot && el && el.parentElement !== slot) slot.appendChild(el);
      el.classList.toggle('is-rtty', pane === 'rtty' || pane === 'cw');
      for (const id of ['dgMkBM', 'dgMkBS']) if ($(id)) $(id).hidden = pane !== 'rtty' || dualAudio; // repères du décodeur RTTY B
      applyFtDual();
      bmShow(); // deux cartes de bande selon la double réception (FT, RTTY)
      applySpan();
      sizeCanvas();
    }
    // TX call : sur la ligne des onglets, juste après SYNCHRO (le même pour tous les modes)
    const txc = $('dgTxcWrap'), syt = document.querySelector('#centerPanel .ctab[data-tab="sync"]');
    if (txc && syt && txc.previousElementSibling !== syt) { txc.classList.add('ctab-txc'); syt.after(txc); }
    if (pane === 'sync') drawSync();
    sendView();
    if (pane === 'log' && window.RSLOG) window.RSLOG.show();
    if (pane === 'sstv' && ssShown) { const it = ssImgs.get(ssShown); if (it && it.data) ssCanvasFor(it.meta).putImageData(it.data, 0, 0); ssThumbs(); }
    announce();
  }
  function setDetached(on) {
    detached = !!on;
    if (!on) { needHist = true; wsNeedHist = true; jtNeedHist = true; ssNeedHist = true; } // retour de la fenêtre séparée : on récupère ce qui a été décodé entre-temps
    // Fenêtre séparée ouverte : le centre du dashboard revient sur l'activité de la station
    showTab(on && !POPUP && MODE_TABS.indexOf(tab) >= 0 ? (logHere() ? 'log' : 'events') : tab);
  }
  // Le serveur ne décode (et la station n'envoie la BF) que si au moins un membre regarde la fenêtre
  function announce() {
    if (!api || (detached && HOST)) return; // la fenêtre séparée annonce elle-même
    const watching = WF_TABS.indexOf(tab) >= 0 && !$('centerPanel').classList.contains('collapsed') && !document.hidden;
    if (watching && tab === 'cw') return api.send({ t: 'digi', mode: 'CW', cw: cwc, cw2: ftDual ? cwcB : null, ftDual });
    // Page CW ouverte (elle se signale chaque seconde) : décodage CW pour sa fenêtre de réception, sauf si un autre
    // mode est affiché ici alors que le TRX n'est pas en CW
    let cwPage = false;
    try { cwPage = Date.now() - Number(localStorage.getItem('rs.dg.cwpageAt') || 0) < 3500; } catch (e) { cwPage = false; }
    if (cwPage) {
      const st = api.state();
      const r = (st && st.radio) || {};
      if (!watching || /^CW/i.test(String((r.vfoSel === 1 ? r.modeB : r.mode) || ''))) return api.send({ t: 'digi', mode: 'CW', cw: cwc, cw2: null, ftDual: false });
    }
    if (watching && tab === 'sstv') { api.send({ t: 'digi', mode: 'SSTV', hist: ssNeedHist }); ssNeedHist = false; return; }
    if (watching && tab === 'jtty') { api.send({ t: 'digi', mode: 'JTTY', hist: jtNeedHist, ftDual }); jtNeedHist = false; return; }
    if (watching && tab === 'rtty') return api.send({ t: 'digi', mode: 'RTTY', rtty: rts[0], rtty2: rts[1], rtDual: rtDualAudio });
    if (watching && tab === 'wspr') { api.send({ t: 'digi', mode: 'WSPR', hist: wsNeedHist, ftDual }); wsNeedHist = false; return; }
    // Onglet Synchro : le décodage FT8 / FT4 continue (mesures de la case Décodages et du DT médian en direct)
    const syncTab = tab === 'sync' && !$('centerPanel').classList.contains('collapsed') && !document.hidden && /^FT[48]$/.test(mode);
    if (!watching && syncTab) return api.send({ t: 'digi', mode, hist: false, ftDual: false });
    api.send({ t: 'digi', mode: watching ? mode : null, hist: watching && needHist, ftDual: watching && ftDual });
    if (watching) needHist = false;
  }

  // ------------------------------------------------------------------ cascade
  const wf = { ctx: null, sctx: null, w: 0, h: 140, img: null };
  const wfB = { ctx: null, sctx: null, w: 0, h: 0, cw: 0 }; // cascade du 2e décodeur RTTY (même spectre)
  function sizeB() {
    const c = $('rtWfB');
    if (tab !== 'rtty' || !c || !c.clientWidth) return;
    const s = $('rtScaleB');
    c.style.height = $('dgWf').clientHeight + 'px'; // même hauteur que la cascade A (poignée)
    const dpr = wf.dpr || 1;
    const cw = Math.max(120, Math.floor(c.clientWidth));
    const w = Math.round(cw * dpr);
    const h = Math.round(Math.max(40, c.clientHeight) * dpr);
    for (const id of ['rtMkMB', 'rtMkSB']) $(id).style.top = (s.offsetTop + s.offsetHeight) + 'px';
    if (w === wfB.w && h === wfB.h && wfB.ctx) return;
    let old = null;
    if (wfB.ctx) { old = document.createElement('canvas'); old.width = wfB.w; old.height = wfB.h; old.getContext('2d').drawImage(c, 0, 0); }
    const ow = wfB.w, oh = wfB.h;
    c.width = w; c.height = h;
    s.width = w; s.height = Math.round(SCALE_H * dpr);
    Object.assign(wfB, { w, h, cw, ctx: c.getContext('2d'), sctx: s.getContext('2d') });
    wfB.sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wfB.ctx.fillStyle = '#05080d';
    wfB.ctx.fillRect(0, 0, w, h);
    if (old) wfB.ctx.drawImage(old, 0, 0, ow, oh, 0, 0, w, oh);
  }
  // FT8 / FT4 / FT2 en double réception : cascade du VFO-B à droite de celle du VFO-A, même hauteur
  const wfFB = { ctx: null, sctx: null, w: 0, h: 0, cw: 0, per: null };
  function sizeFB() {
    const c = $('ftWfB');
    if (!ftDual || !c || !c.clientWidth) return;
    const s = $('ftScaleB');
    c.style.height = $('dgWf').clientHeight + 'px';
    const dpr = wf.dpr || 1;
    const cw = Math.max(120, Math.floor(c.clientWidth));
    const w = Math.round(cw * dpr);
    const h = Math.round(Math.max(40, c.clientHeight) * dpr);
    for (const id of ['ftMkRxB', 'ftMkTxB', 'cwTrxB', 'ftMkNB']) if ($(id)) $(id).style.top = (s.offsetTop + s.offsetHeight) + 'px';
    sizeSpec(wfFB, $('ftSpecB'), c, $('ftGripB'));
    if (w === wfFB.w && h === wfFB.h && wfFB.ctx) return;
    let old = null;
    if (wfFB.ctx) { old = document.createElement('canvas'); old.width = wfFB.w; old.height = wfFB.h; old.getContext('2d').drawImage(c, 0, 0); }
    const ow = wfFB.w, oh = wfFB.h;
    c.width = w; c.height = h;
    s.width = w; s.height = Math.round(SCALE_H * dpr);
    Object.assign(wfFB, { w, h, cw, ctx: c.getContext('2d'), sctx: s.getContext('2d') });
    wfFB.sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wfFB.ctx.fillStyle = '#05080d';
    wfFB.ctx.fillRect(0, 0, w, h);
    if (old) wfFB.ctx.drawImage(old, 0, 0, ow, oh, 0, 0, w, oh);
  }
  // Onglets décodés aussi sur le récepteur SUB (FTDX101 en double réception) ; JT65 utilise la fenêtre FT8
  const DUAL_TABS = ['ftx', 'jt65', 'wspr', 'jtty', 'cw'];
  const dualTab = () => DUAL_TABS.indexOf(tab) >= 0;
  const viewB = () => zoomView('B') || { lo: WF_LO, span: WF_MAX_HZ }; // plage de la cascade B (zoom : FT et CW)
  function ftDualWant() {
    // TRX à deux vrais récepteurs dont les deux voies arrivent séparément (FTDX101D / MP en DUAL RX) : dashboard, sa page
    // TRX DIGI et la face avant /ftdx101 ; FTX-1 : une seule cascade (sa double réception reste dans sa page de face avant)
    // Bouton DUAL RX de la barre : affichage d'un seul VFO même quand le TRX reçoit sur les deux
    if (store.get('dualview', '1') === '0') return false;
    return !!(!detached && dualAudioOn() && api.rig().ID !== 'ftx1' && ((tab === 'ftx' && FT_MODES.indexOf(mode) >= 0) || ['jt65', 'wspr', 'jtty', 'cw'].indexOf(tab) >= 0));
  }
  let ftDualPane = '';
  /** Affiche ou retire la cascade et les colonnes du VFO-B (FTDX101 en double réception) ; true si changé. */
  function applyFtDual() {
    const box = $('ftWfBox');
    if (!box) return false;
    const want = ftDualWant();
    const paneName = tab === 'jt65' ? 'ftx' : tab;
    if (want === ftDual && (!want || paneName === ftDualPane)) return false;
    ftDual = want;
    ftDualPane = want ? paneName : '';
    document.querySelectorAll('#centerPanel .ctab-pane.ft-dual').forEach((p) => p.classList.remove('ft-dual'));
    const pane = want && document.querySelector('#centerPanel .ctab-pane[data-pane="' + paneName + '"]');
    if (pane) {
      pane.classList.add('ft-dual');
      const row = pane.querySelector('.ft-wfrow');
      if (row && box.parentElement !== row) row.appendChild(box); // la cascade B suit l'onglet (FT8, WSPR, JTTY)
    }
    box.hidden = !want;
    document.querySelectorAll('.dual-colb').forEach((e) => { e.hidden = !want; });
    if (!want) { wfFB.ctx = null; wfFB.w = 0; }
    needHist = true; wsNeedHist = true; jtNeedHist = true; // décodages du VFO-B déjà reçus par le serveur
    sideBtns();
    bmShow(); // 2e carte de bande (bande du VFO-B)
    if (wf.ctx) sizeCanvas();
    redrawAll();
    if ($('wsList')) wsRedraw();
    jtRedrawB();
    cwCtlPlace();
    cwRowsB.length = 0;
    ftSyncViews(); // même plage pour les deux cascades
    return true;
  }
  // « TX call » dans la barre FT (face avant /ftdx101 et fenêtre séparée) ; le dashboard a déjà le sien (ligne Correspondant)
  let txcMe = null, txcSentDg = null;
  function drawTxCallDg() {
    const sel = $('dgTxCall'), wrap = $('dgTxcWrap');
    if (!sel || !wrap) return;
    const dash = !!document.getElementById('txCallSel');
    wrap.hidden = dash || !txcMe;
    if (wrap.hidden || !api) return;
    const club = txcMe.digiCall;
    const clubs = txcMe.clubs.length ? txcMe.clubs : [club];
    const mine = txcMe.call;
    const opts = clubs.concat(txcMe.canTx && !txcMe.rxOnly && mine && clubs.indexOf(mine) < 0 ? [mine] : []);
    if (sel.dataset.opts !== opts.join(',')) {
      sel.dataset.opts = opts.join(',');
      sel.textContent = '';
      for (const c of opts) sel.add(new Option(clubs.indexOf(c) >= 0 ? c + ' (station)' : c, c));
    }
    const st = api.state();
    const cur = String((st && st.txCall) || club).toUpperCase();
    if (opts.indexOf(cur) < 0) { sel.add(new Option(cur, cur)); sel.dataset.opts = ''; }
    if (document.activeElement !== sel) sel.value = cur;
    sel.disabled = !api.iControl() || opts.length < 2;
    // Avec la main : le choix gardé dans ce navigateur (le même que sur le dashboard) est rappelé au serveur
    let want = null;
    try { want = localStorage.getItem('rs.txcall'); } catch (x) { /* */ }
    if (api.iControl() && opts.length > 1 && want && opts.indexOf(want) >= 0 && cur !== want && txcSentDg !== want) { txcSentDg = want; api.send({ t: 'txcall', call: want }); }
    if (!api.iControl()) txcSentDg = null;
  }
  function ftDials() {
    if (!ftDual) return;
    const r = api && api.state() && api.state().radio;
    const f = (hz) => (hz ? (hz / 1e6).toFixed(3) + ' MHz' : '');
    if ($('ftDialA')) $('ftDialA').textContent = f(r && r.freq);
    if ($('ftDialB')) $('ftDialB').textContent = f(r && r.freqB);
    // Mode de chaque VFO : vert en DATA-U / USB (bon pour FT8 / FT4 / FT2), orange sinon
    for (const [id, md] of [['ftModeA', r && r.mode], ['ftModeB', r && r.modeB]]) {
      const e = $(id);
      if (!e) continue;
      e.textContent = md || '—';
      // IC-7300 : modes numériques toujours en USB-D (en USB simple, la modulation vient du micro)
      const ok = tab === 'cw' ? /^CW/.test(md || '') : /^ic/.test(((api.rig && api.rig()) || {}).ID || '') ? /-D$/.test(md || '') : /^(DATA-U|USB|USB-D|PKT-U|DATA-USB)$/.test(md || '');
      e.classList.toggle('bad', !ok);
      e.title = ok ? 'Mode du VFO' : tab === 'cw' ? 'Mode du VFO : pour décoder la CW, mettez ce VFO en CW (filtre étroit, tonalité = pitch)' : 'Mode du VFO : pour FT8 / FT4 / FT2, mettez ce VFO en DATA-U (↺ de la barre du haut pour le VFO-A)';
    }
  }
  function sideBtns() {
    document.querySelectorAll('#dgTxSide .btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.side === sd())));
    const pane = $('ftWfBox') && ($('ftWfBox').closest('.ctab-pane') || $('ftWfBox').parentElement);
    if (pane) pane.classList.toggle('ft-txb', sd() === 'B');
  }
  /** VFO d'émission (double réception) : la séquence en cours suit (le TRX passe TX sur MAIN ou SUB). */
  let sideSetAt = 0; // dernier choix fait ici : le TRX a 3 s pour le relire avant qu'on suive à nouveau ce qu'il dit
  function setSide(v, quiet) {
    v = v === 'B' && ftDual ? 'B' : 'A';
    if (v === ftSide) return;
    ftSide = v;
    sideBtns();
    drawScale();
    sideSetAt = Date.now();
    // Émission auto en cours : la séquence passe sur ce VFO ; sinon (avec la main) le TRX passe TX sur MAIN / SUB tout de suite
    const st = api && api.state();
    if (st && st.seq && st.seq.on && st.seq.by === opCall) ftxCfg();
    else if (api && api.iControl() && st && st.radio && st.radio.txVfo !== (v === 'B' ? 1 : 0)) api.send({ t: 'set', ctl: 'txVfo', value: v === 'B' ? 1 : 0 });
    if (!quiet && api) api.say('Émission sur le ' + (v === 'B' ? 'VFO-B (SUB)' : 'VFO-A (MAIN)') + '.', '', 2500);
  }
  function sizeCanvas() {
    const c = $('dgWf');
    const s = $('dgScale');
    // Repères RX / TX sous l'échelle (la barre de réglages au-dessus peut tenir sur une ou deux lignes)
    for (const id of ['dgMkRx', 'dgMkTx', 'dgMkBM', 'dgMkBS', 'cwTrxA', 'dgMkN']) if ($(id)) $(id).style.top = (s.offsetTop + s.offsetHeight) + 'px';
    // Pixels de l'écran (pas les pixels CSS) : sur un écran à 125 / 150 %, la cascade reste aussi fine que l'écran le permet,
    // et une cascade agrandie avec la poignée montre plus d'historique au lieu d'étirer les lignes
    const dpr = Math.min(4, Math.max(1, (window.devicePixelRatio || 1) * (window.RSZOOM ? window.RSZOOM.z() : 1)));
    const cw = Math.max(200, Math.floor(c.clientWidth || c.parentElement.clientWidth));
    const ch = Math.max(40, Math.round(c.clientHeight || 140));
    const w = Math.round(cw * dpr);
    const h = Math.round(ch * dpr);
    sizeSpec(wf, $('dgSpec'), c, $('dgGrip'));
    if (w === wf.w && h === wf.h && wf.ctx) { sizeB(); sizeFB(); return drawScale(); }
    let old = null;
    if (wf.ctx) { old = document.createElement('canvas'); old.width = wf.w; old.height = wf.h; old.getContext('2d').drawImage(c, 0, 0); }
    const ow = wf.w, oh = wf.h;
    c.width = w;
    c.height = h;
    s.width = w;
    s.height = Math.round(SCALE_H * dpr);
    wf.w = w;
    wf.h = h;
    wf.cw = cw;
    wf.dpr = dpr;
    wf.ctx = c.getContext('2d');
    wf.sctx = s.getContext('2d');
    wf.sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wf.ctx.fillStyle = '#05080d';
    wf.ctx.fillRect(0, 0, w, h);
    if (old) wf.ctx.drawImage(old, 0, 0, ow, oh, 0, 0, w, oh); // largeur remise à l'échelle, lignes gardées telles quelles
    sizeB();
    sizeFB();
    drawScale();
  }
  // Vitesse du spectre (boutons X1 / X2 / X4 en haut à gauche du spectre) : lissage plus ou moins long
  const SP_TAU = { 1: 6, 2: 2, 4: 0.3 }; // secondes
  let spSpd = [1, 2, 4].indexOf(Number(store.get('spspd', '1'))) >= 0 ? Number(store.get('spspd', '1')) : 1;
  function spSpdUi() {
    document.querySelectorAll('.dg-spspd button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.spspd) === spSpd)));
  }
  // Spectre sous la cascade : taille en pixels de l'écran ; la poignée de la cascade se place entre les deux
  function sizeSpec(T, cv, wcv, grip) {
    if (!cv) return;
    if (grip && wcv) { grip.style.top = (wcv.offsetTop + wcv.offsetHeight - 5) + 'px'; grip.style.bottom = 'auto'; }
    const sw = cv.parentElement && cv.parentElement.querySelector('.dg-spspd');
    if (sw) sw.style.top = (cv.offsetTop + 4) + 'px';
    const dpr = wf.dpr || 1;
    const w = Math.round(Math.max(120, cv.clientWidth) * dpr), h = Math.round(Math.max(20, cv.clientHeight) * dpr);
    if (T.sp && T.sp.w === w && T.sp.h === h) return;
    cv.width = w; cv.height = h;
    T.sp = { ctx: cv.getContext('2d'), w, h, v: null };
    drawSpec(T);
  }
  // Courbe du spectre (comme le « Spectrum » de WSJT-X) : niveau lissé de chaque colonne de la cascade
  function drawSpec(T) {
    const S = T.sp;
    if (!S || !S.ctx) return;
    const c = S.ctx, w = S.w, h = S.h, dpr = wf.dpr || 1;
    c.fillStyle = '#05080d';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(120, 140, 165, .22)';
    c.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75]) { const y = Math.round(h * f) + 0.5; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    const v = S.v;
    if (!v || v.length !== w) return;
    const top = 3 * dpr, H = h - top - 1;
    // Lissage sur ± 2 pixels CSS (courbe lisible, les signaux restent nets)
    const r = Math.max(1, Math.round(2 * dpr));
    if (!S.sm || S.sm.length !== w) S.sm = new Float32Array(w);
    for (let x = 0, acc = 0, n = 0; x < w; x++) {
      acc = 0; n = 0;
      for (let j = Math.max(0, x - r); j <= Math.min(w - 1, x + r); j++) { acc += v[j]; n++; }
      S.sm[x] = acc / n;
    }
    const sm = S.sm;
    const yOf = (x) => h - 1 - Math.min(1, sm[x] / 255) * H;
    c.beginPath();
    c.moveTo(0, h);
    for (let x = 0; x < w; x++) c.lineTo(x, yOf(x));
    c.lineTo(w, h);
    c.closePath();
    const g = c.createLinearGradient(0, top, 0, h);
    g.addColorStop(0, 'rgba(111, 245, 196, .55)');
    g.addColorStop(1, 'rgba(46, 229, 157, .08)');
    c.fillStyle = g;
    c.fill();
    c.beginPath();
    for (let x = 0; x < w; x++) { const y = yOf(x); if (x) c.lineTo(x, y); else c.moveTo(x, y); }
    c.strokeStyle = '#6ff5c4';
    c.lineWidth = Math.max(1, dpr);
    c.stroke();
  }
  // Palette : bruit sombre → bleu → cyan → jaune → rouge
  const PALS = {
    // JTDX : bruit bleu, signaux jaunes, signaux forts orange puis rouge
    jtdx: [[0, 0, 0, 24], [0.12, 0, 8, 105], [0.28, 10, 45, 215], [0.4, 60, 105, 255], [0.52, 235, 225, 40], [0.62, 255, 200, 0], [0.8, 255, 110, 0], [1, 235, 0, 0]],
    classic: [[0, 5, 8, 13], [0.25, 10, 40, 110], [0.5, 0, 170, 220], [0.75, 240, 220, 70], [1, 255, 60, 30]],
    wsjtx: [[0, 0, 0, 0], [0.18, 0, 0, 120], [0.36, 0, 70, 255], [0.54, 0, 210, 220], [0.7, 140, 255, 60], [0.84, 255, 210, 0], [0.94, 255, 70, 0], [1, 255, 255, 255]],
    gray: [[0, 0, 0, 0], [1, 255, 255, 255]]
  };
  const mkPal = (stops) => {
    const p = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      let k = 0;
      while (k < stops.length - 2 && x > stops[k + 1][0]) k++;
      const a = stops[k], b = stops[k + 1];
      const u = (x - a[0]) / (b[0] - a[0]);
      for (let j = 0; j < 3; j++) p[i * 3 + j] = Math.round(a[j + 1] + (b[j + 1] - a[j + 1]) * u);
    }
    return p;
  };
  // Réglages de la cascade (gardés dans ce navigateur) : gain = contraste, zéro = niveau du fond, plat = fond aplati
  const wfCfg = {
    gain: Number(store.get('wfgain', '0')) || 0,
    zero: Number(store.get('wfzero', '0')) || 0,
    flat: store.get('wfflat', '1') === '1',
    pal: PALS[store.get('wfpal2', 'jtdx')] ? store.get('wfpal2', 'jtdx') : 'jtdx',
    spd: [1, 2, 3].indexOf(Number(store.get('wfspd', '2'))) >= 0 ? Number(store.get('wfspd', '2')) : 2
  };
  let PAL = mkPal(PALS[wfCfg.pal]);
  // Cascade du VFO-B (double réception) : ses propres réglages
  const wfCfgB = {
    gain: Number(store.get('wfgainb', String(wfCfg.gain))) || 0,
    zero: Number(store.get('wfzerob', String(wfCfg.zero))) || 0,
    flat: store.get('wfflatb', wfCfg.flat ? '1' : '0') === '1',
    pal: PALS[store.get('wfpalb', wfCfg.pal)] ? store.get('wfpalb', wfCfg.pal) : 'jtdx',
    spd: [1, 2, 3].indexOf(Number(store.get('wfspdb', String(wfCfg.spd)))) >= 0 ? Number(store.get('wfspdb', String(wfCfg.spd))) : 2
  };
  let PALB = mkPal(PALS[wfCfgB.pal]);
  // Plancher de bruit (médiane lissée) et plancher de chaque case (fond aplati) : wf.floor / wf.binFloor,
  // et de même pour la cascade B (voie droite d'un TRX à deux récepteurs) : wfB.floor / wfB.binFloor
  // Voie droite (0x14) : seulement en RTTY, avec un TRX qui envoie ses deux récepteurs (FTDX101 en double réception)
  function dualAudioOn() {
    const st = api && api.state && api.state();
    // FTX-1 : seulement dans sa page de face avant (/ftx1) ; le dashboard garde une seule cascade
    return !!(api && api.rig && api.rig() && api.rig().DUAL_AUDIO && (api.rig().ID !== 'ftx1' || FACEP === '/ftx1') && st && st.radio && st.radio.dualRx === 1);
  }
  function onRow(bytes) {
    const isB = bytes[0] === 0x14;
    const ftB = isB && ftDual && dualTab() && !!wfFB.ctx; // VFO-B en FT8 / FT4 / FT2, JT65, WSPR, JTTY (double réception)
    if (isB && !ftB && !(tab === 'rtty' && wfB.ctx && rtDualAudio)) return;
    if (WF_TABS.indexOf(tab) < 0 || detached || !wf.ctx) return;
    const T = isB ? (ftB ? wfFB : wfB) : wf; // cascade dessinée
    // 0x10 : une case de 6,25 Hz par octet (dB*2+240) depuis 0 Hz (ancien serveur)
    // 0x13 : largeur de case (mHz, 2 octets), heure de capture (dixièmes de s du jour UTC, 4 octets), puis les cases
    const fine = bytes[0] === 0x13 || isB;
    const df = fine ? ((bytes[1] << 8) | bytes[2]) / 1000 : 6.25;
    const tday = fine ? (((bytes[3] << 24) >>> 0) + (bytes[4] << 16) + (bytes[5] << 8) + bytes[6]) * 100 : null;
    const hdr = fine ? 7 : 1;
    const VW = ftB ? viewB() : { lo: WF_LO, span: WF_MAX_HZ }; // plage affichée par cette cascade
    const n = Math.min(bytes.length - hdr, Math.ceil((VW.lo + VW.span) / df));
    let vals = bytes.subarray(hdr, hdr + n);
    if (tab === 'cw' && !isB) { if (cwDf !== df) cwRows.length = 0; cwDf = df; cwRows.push(Uint8Array.from(vals)); if (cwRows.length > 12) cwRows.shift(); }
    if (tab === 'cw' && ftB) { if (cwDfB !== df) cwRowsB.length = 0; cwDfB = df; cwRowsB.push(Uint8Array.from(vals)); if (cwRowsB.length > 12) cwRowsB.shift(); }
    // Vitesse (comme « Spd » de JTDX) : 1, 2 ou 3 lignes reçues fondues en une (moyenne des puissances) ;
    // plus lent = signaux plus ramassés, plus d'historique à l'écran
    const ownB = ftB || (isB && tab === 'rtty' && rtDualAudio); // cascade du VFO-B (voie droite) : ses propres réglages
    const C = ownB ? wfCfgB : wfCfg, CP = ownB ? PALB : PAL; // réglages de la cascade dessinée
    const spd = C.spd;
    if (spd > 1) {
      if (!T.acc || T.acc.length !== n) { T.acc = new Float32Array(n); T.accN = 0; }
      const acc = T.acc;
      for (let k = 0; k < n; k++) acc[k] += Math.pow(10, vals[k] / 20);
      if (++T.accN < spd) return;
      const m = new Uint8Array(n);
      for (let k = 0; k < n; k++) { const v = Math.round(20 * Math.log10(acc[k] / T.accN)); m[k] = v < 0 ? 0 : v > 255 ? 255 : v; acc[k] = 0; }
      T.accN = 0;
      vals = m;
    }
    // Plancher de bruit : médiane de la ligne, lissée
    const sorted = Array.from(vals).sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    T.floor = T.floor == null ? med : T.floor * 0.9 + med * 0.1;
    // Fond aplati : niveau moyen du bruit de chaque case (les signaux, 6 dB au-dessus, ne le relèvent presque pas),
    // lissé sur ± 4 cases (± 25 Hz) pour ne pas créer de stries verticales
    if (!T.binFloor || T.binFloor.length !== n) { T.binFloor = new Float32Array(n).fill(med); T.sb = new Float32Array(n); T.fr = 0; T.floor = med; }
    const binFloor = T.binFloor, floor = T.floor;
    // Premières secondes (ou retour après une coupure) : on s'adapte vite ; ensuite lentement, sans suivre les signaux
    const fast = ++T.fr < 40;
    const lo = floor - 10; // jamais plus de 5 dB sous le bruit médian (sinon tout le fond vire au jaune)
    for (let k = 0; k < n; k++) {
      const b = binFloor[k];
      let nb = fast ? b * 0.8 + Math.min(vals[k], med + 6) * 0.2 : vals[k] > b + 12 ? b + 0.05 : b * 0.97 + vals[k] * 0.03;
      binFloor[k] = nb < lo ? lo : nb;
    }
    const sb = T.sb;
    const hw = Math.max(1, Math.round(25 / df)); // ± 25 Hz
    for (let k = 0, acc = 0, cnt = 0; k < n; k++) {
      acc = 0; cnt = 0;
      for (let j = Math.max(0, k - hw); j <= Math.min(n - 1, k + hw); j++) { acc += binFloor[j]; cnt++; }
      sb[k] = acc / cnt;
    }
    const ctx = T.ctx;
    ctx.drawImage(ctx.canvas, 0, 0, T.w, T.h - 1, 0, 1, T.w, T.h - 1); // la cascade descend d'une ligne
    if (!T.img || T.img.width !== T.w) T.img = ctx.createImageData(T.w, 1);
    const d = T.img.data;
    // Gain : plage de couleurs de 50 dB (−20) à 12,5 dB (+20), 25 dB au milieu ; zéro : fond ± 10 dB
    // Cascade fine moyennée (0x13) : bruit plus régulier, donc plage plus serrée (16 dB) et fond un peu relevé (bleu)
    const range = 2 * (fine ? 16 : 25) / Math.pow(2, C.gain / 10); // en octets (2 par dB)
    const off = C.zero + (fine ? 8 : 3);                             // octets
    const flatLvl = floor + 0; // fond aplati ramené au plancher moyen
    const nHz = VW.span / df; // cases sur la largeur affichée
    const k0f = VW.lo / df;     // première case affichée (zoom RTTY / FT)
    // Spectre sous la cascade (VFO-A, et VFO-B en double réception) : niveau de chaque colonne, lissé dans le temps
    // Vitesse du spectre (X1, X2, X4) : constante de temps de la moyenne (6 s, 2 s, 0,3 s), quel que soit le rythme des lignes
    const tNow = performance.now(), dtS = T.spT ? Math.min(3, (tNow - T.spT) / 1000) : 0.2;
    T.spT = tNow;
    const spA = 1 - Math.exp(-dtS / (SP_TAU[spSpd] || 6));
    const SP = (T === wf || T === wfFB) && T.sp && T.sp.w ? T.sp : null;
    if (SP && (!SP.v || SP.v.length !== SP.w)) SP.v = new Float32Array(SP.w);
    for (let x = 0; x < T.w; x++) {
      // Interpolation entre deux cases (pas d'escalier quand la cascade est plus large que le nombre de cases)
      const fx = Math.max(0, Math.min(n - 1, k0f + (x + 0.5) / T.w * nHz - 0.5));
      const k0 = Math.floor(fx);
      const k1 = Math.min(n - 1, k0 + 1);
      const u = fx - k0;
      let v = vals[k0] * (1 - u) + vals[k1] * u;
      const base = C.flat ? sb[k0] * (1 - u) + sb[k1] * u : floor;
      if (C.flat) v = v - base + flatLvl;
      let i = Math.round(((v - floor + off) / range) * 255);
      i = i < 0 ? 0 : i > 255 ? 255 : i;
      if (SP) { const xs = Math.min(SP.w - 1, Math.floor(x * SP.w / T.w)); SP.v[xs] = SP.v[xs] * (1 - spA) + i * spA; }
      d[x * 4] = CP[i * 3];
      d[x * 4 + 1] = CP[i * 3 + 1];
      d[x * 4 + 2] = CP[i * 3 + 2];
      d[x * 4 + 3] = 255;
    }
    ctx.putImageData(T.img, 0, 0);
    if (SP) drawSpec(T);
    if (ftB && tday != null) {
      // Trait de début de période, comme sur la cascade du VFO-A
      const P = tab === 'wspr' ? 120000 : tab === 'jtty' || tab === 'cw' ? 0 : SLOT_MS[mode] || 15000;
      const per = P ? Math.floor(tday / P) : 0;
      if (P && wfFB.per != null && per !== wfFB.per) { ctx.fillStyle = 'rgba(255, 255, 255, .55)'; ctx.fillRect(0, 0, wfFB.w, 1); }
      wfFB.per = per;
    }
    if (isB) return;
    periodMark(ctx, tday);
    // RTTY : la même ligne descend aussi dans la cascade du décodeur B (sauf si elle a sa propre voie, 0x14)
    if (tab === 'rtty' && wfB.ctx && !rtDualAudio) {
      const b = wfB.ctx;
      b.drawImage(b.canvas, 0, 0, wfB.w, wfB.h - 1, 0, 1, wfB.w, wfB.h - 1);
      b.drawImage(ctx.canvas, 0, 0, wf.w, 1, 0, 0, wfB.w, 1);
    }
  }
  // Repères de période (comme JTDX) : trait à chaque début de période FT8 / FT4 / FT2 / JT65, puis heure UTC et bande
  // écrites juste au-dessus du trait, dans la nouvelle période, une fois qu'elle a assez défilé
  const wfMark = { per: null, label: null, rows: 0 };
  const BANDS_M = [[1.8, 2, '160m'], [3.5, 4, '80m'], [5.06, 5.45, '60m'], [7, 7.3, '40m'], [10.1, 10.15, '30m'], [14, 14.35, '20m'], [18.06, 18.17, '17m'],
    [21, 21.45, '15m'], [24.89, 24.99, '12m'], [28, 29.7, '10m'], [50, 54, '6m'], [70, 71, '4m'], [144, 148, '2m'], [420, 450, '70cm'], [1240, 1300, '23cm']];
  function periodMark(ctx, tday) {
    if (tday == null || (tab !== 'ftx' && tab !== 'jt65')) { wfMark.per = null; wfMark.label = null; return; }
    const P = { FT8: 15000, FT4: 7500, FT2: 3750, JT65: 60000 }[tab === 'jt65' ? 'JT65' : mode] || 15000;
    const per = Math.floor(tday / P);
    if (wfMark.per != null && per !== wfMark.per) {
      ctx.fillStyle = 'rgba(255, 255, 255, .55)';
      ctx.fillRect(0, 0, wf.w, 1);
      const t = per * P;
      const pad2 = (v) => String(v).padStart(2, '0');
      const st = api && api.state && api.state();
      const f = st && st.radio && (st.radio.vfoSel === 1 ? st.radio.freqB : st.radio.freq);
      const mhz = f ? f / 1e6 : 0;
      const b = BANDS_M.find((x) => mhz >= x[0] && mhz <= x[1]);
      wfMark.label = pad2(Math.floor(t / 3600000) % 24) + ':' + pad2(Math.floor(t / 60000) % 60) + ':' + pad2(Math.floor(t / 1000) % 60) + (b ? '   ' + b[2] : '');
      wfMark.rows = 0;
    }
    wfMark.per = per;
    const r = wf.dpr || 1;
    if (wfMark.label != null && ++wfMark.rows === Math.round(13 * r)) {
      ctx.font = 'bold ' + Math.round(10 * r) + 'px Verdana, "DejaVu Sans", Arial, sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = 3 * r;
      ctx.strokeStyle = 'rgba(0, 0, 0, .75)';
      ctx.strokeText(wfMark.label, 6 * r, 11 * r);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(wfMark.label, 6 * r, 11 * r);
      wfMark.label = null;
    }
  }
  function drawScale() {
    const c = wf.sctx;
    if (!c) return;
    const w = wf.cw;
    // Repères partagés avec les autres onglets : ce que l'onglet FT a masqué ou pâli (zoom, VFO-B qui émet) est remis
    if (tab !== 'ftx') for (const id of ['dgMkRx', 'dgMkTx']) if ($(id)) { $(id).style.display = ''; $(id).classList.remove('mk-off'); }
    // Cascade du VFO-B (double réception) : son échelle ; repères RX / TX en FT8 / FT4 / FT2, JT65 et JTTY seulement
    const flagsB = tab === 'ftx' || tab === 'jt65' || tab === 'jtty';
    if (ftDual && wfFB.sctx && !flagsB) {
      ticks(wfFB.sctx, wfFB.cw, viewB());
      for (const id of ['ftMkRxB', 'ftMkTxB']) if ($(id)) $(id).style.display = 'none';
    }
    ticks(c, w);
    for (const id of ['dgMkN', 'ftMkNB']) if ($(id)) $(id).hidden = true; // NOTCH : seulement FT8 / FT4 / FT2, JT65, JTTY
    if (tab === 'rtty') return drawRttyMarks(c, w);
    if (tab === 'wspr') return drawWsprMarks(c, w);
    if (tab !== 'cw') for (const id of ['cwTrxA', 'cwTrxB']) if ($(id)) $(id).hidden = true;
    if (tab === 'cw') { drawCwMarks(c, w); if (ftDual && wfFB.sctx) drawCwMarks(wfFB.sctx, wfFB.cw, 'B'); else if ($('cwTrxB')) $('cwTrxB').hidden = true; return; }
    if (tab === 'sstv') return drawSstvMarks(c, w);
    drawFlags(c, w);
    if (ftDual && wfFB.sctx && flagsB) {
      for (const id of ['ftMkRxB', 'ftMkTxB']) if ($(id)) $(id).style.display = '';
      ticks(wfFB.sctx, wfFB.cw, viewB());
      drawFlags(wfFB.sctx, wfFB.cw, 'B');
    }
  }
  // Échelle de 0 à 3000 Hz (graduations façon JTDX)
  function ticks(c, w, V) {
    const LO = V ? V.lo : WF_LO, SP = V ? V.span : WF_MAX_HZ;
    const H = SCALE_H;
    c.clearRect(0, 0, w, H);
    c.fillStyle = '#0b1018';
    c.fillRect(0, 0, w, H);
    c.font = 'bold 11px Verdana, "DejaVu Sans", Arial, sans-serif'; // graduations 500, 1000… en blanc gras
    c.textBaseline = 'top';
    // Graduations fines façon JTDX : ligne de base, petit trait tous les 50 Hz, moyen tous les 100 Hz, grand tous les 500 Hz
    c.strokeStyle = '#46546a';
    c.beginPath(); c.moveTo(0, 13.5); c.lineTo(w, 13.5); c.stroke();
    const step = w / SP >= 1 ? 10 : w / SP >= 0.25 ? 50 : 100;
    for (let f = Math.ceil(LO / step) * step; f <= LO + SP; f += step) {
      const x = Math.round(((f - LO) / SP) * (w - 1)) + 0.5;
      const big = f % 500 === 0;
      const mid = f % 100 === 0;
      c.strokeStyle = big ? '#8a9bb0' : mid ? '#5d6c80' : '#3c4859';
      c.beginPath();
      c.moveTo(x, big ? 11 : 14);
      c.lineTo(x, big ? H : mid ? 20 : 17);
      c.stroke();
      if ((big || (SP <= 1000 && mid)) && f > LO && f < LO + SP) {
        c.fillStyle = '#F0F5FA';
        c.fillText(String(f), x - c.measureText(String(f)).width / 2, 0);
      }
    }
  }
  // NOTCH manuel du TRX pour un VFO : Yaesu = fréquence BF (BP01 / BP11), Icom = position 0–255 (≈ 300 à 2700 Hz)
  function notchHz(side) {
    const r = (api && api.state && api.state() && api.state().radio) || {};
    const S = side === 'B' ? 'B' : '';
    if (!Number(r['notch' + S])) return null;
    const nf = r['notchFreq' + S], np = r['notchPos' + S];
    return nf != null ? Number(nf) : np != null ? 300 + Number(np) / 255 * 2400 : null;
  }
  let notchSeen = '';
  function drawFlags(c, w, side) {
    const B = side === 'B';
    const tf = B ? txFB : txF, rf = B ? rxFB : rxF;
    const txOn = !ftDual || sd() === (B ? 'B' : 'A'); // double réception : drapeau TX pâle sur le VFO qui n'émet pas
    const VV = ftV(side); // plage affichée (zoom)
    // Largeur d'un signal FT8 (50 Hz) / FT4 (83 Hz) / JT65 (178 Hz) / JTTY (127 Hz, centré) : TX en rouge, RX en vert
    const bw = tab === 'jtty' ? 127 : mode === 'FT4' ? 83 : mode === 'FT2' ? 167 : mode === 'JT65' ? 178 : 50;
    // Drapeaux TX (rouge) et RX (vert) avec leur fréquence ; hampe à la fréquence exacte, drapeau retourné près du bord droit
    c.font = 'bold 11px Verdana, "DejaVu Sans", Arial, sans-serif';
    c.textBaseline = 'middle';
    const flag = (f, y, h, fill, pole, label) => {
      const x0 = ((f - VV.lo) / VV.span) * w;
      const sw = Math.max(3, (bw / VV.span) * w);
      const fw = Math.max(sw, c.measureText(label).width + 12);
      // Hampe toujours à gauche de l'étiquette, sur la fréquence (comme le trait de la cascade)
      c.fillStyle = fill;
      c.fillRect(x0, y, Math.min(fw, w - x0), h);
      c.fillStyle = pole;
      c.fillRect(x0, y, 3, h);
      c.fillStyle = '#FFFFFF';
      c.fillText(label, Math.min(x0 + 7, w - fw + 7), y + h / 2 + 1);
    };
    // VFO qui n'émet pas : drapeau TX en bleu (comme le bouton VFO-B / SUB) au lieu du rouge
    flag(tf, 14, 14, txOn ? 'rgba(190, 28, 28, .92)' : 'rgba(36, 86, 184, .92)', txOn ? '#ff7a6a' : '#7fb2ff', 'TX ' + Math.round(tf));
    flag(rf, 29, 15, 'rgba(0, 140, 66, .92)', '#7CF29F', 'RX ' + Math.round(rf));
    // Repères sur la cascade
    const pos = (el, f) => { el.style.left = ((f - VV.lo) / VV.span) * 100 + '%'; el.style.width = (bw / VV.span) * 100 + '%'; el.style.display = f + bw < VV.lo || f > VV.lo + VV.span ? 'none' : ''; };
    pos($(B ? 'ftMkRxB' : 'dgMkRx'), rf);
    pos($(B ? 'ftMkTxB' : 'dgMkTx'), tf);
    // NOTCH du TRX en service : trait orange sur la cascade (et petit drapeau « NOTCH » sur l'échelle), pour chaque VFO
    const nz = notchHz(side), mn = $(B ? 'ftMkNB' : 'dgMkN');
    if (mn) {
      const vis = nz != null && nz >= VV.lo && nz <= VV.lo + VV.span;
      mn.hidden = !vis;
      if (vis) {
        mn.style.left = ((nz - VV.lo) / VV.span) * 100 + '%';
        mn.dataset.l = 'NOTCH ' + Math.round(nz);
        mn.title = 'NOTCH du TRX (VFO ' + (B ? 'B' : 'A') + ') à ' + Math.round(nz) + ' Hz : les signaux à cette fréquence sont coupés';
      }
    }
    $(B ? 'ftMkTxB' : 'dgMkTx').classList.toggle('mk-off', !txOn);
    if (B) { $('dgRxFB').textContent = Math.round(rf) + ' Hz'; if ($('jtRxFB2')) $('jtRxFB2').textContent = Math.round(rf) + ' Hz'; return; }
    $('dgRxF').textContent = Math.round(rxF) + ' Hz';
    // Barre du haut : fréquences du VFO d'émission choisi
    $('dgRxF2').textContent = Math.round(sd() === 'B' ? rxFB : rxF);
    $('dgTxF').textContent = Math.round(sd() === 'B' ? txFB : txF);
    if ($('jtRxF')) { $('jtRxF').textContent = Math.round(sd() === 'B' ? rxFB : rxF); $('jtTxF').textContent = Math.round(sd() === 'B' ? txFB : txF); $('jtRxF2').textContent = Math.round(rxF) + ' Hz'; }
  }
  // ------------------------------------------------------------------ RTTY
  const RTTY_DIAL = [['80 m', 3590], ['40 m', 7040], ['30 m', 10142], ['20 m', 14085], ['17 m', 18101], ['15 m', 21085], ['12 m', 24910], ['10 m', 28085]];
  // Deux décodeurs RTTY indépendants : rts[0] = A (VFO-A, à gauche), rts[1] = B (VFO-B, à droite)
  const rtLoad = (key, f0) => {
    let o = {};
    try { o = JSON.parse(store.get(key, '{}')) || {}; } catch (e) { o = {}; }
    return { f: Number(o.f) || f0, shift: [170, 200, 425, 850].indexOf(o.shift) >= 0 ? o.shift : 170,
      baud: [45.45, 50, 75, 100].indexOf(o.baud) >= 0 ? o.baud : 45.45, rev: !!o.rev,
      // Silencieux 9 dB : signaux plus faibles décodés (≈ −6 dB dans 3 kHz) au prix de quelques caractères sur le bruit ;
      // l'ancien réglage par défaut (12) passe à 9 une fois
      squelch: !o.squelch || (Number(o.squelch) === 12 && store.get('rtsq9', '') !== '1') ? 9 : Number(o.squelch) };
  };
  const rts = [rtLoad('rtty', 1500), rtLoad('rttyb', 2100)];
  store.set('rtsq9', '1');
  const rt = rts[0];
  const RT_SFX = ['', 'B'];
  let rtTx = store.get('rttx', '0') === '1' ? 1 : 0; // décodeur dont les réglages servent à l'émission
  let rtDialKey = '';
  // ------------------------------------------------------------------ macros (comme FLDIGI : F1 à F12, modifiables)
  // <TX> en tête : la macro part tout de suite à l'émission (comme FLDIGI) ; <RX> : retour en réception (toujours fait en fin de message)
  // Balises : <MYCALL> <CALL> <NAME> <QTH> <RST> <LOC> <MYLOC> <MYQTH> <OPCALL> <CNTR> <INCR> <ZT> <ZD>
  const DEF_MACROS = {
    RTTY: [
      { name: 'CQ', text: '<TX>CQ CQ CQ DE <MYCALL> <MYCALL> <MYCALL>\nCQ CQ CQ DE <MYCALL> <MYCALL> <MYCALL> PSE K\n<RX>' },
      { name: 'Appel', text: '<TX><CALL> <CALL> DE <MYCALL> <MYCALL> <MYCALL> K\n<RX>' },
      { name: 'QSO', text: '<TX><CALL> DE <MYCALL> TNX FER CALL <NAME>\nUR RST <RST> <RST> QTH <MYQTH> <MYQTH> LOC <MYLOC>\nHW? <CALL> DE <MYCALL> K\n<RX>' },
      { name: 'Station', text: '<TX>STATION DU CLUB UBA-LGE <MYCALL> - OPERATEUR <OPCALL>\n<RX>' },
      { name: 'BTU', text: '<TX>BTU <CALL> DE <MYCALL> K\n<RX>' },
      { name: '73', text: '<TX><CALL> TNX FER QSO <NAME> 73 GL\n<CALL> DE <MYCALL> SK\n<RX>' },
      { name: 'QRZ?', text: '<TX>QRZ? DE <MYCALL> K\n<RX>' },
      { name: 'Contest', text: '<TX><CALL> 599 <CNTR> <CNTR>\n<RX>' },
      { name: 'TU', text: '<TX>TU <INCR><MYCALL> TEST\n<RX>' },
      { name: 'AGN?', text: '<TX>AGN? AGN? PSE\n<RX>' },
      // F11 / F12 : passer en émission avec le texte tapé dans la zone d'écriture, puis repasser en réception (comme FLDIGI)
      { name: 'TX', text: '<TX>' },
      { name: 'RX', text: '<RX>' }
    ],
    // JTTY : les 8 touches de fonction de WSJT-X (forme compacte : 1 ou 2 trames par message)
    JTTY: [
      { name: 'CQ', text: '<TX>CQ <MYCALL> CQ<RX>' },
      { name: 'Échange', text: '<TX><CALL> 599 <CNTR><RX>' },
      { name: 'TU', text: '<TX><CALL> TU CQ <MYCALL> CQ<RX>' },
      { name: 'Mon ind.', text: '<TX><MYCALL><RX>' },
      { name: 'Son ind.', text: '<TX><CALL><RX>' },
      { name: 'TU NOW', text: '<TX>TU NOW <CALL> 599 <CNTR><RX>' },
      { name: 'AGN?', text: '<TX><CALL> AGN?<RX>' },
      { name: '599', text: '<TX>599 <CNTR><RX>' }
    ],
    CW: [
      { name: 'CQ', text: '<TX>CQ CQ CQ DE <MYCALL> <MYCALL> <MYCALL> K' },
      { name: 'Appel', text: '<TX><CALL> DE <MYCALL> <MYCALL> K' },
      { name: 'Report', text: '<TX><CALL> TU UR 5NN 5NN BK' },
      { name: 'R TU', text: '<TX>R TU 73 <CALL> DE <MYCALL> SK' },
      { name: '73', text: '<TX><CALL> TNX FER QSO 73 DE <MYCALL> SK' },
      { name: 'QRZ?', text: '<TX>QRZ? DE <MYCALL> K' },
      { name: 'AGN?', text: '<TX>AGN? AGN?' }
    ]
  };
  // Contests RTTY : la liste de N1MM Logger+ (« Setup Digital, RTTY, and PSK Contests », contests RTTY encore organisés)
  // [identifiant (Cabrillo, sinon code N1MM), nom, échange envoyé par une station DX] ; l'échange reste modifiable
  // (NOM, 00, 0000 : à compléter — prénom, âge, année de la 1re licence…)
  const RT_CONTESTS = [
    ['', 'Pas de contest', ''],
    ['ANATOLRTTY', 'Anatolian RTTY', '599 <CNTR>'],
    ['RRRTTY', 'ARRL Rookie Roundup RTTY', '<MYNAME> 00 DX'],
    ['ARRL-RTTY', 'ARRL RTTY Roundup', '599 <CNTR>'],
    ['BARTG-RTTY', 'BARTG Spring RTTY (HF)', '599 <CNTR> <ZT>'],
    ['BARTG-SPRINT', 'BARTG RTTY Sprint', '599 <CNTR>'],
    ['BAR75RTTYS', 'BARTG Sprint75 RTTY', '599 <CNTR>'],
    ['CISDXRTTY', 'CIS DX RTTY', '599 <CNTR>'],
    ['CQ-WW-RTTY', 'CQ WW DX RTTY', '599 <CQZ>'],
    ['CQ-WPX-RTTY', 'CQ WPX RTTY', '599 <CNTR>'],
    ['DLDXRTTY', 'DL DX RTTY', '599 <CNTR>'],
    ['DMCRTTY', 'DMC RTTY', '599 <CNTR>'],
    ['DRCGWWRTTY', 'DRCG WW Long Distance RTTY', '599 <CQZ>'],
    ['EA-RTTY', 'EA RTTY', '599 <CNTR>'],
    ['JARLWWRTY', 'JARTS WW RTTY (âge)', '599 00'],
    ['JTDXRTTY', 'JT DX RTTY', '599 <CQZ>'],
    ['LOTWRTTY', 'LoTW Contest RTTY / Digital', '599 ON'],
    ['MAKRORTTY', 'Makrothen RTTY', '<MYLOC4>'],
    ['SPRINTRTTY', 'NA Sprint RTTY', '<CNTR> <MYNAME> DX'],
    ['NAQPRTTY', 'NAQP RTTY', '<MYNAME>'],
    ['OKDXRTTY', 'OK DX RTTY', '599 <CQZ>'],
    ['RFCDIGI', 'Russian Federation Digital (SRR DIGI CUP)', '599 <CNTR> <MYLOC4>'],
    ['RUS-WW-DIG', 'Russian WW Digi', '599 <CNTR>'],
    ['RUS-WW-MM', 'Russian WW MM', '599 <CNTR>'],
    ['RUSDXRTTY', 'Russian DX RTTY', '599 <CNTR>'],
    ['SARTGNYRTY', 'SARTG New Year RTTY', '599 <CNTR> <MYNAME>'],
    ['SARTG-RTTY', 'SARTG WW RTTY', '599 <CNTR>'],
    ['SCCRTTY', 'SCC RTTY Championship (année 1re licence)', '599 0000'],
    ['SP-DX-RTTY', 'SP DX RTTY', '599 <CNTR>'],
    ['TARAGRID', 'TARA Grid Dip', '<MYNAME> <MYLOC4>'],
    ['TARARTTY', 'TARA RTTY Melee', '599 <CNTR>'],
    ['SKIRMRTTY', 'TARA Skirmish', '<MYNAME> ON'],
    ['UKRAINDX', 'Ukrainian DX Classic RTTY', '599 <CNTR>'],
    ['UKRAINDIGI', 'Ukrainian DX DIGI', '599 <CNTR>'],
    ['UKRRTTYOPEN', 'Ukrainian Open RTTY', '599 <CNTR>'],
    ['UKRAINRTTY', 'Ukrainian RTTY', '599 <CNTR>'],
    ['UKDXRTTY', 'UK DX RTTY', '599 <CNTR>'],
    ['VOLTA-RTTY', 'Volta RTTY', '599 <CNTR> <CQZ>'],
    ['DARC-WAEDC-RTTY', 'WAEDC RTTY (DARC)', '599 <CNTR>'],
    ['XERTTY', 'XE RTTY', '599 <CNTR>'],
    ['RTTY-OTHER', 'Autre contest (échange libre)', '599 <CNTR>']
  ];
  const rtcId = () => store.get('rtc', '');
  const rtcOn = () => !!rtcId();
  const rtcExch = () => { const id = rtcId(); const c = RT_CONTESTS.find((x) => x[0] === id); return store.get('rtcx_' + id, c ? c[2] : '599 <CNTR>'); };
  // Contests CW (page TRX CW) : [identifiant Cabrillo, nom, échange envoyé par une station belge] ; l'échange reste
  // modifiable (00 = à compléter : âge, année de licence… ; LG = province pour l'UBA DX, LGE = section pour l'ON Contest)
  const CW_CONTESTS = [
    ['CQ-WW-CW', 'CQ World Wide DX CW', '5NN <CQZ>'],
    ['CQ-WPX-CW', 'CQ WPX CW', '5NN <CNTR>'],
    ['CQ-160-CW', 'CQ WW 160 m CW', '5NN <CQZ>'],
    ['ARRL-DX-CW', 'ARRL International DX CW', '5NN 100'],
    ['ARRL-10', 'ARRL 10 m (CW)', '5NN <CNTR>'],
    ['IARU-HF', 'IARU HF World Championship', '5NN <ITUZ>'],
    ['DARC-WAEDC-CW', 'WAE DX CW (DARC)', '5NN <CNTR>'],
    ['UBA-DX-CW', 'UBA DX Contest CW', '5NN <CNTR> LGE'],
    ['ON-CONTEST', 'UBA ON Contest CW (80 m)', '5NN <CNTR> LGE'],
    ['EU-HF', 'EU HF Championship', '5NN 00'],
    ['OK-OM-DX', 'OK/OM DX Contest CW', '5NN <CNTR>'],
    ['RDXC', 'Russian DX Contest', '5NN <CNTR>'],
    ['SPDX', 'SP DX Contest', '5NN <CNTR>'],
    ['HA-DX', 'HA DX Contest', '5NN <CNTR>'],
    ['YODX', 'YO DX HF Contest', '5NN <CNTR>'],
    ['LZ-DX', 'LZ DX Contest', '5NN <ITUZ>'],
    ['EA-CW', 'S.M. El Rey de España CW', '5NN <CNTR>'],
    ['HELVETIA', 'Helvetia Contest', '5NN <CNTR>'],
    ['PACC', 'PACC (Pays-Bas)', '5NN <CNTR>'],
    ['WAG', 'Worked All Germany', '5NN <CNTR>'],
    ['AADX-CW', 'All Asian DX CW', '5NN 00'],
    ['JIDX-CW', 'JIDX CW', '5NN <CQZ>'],
    ['CWOPS-CWT', 'CWops CWT (non-membre)', '<MYNAME> ON'],
    ['CW-OTHER', 'Autre contest (échange libre)', '5NN <CNTR>']
  ];
  const cwcId = () => store.get('cwc', '');
  const cwcOn = () => !!cwcId();
  const cwcExch = () => { const id = cwcId(); const c = CW_CONTESTS.find((x) => x[0] === id); return store.get('cwcx_' + id, c ? c[2] : '5NN <CNTR>'); };
  let macroCtx = ''; // macro en cours de préparation : 'CW' → échange du contest CW (sinon celui du contest RTTY)
  const cwText = (t, apply) => { macroCtx = 'CW'; try { return macroText(t, apply); } finally { macroCtx = ''; } };
  DEF_MACROS.CWC = [
    { name: 'CQ', text: '<TX>CQ TEST <MYCALL> <MYCALL> TEST' },
    { name: 'Échange', text: '<TX><CALL> <EXCH>' },
    { name: 'TU', text: '<TX>TU <INCR><MYCALL>' },
    { name: 'Mon ind.', text: '<TX><MYCALL>' },
    { name: 'Son ind.', text: '<TX><CALL>' },
    { name: 'Réponse', text: '<TX>TU <EXCH>' },
    { name: 'AGN?', text: '<TX>AGN?' },
    { name: 'NR?', text: '<TX>NR?' },
    { name: '?', text: '<TX>?' },
    { name: 'QRZ?', text: '<TX>QRZ? <MYCALL>' },
    { name: 'R', text: '<TX>R' },
    { name: 'Log', text: '<LOG>' }
  ];
  DEF_MACROS.RTTYC = [
    { name: 'CQ', text: '<TX>CQ TEST <MYCALL> <MYCALL> CQ\n<RX>' },
    { name: 'Échange', text: '<TX><CALL> <EXCH> <EXCH> <CALL>\n<RX>' },
    { name: 'TU', text: '<TX>TU <INCR><MYCALL> TEST\n<RX>' },
    { name: 'Mon ind.', text: '<TX><MYCALL> <MYCALL>\n<RX>' },
    { name: 'Réponse', text: '<TX><CALL> TU <EXCH> <EXCH>\n<RX>' },
    { name: 'Son ind.', text: '<TX><CALL> <CALL>\n<RX>' },
    { name: 'AGN?', text: '<TX>AGN? AGN?\n<RX>' },
    { name: 'NR?', text: '<TX>NR? NR?\n<RX>' },
    { name: 'QRZ?', text: '<TX>QRZ? <MYCALL>\n<RX>' },
    { name: 'Merci', text: '<TX>TU 73 <MYCALL>\n<RX>' },
    { name: 'Log', text: '<LOG>' },
    { name: 'RYRY', text: '<TX>RYRYRYRYRYRY\n<RX>' }
  ];
  // Balises des macros (champs standardisés de FLDIGI, et celles propres à la station), par groupe ; « #… » = titre de groupe
  const TAGS = [
    ['#Émission', ''],
    ['<TX>', 'émission immédiate au clic (sinon : texte ajouté à la zone d’écriture)'], ['<RX>', 'retour en réception à la fin (toujours fait)'],
    ['<LOG>', 'ouvre la fiche du QSO pour l’enregistrer dans le carnet'], ['<CLRLOG>', 'efface le correspondant (nouveau QSO)'],
    ['#Station', ''],
    ['<MYCALL>', 'indicatif émis (TX call)'], ['<OPCALL>', 'votre indicatif (opérateur)'], ['<MYNAME>', 'votre prénom (champ Prénom de la ligne Contest)'],
    ['<MYLOC>', 'locator de la station'], ['<MYLOC4>', 'locator de la station, 4 caractères'], ['<MYQTH>', 'QTH de la station'],
    ['<MYRST>', 'report reçu (RST qu’il nous donne)'], ['<VER>', 'nom et version du logiciel'],
    ['#Correspondant', ''],
    ['<CALL>', 'son indicatif'], ['<NAME>', 'son prénom'], ['<QTH>', 'son QTH'], ['<LOC>', 'son locator'], ['<RST>', 'report envoyé'],
    ['#Trafic', ''],
    ['<FREQ>', 'fréquence du VFO d’émission (MHz)'], ['<BAND>', 'bande'], ['<MODE>', 'mode (RTTY, CW…)'], ['<QSOTIME>', 'heure UTC du début du QSO'],
    ['#Heure et date', ''],
    ['<ZT>', 'heure UTC (HHMM)'], ['<ZD>', 'date UTC (AAAAMMJJ)'], ['<ZDT>', 'date et heure UTC'], ['<IZDT>', 'date et heure UTC (ISO)'],
    ['<LT>', 'heure locale (HHMM)'], ['<LD>', 'date locale'], ['<LDT>', 'date et heure locales'], ['<ILDT>', 'date et heure locales (ISO)'],
    ['#Contest', ''],
    ['<CNTR>', 'numéro de série (3 chiffres)'], ['<SERNO>', 'numéro de série (comme <CNTR>)'], ['<LSTNO>', 'numéro précédent'],
    ['<INCR>', 'passe au numéro suivant (une fois par correspondant)'], ['<DECR>', 'revient au numéro précédent'],
    ['<EXCH>', 'échange du contest choisi (RTTY)'], ['<XOUT>', 'échange envoyé (comme <EXCH>)'], ['<CQZ>', 'zone CQ de la station'], ['<ITUZ>', 'zone ITU de la station']
  ];
  let macros = (() => { try { return JSON.parse(store.get('macros', '{}')) || {}; } catch (e) { return {}; } })();
  const macroList = (mode) => (macros[mode] && macros[mode].length ? macros[mode] : DEF_MACROS[mode] || []);
  function saveRtty(reannounce) {
    store.set('rtty', JSON.stringify(rts[0]));
    store.set('rttyb', JSON.stringify(rts[1]));
    if (reannounce) announce();
    sendView();
  }
  // Repères Mark (jaune) / Space (bleu) d'un décodeur sur son échelle et sa cascade
  function rttyMarks(c, w, r, mkM, mkS, cols, letter) {
    // Couleurs foncées et saturées : restent visibles sur un écran très lumineux
    const C = cols || ['rgba(230, 170, 0, .6)', '#E0A800', 'rgba(0, 102, 255, .55)', '#0066FF'];
    const half = r.shift / 2;
    const fm = r.rev ? r.f - half : r.f + half;
    const fs = r.rev ? r.f + half : r.f - half;
    const bw = Math.max(20, r.baud);
    const bar = (f, y, h, fill, edge) => {
      const x0 = ((f - bw / 2 - WF_LO) / WF_MAX_HZ) * w;
      c.fillStyle = fill;
      c.fillRect(x0, y, Math.max(2, (bw / WF_MAX_HZ) * w), h);
      c.fillStyle = edge;
      c.fillRect(((f - WF_LO) / WF_MAX_HZ) * w - 1, y, 2, h);
    };
    bar(fm, 14, 16, C[0], C[1]);
    bar(fs, 14, 16, C[2], C[3]);
    if (letter) {
      // Lettre du décodeur au-dessus de ses repères
      // Lettre du décodeur, grande, sur une pastille de sa couleur (lisible même sur un écran très lumineux)
      c.font = 'bold 14px Verdana, "DejaVu Sans", Arial, sans-serif';
      c.textBaseline = 'middle';
      const lx = ((Math.max(fm, fs) + bw / 2 - WF_LO) / WF_MAX_HZ) * w + 4;
      const tw = c.measureText(letter).width;
      c.fillStyle = C[1];
      c.fillRect(lx - 3, 29, tw + 6, 15);
      c.fillStyle = '#000000';
      c.fillText(letter, lx, 37);
    }
    const pos = (el, f) => { if (!el) return; el.style.left = ((f - bw / 2 - WF_LO) / WF_MAX_HZ) * 100 + '%'; el.style.width = (bw / WF_MAX_HZ) * 100 + '%'; };
    pos(mkM, fm);
    pos(mkS, fs);
  }
  const RT_COLS_B = ['rgba(170, 51, 255, .6)', '#AA33FF', 'rgba(0, 160, 60, .55)', '#00A03C'];
  function drawRttyMarks(c, w) {
    rtKhz(c, w, rtDialOf(0));
    rttyMarks(c, w, rts[0], $('dgMkRx'), $('dgMkTx'), null, 'A');
    // Décodeur B : sur la même cascade, repères magenta (Mark) / vert (Space) — sauf s'il a sa propre cascade
    if (!(wfB.sctx && $('rtWfB').clientWidth)) rttyMarks(c, w, rts[1], $('dgMkBM'), $('dgMkBS'), RT_COLS_B, 'B');
    // Cascade du décodeur B : même spectre (même BF du TRX), ses propres repères
    if (wfB.sctx) {
      rtKhz(wfB.sctx, wfB.cw, rtDialOf(1));
      rttyMarks(wfB.sctx, wfB.cw, rts[1], $('rtMkMB'), $('rtMkSB'), RT_COLS_B, 'B');
    }
    rtHeads();
  }
  // Fréquence porteuse (VFO) de chaque décodeur RTTY : le VFO reçu ; en double réception (FTX-1), B = VFO-B
  // sign : +1 en USB / DATA-U (fréquence = porteuse + audio), −1 en LSB / DATA-L
  const rtDialPend = { A: null, B: null }; // fréquence du VFO envoyée pendant un accord (en attendant la relecture)
  function rtDialOf(ch) {
    const st = api && api.state && api.state();
    const r = st && st.radio;
    if (!r) return null;
    const dual = r.dualRx === 1 && r.freq && r.freqB;
    const useB = dual ? ch === 1 : r.vfoSel === 1 && !!r.freqB;
    let hz = Number(useB ? r.freqB : r.freq) || 0;
    const pd = rtDialPend[useB ? 'B' : 'A'];
    if (pd && Date.now() - pd.t < 1500) hz = pd.hz; // accord en cours : la fréquence envoyée, pas encore relue
    if (!hz) return null;
    const md = String((useB ? r.modeB : r.mode) || '');
    return { hz, vfo: useB ? 'B' : 'A', sign: /LSB|DATA-L|RTTY-L/i.test(md) ? -1 : 1 };
  }
  // Échelle RTTY en kHz (fréquence réelle : porteuse ± audio), repère au centre de la cascade (1500 Hz)
  function rtKhz(c, w, d) {
    if (!d) return ticks(c, w);
    const H = SCALE_H;
    c.clearRect(0, 0, w, H);
    c.fillStyle = '#0b1018';
    c.fillRect(0, 0, w, H);
    c.font = 'bold 11px Verdana, "DejaVu Sans", Arial, sans-serif';
    c.textBaseline = 'top';
    c.strokeStyle = '#46546a';
    c.beginPath(); c.moveTo(0, 13.5); c.lineTo(w, 13.5); c.stroke();
    const xOf = (rf) => ((d.sign * (rf - d.hz) - WF_LO) / WF_MAX_HZ) * (w - 1);
    const lo = d.sign > 0 ? d.hz + WF_LO : d.hz - WF_LO - WF_MAX_HZ;
    const hi = d.sign > 0 ? d.hz + WF_LO + WF_MAX_HZ : d.hz - WF_LO;
    const labelStep = w / WF_MAX_HZ >= 0.5 ? 100 : w / WF_MAX_HZ >= 0.12 ? 500 : 1000;
    const tick = w / WF_MAX_HZ >= 0.5 ? 10 : 50;
    for (let rf = Math.ceil(lo / tick) * tick; rf <= hi; rf += tick) {
      const x = Math.round(xOf(rf)) + 0.5;
      const big = rf % (tick === 10 ? 100 : 500) === 0;
      const mid = rf % (tick === 10 ? 50 : 100) === 0;
      c.strokeStyle = big ? '#8a9bb0' : mid ? '#5d6c80' : '#3c4859';
      c.beginPath(); c.moveTo(x, big ? 11 : 14); c.lineTo(x, big ? H : mid ? 20 : 17); c.stroke();
      if (rf % labelStep === 0 && x > 20 && x < w - 20) {
        const t = (rf / 1000).toLocaleString('fr-BE', { minimumFractionDigits: rf % 1000 ? 1 : 0, maximumFractionDigits: 2 });
        c.fillStyle = '#F0F5FA';
        c.fillText(t, x - c.measureText(t).width / 2, 0);
      }
    }
    // Centre de la cascade (1500 Hz) : petit triangle blanc
    const xc = ((WF_TOP / 2 - WF_LO) / WF_MAX_HZ) * (w - 1); // milieu de la bande audio (cible de « Centrer »)
    c.fillStyle = '#FFFFFF';
    c.beginPath(); c.moveTo(xc - 5, H - 1); c.lineTo(xc + 5, H - 1); c.lineTo(xc, H - 7); c.closePath(); c.fill();
  }
  // Accord du VFO depuis une cascade RTTY (glisser / molette) : les décodeurs restent sur leurs signaux (même fréquence réelle)
  // Accord du VFO (règle des fréquences, Maj + glisser) : les repères des décodeurs restent où ils sont (même fréquence
  // audio) ; ce sont les signaux qui défilent. On les recale ensuite dans la cascade (comme FLDIGI, MixW).
  // Fréquence affichée tout de suite (sans attendre la relecture du TRX) : règle fluide pendant qu'on tourne ou glisse
  function rtDialShow(vfo, hz) {
    rtDialPend[vfo] = { hz, t: Date.now() };
    drawScale();
    rtHeads();
    bmDraw();
  }
  function rtSetDial(d, nd, noSend) {
    if (nd === d.hz && !noSend) return;
    rtDialShow(d.vfo, nd);
    if (!noSend) api.setFreq(nd, d.vfo);
  }
  function rtTuneOk() {
    if (!api || !api.iControl()) { api && api.say('Prenez la main pour accorder le TRX.', 'warn'); return false; }
    const st = api.state();
    if (st && ((st.ptt && st.ptt.active) || st.ftx)) { api.say('Réglage bloqué pendant l’émission.', 'warn'); return false; }
    return true;
  }
  // Bouton gauche maintenu : les repères du décodeur A suivent la souris en continu ; bouton droit : décodeur B
  // (sur la cascade propre au décodeur B : les deux boutons déplacent B). Maj + glisser (ou bouton du milieu) : accorder le VFO.
  function rtDecDrag(ids, ch) {
    let mk = null;
    for (const id of ids) {
      const el = $(id);
      const fOf = (e) => {
        const rc = el.getBoundingClientRect();
        return WF_LO + Math.max(0, Math.min(1, (e.clientX - rc.left) / (rc.width || 1))) * WF_MAX_HZ;
      };
      const move = (e, final) => {
        const r = rts[mk.target];
        r.f = Math.max(200 + r.shift / 2, Math.min(WF_TOP - 100 - r.shift / 2, Math.round(fOf(e))));
        const now = Date.now();
        if (final) { setRttyF(r.f, mk.target); return; }
        drawScale();
        if (now - mk.t > 150) { mk.t = now; saveRtty(true); } // le décodeur du serveur suit pendant le glisser
      };
      el.addEventListener('pointerdown', (e) => {
        if (tab !== 'rtty' || e.shiftKey || (e.button !== 0 && e.button !== 2)) return;
        mk = { el, id: e.pointerId, target: ch === 1 ? 1 : e.button === 2 ? 1 : 0, t: 0 };
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* */ }
        el.style.cursor = 'ew-resize';
        move(e, false);
      });
      el.addEventListener('pointermove', (e) => { if (mk && mk.el === el && mk.id === e.pointerId) move(e, false); });
      const end = (e) => {
        if (!mk || mk.el !== el) return;
        move(e, true);
        el.style.cursor = '';
        mk = null;
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
  }
  // FT8 / FT4 / FT2, WSPR, JT65, JTTY : bouton gauche maintenu = le repère RX (vert) suit la souris en continu,
  // bouton droit maintenu = le repère TX (rouge) ; un simple clic garde son effet. Ceux qui suivent l'opérateur voient bouger.
  const FT_TABS = ['ftx', 'wspr', 'jt65', 'jtty'];
  function ftDragInit(ids, side) {
    const B = side === 'B';
    let mk = null;
    for (const id of ids) {
      const el = $(id);
      const fOf = (e) => {
        const rc = el.getBoundingClientRect();
        const V = ftV(side);
        return V.lo + Math.max(0, Math.min(1, (e.clientX - rc.left) / (rc.width || 1))) * V.span;
      };
      const move = (e, final) => {
        const f = Math.max(100, Math.min(WF_TOP - 100, Math.round(fOf(e))));
        if (final) return mk.tx ? setTx(f, side) : setRx(f, side);
        if (mk.tx) { if (B) txFB = f; else txF = f; } else if (B) rxFB = f; else rxF = f;
        drawScale();
        bmDraw();
        const now = Date.now();
        if (now - mk.t > 150) { mk.t = now; sendView(); if (!mk.tx && tab === 'jtty') { if (B) jtRedrawB(); else jtRedraw(); } }
      };
      el.addEventListener('pointerdown', (e) => {
        if (FT_TABS.indexOf(tab) < 0 || e.shiftKey || (e.button !== 0 && e.button !== 2)) return;
        mk = { el, id: e.pointerId, tx: e.button === 2, x: e.clientX, moved: false, t: 0 };
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* */ }
      });
      el.addEventListener('pointermove', (e) => {
        if (!mk || mk.el !== el || mk.id !== e.pointerId) return;
        if (!mk.moved && Math.abs(e.clientX - mk.x) < 3) return; // petit tremblement : reste un clic
        mk.moved = true;
        el.style.cursor = 'ew-resize';
        move(e, false);
      });
      const end = (e) => {
        if (!mk || mk.el !== el) return;
        if (mk.moved) move(e, true);
        el.style.cursor = '';
        mk = null;
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
  }
  // CW : bouton gauche maintenu sur la cascade = le repère du décodeur suit la souris en continu (le décodage suit) ;
  // un simple clic garde son effet (se caler sur le signal le plus proche)
  let cwDragged = false;
  function cwDragInit(ids, side) {
    const K = () => (side === 'B' ? cwcB : cwc);
    let mk = null;
    for (const id of ids) {
      const el = $(id);
      const fOf = (e) => {
        const rc = el.getBoundingClientRect();
        const V = ftV(side);
        return V.lo + Math.max(0, Math.min(1, (e.clientX - rc.left) / (rc.width || 1))) * V.span;
      };
      el.addEventListener('pointerdown', (e) => {
        if (tab !== 'cw' || e.button !== 0 || e.shiftKey) return;
        mk = { el, id: e.pointerId, x: e.clientX, moved: false, t: 0 };
        cwDragged = false;
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* */ }
      });
      el.addEventListener('pointermove', (e) => {
        if (!mk || mk.el !== el || mk.id !== e.pointerId) return;
        if (!mk.moved && Math.abs(e.clientX - mk.x) < 3) return; // petit tremblement : reste un clic
        mk.moved = true;
        el.style.cursor = 'ew-resize';
        K().f = Math.max(200, Math.min(2800, Math.round(fOf(e))));
        drawScale();
        const now = Date.now();
        if (now - mk.t > 150) { mk.t = now; saveCw(true); } // le décodeur du serveur suit pendant le glisser
      });
      const end = (e) => {
        if (!mk || mk.el !== el) return;
        if (mk.moved) {
          K().f = Math.max(200, Math.min(2800, Math.round(fOf(e))));
          saveCw(true);
          drawScale();
          cwDragged = true; // le « click » qui suit ne doit pas recaler sur le signal voisin
        }
        el.style.cursor = '';
        mk = null;
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
  }
  function rtDragInit(ids, ch) {
    let drag = null;
    let swallowClick = false;
    // Repères des décodeurs : seulement dans la cascade ; la règle des fréquences accorde le VFO (comme FLDIGI, MixW)
    rtDecDrag(ids.filter((id) => !/Scale/.test(id)), ch);
    for (const id of ids) {
      const el = $(id);
      const onScale = /Scale/.test(id);
      el.addEventListener('mousedown', (e) => { if (tab === 'rtty' && e.button === 1) e.preventDefault(); }); // pas de défilement auto
      el.addEventListener('pointerdown', (e) => {
        // Accord du VFO : glisser sur la règle des fréquences, Maj + glisser sur la cascade, ou bouton du milieu
        if (tab !== 'rtty' || !((e.button === 0 && (e.shiftKey || onScale)) || e.button === 1)) return;
        e.preventDefault();
        const d = rtDialOf(ch);
        if (!d) return;
        drag = { x0: e.clientX, w: el.getBoundingClientRect().width, d, cur: d.hz, moved: false, el, id: e.pointerId, t: 0 };
      });
      el.addEventListener('pointermove', (e) => {
        if (!drag || drag.el !== el) return;
        const dx = e.clientX - drag.x0;
        if (!drag.moved && Math.abs(dx) < 5) return;
        if (!drag.moved) {
          if (!rtTuneOk()) { drag = null; return; }
          drag.moved = true;
          try { el.setPointerCapture(drag.id); } catch (err) { /* */ }
          el.style.cursor = 'grabbing';
        }
        // On « attrape » la bande : glisser à droite = les signaux suivent la souris (le VFO descend en USB)
        const nd = Math.round((drag.d.hz - drag.d.sign * (dx / drag.w) * WF_MAX_HZ) / 10) * 10;
        const now = Date.now();
        if (nd !== drag.shown) { drag.shown = nd; rtSetDial(Object.assign({}, drag.d, { hz: drag.cur }), nd, true); } // règle tout de suite
        if (nd !== drag.cur && now - drag.t > 100) { api.setFreq(nd, drag.d.vfo); drag.cur = nd; drag.t = now; } // TRX : une fréquence toutes les 100 ms au plus
        drag.pending = nd;
      });
      const end = () => {
        if (!drag || drag.el !== el) return;
        if (drag.moved) {
          swallowClick = true;
          if (drag.pending != null && drag.pending !== drag.cur) rtSetDial(Object.assign({}, drag.d, { hz: drag.cur }), drag.pending);
          el.style.cursor = '';
        }
        drag = null;
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      // Un glisser n'est pas un clic (le décodeur ne se recale pas)
      el.addEventListener('click', (e) => { if (swallowClick) { swallowClick = false; e.stopImmediatePropagation(); } }, true);
      // Molette : zoom de la cascade autour de la souris (vers soi = plus étroit, vers l'avant = plus large, jusqu'à ×1) ;
      // Maj + molette : VFO ± 10 Hz par cran
      el.addEventListener('wheel', (e) => {
        if (tab !== 'rtty') return;
        e.preventDefault();
        if (onScale) return rtWheelTune(e, ch);
        if (!e.shiftKey) {
          const now = Date.now();
          if (now - rtZoomAt < 90 || !e.deltaY) return; // pavé tactile : un cran à la fois
          rtZoomAt = now;
          const i = RT_ZOOMS.indexOf(rtZoom);
          const ni = Math.max(0, Math.min(RT_ZOOMS.length - 1, i + (e.deltaY > 0 ? 1 : -1)));
          if (ni === i) return;
          const rc = el.getBoundingClientRect();
          const x = Math.max(0, Math.min(1, (e.clientX - rc.left) / rc.width));
          const f = WF_LO + x * WF_MAX_HZ;
          rtZoom = RT_ZOOMS[ni];
          store.set('rtzoom', String(rtZoom));
          if ($('rtZoom')) $('rtZoom').value = String(rtZoom);
          applySpan(true, { f, x });
          drawScale();
          return;
        }
        if (!rtTuneOk()) return;
        const d = rtDialOf(ch);
        if (!d) return;
        const st = 10 * (e.deltaY < 0 ? 1 : -1);
        const base = rtWheelHz && rtWheelHz.vfo === d.vfo && Date.now() - rtWheelHz.t < 1500 ? rtWheelHz.hz : d.hz;
        const nd = Math.round((base + st) / 10) * 10;
        rtSetDial(Object.assign({}, d, { hz: base }), nd);
        rtWheelHz = { vfo: d.vfo, hz: nd, t: Date.now() };
      }, { passive: false });
    }
  }
  // Molette sur la règle des fréquences : le VFO (le TRX suit) parcourt toute la bande, 10 Hz par cran
  // (50 Hz quand on tourne vite) ; les signaux défilent dans la cascade, les décodeurs restent sur les leurs
  let rtWheelAt = 0;
  function rtWheelTune(e, ch) {
    if (!e.deltaY || !rtTuneOk()) return;
    const d = rtDialOf(ch);
    if (!d) return;
    const now = Date.now();
    const step = (now - rtWheelAt < 70 ? 50 : 10) * (e.deltaY < 0 ? 1 : -1);
    rtWheelAt = now;
    const base = rtWheelHz && rtWheelHz.vfo === d.vfo && now - rtWheelHz.t < 1500 ? rtWheelHz.hz : d.hz;
    let nd = Math.round((base + step) / 10) * 10;
    const b = BANDS_M.find((x) => base / 1e6 >= x[0] && base / 1e6 <= x[1]);
    if (b) nd = Math.max(Math.round(b[0] * 1e6), Math.min(Math.round(b[1] * 1e6), nd)); // limites de la bande
    if (nd === base) return;
    rtSetDial(Object.assign({}, d, { hz: base }), nd);
    rtWheelHz = { vfo: d.vfo, hz: nd, t: now };
  }
  let rtZoomAt = 0;
  let rtWheelHz = null; // molette rapide : on part de la dernière fréquence envoyée, pas de l'état relu (en retard)
  // Centrer : le VFO se déplace pour que le signal du décodeur tombe au milieu de la cascade (1500 Hz)
  function rtCenter(ch) {
    if (!api || !api.iControl()) return api && api.say('Prenez la main pour centrer le signal (le TRX change de fréquence).', 'warn');
    const st = api.state();
    if (st && ((st.ptt && st.ptt.active) || st.ftx)) return api.say('Réglage bloqué pendant l’émission.', 'warn');
    const d = rtDialOf(ch);
    if (!d) return api.say('Fréquence du TRX pas encore lue.', 'warn');
    const r = rts[ch];
    const nd = Math.round((d.hz + d.sign * (r.f - WF_TOP / 2)) / 10) * 10;
    const delta = d.sign * (nd - d.hz); // déplacement en Hz audio
    if (!delta) return;
    api.setFreq(nd, d.vfo);
    r.f -= delta;
    // Même porteuse pour l'autre décodeur (réception simple) : il reste calé sur son signal s'il est encore dans la cascade
    const o = rts[1 - ch];
    const od = rtDialOf(1 - ch);
    if (od && od.vfo === d.vfo && o.f - delta >= 200 + o.shift / 2 && o.f - delta <= WF_TOP - 100 - o.shift / 2) o.f -= delta;
    saveRtty(true);
    applySpan();
    drawScale();
    api.say('Décodeur ' + (ch ? 'B' : 'A') + ' centré : VFO ' + d.vfo + ' sur ' + (nd / 1000).toLocaleString('fr-BE', { minimumFractionDigits: 2 }) + ' kHz.', '', 4000);
  }
  // ------------------------------------------------------------------ carte de bande (DX cluster), à droite en RTTY
  // Colonne verticale : basses fréquences en haut, spots du cluster (et du Reverse Beacon Network), fenêtre audio de la
  // cascade en zone ombrée, repères des décodeurs A et B. Clic sur un spot : le TRX se cale dessus (décodeur TX au milieu
  // de la cascade) et l'indicatif passe dans Correspondant. Molette : zoom ; glisser : déplacer ; double-clic : plage d'origine.
  const BM_DEF = { '160m': [1800, 1850], '80m': [3570, 3600], '40m': [7030, 7120], '30m': [10130, 10150], '20m': [14080, 14150],
    '17m': [18095, 18110], '15m': [21080, 21150], '12m': [24910, 24930], '10m': [28080, 28150], '6m': [50090, 50150] };
  // CW et modes numériques à fréquence fixe (FT8 / FT4 / FT2, WSPR, JT65, JTTY) : plages propres
  const BM_CW = { '160m': [1800, 1840], '80m': [3500, 3560], '40m': [7000, 7040], '30m': [10100, 10130], '20m': [14000, 14070],
    '17m': [18068, 18095], '15m': [21000, 21070], '12m': [24890, 24915], '10m': [28000, 28070], '6m': [50000, 50100] };
  const BM_DG = { '160m': [1836, 1845], '80m': [3567, 3580], '40m': [7038, 7080], '30m': [10130, 10145], '20m': [14070, 14100],
    '17m': [18095, 18110], '15m': [21070, 21100], '12m': [24910, 24925], '10m': [28070, 28130], '6m': [50300, 50330] };
  const BM_TABS = ['ftx', 'jt65', 'rtty', 'wspr', 'jtty', 'cw']; // pas en SSTV (une seule fréquence)
  const BM_ANY = /\b(RTTY|BPS|RY|CW|WPM|FT8|FT4|FT2|PSK\d*|SSB|USB|LSB|JT65|JT9|MSK144|Q65|OLIVIA|SSTV|FM|AM|WSPR|JTTY|BEACON|NCDXF)\b/i;
  // Onglet FT8 / FT4 / FT2 : une plage par mode (la carte se recale quand on passe de FT4 à FT8…)
  function bmGroup() { return tab === 'rtty' ? 'rtty' : tab === 'cw' ? 'cw' : tab === 'ftx' ? (FT_MODES.indexOf(mode) >= 0 ? mode.toLowerCase() : 'ft') : 'dg'; }
  // FT8 / FT4 / FT2 : fréquence d'appel du mode dans la bande ± 20 kHz (sinon : toutes les fréquences FT de la bande ± 20 kHz)
  function bmFtDef(band) {
    const f = [];
    const ms = FT_MODES.indexOf(mode) >= 0 && DIAL[mode].some(([b]) => b.replace(/\s+/g, '') === band) ? [mode] : ['FT8', 'FT4', 'FT2'];
    for (const m of ms) for (const [b, k] of DIAL[m]) if (b.replace(/\s+/g, '') === band) f.push(k);
    return f.length ? [Math.min.apply(null, f) - 20, Math.max.apply(null, f) + 20] : null;
  }
  // Mode suivi par l'onglet : nom (filtre, « déjà contacté ») et mots qui le reconnaissent dans le commentaire du spot
  function bmMode() {
    const m = tab === 'ftx' ? mode : { rtty: 'RTTY', cw: 'CW', jt65: 'JT65', wspr: 'WSPR', jtty: 'JTTY' }[tab] || 'RTTY';
    const want = m === 'RTTY' ? /RTTY|\bBPS\b|\bRY\b/i : m === 'CW' ? /\bCW\b|WPM/i : new RegExp('\\b' + m + '\\b', 'i');
    return { name: m, want };
  }
  const BM_KEEP = 30 * 60000;
  const bmSpots = new Map();
  let bmState = '', bmHost = '', bmRaf = 0, bmBand = '', bmLay = [];
  let bmBandB = '', bmLayB = []; // carte du VFO-B (double réception)
  // Deux cartes de bande (page /ftdx101, double réception) : FT8 / FT4 / FT2, et RTTY avec ses deux cascades
  const bmDualOn = () => !!($('bandMapB') && ((ftDual && dualTab()) || (tab === 'rtty' && rtDualAudio && !detached && api.rig && api.rig() && api.rig().ID !== 'ftx1')));
  const bmBandOfSide = (X) => (X ? bmBandB : bmBand);
  const bmLayOf = (X) => (X ? bmLayB : bmLay);
  let bmFilt = store.get('bmfilt', 'rtty') === 'all' ? 'all' : 'mode';
  let bmFiltB = store.get('bmfiltb', bmFilt) === 'all' ? 'all' : 'mode'; // carte du VFO-B : ses propres filtres
  const bmFiltOf = (X) => (X ? bmFiltB : bmFilt);
  function bmFiltSet(X, v) { if (X) { bmFiltB = v; store.set('bmfiltb', v); } else { bmFilt = v; store.set('bmfilt', v); } }
  const bmModesKey = (X) => 'bmmodes_' + tab + (X ? '_b' : '');
  function bmAdd(list) {
    for (const s of list || []) {
      if (!s || !Number.isFinite(s.f) || typeof s.call !== 'string') continue;
      bmSpots.set(s.call + '|' + Math.round(s.f), { f: s.f, call: s.call, de: String(s.de || ''), cmt: String(s.cmt || ''), skim: !!s.skim, at: Date.now() - Math.max(0, Date.now() - (Number(s.at) || Date.now())) });
    }
    if (bmSpots.size > 3000) for (const k of Array.from(bmSpots.keys()).slice(0, bmSpots.size - 3000)) bmSpots.delete(k);
  }
  function bmBandOf(khz) {
    const b = BANDS_M.find((x) => khz / 1000 >= x[0] && khz / 1000 <= x[1]);
    return b ? b[2] : '';
  }
  function bmKey(band) { const g = bmGroup(); return 'bm_' + (g === 'rtty' ? '' : g + '_') + band; }
  function bmRange(band) {
    const s = store.get(bmKey(band), '');
    const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(s);
    if (m && Number(m[2]) - Number(m[1]) >= 2) return [Number(m[1]), Number(m[2])];
    if (tab === 'ftx' && bmFtDef(band)) return bmFtDef(band);
    const def = { rtty: BM_DEF, cw: BM_CW, dg: BM_DG }[bmGroup()] || BM_DG;
    if (def[band]) return def[band].slice();
    const b = BANDS_M.find((x) => x[2] === band);
    return b ? [b[0] * 1000, Math.min(b[1] * 1000, b[0] * 1000 + 300)] : [7030, 7120];
  }
  function bmSetRange(band, lo, hi) {
    const b = BANDS_M.find((x) => x[2] === band);
    const e0 = b ? b[0] * 1000 - 5 : 0, e1 = b ? b[1] * 1000 + 5 : 1e9;
    let w = Math.max(2, Math.min(e1 - e0, hi - lo));
    lo = Math.max(e0, Math.min(e1 - w, lo));
    store.set(bmKey(band), (Math.round(lo * 10) / 10) + '-' + (Math.round((lo + w) * 10) / 10));
    bmDraw();
  }
  // Mode du spot d'après son commentaire : ceux du mode de l'onglet, et ceux qui ne disent rien, restent affichés
  function bmMatch(s, want) {
    if (want.test(s.cmt)) return true;
    return !BM_ANY.test(s.cmt);
  }
  // Filtres par onglet : modes proposés (nom, mots reconnus dans le commentaire du spot) ; « sans » = spot sans mode indiqué
  const BM_MODES = {
    ftx: [['FT8', /\bFT8\b/i], ['FT4', /\bFT4\b/i], ['FT2', /\bFT2\b/i]],
    rtty: [['RTTY', /RTTY|\bBPS\b|\bRY\b/i], ['PSK', /\bPSK\d*\b|\bBPSK\d*\b/i], ['OLIVIA', /\bOLIVIA\b/i]],
    cw: [['CW', /\bCW\b|WPM/i]],
    jt65: [['JT65', /\bJT65\b/i], ['JT9', /\bJT9\b/i], ['Q65', /\bQ65\b/i]],
    wspr: [['WSPR', /\bWSPR\b/i]],
    jtty: [['JTTY', /\bJTTY\b/i]]
  };
  const bmModeList = () => (BM_MODES[tab] || BM_MODES.rtty).concat([['sans', null]]);
  // Modes cochés pour cet onglet (par défaut : le mode de l'onglet et les spots sans mode, comme avant)
  function bmChecked(X) {
    const v = store.get(bmModesKey(X), X ? store.get(bmModesKey(''), '') : '');
    if (v) return v.split(',');
    return [bmMode().name, 'sans'];
  }
  function bmPass(s, X) {
    if (bmFiltOf(X) === 'all') return true;
    const on = bmChecked(X);
    const known = BM_ANY.test(s.cmt);
    if (!known) return on.indexOf('sans') >= 0;
    return bmModeList().some(([n, re]) => re && on.indexOf(n) >= 0 && re.test(s.cmt));
  }
  function bmFiltDraw(X) {
    if (X === undefined) { bmFiltDraw(''); return bmFiltDraw('B'); }
    const b = $('bmFbtn' + X), a = $('bmAll' + X);
    if (!b || !a) return;
    a.setAttribute('aria-pressed', String(bmFiltOf(X) === 'all'));
    const on = bmChecked(X).filter((n) => n !== 'sans');
    b.classList.toggle('off', bmFiltOf(X) === 'all');
    b.title = 'Modes affichés : ' + (on.length ? on.join(', ') : 'aucun') + (bmChecked(X).indexOf('sans') >= 0 ? ' + spots sans mode' : '') + ' (clic : changer)';
    const m = $('bmFmenu' + X);
    if (m && !m.hidden) {
      const ck = bmChecked(X);
      m.innerHTML = '<span class="bm-fhd">Modes de cet onglet</span>' + bmModeList().map(([n]) => '<label><input type="checkbox" data-bmm="' + n + '"' + (ck.indexOf(n) >= 0 ? ' checked' : '') + '> ' +
        (n === 'sans' ? 'Spots sans mode indiqué' : n) + '</label>').join('') + '<button type="button" class="bm-fdef" data-bmdef="1">Par défaut</button>';
    }
  }
  function bmShown() {
    return BM_TABS.indexOf(tab) >= 0 && !detached && !!$('bandMap') && !$('centerPanel').classList.contains('collapsed');
  }
  function bmShow() {
    const on = BM_TABS.indexOf(tab) >= 0 && !detached;
    const p = $('centerPanel'), bm = $('bandMap');
    if (!p || !bm) return;
    p.classList.toggle('bm-on', on);
    bm.hidden = !on;
    const two = on && bmDualOn();
    p.classList.toggle('bm-dual', two);
    if ($('bandMapB')) $('bandMapB').hidden = !two;
    if (on) bmFiltDraw();
    bmPlace();
    if (on) bmDraw();
  }
  // Écran large (≥ 1700 px) : la carte monte jusqu'en haut de la colonne (écrans VFO A et B rétrécis de la même largeur)
  // Grand écran (mise en page sur une hauteur d'écran) : la carte de bande est une colonne à part, tout à droite,
  // après la colonne des réglages (RX audio, DSP, accord, TX) ; sinon elle reste au bord droit de la fenêtre centrale.
  const BM_FAR_MQ = window.matchMedia ? window.matchMedia('(min-width: 1800px) and (min-height: 860px)') : null;
  function bmFar(p, bm) {
    // Page Face avant : colonne à part, tout à droite, sur toute la hauteur (#fcBm)
    const emb = EMBED ? $('fcBm') : null; // (peut être dans sa fenêtre séparée)
    if (emb) {
      const on = !bm.hidden && !p.classList.contains('collapsed');
      if (on && bm.parentElement !== emb) emb.appendChild(bm);
      if (!on && bm.parentElement !== p) p.appendChild(bm);
      if (document.body.classList.contains('bm-far') !== on) {
        document.body.classList.toggle('bm-far', on);
        bm.style.top = '';
        setTimeout(() => { window.dispatchEvent(new Event('resize')); bmDraw(); }, 0);
      }
      return on;
    }
    const ws = document.querySelector('.workspace');
    // Deux cartes de bande (double réception) : elles restent dans la fenêtre des modes, A à gauche, B à droite
    const far = !!(ws && BM_FAR_MQ && BM_FAR_MQ.matches && !POPUP && !bm.hidden && !p.classList.contains('collapsed') && !p.classList.contains('bm-dual') && p.closest('.workspace') === ws);
    if (far && bm.parentElement !== ws) ws.appendChild(bm);
    if (!far && bm.parentElement !== p) p.appendChild(bm);
    if (document.body.classList.contains('bm-far') !== far) {
      document.body.classList.toggle('bm-far', far);
      bm.style.top = '';
      setTimeout(() => { window.dispatchEvent(new Event('resize')); bmDraw(); }, 0); // cascades redimensionnées
    }
    return far;
  }
  function bmPlace() {
    const p = $('centerPanel'), bm = $('bandMap');
    if (!p || !bm) return;
    bmPlaceIn(p, bm);
    // Carte du VFO-B : toujours juste à côté de celle du VFO-A
    const b2 = $('bandMapB');
    if (b2) {
      if (b2.parentElement !== bm.parentElement || b2.previousElementSibling !== bm) bm.after(b2);
      b2.style.top = bm.style.top;
    }
  }
  function bmPlaceIn(p, bm) {
    if (bmFar(p, bm)) { document.body.classList.remove('bm-tall'); return; }
    // En haut de la colonne : les écrans VFO (s'ils sont dans la colonne), sinon le cadre Step / Bands
    const tp = ['.center > .vfo-row', '.center > [data-panel="bands"]'].map((q) => document.querySelector(q)).find((x) => x && x.offsetParent);
    const zz = (window.RSZOOM && window.RSZOOM.z()) || 1;
    const tall = !bm.hidden && !POPUP && window.innerWidth / zz >= 1700 && !!tp && tp.parentElement === p.parentElement && !!tp.offsetParent
      && tp.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING && !p.classList.contains('collapsed');
    document.body.classList.toggle('bm-tall', tall);
    // getBoundingClientRect est en pixels agrandis quand le dashboard est zoomé (zoom.js) : on revient en pixels CSS
    const z = (window.RSZOOM && window.RSZOOM.z()) || 1;
    const top = tall ? Math.round((tp.getBoundingClientRect().top - p.getBoundingClientRect().top) / z) + 'px' : '0px';
    if (bm.style.top !== top) { bm.style.top = top; bmDraw(); }
  }
  function bmWin() { const b = $('bandMap'); return (b && b.ownerDocument.defaultView) || window; }
  let bmRafW = null;
  function bmDraw() {
    if (bmRaf && bmRafW && bmRafW !== bmWin()) { try { bmRafW.cancelAnimationFrame(bmRaf); } catch (e) {} bmRaf = 0; } // carte déplacée de fenêtre
    if (bmRaf || !bmShown()) return;
    // Carte de bande dans sa fenêtre séparée (face avant) : on dessine au rythme de cette fenêtre-là
    const bw = bmWin();
    bmRaf = bw.requestAnimationFrame(() => { bmRaf = 0; bmPaint(); });
    bmRafW = bw;
  }
  // Ascenseur à droite de la carte : la plage affichée dans toute la bande (glisser = parcourir la bande)
  function bmSbSync(X, band, lo, hi) {
    const sb = $('bmSb' + X);
    if (!sb || !sb.firstElementChild) return;
    const b = BANDS_M.find((x) => x[2] === band);
    const e0 = b ? Math.min(lo, b[0] * 1000 - 5) : lo, e1 = b ? Math.max(hi, b[1] * 1000 + 5) : hi;
    const span = hi - lo, full = Math.max(span, e1 - e0);
    const ch = sb.clientHeight;
    if (!ch) return;
    const ih = Math.max(ch, Math.round(ch * full / span));
    if (sb.firstElementChild.style.height !== ih + 'px') sb.firstElementChild.style.height = ih + 'px';
    Object.assign(sb.dataset, { e0: String(e0), full: String(full), span: String(span), band });
    const top = full > span ? Math.round((lo - e0) / (full - span) * (ih - ch)) : 0;
    if (Math.abs(sb.scrollTop - top) > 1) { sb.prog = true; sb.scrollTop = top; }
  }
  function bmPaint() {
    bmPaintOn('');
    if (bmDualOn()) bmPaintOn('B');
  }
  // Une carte de bande : '' = celle de l'onglet (VFO-A en double réception), 'B' = celle du VFO-B
  function bmPaintOn(X) {
    const body = $('bmBody' + X), cv = $('bmCv' + X), lbls = $('bmLbls' + X);
    if (!body || !cv) return;
    const W = body.clientWidth, H = body.clientHeight;
    if (W < 40 || H < 60) return;
    const dpr = (bmWin().devicePixelRatio || 1) * (window.RSZOOM ? window.RSZOOM.z() : 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const d = X ? rtDialOf(1) : (tab === 'rtty' && !bmDualOn() && rtDialOf(rtTx)) || rtDialOf(0);
    const md = bmMode();
    const cur = bmBandOfSide(X);
    const band = d ? bmBandOf(d.hz / 1000) : cur || '40m';
    if (band && band !== cur) { if (X) bmBandB = band; else bmBand = band; }
    const bandNow = bmBandOfSide(X);
    const [lo, hi] = bmRange(bandNow || '40m');
    $('bmBandT' + X).textContent = (bandNow || '—').replace('m', ' m').replace('c m', ' cm');
    if (document.activeElement !== $('bmLo' + X)) $('bmLo' + X).value = String(lo).replace('.', ',');
    if (document.activeElement !== $('bmHi' + X)) $('bmHi' + X).value = String(hi).replace('.', ',');
    const PAD = 6, RX = 50; // règle : x de 0 à RX (poignée de largeur sur les 6 premiers pixels)
    const yOf = (khz) => PAD + ((khz - lo) / (hi - lo)) * (H - 2 * PAD);
    if (X) bmLayB = [lo, hi, PAD, H]; else bmLay = [lo, hi, PAD, H];
    bmSbSync(X, bandNow, lo, hi);
    const rf = X ? rxFB : rxF, tf = X ? txFB : txF;
    // fond de la règle
    c.fillStyle = '#0b1018'; c.fillRect(0, 0, RX, H);
    c.strokeStyle = '#46546a'; c.beginPath(); c.moveTo(RX + 0.5, 0); c.lineTo(RX + 0.5, H); c.stroke();
    // fenêtre audio de la cascade (fréquences réelles) et repères des décodeurs
    const line = (khz, col, txt, bold) => {
      const y = yOf(khz);
      if (y < 0 || y > H) return;
      c.strokeStyle = col;
      c.lineWidth = bold ? 2 : 1;
      c.beginPath(); c.moveTo(0, Math.round(y) + 0.5); c.lineTo(W, Math.round(y) + 0.5); c.stroke();
      c.lineWidth = 1;
      c.fillStyle = col;
      c.font = 'bold 10px Verdana, "DejaVu Sans", Arial, sans-serif';
      c.textBaseline = 'middle';
      c.fillText(txt, 7, Math.max(6, Math.min(H - 6, y - 7)));
    };
    if (d && tab === 'cw') line(d.hz / 1000, '#F2CF4A', 'VFO', true); // CW : fréquence du VFO (battement nul)
    else if (d) {
      const VB = X ? ftV('B') : { lo: WF_LO, span: WF_MAX_HZ };
      const a = (d.hz + d.sign * VB.lo) / 1000, b = (d.hz + d.sign * (VB.lo + VB.span)) / 1000;
      const y0 = yOf(Math.min(a, b)), y1 = yOf(Math.max(a, b));
      if (y1 >= 0 && y0 <= H) {
        c.fillStyle = 'rgba(0, 212, 255, .16)';
        c.fillRect(0, Math.max(0, y0), W, Math.max(2, Math.min(H, y1) - Math.max(0, y0)));
        c.strokeStyle = 'rgba(0, 212, 255, .55)';
        c.strokeRect(0.5, Math.max(0, y0) + 0.5, W - 1, Math.max(2, Math.min(H, y1) - Math.max(0, y0)) - 1);
      }
      if (tab === 'rtty') {
        rts.forEach((x, ch) => {
          const dd = rtDialOf(ch);
          if (!dd || dd.vfo !== d.vfo) return;
          line((dd.hz + dd.sign * x.f) / 1000, ch ? '#AA33FF' : '#E0A800', (ch ? 'B' : 'A') + (ch === rtTx ? ' TX' : ' RX'), ch === rtTx);
        });
      } else if (tab !== 'wspr') {
        // FT8 / FT4 / FT2, JT65, JTTY : fréquences de réception (vert) et d'émission (rouge)
        if (tab !== 'jtty' && Math.abs(tf - rf) > 20) line((d.hz + d.sign * tf) / 1000, '#ff5a4a', 'TX', false);
        line((d.hz + d.sign * rf) / 1000, '#3ee07f', tab === 'jtty' || Math.abs(tf - rf) <= 20 ? 'RX TX' : 'RX', true);
      }
      // VFO hors de la plage : flèche en haut ou en bas
      const vk = d.hz / 1000;
      if (vk < lo || vk > hi) {
        c.fillStyle = '#00d4ff'; c.font = 'bold 10px Verdana, "DejaVu Sans", Arial, sans-serif'; c.textBaseline = vk < lo ? 'top' : 'bottom';
        c.fillText((vk < lo ? '▲ ' : '▼ ') + 'VFO ' + vk.toFixed(1).replace('.', ','), RX + 4, vk < lo ? 2 : H - 2);
      }
    }
    // graduations : pas choisi pour ~40 px entre deux étiquettes
    const span = hi - lo, pxk = (H - 2 * PAD) / span;
    const step = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].find((s) => s * pxk >= 34) || 1000;
    const minor = step / (step >= 5 && step !== 20 && step !== 200 ? 5 : 2);
    c.font = 'bold 11px Verdana, "DejaVu Sans", Arial, sans-serif'; // fréquences en blanc gras
    c.textBaseline = 'middle';
    for (let f = Math.ceil(lo / minor) * minor; f <= hi + 1e-9; f += minor) {
      const y = Math.round(yOf(f)) + 0.5;
      const major = Math.abs(f / step - Math.round(f / step)) < 1e-6;
      c.strokeStyle = major ? '#8fa0b8' : '#46546a';
      c.beginPath(); c.moveTo(major ? RX - 9 : RX - 5, y); c.lineTo(RX, y); c.stroke();
      if (major) {
        c.fillStyle = '#ffffff';
        const t = step < 1 ? f.toFixed(1).replace('.', ',') : String(Math.round(f));
        c.fillText(t.length > 5 ? t.slice(-5) : t, 7, y);
      }
    }
    // spots de la plage : les plus récents d'abord s'il n'y a pas la place pour tous
    const now = Date.now();
    for (const [k, s] of bmSpots) if (now - s.at > BM_KEEP) bmSpots.delete(k);
    const LH = 15, room = Math.max(1, Math.floor((H - 2) / LH));
    let list = Array.from(bmSpots.values()).filter((s) => s.f >= lo && s.f <= hi && bmPass(s, X));
    if (list.length > room) list = list.sort((a, b) => b.at - a.at).slice(0, room);
    list.sort((a, b) => a.f - b.f);
    const pos = list.map((s) => yOf(s.f) - LH / 2);
    for (let i = 0; i < pos.length; i++) pos[i] = Math.max(i ? pos[i - 1] + LH : 0, pos[i]);
    for (let i = pos.length - 1; i >= 0; i--) pos[i] = Math.min(i < pos.length - 1 ? pos[i + 1] - LH : H - LH, pos[i]);
    for (let i = 0; i < pos.length; i++) pos[i] = Math.max(i ? pos[i - 1] + LH : 0, pos[i]);
    const LX = RX + 16;
    c.strokeStyle = 'rgba(143, 160, 184, .55)';
    list.forEach((s, i) => {
      const y = Math.round(yOf(s.f)) + 0.5, ly = pos[i] + LH / 2;
      c.beginPath(); c.moveTo(RX, y); c.lineTo(RX + 6, y); c.lineTo(LX - 2, ly); c.stroke();
    });
    lbls.textContent = '';
    const bandKey = bandNow;
    list.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bm-s';
      const cq = s.skim || /\bCQ\b|\bTEST\b|CONTEST/i.test(s.cmt);
      if (cq) b.classList.add('bm-cq');
      if (worked.has(s.call + '|' + bandKey + '|' + md.name)) b.classList.add('bm-wkd');
      b.style.top = Math.round(pos[i]) + 'px';
      b.style.left = LX + 'px';
      b.style.opacity = String(Math.max(0.45, 1 - (now - s.at) / BM_KEEP * 0.55));
      b.dataset.k = s.call + '|' + Math.round(s.f);
      const min = Math.max(0, Math.round((now - s.at) / 60000));
      b.innerHTML = '<b></b><small></small>';
      b.firstChild.textContent = s.call;
      b.lastChild.textContent = ' ' + s.f.toFixed(1).replace('.', ',');
      b.title = s.call + ' · ' + s.f.toFixed(1).replace('.', ',') + ' kHz · ' + (s.cmt || '—') + ' · de ' + s.de + ' · il y a ' + min + ' min'
        + (b.classList.contains('bm-wkd') ? ' · déjà contacté sur cette bande en ' + md.name : '') + '\nClic : le TRX se cale sur ce signal et l’indicatif passe dans Correspondant';
      lbls.appendChild(b);
    });
    const n = Array.from(bmSpots.values()).filter((s) => s.f >= lo && s.f <= hi).length;
    $('bmFoot' + X).textContent = n + ' spot' + (n > 1 ? 's' : '') + (list.length < n ? ' (' + list.length + ' affichés)' : '');
    const st = $('bmSt' + X);
    st.className = 'bm-st ' + (bmState === 'connecté' ? 'ok' : bmState ? 'ko' : '');
    st.title = 'DX cluster' + (bmHost ? ' ' + bmHost : '') + ' : ' + (bmState || 'pas de nouvelles') + ' · spots gardés 30 min';
  }
  // Calage du TRX sur une fréquence réelle (kHz) : décodeur de l'émission au milieu de la cascade
  // Page TRX CW ouverte (la clé du dashboard est alors en veille) : au premier plan après un spot CW
  function cwPageFocus() {
    let w = window;
    try { while (w && !(w.RSPADDLE && w.RSPADDLE.suspended) && w.opener && w.opener !== w) w = w.opener; } catch (e) { return; }
    try { if (w && w.RSPADDLE && w.RSPADDLE.suspended) { const p = window.open('', 'rs-cwpage'); if (p) p.focus(); } } catch (e) {}
  }
  function bmTune(khz, call, X) {
    if (call) setDx({ call });
    if (!api || !api.iControl()) return api && api.say('Prenez la main pour vous caler sur ' + (call || 'cette fréquence') + ' (le TRX change de fréquence).', 'warn');
    const st = api.state();
    if (st && ((st.ptt && st.ptt.active) || st.ftx)) return api.say('Réglage bloqué pendant l’émission.', 'warn');
    const hz = Math.round(khz * 1000);
    if (tab !== 'rtty') return bmTuneOther(hz, call, X);
    const ch = X ? 1 : bmDualOn() ? 0 : rtTx; // deux cartes : chacune règle le décodeur de son VFO
    const d = rtDialOf(ch);
    if (!d) return api.say('Fréquence du TRX pas encore lue.', 'warn');
    const r = rts[ch];
    const audio = d.sign * (hz - d.hz);
    // déjà dans la cascade : seul le décodeur bouge
    if (audio >= WF_LO + 150 && audio <= WF_LO + WF_MAX_HZ - 150 && audio >= 200 + r.shift / 2 && audio <= WF_TOP - 100 - r.shift / 2) {
      setRttyF(audio, ch);
      rtHeads();
      bmDraw();
      return;
    }
    const nd = Math.round((hz - d.sign * WF_TOP / 2) / 10) * 10;
    api.setFreq(nd, d.vfo, true);
    r.f = d.sign * (hz - nd);
    saveRtty(true);
    applySpan(true);
    drawScale();
    bmDraw();
    api.say((call ? call + ' : ' : '') + 'VFO ' + d.vfo + ' sur ' + (nd / 1000).toLocaleString('fr-BE', { minimumFractionDigits: 2 }) + ' kHz, décodeur ' + (ch ? 'B' : 'A') + ' sur le signal.', '', 4000);
  }
  // CW : le VFO va sur la station (battement nul : elle sort à la tonalité du TRX, où le décodeur est déjà calé).
  // FT8 / FT4 / FT2, JT65, JTTY, WSPR : la fréquence de réception se place sur le signal ; hors de la bande audio,
  // le VFO bouge pour le mettre à 1500 Hz.
  function bmTuneOther(hz, call, X) {
    const side = X ? 'B' : undefined;
    const d = rtDialOf(X ? 1 : 0);
    if (!d) return api.say('Fréquence du TRX pas encore lue.', 'warn');
    const who = call ? call + ' : ' : '';
    if (tab === 'cw') {
      const nd = Math.round(hz / 10) * 10;
      api.setFreq(nd, d.vfo, true);
      bmDraw();
      return api.say(who + 'VFO ' + d.vfo + ' sur ' + (nd / 1000).toLocaleString('fr-BE', { minimumFractionDigits: 2 }) + ' kHz.', '', 4000);
    }
    const audio = d.sign * (hz - d.hz);
    if (audio >= 150 && audio <= WF_TOP - 150) { setRx(audio, side); bmDraw(); return; }
    const nd = Math.round((hz - d.sign * 1500) / 100) * 100;
    api.setFreq(nd, d.vfo, true);
    setRx(d.sign * (hz - nd), side);
    bmDraw();
    api.say(who + 'VFO ' + d.vfo + ' sur ' + (nd / 1000).toLocaleString('fr-BE', { minimumFractionDigits: 2 }) + ' kHz, réception sur le signal.', '', 4000);
  }
  // Spot cliqué sur dx.op0p.be ou cluster.op0p.be (via le dashboard) : l'onglet du mode s'ouvre et le TRX se cale dessus
  // comme avec la carte de bande. Renvoie false pour la phonie (SSB, AM, FM), réglée directement par le dashboard.
  function spotQsy(khz, M, call) {
    const tabFor = { RTTY: 'rtty', CW: 'cw', FT8: 'ftx', FT4: 'ftx', FT2: 'ftx', JT65: 'jt65', WSPR: 'wspr', JTTY: 'jtty' }[M];
    if (call && M !== 'WSPR') setDx({ call });
    if (!tabFor) return false;
    if (!api || !api.iControl()) { api && api.say('Prenez la main pour vous caler sur ' + (call || khz + ' kHz') + '.', 'warn'); return true; }
    const st = api.state();
    if (st && ((st.ptt && st.ptt.active) || st.ftx)) { api.say('Réglage bloqué pendant l’émission.', 'warn'); return true; }
    if (detached) { api.say('Les modes numériques sont dans la fenêtre séparée : le spot y est envoyé.', ''); }
    if (['FT8', 'FT4', 'FT2'].indexOf(M) >= 0 && mode !== M) setMode(M);
    showTab(tabFor);
    const hz = Math.round(khz * 1000);
    if (M === 'CW') {
      qsyTo(hz / 1000, 'CW');
      api.say((call ? call + ' : ' : '') + 'CW sur ' + khz.toLocaleString('fr-BE') + ' kHz (VFO A).', '', 4000);
      return true;
    }
    if (M === 'RTTY') {
      // Porteuse 1500 Hz sous le signal (DATA-U), décodeur de l'émission au milieu de la cascade
      const nd = Math.round((hz - WF_TOP / 2) / 10) * 10;
      qsyTo(nd / 1000);
      rts[rtTx].f = hz - nd;
      saveRtty(true);
      applySpan(true);
      drawScale();
      bmDraw();
      api.say((call ? call + ' : ' : '') + 'RTTY sur ' + khz.toLocaleString('fr-BE') + ' kHz, décodeur ' + (rtTx ? 'B' : 'A') + ' sur le signal.', '', 4000);
      return true;
    }
    // FT8 / FT4 / FT2 / JT65 / WSPR / JTTY : fréquence d'appel habituelle si le spot est dans sa bande audio, sinon 1500 Hz sous le signal
    const list = DIAL[M] || DIAL.FT8;
    const std = list.map((x) => x[1]).find((d) => khz >= d && khz - d <= 3);
    const nd = std ? Math.round(std * 1000) : Math.round((hz - 1500) / 100) * 100;
    qsyTo(nd / 1000);
    if (M !== 'WSPR') setRx(hz - nd);
    api.say((call ? call + ' : ' : '') + M + ' sur ' + (nd / 1000).toLocaleString('fr-BE') + ' kHz' + (M !== 'WSPR' ? ', réception à ' + (hz - nd) + ' Hz.' : '.'), '', 4000);
    return true;
  }
  function bmInit() {
    if (!$('bmBody')) return;
    bmBindBody('');
    if ($('bmBodyB')) bmBindBody('B');
    bmInitA();
  }
  // Glisser, molette, clic et plage d'une carte de bande ('' ou 'B')
  function bmBindBody(X) {
    const body = $('bmBody' + X);
    const kOf = (e) => {
      const r = body.getBoundingClientRect();
      const [lo, hi, PAD, H] = bmLayOf(X);
      const y = ((e.clientY - r.top) / (r.height || 1)) * H; // pixels CSS, même avec le zoom du dashboard
      return lo + ((y - PAD) / (H - 2 * PAD)) * (hi - lo);
    };
    let drag = null;
    body.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !bmLayOf(X).length) return;
      drag = { y: e.clientY, r: bmRange(bmBandOfSide(X)), moved: false, t: e.target, w: body.ownerDocument.defaultView || window };
      drag.w.addEventListener('mousemove', bmMove);
      drag.w.addEventListener('mouseup', bmUp);
      e.preventDefault();
    });
    // Déplacement et clic suivis dans la fenêtre où se trouve la carte (page, ou sa fenêtre séparée)
    const bmMove = (e) => {
      if (!drag) return;
      const dy = (e.clientY - drag.y) / ((window.RSZOOM && window.RSZOOM.z()) || 1);
      if (Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      const L = bmLayOf(X);
      const H = L[3] - 2 * L[2];
      const dk = -dy / H * (drag.r[1] - drag.r[0]);
      bmSetRange(bmBandOfSide(X), drag.r[0] + dk, drag.r[1] + dk);
    };
    const bmUp = (e) => {
      if (!drag) return;
      const g = drag; drag = null;
      g.w.removeEventListener('mousemove', bmMove);
      g.w.removeEventListener('mouseup', bmUp);
      if (g.moved) return;
      const b = g.t.closest && g.t.closest('.bm-s');
      if (b) {
        const s = bmSpots.get(b.dataset.k);
        if (!s) return;
        // Spot CW (commentaire « CW », vitesse en WPM, ou skimmer) hors de l'onglet CW : TRX en CW, onglet CW, indicatif
        if (tab !== 'cw' && (s.skim || /\bCW\b|WPM/i.test(s.cmt))) { spotQsy(s.f, 'CW', s.call); cwPageFocus(); return; }
        bmTune(s.f, s.call, X);
        if (tab === 'cw') cwPageFocus();
        return;
      }
      if (body.contains(e.target)) bmTune(kOf(e), undefined, X);
    };
    body.addEventListener('wheel', (e) => {
      if (!bmLayOf(X).length) return;
      e.preventDefault();
      const [lo, hi] = bmRange(bmBandOfSide(X));
      const k = kOf(e), f = e.deltaY > 0 ? 1.25 : 0.8;
      const nlo = k - (k - lo) * f, nhi = k + (hi - k) * f;
      if (nhi - nlo < 3 && f < 1) return;
      bmSetRange(bmBandOfSide(X), nlo, nhi);
    }, { passive: false });
    body.addEventListener('click', (e) => e.stopPropagation());
    body.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (e.target.closest('.bm-s')) return;
      store.set(bmKey(bmBandOfSide(X)), '');
      bmDraw();
    });
    const num = (v) => Number(String(v).replace(',', '.').replace(/\s/g, ''));
    for (const id of ['bmLo' + X, 'bmHi' + X]) {
      $(id).addEventListener('change', () => {
        const a = num($('bmLo' + X).value), b = num($('bmHi' + X).value);
        if (Number.isFinite(a) && Number.isFinite(b) && b - a >= 2) bmSetRange(bmBandOfSide(X), a, b);
        else bmDraw();
      });
      $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    }
    if (window.ResizeObserver) new ResizeObserver(() => bmDraw()).observe(body);
    const sb = $('bmSb' + X);
    if (sb) {
      // L'ascenseur a sa propre souris et sa propre molette (pas de glisser / zoom de la carte)
      for (const ev of ['mousedown', 'click', 'dblclick', 'wheel']) sb.addEventListener(ev, (e) => e.stopPropagation());
      sb.addEventListener('scroll', () => {
        if (sb.prog) { sb.prog = false; return; }
        const max = sb.scrollHeight - sb.clientHeight;
        const e0 = Number(sb.dataset.e0), full = Number(sb.dataset.full), span = Number(sb.dataset.span);
        if (max <= 0 || !(full > span)) return;
        const lo = e0 + (sb.scrollTop / max) * (full - span);
        bmSetRange(sb.dataset.band, lo, lo + span);
      });
    }
  }
  // Filtres (liste des modes de l'onglet) et « Tous » d'une carte ('' ou 'B' : chacune les siens)
  function bmBindFilters(X) {
    const fm = $('bmFmenu' + X), fb = $('bmFbtn' + X);
    if (!fm || !fb) return;
    const fClose = () => { fm.hidden = true; fb.setAttribute('aria-expanded', 'false'); };
    fb.addEventListener('click', (e) => {
      e.stopPropagation();
      fm.hidden = !fm.hidden;
      fb.setAttribute('aria-expanded', String(!fm.hidden));
      if (!fm.hidden && bmFiltOf(X) === 'all') { bmFiltSet(X, 'mode'); bmDraw(); } // choisir des modes = quitter « Tous »
      bmFiltDraw(X);
    });
    fm.addEventListener('click', (e) => e.stopPropagation());
    fm.addEventListener('change', (e) => {
      const i = e.target.closest('[data-bmm]');
      if (!i) return;
      const on = Array.from(fm.querySelectorAll('[data-bmm]')).filter((x) => x.checked).map((x) => x.dataset.bmm);
      store.set(bmModesKey(X), on.length ? on.join(',') : '-'); // « - » : rien de coché (aucun spot)
      bmFiltDraw(X);
      bmDraw();
    });
    fm.addEventListener('click', (e) => { if (e.target.closest('[data-bmdef]')) { store.set(bmModesKey(X), ''); bmFiltDraw(X); bmDraw(); } });
    document.addEventListener('click', () => { if (!fm.hidden) fClose(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !fm.hidden) fClose(); });
    $('bmAll' + X).addEventListener('click', () => { bmFiltSet(X, bmFiltOf(X) === 'all' ? 'mode' : 'all'); fClose(); bmFiltDraw(X); bmDraw(); });
    bmFiltDraw(X);
  }
  function bmInitA() {
    bmBindFilters('');
    bmBindFilters('B');
    if ($('bmPop')) $('bmPop').addEventListener('click', (e) => { e.stopPropagation(); document.dispatchEvent(new CustomEvent('rs-bm-pop')); });
    // Poignée sur le bord gauche : largeur de la carte de bande, gardée dans ce navigateur
    const root = document.documentElement;
    // b = carte du VFO-B (double réception) : sa propre largeur (--bm-wb), indépendante de celle du VFO-A
    const setW = (w, save, b) => {
      const v = b ? '--bm-wb' : '--bm-w', k = b ? 'bmwb' : 'bmw';
      if (w == null) { root.style.removeProperty(v); if (save) store.set(k, ''); }
      else {
        w = Math.max(120, Math.min(520, Math.round(w)));
        root.style.setProperty(v, w + 'px');
        if (save) store.set(k, String(w));
      }
      bmPlace();
      if (WF_TABS.indexOf(tab) >= 0) sizeCanvas();
      bmDraw();
    };
    const saved = Number(store.get('bmw', ''));
    if (saved >= 120) setW(saved, false);
    const savedB = Number(store.get('bmwb', ''));
    if (savedB >= 120) setW(savedB, false, true);
    // Poignées : carte du VFO-A (bord droit en double réception ou dans la page TRX DIGI, sinon bord gauche) ;
    // carte du VFO-B (bord gauche). Chaque carte a sa propre largeur.
    for (const grip of [$('bmGrip'), $('bmGripB')].filter(Boolean)) {
    const isB = grip.id === 'bmGripB';
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      const zf = (window.RSZOOM && window.RSZOOM.z()) || 1;
      const x0 = e.clientX, w0 = $(isB ? 'bandMapB' : 'bandMap').getBoundingClientRect().width / zf;
      document.body.classList.add('bm-resizing');
      // Carte à gauche (page TRX DIGI, ou VFO-A en double réception) : poignée sur son bord droit (sens inversé)
      const sg = !isB && (document.body.classList.contains('digi-popup') || $('centerPanel').classList.contains('bm-dual')) ? -1 : 1;
      const mv = (ev) => setW(w0 - sg * (ev.clientX - x0) / zf, false, isB);
      const up = (ev) => {
        grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
        document.body.classList.remove('bm-resizing');
        setW(w0 - sg * (ev.clientX - x0) / zf, true, isB);
      };
      grip.addEventListener('pointermove', mv);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('dblclick', (e) => { e.stopPropagation(); setW(null, true, isB); });
    }
    window.addEventListener('resize', () => { if (BM_TABS.indexOf(tab) >= 0) bmShow(); });
  }
  // En-têtes des deux décodeurs : centre, fréquence du signal suivi, décodeur de l'émission
  function rtHeads() {
    const st = api && api.state && api.state();
    const r = st && st.radio;
    // Fréquence du signal suivi : porteuse du VFO réellement écouté ± fréquence audio (− en LSB / DATA-L).
    // En réception simple, les deux décodeurs lisent le même récepteur : B est alors rapporté au VFO écouté, pas au VFO-B.
    rts.forEach((x, ch) => {
      const sfx = RT_SFX[ch];
      if (!$('rtF' + sfx)) return;
      const d = rtDialOf(ch);
      $('rtF' + sfx).textContent = Math.round(x.f);
      const own = d && d.vfo === (ch ? 'B' : 'A');
      // En grand : la fréquence du VFO, comme sur l'écran du TRX (14.078.540) ; en petit : celle du signal suivi
      // (porteuse ± centre Mark / Space, comme FLDIGI)
      const mhz = (hz) => { const t = String(Math.round(hz)).padStart(7, '0'); return t.slice(0, -6) + '.' + t.slice(-6, -3) + '.' + t.slice(-3); };
      $('rtRf' + sfx).textContent = d ? mhz(d.hz) + (own ? '' : ' (VFO ' + d.vfo + ')') : '';
      if ($('rtSig' + sfx)) $('rtSig' + sfx).textContent = d ? 'signal ' + ((d.hz + d.sign * x.f) / 1000).toLocaleString('fr-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' kHz' : '';
      // Comme en FT8 : fréquence en grand, sur fond rouge (« TX ») pour le décodeur d'où part l'émission
      $('rtRf' + sfx).classList.toggle('tx', ch === rtTx && !!d);
      $('rtRf' + sfx).title = !d ? '' : own ? 'Fréquence du VFO ' + d.vfo + ' (comme sur le TRX) ; signal suivi = VFO ' + (d.sign > 0 ? '+' : '−') + ' ' + Math.round(x.f) + ' Hz (centre du décodeur)'
        : 'Réception simple : ce décodeur lit le même récepteur que l’autre, celui du VFO ' + d.vfo + ' (le VFO ' + (ch ? 'B' : 'A') + ' n’est pas écouté). Fréquence = VFO ' + d.vfo + ' ' + (d.sign > 0 ? '+' : '−') + ' ' + Math.round(x.f) + ' Hz.';
    });
    // Porteuse changée (molette, bandes…) : échelles en kHz redessinées
    const dk = JSON.stringify([rtDialOf(0), rtDialOf(1)]);
    if (dk !== rtDialKey) { rtDialKey = dk; if (tab === 'rtty') { drawScale(); return; } }
    const sp = $('rtSplitBtn');
    if (sp) {
      const on = !!(r && r.split === 1);
      sp.setAttribute('aria-pressed', String(on));
      sp.textContent = on ? 'SPLIT · TX sur B' : 'SPLIT';
    }
    const fx = st && st.ftx;
    const txing = !!(fx && fx.mode === 'RTTY');
    document.querySelectorAll('.rt-txsel').forEach((b) => {
      const on = Number(b.dataset.ch) === rtTx;
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? (txing ? '■ Arrêter' : '▶ TX ici') : 'RX ici';
      b.title = on ? (txing ? 'Arrêter l’émission RTTY en cours (ou Échap)' : 'Émet le texte personnalisé (cadre du bas) sur la fréquence de ce décodeur, comme « Émettre ». Les macros F1 à F12 partent aussi d’ici.')
        : 'Fenêtre en réception seulement. Clic : elle devient la fenêtre d’émission (▶ TX ici), l’autre passe en RX ici. Un 2e clic émet le texte personnalisé.';
      b.closest('.rt-side').classList.toggle('rt-istx', on);
    });
  }
  function setRttyF(f, ch) {
    const r = rts[ch || 0];
    r.f = Math.max(200 + r.shift / 2, Math.min(WF_TOP - 100 - r.shift / 2, Math.round(f)));
    saveRtty(true);
    applySpan();
    drawScale();
  }
  // Bande audio et zoom de la cascade RTTY (comme MixW) : fenêtre centrée sur le décodeur de l'émission,
  // déplacée seulement quand il s'approche d'un bord (l'historique de la cascade glisse avec elle)
  let rtSpan = Number(store.get('rtspan', '3000')) === 4000 ? 4000 : 3000;
  const RT_ZOOMS = [1, 1.5, 2, 3, 4, 6, 8];
  let rtZoom = RT_ZOOMS.indexOf(Number(store.get('rtzoom', '1'))) >= 0 ? Number(store.get('rtzoom', '1')) : 1;
  // anchor : { f, x } = garder la fréquence audio f sous la même position x (0–1) de la cascade (zoom à la molette)
  let ftZoomAt = 0;
  function ftZoom(side, e) {
    if (ZOOM_TABS.indexOf(tab) < 0 || detached) return;
    e.preventDefault();
    const now = Date.now();
    if (now - ftZoomAt < 90 || !e.deltaY) return; // pavé tactile : un cran à la fois
    ftZoomAt = now;
    const cur = ftV(side);
    const rc = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rc.left) / (rc.width || 1)));
    const f = cur.lo + x * cur.span;
    let span = Math.round(cur.span * (e.deltaY > 0 ? 0.75 : 1 / 0.75) / 10) * 10;
    span = Math.max(tab === 'cw' ? 200 : 300, Math.min(3000, span)); // CW : jusqu'à 200 Hz de large
    if (span === cur.span) return;
    const lo = span >= 3000 ? 0 : Math.max(0, Math.min(3000 - span, Math.round((f - x * span) / 10) * 10));
    ftSetView(side, lo, span);
    // Double réception : les deux cascades gardent la même plage (même largeur d'affichage pour les deux VFO)
    if (ftDual) ftSetView(side === 'B' ? 'A' : 'B', lo, span);
  }
  /** Double réception : la cascade du VFO-B prend la plage de celle du VFO-A */
  function ftSyncViews() {
    const a = zoomView('A'), b = zoomView('B');
    if (ftDual && a && b && (a.lo !== b.lo || a.span !== b.span)) ftSetView('B', a.lo, a.span);
  }
  function ftSetView(side, lo, span) {
    const V = zoomView(side);
    if (!V) return;
    const oldLo = side === 'B' ? V.lo : WF_LO, oldSpan = side === 'B' ? V.span : WF_MAX_HZ;
    V.lo = lo;
    V.span = span;
    store.set((tab === 'cw' ? 'cwview' : 'ftview') + (side === 'B' ? 'b' : 'a'), JSON.stringify(V));
    if (side !== 'B') applySpan(true);
    else if (wfFB.ctx) {
      // Historique de la cascade B recalé sur la nouvelle plage
      const tmp = document.createElement('canvas'); tmp.width = wfFB.w; tmp.height = wfFB.h;
      tmp.getContext('2d').drawImage(wfFB.ctx.canvas, 0, 0);
      wfFB.ctx.fillStyle = '#05080d';
      wfFB.ctx.fillRect(0, 0, wfFB.w, wfFB.h);
      const k = oldSpan / span;
      wfFB.ctx.imageSmoothingEnabled = k < 1;
      wfFB.ctx.drawImage(tmp, ((oldLo - lo) / span) * wfFB.w, 0, wfFB.w * k, wfFB.h);
      wfFB.ctx.imageSmoothingEnabled = true;
      wfFB.acc = null;
    }
    drawScale();
    bmDraw();
  }
  function applySpan(force, anchor) {
    const rt = tab === 'rtty' && !detached;
    const ftz = ZOOM_TABS.indexOf(tab) >= 0 && !detached ? zoomView('A') : null; // FT8 / FT4 / FT2, CW : plage choisie à la molette
    const top = rt ? rtSpan : 3000;
    const span = rt ? top / rtZoom : ftz ? ftz.span : 3000;
    let lo = ftz ? ftz.lo : 0;
    if (rt && span < top) {
      const f = rts[rtTx].f;
      lo = WF_LO;
      if (anchor) lo = anchor.f - anchor.x * span;
      else if (span !== WF_MAX_HZ || f < lo + span * 0.15 || f > lo + span * 0.85) lo = f - span / 2;
      lo = Math.max(0, Math.min(top - span, Math.round(lo / 10) * 10));
    }
    if (top === WF_TOP && span === WF_MAX_HZ && lo === WF_LO && !force) return false;
    const oldLo = WF_LO, oldSpan = WF_MAX_HZ, sameTop = top === WF_TOP;
    WF_TOP = top;
    WF_MAX_HZ = span;
    WF_LO = lo;
    if (wf.ctx) {
      // Historique de la cascade recalé sur la nouvelle fenêtre (décalage et zoom) ; il repart à vide si la bande change
      let tmp = null;
      if (sameTop) {
        tmp = document.createElement('canvas'); tmp.width = wf.w; tmp.height = wf.h;
        tmp.getContext('2d').drawImage(wf.ctx.canvas, 0, 0);
      }
      wf.ctx.fillStyle = '#05080d';
      wf.ctx.fillRect(0, 0, wf.w, wf.h);
      if (tmp) {
        const k = oldSpan / span;
        wf.ctx.imageSmoothingEnabled = k < 1;
        wf.ctx.drawImage(tmp, ((oldLo - lo) / span) * wf.w, 0, wf.w * k, wf.h);
        wf.ctx.imageSmoothingEnabled = true;
      }
    }
    wf.acc = null;
    return true;
  }
  function rttyAppend(text, ch) {
    const el = $(ch === 1 ? 'rtRxB' : 'rtRx');
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    el.appendChild(document.createTextNode(text));
    if (el.textContent.length > 20000) el.textContent = el.textContent.slice(-15000);
    if (atEnd) el.scrollTop = el.scrollHeight;
  }
  function rttyLevels(m) {
    // Barres Mark / Space : 0 à 40 dB au-dessus du plancher
    const sfx = RT_SFX[m.ch === 1 ? 1 : 0];
    if (!$('rtM' + sfx)) return;
    $('rtM' + sfx).style.width = Math.max(0, Math.min(100, (m.m / 40) * 100)) + '%';
    $('rtS' + sfx).style.width = Math.max(0, Math.min(100, (m.s / 40) * 100)) + '%';
  }
  // Remplace les balises d'une macro ; <INCR> fait avancer le numéro de série (seulement si apply)
  function macroText(t, apply) {
    // Contest : échange réellement envoyé (avant que « TU » passe au numéro suivant), repris dans la fiche du QSO
    if (apply && /<EXCH>/.test(t)) { store.set('rtclastx', macroText('<EXCH>').replace(/\b5NN\b/g, '599')); store.set('rtclastxc', String(dx.call || '').trim().toUpperCase()); }
    const up = (v) => String(v || '').trim().toUpperCase();
    const d = new Date(now());
    const p2 = (n) => String(n).padStart(2, '0');
    let cntr = Number(store.get('cntr', '1')) || 1;
    if (/<DECR>/.test(t) && apply) { cntr = Math.max(1, cntr - 1); store.set('cntr', cntr); store.set('cntrcall', ''); if ($('rtcNr')) $('rtcNr').value = String(cntr).padStart(3, '0'); }
    if (/<CLRLOG>/.test(t) && apply) setTimeout(() => setDx({ call: '', name: '', qth: '', grid: '' }), 0);
    const st0 = api && api.state && api.state();
    const r0 = (st0 && st0.radio) || {};
    const fTx = r0.dualRx === 1 && r0.txVfo === 1 ? r0.freqB : r0.vfoSel === 1 && r0.freqB ? r0.freqB : r0.freq;
    const ymdL = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()), hmL = p2(d.getHours()) + p2(d.getMinutes());
    const ymdZ = d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()), hmZ = p2(d.getUTCHours()) + p2(d.getUTCMinutes());
    const tz = -d.getTimezoneOffset(), tzs = (tz >= 0 ? '+' : '-') + p2(Math.floor(Math.abs(tz) / 60)) + p2(Math.abs(tz) % 60);
    const t0 = Number(dx.t0) ? new Date(Number(dx.t0)) : d;
    let out = String(t)
      .replace(/<EXCH>|<XOUT>/g, macroCtx === 'CW' ? cwcExch() : rtcExch())
      .replace(/<TX>|<RX>|<LOG>|<CLRLOG>|<DECR>/gi, '')
      .replace(/<MYRST>/g, up(dx.rstRx) || '599')
      .replace(/<MYNAME>/g, up(store.get('rtcname', '')) || 'NOM')
      .replace(/<MYLOC4>/g, String(myGrid || '').slice(0, 4).toUpperCase())
      .replace(/<FREQ>/g, fTx ? (fTx / 1e6).toFixed(3) : '')
      .replace(/<BAND>/g, curBand(r0.dualRx === 1 ? (r0.txVfo === 1 ? 'B' : 'A') : '').toUpperCase())
      .replace(/<MODE>/g, { rtty: 'RTTY', jtty: 'JTTY', cw: 'CW', sstv: 'SSTV', jt65: 'JT65', wspr: 'WSPR' }[tab] || mode)
      .replace(/<QSOTIME>/g, p2(t0.getUTCHours()) + p2(t0.getUTCMinutes()))
      .replace(/<VER>/g, 'REMOTE STATION UBA-LGE')
      .replace(/<LT>/g, hmL).replace(/<LD>/g, ymdL).replace(/<LDT>/g, ymdL + ' ' + hmL).replace(/<ILDT>/g, ymdL + 'T' + hmL.slice(0, 2) + ':' + hmL.slice(2) + tzs)
      .replace(/<ZDT>/g, ymdZ + ' ' + hmZ + 'Z').replace(/<IZDT>/g, ymdZ + 'T' + hmZ.slice(0, 2) + ':' + hmZ.slice(2) + 'Z')
      .replace(/<CQZ>/g, String(store.get('rtcqz', '14')).padStart(2, '0'))
      .replace(/<ITUZ>/g, String(store.get('rtitu', '27')).padStart(2, '0'))
      .replace(/<MYCALL>|\{MY\}/g, myCall)
      .replace(/<CALL>|\{CALL\}/g, up(dx.call) || '???')
      .replace(/<NAME>/g, up(dx.name))
      .replace(/<QTH>/g, up(dx.qth))
      .replace(/<RST>/g, up(dx.rst) || '599')
      .replace(/<LOC>/g, up(dx.grid))
      .replace(/<MYLOC>/g, myGrid)
      .replace(/<MYQTH>/g, myQth)
      .replace(/<OPCALL>/g, opCall)
      .replace(/<ZT>/g, p2(d.getUTCHours()) + p2(d.getUTCMinutes()))
      .replace(/<ZD>/g, d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()));
    const pad3 = (n) => String(n).padStart(3, '0');
    out = out.replace(/<CNTR>|<SERNO>/g, pad3(cntr)).replace(/<LSTNO>/g, pad3(Math.max(0, cntr - 1)));
    if (/<INCR>/.test(out)) {
      // Numéro suivant (macro TU) : une seule fois par correspondant — renvoyer TU au même ne saute pas de numéro
      const who = up(dx.call) || '?';
      if (apply && store.get('cntrcall', '') !== who + '|' + cntr) {
        store.set('cntrcall', who + '|' + (cntr + 1));
        cntr++;
        store.set('cntr', cntr);
        if ($('rtcNr') && document.activeElement !== $('rtcNr')) $('rtcNr').value = pad3(cntr);
      }
      out = out.replace(/<INCR>/g, '');
    }
    return out;
  }
  function initRtty() {
    rts.forEach((r, ch) => {
      const sfx = RT_SFX[ch];
      $('rtShift' + sfx).value = String(r.shift);
      $('rtBaud' + sfx).value = String(r.baud);
      $('rtRev' + sfx).setAttribute('aria-pressed', String(r.rev));
      $('rtSq' + sfx).value = String(r.squelch);
      $('rtSqV' + sfx).textContent = String(r.squelch);
      $('rtShift' + sfx).addEventListener('change', () => { r.shift = Number($('rtShift' + sfx).value); setRttyF(r.f, ch); });
      $('rtBaud' + sfx).addEventListener('change', () => { r.baud = Number($('rtBaud' + sfx).value); saveRtty(true); drawScale(); });
      $('rtRev' + sfx).addEventListener('click', () => { r.rev = !r.rev; $('rtRev' + sfx).setAttribute('aria-pressed', String(r.rev)); saveRtty(true); drawScale(); });
      $('rtSq' + sfx).addEventListener('input', () => { $('rtSqV' + sfx).textContent = $('rtSq' + sfx).value; });
      $('rtSq' + sfx).addEventListener('change', () => { r.squelch = Number($('rtSq' + sfx).value); saveRtty(true); });
      $('rtClear' + sfx).addEventListener('click', () => { $(ch ? 'rtRxB' : 'rtRx').textContent = ''; });
      // Double-clic sur un mot reçu qui ressemble à un indicatif : il devient le correspondant
      $(ch ? 'rtRxB' : 'rtRx').addEventListener('dblclick', () => {
        const w = String(window.getSelection() || '').trim().toUpperCase();
        if (CALL_RE.test(w)) setDx({ call: w });
      });
    });
    document.querySelectorAll('.rt-center').forEach((b) => b.addEventListener('click', () => rtCenter(Number(b.dataset.ch) === 1 ? 1 : 0)));
    $('rtSpan').value = String(rtSpan);
    $('rtZoom').value = String(rtZoom);
    $('rtSpan').addEventListener('change', () => {
      rtSpan = Number($('rtSpan').value) === 4000 ? 4000 : 3000;
      store.set('rtspan', String(rtSpan));
      // Décodeurs ramenés dans la bande si elle se rétrécit
      for (const r of rts) if (r.f > rtSpan - 100 - r.shift / 2) r.f = rtSpan - 100 - r.shift / 2;
      saveRtty(true);
      applySpan(true);
      drawScale();
      if (rtSpan === 4000) api && api.say('Bande 4 kHz : ouvrez aussi le filtre du TRX (BW 4.0K), sinon le bord droit de la cascade reste noir.', '', 7000);
    });
    $('rtZoom').addEventListener('change', () => {
      rtZoom = RT_ZOOMS.indexOf(Number($('rtZoom').value)) >= 0 ? Number($('rtZoom').value) : 1;
      store.set('rtzoom', String(rtZoom));
      applySpan(true);
      drawScale();
    });
    // SPLIT : réception sur le VFO A, émission sur le VFO B (même commande que SPLIT de la ligne Step)
    $('rtSplitBtn').addEventListener('click', () => {
      if (!api || !api.iControl()) return api && api.say('Prenez la main pour mettre ou couper le SPLIT.', 'warn');
      const st = api.state();
      if (st && st.ptt && st.ptt.active) return api.say('Réglage bloqué pendant l’émission.', 'warn');
      const on = !!(st && st.radio && st.radio.split === 1);
      api.send({ t: 'set', ctl: 'split', value: on ? 0 : 1 });
    });
    // Glisser la bande ou molette sur une cascade RTTY : accord du VFO
    rtDragInit(['dgWf', 'dgScale'], 0);
    cwDragInit(['dgWf', 'dgScale']);
    cwDragInit(['ftWfB', 'ftScaleB'], 'B');
    ftDragInit(['dgWf', 'dgScale']);
    ftDragInit(['ftWfB', 'ftScaleB'], 'B');
    rtDragInit(['rtWfB', 'rtScaleB'], 1);
    // Décodeur de l'émission : bouton TX de son en-tête, ou clic n'importe où dans sa fenêtre (VFO-A / VFO-B)
    const pickTx = (ch) => {
      ch = ch === 1 ? 1 : 0;
      if (ch === rtTx) return;
      rtTx = ch;
      store.set('rttx', String(rtTx));
      if (applySpan()) drawScale();
      rtHeads();
      sendView();
      bmDraw();
      dtxState(api && api.state() && api.state().ftx);
    };
    // Bouton de la fenêtre déjà choisie (« ▶ TX ici ») : émet le texte personnalisé (comme « Émettre »), ou arrête l'émission
    document.querySelectorAll('.rt-txsel').forEach((b) => b.addEventListener('click', () => {
      const ch = Number(b.dataset.ch) === 1 ? 1 : 0;
      if (ch !== rtTx) return pickTx(ch);
      dtxClick('RTTY');
      setTimeout(rtHeads, 300);
    }));
    document.querySelectorAll('#rtDual .rt-side').forEach((side) => side.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('select, input, label, .rt-center, .rt-txsel, #rtClear, #rtClearB, .rt-wfb')) return;
      pickTx(Number(side.dataset.ch));
    }));
    // Cascade du décodeur B : clic (gauche ou droit) = caler le décodeur B
    for (const id of ['rtWfB']) { // la règle (rtScaleB) accorde le VFO-B : pas de repère au clic
      const fB = (e) => { const r = e.currentTarget.getBoundingClientRect(); return WF_LO + ((e.clientX - r.left) / r.width) * WF_MAX_HZ; };
      $(id).addEventListener('click', (e) => setRttyF(fB(e), 1));
      $(id).addEventListener('contextmenu', (e) => { e.preventDefault(); setRttyF(fB(e), 1); });
    }
    $('rtScaleB').addEventListener('contextmenu', (e) => e.preventDefault());
    // Largeur des deux décodeurs (gardée dans ce navigateur)
    const dual = $('rtDual');
    const sp = $('rtSplit');
    const setSplit = (pct, save) => {
      if (pct == null) dual.style.removeProperty('--rt-left');
      else dual.style.setProperty('--rt-left', Math.max(20, Math.min(80, pct)).toFixed(1) + '%');
      if (save) store.set('rtsplit', pct == null ? '' : Math.max(20, Math.min(80, pct)).toFixed(1));
      if (tab === 'rtty' && wf.ctx) sizeCanvas();
    };
    if (Number(store.get('rtsplit', '')) > 0) setSplit(Number(store.get('rtsplit', '')), false);
    sp.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sp.setPointerCapture(e.pointerId);
      const at = (ev) => { const r = dual.getBoundingClientRect(); return ((ev.clientX - r.left) / r.width) * 100; };
      const mv = (ev) => setSplit(at(ev), false);
      const up = (ev) => { sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up); sp.removeEventListener('pointercancel', up); setSplit(at(ev), true); };
      sp.addEventListener('pointermove', mv);
      sp.addEventListener('pointerup', up);
      sp.addEventListener('pointercancel', up);
    });
    sp.addEventListener('dblclick', () => setSplit(null, true));
    const dial = $('rtDial');
    fillList(dial, withQo(RTTY_DIAL, 'RTTY'), store.get('rtdial', '14085'));
    // Choisir une bande dans la liste y envoie directement le TRX (QSY)
    dial.addEventListener('change', () => { store.set('rtdial', dial.value); qsyTo(Number(dial.value)); });
    $('rtQsy').addEventListener('click', () => qsyTo(Number(dial.value)));
    $('rtTxClear').addEventListener('click', () => { $('rtTxt').value = ''; });
    $('rtSend').addEventListener('click', () => dtxClick('RTTY'));
    $('rtTxt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); dtxClick('RTTY'); } });
    drawRttyMacros();
    rtHeads();
  }


  // ------------------------------------------------------------------ WSPR
  const WSPR_DIAL = [['160 m', 1836.6], ['80 m', 3568.6], ['60 m', 5364.7], ['40 m', 7038.6], ['30 m', 10138.7], ['20 m', 14095.6],
    ['17 m', 18104.6], ['15 m', 21094.6], ['12 m', 24924.6], ['10 m', 28124.6], ['6 m', 50293], ['2 m', 144489], ['70 cm', 432300]];
  let wsNeedHist = true;
  const wsHist = []; // { slot, list }
  let wsLast = 0;
  // Locator Maidenhead → latitude / longitude (centre du carré)
  function grid2ll(g) {
    g = String(g || '').toUpperCase();
    if (!/^[A-R]{2}\d{2}([A-X]{2})?$/.test(g)) return null;
    let lon = (g.charCodeAt(0) - 65) * 20 - 180 + Number(g[2]) * 2;
    let lat = (g.charCodeAt(1) - 65) * 10 - 90 + Number(g[3]);
    if (g.length === 6) { lon += (g.charCodeAt(4) - 65) / 12 + 1 / 24; lat += (g.charCodeAt(5) - 65) / 24 + 1 / 48; }
    else { lon += 1; lat += 0.5; }
    return [lat, lon];
  }
  function distKm(a, b) {
    const r = Math.PI / 180;
    const d = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
    return Math.round(6371 * 2 * Math.asin(Math.sqrt(d)));
  }
  const dbmW = (dbm) => { const w = Math.pow(10, dbm / 10) / 1000; return w >= 1 ? (Math.round(w * 10) / 10) + ' W' : Math.round(w * 1000) + ' mW'; };
  function wsRow(slot, d) {
    const r = document.createElement('div');
    r.className = 'ws-row' + (stationCalls.indexOf(String(d.call).toUpperCase()) >= 0 ? ' me' : '');
    const me = grid2ll(myGrid);
    const them = grid2ll(d.grid);
    const km = me && them ? distKm(me, them) : null;
    const fmtF = d.freq > 100000 ? (d.freq / 1e6).toFixed(6) + ' MHz' : d.f + ' Hz';
    const cells = [utc(slot).slice(0, 4), (d.db >= 0 ? '+' : '') + d.db, Number(d.dt).toFixed(1), fmtF, d.drift, d.call, d.grid || '—',
      d.dbm != null ? d.dbm + ' dBm (' + dbmW(d.dbm) + ')' : '—', km != null ? km.toLocaleString('fr-BE') + ' km' : '—'];
    for (const v of cells) { const s = document.createElement('span'); s.textContent = String(v); r.appendChild(s); }
    r.title = d.msg;
    r.addEventListener('dblclick', () => setDx({ call: d.call, grid: d.grid || '', rpt: fmtRpt(d.db) }));
    return r;
  }
  const wsHistB = []; // stations WSPR du récepteur SUB (double réception)
  function wsAdd(item, B) {
    if (B) {
      const eb = $('wsListB');
      if (!eb || !ftDual) return;
      stickToBottom(eb, () => {
        if (item.list.length) eb.appendChild(sepEl(item.slot, 'WSPR'));
        for (const d of item.list) eb.appendChild(wsRow(item.slot, d));
      });
      $('wsCountB').textContent = '(' + new Set(wsHistB.flatMap((h) => h.list.map((d) => d.call))).size + ' stations)';
      return;
    }
    const el = $('wsList');
    stickToBottom(el, () => {
      if (item.list.length) el.appendChild(sepEl(item.slot, 'WSPR'));
      for (const d of item.list) el.appendChild(wsRow(item.slot, d));
    });
    $('wsCount').textContent = '(' + new Set(wsHist.flatMap((h) => h.list.map((d) => d.call))).size + ' stations)';
  }
  function wsRedraw() {
    $('wsList').textContent = '';
    for (const it of wsHist) wsAdd(it);
    if ($('wsListB')) { $('wsListB').textContent = ''; for (const it of wsHistB) wsAdd(it, true); }
  }
  function drawWsprMarks(c, w) {
    // Sous-bande WSPR (1400–1600 Hz audio)
    const x0 = (1400 / WF_MAX_HZ) * w;
    const x1 = (1600 / WF_MAX_HZ) * w;
    c.fillStyle = 'rgba(154, 120, 224, .35)';
    c.fillRect(x0, 14, x1 - x0, 16);
    c.fillStyle = '#b79cf0';
    c.fillRect(x0, 14, 1, 16);
    c.fillRect(x1 - 1, 14, 1, 16);
    const pos = (el, f, bw) => { el.style.left = (f / WF_MAX_HZ) * 100 + '%'; el.style.width = (bw / WF_MAX_HZ) * 100 + '%'; };
    pos($('dgMkRx'), 1400, 200);
    pos($('dgMkTx'), 1400, 0);
  }
  function initWspr() {
    const dial = $('wsDial');
    for (const [b, khz] of WSPR_DIAL) {
      const o = document.createElement('option');
      o.value = String(khz);
      o.textContent = b + ' · ' + khz.toLocaleString('fr-BE', { minimumFractionDigits: khz % 1 ? 1 : 0 }) + ' kHz';
      dial.appendChild(o);
    }
    dial.value = store.get('wsdial', '14095.6');
    dial.addEventListener('change', () => { store.set('wsdial', dial.value); qsyTo(Number(dial.value)); });
    $('wsQsy').addEventListener('click', () => qsyTo(Number(dial.value)));
    $('wsClear').addEventListener('click', () => { wsHist.length = 0; wsRedraw(); $('wsCount').textContent = ''; });
    $('wsClearB').addEventListener('click', () => { wsHistB.length = 0; wsRedraw(); $('wsCountB').textContent = ''; });
  }
  function wsClock() {
    const t = now() / 1000;
    const s = 120 - (t % 120);
    const st = api && api.state();
    const busy = s > 6 && t % 120 < 115;
    $('wsClock').textContent = 'Prochaine période dans ' + Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    const el = $('wsStatus');
    let txt;
    let warn = false;
    if (!st || !st.station) { txt = 'Station hors ligne'; warn = true; }
    else if (!st.audio || !st.audio.active) { txt = 'La page Station n’envoie pas la BF : « Activer l’audio » sur le PC du club'; warn = true; }
    else txt = wsLast ? 'BF reçue · dernier décodage à ' + utc(wsLast).replace(/(\d\d)(\d\d)(\d\d)/, '$1:$2') + ' UTC' : 'BF reçue · premier décodage à la fin de la période en cours' + (busy ? '' : '…');
    el.textContent = txt;
    el.classList.toggle('warn', warn);
  }

  // ------------------------------------------------------------------ JTTY (WSJT-X 3.3) : clavier à clavier, trames de 1,9 s
  // Fréquences d'appel JTTY de WSJT-X (FrequencyList) — USB / DATA-U
  const JTTY_DIAL = [['160 m', 1839], ['80 m', 3572], ['40 m', 7078], ['30 m', 10140], ['20 m', 14090], ['17 m', 18104],
    ['15 m', 21090], ['12 m', 24920], ['10 m', 28090], ['6 m', 50160], ['2 m', 144160]];
  const JT_RX_WIDTH = 80;
  let jtNeedHist = true;
  const jtMsgs = new Map(); // clé → dernière version du message { key, f, db, done, t, text }
  let jtLast = 0;
  const jtMe = (u) => String(u.text || '').toUpperCase().split(/[^A-Z0-9/]+/).some((x) => stationCalls.indexOf(x) >= 0);
  function jtRow(u, side) {
    const r = document.createElement('div');
    const up = String(u.text || '').toUpperCase();
    const me = jtMe(u);
    r.className = 'dg-row jt-row' + (me ? ' me' : /^CQ\b/.test(up) ? ' cq' : '') + (u.done ? ' done' : ' live');
    r.dataset.key = u.key;
    const cells = [utc(u.t).slice(0, 6), (u.db >= 0 ? '+' : '') + u.db, u.f, u.text + (u.done ? '' : ' ▌')];
    for (const v of cells) { const s = document.createElement('span'); s.textContent = String(v); r.appendChild(s); }
    r.title = u.f + ' Hz · ' + (u.done ? 'message terminé' : 'réception en cours') + ' · clic gauche : réception ici · clic droit : émission ici · double-clic : correspondant';
    r.addEventListener('click', () => setRx(u.f, side));
    r.addEventListener('contextmenu', (e) => { e.preventDefault(); setTx(u.f, side); });
    r.addEventListener('dblclick', () => jtPick(u, side));
    return r;
  }
  const jtInRx = (u) => Math.abs(u.f - rxF) <= JT_RX_WIDTH || jtMe(u);
  const jtInRxB = (u) => Math.abs(u.f - rxFB) <= JT_RX_WIDTH || jtMe(u);
  // Double-clic : l'indicatif du message (après CQ / DE, sinon le dernier) devient le correspondant
  function jtPick(u, side) {
    if (ftDual) setSide(side === 'B' ? 'B' : 'A', true); // émission sur le VFO de la station choisie
    const w = String(u.text || '').toUpperCase().split(/\s+/).filter(Boolean);
    const calls = w.filter((x) => CALL_RE.test(x) && stationCalls.indexOf(x) < 0);
    let call = '';
    const i = w.findIndex((x) => x === 'CQ' || x === 'DE');
    if (i >= 0) call = w.slice(i + 1).find((x) => CALL_RE.test(x) && stationCalls.indexOf(x) < 0) || '';
    if (!call) call = calls[calls.length - 1] || '';
    if (!call) { setRx(u.f, side); return api && api.say('Pas d’indicatif à reprendre dans ce message.', 'warn'); }
    const g = w.find((x) => GRID_RE.test(x) && x !== 'RR73');
    setDx({ call, grid: g || '', rpt: fmtRpt(u.db) });
    setRx(u.f, side);
  }
  // Mise à jour d'un message : la ligne existante est remplacée (le texte grandit trame après trame)
  const jtMsgsB = new Map(); // messages JTTY du récepteur SUB (double réception)
  function jtUpdateB(u) {
    if (!u || !u.key) return;
    jtMsgsB.set(u.key, u);
    if (jtMsgsB.size > 300) jtMsgsB.delete(jtMsgsB.keys().next().value);
    if (!ftDual) return;
    for (const [id, inRx] of [['jtBandB', true], ['jtRxB', jtInRxB(u)]]) {
      const box = $(id);
      if (!box) continue;
      const old = box.querySelector('[data-key="' + CSS.escape(u.key) + '"]');
      if (old) { old.replaceWith(jtRow(u, 'B')); continue; }
      if (inRx) stickToBottom(box, () => box.appendChild(jtRow(u, 'B')));
    }
  }
  function jtRedrawB() {
    const band = $('jtBandB');
    const rx = $('jtRxB');
    if (!band) return;
    band.textContent = '';
    rx.textContent = '';
    for (const u of Array.from(jtMsgsB.values()).sort((a, b) => a.t - b.t)) {
      band.appendChild(jtRow(u, 'B'));
      if (jtInRxB(u)) rx.appendChild(jtRow(u, 'B'));
    }
    band.scrollTop = band.scrollHeight;
    rx.scrollTop = rx.scrollHeight;
  }
  function jtUpdate(u) {
    if (!u || !u.key) return;
    jtMsgs.set(u.key, u);
    if (jtMsgs.size > 300) jtMsgs.delete(jtMsgs.keys().next().value);
    jtLast = Date.now();
    for (const [id, inRx] of [['jtBand', true], ['jtRx', jtInRx(u)]]) {
      const box = $(id);
      if (!box) continue;
      const old = box.querySelector('[data-key="' + CSS.escape(u.key) + '"]');
      if (old) { old.replaceWith(jtRow(u)); continue; }
      if (inRx) stickToBottom(box, () => box.appendChild(jtRow(u)));
    }
  }
  function jtRedraw() {
    const band = $('jtBand');
    const rx = $('jtRx');
    if (!band) return;
    band.textContent = '';
    rx.textContent = '';
    const list = Array.from(jtMsgs.values()).sort((a, b) => a.t - b.t);
    for (const u of list) {
      band.appendChild(jtRow(u));
      if (jtInRx(u)) rx.appendChild(jtRow(u));
    }
    band.scrollTop = band.scrollHeight;
    rx.scrollTop = rx.scrollHeight;
  }
  function insertJtty(t) {
    showTab('jtty');
    const el = $('jtTxt');
    // JTTY : une ligne, majuscules ; les retours à la ligne des macros deviennent des espaces
    const add = macroText(t, true).replace(/\s*\n\s*/g, ' ').trim().toUpperCase();
    el.value = (el.value.trim() ? el.value.trim() + ' ' : '') + add;
    el.focus();
  }
  function initJtty() {
    const dial = $('jtDial');
    for (const [b, khz] of JTTY_DIAL) {
      const o = document.createElement('option');
      o.value = String(khz);
      o.textContent = b + ' · ' + khz.toLocaleString('fr-BE') + ' kHz';
      dial.appendChild(o);
    }
    dial.value = store.get('jtdial', '14090');
    dial.addEventListener('change', () => { store.set('jtdial', dial.value); qsyTo(Number(dial.value)); });
    $('jtQsy').addEventListener('click', () => qsyTo(Number(dial.value)));
    $('jtClear').addEventListener('click', () => { jtMsgs.clear(); jtRedraw(); });
    $('jtClearB').addEventListener('click', () => { jtMsgsB.clear(); jtRedrawB(); });
    $('jtTxt').addEventListener('input', (e) => {
      const el = e.target;
      const p = el.selectionStart;
      el.value = el.value.toUpperCase();
      el.setSelectionRange(p, p);
    });
    $('jtSend').addEventListener('click', () => dtxClick('JTTY'));
    $('jtTxt').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dtxClick('JTTY'); } });
    drawMacroRow($('jtMacros'), 'JTTY', (t, ins) => useMacro('JTTY', t, ins));
  }
  function jtStatus() {
    const st = api && api.state();
    const el = $('jtStatus');
    if (!el) return;
    let txt;
    let warn = false;
    if (!st || !st.station) { txt = 'Station hors ligne'; warn = true; }
    else if (!st.audio || !st.audio.active) { txt = 'La page Station n’envoie pas la BF : « Activer l’audio » sur le PC du club'; warn = true; }
    else txt = jtLast && Date.now() - jtLast < 60000 ? 'BF reçue · réception JTTY en cours' : 'BF reçue · à l’écoute (décodage continu, 200 à 2800 Hz)';
    if (st && st.radio && st.radio.mode && !/DATA|USB|-D/i.test(st.radio.mode)) { txt += ' · mode ' + st.radio.mode + ' : passez en DATA-U'; warn = true; }
    el.textContent = txt;
    el.classList.toggle('warn', warn);
  }

  // ------------------------------------------------------------------ CW (décodeur sur le serveur, à la manière de FLDIGI)
  const CW_DIAL = [['160 m', 1830], ['80 m', 3530], ['40 m', 7025], ['30 m', 10115], ['20 m', 14030], ['17 m', 18080],
    ['15 m', 21030], ['12 m', 24900], ['10 m', 28030], ['6 m', 50090], ['2 m', 144050]];
  const cwc = (() => {
    let o;
    try { o = JSON.parse(store.get('cw', '{}')) || {}; } catch (e) { o = {}; }
    return { f: Number(o.f) || 700, bw: [50, 100, 200, 400].indexOf(o.bw) >= 0 ? o.bw : 100, squelch: Number.isFinite(o.squelch) ? o.squelch : 5 };
  })();
  // 2e décodeur : récepteur SUB (VFO-B) en double réception, ses propres réglages
  const cwcB = (() => {
    let o;
    try { o = JSON.parse(store.get('cwb', '{}')) || {}; } catch (e) { o = {}; }
    return { f: Number(o.f) || cwc.f, bw: [50, 100, 200, 400].indexOf(o.bw) >= 0 ? o.bw : cwc.bw, squelch: Number.isFinite(o.squelch) ? o.squelch : cwc.squelch };
  })();
  const cwRows = []; // dernières lignes de cascade (calage sur le signal)
  let cwDf = 6.25;   // largeur d'une case de ces lignes (Hz)
  const cwRowsB = []; // idem, cascade du VFO-B
  let cwDfB = 6.25;
  // Double réception : les réglages du décodeur A passent de la barre du haut à l'en-tête de sa colonne (comme ceux du B)
  function cwCtlPlace() {
    const ctl = $('cwCtlA');
    if (!ctl) return;
    if (ftDual && ftDualPane === 'cw') { if (ctl.parentElement !== $('cwSlotA')) $('cwSlotA').appendChild(ctl); }
    else if (ctl.nextElementSibling !== $('cwStatus')) $('cwStatus').before(ctl);
  }
  let cwLast = 0;
  function saveCw(reannounce) {
    store.set('cw', JSON.stringify(cwc));
    store.set('cwb', JSON.stringify(cwcB));
    if (reannounce) announce();
    sendView();
  }
  function drawCwMarks(c, w, side) {
    const B = side === 'B';
    const k = B ? cwcB : cwc;
    const V = ftV(side); // plage affichée (zoom à la molette)
    const X = (f) => (f - V.lo) / V.span;
    const x0 = X(k.f - k.bw / 2) * w;
    c.fillStyle = 'rgba(242, 207, 74, .35)';
    c.fillRect(x0, 14, Math.max(2, (k.bw / V.span) * w), 16);
    c.fillStyle = '#F2CF4A';
    c.fillRect(X(k.f) * w - 1, 12, 2, 18);
    const el = $(B ? 'ftMkRxB' : 'dgMkRx');
    el.style.display = k.f + k.bw / 2 < V.lo || k.f - k.bw / 2 > V.lo + V.span ? 'none' : '';
    el.style.left = X(k.f - k.bw / 2) * 100 + '%';
    el.style.width = (k.bw / V.span) * 100 + '%';
    if (B) $('ftMkTxB').style.display = 'none';
    else $('dgMkTx').style.width = '0';
    $(B ? 'cwFB' : 'cwF').textContent = Math.round(k.f);
    cwTrxDraw(c, w, side);
  }
  // Filtre du TRX (WIDTH / NAR, IF SHIFT) sur les cascades CW : deux barres bleu clair, centrées sur la tonalité CW (pitch),
  // qui suivent le TRX ; les glisser (ou Ctrl + molette sur la cascade) règle la largeur BW du TRX
  const TRXBW_PAGE = !!FACEP;
  const cwTrxPend = { A: null, B: null }; // largeur choisie ici, le temps que le TRX la relise
  function cwTrxBw(side) {
    if (!TRXBW_PAGE || !api || !api.rig || !api.state) return null;
    const st = api.state(), r = st && st.radio, R = api.rig();
    const B = side === 'B';
    if (!r || !R || !R.widthTable || (B && !ftDual)) return null;
    const md = (B ? r.modeB : r.mode) || '';
    if (!/^CW/.test(md)) return null;
    const t = R.widthTable(md);
    if (!t || !t.length) return null;
    const p = cwTrxPend[B ? 'B' : 'A'];
    const pend = p && Date.now() - p.at < 2500;
    const v = pend ? p.v : Number(r[B ? 'widthB' : 'width']) || 0;
    const nar = !pend && !!r[B ? 'narrowB' : 'narrow'];
    const ifHz = nar ? 500 : v >= 1 && t[v - 1] ? t[v - 1] : 3000; // NAR : 500 Hz en CW ; WIDTH 00 (défaut) : 3000 Hz
    const roofHz = [0, 12000, 3000, 1200, 600, 300][r[B ? 'roofB' : 'roof']] || 0; // R.FIL (filtre de toit) : limite aussi la bande
    const hz = roofHz ? Math.min(ifHz, roofHz) : ifHz;
    const sh = (Number(r[B ? 'shiftB' : 'shift']) || 0) * (/-L$/.test(md) ? -1 : 1);
    return { hz, c: (Number(r.cwPitch) || 600) + sh, t, v: nar ? t.indexOf(500) + 1 : v >= 1 ? v : t.indexOf(3000) + 1, nar };
  }
  function cwTrxDraw(c, w, side) {
    const el = $(side === 'B' ? 'cwTrxB' : 'cwTrxA');
    if (!el) return;
    const b = cwTrxBw(side);
    if (!b) { el.hidden = true; return; }
    const V = ftV(side);
    const l = (b.c - b.hz / 2 - V.lo) / V.span, r = (b.c + b.hz / 2 - V.lo) / V.span;
    if (r < 0 || l > 1) { el.hidden = true; return; }
    el.hidden = false;
    const L = Math.max(0, l), Rr = Math.min(1, r);
    el.style.left = L * 100 + '%';
    el.style.width = (Rr - L) * 100 + '%';
    el.classList.toggle('nol', l < 0);
    el.classList.toggle('nor', r > 1);
    el.classList.toggle('ro', !api.iControl());
    el.querySelector('span').textContent = (b.nar ? 'NAR ' : 'BW ') + b.hz + ' Hz';
    c.fillStyle = '#5fd8ff';
    for (const x of [l, r]) if (x >= 0 && x <= 1) c.fillRect(Math.round(x * w) - 1, 30, 2, SCALE_H - 30);
  }
  function cwTrxSet(side, v) {
    const st = api.state(), r = st && st.radio;
    if (!r || !api.iControl()) return api.say('Prenez la main pour régler le filtre (BW) du TRX.', 'warn');
    if ((st.ptt && st.ptt.active) || r.tx) return api.say('Émission en cours : filtre du TRX inchangé.', 'warn');
    const B = side === 'B';
    const C = (api.rig().CONTROL) || {};
    const nar = B ? 'narrowB' : 'narrow';
    if (r[nar] && C[nar]) api.send({ t: 'set', ctl: nar, value: 0 }); // NAR imposerait sa largeur
    api.send({ t: 'set', ctl: B ? 'widthB' : 'width', value: v });
    cwTrxPend[B ? 'B' : 'A'] = { v, at: Date.now() };
    drawScale();
  }
  let cwTrxWheelAt = 0;
  function cwTrxWheel(side, e) {
    e.preventDefault();
    const now = Date.now();
    if (now - cwTrxWheelAt < 120 || !e.deltaY) return;
    cwTrxWheelAt = now;
    const b = cwTrxBw(side);
    if (!b) return api && api.say('Filtre du TRX : ce VFO n’est pas en CW.', 'warn');
    const v = Math.max(1, Math.min(b.t.length, b.v + (e.deltaY > 0 ? -1 : 1))); // vers soi : plus étroit
    if (v !== b.v) cwTrxSet(side, v);
  }
  function cwTrxDragInit() {
    for (const side of ['A', 'B']) {
      const el = $(side === 'B' ? 'cwTrxB' : 'cwTrxA');
      if (!el) continue;
      el.querySelectorAll('b').forEach((h) => {
        let drag = null;
        h.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          if (!api || !api.iControl()) return api && api.say('Prenez la main pour régler le filtre (BW) du TRX.', 'warn');
          const b = cwTrxBw(side);
          if (!b) return;
          drag = { b, v: b.v, id: e.pointerId };
          try { h.setPointerCapture(e.pointerId); } catch (x) { /* */ }
        });
        h.addEventListener('pointermove', (e) => {
          if (!drag || e.pointerId !== drag.id) return;
          const rc = $(side === 'B' ? 'ftWfB' : 'dgWf').getBoundingClientRect();
          const V = ftV(side);
          const f = V.lo + ((e.clientX - rc.left) / (rc.width || 1)) * V.span;
          const want = 2 * Math.abs(f - drag.b.c);
          let best = 0;
          drag.b.t.forEach((x, i) => { if (Math.abs(x - want) < Math.abs(drag.b.t[best] - want)) best = i; });
          if (best + 1 === drag.v) return;
          drag.v = best + 1;
          cwTrxPend[side] = { v: drag.v, at: Date.now() }; // aperçu pendant le glisser
          drawScale();
        });
        const end = () => {
          if (!drag) return;
          const d = drag;
          drag = null;
          if (d.v !== d.b.v) cwTrxSet(side, d.v);
          else { cwTrxPend[side] = null; drawScale(); }
        };
        h.addEventListener('pointerup', end);
        h.addEventListener('pointercancel', end);
      });
    }
  }
  let cwTrxKey = '';
  function cwTrxTick() {
    const k = JSON.stringify([cwTrxBw('A'), ftDual && cwTrxBw('B'), api && api.iControl()]);
    if (k !== cwTrxKey) { cwTrxKey = k; drawScale(); }
  }
  // Clic sur la cascade : calage sur le signal le plus fort à ±60 Hz (sinon, là où l'on a cliqué)
  function setCwF(f, snap, side) {
    const B = side === 'B';
    const rows = B ? cwRowsB : cwRows;
    if (snap && rows.length) {
      const df = (B ? cwDfB : cwDf) || 6.25;
      const b0 = Math.max(0, Math.floor((f - 60) / df));
      const b1 = Math.ceil((f + 60) / df);
      let best = -1;
      let bv = -1;
      const sum = (b) => rows.reduce((a, r) => a + (r[b] || 0), 0);
      const all = [];
      for (let b = b0; b <= b1; b++) { const v = sum(b); all.push(v); if (v > bv) { bv = v; best = b; } }
      all.sort((a, b) => a - b);
      // Pic au moins 6 dB (12 octets par ligne) au-dessus de la médiane du voisinage
      if (best >= 0 && bv - all[all.length >> 1] > 12 * rows.length) f = best * df;
    }
    (B ? cwcB : cwc).f = Math.max(200, Math.min(2800, Math.round(f)));
    saveCw(true);
    drawScale();
  }
  function cwAppend(text, ch) {
    const el = $(ch === 1 ? 'cwRxB' : 'cwRx');
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    el.appendChild(document.createTextNode(text));
    // Historique limité : les plus anciens morceaux sont retirés
    let len = el.textContent.length;
    while (len > 8000 && el.firstChild) { len -= el.firstChild.textContent.length; el.removeChild(el.firstChild); }
    // Le décodage reste toujours visible ; on ne suit pas seulement pendant 10 s après que l'opérateur a remonté
    // la fenêtre pour relire (molette, ascenseur)
    if (atEnd || Date.now() - (Number(el.dataset.hold) || 0) > 10000) el.scrollTop = el.scrollHeight;
    cwLast = Date.now();
  }
  function cwLevels(m) {
    const x = m.ch === 1 ? 'B' : '', k = m.ch === 1 ? cwcB : cwc;
    if (!$('cwBar' + x)) return;
    $('cwBar' + x).style.width = Math.max(0, Math.min(100, (m.s / 30) * 100)) + '%';
    $('cwDb' + x).textContent = m.s + ' dB';
    $('cwLed' + x).classList.toggle('on', !!m.on);
    $('cwBar' + x).classList.toggle('low', m.s < k.squelch);
    if (m.s >= k.squelch) $('cwWpm' + x).textContent = String(m.wpm);
  }
  function insertCw(t) {
    showTab('cw');
    const ta = $('cwTxt');
    ta.value += cwText(t, true).toUpperCase();
    ta.scrollTop = ta.scrollHeight;
    ta.focus();
  }
  let cwKeyLine = null; // ligne d'émission en cours pour la clé de l'opérateur
  function initCw() {
    // Clé de l'opérateur (palettes / pioche branchées chez lui) : public/js/paddle.js
    if (window.RSPADDLE && $('cwKey')) {
      window.RSPADDLE.mount($('cwKey'), {
        store,
        api: {
          send: (m) => api && api.send(m),
          iControl: () => !!(api && api.iControl()),
          state: () => api && api.state(),
          say: (t, l, ms) => api && api.say(t, l, ms)
        },
        // Texte manipulé à la clé : affiché dans la fenêtre de réception CW, en couleur d'émission (comme les macros)
        echo: (t, practice) => {
          const rx = $('cwRx');
          if (!rx) return;
          if (cwKeyLine && cwKeyLine.isConnected && cwKeyLine.dataset.practice !== (practice ? '1' : '')) cwKeyLine = null;
          if (!cwKeyLine || !cwKeyLine.isConnected) {
            const d = rx.ownerDocument;
            const sp = d.createElement('span');
            sp.className = practice ? 'rt-txline cwk-practice' : 'rt-txline';
            if (practice) sp.title = 'Clé en entraînement (ou sans la main) : rien n’est émis';
            cwKeyLine = d.createElement('span');
            cwKeyLine.className = 'rt-done';
            cwKeyLine.dataset.practice = practice ? '1' : '';
            if (practice) cwKeyLine.textContent = '(entraînement) ';
            sp.append('\n', cwKeyLine, '\n');
            rx.appendChild(sp);
          }
          cwKeyLine.textContent += t;
          rx.scrollTop = rx.scrollHeight;
        },
        echoEnd: () => { cwKeyLine = null; }
      });
    }
    $('cwBw').value = String(cwc.bw);
    $('cwSq').value = String(cwc.squelch);
    $('cwSqV').textContent = String(cwc.squelch);
    $('cwBw').addEventListener('change', () => { cwc.bw = Number($('cwBw').value); saveCw(true); drawScale(); cwTrxWidth(cwc.bw); });
    $('cwSq').addEventListener('input', () => { $('cwSqV').textContent = $('cwSq').value; });
    $('cwSq').addEventListener('change', () => { cwc.squelch = Number($('cwSq').value); saveCw(true); });
    // Décodeur du VFO-B (double réception)
    $('cwBwB').value = String(cwcB.bw);
    $('cwSqB').value = String(cwcB.squelch);
    $('cwSqVB').textContent = String(cwcB.squelch);
    $('cwBwB').addEventListener('change', () => { cwcB.bw = Number($('cwBwB').value); saveCw(true); drawScale(); cwTrxWidth(cwcB.bw, 'B'); });
    $('cwSqB').addEventListener('input', () => { $('cwSqVB').textContent = $('cwSqB').value; });
    $('cwSqB').addEventListener('change', () => { cwcB.squelch = Number($('cwSqB').value); saveCw(true); });
    $('cwClearB').addEventListener('click', () => { $('cwRxB').textContent = ''; });
    $('cwRxB').addEventListener('dblclick', () => {
      const w = String(window.getSelection() || '').trim().toUpperCase();
      if (!CALL_RE.test(w)) return;
      if (ftDual) setSide('B'); // émission sur le VFO de la station choisie
      setDx({ call: w });
    });
    const sp = $('cwSpeed');
    sp.value = store.get('cwspeed', '22');
    const wmax = () => { const R = api && api.rig && api.rig(); return (R && R.CW && R.CW.wpmMax) || 60; };
    sp.addEventListener('focus', () => { sp.max = wmax(); });
    sp.addEventListener('change', () => { const v = Math.max(5, Math.min(wmax(), Math.round(Number(sp.value) || 22))); sp.value = v; store.set('cwspeed', v); });
    const dial = $('cwDial');
    fillList(dial, withQo(CW_DIAL, 'CW'), store.get('cwdial', '14030'));
    dial.addEventListener('change', () => { store.set('cwdial', dial.value); qsyTo(Number(dial.value), 'CW'); });
    $('cwQsy').addEventListener('click', () => qsyTo(Number(dial.value), 'CW'));
    $('cwClear').addEventListener('click', () => { $('cwRx').textContent = ''; });
    ['cwRx', 'cwRxB'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      const hold = () => { el.dataset.hold = String(Date.now()); };
      el.addEventListener('wheel', hold, { passive: true });
      el.addEventListener('pointerdown', (e) => { if (e.offsetX > el.clientWidth) hold(); }); // clic sur l'ascenseur
    });
    $('cwTxClear').addEventListener('click', () => { $('cwTxt').value = ''; });
    $('cwTxt').addEventListener('input', (e) => {
      const el = e.target;
      const p = el.selectionStart;
      el.value = el.value.toUpperCase();
      el.setSelectionRange(p, p);
      clearTimeout(cwPrepTimer);
      cwPrepTimer = setTimeout(() => cwPrep(el.value), 700); // texte tapé : préparé pendant la frappe
    });
    $('cwRx').addEventListener('dblclick', () => {
      const w = String(window.getSelection() || '').trim().toUpperCase();
      if (!CALL_RE.test(w)) return;
      if (ftDual) setSide('A');
      setDx({ call: w });
    });
    $('cwSend').title = 'Émet le texte en CW par le manipulateur du TRX (vitesse ci-dessus), puis retour en réception · pendant l’émission : arrêt';
    $('cwSend').addEventListener('click', () => cwClick());
    $('cwStop').addEventListener('click', () => { if (api) api.send({ t: 'cw_stop' }); });
    $('cwTxt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); cwClick(); } });
    drawMacroRow($('cwMacros'), 'CW', (t, ins) => useMacro('CW', t, ins), cwPrepMacro);
  }
  function cwStatus() {
    const st = api && api.state();
    const el = $('cwStatus');
    if (!el) return;
    let txt;
    let warn = false;
    if (!st || !st.station) { txt = 'Station hors ligne'; warn = true; }
    else if (!st.audio || !st.audio.active) { txt = 'La page Station n’envoie pas la BF : « Activer l’audio » sur le PC du club'; warn = true; }
    else txt = cwLast && Date.now() - cwLast < 20000 ? 'BF reçue · décodage en cours' : 'BF reçue · cliquez sur un signal CW dans la cascade';
    if (st && st.radio && st.radio.mode && !/CW/i.test(st.radio.mode)) txt += ' · TRX en ' + st.radio.mode + ' (CW conseillé : filtre étroit, tonalité = pitch)';
    el.textContent = txt;
    el.classList.toggle('warn', warn);
  }

  // ------------------------------------------------------------------ SSTV : réception (décodeur du serveur) et préparation des images à émettre
  const SSTV_DIAL = [['80 m', 3735], ['40 m', 7165], ['20 m', 14230], ['20 m (2)', 14233], ['17 m', 18160], ['15 m', 21340], ['12 m', 24975], ['10 m', 28680], ['6 m', 50510]];
  let ssNeedHist = true;
  const ssImgs = new Map(); // id → { meta, data: ImageData | null }
  let ssShown = 0;
  let ssLive = 0;
  let ssLast = 0;
  function ssCanvasFor(meta) {
    const c = $('ssCanvas');
    if (c.width !== meta.w || c.height !== meta.h) { c.width = meta.w; c.height = meta.h; }
    return c.getContext('2d');
  }
  function ssShow(id) {
    const it = ssImgs.get(id);
    if (!it) return;
    ssShown = id;
    const ctx = ssCanvasFor(it.meta);
    if (it.data) ctx.putImageData(it.data, 0, 0);
    else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, it.meta.w, it.meta.h); api.send({ t: 'sstv_get', id }); }
    $('ssEmpty').hidden = true;
    ssCaption();
    ssGallery();
  }
  function ssCaption() {
    const it = ssImgs.get(ssShown);
    if (!it) { $('ssCap').textContent = ''; return; }
    const m = it.meta;
    $('ssCap').textContent = m.name + ' · ' + utc(m.at).replace(/(\d\d)(\d\d)(\d\d)/, '$1:$2') + ' UTC' + (m.done ? (m.ok ? '' : ' · incomplète') : ' · en cours');
  }
  function ssGallery() {
    const g = $('ssGal');
    if (!g) return;
    g.textContent = '';
    const list = Array.from(ssImgs.values()).sort((a, b) => b.meta.at - a.meta.at);
    for (const it of list) {
      const c = document.createElement('canvas');
      c.width = 96;
      c.height = Math.round(96 * it.meta.h / it.meta.w);
      c.className = 'ss-thumb' + (it.meta.id === ssShown ? ' sel' : '');
      c.title = it.meta.name + ' · ' + utc(it.meta.at).replace(/(\d\d)(\d\d)(\d\d)/, '$1:$2') + ' UTC';
      const x = c.getContext('2d');
      if (it.data) { const t = document.createElement('canvas'); t.width = it.meta.w; t.height = it.meta.h; t.getContext('2d').putImageData(it.data, 0, 0); x.drawImage(t, 0, 0, c.width, c.height); }
      else if (it.thumb) {
        // Vignette envoyée par le serveur (image complète chargée au clic)
        const raw = atob(it.thumb.b64);
        const id = new ImageData(it.thumb.w, it.thumb.h);
        for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) { id.data[j] = raw.charCodeAt(i); id.data[j + 1] = raw.charCodeAt(i + 1); id.data[j + 2] = raw.charCodeAt(i + 2); id.data[j + 3] = 255; }
        const t = document.createElement('canvas'); t.width = it.thumb.w; t.height = it.thumb.h; t.getContext('2d').putImageData(id, 0, 0);
        x.drawImage(t, 0, 0, c.width, c.height);
      } else { x.fillStyle = '#10161f'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#8b98a8'; x.font = '10px sans-serif'; x.fillText(it.meta.mode, 6, 14); }
      c.addEventListener('click', () => ssShow(it.meta.id));
      g.appendChild(c);
    }
  }
  function ssAdd(meta) {
    const old = ssImgs.get(meta.id);
    if (old) { old.meta = meta; return old; }
    const it = { meta, data: null };
    ssImgs.set(meta.id, it);
    while (ssImgs.size > 12) ssImgs.delete(Array.from(ssImgs.values()).sort((a, b) => a.meta.at - b.meta.at)[0].meta.id);
    return it;
  }
  // Trame binaire 0x11 : une ligne d'image
  function ssLine(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const id = dv.getUint32(1);
    const y = dv.getUint16(5);
    const w = dv.getUint16(7);
    const it = ssImgs.get(id);
    if (!it || w !== it.meta.w || y >= it.meta.h) return;
    if (!it.data) it.data = new ImageData(it.meta.w, it.meta.h);
    const d = it.data.data;
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; d[o] = b[9 + x * 3]; d[o + 1] = b[10 + x * 3]; d[o + 2] = b[11 + x * 3]; d[o + 3] = 255; }
    if (id === ssShown && tab === 'sstv') {
      const ctx = ssCanvasFor(it.meta);
      ctx.putImageData(it.data, 0, 0, 0, y, w, 1);
    }
    if (id === ssLive) {
      it.meta.lines = Math.max(it.meta.lines || 0, y + 1);
      ssProgress(it.meta);
    }
    if (y === it.meta.h - 1 || (y % 32 === 31 && id === ssShown)) ssGallery();
  }
  function ssProgress(meta) {
    const p = meta ? Math.min(100, Math.round((meta.lines / meta.h) * 100)) : 0;
    if ($('ssProg')) { $('ssProg').style.width = p + '%'; $('ssProgT').textContent = meta && !meta.done ? meta.name + ' · ligne ' + meta.lines + ' / ' + meta.h : ''; }
  }
  function ssSave() {
    const it = ssImgs.get(ssShown);
    if (!it || !it.data) return api && api.say('Pas d’image à enregistrer.', 'warn');
    const c = document.createElement('canvas');
    c.width = it.meta.w;
    c.height = it.meta.h;
    c.getContext('2d').putImageData(it.data, 0, 0);
    const d = new Date(it.meta.at);
    const p2 = (n) => String(n).padStart(2, '0');
    const name = 'SSTV-' + d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + '-' + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + '-' + it.meta.mode + '.png';
    c.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }, 'image/png');
  }
  function ssMessage(m) {
    if (m.t === 'sstv_list') {
      for (const meta of m.items || []) { const th = meta.thumb; delete meta.thumb; const it = ssAdd(meta); if (th) it.thumb = th; }
      const last = (m.items || []).slice(-1)[0];
      if (last && !ssShown) ssShow(last.id); else ssGallery();
      return true;
    }
    if (m.t === 'sstv_img') {
      const it = ssAdd(m.img);
      it.data = new ImageData(m.img.w, m.img.h);
      if (ssShown === m.img.id) ssCanvasFor(m.img);
      return true;
    }
    if (m.t === 'sstv_start') {
      const it = ssAdd(m.img);
      it.data = new ImageData(m.img.w, m.img.h);
      ssLive = m.img.id;
      ssLast = Date.now();
      ssShown = m.img.id;
      const ctx = ssCanvasFor(m.img);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, m.img.w, m.img.h);
      $('ssEmpty').hidden = true;
      ssCaption();
      ssGallery();
      ssProgress(m.img);
      if (api) api.say('SSTV : réception d’une image ' + m.img.name + (m.shift ? ' (décalage ' + (m.shift > 0 ? '+' : '') + m.shift + ' Hz)' : ''), 'ok', 4000);
      return true;
    }
    if (m.t === 'sstv_end') {
      const it = ssAdd(m.img);
      if (ssLive === m.img.id) ssLive = 0;
      ssLast = Date.now();
      ssProgress(null);
      // Image redressée par le serveur (pente corrigée) : on la recharge
      if (m.refreshed) { it.data = null; if (ssShown === m.img.id) api.send({ t: 'sstv_get', id: m.img.id }); }
      ssCaption();
      ssGallery();
      return true;
    }
    return false;
  }
  function drawSstvMarks(c, w) {
    const X = (f) => (f / WF_MAX_HZ) * w;
    c.fillStyle = 'rgba(154, 120, 224, .3)';
    c.fillRect(X(1500), 14, X(2300) - X(1500), 16);
    c.fillStyle = '#b79cf0';
    c.fillRect(X(1500), 14, 1, 16);
    c.fillRect(X(2300) - 1, 14, 1, 16);
    c.fillStyle = '#F2CF4A';
    c.fillRect(X(1200) - 1, 12, 2, 18);
    const pos = (el, f, bw) => { el.style.left = (f / WF_MAX_HZ) * 100 + '%'; el.style.width = (bw / WF_MAX_HZ) * 100 + '%'; };
    pos($('dgMkRx'), 1500, 800);
    pos($('dgMkTx'), 1200, 0);
  }
  function sstvStatus() {
    const st = api && api.state();
    const el = $('ssStatus');
    if (!el) return;
    let txt;
    let warn = false;
    if (!st || !st.station) { txt = 'Station hors ligne'; warn = true; }
    else if (!st.audio || !st.audio.active) { txt = 'La page Station n’envoie pas la BF : « Activer l’audio » sur le PC du club'; warn = true; }
    else txt = ssLive ? 'BF reçue · réception en cours' : 'BF reçue · en attente d’une image (code VIS)';
    if (st && st.radio && st.radio.mode && /CW|AM|LSB/i.test(st.radio.mode)) { txt += ' · mode ' + st.radio.mode + ' : SSTV en USB / DATA-U'; warn = true; }
    el.textContent = txt;
    el.classList.toggle('warn', warn);
  }

  // --- Préparation de l'image à émettre : images du PC, texte par-dessus, aperçu au format du mode
  const SS_TX_MODES = ['M1', 'M2', 'S1', 'S2', 'SDX', 'R36', 'R72', 'PD50', 'PD90', 'PD120', 'PD160', 'PD180', 'PD240', 'PD290'];
  let ssSrc = []; // { name, url } (images du PC, réduites, gardées dans ce navigateur)
  try { ssSrc = JSON.parse(store.get('sstvsrc', '[]')) || []; } catch (e) { ssSrc = []; }
  let ssSel = store.get('sstvsel', 'cq');
  const ssImgCache = new Map();
  function ssSaveSrc() {
    // Stockage local limité : on retire les plus anciennes si nécessaire
    for (;;) {
      try { localStorage.setItem('rs.dg.sstvsrc', JSON.stringify(ssSrc)); return; } catch (e) { if (!ssSrc.length) return; ssSrc.shift(); }
    }
  }
  function ssLoadFiles(files) {
    for (const f of Array.from(files || []).slice(0, 10)) {
      if (!/^image\//.test(f.type)) continue;
      const rd = new FileReader();
      rd.onload = () => {
        const im = new Image();
        im.onload = () => {
          // Réduite à 800 × 616 au plus (plus grand format SSTV), en JPEG
          const k = Math.min(1, 800 / im.width, 616 / im.height);
          const c = document.createElement('canvas');
          c.width = Math.round(im.width * k);
          c.height = Math.round(im.height * k);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          const url = c.toDataURL('image/jpeg', 0.85);
          ssSrc.push({ name: f.name.slice(0, 60), url });
          while (ssSrc.length > 10) ssSrc.shift();
          ssSel = 'u' + (ssSrc.length - 1);
          store.set('sstvsel', ssSel);
          ssSaveSrc();
          ssThumbs();
          ssCompose();
        };
        im.src = rd.result;
      };
      rd.readAsDataURL(f);
    }
  }
  function ssImage(url, cb) {
    if (ssImgCache.has(url)) { const im = ssImgCache.get(url); if (im.complete) return cb(im); im.addEventListener('load', () => cb(im)); return; }
    const im = new Image();
    im.onload = () => cb(im);
    im.src = url;
    ssImgCache.set(url, im);
  }
  function ssThumbs() {
    const box = $('ssThumbs');
    if (!box) return;
    box.textContent = '';
    const mk = (key, title, draw) => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 48;
      c.className = 'ss-thumb' + (ssSel === key ? ' sel' : '');
      c.title = title;
      draw(c.getContext('2d'), c);
      c.addEventListener('click', () => { ssSel = key; store.set('sstvsel', key); ssThumbs(); ssCompose(); });
      box.appendChild(c);
      return c;
    };
    mk('cq', 'Carte CQ (fond dégradé)', (x, c) => { ssBackground(x, c.width, c.height); });
    mk('bars', 'Mire de couleurs', (x, c) => { ssBars(x, c.width, c.height); });
    if (ssShown && ssImgs.get(ssShown) && ssImgs.get(ssShown).data) mk('rx', 'Image reçue affichée à gauche', (x, c) => { const it = ssImgs.get(ssShown); const t = document.createElement('canvas'); t.width = it.meta.w; t.height = it.meta.h; t.getContext('2d').putImageData(it.data, 0, 0); x.drawImage(t, 0, 0, c.width, c.height); });
    ssSrc.forEach((s, i) => {
      const c = mk('u' + i, s.name + ' (clic droit : retirer)', (x, cv) => ssImage(s.url, (im) => ssCover(x, im, cv.width, cv.height)));
      c.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        ssSrc.splice(i, 1);
        ssSaveSrc();
        if (ssSel === 'u' + i) ssSel = 'cq';
        ssThumbs();
        ssCompose();
      });
    });
  }
  function ssBackground(x, w, h) {
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0a2a6b');
    g.addColorStop(0.55, '#1b6fb3');
    g.addColorStop(1, '#f0a020');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  }
  function ssBars(x, w, h) {
    const cols = ['#fff', '#ff0', '#0ff', '#0f0', '#f0f', '#f00', '#00f', '#000'];
    cols.forEach((c, i) => { x.fillStyle = c; x.fillRect(Math.floor(i * w / 8), 0, Math.ceil(w / 8), h * 0.7); });
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#000');
    g.addColorStop(1, '#fff');
    x.fillStyle = g;
    x.fillRect(0, h * 0.7, w, h * 0.3);
  }
  // Image recadrée pour remplir tout le format (comme « remplir » d'un fond d'écran)
  function ssCover(x, im, w, h) {
    const k = Math.max(w / im.width, h / im.height);
    const iw = im.width * k;
    const ih = im.height * k;
    x.drawImage(im, (w - iw) / 2, (h - ih) / 2, iw, ih);
  }
  function ssCompose() {
    const c = $('ssCompose');
    if (!c) return;
    const m = SSTV.MODES[$('ssTxMode').value] || SSTV.MODES.M1;
    if (c.width !== m.w || c.height !== m.h) { c.width = m.w; c.height = m.h; }
    const x = c.getContext('2d');
    const w = m.w;
    const h = m.h;
    const texts = () => {
      const size = Math.round(h * (Number($('ssSize').value) || 0.1));
      x.font = '700 ' + size + 'px "Roboto", "Arial", sans-serif';
      x.textAlign = 'center';
      x.lineJoin = 'round';
      const lines = [[$('ssT0').value, size * 1.05, 'top'], [$('ssT1').value, h / 2, 'middle'], [$('ssT2').value, h - size * 0.5, 'bottom']];
      for (const [t, y, base] of lines) {
        // Sans correspondant : « CQ » à la place de « ??? »
        const txt = macroText(String(t || ''), false).replace(/\?\?\?/g, 'CQ').replace(/\s*\n\s*/g, ' ').replace(/^[\s·\-–]+|[\s·\-–]+$/g, '').trim();
        if (!txt) continue;
        x.textBaseline = base === 'top' ? 'middle' : base === 'bottom' ? 'alphabetic' : 'middle';
        const yy = base === 'top' ? size * 0.75 : y;
        x.lineWidth = Math.max(3, size / 6);
        x.strokeStyle = '#000';
        x.strokeText(txt, w / 2, yy, w * 0.96);
        x.fillStyle = $('ssColor').value || '#ffe14a';
        x.fillText(txt, w / 2, yy, w * 0.96);
      }
    };
    const sel = ssSel;
    if (sel === 'bars') { ssBars(x, w, h); texts(); }
    else if (sel === 'rx' && ssImgs.get(ssShown) && ssImgs.get(ssShown).data) {
      const it = ssImgs.get(ssShown);
      const t = document.createElement('canvas');
      t.width = it.meta.w;
      t.height = it.meta.h;
      t.getContext('2d').putImageData(it.data, 0, 0);
      ssCover(x, t, w, h);
      texts();
    } else if (/^u\d+$/.test(sel) && ssSrc[Number(sel.slice(1))]) {
      ssImage(ssSrc[Number(sel.slice(1))].url, (im) => { if (ssSel !== sel) return; ssCover(x, im, w, h); texts(); });
    } else { ssBackground(x, w, h); texts(); }
    const d = SSTV.duration(m.id);
    $('ssDur').textContent = m.w + ' × ' + m.h + ' · ' + Math.floor(d / 60) + ' min ' + String(Math.round(d % 60)).padStart(2, '0') + ' s';
  }
  function ssSignal(rate) {
    const c = $('ssCompose');
    const id = $('ssTxMode').value;
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    return SSTV.encode(id, px, rate, 4);
  }
  // ------------------------------------------------------------------ émission SSTV par le TRX
  // L'image composée (au format du mode) part au serveur par morceaux, qui fabrique le signal et le confie à la page Station,
  // comme RTTY / JTTY. Pendant l'émission, la partie de l'image pas encore émise est assombrie, ligne après ligne.
  var ssTx = null;
  var ssTxTimer = null;
  function ssSendClick() {
    if (!api) return;
    const st = api.state();
    const x = st && st.ftx;
    if (x && x.mode === 'SSTV') return api.send({ t: 'ftx_stop' });
    if (st && (x || (st.ptt && st.ptt.active) || st.cw)) return api.say('Émission en cours : attendez la fin (ou « ■ Arrêter »).', 'warn');
    if (!api.iControl()) return api.say('Prenez la main pour émettre.', 'warn');
    if (ssPlayer) ssPlay(); // arrêt de l'écoute locale
    ssCompose();
    const c = $('ssCompose');
    const id = $('ssTxMode').value;
    const M = SSTV.MODES[id];
    if (!M || c.width !== M.w || c.height !== M.h) return api.say('Image pas prête : réessayez.', 'warn');
    const px = c.getContext('2d').getImageData(0, 0, M.w, M.h).data;
    const rgb = new Uint8Array(M.w * M.h * 3);
    for (let i = 0, j = 0; i < px.length; i += 4) { rgb[j++] = px[i]; rgb[j++] = px[i + 1]; rgb[j++] = px[i + 2]; }
    // Morceaux de 42 000 octets (≈ 56 Ko en base64, sous la limite de 64 Ko par message)
    const CH = 42000;
    const n = Math.ceil(rgb.length / CH);
    const up = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    for (let i = 0; i < n; i++) {
      const part = rgb.subarray(i * CH, Math.min(rgb.length, (i + 1) * CH));
      let bin = '';
      for (let k = 0; k < part.length; k += 8192) bin += String.fromCharCode.apply(null, part.subarray(k, k + 8192));
      api.send({ t: 'sstv_up', id: up, i, n, data: btoa(bin) });
    }
    api.send({ t: 'dtx', mode: 'SSTV', sstv: id, up });
    api.say('Image ' + M.name + ' envoyée au serveur, préparation de l’émission…', 'info');
  }
  function ssTxState(x) {
    const b = $('ssSend');
    const note = $('ssTxState');
    const mask = $('ssTxMask');
    if (!b || !note) return;
    const mine = !!(x && x.mode === 'SSTV');
    b.textContent = mine ? '■ Arrêter' : 'Émettre';
    b.classList.toggle('on-air', mine && x.state === 'tx');
    note.classList.toggle('air', mine && x.state === 'tx');
    if (mine) {
      const M = SSTV.MODES[x.sstv] || null;
      ssTx = { x, M };
      if (!ssTxTimer) ssTxTimer = setInterval(ssTxTick, 250);
      ssTxTick();
    } else {
      if (ssTxTimer) { clearInterval(ssTxTimer); ssTxTimer = null; }
      ssTx = null;
      if (mask) mask.hidden = true;
      if (!note.querySelector('.dg-txcall')) {
        note.innerHTML = 'Émission SSTV sous <b class="dg-txcall"></b> : VFO d\'émission en DATA-U, puissance réduite conseillée (émission continue). Images : 800 × 600 conseillé · clic droit sur une vignette : la retirer · glisser-déposer accepté.';
        note.querySelector('.dg-txcall').textContent = myCall;
      }
    }
  }
  function ssTxTick() {
    const T = ssTx;
    const note = $('ssTxState');
    const mask = $('ssTxMask');
    if (!T || !note) return;
    const x = T.x;
    const M = T.M;
    const name = M ? M.name : 'SSTV';
    if (x.state !== 'tx') {
      note.textContent = 'Préparation de l’émission SSTV (' + name + ', ' + Math.round(x.seconds || 0) + ' s) : signal envoyé à la page Station…';
      if (mask) { mask.hidden = !M; if (M) ssMask(mask, 0, M); }
      return;
    }
    const t = (now() - x.at) / 1000;
    const left = Math.max(0, Math.ceil((x.seconds || 0) - t));
    let frac = 0;
    if (M) {
      const head = (8 * 100 + 300 + 10 + 300 + 300 + (M.first ? M.first[0][1] : 0)) / 1000;
      const body = M.line * M.h / M.rows / 1000;
      frac = Math.max(0, Math.min(1, (t - head) / body));
    }
    note.textContent = '● En émission SSTV (' + x.by + ', ' + name + ') — ' + (t < 1.6 ? 'en-tête VIS' : 'ligne ' + Math.round(frac * (M ? M.h : 0)) + ' / ' + (M ? M.h : '?')) + ' · fin dans ' + Math.floor(left / 60) + ' min ' + String(left % 60).padStart(2, '0') + ' s';
    if (mask && M) { mask.hidden = false; ssMask(mask, frac, M); }
  }
  /** Assombrit la partie de l'image pas encore émise (sous la ligne en cours), dans le cadre réel de l'image affichée. */
  function ssMask(mask, frac, M) {
    const box = mask.parentElement.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const k = Math.min(box.width / M.w, box.height / M.h);
    const iw = M.w * k;
    const ih = M.h * k;
    const left = (box.width - iw) / 2;
    const top = (box.height - ih) / 2;
    mask.style.left = left + 'px';
    mask.style.width = iw + 'px';
    mask.style.top = (top + ih * frac) + 'px';
    mask.style.height = Math.max(0, ih * (1 - frac)) + 'px';
  }
  let ssPlayer = null;
  function ssPlay() {
    if (ssPlayer) { try { ssPlayer.src.stop(); ssPlayer.ctx.close(); } catch (e) {} ssPlayer = null; $('ssPlay').textContent = '▶ Écouter'; return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const sig = ssSignal(ctx.sampleRate);
    const buf = ctx.createBuffer(1, sig.length, ctx.sampleRate);
    buf.copyToChannel(sig, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    src.connect(g).connect(ctx.destination);
    src.onended = () => { if (ssPlayer && ssPlayer.src === src) { ssPlayer = null; $('ssPlay').textContent = '▶ Écouter'; try { ctx.close(); } catch (e) {} } };
    src.start();
    ssPlayer = { ctx, src };
    $('ssPlay').textContent = '■ Arrêter';
  }
  function ssWav() {
    const rate = 12000;
    const sig = ssSignal(rate);
    const b = new ArrayBuffer(44 + sig.length * 2);
    const v = new DataView(b);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + sig.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, sig.length * 2, true);
    for (let i = 0; i < sig.length; i++) v.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.round(sig[i] * 32767))), true);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
    a.download = 'SSTV-' + $('ssTxMode').value + '.wav';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function initSstv() {
    const dial = $('ssDial');
    for (const [b, khz] of SSTV_DIAL) {
      const o = document.createElement('option');
      o.value = String(khz);
      o.textContent = b + ' · ' + khz.toLocaleString('fr-BE') + ' kHz';
      dial.appendChild(o);
    }
    dial.value = store.get('ssdial', '14230');
    dial.addEventListener('change', () => { store.set('ssdial', dial.value); qsyTo(Number(dial.value)); });
    $('ssQsy').addEventListener('click', () => qsyTo(Number(dial.value)));
    $('ssSave').addEventListener('click', ssSave);
    const tm = $('ssTxMode');
    for (const id of SS_TX_MODES) { const o = document.createElement('option'); o.value = id; o.textContent = SSTV.MODES[id].name; tm.appendChild(o); }
    tm.value = store.get('sstvtx', 'M1');
    tm.addEventListener('change', () => { store.set('sstvtx', tm.value); ssCompose(); });
    const defs = ['<CALL> DE <MYCALL>', '', 'UR <RST> · <MYLOC>'];
    ['ssT0', 'ssT1', 'ssT2'].forEach((id, i) => {
      const el = $(id);
      el.value = store.get(id, defs[i]);
      el.addEventListener('input', () => { store.set(id, el.value); ssCompose(); });
      el.addEventListener('focus', () => { ssFocus = el; });
    });
    $('ssSize').value = store.get('sssize', '0.1');
    $('ssSize').addEventListener('change', () => { store.set('sssize', $('ssSize').value); ssCompose(); });
    $('ssColor').value = store.get('sscolor', '#ffe14a');
    $('ssColor').addEventListener('input', () => { store.set('sscolor', $('ssColor').value); ssCompose(); });
    // Balises : ajoutées dans la dernière ligne de texte utilisée
    let ssFocus = $('ssT0');
    for (const t of ['<CALL>', '<MYCALL>', '<RST>', '<NAME>', '<MYLOC>', '<ZT>']) {
      const b = document.createElement('button');
      b.className = 'dg-mini';
      b.type = 'button';
      b.textContent = t;
      b.title = 'Ajouter ' + t + ' au texte';
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { ssFocus.value = (ssFocus.value ? ssFocus.value + ' ' : '') + t; store.set(ssFocus.id, ssFocus.value); ssCompose(); });
      $('ssTags').appendChild(b);
    }
    $('ssFile').addEventListener('change', (e) => { ssLoadFiles(e.target.files); e.target.value = ''; });
    $('ssPlay').addEventListener('click', ssPlay);
    $('ssWav').addEventListener('click', ssWav);
    $('ssSend').title = 'Émet l’image ci-contre par le TRX (VFO d’émission en DATA-U) · pendant l’émission : arrêt (ou Échap)';
    $('ssSend').addEventListener('click', ssSendClick);
    // Glisser-déposer d'images sur la zone d'émission
    const zone = document.querySelector('.ss-tx');
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drop'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drop'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drop'); ssLoadFiles(e.dataTransfer.files); });
    ssThumbs();
    ssCompose();
  }

  // ------------------------------------------------------------------ correspondant (ligne sous les onglets) et messages Tx1 à Tx7
  // Correspondant commun à tous les modes (bas du dashboard, fenêtre RTTY, fenêtre séparée : synchronisés)
  let myCall = 'ON5VL';
  let myGrid = '';
  let myQth = '';
  let opCall = '';
  const loadDx = () => { try { return Object.assign({ call: '', grid: '', rpt: '-10', rptRx: '', name: '', qth: '', rst: '599', rstRx: '599' }, JSON.parse(store.get('dx', '{}')) || {}); } catch (e) { return { call: '', grid: '', rpt: '-10', rptRx: '', name: '', qth: '', rst: '599', rstRx: '599' }; } };
  let dx = loadDx();
  let ftxSel = Number(store.get('ftxsel', '5')) || 0;
  const CALL_RE = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}[A-Z](\/[A-Z0-9]+)?$/;
  const GRID_RE = /^[A-R]{2}[0-9]{2}([A-X]{2})?$/;
  const fmtRpt = (db) => (db >= 0 ? '+' : '-') + String(Math.min(30, Math.abs(Math.round(db)))).padStart(2, '0');
  function setDx(o) {
    const before = loadDx();
    // Nouveau correspondant : son prénom et son QTH repartent à vide
    if (o.call != null && String(o.call).toUpperCase() !== String(before.call).toUpperCase() && o.name == null) { before.name = ''; before.qth = ''; }
    // Nouveau correspondant : reports reçus remis à zéro
    if (o.call != null && String(o.call).toUpperCase() !== String(before.call).toUpperCase()) { if (o.rptRx == null) before.rptRx = ''; if (o.rstRx == null) before.rstRx = '599'; }
    const newCall = o.call != null && String(o.call).trim() && String(o.call).toUpperCase() !== String(before.call || '').toUpperCase();
    dx = Object.assign(before, o);
    dx.call = String(dx.call || '').toUpperCase().slice(0, 12);
    // Début du QSO (heure UTC pour le carnet) : quand le correspondant est choisi
    if (newCall) dx.t0 = now();
    dx.grid = String(dx.grid || '').toUpperCase().slice(0, 6);
    store.set('dx', JSON.stringify(dx));
    syncDx();
    // Nouveau correspondant : nom, QTH (et locator) cherchés sur QRZ.com, un instant après la dernière frappe
    if (newCall) qrzAsk(dx.call);
  }
  let qrzTimer = null;
  let qrzWarned = false;
  function qrzAsk(call) {
    clearTimeout(qrzTimer);
    if (!api || !CALL_RE.test(String(call || '').replace(/\/.*$/, ''))) return;
    qrzTimer = setTimeout(() => api.send({ t: 'qrz', call }), 900);
  }
  // Fiche QRZ.com reçue : on ne remplit que les cases vides du correspondant
  function qrzInfo(m) {
    if (!m || String(m.call).toUpperCase() !== String(dx.call).toUpperCase()) return;
    if (!m.ok) {
      if (!m.off && m.msg && !qrzWarned) { qrzWarned = true; api.say('QRZ.com : ' + m.msg.replace(/^QRZ\.com : /, ''), 'warn', 6000); }
      return;
    }
    const v = m.info || {};
    const o = {};
    const first = (v.nick || v.fname || '').split(/\s+/)[0];
    if (!dx.name && first) o.name = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    if (!dx.qth && v.qth) o.qth = v.qth;
    if (!dx.grid && v.grid) o.grid = v.grid.slice(0, 6);
    if (Object.keys(o).length) setDx(o);
    api.say('QRZ.com : ' + m.call + ' — ' + [[v.fname, v.name].filter(Boolean).join(' '), v.qth, v.country].filter(Boolean).join(', '), '', 6000);
  }
  function syncDx() {
    const put = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
    put('dxCall', dx.call);
    put('dxGrid', dx.grid);
    put('dxRpt', dx.rpt);
    put('rtCall', dx.call);
    put('dxName', dx.name || '');
    put('dxQth', dx.qth || '');
    put('dxRst', dx.rst || '599');
    put('dxRptRx', dx.rptRx || '');
    put('dxRstRx', dx.rstRx || '599');
    drawMsgs();
  }
  window.addEventListener('storage', (e) => { if (e.key === 'rs.dg.dx') { dx = loadDx(); syncDx(); } });
  // Double-clic sur un message FT8/FT4 : son émetteur devient le correspondant (comme dans WSJT-X)
  // Période du correspondant (parité du créneau de son message) : on émet dans l'autre période
  let dxPar = null;
  const SLOT_MS = { FT8: 15000, FT4: 7500, FT2: 3750 };
  function pickFromDecode(d, slot, side) {
    if (ftDual) { ftSide = side === 'B' ? 'B' : 'A'; sideBtns(); } // TX automatique sur le VFO de la station appelée
    if (slot && SLOT_MS[mode]) dxPar = { mode, call: '', parity: Math.round(slot / SLOT_MS[mode]) % 2 };
    let w = d.msg.toUpperCase().split(/\s+/).map((x) => x.replace(/^<|>$/g, ''));
    // Message DXpédition du FOX : la partie qui nous concerne (ou la 2e), réécrite « DESTINATAIRE FOX CONTENU »
    const fx = foxOf(d.msg);
    if (fx) {
      const t = d.msg.toUpperCase().split(/\s+/);
      w = stationCalls.indexOf(t[0]) >= 0 ? [t[0], fx, 'RR73'] : [t[2], fx, t[4]];
    }
    let call = '';
    if (w[0] === 'CQ') call = CALL_RE.test(w[1] || '') ? w[1] : (w[2] || '');
    else call = w[1] || '';
    if (!CALL_RE.test(call)) return api && api.say('Pas d’indicatif à reprendre dans ce message.', 'warn');
    const last = w[w.length - 1];
    setDx({ call, grid: GRID_RE.test(last) && last !== 'RR73' ? last : '', rpt: fmtRpt(d.db) });
    if (dxPar) dxPar.call = call;
    setRx(d.f, side);
    // Message suivant comme WSJT-X : réponse à un CQ → Tx1 ; message qui nous est adressé → selon son contenu
    const toMe = stationCalls.indexOf(w[0]) >= 0;
    const p = toMe ? (w[2] || '') : '';
    ftxSel = !toMe ? 0 : GRID_RE.test(p) && p !== 'RR73' ? 1 : /^[+-]\d{2}$/.test(p) ? 2 : /^R[+-]\d{2}$/.test(p) ? 3 : /^(RRR|RR73)$/.test(p) ? 4 : p === '73' ? 4 : 0;
    // HOUND : appel du FOX (Tx1), ou R + report (Tx3) s'il nous a déjà donné un report ; son RR73 : rien à envoyer
    if (houndOn()) {
      if (toMe && /^(RRR|RR73|73)$/.test(p)) { drawMsgs(); return api && api.say('Le FOX ' + call + ' vous a confirmé le QSO (RR73).', '', 5000); }
      ftxSel = toMe && /^[+-]\d{2}$/.test(p) ? 2 : 0;
      if (dxPar) dxPar.parity = 0;
    }
    store.set('ftxsel', ftxSel);
    drawMsgs();
    // Comme WSJT-X (« Double-click on call sets Tx enable ») : avec la main, l'émission part à la période suivante
    // (la période opposée à celle de la station choisie), puis la séquence avance toute seule
    if (api && api.iControl() && FT_MODES.indexOf(mode) >= 0) {
      const t = ftxMsgs()[ftxSel];
      if (t) {
        ftxSend(ftxSel, t, true); // PTT au clic (le signal part au début de la période)
        // Retour immédiat : quand part la réponse
        setTimeout(() => {
          const x = api.state() && api.state().ftx;
          if (!x) return;
          const s = Math.max(0, Math.round((x.at - now()) / 1000)); // horloge du serveur (celle de votre PC peut être décalée)
          const d = new Date(x.at);
          // Clic trop tard pour la période qui suit celle du correspondant : il ne décoderait plus un signal parti
          // plus de 2,3 s (FT8) / 0,8 s (FT4) après le début de la période → départ à sa période suivante
          const P = SLOT_MS[x.mode] || 15000;
          const late = slot && x.at - slot > 2 * P;
          api.say(x.state === 'tx' ? 'Réponse à ' + call + ' : TRX en émission (Tx' + (ftxSel + 1) + (s > 0 ? ', le signal part dans ' + s + ' s, au début de la période' : '') + ').'
            : 'Réponse à ' + call + ' : Tx' + (ftxSel + 1) + ' part dans ' + s + ' s (' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' UTC' +
              (late ? ') — trop tard pour la période qui suivait son message (un départ plus tardif ne serait plus décodé) : cliquez dès l’affichage du décodage.' : ', période de ' + call + ' + 1).'), late ? 'warn' : '', late ? 12000 : 8000);
        }, 700);
      }
    } else if (api && !api.iControl()) api.say('Correspondant ' + call + ' choisi. Prenez la main pour lui répondre.', '', 4000);
  }
  function ftxMsgs() {
    const c = dx.call || '{CORRESP}';
    const g = myGrid ? myGrid.slice(0, 4) : '{LOCATOR}'; // FT8 / FT4 : locator à 4 caractères
    const r = /^[+-]?\d{1,2}$/.test(dx.rpt) ? (dx.rpt[0] === '+' || dx.rpt[0] === '-' ? dx.rpt : '+' + dx.rpt) : '-10';
    return [c + ' ' + myCall + ' ' + g, c + ' ' + myCall + ' ' + r, c + ' ' + myCall + ' R' + r, c + ' ' + myCall + ' RR73', c + ' ' + myCall + ' 73', 'CQ ' + myCall + ' ' + g];
  }
  function drawMsgs() {
    if (!$('msgFtx')) return;
    const mk = (box, label, text, onClick, sel) => {
      const b = box.ownerDocument.createElement('button');
      b.className = 'btn' + (sel ? ' sel' : '');
      b.type = 'button';
      if (label) { const s = box.ownerDocument.createElement('small'); s.textContent = label; b.appendChild(s); }
      b.appendChild(document.createTextNode(text));
      b.addEventListener('click', onClick);
      box.appendChild(b);
      return b;
    };
    const f = $('msgFtx');
    const stop = $('dgStop'); // « ■ Arrêter » : sur la ligne des macros, à droite du texte libre
    f.textContent = '';
    const hd = houndOn();
    ftxMsgs().forEach((t, i) => {
      const b = mk(f, 'Tx' + (i + 1), t, () => ftxSend(i, t), i === ftxSel);
      b.title = 'Clic : ce message part à chaque période (FT8 / FT4 / FT2 selon l’onglet) jusqu’à la réponse ; la séquence avance toute seule. ■ Arrêter pour couper.';
      if (hd && i !== 0 && i !== 2 && i !== 4) { b.disabled = true; b.title = 'HOUND : seulement Tx1 (appel du FOX), Tx3 (R + report) et Tx5 (73). Pas de CQ : le FOX termine le QSO par RR73.'; }
      if (hd && i === 4) b.title = 'HOUND : 73 au FOX, envoyé une fois à la main (pas nécessaire : son RR73 termine déjà le QSO)';
      if (hd && i === 0) b.title = 'HOUND : appel du FOX en 2e période (FOX classique : au-dessus de 1000 Hz). Quand le FOX vous donne un report, Tx3 part tout seul ; son RR73 termine le QSO.';
    });
    if (hd) { const h = f.ownerDocument.createElement('span'); h.className = 'dg-hound-tag'; h.textContent = (api.state().hound === 2 ? 'HOUND · SuperFox' : 'HOUND · FOX'); f.insertBefore(h, f.firstChild); }
    // Tx7 : texte libre de 13 caractères au plus (comme WSJT-X)
    const free = String(store.get('ftxfree', '')).toUpperCase();
    const fb = mk(f, 'Tx7', free || 'texte libre…', () => (free ? ftxSend(6, free) : editFree(f.ownerDocument)), ftxSel === 6);
    if (hd) fb.disabled = true;
    fb.title = 'Texte libre FT8 / FT4 / FT2 (13 caractères) · clic : émission · clic droit : modifier';
    fb.addEventListener('contextmenu', (e) => { e.preventDefault(); editFree(fb.ownerDocument); });
    drawQso();
    const ed = mk(f, '', '✎', () => editFree(f.ownerDocument));
    ed.title = 'Modifier le texte libre (Tx7)';
    ed.classList.add('mini');
    if (stop) f.appendChild(stop);
  }
  // Fenêtre de QSO (sous les messages Tx1 à Tx7) : fiche du correspondant
  function dxGeo(call) {
    const c = String(call || '').toUpperCase();
    if (!c) return null;
    for (const H of [hist, histB]) for (let i = H.length - 1; i >= 0; i--) {
      const it = H[i];
      for (const d of it.list || []) if (!d.tx && senderOf(d.msg) === c && (d.cty || d.km != null)) return d;
    }
    return null;
  }
  // Fiche du carnet sous les macros (TRX DIGI du dashboard) : montée une fois, messages du carnet reçus par l'écoute du dashboard
  function qsoFormTick() {
    if (!QSOFORM || !api || !$('ftQsoLog')) return;
    const L = window.RSLOG;
    if (!qsoForm) {
      qsoForm = true;
      $('ftQso').hidden = true;
      $('ftQsoLog').hidden = false;
      // Fonctions relues à chaque appel : le dashboard (et donc l'api) peut avoir été rechargé entre-temps
      L.init({ send: (m) => api.send(m), state: () => api.state(), iControl: () => api.iControl(), tag: 'ftqso', formOnly: true, say: (...a) => api.say(...a) });
      L.mount($('ftQsoLog'));
    }
    const h = window.opener && !window.opener.closed && window.opener.RSHOST;
    if (h && h !== qsoTapHost) {
      qsoTapHost = h;
      // Jamais d'exception vers le dashboard : il retirerait cette écoute pour de bon (fiche bloquée sur « Enregistrement… »)
      h.tap((m) => { try { if (m && (/^log_/.test(m.t) || (m.t === 'notice' && m.level === 'error'))) L.onMessage(m); } catch (e) { /* message ignoré */ } });
      try { const me = h.me && h.me(); if (me) L.onHello(me); } catch (e) { /* */ }
      L.show();
    }
    L.onState();
    // Correspondant FT (double-clic, séquence) : indicatif, locator, reports et heure de début repris dans la fiche
    const st = api.state();
    const sq = st && st.seq;
    const mine = !!(sq && sq.dx && dx.call && sq.dx === dx.call);
    const rs = (mine && sq.rpt) || dx.rpt || '', rr = (mine && sq.rptRcvd) || dx.rptRx || '';
    const key = [dx.call, dx.grid, rs, rr, dx.t0].join('|');
    if (dx.call && key !== qsoFillKey && !L.editing()) { qsoFillKey = key; L.fill({ rst_sent: rs, rst_rcvd: rr, t0: dx.t0 }); }
  }
  function drawQso() {
    qsoFormTick();
    if (!$('ftQso') || qsoForm) return;
    const put = (id, v) => { const el = $(id); if (el && el.ownerDocument.activeElement !== el && el.value !== v) el.value = v; };
    const st = api && api.state && api.state();
    const sq = st && st.seq;
    const mine = !!(sq && sq.dx && dx.call && sq.dx === dx.call);
    put('fqCall', dx.call || '');
    put('fqGrid', dx.grid || '');
    put('fqRpt', (mine && sq.rpt) || dx.rpt || '');
    put('fqRptRx', (mine && sq.rptRcvd) || dx.rptRx || '');
    const g = dxGeo(dx.call);
    const geo = g ? [g.cty || '', g.km == null ? '' : (g.kmc ? '≈ ' : '') + g.km + ' km', g.az == null ? '' : g.az + '°'].filter(Boolean).join(' · ') : '';
    if ($('fqGeo').textContent !== geo) $('fqGeo').textContent = geo;
    const t0 = dx.call && dx.t0 ? 'Début ' + utc(dx.t0).slice(0, 2) + ':' + utc(dx.t0).slice(2, 4) + ' UTC' : '';
    if ($('fqT0').textContent !== t0) $('fqT0').textContent = t0;
    const x = st && st.ftx;
    const stTxt = mine && sq.on ? (x && x.state === 'tx' ? '● Tx' + sq.ntx + ' en émission' : 'Tx' + sq.ntx + ' à la prochaine période') : dx.call ? 'en attente' : '';
    if ($('fqSt').textContent !== stTxt) $('fqSt').textContent = stTxt;
    $('fqSt').classList.toggle('on', !!(mine && sq.on));
    $('ftQso').classList.toggle('empty', !dx.call);
    $('fqLog').disabled = !dx.call;
  }
  // LOG QSO : fiche à confirmer, comme en fin de QSO
  function qsoLogNow() {
    if (!dx.call) return;
    const st = api && api.state();
    const r = (st && st.radio) || {};
    const dial = Number(sd() === 'B' ? r.freqB : r.freq) || 0;
    const t0 = new Date(dx.t0 || now()), t1 = new Date(now());
    const d8 = (x) => x.toISOString().slice(0, 10).replace(/-/g, '');
    const t6 = (x) => x.toISOString().slice(11, 19).replace(/:/g, '');
    const sq = st && st.seq;
    const mine = !!(sq && sq.dx === dx.call);
    qsoPrompt({ call: dx.call, gridsquare: GRID_RE.test(dx.grid || '') ? dx.grid.slice(0, 4) : '', mode: FT_MODES.indexOf(mode) >= 0 ? mode : 'FT8', station: myCall,
      freq: ((dial + curTxF()) / 1e6).toFixed(6), rst_sent: (mine && sq.rpt) || dx.rpt || '', rst_rcvd: (mine && sq.rptRcvd) || dx.rptRx || '',
      qso_date: d8(t0), time_on: t6(t0), qso_date_off: d8(t1), time_off: t6(t1), tx_pwr: r.power || '' });
  }
  // ------------------------------------------------------------------ émission FT8 / FT4 / FT2
  // Clic sur Tx1…Tx7 : le serveur choisit le créneau, la page Station du club fabrique et joue le signal
  function ftxSend(i, text, keyNow) {
    ftxSel = i;
    store.set('ftxsel', i);
    drawMsgs();
    if (!api) return;
    if (/[{}]/.test(text)) return api.say('Message incomplet : choisissez d’abord le correspondant (double-clic sur son message) ou réglez votre locator.', 'warn');
    const m = FT_MODES.indexOf(mode) >= 0 ? mode : ftStored();
    api.send({ t: 'ftx_tx', mode: m, ntx: i + 1, f0: curTxF(), parity: txParity(i), dx: { call: dx.call, grid: dx.grid }, rpt: dx.rpt,
      free: String(store.get('ftxfree', '')), call1st: false, keyNow: !!keyNow, rxf: sd() === 'B' ? rxFB : rxF, side: sd() });
  }
  const curTxF = () => (sd() === 'B' ? Math.round(Number(store.get('txfb', String(txFB))) || txFB) : Math.round(Number(store.get('txf', String(txF))) || txF));
  // Période d'émission : imposée, ou (auto) l'autre que celle du correspondant choisi par double-clic
  function txParity(i) {
    const sel = $('dgPar') ? $('dgPar').value : store.get('ftxpar', 'auto');
    if (sel === '0' || sel === '1') return Number(sel);
    const m = FT_MODES.indexOf(mode) >= 0 ? mode : ftStored();
    if (i < 5 && dxPar && dxPar.mode === m && dxPar.call === dx.call) return 1 - dxPar.parity;
    return null;
  }
  function ftxCfg() {
    const st = api && api.state();
    if (st && st.seq && st.seq.on && st.seq.by === opCall) api.send({ t: 'ftx_cfg', f0: curTxF(), parity: txParity(ftxSel), call1st: false, side: sd() });
  }
  // Fin de QSO (73 / RR73) : proposition d'enregistrement dans le carnet, comme « Prompt me to log QSO » de WSJT-X
  // Fin d'un QSO FT8 / FT4 / FT2 : fiche à confirmer, ou enregistrement automatique selon le choix « Log »
  const ftxLogged = new Set();
  function ftxQsoEnd(m) {
    const q = m.qso;
    const key = q.call + '|' + q.qso_date + '|' + q.time_on;
    if (ftxLogged.has(key)) return;
    const al = store.get('ftautolog', '') ? 'any' : ''; // anciens choix (envoi / réception) : automatique
    const sent = /envoy/.test(m.why || '');
    const rcvd = /re[çc]u/.test(m.why || '');
    if (al === 'any' || (al === 'sent' && sent) || (al === 'rcvd' && rcvd)) {
      ftxLogged.add(key);
      return ftxLogAdd(q, true);
    }
    if (al === 'sent' && rcvd) return;              // l'envoi du 73 suit : enregistrement à ce moment-là
    if (m.again) return;                             // fiche déjà proposée pour ce QSO
    if (al === 'rcvd' && sent) { ftxLogged.add(key); return qsoPrompt(q, '73 envoyé sans RR73 / 73 reçu : enregistrer ?'); }
    ftxLogged.add(key);
    qsoPrompt(q);
  }
  function ftxLogAdd(q, auto) {
    const qso = Object.assign({}, q);
    // Nom et QTH du correspondant (fiche QRZ.com ou saisis dans la barre du correspondant)
    if (dx && String(dx.call || '').toUpperCase() === String(q.call || '').toUpperCase()) {
      if (dx.name && !qso.name) qso.name = dx.name;
      if (dx.qth && !qso.qth) qso.qth = dx.qth;
    }
    if (!qso.gridsquare) delete qso.gridsquare;
    if (!qso.tx_pwr) delete qso.tx_pwr;
    api.send({ t: 'log_add', qso, spot: !!(window.RSSPOT && RSSPOT.on()), tag: qsoForm ? 'ftqso' : undefined });
    if (auto && api) api.say('Log automatique : QSO avec ' + q.call + ' enregistré dans le carnet.', '', 4000);
  }
  function qsoPrompt(q, note) {
    const doc = ($('msgFtx') && $('msgFtx').ownerDocument) || document;
    const old = doc.getElementById('qsoDlg');
    if (old) old.remove();
    const dlg = doc.createElement('dialog');
    dlg.id = 'qsoDlg';
    dlg.className = 'macro-dlg qso-dlg';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    dlg.innerHTML = '<div class="qso-b"><h3>QSO terminé</h3>' + (note ? '<p class="qso-note">' + esc(note) + '</p>' : '') + '<p><b>' + esc(q.call) + '</b>' + (q.gridsquare ? ' · ' + esc(q.gridsquare) : '') + ' · ' + esc(q.mode) + ' · ' +
      esc(Number(q.freq).toFixed(6)) + ' MHz<br>Report envoyé ' + esc(q.rst_sent || '—') + ' · reçu ' + esc(q.rst_rcvd || '—') + ' · ' +
      esc(q.time_on.slice(0, 2) + ':' + q.time_on.slice(2, 4)) + '–' + esc(q.time_off.slice(0, 2) + ':' + q.time_off.slice(2, 4)) + ' UTC</p>' +
      '<div class="md-act">' + (window.RSSPOT ? RSSPOT.html() : '') + '<button class="btn" type="button" data-a="log">Enregistrer dans le carnet</button><button class="btn" type="button" data-a="no">Ne pas enregistrer</button></div></div>';
    doc.body.appendChild(dlg);
    try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
    dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelector('[data-a="log"]').addEventListener('click', () => {
      ftxLogAdd(q, false);
      dlg.remove();
    });
    dlg.querySelector('[data-a="no"]').addEventListener('click', () => dlg.remove());
  }
  // ------------------------------------------------------------------ émission RTTY / JTTY (signal fabriqué par le serveur)
  let dtxPend = null; // { mode, text } : texte à effacer de la zone d'écriture une fois l'émission partie
  // ------------------------------------------------------------------ émission CW (manipulateur du TRX)
  let cwZone = false; // texte de la zone d'écriture : effacé quand l'émission part
  let cwSeen = 0;
  function cwClick() {
    if (!api) return;
    const st = api.state();
    if (st && st.cw) return api.send({ t: 'cw_stop' });
    const el = $('cwTxt');
    if (!el.value.trim()) return api.say('Rien à émettre : tapez un texte ou choisissez une macro.', 'warn');
    cwSend(el.value, true);
  }
  function cwSend(text, zone) {
    if (!api) return;
    const st = api.state();
    // Émission CW en cours : le nouveau message la remplace (le serveur l'arrête et lance le nouveau)
    if (st && (st.ftx || (st.ptt && st.ptt.active))) return api.say('Émission en cours : attendez la fin (ou « ■ Arrêter »).', 'warn');
    if (!api.iControl()) return api.say('Prenez la main pour émettre.', 'warn');
    cwZone = zone;
    api.send({ t: 'cw', text: String(text).replace(/\n/g, ' '), wpm: Number(store.get('cwspeed', '22')) || 22 });
  }
  // Préparation d'avance (macro survolée, texte tapé, F1 au repos) : le serveur la transmet à la page Station
  var cwPrepLast = '';
  var cwPrepTimer = null;
  var cwWasTx = false;
  function cwPrep(text, force) {
    if (!api || !api.iControl()) return;
    const st = api.state();
    if (st && (st.cw || st.ftx || (st.ptt && st.ptt.active))) return;
    const r = st && st.radio;
    if (!r || !/^CW/.test((r.vfoSel === 1 ? r.modeB : r.mode) || '')) return; // TRX pas en CW : rien à préparer
    text = String(text || '').replace(/\n/g, ' ').trim();
    if (!text) return;
    const wpm = Number(store.get('cwspeed', '22')) || 22;
    const key = wpm + '|' + text.toUpperCase();
    if (key === cwPrepLast && !force) return; // macro survolée (force) : la page Station sait si c'est déjà en mémoire
    cwPrepLast = key;
    api.send({ t: 'cw_prep', text, wpm });
  }
  function cwPrepMacro(t, auto) {
    if (/<CALL>|\{CALL\}/.test(t) && !String(dx.call || '').trim()) return;
    cwPrep(cwText(t, false), !auto);
  }
  function cwPrepF1() {
    const m = macroList('CW').find((x) => /<TX>/i.test(x.text));
    if (m) cwPrepMacro(m.text, true);
  }
  // Texte émis en CW dans la réception, lettre par lettre comme en RTTY : rouge = parti, gris = encore à émettre.
  // Minutage : durée de chaque caractère (serveur) à partir du début de chaque morceau joué (signalé par la page Station).
  var cwLive = null;
  var cwLiveTimer = null;
  function cwLiveTick(final) {
    const L = cwLive;
    if (!L) return;
    const p = L.pos;
    let n = L.n;
    if (p) {
      const base = Math.min(p.chars, L.text.length);
      const baseMs = base > 0 ? L.ms[base - 1] : 0;
      const t = now() - p.at;
      let k = base;
      while (k < L.ms.length && L.ms[k] - baseMs <= t) k++;
      n = Math.max(n, k);
      if (final) {
        const rest = (L.ms[L.ms.length - 1] || 0) - baseMs;
        if (t >= rest * 0.85) n = L.text.length; // fin normale : tout est parti
      }
    }
    if (n !== L.n) { L.n = n; L.done.textContent = L.text.slice(0, n); L.todo.textContent = L.text.slice(n); }
  }
  function cwLiveUpdate(x) {
    if (x && x.state === 'tx' && x.ms && x.ms.length === String(x.text).length) {
      if (!cwLive || cwLive.id !== x.id) {
        if (cwLive) cwLiveEnd();
        const rxEl = $('cwRx');
        if (!rxEl) return;
        const d = rxEl.ownerDocument;
        const s = d.createElement('span');
        s.className = 'rt-txline';
        const done = d.createElement('span');
        done.className = 'rt-done';
        const todo = d.createElement('span');
        todo.className = 'rt-todo';
        todo.textContent = String(x.text);
        s.append('\n', done, todo, '\n');
        rxEl.appendChild(s);
        rxEl.scrollTop = rxEl.scrollHeight;
        cwLive = { id: x.id, text: String(x.text), ms: x.ms, pos: x.pos, done, todo, n: 0 };
        cwLiveTimer = setInterval(() => cwLiveTick(false), 80);
      }
      if (x.pos) cwLive.pos = x.pos;
      cwLiveTick(false);
    } else if (cwLive && !(x && x.id === cwLive.id)) cwLiveEnd();
  }
  function cwLiveEnd() {
    clearInterval(cwLiveTimer);
    cwLiveTimer = null;
    cwLiveTick(true);
    if (cwLive.n < cwLive.text.length) cwLive.todo.classList.add('rt-cut'); // arrêté avant la fin
    cwLive = null;
  }
  function cwTxState(x) {
    cwLiveUpdate(x);
    // Fin d'un message : la 1re macro (CQ) est remise en mémoire, prête pour le clic suivant
    if (x) cwWasTx = true;
    else if (cwWasTx) { cwWasTx = false; cwPrepLast = ''; setTimeout(cwPrepF1, 600); }
    else if (!cwPrepLast && tab === 'cw' && api && api.iControl()) cwPrepF1(); // onglet CW avec la main : F1 prêt
    const b = $('cwSend');
    const note = $('cwTxState');
    if (!b || !note) return;
    // Bouton ARRÊTER bien visible pendant toute l'émission CW (préparation comprise), pour celui qui a la main
    const stp = $('cwStop');
    if (stp) stp.hidden = !(x && api && api.iControl());
    b.textContent = x ? '■ Arrêter' : 'Émettre';
    b.classList.toggle('on-air', !!(x && x.state === 'tx'));
    note.classList.toggle('air', !!(x && x.state === 'tx'));
    if (x && x.live) {
      note.textContent = (x.state === 'tx' ? '● En émission CW à la clé (' : 'Préparation de la clé CW (') + x.by + ')';
    } else if (x) {
      note.textContent = (x.state === 'tx' ? '● En émission CW (' + x.by + ', ' + x.wpm + ' mots/min, ~' + Math.round(x.seconds) + ' s) : « ' : 'Préparation de l’émission CW : « ') +
        String(x.text).slice(0, 60) + (x.text.length > 60 ? '…' : '') + ' »';
      // Texte de la zone d'écriture parti : on la vide (une fois par émission)
      if (x.state === 'tx' && cwZone && x.id !== cwSeen && api.iControl()) { cwSeen = x.id; cwZone = false; $('cwTxt').value = ''; }
    } else if (!note.querySelector('.dg-txcall')) {
      note.innerHTML = 'Émission CW sous <b class="dg-txcall"></b> par le manipulateur du TRX : macro (émission directe) ou texte ci-dessus puis « Émettre » (Ctrl+Entrée).';
      note.querySelector('.dg-txcall').textContent = myCall;
    }
  }
  function dtxClick(mode) {
    if (!api) return;
    const st = api.state();
    const x = st && st.ftx;
    // Pendant l'émission (ou si elle est prévue) : le bouton coupe
    if (x && x.mode === mode) return api.send({ t: 'ftx_stop' });
    const el = mode === 'RTTY' ? $('rtTxt') : $('jtTxt');
    if (!el.value.trim()) return api.say('Rien à émettre : tapez un texte ou choisissez une macro.', 'warn');
    dtxSend(mode, el.value, true);
  }
  // zone = true : texte de la zone d'écriture (effacé quand l'émission part) ; false : macro <TX>
  function dtxSend(mode, text, zone) {
    if (!api) return;
    const st = api.state();
    if (st && (st.ftx || (st.ptt && st.ptt.active))) return api.say('Émission en cours : attendez la fin (ou « ■ Arrêter »).', 'warn');
    const m = { t: 'dtx', mode, text };
    if (mode === 'RTTY') { const r = rts[rtTx]; Object.assign(m, { f0: Math.round(r.f), shift: r.shift, baud: r.baud, rev: !!r.rev }); }
    else m.f0 = curTxF();
    dtxPend = { mode, text, zone };
    api.send(m);
  }
  // Filtre CW de l'onglet : règle aussi la largeur (BW) du TRX, au plus près, sur le VFO écouté (pour tous, comme le cadre Filtres)
  function cwTrxWidth(hz, side) {
    if (!api) return;
    if (!api.iControl()) return api.say('Filtre du décodeur réglé à ' + hz + ' Hz ; prenez la main pour régler aussi la largeur (BW) du TRX.', 'warn');
    const st = api.state();
    const r = st && st.radio;
    if (!r || !r.connected) return;
    if ((st.ptt && st.ptt.active) || r.tx) return api.say('Émission en cours : seul le filtre du décodeur change.', 'warn');
    const R = api.rig();
    const C = R.CONTROL || {};
    const sideB = (side ? side === 'B' : Number(r.vfoSel) === 1) && !!C.widthB;
    const mode = sideB ? r.modeB : r.mode;
    if (!/^CW/.test(mode || '')) return api.say('TRX pas en CW (' + (mode || '?') + ') : seul le filtre du décodeur change.', 'warn');
    // IC-7300 : trois filtres (CW : FIL2 ≈ 500 Hz, FIL3 ≈ 250 Hz par défaut)
    if (C.fil && !C.width) {
      const v = hz <= 250 ? 3 : 2;
      api.send({ t: 'set', ctl: 'fil', value: v });
      return api.say('Filtre CW : décodeur ' + hz + ' Hz, filtre du TRX FIL' + v + '.', '', 4000);
    }
    const t = R.widthTable && R.widthTable(mode);
    if (!t) return;
    let best = 0;
    t.forEach((w, i) => { if (Math.abs(w - hz) < Math.abs(t[best] - hz)) best = i; });
    const nar = sideB ? 'narrowB' : 'narrow';
    if (r[nar] && C[nar]) api.send({ t: 'set', ctl: nar, value: 0 }); // NARROW imposerait sa largeur
    api.send({ t: 'set', ctl: sideB ? 'widthB' : 'width', value: best + 1 });
    api.say('Filtre CW : décodeur ' + hz + ' Hz, BW du TRX ' + t[best] + ' Hz (centré sur la tonalité CW du TRX : la station doit y être calée).', '', 6000);
  }
  function dtxState(x) {
    for (const mode of ['RTTY', 'JTTY']) {
      const b = $(mode === 'RTTY' ? 'rtSend' : 'jtSend');
      const note = $(mode === 'RTTY' ? 'rtTxState' : 'jtTxState');
      if (!b) continue;
      const mine = !!(x && x.mode === mode);
      b.textContent = mine ? '■ Arrêter' : 'Émettre';
      b.classList.toggle('on-air', mine && x.state === 'tx');
      if (note) {
        note.classList.toggle('air', mine && x.state === 'tx');
        note.textContent = mine ? (x.state === 'tx' ? '● En émission ' + mode + ' (' + x.by + ') : « ' + x.text + ' »' : 'Préparation de l’émission ' + mode + '…')
          : mode === 'RTTY' ? 'Émission RTTY sous ' + myCall + ', réglages du décodeur ' + (rtTx ? 'B' : 'A') + ' (' + Math.round(rts[rtTx].f) + ' Hz) : macro (émission directe) ou texte ci-dessus puis « Émettre » (Ctrl+Entrée).' : 'Émission JTTY sous ' + myCall + ' : macro (émission directe) ou message ci-dessus puis « Émettre » (Entrée).';
      }
    }
    // Émission partie : le texte envoyé quitte la zone d'écriture et s'affiche dans la réception
    if (dtxPend && x && x.mode === dtxPend.mode && x.state === 'tx') {
      const el = dtxPend.mode === 'RTTY' ? $('rtTxt') : $('jtTxt');
      if (el && dtxPend.zone && el.value === dtxPend.text) el.value = '';
      const rxEl = $(rtTx ? 'rtRxB' : 'rtRx');
      if (dtxPend.mode === 'RTTY' && rxEl) {
        // Texte exact émis (envoyé par le serveur) : gris tant qu'il attend, rouge lettre par lettre une fois parti
        const info = dtxInfo && dtxInfo.id === x.id ? dtxInfo : null;
        const text = info ? info.text : dtxPend.text.toUpperCase().replace(/\s+$/, '');
        const s = document.createElement('span');
        s.className = 'rt-txline';
        const done = document.createElement('span');
        done.className = 'rt-done';
        const todo = document.createElement('span');
        todo.className = 'rt-todo';
        s.append('\n', done, todo, '\n');
        rxEl.appendChild(s);
        if (info && info.ms && info.ms.length === text.length) {
          todo.textContent = text;
          rtLive = { id: x.id, at: x.at, text, ms: info.ms, seconds: info.seconds, done, todo, n: 0 };
          rtTick();
        } else {
          done.textContent = text;
        }
        rxEl.scrollTop = rxEl.scrollHeight;
      }
      dtxPend = null;
    }
    // Fin de l'émission (normale ou « Arrêter ») : dernière mise à jour, puis plus de suivi
    if (rtLive && !(x && x.id === rtLive.id && x.state === 'tx')) {
      rtTick();
      rtLive.todo.classList.add('rt-cut');
      rtLive = null;
      clearInterval(rtTimer);
      rtTimer = null;
    }
    if (rtLive && !rtTimer) rtTimer = setInterval(rtTick, 80);
    if (rtLive) rtTick();
  }
  // Suivi de l'émission RTTY lettre par lettre (minutage calculé par le serveur)
  let dtxInfo = null; // { id, mode, text, ms, seconds } : reçu du serveur à la préparation
  let rtLive = null;
  let rtTimer = null;
  function rtTick() {
    const L = rtLive;
    if (!L) return;
    const t = now() - L.at;
    let n = L.n;
    while (n < L.ms.length && L.ms[n] <= t) n++;
    if (n !== L.n) {
      L.n = n;
      L.done.textContent = L.text.slice(0, n);
      L.todo.textContent = L.text.slice(n);
    }
    const note = $('rtTxState');
    if (note && note.classList.contains('air')) {
      const left = Math.max(0, Math.ceil(L.seconds - t / 1000));
      note.textContent = '● En émission RTTY — ' + (n >= L.ms.length ? 'fin du message' : 'fin dans ' + left + ' s') + ' : « ' + L.text.replace(/\n/g, ' ').slice(0, 50) + (L.text.length > 50 ? '…' : '') + ' »';
    }
  }

  // HOUND (FT8 en DXpédition) : réglage de la station (st.hound) ; Tx1 et Tx3 seulement, 2e période imposée
  const houndOn = () => { const st = api && api.state && api.state(); return !!(st && st.hound && mode === 'FT8' && tab === 'ftx'); };
  let houndSeen = '';
  // Bouton DUAL RX (TRX à deux récepteurs dont les deux voies arrivent séparément : FTDX101D / MP)
  function dualRxUi() {
    const b = $('dgDualRx');
    if (!b || !api || !api.rig || !api.rig()) return;
    const R = api.rig();
    b.hidden = !(R.DUAL_AUDIO && R.ID !== 'ftx1') || detached;
    b.setAttribute('aria-pressed', String(!!ftDual));
  }
  function houndUi() {
    dualRxUi();
    const sel = $('dgHound'), wrap = $('dgHoundWrap');
    if (!sel || !wrap || !api) return;
    const st = api.state();
    const v = (st && st.hound) || 0;
    wrap.hidden = mode !== 'FT8';
    if (document.activeElement !== sel) sel.value = String(v);
    sel.disabled = !api.iControl();
    wrap.classList.toggle('on', !!v);
    const on = houndOn();
    const pane = document.querySelector('#centerPanel .ctab-pane[data-pane="ftx"]');
    if (pane) pane.classList.toggle('hound', on);
    if ($('dgPar')) { $('dgPar').disabled = on; if (on) $('dgPar').value = '1'; else if ($('dgPar').value !== store.get('ftxpar', 'auto')) $('dgPar').value = store.get('ftxpar', 'auto'); }
    const k = on + '|' + v;
    if (k !== houndSeen) { houndSeen = k; drawMsgs(); }
  }
  let lastTxAt = 0;
  let seqSeen = '';
  function ftxState() {
    houndUi();
    { const k = notchHz('A') + '|' + notchHz('B'); if (k !== notchSeen) { notchSeen = k; drawScale(); } }
    drawQso();
    const st = api && api.state();
    const x = st && st.ftx;
    const sq = st && st.seq;
    const el = $('dgTxState');
    dtxState(x);
    ssTxState(x);
    const mine = !!(sq && sq.by === opCall);
    if ($('dgStop')) $('dgStop').disabled = !(x || (sq && sq.on) || (st && st.ptt && st.ptt.digi));
    // Double réception : le VFO d'émission suit celui de la séquence en cours (ex. choisi dans l'autre fenêtre)
    const hold = Date.now() - sideSetAt < 3000;
    if (!hold && mine && sq.on && ftDual && (sq.side === 'B' ? 'B' : 'A') !== ftSide) { ftSide = sq.side === 'B' ? 'B' : 'A'; sideBtns(); drawScale(); }
    // Sans émission auto : le VFO d'émission affiché suit celui du TRX (TX sur MAIN = VFO-A, sur SUB = VFO-B),
    // qu'il ait été changé ici, sur la face avant du dashboard ou sur le TRX lui-même
    const rr = st && st.radio;
    if (!hold && ftDual && !(sq && sq.on && mine) && rr && (rr.txVfo === 0 || rr.txVfo === 1) && (rr.txVfo === 1 ? 'B' : 'A') !== ftSide) {
      ftSide = rr.txVfo === 1 ? 'B' : 'A';
      sideBtns();
      drawScale();
    }
    // HOUND : la fréquence d'émission est fixée par le serveur (appel au-dessus de 1000 Hz, fréquence du FOX…)
    if (mine && sq.on && sq.hound && sq.f0 && sq.f0 !== curTxF()) {
      if (sd() === 'B') { txFB = sq.f0; store.set('txfb', sq.f0); } else { txF = sq.f0; store.set('txf', sq.f0); }
      drawScale();
    }
    // Séquence automatique : le message choisi et le correspondant suivent ce que décide le serveur
    if (mine) {
      const key = [sq.ntx, sq.dx, sq.grid, sq.rpt, sq.on].join('|');
      if (key !== seqSeen) {
        seqSeen = key;
        ftxSel = sq.ntx - 1;
        store.set('ftxsel', ftxSel);
        if (sq.dx && (sq.dx !== dx.call || (sq.grid && sq.grid !== dx.grid) || (sq.rpt && sq.rpt !== dx.rpt))) setDx({ call: sq.dx, grid: sq.grid || dx.grid, rpt: sq.rpt || dx.rpt });
        else drawMsgs();
      }
    }
    if (el) {
      const hm = (ms) => { const d = new Date(ms); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + (ms % 1000 >= 100 && ms % 1000 !== 500 ? '.' + Math.floor((ms % 1000) / 100) : ''); };
      const auto = sq && sq.on ? 'Émission auto (' + sq.by + ') · Tx' + sq.ntx + ' · ' : '';
      el.textContent = x && x.state === 'tx' ? '● ' + auto + 'en émission ' + x.mode + ' : « ' + x.text + ' » à ' + x.f0 + ' Hz'
        : x ? auto + x.mode + ' prévu à ' + hm(x.at - 500) + ' UTC : « ' + x.text + ' » à ' + x.f0 + ' Hz'
        : sq && sq.on ? auto + '« ' + sq.text + ' » à la prochaine période'
        : 'Émission : clic sur Tx1 à Tx7 (en bas) → à chaque période jusqu’à la réponse, séquence automatique comme WSJT-X.';
      el.classList.toggle('on', !!(x || (sq && sq.on)));
      el.classList.toggle('air', !!(x && x.state === 'tx'));
    }
    // Message émis : ajouté aux listes comme dans WSJT-X
    if (x && x.state === 'tx' && x.at !== lastTxAt && FT_MODES.indexOf(x.mode) >= 0) {
      lastTxAt = x.at;
      const it = { slot: Math.floor((x.at - 500) / 100) * 100, mode: x.mode, tx: true, list: [{ tx: true, db: 0, dt: 0, f: x.f0, msg: x.text }] };
      // Double réception : dans les colonnes du VFO qui émet
      const onB = ftDual && sq && sq.on && sq.side === 'B';
      (onB ? histB : hist).push(it);
      if (x.mode === mode) addSlot(it, false, onB ? 'B' : undefined);
    }
  }

  // Rangée de macros : clic = utiliser, clic droit = modifier, ✎ = modifier
  function drawMacroRow(box, mode, use, prep, noF) {
    if (!box) return;
    box.textContent = '';
    macroList(mode).forEach((m, i) => {
      const b = box.ownerDocument.createElement('button');
      b.className = 'btn';
      b.type = 'button';
      if (mode !== 'FT8' && !noF) { const s = box.ownerDocument.createElement('small'); s.textContent = 'F' + (i + 1); b.appendChild(s); }
      b.appendChild(box.ownerDocument.createTextNode(m.name || '—'));
      const tip = () => (mode === 'CW' || mode === 'CWC' ? cwText(m.text) : macroText(m.text)).replace(/\n/g, ' ⏎ ') + '\n' +
        (/<TX>/i.test(m.text) ? 'clic : émission immédiate · Maj+clic : ajouter au texte · clic droit : modifier' : 'clic : ajouter au texte · clic droit : modifier');
      if (/<TX>/i.test(m.text)) b.classList.add('mac-tx');
      b.title = tip();
      b.addEventListener('mouseenter', () => {
        b.title = tip();
        // CW : macro survolée préparée d'avance dans la mémoire du TRX (le clic ne lance plus que la lecture)
        if (prep && /<TX>/i.test(m.text)) { clearTimeout(b._prep); b._prep = setTimeout(() => prep(m.text), 120); }
      });
      b.addEventListener('mouseleave', () => clearTimeout(b._prep));
      b.addEventListener('click', (e) => use(m.text, e.shiftKey));
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); editMacro(box.ownerDocument, mode, i); });
      box.appendChild(b);
    });
    const ed = box.ownerDocument.createElement('button');
    ed.className = 'btn mini';
    ed.type = 'button';
    ed.textContent = '✎';
    ed.title = 'Modifier les macros ' + mode;
    ed.addEventListener('click', () => editMacro(box.ownerDocument, mode, 0));
    box.appendChild(ed);
  }
  function drawRttyMacros() {
    // Contest choisi : les touches F1 à F12 passent aux macros contest (les macros habituelles restent au clic)
    drawMacroRow($('rtMacros'), 'RTTY', (t, ins) => useMacro('RTTY', t, ins), null, rtcOn());
    drawMacroRow($('rtcMacros'), 'RTTYC', (t, ins) => useMacro('RTTY', t, ins), null, !rtcOn());
    if ($('rtcMacros')) $('rtcMacros').hidden = !rtcOn();
    const nr = $('rtcNr');
    if (nr && document.activeElement !== nr) nr.value = String(Number(store.get('cntr', '1')) || 1).padStart(3, '0');
  }
  function initContest() {
    const sel = $('rtcSel');
    if (!sel) return;
    for (const [id, name] of RT_CONTESTS) sel.add(new Option(name, id));
    const ui = () => {
      sel.value = rtcId();
      $('rtcExch').value = rtcExch();
      $('rtcExch').disabled = !rtcOn();
      $('rtcCqz').value = store.get('rtcqz', '14');
      $('rtcName').value = store.get('rtcname', '');
      $('rtcItu').value = store.get('rtitu', '27');
      $('rtContest').classList.toggle('on', rtcOn());
      drawRttyMacros();
    };
    sel.addEventListener('change', () => {
      store.set('rtc', sel.value);
      ui();
      if (api && sel.value) api.say('Contest ' + sel.options[sel.selectedIndex].text + ' : touches F1 à F12 = macros contest, échange « ' + macroText('<EXCH>') + ' ».', '', 5000);
    });
    $('rtcExch').addEventListener('change', () => { store.set('rtcx_' + rtcId(), $('rtcExch').value.toUpperCase().trim() || '599 <CNTR>'); ui(); });
    $('rtcName').addEventListener('change', () => { store.set('rtcname', $('rtcName').value.toUpperCase().trim()); ui(); });
    $('rtcCqz').addEventListener('change', () => { store.set('rtcqz', String(Number($('rtcCqz').value) || 14)); ui(); });
    $('rtcItu').addEventListener('change', () => { store.set('rtitu', String(Number($('rtcItu').value) || 27)); ui(); });
    $('rtcNr').addEventListener('change', () => { store.set('cntr', String(Math.max(1, Number($('rtcNr').value) || 1))); ui(); });
    $('rtcNr1').addEventListener('click', () => { store.set('cntr', '1'); store.set('cntrcall', ''); ui(); });
    const nrAdd = (k) => { store.set('cntr', String(Math.max(1, (Number(store.get('cntr', '1')) || 1) + k))); store.set('cntrcall', ''); ui(); };
    $('rtcNrM').addEventListener('click', () => nrAdd(-1));
    $('rtcNrP').addEventListener('click', () => nrAdd(1));
    ui();
    // Hauteur des fenêtres de décodage RTTY (les deux VFO) : poignée sous elles, gardée dans ce navigateur
    const dual = $('rtDual'), grip = $('rtHGrip');
    const setH = (h, save) => {
      if (h == null) { dual.style.removeProperty('height'); dual.style.removeProperty('flex'); if (save) store.set('rtdualh', ''); }
      else { h = Math.max(220, Math.round(h)); dual.style.height = h + 'px'; dual.style.flex = 'none'; if (save) store.set('rtdualh', String(h)); }
      if (tab === 'rtty') sizeCanvas();
    };
    if (Number(store.get('rtdualh', '')) > 0) setH(Number(store.get('rtdualh', '')), false);
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const y0 = e.clientY, zf = (window.RSZOOM && window.RSZOOM.z()) || 1, h0 = dual.getBoundingClientRect().height / zf;
      const mv = (ev) => setH(h0 + (ev.clientY - y0) / zf, false);
      const up = (ev) => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); setH(h0 + (ev.clientY - y0) / zf, true); };
      grip.addEventListener('pointermove', mv);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('dblclick', () => setH(null, true));
  }

  // ------------------------------------------------------------------ éditeur de macros (fenêtre de dialogue)
  function editMacro(doc, mode, idx) {
    const list = macroList(mode).map((m) => Object.assign({}, m));
    while (mode !== 'FT8' && list.length < (mode === 'JTTY' ? 8 : 12)) list.push({ name: '', text: '' });
    let cur = Math.min(idx, list.length - 1);
    const old = doc.getElementById('macroDlg');
    if (old) old.remove();
    const dlg = doc.createElement('dialog');
    dlg.id = 'macroDlg';
    dlg.className = 'macro-dlg';
    dlg.innerHTML = '<form method="dialog">' +
      '<h3>Macros ' + (mode === 'RTTYC' ? 'contest RTTY' : mode === 'CWC' ? 'contest CW' : mode) + '</h3>' +
      '<div class="md-keys"></div>' +
      '<label>Nom du bouton <input name="name" maxlength="14" autocomplete="off"></label>' +
      '<label>Texte <textarea name="text" rows="6" spellcheck="false"></textarea></label>' +
      '<div class="md-tags"></div>' +
      '<p class="md-prev"></p>' +
      '<div class="md-act"><button class="btn" value="reset" type="button" data-a="reset">Défaut</button>' +
      '<span></span><button class="btn" value="cancel" data-a="cancel">Annuler</button><button class="btn btn-primary" type="button" data-a="save">Enregistrer</button></div>' +
      '</form>';
    doc.body.appendChild(dlg);
    const f = dlg.querySelector('form');
    const keys = dlg.querySelector('.md-keys');
    const prev = () => { dlg.querySelector('.md-prev').textContent = 'Aperçu : ' + (mode === 'CW' || mode === 'CWC' ? cwText(f.text.value) : macroText(f.text.value)).replace(/\n/g, ' ⏎ '); };
    const keep = () => { list[cur] = { name: f.name.value.trim(), text: f.text.value }; };
    const show = () => {
      keys.textContent = '';
      list.forEach((m, i) => {
        const k = doc.createElement('button');
        k.type = 'button';
        k.className = 'btn' + (i === cur ? ' on' : '');
        k.textContent = (mode === 'RTTY' ? 'F' + (i + 1) + ' ' : '') + (m.name || '—');
        k.addEventListener('click', () => { keep(); cur = i; show(); });
        keys.appendChild(k);
      });
      f.name.value = list[cur].name || '';
      f.text.value = list[cur].text || '';
      prev();
    };
    for (const [tag, help] of TAGS) {
      if (tag[0] === '#') { const h = doc.createElement('span'); h.className = 'md-tgh'; h.textContent = tag.slice(1); dlg.querySelector('.md-tags').appendChild(h); continue; }
      const t = doc.createElement('button');
      t.type = 'button';
      t.className = 'md-tag';
      t.textContent = tag;
      t.title = help;
      t.addEventListener('click', () => {
        const ta = f.text;
        const a = ta.selectionStart, z = ta.selectionEnd;
        ta.value = ta.value.slice(0, a) + tag + ta.value.slice(z);
        ta.selectionStart = ta.selectionEnd = a + tag.length;
        ta.focus();
        prev();
      });
      dlg.querySelector('.md-tags').appendChild(t);
    }
    f.text.addEventListener('input', prev);
    dlg.querySelector('[data-a="reset"]').addEventListener('click', () => {
      const d = (DEF_MACROS[mode] || [])[cur] || { name: '', text: '' };
      f.name.value = d.name; f.text.value = d.text; prev();
    });
    dlg.querySelector('[data-a="save"]').addEventListener('click', () => {
      keep();
      const clean = list.filter((m, i) => mode === 'RTTY' || m.name || m.text);
      macros[mode] = clean;
      store.set('macros', JSON.stringify(macros));
      if (api) api.send({ t: 'macros_set', mode, list: clean });
      dlg.close();
      redrawMacros();
    });
    dlg.addEventListener('close', () => dlg.remove());
    show();
    dlg.showModal();
  }
  function editFree(doc) {
    const v = (doc.defaultView || window).prompt('Texte libre FT8 / FT4 (13 caractères au plus : lettres, chiffres, espace + - . / ?)', store.get('ftxfree', ''));
    if (v == null) return;
    store.set('ftxfree', String(v).toUpperCase().replace(/[^A-Z0-9 +\-./?]/g, '').slice(0, 13));
    drawMsgs();
  }
  function redrawMacros() {
    drawMsgs();
    drawRttyMacros();
    drawMacroRow($('jtMacros'), 'JTTY', (t, ins) => useMacro('JTTY', t, ins));
    drawMacroRow($('cwMacros'), 'CW', (t, ins) => useMacro('CW', t, ins), cwPrepMacro);
  }
  // Clic sur une macro (ou F1…F12) : <TX> = émission immédiate, sinon texte ajouté à la zone d'écriture.
  // Maj+clic : toujours ajouter à la zone (pour composer un message avant « Émettre »).
  function useMacro(mode, t, ins) {
    if (mode === 'CW') {
      if (/<LOG>/i.test(t) && !ins) setTimeout(() => logQso(), 0);
      if (ins || !/<TX>/i.test(t)) return insertCw(t);
      if (/<CALL>|\{CALL\}/.test(t) && !String(dx.call || '').trim()) {
        return api && api.say('Pas de correspondant : double-cliquez d’abord sur son indicatif (ou tapez-le dans « Correspondant »).', 'warn');
      }
      return cwSend(cwText(t, true), false);
    }
    if (/<LOG>/i.test(t) && !ins) setTimeout(() => logQso(), 0);
    // Macro « TX » seule (sans texte) : émission du texte tapé ; « RX » seule : retour en réception (arrêt de l'émission)
    const bare = String(t).replace(/<TX>|<RX>/gi, '').trim();
    if (!ins && !bare && /<RX>/i.test(t) && !/<TX>/i.test(t)) {
      const x = api && api.state() && api.state().ftx;
      if (x && x.mode === mode) return api.send({ t: 'ftx_stop' });
      return api && api.say('Déjà en réception.', '', 2000);
    }
    if (!ins && !bare && /<TX>/i.test(t)) return dtxClick(mode);
    if (ins || !/<TX>/i.test(t)) return mode === 'JTTY' ? insertJtty(t) : insertRtty(t);
    showTab(mode === 'JTTY' ? 'jtty' : 'rtty');
    if (/<CALL>|\{CALL\}/.test(t) && !String(dx.call || '').trim()) {
      return api && api.say('Pas de correspondant : double-cliquez d’abord sur son indicatif (ou tapez-le dans « Correspondant »).', 'warn');
    }
    let text = macroText(t, true);
    if (mode === 'JTTY') text = text.replace(/\s*\n\s*/g, ' ').trim().toUpperCase();
    dtxSend(mode, text, false);
  }
  function insertRtty(t) {
    showTab('rtty');
    const ta = $('rtTxt');
    ta.value += macroText(t, true);
    ta.scrollTop = ta.scrollHeight;
    ta.focus();
  }
  function initMsgs() {
    for (const [id, k] of [['dxCall', 'call'], ['dxGrid', 'grid'], ['dxRpt', 'rpt'], ['rtCall', 'call'], ['dxName', 'name'], ['dxQth', 'qth'], ['dxRst', 'rst'], ['dxRptRx', 'rptRx'], ['dxRstRx', 'rstRx']]) {
      const el = $(id);
      if (el) el.addEventListener('input', () => setDx({ [k]: el.value.trim() }));
    }
    for (const id of ['dxLog']) { const b = $(id); if (b) b.addEventListener('click', () => { const inst = (window.DG && window.DG()) || window.RSDIGI; inst.logQso(); }); }
    document.querySelectorAll('#centerPanel [data-log]').forEach((b) => b.addEventListener('click', () => logQso()));
    syncDx();
  }
  // ------------------------------------------------------------------ fiche du QSO → carnet de la station (RTTY, JTTY, CW…)
  // Comme « Save QSO » / <LOG> de FLDIGI : correspondant, nom, QTH, locator, RST de la ligne Correspondant ; fréquence et mode du TRX.
  function logQso(docIn, modeIn) {
    if (!api) return;
    if (!window.RSLOG) return api.say('Carnet de trafic non disponible dans cette version du dashboard.', 'warn');
    // Page TRX CW : la fiche s'ouvre dans sa fenêtre, en CW
    const doc = (docIn && docIn.createElement ? docIn : null) || ($('msgs') && $('msgs').ownerDocument) || document;
    const old = doc.getElementById('qsoLogDlg');
    if (old) old.remove();
    const st = api.state() || {};
    const r = st.radio || {};
    const m = (typeof modeIn === 'string' && modeIn) || (window.RSDIGI && window.RSDIGI.logMode ? window.RSDIGI.logMode() : '') || 'RTTY';
    // Double réception : le VFO d'émission (TX sur MAIN ou SUB) ; sinon le VFO sélectionné
    const rxB = r.dualRx === 1 && (r.txVfo === 0 || r.txVfo === 1) ? r.txVfo === 1 && r.freqB : r.vfoSel === 1 && r.freqB;
    let hz = Number(rxB ? r.freqB : r.freq) || 0;
    // RTTY : fréquence du signal (porteuse + milieu mark / space), comme FLDIGI
    // RTTY : fréquence du signal suivi par le décodeur de l'émission (porteuse ± audio, − en LSB)
    if (m === 'RTTY') { const d = rtDialOf(rtTx); if (d) hz = d.hz + d.sign * Math.round(rts[rtTx].f); }
    const p2 = (n) => String(n).padStart(2, '0');
    const end = new Date(now());
    const t0 = Number(dx.t0) && end - Number(dx.t0) < 3 * 3600 * 1000 && end - Number(dx.t0) >= 0 ? new Date(Number(dx.t0)) : end;
    const hhmm = (d) => p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes());
    const ymd = (d) => d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
    const digiRpt = ['FT8', 'FT4', 'FT2', 'JT65', 'WSPR'].indexOf(m) >= 0;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const MODES = ['RTTY', 'JTTY', 'CW', 'SSTV', 'FT8', 'FT4', 'FT2', 'JT65', 'PSK31', 'USB', 'LSB', 'FM', 'AM'];
    // Contest RTTY choisi : échange envoyé (sans le 599) et reçu, identifiant Cabrillo du contest
    // Échange envoyé : celui émis à ce correspondant (macro avec <EXCH>), sinon l'échange à lui donner (report fixe, zone…
    // ou n° de série de ce QSO) ; le n° de série passe au suivant quand le QSO est enregistré
    const dxc = String(dx.call || '').trim().toUpperCase();
    const sentTo = (fn) => String(dxc && store.get('rtclastxc', '') === dxc ? store.get('rtclastx', fn('<EXCH>')) : fn('<EXCH>')).replace(/\b5NN\b/g, '599').replace(/^(599|5NN)\s*/, '');
    const ctst = m === 'RTTY' && rtcOn() ? { id: rtcId(), stx: sentTo(macroText), nr: /<CNTR>|<SERNO>/i.test(rtcExch()) }
      : m === 'CW' && cwcOn() ? { id: cwcId(), stx: sentTo(cwText), nr: /<CNTR>|<SERNO>/i.test(cwcExch()) } : null;
    const dlg = doc.createElement('dialog');
    dlg.id = 'qsoLogDlg';
    dlg.className = 'macro-dlg qso-log';
    dlg.innerHTML = '<form method="dialog"><h3>Enregistrer le QSO</h3><div class="ql-g">' +
      '<label>Indicatif <input name="call" maxlength="15" value="' + esc(dx.call) + '"></label>' +
      '<label>Date UTC <input name="date" type="date" value="' + ymd(t0) + '"></label>' +
      '<label>Début UTC <input name="time" maxlength="5" value="' + hhmm(t0) + '"></label>' +
      '<label>Fin UTC <input name="toff" maxlength="5" value="' + hhmm(end) + '"></label>' +
      '<label>Fréquence MHz <input name="freq" inputmode="decimal" value="' + (hz ? (hz / 1e6).toFixed(6) : '') + '"></label>' +
      '<label>Mode <select name="mode">' + MODES.concat(MODES.indexOf(m) < 0 ? [m] : []).map((x) => '<option' + (x === m ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></label>' +
      '<label>RST envoyé <input name="rst_sent" maxlength="8" value="' + esc(digiRpt ? dx.rpt || '-10' : dx.rst || '599') + '"></label>' +
      '<label>RST reçu <input name="rst_rcvd" maxlength="8" value="' + esc(digiRpt ? dx.rptRx || '' : dx.rstRx || '599') + '"></label>' +
      '<label>Nom <input name="name" maxlength="40" value="' + esc(dx.name) + '"></label>' +
      '<label>QTH <input name="qth" maxlength="60" value="' + esc(dx.qth) + '"></label>' +
      '<label>Locator <input name="grid" maxlength="8" value="' + esc(dx.grid) + '"></label>' +
      '<label>Puiss. W <input name="pwr" inputmode="decimal" maxlength="5" value="' + (r.power ? Math.round(r.power) : '') + '"></label>' +
      (ctst ? '<label>Échange envoyé <input name="stx" maxlength="30" value="' + esc(ctst.stx) + '"></label>' +
        '<label>Échange reçu <input name="srx" maxlength="30" value=""></label>' +
        '<label>Contest <input name="contest" maxlength="40" value="' + esc(ctst.id) + '"></label>' : '') +
      '<label class="ql-wide">Remarque <input name="comment" maxlength="200"></label></div>' +
      '<p class="md-prev ql-msg"></p>' +
      '<div class="md-act">' + (window.RSSPOT ? RSSPOT.html() : '<span></span>') + '<button class="btn" value="cancel">Annuler</button><button class="btn btn-primary" type="button" data-a="save">Enregistrer dans le carnet</button></div></form>';
    doc.body.appendChild(dlg);
    const f = dlg.querySelector('form');
    const msg = dlg.querySelector('.ql-msg');
    f.mode.addEventListener('change', () => {
      const d = ['FT8', 'FT4', 'FT2', 'JT65'].indexOf(f.mode.value) >= 0;
      const ph = ['USB', 'LSB', 'FM', 'AM'].indexOf(f.mode.value) >= 0;
      f.rst_sent.value = d ? dx.rpt || '-10' : ph ? '59' : dx.rst || '599';
      f.rst_rcvd.value = d ? dx.rptRx || '' : ph ? '59' : dx.rstRx || '599';
    });
    dlg.querySelector('[data-a="save"]').addEventListener('click', () => {
      const call = f.call.value.trim().toUpperCase();
      const fr = Number(String(f.freq.value).replace(',', '.'));
      const tt = (v) => { const t = String(v).replace(/\D/g, ''); return (t.length === 3 ? '0' + t : t).padEnd(6, '0').slice(0, 6); };
      if (!/^(?=.*[0-9])[A-Z0-9/]{3,15}$/.test(call)) { msg.textContent = 'Indicatif du correspondant ?'; f.call.focus(); return; }
      if (!(fr > 0)) { msg.textContent = 'Fréquence en MHz ? (ex. 14.085)'; f.freq.focus(); return; }
      const qso = { call, qso_date: f.date.value.replace(/\D/g, ''), time_on: tt(f.time.value), time_off: tt(f.toff.value), freq: Math.round(fr * 1e6) / 1e6,
        mode: f.mode.value, rst_sent: f.rst_sent.value.trim(), rst_rcvd: f.rst_rcvd.value.trim(), name: f.name.value.trim(), qth: f.qth.value.trim(),
        gridsquare: f.grid.value.trim().toUpperCase(), tx_pwr: f.pwr.value.trim(), comment: f.comment.value.trim(), station: myCall };
      if (f.contest) {
        qso.contest_id = f.contest.value.trim().toUpperCase();
        qso.stx_string = f.stx.value.trim().toUpperCase();
        qso.srx_string = f.srx.value.trim().toUpperCase();
        if (/^\d{1,5}$/.test(qso.stx_string)) qso.stx = qso.stx_string;
        if (/^\d{1,5}$/.test(qso.srx_string)) qso.srx = qso.srx_string;
      }
      for (const k of Object.keys(qso)) if (qso[k] === '') delete qso[k];
      api.send({ t: 'log_add', qso, spot: !!(window.RSSPOT && RSSPOT.on()) });
      if (ctst && ctst.nr && qso.contest_id) cntrAfterLog(call); // n° de série suivant (une fois par correspondant)
      dlg.close();
    });
    dlg.addEventListener('close', () => dlg.remove());
    try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
    (dx.call ? f.querySelector('[data-a="save"]') : f.call).focus();
  }

  // QSO de contest enregistré : n° de série suivant, une fois par correspondant (pas si la macro TU <INCR> l'a déjà fait)
  function cntrAfterLog(call) {
    const who = String(call || '').toUpperCase().trim() || '?';
    let n = Number(store.get('cntr', '1')) || 1;
    if (store.get('cntrcall', '') === who + '|' + n) return;
    n++;
    store.set('cntr', n);
    store.set('cntrcall', who + '|' + n);
    if ($('rtcNr') && document.activeElement !== $('rtcNr')) $('rtcNr').value = String(n).padStart(3, '0');
  }
  function setTx(f, side) {
    const v = Math.max(100, Math.min(WF_TOP - 100, Math.round(f)));
    if (side === 'B') { txFB = v; store.set('txfb', v); } else { txF = v; store.set('txf', v); }
    drawScale();
    ftxCfg();
    bmDraw();
    sendView();
  }
  function setRx(f, side) {
    const v = Math.max(100, Math.min(WF_TOP - 100, Math.round(f)));
    if (side === 'B') {
      rxFB = v;
      store.set('rxfb', v);
      drawScale();
      if (tab === 'jtty') jtRedrawB();
      return redrawRx('B');
    }
    rxF = v;
    store.set('rxf', rxF);
    drawScale();
    bmDraw();
    redrawRx();
    if (tab === 'jtty') jtRedraw();
    sendView();
  }

  // ------------------------------------------------------------------ listes de messages
  const hist = []; // { slot, mode, list }
  const histB = []; // décodages du récepteur SUB (VFO-B), FTDX101 en double réception
  const pad = (n) => String(n).padStart(2, '0');
  // FT2 : périodes de 3,75 s (…:18,75) → dixième de seconde affiché
  const utc = (ms) => { const d = new Date(ms); return pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + (ms % 1000 ? '.' + Math.floor((ms % 1000) / 100) : ''); };
  const callsIn = (msg) => msg.toUpperCase().split(/\s+/).map((w) => w.replace(/^<|>$|;$/g, ''));
  // Message DXpédition du FOX : « K1ABC RR73; W9XYZ <KH7Z> -08 » → indicatif du FOX (4e mot)
  const foxOf = (msg) => { const x = /^\S+ RR73; \S+ <?([A-Z0-9/]+)>? [+-]\d{2}$/.exec(String(msg || '').toUpperCase().trim()); return x ? x[1] : ''; };
  function cls(msg) {
    const w = callsIn(msg);
    if (w.some((x) => stationCalls.indexOf(x) >= 0)) return 'me';
    if (w[0] === 'CQ') return 'cq';
    return '';
  }
  // Indicatif de la station qui émet ce message (celui que reprend un double-clic), sinon ''
  function senderOf(msg) {
    if (foxOf(msg)) return CALL_RE.test(foxOf(msg)) ? foxOf(msg) : '';
    if (/^\$VERIFY\$/.test(String(msg))) return '';
    const w = callsIn(msg);
    const c = w[0] === 'CQ' ? (CALL_RE.test(w[1] || '') ? w[1] : w[2] || '') : w[1] || '';
    return CALL_RE.test(c) && stationCalls.indexOf(c) < 0 && String(msg).toUpperCase().indexOf(c) >= 0 ? c : '';
  }
  // Stations déjà contactées sous le TX CALL actuel (envoyées par le serveur) : « INDICATIF|BANDE|MODE »
  let worked = new Set();
  let workedStation = '';
  function curBand(side) {
    const st = api && api.state && api.state();
    const f = st && st.radio && ((side ? side === 'B' : st.radio.vfoSel === 1) ? st.radio.freqB : st.radio.freq);
    const mhz = f ? f / 1e6 : 0;
    const b = BANDS_M.find((x) => mhz >= x[0] && mhz <= x[1]);
    return b ? b[2] : '';
  }
  function isWorked(msg, side) {
    if (!worked.size || FT_MODES.indexOf(mode) < 0) return false;
    const c = senderOf(msg);
    return !!c && worked.has(c + '|' + curBand(ftDual ? side || 'A' : '') + '|' + mode);
  }
  function rowEl(slot, d, side) {
    const r = document.createElement('div');
    const k = d.tx ? 'tx' : cls(d.msg);
    const wk = !d.tx && k !== 'me' && isWorked(d.msg, side);
    r.className = 'dg-row ft ' + k + (wk ? ' wkd' : '');
    r.title = d.tx ? 'Message émis' : (wk ? 'Déjà contacté sous ' + workedStation + ' sur cette bande dans ce mode · ' : '') + d.f + ' Hz · clic sur l’indicatif (souligné) ou double-clic : répondre à cette station (émission à la période suivante) · clic ailleurs : réception ici · clic droit : émission ici';
    const cells = d.tx ? [utc(slot), 'TX', '', d.f, d.msg] : [utc(slot), (d.db >= 0 ? '+' : '') + d.db, d.dt.toFixed(1), d.f, d.msg];
    // Pays DXCC, distance et azimut (direction de l'antenne) : dans l'info-bulle de l'indicatif (et de la ligne)
    const geo = d.tx ? '' : [d.cty || '', d.km == null ? '' : (d.kmc ? '≈ ' : '') + d.km + ' km', d.az == null ? '' : 'azimut ' + d.az + '°'].filter(Boolean).join(' · ');
    if (geo) r.title = senderOf(d.msg) + ' — ' + geo + '\n' + r.title;
    cells.forEach((v, i) => {
      const s = document.createElement('span');
      if (i === 4) s.className = 'msg';
      const who = !d.tx && i === 4 ? senderOf(d.msg) : '';
      if (!who) s.textContent = String(v);
      else {
        // Indicatif de la station qui émet ce message : un clic dessus = lui répondre (comme le double-clic)
        const k = String(v).indexOf(who);
        s.appendChild(document.createTextNode(String(v).slice(0, k)));
        const c = document.createElement('b');
        c.className = 'dg-call';
        c.textContent = who;
        c.title = who + (geo ? ' — ' + geo : '') + '\nClic : répondre à ' + who + ' (émission à la période suivante, avec la main)';
        c.addEventListener('click', (e) => { e.stopPropagation(); pickFromDecode(d, slot, side); });
        s.appendChild(c);
        s.appendChild(document.createTextNode(String(v).slice(k + who.length)));
      }
      r.appendChild(s);
    });
    // Partie d'un message SuperFox : repère « SF » (et « OTP » pour la vérification du FOX)
    if (!d.tx && d.sf && r.querySelector('span.msg')) {
      const a = document.createElement('i');
      a.className = 'dg-sf';
      a.textContent = d.sf === 4 ? ' OTP' : ' SF';
      a.title = d.sf === 4 ? 'Mot de passe à usage unique (OTP) du SuperFox : il prouve que le signal vient bien de la DXpédition (vérifiable sur 9dx.cc avec l’indicatif, la date et l’heure)'
        : 'Partie d’un message SuperFox (un seul signal large qui s’adresse à plusieurs stations à la fois)';
      r.querySelector('span.msg').appendChild(a);
      r.classList.add('sf');
    }
    // Décodage aidé « a priori » (AP) : repère « a1 »… après le message, comme WSJT-X
    if (!d.tx && d.ap > 0 && r.querySelector('span.msg')) {
      const a = document.createElement('i');
      a.className = 'dg-ap';
      a.textContent = ' a' + d.ap;
      a.title = 'Décodé avec l’aide a priori (AP) de WSJT-X : le décodeur a supposé une partie du message (CQ, notre indicatif, celui du correspondant…). Fiable, mais à confirmer si le signal est très faible.';
      r.querySelector('span.msg').appendChild(a);
    }
    // Pays DXCC, distance et azimut de la station qui émet (calculés par le serveur depuis le locator du club)
    const ex = [[d.tx ? '' : d.pfx || '', 'x pfx', d.pfx ? 'Préfixe DXCC : ' + d.pfx + (d.cty ? ' (' + d.cty + ')' : '') : ''],
      [d.tx ? '' : d.cty || '', 'x cty', d.cty ? d.cty : ''],
      [d.tx || d.km == null ? '' : (d.kmc ? '≈' : '') + d.km, 'x', d.km == null ? '' : (d.kmc ? 'Distance approximative (centre du pays : pas de locator dans le message)' : 'Distance depuis le locator du club')],
      [d.tx || d.az == null ? '' : d.az + '°', 'x', d.az == null ? '' : 'Azimut (direction de l’antenne) depuis le club']];
    for (const [t, c, ti] of ex) { const e = document.createElement('span'); e.className = c; e.textContent = t; if (ti) e.title = ti; r.appendChild(e); }
    r.addEventListener('click', () => setRx(d.f, side));
    r.addEventListener('contextmenu', (e) => { e.preventDefault(); setTx(d.f, side); });
    r.addEventListener('dblclick', () => { if (!d.tx) pickFromDecode(d, slot, side); });
    return r;
  }
  function sepEl(slot, m) {
    const s = document.createElement('div');
    s.className = 'dg-sep';
    const d = new Date(slot);
    s.textContent = '— ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + (slot % 1000 ? '.' + Math.floor((slot % 1000) / 100) : '') + ' UTC · ' + m + ' —';
    return s;
  }
  function stickToBottom(el, fn) {
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    fn();
    while (el.children.length > 400) el.removeChild(el.firstChild);
    if (atEnd) el.scrollTop = el.scrollHeight;
  }
  // Ordre chronologique : les décodages de la passe profonde (quelques secondes après la fin de la période) et
  // nos émissions sont rangés à leur place (période, puis émission avant les décodages de cette période)
  const slotKey = (item, rank) => {
    const P = SLOT_MS[item.mode] || 15000;
    return Math.floor((item.slot + (item.tx ? 600 : 0)) / P) * P * 10 + rank;
  };
  function insertSorted(list, el, key) {
    el.dataset.k = String(key);
    let ref = null;
    for (let c = list.lastElementChild; c && Number(c.dataset.k || 0) > key; c = c.previousElementSibling) ref = c;
    list.insertBefore(el, ref);
  }
  function addSlot(item, quiet, side) {
    const B = side === 'B';
    if (B && !ftDual) return;
    const band = $(B ? 'dgBandB' : 'dgBand');
    // Une seule ligne de séparation par période (passes anticipée, normale et profonde, émission), dans les deux listes
    const sep = (list) => {
      const sk = slotKey(item, 0);
      if (!list.querySelector('.dg-sep[data-k="' + sk + '"]')) {
        const P = SLOT_MS[item.mode] || 15000;
        insertSorted(list, sepEl(Math.floor((item.slot + (item.tx ? 600 : 0)) / P) * P, item.mode), sk);
      }
    };
    stickToBottom(band, () => {
      if (item.list.length) sep(band);
      for (const d of item.list) insertSorted(band, rowEl(item.slot, d, side), slotKey(item, item.tx ? 1 : 2));
    });
    const mine = item.slot > rxCut[B ? 'B' : 'A'] ? item.list.filter((d) => inRx(d, side)) : [];
    if (mine.length) {
      const rx = $(B ? 'dgRxB' : 'dgRx');
      stickToBottom(rx, () => { sep(rx); for (const d of mine) insertSorted(rx, rowEl(item.slot, d, side), slotKey(item, item.tx ? 1 : 2)); });
    }
  }
  // « Effacer » de la colonne Fréquence RX : messages d'avant ce moment-là retirés de cette liste seulement
  const rxCut = { A: 0, B: 0 };
  function inRx(d, side) { return d.tx || Math.abs(d.f - (side === 'B' ? rxFB : rxF)) <= RX_WIDTH || cls(d.msg) === 'me'; }
  function redrawRx(side) {
    const B = side === 'B';
    if (B && !ftDual) return;
    const rx = $(B ? 'dgRxB' : 'dgRx');
    if (!rx) return;
    rx.textContent = '';
    for (const it of B ? histB : hist) {
      if (it.mode !== mode || it.slot <= rxCut[B ? 'B' : 'A']) continue;
      const mine = it.list.filter((d) => inRx(d, side));
      if (!mine.length) continue;
      const sk = slotKey(it, 0);
      if (!rx.querySelector('.dg-sep[data-k="' + sk + '"]')) { const P = SLOT_MS[it.mode] || 15000; insertSorted(rx, sepEl(Math.floor((it.slot + (it.tx ? 600 : 0)) / P) * P, it.mode), sk); }
      for (const d of mine) insertSorted(rx, rowEl(it.slot, d, side), slotKey(it, it.tx ? 1 : 2));
    }
    rx.scrollTop = rx.scrollHeight;
  }
  function redrawAll() {
    $('dgBand').textContent = '';
    $('dgBand').dataset.sep = '';
    for (const it of hist) if (it.mode === mode) addSlot(it, true);
    redrawRx();
    if (!ftDual || !$('dgBandB')) return;
    $('dgBandB').textContent = '';
    for (const it of histB) if (it.mode === mode) addSlot(it, true, 'B');
    redrawRx('B');
  }

  // ------------------------------------------------------------------ état, horloge, QSY
  function fillDial() {
    const sel = $('dgDial');
    sel.textContent = '';
    fillList(sel, dialList(mode));
    // Par défaut : la fréquence d'appel de la bande où se trouve le TRX
    const st = api && api.state();
    const f = st && st.radio && st.radio.freq;
    const near = f && nearList(mode, f).length ? nearList(mode, f).reduce((a, x) => (Math.abs(x[1] * 1000 - f) < Math.abs(a[1] * 1000 - f) ? x : a)) : null;
    const saved = store.get('dial.' + mode, '');
    if (near && Math.abs(near[1] * 1000 - f) < 500000) sel.value = String(near[1]);
    else if (f) {
      // Pas de fréquence d'appel de ce mode sur la bande du TRX (ex. FT4 sur 70 cm) : on le dit au lieu d'afficher 80 m
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'Pas de fréquence ' + mode + ' sur cette bande';
      o.disabled = true;
      sel.insertBefore(o, sel.firstChild);
      sel.value = '';
    } else if (saved) sel.value = saved;
  }
  function setMode(m) {
    mode = m;
    if (m !== 'JT65') store.set('ftmode', m);
    modeChanged();
    announce();
  }
  // Liste Période : début et fin (s) de la 1re et de la 2e période du mode (FT8 0/15 · 15/30, FT4 0/7,5 · 7,5/15, FT2 0/3,75 · 3,75/7,5)
  function parLabels() {
    const p = $('dgPar');
    if (!p) return;
    const L = { FT8: 15, FT4: 7.5, FT2: 3.75 }[mode] || 15;
    const f = (x) => String(x).replace('.', ',');
    p.options[1].textContent = '0/' + f(L);
    p.options[2].textContent = f(L) + '/' + f(2 * L);
  }
  function modeChanged() {
    parLabels();
    document.querySelectorAll('#dgModes .btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    applyFtDual();
    lastBand = 0;
    fillDial();
    drawScale();
    redrawAll();
    bmFiltDraw(); // carte de bande : plage du nouveau mode (FT8 / FT4 / FT2)
    bmDraw();
  }
  function qsy() {
    if (!api) return;
    if (!api.iControl()) return api.say('Prenez la main pour changer de fréquence.', 'warn');
    const st = api.state();
    if (st && st.ptt && st.ptt.active) return api.say('Réglage bloqué pendant l’émission.', 'warn');
    const khz = Number($('dgDial').value);
    if (!khz) return api.say('Choisissez d’abord une fréquence d’appel dans la liste.', 'warn');
    store.set('dial.' + mode, khz);
    qsyTo(khz);
  }
  function qsyTo(khz, want) {
    if (!api.iControl()) {
      lastBand = 0; // la liste revient sur la bande réelle du TRX
      if ($('rtDial')) $('rtDial').value = store.get('rtdial', '14085');
      if ($('cwDial')) $('cwDial').value = store.get('cwdial', '14030');
      return api.say('Prenez la main pour changer de fréquence.', 'warn');
    }
    const st = api.state();
    if (st && st.ptt && st.ptt.active) return api.say('Réglage bloqué pendant l’émission.', 'warn');
    api.setFreq(Math.round(khz * 1000), 'A', true);
    // Mode DATA-U (Yaesu) / USB-D (Icom) : le filtre et la sortie audio conviennent aux modes numériques
    const R = api.rig();
    // CW : côté bas (CW-L ; CW-R sur Icom) sous 10 MHz, côté haut (CW-U ; CW sur Icom) au-dessus — comme la phonie
    const mk = want === 'CW'
      ? (khz < 10000 ? (R.MODE_KEYS || []).find((x) => /^(CW-L|CW-R|CW-LSB)$/i.test(x[1])) : null)
        || (R.MODE_KEYS || []).find((x) => /^(CW-U|CW|CW-USB)$/i.test(x[1]))
      : (R.MODE_KEYS || []).find((x) => /^(DATA-U|USB-D|D-U|USB-DATA)$/i.test(x[1])) || (R.MODE_KEYS || []).find((x) => /^USB$/i.test(x[1]));
    if (mk) {
      // Changement de bande : certains TRX (FTX-1) rappellent ensuite le mode mémorisé de la bande, par-dessus le nôtre.
      // Le mode est donc renvoyé tant que le TRX ne le confirme pas (2 essais de plus).
      const want = (n) => {
        const r = api.state() && api.state().radio;
        if (n && r && r.mode === mk[1]) return;
        api.send({ t: 'set', mode: mk[0], sub: false });
        if (n < 2) setTimeout(() => want(n + 1), 1200);
      };
      setTimeout(() => want(0), 30);
    }
  }
  // Clic sur un onglet de mode numérique (avec la main) : TRX mis en DATA-U (USB-D sur l'IC-7300) sur le VFO écouté,
  // même sous 10 MHz (les modes numériques se font toujours en bande latérale supérieure)
  const DATA_TABS = { ftx: 'FT8 / FT4 / FT2', rtty: 'RTTY', wspr: 'WSPR', jt65: 'JT65', jtty: 'JTTY', sstv: 'SSTV' };
  // Pages des modes (onglets du dashboard, ligne MODES de la face avant)
  const PAGE_TABS = ['ftx', 'rtty', 'wspr', 'jt65', 'jtty', 'cw', 'sstv'];
  function popWin(url, name, w, h) {
    const x = window.open(url, name, window.RSWINPOS ? RSWINPOS.feat(name, w, h) : 'width=' + w + ',height=' + h);
    if (!x) { if (api) api.say('Fenêtre bloquée par le navigateur : autorisez les fenêtres pop-up pour ce site.', 'warn', 6000); return null; }
    try { x.focus(); } catch (e) {}
    return x;
  }
  function modeFor(t) {
    if (DATA_TABS[t]) dataU(DATA_TABS[t]);
    else if (t === 'cw') cwModeAuto();
    else if (t === 'ssb') ssbModeAuto();
  }
  // Dashboard : le mode choisi (sa page s'ouvre à part) reste marqué sur fond bleu azur dans la ligne MODES
  function markPicked(t) {
    if (POPUP) return;
    document.querySelectorAll('#centerPanel .ctab').forEach((b) => b.classList.toggle('picked', !!t && b.dataset.tab === t));
    store.set('picked', t || '');
  }
  function openModePage(t) {
    markPicked(t);
    modeFor(t);
    if (t === 'cw') return popWin('/cw.html', 'rs-cwpage', 1240, 860);
    if (t === 'ssb') return popWin('/ssb.html', 'rs-ssbpage', 1240, 900);
    // Page des modes numériques (fenêtre séparée) sur ce mode ; déjà ouverte : elle y passe
    store.set('ptab', t);
    try {
      const d = window.DG && window.DG();
      if (d && d !== window.RSDIGI && d.goTab) { d.goTab(t); const w = window.open('', 'rs-digi'); if (w) w.focus(); return w; }
    } catch (e) {}
    return popWin(FACEP ? FACEP + '/digi.html' : '/digi.html', 'rs-digi', 1200, 860);
  }
  // Onglet SSB (avec la main) : LSB sous 10 MHz, USB au-dessus (60 m : USB), si le TRX n'est pas déjà en phonie BLU
  function ssbModeAuto() {
    if (!api || !api.iControl()) return;
    const st = api.state();
    const r = st && st.radio;
    if (!r || !r.connected || r.tx || (st.ptt && st.ptt.active) || st.ftx || st.cw) return;
    const side = r.vfoSel === 1;
    const cur = (side ? r.modeB : r.mode) || '';
    if (/^(LSB|USB)$/i.test(cur)) return;
    const hz = side ? r.freqB : r.freq;
    const K = api.rig().MODE_KEYS || [];
    const lsb = hz && hz < 10e6 && !(hz >= 5.3e6 && hz <= 5.5e6);
    const mk = K.find((x) => (lsb ? /^LSB$/i : /^USB$/i).test(x[1]));
    if (!mk) return;
    api.send({ t: 'set', mode: mk[0], sub: side });
    api.say('TRX mis en ' + mk[1] + ' pour la phonie.', '', 3000);
  }
  function dataU(label) {
    if (!api || !api.iControl()) return;
    const st = api.state();
    const r = st && st.radio;
    if (!r || !r.connected || r.tx || (st.ptt && st.ptt.active) || st.ftx || st.cw) return;
    const R = api.rig();
    const mk = (R.MODE_KEYS || []).find((x) => /^(DATA-U|USB-D|D-U|USB-DATA)$/i.test(x[1])) || (R.MODE_KEYS || []).find((x) => /^USB$/i.test(x[1]));
    const side = r.vfoSel === 1;
    if (!mk || (side ? r.modeB : r.mode) === mk[1]) return;
    api.send({ t: 'set', mode: mk[0], sub: side });
    api.say('TRX mis en ' + mk[1] + ' pour ' + label + '.', '', 3000);
  }
  // Clic sur l'onglet CW (avec la main) : TRX mis en CW sur le VFO écouté — CW-L sous 10 MHz, CW-U au-dessus
  // (IC-7300 : CW-R / CW), comme pour les spots et la liste de fréquences
  function cwModeAuto() {
    if (!api || !api.iControl()) return;
    const st = api.state();
    const r = st && st.radio;
    if (!r || !r.connected || r.tx || (st.ptt && st.ptt.active) || st.ftx || st.cw) return;
    const side = r.vfoSel === 1;
    const cur = (side ? r.modeB : r.mode) || '';
    if (/^CW/i.test(cur)) return; // déjà en CW (quel que soit le côté choisi)
    const hz = side ? r.freqB : r.freq;
    const R = api.rig();
    const K = R.MODE_KEYS || [];
    const mk = (hz && hz < 10e6 ? K.find((x) => /^(CW-L|CW-R|CW-LSB)$/i.test(x[1])) : null) || K.find((x) => /^(CW-U|CW|CW-USB)$/i.test(x[1]));
    if (!mk) return;
    api.send({ t: 'set', mode: mk[0], sub: side });
    api.say('TRX mis en ' + mk[1] + ' pour la CW.', '', 3000);
  }
  function autoQsy() {
    const st = api && api.state();
    const f = st && st.radio && st.radio.freq;
    const khz = Number($('dgDial').value);
    if (!f || !khz) return api.say('Pas de fréquence ' + mode + ' sur cette bande : choisissez une bande dans la liste puis QSY.', 'warn');
    if (Math.abs(f - khz * 1000) < 50 && st.radio.mode && /DATA|-D/i.test(st.radio.mode)) return; // déjà dessus
    if (!api.iControl()) return api.say('Prenez la main pour aller sur ' + khz.toLocaleString('fr-BE') + ' kHz (' + mode + ').', 'warn');
    qsy();
  }
  function status() {
    if (!api || (tab !== 'ftx' && tab !== 'jt65' && tab !== 'rtty')) return;
    const st = api.state();
    const el = $(tab === 'rtty' ? 'rtStatus' : 'dgStatus');
    let txt = '';
    let warn = false;
    if (!st || !st.station) { txt = 'Station hors ligne'; warn = true; }
    else if (!st.audio || !st.audio.active) { txt = 'La page Station n’envoie pas la BF : « Activer l’audio » sur le PC du club'; warn = true; }
    else if (tab === 'rtty') txt = ''; // RTTY : rien quand tout va bien (place pour les fenêtres de réception)
    else if (!lastDecode || Date.now() - lastDecode > (mode === 'JT65' ? 130000 : mode === 'FT8' ? 40000 : mode === 'FT2' ? 10000 : 20000)) txt = 'BF reçue · décodage au prochain cycle' + (mode === 'JT65' ? ' (vers la 52e seconde de chaque minute)' : '') + '…';
    else txt = 'BF reçue · décodage OK' + (st.digi && st.digi.engine === 'wsjtx' ? ' (moteur WSJT-X)' : '') + (st.digi && st.digi.latency != null ? ' · délai ' + st.digi.latency + ' ms' : '');
    if (st && st.radio && st.radio.mode && !/DATA|USB|-D/i.test(st.radio.mode)) { txt += ' · mode ' + st.radio.mode + ' : passez en DATA-U'; warn = true; }
    el.textContent = txt;
    el.classList.toggle('warn', warn);
  }
  const now = () => Date.now() + clockOff; // heure du serveur
  function progBar() {
    const bar = $('dgProgBar');
    if (!bar) return;
    const L = mode === 'FT8' ? 15 : mode === 'FT2' ? 3.75 : 7.5;
    const s = (now() / 1000) % L;
    const st = api && api.state();
    const txing = !!(st && ((st.ftx && st.ftx.state === 'tx') || (st.ptt && st.ptt.active) || (st.radio && st.radio.tx)));
    bar.style.width = (100 * s / L).toFixed(1) + '%';
    $('dgProg').classList.toggle('tx', txing);
    $('dgProgTxt').textContent = (txing ? 'TX ' : 'RX ') + s.toFixed(1).replace('.', ',') + ' s';
  }
  function clock() {
    progBar();
    const d = new Date(now());
    const L = mode === 'JT65' ? 60 : mode === 'FT8' ? 15 : mode === 'FT2' ? 3.75 : 7.5;
    const s = (d.getTime() / 1000) % L;
    $('dgClock').textContent = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' UTC · ' + (L - s).toFixed(L < 5 ? 1 : 0).padStart(2, ' ') + ' s';
  }

  // ------------------------------------------------------------------ synchro
  function medianDt() {
    const v = [];
    for (let i = hist.length - 1; i >= 0 && v.length < 80; i--) for (const d of hist[i].list) if (Math.abs(d.dt) < 2.5) v.push(d.dt);
    if (v.length < 3) return null;
    v.sort((a, b) => a - b);
    return { med: v[v.length >> 1], n: v.length };
  }
  // « Mettre à l'heure » le PC du club : bouton occupé pendant l'opération (≈ 10 s), résultat affiché sous la case
  let syBusy = 0;
  function sySync(state, msg) {
    const b = $('syClubSync');
    if (!b) return;
    clearTimeout(sySync.t);
    b.disabled = state === 'busy';
    b.classList.toggle('busy', state === 'busy');
    b.classList.toggle('done', state === 'ok');
    b.classList.toggle('fail', state === 'err');
    b.textContent = state === 'busy' ? '⏳ Mise à l’heure…' : state === 'ok' ? '✓ À l’heure' : state === 'err' ? '✗ Échec' : '⟳ Mettre à l’heure';
    const r = $('syClubRes');
    if (r && msg) r.textContent = msg;
    if (state === 'busy') sySync.t = setTimeout(() => sySync('err', 'pas de réponse de la page Station (rechargée ? assistant installé ?)'), 45000);
    else if (state !== 'idle') sySync.t = setTimeout(() => sySync('idle'), 8000);
  }
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('#syClubSync');
    if (!b || !api) return;
    syBusy = Date.now();
    sySync('busy', 'demande envoyée au PC du club…');
    api.send({ t: 'time_sync' });
  });
  function drawSync() {
    if (tab !== 'sync' || detached) return;
    const d = new Date(now());
    $('syVps').textContent = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
    if (bestRtt < Infinity) {
      const s = -clockOff / 1000; // positif : ce PC est en avance
      const ms = Math.round(-clockOff);
      const prec = Math.max(1, Math.round(bestRtt / 2)); // l'aller-retour le plus court borne l'incertitude
      // Moins d'une seconde : en millisecondes (comme NetTime / Meinberg) ; au-delà : en secondes
      $('syPc').textContent = Math.abs(s) < 1 ? (ms > 0 ? '+' : ms < 0 ? '−' : '') + Math.abs(ms) + ' ms' : (s > 0 ? '+' : '−') + Math.abs(s).toFixed(1).replace('.', ',') + ' s';
      $('syPc').className = Math.abs(s) < 1 ? 'ok' : 'warn';
      $('syPcNote').textContent = (Math.abs(ms) <= Math.max(prec, 20) ? 'à l’heure' : (s > 0 ? 'en avance' : 'en retard') + ' sur le serveur') + ' · précision ± ' + prec + ' ms (aucune incidence sur le décodage)';
    }
    const st = api && api.state();
    const fmtMs = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + (Math.abs(v) < 10 ? Math.abs(v).toFixed(1).replace('.', ',') : Math.round(Math.abs(v))) + ' ms';
    const ntp = st && st.digi && st.digi.ntp;
    if (ntp) {
      $('syNtp').textContent = ntp.synced === false ? 'NON SYNCHRONISÉ' : ntp.offsetMs != null ? fmtMs(ntp.offsetMs) : ntp.synced ? 'synchronisé' : '?';
      $('syNtp').className = ntp.synced === false || (ntp.offsetMs != null && Math.abs(ntp.offsetMs) > 50) ? 'warn' : 'ok';
      $('syNtpNote').textContent = !ntp.src && ntp.synced == null ? 'état inconnu : ni chrony ni timedatectl sur le serveur' :
        (ntp.src || 'NTP') + (ntp.server ? ' · ' + ntp.server : '') + (ntp.synced === false ? ' — à vérifier sur le VPS (chrony / timedatectl)' : ' · écart avec l’heure mondiale');
    }
    const club = st && st.digi && st.digi.club;
    if (club) {
      const prec = club.rtt != null ? Math.max(1, Math.round(club.rtt / 2)) : null;
      $('syClub').textContent = fmtMs(-club.off); // off = heure du serveur − heure du PC
      $('syClub').className = Math.abs(club.off) <= 1000 ? 'ok' : 'warn';
      $('syClubNote').textContent = (Math.abs(club.off) <= Math.max(prec || 0, 20) ? 'à l’heure' : (club.off < 0 ? 'en avance' : 'en retard') + ' sur le serveur') +
        (prec != null ? ' · précision ± ' + prec + ' ms' : '') + ' · corrigé pour l’émission';
    }
    const lat = st && st.digi && st.digi.latency;
    $('syLat').textContent = lat != null ? lat + ' ms' : '—';
    const m = medianDt();
    $('syDt').textContent = m ? (m.med >= 0 ? '+' : '−') + Math.abs(m.med).toFixed(1).replace('.', ',') + ' s' : '—';
    $('syDt').className = m ? (Math.abs(m.med) <= 0.3 ? 'ok' : 'warn') : '';
    // Passes du décodeur : heure d'arrivée après le début de la période (la réponse doit pouvoir partir à la suivante)
    let tm = st && st.digi && st.digi.timing;
    // Mesure ancienne (plus de décodage FT8 / FT4 depuis 1 min : onglet d'un autre mode, autre bande…) : pas affichée
    const tmT = tm && (tm.normal || tm.early || tm.deep) && (tm.normal || tm.early || tm.deep).t;
    if (tm && tmT && now() - tmT > 60000) {
      tm = null;
      $('syDec').textContent = '—';
      $('syDec').className = '';
      $('syDecNote').textContent = 'pas de décodage FT8 / FT4 depuis 1 min (service redémarré, ou mode FT2 / autre choisi dans l’onglet FT8)';
    }
    if (tm && $('syDec')) {
      // + temps passé dans le décodeur (attente + calcul) : petit = passe lancée en retard ; grand = décodeur lent ou occupé
      const f = (x) => (x ? '+' + (x.at / 1000).toFixed(1).replace('.', ',') + ' s' + (Number.isFinite(x.ms) ? ' (décodeur ' + (x.ms / 1000).toFixed(1).replace('.', ',') + ' s)' : '') : '—');
      const P = SLOT_MS[(tm.normal || tm.early || {}).mode] || 15000;
      $('syDec').textContent = tm.normal ? '+' + (tm.normal.at / 1000).toFixed(1).replace('.', ',') + ' s' : '—';
      $('syDec').className = tm.normal && tm.normal.at > P + 2000 ? 'warn' : 'ok';
      $('syDecNote').textContent = 'anticipée ' + f(tm.early) + ' · normale ' + f(tm.normal) + ' · profonde ' + f(tm.deep) +
        (tm.normal && tm.normal.at > P + 2000 ? ' — serveur lent : réponses parfois une période plus tard' : '');
    }
    $('syDtNote').textContent = m ? m.n + ' messages récents' + (Math.abs(m.med) > 0.3 ? ' · recalage en cours' : ' · calé') : 'en attente de décodages FT8 / FT4';
  }

  // ------------------------------------------------------------------ interface avec app.js
  window.RSDIGI = {
    spotQsy,
    /** Ligne DIGI CONFIGURATION de la face avant : afficher cet onglet (et ce mode FT8 / FT4 / FT2) */
    openModePage,
    modeFor,
    goTab(t, m) {
      if (MODE_TABS.indexOf(t) < 0) return false;
      if (t === 'ftx' && FT_MODES.indexOf(m) >= 0 && m !== mode) setMode(m);
      if (t !== tab) showTab(t);
      return true;
    },
    setDetached,
    followSync: (on) => setFollow(on, true), // « Suivre l'opérateur » changé sur la face avant
    curTab: () => (detached ? '' : tab), // onglet affiché (la face avant éclaire le bouton de ce mode)
    isPopup: POPUP,
    /** Mode numérique affiché (pour le carnet de trafic quand le TRX est en DATA) */
    logMode() {
      const t = tab;
      if (t === 'ftx') return mode;
      return { jt65: 'JT65', rtty: 'RTTY', jtty: 'JTTY', cw: 'CW', sstv: 'SSTV', wspr: 'WSPR' }[t] || store.get('ftmode', 'FT8');
    },
    qo100If: () => Object.assign({}, qoIf),
    /** Page « TRX CW » (cw.html) : macros CW, envoi de texte, correspondant, vitesse des macros */
    cwKit: {
      // Spots du DX cluster reçus (page TRX SSB : stations spotées sur la bande)
      spots: () => Array.from(bmSpots.values()),
      // TX CALL (pages TRX SSB / TRX CW) : indicatifs proposés et choix (avec la main : émission et carnet)
      txCalls() {
        if (!txcMe) return [];
        const clubs = txcMe.clubs.length ? txcMe.clubs : [txcMe.digiCall];
        return clubs.concat(txcMe.canTx && !txcMe.rxOnly && txcMe.call && clubs.indexOf(txcMe.call) < 0 ? [txcMe.call] : []).filter(Boolean);
      },
      isClubCall: (c) => !!txcMe && (txcMe.clubs.length ? txcMe.clubs : [txcMe.digiCall]).indexOf(c) >= 0,
      setTxCall(v) {
        if (!api || !api.iControl()) return false;
        try { localStorage.setItem('rs.txcall', v); } catch (x) { /* */ }
        txcSentDg = v;
        api.send({ t: 'txcall', call: v });
        return true;
      },
      // set : 'CW' (macros habituelles) ou 'CWC' (macros contest CW)
      macros: (set) => macroList(set || 'CW').map((m, i) => ({ i, name: m.name || '—', tx: /<TX>/i.test(m.text), log: /<LOG>/i.test(m.text), exch: /<EXCH>|<XOUT>|<CNTR>|<SERNO>/i.test(m.text), preview: cwText(m.text).replace(/\n/g, ' ') })),
      use(i, set, doc) {
        const m = macroList(set || 'CW')[i];
        if (!m) return '';
        if (/<LOG>/i.test(m.text) && !/<TX>/i.test(m.text)) { logQso(doc, 'CW'); return null; }
        if (!/<TX>/i.test(m.text)) return cwText(m.text, true).toUpperCase(); // macro sans <TX> : texte à ajouter
        if (/<LOG>/i.test(m.text)) { useMacro('CW', m.text.replace(/<LOG>/gi, ''), false); setTimeout(() => logQso(doc, 'CW'), 0); return null; }
        useMacro('CW', m.text, false);
        return null;
      },
      prep(i, set) { const m = macroList(set || 'CW')[i]; if (m && /<TX>/i.test(m.text)) cwPrepMacro(m.text); },
      editSet: (doc, set, i) => editMacro(doc, set || 'CW', i || 0),
      contests: () => CW_CONTESTS.map((c) => ({ id: c[0], name: c[1] })),
      contest: () => cwcId(),
      setContest(id) { store.set('cwc', CW_CONTESTS.some((c) => c[0] === id) ? id : ''); },
      exch: () => cwcExch(),
      setExch(v) { const id = cwcId(); if (id) store.set('cwcx_' + id, String(v || '').toUpperCase().trim() || '5NN <CNTR>'); },
      exchShown: () => cwText('<EXCH>'),
      serial: () => Number(store.get('cntr', '1')) || 1,
      setSerial(n) {
        n = Math.max(1, Math.min(9999, Math.round(Number(n)) || 1));
        store.set('cntr', n);
        store.set('cntrcall', '');
        if ($('rtcNr') && document.activeElement !== $('rtcNr')) $('rtcNr').value = String(n).padStart(3, '0');
      },
      // QSO enregistré dans le log du contest : n° de série suivant (sauf si la macro TU l'a déjà fait pour ce correspondant)
      afterLog: (call) => cntrAfterLog(call),
      utcNow: () => now(),
      zones: () => ({ cqz: store.get('rtcqz', '14'), itu: store.get('rtitu', '27'), name: store.get('rtcname', '') }),
      setZones(z) {
        if (z.cqz != null) store.set('rtcqz', String(z.cqz).replace(/\D/g, '').slice(0, 2) || '14');
        if (z.itu != null) store.set('rtitu', String(z.itu).replace(/\D/g, '').slice(0, 2) || '27');
        if (z.name != null) store.set('rtcname', String(z.name).toUpperCase().trim().slice(0, 12));
      },
      send: (text) => cwSend(String(text || '').toUpperCase(), false),
      edit: (doc, i) => editMacro(doc, 'CW', i || 0),
      call: () => String(dx.call || ''),
      setCall: (c) => setDx({ call: String(c || '').toUpperCase().trim() }),
      myCall: () => myCall,
      speed: () => Number(store.get('cwspeed', '22')) || 22,
      setSpeed(v) {
        v = Math.max(5, Math.min(60, Math.round(Number(v)) || 22));
        store.set('cwspeed', v);
        const sp = $('cwSpeed');
        if (sp && sp.ownerDocument.activeElement !== sp) sp.value = v;
      }
    },
    init(a) {
      const again = !!api;
      api = a;
      // Fenêtre séparée : le carnet de trafic (logbook.js chargé par digi.html) passe par la même connexion
      if (LOGW()) LOGW().init(logApi(a));
      if (again) { announce(); return; } // fenêtre séparée raccrochée à un dashboard rechargé
      buildDom();
      bmInit();
      document.querySelectorAll('#centerPanel .ctab').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (b.dataset.tab === 'log' && LOGP) return openLogWin(); // carnet : dans sa propre fenêtre
        // SSB : page SSB (contests en phonie, micro, PTT) ; dashboard : chaque mode ouvre sa page (CW : page CW,
        // FT8 / RTTY / WSPR… : page des modes numériques sur ce mode)
        if (b.dataset.tab === 'ssb') return openModePage('ssb');
        if (!POPUP && PAGE_TABS.indexOf(b.dataset.tab) >= 0) return openModePage(b.dataset.tab);
        // Choisir soi-même un autre onglet arrête le suivi de l'opérateur
        if (follow && api && !api.iControl()) { setFollow(false); api.say('Suivi de l’opérateur arrêté (onglet choisi).', '', 4000); }
        showTab(b.dataset.tab);
        if (DATA_TABS[b.dataset.tab]) dataU(DATA_TABS[b.dataset.tab]);
        else if (b.dataset.tab === 'cw') cwModeAuto();
      }));
      markPicked(store.get('picked', ''));
      $('dgFollow').addEventListener('click', (e) => { e.stopPropagation(); setFollow(!follow); if (follow) followView(); });
      setFollow(follow);
      $('dgDetach').addEventListener('click', (e) => {
        e.stopPropagation();
        if (POPUP && !EMBED) return window.close();
        // La fenêtre séparée s'ouvre sur le mode affiché
        if (MODE_TABS.indexOf(tab) >= 0) store.set('ptab', tab);
        const w = window.open(FACEP ? FACEP + '/digi.html' : '/digi.html', 'rs-digi', (window.RSWINPOS ? RSWINPOS.feat('rs-digi', 1200, 860) : 'width=1200,height=860'));
        if (!w) api.say('Fenêtre bloquée par Chrome : autorisez les fenêtres pop-up pour ce site.', 'warn');
      });
      $('dgBack').addEventListener('click', () => { if (window.RSHOST) window.RSHOST.closePopup(); });
      // Clic sur FT8 / FT4 : comme dans WSJT-X, le TRX va sur la fréquence d'appel de ce mode dans sa bande
      document.querySelectorAll('#dgModes .btn').forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.mode); dataU(b.dataset.mode); autoQsy(); }));
      $('dgQsy').addEventListener('click', qsy);
      // Choisir une fréquence dans la liste y envoie directement le TRX (QSY)
      $('dgDial').addEventListener('change', () => { store.set('dial.' + mode, $('dgDial').value); qsy(); });
      $('dgClear').addEventListener('click', () => { hist.length = 0; redrawAll(); });
      $('dgTxCall').addEventListener('change', () => {
        const v = $('dgTxCall').value;
        if (!api || !api.iControl()) { drawTxCallDg(); return api && api.say('Prenez d’abord la main pour choisir le TX call.', 'warn'); }
        try { localStorage.setItem('rs.txcall', v); } catch (x) { /* */ }
        txcSentDg = v;
        api.send({ t: 'txcall', call: v });
      });
      $('dgClearB').addEventListener('click', () => { histB.length = 0; redrawAll(); });
      $('dgClearRx').addEventListener('click', () => { rxCut.A = Date.now(); redrawRx(); });
      $('dgClearRxB').addEventListener('click', () => { rxCut.B = Date.now(); redrawRx('B'); });
      document.querySelectorAll('#dgTxSide .btn').forEach((b) => b.addEventListener('click', () => setSide(b.dataset.side)));
      // Réglages de la cascade
      const wfUi = () => { $('wfGain').value = wfCfg.gain; $('wfZero').value = wfCfg.zero; $('wfFlat').checked = wfCfg.flat; $('wfPal').value = wfCfg.pal; $('wfSpd').value = String(wfCfg.spd); };
      wfUi();
      $('wfGain').addEventListener('input', () => { wfCfg.gain = Number($('wfGain').value); store.set('wfgain', String(wfCfg.gain)); });
      $('wfZero').addEventListener('input', () => { wfCfg.zero = Number($('wfZero').value); store.set('wfzero', String(wfCfg.zero)); });
      $('wfFlat').addEventListener('change', () => { wfCfg.flat = $('wfFlat').checked; store.set('wfflat', wfCfg.flat ? '1' : '0'); });
      $('wfPal').addEventListener('change', () => { wfCfg.pal = $('wfPal').value; PAL = mkPal(PALS[wfCfg.pal]); store.set('wfpal2', wfCfg.pal); });
      $('wfSpd').addEventListener('change', () => { wfCfg.spd = Number($('wfSpd').value) || 2; wf.accN = 0; if (wf.acc) wf.acc.fill(0); store.set('wfspd', String(wfCfg.spd)); });
      // Cascade du VFO-B : mêmes réglages en FT (barre …B) et en RTTY (barre …R)
      const wfUiB = () => { for (const x of ['B', 'R']) { if (!$('wfGain' + x)) continue; $('wfGain' + x).value = wfCfgB.gain; $('wfZero' + x).value = wfCfgB.zero; $('wfFlat' + x).checked = wfCfgB.flat; $('wfPal' + x).value = wfCfgB.pal; $('wfSpd' + x).value = String(wfCfgB.spd); } };
      const accReset = () => { for (const T of [wfFB, wfB]) { T.accN = 0; if (T.acc) T.acc.fill(0); } };
      for (const x of ['B', 'R']) {
        if (!$('wfGain' + x)) continue;
        $('wfGain' + x).addEventListener('input', () => { wfCfgB.gain = Number($('wfGain' + x).value); store.set('wfgainb', String(wfCfgB.gain)); wfUiB(); });
        $('wfZero' + x).addEventListener('input', () => { wfCfgB.zero = Number($('wfZero' + x).value); store.set('wfzerob', String(wfCfgB.zero)); wfUiB(); });
        $('wfFlat' + x).addEventListener('change', () => { wfCfgB.flat = $('wfFlat' + x).checked; store.set('wfflatb', wfCfgB.flat ? '1' : '0'); wfUiB(); });
        $('wfPal' + x).addEventListener('change', () => { wfCfgB.pal = $('wfPal' + x).value; PALB = mkPal(PALS[wfCfgB.pal]); store.set('wfpalb', wfCfgB.pal); wfUiB(); });
        $('wfSpd' + x).addEventListener('change', () => { wfCfgB.spd = Number($('wfSpd' + x).value) || 2; accReset(); store.set('wfspdb', String(wfCfgB.spd)); wfUiB(); });
        $('wfReset' + x).addEventListener('click', () => { Object.assign(wfCfgB, { gain: 0, zero: 0, flat: true, pal: 'jtdx', spd: 2 }); PALB = mkPal(PALS.jtdx); for (const k of ['wfgainb', 'wfzerob']) store.set(k, '0'); store.set('wfflatb', '1'); store.set('wfpalb', 'jtdx'); store.set('wfspdb', '2'); accReset(); wfUiB(); });
      }
      wfUiB();
      $('wfReset').addEventListener('click', () => { Object.assign(wfCfg, { gain: 0, zero: 0, flat: true, pal: 'jtdx', spd: 2 }); PAL = mkPal(PALS.jtdx); for (const k of ['wfgain', 'wfzero']) store.set(k, '0'); store.set('wfflat', '1'); store.set('wfpal2', 'jtdx'); store.set('wfspd', '2'); wf.accN = 0; if (wf.acc) wf.acc.fill(0); wfUi(); });
      // Poignée sous la cascade : plus petite cascade = listes « Activité de bande » / « Fréquence RX » plus hautes
      const WF_DEF = 140;
      const setWfH = (h, save) => {
        const v = Math.max(40, Math.min(420, Math.round(h)));
        $('dgWf').style.height = v + 'px';
        const root = $('dgWf').closest('.dg') || document.documentElement;
        root.style.setProperty('--dg-list-max', Math.max(160, 360 + WF_DEF - v) + 'px');
        if (save) store.set('wfh', String(v));
        if (wf.ctx) sizeCanvas();
        return v;
      };
      if (Number(store.get('wfh', '0')) > 0) setWfH(Number(store.get('wfh', '0')), false);
      // Poignée sous chaque cascade (VFO-A, et VFO-B en double réception) : même hauteur pour les deux
      for (const grip of ['dgGrip', 'rtGripB', 'ftGripB'].map($).filter(Boolean)) {
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        const y0 = e.clientY;
        const zf = (window.RSZOOM && window.RSZOOM.z()) || 1; // zoom du dashboard : pixels de l'écran → pixels CSS
        const h0 = $('dgWf').getBoundingClientRect().height / zf;
        const mv = (ev) => setWfH(h0 + (ev.clientY - y0) / zf, false);
        const up = (ev) => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); setWfH(h0 + (ev.clientY - y0) / zf, true); };
        grip.addEventListener('pointermove', mv);
        grip.addEventListener('pointerup', up);
        grip.addEventListener('pointercancel', up);
      });
      grip.addEventListener('dblclick', () => { $('dgWf').style.height = ''; const root = $('dgWf').closest('.dg') || document.documentElement; root.style.removeProperty('--dg-list-max'); store.set('wfh', '0'); if (wf.ctx) sizeCanvas(); });
      }
      // Hauteur du spectre sous la cascade (VFO-A et VFO-B ensemble), gardée dans ce navigateur
      const SP_DEF = 70;
      const setSpH = (h, save) => {
        const v = Math.max(30, Math.min(320, Math.round(h)));
        for (const id of ['dgSpec', 'ftSpecB']) if ($(id)) $(id).style.height = v + 'px';
        if (save) store.set('sph', String(v));
        if (wf.ctx) sizeCanvas();
        return v;
      };
      if (Number(store.get('sph', '0')) > 0) setSpH(Number(store.get('sph', '0')), false);
      for (const grip of ['dgSGrip', 'ftSGripB'].map($).filter(Boolean)) {
        grip.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          grip.setPointerCapture(e.pointerId);
          const y0 = e.clientY;
          const zf = (window.RSZOOM && window.RSZOOM.z()) || 1;
          const h0 = $('dgSpec').getBoundingClientRect().height / zf;
          const mv = (ev) => setSpH(h0 + (ev.clientY - y0) / zf, false);
          const up = (ev) => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); setSpH(h0 + (ev.clientY - y0) / zf, true); };
          grip.addEventListener('pointermove', mv);
          grip.addEventListener('pointerup', up);
          grip.addEventListener('pointercancel', up);
        });
        grip.addEventListener('dblclick', () => setSpH(SP_DEF, true));
      }
      // Séparateurs entre les deux listes (FT8 / FT4 / FT2 et JTTY) : largeur réglable, gardée dans ce navigateur
      const splits = Array.from($('dgSplit').ownerDocument.querySelectorAll('.dg-vsplit'));
      const setSplit = (pct, save) => {
        for (const sp of splits) {
          const cols = sp.parentElement;
          if (pct == null) cols.style.removeProperty('--dg-left');
          else cols.style.setProperty('--dg-left', Math.max(20, Math.min(80, pct)).toFixed(1) + '%');
        }
        if (save) store.set('dgsplit', pct == null ? '' : Math.max(20, Math.min(80, pct)).toFixed(1));
      };
      if (Number(store.get('dgsplit', '')) > 0) setSplit(Number(store.get('dgsplit', '')), false);
      for (const sp of splits) {
        const cols = sp.parentElement;
        sp.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          sp.setPointerCapture(e.pointerId);
          const at = (ev) => { const r = cols.getBoundingClientRect(); return ((ev.clientX - r.left) / r.width) * 100; };
          const mv = (ev) => setSplit(at(ev), false);
          const up = (ev) => { sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up); sp.removeEventListener('pointercancel', up); setSplit(at(ev), true); };
          sp.addEventListener('pointermove', mv);
          sp.addEventListener('pointerup', up);
          sp.addEventListener('pointercancel', up);
        });
        sp.addEventListener('dblclick', () => setSplit(null, true));
      }
      // SSTV : séparateur entre Réception et Émission, largeur gardée dans ce navigateur
      {
        const sp = $('ssSplit');
        const grid = sp.parentElement;
        const setSs = (pct, save) => {
          if (pct == null) grid.style.removeProperty('--ss-left');
          else grid.style.setProperty('--ss-left', Math.max(25, Math.min(75, pct)).toFixed(1) + '%');
          if (save) store.set('sssplit', pct == null ? '' : Math.max(25, Math.min(75, pct)).toFixed(1));
          if (save && typeof ssTx !== 'undefined' && ssTx) ssTxTick(); // repère d'émission recalé sur l'image
        };
        if (Number(store.get('sssplit', '')) > 0) setSs(Number(store.get('sssplit', '')), false);
        sp.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          sp.setPointerCapture(e.pointerId);
          const at = (ev) => { const r = grid.getBoundingClientRect(); return ((ev.clientX - r.left) / r.width) * 100; };
          const mv = (ev) => setSs(at(ev), false);
          const up = (ev) => { sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up); sp.removeEventListener('pointercancel', up); setSs(at(ev), true); };
          sp.addEventListener('pointermove', mv);
          sp.addEventListener('pointerup', up);
          sp.addEventListener('pointercancel', up);
        });
        sp.addEventListener('dblclick', () => setSs(null, true));
      }
      // Split : clic gauche = fréquence de réception, clic droit = fréquence d'émission
      const fAt = (e) => { const r = e.currentTarget.getBoundingClientRect(); return WF_LO + ((e.clientX - r.left) / r.width) * WF_MAX_HZ; };
      for (const id of ['dgWf', 'dgScale']) {
        $(id).addEventListener('click', (e) => {
          if (tab === 'cw' && cwDragged) { cwDragged = false; return; } // fin d'un glisser : position gardée telle quelle
          if (tab === 'rtty' && id === 'dgScale') return; // RTTY : la règle accorde le VFO (molette, glisser), les repères se règlent dans la cascade
          return tab === 'sstv' ? null : tab === 'rtty' ? setRttyF(fAt(e), 0) : tab === 'cw' ? setCwF(fAt(e), true) : setRx(fAt(e));
        });
        $(id).addEventListener('contextmenu', (e) => { e.preventDefault(); if (tab === 'sstv') return; if (tab === 'rtty') { if (id !== 'dgScale') setRttyF(fAt(e), 1); } else if (tab === 'cw') setCwF(fAt(e), false); else setTx(fAt(e)); });
      }
      // Cascade du VFO-B (FT8 / FT4 / FT2 en double réception) : clic gauche = réception, clic droit = émission
      const fAtB = (e) => { const r = e.currentTarget.getBoundingClientRect(); const V = ftV('B'); return V.lo + ((e.clientX - r.left) / r.width) * V.span; };
      for (const id of ['ftWfB', 'ftScaleB']) {
        $(id).addEventListener('click', (e) => {
          if (tab !== 'cw') return setRx(fAtB(e), 'B');
          if (cwDragged) { cwDragged = false; return; }
          setCwF(fAtB(e), true, 'B');
        });
        $(id).addEventListener('contextmenu', (e) => { e.preventDefault(); if (tab === 'cw') setCwF(fAtB(e), false, 'B'); else setTx(fAtB(e), 'B'); });
        $(id).addEventListener('wheel', (e) => { if (tab === 'cw' && e.ctrlKey) cwTrxWheel('B', e); else ftZoom('B', e); }, { passive: false });
      }
      // FT8 / FT4 / FT2 : molette sur la cascade (ou son échelle) = zoom autour de la souris (vers soi : plus étroit)
      for (const id of ['dgWf', 'dgScale']) $(id).addEventListener('wheel', (e) => { if (tab === 'cw' && e.ctrlKey) cwTrxWheel('A', e); else if (ZOOM_TABS.indexOf(tab) >= 0) ftZoom('A', e); }, { passive: false });
      initRtty();
      initContest();
      initWspr();
      initJtty();
      initCw();
      cwTrxDragInit();
      initSstv();
      initMsgs();
      // Touches F1 à F12 dans la fenêtre RTTY : macros (comme FLDIGI)
      document.addEventListener('keydown', (e) => {
        const MODE = { rtty: 'RTTY', jtty: 'JTTY', cw: 'CW', sstv: 'SSTV' }[tab];
        if (!MODE || detached || e.ctrlKey || e.altKey || e.metaKey) return;
        // Échap : arrête l'émission RTTY / JTTY en cours (comme « ■ Arrêter »)
        if (e.key === 'Escape') {
          const stE = api && api.state();
          if (MODE === 'CW') { if (stE && stE.cw) { e.preventDefault(); api.send({ t: 'cw_stop' }); } return; }
          const x = stE && stE.ftx;
          if (x && x.mode === MODE) { e.preventDefault(); api.send({ t: 'ftx_stop' }); }
          return;
        }
        const n = /^F(\d{1,2})$/.exec(e.key);
        if (!n || MODE === 'SSTV') return;
        const m = macroList(MODE === 'RTTY' && rtcOn() ? 'RTTYC' : MODE)[Number(n[1]) - 1];
        if (!m) return;
        e.preventDefault();
        useMacro(MODE, m.text, e.shiftKey);
      });
      $('dgTxRx').addEventListener('click', () => setTx(sd() === 'B' ? rxFB : rxF, sd()));
      $('dgPar').value = store.get('ftxpar', 'auto');
      parLabels();
      $('dgPar').addEventListener('change', () => { store.set('ftxpar', $('dgPar').value); ftxCfg(); });
      // Fenêtre de QSO : saisie à la main du correspondant et des reports
      const fq = (id, fn) => { const el = $(id); if (el) el.addEventListener('change', () => fn(el.value.trim().toUpperCase())); };
      fq('fqCall', (v) => { setDx({ call: v }); syncDx(); });
      fq('fqGrid', (v) => { setDx({ grid: v }); syncDx(); });
      fq('fqRpt', (v) => { if (/^[+-]?\d{1,2}$/.test(v)) { setDx({ rpt: (/^[+-]/.test(v) ? v[0] : '+') + v.replace(/^[+-]/, '').padStart(2, '0') }); syncDx(); } });
      fq('fqRptRx', (v) => { setDx({ rptRx: v }); syncDx(); });
      $('fqLog').addEventListener('click', qsoLogNow);
      $('fqClr').addEventListener('click', () => { setDx({ call: '', grid: '', rpt: '-10', rptRx: '' }); syncDx(); });
      // Vitesse du spectre
      document.querySelectorAll('.dg-spspd button').forEach((b) => b.addEventListener('click', () => { spSpd = Number(b.dataset.spspd) || 1; store.set('spspd', spSpd); spSpdUi(); }));
      spSpdUi();
      // TX ← RX, RX ← TX, ↺ : couleurs inversées un instant au clic
      for (const id of ['dgQsy', 'dgTxRx', 'dgRxTx']) if ($(id)) $(id).addEventListener('click', () => { const b = $(id); b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 450); });
      $('dgDualRx').addEventListener('click', () => {
        const st = api && api.state();
        const trxDual = !!(st && st.radio && st.radio.dualRx === 1);
        if (ftDual) { store.set('dualview', '0'); }
        else {
          store.set('dualview', '1');
          if (!trxDual) {
            if (!api.iControl()) api.say('Le TRX est en réception simple : prenez la main pour mettre DUAL RX en service.', 'warn');
            else { api.send({ t: 'set', ctl: 'dualRx', value: 1 }); api.say('DUAL RX mis en service sur le TRX : les deux VFO s’affichent dans un instant.', '', 5000); }
          }
        }
        if (applyFtDual()) announce();
        dualRxUi();
      });
      $('dgHound').addEventListener('change', () => {
        const v = Number($('dgHound').value) || 0;
        if (!api || !api.iControl()) { houndUi(); return api && api.say('Prenez d’abord la main pour choisir l’activité HOUND.', 'warn'); }
        api.send({ t: 'ftx_hound', v });
        if (v === 2) { setRx(750); if (ftDual) setRx(750, 'B'); } // signal SuperFox : bas du signal vers 750 Hz ; ensuite, le repère suit le signal décodé
        if (v) api.say(v === 2 ? 'HOUND SuperFox : le repère RX se place tout seul sur le signal SuperFox (750 Hz, puis là où il est décodé) ; double-cliquez sur le CQ du FOX, vous appelez en 2e période sur votre fréquence TX.'
          : 'HOUND (FOX classique) : double-cliquez sur le CQ du FOX ; vous appelez en 2e période au-dessus de 1000 Hz, le R+report part tout seul sur la fréquence où le FOX vous appelle.', '', 12000);
      });
      if ($('dgAutoLog')) {
        $('dgAutoLog').value = store.get('ftautolog', '') ? 'any' : '';
        $('dgAutoLog').addEventListener('change', () => {
          store.set('ftautolog', $('dgAutoLog').value);
          if (api && $('dgAutoLog').value) api.say('Log automatique : les QSO FT8 / FT4 / FT2 terminés vont tout seuls dans le carnet (' + $('dgAutoLog').selectedOptions[0].textContent + ').', '', 5000);
        });
      }
      $('dgStop').addEventListener('click', () => api && api.send({ t: 'ftx_stop' }));
      $('dgRxTx').addEventListener('click', () => setRx(sd() === 'B' ? txFB : txF, sd()));
      // Repli du panneau ou onglet du navigateur caché : le serveur arrête de décoder pour ce membre
      new MutationObserver(announce).observe($('centerPanel'), { attributes: true, attributeFilter: ['class'] });
      document.addEventListener('visibilitychange', announce);
      window.addEventListener('resize', () => { if (WF_TABS.indexOf(tab) >= 0) sizeCanvas(); });
      fillDial();
      setMode(mode);
      showTab(tab);
      setInterval(() => { if (!detached && tab === 'ftx') progBar(); }, 100);
      // Page CW ouverte ou fermée : décodage CW demandé ou rendu (voir announce)
      let cwPageWas = false;
      setInterval(() => {
        let on = false;
        try { on = Date.now() - Number(localStorage.getItem('rs.dg.cwpageAt') || 0) < 3500; } catch (e) { on = false; }
        if (on !== cwPageWas) { cwPageWas = on; announce(); }
      }, 1000);
      setInterval(() => {
        if (detached) return;
        if (tab === 'ftx' || tab === 'jt65') { clock(); status(); followBand(); if (applyFtDual()) announce(); ftDials(); }
        if (tab === 'rtty') { status(); rtHeads(); if (dualAudioOn() !== rtDualAudio) showTab(tab); }
        if (BM_TABS.indexOf(tab) >= 0) { bmPlace(); bmDraw(); }
        if (tab === 'wspr') { wsClock(); if (applyFtDual()) announce(); ftDials(); }
        if (tab === 'jtty') { jtStatus(); if (applyFtDual()) announce(); ftDials(); }
        if (tab === 'cw') { cwStatus(); if (applyFtDual()) announce(); ftDials(); cwTrxTick(); }
        if (tab === 'sstv') sstvStatus();
        if (tab === 'sync') drawSync();
      }, 500);
    },
    insertRtty,
    useMacro,
    logQso: () => logQso(),
    insertJtty,
    insertCw,
    onHello(me, info) {
      if (LOGP && me) { logMe = me; if (LOGW()) LOGW().onHello(me); }
      needHist = true;
      wsNeedHist = true;
      jtNeedHist = true;
      if (info && info.digiCall) myCall = info.digiCall;
      if (info) myGrid = info.stationGrid || '';
      if (info) myQth = info.stationQth || '';
      if (info && info.qo100If && typeof info.qo100If === 'object') qoIf = Object.assign({}, info.qo100If);
      refillQo();
      if (me && me.call) opCall = me.call;
      if (me) txcMe = { call: String(me.call || '').toUpperCase(), canTx: me.canTx !== false, rxOnly: !!me.rxOnly, digiCall: String((info && info.digiCall) || 'ON5VL').toUpperCase(), clubs: info && Array.isArray(info.clubCalls) ? info.clubCalls.map((c) => String(c).toUpperCase()) : [] };
      drawTxCallDg();
      drawMsgs();
      if (info && info.stationCall) { baseCalls = String(info.stationCall).toUpperCase().split(/[\s/,]+/).filter(Boolean).concat(Array.isArray(info.clubCalls) ? info.clubCalls.map((c) => String(c).toUpperCase()) : []); stationCalls = Array.from(new Set(baseCalls.concat(myCall))); }
      announce(); // reprise après reconnexion
    },
    onMessage(m) {
      // Spot au DX cluster (case « Spot cluster ») : aussi affiché dans la fenêtre TRX DIGI
      if (m.t === 'notice' && /^Spot\b/.test(m.msg || '') && api && api.say && document.body.classList.contains('digi-popup')) api.say(m.msg, m.level === 'error' ? 'warn' : '', 5000);
      // Réponse à « Mettre à l'heure » (onglet Synchro) : aussi affichée dans la case PC du club
      if (m.t === 'notice' && syBusy && /^Heure du PC du club|^Réservé aux responsables|^Station hors ligne|^Page Station trop ancienne/.test(m.msg || '')) {
        if (!/^Heure du PC du club/.test(m.msg) || Date.now() - syBusy < 60000) {
          syBusy = 0;
          sySync(m.level === 'error' ? 'err' : 'ok', String(m.msg).replace(/^Heure du PC du club : /, ''));
        }
      }
      if (m.t === 'qrz_info') { qrzInfo(m); if (window.RSLOG && window.RSLOG.onQrz) window.RSLOG.onQrz(m); if (LOGW() && LOGW().onQrz) LOGW().onQrz(m); return true; }
      if (LOGP && /^log_/.test(m.t)) { if (LOGW()) LOGW().onMessage(m); return true; } // carnet de trafic (sa fenêtre)
      if (m.t === 'ftx_qso' && m.qso) { ftxQsoEnd(m); return true; }
      if (m.t === 'spots' || m.t === 'spot') {
        if (m.t === 'spots') bmSpots.clear();
        bmAdd(m.list);
        if (typeof m.state === 'string') bmState = m.state;
        if (typeof m.host === 'string') bmHost = m.host;
        bmDraw();
        return true;
      }
      if (m.t === 'worked') {
        worked = new Set(Array.isArray(m.list) ? m.list : []);
        workedStation = String(m.station || '');
        if (FT_MODES.indexOf(mode) >= 0 && $('dgBand')) redrawAll();
        return true;
      }
      if (m.t === 'pong' && Number.isFinite(m.now) && Number.isFinite(m.ts)) {
        // Écart d'horloge avec le serveur, d'après l'aller-retour le plus court
        const rtt = Date.now() - m.ts;
        if (rtt >= 0 && rtt <= bestRtt * 1.5 + 20) {
          bestRtt = Math.min(bestRtt, rtt);
          clockOff = m.now - (m.ts + rtt / 2);
        }
        return false;
      }
      if (m.t === 'macros') {
        macros = m.data || {};
        store.set('macros', JSON.stringify(macros));
        redrawMacros();
        return true;
      }
      if (m.t === 'dtx_text') { dtxInfo = m; return true; }
      if (m.t === 'rtty') { rttyAppend(m.text || '', m.ch === 1 ? 1 : 0); return true; }
      if (m.t === 'jtty') { if (m.side === 'B') jtUpdateB(m.u); else jtUpdate(m.u); return true; }
      if (m.t === 'cw') { cwAppend(m.text || '', m.ch === 1 ? 1 : 0); return true; }
      if (/^sstv_/.test(m.t)) return ssMessage(m);
      if (m.t === 'cw_lvl') { cwLevels(m); return true; }
      if (m.t === 'jtty_hist' && m.side === 'B') { jtMsgsB.clear(); for (const u of m.items || []) jtMsgsB.set(u.key, u); jtRedrawB(); return true; }
      if (m.t === 'jtty_hist') { jtMsgs.clear(); for (const u of m.items || []) jtMsgs.set(u.key, u); jtRedraw(); return true; }
      if (m.t === 'rtty_lvl') { rttyLevels(m); return true; }
      if ((m.t === 'ftx_hist' || m.t === 'ftx') && m.mode === 'WSPR') {
        const B = m.side === 'B', H = B ? wsHistB : wsHist; // B : récepteur SUB (double réception)
        if (m.t === 'ftx_hist') {
          H.length = 0;
          for (const it of m.items || []) H.push({ slot: it.slot, list: it.list || [] });
          wsRedraw();
        } else {
          if (!B) wsLast = m.slot;
          const it = { slot: m.slot, list: m.list || [] };
          H.push(it);
          while (H.length > 60) H.shift();
          wsAdd(it, B);
        }
        return true;
      }
      if (m.t === 'ftx_hist') {
        // Historique à l'ouverture : on remplace ce qu'on a pour ce mode (VFO-B : liste à part)
        const H = m.side === 'B' ? histB : hist;
        for (let i = H.length - 1; i >= 0; i--) if (H[i].mode === m.mode) H.splice(i, 1);
        for (const it of m.items || []) H.push({ slot: it.slot, mode: m.mode, list: it.list || [] });
        H.sort((a, b) => a.slot - b.slot);
        if (m.mode === mode) redrawAll();
        return true;
      }
      if (m.t === 'ftx') {
        const B = m.side === 'B'; // récepteur SUB (VFO-B) en double réception
        if (!B) lastDecode = Date.now();
        const H = B ? histB : hist;
        const it = { slot: m.slot, mode: m.mode, list: m.list || [] };
        H.push(it);
        while (H.length > 240) H.shift();
        if (m.mode === mode) addSlot(it, false, B ? 'B' : undefined);
        // HOUND SuperFox : le repère RX se place tout seul sur le signal SuperFox décodé (bas du signal)
        const sfd = houndOn() && (it.list || []).find((d) => d.sf && d.f >= 200 && d.f <= 2500);
        if (sfd && Math.abs((B ? rxFB : rxF) - sfd.f) > 8) setRx(sfd.f, B ? 'B' : undefined);
        return true;
      }
      return false;
    },
    onBinary(bytes) {
      if (bytes[0] === 0x10 || bytes[0] === 0x13 || bytes[0] === 0x14) { onRow(bytes); return true; }
      if (bytes[0] === 0x11) { ssLine(bytes); return true; }
      return false;
    },
    onState() {
      drawTxCallDg();
      // Double réception allumée ou coupée : cascades et colonnes du VFO-B tout de suite (sans attendre le tour de 500 ms)
      if (dualTab() && applyFtDual()) announce();
      if (tab === 'rtty' && dualAudioOn() !== rtDualAudio) showTab(tab);
      if (LOGW() && LOGW().onState) LOGW().onState();
      // « TX call » : indicatif des émissions numériques (station ou celui qui a la main)
      const stx = api && api.state();
      // Report reçu du correspondant pendant la séquence FT8 / FT4 / FT2 → « RST RX »
      const sqr = stx && stx.seq;
      if (sqr && sqr.rptRcvd && sqr.dx && String(sqr.dx).toUpperCase() === String(dx.call || '').toUpperCase() && sqr.rptRcvd !== dx.rptRx) setDx({ rptRx: sqr.rptRcvd });
      const tc = stx && stx.txCall ? String(stx.txCall).toUpperCase() : '';
      if (tc && tc !== myCall) {
        myCall = tc;
        stationCalls = Array.from(new Set(baseCalls.concat(myCall)));
        drawMsgs();
        redrawAll();
        dtxState(stx.ftx); // notes « Émission RTTY / JTTY sous … »
      }
      cwTxState(stx && stx.cw);
      // Notes « Émission CW / SSTV sous … » : même indicatif que TX CALL
      for (const el of document.querySelectorAll('.dg-txcall')) if (el.textContent !== myCall) el.textContent = myCall;
      // Suivre l'opérateur : bouton caché pour celui qui a la main, qui annonce son onglet
      const fb = $('dgFollow');
      const mine = !!(api && api.iControl());
      if (fb) fb.hidden = mine;
      // « Suivre l'opérateur » enclenché tout seul quand un autre membre a la main : à l'arrivée sur la page, et chaque
      // fois qu'un autre membre prend la main ensuite (un clic sur un onglet l'arrête jusqu'au prochain opérateur)
      const stF = api && api.state();
      if (stF && stF.users) {
        const ctl = stF.controller || null;
        if (!autoFollowDone || ctl !== followCtl) {
          autoFollowDone = true;
          followCtl = ctl;
          if (ctl && !mine && ctl !== opCall && !follow) {
            setFollow(true);
            api.say('Suivi de l’opérateur enclenché : ' + ctl + ' a la main (cliquez un onglet pour choisir vous-même).', '', 6000);
          }
        }
      }
      if (mine) sendView(); else { viewSent = ''; followView(); }
      // Autre TRX (couverture différente) : les fréquences QO-100 proposées changent
      const R = api && api.rig && api.rig();
      if (R && R.ID !== lastRig) { lastRig = R.ID; refillQo(); }
      if (tab === 'ftx' || tab === 'jt65') { status(); followBand(); }
      ftxState();
    }
  };
  // Le TRX a changé de bande : la liste des fréquences d'appel suit (vérifié aussi chaque demi-seconde)
  function followBand() {
      const st = api && api.state();
      const f = st && st.radio && st.radio.freq;
      if (!f) return;
      const band = f ? nearList(mode, f).reduce((a, x) => (Math.abs(x[1] * 1000 - f) < Math.abs(a[1] * 1000 - f) ? x : a))[1] : 0;
      if (band !== lastBand) { lastBand = band; fillDial(); }
  }

  // ------------------------------------------------------------------ fenêtre séparée (digi.html)
  // Page Face avant (/ftdx101…) : les modes numériques y sont sous l'image du TRX, branchés par face.js (data-digi-embed)
  if (POPUP && document.body.dataset.digiEmbed !== '1') {
    let host = null;
    // Annonces : en jaune fluo, clignotantes pendant 3 s pour attirer l'attention, puis fixes jusqu'à leur fin
    const toast = (msg, level, ms) => {
      const el = $('dgToast');
      el.textContent = msg || '';
      el.className = 'dg-toast ' + (level || '');
      if (msg) { void el.offsetWidth; el.classList.add('blink'); }
      clearTimeout(toast.t);
      if (msg) toast.t = setTimeout(() => { el.textContent = ''; }, Math.max(6000, Number(ms) || 0));
    };
    const link = () => {
      const op = window.opener;
      const h = op && !op.closed && op.RSHOST;
      if (h && h !== host) {
        host = h;
        // Même connexion que le dashboard ; les messages d'alerte s'affichent dans cette fenêtre
        h.attach(window, window.RSDIGI, Object.assign({}, h.api, { say: toast }));
        $('dgOrphan').hidden = true;
      } else if (!h) {
        host = null;
        $('dgOrphan').hidden = false;
      }
    };
    window.addEventListener('pagehide', () => { if (host) try { host.detach(window.RSDIGI); } catch (e) {} });
    link();
    setInterval(link, 1000); // dashboard rechargé : on s'y raccroche ; fermé : avertissement
  }
})();
