'use strict';
/**
 * qrz.js — recherche d'un indicatif sur QRZ.com (API XML, https://xmldata.qrz.com/xml/current/).
 * Identifiant et mot de passe QRZ.com : réglages du carnet (serveur), jamais envoyés au navigateur.
 * Sans abonnement XML, QRZ ne renvoie qu'une partie des champs (prénom, nom, ville, pays) ; avec, aussi le locator.
 * Résultats gardés 24 h en mémoire ; clé de session redemandée quand QRZ la déclare expirée.
 */
const https = require('https');

const URL = 'https://xmldata.qrz.com/xml/current/';
const CACHE_MS = 24 * 3600 * 1000;

function get(url, ms) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: ms || 8000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; if (body.length > 200000) req.destroy(new Error('réponse trop longue')); });
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => req.destroy(new Error('QRZ.com ne répond pas')));
    req.on('error', reject);
  });
}
const dec = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').trim();
const tag = (xml, t) => { const m = new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>', 'i').exec(xml); return m ? dec(m[1]) : ''; };

class Qrz {
  /** getCreds() → { user, password } ; agent : nom du programme annoncé à QRZ */
  constructor(getCreds, agent) {
    this.getCreds = getCreds;
    this.agent = agent || 'RemoteStation';
    this.key = '';
    this.keyFor = '';
    this.cache = new Map();
    this.busy = null;
  }
  configured() { const c = this.getCreds() || {}; return !!(c.user && c.password); }
  async login() {
    const c = this.getCreds() || {};
    if (!c.user || !c.password) throw new Error('identifiant QRZ.com non réglé (Logs → Configuration → QRZ)');
    const xml = await get(URL + '?username=' + encodeURIComponent(c.user) + ';password=' + encodeURIComponent(c.password) + ';agent=' + encodeURIComponent(this.agent));
    const key = tag(xml, 'Key');
    const err = tag(xml, 'Error');
    if (!key) throw new Error('QRZ.com : ' + (err || 'connexion refusée'));
    this.key = key;
    this.keyFor = c.user + '\n' + c.password;
    this.sub = tag(xml, 'SubExp');
    return { key, sub: this.sub, count: tag(xml, 'Count') };
  }
  /** Fiche d'un indicatif : { call, name, fname, qth, country, grid, sub } ou null s'il n'existe pas */
  async lookup(call) {
    call = String(call || '').toUpperCase().replace(/[^A-Z0-9/]/g, '').slice(0, 15);
    if (!call) return null;
    const hit = this.cache.get(call);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
    const c = this.getCreds() || {};
    if (!this.key || this.keyFor !== c.user + '\n' + c.password) await this.login();
    let xml = await get(URL + '?s=' + encodeURIComponent(this.key) + ';callsign=' + encodeURIComponent(call));
    let err = tag(xml, 'Error');
    // Session expirée : nouvelle clé, une seule fois
    if (!tag(xml, 'Callsign') && /session|key/i.test(err)) {
      await this.login();
      xml = await get(URL + '?s=' + encodeURIComponent(this.key) + ';callsign=' + encodeURIComponent(call));
      err = tag(xml, 'Error');
    }
    const blk = /<Callsign>([\s\S]*?)<\/Callsign>/i.exec(xml);
    if (!blk) {
      if (/not found/i.test(err)) { this.cache.set(call, { at: Date.now(), v: null }); return null; }
      throw new Error('QRZ.com : ' + (err || 'réponse inattendue'));
    }
    const b = blk[1];
    const fname = tag(b, 'fname');
    const v = {
      call: tag(b, 'call') || call,
      fname,
      name: tag(b, 'name'),
      nick: tag(b, 'nickname'),
      qth: tag(b, 'addr2'),
      state: tag(b, 'state'),
      country: tag(b, 'country') || tag(b, 'land'),
      grid: tag(b, 'grid').toUpperCase().slice(0, 6),
      sub: !!this.sub && !/non-subscriber/i.test(this.sub)
    };
    this.cache.set(call, { at: Date.now(), v });
    if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value);
    return v;
  }
  reset() { this.key = ''; this.cache.clear(); }
}

module.exports = { Qrz };
