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
  const WF_MAX_HZ = 3000;
  const RX_WIDTH = 60; // Hz de part et d'autre de la fréquence RX

  const POPUP = document.body.dataset.digiPopup === '1';
  let api = null;
  let detached = false;  // dashboard : les modes numériques sont dans la fenêtre séparée
  let needHist = true;   // demander l'historique des décodages à la prochaine annonce
  let clockOff = 0;      // écart horloge du serveur − horloge de ce PC (ms)
  let bestRtt = Infinity;
  let tab = store.get(POPUP ? 'ptab' : 'tab', POPUP ? 'ftx' : 'events');
  const FT_MODES = ['FT8', 'FT4', 'FT2'];
  const ftStored = () => { const v = store.get('ftmode', store.get('mode', 'FT8')); return FT_MODES.indexOf(v) >= 0 ? v : 'FT8'; };
  let mode = ftStored();
  let rxF = Number(store.get('rxf', '1500')) || 1500;
  let txF = Number(store.get('txf', '1500')) || 1500; // fréquence audio d'émission (split : différente de RX)
  const SCALE_H = 44; // graduations + drapeaux TX / RX avec leur fréquence
  let lastDecode = 0;
  let lastBand = 0;
  let stationCalls = ['ON5VL', 'OR0L'];
  let baseCalls = stationCalls.slice(); // indicatifs de la station ; + celui sous lequel on émet (« TX call »)


  // ------------------------------------------------------------------ construction des onglets et des fenêtres
  // Même code pour le centre du dashboard et pour la fenêtre séparée (digi.html, sans l'onglet Activité).
  const TABS = [
    ['events', 'Activité'], ['ftx', 'FT8 · FT4 · FT2'], ['rtty', 'RTTY'], ['wspr', 'WSPR'], ['jt65', 'JT65'], ['jtty', 'JTTY'], ['cw', 'CW'], ['sstv', 'SSTV'], ['gap', ''], ['sync', 'Synchro'], ['log', 'Logs']
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
      <span class="dg-f">Période</span>
      <select id="dgPar" class="dg-par" aria-label="Période d'émission" title="Période d'émission. Auto : à l'opposé du correspondant choisi (double-clic sur son message), sinon la prochaine période. 1re = 00 / 30 s en FT8.">
        <option value="auto">auto</option><option value="0">1re</option><option value="1">2e</option>
      </select>
      <label class="dg-chk" title="En appel CQ (Tx6), celui qui vous répond devient le correspondant et la séquence continue toute seule (Call 1st de WSJT-X)"><input type="checkbox" id="dgCall1st"> Répondre au 1er</label>
      <button class="btn dg-stop" type="button" id="dgStop" disabled title="Arrête l'émission automatique (Halt Tx)">■ Arrêter</button>
      <span class="dg-tl"><span class="dg-status" id="dgStatus"></span><span class="dg-clock" id="dgClock">--:--:--</span></span>
    </div>
    <div class="dg-wf-slot" data-slot="ftx"><div class="dg-wf">
      <div class="wf-ctl" title="Réglages de la cascade (comme WSJT-X)">
        <label title="Contraste : plus à droite, les signaux faibles ressortent davantage">Gain <input id="wfGain" type="range" min="-20" max="20" step="1" value="0"></label>
        <label title="Niveau du bruit de fond : plus à droite, le fond est plus clair">Zéro <input id="wfZero" type="range" min="-20" max="20" step="1" value="0"></label>
        <label title="Aplatit le bruit de fond sur toute la largeur (corrige la pente du filtre du TRX)"><input id="wfFlat" type="checkbox" checked> Plat</label>
        <select id="wfPal" aria-label="Couleurs de la cascade"><option value="jtdx">Couleurs : JTDX</option><option value="classic">Couleurs : bleu</option><option value="wsjtx">Couleurs : arc-en-ciel</option><option value="gray">Couleurs : gris</option></select>
        <select id="wfSpd" aria-label="Vitesse de la cascade" title="Vitesse de défilement (comme « Spd » de JTDX) : plus lent = signaux plus ramassés et plus d'historique"><option value="1">Vitesse : rapide</option><option value="2">Vitesse : normale</option><option value="3">Vitesse : lente</option></select>
        <button class="dg-mini" type="button" id="wfReset" title="Réglages d'origine">↺</button>
      </div>
      <canvas id="dgScale" height="44"></canvas>
      <canvas id="dgWf" height="140"></canvas>
      <i class="dg-mk dg-mk-tx" id="dgMkTx"></i><i class="dg-mk dg-mk-rx" id="dgMkRx"></i>
      <i class="dg-grip" id="dgGrip" title="Glisser vers le haut ou le bas : hauteur de la cascade et des listes de messages (double-clic : taille d'origine)"></i>
    </div></div>
    <div class="dg-cols">
      <div class="dg-col">
        <div class="dg-h"><span>Activité de bande</span><button class="dg-mini" type="button" id="dgClear">Effacer</button></div>
        <div class="dg-th ft"><span>UTC</span><span>dB</span><span>DT</span><span>Fréq</span><span>Message</span><span>Pays</span><span>km</span><span>Az</span></div>
        <div class="dg-list" id="dgBand"></div>
      </div>
      <i class="dg-vsplit" id="dgSplit" title="Glisser à gauche ou à droite : largeur des deux listes (double-clic : moitié-moitié)"></i>
      <div class="dg-col">
        <div class="dg-h"><span>Fréquence RX <b id="dgRxF">1500 Hz</b></span><span class="dg-note">clic gauche : RX · clic droit : TX · double-clic : correspondant</span></div>
        <div class="dg-th ft"><span>UTC</span><span>dB</span><span>DT</span><span>Fréq</span><span>Message</span><span>Pays</span><span>km</span><span>Az</span></div>
        <div class="dg-list" id="dgRx"></div>
      </div>
    </div>
    <div class="dg-prog" id="dgProg" title="Période en cours : vert = réception, rouge = émission"><i id="dgProgBar"></i><span id="dgProgTxt"></span></div>
    <!-- Messages Tx1 à Tx7 dans l'onglet, sous les listes (comme WSJT-X) -->
    <div class="ft-tx"><div class="msgs-b ft-msgs" id="msgFtx"></div></div>
    <p class="dg-tx" id="dgTxState">Émission : cliquez sur un message Tx1 à Tx7 ci-dessus : il part à chaque période jusqu’à la réponse, la séquence avance toute seule.</p>`;
  const RTTY_PANE = `
    <div class="dg-bar">
      <select id="rtDial" aria-label="Fréquence RTTY"></select>
      <button class="btn dg-back" type="button" id="rtQsy" title="Revenir sur cette fréquence (VFO A, en DATA-U)" aria-label="Revenir sur cette fréquence (VFO A, en DATA-U)">↺</button>
      <span class="dg-note">Deux décodeurs : A (VFO-A) à gauche, B (VFO-B) à droite · clic sur une cascade : caler son décodeur · double-clic sur un indicatif : le reprendre</span>
      <span class="dg-status" id="rtStatus"></span>
    </div>
    <!-- Deux décodeurs RTTY côte à côte, largeur réglable ; émission sous les deux, sur toute la largeur -->
    <div class="rt-dual" id="rtDual">
      <div class="dg-col rt-side" data-ch="0">
        <div class="dg-h rt-hd">
          <span class="rt-name">VFO-A</span><span class="rt-rf" id="rtRf" title="Fréquence du signal suivi (porteuse + centre Mark / Space)"></span>
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
        <div class="dg-wf-slot" data-slot="rtty"></div>
        <pre class="rt-rx" id="rtRx"></pre>
      </div>
      <i class="rt-vsplit" id="rtSplit" title="Glisser à gauche ou à droite : largeur des deux décodeurs (double-clic : moitié-moitié)"></i>
      <div class="dg-col rt-side" data-ch="1">
        <div class="dg-h rt-hd">
          <span class="rt-name">VFO-B</span><span class="rt-rf" id="rtRfB" title="Fréquence du signal suivi (porteuse + centre Mark / Space)"></span>
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
        <div class="dg-wf rt-wfb">
          <canvas id="rtScaleB" height="44"></canvas>
          <canvas id="rtWfB" height="140"></canvas>
          <i class="dg-mk dg-mk-rx" id="rtMkMB"></i><i class="dg-mk dg-mk-tx" id="rtMkSB"></i>
        </div>
        <pre class="rt-rx" id="rtRxB"></pre>
      </div>
    </div>
    <div class="rt-grid rt-stack">
      <!-- Émission sous la réception, sur toute la largeur (comme JTTY et FLDIGI) : macros F1 à F12 sur une ligne -->
      <div class="dg-col rt-tx-col">
        <div class="rt-macros" id="rtMacros"></div>
        <div class="rt-tx-row">
          <textarea id="rtTxt" rows="2" placeholder="Message personnalisé, puis « Émettre » (Maj+clic sur une macro : l'ajoute ici)…" spellcheck="false"></textarea>
          <div class="rt-tx-act">
            <button class="btn btn-tx" type="button" id="rtSend" title="Émet le texte en RTTY avec les réglages du décodeur marqué TX (A ou B), puis retour en réception">Émettre</button>
            <div class="rt-tx-act2"><button class="btn" type="button" id="rtTxClear">Effacer</button>
            <button class="btn btn-log" type="button" data-log title="Enregistrer le QSO dans le carnet de la station (correspondant, RST, heure…)">Log QSO</button></div>
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
    <div class="dg-wf-slot" data-slot="wspr"></div>
    <div class="dg-col ws-col">
      <div class="dg-h"><span>Stations WSPR entendues <b id="wsCount"></b></span><span class="dg-note">périodes de 2 minutes · décodage une dizaine de secondes après la minute paire</span><button class="dg-mini" type="button" id="wsClear">Effacer</button></div>
      <div class="ws-th"><span>UTC</span><span>dB</span><span>DT</span><span>Fréquence</span><span>Dérive</span><span>Indicatif</span><span>Locator</span><span>Puiss.</span><span>Distance</span></div>
      <div class="dg-list ws-list" id="wsList"></div>
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
    <div class="dg-wf-slot" data-slot="jtty"></div>
    <div class="dg-cols">
      <div class="dg-col">
        <div class="dg-h"><span>Activité JTTY</span><button class="dg-mini" type="button" id="jtClear">Effacer</button></div>
        <div class="jt-th"><span>UTC</span><span>dB</span><span>Fréq</span><span>Message</span></div>
        <div class="dg-list" id="jtBand"></div>
      </div>
      <i class="dg-vsplit" title="Glisser à gauche ou à droite : largeur des deux listes (double-clic : moitié-moitié)"></i>
      <div class="dg-col">
        <div class="dg-h"><span>Fréquence RX <b id="jtRxF2">1500 Hz</b></span><span class="dg-note">clic gauche : RX · clic droit : TX · double-clic : correspondant</span></div>
        <div class="dg-list jt-chat" id="jtRx"></div>
      </div>
    </div>
    <div class="jt-tx">
      <div class="rt-macros" id="jtMacros"></div>
      <div class="jt-tx-row">
        <input id="jtTxt" maxlength="160" placeholder="Message personnalisé, puis « Émettre » (macros F1 à F8 : émission directe)…" autocomplete="off" spellcheck="false">
        <button class="btn btn-tx" type="button" id="jtSend" title="Émet le message en JTTY sur la fréquence TX (repère rouge), puis retour en réception">Émettre</button>
        <button class="btn btn-log" type="button" data-log title="Enregistrer le QSO dans le carnet de la station">Log QSO</button>
      </div>
      <p class="dg-tx" id="jtTxState">Émission JTTY sous <b>ON5VL</b> : message ci-dessus, puis « Émettre » (Entrée).</p>
    </div>`;
  const CW_PANE = `
    <div class="dg-bar">
      <select id="cwDial" aria-label="Fréquence CW"></select>
      <button class="btn dg-back" type="button" id="cwQsy" title="Revenir sur cette fréquence (VFO A, en CW)" aria-label="Revenir sur cette fréquence (VFO A, en CW)">↺</button>
      <select id="cwBw" aria-label="Filtre du décodeur" title="Largeur du filtre du décodeur : étroit = moins de bruit et de QRM, mais il faut être bien calé"><option value="50">Filtre 50 Hz</option><option value="100">Filtre 100 Hz</option><option value="200">Filtre 200 Hz</option><option value="400">Filtre 400 Hz</option></select>
      <label class="rt-sq" title="Niveau minimal du signal au-dessus du bruit : plus haut = moins de lettres au hasard sur le bruit">Silencieux
        <input type="range" id="cwSq" min="0" max="20" step="1" aria-label="Silencieux"><output id="cwSqV">5</output></label>
      <span class="cw-lvl" title="Niveau du signal au-dessus du bruit (dB) ; le voyant suit la manipulation"><i class="cw-led" id="cwLed"></i><i class="cw-bar"><b id="cwBar"></b></i><span id="cwDb">0 dB</span></span>
      <span class="dg-f rx">Tonalité <b id="cwF">700</b> Hz</span>
      <span class="dg-f">Vitesse <b id="cwWpm">—</b> mots/min</span>
      <span class="dg-status" id="cwStatus"></span>
    </div>
    <div class="dg-wf-slot" data-slot="cw"></div>
    <div class="rt-grid rt-stack">
      <div class="dg-col rt-rx-col">
        <div class="dg-h"><span>Réception CW</span><span class="dg-note">clic sur la cascade : se caler sur le signal le plus proche · double-clic sur un indicatif : le reprendre</span><button class="dg-mini" type="button" id="cwClear">Effacer</button></div>
        <pre class="rt-rx" id="cwRx"></pre>
      </div>
      <div class="dg-col rt-tx-col">
        <div class="dg-h"><span>Émission</span><label class="rt-call">Vitesse <input id="cwSpeed" type="number" min="5" max="50" step="1" title="Vitesse du manipulateur du TRX (mots/minute)"> mots/min</label></div>
        <div class="rt-macros" id="cwMacros"></div>
        <div class="rt-tx-row">
          <textarea id="cwTxt" rows="2" placeholder="Texte à émettre (F1 à F12 : macros)…" spellcheck="false"></textarea>
          <div class="rt-tx-act">
            <button class="btn btn-tx" type="button" id="cwSend" disabled>Émettre</button>
            <div class="rt-tx-act2"><button class="btn" type="button" id="cwTxClear">Effacer</button>
            <button class="btn btn-log" type="button" data-log title="Enregistrer le QSO dans le carnet de la station">Log QSO</button></div>
          </div>
        </div>
        <p class="dg-tx rt-tx-note">Émission CW sous <b>ON5VL</b> par le manipulateur du TRX : prochaine version.</p>
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
      <div class="dg-col ss-tx">
        <div class="dg-h"><span>Émission</span>
          <select id="ssTxMode" aria-label="Mode d'émission"></select><span class="dg-note" id="ssDur"></span></div>
        <div class="ss-src">
          <label class="btn ss-file" title="Choisir une ou plusieurs images sur votre PC">Images du PC…<input type="file" id="ssFile" accept="image/*" multiple hidden></label>
          <div class="ss-thumbs" id="ssThumbs"></div>
        </div>
        <div class="ss-txbody">
          <div class="ss-cview"><canvas id="ssCompose" class="ss-compose" width="320" height="256"></canvas></div>
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
              <button class="btn btn-tx" type="button" id="ssSend" disabled>Émettre</button>
            </div>
          </div>
        </div>
        <p class="dg-tx ss-note">Émission SSTV sous <b>ON5VL</b> : avec l'émission des modes numériques (prochaine version). Clic droit sur une vignette : la retirer · glisser-déposer accepté.</p>
      </div>
    </div>`;
  const SYNC_PANE = `
    <div class="sy-grid">
      <div class="sy-box"><span>Heure du serveur (UTC)</span><b id="syVps">--:--:--</b><small>référence de tous les décodages</small></div>
      <div class="sy-box"><span>Votre PC</span><b id="syPc">—</b><small id="syPcNote">écart avec le serveur</small></div>
      <div class="sy-box"><span>Liaison station → serveur</span><b id="syLat">—</b><small>délai mesuré et corrigé automatiquement</small></div>
      <div class="sy-box"><span>DT médian</span><b id="syDt">—</b><small id="syDtNote">derniers décodages FT8 / FT4</small></div>
      <div class="sy-box"><span>Décodages (dernière période)</span><b id="syDec">—</b><small id="syDecNote">arrivée de chaque passe après le début de la période</small></div>
    </div>
    <p class="sy-note">Le décodage se cale sur l'horloge du serveur (synchronisée par NTP) : l'heure du PC du club et celle de votre PC
      n'interviennent pas. Le délai de la liaison est mesuré d'après les stations décodées ; un DT médian proche de 0,0 s montre que tout est calé.</p>`;

  function buildDom() {
    const bar = $('ctabs');
    bar.textContent = '';
    for (const [id, label] of TABS) {
      if (id === 'events' && POPUP) continue;
      if (id === 'log' && (POPUP || !window.RSLOG)) continue; // carnet de trafic : dashboard seulement
      if (id === 'gap') { const g = document.createElement('span'); g.className = 'ctab-gap'; bar.appendChild(g); continue; }
      const b = document.createElement('button');
      b.className = 'ctab';
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.tab = id;
      b.textContent = label;
      bar.appendChild(b);
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
    const det = document.createElement('button');
    det.className = 'ctab-detach';
    det.type = 'button';
    det.id = 'dgDetach';
    det.textContent = POPUP ? '⧉ Ramener dans le dashboard' : '⧉';
    det.title = POPUP ? 'Fermer cette fenêtre et ramener les modes numériques dans le dashboard' : 'Ouvrir les modes numériques dans une fenêtre séparée';
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
    add('ftx', 'dg', FTX_PANE);
    add('rtty', 'dg rt', RTTY_PANE);
    add('wspr', 'dg ws', WSPR_PANE);
    add('jtty', 'dg jt', JTTY_PANE);
    add('cw', 'dg rt cwp', CW_PANE);
    add('sstv', 'dg ss', SSTV_PANE);
    for (const k in SOON) add(k, 'dg-soon', '<p>' + SOON[k] + '</p><p class="dg-note">En préparation.</p>');
    add('sync', 'dg-sync', SYNC_PANE);
    if (!POPUP && window.RSLOG) { add('log', 'lg', ''); window.RSLOG.mount(panel.lastElementChild); }
    add('away', 'dg-soon', '<p>Les modes numériques sont ouverts dans une <b>fenêtre séparée</b>.</p><p><button class="btn" type="button" id="dgBack">Ramener ici</button></p>');
  }

  // ------------------------------------------------------------------ suivre l'opérateur
  let follow = store.get(POPUP ? 'pfollow' : 'follow', '0') === '1';
  let viewSent = '';
  function setFollow(on) {
    follow = !!on;
    store.set(POPUP ? 'pfollow' : 'follow', follow ? '1' : '0');
    const b = $('dgFollow');
    if (b) b.setAttribute('aria-pressed', String(follow));
  }
  // Celui qui a la main annonce l'onglet affiché (la fenêtre séparée s'en charge quand les modes y sont ouverts)
  function sendView() {
    if (!api || !api.iControl() || (detached && !POPUP)) return;
    const k = tab + '/' + (tab === 'ftx' || tab === 'jt65' ? mode : '');
    if (k === viewSent) return;
    viewSent = k;
    api.send({ t: 'view', tab, mode: tab === 'ftx' || tab === 'jt65' ? mode : null });
  }
  function followView() {
    const st = api && api.state();
    const v = st && st.view;
    if (!follow || !v || !v.tab || api.iControl() || (detached && !POPUP)) return;
    if (!document.querySelector('#centerPanel .ctab[data-tab="' + v.tab + '"]')) return; // onglet absent ici (fenêtre séparée : Activité, Logs)
    if (v.tab === 'ftx' && v.mode && v.mode !== mode && ['FT8', 'FT4', 'FT2'].indexOf(v.mode) >= 0) setMode(v.mode);
    if (v.tab !== tab) showTab(v.tab);
  }

  // ------------------------------------------------------------------ onglets
  function showTab(t) {
    if (!document.querySelector('#centerPanel .ctab[data-tab="' + t + '"]')) t = POPUP ? 'ftx' : 'events';
    tab = t;
    // Ligne Correspondant : reports en dB (FT8 / FT4 / FT2, WSPR, JT65) ou RST 599 (RTTY, CW, SSTV, JTTY)
    const mb = document.getElementById('msgs');
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
    document.querySelectorAll('#centerPanel .ctab-pane').forEach((p) => { p.hidden = p.dataset.pane !== pane; });
    // Une seule cascade, déplacée dans la fenêtre affichée (FT8/FT4 ou RTTY)
    if (WF_TABS.indexOf(pane) >= 0) {
      const slot = document.querySelector('.dg-wf-slot[data-slot="' + pane + '"]');
      const el = document.querySelector('.dg-wf:not(.rt-wfb)'); // cascade principale (pas celle du décodeur RTTY B)
      if (slot && el && el.parentElement !== slot) slot.appendChild(el);
      el.classList.toggle('is-rtty', pane === 'rtty' || pane === 'cw');
      sizeCanvas();
    }
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
    showTab(on && !POPUP && MODE_TABS.indexOf(tab) >= 0 ? 'events' : tab);
  }
  // Le serveur ne décode (et la station n'envoie la BF) que si au moins un membre regarde la fenêtre
  function announce() {
    if (!api || (detached && !POPUP)) return; // la fenêtre séparée annonce elle-même
    const watching = WF_TABS.indexOf(tab) >= 0 && !$('centerPanel').classList.contains('collapsed') && !document.hidden;
    if (watching && tab === 'cw') return api.send({ t: 'digi', mode: 'CW', cw: cwc });
    if (watching && tab === 'sstv') { api.send({ t: 'digi', mode: 'SSTV', hist: ssNeedHist }); ssNeedHist = false; return; }
    if (watching && tab === 'jtty') { api.send({ t: 'digi', mode: 'JTTY', hist: jtNeedHist }); jtNeedHist = false; return; }
    if (watching && tab === 'rtty') return api.send({ t: 'digi', mode: 'RTTY', rtty: rts[0], rtty2: rts[1] });
    if (watching && tab === 'wspr') { api.send({ t: 'digi', mode: 'WSPR', hist: wsNeedHist }); wsNeedHist = false; return; }
    api.send({ t: 'digi', mode: watching ? mode : null, hist: watching && needHist });
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
  function sizeCanvas() {
    const c = $('dgWf');
    const s = $('dgScale');
    // Repères RX / TX sous l'échelle (la barre de réglages au-dessus peut tenir sur une ou deux lignes)
    for (const id of ['dgMkRx', 'dgMkTx']) if ($(id)) $(id).style.top = (s.offsetTop + s.offsetHeight) + 'px';
    // Pixels de l'écran (pas les pixels CSS) : sur un écran à 125 / 150 %, la cascade reste aussi fine que l'écran le permet,
    // et une cascade agrandie avec la poignée montre plus d'historique au lieu d'étirer les lignes
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const cw = Math.max(200, Math.floor(c.clientWidth || c.parentElement.clientWidth));
    const ch = Math.max(40, Math.round(c.clientHeight || 140));
    const w = Math.round(cw * dpr);
    const h = Math.round(ch * dpr);
    if (w === wf.w && h === wf.h && wf.ctx) { sizeB(); return drawScale(); }
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
    drawScale();
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
  let floor = null;
  let binFloor = null; // plancher de bruit de chaque case (fond aplati)
  function onRow(bytes) {
    if (WF_TABS.indexOf(tab) < 0 || detached || !wf.ctx) return;
    // 0x10 : une case de 6,25 Hz par octet (dB*2+240) depuis 0 Hz (ancien serveur)
    // 0x13 : largeur de case (mHz, 2 octets), heure de capture (dixièmes de s du jour UTC, 4 octets), puis les cases
    const fine = bytes[0] === 0x13;
    const df = fine ? ((bytes[1] << 8) | bytes[2]) / 1000 : 6.25;
    const tday = fine ? (((bytes[3] << 24) >>> 0) + (bytes[4] << 16) + (bytes[5] << 8) + bytes[6]) * 100 : null;
    const hdr = fine ? 7 : 1;
    const n = Math.min(bytes.length - hdr, Math.ceil(WF_MAX_HZ / df));
    let vals = bytes.subarray(hdr, hdr + n);
    if (tab === 'cw') { if (cwDf !== df) cwRows.length = 0; cwDf = df; cwRows.push(Uint8Array.from(vals)); if (cwRows.length > 12) cwRows.shift(); }
    // Vitesse (comme « Spd » de JTDX) : 1, 2 ou 3 lignes reçues fondues en une (moyenne des puissances) ;
    // plus lent = signaux plus ramassés, plus d'historique à l'écran
    const spd = wfCfg.spd;
    if (spd > 1) {
      if (!wf.acc || wf.acc.length !== n) { wf.acc = new Float32Array(n); wf.accN = 0; }
      const acc = wf.acc;
      for (let k = 0; k < n; k++) acc[k] += Math.pow(10, vals[k] / 20);
      if (++wf.accN < spd) return;
      const m = new Uint8Array(n);
      for (let k = 0; k < n; k++) { const v = Math.round(20 * Math.log10(acc[k] / wf.accN)); m[k] = v < 0 ? 0 : v > 255 ? 255 : v; acc[k] = 0; }
      wf.accN = 0;
      vals = m;
    }
    // Plancher de bruit : médiane de la ligne, lissée
    const sorted = Array.from(vals).sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    floor = floor == null ? med : floor * 0.9 + med * 0.1;
    // Fond aplati : niveau moyen du bruit de chaque case (les signaux, 6 dB au-dessus, ne le relèvent presque pas),
    // lissé sur ± 4 cases (± 25 Hz) pour ne pas créer de stries verticales
    if (!binFloor || binFloor.length !== n) { binFloor = new Float32Array(n).fill(med); wf.sb = new Float32Array(n); wf.fr = 0; floor = med; }
    // Premières secondes (ou retour après une coupure) : on s'adapte vite ; ensuite lentement, sans suivre les signaux
    const fast = ++wf.fr < 40;
    const lo = floor - 10; // jamais plus de 5 dB sous le bruit médian (sinon tout le fond vire au jaune)
    for (let k = 0; k < n; k++) {
      const b = binFloor[k];
      let nb = fast ? b * 0.8 + Math.min(vals[k], med + 6) * 0.2 : vals[k] > b + 12 ? b + 0.05 : b * 0.97 + vals[k] * 0.03;
      binFloor[k] = nb < lo ? lo : nb;
    }
    const sb = wf.sb;
    const hw = Math.max(1, Math.round(25 / df)); // ± 25 Hz
    for (let k = 0, acc = 0, cnt = 0; k < n; k++) {
      acc = 0; cnt = 0;
      for (let j = Math.max(0, k - hw); j <= Math.min(n - 1, k + hw); j++) { acc += binFloor[j]; cnt++; }
      sb[k] = acc / cnt;
    }
    const ctx = wf.ctx;
    ctx.drawImage(ctx.canvas, 0, 0, wf.w, wf.h - 1, 0, 1, wf.w, wf.h - 1); // la cascade descend d'une ligne
    if (!wf.img || wf.img.width !== wf.w) wf.img = ctx.createImageData(wf.w, 1);
    const d = wf.img.data;
    // Gain : plage de couleurs de 50 dB (−20) à 12,5 dB (+20), 25 dB au milieu ; zéro : fond ± 10 dB
    // Cascade fine moyennée (0x13) : bruit plus régulier, donc plage plus serrée (16 dB) et fond un peu relevé (bleu)
    const range = 2 * (fine ? 16 : 25) / Math.pow(2, wfCfg.gain / 10); // en octets (2 par dB)
    const off = wfCfg.zero + (fine ? 8 : 3);                             // octets
    const flatLvl = floor + 0; // fond aplati ramené au plancher moyen
    const nHz = WF_MAX_HZ / df; // cases sur la largeur affichée (0–3000 Hz)
    for (let x = 0; x < wf.w; x++) {
      // Interpolation entre deux cases (pas d'escalier quand la cascade est plus large que le nombre de cases)
      const fx = Math.max(0, Math.min(n - 1, (x + 0.5) / wf.w * nHz - 0.5));
      const k0 = Math.floor(fx);
      const k1 = Math.min(n - 1, k0 + 1);
      const u = fx - k0;
      let v = vals[k0] * (1 - u) + vals[k1] * u;
      const base = wfCfg.flat ? sb[k0] * (1 - u) + sb[k1] * u : floor;
      if (wfCfg.flat) v = v - base + flatLvl;
      let i = Math.round(((v - floor + off) / range) * 255);
      i = i < 0 ? 0 : i > 255 ? 255 : i;
      d[x * 4] = PAL[i * 3];
      d[x * 4 + 1] = PAL[i * 3 + 1];
      d[x * 4 + 2] = PAL[i * 3 + 2];
      d[x * 4 + 3] = 255;
    }
    ctx.putImageData(wf.img, 0, 0);
    periodMark(ctx, tday);
    // RTTY : la même ligne descend aussi dans la cascade du décodeur B
    if (tab === 'rtty' && wfB.ctx) {
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
    ticks(c, w);
    if (tab === 'rtty') return drawRttyMarks(c, w);
    if (tab === 'wspr') return drawWsprMarks(c, w);
    if (tab === 'cw') return drawCwMarks(c, w);
    if (tab === 'sstv') return drawSstvMarks(c, w);
    drawFlags(c, w);
  }
  // Échelle de 0 à 3000 Hz (graduations façon JTDX)
  function ticks(c, w) {
    const H = SCALE_H;
    c.clearRect(0, 0, w, H);
    c.fillStyle = '#0b1018';
    c.fillRect(0, 0, w, H);
    c.font = 'bold 11px Verdana, "DejaVu Sans", Arial, sans-serif'; // graduations 500, 1000… en blanc gras
    c.textBaseline = 'top';
    // Graduations fines façon JTDX : ligne de base, petit trait tous les 50 Hz, moyen tous les 100 Hz, grand tous les 500 Hz
    c.strokeStyle = '#46546a';
    c.beginPath(); c.moveTo(0, 13.5); c.lineTo(w, 13.5); c.stroke();
    const step = w / WF_MAX_HZ >= 0.25 ? 50 : 100;
    for (let f = 0; f <= WF_MAX_HZ; f += step) {
      const x = Math.round((f / WF_MAX_HZ) * (w - 1)) + 0.5;
      const big = f % 500 === 0;
      const mid = f % 100 === 0;
      c.strokeStyle = big ? '#8a9bb0' : mid ? '#5d6c80' : '#3c4859';
      c.beginPath();
      c.moveTo(x, big ? 11 : 14);
      c.lineTo(x, big ? H : mid ? 20 : 17);
      c.stroke();
      if (big && f > 0 && f < WF_MAX_HZ) {
        c.fillStyle = '#F0F5FA';
        c.fillText(String(f), x - c.measureText(String(f)).width / 2, 0);
      }
    }
  }
  function drawFlags(c, w) {
    // Largeur d'un signal FT8 (50 Hz) / FT4 (83 Hz) / JT65 (178 Hz) / JTTY (127 Hz, centré) : TX en rouge, RX en vert
    const bw = tab === 'jtty' ? 127 : mode === 'FT4' ? 83 : mode === 'FT2' ? 167 : mode === 'JT65' ? 178 : 50;
    // Drapeaux TX (rouge) et RX (vert) avec leur fréquence ; hampe à la fréquence exacte, drapeau retourné près du bord droit
    c.font = 'bold 11px Verdana, "DejaVu Sans", Arial, sans-serif';
    c.textBaseline = 'middle';
    const flag = (f, y, h, fill, pole, label) => {
      const x0 = (f / WF_MAX_HZ) * w;
      const sw = Math.max(3, ((f + bw) / WF_MAX_HZ) * w - x0);
      const fw = Math.max(sw, c.measureText(label).width + 12);
      // Hampe toujours à gauche de l'étiquette, sur la fréquence (comme le trait de la cascade)
      c.fillStyle = fill;
      c.fillRect(x0, y, Math.min(fw, w - x0), h);
      c.fillStyle = pole;
      c.fillRect(x0, y, 3, h);
      c.fillStyle = '#FFFFFF';
      c.fillText(label, Math.min(x0 + 7, w - fw + 7), y + h / 2 + 1);
    };
    flag(txF, 14, 14, 'rgba(190, 28, 28, .92)', '#ff7a6a', 'TX ' + Math.round(txF));
    flag(rxF, 29, 15, 'rgba(0, 140, 66, .92)', '#7CF29F', 'RX ' + Math.round(rxF));
    // Repères sur la cascade
    const pos = (el, f) => { el.style.left = (f / WF_MAX_HZ) * 100 + '%'; el.style.width = (bw / WF_MAX_HZ) * 100 + '%'; };
    pos($('dgMkRx'), rxF);
    pos($('dgMkTx'), txF);
    $('dgRxF').textContent = Math.round(rxF) + ' Hz';
    $('dgRxF2').textContent = Math.round(rxF);
    $('dgTxF').textContent = Math.round(txF);
    if ($('jtRxF')) { $('jtRxF').textContent = Math.round(rxF); $('jtTxF').textContent = Math.round(txF); $('jtRxF2').textContent = Math.round(rxF) + ' Hz'; }
  }
  // ------------------------------------------------------------------ RTTY
  const RTTY_DIAL = [['80 m', 3590], ['40 m', 7040], ['30 m', 10142], ['20 m', 14085], ['17 m', 18101], ['15 m', 21085], ['12 m', 24910], ['10 m', 28085]];
  // Deux décodeurs RTTY indépendants : rts[0] = A (VFO-A, à gauche), rts[1] = B (VFO-B, à droite)
  const rtLoad = (key, f0) => {
    let o = {};
    try { o = JSON.parse(store.get(key, '{}')) || {}; } catch (e) { o = {}; }
    return { f: Number(o.f) || f0, shift: [170, 200, 425, 850].indexOf(o.shift) >= 0 ? o.shift : 170,
      baud: [45.45, 50, 75, 100].indexOf(o.baud) >= 0 ? o.baud : 45.45, rev: !!o.rev, squelch: Number(o.squelch) || 12 };
  };
  const rts = [rtLoad('rtty', 1500), rtLoad('rttyb', 2100)];
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
      { name: 'RYRY', text: '<TX>RYRYRYRYRYRYRYRYRYRYRYRY\n<RX>' },
      { name: 'Heure', text: '<TX>UTC <ZT> <ZD>\n<RX>' }
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
      { name: 'CQ', text: 'CQ CQ CQ DE <MYCALL> <MYCALL> <MYCALL> K' },
      { name: 'Appel', text: '<CALL> DE <MYCALL> <MYCALL> K' },
      { name: 'Report', text: '<CALL> TU UR 5NN 5NN BK' },
      { name: 'R TU', text: 'R TU 73 <CALL> DE <MYCALL> SK' },
      { name: '73', text: '<CALL> TNX FER QSO 73 DE <MYCALL> SK' },
      { name: 'QRZ?', text: 'QRZ? DE <MYCALL> K' },
      { name: 'AGN?', text: 'AGN? AGN?' }
    ]
  };
  const TAGS = [
    ['<TX>', 'émission immédiate au clic (sinon : texte ajouté à la zone d’écriture)'], ['<RX>', 'retour en réception à la fin (toujours fait)'], ['<LOG>', 'ouvre la fiche du QSO pour l’enregistrer dans le carnet'],
    ['<MYCALL>', 'indicatif émis (ON5VL)'], ['<CALL>', 'correspondant'], ['<NAME>', 'son prénom'], ['<QTH>', 'son QTH'],
    ['<RST>', 'report envoyé'], ['<LOC>', 'son locator'], ['<MYLOC>', 'locator de la station'], ['<MYQTH>', 'QTH de la station'],
    ['<OPCALL>', 'votre indicatif (opérateur)'], ['<CNTR>', 'numéro de série'], ['<INCR>', 'numéro suivant'], ['<ZT>', 'heure UTC'], ['<ZD>', 'date UTC']
  ];
  let macros = (() => { try { return JSON.parse(store.get('macros', '{}')) || {}; } catch (e) { return {}; } })();
  const macroList = (mode) => (macros[mode] && macros[mode].length ? macros[mode] : DEF_MACROS[mode] || []);
  function saveRtty(reannounce) {
    store.set('rtty', JSON.stringify(rts[0]));
    store.set('rttyb', JSON.stringify(rts[1]));
    if (reannounce) announce();
  }
  // Repères Mark (jaune) / Space (bleu) d'un décodeur sur son échelle et sa cascade
  function rttyMarks(c, w, r, mkM, mkS) {
    const half = r.shift / 2;
    const fm = r.rev ? r.f - half : r.f + half;
    const fs = r.rev ? r.f + half : r.f - half;
    const bw = Math.max(20, r.baud);
    const bar = (f, y, h, fill, edge) => {
      const x0 = ((f - bw / 2) / WF_MAX_HZ) * w;
      c.fillStyle = fill;
      c.fillRect(x0, y, Math.max(2, (bw / WF_MAX_HZ) * w), h);
      c.fillStyle = edge;
      c.fillRect((f / WF_MAX_HZ) * w - 1, y, 2, h);
    };
    bar(fm, 14, 16, 'rgba(242, 207, 74, .35)', '#F2CF4A');
    bar(fs, 14, 16, 'rgba(0, 212, 255, .3)', '#00D4FF');
    const pos = (el, f) => { if (!el) return; el.style.left = ((f - bw / 2) / WF_MAX_HZ) * 100 + '%'; el.style.width = (bw / WF_MAX_HZ) * 100 + '%'; };
    pos(mkM, fm);
    pos(mkS, fs);
  }
  function drawRttyMarks(c, w) {
    rtKhz(c, w, rtDialOf(0));
    rttyMarks(c, w, rts[0], $('dgMkRx'), $('dgMkTx'));
    // Cascade du décodeur B : même spectre (même BF du TRX), ses propres repères
    if (wfB.sctx) {
      rtKhz(wfB.sctx, wfB.cw, rtDialOf(1));
      rttyMarks(wfB.sctx, wfB.cw, rts[1], $('rtMkMB'), $('rtMkSB'));
    }
    rtHeads();
  }
  // Fréquence porteuse (VFO) de chaque décodeur RTTY : le VFO reçu ; en double réception (FTX-1), B = VFO-B
  // sign : +1 en USB / DATA-U (fréquence = porteuse + audio), −1 en LSB / DATA-L
  function rtDialOf(ch) {
    const st = api && api.state && api.state();
    const r = st && st.radio;
    if (!r) return null;
    const dual = r.dualRx === 1 && r.freq && r.freqB;
    const useB = dual ? ch === 1 : r.vfoSel === 1 && !!r.freqB;
    const hz = Number(useB ? r.freqB : r.freq) || 0;
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
    const xOf = (rf) => ((d.sign * (rf - d.hz)) / WF_MAX_HZ) * (w - 1);
    const lo = d.sign > 0 ? d.hz : d.hz - WF_MAX_HZ;
    const hi = d.sign > 0 ? d.hz + WF_MAX_HZ : d.hz;
    const labelStep = w / WF_MAX_HZ >= 0.12 ? 500 : 1000;
    for (let rf = Math.ceil(lo / 50) * 50; rf <= hi; rf += 50) {
      const x = Math.round(xOf(rf)) + 0.5;
      const big = rf % 500 === 0;
      const mid = rf % 100 === 0;
      c.strokeStyle = big ? '#8a9bb0' : mid ? '#5d6c80' : '#3c4859';
      c.beginPath(); c.moveTo(x, big ? 11 : 14); c.lineTo(x, big ? H : mid ? 20 : 17); c.stroke();
      if (rf % labelStep === 0 && x > 20 && x < w - 20) {
        const t = (rf / 1000).toLocaleString('fr-BE', { minimumFractionDigits: rf % 1000 ? 1 : 0, maximumFractionDigits: 1 });
        c.fillStyle = '#F0F5FA';
        c.fillText(t, x - c.measureText(t).width / 2, 0);
      }
    }
    // Centre de la cascade (1500 Hz) : petit triangle blanc
    const xc = (1500 / WF_MAX_HZ) * (w - 1);
    c.fillStyle = '#FFFFFF';
    c.beginPath(); c.moveTo(xc - 5, H - 1); c.lineTo(xc + 5, H - 1); c.lineTo(xc, H - 7); c.closePath(); c.fill();
  }
  // Accord du VFO depuis une cascade RTTY (glisser / molette) : les décodeurs restent sur leurs signaux (même fréquence réelle)
  function rtSetDial(d, nd) {
    const delta = -d.sign * (nd - d.hz); // déplacement des signaux dans la cascade (Hz audio)
    if (!delta) return;
    api.setFreq(nd, d.vfo);
    rts.forEach((x, ch) => {
      const dd = rtDialOf(ch);
      if (!dd || dd.vfo !== d.vfo) return;
      const f = x.f + delta;
      if (f >= 200 + x.shift / 2 && f <= WF_MAX_HZ - 100 - x.shift / 2) x.f = f;
    });
    saveRtty(true);
    drawScale();
  }
  function rtTuneOk() {
    if (!api || !api.iControl()) { api && api.say('Prenez la main pour accorder le TRX.', 'warn'); return false; }
    const st = api.state();
    if (st && ((st.ptt && st.ptt.active) || st.ftx)) { api.say('Réglage bloqué pendant l’émission.', 'warn'); return false; }
    return true;
  }
  function rtDragInit(ids, ch) {
    let drag = null;
    let swallowClick = false;
    for (const id of ids) {
      const el = $(id);
      el.addEventListener('pointerdown', (e) => {
        if (tab !== 'rtty' || e.button !== 0) return;
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
        if (nd !== drag.cur && now - drag.t > 120) { rtSetDial(Object.assign({}, drag.d, { hz: drag.cur }), nd); drag.cur = nd; drag.t = now; }
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
      // Molette : VFO ± 10 Hz par cran (Maj : ± 100 Hz)
      el.addEventListener('wheel', (e) => {
        if (tab !== 'rtty') return;
        e.preventDefault();
        if (!rtTuneOk()) return;
        const d = rtDialOf(ch);
        if (!d) return;
        const st = (e.shiftKey ? 100 : 10) * (e.deltaY < 0 ? 1 : -1);
        const base = rtWheelHz && rtWheelHz.vfo === d.vfo && Date.now() - rtWheelHz.t < 1500 ? rtWheelHz.hz : d.hz;
        const nd = Math.round((base + st) / 10) * 10;
        rtSetDial(Object.assign({}, d, { hz: base }), nd);
        rtWheelHz = { vfo: d.vfo, hz: nd, t: Date.now() };
      }, { passive: false });
    }
  }
  let rtWheelHz = null; // molette rapide : on part de la dernière fréquence envoyée, pas de l'état relu (en retard)
  // Centrer : le VFO se déplace pour que le signal du décodeur tombe au milieu de la cascade (1500 Hz)
  function rtCenter(ch) {
    if (!api || !api.iControl()) return api && api.say('Prenez la main pour centrer le signal (le TRX change de fréquence).', 'warn');
    const st = api.state();
    if (st && ((st.ptt && st.ptt.active) || st.ftx)) return api.say('Réglage bloqué pendant l’émission.', 'warn');
    const d = rtDialOf(ch);
    if (!d) return api.say('Fréquence du TRX pas encore lue.', 'warn');
    const r = rts[ch];
    const nd = Math.round((d.hz + d.sign * (r.f - 1500)) / 10) * 10;
    const delta = d.sign * (nd - d.hz); // déplacement en Hz audio
    if (!delta) return;
    api.setFreq(nd, d.vfo);
    r.f -= delta;
    // Même porteuse pour l'autre décodeur (réception simple) : il reste calé sur son signal s'il est encore dans la cascade
    const o = rts[1 - ch];
    const od = rtDialOf(1 - ch);
    if (od && od.vfo === d.vfo && o.f - delta >= 200 + o.shift / 2 && o.f - delta <= WF_MAX_HZ - 100 - o.shift / 2) o.f -= delta;
    saveRtty(true);
    drawScale();
    api.say('Décodeur ' + (ch ? 'B' : 'A') + ' centré : VFO ' + d.vfo + ' sur ' + (nd / 1000).toLocaleString('fr-BE', { minimumFractionDigits: 2 }) + ' kHz.', '', 4000);
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
      $('rtRf' + sfx).textContent = d ? (((d.hz + d.sign * x.f) / 1000).toLocaleString('fr-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' kHz' + (own ? '' : ' (VFO ' + d.vfo + ')')) : '';
      $('rtRf' + sfx).title = !d ? '' : own ? 'Fréquence du signal suivi : VFO ' + d.vfo + ' ' + (d.sign > 0 ? '+' : '−') + ' ' + Math.round(x.f) + ' Hz'
        : 'Réception simple : ce décodeur lit le même récepteur que l’autre, celui du VFO ' + d.vfo + ' (le VFO ' + (ch ? 'B' : 'A') + ' n’est pas écouté). Fréquence = VFO ' + d.vfo + ' ' + (d.sign > 0 ? '+' : '−') + ' ' + Math.round(x.f) + ' Hz.';
    });
    // Porteuse changée (molette, bandes…) : échelles en kHz redessinées
    const dk = JSON.stringify([rtDialOf(0), rtDialOf(1)]);
    if (dk !== rtDialKey) { rtDialKey = dk; if (tab === 'rtty') { drawScale(); return; } }
    document.querySelectorAll('.rt-txsel').forEach((b) => {
      const on = Number(b.dataset.ch) === rtTx;
      b.setAttribute('aria-pressed', String(on));
      b.closest('.rt-side').classList.toggle('rt-istx', on);
    });
  }
  function setRttyF(f, ch) {
    const r = rts[ch || 0];
    r.f = Math.max(200 + r.shift / 2, Math.min(WF_MAX_HZ - 100 - r.shift / 2, Math.round(f)));
    saveRtty(true);
    drawScale();
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
    const up = (v) => String(v || '').trim().toUpperCase();
    const d = new Date(now());
    const p2 = (n) => String(n).padStart(2, '0');
    let cntr = Number(store.get('cntr', '1')) || 1;
    let out = String(t)
      .replace(/<TX>|<RX>|<LOG>/gi, '')
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
    out = out.replace(/<CNTR>/g, pad3(cntr));
    if (/<INCR>/.test(out)) {
      if (apply) { cntr++; store.set('cntr', cntr); }
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
    // Glisser la bande ou molette sur une cascade RTTY : accord du VFO
    rtDragInit(['dgWf', 'dgScale'], 0);
    rtDragInit(['rtWfB', 'rtScaleB'], 1);
    // Décodeur de l'émission : bouton TX de son en-tête
    document.querySelectorAll('.rt-txsel').forEach((b) => b.addEventListener('click', () => {
      rtTx = Number(b.dataset.ch) === 1 ? 1 : 0;
      store.set('rttx', String(rtTx));
      rtHeads();
      dtxState(api && api.state() && api.state().ftx);
    }));
    // Cascade du décodeur B : clic (gauche ou droit) = caler le décodeur B
    for (const id of ['rtWfB', 'rtScaleB']) {
      const fB = (e) => { const r = e.currentTarget.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * WF_MAX_HZ; };
      $(id).addEventListener('click', (e) => setRttyF(fB(e), 1));
      $(id).addEventListener('contextmenu', (e) => { e.preventDefault(); setRttyF(fB(e), 1); });
    }
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
  function wsAdd(item) {
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
  function jtRow(u) {
    const r = document.createElement('div');
    const up = String(u.text || '').toUpperCase();
    const me = jtMe(u);
    r.className = 'dg-row jt-row' + (me ? ' me' : /^CQ\b/.test(up) ? ' cq' : '') + (u.done ? ' done' : ' live');
    r.dataset.key = u.key;
    const cells = [utc(u.t).slice(0, 6), (u.db >= 0 ? '+' : '') + u.db, u.f, u.text + (u.done ? '' : ' ▌')];
    for (const v of cells) { const s = document.createElement('span'); s.textContent = String(v); r.appendChild(s); }
    r.title = u.f + ' Hz · ' + (u.done ? 'message terminé' : 'réception en cours') + ' · clic gauche : réception ici · clic droit : émission ici · double-clic : correspondant';
    r.addEventListener('click', () => setRx(u.f));
    r.addEventListener('contextmenu', (e) => { e.preventDefault(); setTx(u.f); });
    r.addEventListener('dblclick', () => jtPick(u));
    return r;
  }
  const jtInRx = (u) => Math.abs(u.f - rxF) <= JT_RX_WIDTH || jtMe(u);
  // Double-clic : l'indicatif du message (après CQ / DE, sinon le dernier) devient le correspondant
  function jtPick(u) {
    const w = String(u.text || '').toUpperCase().split(/\s+/).filter(Boolean);
    const calls = w.filter((x) => CALL_RE.test(x) && stationCalls.indexOf(x) < 0);
    let call = '';
    const i = w.findIndex((x) => x === 'CQ' || x === 'DE');
    if (i >= 0) call = w.slice(i + 1).find((x) => CALL_RE.test(x) && stationCalls.indexOf(x) < 0) || '';
    if (!call) call = calls[calls.length - 1] || '';
    if (!call) { setRx(u.f); return api && api.say('Pas d’indicatif à reprendre dans ce message.', 'warn'); }
    const g = w.find((x) => GRID_RE.test(x) && x !== 'RR73');
    setDx({ call, grid: g || '', rpt: fmtRpt(u.db) });
    setRx(u.f);
  }
  // Mise à jour d'un message : la ligne existante est remplacée (le texte grandit trame après trame)
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
  const cwRows = []; // dernières lignes de cascade (calage sur le signal)
  let cwDf = 6.25;   // largeur d'une case de ces lignes (Hz)
  let cwLast = 0;
  function saveCw(reannounce) {
    store.set('cw', JSON.stringify(cwc));
    if (reannounce) announce();
  }
  function drawCwMarks(c, w) {
    const x0 = ((cwc.f - cwc.bw / 2) / WF_MAX_HZ) * w;
    c.fillStyle = 'rgba(242, 207, 74, .35)';
    c.fillRect(x0, 14, Math.max(2, (cwc.bw / WF_MAX_HZ) * w), 16);
    c.fillStyle = '#F2CF4A';
    c.fillRect((cwc.f / WF_MAX_HZ) * w - 1, 12, 2, 18);
    const el = $('dgMkRx');
    el.style.left = ((cwc.f - cwc.bw / 2) / WF_MAX_HZ) * 100 + '%';
    el.style.width = (cwc.bw / WF_MAX_HZ) * 100 + '%';
    $('dgMkTx').style.width = '0';
    $('cwF').textContent = Math.round(cwc.f);
  }
  // Clic sur la cascade : calage sur le signal le plus fort à ±60 Hz (sinon, là où l'on a cliqué)
  function setCwF(f, snap) {
    if (snap && cwRows.length) {
      const df = cwDf || 6.25;
      const b0 = Math.max(0, Math.floor((f - 60) / df));
      const b1 = Math.ceil((f + 60) / df);
      let best = -1;
      let bv = -1;
      const sum = (b) => cwRows.reduce((a, r) => a + (r[b] || 0), 0);
      const all = [];
      for (let b = b0; b <= b1; b++) { const v = sum(b); all.push(v); if (v > bv) { bv = v; best = b; } }
      all.sort((a, b) => a - b);
      // Pic au moins 6 dB (12 octets par ligne) au-dessus de la médiane du voisinage
      if (best >= 0 && bv - all[all.length >> 1] > 12 * cwRows.length) f = best * df;
    }
    cwc.f = Math.max(200, Math.min(2800, Math.round(f)));
    saveCw(true);
    drawScale();
  }
  function cwAppend(text) {
    const el = $('cwRx');
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    el.appendChild(document.createTextNode(text));
    if (el.textContent.length > 20000) el.textContent = el.textContent.slice(-15000);
    if (atEnd) el.scrollTop = el.scrollHeight;
    cwLast = Date.now();
  }
  function cwLevels(m) {
    if (!$('cwBar')) return;
    $('cwBar').style.width = Math.max(0, Math.min(100, (m.s / 30) * 100)) + '%';
    $('cwDb').textContent = m.s + ' dB';
    $('cwLed').classList.toggle('on', !!m.on);
    $('cwBar').classList.toggle('low', m.s < cwc.squelch);
    if (m.s >= cwc.squelch) $('cwWpm').textContent = String(m.wpm);
  }
  function insertCw(t) {
    showTab('cw');
    const ta = $('cwTxt');
    ta.value += macroText(t, true).toUpperCase();
    ta.scrollTop = ta.scrollHeight;
    ta.focus();
  }
  function initCw() {
    $('cwBw').value = String(cwc.bw);
    $('cwSq').value = String(cwc.squelch);
    $('cwSqV').textContent = String(cwc.squelch);
    $('cwBw').addEventListener('change', () => { cwc.bw = Number($('cwBw').value); saveCw(true); drawScale(); });
    $('cwSq').addEventListener('input', () => { $('cwSqV').textContent = $('cwSq').value; });
    $('cwSq').addEventListener('change', () => { cwc.squelch = Number($('cwSq').value); saveCw(true); });
    const sp = $('cwSpeed');
    sp.value = store.get('cwspeed', '22');
    sp.addEventListener('change', () => { const v = Math.max(5, Math.min(50, Math.round(Number(sp.value) || 22))); sp.value = v; store.set('cwspeed', v); });
    const dial = $('cwDial');
    fillList(dial, withQo(CW_DIAL, 'CW'), store.get('cwdial', '14030'));
    dial.addEventListener('change', () => { store.set('cwdial', dial.value); qsyTo(Number(dial.value), 'CW'); });
    $('cwQsy').addEventListener('click', () => qsyTo(Number(dial.value), 'CW'));
    $('cwClear').addEventListener('click', () => { $('cwRx').textContent = ''; });
    $('cwTxClear').addEventListener('click', () => { $('cwTxt').value = ''; });
    $('cwTxt').addEventListener('input', (e) => {
      const el = e.target;
      const p = el.selectionStart;
      el.value = el.value.toUpperCase();
      el.setSelectionRange(p, p);
    });
    $('cwRx').addEventListener('dblclick', () => {
      const w = String(window.getSelection() || '').trim().toUpperCase();
      if (CALL_RE.test(w)) setDx({ call: w });
    });
    $('cwSend').title = 'Émission CW : prochaine version';
    drawMacroRow($('cwMacros'), 'CW', (t) => insertCw(t));
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
    $('ssSend').title = 'Émission SSTV : prochaine version';
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
  function pickFromDecode(d, slot) {
    if (slot && SLOT_MS[mode]) dxPar = { mode, call: '', parity: Math.round(slot / SLOT_MS[mode]) % 2 };
    const w = d.msg.toUpperCase().split(/\s+/).map((x) => x.replace(/^<|>$/g, ''));
    let call = '';
    if (w[0] === 'CQ') call = CALL_RE.test(w[1] || '') ? w[1] : (w[2] || '');
    else call = w[1] || '';
    if (!CALL_RE.test(call)) return api && api.say('Pas d’indicatif à reprendre dans ce message.', 'warn');
    const last = w[w.length - 1];
    setDx({ call, grid: GRID_RE.test(last) && last !== 'RR73' ? last : '', rpt: fmtRpt(d.db) });
    if (dxPar) dxPar.call = call;
    setRx(d.f);
    // Message suivant comme WSJT-X : réponse à un CQ → Tx1 ; message qui nous est adressé → selon son contenu
    const toMe = stationCalls.indexOf(w[0]) >= 0;
    const p = toMe ? (w[2] || '') : '';
    ftxSel = !toMe ? 0 : GRID_RE.test(p) && p !== 'RR73' ? 1 : /^[+-]\d{2}$/.test(p) ? 2 : /^R[+-]\d{2}$/.test(p) ? 3 : /^(RRR|RR73)$/.test(p) ? 4 : p === '73' ? 4 : 0;
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
    f.textContent = '';
    ftxMsgs().forEach((t, i) => mk(f, 'Tx' + (i + 1), t, () => ftxSend(i, t), i === ftxSel)
      .title = 'Clic : ce message part à chaque période (FT8 / FT4 / FT2 selon l’onglet) jusqu’à la réponse ; la séquence avance toute seule. ■ Arrêter pour couper.');
    // Tx7 : texte libre de 13 caractères au plus (comme WSJT-X)
    const free = String(store.get('ftxfree', '')).toUpperCase();
    const fb = mk(f, 'Tx7', free || 'texte libre…', () => (free ? ftxSend(6, free) : editFree(f.ownerDocument)), ftxSel === 6);
    fb.title = 'Texte libre FT8 / FT4 / FT2 (13 caractères) · clic : émission · clic droit : modifier';
    fb.addEventListener('contextmenu', (e) => { e.preventDefault(); editFree(fb.ownerDocument); });
    const ed = mk(f, '', '✎', () => editFree(f.ownerDocument));
    ed.title = 'Modifier le texte libre (Tx7)';
    ed.classList.add('mini');
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
      free: String(store.get('ftxfree', '')), call1st: store.get('call1st', '1') === '1', keyNow: !!keyNow, rxf: rxF });
  }
  const curTxF = () => Math.round(Number(store.get('txf', String(txF))) || txF);
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
    if (st && st.seq && st.seq.on && st.seq.by === opCall) api.send({ t: 'ftx_cfg', f0: curTxF(), parity: txParity(ftxSel), call1st: store.get('call1st', '1') === '1' });
  }
  // Fin de QSO (73 / RR73) : proposition d'enregistrement dans le carnet, comme « Prompt me to log QSO » de WSJT-X
  function qsoPrompt(q) {
    const doc = ($('msgFtx') && $('msgFtx').ownerDocument) || document;
    const old = doc.getElementById('qsoDlg');
    if (old) old.remove();
    const dlg = doc.createElement('dialog');
    dlg.id = 'qsoDlg';
    dlg.className = 'macro-dlg qso-dlg';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    dlg.innerHTML = '<div class="qso-b"><h3>QSO terminé</h3><p><b>' + esc(q.call) + '</b>' + (q.gridsquare ? ' · ' + esc(q.gridsquare) : '') + ' · ' + esc(q.mode) + ' · ' +
      esc(Number(q.freq).toFixed(6)) + ' MHz<br>Report envoyé ' + esc(q.rst_sent || '—') + ' · reçu ' + esc(q.rst_rcvd || '—') + ' · ' +
      esc(q.time_on.slice(0, 2) + ':' + q.time_on.slice(2, 4)) + '–' + esc(q.time_off.slice(0, 2) + ':' + q.time_off.slice(2, 4)) + ' UTC</p>' +
      '<div class="md-act"><button class="btn" type="button" data-a="log">Enregistrer dans le carnet</button><button class="btn" type="button" data-a="no">Ne pas enregistrer</button></div></div>';
    doc.body.appendChild(dlg);
    try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
    dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelector('[data-a="log"]').addEventListener('click', () => {
      const qso = Object.assign({}, q);
      // Nom et QTH du correspondant (fiche QRZ.com ou saisis dans la barre du correspondant)
      if (dx && String(dx.call || '').toUpperCase() === String(q.call || '').toUpperCase()) {
        if (dx.name && !qso.name) qso.name = dx.name;
        if (dx.qth && !qso.qth) qso.qth = dx.qth;
      }
      if (!qso.gridsquare) delete qso.gridsquare;
      if (!qso.tx_pwr) delete qso.tx_pwr;
      api.send({ t: 'log_add', qso });
      dlg.remove();
    });
    dlg.querySelector('[data-a="no"]').addEventListener('click', () => dlg.remove());
  }
  // ------------------------------------------------------------------ émission RTTY / JTTY (signal fabriqué par le serveur)
  let dtxPend = null; // { mode, text } : texte à effacer de la zone d'écriture une fois l'émission partie
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

  let lastTxAt = 0;
  let seqSeen = '';
  function ftxState() {
    const st = api && api.state();
    const x = st && st.ftx;
    const sq = st && st.seq;
    const el = $('dgTxState');
    dtxState(x);
    const mine = !!(sq && sq.by === opCall);
    if ($('dgStop')) $('dgStop').disabled = !(x || (sq && sq.on) || (st && st.ptt && st.ptt.digi));
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
      hist.push(it);
      if (x.mode === mode) addSlot(it, false);
    }
  }

  // Rangée de macros : clic = utiliser, clic droit = modifier, ✎ = modifier
  function drawMacroRow(box, mode, use) {
    if (!box) return;
    box.textContent = '';
    macroList(mode).forEach((m, i) => {
      const b = box.ownerDocument.createElement('button');
      b.className = 'btn';
      b.type = 'button';
      if (mode !== 'FT8') { const s = box.ownerDocument.createElement('small'); s.textContent = 'F' + (i + 1); b.appendChild(s); }
      b.appendChild(box.ownerDocument.createTextNode(m.name || '—'));
      const tip = () => macroText(m.text).replace(/\n/g, ' ⏎ ') + '\n' +
        (/<TX>/i.test(m.text) && mode !== 'CW' ? 'clic : émission immédiate · Maj+clic : ajouter au texte · clic droit : modifier' : 'clic : ajouter au texte · clic droit : modifier');
      if (/<TX>/i.test(m.text) && mode !== 'CW') b.classList.add('mac-tx');
      b.title = tip();
      b.addEventListener('mouseenter', () => { b.title = tip(); });
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
    drawMacroRow($('rtMacros'), 'RTTY', (t, ins) => useMacro('RTTY', t, ins));
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
      '<h3>Macros ' + mode + '</h3>' +
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
    const prev = () => { dlg.querySelector('.md-prev').textContent = 'Aperçu : ' + macroText(f.text.value).replace(/\n/g, ' ⏎ '); };
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
    drawMacroRow($('cwMacros'), 'CW', (t) => insertCw(t));
  }
  // Clic sur une macro (ou F1…F12) : <TX> = émission immédiate, sinon texte ajouté à la zone d'écriture.
  // Maj+clic : toujours ajouter à la zone (pour composer un message avant « Émettre »).
  function useMacro(mode, t, ins) {
    if (mode === 'CW') { if (/<LOG>/i.test(t) && !ins) setTimeout(() => logQso(), 0); return insertCw(t); }
    if (/<LOG>/i.test(t) && !ins) setTimeout(() => logQso(), 0);
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
  function logQso() {
    if (!api) return;
    if (!window.RSLOG) return api.say('Carnet de trafic non disponible dans cette version du dashboard.', 'warn');
    const doc = ($('msgs') && $('msgs').ownerDocument) || document;
    const old = doc.getElementById('qsoLogDlg');
    if (old) old.remove();
    const st = api.state() || {};
    const r = st.radio || {};
    const m = (window.RSDIGI && window.RSDIGI.logMode ? window.RSDIGI.logMode() : '') || 'RTTY';
    const rxB = r.vfoSel === 1 && r.freqB;
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
      '<label class="ql-wide">Remarque <input name="comment" maxlength="200"></label></div>' +
      '<p class="md-prev ql-msg"></p>' +
      '<div class="md-act"><span></span><button class="btn" value="cancel">Annuler</button><button class="btn btn-primary" type="button" data-a="save">Enregistrer dans le carnet</button></div></form>';
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
      for (const k of Object.keys(qso)) if (qso[k] === '') delete qso[k];
      api.send({ t: 'log_add', qso });
      dlg.close();
    });
    dlg.addEventListener('close', () => dlg.remove());
    try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
    (dx.call ? f.querySelector('[data-a="save"]') : f.call).focus();
  }

  function setTx(f) {
    txF = Math.max(100, Math.min(WF_MAX_HZ - 100, Math.round(f)));
    store.set('txf', txF);
    drawScale();
    ftxCfg();
  }
  function setRx(f) {
    rxF = Math.max(100, Math.min(WF_MAX_HZ - 100, Math.round(f)));
    store.set('rxf', rxF);
    drawScale();
    redrawRx();
    if (tab === 'jtty') jtRedraw();
  }

  // ------------------------------------------------------------------ listes de messages
  const hist = []; // { slot, mode, list }
  const pad = (n) => String(n).padStart(2, '0');
  // FT2 : périodes de 3,75 s (…:18,75) → dixième de seconde affiché
  const utc = (ms) => { const d = new Date(ms); return pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + (ms % 1000 ? '.' + Math.floor((ms % 1000) / 100) : ''); };
  const callsIn = (msg) => msg.toUpperCase().split(/\s+/).map((w) => w.replace(/^<|>$/g, ''));
  function cls(msg) {
    const w = callsIn(msg);
    if (w.some((x) => stationCalls.indexOf(x) >= 0)) return 'me';
    if (w[0] === 'CQ') return 'cq';
    return '';
  }
  // Indicatif de la station qui émet ce message (celui que reprend un double-clic), sinon ''
  function senderOf(msg) {
    const w = callsIn(msg);
    const c = w[0] === 'CQ' ? (CALL_RE.test(w[1] || '') ? w[1] : w[2] || '') : w[1] || '';
    return CALL_RE.test(c) && stationCalls.indexOf(c) < 0 && String(msg).toUpperCase().indexOf(c) >= 0 ? c : '';
  }
  // Stations déjà contactées sous le TX CALL actuel (envoyées par le serveur) : « INDICATIF|BANDE|MODE »
  let worked = new Set();
  let workedStation = '';
  function curBand() {
    const st = api && api.state && api.state();
    const f = st && st.radio && (st.radio.vfoSel === 1 ? st.radio.freqB : st.radio.freq);
    const mhz = f ? f / 1e6 : 0;
    const b = BANDS_M.find((x) => mhz >= x[0] && mhz <= x[1]);
    return b ? b[2] : '';
  }
  function isWorked(msg) {
    if (!worked.size || FT_MODES.indexOf(mode) < 0) return false;
    const c = senderOf(msg);
    return !!c && worked.has(c + '|' + curBand() + '|' + mode);
  }
  function rowEl(slot, d) {
    const r = document.createElement('div');
    const k = d.tx ? 'tx' : cls(d.msg);
    const wk = !d.tx && k !== 'me' && isWorked(d.msg);
    r.className = 'dg-row ft ' + k + (wk ? ' wkd' : '');
    r.title = d.tx ? 'Message émis' : (wk ? 'Déjà contacté sous ' + workedStation + ' sur cette bande dans ce mode · ' : '') + d.f + ' Hz · clic sur l’indicatif (souligné) ou double-clic : répondre à cette station (émission à la période suivante) · clic ailleurs : réception ici · clic droit : émission ici';
    const cells = d.tx ? [utc(slot), 'TX', '', d.f, d.msg] : [utc(slot), (d.db >= 0 ? '+' : '') + d.db, d.dt.toFixed(1), d.f, d.msg];
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
        c.title = 'Clic : répondre à ' + who + ' (émission à la période suivante, avec la main)';
        c.addEventListener('click', (e) => { e.stopPropagation(); pickFromDecode(d, slot); });
        s.appendChild(c);
        s.appendChild(document.createTextNode(String(v).slice(k + who.length)));
      }
      r.appendChild(s);
    });
    // Décodage aidé « a priori » (AP) : repère « a1 »… après le message, comme WSJT-X
    if (!d.tx && d.ap > 0 && r.querySelector('span.msg')) {
      const a = document.createElement('i');
      a.className = 'dg-ap';
      a.textContent = ' a' + d.ap;
      a.title = 'Décodé avec l’aide a priori (AP) de WSJT-X : le décodeur a supposé une partie du message (CQ, notre indicatif, celui du correspondant…). Fiable, mais à confirmer si le signal est très faible.';
      r.querySelector('span.msg').appendChild(a);
    }
    // Pays DXCC, distance et azimut de la station qui émet (calculés par le serveur depuis le locator du club)
    const ex = [[d.tx ? '' : d.cty || '', 'x cty', d.cty ? d.cty : ''],
      [d.tx || d.km == null ? '' : (d.kmc ? '≈' : '') + d.km, 'x', d.km == null ? '' : (d.kmc ? 'Distance approximative (centre du pays : pas de locator dans le message)' : 'Distance depuis le locator du club')],
      [d.tx || d.az == null ? '' : d.az + '°', 'x', d.az == null ? '' : 'Azimut (direction de l’antenne) depuis le club']];
    for (const [t, c, ti] of ex) { const e = document.createElement('span'); e.className = c; e.textContent = t; if (ti) e.title = ti; r.appendChild(e); }
    r.addEventListener('click', () => setRx(d.f));
    r.addEventListener('contextmenu', (e) => { e.preventDefault(); setTx(d.f); });
    r.addEventListener('dblclick', () => { if (!d.tx) pickFromDecode(d, slot); });
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
  function addSlot(item, quiet) {
    const band = $('dgBand');
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
      for (const d of item.list) insertSorted(band, rowEl(item.slot, d), slotKey(item, item.tx ? 1 : 2));
    });
    const mine = item.list.filter(inRx);
    if (mine.length) {
      const rx = $('dgRx');
      stickToBottom(rx, () => { sep(rx); for (const d of mine) insertSorted(rx, rowEl(item.slot, d), slotKey(item, item.tx ? 1 : 2)); });
    }
  }
  function inRx(d) { return d.tx || Math.abs(d.f - rxF) <= RX_WIDTH || cls(d.msg) === 'me'; }
  function redrawRx() {
    const rx = $('dgRx');
    rx.textContent = '';
    for (const it of hist) {
      if (it.mode !== mode) continue;
      const mine = it.list.filter(inRx);
      if (!mine.length) continue;
      const sk = slotKey(it, 0);
      if (!rx.querySelector('.dg-sep[data-k="' + sk + '"]')) { const P = SLOT_MS[it.mode] || 15000; insertSorted(rx, sepEl(Math.floor((it.slot + (it.tx ? 600 : 0)) / P) * P, it.mode), sk); }
      for (const d of mine) insertSorted(rx, rowEl(it.slot, d), slotKey(it, it.tx ? 1 : 2));
    }
    rx.scrollTop = rx.scrollHeight;
  }
  function redrawAll() {
    $('dgBand').textContent = '';
    $('dgBand').dataset.sep = '';
    for (const it of hist) if (it.mode === mode) addSlot(it, true);
    redrawRx();
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
  function modeChanged() {
    document.querySelectorAll('#dgModes .btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    lastBand = 0;
    fillDial();
    drawScale();
    redrawAll();
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
    api.setFreq(Math.round(khz * 1000), 'A');
    // Mode DATA-U (Yaesu) / USB-D (Icom) : le filtre et la sortie audio conviennent aux modes numériques
    const R = api.rig();
    const mk = want === 'CW'
      ? (R.MODE_KEYS || []).find((x) => /^(CW-U|CW|CW-USB)$/i.test(x[1]))
      : (R.MODE_KEYS || []).find((x) => /^(DATA-U|USB-D|D-U|USB-DATA)$/i.test(x[1])) || (R.MODE_KEYS || []).find((x) => /^USB$/i.test(x[1]));
    if (mk) setTimeout(() => api.send({ t: 'set', mode: mk[0], sub: false }), 250);
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
    else if (tab === 'rtty') txt = 'BF reçue';
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
    const lat = st && st.digi && st.digi.latency;
    $('syLat').textContent = lat != null ? lat + ' ms' : '—';
    const m = medianDt();
    $('syDt').textContent = m ? (m.med >= 0 ? '+' : '−') + Math.abs(m.med).toFixed(1).replace('.', ',') + ' s' : '—';
    $('syDt').className = m ? (Math.abs(m.med) <= 0.3 ? 'ok' : 'warn') : '';
    // Passes du décodeur : heure d'arrivée après le début de la période (la réponse doit pouvoir partir à la suivante)
    const tm = st && st.digi && st.digi.timing;
    if (tm && $('syDec')) {
      const f = (x) => (x ? '+' + (x.at / 1000).toFixed(1).replace('.', ',') + ' s' : '—');
      const P = SLOT_MS[(tm.normal || tm.early || {}).mode] || 15000;
      $('syDec').textContent = f(tm.normal);
      $('syDec').className = tm.normal && tm.normal.at > P + 2000 ? 'warn' : 'ok';
      $('syDecNote').textContent = 'anticipée ' + f(tm.early) + ' · normale ' + f(tm.normal) + ' · profonde ' + f(tm.deep) +
        (tm.normal && tm.normal.at > P + 2000 ? ' — serveur lent : réponses parfois une période plus tard' : '');
    }
    $('syDtNote').textContent = m ? m.n + ' messages récents' + (Math.abs(m.med) > 0.3 ? ' · recalage en cours' : ' · calé') : 'en attente de décodages FT8 / FT4';
  }

  // ------------------------------------------------------------------ interface avec app.js
  window.RSDIGI = {
    setDetached,
    isPopup: POPUP,
    /** Mode numérique affiché (pour le carnet de trafic quand le TRX est en DATA) */
    logMode() {
      const t = tab;
      if (t === 'ftx') return mode;
      return { jt65: 'JT65', rtty: 'RTTY', jtty: 'JTTY', cw: 'CW', sstv: 'SSTV', wspr: 'WSPR' }[t] || store.get('ftmode', 'FT8');
    },
    qo100If: () => Object.assign({}, qoIf),
    init(a) {
      const again = !!api;
      api = a;
      if (again) { announce(); return; } // fenêtre séparée raccrochée à un dashboard rechargé
      buildDom();
      document.querySelectorAll('#centerPanel .ctab').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        // Choisir soi-même un autre onglet arrête le suivi de l'opérateur
        if (follow && api && !api.iControl()) { setFollow(false); api.say('Suivi de l’opérateur arrêté (onglet choisi).', '', 4000); }
        showTab(b.dataset.tab);
      }));
      $('dgFollow').addEventListener('click', (e) => { e.stopPropagation(); setFollow(!follow); if (follow) followView(); });
      setFollow(follow);
      $('dgDetach').addEventListener('click', (e) => {
        e.stopPropagation();
        if (POPUP) return window.close();
        // La fenêtre séparée s'ouvre sur le mode affiché
        if (MODE_TABS.indexOf(tab) >= 0) store.set('ptab', tab);
        const w = window.open('/digi.html', 'rs-digi', 'width=1200,height=860');
        if (!w) api.say('Fenêtre bloquée par Chrome : autorisez les fenêtres pop-up pour ce site.', 'warn');
      });
      $('dgBack').addEventListener('click', () => { if (window.RSHOST) window.RSHOST.closePopup(); });
      // Clic sur FT8 / FT4 : comme dans WSJT-X, le TRX va sur la fréquence d'appel de ce mode dans sa bande
      document.querySelectorAll('#dgModes .btn').forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.mode); autoQsy(); }));
      $('dgQsy').addEventListener('click', qsy);
      // Choisir une fréquence dans la liste y envoie directement le TRX (QSY)
      $('dgDial').addEventListener('change', () => { store.set('dial.' + mode, $('dgDial').value); qsy(); });
      $('dgClear').addEventListener('click', () => { hist.length = 0; redrawAll(); });
      // Réglages de la cascade
      const wfUi = () => { $('wfGain').value = wfCfg.gain; $('wfZero').value = wfCfg.zero; $('wfFlat').checked = wfCfg.flat; $('wfPal').value = wfCfg.pal; $('wfSpd').value = String(wfCfg.spd); };
      wfUi();
      $('wfGain').addEventListener('input', () => { wfCfg.gain = Number($('wfGain').value); store.set('wfgain', String(wfCfg.gain)); });
      $('wfZero').addEventListener('input', () => { wfCfg.zero = Number($('wfZero').value); store.set('wfzero', String(wfCfg.zero)); });
      $('wfFlat').addEventListener('change', () => { wfCfg.flat = $('wfFlat').checked; store.set('wfflat', wfCfg.flat ? '1' : '0'); });
      $('wfPal').addEventListener('change', () => { wfCfg.pal = $('wfPal').value; PAL = mkPal(PALS[wfCfg.pal]); store.set('wfpal2', wfCfg.pal); });
      $('wfSpd').addEventListener('change', () => { wfCfg.spd = Number($('wfSpd').value) || 2; wf.accN = 0; if (wf.acc) wf.acc.fill(0); store.set('wfspd', String(wfCfg.spd)); });
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
      const grip = $('dgGrip');
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        const y0 = e.clientY;
        const h0 = $('dgWf').getBoundingClientRect().height;
        const mv = (ev) => setWfH(h0 + ev.clientY - y0, false);
        const up = (ev) => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); setWfH(h0 + ev.clientY - y0, true); };
        grip.addEventListener('pointermove', mv);
        grip.addEventListener('pointerup', up);
        grip.addEventListener('pointercancel', up);
      });
      grip.addEventListener('dblclick', () => { $('dgWf').style.height = ''; const root = $('dgWf').closest('.dg') || document.documentElement; root.style.removeProperty('--dg-list-max'); store.set('wfh', '0'); if (wf.ctx) sizeCanvas(); });
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
      // Split : clic gauche = fréquence de réception, clic droit = fréquence d'émission
      const fAt = (e) => { const r = e.currentTarget.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * WF_MAX_HZ; };
      for (const id of ['dgWf', 'dgScale']) {
        $(id).addEventListener('click', (e) => (tab === 'sstv' ? null : tab === 'rtty' ? setRttyF(fAt(e)) : tab === 'cw' ? setCwF(fAt(e), true) : setRx(fAt(e))));
        $(id).addEventListener('contextmenu', (e) => { e.preventDefault(); if (tab === 'sstv') return; if (tab === 'rtty') setRttyF(fAt(e)); else if (tab === 'cw') setCwF(fAt(e), false); else setTx(fAt(e)); });
      }
      initRtty();
      initWspr();
      initJtty();
      initCw();
      initSstv();
      initMsgs();
      // Touches F1 à F12 dans la fenêtre RTTY : macros (comme FLDIGI)
      document.addEventListener('keydown', (e) => {
        const MODE = { rtty: 'RTTY', jtty: 'JTTY', cw: 'CW' }[tab];
        if (!MODE || detached || e.ctrlKey || e.altKey || e.metaKey) return;
        const n = /^F(\d{1,2})$/.exec(e.key);
        if (!n) return;
        const m = macroList(MODE)[Number(n[1]) - 1];
        if (!m) return;
        e.preventDefault();
        useMacro(MODE, m.text, e.shiftKey);
      });
      $('dgTxRx').addEventListener('click', () => setTx(rxF));
      $('dgPar').value = store.get('ftxpar', 'auto');
      $('dgPar').addEventListener('change', () => { store.set('ftxpar', $('dgPar').value); ftxCfg(); });
      $('dgCall1st').checked = store.get('call1st', '1') === '1';
      $('dgCall1st').addEventListener('change', () => { store.set('call1st', $('dgCall1st').checked ? '1' : '0'); ftxCfg(); });
      $('dgStop').addEventListener('click', () => api && api.send({ t: 'ftx_stop' }));
      $('dgRxTx').addEventListener('click', () => setRx(txF));
      // Repli du panneau ou onglet du navigateur caché : le serveur arrête de décoder pour ce membre
      new MutationObserver(announce).observe($('centerPanel'), { attributes: true, attributeFilter: ['class'] });
      document.addEventListener('visibilitychange', announce);
      window.addEventListener('resize', () => { if (WF_TABS.indexOf(tab) >= 0) sizeCanvas(); });
      fillDial();
      setMode(mode);
      showTab(tab);
      setInterval(() => { if (!detached && tab === 'ftx') progBar(); }, 100);
      setInterval(() => {
        if (detached) return;
        if (tab === 'ftx' || tab === 'jt65') { clock(); status(); followBand(); }
        if (tab === 'rtty') { status(); rtHeads(); }
        if (tab === 'wspr') wsClock();
        if (tab === 'jtty') jtStatus();
        if (tab === 'cw') cwStatus();
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
      needHist = true;
      wsNeedHist = true;
      jtNeedHist = true;
      if (info && info.digiCall) myCall = info.digiCall;
      if (info) myGrid = info.stationGrid || '';
      if (info) myQth = info.stationQth || '';
      if (info && info.qo100If && typeof info.qo100If === 'object') qoIf = Object.assign({}, info.qo100If);
      refillQo();
      if (me && me.call) opCall = me.call;
      drawMsgs();
      if (info && info.stationCall) { baseCalls = String(info.stationCall).toUpperCase().split(/[\s/,]+/).filter(Boolean); stationCalls = Array.from(new Set(baseCalls.concat(myCall))); }
      announce(); // reprise après reconnexion
    },
    onMessage(m) {
      if (m.t === 'qrz_info') { qrzInfo(m); if (window.RSLOG && window.RSLOG.onQrz) window.RSLOG.onQrz(m); return true; }
      if (m.t === 'ftx_qso' && m.qso) { qsoPrompt(m.qso); return true; }
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
      if (m.t === 'jtty') { jtUpdate(m.u); return true; }
      if (m.t === 'cw') { cwAppend(m.text || ''); return true; }
      if (/^sstv_/.test(m.t)) return ssMessage(m);
      if (m.t === 'cw_lvl') { cwLevels(m); return true; }
      if (m.t === 'jtty_hist') { jtMsgs.clear(); for (const u of m.items || []) jtMsgs.set(u.key, u); jtRedraw(); return true; }
      if (m.t === 'rtty_lvl') { rttyLevels(m); return true; }
      if ((m.t === 'ftx_hist' || m.t === 'ftx') && m.mode === 'WSPR') {
        if (m.t === 'ftx_hist') {
          wsHist.length = 0;
          for (const it of m.items || []) wsHist.push({ slot: it.slot, list: it.list || [] });
          wsRedraw();
        } else {
          wsLast = m.slot;
          const it = { slot: m.slot, list: m.list || [] };
          wsHist.push(it);
          while (wsHist.length > 60) wsHist.shift();
          wsAdd(it);
        }
        return true;
      }
      if (m.t === 'ftx_hist') {
        // Historique à l'ouverture : on remplace ce qu'on a pour ce mode
        for (let i = hist.length - 1; i >= 0; i--) if (hist[i].mode === m.mode) hist.splice(i, 1);
        for (const it of m.items || []) hist.push({ slot: it.slot, mode: m.mode, list: it.list || [] });
        hist.sort((a, b) => a.slot - b.slot);
        if (m.mode === mode) redrawAll();
        return true;
      }
      if (m.t === 'ftx') {
        lastDecode = Date.now();
        const it = { slot: m.slot, mode: m.mode, list: m.list || [] };
        hist.push(it);
        while (hist.length > 240) hist.shift();
        if (m.mode === mode) addSlot(it, false);
        return true;
      }
      return false;
    },
    onBinary(bytes) {
      if (bytes[0] === 0x10 || bytes[0] === 0x13) { onRow(bytes); return true; }
      if (bytes[0] === 0x11) { ssLine(bytes); return true; }
      return false;
    },
    onState() {
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
      }
      // Suivre l'opérateur : bouton caché pour celui qui a la main, qui annonce son onglet
      const fb = $('dgFollow');
      const mine = !!(api && api.iControl());
      if (fb) fb.hidden = mine;
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
  if (POPUP) {
    let host = null;
    const toast = (msg, level) => {
      const el = $('dgToast');
      el.textContent = msg || '';
      el.className = 'dg-toast ' + (level || '');
      clearTimeout(toast.t);
      if (msg) toast.t = setTimeout(() => { el.textContent = ''; }, 6000);
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
