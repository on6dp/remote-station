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
        '<div class="vfb-row vfb-dual" hidden><button type="button" class="vfb-drx" title="DUAL RX : les deux récepteurs en service (MAIN = VFO A, SUB = VFO B), comme la touche du TRX">DUAL RX</button>' +
          '<button type="button" class="vfb-st" aria-pressed="false" title="Écoute au casque en stéréo : VFO A (MAIN) dans l’oreille gauche, VFO B (SUB) dans l’oreille droite (avec DUAL RX)">🎧 STÉRÉO</button></div>' +
        '<p class="vfb-note"></p>' +
      '</div>' +
      '<div class="vfb-col" data-v="1"><div class="vfb-h"><b>VFO B</b><span class="vfb-role"></span></div><div class="vfb-f"></div><div class="vfb-m"></div>' +
        '<label class="vfb-in">kHz <input inputmode="decimal" maxlength="12" spellcheck="false" title="Nouvelle fréquence du VFO B en kHz (Entrée)"></label></div>';
    const cols = el.querySelectorAll('.vfb-col');
    // Écrans des VFO du dashboard (opt.mirror() = la fenêtre du dashboard) : recopiés tels quels (S-mètre, filtre, cadran,
    // spectre, badges), à l'échelle de cette page ; clic, clic droit et molette renvoyés à l'élément du dashboard
    const MR = { box: null, html: '', src: null };
    if (opt.mirror) {
      MR.box = document.createElement('div');
      MR.box.className = 'vfb-mir';
      el.prepend(MR.box);
      const pathOf = (t) => { const p = []; for (let n = t; n && n !== MR.row; n = n.parentNode) { if (!n.parentNode) return null; p.unshift(Array.prototype.indexOf.call(n.parentNode.childNodes, n)); } return p; };
      const srcOf = (t) => {
        const p = MR.row && MR.src && pathOf(t);
        if (!p) return null;
        let n = MR.src;
        for (const i of p) { n = n && n.childNodes[i]; }
        return n && n.nodeType === 1 ? n : n && n.parentElement;
      };
      const fwd = (ev) => {
        if (!MR.row || !MR.row.contains(ev.target)) return;
        const t = srcOf(ev.target);
        if (!t) return;
        const W = t.ownerDocument.defaultView;
        ev.preventDefault();
        if (ev.type === 'wheel') t.dispatchEvent(new W.WheelEvent('wheel', { deltaX: ev.deltaX, deltaY: ev.deltaY, deltaMode: ev.deltaMode, shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey, bubbles: true, cancelable: true }));
        else {
          if (ev.type === 'click' && t.closest('.vfo-meters')) return; // cadres agrandis : seulement dans le dashboard
          t.dispatchEvent(new W.MouseEvent(ev.type, { button: ev.button, shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey, bubbles: true, cancelable: true }));
        }
      };
      MR.box.addEventListener('wheel', fwd, { passive: false });
      MR.box.addEventListener('click', fwd);
      MR.box.addEventListener('contextmenu', fwd);
    }
    function mirror() {
      let d = null;
      try { d = opt.mirror(); } catch (e) { d = null; }
      const src = d && d.querySelector('.vfo-row[data-panel="vfo"]');
      el.classList.toggle('mir', !!src);
      if (!src) { MR.src = null; return; }
      MR.src = src;
      // Ids et références des dégradés SVG préfixés (pas de doublon avec cette page)
      const html = src.innerHTML.replace(/ id="/g, ' id="m-').replace(/url\(#/g, 'url(#m-');
      if (html !== MR.html || !MR.row) {
        MR.html = html;
        if (!MR.row) { MR.row = document.createElement('div'); MR.box.appendChild(MR.row); }
        MR.row.className = src.className;
        MR.row.innerHTML = html;
        MR.row.querySelectorAll('.detach-btn').forEach((x) => x.remove());
      }
      // Même largeur que dans le dashboard, mise à l'échelle de ce cadre
      const sw = src.getBoundingClientRect().width, bw = MR.box.clientWidth;
      if (sw > 100 && bw > 100) { MR.row.style.width = sw + 'px'; MR.row.style.zoom = String(Math.round(bw / sw * 1000) / 1000); }
    }
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
    // DUAL RX (TRX à deux récepteurs : état « dualRx ») et écoute stéréo MAIN | SUB (TRX qui envoie ses deux récepteurs : DUAL_AUDIO)
    const rig = () => { try { return (opt.rig && opt.rig()) || {}; } catch (e) { return {}; } };
    const lst = () => { try { return (opt.listen && opt.listen()) || null; } catch (e) { return null; } };
    // FTX-1 : pas de double réception avec les deux VFO en HF / 50 MHz (refusée par le TRX, même règle que le dashboard)
    const ftx1No = (r) => rig().ID === 'ftx1' && r.freq && r.freqB && r.freq < 60e6 && r.freqB < 60e6;
    const FTX1_NO = 'DUAL RX : le FTX-1 n’accepte pas la double réception avec les deux VFO en HF / 50 MHz. Mettez l’un des VFO en 144 ou 430 MHz.';
    el.querySelector('.vfb-drx').addEventListener('click', () => {
      if (!need()) return;
      const r = (api.state() || {}).radio || {};
      const on = r.dualRx === 1 ? 0 : 1;
      if (on && ftx1No(r)) return toast(FTX1_NO, 'warn', 9000);
      ctl('dualRx', on);
    });
    el.querySelector('.vfb-st').addEventListener('click', () => {
      const L = lst();
      if (!L) return toast('Écoute indisponible : le dashboard qui a ouvert cette page est fermé.', 'warn');
      const on = !L.stereo();
      L.setStereo(on);
      if (on) {
        const r = (api.state() || {}).radio || {};
        if (r.dualRx !== 1) {
          if (ftx1No(r)) toast(FTX1_NO, 'warn', 9000);
          else if (api.iControl()) { ctl('dualRx', 1); toast('Stéréo : DUAL RX en marche ; VFO A (MAIN) à gauche, VFO B (SUB) à droite.', '', 5000); }
          else toast('Stéréo : il faut DUAL RX (prenez la main pour le mettre en marche).', 'warn', 6000);
        } else toast('Stéréo : VFO A (MAIN) dans l’oreille gauche, VFO B (SUB) dans l’oreille droite.', '', 4000);
        if (!L.on() && !L.start()) toast('Cliquez sur « Écouter le TRX » dans le dashboard pour entendre le son.', 'warn', 6000);
      } else toast('Stéréo coupée : les deux récepteurs mélangés dans les deux oreilles.', '', 4000);
      draw();
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
      if (opt.mirror) mirror();
      const st = api.state();
      const r = (st && st.radio) || {};
      const two = r.freqB != null && r.freqB > 0;
      el.hidden = !two && !el.classList.contains('mir');
      if (!two) return;
      const rxv = r.vfoSel === 1 ? 1 : 0;
      const split = !!r.split;
      const txv = r.txVfo === 0 || r.txVfo === 1 ? r.txVfo : (split ? 1 - rxv : rxv);
      const onAir = !!((st.ptt && st.ptt.active) || r.tx);
      // Sans SPLIT : seulement le VFO actif (celui de réception et d'émission)
      const hasDual = !!opt.dual && r.dualRx != null;
      const dual = hasDual && r.dualRx === 1;
      const L = lst();
      const stereo = !!(dual && L && L.stereo() && rig().DUAL_AUDIO);
      // Sans SPLIT ni DUAL RX : seulement le VFO actif ; DUAL RX : les deux (MAIN = A, SUB = B)
      const both = split || dual;
      el.classList.toggle('single', !both);
      el.classList.toggle('dual', dual);
      cols.forEach((c, v) => {
        const isRx = v === rxv || dual, isTx = v === txv;
        c.hidden = !both && v !== rxv;
        c.style.order = !both ? '0' : '';
        c.classList.toggle('drx', dual);
        c.classList.toggle('ear', stereo);
        c.querySelector('b').textContent = 'VFO ' + (v ? 'B' : 'A') + (hasDual ? (v ? ' · SUB' : ' · MAIN') : '') + (stereo ? (v ? '  🎧 D' : '  🎧 G') : '');
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
      const dw = el.querySelector('.vfb-dual');
      dw.hidden = !hasDual;
      const db = el.querySelector('.vfb-drx'), sbt = el.querySelector('.vfb-st');
      db.classList.toggle('on', dual);
      db.textContent = dual ? 'DUAL RX ON' : 'DUAL RX OFF';
      sbt.hidden = !rig().DUAL_AUDIO || !L || (rig().ID === 'ftx1' && !dual);
      sbt.setAttribute('aria-pressed', String(!!(L && L.stereo())));
      sbt.classList.toggle('on', stereo);
      sbt.textContent = L && L.stereo() ? (L.on() ? '🎧 STÉRÉO A | B' : '🎧 STÉRÉO (pas d’écoute)') : '🎧 STÉRÉO';
      el.querySelector('.vfb-note').textContent = (dual ? 'DUAL RX : réception sur les deux VFO' + (stereo ? ', A à gauche, B à droite' : '') + '. ' : '') + (split ? 'Réception ' + (rxv ? 'B' : 'A') + ', émission ' + (txv ? 'B' : 'A') + (d ? ' (écart ' + (d > 0 ? '+' : '') + d.toFixed(2).replace('.', ',') + ' kHz)' : '') : (dual ? 'Émission sur le VFO ' : 'Réception et émission sur le VFO ') + (rxv ? 'B' : 'A'));
      const me = api.iControl();
      el.querySelectorAll('button, input').forEach((x) => { x.disabled = !me && x !== sbt; });
    }
    draw();
    const timer = setInterval(draw, opt.mirror ? 150 : 250);
    return { draw, stop: () => clearInterval(timer) };
  }
  window.RSVFOBOX = { mount };
})();
