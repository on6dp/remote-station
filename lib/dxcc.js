'use strict';
/*
 * dxcc.js — pays DXCC d'un indicatif (fichier cty.dat de Jim Reisert AD1C, lib/data/cty.dat, comme WSJT-X / JTDX),
 * distance et azimut depuis le locator de la station.
 * Recherche : indicatif exact (« =… »), sinon le plus long préfixe ; « EA8/ON4ABC » → préfixe EA8 ; /P /M /MM /AM /QRP ignorés.
 */
const fs = require('fs');
const path = require('path');

let ent = null;              // [{ name, cont, lat, lon, cq, itu }]
let pfx = null;              // Map préfixe → { e, lat, lon }
let exact = null;            // Map indicatif complet → { e, lat, lon }
let maxLen = 0;
// Sans les entités WAE de cty.dat (« *IT9 » Sicile, « *GM/s » Shetland…) : pays DXCC au sens du diplôme (statistiques)
let pfxD = null, exactD = null;

function load() {
  if (ent) return;
  ent = []; pfx = new Map(); exact = new Map(); pfxD = new Map(); exactD = new Map();
  let txt = '';
  try { txt = fs.readFileSync(path.join(__dirname, 'data', 'cty.dat'), 'latin1'); } catch (e) { return; }
  // Une entité : « Nom: CQ: ITU: Cont: Lat: Lon(ouest +): TZ: Préfixe: » puis les préfixes jusqu'au « ; »
  const re = /^([^:\r\n]+):\s*(\d+):\s*(\d+):\s*(\w+):\s*(-?[\d.]+):\s*(-?[\d.]+):\s*(-?[\d.]+):\s*(\*?)([^:]+):\s*([\s\S]*?);/gm;
  let m;
  while ((m = re.exec(txt))) {
    const e = { name: m[1].trim(), cq: +m[2], itu: +m[3], cont: m[4], lat: +m[5], lon: -Number(m[6]), pfx: m[9].trim(), wae: m[8] === '*' };
    ent.push(e);
    for (let p of m[10].split(',')) {
      p = p.trim();
      if (!p) continue;
      // Exceptions : (zone CQ) [zone UIT] <lat/lon> {continent} ~fuseau~
      let lat = e.lat, lon = e.lon;
      const ll = /<(-?[\d.]+)\/(-?[\d.]+)>/.exec(p);
      if (ll) { lat = +ll[1]; lon = -Number(ll[2]); }
      const zq = /\((\d+)\)/.exec(p), zi = /\[(\d+)\]/.exec(p); // zones CQ / UIT propres à ce préfixe (ex. W6 : zone CQ 3)
      p = p.replace(/\(.*?\)|\[.*?\]|<.*?>|\{.*?\}|~.*?~/g, '');
      const v = { e, lat, lon, cq: zq ? +zq[1] : e.cq, itu: zi ? +zi[1] : e.itu };
      if (p[0] === '=') { exact.set(p.slice(1).toUpperCase(), v); if (!e.wae) exactD.set(p.slice(1).toUpperCase(), v); }
      else { pfx.set(p.toUpperCase(), v); if (!e.wae) pfxD.set(p.toUpperCase(), v); if (p.length > maxLen) maxLen = p.length; }
    }
  }
}

/** Pays d'un indicatif : { name, pfx (préfixe principal DXCC), cont, cq, itu, lat, lon } ou null */
// Mémoire des recherches (carnet de 200 000 QSO : statistiques recalculées sans refaire chaque recherche de préfixe)
const memo = [new Map(), new Map()];
function lookup(call, dxccOnly) {
  const key = String(call || '');
  const M = memo[dxccOnly ? 1 : 0];
  if (M.has(key)) { const r = M.get(key); return r ? Object.assign({}, r) : null; }
  const r = lookup0(key, dxccOnly);
  if (M.size > 400000) M.clear();
  M.set(key, r);
  return r ? Object.assign({}, r) : null;
}
function lookup0(call, dxccOnly) {
  load();
  if (!pfx || !pfx.size) return null;
  const pfx0 = pfx, exact0 = exact;
  const P = dxccOnly ? pfxD : pfx0, X = dxccOnly ? exactD : exact0;
  let c = String(call || '').toUpperCase().replace(/^<|>$/g, '').trim();
  if (!c || c === '...') return null;
  const x = X.get(c);
  if (x) return Object.assign({}, x.e, { lat: x.lat, lon: x.lon, cq: x.cq, itu: x.itu });
  // Indicatif composé : la partie « pays » est le préfixe (ex. EA8/ON4ABC, ON4ABC/EA8) ; suffixes de service ignorés
  const parts = c.split('/').filter((p) => p && !/^(P|M|MM|AM|QRP|A|R|T|\d)$/.test(p));
  if (parts.length > 1) {
    // La partie la plus courte (≤ 4 caractères) est le préfixe du pays d'émission (EA8, KH6, 3A…)
    const short = parts.slice().sort((a, b) => a.length - b.length)[0];
    c = short.length <= 4 ? short : parts[0];
  } else if (parts.length === 1) c = parts[0];
  for (let n = Math.min(maxLen, c.length); n > 0; n--) {
    const v = P.get(c.slice(0, n));
    if (v) return Object.assign({}, v.e, { lat: v.lat, lon: v.lon, cq: v.cq, itu: v.itu });
  }
  return null;
}

/** Centre d'un locator (4 ou 6 caractères) : { lat, lon } ou null */
function gridLL(g) {
  g = String(g || '').toUpperCase();
  if (!/^[A-R]{2}\d{2}([A-X]{2})?$/.test(g)) return null;
  let lon = (g.charCodeAt(0) - 65) * 20 - 180 + (+g[2]) * 2;
  let lat = (g.charCodeAt(1) - 65) * 10 - 90 + (+g[3]);
  if (g.length === 6) { lon += (g.charCodeAt(4) - 65) * (2 / 24) + 1 / 24; lat += (g.charCodeAt(5) - 65) * (1 / 24) + 1 / 48; }
  else { lon += 1; lat += 0.5; }
  return { lat, lon };
}

/** Distance (km, grand cercle) et azimut (degrés) de a vers b */
function distAz(a, b) {
  const r = Math.PI / 180;
  const f1 = a.lat * r, f2 = b.lat * r, dl = (b.lon - a.lon) * r;
  const d = Math.acos(Math.max(-1, Math.min(1, Math.sin(f1) * Math.sin(f2) + Math.cos(f1) * Math.cos(f2) * Math.cos(dl))));
  const az = Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl));
  return { km: Math.round(d * 6371), az: Math.round(((az / r) + 360) % 360) };
}

/** Pays DXCC au sens du diplôme (entités WAE de cty.dat ramenées à leur pays : Sicile → Italie…) */
const lookupDxcc = (call) => lookup(call, true);

/** Toutes les entités DXCC de cty.dat (sans les entités WAE) : [{ pfx, name, cont }] */
function entities() { load(); return (ent || []).filter((e) => !e.wae).map((e) => ({ pfx: e.pfx, name: e.name, cont: e.cont })); }

/** Toutes les entités de cty.dat, WAE comprises (Sicile, Shetland…) : [{ pfx, name, cont, wae }] */
function entitiesAll() { load(); return (ent || []).map((e) => ({ pfx: e.pfx, name: e.name, cont: e.cont, wae: e.wae })); }

module.exports = { lookup, lookupDxcc, entities, entitiesAll, gridLL, distAz, load };
