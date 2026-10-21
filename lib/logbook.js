'use strict';
/*
 * logbook.js — carnet de trafic de la station (logbook.json) et formats d'échange ADIF 3 et Cabrillo 3.
 *
 * Chaque QSO est un objet aux noms de champs ADIF (en minuscules) : call, qso_date (AAAAMMJJ), time_on (HHMMSS),
 * time_off, freq (MHz), band, mode, submode, rst_sent, rst_rcvd, name, qth, gridsquare, comment, operator,
 * station_callsign, my_gridsquare, stx, srx, stx_string, srx_string, prop_mode, sat_name, freq_rx, band_rx, tx_pwr,
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
  RTTY: ['RTTY', ''], FT8: ['FT8', ''], FT4: ['MFSK', 'FT4'], JT65: ['JT65', ''], JT65A: ['JT65', 'JT65A'],
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
  'rst_sent', 'rst_rcvd', 'stx', 'srx', 'stx_string', 'srx_string', 'name', 'qth', 'gridsquare', 'comment', 'prop_mode', 'sat_name',
  'tx_pwr', 'operator', 'station_callsign', 'my_gridsquare', 'contest_id'];

function adifRecord(q, extra) {
  let s = '';
  for (const k of ADIF_FIELDS) s += F(k, q[k]);
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
  const lines = ['START-OF-LOG: 3.0', 'CREATED-BY: Remote Station UBA-LGE ' + (o.version || ''), 'CALLSIGN: ' + up(o.callsign),
    'CONTEST: ' + (up(o.contest) || 'DX'), 'CATEGORY-OPERATOR: ' + (ops.length > 1 ? 'MULTI-OP' : 'SINGLE-OP'), 'CATEGORY-STATION: FIXED',
    'CATEGORY-TRANSMITTER: ONE'];
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
  return q;
}

// ------------------------------------------------------------------ stockage
class Logbook {
  constructor(file) {
    this.file = file;
    this.qsos = [];
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(d.qsos)) this.qsos = d.qsos; } catch (e) { /* nouveau carnet */ }
  }
  /** Écriture atomique ; en cas d'échec (disque plein, dossier en lecture seule) : false et this.error */
  save() {
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
    this.qsos.push(q);
    this.sort();
    this.save();
    return q;
  }
  get(id) { return this.qsos.find((q) => q.id === id) || null; }
  update(id, q) {
    const old = this.get(id);
    if (!old) return null;
    // Contenu remplacé ; les envois déjà faits restent notés (à refaire si nécessaire)
    const keep = { id: old.id, created: old.created, by: old.by, up: old.up || {}, edited: Date.now() };
    for (const k of Object.keys(old)) delete old[k];
    Object.assign(old, q, keep);
    this.sort();
    this.save();
    return old;
  }
  remove(id) {
    const i = this.qsos.findIndex((q) => q.id === id);
    if (i < 0) return false;
    this.qsos.splice(i, 1);
    this.save();
    return true;
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
}

module.exports = { Logbook, clean, bandOf, toAdif, adifRecord, adifHeader, toCabrillo, MODES, MODE_NAMES, modeName, ascii };
