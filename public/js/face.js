/*
 * face.js — page « Face avant » (ex. https://remote.op0p.be/ftdx101) : la photo de la face avant du TRX, avec une zone
 * cliquable sur chaque touche et chaque bouton rotatif ; chaque touche fait la même chose que sur le TRX, par les mêmes
 * commandes que le dashboard (même serveur, mêmes droits, mêmes sécurités). L'écran du TRX est recouvert par un affichage
 * vivant : fréquences, modes, mètres, ANT / ATT / IPO / R.FIL / AGC, réglages DSP ; le spectre de l'écoute (prise PHONES)
 * remplace le scope, qui ne passe pas par la liaison CAT.
 *
 * Description de chaque face avant : faces/<modèle>.js (positions en pixels de la photo). ?zones=1 montre les zones.
 * Le dashboard (/) reste la page principale : cette page est une autre façon de piloter, à côté.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const MODEL = (location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || 'ftdx101').toLowerCase();
  const FACE = (window.RS_FACES || {})[MODEL];
  const R = (window.RIGS || {})[MODEL];
  const ZONES = /[?&]zones=1/.test(location.search);
  // Partie de la photo affichée (face avant seule) : les positions restent celles de la photo d'origine
  const V = FACE ? (FACE.img || { x: 0, y: 0, w: FACE.w, h: FACE.h }) : { x: 0, y: 0, w: 1, h: 1 };
  // TRX à un seul récepteur (FTDX10) : écran façon FTDX10 — un S-mètre, VFO-A en grand, VFO-B en petit, une rangée de cases,
  // le filtre à droite, le scope plus haut ; pas de MAIN / SUB, de DISP ni de MONO
  const SINGLE = !!(FACE && FACE.single);
  // FTX-1 : écran du TRX avec le SUB à gauche et le MAIN à droite (l'inverse du FTDX101)
  const SUBL = !!(FACE && FACE.subLeft);
  const rightSide = (sd) => (sd === 'B') !== SUBL; // ce côté (A = MAIN, B = SUB) est-il dans la moitié droite de l'écran ?
  // Positions verticales dans l'écran (unités de la photo depuis le haut de l'écran) : bandeau du scope, scope, rangée du bas
  const G = Object.assign(SINGLE ? { lowY: 139, scopeY: 152, scopeH: 163, botY: 320, botH: 40, expUp: 64 } : { lowY: 157, scopeY: 170, scopeH: 124, botY: 297, botH: 21, expUp: 34 }, (FACE && FACE.lay) || {});
  // TRX Icom (IC-7300) : filtres FIL1 / FIL2 / FIL3 et TWIN PBT au lieu de WIDTH / SHIFT / R.FIL
  const ICOM = !!(R && R.CONTROL && R.CONTROL.fil);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage bloqué */ } }
  };

  // ------------------------------------------------------------ état
  let ws = null, me = null, st = null, creds = null, retry = 0, lastMsg = 0;
  const pend = {};                       // réglage → { v, at } : affichage immédiat, avant la relecture du TRX
  const pendF = { A: null, B: null, atA: 0, atB: 0 };
  const sendTimers = {};
  const BANDS = [['160M', 1.8e6, 2.0e6], ['80M', 3.5e6, 4.0e6], ['60M', 5.25e6, 5.45e6], ['40M', 7.0e6, 7.3e6], ['30M', 10.1e6, 10.15e6],
    ['20M', 14.0e6, 14.35e6], ['17M', 18.068e6, 18.168e6], ['15M', 21.0e6, 21.45e6], ['12M', 24.89e6, 24.99e6], ['10M', 28.0e6, 29.7e6],
    ['6M', 50e6, 54e6], ['4M', 70e6, 70.5e6]];
  // Largeur par défaut du FTDX101 selon le mode (R.FIL 3 kHz) : voyant WIDTH éteint sur le TRX à cette largeur.
  // Relevé sur le TRX : 3000 Hz en SSB et en DATA ; CW, RTTY, PSK : à vérifier (3000 par défaut aussi).
  const WIDTH_DEF_HZ = { SSB: 3000, DATA: 3000, CW: 3000, RTTY: 3000, PSK: 3000 };
  function widthDefHz(md) {
    const k = /SB$/.test(md) ? 'SSB' : /^DATA/.test(md) ? 'DATA' : /^CW/.test(md) ? 'CW' : /^RTTY/.test(md) ? 'RTTY' : /^PSK/.test(md) ? 'PSK' : 'SSB';
    return WIDTH_DEF_HZ[k];
  }
  const L = {
    fast: store.get('rs.face.fast', '0') === '1',
    fine: store.get('rs.face.fine', '0') === '1',
    listening: false,
    bandOf(hz) { const b = BANDS.find((x) => hz >= x[1] && hz <= x[2]); return b ? b[0] : ''; },
    activeMode(s) { return (s.vfoSel === 1 ? s.modeB : s.mode) || ''; },
    /** VFO d'émission, lu sur le TRX (FT) : SPLIT envoie l'émission sur l'autre VFO que celui où elle était */
    txSide(s) { return s.txVfo != null ? (s.txVfo === 1 ? 'B' : 'A') : (s.split ? 'B' : 'A'); },
    /** WIDTH changé (voyant) : ni « 00 » (défaut) ni la largeur par défaut du mode (que le TRX renvoie telle quelle) */
    widthChanged(s, sfx) {
      const w = s['width' + (sfx || '')];
      if (!w || !R) return false;
      const md = (sfx ? s.modeB : s.mode) || '';
      const tab = R.widthTable(md) || [];
      return tab.length > 0 && tab[w - 1] !== widthDefHz(md);
    }
  };
  function S() {
    const s = Object.assign({}, (st && st.radio) || {});
    const now = Date.now();
    for (const k in pend) { if (now - pend[k].at < 1500) s[k] = pend[k].v; else delete pend[k]; }
    if (pendF.A != null && now - pendF.atA < 1500) s.freq = pendF.A;
    if (pendF.B != null && now - pendF.atB < 1500) s.freqB = pendF.B;
    return s;
  }
  const iControl = () => !!(st && me && st.controllerCid != null && st.controllerCid === me.cid);
  const otherTab = () => !!(st && me && st.controller === me.call && st.controllerCid !== me.cid);

  // ------------------------------------------------------------ messages
  let msgTimer = 0;
  function say(t, cls, ms) {
    const m = $('msg');
    m.textContent = t || '';
    m.className = 'fc-msg' + (cls ? ' ' + cls : '');
    if (t) { void m.offsetWidth; m.classList.add('blink'); } // jaune fluo clignotant 3 s
    clearTimeout(msgTimer);
    if (t && ms !== 0) msgTimer = setTimeout(() => { m.textContent = ''; m.className = 'fc-msg'; }, ms || 5000);
  }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  function needControl() {
    if (iControl()) return true;
    say(st && st.controller && !otherTab() ? st.controller + ' a la main : demandez-la, ou attendez qu’elle soit libre.' : 'Prenez d’abord la main (bouton en haut à droite).', 'warn');
    const b = $('ctrlBtn');
    b.classList.remove('fc-pulse'); void b.offsetWidth; b.classList.add('fc-pulse');
    return false;
  }

  // ------------------------------------------------------------ commandes vers le TRX
  // Mode d'émission : celui du VFO qui émet (SUB en SPLIT), pas forcément celui du récepteur affiché
  function txMode(s) { return (L.txSide(s) === 'B' ? s.modeB : s.mode) || ''; }
  // PROC : le TRX ne l'accepte qu'en phonie SSB / AM sur le VFO d'émission (sinon il répond « ?; »)
  function procRefused(s, id, v) {
    if ((id !== 'proc' && id !== 'procB') || !v) return false;
    const m = txMode(s);
    if (/^(LSB|USB|AM)/.test(m)) return false;
    say('PROC : seulement en SSB ou AM sur le VFO d’émission (' + (L.txSide(s) === 'B' ? 'SUB' : 'MAIN') + ' en ' + (m || '?') + ').', 'warn', 5000);
    return true;
  }
  function setCtl(id, v) {
    if (!needControl()) return;
    const c = R && R.CONTROL[id];
    if (!c) return say('Commande non disponible sur ce TRX.', 'warn');
    let val = v;
    try { val = R.validate(id, v, S()); } catch (e) { return say(e.message, 'warn'); }
    if ((c.viaSub && activeSide() === 'A') || (c.viaMain && activeSide() === 'B')) L.hop = { side: activeSide(), until: Date.now() + 6000 };
    if (c.type !== 'action') pend[id] = { v: val, at: Date.now() };
    clearTimeout(sendTimers[id]);
    sendTimers[id] = setTimeout(() => send({ t: 'set', ctl: id, value: val }), c.type === 'level' || c.type === 'width' ? 90 : 0);
    render();
  }
  function tuneTo(side, hz) {
    if (!needControl()) return;
    hz = Math.round(Math.max(R.FREQ_MIN || 30000, Math.min(R.FREQ_MAX || 75e6, hz)));
    if (side === 'B') { pendF.B = hz; pendF.atB = Date.now(); } else { pendF.A = hz; pendF.atA = Date.now(); }
    if (!sendTimers.freq) {
      sendTimers.freq = setTimeout(() => {
        sendTimers.freq = 0;
        const m = { t: 'set' };
        if (pendF.A != null && Date.now() - pendF.atA < 1500) m.freq = pendF.A;
        if (pendF.B != null && Date.now() - pendF.atB < 1500) m.freqB = pendF.B;
        send(m);
      }, 70);
    }
    render();
  }
  // FTX-1 : ATT / IPO de l'autre côté (viaSub / viaMain) — la page Station passe un instant sur l'autre côté puis revient :
  // pendant ce va-et-vient (L.hop), la page garde le côté actif d'avant (pas d'échange visible des VFO à l'écran)
  const activeSide = () => {
    const real = S().vfoSel === 1 ? 'B' : 'A', h = L.hop;
    if (h) {
      if (real !== h.side) h.seen = true; // parti sur l'autre côté…
      else if (h.seen) { L.hop = null; return real; } // … et revenu : fini
      if (Date.now() < h.until) return h.side;
      L.hop = null;
    }
    return real;
  };
  function setMode(name) {
    if (!needControl()) return;
    const code = Object.keys(R.MODES).find((k) => R.MODES[k] === name);
    if (!code) return say('Mode ' + name + ' non disponible.', 'warn');
    send({ t: 'set', mode: code, sub: activeSide() === 'B' });
  }
  const CYCLE = (FACE && FACE.cycle) || ['LSB', 'USB', 'CW-U', 'CW-L', 'AM', 'FM', 'DATA-U', 'DATA-L', 'RTTY-L', 'RTTY-U', 'PSK'];
  function doAct(k, long) {
    const a = k.act || {};
    const s = S();
    if (a.info) return say(a.info, '', 6000);
    if (a.hold) return; // touche à tenir (XFC) : appui et relâchement dans keyEvents
    if (a.local === 'autotune') return autoTune();
    if (a.pop) return popCtl(a.pop);
    if (a.local === 'listen') return L.listening ? stopListen() : startListen();
    // IC-7300 : pas de tableau de réglages façon Yaesu ; l'écran FUNCTION de l'Icom viendra (les niveaux se règlent par le menu MULTI, les fonctions par leurs touches)
    if (a.local === 'func' && ICOM) { L.func = !L.func; if (L.func) { L.icomMenu = L.quickMenu = false; L.icMem = L.icRec = L.icSet = false; } return render(); }
    if (a.local === 'func' && FTX1F) return ftxFuncPush();
    if (a.local === 'dspA' || a.local === 'dspB') return dspToggle(a.local.slice(3)); // FTX-1 : appui d'1 s sur MAIN / SUB AF/RF/SQL
    if (a.local === 'dspTab') return dspTab(1);
    // FTX-1 : pousser SUB DIAL = VFO actif MAIN ⇄ SUB, comme sur le TRX. Par sécurité (VS1 a mis le FTX-1 en émission le 25/10),
    // seulement en double réception ; le serveur garde ses propres refus
    if (a.local === 'sideToggle') {
      if (!needControl()) return;
      if (S().dualRx !== 1 && !(me && me.subSingle)) return say('MAIN ⇄ SUB : seulement en double réception (un VFO au-delà de 118 MHz). En HF, le FTX-1 n’écoute qu’un côté : pour écouter la fréquence du VFO B, utilisez A ⇄ B (appui long sur SPLIT ou A ⇄ B du dashboard). Un administrateur peut l’autoriser (réglage ftx1SubSingle), après un essai sur charge fictive.', 'warn', 9000);
      return setCtl('vfoSel', activeSide() === 'B' ? 0 : 1);
    }
    if (a.local === 'funcLong') return ftxFuncToggle(); // FTX-1 : appui de 2 s sur FUNC = écran FUNC / sortie
    if (a.local === 'func') { viewTouched(); if (MV.open) closeMenu(); L.func = !L.func; return render(); }
    if (a.local === 'bandMenu') return L.bandMenu ? closeBandMenu() : openBandMenu();
    // FTX-1 : appui bref sur MAG BAND = bande suivante (1.8 → 3.5 → 7 → 10 → 14 → 18 … → 430 → 1.8), comme sur le TRX
    if (a.local === 'bandUp') {
      const seq = ((FACE && FACE.bandGrid) || []).filter((b) => b[0] && b[0] !== '60M');
      if (!seq.length) return;
      const f = activeSide() === 'B' ? s.freqB : s.freq;
      const cur = f ? BANDS.concat([['2M', 144e6, 146e6], ['70CM', 430e6, 440e6]]).find((x) => f >= x[1] && f <= x[2]) : null;
      const i = cur ? seq.findIndex((b) => b[0] === cur[0]) : -1;
      const nb = seq[(i + 1) % seq.length];
      say('BAND : ' + nb[1] + ' MHz (appui d’1 s : tableau des bandes)', '', 2500);
      return bandTo(nb[0], nb[2], nb[3]);
    }
    if (a.local === 'modeMenu') return L.modeMenu ? closeModeMenu() : openModeMenu();
    if (a.local === 'icomMenu' || a.local === 'quickMenu') return L[a.local] ? closeGrid(a.local) : openGrid(a.local);
    if (a.local === 'multiMenu') { L.multiMenu = !L.multiMenu; L.multiAt = Date.now(); if (L.multiMenu && multiItems(s).indexOf(L.funcSel) < 0) L.funcSel = 'power'; return render(); }
    if (a.local === 'expand') return toggleExpand();
    if (a.local === 'scopeMeter') return setIcBig(!L.icBig); // M.SCOPE : grand écran des mesures ⇄ écran par défaut
    if (a.local === 'notchCycle') return needControl() && notchCycle(s);
    // VOX/BK-IN de l'IC-7300 : en CW le BK-IN (OFF → SEMI → FULL) reste libre ; le VOX ne peut être que coupé à distance
    if (a.local === 'voxBk') {
      if (!needControl()) return;
      if (/^CW/.test(L.activeMode(s) || '') && R.CONTROL.bkin) return setCtl('bkin', ((s.bkin || 0) + 1) % 3);
      if (s.vox) return setCtl('vox', 0);
      return say('VOX : à distance, il ne peut pas être mis en service (seulement coupé) ; le BK-IN se règle en CW.', 'warn', 5000);
    }
    if (a.local === 'exit' && L.icSet && L.icSub) { subBack(); return render(); } // EXIT : un niveau plus haut
    if (a.local === 'exit' && (L.icMem || L.icRec || L.icSet)) { L.icMem = false; L.icRec = false; L.icSet = false; return render(); }
    if (a.local === 'mpadWrite') return mpadWrite();
    if (a.local === 'exit' && L.icView && !L.icomMenu && !L.quickMenu && !L.modeMenu && !L.bandMenu && !L.multiMenu) { L.icView = null; WF.drawn = false; return render(); }
    if (a.local === 'exit') {
      // BACK (comme sur le TRX) : ferme tout ce qui est affiché par-dessus l'écran normal — écran FUNC, écran DSP, tableaux
      // METER / BAND / MODE / SPEED, MULTI, menus, et la petite fenêtre de réglage (RF POWER…)
      if (L.bandMenu) closeBandMenu(); if (L.modeMenu) closeModeMenu();
      for (const k of ['icomMenu', 'quickMenu']) if (L[k]) closeGrid(k);
      L.multiMenu = false; L.func = false; L.fEdit = false; L.dsp = null; L.mSel = null;
      clearTimeout(L.fpopT);
      for (const id of ['lcdPop', 'fcSpeed']) { const e = $(id); if (e) e.hidden = true; }
      if (typeof MV !== 'undefined' && MV.open) closeMenu();
      if (typeof DT !== 'undefined' && DT.open) dtmfClose();
      return render();
    }
    if (a.local === 'bandUp' || a.local === 'bandDown') {
      // Bande suivante / précédente (IC-7300 : touches ▲ ▼)
      const list = BAND_GRID.filter((b) => b[2] * 1000 <= (R.FREQ_MAX || 75e6));
      const cur = list.findIndex((b) => b[0] === L.bandOf(activeSide() === 'B' ? s.freqB : s.freq));
      const i = cur < 0 ? 0 : (cur + (a.local === 'bandUp' ? 1 : list.length - 1)) % list.length;
      return bandTo(list[i][0], list[i][2], list[i][3]);
    }
    // TWIN PBT : pousser le bouton (CLR) = PBT intérieur et extérieur au milieu
    if (a.local === 'pbtClr') { if (!needControl()) return; setCtl('pbtIn', 128); setCtl('pbtOut', 128); if (ICOM) { L.pbtPopAt = Date.now(); L.pbtClrAt = Date.now(); render(); } return; }
    // Réglage à choix : valeur suivante (IC-7300 : P.AMP OFF → AMP1 → AMP2)
    if (a.cycle) { const c = R.CONTROL[a.cycle]; if (!c || !c.options) return; const i = c.options.findIndex((o) => o[0] === s[a.cycle]); return setCtl(a.cycle, c.options[(i + 1) % c.options.length][0]); }
    // CONT/APF (FTDX10) : en CW, l'APF ; sinon le CONTOUR
    if (a.contApf) { const id = /^CW/.test(s.mode || '') && R.CONTROL.apf ? 'apf' : 'contour'; return setCtl(id, s[id] ? 0 : 1); }
    if (a.local === 'vc') {
      // VC TUNE (présélecteur) du récepteur actif ; en marche, MULTI l'accorde
      const id = activeSide() === 'B' ? 'vcB' : 'vc';
      if (!R.CONTROL[id]) return say('VC TUNE : pas disponible sur ce TRX.', 'warn');
      if (!needControl()) return;
      const sk = id === 'vcB' ? 'vcOkB' : 'vcOk';
      if (s[sk] === 0) return say('VC TUNE : pas installé sur ce TRX (le TRX répond « non installé »).', 'warn', 5000);
      const on = s[id] ? 0 : 1;
      setCtl(id, on);
      say('VC TUNE ' + (id === 'vcB' ? 'SUB' : 'MAIN') + (on ? ' en marche (grande touche VC TUNE : l’accorder avec la bague du grand bouton).' : ' arrêté.'), '', 4000);
      return;
    }
    if (a.local === 'ringVc') {
      // Grande touche VC TUNE : la bague extérieure du grand bouton accorde le présélecteur (indépendant de sa mise en marche).
      // Sur le TRX (SF0 : fonction de la bague MPVD) : 2 = VC TUNE ; arrêt = retour à la bague SUB (3)
      if (R.CONTROL.mpvd && s.mpvd != null) {
        if (!needControl()) return;
        const on = s.mpvd !== 2;
        L.ringVc = on;
        setCtl('mpvd', on ? 2 : 3);
      } else L.ringVc = !L.ringVc;
      say(L.ringVc ? 'Bague du grand bouton : VC TUNE' + (s[activeSide() === 'B' ? 'vcB' : 'vc'] ? '.' : ' (mettez d’abord le VC TUNE en marche : petite touche VC TUNE).') : 'Bague du grand bouton : fréquence.', '', 4000);
      return render();
    }
    // FTX-1 : appui de plus d'1 s sur SPLIT = SPLIT inversé (écoute sur la fréquence d'émission, émission sur celle d'écoute) :
    // les deux VFO sont échangés (A ⇄ B) et le SPLIT reste en service
    if (a.local === 'splitRev') {
      if (!needControl()) return;
      if (S().tx) return say('SPLIT inversé : pas pendant une émission.', 'warn', 2500);
      if (!S().split) doAct({ act: { local: 'split' } });
      setCtl('swap', null);
      return say('SPLIT inversé : VFO échangés (A ⇄ B).', '', 3000);
    }
    // FTX-1 : appui de plus d'1 s sur SPLIT = comme sur le TRX : l'autre VFO reçoit la fréquence (et le mode) du VFO actif
    // (A → B ou B → A), puis SPLIT : on émet sur l'autre VFO (▼ rouge, il ne bouge plus) et le grand bouton déplace
    // l'écoute (▼ vert, fréquence en orange) pour aller chercher la station
    if (a.local === 'splitQuick') {
      if (!needControl()) return;
      if (S().tx) return say('SPLIT : pas pendant une émission.', 'warn', 2500);
      const sd = activeSide();
      setCtl(sd === 'B' ? 'bToA' : 'aToB', null);
      if (!S().split) doAct({ act: { local: 'split' } });
      return say('SPLIT : émission sur ' + (sd === 'B' ? 'VFO-A (MAIN)' : 'VFO-B (SUB)') + ' à la même fréquence ; le grand bouton déplace l’écoute (▼ vert).', '', 4500);
    }
    if (a.local === 'split') {
      // SPLIT en marche (ST1) : l'émission doit passer sur le VFO NON sélectionné (MAIN sélectionné → TX B ; SUB sélectionné → TX A).
      // SPLIT arrêté (ST0) : l'émission doit revenir sur le VFO sélectionné.
      // Le TRX ne le fait pas toujours lui-même : on relit l'état ~1,2 s plus tard et, seulement si le TX
      // n'est pas au bon endroit (et le SPLIT bien dans l'état voulu), on envoie FT.
      if (!needControl()) return;
      const on = s.split ? 0 : 1;
      setCtl('split', on);
      if (R.CONTROL.txVfo) setTimeout(() => {
        const s2 = S(), sel = s2.vfoSel === 1 ? 'B' : 'A', want = on ? (sel === 'B' ? 'A' : 'B') : sel;
        const st1 = s2.stSplit != null ? s2.stSplit : s2.split; // SPLIT relu brut (ST), avant correction d'affichage
        if (!!st1 === !!on && L.txSide(s2) !== want) setCtl('txVfo', want === 'B' ? 1 : 0);
      }, 1200);
      return;
    }
    if (a.local === 'smenu') return L.smenu ? closeSmenu() : openSmenu();
    if (a.local === 'disp' && FACE.meterFtx) {
      // FTX-1 : comme la touche DISP du TRX — écran normal → un VFO + scope → MAIN et SUB l'un sur l'autre (sans scope) →
      // filtres agrandis (au lieu de l'écran éteint du TRX) → retour
      viewTouched();
      L.fdisp = ((L.fdisp || 0) + 1) % 4;
      store.set('rs.face.fdisp', String(L.fdisp));
      L.disp = L.fdisp === 3 ? 3 : 0;
      WF.drawn = false;
      say('DISP : ' + ['écran normal', 'un VFO (celui qui est sélectionné) et le scope', 'MAIN et SUB l’un sur l’autre, sans scope', 'filtres agrandis (MAIN | SUB)'][L.fdisp], '', 3000);
      return render();
    }
    if (a.local === 'disp') {
      // Comme la touche DISP du TRX : 4 présentations de l'écran, l'une après l'autre
      viewTouched();
      L.disp = (L.disp + 1) % DISPS.length;
      store.set('rs.face.disp', String(L.disp));
      WF.drawn = false;
      say('DISP : ' + DISPS[L.disp] + ((L.disp === 1 || L.disp === 2) && !WF.two ? ' (SUB : bouton 🎧 Stéréo MAIN | SUB)' : ''), '', 3000);
      return render();
    }
    if (a.local === 'sync') {
      if (L.sync) { L.sync = false; say('SYNC coupé.', '', 2500); return render(); }
      if (!needControl()) return;
      const side = activeSide(), hz = side === 'B' ? s.freqB : s.freq;
      if (hz == null) return;
      tuneTo(side === 'B' ? 'A' : 'B', hz);
      L.sync = true;
      say('SYNC : les deux VFO sur ' + fmtFreq(hz) + ' ; le grand bouton les accorde ensemble.', '', 4000);
      return render();
    }
    if (a.local === 'mox') return L.mox ? pttUp() : (pttDown() ? (L.mox = true, render()) : null);
    if (a.local === 'moni') {
      const VX = window.RSVOICE;
      if (!VX || !VX.micOn()) return say('MONI = « M’écouter » : activez d’abord votre micro (Configuration micro, à droite de la face avant).', 'warn', 5000);
      VX.monitor(!VX.monitorOn());
      say(VX.monitorOn() ? 'MONI : vous entendez votre micro tel qu’il part (au casque).' : 'MONI coupé.', '', 3000);
      return render();
    }
    // LOCK : verrouille le grand bouton du côté sélectionné (MAIN ou SUB), comme sur le TRX
    if (a.local === 'lock') {
      if (!(me && me.admin)) return say('LOCK : réservé aux administrateurs.', 'warn', 4000);
      const id = activeSide() === 'B' && R && R.CONTROL.lockB ? 'lockB' : 'lock';
      if (!R || !R.CONTROL[id]) return say('LOCK : non disponible sur ce TRX.', 'warn');
      setCtl(id, S()[id] ? 0 : 1);
      return render();
    }
    // FAST : commute aussi la touche FAST du TRX (FTDX101 : FS, côté sélectionné, MAIN ou SUB) ; le voyant suit l'état relu sur le TRX
    if (a.local === 'fast' && R && R.CONTROL.fastStep) {
      if (!needControl()) return;
      const fs = S().fastStep;
      const on = (fs != null ? fs : L.fast) ? 0 : 1; // TRX qui ne répond pas à la lecture : état de la page
      setCtl('fastStep', on);
      L.fast = !!on; if (on) L.fine = false;
      store.set('rs.face.fast', L.fast ? '1' : '0'); store.set('rs.face.fine', L.fine ? '1' : '0');
      say(on ? 'FAST (TRX) : accord rapide.' : 'FAST coupé : accord normal.', '', 2500);
      return render();
    }
    if (a.local === 'fast' || a.local === 'fine') {
      L[a.local] = !L[a.local];
      if (a.local === 'fine' && L.fine) L.fast = false;
      if (a.local === 'fast' && L.fast) L.fine = false;
      store.set('rs.face.fast', L.fast ? '1' : '0');
      store.set('rs.face.fine', L.fine ? '1' : '0');
      say(L.fine ? 'Accord fin : 1 Hz par cran.' : L.fast ? 'Accord rapide : 1 kHz par cran.' : 'Accord normal : 100 Hz par cran.', '', 2500);
      // FTDX10 : la touche FINE du TRX suit aussi (FN), avec la main
      if (a.local === 'fine' && R && R.CONTROL.fineTrx && iControl() && !!S().fineTrx !== L.fine) setCtl('fineTrx', L.fine ? 1 : 0);
      // FTX-1 : FINE / FAST du TRX (FN 0 / 1 / 2), avec la main
      if (R && R.CONTROL.tuneStep && iControl()) { const v = L.fine ? 1 : L.fast ? 2 : 0; if (S().tuneStep !== v) setCtl('tuneStep', v); L.tsSeen = v; }
      return render();
    }
    if (a.band) {
      if (!needControl()) return;
      if (!R.cmdBand) { const b = BAND_GRID.find((x) => x[0] === a.band); return b ? bandTo(b[0], b[2], b[3]) : null; }
      return send({ t: 'set', band: a.band, sub: activeSide() === 'B' });
    }
    if (a.mode) {
      const cur = L.activeMode(s);
      const hz = activeSide() === 'B' ? s.freqB : s.freq;
      if (a.mode === 'ssb') return setMode(cur === 'LSB' ? 'USB' : cur === 'USB' ? 'LSB' : (hz && hz < 10e6 ? 'LSB' : 'USB'));
      if (a.mode === 'cw') {
        // Passage en CW : BK-IN mis en service d'office (la touche BK-IN reste libre ensuite ; CW-U ⇄ CW-L n'y touche pas)
        const enter = !/^CW/.test(cur || '');
        setMode(cur === 'CW-U' ? 'CW-L' : 'CW-U');
        if (enter && R.CONTROL.bkin) setTimeout(() => { if (!S().bkin) setCtl('bkin', 1); }, 400);
        return;
      }
      const i = CYCLE.indexOf(cur);
      return setMode(CYCLE[(i + 1) % CYCLE.length]);
    }
    if (a.toggle) { const v = s[a.toggle] ? 0 : 1; if (procRefused(s, a.toggle, v)) return; return setCtl(a.toggle, v); }
    // FTX-1 : touche N/W (MODE) : appui bref = NARROW ⇄ WIDE sur le récepteur actif (appui d'1 s : tableau des modes)
    if (a.toggleSide) {
      const k = a.toggleSide + (activeSide() === 'B' ? 'B' : '');
      if (!R.CONTROL[k]) return say('NARROW : pas disponible sur ce récepteur.', 'warn', 3000);
      const v = s[k] ? 0 : 1;
      say((activeSide() === 'B' ? 'SUB' : 'MAIN') + ' : ' + (v ? 'NARROW' : 'WIDE'), '', 2000);
      return setCtl(k, v);
    }
    if (a.set) return setCtl(a.set[0], a.set[1]);
    if (a.action) {
      if (a.action === 'tune' && !confirm('TUNE : le TRX émet quelques secondes pour accorder l’antenne. Continuer ?')) return;
      return setCtl(a.action, null);
    }
    if (a.toggleSel) return setCtl('vfoSel', s.vfoSel === 1 ? 0 : 1);
    if (a.clar && FACE.clarCycle) {
      // FTX-1 : CLAR RX → CLAR TX → CLAR RXTX → arrêt, sur le récepteur sélectionné ; appui long : décalage à zéro
      const B = activeSide() === 'B';
      if (long) return setCtl(B ? 'clarClrB' : 'clarClr', null);
      const read = (B ? s.ritB : s.rit) ? (B ? s.xitB : s.xit) ? 3 : 1 : (B ? s.xitB : s.xit) ? 2 : 0;
      // Appuis rapprochés : on part du dernier choix envoyé tant que le TRX ne l'a pas encore relu
      const pd = L.clarPend, cur = pd && pd.B === B && Date.now() - pd.at < 3000 && pd.v !== read ? pd.v : read;
      const nx = (cur + 1) % 4;
      L.clarPend = { B, v: nx, at: Date.now() };
      setCtl(B ? 'clarModeB' : 'clarMode', nx);
      // Affichage tout de suite (CLAR RX / TX / RXTX, bandes rouges), sans attendre la relecture du TRX
      const now = Date.now();
      pend[B ? 'ritB' : 'rit'] = { v: nx & 1, at: now }; pend[B ? 'xitB' : 'xit'] = { v: (nx >> 1) & 1, at: now };
      render();
      return say(nx ? 'CLAR ' + ['', 'RX', 'TX', 'RXTX'][nx] : 'CLAR arrêté', '', 2000);
    }
    if (a.clar) {
      if (long) return setCtl('clarClr', null);
      // Grande touche CLAR : clarifier RX ; sur le TRX la bague du grand bouton passe sur CLAR (SF01), et revient à SUB à l'arrêt
      const on = s.rit ? 0 : 1;
      setCtl('rit', on);
      if (R.CONTROL.mpvd && s.mpvd != null) {
        if (on && s.mpvd !== 1) setCtl('mpvd', 1);
        else if (!on && !s.xit && s.mpvd === 1) setCtl('mpvd', 3);
      }
      return;
    }
  }

  // ------------------------------------------------------------ dessin (SVG)
  const svg = $('face');
  if (FACE && FACE.model) { svg.dataset.model = FACE.model; document.documentElement.dataset.face = FACE.model; } // + menus HTML (SPAN…) // réglages d'affichage propres à un TRX (face.css)
  function el(tag, attrs, parent, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  const LCD = {};
  const ledEls = [];   // { el, on(s,L), bright? }
  const keyEls = {};
  function build() {
    svg.setAttribute('viewBox', V.x + ' ' + V.y + ' ' + V.w + ' ' + V.h);
    svg.textContent = '';
    if (ZONES) svg.classList.add('zones');
    const defs = el('defs', {}, svg);
    const glow = el('filter', { id: 'glow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    el('feGaussianBlur', { stdDeviation: '2.2', result: 'b' }, glow);
    const mg = el('feMerge', {}, glow);
    el('feMergeNode', { in: 'b' }, mg);
    el('feMergeNode', { in: 'SourceGraphic' }, mg);
    // FTX-1 : intérieur gris du filtre (bande passante), comme sur l'écran du TRX
    const fg = el('linearGradient', { id: 'ftxFlt', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    el('stop', { offset: '0', 'stop-color': '#5d6564' }, fg);
    el('stop', { offset: '1', 'stop-color': '#262b2c' }, fg);
    const lg = el('linearGradient', { id: 'lcdbg', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    el('stop', { offset: '0', 'stop-color': '#0c1220' }, lg);
    el('stop', { offset: '1', 'stop-color': '#04060b' }, lg);
    el('image', { href: FACE.image, x: V.x, y: V.y, width: V.w, height: V.h }, svg);
    buildLcd();
    // Boutons rotatifs (sous les touches : une touche posée sur le bord du grand bouton reste cliquable)
    for (const k of FACE.knobs || []) {
      const g = el('g', { class: 'kn' + (k.dial ? ' dial' : '') + (k.ri ? '' : ' single'), 'data-knob': k.id }, svg);
      el('circle', { cx: k.cx, cy: k.cy, r: k.ro, class: 'kn-o' }, g);
      // Bouton du centre : sur la photo, prise de biais, son capuchon est un peu décalé du centre de la bague (k.ix, k.iy)
      if (k.ri) {
        // Survol : la partie sous la souris s'éclaire (centre en orange, bague en bleu) avec son nom
        const ix = k.cx + (k.ix || 0), iy = k.cy + (k.iy || 0);
        const ring = 'M' + (k.cx - k.ro) + ' ' + k.cy + 'a' + k.ro + ' ' + k.ro + ' 0 1 0 ' + 2 * k.ro + ' 0a' + k.ro + ' ' + k.ro + ' 0 1 0 ' + -2 * k.ro + ' 0Z'
          + 'M' + (ix - k.ri) + ' ' + iy + 'a' + k.ri + ' ' + k.ri + ' 0 1 1 ' + 2 * k.ri + ' 0a' + k.ri + ' ' + k.ri + ' 0 1 1 ' + -2 * k.ri + ' 0Z';
        el('path', { d: ring, class: 'kn-ring', 'fill-rule': 'evenodd' }, g);
        el('circle', { cx: ix, cy: iy, r: k.ri, class: 'kn-i' }, g);
      }
      el('title', {}, g, (k.tip || [k.inner && k.inner.label, k.outer && k.outer.label].filter(Boolean).join(' (centre) · ') + ' (bague) — molette ou glisser')
        + (k.longReset ? (k.longReset[0] === 'n' ? ' ; appui d’au moins 1 s sur le centre : NOTCH, CONT et APF par défaut et arrêtés' : ' ; appui d’au moins 1 s sur le centre : SHIFT à 0 et WIDTH par défaut') : ''));
      knobEvents(g, k);
    }
    // Voyants des touches (sous les zones cliquables)
    const leds = el('g', { class: 'leds' }, svg);
    // FACE.leds : voyants qui ne sont pas sur une touche (bandeau du haut du FTDX10 : TX, VFO-A, VFO-B, FINE, STEP)
    for (const k of FACE.keys.concat((FACE.knobs || []).filter((x) => x.leds), FACE.leds ? [{ id: 'leds', leds: FACE.leds }] : [])) {
      if (k.led && k.lit) {
        // Touche éclairée comme sur le TRX (MAIN blanc, SUB bleu) : forme de la touche, fond plein et son nom
        const e = el('g', { class: 'lit' }, leds);
        el('path', { d: k.lit.d, fill: k.lit.bg, stroke: k.lit.edge || 'none', 'stroke-width': 1, 'stroke-linejoin': 'round' }, e);
        el('text', { x: k.lit.tx, y: k.lit.ty, fill: k.lit.fg, class: 'lit-t', 'text-anchor': 'middle' }, e, k.lit.label);
        ledEls.push({ el: e, on: k.led });
      } else if (k.led) {
        const e = k.r != null
          ? el('circle', { cx: k.cx, cy: k.cy, r: k.ledR || k.r + (k.ring ? 4 : 1), class: 'led' + (k.ring ? ' ring' : '') + (k.ledStrong ? ' strong' : ''), style: '--c:' + (k.ledColor || '#ffb020') }, leds)
          : el('rect', { x: k.x + 2, y: k.y + 2, width: k.w - 4, height: k.h - 4, rx: 4, class: 'led', style: '--c:' + (k.ledColor || '#ffb020') }, leds);
        ledEls.push({ el: e, on: k.led });
      }
      for (const d of k.leds || []) {
        const e = d.path ? el('path', { d: d.path, class: 'led bar shape' + (d.cls ? ' ' + d.cls : ''), style: '--c:' + d.color }, leds)
          : el('rect', { x: d.x, y: d.y, width: d.w, height: d.h, rx: d.rx != null ? d.rx : 1.5, class: 'led bar', style: '--c:' + d.color }, leds);
        ledEls.push({ el: e, on: d.on, bright: d.bright });
      }
    }
    // Zones cliquables
    const hs = el('g', { class: 'hss' }, svg);
    for (const k of FACE.keys) {
      const e = k.r != null ? el('circle', { cx: k.cx, cy: k.cy, r: k.r, class: 'hs' }, hs)
        : el('rect', { x: k.x, y: k.y, width: k.w, height: k.h, rx: 4, class: 'hs' + (k.act && k.act.info ? ' off' : '') }, hs);
      el('title', {}, e, k.tip || k.id);
      keyEls[k.id] = e;
      keyEvents(e, k);
    }
    if (ZONES) {
      svg.addEventListener('pointermove', (e) => {
        const p = toImg(e);
        $('zoneInfo').textContent = ' · Zones : x ' + Math.round(p.x) + ', y ' + Math.round(p.y);
      });
    }
    // Spectre de l'écoute : à la place du scope du TRX
    const sc = FACE.lcd;
    const box = { x: sc.x + 5, y: sc.y + G.scopeY, w: sc.w - 10, h: G.scopeH };
    const cv = $('scope');
    cv.style.left = ((box.x - V.x) / V.w * 100) + '%';
    cv.style.top = ((box.y - V.y) / V.h * 100) + '%';
    cv.style.width = (box.w / V.w * 100) + '%';
    cv.style.height = (box.h / V.h * 100) + '%';
    LCD.scopeBox = box;
    // EXPAND : le scope monte de « up » unités et s'agrandit d'autant (cascade, S.MENU et cadre de réglage suivent)
    // h2 (IC-7300, écran des mesures) : scope réduit à une bande de h2 unités en haut, les mesures dessous
    LCD.placeScope = (up, h2) => {
      const y = box.y - up, h = h2 || box.h + up;
      LCD.scopeMode = h2 ? 'S' + h2 : 'N' + up;
      cv.style.top = ((y - V.y) / V.h * 100) + '%';
      cv.style.height = (h / V.h * 100) + '%';
      const smE = $('smenu'), popE = $('lcdPop');
      if (smE) smE.style.top = ((y + 4 - V.y) / V.h * 100) + '%';
      if (popE) popE.style.top = ((y + 6 - V.y) / V.h * 100) + '%';
      WF.drawn = false;
    };
    // S.MENU : SCOPE MENU posé sur le haut du scope (en HTML, au-dessus de la cascade, qui reste visible)
    const sm = document.createElement('div');
    sm.className = 'fc-smenu';
    sm.id = 'smenu';
    sm.hidden = true;
    sm.style.left = ((box.x + 22 - V.x) / V.w * 100) + '%';
    sm.style.top = ((box.y + 4 - V.y) / V.h * 100) + '%';
    sm.style.width = ((box.w - 44) / V.w * 100) + '%';
    sm.innerHTML = '<div class="fc-sm-t">SCOPE MENU</div><div class="fc-sm-row">' + SMENU.map((m) => '<button type="button" data-sm="' + m[0] + '" title="' + m[3] + '"><b>' + m[1] + '</b><i></i></button>').join('') + '</div>';
    $('facePanel').appendChild(sm);
    // Cadre « SHIFT −1200Hz », « WIDTH 4000Hz »… posé sur le scope pendant un réglage, comme sur l'écran du TRX
    const pop = document.createElement('div');
    pop.className = 'fc-lcdpop';
    pop.id = 'lcdPop';
    pop.hidden = true;
    pop.style.left = ((box.x + 40 - V.x) / V.w * 100) + '%';
    pop.style.top = ((box.y + 6 - V.y) / V.h * 100) + '%';
    pop.style.width = ((box.w * 0.74) / V.w * 100) + '%';
    pop.style.height = ((box.h * 0.36) / V.h * 100) + '%';
    pop.innerHTML = '<button type="button" class="fc-lp-b" data-d="-1" title="Diminuer (ou molette sur le cadre)">−</button><span class="fc-lp-l"></span>'
      + '<svg class="fc-lp-v" preserveAspectRatio="xMaxYMid meet"><path></path><text></text></svg>'
      + '<button type="button" class="fc-lp-b" data-d="1" title="Augmenter (ou molette sur le cadre)">+</button>';
    $('facePanel').appendChild(pop);
    // IC-7300 : cadre « P.AMP 1 », « ATT 20dB »… au milieu de l'écran quand un réglage change (sur la page ou au TRX), comme sur le TRX
    if (ICOM) {
      const ip = document.createElement('div');
      ip.className = 'fc-icpop';
      ip.id = 'icPop';
      ip.hidden = true;
      const pw = 120, ph = 62, px = box.x + box.w / 2 - pw / 2, py = box.y + 34;
      ip.style.left = ((px - V.x) / V.w * 100) + '%';
      ip.style.top = ((py - V.y) / V.h * 100) + '%';
      ip.style.width = (pw / V.w * 100) + '%';
      ip.style.height = (ph / V.h * 100) + '%';
      ip.innerHTML = '<b></b><span></span>';
      $('facePanel').appendChild(ip);
      // Cadre de la bande passante (TWIN PBT tourné ou poussé, comme sur le TRX) : BW, SFT et le dessin du filtre
      const bp = document.createElement('div');
      bp.className = 'fc-icpbt';
      bp.id = 'icPbt';
      bp.hidden = true;
      const bw = 250, bh = 90, bx = box.x + box.w / 2 - bw / 2, by = box.y + 2; // sur le haut du scope, comme sur le TRX
      bp.style.left = ((bx - V.x) / V.w * 100) + '%';
      bp.style.top = ((by - V.y) / V.h * 100) + '%';
      bp.style.width = (bw / V.w * 100) + '%';
      bp.style.height = (bh / V.h * 100) + '%';
      bp.innerHTML = '<svg viewBox="0 0 250 90" preserveAspectRatio="none"><rect x="1" y="1" width="248" height="88" class="pb-bg"/>' +
        '<rect x="10" y="7" width="96" height="21" class="pb-box"/><text x="16" y="23" class="pb-t" data-k="bw"></text>' +
        '<rect x="114" y="7" width="126" height="21" class="pb-box"/><text x="120" y="23" class="pb-t">SFT</text><text x="232" y="23" class="pb-t" text-anchor="end" data-k="sft"></text>' +
        '<path class="pb-f1" data-k="f1"/><path class="pb-f2" data-k="f2"/><path class="pb-flt" data-k="flt"/><line x1="12" y1="70" x2="238" y2="70" class="pb-base"/><line class="pb-c" data-k="cl"/>' +
        '<text y="85" class="pb-l lo" text-anchor="middle" data-k="lo"></text><text y="85" class="pb-l" text-anchor="middle" data-k="c"></text><text y="85" class="pb-l lo" text-anchor="middle" data-k="hi"></text></svg>';
      $('facePanel').appendChild(bp);
    }
    // Le cadre se règle aussi à la souris : − / +, molette ; il reste affiché tant que la souris est dessus
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-d]');
      if (b && popTarget) popAdjust(Number(b.dataset.d), e);
    });
    pop.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (popTarget && Math.abs(e.deltaY) > 0) popAdjust(e.deltaY < 0 ? 1 : -1, e);
    }, { passive: false });
    pop.addEventListener('pointerenter', () => { popHover = true; clearTimeout(popT); });
    pop.addEventListener('pointerleave', () => { popHover = false; clearTimeout(popT); popT = setTimeout(() => { pop.hidden = true; }, 2000); });
    sm.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sm]');
      if (!b) return;
      const r = b.getBoundingClientRect();
      if (b.dataset.sm === 'color') { closeSmenu(); return openColors(); }
      smAdjust(b.dataset.sm, b.dataset.sm === 'level' && e.clientX < r.left + r.width / 2 ? -1 : 1);
    });
    sm.addEventListener('wheel', (e) => {
      const b = e.target.closest('[data-sm]');
      if (!b) return;
      e.preventDefault();
      smAdjust(b.dataset.sm, e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    sm.addEventListener('pointerenter', () => { L.smHover = true; clearTimeout(L.smT); });
    sm.addEventListener('pointerleave', () => { L.smHover = false; smArm(); });
  }
  // SCOPE MENU (touche S.MENU) : comme sur le TRX, il se ferme seul 3 s après la dernière action
  const PEAKS = ['OFF', 'LV1', 'LV2', 'LV3', 'LV4', 'LV5'];
  const SMENU = [['spd', 'SPEED', () => WF_SPEEDS[L.wfSpeed][0], 'Vitesse de la cascade (clic : suivante ; molette)'],
    ['peak', 'PEAK', () => PEAKS[L.peak], 'Crêtes du spectre gardées un moment : OFF, LV1 (longtemps) … LV5 (brièvement)'],
    ['marker', 'MARKER', () => (L.marker ? 'ON' : 'OFF'), 'Bande passante du filtre et repère central sur le spectre'],
    ['color', 'COLOR', () => String(L.wfColor), 'Couleurs de la cascade : 18 couleurs comme le TRX (clic : le tableau des couleurs ; molette ou bouton MULTI : couleur suivante)'],
    ['level', 'LEVEL', () => (L.wfLevel >= 0 ? '+' : '') + L.wfLevel.toFixed(1) + 'dB', 'Niveau de la cascade : clic à gauche −, à droite + (ou molette)']];
  L.peak = Math.max(0, Math.min(5, Number(store.get('rs.face.peak', '0')) || 0));
  L.marker = store.get('rs.face.marker', '1') !== '0';
  function smAdjust(id, d) {
    if (id === 'spd') { L.wfSpeed = (L.wfSpeed + (d > 0 ? 1 : 4)) % 5; store.set('rs.face.wfspd5', L.wfSpeed); ssSend('Spd'); }
    else if (id === 'peak') { L.peak = (L.peak + (d > 0 ? 1 : 5)) % 6; store.set('rs.face.peak', L.peak); WF.peak = {}; ssSend('Peak'); }
    else if (id === 'marker') { L.marker = !L.marker; store.set('rs.face.marker', L.marker ? '1' : '0'); ssSend('Marker'); }
    else if (id === 'color') { setColor(L.wfColor + (d > 0 ? 1 : -1)); }
    else if (id === 'level') { L.wfLevel = Math.max(-30, Math.min(30, L.wfLevel + d * 0.5)); store.set('rs.face.wflvl', L.wfLevel); ssSend('Level'); }
    smDraw();
    render();
    smArm();
  }
  function smDraw() {
    const sm = $('smenu');
    if (!sm) return;
    for (const [id, , val] of SMENU) { const b = sm.querySelector('[data-sm="' + id + '"] i'); if (b) b.textContent = val(); }
  }
  function smArm() { clearTimeout(L.smT); if (!L.smHover) L.smT = setTimeout(closeSmenu, 3000); }
  function openSmenu() {
    const sm = $('smenu');
    if (!sm) return;
    L.smenu = true;
    L.func = false;
    // Taille du texte : suit la taille de la photo
    sm.style.fontSize = Math.max(8, Math.round($('facePanel').clientWidth / V.w * 11)) + 'px';
    smDraw();
    sm.hidden = false;
    smArm();
    render();
  }
  function closeSmenu() { clearTimeout(L.smT); L.smenu = false; L.smHover = false; const sm = $('smenu'); if (sm) sm.hidden = true; render(); }
  function toImg(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  }

  // Écran du TRX (positions relatives à FACE.lcd), dans le style de l'écran du FTDX101 :
  // deux galvanomètres (MAIN à gauche, SUB à droite) avec leur filtre, fréquences en 7 segments, ANT / ATT / IPO / R.FIL / AGC,
  // puis le spectre et la cascade (de la BF reçue : le scope du TRX ne passe pas par la liaison CAT)
  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g' };
  /** Chaîne « 14.074.000 » → chemin SVG en 7 segments penchés, aligné à droite sur xr ; h = hauteur des chiffres */
  function seg7(text, xr, y, h) {
    const w = h * 0.52, t = h * 0.13, sk = h * 0.12, gap = h * 0.24, dot = h * 0.3, g = t * 0.18;
    let x = xr, d = '';
    const P = (pts) => 'M' + pts.map((p) => (p[0] + sk * (1 - (p[1] - y) / h)).toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + 'Z';
    const H = (x0, x1, yy) => P([[x0 + g, yy], [x0 + t / 2 + g, yy - t / 2], [x1 - t / 2 - g, yy - t / 2], [x1 - g, yy], [x1 - t / 2 - g, yy + t / 2], [x0 + t / 2 + g, yy + t / 2]]);
    const Vt = (xx, y0, y1) => P([[xx, y0 + g], [xx + t / 2, y0 + t / 2 + g], [xx + t / 2, y1 - t / 2 - g], [xx, y1 - g], [xx - t / 2, y1 - t / 2 - g], [xx - t / 2, y0 + t / 2 + g]]);
    for (const ch of String(text).split('').reverse()) {
      if (ch === '.') {
        x -= dot;
        d += P([[x + dot * 0.2, y + h - t], [x + dot * 0.2 + t, y + h - t], [x + dot * 0.2 + t, y + h], [x + dot * 0.2, y + h]]);
        continue;
      }
      x -= w + gap;
      const L0 = x + t / 2, R0 = x + w - t / 2, T = y + t / 2, M = y + h / 2, B = y + h - t / 2;
      const segs = { a: H(L0, R0, T), g: H(L0, R0, M), d: H(L0, R0, B), f: Vt(L0, T, M), b: Vt(R0, T, M), e: Vt(L0, M, B), c: Vt(R0, M, B) };
      for (const k of SEG[ch] || '') d += segs[k];
    }
    return d || 'M0 0';
  }
  // Galvanomètre : arcs concentriques autour d'un pivot sous le cadran, aiguille rouge
  const ARC_SPAN = 19 * Math.PI / 180;
  function arcPt(cx, cy, r, f, sp) { const sa = sp || ARC_SPAN, a = -sa + 2 * sa * f; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; }
  // FTX-1 : arc SWR aussi large que l'arc S (angle un peu plus ouvert sur un rayon plus petit)
  const ftxSwrSpan = (r) => Math.asin(244 * Math.sin(ARC_SPAN) / r);
  const swrNeedle = (m, f) => (m.swrSpan ? 0.5 + (f - 0.5) * m.swrSpan / ARC_SPAN : f); // fraction de l'aiguille pour un point de l'échelle SWR
  function arcPath(cx, cy, r, f0, f1, sp) {
    const p0 = arcPt(cx, cy, r, f0, sp), p1 = arcPt(cx, cy, r, f1, sp);
    return 'M' + p0[0].toFixed(1) + ' ' + p0[1].toFixed(1) + 'A' + r + ' ' + r + ' 0 0 1 ' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1);
  }
  const S_POS = (raw) => (raw == null ? 0 : raw <= 130 ? raw / 130 * 0.55 : Math.min(1, 0.55 + (raw - 130) / 125 * 0.45));
  function buildMeter(g, x0, y0, w, side) {
    const cx = x0 + w / 2 + 4, cy = y0 + 268, m = { cx, cy };
    if (FACE && FACE.meterFtx) m.hit = el('rect', { x: x0, y: y0 + 10, width: w, height: 72, fill: 'transparent', 'pointer-events': 'all' }, g); // FTX-1 : zone à toucher (METER)
    if (!(FACE && FACE.statusBar)) { // FTX-1 : pas de titre « PO METER » ; la barre d'état du TRX est au-dessus (buildStatus)
      el('rect', { x: x0, y: y0, width: w, height: 10, class: 'lcd-tbar' }, g);
      m.title = el('text', { x: cx, y: y0 + 8, class: 'lcd-ttl', 'text-anchor': 'middle' }, g, side === 'A' ? 'PO METER' : 'ALC METER');
    } else m.title = el('text', { x: cx, y: y0 + 8, style: 'display:none' }, g, '');
    const S_SC = ['S', 244, [[0.05, '1'], [0.17, '3'], [0.29, '5'], [0.41, '7'], [0.55, '9'], [0.7, '+20', 1], [0.84, '+40', 1], [0.97, '+60', 1]], true];
    const SWR_SC = ['SWR', FACE && FACE.meterFtx ? 226 : 229, [[0.05, '1.0'], [0.24, '1.5'], [0.36, '2'], [0.5, '3'], [0.66, '5'], [0.95, '∞']]];
    // FTX-1 : comme sur le TRX — MAIN : S, SWR et la barre VOL ; SUB : S seul
    // FTX-1 : échelle sous l'S-mètre selon METER (toucher l'S-mètre : PO, COMP, ALC, VDD, ID, SWR), une seule visible à la fois
    const R2 = FACE && FACE.meterFtx ? 226 : 229;
    // PO comme sur le FTX-1 avec l'ampli SPA-1 : 0, 10, 50, 100, 150 W (échelle resserrée vers le haut)
    const FTX_SEC = [['PO', R2, [[0.05, '0'], [0.27, '10'], [0.47, '50'], [0.66, '100'], [0.84, '150'], [0.95, 'W']]],
      ['COMP', R2, [[0.05, '0'], [0.27, '5'], [0.49, '10'], [0.71, '15'], [0.93, '20']]],
      ['ALC', R2, []],
      ['VDD', R2, [[0.05, '0'], [0.35, '5'], [0.65, '10'], [0.95, '15']]],
      ['ID', R2, [[0.05, '0'], [0.27, '5'], [0.49, '10'], [0.71, '15'], [0.93, '20']]], SWR_SC];
    const scales = FACE && FACE.meterFtx ? [S_SC].concat(FTX_SEC) : side === 'A'
      ? [['S', 244, [[0.05, '1'], [0.17, '3'], [0.29, '5'], [0.41, '7'], [0.55, '9'], [0.7, '+20', 1], [0.84, '+40', 1], [0.97, '+60', 1]], true],
        ['PO', 229, [[0.03, '0'], [0.2, '10'], [0.38, '50'], [0.52, '100'], [0.64, '150'], [0.76, '200'], [0.88, '250']]],
        ['COMP', 214, [[0.05, '0'], [0.25, '5'], [0.45, '10'], [0.65, '15'], [0.85, '20']]],
        ['TEMP', 199, [[0.05, '0'], [0.2, '20'], [0.36, '40'], [0.52, '60'], [0.68, '80'], [0.86, '100']]]]
      : [['S', 244, [[0.05, '1'], [0.17, '3'], [0.29, '5'], [0.41, '7'], [0.55, '9'], [0.7, '+20', 1], [0.84, '+40', 1], [0.97, '+60', 1]], true],
        ['ALC', 229, [[0.82, '50']]],
        ['ID', 214, [[0.05, '0'], [0.3, '5'], [0.55, '10'], [0.8, '15']]],
        ['SWR', 199, [[0.05, '1.0'], [0.24, '1.5'], [0.36, '2'], [0.5, '3'], [0.66, '5'], [0.95, '∞']]]];
    for (const [name, r, ticks, isS] of scales) {
      // FTX-1 : l'arc SWR va aussi loin que l'arc S, chiffres au-dessus de l'arc (entre les deux arcs), comme sur le TRX
      const ftxSwr = FACE && FACE.meterFtx && !isS, sp = ftxSwr ? ftxSwrSpan(r) : undefined; // FTX-1 : toutes les 2es échelles (pas seulement SWR)
      if (ftxSwr) m.swrSpan = sp;
      // FTX-1 : 2e échelle et barre VOL dans un groupe, montrés seulement sur le VFO actif (comme sur le TRX) ; une sous-groupe par mesure
      const g0 = g;
      if (ftxSwr) { m.extra = m.extra || el('g', {}, g0); m.sec = m.sec || {}; g = m.sec[name] = el('g', {}, m.extra); } else g = g0;
      if (isS) {
        el('path', { d: arcPath(cx, cy, r, 0, 0.55), class: 'mtr-arc' }, g);
        el('path', { d: arcPath(cx, cy, r, 0.55, 1), class: 'mtr-arc blue' }, g);
      } else if (ftxSwr && name === 'ALC') { // ALC (comme le TRX) : arc blanc sur la première moitié, bleu au-delà, sans chiffres
        el('path', { d: arcPath(cx, cy, r, 0, 0.5, sp), class: 'mtr-arc' }, g);
        el('path', { d: arcPath(cx, cy, r, 0.5, 0.92, sp), class: 'mtr-arc blue' }, g);
      } else el('path', { d: arcPath(cx, cy, r, 0, name === 'ALC' ? 0.5 : 0.92, sp), class: 'mtr-arc' + (name === 'ALC' ? ' thick' : '') }, g);
      for (const [f, lab, blue] of ticks) {
        const p = arcPt(cx, cy, r, f, sp), q = arcPt(cx, cy, isS || ftxSwr ? r + 4 : r - 3, f, sp);
        el('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], class: 'mtr-tick' + (blue ? ' blue' : '') }, g);
        // Chiffres écartés des arcs (15 unités entre deux arcs) : au-dessus de l'arc S, à mi-chemin entre deux arcs pour les autres
        const tp = arcPt(cx, cy, isS ? r + 9 : ftxSwr ? r + 6.5 : r - 10.5, f, sp);
        el('text', { x: tp[0], y: tp[1], class: 'mtr-num' + (blue ? ' blue' : '') + (isS ? ' big' : ''), 'text-anchor': 'middle' }, g, lab);
      }
      const lp = arcPt(cx, cy, r - (isS ? 0 : 3), -0.04, sp);
      el('text', { x: lp[0] - 2, y: lp[1] + 3, class: 'mtr-name' + (isS ? ' big' : ''), 'text-anchor': 'end' }, g, name);
      g = g0;
    }
    if (FACE && FACE.meterFtx) { // barre VOL (volume AF de ce récepteur), sous l'arc SWR
      const ge = m.extra || g;
      el('text', { x: x0 + 18, y: y0 + 79, class: 'mtr-name big', 'text-anchor': 'start' }, ge, 'VOL');
      el('line', { x1: x0 + 42, y1: y0 + 76, x2: x0 + w - 10, y2: y0 + 76, class: 'mtr-vol0' }, ge);
      m.vol = el('line', { x1: x0 + 42, y1: y0 + 76, x2: x0 + 42, y2: y0 + 76, class: 'mtr-vol' }, ge);
      m.volW = w - 52;
    }
    m.needle = el('line', { x1: cx, y1: cy, x2: cx, y2: cy - 250, class: 'mtr-needle' }, g);
    // FTX-1 : valeur (S, SWR / W…) au-dessus de la barre VOL, à droite, bien séparée d'elle (et du bandeau du scope dessous)
    m.val = el('text', { x: x0 + w - 4, y: y0 + (FACE && FACE.meterFtx ? 69 : 82), class: 'mtr-val', 'text-anchor': 'end' }, g, '');
    // Le cadran est découpé à la taille du cadre
    const cid = 'clipm' + side;
    const cp = el('clipPath', { id: cid }, g);
    el('rect', { x: x0, y: y0 + 10, width: w, height: FACE && FACE.meterFtx ? 72 : 76 }, cp);
    m.needle.setAttribute('clip-path', 'url(#' + cid + ')');
    return m;
  }
  function buildFilter(g, x0, y0, w, h) {
    const f = { x0, y0, w, h };
    g = f.g = el('g', { class: 'flt' + (FACE.meterFtx ? ' ftxflt' : '') }, g); // caché en DISP « filtres agrandis » (ils sont alors dans le grand cadre)
    el('rect', { x: x0, y: y0, width: w, height: h, class: 'flt-box' }, g);
    f.bars = el('path', { d: '', class: 'flt-bars' }, g);
    f.roof = el('path', { d: '', class: 'flt-roof' }, g); // limites du filtre de toit (R.FIL), en pointillés
    f.trap = el('path', { d: '', class: 'flt-trap' }, g);
    if (FACE.meterFtx) g.appendChild(f.bars); // FTX-1 : spectre par-dessus l'intérieur gris du filtre
    f.center = el('line', { x1: x0 + w / 2, y1: y0 + 6, x2: x0 + w / 2, y2: y0 + h - 4, class: 'flt-ctr' }, g);
    // VC TUNE : barre au-dessus du filtre, comme sur le TRX : « − » … traits rouges … « + », repère rouge à la position du présélecteur
    f.vc = el('g', { class: 'flt-vc', style: 'display:none' }, g);
    const vy = y0 - 5, va = x0 + 7, vb = x0 + w - 7;
    el('circle', { cx: va - 3.5, cy: vy, r: 1.8, class: 'flt-vcend' }, f.vc);
    el('circle', { cx: vb + 3.5, cy: vy, r: 1.8, class: 'flt-vcend' }, f.vc);
    let d = '';
    for (let i = 0; i <= 26; i++) { const x = va + i * (vb - va) / 26; d += 'M' + x.toFixed(1) + ' ' + (vy - 2.2) + 'V' + (vy + 2.2); }
    el('path', { d, class: 'flt-vcticks' }, f.vc);
    f.vcTri = el('path', { d: '', class: 'flt-vctri' }, f.vc);
    f.vcA = va; f.vcB = vb; f.vcY = vy;
    f.cup = el('path', { d: '', class: 'flt-cup', style: 'display:none' }, g);
    f.nline = el('line', { x1: x0, y1: y0 + 6, x2: x0, y2: y0 + h - 6, class: 'flt-notch', style: 'display:none' }, g);
    f.base = el('rect', { x: x0 + 6, y: y0 + h - 4, width: w - 12, height: 2.5, class: 'flt-base' }, g);
    // CW : indicateur d'accord sous le filtre, comme sur le TRX : « − » … « + », repère rouge au milieu (= le pitch),
    // et un petit trait gris à la fréquence du signal reçu ; trait au milieu = signal bien accordé (en RX comme en TX)
    f.cwt = el('g', { class: 'flt-cwt', style: 'display:none' }, g);
    const cy = y0 + h + 4, ca = x0 + 9, cb = x0 + w - 9;
    el('text', { x: ca - 5, y: cy + 2.6, class: 'flt-cwend', 'text-anchor': 'middle' }, f.cwt, '−');
    el('text', { x: cb + 5, y: cy + 2.6, class: 'flt-cwend', 'text-anchor': 'middle' }, f.cwt, '+');
    let cd = '';
    for (let i = 0; i <= 20; i++) { const x = ca + i * (cb - ca) / 20; cd += 'M' + x.toFixed(1) + ' ' + (cy - (i % 5 ? 1 : 2)) + 'V' + (cy + (i % 5 ? 1 : 2)); }
    el('path', { d: cd, class: 'flt-cwticks' }, f.cwt);
    el('path', { d: 'M' + ((ca + cb) / 2 - 2.2) + ' ' + (cy - 4.2) + 'H' + ((ca + cb) / 2 + 2.2) + 'L' + ((ca + cb) / 2) + ' ' + (cy - 1.6) + 'Z', class: 'flt-cwmid' }, f.cwt);
    f.cwInd = el('rect', { x: (ca + cb) / 2 - 1.5, y: cy - 2.6, width: 3, height: 5.2, rx: 0.8, class: 'flt-cwind', style: 'display:none' }, f.cwt);
    f.cwA = ca; f.cwB = cb; f.cwOff = null;
    return f;
  }
  // VC TUNE : position prévue pendant qu'on tourne (le TRX ne la renvoie qu'au cycle de lecture suivant)
  const VCP = {};
  let vcStep = Number(store.get('rs.face.vcstep', '2')) || 2; // unités de position par pas « + » / « − » (apprises)
  function vcLearn(v, now) {
    // Le TRX a relu la position : on en déduit la taille d'un pas pour la prochaine fois
    if (v.base == null || now == null || !v.sent) return;
    const st = Math.round(Math.abs(now - v.base) / Math.abs(v.sent));
    if (st >= 1 && st <= 16 && st !== vcStep) { vcStep = st; store.set('rs.face.vcstep', String(st)); }
  }
  function vcShown(sfx, s) {
    const real = s['vcPos' + sfx], v = VCP[sfx || 'A'];
    if (v && v.base != null) {
      if (Date.now() <= v.until + 1200) return Math.max(0, Math.min(255, v.base + v.sent * vcStep));
      vcLearn(v, real);
      delete VCP[sfx || 'A'];
    }
    return real;
  }
  // Fréquence BF du centre de la bande passante (sans le décalage SHIFT), selon le mode
  const FLT_SPAN = 4200; // largeur (Hz de BF) représentée par le cadre du filtre
  // CW : le filtre est centré sur le pitch (KEY PITCH du TRX, 700 Hz par défaut)
  function audioCenter(md, hz) { return /CW/.test(md) ? (S().cwPitch || 700) : /DATA|RTTY|PSK|-D$/.test(md) ? 1500 : /AM|FM/.test(md) ? hz / 2 : 300 + hz / 2; }
  // NOTCH du récepteur (MAIN : notch / notchFreq ; SUB : notchB / notchFreqB) : fréquence BF et place dans le cadre du filtre
  // (cadre = 4 kHz de large ; en bande latérale inférieure, le TRX montre la bande à l'envers)
  function notchOf(s, side, md, hz, sh) {
    const on = side === 'B' ? s.notchB : s.notch, f = side === 'B' ? s.notchFreqB : s.notchFreq;
    if (!on || !f || /FM/.test(md)) return null;
    const rev = /^LSB$|-L$/.test(md) ? -1 : 1;
    return { f, rel: rev * (f - (audioCenter(md, hz) + (sh || 0))) / FLT_SPAN };
  }
  // CONTOUR du récepteur (MAIN : contour / contourFreq ; SUB : contourB / contourFreqB) : même repère que le NOTCH
  function contourOf(s, side, md, hz, sh) {
    const on = side === 'B' ? s.contourB : s.contour, f = side === 'B' ? s.contourFreqB : s.contourFreq;
    if (!on || !f || /FM/.test(md)) return null;
    const rev = /^LSB$|-L$/.test(md) ? -1 : 1;
    return { f, rel: rev * (f - (audioCenter(md, hz) + (sh || 0))) / FLT_SPAN };
  }
  // Trapèze du filtre (points), avec le creux du NOTCH (profond, jusqu'en bas) et le petit « V » du CONTOUR
  // (peu profond, en haut), comme sur l'écran du TRX, s'ils tombent dans la bande passante
  // dips : [[x, demi-largeur, profondeur en px (absente = jusqu'en bas)], …]
  function trapPts(x0, w, cx, tw, top, bot, sl, dips) {
    const a = Math.max(x0 + 4, cx - tw / 2), b = Math.min(x0 + w - 4, cx + tw / 2);
    const pts = [[x0 + 3, bot], [a, bot], [a + sl, top]];
    let last = a + sl;
    for (const [nx, nw, dep] of (dips || []).filter((d) => d && d[0] != null).sort((p, q) => p[0] - q[0])) {
      if (nx - nw > last && nx + nw < b - sl) { pts.push([nx - nw, top], [nx, dep ? top + dep : bot - 1], [nx + nw, top]); last = nx + nw; }
    }
    pts.push([b - sl, top], [b, bot], [x0 + w - 3, bot]);
    return pts;
  }
  // Petit « V » bleu du CONTOUR, dans le haut du filtre (repassé en bleu par-dessus le trait rouge), comme sur le TRX
  const contV = (x, top, nw, dep) => 'M' + (x - nw).toFixed(1) + ' ' + top.toFixed(1) + 'L' + x.toFixed(1) + ' ' + (top + dep).toFixed(1) + 'L' + (x + nw).toFixed(1) + ' ' + top.toFixed(1);
  // FTX-1 : barre d'état en haut de l'écran, comme sur le TRX : FAST, VOX, TUNE (rouge : tuner en service) ANT1 / ANT2,
  // et à droite la fonction du bouton FUNC dans un cadre orange (ex. RF POWER, TUNER)
  function buildStatus(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v, sb = LCD.sb = {};
    el('rect', { x: X(5), y: Y(1), width: c.w - 10, height: 12.5, rx: 1.5, class: 'lcd-sbar' }, g);
    sb.fastR = el('rect', { x: X(146), y: Y(1.8), width: 36, height: 10.9, rx: 1.5, class: 'lcd-sfast' }, g);
    sb.fast = el('text', { x: X(164), y: Y(10.9), class: 'lcd-sfastt', 'text-anchor': 'middle' }, g, 'FAST');
    sb.vox = el('text', { x: X(222), y: Y(10.9), class: 'lcd-stxt', 'text-anchor': 'middle' }, g, 'VOX');
    sb.tuneR = el('rect', { x: X(262), y: Y(1.8), width: 38, height: 10.9, rx: 1.5, class: 'lcd-stuner' }, g); // fond rouge : tuner en service
    sb.tune = el('text', { x: X(296), y: Y(10.9), class: 'lcd-stune', 'text-anchor': 'end' }, g, 'TUNE');
    sb.ant = el('text', { x: X(302), y: Y(10.9), class: 'lcd-stxt' }, g, 'ANT1');
    sb.fnR = el('rect', { x: X(c.w - 108), y: Y(1.6), width: 102, height: 11.3, rx: 1.5, class: 'lcd-sfn' }, g);
    sb.fn = el('text', { x: X(c.w - 57), y: Y(10.9), class: 'lcd-sfnt', 'text-anchor': 'middle' }, g, '');
    const h = el('rect', { x: X(c.w - 108), y: Y(1), width: 102, height: 12.5, class: 'hs lcd-hit' }, g);
    el('title', {}, h, 'Fonction du bouton FUNC (appui de 2 s sur FUNC : écran FUNC)');
    h.addEventListener('click', () => doAct({ act: { local: 'funcLong' } }));
  }
  function drawStatus(s) {
    const sb = LCD.sb;
    if (!sb) return;
    // FINE / FAST changé sur le TRX (au club) : la page suit
    if (s.tuneStep != null && s.tuneStep !== L.tsSeen) {
      if (L.tsSeen !== undefined) { L.fine = s.tuneStep === 1; L.fast = s.tuneStep === 2; }
      L.tsSeen = s.tuneStep;
    }
    const fast = !!L.fast, fine = !fast && !!L.fine;
    sb.fastR.style.display = fast || fine ? '' : 'none'; sb.fast.style.display = fast || fine ? '' : 'none';
    sb.fast.textContent = fine ? 'FINE' : 'FAST';
    sb.fastR.classList.toggle('fine', fine); sb.fast.classList.toggle('fine', fine);
    sb.vox.style.display = s.vox ? '' : 'none';
    sb.tune.classList.toggle('on', !!s.tuner);
    sb.tuneR.style.display = s.tuner ? '' : 'none';
    sb.tune.style.display = s.tuner == null ? 'none' : '';
    sb.ant.textContent = 'ANT' + (s.ant || 1);
    const f = FUNC_BY[L.funcSel];
    sb.fn.textContent = f ? f[1] : '';
    sb.fnR.style.display = f ? '' : 'none';
  }
  function buildLcd() {
    const c = FACE.lcd;
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const g = el('g', { class: 'lcd' + (SINGLE ? ' single' : '') }, svg);
    LCD.c0y = c.y;
    el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 6, fill: 'url(#lcdbg)' }, g);
    // Galvanomètres et filtres : MAIN | filtre MAIN | SUB | filtre SUB
    LCD.g = g;
    // FTX-1 : fréquences en haut, galvanomètres et filtres dessous (FACE.meterDy), comme sur le TRX
    const gw = FACE.meterDy ? el('g', { transform: 'translate(0,' + FACE.meterDy + ')' }, g) : g;
    const gmA = el('g', {}, gw), gmB = el('g', {}, gw);
    const dA = rightSide('A') ? 284 : 0, dB = rightSide('B') ? 284 : 0;
    LCD.mA = buildMeter(gmA, X(5 + dA), Y(4), 190, 'A'); LCD.mA.g = gmA;
    LCD.fA = buildFilter(gw, X(199 + dA), Y(14), 82, 72);
    LCD.mB = buildMeter(gmB, X(5 + dB), Y(4), 190, 'B'); LCD.mB.g = gmB;
    LCD.fB = buildFilter(gw, X(199 + dB), Y(14), 82, 72);
    if (FACE.statusBar) buildStatus(g, c);
    // FTX-1 : toucher le cadre du filtre (MAIN ou SUB) ouvre l'écran DSP de ce récepteur, comme sur le TRX
    // FTX-1 : toucher l'S-mètre ouvre le tableau METER (mesure de l'aiguille en émission), comme sur le TRX
    if (FACE.meterFtx) for (const sd of ['A', 'B']) {
      const mg = LCD['m' + sd].g;
      mg.style.cursor = 'pointer';
      el('title', {}, mg, 'S-mètre ' + (sd === 'B' ? 'SUB' : 'MAIN') + ' : clic = METER (PO, COMP, ALC, VDD, ID, SWR)');
      mg.addEventListener('click', (ev) => { ev.stopPropagation(); meterOpen(sd); });
    }
    if (FACE.meterFtx) for (const sd of ['A', 'B']) {
      const fg = LCD['f' + sd].g;
      fg.style.cursor = 'pointer';
      el('title', {}, fg, 'Filtre ' + (sd === 'B' ? 'SUB' : 'MAIN') + ' : clic = écran DSP (SHIFT, WIDTH, NOTCH, CONTOUR / APF)');
      fg.addEventListener('click', (ev) => { ev.stopPropagation(); dspToggle(sd); });
    }
    // Fréquences
    const half = (c.w - 10) / 2;
    LCD.half = half; LCD.X = X; LCD.Y = Y; LCD.cw0 = c.w;
    for (const side of ['A', 'B']) {
      const i = rightSide(side) ? 1 : 0;
      const x0 = X(5 + i * half);
      const v = LCD['v' + side] = {};
      const g0 = g;
      { // éléments du VFO groupés (MONO : déplacés / cachés ensemble)
      const g = v.g = el('g', {}, g0);
      v.lbl = el('text', { x: x0 + 3, y: Y(103), class: 'lcd-vfo' }, g, 'VFO');
      v.tx = el('text', { x: x0 + 38, y: Y(103), class: 'lcd-txb' }, g, '');
      v.badge = el('rect', { x: x0 + 1, y: Y(106), width: 52, height: 15, rx: 1.5, class: 'lcd-mode' }, g);
      v.mode = el('text', { x: x0 + 27, y: Y(118), class: 'lcd-modet', 'text-anchor': 'middle' }, g, '—');
      if (FACE.vfoBadges) {
        // FTX-1 : étiquettes comme sur le TRX — [MAIN|SUB][VFO], dessous [RX] vert ou [TXRX] / [TX] rouge, puis le mode encadré
        const nm = side === 'A' ? 'MAIN' : 'SUB', nw = side === 'A' ? 27 : 21;
        v.nmR = el('rect', { x: x0 + 1, y: Y(87), width: nw, height: 11, rx: 1.2, class: 'lcd-vb-n' }, g);
        v.nmT = el('text', { x: x0 + 1 + nw / 2, y: Y(95.6), class: 'lcd-vb-t', 'text-anchor': 'middle' }, g, nm);
        v.vbR = el('rect', { x: x0 + 2 + nw, y: Y(87), width: 22, height: 11, rx: 1.2, class: 'lcd-vb-v' }, g);
        v.vbT = el('text', { x: x0 + 13 + nw, y: Y(95.6), class: 'lcd-vb-t', 'text-anchor': 'middle' }, g, 'VFO');
        v.stY = [Y(100), Y(108.6), Y(87), Y(95.6)];
        v.stR = el('rect', { x: x0 + 1, y: Y(100), width: 30, height: 11, rx: 1.2, class: 'lcd-vb-st' }, g);
        v.stT = el('text', { x: x0 + 16, y: Y(108.6), class: 'lcd-vb-t', 'text-anchor': 'middle' }, g, '');
        v.badge.setAttribute('y', Y(113)); v.badge.setAttribute('class', 'lcd-mode ftx');
        v.mode.setAttribute('y', Y(125));
        v.lbl.style.display = 'none'; v.tx.style.display = 'none';
      }
      // FTX-1 : fréquence en texte (Arial Black penché, comme la police de l'écran du TRX) ; les autres TRX : 7 segments
      v.freq = FACE && FACE.freqFont ? el('text', { x: 0, y: 0, class: 'lcd-seg ftxt', 'text-anchor': 'end', 'font-size': FACE.freqFont }, g, '')
        : el('path', { d: '', class: 'lcd-seg' }, g);
      v.xr = x0 + half - 6;
      v.sel = el('rect', { x: x0 + 58, y: Y(126), width: half - 64, height: 1.6, class: 'lcd-sel' }, g);
      v.hit = el('rect', { x: x0 + 58, y: Y(92), width: half - 64, height: 34, class: 'hs lcd-hit' }, g);
      el('title', {}, v.hit, 'Taper une fréquence pour le VFO ' + side);
      v.hit.addEventListener('click', () => askFreq(side));
      // « CLAR RX   -90Hz » au-dessus de la fréquence (clarifier en service), comme sur le TRX ; molette dessus : décalage ±10 Hz
      v.clarG = el('g', { class: 'lcd-clar', style: 'display:none' }, g);
      // FTX-1 : « CLAR RXTX » à droite, juste avant le décalage (comme sur le TRX)
      v.clarT = el('text', FACE && FACE.clarRight ? { x: v.xr - 50, y: Y(93.5 - (FACE.clarUp || 0)), class: 'lcd-clart', 'text-anchor': 'end' } : { x: x0 + 70, y: Y(93.5), class: 'lcd-clart' + (ICOM ? ' ic' : '') }, v.clarG, 'CLAR RX');
      v.clarV = el('text', { x: v.xr, y: Y(93.5 - ((FACE && FACE.clarUp) || 0)), class: 'lcd-clart', 'text-anchor': 'end' }, v.clarG, '');
      const ch = el('rect', { x: x0 + 66, y: Y(86 - ((FACE && FACE.clarUp) || 0)), width: half - 70, height: 8, class: 'hs lcd-hit' }, v.clarG);
      el('title', {}, ch, 'Clarifier : molette = décalage ±10 Hz ; appui long sur la grande touche CLAR : décalage à zéro');
      ch.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        const s = S();
        const vv = Math.max(-9999, Math.min(9999, (s.clar || 0) + (ev.deltaY < 0 ? 10 : -10)));
        setCtl('clar', vv);
        showTip(ev, 'CLAR ' + (vv > 0 ? '+' : '') + vv + ' Hz');
      }, { passive: false });
      }
    }
    // ANT / ATT / IPO / R.FIL / AGC
    const CELLS = FACE.cells ? FACE.cells.map(([lab, id]) => [lab, id, id + 'B']) : [['ANT', 'ant', 'ant'], ['ATT', 'att', 'attB'], ['IPO', 'preamp', 'preampB'], ['R.FIL', 'roof', 'roofB'], ['AGC', 'agc', 'agcB']];
    for (const side of ['A', 'B']) {
      const i = rightSide(side) ? 1 : 0;
      const x0 = X(5 + i * half);
      const cw = (half - 4) / 5;
      const cg = LCD['cg' + side] = el('g', {}, g);
      LCD['c' + side] = CELLS.map(([lab, ka, kb], j) => {
        const id = side === 'A' ? ka : kb;
        const x = x0 + j * cw;
        const r = el('rect', { x: x + 0.5, y: Y(130), width: cw - 1, height: 24, class: 'lcd-cell' }, cg);
        const tl = el('text', { x: x + cw / 2, y: Y(139), class: 'lcd-clab', 'text-anchor': 'middle' }, cg, lab);
        const t = el('text', { x: x + cw / 2, y: Y(151), class: 'lcd-cval', 'text-anchor': 'middle' }, cg, '—');
        const h = el('rect', { x: x + 0.5, y: Y(130), width: cw - 1, height: 24, class: 'hs lcd-hit' }, cg);
        el('title', {}, h, lab + ' ' + (side === 'A' ? 'MAIN' : 'SUB') + ' : clic pour changer');
        h.addEventListener('click', () => cycleCell(id));
        return { id, t, r, tl, h };
      });
    }
    // Bandeau du scope : récepteur actif, état, échelle
    const lowG = LCD.lowG = el('g', {}, g); // bandeau du scope (EXPAND : remonté)
    el('rect', { x: X(5), y: Y(G.lowY), width: c.w - 10, height: 11, class: 'lcd-tbar' }, lowG);
    LCD.side = el('text', { x: X(10), y: Y(G.lowY + 8.5), class: 'lcd-side' }, lowG, 'MAIN');
    LCD.flags = el('text', { x: X(c.w / 2), y: Y(G.lowY + 8.5), class: 'lcd-flags', 'text-anchor': 'middle' }, lowG, '');
    LCD.span = el('text', { x: X(c.w - 10), y: Y(G.lowY + 8.5), class: 'lcd-side', 'text-anchor': 'end' }, lowG, 'BF | 0–4 kHz');
    LCD.scopeRect = el('rect', { x: X(5), y: Y(G.scopeY), width: c.w - 10, height: G.scopeH, class: 'lcd-scope' }, g);
    // EXPAND : galvanomètres réduits à leur partie haute (S-mètre et première échelle)
    const defs = el('defs', {}, g);
    for (const [sd, x0] of [['A', X(rightSide('A') ? 289 : 5)], ['B', X(rightSide('B') ? 289 : 5)]]) {
      const cp = el('clipPath', { id: 'lcdClip' + sd }, defs);
      el('rect', { x: x0 - 2, y: Y(2), width: 194, height: 54 }, cp); // S-mètre et 1re échelle avec ses chiffres
    }
    // Rangée du bas, comme sur l'écran du TRX ; la dernière case montre la fonction réglée par le bouton MULTI
    const BOT = [['CENTER'], ['SPAN', () => openSpan()],
      ['3DSS', () => { viewTouched(); L.d3 = !L.d3; store.set('rs.face.3dss', L.d3 ? '1' : '0'); WF.h3 = []; WF.drawn = false; say(L.d3 ? '3DSS : spectre en trois dimensions (le son reçu)' : '3DSS coupé', '', 2500); render(); }], ['MONO', () => { viewTouched(); L.mono = !L.mono; store.set('rs.face.mono', L.mono ? '1' : '0'); WF.drawn = false; say(L.mono ? 'MONO : un seul VFO à l’écran, celui qui est sélectionné (MAIN ou SUB)' : 'MONO coupé : MAIN et SUB à l’écran', '', 3000); render(); }], ['MULTI', () => { viewTouched(); L.multi = !L.multi; store.set('rs.face.multi', L.multi ? '1' : '0'); WF.drawn = false; say(L.multi ? 'MULTI : scope, OSCILLOSCOPE et AF-FFT du VFO sélectionné' : 'MULTI : affichage normal', '', 2500); render(); }],
      ['EXPAND', () => { viewTouched(); L.expand = !L.expand; store.set('rs.face.expand', L.expand ? '1' : '0'); say(L.expand ? 'EXPAND : galvanomètres réduits, scope agrandi' : 'EXPAND coupé : affichage normal', '', 2500); render(); }], ['HOLD', () => { L.hold = !L.hold; render(); }], ['MULTI']];
    if (SINGLE || FACE.bot) {
      // Rangée du bas du FTDX10 : CENTER, 3DSS, MULTI, EXPAND, SPAN, SPEED (la fonction du bouton FUNC est dans la case près du VFO-B) ;
      // FTX-1 : CENTER, 3DSS, MULTI, SCOPE (réglages du scope : SCOPE MENU), SPAN, SPEED
      const by = (n) => BOT.find((b) => b[0] === n);
      const extra = { EXPAND: ['EXPAND', () => toggleExpand()], SPEED: ['SPEED', FACE.meterFtx ? () => openSpeed() : () => { smAdjust('spd', 1); say('SPEED (vitesse de la cascade) : ' + WF_SPEEDS[L.wfSpeed][0], '', 2500); }],
        // FTX-1 : SCOPE montre seulement de quel VFO est le scope (MAIN ou SUB, celui qui est sélectionné), pas de menu
        SCOPE: ['SCOPE', FACE.meterFtx ? () => say('SCOPE : scope du VFO sélectionné (' + (activeSide() === 'B' ? 'SUB' : 'MAIN') + ') ; les réglages du scope sont dans l’écran FUNC (D-LEVEL, D-PEAK, D-COLOR…).', '', 4000) : () => (L.smenu ? closeSmenu() : openSmenu())],
        // FTX-1 : D-MODE = mode du scope du TRX, CENTER → CURSOR → FIX (SS06), comme sur le TRX
        'D-MODE': ['D-MODE', () => {
          if (!needControl()) return;
          const v = ((S().dMode != null ? S().dMode : 0) + 1) % 3;
          setCtl('dMode', L.d3 ? v : [4, 7, 10][v]);
          pend.dMode = { v, at: Date.now() };
          WF.h3 = []; // 3DSS : la fenêtre change, on repart d'un relief vide
          say('D-MODE : ' + ['CENTER', 'CURSOR', 'FIX'][v] + ' (scope du TRX)', '', 2500);
          render();
        }] };
      const names = FACE.bot || ['CENTER', '3DSS', 'MULTI', 'EXPAND', 'SPAN', 'SPEED'];
      BOT.splice(0, BOT.length, ...names.map((n) => extra[n] || by(n) || [n]));
    }
    const bw = (c.w - 10) / BOT.length;
    LCD.bot = BOT.map(([lab, fn], j) => {
      const x = X(5) + j * bw, last = j === BOT.length - 1 && !SINGLE && !FACE.bot;
      const r = el('rect', { x: x + 0.5, y: Y(G.botY), width: bw - 1, height: G.botH, rx: last ? 2 : 0, class: 'lcd-bot' + (last ? ' multi' : '') }, g);
      const t = el('text', { x: x + bw / 2, y: Y(last ? G.botY + 8.5 : G.botY + G.botH / 2 + 3.5), class: 'lcd-bott', 'text-anchor': 'middle' }, g, lab);
      // FTX-1 : D-MODE et SCOPE sur deux lignes (valeur en orange dessous : CENTER / CURSOR / FIX, MAIN / SUB)
      const sub = !!(FACE.botSub && FACE.botSub.includes(lab));
      if (sub) { t.setAttribute('y', Y(G.botY + 9)); t.classList.add('two'); }
      const t2 = last || sub ? el('text', { x: x + bw / 2, y: Y(G.botY + 18), class: 'lcd-bott2' + (sub ? ' sub' : ''), 'text-anchor': 'middle' }, g, '') : null;
      const h = el('rect', { x: x + 0.5, y: Y(G.botY), width: bw - 1, height: G.botH, class: 'hs lcd-hit' + (fn || last ? '' : ' off') }, g);
      el('title', {}, h, last ? 'MULTI : fonction réglée par le bouton MULTI (choisie dans FUNC)' : lab + (fn ? '' : ' : pas disponible à distance'));
      h.addEventListener('click', () => {
        if (last) { viewTouched(); L.func = true; return render(); }
        if (fn) return fn();
        say(lab + ' : réglage du scope du TRX, pas disponible à distance (la cascade est celle de la BF).', '', 3500);
      });
      if (ICOM) for (const e of [r, t, t2, h]) if (e) e.style.display = 'none'; // IC-7300 : pas de rangée de touches CENTER / HOLD / 3DSS… (Yaesu)
      return { r, t, t2, h, lab };
    });
    LCD.hint = el('text', { x: X(c.w / 2), y: Y(G.scopeY + G.scopeH / 2 - 2), class: 'lcd-hint', 'text-anchor': 'middle' }, g, 'Cascade : en attente du son de la station…');
    if (SINGLE) {
      // FTDX10 : case de la fonction du bouton FUNC (ex. LEVEL, RF POWER), à droite du VFO-B ; clic = menu FUNC
      const fr = el('rect', { x: X(520), y: Y(57), width: 85, height: 23, rx: 3, class: 'lcd-fbox' }, g);
      const ft = el('text', { x: X(562.5), y: Y(73), class: 'lcd-fboxt', 'text-anchor': 'middle' }, g, '');
      const fv = el('text', { x: X(562.5), y: Y(82.5), class: 'lcd-fboxv', 'text-anchor': 'middle' }, g, ''); // IC-7300 : décalage RIT / ΔTX
      const fh = el('rect', { x: X(520), y: Y(57), width: 85, height: 23, class: 'hs lcd-hit' }, g);
      el('title', {}, fh, 'Fonction du bouton FUNC (clic : menu FUNC)');
      fh.addEventListener('click', () => { if (ICOM) return; viewTouched(); L.func = !L.func; render(); }); // IC-7300 : la case n'ouvre rien (RIT ΔTX seulement)
      LCD.fbox = { r: fr, t: ft, v: fv };
    }
    buildFunc(g, c);
    buildModeMenu(g, c);
    if (SINGLE || FACE.bandGrid) buildBandMenu(g, c); // FTX-1 : tableau BAND du TRX (MAG BAND)
    if (ICOM) {
      // Écran MENU de l'IC-7300 : 2 pages de 5 × 2 touches, comme sur le TRX ; VOICE devient KEYER en CW et DECODE en RTTY
      const md = () => L.activeMode(S()) || '';
      const noR = (t) => t + ' : pas disponible à distance';
      buildGrid(g, c, 'icomMenu', 'MENU', [[
        ['SCOPE', 'SCOPE : SPECTRUM SCOPE sous la fréquence (touches SPAN, HOLD… ; EXIT : retour)', () => setIcView('scope')],
        ['AUDIO', 'AUDIO SCOPE : spectre (FFT) et oscilloscope de la BF reçue, sous la bande du scope (EXIT : retour)', () => { viewTouched(); setIcView('audio'); }],
        [() => (/^CW/.test(md()) ? 'KEYER' : /^RTTY/.test(md()) ? 'DECODE' : 'VOICE'),
          () => (/^CW/.test(md()) ? 'KEYER : mémoires M1 … M8 du manipulateur du TRX (clic = émission)' : /^RTTY/.test(md()) ? 'DECODE : décodeur RTTY (onglet RTTY des modes numériques)' : 'VOICE TX : mémoires vocales T1 … T8 du TRX'),
          () => (/^CW/.test(md()) ? setIcView('keyer') : /^RTTY/.test(md()) ? digiOpen('rtty') : setIcView('voice'))],
        ['METER', 'METER : les mesures (ALC, COMP, SWR, Id, Vd, Po) sous la fréquence, à la place du scope', () => setIcMeter(true)],
        ['SWR', 'SWR GRAPH : ROS relevé pendant vos émissions, par fréquence', () => setIcView('swr')],
        ['MEMORY', 'MEMORY : canaux mémoire du TRX (clic = fréquence et mode dans le VFO)', () => openIcMem()],
        ['SCAN', 'SCAN : balayage programmé (P1 – P2) ou ΔF autour de la fréquence', () => setIcView('scan')],
        ['MPAD', 'MEMO PAD : fréquences notées par la touche MPAD (clic = retour sur la fréquence)', () => setIcView('mpad')],
        ['RECORD', 'QSO RECORDER (carte SD du TRX)', () => { L.icRec = true; render(); }],
        ['SET', 'SET : réglages du TRX (Tone Control/TBW, Function, Connectors, Display, Time Set, SD Card, Others)', () => { L.icSet = true; L.icSetP = 0; render(); }]
      ], [
        null, null, null, null, null, null, null, null,
        ['PRESET', 'PRESET (Normal, FT8… enregistrés sur le TRX)', () => say('PRESET : les préréglages du TRX (1: Normal, 2: FT8…) n’ont pas de commande CAT (section 19 du manuel) : ils ne se lisent ni ne se rappellent à distance.', '', 6000)],
        ['SET', 'SET : réglages du TRX', () => { L.icSet = true; L.icSetP = 0; render(); }]
      ]]);
      // Écran QUICK de l'IC-7300 : raccourcis
      buildGrid(g, c, 'quickMenu', 'QUICK MENU', [[
        ['BAND', 'Tableau des bandes', () => openBandMenu()],
        ['SPLIT', 'SPLIT marche / arrêt', () => doAct({ act: { local: 'split' } })],
        ['A=B', 'Copie le VFO A dans le VFO B', () => setCtl('aToB', null)],
        ['A/B', 'A/B : passe sur l’autre VFO (A ⇄ B)', () => setCtl('swap', null)],
        ['TUNER', 'Coupleur d’antenne marche / arrêt', () => setCtl('tuner', S().tuner ? 0 : 1)],
        ['TUNE', 'Accord du coupleur (émission courte)', () => doAct({ act: { action: 'tune' } })],
        ['LOCK', 'LOCK du grand bouton', () => setCtl('lock', S().lock ? 0 : 1)]]]); // pas de 3DSS sur l'IC-7300
      buildMultiMenu(g, c);
      buildIcMeter(g, c);
      buildSpoBar(g, c);
      buildIcomHead(g, c);
      buildIcKeyer(g, c);
      buildIcAudio(g, c);
      buildIcScope(g, c);
      buildIcVoice(g, c);
      buildIcSwr(g, c);
      buildIcScan(g, c);
      buildIcMem(g, c);
      buildIcMpad(g, c);
      buildIcRec(g, c);
      buildIcSet(g, c);
      buildIcSetSub(g, c);
      buildIcVrec(g, c);
      buildIcFunc(g, c);
      if (LCD.multiMenu) g.appendChild(LCD.multiMenu); // menu MULTI par-dessus les cadres Vd / TEMP et les autres écrans
      // Le mode affiché se touche pour le changer, comme sur l'écran de l'IC-7300
      const v = LCD.vA, mb = el('rect', { x: Number(v.badge.getAttribute('x')), y: Number(v.badge.getAttribute('y')), width: 52, height: 15, class: 'hs lcd-hit' }, v.g);
      el('title', {}, mb, 'Mode : clic pour le tableau des modes');
      mb.addEventListener('click', (ev) => { ev.stopPropagation(); openModeMenu(); });
    }
  }
  // Tableau de touches sur l'écran (IC-7300 : MENU, QUICK) : pages de 5 × 2 touches [libellé, bulle, action | null]
  // (libellé et bulle peuvent dépendre du mode : fonctions), boutons de page ① ② et retour ↩, comme sur le TRX
  // Icônes des touches de l'écran MENU de l'IC-7300 (dessins originaux, repère 100 × 70)
  const scr = (x, y, w, h) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="#0b1020" stroke="#9aa3b5" stroke-width="3"/>';
  const ICONS = {
    SCOPE: scr(8, 4, 84, 62) + '<path d="M13 40L22 37L27 30L31 38L38 33L44 12L48 34L55 31L60 22L64 35L72 30L78 36L87 34" fill="none" stroke="#e8ecf4" stroke-width="2.5"/>'
      + '<rect x="12" y="42" width="76" height="20" fill="#1f5fd0"/><path d="M16 46h6M30 50h5M46 44h8M60 54h6M74 48h7M20 57h7M50 58h4" stroke="#7fd0ff" stroke-width="3"/><rect x="46" y="42" width="5" height="20" fill="#ffb02e"/>',
    AUDIO: scr(4, 4, 92, 62) + '<path d="M9 36L16 30L20 14L24 32L30 28L36 34L46 33" fill="none" stroke="#e8ecf4" stroke-width="2.5"/><rect x="8" y="40" width="40" height="22" fill="#1f5fd0"/><path d="M12 46h8M26 52h10M14 57h6" stroke="#7fd0ff" stroke-width="3"/>'
      + '<path d="M52 36v-6M56 36v-14M60 36v-22M64 36v-10M68 36v-26M72 36v-16M76 36v-8M80 36v-20M84 36v-12M88 36v-6M52 36v6M56 36v12M60 36v18M64 36v8M68 36v22M72 36v14M76 36v6M80 36v18M84 36v10M88 36v4" stroke="#5ad13a" stroke-width="3"/>',
    VOICE: '<rect x="37" y="4" width="26" height="38" rx="13" fill="#c9ced8" stroke="#7d8494" stroke-width="2"/><path d="M40 16h20M40 22h20M40 28h20" stroke="#8a91a0" stroke-width="1.5"/>'
      + '<path d="M30 28a20 20 0 0 0 40 0" fill="none" stroke="#b7bcc6" stroke-width="4"/><path d="M50 48v12M36 64h28" stroke="#b7bcc6" stroke-width="5" stroke-linecap="round"/>',
    KEYER: '<rect x="12" y="50" width="76" height="12" rx="3" fill="#6b7280"/><rect x="47" y="14" width="6" height="38" fill="#c9ced8"/><rect x="28" y="20" width="18" height="28" rx="4" fill="#2f6fd6"/><rect x="54" y="20" width="18" height="28" rx="4" fill="#2f6fd6"/>'
      + '<circle cx="20" cy="8" r="4" fill="#ffb02e"/><rect x="30" y="5" width="18" height="6" rx="3" fill="#ffb02e"/><circle cx="58" cy="8" r="4" fill="#ffb02e"/>',
    DECODE: scr(8, 4, 84, 62) + '<text x="16" y="28" font-family="Arial" font-weight="700" font-size="16" fill="#5ad13a">CQ CQ</text><text x="16" y="50" font-family="Arial" font-weight="700" font-size="16" fill="#e8ecf4">DE ON5VL</text>',
    METER: scr(8, 4, 84, 62) + [14, 31, 48].map((y, r) => Array.from({ length: [16, 7, 13][r] }, (_, i) => '<rect x="' + (14 + i * 4.6) + '" y="' + y + '" width="3" height="12" fill="' + (i > 9 ? '#ff4a3a' : '#38a0ff') + '"/>').join('')).join('')
      + '<path d="M12 28h76M12 45h76" stroke="#3a4256" stroke-width="1.5"/>',
    SWR: scr(14, 4, 72, 62) + [[20, 40], [28, 22], [36, 14], [44, 10], [52, 9], [60, 12], [68, 20], [76, 34]].map(([x, h]) => '<rect x="' + x + '" y="' + (62 - h) + '" width="6" height="' + h + '" fill="#38a0ff"/>').join('')
      + '<path d="M18 30h66" stroke="#ff4a3a" stroke-width="3"/><rect x="20" y="16" width="6" height="14" fill="#ff8a7a" opacity=".8"/>',
    MEMORY: '<rect x="28" y="4" width="48" height="62" rx="4" fill="#b8551c"/><rect x="34" y="4" width="42" height="62" rx="3" fill="#d9752e"/><rect x="72" y="12" width="5" height="10" fill="#ffd34a"/><rect x="72" y="26" width="5" height="10" fill="#6fc3ff"/><rect x="72" y="40" width="5" height="10" fill="#ff7aa8"/>'
      + Array.from({ length: 8 }, (_, i) => '<path d="M24 ' + (10 + i * 7.5) + 'h10" stroke="#d8dce4" stroke-width="2.5" stroke-linecap="round"/>').join(''),
    SCAN: '<rect x="18" y="12" width="26" height="44" rx="8" fill="#9aa1ae"/><rect x="56" y="12" width="26" height="44" rx="8" fill="#9aa1ae"/><rect x="40" y="22" width="20" height="16" rx="3" fill="#6b7280"/>'
      + '<rect x="22" y="4" width="18" height="12" rx="3" fill="#c9ced8"/><rect x="60" y="4" width="18" height="12" rx="3" fill="#c9ced8"/><ellipse cx="31" cy="60" rx="12" ry="6" fill="#2a2f3a" stroke="#c9ced8" stroke-width="3"/><ellipse cx="69" cy="60" rx="12" ry="6" fill="#2a2f3a" stroke="#c9ced8" stroke-width="3"/>',
    MPAD: '<rect x="24" y="16" width="50" height="46" rx="3" fill="#8fd0ff" transform="rotate(-8 49 39)"/><rect x="26" y="12" width="50" height="46" rx="3" fill="#ffb3c7" transform="rotate(4 51 35)"/><rect x="26" y="10" width="50" height="48" rx="3" fill="#ffd34a"/>'
      + '<path d="M38 50L70 14" stroke="#2f6fd6" stroke-width="7" stroke-linecap="round"/><path d="M38 50l-4 8 8-4z" fill="#3a2a1a"/><path d="M36 6v12" stroke="#c9ced8" stroke-width="3" stroke-linecap="round"/>',
    RECORD: '<rect x="8" y="10" width="84" height="50" rx="4" fill="#5b616e" stroke="#9aa3b5" stroke-width="3"/><rect x="14" y="16" width="72" height="38" rx="2" fill="#3a3f4a"/>'
      + '<circle cx="34" cy="35" r="14" fill="#c9ced8"/><circle cx="66" cy="35" r="11" fill="#c9ced8"/><circle cx="34" cy="35" r="4" fill="#3a3f4a"/><circle cx="66" cy="35" r="4" fill="#3a3f4a"/><path d="M34 21v6M22 42l5-3M46 42l-5-3M66 24v5M57 41l4-2M75 41l-4-2" stroke="#3a3f4a" stroke-width="3"/>',
    SET: '<path d="M22 60L68 14" stroke="#c9ced8" stroke-width="8" stroke-linecap="round"/><circle cx="72" cy="12" r="11" fill="#c9ced8"/><rect x="68" y="0" width="8" height="12" fill="#1b1f27" transform="rotate(45 72 12)"/>'
      + '<path d="M30 14L60 46" stroke="#aeb4bf" stroke-width="5"/><path d="M58 44L76 62" stroke="#e5482b" stroke-width="11" stroke-linecap="round"/><path d="M26 10l6 2 2 6" stroke="#aeb4bf" stroke-width="3" fill="none"/>',
    PRESET: scr(8, 4, 84, 62) + [[24, 20], [42, 44], [60, 28], [78, 38]].map(([x, y]) => '<path d="M' + x + ' 12v48" stroke="#6b7280" stroke-width="3"/><rect x="' + (x - 7) + '" y="' + (y - 4) + '" width="14" height="8" rx="2" fill="#38a0ff"/>').join('')
  };
  function buildGrid(g, c, key, title, pages) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = LCD[key] = el('g', { class: 'mode-menu ic-menu', style: 'display:none' }, g);
    const x0 = X(6), y0 = Y(4), w = c.w - 12, h = c.h - 8;
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 4, class: 'mm-bg' }, m);
    el('rect', { x: x0 + 4, y: y0 + 4, width: w - 8, height: 24, rx: 3, class: 'mm-title' }, m);
    el('text', { x: x0 + w / 2, y: y0 + 21, class: 'mm-ttl big', 'text-anchor': 'middle' }, m, title);
    const cw = (w - 16) / 5, rh = (h - 90) / 2;
    const cells = [];
    for (let i = 0; i < 10; i++) {
      const x = x0 + 8 + (i % 5) * cw, y = y0 + 34 + Math.floor(i / 5) * rh;
      const box = el('rect', { x: x + 3, y, width: cw - 6, height: rh - 8, rx: 5, class: 'mm-cell ic-cell' }, m);
      const t = el('text', { x: x + cw / 2, y: y + rh / 2, class: 'mm-lab ic-lab', 'text-anchor': 'middle' }, m, '');
      // Icône au-dessus du nom (touches qui en ont une) : repère 100 × 70 ramené dans la case
      const isc = Math.min((cw - 22) / 100, (rh - 44) / 70);
      const ic = el('g', { class: 'ic-icon', transform: 'translate(' + (x + cw / 2 - 50 * isc) + ',' + (y + 7) + ') scale(' + isc + ')' }, m);
      const hit = el('rect', { x: x + 3, y, width: cw - 6, height: rh - 8, class: 'hs lcd-hit' }, m);
      const tt = el('title', {}, hit, '');
      const cell = { box, t, ic, hit, tt, it: null, y, lab: null };
      hit.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const it = cell.it;
        if (!it) return;
        const tip = typeof it[1] === 'function' ? it[1]() : it[1];
        closeGrid(key);
        if (it[2]) it[2](); else say(tip + '.', '', 4000);
      });
      cells.push(cell);
    }
    // Pages ① ② (si plusieurs) et retour ↩
    const by = y0 + h - 44, pg = [];
    if (pages.length > 1) pages.forEach((_, p) => {
      const cx = x0 + w / 2 + (p - (pages.length - 1) / 2) * 70;
      const ci = el('circle', { cx, cy: by + 20, r: 17, class: 'ic-page' }, m);
      el('text', { x: cx, y: by + 26, class: 'ic-paget', 'text-anchor': 'middle' }, m, String(p + 1));
      const hit = el('circle', { cx, cy: by + 20, r: 17, class: 'hs lcd-hit' }, m);
      el('title', {}, hit, 'Page ' + (p + 1));
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); L[key + 'P'] = p; render(); });
      pg.push(ci);
    });
    el('rect', { x: x0 + w - 90, y: by + 4, width: 78, height: 32, rx: 4, class: 'mm-cell' }, m);
    { const ax = x0 + w - 51, ay = by + 20; // flèche de retour ↩, dessinée (pas de caractère : polices différentes)
      el('path', { d: 'M' + (ax + 12) + ' ' + (ay - 7) + 'H' + (ax - 4) + 'A7 7 0 0 0 ' + (ax - 4) + ' ' + (ay + 7) + 'H' + (ax + 6), class: 'ic-back' }, m);
      el('path', { d: 'M' + (ax - 1) + ' ' + (ay - 12) + 'L' + (ax - 7) + ' ' + (ay - 7) + 'L' + (ax - 1) + ' ' + (ay - 2), class: 'ic-back' }, m); }
    const back = el('rect', { x: x0 + w - 90, y: by + 4, width: 78, height: 32, class: 'hs lcd-hit' }, m);
    el('title', {}, back, 'Retour (comme EXIT)');
    back.addEventListener('click', (ev) => { ev.stopPropagation(); closeGrid(key); });
    LCD[key + 'Draw'] = () => {
      const p = Math.min(pages.length - 1, L[key + 'P'] || 0);
      pg.forEach((ci, i) => ci.classList.toggle('on', i === p));
      cells.forEach((cell, i) => {
        const it = pages[p][i] || null;
        cell.it = it;
        const lab = it ? (typeof it[0] === 'function' ? it[0]() : it[0]) : '';
        cell.t.textContent = lab;
        if (cell.lab !== lab) { cell.lab = lab; cell.ic.innerHTML = ICONS[lab] || ''; }
        // Avec une icône : le nom en bas de la case, comme sur le TRX ; sinon au milieu
        cell.t.setAttribute('y', ICONS[lab] ? cell.y + rh - 18 : cell.y + rh / 2);
        cell.tt.textContent = it ? (typeof it[1] === 'function' ? it[1]() : it[1]) : '';
        cell.box.classList.toggle('preset', !!it && !it[2]);
        cell.box.classList.toggle('empty', !it);
        cell.t.classList.toggle('preset', !!it && !it[2]);
      });
    };
  }
  // METER / SWR de l'écran MENU : les mesures relues sur le TRX (en émission)
  function meterSay(swrOnly) {
    const s = S();
    if (!s.tx) return say((swrOnly ? 'SWR' : 'METER') + ' : les mesures (Po, SWR, ALC, COMP, Id, Vd) se lisent en émission ; le galvanomètre de l’écran passe sur Po.', '', 5000);
    const f = (v, d) => (v == null ? '—' : v.toFixed(d));
    const swr = R.swrValue ? R.swrValue(s.m6) : null;
    if (swrOnly) return say('SWR ' + f(swr, 1), '', 4000);
    say('Po ' + (s.m5 != null && R.poFrac ? Math.round(R.poFrac(s.m5) * 100) + ' %' : '—') + ' · SWR ' + f(swr, 1) + ' · ALC ' + num(s.m4) + ' · COMP ' + num(s.m3)
      + ' · Id ' + f(R.idValue ? R.idValue(s.m7) : null, 1) + ' A · Vd ' + f(R.vdValue ? R.vdValue(s.m8) : null, 1) + ' V', '', 6000);
  }
  const gridOutside = {};
  function openGrid(key) {
    for (const k of ['icomMenu', 'quickMenu']) if (k !== key && L[k]) closeGrid(k);
    L[key] = true;
    L[key + 'P'] = 0;
    render();
    gridOutside[key] = (ev) => { if (!ev.target.closest || !ev.target.closest('.mode-menu')) closeGrid(key); };
    setTimeout(() => document.addEventListener('pointerdown', gridOutside[key], true), 0);
  }
  function closeGrid(key) { L[key] = false; if (gridOutside[key]) document.removeEventListener('pointerdown', gridOutside[key], true); render(); }
  // IC-7300 : écran des mesures sous la fréquence (comme le METER du TRX) : ALC, COMP, SWR, Id à gauche, Vd et Po à droite
  L.icMeter = store.get('rs.face.icmeter', '1') !== '0';
  // Écrans du MENU de l'IC-7300 sous la bande du scope : 'audio' (AUDIO SCOPE) ou 'keyer' (KEYER, en CW) ; null = écran par défaut
  L.icView = null;
  function setIcView(v) {
    L.icView = L.icView === v ? null : v;
    if (L.icView !== 'scope') { L.iscRef = false; L.iscExp = false; if (L.iscPage === 2) L.iscPage = 1; }
    if (L.icView !== 'scope') L.icBig = false; // grande fréquence (M.SCOPE) gardée avec le SPECTRUM SCOPE, comme sur le TRX
    if (L.icView === 'keyer') kmRefresh();
    if (L.icView === 'audio') audRead();
    if (L.icView !== 'voice') L.ivLvl = false;
    if (L.icView === 'scan' && LCD.iscnRead) LCD.iscnRead();
    WF.drawn = false; render();
  }
  function setIcMeter(on) { L.icView = null; L.icMeter = !!on; L.icBig = false; store.set('rs.face.icmeter', L.icMeter ? '1' : '0'); WF.drawn = false; render(); }
  // M.SCOPE : grand écran des mesures, sans scope (grande fréquence, grand S/Po, ALC / COMP / SWR / Id, Vd / TEMP) ; un 2e appui : retour à l'écran par défaut
  L.icBig = false;
  function setIcBig(on) { if (L.icView !== 'scope') L.icView = null; L.icBig = !!on; if (on) { L.icMeter = true; store.set('rs.face.icmeter', '1'); } WF.drawn = false; render(); }
  function buildIcMeter(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = el('g', { class: 'icm', style: 'display:none' }, g);
    const bg = el('rect', { x: X(5), y: Y(G.scopeY + IC_STRIP), width: c.w - 10, height: G.scopeH - IC_STRIP, class: 'icm-bg' }, m);
    const bars = {};
    // Barres comme sur le TRX : segments gris, segments allumés en couleur ; échelle posée sur la barre (COMP) ou sous un trait blanc (SWR, Id) ;
    // ALC : trait rouge de la zone ALC sous la barre
    const pid = 'icmSeg' + Math.random().toString(36).slice(2, 7);
    const pat = (id, col) => { const p = el('pattern', { id, width: 3, height: 10, patternUnits: 'userSpaceOnUse' }, m); el('rect', { x: 0, y: 0, width: 2, height: 10, style: 'fill:' + col }, p); };
    pat(pid + 'o', '#2f3a4c'); pat(pid + 'b', '#38b6ff'); pat(pid + 'r', '#ff3b30'); pat(pid + 'w', '#e6e9ef');
    LCD.icmPid = pid;
    const bar = (key, y, lab, ticks, x0, x1, kind, col) => {
      el('text', { x: x0 - 8, y: y + 9, class: 'icm-lab big', 'text-anchor': 'end' }, m, lab);
      el('rect', { x: x0, y, width: x1 - x0, height: 10, style: 'fill:url(#' + pid + 'o)' }, m);
      const f = el('rect', { x: x0, y, width: 0, height: 10, style: 'fill:url(#' + pid + col + ')' }, m);
      if (kind === 'alc') el('rect', { x: x0, y: y + 12, width: (x1 - x0) * 0.52, height: 2.5, class: 'icm-rline' }, m);
      if (kind === 'on') {
        // COMP : chiffres sur la barre, comme sur le TRX
        for (const [fr, t] of ticks) {
          const tx = x0 + fr * (x1 - x0), w = t.length * 8 + 6, cx = Math.min(x1 - w / 2, Math.max(x0 + w / 2, tx));
          el('rect', { x: cx - w / 2, y: y - 2, width: w, height: 14, class: 'icm-bg' }, m);
          el('text', { x: cx, y: y + 10, class: 'icm-num big', 'text-anchor': 'middle' }, m, t);
        }
      }
      if (kind === 'line' || kind === 'dots') {
        el('rect', { x: x0, y: y + 12, width: x1 - x0, height: 1.6, class: 'icm-wline' }, m);
        el('rect', { x: x0, y: y + 8, width: 1.6, height: 8, class: 'icm-wline' }, m);
        if (kind === 'dots') for (let i = 1; i < 25; i++) if (i % 5) el('circle', { cx: x0 + i / 25 * (x1 - x0) * 0.97, cy: y + 22, r: 1.3, class: 'icm-dot' }, m);
        for (const [fr, t] of ticks) {
          const tx = x0 + fr * (x1 - x0);
          if (t) el('text', { x: tx, y: y + 27, class: 'icm-num big', 'text-anchor': fr > 0.9 ? 'end' : 'middle' }, m, t); // un peu plus bas que le trait blanc
        }
      }
      bars[key] = { f, x0, x1 };
    };
    const L0 = X(70), L1 = X(390);
    const r0 = G.scopeY + IC_STRIP + 12; // sous la bande du scope
    bar('alc', Y(r0), 'ALC', [], L0, L1, 'alc', 'b');
    bar('comp', Y(r0 + 30), 'COMP', [[0.02, '0'], [0.2, '5'], [0.4, '10'], [0.6, '15'], [0.8, '20'], [0.97, 'dB']], L0, L1, 'on', 'b');
    bar('swr', Y(r0 + 56), 'SWR', [[0.15, '1.5'], [0.25, '2'], [0.35, '2.5'], [0.45, '3'], [1, '∞']], L0, L1, 'line', 'b');
    bar('id', Y(r0 + 90), 'Id', [[0.01, '0'], [0.194, '5'], [0.388, '10'], [0.582, '15'], [0.776, '20'], [1, '25A']], L0, L1, 'dots', 'b');
    // Cadres Vd et TEMP à droite (comme sur le TRX)
    // Comme sur le TRX : titre posé sur le coin haut gauche du cadre, échelle, barre en segments, trait blanc dessous avec la zone rouge
    // (Vd : tension basse à gauche ; TEMP : chaud à droite)
    const box = (key, y, lab, t0, t1, red, tip) => {
      const x0 = X(427), w = 163, h = 50, tw = lab.length * 9 + 8;
      el('path', { d: 'M' + (x0 + tw) + ' ' + y + 'H' + (x0 + w) + 'V' + (y + h) + 'H' + (x0 + 6) + 'V' + (y + 14), class: 'icm-box' }, m);
      el('text', { x: x0 - 3, y: y + 6, class: 'icm-lab big' }, m, lab);
      el('text', { x: x0 + 12, y: y + 24, class: 'icm-num big' }, m, t0);
      el('text', { x: x0 + w - 8, y: y + 24, class: 'icm-num big', 'text-anchor': 'end' }, m, t1);
      const bx = x0 + 14, bw = w - 28;
      el('rect', { x: bx, y: y + 28, width: bw, height: 10, style: 'fill:url(#' + pid + 'o)' }, m);
      const f = el('rect', { x: bx, y: y + 28, width: 0, height: 10, style: 'fill:url(#' + pid + 'b)' }, m);
      el('rect', { x: bx, y: y + 39.5, width: bw, height: 2, class: 'icm-wline' }, m);
      el('rect', { x: bx + bw * red[0], y: y + 39, width: bw * (red[1] - red[0]), height: 3, class: 'icm-rline' }, m);
      const hit = el('rect', { x: x0, y, width: w, height: h, class: 'hs' }, m);
      const t = el('title', {}, hit, tip);
      bars[key] = { f, x0: bx, x1: bx + bw, v: null, tt: t };
    };
    box('vd', Y(r0 - 2), 'Vd', '10', '16V', [0, 0.32], 'Vd : tension d’alimentation du TRX');
    // Température de l'ampli : l'IC-7300 ne l'envoie pas par le CI-V (section 19 du manuel : pas de commande de lecture) : barre vide
    box('temp', Y(r0 + 58), 'TEMP', 'COOL', 'HOT', [0.78, 1], 'TEMP : température de l’ampli — l’IC-7300 ne la transmet pas par le CAT (aucune commande CI-V), elle ne se voit que sur le TRX');
    LCD.icm = { g: m, bars, bg };
  }
  const IC_STRIP = 84; // IC-7300, écran des mesures : hauteur de la bande du scope au-dessus
  const IC_AUD_H = 198; // AUDIO SCOPE : bande du scope, titre, FFT et oscilloscope (dessinés dans la cascade) ; les touches dessous
  // ---- Écran KEYER (MENU → KEYER en CW) : mémoires M1 … M8 du manipulateur du TRX, comme sur l'IC-7300
  const KM = { cnt: Math.max(1, parseInt(store.get('rs.face.ic.cnt', '1'), 10) || 1), readAt: 0 };
  function kmRefresh() {
    // Contenu des mémoires relu sur le TRX (1A 02), une par une ; seulement pour celui qui a la main
    if (!iControl() || Date.now() - KM.readAt < 3000) return;
    KM.readAt = Date.now();
    for (let ch = 1; ch <= 8; ch++) setTimeout(() => send({ t: 'set', ctl: 'kmRead', value: ch }), ch * 140);
  }
  function kmText(ch) { const t = S()['km' + ch]; return typeof t === 'string' ? t : null; }
  const cntTxt = () => String(KM.cnt).padStart(3, '0');
  function kmSend(ch) {
    if (!needControl()) return;
    const t = kmText(ch);
    if (t == null) { kmRefresh(); return say('M' + ch + ' : contenu pas encore relu sur le TRX, réessayez dans un instant.', 'warn', 3500); }
    if (!t.trim()) return say('M' + ch + ' : mémoire vide (elle se remplit sur le TRX : KEYER → EDIT/SET).', '', 4000);
    // « * » : numéro de concours (compté après l'envoi, comme sur le TRX)
    const txt = t.replace(/\*/g, cntTxt());
    send({ t: 'cw', text: txt, wpm: Number(S().keySpeed) || Number(store.get('cwspeed', '22')) || 22 });
    if (t.indexOf('*') >= 0) { KM.cnt = Math.min(9999, KM.cnt + 1); store.set('rs.face.ic.cnt', String(KM.cnt)); }
    say('KEYER M' + ch + ' : « ' + txt + ' »', '', 3000);
  }
  function lcdBtn(m, X, Y, x, y, w, h, cls) {
    const r = el('rect', { x: X(x), y: Y(y), width: w, height: h, rx: 4, class: 'ick-btn ' + (cls || '') }, m);
    const t1 = el('text', { x: X(x + w / 2), y: Y(y + h / 2 - 2), class: 'ick-t1', 'text-anchor': 'middle' }, m, '');
    const t2 = el('text', { x: X(x + w / 2), y: Y(y + h - 9), class: 'ick-t2', 'text-anchor': 'middle' }, m, '');
    const hit = el('rect', { x: X(x), y: Y(y), width: w, height: h, class: 'hs lcd-hit' }, m);
    const tt = el('title', {}, hit, '');
    return { r, t1, t2, hit, tt };
  }
  function lcdOverlay(g, cls) {
    const m = el('g', { class: cls, style: 'display:none' }, g);
    // Sous les tableaux (MENU, QUICK…) : juste après le scope dans l'ordre de dessin
    const at = LCD.hint && LCD.hint.nextSibling;
    if (at) g.insertBefore(m, at);
    return m;
  }
  function buildIcKeyer(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = LCD.icKeyer = lcdOverlay(g, 'ick');
    const y0 = G.scopeY + IC_STRIP;
    el('rect', { x: X(5), y: Y(y0), width: c.w - 10, height: c.h - y0 - 4, class: 'icm-bg' }, m);
    el('text', { x: X(c.w / 2), y: Y(y0 + 15), class: 'ick-title', 'text-anchor': 'middle' }, m, 'KEYER');
    const bw = (c.w - 20) / 5, by = y0 + 21, bh = (c.h - by - 8) / 2;
    const btns = [];
    for (let i = 0; i < 10; i++) {
      const col = i % 5, row = Math.floor(i / 5);
      const b = lcdBtn(m, X, Y, 10 + col * bw + 2, by + row * bh + 2, bw - 4, bh - 4, col === 4 ? 'dark' : '');
      if (col < 4) {
        const ch = row * 4 + col + 1;
        b.t1.textContent = 'M' + ch;
        b.tt.textContent = 'M' + ch + ' : émet le contenu de la mémoire du manipulateur du TRX (« * » = numéro de concours)';
        b.hit.addEventListener('click', (ev) => { ev.stopPropagation(); kmSend(ch); });
        b.ch = ch;
      } else if (row === 0) {
        b.t1.textContent = 'EDIT/'; b.t2.textContent = 'SET'; b.t2.classList.add('big');
        b.tt.textContent = 'EDIT/SET : les mémoires se modifient sur le TRX';
        b.hit.addEventListener('click', (ev) => { ev.stopPropagation(); say('EDIT/SET : les mémoires M1 … M8 se modifient sur le TRX, au club (KEYER → EDIT/SET). Pour un texte libre : onglet CW des modes numériques.', '', 6000); });
      } else {
        b.t1.textContent = '-1'; b.cnt = true;
        b.tt.textContent = 'Numéro de concours (« * » dans une mémoire) : clic = −1';
        b.hit.addEventListener('click', (ev) => { ev.stopPropagation(); KM.cnt = Math.max(1, KM.cnt - 1); store.set('rs.face.ic.cnt', String(KM.cnt)); render(); });
      }
      btns.push(b);
    }
    LCD.ickBtns = btns;
  }
  function drawIcKeyer(s) {
    for (const b of LCD.ickBtns || []) {
      if (b.ch) {
        const t = kmText(b.ch);
        // Texte de la mémoire sous M1… (le début, comme sur le TRX), « * » montré tel quel
        b.t2.textContent = t == null ? '…' : t.length > 11 ? t.slice(0, 10) + '…' : t;
        b.r.classList.toggle('empty', t != null && !t.trim());
        b.r.classList.toggle('busy', !!(s.cw || S().cw));
      } else if (b.cnt) b.t2.textContent = cntTxt();
    }
  }
  // ---- Écrans sous la bande du scope : bandeau de titre + contenu (VOICE TX, SWR GRAPH, SCAN), comme sur l'IC-7300
  const IC_TB = 18, IC_SCOPE_H = 192; // touches <1> / <2> tout en bas de l'écran, le scope prend la place
  // Grande fréquence (M.SCOPE) avec le SPECTRUM SCOPE : bandeau à 188, scope de 80, touches à 288 (comme sur le TRX)
  const IC_BIG_TB = 188, IC_BIG_SC = 80;
  // EXPD/SET : bandeau remonté sous la fréquence (à 84), scope jusqu'aux touches
  const IC_EXP_TB = 84; // SCOPE : bandeau « SPECTRUM SCOPE », puis le scope ; ses touches dessous
  function icPanel(g, c, key, title) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = LCD[key] = lcdOverlay(g, 'icp');
    const y0 = G.scopeY + IC_STRIP;
    el('rect', { x: X(5), y: Y(y0), width: c.w - 10, height: c.h - y0 - 4, class: 'icm-bg' }, m);
    el('rect', { x: X(5), y: Y(y0 + 1), width: c.w - 10, height: 18, class: 'icp-tb' }, m);
    el('text', { x: X(c.w / 2), y: Y(y0 + 15), class: 'ick-title', 'text-anchor': 'middle' }, m, title);
    return { m, X, Y, y0: y0 + 21 };
  }
  function keyRow(m, X, Y, c, y0, keys) {
    const bw = (c.w - 12) / keys.length, h = c.h - y0 - 5;
    return keys.map(([lab, tip, fn, longFn], i) => {
      const b = lcdBtn(m, X, Y, 6 + i * bw + 2, y0, bw - 4, h, 'key');
      b.t1.textContent = lab; b.t1.setAttribute('y', Y(y0 + h / 2 + 6)); b.t1.classList.add('key');
      b.tt.textContent = tip;
      // Appui long (0,8 s), comme le toucher prolongé de l'écran du TRX : action longFn(i) si elle existe pour cette touche
      let lt = null, longDone = false;
      b.hit.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); longDone = false; clearTimeout(lt); lt = setTimeout(() => { if (longFn && longFn(i)) { longDone = true; WF.drawn = false; render(); } }, 800); });
      for (const t of ['pointerup', 'pointerleave', 'pointercancel']) b.hit.addEventListener(t, () => clearTimeout(lt));
      b.hit.addEventListener('click', (ev) => { ev.stopPropagation(); if (longDone) { longDone = false; return; } fn(); WF.drawn = false; render(); });
      return b;
    });
  }
  // SCOPE (MENU → SCOPE) : bandeau SPECTRUM SCOPE (HOLD, vitesse, CENTER, Grid, échelle), le scope, touches <1> SPAN HOLD CENT/FIX EXPD/SET
  function buildIcScope(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m0 = LCD.icScope = lcdOverlay(g, 'icsc');
    // Bandeau et touches en deux groupes : avec la grande fréquence (M.SCOPE), le bandeau descend et les touches remontent
    let m = LCD.iscTbG = el('g', {}, m0);
    const y0 = G.scopeY;
    el('rect', { x: X(5), y: Y(y0), width: c.w - 10, height: IC_TB, class: 'icp-tb' }, m);
    const pill = (x, w, t, cls) => { const r = el('rect', { x: X(x), y: Y(y0 + 3), width: w, height: IC_TB - 6, rx: 6, class: 'icp-pill ' + (cls || '') }, m); const tt = el('text', { x: X(x + w / 2), y: Y(y0 + 13), class: 'icp-pillt ' + (cls || ''), 'text-anchor': 'middle' }, m, t); return { r, t: tt }; };
    LCD.iscR = pill(10, 16, 'R'); LCD.iscT = pill(28, 16, 'T');
    LCD.iscHold = pill(48, 44, 'HOLD');
    LCD.iscSpd = el('text', { x: X(98), y: Y(y0 + 14), class: 'icp-spd' }, m, '▸▸▸');
    el('text', { x: X(250), y: Y(y0 + 15), class: 'ick-title', 'text-anchor': 'middle' }, m, 'SPECTRUM SCOPE');
    LCD.iscMode = pill(372, 62, 'CENTER', 'blue');
    el('text', { x: X(448), y: Y(y0 + 14), class: 'icp-tx' }, m, 'Grid');
    LCD.iscScale = el('text', { x: X(592), y: Y(y0 + 14), class: 'icp-tx', 'text-anchor': 'end' }, m, '');
    const ky = G.scopeY + IC_TB + IC_SCOPE_H + 2;
    m = LCD.iscKG = el('g', {}, m0);
    el('rect', { x: X(5), y: Y(ky - 2), width: c.w - 10, height: c.h - ky - 2, class: 'icm-bg' }, m);
    // Deux pages de touches, comme sur le TRX : <1> SPAN HOLD CENT/FIX EXPD/SET, puis <2> REF SPEED MARKER EXPD/SET
    LCD.iscPages = [[
      ['<1>', '<1> : touches suivantes (REF, SPEED, MARKER)', () => { L.iscPage = 1; }],
      ['SPAN', 'SPAN du scope du TRX : ±2,5k → 5k → 10k → 25k → 50k → 100k → 250k → 500k ; en FIX : EDGE 1 → 2 → 3 → 4',
        () => { const s2 = S(); if (s2.scMode === 1 || s2.scMode === 3) return setCtl('scEdge', (s2.scEdge || 1) % 4 + 1); const sp = s2.scSpan; setCtl('scSpan', sp == null ? 3 : (sp + 1) % 8); }],
      ['HOLD', 'HOLD : fige le scope (celui du TRX et celui de la page) ; le grand bouton déplace alors le trait vert de la fréquence de réception', () => { L.hold = !L.hold; L.holdAt = Date.now(); if (R.CONTROL.scHold) setCtl('scHold', L.hold ? 1 : 0); }],
      ['CENT/FIX', 'CENT/FIX : scope du TRX centré sur la fréquence (CENTER) ou bords fixes (FIX) ; appui long : défilement (SCROLL-C / SCROLL-F)', () => setCtl('scMode', (S().scMode || 0) ^ 1)],
      ['EXPD/SET', 'EXPD/SET : scope agrandi (la fréquence remonte à côté du S/Po) ; nouveau clic : normal', () => iscExpand()]
    ], [
      ['<2>', '<2> : retour aux premières touches (SPAN, HOLD, CENT/FIX)', () => { L.iscPage = 0; }],
      ['REF', 'REF : niveau de référence du scope du TRX (−20 … +20 dB, au grand bouton ou à la molette) ; nouveau clic : fin', () => { L.iscRef = true; L.iscPage = 2; }],
      ['SPEED', 'SPEED du scope du TRX : SLOW → MID → FAST', () => {
        const sp = S().scSpeed != null ? S().scSpeed : 1, nx = sp === 2 ? 1 : sp === 1 ? 0 : 2; // 02 SLOW, 01 MID, 00 FAST
        setCtl('scSpeed', nx); L.wfSpeed = [4, 2, 0][nx]; store.set('rs.face.wfspd5', L.wfSpeed); ssSend('Spd');
      }],
      ['MARKER', 'MARKER : repère d’émission (T) et bande passante du filtre sur le scope', () => { L.marker = !L.marker; store.set('rs.face.marker', L.marker ? '1' : '0'); ssSend('Marker'); }],
      ['EXPD/SET', 'EXPD/SET : scope agrandi ; nouveau clic : normal', () => iscExpand()]
    ], [
      // REF Level : le grand bouton (ou la molette) règle le niveau ; REF : fin, DEF : 0 dB
      ['', '', () => {}],
      ['REF', 'REF : fin du réglage (retour aux touches <2>)', () => { L.iscRef = false; L.iscPage = 1; }],
      ['DEF', 'DEF : REF à 0 dB', () => refSet(0)],
      ['', '', () => {}],
      ['', '', () => {}]
    ]];
    L.iscPage = 0;
    // Appui long sur CENT/FIX (page 1) : CENTER ⇄ SCROLL-C, FIX ⇄ SCROLL-F
    LCD.iscBtns = keyRow(m, X, Y, c, ky, [0, 1, 2, 3, 4].map((i) => ['', '', () => LCD.iscPages[L.iscPage][i][2](),
      (j) => {
        // Appui long sur EXPD/SET (lignes <1> et <2>) : SCOPE SET, comme sur le TRX
        if (j === 4 && L.iscPage !== 2) { L.icSet = true; L.icSub = 'scope'; L.icSubP = 0; subRead(); return true; }
        if (L.iscPage || j !== 3) return false; setCtl('scMode', (S().scMode || 0) ^ 2); return true;
      }]));
  }
  // ---- Vrai scope du TRX (IC-7300, CI-V 27 00 relayé par la page Station et le serveur) : 475 points de 0 à 160 par image
  const RFS = { at: 0, d: null, m: 0, f0: 0, f1: 0, last: null };
  const rfFresh = () => ICOM && Date.now() - RFS.at < 2500;
  function scopeSub(on) { if (me) send({ t: 'scope_sub', on: !!on }); }
  if (ICOM) {
    setInterval(() => { if (document.visibilityState === 'visible') scopeSub(true); }, 20000);
    document.addEventListener('visibilitychange', () => scopeSub(document.visibilityState === 'visible'));
  }
  function rfsOn(m) {
    let bin;
    try { bin = atob(m.d || ''); } catch (e) { return; }
    const d = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) d[i] = bin.charCodeAt(i);
    RFS.at = Date.now(); RFS.d = d; RFS.m = m.m; RFS.f0 = m.f0; RFS.f1 = m.f1; RFS.oor = m.oor;
    const cv = $('scope');
    if (!cv || cv.style.visibility === 'hidden' || L.hold) return;
    const c2 = cv.getContext('2d'), r = cv.getBoundingClientRect();
    const W = Math.max(50, Math.round(r.width)), H = Math.max(40, Math.round(r.height));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; WF.drawn = false; }
    if (!WF.drawn) { c2.fillStyle = '#000'; c2.fillRect(0, 0, W, H); WF.drawn = true; }
    // AUDIO SCOPE : le scope du TRX dans la bande du haut ; ailleurs : toute la hauteur de la cascade
    if (L.icView === 'audio' && AUD.exp) { RFS.last = { m: RFS.m, f0: RFS.f0, f1: RFS.f1 }; return; } // AUDIO SCOPE agrandi : pas de bande du scope
    const h = L.icView === 'audio' ? Math.round(H * IC_STRIP / IC_AUD_H) : H;
    drawRf(c2, 0, 0, W, h, RFS);
    RFS.last = { m: RFS.m, f0: RFS.f0, f1: RFS.f1 };
  }
  // Pas de la grille en FIX : largeur / 14, arrondi à 1 – 2 – 2,5 – 5 × 10ⁿ
  function rfGrid(span) { const raw = span / 14, p10 = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map((m) => m * p10).find((v) => v >= raw * 0.999) || 10 * p10; }
  // Clic sur le vrai scope : le VFO va sur la fréquence cliquée (comme en touchant l'écran du TRX) ; au survol, la fréquence sous la souris
  function rfFreqAt(ev) {
    const cv = $('scope'), r = cv.getBoundingClientRect(), f = RFS.last;
    if (!f || !r.width) return null;
    if (L.icView === 'audio' && AUD.exp) return null;
    const hRf = L.icView === 'audio' ? r.height * IC_STRIP / IC_AUD_H : r.height; // AUDIO SCOPE : seulement la bande du haut
    if (ev.clientY - r.top > hRf - 15) return null; // pas sur la ligne des chiffres
    const [lo, hi] = rfEdges(f), x = (ev.clientX - r.left) / r.width;
    if (!(x >= 0 && x <= 1)) return null;
    const st = /^CW/.test(L.activeMode(S()) || '') ? 10 : 100;
    return Math.round((lo + x * (hi - lo)) / st) * st;
  }
  if (ICOM) {
    const cv0 = $('scope');
    cv0.addEventListener('click', (ev) => {
      if (!rfFresh()) return;
      const hz = rfFreqAt(ev);
      if (hz == null || !needControl()) return;
      tuneTo(activeSide(), hz);
      showTip(ev, (hz / 1e6).toFixed(hz % 1000 ? 4 : 3) + ' MHz');
    });
    cv0.addEventListener('mousemove', (ev) => { if (!rfFresh()) return; const hz = rfFreqAt(ev); cv0.title = hz == null ? '' : 'Clic : ' + (hz / 1e6).toFixed(4) + ' MHz'; });
  }
  // Bornes affichées : CENTER = fréquence centrale ± SPAN ; FIX = bords bas et haut
  // Mode de l'image : 0 CENTER, 1 FIX, 2 SCROLL-C, 3 SCROLL-F ; FIX et SCROLL-F = bords bas / haut, sinon centre ± SPAN
  const rfFix = (f) => (f.m & 1) === 1;
  const rfEdges = (f) => (rfFix(f) ? [f.f0, f.f1] : [f.f0 - f.f1, f.f0 + f.f1]);
  function drawRf(c2, x0, y0, w, h, f) {
    const d = f.d, n = d.length, lab = 15, sh = Math.round((h - lab) * (h < 120 ? 0.5 : 0.42)), wh = h - lab - sh;
    const pal = PALS[L.wfColor] || PALS[1];
    // Cascade : descend d'une ligne, nouvelle ligne en haut (couleurs de la palette choisie)
    if (wh > 2) c2.drawImage(c2.canvas, x0, y0 + sh, w, wh - 1, x0, y0 + sh + 1, w, wh - 1);
    const col = new Float32Array(w);
    for (let px = 0; px < w; px++) {
      const i0 = Math.floor(px / w * n), i1 = Math.max(i0 + 1, Math.floor((px + 1) / w * n));
      let m = 0;
      for (let i = i0; i < i1 && i < n; i++) if (d[i] > m) m = d[i];
      col[px] = m / 160;
    }
    if (wh > 1) {
      const img = c2.createImageData(w, 1);
      for (let px = 0; px < w; px++) {
        const v = Math.max(0, Math.min(1, (col[px] - 0.12) * 1.6)), c = pal[Math.min(255, Math.round(v * 255))];
        img.data[px * 4] = c[0]; img.data[px * 4 + 1] = c[1]; img.data[px * 4 + 2] = c[2]; img.data[px * 4 + 3] = 255;
      }
      c2.putImageData(img, x0, y0 + sh);
    }
    // Spectre : fond, grille de 10 divisions, courbe remplie (bleu clair, comme sur le TRX)
    c2.fillStyle = '#0b1020'; c2.fillRect(x0, y0, w, sh);
    c2.strokeStyle = 'rgba(150,160,175,.45)'; c2.lineWidth = 1;
    const [glo, ghi] = rfEdges(f);
    if (rfFix(f)) {
      // FIX : grille tous les « pas » du TRX (largeur du bord / 14 arrondie : 14,000–14,350 → 25 kHz, comme « 25k/10dB »)
      const st = rfGrid(ghi - glo);
      for (let hz = Math.ceil(glo / st) * st; hz < ghi; hz += st) { const gx = Math.round(x0 + (hz - glo) / (ghi - glo) * w) + 0.5; c2.beginPath(); c2.moveTo(gx, y0); c2.lineTo(gx, y0 + sh); c2.stroke(); }
    } else for (let k = 1; k < 10; k++) { const gx = Math.round(x0 + w * k / 10) + 0.5; c2.beginPath(); c2.moveTo(gx, y0); c2.lineTo(gx, y0 + sh); c2.stroke(); }
    for (let k = 1; k < 5; k++) { const gy = Math.round(y0 + sh * k / 5) + 0.5; c2.beginPath(); c2.moveTo(x0, gy); c2.lineTo(x0 + w, gy); c2.stroke(); }
    c2.beginPath(); c2.moveTo(x0, y0 + sh);
    for (let px = 0; px < w; px++) c2.lineTo(x0 + px + 0.5, y0 + sh - Math.min(1, col[px]) * (sh - 2));
    c2.lineTo(x0 + w, y0 + sh); c2.closePath();
    c2.fillStyle = 'rgba(190,215,255,.85)'; c2.fill();
    c2.strokeStyle = '#4f9cff'; c2.stroke();
    // Repères : CENTER → trait blanc au milieu ; FIX → trait vert (R) à la fréquence de réception ; MARKER → trait orange (T) à la fréquence d'émission
    const s = S(), [lo, hi] = rfEdges(f), xf = (hz) => x0 + (hz - lo) / (hi - lo) * w;
    const rx = activeSide() === 'B' ? s.freqB : s.freq, tx = s.split ? (activeSide() === 'B' ? s.freq : s.freqB) : rx;
    const vline = (x, color, wd) => { if (x < x0 || x > x0 + w) return; c2.strokeStyle = color; c2.lineWidth = wd; c2.beginPath(); c2.moveTo(Math.round(x) + 0.5, y0); c2.lineTo(Math.round(x) + 0.5, y0 + sh); c2.stroke(); c2.lineWidth = 1; };
    if (rfFix(f)) { if (rx) vline(xf(rx), '#3ddc5a', 2); } else vline(x0 + w / 2, '#ffffff', 1.5);
    if (L.marker && tx) { vline(xf(tx), '#ff8a1f', 1.5); c2.fillStyle = '#ff8a1f'; const xt = xf(tx); if (xt >= x0 && xt <= x0 + w) { c2.beginPath(); c2.moveTo(xt - 4, y0); c2.lineTo(xt + 4, y0); c2.lineTo(xt, y0 + 6); c2.fill(); } }
    // Échelle : en CENTER, écart en kHz (−2.0 … 0 … +2.0, −200 … +200) ; en FIX, fréquences en MHz ; bornes en haut des coins
    c2.fillStyle = '#000'; c2.fillRect(x0, y0 + h - lab, w, lab);
    c2.fillStyle = '#ffffff'; c2.font = 'bold 13px Arial, sans-serif'; c2.textAlign = 'center';
    // Décimales selon le SPAN (comme le TRX) : ±2,5k → −2.0 … +2.0 ; ±5k et plus → nombres entiers (−4 … +4, −20 … +20, −200 … +200)
    const dec = f.f1 < 5000 ? 1 : 0;
    const kfmt = (hz, d2) => { const k = hz / 1000, a = Math.abs(k); return (k > 0 ? '+' : k < 0 ? '-' : '') + (a === 0 ? '0' : a.toFixed(d2 == null ? dec : d2)); };
    if (!rfFix(f)) {
      for (let k = 1; k < 10; k++) c2.fillText(kfmt(-f.f1 + k * 2 * f.f1 / 10), x0 + w * k / 10, y0 + h - 3);
    } else {
      const span = hi - lo, raw = span / 7, p10 = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 5, 10].map((m) => m * p10).find((v) => v >= raw) || 10 * p10;
      for (let hz = Math.ceil(lo / st) * st; hz < hi; hz += st) if (hz > lo + st * 0.3) c2.fillText((hz / 1e6).toFixed(st >= 10000 ? 2 : 3), xf(hz), y0 + h - 3);
    }
    if (sh > 30) {
      c2.font = 'bold 12px Arial, sans-serif';
      const ek = f.f1 % 1000 ? 1 : 0; // bornes : −2.5k, −25k, −250k
      // FIX : 14.000 ; SCROLL-F : 14.050.0 (avec les centaines de Hz, comme sur le TRX)
      const edf = (hz) => (f.m === 3 ? (Math.floor(hz / 1000) / 1000).toFixed(3) + '.' + Math.floor(hz % 1000 / 100) : (hz / 1e6).toFixed(3));
      c2.textAlign = 'left'; c2.fillText(rfFix(f) ? edf(lo) : kfmt(-f.f1, ek) + 'k', x0 + 3, y0 + 13);
      c2.textAlign = 'right'; c2.fillText(rfFix(f) ? edf(hi) : kfmt(f.f1, ek) + 'k', x0 + w - 3, y0 + 13);
    }
    if (f.oor) { c2.fillStyle = '#ff8a1f'; c2.textAlign = 'center'; c2.fillText('OUT OF RANGE', x0 + w / 2, y0 + sh / 2); }
    // FIX : « << » / « >> » quand la fréquence de réception sort des bords (comme sur le TRX)
    if (rfFix(f) && rx && (rx < lo || rx > hi)) {
      c2.fillStyle = '#3ddc5a'; c2.font = 'bold 12px Arial, sans-serif'; // petit « >> » vert, comme sur le TRX
      c2.textAlign = rx < lo ? 'left' : 'right';
      c2.fillText(rx < lo ? '<<' : '>>', rx < lo ? x0 + 3 : x0 + w - 3, y0 + (sh > 30 ? 30 : 14));
    }
  }
  // HOLD : trait vert de la fréquence de réception sur le spectre figé ; le grand bouton le déplace (la fréquence du TRX suit),
  // HOLD relâché : le spectre repart et le trait disparaît (comme sur l'IC-7300)
  function holdMarker() {
    const cv = $('scope');
    if (!cv) return;
    let mk = $('holdMk');
    if (!mk) { mk = document.createElement('div'); mk.id = 'holdMk'; mk.className = 'fc-holdmk'; cv.parentNode.appendChild(mk); }
    const s = S(), on = ICOM && L.hold && L.icView === 'scope' && cv.style.visibility !== 'hidden';
    const f = activeSide() === 'B' ? s.freqB : s.freq;
    if (!on || !f) { mk.hidden = true; L.holdF = null; return; }
    if (L.holdF == null) L.holdF = f; // fréquence au moment du HOLD : le trait part du centre du filtre
    let frac;
    if (rfFresh() && RFS.last) {
      // Vrai scope du TRX : position sur l'image figée (bornes de la dernière image dessinée)
      const [lo, hi] = rfEdges(RFS.last);
      frac = (f - lo) / (hi - lo);
    } else {
      const ff = LCD.flt && LCD.flt.A, md = (ff && ff.mode) || L.activeMode(s) || '';
      const fc = ff ? audioCenter(md, ff.hz) + (ff.sh || 0) : 1500;
      const lsb = /^LSB$|-R$|LSB-D/.test(md) ? -1 : 1;
      frac = (fc + lsb * (f - L.holdF)) / fitHz('A');
    }
    if (!(frac >= 0 && frac <= 1)) { mk.hidden = true; return; } // hors de l'image figée
    const pct = (v) => parseFloat(v) || 0;
    mk.style.left = (pct(cv.style.left) + frac * pct(cv.style.width)) + '%';
    mk.style.top = cv.style.top; mk.style.height = cv.style.height;
    mk.hidden = false;
  }
  function iscExpand() { L.iscExp = !L.iscExp; if (L.iscExp) { L.iscBigWas = !!L.icBig; L.icBig = false; } else L.icBig = !!L.iscBigWas; WF.drawn = false; }
  function refSet(v) {
    v = Math.max(-20, Math.min(20, Math.round(v * 2) / 2));
    if (R.CONTROL.scRef) setCtl('scRef', v);
    L.refV = v; L.refAt = Date.now();
    L.wfLevel = v; store.set('rs.face.wflvl', v); ssSend('Level'); // la cascade de la page suit
    render();
  }
  // Grand bouton ou molette pendant REF Level : ±0,5 dB par cran
  function refTurn(notches) { const cur = Date.now() - (L.refAt || 0) < 3000 ? L.refV : S().scRef != null ? S().scRef : L.refV || 0; refSet(cur + notches * 0.5); }
  function drawIcScope() {
    if (!LCD.iscHold) return;
    // Cadre « REF Level » au milieu du scope tant que REF est ouvert
    const pe = $('icPop');
    if (pe && L.iscRef && L.icView === 'scope') {
      const v = Date.now() - (L.refAt || 0) < 3000 ? L.refV : S().scRef != null ? S().scRef : L.refV || 0;
      pe.querySelector('b').textContent = 'REF Level';
      pe.querySelector('span').textContent = (v > 0 ? '+' : v < 0 ? '−' : '±') + ' ' + Math.abs(v).toFixed(1) + 'dB';
      pe.style.fontSize = Math.max(9, Math.round($('facePanel').clientWidth / V.w * 15)) + 'px';
      pe.hidden = false; L.refPop = true; clearTimeout(icPopT);
    } else if (pe && L.refPop) { L.refPop = false; pe.hidden = true; }
    if (LCD.iscT) { LCD.iscT.r.classList.toggle('mk', !!L.marker); LCD.iscT.t.classList.toggle('on', !!L.marker); }
    LCD.iscHold.r.classList.toggle('on', !!L.hold); LCD.iscHold.t.classList.toggle('on', !!L.hold);
    LCD.iscSpd.textContent = S().scSpeed != null ? '▸'.repeat(3 - S().scSpeed) : '▸'.repeat(Math.max(1, Math.min(3, Math.ceil((L.wfSpeed + 1) * 3 / 5))));
    // Échelle du scope du TRX : 10 divisions sur ±SPAN (±25k → 5k/10dB, comme sur le TRX)
    const sp = S().scSpan, half = R.SC_SPANS && sp != null ? R.SC_SPANS[sp] : null;
    const div = half ? half / 5 : SPANS[L.wfSpan] / 8;
    LCD.iscScale.textContent = (half ? div / 1000 + 'k' : div >= 1000 ? div / 1000 + 'k' : Math.round(div)) + '/10dB'; // ±2,5k → 0.5k/10dB
    if (S().scHold != null && !!S().scHold !== !!L.hold && Date.now() - (L.holdAt || 0) > 3000) L.hold = !!S().scHold; // HOLD mis sur le TRX
    // CENTER (bleu), FIX (bleu), SCROLL-C / SCROLL-F (jaune) ; R vert hors CENTER, comme sur le TRX
    const md = S().scMode || 0, fix = md === 1 || md === 3;
    LCD.iscMode.t.textContent = ['CENTER', 'FIX', 'SCROLL-C', 'SCROLL-F'][md];
    LCD.iscMode.r.classList.toggle('scroll', md >= 2); LCD.iscMode.t.classList.toggle('scroll', md >= 2);
    LCD.iscR.r.classList.toggle('rx', md !== 0 || !!L.hold); LCD.iscR.t.classList.toggle('on', md !== 0 || !!L.hold);
    holdMarker();
    if (fix) {
      // FIX : pas de la grille du scope du TRX (largeur du bord / 14), sinon le n° du bord
      const lf = rfFresh() && rfFix(RFS) ? RFS : null, g2 = lf ? rfGrid(lf.f1 - lf.f0) : 0;
      LCD.iscScale.textContent = lf ? (g2 < 10000 ? (g2 / 1000).toFixed(1) : g2 / 1000) + 'k/10dB' : 'EDGE' + (S().scEdge || 1); // 5.0k, 10k, 25k (comme le TRX)
    }
    LCD.iscBtns.forEach((b, i) => {
      const k = LCD.iscPages[L.iscPage || 0][i].slice();
      if (!L.iscPage && i === 1 && fix) k[0] = 'EDGE';
      if (b.t1.textContent !== k[0]) { b.t1.textContent = k[0]; b.tt.textContent = k[1]; }
      b.r.classList.toggle('on', L.iscPage === 1 ? i === 3 && !!L.marker : L.iscPage === 2 ? i === 1 : i === 2 && !!L.hold);
      b.r.classList.toggle('blank', !k[0]);
    });
  }
  // VOICE TX (MENU → VOICE, en phonie) : T1 … T8, REC/SET, TX LEVEL
  function buildIcVoice(g, c) {
    const { m, X, Y, y0 } = icPanel(g, c, 'icVoice', 'VOICE TX');
    const bw = (c.w - 20) / 5, bh = (c.h - y0 - 8) / 2;
    for (let i = 0; i < 10; i++) {
      const col = i % 5, row = Math.floor(i / 5);
      const b = lcdBtn(m, X, Y, 10 + col * bw + 2, y0 + row * bh + 2, bw - 4, bh - 4, col === 4 ? 'dark' : '');
      b.t1.setAttribute('y', Y(y0 + row * bh + bh / 2 + 6));
      if (col < 4) {
        // Mémoires vocales de la page (l'IC-7300 garde les siennes sur une carte SD) : enregistrées au micro de l'opérateur,
        // gardées sur le serveur et émises en phonie par lui. Clic : une fois ; appui d'1 s : répétée (Repeat Time) ; clic pendant l'émission : arrêt
        const n = row * 4 + col + 1;
        b.t1.textContent = 'T' + n;
        b.t2.classList.add('vm-name');
        b.tt.textContent = 'T' + n + ' : émet votre mémoire vocale T' + n + ' ; appui d’1 s : répétée ; pendant l’émission, un clic l’arrête (REC/SET → REC pour l’enregistrer)';
        let lt = null, longDone = false;
        const play = (rep) => {
          if (VM.playing) { send({ t: 'vm_stop' }); return; }
          if (!needControl()) return;
          const t = VM.meta && VM.meta.t[n - 1];
          if (t && !t.ms) return say('T' + n + ' : mémoire vide — MENU → VOICE → REC/SET → REC pour l’enregistrer.', 'warn', 5000);
          send({ t: 'vm_play', n, rep: !!rep });
          if (rep) say('VOICE TX : T' + n + ' répétée toutes les ' + ((VM.meta && VM.meta.rep) || 5) + ' s (2 minutes au plus ; clic sur une touche T : arrêt).', '', 5000);
        };
        b.hit.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); longDone = false; clearTimeout(lt); lt = setTimeout(() => { longDone = true; if (!VM.playing) play(true); }, 1000); });
        for (const t of ['pointerup', 'pointerleave', 'pointercancel']) b.hit.addEventListener(t, () => clearTimeout(lt));
        b.hit.addEventListener('click', (ev) => { ev.stopPropagation(); if (longDone) { longDone = false; return; } play(false); });
        b.n = n;
        (LCD.ivKeys = LCD.ivKeys || [])[n] = b;
      } else {
        b.t1.setAttribute('y', Y(y0 + row * bh + bh / 2 - 2));
        b.t1.textContent = row ? 'TX' : 'REC/'; b.t2.textContent = row ? 'LEVEL' : 'SET'; b.t2.classList.add('big');
        b.tt.textContent = row ? 'TX LEVEL : niveau d’émission des mémoires vocales (grand bouton ou molette)' : 'REC/SET : REC (pas à distance) et SET (VOICE TX SET)';
        b.hit.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (row) { L.ivLvl = true; send({ t: 'vm_list' }); }
          else { L.icSet = true; L.icSub = 'vrec'; L.icSubP = 0; }
          render();
        });
      }
    }
    // Fenêtre TX LEVEL (sur T4 / T8 et les touches de droite, comme sur le TRX) : barre, %, DEF (50 %) et retour ; réglage au grand bouton ou à la molette
    const lx = 10 + 3 * bw + 2, lw = c.w - 10 - lx - 2, ly = y0 + 2, lh = 2 * bh - 4;
    const lg = LCD.ivLvlG = el('g', { style: 'display:none' }, m);
    el('rect', { x: X(lx), y: Y(ly), width: lw, height: lh, rx: 3, class: 'ivl-bg' }, lg);
    const bx = lx + 14, bwid = lw - 110;
    el('text', { x: X(bx + bwid / 2), y: Y(ly + lh * 0.36), class: 'ivl-ttl', 'text-anchor': 'middle' }, lg, 'TX LEVEL');
    el('rect', { x: X(bx), y: Y(ly + lh * 0.45), width: bwid, height: 12, rx: 2, class: 'ivl-track' }, lg);
    LCD.ivLvlF = el('rect', { x: X(bx + 1.5), y: Y(ly + lh * 0.45 + 1.5), width: 0, height: 9, class: 'ivl-fill' }, lg);
    LCD.ivLvlW = bwid - 3;
    LCD.ivLvlT = el('text', { x: X(bx + bwid / 2), y: Y(ly + lh * 0.8), class: 'ivl-pct', 'text-anchor': 'middle' }, lg, '');
    const wh = el('rect', { x: X(lx), y: Y(ly), width: lw - 90, height: lh, class: 'hs lcd-hit' }, lg);
    el('title', {}, wh, 'TX LEVEL : molette (ou grand bouton) pour régler');
    wh.addEventListener('wheel', (ev) => { ev.preventDefault(); ev.stopPropagation(); vlvlTurn(ev.deltaY < 0 ? 1 : -1); }, { passive: false });
    wh.addEventListener('click', (ev) => ev.stopPropagation());
    const kb = (yy, t, tip, fn) => {
      const b = lcdBtn(lg, X, Y, lx + lw - 84, yy, 78, lh / 2 - 6, 'dark');
      b.t1.textContent = t; b.t1.setAttribute('y', Y(yy + lh / 4 + 3)); b.tt.textContent = tip;
      b.hit.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); render(); });
      return b;
    };
    kb(ly + 4, 'DEF', 'DEF : TX LEVEL à 50 %', () => vlvlSet(128));
    const bk = kb(ly + lh / 2 + 2, '', 'Retour', () => { L.ivLvl = false; });
    const ax = X(lx + lw - 45), by = Y(ly + lh * 3 / 4 + 2);
    el('path', { d: 'M' + (ax + 12) + ' ' + (by - 7) + 'H' + (ax - 4) + 'A7 7 0 0 0 ' + (ax - 4) + ' ' + (by + 7) + 'H' + (ax + 6) + 'M' + (ax - 1) + ' ' + (by - 12) + 'L' + (ax - 7) + ' ' + (by - 7) + 'L' + (ax - 1) + ' ' + (by - 2), class: 'ic-back' }, lg);
    void bk;
  }
  // ---- Mémoires vocales de la page (VOICE TX) : état envoyé par le serveur (noms, durées, TX LEVEL, Auto Monitor, Repeat Time)
  const VM = { meta: null, playing: null, rec: null, last: {}, dl: null, src: null, ac: null };
  // TX LEVEL des mémoires vocales (0 – 255 = 0 – 100 %, 50 % = niveau de l'enregistrement) : 1 % par cran
  function vlvlRaw() { const p = L.vlvP; if (p && Date.now() - p.at < 3000) return p.v; return VM.meta ? VM.meta.level : null; }
  function vlvlSet(raw) {
    raw = Math.max(0, Math.min(255, Math.round(raw)));
    L.vlvP = { v: raw, at: Date.now() };
    clearTimeout(L.vlvT); L.vlvT = setTimeout(() => send({ t: 'vm_set', level: raw }), 150);
    render();
  }
  function vlvlTurn(n) { const v = vlvlRaw(); if (v == null) return; const p = Math.round(v * 100 / 255) + (n > 0 ? 1 : -1); vlvlSet(Math.round(Math.max(0, Math.min(100, p)) * 255 / 100)); }
  // Écoute d'une mémoire dans la page (▶ du VOICE TX RECORD)
  function vmListen(pcm) {
    vmListenStop();
    try {
      const ac = VM.ac = VM.ac || new AudioContext();
      const b = ac.createBuffer(1, pcm.length, 12000);
      b.copyToChannel(pcm, 0);
      const src = VM.src = ac.createBufferSource();
      src.buffer = b; src.connect(ac.destination);
      src.onended = () => { if (VM.src === src) { VM.src = null; render(); } };
      if (ac.state !== 'running') ac.resume().catch(() => {});
      src.start();
    } catch (e) { say('Écoute impossible dans ce navigateur : ' + e.message, 'warn', 4000); }
    render();
  }
  function vmListenStop() { if (VM.src) { try { VM.src.stop(); } catch (e) { /* */ } VM.src = null; } }
  function vmOnData(m) {
    if (!VM.dl || VM.dl.n !== m.n) VM.dl = { n: m.n, parts: [] };
    VM.dl.parts[m.i] = m.d;
    if (VM.dl.parts.filter(Boolean).length < m.total) return;
    const bin = atob(VM.dl.parts.join('')), u = new Uint8Array(bin.length + 1);
    u[0] = 0x03;
    for (let i = 0; i < bin.length; i++) u[i + 1] = bin.charCodeAt(i);
    VM.dl = null;
    if (!bin.length) return say('T' + m.n + ' : mémoire vide.', 'warn', 3000);
    const pcm = ULAW.decodeFrame(u);
    VM.last[m.n] = pcm;
    vmListen(pcm);
  }
  // Enregistrement : micro de la page (MICRO sous la face avant), 30 s au plus ; envoyé au serveur en morceaux de 36 ko
  const VM_MAXS = 30;
  function vmRecStart(n) {
    const V = window.RSVOICE;
    if (!V || !V.micOn()) return say('REC : mettez d’abord votre micro en service (bouton MICRO sous la face avant).', 'warn', 6000);
    if (S().tx || pttHeld) return say('REC : pas pendant une émission.', 'warn', 3000);
    vmListenStop();
    if (!V.recStart(12000 * VM_MAXS)) return;
    VM.rec = { n, t0: Date.now() };
    clearInterval(VM.recT);
    VM.recT = setInterval(() => { if (!VM.rec) return clearInterval(VM.recT); if (window.RSVOICE.recLen() >= 12000 * VM_MAXS) vmRecStop(); else render(); }, 100);
    render();
  }
  function vmRecStop() {
    const r = VM.rec;
    VM.rec = null; clearInterval(VM.recT);
    const pcm = window.RSVOICE && window.RSVOICE.recStop();
    if (!r || !pcm) return render();
    if (pcm.length < 6000) { render(); return say('REC : enregistrement trop court (0,5 s au moins).', 'warn', 3000); }
    VM.last[r.n] = pcm;
    const u = ULAW.encodeFrame(pcm, 12000, 0x05).subarray(1), CH = 36000, total = Math.ceil(u.length / CH);
    for (let i = 0; i < total; i++) {
      let s2 = '';
      const part = u.subarray(i * CH, (i + 1) * CH);
      for (let j = 0; j < part.length; j += 8192) s2 += String.fromCharCode.apply(null, part.subarray(j, j + 8192));
      send({ t: 'vm_put', n: r.n, i, total, d: btoa(s2) });
    }
    render();
  }
  function drawIcVoice(s) {
    for (const b of LCD.icVoice ? LCD.icVoice.querySelectorAll('.ick-btn') : []) b.classList.toggle('busy', !!s.tx && !VM.playing);
    for (let n = 1; n <= 8; n++) {
      const b = LCD.ivKeys && LCD.ivKeys[n];
      if (!b) continue;
      const t = VM.meta && VM.meta.t[n - 1];
      b.t2.textContent = t ? (t.name || (t.ms ? (t.ms / 1000).toFixed(1) + ' s' : '')) : '';
      b.t1.setAttribute('y', Number(b.r.getAttribute('y')) + Number(b.r.getAttribute('height')) / 2 + (b.t2.textContent ? 0 : 6));
      b.r.classList.toggle('on', !!VM.playing && VM.playing.n === n);
      b.r.classList.toggle('empty', !!t && !t.ms);
    }
    if (!LCD.ivLvlG) return;
    LCD.ivLvlG.style.display = L.ivLvl ? '' : 'none';
    const v = vlvlRaw();
    LCD.ivLvlF.setAttribute('width', v == null ? 0 : LCD.ivLvlW * v / 255);
    LCD.ivLvlT.textContent = v == null ? '…' : Math.round(v * 100 / 255) + '%';
  }
  // SWR GRAPH (MENU → SWR) : ROS relevé pendant les émissions (TUNE, porteuse, phonie…) à chaque fréquence, en barres
  const SWRG = { step: [10000, 50000, 100000, 500000], bar: [3, 5, 7, 9, 11, 13], /* comme le TRX : 10 / 50 / 100 / 500 kHz, 3 à 13 barres */ si: Math.max(0, Math.min(3, parseInt(store.get('rs.face.ic.swrs', '0'), 10) || 0)),
    bi: Math.max(0, Math.min(5, parseInt(store.get('rs.face.ic.swrb2', '1'), 10) || 0)), data: {}, center: null };
  try { SWRG.data = JSON.parse(store.get('rs.face.ic.swr', '{}')) || {}; } catch (e) { SWRG.data = {}; }
  function swrNote(s) {
    // En émission : ROS relu (15 12), gardé par tranche de 1 kHz (la plus forte valeur), pour le graphe SWR
    if (!ICOM || !s || !s.tx || !R.swrValue || s.m6 == null) return;
    const v = R.swrValue(s.m6), f = activeSide() === 'B' ? s.freqB : s.freq;
    if (v == null || !f || !(s.m5 > 10)) return; // assez de puissance pour que la mesure ait un sens
    const k = String(Math.round(f / 1000));
    if (!(SWRG.data[k] >= v - 0.05)) { SWRG.data[k] = Math.round(v * 100) / 100; SWRG.at = Date.now(); }
    SWRG.lastF = Number(k) * 1000; store.set('rs.face.ic.swrlast', String(SWRG.lastF));
    if (!SWRG.saveT) SWRG.saveT = setTimeout(() => { SWRG.saveT = null; store.set('rs.face.ic.swr', JSON.stringify(SWRG.data)); }, 3000);
  }
  function buildIcSwr(g, c) {
    const { m, X, Y, y0 } = icPanel(g, c, 'icSwr', 'SWR GRAPH');
    const bh = (c.h - y0 - 10) / 2;
    const side = (x, row, t1, t2, tip, fn) => {
      const b = lcdBtn(m, X, Y, x, y0 + 2 + row * (bh + 4), 106, bh, '');
      b.t1.textContent = t1; b.t2.textContent = t2; b.tt.textContent = tip; b.t2.classList.add('big'); // valeur (10k, 5…) en grand, comme sur le TRX
      b.hit.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); render(); });
      return b;
    };
    LCD.iswRecall = side(12, 0, 'RECALL', '', 'RECALL : graphe centré sur la fréquence du dernier ROS relevé (le VFO ne bouge pas) ; nouveau clic : le graphe suit de nouveau le VFO', () => {
      if (SWRG.recall) { SWRG.recall = null; return; }
      const ks = Object.keys(SWRG.data);
      if (!ks.length) return say('SWR GRAPH : pas encore de mesure (le ROS se relève pendant vos émissions).', '', 4000);
      SWRG.center = null; SWRG.recall = SWRG.lastF || Number(ks[ks.length - 1]) * 1000;
    });
    LCD.iswRecall.t2.classList.remove('big');
    const pp = side(12, 1, '▷ ■', '', 'Mesure automatique', () => say('Mesure automatique du ROS (émission pas à pas) : pas disponible à distance. Le graphe se remplit avec le ROS relevé pendant vos émissions (TUNE, porteuse…).', '', 6000));
    pp.t1.setAttribute('y', Y(y0 + 2 + bh + 4 + bh / 2 + 6));
    LCD.iswStep = side(482, 0, 'STEP', '', 'STEP : écart entre deux barres', () => { SWRG.si = (SWRG.si + 1) % SWRG.step.length; store.set('rs.face.ic.swrs', SWRG.si); });
    LCD.iswBar = side(482, 1, 'BAR', '', 'BAR : nombre de barres', () => { SWRG.bi = (SWRG.bi + 1) % SWRG.bar.length; store.set('rs.face.ic.swrb2', SWRG.bi); });
    // Graphe : 1.0 / 1.5 / 2.0 / 3.0 (comme le TRX), ligne rouge à 1.5
    const gx0 = 160, gx1 = 462, gy0 = y0 + 8, gy1 = c.h - 30;
    el('rect', { x: X(gx0), y: Y(gy0), width: gx1 - gx0, height: gy1 - gy0, class: 'isw-box' }, m);
    const yv = (v) => gy1 - (v <= 1.5 ? (v - 1) / 0.5 / 3 : v <= 2 ? 1 / 3 + (v - 1.5) / 0.5 / 3 : 2 / 3 + Math.min(1, (v - 2) / 1) / 3) * (gy1 - gy0);
    for (const [v, t] of [[3, '3.0'], [2, '2.0'], [1.5, '1.5'], [1, '1.0']]) {
      el('text', { x: X(gx0 - 4), y: Y(yv(v) + 4), class: 'isw-num', 'text-anchor': 'end' }, m, t);
      if (v > 1 && v < 3) el('line', { x1: X(gx0), y1: Y(yv(v)), x2: X(gx1), y2: Y(yv(v)), class: v === 1.5 ? 'isw-red' : 'isw-grid' }, m);
    }
    el('line', { x1: X((gx0 + gx1) / 2), y1: Y(gy0), x2: X((gx0 + gx1) / 2), y2: Y(gy1), class: 'isw-grid' }, m);
    LCD.iswBars = el('g', {}, m);
    LCD.iswNo = el('text', { x: X((gx0 + gx1) / 2), y: Y((gy0 + gy1) / 2 + 2), class: 'isw-no', 'text-anchor': 'middle' }, m, 'No data');
    LCD.iswTk = el('g', {}, m); // petits traits sous le graphe : une barre par trait
    LCD.iswF = [0, 1, 2].map((i) => el('text', { x: X(gx0 + 22 + i * (gx1 - gx0 - 44) / 2), y: Y(gy1 + 16), class: 'isw-num', 'text-anchor': 'middle' }, m, ''));
    LCD.iswG = { gx0, gx1, gy0, gy1, yv, X, Y };
  }
  function drawIcSwr(s) {
    const G2 = LCD.iswG;
    if (!G2) return;
    const step = SWRG.step[SWRG.si], nb = SWRG.bar[SWRG.bi], f0 = SWRG.recall || (activeSide() === 'B' ? s.freqB : s.freq) || 0;
    const center = SWRG.recall ? Math.round(f0 / step) * step : Math.floor(f0 / 1000) * 1000; // comme le TRX : fréquence au kHz au milieu (14.073 pour 14.073.70)
    LCD.iswStep.t2.textContent = step >= 1000 ? step / 1000 + 'k' : step; LCD.iswBar.t2.textContent = String(nb);
    const ks = Object.keys(SWRG.data);
    const lf = SWRG.lastF || Number(store.get('rs.face.ic.swrlast', '0')) || (ks.length ? Number(ks[ks.length - 1]) * 1000 : 0);
    SWRG.lastF = lf;
    LCD.iswRecall.t2.textContent = ks.length && lf ? fmtF3(lf) : '--.---.--';
    LCD.iswRecall.r.classList.toggle('on', !!SWRG.recall); // RECALL en service : le graphe ne suit plus le VFO
    const { gx0, gx1, gy1, yv, X, Y } = G2, w = (gx1 - gx0 - 44) / Math.max(1, nb - 1);
    let html = '', any = false;
    for (let i = 0; i < nb; i++) {
      const f = center + (i - (nb - 1) / 2) * step;
      let v = null;
      for (const k of ks) if (Math.abs(Number(k) * 1000 - f) <= step / 2 && !(v >= SWRG.data[k])) v = SWRG.data[k];
      if (v == null) continue;
      any = true;
      const x = X(gx0 + 22 + i * w), y = Y(yv(Math.max(1, Math.min(3, v))));
      html += '<rect x="' + (x - Math.min(10, w * 0.3)) + '" y="' + y + '" width="' + Math.min(20, w * 0.6) + '" height="' + (Y(gy1) - y) + '" class="isw-bar' + (v > 1.5 ? ' hi' : '') + '"/>';
    }
    if (LCD.iswBars.dataset.h !== html) { LCD.iswBars.innerHTML = html; LCD.iswBars.dataset.h = html; }
    if (LCD.iswTk.dataset.n !== String(nb)) {
      LCD.iswTk.dataset.n = String(nb);
      LCD.iswTk.innerHTML = Array.from({ length: nb }, (_, i) => '<line x1="' + X(gx0 + 22 + i * w) + '" y1="' + Y(gy1) + '" x2="' + X(gx0 + 22 + i * w) + '" y2="' + Y(gy1 + 5) + '" class="isw-tick"/>').join('');
    }
    LCD.iswNo.style.display = any ? 'none' : '';
    const half = (nb - 1) / 2 * step;
    [center - half, center, center + half].forEach((f, i) => { LCD.iswF[i].textContent = (f / 1e6).toFixed(3); });
  }
  const fmtF3 = (f) => Math.floor(f / 1e6) + '.' + String(Math.floor(f / 1000) % 1000).padStart(3, '0') + '.' + String(Math.floor(f / 10) % 100).padStart(2, '0');
  // SCAN (MENU → SCAN) : PROGRAM (P1 – P2 des mémoires du TRX) ou ΔF (± plage autour de la fréquence) ; FINE ; réception seulement
  const SCAN = { on: 0, fine: false, span: Math.max(1, Math.min(7, parseInt(store.get('rs.face.ic.dfspan', '2'), 10) || 2)), last: null };
  const DF_TXT = ['', '5 kHz', '10 kHz', '20 kHz', '50 kHz', '100 kHz', '500 kHz', '1 MHz'];
  function scanStart(kind) {
    if (!needControl()) return;
    if (SCAN.on) { setCtl('scan', 0); SCAN.on = 0; return say('SCAN arrêté.', '', 2500); }
    const f = activeSide() === 'B' ? S().freqB : S().freq;
    SCAN.last = f;
    SCAN.on = kind === 'prog' ? (SCAN.fine ? 3 : 1) : (SCAN.fine ? 4 : 2);
    if (kind === 'df') setCtl('dfSpan', SCAN.span);
    setTimeout(() => setCtl('scan', SCAN.on), kind === 'df' ? 120 : 0);
    say('SCAN ' + (kind === 'prog' ? 'PROGRAM' : 'ΔF ±' + DF_TXT[SCAN.span]) + (SCAN.fine ? ' (FINE)' : '') + ' : en cours — nouveau clic sur PROG ou ΔF : arrêt.', '', 4000);
  }
  function buildIcScan(g, c) {
    const { m, X, Y, y0 } = icPanel(g, c, 'icScan', 'SCAN');
    const by = c.h - 46, bx0 = 30, bx1 = 410, rh = 20, top = by - 2 * rh - 8;
    el('rect', { x: X(bx0), y: Y(top), width: bx1 - bx0, height: 2 * rh, class: 'isw-box' }, m);
    el('line', { x1: X(bx0), y1: Y(top + rh), x2: X(bx1), y2: Y(top + rh), class: 'isw-grid' }, m);
    LCD.iscnP = el('rect', { x: X(bx0 + 1), y: Y(top + 1), width: 100, height: rh - 2, class: 'iscn-lab' }, m);
    LCD.iscnD = el('rect', { x: X(bx0 + 1), y: Y(top + rh + 1), width: 100, height: rh - 2, class: 'iscn-lab' }, m);
    el('text', { x: X(bx0 + 51), y: Y(top + 15), class: 'iscn-t', 'text-anchor': 'middle' }, m, 'PROGRAM');
    el('text', { x: X(bx0 + 51), y: Y(top + rh + 15), class: 'iscn-t', 'text-anchor': 'middle' }, m, 'ΔF');
    LCD.iscnRange = el('text', { x: X(bx0 + 110), y: Y(top + 15), class: 'iscn-v' }, m, '');
    LCD.iscnSpan = el('text', { x: X(bx0 + 110), y: Y(top + rh + 15), class: 'iscn-v' }, m, '');
    LCD.iscnRec = lcdBtn(m, X, Y, 424, top - 2, 164, 2 * rh + 4, 'empty');
    LCD.iscnRec.t1.textContent = 'RECALL'; LCD.iscnRec.t1.setAttribute('y', Y(top + 16));
    LCD.iscnRec.tt.textContent = 'RECALL : revient sur la fréquence de départ du dernier balayage';
    LCD.iscnRec.hit.addEventListener('click', (ev) => { ev.stopPropagation(); if (SCAN.last) tuneTo(activeSide(), SCAN.last); });
    LCD.iscnBtns = keyRow(m, X, Y, c, by, [
      ['PROG', 'PROG : balayage programmé entre P1 et P2 (mémoires du TRX) ; nouveau clic : arrêt', () => scanStart('prog')],
      ['ΔF', 'ΔF : balayage autour de la fréquence (± ΔF SPAN) ; nouveau clic : arrêt', () => scanStart('df')],
      ['FINE', 'FINE : balayage lent, il s’arrête plus finement sur les signaux', () => { SCAN.fine = !SCAN.fine; }],
      ['ΔF SPAN', 'ΔF SPAN : ±5, 10, 20, 50, 100, 500 kHz, ±1 MHz', () => { SCAN.span = SCAN.span % 7 + 1; store.set('rs.face.ic.dfspan', SCAN.span); }],
      ['SET', 'SET : SCAN SET (SCAN Speed Slow / Fast, SCAN Resume OFF / ON), relus sur le TRX', () => { L.icSet = true; L.icSub = 'scanset'; L.icSubP = 0; subRead(); }]]);
    // P1 / P2 relus sur le TRX pour afficher la plage du balayage programmé
    LCD.iscnRead = () => { if (iControl()) for (const ch of [100, 101]) setTimeout(() => send({ t: 'set', ctl: 'mcRead', value: ch }), (ch - 99) * 150); };
  }
  function drawIcScan(s) {
    if (!LCD.iscnBtns) return;
    const p = (ch) => { const t = s['mc' + ch]; return t ? Number(t.split('|')[0]) : null; };
    const p1 = p(100), p2 = p(101);
    LCD.iscnRange.textContent = p1 && p2 ? fmtF3(Math.min(p1, p2)) + ' - ' + fmtF3(Math.max(p1, p2)) + ' MHz' : 'P1 – P2 : --.---.-- MHz';
    LCD.iscnSpan.textContent = 'SPAN:  ±  ' + DF_TXT[SCAN.span];
    LCD.iscnP.classList.toggle('on', SCAN.on === 1 || SCAN.on === 3);
    LCD.iscnD.classList.toggle('on', SCAN.on === 2 || SCAN.on === 4);
    LCD.iscnBtns[0].r.classList.toggle('on', SCAN.on === 1 || SCAN.on === 3);
    LCD.iscnBtns[1].r.classList.toggle('on', SCAN.on === 2 || SCAN.on === 4);
    LCD.iscnBtns[2].r.classList.toggle('on', SCAN.fine);
    LCD.iscnRec.t2.textContent = SCAN.last ? fmtF3(SCAN.last) + ' MHz' : '--.---.-- MHz';
  }
  // MEMORY (MENU → MEMORY) : liste des canaux du TRX, 4 par page (1 … 99, P1, P2) ; clic = fréquence et mode dans le VFO
  const MEM = { page: 0, readAt: {} };
  function openIcMem() { L.icMem = true; memRead(); render(); }
  function memRead() {
    if (!iControl()) return;
    for (let i = 0; i < 4; i++) {
      const ch = MEM.page * 4 + i + 1;
      if (ch > 101 || Date.now() - (MEM.readAt[ch] || 0) < 10000) continue;
      MEM.readAt[ch] = Date.now();
      setTimeout(() => send({ t: 'set', ctl: 'mcRead', value: ch }), i * 150);
    }
  }
  function buildIcMem(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = LCD.icMemG = el('g', { class: 'mode-menu ic-menu', style: 'display:none' }, g);
    const x0 = X(6), y0 = Y(4), w = c.w - 12, h = c.h - 8;
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 4, class: 'mm-bg' }, m);
    el('rect', { x: x0 + 4, y: y0 + 4, width: w - 8, height: 24, rx: 3, class: 'mm-title' }, m);
    el('text', { x: x0 + w / 2, y: y0 + 21, class: 'mm-ttl big', 'text-anchor': 'middle' }, m, 'MEMORY');
    LCD.imPage = el('text', { x: x0 + w - 12, y: y0 + 22, class: 'mm-ttl big', 'text-anchor': 'end' }, m, '1/26');
    const rx = x0 + 6, rw = w - 96, ry = y0 + 32, rh = (h - 38) / 4;
    LCD.imRows = [0, 1, 2, 3].map((i) => {
      const y = ry + i * rh;
      el('rect', { x: rx, y, width: rw, height: rh - 3, class: 'im-row' }, m);
      const n = el('text', { x: rx + 22, y: y + 26, class: 'im-n', 'text-anchor': 'middle' }, m, '');
      const f = el('text', { x: rx + 50, y: y + 26, class: 'im-f' }, m, '');
      const md = el('text', { x: rx + 50, y: y + rh - 12, class: 'im-md' }, m, '');
      const nm = el('text', { x: rx + 225, y: y + 26, class: 'im-f' }, m, '');
      el('rect', { x: rx + rw - 44, y: y + rh / 2 - 15, width: 32, height: 27, rx: 3, class: 'im-menu' }, m);
      el('path', { d: [0, 1, 2, 3].map((k) => 'M' + (rx + rw - 38) + ' ' + (y + rh / 2 - 9 + k * 5) + 'h20').join(''), class: 'im-lines' }, m);
      const hit = el('rect', { x: rx, y, width: rw, height: rh - 3, class: 'hs lcd-hit' }, m);
      const tt = el('title', {}, hit, '');
      const row = { n, f, md, nm, tt, ch: 0 };
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); memPick(row.ch); });
      return row;
    });
    const nav = (y, hh, cls, fn, tip) => {
      el('rect', { x: x0 + w - 84, y, width: 76, height: hh, rx: 4, class: 'mm-cell ' + cls }, m);
      const hit = el('rect', { x: x0 + w - 84, y, width: 76, height: hh, class: 'hs lcd-hit' }, m);
      el('title', {}, hit, tip);
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); render(); });
    };
    const ax = x0 + w - 46;
    nav(ry, 100, '', () => { MEM.page = (MEM.page + 25) % 26; memRead(); }, 'Page précédente');
    el('path', { d: 'M' + (ax - 12) + ' ' + (ry + 58) + 'L' + ax + ' ' + (ry + 40) + 'L' + (ax + 12) + ' ' + (ry + 58) + 'Z', class: 'im-arrow' }, m);
    nav(ry + 106, 100, '', () => { MEM.page = (MEM.page + 1) % 26; memRead(); }, 'Page suivante');
    el('path', { d: 'M' + (ax - 12) + ' ' + (ry + 148) + 'L' + ax + ' ' + (ry + 166) + 'L' + (ax + 12) + ' ' + (ry + 148) + 'Z', class: 'im-arrow' }, m);
    nav(y0 + h - 58, 52, '', () => { L.icMem = false; }, 'Retour (comme EXIT)');
    const by = y0 + h - 32;
    el('path', { d: 'M' + (ax + 12) + ' ' + (by - 7) + 'H' + (ax - 4) + 'A7 7 0 0 0 ' + (ax - 4) + ' ' + (by + 7) + 'H' + (ax + 6) + 'M' + (ax - 1) + ' ' + (by - 12) + 'L' + (ax - 7) + ' ' + (by - 7) + 'L' + (ax - 1) + ' ' + (by - 2), class: 'ic-back' }, m);
  }
  function memPick(ch) {
    const t = S()['mc' + ch];
    if (t == null) { memRead(); return say('Canal ' + memName(ch) + ' : pas encore relu sur le TRX.', 'warn', 3000); }
    if (!t) return say('Canal ' + memName(ch) + ' : libre.', '', 2500);
    const [f, md] = t.split('|');
    if (!needControl()) return;
    tuneTo(activeSide(), Number(f));
    if (md && md !== L.activeMode(S())) setTimeout(() => setMode(md), 200);
    L.icMem = false;
    say('Canal ' + memName(ch) + ' : ' + fmtF3(Number(f)) + ' ' + (md || '') + ' dans le VFO.', '', 3500);
    render();
  }
  const memName = (ch) => (ch === 100 ? 'P1' : ch === 101 ? 'P2' : String(ch));
  function drawIcMem(s) {
    if (!LCD.icMemG) return;
    LCD.icMemG.style.display = L.icMem ? '' : 'none';
    if (!L.icMem) return;
    LCD.imPage.textContent = (MEM.page + 1) + '/26';
    LCD.imRows.forEach((r, i) => {
      const ch = MEM.page * 4 + i + 1;
      r.ch = ch <= 101 ? ch : 0;
      const t = r.ch ? s['mc' + ch] : '';
      r.n.textContent = r.ch ? memName(ch) : '';
      if (!r.ch) { r.f.textContent = r.md.textContent = r.nm.textContent = ''; return; }
      const [f, md, nm] = t ? t.split('|') : [];
      r.f.textContent = t ? fmtF3(Number(f)) : '--.---.---';
      r.nm.textContent = t ? (nm || '') : '------';
      r.md.textContent = t ? md || '' : t === '' ? '' : '…';
      r.tt.textContent = t ? 'Canal ' + memName(ch) + ' : clic = ' + fmtF3(Number(f)) + ' ' + md + ' dans le VFO' : 'Canal ' + memName(ch) + (t === '' ? ' : libre' : '');
    });
  }
  // MEMO PAD : bloc-notes de fréquences de cette page (10 au plus), comme celui du TRX ; touche MPAD = noter la fréquence du VFO
  const MPAD = { list: [], sel: 0 };
  try { MPAD.list = (JSON.parse(store.get('rs.face.ic.mpad', '[]')) || []).filter((e) => e && Number(e.f) > 0).slice(0, 10); } catch (e) { MPAD.list = []; }
  const mpadSave = () => store.set('rs.face.ic.mpad', JSON.stringify(MPAD.list));
  function mpadWrite() {
    const s = S(), f = activeSide() === 'B' ? s.freqB : s.freq;
    if (!f) return say('MPAD : fréquence pas encore lue.', 'warn', 2500);
    MPAD.list = [{ f, md: L.activeMode(s), fil: s.fil || null }].concat(MPAD.list.filter((e) => !(e.f === f && e.md === L.activeMode(s)))).slice(0, 10);
    MPAD.sel = 0; mpadSave();
    say('MPAD : ' + fmtF3(f) + ' ' + L.activeMode(s) + ' noté dans le MEMO PAD (MENU → MPAD).', '', 3000);
    render();
  }
  function mpadGo(i) {
    const e = MPAD.list[i];
    if (!e || !needControl()) return;
    MPAD.sel = i;
    tuneTo(activeSide(), e.f);
    if (e.md && e.md !== L.activeMode(S())) setTimeout(() => setMode(e.md), 200);
  }
  function buildIcMpad(g, c) {
    // Deux écrans : normal (5 lignes, sous la bande du scope) et EXPAND (10 lignes, sans le scope), comme sur le TRX
    const mk = (key, exp) => {
      const X = (v) => c.x + v, Y = (v) => c.y + v;
      const m = LCD[key] = lcdOverlay(g, 'icp');
      const top = exp ? G.scopeY : G.scopeY + IC_STRIP;
      el('rect', { x: X(5), y: Y(top), width: c.w - 10, height: c.h - top - 4, class: 'icm-bg' }, m);
      el('rect', { x: X(5), y: Y(top + 1), width: c.w - 10, height: 18, class: 'icp-tb' }, m);
      el('text', { x: X(c.w / 2), y: Y(top + 15), class: 'ick-title', 'text-anchor': 'middle' }, m, 'MEMO PAD');
      const y0 = top + 21, nr = exp ? 10 : 5, rh = exp ? (c.h - 50 - y0 - 8) / 10 : 18;
      el('rect', { x: X(10), y: Y(y0), width: c.w - 20, height: c.h - y0 - 50, class: 'im-row' }, m);
      const rows = Array.from({ length: nr }, (_, i) => {
        const y = y0 + 4 + i * rh;
        const bg = el('rect', { x: X(14), y: Y(y), width: 330, height: rh - 1, class: 'imp-sel' }, m);
        const t = el('text', { x: X(20), y: Y(y + rh / 2 + 5), class: 'imp-t', 'xml:space': 'preserve' }, m, '');
        const hit = el('rect', { x: X(14), y: Y(y), width: c.w - 28, height: rh - 1, class: 'hs lcd-hit' }, m);
        el('title', {}, hit, 'Clic : retour sur cette fréquence');
        hit.addEventListener('click', (ev) => { ev.stopPropagation(); mpadGo((exp ? MPAD.topX : MPAD.top) + i); render(); });
        return { bg, t };
      });
      const btns = keyRow(m, X, Y, c, c.h - 46, [
        ['▲', 'Ligne précédente (et retour sur sa fréquence)', () => { if (MPAD.list.length) mpadGo(Math.max(0, MPAD.sel - 1)); }],
        ['▼', 'Ligne suivante (et retour sur sa fréquence)', () => { if (MPAD.list.length) mpadGo(Math.min(MPAD.list.length - 1, MPAD.sel + 1)); }],
        ['DEL', 'DEL : efface la ligne choisie', () => { MPAD.list.splice(MPAD.sel, 1); MPAD.sel = Math.max(0, Math.min(MPAD.sel, MPAD.list.length - 1)); mpadSave(); }],
        ['DEL ALL', 'DEL ALL : efface tout le MEMO PAD de cette page', () => { MPAD.list = []; MPAD.sel = 0; mpadSave(); }],
        ['EXPAND', 'EXPAND : MEMO PAD agrandi (10 lignes, sans le scope) ; nouveau clic : normal', () => { L.mpadExp = !L.mpadExp; WF.drawn = false; }]]);
      return { rows, btns };
    };
    const a = mk('icMpad', false), b = mk('icMpadX', true);
    LCD.impRows = a.rows; LCD.impRowsX = b.rows; LCD.impBtns = a.btns;
    b.btns[4].r.classList.add('on');
    MPAD.top = 0; MPAD.topX = 0;
  }
  function drawIcMpad() {
    if (!LCD.impRows) return;
    const fill = (rows, topKey, n) => {
      if (MPAD.sel < MPAD[topKey]) MPAD[topKey] = MPAD.sel;
      if (MPAD.sel > MPAD[topKey] + n - 1) MPAD[topKey] = MPAD.sel - n + 1;
      rows.forEach((r, i) => {
        const k = MPAD[topKey] + i, e = MPAD.list[k];
        const f = e ? (e.f / 1e6).toFixed(6).replace(/(\d)(\d{3})$/, '$1.$2').replace(/\.(\d{3})\./, '.$1.') : '--.---.---';
        r.t.textContent = String(k + 1).padStart(2, ' ') + '  ' + f.padStart(11, ' ') + '  ' + (e ? (e.md || '').padEnd(7, ' ') : '------ ') + '  ' + (e && e.fil ? 'FIL' + e.fil : '----');
        r.bg.classList.toggle('on', !!e && k === MPAD.sel);
      });
    };
    fill(LCD.impRows, 'top', 5);
    if (LCD.impRowsX) fill(LCD.impRowsX, 'topX', 10);
  }
  // SET (MENU → SET) : liste des réglages du TRX, 2 pages, comme sur l'IC-7300 (icônes : dessins originaux)
  const SET_ICONS = {
    tone: '<rect x="14" y="4" width="52" height="46" rx="4" fill="#7d8494"/><path d="M28 10v34M40 10v34M52 10v34" stroke="#2a2f3a" stroke-width="3"/><rect x="23" y="16" width="10" height="6" fill="#d8dce4"/><rect x="35" y="30" width="10" height="6" fill="#d8dce4"/><rect x="47" y="22" width="10" height="6" fill="#d8dce4"/><path d="M2 34h8l10-10v30l-10-10H2z" fill="#f0a030"/>',
    func: '<path d="M14 50L50 14" stroke="#c9ced8" stroke-width="7" stroke-linecap="round"/><circle cx="54" cy="10" r="9" fill="#c9ced8"/><path d="M20 12l32 32" stroke="#e8c030" stroke-width="8" stroke-linecap="round"/><rect x="10" y="4" width="16" height="10" rx="2" fill="#9aa1ae" transform="rotate(45 18 9)"/>',
    conn: '<rect x="20" y="2" width="6" height="16" fill="#c9ced8"/><rect x="18" y="18" width="10" height="34" rx="2" fill="#aeb4bf"/><rect x="42" y="2" width="12" height="14" rx="2" fill="#c9ced8"/><rect x="40" y="16" width="16" height="36" rx="3" fill="#aeb4bf"/>',
    disp: '<rect x="6" y="6" width="60" height="38" rx="3" fill="#2f8fe0" stroke="#c9ced8" stroke-width="3"/><path d="M8 42L64 8V42z" fill="#7fc4ff" opacity=".6"/><rect x="30" y="46" width="12" height="5" fill="#9aa1ae"/><rect x="22" y="51" width="28" height="3" fill="#9aa1ae"/>',
    time: '<circle cx="36" cy="28" r="25" fill="#e8ecf4" stroke="#9aa1ae" stroke-width="3"/><path d="M36 28V12M36 28L48 36" stroke="#5b616e" stroke-width="3" stroke-linecap="round"/>',
    sd: '<path d="M18 4h30l10 10v40H18z" fill="#2f6fd6"/><path d="M24 4v10M30 4v10M36 4v10M42 4v10" stroke="#e8ecf4" stroke-width="2"/><text x="37" y="42" font-family="Arial" font-weight="700" font-size="17" fill="#fff" text-anchor="middle">SD</text>',
    etc: '<rect x="4" y="12" width="64" height="34" rx="9" fill="#2f8fe0"/><text x="36" y="37" font-family="Arial" font-weight="700" font-size="20" fill="#fff" text-anchor="middle">etc.</text>'
  };
  const SET_ITEMS = [[['tone', 'Tone Control/TBW'], ['func', 'Function'], ['conn', 'Connectors'], ['disp', 'Display']], [['time', 'Time Set'], ['sd', 'SD Card'], ['etc', 'Others']]];
  function setInfo(id, lab) {
    // Sous-menus relus sur le TRX (1A 05) : Tone Control/TBW, Function, Display, Time Set modifiables, Connectors en lecture seule ;
    // SD Card : rien à distance ; Others : Information seulement (pas Touch Screen, Reset, Emergency)
    if (id === 'sd') return say('SET → SD Card : pas disponible à distance (carte SD du TRX).', '', 4500);
    if (R.EX_MENUS && (R.EX_MENUS[id] || id === 'etc')) { L.icSub = id; L.icSubP = 0; subRead(); return render(); }
    say('SET → ' + lab + ' : pas disponible à distance.', '', 4500);
  }
  // ---- Sous-menus de SET : 5 réglages par page, valeur relue sur le TRX à droite ; clic = valeur suivante (ou − à gauche, + à droite)
  const SUB = { pend: {}, readAt: {} };
  const OTHERS = [['info', 'Information', 'Modèle IC-7300, adresse CI-V 94h ; la version du firmware ne se lit pas par le CAT (MENU → SET → Others → Information au club)'],
    ['tsc', 'Touch Screen Calibration', 'Touch Screen Calibration : pas à distance'], ['clone', 'Clone', 'Clone : pas à distance'],
    ['reset', 'Reset', 'Reset : jamais à distance'], ['emg', 'Emergency', 'Emergency : jamais à distance']];
  const SUBN = 4; // 4 réglages par page, comme sur le TRX
  function subItems() {
    if (L.icSub === 'etc') return OTHERS.map((o) => ({ other: o }));
    // VOICE → REC/SET : REC (enregistrement au micro du TRX : pas à distance), SET → VOICE TX SET
    if (L.icSub === 'vrec') return [{ other: ['rec', 'REC', 'REC : VOICE TX RECORD — enregistrer T1 … T8 avec votre micro'], go: 'vtx' }, { other: ['set', 'SET', 'VOICE TX SET : Auto Monitor, Repeat Time'], go: 'voice' }];
    // VOICE TX RECORD : les 8 mémoires (nom, durée) ; clic : écran de la mémoire (REC, ▶, NAME, CLEAR)
    if (L.icSub === 'vtx') return [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ pseudo: 'vmem', n }));
    // VOICE TX SET des mémoires de la page
    if (L.icSub === 'voice') return [{ pseudo: 'vmon', label: 'Auto Monitor' }, { pseudo: 'vrep', label: 'Repeat Time' }];
    if (L.icSub === 'scope') {
      // SCOPE SET : ordre du TRX, VBW (27 1D) après Marker Position, Fixed Edges à la fin
      const its = R.EX_MENUS.scope[1].map((x) => R.EX[x[0]]);
      its.splice(4, 0, { pseudo: 'vbw', label: 'VBW' });
      its.push({ other: ['edges', 'Fixed Edges', 'Bords du mode FIX pour la bande en cours'], go: 'edges' });
      return its;
    }
    if (L.icSub === 'edges') {
      // Fixed Edges : les 3 bords de la tranche de la fréquence en cours (bord bas – bord haut)
      const f = (activeSide() === 'B' ? S().freqB : S().freq) / 1000 || 14000;
      return R.EX_MENUS.edges[1].map((x) => R.EX[x[0]]).filter((it) => f >= it.lo && f < it.hi);
    }
    const m = R.EX_MENUS && R.EX_MENUS[L.icSub];
    return m ? m[1].map((x) => R.EX[x[0]]) : [];
  }
  function subRead() {
    if (!iControl() || L.icSub === 'etc') return;
    const its = subItems().slice((L.icSubP || 0) * SUBN, (L.icSubP || 0) * SUBN + SUBN);
    its.forEach((it, i) => {
      if (!it || !it.n || Date.now() - (SUB.readAt[it.n] || 0) < 5000) return;
      SUB.readAt[it.n] = Date.now();
      setTimeout(() => send({ t: 'set', ctl: 'exRead', value: it.n }), i * 130);
    });
  }
  // Retour : Fixed Edges → SCOPE SET → écran SCOPE ; autres sous-menus → liste SET
  function subBack() {
    if (L.icSub === 'edges') { L.icSub = 'scope'; L.icSubP = 3; return; }
    if (L.icSub === 'scope' || L.icSub === 'audio' || L.icSub === 'vrec' || L.icSub === 'scanset') { L.icSub = null; L.icSet = false; return; }
    if (L.icSub === 'voice' || L.icSub === 'vtx') { L.icSub = 'vrec'; L.icSubP = 0; return; }
    L.icSub = null;
  }
  function subRaw(it) { const p = SUB.pend[it.n]; if (p && Date.now() - p.at < 3000) return p.v; const v = S()['ex' + it.n]; return v == null ? null : v; }
  function subClick(it, right) {
    if (it.go) { L.icSub = it.go; L.icSubP = 0; subRead(); return render(); }
    if (it.pseudo === 'vbw') { if (!needControl()) return; return setCtl('scVbw', S().scVbw ? 0 : 1); }
    if (it.pseudo === 'vmem') { L.vrN = it.n; vmListenStop(); return render(); }
    if (it.pseudo === 'vmon') { send({ t: 'vm_set', mon: !(VM.meta && VM.meta.mon) }); return; }
    if (it.pseudo === 'vrep') { const v = (VM.meta && VM.meta.rep) || 5; send({ t: 'vm_set', rep: Math.max(1, Math.min(15, v + (right ? 1 : -1))) }); return; }
    if (it.type === 'edge') {
      if (!it.rw || !needControl()) return;
      const cur = subRaw(it), [a0, b0] = cur ? String(cur).split('-') : [it.lo, it.hi];
      const ans = window.prompt(it.label + '\nBord bas – bord haut en kHz (entre ' + it.lo + ' et ' + it.hi + ') :', a0 + '-' + b0);
      if (!ans) return;
      const mm = /^\s*(\d+)\s*[-–]\s*(\d+)\s*$/.exec(ans);
      if (!mm) return say('Format : bas-haut en kHz, par exemple 14000-14350.', 'warn', 4000);
      SUB.pend[it.n] = { v: mm[1] + '-' + mm[2], at: Date.now() };
      setCtl('exEdge', it.n * 1e10 + Number(mm[1]) * 1e5 + Number(mm[2]));
      setTimeout(() => { if (iControl()) send({ t: 'set', ctl: 'exRead', value: it.n }); }, 400);
      return render();
    }
    if (it.other) return say(it.other[2] + '.', '', 5000);
    if (!it.rw) return say(it.label + ' : lecture seule à distance' + (it.menu === 'conn' ? ' (réglages de liaison avec le club)' : '') + '.', '', 4000);
    if (!needControl()) return;
    const cur = subRaw(it);
    if (cur == null && !/^(date|time)$/.test(it.type)) { subRead(); return say(it.label + ' : valeur pas encore relue sur le TRX.', 'warn', 2500); }
    const v = Number(cur), t = it.type, d = right ? 1 : -1;
    let nv = null;
    const next = (list, x) => list[(list.indexOf(x) + 1) % list.length];
    if (t === 'list') nv = (v + 1) % it.opts.length;
    else if (t === 'tone') nv = Math.max(0, Math.min(10, v + d));
    else if (t === 'pct' || t === 'nbw') nv = Math.max(0, Math.min(255, v + d * 13));
    else if (t === 'nbd') nv = Math.max(0, Math.min(9, v + d));
    else if (t === 'rsec') nv = Math.max(1, Math.min(15, v + d));
    else if (t === 'voxd') nv = Math.max(0, Math.min(20, v + d));
    else if (t === 'utc') nv = Math.max(-840, Math.min(840, v + d * 15));
    else if (t === 'tbw') { const lo = Math.floor(v / 10), hi = v % 10; nv = right ? lo * 10 + (hi + 1) % 4 : ((lo + 1) % 4) * 10 + hi; }
    else if (t === 'hl') {
      // à gauche : HPF suivant, à droite : LPF suivant (en restant HPF < LPF)
      let h = Math.floor(v / 100), l = v % 100;
      for (let k = 0; k < 30; k++) { if (right) l = l >= 25 ? 5 : l + 1; else h = h >= 20 ? 0 : h + 1; if (R.exOk(it, h * 100 + l)) break; }
      nv = h * 100 + l;
    } else if (t === 'date' || t === 'time') {
      // Date / Time : réglées sur l'horloge de ce PC (heure locale)
      const n = new Date(), p2 = (x) => String(x).padStart(2, '0');
      nv = t === 'date' ? n.getFullYear() + p2(n.getMonth() + 1) + p2(n.getDate()) : p2(n.getHours()) + p2(n.getMinutes());
    }
    if (nv == null) return;
    SUB.pend[it.n] = { v: String(nv), at: Date.now() };
    if (t === 'date') setCtl('exDate', Number(nv)); else setCtl('exSet', R.exCode(it, nv));
    SUB.readAt[it.n] = 0;
    setTimeout(() => { if (iControl()) send({ t: 'set', ctl: 'exRead', value: it.n }); }, 400);
    if (t === 'date' || t === 'time') say(it.label + ' du TRX réglé sur l’horloge de ce PC : ' + R.exFmt(it, nv), '', 3500);
    render();
  }
  function buildIcSetSub(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = LCD.icSubG = el('g', { class: 'mode-menu ic-menu', style: 'display:none' }, g);
    const x0 = X(6), y0 = Y(4), w = c.w - 12, h = c.h - 8;
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 4, class: 'mm-bg' }, m);
    el('rect', { x: x0 + 4, y: y0 + 4, width: w - 8, height: 24, rx: 3, class: 'mm-title' }, m);
    LCD.isubTitle = el('text', { x: x0 + w / 2, y: y0 + 21, class: 'mm-ttl big', 'text-anchor': 'middle' }, m, '');
    LCD.isubPage = el('text', { x: x0 + w - 12, y: y0 + 22, class: 'mm-ttl big', 'text-anchor': 'end' }, m, '');
    const rx = x0 + 6, rw = w - 96, ry = y0 + 32, rh = (h - 38) / SUBN;
    LCD.isubRows = Array.from({ length: SUBN }, (_, i) => i).map((i) => {
      const y = ry + i * rh;
      const bg = el('rect', { x: rx, y, width: rw, height: rh - 3, class: 'im-row' }, m);
      const t = el('text', { x: rx + 12, y: y + 22, class: 'isub-l' }, m, '');
      const v = el('text', { x: rx + rw - 12, y: y + rh - 12, class: 'isub-v', 'text-anchor': 'end' }, m, '');
      const sw = el('rect', { x: rx + rw - 262, y: y + rh - 30, width: 34, height: 20, class: 'isub-sw', style: 'display:none' }, m); // couleur (R:G:B)
      const hit = el('rect', { x: rx, y, width: rw, height: rh - 3, class: 'hs lcd-hit' }, m);
      const tt = el('title', {}, hit, '');
      const row = { bg, t, v, tt, sw, it: null };
      hit.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!row.it) return;
        const r = hit.getBoundingClientRect();
        subClick(row.it, ev.clientX > r.left + r.width * 0.5);
      });
      return row;
    });
    const nav = (y, hh, fn, tip) => {
      el('rect', { x: x0 + w - 84, y, width: 76, height: hh, rx: 4, class: 'mm-cell' }, m);
      const hit = el('rect', { x: x0 + w - 84, y, width: 76, height: hh, class: 'hs lcd-hit' }, m);
      el('title', {}, hit, tip);
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); render(); });
    };
    const ax = x0 + w - 46, pages = () => Math.max(1, Math.ceil(subItems().length / SUBN));
    nav(ry, 100, () => { L.icSubP = ((L.icSubP || 0) + pages() - 1) % pages(); subRead(); }, 'Page précédente');
    el('path', { d: 'M' + (ax - 12) + ' ' + (ry + 58) + 'L' + ax + ' ' + (ry + 40) + 'L' + (ax + 12) + ' ' + (ry + 58) + 'Z', class: 'im-arrow' }, m);
    nav(ry + 106, 100, () => { L.icSubP = ((L.icSubP || 0) + 1) % pages(); subRead(); }, 'Page suivante');
    el('path', { d: 'M' + (ax - 12) + ' ' + (ry + 148) + 'L' + ax + ' ' + (ry + 166) + 'L' + (ax + 12) + ' ' + (ry + 148) + 'Z', class: 'im-arrow' }, m);
    nav(y0 + h - 58, 52, () => subBack(), 'Retour');
    const by = y0 + h - 32;
    el('path', { d: 'M' + (ax + 12) + ' ' + (by - 7) + 'H' + (ax - 4) + 'A7 7 0 0 0 ' + (ax - 4) + ' ' + (by + 7) + 'H' + (ax + 6) + 'M' + (ax - 1) + ' ' + (by - 12) + 'L' + (ax - 7) + ' ' + (by - 7) + 'L' + (ax - 1) + ' ' + (by - 2), class: 'ic-back' }, m);
    LCD.isubPages = pages;
  }
  // VOICE TX RECORD → une mémoire : REC (micro de la page) / STOP, ▶ écoute, NAME, CLEAR, retour
  function buildIcVrec(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = LCD.ivrG = el('g', { class: 'mode-menu ic-menu', style: 'display:none' }, g);
    const x0 = 6, y0 = 4, w = c.w - 12, h = c.h - 8;
    el('rect', { x: X(x0), y: Y(y0), width: w, height: h, rx: 4, class: 'mm-bg' }, m);
    el('rect', { x: X(x0 + 4), y: Y(y0 + 4), width: w - 8, height: 24, rx: 3, class: 'mm-title' }, m);
    el('text', { x: X(x0 + w / 2), y: Y(y0 + 21), class: 'mm-ttl big', 'text-anchor': 'middle' }, m, 'VOICE TX RECORD');
    LCD.ivrN = el('text', { x: X(x0 + w - 12), y: Y(y0 + 22), class: 'mm-ttl big', 'text-anchor': 'end' }, m, '');
    LCD.ivrName = el('text', { x: X(24), y: Y(66), class: 'ivr-name' }, m, '');
    LCD.ivrDur = el('text', { x: X(c.w - 24), y: Y(66), class: 'ivr-dur', 'text-anchor': 'end' }, m, '');
    el('text', { x: X(24), y: Y(112), class: 'ivr-lab' }, m, 'REC Level');
    el('rect', { x: X(130), y: Y(100), width: c.w - 260, height: 14, rx: 2, class: 'ivl-track' }, m);
    LCD.ivrLvl = el('rect', { x: X(131.5), y: Y(101.5), width: 0, height: 11, class: 'ivr-lvl' }, m);
    LCD.ivrLvlW = c.w - 263;
    LCD.ivrTime = el('text', { x: X(c.w - 24), y: Y(112), class: 'ivr-lab', 'text-anchor': 'end' }, m, '');
    LCD.ivrSt = el('text', { x: X(c.w / 2), y: Y(160), class: 'ivr-st', 'text-anchor': 'middle' }, m, '');
    LCD.ivrHelp = el('text', { x: X(c.w / 2), y: Y(200), class: 'ivr-help', 'text-anchor': 'middle' }, m, '');
    LCD.ivrHelp2 = el('text', { x: X(c.w / 2), y: Y(220), class: 'ivr-help', 'text-anchor': 'middle' }, m, '');
    LCD.ivrBtns = keyRow(m, X, Y, c, c.h - 64, [
      ['● REC', 'REC : enregistre avec votre micro (30 s au plus) ; nouveau clic : STOP (la mémoire est gardée sur le serveur, pour vous seul)', () => (VM.rec ? vmRecStop() : vmRecStart(L.vrN))],
      ['▶', 'Écouter la mémoire dans la page (rien n’est émis) ; nouveau clic : arrêt', () => {
        if (VM.src) return vmListenStop();
        if (VM.last[L.vrN]) return vmListen(VM.last[L.vrN]);
        const t = VM.meta && VM.meta.t[L.vrN - 1];
        if (t && !t.ms) return say('T' + L.vrN + ' : mémoire vide.', 'warn', 3000);
        send({ t: 'vm_get', n: L.vrN });
      }],
      ['NAME', 'NAME : nom de la mémoire (16 caractères)', () => {
        const t = VM.meta && VM.meta.t[L.vrN - 1];
        const v = window.prompt('Nom de la mémoire T' + L.vrN + ' (16 caractères au plus) :', (t && t.name) || '');
        if (v != null) send({ t: 'vm_name', n: L.vrN, name: v.slice(0, 16) });
      }],
      ['CLEAR', 'CLEAR : efface la mémoire', () => { if (window.confirm('Effacer la mémoire T' + L.vrN + ' ?')) { delete VM.last[L.vrN]; send({ t: 'vm_del', n: L.vrN }); } }],
      ['', 'Retour à la liste', () => { if (VM.rec) vmRecStop(); vmListenStop(); L.vrN = 0; }]
    ]);
    const bb = LCD.ivrBtns[4].r, ax = Number(bb.getAttribute('x')) + Number(bb.getAttribute('width')) / 2, by = Number(bb.getAttribute('y')) + Number(bb.getAttribute('height')) / 2;
    el('path', { d: 'M' + (ax + 12) + ' ' + (by - 7) + 'H' + (ax - 4) + 'A7 7 0 0 0 ' + (ax - 4) + ' ' + (by + 7) + 'H' + (ax + 6) + 'M' + (ax - 1) + ' ' + (by - 12) + 'L' + (ax - 7) + ' ' + (by - 7) + 'L' + (ax - 1) + ' ' + (by - 2), class: 'ic-back' }, m);
  }
  function drawIcVrec() {
    if (!LCD.ivrG) return;
    const on = !!L.icSet && L.icSub === 'vtx' && !!L.vrN;
    LCD.ivrG.style.display = on ? '' : 'none';
    if (!on) return;
    const n = L.vrN, t = VM.meta && VM.meta.t[n - 1], V = window.RSVOICE;
    LCD.ivrN.textContent = 'T' + n;
    LCD.ivrName.textContent = t && t.name ? t.name : '(sans nom)';
    LCD.ivrDur.textContent = !t ? '' : t.ms ? (t.ms / 1000).toFixed(1) + ' s' : 'vide';
    const recS = VM.rec ? V.recLen() / 12000 : 0;
    const lv = VM.rec && V ? Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-4, V.level())) + 48) / 48)) : 0;
    LCD.ivrLvl.setAttribute('width', LCD.ivrLvlW * lv);
    LCD.ivrLvl.classList.toggle('hot', lv > 0.88);
    LCD.ivrTime.textContent = recS.toFixed(1) + ' / ' + VM_MAXS + ' s';
    LCD.ivrSt.textContent = VM.rec ? '● Enregistrement…' : VM.src ? '▶ Écoute dans la page' : '';
    LCD.ivrSt.classList.toggle('rec', !!VM.rec);
    const mic = !!(V && V.micOn());
    LCD.ivrHelp.textContent = mic ? 'Parlez normalement dans votre micro, sans appuyer sur le PTT.' : 'Pour enregistrer : mettez d’abord votre micro en service (MICRO sous la face avant).';
    LCD.ivrHelp2.textContent = 'Gardées sur le serveur : vous les retrouvez sur tout PC.';
    LCD.ivrBtns[0].t1.textContent = VM.rec ? '■ STOP' : '● REC';
    LCD.ivrBtns[0].r.classList.toggle('on', !!VM.rec);
    LCD.ivrBtns[1].t1.textContent = VM.src ? '■' : '▶';
  }
  function drawIcSetSub() {
    if (!LCD.icSubG) return;
    const on = !!L.icSet && !!L.icSub;
    LCD.icSubG.style.display = on ? '' : 'none';
    if (!on) return;
    const all = subItems(), p = Math.min(L.icSubP || 0, LCD.isubPages() - 1);
    // Retour de SCOPE SET : à l'écran SCOPE (ouvert par EXPD/SET)
    LCD.isubTitle.textContent = { etc: 'Others', vrec: 'REC/SET', vtx: 'VOICE TX RECORD', voice: 'VOICE TX SET' }[L.icSub] || R.EX_MENUS[L.icSub][0];
    LCD.isubPage.textContent = (p + 1) + '/' + LCD.isubPages();
    LCD.isubRows.forEach((r, i) => {
      const it = all[p * SUBN + i] || null;
      r.it = it;
      r.bg.style.display = it ? '' : 'none';
      r.sw.style.display = 'none';
      if (!it) { r.t.textContent = r.v.textContent = ''; return; }
      if (it.other) {
        r.t.textContent = it.other[1]; r.v.textContent = it.go ? '›' : it.other[0] === 'info' ? 'IC-7300 · CI-V 94h' : 'pas à distance';
        r.bg.classList.toggle('ro', !it.go && it.other[0] !== 'info'); r.tt.textContent = it.other[2];
        return;
      }
      if (it.pseudo === 'vmem') { const t = VM.meta && VM.meta.t[it.n - 1]; r.t.textContent = 'T' + it.n + (t && t.name ? '   ' + t.name : ''); r.v.textContent = !t ? '…' : t.ms ? (t.ms / 1000).toFixed(1) + ' s' : 'vide'; r.bg.classList.remove('ro'); r.tt.textContent = 'Clic : enregistrer, écouter, nommer ou effacer T' + it.n; return; }
      if (it.pseudo === 'vmon') { r.t.textContent = 'Auto Monitor'; r.v.textContent = !VM.meta ? '…' : VM.meta.mon ? 'ON' : 'OFF'; r.bg.classList.remove('ro'); r.tt.textContent = 'ON : vous entendez la mémoire pendant qu’elle est émise · clic : ON ⇄ OFF'; return; }
      if (it.pseudo === 'vrep') { r.t.textContent = 'Repeat Time'; r.v.textContent = !VM.meta ? '…' : VM.meta.rep + 'sec'; r.bg.classList.remove('ro'); r.tt.textContent = 'Intervalle de la répétition (appui d’1 s sur T1 … T8), 1 à 15 s · clic à gauche : − · à droite : +'; return; }
      if (it.pseudo === 'vbw') { const v2 = S().scVbw; r.t.textContent = 'VBW'; r.v.textContent = v2 == null ? '…' : v2 ? 'Wide' : 'Narrow'; r.bg.classList.remove('ro'); r.tt.textContent = 'Clic : Narrow ⇄ Wide'; return; }
      const raw = subRaw(it);
      if (it.type === 'rgb' && raw) { const c3 = String(raw).split(','); r.sw.style.display = ''; r.sw.style.fill = 'rgb(' + c3.join(',') + ')'; }
      r.t.textContent = it.label;
      r.v.textContent = raw == null ? (iControl() ? '…' : '— (prenez la main)') : R.exFmt(it, raw) + (it.rw ? '' : '  🔒');
      r.bg.classList.toggle('ro', !it.rw);
      r.tt.textContent = it.rw ? (/^(list)$/.test(it.type) ? 'Clic : valeur suivante' : /^(date|time)$/.test(it.type) ? 'Clic : régler sur l’horloge de ce PC' : 'Clic à gauche : − · à droite : +') : 'Lecture seule à distance';
    });
  }
  function buildIcSet(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = LCD.icSetG = el('g', { class: 'mode-menu ic-menu', style: 'display:none' }, g);
    const x0 = X(6), y0 = Y(4), w = c.w - 12, h = c.h - 8;
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 4, class: 'mm-bg' }, m);
    el('rect', { x: x0 + 4, y: y0 + 4, width: w - 8, height: 24, rx: 3, class: 'mm-title' }, m);
    el('text', { x: x0 + w / 2, y: y0 + 21, class: 'mm-ttl big', 'text-anchor': 'middle' }, m, 'SET');
    LCD.isetPage = el('text', { x: x0 + w - 12, y: y0 + 22, class: 'mm-ttl big', 'text-anchor': 'end' }, m, '1/2');
    const rx = x0 + 6, rw = w - 96, ry = y0 + 32, rh = (h - 38) / 4;
    LCD.isetRows = [0, 1, 2, 3].map((i) => {
      const y = ry + i * rh;
      const bg = el('rect', { x: rx, y, width: rw, height: rh - 3, class: 'im-row' }, m);
      const ic = el('g', { transform: 'translate(' + (rx + 8) + ',' + (y + 8) + ') scale(' + ((rh - 18) / 56).toFixed(3) + ')' }, m);
      const t = el('text', { x: rx + 92, y: y + rh / 2 + 8, class: 'iset-t' }, m, '');
      const hit = el('rect', { x: rx, y, width: rw, height: rh - 3, class: 'hs lcd-hit' }, m);
      const tt = el('title', {}, hit, '');
      const row = { bg, ic, t, tt, it: null };
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); if (row.it) setInfo(row.it[0], row.it[1]); });
      return row;
    });
    const nav = (y, hh, fn, tip) => {
      el('rect', { x: x0 + w - 84, y, width: 76, height: hh, rx: 4, class: 'mm-cell' }, m);
      const hit = el('rect', { x: x0 + w - 84, y, width: 76, height: hh, class: 'hs lcd-hit' }, m);
      el('title', {}, hit, tip);
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); render(); });
    };
    const ax = x0 + w - 46;
    nav(ry, 100, () => { L.icSetP = 0; }, 'Page 1');
    el('path', { d: 'M' + (ax - 12) + ' ' + (ry + 58) + 'L' + ax + ' ' + (ry + 40) + 'L' + (ax + 12) + ' ' + (ry + 58) + 'Z', class: 'im-arrow' }, m);
    nav(ry + 106, 100, () => { L.icSetP = 1; }, 'Page 2');
    el('path', { d: 'M' + (ax - 12) + ' ' + (ry + 148) + 'L' + ax + ' ' + (ry + 166) + 'L' + (ax + 12) + ' ' + (ry + 148) + 'Z', class: 'im-arrow' }, m);
    nav(y0 + h - 58, 52, () => { L.icSet = false; }, 'Retour (comme EXIT)');
    const by = y0 + h - 32;
    el('path', { d: 'M' + (ax + 12) + ' ' + (by - 7) + 'H' + (ax - 4) + 'A7 7 0 0 0 ' + (ax - 4) + ' ' + (by + 7) + 'H' + (ax + 6) + 'M' + (ax - 1) + ' ' + (by - 12) + 'L' + (ax - 7) + ' ' + (by - 7) + 'L' + (ax - 1) + ' ' + (by - 2), class: 'ic-back' }, m);
  }
  function drawIcSet() {
    if (!LCD.icSetG) return;
    LCD.icSetG.style.display = L.icSet ? '' : 'none';
    if (!L.icSet) return;
    const p = L.icSetP || 0;
    LCD.isetPage.textContent = (p + 1) + '/2';
    LCD.isetRows.forEach((r, i) => {
      const it = SET_ITEMS[p][i] || null;
      if (r.it === it) return;
      r.it = it;
      r.ic.innerHTML = it ? SET_ICONS[it[0]] : '';
      r.t.textContent = it ? it[1] : '';
      r.tt.textContent = it ? 'SET → ' + it[1] : '';
    });
  }
  // FUNCTION (touche FUNCTION) : 10 touches comme sur l'IC-7300, l'état dessous, cadre bleu clair quand la fonction est en service
  const IC_FUNC = [
    ['P.AMP/ATT', (s) => (s.att ? 'ATT' : s.preamp ? 'P.AMP' + s.preamp : 'OFF'), (s) => !!(s.att || s.preamp),
      (s) => { if (s.att) setCtl('att', 0); else if ((s.preamp || 0) < 2) setCtl('preamp', (s.preamp || 0) + 1); else { setCtl('preamp', 0); setTimeout(() => setCtl('att', 1), 150); } }, 'P.AMP/ATT : OFF → P.AMP1 → P.AMP2 → ATT → OFF'],
    ['AGC', (s) => ['', 'FAST', 'MID', 'SLOW'][s.agc] || '—', () => true, (s) => setCtl('agc', (s.agc || 2) % 3 + 1), 'AGC : FAST → MID → SLOW'],
    ['NOTCH', (s) => notchTxt(s), (s) => !!(s.notch || s.dnf), () => doAct({ act: { local: 'notchCycle' } }), 'NOTCH : OFF → AN → MN (pas d’AN en CW)'],
    ['NB', (s) => onOff(s.nb), (s) => !!s.nb, (s) => setCtl('nb', s.nb ? 0 : 1), 'NB marche / arrêt'],
    ['NR', (s) => onOff(s.nr), (s) => !!s.nr, (s) => setCtl('nr', s.nr ? 0 : 1), 'NR marche / arrêt'],
    ['IP+', (s) => onOff(s.ipPlus), (s) => !!s.ipPlus, (s) => setCtl('ipPlus', s.ipPlus ? 0 : 1), 'IP+ marche / arrêt'],
    [(s) => (/^CW/.test(L.activeMode(s)) ? 'BKIN' : 'VOX'), (s) => (/^CW/.test(L.activeMode(s)) ? ['OFF', 'SEMI', 'FULL'][s.bkin] || '—' : onOff(s.vox)),
      (s) => (/^CW/.test(L.activeMode(s)) ? !!s.bkin : !!s.vox), () => doAct({ act: { local: 'voxBk' } }), 'En phonie : VOX (à distance, il ne peut être que coupé) ; en CW : BK-IN OFF → SEMI → FULL'],
    ['COMP', (s) => onOff(s.proc), (s) => !!s.proc, (s) => setCtl('proc', s.proc ? 0 : 1), 'COMP (compresseur de modulation) marche / arrêt'],
    ['TBW', (s) => ['WIDE', 'MID', 'NAR'][s.tbw] || '—', () => true, (s) => setCtl('tbw', ((s.tbw || 0) + 1) % 3), 'TBW : largeur de la bande passante d’émission en SSB (WIDE → MID → NAR)'],
    ['MONI', (s) => onOff(s.moni), (s) => !!s.moni, (s) => setCtl('moni', s.moni ? 0 : 1), 'MONI : écoute de sa propre émission au club']
  ];
  function buildIcFunc(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = LCD.icFuncG = el('g', { class: 'mode-menu ic-menu', style: 'display:none' }, g);
    const x0 = X(6), y0 = Y(4), w = c.w - 12, h = c.h - 8;
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 4, class: 'mm-bg' }, m);
    el('rect', { x: x0 + 4, y: y0 + 4, width: w - 8, height: 24, rx: 3, class: 'mm-title' }, m);
    el('text', { x: x0 + w / 2, y: y0 + 21, class: 'mm-ttl big', 'text-anchor': 'middle' }, m, 'FUNCTION');
    const cw = (w - 16) / 5, rh = 112;
    LCD.icfBtns = IC_FUNC.map((it, i) => {
      const x = x0 + 8 + (i % 5) * cw, y = y0 + 36 + Math.floor(i / 5) * (rh + 8);
      const r = el('rect', { x: x + 3, y, width: cw - 6, height: rh, rx: 5, class: 'icf-btn' }, m);
      const t1 = el('text', { x: x + cw / 2, y: y + 44, class: 'icf-t1', 'text-anchor': 'middle' }, m, '');
      const t2 = el('text', { x: x + cw / 2, y: y + 86, class: 'icf-t2', 'text-anchor': 'middle' }, m, '');
      const hit = el('rect', { x: x + 3, y, width: cw - 6, height: rh, class: 'hs lcd-hit' }, m);
      el('title', {}, hit, it[4]);
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); it[3](S()); render(); });
      return { r, t1, t2, it };
    });
    el('rect', { x: x0 + w - 90, y: y0 + h - 40, width: 78, height: 32, rx: 4, class: 'mm-cell' }, m);
    const ax = x0 + w - 51, ay = y0 + h - 24;
    el('path', { d: 'M' + (ax + 12) + ' ' + (ay - 7) + 'H' + (ax - 4) + 'A7 7 0 0 0 ' + (ax - 4) + ' ' + (ay + 7) + 'H' + (ax + 6) + 'M' + (ax - 1) + ' ' + (ay - 12) + 'L' + (ax - 7) + ' ' + (ay - 7) + 'L' + (ax - 1) + ' ' + (ay - 2), class: 'ic-back' }, m);
    const back = el('rect', { x: x0 + w - 90, y: y0 + h - 40, width: 78, height: 32, class: 'hs lcd-hit' }, m);
    el('title', {}, back, 'Retour (comme EXIT)');
    back.addEventListener('click', (ev) => { ev.stopPropagation(); L.func = false; render(); });
  }
  function drawIcFunc(s) {
    if (!LCD.icFuncG) return;
    LCD.icFuncG.style.display = L.func ? '' : 'none';
    if (!L.func) return;
    for (const b of LCD.icfBtns) {
      const [lab, val, on] = b.it;
      const L1 = typeof lab === 'function' ? lab(s) : lab;
      // « P.AMP/ATT » sur deux lignes, comme sur le TRX
      if (b.lab !== L1) {
        b.lab = L1;
        b.t1.textContent = '';
        const parts = L1 === 'P.AMP/ATT' ? ['P.AMP/', 'ATT'] : [L1];
        parts.forEach((p, i) => { const ts = document.createElementNS('http://www.w3.org/2000/svg', 'tspan'); ts.setAttribute('x', b.t1.getAttribute('x')); ts.setAttribute('dy', i ? '1.05em' : parts.length > 1 ? '-0.45em' : '0'); ts.textContent = p; b.t1.appendChild(ts); });
      }
      b.t2.textContent = val(s);
      b.r.classList.toggle('on', !!on(s)); // AGC et TBW ont toujours une valeur : toujours encadrés, comme sur le TRX
    }
  }
  // QSO RECORDER (MENU → RECORD) : enregistrement sur la carte SD du TRX, pas commandable par le CAT
  function buildIcRec(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = LCD.icRecG = el('g', { class: 'mode-menu ic-menu', style: 'display:none' }, g);
    const x0 = X(6), y0 = Y(4), w = c.w - 12, h = c.h - 8;
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 4, class: 'mm-bg' }, m);
    el('rect', { x: x0 + 4, y: y0 + 4, width: w - 8, height: 24, rx: 3, class: 'mm-title' }, m);
    el('text', { x: x0 + w / 2, y: y0 + 21, class: 'mm-ttl big', 'text-anchor': 'middle' }, m, 'QSO RECORDER');
    el('text', { x: x0 + w - 12, y: y0 + 22, class: 'mm-ttl big', 'text-anchor': 'end' }, m, '1/1');
    const rx = x0 + 6, rw = w - 96, ry = y0 + 32, rh = (h - 38) / 4;
    ['<<REC Start>>', 'Play Files', 'Recorder Set', 'Player Set'].forEach((t, i) => {
      const y = ry + i * rh;
      el('rect', { x: rx, y, width: rw, height: rh - 3, class: 'im-row' + (i ? '' : ' sel') }, m);
      el('text', { x: rx + 14, y: y + rh / 2 + 7, class: 'im-n' + (i ? '' : ' sel') }, m, t);
      const hit = el('rect', { x: rx, y, width: rw, height: rh - 3, class: 'hs lcd-hit' }, m);
      el('title', {}, hit, t);
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); say('QSO RECORDER (' + t.replace(/[<>]/g, '') + ') : l’enregistreur écrit sur la carte SD du TRX ; il ne se commande pas par le CAT (pas à distance).', '', 5000); });
    });
    const back = el('rect', { x: x0 + w - 84, y: y0 + h - 58, width: 76, height: 52, rx: 4, class: 'mm-cell' }, m);
    const ax = x0 + w - 46, by = y0 + h - 32;
    el('path', { d: 'M' + (ax + 12) + ' ' + (by - 7) + 'H' + (ax - 4) + 'A7 7 0 0 0 ' + (ax - 4) + ' ' + (by + 7) + 'H' + (ax + 6) + 'M' + (ax - 1) + ' ' + (by - 12) + 'L' + (ax - 7) + ' ' + (by - 7) + 'L' + (ax - 1) + ' ' + (by - 2), class: 'ic-back' }, m);
    const hit = el('rect', { x: x0 + w - 84, y: y0 + h - 58, width: 76, height: 52, class: 'hs lcd-hit' }, m);
    el('title', {}, hit, 'Retour');
    hit.addEventListener('click', (ev) => { ev.stopPropagation(); L.icRec = false; render(); });
    void back;
  }
  // ---- AUDIO SCOPE (MENU → AUDIO) : FFT (avec sa cascade) et oscilloscope de la BF reçue ; touches ATT, HOLD, LEVEL, TIME, EXPD/SET
  // ATT, LEVEL et TIME : pas de commande CAT (réglés sur la page, gardés dans ce navigateur) ; au départ 100 ms/Div comme le TRX
  const AUD = { att: 0, lvl: 0, time: 4, exp: false, env: new Float32Array(4000), envN: 0 }; // env : crêtes par tranche de 1 ms (4 s)
  // Comme le TRX (manuel 5-9) : ATT 0 / 10 / 20 / 30 dB, LEVEL 0 / −10 / −20 / −30 dB, TIME 1 / 3 / 10 / 30 / 100 / 300 ms par division
  const AUD_ATT = [0, 10, 20, 30], AUD_LVL = [0, -10, -20, -30], AUD_TIME = [['1ms', 0.001], ['3ms', 0.003], ['10ms', 0.01], ['30ms', 0.03], ['100ms', 0.1], ['300ms', 0.3]];
  // AUDIO SCOPE SET du TRX (1A 05 0151 – 0154), relu à l'ouverture de l'écran AUDIO et appliqué au dessin de la page
  try { const a = JSON.parse(store.get('rs.face.aud', '') || 'null'); if (a) { AUD.att = a.att % 4 || 0; AUD.lvl = a.lvl % 4 || 0; AUD.time = a.time % 6; if (!(AUD.time >= 0)) AUD.time = 4; } } catch (e) {}
  const audSave = () => store.set('rs.face.aud', JSON.stringify({ att: AUD.att, lvl: AUD.lvl, time: AUD.time }));
  function audRead() { if (!iControl() || !R.EX || !R.EX[151]) return; [151, 152, 153, 154].forEach((n, i) => setTimeout(() => send({ t: 'set', ctl: 'exRead', value: n }), i * 130)); }
  function audSet() {
    const s = S(), rgb = (v, d) => { const a = String(v == null ? '' : v).split(',').map(Number); return a.length === 3 && a.every((x) => x >= 0 && x <= 255) ? a : d; };
    return { line: Number(s.ex151) === 1, fft: rgb(s.ex152, [51, 153, 255]), wf: s.ex153 == null ? true : Number(s.ex153) === 1, osc: rgb(s.ex154, [0, 255, 0]) };
  }
  function buildIcAudio(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = LCD.icAudio = lcdOverlay(g, 'ica');
    const y0 = G.scopeY + IC_AUD_H + 2, bw = (c.w - 12) / 5, h = c.h - y0 - 5;
    el('rect', { x: X(5), y: Y(y0 - 2), width: c.w - 10, height: h + 4, class: 'icm-bg' }, m);
    void bw;
    LCD.icaBtns = keyRow(m, X, Y, c, y0, [
      ['ATT', 'ATT : affaiblissement de la FFT (0, 10, 20, 30 dB) — pas celui du récepteur ; appui long : OFF', () => { AUD.att = (AUD.att + 1) % AUD_ATT.length; audSave(); }, () => { AUD.att = 0; audSave(); return true; }],
      ['HOLD', 'HOLD : fige l’AUDIO SCOPE', () => { L.hold = !L.hold; }],
      ['LEVEL', 'LEVEL : niveau de l’oscilloscope (0, −10, −20, −30 dB)', () => { AUD.lvl = (AUD.lvl + 1) % AUD_LVL.length; audSave(); }],
      ['TIME', 'TIME : base de temps de l’oscilloscope (1, 3, 10, 30, 100, 300 ms par division)', () => { AUD.time = (AUD.time + 1) % AUD_TIME.length; audSave(); }],
      ['EXPD/SET', 'EXPD/SET : AUDIO SCOPE agrandi (sans la bande du scope) ; nouveau clic : normal ; appui long : AUDIO SCOPE SET',
        () => { AUD.exp = !AUD.exp; }, () => { L.icSet = true; L.icSub = 'audio'; L.icSubP = 0; subRead(); return true; }]
    ]);
  }
  function drawIcAudioKeys() {
    const b = LCD.icaBtns;
    if (b) { b[1].r.classList.toggle('on', !!L.hold); b[4].r.classList.toggle('on', !!AUD.exp); }
  }
  // Crêtes de la BF par tranches de 1 ms (oscilloscope lent : 30 à 300 ms par division)
  function audEnv(pcm, rate) {
    const blk = Math.max(1, Math.round(rate * 0.001));
    for (let i = 0; i + blk <= pcm.length; i += blk) {
      let pk = 0;
      for (let j = i; j < i + blk; j++) { const v = Math.abs(pcm[j]); if (v > pk) pk = v; }
      AUD.env.copyWithin(0, 1); AUD.env[AUD.env.length - 1] = pk; AUD.envN = Math.min(AUD.env.length, AUD.envN + 1);
    }
  }
  function drawIcAudio(c2, W, H, specs, pal, nb, lvl, maxHz) {
    const sp = specs[0], buf = WF.l;
    const as = audSet();
    const hs = AUD.exp ? 0 : Math.round(H * IC_STRIP / IC_AUD_H), ht = Math.round(H * 18 / IC_AUD_H), yb = hs + ht, hb = H - yb;
    if (!AUD.exp && !rfFresh()) drawScope(c2, { sp, x0: 0, y0: 0, w: W, h: hs, name: '' }, pal, nb, lvl, maxHz); // sinon : scope du TRX (rfsOn)
    // Bandeau « AUDIO SCOPE », avec ATT et HOLD de l'AUDIO SCOPE à gauche
    c2.fillStyle = '#1d2433'; c2.fillRect(0, hs, W, ht);
    c2.font = 'bold ' + Math.round(ht * 0.72) + 'px Arial, sans-serif'; c2.textAlign = 'center'; c2.fillStyle = '#e6e9ef';
    c2.fillText('AUDIO SCOPE', W / 2, hs + ht * 0.78);
    const pill = (x, w, t, on, fg) => { c2.fillStyle = on ? '#4a5368' : '#2a3142'; c2.beginPath(); c2.roundRect(x, hs + 2, w, ht - 4, (ht - 4) / 2); c2.fill(); c2.fillStyle = fg || (on ? '#fff' : '#7d8596'); c2.font = 'bold ' + Math.round(ht * 0.55) + 'px Arial, sans-serif'; c2.fillText(t, x + w / 2, hs + ht * 0.72); };
    pill(W * 0.02, W * 0.14, AUD_ATT[AUD.att] ? 'ATT ' + AUD_ATT[AUD.att] + 'dB' : 'ATT OFF', true, '#ff9a1f'); // valeur en orange, comme sur le TRX
    pill(W * 0.19, W * 0.1, 'HOLD', !!L.hold);
    // FFT 0 – 4 kHz avec sa cascade (à gauche)
    const fHz = Math.min(4000, WF.rate / 2), nb4 = Math.max(2, Math.floor((WF.n / 2) * fHz / (WF.rate / 2)));
    const wl = Math.floor(W * 0.585);
    // Niveaux comme le TRX : FFT en dB linéaire (40 dB sur la hauteur), le bruit dans la bande passante du filtre (médiane) vers 45 %,
    // hors bande : noir ; ATT 20 dB : le bruit disparaît, les signaux restent ; à l'oscilloscope, le bruit remplit l'écran à LEVEL −20 dB
    // (références suivies lentement : ATT et LEVEL gardent leur effet)
    if (sp && !L.hold) {
      const fl = LCD.flt && LCD.flt.A, bw = fHz / nb4;
      let i0 = 1, i1 = nb4;
      if (fl && fl.hz) { const c0 = audioCenter(fl.mode || '', fl.hz) + (fl.sh || 0); i0 = Math.max(1, Math.round((c0 - fl.hz * 0.4) / bw)); i1 = Math.min(nb4, Math.max(i0 + 2, Math.round((c0 + fl.hz * 0.4) / bw))); }
      const a = Array.from(sp.subarray(i0, i1)).sort((x, y) => x - y), p90 = a[a.length >> 1] || 0;
      AUD.p90 = AUD.p90 == null ? p90 : AUD.p90 + (p90 - AUD.p90) * 0.03;
      const n = Math.min(buf.length, Math.round(WF.rate * 0.25)), b2 = new Float32Array(n);
      for (let i = 0; i < n; i++) b2[i] = Math.abs(buf[buf.length - n + i]);
      b2.sort(); const md = Math.max(1e-5, b2[n >> 1] || 0);
      AUD.md = AUD.md == null ? md : AUD.md + (md - AUD.md) * 0.03;
    }
    // Comme le TRX : cascade bleue, pas de repère du filtre, échelle 0 … 4.0kHz
    drawScope(c2, { sp, x0: 0, y0: yb, w: wl, h: hb, name: '', color: as.fft, line: as.line, wf: as.wf, noMarker: true, audScale: true, lin: true }, AUD.pal || (AUD.pal = mkPal([[0, [0, 0, 0]], [0.22, [0, 30, 140]], [0.45, [0, 90, 225]], [0.72, [90, 180, 255]], [1, [230, 245, 255]]])), nb4, 0.45 - (AUD.p90 == null ? 0.45 : AUD.p90) - AUD_ATT[AUD.att] / 40, fHz);
    // Oscilloscope (à droite) : forme d'onde verte ; à 100 ms par division, les crêtes de la dernière seconde
    const ox = wl + 4, ow = W - ox, lab = Math.max(10, Math.min(15, Math.round(hb * 0.12))), gh = hb - lab - 2, mid = yb + gh / 2;
    c2.fillStyle = '#000'; c2.fillRect(ox - 2, yb, ow + 2, hb);
    c2.strokeStyle = 'rgba(120,130,145,.35)'; c2.lineWidth = 1;
    for (let k = 1; k < 10; k++) { const gx = Math.round(ox + ow * k / 10) + 0.5; c2.beginPath(); c2.moveTo(gx, yb); c2.lineTo(gx, yb + gh); c2.stroke(); }
    for (let k = 1; k < 4; k++) { const gy = Math.round(yb + gh * k / 4) + 0.5; c2.beginPath(); c2.moveTo(ox, gy); c2.lineTo(ox + ow, gy); c2.stroke(); }
    // Pleine échelle à 0 dB = 0,3 × la médiane de |BF| : à −20 dB, les crêtes du bruit (2 à 4 × la médiane) remplissent l'écran, comme sur le TRX
    const gain = Math.pow(10, AUD_LVL[AUD.lvl] / 20), k = (gh / 2 - 2) / ((AUD.md || 0.02) * 0.3) * gain;
    const tdiv = AUD_TIME[AUD.time][1];
    const oc = 'rgb(' + as.osc.join(',') + ')';
    c2.strokeStyle = oc; c2.fillStyle = oc; c2.lineWidth = 1.2;
    if (10 * tdiv * WF.rate > buf.length) {
      const n = Math.min(AUD.envN, Math.round(10 * tdiv / 0.001)), e = AUD.env, e0 = e.length - n;
      const cols = Math.min(ow, Math.round(10 * tdiv / 0.001));
      for (let px = 0; px < cols && n; px++) {
        const i0 = e0 + Math.floor(px / cols * n), i1 = Math.max(i0 + 1, e0 + Math.floor((px + 1) / cols * n));
        let pk = 0;
        for (let i = i0; i < i1; i++) if (e[i] > pk) pk = e[i];
        const a = Math.min(gh / 2, pk * k);
        c2.fillRect(ox + px * ow / cols, mid - a, Math.max(1, ow / cols - 0.3), 2 * a);
      }
    } else {
      const n = Math.min(buf.length, Math.round(10 * tdiv * WF.rate)), s0 = buf.length - n;
      c2.beginPath();
      for (let i = 0; i < n; i++) { const x = ox + i * ow / (n - 1), y = mid - Math.max(-gh / 2, Math.min(gh / 2, buf[s0 + i] * k)); i ? c2.lineTo(x, y) : c2.moveTo(x, y); }
      c2.stroke();
    }
    c2.fillStyle = '#e6e9ef'; c2.font = 'bold ' + Math.round(lab * 0.85) + 'px Arial, sans-serif';
    c2.textAlign = 'left'; c2.fillText('LEVEL: ' + AUD_LVL[AUD.lvl] + 'dB', ox + 4, yb + hb - 2);
    c2.textAlign = 'right'; c2.fillText(AUD_TIME[AUD.time][0] + '/Div', ox + ow - 3, yb + hb - 2);
  }
  // IC-7300 : en-tête de l'écran comme sur le TRX — TUNE / TX, mode (badge bleu, clic = tableau des modes), dessin du filtre, FIL (clic = suivant),
  // heure, case de la fonction du bouton MULTI (RIT / ΔTX en service), voyants P.AMP / ATT / NB / NR / AN / MN / COMP…, VFO A, fréquence, RIT / ΔTX et son décalage
  function buildIcomHead(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const h = LCD.ich = el('g', { class: 'ich' }, g);
    const tag = (x, y, w, hh, cls, t) => { const r = el('rect', { x: X(x), y: Y(y), width: w, height: hh, rx: 2, class: 'ich-tag ' + cls }, h); const tt = el('text', { x: X(x + w / 2), y: Y(y + hh / 2 + 4.5), class: 'ich-tagt ' + cls, 'text-anchor': 'middle' }, h, t); return { r, t: tt }; };
    LCD.icTune = tag(6, 4, 50, 17, 'tune', 'TUNE');
    // Indicateur d'émission du TRX : « TX » rouge sur noir en réception (fréquence dans une bande amateur), blanc sur rouge en émission,
    // barré hors des bandes amateur
    LCD.icTx = tag(6, 24, 50, 17, 'tx', 'TX');
    LCD.icTxBar = el('line', { x1: X(10), y1: Y(39), x2: X(52), y2: Y(26), class: 'ich-txbar' }, h);
    // Mode : badge bleu
    el('rect', { x: X(62), y: Y(5), width: 112, height: 32, rx: 4, class: 'ich-mode' }, h);
    LCD.icMode = el('text', { x: X(118), y: Y(29), class: 'ich-modet', 'text-anchor': 'middle' }, h, '—');
    const mh = el('rect', { x: X(62), y: Y(5), width: 112, height: 32, class: 'hs lcd-hit' }, h);
    el('title', {}, mh, 'Mode : clic pour le tableau des modes');
    mh.addEventListener('click', (ev) => { ev.stopPropagation(); openModeMenu(); });
    // Dessin du filtre (trapèze) et case FIL
    LCD.icFlt = el('path', { d: '', class: 'ich-flt' }, h);
    el('rect', { x: X(250), y: Y(5), width: 70, height: 32, rx: 4, class: 'ich-fil' }, h);
    LCD.icFil = el('text', { x: X(285), y: Y(29), class: 'ich-filt', 'text-anchor': 'middle' }, h, 'FIL');
    const fh = el('rect', { x: X(250), y: Y(5), width: 70, height: 32, class: 'hs lcd-hit' }, h);
    el('title', {}, fh, 'FIL : clic pour le filtre suivant (FIL1 → FIL2 → FIL3)');
    fh.addEventListener('click', (ev) => { ev.stopPropagation(); cycleCell('fil'); });
    // Heure (de ce PC) et case de la fonction du bouton MULTI, en haut à droite
    LCD.icClock = el('text', { x: X(492), y: Y(30), class: 'ich-clock', 'text-anchor': 'end' }, h, '');
    // Voyants des fonctions en service
    LCD.icTags = el('text', { x: X(62), y: Y(53), class: 'ich-tags' }, h, '');
    // RFG (orange, sous le mode) : gain HF (RF/SQL) pas au maximum, comme sur le TRX
    LCD.icRfg = el('text', { x: X(118), y: Y(53), class: 'ich-rfg', 'text-anchor': 'middle' }, h, 'RFG');
    LCD.icVfo = el('text', { x: X(338), y: Y(56), class: 'ich-vfo' }, h, 'VFO A');
    LCD.icSplit = tag(512, 37, 82, 20, 'split', 'SPLIT');
    // AUTO TUNE en cours : « AUTOTUNE » blanc gras sur fond rouge, cadre blanc, au-dessus des deux derniers chiffres de la fréquence
    LCD.icAt = tag(518, 37, 76, 20, 'autotune', 'AUTOTUNE');
    // Fréquence (police du TRX : MHz.kHz.dizaines de Hz) ; clic = taper une fréquence
    LCD.icFreq = el('text', { x: X(492), y: Y(100), class: 'ich-freq', 'text-anchor': 'end' }, h, '');
    const qh = el('rect', { x: X(215), y: Y(60), width: 280, height: 44, class: 'hs lcd-hit' }, h);
    el('title', {}, qh, 'Taper une fréquence');
    qh.addEventListener('click', () => askFreq('A'));
    // RIT / ΔTX et le décalage, à droite de la fréquence
    LCD.icRitL = el('text', { x: X(592), y: Y(73), class: 'ich-ritl', 'text-anchor': 'end' }, h, '');
    LCD.icRitV = el('text', { x: X(592), y: Y(98), class: 'ich-ritv', 'text-anchor': 'end' }, h, '');
    // S/Po : sous le mode, à gauche de la fréquence
    if (LCD.spo) LCD.spo.g.setAttribute('transform', 'translate(0,' + 32 + ')');
    // Sous les tableaux (MENU, QUICK, FUNCTION, modes…) : juste après le scope dans l'ordre de dessin
    const at = LCD.hint && LCD.hint.nextSibling;
    if (at) { g.insertBefore(h, at); if (LCD.spo) g.insertBefore(LCD.spo.g, h); if (LCD.spoBig) g.insertBefore(LCD.spoBig.g, h); }
    // Case du bouton MULTI : en haut à droite
    if (LCD.fbox) {
      for (const e of [LCD.fbox.r]) { e.setAttribute('x', X(500)); e.setAttribute('y', Y(9)); e.setAttribute('width', 90); e.setAttribute('height', 22); e.setAttribute('rx', 5); }
      LCD.fbox.tab = el('rect', { x: X(590), y: Y(15), width: 4, height: 10, rx: 1, class: 'ich-fbtab', style: 'display:none' }, LCD.fbox.r.parentNode);
      LCD.fbox.t.setAttribute('x', X(545)); LCD.fbox.t.setAttribute('y', Y(25.5)); LCD.fbox.v.style.display = 'none';
      const hit = LCD.fbox.r.parentNode.querySelector('.hs.lcd-hit[y="' + Y(57) + '"][x="' + X(520) + '"]');
      if (hit) { hit.setAttribute('x', X(500)); hit.setAttribute('y', Y(9)); hit.setAttribute('width', 94); hit.setAttribute('height', 22); }
    }
  }
  function drawIcomHead(s, tx) {
    if (!LCD.ich) return;
    const X = LCD.X, Y = LCD.Y;
    const show = (o, on) => { o.r.style.display = on ? '' : 'none'; o.t.style.display = on ? '' : 'none'; };
    show(LCD.icTune, !!(s.tuner || s.tuning));
    show(LCD.icAt, Date.now() - (L.atAt || 0) < 1500);
    const fA = s.freq || 0, inBand = BANDS.some((b) => fA >= b[1] && fA <= b[2]);
    show(LCD.icTx, !!fA || !!tx);
    LCD.icTx.r.classList.toggle('on', !!tx); LCD.icTx.t.classList.toggle('on', !!tx);
    LCD.icTxBar.style.display = fA && !tx && !inBand ? '' : 'none';
    const md = s.mode || '—';
    LCD.icMode.textContent = md;
    show(LCD.icSplit, !!s.split && !(Date.now() - (L.atAt || 0) < 1500));
    LCD.icFil.textContent = s.fil ? 'FIL' + s.fil : 'FIL';
    // Petit trapèze du filtre (largeur selon FIL et PBT), comme le dessin à côté du mode
    const fl = LCD.flt && LCD.flt.A;
    const fw = fl ? Math.max(0.25, Math.min(1, fl.hz / 3600)) : 0.7, off = fl ? Math.max(-0.3, Math.min(0.3, (fl.sh || 0) / 3000)) : 0;
    const cx = X(214) + off * 50, half = 26 * fw, y0 = Y(31), y1 = Y(12);
    LCD.icFlt.setAttribute('d', 'M' + X(180) + ' ' + y0 + 'H' + (cx - half - 6) + 'L' + (cx - half) + ' ' + y1 + 'H' + (cx + half) + 'L' + (cx + half + 6) + ' ' + y0 + 'H' + X(246) + 'M' + cx + ' ' + (y0 - 1) + 'V' + (y0 - 7));
    const d = new Date();
    LCD.icClock.textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    const tags = [];
    if (s.preamp) tags.push('P.AMP' + s.preamp);
    if (s.att) tags.push('ATT');
    if (s.ipPlus) tags.push('IP+');
    if (s.nb) tags.push('NB');
    if (s.nr) tags.push('NR');
    if (s.dnf) tags.push('AN'); else if (s.notch) tags.push('MN');
    if (s.proc && !/^(CW|RTTY)/.test(md)) tags.push('COMP');
    if (s.vox) tags.push('VOX');
    if (/^CW/.test(md) && s.bkin) tags.push(s.bkin === 2 ? 'F-BKIN' : 'BKIN');
    if (s.lock) tags.push('LOCK');
    tags.push('AGC-' + (['', 'F', 'M', 'S'][s.agc] || '?'));
    LCD.icTags.textContent = tags.join('   ');
    const rfg = s.rf != null && s.rf < 250;
    LCD.icRfg.style.display = rfg && !L.icBig ? '' : 'none';
    if (!L.icBig) LCD.icTags.setAttribute('x', X(rfg ? 150 : 62));
    // Grande fréquence : le VFO en service ; en SPLIT, pendant l'émission, le VFO d'émission (comme sur le TRX). L'autre VFO à droite, en plus petit
    const fmt = (f) => (f ? Math.floor(f / 1e6) + '.' + String(Math.floor(f / 1000) % 1000).padStart(3, '0') + '.' + String(Math.floor(f / 10) % 100).padStart(2, '0') : '—');
    const act = s.vfoSel === 1 ? 'B' : 'A', main = s.split && tx ? (act === 'A' ? 'B' : 'A') : act, other = main === 'A' ? 'B' : 'A';
    // XFC : tant que le TRX n'a pas encore relu l'échange (≤ 1,5 s), on montre déjà les fréquences inversées (puis remises au relâchement)
    const xs = L.xfcSnap, xfcF = (v, k) => {
      if (!xs || Date.now() - xs.at > 1500) return v;
      const mine = k === 'a' ? xs.a : xs.b, other = k === 'a' ? xs.b : xs.a;
      return !xs.back ? (v === mine ? other : v) : (v === other ? mine : v);
    };
    const fq = (sd) => (sd === 'A' ? xfcF(s.freq, 'a') : xfcF(s.freqB, 'b'));
    // Nom affiché : VFO A ou B en service sur le TRX (vfoAB) ; s.freq est toujours celle du VFO en service
    // XFC tenu (SPLIT) : les VFO sont inversés, le nom suit (VFO B pendant l'appui si on était sur A), comme sur le TRX
    const abName = (sd) => ((sd === 'A') === ((s.vfoAB !== 1) !== !!L.xfcOn) ? 'A' : 'B');
    LCD.icVfo.textContent = 'VFO ' + abName(main);
    // SPLIT en émission : fréquences d'émission et de réception notées au début de l'émission et gardées jusqu'à la fin
    // (l'IC-7300 échange ce qu'il répond pour le VFO en service et l'autre pendant l'émission : sans cela, l'affichage ferait l'aller-retour)
    if (s.split && tx) { if (!L.txSnap) L.txSnap = { tx: fq(main), rx: fq(other) }; L.txPost = null; }
    else if (L.txSnap) { L.txPost = { rx: L.txSnap.rx, tx: L.txSnap.tx, at: Date.now() }; L.txSnap = null; }
    // Juste après l'émission : tant que le TRX n'a pas été relu (≤ 2 s), on garde les fréquences d'avant l'émission
    const post = L.txPost && !tx && s.split && Date.now() - L.txPost.at < 2000 && fq(main) !== L.txPost.rx ? L.txPost : null;
    if (L.txPost && !post) L.txPost = null;
    const fqm = L.txSnap ? L.txSnap.tx : post ? post.rx : fq(main), fqo = L.txSnap ? L.txSnap.rx : post ? post.tx : fq(other);
    if (post) setTimeout(render, 300);
    LCD.icFreq.textContent = fmt(fqm);
    LCD.icFreq.classList.toggle('txsplit', !!s.split && !!tx); // SPLIT : la fréquence d'émission (en grand pendant l'émission) en rouge
    const ron = !!(s.rit || s.xit), cv = s.clar || 0, ritL = s.rit && s.xit ? 'RIT ΔTX' : s.rit ? 'RIT' : 'ΔTX';
    LCD.icRitL.textContent = ron ? ritL : '';
    LCD.icRitV.textContent = s.split ? fmt(fqo) : ron ? (cv < 0 ? '-' : '') + (Math.abs(cv) / 1000).toFixed(2) : '';
    LCD.icRitV.classList.toggle('sub', !!s.split);
    // Fréquence plus à gauche quand le RIT / ΔTX ou l'autre VFO (SPLIT) est affiché à droite
    const big = !!L.icBig;
    if (big) {
      // Grand écran des mesures (M.SCOPE) : grande fréquence au milieu, « VFO A » à sa droite ; RIT / ΔTX et l'autre VFO à droite du grand S/Po
      LCD.icFreq.setAttribute('x', X(470)); LCD.icFreq.setAttribute('y', Y(126));
      LCD.icVfo.setAttribute('x', X(592)); LCD.icVfo.setAttribute('y', Y(92)); LCD.icVfo.setAttribute('text-anchor', 'end');
      LCD.icTags.setAttribute('x', X(110)); LCD.icTags.setAttribute('y', Y(L.icView === 'scope' ? 141 : 150));
      const sc = L.icView === 'scope'; // SPECTRUM SCOPE dessous : RIT / ΔTX et l'autre VFO un peu plus haut
      LCD.icRitL.setAttribute('y', Y(sc ? 146 : 160)); LCD.icRitV.setAttribute('y', Y(sc ? 172 : 190));
    } else if (L.icView === 'scope' && L.iscExp) {
      // EXPD/SET : fréquence remontée à côté du S/Po (le scope monte jusque sous elle)
      LCD.icFreq.setAttribute('x', X(s.split ? 438 : ron ? 492 : 560)); LCD.icFreq.setAttribute('y', Y(80));
      LCD.icVfo.setAttribute('x', X(338)); LCD.icVfo.setAttribute('y', Y(44)); LCD.icVfo.setAttribute('text-anchor', 'start');
      LCD.icTags.setAttribute('x', X(LCD.icRfg.style.display === 'none' ? 62 : 150)); LCD.icTags.setAttribute('y', Y(53));
      LCD.icRitL.setAttribute('y', Y(56)); LCD.icRitV.setAttribute('y', Y(80));
    } else {
      LCD.icFreq.setAttribute('x', X(s.split ? 438 : ron ? 492 : 592)); LCD.icFreq.setAttribute('y', Y(100));
      LCD.icVfo.setAttribute('x', X(338)); LCD.icVfo.setAttribute('y', Y(56)); LCD.icVfo.setAttribute('text-anchor', 'start');
      LCD.icTags.setAttribute('x', X(LCD.icRfg.style.display === 'none' ? 62 : 150)); LCD.icTags.setAttribute('y', Y(53));
      LCD.icRitL.setAttribute('y', Y(73)); LCD.icRitV.setAttribute('y', Y(98));
    }
    LCD.icFreq.classList.toggle('sm', (!!s.split || (L.icView === 'scope' && !!L.iscExp)) && !big);
    if (LCD.spo) {
      // En SPLIT (fréquence plus à gauche) : S/Po resserré pour ne pas passer sous la fréquence
      const dy = L.icView === 'scope' && L.iscExp ? 20 : 32, k = s.split ? 0.78 : 1, x0 = X(52);
      const t = 'translate(' + (x0 * (1 - k)).toFixed(1) + ',' + dy + ') scale(' + k + ',1)';
      if (LCD.spo.tr !== t) { LCD.spo.tr = t; LCD.spo.g.setAttribute('transform', t); }
    }
    LCD.icFreq.classList.toggle('big', big);
    LCD.icVfo.classList.toggle('big', big);
    LCD.icTags.classList.toggle('big', big);
    // Case du haut à droite : seulement « RIT ΔTX » quand ils sont en service (pas de nom de fonction comme chez Yaesu)
    if (LCD.fbox) { LCD.fbox.t.textContent = ron ? ritL : ''; LCD.fbox.r.classList.toggle('icrit', ron); LCD.fbox.r.style.display = ron ? '' : 'none'; if (LCD.fbox.tab) LCD.fbox.tab.style.display = ron ? '' : 'none'; }
  }
  // IC-7300 : S-mètre en bargraph « S/Po » (1 · 5 · 9 en blanc, + 20 / 40 / 60 en points rouges), comme sur l'écran du TRX
  const SPO_N = 40;
  function buildSpoBar(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = el('g', { class: 'spo' }, g);
    const x0 = X(52), x1 = X(262), y = Y(46); // assez large pour 1 3 5 7 9 +20 +40 +60dB, comme sur le TRX
    const lab = el('text', { x: X(48), y: y + 9, class: 'spo-lab', 'text-anchor': 'end' }, m, 'S/Po');
    // Clic sur S/Po : S/Po → S/SWR → S/ALC → S/COMP → S/Vd → S/Id (S en réception ; en émission : Po, ROS, ALC, compression, tension ou courant), comme sur le TRX
    const lh = el('rect', { x: X(2), y: y - 12, width: 48, height: 24, class: 'hs lcd-hit' }, m);
    el('title', {}, lh, 'Clic : S/Po → S/SWR → S/ALC → S/COMP → S/Vd → S/Id (mesure montrée en émission)');
    lh.addEventListener('click', (ev) => { ev.stopPropagation(); spoCycle(); });
    // Échelle : S1 … S9 sur 55 % de la largeur, puis + 20 / + 40 / + 60 en rouge
    const sx = (f) => x0 + f * (x1 - x0);
    for (const [f, t] of [[0.04, '1'], [0.17, '3'], [0.3, '5'], [0.42, '7'], [0.55, '9']]) el('text', { x: sx(f), y: y - 4, class: 'spo-num', 'text-anchor': 'middle' }, m, t);
    for (const [f, t] of [[0.66, '+20'], [0.79, '+40'], [0.9, '+60dB']]) el('text', { x: sx(f), y: y - 4, class: 'spo-num red', 'text-anchor': f > 0.85 ? 'start' : 'middle' }, m, t);
    el('line', { x1: sx(0.55), y1: y - 1, x2: x1, y2: y - 1, class: 'spo-red' }, m);
    el('rect', { x: x0 - 1, y: y - 0.5, width: x1 - x0 + 2, height: 11, class: 'spo-frame' }, m);
    const segs = [];
    const sw = (x1 - x0) / SPO_N;
    for (let i = 0; i < SPO_N; i++) segs.push(el('rect', { x: x0 + i * sw + 0.4, y: y + 1, width: sw - 0.8, height: 8, class: 'spo-seg' }, m));
    LCD.spo = { g: m, segs, lab };
    // Grand S/Po du grand écran des mesures (M.SCOPE) : S 1 … 9, + 20 / + 40 / + 60 dB en rouge au-dessus ; Po 0 / 25 / 50 / 100 % dessous
    const b = el('g', { class: 'spo big', style: 'display:none' }, g);
    const bx0 = X(62), bx1 = X(398), by = Y(178), bs = (f) => bx0 + f * (bx1 - bx0);
    el('text', { x: X(52), y: by - 5, class: 'spo-lab big', 'text-anchor': 'end' }, b, 'S');
    const blab = el('text', { x: X(52), y: by + 25, class: 'spo-lab big', 'text-anchor': 'end' }, b, 'Po');
    const bh = el('rect', { x: X(4), y: by - 18, width: 52, height: 48, class: 'hs lcd-hit' }, b);
    el('title', {}, bh, 'Clic : Po → SWR → ALC → COMP → Vd → Id (mesure montrée en émission)');
    bh.addEventListener('click', (ev) => { ev.stopPropagation(); spoCycle(); });
    for (const [f, t] of [[0.02, '1'], [0.14, '3'], [0.26, '5'], [0.38, '7'], [0.5, '9']]) el('text', { x: bs(f), y: by - 5, class: 'spo-num big', 'text-anchor': 'middle' }, b, t);
    for (const [f, t] of [[0.66, '+20'], [0.82, '+40'], [0.98, '+60dB']]) el('text', { x: bs(f), y: by - 5, class: 'spo-num big red', 'text-anchor': 'middle' }, b, t);
    // Échelle du bas : selon la mesure choisie (Po, SWR, ALC, COMP) ; 6 emplacements remplis par drawSpoBar
    const bnums = [0, 1, 2, 3, 4, 5].map(() => el('text', { x: bs(0), y: by + 25, class: 'spo-num big', 'text-anchor': 'middle' }, b, ''));
    el('line', { x1: bs(0.5), y1: by - 1, x2: bx1, y2: by - 1, class: 'spo-red' }, b);
    el('rect', { x: bx0 - 1, y: by - 0.5, width: bx1 - bx0 + 2, height: 13, class: 'spo-frame' }, b);
    const bsegs = [], bw = (bx1 - bx0) / SPO_NB;
    for (let i = 0; i < SPO_NB; i++) bsegs.push(el('rect', { x: bx0 + i * bw + 0.5, y: by + 1, width: bw - 1, height: 10, class: 'spo-seg' }, b));
    LCD.spoBig = { g: b, segs: bsegs, lab: blab, nums: bnums, bs };
  }
  const SPO_NB = 64;
  // Mesure du bargraph en émission : Po, SWR, ALC ou COMP (échelles du bas du grand S/Po, comme sur le TRX)
  const SPO_MT = [['Po', [[0.02, '0'], [0.25, '25'], [0.5, '50'], [0.97, '100%']]], ['SWR', [[0.02, '1'], [0.15, '1.5'], [0.26, '2'], [0.4, '2.5'], [0.53, '3'], [0.97, '∞']]],
    ['ALC', [[0.02, '0'], [0.5, 'ALC ZONE'], [0.97, 'MAX']]], ['COMP', [[0.02, '0'], [0.2, '5'], [0.4, '10'], [0.6, '15'], [0.8, '20'], [0.97, 'dB']]],
    ['Vd', [[0.02, '10'], [0.33, '12'], [0.67, '14'], [0.97, '16V']]], ['Id', [[0.02, '0'], [0.2, '5'], [0.4, '10'], [0.6, '15'], [0.8, '20'], [0.97, '25A']]]];
  L.icMt = Math.max(0, Math.min(5, parseInt(store.get('rs.face.ic.mt', '0'), 10) || 0));
  function spoCycle() { L.icMt = (L.icMt + 1) % SPO_MT.length; store.set('rs.face.ic.mt', L.icMt); LCD.spoMt = -1; render(); }
  function spoTx(s) {
    // Fraction du bargraph en émission selon la mesure choisie (mêmes échelles que l'écran des mesures)
    const lin = (t, v) => { if (v == null) return 0; for (let i = 1; i < t.length; i++) if (v <= t[i][0]) return t[i - 1][1] + (v - t[i - 1][0]) / (t[i][0] - t[i - 1][0]) * (t[i][1] - t[i - 1][1]); return t[t.length - 1][1]; };
    if (L.icMt === 1) { const v = R.swrValue ? R.swrValue(s.m6) : null; return v == null ? 0 : lin([[1, 0], [1.5, 0.15], [2, 0.26], [2.5, 0.4], [3, 0.53], [5, 0.8], [10, 1]], v); }
    if (L.icMt === 2) return Math.min(1, (s.m4 || 0) / 255);
    if (L.icMt === 4) return R.vdValue && s.m8 != null ? Math.max(0, Math.min(1, (R.vdValue(s.m8) - 10) / 6)) : 0; // Vd : 10 – 16 V
    if (L.icMt === 5) return R.idValue && s.m7 != null ? Math.min(1, R.idValue(s.m7) / 25) : 0; // Id : 0 – 25 A
    if (L.icMt === 3) { const c = s.m3 == null ? null : s.m3 <= 130 ? s.m3 / 130 * 15 : 15 + (s.m3 - 130) / 111 * 15; return c == null ? 0 : Math.min(1, c / 25); }
    return R.poFrac ? R.poFrac(s.m5) || 0 : 0;
  }
  function drawSpoBar(s, live) {
    const P = LCD.spo;
    if (!P) return;
    const tx = !!s.tx;
    const sm = s.smeter;
    // Réception : S (0120 = S9, 0241 = S9 + 60 dB) ; émission : Po (0213 = 100 %)
    const f = !live ? 0 : tx ? spoTx(s) : sm == null ? 0 : sm <= 120 ? sm / 120 * 0.55 : Math.min(1, 0.55 + (sm - 120) / 121 * 0.45);
    if (LCD.spoMt !== L.icMt) {
      LCD.spoMt = L.icMt;
      const [nm, sc] = SPO_MT[L.icMt];
      if (P.lab) P.lab.textContent = 'S/' + nm;
      const B2 = LCD.spoBig;
      if (B2) { B2.lab.textContent = nm; B2.nums.forEach((e, i) => { const t = sc[i]; e.textContent = t ? t[1] : ''; if (t) e.setAttribute('x', B2.bs(t[0])); }); }
    }
    P.f = P.f == null ? f : P.f + (f - P.f) * 0.6;
    // Grand S/Po (M.SCOPE) : caché sous les tableaux MENU, QUICK, FUNCTION, modes, bandes, MEMORY, SET…
    const menus = L.func || L.modeMenu || L.bandMenu || L.icomMenu || L.quickMenu || L.icMem || L.icRec || L.icSet;
    const big = !!L.icBig && !!LCD.spoBig && !menus;
    P.g.style.display = big ? 'none' : '';
    const B = LCD.spoBig;
    if (B) {
      B.g.style.display = big ? '' : 'none';
      const up = big && L.icView === 'scope' ? 'translate(0,-17)' : '';
      if (B.tr !== up) { B.tr = up; up ? B.g.setAttribute('transform', up) : B.g.removeAttribute('transform'); }
    }
    const Q = big ? B : P, N = big ? SPO_NB : SPO_N;
    // Grand S/Po : S9 au milieu de l'échelle (+ 60 dB au bout) ; Po : 50 % au milieu, comme l'échelle du TRX
    const fb = !big ? P.f : tx ? (P.f <= 0.5 ? P.f : 0.5 + (P.f - 0.5)) : P.f <= 0.55 ? P.f / 0.55 * 0.5 : 0.5 + (P.f - 0.55) / 0.45 * 0.5;
    const n = Math.round(fb * N), hiF = big ? 0.5 : 0.55;
    Q.segs.forEach((e, i) => { e.classList.toggle('on', i < n); e.classList.toggle('hi', !tx && i >= N * hiF); });
  }
  function drawIcMeter(s) {
    const M = LCD.icm;
    if (!M) return;
    const menus = L.func || L.modeMenu || L.bandMenu || L.icomMenu || L.quickMenu;
    if (L.icView === 'keyer' && !/^CW/.test(L.activeMode(s) || '')) L.icView = null; // KEYER : CW seulement
    const view = !menus && L.icView;
    const on = !!L.icMeter && !menus && !view;
    M.g.style.display = on ? '' : 'none';
    if (L.icView === 'voice' && /^(CW|RTTY)/.test(L.activeMode(s) || '')) L.icView = null; // VOICE TX : phonie seulement
    if (LCD.icMpadX) LCD.icMpadX.style.display = view === 'mpad' && L.mpadExp ? '' : 'none';
    for (const [k, v] of [['icMpad', 'mpad'], ['icKeyer', 'keyer'], ['icAudio', 'audio'], ['icScope', 'scope'], ['icVoice', 'voice'], ['icSwr', 'swr'], ['icScan', 'scan']]) if (LCD[k]) LCD[k].style.display = view === v && !(k === 'icMpad' && L.mpadExp) ? '' : 'none';
    if (view === 'keyer') drawIcKeyer(s);
    if (view === 'audio') drawIcAudioKeys(s);
    if (view === 'scope') drawIcScope(s);
    if (view === 'swr') drawIcSwr(s);
    if (view === 'scan') drawIcScan(s);
    if (view === 'mpad') drawIcMpad(s);
    if (view === 'voice') drawIcVoice(s);
    { const cv = $('scope'); if (cv) cv.classList.toggle('fc-hide', view === 'mpad' && !!L.mpadExp); } // MEMO PAD EXPAND : sans le scope
    if (view) {
      // AUDIO : bande, titre, FFT et oscilloscope dans la cascade ; SCOPE : sous son bandeau, au-dessus des touches ; les autres : bande du scope
      const bigSc = view === 'scope' && !!L.icBig, expSc = view === 'scope' && !!L.iscExp && !bigSc;
      const [up, h2] = view === 'audio' ? [0, IC_AUD_H] : bigSc ? [G.scopeY - IC_BIG_TB - IC_TB, IC_BIG_SC] : expSc ? [G.scopeY - IC_EXP_TB - IC_TB, IC_SCOPE_H + G.scopeY - IC_EXP_TB] : view === 'scope' ? [-IC_TB, IC_SCOPE_H] : [0, IC_STRIP];
      const lay = bigSc ? 'B' : expSc ? 'E' : 'N';
      if (LCD.iscTbG && LCD.iscBig !== lay) {
        LCD.iscBig = lay;
        LCD.iscTbG.setAttribute('transform', bigSc ? 'translate(0,' + (IC_BIG_TB - G.scopeY) + ')' : expSc ? 'translate(0,' + (IC_EXP_TB - G.scopeY) + ')' : '');
        if (LCD.scopeRect) LCD.scopeRect.style.visibility = bigSc ? 'hidden' : '';
        LCD.iscKG.setAttribute('transform', bigSc ? 'translate(0,' + (IC_BIG_TB + IC_TB + IC_BIG_SC + 2 - (G.scopeY + IC_TB + IC_SCOPE_H + 2)) + ')' : '');
      }
      if (LCD.placeScope && LCD.scopeMode !== 'S' + h2 + '/' + up) { LCD.placeScope(up, h2); LCD.scopeMode = 'S' + h2 + '/' + up; }
      return;
    }
    // Grand écran (M.SCOPE) : les barres un peu plus bas, sans le fond (pas de scope au-dessus)
    const big = on && !!L.icBig;
    if (M.big !== big) { M.big = big; M.g.setAttribute('transform', big ? 'translate(0,14)' : ''); M.bg.style.display = big ? 'none' : ''; if (LCD.scopeRect) LCD.scopeRect.style.visibility = big ? 'hidden' : ''; }
    // Scope : bande réduite au-dessus des mesures, ou taille normale
    const want = on ? 'S' + IC_STRIP : 'N' + (L.expand ? EXP_UP : 0);
    if (LCD.placeScope && LCD.scopeMode !== want) LCD.placeScope(on ? 0 : (L.expand ? EXP_UP : 0), on ? IC_STRIP : 0);
    if (!on) return;
    const tx = !!s.tx;
    const lin = (t, v) => { if (v == null) return 0; for (let i = 1; i < t.length; i++) if (v <= t[i][0]) return t[i - 1][1] + (v - t[i - 1][0]) / (t[i][0] - t[i - 1][0]) * (t[i][1] - t[i - 1][1]); return t[t.length - 1][1]; };
    const swr = R.swrValue ? R.swrValue(s.m6) : null;
    const comp = s.m3 == null ? null : s.m3 <= 130 ? s.m3 / 130 * 15 : 15 + (s.m3 - 130) / 111 * 15; // 0130 = 15 dB, 0241 = 30 dB
    const fr = {
      alc: tx ? Math.min(1, (s.m4 || 0) / 255) : 0,
      comp: tx && comp != null ? Math.min(1, comp / 25) : 0,
      swr: tx && swr != null ? lin([[1, 0], [1.5, 0.15], [2, 0.25], [2.5, 0.35], [3, 0.45], [5, 0.8], [10, 1]], swr) : 0,
      id: tx && R.idValue ? Math.min(1, R.idValue(s.m7) / 25) : 0,
      vd: R.vdValue && s.m8 != null ? Math.max(0, Math.min(1, (R.vdValue(s.m8) - 10) / 6)) : 0,
      temp: 0
    };
    for (const k in M.bars) { const b = M.bars[k]; b.f.setAttribute('width', Math.max(0, fr[k] || 0) * (b.x1 - b.x0)); }
    if (M.bars.vd.tt) M.bars.vd.tt.textContent = 'Vd : tension d’alimentation du TRX' + (R.vdValue && s.m8 != null ? ' — ' + R.vdValue(s.m8).toFixed(1) + ' V' : '');
  }
  // Cadre « P.AMP 1 »… : un réglage a changé (sur la page ou au TRX) → affiché 1,5 s au milieu de l'écran
  const IC_POP = [['preamp', 'P.AMP', (s) => ['OFF', '1', '2'][s.preamp]], ['att', 'ATT', (s) => (s.att ? '20dB' : 'OFF')], ['agc', 'AGC', (s) => ['', 'FAST', 'MID', 'SLOW'][s.agc]],
    ['nb', 'NB', (s) => onOff(s.nb)], ['nr', 'NR', (s) => onOff(s.nr)], ['notchI', 'NOTCH', (s) => notchTxt(s)], ['notchW', 'NOTCH', (s) => (s.notch ? notchTxt(s) : null)], ['fil', 'FILTER', (s) => 'FIL' + s.fil],
    ['proc', 'COMP', (s) => onOff(s.proc)], ['vox', 'VOX', (s) => onOff(s.vox)], ['tuner', 'TUNER', (s) => onOff(s.tuner)], ['ipPlus', 'IP+', (s) => onOff(s.ipPlus)],
    ['bkin', 'BK-IN', (s) => ['OFF', 'SEMI', 'FULL'][s.bkin]], ['scSpan', 'SPAN', (s) => (R.SC_SPANS ? '±' + (R.SC_SPANS[s.scSpan] / 1000).toString().replace('.', ',') + 'k' : null), 1000],
    ['scSpeed', 'SPEED', (s) => ['FAST', 'MID', 'SLOW'][s.scSpeed], 500],
    ['scMode', 'SCOPE', (s) => ['CENTER', 'FIX', 'SCROLL-C', 'SCROLL-F'][s.scMode || 0]], ['scEdge', '', (s) => 'No.' + s.scEdge, 1000], ['moni', 'MONI', (s) => onOff(s.moni)], ['split', 'SPLIT', (s) => onOff(s.split)]];
  // TWIN PBT (IC-7300) : cadre BW / SFT et dessin du filtre quand on tourne ou pousse le TWIN PBT (ici ou sur le TRX), 2 s
  let pbtPrev = null;
  function pbtPopDraw(s, live) {
    const e = $('icPbt');
    if (!e) return;
    const k = live ? (s.pbtIn != null ? s.pbtIn : 128) + '/' + (s.pbtOut != null ? s.pbtOut : 128) + '/' + s.fil : null;
    if (k && pbtPrev && k.split('/').slice(0, 2).join('/') !== pbtPrev.split('/').slice(0, 2).join('/')) L.pbtPopAt = Date.now();
    pbtPrev = k;
    const on = Date.now() - (L.pbtPopAt || 0) < 2000 && !!LCD.flt && !!LCD.flt.A;
    e.hidden = !on;
    clearTimeout(L.pbtPopT);
    if (!on) return;
    L.pbtPopT = setTimeout(render, 2050);
    const f = LCD.flt.A, md = f.mode || '', fw = filHz(md, s.fil) || f.hz;
    // CLR : les deux PBT au milieu tout de suite, sans attendre la relecture du TRX
    const clr = Date.now() - (L.pbtClrAt || 0) < 1500;
    const hz = clr ? fw : Math.round(f.hz / 50) * 50, sh = clr ? 0 : Math.round(f.sh / 25) * 25, // pas du TRX : 50 Hz (BW), 25 Hz (SFT)
      c = audioCenter(md, fw), lo = c + sh - hz / 2, hi = c + sh + hz / 2;
    const q = (n) => e.querySelector('[data-k="' + n + '"]');
    q('bw').textContent = 'BW ' + (hz >= 1000 ? (Math.round(hz / 10) / 100).toFixed(2) + 'k' : Math.round(hz) + '');
    q('sft').textContent = (sh > 0 ? '+' : '') + Math.round(sh);
    // Échelle comme sur le TRX : filtres larges, trait de base sur toute la largeur (≈ 7 kHz, AM / FM plus) ;
    // filtres étroits (< 1 kHz), trait de base court au milieu ; bord haut du dessin plus étroit (trapèze)
    const narrow = fw < 1000, span = narrow ? fw / 0.38 : /^AM/.test(md) ? 20000 : /^FM/.test(md) ? 30000 : 7000, half = narrow ? 56 : 113;
    const x = (v) => 125 + (v - c) / span * half * 2, xl = x(lo), xh = x(hi), sl = Math.min(8, (xh - xl) / 4);
    const base = e.querySelector('.pb-base'); base.setAttribute('x1', 125 - half); base.setAttribute('x2', 125 + half);
    const trap = (a, b) => { const k2 = Math.min(8, (b - a) / 4); return 'M' + a + ' 70L' + (a + k2) + ' 38H' + (b - k2) + 'L' + b + ' 70Z'; };
    q('flt').setAttribute('d', trap(xl, xh));
    // Les deux PBT, comme sur le TRX : le filtre décalé par chacun (rouge : PBT intérieur, bleu : PBT extérieur), la bande passante qui reste en orange
    const p1 = clr ? 0 : ((s.pbtIn != null ? s.pbtIn : 128) - 128) / 128 * fw / 2, p2 = clr ? 0 : ((s.pbtOut != null ? s.pbtOut : 128) - 128) / 128 * fw / 2;
    const both = Math.abs(p1 - p2) >= 25;
    q('f1').setAttribute('d', both ? trap(x(c - fw / 2 + p1), x(c + fw / 2 + p1)) : '');
    q('f2').setAttribute('d', both ? trap(x(c - fw / 2 + p2), x(c + fw / 2 + p2)) : '');
    const cl = q('cl'); cl.setAttribute('x1', x(c)); cl.setAttribute('x2', x(c)); cl.setAttribute('y1', 52); cl.setAttribute('y2', 70);
    const lab = (n, xx, v) => { const t = q(n); t.setAttribute('x', Math.max(14, Math.min(236, xx))); t.textContent = String(Math.round(v)); };
    // Bords de la bande passante en orange, centre du filtre (fréquence BF du milieu) en blanc
    lab('lo', Math.min(xl, x(c) - 34), lo); lab('c', x(c), c); lab('hi', Math.max(xh, x(c) + 34), hi);
    e.style.fontSize = Math.max(8, Math.round($('facePanel').clientWidth / V.w * 13)) + 'px';
  }
  let icPrev = null, icPopT = 0;
  function icPopCheck(s, live) {
    const e = $('icPop');
    if (!e) return;
    if (!live) { icPrev = null; return; }
    const cur = {};
    for (const [k, , f] of IC_POP) cur[k] = (k === 'notchI' ? (s.dnf == null && s.notch == null) : s[k] == null) ? null : f(s);
    if (icPrev) for (const [k, lab] of IC_POP) {
      if (cur[k] != null && icPrev[k] != null && cur[k] !== icPrev[k]) {
        e.querySelector('b').textContent = lab;
        e.querySelector('span').textContent = cur[k];
        e.style.fontSize = Math.max(9, Math.round($('facePanel').clientWidth / V.w * 15)) + 'px';
        e.hidden = false;
        clearTimeout(icPopT);
        const ent = IC_POP.find((p2) => p2[0] === k);
        icPopT = setTimeout(() => { e.hidden = true; }, (ent && ent[3]) || 1500);
      }
    }
    icPrev = cur;
  }
  // MULTI de l'IC-7300 : petit menu à droite de l'écran (3 ou 4 réglages selon le mode) ; le bouton MULTI règle la ligne choisie
  function buildMultiMenu(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = LCD.multiMenu = el('g', { class: 'mm-multi', style: 'display:none' }, g);
    const x0 = X(c.w - 205), y0 = Y(88), w = 200, rh = 32;
    LCD.multiRows = [0, 1, 2, 3].map((i) => {
      const y = y0 + i * rh;
      const r = el('rect', { x: x0, y, width: w, height: rh - 3, rx: 4, class: 'mm-cell' }, m);
      const t = el('text', { x: x0 + 10, y: y + 19, class: 'mm-mlab' }, m, '');
      const v = el('text', { x: x0 + w - 10, y: y + 19, class: 'mm-mval', 'text-anchor': 'end' }, m, '');
      const hit = el('rect', { x: x0, y, width: w, height: rh - 3, class: 'hs lcd-hit' }, m);
      el('title', {}, hit, 'Clic : choisir ce réglage, puis tourner le bouton MULTI (ou la molette ici)');
      const row = { r, t, v, hit, id: null };
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); if (!row.id) return; L.funcSel = row.id; store.set('rs.face.funcsel', row.id); L.multiAt = Date.now(); render(); });
      hit.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        if (!row.id || !Math.abs(ev.deltaY)) return;
        L.funcSel = row.id; L.multiAt = Date.now();
        funcAdjust(row.id, ev.deltaY < 0 ? 1 : -1);
      }, { passive: false });
      return row;
    });
  }
  function drawMultiMenu(s) {
    if (!LCD.multiMenu) return;
    if (L.multiMenu && Date.now() - (L.multiAt || 0) > 8000) L.multiMenu = false; // se ferme seul, comme sur le TRX
    LCD.multiMenu.style.display = L.multiMenu ? '' : 'none';
    if (!L.multiMenu) return;
    const ids = multiItems(s);
    LCD.multiRows.forEach((row, i) => {
      const id = ids[i];
      row.id = id || null;
      for (const e of [row.r, row.t, row.v, row.hit]) e.style.display = id ? '' : 'none';
      if (!id) return;
      row.t.textContent = FUNC_BY[id][1];
      row.v.textContent = FUNC_BY[id][2](s);
      row.r.classList.toggle('on', L.funcSel === id);
    });
  }
  function toggleExpand() { viewTouched(); L.expand = !L.expand; store.set('rs.face.expand', L.expand ? '1' : '0'); say(L.expand ? 'EXPAND : scope agrandi' : 'EXPAND coupé : affichage normal', '', 2500); render(); }
  // FTDX10 (un seul récepteur) : disposition de l'écran, refaite à chaque changement (EXPAND)
  function layoutSingle(up) {
    const X = LCD.X, Y = LCD.Y, half = LCD.half;
    const tr = (e, t) => (t ? e.setAttribute('transform', t) : e.removeAttribute('transform'));
    if (LCD.ich) {
      // IC-7300 : en-tête Icom à la place du galvanomètre, des fréquences en 7 segments, des cases et du cadre de filtre (Yaesu)
      for (const e of [LCD.mA.g, LCD.mB.g, LCD.fA.g, LCD.fB.g, LCD.vA.g, LCD.vB.g, LCD.cgA, LCD.cgB, LCD.lowG]) e.style.display = 'none';
      for (const b of LCD.bot) b.h.style.display = 'none';
      return;
    }
    for (const e of [LCD.mB.g, LCD.fB.g, LCD.cgB]) e.style.display = 'none';
    // S-mètre : la partie haute du galvanomètre (S et PO), un peu agrandie, en haut à gauche
    const m = LCD.mA.g;
    m.style.display = LCD.spo ? 'none' : ''; // IC-7300 : bargraph S/Po à la place du galvanomètre
    m.setAttribute('clip-path', 'url(#lcdClipA)');
    tr(m, 'translate(' + X(5) + ',' + Y(6) + ') scale(1.1) translate(' + -X(5) + ',' + -Y(4) + ')');
    // VFO-A en grand en haut à droite, VFO-B en petit dessous (grisé, comme sur le TRX)
    tr(LCD.vA.g, 'translate(' + X(300) + ',' + Y(5) + ') scale(1.25) translate(' + -X(63) + ',' + -Y(92) + ')');
    LCD.vB.g.style.display = '';
    tr(LCD.vB.g, 'translate(' + X(372) + ',' + Y(56) + ') scale(0.62) translate(' + -X(63 + half) + ',' + -Y(92) + ')');
    // Mode du VFO-B lisible malgré la petite fréquence : badge agrandi (vers la gauche et le haut), « VFO » et « TX » au-dessus
    { const vb = LCD.vB, bx = X(5 + half) + 53, by = Y(121);
      for (const e of [vb.badge, vb.mode]) tr(e, 'translate(' + bx + ',' + by + ') scale(1.7) translate(' + -bx + ',' + -by + ')');
      for (const e of [vb.lbl, vb.tx]) tr(e, 'translate(-36,-12) scale(1)'); }
    // Filtre : à droite de la rangée de cases
    const f = LCD.fA;
    f.g.style.display = '';
    tr(f.g, 'translate(' + X(337) + ',' + Y(84) + ') scale(' + (268 / f.w).toFixed(4) + ',' + (51 / f.h).toFixed(4) + ') translate(' + -f.x0 + ',' + -f.y0 + ')');
    // Cases ATT / IPO / R.FIL / AGC (pas d'ANT) sur la gauche, sous le S-mètre
    LCD.cgA.style.display = '';
    tr(LCD.cgA, '');
    const vis = LCD.cA.filter((c) => c.id !== 'ant');
    const cw = 330 / vis.length;
    LCD.cA.forEach((c) => {
      const j = vis.indexOf(c), show = j >= 0;
      for (const e of [c.r, c.h, c.tl, c.t]) e.style.display = show ? '' : 'none';
      if (!show) return;
      const x = X(5) + j * cw;
      for (const r of [c.r, c.h]) { r.setAttribute('x', x + 0.5); r.setAttribute('width', cw - 1); r.setAttribute('y', Y(87)); r.setAttribute('height', 48); }
      c.tl.setAttribute('x', x + cw / 2); c.tl.setAttribute('y', Y(104));
      c.t.setAttribute('x', x + cw / 2); c.t.setAttribute('y', Y(127));
    });
    // Bandeau du scope : sous le filtre ; caché en EXPAND (le scope monte par-dessus les cases)
    LCD.lowG.style.display = up ? 'none' : '';
    tr(LCD.lowG, ''); // bandeau construit à G.lowY
  }
  // Tableau BAND (touche BAND du FTDX10) : clic sur une bande pour le VFO actif
  const BAND_GRID = [['160M', '1.8', 1840, 'LSB'], ['80M', '3.5', 3700, 'LSB'], ['60M', '5', 5357, null], ['40M', '7', 7100, 'LSB'],
    ['30M', '10', 10136, null], ['20M', '14', 14200, 'USB'], ['17M', '18', 18130, 'USB'], ['15M', '21', 21250, 'USB'],
    ['12M', '24.5', 24950, 'USB'], ['10M', '28', 28500, 'USB'], ['6M', '50', 50150, 'USB'], ['4M', '70', 70200, 'USB']];
  function buildBandMenu(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = LCD.bandMenu = el('g', { class: 'mode-menu', style: 'display:none' }, g);
    const x0 = X(40), y0 = Y(60), w = c.w - 80, h = 214;
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 6, class: 'mm-bg' }, m);
    el('rect', { x: x0 + 4, y: y0 + 4, width: w - 8, height: 18, rx: 3, class: 'mm-title' }, m);
    el('text', { x: x0 + w / 2, y: y0 + 17, class: 'mm-ttl', 'text-anchor': 'middle' }, m, 'BAND');
    const cw = (w - 12) / 4, rh = 46;
    LCD.bandCells = {};
    // FTX-1 : tableau du TRX (FACE.bandGrid, libellés sans « MHz », AIR / 70/GEN pas à distance)
    const grid = (FACE && FACE.bandGrid) || BAND_GRID.filter((b) => b[2] * 1000 <= (R.FREQ_MAX || 75e6));
    grid.forEach(([name, lab, khz, md], i) => {
      const ri = Math.floor(i / 4), ci = i % 4;
      const x = x0 + 6 + ci * cw, y = y0 + 28 + ri * rh;
      const box = el('rect', { x: x + 2, y, width: cw - 4, height: rh - 7, rx: 3, class: 'mm-cell' + (name ? '' : ' preset') }, m);
      const t = el('text', { x: x + cw / 2, y: y + 24, class: 'mm-lab' + (name ? '' : ' preset'), 'text-anchor': 'middle' }, m, FACE && FACE.bandGrid ? lab : lab + ' MHz');
      const hit = el('rect', { x: x + 2, y, width: cw - 4, height: rh - 7, class: 'hs lcd-hit' }, m);
      el('title', {}, hit, name ? 'Bande ' + lab + ' MHz (' + name.replace('M', ' m') + ')' : lab + ' : pas à distance');
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); if (!name) return say(lab + ' : pas disponible à distance.', '', 3000); closeBandMenu(); bandTo(name, khz, md); });
      if (name) LCD.bandCells[name] = [box, t];
    });
    const close = el('rect', { x: x0 + w - 24, y: y0 + 5, width: 18, height: 16, class: 'hs lcd-hit' }, m);
    el('text', { x: x0 + w - 15, y: y0 + 17, class: 'mm-ttl', 'text-anchor': 'middle' }, m, '✕');
    close.addEventListener('click', (ev) => { ev.stopPropagation(); closeBandMenu(); });
  }
  // Changement de bande : sélection de bande du TRX s'il en a une (BS : dernière fréquence et mode), sinon fréquence habituelle et mode
  function bandTo(name, khz, md) {
    if (!needControl()) return;
    if (R.cmdBand && R.BAND_CODES && R.BAND_CODES[name] && activeSide() === 'A') return send({ t: 'set', band: name, sub: false });
    tuneTo(activeSide(), khz * 1000);
    if (md) setTimeout(() => setMode(md), 250);
  }
  function openBandMenu() {
    if (!LCD.bandMenu) return;
    L.bandMenu = true;
    render();
    setTimeout(() => document.addEventListener('pointerdown', outsideBand, true), 0);
  }
  function closeBandMenu() { L.bandMenu = false; document.removeEventListener('pointerdown', outsideBand, true); render(); }
  function outsideBand(ev) { if (!ev.target.closest || !ev.target.closest('.mode-menu')) closeBandMenu(); }
  // Tableau MODE (appui d'au moins 1 s sur MODE), comme sur le TRX : clic sur un mode pour le récepteur actif
  const MODE_GRID = (FACE && FACE.modes) || [['LSB', 'USB', 'CW-L', 'CW-U'], ['AM', 'AM-N', 'FM', 'FM-N'], ['DATA-L', 'DATA-U', 'DATA-FM', 'DATA-FM-N'], ['RTTY-L', 'RTTY-U', 'PSK', null]];
  function buildModeMenu(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const m = LCD.modeMenu = el('g', { class: 'mode-menu', style: 'display:none' }, g);
    const x0 = X(40), y0 = Y(70), w = c.w - 80, h = 214;
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 6, class: 'mm-bg' }, m);
    el('rect', { x: x0 + 4, y: y0 + 4, width: w - 8, height: 18, rx: 3, class: 'mm-title' }, m);
    el('text', { x: x0 + w / 2, y: y0 + 17, class: 'mm-ttl', 'text-anchor': 'middle' }, m, 'MODE');
    const cw = (w - 12) / 4, rh = 46;
    LCD.modeCells = {};
    MODE_GRID.forEach((row, ri) => row.forEach((name, ci) => {
      const x = x0 + 6 + ci * cw, y = y0 + 28 + ri * rh;
      const box = el('rect', { x: x + 2, y, width: cw - 4, height: rh - 7, rx: 3, class: 'mm-cell' + (name ? '' : ' preset') }, m);
      const lab = el('text', { x: x + cw / 2, y: y + 24, class: 'mm-lab' + (name ? '' : ' preset'), 'text-anchor': 'middle' }, m, name ? name.replace('DATA-FM-N', 'D-FM-N') : 'PRESET');
      const hit = el('rect', { x: x + 2, y, width: cw - 4, height: rh - 7, class: 'hs lcd-hit' }, m);
      el('title', {}, hit, name ? 'Mode ' + name : 'PRESET : réglages du TRX, au club');
      hit.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!name) return say('PRESET : réglages du TRX, pas disponibles à distance.', '', 3500);
        closeModeMenu();
        setMode(name);
      });
      if (name) LCD.modeCells[name] = [box, lab];
    }));
    const close = el('rect', { x: x0 + w - 24, y: y0 + 5, width: 18, height: 16, class: 'hs lcd-hit' }, m);
    el('text', { x: x0 + w - 15, y: y0 + 17, class: 'mm-ttl', 'text-anchor': 'middle' }, m, '✕');
    close.addEventListener('click', (ev) => { ev.stopPropagation(); closeModeMenu(); });
  }
  function openModeMenu() {
    if (!LCD.modeMenu) return;
    L.modeMenu = true;
    render();
    setTimeout(() => document.addEventListener('pointerdown', outsideMode, true), 0);
  }
  function closeModeMenu() { L.modeMenu = false; document.removeEventListener('pointerdown', outsideMode, true); render(); }
  function outsideMode(ev) { if (!ev.target.closest || !ev.target.closest('.mode-menu')) closeModeMenu(); }
  // Menu FUNC (comme sur le TRX, mais à la souris) : clic = choisir la case (ou basculer / changer une valeur à choix),
  // molette sur la case ou bouton MULTI = régler la case choisie. Cases grises : pas disponibles à distance.
  // SPEED comme le TRX (SS P2 = 0) : SLOW1, SLOW2, FAST1, FAST2, FAST3 — et intervalle de la cascade de la page
  const WF_SPEEDS = [['SLOW1', 200], ['SLOW2', 140], ['FAST1', 80], ['FAST2', 50], ['FAST3', 30]];
  const STEPS = [[1, '1Hz'], [100, '100Hz'], [1000, '1kHz']];
  L.wfSpeed = Math.max(0, Math.min(4, Number(store.get('rs.face.wfspd5', '2')) || 0));
  L.wfColor = Math.max(1, Math.min(18, Number(store.get('rs.face.wfcol18', '13')) || 13));
  L.wfLevel = Math.max(-30, Math.min(30, Number(store.get('rs.face.wflvl', '0')) || 0));
  L.func = false;
  // SPAN (comme le tableau du TRX : 1k … 1000k) ; la page montre la BF reçue, donc 1k, 2k et 5k seulement (le scope du TRX ne passe pas par le CAT)
  const SPANS = [1000, 2000, 5000];
  const SPAN_TRX = ['1k', '2k', '5k', '10k', '20k', '50k', '100k', '200k', '500k', '1000k'];
  // Touche DISP : présentations de l'écran (comme sur le FTDX101)
  const DISPS = ['cascade du MAIN', 'SUB au-dessus, MAIN en dessous', 'MAIN | SUB côte à côte', 'filtres agrandis (MAIN | SUB)'];
  L.disp = Math.max(0, Math.min(3, Number(store.get('rs.face.disp', '0')) || 0));
  // FTX-1 : sa propre suite DISP (0 normal, 1 un VFO + scope, 2 MAIN / SUB sans scope, 3 filtres agrandis)
  L.fdisp = FACE && FACE.meterFtx ? Math.max(0, Math.min(3, Number(store.get('rs.face.fdisp', '0')) || 0)) : 0;
  if (FACE && FACE.meterFtx) L.disp = L.fdisp === 3 ? 3 : 0;
  L.multi = store.get('rs.face.multi', '0') === '1';
  L.d3 = store.get('rs.face.3dss', '0') === '1';
  // FTX-1 : pas de MONO sur le TRX (le réglage enregistré vient d'une autre face, ex. FTDX101)
  const NO_MONO = !!(FACE && FACE.noMono);
  L.mono = !NO_MONO && store.get('rs.face.mono', '0') === '1';
  // Pas de touche EXPAND sur cette face (FTX-1) : jamais d'EXPAND (le réglage enregistré vient d'une autre face, ex. FTDX101)
  const NO_EXPAND = !!(FACE && FACE.bot && !FACE.bot.includes('EXPAND'));
  L.expand = !NO_EXPAND && store.get('rs.face.expand', '0') === '1';
  const EXP_UP = G.expUp; // EXPAND : hauteur gagnée par le scope (unités de la photo)
  if (SINGLE) { L.mono = false; L.disp = 0; } // un seul récepteur : ni MONO ni DISP
  // MONO (comme le TRX) : un seul VFO à l'écran, le sélectionné — son galvanomètre à gauche, son filtre en grand à droite,
  // sa fréquence sous le galvanomètre, ses cases ANT / ATT / IPO / R.FIL / AGC sur toute la largeur, un seul scope
  function applyMono() {
    const side = activeSide(), key = (L.mono ? 'M' : 'D') + (L.expand ? 'E' : 'N') + side + L.disp + 'F' + (L.fdisp || 0);
    if (!LCD.g || LCD.monoKey === key) return;
    LCD.monoKey = key;
    const X = LCD.X, Y = LCD.Y, half = LCD.half, W = LCD.cw0;
    LCD.g.classList.toggle('mono', !!L.mono);
    LCD.g.classList.toggle('expand', !!L.expand);
    const up = L.expand ? EXP_UP : 0;
    LCD.lowG.setAttribute('transform', up ? 'translate(0,' + -up + ')' : '');
    LCD.lowG.style.display = ''; LCD.scopeRect.style.display = '';
    LCD.scopeRect.setAttribute('y', Y(G.scopeY) - up); LCD.scopeRect.setAttribute('height', G.scopeH + up);
    if (LCD.placeScope) LCD.placeScope(up);
    if (SINGLE) return layoutSingle(up);
    for (const sd of ['A', 'B']) {
      const show = !L.mono || sd === side, dx = L.mono && rightSide(sd) ? -half : 0;
      // FTX-1 (fréquences en haut) : EXPAND agrandit le scope par-dessus les galvanomètres, les fréquences restent en place
      const ftxUp = !!(FACE && FACE.meterDy) && !!up;
      LCD['m' + sd].g.style.display = show && !ftxUp ? '' : 'none';
      LCD['m' + sd].g.setAttribute('transform', L.mono && rightSide(sd) ? 'translate(' + (X(5) - X(289)) + ',0)' : '');
      if (L.expand) LCD['m' + sd].g.setAttribute('clip-path', 'url(#lcdClip' + sd + ')'); else LCD['m' + sd].g.removeAttribute('clip-path');
      LCD['v' + sd].g.style.display = show ? '' : 'none';
      const vdy = (FACE && FACE.vfoDy) || 0; // FTX-1 : fréquences un peu plus bas (place pour « CLAR RXTX » au-dessus)
      const vup = ftxUp ? 0 : up;
      LCD['v' + sd].g.setAttribute('transform', dx || vup || vdy ? 'translate(' + dx + ',' + (vdy - vup) + ')' : '');
      LCD['cg' + sd].style.display = show ? '' : 'none';
      LCD['cg' + sd].setAttribute('transform', up ? 'translate(0,' + -up + ')' : '');
      const f = LCD['f' + sd];
      if (L.mono && sd === side) {
        // Filtre agrandi : de la moitié droite de l'écran jusqu'au bas de la fréquence
        const md = (FACE && FACE.meterDy) || 0; // FTX-1 : filtre dans le groupe décalé de meterDy, sous la barre d'état jusqu'au bandeau du scope
        const tx = X(5) + half + 4, ty = md ? Y(16 - md) : Y(6), tw = X(W - 5) - tx, th = md ? Y(G.lowY - 3 - md) - ty : Y(124 - up) - ty;
        f.g.setAttribute('transform', 'translate(' + tx + ',' + ty + ') scale(' + (tw / f.w).toFixed(4) + ',' + (th / f.h).toFixed(4) + ') translate(' + -f.x0 + ',' + -f.y0 + ')');
      } else if (up) {
        // EXPAND : filtre aplati à la hauteur du galvanomètre réduit
        const th = 36;
        f.g.setAttribute('transform', 'translate(0,' + f.y0 + ') scale(1,' + (th / f.h).toFixed(4) + ') translate(0,' + -f.y0 + ')');
      } else f.g.removeAttribute('transform');
      if (L.mono && sd !== side) f.g.style.display = 'none';
      else f.g.style.display = ftxUp ? 'none' : '';
      // Cases : sur toute la largeur en MONO, sur sa moitié sinon
      const cw = L.mono ? (W - 14) / 5 : (half - 4) / 5, x0 = L.mono ? X(5) : X(5 + (rightSide(sd) ? half : 0));
      LCD['c' + sd].forEach((c, j) => {
        const x = x0 + j * cw;
        for (const r of [c.r, c.h]) { r.setAttribute('x', x + 0.5); r.setAttribute('width', cw - 1); }
        for (const t of [c.tl, c.t]) t.setAttribute('x', x + cw / 2);
      });
    }
    if (FACE && FACE.meterFtx && (L.fdisp === 1 || L.fdisp === 2)) ftxLayout(L.fdisp); // FTX-1 : DISP 1 / 2
  }
  // SPAN : celui du TRX (SS P2 = 5 : 1 kHz … 1 MHz), envoyé au scope du TRX ; la page montre le son reçu, 5 kHz au plus
  L.trxSpan = Math.max(0, Math.min(9, Number(store.get('rs.face.span10', '2')) || 0));
  L.wfSpan = Math.min(2, L.trxSpan);
  function setTrxSpan(i, fromTrx) {
    L.trxSpan = i; L.wfSpan = Math.min(2, i);
    store.set('rs.face.span10', String(i));
    WF.drawn = false;
    if (!fromTrx) ssSend('Span');
  }
  // Réglages du scope du TRX (MAIN ou SUB, côté sélectionné) : envoyés avec la main, relus et suivis
  const SS_VAL = { Spd: () => L.wfSpeed, Peak: () => (L.peak ? L.peak - 1 : null), Marker: () => (L.marker ? 1 : 0), Color: () => L.wfColor, Level: () => L.wfLevel, Span: () => L.trxSpan };
  L.ssSeen = {};
  function ssSend(k) {
    const v = SS_VAL[k]();
    if (v == null || !R || !R.CONTROL['ss' + k] || !iControl()) return;
    // L'ancienne valeur encore relue pendant ~3 s ne doit pas ramener la page en arrière
    (L.ssHold = L.ssHold || {})[k + activeSide()] = { v, until: Date.now() + 3000 };
    send({ t: 'set', ctl: 'ss' + k, value: v });
  }
  function ssFollow(s) {
    if (!R || !R.CONTROL.ssSpd) return;
    const side = activeSide();
    if (L.ssSide !== side) { L.ssSide = side; L.ssSeen = {}; }
    for (const k of Object.keys(SS_VAL)) {
      const v = s['ss' + k + side];
      if (v == null) continue;
      const h = L.ssHold && L.ssHold[k + side];
      if (h) { if (v === h.v || Date.now() > h.until) delete L.ssHold[k + side]; else continue; if (v === h.v) { L.ssSeen[k + side] = v; continue; } }
      if (L.ssSeen[k + side] === v) continue;
      L.ssSeen[k + side] = v;
      if (k === 'Spd') { L.wfSpeed = v; store.set('rs.face.wfspd5', v); }
      else if (k === 'Peak') { if (L.peak) { L.peak = v + 1; store.set('rs.face.peak', L.peak); } }
      else if (k === 'Marker') { L.marker = !!v; store.set('rs.face.marker', v ? '1' : '0'); }
      else if (k === 'Color') { if (v !== L.wfColor) setColor(v, true); }
      else if (k === 'Level') { L.wfLevel = v; store.set('rs.face.wflvl', v); }
      else if (k === 'Span') { if (v !== L.trxSpan) setTrxSpan(v, true); }
    }
  }
  L.hold = false;
  L.funcSel = store.get('rs.face.funcsel', 'power');
  const stepNow = () => (L.fine ? 0 : L.fast ? 2 : 1);
  function setStepIdx(i) { L.fine = i === 0; L.fast = i === 2; store.set('rs.face.fine', L.fine ? '1' : '0'); store.set('rs.face.fast', L.fast ? '1' : '0'); }
  // ------------------------------------------------------------ tableau SPAN (touche SPAN de l'écran), comme sur le TRX
  function openSpan() {
    let box = $('fcSpan');
    if (box && !box.hidden) { box.hidden = true; return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'fcSpan';
      box.className = 'fc-menu fc-colors fc-span';
      const sc = FACE.lcd;
      box.style.left = ((sc.x + 40 - V.x) / V.w * 100) + '%';
      box.style.top = ((sc.y + 160 - V.y) / V.h * 100) + '%';
      box.style.width = ((sc.w - 80) / V.w * 100) + '%';
      $('facePanel').appendChild(box);
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-span]');
        if (!b) return;
        const i = SPAN_TRX.indexOf(b.dataset.span);
        if (i < 0) return;
        setTrxSpan(i);
        if (i > 2) say('SPAN ' + b.dataset.span + ' : réglé sur le scope du TRX ; la page montre le son reçu (5 kHz au plus).', '', 4000);
        box.hidden = true;
        render();
      });
    }
    box.style.fontSize = Math.max(9, Math.round($('facePanel').clientWidth / V.w * 11)) + 'px';
    const cur = SPAN_TRX[L.trxSpan];
    box.innerHTML = '<div class="fc-col-t">SPAN</div><div class="fc-span-g">' + SPAN_TRX.map((s, i) => '<button type="button" data-span="' + s + '" class="' + (s === cur ? 'on' : '') + '"' +
      (i > 2 ? ' title="Réglé sur le scope du TRX ; la page montre le son reçu (5 kHz au plus)"' : '') + '>' + s + '</button>').join('') + '</div>';
    box.hidden = false;
  }

  // FTX-1 : tableau SPEED du TRX (SLOW1 SLOW2 FAST1 FAST2 / FAST3 … STOP) ; il reste ouvert, un nouvel appui sur SPEED le ferme
  function openSpeed() {
    let box = $('fcSpeed');
    if (box && !box.hidden) { box.hidden = true; return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'fcSpeed';
      box.className = 'fc-menu fc-colors fc-span';
      const sc = FACE.lcd;
      box.style.left = ((sc.x + 70 - V.x) / V.w * 100) + '%';
      box.style.top = ((sc.y + 165 - V.y) / V.h * 100) + '%';
      box.style.width = ((sc.w - 140) / V.w * 100) + '%';
      $('facePanel').appendChild(box);
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-spd]');
        if (!b) return;
        viewTouched();
        const i = +b.dataset.spd;
        if (i === 5) { L.hold = true; if (R.CONTROL.ssSpd && iControl()) setCtl('ssSpd', 5); }
        else { L.hold = false; L.wfSpeed = i; store.set('rs.face.wfspd5', i); ssSend('Spd'); }
        openSpeed.draw();
        render();
      });
    }
    box.style.fontSize = Math.max(9, Math.round($('facePanel').clientWidth / V.w * 11)) + 'px';
    openSpeed.draw = () => {
      const cur = L.hold ? 5 : L.wfSpeed;
      const cell = (i, lab) => '<button type="button" data-spd="' + i + '" class="' + (i === cur ? 'on' : '') + '">' + lab + '</button>';
      box.innerHTML = '<div class="fc-col-t">SPEED</div><div class="fc-span-g">' + WF_SPEEDS.slice(0, 4).map((w, i) => cell(i, w[0])).join('') +
        cell(4, WF_SPEEDS[4][0]) + '<span></span><span></span>' + cell(5, 'STOP') + '</div>';
    };
    openSpeed.draw();
    box.hidden = false;
  }

  // ------------------------------------------------------------ tableau des couleurs (COLOR), comme sur le TRX
  // Clic sur COLOR (FUNC ou S.MENU), ou COLOR choisi puis bouton MULTI : le tableau s'ouvre ; MULTI / molette : couleur suivante ; clic : celle-là ; BACK : fermer
  function setColor(k, fromTrx) {
    L.wfColor = ((k - 1 + 18) % 18) + 1;
    store.set('rs.face.wfcol18', String(L.wfColor));
    if (!fromTrx) ssSend('Color');
    WF.drawn = false;
    colDraw();
  }
  function openColors() {
    let box = $('fcColors');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fcColors';
      box.className = 'fc-menu fc-colors';
      const sc = FACE.lcd;
      box.style.left = ((sc.x + 30 - V.x) / V.w * 100) + '%';
      box.style.top = ((sc.y + 70 - V.y) / V.h * 100) + '%';
      box.style.width = ((sc.w - 60) / V.w * 100) + '%';
      $('facePanel').appendChild(box);
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-col],[data-back]');
        if (!b) return;
        if (b.dataset.back) { box.hidden = true; return; }
        setColor(Number(b.dataset.col));
      });
      box.addEventListener('wheel', (e) => { e.preventDefault(); setColor(L.wfColor + (e.deltaY > 0 ? 1 : -1)); }, { passive: false });
    }
    box.style.fontSize = Math.max(9, Math.round($('facePanel').clientWidth / V.w * 10)) + 'px';
    box.hidden = false;
    colDraw();
  }
  function colDraw() {
    const box = $('fcColors');
    if (!box || box.hidden) return;
    const sw = (k) => '<button type="button" class="fc-sw' + (L.wfColor === k ? ' on' : '') + '" data-col="' + k + '" title="COLOR-' + k + '"><i style="background:' + palCss(k) + '">' + (L.wfColor === k ? '✓' : '') + '</i><b>COLOR-' + k + '</b></button>';
    const row = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => sw(a + i)).join('');
    box.innerHTML = '<div class="fc-col-t">DIRECT SAMPLING SDR</div><div class="fc-col-r fc-col-r4">' + row(1, 4) + '</div><div class="fc-col-r">' + row(5, 11) + '</div>' +
      '<div class="fc-col-t">NARROW BAND SDR</div><div class="fc-col-r">' + row(12, 18) + '</div>' +
      '<div class="fm-f"><span class="fc-col-h">Couleurs de la cascade de cette page (le scope du TRX ne passe pas par le CAT) · molette ou MULTI : couleur suivante</span><button type="button" class="fm-back" data-back="1">BACK</button></div>';
  }

  // ------------------------------------------------------------ menus du TRX : FUNC → RADIO / CW / OPERATION / DISPLAY / EXTENSION SETTING
  // Fenêtre posée sur l'écran : sous-menus à gauche, réglages à droite (valeurs lues sur le TRX à l'ouverture d'un sous-menu) ;
  // clic sur un réglage puis − / +, molette ou bouton MULTI : la valeur part au TRX (main prise), puis elle est relue.
  const MENU_CELL = { radio: 'RADIO SETTING', cwset: 'CW SETTING', opset: 'OPERATION SETTING', disp: 'DISPLAY SETTING', ext: 'EXTENSION SETTING' };
  const MV = { open: false, group: '', sub: '', sel: null, vals: {}, pend: null, t: 0 };
  const MN = () => (R && R.MENU) || null;
  function openMenu(group) {
    const M = MN();
    MV.open = true; MV.group = group; MV.sel = null; MV.top = 0;
    L.func = false;
    let box = $('fcMenu');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fcMenu';
      box.className = 'fc-menu' + (FTX1F ? ' ftxm' : '');
      const sc = FACE.lcd;
      box.style.left = ((sc.x + 4 - V.x) / V.w * 100) + '%';
      box.style.top = ((sc.y + 4 - V.y) / V.h * 100) + '%';
      box.style.width = ((sc.w - 8) / V.w * 100) + '%';
      box.style.height = ((sc.h - 8) / V.h * 100) + '%';
      $('facePanel').appendChild(box);
      box.addEventListener('click', menuClick);
      box.addEventListener('wheel', (e) => {
        const r = e.target.closest('[data-it]');
        // FTX-1 : molette sur la liste = défiler (▲ ▼), sur le réglage choisi = changer sa valeur
        if (FTX1F && e.target.closest('.fx-items') && !(r && r.dataset.it === MV.sel)) { e.preventDefault(); return menuScroll(e.deltaY > 0 ? 1 : -1); }
        if (!r) return;
        e.preventDefault();
        MV.sel = r.dataset.it;
        menuAdjust(MV.sel, e.deltaY > 0 ? -1 : 1);
      }, { passive: false });
    }
    box.style.fontSize = Math.max(9, Math.round($('facePanel').clientWidth / V.w * (FTX1F ? 12.5 : 10.5))) + 'px';
    const subs = M ? M.groups.filter((g) => g.group === group) : [];
    MV.sub = subs.length ? (subs.find((g) => g.id === MV.sub) || subs[0]).id : '';
    box.hidden = false;
    if (MV.sub) menuReq();
    menuDraw();
    render();
  }
  function closeMenu() { MV.open = false; MV.sel = null; clearInterval(MV.auto); MV.auto = 0; const b = $('fcMenu'); if (b) b.hidden = true; render(); }
  // Lecture d'un sous-menu sur le TRX : état affiché (« lecture sur le TRX… », puis « pas de réponse » au bout de 20 s)
  function menuReq(quiet) {
    const M = MN(), g = M && M.groups.find((x) => x.id === MV.sub);
    if (!g || !g.items.some((it) => it.d.k !== 't' || it.d.read || it.d.src)) { MV.st = ''; return; } // rien à lire sur le TRX (SD CARD, RESET…)
    // FTX-1 : relecture discrète toutes les 8 s tant que l'écran est ouvert (réglage changé au TRX lui-même → visible ici)
    if (FTX1F && !MV.auto) MV.auto = setInterval(() => {
      if (MV.open && !MV.pend && (!MV.waiting || Date.now() - MV.waitSince > 30000) && Date.now() - (MV.lastAdj || 0) > 4000) menuReq(true);
    }, 8000);
    MV.waiting = true; MV.waitSince = Date.now();
    if (quiet) return send({ t: 'menu_read', sub: MV.sub, quiet: true });
    MV.st = 'lecture sur le TRX…';
    clearTimeout(MV.stT);
    MV.stT = setTimeout(() => { MV.st = 'pas de réponse du TRX (page Station, liaison CAT ?)'; if (MV.open) menuDraw(); }, 20000);
    send({ t: 'menu_read', sub: MV.sub });
  }
  function menuVals(m) {
    MV.waiting = false;
    if (m.quiet) { // relecture discrète : valeurs mises à jour, sans message ni état
      if (!MV.pend && Date.now() - (MV.lastAdj || 0) > 1500) for (const k in m.values || {}) MV.vals[k] = m.values[k];
      if (MV.open) menuDraw();
      return;
    }
    clearTimeout(MV.stT);
    const miss = (m.ids || []).filter((id) => !(id in (m.values || {}))).length;
    MV.st = m.err ? m.err : miss && m.ids.length > 1 ? miss + ' réglage(s) sans réponse du TRX : recliquez sur le sous-menu' : '';
    for (const k in m.values || {}) MV.vals[k] = m.values[k];
    for (const id of m.ids || []) if (!(id in (m.values || {}))) MV.vals[id] = null; // pas de réponse du TRX : « — » (jamais la valeur refusée)
    if (m.err) say('Menu du TRX : ' + m.err, 'warn', 5000);
    if (MV.open) menuDraw();
  }
  function menuDraw() {
    const box = $('fcMenu'), M = MN();
    if (!box || !MV.open) return;
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    if (FTX1F) return menuDrawFtx(box, M, esc);
    const subs = M ? M.groups.filter((g) => g.group === MV.group) : [];
    const g = subs.find((x) => x.id === MV.sub);
    let body;
    if (!M) body = '<p class="fm-note">Menus pas disponibles pour ce TRX.</p>';
    else if (!subs.length) body = '<p class="fm-note">' + esc(MV.group) + ' : date et heure, carte SD, version, étalonnage, remise à zéro… : réglages du TRX lui-même, <b>au club seulement</b> (rien à distance, par sécurité).</p>';
    else {
      body = '<div class="fm-subs">' + subs.map((x) => '<button type="button" data-sub="' + x.id + '" class="' + (x.id === MV.sub ? 'on' : '') + '">' + esc(x.name) + '</button>').join('') + '</div>' +
        '<div class="fm-items">' + g.items.map((it) => {
          const raw = it.d.src ? MV.vals[it.d.src] : MV.vals[it.id], sel = MV.sel === it.id, ro = it.d.ro;
          const val = raw === undefined ? '…' : M.show(it.d, raw);
          return '<div class="fm-row' + (sel ? ' sel' : '') + (ro ? ' ro' : '') + '" data-it="' + it.id + '" title="' + esc(it.label + (ro ? ' — lecture seule : ' + ro : ' — clic puis − / +, molette ou bouton MULTI')) + '">' +
            '<span class="fm-n">' + String(it.n).padStart(2, '0') + '</span><span class="fm-l">' + esc(it.label) + '</span>' +
            (sel && !ro ? '<button type="button" class="fm-pm" data-step="-1">−</button>' : '') + '<span class="fm-v">' + esc(val) + '</span>' +
            (sel && !ro ? '<button type="button" class="fm-pm" data-step="1">+</button>' : '') + '</div>';
        }).join('') + '</div>';
    }
    box.innerHTML = '<div class="fm-h"><b>' + esc(MV.group) + '</b>' + (g ? '<span>' + esc(g.name) + '</span>' : '') + '<button type="button" class="fm-x" data-close="1" title="Fermer">✕</button></div><div class="fm-b">' + body + '</div>' +
      '<div class="fm-f"><button type="button" class="fm-back" data-back="1" title="Retour au menu FUNC">BACK</button></div>';
  }
  // FTX-1 : écran … SETTING comme sur le TRX — titre, sous-menus à gauche (cadre orange), 5 réglages à droite (nom, valeur
  // jaune dans sa barre noire), ▲ ▼ et ascenseur, BACK en bas. Clic sur un réglage (cadre jaune) puis − / +, molette ou FUNC.
  const FX_ROWS = 5;
  function menuScroll(d) {
    const M = MN(), g = M && M.groups.find((x) => x.id === MV.sub);
    if (!g) return;
    MV.top = Math.max(0, Math.min(Math.max(0, g.items.length - FX_ROWS), (MV.top || 0) + d));
    menuDraw();
  }
  // Réglage choisi : toutes les valeurs possibles sous la barre (la valeur actuelle en surbrillance), même en lecture seule
  // Égaliseur d'émission (PRMTRC EQ…) : géré par les profils EQUALIZER TRX, pas par le menu
  const eqTrx = (it) => !!(it.d.ro && /EQUALIZER TRX/.test(it.d.ro));
  function openTrxEq() {
    const b = $('vxTrxBtn');
    if (!b || b.hidden || b.disabled) return say('EQUALIZER TRX : pas disponible pour l’instant (prenez la main ; page Station du club en ligne).', 'warn', 5000);
    closeMenu();
    b.click();
  }
  function menuChoices(M, it, raw, esc) {
    const d = it.d;
    if (d.k === 't') return '';
    if (d.k === 'n') return '<div class="fx-opts">' + esc(M.show(d, String(d.min)) + ' … ' + M.show(d, String(d.max)) + (d.step > 1 || d.fmt ? '' : '')) + '</div>';
    const codes = d.codes || d.labels.map((_, i) => i + d.base), cur = raw == null ? NaN : parseInt(raw, 10);
    if (codes.length > 24) return '<div class="fx-opts">' + esc(d.labels[0] + ' … ' + d.labels[d.labels.length - 1]) + '</div>';
    return '<div class="fx-opts">' + codes.map((c, i) => '<i' + (c === cur ? ' class="on"' : '') + '>' + esc(d.labels[i]) + '</i>').join('') + '</div>';
  }
  function menuDrawFtx(box, M, esc) {
    const subs = M ? M.groups.filter((g) => g.group === MV.group) : [];
    const g = subs.find((x) => x.id === MV.sub);
    const n = g ? g.items.length : 0, top = Math.max(0, Math.min(Math.max(0, n - FX_ROWS), MV.top || 0));
    MV.top = top;
    const rows = g ? g.items.slice(top, top + FX_ROWS).map((it) => {
      const raw = MV.vals[it.id], sel = MV.sel === it.id, ro = it.d.ro;
      const val = it.d.k === 't' && !it.d.read ? 'au TRX' : raw === undefined ? '…' : M.show(it.d, raw);
      return '<div class="fx-row' + (sel ? ' sel' : '') + (ro ? ' ro' : '') + '" data-it="' + it.id + '" title="' + esc(it.label + (ro ? ' — lecture seule : ' + ro : ' — clic puis − / +, molette ou bouton FUNC')) + '">' +
        '<div class="fx-l">' + esc(it.label) + (eqTrx(it) ? '<em class="fx-eqt">EQUALIZER TRX</em>' : '') + '</div><div class="fx-v">' + (sel && !ro ? '<button type="button" class="fx-pm" data-step="-1">−</button>' : '') +
        '<span>' + esc(val) + '</span>' + (sel && !ro ? '<button type="button" class="fx-pm" data-step="1">+</button>' : '') + '</div>' +
        (sel ? (it.d.k === 'dt' ? '<div class="fx-opts">Date et heure lues sur le TRX ' +
          '<button type="button" class="fx-eqb" data-dtsync="1" title="Envoie au TRX la date et l’heure locales de votre PC">Mettre à l’heure de votre PC</button></div>' : eqTrx(it) ? '<div class="fx-opts">Se règle dans EQUALIZER TRX (votre profil, ou celui du club pour un administrateur) ' +
          '<button type="button" class="fx-eqb" data-eqtrx="1">Ouvrir EQUALIZER TRX</button></div>' : menuChoices(M, it, raw, esc)) : '') + '</div>';
    }).join('') : '';
    const note = !g || !n ? '<p class="fx-note">' + esc(g ? g.name : MV.group) + ' : au club seulement (carte SD, version, étalonnage, remise à zéro… : rien à distance, par sécurité).</p>' : '';
    const th = n > FX_ROWS ? FX_ROWS / n * 100 : 100, tp = n > FX_ROWS ? top / n * 100 : 0;
    box.innerHTML = '<div class="fx-h">' + esc(MV.group) + (MV.st ? '<span class="fx-st">' + esc(MV.st) + '</span>' : '') + '</div><div class="fx-b"><div class="fx-subs">' +
      subs.map((x) => '<button type="button" data-sub="' + x.id + '" class="' + (x.id === MV.sub ? 'on' : '') + '">' + esc(x.name) + '</button>').join('') +
      '</div><div class="fx-items">' + (rows || note) + '</div><div class="fx-s"><button type="button" data-scr="-1" title="Réglages précédents">︿</button>' +
      '<div class="fx-tr"><i style="top:' + tp + '%;height:' + th + '%"></i></div><button type="button" data-scr="1" title="Réglages suivants">﹀</button></div></div>' +
      '<button type="button" class="fx-back" data-back="1" title="Retour à l’écran FUNC (touche BACK du TRX)">BACK</button>';
  }
  function menuClick(e) {
    const b = e.target.closest('button');
    if (b && b.dataset.scr) return menuScroll(Number(b.dataset.scr));
    if (b && b.dataset.close) return closeMenu();
    if (b && b.dataset.back) { closeMenu(); L.func = true; return render(); } // BACK : retour à l'écran FUNC, comme sur le TRX
    if (b && b.dataset.sub) { MV.sub = b.dataset.sub; MV.sel = null; MV.top = 0; menuReq(); return menuDraw(); }
    if (b && b.dataset.step) return menuAdjust(MV.sel, Number(b.dataset.step));
    if (b && b.dataset.eqtrx) return openTrxEq();
    if (b && b.dataset.dtsync) {
      if (!needControl()) return;
      const n = new Date(), p2 = (x) => String(x).padStart(2, '0');
      send({ t: 'menu_dt', date: n.getFullYear() + p2(n.getMonth() + 1) + p2(n.getDate()), time: p2(n.getHours()) + p2(n.getMinutes()) + p2(n.getSeconds()) });
      return say('DATE&TIME : date et heure de votre PC envoyées au TRX (' + n.toLocaleString('fr-BE') + ').', '', 4000);
    }
    const r = e.target.closest('[data-it]');
    if (!r) return;
    const M = MN(), it = M && M.item(r.dataset.it);
    MV.sel = r.dataset.it;
    if (it && it.d.ro) say(it.label + ' : lecture seule (' + it.d.ro + ').', '', 4000);
    menuDraw();
  }
  function menuAdjust(id, step) {
    const M = MN(), it = M && id && M.item(id);
    if (!it) return;
    MV.lastAdj = Date.now();
    if (it.d.ro) return say(it.label + ' : lecture seule (' + it.d.ro + ').', 'warn', 4000);
    if (!needControl()) return;
    const raw = MV.pend && MV.pend.id === id ? MV.pend.v : MV.vals[id];
    if (raw == null) return say(it.label + ' : valeur pas encore lue sur le TRX.', 'warn', 3000);
    const nv = M.step(it.d, raw, step);
    if (nv == null || nv === raw) return;
    MV.vals[id] = nv;
    MV.pend = { id, v: nv };
    menuDraw();
    // Plusieurs crans d'affilée : seule la dernière valeur part au TRX
    clearTimeout(MV.t);
    MV.t = setTimeout(() => { const p = MV.pend; MV.pend = null; if (p) send({ t: 'menu_write', id: p.id, v: p.v }); }, 400);
  }

  // ------------------------------------------------------------ FTX-1 : FUNC → DTMF (écran DTMF CODE du TRX)
  // Clavier 0-9 A-D * # Space ⌫ à gauche, mémoires 1 à 10 à droite (menus EX010328 à EX010337, lus à l'ouverture).
  // Les touches écrivent dans la mémoire choisie (cadre jaune), envoyée au TRX une fois la frappe finie (main prise).
  // Les tonalités DTMF ne passent pas par le CAT : rien n'est émis depuis cet écran.
  const DT = { open: false, mem: Array(10).fill(undefined), sel: 0, top: 0, t: 0, dirty: -1 };
  const DT_ROWS = 6;
  function dtmfOpen() {
    if (MV.open) closeMenu();
    DT.open = true; L.func = false; L.fEdit = false;
    let box = $('fcDtmf');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fcDtmf';
      box.className = 'fc-dtmf';
      const sc = FACE.lcd;
      box.style.left = ((sc.x + 4 - V.x) / V.w * 100) + '%';
      box.style.top = ((sc.y + 4 - V.y) / V.h * 100) + '%';
      box.style.width = ((sc.w - 8) / V.w * 100) + '%';
      box.style.height = ((sc.h - 8) / V.h * 100) + '%';
      $('facePanel').appendChild(box);
      box.addEventListener('click', dtmfClick);
      box.addEventListener('wheel', (e) => { e.preventDefault(); dtmfScroll(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    }
    box.style.fontSize = Math.max(9, Math.round($('facePanel').clientWidth / V.w * 12)) + 'px';
    box.hidden = false;
    send({ t: 'dtmf_read' });
    dtmfDraw();
    render();
  }
  function dtmfClose(back) {
    if (DT.dirty >= 0) dtmfFlush();
    DT.open = false;
    const b = $('fcDtmf'); if (b) b.hidden = true;
    if (back) L.func = true; // BACK de l'écran : retour à l'écran FUNC, comme sur le TRX
    render();
  }
  function dtmfVals(m) {
    (m.mem || []).forEach((v, i) => { if (i !== DT.dirty) DT.mem[i] = v; });
    if (m.err) say('DTMF : ' + m.err, 'warn', 5000);
    if (DT.open) dtmfDraw();
  }
  function dtmfScroll(d) {
    DT.top = Math.max(0, Math.min(10 - DT_ROWS, DT.top + d));
    dtmfDraw();
  }
  function dtmfFlush() {
    clearTimeout(DT.t);
    const i = DT.dirty;
    DT.dirty = -1;
    if (i < 0) return;
    const v = DT.mem[i] || '';
    if (!v) return say('DTMF : mémoire ' + (i + 1) + ' vide — une mémoire ne s’efface pas par le CAT (au TRX seulement) ; l’ancien code reste.', 'warn', 6000);
    send({ t: 'dtmf_write', n: i + 1, v });
  }
  function dtmfKey(k) {
    if (!needControl()) return;
    const i = DT.sel, cur = DT.mem[i];
    if (cur === undefined || cur === null) { if (k !== 'bs') return say('DTMF : mémoire ' + (i + 1) + ' pas encore lue sur le TRX, un instant.', 'warn', 3000); return; }
    let v = cur;
    if (k === 'bs') v = v.slice(0, -1);
    else if (v.length >= 16) return say('DTMF : 16 caractères au plus par mémoire.', 'warn', 3000);
    else v += k === 'sp' ? '-' : k; // espace = « - » dans le CAT du FTX-1
    DT.mem[i] = v; DT.dirty = i;
    dtmfDraw();
    clearTimeout(DT.t);
    DT.t = setTimeout(dtmfFlush, 1200); // envoyée au TRX une fois la frappe finie
  }
  function dtmfClick(e) {
    const b = e.target.closest('[data-k],[data-row],[data-up],[data-dn],[data-back]');
    if (!b) return;
    if (b.dataset.back) return dtmfClose(true);
    if (b.dataset.up) return dtmfScroll(-1);
    if (b.dataset.dn) return dtmfScroll(1);
    if (b.dataset.row) { if (DT.dirty >= 0 && DT.dirty !== +b.dataset.row) dtmfFlush(); DT.sel = +b.dataset.row; return dtmfDraw(); }
    if (b.dataset.k) dtmfKey(b.dataset.k);
  }
  function dtmfDraw() {
    const box = $('fcDtmf');
    if (!box || !DT.open) return;
    const show = (v) => (v === undefined ? '…' : v === null ? '—' : v.replace(/-/g, ' '));
    const keys = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'];
    let rows = '';
    for (let i = DT.top; i < DT.top + DT_ROWS; i++) {
      rows += '<div class="dt-row' + (i === DT.sel ? ' sel' : '') + '" data-row="' + i + '" title="Mémoire DTMF ' + (i + 1) + ' : clic pour la choisir, puis le clavier">' +
        '<b>' + (i + 1) + ':</b><span>' + show(DT.mem[i]) + '</span></div>';
    }
    const pct = DT.top / (10 - DT_ROWS);
    box.innerHTML = '<div class="dt-h">DTMF CODE</div><div class="dt-b">' +
      '<div class="dt-l"><div class="dt-f">' + show(DT.mem[DT.sel]) + '</div><div class="dt-keys">' +
      keys.map((k) => '<button type="button" data-k="' + k + '">' + k + '</button>').join('') +
      '<button type="button" class="dt-sp" data-k="sp">Space</button><span></span><button type="button" class="dt-bs" data-k="bs" title="Effacer le dernier caractère">⌫</button></div></div>' +
      '<div class="dt-m">' + rows + '</div>' +
      '<div class="dt-s"><button type="button" data-up="1" title="Mémoires précédentes">︿</button><div class="dt-tr"><i style="top:' + (pct * 50) + '%"></i></div><button type="button" data-dn="1" title="Mémoires suivantes">﹀</button></div>' +
      '</div><button type="button" class="dt-back" data-back="1" title="Retour à l’écran FUNC (touche BACK du TRX)">BACK</button>';
  }

  // Menu FUNC : valeurs lues sur le TRX ; RPT / ENC/DEC / TONE FREQ suivent le VFO sélectionné (MAIN ou SUB)
  const RPTS = ['SIMP', '+', '−'];
  const ENCDECS = ['OFF', 'ENC/DEC', 'ENC'];
  const CTCSS = [67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8, 118.8, 123.0, 127.3,
    131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 159.8, 162.2, 165.5, 167.9, 171.3, 173.8, 177.3, 179.9, 183.5, 186.2, 189.9, 192.8, 196.6, 199.5,
    203.5, 206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8, 250.3, 254.1];
  const num = (v) => (v != null ? String(v) : '—');
  // Codes DCS du FTX-1 (CN P1 1 : 000 à 103, manuel CAT Table 2)
  const DCS = ('023 025 026 031 032 036 043 047 051 053 054 065 071 072 073 074 114 115 116 122 125 131 132 134 143 145 152 155 156 162 165 172 174 ' +
    '205 212 223 225 226 243 244 245 246 251 252 255 261 263 265 266 271 274 306 311 315 325 331 332 343 346 351 356 364 365 371 411 412 413 423 431 432 ' +
    '445 446 452 454 455 462 464 465 466 503 506 516 523 526 532 546 565 606 612 624 627 631 632 654 662 664 703 712 723 731 732 734 743 754').split(' ');
  const SIDED = { rpt: 1, encDec: 1, toneIdx: 1, dcsIdx: 1 };
  const sideKey = (id) => (SIDED[id] && activeSide() === 'B' ? id + 'B' : id);
  // Réglage par pas (molette, MULTI, − / +), borné ; « sided » : côté du VFO sélectionné
  // RPT, ENC/DEC, TONE FREQ : en FM seulement (le TRX refuse OS / CT / CN dans les autres modes)
  // Cases grisées selon le mode, comme sur le TRX : RPT / ENC/DEC / TONE FREQ seulement en FM ;
  // MIC EQ inactif en CW, DATA, RTTY et PSK (actif en SSB, AM, FM) ; DECODE inactif en FM
  function modeInactive(id, s) {
    const m = L.activeMode(s);
    if (!m) return false;
    // FTX-1 : SQL TYPE se règle dans tous les modes (TONE FREQ, DCS, RPT : FM seulement, valeur affichée quand même)
    if (SIDED[id]) return !(FTX1F && id === 'encDec') && !/FM/.test(m);
    if (id === 'miceq') return /CW|DATA|RTTY|PSK/.test(m);
    if (id === 'decode') return /FM/.test(m);
    if (FTX1F && (id === 'aprsB' || id === 'aprsT')) return !/FM/.test(m); // APRS BEACON / BCN-TX : FM seulement (S.LIST, M.LIST : tous modes)
    if (ICOM) {
      // IC-7300 : réglages CW seulement en CW, micro / COMP / VOX seulement en phonie
      if (['keySpeed', 'cwPitch', 'bkinI'].indexOf(id) >= 0) return !/^CW/.test(m);
      if (['mic', 'procLvl', 'compI'].indexOf(id) >= 0) return /^(CW|RTTY)/.test(m);
      if (['voxI', 'voxGain', 'antiVox'].indexOf(id) >= 0) return /^(CW|RTTY)|-D$/.test(m);
    }
    return false;
  }
  const fmOnly = (id, s) => {
    if (!modeInactive(id, s)) return false;
    say(FUNC_BY[id][1] + (SIDED[id] ? ' : seulement en FM' : ' : inactif dans ce mode') + ' (le TRX est en ' + (L.activeMode(s) || '?') + ', case grisée comme sur le TRX).', 'warn', 4000);
    return true;
  };
  const ctlStep = (id, lo, hi, step) => (s, d) => {
    const k = sideKey(id);
    if (!R.CONTROL[k]) return say(FUNC_BY[id][1] + ' : pas disponible sur ce TRX.', 'warn', 3000);
    if (fmOnly(id, s)) return;
    const cur = s[k] != null ? s[k] : lo;
    setCtl(k, Math.max(lo, Math.min(hi, Math.round((cur + d * step) / step) * step)));
  };
  // Choix suivant au clic (RPT, ENC/DEC)
  const ctlCycle = (id, n) => (s, d) => {
    const k = sideKey(id);
    if (!R.CONTROL[k]) return say(FUNC_BY[id][1] + ' : pas disponible sur ce TRX.', 'warn', 3000);
    if (fmOnly(id, s)) return;
    setCtl(k, (((s[k] || 0) + (d > 0 ? 1 : n - 1)) % n));
  };
  const FUNC_YAESU = [
    // [id, libellé, valeur affichée (s), réglage (s, pas) | null, couleur du trait, basculer au clic]
    [['spd', 'SPEED', () => WF_SPEEDS[L.wfSpeed][0], (s, d) => { L.wfSpeed = Math.max(0, Math.min(4, L.wfSpeed + d)); store.set('rs.face.wfspd5', L.wfSpeed); ssSend('Spd'); }, '#ff8a1f'],
      ['peak', 'PEAK', () => PEAKS[L.peak], (s, d) => { L.peak = (L.peak + (d > 0 ? 1 : 5)) % 6; store.set('rs.face.peak', L.peak); WF.peak = {}; ssSend('Peak'); }, '#ff8a1f'],
      ['marker', 'MARKER', () => (L.marker ? 'ON' : 'OFF'), () => { L.marker = !L.marker; store.set('rs.face.marker', L.marker ? '1' : '0'); ssSend('Marker'); }, '#ff8a1f', true],
      ['color', 'COLOR', () => String(L.wfColor), (s, d) => { setColor(L.wfColor + (d > 0 ? 1 : -1)); openColors(); }, '#ff8a1f'],
      ['level', 'LEVEL', () => (L.wfLevel >= 0 ? '+' : '') + L.wfLevel.toFixed(1) + 'dB', (s, d) => { L.wfLevel = Math.max(-30, Math.min(30, L.wfLevel + d * 0.5)); store.set('rs.face.wflvl', L.wfLevel); ssSend('Level'); }, '#ff8a1f']],
    [['power', 'RF POWER', (s) => (s.power != null ? s.power + 'W' : '—'), (s, d) => power(d * 5), '#8a5cff'],
      ['moniLvl', 'MONI LEVEL', (s) => num(s.moniLvl), ctlStep('moniLvl', 0, 100, 1), '#8a5cff'],
      ['nrLvl', 'DNR LEVEL', (s) => (s.nrLvl != null ? String(s.nrLvl) : '—'), (s, d) => setCtl('nrLvl', Math.max(1, Math.min(15, (s.nrLvl || 1) + d))), '#8a5cff'],
      ['nbLvl', 'NB LEVEL', (s) => (s.nbLvl != null ? String(s.nbLvl) : '—'), (s, d) => setCtl('nbLvl', Math.max(0, Math.min(10, (s.nbLvl || 0) + d))), '#8a5cff'],
      ['voxGain', 'VOX GAIN', (s) => num(s.voxGain), ctlStep('voxGain', 0, 100, 1), '#8a5cff'],
      ['voxDelay', 'VOX DELAY', (s) => (s.voxDelay != null ? s.voxDelay + 'ms' : '—'), ctlStep('voxDelay', 30, 3000, 10), '#8a5cff'],
      ['antiVox', 'ANTI VOX', (s) => num(s.antiVox), ctlStep('antiVox', 0, 100, 1), '#8a5cff'],
      ['step', 'STEP DIAL', () => '', (s, d) => stepDial(d), '#8a5cff']],
    [['memch', 'MEM CH', () => '', null, '#8a5cff'],
      ['group', 'GROUP', () => '', null, '#8a5cff'],
      ['rfil', 'R.FIL', (s) => cellText('roof', s[activeSide() === 'B' ? 'roofB' : 'roof']), (s, d) => { const id = activeSide() === 'B' ? 'roofB' : 'roof'; setCtl(id, roofNext(s[id], d)); }, '#8a5cff', true],
      ['scan', 'SCAN', () => '', null, '#3ddc5a'],
      ['decode', 'DECODE', () => '', null, '#3ddc5a'],
      ['rpt', 'RPT', (s) => RPTS[s[sideKey('rpt')]] || '—', ctlCycle('rpt', 3), '#ff3b30', true],
      ['miceq', 'MIC EQ', (s) => (s.micEq ? 'ON' : 'OFF'), (s) => { if (!fmOnly('miceq', s)) setCtl('micEq', s.micEq ? 0 : 1); }, '#ff3b30', true],
      ['encDec', 'ENC/DEC', (s) => ENCDECS[s[sideKey('encDec')]] || '—', ctlCycle('encDec', 3), '#38b6ff', true]],
    [['toneIdx', 'TONE FREQ', (s) => (CTCSS[s[sideKey('toneIdx')]] != null ? CTCSS[s[sideKey('toneIdx')]].toFixed(1) : '—'), ctlStep('toneIdx', 0, 49, 1, true), '#38b6ff'],
      ['rec', 'REC/PLAY', () => '', null, '#38b6ff'],
      ['qmb', 'QMB LIST', () => '', null, '#38b6ff'],
      ['radio', 'RADIO SETTING', () => '', null, '#ffb020'],
      ['cwset', 'CW SETTING', () => '', null, '#ffb020'],
      ['opset', 'OPERATION SETTING', () => '', null, '#ffb020'],
      ['disp', 'DISPLAY SETTING', () => '', null, '#ffb020'],
      ['ext', 'EXTENSION SETTING', () => '', null, '#ffb020']]
  ];
  // IC-7300 : écran FUNCTION à la manière Icom — interrupteurs (clic), puis niveaux réglés au bouton MULTI
  const pct = (v) => (v == null ? '—' : Math.round(v / 2.55) + '%');
  const onOff = (v) => (v == null ? '—' : v ? 'ON' : 'OFF');
  const tog = (id) => (s) => {
    if (!R.CONTROL[id]) return say('Pas disponible sur ce TRX.', 'warn', 3000);
    if (R.CONTROL[id].offOnly && !s[id]) return say(R.CONTROL[id].label + ' : ne peut être que coupé à distance.', 'warn', 4000);
    setCtl(id, s[id] ? 0 : 1);
  };
  const cyc = (id) => (s) => { const c = R.CONTROL[id]; if (!c || !c.options) return; const i = c.options.findIndex((o) => o[0] === s[id]); setCtl(id, c.options[(i + 1) % c.options.length][0]); };
  const pickY = (id) => FUNC_YAESU.flat().find((c) => c[0] === id);
  // NOTCH de l'IC-7300, comme la touche du TRX : OFF → AN (automatique) → MN (manuel, avec sa largeur) → OFF ; pas d'AN en CW
  const NOTCH_W = ['WIDE', 'MID', 'NAR'];
  const notchTxt = (s) => (s.dnf ? 'AN' : s.notch ? 'MN' + (NOTCH_W[s.notchW] ? '(' + NOTCH_W[s.notchW] + ')' : '') : 'OFF');
  function notchCycle(s) {
    const cw = /^CW/.test(L.activeMode(s) || '');
    if (s.dnf) { setCtl('dnf', 0); setCtl('notch', 1); }
    else if (s.notch) setCtl('notch', 0);
    else if (cw) setCtl('notch', 1);
    else setCtl('dnf', 1);
  }
  const IB = '#38b6ff', IO = '#ffb020', IG = '#3ddc5a';
  const FUNC_ICOM = [
    [['agcI', 'AGC', (s) => ['', 'FAST', 'MID', 'SLOW'][s.agc] || '—', cyc('agc'), IB, true],
      ['nbI', 'NB', (s) => onOff(s.nb), tog('nb'), IB, true],
      ['nrI', 'NR', (s) => onOff(s.nr), tog('nr'), IB, true],
      // NOTCH comme la touche du TRX : OFF → AN (automatique) → MN (manuel) → OFF
      ['notchI', 'NOTCH', (s) => notchTxt(s), (s) => notchCycle(s), IB, true],
      ['pampI', 'P.AMP', (s) => ['OFF', 'AMP1', 'AMP2'][s.preamp] || '—', cyc('preamp'), IB, true],
      ['attI', 'ATT', (s) => (s.att == null ? '—' : s.att ? '20dB' : 'OFF'), tog('att'), IB, true],
      ['ipI', 'IP+', (s) => onOff(s.ipPlus), tog('ipPlus'), IB, true],
      ['compI', 'COMP', (s) => onOff(s.proc), tog('proc'), IB, true]],
    [['voxI', 'VOX', (s) => onOff(s.vox), tog('vox'), IB, true],
      ['bkinI', 'BK-IN', (s) => ['OFF', 'SEMI', 'FULL'][s.bkin] || '—', cyc('bkin'), IB, true],
      ['moniI', 'MONI', (s) => onOff(s.moni), tog('moni'), IB, true],
      ['tunerI', 'TUNER', (s) => onOff(s.tuner), tog('tuner'), IB, true],
      ['lockI', 'LOCK', (s) => onOff(s.lock), (s) => (me && me.admin ? tog('lock')(s) : say('LOCK : réservé aux administrateurs.', 'warn', 4000)), IB, true],
      ['splitI', 'SPLIT', (s) => onOff(s.split), () => doAct({ act: { local: 'split' } }), IB, true],
      ['aeqb', 'A=B', () => '', () => setCtl('aToB', null), IB, true],
      pickY('spd')],
    [['power', 'RF POWER', (s) => (s.power != null ? s.power + 'W' : '—'), (s, d) => power(d * 5), IO],
      ['mic', 'MIC GAIN', (s) => pct(s.mic), ctlStep('mic', 0, 255, 5), IO],
      ['procLvl', 'COMP', (s) => pct(s.procLvl), ctlStep('procLvl', 0, 255, 5), IO],
      ['moniLvl', 'MONITOR', (s) => pct(s.moniLvl), ctlStep('moniLvl', 0, 255, 5), IO],
      ['keySpeed', 'KEY SPEED', (s) => (s.keySpeed != null ? s.keySpeed + 'wpm' : '—'), ctlStep('keySpeed', 6, 48, 1), IO],
      ['cwPitch', 'CW PITCH', (s) => (s.cwPitch != null ? s.cwPitch + 'Hz' : '—'), ctlStep('cwPitch', 300, 900, 5), IO],
      ['voxGain', 'VOX GAIN', (s) => pct(s.voxGain), ctlStep('voxGain', 0, 255, 5), IO],
      ['antiVox', 'ANTI VOX', (s) => pct(s.antiVox), ctlStep('antiVox', 0, 255, 5), IO]],
    [['nbLvl', 'NB LEVEL', (s) => pct(s.nbLvl), ctlStep('nbLvl', 0, 255, 5), IG],
      ['nrLvl', 'NR LEVEL', (s) => pct(s.nrLvl), ctlStep('nrLvl', 0, 255, 5), IG],
      ['notchPos', 'NOTCH POS', (s) => num(s.notchPos), ctlStep('notchPos', 0, 255, 2), IG],
      ['sqlI', 'SQL', (s) => pct(s.sql), ctlStep('sql', 0, 255, 5), IG],
      pickY('color'), pickY('level'), pickY('peak'), pickY('marker')]
  ];
  // FTX-1 : écran FUNC du TRX (appui de 2 s sur FUNC), 3 pages de 4 rangées de 7 cases, comme sur le TRX :
  // tourner FUNC = déplacer le cadre orange, pousser FUNC = régler la case (tourner FUNC change la valeur, pousser à nouveau : fini)
  const FTX1F = !!(FACE && FACE.model === 'ftx1');
  const sdk = (id) => (activeSide() === 'B' && R.CONTROL[id + 'B'] ? id + 'B' : id); // côté du récepteur sélectionné
  const msCode = (c) => (c == null ? '—' : (c <= 5 ? [30, 50, 100, 150, 200, 250][c] : 300 + (c - 6) * 100) + 'ms');
  // Envoi au TRX pendant qu'on tourne / tient − +, au plus une commande toutes les 250 ms (le TRX suit la progression,
  // sans rafale de commandes qui le ferait répondre « ?; ») ; la dernière valeur part toujours
  const THR = {};
  function throttleSet(k, v, fn) {
    const t = THR[k] || (THR[k] = { timer: 0 });
    t.v = v;
    if (t.timer) return;
    fn(v); t.sent = v;
    const tick = () => { if (t.v !== t.sent) { fn(t.v); t.sent = t.v; t.timer = setTimeout(tick, 250); } else t.timer = 0; };
    t.timer = setTimeout(tick, 250);
  }
  // Réglage par crans, fluide : la valeur affichée suit chaque cran, le TRX suit toutes les 250 ms
  L.stepT = {};
  const stepK = (kf, lo, hi, st) => (s, d) => {
    const k = kf();
    if (!R.CONTROL[k]) return say('Pas disponible sur ce TRX.', 'warn', 3000);
    const cur = s[k] != null ? s[k] : lo, v = Math.max(lo, Math.min(hi, Math.round((cur + d * st) / st) * st));
    pend[k] = { v, at: Date.now() };
    throttleSet(k, v, (x) => setCtl(k, x));
  };
  const cycK = (kf) => (s, d) => { const k = kf(), c = R.CONTROL[k]; if (!c || !c.options) return; const i = c.options.findIndex((o) => o[0] === s[k]); setCtl(k, c.options[((i < 0 ? 0 : i) + (d < 0 ? c.options.length - 1 : 1)) % c.options.length][0]); };
  const togK = (kf) => (s) => tog(kf())(s);
  const offLvl = (v) => (v == null ? '—' : v ? String(v) : 'OFF');
  const optTxt = (id, v) => { const c = R.CONTROL[id]; const o = c && c.options && c.options.find((x) => x[0] === v); return o ? o[1] : '—'; };
  // RF POWER au bouton FUNC : 1 W par cran avec le SPA-1 (5 à 100 W), 0,5 W avec la tête seule. Les crans rapprochés sont
  // envoyés au plus toutes les 250 ms pendant qu'on tourne (une rafale de PC faisait répondre « ?; » au FTX-1)
  function ftxPower(s, d) {
    const head = s.powerHead === '1' ? '1' : '2', st = head === '1' ? 0.5 : 1, lo = head === '1' ? 0.5 : 5;
    const hi = Math.min((me && me.maxWatts) || 100, head === '1' ? 10 : 100);
    const base = L.pwrPend && Date.now() - L.pwrPend.at < 2500 ? L.pwrPend.w : (s.power || lo);
    const w = Math.max(lo, Math.min(hi, Math.round((base + d * st) / st) * st));
    L.pwrPend = { w, at: Date.now() };
    pend.power = { v: w, at: Date.now() };
    throttleSet('power', w, (x) => { send({ t: 'set', power: x }); pend.power = { v: x, at: Date.now() }; });
  }
  const FO = '#ffb020';
  const info = (id, lab) => [id, lab, () => '', null, FO];
  // Touches FM / C4FM sans commande CAT sur le FTX-1 (manuel CAT 2507-B) : ce qu'elles font au TRX
  const FTX_NOTE = {
    dgTx: 'DG-ID TX : numéro DG-ID d’émission en C4FM, 00 à 99 au TRX. Le FTX-1 n’a pas de commande CAT pour DG-ID : à régler au club, sur le TRX.',
    dgRx: 'DG-ID RX : numéro DG-ID de réception en C4FM, 00 à 99 au TRX. Le FTX-1 n’a pas de commande CAT pour DG-ID : à régler au club, sur le TRX.',
    home: 'HOME : retour sur la dernière fréquence FM choisie. Pas de commande CAT HOME sur le FTX-1 : touche du TRX seulement.',
    rev: 'REV : écoute sur la fréquence d’émission du relais. Pas de commande CAT REV sur le FTX-1 : touche du TRX seulement.',
    aprsS: 'APRS S.LIST : liste des stations APRS reçues. Les listes et balises APRS du FTX-1 n’ont pas de commande CAT : au TRX seulement.',
    aprsM: 'APRS M.LIST : liste des messages APRS. Les listes et balises APRS du FTX-1 n’ont pas de commande CAT : au TRX seulement.',
    aprsB: 'APRS BEACON : mode de balise APRS (FM). Pas de commande CAT : au TRX seulement.',
    aprsT: 'APRS BCN-TX : envoi d’une balise APRS (émission, FM). Pas à distance.',
    tcall: 'T-CALL : tonalité 1750 Hz d’ouverture de relais (émission). Pas à distance.'
  };
  // SF (manuel CAT FTX-1) : code 1 à 17 (1-9, A-H) → case FUNC
  const SF_IDS = ['', 'level', 'peak', 'color', 'dContrast', 'dimmer', '', 'mic', 'procLvl', 'amc', 'voxGain', 'voxDelay', '', 'power', 'moniLvl', 'keySpeed', 'cwPitch', 'bkDelay'];
  const FUNC_FTX1 = [
    { name: 'SSB', rows: [
      [null, pickY('level') && ['level', 'D-LEVEL', pickY('level')[2], pickY('level')[3], FO], ['peak', 'D-PEAK', () => 'LV' + (L.peak + 1), pickY('peak')[3], FO],
        ['marker', 'D-MARKER', pickY('marker')[2], pickY('marker')[3], FO, true], ['color', 'D-COLOR', pickY('color')[2], pickY('color')[3], FO],
        ['dContrast', 'D-CONTRAST', (s) => num(s.dContrast), stepK(() => 'dContrast', 0, 20, 1), FO], ['dimmer', 'DIMMER', (s) => num(s.dimmer), stepK(() => 'dimmer', 0, 20, 1), FO]],
      [['mox', 'MOX', (s) => (s.tx ? 'ON' : 'OFF'), null, FO], ['attF', 'ATT', (s) => onOff(s[sdk('att')]), togK(() => sdk('att')), FO, true],
        ['ipoF', 'IPO', (s) => { const t = R.preampText && R.preampText(s, activeSide()); return t ? t[0] : '—'; },
          (s, d) => { const f = activeSide() === 'B' ? s.freqB : s.freq; if (f >= 144000000 && activeSide() === 'A') return tog('preampVU')(s); cycK(() => sdk('preamp'))(s, d); }, FO, true],
        ['dnfF', 'DNF', (s) => onOff(s[sdk('dnf')]), togK(() => sdk('dnf')), FO, true],
        ['agcF', 'AGC', (s) => optTxt(sdk('agc'), s[sdk('agc')]), cycK(() => sdk('agc')), FO, true],
        ['miceq', 'MIC EQ', (s) => onOff(s.micEq), tog('micEq'), FO, true],
        ['procLvl', 'PROC LEVEL', (s) => offLvl(s.procLvl), stepK(() => 'procLvl', 0, 100, 1), FO]],
      [['tuneF', 'ANT TUNE', () => '', () => doAct({ act: { action: 'tune' } }), FO, true], ['tunerF', 'TUNER', (s) => onOff(s.tuner), tog('tuner'), FO, true], null,
        ['nbF', 'NB', (s) => offLvl(s[sdk('nb')]), stepK(() => sdk('nb'), 0, 10, 1), FO], ['nrF', 'DNR', (s) => offLvl(s[sdk('nr')]), stepK(() => sdk('nr'), 0, 10, 1), FO],
        ['antF', 'ANT', (s) => num(s.ant), cycK(() => 'ant'), FO, true], ['txwF', 'TXW', (s) => onOff(s.txw), tog('txw'), FO, true]],
      [['power', 'RF POWER', (s) => (s.power != null ? s.power + 'W' : '—'), ftxPower, FO], ['mic', 'MIC GAIN', (s) => num(s.mic), stepK(() => 'mic', 0, 100, 1), FO],
        ['amc', 'AMC LEVEL', (s) => num(s.amc), stepK(() => 'amc', 1, 100, 1), FO], ['voxF', 'VOX', (s) => onOff(s.vox), tog('vox'), FO, true],
        ['voxGain', 'VOX GAIN', (s) => num(s.voxGain), stepK(() => 'voxGain', 0, 100, 1), FO], ['voxDelay', 'VOX DELAY', (s) => msCode(s.voxDelay), stepK(() => 'voxDelay', 0, 33, 1), FO],
        ['fwd1', 'FWD', () => '', null, FO, false, 'fwd']]] },
    { name: 'CW', rows: [
      [null, ['moniLvl', 'MONI LEVEL', (s) => num(s.moniLvl), stepK(() => 'moniLvl', 0, 100, 1), FO], null, null, null, null, null],
      [['keyerF', 'KEYER', (s) => onOff(s.keyer), tog('keyer'), FO, true], ['bkinF', 'BK-IN', (s) => onOff(s.bkin), tog('bkin'), FO, true],
        ['keySpeed', 'CW SPEED', (s) => (s.keySpeed != null ? s.keySpeed + 'wpm' : '—'), stepK(() => 'keySpeed', 4, 60, 1), FO],
        ['cwPitch', 'CW PITCH', (s) => (s.cwPitch != null ? s.cwPitch + 'Hz' : '—'), stepK(() => 'cwPitch', 300, 1050, 10), FO],
        ['bkDelay', 'BK-DELAY', (s) => msCode(s.bkDelay), stepK(() => 'bkDelay', 0, 33, 1), FO],
        ['zinF', 'ZIN', () => '', (s) => (/^CW/.test(L.activeMode(s) || '') ? setCtl('zin', null) : say('ZIN : en CW seulement.', '', 3000)), FO, true],
        ['cwSpotF', 'CW SPOT', (s) => onOff(s.cwSpot), tog('cwSpot'), FO, true]],
      [null, null, null, null, info('cwMsg', 'MESSAGE'), info('cwPlay', 'PLAY'), info('cwRec', 'RECORD')],
      [['back2', 'BACK', () => '', null, FO, false, 'back'], null, null, null, null, null, ['fwd2', 'FWD', () => '', null, FO, false, 'fwd']]] },
    { name: 'FM/C4FM', rows: [
      [null, ['dtmf', 'DTMF', () => '', () => dtmfOpen(), FO, true], info('tcall', 'T-CALL'), null, null, ['rpt', 'RPT SHIFT', (s) => optTxt(sideKey('rpt'), s[sideKey('rpt')]), ctlCycle('rpt', 4), FO, true], info('rev', 'REV')],
      [info('dgTx', 'DG-ID TX'), info('dgRx', 'DG-ID RX'), null, info('aprsS', 'APRS S.LIST'), info('aprsM', 'APRS M.LIST'), info('aprsB', 'APRS BEACON'), info('aprsT', 'APRS BCN-TX')],
      [info('chStep', 'CH STEP'), null, null, ['encDec', 'SQL TYPE', (s) => optTxt(sideKey('encDec'), s[sideKey('encDec')]), ctlCycle('encDec', 6), FO, true],
        ['toneIdx', 'TONE FREQ', (s) => (CTCSS[s[sideKey('toneIdx')]] != null ? CTCSS[s[sideKey('toneIdx')]].toFixed(1) + 'Hz' : '—'), ctlStep('toneIdx', 0, 49, 1), FO],
        ['dcsIdx', 'DCS', (s) => DCS[s[sideKey('dcsIdx')]] || '—', ctlStep('dcsIdx', 0, 103, 1), FO], info('home', 'HOME')],
      [['back3', 'BACK', () => '', null, FO, false, 'back'], info('radioS', 'RADIO SETTING'), info('cwS', 'CW SETTING'), info('opS', 'OPERATION SETTING'),
        info('dispS', 'DISPLAY SETTING'), info('extS', 'EXTENSION SETTING'), info('aprsSet', 'APRS SETTING')]] }
  ];
  const FUNC = ICOM ? FUNC_ICOM : FTX1F ? FUNC_FTX1.flatMap((p) => p.rows) : FUNC_YAESU;
  // MULTI de l'IC-7300 (pousser le bouton) : les réglages du mode en cours, comme sur le TRX
  function multiItems(s) {
    const m = L.activeMode(s) || '';
    if (/^CW/.test(m)) return ['power', 'keySpeed', 'cwPitch', 'moniLvl'];
    if (/^RTTY|-D$/.test(m)) return ['power', 'mic', 'moniLvl'];
    if (/SB$/.test(m)) return ['power', 'mic', 'procLvl', 'moniLvl'];
    return ['power', 'mic', 'moniLvl'];
  }
  // STEP DIAL (comme sur le TRX) : le bouton MULTI fait monter / descendre la fréquence du VFO sélectionné par pas de canal
  // (menu OPERATION SETTING → TUNING → CH STEP : 1 / 2,5 / 5 kHz ; 2,5 kHz si pas encore lu)
  function stepDial(d) {
    const s = S(), side = activeSide(), cur = side === 'B' ? s.freqB : s.freq;
    if (cur == null || !d) return;
    const ch = [1000, 2500, 5000][parseInt(MV.vals['030503'], 10)] || 2500;
    const hz = d > 0 ? (Math.floor(cur / ch) + d) * ch : (Math.ceil(cur / ch) + d) * ch;
    tuneTo(side, hz);
  }
  const FUNC_BY = {};
  for (const row of FUNC) for (const c of row) if (c) FUNC_BY[c[0]] = c;
  if (!FUNC_BY[L.funcSel]) L.funcSel = 'power'; // choix gardé d'une autre face avant (autre TRX)
  function funcAdjust(id, d) {
    const c = FUNC_BY[id];
    if (!c || !c[3]) return false;
    const local = ['spd', 'color', 'level', 'peak', 'marker'].indexOf(id) >= 0;
    if (!local && !needControl()) return true;
    c[3](S(), d);
    render();
    return true;
  }
  function buildFunc(g, c) {
    if (FTX1F) return buildFuncFtx1(g, c);
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const f = LCD.func = el('g', { class: 'func', style: 'display:none' }, g);
    el('rect', { x: X(3), y: Y(130), width: c.w - 6, height: 166, class: 'func-bg' }, f);
    const cw = (c.w - 10) / 8, rh = 41;
    LCD.funcCells = {};
    FUNC.forEach((row, ri) => {
      const y = Y(132 + ri * rh);
      row.forEach(([id, lab, , adj, col, flip], ci) => {
        const x = X(5) + ci * cw;
        const box = el('rect', { x: x + 1, y, width: cw - 2, height: rh - 7, rx: 2, class: 'func-cell' + (adj || MENU_CELL[id] ? '' : ' off') }, f);
        const two = lab.indexOf(' SETTING') > 0;
        const t1 = el('text', { x: x + cw / 2, y: y + (two ? 14 : 13), class: 'func-lab', 'text-anchor': 'middle' }, f, two ? lab.replace(' SETTING', '') : lab);
        const t2 = el('text', { x: x + cw / 2, y: y + 27, class: two ? 'func-lab' : 'func-val', 'text-anchor': 'middle' }, f, two ? 'SETTING' : '');
        el('rect', { x: x + (ci === 0 ? 1 : 0), y: y + rh - 5, width: cw - (ci === 0 ? 1 : 0), height: 2, fill: col, opacity: 0.9 }, f);
        // Case choisie : « − » à gauche et « + » à droite, cliquables (en plus de la molette et du bouton MULTI)
        const minus = adj && !flip ? el('text', { x: x + 9, y: y + 26, class: 'func-pm', 'text-anchor': 'middle' }, f, '−') : null;
        const plus = adj && !flip ? el('text', { x: x + cw - 9, y: y + 26, class: 'func-pm', 'text-anchor': 'middle' }, f, '+') : null;
        const hit = el('rect', { x: x + 1, y, width: cw - 2, height: rh - 7, class: 'hs lcd-hit' }, f);
        el('title', {}, hit, adj ? lab + (flip ? ' : clic pour changer' : ' : clic pour la choisir, puis clic sur − / +, molette ou bouton MULTI') : MENU_CELL[id] ? lab + ' : menus du TRX (clic pour ouvrir)' : lab + ' : pas disponible à distance');
        hit.addEventListener('click', (ev) => {
          if (!adj && MENU_CELL[id]) return openMenu(MENU_CELL[id]);
          if (modeInactive(id, S())) { fmOnly(id, S()); return; }
          if (!adj) return say(lab + ' : pas disponible à distance (menus du TRX : au club).', '', 3500);
          const wasSel = L.funcSel === id;
          L.funcSel = id;
          store.set('rs.face.funcsel', id);
          if (flip) funcAdjust(id, 1);
          else if (wasSel) {
            const px = toImg(ev).x - x;
            if (px < cw * 0.38) funcAdjust(id, -1);
            else if (px > cw * 0.62) funcAdjust(id, 1);
          } else say(lab + ' : cliquez sur − ou + dans la case, ou tournez la molette sur la case ou le bouton MULTI.', '', 4000);
          render();
        });
        let wacc = 0;
        hit.addEventListener('wheel', (ev) => {
          ev.preventDefault();
          if (!adj || modeInactive(id, S())) return;
          L.funcSel = id;
          const d = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
          let n;
          if (Math.abs(d) >= 50) { wacc = 0; n = Math.sign(d); } else { wacc += d; n = Math.trunc(wacc / 100); if (!n) return; wacc -= n * 100; }
          funcAdjust(id, -n);
          showTip(ev, lab + ' ' + FUNC_BY[id][2](S()));
        }, { passive: false });
        LCD.funcCells[id] = { box, t1, t2, two, minus, plus };
      });
    });
  }
  function drawFunc(s) {
    if (!LCD.func) return;
    if (FTX1F) return drawFuncFtx1(s);
    LCD.func.style.display = L.func && !ICOM ? '' : 'none'; // IC-7300 : écran FUNCTION Icom (buildIcFunc)
    if (!L.func) return;
    for (const id in LCD.funcCells) {
      const c = LCD.funcCells[id];
      const ina = modeInactive(id, s);
      c.box.classList.toggle('sel', L.funcSel === id && !ina);
      c.box.classList.toggle('inact', ina);
      c.t1.classList.toggle('dim', ina);
      c.t2.classList.toggle('dim', ina);
      if (!c.two) c.t2.textContent = FUNC_BY[id][2](s);
      if (ina && c.minus) { c.minus.style.display = 'none'; c.plus.style.display = 'none'; continue; }
      if (c.minus) { c.minus.style.display = L.funcSel === id ? '' : 'none'; c.plus.style.display = L.funcSel === id ? '' : 'none'; }
    }
  }
  // ---- FTX-1 : écran FUNC (pages, cadre déplacé par FUNC, réglage après un appui sur FUNC)
  L.funcPage = 0; L.fEdit = false;
  const ftxPageOf = (id) => FUNC_FTX1.findIndex((p) => p.rows.some((r) => r.some((c) => c && c[0] === id)));
  const ftxIds = (pg) => FUNC_FTX1[pg].rows.flat().filter(Boolean).map((c) => c[0]);
  const ftxModePage = (s) => { const m = L.activeMode(s) || ''; return /^CW/.test(m) ? 1 : /FM|C4FM/.test(m) ? 2 : 0; };
  function ftxFuncToggle() {
    viewTouched();
    if (MV.open) closeMenu();
    if (DT.open) { dtmfClose(); L.func = false; }
    L.func = !L.func; L.fEdit = false;
    if (L.func) L.dsp = null; // l'écran FUNC remplace l'écran DSP
    if (L.func) {
      L.funcPage = ftxModePage(S());
      if (ftxPageOf(L.funcSel) !== L.funcPage) L.funcSel = ftxIds(L.funcPage)[0];
      say('FUNC : tourner FUNC = choisir la case, pousser FUNC = la régler (tourner), pousser à nouveau = fini ; appui de 2 s sur FUNC : sortie.', '', 5000);
    }
    return render();
  }
  function ftxPage(pg) {
    L.funcPage = (pg + FUNC_FTX1.length) % FUNC_FTX1.length; L.fEdit = false;
    L.funcSel = ftxIds(L.funcPage)[0];
    render();
  }
  function ftxFuncPush() {
    if (!L.func) return ftxFuncToggle();
    const c = FUNC_BY[L.funcSel];
    if (!c || ftxPageOf(c[0]) !== L.funcPage) return;
    if (c[6] === 'fwd') return ftxPage(L.funcPage + 1);
    if (c[6] === 'back') return ftxPage(L.funcPage - 1);
    if (!c[3]) return say(c[1] + ' : pas disponible à distance (au club, sur le TRX).', '', 3500);
    if (c[5]) { funcAdjust(c[0], 1); return; }
    L.fEdit = !L.fEdit;
    if (L.fEdit) say(c[1] + ' : tournez FUNC (ou molette, − / +) ; poussez FUNC pour finir.', '', 3500);
    render();
  }
  function ftxCursor(n) {
    const ids = ftxIds(L.funcPage);
    let i = ids.indexOf(L.funcSel);
    i = i < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, i + n));
    L.funcSel = ids[i]; L.fEdit = false;
    render();
    return FUNC_BY[L.funcSel][1];
  }
  function buildFuncFtx1(g, c) {
    const X = (v) => c.x + v, Y = (v) => c.y + v;
    const f = LCD.func = el('g', { class: 'func ftxf', style: 'display:none' }, g);
    const top = FACE.meterDy ? G.lowY + 1 : 130, rh = (c.h - top - 2) / 4, cw = (c.w - 10) / 7; // FTX-1 : sous les galvanomètres
    el('rect', { x: X(3), y: Y(top - 2), width: c.w - 6, height: c.h - top + 2, class: 'func-bg' }, f);
    LCD.funcCells = {}; LCD.funcPages = [];
    FUNC_FTX1.forEach((pg, pi) => {
      const pgG = el('g', { style: 'display:none' }, f);
      LCD.funcPages.push(pgG);
      pg.rows.forEach((row, ri) => row.forEach((cell, ci) => {
        const x = X(5) + ci * cw, y = Y(top + ri * rh), h = rh - 5;
        if (!cell && !(ri === 0 && ci === 0)) return;
        if (!cell) { // case PAGE n/3 + nom de la page
          el('rect', { x: x + 1, y, width: cw - 2, height: h, rx: 3, class: 'ftx-pg' }, pgG);
          el('text', { x: x + cw / 2, y: y + h / 2 - 2, class: 'ftx-pgt', 'text-anchor': 'middle' }, pgG, 'PAGE ' + (pi + 1) + '/' + FUNC_FTX1.length);
          el('text', { x: x + cw / 2, y: y + h / 2 + 11, class: 'ftx-pgt', 'text-anchor': 'middle' }, pgG, pg.name);
          return;
        }
        const [id, lab, , adj, , flip, kind] = cell;
        const setting = / SETTING$|^APRS /.test(lab); // … SETTING et touches APRS : texte bleu clair, comme sur le TRX
        const box = el('rect', { x: x + 1, y, width: cw - 2, height: h, rx: 3, class: 'func-cell' + (setting ? ' setting' : adj || kind ? '' : ' off') }, pgG);
        const noVal = !!kind || id === 'tuneF' || id === 'zinF' || (!adj && id !== 'mox'); // case sans valeur : nom au milieu
        const two = noVal && !kind && lab.indexOf(' ') > 0 && lab.length > 9;
        const words = two ? [lab.slice(0, lab.indexOf(' ')), lab.slice(lab.indexOf(' ') + 1)] : [lab];
        const t1 = el('text', { x: x + cw / 2, y: y + (noVal ? h / 2 - (two ? 2 : kind ? 0 : -4) : h / 2 - 3), class: 'func-lab' + (kind ? ' nav' : '') + (setting ? ' setting' : ''), 'text-anchor': 'middle' }, pgG, words[0]);
        const t2 = el('text', { x: x + cw / 2, y: y + h / 2 + (two ? 11 : 13), class: (two ? 'func-lab' : 'func-val') + (setting ? ' setting' : ''), 'text-anchor': 'middle' }, pgG, two ? words[1] : '');
        if (kind) el('path', { d: kind === 'fwd' ? 'M' + (x + 12) + ' ' + (y + h - 8) + 'h' + (cw - 26) + 'l-8 -5' : 'M' + (x + cw - 12) + ' ' + (y + h - 8) + 'h-' + (cw - 26) + 'l8 -5', class: 'ftx-arrow' }, pgG);
        const minus = adj && !flip ? el('text', { x: x + 9, y: y + h / 2 + 13, class: 'func-pm', 'text-anchor': 'middle' }, pgG, '−') : null;
        const plus = adj && !flip ? el('text', { x: x + cw - 9, y: y + h / 2 + 13, class: 'func-pm', 'text-anchor': 'middle' }, pgG, '+') : null;
        const hit = el('rect', { x: x + 1, y, width: cw - 2, height: h, class: 'hs lcd-hit' }, pgG);
        el('title', {}, hit, kind ? (kind === 'fwd' ? 'Page suivante' : 'Page précédente') : adj ? lab + (flip ? ' : clic pour changer' : ' : clic pour la régler, puis − / +, molette ou bouton FUNC') : lab + ' : pas disponible à distance');
        hit.addEventListener('click', (ev) => {
          if (kind) return ftxPage(L.funcPage + (kind === 'fwd' ? 1 : -1));
          if (modeInactive(id, S())) { fmOnly(id, S()); return; }
          // Menus … SETTING : paramètres essentiels du TRX, réservés aux administrateurs (ON6DP, ON4LUC)
          // APRS BEACON : ouvre le menu APRS BEACON (BEACON SET., AUTO BEACON, SmartBeac., BEACON TEXT), comme sur le TRX
          const mg = / SETTING$/.test(lab) ? lab : id === 'aprsB' ? 'APRS BEACON' : '';
          if (mg) return me && me.admin ? openMenu(mg) : say(mg + ' : réservé aux administrateurs (ON6DP, ON4LUC) — paramètres essentiels du TRX.', 'warn', 6000);
          if (!adj) return say(FTX_NOTE[id] || lab + ' : pas disponible à distance (au club, sur le TRX).', '', FTX_NOTE[id] ? 7000 : 3500);
          const wasEdit = L.funcSel === id && L.fEdit;
          L.funcSel = id;
          if (flip) { L.fEdit = false; funcAdjust(id, 1); return render(); }
          if (wasEdit) {
            /* − / + : réglés au pointerdown (et répétés tant qu'on tient le bouton de la souris) */
          } else { L.fEdit = true; say(lab + ' : cliquez sur − ou +, tournez la molette sur la case ou le bouton FUNC.', '', 4000); }
          render();
        });
        // − / + de la case en réglage : tenir le bouton de la souris = la valeur continue de changer
        hit.addEventListener('pointerdown', (ev) => {
          if (!adj || flip || kind || !(L.funcSel === id && L.fEdit) || modeInactive(id, S())) return;
          const px = toImg(ev).x - x, d = px < cw * 0.38 ? -1 : px > cw * 0.62 ? 1 : 0;
          if (!d) return;
          ev.preventDefault();
          holdRepeat(() => { funcAdjust(id, d); render(); });
        });
        let wacc = 0;
        hit.addEventListener('wheel', (ev) => {
          ev.preventDefault();
          if (!adj || flip || modeInactive(id, S())) return;
          L.funcSel = id; L.fEdit = true;
          const d = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
          let n;
          if (Math.abs(d) >= 50) { wacc = 0; n = Math.sign(d); } else { wacc += d; n = Math.trunc(wacc / 100); if (!n) return; wacc -= n * 100; }
          funcAdjust(id, -n);
          showTip(ev, lab + ' ' + FUNC_BY[id][2](S()));
        }, { passive: false });
        LCD.funcCells[id] = { box, t1, t2, two, minus, plus };
      }));
    });
  }
  function drawFuncFtx1(s) {
    LCD.func.style.display = L.func ? '' : 'none';
    if (!L.func) { L.fEdit = false; return; }
    LCD.funcPages.forEach((p, i) => { p.style.display = i === L.funcPage ? '' : 'none'; });
    for (const id of ftxIds(L.funcPage)) {
      const c = LCD.funcCells[id], def = FUNC_BY[id];
      const ina = modeInactive(id, s), sel = L.funcSel === id, ed = sel && L.fEdit && !ina;
      c.box.classList.toggle('sel', sel);
      c.box.classList.toggle('edit', ed);
      c.box.classList.toggle('inact', ina);
      c.t1.classList.toggle('dim', ina);
      c.t2.classList.toggle('dim', ina);
      if (!c.two) c.t2.textContent = def[2](s);
      if (c.minus) { c.minus.style.display = ed ? '' : 'none'; c.plus.style.display = ed ? '' : 'none'; }
    }
  }
  function power(d) {
    const s = S();
    if (!needControl()) return;
    const w = Math.max(5, Math.min((me && me.maxWatts) || 100, (s.power || 0) + d));
    send({ t: 'set', power: w });
  }
  function askFreq(side) {
    if (!needControl()) return;
    const s = S();
    const cur = side === 'B' ? s.freqB : s.freq;
    const v = prompt('Fréquence du VFO ' + side + ' en MHz (ex. 14.074) :', cur ? (cur / 1e6).toFixed(4) : '');
    if (v == null) return;
    const mhz = Number(String(v).replace(',', '.').trim());
    if (!(mhz > 0)) return say('Fréquence invalide.', 'warn');
    tuneTo(side, mhz * 1e6);
  }
  // R.FIL : 12 kHz, 3 kHz, 600 Hz (de série) ; 1,2 kHz et 300 Hz sont en option sur le FTDX101 (le TRX refuse « RF0x » sans elles)
  const ROOF_STD = (FACE && FACE.roof && FACE.roof.std) || [1, 2, 4];
  function roofNext(cur, d) {
    const i = ROOF_STD.indexOf(cur);
    const base = i >= 0 ? i : ROOF_STD.findIndex((x) => x > (cur || 0)) - (d > 0 ? 1 : 0);
    return ROOF_STD[((base + (d > 0 ? 1 : -1)) % ROOF_STD.length + ROOF_STD.length) % ROOF_STD.length];
  }
  function cycleCell(id) {
    const c = R.CONTROL[id];
    if (!c) return say('Réglage non disponible.', 'warn');
    const s = S();
    if (id === 'roof' || id === 'roofB') return setCtl(id, roofNext(s[id], 1));
    if (c.type === 'select') {
      const i = c.options.findIndex((o) => o[0] === s[id]);
      return setCtl(id, c.options[(i + 1) % c.options.length][0]);
    }
    if (c.type === 'toggle') return setCtl(id, s[id] ? 0 : 1);
  }

  // ------------------------------------------------------------ touches : clic, appui long
  // XFC (IC-7300) : en SPLIT, les deux VFO échangés tant qu'on tient la touche (écoute de la fréquence d'émission), remis au relâchement ;
  // hors SPLIT : rien, comme sur le TRX
  function xfc(down) {
    if (down) {
      if (L.xfcOn || !S().split || !R.CONTROL.xfc) return;
      if (!needControl()) return;
      if (S().tx) return say('XFC : pas pendant une émission.', 'warn', 2500);
      // Affichage tout de suite inversé, sans attendre la relecture du TRX (voir xfcF)
      L.xfcSnap = { a: S().freq, b: S().freqB, at: Date.now(), back: false };
      L.xfcOn = true; setCtl('xfc', null); render();
    } else if (L.xfcOn) { L.xfcOn = false; if (L.xfcSnap) { L.xfcSnap.back = true; L.xfcSnap.at = Date.now(); } setCtl('xfc', null); render(); }
  }
  // AUTO TUNE (IC-7300, CW) : pas de commande CI-V ; la page cherche le signal CW le plus fort à ± 400 Hz de la tonalité (pitch) dans la BF
  // reçue et décale le VFO (ou le RIT en service) pour qu'il tombe sur la tonalité ; « AUTOTUNE » s'affiche au-dessus de la fréquence
  function autoTune() {
    const s = S(), md = L.activeMode(s);
    if (!/^CW/.test(md)) return say('AUTO TUNE : en CW seulement.', '', 3000);
    if (!needControl()) return;
    const sp = WF.lastSp;
    if (!sp || Date.now() - WF.at > 2000) return say('AUTO TUNE : il faut écouter le TRX (la BF reçue sert à trouver le signal).', 'warn', 4500);
    const pitch = s.cwPitch || 600, binHz = (WF.rate / 2) / (WF.lastN / 2);
    let best = 0, bf = 0;
    for (let j = Math.floor((pitch - 400) / binHz); j <= Math.ceil((pitch + 400) / binHz); j++) if (j > 0 && j < sp.length && sp[j] > best) { best = sp[j]; bf = j * binHz; }
    if (best < 0.62) { beep(); return say('AUTO TUNE : pas de signal CW assez fort près de la tonalité.', 'warn', 3500); }
    const off = Math.round((bf - pitch) / 10) * 10, rev = /^CW-?R/.test(md) ? -1 : 1; // CW : BFO côté bas, signal plus aigu = plus haut en fréquence
    L.atAt = Date.now(); render(); setTimeout(render, 1600);
    if (Math.abs(off) < 10) return;
    if (s.rit && R.CONTROL.clar) return setCtl('clar', Math.max(-9990, Math.min(9990, (s.clar || 0) + rev * off)));
    const side = activeSide(), f = side === 'B' ? s.freqB : s.freq;
    if (f) tuneTo(side, f + rev * off);
  }
  function beep() { try { const ac = new AudioContext(), o2 = ac.createOscillator(), g2 = ac.createGain(); o2.frequency.value = 1000; g2.gain.value = 0.08; o2.connect(g2).connect(ac.destination); o2.start(); o2.stop(ac.currentTime + 0.15); o2.onended = () => ac.close(); } catch (e) { /* */ } }
  function keyEvents(e, k) {
    let t = 0, long = false;
    e.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      long = false;
      clearTimeout(t);
      if (k.act && k.act.clar) t = setTimeout(() => { long = true; doAct(k, true); }, 700);
      if (k.act && k.act.longMenu) t = setTimeout(() => { long = true; openModeMenu(); }, 900);
      if (k.act && k.act.long) t = setTimeout(() => { long = true; doAct({ act: k.act.long }, true); }, 900);
      if (k.act && k.act.hold === 'xfc') xfc(true);
      e.classList.add('down');
    });
    const up = () => { clearTimeout(t); e.classList.remove('down'); if (k.act && k.act.hold === 'xfc') xfc(false); };
    e.addEventListener('pointerup', up);
    e.addEventListener('pointerleave', up);
    e.addEventListener('click', (ev) => { ev.preventDefault(); if (!long) doAct(k, false); });
  }

  // ------------------------------------------------------------ boutons rotatifs : molette, glisser
  function knobPart(k, p) {
    if (!k.ri) return k.inner ? 'inner' : 'outer';
    const d = Math.hypot(p.x - k.cx - (k.ix || 0), p.y - k.cy - (k.iy || 0));
    return d <= k.ri + (k.ri > 25 ? 0 : 3) ? 'inner' : 'outer'; // grands boutons du centre : bague extérieure étroite, pas de marge
  }
  function turn(k, part, notches, ev) {
    if (!notches) return;
    const s = S();
    // IC-7300, SCOPE → REF ouvert : le grand bouton règle le REF Level du scope, comme sur le TRX
    if (ICOM && k.dial && L.iscRef && L.icView === 'scope') return refTurn(notches);
    // VOICE → TX LEVEL ouvert : le grand bouton règle le niveau d'émission des mémoires vocales
    if (ICOM && k.dial && L.ivLvl && L.icView === 'voice') return vlvlTurn(notches);
    // Cadre NB LEVEL / DNR LEVEL ouvert (appui long sur NB / DNR) : le bouton MULTI règle ce niveau, comme sur le TRX
    if (k.multi && popTarget && popTarget.ctl && $('lcdPop') && !$('lcdPop').hidden) return popAdjust(notches > 0 ? 1 : -1, ev);
    // Clarifier en service (CLAR RX / TX) : la bague extérieure du grand bouton règle le décalage (10 Hz par cran), comme sur le TRX
    if (k.dial && part === 'outer' && (s.rit || s.xit) && !(s.mpvd === 2)) {
      const v = Math.max(-9999, Math.min(9999, (s.clar || 0) + notches * 10));
      setCtl('clar', v);
      return showTip(ev, 'CLAR ' + (s.rit && s.xit ? 'TRX' : s.rit ? 'RX' : 'TX') + ' ' + (v > 0 ? '+' : '') + v + ' Hz');
    }
    // Grande touche VC TUNE : la bague extérieure du grand bouton accorde le présélecteur (un pas par cran)
    const vcSide = activeSide() === 'B' ? 'B' : '';
    if (k.dial && part === 'outer' && (s.mpvd != null ? s.mpvd === 2 : L.ringVc) && R.CONTROL['vcUp' + vcSide]) {
      if (!needControl()) return;
      if (!s['vc' + vcSide]) return say('VC TUNE arrêté : mettez-le en marche avec la petite touche VC TUNE.', 'warn', 4000);
      const n = Math.max(-9, Math.min(9, notches));
      for (let i = 0; i < Math.abs(n); i++) send({ t: 'set', ctl: (n > 0 ? 'vcUp' : 'vcDn') + vcSide, value: null });
      // Position affichée en continu pendant qu'on tourne (prévue d'après le pas observé), puis celle relue sur le TRX
      const now = Date.now(), key = vcSide || 'A';
      let v = VCP[key];
      if (!v || now > v.until) {
        if (v) vcLearn(v, s['vcPos' + vcSide]);
        v = VCP[key] = { base: s['vcPos' + vcSide], sent: 0, until: 0 };
      }
      v.sent += n;
      v.until = now + 1500;
      const pos = vcShown(vcSide, s);
      render();
      return showTip(ev, 'VC TUNE ' + (vcSide ? 'SUB' : 'MAIN') + ' ' + (pos != null ? pos : (n > 0 ? '+' : '−')));
    }
    // FTX-1 : écran DSP ouvert (appui d'1 s sur AF/RF/SQL) — ce bouton règle la case choisie (SHIFT, WIDTH, NOTCH, CONTOUR / APF)
    if (L.dsp && k.dspSide === L.dsp) { dspAdjust(notches); return; }
    if (k.multi && FTX1F && L.func) {
      const c = FUNC_BY[L.funcSel];
      if (L.fEdit && c && c[3] && !c[5]) { funcAdjust(L.funcSel, notches); return showTip(ev, c[1] + ' ' + c[2](S())); }
      return showTip(ev, ftxCursor(notches > 0 ? 1 : -1));
    }
    if (k.multi && MV.open && MV.sel) { menuAdjust(MV.sel, notches > 0 ? 1 : -1); return; }
    // Écran de menu ou DTMF ouvert sans réglage choisi : FUNC fait défiler la liste, sans toucher aux réglages de l'écran FUNC
    if (k.multi && FTX1F && (MV.open || DT.open)) { if (MV.open) menuScroll(notches > 0 ? 1 : -1); return; }
    if (k.multi && (!(s.rit || s.xit) || FACE.clarCycle) && FUNC_BY[L.funcSel] && FUNC_BY[L.funcSel][3] && !(FTX1F && FUNC_BY[L.funcSel][5])) {
      funcAdjust(L.funcSel, notches);
      // FTX-1 : grand cadre « RF POWER   83W » au milieu de l'écran pendant qu'on tourne FUNC (écran FUNC fermé)
      if (FTX1F) { render(); funcPop(L.funcSel); clearTimeout(L.fpopT); L.fpopT = setTimeout(() => { if (!$('lcdPop').hidden) funcPop(L.funcSel); }, 1100); return; } // valeur relue sur le TRX
      if (L.funcSel === 'step') { const sd = activeSide(), f = sd === 'B' ? pendF.B : pendF.A; return showTip(ev, 'STEP DIAL ' + (sd === 'B' ? 'SUB ' : 'MAIN ') + (f ? fmtFreq(f) + ' MHz' : '')); }
      return showTip(ev, FUNC_BY[L.funcSel][1] + ' ' + FUNC_BY[L.funcSel][2](S()));
    }
    // SUB DIAL (FTX-1) : fréquence du SUB (VFO B), quel que soit le récepteur sélectionné
    if (k.subDial) {
      const cur = s.freqB;
      if (cur == null) return;
      const step = L.fine ? 1 : L.fast ? 1000 : 100, hz = Math.round((cur + notches * step) / step) * step;
      tuneTo('B', hz);
      return showTip(ev, 'SUB ' + fmtFreq(hz) + ' MHz');
    }
    // FTX-1 : CLAR en service sur le récepteur sélectionné → le grand bouton règle le décalage (10 Hz par cran, 1 Hz en FINE)
    if (k.dial && FACE.clarCycle && part !== 'outer') {
      const B = activeSide() === 'B';
      if (B ? s.ritB || s.xitB : s.rit || s.xit) {
        const id = B ? 'clarB' : 'clar', st = L.fine ? 1 : 10;
        const v = Math.max(-9999, Math.min(9999, Math.round(((s[id] || 0) + notches * st) / st) * st));
        setCtl(id, v);
        return showTip(ev, 'CLAR ' + (v > 0 ? '+' : '') + v + ' Hz');
      }
    }
    if (k.dial || k.multi) {
      if (k.multi && (s.rit || s.xit)) {
        const v = Math.max(-9999, Math.min(9999, (s.clar || 0) + notches * 10));
        setCtl('clar', v);
        return showTip(ev, 'CLAR ' + (v > 0 ? '+' : '') + v + ' Hz');
      }
      // Bague extérieure (bleue) du grand bouton, sans CLAR ni VC TUNE : fréquence de l'AUTRE récepteur que celui qui est
      // sélectionné (SUB sélectionné → VFO-A / MAIN ; MAIN sélectionné → VFO-B / SUB)
      const ringOther = k.dial && part === 'outer';
      const side = ringOther ? (activeSide() === 'B' ? 'A' : 'B') : activeSide();
      const cur = side === 'B' ? s.freqB : s.freq;
      if (cur == null) return;
      const step = k.multi ? (L.fast ? 10000 : 1000) : (L.fine ? 1 : L.fast ? 1000 : 100);
      const hz = Math.round((cur + notches * step) / step) * step;
      tuneTo(side, hz);
      if (L.sync && !k.multi) tuneTo(side === 'B' ? 'A' : 'B', hz); // SYNC : les deux VFO ensemble
      return showTip(ev, (side === 'B' ? 'SUB ' : 'MAIN ') + fmtFreq(hz) + ' MHz');
    }
    let spec = k[part];
    if (!spec) return;
    if (spec.alt && spec.alt.when(s)) spec = spec.alt; // ex. bague CONT/APF : APF en CW quand l'APF est en service
    if (spec.info) return say(spec.info, '', 4000);
    const c = R.CONTROL[spec.ctl];
    if (!c) return say(spec.label + ' : non disponible sur ce TRX.', 'warn');
    let v;
    if (c.type === 'width') {
      const tab = R.widthTable(s[c.modeKey || 'mode']) || [];
      if (!tab.length) return say(spec.label + ' : pas de réglage de largeur dans ce mode.', 'warn');
      // NAR (filtre étroit) en service : le TRX refuse WIDTH (« ? ») → on coupe NAR d'abord
      const nk = spec.ctl === 'widthB' ? 'narrowB' : 'narrow';
      if (s[nk] && R.CONTROL[nk]) { setCtl(nk, 0); say('NAR (filtre étroit) coupé : WIDTH se règle.', '', 3000); }
      if (R.WIDTH_DEF) {
        // Comme le bouton WIDTH du TRX : toutes les largeurs de la liste, une par cran. On n'envoie jamais « 00 » (défaut) :
        // sa valeur dépend du filtre de toit et du mode, le TRX sauterait ailleurs. Départ de « défaut » : 2400 Hz.
        const di = tab.indexOf(widthDefHz(s[c.modeKey || 'mode'] || '')) + 1 || Math.ceil(tab.length / 2);
        const cur = s[spec.ctl] || di;
        v = Math.max(1, Math.min(tab.length, cur + Math.sign(notches) * Math.min(3, Math.abs(notches)) * (spec.per || 1)));
      } else {
        v = Math.max(0, Math.min(tab.length, (s[spec.ctl] || 0) + notches * (spec.per || 1)));
        try { R.validate(spec.ctl, v, s); } catch (e) { v = Math.max(1, v); }
      }
    } else if (c.type === 'level') {
      v = Math.max(c.min, Math.min(c.max, (s[spec.ctl] != null ? s[spec.ctl] : c.min) + notches * (spec.per || c.step)));
    } else return;
    setCtl(spec.ctl, v);
    showTip(ev, spec.label + ' ' + fmtVal(c, v, s) + (spec.offKey && !s[spec.offKey] ? ' (' + spec.offName + ' arrêté)' : ''));
    popTarget = { k, part };
    lcdPop(spec.ctl, c, v, s);
  }
  function knobEvents(g, k) {
    let acc = 0;
    g.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      // Un clic de molette = un cran (Chrome donne 100 ou 120 selon le système) ; pavé tactile : petits pas cumulés
      const d = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaMode === 2 ? ev.deltaY * 100 : ev.deltaY;
      let n;
      if (Math.abs(d) >= 50) { acc = 0; n = Math.sign(d); } else {
        acc += d;
        n = Math.trunc(acc / 100);
        if (!n) return;
        acc -= n * 100;
      }
      turn(k, knobPart(k, toImg(ev)), -n, ev);
    }, { passive: false });
    let drag = null;
    g.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      const p = toImg(ev);
      drag = { part: knobPart(k, p), y: ev.clientY, a: Math.atan2(p.y - k.cy, p.x - k.cx), acc: 0, t0: Date.now(), moved: false };
      // Appui d'au moins 1 s sur le centre sans tourner (ex. SHIFT ◎ WIDTH : retour aux valeurs par défaut)
      if (k.longLocal) { // appui de 2 s (FTX-1 : FUNC = écran FUNC / sortie)
        const d0 = drag;
        d0.lt = setTimeout(() => { if (drag === d0 && !d0.moved && Math.abs(d0.acc) < 0.5) { d0.long = true; doAct({ act: { local: k.longLocal } }, false); } }, k.longMs || 1500);
      }
      if (k.longReset && drag.part === 'inner') {
        const d0 = drag;
        d0.lt = setTimeout(() => { if (drag === d0 && !d0.moved && Math.abs(d0.acc) < 0.5) { d0.long = true; knobReset(k, ev); } }, 1000);
      }
      g.setPointerCapture(ev.pointerId);
      g.classList.add('grab');
    });
    g.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      if (k.dial) {
        // Grand bouton : on le fait tourner (10° = un cran)
        const p = toImg(ev);
        const a = Math.atan2(p.y - k.cy, p.x - k.cx);
        let d = a - drag.a;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        drag.a = a;
        drag.acc += d * 180 / Math.PI / 10;
      } else {
        drag.acc += (drag.y - ev.clientY) / 8; // vers le haut : plus
        drag.y = ev.clientY;
      }
      const n = Math.trunc(drag.acc);
      if (n) { drag.acc -= n; drag.moved = true; turn(k, drag.part, n, ev); }
    });
    const end = (ev) => {
      // Clic sans tourner sur un bouton qui se pousse (ex. WIDTH : NAR)
      if (drag) clearTimeout(drag.lt);
      if (drag && drag.long) return end2();
      // Bouton qu'on pousse pour une fonction de la page (FTDX10 : pousser FUNC = menu FUNC)
      // Bouton qu'on pousse pour une touche du TRX (FTX-1 : pousser SUB DIAL = A ⇄ B)
      if (drag && k.pushAct && ev && ev.type === 'pointerup' && Math.abs(drag.acc) < 0.3 && Date.now() - drag.t0 < 500 && !drag.moved) { end2(); if (k.pushTip) showTip(ev, k.pushTip); return doAct({ act: k.pushAct }, false); }
      if (drag && k.pushLocal && ev && ev.type === 'pointerup' && Math.abs(drag.acc) < 0.3 && Date.now() - drag.t0 < 500 && !drag.moved) { end2(); return doAct({ act: { local: k.pushLocal } }, false); }
      if (drag && k.push && ev && ev.type === 'pointerup' && Math.abs(drag.acc) < 0.3 && Date.now() - drag.t0 < 500 && !drag.moved) {
        const s0 = S();
        const id = typeof k.push === 'function' ? k.push(s0, L) : k.push;
        const lab = typeof k.pushLabel === 'function' ? k.pushLabel(s0, L) : (k.pushLabel || id);
        if (id) { const v = s0[id] ? 0 : 1; if (procRefused(s0, id, v)) return end2(); setCtl(id, v); showTip(ev, lab + (v ? ' ON' : ' OFF')); }
      }
      end2();
    };
    const end2 = () => { drag = null; g.classList.remove('grab'); hideTip(600); };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
    g.addEventListener('pointerleave', () => { g.classList.remove('hov-in', 'hov-out'); delete g.dataset.hp; if (!drag) hideTip(400); });
    if (k.ri) g.addEventListener('pointermove', (ev) => {
      if (drag) return;
      const part = knobPart(k, toImg(ev));
      g.classList.toggle('hov-in', part === 'inner');
      g.classList.toggle('hov-out', part === 'outer');
      const spec = k[part];
      const alt = spec && spec.alt && spec.alt.when(S()) ? spec.alt : spec;
      if (alt && alt.label && g.dataset.hp !== alt.label) { g.dataset.hp = alt.label; showTip(ev, alt.label); hideTip(1500); }
    });
  }
  // SHIFT ◎ WIDTH : appui long sur le centre → SHIFT à 0 et WIDTH à la largeur par défaut du mode (voyants éteints)
  function knobReset(k, ev) {
    if (!needControl()) return;
    const sfx = /B$/.test(k.longReset) ? 'B' : '';
    const s = S();
    if (k.longReset[0] === 'n') {
      // NOTCH ◎ CONT/APF : fréquences par défaut (NOTCH 1500 Hz, CONTOUR 1000 Hz, APF 0 Hz) et fonctions arrêtées (voyants éteints)
      const out = [];
      const set = (id, v, lab) => { if (R.CONTROL[id + sfx]) { setCtl(id + sfx, v); if (lab) out.push(lab); } };
      set('notchFreq', 1500, 'NOTCH 1500 Hz');
      set('contourFreq', 1000, 'CONT 1000 Hz');
      if (/^CW/.test((sfx ? s.modeB : s.mode) || '')) set('apfFreq', 25, 'APF 0 Hz'); // APF : en CW seulement (sinon le TRX refuse)
      for (const id of ['notch', 'contour', 'apf']) if (s[id + sfx] && R.CONTROL[id + sfx]) setCtl(id + sfx, 0);
      showTip(ev, (sfx ? 'SUB' : 'MAIN') + ' : ' + out.join(' · ') + ' — NOTCH, CONT et APF arrêtés');
      return hideTip(3000);
    }
    const md = (sfx ? s.modeB : s.mode) || '';
    const out = [];
    if (R.CONTROL['shift' + sfx]) { setCtl('shift' + sfx, 0); out.push('SHIFT 0 Hz'); }
    const tab = R.widthTable(md) || [];
    const wi = tab.indexOf(widthDefHz(md)) + 1;
    if (R.CONTROL['width' + sfx] && wi > 0) {
      if (s['narrow' + sfx] && R.CONTROL['narrow' + sfx]) { setCtl('narrow' + sfx, 0); out.push('NAR coupé'); } // sinon le TRX refuse WIDTH
      setCtl('width' + sfx, wi); out.push('WIDTH ' + tab[wi - 1] + ' Hz');
    }
    showTip(ev, (sfx ? 'SUB' : 'MAIN') + ' : ' + (out.join(' · ') || 'rien à remettre'));
    hideTip(2500);
  }
  // Cadre de réglage sur l'écran (comme le TRX) : nom de la fonction et valeur en grands chiffres, 2 s
  const POP_NAMES = { shift: 'SHIFT', width: 'WIDTH', notchFreq: 'NOTCH', contourFreq: 'CONT', apfFreq: 'APF', nbLvl: 'NB LEVEL', nrLvl: 'DNR LEVEL' };
  const POP_NOUNIT = { nbLvl: 1, nrLvl: 1 };
  // Cadre ouvert par une touche (NB, DNR : appui long) : réglage d'un niveau avec − / + ou la molette
  function popCtl(id) {
    const c = R.CONTROL[id];
    if (!c) return say('Réglage non disponible sur ce TRX.', 'warn');
    const s = S();
    popTarget = { ctl: id };
    lcdPop(id, c, s[id] != null ? s[id] : c.min, s);
  }
  function popAdjust(d, ev) {
    if (!popTarget) return;
    if (!popTarget.ctl) return turn(popTarget.k, popTarget.part, d, ev);
    const id = popTarget.ctl, c = R.CONTROL[id], s = S();
    if (!c || !needControl()) return;
    const v = Math.max(c.min, Math.min(c.max, (s[id] != null ? s[id] : c.min) + d * (c.step || 1)));
    setCtl(id, v);
    lcdPop(id, c, v, s);
  }
  let popT = 0, popTarget = null, popHover = false;
  function lcdPop(id, c, v, s) {
    const base = id.replace(/B$/, ''), sub = /B$/.test(id) && POP_NAMES[base];
    const name = POP_NAMES[id] || (sub ? POP_NAMES[base] : null);
    const pop = $('lcdPop');
    if (!name || !pop) return;
    let num;
    if (c.type === 'width') { const tab = R.widthTable(s[c.modeKey || 'mode']) || []; num = v ? tab[v - 1] : widthDefHz(s[c.modeKey || 'mode'] || ''); }
    else if (base === 'apfFreq') num = (v - 25) * 10;
    else num = v;
    if (num == null) return;
    const txt = (num < 0 ? '-' : '') + Math.abs(num);
    pop.querySelector('.fc-lp-l').textContent = (sub ? 'SUB ' : '') + name;
    const svgEl = pop.querySelector('svg');
    const unit = POP_NOUNIT[base] ? '' : 'Hz', uw = unit ? 46 : 4;
    const h = 30, w = (txt.length + 0.2) * h * 0.76 + uw;
    svgEl.setAttribute('viewBox', '0 0 ' + w.toFixed(0) + ' ' + (h + 4));
    pop.querySelector('path').setAttribute('d', seg7(txt, w - uw, 2, h));
    const t = pop.querySelector('text');
    t.setAttribute('x', w - 44); t.setAttribute('y', h + 1); t.textContent = unit;
    pop.hidden = false;
    clearTimeout(popT);
    if (!popHover) popT = setTimeout(() => { pop.hidden = true; }, popTarget && popTarget.ctl ? 5000 : 2500);
  }
  // Bouton − / + tenu enfoncé : la valeur continue de changer (un pas tout de suite, puis 9 par seconde après 0,4 s)
  function holdRepeat(fn) {
    fn();
    let iv = 0;
    const t0 = setTimeout(() => { iv = setInterval(fn, 110); }, 400);
    const stop = () => { clearTimeout(t0); clearInterval(iv); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); window.removeEventListener('blur', stop); };
    window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop); window.addEventListener('blur', stop);
  }
  // ---- FTX-1 : écran DSP du récepteur (appui d'1 s sur MAIN ou SUB AF/RF/SQL), comme sur le TRX :
  // grand filtre avec l'échelle −2 … +2 kHz, nom et valeur en grand, onglets SHIFT · WIDTH · NOTCH · CONTOUR (APF en CW).
  // Tourner le bouton (ou la molette sur l'écran, − / +) règle l'onglet choisi ; pousser le bouton : onglet suivant ; appui d'1 s : fermé
  L.dsp = null; L.dspTab = 0;
  const dspTabs = (sd) => ['SHIFT', 'WIDTH', 'NOTCH', /^CW/.test((sd === 'B' ? S().modeB : S().mode) || '') ? 'APF' : 'CONTOUR'];
  const dspK = (sd, id) => id + (sd === 'B' ? 'B' : '');
  function dspWidthHz(s, sd) {
    const md = (sd === 'B' ? s.modeB : s.mode) || '', v = s[dspK(sd, 'width')];
    const tab = (R.widthTable && R.widthTable(md)) || [];
    return v ? tab[v - 1] : widthDefHz(md);
  }
  function dspVal(s, sd, t) {
    if (t === 'SHIFT') { const v = s[dspK(sd, 'shift')] || 0; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + 'Hz'; }
    if (t === 'WIDTH') { const w = dspWidthHz(s, sd); return w != null ? w + 'Hz' : '—'; }
    if (t === 'NOTCH') return s[dspK(sd, 'notch')] ? (s[dspK(sd, 'notchFreq')] || 0) + 'Hz' : 'OFF';
    if (t === 'CONTOUR') return s[dspK(sd, 'contour')] ? (s[dspK(sd, 'contourFreq')] != null ? s[dspK(sd, 'contourFreq')] + 'Hz' : 'ON') : 'OFF';
    if (!s[dspK(sd, 'apf')]) return 'OFF';
    const a = s[dspK(sd, 'apfFreq')]; return a != null ? ((a - 25) * 10 > 0 ? '+' : (a - 25) * 10 < 0 ? '−' : '') + Math.abs((a - 25) * 10) + 'Hz' : 'ON';
  }
  // Fonction de l'onglet en service (nom et valeur en orange, comme sur le TRX)
  function dspOn(s, sd, t) {
    if (t === 'SHIFT') return !!s[dspK(sd, 'shift')];
    if (t === 'WIDTH') { const md = (sd === 'B' ? s.modeB : s.mode) || ''; return dspWidthHz(s, sd) !== widthDefHz(md); }
    return !!s[dspK(sd, t === 'NOTCH' ? 'notch' : t === 'APF' ? 'apf' : 'contour')];
  }
  // ---- FTX-1 : présentations DISP 1 et 2 du TRX : les vrais groupes (galvanomètre, fréquence avec ses étiquettes, filtre)
  // de chaque VFO sont déplacés (applyMono → ftxLayout), plus une rangée ATT / IPO / DNF / AGC par VFO
  function ftxCellsTxt(s, sd) {
    const b = sd === 'B' ? 'B' : '', att = s['att' + b], pre = s['preamp' + b], dnf = s['dnf' + b], agc = s['agc' + b];
    return [att == null ? '—' : att ? 'ON' : 'OFF', pre == null ? '—' : IPO[pre] || String(pre), dnf == null ? '—' : dnf ? 'ON' : 'OFF', agc == null ? '—' : AGC[agc] || String(agc)];
  }
  function ftxCellClick(sd, i) {
    if (!needControl()) return;
    const s = S(), b = sd === 'B' ? 'B' : '', id = ['att', 'preamp', 'dnf', 'agc'][i] + b;
    if (!R.CONTROL[id]) return say('Pas disponible à distance pour ce VFO.', 'warn', 3000);
    // ATT / IPO : le CAT du FTX-1 (RA0 / PA0) n'agit que sur le côté actif ; pour l'autre côté il faudrait passer dessus
    // par CAT (VS), ce qui est bloqué en réception simple (le 25/10, VS1 a mis le FTX-1 en émission)
    const act = activeSide();
    if ((i === 0 || i === 1) && sd === 'B')
      return say((i ? 'IPO' : 'ATT') + ' du SUB : pas réglable à distance — par CAT, le FTX-1 change celui du MAIN. Réglez-le sur la face avant du TRX ; la valeur s’affiche quand le SUB est le côté actif.', 'warn', 8000);
    if ((i === 0 || i === 1) && sd !== act && s.dualRx !== 1 && !(me && me.subSingle))
      return say('ATT / IPO du ' + (sd === 'B' ? 'SUB' : 'MAIN') + ' : le FTX-1 ne les lit et ne les règle par CAT que sur le côté actif. Passer sur l’autre côté par CAT est bloqué en réception simple (le 25/10, cela a mis le TRX en émission). Un administrateur peut l’autoriser (réglage ftx1SubSingle) après un essai sur charge fictive.', 'warn', 9000);
    const v = s[id] || 0;
    if (i === 0 || i === 2) setCtl(id, v ? 0 : 1);
    else if (i === 1) setCtl(id, (v + 1) % 3);
    else setCtl(id, v >= 4 ? 1 : v + 1);
    render();
  }
  // Blocs des présentations : [côté, haut, hauteur]
  function ftxBlocks(fd) {
    const c = FACE.lcd, top = c.y + 15, lowTop = c.y + G.lowY - 2, bot = c.y + G.botY - 2, hh = (bot - top) / 2;
    return fd === 1 ? [[activeSide(), top, lowTop - top]] : fd === 2 ? [['A', top, hh - 2], ['B', top + hh + 2, hh - 2]] : [];
  }
  function ftxCellRow(g, y0, h) {
    const c = FACE.lcd, cy = y0 + h - 31, cw = 279 / 4, row = { g: el('g', {}, g), cells: [] };
    el('rect', { x: c.x + 5, y: cy, width: 279, height: 28, rx: 1.5, class: 'fd-cbar' }, row.g);
    ['ATT', 'IPO', 'DNF', 'AGC'].forEach((lab, i) => {
      const x = c.x + 5 + i * cw;
      if (i) el('line', { x1: x, y1: cy + 2, x2: x, y2: cy + 26, class: 'fd-csep' }, row.g);
      el('text', { x: x + cw / 2, y: cy + 11, class: 'fd-clab', 'text-anchor': 'middle' }, row.g, lab);
      row.cells.push(el('text', { x: x + cw / 2, y: cy + 24, class: 'fd-cval', 'text-anchor': 'middle' }, row.g, '—'));
      const hit = el('rect', { x, y: cy, width: cw, height: 28, class: 'hs lcd-hit' }, row.g);
      el('title', {}, hit, lab + ' : clic pour changer');
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); ftxCellClick(row.side, i); });
    });
    return row;
  }
  // Appelé par applyMono (nouvelle présentation ou autre VFO sélectionné)
  function ftxLayout(fd) {
    const c = FACE.lcd, md = FACE.meterDy || 0, bl = ftxBlocks(fd);
    LCD.lowG.style.display = fd === 2 ? 'none' : '';
    LCD.scopeRect.style.display = fd === 2 ? 'none' : '';
    for (const sd of ['A', 'B']) {
      const b = bl.find((x) => x[0] === sd), show = !!b;
      LCD['m' + sd].g.style.display = show ? '' : 'none';
      LCD['v' + sd].g.style.display = show ? '' : 'none';
      if (!show) continue;
      const [, y0, h] = b, d = rightSide(sd) ? 284 : 0, v = LCD['v' + sd], f = LCD['f' + sd], k = 1.22;
      // Galvanomètre (cadre x0, Y(4) + 10 dans le groupe décalé de meterDy) : en haut à gauche du bloc
      LCD['m' + sd].g.setAttribute('transform', 'translate(' + (c.x + 4 - (c.x + 5 + d)) + ',' + (y0 + 1 - (c.y + 14) - md) + ')');
      // Fréquence et étiquettes : agrandies, calées en haut à droite
      v.g.setAttribute('transform', 'translate(' + (c.x + c.w - 6 - v.xr * k).toFixed(1) + ',' + (y0 + 3 - (c.y + 87) * k).toFixed(1) + ') scale(' + k + ')');
      // Filtre : sur la moitié droite, sous la fréquence
      const tx = c.x + 288, ty = y0 + h - 44, tw = c.w - 293, th = 40;
      f.g.setAttribute('transform', 'translate(' + tx + ',' + (ty - md) + ') scale(' + (tw / f.w).toFixed(4) + ',' + (th / f.h).toFixed(4) + ') translate(' + -f.x0 + ',' + -f.y0 + ')');
    }
  }
  function ftxDispDraw(s) {
    const fd = L.fdisp || 0;
    if (!LCD.fd && (fd === 1 || fd === 2)) {
      const D = LCD.fd = { g: el('g', { class: 'fd' }, LCD.g) }, c = FACE.lcd;
      const [one] = ftxBlocks(1), two = ftxBlocks(2);
      D.r1 = ftxCellRow(D.g, one[1], one[2]);
      D.rA = ftxCellRow(D.g, two[0][1], two[0][2]);
      D.rB = ftxCellRow(D.g, two[1][1], two[1][2]);
      D.sep = el('line', { x1: c.x + 5, y1: (two[0][1] + two[0][2] + two[1][1]) / 2, x2: c.x + c.w - 5, y2: (two[0][1] + two[0][2] + two[1][1]) / 2, class: 'fd-sep' }, D.g);
    }
    const D = LCD.fd;
    if (!D) return;
    // Sous l'écran FUNC, l'écran DSP et les tableaux (MODE, BAND, MULTI…) : les rangées ATT / IPO / DNF / AGC disparaissent
    const over = !!(L.func || L.dsp || L.modeMenu || L.bandMenu || L.multiMenu || L.icomMenu || L.quickMenu || L.mSel || (typeof MV !== 'undefined' && MV.open) || (typeof DT !== 'undefined' && DT.open));
    D.g.style.display = over ? 'none' : '';
    D.r1.g.style.display = fd === 1 ? '' : 'none';
    D.rA.g.style.display = D.rB.g.style.display = D.sep.style.display = fd === 2 ? '' : 'none';
    const fill = (row, sd) => { row.side = sd; const t = ftxCellsTxt(s, sd); row.cells.forEach((e, i) => { if (e.textContent !== t[i]) e.textContent = t[i]; }); };
    if (fd === 1) fill(D.r1, activeSide());
    if (fd === 2) { fill(D.rA, 'A'); fill(D.rB, 'B'); }
  }
  // ---- FTX-1 : METER (toucher l'S-mètre, comme sur le TRX) : PO, COMP, ALC, VDD, ID, SWR (TEMP : pas de commande CAT)
  const METER_NAMES = ['PO', 'COMP', 'ALC', 'VDD', 'ID', 'SWR'];
  function meterSel(s, side) { const v = side === 'B' ? s.meterSwB : s.meterSw; return v >= 0 && v <= 5 ? v : 5; }
  function meterOpen(side) {
    viewTouched();
    L.mSel = L.mSel === side ? null : side;
    render();
  }
  function meterPick(i) {
    const sd = L.mSel;
    if (!sd) return;
    if (i === 6) return say('TEMP : pas de commande CAT pour cette mesure sur le FTX-1 (seulement au club).', 'warn', 4000);
    if (!needControl()) return;
    const k = sd === 'B' ? 'meterSwB' : 'meterSw';
    setCtl(k, i); pend[k] = { v: i, at: Date.now() };
    L.mSel = null;
    say('METER ' + (sd === 'B' ? 'SUB' : 'MAIN') + ' : ' + METER_NAMES[i] + ' (aiguille de l’S-mètre en émission)', '', 3000);
    render();
  }
  function meterDraw(s) {
    let box = $('fcMeter');
    if (!L.mSel) { if (box) box.hidden = true; return; }
    const sc = FACE.lcd;
    if (!box) {
      box = document.createElement('div');
      box.id = 'fcMeter'; box.className = 'fc-msel';
      box.innerHTML = '<div class="fc-msel-h">METER</div><div class="fc-msel-g">' +
        METER_NAMES.concat(['TEMP']).map((n, i) => '<button type="button" data-mi="' + i + '"' + (i === 6 ? ' class="na" title="TEMP : pas de commande CAT (seulement au club)"' : '') + '>' + n + '</button>').join('') + '</div>';
      $('facePanel').appendChild(box);
      box.addEventListener('click', (e) => { const b = e.target.closest('[data-mi]'); if (b) { e.stopPropagation(); meterPick(+b.dataset.mi); } });
    }
    // Ordre du TRX : PO COMP ALC VDD / ID SWR TEMP
    box.style.left = ((sc.x + 95 - V.x) / V.w * 100) + '%';
    box.style.top = ((sc.y + 132 - V.y) / V.h * 100) + '%';
    box.style.width = (380 / V.w * 100) + '%';
    box.style.fontSize = Math.max(8, Math.round($('facePanel').clientWidth / V.w * 12)) + 'px';
    const cur = meterSel(s, L.mSel);
    box.querySelectorAll('[data-mi]').forEach((b) => b.classList.toggle('on', +b.dataset.mi === cur));
    box.hidden = false;
  }
  function dspToggle(sd) {
    viewTouched();
    L.dsp = L.dsp === sd ? null : sd; L.dspTab = 0;
    if (L.dsp) { L.func = false; L.fEdit = false; } // l'écran DSP remplace l'écran FUNC (l'un ou l'autre, comme sur le TRX)
    if (L.dsp) say((sd === 'B' ? 'SUB' : 'MAIN') + ' DSP : tournez le bouton AF/RF/SQL (ou la molette) pour régler, poussez-le pour l’onglet suivant ; appui d’1 s : fermé.', '', 5000);
    render();
  }
  function dspTab(d) { if (!L.dsp) return; L.dspTab = (L.dspTab + d + 4) % 4; render(); }
  L.dspT = {};
  function dspAdjust(n) {
    const sd = L.dsp; if (!sd || !needControl()) return;
    const s = S(), t = dspTabs(sd)[L.dspTab];
    const later = (k, v) => { pend[k] = { v, at: Date.now() }; throttleSet(k, v, (x) => setCtl(k, x)); render(); };
    if (t === 'SHIFT') { const k = dspK(sd, 'shift'), c = R.CONTROL[k]; if (c) later(k, Math.max(c.min, Math.min(c.max, (s[k] || 0) + n * (c.step || 20)))); }
    else if (t === 'WIDTH') {
      const k = dspK(sd, 'width'), md = (sd === 'B' ? s.modeB : s.mode) || '', tab = (R.widthTable && R.widthTable(md)) || [];
      if (!R.CONTROL[k] || !tab.length) return;
      const cur = s[k] || Math.max(1, tab.indexOf(widthDefHz(md)) + 1);
      later(k, Math.max(1, Math.min(tab.length, cur + n)));
    } else if (t === 'NOTCH') {
      const kn = dspK(sd, 'notch'), kf = dspK(sd, 'notchFreq'), c = R.CONTROL[kf];
      if (!s[kn]) { if (n > 0 && R.CONTROL[kn]) setCtl(kn, 1); return render(); }
      if (c) { const v = (s[kf] || 1000) + n * (c.step || 10); if (v < c.min) { setCtl(kn, 0); return render(); } later(kf, Math.min(c.max, v)); }
    } else {
      // CONTOUR / APF : comme NOTCH — en marche au premier cran, puis la fréquence (sous le minimum : arrêt)
      const ko = dspK(sd, t === 'APF' ? 'apf' : 'contour'), kf = dspK(sd, t === 'APF' ? 'apfFreq' : 'contourFreq'), c = R.CONTROL[kf];
      if (!s[ko]) { if (n > 0 && R.CONTROL[ko]) setCtl(ko, 1); return render(); }
      if (!c) { if (n < 0) setCtl(ko, 0); return render(); }
      const v = (s[kf] != null ? s[kf] : t === 'APF' ? 25 : 1000) + n * (c.step || 10);
      if (v < c.min) { setCtl(ko, 0); return render(); }
      later(kf, Math.min(c.max, v));
    }
  }
  function dspDraw(s) {
    let box = $('fcDsp');
    if (!L.dsp) { if (box) box.hidden = true; return; }
    const sd = L.dsp, sc = FACE.lcd, x0 = sc.x + (rightSide(sd) ? 289 : 5);
    if (!box) {
      box = document.createElement('div');
      box.id = 'fcDsp'; box.className = 'fc-dsp';
      box.innerHTML = '<svg class="fc-dsp-f" viewBox="0 0 280 80" preserveAspectRatio="none"><path class="ax" d=""/><path class="tr" d=""/><line class="ctr" x1="140" y1="6" x2="140" y2="58"/><path class="nt" d=""/><path class="ct" d=""/><g class="lb"></g></svg>' +
        '<div class="fc-dsp-v"><span class="l"></span><span class="v"></span></div><div class="fc-dsp-t"></div>';
      $('facePanel').appendChild(box);
      const lb = box.querySelector('.lb'); let ax = 'M4 60H276';
      for (let k = -2.5; k <= 2.51; k += 0.5) { const x = 140 + k * 52; ax += 'M' + x + ' 60v' + (Number.isInteger(k) ? 5 : 3); if (Number.isInteger(k)) { const t = document.createElementNS('http://www.w3.org/2000/svg', 'text'); t.setAttribute('x', x); t.setAttribute('y', 75); t.setAttribute('text-anchor', 'middle'); t.textContent = k ? Math.abs(k).toFixed(1) : '0'; lb.appendChild(t); } }
      box.querySelector('.ax').setAttribute('d', ax);
      box.addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-tab]'); if (b) { e.preventDefault(); L.dspTab = +b.dataset.tab; render(); } }); // onglet tout de suite (à l'appui)
      box.addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-pm]'); if (!b) return; e.preventDefault(); const d = +b.dataset.pm; holdRepeat(() => dspAdjust(d)); });
      let wacc = 0;
      box.addEventListener('wheel', (ev) => { ev.preventDefault(); const d = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY; let n; if (Math.abs(d) >= 50) n = Math.sign(d); else { wacc += d; n = Math.trunc(wacc / 100); if (!n) return; wacc -= n * 100; } dspAdjust(-n); }, { passive: false });
    }
    box.style.left = ((x0 - V.x) / V.w * 100) + '%';
    box.style.top = ((sc.y + 69 - V.y) / V.h * 100) + '%'; // sous les fréquences et le mode
    box.style.width = (282 / V.w * 100) + '%';
    box.style.height = ((G.botY - 71) / V.h * 100) + '%';
    box.style.fontSize = Math.max(8, Math.round($('facePanel').clientWidth / V.w * 11)) + 'px';
    const tabs = dspTabs(sd), t = tabs[L.dspTab];
    // Filtre : largeur et décalage (Hz) sur l'échelle −2,5 … +2,5 kHz
    const w = dspWidthHz(s, sd) || 2400, sh = s[dspK(sd, 'shift')] || 0, k = 52 / 1000;
    const xl = 140 + (sh - w / 2) * k, xh = 140 + (sh + w / 2) * k, sl = Math.min(14, (xh - xl) / 4);
    box.querySelector('.tr').setAttribute('d', 'M4 58H' + Math.max(4, xl - sl).toFixed(1) + 'L' + xl.toFixed(1) + ' 10H' + xh.toFixed(1) + 'L' + Math.min(276, xh + sl).toFixed(1) + ' 58H276');
    // NOTCH : pic vers le bas (V étroit) ; CONTOUR : demi-lune ; en orange dans la bande passante, comme sur le TRX
    const nt = box.querySelector('.nt'), non = !!s[dspK(sd, 'notch')];
    nt.style.display = non ? '' : 'none';
    if (non) { const xn = 140 + ((s[dspK(sd, 'notchFreq')] || 0) - 1500) * k; nt.setAttribute('d', 'M' + (xn - 5).toFixed(1) + ' 10L' + xn.toFixed(1) + ' 56L' + (xn + 5).toFixed(1) + ' 10'); }
    const ct = box.querySelector('.ct'), con = !!s[dspK(sd, 'contour')];
    ct.style.display = con ? '' : 'none';
    if (con) { const xc = 140 + ((s[dspK(sd, 'contourFreq')] != null ? s[dspK(sd, 'contourFreq')] : 1000) - 1500) * k; ct.setAttribute('d', 'M' + (xc - 12).toFixed(1) + ' 10Q' + xc.toFixed(1) + ' 30 ' + (xc + 12).toFixed(1) + ' 10'); } // demi-lune peu profonde
    box.querySelector('.fc-dsp-v').classList.toggle('on', dspOn(s, sd, t));
    // Contenu refait seulement s'il change (sinon un clic sur un onglet ou − / + tombe sur un bouton remplacé entre-temps et se perd)
    const setH = (q, h) => { const e = box.querySelector(q); if (e._h !== h) { e._h = h; e.innerHTML = h; } };
    setH('.fc-dsp-v .l', (sd === 'B' ? '<small>SUB</small>' : '') + t);
    const vv = box.querySelector('.fc-dsp-v .v');
    if (!vv._b) { vv._b = 1; vv.innerHTML = '<button type="button" data-pm="-1">−</button><span class="n"></span><button type="button" data-pm="1">+</button>'; }
    vv.querySelector('.n').textContent = dspVal(s, sd, t);
    setH('.fc-dsp-t', tabs.map((n, i) => '<button type="button" data-tab="' + i + '" class="' + (i === L.dspTab ? 'on' : '') + (dspOn(s, sd, n) ? ' act' : '') + '">' + n + '</button>').join(''));
    box.hidden = false;
  }
  // FTX-1 : cadre « RF POWER   83W » sur le scope quand on tourne FUNC, écran FUNC fermé (nom en orange, valeur en grand)
  function funcPop(id) {
    const f = FUNC_BY[id], pop = $('lcdPop');
    if (!f || !pop) return;
    pop.classList.add('ftx');
    pop.querySelector('.fc-lp-l').textContent = f[1];
    const txt = String(f[2](S()));
    const svgEl = pop.querySelector('svg'), w = Math.max(60, txt.length * 20);
    svgEl.setAttribute('viewBox', '0 0 ' + w + ' 34');
    pop.querySelector('path').setAttribute('d', '');
    const t = pop.querySelector('text');
    t.setAttribute('x', w - 2); t.setAttribute('y', 30); t.setAttribute('text-anchor', 'end'); t.textContent = txt;
    pop.hidden = false;
    popTarget = null;
    clearTimeout(popT);
    popT = setTimeout(() => { pop.hidden = true; pop.classList.remove('ftx'); t.removeAttribute('text-anchor'); }, 2500);
  }
  let tipT = 0;
  function showTip(ev, text) {
    const t = $('tip');
    const box = $('facePanel').getBoundingClientRect();
    t.textContent = text;
    t.hidden = false;
    t.style.left = Math.max(0, Math.min(box.width - 160, ev.clientX - box.left + 14)) + 'px';
    t.style.top = Math.max(0, ev.clientY - box.top - 34) + 'px';
    hideTip(1600);
  }
  function hideTip(ms) { clearTimeout(tipT); tipT = setTimeout(() => { $('tip').hidden = true; }, ms || 0); }

  // ------------------------------------------------------------ affichage
  const fmtFreq = (hz) => (hz / 1e6).toFixed(6).replace(/(\d)(\d{3})$/, '$1.$2').replace(/\.(\d{3})\./, '.$1.');
  function fmtVal(c, v, s) {
    if (v == null) return '—';
    if (c.type === 'width') {
      const tab = R.widthTable(s[c.modeKey || 'mode']) || [];
      const dh = widthDefHz(s[c.modeKey || 'mode'] || '');
      return v === 0 ? 'défaut' + (R.WIDTH_DEF && tab.indexOf(dh) >= 0 ? ' (' + dh + ' Hz)' : '') : tab[v - 1] != null ? tab[v - 1] + ' Hz' : String(v);
    }
    if (c.fmt) return c.fmt(v);
    if (c.pct) return Math.round(v / 255 * 100) + ' %';
    return v + (c.unit ? ' ' + c.unit : '');
  }
  const ROOF_HZ = (FACE && FACE.roof && FACE.roof.hz) || [0, 12000, 3000, 1200, 600, 300]; // R.FIL (filtre de toit) en Hz
  const ATT = ['OFF', '6dB', '12dB', '18dB'], IPO = ['IPO', 'AMP1', 'AMP2'], ROOF = (FACE && FACE.roof && FACE.roof.labels) || ['', '12kHz', '3kHz', '1.2kHz', '600Hz', '300Hz'], AGC = ['OFF', 'FAST', 'MID', 'SLOW', 'AUTO'];
  // IC-7300 : largeur d'origine des filtres FIL1 / FIL2 / FIL3 selon le mode (Hz)
  function filHz(md, n) {
    // Largeur lue sur le TRX (1A 03) pour le filtre en service : 50 Hz … 500 Hz par 50, puis 600 Hz … 3600 Hz par 100 ; AM : 200 Hz … 10 kHz par 200
    const s0 = S();
    if (ICOM && s0.filWi != null && (n || 1) === (s0.fil || 1)) { const i = s0.filWi; return /^AM/.test(md) ? 200 + i * 200 : i <= 9 ? 50 + i * 50 : 600 + (i - 10) * 100; }
    if (/^(USB|LSB)-D/.test(md)) return [3000, 1200, 500][Math.max(0, Math.min(2, (n || 1) - 1))]; // SSB-D : réglages d'origine du TRX
    const t = /^CW/.test(md) ? [1200, 500, 250] : /^RTTY/.test(md) ? [2400, 500, 250] : /^AM/.test(md) ? [9000, 6000, 3000] : /^FM/.test(md) ? [15000, 10000, 7000] : [3000, 2400, 1800];
    return t[Math.max(0, Math.min(2, (n || 1) - 1))];
  }
  function cellText(id, v) {
    if (v == null) return '—';
    if (ICOM) {
      if (id === 'att') return v ? '20dB' : 'OFF';
      if (id === 'preamp') return ['OFF', 'AMP1', 'AMP2'][v] || String(v);
      if (id === 'fil') return 'FIL' + v;
      if (id === 'agc') return ['', 'FAST', 'MID', 'SLOW'][v] || String(v);
    }
    if (/^att/.test(id)) return ATT[v] || String(v);
    if (/^preamp/.test(id)) return IPO[v] || String(v);
    if (/^roof/.test(id)) return ROOF[v] || '—';
    if (/^agc/.test(id)) return AGC[v] || String(v);
    return String(v);
  }
  function sFrac(v) { return v == null ? 0 : Math.max(0, Math.min(1, v / 255)); }
  let raf = 0;
  function render() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
  function draw() {
    drawTop();
    if (!FACE || !st) return;
    try { bmvDraw(); } catch (e) { /* cartes de bande pas encore prêtes */ }
    const s = S();
    // FAST lu sur le TRX (touche FAST de la face du TRX, côté sélectionné) : la page suit
    if (R && R.CONTROL.fastStep && s.fastStep != null) {
      const want = !!s.fastStep;
      if (want !== L.fast) { L.fast = want; if (L.fast) L.fine = false; store.set('rs.face.fast', L.fast ? '1' : '0'); }
    }
    const live = !!s.connected;
    const tx = !!s.tx;
    // Voyants
    for (const d of ledEls) {
      let on = false;
      try { on = live && !!d.on(s, L); } catch (e) { on = false; }
      d.el.classList.toggle('on', on || (d.on === undefined));
      if (d.bright) { let b = false; try { b = live && !!d.bright(s, L); } catch (e) { b = false; } d.el.classList.toggle('bright', b); }
    }
    // Écran
    const subOn = s.dualRx !== 0;
    const maxW = R.POWER_RANGE && R.POWER_RANGE[s.powerHead] ? R.POWER_RANGE[s.powerHead][1] : 100;
    for (const side of ['A', 'B']) {
      const m = LCD['m' + side];
      const sm = side === 'A' ? s.smeter : s.smeterB;
      let f = 0, val = '';
      if (FACE.meterFtx && tx) {
        // FTX-1 : en émission, l'aiguille du MAIN passe sur l'échelle SWR (puissance écrite à côté) ; SUB au repos
        const swr = R.swrValue ? R.swrValue(s.m6) : null, w = s.m5 != null ? s.m5 / 255 * maxW : null;
        const txs = L.txSide(s) === side, ms = meterSel(s, side);
        // Aiguille sur l'échelle choisie par METER (SWR par défaut) ; puissance écrite à côté
        const comp = s.m3 == null ? null : s.m3 <= 130 ? s.m3 / 130 * 15 : 15 + (s.m3 - 130) / 111 * 15;
        const raw = (v) => (v == null ? null : Math.max(0, Math.min(1, v / 255)));
        let fr = null, txt = '';
        if (ms === 0) { fr = w == null ? null : w <= 10 ? 0.05 + w / 10 * 0.22 : w <= 50 ? 0.27 + (w - 10) / 40 * 0.2 : w <= 100 ? 0.47 + (w - 50) / 50 * 0.19 : Math.min(0.9, 0.66 + (w - 100) / 50 * 0.18); }
        else if (ms === 1) { fr = comp != null ? 0.05 + Math.min(1, comp / 20) * 0.88 : null; txt = comp != null ? 'COMP ' + Math.round(comp) + 'dB' : ''; }
        else if (ms === 2) { fr = raw(s.m4) != null ? 0.05 + raw(s.m4) * 0.87 : null; txt = s.m4 != null ? 'ALC ' + Math.round(raw(s.m4) * 100) + '%' : ''; }
        else if (ms === 3) { fr = raw(s.m8) != null ? 0.05 + raw(s.m8) * 0.9 : null; txt = R.vdValue && s.m8 != null ? 'VDD ' + R.vdValue(s.m8).toFixed(1) + 'V' : ''; }
        else if (ms === 4) { fr = raw(s.m7) != null ? 0.05 + raw(s.m7) * 0.88 : null; txt = R.idValue && s.m7 != null ? 'ID ' + R.idValue(s.m7).toFixed(1) + 'A' : ''; }
        else { fr = swr ? Math.min(0.95, swr <= 1.5 ? 0.05 + (swr - 1) / 0.5 * 0.19 : swr <= 2 ? 0.24 + (swr - 1.5) / 0.5 * 0.12 : swr <= 3 ? 0.36 + (swr - 2) * 0.14 : 0.5 + (swr - 3) / 2 * 0.16) : null; txt = swr ? 'SWR ' + swr.toFixed(1) : ''; }
        f = txs ? swrNeedle(m, fr != null ? Math.min(0.97, fr) : 0.05) : 0;
        val = txs ? [txt, w != null ? Math.round(w) + ' W' : ''].filter(Boolean).join('  ') : '';
      } else if (tx && side === 'A') {
        // PO : 0–250 W sur l'échelle du TRX (0,03 … 0,88)
        const w = s.m5 != null ? s.m5 / 255 * maxW : 0;
        f = w <= 10 ? 0.03 + w / 10 * 0.17 : w <= 50 ? 0.2 + (w - 10) / 40 * 0.18 : w <= 100 ? 0.38 + (w - 50) / 50 * 0.14 : Math.min(0.88, 0.52 + (w - 100) / 150 * 0.36);
        val = Math.round(w) + ' W';
        m.title.textContent = 'PO METER';
      } else if (tx && side === 'B') {
        const swr = R.swrValue ? R.swrValue(s.m6) : null;
        f = swr ? Math.min(0.95, swr <= 1.5 ? 0.05 + (swr - 1) / 0.5 * 0.19 : swr <= 2 ? 0.24 + (swr - 1.5) / 0.5 * 0.12 : swr <= 3 ? 0.36 + (swr - 2) * 0.14 : 0.5 + (swr - 3) / 2 * 0.16) : 0.05;
        val = swr ? 'SWR ' + swr.toFixed(1) : '';
        m.title.textContent = 'SWR METER';
      } else {
        const show = live && (side === 'A' || subOn);
        f = show ? S_POS(sm) : 0;
        val = show ? R.smeterLabel(sm) : side === 'B' && !subOn && !FACE.vfoBadges ? 'SUB OFF' : ''; // FTX-1 : pas de « SUB OFF » sur le TRX
        m.title.textContent = side === 'A' ? 'PO METER' : 'ALC METER';
      }
      m.f = m.f == null ? f : m.f + (f - m.f) * 0.6; // aiguille amortie
      const p = arcPt(m.cx, m.cy, 250, m.f);
      m.needle.setAttribute('x2', p[0].toFixed(1));
      m.needle.setAttribute('y2', p[1].toFixed(1));
      m.val.textContent = val;
      m.val.classList.toggle('tx', tx);
      if (m.extra) m.extra.style.display = (tx ? L.txSide(s) === side : activeSide() === side) ? '' : 'none'; // FTX-1 : SWR et VOL sur le VFO actif
      if (m.sec) { const nm = METER_NAMES[meterSel(s, side)]; for (const k in m.sec) m.sec[k].style.display = k === nm ? '' : 'none'; }
      if (m.vol) m.vol.setAttribute('x2', (+m.vol.getAttribute('x1') + Math.max(0, Math.min(1, ((side === 'B' ? s.afB : s.af) || 0) / 255)) * m.volW).toFixed(1));
      // Filtre : largeur et décalage du récepteur
      const fl = LCD['f' + side];
      const sfx = side === 'B' ? 'B' : '';
      const mode = side === 'A' ? s.mode : s.modeB;
      const tab = R.widthTable(mode) || null;
      const wi = s['width' + sfx];
      const nar = !!s['narrow' + sfx];
      // NAR (filtre étroit) : CW / DATA / RTTY / PSK 500 Hz, SSB 1,8 kHz (réglages d'origine du TRX)
      const narHz = nar ? (/^(CW|DATA|RTTY|PSK)/.test(mode || '') ? 500 : /SB$/.test(mode || '') ? 1800 : 0) : 0;
      const ifHz = narHz || (tab && wi ? tab[wi - 1] : tab ? widthDefHz(mode || '') : /AM|FM/.test(mode || '') ? 6000 : 2400);
      const ifSh = s['shift' + sfx] || 0;
      // Bande passante réelle : celle du filtre FI (WIDTH, IF SHIFT) limitée par le filtre de toit (R.FIL, centré)
      const roofHz = ROOF_HZ[s['roof' + sfx]] || 0;
      let lo = ifSh - ifHz / 2, hi = ifSh + ifHz / 2;
      if (ICOM && side === 'A') {
        // IC-7300 : largeur de FIL1 / FIL2 / FIL3 (réglages d'origine du TRX selon le mode), puis TWIN PBT : chaque PBT
        // décale une moitié du filtre (0-255, 128 au milieu) ; la bande passante est ce qui reste entre les deux
        const fw = filHz(mode || '', s.fil), si = ((s.pbtIn != null ? s.pbtIn : 128) - 128) / 128 * fw / 2, so = ((s.pbtOut != null ? s.pbtOut : 128) - 128) / 128 * fw / 2;
        lo = -fw / 2 + Math.max(si, so); hi = fw / 2 + Math.min(si, so);
        if (hi - lo < 50) { const m = (lo + hi) / 2; lo = m - 25; hi = m + 25; }
      }
      if (roofHz) { lo = Math.max(lo, -roofHz / 2); hi = Math.min(hi, roofHz / 2); if (hi - lo < 50) { const m = (lo + hi) / 2; lo = m - 25; hi = m + 25; } }
      const hz = Math.round(hi - lo);
      const sh = Math.round((lo + hi) / 2);
      const fr = Math.max(0.06, Math.min(0.96, hz / FLT_SPAN));
      const cx = fl.x0 + fl.w / 2 + Math.max(-0.4, Math.min(0.4, sh / 2400)) * fl.w;
      const tw = fl.w * fr, top = fl.y0 + 8, bot = fl.y0 + fl.h - 5, sl = Math.min(8, tw * 0.15);
      // NOTCH en service : creux étroit dans la bande passante, à sa fréquence (comme sur l'écran du TRX)
      const nf = notchOf(s, side, mode || '', hz, sh);
      const nx = nf ? cx + nf.rel * fl.w : null;
      // CONTOUR en service : petit « V » bleu peu profond dans le haut du filtre, à sa fréquence ; il suit le bouton CONT
      // (le seul creux profond est celui du NOTCH)
      const cf = contourOf(s, side, mode || '', hz, sh);
      const kx = cf ? Math.max(fl.x0 + 4, Math.min(fl.x0 + fl.w - 4, cx + cf.rel * fl.w)) : null;
      fl.cup.style.display = cf ? '' : 'none';
      if (cf) fl.cup.setAttribute('d', contV(kx, top, 3.5, 7));
      // R.FIL plus étroit que le cadre : ses limites en pointillés (centrées sur le signal, sans IF SHIFT)
      const rw = roofHz ? roofHz / FLT_SPAN * fl.w : 0, rc = fl.x0 + fl.w / 2;
      fl.roof.setAttribute('d', rw && rw < fl.w - 4 ? 'M' + (rc - rw / 2).toFixed(1) + ' ' + (top - 3) + 'V' + bot + 'M' + (rc + rw / 2).toFixed(1) + ' ' + (top - 3) + 'V' + bot : '');
      fl.trap.setAttribute('d', 'M' + trapPts(fl.x0, fl.w, cx, tw, top, bot, sl, [[nx, 3], [kx, 3.5, 7]]).map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L'));
      // NOTCH hors de la bande passante (sur les flancs ou au-delà) : simple trait rouge à sa place (au bord du cadre si plus loin)
      const inPass = nx != null && nx - 3 > cx - tw / 2 + sl && nx + 3 < cx + tw / 2 - sl;
      const nxc = nx == null ? 0 : Math.max(fl.x0 + 2, Math.min(fl.x0 + fl.w - 2, nx));
      fl.nline.setAttribute('x1', nxc); fl.nline.setAttribute('x2', nxc);
      fl.nline.style.display = nx != null && !inPass ? '' : 'none';
      // VC TUNE en service : repère rouge à la position (000-255) sous le filtre
      const vcOn = !!s['vc' + sfx], vcPos = vcShown(sfx, s);
      fl.vc.style.display = vcOn ? '' : 'none';
      if (vcOn && vcPos != null) {
        const tx = fl.vcA + Math.max(0, Math.min(255, vcPos)) / 255 * (fl.vcB - fl.vcA), ty = fl.vcY;
        fl.vcTri.setAttribute('d', 'M' + (tx - 2.6) + ' ' + (ty - 4.5) + 'H' + (tx + 2.6) + 'L' + (tx + 0.8) + ' ' + (ty + 3) + 'H' + (tx - 0.8) + 'Z');
      }
      LCD.flt = LCD.flt || {};
      LCD.flt[side] = { vc: vcOn && vcPos != null ? vcPos : null, fr, off: Math.max(-0.4, Math.min(0.4, sh / 2400)), hz, sh, mode: mode || '', notch: nf, cont: cf };
      fl.cwt.style.display = /^CW/.test(mode || '') ? '' : 'none';
      fl.center.setAttribute('x1', cx); fl.center.setAttribute('x2', cx);
      fl.base.setAttribute('x', cx - tw / 2 + 2); fl.base.setAttribute('width', Math.max(4, tw - 4));
      const v = LCD['v' + side];
      // FTX-1 : CLAR RX en service → la fréquence affichée suit le décalage (comme sur le TRX)
      const fq0 = side === 'A' ? s.freq : s.freqB, cRx = FACE.clarCycle && (side === 'A' ? s.rit : s.ritB);
      const fq = fq0 && cRx ? fq0 + ((side === 'A' ? s.clar : s.clarB) || 0) : fq0;
      v.mode.textContent = mode || '—';
      if (FACE.freqFont) { // FTX-1 : police de l'écran du TRX
        const txt = fq ? fmtFreq(fq) : '';
        if (v.freq.textContent !== txt || !v.fqOk) { // fqOk : largeur déjà mesurée (0 tant que la face est cachée)
          // Comme sur le TRX : les 3 derniers chiffres (Hz) en plus petit (« 144.000.000 » → « 144.000 » + « .000 »)
          v.freq.textContent = '';
          const cut = txt.length > 4 ? txt.length - 4 : txt.length;
          v.freq.appendChild(document.createTextNode(txt.slice(0, cut)));
          if (cut < txt.length) el('tspan', { class: 'fqhz' }, v.freq, txt.slice(cut));
          v.freq.setAttribute('x', v.xr); v.freq.setAttribute('y', LCD.c0y + 121);
          v.freq.removeAttribute('textLength');
          // Trop large (ex. 145.500.000, ou police de remplacement plus large) : on resserre pour ne pas mordre sur les badges
          const maxW = LCD.half - 60;
          let tw = 0;
          try { tw = txt ? v.freq.getComputedTextLength() : 1; } catch (e) { /* pas de mise en page */ }
          v.fqOk = tw > 0;
          if (tw > maxW) { v.freq.setAttribute('textLength', maxW); v.freq.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
        }
      } else v.freq.setAttribute('d', fq ? seg7(fmtFreq(fq), v.xr, LCD.c0y + 95, 26) : '');
      const active = (s.vfoSel === 1) === (side === 'B');
      v.freq.classList.toggle('dim', side === 'B' && !subOn && !FACE.vfoBadges); // FTX-1 : l'autre VFO reste en blanc, comme sur le TRX
      // SPLIT : la fréquence du VFO qui va émettre s'affiche en rouge (comme sur le TRX)
      // FTX-1 : en émission, la fréquence d'émission passe aussi en rouge (comme sur le TRX)
      const txRed = L.txSide(s) === side && (!!s.split || (!!FACE.actOrange && !!s.tx));
      v.freq.classList.toggle('txv', txRed);
      v.sel.classList.toggle('on', active);
      if (FACE.actOrange) v.freq.classList.toggle('act', active && !txRed); // FTX-1 : VFO actif en orange
      const txSide = L.txSide(s);
      v.tx.textContent = txSide === side ? (tx ? 'TX ●' : 'TX') : '';
      // Clarifier de chaque côté (FTDX101 : IF = MAIN, OI = SUB ; autres TRX : celui lu dans IF, côté MAIN)
      const own = s['rit' + side] != null || s['xit' + side] != null;
      const sel = (s.vfoSel === 1 ? 'B' : 'A') === side;
      const cr = own ? s['rit' + side] : side === 'A' ? s.rit : 0, ct = own ? s['xit' + side] : side === 'A' ? s.xit : 0;
      const clarOn = !!(cr || ct);
      v.clarG.style.display = clarOn && !ICOM ? '' : 'none'; // IC-7300 : le décalage s'écrit sous « RIT » dans la case de droite
      if (clarOn) {
        // « CLAR RX -90Hz » : la valeur juste à côté, en gras (CLAR RX, CLAR TX, CLAR TRX comme sur le TRX)
        const cv = (sel ? s.clar : own ? s['clar' + side] : s.clar) || 0;
        v.clarT.textContent = ICOM
          // IC-7300 : « RIT 0.21 », « ΔTX -0.05 », « RIT ΔTX 0.21 » (décalage en kHz), comme sur l'écran du TRX
          ? (cr && ct ? 'RIT ΔTX' : cr ? 'RIT' : 'ΔTX') + '  ' + (cv < 0 ? '-' : '') + (Math.abs(cv) / 1000).toFixed(2)
          : FACE.clarRight ? 'CLAR ' + (cr && ct ? 'RXTX' : cr ? 'RX' : 'TX') // FTX-1 : le décalage tout à droite (clarV)
          : 'CLAR ' + (cr && ct ? 'TRX' : cr ? 'RX' : 'TX') + '  ' + (cv > 0 ? '+' : cv < 0 ? '-' : '') + Math.abs(cv) + 'Hz';
        v.clarV.textContent = FACE.clarRight && !ICOM ? (cv > 0 ? '+' : cv < 0 ? '-' : '') + Math.abs(cv) + 'Hz' : '';
      }
      v.tx.classList.toggle('on', tx && txSide === side);
      if (v.stR) { // FTX-1 : RX (vert), TXRX / TX (rouge) sous [MAIN|SUB][VFO]
        // FTX-1 en SPLIT, comme sur le TRX : VFO d'émission = [TX] seul en haut ; VFO de réception = [MAIN|SUB][RX]
        const spl = !!s.split, isTx = txSide === side, isRx = !spl || !isTx;
        for (const e of [v.nmR, v.nmT]) e.style.display = spl && isTx ? 'none' : '';
        for (const e of [v.vbR, v.vbT]) e.style.display = spl && isTx ? 'none' : '';
        v.vbT.textContent = spl ? 'RX' : 'VFO'; v.vbR.classList.toggle('rx', spl);
        v.stR.setAttribute('y', spl ? v.stY[2] : v.stY[0]); v.stT.setAttribute('y', spl ? v.stY[3] : v.stY[1]);
        const t = spl ? (isTx ? 'TX' : '') : isTx ? 'TXRX' : 'RX';
        v.stT.textContent = t;
        v.stR.style.display = t ? '' : 'none';
        v.stR.setAttribute('width', t.length > 2 ? 30 : 18);
        v.stT.setAttribute('x', +v.stR.getAttribute('x') + (t.length > 2 ? 15 : 9));
        v.stR.classList.toggle('tx', isTx);
        v.stR.classList.toggle('on', isTx && tx);
      }
      for (const c of LCD['c' + side]) c.t.textContent = cellText(c.id, s[c.id]);
    }
    LCD.side.textContent = s.vfoSel === 1 ? 'SUB' : 'MAIN';
    const fl = [];
    if (tx) fl.push('● TX');
    if (s.split) fl.push('SPLIT');
    if (s.rit || s.xit) fl.push((s.rit ? 'RIT' : '') + (s.rit && s.xit ? '/' : '') + (s.xit ? 'XIT' : '') + ' ' + ((s.clar || 0) > 0 ? '+' : '') + ((s.clar || 0) / 1000).toFixed(2) + 'k');
    if (activeSide() === 'B' && R && R.CONTROL.lockB ? s.lockB : s.lock) fl.push('LOCK');
    if (s.proc) fl.push('PROC');
    if (L.fine) fl.push('FINE'); else if (L.fast) fl.push('FAST');
    LCD.flags.textContent = live ? fl.join('  ·  ') : (st.station ? 'TRX muet (éteint ou câble ?)' : 'Station hors ligne');
    LCD.flags.classList.toggle('tx', tx);
    // FTX-1 : bandeau du scope comme sur le TRX — « CENTER  FAST1  SPAN  200kHz » (D-MODE, SPEED, SPAN du TRX)
    // FTX-1 : fonction du bouton FUNC (SF) suivie dans les deux sens : celle choisie au TRX s'affiche ici (ex. D-COLOR),
    // une case choisie ici est donnée au bouton FUNC du TRX
    if (FTX1F && R.CONTROL.funcKnob) {
      if (s.funcKnob != null && s.funcKnob !== L.sfSeen) {
        L.sfSeen = s.funcKnob;
        const id = SF_IDS[s.funcKnob];
        if (id && FUNC_BY[id]) { L.funcSel = id; L.sfLast = id; }
      }
      const code = SF_IDS.indexOf(L.funcSel);
      if (L.sfSeen != null && L.funcSel !== L.sfLast && code > 0 && iControl()) { L.sfLast = L.funcSel; L.sfSeen = code; setCtl('funcKnob', code); }
    }
    if (FACE.meterFtx) LCD.span.textContent = ['CENTER', 'CURSOR', 'FIX\u00a0\u00a0\u00a0\u00a0\u00a0'][s.dMode || 0] + '\u00a0\u00a0' + (L.hold ? 'STOP' : WF_SPEEDS[L.wfSpeed][0]) + '  SPAN  ' + SPAN_TRX[L.trxSpan] + 'Hz';
    else LCD.span.textContent = ['', 'SUB / MAIN · ', 'MAIN | SUB · ', 'FILTRES · '][L.disp] + spanLabel() + (L.hold ? ' · HOLD' : '');
    applyMono();
    ssFollow(s);
    for (const sd of ['A', 'B']) if (LCD['f' + sd]) LCD['f' + sd].g.style.display = L.disp === 3 || (L.mono && sd !== activeSide()) || (L.fdisp === 1 && sd !== activeSide()) || (SINGLE && sd === 'B') || !!LCD.ich || (FACE.meterDy && L.expand) ? 'none' : ''; // FTX-1 : EXPAND couvre les filtres
    drawFunc(s);
    drawStatus(s);
    if (FACE.meterFtx) { ftxDispDraw(s); dspDraw(s); meterDraw(s); }
    for (const b of LCD.bot || []) {
      if (b.t2) b.t2.textContent = FUNC_BY[L.funcSel] ? FUNC_BY[L.funcSel][1] : '';
      if (b.lab === 'HOLD') b.r.classList.toggle('on', !!L.hold);
      if (b.lab === 'SPAN') b.t.textContent = 'SPAN ' + SPAN_TRX[L.trxSpan];
      if (FACE.meterFtx) { // FTX-1 : comme sur le TRX, MULTI / 3DSS en service = nom en bleu
        if (b.lab === 'MULTI') b.t.classList.toggle('blue', !!L.multi);
        if (b.lab === '3DSS') b.t.classList.toggle('blue', !!L.d3);
      } else {
        if (b.lab === 'MULTI' && !b.t2) b.r.classList.toggle('on', !!L.multi);
        if (b.lab === '3DSS') b.r.classList.toggle('on', !!L.d3);
      }
      if (b.lab === 'MONO') b.t.classList.toggle('blue', !!L.mono); // comme le TRX : MONO écrit en bleu
      if (b.lab === 'EXPAND') b.t.classList.toggle('blue', !!L.expand);
      if (b.lab === 'D-MODE' && b.t2) b.t2.textContent = ['CENTER', 'CURSOR', 'FIX'][s.dMode || 0];
      if (b.lab === 'SCOPE' && b.t2) b.t2.textContent = activeSide() === 'B' ? 'SUB' : 'MAIN';
      // DISP « filtres agrandis » : comme sur le TRX, seuls MULTI, HOLD et la case MULTI restent
      b.t.style.opacity = L.disp === 3 && !b.t2 && b.lab !== 'MULTI' && b.lab !== 'HOLD' ? '0' : '';
    }
    if (LCD.bandMenu) {
      LCD.bandMenu.style.display = L.bandMenu ? '' : 'none';
      const cur = L.bandOf(activeSide() === 'B' ? s.freqB : s.freq);
      for (const n in LCD.bandCells) for (const e of LCD.bandCells[n]) e.classList.toggle('on', n === cur);
    }
    // Case de la fonction du bouton MULTI / FUNC ; IC-7300 avec RIT / ΔTX en service : « RIT », « ΔTX », « RIT ΔTX » (MULTI règle le décalage)
    if (LCD.fbox && LCD.ich) {
      // IC-7300 (en-tête Icom) : case du haut à droite remplie par drawIcomHead
    } else if (LCD.fbox) {
      const ic = ICOM && (s.rit || s.xit);
      LCD.fbox.t.textContent = ic ? (s.rit && s.xit ? 'RIT ΔTX' : s.rit ? 'RIT' : 'ΔTX') : FUNC_BY[L.funcSel] ? FUNC_BY[L.funcSel][1] : '';
      LCD.fbox.r.classList.toggle('riton', !!ic);
      // Sous « RIT » : le décalage en kHz (« 0.21 »), comme sur l'écran de l'IC-7300
      const cv = s.clar || 0;
      LCD.fbox.v.textContent = ic ? (cv < 0 ? '-' : '') + (Math.abs(cv) / 1000).toFixed(2) : '';
      LCD.fbox.r.setAttribute('height', ic ? 33 : 23);
      LCD.fbox.t.setAttribute('y', LCD.Y(ic ? 67.5 : 73));
    }
    for (const k of ['icomMenu', 'quickMenu']) if (LCD[k]) { LCD[k].style.display = L[k] ? '' : 'none'; if (L[k]) LCD[k + 'Draw'](); }
    drawMultiMenu(s);
    drawIcMeter(s);
    drawSpoBar(s, live);
    drawIcomHead(s, !!s.tx || !!L.pttOn || !!L.mox); // émission demandée ici (PTT, barre d'espace, MOX) : montrée tout de suite (SPLIT : VFO d'émission en rouge), sans attendre la relecture du TRX
    // Bouton PTT entièrement rouge pendant toute émission (phonie, CW, modes numériques, TUNE, VOICE TX…)
    { const pb = $('ptt'); if (pb) pb.classList.toggle('on-air', !!s.tx); }
    drawIcMem(s);
    if (LCD.icRecG) LCD.icRecG.style.display = L.icRec ? '' : 'none';
    drawIcSet();
    drawIcSetSub();
    drawIcVrec();
    drawIcFunc(s);
    swrNote(s);
    if (LCD.modeMenu) {
      LCD.modeMenu.style.display = L.modeMenu ? '' : 'none';
      const cur = L.activeMode(s);
      for (const n in LCD.modeCells) for (const e of LCD.modeCells[n]) e.classList.toggle('on', n === cur);
    }
    const fresh = Date.now() - WF.at < 3000;
    LCD.hint.style.display = fresh || rfFresh() ? 'none' : '';
    // IC-7300 : le vrai scope se clique (aller sur un signal) ; la cascade du son reçu, non
    $('scope').style.pointerEvents = ICOM && rfFresh() ? 'auto' : '';
    $('scope').style.cursor = ICOM && rfFresh() ? 'crosshair' : '';
    LCD.hint.textContent = !live ? '' : st.audio && !st.audio.active ? 'Cascade : l’audio n’est pas activé sur la page Station' : 'Cascade : en attente du son de la station…';
    $('scope').style.visibility = (fresh || rfFresh()) && !L.func && !L.modeMenu && !L.bandMenu && !L.icomMenu && !L.quickMenu && !L.multiMenu && !(L.icBig && L.icView !== 'scope') && !L.icMem && !L.icRec && !L.icSet && L.fdisp !== 2 ? 'visible' : 'hidden'; // (L.func : écran FUNCTION, Yaesu ou Icom ; FTX-1 DISP 2 : pas de scope)
    if (LCD.icm && L.icMeter && LCD.hint.style.display !== 'none') LCD.hint.setAttribute('y', LCD.Y(G.scopeY + 32)); else if (LCD.hint) LCD.hint.setAttribute('y', LCD.Y(G.scopeY + G.scopeH / 2 - 2));
    icPopCheck(s, live);
    if (ICOM) pbtPopDraw(s, live);
  }
  function lamp(id, cls) { const e = $(id); e.classList.remove('on', 'warn', 'tx'); if (cls) e.classList.add(cls); }
  function drawTop() {
    lamp('lampLink', ws && ws.readyState === 1 && me ? 'on' : null);
    const r = (st && st.radio) || {};
    lamp('lampStation', st && st.station ? 'on' : null);
    lamp('lampTrx', r.connected ? (r.tx ? 'tx' : 'on') : st && st.station ? 'warn' : null);
    $('rigLabel').textContent = (st && st.rigName) || 'TRX';
    const cb = $('ctrlBtn');
    const mine = iControl(), other = otherTab();
    cb.textContent = !st ? 'Prendre la main' : mine ? 'Libérer la main' : other ? 'Prendre la main ici' : !st.controller ? 'Prendre la main' : me && me.admin ? 'Reprendre la main' : 'Main : ' + st.controller;
    cb.disabled = !!(st && st.controller && !mine && !other && !(me && me.admin));
    const state = !st ? 'busy' : mine ? 'mine' : other ? 'here' : !st.controller ? 'free' : me && me.admin ? 'admin' : 'busy';
    if (cb.dataset.state !== state) cb.dataset.state = state;
    const lb = $('listenBtn');
    lb.setAttribute('aria-pressed', String(L.listening));
    lb.textContent = L.listening ? '🔇 Arrêter l’écoute' : '🔊 Écouter le TRX';
    $('stereoBtn').setAttribute('aria-pressed', String(L.stereo));
    $('stereoBtn').hidden = !(R && R.DUAL_AUDIO);
    // Autre TRX en service : cette face avant n'est pas la bonne
    const cover = $('cover');
    const wrong = st && st.rigModel && st.rigModel !== MODEL;
    cover.hidden = !wrong;
    if (wrong) {
      // Boutons : face avant du TRX en service (s'il en a une) ; administrateur : passer la station sur ce TRX-ci
      const other = (window.RS_FACES || {})[st.rigModel];
      const port = !!(st.rigPorts && st.rigPorts[MODEL]);
      const onAir = !!((st.ptt && st.ptt.active) || (st.radio && st.radio.tx));
      const admin = !!(me && me.admin);
      const key = [st.rigModel, !!other, port, onAir, admin, !!st.station].join('|');
      if (cover.dataset.k !== key) {
        cover.dataset.k = key;
        const sw = admin && st.station && port && !onAir;
        const note = !admin ? 'Changer de TRX : réservé aux administrateurs.' : !st.station ? 'Station hors ligne.' : !port ? 'Le port du ' + esc(FACE.name) + ' n’a jamais été choisi sur le PC du club : à faire une fois sur place.' : onAir ? 'Émission en cours : changement de TRX impossible.' : '';
        cover.innerHTML = '<p>Le TRX en service est le <b>' + esc(st.rigName || st.rigModel) + '</b>.<br>Cette page est la face avant du <b>' + esc(FACE.name) + '</b>.</p><p class="fc-cover-btns">'
          + (other ? '<a class="btn accent" href="/' + esc(st.rigModel) + '">Face avant du ' + esc(other.name) + '</a>' : '')
          + (sw ? '<button class="btn" type="button" id="coverSwitch">Passer la station sur le ' + esc(FACE.name) + '</button>' : '')
          + '<a class="btn" href="/">Revenir au dashboard</a></p>' + (note ? '<p class="fc-cover-note">' + note + '</p>' : '');
        const b = $('coverSwitch');
        if (b) b.addEventListener('click', () => {
          if (!confirm('Passer la station sur le ' + FACE.name + ' ?\nLa station redémarre quelques secondes.')) return;
          send({ t: 'switch_rig', model: MODEL });
        });
      }
    } else delete cover.dataset.k;
  }
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------ émission : PTT (bouton ou barre d'espace), MOX maintenu
  let pttHeld = false, hbTimer = 0;
  L.mox = false;
  function pttReason() {
    if (!me) return 'Connectez-vous';
    if (!me.allowTx) return 'Émission désactivée sur ce serveur';
    if (me.rxOnly) return 'Indicatif d’écouteur : émission interdite';
    if (!me.canTx) return 'Votre compte est en écoute seule';
    if (!st || !st.station) return 'Station hors ligne';
    if (!st.radio.connected) return 'TRX non connecté';
    if (!iControl()) return 'Prenez la main pour émettre';
    if (st.radio.vox) return 'VOX actif au club : coupez-le d’abord';
    if (!st.txOk) return st.radio.txVfo === 1 ? 'VFO B (SPLIT) hors des bandes autorisées' : 'Hors des bandes autorisées';
    if (st.radio.power != null && st.radio.power > me.maxWatts) return 'Puissance au-delà de votre limite (' + me.maxWatts + ' W)';
    if (st.swrLock) return st.swrLock.text || 'ROS trop élevé ici';
    return null;
  }
  function pttDown() {
    if (pttHeld) return true;
    const why = pttReason();
    if (why) { say(why, 'warn'); return false; }
    pttHeld = true; L.pttOn = true;
    const voice = !!(window.RSVOICE && window.RSVOICE.txStart());
    send({ t: 'ptt', on: true, voice });
    hbTimer = setInterval(() => send({ t: 'ptt', on: true, voice }), 400);
    $('ptt').classList.add('held');
    render();
    return true;
  }
  function pttUp() {
    L.mox = false;
    if (!pttHeld) return render();
    pttHeld = false; L.pttOn = false;
    clearInterval(hbTimer);
    if (window.RSVOICE) window.RSVOICE.txEnd();
    send({ t: 'ptt', on: false });
    $('ptt').classList.remove('held');
    render();
  }
  {
    const b = $('ptt');
    b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); b.setPointerCapture(ev.pointerId); pttDown(); });
    b.addEventListener('pointerup', pttUp);
    b.addEventListener('pointercancel', pttUp);
    b.addEventListener('lostpointercapture', () => { if (!L.mox) pttUp(); });
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());
    const typing = (ev) => /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName) && ev.target.type !== 'range';
    document.addEventListener('keydown', (ev) => { if (ev.code === 'Space' && !ev.repeat && !typing(ev)) { ev.preventDefault(); pttDown(); } });
    document.addEventListener('keyup', (ev) => { if (ev.code === 'Space' && !typing(ev)) { ev.preventDefault(); pttUp(); } });
    window.addEventListener('blur', () => { if (!L.mox) pttUp(); });
  }

  // ------------------------------------------------------------ écoute (prise PHONES), stéréo et cascade
  // La page reçoit toujours la BF (cascade dans l'écran du TRX) ; le son n'est joué qu'avec « Écouter » / la prise PHONES.
  // Stéréo (TRX à deux récepteurs, double réception) : MAIN dans l'oreille gauche, SUB dans la droite, comme au casque.
  L.stereo = store.get('rs.face.stereo', '0') === '1';
  const player = { ctx: null, gain: null, next: 0 };
  function wantAudio() {
    if (!me) return;
    const on = document.visibilityState !== 'hidden' || L.listening; // onglet caché : plus de cascade, sauf si on écoute
    send({ t: 'listen', on, mute: !L.listening, stereo: L.stereo });
  }
  function volume() {
    const v = Number($('listenVol').value) / 100;
    if (player.gain) player.gain.gain.value = v;
    $('listenVolOut').textContent = Math.round(v * 100) + ' %';
    store.set('rs.vol', String($('listenVol').value));
  }
  function startListen() {
    if (!player.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return say('Ce navigateur ne peut pas jouer le son.', 'warn');
      player.ctx = new AC();
      if (player.sink && player.ctx.setSinkId) player.ctx.setSinkId(player.sink).catch(() => {});
      player.gain = player.ctx.createGain();
      player.gain.connect(player.ctx.destination);
      volume();
    }
    player.ctx.resume();
    L.listening = true;
    player.next = 0;
    wantAudio();
    if (st && st.audio && !st.audio.active) say('La station n’envoie pas encore de son (audio pas activé sur la page Station).', 'warn');
    else sinkCheck();
    render();
  }
  // Sortie son de ce PC = carte son d'un TRX (« USB Audio CODEC » de l'IC-7300, par exemple sur le PC du club) : rien dans les haut-parleurs,
  // et le son reçu partirait vers l'entrée du TRX. On le signale (la sortie se choisit dans « Sortie », ligne SSB CONFIGURATION)
  function sinkCheck() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((devs) => {
      const outs = devs.filter((d) => d.kind === 'audiooutput');
      const cur = outs.find((d) => d.deviceId === (player.sink || 'default')) || outs.find((d) => d.deviceId === 'default');
      if (cur && /USB Audio CODEC|CODEC USB/i.test(cur.label || '')) {
        say('Son du TRX envoyé vers « ' + cur.label + ' » : c’est la carte son d’un TRX, pas vos haut-parleurs — vous n’entendrez rien. Choisissez votre casque ou vos haut-parleurs dans « Sortie » (ligne SSB CONFIGURATION, micro en service) ou comme sortie par défaut de Windows.', 'warn', 12000);
      }
    }).catch(() => {});
  }
  function stopListen() {
    L.listening = false;
    wantAudio();
    if (player.ctx) player.ctx.suspend();
    render();
  }
  function setStereo(on) {
    L.stereo = !!on;
    store.set('rs.face.stereo', L.stereo ? '1' : '0');
    wantAudio();
    const s = S();
    // FTX-1 : double réception seulement si l'un des deux VFO est au-delà de 118 MHz (pas avec deux fréquences HF)
    if (L.stereo && s.dualRx === 0 && R && R.dualRxOk && !R.dualRxOk(s)) {
      L.stereo = false; store.set('rs.face.stereo', '0');
      say('Double réception impossible sur le FTX-1 avec deux fréquences HF : mettez l’un des VFO au-delà de 118 MHz (AIR, 144, 430).', 'warn', 7000);
      return render();
    }
    if (L.stereo && s.dualRx === 0) {
      // Les deux récepteurs en service (double réception) pour entendre MAIN à gauche et SUB à droite
      if (iControl()) { setCtl('dualRx', 1); say('Stéréo : double réception en marche ; MAIN dans l’oreille gauche, SUB dans l’oreille droite.', '', 5000); }
      else say('Stéréo : prenez la main pour mettre en marche le récepteur SUB (double réception).', 'warn', 6000);
    } else if (L.stereo) say('Stéréo : MAIN dans l’oreille gauche, SUB dans l’oreille droite.', '', 4000);
    render();
  }
  function play(pcm) {
    if (!L.listening || !player.ctx) return;
    if (window.RSVOICE && window.RSVOICE.talking()) { player.next = 0; return; } // pas d'écho de sa propre émission
    const ctx = player.ctx;
    const now = ctx.currentTime;
    if (player.next < now + 0.05) player.next = now + 0.2;
    else if (player.next > now + 0.8) return;
    const two = !!pcm.r;
    const buf = ctx.createBuffer(two ? 2 : 1, pcm.length, pcm.rate || ULAW.RATE);
    buf.copyToChannel(pcm, 0);
    if (two) buf.copyToChannel(pcm.r, 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(player.gain);
    src.start(player.next);
    player.next += buf.duration;
  }
  function onAudio(data) {
    const u8 = new Uint8Array(data);
    if (DG() && DG().onBinary(u8)) return; // lignes de cascade des modes numériques
    const pcm = window.ULAW && ULAW.decodeFrame(u8);
    if (!pcm) return;
    feedWf(pcm, pcm.rate || 12000);
    play(pcm);
  }

  // Cascade : FFT de 512 points sur la BF reçue (12 kHz → 0 à 4 kHz), une ligne toutes les 50 ms
  // FFT de 2048 points : à 12 kHz, un point tous les 5,9 Hz ; plage étroite (CW, filtre fin : 1,5 kHz ou moins à l'écran) :
  // 4096 points, un point tous les 2,9 Hz (spectre plus fin). WF.n = taille utilisée pour les spectres de ce tour.
  const NFFT = 4096;
  const WF = { at: 0, rate: 12000, l: new Float32Array(NFFT), r: new Float32Array(NFFT), two: false, pos: 0, drawn: false, n: 2048 };
  function feedWf(pcm, rate) {
    if (ICOM) audEnv(pcm, rate);
    WF.at = Date.now();
    WF.rate = rate;
    WF.two = !!pcm.r;
    const n = pcm.length;
    if (n >= NFFT) { WF.l.set(pcm.subarray(n - NFFT)); if (pcm.r) WF.r.set(pcm.r.subarray(n - NFFT)); return; }
    WF.l.copyWithin(0, n); WF.l.set(pcm, NFFT - n);
    if (pcm.r) { WF.r.copyWithin(0, n); WF.r.set(pcm.r, NFFT - n); }
  }
  // Fenêtre de Hann et table des cosinus / sinus par taille (calculées une fois)
  const FFT_T = {};
  function fftTab(N) {
    if (FFT_T[N]) return FFT_T[N];
    const t = { hann: new Float32Array(N), cos: new Float32Array(N / 2), sin: new Float32Array(N / 2) };
    for (let i = 0; i < N; i++) t.hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    for (let k = 0; k < N / 2; k++) { t.cos[k] = Math.cos(-2 * Math.PI * k / N); t.sin[k] = Math.sin(-2 * Math.PI * k / N); }
    return (FFT_T[N] = t);
  }
  function spectrum(x) {
    // FFT radix 2 en place (re, im) sur les WF.n derniers échantillons, puis amplitude en dB ramenée à 0..1
    const N = WF.n, T = fftTab(N), re = new Float32Array(N), im = new Float32Array(N), o = x.length - N;
    for (let i = 0; i < N; i++) re[i] = x[o + i] * T.hann[i];
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const st = N / len;
      for (let i = 0; i < N; i += len) {
        for (let k = 0; k < len / 2; k++) {
          const wr = T.cos[k * st], wi = T.sin[k * st];
          const a = i + k, b = a + len / 2;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    // Niveau automatique comme le scope du TRX : le bruit de fond (médiane) reste sombre, les signaux ressortent
    const db = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) db[i] = 10 * Math.log10(re[i] * re[i] + im[i] * im[i] + 1e-12);
    const srt = Array.from(db.subarray(16, Math.floor(N * 0.35))).sort((a, b) => a - b);
    const med = srt[srt.length >> 1];
    WF.floor = WF.floor == null ? med : WF.floor + (med - WF.floor) * 0.05;
    const out = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) out[i] = Math.max(0, Math.min(2, 0.3 + (db[i] - WF.floor) / 40)); // > 1 : signaux forts (pas de plafond avant LEVEL)
    return out;
  }
  // Palettes de la cascade (FUNC → COLOR) : 1 = rouge comme l'écran du FTDX101, 2 = bleu / violet, 3 = arc-en-ciel
  function mkPal(stops) {
    const out = [];
    for (let i = 0; i < 256; i++) {
      const v = i / 255;
      let k = 0;
      while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
      const [v0, c0] = stops[k], [v1, c1] = stops[k + 1];
      const t = Math.max(0, Math.min(1, (v - v0) / (v1 - v0)));
      out.push([0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * t)));
    }
    return out;
  }
  // 18 couleurs comme le TRX (FUNC / S.MENU → COLOR) : COLOR-1 à 11 « DIRECT SAMPLING SDR », COLOR-12 à 18 « NARROW BAND SDR »
  const PAL_STOPS = {
    1: [[0, [0, 0, 8]], [0.45, [20, 50, 200]], [0.8, [60, 110, 255]], [1, [220, 235, 255]]],
    2: [[0, [0, 4, 12]], [0.45, [40, 110, 220]], [0.8, [110, 170, 255]], [1, [235, 245, 255]]],
    3: [[0, [0, 0, 0]], [0.45, [90, 95, 100]], [0.8, [200, 200, 195]], [1, [255, 255, 250]]],
    4: [[0, [10, 2, 0]], [0.45, [170, 70, 0]], [0.8, [255, 130, 20]], [1, [255, 235, 200]]],
    5: [[0, [2, 4, 25]], [0.35, [40, 70, 220]], [0.6, [140, 90, 235]], [0.82, [240, 110, 220]], [1, [255, 235, 250]]],
    6: [[0, [4, 2, 20]], [0.35, [60, 70, 220]], [0.6, [170, 60, 160]], [0.82, [240, 30, 60]], [1, [255, 220, 220]]],
    7: [[0, [6, 0, 18]], [0.35, [90, 30, 190]], [0.65, [190, 60, 230]], [0.85, [255, 90, 230]], [1, [255, 230, 255]]],
    8: [[0, [6, 0, 20]], [0.35, [110, 50, 200]], [0.65, [200, 90, 230]], [0.85, [240, 140, 240]], [1, [255, 240, 255]]],
    9: [[0, [0, 6, 20]], [0.35, [30, 110, 210]], [0.65, [110, 190, 245]], [0.85, [200, 235, 255]], [1, [255, 255, 255]]],
    10: [[0, [0, 0, 30]], [0.25, [20, 90, 220]], [0.5, [20, 200, 220]], [0.75, [70, 220, 70]], [1, [230, 240, 120]]],
    11: [[0, [10, 0, 0]], [0.3, [170, 10, 10]], [0.6, [240, 70, 10]], [0.85, [255, 150, 20]], [1, [255, 230, 120]]],
    12: [[0, [8, 0, 2]], [0.3, [110, 0, 10]], [0.55, [215, 20, 30]], [0.78, [255, 70, 120]], [1, [255, 235, 245]]],
    13: [[0, [2, 4, 25]], [0.35, [30, 40, 170]], [0.6, [150, 60, 230]], [0.82, [255, 90, 210]], [1, [255, 240, 255]]],
    14: [[0, [6, 0, 18]], [0.35, [100, 20, 180]], [0.65, [210, 50, 220]], [0.85, [255, 100, 240]], [1, [255, 230, 255]]],
    15: [[0, [6, 0, 20]], [0.35, [120, 40, 190]], [0.65, [210, 80, 220]], [0.85, [250, 130, 235]], [1, [255, 240, 255]]],
    16: [[0, [0, 8, 22]], [0.35, [40, 120, 210]], [0.65, [130, 200, 245]], [0.85, [210, 240, 255]], [1, [255, 255, 255]]],
    17: [[0, [0, 0, 40]], [0.25, [0, 60, 200]], [0.5, [0, 200, 160]], [0.75, [120, 230, 60]], [1, [240, 250, 140]]],
    18: [[0, [10, 0, 0]], [0.3, [180, 20, 0]], [0.6, [250, 90, 0]], [0.85, [255, 170, 40]], [1, [255, 240, 150]]]
  };
  const PALS = {};
  for (const k in PAL_STOPS) PALS[k] = mkPal(PAL_STOPS[k]);
  /** Aperçu d'une couleur (dégradé de haut en bas, comme les cases du TRX) */
  const palCss = (k) => 'linear-gradient(to bottom, ' + PAL_STOPS[k].slice(1).reverse().map(([v, c]) => 'rgb(' + c.join(',') + ') ' + Math.round((1 - v) * 100) + '%').join(', ') + ')';

  // Zones du scope selon DISP : MAIN seul ; SUB au-dessus de MAIN ; MAIN | SUB côte à côte
  // Échelle de la BF de chaque récepteur : de 0 au haut de la bande passante de son filtre (+ petite marge), sans dépasser
  // le SPAN choisi ; le spectre et la cascade remplissent ainsi toute la largeur de la partie du VFO-A et du VFO-B
  function fitHz(side) {
    const span = Math.min(SPANS[L.wfSpan], (WF.rate || 2 * SPANS[L.wfSpan]) / 2), f = LCD.flt && LCD.flt[side];
    if (!f || !f.hz) return span;
    const hi = audioCenter(f.mode || '', f.hz) + (f.sh || 0) + f.hz / 2;
    return Math.max(500, Math.min(span, Math.ceil((hi * 1.05 + 100) / 100) * 100));
  }
  const nbFor = (hz) => Math.max(2, Math.floor((WF.n / 2) * hz / ((WF.rate || 2 * hz) / 2)));
  const kHz = (hz) => (hz / 1000).toFixed(hz % 1000 ? 1 : 0).replace('.', ',');
  function spanLabel() {
    if (L.disp === 1 || L.disp === 2) {
      const a = fitHz('A'), b = fitHz('B');
      return 'BF 0–' + (a === b ? kHz(a) : (L.disp === 1 ? kHz(b) + ' / 0–' + kHz(a) : kHz(a) + ' | 0–' + kHz(b))) + ' kHz';
    }
    if (L.disp === 3) return 'BF 0–' + SPANS[L.wfSpan] / 1000 + ' kHz';
    return 'BF 0–' + kHz(fitHz(L.d3 ? activeSide() : 'A')) + ' kHz';
  }
  function scopeRegions(W, H, specs) {
    const sub = WF.two ? specs[1] : null;
    // MONO : un seul scope, celui du VFO sélectionné
    if (L.mono) return activeSide() === 'B' ? [{ sp: sub, x0: 0, y0: 0, w: W, h: H, name: 'SUB' }] : [{ sp: specs[0], x0: 0, y0: 0, w: W, h: H, name: 'MAIN' }];
    if (L.disp === 1) {
      const h1 = Math.floor(H / 2) - 1;
      return [{ sp: sub, x0: 0, y0: 0, w: W, h: h1, name: 'SUB' }, { sp: specs[0], x0: 0, y0: h1 + 2, w: W, h: H - h1 - 2, name: 'MAIN', sep: 'h' }];
    }
    if (L.disp === 2) {
      const w1 = Math.floor(W / 2) - 1;
      return [{ sp: specs[0], x0: 0, y0: 0, w: w1, h: H, name: 'MAIN' }, { sp: sub, x0: w1 + 2, y0: 0, w: W - w1 - 2, h: H, name: 'SUB', sep: 'v' }];
    }
    return [{ sp: specs[0], x0: 0, y0: 0, w: W, h: H, name: '' }];
  }
  // Un scope : spectre en haut, cascade en dessous (elle descend d'une ligne à chaque tour), échelle en bas
  // FTX-1 : fenêtre du scope en fréquences, comme le TRX selon D-MODE et SPAN :
  //   CENTER : la fréquence au milieu ; CURSOR : fenêtre fixe, le repère s'y déplace (la fenêtre se recentre quand il en sort) ;
  //   FIX : fenêtre fixe au début de la bande (14.000 → 14.000 + SPAN), repères « R ▶ / T ▶ » au bord quand on est en dehors.
  // Le spectre affiché reste celui du son reçu (BF), placé à sa vraie fréquence dans la fenêtre (en dehors : rien).
  const FTXWIN = {};
  function ftxWin(name) {
    // Scope unique (nom vide) : celui du VFO sélectionné (le son reçu est le sien)
    const st0 = S(), sd = name === 'SUB' ? 'B' : name === 'MAIN' ? 'A' : activeSide(), f00 = sd === 'B' ? st0.freqB : st0.freq;
    if (!f00) return null;
    const md = (sd === 'B' ? st0.modeB : st0.mode) || '', sg = /LSB|-L$|^CW-L|^RTTY-L/.test(md) ? -1 : 1;
    const rit = sd === 'B' ? st0.ritB : st0.rit, clr = (sd === 'B' ? st0.clarB : st0.clar) || 0;
    const fR = FACE.clarCycle && rit ? f00 + clr : f00, off = /^CW/.test(md) ? (st0.cwPitch || 0) : 0;
    const span = (parseFloat(SPAN_TRX[L.trxSpan]) || 5) * 1000, dm = st0.dMode || 0;
    let start;
    if (dm === 0) start = fR - span / 2;
    else if (dm === 1) {
      let s0 = FTXWIN[sd];
      if (s0 == null || FTXWIN[sd + 'S'] !== span || fR < s0 || fR > s0 + span) s0 = fR - span / 2;
      FTXWIN[sd] = s0; FTXWIN[sd + 'S'] = span; start = s0;
    } else {
      const kh = fR / 1000, bd = BMV_PLAN.find((q) => kh >= q[0] - 1 && kh <= q[3] + 1);
      start = bd ? bd[0] * 1000 : Math.floor(fR / span) * span;
    }
    const fT = st0.split ? (sd === 'B' ? st0.freq : st0.freqB) || fR : fR;
    return { start, span, fR, fT, dm, x: (f) => (f - start) / span, a: (f) => sg * (f - fR) + off, f: (au) => fR + sg * (au - off) };
  }
  // Valeurs du spectre BF (sp, nb points sur 0…maxHz) pour n colonnes de la fenêtre ; −1 = pas de son reçu à cette fréquence
  function ftxCols(sp, nb, maxHz, win, n) {
    const out = new Float32Array(n);
    for (let px = 0; px < n; px++) {
      const a0 = win.a(win.start + px / n * win.span), a1 = win.a(win.start + (px + 1) / n * win.span);
      const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
      if (hi < 0 || lo > maxHz) { out[px] = -1; continue; }
      const b0 = Math.max(0, lo / maxHz * nb), b1 = Math.min(nb, hi / maxHz * nb);
      let m = 0;
      if (b1 - b0 < 1) {
        const fx = Math.max(0, Math.min(nb - 1, (b0 + b1) / 2 - 0.5)), i = Math.floor(fx), u = fx - i;
        m = sp[i] * (1 - u) + (sp[Math.min(nb - 1, i + 1)] || 0) * u;
      } else for (let i = Math.floor(b0); i < Math.ceil(b1) && i < nb; i++) if (sp[i] > m) m = sp[i];
      out[px] = m;
    }
    return out;
  }
  // FTX-1 : échelle sous le scope et repères R / T (aussi pour le 3DSS). x0, y0, w, h : la zone ; sh : hauteur de la zone du spectre
  function ftxScale(c2, x0, y0, w, h, sh, name) {
    c2.fillStyle = '#fff'; c2.font = 'bold 14px Verdana, "DejaVu Sans", sans-serif'; c2.textAlign = 'center';
    if (/^AF-FFT/.test(name || '')) return;
    const win = ftxWin(name);
    if (!win) return;
    const fmtRf = (hz) => { const t = String(Math.round(hz)).padStart(7, '0'); return t.slice(0, -6) + '.' + t.slice(-6, -3) + '.' + t.slice(-3); };
    const X = (f) => x0 + w * win.x(f), ly = y0 + h - 2, stp = win.span / 5;
    if (win.dm === 0) {
      // CENTER : la fréquence au milieu, écarts de part et d'autre (−200k −100k 14.448.500 +100k +200k), comme sur le TRX
      const fo = (d) => (d >= 10000 ? Math.round(d / 1000) : (d / 1000).toFixed(1)) + 'k';
      c2.fillText(fmtRf(win.fR), x0 + w / 2, ly);
      for (const k of [1, 2]) for (const sgn of [-1, 1]) c2.fillText((sgn < 0 ? '−' : '+') + fo(k * stp), x0 + w / 2 + sgn * k * w / 5, ly);
    } else {
      // CURSOR / FIX : fréquences de la fenêtre, bords compris (14.000.000 14.020.000 … 14.100.000)
      // Taille de police réduite jusqu'à ce que les fréquences ne se touchent plus (les bords sont alignés à gauche / à droite :
      // il faut 1,5 largeur de texte entre deux traits) ; si c'est encore trop serré, une sur deux
      const txt = fmtRf(win.start + win.span);
      let fs = 12, lw = 0;
      for (; fs >= 8; fs--) { c2.font = 'bold ' + fs + 'px Verdana, "DejaVu Sans", sans-serif'; lw = c2.measureText(txt).width; if (lw * 1.5 + 10 <= w / 5) break; }
      if (fs < 8) fs = 8;
      const every = lw * 1.5 + 10 > w / 5 ? 2 : 1;
      for (let i = 0; i <= 5; i += every) {
        c2.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center';
        c2.fillText(fmtRf(win.start + i * stp), x0 + w * i / 5 + (i === 0 ? 2 : i === 5 ? -2 : 0), ly);
      }
    }
    // Repères : ▼ rouge = émission (avec son trait), ▼ vert = réception (au-dessus) ; CENTER : un seul ▼ rouge (au milieu sans SPLIT ;
    // en SPLIT il est à la fréquence d'émission et se déplace quand on tourne le grand bouton, l'écoute restant au milieu).
    // En dehors de la fenêtre : « R ▶ » vert et « T ▶ » rouge sur le bord, du côté de la fréquence
    const RED = '#ff2a1a', GRN = '#3ad23a';
    const tri = (x, y, col) => { c2.fillStyle = col; c2.beginPath(); c2.moveTo(x - 6, y); c2.lineTo(x + 6, y); c2.lineTo(x, y + 9); c2.closePath(); c2.fill(); };
    const arrow = (right, y, col, t) => {
      const xe = right ? x0 + w - 3 : x0 + 3, d = right ? -1 : 1;
      c2.fillStyle = col; c2.beginPath(); c2.moveTo(xe, y); c2.lineTo(xe + d * 9, y - 7); c2.lineTo(xe + d * 22, y - 7); c2.lineTo(xe + d * 22, y + 7); c2.lineTo(xe + d * 9, y + 7); c2.closePath(); c2.fill();
      c2.fillStyle = '#0b0f17'; c2.font = 'bold 11px Arial, sans-serif'; c2.textAlign = 'center'; c2.fillText(t, xe + d * 15, y + 4);
    };
    const inW = (f) => f >= win.start && f <= win.start + win.span;
    const one = win.dm === 0; // CENTER (comme le TRX) : seulement la barre rouge d'émission ; l'écoute est le milieu de l'écran
    c2.save(); c2.beginPath(); c2.rect(x0, y0, w, sh); c2.clip(); // dans la zone du spectre (pas dans la cascade qui défile)
    const yT = one ? y0 : y0 + 10;
    if (inW(win.fT)) { const x = Math.round(X(win.fT)); c2.fillStyle = RED; c2.fillRect(x - 1, yT + 9, 2, sh - yT - 9 + y0); tri(x, yT, RED); }
    else arrow(win.fT > win.start, y0 + Math.round(sh * 0.54), RED, 'T'); // hauteurs comme sur le TRX (R au-dessus, T au milieu)
    if (!one) {
      if (inW(win.fR)) { const x = Math.round(X(win.fR)); c2.fillStyle = GRN; c2.fillRect(x - 1, y0 + 9, 2, sh - 9); tri(x, y0, GRN); } // écoute : ▼ vert et son trait
      else arrow(win.fR > win.start, y0 + Math.round(sh * 0.28), GRN, 'R');
    }
    c2.restore();
    c2.font = 'bold 14px Verdana, "DejaVu Sans", sans-serif'; c2.textAlign = 'center';
  }
  function drawScope(c2, rg, pal, nb, lvl, maxHz) {
    // FTX-1 : spectre et cascade moins « généreux » (comme sur le TRX, le spectre reste dans le bas de sa zone) ; D-LEVEL règle en plus
    const ftxDim = 0, ftxH = 1;
    const { sp, x0, y0, w, h, name } = rg;
    const lab = ICOM ? 15 : FACE.meterFtx ? 19 : 11, sh = rg.wf === false ? h - lab : Math.round((h - lab) * (h < 90 ? 0.5 : 0.6)); // IC-7300 : chiffres de l'échelle plus grands ; sans cascade : spectre sur toute la hauteur
    if (rg.sep === 'h') { c2.fillStyle = '#2b3546'; c2.fillRect(x0, y0 - 2, w, 2); }
    if (rg.sep === 'v') { c2.fillStyle = '#2b3546'; c2.fillRect(x0 - 2, y0, 2, h); }
    if (!sp) {
      // SUB sans la BF du SUB : l'écoute stéréo (double réception) l'envoie séparément
      c2.fillStyle = '#000'; c2.fillRect(x0, y0, w, h);
      c2.fillStyle = '#6f86ff'; c2.font = 'bold 10px "Roboto Mono", monospace'; c2.textAlign = 'left'; c2.fillText(name, x0 + 4, y0 + 11);
      c2.fillStyle = '#8a97ab'; c2.font = '11px system-ui, sans-serif'; c2.textAlign = 'center';
      c2.fillText('SUB : bouton « 🎧 Stéréo MAIN | SUB » (double réception)', x0 + w / 2, y0 + h / 2 + 4);
      return;
    }
    // Cascade : le contenu descend d'une ligne, nouvelle ligne en haut
    if (h - lab - sh - 1 > 0) c2.drawImage(c2.canvas, x0, y0 + sh, w, h - lab - sh - 1, x0, y0 + sh + 1, w, h - lab - sh - 1);
    c2.fillStyle = '#000';
    c2.fillRect(x0, y0, w, sh);
    c2.fillRect(x0, y0 + h - lab, w, lab);
    // Un point d'écran = le plus fort des points de la FFT qu'il couvre (les pics fins restent visibles)
    const win = FACE.meterFtx && !/^AF-FFT/.test(name || '') ? ftxWin(name) : null; // FTX-1 : fenêtre en fréquences (D-MODE, SPAN)
    const col = win ? ftxCols(sp, nb, maxHz, win, w) : new Float32Array(w);
    const noData = !!win && col.every((v) => v < 0); // FTX-1 : le son reçu tombe hors de la fenêtre (FIX, ou CURSOR décalé)
    if (!win) for (let px = 0; px < w; px++) {
      let m = 0;
      if (nb < w) {
        // Moins de points de FFT que de points d'écran : interpolation entre deux points (pas d'escalier)
        const fx = Math.max(0, Math.min(nb - 1, (px + 0.5) / w * nb - 0.5)), i = Math.floor(fx), u = fx - i;
        m = sp[i] * (1 - u) + (sp[Math.min(nb - 1, i + 1)] || 0) * u;
      } else {
        const i0 = Math.floor(px / w * nb), i1 = Math.max(i0 + 1, Math.floor((px + 1) / w * nb));
        for (let i = i0; i < i1 && i < nb; i++) if (sp[i] > m) m = sp[i];
      }
      col[px] = FACE.meterFtx ? m + lvl : Math.max(0, Math.min(1, m + lvl - ftxDim));
    }
    else for (let px = 0; px < w; px++) if (col[px] >= 0) col[px] += lvl;
    if (FACE.meterFtx) {
      // FTX-1 : comme sur le TRX, bruit de fond en bas et crêtes bien visibles — niveau rapporté au fond (2e décile)
      // et à la crête la plus forte (gardée et lentement relâchée) au lieu d'être écrêté en haut
      const srt = Array.from(col).filter((v) => !win || v >= 0).sort((a, b) => a - b), floor = srt[Math.floor(srt.length * 0.2)] || 0;
      const key = 'ftxTop' + (name || 'M'), top = Math.max(srt[srt.length - 1] || 0, floor + 0.35, (WF[key] || 0) * 0.985);
      if (srt.length) WF[key] = top;
      for (let px = 0; px < w; px++) col[px] = win && col[px] < 0 ? 0 : Math.max(0, Math.min(1, 0.1 + 0.9 * (col[px] - floor) / (top - floor)));
    }
    // Grille
    c2.strokeStyle = 'rgba(120,130,145,.45)';
    c2.lineWidth = 1;
    const ng = win ? 10 : 8; // FTX-1 : 10 divisions, comme le TRX
    for (let k = 1; k < ng; k++) { const gx = Math.round(x0 + w * k / ng) + 0.5; c2.beginPath(); c2.moveTo(gx, y0); c2.lineTo(gx, y0 + sh); c2.stroke(); }
    for (let k = 1; k < 5; k++) { const gy = Math.round(y0 + sh * k / 5) + 0.5; c2.beginPath(); c2.moveTo(x0, gy); c2.lineTo(x0 + w, gy); c2.stroke(); }
    // MARKER (S.MENU) : bande passante du filtre de ce récepteur et repère central, sur l'échelle de la BF
    const fl = !rg.noMarker && L.marker && LCD.flt && LCD.flt[name === 'SUB' ? 'B' : name === 'MAIN' || !FACE.meterFtx ? 'A' : activeSide()]; // FTX-1 : scope unique = VFO sélectionné
    if (fl) {
      const md = fl.mode;
      let c = audioCenter(md || '', fl.hz); // CW : tonalité (pitch) du TRX
      c += fl.sh || 0;
      const lo = Math.max(0, c - fl.hz / 2), hi = Math.min(maxHz, c + fl.hz / 2);
      const xA = (au) => (win ? x0 + w * win.x(win.f(au)) : x0 + au / maxHz * w); // FTX-1 : BF → place dans la fenêtre en fréquences
      const xa = Math.max(x0, Math.min(xA(lo), xA(hi))), xb = Math.min(x0 + w, Math.max(xA(lo), xA(hi)));
      if (xb > xa) {
        c2.fillStyle = 'rgba(70,130,255,.16)'; c2.fillRect(xa, y0, xb - xa, sh);
        c2.strokeStyle = 'rgba(110,160,255,.7)'; c2.beginPath(); c2.moveTo(xa + 0.5, y0); c2.lineTo(xa + 0.5, y0 + sh); c2.moveTo(xb - 0.5, y0); c2.lineTo(xb - 0.5, y0 + sh); c2.stroke();
      }
      const xc = xA(Math.max(0, Math.min(maxHz, c)));
      // Repère central orange (sauf FTX-1 : son repère est le ▼ rouge du TRX)
      if (!win) { c2.strokeStyle = '#ff9a1f'; c2.beginPath(); c2.moveTo(xc + 0.5, y0); c2.lineTo(xc + 0.5, y0 + sh); c2.stroke(); }
      // NOTCH : trait rouge à sa fréquence BF
      if (fl.notch && fl.notch.f < maxHz && xA(fl.notch.f) >= x0 && xA(fl.notch.f) <= x0 + w) {
        const xn = xA(fl.notch.f);
        c2.strokeStyle = '#ff2b1c'; c2.setLineDash([3, 2]); c2.beginPath(); c2.moveTo(xn + 0.5, y0); c2.lineTo(xn + 0.5, y0 + sh); c2.stroke(); c2.setLineDash([]);
        c2.fillStyle = '#ff5a3c'; c2.font = 'bold 9px "Roboto Mono", monospace'; c2.textAlign = 'left'; c2.fillText('N', xn + 3, y0 + 20);
      }
    }
    // Spectre : traits blancs bleutés depuis la ligne de base (AUDIO SCOPE de l'IC-7300 : couleur et type Fill / Line du TRX)
    c2.strokeStyle = rg.color ? 'rgb(' + rg.color.join(',') + ')' : 'rgba(205,220,255,.9)';
    c2.beginPath();
    if (rg.line) {
      for (let px = 0; px < w; px++) { const v = col[px], y = y0 + sh - 1 - (rg.lin ? v : v * v) * (sh - 5) * ftxH; px ? c2.lineTo(x0 + px + 0.5, y) : c2.moveTo(x0 + 0.5, y); }
      c2.lineWidth = 1.3;
    } else for (let px = 0; px < w; px++) {
      const v = col[px];
      c2.moveTo(x0 + px + 0.5, y0 + sh - 1);
      if (v > 0.005) c2.lineTo(x0 + px + 0.5, y0 + sh - 1 - (rg.lin ? v : v * v) * (sh - 5) * ftxH);
    }
    c2.stroke();
    c2.lineWidth = 1;
    // PEAK (S.MENU) : crêtes gardées, qui redescendent lentement (LV1) … vite (LV3)
    if (L.peak) {
      WF.peak = WF.peak || {};
      const key = name || 'M';
      let pk = WF.peak[key];
      if (!pk || pk.length !== w) pk = WF.peak[key] = new Float32Array(w);
      const dec = [0, 0.002, 0.004, 0.009, 0.016, 0.025][L.peak];
      c2.fillStyle = 'rgba(120,205,255,.95)';
      for (let px = 0; px < w; px++) {
        pk[px] = Math.max(col[px], pk[px] - dec);
        if (pk[px] > 0.02) c2.fillRect(x0 + px, y0 + sh - 1 - pk[px] * pk[px] * (sh - 5) * ftxH - 1, 1, 1.5);
      }
    }
    if (rg.wf !== false) {
      const line = c2.createImageData(w, 1);
      for (let px = 0; px < w; px++) {
        const cc = pal[Math.round(col[px] * 255)];
        line.data[px * 4] = cc[0]; line.data[px * 4 + 1] = cc[1]; line.data[px * 4 + 2] = cc[2]; line.data[px * 4 + 3] = 255;
      }
      c2.putImageData(line, x0, y0 + sh);
    }
    c2.strokeStyle = 'rgba(160,170,185,.7)';
    c2.beginPath(); c2.moveTo(x0, y0 + sh - 0.5); c2.lineTo(x0 + w, y0 + sh - 0.5); c2.stroke();
    // Échelle : 0 à 4 kHz de BF
    c2.fillStyle = FACE.meterFtx ? '#fff' : 'rgba(200,210,225,.85)';
    c2.font = ICOM ? 'bold 12px Arial, sans-serif' : FACE.meterFtx ? 'bold 14px "Roboto Mono", monospace' : '9px "Roboto Mono", monospace'; // FTX-1 : échelle en blanc gras, lisible
    c2.textAlign = 'center';
    if (noData) {
      // Rien à montrer : le dire plutôt qu'un écran vide (le scope du TRX, lui, voit toute la bande ; il ne passe pas par le CAT)
      c2.save(); c2.fillStyle = 'rgba(210,220,235,.85)'; c2.font = 'bold ' + Math.max(9, Math.min(13, Math.floor(w / 48))) + 'px Verdana, Arial, sans-serif'; c2.textAlign = 'center';
      c2.fillText('La fréquence écoutée est hors de cette fenêtre : la page ne reçoit que le son du TRX,', x0 + w / 2, y0 + sh / 2 - 4);
      c2.fillText('pas son scope. CENTER ou CURSOR (D-MODE) montrent le spectre autour de la fréquence.', x0 + w / 2, y0 + sh / 2 + 14);
      c2.restore();
    }
    if (rg.audScale) {
      // AUDIO SCOPE de l'IC-7300 : 0, 1.0, 2.0, 3.0, 4.0kHz, petits traits aux demi-kHz
      c2.textAlign = 'left'; c2.fillText('0', x0 + 2, y0 + h - 3);
      for (let f = 500; f < maxHz; f += 500) {
        const x = Math.round(x0 + w * f / maxHz) + 0.5;
        if (f % 1000) { c2.fillRect(x - 0.5, y0 + h - lab + 3, 1, 4); continue; }
        c2.textAlign = 'center'; c2.fillText((f / 1000).toFixed(1), x, y0 + h - 3);
      }
      c2.textAlign = 'right'; c2.fillText((maxHz / 1000).toFixed(1) + 'kHz', x0 + w - 2, y0 + h - 3);
    } else if (ICOM) {
      // IC-7300 : tous les 0,5 kHz (comme l'échelle du TRX : 0.5, 1.0, 1.5…), en kHz de BF
      const st = maxHz <= 2000 ? 250 : 500;
      for (let f = st; f < maxHz - st / 3; f += st) c2.fillText((f / 1000).toFixed(st < 500 ? 2 : 1), x0 + w * f / maxHz, y0 + h - 3);
    } else if (FACE.meterFtx) { ftxScale(c2, x0, y0, w, h, sh, name);
    } else for (let k = 1; k < maxHz / 1000; k++) c2.fillText(k + 'k', x0 + w * k * 1000 / maxHz, y0 + h - 2);
    if (name) { c2.textAlign = 'left'; c2.fillStyle = '#6f86ff'; c2.font = 'bold 10px "Roboto Mono", monospace'; c2.fillText(name, x0 + 4, y0 + 11); }
  }
  // DISP « filtres agrandis » : le filtre de chaque récepteur (largeur, décalage) avec le spectre de sa BF
  // Touche MULTI de l'écran (comme sur le TRX) : scope du VFO sélectionné en haut ; en bas OSCILLOSCOPE (10 ms/div) et AF-FFT (0–4 kHz)
  function drawMulti(c2, W, H, specs, pal, nb, lvl, maxHz) {
    const sub = activeSide() === 'B', nm = sub ? 'SUB' : 'MAIN';
    const sp = sub ? (WF.two ? specs[1] : null) : specs[0], buf = sub ? (WF.two ? WF.r : null) : WF.l;
    const h1 = Math.floor(H * 0.46), y1 = h1 + 3, hb = H - y1, w1 = Math.floor(W / 2) - 1;
    drawScope(c2, { sp, x0: 0, y0: 0, w: W, h: h1, name: nm }, pal, nb, lvl, maxHz);
    c2.fillStyle = '#2b3546'; c2.fillRect(0, h1, W, 3);
    // OSCILLOSCOPE : forme d'onde des 40 dernières ms (4 divisions de 10 ms), gain automatique
    const ox = 0, ow = w1, tb = 12;
    c2.fillStyle = '#000'; c2.fillRect(ox, y1, ow, hb);
    c2.fillStyle = '#1c2a44'; c2.fillRect(ox, y1, ow, tb);
    c2.font = 'bold 9px "Roboto Mono", monospace'; c2.fillStyle = '#6f86ff';
    c2.textAlign = 'left'; c2.fillText('OSCILLOSCOPE ' + nm, ox + 4, y1 + 9);
    c2.textAlign = 'right'; c2.fillText('10ms/Div', ox + ow - 4, y1 + 9);
    const gy0 = y1 + tb + 2, gh = hb - tb - 4;
    c2.strokeStyle = 'rgba(120,130,145,.45)'; c2.lineWidth = 1;
    for (let k = 1; k < 4; k++) { const gx = Math.round(ox + ow * k / 4) + 0.5; c2.beginPath(); c2.moveTo(gx, gy0); c2.lineTo(gx, gy0 + gh); c2.stroke(); }
    for (let k = 1; k < 4; k++) { const gy = Math.round(gy0 + gh * k / 4) + 0.5; c2.beginPath(); c2.moveTo(ox, gy); c2.lineTo(ox + ow, gy); c2.stroke(); }
    if (buf) {
      const n = Math.min(buf.length, Math.round(0.04 * WF.rate)), s0 = buf.length - n;
      let pk = 0;
      for (let i = s0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]));
      WF.oscPk = Math.max(pk, (WF.oscPk || 0) * 0.94, 0.02);
      const k = (gh / 2 - 3) / Math.max(0.35, WF.oscPk), mid = gy0 + gh / 2; // échelle fixe au-dessus d'un seuil : le bruit reste petit, comme sur le TRX
      c2.strokeStyle = '#38e0d0'; c2.lineWidth = 1.3;
      c2.beginPath();
      for (let i = 0; i < n; i++) { const x = ox + i * ow / (n - 1), y = mid - buf[s0 + i] * k; i ? c2.lineTo(x, y) : c2.moveTo(x, y); }
      c2.stroke();
    } else {
      c2.fillStyle = '#8a97ab'; c2.font = '10px system-ui, sans-serif'; c2.textAlign = 'center';
      c2.fillText('SUB : bouton « 🎧 Stéréo MAIN | SUB »', ox + ow / 2, gy0 + gh / 2 + 4);
    }
    // AF-FFT : spectre de la BF 0–4 kHz avec sa cascade
    const fHz = Math.min(4000, WF.rate / 2), nb4 = Math.max(2, Math.floor((WF.n / 2) * fHz / (WF.rate / 2)));
    drawScope(c2, { sp, x0: w1 + 2, y0: y1, w: W - w1 - 2, h: hb, name: 'AF-FFT ' + nm, sep: 'v' }, pal, nb4, lvl, fHz);
  }
  // 3DSS (comme le TRX) : les derniers spectres en perspective, du plus ancien (au fond, en haut, plus étroit) au plus récent (devant)
  function draw3d(c2, W, H, sp, pal, nb, lvl, maxHz) {
    c2.fillStyle = '#000';
    c2.fillRect(0, 0, W, H);
    if (!sp) return;
    const FTX3 = !!FACE.meterFtx; // FTX-1 : comme le 3DSS du TRX (jaune, crêtes rouges, mur de grille au fond, échelle en fréquences, repères R / T)
    const COLS = Math.max(60, Math.min(240, Math.floor(W / 3))), ROWS = 46, lab = FTX3 ? 19 : 12;
    const win3 = FTX3 ? ftxWin(activeSide() === 'B' ? 'SUB' : 'MAIN') : null; // FTX-1 : même fenêtre en fréquences que le scope
    const row = win3 ? ftxCols(sp, nb, maxHz, win3, COLS).map((v) => (v < 0 ? -1 : Math.max(0, Math.min(1, v + lvl)))) /* −1 : pas de son reçu, rien dessiné */ : new Float32Array(COLS);
    if (!win3) for (let k = 0; k < COLS; k++) {
      const i0 = Math.floor(k / COLS * nb), i1 = Math.max(i0 + 1, Math.floor((k + 1) / COLS * nb));
      let m = 0;
      for (let j = i0; j < i1 && j < nb; j++) if (sp[j] > m) m = sp[j];
      row[k] = Math.max(0, Math.min(1, m + lvl));
    }
    WF.h3 = WF.h3 || [];
    if (!L.hold) { WF.h3.push(row); if (WF.h3.length > ROWS) WF.h3.shift(); }
    const yFront = H - lab - 2, yBack = H * 0.12, amp = (H - lab) * 0.45;
    // Grille du « sol » (lignes fuyantes)
    c2.strokeStyle = FTX3 ? 'rgba(170,175,185,.55)' : 'rgba(120,130,145,.35)'; c2.lineWidth = 1;
    for (let g = 0; g <= (FTX3 ? 10 : 8); g++) {
      const fx = g / (FTX3 ? 10 : 8);
      c2.beginPath(); c2.moveTo(W * fx, yFront); c2.lineTo(W / 2 + (W * fx - W / 2) * 0.62, yBack); c2.stroke();
    }
    if (FTX3) {
      // Mur du fond : grille verticale au-dessus de la dernière ligne (comme sur le TRX)
      const bx0 = W / 2 - W * 0.31, bx1 = W / 2 + W * 0.31, top = 2;
      for (let g = 0; g <= 10; g++) { const x = Math.round(bx0 + (bx1 - bx0) * g / 10) + 0.5; c2.beginPath(); c2.moveTo(x, top); c2.lineTo(x, yBack); c2.stroke(); }
      for (let k = 0; k <= 3; k++) { const y = Math.round(top + (yBack - top) * k / 3) + 0.5; c2.beginPath(); c2.moveTo(bx0, y); c2.lineTo(bx1, y); c2.stroke(); }
    }
    const n = WF.h3.length;
    for (let r = 0; r < n; r++) {
      const age = (n - 1 - r) / (ROWS - 1);               // 0 devant … 1 au fond
      const sc = 1 - 0.38 * age, base = yFront - (yFront - yBack) * age, a = amp * sc;
      const x0 = W / 2 - W * sc / 2, cw = W * sc / COLS;
      const rr = WF.h3[r];
      for (let k = 0; k < COLS; k++) {
        const v = rr[k];
        if (v < 0) continue;
        if (FTX3) {
          // Jaune → orange → rouge avec la hauteur, un peu plus sombre au fond
          const t = Math.max(0, Math.min(1, (v - 0.25) / 0.55)), dk = 1 - 0.3 * age;
          c2.fillStyle = 'rgb(' + Math.round(255 * dk) + ',' + Math.round((215 - 175 * t) * dk) + ',' + Math.round(20 * (1 - t) * dk) + ')';
        } else { const c = pal[Math.min(255, Math.round(v * 255))]; c2.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
        const h = Math.max(1, v * a);
        c2.fillRect(x0 + k * cw, base - h, cw + 0.6, h + (yFront - yBack) / ROWS + 1);
      }
    }
    // Échelle (kHz) au pied
    c2.fillStyle = '#000'; c2.fillRect(0, H - lab, W, lab);
    if (FTX3) { ftxScale(c2, 0, 0, W, H, yFront, activeSide() === 'B' ? 'SUB' : 'MAIN'); return; }
    c2.fillStyle = '#c9d3e3'; c2.font = '9px "Roboto Mono", monospace'; c2.textAlign = 'center';
    const st = maxHz <= 2000 ? 500 : 1000;
    for (let f = st; f < maxHz; f += st) c2.fillText((f / 1000) + 'k', f / maxHz * W, H - 2);
  }
  function drawFilters(c2, W, H, specs, nb, lvl) {
    // Comme l'écran du TRX (DISP « filtres agrandis ») : deux grands filtres rouges, sans cadre, séparés par un trait ;
    // le spectre n'apparaît qu'à l'intérieur de la bande passante
    c2.fillStyle = '#000';
    c2.fillRect(0, 0, W, H);
    const half = Math.floor(W / 2);
    c2.strokeStyle = '#3a4352'; c2.lineWidth = 1.5;
    c2.beginPath(); c2.moveTo(half + 0.5, 8); c2.lineTo(half + 0.5, H - 14); c2.stroke();
    const FX = !!FACE.meterFtx; // FTX-1 : filtre blanc, intérieur gris, sans repère orange ni base bleue (comme le TRX)
    for (const [i, side, sp, color] of [[0, 'A', specs[0], FX ? '#e9eef0' : '#ff2b1c'], [1, 'B', WF.two ? specs[1] : null, FX ? '#e9eef0' : '#ff2b1c']]) {
      const x0 = i * half + 6, w = half - 12, y0 = 8, h = H - 26;
      const f = (LCD.flt && LCD.flt[side]) || { fr: 0.6, off: 0 };
      const cx = x0 + w / 2 + f.off * w, tw = w * f.fr, top = y0 + 14, bot = y0 + h - 4, sl = Math.min(14, tw * 0.12);
      if (FX) {
        const a = Math.max(x0 + 4, cx - tw / 2), b = Math.min(x0 + w - 4, cx + tw / 2), gr = c2.createLinearGradient(0, top, 0, bot);
        gr.addColorStop(0, '#5d6564'); gr.addColorStop(1, '#262b2c');
        c2.fillStyle = gr;
        c2.beginPath(); c2.moveTo(a, bot); c2.lineTo(a + sl, top); c2.lineTo(b - sl, top); c2.lineTo(b, bot); c2.closePath(); c2.fill();
      }
      // Spectre de la BF : barres fines, une par pixel, seulement dans la bande passante (découpe en trapèze)
      if (sp) {
        const a = Math.max(x0 + 4, cx - tw / 2), b = Math.min(x0 + w - 4, cx + tw / 2);
        c2.save();
        c2.beginPath(); c2.moveTo(a + 2, bot); c2.lineTo(a + sl + 2, top + 2); c2.lineTo(b - sl - 2, top + 2); c2.lineTo(b - 2, bot); c2.closePath();
        c2.clip();
        c2.strokeStyle = 'rgba(205,215,232,.8)'; c2.lineWidth = 1.4;
        c2.beginPath();
        const n = Math.floor((w - 8) / 1.6);
        // Échelle du filtre (FLT_SPAN Hz de BF sur la largeur, à l'envers en bande latérale inférieure)
        const binHz = (WF.rate / 2) / (WF.n / 2), fc = audioCenter(f.mode || '', f.hz || 2400) + (f.sh || 0);
        const rev = /^LSB$|-L$/.test(f.mode || '') ? -1 : 1, stepHz = (w - 8) / n / w * FLT_SPAN;
        for (let k = 0; k < n; k++) {
          const fq = fc + rev * (x0 + 4 + (k + 0.5) * (w - 8) / n - cx) / w * FLT_SPAN;
          if (fq < 0 || fq > WF.rate / 2) continue;
          let m = 0;
          for (let j = Math.floor((fq - stepHz / 2) / binHz), j1 = Math.max(j + 1, Math.ceil((fq + stepHz / 2) / binHz)); j < j1; j++) if (j >= 0 && j < sp.length && sp[j] > m) m = sp[j];
          // Hauteur sur toute la plage (jusqu'à ~45 dB au-dessus du bruit) : plus de plafond à mi-hauteur
          const v = Math.max(0, Math.min(1, (m + lvl) / 1.5));
          const x = x0 + 4 + k * (w - 8) / n;
          c2.moveTo(x, bot); c2.lineTo(x, bot - Math.pow(v, 1.4) * (bot - top - 6));
        }
        c2.stroke();
        c2.restore();
      } else if (side === 'B') {
        c2.fillStyle = '#8a97ab'; c2.font = '11px system-ui, sans-serif'; c2.textAlign = 'center';
        c2.font = '10px system-ui, sans-serif'; c2.fillText('spectre SUB : 🎧 Stéréo', x0 + w / 2, bot + 17);
      }
      // Bande passante (trapèze), repère central, base bleue
      c2.strokeStyle = color; c2.lineWidth = 2.5; c2.lineJoin = 'round';
      c2.beginPath();
      const kx = f.cont ? Math.max(x0 + 8, Math.min(x0 + w - 8, cx + f.cont.rel * w)) : null;
      const kd = Math.max(10, (bot - top) * 0.14);
      trapPts(x0, w, cx, tw, top, bot, sl, [[f.notch ? cx + f.notch.rel * w : null, 5], [kx, 10, kd]]).forEach((p, j) => (j ? c2.lineTo(p[0], p[1]) : c2.moveTo(p[0], p[1])));
      c2.stroke();
      if (f.notch) {
        const nx = cx + f.notch.rel * w;
        if (!(nx - 5 > cx - tw / 2 + sl && nx + 5 < cx + tw / 2 - sl)) {
          const xc = Math.max(x0 + 3, Math.min(x0 + w - 3, nx));
          c2.strokeStyle = '#ff2b1c'; c2.lineWidth = 2; c2.setLineDash([4, 3]);
          c2.beginPath(); c2.moveTo(xc, top); c2.lineTo(xc, bot); c2.stroke(); c2.setLineDash([]);
        }
      }
      if (kx != null) {
        c2.strokeStyle = '#3b8bff'; c2.lineWidth = 3; c2.lineCap = 'round';
        c2.beginPath(); c2.moveTo(kx - 10, top); c2.lineTo(kx, top + kd); c2.lineTo(kx + 10, top); c2.stroke(); c2.lineCap = 'butt';
      }
      if (!FX) {
        c2.strokeStyle = '#ff9a1f'; c2.lineWidth = 2;
        c2.beginPath(); c2.moveTo(cx, top - 4); c2.lineTo(cx, bot); c2.stroke();
        c2.strokeRect(cx - 4, top - 11, 8, 7); // petit carré orange en haut du repère, comme sur le TRX
        c2.fillStyle = '#3b6dff'; c2.fillRect(cx - tw / 2 + 3, bot + 2, Math.max(4, tw - 6), 3);
      }
      // VC TUNE : barre « − » … « + » et repère rouge, sous le grand filtre
      if (f.vc != null) {
        const vy = y0 + h + 10, va = x0 + 16, vb = x0 + w - 16;
        c2.fillStyle = '#e8edf3';
        for (const [x, t] of [[va - 9, '−'], [vb + 9, '+']]) { c2.beginPath(); c2.arc(x, vy, 3.5, 0, 7); c2.fill(); }
        c2.fillStyle = '#ff2b1c';
        for (let i = 0; i <= 40; i++) c2.fillRect(va + i * (vb - va) / 40 - 1, vy - 4, 2, 8);
        const tx = va + f.vc / 255 * (vb - va);
        c2.beginPath(); c2.moveTo(tx - 6, vy - 9); c2.lineTo(tx + 6, vy - 9); c2.lineTo(tx + 2, vy + 5); c2.lineTo(tx - 2, vy + 5); c2.closePath(); c2.fill();
      }
    }
  }
  // CW : signal le plus fort à ± 200 Hz du pitch → trait gris de l'indicateur d'accord (au milieu = bien accordé) ;
  // en émission sur ce VFO, le trait reste au milieu (on émet sur la fréquence affichée)
  const CWT_HZ = 200;
  function cwTune(side, fl, sp, ff) {
    if (!fl.cwInd) return;
    const s = S(), md = (side === 'B' ? s.modeB : s.mode) || '';
    let off = null;
    if (/^CW/.test(md)) {
      const txHere = s.tx && (s.txVfo === 1) === (side === 'B');
      if (txHere) off = 0;
      else if (sp) {
        const pitch = s.cwPitch || 700, binHz = (WF.rate / 2) / (WF.n / 2);
        let best = 0, bf = 0;
        for (let j = Math.floor((pitch - CWT_HZ) / binHz); j <= Math.ceil((pitch + CWT_HZ) / binHz); j++) if (j > 0 && j < sp.length && sp[j] > best) { best = sp[j]; bf = j * binHz; }
        if (best > 0.62) off = bf - pitch; // ~ 13 dB au-dessus du bruit
      }
    }
    if (off == null) { fl.cwOff = null; fl.cwInd.style.display = 'none'; return; }
    fl.cwOff = fl.cwOff == null ? off : fl.cwOff + (off - fl.cwOff) * 0.5;
    const rev = /^CW-?R|CW-L/.test(md) ? -1 : 1; // CW inversée : signal plus haut = plus bas en fréquence
    const x = (fl.cwA + fl.cwB) / 2 + rev * Math.max(-1, Math.min(1, fl.cwOff / CWT_HZ)) * (fl.cwB - fl.cwA) / 2;
    fl.cwInd.setAttribute('x', (x - 1.5).toFixed(1));
    fl.cwInd.style.display = '';
    fl.cwInd.classList.toggle('ok', Math.abs(fl.cwOff) < 15);
  }
  function wfTick() {
    const cv = $('scope');
    const fresh = Date.now() - WF.at < 3000;
    if (fresh) {
      const maxHz = Math.min(SPANS[L.wfSpan], WF.rate / 2);
      const lvl = L.wfLevel / 70;
      WF.n = Math.min(fitHz('A'), WF.two ? fitHz('B') : 1e9) <= 1500 ? 4096 : 2048; // plage étroite : spectre plus fin
      const specs = [spectrum(WF.l), WF.two ? spectrum(WF.r) : null];
      WF.lastSp = specs[0]; WF.lastN = WF.n; // AUTO TUNE (IC-7300)
      const nb = Math.max(2, Math.floor((WF.n / 2) * maxHz / (WF.rate / 2)));
      // Petit spectre dans le cadre du filtre (MAIN à gauche, SUB à droite)
      for (const [side, sp] of [['A', specs[0]], ['B', specs[1] || (S().dualRx !== 0 && !WF.two ? null : null)]]) {
        const fl = LCD['f' + side];
        if (!fl) continue;
        if (!sp) { fl.bars.setAttribute('d', ''); cwTune(side, fl, null); continue; }
        let d = '';
        const n = 64, bot = fl.y0 + fl.h - 6, hh = fl.h - 16;
        // Même échelle que le trapèze du filtre (cadre = FLT_SPAN Hz de BF, centré sur le milieu de la bande passante,
        // à l'envers en bande latérale inférieure) : le spectre tombe dans le filtre et remplit sa largeur, comme sur le TRX
        const ff = LCD.flt && LCD.flt[side], binHz = (WF.rate / 2) / (WF.n / 2);
        const fc = ff ? audioCenter(ff.mode || '', ff.hz) + (ff.sh || 0) : FLT_SPAN / 2;
        const rev = ff && /^LSB$|-L$/.test(ff.mode || '') ? -1 : 1;
        const cxf = fl.x0 + fl.w / 2 + (ff ? ff.off : 0) * fl.w, stepHz = (fl.w - 12) / n / fl.w * FLT_SPAN;
        // FTX-1 : spectre seulement dans la bande passante, comme sur le TRX
        const pa = FACE.meterFtx && ff ? cxf - ff.fr * fl.w / 2 + 4 : -1e9, pb = FACE.meterFtx && ff ? cxf + ff.fr * fl.w / 2 - 4 : 1e9;
        for (let i = 0; i < n; i++) {
          const x = fl.x0 + 6 + (i + 0.5) * (fl.w - 12) / n;
          if (x < pa || x > pb) continue;
          const f = fc + rev * (x - cxf) / fl.w * FLT_SPAN;
          if (f < 0 || f > WF.rate / 2) continue;
          let m = 0;
          for (let j = Math.floor((f - stepHz / 2) / binHz), j1 = Math.max(j + 1, Math.ceil((f + stepHz / 2) / binHz)); j < j1; j++) if (j >= 0 && j < sp.length && sp[j] > m) m = sp[j];
          const v = Math.max(0, Math.min(1, (m + lvl) / 1.5));
          d += 'M' + x.toFixed(1) + ' ' + bot + 'V' + (bot - Math.pow(v, 1.4) * hh).toFixed(1);
        }
        fl.bars.setAttribute('d', d);
        cwTune(side, fl, sp, ff);
      }
      if (cv.style.visibility !== 'hidden' && !L.hold) {
        const c2 = cv.getContext('2d');
        const r = cv.getBoundingClientRect();
        const W = Math.max(50, Math.round(r.width)), H = Math.max(40, Math.round(r.height));
        if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; WF.drawn = false; }
        if (!WF.drawn) { c2.fillStyle = '#000'; c2.fillRect(0, 0, W, H); WF.drawn = true; }
        const pal = PALS[L.wfColor] || PALS[1];
        if (ICOM && L.icView === 'audio' && LCD.icAudio && LCD.icAudio.style.display !== 'none') drawIcAudio(c2, W, H, specs, pal, nb, lvl, maxHz);
        else if (rfFresh()) { /* IC-7300 : le scope du TRX est dessiné à chaque image reçue (rfsOn) */ }
        else if (L.multi && !ICOM) drawMulti(c2, W, H, specs, pal, nb, lvl, maxHz);
        else if (L.disp === 3) drawFilters(c2, W, H, specs, nb, lvl, maxHz);
        else if (L.d3 && !ICOM) { /* pas de 3DSS sur l'IC-7300 (réglage resté en mémoire du navigateur : ignoré) */ const mh = fitHz(activeSide()); draw3d(c2, W, H, activeSide() === 'B' && WF.two ? specs[1] : specs[0], pal, nbFor(mh), lvl, mh); }
        else for (const rg of scopeRegions(W, H, specs)) { const mh = fitHz(rg.name === 'SUB' ? 'B' : rg.name === 'MAIN' || !FACE.meterFtx ? 'A' : activeSide()); drawScope(c2, rg, pal, nbFor(mh), lvl, mh); }
      }
    } else {
      for (const side of ['A', 'B']) if (LCD['f' + side]) { LCD['f' + side].bars.setAttribute('d', ''); cwTune(side, LCD['f' + side], null); }
    }
    setTimeout(wfTick, WF_SPEEDS[L.wfSpeed][1]);
  }
  document.addEventListener('visibilitychange', wantAudio);

  // ------------------------------------------------------------ 👁 suivre l'opérateur (formation à distance)
  // Celui qui a la main annonce son affichage de la face avant (DISP, MONO, EXPAND, MULTI, 3DSS, menu FUNC) ;
  // les autres, « Suivre l'opérateur » allumé, voient le même écran. Un clic sur une de ces touches arrête le suivi.
  const FOL = { on: store.get('rs.face.follow', '0') === '1', sent: '', ctl: undefined, timer: null };
  function setFollowFace(on, why, fromDigi) {
    FOL.on = !!on;
    // Un seul « Suivre l'opérateur » : celui de la page des modes numériques suit
    if (!fromDigi) { try { const dg = DG(); if (dg && dg.followSync) dg.followSync(FOL.on); } catch (e) { /* page pas encore prête */ } }
    store.set('rs.face.follow', FOL.on ? '1' : '0');
    const b = $('followBtn');
    if (b) b.setAttribute('aria-pressed', String(FOL.on));
    if (why) say(why, '', 5000);
    render();
  }
  function viewTouched() {
    if (FOL.on && !iControl()) setFollowFace(false, 'Suivi de l’opérateur arrêté (affichage choisi vous-même).');
  }
  function faceView() { return { disp: L.disp, mono: !!L.mono, expand: !!L.expand, multi: !!L.multi, d3: !!L.d3, func: !!L.func }; }
  function followTick() {
    const b = $('followBtn');
    if (!st || !b) return;
    const mine = iControl();
    // Toujours visible ; grisé chez celui qui a la main (c'est lui que les autres suivent)
    b.hidden = false;
    b.disabled = mine;
    b.title = mine ? 'Vous avez la main : les autres membres peuvent suivre votre écran (👁 Suivre chez eux).'
      : 'Suivre l’opérateur (formation à distance) : votre face avant montre le même écran que celui qui a la main (DISP, MONO, EXPAND, MULTI, 3DSS, FUNC). Une de ces touches arrête le suivi ; un clic ici le relance.' + (st.controller ? '' : ' Personne n’a la main pour l’instant : le suivi commencera quand quelqu’un la prendra.');
    // Enclenché tout seul quand un autre membre a la main (à l'arrivée, puis à chaque nouvel opérateur)
    const ctl = st.controller || null;
    if (ctl !== FOL.ctl) {
      FOL.ctl = ctl;
      if (ctl && !mine && me && ctl !== me.call && !FOL.on) setFollowFace(true, 'Suivi de l’opérateur enclenché : ' + ctl + ' a la main (une touche d’affichage arrête le suivi).');
    }
    if (mine) {
      const k = JSON.stringify(faceView());
      if (k !== FOL.sent && !FOL.timer) {
        FOL.sent = k;
        send({ t: 'faceview', v: faceView() });
        FOL.timer = setTimeout(() => { FOL.timer = null; }, 200);
      }
      return;
    }
    FOL.sent = '';
    const v = st.faceView;
    if (!FOL.on || !v) return;
    let ch = false;
    for (const k of ['disp', 'mono', 'expand', 'multi', 'd3', 'func']) if (v[k] != null && L[k] !== v[k] && !(k === 'expand' && NO_EXPAND) && !(k === 'mono' && NO_MONO)) { L[k] = v[k]; ch = true; }
    if (ch) { WF.drawn = false; render(); }
  }
  if ($('followBtn')) {
    $('followBtn').setAttribute('aria-pressed', String(FOL.on));
    $('followBtn').addEventListener('click', () => setFollowFace(!FOL.on, FOL.on ? 'Suivi de l’opérateur arrêté.' : 'Suivi de l’opérateur : votre face avant montre le même écran que celui qui a la main.'));
  }

  // ------------------------------------------------------------ DX Cluster relié au TRX, comme le dashboard
  // <-> ouvre dx.op0p.be ou cluster.op0p.be dans sa fenêtre ; un clic sur un spot y cale le VFO sélectionné (main prise).
  // <-> vert : un cluster de ce navigateur est relié et cette page a la main ; orange : ouvert, sans la main.
  // « Ouvrir automatiquement » : le dernier cluster choisi s'ouvre au premier clic après la connexion (le navigateur
  // refuse d'ouvrir une fenêtre sans un clic).
  const DXC = { seen: {}, win: {}, auto: store.get('rs.face.dxcauto', ''), autoDone: false };
  const dxcName = (o) => String(o || '').replace(/^https?:\/\//, '');
  function dxcPaint() {
    if (!$('dxcBtn')) return;
    const now = Date.now(), open = Object.keys(DXC.seen).filter((o) => now - DXC.seen[o] < 7000), ctl = iControl(), on = open.length > 0 && ctl;
    $('dxcArrow').classList.toggle('on', on);
    $('dxcArrow').classList.toggle('half', !on && open.length > 0);
    $('dxcBtn').title = on ? 'Relié à ' + open.map(dxcName).join(' et ') + ' : un clic sur un spot cale le TRX. Clic : ouvrir / montrer un cluster.'
      : open.length ? 'Cluster ouvert (' + open.map(dxcName).join(', ') + ') mais sans la main : prenez la main pour que ses spots calent le TRX.'
        : 'Aucun DX cluster relié : clic pour ouvrir dx.op0p.be ou cluster.op0p.be dans une fenêtre reliée au TRX.';
    document.querySelectorAll('#dxcMenu [data-dxc]').forEach((a) => {
      const isOpen = open.indexOf(a.dataset.dxc) >= 0 || open.indexOf(a.dataset.dxc.replace('https:', 'http:')) >= 0;
      a.classList.toggle('linked', isOpen && ctl);
      a.classList.toggle('opened', isOpen && !ctl);
    });
    $('dxcAuto').checked = !!DXC.auto;
  }
  function dxcOpen(url) {
    const w = DXC.win[url];
    if (w && !w.closed) { try { w.focus(); } catch (x) { /* autre site */ } return; }
    const nw = window.open(url, 'rs-dxc-' + dxcName(url).replace(/\W/g, '-'), 'popup=yes,width=' + Math.min(1600, screen.availWidth) + ',height=' + Math.min(1000, screen.availHeight));
    if (nw) DXC.win[url] = nw; else window.open(url, '_blank');
  }
  function dxcSpotMode(m, khz) {
    const M = String(m || '').toUpperCase();
    if (/^(FT8|FT4|FT2|JT65|WSPR|JTTY|RTTY|CW)$/.test(M)) return M;
    if (/^(SSB|LSB|USB|PHONE|PH)$/.test(M)) return khz < 10000 && !(khz >= 5250 && khz <= 5450) ? 'LSB' : 'USB';
    if (/^(AM|FM)$/.test(M)) return M;
    if (/^(DIGI|DATA|PSK\d*|FT|DIG)$/.test(M)) return 'DATA';
    if (M) return '';
    const CW = [[1810, 1838], [3500, 3570], [7000, 7040], [10100, 10130], [14000, 14070], [18068, 18095], [21000, 21070], [24890, 24915], [28000, 28070], [50000, 50100]];
    const PH = [[1843, 2000], [3600, 3800], [7060, 7200], [14101, 14350], [18120, 18168], [21151, 21450], [24940, 24990], [28300, 29300], [50100, 50500]];
    if (CW.some((r) => khz >= r[0] && khz <= r[1])) return 'CW';
    if (PH.some((r) => khz >= r[0] && khz <= r[1])) return khz < 10000 ? 'LSB' : 'USB';
    return '';
  }
  const bcQsy = 'BroadcastChannel' in window ? new BroadcastChannel('rs-qsy') : null;
  function dxcSpot(m) {
    if (!m || m.type !== 'rs-qsy' || !R) return;
    let khz = Number(m.freq);
    if (!(khz > 0)) return;
    if (khz < 1000) khz *= 1000; else if (khz > 1000000) khz /= 1000;
    khz = Math.round(khz * 10) / 10;
    if (!(khz * 1000 >= (R.FREQ_MIN || 30000) && khz * 1000 <= R.FREQ_MAX)) return say('Spot ' + khz + ' kHz : hors de la couverture du ' + R.NAME + '.', 'warn');
    const M = dxcSpotMode(m.mode, khz), call = String(m.call || '').toUpperCase().replace(/[^A-Z0-9/]/g, '').slice(0, 15);
    if (!iControl()) {
      if (bcQsy) bcQsy.postMessage({ type: 'rs-qsy-here', control: false });
      if (document.visibilityState === 'visible') say('Spot ' + (call || '') + ' ' + khz + ' kHz : prenez la main pour que le TRX s’y cale.', 'warn');
      return;
    }
    if (bcQsy) bcQsy.postMessage({ type: 'rs-qsy-here', control: true });
    if (st.ptt && st.ptt.active) return say('Réglage bloqué pendant l’émission.', 'warn');
    const dg = DG();
    if (dg && dg.spotQsy && dg.spotQsy(khz, M, call)) return;
    const side = activeSide();
    tuneTo(side, Math.round(khz * 1000));
    const want = M === 'DATA' ? /^(DATA-U|USB-D)$/ : M ? new RegExp('^' + M + '$') : null;
    const mk = want && (R.MODE_KEYS || []).find((x) => want.test(x[1]));
    if (mk) setTimeout(() => send({ t: 'set', mode: mk[0], sub: side === 'B' }), 150);
    say((call ? call + ' : ' : '') + 'VFO-' + side + ' sur ' + khz.toLocaleString('fr-BE') + ' kHz' + (mk ? ' en ' + mk[1] : '') + '.', '', 4000);
  }
  if (bcQsy) bcQsy.onmessage = (e) => {
    if (e.data && e.data.type === 'rs-qsy-ping') {
      DXC.seen[String(e.data.from || '?')] = Date.now();
      dxcPaint();
      return bcQsy.postMessage({ type: 'rs-qsy-here', control: !!(me && iControl()) });
    }
    dxcSpot(e.data);
  };
  window.addEventListener('message', (e) => {
    const ok = (me && Array.isArray(me.qsyOrigins) ? me.qsyOrigins : []).indexOf(e.origin) >= 0;
    if (ok && e.data && e.data.type === 'rs-qsy') dxcSpot(e.data);
  });
  if ($('dxcBtn')) {
    setInterval(dxcPaint, 2000);
    const show = (on) => { $('dxcMenu').hidden = !on; $('dxcBtn').setAttribute('aria-expanded', String(on)); if (on) dxcPaint(); };
    $('dxcBtn').addEventListener('click', (e) => { e.stopPropagation(); show($('dxcMenu').hidden); });
    $('dxcMenu').addEventListener('click', (e) => {
      if (e.target.closest('.dxc-auto')) {
        e.stopPropagation();
        if (e.target.id === 'dxcAuto') {
          DXC.auto = e.target.checked ? (DXC.last || 'https://dx.op0p.be') : '';
          store.set('rs.face.dxcauto', DXC.auto);
          say(DXC.auto ? dxcName(DXC.auto) + ' s’ouvrira à chaque connexion (au premier clic dans la page).' : 'Ouverture automatique du cluster coupée.', '', 4000);
        }
        return;
      }
      const a = e.target.closest('[data-dxc]');
      if (a) {
        e.preventDefault();
        DXC.last = a.dataset.dxc;
        if (DXC.auto) { DXC.auto = a.dataset.dxc; store.set('rs.face.dxcauto', DXC.auto); }
        dxcOpen(a.dataset.dxc);
        if (!iControl()) say('Cluster ouvert : prenez la main pour que ses spots calent le TRX.', 'warn', 6000);
      }
      show(false);
    });
    document.addEventListener('click', (e) => { if (!$('dxcMenu').hidden && !e.target.closest('.dxc-wrap')) show(false); });
    // Ouverture automatique : au premier clic après la connexion (geste de l'utilisateur exigé par le navigateur)
    document.addEventListener('pointerdown', (e) => {
      if (DXC.autoDone || !DXC.auto || !me || e.target.closest('.dxc-wrap')) return;
      DXC.autoDone = true;
      const now = Date.now();
      if (Object.keys(DXC.seen).some((o) => now - DXC.seen[o] < 7000)) return; // déjà ouvert dans ce navigateur
      dxcOpen(DXC.auto);
    }, true);
  }

  // ------------------------------------------------------------ membres connectés (👥) et messages, comme le dashboard
  // Liste des indicatifs ; l'adresse IP de chacun n'est envoyée par le serveur qu'aux administrateurs
  const OPS = { chat: [], blink: { call: '', until: 0 }, beep: store.get('rs.chatbeep', '1') !== '0', ctx: null };
  function opsDraw() {
    if (!$('usersCount')) return;
    const list = (st && st.users) || [];
    $('usersCount').textContent = String(list.length);
    // À côté de « Prendre / Libérer la main » : son indicatif, et celui qui a la main s'il s'agit d'un autre
    if (me) $('meCall').textContent = me.call; // celui qui a la main est écrit sur le bouton (« Main : … »)
    if ($('usersMenu').hidden) return;
    const box = $('usersList');
    box.textContent = '';
    const h = document.createElement('h3');
    h.textContent = list.length + (list.length > 1 ? ' membres connectés' : ' membre connecté');
    box.appendChild(h);
    const ips = {};
    for (const x of (st && st.usersIp) || []) (ips[x.call] = ips[x.call] || []).indexOf(x.ip) < 0 && ips[x.call].push(x.ip);
    for (const call of list) {
      const row = document.createElement('div');
      const isCtrl = st.controller === call;
      row.className = 'u' + (me && call === me.call ? ' me' : '') + (isCtrl ? ' ctrl' : '');
      const b = document.createElement('b');
      b.textContent = call;
      if (call === OPS.blink.call && Date.now() < OPS.blink.until) b.classList.add('blink');
      const ip = document.createElement('code');
      ip.className = 'u-ip';
      ip.textContent = ips[call] ? ips[call].join(', ') : '';
      const note = document.createElement('small');
      const tx = st.ptt && st.ptt.active && st.ptt.by === call;
      note.textContent = tx ? 'en émission' : isCtrl ? 'a la main' : me && call === me.call ? 'vous' : /^ONL/.test(call) ? 'écouteur' : '';
      row.append(b, ip, note);
      box.appendChild(row);
    }
    if (st && st.audio && st.audio.listeners) {
      const p = document.createElement('p');
      p.textContent = '🔊 ' + st.audio.listeners + ' à l’écoute de la BF';
      box.appendChild(p);
    }
  }
  function opsToggle(force) {
    const open = force != null ? force : $('usersMenu').hidden;
    $('usersMenu').hidden = !open;
    $('usersBtn').setAttribute('aria-expanded', String(open));
    if (open) { $('usersDot').hidden = true; $('usersBtn').classList.remove('chat-new'); opsDraw(); $('chat').scrollTop = $('chat').scrollHeight; }
  }
  function opsChatDraw() {
    const box = $('chat');
    if (!box) return;
    box.textContent = '';
    if (!OPS.chat.length) { box.innerHTML = '<p class="chat-empty">Aucun message.</p>'; return; }
    for (const m of OPS.chat) {
      const row = document.createElement('div');
      row.className = 'cm' + (m.kind && m.kind !== 'msg' ? ' ' + m.kind : '') + (me && m.call === me.call ? ' me' : '');
      const tm = document.createElement('time');
      tm.textContent = new Date(m.ts).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
      const who = document.createElement('b');
      who.textContent = m.call;
      const txt = document.createElement('span');
      txt.textContent = m.kind === 'ask' ? 'demande la main à ' + m.to : m.kind === 'give' ? 'passe la main à ' + m.to : m.text;
      row.append(tm, who, txt);
      box.appendChild(row);
    }
    box.scrollTop = box.scrollHeight;
  }
  function opsBeep() {
    if (!OPS.beep) return;
    try {
      OPS.ctx = OPS.ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (OPS.ctx.state === 'suspended') OPS.ctx.resume();
      const t0 = OPS.ctx.currentTime + 0.02;
      for (const dt of [0, 0.18]) {
        const o = OPS.ctx.createOscillator(), g = OPS.ctx.createGain();
        o.frequency.value = 1200;
        g.gain.setValueAtTime(0, t0 + dt); g.gain.linearRampToValueAtTime(0.18, t0 + dt + 0.01);
        g.gain.setValueAtTime(0.18, t0 + dt + 0.09); g.gain.linearRampToValueAtTime(0, t0 + dt + 0.11);
        o.connect(g).connect(OPS.ctx.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.12);
      }
    } catch (e) { /* pas de son */ }
  }
  function opsChatAdd(m, live) {
    if (!m) return;
    OPS.chat.push(m);
    while (OPS.chat.length > 40) OPS.chat.shift();
    opsChatDraw();
    if (live && (!me || m.call !== me.call)) {
      OPS.blink = { call: m.call, until: Date.now() + 20000 };
      if ($('usersMenu').hidden) { $('usersDot').hidden = false; $('usersBtn').classList.add('chat-new'); say('💬 ' + m.call + ' : ' + String(m.text || '').slice(0, 80), '', 6000); }
      opsBeep();
      opsDraw();
      setTimeout(() => { $('usersBtn').classList.remove('chat-new'); opsDraw(); }, 20100);
    }
  }
  if ($('usersBtn')) {
    $('usersBtn').addEventListener('click', (ev) => { ev.stopPropagation(); opsToggle(); });
    $('usersMenu').addEventListener('click', (ev) => ev.stopPropagation());
    document.addEventListener('click', () => { if (!$('usersMenu').hidden) opsToggle(false); });
    $('chatForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = $('chatInput').value.trim();
      if (!v) return;
      send({ t: 'chat', text: v });
      $('chatInput').value = '';
    });
    const bb = $('chatBeep');
    const showBeep = () => { bb.setAttribute('aria-pressed', String(OPS.beep)); bb.textContent = OPS.beep ? '🔔' : '🔕'; };
    showBeep();
    bb.addEventListener('click', (ev) => { ev.stopPropagation(); OPS.beep = !OPS.beep; store.set('rs.chatbeep', OPS.beep ? '1' : '0'); showBeep(); if (OPS.beep) opsBeep(); });
  }

  // ------------------------------------------------------------ liaison avec le serveur
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { retry = 0; if (creds) send(creds.session ? { t: 'login', session: creds.session } : { t: 'login', call: creds.call, pass: creds.pass }); render(); };
    ws.onmessage = (e) => {
      lastMsg = Date.now();
      if (typeof e.data !== 'string') return onAudio(e.data);
      let m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if ((m.t === 'mic_profile' || m.t === 'trxeq' || m.t === 'trxeq_values' || m.t === 'profile') && window.RSVOICE) { window.RSVOICE.onMessage(m); return; }
      if (m.t === 'vm') { VM.meta = m.meta; VM.playing = m.playing; L.vlvP = null; render(); return; } // mémoires vocales (VOICE TX)
      if (m.t === 'vm_data') { vmOnData(m); return; }
      if (m.t === 'scope') { if (ICOM) rfsOn(m); return; } // scope du TRX (IC-7300)
      if (m.t === 'spots' || m.t === 'spot') bmvOnSpots(m); // cartes de bande A / B autour du TRX
      if (m.t === 'menu_vals') return menuVals(m);
      if (m.t === 'dtmf_vals') return dtmfVals(m);
      if (m.t === 'chatlog') { OPS.chat.length = 0; (m.list || []).forEach((x) => OPS.chat.push(x)); opsChatDraw(); return; }
      if (m.t === 'chat') { opsChatAdd(m.m, true); return; }
      if (DG() && m.t !== 'hello' && m.t !== 'state' && DG().onMessage(m)) return;
      if (m.t === 'hello') {
        me = m;
        $('login').hidden = true;
        $('meCall').textContent = m.call;
        if (m.stationCall) $('stationCall').textContent = m.stationCall;
        if (m.clubName) $('clubName').textContent = m.clubName;
        if (m.session) { creds = { session: m.session }; store.set('rs.sess', m.session); }
        wantAudio();
        if (ICOM) { scopeSub(true); send({ t: 'vm_list' }); }
        if (DG()) DG().onHello(m, m);
        if (window.RSVOICE) window.RSVOICE.onHello(m);
        send({ t: 'plan_pref', on: store.get('rs.planauto', '1') !== '0' }); // MODE AUTO : même choix que dans le dashboard
        render();
      } else if (m.t === 'login_fail') {
        creds = null;
        if (m.session) store.set('rs.sess', '');
        showLogin(m.msg);
      } else if (m.t === 'session_end') {
        creds = null;
        store.set('rs.sess', '');
        showLogin(m.msg);
      } else if (m.t === 'idle_warn') {
        say('Inactivité : vous serez déconnecté dans ' + (m.seconds || 60) + ' s. Cliquez n’importe où pour rester.', 'warn', 0);
        document.addEventListener('pointerdown', () => { send({ t: 'stay' }); say(''); }, { once: true });
      } else if (m.t === 'state') {
        st = m;
        render();
        opsDraw();
        followTick();
        if (DG()) DG().onState(st);
        if (window.RSVOICE) window.RSVOICE.onState(st);
        if (pttHeld && !iControl()) pttUp();
      } else if (m.t === 'notice') {
        if (m.pttCut) pttUp();
        say(m.msg, m.level === 'error' ? 'error' : m.level === 'info' ? '' : 'warn', 7000);
      }
    };
    ws.onclose = () => {
      me = me && Object.assign({}, me, { cid: null });
      render();
      if (!creds) return;
      say('Liaison perdue avec le serveur, reconnexion…', 'warn', 0);
      retry = Math.min(retry + 1, 6);
      setTimeout(connect, 500 * Math.pow(2, retry - 1));
    };
  }
  setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    if (lastMsg && Date.now() - lastMsg > 15000) { try { ws.close(); } catch (e) { /* */ } return; }
    send({ t: 'ping', ts: Date.now() });
  }, 5000);
  function showLogin(msg) {
    $('login').hidden = false;
    $('loginErr').textContent = msg || '';
    $('loginBtn').disabled = false;
    setTimeout(() => $('loginCall').focus(), 50);
  }
  $('loginForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    creds = { call: $('loginCall').value.trim().toUpperCase(), pass: $('loginPass').value };
    $('loginPass').value = '';
    $('loginBtn').disabled = true;
    if (ws && ws.readyState === 1) send({ t: 'login', call: creds.call, pass: creds.pass });
    else connect();
  });
  $('ctrlBtn').addEventListener('click', () => {
    if (!st) return;
    if (iControl()) send({ t: 'release' });
    else if (!st.controller || otherTab()) send({ t: 'take' });
    else if (me && me.admin && confirm('Reprendre la main à ' + st.controller + ' ?')) send({ t: 'take', force: true });
  });
  // Déconnexion (comme le dashboard) : la main est libérée par le serveur, la session mémorisée oubliée ; jamais pendant une émission
  $('logoutBtn').addEventListener('click', () => {
    if (st && st.tx && iControl()) return say('Déconnexion : pas pendant une émission.', 'warn', 3000);
    if (ws && ws.readyState === 1) send({ t: 'logout' }); // le serveur oublie la session mémorisée et libère la main
    store.set('rs.sess', '');
    creds = null;
    if (L.listening) stopListen();
    if (pttHeld) pttUp();
    try { if (ws) ws.close(); } catch (e) { /* déjà fermée */ }
    showLogin('');
  });
  $('listenBtn').addEventListener('click', () => (L.listening ? stopListen() : startListen()));
  $('stereoBtn').addEventListener('click', () => setStereo(!L.stereo));
  // Modes numériques : leur propre page (digi.html), raccrochée à cette page (même connexion, voir RSHOST plus bas)
  // Page des modes numériques sur un onglet donné : déjà ouverte → elle y passe ; sinon ouverte dessus
  let digiWin = null;
  function digiOpen(tab, mode) {
    try { localStorage.setItem('rs.dg.ptab', tab); if (mode) localStorage.setItem('rs.dg.ftmode', mode); } catch (e) { /* stockage refusé */ }
    if (digiWin && !digiWin.closed) {
      try { if (digiWin.RSDIGI && digiWin.RSDIGI.goTab) digiWin.RSDIGI.goTab(tab, mode); digiWin.focus(); return; } catch (e) { /* fenêtre en cours de chargement */ }
    }
    digiWin = window.open('/' + MODEL + '/digi.html', 'rs-digi', 'width=1200,height=860');
    if (!digiWin) return say('Fenêtre bloquée par le navigateur : autorisez les fenêtres pop-up pour ce site.', 'warn', 6000);
    try {
      // Fenêtre déjà ouverte (rouverte par son nom, sans rechargement) : elle passe sur l'onglet demandé
      if (digiWin.RSDIGI && digiWin.RSDIGI.goTab) digiWin.RSDIGI.goTab(tab, mode);
      digiWin.focus();
    } catch (e) { /* */ }
  }
  $('digiBtn').addEventListener('click', () => {
    if (digiWin && !digiWin.closed) { try { digiWin.focus(); } catch (e) {} return; } // déjà ouverte : pas de rechargement
    const w = window.open('/' + MODEL + '/digi.html', 'rs-digi', 'width=1200,height=860'); // modes numériques de la face avant FTDX101
    if (!w) say('Fenêtre bloquée par le navigateur : autorisez les fenêtres pop-up pour ce site.', 'warn', 6000);
    else { digiWin = w; try { w.focus(); } catch (e) {} }
  });
  $('listenVol').value = store.get('rs.vol', '100');
  $('listenVol').addEventListener('input', volume);
  volume();
  // Flèches du clavier : accord du récepteur actif (comme le grand bouton)
  document.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const dial = (FACE.knobs || []).find((k) => k.dial);
    if (!dial) return;
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    turn(dial, 'inner', e.key === 'ArrowUp' ? 1 : -1, { clientX: r.left + r.width * (dial.cx - V.x) / V.w, clientY: r.top + r.height * (dial.cy - dial.ro - V.y) / V.h });
  });

  // ------------------------------------------------------------ cartes de bande A (à gauche) et B (à droite) du TRX
  // Spots du cluster (messages « spots » / « spot ») sur la bande de chaque VFO, autour de sa fréquence ;
  // clic sur un indicatif : ce VFO va sur sa fréquence ; molette ou − / + : plage affichée
  const BMV = { spots: new Map(), state: '', spans: [5, 10, 20, 50, 100, 200, 0], raf: 0, lay: { A: [], B: [] } };
  // Plage affichée : 5 à 200 kHz autour du VFO, ou 0 = toute la bande du VFO (par défaut : tous les spots de la bande)
  const bmSp = (k) => { const v = Number(store.get(k, '0')); return BMV.spans.indexOf(v) >= 0 ? v : 0; };
  BMV.span = { A: bmSp('rs.face.bmspan2A'), B: bmSp('rs.face.bmspan2B') };
  // En SPLIT : les deux cartes passent à ±10 kHz autour de leur VFO (− / + et molette restent possibles) ;
  // hors SPLIT, chaque carte reprend sa plage habituelle
  BMV.ssp = { A: 20, B: 20 }; BMV.wasSplit = false; BMV.us = { A: 0, B: 0 }; BMV.auto = { A: false, B: false };
  // VFO montré par chaque carte : A à gauche, B à droite ; FTX-1 (SUB à gauche sur l'écran) : B à gauche, A à droite
  const bmVfo = (box) => (SUBL ? (box === 'A' ? 'B' : 'A') : box);
  const bmvSplit = () => !!S().split;
  const bmvSpan = (side) => (bmvSplit() ? BMV.ssp[side] : BMV.span[side]);
  const BMV_KEEP = 30 * 60000;
  const BMV_MODES = /\b(FT8|FT4|FT2|CW|RTTY|PSK\d*|SSB|USB|LSB|JT65|JT9|Q65|WSPR|SSTV|FM|AM|OLIVIA|MSK144)\b/i;
  // Filtre par mode sous le nom de la bande (TOUS, FT8/4/2, SSB, CW, RTTY), propre à chaque carte
  const BMV_FILTS = [['', 'TOUS'], ['FT', 'FT8/4/2'], ['SSB', 'SSB'], ['CW', 'CW'], ['RTTY', 'RTTY']];
  BMV.filt = { A: store.get('rs.face.bmfA', ''), B: store.get('rs.face.bmfB', '') };
  // Fréquences d'appel FT8 / FT4 (kHz) : spot à moins de 3 kHz au-dessus = FT8/4/2
  const BMV_FTF = [1840, 3573, 3575.5, 5357, 7074, 7047.5, 10136, 10140, 14074, 14080, 18100, 18104, 21074, 21140, 24915, 24919, 28074, 28180, 50313, 50318];
  // Plan de bande IARU région 1 (kHz) : [début, fin CW, fin numériques, fin de bande] ; au-delà : phonie (SSB)
  const BMV_PLAN = [[1810, 1838, 1843, 2000], [3500, 3570, 3600, 3800], [5351.5, 5354, 5366, 5366.5], [7000, 7040, 7060, 7200], [10100, 10130, 10150, 10150],
    [14000, 14070, 14099, 14350], [18068, 18095, 18109, 18168], [21000, 21070, 21149, 21450], [24890, 24915, 24929, 24990], [28000, 28070, 28190, 29700], [50000, 50100, 50400, 52000]];
  // Mode d'un spot : celui écrit dans le commentaire, sinon skimmer = CW, fréquence d'appel FT, puis plan de bande
  function bmvSpotMode(p) {
    const m = ((BMV_MODES.exec(p.cmt) || [])[1] || '').toUpperCase();
    if (/^FT[248]$/.test(m)) return 'FT';
    if (m === 'CW') return 'CW';
    if (m === 'RTTY' || /^PSK/.test(m)) return 'RTTY';
    if (m === 'SSB' || m === 'USB' || m === 'LSB') return 'SSB';
    if (m) return m;
    if (p.skim) return 'CW';
    if (BMV_FTF.some((f) => p.f >= f - 0.2 && p.f <= f + 3.2)) return 'FT';
    const b = BMV_PLAN.find((x) => p.f >= x[0] && p.f <= x[3]);
    if (!b) return '';
    return p.f < b[1] ? 'CW' : p.f < b[2] ? 'RTTY' : 'SSB';
  }
  function bmvOnSpots(m) {
    if (m.t === 'spots') BMV.spots.clear();
    for (const s of m.list || []) {
      if (!s || !Number.isFinite(s.f) || typeof s.call !== 'string') continue;
      BMV.spots.set(s.call + '|' + Math.round(s.f), { f: s.f, call: s.call, cmt: String(s.cmt || ''), skim: !!s.skim, at: Number(s.at) || Date.now() });
    }
    if (BMV.spots.size > 3000) for (const k of Array.from(BMV.spots.keys()).slice(0, BMV.spots.size - 3000)) BMV.spots.delete(k);
    if (typeof m.state === 'string') BMV.state = m.state;
    bmvDraw();
  }
  function bmvBuild(side) {
    const box = $('bmv' + side);
    if (!box || box.firstChild) return box;
    box.dataset.vfo = bmVfo(side); // couleur de l'étiquette VFO-A / VFO-B
    box.setAttribute('aria-label', 'Carte de bande du VFO ' + bmVfo(side));
    box.innerHTML = '<div class="bmv-h"><b class="bmv-band">—</b><small>' + (bmVfo(side) === 'A' ? 'VFO-A' : 'VFO-B') + '</small>' +
      '<span class="bmv-span"><button type="button" data-d="-1" title="Plage plus étroite">−</button><button type="button" data-d="1" title="Plage plus large (jusqu’à toute la bande)">+</button></span></div>' +
      '<div class="bmv-m">' + BMV_FILTS.map(([k, t]) => '<button type="button" data-f="' + k + '" title="' + (k ? 'Seulement les spots ' + t : 'Tous les spots') + '">' + t + '</button>').join('') + '</div>' +
      '<div class="bmv-b"><canvas></canvas></div><div class="bmv-f"></div><div class="bmv-grip" title="Glisser : largeur des deux BAND MAP · double-clic : largeur d’origine"></div>';
    // Poignée sur le bord côté TRX : même largeur pour les deux cartes, gardée dans ce navigateur
    const grip = box.querySelector('.bmv-grip');
    grip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const x0 = e.clientX, w0 = box.getBoundingClientRect().width, sg = side === 'A' ? 1 : -1;
      grip.classList.add('drag');
      const mv = (ev) => bmvWidth(w0 + sg * (ev.clientX - x0));
      const up = () => { grip.classList.remove('drag'); window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); store.set('rs.face.bmw', String(Math.round(box.getBoundingClientRect().width))); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    });
    grip.addEventListener('dblclick', () => { bmvWidth(0); store.set('rs.face.bmw', ''); });
    const filtShow = () => box.querySelectorAll('.bmv-m button').forEach((b) => b.classList.toggle('on', b.dataset.f === (BMV.filt[side] || '')));
    box.querySelectorAll('.bmv-m button').forEach((b) => b.addEventListener('click', () => {
      BMV.filt[side] = b.dataset.f === BMV.filt[side] ? '' : b.dataset.f; // nouveau clic sur le mode choisi : tous
      store.set('rs.face.bmf' + side, BMV.filt[side]);
      filtShow();
      bmvDraw();
    }));
    filtShow();
    const zoom = (d) => {
      const i = Math.max(0, Math.min(BMV.spans.length - 1, BMV.spans.indexOf(bmvSpan(side)) + d));
      if (bmvSplit()) BMV.ssp[side] = BMV.spans[i < 0 ? 2 : i];
      else { BMV.span[side] = BMV.spans[i < 0 ? 2 : i]; store.set('rs.face.bmspan2' + side, String(BMV.span[side])); }
      bmvDraw();
    };
    box.querySelectorAll('.bmv-span button').forEach((b) => b.addEventListener('click', () => zoom(Number(b.dataset.d))));
    const body = box.querySelector('.bmv-b');
    // Molette : fait défiler la liste quand elle dépasse (ascenseur à droite), sinon change la plage ; Maj + molette : toujours la plage
    body.addEventListener('wheel', (e) => {
      if (!e.shiftKey && body.scrollHeight > body.clientHeight + 2) { BMV.us[side] = Date.now(); return; } // défilement normal du navigateur
      e.preventDefault(); zoom((e.deltaY || e.deltaX) > 0 ? 1 : -1);
    }, { passive: false });
    body.addEventListener('scroll', () => { if (!BMV.auto[side]) BMV.us[side] = Date.now(); BMV.auto[side] = false; });
    body.addEventListener('click', (e) => {
      const r = body.getBoundingClientRect(), y = e.clientY - r.top + body.scrollTop, x = e.clientX - r.left;
      let best = null, bd = 9.5;
      for (const l of BMV.lay[side]) { const d = Math.abs(l.ly - y); if (d < bd && x >= l.x0 - 8) { bd = d; best = l; } }
      if (!best) return;
      tuneTo(bmVfo(side), Math.round(best.s.f * 1000));
      say((bmVfo(side) === 'A' ? 'VFO-A' : 'VFO-B') + ' → ' + best.s.call + ' (' + best.s.f.toFixed(1) + ' kHz)', '', 3000);
    });
    body.addEventListener('mousemove', (e) => {
      const r = body.getBoundingClientRect(), y = e.clientY - r.top + body.scrollTop;
      const hit = BMV.lay[side].find((l) => Math.abs(l.ly - y) < 9);
      body.title = hit ? hit.s.call + ' ' + hit.s.f.toFixed(1) + ' kHz' + (hit.s.cmt ? ' — ' + hit.s.cmt : '') + ' (clic : y aller)'
        : body.scrollHeight > body.clientHeight + 2 ? 'Molette ou ascenseur : faire défiler les spots · Maj + molette : plage affichée' : 'Molette : plage affichée';
    });
    return box;
  }
  // Largeur des BAND MAP (0 = largeur d'origine de la feuille de style)
  function bmvWidth(w) {
    const top = document.querySelector('.fc-top');
    if (!top) return;
    if (w) top.style.setProperty('--bmw', Math.round(Math.max(160, Math.min(520, w))) + 'px'); else top.style.removeProperty('--bmw');
    bmvDraw();
  }
  { const w = Number(store.get('rs.face.bmw')); if (w) setTimeout(() => bmvWidth(w), 0); }
  function bmvDraw() {
    if (BMV.raf) return;
    BMV.raf = requestAnimationFrame(() => {
      BMV.raf = 0;
      const sp = bmvSplit();
      if (sp && !BMV.wasSplit) BMV.ssp = { A: 20, B: 20 }; // chaque passage en SPLIT : ±10 kHz
      BMV.wasSplit = sp;
      bmvPaint('A'); bmvPaint('B');
    });
  }
  function bmvPaint(side) {
    const box = bmvBuild(side);
    if (!box || !box.offsetParent) return;
    const s = S(), vs = bmVfo(side), f = vs === 'B' ? s.freqB : s.freq;
    const body = box.querySelector('.bmv-b'), cv = box.querySelector('canvas');
    const W = body.clientWidth, HV = body.clientHeight;
    if (W < 40 || HV < 60) return;
    const band = f ? BANDS.find((x) => f >= x[1] && f <= x[2]) : null;
    box.querySelector('.bmv-band').textContent = band ? band[0].replace('M', ' m') : '—';
    // IC-7300 : la carte de gauche suit le VFO en service (VFO A ou VFO B après A/B), celle de droite l'autre
    if (ICOM) { const sm = box.querySelector('.bmv-h small'), b = (side === 'A') === (s.vfoAB === 1); if (sm) sm.textContent = b ? 'VFO-B' : 'VFO-A'; }
    const dpr = window.devicePixelRatio || 1;
    if (!f) { const c0 = cv.getContext('2d'); c0.setTransform(1, 0, 0, 1, 0, 0); c0.clearRect(0, 0, cv.width, cv.height); return; }
    // Toute la bande (plage 0) : de son début à sa fin ; hors bande : 200 kHz autour du VFO
    const sps = bmvSpan(side), full = sps === 0 && !!band, fk = f / 1000;
    const span = full ? (band[2] - band[1]) / 1000 : sps || 200;
    const lo = full ? band[1] / 1000 : fk - span / 2, hi = full ? band[2] / 1000 : fk + span / 2, pad = 10;
    const now = Date.now();
    const fm = BMV.filt[side] || '';
    const list = Array.from(BMV.spots.values()).filter((p) => p.f >= lo && p.f <= hi && now - p.at < BMV_KEEP && (!fm || bmvSpotMode(p) === fm)).sort((a, b) => a.f - b.f);
    // Hauteur dessinée : celle de la carte, ou plus s'il y a trop d'indicatifs (17 px chacun) → ascenseur pour les voir tous
    const H = Math.round(Math.max(HV, Math.min(list.length * 17 + 2 * pad + 8, 7000)));
    cv.style.height = H + 'px';
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const yOf = (k) => pad + (k - lo) / (hi - lo) * (H - 2 * pad);
    // Hors bande : grisé
    if (band) {
      const b0 = band[1] / 1000, b1 = band[2] / 1000;
      c.fillStyle = 'rgba(120,130,145,.12)';
      if (b0 > lo) c.fillRect(0, 0, W, Math.max(0, yOf(b0)));
      if (b1 < hi) { const y = yOf(b1); c.fillRect(0, y, W, H - y); }
    }
    // Échelle : un trait par pas « rond », graduations au bord gauche
    const step = span <= 5 ? 0.5 : span <= 10 ? 1 : span <= 20 ? 2 : span <= 50 ? 5 : span <= 100 ? 10 : span <= 200 ? 20 : span <= 500 ? 50 : span <= 1000 ? 100 : 250;
    c.font = 'bold 12px "Roboto Mono", monospace'; c.textAlign = 'left'; c.textBaseline = 'middle';
    let tw = 0;
    for (let k = Math.ceil(lo / step) * step; k <= hi; k += step) {
      const y = Math.round(yOf(k)) + 0.5, t = step < 1 ? k.toFixed(1) : String(Math.round(k));
      c.strokeStyle = '#243042'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, y); c.lineTo(8, y); c.stroke();
      c.fillStyle = '#ffffff'; c.fillText(t, 10, y);
      tw = Math.max(tw, c.measureText(t).width);
    }
    // Trait vertical après la graduation la plus large possible (« 28097.5 ») : même place pour les indicatifs
    // dans les deux BAND MAP, quelle que soit la bande
    const x0 = Math.ceil(10 + Math.max(tw, c.measureText('00000.0').width) + 12);
    c.strokeStyle = '#2b3546'; c.beginPath(); c.moveTo(x0 - 6.5, 0); c.lineTo(x0 - 6.5, H); c.stroke();
    // Spots : du plus récent au plus ancien gardés 30 min ; étiquettes poussées vers le bas si elles se chevauchent
    const lay = [];
    let last = -99;
    for (const p of list) {
      const y = yOf(p.f), ly = Math.max(y, last + 17); // une ligne de 17 px par indicatif : plus de place pour cliquer
      if (ly > H - 4) break;
      last = ly;
      lay.push({ s: p, y, ly, x0 });
    }
    BMV.lay[side] = lay;
    c.textAlign = 'left';
    for (const l of lay) {
      const md = (BMV_MODES.exec(l.s.cmt) || [])[1] || '';
      c.strokeStyle = 'rgba(95,179,255,.55)'; c.beginPath(); c.moveTo(x0 - 6, l.y); c.lineTo(x0 - 1, l.ly); c.stroke();
      c.fillStyle = '#ffffff'; // indicatifs en blanc (plus lisibles)
      c.font = (l.s.skim ? '' : 'bold ') + '14px system-ui, sans-serif';
      c.fillText(l.s.call, x0, l.ly);
      if (md) { const cw = c.measureText(l.s.call).width; c.fillStyle = '#5fb3ff'; c.font = '10px "Roboto Mono", monospace'; c.fillText(md.toUpperCase(), x0 + cw + 5, l.ly); }
    }
    // VFO : trait et triangle (rouge si c'est le VFO d'émission)
    const yv = Math.round(yOf(fk)) + 0.5, tx = L.txSide(s) === vs;
    c.strokeStyle = tx ? '#ff3b30' : (vs === 'A' ? '#cfc8ff' : '#2f7bff'); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, yv); c.lineTo(W, yv); c.stroke();
    c.fillStyle = c.strokeStyle; c.beginPath(); c.moveTo(W - 1, yv - 5); c.lineTo(W - 9, yv); c.lineTo(W - 1, yv + 5); c.closePath(); c.fill();
    // Ascenseur : le VFO reste en vue, sauf pendant 15 s après un défilement à la main
    if (H > HV && now - (BMV.us[side] || 0) > 15000) {
      const st = Math.max(0, Math.min(H - HV, Math.round(yv - HV / 2)));
      if (Math.abs(body.scrollTop - st) > 2) { BMV.auto[side] = true; body.scrollTop = st; }
    } else if (H <= HV && body.scrollTop) body.scrollTop = 0;
    box.querySelector('.bmv-f').textContent = list.length + ' spot' + (list.length > 1 ? 's' : '') + (fm ? ' ' + BMV_FILTS.find((x) => x[0] === fm)[1] : '') + ' · ' + (full ? 'toute la bande' : span + ' kHz') + (BMV.state && BMV.state !== 'connecté' ? ' · cluster : ' + BMV.state : '');
  }
  setInterval(bmvDraw, 2000);
  window.addEventListener('resize', bmvDraw);

  // ------------------------------------------------------------ fenêtres séparées (modes numériques, carte de bande)
  // Modes numériques : bouton ⧉ des onglets → /digi.html, qui se raccroche à cette page (window.opener.RSHOST)
  // et utilise sa connexion, comme depuis le dashboard ; sous la face avant : « Ramener ici ».
  const digiApi = { send, say, iControl, state: () => st, rig: () => R, setFreq: (hz, which) => tuneTo(which === 'B' ? 'B' : 'A', hz),
    followFace: (on) => setFollowFace(on, '', true) }; // « Suivre l'opérateur » cliqué dans la page des modes numériques
  const digiHost = { win: null, inst: null };
  function DG() {
    if (digiHost.inst && digiHost.win && !digiHost.win.closed) return digiHost.inst;
    if (digiHost.inst) releaseDigi();
    return window.RSDIGI || null;
  }
  window.DG = DG;
  function releaseDigi() {
    digiHost.inst = null;
    digiHost.win = null;
    if (window.RSDIGI) { window.RSDIGI.setDetached(false); if (me) window.RSDIGI.onHello(me, me); if (st) window.RSDIGI.onState(st); }
  }
  window.RSHOST = {
    api: digiApi,
    attach(win, inst, popupApi) {
      if (digiHost.win && digiHost.win !== win && !digiHost.win.closed) { try { digiHost.win.close(); } catch (e) {} }
      bmPopClose(); // la carte de bande part avec les modes numériques (dans leur fenêtre)
      digiHost.win = win;
      digiHost.inst = inst;
      if (window.RSDIGI) window.RSDIGI.setDetached(true);
      inst.init(popupApi || digiApi);
      if (inst.followSync) inst.followSync(FOL.on); // même « Suivre l'opérateur » que la face avant
      if (me) inst.onHello(me, me);
      if (st) inst.onState(st);
    },
    detach(inst) { if (digiHost.inst === inst) releaseDigi(); },
    closePopup() { const w = digiHost.win; releaseDigi(); if (w && !w.closed) try { w.close(); } catch (e) {} }
  };

  // Carte de bande : la colonne de droite (#fcBm) est déplacée telle quelle dans une fenêtre à elle (bouton ⧉ de son en-tête)
  const BMKEY = 'rs.face.bmwin';
  const bmPop = { win: null, el: null, ph: null };
  // digi.js cherche ses éléments par id : aussi dans la fenêtre de la carte de bande
  window.RSPANELS = {
    find(id) {
      const el = bmPop.el;
      if (!el || el.ownerDocument === document) return null;
      return el.id === id ? el : el.querySelector('#' + CSS.escape(id));
    },
    all(sel) {
      const out = Array.from(document.querySelectorAll(sel));
      if (bmPop.el && bmPop.el.ownerDocument !== document) out.push(...bmPop.el.querySelectorAll(sel));
      return out;
    }
  };
  const bmSaved = () => { try { return JSON.parse(store.get(BMKEY, '') || 'null'); } catch (e) { return null; } };
  const redraw = () => window.dispatchEvent(new Event('resize'));
  function bmPopBtn() {
    const b = window.RSPANELS.find('bmPop') || document.getElementById('bmPop');
    if (!b) return;
    const on = !!bmPop.win;
    b.textContent = on ? '⧉ Ramener' : '⧉';
    b.classList.toggle('on', on);
    b.title = on ? 'Ramener la carte de bande à droite de la face avant (ou fermer cette fenêtre)' : 'Ouvrir la carte de bande dans une fenêtre séparée (autre écran…)';
  }
  function bmPopOpen(quiet) {
    const el = document.getElementById('fcBm');
    if (!el || bmPop.win) return true;
    if (DG() !== window.RSDIGI) { if (!quiet) say('La carte de bande est dans la fenêtre séparée des modes numériques.', '', 5000); return true; }
    const g = bmSaved() || { w: 380, h: Math.max(400, (screen.availHeight || 900) - 120), x: window.screenX + Math.max(0, window.outerWidth - 420), y: window.screenY + 80 };
    const win = window.open('', 'rs-face-bm', 'popup,width=' + g.w + ',height=' + g.h + ',left=' + g.x + ',top=' + g.y);
    if (!win) {
      if (!quiet) say('Fenêtre bloquée par Chrome : autorisez les fenêtres pop-up pour ce site (icône à droite de la barre d’adresse).', 'warn', 8000);
      return false;
    }
    const doc = win.document;
    doc.title = 'Carte de bande — ' + (FACE ? FACE.name : 'Remote Station');
    doc.documentElement.lang = 'fr';
    if (!doc.body) doc.documentElement.appendChild(doc.createElement('body'));
    doc.body.textContent = '';
    doc.body.className = 'face-page bm-popup';
    for (const f of ['rp-tokens.css', 'rp.css', 'face.css']) {
      if (doc.querySelector('link[data-rs="' + f + '"]')) continue;
      const l = doc.createElement('link');
      l.rel = 'stylesheet';
      l.href = location.origin + '/css/' + f;
      l.dataset.rs = f;
      l.onload = () => setTimeout(redraw, 0); // dimensions connues : on redessine
      doc.head.appendChild(l);
    }
    if (!doc.querySelector('script[data-rs]')) {
      // Face avant fermée : la fenêtre se ferme toute seule
      const sc = doc.createElement('script');
      sc.dataset.rs = '1';
      sc.textContent = 'setInterval(function(){try{if(!opener||opener.closed)window.close();}catch(e){window.close();}},2000);';
      doc.head.appendChild(sc);
    }
    const ph = document.createComment('place de la carte de bande');
    el.before(ph);
    try {
      doc.body.appendChild(doc.adoptNode(el));
    } catch (e) {
      if (el.ownerDocument !== document) document.adoptNode(el);
      ph.replaceWith(el);
      try { win.close(); } catch (x) {}
      return false;
    }
    Object.assign(bmPop, { win, el, ph });
    document.body.classList.add('bm-popped');
    // Barre d'espace (PTT), Échap et clics : transmis à la page (menus « Filtres », émission…)
    const fwd = (type) => (e) => {
      const t = e.target;
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      if (e.code !== 'Space' && e.key !== 'Escape' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (e.code === 'Space' || e.key.indexOf('Arrow') === 0) e.preventDefault();
      document.dispatchEvent(new KeyboardEvent(type, { key: e.key, code: e.code, repeat: e.repeat, bubbles: true }));
    };
    doc.addEventListener('keydown', fwd('keydown'));
    doc.addEventListener('keyup', fwd('keyup'));
    doc.addEventListener('click', () => document.dispatchEvent(new MouseEvent('click')));
    win.addEventListener('resize', redraw);
    win.addEventListener('pagehide', () => setTimeout(() => { if (bmPop.win === win) bmPopClose(); }, 50));
    store.set(BMKEY, JSON.stringify(g));
    bmPopBtn();
    setTimeout(redraw, 50);
    return true;
  }
  function bmPopClose(keep) {
    const w = bmPop.win;
    if (!w) return;
    const el = bmPop.el, ph = bmPop.ph;
    bmPop.win = null;
    try { document.adoptNode(el); } catch (e) {}
    ph.replaceWith(el);
    bmPop.el = null;
    document.body.classList.remove('bm-popped');
    if (!keep) store.set(BMKEY, '');
    try { if (!w.closed) w.close(); } catch (e) {}
    bmPopBtn();
    redraw();
  }
  // Fenêtre déplacée ou agrandie : mémorisée ; fermée par la croix : la carte revient
  setInterval(() => {
    const w = bmPop.win;
    if (!w) return;
    if (w.closed) { bmPopClose(); return; }
    const g = { x: w.screenX, y: w.screenY, w: w.outerWidth, h: w.outerHeight };
    if (g.w > 0 && store.get(BMKEY, '') !== JSON.stringify(g)) store.set(BMKEY, JSON.stringify(g));
  }, 1000);
  // Page rechargée ou fermée : la carte revient (la fenêtre se ferme) mais reste mémorisée et se rouvre au chargement
  window.addEventListener('pagehide', () => bmPopClose(true));
  document.addEventListener('rs-bm-pop', () => { if (bmPop.win) bmPopClose(); else bmPopOpen(); });
  function bmPopRestore() {
    if (!bmSaved()) return;
    if (bmPopOpen(true) === false) say('La carte de bande n’a pas pu être rouverte dans sa fenêtre : autorisez les fenêtres pop-up pour ce site, puis rechargez la page.', 'warn', 9000);
  }

  // ------------------------------------------------------------ démarrage
  if (!FACE || !R) {
    say('Pas de face avant pour « ' + MODEL + ' ».', 'error', 0);
    return;
  }
  document.title = FACE.name + ' · Remote Station';
  // Chaque étape du démarrage à part : une erreur dans l'une (réglage gardé dans le navigateur, état du TRX inattendu…)
  // n'empêche plus les suivantes (PTT, DIGI / SSB CONFIGURATION sous la face avant) ; l'erreur est affichée pour qu'on puisse la corriger
  const boot = (name, fn) => {
    try { fn(); } catch (e) {
      console.error('Démarrage (' + name + ') :', e);
      say('Erreur au démarrage de la page (' + name + ') : ' + (e && e.message ? e.message : e) + ' — merci de la signaler (copie d’écran).', 'error', 0);
    }
  };
  boot('face avant', build);
  boot('cascade', wfTick);
  // Modes numériques (FT8, RTTY, CW…) sous l'image du TRX : le même module que le dashboard, sur la connexion de cette page
  boot('modes numériques', () => { if (window.RSDIGI) window.RSDIGI.init(digiApi); });
  boot('carte de bande', bmPopRestore);
  if (window.RSVOICE) boot('phonie', () => {
    window.RSVOICE.init({ compact: true, send, say, iControl, state: () => st, me: () => me, rig: () => R,
      // Sortie son choisie dans SSB CONFIGURATION : aussi pour l'écoute du TRX
      setSink: (id) => { player.sink = id; if (player.ctx && player.ctx.setSinkId) player.ctx.setSinkId(id).catch(() => say('Sortie son : ce navigateur ne permet pas de la choisir (Chrome ou Edge récents).', 'warn', 5000)); },
      sendBin: (buf) => { if (ws && ws.readyState === 1) ws.send(buf); } });
    // « 👁 Suivre l'opérateur » sous la face avant, à droite de « Profil de … »
    const fb = $('followBtn'), pf = $('vxProf');
    if (fb && pf) { pf.after(fb); fb.textContent = '👁 Suivre l’opérateur'; }
    // DIGI CONFIGURATION : ligne au-dessus de SSB CONFIGURATION, un bouton par mode ; clic : la page des modes
    // numériques (/ftdx101/digi.html) s'ouvre sur ce mode (FT8 / FT4 / FT2, RTTY…), ou y passe si elle est déjà ouverte
    const vxBox = document.querySelector('.fc-tx .vx'), vxH = vxBox && vxBox.querySelector('.vx-h');
    if (vxBox && vxH) {
      const DIGI_MODES = [['FT8/FT4/FT2', 'ftx'], ['RTTY', 'rtty'], ['WSPR', 'wspr'], ['JT65', 'jt65'], ['JTTY', 'jtty'], ['CW', 'cw'], ['SSTV', 'sstv']];
      const row = document.createElement('div');
      row.className = 'fc-digirow';
      row.innerHTML = '<div class="vx-h fc-digih"><span class="vx-title">DIGI configuration</span></div>' +
        DIGI_MODES.map(([lab, t, m]) => '<button type="button" class="btn fc-digim" data-tab="' + t + '"' + (m ? ' data-mode="' + m + '"' : '') + ' title="Modes numériques : ' + lab + ' (page séparée)">' + lab + '</button>').join('');
      vxBox.insertBefore(row, vxH);
      // Les deux titres (DIGI / SSB CONFIGURATION) sur une ligne et de même largeur : les boutons s'alignent dessous
      const dh = row.querySelector('.fc-digih');
      const sameW = () => {
        dh.style.minWidth = vxH.style.minWidth = '';
        const w = Math.ceil(Math.max(dh.getBoundingClientRect().width, vxH.getBoundingClientRect().width));
        if (w > 0) dh.style.minWidth = vxH.style.minWidth = w + 'px';
      };
      requestAnimationFrame(sameW);
      window.addEventListener('resize', sameW);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(sameW);
      row.addEventListener('click', (e) => {
        const b = e.target.closest('.fc-digim');
        if (b) digiOpen(b.dataset.tab, b.dataset.mode || '');
      });
      // Mode affiché dans la page des modes numériques : son bouton en bleu clair (rien si la page est fermée)
      setInterval(() => {
        let cur = '';
        try { const dg = digiHost.inst && digiHost.win && !digiHost.win.closed ? digiHost.inst : null; cur = dg && dg.curTab ? dg.curTab() : ''; } catch (e) { cur = ''; }
        row.querySelectorAll('.fc-digim').forEach((b) => b.classList.toggle('on', b.dataset.tab === cur));
      }, 500);
    }
    // DX Cluster à droite de la ligne DIGI CONFIGURATION, au-dessus de « Suivre l'opérateur » (à droite de la ligne
    // SSB CONFIGURATION) : une ligne de gagnée ; les deux boutons ont la même largeur
    const dw = document.querySelector('.topbar .dxc-wrap'), drow = document.querySelector('.fc-tx .fc-digirow');
    if (dw && drow) { drow.appendChild(dw); dw.classList.add('fc-dxright'); } else if (dw && fb) fb.after(dw);
    if (fb) fb.classList.add('fc-followright');
    const sameR = () => {
      const db = $('dxcBtn');
      if (!db || !fb) return;
      db.style.minWidth = fb.style.minWidth = '';
      const w = Math.ceil(Math.max(db.getBoundingClientRect().width, fb.getBoundingClientRect().width));
      if (w > 0) db.style.minWidth = fb.style.minWidth = w + 'px';
    };
    requestAnimationFrame(sameR);
    window.addEventListener('resize', sameR);
  });
  const sess = store.get('rs.sess', '');
  if (sess) creds = { session: sess };
  else showLogin('');
  connect();
  window.RSFACE = { state: () => S(), L, LCD, face: FACE, spots: (m) => bmvOnSpots(m), send: (m) => send(m), dtmf: (m) => dtmfVals(m), menu: (m) => menuVals(m), spots: (m) => bmvOnSpots(m) }; // essais
})();
