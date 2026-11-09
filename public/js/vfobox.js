/*
 * vfobox.js — les deux VFO côte à côte (pages TRX CW et TRX SSB) pour le trafic en SPLIT : réception sur un VFO,
 * émission sur l'autre. RSVFOBOX.mount(el, { api, toast }) ; api = { send, state, iControl }.
 * Commandes : { t: 'set', freq | freqB } et { t: 'set', ctl: 'split' | 'swap' | 'aToB' | 'vfoSel' } (celles du dashboard,
 * mêmes sécurités côté serveur : la main, pas pendant l'émission, FTX-1 sans VS1…). Le dashboard affiche le même SPLIT.
 */
(function () {
  'use strict';
  const fmt = (hz) => { if (!hz) return '—'; const s = String(Math.round(hz)).padStart(7, '0'); return s.slice(0, -6) + '.' + s.slice(-6, -3) + '.' + s.slice(-3); };
  const khz = (hz) => (hz ? (hz / 1000).toFixed(2) : '');

  function mount(el, opt) {
    const api = opt.api;
    const toast = opt.toast || (() => {});
    el.classList.add('vfb');
    el.innerHTML =
      '<div class="vfb-col" data-v="0"><div class="vfb-h"><b>VFO A</b><span class="vfb-role"></span></div><div class="vfb-f"></div><div class="vfb-m"></div>' +
        '<label class="vfb-in">kHz <input inputmode="decimal" maxlength="12" spellcheck="false" title="Nouvelle fréquence du VFO A en kHz (Entrée)"></label></div>' +
      '<div class="vfb-mid">' +
        '<button type="button" class="vfb-split" title="SPLIT : réception sur un VFO, émission sur l’autre (le dashboard l’affiche aussi)">SPLIT</button>' +
        '<div class="vfb-row"><button type="button" data-a="swap" title="Échange les fréquences des VFO A et B">A ⇄ B</button><button type="button" data-a="aToB" title="Copie le VFO A dans le VFO B">A → B</button></div>' +
        '<div class="vfb-row vfb-off" title="VFO B = VFO A + écart (SPLIT activé), pour écouter / émettre à côté">' +
          '<button type="button" data-o="-1">−1</button><button type="button" data-o="1">+1</button><button type="button" data-o="2">+2</button><button type="button" data-o="5">+5</button><button type="button" data-o="10">+10</button></div>' +
        '<p class="vfb-note"></p>' +
      '</div>' +
      '<div class="vfb-col" data-v="1"><div class="vfb-h"><b>VFO B</b><span class="vfb-role"></span></div><div class="vfb-f"></div><div class="vfb-m"></div>' +
        '<label class="vfb-in">kHz <input inputmode="decimal" maxlength="12" spellcheck="false" title="Nouvelle fréquence du VFO B en kHz (Entrée)"></label></div>';
    const cols = el.querySelectorAll('.vfb-col');
    const need = () => {
      if (!api.iControl()) { toast('Prenez d’abord la main.', 'warn'); return false; }
      const st = api.state();
      if (st && ((st.ptt && st.ptt.active) || (st.radio && st.radio.tx))) { toast('Pas pendant l’émission.', 'warn'); return false; }
      return true;
    };
    const ctl = (id, value) => api.send({ t: 'set', ctl: id, value: value == null ? 1 : value });
    cols.forEach((c, v) => {
      const inp = c.querySelector('input');
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const k = parseFloat(String(inp.value).replace(',', '.'));
        if (!(k > 100)) return toast('Fréquence en kHz, par exemple 14025.5', 'warn');
        if (!need()) return;
        api.send(v ? { t: 'set', freqB: Math.round(k * 1000) } : { t: 'set', freq: Math.round(k * 1000) });
        inp.value = '';
        inp.blur();
      });
    });
    el.querySelector('.vfb-split').addEventListener('click', () => {
      if (!need()) return;
      const r = (api.state() || {}).radio || {};
      ctl('split', r.split ? 0 : 1);
    });
    el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { if (need()) ctl(b.dataset.a); }));
    el.querySelectorAll('[data-o]').forEach((b) => b.addEventListener('click', () => {
      if (!need()) return;
      const r = (api.state() || {}).radio || {};
      if (!r.freq) return;
      api.send({ t: 'set', freqB: Math.round(r.freq + Number(b.dataset.o) * 1000) });
      if (!r.split) setTimeout(() => ctl('split', 1), 250);
    }));

    function draw() {
      const st = api.state();
      const r = (st && st.radio) || {};
      const two = r.freqB != null && r.freqB > 0;
      el.hidden = !two;
      if (!two) return;
      const rxv = r.vfoSel === 1 ? 1 : 0;
      const split = !!r.split;
      const txv = r.txVfo === 0 || r.txVfo === 1 ? r.txVfo : (split ? 1 - rxv : rxv);
      const onAir = !!((st.ptt && st.ptt.active) || r.tx);
      // Sans SPLIT : seulement le VFO actif (celui de réception et d'émission)
      el.classList.toggle('single', !split);
      cols.forEach((c, v) => {
        const isRx = v === rxv, isTx = v === txv;
        c.hidden = !split && v !== rxv;
        c.style.order = !split ? '0' : '';
        c.classList.toggle('rx', isRx);
        c.classList.toggle('tx', isTx);
        c.classList.toggle('air', isTx && onAir);
        c.querySelector('.vfb-role').textContent = isRx && isTx ? 'RX · TX' : isRx ? 'RX' : isTx ? 'TX' : '—';
        c.querySelector('.vfb-f').textContent = fmt(v ? r.freqB : r.freq);
        c.querySelector('.vfb-m').textContent = (v ? r.modeB : r.mode) || '';
        const inp = c.querySelector('input');
        if (document.activeElement !== inp) inp.placeholder = khz(v ? r.freqB : r.freq);
      });
      const sb = el.querySelector('.vfb-split');
      sb.classList.toggle('on', split);
      sb.textContent = split ? 'SPLIT ON' : 'SPLIT OFF';
      const d = (r.freqB && r.freq) ? (r.freqB - r.freq) / 1000 : 0;
      el.querySelector('.vfb-note').textContent = split ? 'Réception ' + (rxv ? 'B' : 'A') + ', émission ' + (txv ? 'B' : 'A') + (d ? ' (écart ' + (d > 0 ? '+' : '') + d.toFixed(2).replace('.', ',') + ' kHz)' : '') : 'Réception et émission sur le VFO ' + (rxv ? 'B' : 'A');
      const me = api.iControl();
      el.querySelectorAll('button, input').forEach((x) => { x.disabled = !me; });
    }
    draw();
    const timer = setInterval(draw, 250);
    return { draw, stop: () => clearInterval(timer) };
  }
  window.RSVFOBOX = { mount };
})();
