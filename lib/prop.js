'use strict';
/*
 * prop.js — facteurs de propagation (flux solaire SFI, taches, indices A et K, rayons X, vent solaire, Bz, champ
 * géomagnétique, bruit, et conditions HF calculées jour / nuit par groupe de bandes, VHF : aurore, E sporadique).
 * Source : N0NBH, https://www.hamqsl.com/solarxml.php (données NOAA / SWPC), relue toutes les 30 minutes par le serveur
 * (une seule requête pour tous les membres), envoyée aux pages qui la demandent (« prop »).
 */
const URL = 'https://www.hamqsl.com/solarxml.php';
const EVERY = 30 * 60 * 1000;

function tag(x, name) {
  const m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i').exec(x);
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
}
function num(v) { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; }

/** XML de hamqsl → objet compact */
function parse(xml) {
  const x = String(xml || '');
  if (!/<solardata/i.test(x)) throw new Error('réponse inattendue');
  const bands = [];
  const reB = /<band\s+name="([^"]+)"\s+time="([^"]+)"\s*>([^<]*)<\/band>/gi;
  let m;
  while ((m = reB.exec(x))) {
    let b = bands.find((o) => o.name === m[1]);
    if (!b) { b = { name: m[1] }; bands.push(b); }
    b[/night/i.test(m[2]) ? 'night' : 'day'] = m[3].trim();
  }
  const vhf = [];
  const reV = /<phenomenon\s+name="([^"]+)"\s+location="([^"]+)"\s*>([^<]*)<\/phenomenon>/gi;
  while ((m = reV.exec(x))) vhf.push({ name: m[1], loc: m[2], v: m[3].trim() });
  return {
    updated: tag(x, 'updated'),
    sfi: num(tag(x, 'solarflux')),
    ssn: num(tag(x, 'sunspots')),
    a: num(tag(x, 'aindex')),
    k: num(tag(x, 'kindex')),
    xray: tag(x, 'xray'),
    wind: num(tag(x, 'solarwind')),
    bz: num(tag(x, 'magneticfield')),
    proton: num(tag(x, 'protonflux')),
    aurora: num(tag(x, 'aurora')),
    geomag: tag(x, 'geomagfield'),
    noise: tag(x, 'signalnoise'),
    muf: tag(x, 'muf'),
    fof2: tag(x, 'fof2'),
    bands: bands.slice(0, 8),
    vhf: vhf.slice(0, 8)
  };
}

// ---- Temps réel : NOAA SWPC (Kp minute, vent solaire DSCOVR/ACE, Bz / Bt, rayons X et protons GOES, échelles R/S/G)
// et ionosonde de Dourbes (Belgique, KC2G / GIRO : MUF 3000 km, foF2), relus toutes les 5 minutes
const SWPC = 'https://services.swpc.noaa.gov';
const RT = {
  kp: SWPC + '/json/planetary_k_index_1m.json',
  kp3: SWPC + '/products/noaa-planetary-k-index.json',
  plasma: SWPC + '/products/solar-wind/plasma-5-minute.json',
  mag: SWPC + '/products/solar-wind/mag-5-minute.json',
  xray: SWPC + '/json/goes/primary/xrays-6-hour.json',
  proton: SWPC + '/json/goes/primary/integral-protons-6-hour.json',
  scales: SWPC + '/products/noaa-scales.json',
  iono: 'https://prop.kc2g.com/api/stations.json'
};
const RT_EVERY = 5 * 60 * 1000;
const IONO = ['DB049', 'RL052', 'JR055', 'PQ052']; // Dourbes (BE), puis Chilton (GB), Juliusruh (DE), Pruhonice (CZ)

/** Tableau JSON → objets : accepte [{…}] et [[en-têtes], [valeurs]…] (formats des produits SWPC) */
function rows(j) {
  if (!Array.isArray(j) || !j.length) return [];
  if (Array.isArray(j[0])) { const h = j[0].map(String); return j.slice(1).map((r) => { const o = {}; h.forEach((k, i) => { o[k] = r[i]; }); return o; }); }
  return j.filter((o) => o && typeof o === 'object');
}
const pick = (o, re) => { for (const k in o) if (re.test(k)) return o[k]; return undefined; };
/** Classe des rayons X (flux 0,1–0,8 nm en W/m²) : A, B, C, M, X + chiffre */
function xclass(f) {
  if (!(f > 0)) return '';
  const L = [['X', 1e-4], ['M', 1e-5], ['C', 1e-6], ['B', 1e-7], ['A', 1e-8]];
  for (const [c, b] of L) if (f >= b) return c + (f / b).toFixed(1);
  return 'A0.0';
}
async function getJson(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'remote-station (ON5VL club station)', Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

class Prop {
  constructor(onData, opts) {
    this.onData = onData || (() => {});
    this.data = null;
    this.rt = {};
    this.at = 0;
    this.err = '';
    this.histFile = (opts && opts.histFile) || '';
    this.grid = (opts && opts.grid) || (() => '');
    this.hist = this.loadHist();
    setTimeout(() => this.fetch(), 20 * 1000);
    setInterval(() => this.fetch(), EVERY);
    setTimeout(() => this.fetchRt(), 25 * 1000);
    setInterval(() => this.fetchRt(), RT_EVERY);
  }
  async fetch() {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(URL, { signal: ctl.signal, headers: { 'User-Agent': 'remote-station (ON5VL club station)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this.data = parse(await r.text());
      this.at = Date.now();
      this.err = '';
      this.record();
      this.onData(this.msg());
    } catch (e) {
      this.err = e.name === 'AbortError' ? 'délai dépassé' : e.message;
    } finally { clearTimeout(t); }
  }
  /** Mesures en temps réel (chaque source à part : une panne n'efface pas les autres) */
  async fetchRt() {
    const rt = this.rt;
    const tasks = {
      kp: async () => {
        const a = rows(await getJson(RT.kp));
        const v = a.map((o) => ({ t: Date.parse(String(o.time_tag || '') + (/Z$/.test(o.time_tag) ? '' : 'Z')), k: num(o.estimated_kp != null ? o.estimated_kp : o.kp_index) })).filter((o) => o.t && o.k != null);
        if (!v.length) return;
        const last = v[v.length - 1];
        const h3 = v.filter((o) => o.t > last.t - 3 * 3600e3);
        rt.kp = Math.round(last.k * 100) / 100; rt.kpAt = last.t;
        rt.kp3h = Math.round(10 * h3.reduce((s, o) => s + o.k, 0) / h3.length) / 10;
        // Courbe : une valeur toutes les 10 min sur les dernières heures
        const sp = [];
        for (const o of v) if (!sp.length || o.t - sp[sp.length - 1][0] >= 600e3) sp.push([o.t, Math.round(o.k * 100) / 100]);
        rt.kpLine = sp.slice(-48);
      },
      kp3: async () => {
        const a = rows(await getJson(RT.kp3));
        const v = a.map((o) => ({ t: Date.parse(String(pick(o, /time/i) || '').replace(' ', 'T') + (/Z$/.test(String(pick(o, /time/i) || '')) ? '' : 'Z')), k: num(pick(o, /^kp$|kp_index|^Kp$/i)) })).filter((o) => o.t && o.k != null);
        if (v.length) rt.kpDays = v.slice(-56).map((o) => [o.t, o.k]); // 3 h × 56 = 7 jours
      },
      plasma: async () => {
        const a = rows(await getJson(RT.plasma)).filter((o) => num(pick(o, /speed/i)) != null);
        const o = a[a.length - 1];
        if (o) { rt.wind = Math.round(num(pick(o, /speed/i))); rt.dens = num(pick(o, /density/i)); rt.windAt = Date.parse(String(pick(o, /time/i)).replace(' ', 'T') + 'Z') || Date.now(); }
      },
      mag: async () => {
        const a = rows(await getJson(RT.mag)).filter((o) => num(pick(o, /bz/i)) != null);
        const o = a[a.length - 1];
        if (o) { rt.bz = Math.round(10 * num(pick(o, /bz/i))) / 10; rt.bt = Math.round(10 * num(pick(o, /^bt$/i))) / 10; }
      },
      xray: async () => {
        const a = rows(await getJson(RT.xray)).filter((o) => /0\.1-0\.8/.test(String(o.energy)) && num(o.flux) > 0);
        if (!a.length) return;
        rt.xray = xclass(num(a[a.length - 1].flux));
        rt.xrayPeak = xclass(Math.max.apply(null, a.map((o) => num(o.flux))));
      },
      proton: async () => {
        const a = rows(await getJson(RT.proton)).filter((o) => />=\s*10\s*MeV/i.test(String(o.energy)) && num(o.flux) != null);
        if (a.length) rt.proton = Math.round(100 * num(a[a.length - 1].flux)) / 100;
      },
      scales: async () => {
        const j = await getJson(RT.scales);
        const z = j && (j['0'] || j[0]);
        if (z) rt.scales = { R: num(z.R && z.R.Scale) || 0, S: num(z.S && z.S.Scale) || 0, G: num(z.G && z.G.Scale) || 0 };
      },
      iono: async () => {
        const a = await getJson(RT.iono, 25000);
        if (!Array.isArray(a)) return;
        for (const code of IONO) {
          const o = a.find((x) => x && x.station && x.station.code === code && num(x.mufd) != null);
          if (!o) continue;
          const t = Date.parse(String(o.time).replace(' ', 'T') + (/Z$/.test(o.time) ? '' : 'Z'));
          if (!(Date.now() - t < 3 * 3600e3)) continue; // mesure de plus de 3 h : station suivante
          rt.muf = Math.round(10 * num(o.mufd)) / 10; rt.fof2 = num(o.fof2) != null ? Math.round(10 * num(o.fof2)) / 10 : null;
          rt.mufAt = t; rt.mufSt = String(o.station.name || code).replace(/,.*$/, '');
          // Facteur M(3000)F2 : MUF(3000) = foF2 × M ; donné par l'ionosonde (md), sinon recalculé
          rt.mf = num(o.md) != null ? Math.round(100 * num(o.md)) / 100 : (rt.fof2 ? Math.round(100 * rt.muf / rt.fof2) / 100 : null);
          return;
        }
        rt.muf = null; rt.mufSt = '';
      }
    };
    const errs = [];
    await Promise.all(Object.keys(tasks).map((k) => tasks[k]().catch((e) => errs.push(k + ' : ' + (e.name === 'AbortError' ? 'délai dépassé' : e.message)))));
    rt.at = Date.now();
    rt.errs = errs.slice(0, 8);
    this.record();
    this.onData(this.msg());
  }
  // ---- Historique : une ligne par jour (SFI, taches, A, Kp max, rayons X max, MUF max), 120 jours
  loadHist() {
    if (!this.histFile) return [];
    try { const j = JSON.parse(require('fs').readFileSync(this.histFile, 'utf8')); return Array.isArray(j) ? j.slice(-120) : []; } catch (e) { return []; }
  }
  record() {
    const d = new Date().toISOString().slice(0, 10);
    let h = this.hist.find((x) => x.d === d);
    if (!h) { h = { d }; this.hist.push(h); while (this.hist.length > 120) this.hist.shift(); }
    const D = this.data || {}, R = this.rt;
    if (D.sfi != null) h.sfi = D.sfi;
    if (D.ssn != null) h.ssn = D.ssn;
    if (D.a != null) h.a = D.a;
    const kp = R.kp != null ? R.kp : D.k;
    if (kp != null) h.kp = Math.max(h.kp || 0, kp);
    if (R.xrayPeak && (!h.x || xrank(R.xrayPeak) > xrank(h.x))) h.x = R.xrayPeak;
    if (R.muf != null) h.muf = Math.max(h.muf || 0, R.muf);
    if (!this.histFile) return;
    try { const fs = require('fs'); fs.writeFileSync(this.histFile + '.tmp', JSON.stringify(this.hist)); fs.renameSync(this.histFile + '.tmp', this.histFile); } catch (e) { /* dossier en lecture seule : pas d'historique */ }
  }
  msg() { return { t: 'prop', grid: String(this.grid() || '').toUpperCase(), data: this.data, rt: this.rt, hist: this.hist.slice(-60), at: this.at, err: this.data || this.rt.kp != null ? '' : this.err }; }
}
function xrank(c) { const m = /^([ABCMX])(\d+(?:\.\d+)?)/.exec(String(c || '')); return m ? 'ABCMX'.indexOf(m[1]) * 100 + Number(m[2]) : -1; }

module.exports = { Prop, parse, rows, xclass };
