/*
 * spw.js — météo spatiale et propagation : tuiles (flux solaire, taches, Kp, A, vent solaire, Bz / Bt, rayons X,
 * protons, échelles NOAA, MUF de l'ionosonde de Dourbes, bruit, aurore) à partir du message « prop » du serveur
 * (lib/prop.js : hamqsl.com toutes les 30 min, NOAA SWPC et KC2G toutes les 5 min).
 * Utilisé par le bandeau du dashboard (barre Step / Bandes) et par la page /prop.
 */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fr = (v, d) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d == null ? 0 : d).replace('.', ','));
  // État : g = bon (vert), o = moyen (orange), r = mauvais (rouge), '' = inconnu
  const lvl = (v, a, b, rev) => (v == null ? '' : rev ? (v >= b ? 'g' : v >= a ? 'o' : 'r') : (v < a ? 'g' : v < b ? 'o' : 'r'));
  const BANDS = [[28, '10 m'], [24.89, '12 m'], [21, '15 m'], [18.068, '17 m'], [14, '20 m'], [10.1, '30 m'], [7, '40 m'], [5.35, '60 m'], [3.5, '80 m']];
  const xr = (c) => { const m = /^([ABCMX])/.exec(String(c || '')); return m ? m[1] : ''; };
  const sNum = (t) => { const m = /S(\d)(?:\s*-\s*S?(\d))?/i.exec(String(t || '')); return m ? Number(m[2] || m[1]) : null; };

  // ---- Lever / coucher du soleil (algorithme de SunCalc, V. Agafonkin) au locator de la station, en UTC
  const RAD = Math.PI / 180, DAY = 864e5, J1970 = 2440588, J2000 = 2451545, OBL = RAD * 23.4397, J0 = 0.0009;
  function gridLL(g) {
    const m = /^([A-R])([A-R])(\d)(\d)(?:([A-X])([A-X]))?/i.exec(String(g || ''));
    if (!m) return null;
    const U = (c) => c.toUpperCase().charCodeAt(0) - 65;
    let lon = U(m[1]) * 20 - 180 + Number(m[3]) * 2, lat = U(m[2]) * 10 - 90 + Number(m[4]);
    if (m[5]) { lon += U(m[5]) * (5 / 60) + 2.5 / 60; lat += U(m[6]) * (2.5 / 60) + 1.25 / 60; } else { lon += 1; lat += 0.5; }
    return { lat, lon };
  }
  function sunTimes(date, lat, lon) {
    const lw = RAD * -lon, phi = RAD * lat;
    const d = date / DAY - 0.5 + J1970 - J2000;
    const n = Math.round(d - J0 - lw / (2 * Math.PI));
    const transit = (ht) => J0 + (ht + lw) / (2 * Math.PI) + n;
    const ds = transit(0);
    const M = RAD * (357.5291 + 0.98560028 * ds);
    const L = M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI;
    const dec = Math.asin(Math.sin(OBL) * Math.sin(L));
    const tJ = (a) => J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const noon = tJ(ds);
    const fromJ = (j) => (j + 0.5 - J1970) * DAY;
    const at = (h) => {
      const c = (Math.sin(h * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
      if (c < -1 || c > 1) return null; // soleil qui ne se lève pas ou ne se couche pas
      const set = tJ(transit(Math.acos(c)));
      return [fromJ(noon - (set - noon)), fromJ(set)];
    };
    const r = at(-0.833), c = at(-6);
    return { rise: r && r[0], set: r && r[1], dawn: c && c[0], dusk: c && c[1] };
  }
  const utc = (t) => (t ? new Date(t).toISOString().slice(11, 16) : '—');

  /** Liste des tuiles, dans l'ordre d'importance (le bandeau n'affiche que celles qui tiennent) */
  function tiles(m) {
    const d = (m && m.data) || {}, r = (m && m.rt) || {};
    const kp = r.kp != null ? r.kp : d.k;
    const T = [];
    T.push({ k: 'sfi', l: 'Flux solaire (SFI)', s: 'SFI', v: fr(d.sfi), c: lvl(d.sfi, 90, 150, true), t: d.sfi == null ? '' : d.sfi >= 150 ? 'Élevé' : d.sfi >= 90 ? 'Moyen' : 'Faible', n: 'Flux radio solaire à 10,7 cm : plus il est haut, mieux passent les bandes hautes (20 à 10 m)' });
    T.push({ k: 'kp', l: 'Indice Kp (temps réel)', s: 'Kp', v: fr(kp, 1), c: kp == null ? '' : kp < 3 ? 'g' : kp < 5 ? 'o' : 'r', t: kp == null ? '' : kp < 3 ? 'Calme' : kp < 4 ? 'Instable' : kp < 5 ? 'Actif' : 'Orage G' + Math.min(5, Math.floor(kp) - 4), n: 'Agitation géomagnétique (0 à 9)' + (r.kp3h != null ? ' — moyenne 3 h : ' + fr(r.kp3h, 1) : ''), line: r.kpLine });
    const ll = gridLL(m && m.grid);
    if (ll) {
      const now = Date.now(), s = sunTimes(now, ll.lat, ll.lon);
      const day = s.rise && s.set && now >= s.rise && now < s.set;
      const grey = (s.rise && Math.abs(now - s.rise) < 1800e3) || (s.set && Math.abs(now - s.set) < 1800e3);
      T.push({ k: 'sun', l: 'Soleil (UTC)', s: 'Soleil UTC', v: '↑' + utc(s.rise) + ' ↓' + utc(s.set), c: grey ? 'o' : day ? 'g' : '', t: grey ? 'Ligne grise' : day ? 'Jour' : 'Nuit',
        n: 'Lever et coucher du soleil à la station (' + m.grid + '), en heure UTC (GMT) ; crépuscule civil (ligne grise) : aube ' + utc(s.dawn) + ', crépuscule ' + utc(s.dusk) + ' UTC' });
    }
    T.push({ k: 'muf', l: 'MUF estimée (' + (r.mufSt || 'Dourbes') + ')', s: 'MUF', v: fr(r.muf, 1), u: 'MHz', c: r.muf == null ? '' : r.muf >= 21 ? 'g' : r.muf >= 14 ? 'o' : 'r',
      t: r.muf == null ? '' : 'Jusqu’au ' + ((BANDS.find((b) => r.muf >= b[0]) || [0, '80 m'])[1]), n: 'Fréquence maximale utilisable pour un bond de 3 000 km, mesurée par l’ionosonde de ' + (r.mufSt || 'Dourbes') + (r.fof2 != null ? ' : foF2 ' + fr(r.fof2, 1) + ' MHz' + (r.mf != null ? ' × facteur M(3000)F2 ' + fr(r.mf, 2) + ' = MUF ' + fr(r.muf, 1) + ' MHz' : '') : '') + (r.mufAt ? ' à ' + new Date(r.mufAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '') + (r.mufKm ? ' (' + r.mufKm + ' km de la station)' : '') + (r.muf == null ? ' — aucune ionosonde proche à jour pour le moment' : '') });
    T.push({ k: 'a', l: 'Indice A', s: 'A', v: fr(d.a), c: lvl(d.a, 10, 30), t: d.a == null ? '' : d.a < 10 ? 'Calme' : d.a < 30 ? 'Instable' : 'Perturbé', n: 'Agitation géomagnétique moyenne sur 24 h' });
    const x = r.xray || d.xray;
    T.push({ k: 'x', l: 'Rayons X', s: 'X', v: x || '—', c: !x ? '' : /[AB]/.test(xr(x)) ? 'g' : xr(x) === 'C' ? 'o' : 'r', t: !x ? '' : /[AB]/.test(xr(x)) ? 'Calme' : xr(x) === 'C' ? 'Modéré' : xr(x) === 'M' ? 'Fort' : 'Extrême', n: 'Éruptions solaires (A, B, C calme ; M, X : coupures possibles côté jour)' + (r.xrayPeak ? ' — pic sur 6 h : ' + r.xrayPeak : '') });
    const bz = r.bz != null ? r.bz : d.bz;
    T.push({ k: 'bz', l: 'Champ Bz / Bt', s: 'Bz', v: fr(bz, 1), u: r.bt != null ? '/ ' + fr(r.bt, 1) + ' nT' : 'nT', c: bz == null ? '' : bz >= -2 ? 'g' : bz >= -10 ? 'o' : 'r', t: bz == null ? '' : bz >= 0 ? 'Orienté nord' : bz >= -2 ? 'Neutre' : 'Orienté sud', n: 'Bz négatif = énergie transmise à la magnétosphère (risque d’orage)' });
    const w = r.wind != null ? r.wind : d.wind;
    T.push({ k: 'w', l: 'Vent solaire', s: 'Vent', v: fr(w), u: 'km/s', c: w == null ? '' : w < 400 ? 'g' : w < 600 ? 'o' : 'r', t: w == null ? '' : w < 400 ? 'Calme' : w < 600 ? 'Soutenu' : 'Rapide', n: 'Vitesse mesurée par DSCOVR / ACE au point L1' });
    // Échelles NOAA : celles du SWPC ; sinon déduites des mesures (G du Kp, S des protons, R des rayons X)
    let sc = r.scales, scEst = false;
    if (!sc && (kp != null || x || r.proton != null)) {
      const xm = /^([MX])(\d+(?:\.\d+)?)/.exec(String(x || '')), xv = xm ? (xm[1] === 'X' ? 10 : 1) * Number(xm[2]) : 0;
      const pp = r.proton != null ? r.proton : d.proton;
      sc = { R: xv >= 20 ? 4 : xv >= 10 ? 3 : xv >= 5 ? 2 : xv >= 1 ? 1 : 0, S: pp >= 1e4 ? 4 : pp >= 1e3 ? 3 : pp >= 100 ? 2 : pp >= 10 ? 1 : 0, G: kp >= 9 ? 5 : kp >= 5 ? Math.floor(kp) - 4 : 0 };
      scEst = true;
    }
    T.push({ k: 'n', l: 'Échelles NOAA', s: 'NOAA', v: sc ? 'R' + sc.R + ' · S' + sc.S + ' · G' + sc.G : '—', c: !sc ? '' : !sc.R && !sc.S && !sc.G ? 'g' : Math.max(sc.R, sc.S, sc.G) <= 2 ? 'o' : 'r', t: !sc ? '' : !sc.R && !sc.S && !sc.G ? 'Aucune alerte' : 'Alerte', n: 'R : coupure radio · S : protons · G : orage géomagnétique (0 à 5)' + (scEst ? ' — estimées d’après les rayons X, les protons et le Kp (échelles du SWPC indisponibles)' : '') });
    const ns = sNum(d.noise);
    T.push({ k: 'no', l: 'Bruit de fond', s: 'Bruit', v: d.noise || '—', c: ns == null ? '' : ns <= 1 ? 'g' : ns <= 4 ? 'o' : 'r', t: ns == null ? '' : ns <= 1 ? 'Faible' : ns <= 4 ? 'Modéré' : 'Fort', n: 'Bruit géomagnétique estimé' });
    T.push({ k: 'ssn', l: 'Taches solaires', s: 'Taches', v: fr(d.ssn), c: lvl(d.ssn, 50, 120, true), t: d.ssn == null ? '' : d.ssn >= 120 ? 'Élevé' : d.ssn >= 50 ? 'Moyen' : 'Faible', n: 'Nombre de Wolf du jour' });
    const p = r.proton != null ? r.proton : d.proton;
    T.push({ k: 'p', l: 'Protons ≥ 10 MeV', s: 'Protons', v: fr(p, 2), u: 'pfu', c: p == null ? '' : p < 10 ? 'g' : p < 100 ? 'o' : 'r', t: p == null ? '' : p < 10 ? 'Normal' : 'Alerte S' + (p < 100 ? 1 : p < 1000 ? 2 : 3), n: 'Seuil d’alerte : 10 pfu (absorption sur les trajets polaires)' });
    T.push({ k: 'au', l: 'Activité aurorale', s: 'Aurore', v: fr(d.aurora), u: '/10', c: d.aurora == null ? '' : d.aurora < 4 ? 'g' : d.aurora < 7 ? 'o' : 'r', t: d.aurora == null ? '' : d.aurora < 4 ? 'Faible' : d.aurora < 7 ? 'Modérée' : 'Forte', n: 'Ovale auroral (hamqsl)' });
    return T;
  }

  function spark(line, w, h) {
    if (!line || line.length < 2) return '';
    const ks = line.map((p) => p[1]);
    const mx = Math.max(4, ...ks);
    const pts = ks.map((k, i) => (i * (w / (ks.length - 1))).toFixed(1) + ',' + (h - 1 - (k / mx) * (h - 2)).toFixed(1)).join(' ');
    return '<svg class="spw-sp" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
  }

  /** Bandeau compact : chaque tuile = libellé court, valeur, pastille d'état (détails au survol) */
  function strip(el, m) {
    if (!el) return;
    const T = tiles(m);
    const age = m && m.rt && m.rt.at ? Math.round((Date.now() - m.rt.at) / 60000) : null;
    el.innerHTML = T.map((x) => '<div class="spw-t ' + (x.c || '') + '" title="' + esc(x.l + ' : ' + x.v + (x.u ? ' ' + x.u : '') + (x.t ? ' — ' + x.t : '') + '\n' + x.n) + '">' +
      '<span class="spw-l">' + esc(x.s) + '</span><b>' + esc(x.v) + (x.u && x.k !== 'bz' ? '<small> ' + esc(x.u) + '</small>' : '') + '</b>' +
      '<span class="spw-st"><i></i>' + esc(x.t || '—') + '</span></div>').join('');
    el.title = 'Propagation et météo spatiale' + (age != null ? ' (mesures d’il y a ' + age + ' min)' : '') + ' — clic : page Propagation';
    el.hidden = !(m && (m.data || (m.rt && m.rt.kp != null)));
  }

  /**
   * Fenêtres des modes (TRX DIGI, TRX SSB, TRX CW) : même bandeau, alimenté par le dashboard qui les a ouvertes
   * (RSHOST : messages « prop » du serveur ; RSPROP : le dernier reçu). Clic : page Propagation.
   */
  function attach(el) {
    if (!el) return;
    let host = null, untap = null, last = null;
    const show = (m) => { if (m && m.t === 'prop') { last = m; strip(el, m); } };
    const link = () => {
      let w = window.opener, hw = null;
      for (let i = 0; i < 4 && w; i++) { try { if (w.closed) break; if (w.RSHOST) { hw = w; break; } w = w.opener; } catch (e) { break; } }
      const h = hw ? hw.RSHOST : null;
      if (h === host) return;
      if (untap) { try { untap(); } catch (e) { /* */ } }
      host = h; untap = null;
      if (!h) return;
      try { untap = h.tap ? h.tap(show) : null; if (hw.RSPROP) show(hw.RSPROP); else h.api.send({ t: 'prop_get' }); } catch (e) { /* dashboard fermé */ }
    };
    // Dans la ligne du titre de la page (TRX DIGI : titre créé un peu après le chargement), poussé à droite
    const place = () => { const h1 = document.querySelector('.cwp-head h1'); if (h1 && el.parentNode !== h1) { h1.appendChild(el); el.classList.add('spw-head'); } };
    place();
    setTimeout(place, 600);
    link();
    setInterval(() => { place(); link(); }, 5000);
    setInterval(() => { if (last) strip(el, last); }, 60000); // soleil : jour / ligne grise / nuit
    const go = () => window.open('/prop', 'rs-prop', 'width=1280,height=860');
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  window.SPW = { tiles, strip, spark, esc, fr, attach, sunTimes, gridLL };
})();
