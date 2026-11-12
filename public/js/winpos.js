/*
 * winpos.js — position et taille des fenêtres séparées (TRX DIGI, TRX CW, TRX SSB, carnet, DX cluster…) gardées d'une
 * fois à l'autre : chaque fenêtre « rs-… » note sa place sur l'écran (localStorage rs.win.<nom>) quand on la bouge,
 * la redimensionne ou la ferme ; à la prochaine ouverture elle revient au même endroit, à la même taille.
 * RSWINPOS.feat(nom, largeur, hauteur) → paramètres de window.open ; les fenêtres suivies se replacent aussi elles-mêmes.
 */
(function () {
  'use strict';
  const KEY = (n) => 'rs.win.' + n;
  const get = (n) => { try { const g = JSON.parse(localStorage.getItem(KEY(n)) || 'null'); return g && g.w > 200 && g.h > 150 ? g : null; } catch (e) { return null; } };
  const put = (n, g) => { try { localStorage.setItem(KEY(n), JSON.stringify(g)); } catch (e) {} };
  // Paramètres de window.open : la place gardée, sinon la taille par défaut
  function feat(name, w, h) {
    const g = get(name);
    if (!g) return 'width=' + w + ',height=' + h;
    // window.open attend la taille du contenu (sans barre de titre ni d'adresse) : la fenêtre se met ensuite à la taille exacte
    const cw = Math.max(400, g.w - 16), ch = Math.max(300, g.h - 80);
    return 'width=' + Math.round(cw) + ',height=' + Math.round(ch) + ',left=' + Math.round(g.x) + ',top=' + Math.round(g.y);
  }
  // Dans une fenêtre séparée : elle se replace (taille exacte) puis note sa place
  const me = String(window.name || '');
  // Page TRX DIGI : la fenêtre descend jusqu'en bas de l'écran (listes de messages et cartes de bande plus hautes)
  if (me === 'rs-digi' && window.opener) {
    setTimeout(() => {
      try {
        const bottom = window.screenY + window.outerHeight;
        const avail = (screen.availTop || 0) + screen.availHeight;
        if (avail - bottom > 30 && window.screenY > -9000) window.resizeBy(0, avail - bottom);
      } catch (e) { /* refusé par le navigateur */ }
    }, 600);
  }
  if (/^rs-[\w-]+$/.test(me) && window.opener) {
    let last = '';
    const save = () => {
      if (!window.outerWidth || !window.outerHeight || (document.visibilityState === 'hidden' && !save.closing)) return;
      const g = { x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight };
      if (g.x < -9000 || g.y < -9000) return; // fenêtre réduite (Windows : -32000)
      const s = [g.x, g.y, g.w, g.h].join(',');
      if (s === last) return;
      last = s;
      put(me, g);
    };
    const g0 = get(me);
    if (g0) {
      // Même place et même taille qu'à la fermeture (window.open ne donne qu'une taille approchée)
      setTimeout(() => {
        try {
          if (Math.abs(window.outerWidth - g0.w) > 4 || Math.abs(window.outerHeight - g0.h) > 4) window.resizeTo(g0.w, g0.h);
          if (Math.abs(window.screenX - g0.x) > 4 || Math.abs(window.screenY - g0.y) > 4) window.moveTo(g0.x, g0.y);
        } catch (e) {}
        last = [window.screenX, window.screenY, window.outerWidth, window.outerHeight].join(',');
      }, 150);
    }
    setTimeout(() => setInterval(save, 1500), 1500); // un déplacement de fenêtre ne donne pas d'événement : relevé régulier
    window.addEventListener('resize', () => { clearTimeout(save.t); save.t = setTimeout(save, 400); });
    window.addEventListener('pagehide', () => { save.closing = true; save(); });
    window.addEventListener('beforeunload', () => { save.closing = true; save(); });
  }
  window.RSWINPOS = { feat, get };
})();
