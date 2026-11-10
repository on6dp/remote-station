/*
 * bandmap-lite.js — carte de bande verticale (spots du DX cluster) pour les pages TRX CW et TRX SSB : la bande du TRX,
 * la partie CW ou phonie, le TRX (trait rouge), les spots (indicatif + fréquence), du bas (fréquences basses) vers le haut.
 * RSBMAP.mount(el, { api, kit, mode: 'CW' | 'SSB', worked(call, band) → 'dup' | '' , onPick(call, spot) })
 * Spots : ceux que la page d'origine reçoit déjà (kit.spots()), aucune requête de plus au serveur.
 * opt.side() → 'A' | 'B' | null : carte d'un VFO donné (TRX à deux récepteurs : VFO-A à gauche, VFO-B à droite) ; null = le VFO sélectionné.
 * opt.label() → texte à côté de la bande (ex. « VFO-B »).
 */
(function () {
  'use strict';
  // Plages (kHz) : CW et phonie de chaque bande
  const SEG = {
    CW: { '160m': [1810, 1850], '80m': [3500, 3600], '60m': [5351, 5354], '40m': [7000, 7040], '30m': [10100, 10140], '20m': [14000, 14070], '17m': [18068, 18095],
      '15m': [21000, 21070], '12m': [24890, 24915], '10m': [28000, 28070], '6m': [50000, 50100] },
    SSB: { '160m': [1840, 2000], '80m': [3600, 3800], '60m': [5351, 5366], '40m': [7050, 7200], '20m': [14100, 14350], '17m': [18111, 18168], '15m': [21150, 21450],
      '12m': [24930, 24990], '10m': [28300, 28800], '6m': [50100, 50500] }
  };
  const BANDS = [[1800, 2000, '160m'], [3500, 4000, '80m'], [5300, 5500, '60m'], [7000, 7300, '40m'], [10100, 10150, '30m'], [14000, 14350, '20m'], [18068, 18168, '17m'],
    [21000, 21450, '15m'], [24890, 24990, '12m'], [28000, 29700, '10m'], [50000, 54000, '6m']];
  const bandOf = (k) => { const b = BANDS.find((x) => k >= x[0] && k <= x[1]); return b ? b[2] : ''; };
  const NOT_CW = /\b(FT[248]|RTTY|PSK|JT65|JS8|SSTV|USB|LSB|SSB|AM|FM)\b/i;
  const NOT_SSB = /\b(CW|WPM|FT[248]|RTTY|PSK|JT65|JS8|SSTV|DIGI)\b/i;

  function mount(el, opt) {
    const api = opt.api;
    el.classList.add('xbm');
    el.innerHTML = '<div class="xbm-h"><b class="xbm-band">—</b><i class="xbm-lb"></i><span class="xbm-t">Spots <small></small></span></div>' +
      '<div class="xbm-r"><button type="button" data-z="-1" title="Plage plus étroite">−</button><span class="xbm-rg"></span><button type="button" data-z="1" title="Plage plus large">+</button></div>' +
      '<div class="xbm-b"><div class="xbm-sc"></div><div class="xbm-l"></div><i class="xbm-trx"></i></div>' +
      '<div class="xbm-f"></div>';
    const body = el.querySelector('.xbm-b'), sc = el.querySelector('.xbm-sc'), lab = el.querySelector('.xbm-l'), trx = el.querySelector('.xbm-trx');
    let zoom = 0; // 0 = plage du mode ; ±n : plus étroite / plus large
    let last = '';
    el.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => { zoom = Math.max(-2, Math.min(3, zoom + Number(b.dataset.z))); last = ''; draw(); }));
    // Molette : la plage glisse (vers le haut = fréquences plus hautes)
    let shift = 0;
    body.addEventListener('wheel', (e) => { e.preventDefault(); shift += (e.deltaY < 0 ? 1 : -1); last = ''; draw(); }, { passive: false });
    body.addEventListener('dblclick', () => { shift = 0; zoom = 0; last = ''; draw(); });

    function range(k, band) {
      const seg = (SEG[opt.mode] || SEG.CW)[band];
      let lo = seg ? seg[0] : k - 25, hi = seg ? seg[1] : k + 25;
      const w0 = hi - lo;
      const w = w0 * Math.pow(1.6, zoom);
      let c = zoom < 0 || k < lo || k > hi ? k : (lo + hi) / 2;
      c += shift * w * 0.25;
      lo = c - w / 2; hi = c + w / 2;
      return [lo, hi];
    }
    function draw() {
      const st = api.state();
      const r = (st && st.radio) || {};
      const sd = opt.side ? opt.side(r) : null;
      const hz = sd === 'B' ? r.freqB : sd === 'A' ? r.freq : r.vfoSel === 1 ? r.freqB : r.freq;
      const k = hz ? hz / 1000 : 0;
      const band = bandOf(k);
      const lb = opt.label ? opt.label(r) : '';
      el.querySelector('.xbm-band').textContent = band || '—';
      el.querySelector('.xbm-lb').textContent = lb;
      let spots = [];
      try { const kt = opt.kit(); spots = kt && kt.spots ? kt.spots() : []; } catch (e) { spots = []; }
      const [lo, hi] = band ? range(k, band) : [0, 0];
      const H = body.clientHeight || 400;
      const y = (f) => Math.round(H - ((f - lo) / (hi - lo)) * H);
      const bad = opt.mode === 'SSB' ? NOT_SSB : NOT_CW;
      const list = band ? spots.filter((s) => s && s.f >= lo && s.f <= hi && !(s.cmt && bad.test(s.cmt)) && (opt.mode === 'SSB' ? !s.skim : true)) : [];
      // Un spot par indicatif (le plus récent)
      const by = new Map();
      for (const s of list) { const p = by.get(s.call); if (!p || s.at > p.at) by.set(s.call, s); }
      const pts = Array.from(by.values()).sort((a, b) => b.f - a.f);
      const sig = [band, lb, lo.toFixed(1), hi.toFixed(1), H, pts.map((s) => s.call + s.f + (opt.worked ? opt.worked(s.call, band) : '')).join(',')].join('|');
      // Trait du TRX : à chaque appel (il bouge avec le VFO)
      if (band && k >= lo && k <= hi) { trx.hidden = false; trx.style.top = y(k) + 'px'; trx.title = 'TRX : ' + k.toFixed(2) + ' kHz'; } else trx.hidden = true;
      if (sig === last) return;
      last = sig;
      el.querySelector('.xbm-rg').textContent = band ? Math.round(lo) + ' – ' + Math.round(hi) + ' kHz' : '';
      // Graduation tous les 5 / 10 / 25 / 50 kHz selon la largeur
      const span = hi - lo, stp = span <= 40 ? 5 : span <= 100 ? 10 : span <= 260 ? 25 : 50;
      let h = '';
      for (let f = Math.ceil(lo / stp) * stp; f <= hi; f += stp) h += '<span style="top:' + y(f) + 'px">' + f + '</span>';
      sc.innerHTML = h;
      // Étiquettes : du haut vers le bas, sans chevauchement (16 px)
      lab.textContent = '';
      let prevY = -99;
      const now = Date.now();
      for (const s of pts) {
        let yy = Math.max(y(s.f), prevY + 16);
        if (yy > H - 8) break;
        prevY = yy;
        const b = document.createElement('button');
        b.type = 'button';
        const w = opt.worked ? opt.worked(s.call, band) : '';
        const age = s.at ? (now - s.at) / 60000 : 0;
        b.className = 'xbm-s' + (w ? ' ' + w : '') + (age > 20 ? ' old' : '');
        b.style.top = (yy - 8) + 'px';
        b.innerHTML = '<em></em><b></b><small></small>';
        b.querySelector('b').textContent = s.call;
        b.querySelector('small').textContent = s.f.toFixed(1);
        b.title = s.call + ' · ' + s.f.toFixed(1) + ' kHz' + (s.de ? ' · spot de ' + s.de : '') + (s.cmt ? ' · ' + s.cmt : '') + (age ? ' · il y a ' + Math.round(age) + ' min' : '') + ' — clic : indicatif et TRX sur sa fréquence';
        b.querySelector('em').style.top = (y(s.f) - yy + 8) + 'px';
        b.addEventListener('click', () => opt.onPick && opt.onPick(s.call, s));
        lab.appendChild(b);
      }
      el.querySelector('.xbm-t small').textContent = pts.length ? pts.length : '';
      el.querySelector('.xbm-f').textContent = !band ? 'Bande du TRX inconnue' : pts.length ? 'Molette : parcourir · double-clic : revenir' : 'Aucun spot ' + (opt.mode === 'SSB' ? 'SSB' : 'CW') + ' sur cette plage';
    }
    draw();
    const t = setInterval(draw, 500);
    window.addEventListener('resize', () => { last = ''; draw(); });
    return { draw: () => { last = ''; draw(); }, stop: () => clearInterval(t) };
  }
  window.RSBMAP = { mount, bandOf };
})();
