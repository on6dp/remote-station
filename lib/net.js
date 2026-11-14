'use strict';
/*
 * net.js — mise en réseau des serveurs Remote Station (à la manière de N1MM) : un log commun et une seule série de
 * numéros de série de contest pour toutes les stations.
 *
 * Réglages (net.json, droits 600, jamais publié) : { mode, name, self, masters, key }
 *  - mode : 'off' (hors réseau), 'node' (poste), 'master' (maître ou maître de secours)
 *  - name : nom de ce serveur dans le réseau (ex. ON4LUC-1) ; self : son adresse (maîtres : remote.op0p.be…)
 *  - masters : adresses des maîtres par ordre de priorité (la même liste partout) ; key : clé du réseau
 *
 * Liaisons : WebSocket sur /ws (le même chemin que les navigateurs : nginx inchangé), sortantes seulement pour les
 * postes (ok derrière un CGNAT). Authentification des deux côtés par HMAC-SHA256 de la clé (jamais envoyée).
 * Copie : chaque serveur garde le log complet ; à la connexion, chacun envoie à l'autre ses changements depuis le
 * dernier numéro reçu (journal « changes » de la base) ; un QSO n'est gardé que s'il est plus récent (edited/created),
 * les suppressions laissent une trace (tombs). Numéros de série : tenus par le maître actif ; lignes recopiées partout.
 * Reprise : le maître de priorité 1 est actif dès qu'il a repris les données des secours (ou 40 s après son démarrage) ;
 * un secours devient actif quand aucun maître plus prioritaire ne répond depuis 30 s, et rend la main (après lui avoir
 * renvoyé ses données) dès que celui-ci revient : ses postes sont alors renvoyés vers lui.
 */
