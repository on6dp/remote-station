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

  /** Liste des tuiles, dans l'ordre d'importance (le bandeau n'affiche que celles qui tiennent) */
  function tiles(m) {
    const d = (m && m.data) || {}, r = (m && m.rt) || {};
    const kp = r.kp != null ? r.kp : d.k;
    const T = [];
    T.push({ k: 'sfi', l: 'Flux solaire (SFI)', s: 'SFI', v: fr(d.sfi), c: lvl(d.sfi, 90, 150, true), t: d.sfi == null ? '' : d.sfi >= 150 ? 'Élevé' : d.sfi >= 90 ? 'Moyen' : 'Faible', n: 'Flux radio solaire à 10,7 cm : plus il est haut, mieux passent les bandes hautes (20 à 10 m)' });
    T.push({ k: 'kp', l: 'Indice Kp (temps réel)', s: 'Kp', v: fr(kp, 1), c: kp == null ? '' : kp < 3 ? 'g' : kp < 5 ? 'o' : 'r', t: kp == null ? '' : kp < 3 ? 'Calme' : kp < 4 ? 'Instable' : kp < 5 ? 'Actif' : 'Orage G' + Math.min(5, Math.floor(kp) - 4), n: 'Agitation géomagnétique (0 à 9)' + (r.kp3h != null ? ' — moyenne 3 h : ' + fr(r.kp3h, 1) : ''), line: r.kpLine });
    T.push({ k: 'muf', l: 'MUF estimée (' + (r.mufSt || 'Dourbes') + ')', s: 'MUF', v: fr(r.muf, 1), u: 'MHz', c: r.muf == null ? '' : r.muf >= 21 ? 'g' : r.muf >= 14 ? 'o' : 'r',
      t: r.muf == null ? '' : 'Jusqu’au ' + ((BANDS.find((b) => r.muf >= b[0]) || [0, '80 m'])[1]), n: 'Fréquence maximale utilisable pour un bond de 3 000 km, mesurée par l’ionosonde de ' + (r.mufSt || 'Dourbes') + (r.fof2 != null ? ' : foF2 ' + fr(r.fof2, 1) + ' MHz' + (r.mf != null ? ' × facteur M(3000)F2 ' + fr(r.mf, 2) + ' = MUF ' + fr(r.muf, 1) + ' MHz' : '') : '') + (r.mufAt ? ' à ' + new Date(r.mufAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '') });
    T.push({ k: 'a', l: 'Indice A', s: 'A', v: fr(d.a), c: lvl(d.a, 10, 30), t: d.a == null ? '' : d.a < 10 ? 'Calme' : d.a < 30 ? 'Instable' : 'Perturbé', n: 'Agitation géomagnétique moyenne sur 24 h' });
    const x = r.xray || d.xray;
    T.push({ k: 'x', l: 'Rayons X', s: 'X', v: x || '—', c: !x ? '' : /[AB]/.test(xr(x)) ? 'g' : xr(x) === 'C' ? 'o' : 'r', t: !x ? '' : /[AB]/.test(xr(x)) ? 'Calme' : xr(x) === 'C' ? 'Modéré' : xr(x) === 'M' ? 'Fort' : 'Extrême', n: 'Éruptions solaires (A, B, C calme ; M, X : coupures possibles côté jour)' + (r.xrayPeak ? ' — pic sur 6 h : ' + r.xrayPeak : '') });
    const bz = r.bz != null ? r.bz : d.bz;
    T.push({ k: 'bz', l: 'Champ Bz / Bt', s: 'Bz', v: fr(bz, 1), u: r.bt != null ? '/ ' + fr(r.bt, 1) + ' nT' : 'nT', c: bz == null ? '' : bz >= -2 ? 'g' : bz >= -10 ? 'o' : 'r', t: bz == null ? '' : bz >= 0 ? 'Orienté nord' : bz >= -2 ? 'Neutre' : 'Orienté sud', n: 'Bz négatif = énergie transmise à la magnétosphère (risque d’orage)' });
    const w = r.wind != null ? r.wind : d.wind;
    T.push({ k: 'w', l: 'Vent solaire', s: 'Vent', v: fr(w), u: 'km/s', c: w == null ? '' : w < 400 ? 'g' : w < 600 ? 'o' : 'r', t: w == null ? '' : w < 400 ? 'Calme' : w < 600 ? 'Soutenu' : 'Rapide', n: 'Vitesse mesurée par DSCOVR / ACE au point L1' });
    const sc = r.scales;
    T.push({ k: 'n', l: 'Échelles NOAA', s: 'NOAA', v: sc ? 'R' + sc.R + ' · S' + sc.S + ' · G' + sc.G : '—', c: !sc ? '' : !sc.R && !sc.S && !sc.G ? 'g' : Math.max(sc.R, sc.S, sc.G) <= 2 ? 'o' : 'r', t: !sc ? '' : !sc.R && !sc.S && !sc.G ? 'Aucune alerte' : 'Alerte', n: 'R : coupure radio · S : protons · G : orage géomagnétique (0 à 5)' });
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

  window.SPW = { tiles, strip, spark, esc, fr };
})();
