'use strict';
/*
 * drm-rx.js — réception HamDRM (SSTV numérique, compatible EasyPal / QSSTV) en continu.
 * La BF (12 kHz) part dans lib/bin/drmd (démodulateur et décodeur de canal de QSSTV, voir native/drm), qui renvoie
 * son état (synchro, mode, QAM, SNR, indicatif, constellation) et les paquets MSC ; lib/hamdrm.js reconstitue les
 * fichiers ; les fichiers .rs1 à .rs4 passent par lib/bin/drmrs (Reed-Solomon). Processus séparés : un problème du
 * décodeur ne touche pas le serveur.
 *
 * onStatus({ ts, fs, frs, fac, mode, occ, qam, il, snr, fo, call, c:[x,y,…] })
 * onProgress({ name, got, total })
 * onFile({ name, ext, mime, data: Buffer, call, snr, mode, qam })
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { MotDecoder } = require('./hamdrm.js');

const BIN = path.join(__dirname, 'bin', 'drmd');
const RS = path.join(__dirname, 'bin', 'drmrs');
const ok = (f) => { try { fs.accessSync(f, fs.constants.X_OK); return process.platform === 'linux' && process.arch === 'x64'; } catch (e) { return false; } };
function available() { return ok(BIN); }

/** Type d'un fichier reçu d'après ses premiers octets (JPEG, PNG, GIF ; JPEG 2000 reconnu mais pas affiché) */
function sniff(b, name) {
  if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504E47) return { ext: 'png', mime: 'image/png' };
  if (b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8') return { ext: 'gif', mime: 'image/gif' };
  if (b.length > 12 && (b.readUInt32BE(4) === 0x6A502020 || b.readUInt32BE(0) === 0xFF4FFF51)) return { ext: 'jp2', mime: 'image/jp2' };
  const e = (/\.([a-z0-9]{1,5})$/i.exec(name || '') || [])[1];
  if (e && /^(txt|chat)$/i.test(e)) return { ext: e.toLowerCase(), mime: 'text/plain' };
  return { ext: e ? e.toLowerCase() : 'bin', mime: 'application/octet-stream' };
}

