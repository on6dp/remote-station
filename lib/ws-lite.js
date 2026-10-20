'use strict';
/*
 * ws-lite — serveur WebSocket minimal (RFC 6455), sans dépendance.
 * Gère : trames texte et binaires, fragmentation, ping/pong, fermeture propre.
 * Les trames client doivent être masquées (comme l'exige la norme).
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WsConn extends EventEmitter {
  constructor(socket, req, opts) {
    super();
    this.socket = socket;
    this.req = req;
    this.maxPayload = (opts && opts.maxPayload) || 65536;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.fragOp = 0;
    this.fragLen = 0;
    this.open = true;
    this.isAlive = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => { if (!this.closeBy) this.closeBy = 'réseau (connexion coupée sans fermeture)'; this._closed(); });
    socket.on('error', (e) => { if (!this.closeBy) this.closeBy = 'erreur réseau ' + (e && e.code ? e.code : ''); this._closed(); });
  }

  _onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        if (b.readUInt32BE(2) !== 0) return this.close(1009, 'trop gros');
        len = b.readUInt32BE(6);
        off = 10;
      }
      if (!masked) return this.close(1002, 'trame non masquée');
      if (len > this.maxPayload) return this.close(1009, 'trop gros');
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      off += 4;
      const payload = Buffer.from(b.subarray(off, off + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + len);
      this._frame(fin, op, payload);
    }
  }

  _frame(fin, op, p) {
    switch (op) {
      case 0x8: // close
        this.closeBy = 'client';
        this.closeCode = p.length >= 2 ? p.readUInt16BE(0) : 1005;
        this._send(0x8, p.subarray(0, 2));
        return this._end();
      case 0x9: // ping
        return this._send(0xa, p);
      case 0xa: // pong
        this.isAlive = true;
        return;
      case 0x0: // continuation
        if (!this.frag) return this.close(1002, 'continuation inattendue');
        this.frag.push(p);
        this.fragLen += p.length;
        if (this.fragLen > this.maxPayload) return this.close(1009, 'trop gros');
        if (fin) {
          const all = Buffer.concat(this.frag);
          const o = this.fragOp;
          this.frag = null;
          this.fragLen = 0;
          this._msg(o, all);
        }
        return;
      case 0x1: // texte
      case 0x2: // binaire
        if (this.frag) return this.close(1002, 'fragment interrompu');
        if (fin) return this._msg(op, p);
        this.frag = [p];
        this.fragOp = op;
        this.fragLen = p.length;
        return;
      default:
        return this.close(1002, 'opcode inconnu');
    }
  }

  _msg(op, p) {
    this.isAlive = true;
    if (op === 0x1) this.emit('message', p.toString('utf8'), false);
    else this.emit('message', p, true);
  }

  _send(op, payload) {
    if (!this.open || this.socket.destroyed) return;
    const len = payload.length;
    let h;
    if (len < 126) {
      h = Buffer.alloc(2);
      h[1] = len;
    } else if (len < 65536) {
      h = Buffer.alloc(4);
      h[1] = 126;
      h.writeUInt16BE(len, 2);
    } else {
      h = Buffer.alloc(10);
      h[1] = 127;
      h.writeUInt32BE(0, 2);
      h.writeUInt32BE(len, 6);
    }
    h[0] = 0x80 | op;
    this.socket.write(Buffer.concat([h, payload]));
  }

  send(data) {
    if (typeof data === 'string') this._send(0x1, Buffer.from(data, 'utf8'));
    else this._send(0x2, data);
  }

  /** Octets en attente d'envoi (client lent) : sert à ne pas accumuler de retard audio. */
  get backlog() {
    return this.socket && !this.socket.destroyed ? this.socket.writableLength : 0;
  }

  ping() {
    this._send(0x9, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    if (!this.closeBy) { this.closeBy = 'serveur'; this.closeCode = code; }
    const r = Buffer.from(String(reason)).subarray(0, 120);
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this._send(0x8, p);
    this._end();
  }

  terminate() {
    this._closed();
  }

  _end() {
    if (!this.open) return;
    this.open = false;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref();
    this.emit('close');
  }

  _closed() {
    if (this.open) {
      this.open = false;
      this.emit('close');
    }
    this.socket.destroy();
  }
}

/**
 * Attache un serveur WebSocket à un serveur HTTP Node.
 * @param {http.Server} server
 * @param {{path:string, maxPayload?:number, onConnection:(c:WsConn, req)=>void}} opts
 */
function attach(server, opts) {
  server.on('upgrade', (req, socket) => {
    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://x').pathname;
    } catch (e) {
      /* URL invalide */
    }
    const key = req.headers['sec-websocket-key'];
    const upg = String(req.headers.upgrade || '').toLowerCase();
    if (pathname !== opts.path || !key || upg !== 'websocket' || req.headers['sec-websocket-version'] !== '13') {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );
    opts.onConnection(new WsConn(socket, req, { maxPayload: opts.maxPayload }), req);
  });
}

module.exports = { attach, WsConn };
