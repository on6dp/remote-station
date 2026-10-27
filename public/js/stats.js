/* Statistiques d'utilisation (page /stats, administrateurs) : demandées au serveur avec la session du dashboard */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 86400000;
  const TZ = 'Europe/Brussels';
  let last = null;
  let allCalls = [];

  const hm = (min) => { min = Math.round(min || 0); const h = Math.floor(min / 60); return h ? h + ' h ' + String(min % 60).padStart(2, '0') : (min % 60) + ' min'; };
  const ms = (s) => { s = Math.round(s || 0); return s >= 3600 ? hm(s / 60) : s >= 60 ? Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s' : s + ' s'; };
  const fmtD = (ts, opt) => new Intl.DateTimeFormat('fr-BE', Object.assign({ timeZone: TZ }, opt)).format(new Date(ts));
  const dt = (ts) => fmtD(ts, { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + fmtD(ts, { hour: '2-digit', minute: '2-digit' });
  const iso = (d) => d.toISOString().slice(0, 10);
  const startOfDay = (s) => new Date(s + 'T00:00:00').getTime();

  function period(p) {
    const now = new Date();
    let a; let b = new Date(now);
    if (p === '7' || p === '30') a = new Date(now.getTime() - (Number(p) - 1) * DAY);
    else if (p === 'month') a = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (p === 'prev') { a = new Date(now.getFullYear(), now.getMonth() - 1, 1); b = new Date(now.getFullYear(), now.getMonth(), 0); }
    else if (p === 'year') a = new Date(now.getFullYear(), 0, 1);
    $('from').value = iso(new Date(a.getTime() - a.getTimezoneOffset() * 60000));
    $('to').value = iso(new Date(b.getTime() - b.getTimezoneOffset() * 60000));
  }

  function ask() {
    let sess = null;
    try { sess = localStorage.getItem('rs.sess'); } catch (e) { /* */ }
    if (!sess) return fail('Connectez-vous d’abord au dashboard dans ce navigateur (compte administrateur), puis rechargez cette page.');
    const from = startOfDay($('from').value);
    const to = startOfDay($('to').value) + DAY;
    if (!(from < to)) return fail('Période incorrecte.');
    $('out').innerHTML = '<p class="note">Calcul…</p>';
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => ws.send(JSON.stringify({ t: 'stats', session: sess, from, to, call: $('who').value }));
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.t === 'stats_fail') { fail(m.msg); ws.close(); }
      if (m.t === 'stats') { last = m.data; if (m.stationCall) $('sc').textContent = m.stationCall + ' Remote Station'; draw(m.data); ws.close(); }
    };
    ws.onerror = () => fail('Serveur injoignable.');
  }
  function fail(msg) { $('out').innerHTML = '<div class="msg">' + esc(msg) + '</div>'; }

  const chips = (list, unit) => '<span class="chips">' + list.slice(0, 6).map(([k, v]) => '<span>' + esc(k) + (unit ? ' · ' + unit(v) : '') + '</span>').join('') + (list.length > 6 ? '<span>+' + (list.length - 6) + '</span>' : '') + '</span>';
  function hbars(list) {
    const max = Math.max(1, ...list.map((x) => x[1]));
    const tot = list.reduce((a, x) => a + x[1], 0) || 1;
    return list.map(([k, v]) => '<div class="hb"><span>' + esc(k) + '</span><i style="width:' + (v / max * 100).toFixed(1) + '%"></i><em>' + hm(v) + ' · ' + Math.round(v / tot * 100) + ' %</em></div>').join('') || '<p class="note">Rien sur cette période.</p>';
  }
  function heat(h) {
    const max = Math.max(1, ...h.flat());
    const D = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
    let s = '<div class="heat"><div class="h"></div>';
    for (let x = 0; x < 24; x++) s += '<div class="h">' + (x % 3 ? '' : x) + '</div>';
    h.forEach((row, d) => {
      s += '<div class="l">' + D[d] + '</div>';
      for (let x = 0; x < 24; x++) {
        const v = row[x];
        const a = v ? 0.15 + 0.85 * v / max : 0;
        s += '<div title="' + D[d] + ' ' + x + ' h – ' + (x + 1) + ' h : ' + hm(v) + ' avec la main" style="' + (v ? 'background:rgba(0,212,255,' + a.toFixed(2) + ')' : '') + '"></div>';
      }
    });
    return s + '</div>';
  }
  function daysChart(days, from, to) {
    const map = new Map(days);
    const out = [];
    for (let t = from; t < to; t += DAY) { const k = fmtD(t + 12 * 3600000, { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-'); out.push([k, map.get(k) || 0]); }
    const max = Math.max(1, ...out.map((x) => x[1]));
    const bars = out.map(([k, v]) => '<i title="' + k.split('-').reverse().join('/') + ' : ' + hm(v) + '" style="height:' + (v / max * 100).toFixed(1) + '%"></i>').join('');
    return '<div class="days">' + bars + '</div><div class="days-x"><span>' + (out[0] ? out[0][0].split('-').reverse().join('/') : '') + '</span><span>' + (out.length ? out[out.length - 1][0].split('-').reverse().join('/') : '') + '</span></div>';
  }

  function draw(d) {
    const T = d.totals;
    // Liste des indicatifs pour le filtre (gardée quand on filtre sur l'un d'eux)
    if (!d.call) { allCalls = d.calls.map((c) => c.call); const sel = $('who'); const keep = sel.value; sel.innerHTML = '<option value="">Tous</option>' + allCalls.map((c) => '<option>' + esc(c) + '</option>').join(''); sel.value = keep; }
    let h = '';
    if (d.firstMinute && d.firstMinute > d.from) h += '<p class="note"><span class="est">●</span> Avant le ' + dt(d.firstMinute) + ', les durées sont <b>estimées</b> d’après le journal des prises de main (bandes et modes d’après les émissions) ; ensuite, relevé minute par minute.</p>';
    if (!d.firstMinute) h += '<p class="note"><span class="est">●</span> Pas encore de relevé minute par minute (il démarre avec cette version) : durées <b>estimées</b> d’après le journal des prises de main.</p>';
    h += '<div class="cards">' +
      '<div class="card"><b>' + hm(T.ctlMin) + '</b><span>d’utilisation (main prise)</span></div>' +
      '<div class="card"><b>' + T.operators + '</b><span>opérateurs (main prise)</span></div>' +
      '<div class="card"><b>' + T.members + '</b><span>membres vus</span></div>' +
      '<div class="card"><b>' + T.sessions + '</b><span>sessions</span></div>' +
      '<div class="card"><b>' + ms(T.txS) + '</b><span>en émission</span></div>' +
      '<div class="card"><b>' + T.qsos + '</b><span>QSO au carnet</span></div></div>';
    h += '<h2>Par indicatif</h2><div class="tw"><table><thead><tr><th>Indicatif</th><th class="r" title="Temps avec la main">Utilisation</th><th class="r" title="Temps connecté au dashboard (avec ou sans la main)">Connecté</th><th class="r">Émission</th><th class="r">Sessions</th><th class="r">Jours</th><th class="r">QSO</th><th>Bandes</th><th>Modes</th><th>Dernière fois</th></tr></thead><tbody>' +
      (d.calls.map((c) => '<tr><td class="call" data-call="' + esc(c.call) + '" title="Voir seulement ' + esc(c.call) + '">' + esc(c.call) + '</td><td class="r">' + hm(c.ctlMin) + '</td><td class="r">' + hm(c.onlineMin) + '</td><td class="r">' + ms(c.txS) + '</td><td class="r">' + c.sessions + '</td><td class="r">' + c.days + '</td><td class="r">' + c.qsos + '</td><td>' + chips(c.bands, hm) + '</td><td>' + chips(c.modes, hm) + '</td><td>' + (c.last ? dt(c.last) : '—') + '</td></tr>').join('') ||
        '<tr><td colspan="10" class="note">Personne sur cette période.</td></tr>') + '</tbody></table></div>';
    h += '<div class="grid2"><div><h2>Bandes</h2>' + hbars(d.bands) + '</div><div><h2>Modes</h2>' + hbars(d.modes) + '</div></div>';
    h += '<h2>Jours</h2>' + daysChart(d.days, d.from, d.to);
    h += '<h2>Jours de la semaine et heures (heure belge)</h2>' + heat(d.heat);
    h += '<h2>Sessions' + (d.sessions.length >= 1000 ? ' (1000 dernières)' : '') + '</h2><div class="tw"><table><thead><tr><th>Début</th><th>Fin</th><th class="r">Durée</th><th>Indicatif</th><th>Bandes</th><th>Modes</th><th class="r">Émission</th><th>TRX</th></tr></thead><tbody>' +
      (d.sessions.map((s) => '<tr><td>' + dt(s.start) + (s.src === 'journal' ? ' <span class="est" title="Estimé d’après le journal">●</span>' : '') + '</td><td>' + fmtD(s.end, { hour: '2-digit', minute: '2-digit' }) + '</td><td class="r">' + hm(s.min) + '</td><td class="call" data-call="' + esc(s.call) + '">' + esc(s.call) + '</td><td>' + esc(s.bands.join(', ')) + '</td><td>' + esc(s.modes.join(', ')) + '</td><td class="r">' + ms(s.txS) + '</td><td>' + esc(s.rig) + '</td></tr>').join('') ||
        '<tr><td colspan="8" class="note">Aucune session sur cette période.</td></tr>') + '</tbody></table></div>';
    $('out').innerHTML = h;
    $('out').querySelectorAll('[data-call]').forEach((td) => td.addEventListener('click', () => { if (allCalls.indexOf(td.dataset.call) < 0) $('who').add(new Option(td.dataset.call, td.dataset.call)); $('who').value = td.dataset.call; ask(); }));
  }

  function csv() {
    if (!last) return;
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Début', 'Fin', 'Durée (min)', 'Indicatif', 'Bandes', 'Modes', 'Émission (s)', 'TRX', 'Source'].map(q).join(';')];
    for (const s of last.sessions) rows.push([dt(s.start), dt(s.end), s.min, s.call, s.bands.join(' '), s.modes.join(' '), s.txS, s.rig, s.src === 'journal' ? 'estimé (journal)' : 'relevé'].map(q).join(';'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'remote-station-sessions-' + $('from').value + '_' + $('to').value + (last.call ? '-' + last.call : '') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  document.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('on', x === b));
    period(b.dataset.p);
    ask();
  }));
  $('go').addEventListener('click', ask);
  $('who').addEventListener('change', ask);
  $('csv').addEventListener('click', csv);
  period('30');
  ask();
})();
