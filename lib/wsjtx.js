'use strict';
/*
 * wsjtx.js — décodage FT8 / FT4 / FT2 avec le moteur de décodage de WSJT-X 3 (GPL v3) : FT8 « MTD »
 * multi-passes de type JTDX (soustraction des signaux décodés, OSD, AP), FT4 profondeur 3.
 * Le programme natif lib/bin/wsjtxd (Linux x86-64) ou wsjtxd.exe (Windows x64), compilé par
 * native/wsjtx/build.py, tourne en permanence : il garde les indicatifs hachés et l'historique AP.
 * S'il s'arrête, il est relancé ; s'il est absent, l'appelant revient à ft8_lib (lib/ftx.js).
 *
 * FT2 (Decodium) = signal FT4 à vitesse double : la fenêtre est étirée d'un facteur 2 (chaque échantillon
 * répété par interpolation), décodée en FT4, puis fréquences ×2 et temps ÷2.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const RATE = 12000;
const WIN = process.platform === 'win32';
const BIN = path.join(__dirname, 'bin', 'wsjtxd' + (WIN ? '.exe' : ''));
const ALLCALL = path.join(__dirname, 'data', 'ALLCALL7.TXT');
const N_FT8 = 180000;   // 15 s
const N_FT4 = 72576;    // fenêtre d'analyse FT4 (6,048 s)

function available() {
  if (process.env.RS_NO_WSJTX) return false;
  try { fs.accessSync(BIN, WIN ? fs.constants.R_OK : fs.constants.X_OK); } catch (e) { return false; }
  return (process.platform === 'linux' || WIN) && process.arch === 'x64';
}

class Wsjtx {
  constructor(log) {
    this.log = log || (() => {});
    this.proc = null;
    this.queue = [];
    this.cur = null;
    this.buf = '';
    this.lines = [];
    this.ready = false;
    this.fails = 0;
    this.id = 0;
    this.calls = new Set();  // nos indicatifs, ajoutés à la base ALLCALL7 au démarrage du décodeur
    // Plusieurs cœurs pour le FT8 multi-passes, en laissant de la place au serveur
    this.threads = Math.max(1, Math.min(4, (os.cpus() || []).length - 1));
    if (this.threads > 1) this.threads--; // la passe profonde partage la machine avec les passes rapides et le serveur
  }
  ok() { return available() && this.fails < 5; }
  start() {
    if (this.proc) return;
    const env = Object.assign({}, process.env, { OMP_STACKSIZE: '64M', OMP_WAIT_POLICY: 'PASSIVE' });
    // Dossier de travail temporaire : le décodeur peut y écrire ses fichiers de suivi
    // Dossiers laissés par un serveur arrêté brutalement (plus d'une heure) : effacés
    try {
      for (const d of fs.readdirSync(os.tmpdir())) {
        if (!d.startsWith('rs-wsjtx-')) continue;
        const f = path.join(os.tmpdir(), d);
        if (Date.now() - fs.statSync(f).mtimeMs > 3600e3) fs.rmSync(f, { recursive: true, force: true });
      }
    } catch (e) { /* */ }
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-wsjtx-'));
    // Base d'indicatifs de JTDX (ALLCALL7.TXT, ~100 000 indicatifs vus sur PSK Reporter) : écarte les faux décodages
    // très faibles ; nos propres indicatifs y sont ajoutés
    try {
      const lines = fs.readFileSync(ALLCALL, 'latin1').split(/\r?\n/);
      const head = lines.filter((l) => l.startsWith('//'));
      const set = new Set(lines.filter((l) => /^[A-Z0-9]{3,7},/.test(l)).map((l) => l.slice(0, l.indexOf(','))));
      for (const c of this.calls) if (/^[A-Z0-9]{3,7}$/.test(c)) set.add(c);
      const body = Array.from(set).sort().map((c) => c + ',');
      fs.writeFileSync(path.join(cwd, 'ALLCALL7.TXT'), head.concat(body, ['ZZZZ']).join('\n') + '\n', 'latin1');
    } catch (e) { /* sans la base : décodeur sans ce filtre */ }
    const p = spawn(BIN, [], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = p;
    this.ready = false;
    this.buf = '';
    p.stdout.setEncoding('latin1');
    p.stdout.on('data', (d) => this.onData(d));
    p.stderr.on('data', () => {});
    p.stdin.on('error', () => {});
    const gone = (why) => {
      if (this.proc !== p) return;
      this.proc = null;
      this.ready = false;
      fs.rm(cwd, { recursive: true, force: true }, () => {});
      if (this.stopping) return;
      this.fails++;
      this.log('décodeur WSJT-X arrêté (' + why + ')' + (this.fails >= 5 ? ' : retour au décodeur intégré' : ', relancé'));
      const c = this.cur;
      this.cur = null;
      if (c) { clearTimeout(c.timer); c.reject(new Error('décodeur WSJT-X arrêté')); }
      if (this.queue.length && this.ok()) this.start();
      else for (const q of this.queue.splice(0)) q.reject(new Error('décodeur WSJT-X indisponible'));
    };
    p.on('error', (e) => gone(e.message));
    p.on('exit', (code, sig) => gone(sig || code));
  }
  onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const l = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      if (l === 'READY') { this.ready = true; this.pump(); continue; }
      if (!this.cur) continue;
      if (l.startsWith('D\t')) { this.lines.push(l); continue; }
      if (l.startsWith('E\t')) {
        const c = this.cur;
        this.cur = null;
        clearTimeout(c.timer);
        this.fails = 0;
        const out = this.lines.splice(0);
        const e = l.split('\t');
        c.resolve({ status: Number(e[1]), ms: Number(e[3]), lines: out });
        this.pump();
      }
    }
  }
  pump() {
    if (this.cur || !this.ready || !this.queue.length) return;
    const q = this.queue.shift();
    this.cur = q;
    this.lines = [];
    // Décodeur bloqué : arrêté au bout de 40 s (puis relancé)
    const p = this.proc;
    q.timer = setTimeout(() => { if (this.cur === q && p) p.kill('SIGKILL'); }, 40000);
    try {
      this.proc.stdin.write(q.head);
      if (q.pcm) this.proc.stdin.write(q.pcm);
    } catch (e) { /* le processus s'arrête : géré par « exit » */ }
  }
  send(head, pcm) {
    return new Promise((resolve, reject) => {
      if (!this.ok()) return reject(new Error('décodeur WSJT-X indisponible'));
      this.queue.push({ head, pcm, resolve, reject });
      if (!this.proc) this.start();
      else this.pump();
    });
  }
  /**
   * Décode une fenêtre. samples : Float32Array (12 kHz) à partir du début de la période.
   * o : { phase:'early'|'normal'|'deep', id (FT8 early puis normal : même id), utc:HHMMSS, rx, tx, mycall, hiscall, mygrid, hisgrid, qp }
   * Résultat : [{ db, dt, t, f, msg, ap }]
   */
  async decode(mode, samples, o = {}) {
    let m, n, src = samples, scale = 1;
    if (mode === 'FT8') { m = 8; n = Math.min(samples.length, N_FT8); }
    else if (mode === 'FT4') { m = 5; n = Math.min(samples.length, N_FT4); }
    else if (mode === 'FT2') {
      // Étirement ×2 (interpolation linéaire) : FT2 devient du FT4 à mi-fréquence
      m = 5; scale = 2;
      n = Math.min(samples.length * 2, N_FT4);
      src = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const k = i >> 1;
        src[i] = i & 1 ? (samples[k] + (k + 1 < samples.length ? samples[k + 1] : samples[k])) / 2 : samples[k];
      }
    } else throw new Error('mode ' + mode);
    // int16 : crête ramenée vers 20000 (le décodeur ignore les fenêtres quasi muettes)
    let peak = 0;
    for (let i = 0; i < n; i++) { const a = Math.abs(src[i]); if (a > peak) peak = a; }
    const g = peak > 0 ? Math.min(20000 / peak, 1e6) : 1;
    const pcm = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(src[i] * g))), i * 2);
    // FT8 : « early » (stade 41, 11,8 s d'audio) puis « normal » (stade 50) sur la même entrée, comme WSJT-X ;
    // « deep » : décodeur multi-passes MTD (type JTDX) sur une entrée à part, sur plusieurs cœurs
    const ph = o.phase || 'normal';
    const id = o.id || ++this.id;
    const keep = m === 8 && ph === 'early';
    const cl = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9/<>]/g, '').slice(0, 12);
    for (const c of [o.mycall, o.hiscall]) for (const p of cl(c).split('/')) if (p.length >= 3) this.calls.add(p);
    const kv = ['utc=' + (o.utc || 0)];
    let phase = 2;
    if (m === 8) {
      if (ph === 'early') { phase = 1; kv.push('stage=41 mtd=0'); }
      else if (ph === 'deep') kv.push('stage=50 mtd=1 threads=' + this.threads);
      else kv.push('stage=50 mtd=0');
    }
    const rx = Math.round(o.rx || 1500), tx = Math.round(o.tx || rx);
    kv.push('rx=' + Math.round(rx / scale), 'tx=' + Math.round(tx / scale), 'lo=' + Math.round(100 / scale), 'hi=' + Math.round((scale > 1 ? 3100 : 3000) / scale));
    // Indicatif de base (sans préfixe / suffixe) et « standard » (sans « / ») pour l'AP
    const base = (c) => c.split('/').sort((x, y) => y.length - x.length)[0];
    if (cl(o.mycall)) kv.push('mycall=' + cl(o.mycall), 'mybase=' + base(cl(o.mycall)), 'mystd=' + (cl(o.mycall).indexOf('/') < 0 ? 1 : 0));
    if (cl(o.hiscall)) kv.push('hiscall=' + cl(o.hiscall), 'hisbase=' + base(cl(o.hiscall)), 'hisstd=' + (cl(o.hiscall).indexOf('/') < 0 ? 1 : 0));
    if (/^[A-R]{2}\d{2}/i.test(o.mygrid || '')) kv.push('mygrid=' + String(o.mygrid).slice(0, 6).toUpperCase());
    if (/^[A-R]{2}\d{2}/i.test(o.hisgrid || '')) kv.push('hisgrid=' + String(o.hisgrid).slice(0, 4).toUpperCase());
    if (o.qp) kv.push('qp=' + Math.max(0, Math.min(5, o.qp | 0)));
    const r = await this.send('DECODE ' + m + ' ' + phase + ' ' + id + ' ' + n + ' ' + kv.join(' ') + '\n', pcm);
    if (!keep) this.send('RELEASE ' + id + '\n').catch(() => {});
    const out = [];
    for (const l of r.lines) {
      const a = l.split('\t');
      if (a.length < 7) continue;
      const msg = a.slice(6).join('\t').trim();
      if (!msg || out.some((x) => x.msg === msg)) continue;
      const t = (Number(a[2]) + 0.5) / scale;     // début du signal dans la fenêtre (s) ; départ nominal à 0,5 s
      out.push({
        db: Math.max(-30, Math.min(40, Number(a[1]))),
        dt: Math.round((t - 0.5) * 10) / 10,
        t,
        f: Math.round(Number(a[3]) * scale),
        ap: Number(a[4]) || 0,
        msg
      });
    }
    out.sort((p, q) => p.f - q.f);
    return { list: out, ms: r.ms, id };
  }
  newId() { return ++this.id; }
  stop() { this.stopping = true; if (this.proc) { try { this.proc.stdin.write('QUIT\n'); } catch (e) { /* */ } } }
}

module.exports = { Wsjtx, available, BIN };
