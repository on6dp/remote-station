'use strict';
/*
 * wasi-mem.js — petite implémentation de WASI (preview1) en mémoire, sans accès au disque.
 * Juste ce qu'il faut pour exécuter un programme C en ligne de commande compilé en WebAssembly
 * (ici wsprd) : arguments, horloge, un dossier « /w » dont les fichiers sont des tableaux d'octets,
 * sortie standard récupérée en texte. Évite le module « wasi » de Node, encore expérimental.
 */

const E = { SUCCESS: 0, BADF: 8, INVAL: 28, NOENT: 44, NOTDIR: 54, ISDIR: 31 };
const FT = { CHAR: 2, DIR: 3, FILE: 4 };
class Exit extends Error { constructor(code) { super('exit ' + code); this.code = code; } }

/**
 * Exécute un module WASI.
 * @param {WebAssembly.Module} mod
 * @param {string[]} args         argv (args[0] = nom du programme)
 * @param {Map<string,Uint8Array>} files  fichiers du dossier /w (lus et modifiés sur place)
 * @returns {{code:number, stdout:string}}
 */
function run(mod, args, files) {
  let mem = null;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const argBufs = args.map((a) => enc.encode(a + '\0'));
  let stdout = '';
  // Descripteurs : 0-2 console, 3 = dossier /w, puis fichiers ouverts
  const fds = new Map([[3, { dir: true }]]);
  let nextFd = 4;
  const view = () => new DataView(mem.buffer);
  const bytes = () => new Uint8Array(mem.buffer);
  const str = (ptr, len) => dec.decode(bytes().subarray(ptr, ptr + len));
  const norm = (p) => '/w/' + String(p).replace(/^\/?w\//, '').replace(/^\.\/?/, '').replace(/^\/+/, '');
  const ensure = (f, n) => {
    if (f.data.length >= n) return;
    const d = new Uint8Array(Math.max(n, f.data.length * 2, 4096));
    d.set(f.data.subarray(0, f.size));
    f.data = d;
  };
  const iovs = (ptr, n, fn) => {
    const v = view();
    let total = 0;
    for (let i = 0; i < n; i++) {
      const p = v.getUint32(ptr + i * 8, true);
      const l = v.getUint32(ptr + i * 8 + 4, true);
      const done = fn(p, l);
      total += done;
      if (done < l) break;
    }
    return total;
  };
  const save = (f) => { if (f.path) files.set(f.path, f.data.slice(0, f.size)); };

  const w = {
    args_sizes_get(cPtr, sPtr) {
      const v = view();
      v.setUint32(cPtr, argBufs.length, true);
      v.setUint32(sPtr, argBufs.reduce((n, b) => n + b.length, 0), true);
      return E.SUCCESS;
    },
    args_get(argvPtr, bufPtr) {
      const v = view();
      let p = bufPtr;
      argBufs.forEach((b, i) => { v.setUint32(argvPtr + i * 4, p, true); bytes().set(b, p); p += b.length; });
      return E.SUCCESS;
    },
    clock_time_get(id, precision, tPtr) {
      view().setBigUint64(tPtr, BigInt(Date.now()) * 1000000n + BigInt(Math.floor((performance.now() % 1) * 1e6)), true);
      return E.SUCCESS;
    },
    fd_prestat_get(fd, ptr) {
      if (fd !== 3) return E.BADF;
      const v = view();
      v.setUint8(ptr, 0);
      v.setUint32(ptr + 4, 2, true);
      return E.SUCCESS;
    },
    fd_prestat_dir_name(fd, ptr, len) {
      if (fd !== 3) return E.BADF;
      bytes().set(enc.encode('/w').subarray(0, len), ptr);
      return E.SUCCESS;
    },
    fd_fdstat_get(fd, ptr) {
      const v = view();
      const f = fds.get(fd);
      if (fd > 2 && !f) return E.BADF;
      v.setUint8(ptr, fd <= 2 ? FT.CHAR : f.dir ? FT.DIR : FT.FILE);
      v.setUint16(ptr + 2, f && f.append ? 1 : 0, true);
      v.setBigUint64(ptr + 8, 0xffffffffffffffffn, true);
      v.setBigUint64(ptr + 16, 0xffffffffffffffffn, true);
      return E.SUCCESS;
    },
    fd_fdstat_set_flags() { return E.SUCCESS; },
    path_filestat_get(fd, flags, pPtr, pLen, bufPtr) {
      const p = norm(str(pPtr, pLen));
      const isDir = p === '/w/' || p === '/w/.';
      if (!isDir && !files.has(p)) return E.NOENT;
      const v = view();
      for (let i = 0; i < 64; i += 8) v.setBigUint64(bufPtr + i, 0n, true);
      v.setUint8(bufPtr + 16, isDir ? FT.DIR : FT.FILE);
      v.setBigUint64(bufPtr + 24, 1n, true);
      v.setBigUint64(bufPtr + 32, BigInt(isDir ? 0 : files.get(p).length), true);
      return E.SUCCESS;
    },
    path_open(dirFd, dirFlags, pPtr, pLen, oflags, rb, ri, fdflags, fdPtr) {
      const p = norm(str(pPtr, pLen));
      if (p === '/w/' || p === '/w/.' || (oflags & 2)) {
        const fd = nextFd++;
        fds.set(fd, { dir: true });
        view().setUint32(fdPtr, fd, true);
        return E.SUCCESS;
      }
      const exists = files.has(p);
      if (!exists && !(oflags & 1)) return E.NOENT;           // O_CREAT absent
      if (exists && (oflags & 4)) return E.INVAL;              // O_EXCL
      let data = exists && !(oflags & 8) ? files.get(p) : new Uint8Array(0); // O_TRUNC
      const f = { path: p, data: new Uint8Array(Math.max(4096, data.length)), size: data.length, pos: 0, append: !!(fdflags & 1) };
      f.data.set(data);
      if (!exists || (oflags & 8)) save(f);
      const fd = nextFd++;
      fds.set(fd, f);
      view().setUint32(fdPtr, fd, true);
      return E.SUCCESS;
    },
    fd_read(fd, iovPtr, n, nPtr) {
      const f = fds.get(fd);
      if (!f || f.dir) return fd === 0 ? (view().setUint32(nPtr, 0, true), E.SUCCESS) : E.BADF;
      const got = iovs(iovPtr, n, (p, l) => {
        const k = Math.max(0, Math.min(l, f.size - f.pos));
        bytes().set(f.data.subarray(f.pos, f.pos + k), p);
        f.pos += k;
        return k;
      });
      view().setUint32(nPtr, got, true);
      return E.SUCCESS;
    },
    fd_write(fd, iovPtr, n, nPtr) {
      if (fd === 1 || fd === 2) {
        const got = iovs(iovPtr, n, (p, l) => { if (fd === 1) stdout += str(p, l); return l; });
        view().setUint32(nPtr, got, true);
        return E.SUCCESS;
      }
      const f = fds.get(fd);
      if (!f || f.dir) return E.BADF;
      if (f.append) f.pos = f.size;
      const got = iovs(iovPtr, n, (p, l) => {
        ensure(f, f.pos + l);
        f.data.set(bytes().subarray(p, p + l), f.pos);
        f.pos += l;
        if (f.pos > f.size) f.size = f.pos;
        return l;
      });
      save(f);
      view().setUint32(nPtr, got, true);
      return E.SUCCESS;
    },
    fd_seek(fd, offset, whence, outPtr) {
      const f = fds.get(fd);
      if (!f || f.dir) return E.BADF;
      const off = Number(offset);
      const base = whence === 0 ? 0 : whence === 1 ? f.pos : f.size;
      const np = base + off;
      if (np < 0) return E.INVAL;
      f.pos = np;
      view().setBigUint64(outPtr, BigInt(np), true);
      return E.SUCCESS;
    },
    fd_close(fd) {
      const f = fds.get(fd);
      if (f && !f.dir) save(f);
      fds.delete(fd);
      return E.SUCCESS;
    },
    proc_exit(code) { throw new Exit(code); }
  };
  const inst = new WebAssembly.Instance(mod, { wasi_snapshot_preview1: w });
  mem = inst.exports.memory;
  let code = 0;
  try {
    inst.exports._start();
  } catch (e) {
    if (e instanceof Exit) code = e.code;
    else throw e;
  }
  return { code, stdout };
}

module.exports = { run };
