/*
 * ctlchip.js — dans les pages des modes (TRX DIGI, TRX SSB, TRX CW), comme en haut du dashboard :
 * 👥 nombre de membres connectés (liste au survol, ★ = celui qui a la main), votre indicatif, et le bouton de la main
 * (Prendre la main / Libérer la main / Reprendre la main pour un administrateur / Main : indicatif quand elle est prise).
 * RSCTL.mount(el, { state(), me(), iControl(), send(m) }) ; mêmes messages que le dashboard (take, release, take force).
 */
(function () {
  'use strict';
  function mount(el, o) {
    el.classList.add('rs-ctl');
    el.innerHTML = '<span class="rs-users" title="Membres connectés">👥 <b>0</b></span><span class="rs-mecall">—</span>' +
      '<button type="button" class="btn rs-ctlb">Prendre la main</button>';
    const u = el.querySelector('.rs-users'), n = u.querySelector('b'), c = el.querySelector('.rs-mecall'), b = el.querySelector('.rs-ctlb');
    const get = (f, d) => { try { const v = f(); return v == null ? d : v; } catch (e) { return d; } };
    b.addEventListener('click', () => {
      const st = get(o.state, null);
      if (!st) return;
      const me = get(o.me, {}) || {};
      if (get(o.iControl, false)) o.send({ t: 'release' });
      else if (!st.controller) o.send({ t: 'take' });
      else if (me.admin && confirm('Reprendre la main à ' + st.controller + ' ?')) o.send({ t: 'take', force: true });
    });
    function draw() {
      const st = get(o.state, null), me = get(o.me, null) || {}, mine = get(o.iControl, false);
      const users = (st && st.users) || [];
      if (n.textContent !== String(users.length)) n.textContent = String(users.length);
      u.title = users.length ? 'Membres connectés : ' + users.map((x) => (st && x === st.controller ? x + ' ★ (a la main)' : x)).join(', ') : 'Aucun membre connecté';
      const call = me.call || '—';
      if (c.textContent !== call) c.textContent = call;
      const ctl = st && st.controller;
      const state = !st ? 'busy' : mine ? 'mine' : !ctl ? 'free' : me.admin ? 'admin' : 'busy';
      const txt = !st ? 'Hors ligne' : mine ? 'Libérer la main' : !ctl ? 'Prendre la main' : me.admin ? 'Reprendre la main' : 'Main : ' + ctl;
      if (b.textContent !== txt) b.textContent = txt;
      if (b.dataset.state !== state) b.dataset.state = state;
      b.disabled = !st || (!!ctl && !mine && !me.admin);
      b.title = mine ? 'Vous avez la main : clic pour la libérer' : !ctl ? 'Personne n’a la main : clic pour la prendre' : me.admin ? ctl + ' a la main : clic pour la reprendre (administrateur)' : ctl + ' a la main';
    }
    draw();
    const t = setInterval(draw, 400);
    return { draw, stop: () => clearInterval(t) };
  }
  window.RSCTL = { mount };
})();
