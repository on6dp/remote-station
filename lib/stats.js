'use strict';
/**
 * Statistiques d'utilisation de la Remote Station.
 *
 * Source principale : logs/usage-AAAA-MM.jsonl, une ligne par minute écrite par le serveur :
 *   { ts, c: indicatif qui a la main (ou null), u: [membres connectés], f: fréquence d'émission (Hz),
 *     m: mode affiché (FT8, RTTY, CW, SSB…), tx: secondes d'émission pendant cette minute, rig }
 * Avant la première de ces lignes (anciennes périodes), estimation à partir du journal des accès
 * (logs/access-AAAA-MM.log : prises et libérations de la main, débuts d'émission avec fréquence et mode).
 */
const fs = require('fs');
const path = require('path');

const BANDS = [
  ['160m', 1.8e6, 2.0e6], ['80m', 3.5e6, 3.8e6], ['60m', 5.35e6, 5.37e6], ['40m', 7.0e6, 7.2e6], ['30m', 10.1e6, 10.15e6],
  ['20m', 14.0e6, 14.35e6], ['17m', 18.068e6, 18.168e6], ['15m', 21.0e6, 21.45e6], ['12m', 24.89e6, 24.99e6],
  ['10m', 28.0e6, 29.7e6], ['6m', 50e6, 52e6], ['4m', 70e6, 70.5e6], ['2m', 144e6, 146e6], ['70cm', 430e6, 440e6],
  ['23cm', 1240e6, 1300e6], ['QO-100', 2400e6, 2401e6]
];
const BAND_ORDER = BANDS.map((b) => b[0]);
function band(hz) {
  const f = Number(hz);
  if (!(f > 0)) return 'inconnue';
  for (const [n, lo, hi] of BANDS) if (f >= lo && f <= hi) return n;
  return 'hors bande';
}
/** Mode lisible : mode numérique de l'onglet quand le TRX est en DATA, sinon mode du TRX simplifié. */
function modeName(trxMode, digi) {
  const m = String(trxMode || '').toUpperCase();
  if (digi && (/DATA|-D$|PKT|DIG/.test(m) || !m)) return String(digi).toUpperCase();
  if (/^CW/.test(m)) return 'CW';
  if (/^(USB|LSB)$/.test(m) || /SSB/.test(m)) return 'SSB';
  if (/^RTTY/.test(m)) return 'RTTY';
  if (/^FM|^DATA-FM|^C4FM/.test(m)) return m.indexOf('DATA') >= 0 ? 'DATA-FM' : 'FM';
  if (/^AM/.test(m)) return 'AM';
  if (/DATA|-D$/.test(m)) return 'DATA';
  return m || 'inconnu';
}

const monthKeys = (from, to) => {
  const out = [];
  const d = new Date(Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth(), 1));
  while (d.getTime() <= to) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  return out;
};
function readLines(file) {
  let txt = '';
  try { txt = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const l of txt.split('\n')) { if (!l) continue; try { out.push(JSON.parse(l)); } catch (e) { /* ligne abîmée */ } }
  return out;
}
function readUsage(dir, from, to) {
  const out = [];
  for (const k of monthKeys(from, to)) for (const s of readLines(path.join(dir, 'usage-' + k + '.jsonl'))) if (s.ts >= from && s.ts < to) out.push(s);
  return out.sort((a, b) => a.ts - b.ts);
}
function readJournal(dir, from, to) {
  const out = [];
  for (const k of monthKeys(from - 86400000, to)) {
    for (const e of readLines(path.join(dir, 'access-' + k + '.log'))) {
      const ts = Date.parse(e.ts);
      if (ts >= from - 86400000 && ts < to) { e.t = ts; out.push(e); }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
/** Première minute enregistrée (tous mois confondus) : avant elle, estimation par le journal. */
function firstUsage(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^usage-\d{4}-\d{2}\.jsonl$/.test(f)).sort(); } catch (e) { return 0; }
  for (const f of files) { const l = readLines(path.join(dir, f)); if (l.length) return l[0].ts; }
  return 0;
}

/** Date locale (AAAA-MM-JJ), jour de la semaine (0 = lundi) et heure dans le fuseau de la station. */
function localParts(ts, tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(new Date(ts))) p[x.type] = x.value;
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday);
  return { date: p.year + '-' + p.month + '-' + p.day, dow, hour: Number(p.hour) % 24 };
}

