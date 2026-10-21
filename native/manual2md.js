#!/usr/bin/env node
'use strict';
/*
 * manual2md.js — produit MANUEL.md et USER-MANUAL.md (lisibles sur GitHub) à partir des pages du manuel
 * public/aide.html et public/help.html, qui restent la seule source à tenir à jour.
 *   node native/manual2md.js
 * Convertit le sous-ensemble HTML utilisé par le manuel : titres, paragraphes, listes, tableaux, encadrés,
 * touches (<kbd>), libellés d'écran (<span class="k">), code, gras, liens.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
function inline(h) {
  return ent(h
    .replace(/<kbd>(.*?)<\/kbd>/g, '`$1`')
    .replace(/<span class="k">(.*?)<\/span>/g, '`$1`')
    .replace(/<span class="later">(.*?)<\/span>/g, ' *($1)*')
    .replace(/<code>(.*?)<\/code>/g, (m, c) => '`' + c + '`')
    .replace(/<(b|strong)>(.*?)<\/\1>/g, '**$2**')
    .replace(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/g, (m, href, t) => '[' + t + '](' + (href.startsWith('/') ? 'https://remote.op0p.be' + href : href) + ')')
    .replace(/<sup>(.*?)<\/sup>/g, '$1')
    .replace(/<span[^>]*>(.*?)<\/span>/g, '$1')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim());
}
function list(html, ordered, indent) {
  const out = [];
  let n = 0;
  // Éléments de premier niveau (les sous-listes sont traitées récursivement)
  const items = [];
  let depth = 0;
  let start = -1;
  const re = /<(\/?)(li|ul|ol)\b[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[2] === 'li' && !m[1] && depth === 0) start = re.lastIndex;
    if (m[2] === 'li' && m[1] && depth === 0) items.push(html.slice(start, m.index));
    if (m[2] !== 'li') depth += m[1] ? -1 : 1;
  }
  for (const it of items) {
    const sub = /<(ul|ol)\b[^>]*>([\s\S]*)<\/\1>/.exec(it);
    const text = inline(sub ? it.slice(0, sub.index) : it);
    out.push(indent + (ordered ? ++n + '. ' : '- ') + text);
    if (sub) out.push(list(sub[2], sub[1] === 'ol', indent + '   '));
  }
  return out.join('\n');
}
function table(html) {
  const rows = [];
  for (const tr of html.match(/<tr>[\s\S]*?<\/tr>/g) || []) {
    rows.push((tr.match(/<t[hd]>[\s\S]*?<\/t[hd]>/g) || []).map((c) => inline(c.replace(/^<t[hd]>|<\/t[hd]>$/g, '')).replace(/\|/g, '\\|')));
  }
  if (!rows.length) return '';
  const out = ['| ' + rows[0].join(' | ') + ' |', '|' + rows[0].map(() => '---').join('|') + '|'];
  for (const r of rows.slice(1)) out.push('| ' + r.join(' | ') + ' |');
  return out.join('\n');
}
function convert(src, title, other) {
  const html = fs.readFileSync(path.join(ROOT, 'public', src), 'utf8');
  const body = html.slice(html.indexOf('</nav>', html.indexOf('class="toc"')) + 6, html.indexOf('<footer>'));
  const out = ['<!-- Fichier produit par native/manual2md.js à partir de public/' + src + ' : modifier la page HTML, puis relancer le script. -->', '', '# ' + title, '', other, ''];
  // Sommaire
  const toc = /<nav class="toc"[^>]*>([\s\S]*?)<\/nav>/.exec(html)[1];
  for (const a of toc.match(/<a href="#([^"]+)">(.*?)<\/a>/g)) {
    const m = /href="#([^"]+)">(.*?)</.exec(a);
    out.push((/^\d+\.\d/.test(m[2]) ? '   - ' : '- ') + '[' + ent(m[2]) + '](#' + m[1] + ')');
  }
  out.push('');
  const re = /<(h2|h3|p|ul|ol|table|div)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(body))) {
    const [, tag, attrs, inner] = m;
    const id = /id="([^"]+)"/.exec(attrs);
    if (tag === 'h2' || tag === 'h3') {
      out.push((id ? '<a id="' + id[1] + '"></a>\n' : '') + (tag === 'h2' ? '## ' : '### ') + inline(inner), '');
    } else if (tag === 'p') out.push(inline(inner), '');
    else if (tag === 'ul' || tag === 'ol') out.push(list(inner, tag === 'ol', ''), '');
    else if (tag === 'table') out.push(table(inner), '');
    else if (tag === 'div') {
      // Encadré : texte puis éventuelle liste (la fin de </div> peut être après la liste)
      let whole = inner;
      if (/<ul>/.test(inner) && !/<\/ul>/.test(inner)) {
        const end = body.indexOf('</div>', re.lastIndex);
        whole = inner + '</div>' + body.slice(re.lastIndex, end);
        re.lastIndex = end + 6;
      }
      const kind = /warn/.test(attrs) ? '[!WARNING]' : /tip/.test(attrs) ? '[!TIP]' : '[!NOTE]';
      const lines = [kind];
      const ul = /<ul>([\s\S]*?)<\/ul>/.exec(whole);
      lines.push(inline(ul ? whole.slice(0, ul.index) : whole));
      if (ul) lines.push(list(ul[1], false, ''));
      out.push(lines.join('\n').split('\n').map((l) => '> ' + l).join('\n'), '');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

fs.writeFileSync(path.join(ROOT, 'MANUEL.md'), convert('aide.html', 'Remote Station UBA-LGE — manuel d’utilisation', '*Version en ligne : bouton **HELP** du dashboard ou https://remote.op0p.be/aide — [English version](USER-MANUAL.md)*'));
fs.writeFileSync(path.join(ROOT, 'USER-MANUAL.md'), convert('help.html', 'Remote Station UBA-LGE — user manual', '*Online version: **HELP** button on the dashboard or https://remote.op0p.be/help — [version française](MANUEL.md)*'));
console.log('MANUEL.md et USER-MANUAL.md mis à jour.');
