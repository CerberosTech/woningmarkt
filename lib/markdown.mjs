// Guide pipeline (after the isde-checker builder): content/gidsen/*.md with front matter.
// Markdown subset: headings, paragraphs, **bold**, *italic*, [links](url), `code`, - / 1. lists, > quotes, code blocks, ---.
// No tables. All text is escaped; raw HTML is shown as text. "#" and "##" both become <h2> (the page title is the <h1>).
// Bare-slug links ("kosten-koper") point to another guide in the same language.
// Data tokens: {{name}} is replaced with a value from the build context, so guides never hard-code a figure
// that lives in data/*.json. An unknown token stops the build.
import fs from 'node:fs'; import path from 'node:path';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const slug = s => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
export const squash = s => String(s).replace(/[^\S ]+/g, ' ').trim();

const SAFE_URL = /^(https?:|mailto:|tel:|[^:]*$)/i;
const GUIDE_LINK = /^(?:\.{1,2}\/)*([\w-]+)\/?$/;

function inline(s, store, href) {
  const keep = html => `\u0000${store.push(html) - 1}\u0000`;
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, t, c) => keep(`<code>${esc(c.replace(/^ (.*) $/, '$1'))}</code>`))
    .replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, (_, c) => keep(esc(c)))
    .replace(/\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"([^"]*)")?\s*\)/g, (m, text, url, title) => !SAFE_URL.test(url) ? keep(esc(m))
      : keep(`<a href="${esc(href(url))}"${title ? ` title="${esc(title)}"` : ''}${/^https?:/i.test(url) ? ' rel="noopener"' : ''}>${inline(text, store, href)}</a>`))
    .replace(/<(https?:\/\/[^\s<>]+)>/g, (_, url) => keep(`<a href="${esc(url)}" rel="noopener">${esc(url)}</a>`))
    .replace(/(^|[\s(])(https?:\/\/[^\s<>]*[^\s<>.,;:!?)'"\]*_])/g, (_, pre, url) => pre + keep(`<a href="${esc(url)}" rel="noopener">${esc(url)}</a>`));
  return esc(s)
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*|(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, (_, a, pre, b) => a != null ? `<strong>${a}</strong>` : `${pre}<strong>${b}</strong>`)
    .replace(/\*(?=\S)([\s\S]*?\S)\*|(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, (_, a, pre, b) => a != null ? `<em>${a}</em>` : `${pre}<em>${b}</em>`)
    .replace(/(?: {2,}|\\)\n/g, '<br>\n');
}

/**
 * @param {string} src markdown
 * @param {object} o   { guideBase: '/woningmarkt/gidsen/', base: '/woningmarkt', reservedIds: [] }
 */
export function markdown(src, { guideBase, base, reservedIds = ['main'] }) {
  const href = u => GUIDE_LINK.test(u) ? `${guideBase}${slug(u.match(GUIDE_LINK)[1])}/`
    : /^\/(?!\/)/.test(u) && u !== base && !u.startsWith(base + '/') ? base + u : u;
  const store = [], ids = new Set(reservedIds);
  const il = s => inline(s, store, href);
  const LIST = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)/, FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/, HR = /^ {0,3}([-*_])( *\1){2,} *$/;
  const HEAD = /^ {0,3}(#{1,6})(?: +(.*?))?(?: +#+)? *$/, QUOTE = /^ {0,3}> ?/;
  const starts = l => HEAD.test(l) || HR.test(l) || FENCE.test(l) || QUOTE.test(l) || LIST.test(l);
  const blocks = (lines, tight = false) => { const out = []; let i = 0;
    while (i < lines.length) { const l = lines[i]; let m;
      if (!l.trim()) { i++; continue; }
      if ((m = l.match(FENCE))) { const end = new RegExp(`^ {0,3}${m[1][0]}{${m[1].length},} *$`), code = []; i++;
        while (i < lines.length && !end.test(lines[i])) code.push(lines[i++]); i++;
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); continue; }
      if (/^ {4}/.test(l)) { const code = [];
        while (i < lines.length && (/^ {4}/.test(lines[i]) || !lines[i].trim())) code.push(lines[i++].slice(4));
        while (code.length && !code.at(-1).trim()) code.pop();
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); continue; }
      if ((m = l.match(HEAD))) { const n = Math.max(2, m[1].length), text = m[2] || '';
        const b = slug(text.replace(/\]\([^)]*\)|[*_`\[\]]/g, '')); let id = b, k = 1; while (ids.has(id)) id = `${b}-${++k}`; ids.add(id);
        out.push(`<h${n} id="${id}">${il(text)}</h${n}>`); i++; continue; }
      if (HR.test(l)) { out.push('<hr>'); i++; continue; }
      if (QUOTE.test(l)) { const q = [];
        while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || !starts(lines[i]))) q.push(lines[i++].replace(QUOTE, ''));
        out.push(`<blockquote>${blocks(q)}</blockquote>`); continue; }
      if ((m = l.match(LIST))) { const ordered = /\d/.test(m[2]), items = []; let loose = false;
        while (i < lines.length) { const lm = lines[i].match(LIST);
          if (!lm || /\d/.test(lm[2]) !== ordered || lm[1].length > m[1].length + 1) break;
          const w = lm[0].length, item = [lines[i].slice(lm[0].length)]; i++;
          while (i < lines.length) { const x = lines[i];
            if (!x.trim()) { const next = lines.slice(i).find(y => y.trim()); if (next == null || !/^\s/.test(next) || next.search(/\S/) < Math.min(w, 2)) break; item.push(''); i++; continue; }
            if (x.search(/\S/) >= Math.min(w, 2)) { item.push(x.slice(Math.min(w, x.search(/\S/)))); i++; continue; }
            if (starts(x)) break;
            item.push(x); i++; }
          if (item.slice(0, -1).includes('')) loose = true;
          items.push(item);
          let j = i; while (j < lines.length && !lines[j].trim()) j++;
          if (j > i && j < lines.length && LIST.test(lines[j]) && lines[j].match(LIST)[1].length <= m[1].length + 1 && /\d/.test(lines[j].match(LIST)[2]) === ordered) { loose = true; i = j; }
        }
        const n = ordered ? parseInt(m[2], 10) : 1, tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}${ordered && n !== 1 ? ` start="${n}"` : ''}>${items.map(it => `<li>${blocks(it, !loose)}</li>`).join('')}</${tag}>`); continue; }
      const para = [];
      while (i < lines.length && lines[i].trim() && !(para.length && starts(lines[i]))) para.push(lines[i++].replace(/^ +/, ''));
      const html = il(para.join('\n').replace(/ +$/, ''));
      out.push(tight ? html : `<p>${html}</p>`);
    }
    return out.join('\n'); };
  let html = blocks(String(src).replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'));
  while (html.includes('\u0000')) html = html.replace(/\u0000(\d+)\u0000/g, (_, n) => store[n]);
  return html;
}

/** Replace {{token}} with tokens[lang][token]. Throws on unknown tokens so a guide can never show an empty figure. */
export function fillTokens(text, tokens, file) {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => {
    if (!(k in tokens)) throw new Error(`gidsen: ${file}: unknown token {{${k}}}`);
    return tokens[k];
  });
}

const unquote = v => { let m = v.match(/^"((?:[^"\\]|\\.)*)"$/); if (m) return m[1].replace(/\\(["\\])/g, '$1');
  m = v.match(/^'((?:[^']|'')*)'$/); return m ? m[1].replace(/''/g, "'") : v; };