/**
 * @param {object} o { dir, from, to, tz, call?, qsos? (carnet), digiNames? }
 */
function compute(o) {
  const tz = o.tz || 'Europe/Brussels';
  const want = o.call ? String(o.call).toUpperCase() : '';
  const calls = new Map();
  const C = (c) => {
    if (!calls.has(c)) calls.set(c, { call: c, ctlMin: 0, onlineMin: 0, txS: 0, sessions: 0, bands: {}, modes: {}, last: 0, first: 0, qsos: 0, days: new Set() });
    return calls.get(c);
  };
  const bands = {};
  const modes = {};
  const days = {};
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const sessions = [];
  let txTotal = 0;
  const add = (obj, k, v) => { obj[k] = (obj[k] || 0) + v; };
  const minute = (call, ts, b, m, tx) => {
    const x = C(call);
    x.ctlMin += 1; x.txS += tx || 0;
    add(x.bands, b, 1); add(x.modes, m, 1);
    x.last = Math.max(x.last, ts); x.first = x.first ? Math.min(x.first, ts) : ts;
    const lp = localParts(ts, tz);
    x.days.add(lp.date);
    add(bands, b, 1); add(modes, m, 1); add(days, lp.date, 1);
    heat[lp.dow][lp.hour] += 1;
    txTotal += tx || 0;
  };

  // 1) Minutes enregistrées
  const first = firstUsage(o.dir);
  const samples = readUsage(o.dir, o.from, o.to);
  let cur = null;
  const closeSess = () => { if (cur) { sessions.push(cur); C(cur.call).sessions += 1; cur = null; } };
  for (const s of samples) {
    for (const u of Array.isArray(s.u) ? s.u : []) { if (!want || u === want) { const x = C(u); x.onlineMin += 1; x.last = Math.max(x.last, s.ts); x.first = x.first ? Math.min(x.first, s.ts) : s.ts; } }
    if (!s.c || (want && s.c !== want)) { if (cur && s.ts - cur.end > 3 * 60000) closeSess(); continue; }
    const b = band(s.f);
    const m = s.m || 'inconnu';
    minute(s.c, s.ts, b, m, s.tx);
    if (!cur || cur.call !== s.c || s.ts - cur.end > 3 * 60000) { closeSess(); cur = { call: s.c, start: s.ts, end: s.ts + 60000, bands: {}, modes: {}, txS: 0, rig: s.rig || '', src: 'minutes' }; }
    cur.end = s.ts + 60000; add(cur.bands, b, 1); add(cur.modes, m, 1); cur.txS += s.tx || 0;
  }
  closeSess();

  // 2) Avant les minutes enregistrées : estimation par le journal (prises / libérations de la main, émissions)
  const jTo = first ? Math.min(o.to, first) : o.to;
  if (jTo > o.from) {
    const ev = readJournal(o.dir, o.from, jTo);
    const open = new Map(); // indicatif → session en cours
    const end = (call, t) => {
      const s = open.get(call);
      if (!s) return;
      open.delete(call);
      s.end = Math.min(t, s.start + 12 * 3600000);
      if (s.end <= Math.max(s.start, o.from)) return;
      const bl = Object.keys(s.bands).length ? Object.keys(s.bands) : ['non relevée'];
      const ml = Object.keys(s.modes).length ? Object.keys(s.modes) : ['non relevé'];
      const mins = Math.max(1, Math.round((s.end - Math.max(s.start, o.from)) / 60000));
      for (let i = 0; i < mins; i++) {
        const ts = Math.max(s.start, o.from) + i * 60000;
        minute(call, ts, bl[i % bl.length], ml[i % ml.length], 0);
      }
      C(call).txS += s.txS;
      txTotal += s.txS;
      s.bands = Object.fromEntries(bl.map((b) => [b, Math.round(mins / bl.length)]));
      s.modes = Object.fromEntries(ml.map((m) => [m, Math.round(mins / ml.length)]));
      sessions.push(s);
      C(call).sessions += 1;
    };
    for (const e of ev) {
      const call = String(e.call || '').toUpperCase();
      if (!call || (want && call !== want)) continue;
      if (e.ev === 'control_take') {
        for (const k of Array.from(open.keys())) if (k !== call) end(k, e.t); // une seule main à la fois
        if (!open.has(call)) open.set(call, { call, start: e.t, end: e.t, bands: {}, modes: {}, txS: 0, rig: '', src: 'journal' });
      } else if (e.ev === 'control_release' || e.ev === 'logout') {
        end(call, e.t);
      } else if (e.ev === 'tx_start' && open.has(call)) {
        const s = open.get(call);
        s.bands[band(e.freq)] = 1;
        s.modes[modeName(e.mode, /^(FT8|FT4|FT2|RTTY|JTTY|JT65|WSPR|SSTV|CW)$/.test(String(e.mode)) ? e.mode : '')] = 1;
      } else if (e.ev === 'tx_stop' && open.has(call)) {
        open.get(call).txS += Number(e.durationS) || 0;
      }
    }
    for (const k of Array.from(open.keys())) end(k, Math.min(jTo, Date.now()));
  }

  // 3) QSO du carnet faits par chaque opérateur pendant la période
  let qsoTotal = 0;
  for (const q of o.qsos || []) {
    const d = String(q.qso_date || '');
    const ts = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +String(q.time_on || '').slice(0, 2) || 0, +String(q.time_on || '').slice(2, 4) || 0);
    if (!(ts >= o.from && ts < o.to)) continue;
    const op = String(q.operator || q.by || '').toUpperCase();
    if (!op || (want && op !== want)) continue;
    C(op).qsos += 1;
    qsoTotal += 1;
  }

  const sortB = (obj) => Object.entries(obj).sort((a, b) => {
    const ia = BAND_ORDER.indexOf(a[0]); const ib = BAND_ORDER.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const sortV = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const list = Array.from(calls.values()).filter((x) => x.ctlMin || x.onlineMin || x.qsos)
    .map((x) => ({ call: x.call, ctlMin: x.ctlMin, onlineMin: x.onlineMin, txS: Math.round(x.txS), sessions: x.sessions, qsos: x.qsos, days: x.days.size,
      bands: sortB(x.bands), modes: sortV(x.modes), first: x.first, last: x.last }))
    .sort((a, b) => b.ctlMin - a.ctlMin || b.onlineMin - a.onlineMin || a.call.localeCompare(b.call));
  sessions.sort((a, b) => b.start - a.start);
  return {
    from: o.from, to: o.to, tz, call: want, firstMinute: first || null,
    totals: { ctlMin: list.reduce((a, x) => a + x.ctlMin, 0), txS: Math.round(txTotal), members: list.length,
      operators: list.filter((x) => x.ctlMin > 0).length, sessions: sessions.length, qsos: qsoTotal },
    calls: list,
    bands: sortB(bands),
    modes: sortV(modes),
    days: Object.entries(days).sort((a, b) => a[0].localeCompare(b[0])),
    heat,
    sessions: sessions.slice(0, 1000).map((s) => ({ call: s.call, start: s.start, end: s.end, min: Math.max(1, Math.round((s.end - s.start) / 60000)),
      bands: sortB(s.bands).map((x) => x[0]), modes: sortV(s.modes).map((x) => x[0]), txS: Math.round(s.txS), rig: s.rig || '', src: s.src }))
  };
}

module.exports = { band, modeName, compute, localParts, BANDS };