class DrmReceiver {
  constructor(onStatus, onProgress, onFile, onLog) {
    this.onStatus = onStatus || (() => {});
    this.onProgress = onProgress || (() => {});
    this.onFile = onFile || (() => {});
    this.onLog = onLog || (() => {});
    this.proc = null;
    this.buf = '';
    this.st = null;
    this.mot = null;
  }
  start() {
    if (this.proc || !available()) return !!this.proc;
    this.buf = '';
    this.mot = new MotDecoder((e) => this._mot(e));
    const p = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = p;
    p.stdout.setEncoding('latin1');
    p.stdout.on('data', (d) => this._data(d));
    p.stderr.on('data', (d) => this.onLog('DRM : ' + String(d).trim()));
    p.stdin.on('error', () => {});
    p.on('exit', (code) => { if (this.proc === p) { this.proc = null; if (code) this.onLog('DRM : décodeur arrêté (code ' + code + ')'); } });
    return true;
  }
  stop() {
    const p = this.proc;
    this.proc = null;
    if (p) { try { p.stdin.end(); } catch (e) {} setTimeout(() => { try { p.kill(); } catch (e) {} }, 2000); }
  }
  /** Repart de zéro (nouvelle fréquence…) : synchro et fichiers en cours oubliés */
  restart() { this.stop(); setTimeout(() => this.start(), 300); }
  /** samples : Float32Array 12 kHz (−1…1) */
  feed(samples) {
    const p = this.proc;
    if (!p || !p.stdin.writable) return;
    const b = Buffer.allocUnsafe(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      let v = samples[i];
      v = v > 1 ? 1 : v < -1 ? -1 : v;
      b.writeInt16LE(Math.round(v * 32767), i * 2);
    }
    p.stdin.write(b);
  }
  _data(d) {
    this.buf += d;
    if (this.buf.length > 4e6) this.buf = this.buf.slice(-1e6);
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      let m;
      try { m = JSON.parse(line); } catch (e) { continue; }
      if (m.t === 'st') { this.st = m; this.onStatus(m); }
      else if (m.t === 'pkt' && m.hex) this.mot.packet(Buffer.from(m.hex, 'hex'), m.ok === 1);
    }
  }
  _mot(e) {
    if (e.t === 'prog' || e.t === 'head') return this.onProgress({ name: e.name, got: e.got || 0, total: e.total || 0 });
    if (e.t !== 'file') return;
    const st = this.st || {};
    const meta = { call: st.call || '', snr: st.snr, mode: st.mode, qam: st.qam };
    const done = (data, name) => {
      const k = sniff(data, name);
      this.onFile(Object.assign({ name: name.replace(/\.rs[1-4]$/i, '.' + k.ext), ext: k.ext, mime: k.mime, data }, meta));
    };
    if (!e.rs) return done(e.data, e.name);
    if (!ok(RS)) return this.onLog('DRM : Reed-Solomon indisponible (lib/bin/drmrs)');
    // Un seul essai à la fois par fichier ; une fois le fichier rattrapé, les essais suivants sont ignorés
    if (!this.rsBusy) { this.rsBusy = new Set(); this.rsDone = new Set(); }
    if (this.rsBusy.has(e.tid) || this.rsDone.has(e.tid)) return;
    this.rsBusy.add(e.tid);
    const rp = execFile(RS, ['dec', String(e.rs), String(e.erasures[0]), String(e.erasures[1]), e.erasures.slice(2).join(',')],
      { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 10000 }, (err, out, errout) => {
        this.rsBusy.delete(e.tid);
        if (err || this.rsDone.has(e.tid)) return; // pas encore assez de segments : nouvel essai au segment suivant
        this.rsDone.add(e.tid);
        if (this.rsDone.size > 50) this.rsDone.delete(this.rsDone.values().next().value);
        let ext = '';
        try { ext = JSON.parse(String(errout).trim().split('\n').pop()).ext || ''; } catch (x) { ext = ''; }
        this.mot.finish(e.tid);
        const base = e.name.replace(/\.rs[1-4]$/i, '');
        done(out, base + (ext ? '.' + ext.replace(/\0/g, '') : ''));
      });
    rp.stdin.on('error', () => {});
    rp.stdin.end(e.data);
  }
}

/** Émission : fichier → signal DRM (Int16Array, 12 kHz) avec lib/bin/drmgen */
const GEN = path.join(__dirname, 'bin', 'drmgen');
function drmWave(data, name, ext, p, call) {
  return new Promise((resolve, reject) => {
    if (!ok(GEN)) return reject(new Error('émetteur DRM indisponible sur le serveur (lib/bin/drmgen)'));
    const tmp = path.join(require('os').tmpdir(), 'rs-drm-' + process.pid + '-' + Date.now() + '.bin');
    fs.writeFileSync(tmp, data);
    const args = [tmp, name, ext, String(p.mode), String(p.bw), String(p.il), String(p.qam), String(p.prot), String(call || 'NOCALL').slice(0, 9)];
    execFile(GEN, args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: 30000 }, (err, out) => {
      try { fs.unlinkSync(tmp); } catch (e) { /* déjà retiré */ }
      if (err) return reject(new Error('codeur DRM : ' + (err.code || err.message)));
      resolve(new Int16Array(out.buffer.slice(out.byteOffset, out.byteOffset + (out.length & ~1))));
    });
  });
}
/** Reed-Solomon à l'émission (.rs1 à .rs4) */
function drmRsEncode(data, rs, ext) {
  return new Promise((resolve, reject) => {
    if (!ok(RS)) return reject(new Error('Reed-Solomon indisponible (lib/bin/drmrs)'));
    const p = execFile(RS, ['enc', String(rs), ext], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 10000 }, (err, out) => {
      if (err) return reject(new Error('Reed-Solomon : ' + (err.code || err.message)));
      resolve(out);
    });
    p.stdin.end(data);
  });
}

module.exports = { DrmReceiver, available, sniff, drmWave, drmRsEncode };
