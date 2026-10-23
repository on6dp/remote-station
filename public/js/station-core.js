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
    }

    serialClosed() {
      this.serialOpen = false;
      if (this.digiTx) { this.digiTx = null; if (this.txAudio) this.txAudio.stop(); }
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
        if (this.waitRe && typeof t === 'string' && this.waitRe.re.test(t)) { const w = this.waitRe; this.waitRe = null; clearTimeout(w.timer); w.cb(t); }
        const p = FTX1.parse(t);
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
        if (p.tx === 1 && !this.catKeyed) {
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
      if (this.digiTx) { this.digiTx = null; if (this.txAudio) this.txAudio.stop(); }
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
      if (now < (this.pollHold || 0)) return;
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
          this.queue = this.prio.concat(rig.FAST, this.radio.tx ? rig.TXMETERS : [], slow);
          this.prio = [];
          this._drain();
        }
      } else {
        let q = rig.FAST;
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
        } else if (m.op === 'ptt') {
          if (m.on) {
            if (!this.serialOpen || !this.radio.connected) return this.log('PTT refusé : radio non connectée');
            this.catKeyed = true;
            this.lastKa = Date.now();
            // Émission numérique : le signal préparé part à l'heure dite (heure du VPS ramenée à l'heure de ce PC)
            this.digiTx = m.digi && m.digi.id ? { id: m.digi.id, at: Number(m.digi.at) - this.clockOffset, started: false } : null;
            // SPLIT virtuel (FTX-1) : VFO d'émission envoyé juste avant d'émettre, et relu (« FT; ») avant TX1 :
            // on n'émet jamais sur un VFO que le TRX n'a pas confirmé
            // Émission sur MAIN, TRX déjà sur MAIN (FT0, VS0) : aucune commande FT / VS autour de l'émission (cas courant)
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
            this.log('TX ON (' + (m.by || '?') + ')');
            this._startDigi();
          } else {
            this.unkey(m.reason || 'fin d’émission');
          }
        }
      } catch (e) {
        this.log('Commande refusée : ' + e.message);
      }
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
        if (this.digiTx) { this.digiTx = null; if (this.txAudio) this.txAudio.stop(); }
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
      if (tr && this.wsUp) this.sendWs({ t: 'diag', text: what + tr });
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
        // Côté actif déjà bon mais FT en désaccord : remettre FT d'accord ; sinon VS seul
        const cmd = this.radio.vfoSel === v ? this.rig.txVfoTries(v)[this.txVfoOk || 0] : 'VS' + v + ';';
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
            setTimeout(() => {
              if (seq !== this.sideSeq) return;
              // FT relu différent du côté actif (n'a pas suivi VS) : remis d'accord, puis nouvelle vérification
              if (this.radio.vfoSel === v && this.radio.txVfo != null && this.radio.txVfo !== v && n < 3) {
                const f = this.rig.txVfoTries(v)[this.txVfoOk || 0];
                this._trace(f + ' (FT n’a pas suivi)');
                this._write(f);
                return setTimeout(() => check(n + 1), 800);
              }
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
      if (this.digiTx) { this.digiTx = null; if (this.txAudio) this.txAudio.stop(); }
      clearTimeout(this.keyTimer);
      this.keyTimer = null;
      this.catKeyed = false;
      this._write(this.rig.cmdPtt(false));
      // SPLIT virtuel : émission et réception remises sur le VFO de réception
      if (this.txVfoSet) {
        // Le TRX repasse d'abord en réception (TX0), puis VFO de réception et d'émission remis (FT / VS)
        this.txVfoSet = false;
        this.restoreTimer = setTimeout(() => { this.restoreTimer = null; if (!this.catKeyed) { this.txVfoSet = true; this._restoreTxVfo(); } }, 150);
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
      clearInterval(this.timer);
      this.timer = null;
      clearTimeout(this.queueTimer);
      this.queueTimer = null;
      this.queue = [];
    }

    // ---------- interne ----------
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
      this.onRadio(Object.assign({}, this.radio));
      if (this.wsUp) this.sendWs({ t: 'radio', radio: Object.assign({}, this.radio, { catKeyed: this.catKeyed }) });
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = StationCore;
  else root.StationCore = StationCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
