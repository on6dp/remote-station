'use strict';
/*
 * refdata.js — listes de références des programmes « on the air » pour le carnet de trafic :
 * IOTA (îles), WWFF (flore et faune), POTA (parcs), BOTA (WWBOTA, bunkers), LLOTA (lacs et lagunes).
 *
 * Le serveur télécharge lui-même chaque liste sur le site officiel (au démarrage si elle manque, puis toutes les
 * semaines, ou tous les 30 jours pour WWBOTA), la garde dans refdata/<PROGRAMME>.json et la cherche en mémoire.
 * Les formats exacts des fichiers peuvent changer : les colonnes sont reconnues d'après leurs titres.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');

const SOURCES = {
  IOTA: { url: 'https://www.iota-world.org/islands-on-the-air/downloads/download-file.html?path=fulllist.json', kind: 'iota', days: 7,
    name: 'IOTA (Islands On The Air)', re: /^[A-Z]{2}-\d{3}$/ },
  WWFF: { url: 'https://wwff.co/wwff-data/wwff_directory.csv', kind: 'csv', days: 7, name: 'WWFF (World Wide Flora & Fauna)', re: /^[A-Z0-9]{1,4}FF-\d{4}$/ },
  POTA: { url: 'https://pota.app/all_parks_ext.csv', kind: 'csv', days: 7, name: 'POTA (Parks On The Air)', re: /^[A-Z0-9]{1,4}-\d{4,5}$/ },
  BOTA: { url: 'https://api.wwbota.org/bunkers/?format=CSV', kind: 'csv', days: 30, name: 'BOTA (Worldwide Bunkers On The Air)', re: /^B\/[A-Z0-9]{1,4}-\d{3,5}$/ },
  LLOTA: { url: 'https://llota.app/api/public/references', kind: 'json', days: 7, name: 'LLOTA (Lagos y Lagunas On The Air)', re: /^[A-Z0-9]{1,4}-[A-Z0-9]{2,6}$/ }
};
const PROGRAMS = Object.keys(SOURCES);

// ------------------------------------------------------------------ lecture des fichiers
/** CSV (RFC 4180) : guillemets, virgules et retours à la ligne dans les champs, BOM ; séparateur , ou ; deviné */
function parseCsv(text) {
  text = String(text).replace(/^﻿/, '');
  const first = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : text.length);
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function pickCol(head, tests) {
  for (const t of tests) {
    const i = head.findIndex((h) => (typeof t === 'string' ? h === t : t.test(h)));
    if (i >= 0) return i;
  }
  return -1;
}
// Colonnes reconnues d'après leurs titres (minuscules, sans espaces ni ponctuation)
const COL_REF = ['reference', 'ref', 'referencecode', 'refno', 'code', 'bunker', 'bunkerref', /reference/, /^ref/];
const COL_NAME = ['name', 'parkname', 'bunkername', 'title', 'nombre', /name$/, /name/];
const COL_LOC = ['locationdesc', 'location', 'country', 'dxccname', 'dxcc', 'entity', 'entityname', 'program', 'state', 'region', 'association', 'pais', /country/, /location/];
const COL_GRID = ['grid', 'locator', 'iarulocator', 'maidenhead', 'gridsquare', /grid/, /locator/];
const COL_ACTIVE = ['active', 'status', 'state'];
function inactive(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '0' || s === 'false' || s === 'no' || s === 'deleted' || s === 'inactive' || s === 'retired' || s === 'closed';
}
function fromRows(rows, re) {
  if (!rows.length) return [];
  const head = rows[0].map(norm);
  const iRef = pickCol(head, COL_REF);
  if (iRef < 0) throw new Error('colonne de référence introuvable (titres : ' + rows[0].slice(0, 12).join(', ') + ')');
  const iName = pickCol(head, COL_NAME.filter((t) => !(typeof t !== 'string' && head[iRef] && t.test(head[iRef]))));
  const iLoc = pickCol(head, COL_LOC);
  const iGrid = pickCol(head, COL_GRID);
  const iAct = head.findIndex((h) => h === 'active' || h === 'status');
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const ref = String(row[iRef] || '').trim().toUpperCase();
    if (!ref || (re && !re.test(ref) && !/^[A-Z0-9/]{1,6}-[A-Z0-9]{2,6}$/.test(ref))) continue;
    if (iAct >= 0 && inactive(row[iAct])) continue;
    out.push([ref, iName >= 0 ? String(row[iName] || '').trim() : '', iLoc >= 0 ? String(row[iLoc] || '').trim() : '', iGrid >= 0 ? String(row[iGrid] || '').trim().toUpperCase() : '']);
  }
  return out;
}
/** JSON quelconque : tableau d'objets (ou objet avec un tableau dedans) → lignes [titres…] */
function jsonRows(data) {
  let arr = Array.isArray(data) ? data : null;
  if (!arr && data && typeof data === 'object') {
    for (const k of ['references', 'data', 'results', 'items', 'list', 'refs']) if (Array.isArray(data[k])) { arr = data[k]; break; }
    if (!arr) for (const v of Object.values(data)) if (Array.isArray(v) && v.length && typeof v[0] === 'object') { arr = v; break; }
  }
  if (!arr || !arr.length) return [];
  const keys = Array.from(new Set(arr.slice(0, 50).flatMap((o) => (o && typeof o === 'object' ? Object.keys(o) : []))));
  const flat = (v) => (v == null ? '' : typeof v === 'object' ? (v.name || v.code || '') : v);
  return [keys].concat(arr.map((o) => keys.map((k) => flat(o && o[k]))));
}
/** IOTA (fulllist.json) : on parcourt tout l'arbre et on garde les objets « groupe » (référence XX-000 + nom) */
function fromIota(data) {
  const seen = new Map();
  const walk = (o, depth) => {
    if (!o || depth > 8) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    if (typeof o !== 'object') return;
    const keys = Object.keys(o);
    const kRef = keys.find((k) => /^(refno|ref|iota|reference|ref_no|grp_ref|group_ref)$/i.test(k) && /^[A-Z]{2}-\d{3}$/i.test(String(o[k]).trim()));
    if (kRef) {
      const ref = String(o[kRef]).trim().toUpperCase();
      const kName = keys.find((k) => /^(name|group_name|grp_name|groupname|title)$/i.test(k));
      const kDx = keys.find((k) => /dxcc/i.test(k) && typeof o[k] !== 'object');
      if (!seen.has(ref)) seen.set(ref, [ref, kName ? String(o[kName]).trim() : '', kDx ? String(o[kDx]).trim() : '', '']);
      else if (!seen.get(ref)[1] && kName) seen.get(ref)[1] = String(o[kName]).trim();
    }
    for (const k of keys) if (o[k] && typeof o[k] === 'object') walk(o[k], depth + 1);
  };
  walk(data, 0);
  return Array.from(seen.values()).sort((a, b) => a[0].localeCompare(b[0]));
}
function parse(prog, buf) {
  const S = SOURCES[prog];
  const text = buf.toString('utf8');
  if (S.kind === 'csv' && /^\s*[[{]/.test(text)) return fromRows(jsonRows(JSON.parse(text)), S.re); // format changé : JSON
  if (S.kind === 'csv') return fromRows(parseCsv(text), S.re);
  const data = JSON.parse(text);
  if (S.kind === 'iota') return fromIota(data);
  return fromRows(jsonRows(data), S.re);
}

// ------------------------------------------------------------------ téléchargement
function fetchUrl(url, redirects) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'RemoteStation-UBA-LGE (ON5VL club remote station; logbook references)', 'Accept-Encoding': 'gzip, deflate', Accept: '*/*' }, timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if ((redirects || 0) > 5) return reject(new Error('trop de redirections'));
        return resolve(fetchUrl(new URL(res.headers.location, url).toString(), (redirects || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let stream = res;
      const enc = String(res.headers['content-encoding'] || '');
      if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip());
      else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());
      const parts = [];
      let n = 0;
      stream.on('data', (c) => { n += c.length; if (n > 120 * 1024 * 1024) { req.destroy(); reject(new Error('fichier trop gros')); } else parts.push(c); });
      stream.on('end', () => resolve(Buffer.concat(parts)));
      stream.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
  });
}