const plainText = s => squash(s.replace(/[*_`]/g, '')).replace(/ +/g, ' ').toLowerCase();

/**
 * Read guides. Front matter: title, description (required), lang (nl|en, default nl), slug (default file name),
 * twin (slug of the guide in the other language), updated (YYYY-MM-DD), author, reviewer,
 * slots (comma list of ad placeholders: verhuismatch, coolblue, overstappen, advisor).
 * Files whose name starts with "_" are skipped (notes for writers).
 */
export function readGuides(dir, warn = console.warn) {
  const list = [], seen = new Set();
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_')).sort() : [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const fm = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/), meta = {};
    for (const line of (fm ? fm[1] : '').split('\n')) { const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/); if (m) meta[m[1].toLowerCase()] = unquote(m[2]); }
    const lang = (meta.lang || 'nl').toLowerCase();
    const g = { file, lang, title: squash(meta.title || ''), description: squash(meta.description || ''), slug: slug(meta.slug || file.replace(/\.md$/, '')),
      twin: meta.twin ? slug(meta.twin) : null, author: meta.author || '', reviewer: meta.reviewer || '',
      slots: (meta.slots || '').split(',').map(s => s.trim()).filter(Boolean), body: fm ? text.slice(fm[0].length) : text };
    const h1 = g.body.match(/^\s*(?:# +(.*?)(?: +#+)? *|(\S.*?) *\n=+ *)(?:\n|$)/);
    if (h1 && plainText(h1[1] ?? h1[2]) === plainText(g.title)) g.body = g.body.slice(h1[0].length);
    if (!['nl', 'en'].includes(lang)) { warn(`gidsen: ${file} skipped (lang must be nl or en)`); continue; }
    if (!g.title || !g.description) { warn(`gidsen: ${file} skipped (title and description are required)`); continue; }
    if (seen.has(lang + g.slug)) { warn(`gidsen: ${file} skipped (slug "${g.slug}" is already used)`); continue; }
    if (meta.updated) { const d = new Date(`${meta.updated}T00:00:00Z`);
      if (/^\d{4}-\d{2}-\d{2}$/.test(meta.updated) && !isNaN(d) && d.toISOString().slice(0, 10) === meta.updated) g.updated = meta.updated;
      else warn(`gidsen: ${file}: updated "${meta.updated}" ignored (use YYYY-MM-DD)`); }
    if (/\|.*\|/.test(g.body.split('\n').filter(l => /^\s*\|/.test(l)).join('\n'))) warn(`gidsen: ${file}: tables are not supported; they show as text`);
    seen.add(lang + g.slug); list.push(g);
  }
  for (const g of list) if (g.twin && !list.some(x => x.lang !== g.lang && x.slug === g.twin)) { warn(`gidsen: ${g.file}: twin "${g.twin}" not found`); g.twin = null; }
  return list.sort((a, b) => (b.updated || '').localeCompare(a.updated || '') || a.title.localeCompare(b.title, a.lang));
}
