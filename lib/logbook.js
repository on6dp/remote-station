'use strict';
/*
 * logbook.js — carnet de trafic de la station (base SQLite logbook.db, sinon logbook.json) et formats d'échange ADIF 3 et Cabrillo 3.
 *
 * Chaque QSO est un objet aux noms de champs ADIF (en minuscules) : call, qso_date (AAAAMMJJ), time_on (HHMMSS),
 * time_off, freq (MHz), band, mode, submode, rst_sent, rst_rcvd, name, qth, gridsquare, comment, operator,
 * station_callsign, my_gridsquare, stx, srx, stx_string, srx_string, prop_mode, sat_name, freq_rx, band_rx, tx_pwr,
 * références : iota, wwff_ref, pota_ref, bota_ref, llota_ref, sota_ref (correspondant) et my_… (station en activation),
 * plus id, created (ms), by (indicatif du membre qui l'a enregistré) et up (envois aux logs en ligne :
 * { lotw|eqsl|clublog|qrz: { t, ok, msg } }).
 */
const fs = require('fs');
const crypto = require('crypto');

const BANDS = [
  ['2190m', 0.1357, 0.1378], ['630m', 0.472, 0.479], ['160m', 1.8, 2.0], ['80m', 3.5, 4.0], ['60m', 5.06, 5.45], ['40m', 7.0, 7.3],
  ['30m', 10.1, 10.15], ['20m', 14.0, 14.35], ['17m', 18.068, 18.168], ['15m', 21.0, 21.45], ['12m', 24.89, 24.99],
  ['10m', 28.0, 29.7], ['6m', 50, 54], ['4m', 70, 71], ['2m', 144, 148], ['1.25m', 222, 225], ['70cm', 420, 450],
  ['33cm', 902, 928], ['23cm', 1240, 1300], ['13cm', 2300, 2450], ['9cm', 3300, 3500], ['6cm', 5650, 5925],
  ['3cm', 10000, 10500], ['1.25cm', 24000, 24250]
];
function bandOf(mhz) {
  const f = Number(mhz);
  const b = BANDS.find((x) => f >= x[1] && f <= x[2]);
  return b ? b[0] : '';
}

// Modes proposés dans le dashboard → MODE / SUBMODE ADIF
const MODES = {
  SSB: ['SSB', ''], USB: ['SSB', 'USB'], LSB: ['SSB', 'LSB'], CW: ['CW', ''], AM: ['AM', ''], FM: ['FM', ''],
  RTTY: ['RTTY', ''], FT8: ['FT8', ''], FT4: ['MFSK', 'FT4'], FT2: ['MFSK', 'FT2'], JT65: ['JT65', ''], JT65A: ['JT65', 'JT65A'],
  JTTY: ['MFSK', 'JTTY'], SSTV: ['SSTV', ''], PSK31: ['PSK', 'PSK31'], WSPR: ['WSPR', ''], C4FM: ['DIGITALVOICE', 'C4FM'],
  DATA: ['DATA', '']
};
const MODE_NAMES = Object.keys(MODES);
/** Nom affiché (FT4, USB…) d'un QSO */
function modeName(q) { return q.submode && q.mode !== 'SSB' ? q.submode : q.submode || q.mode; }

// ADIF : texte ASCII (les accents sont retirés : « José » → « Jose »)
const ascii = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').trim();
const up = (s) => ascii(s).toUpperCase();
const F = (name, v) => { const s = ascii(v); return s === '' ? '' : '<' + name.toUpperCase() + ':' + s.length + '>' + s; };
const ADIF_FIELDS = ['call', 'qso_date', 'time_on', 'qso_date_off', 'time_off', 'band', 'freq', 'band_rx', 'freq_rx', 'mode', 'submode',
  'rst_sent', 'rst_rcvd', 'stx', 'srx', 'stx_string', 'srx_string', 'name', 'qth', 'country', 'state', 'cnty', 'cqz', 'ituz', 'cont', 'gridsquare', 'comment', 'prop_mode', 'sat_name',
  'tx_pwr', 'operator', 'station_callsign', 'my_gridsquare', 'contest_id', 'iota', 'wwff_ref', 'pota_ref', 'sota_ref', 'my_iota', 'my_wwff_ref', 'my_pota_ref', 'my_sota_ref'];
// Références des programmes « on the air » : champs du carnet → programme (IOTA, WWFF, POTA et SOTA ont leur champ ADIF ;
// BOTA et LLOTA passent par SIG / SIG_INFO, BOTA d'abord, et par des champs APP_ pour garder les deux)
const REF_FIELDS = { iota: 'IOTA', wwff_ref: 'WWFF', pota_ref: 'POTA', bota_ref: 'BOTA', llota_ref: 'LLOTA', sota_ref: 'SOTA',
  // Diplômes sans liste téléchargeable (saisie libre) : communes espagnoles (URE), châteaux et abbayes d'Italie, phares (ARLHS)
  dme_ref: 'DME', dci_ref: 'DCI', dai_ref: 'DAI', arlhs_ref: 'ARLHS' };
// SIG / SIG_INFO (un seul programme par QSO dans l'ADIF) : ordre de priorité ; tous gardés aussi en APP_REMOTESTATION_…
const SIG_ORDER = [['bota_ref', 'WWBOTA'], ['llota_ref', 'LLOTA'], ['dme_ref', 'DME'], ['dci_ref', 'DCI'], ['dai_ref', 'DAI'], ['arlhs_ref', 'ARLHS']];
function sigFields(q) {
  const o = {};
  for (const pre of ['', 'my_']) {
    const first = SIG_ORDER.find(([k]) => q[pre + k]);
    if (first) { o[pre + 'sig'] = first[1]; o[pre + 'sig_info'] = q[pre + first[0]]; }
    for (const [k] of SIG_ORDER) if (q[pre + k]) o['app_remotestation_' + pre + k.replace(/_ref$/, '')] = q[pre + k];
  }
  return o;
}

