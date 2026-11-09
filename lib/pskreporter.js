'use strict';
/*
 * pskreporter.js — rapports de réception FT8 / FT4 / FT2 vers PSK Reporter (pskreporter.info), comme WSJT-X :
 * les stations décodées par la Remote Station (indicatif, locator, fréquence, SNR, mode, heure) sont envoyées
 * toutes les 5 minutes en IPFIX par UDP à report.pskreporter.info:4739, sous l'indicatif et le locator de la station.
 * Format : https://pskreporter.info/pskdev.html (gabarits « receiver » 0x9992 et « sender » 0x9993, entreprise 30351).
 */
const dgram = require('dgram');

const HOST = 'report.pskreporter.info';
const PORT = 4739;
const EVERY = 5 * 60000;
// Gabarits (repris de la documentation PSK Reporter) : récepteur (indicatif, locator, logiciel, antenne)
const T_RX = Buffer.from([0x00, 0x03, 0x00, 0x2C, 0x99, 0x92, 0x00, 0x04, 0x00, 0x00,
  0x80, 0x02, 0xFF, 0xFF, 0x00, 0x00, 0x76, 0x8F, 0x80, 0x04, 0xFF, 0xFF, 0x00, 0x00, 0x76, 0x8F,
  0x80, 0x08, 0xFF, 0xFF, 0x00, 0x00, 0x76, 0x8F, 0x80, 0x09, 0xFF, 0xFF, 0x00, 0x00, 0x76, 0x8F, 0x00, 0x00]);
// … émetteur entendu (indicatif, fréquence, SNR, mode, source, locator, heure)
const T_TX = Buffer.from([0x00, 0x02, 0x00, 0x3C, 0x99, 0x93, 0x00, 0x07,
  0x80, 0x01, 0xFF, 0xFF, 0x00, 0x00, 0x76, 0x8F, 0x80, 0x05, 0x00, 0x04, 0x00, 0x00, 0x76, 0x8F,
  0x80, 0x06, 0x00, 0x01, 0x00, 0x00, 0x76, 0x8F, 0x80, 0x0A, 0xFF, 0xFF, 0x00, 0x00, 0x76, 0x8F,
  0x80, 0x0B, 0x00, 0x01, 0x00, 0x00, 0x76, 0x8F, 0x80, 0x03, 0xFF, 0xFF, 0x00, 0x00, 0x76, 0x8F,
  0x00, 0x96, 0x00, 0x04]);
const str = (s) => { const b = Buffer.from(String(s || '').slice(0, 60), 'utf8'); return Buffer.concat([Buffer.from([b.length]), b]); };
const pad4 = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);
function set(id, body) {
  const h = Buffer.alloc(4);
  const all = pad4(Buffer.concat([h, body]));
  all.writeUInt16BE(id, 0);
  all.writeUInt16BE(all.length, 2);
  return all;
}

class PskReporter {
  /** o : { call(), grid(), software, antenna(), log(msg), host, port } */
  constructor(o) {
    this.o = o;
    this.q = new Map(); // « INDICATIF|bande » → rapport (le plus récent)
    this.seq = 0;
    this.dom = Math.floor(Math.random() * 0xffffffff) >>> 0;
    this.sock = null;
    this.timer = null;
    this.sent = 0;
    this.lastAt = 0;
    this.lastErr = '';
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), EVERY + Math.floor(Math.random() * 20000));
    if (this.timer.unref) this.timer.unref();
  }
  stop() { clearInterval(this.timer); this.timer = null; if (this.sock) try { this.sock.close(); } catch (e) {} this.sock = null; }
  /** Une station décodée : { call, grid, hz, snr, mode, t (ms) } */
  add(r) {
    if (!r || !/^[A-Z0-9/]{3,15}$/.test(r.call || '') || !(r.hz > 100000)) return;
    const k = r.call + '|' + Math.round(r.hz / 1e6);
    const p = this.q.get(k);
    if (p && !r.grid && p.grid) r.grid = p.grid;
    this.q.set(k, r);
    if (this.q.size > 2000) this.q.delete(this.q.keys().next().value);
  }
  packets() {
    const call = String(this.o.call() || '').toUpperCase();
    const grid = String(this.o.grid() || '').slice(0, 6);
    if (!call || !/^[A-R]{2}\d{2}/i.test(grid)) return [];
    const rx = set(0x9992, Buffer.concat([str(call), str(grid), str(this.o.software || 'RemoteStation'), str(this.o.antenna ? this.o.antenna() : '')]));
    const recs = [];
    for (const r of this.q.values()) {
      const f = Buffer.alloc(4); f.writeUInt32BE(Math.round(r.hz) >>> 0, 0);
      const snr = Buffer.alloc(1); snr.writeInt8(Math.max(-128, Math.min(127, Math.round(r.snr || 0))), 0);
      const tm = Buffer.alloc(4); tm.writeUInt32BE(Math.floor((r.t || Date.now()) / 1000) >>> 0, 0);
      recs.push(Buffer.concat([str(r.call), f, snr, str(r.mode), Buffer.from([1]), str(r.grid || ''), tm]));
    }
    this.q.clear();
    const out = [];
    let cur = [];
    let len = 0;
    const emit = () => {
      if (!cur.length) return;
      const body = Buffer.concat([T_RX, T_TX, rx, set(0x9993, Buffer.concat(cur))]);
      const h = Buffer.alloc(16);
      h.writeUInt16BE(10, 0);
      h.writeUInt16BE(16 + body.length, 2);
      h.writeUInt32BE(Math.floor(Date.now() / 1000) >>> 0, 4);
      h.writeUInt32BE(this.seq++ >>> 0, 8);
      h.writeUInt32BE(this.dom, 12);
      out.push(Buffer.concat([h, body]));
      cur = []; len = 0;
    };
    for (const r of recs) { if (len + r.length > 1200) emit(); cur.push(r); len += r.length; }
    emit();
    return out;
  }
  flush() {
    const list = this.packets();
    if (!list.length) return;
    if (!this.sock) { this.sock = dgram.createSocket('udp4'); this.sock.on('error', (e) => { this.lastErr = e.message; }); this.sock.unref(); }
    for (const p of list) {
      this.sock.send(p, this.o.port || PORT, this.o.host || HOST, (e) => { if (e) { this.lastErr = e.message; this.o.log && this.o.log('PSK Reporter : ' + e.message); } });
      this.sent++;
    }
    this.lastAt = Date.now();
  }
}
module.exports = { PskReporter };
