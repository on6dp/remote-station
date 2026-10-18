/*
 * station-core.js — logique de la page Station (au club), indépendante du transport.
 * Relie le port CAT du transceiver (Web Serial) au serveur VPS (WebSocket), via un pilote de radio (ex. ftx1.js).
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
     * @param {(s:string)=>void} o.writeSerial  envoie une chaîne CAT à la radio
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
      this.pollMs = o.pollMs || 250;
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
    }

    // ---------- côté série ----------
    serialOpened() {
      this.serialOpen = true;
      this.split = new this.rig.Splitter();
      this.lastRx = 0;
      this.forceSlow = true;
      this._write('AI0;'); // pas d'auto-information : on travaille en polling
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

    onSerialData(text) {
      const toks = this.split.push(text);
      const FTX1 = this.rig;
      for (const t of toks) {
        const p = FTX1.parse(t);
        if (!p) continue;
        this.lastRx = Date.now();
        if (!this.radio.connected) {
          this.radio.connected = true;
          this.dirty = true;
          this.log(FTX1.NAME + ' répond');
        }
        if (p.error) continue;
        for (const k in p) {
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
      let q = rig.FAST;
      if (this.radio.tx) q += rig.TXMETERS;
      if (this.forceSlow || this.ticks % 4 === 0) q += rig.SLOW;
      this.forceSlow = false;
      this.ticks++;
      this._write(q);
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
          this._write(FTX1.cmdMode(m.code, !!m.sub));
        } else if (m.op === 'ctl') {
          const v = FTX1.validate(m.id, m.value, this.radio, { skipWhen: true });
          if (FTX1.CONTROL[m.id].transmits && (!this.serialOpen || !this.radio.connected)) return this.log('Refusé : radio non connectée');
          this._write(FTX1.CONTROL[m.id].write(v, this.radio));
          this.forceSlow = true;
          if (FTX1.CONTROL[m.id].transmits) this.log(FTX1.CONTROL[m.id].label + ' (' + (m.by || '?') + ')');
        } else if (m.op === 'power') {
          this._write(FTX1.cmdPower(m.watts, this.radio.powerHead));
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
