/*
 * station-core.js — logique de la page Station (au club), indépendante du transport.
 * Relie le port CAT du FTX-1 (Web Serial) au serveur VPS (WebSocket).
 *
 * Sécurités côté station :
 *  - TX0 si plus de "keepalive" du VPS pendant une émission (perte réseau, VPS planté…)
 *  - TX0 si la liaison WebSocket tombe pendant une émission
 *  - TX0 si la radio est en "CAT TX" alors que la station n'a rien demandé (ex. après rechargement)
 */
(function (root) {
  'use strict';
  const FTX1 = (typeof module !== 'undefined' && module.exports) ? require('./ftx1.js') : root.FTX1;

  class StationCore {
    /**
     * @param {object} o
     * @param {(s:string)=>void} o.writeSerial  envoie une chaîne CAT à la radio
     * @param {(obj:object)=>void} o.sendWs     envoie un message JSON au VPS
     * @param {(msg:string)=>void} [o.log]
     * @param {(radio:object)=>void} [o.onRadio]
     */
    constructor(o) {
      this.writeSerial = o.writeSerial;
      this.sendWs = o.sendWs;
      this.log = o.log || function () {};
      this.onRadio = o.onRadio || function () {};
      this.pollMs = o.pollMs || 250;
      this.kaTimeoutMs = o.kaTimeoutMs || 2000;
      this.radioTimeoutMs = o.radioTimeoutMs || 3000;
      this.split = new FTX1.Splitter();
      this.radio = { connected: false, freq: null, mode: null, modeCode: null, tx: 0, smeter: 0 };
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
      this.split = new FTX1.Splitter();
      this.lastRx = 0;
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
      for (const t of toks) {
        const p = FTX1.parse(t);
        if (!p) continue;
        this.lastRx = Date.now();
        if (!this.radio.connected) {
          this.radio.connected = true;
          this.dirty = true;
          this.log('FTX-1 répond');
        }
        if (p.error) continue;
        for (const k in p) {
          if (this.radio[k] !== p[k]) {
            this.radio[k] = p[k];
            this.dirty = true;
          }
        }
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
        this.log('Plus de réponse du FTX-1 (radio éteinte ? mauvais port ?)');
      }
      this._write(FTX1.POLL);
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
      try {
        if (m.op === 'freq') {
          this._write(FTX1.cmdFreq(m.hz));
        } else if (m.op === 'mode') {
          this._write(FTX1.cmdMode(m.code));
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
      this._write(FTX1.cmdPtt(false));
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
