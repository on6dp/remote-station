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
      const r = this.rig.readFor && this.rig.readFor(id);
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
        if (this.query && typeof t === 'string' && t.slice(0, 2) === this.query.prefix && Date.now() < this.query.until) {
          if (this.wsUp) this.sendWs({ t: 'cat_reply', cmd: this.query.cmd, reply: t + ';', id: this.query.id });
          this.query = null;
        }
        if (this.ftWait && typeof t === 'string') this._ftReply(t);
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
        // Radio qui ne dit pas d'où vient l'émission (Icom) : émission demandée par nous = CAT (1), sinon radio (2)
        if (FTX1.TX_SOURCE_UNKNOWN && p.tx === 1 && !this.catKeyed) p.tx = 2;
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
        if (p.tx > 0 && !this.catKeyed && this.lastCtl && Date.now() - this.lastCtl.at < 1500) {
          const what = this.lastCtl.id;
          this.lastCtl = null;
          this._write(FTX1.cmdPtt(false));
          if (FTX1.UNKEY_EXTRA) this._write(FTX1.UNKEY_EXTRA);
          this.log('Sécurité : le TRX est passé en émission après le réglage « ' + what + ' » → retour en réception', 'st-bad');
          if (this.wsUp) this.sendWs({ t: 'safety', reason: 'le TRX est passé en émission après le réglage « ' + what + ' » : retour en réception forcé' });
        }
      }
    }

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
          this.query = { cmd, prefix: cmd.slice(0, 2), until: Date.now() + 2000, id: m.id };
          this._write(cmd);
        } else if (m.op === 'ptt') {
          if (m.on) {
            if (!this.serialOpen || !this.radio.connected) return this.log('PTT refusé : radio non connectée');
            this.catKeyed = true;
            this.lastKa = Date.now();
            // SPLIT virtuel (FTX-1) : VFO d'émission envoyé juste avant d'émettre, et relu (« FT; ») avant TX1 :
            // on n'émet jamais sur un VFO que le TRX n'a pas confirmé
            if (FTX1.txVfoTries && (m.txVfo === 0 || m.txVfo === 1)) {
              this.txVfoSet = true;
              this.rxVfo = this.radio.vfoSel ? 1 : 0; // VFO de réception avant l'émission (le TRX peut déplacer VS avec FT)
              this.freqsBeforeTx = { a: this.radio.freq, b: this.radio.freqB }; // remises en place après l'émission si besoin
              const n = FTX1.txVfoTries(0).length;
              const order = [this.txVfoOk || 0].concat(Array.from({ length: n }, (_, i) => i).filter((i) => i !== (this.txVfoOk || 0)));
              this._tryTxVfo(m.txVfo, m.by, order, 0);
              return;
            }
            this._write(FTX1.cmdPtt(true));
            this.log('TX ON (' + (m.by || '?') + ')');
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
        this.catKeyed = false;
        this._write(rig.cmdPtt(false));
        this._restoreTxVfo();
        const why = 'le TRX n’a pas accepté l’émission sur ' + side + ' (FT relu : ' + seen + ') : émission annulée';
        this.log('Sécurité : ' + why, 'st-bad');
        if (this.wsUp) this.sendWs({ t: 'safety', reason: why });
        return;
      }
      const i = order[k];
      const cmd = rig.txVfoTries(v)[i];
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
      this.log('TX ON (' + (w.by || '?') + ') — émission sur ' + (w.v ? 'SUB (VFO B)' : 'MAIN (VFO A)') + ', ' + this.ftSeen + ' confirmé par le TRX');
    }

    /** Après une émission en SPLIT virtuel : émission et réception remises sur le VFO de réception. */
    _restoreTxVfo() {
      if (!this.txVfoSet) return;
      this.txVfoSet = false;
      const rig = this.rig;
      const rx = this.rxVfo != null ? this.rxVfo : this.radio.vfoSel ? 1 : 0;
      this.rxVfo = null;
      this._write(rig.txVfoTries ? rig.txVfoTries(rx)[this.txVfoOk || 0] : rig.cmdTxVfo(rx));
      if (rig.cmdVfoSel) this._write(rig.cmdVfoSel(rx));
    }

    unkey(reason) {
      const was = this.catKeyed;
      if (this.ftWait) { clearTimeout(this.ftWait.timer); this.ftWait = null; }
      this.catKeyed = false;
      this._write(this.rig.cmdPtt(false));
      // SPLIT virtuel : émission et réception remises sur le VFO de réception
      if (this.txVfoSet) {
        this._restoreTxVfo();
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