const fs = require('fs');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DEF = { mode: 'off', name: '', self: '', masters: [], key: '' };
const hmac = (key, s) => crypto.createHmac('sha256', String(key)).update(String(s)).digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const host = (a) => String(a || '').trim().toLowerCase().replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
function wsUrl(a) {
  a = String(a || '').trim();
  if (/^wss?:\/\//i.test(a)) return /\/ws$/.test(a) ? a : a.replace(/\/+$/, '') + '/ws';
  return 'wss://' + a.replace(/\/+$/, '') + '/ws';
}

class Net extends EventEmitter {
  /** @param {{ book, file, log?, version? }} o */
  constructor(o) {
    super();
    this.book = o.book;
    this.file = o.file;
    this.log = o.log || ((m) => console.log('Réseau : ' + m));
    this.version = o.version || '';
    this.cfg = Object.assign({}, DEF);
    this.peers = new Set(); // liaisons ouvertes (entrantes et sortante)
    this.out = null;        // liaison sortante (vers un maître)
    this.startedAt = Date.now();
    this.lastHigher = 0;    // dernier contact avec un maître plus prioritaire (secours)
    this.backupsSynced = new Set();
    this.rid = 0;
    this.wait = new Map();  // demandes de numéro de série envoyées au maître
    this.timer = null;
    this.events = [];       // derniers événements (écran Réseau)
    this.load();
    this.baseNode = this.book ? this.book.node : 'serveur';
    if (this.book) this.book.onChange = () => this.kick();
  }
  // ---------------------------------------------------------------- réglages
  load() {
    try { this.cfg = Object.assign({}, DEF, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch (e) { this.cfg = Object.assign({}, DEF); }
    if (!Array.isArray(this.cfg.masters)) this.cfg.masters = [];
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.cfg, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  /** Réglages modifiés (écran Réseau) : liaisons refaites */
  set(c) {
    const n = Object.assign({}, this.cfg);
    if (c.mode != null) n.mode = ['off', 'node', 'master'].indexOf(c.mode) >= 0 ? c.mode : 'off';
    if (c.name != null) n.name = String(c.name).toUpperCase().replace(/[^A-Z0-9/_-]/g, '').slice(0, 24);
    if (c.self != null) n.self = host(c.self).slice(0, 120);
    if (c.masters != null) n.masters = (Array.isArray(c.masters) ? c.masters : String(c.masters).split(/[\s,;]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 5);
    if (c.key) n.key = String(c.key).trim().slice(0, 200);
    if (n.mode !== 'off') {
      if (!n.name) throw new Error('nom du poste manquant');
      if (!n.masters.length) throw new Error('adresse du maître manquante');
      if (String(n.key).length < 16) throw new Error('clé du réseau trop courte (16 caractères au moins)');
      if (!this.book || this.book.engine !== 'sqlite') throw new Error('le carnet doit être en base SQLite (Node.js 22.13 ou plus)');
      if (n.mode === 'master' && this.prioOf(n) < 0) throw new Error('ce maître (' + (n.self || '?') + ') doit figurer dans la liste des maîtres');
    }
    // Premier passage en réseau : les QSO déjà là ne partent pas (sauf demande « depuis le … »)
    const was = this.cfg.mode;
    this.cfg = n;
    if (was === 'off' && n.mode !== 'off' && this.book && this.book.metaGet && !this.book.metaGet('net_base')) {
      const since = String(c.since || '').replace(/\D/g, '');
      this.book.metaSet('net_base', since ? 'date:' + since : 'seq:' + this.book.maxSeq());
    }
    this.save();
    this.ev('Réglages changés : ' + ({ off: 'hors réseau', node: 'poste', master: 'maître' }[n.mode]));
    this.restart();
  }
  prioOf(c) { c = c || this.cfg; const s = host(c.self); return s ? c.masters.map(host).indexOf(s) : -1; }
  isMaster() { return this.cfg.mode === 'master' && this.prioOf() >= 0; }
  /** Ce serveur distribue-t-il les numéros (maître actif) ? */
  active() {
    if (!this.isMaster()) return false;
    const p = this.prioOf();
    if (p === 0) {
      // Priorité 1 : actif quand les secours lui ont rendu leurs données, ou 40 s après le démarrage (secours absents)
      const backups = this.cfg.masters.length - 1;
      return this.backupsSynced.size >= backups || Date.now() - this.startedAt > 40000;
    }
    // Secours : actif si aucun maître plus prioritaire ne répond depuis 30 s
    if (this.out && this.out.ready && this.out.prio < p && this.out.active) return false; // il a repris (et nos données)
    return Date.now() - Math.max(this.lastHigher, this.startedAt) > 30000;
  }
  ev(msg) { this.events.unshift({ t: Date.now(), msg }); this.events.length = Math.min(this.events.length, 30); this.log(msg); }
  // ---------------------------------------------------------------- démarrage / liaisons
  start() { this.restart(); }
  restart() {
    // Nom de ce serveur sur ses QSO (poste qui les a faits) : celui du réseau
    if (this.book) this.book.node = this.cfg.mode !== 'off' && this.cfg.name ? this.cfg.name : (this.baseNode || this.book.node);
    for (const p of Array.from(this.peers)) this.drop(p, 'réglages changés');
    clearInterval(this.timer);
    this.timer = null;
    this.startedAt = Date.now();
    this.lastActive = false; // maître prioritaire : de nouveau « en attente » le temps de reprendre les données du secours
    this.backupsSynced.clear();
    if (this.cfg.mode === 'off') return;
    this.timer = setInterval(() => this.tick(), 3000);
    if (this.timer.unref) this.timer.unref();
    this.tick();
  }
  /** Toutes les 3 s : liaison sortante vers le meilleur maître, état actif / secours */
  tick() {
    if (this.cfg.mode === 'off') return;
    // Liaisons muettes depuis 25 s : coupées ; sinon un ping (le maître dit aussi s'il est actif)
    for (const p of Array.from(this.peers)) {
      const last = Math.max(p.lastHeard || 0, p.since || 0);
      if (Date.now() - last > 25000) { this.drop(p, p.ready ? 'plus de nouvelles depuis 25 s' : 'pas de réponse'); continue; }
      if (p.ready) p.send({ t: 'net_ping' });
    }
    const wasActive = this.lastActive;
    this.lastActive = this.active();
    if (wasActive && !this.lastActive && this.isMaster() && this.prioOf() > 0) {
      this.ev('Maître de secours : le maître prioritaire est revenu, la main lui est rendue');
      for (const p of Array.from(this.peers)) if (p.dir === 'in' && !p.master) { this.sendTo(p, { t: 'net_moved' }); this.drop(p, 'renvoyé vers le maître prioritaire'); }
    } else if (!wasActive && this.lastActive && this.isMaster()) this.ev(this.prioOf() ? 'Maître de secours ACTIF (le maître prioritaire ne répond plus)' : 'Maître actif');
    // Cibles : postes → tous les maîtres dans l'ordre ; secours → seulement les maîtres plus prioritaires ; priorité 1 → aucune
    const me = this.prioOf();
    const targets = this.cfg.masters.map((a, i) => ({ a, i })).filter((x) => (this.isMaster() ? x.i < me : host(x.a) !== host(this.cfg.self)));
    if (!targets.length) return;
    // Version du maître (alignement du secours, avertissement des stations) : redite à chaque passage, traitée une fois
    if (this.out && this.out.ready && this.out.v && this.out.active) this.emit('masterVersion', { name: this.out.name, v: this.out.v, prio: this.out.prio });
    if (this.out && this.out.ready) {
      if (this.out.master && this.out.active === false && !this.isMaster()) { this.drop(this.out, 'maître en attente'); }
      // Poste branché sur un secours : on revient au maître prioritaire dès qu'il répond (essai toutes les 30 s)
      else if (!this.isMaster() && this.out.prio > 0 && Date.now() - (this.probeAt || 0) > 30000) { this.probeAt = Date.now(); this.probe(targets.filter((x) => x.i < this.out.prio)); }
      return;
    }
    if (this.out) return; // connexion en cours
    // Essai du suivant dans l'ordre (un par passage) ; après un tour complet sans succès, on recommence par le premier
    this.ti = ((this.ti == null ? -1 : this.ti) + 1) % targets.length;
    this.connect(targets[this.ti]);
  }
  probe(list) {
    for (const x of list) {
      const p = this.connect(x, true);
      if (p) return;
    }
  }
  connect(x, probe) {
    if (typeof WebSocket !== 'function') { this.ev('WebSocket indisponible dans ce Node.js'); return null; }
    let ws;
    try { ws = new WebSocket(wsUrl(x.a)); } catch (e) { this.failAt = Date.now(); return null; }
    const p = { dir: 'out', addr: x.a, prio: x.i, ws, ready: false, name: host(x.a), cn: crypto.randomBytes(16).toString('hex'), probe: !!probe, since: Date.now() };
    p.send = (o) => { try { if (ws.readyState === 1) ws.send(JSON.stringify(o)); } catch (e) { /* fermé */ } };
    if (!probe) this.out = p;
    ws.onopen = () => p.send({ t: 'net_hello', name: this.cfg.name, mode: this.cfg.mode, cn: p.cn, v: this.version, prio: this.prioOf() });
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x2) { return; } this.onMsg(p, m); };
    ws.onclose = () => this.closed(p);
    ws.onerror = () => { /* onclose suit */ };
    this.peers.add(p);
    return p;
  }
  drop(p, why) {
    if (!p) return;
    p.why = why;
    try { if (p.ws) p.ws.close(); else if (p.conn) p.conn.close(4001, String(why || '').slice(0, 60)); } catch (e) { /* déjà fermé */ }
    this.closed(p);
  }
  closed(p) {
    if (!this.peers.has(p)) return;
    this.peers.delete(p);
    if (this.out === p) { this.out = null; this.failAt = Date.now(); }
    if (p.ready) this.ev('Liaison fermée avec ' + (p.name || p.addr || '?') + (p.why ? ' (' + p.why + ')' : ''));
    for (const [rid, w] of this.wait) if (w.p === p) { this.wait.delete(rid); w.done(null); }
  }
  sendTo(p, o) { if (p.send) p.send(o); }
  /** Liaison entrante (message net_hello reçu sur /ws) : server.js passe la connexion */
  accept(conn, m) {
    if (!this.isMaster() || !this.cfg.key) return conn.close(4003, 'ce serveur n’est pas un maître du réseau');
    const p = { dir: 'in', conn, ready: false, name: String(m.name || '').slice(0, 24), cn: String(m.cn || ''), sn: crypto.randomBytes(16).toString('hex'), master: m.mode === 'master', prio: Number(m.prio), since: Date.now(), v: String(m.v || '').slice(0, 20), ip: conn.ip || '' };
    p.send = (o) => { if (conn.open) conn.send(JSON.stringify(o)); };
    this.peers.add(p);
    conn.netPeer = p;
    p.send({ t: 'net_chal', name: this.cfg.name, sn: p.sn, mac: hmac(this.cfg.key, 'S|' + p.cn + '|' + this.cfg.name), prio: this.prioOf(), active: this.active(), v: this.version });
  }
  /** Message d'une liaison entrante (après net_hello) */
  onConn(conn, m) { if (conn.netPeer) this.onMsg(conn.netPeer, m); }
  connClosed(conn) { if (conn.netPeer) this.closed(conn.netPeer); }
  // ---------------------------------------------------------------- protocole
  onMsg(p, m) {
    if (!m || typeof m.t !== 'string') return;
    p.lastHeard = Date.now();
    const key = this.cfg.key;
    // Poignée de main
    if (m.t === 'net_chal' && p.dir === 'out') {
      if (!same(m.mac, hmac(key, 'S|' + p.cn + '|' + m.name))) { this.ev('Maître ' + p.addr + ' : mauvaise clé du réseau'); return this.drop(p, 'clé du réseau différente'); }
      p.name = String(m.name || p.name);
      p.active = !!m.active;
      p.master = true;
      p.v = String(m.v || '').slice(0, 20);
      p.send({ t: 'net_auth', mac: hmac(key, 'C|' + m.sn + '|' + this.cfg.name), since: this.recvCursor(p.name), ssince: this.srecvCursor(p.name) });
      return;
    }
    if (m.t === 'net_auth' && p.dir === 'in') {
      if (!same(m.mac, hmac(key, 'C|' + p.sn + '|' + p.name))) { this.ev('Poste ' + p.name + ' refusé : mauvaise clé du réseau'); return this.drop(p, 'clé du réseau différente'); }
      p.ready = true;
      p.cursor = Number(m.since) || 0;
      p.scursor = Number(m.ssince) || 0;
      p.send({ t: 'net_ready', since: this.recvCursor(p.name), ssince: this.srecvCursor(p.name), active: this.active() });
      this.ev('Liaison ouverte avec ' + p.name + (p.master ? ' (maître)' : ''));
      return this.pump(p);
    }
    if (m.t === 'net_ready' && p.dir === 'out') {
      p.ready = true;
      p.active = !!m.active;
      p.cursor = Number(m.since) || 0;
      p.scursor = Number(m.ssince) || 0;
      if (p.probe) {
        // Essai du maître prioritaire : il répond et il est actif → on y passe
        if (p.active) { const old = this.out; this.out = p; p.probe = false; if (old) this.drop(old, 'retour au maître prioritaire'); this.ev('Retour au maître ' + p.name); }
        else return this.drop(p, 'maître prioritaire pas encore actif');
      }
      if (this.isMaster() && p.prio < this.prioOf() && p.active) this.lastHigher = Date.now();
      this.ti = null; // prochaine panne : on recommence par le maître prioritaire
      this.ev('Liaison ouverte avec ' + p.name + ' (maître' + (p.prio ? ' de secours' : '') + (p.active ? ', actif' : ', en attente') + ')');
      if (p.v) this.emit('masterVersion', { name: p.name, v: p.v, prio: p.prio });
      return this.pump(p);
    }
    if (!p.ready) return;
    if (m.t === 'net_ping') return p.send({ t: 'net_pong', active: this.active() });
    if (m.t === 'net_pong') { p.active = !!m.active; if (p.dir === 'out' && this.isMaster() && p.prio < this.prioOf() && p.active) this.lastHigher = Date.now(); return; }
    if (m.t === 'net_moved') { this.ev(p.name + ' rend la main au maître prioritaire'); return this.drop(p, 'renvoyé vers le maître prioritaire'); }
    if (m.t === 'net_ch') {
      // QSO et numéros de série reçus : appliqués (plus récents seulement), puis accusé de réception
      let n = 0;
      try { n = this.book.applyRemote(m.items || []); } catch (e) { this.ev('Erreur à la copie des QSO de ' + p.name + ' : ' + e.message); return; }
      let ns = 0;
      try { ns = this.book.applySerialRows(m.ser || []); } catch (e) { this.ev('Erreur à la copie des numéros de ' + p.name + ' : ' + e.message); }
      if (m.upto != null) this.book.metaSet('recv:' + p.name, String(m.upto));
      if (m.smax != null) this.book.metaSet('srecv:' + p.name, String(m.smax));
      p.inQ = (p.inQ || 0) + (m.items || []).length;
      // Dernier QSO arrivé par cette liaison (écran Réseau : qui trafique)
      for (const it of m.items || []) if (it && it.d && it.d.call && it.d.node === p.name && (!p.lastQso || String(it.d.qso_date) + it.d.time_on >= p.lastQso.k)) p.lastQso = { k: String(it.d.qso_date) + it.d.time_on, call: it.d.call, band: it.d.band || '', mode: it.d.mode || '', by: it.d.operator || it.d.by || '' };
      p.lastIn = Date.now();
      p.send({ t: 'net_ack', upto: m.upto });
      if (!m.more) {
        p.caughtIn = true;
        // Le secours a rendu ses données au maître prioritaire (liaison entrante d'un maître moins prioritaire)
        if (p.dir === 'in' && p.master && this.prioOf() === 0 && p.caughtOut) this.backupsSynced.add(p.name);
      }
      if (n || ns) this.emit('applied', { n, ns, from: p.name });
      if (n) this.kick(p); // à recopier vers les autres liaisons
      return;
    }
    if (m.t === 'net_ack') {
      p.acked = Number(m.upto) || 0;
      p.lastAck = Date.now();
      if (p.acked >= this.book.maxSeq()) {
        p.caughtOut = true;
        if (p.dir === 'in' && p.master && this.prioOf() === 0 && p.caughtIn) this.backupsSynced.add(p.name);
      }
      if (p.pending) { p.pending = false; this.pump(p); }
      return;
    }
    // Numéros de série demandés par un poste au maître actif
    if (m.t === 'net_ser') {
      const r = this.active() ? this.serialLocal(m.op, m.contest, m.txc, String(m.holder || p.name).slice(0, 80), m.nr, m.call) : { nr: 0, notActive: true };
      p.send({ t: 'net_ser_r', rid: m.rid, r });
      this.kick(null, 10); // numéros recopiés tout de suite vers le secours
      return;
    }
    if (m.t === 'net_ser_r') {
      const w = this.wait.get(m.rid);
      if (w) { this.wait.delete(m.rid); w.done(m.r || null); }
    }
  }
  recvCursor(name) {
    const v = this.book && this.book.metaGet ? this.book.metaGet('recv:' + name) : null;
    return Number(v) || 0;
  }
  srecvCursor(name) {
    const v = this.book && this.book.metaGet ? this.book.metaGet('srecv:' + name) : null;
    return Number(v) || 0;
  }
  /** Changements locaux (ou reçus d'un autre) : envoi à toutes les liaisons prêtes (sauf celle d'où ils viennent) */
  kick(from, ms) {
    clearTimeout(this.kt);
    // Aussi vers la liaison d'origine : elle les ignore (déjà à jour), mais son accusé dit qu'elle a tout (reprise du maître)
    this.kt = setTimeout(() => { for (const p of this.peers) if (p.ready) this.pump(p); }, ms || 150);
  }
  /** Envoie à une liaison ses changements en retard (par paquets, le suivant après l'accusé de réception) */
  pump(p) {
    if (!p.ready || !this.book || this.book.engine !== 'sqlite') return;
    if (p.inflight) { p.pending = true; return; }
    // Poste qui rejoint le réseau : ses QSO d'avant l'activation ne partent pas (net_base)
    let cur = p.cursor || 0;
    const base = this.book.metaGet ? this.book.metaGet('net_base') : '';
    if (!this.isMaster() && /^seq:\d+$/.test(base || '') && p.master) cur = Math.max(cur, Number(base.slice(4)));
    // Paquets modestes : 64 Ko au plus par message sur /ws
    const o = this.book.outgoing(cur, 60);
    if (/^date:\d{8}$/.test(base || '') && !this.isMaster()) { const d = base.slice(5); o.items = o.items.filter((x) => !x.d || String(x.d.qso_date) >= d); }
    const ser = this.book.serialRows(p.scursor || 0, 150);
    const smax = ser.length ? ser[ser.length - 1].mod : null;
    if (!o.items.length && o.upto === cur && !ser.length) { if (!p.sentOnce) { p.sentOnce = true; p.send({ t: 'net_ch', upto: cur, items: [], ser: [], more: false }); } return; }
    p.sentOnce = true;
    p.inflight = true;
    p.cursor = o.upto;
    if (smax != null) p.scursor = smax;
    p.lastOut = Date.now();
    p.outQ = (p.outQ || 0) + o.items.length;
    p.send({ t: 'net_ch', upto: o.upto, items: o.items, ser, smax, more: o.more || ser.length >= 150 });
    // Accusé attendu : sinon renvoi au prochain passage
    clearTimeout(p.inflT);
    p.inflT = setTimeout(() => { p.inflight = false; }, 15000);
    const done = () => { p.inflight = false; clearTimeout(p.inflT); if (o.more || ser.length >= 150 || p.pending) { p.pending = false; this.pump(p); } };
    p.onAck = done;
  }
  // ---------------------------------------------------------------- numéros de série
  serialLocal(op, contest, txc, holder, nr, call) {
    try { return this.book.serialOp(op, contest, txc, holder, Math.round(Number(nr)) || 0, String(call || '')); } catch (e) { return { nr: 0, warn: 'Numéro de série : ' + e.message }; }
  }
  /** Numéro de série pour un navigateur de ce serveur : maître actif → ici ; poste → demandé au maître (sinon provisoire) */
  serial(op, contest, txc, holder, nr, call) {
    holder = (this.cfg.mode !== 'off' && this.cfg.name ? this.cfg.name : 'serveur') + '/' + holder;
    if (this.cfg.mode === 'off' || this.active()) { const r = this.serialLocal(op, contest, txc, holder, nr, call); this.kick(null, 10); return Promise.resolve(r); }
    const p = this.out && this.out.ready && this.out.active ? this.out : null;
    const local = (why) => { const r = this.serialLocal(op, contest, txc, holder, nr, call); r.warn = (r.warn ? r.warn + ' ' : '') + 'N° PROVISOIRE (' + why + ') : à vérifier quand la liaison revient.'; r.prov = true; return r; };
    if (!p) return Promise.resolve(local('pas de liaison avec le maître'));
    return new Promise((resolve) => {
      const rid = ++this.rid;
      const t = setTimeout(() => { this.wait.delete(rid); resolve(local('le maître ne répond pas')); }, 4000);
      this.wait.set(rid, { p, done: (r) => { clearTimeout(t); resolve(r && r.nr > 0 ? r : local(r && r.notActive ? 'maître en attente' : 'liaison coupée')); } });
      p.send({ t: 'net_ser', rid, op, contest, txc, holder, nr, call });
    });
  }
  // ---------------------------------------------------------------- écran Réseau
  status() {
    const c = this.cfg;
    return {
      v: this.version, mode: c.mode, name: c.name, self: c.self, masters: c.masters, hasKey: !!c.key, keyLen: String(c.key || '').length,
      prio: this.prioOf(), active: this.active(), engine: this.book ? this.book.engine : '',
      seq: this.book ? this.book.maxSeq() : 0,
      out: this.out ? { name: this.out.name, addr: this.out.addr, ready: !!this.out.ready, active: !!this.out.active, prio: this.out.prio, v: this.out.v || '' } : null,
      peers: Array.from(this.peers).filter((p) => p.ready).map((p) => ({ name: p.name, dir: p.dir, master: !!p.master, since: p.since, lastIn: p.lastIn || 0, lastOut: p.lastOut || 0, heard: p.lastHeard || 0, behind: Math.max(0, (this.book ? this.book.maxSeq() : 0) - (p.acked || 0)), inQ: p.inQ || 0, outQ: p.outQ || 0, v: p.v || '', lastQso: p.lastQso ? { t: p.lastQso.k, call: p.lastQso.call, band: p.lastQso.band, mode: p.lastQso.mode, by: p.lastQso.by } : null })),
      events: this.events.slice(0, 15)
    };
  }
}
// Accusé de réception : relance l'envoi suivant
const _onMsg = Net.prototype.onMsg;
Net.prototype.onMsg = function (p, m) {
  if (m && m.t === 'net_ack' && p.onAck) { const f = p.onAck; p.onAck = null; _onMsg.call(this, p, m); f(); return; }
  return _onMsg.call(this, p, m);
};

module.exports = { Net, wsUrl, host };