// ------------------------------------------------------------------ magasin
class RefData {
  constructor(dir, log) {
    this.dir = dir;
    this.log = log || (() => {});
    this.lists = {};   // PROG → [[ref, nom, lieu, locator]]
    this.byRef = {};   // PROG → Map(ref → ligne)
    this.status = {};  // PROG → { count, at, err, busy }
    for (const p of PROGRAMS) {
      this.status[p] = { count: 0, at: 0, err: '', busy: false };
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, p + '.json'), 'utf8'));
        if (Array.isArray(d.list)) this._set(p, d.list, d.at || 0);
      } catch (e) { /* pas encore téléchargée */ }
    }
  }
  _set(p, list, at) {
    this.lists[p] = list;
    this.byRef[p] = new Map(list.map((x) => [x[0], x]));
    this.status[p].count = list.length;
    this.status[p].at = at;
  }
  /** Télécharge les listes manquantes ou trop vieilles (une à la fois). */
  async refresh(force) {
    if (this.running) return;
    this.running = true;
    try {
      for (const p of PROGRAMS) {
        const st = this.status[p];
        const old = Date.now() - st.at > SOURCES[p].days * 86400000;
        const retry = !st.err || Date.now() - (st.errAt || 0) > 6 * 3600000;
        if (!force && !(old && retry)) continue;
        st.busy = true;
        try {
          const buf = await fetchUrl(SOURCES[p].url);
          const list = parse(p, buf);
          if (list.length < 20) throw new Error('liste presque vide (' + list.length + ' références) : format inattendu');
          try { fs.mkdirSync(this.dir, { recursive: true }); } catch (e) { /* */ }
          const at = Date.now();
          fs.writeFileSync(path.join(this.dir, p + '.json.tmp'), JSON.stringify({ at, source: SOURCES[p].url, list }));
          fs.renameSync(path.join(this.dir, p + '.json.tmp'), path.join(this.dir, p + '.json'));
          this._set(p, list, at);
          st.err = '';
          this.log('Références ' + p + ' : ' + list.length + ' téléchargées');
        } catch (e) {
          st.err = e.message;
          st.errAt = Date.now();
          this.log('Références ' + p + ' : téléchargement impossible (' + e.message + ')');
        }
        st.busy = false;
      }
    } finally {
      this.running = false;
    }
  }
  /**
   * Recherche dans une liste : q = début de référence ou morceau du nom ; hint = préfixe DXCC du correspondant
   * (ses références passent en premier). Sans texte : les références de son pays.
   */
  search(prog, q, hint, limit) {
    const list = this.lists[prog];
    if (!list) return [];
    limit = Math.max(1, Math.min(50, limit || 25));
    const Q = String(q || '').trim().toUpperCase();
    const qn = String(q || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const H = String(hint || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const hintRef = (r) => !!H && (r.startsWith(H + '-') || r.startsWith(H + 'FF-') || r.startsWith('B/' + H + '-') || r.startsWith(H + '/'));
    if (!Q && !H) return [];
    const out = [];
    for (const x of list) {
      const r = x[0];
      let s = 0;
      if (Q) {
        if (r === Q) s = 100;
        else if (r.startsWith(Q)) s = 60;
        else if (r.replace(/^B\//, '').startsWith(Q)) s = 55;
        else if (qn.length >= 2 && (x[1].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(qn) || x[2].toLowerCase().includes(qn))) s = 30;
        else continue;
      }
      if (hintRef(r)) s += 20;
      else if (!Q) continue;
      out.push([s, x]);
      if (out.length > 4000 && !Q) break;
    }
    out.sort((a, b) => b[0] - a[0] || a[1][0].localeCompare(b[1][0], 'en', { numeric: true }));
    return out.slice(0, limit).map(([, x]) => ({ ref: x[0], name: x[1], loc: x[2], grid: x[3] }));
  }
  get(prog, ref) {
    const m = this.byRef[prog];
    const x = m && m.get(String(ref || '').toUpperCase());
    return x ? { ref: x[0], name: x[1], loc: x[2], grid: x[3] } : null;
  }
  summary() {
    const o = {};
    for (const p of PROGRAMS) o[p] = { count: this.status[p].count, at: this.status[p].at, err: this.status[p].err, busy: this.status[p].busy };
    return o;
  }
}

module.exports = { RefData, SOURCES, PROGRAMS, parseCsv, parse, fromIota };
