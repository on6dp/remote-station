'use strict';
/*
 * lotw-agent.js — côté serveur de l'« Agent LoTW » (agent/agent-lotw.js sur le PC du membre où TQSL est installé).
 *
 * - Appairage : le membre demande un code dans le carnet (8 caractères, 15 minutes, une seule fois) ; l'agent le
 *   présente une fois et reçoit en échange un jeton propre à ce PC. Le serveur ne garde que l'empreinte SHA-256 du
 *   jeton (lotw-agents.json, jamais publié). Le mot de passe du membre n'est jamais demandé à l'agent.
 * - L'agent ne peut que recevoir des lots ADIF à signer pour les indicatifs de son titulaire (le sien ; pour un
 *   administrateur, aussi ceux du club) et renvoyer le code de sortie de TQSL. Il ne lit rien d'autre.
 */
const fs = require('fs');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const AGENT_VERSION = 2; // version de agent/agent-lotw.js livrée avec ce serveur (mise à jour automatique des agents)
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').slice(0, n || 80);

class LotwAgents extends EventEmitter {
  /**
   * @param {object} o  file, owner(call) → { call, admin } | null (compte actif), calls(owner) → indicatifs permis,
   *                    send(conn, msg), journal(type, data)
   */
  constructor(o) {
    super();
    this.o = o;
    this.reg = [];
    this.codes = new Map();   // code → { owner, exp }
    this.live = new Map();    // id → { conn, id, owner, name, info, v, since }
    this.wait = new Map();    // rid → { resolve, reject, timer, id }
    this.fails = new Map();   // ip → { n, until }
    try { const r = JSON.parse(fs.readFileSync(o.file, 'utf8')); if (Array.isArray(r)) this.reg = r; } catch (e) { /* aucun agent */ }
  }
  save() {
    const tmp = this.o.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.reg, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.o.file);
  }
  /** Code d'appairage pour ce membre (un seul valable à la fois) */
  newCode(owner) {
    for (const [k, v] of this.codes) if (v.owner === owner || v.exp < Date.now()) this.codes.delete(k);
    let code = '';
    const b = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) code += ALPHA[b[i] % 32];
    const exp = Date.now() + 15 * 60000;
    this.codes.set(code, { owner, exp });
    return { code: code.slice(0, 4) + '-' + code.slice(4), exp };
  }
  limited(ip) { const f = this.fails.get(ip); return !!(f && f.until > Date.now()); }
  failed(ip) {
    const f = this.fails.get(ip);
    const n = (f && f.until > Date.now() - 600000 ? f.n : 0) + 1;
    this.fails.set(ip, { n, until: n >= 6 ? Date.now() + 10 * 60000 : 0 });
  }
  refuse(conn, msg, forget) {
    this.o.send(conn, { t: 'lotw_agent_fail', msg, forget: !!forget });
    setTimeout(() => { try { conn.close(4003, 'agent refusé'); } catch (e) { /* fermée */ } }, 300);
  }
  /** Premier message d'une liaison d'agent : appairage (code) ou connexion (id + jeton) */
  accept(conn, m) {
    conn.isAgent = true;
    if (this.limited(conn.ip)) return this.refuse(conn, 'trop d’essais, réessayez dans quelques minutes');
    if (m.t === 'lotw_agent_pair') {
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const p = this.codes.get(code);
      if (!p || p.exp < Date.now()) { this.failed(conn.ip); this.o.journal('lotw_agent_pair_fail', { ip: conn.ip }); return this.refuse(conn, 'code inconnu ou expiré (15 minutes) : demandez-en un nouveau dans le carnet'); }
      this.codes.delete(code);
      if (!this.o.owner(p.owner)) return this.refuse(conn, 'compte ' + p.owner + ' hors service');
      const token = crypto.randomBytes(32).toString('base64url');
      const a = { id: crypto.randomBytes(9).toString('base64url'), owner: p.owner, name: clean(m.name, 40) || 'PC', hash: sha(token), created: Date.now(), seen: 0 };
      this.reg.push(a);
      this.save();
      this.o.journal('lotw_agent_paired', { call: p.owner, name: a.name, ip: conn.ip });
      this.o.send(conn, { t: 'lotw_agent_paired', id: a.id, token, owner: a.owner });
      setTimeout(() => { try { conn.close(1000, 'appairé'); } catch (e) { /* fermée */ } }, 300);
      this.emit('change');
      return;
    }
    const a = this.reg.find((x) => x.id === m.id);
    if (!a || !safeEq(a.hash, sha(m.token || ''))) { this.failed(conn.ip); this.o.journal('lotw_agent_refused', { ip: conn.ip }); return this.refuse(conn, 'appairage inconnu ou retiré : appairez à nouveau ce PC', true); }
    const u = this.o.owner(a.owner);
    if (!u) return this.refuse(conn, 'compte ' + a.owner + ' hors service');
    const old = this.live.get(a.id);
    if (old && old.conn !== conn) { try { old.conn.close(4004, 'remplacé'); } catch (e) { /* fermée */ } }
    a.seen = Date.now();
    a.name = clean(m.name, 40) || a.name;
    this.save();
    const ag = { conn, id: a.id, owner: a.owner, name: a.name, v: Number(m.v) || 0, info: this.cleanInfo(m.info), since: Date.now(), ip: conn.ip };
    conn.agentId = a.id;
    this.live.set(a.id, ag);
    this.o.journal('lotw_agent_on', { call: a.owner, name: a.name, ip: conn.ip });
    this.o.send(conn, { t: 'lotw_agent_ok', owner: a.owner, calls: this.o.calls(a.owner), agentV: AGENT_VERSION });
    this.emit('change');
    this.emit('ready', ag);
  }
  cleanInfo(i) {
    i = i && typeof i === 'object' ? i : {};
    const locs = Array.isArray(i.locations) ? i.locations.slice(0, 50).map((l) => ({ name: clean(l && l.name, 80), call: clean(l && l.call, 15).toUpperCase(), grid: clean(l && l.grid, 6) })).filter((l) => l.name) : [];
    return { tqsl: !!i.tqsl, dir: !!i.dir, os: clean(i.os, 10), locations: locs };
  }
  onMsg(conn, m) {
    const ag = this.live.get(conn.agentId);
    if (!ag || ag.conn !== conn) return;
    if (m.t === 'ping') return this.o.send(conn, { t: 'pong' });
    if (m.t === 'lotw_agent_info') { ag.info = this.cleanInfo(m.info); this.emit('change'); return; }
    if (m.t === 'lotw_signed') {
      const w = this.wait.get(String(m.rid || ''));
      if (!w || w.id !== ag.id) return;
      this.wait.delete(m.rid);
      clearTimeout(w.timer);
      w.resolve({ code: Number.isInteger(m.code) ? m.code : -1, out: clean(m.out, 300), err: clean(m.err, 200) });
    }
  }
  closed(conn) {
    const ag = this.live.get(conn.agentId);
    if (!ag || ag.conn !== conn) return;
    this.live.delete(ag.id);
    for (const [rid, w] of this.wait) if (w.id === ag.id) { this.wait.delete(rid); clearTimeout(w.timer); w.reject(new Error('le PC « ' + ag.name + ' » s’est déconnecté pendant la signature')); }
    this.o.journal('lotw_agent_off', { call: ag.owner, name: ag.name });
    this.emit('change');
  }
  /** Agent connecté capable de signer pour cet indicatif (de préférence un qui a un lieu de station pour lui) */
  forCall(call) {
    call = String(call || '').toUpperCase();
    const ok = [];
    for (const ag of this.live.values()) {
      if (!this.o.owner(ag.owner) || this.o.calls(ag.owner).indexOf(call) < 0) continue;
      ok.push(ag);
    }
    if (!ok.length) return null;
    const best = ok.find((ag) => ag.info.locations.some((l) => l.call === call)) || ok[0];
    const self = this;
    return {
      name: best.name,
      owner: best.owner,
      /** Lieu de station TQSL à utiliser : celui demandé s'il existe sur le PC, sinon le seul de cet indicatif */
      location(want) {
        const all = best.info.locations;
        const w = String(want || '').trim().toLowerCase();
        const hit = w && all.find((l) => l.name.toLowerCase() === w);
        if (hit) return { name: hit.name };
        const mine = all.filter((l) => l.call === call);
        if (mine.length === 1) return { name: mine[0].name };
        if (!best.info.tqsl) return { err: 'TQSL est introuvable sur le PC « ' + best.name + ' »' };
        if (!mine.length) return { err: 'aucun lieu de station TQSL pour ' + call + ' sur le PC « ' + best.name + ' » : créez-le dans TQSL (Station Locations → New)' + (all.length ? ' — lieux présents : ' + all.map((l) => l.name + ' (' + (l.call || '?') + ')').join(', ') : '') };
        return { err: 'plusieurs lieux de station pour ' + call + ' sur le PC « ' + best.name + ' » (' + mine.map((l) => l.name).join(', ') + ') : indiquez lequel dans « Lieu de station TQSL » des identifiants LoTW de ' + call };
      },
      sign(location, adif, n) {
        return new Promise((resolve, reject) => {
          if (!self.live.has(best.id)) return reject(new Error('PC « ' + best.name + ' » déconnecté'));
          const rid = crypto.randomBytes(8).toString('hex');
          const timer = setTimeout(() => { self.wait.delete(rid); reject(new Error('pas de réponse de TQSL sur le PC « ' + best.name + ' » (5 minutes)')); }, 300000);
          self.wait.set(rid, { resolve, reject, timer, id: best.id });
          self.o.send(best.conn, { t: 'lotw_sign', rid, location, adif, n });
        });
      }
    };
  }
  conns() { return Array.from(this.live.values()).map((a) => a.conn); }
  /** Indicatifs servis par un agent connecté (rattrapage des envois automatiques) */
  servedCalls(ag) { return this.o.owner(ag.owner) ? this.o.calls(ag.owner) : []; }
  /** Vue pour le carnet : les agents du membre (un administrateur les voit tous) */
  list(user) {
    return this.reg.filter((a) => user.admin || a.owner === user.call).map((a) => {
      const l = this.live.get(a.id);
      const calls = this.o.owner(a.owner) ? this.o.calls(a.owner) : [];
      return {
        id: a.id, owner: a.owner, name: a.name, created: a.created, seen: l ? Date.now() : a.seen, on: !!l, since: l ? l.since : 0,
        tqsl: l ? l.info.tqsl : null, old: l ? l.v < AGENT_VERSION : false,
        locations: l ? l.info.locations.map((x) => ({ name: x.name, call: x.call, ok: calls.indexOf(x.call) >= 0 })) : [], calls
      };
    });
  }
  remove(id, user) {
    const i = this.reg.findIndex((a) => a.id === id && (user.admin || a.owner === user.call));
    if (i < 0) return false;
    const a = this.reg.splice(i, 1)[0];
    this.save();
    const l = this.live.get(a.id);
    if (l) { this.o.send(l.conn, { t: 'lotw_agent_fail', msg: 'appairage retiré par ' + user.call, forget: true }); try { l.conn.close(4003, 'retiré'); } catch (e) { /* fermée */ } }
    this.o.journal('lotw_agent_del', { call: user.call, owner: a.owner, name: a.name });
    this.emit('change');
    return true;
  }
}

module.exports = { LotwAgents, AGENT_VERSION };
