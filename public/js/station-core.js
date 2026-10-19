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
      }
    }

    tick() {
      const now = Date.now();
      if (this.catKeyed && now - this.lastKa > this.kaTimeoutMs) this.unkey('keepalive VPS perdu');
      if (!this.serialOpen) return;
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
        this._write(q);
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
        } else if (m.op === 'mode') {
          this._write(FTX1.cmdMode(m.code, !!m.sub, this.radio));
        } else if (m.op === 'ctl') {
          const v = FTX1.validate(m.id, m.value, this.radio, { skipWhen: true });
          if (FTX1.CONTROL[m.id].transmits && (!this.serialOpen || !this.radio.connected)) return this.log('Refusé : radio non connectée');
          this._write(FTX1.CONTROL[m.id].write(v, this.radio));
          this.forceSlow = true;
          this._readBack(m.id);
          if (m.id === 'rit' || m.id === 'xit') this._readBack(m.id === 'rit' ? 'xit' : 'rit');
          if (FTX1.CONTROL[m.id].transmits) this._readBack('tuner');
          if (FTX1.CONTROL[m.id].transmits) this.log(FTX1.CONTROL[m.id].label + ' (' + (m.by || '?') + ')');
        } else if (m.op === 'power') {
          this._write(FTX1.cmdPower(m.watts, this.radio.powerHead));
          this._readBack('power');
          this.log('Puissance réglée à ' + m.watts + ' W' + (m.reason ? ' (' + m.reason + ')' : ''));
        } else if (m.op === 'ptt') {
          if (m.on) {
            if (!this.serialOpen || !this.radio.connected) return this.log('PTT refusé : radio non connectée');
            this.catKeyed = true;
            this.lastKa = Date.now();
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

    unkey(reason) {
      const was = this.catKeyed;
      this.catKeyed = false;
      this._write(this.rig.cmdPtt(false));
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
    _write(s) {
      if (!this.serialOpen) return;
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
        this._write(f);
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