function adifRecord(q, extra) {
  let s = '';
  for (const k of ADIF_FIELDS) s += F(k, q[k]);
  for (const [k, v] of Object.entries(sigFields(q))) s += F(k, v);
  for (const [k, v] of Object.entries(extra || {})) s += F(k, v);
  return s + '<EOR>\n';
}
function adifHeader(app, version) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace('T', ' ').slice(0, 15);
  return 'Remote Station UBA-LGE - export ADIF\n' + F('adif_ver', '3.1.4') + F('created_timestamp', now) + F('programid', app || 'RemoteStation') +
    F('programversion', version || '') + '<EOH>\n';
}
function toAdif(list, app, version) {
  return adifHeader(app, version) + list.map((q) => adifRecord(q)).join('');
}

// Cabrillo 3.0 — https://wwrof.org/cabrillo/
function cabBand(mhz) {
  const f = Number(mhz);
  if (f < 30) return String(Math.round(f * 1000));
  const t = [[50, 54, '50'], [70, 71, '70'], [144, 148, '144'], [222, 225, '222'], [420, 450, '432'], [902, 928, '902'],
    [1240, 1300, '1.2G'], [2300, 2450, '2.3G'], [3300, 3500, '3.4G'], [5650, 5925, '5.7G'], [10000, 10500, '10G'], [24000, 24250, '24G']];
  const b = t.find((x) => f >= x[0] && f <= x[1]);
  return b ? b[2] : String(Math.round(f * 1000));
}
function cabMode(q) {
  if (q.mode === 'CW') return 'CW';
  if (q.mode === 'SSB' || q.mode === 'AM') return 'PH';
  if (q.mode === 'FM') return 'FM';
  if (q.mode === 'RTTY') return 'RY';
  return 'DG';
}
function toCabrillo(list, o) {
  o = o || {};
  const ops = Array.from(new Set(list.map((q) => up(q.operator)).filter(Boolean)));
  // Catégorie choisie (page Poste SSB / CW) : valeurs Cabrillo 3.0 reconnues seulement
  const CAT_OK = {
    OPERATOR: ['SINGLE-OP', 'MULTI-OP', 'CHECKLOG'], ASSISTED: ['ASSISTED', 'NON-ASSISTED'],
    BAND: ['ALL', '160M', '80M', '40M', '20M', '15M', '10M', '6M', '2M'], POWER: ['HIGH', 'LOW', 'QRP'], MODE: ['CW', 'SSB', 'MIXED', 'DIGI', 'RTTY', 'FM'],
    STATION: ['FIXED', 'MOBILE', 'PORTABLE', 'DISTRIBUTED', 'EXPEDITION', 'HQ', 'SCHOOL'], TRANSMITTER: ['ONE', 'TWO', 'LIMITED', 'UNLIMITED', 'SWL'],
    OVERLAY: ['CLASSIC', 'ROOKIE', 'TB-WIRES', 'YOUTH', 'NOVICE-TECH', 'OVER-50'], TIME: ['6-HOURS', '8-HOURS', '12-HOURS', '24-HOURS']
  };
  const cat = {};
  for (const k of Object.keys(CAT_OK)) { const v = o.cat && up(o.cat[k]); if (v && CAT_OK[k].indexOf(v) >= 0) cat[k] = v; }
  const lines = ['START-OF-LOG: 3.0', 'CREATED-BY: Remote Station UBA-LGE ' + (o.version || ''), 'CALLSIGN: ' + up(o.callsign),
    'CONTEST: ' + (up(o.contest) || 'DX'), 'CATEGORY-OPERATOR: ' + (cat.OPERATOR || (ops.length > 1 ? 'MULTI-OP' : 'SINGLE-OP'))];
  if (cat.ASSISTED) lines.push('CATEGORY-ASSISTED: ' + cat.ASSISTED);
  if (cat.BAND) lines.push('CATEGORY-BAND: ' + cat.BAND);
  if (cat.MODE) lines.push('CATEGORY-MODE: ' + cat.MODE);
  if (cat.POWER) lines.push('CATEGORY-POWER: ' + cat.POWER);
  lines.push('CATEGORY-STATION: ' + (cat.STATION || 'FIXED'), 'CATEGORY-TRANSMITTER: ' + (cat.TRANSMITTER || 'ONE'));
  if (cat.OVERLAY) lines.push('CATEGORY-OVERLAY: ' + cat.OVERLAY);
  if (cat.TIME) lines.push('CATEGORY-TIME: ' + cat.TIME);
  if (o.location && /^[A-Z0-9]{2,6}$/.test(up(o.location))) lines.push('LOCATION: ' + up(o.location));
  if (o.grid) lines.push('GRID-LOCATOR: ' + up(o.grid));
  if (o.club) lines.push('CLUB: ' + up(o.club));
  if (ops.length) lines.push('OPERATORS: ' + ops.join(' '));
  if (o.soapbox) lines.push('SOAPBOX: ' + ascii(o.soapbox));
  const pad = (s, n) => String(s).padEnd(n);
  for (const q of list) {
    const d = q.qso_date.slice(0, 4) + '-' + q.qso_date.slice(4, 6) + '-' + q.qso_date.slice(6, 8);
    const exS = up(q.stx_string || (q.stx != null && q.stx !== '' ? String(q.stx).padStart(3, '0') : '') || (q.my_gridsquare || '').slice(0, 4));
    const exR = up(q.srx_string || (q.srx != null && q.srx !== '' ? String(q.srx).padStart(3, '0') : '') || (q.gridsquare || '').slice(0, 4));
    lines.push('QSO: ' + pad(cabBand(q.freq), 5) + ' ' + cabMode(q) + ' ' + d + ' ' + q.time_on.slice(0, 4) + ' ' + pad(up(q.station_callsign), 13) + ' ' +
      pad(up(q.rst_sent) || '59', 3) + ' ' + pad(exS, 6) + ' ' + pad(up(q.call), 13) + ' ' + pad(up(q.rst_rcvd) || '59', 3) + ' ' + exR);
  }
  lines.push('END-OF-LOG:');
  return lines.join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------ vérification d'un QSO reçu du dashboard
const CALL_RE = /^[A-Z0-9]{1,4}(\/[A-Z0-9]{1,4})?[0-9][A-Z0-9]{0,4}[A-Z](\/[A-Z0-9]{1,4})?$/;
const GRID_RE = /^[A-R]{2}[0-9]{2}([A-X]{2}([0-9]{2})?)?$/;
function clean(input, ctx) {
  const i = input || {};
  const q = {};
  q.call = up(i.call).replace(/\s+/g, '');
  if (!CALL_RE.test(q.call)) throw new Error('indicatif du correspondant invalide');
  q.qso_date = String(i.qso_date || '').replace(/\D/g, '');
  q.time_on = String(i.time_on || '').replace(/\D/g, '').padEnd(6, '0').slice(0, 6);
  if (!/^20\d{6}$/.test(q.qso_date) || !/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(q.time_on)) throw new Error('date ou heure UTC invalide');
  const when = Date.UTC(+q.qso_date.slice(0, 4), +q.qso_date.slice(4, 6) - 1, +q.qso_date.slice(6, 8), +q.time_on.slice(0, 2), +q.time_on.slice(2, 4));
  if (when > Date.now() + 10 * 60000) throw new Error('date du QSO dans le futur');
  if (i.time_off) {
    q.time_off = String(i.time_off).replace(/\D/g, '').padEnd(6, '0').slice(0, 6);
    q.qso_date_off = String(i.qso_date_off || q.qso_date).replace(/\D/g, '');
  }
  const f = Number(i.freq);
  if (!(f > 0.1 && f < 250000)) throw new Error('fréquence invalide');
  q.freq = f.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  q.band = bandOf(f);
  if (!q.band) throw new Error('fréquence hors des bandes radioamateurs');
  const m = MODES[String(i.mode || '').toUpperCase()];
  if (!m) throw new Error('mode inconnu');
  q.mode = m[0];
  if (m[1]) q.submode = m[1];
  for (const k of ['rst_sent', 'rst_rcvd']) if (i[k]) q[k] = up(i[k]).slice(0, 8);
  if (i.name) q.name = ascii(i.name).slice(0, 40);
  if (i.qth) q.qth = ascii(i.qth).slice(0, 60);
  if (i.comment) q.comment = ascii(i.comment).slice(0, 200);
  if (i.gridsquare) { const g = up(i.gridsquare); if (!GRID_RE.test(g)) throw new Error('locator invalide'); q.gridsquare = g; }
  // Diplômes (statistiques du carnet) : État US / province (WAS), comté, zones CQ et UIT, continent
  if (i.state) { const v = up(i.state).replace(/[^A-Z]/g, '').slice(0, 3); if (v) q.state = v; }
  if (i.cnty) q.cnty = ascii(i.cnty).slice(0, 40);
  if (i.cqz) { const z = parseInt(i.cqz, 10); if (z >= 1 && z <= 40) q.cqz = String(z); }
  if (i.ituz) { const z = parseInt(i.ituz, 10); if (z >= 1 && z <= 90) q.ituz = String(z); }
  if (i.cont && /^(AF|AN|AS|EU|NA|OC|SA)$/i.test(String(i.cont))) q.cont = up(i.cont);
  for (const k of ['stx', 'srx']) if (i[k] !== undefined && i[k] !== '' && i[k] !== null) { const n = parseInt(i[k], 10); if (n >= 0 && n < 100000) q[k] = String(n); }
  for (const k of ['stx_string', 'srx_string']) if (i[k]) q[k] = up(i[k]).slice(0, 30);
  if (i.tx_pwr) { const p = Number(i.tx_pwr); if (p > 0 && p <= 2000) q.tx_pwr = String(p); }
  // QO-100 : montée 2,4 GHz, descente 10,489 GHz
  if (i.qo100) {
    q.prop_mode = 'SAT';
    q.sat_name = 'QO-100';
    if (!(f >= 2400 && f <= 2400.5)) throw new Error('QO-100 : fréquence de montée attendue entre 2400,000 et 2400,500 MHz');
    q.freq_rx = (f + 8089.5).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    q.band_rx = '3cm';
  }
  q.operator = up(ctx.operator);
  q.station_callsign = up(ctx.stationCallsign);
  if (ctx.myGrid) q.my_gridsquare = up(ctx.myGrid);
  if (i.contest_id) q.contest_id = up(i.contest_id).slice(0, 40);
  // Références (plusieurs possibles, séparées par des virgules, ex. deux parcs POTA)
  for (const k of Object.keys(REF_FIELDS)) {
    for (const pre of ['', 'my_']) {
      const v = i[pre + k];
      if (v == null || v === '') continue;
      // Espaces : retirés ; ARLHS « BEL 001 » → « BEL-001 »
      const s = up(v).trim().replace(k === 'arlhs_ref' ? /([A-Z])\s+(?=\d)/g : /^$/, '$1-').replace(/\s+/g, '').replace(/,+$/, '').slice(0, 80);
      if (!s) continue;
      if (!/^[A-Z0-9/@-]{3,20}(,[A-Z0-9/@-]{3,20})*$/.test(s)) throw new Error('référence ' + REF_FIELDS[k] + (pre ? ' (station)' : '') + ' invalide : ' + s);
      q[pre + k] = s;
    }
  }
  return q;
}

// ------------------------------------------------------------------ stockage
// Base SQLite intégrée à Node.js (node:sqlite, Node 22.13 et plus) : logbook.db à côté de logbook.json. Chaque QSO est
// écrit seul (quelques millisecondes), au lieu de réécrire tout le fichier. Sans SQLite (Node trop ancien) : logbook.json.
// Préparée pour la mise en réseau (plusieurs postes, un log commun) : chaque QSO garde le poste qui l'a fait (node),
// sa version et l'heure de sa dernière modification ; table « changes » (journal des ajouts / corrections / suppressions,
// pour ne renvoyer aux postes que ce qui a changé) ; table « serials » (numéros de série de contest réservés par poste).
let SQL = null;
function sqlite() {
  if (SQL !== null) return SQL;
  SQL = false;
  // « SQLite is an experimental feature » : avertissement de Node, sans intérêt ici
  const emit = process.emitWarning;
  process.emitWarning = function (w, ...a) { if (/SQLite/i.test(String(w && w.message ? w.message : w))) return; return emit.call(process, w, ...a); };
  try { SQL = require('node:sqlite'); } catch (e) { SQL = false; } finally { process.emitWarning = emit; }
  return SQL;
}
// Empreinte rapide (FNV-1a 32 bits) du contenu d'un QSO : repère ceux modifiés hors des méthodes du carnet
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const SCHEMA = 1;

class Logbook {
  /**
   * @param {string} file chemin de logbook.json (la base est le même nom en .db)
   * @param {{ node?: string, sqlite?: boolean }} [o] node : nom de ce poste (mise en réseau) ; sqlite: false = rester en JSON
   */
  constructor(file, o) {
    o = o || {};
    this.file = file;
    this.node = String(o.node || 'serveur').slice(0, 40);
    this.qsos = [];
    this.rev = 0; // compteur de modifications (indicatifs déjà contactés envoyés aux pages)
    this.dirty = new Set();  // QSO à écrire dans la base
    this.gone = new Set();   // identifiants supprimés à retirer de la base
    this.goneAt = new Map(); // id → heure de la suppression (copie entre serveurs)
    this.onChange = null;    // appelé après chaque écriture (réseau : envoi aux autres serveurs)
    this.sig = new Map();    // id → empreinte du dernier contenu écrit
    this.db = null;
    this.engine = 'json';
    this.dbFile = /\.json$/i.test(file) ? file.replace(/\.json$/i, '.db') : file + '.db';
    const S = o.sqlite === false ? null : sqlite();
    if (S) {
      try { this._open(S); } catch (e) {
        console.error('Carnet de trafic : base SQLite ' + this.dbFile + ' inutilisable (' + e.message + ') : retour au fichier JSON');
        try { if (this.db) this.db.close(); } catch (x) { /* */ }
        this.db = null;
      }
    }
    if (!this.db) {
      try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(d.qsos)) this.qsos = d.qsos; } catch (e) { /* nouveau carnet */ }
      // Base présente mais inutilisable ici (Node.js trop ancien…) : logbook.json est la dernière copie quotidienne
      if (fs.existsSync(this.dbFile)) console.error('Carnet de trafic : ' + this.dbFile + ' existe mais SQLite n’est pas disponible (Node.js 22.13 ou plus nécessaire) : carnet lu dans ' + file + ' (copie de la base, peut-être pas à jour)');
    }
  }
  /** Copie lisible du carnet dans logbook.json (base SQLite : une fois par jour, et au démarrage) — secours si SQLite manque */
  exportJson() {
    if (!this.db) return false;
    return this._saveJson();
  }
  _open(S) {
    const db = new S.DatabaseSync(this.dbFile);
    this.db = db;
    try { fs.chmodSync(this.dbFile, 0o600); } catch (e) { /* Windows */ }
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS qsos (
        id TEXT PRIMARY KEY, qso_date TEXT NOT NULL DEFAULT '', time_on TEXT NOT NULL DEFAULT '', call TEXT NOT NULL DEFAULT '',
        band TEXT, mode TEXT, station_callsign TEXT, operator TEXT, contest_id TEXT,
        node TEXT, version INTEGER NOT NULL DEFAULT 1, created INTEGER, modified INTEGER, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS qsos_when ON qsos (qso_date, time_on);
      CREATE INDEX IF NOT EXISTS qsos_call ON qsos (call);
      CREATE INDEX IF NOT EXISTS qsos_txc ON qsos (station_callsign);
      CREATE INDEX IF NOT EXISTS qsos_contest ON qsos (contest_id);
      CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, qso_id TEXT NOT NULL, op TEXT NOT NULL,
        t INTEGER NOT NULL, node TEXT, version INTEGER);
      CREATE INDEX IF NOT EXISTS changes_qso ON changes (qso_id);
      CREATE TABLE IF NOT EXISTS serials (contest_id TEXT NOT NULL, station_callsign TEXT NOT NULL, nr INTEGER NOT NULL,
        node TEXT, reserved INTEGER, qso_id TEXT, used INTEGER, PRIMARY KEY (contest_id, station_callsign, nr));
      CREATE TABLE IF NOT EXISTS tombs (id TEXT PRIMARY KEY, t INTEGER NOT NULL);
    `);
    // Colonne « mod » des numéros de série (copie entre serveurs : lignes changées depuis…)
    if (!db.prepare('PRAGMA table_info(serials)').all().some((c) => c.name === 'mod')) db.exec('ALTER TABLE serials ADD COLUMN mod INTEGER');
    db.exec('CREATE INDEX IF NOT EXISTS serials_mod ON serials (mod)');
    const meta = (k) => { const r = db.prepare('SELECT v FROM meta WHERE k = ?').get(k); return r ? r.v : null; };
    this.metaGet = meta;
    this._meta = (k, v) => db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v));
    if (!meta('schema')) this._meta('schema', SCHEMA);
    const n = db.prepare('SELECT COUNT(*) AS n FROM qsos').get().n;
    // Première ouverture : reprise de logbook.json (copie de sécurité gardée, nombre de QSO vérifié)
    if (!n && !meta('migrated') && fs.existsSync(this.file)) this._migrate();
    this._stmt = {
      up: db.prepare(`INSERT INTO qsos (id, qso_date, time_on, call, band, mode, station_callsign, operator, contest_id, node, version, created, modified, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET qso_date = excluded.qso_date, time_on = excluded.time_on, call = excluded.call, band = excluded.band,
          mode = excluded.mode, station_callsign = excluded.station_callsign, operator = excluded.operator, contest_id = excluded.contest_id,
          version = qsos.version + 1, modified = excluded.modified, data = excluded.data`),
      ver: db.prepare('SELECT version FROM qsos WHERE id = ?'),
      del: db.prepare('DELETE FROM qsos WHERE id = ?'),
      log: db.prepare('INSERT INTO changes (qso_id, op, t, node, version) VALUES (?, ?, ?, ?, ?)')
    };
    // QSO sans trace dans le journal (repris de logbook.json) : ajoutés au journal, pour être recopiés aux autres serveurs
    db.exec("INSERT INTO changes (qso_id, op, t, node, version) SELECT id, 'add', COALESCE(modified, created, 0), node, version FROM qsos WHERE id NOT IN (SELECT qso_id FROM changes) ORDER BY qso_date, time_on");
    const rows = db.prepare('SELECT data FROM qsos ORDER BY qso_date, time_on').all();
    const list = [];
    for (const r of rows) { try { const q = JSON.parse(r.data); list.push(q); this.sig.set(q.id, fnv(r.data)); } catch (e) { /* ligne illisible */ } }
    this.qsos = list;
    this.engine = 'sqlite';
  }
  _migrate() {
    let d = null;
    try { d = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { throw new Error('logbook.json illisible : ' + e.message); }
    const list = Array.isArray(d && d.qsos) ? d.qsos : [];
    const bak = this.file + '.avant-sqlite-' + new Date().toISOString().slice(0, 10);
    if (!fs.existsSync(bak)) { fs.copyFileSync(this.file, bak); try { fs.chmodSync(bak, 0o600); } catch (e) { /* Windows */ } }
    const db = this.db;
    const ins = db.prepare(`INSERT OR REPLACE INTO qsos (id, qso_date, time_on, call, band, mode, station_callsign, operator, contest_id, node, version, created, modified, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`);
    const now = Date.now();
    db.exec('BEGIN');
    try {
      for (const q of list) {
        if (!q || !q.id) q.id = crypto.randomBytes(8).toString('hex');
        ins.run(q.id, q.qso_date || '', q.time_on || '', q.call || '', q.band || null, q.mode || null, q.station_callsign || null, q.operator || null,
          q.contest_id || null, this.node, q.created || now, q.edited || q.created || now, JSON.stringify(q));
      }
      const n = db.prepare('SELECT COUNT(*) AS n FROM qsos').get().n;
      const ids = new Set(list.map((q) => q.id)).size;
      if (n !== ids) throw new Error('reprise incomplète : ' + n + ' QSO dans la base pour ' + ids + ' dans logbook.json');
      this._meta('migrated', new Date().toISOString() + ' · ' + n + ' QSO depuis ' + require('path').basename(this.file));
      db.exec('COMMIT');
      console.log('Carnet de trafic : ' + n + ' QSO repris de ' + this.file + ' dans ' + this.dbFile + ' (copie de sécurité : ' + bak + ')');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  /** Signale un QSO modifié directement (envoi LoTW noté, confirmation…) : écrit au prochain save() */
  touch(q) { if (q && q.id) this.dirty.add(q.id); }
  /**
   * Écrit les changements faits de l'extérieur (envois aux logs en ligne, confirmations…) : les QSO modifiés sont
   * retrouvés par leur empreinte, même sans touch(). En cas d'échec (disque plein…) : false et this.error
   */
  save() {
    if (this.db) for (const q of this.qsos) { if (this.dirty.has(q.id)) continue; const s = JSON.stringify(q); if (this.sig.get(q.id) !== fnv(s)) this.dirty.add(q.id); }
    return this._flush();
  }
  /** Écrit seulement les QSO signalés (ajout, correction, suppression : quelques millisecondes) */
  /** Écrit les QSO signalés (touch, ajout, correction) sans relire tout le carnet (gros carnets : quelques ms) */
  flush() { return this._flush(); }
  _flush() {
    if (!this.db) { this.rev++; return this._saveJson(); }
    if (!this.dirty.size && !this.gone.size) return true;
    this.rev++; // seulement si quelque chose a changé : la liste des stations contactées n'est pas recalculée pour rien
    const db = this.db, st = this._stmt, now = Date.now();
    const byId = new Map();
    if (this.dirty.size) for (const q of this.qsos) if (this.dirty.has(q.id)) byId.set(q.id, q);
    try {
      db.exec('BEGIN');
      for (const id of this.gone) {
        st.del.run(id);
        db.prepare('INSERT OR REPLACE INTO tombs (id, t) VALUES (?, ?)').run(id, this.goneAt.get(id) || now);
        st.log.run(id, 'del', now, this.node, null);
        this.sig.delete(id);
      }
      for (const [id, q] of byId) {
        const s = JSON.stringify(q);
        const had = this.sig.has(id);
        st.up.run(id, q.qso_date || '', q.time_on || '', q.call || '', q.band || null, q.mode || null, q.station_callsign || null, q.operator || null,
          q.contest_id || null, q.node || this.node, q.created || now, now, s);
        const v = st.ver.get(id);
        st.log.run(id, had ? 'edit' : 'add', now, q.node || this.node, v ? v.version : 1);
        this.sig.set(id, fnv(s));
      }
      db.exec('COMMIT');
      this.dirty.clear();
      this.gone.clear();
      this.goneAt.clear();
      this.error = '';
      if (this.onChange) { try { this.onChange(); } catch (e) { /* réseau */ } }
      return true;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (x) { /* */ }
      this.error = e.message;
      console.error('Carnet de trafic ' + this.dbFile + ' : ' + e.message);
      return false;
    }
  }
  _saveJson() {
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify({ format: 1, qsos: this.qsos }), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      this.error = '';
      return true;
    } catch (e) {
      this.error = e.message;
      console.error('Carnet de trafic ' + this.file + ' : ' + e.message);
      return false;
    }
  }
  add(q, by) {
    q.id = crypto.randomBytes(8).toString('hex');
    q.created = Date.now();
    q.by = by;
    q.up = {};
    if (!q.node) q.node = this.node;
    this._insert(q);
    this.dirty.add(q.id);
    this._flush();
    return q;
  }
  /** Import en nombre (fichier ADIF) : tri du paquet, fusion avec le carnet trié, une seule écriture ; renvoie le nombre ajouté */
  addMany(list, by) {
    const k = (x) => (x.qso_date || '') + (x.time_on || '');
    const now = Date.now();
    for (const q of list) {
      q.id = crypto.randomBytes(8).toString('hex');
      q.created = now;
      q.by = by;
      if (!q.up) q.up = {};
      if (!q.node) q.node = this.node;
      this.dirty.add(q.id);
    }
    const add = list.slice().sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0));
    const L = this.qsos, out = new Array(L.length + add.length);
    let i = 0, j = 0, o = 0;
    while (i < L.length && j < add.length) out[o++] = k(L[i]) <= k(add[j]) ? L[i++] : add[j++];
    while (i < L.length) out[o++] = L[i++];
    while (j < add.length) out[o++] = add[j++];
    this.qsos = out;
    this._flush();
    return add.length;
  }
  // Ajout à sa place dans la liste triée (date, heure) : pas de tri complet du carnet à chaque QSO
  _insert(q) {
    const k = (x) => (x.qso_date || '') + (x.time_on || '');
    const key = k(q), L = this.qsos;
    let lo = 0, hi = L.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (k(L[mid]) <= key) lo = mid + 1; else hi = mid; }
    L.splice(lo, 0, q);
  }
  get(id) { return this.qsos.find((q) => q.id === id) || null; }
  update(id, q) {
    const old = this.get(id);
    if (!old) return null;
    // Contenu remplacé ; les envois déjà faits restent notés (à refaire si nécessaire)
    const keep = { id: old.id, created: old.created, by: old.by, up: old.up || {}, edited: Date.now() };
    if (old.node) keep.node = old.node;
    for (const k of Object.keys(old)) delete old[k];
    Object.assign(old, q, keep);
    this.sort();
    this.dirty.add(id);
    this._flush();
    return old;
  }
  /** Complète un QSO existant avec les champs qui lui manquent (nom, QTH, locator, RST reçu…) ; renvoie les champs ajoutés */
  merge(id, q) {
    const old = this.get(id);
    if (!old) return null;
    const added = [];
    for (const k of ['name', 'qth', 'gridsquare', 'state', 'rst_rcvd', 'rst_sent', 'comment', 'tx_pwr', 'time_off', 'qso_date_off'].concat(Object.keys(REF_FIELDS), Object.keys(REF_FIELDS).map((x) => 'my_' + x))) {
      if (q[k] && !old[k]) { old[k] = q[k]; added.push(k); }
    }
    if (added.length) { old.edited = Date.now(); this.dirty.add(id); this._flush(); }
    return added;
  }
  remove(id) {
    const i = this.qsos.findIndex((q) => q.id === id);
    if (i < 0) return false;
    this.qsos.splice(i, 1);
    this.dirty.delete(id);
    this.gone.add(id);
    this.goneAt.set(id, Date.now());
    this._flush();
    return true;
  }
  // ---------------------------------------------------------------- copie entre serveurs (mise en réseau)
  /** Heure de la dernière version d'un QSO (la plus récente l'emporte entre serveurs) */
  static stamp(q) { return Number(q && (q.edited || q.created)) || 0; }
  /** Dernier numéro du journal des changements */
  maxSeq() { if (!this.db) return 0; const r = this.db.prepare('SELECT MAX(seq) AS m FROM changes').get(); return (r && r.m) || 0; }
  metaSet(k, v) { if (this._meta) this._meta(k, v); }
  /** Changements à envoyer à un autre serveur : état actuel de chaque QSO changé après seq (le dernier état seulement) */
  outgoing(seq, limit) {
    if (!this.db) return { upto: seq, items: [], more: false };
    const rows = this.db.prepare('SELECT seq, qso_id FROM changes WHERE seq > ? ORDER BY seq LIMIT ?').all(Number(seq) || 0, limit || 300);
    const seen = new Set(), items = [];
    let upto = Number(seq) || 0;
    const byId = rows.length ? new Map(this.qsos.map((x) => [x.id, x])) : null;
    for (const r of rows) {
      upto = r.seq;
      if (seen.has(r.qso_id)) continue;
      seen.add(r.qso_id);
      const q = byId.get(r.qso_id);
      if (q) items.push({ id: q.id, d: q });
      else { const t = this.db.prepare('SELECT t FROM tombs WHERE id = ?').get(r.qso_id); if (t) items.push({ id: r.qso_id, del: t.t }); }
    }
    return { upto, items, more: rows.length >= (limit || 300) };
  }
  /** QSO reçus d'un autre serveur : gardés seulement s'ils sont plus récents ; renvoie le nombre appliqué */
  applyRemote(items) {
    if (!this.db || !Array.isArray(items)) return 0;
    let n = 0;
    const tomb = this.db.prepare('SELECT t FROM tombs WHERE id = ?');
    const byId = new Map(this.qsos.map((x) => [x.id, x]));
    for (const it of items) {
      if (!it || typeof it.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(it.id)) continue;
      const cur = byId.get(it.id);
      if (it.del != null) {
        const t = Number(it.del) || 0;
        if (cur && Logbook.stamp(cur) > t) continue; // corrigé ici après la suppression là-bas
        const tb = tomb.get(it.id);
        if (!cur && tb && tb.t >= t) continue;
        if (cur) { const i = this.qsos.indexOf(cur); if (i >= 0) this.qsos.splice(i, 1); this.dirty.delete(it.id); byId.delete(it.id); }
        this.gone.add(it.id);
        this.goneAt.set(it.id, t);
        n++;
        continue;
      }
      const q = it.d;
      if (!q || typeof q !== 'object' || q.id !== it.id || typeof q.call !== 'string') continue;
      const tb = tomb.get(it.id);
      if (tb && tb.t >= Logbook.stamp(q)) continue; // supprimé ici après cette version
      if (cur) {
        const a = Logbook.stamp(cur), b = Logbook.stamp(q);
        if (a > b || (a === b && JSON.stringify(cur) >= JSON.stringify(q))) continue; // même version ou plus récente ici
        for (const k of Object.keys(cur)) delete cur[k];
        Object.assign(cur, q);
      } else { const nq = Object.assign({}, q); this._insert(nq); byId.set(nq.id, nq); }
      this.dirty.add(it.id);
      n++;
    }
    if (n) { this.sort(); this._flush(); }
    return n;
  }
  /** Numéros de série changés depuis une heure (copie entre serveurs) */
  serialRows(since, limit) {
    if (!this.db) return [];
    return this.db.prepare('SELECT contest_id AS c, station_callsign AS x, nr, node, reserved, qso_id AS q, used, mod FROM serials WHERE mod > ? ORDER BY mod LIMIT ?').all(Number(since) || 0, limit || 500);
  }
  /** Numéros de série reçus d'un autre serveur (plus récents seulement) ; mod = -1 : ligne effacée (remise à 1) */
  applySerialRows(rows) {
    if (!this.db || !Array.isArray(rows)) return 0;
    let n = 0;
    const get = this.db.prepare('SELECT mod FROM serials WHERE contest_id = ? AND station_callsign = ? AND nr = ?');
    const put = this.db.prepare('INSERT OR REPLACE INTO serials (contest_id, station_callsign, nr, node, reserved, qso_id, used, mod) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    this.db.exec('BEGIN');
    try {
      for (const r of rows) {
        if (!r || typeof r.c !== 'string' || typeof r.x !== 'string' || !(r.nr > 0)) continue;
        const cur = get.get(r.c, r.x, r.nr);
        if (cur && (cur.mod || 0) >= r.mod) continue;
        put.run(r.c, r.x, r.nr, r.node || null, r.reserved || null, r.q || null, r.used == null ? null : r.used, r.mod || Date.now());
        n++;
      }
      this.db.exec('COMMIT');
    } catch (e) { try { this.db.exec('ROLLBACK'); } catch (x) { /* */ } throw e; }
    return n;
  }
  sort() { this.qsos.sort((a, b) => (a.qso_date + a.time_on).localeCompare(b.qso_date + b.time_on)); }
  /** Doublon : même indicatif, bande et mode dans les 30 dernières minutes */
  dupe(q) {
    const t = (x) => Date.UTC(+x.qso_date.slice(0, 4), +x.qso_date.slice(4, 6) - 1, +x.qso_date.slice(6, 8), +x.time_on.slice(0, 2), +x.time_on.slice(2, 4));
    return this.qsos.find((x) => x.call === q.call && x.band === q.band && x.mode === q.mode && Math.abs(t(x) - t(q)) < 30 * 60000) || null;
  }
  query(o) {
    o = o || {};
    let l = this.qsos;
    if (o.q) { const s = String(o.q).toUpperCase(); l = l.filter((x) => x.call.includes(s) || (x.operator || '').includes(s) || (x.name || '').toUpperCase().includes(s)); }
    if (o.from) l = l.filter((x) => x.qso_date >= String(o.from).replace(/\D/g, ''));
    if (o.to) l = l.filter((x) => x.qso_date <= String(o.to).replace(/\D/g, ''));
    if (o.operator) l = l.filter((x) => x.operator === o.operator);
    return l;
  }
  // ---------------------------------------------------------------- mise en réseau (préparation)
  /** Changements depuis un numéro de séquence (postes en réseau : seulement ce qui a changé) */
  changesSince(seq, limit) {
    if (!this.db) return [];
    return this.db.prepare('SELECT seq, qso_id, op, t, node, version FROM changes WHERE seq > ? ORDER BY seq LIMIT ?').all(Number(seq) || 0, Math.min(5000, Number(limit) || 1000));
  }
  /**
   * Réserve le prochain numéro de série d'un contest pour un TX call et un poste : un seul poste reçoit chaque numéro,
   * même si plusieurs le demandent en même temps (transaction de la base). Renvoie le numéro, ou 0 sans base.
   */
  reserveSerial(contest, txcall, node) {
    if (!this.db) return 0;
    const c = String(contest || '').toUpperCase(), tx = String(txcall || '').toUpperCase();
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = db.prepare('SELECT MAX(nr) AS m FROM serials WHERE contest_id = ? AND station_callsign = ?').get(c, tx);
      const nr = (r && r.m ? r.m : 0) + 1;
      db.prepare('INSERT INTO serials (contest_id, station_callsign, nr, node, reserved) VALUES (?, ?, ?, ?, ?)').run(c, tx, nr, String(node || this.node), Date.now());
      db.exec('COMMIT');
      return nr;
    } catch (e) { try { db.exec('ROLLBACK'); } catch (x) { /* */ } throw e; }
  }
  /**
   * Numéros de série d'un contest, tenus par la base (tous les navigateurs et, plus tard, tous les postes du réseau) :
   * une seule série par contest et par TX call ; chaque poste (holder) garde un numéro « en main » jusqu'au QSO.
   *  - lease : le numéro en main de ce poste (le même tant qu'il n'a pas servi), sinon le suivant libre
   *  - used  : le numéro nr a servi (QSO enregistré avec call) → numéro suivant en main
   *  - set   : ce poste prend le numéro nr (s'il n'est ni donné ni en main ailleurs)
   *  - reset : nouvelle édition du contest, la série repart à 1 (numéros des 4 derniers jours oubliés)
   * Une édition = les numéros des 96 dernières heures (le même contest l'année suivante repart de 1).
   * Renvoie { nr, warn? }.
   */
  serialOp(op, contest, txcall, holder, nr, call) {
    if (!this.db) return { nr: 0 };
    const db = this.db, c = String(contest || '').toUpperCase(), tx = String(txcall || '').toUpperCase(), h = String(holder || this.node);
    const since = Date.now() - 96 * 3600 * 1000;
    const row = (n) => db.prepare('SELECT nr, node, used, qso_id, reserved FROM serials WHERE contest_id = ? AND station_callsign = ? AND nr = ? AND reserved > ?').get(c, tx, n, since);
    const lease = () => {
      const r = db.prepare('SELECT nr FROM serials WHERE contest_id = ? AND station_callsign = ? AND node = ? AND used IS NULL AND reserved > ? ORDER BY nr LIMIT 1').get(c, tx, h, since);
      if (r) return r.nr;
      const m = db.prepare('SELECT MAX(nr) AS m FROM serials WHERE contest_id = ? AND station_callsign = ? AND reserved > ?').get(c, tx, since);
      const next = (m && m.m ? m.m : 0) + 1;
      db.prepare('INSERT OR REPLACE INTO serials (contest_id, station_callsign, nr, node, reserved, qso_id, used, mod) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)').run(c, tx, next, h, Date.now(), Date.now());
      return next;
    };
    const who = (x) => String(x || '').split('/').slice(0, 2).join(' · ');
    db.exec('BEGIN IMMEDIATE');
    try {
      let out;
      if (op === 'used') {
        const r = row(nr);
        if (r) db.prepare('UPDATE serials SET used = ?, qso_id = ?, node = ?, mod = ? WHERE contest_id = ? AND station_callsign = ? AND nr = ?').run(Date.now(), 'call:' + String(call || '').toUpperCase().slice(0, 20), h, Date.now(), c, tx, nr);
        else if (nr > 0) db.prepare('INSERT OR REPLACE INTO serials (contest_id, station_callsign, nr, node, reserved, qso_id, used, mod) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(c, tx, nr, h, Date.now(), 'call:' + String(call || '').toUpperCase().slice(0, 20), Date.now(), Date.now());
        out = { nr: lease() };
      } else if (op === 'set') {
        const r = nr > 0 ? row(nr) : null;
        if (!(nr > 0) || nr > 99999) out = { nr: lease(), warn: 'Numéro de série invalide.' };
        else if (r && r.node !== h && (r.used || r.node)) out = { nr: lease(), warn: 'Le n° ' + String(nr).padStart(3, '0') + ' est déjà ' + (r.used ? 'donné' : 'en main') + ' (' + who(r.node) + ') : numéro gardé ' };
        else {
          db.prepare('UPDATE serials SET reserved = 0, node = ?, mod = ? WHERE contest_id = ? AND station_callsign = ? AND node = ? AND used IS NULL').run('libre', Date.now(), c, tx, h);
          db.prepare('INSERT OR REPLACE INTO serials (contest_id, station_callsign, nr, node, reserved, qso_id, used, mod) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)').run(c, tx, nr, h, Date.now(), Date.now());
          out = { nr };
        }
        if (out.warn && / gardé $/.test(out.warn)) out.warn += String(out.nr).padStart(3, '0') + '.';
      } else if (op === 'reset') {
        // Lignes gardées mais « oubliées » (reserved = 0) : la remise à 1 se recopie aux autres serveurs
        db.prepare('UPDATE serials SET reserved = 0, node = ?, used = NULL, qso_id = NULL, mod = ? WHERE contest_id = ? AND station_callsign = ? AND reserved > ?').run('reset', Date.now(), c, tx, since);
        out = { nr: lease(), reset: true };
      } else out = { nr: lease() };
      db.exec('COMMIT');
      return out;
    } catch (e) { try { db.exec('ROLLBACK'); } catch (x) { /* */ } throw e; }
  }
  /** Numéro de série réservé utilisé par un QSO enregistré */
  useSerial(contest, txcall, nr, qsoId) {
    if (!this.db) return false;
    return this.db.prepare('UPDATE serials SET qso_id = ?, used = ? WHERE contest_id = ? AND station_callsign = ? AND nr = ?')
      .run(String(qsoId || ''), Date.now(), String(contest || '').toUpperCase(), String(txcall || '').toUpperCase(), Number(nr) || 0).changes > 0;
  }
  /** État du stockage (page Station / administration) */
  info() {
    if (!this.db) return { engine: 'json', file: this.file, qsos: this.qsos.length };
    let size = 0;
    try { size = fs.statSync(this.dbFile).size; } catch (e) { /* */ }
    return { engine: 'sqlite', file: this.dbFile, qsos: this.qsos.length, size };
  }
  /** Copie cohérente de la base (sauvegardes) : VACUUM INTO, sans arrêter le serveur */
  snapshot(dest) {
    if (!this.db) return false;
    try { fs.unlinkSync(dest); } catch (e) { /* absent */ }
    this.db.exec("VACUUM INTO '" + String(dest).replace(/'/g, "''") + "'");
    try { fs.chmodSync(dest, 0o600); } catch (e) { /* Windows */ }
    return true;
  }
  close() { try { this._flush(); if (this.db) this.db.close(); } catch (e) { /* */ } this.db = null; }
}

module.exports = { Logbook, clean, bandOf, toAdif, adifRecord, adifHeader, toCabrillo, MODES, MODE_NAMES, modeName, ascii, REF_FIELDS };
