/*
 * clocks.js — carte du bandeau (logo, nom, lieu · version) et trois cadres d'horloge (heure UTC, heure locale de la station, date UTC), comme dans le bandeau du
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
    // Carte complète comme le bandeau du dashboard : logo, nom + lieu · version, puis les trois horloges
    '.rscard{display:inline-flex;align-items:center;gap:12px;flex:none !important;align-self:center;margin-left:12px;padding:4px 12px;border-radius:12px;background:linear-gradient(90deg,#1b3a66 0%,#14305a 45%,#102748 100%);border:1.5px solid #2c5185;box-shadow:0 2px 14px rgba(0,0,0,.45),0 0 18px rgba(44,81,133,.35);text-transform:none;letter-spacing:normal;white-space:nowrap}' +
    '.wrap > header .rscard, body > header:not(.cwp-head) .rscard{margin-left:auto}' +
    // Pages des modes : la carte remplace le sous-titre « Remote Station · … » du titre, avant les tuiles de propagation
    '.cwp-head h1 > small{display:none !important}.cwp-head h1 .rscard{margin-left:16px}' +
    '.rscard .rsclk{margin-left:0}.rscard .rsclk .bx{background:#0b1422;border-color:#35598c}.rscard .rsclk .bx.u{border-color:#22d3ee}' +
    '.rscard img{height:38px;width:auto;filter:brightness(1.45) saturate(1.1) drop-shadow(0 0 5px rgba(255,255,255,.22))}' +
    '.rscard .mid{display:flex;flex-direction:column;align-items:flex-start;gap:3px}' +
    '.rscard .nm{font:900 17px/1.1 system-ui,"Segoe UI",Arial,sans-serif;color:#fff;letter-spacing:.3px;text-transform:none}' +
    '.rscard .sub{display:flex;align-items:baseline;gap:10px;font:800 10.5px/1.3 system-ui,"Segoe UI",Arial,sans-serif !important;color:#5ee0f5 !important;letter-spacing:2px !important;text-transform:uppercase;margin:0 !important}' +
    '.rscard .ver{font:700 10.5px/1.3 ui-monospace,"Roboto Mono",Consolas,monospace;color:#8aa3c4;letter-spacing:.5px;text-transform:none}' +
    '@media (max-width:1800px){.rscard .mid{display:none}}@media (max-width:1400px){.rscard img{display:none}.rscard{padding:3px 8px}}' +
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
  const card = document.createElement('span');
  card.className = 'rscard';
  card.innerHTML = '<img src="/img/on5vl-logo.png" alt="" aria-hidden="true" width="88" height="38"><span class="mid"><b class="nm" data-c="nm">Remote Station</b><small class="sub"><span data-c="pl"></span><span class="ver" data-c="v"></span></small></span>';
  card.appendChild(el);
  const kc = (n) => card.querySelector('[data-c="' + n + '"]');
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
    const parts = String(i.clubName || '').split(/\s+[-–—]\s+/);
    const town = (parts[1] || '').split(',')[0].trim();
    if (town) k('ll').textContent = town.toUpperCase();
    if (parts[0]) kc('nm').textContent = parts[0];
    kc('pl').textContent = parts.slice(1).join(' · ');
    if (i.version) kc('v').textContent = 'v.' + i.version;
  }).catch(() => {});
  // Pages des modes : juste après le titre, à la place du sous-titre (titre créé un peu après le chargement) ;
  // page Propagation : à droite de l'en-tête
  const place = () => {
    const h1 = document.querySelector('.cwp-head h1');
    if (h1) {
      const spw = h1.querySelector(':scope > .spw');
      if (spw) { if (card.nextElementSibling !== spw) h1.insertBefore(card, spw); } else if (card.parentNode !== h1) h1.appendChild(card);
      return;
    }
    const t = document.querySelector('body > .wrap > header, body > header');
    if (t && (card.parentNode !== t || t.lastElementChild !== card)) t.appendChild(card);
  };
  tick();
  setInterval(tick, 1000);
  place();
  setTimeout(place, 600);
  setTimeout(place, 2000);
  setInterval(place, 5000);
  window.RSCLOCKS = { el, card, place };
})();
