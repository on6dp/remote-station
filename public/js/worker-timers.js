/*
 * worker-timers.js — minuteries de la page Station confiées à un Web Worker.
 *
 * Chrome ralentit fortement les minuteries d'un onglet en arrière-plan, réduit ou d'un écran verrouillé
 * (une fois par seconde, puis une fois par minute après 5 minutes). La page Station, qui interroge le TRX
 * plusieurs fois par seconde, perdrait alors la radio (« TRX non connecté », fréquence figée).
 * Les minuteries d'un Worker ne sont pas soumises à ce ralentissement : on remplace donc
 * setTimeout / setInterval de cette page par des versions qui passent par un Worker.
 * À charger en premier dans station.html.
 */
(function () {
  'use strict';
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return;
  const src = 'const t = {};' +
    'onmessage = (e) => { const d = e.data;' +
    ' if (d.c === "set") t[d.id] = (d.r ? setInterval : setTimeout)(() => postMessage(d.id), d.ms);' +
    ' else { clearTimeout(t[d.id]); clearInterval(t[d.id]); delete t[d.id]; } };';
  let worker;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
  } catch (e) {
    return; // pas de Worker possible : on garde les minuteries normales
  }
  const nativeLog = console.error.bind(console);
  const cbs = new Map();
  let next = 1;
  worker.onmessage = (e) => {
    const c = cbs.get(e.data);
    if (!c) return;
    if (!c.repeat) cbs.delete(e.data);
    try { c.fn.apply(null, c.args); } catch (err) { nativeLog(err); }
  };
  const make = (repeat) => function (fn, ms, ...args) {
    if (typeof fn !== 'function') return 0;
    const id = next++;
    cbs.set(id, { fn, args, repeat });
    worker.postMessage({ c: 'set', id, ms: Math.max(0, Number(ms) || 0), r: repeat });
    return id;
  };
  const clear = (id) => { if (cbs.delete(id)) worker.postMessage({ c: 'clr', id }); };
  window.setTimeout = make(false);
  window.setInterval = make(true);
  window.clearTimeout = clear;
  window.clearInterval = clear;
  window.RS_WORKER_TIMERS = true;
})();
