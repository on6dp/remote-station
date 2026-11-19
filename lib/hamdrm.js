'use strict';
/*
 * hamdrm.js — reconstruction des fichiers HamDRM (EasyPal, QSSTV) à partir des paquets MSC décodés par drmd
 * (lib/bin/drmd, cœur DRM de QSSTV). Même logique que le sourceDecoder de QSSTV (ON4QZ, GPL v3) :
 *   paquet MSC (CRC 16) → groupe de données (en-tête, numéro de segment, identifiant de transport) → objet MOT
 *   (en-tête : taille, nom du fichier ; corps : segments) → fichier, dès que tous les segments sont là
 *   (fichiers .rs1 à .rs4 : dès 63 % des segments, la correction Reed-Solomon recalculant les manquants).
 *
 * Événements : onEvent({ t:'head', tid, name, size }) · ({ t:'prog', tid, name, got, total })
 *              ({ t:'file', tid, name, data: Buffer, erasures: [total, segSize, manquants…], rs: 0..4 })
 */

/** CRC 16 du DRM (CCITT, départ 0xFFFF) : les 2 derniers octets portent le complément du CRC des autres */
function crcOk(b) {
  if (b.length < 3) return false;
  let c = 0xFFFF;
  for (let i = 0; i < b.length - 2; i++) {
    c ^= b[i] << 8;
    for (let j = 0; j < 8; j++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
  }
  return ((c ^ 0xFFFF) & 0xFFFF) === ((b[b.length - 2] << 8) | b[b.length - 1]);
}

class MotDecoder {
  constructor(onEvent) {
    this.on = onEvent || (() => {});
    this.hold = null; // morceaux du groupe de données en cours
    this.ci = -1;
    this.tb = new Map(); // identifiant de transport → objet en cours
  }
  /** Paquet MSC (Buffer, CRC compris) */
  packet(buf, crcGood) {
    if (!buf || buf.length < 3) return;
    const h = buf[0];
    const first = !!(h & 0x80), last = !!(h & 0x40), ppi = !!(h & 0x08), ci = h & 7;
    let data;
    if (ppi && crcGood) data = buf.subarray(2, 2 + buf[1]);
    else data = buf.subarray(1, buf.length - 2);
    if (!crcGood) { this.ci = -1; this.hold = null; return; }
    if (first) { this.hold = []; this.ci = ci; }
    else {
      if (this.ci < 0 || !this.hold) return;
      this.ci = (this.ci + 1) % 8;
      if (ci !== this.ci) { this.ci = -1; this.hold = null; return; }
    }
    this.hold.push(Buffer.from(data));
    if (last) { const g = Buffer.concat(this.hold); this.hold = null; this.group(g); }
  }
  group(g) {
    if (g.length < 4) return;
    const h = g[0];
    const ext = !!(h & 0x80), crc = !!(h & 0x40), sess = !!(h & 0x20), user = !!(h & 0x10), type = h & 0x0F;
    if (crc) { if (!crcOk(g)) return; g = g.subarray(0, g.length - 2); }
    let p = 2;
    if (ext) p += 2;
    let seg = 0, lastSeg = false;
    if (sess) { seg = ((g[p] & 0x7F) << 8) | g[p + 1]; lastSeg = !!(g[p] & 0x80); p += 2; }
    let tid = 0xFFFF;
    if (user) {
      const u = g[p]; p += 1;
      const len = u & 0x0F;
      if ((u & 0x10) && len >= 2) tid = (g[p] << 8) | g[p + 1];
      p += len;
    }
    if (p + 2 > g.length) return;
    const segSize = ((g[p] & 0x1F) << 8) | g[p + 1];
    p += 2;
    const body = g.subarray(p);
    if (type === 3) this.header(tid, body);
    else if (type === 4) this.data(tid, seg, lastSeg, segSize, body);
  }
  obj(tid) {
    let o = this.tb.get(tid);
    if (!o) {
      o = { tid, name: '', size: 0, head: false, segs: [], segSize: 0, total: 0, lastSeen: false, done: false, at: Date.now() };
      this.tb.set(tid, o);
      // pas plus de 5 transferts suivis à la fois
      if (this.tb.size > 5) { const old = [...this.tb.values()].sort((a, b) => a.at - b.at)[0]; this.tb.delete(old.tid); }
    }
    o.at = Date.now();
    return o;
  }
  header(tid, b) {
    if (b.length < 7) return;
    const o = this.obj(tid);
    if (o.done) return;
    o.size = (b[0] << 20) + (b[1] << 12) + (b[2] << 4) + ((b[3] & 0xF0) >> 4);
    let p = 7;
    // paramètres de l'en-tête MOT : 2 bits PLI puis 6 bits d'identifiant
    while (p < b.length) {
      const pli = b[p] >> 6, id = b[p] & 0x3F;
      p++;
      let len = 0;
      if (pli === 1) len = 1;
      else if (pli === 2) len = 4;
      else if (pli === 3) {
        if (p >= b.length) break;
        if (b[p] & 0x80) { len = ((b[p] & 0x7F) << 8) | b[p + 1]; p += 2; } else { len = b[p] & 0x7F; p += 1; }
      }
      if (id === 12 && len > 1) o.name = b.subarray(p + 1, p + len).toString('latin1').replace(/[^\x20-\x7E]/g, '').replace(/[/\\]/g, '_').slice(0, 120);
      p += len;
    }
    o.head = true;
    this.on({ t: 'head', tid, name: o.name, size: o.size });
    this.check(o);
  }
  data(tid, seg, last, segSize, body) {
    const o = this.obj(tid);
    if (o.done) return;
    if (last) { o.total = seg + 1; o.lastSeen = true; } else o.segSize = segSize;
    if (o.total < seg + 1) o.total = seg + 1;
    if (!o.segs[seg]) o.segs[seg] = Buffer.from(body);
    this.check(o);
  }
  check(o) {
    const got = o.segs.filter(Boolean).length;
    this.on({ t: 'prog', tid: o.tid, name: o.name, got, total: o.total });
    if (!o.head || !o.lastSeen || o.done || !o.total) return;
    const rs = /\.rs([1-4])$/i.exec(o.name);
    const complete = got >= o.total;
    if (!complete && !(rs && got * 100 / o.total >= 63)) return;
    const er = [o.total, o.segSize];
    const parts = [];
    for (let i = 0; i < o.total; i++) {
      if (o.segs[i]) parts.push(o.segs[i]);
      else { er.push(i); parts.push(Buffer.alloc(o.segSize)); }
    }
    const data = Buffer.concat(parts);
    // fichier sans Reed-Solomon : complet seulement ; avec : la correction dira si les manquants sont rattrapables
    if (rs && !complete) {
      if (o.triedAt === got) return; // même nombre de segments : déjà essayé
      o.triedAt = got;
    }
    if (!rs || complete) o.done = true;
    this.on({ t: 'file', tid: o.tid, name: o.name, data, erasures: er, rs: rs ? Number(rs[1]) : 0, complete });
  }
  /** Fichier Reed-Solomon reconstitué avec succès : on n'y revient plus */
  finish(tid) { const o = this.tb.get(tid); if (o) o.done = true; }
}

module.exports = { MotDecoder, crcOk };
