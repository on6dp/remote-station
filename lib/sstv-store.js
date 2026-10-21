'use strict';
/*
 * sstv-store.js — images SSTV reçues : les 12 dernières en mémoire, chaque image terminée enregistrée
 * en PNG dans le dossier sstv/ (les 200 dernières sont gardées) et relue au démarrage du serveur.
 * Encodeur / lecteur PNG minimal (RGB 8 bits, sans filtre) avec zlib de Node.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function pngEncode(w, h, rgb, text) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  if (text) parts.push(chunk('tEXt', Buffer.from('Comment\0' + text, 'latin1')));
  parts.push(chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
// Lecture des PNG écrits par pngEncode (RGB 8 bits ; filtres PNG gérés au cas où)
function pngDecode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let p = 8;
  let w = 0, h = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); if (data[8] !== 8 || data[9] !== 2) return null; }
    else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const st = w * 3;
  const out = new Uint8Array(st * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (st + 1)];
    for (let x = 0; x < st; x++) {
      const v = raw[y * (st + 1) + 1 + x];
      const a = x >= 3 ? out[y * st + x - 3] : 0;
      const b = y ? out[(y - 1) * st + x] : 0;
      const c = x >= 3 && y ? out[(y - 1) * st + x - 3] : 0;
      let pr = 0;
      if (f === 1) pr = a;
      else if (f === 2) pr = b;
      else if (f === 3) pr = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c; const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * st + x] = (v + pr) & 255;
    }
  }
  return { w, h, rgb: out };
}

class SstvStore {
  constructor(dir, onLog) {
    this.dir = dir;
    this.log = onLog || (() => {});
    this.items = [];            // { id, mode, name, w, h, at, lines, done, ok, rgb, file }
    this.seq = Math.floor(Date.now() / 1000) % 1000000000;
    this.byWorker = new Map();  // identifiant du décodeur → image
    this.load();
  }
  load() {
    try {
      const files = fs.readdirSync(this.dir).filter((f) => /^\d{8}-\d{6}-[A-Z0-9]+\.png$/.test(f)).sort().slice(-12);
      for (const f of files) {
        const img = pngDecode(fs.readFileSync(path.join(this.dir, f)));
        if (!img) continue;
        const m = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)-([A-Z0-9]+)/.exec(f);
        const at = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        this.items.push({ id: ++this.seq, mode: m[7], name: m[7], w: img.w, h: img.h, at, lines: img.h, done: true, ok: true, rgb: img.rgb, file: f });
      }
    } catch (e) { /* pas encore de dossier */ }
  }
  meta(it) { return { id: it.id, mode: it.mode, name: it.name, w: it.w, h: it.h, at: it.at, lines: it.lines, done: it.done, ok: it.ok }; }
  // Galerie : petite vignette (64 points de large, RGB en base64) avec chaque image
  thumb(it) {
    const tw = 64;
    const th = Math.max(1, Math.round((it.h * tw) / it.w));
    const out = Buffer.alloc(tw * th * 3);
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const sx = Math.floor((x * it.w) / tw);
        const sy = Math.floor((y * it.h) / th);
        for (let c = 0; c < 3; c++) out[(y * tw + x) * 3 + c] = it.rgb[(sy * it.w + sx) * 3 + c];
      }
    }
    return { w: tw, h: th, b64: out.toString('base64') };
  }
  list() { return this.items.map((it) => Object.assign(this.meta(it), { thumb: this.thumb(it) })); }
  get(id) { return this.items.find((it) => it.id === id); }
  start(e) {
    const it = { id: ++this.seq, mode: e.mode, name: e.name, w: e.w, h: e.h, at: Date.now(), lines: 0, done: false, ok: false, rgb: new Uint8Array(e.w * e.h * 3) };
    this.byWorker.set(e.id, it);
    this.items.push(it);
    while (this.items.length > 12) this.items.shift();
    return it;
  }
  line(e) {
    const it = this.byWorker.get(e.id);
    if (!it) return null;
    it.rgb.set(e.rgb, e.y * it.w * 3);
    it.lines = Math.max(it.lines, e.y + 1);
    return it;
  }
  end(e) {
    const it = this.byWorker.get(e.id);
    if (!it) return null;
    this.byWorker.delete(e.id);
    if (e.rgb) it.rgb = new Uint8Array(e.rgb);
    it.done = true;
    it.ok = !!e.ok;
    it.lines = Math.max(it.lines, e.lines || 0);
    // Image d'au moins un quart : enregistrée
    if (it.lines >= it.h / 4) this.save(it);
    return it;
  }
  save(it) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const d = new Date(it.at);
      const p2 = (n) => String(n).padStart(2, '0');
      const f = d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + '-' + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + '-' + it.mode + '.png';
      fs.writeFileSync(path.join(this.dir, f), pngEncode(it.w, it.h, it.rgb, 'SSTV ' + it.name + ' ' + d.toISOString() + ' - ON5VL / OR0L Remote Station UBA-LGE'));
      it.file = f;
      const all = fs.readdirSync(this.dir).filter((x) => x.endsWith('.png')).sort();
      for (const old of all.slice(0, Math.max(0, all.length - 200))) fs.unlinkSync(path.join(this.dir, old));
    } catch (e) { this.log('SSTV : image non enregistrée (' + e.message + ')'); }
  }
  /** Trame binaire d'une ligne : [0x11, id (4 octets), y (2), largeur (2), RGB…] */
  frame(it, y) {
    const n = it.w * 3;
    const b = Buffer.allocUnsafe(9 + n);
    b[0] = 0x11;
    b.writeUInt32BE(it.id, 1);
    b.writeUInt16BE(y, 5);
    b.writeUInt16BE(it.w, 7);
    Buffer.from(it.rgb.buffer, it.rgb.byteOffset + y * n, n).copy(b, 9);
    return b;
  }
}

module.exports = { SstvStore, pngEncode, pngDecode };
