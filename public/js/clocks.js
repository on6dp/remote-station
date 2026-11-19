/*
 * clocks.js — trois cadres d'horloge (heure UTC, heure locale de la station, date UTC), comme dans le bandeau du
 * dashboard, à droite de la ligne de titre des pages des modes (CW, SSB, numériques), du carnet en grand et de la
 * page Propagation. Styles inclus (la page Propagation n'utilise pas rp.css).
 */
(function () {
  'use strict';
  if (window.RSCLOCKS) return;
  const CSS = '.rsclk{display:inline-flex;gap:6px;flex:none !important;align-self:center;margin-left:10px;text-transform:none;letter-spacing:normal;white-space:nowrap}' +
    '.rsclk .bx{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:92px;height:46px;box-sizing:border-box;padding:2px 10px;border-radius:10px;border:1.5px solid #2b3b4e;background:#101924;cursor:help}' +
    '.rsclk small{font:800 9.5px/1.4 system-ui,"Segoe UI",Arial,sans-serif !important;color:#94a3b8 !important;letter-spacing:1.5px !important;text-transform:uppercase;margin:0 !important}' +
    '.rsclk b{font:900 19px/1.05 ui-monospace,"Roboto Mono",Consolas,monospace;color:#fff;letter-spacing:1px}' +
    '.rsclk b.d{font-size:14px;line-height:1.4}' +
    '.rsclk .bx.u{border-color:#22d3ee;box-shadow:0 0 12px rgba(34,211,238,.18)}.rsclk .bx.u small{color:#22d3ee !important}' +
    'header .rsclk{margin-left:auto}' +
    '@media (max-width:1100px){.rsclk .bx{min-width:76px;padding:2px 6px}.rsclk b{font-size:16px}.rsclk b.d{font-size:12px}}';
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  const J = ['DIMANCHE', 'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI'], p2 = (n) => String(n).padStart(2, '0');
  const el = document.createElement('span');
  el.className = 'rsclk';
  el.innerHTML = '<span class="bx u" title="Heure GMT (UTC), celle du log"><small>UTC</small><b data-k="u">--:--:--</b></span>' +
    '<span class="bx" title="Heure locale de la station (Belgique)"><small data-k="ll">LIÈGE</small><b data-k="l">--:--:--</b></span>' +
    '<span class="bx" title="Date GMT (UTC), celle du log"><small data-k="j">—</small><b class="d" data-k="d">--/--/----</b></span>';
  const k = (n) => el.querySelector('[data-k="' + n + '"]');
  let fmt = null;
  try { fmt = new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); } catch (e) { fmt = null; }
  const tick = () => {
    const d = new Date();
    k('u').textContent = p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds());
    k('l').textContent = fmt ? fmt.format(d).replace(/\./g, ':') : p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    const day = p2(d.getUTCDate()) + '/' + p2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
    if (k('d').textContent !== day) k('d').textContent = day;
    if (k('j').textContent !== J[d.getUTCDay()]) k('j').textContent = J[d.getUTCDay()];
  };
  // Ville du lieu de la station : « Remote Station UBA-LGE - Liège, Belgium » → LIÈGE
  fetch('/api/info', { cache: 'no-store' }).then((r) => r.json()).then((i) => {
    const town = (String(i.clubName || '').split(/\s+[-–—]\s+/)[1] || '').split(',')[0].trim();
    if (town) k('ll').textContent = town.toUpperCase();
  }).catch(() => {});
  // À droite de la ligne du titre (pages des modes : titre créé un peu après le chargement), sinon de l'en-tête (Propagation)
  const place = () => {
    const t = document.querySelector('.cwp-head h1') || document.querySelector('body > .wrap > header, body > header');
    if (t && (el.parentNode !== t || t.lastElementChild !== el)) t.appendChild(el);
  };
  tick();
  setInterval(tick, 1000);
  place();
  setTimeout(place, 600);
  setTimeout(place, 2000);
  setInterval(place, 5000);
  window.RSCLOCKS = { el, place };
})();
