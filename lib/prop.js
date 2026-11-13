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

class Prop {
  constructor(onData) {
    this.onData = onData || (() => {});
    this.data = null;
    this.at = 0;
    this.err = '';
    setTimeout(() => this.fetch(), 20 * 1000);
    setInterval(() => this.fetch(), EVERY);
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
      this.onData(this.msg());
    } catch (e) {
      this.err = e.name === 'AbortError' ? 'délai dépassé' : e.message;
    } finally { clearTimeout(t); }
  }
  msg() { return { t: 'prop', data: this.data, at: this.at, err: this.data ? '' : this.err }; }
}

module.exports = { Prop, parse };
