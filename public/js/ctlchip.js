/*
 * ctlchip.js — dans les pages des modes (TRX DIGI, TRX SSB, TRX CW), comme en haut du dashboard :
 * 👥 nombre de membres connectés (liste au survol, ★ = celui qui a la main), votre indicatif, et le bouton de la main
 * (Prendre la main / Libérer la main / Reprendre la main pour un administrateur / Main : indicatif quand elle est prise),
 * puis DÉCONNEXION (celle du dashboard : la page se ferme).
 * RSCTL.mount(el, { state(), me(), iControl(), send(m) }) ; mêmes messages que le dashboard (take, release, take force).
 */
(function () {
  'use strict';
  function mount(el, o) {
    el.classList.add('rs-ctl');
    el.innerHTML = '<span class="rs-users" title="Membres connectés">👥 <b>0</b></span><span class="rs-mecall">—</span>' +
      '<button type="button" class="btn rs-ctlb">Prendre la main</button>' +
      '<button type="button" class="btn rs-logout" title="Se déconnecter : la main est libérée, le dashboard revient à l’écran de connexion et cette page se ferme">Déconnexion</button>';
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
    // Déconnexion depuis une page des modes : celle du dashboard (page qui a ouvert celle-ci, en remontant les fenêtres)
    el.querySelector('.rs-logout').addEventListener('click', () => {
      let w = window.opener, btn = null;
      for (let i = 0; i < 5 && w && !btn; i++) {
        try { if (w.closed) break; btn = w.document.getElementById('logout'); if (!btn) w = w.opener; } catch (e) { break; }
      }
      if (get(o.iControl, false)) o.send({ t: 'release' });
      if (btn) {
        try { btn.click(); w.focus(); } catch (e) { /* dashboard fermé entre-temps */ }
        window.close();
      } else {
        o.send({ t: 'logout' });
        alert('Dashboard introuvable : fermez cette page puis cliquez sur DÉCONNEXION dans le dashboard.');
      }
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
