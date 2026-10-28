/*
 * station-core.js — logique de la page Station (au club), indépendante du transport.
 * Relie le port CAT du transceiver (Web Serial) au serveur VPS (WebSocket), via un pilote de radio
 * (ftx1.js, ftdx10.js : CAT texte Yaesu ; ic7300.js : CI-V binaire Icom).
 *
 * Sécurités côté station :
 *  - TX0 si plus de "keepalive" du VPS pendant une émission (perte réseau, VPS planté…)
 *  - TX0 si la liaison WebSocket tombe pendant une émission
 *  - TX0 si la radio est en "CAT TX" alors que la station n'a rien demandé (ex. après rechargement)
 */
(function (root) {
  'use strict';
  const DEFAULT_RIG = (typeof module !== 'undefined' && module.exports) ? require('./ftx1.js') : root.FTX1;
  const TX_METER_KEYS = ['m3', 'm4', 'm5', 'm6'];
  // Durée d'un texte CW (points PARIS : 1 point = 1200 / wpm ms), pour enchaîner les morceaux du manipulateur
  const MORSE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--',
    N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
    0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
    '/': '-..-.', '?': '..--..', '.': '.-.-.-', ',': '--..--', '=': '-...-', '+': '.-.-.', '-': '-....-'
  };
  function cwMs(t, wpm) {
    let u = 0;
    for (const ch of t) {
      if (ch === ' ') { u += 4; continue; }
      const c = MORSE[ch];
      if (!c) continue;
      for (const x of c) u += (x === '.' ? 1 : 3) + 1;
      u += 2;
    }
    return Math.round(u * 1200 / wpm);
  }

  class StationCore {
    /**
     * @param {object} o
     * @param {(s:string|Uint8Array)=>void} o.writeSerial  envoie une commande à la radio (texte ou octets)
     * @param {(obj:object)=>void} o.sendWs     envoie un message JSON au VPS
     * @param {(msg:string)=>void} [o.log]
     * @param {(radio:object)=>void} [o.onRadio]
     * @param {object} [o.rig]  pilote de radio (FTX-1 par défaut)
     */
    constructor(o) {
      this.rig = o.rig || DEFAULT_RIG;
      const FTX1 = this.rig;
      this.writeSerial = o.writeSerial;
      this.sendWs = o.sendWs;
      this.log = o.log || function () {};
      this.onRadio = o.onRadio || function () {};
      // Émission des modes numériques : signal fabriqué et joué par la page (sortie son vers le TRX)
      //   txAudio.prepare(id, mode, text, f0) → { ok, text, seconds, err } ; play(id, atLocalMs, onEnd) → bool ; stop()
      this.txAudio = o.txAudio || null;
      // Manipulateur logiciel (port « Standard COM Port », ligne DTR) : { available(), set(on) }
      this.keyer = o.keyer || null;
      this.clockOffset = 0; // heure du VPS − heure de ce PC (ms), mesurée par la page
      this.digiTx = null;
      this.pollMs = o.pollMs || this.rig.POLL_MS || 250;
      this.kaTimeoutMs = o.kaTimeoutMs || 2000;
      // Chien de garde d'émission (indépendant du serveur) : TRX en émission sans modulation pendant txSilenceMs,
      // ou en émission continue pendant txHardMaxMs, quelle qu'en soit la cause (PTT ou micro bloqué au club…) → TX0
      this.txSilenceMs = o.txSilenceMs || 120000;
      this.txHardMaxMs = o.txHardMaxMs || 300000;
      this.txSince = 0;
      this.lastMod = 0;
      this.radioTimeoutMs = o.radioTimeoutMs || 3000;
      this.split = new FTX1.Splitter();
      this.radio = { model: this.rig.ID, connected: false, freq: null, mode: null, modeCode: null, freqB: null, modeB: null, modeCodeB: null, tx: 0, smeter: 0, power: null, powerHead: null };
      this.ticks = 0;
      this.forceSlow = true;
      this.serialOpen = false;
      this.wsUp = false;
      this.catKeyed = false;
      this.lastKa = 0;
      this.lastRx = 0;
      this.lastPush = 0;
      this.dirty = true;
      this.timer = null;
      this.queue = [];       // trames de lecture en attente (pilotes à trames, ex. CI-V)
      this.queueTimer = null;
      this.slowPos = 0;
      this.unknown = new Set();
      this.prio = [];
      // Phonie à distance : réglages « MOD SOURCE » d'avant l'émission, à remettre au retour en réception
      this.voiceSeq = 0;
      this.voiceJob = null;
      this.voiceOn = false;
      this.voiceSaved = null;
      this.voiceRestoreTimer = null;
      // Menus gardés sur USB entre deux passages en émission du même opérateur (pas d'attente au PTT suivant) ;
      // remis comme avant après ce délai sans émission en phonie, ou tout de suite à la demande du serveur (main rendue…)
      this.voiceHoldMs = o.voiceHoldMs || 20000;
    }
    /** Demande la relecture d'une clé d'état au prochain cycle (pilotes à trames). */
    _readBack(id) {
      const r = this.rig.readFor && this.rig.readFor(id, this.radio);
      if (r && this.prio.indexOf(r) < 0) this.prio.push(r);
    }

    // ---------- côté série ----------
    serialOpened() {
      this.serialOpen = true;
      this.split = new this.rig.Splitter();
      this.lastRx = 0;
      this.forceSlow = true;
      this.queue = [];
      // Initialisation propre au pilote (Yaesu : AI0, pas d'auto-information ; Icom : TX OFF)
      for (const c of [].concat(this.rig.INIT || [])) this._write(c);
      if (!this.timer) this.timer = setInterval(() => this.tick(), this.pollMs);
      this.log('Port CAT ouvert');
      if (this.voiceSaved) setTimeout(() => this._voiceRestoreNow('port CAT rouvert'), 1500);
    }

    serialClosed() {
      this.serialOpen = false;
      this.cwCache = null;
      this._txAudioStop();
      this.catKeyed = false;
      if (this.radio.connected) {
        this.radio.connected = false;
        this.dirty = true;
        this._push(true);
      }
      this.log('Port CAT fermé');
    }

    /** Données reçues de la radio : texte ou octets (Uint8Array). */
    onSerialData(chunk) {
      const toks = this.split.push(chunk);
      const FTX1 = this.rig;
      for (const t of toks) {
        // Console CAT de diagnostic : réponse brute renvoyée au serveur
        if (this.query && typeof t === 'string' && (t.startsWith(this.query.prefix) || t === '?') && Date.now() < this.query.until) {
          if (this.wsUp) this.sendWs({ t: 'cat_reply', cmd: this.query.cmd, reply: t + ';', id: this.query.id });
          this.query = null;
        }
        if (this.ftWait && typeof t === 'string') this._ftReply(t);
        if (this.sideTrace && typeof t === 'string' && /^(VS|FT|TX|\?)/.test(t) && this.sideTrace.length < 40) this.sideTrace.push(t);
        if (this.subWait && typeof t === 'string') this._subReply(t);
        if (this.waitFn) { const v = this.waitFn.fn(t); if (v != null) { const w = this.waitFn; this.waitFn = null; clearTimeout(w.timer); w.cb(v); } }
        if (this.waitRe && typeof t === 'string' && this.waitRe.re.test(t)) { const w = this.waitRe; this.waitRe = null; clearTimeout(w.timer); w.cb(t); }
        if (this.cwRe && typeof t === 'string' && this.cwRe.re.test(t)) this.cwRe.cb(t);
        if (this.cw && this.rig.CW && this.rig.CW.poRe && typeof t === 'string') { const mm = this.rig.CW.poRe.exec(t); if (mm) this.cwPo = +mm[1]; }
        const p = FTX1.parse(t);
        if (p && p.error && this.cwWatch) this.cwWatch.errs++;
        if (!p) {
          // Diagnostic : réponse inconnue du pilote (affichée une fois par type, 20 au plus)
          const key = typeof t === 'string' ? t.slice(0, 4) : Array.from(t.slice(2, 4)).join(',');
          if (!this.unknown.has(key) && this.unknown.size < 20) {
            this.unknown.add(key);
            const raw = typeof t === 'string' ? t + ';' : Array.from(t, (b) => b.toString(16).padStart(2, '0')).join(' ');
            this.log('Réponse non reconnue de la radio : ' + raw.slice(0, 60));
          }
          continue;
        }
        this.lastRx = Date.now();
        if (!this.radio.connected) {
          this.radio.connected = true;
          this.dirty = true;
          this.log(FTX1.NAME + ' répond');
        }
        // Commande refusée par la radio (« ?; ») juste après un réglage : on le signale dans le journal
        if (p.error && this.lastCmd && Date.now() - this.lastCmd.at < 600) {
          this.log('La radio a refusé la commande ' + this.lastCmd.s);
          // Visible aussi sur le dashboard (le texte contient « ? » : le serveur l'affiche à celui qui pilote)
          if (this.wsUp && !/^(VS|FT|MD)/.test(this.lastCmd.s)) this.sendWs({ t: 'trx_note', text: 'le TRX a refusé la commande « ' + String(this.lastCmd.s).slice(0, 20) + ' » (réponse ?;)' });
          this.lastCmd = null;
        }
        if (p.error || p.ok) continue;
        // Lecture qui dépend du côté actif (FTX-1 : PA0 / RA0 → VFO B quand SUB est actif)
        if (FTX1.remapRead) FTX1.remapRead(p, this.radio);
        // Radio qui ne dit pas d'où vient l'émission (Icom) : émission demandée par nous = CAT (1), sinon radio (2)
        if (FTX1.TX_SOURCE_UNKNOWN && p.tx === 1 && !this.catKeyed) p.tx = 2;
        if (p.tx != null) this.txReadAt = Date.now(); // dernière lecture de l'état émission / réception
        for (const k in p) {
          // Mesure d'émission arrivée après le retour en réception (lecture déjà en file) : ignorée
          if (TX_METER_KEYS.indexOf(k) >= 0 && !this.radio.tx && p.tx == null) continue;
          if (this.radio[k] !== p[k]) {
            this.radio[k] = p[k];
            this.dirty = true;
          }
        }
        // Retour en réception : les mesures d'émission n'ont plus de sens
        if (p.tx === 0) for (const k of TX_METER_KEYS) if (this.radio[k] != null) { this.radio[k] = null; this.dirty = true; }
        // Radio en "CAT TX" sans demande de notre part → on coupe
        if (p.tx === 1 && !this.catKeyed && !this.cw) {
          this._write(FTX1.cmdPtt(false));
          this.log('Sécurité : CAT TX inattendu, TX0 envoyé');
        }
        // Radio passée en émission juste après un réglage envoyé à distance (ex. SPLIT du FTX-1) : ce n'est pas
        // une émission voulue (PTT) → retour en réception, et on le signale
        if (p.tx > 0 && !this.catKeyed && this.lastCtl && Date.now() - this.lastCtl.at < (this.lastCtl.long ? 8000 : 1500)) {
          const what = this.lastCtl.id;
          this.lastCtl = null;
          this._write(FTX1.cmdPtt(false));
          if (FTX1.UNKEY_EXTRA) this._write(FTX1.UNKEY_EXTRA);
          // FTX-1 : l'émission vient de l'état FT0 + VS1 ; TX0 seul ne suffit pas, retour complet sur MAIN (VS0 puis FT0)
          if (FTX1.VIRTUAL_SPLIT && FTX1.cmdVfoSel) { this._write(FTX1.cmdVfoSel(0)); this._write(FTX1.cmdTxVfo(0)); }
          this.log('Sécurité : le TRX est passé en émission après le réglage « ' + what + ' » → retour en réception', 'st-bad');
          if (this.wsUp) this.sendWs({ t: 'safety', reason: 'le TRX est passé en émission après le réglage « ' + what + ' » : retour en réception forcé' });
        }
      }
    }

    /** Écart d'horloge mesuré par la page : heure du VPS − heure de ce PC (ms). */
    setClock(offsetMs) { if (Number.isFinite(offsetMs)) this.clockOffset = offsetMs; }

    /** Limites du chien de garde fixées par le serveur (en secondes). */
    setTxLimits(silenceS, hardMaxS) {
      if (silenceS > 0) this.txSilenceMs = silenceS * 1000;
      if (hardMaxS > 0) this.txHardMaxMs = hardMaxS * 1000;
    }

    _txWatchdog(now) {
      if (!this.radio.tx || !this.radio.connected) { this.txSince = 0; return; }
      if (!this.txSince) { this.txSince = now; this.lastMod = now; }
      // Modulation présente si la puissance de sortie dépasse ~4 % de la pleine échelle (SSB : rien sans voix)
      const po = this.radio.m5;
      if (po != null && po > (this.rig.PO_MOD_MIN || 8)) this.lastMod = now;
      const silent = now - this.lastMod > this.txSilenceMs;
      const tooLong = now - this.txSince > this.txHardMaxMs;
      if (!silent && !tooLong) return;
      const dur = (ms) => (ms >= 120000 ? Math.round(ms / 60000) + ' min' : Math.round(ms / 1000) + ' s');
      const why = silent ? 'en émission depuis ' + dur(this.txSilenceMs) + ' sans modulation' : 'en émission continue depuis ' + dur(this.txHardMaxMs);
      this._write(this.rig.cmdPtt(false));
      this._txAudioStop();
      // Manipulateur du TRX (CW) : fin de lecture et break-in coupé, que l'émission vienne de nous ou non
      if (this.rig.CW) this._cwStop(why, !this.cw);
      this.catKeyed = false;
      this.log('Sécurité : TRX ' + why + ' → retour en réception');
      if (this.wsUp) this.sendWs({ t: 'safety', reason: 'TRX ' + why + ' : retour en réception forcé' });
      // Si la radio reste bloquée (PTT physique enfoncé…), nouvel essai toutes les 10 s
      this.txSince = now - this.txHardMaxMs + 10000;
      this.lastMod = now - this.txSilenceMs + 10000;
    }

    tick() {
      const now = Date.now();
      if (this.catKeyed && now - this.lastKa > this.kaTimeoutMs) this.unkey('keepalive VPS perdu');
      if (!this.serialOpen) return;
      this._txWatchdog(now);
      // Changement de côté MAIN / SUB en cours : pas de lectures en rafale (le TRX perdrait des commandes)
      if (now < (this.pollHold || 0) || now < (this.cwHold || 0)) return;
      if (this.radio.connected && this.lastRx && now - this.lastRx > this.radioTimeoutMs) {
        this.radio.connected = false;
        this.dirty = true;
        this.log('Plus de réponse de la radio (éteinte ? mauvais port ?)');
      }
      const rig = this.rig;
      if (rig.FRAME_GAP_MS) {
        // Pilote à trames : une tranche des lectures lentes par cycle, trames espacées
        if (!this.queue.length) {
          const n = rig.SLOW_PER_TICK || 4;
          const slow = [];
          for (let i = 0; i < n * (this.forceSlow ? 2 : 1); i++) slow.push(rig.SLOW[(this.slowPos + i) % rig.SLOW.length]);
          this.slowPos = (this.slowPos + slow.length) % rig.SLOW.length;
          // Relectures prioritaires (réglage qui vient d'être modifié), puis lectures rapides, puis tranche lente
          this.queue = this.prio.concat(rig.FAST, rig.FAST_SUB || [], this.radio.tx ? rig.TXMETERS : [], slow);
          this.prio = [];
          this._drain();
        }
      } else {
        let q = rig.FAST;
        if (rig.FAST_SUB) q += [].concat(rig.FAST_SUB).join('');
        if (this.radio.tx) q += rig.TXMETERS;
        if (this.forceSlow || this.ticks % 4 === 0) q += rig.SLOW;
        this._write(q, true);
      }
      this.forceSlow = false;
      this.ticks++;
      this._push(false);
    }

    // ---------- côté VPS ----------
    wsOpened() {
      this.wsUp = true;
      this.dirty = true;
    }

    wsClosed() {
      this.wsUp = false;
      if (this.cw) this._cwStop('liaison VPS perdue', true);
      if (this.catKeyed) this.unkey('liaison VPS perdue');
    }

    onWsMessage(m) {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'txka') {
        this.lastKa = Date.now();
        return;
      }
      if (m.t !== 'cmd') return;
      const FTX1 = this.rig;
      try {
        if (m.op === 'audioprep') {
          // RTTY / JTTY : signal fabriqué par le serveur (16 bits, base64), gardé jusqu'au passage en émission
          let r;
          if (!this.txAudio || !this.txAudio.prepareSamples) r = { ok: false, err: 'cette page Station ne sait pas émettre en ' + (m.mode || 'numérique') };
          else {
            try { r = this.txAudio.prepareSamples(m.id, Number(m.rate) || 12000, String(m.data || '')); } catch (e) { r = { ok: false, err: e.message }; }
          }
          this.sendWs(Object.assign({ t: 'ftx_ready', id: m.id }, r));
          if (r.ok) this.log('Signal ' + (m.mode || '') + ' reçu (' + r.seconds.toFixed(1).replace('.', ',') + ' s)');
          else this.log('Signal ' + (m.mode || '') + ' refusé : ' + r.err, 'st-bad');
          return;
        }
        if (m.op === 'ftxprep') {
          // Message FT8 / FT4 / FT2 à émettre au prochain créneau : codé tout de suite, réponse au serveur
          let r;
          if (!this.txAudio) r = { ok: false, err: 'cette page Station ne sait pas émettre en numérique' };
          else {
            try { r = this.txAudio.prepare(m.id, m.mode, m.text, m.f0); } catch (e) { r = { ok: false, err: e.message }; }
          }
          this.sendWs(Object.assign({ t: 'ftx_ready', id: m.id }, r));
          if (r.ok) this.log('Message ' + m.mode + ' prêt : « ' + r.text + ' » (' + r.seconds.toFixed(1).replace('.', ',') + ' s, ' + m.f0 + ' Hz)');
          else this.log('Message ' + m.mode + ' refusé : ' + r.err, 'st-bad');
          return;
        }
        if (m.op === 'freq') {
          this._write(FTX1.cmdFreq(m.hz));
        } else if (m.op === 'freqB') {
          this._write(FTX1.cmdFreqB(m.hz));
        } else if (m.op === 'band') {
          this._write(FTX1.cmdBand(m.band, !!m.sub));
          this.forceSlow = true;
        } else if (m.op === 'mode') {
          this._write(FTX1.cmdMode(m.code, !!m.sub, this.radio));
        } else if (m.op === 'ctl') {
          const v = FTX1.validate(m.id, m.value, this.radio, { skipWhen: true });
          if (FTX1.CONTROL[m.id].transmits && (!this.serialOpen || !this.radio.connected)) return this.log('Refusé : radio non connectée');
          // FTX-1 : passage sur SUB. VS1 avec FT0 met le TRX en émission : FT (VFO d'émission) d'abord, relu, et VS1
          // seulement si le TRX confirme FT1 / FT3 ; sinon pas de VS1 (le TRX reste sur MAIN, en réception)
          // FTX-1 : passage sur SUB par CAT seulement si le serveur l'autorise explicitement (m.subOk)
          if (FTX1.ID === 'ftx1' && !m.subOk && ((m.id === 'vfoSel' && v === 1) || (FTX1.CONTROL[m.id].viaSub && this.radio.vfoSel !== 1) || (FTX1.CONTROL[m.id].viaMain && this.radio.vfoSel === 1))) {
            return this.log('Sécurité : passage MAIN ↔ SUB par CAT refusé (' + (FTX1.CONTROL[m.id].label || m.id) + ') — face avant du TRX', 'st-bad');
          }
          // Réception simple (FR01) : pas de changement de côté par CAT (a mis le TRX en émission au club)
          if (FTX1.ID === 'ftx1' && this.radio.dualRx !== 1 && !m.subSingle && ((m.id === 'vfoSel' && v !== (this.radio.vfoSel === 1 ? 1 : 0)) || (FTX1.CONTROL[m.id].viaSub && this.radio.vfoSel !== 1) || (FTX1.CONTROL[m.id].viaMain && this.radio.vfoSel === 1))) {
            return this.log('Sécurité : passage MAIN ↔ SUB refusé en réception simple (DUAL RX coupé) — face avant du TRX', 'st-bad');
          }
          // Changement de côté en cours (lectures suspendues, côté actif pas encore relu) : réglage propre à un côté refusé
          if ((FTX1.CONTROL[m.id].viaSub || FTX1.CONTROL[m.id].viaMain) && this.pollHold && Date.now() < this.pollHold) {
            return this.log('Changement de côté MAIN / SUB en cours : ' + (FTX1.CONTROL[m.id].label || m.id) + ' ignoré, recommencez dans quelques secondes', 'st-warn');
          }
          if (m.id === 'vfoSel' && FTX1.VIRTUAL_SPLIT && FTX1.txVfoTries) {
            this.lastCtl = { id: FTX1.CONTROL[m.id].label || m.id, at: Date.now() };
            this.forceSlow = true;
            return v === 1 ? this._toSub(m.by, 0) : this._toMain(m.by);
          }
          // Réglage du côté SUB que le CAT n'adresse qu'au côté actif (ATT / préampli du VFO B, FTX-1) :
          // passage sur SUB (sûr), commande, retour sur MAIN (VS0 puis FT0)
          if (FTX1.CONTROL[m.id].viaSub && FTX1.VIRTUAL_SPLIT && FTX1.txVfoTries) {
            const cmd = FTX1.CONTROL[m.id].write(v, this.radio);
            const done = () => { this.radio[m.id] = v; this.dirty = true; this._push(true); };
            this.lastCtl = { id: FTX1.CONTROL[m.id].label || m.id, at: Date.now() };
            this.forceSlow = true;
            if (this.radio.vfoSel === 1) { this._write(cmd); done(); return; }
            if (this.pollHold && Date.now() < this.pollHold) return this.log('Changement de côté en cours : ' + (FTX1.CONTROL[m.id].label || m.id) + ' ignoré');
            return this._toSub(m.by, 0, () => {
              this._write(cmd);
              done();
              setTimeout(() => {
                if (this.catKeyed) return;
                this.lastCtl = { id: FTX1.CONTROL[m.id].label || m.id, at: Date.now() };
                this._toMain(m.by, () => this.log(FTX1.CONTROL[m.id].label + ' : envoyé côté SUB, retour sur MAIN'));
              }, 200);
            });
          }
          // Réglage du côté MAIN que le CAT n'adresse qu'au côté actif (ATT / préampli du VFO A, FTX-1) avec SUB actif :
          // retour sur MAIN (sûr), commande, puis retour sur SUB (FT confirmé avant VS1)
          if (FTX1.CONTROL[m.id].viaMain && FTX1.VIRTUAL_SPLIT && FTX1.txVfoTries && this.radio.vfoSel === 1) {
            const cmd = FTX1.CONTROL[m.id].write(v, this.radio);
            if (this.pollHold && Date.now() < this.pollHold) return this.log('Changement de côté en cours : ' + (FTX1.CONTROL[m.id].label || m.id) + ' ignoré');
            this.lastCtl = { id: FTX1.CONTROL[m.id].label || m.id, at: Date.now() };
            this.forceSlow = true;
            return this._toMain(m.by, () => {
              this._write(cmd);
              this.radio[m.id] = v; this.dirty = true; this._push(true);
              setTimeout(() => {
                if (this.catKeyed) return;
                this.lastCtl = { id: FTX1.CONTROL[m.id].label || m.id, at: Date.now() };
                this._toSub(m.by, 0, () => this.log(FTX1.CONTROL[m.id].label + ' : envoyé côté MAIN, retour sur SUB'));
              }, 200);
            });
          }
          this._write(FTX1.CONTROL[m.id].write(v, this.radio));
          // Réglages de VFO / SPLIT : une émission qui suivrait de près n'est pas voulue (filet de sécurité, FTX-1)
          this.lastCtl = ['split', 'vfoSel', 'swap', 'aToB', 'bToA'].indexOf(m.id) >= 0 ? { id: FTX1.CONTROL[m.id].label || m.id, at: Date.now() } : null;
          this.forceSlow = true;
          this._readBack(m.id);
          if (m.id === 'rit' || m.id === 'xit') this._readBack(m.id === 'rit' ? 'xit' : 'rit');
          if (FTX1.CONTROL[m.id].transmits) this._readBack('tuner');
          if (FTX1.CONTROL[m.id].transmits) this.log(FTX1.CONTROL[m.id].label + ' (' + (m.by || '?') + ')');
        } else if (m.op === 'power') {
          this._write(FTX1.cmdPower(m.watts, this.radio.powerHead));
          this._readBack('power');
          this.log('Puissance réglée à ' + m.watts + ' W' + (m.reason ? ' (' + m.reason + ')' : ''));
        } else if (m.op === 'query') {
          // Lecture seule, commande prise dans la liste du pilote
          const cmd = String(m.cmd || '');
          if (!FTX1.CAT_QUERIES || FTX1.CAT_QUERIES.indexOf(cmd) < 0) return this.log('Lecture CAT refusée : ' + cmd.slice(0, 12));
          this.query = { cmd, prefix: cmd.replace(/;$/, ''), until: Date.now() + 2000, id: m.id };
          this._write(cmd);
        } else if (m.op === 'cw') {
          this._cwStart(m);
        } else if (m.op === 'cwprep') {
          this._cwPrep(m);
        } else if (m.op === 'exread') {
          // Lecture de menus (égaliseur du TRX) : réponses une à une, puis { menu: valeur } au serveur
          this._exRead(m.id, Array.isArray(m.cmds) ? m.cmds.slice(0, 40) : []);
        } else if (m.op === 'exwrite') {
          // Écriture de menus (égaliseur du TRX), jamais pendant une émission
          const busy = this.catKeyed || this.radio.tx || !this.serialOpen || this.exBusy;
          if (!busy) this._writeList((Array.isArray(m.cmds) ? m.cmds : []).filter((c) => /^EX\d{6}[+-]?\d{1,3};$/.test(c)).slice(0, 40));
          if (this.wsUp) this.sendWs({ t: 'exwrite_reply', id: m.id, ok: !busy });
        } else if (m.op === 'voiceoff') {
          // Main rendue, micro coupé… : source de modulation remise tout de suite (sauf en pleine émission)
          if (!this.catKeyed && this.voiceSaved) this._voiceRestoreNow(m.reason || '');
        } else if (m.op === 'cwstop') {
          this._cwStop(m.reason || 'arrêt demandé', true);
        } else if (m.op === 'ptt') {
          if (m.on) {
            if (!this.serialOpen || !this.radio.connected) return this.log('PTT refusé : radio non connectée');
            this.catKeyed = true;
            this.lastKa = Date.now();
            // Émission numérique : le signal préparé part à l'heure dite (heure du VPS ramenée à l'heure de ce PC)
            this.digiTx = m.digi && m.digi.id ? { id: m.digi.id, at: Number(m.digi.at) - this.clockOffset, started: false } : null;
            // Phonie à distance : source de modulation mise sur USB avant d'émettre
            if (m.voice) return this._voiceKey(m);
            // Autre émission juste après une émission en phonie : micro du club remis d'abord
            if (this.voiceSaved) this._voiceRestoreNow('');
            this._keyPtt(m);
          } else {
            this.unkey(m.reason || 'fin d’émission');
          }
        }
      } catch (e) {
        this.log('Commande refusée : ' + e.message);
      }
    }

    /** Passage en émission (après une éventuelle préparation de la phonie). */
    _keyPtt(m) {
      const FTX1 = this.rig;
      try {
            // SPLIT virtuel (FTX-1) : VFO d'émission envoyé juste avant d'émettre, et relu (« FT; ») avant TX1 :
            // on n'émet jamais sur un VFO que le TRX n'a pas confirmé
            // Émission sur MAIN, TRX déjà sur MAIN (FT0, VS0) : aucune commande FT / VS autour de l'émission (cas courant)
            // SPLIT (émission sur l'autre VFO) : par échange A ⇄ B, l'émission part du côté actif (FTX-1)
            const side = this.radio.vfoSel === 1 ? 1 : 0;
            if (FTX1.SPLIT_SWAP && (this.swapTx || ((m.txVfo === 0 || m.txVfo === 1) && m.txVfo !== side))) return this._swapPtt(m.by, m.txVfo);
            const already = m.txVfo === 0 && this.radio.txVfo === 0 && this.radio.vfoSel !== 1;
            if (FTX1.txVfoTries && (m.txVfo === 0 || m.txVfo === 1) && !already) {
              this.txVfoSet = true;
              this.rxVfo = this.radio.vfoSel ? 1 : 0; // VFO de réception avant l'émission (le TRX peut déplacer VS avec FT)
              this.freqsBeforeTx = { a: this.radio.freq, b: this.radio.freqB }; // remises en place après l'émission si besoin
              const n = FTX1.txVfoTries(0).length;
              const order = [this.txVfoOk || 0].concat(Array.from({ length: n }, (_, i) => i).filter((i) => i !== (this.txVfoOk || 0)));
              this._tryTxVfo(m.txVfo, m.by, order, 0);
              return;
            }
            this._write(FTX1.cmdPtt(true));
            this._checkKeyed(m.by);
            this.log('TX ON (' + (m.by || '?') + ')' + (this.voiceOn ? ' — phonie à distance' : ''));
            this._startDigi();
      } catch (e) {
        this.log('Commande refusée : ' + e.message);
      }
    }

    // ---------- phonie à distance ----------
    /** Signal d'émission arrêté (numérique ou voix de l'opérateur). */
    _txAudioStop() {
      if (this.digiTx) { this.digiTx = null; if (this.txAudio) this.txAudio.stop(); }
      this._voiceEnd();
    }
    /** Attente d'une réponse reconnue par fn (texte Yaesu ou trame Icom) : cb(valeur) ou cb(null) après ms. */
    _awaitFn(fn, ms, cb) {
      if (this.waitFn) clearTimeout(this.waitFn.timer);
      const w = { fn, cb, timer: null };
      this.waitFn = w;
      w.timer = setTimeout(() => { if (this.waitFn === w) { this.waitFn = null; cb(null); } }, ms);
    }
    /**
     * PTT en phonie à distance : menus « MOD SOURCE » du mode relus et gardés, mis sur USB, puis émission ; la voix
     * de l'opérateur arrive par la sortie son de la page Station. Au retour en réception, menus remis comme avant.
     * Rien n'est émis si un menu ne peut pas être relu (le micro du club ne doit jamais rester débranché).
     */
    _voiceKey(m) {
      const V = this.rig.VOICE;
      const mode = String(m.voice);
      const steps = V && V.steps(mode);
      const fail = (why) => {
        this.voiceJob = null;
        this.catKeyed = false;
        this.log('Phonie à distance : ' + why, 'st-bad');
        if (this.wsUp) this.sendWs({ t: 'safety', reason: 'phonie à distance : ' + why });
      };
      if (!steps) return fail('mode ' + mode + ' non prévu sur le ' + this.rig.NAME);
      if (this.exBusy) return fail('lecture de l’égaliseur du TRX en cours : réappuyez dans un instant');
      if (!this.txAudio || !this.txAudio.voiceStart || !this.txAudio.voiceReady()) return fail('aucune sortie son vers le TRX choisie sur la page Station');
      const job = { id: ++this.voiceSeq };
      this.voiceJob = job;
      const alive = () => this.voiceJob === job && this.catKeyed;
      // Nouvel appui juste après un relâchement (menus pas encore remis) : on garde les valeurs d'origine
      if (this.voiceRestoreTimer) { clearTimeout(this.voiceRestoreTimer); this.voiceRestoreTimer = null; }
      let keep = null;
      if (this.voiceSaved) {
        if (this.voiceSaved.mode === mode) keep = this.voiceSaved.restore;
        else this._voiceRestoreNow('');
      }
      const go = (restore, already) => {
        if (!alive()) return;
        this.voiceSaved = { mode, restore };
        if (!already) this._writeList(steps.map((x) => x.set));
        setTimeout(() => {
          if (!alive()) return;
          this.voiceOn = true;
          this.txAudio.voiceStart();
          this._keyPtt(m);
        }, already ? 0 : 150);
      };
      if (keep) return go(keep, true);
      const restore = [];
      const next = (i) => {
        if (!alive()) return;
        if (i >= steps.length) return go(restore);
        const x = steps[i];
        this._awaitFn(x.match, 800, (v) => {
          if (!alive()) return;
          if (v == null) return fail('le TRX n’a pas répondu à la lecture du menu ' + x.label + ' : émission annulée');
          restore.push(x.restore(v));
          next(i + 1);
        });
        this._write(x.read, true);
      };
      next(0);
    }
    /** Lecture des menus EX listés (texte Yaesu) : { 'menu à 6 chiffres': 'valeur' } envoyé au serveur. */
    _exRead(id, cmds) {
      const vals = {};
      const done = (err) => { this.exBusy = false; if (this.wsUp) this.sendWs({ t: 'exread_reply', id, values: vals, err: err || '' }); };
      if (this.catKeyed || this.radio.tx || !this.serialOpen || this.exBusy) return done('TRX occupé (émission en cours)');
      this.exBusy = true;
      const next = (i) => {
        if (i >= cmds.length) return done('');
        const mm = /^EX(\d{6});$/.exec(String(cmds[i]));
        if (!mm) return next(i + 1);
        const re = new RegExp('^EX' + mm[1] + '([+-]?\\d+)$');
        this._awaitFn((t) => { const x = typeof t === 'string' ? re.exec(t) : null; return x ? x[1] : null; }, 700, (v) => {
          if (v == null) return done('le TRX n’a pas répondu à ' + cmds[i]);
          vals[mm[1]] = v;
          next(i + 1);
        });
        this._write(cmds[i], true);
      };
      next(0);
    }
    /** Fin de la voix de l'opérateur ; menus remis après voiceHoldMs sans nouvelle émission en phonie. */
    _voiceEnd() {
      this.voiceJob = null;
      if (this.voiceOn) {
        this.voiceOn = false;
        if (this.txAudio && this.txAudio.voiceStop) this.txAudio.voiceStop();
      }
      const sv = this.voiceSaved;
      if (!sv || this.voiceRestoreTimer) return;
      this.voiceRestoreTimer = setTimeout(() => {
        this.voiceRestoreTimer = null;
        if (this.voiceSaved !== sv || this.catKeyed) return;
        this._voiceRestoreNow('');
      }, this.voiceHoldMs);
    }
    _voiceRestoreNow(why) {
      const sv = this.voiceSaved;
      if (this.voiceRestoreTimer) { clearTimeout(this.voiceRestoreTimer); this.voiceRestoreTimer = null; }
      if (!sv) return;
      this.voiceSaved = null;
      if (!this.serialOpen) { this.voiceSaved = sv; return; } // remis à la réouverture du port
      this._writeList(sv.restore);
      this.log('Phonie à distance : source de modulation remise comme avant' + (why ? ' (' + why + ')' : '') + ' — micro du club');
    }

    /**
     * SPLIT par échange A ⇄ B (FTX-1) : SV, FA relu pour confirmer l'échange, puis TX1 sur le côté actif.
     * Au relâchement (unkey) : TX0, TX relu jusqu'à TX0, puis SV de retour et FA relu.
     */
    _swapPtt(by, tv) {
      const s = this.swapTx;
      const cancel = (why) => {
        this._txAudioStop();
        this.catKeyed = false;
        this.log('Sécurité : ' + why, 'st-bad');
        if (this.wsUp) this.sendWs({ t: 'safety', reason: why });
      };
      if (s) {
        // Nouvel appui avant le retour : les VFO sont encore échangés → émission tout de suite
        if (s.swapped && s.backTimer && !s.backing) {
          clearTimeout(s.backTimer);
          s.backTimer = null;
          this._write(this.rig.cmdPtt(true));
          this._checkKeyed(by);
          this._startDigi();
          this.log('TX ON (' + (by || '?') + ') — SPLIT, VFO encore échangés');
          return;
        }
        return cancel('SPLIT : échange A ⇄ B précédent pas encore terminé, émission annulée (réessayez dans une seconde)');
      }
      const a = this.radio.freq, b = this.radio.freqB;
      if (!a || !b) return cancel('SPLIT : fréquences des VFO pas encore lues, émission annulée');
      this.swapTx = { a, b, tv, swapped: false, backTimer: null, backing: false };
      this.lastCtl = null;
      // Lectures en cours terminées d'abord (une réponse FA d'avant l'échange ne doit pas passer pour la relecture)
      this.pollHold = Date.now() + 1500;
      const w = this.swapTx;
      setTimeout(() => {
        if (this.swapTx !== w) return;
        if (!this.catKeyed) { this.swapTx = null; this.pollHold = 0; return; } // relâché avant l'échange
        this._write('SV;FA;');
        this._swapLocal();
        w.swapped = true; // vue du dashboard : VFO à leur place dès maintenant
        this._push(true);
        this._await(/^FA\d{9}$/, 900, (t) => this._swapSeen(w, t, by, cancel, 0));
      }, 70);
    }
    /** Échange A ⇄ B reporté tout de suite dans l'état gardé (sans attendre les lectures) : pas de clignotement des VFO. */
    _swapLocal() {
      const r = this.radio;
      [r.freq, r.freqB, r.mode, r.modeB, r.modeCode, r.modeCodeB] = [r.freqB, r.freq, r.modeB, r.mode, r.modeCodeB, r.modeCode];
      this.dirty = true;
    }
    _swapSeen(w, t, by, cancel, n) {
      if (this.swapTx !== w) return;
      const { a, b } = w;
      const fa = t ? Number(t.slice(2)) : null;
      if (a !== b && fa !== b) {
        // Pas encore vu échangé : une relecture (le TRX peut répondre avant d'avoir traité SV)
        if (n < 4) {
          setTimeout(() => { if (this.swapTx !== w) return; this._write('FA;'); this._await(/^FA\d{9}$/, 900, (t2) => this._swapSeen(w, t2, by, cancel, n + 1)); }, 100);
          return;
        }
        if (fa === a) { this._swapLocal(); this.swapTx = null; this.pollHold = 0; this._push(true); return cancel('SPLIT : le TRX n’a pas échangé les VFO (A ⇄ B), émission annulée'); }
        // Réponse absente : état inconnu, on considère l'échange fait (le retour relira FA)
      }
      this.pollHold = 0;
      {
        w.swapped = true;
        this.dirty = true;
        if (!this.catKeyed) return this._swapBack(0); // PTT relâché pendant l'échange
        this._write(this.rig.cmdPtt(true));
        this._checkKeyed(by);
        this._startDigi();
        this.log('TX ON (' + (by || '?') + ') — SPLIT : VFO échangés (A ⇄ B), émission sur ' + ((b / 1e6).toFixed(6)) + ' MHz');
      }
    }
    _swapBack(n) {
      const s = this.swapTx;
      if (!s) return;
      if (!s.swapped) return; // l'échange n'est pas encore confirmé : son retour le fera
      if (s.backTimer || s.backing) return;
      s.backTimer = setTimeout(() => {
        s.backTimer = null;
        if (this.catKeyed || this.swapTx !== s) return;
        s.backing = true;
        this.pollHold = Date.now() + 2500;
        this._write('TX;');
        this._await(/^TX[0-2]$/, 800, (t) => {
          if (this.swapTx !== s) return;
          if (this.catKeyed) { s.backing = false; return; }
          if (t !== 'TX0') {
            // Encore en émission (ou pas de réponse) : TX0 renvoyé, jamais d'échange pendant une émission
            this._write(this.rig.cmdPtt(false));
            s.backing = false;
            if (n < 6) return this._swapBack(n + 1);
            this.pollHold = 0;
            const why = 'SPLIT : le TRX ne confirme pas le retour en réception (' + (t || 'pas de réponse') + ') ; VFO A et B laissés échangés';
            this.log('Sécurité : ' + why, 'st-bad');
            if (this.wsUp) this.sendWs({ t: 'safety', reason: why });
            return;
          }
          this._write('SV;FA;');
          this._swapLocal();
          this.swapTx = null; // vue = état gardé, déjà remis en place
          this._push(true);
          this._await(/^FA\d{9}$/, 900, (t2) => {
            const fa = t2 ? Number(t2.slice(2)) : null;
            this.pollHold = 0;
            this.dirty = true;
            if (fa != null && fa !== s.a && s.a !== s.b) {
              const why = 'SPLIT : retour de l’échange A ⇄ B non confirmé (VFO A sur ' + (fa / 1e6).toFixed(6) + ' MHz au lieu de ' + (s.a / 1e6).toFixed(6) + ')';
              this.log(why, 'st-warn');
              if (this.wsUp) this.sendWs({ t: 'safety', reason: why });
            } else this.log('SPLIT : VFO remis en place après l’émission');
            this._push(true);
          });
        });
      }, n ? 200 : 40);
    }

    /** SPLIT virtuel : envoie une façon de désigner le VFO d'émission, relit FT, émet si confirmé, sinon essai suivant. */
    _tryTxVfo(v, by, order, k) {
      const rig = this.rig;
      if (this.ftWait) clearTimeout(this.ftWait.timer);
      this.ftWait = null;
      if (!this.catKeyed) return;
      const side = v ? 'SUB (VFO B)' : 'MAIN (VFO A)';
      if (k >= order.length) {
        // Aucune façon n'a pris : pas d'émission, retour à l'état de réception
        const seen = this.ftSeen || 'aucune réponse';
        this._txAudioStop();
        this.catKeyed = false;
        this._write(rig.cmdPtt(false));
        this._restoreTxVfo();
        const why = 'le TRX n’a pas accepté l’émission sur ' + side + ' (FT relu : ' + seen + ') : émission annulée';
        this.log('Sécurité : ' + why, 'st-bad');
        if (this.wsUp) this.sendWs({ t: 'safety', reason: why });
        return;
      }
      const i = order[k];
      // Émission sur MAIN alors que le côté SUB est actif : VS0 d'abord (FT0 avec VS1 met le FTX-1 en émission)
      const cmd = (v === 0 && rig.cmdVfoSel ? rig.cmdVfoSel(0) : '') + rig.txVfoTries(v)[i];
      this.ftSeen = null;
      this._write(cmd);
      this._write('FT;');
      this.ftWait = {
        v, by, i, cmd,
        timer: setTimeout(() => {
          if (!this.ftWait || this.ftWait.i !== i) return;
          this.log('Le TRX n’a pas pris « ' + cmd + ' » (FT relu : ' + (this.ftSeen || 'aucune réponse') + ')');
          this._tryTxVfo(v, by, order, k + 1);
        }, 450)
      };
    }

    /** Réponse « FT » reçue pendant l'attente : émission si elle confirme le VFO demandé. */
    _ftReply(t) {
      const w = this.ftWait;
      const mm = /^FT([0-3])$/.exec(t);
      if (!w || !mm) return;
      this.ftSeen = 'FT' + mm[1];
      if (+mm[1] % 2 !== w.v) return; // pas (encore) le bon VFO : on attend la relecture suivante
      clearTimeout(w.timer);
      this.ftWait = null;
      if (!this.catKeyed) return;
      if ((this.txVfoOk || 0) !== w.i) this.log('Le TRX accepte « ' + w.cmd + ' » pour choisir le VFO d’émission : retenu');
      this.txVfoOk = w.i;
      this._write(this.rig.cmdPtt(true));
      this._checkKeyed(w.by);
      this._startDigi();
      this.log('TX ON (' + (w.by || '?') + ') — émission sur ' + (w.v ? 'SUB (VFO B)' : 'MAIN (VFO A)') + ', ' + this.ftSeen + ' confirmé par le TRX');
    }

    /** FTX-1 : passage sur SUB sans jamais l'état FT0 + VS1 (émission) — FT confirmé par le TRX avant VS1. */
    /** Changement de côté MAIN / SUB en cours annulé (nouveau clic) : plus aucune commande VS / FT de l'ancien. */
    _trace(s) { if (this.sideTrace && this.sideTrace.length < 40) this.sideTrace.push('>' + s); }
    // Diagnostic : déroulé complet d'un changement de côté (commandes, réponses, état TX) envoyé au dashboard
    _diag(what) {
      const tr = this._traceText();
      if (tr && this.wsUp) this.sendWs({ t: 'trx_note', text: what + tr });
      this.log(what + tr);
    }
    _traceText() { return this.sideTrace && this.sideTrace.length ? ' [échanges : ' + this.sideTrace.join(' ') + ']' : ''; }
    _cancelSide() {
      if (this.subWait) clearTimeout(this.subWait.timer);
      this.subWait = null;
      if (this.waitRe) clearTimeout(this.waitRe.timer);
      this.waitRe = null;
      this.sideSeq = (this.sideSeq || 0) + 1;
    }
    /**
     * FTX-1 : changement de côté MAIN / SUB. Manuel CAT (FTX-1_CAT_OM_ENG_2508-C) :
     *   VS0 = côté MAIN en émission / réception, SUB en réception ; VS1 = MAIN en réception, côté SUB en émission / réception.
     * VS fait donc tout, comme la touche MAIN / SUB de la face avant. FT (FUNCTION TX) n'est pas envoyé : un FT différent
     * du côté actif met le FTX-1 en émission (constaté au club). Seulement si FT n'a pas suivi VS (état laissé par une
     * ancienne version), FT est remis sur le côté actif pour sortir de ce désaccord. Pas de commande sans effet (« ? »).
     */
    _switchSide(v, by, then) {
      this._cancelSide();
      this.sideTrace = [];
      const seq = this.sideSeq;
      const name = v ? 'Passage sur SUB' : 'Retour sur MAIN';
      this.log(name + ' (' + (by || '?') + ')');
      if (this.radio.vfoSel === v && this.radio.txVfo === v) { this.log((v ? 'Déjà sur SUB' : 'Déjà sur MAIN')); if (then) then(); return; }
      this.pollHold = Date.now() + 9000;
      setTimeout(() => {
        if (seq !== this.sideSeq || this.catKeyed) return;
        // VS seul, toujours (FT n'est jamais envoyé : FT seul a déjà mis le FTX-1 en émission) ; côté déjà bon : VS renvoyé
        const cmd = 'VS' + v + ';';
        this._trace(cmd);
        this.lastCtl = { id: 'MAIN / SUB', at: Date.now(), long: true };
        this._write(cmd);
        // État attendu retenu tout de suite (manuel : VS déplace aussi l'émetteur) : un clic rapide suivant part de là,
        // sans attendre la relecture du TRX ; la vérification ci-dessous corrige si le TRX n'a pas suivi
        this.radio.vfoSel = v;
        this.radio.txVfo = v;
        this.dirty = true;
        const check = (n) => {
          if (seq !== this.sideSeq) return;
          this._trace('VS;FT;TX;');
          this._write('VS;');
          this._write('FT;');
          this._write('TX;');
          this._await(/^VS[01]$/, 2500, (t) => {
            if (seq !== this.sideSeq) return;
            if (!t && n < 3) return check(n + 1);
            // Pas encore du bon côté (le TRX change de côté lentement, ou VS perdu) : relecture, VS renvoyé une fois
            if (t && t !== 'VS' + v && n < 4) {
              if (n === 1) { this._trace('VS' + v + '; (renvoyé)'); this._write('VS' + v + ';'); }
              return setTimeout(() => check(n + 1), 900);
            }
            setTimeout(() => {
              if (seq !== this.sideSeq) return;
              // FT relu différent du côté actif (n'a pas suivi VS) : plus de FT envoyé (risque d'émission) — signalé ci-dessous
              this.pollHold = 0;
              this._readBack('vfoSel');
              const ok = this.radio.vfoSel === v && (this.radio.txVfo == null || this.radio.txVfo === v);
              if (ok) { this._diag(name); if (then && !this.catKeyed) then(); return; }
              const why = name + ' non confirmé par le TRX (VS ' + this.radio.vfoSel + ', FT ' + this.radio.txVfo + ')' + this._traceText();
              this.log('Sécurité : ' + why, 'st-bad');
              if (this.wsUp) this.sendWs({ t: 'safety', reason: why });
            }, 400);
          });
        };
        setTimeout(() => check(0), 1200);
      }, 250);
    }
    _toSub(by, k, then) { return this._switchSide(1, by, then); }
    /** Attend une réponse du TRX (expression régulière), sinon timeout. */
    _await(re, ms, cb) {
      if (this.waitRe) clearTimeout(this.waitRe.timer);
      const w = { re, cb, timer: null };
      this.waitRe = w;
      w.timer = setTimeout(() => { if (this.waitRe === w) { this.waitRe = null; cb(null); } }, ms);
    }
    _toMain(by, then) { return this._switchSide(0, by, then); }
    _subReply(t) {
      const w = this.subWait;
      const mm = /^FT([0-3])$/.exec(t);
      if (!w || !mm) return;
      this.ftSeen = 'FT' + mm[1];
      if (+mm[1] % 2 !== 1) return; // pas encore SUB : on attend la relecture ou l'essai suivant
      clearTimeout(w.timer);
      this.subWait = null;
      if (this.catKeyed) return; // une émission a commencé entre-temps : on ne touche plus à VS
      if ((this.txVfoOk || 0) !== w.i) this.log('Le TRX accepte « ' + w.cmd + ' » pour choisir le VFO d’émission : retenu');
      this.txVfoOk = w.i;
      this._trace('VS1');
      this._write('VS1;');
      this._write('VS;');
      this._write('TX;');
      setTimeout(() => { this._write('TX;'); }, 400);
      setTimeout(() => this._diag('Passage sur SUB'), 900);
      this._readBack('vfoSel');
      this.pollHold = Date.now() + 400;
      if (w.then) setTimeout(() => { if (!this.catKeyed) w.then(); }, 150);
    }

    /**
     * Après TX1 : le TRX doit confirmer l'émission (lecture « TX; » suivante). Une commande perdue par la radio
     * (tampon CAT plein pendant les lectures) laissait le TRX en réception pendant que le signal partait :
     * TX1 renvoyé jusqu'à 3 fois, puis abandon (pas d'émission) avec un message.
     */
    _checkKeyed(by) {
      clearTimeout(this.keyTimer);
      const at = Date.now();
      let tries = 0;
      const check = () => {
        this.keyTimer = null;
        if (!this.catKeyed || !this.serialOpen) return;
        if (!(this.txReadAt > at + 40)) { if (Date.now() - at < 1500) this.keyTimer = setTimeout(check, 100); return; } // pas encore relu
        if (this.radio.tx > 0) return; // en émission
        if (++tries <= 3) {
          this.log('Le TRX n’est pas passé en émission : TX1 renvoyé (' + tries + '/3)', 'st-warn');
          this._write(this.rig.cmdPtt(true));
          this.keyTimer = setTimeout(check, 250);
          return;
        }
        const why = 'le TRX ne passe pas en émission (TX1 sans effet)';
        this.unkey(why);
        this.log('Sécurité : ' + why, 'st-bad');
        if (this.wsUp) this.sendWs({ t: 'safety', reason: why });
      };
      this.keyTimer = setTimeout(check, 150);
    }

    /** Émission numérique : lance le signal préparé une fois le TRX en émission ; fin du signal → message au serveur. */
    _startDigi() {
      const d = this.digiTx;
      if (!d || d.started) return;
      d.started = true;
      const ok = this.txAudio && this.txAudio.play(d.id, d.at, () => {
        if (this.digiTx !== d) return;
        this.digiTx = null;
        this.sendWs({ t: 'ftx_done', id: d.id });
      });
      if (!ok) {
        this.digiTx = null;
        const why = 'signal numérique introuvable ou sortie son vers le TRX indisponible';
        this.unkey(why);
        this.log('Sécurité : ' + why + ' → pas d’émission', 'st-bad');
        if (this.wsUp) this.sendWs({ t: 'safety', reason: why });
      }
    }

    /** Après une émission en SPLIT virtuel : émission et réception remises sur le VFO de réception. */
    _restoreTxVfo() {
      if (!this.txVfoSet) return;
      this.txVfoSet = false;
      const rig = this.rig;
      const rx = this.rxVfo != null ? this.rxVfo : this.radio.vfoSel ? 1 : 0;
      this.rxVfo = null;
      const ft = rig.txVfoTries ? rig.txVfoTries(rx)[this.txVfoOk || 0] : rig.cmdTxVfo(rx);
      // FT et VS remis d'un bloc, seulement ce qui change (FTX-1 : un désaccord FT / VS qui dure le met en émission,
      // une commande sans effet lui fait répondre « ? » et ignorer la suite)
      if (rig.txVfoTries && rig.cmdVfoSel) {
        const f = this.radio.txVfo === rx ? '' : ft;
        const v = this.radio.vfoSel === rx ? '' : rig.cmdVfoSel(rx);
        const cmd = rx ? f + v : v + f;
        if (cmd) this._write(cmd);
      } else if (rx === 0 && rig.cmdVfoSel) { this._write(rig.cmdVfoSel(0)); this._write(ft); }
      else { this._write(ft); if (rig.cmdVfoSel) this._write(rig.cmdVfoSel(rx)); }
    }

    unkey(reason) {
      const was = this.catKeyed;
      if (this.ftWait) { clearTimeout(this.ftWait.timer); this.ftWait = null; }
      if (this.waitFn) { const w = this.waitFn; this.waitFn = null; clearTimeout(w.timer); w.cb(null); } // lecture en cours abandonnée
      clearTimeout(this.keyTimer);
      this.keyTimer = null;
      this.catKeyed = false;
      this._write(this.rig.cmdPtt(false));
      this._txAudioStop(); // après TX0 : les menus de la phonie sont remis une fois le TRX en réception
      // SPLIT par échange A ⇄ B : retour en réception vérifié, puis échange de retour
      if (this.swapTx) this._swapBack(0);
      // SPLIT virtuel : émission et réception remises sur le VFO de réception
      if (this.txVfoSet) {
        // Le TRX repasse d'abord en réception (TX0), puis VFO de réception et d'émission remis (FT / VS)
        this.txVfoSet = false;
        // État FT / VS relu d'abord : celui gardé peut dater d'avant l'émission (le FTX-1 déplace VS avec FT pendant
        // l'émission en SPLIT). Avec un état périmé, seul FT0 partait et laissait FT0 + VS1, qui garde le FTX-1 en
        // émission sur SUB (constaté au club le 25/10 : TX qui ne retombe pas au relâchement du PTT en SPLIT).
        this.restoreTimer = setTimeout(() => {
          this.restoreTimer = null;
          if (this.catKeyed) return;
          let vs = null;
          this._write('VS;FT;');
          this._await(/^VS[01]$/, 700, (t) => {
            if (t) vs = Number(t[2]);
            this._await(/^FT[0-3]$/, 700, (t2) => {
              if (this.catKeyed) return;
              if (vs != null) this.radio.vfoSel = vs;
              if (t2) this.radio.txVfo = Number(t2[2]) % 2;
              this.txVfoSet = true;
              this._restoreTxVfo();
              // Filet de sécurité : si le TRX émet encore dans les secondes qui suivent, retour complet en réception
              this.lastCtl = { id: 'fin d’émission en SPLIT', at: Date.now(), long: true };
              setTimeout(() => { if (!this.catKeyed) this._write('TX;'); }, 400);
            });
          });
        }, 150);
        // Le TRX a pu recopier la fréquence d'un VFO sur l'autre pendant l'émission en SPLIT : on les remet comme avant
        const f = this.freqsBeforeTx;
        this.freqsBeforeTx = null;
        if (f && f.a && f.b && f.a !== f.b) {
          setTimeout(() => {
            if (this.catKeyed || !this.serialOpen) return;
            if (this.radio.freq !== f.a && this.radio.freq === this.radio.freqB) { this._write(this.rig.cmdFreq(f.a)); this.log('VFO A remis sur ' + (f.a / 1e6).toFixed(6) + ' MHz après l’émission en SPLIT'); }
            if (this.radio.freqB !== f.b && this.radio.freqB === this.radio.freq) { this._write(this.rig.cmdFreqB(f.b)); this.log('VFO B remis sur ' + (f.b / 1e6).toFixed(6) + ' MHz après l’émission en SPLIT'); }
          }, 900);
        }
      }
      if (was) this.log('TX OFF — ' + reason);
    }

    stop() {
      if (this.catKeyed) this.unkey('arrêt');
      if (this.voiceSaved) this._voiceRestoreNow('arrêt de la page');
      clearInterval(this.timer);
      this.timer = null;
      clearTimeout(this.queueTimer);
      this.queueTimer = null;
      this.queue = [];
    }

    // ---------- interne ----------
    // ---------- émission CW (manipulateur du TRX) ----------
    _writeList(list, quiet) {
      // Plusieurs commandes : texte (Yaesu) en un envoi, trames (Icom) espacées ; quiet : un refus « ? » n'est pas signalé
      if (!list || !list.length) return;
      if (typeof list[0] === 'string') return this._write(list.join(''), !!quiet);
      list.forEach((f, i) => setTimeout(() => this._write(f, !!quiet), i * (this.rig.FRAME_GAP_MS || 30)));
    }
    _cwSay(id, state, msg) { if (this.wsUp) this.sendWs({ t: 'cw_state', id, state, msg: msg || '' }); }
    /** Étape de l'émission CW : journal de la page Station et dashboard de l'opérateur (diagnostic à distance). */
    _cwInfo(job, text, cls) { this.log('CW : ' + text, cls); this._cwSay(job.id, 'info', text); }
    _cwStart(m) {
      const CW = this.rig.CW;
      if (!CW) return this._cwSay(m.id, 'error', 'émission CW par le CAT non prévue sur ce TRX');
      if (!this.serialOpen || !this.radio.connected) return this._cwSay(m.id, 'error', 'TRX non connecté');
      if (this.catKeyed || (this.radio.tx && !this.cw)) return this._cwSay(m.id, 'error', 'le TRX est déjà en émission'); // en CW : remplacement
      if (this.cw) this._cwStop('nouveau message', false);
      const text = String(m.text || '').toUpperCase().replace(/[^A-Z0-9 /?.,=+-]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text) return this._cwSay(m.id, 'error', 'rien à émettre');
      const wpm = Math.max(5, Math.min((this.rig.CW && this.rig.CW.wpmMax) || 50, Math.round(Number(m.wpm) || 22)));
      // Morceaux à la taille de la mémoire du manipulateur (Yaesu 50, Icom 30 caractères), coupés aux espaces
      const chunks = [];
      let rest = text;
      while (rest.length > CW.max) {
        let cut = rest.lastIndexOf(' ', CW.max);
        if (cut < 8) cut = CW.max;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) chunks.push(rest);
      const job = { id: m.id, timer: null, t0: Date.now() };
      this.cw = job;
      this.lastCtl = null; // l'émission qui suit est voulue : pas la sécurité « émission après un réglage »
      this.log('CW (' + (m.by || '?') + ') à ' + wpm + ' mots/min : « ' + text.slice(0, 70) + (text.length > 70 ? '…' : '') + ' »');
      this._cwRun(job, chunks, wpm).catch((e) => { if (this.cw === job) this._cwFail(job, e.message); });
    }
    /** Cache des réglages et de la mémoire déjà envoyés (oublié après 20 min, un arrêt, une erreur, le port fermé). */
    _cwCacheGet() {
      return this.cwCache && Date.now() - this.cwCache.at < 20 * 60000 ? this.cwCache : (this.cwCache = { at: Date.now() });
    }
    /** Préparation sans émission : réglages et 1er morceau du texte écrits d'avance dans la mémoire du manipulateur. */
    _cwPrep(m) {
      const CW = this.rig.CW;
      if (!CW || !CW.mem || this.cw || this.cwPrepping || !this.serialOpen || !this.radio.connected || this.catKeyed || this.radio.tx) return;
      if (CW.dtr && this.keyer && this.keyer.available()) return; // manipulation DTR : pas de mémoire
      const text = String(m.text || '').toUpperCase().replace(/[^A-Z0-9 /?.,=+-]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text) return;
      let first = text;
      if (first.length > CW.max) { let cut = first.lastIndexOf(' ', CW.max); if (cut < 8) cut = CW.max; first = first.slice(0, cut).trim(); }
      const wpm = Math.max(5, Math.min((this.rig.CW && this.rig.CW.wpmMax) || 50, Math.round(Number(m.wpm) || 22)));
      const C = this._cwCacheGet();
      if (C.wpm === wpm && C.mem === first) return;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const send = async (cmd) => {
        this.cwHold = Date.now() + 300;
        await sleep(40);
        if (this.cw) return false;
        this.cwWatch = { errs: 0 };
        this._write(cmd, true);
        await sleep(100);
        const ok = !!this.cwWatch && this.cwWatch.errs === 0;
        this.cwWatch = null;
        return ok;
      };
      this.cwPrepping = (async () => {
        if (C.wpm !== wpm) { for (const c of CW.setup(wpm)) { if (this.cw) return; await send(c); } if (this.cw) return; C.wpm = wpm; }
        if (C.mem !== first) {
          C.mem = null;
          if (this.cw) return;
          if (await send(CW.mem(first))) { C.mem = first; C.memAt = Date.now(); }
        }
      })().catch(() => {}).finally(() => { this.cwPrepping = null; });
    }
    /** Position du morceau i dans le texte complet (morceaux coupés aux espaces), envoyée au serveur. */
    _cwPos(job, chunks, i, ago) {
      let chars = 0;
      for (let k = 0; k < i; k++) chars += chunks[k].length + 1;
      if (this.wsUp) this.sendWs({ t: 'cw_state', id: job.id, state: 'pos', chars, ago: ago || 0 });
    }
    _cwSleep(job, ms) { return new Promise((res) => { job.timer = setTimeout(res, ms); }); }
    /** Envoie une commande seule et attend un éventuel refus « ? » du TRX. */
    async _cwSend(job, cmd) {
      // Lectures du relevé suspendues le temps de l'envoi : un « ? » répondu à une lecture n'est pas pris pour un refus
      this.cwHold = Date.now() + 300;
      await this._cwSleep(job, 40);
      if (this.cw !== job) return true;
      this.cwWatch = { errs: 0 };
      this._write(cmd, true);
      await this._cwSleep(job, 100);
      const ok = !this.cwWatch || this.cwWatch.errs === 0;
      this.cwWatch = null;
      return ok;
    }
    _cwLabel(cmd) { return typeof cmd === 'string' ? cmd.slice(0, 24) : Array.from(cmd.slice(4, 8), (b) => b.toString(16).padStart(2, '0')).join(' ') + '…'; }
    _cwFail(job, why) {
      if (this.cw !== job) return;
      this.log('CW : ' + why, 'st-bad');
      this._cwStop(why, true);
      this._cwSay(job.id, 'error', why);
      if (this.wsUp) this.sendWs({ t: 'trx_note', text: 'CW : ' + why });
    }
    /** Émission CW manipulée ici (ligne DTR du 2e port USB du TRX), au rythme calculé par la page. */
    async _cwRunDtr(job, text, wpm) {
      const CW = this.rig.CW;
      const K = this.keyer;
      job.dtr = true;
      // Commandes une à une, 50 ms d'écart (« ? » = déjà réglé : sans importance, pas d'attente de réponse)
      for (const c of CW.dtr.on) { this._write(c, true); await this._cwSleep(job, 50); if (this.cw !== job) return; }
      await this._cwSleep(job, 60);
      if (this.cw !== job) return;
      await K.set(false);
      // Suite des états : [manipulé, durée en points]
      const seq = [];
      const words = text.split(' ').filter(Boolean);
      words.forEach((w, wi) => {
        [...w].forEach((ch, ci) => {
          const code = MORSE[ch];
          if (!code) return;
          for (let k = 0; k < code.length; k++) {
            seq.push([true, code[k] === '.' ? 1 : 3]);
            if (k < code.length - 1) seq.push([false, 1]);
          }
          if (ci < w.length - 1) seq.push([false, 3]);
        });
        if (wi < words.length - 1) seq.push([false, 7]);
      });
      const dit = 1200 / wpm;
      const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      let t = now() + 60;
      let first = true;
      for (const [on, units] of seq) {
        const wait = t - now();
        if (wait > 1) await this._cwSleep(job, wait);
        if (this.cw !== job) return;
        await K.set(on);
        if (on && first) {
          first = false;
          this._cwPos(job, [text], 0, 0);
          this._cwInfo(job, 'manipulation par le port DTR (' + wpm + ' mots/min)');
          // Le TRX doit passer en émission au premier top (break-in) ; vérifié pendant que le texte continue
          // Essai au club : le FTX-1 ne signale pas toujours l'émission par break-in (TX0) ; on guette aussi la puissance
          // (RM5) et, faute de confirmation, on continue en le signalant (on ne coupe pas une émission peut-être réelle)
          const t0 = Date.now();
          this.cwPo = 0;
          this._cwSay(job.id, 'tx');
          const check = () => {
            if (this.cw !== job) return;
            if (this.radio.tx || this.cwPo > 0) { this._cwInfo(job, 'en émission ' + ((Date.now() - job.t0) / 1000).toFixed(1).replace('.', ',') + ' s après la demande (DTR)'); return; }
            if (Date.now() - t0 > 2500) return this._cwInfo(job, 'le TRX ne signale pas l’émission par le CAT ; manipulation DTR poursuivie (vérifier sur le TRX qu’il émet ; sinon break-in, mode CW)', 'st-warn');
            if (CW.txPoll) this._writeList(CW.txPoll, true);
            setTimeout(check, 120);
          };
          setTimeout(check, 120);
        }
        t += units * dit;
      }
      const wait = t - now();
      if (wait > 1) await this._cwSleep(job, wait);
      if (this.cw !== job) return;
      await K.set(false);
      let k = 0;
      while (this.radio.tx && k++ < 20) { await this._cwSleep(job, 150); if (this.cw !== job) return; }
      if (this.cw !== job) return;
      this.cw = null;
      for (const c of CW.dtr.off) this._write(c, true);
      this.log('CW : fin du message');
      this._cwSay(job.id, 'done');
    }
    async _cwRun(job, chunks, wpm) {
      const CW = this.rig.CW;
      if (CW.dtr && this.keyer && this.keyer.available()) return this._cwRunDtr(job, chunks.join(' '), wpm);
      // Commutation rapide : les réglages (vitesse, break-in…) et le texte de la mémoire déjà envoyés au TRX ne sont pas
      // renvoyés au message suivant (oubliés après un arrêt, une erreur, une fermeture du port ou 20 minutes)
      if (this.cwPrepping) { await this.cwPrepping; if (this.cw !== job) return; } // préparation en cours : elle s'arrête au pas suivant
      const C = this._cwCacheGet();
      if (C.wpm !== wpm) {
        for (const c of CW.setup(wpm)) {
          // « ? » = réglage déjà en place sur le FTX-1 (il refuse une commande qui ne change rien) : noté au journal seulement
          if (!(await this._cwSend(job, c))) this.log('CW : « ' + this._cwLabel(c) + ' » sans effet (réglage déjà en place ?), on continue', 'st-warn');
          if (this.cw !== job) return;
        }
        C.wpm = wpm;
      }
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const same = CW.mem && C.mem === c;
        if (CW.mem && !same) {
          C.mem = null;
          // Texte écrit dans la mémoire du manipulateur, puis relu pour vérifier
          if (!(await this._cwSend(job, CW.mem(c)))) {
            if (this.cw !== job) return;
            // Mémoire refusée avec des espaces : on envoie alors mot par mot (l'espace entre mots est fait ici)
            if (/ /.test(c)) {
              this._cwInfo(job, 'le TRX a refusé « ' + this._cwLabel(CW.mem(c)) + ' » ; envoi mot par mot', 'st-warn');
              chunks.splice(i, 1, ...c.split(' ').filter(Boolean));
              job.words = true;
              i--;
              continue;
            }
            return this._cwFail(job, 'le TRX a refusé l’écriture de la mémoire du manipulateur (« ' + this._cwLabel(CW.mem(c)) + ' »)');
          }
          if (this.cw !== job) return;
          if (CW.read && i === 0 && !this.cwReadOk) { // relecture de contrôle : une fois par session seulement
            const got = await new Promise((res) => {
              const tm = setTimeout(() => { this.cwRe = null; res(null); }, 600);
              this.cwRe = { re: CW.readRe, cb: (t) => { clearTimeout(tm); this.cwRe = null; res(t); } };
              this._write(CW.read, true);
            });
            if (this.cw !== job) return;
            this._cwInfo(job, 'mémoire écrite, relue « ' + (got == null ? 'pas de réponse' : got.slice(0, 60)) + ' »');
            if (got != null) this.cwReadOk = true;
          }
          C.mem = c;
          C.memAt = Date.now();
        }
        // Lecture de la mémoire. Essais au club (FTX-1) : la 1re lecture semble parfois ignorée, et l'état d'émission
        // (TX;) n'est peut-être pas signalé pendant la manipulation par break-in. On guette donc aussi la puissance
        // émise (RM5), on relance la lecture une seule fois (chaque lecture recommence le message), et faute de
        // confirmation on laisse jouer au lieu de couper : la lecture n'est arrêtée que sur demande.
        const plays = CW.play ? [CW.play].concat(CW.alt) : [CW.text(c)];
        // Petit délai après l'écriture de la mémoire (0.23.6 : 1 s → 0,25 s, le vrai problème était un faux refus de KY05)
        if (CW.mem) { const w = 250 - (Date.now() - (C.memAt || 0)); if (w > 0) { await this._cwSleep(job, w); if (this.cw !== job) return; } }
        const isTx = () => !!this.radio.tx || this.cwPo > 0;
        const refused = new Set();
        const nRef = {};
        let pi = Math.max(0, plays.indexOf(this.cwPlayOk));
        let keyed = false;
        let accepted = 0;
        for (let a = 0; a < 2 * plays.length + 2 && !keyed && accepted < 2; a++) {
          let pc = plays[pi % plays.length];
          for (let g = 0; g < plays.length && refused.has(pc); g++) pc = plays[++pi % plays.length];
          if (refused.has(pc)) break;
          this.cwPo = 0;
          if (!(await this._cwSend(job, pc))) {
            if (this.cw !== job) return;
            nRef[pc] = (nRef[pc] || 0) + 1;
            this._cwInfo(job, 'le TRX a refusé « ' + this._cwLabel(pc) + ' »' + (nRef[pc] < 2 ? ', nouvel essai' : ''), 'st-warn');
            if (nRef[pc] >= 2) { refused.add(pc); pi++; } else { await this._cwSleep(job, 300); if (this.cw !== job) return; }
            continue;
          }
          if (this.cw !== job) return;
          accepted++;
          // Suivi lettre par lettre sur le dashboard : ce morceau commence maintenant (≈ 0,1 s après l'envoi de la lecture)
          this._cwPos(job, chunks, i, 100);
          if (i === 0 && accepted === 1) this._cwInfo(job, 'lecture « ' + this._cwLabel(pc) + ' » acceptée par le TRX, attente de l’émission…');
          if (i > 0) { keyed = true; break; } // morceaux suivants : le TRX est déjà en émission (break-in)
          // État d'émission et puissance demandés directement au TRX toutes les 100 ms
          let k = 0;
          while (!isTx() && k++ < 16) { if (CW.txPoll) this._writeList(CW.txPoll, true); await this._cwSleep(job, 100); if (this.cw !== job) return; }
          if (isTx()) {
            keyed = true; this.cwPlayOk = pc;
            this._cwInfo(job, 'en émission ' + ((Date.now() - job.t0) / 1000).toFixed(1).replace('.', ',') + ' s après la demande' + (accepted > 1 ? ' (2e lecture)' : '') + (same ? ', mémoire déjà prête' : ''));
            break;
          }
          if (accepted === 1) {
            this._cwInfo(job, 'émission non signalée par le TRX, 2e lecture…', 'st-warn');
            if (CW.mem) { for (const c2 of CW.setup(wpm)) { await this._cwSend(job, c2); if (this.cw !== job) return; } } // break-in coupé sur le TRX ?
          }
        }
        if (this.cw !== job) return;
        if (!accepted) return this._cwFail(job, 'le TRX a refusé la lecture de la mémoire (' + plays.map((x) => '« ' + this._cwLabel(x) + ' »').join(', ') + ') — menu PC KEYING du TRX sur OFF ? mode CW ?');
        if (i === 0) {
          if (!keyed) this._cwInfo(job, 'le TRX ne signale pas l’émission par le CAT ; lecture laissée en cours (vérifier sur le TRX qu’il émet ; sinon break-in, mode CW, ou manipulation par DTR)', 'st-warn');
          this._cwSay(job.id, 'tx');
        }
        // Fin estimée du morceau, puis retour en réception (délai du break-in) avant le suivant
        await this._cwSleep(job, Math.max(0, cwMs(c, wpm) - (i === 0 ? 600 : 0)) + 400);
        if (this.cw !== job) return;
        let k = 0;
        while (this.radio.tx && k++ < (i === chunks.length - 1 ? 25 : 10)) { await this._cwSleep(job, 150); if (this.cw !== job) return; }
        if (job.words && i < chunks.length - 1) { await this._cwSleep(job, Math.round(4 * 1200 / wpm)); if (this.cw !== job) return; } // espace entre mots
      }
      if (this.cw !== job) return;
      this.cw = null;
      this.log('CW : fin du message');
      this._cwSay(job.id, 'done');
    }
    _cwStop(reason, fromServer) {
      const job = this.cw;
      if (reason !== 'nouveau message') this.cwCache = null; // remplacement : réglages et mémoire gardés
      this.cw = null;
      if (job) clearTimeout(job.timer);
      // Manipulation DTR : clé relâchée tout de suite, PC KEYING remis sur OFF
      if (this.keyer && this.keyer.available()) { try { this.keyer.set(false); } catch (e) { /* port fermé */ } }
      if (this.rig.CW && this.rig.CW.dtr && job && job.dtr) for (const c of this.rig.CW.dtr.off) this._write(c, true);
      if (this.rig.CW && (job || fromServer)) this._writeList(this.rig.CW.stop(), true); // « ? » si rien ne jouait : sans importance
      if (job) {
        this.log('CW arrêté : ' + reason);
        if (!fromServer) this._cwSay(job.id, 'stopped', reason);
      }
    }

    _write(s, poll) {
      if (!this.serialOpen) return;
      if (!poll && typeof s === 'string') this.lastCmd = { s, at: Date.now() }; // pour signaler un refus éventuel
      try {
        this.writeSerial(s);
      } catch (e) {
        this.log('Erreur écriture série : ' + e.message);
      }
    }

    _drain() {
      if (this.queueTimer) return;
      const next = () => {
        this.queueTimer = null;
        if (!this.serialOpen) { this.queue = []; return; }
        // Lectures suspendues pendant l'envoi d'une commande CW : reprise après
        const hold = (this.cwHold || 0) - Date.now();
        if (hold > 0) { this.queueTimer = setTimeout(next, hold); return; }
        const f = this.queue.shift();
        if (!f) return;
        this._write(f, true);
        if (this.queue.length) this.queueTimer = setTimeout(next, this.rig.FRAME_GAP_MS);
      };
      next();
    }

    _push(force) {
      const now = Date.now();
      if (!force && !this.dirty && now - this.lastPush < 2000) return;
      this.dirty = false;
      this.lastPush = now;
      // SPLIT par échange A ⇄ B : le dashboard voit les VFO à leur place, émission sur le VFO choisi
      const r = Object.assign({}, this.radio);
      const sw = this.swapTx;
      if (sw && sw.swapped) {
        [r.freq, r.freqB, r.mode, r.modeB, r.modeCode, r.modeCodeB] = [r.freqB, r.freq, r.modeB, r.mode, r.modeCodeB, r.modeCode];
        r.txVfo = sw.tv;
        r.swapSplit = 1;
      }
      this.onRadio(Object.assign({}, r));
      if (this.wsUp) this.sendWs({ t: 'radio', radio: Object.assign({}, r, { catKeyed: this.catKeyed }) });
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = StationCore;
  else root.StationCore = StationCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
