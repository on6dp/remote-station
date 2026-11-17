'use strict';
/*
 * adifimport.js — import d'un log ADIF (Swisslog, Log4OM, WSJT-X…) dans le carnet de la station, par morceaux.
 * Le navigateur lit le fichier, garde les années choisies et envoie les enregistrements par lots (< 60 Ko par message
 * WebSocket) ; chaque lot est lu ici, les QSO valides sont ajoutés au carnet par paquets (une transaction SQLite par
 * paquet, le serveur reste réactif). Doublons (même indicatif, bande, mode, à 30 min près, déjà dans le carnet ou dans
 * le fichier) ignorés. Les QSO importés sont notés « déjà envoyés » à LoTW, eQSL, Club Log et QRZ : rien ne repart.
 */
const LB = require('./logbook.js');

/** Enregistrements ADIF d'un texte (sans en-tête) : [{ champ: valeur }] (noms en minuscules) */
function parseRecords(text) {
  const out = [];
  let rec = {};
  const re = /<([A-Za-z0-9_]+)(?::(\d+)(?::[A-Za-z])?)?>/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1].toLowerCase();
    if (name === 'eor') { if (Object.keys(rec).length) out.push(rec); rec = {}; continue; }
    if (name === 'eoh') { rec = {}; continue; }
    const len = m[2] != null ? Number(m[2]) : 0;
    const v = text.substr(re.lastIndex, len);
    re.lastIndex += len;
    rec[name] = v;
  }
  return out;
}

const COPY = ['rst_sent', 'rst_rcvd', 'name', 'qth', 'gridsquare', 'country', 'state', 'cnty', 'cqz', 'ituz', 'cont', 'iota', 'comment', 'tx_pwr',
  'qsl_sent', 'qsl_rcvd', 'qslsdate', 'qslrdate', 'lotw_qsl_sent', 'lotw_qsl_rcvd', 'lotw_qslsdate', 'lotw_qslrdate', 'eqsl_qsl_sent', 'eqsl_qsl_rcvd',
  'stx', 'srx', 'stx_string', 'srx_string', 'contest_id', 'prop_mode', 'sat_name', 'freq_rx', 'band_rx', 'my_gridsquare', 'sota_ref', 'pota_ref',
  'wwff_ref', 'my_sota_ref', 'my_pota_ref', 'my_wwff_ref', 'my_iota', 'sig', 'sig_info', 'time_off', 'qso_date_off', 'dxcc', 'pfx'];
const MODE_FIX = { USB: ['SSB', 'USB'], LSB: ['SSB', 'LSB'], FT4: ['MFSK', 'FT4'], FT2: ['MFSK', 'FT2'], JTTY: ['MFSK', 'JTTY'], PSK31: ['PSK', 'PSK31'], PSK63: ['PSK', 'PSK63'] };

/** Un enregistrement ADIF → QSO du carnet (ou { err }) ; txc : TX call imposé (sinon STATION_CALLSIGN du fichier) */
function toQso(r, o) {
  const call = String(r.call || '').toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9/]{3,15}$/.test(call) || !/\d/.test(call)) return { err: 'indicatif' };
  const d = String(r.qso_date || '').replace(/\D/g, '');
  if (!/^(19|20)\d{6}$/.test(d)) return { err: 'date' };
  const t = String(r.time_on || '').replace(/\D/g, '').padEnd(6, '0').slice(0, 6);
  if (!/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(t)) return { err: 'heure' };
  if (Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) > Date.now() + 86400000) return { err: 'date future' };
  const freq = Number(r.freq);
  let band = String(r.band || '').toLowerCase().replace(/\s+/g, '');
  if (!band && freq > 0) band = LB.bandOf(freq);
  if (!band) return { err: 'bande' };
  let mode = String(r.mode || '').toUpperCase().trim(), sub = String(r.submode || '').toUpperCase().trim();
  if (!mode) return { err: 'mode' };
  if (MODE_FIX[mode] && !sub) { sub = MODE_FIX[mode][1]; mode = MODE_FIX[mode][0]; }
  const q = { call, qso_date: d, time_on: t, band, mode };
  if (sub) q.submode = sub;
  if (freq > 0) q.freq = String(freq);
  for (const k of COPY) {
    const v = r[k];
    if (v == null || v === '') continue;
    q[k] = LB.ascii(v).slice(0, k === 'comment' ? 200 : 80);
  }
  const sc = String(o.force || r.station_callsign || r.owner_callsign || o.txc || '').toUpperCase().trim();
  q.station_callsign = sc;
  q.operator = String(r.operator || sc).toUpperCase().trim().slice(0, 15);
  q.imported = o.at; // QSO importé (date de l'import)
  return { q };
}

class ImportJob {
  /** @param {object} o book, by, txc, force (TX call imposé à tous), allowed(call) → bool, now */
  constructor(o) {
    this.o = o;
    this.n = 0; this.added = 0; this.dupes = 0; this.bad = 0; this.denied = 0;
    this.why = {};
    this.pend = [];
    this.years = {};
    this.calls = {};
    this.at = Date.now();
    // Index des doublons : « INDICATIF|bande|mode » → heures (ms) des QSO déjà au carnet
    this.idx = new Map();
    for (const q of o.book.qsos) this._idxAdd(q);
  }
  _key(q) { return q.call + '|' + q.band + '|' + LB.modeName(q); }
  _t(q) { return Date.UTC(+q.qso_date.slice(0, 4), +q.qso_date.slice(4, 6) - 1, +q.qso_date.slice(6, 8), +q.time_on.slice(0, 2), +q.time_on.slice(2, 4)); }
  _idxAdd(q) { if (!q.call || !q.qso_date || !q.time_on) return; const k = this._key(q); const a = this.idx.get(k); const t = this._t(q); if (a) a.push(t); else this.idx.set(k, [t]); }
  _dupe(q) { const a = this.idx.get(this._key(q)); if (!a) return false; const t = this._t(q); return a.some((x) => Math.abs(x - t) < 30 * 60000); }
  /** Un lot de texte ADIF (enregistrements complets) */
  feed(text) {
    for (const r of parseRecords(text)) {
      this.n++;
      const x = toQso(r, { txc: this.o.txc, force: this.o.force, at: this.at });
      if (x.err) { this.bad++; this.why[x.err] = (this.why[x.err] || 0) + 1; continue; }
      const q = x.q;
      if (!q.station_callsign || !this.o.allowed(q.station_callsign)) { this.denied++; continue; }
      if (this._dupe(q)) { this.dupes++; continue; }
      this._idxAdd(q);
      this.pend.push(q);
      this.years[q.qso_date.slice(0, 4)] = (this.years[q.qso_date.slice(0, 4)] || 0) + 1;
      this.calls[q.station_callsign] = (this.calls[q.station_callsign] || 0) + 1;
    }
    if (this.pend.length >= 5000) this.flush();
  }
  flush() {
    if (!this.pend.length) return;
    const now = Date.now();
    for (const q of this.pend) q.up = { lotw: { ok: true, t: now, imported: true }, eqsl: { ok: true, t: now, imported: true }, clublog: { ok: true, t: now, imported: true }, qrz: { ok: true, t: now, imported: true } };
    this.added += this.o.book.addMany(this.pend, this.o.by);
    this.pend = [];
  }
  state() { return { n: this.n, added: this.added + this.pend.length, dupes: this.dupes, bad: this.bad, denied: this.denied, why: this.why, years: this.years, calls: this.calls }; }
}

module.exports = { parseRecords, toQso, ImportJob };
