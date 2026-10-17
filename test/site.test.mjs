// Builds the site into a temp folder and checks SEO and honesty rules on every page.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';

const SITE = 'https://cerberostech.github.io/woningmarkt/';
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-site-'));
const pages = new Map(); // url -> html
const housing = JSON.parse(fs.readFileSync(new URL('../data/housing.json', import.meta.url)));

before(() => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, OUT: out }, stdio: 'pipe' });
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.html')) pages.set(SITE + path.relative(out, p).replace(/index\.html$/, ''), fs.readFileSync(p, 'utf8')); } };
  walk(out);
});
const indexable = () => [...pages].filter(([u, h]) => !/name="robots" content="noindex"/.test(h));
const attr = (h, re) => [...h.matchAll(re)].map(m => m[1]);

test('every indexable page has a self canonical and reciprocal hreflang with x-default', () => {
  for (const [u, h] of indexable()) {
    assert.equal(attr(h, /<link rel="canonical" href="([^"]+)"/g)[0], u, `canonical of ${u}`);
    const alt = Object.fromEntries([...h.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map(m => [m[1], m[2]]));
    if (!Object.keys(alt).length) continue; // single-language guide
    assert.ok(alt.nl && alt.en && alt['x-default'], `hreflang set on ${u}`);
    assert.equal(alt['x-default'], alt.nl);
    assert.ok([alt.nl, alt.en].includes(u), `${u} lists itself`);
    const twin = pages.get(u === alt.nl ? alt.en : alt.nl);
    assert.ok(twin, `twin page exists for ${u}`);
    assert.ok(twin.includes(`hreflang="${u === alt.nl ? 'nl' : 'en'}" href="${u}"`), `twin of ${u} links back`);
  }
});

test('sitemap lists exactly the indexable pages, with alternates', () => {
  const sm = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
  const locs = attr(sm, /<loc>([^<]+)<\/loc>/g);
  assert.deepEqual([...locs].sort(), indexable().map(([u]) => u).sort());
  assert.ok(sm.includes('xmlns:xhtml') && sm.includes('hreflang="x-default"'));
  assert.ok(fs.readFileSync(path.join(out, 'robots.txt'), 'utf8').includes(`Sitemap: ${SITE}sitemap.xml`));
  assert.equal(fs.readFileSync(path.join(out, '7050a14134a33070f25080bb4f9f5edd.txt'), 'utf8').trim(), '7050a14134a33070f25080bb4f9f5edd');
});

test('internal links and assets resolve', () => {
  const missing = new Set();
  for (const [u, h] of pages) for (const href of attr(h, /(?:href|src)="(\/woningmarkt\/[^"#?]*)/g)) {
    const rel = href.slice('/woningmarkt/'.length); const f = path.join(out, rel, rel === '' || rel.endsWith('/') ? 'index.html' : '');
    if (!fs.existsSync(f)) missing.add(`${href} (on ${u})`);
  }
  assert.deepEqual([...missing], []);
});

test('titles, descriptions, JSON-LD, footer disclaimer and sources on every page', () => {
  const titles = new Set();
  for (const [u, h] of indexable()) {
    const title = attr(h, /<title>([^<]*)<\/title>/g)[0], desc = attr(h, /<meta name="description" content="([^"]*)"/g)[0];
    assert.ok(title && title.length <= 60 + 20, `title length on ${u}`); // entities may lengthen the raw string
    assert.ok(!titles.has(title), `duplicate title ${title}`); titles.add(title);
    assert.ok(desc && desc.length >= 50, `description on ${u}`);
    for (const j of attr(h, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(j);
    assert.match(h, /Geen financieel advies\.|Not financial advice\./, `disclaimer on ${u}`);
    assert.match(h, /og:image/, `og on ${u}`);
    assert.match(h, /class="lang"/, `language switcher on ${u}`);
  }
});

test('data pages cite CBS with date and carry Dataset schema; calculators carry WebApplication', () => {
  for (const [u, h] of indexable()) {
    if (/\/(huizenprijzen|house-prices|kaart|map)\//.test(u) || /\/(vergelijk|compare)\/[^/]+-vs-/.test(u)) {
      assert.match(h, /Bron: CBS \(tabel|Source: CBS \(table/, `CBS source on ${u}`);
      assert.match(h, /"@type":"Dataset"/, `Dataset on ${u}`);
      assert.match(h, /"@type":"BreadcrumbList"/, `BreadcrumbList on ${u}`);
      assert.match(h, /Laatste officiële CBS-cijfers \(bijgewerkt|Latest official CBS figures \(updated/, `stamp on ${u}`);
    }
    if (/(maximale-hypotheek-berekenen|mortgage-calculator|kosten-koper-berekenen|buying-costs-calculator)\/$/.test(u)) assert.match(h, /"@type":"WebApplication"/, u);
  }
});

test('never claims live or real-time data', () => {
  for (const [u, h] of pages) {
    const text = h.replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(text, /real[- ]?time|realtime|\blive (data|cijfers|prices|figures|rates|rente|prijzen)|\bactuele (cijfers|prijzen|rente)/i, u);
  }
});

test('ad slots are labelled placeholders with no outbound link; none on rate pages', () => {
  for (const [u, h] of pages) {
    for (const ad of attr(h, /<aside class="ad"[^>]*>([\s\S]*?)<\/aside>/g)) {
      assert.match(ad, /nog niet actief|not active yet/);
      for (const href of attr(ad, /href="([^"]+)"/g)) assert.match(href, /\/disclosure\/$/, `only the disclosure link in an ad slot on ${u}`);
    }
    if (/\/(hypotheekrente|mortgage-rates)\//.test(u)) assert.doesNotMatch(h, /class="ad"/, `no ad on ${u}`);
  }
});

test('rooms and parking are never shown as data; floor area is never an exact average', () => {
  for (const [u, h] of pages) if (/\/(huizenprijzen|house-prices)\/[^/]+\/$/.test(u)) {
    assert.match(h, /Aantal kamers|Number of rooms/);
    assert.match(h, /geen maat voor parkeren|not a parking measure/);
    assert.doesNotMatch(h, /gemiddeld\w* \d+ m²|average of \d+ m²/i);
  }
});

test('city page figures match data/housing.json', () => {
  const nl = pages.get(SITE + 'huizenprijzen/amsterdam/');
  const years = Object.keys(housing.prices.GM0363).sort(); const y = years.at(-1);
  const fmt = n => '€ ' + n.toLocaleString('nl-NL');
  assert.ok(nl.includes(fmt(housing.prices.GM0363[y])), 'Amsterdam latest price');
  assert.ok(nl.includes(fmt(housing.kern.GM0363.wozAvgK * 1000)), 'Amsterdam WOZ');
  const en = pages.get(SITE + 'en/house-prices/den-haag/');
  assert.ok(en.includes('€' + housing.prices.GM0518[y].toLocaleString('en-GB')), 'The Hague latest price (EN)');
});

const GOATCOUNTER = '<script data-goatcounter="https://woningmarkt.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>';
const CLICK_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

test('GoatCounter script is on every page, once, just before </body>', () => {
  assert.ok(pages.has(SITE + '404.html'), '404 page built');
  for (const [u, h] of pages) {
    assert.equal(h.split(GOATCOUNTER).length - 1, 1, `one GoatCounter script on ${u}`);
    assert.ok(h.endsWith(`${GOATCOUNTER}</body></html>`), `GoatCounter script before </body> on ${u}`);
  }
});

test('every ad slot, CTA and language switch has a data-goatcounter-click name', () => {
  let ads = 0;
  for (const [u, h] of pages) {
    for (const tag of attr(h, /(<aside class="ad"[^>]*>)/g)) {
      const name = attr(tag, /data-goatcounter-click="([^"]+)"/g)[0]; ads++;
      assert.ok(name, `ad slot without click name on ${u}`);
      assert.match(name, /^(aff|lead)-/, `ad slot name ${name} on ${u}`);
    }
    for (const tag of attr(h, /(<a class="lang"[^>]*>)/g)) assert.match(tag, /data-goatcounter-click="nav-lang-(nl|en)(-footer)?"/, `language switch on ${u}`);
    const main = h.slice(h.indexOf('<main'), h.indexOf('</main>')).replace(/<nav class="crumbs"[\s\S]*?<\/nav>/, ''); // breadcrumbs are navigation, not CTAs
    for (const tag of attr(main, /(<a [^>]*href="\/woningmarkt\/(?:kaart|en\/map|vergelijk|en\/compare|maximale-hypotheek-berekenen|en\/mortgage-calculator|kosten-koper-berekenen|en\/buying-costs-calculator)\/[^"]*"[^>]*>)/g))
      assert.match(tag, /data-goatcounter-click="cta-/, `CTA without click name on ${u}: ${tag}`);
    for (const name of attr(h, /data-goatcounter-click="([^"]*)"/g)) assert.match(name, CLICK_NAME, `click name ${name} on ${u}`);
  }
  assert.ok(ads > 0, 'ad slots found');
  assert.match(pages.get(SITE + 'vergelijk/'), /<button type="submit"[^>]*data-goatcounter-click="cta-compare-submit"/);
  assert.match(pages.get(SITE), /data-goatcounter-click="cta-calc-mortgage-home-hero"/);
  assert.match(pages.get(SITE + 'huizenprijzen/amsterdam/'), /data-goatcounter-click="lead-advisor-city-amsterdam"/);
});

test('privacy pages name GoatCounter and link its privacy policy', () => {
  for (const p of ['privacy/', 'en/privacy/']) {
    const h = pages.get(SITE + p);
    assert.match(h, /GoatCounter/, p);
    assert.match(h, /href="https:\/\/www\.goatcounter\.com\/help\/privacy"/, p);
    assert.doesNotMatch(h, /geen statistiekdiensten|no analytics services/, p);
  }
});

test('map: every municipality has a ramp colour or the hatched "geen data" fill, with a legend entry', () => {
  const geo = JSON.parse(fs.readFileSync(new URL('../data/geo-gemeente.json', import.meta.url)));
  for (const p of ['kaart/', 'en/map/', '']) {
    const h = pages.get(SITE + p);
    const gm = h.match(/<g id="gm">([\s\S]*?)<\/g>/)[1];
    const fills = [...gm.matchAll(/<path d="[^"]+" data-c="(GM\d{4})" fill="([^"]+)"/g)];
    assert.equal(fills.length, geo.features.length, `one path per municipality on /${p}`);
    for (const [, c, f] of fills) assert.match(f, /^(#[0-9a-f]{6}|url\(#hatch\))$/, `fill of ${c} on /${p}`);
    assert.equal(h.split('<pattern id="hatch"').length - 1, 1, `one hatch pattern on /${p}`);
    assert.match(h, /<li data-k="-1" class="nd">[\s\S]*?(Geen data|No data)/, `no-data legend entry on /${p}`);
  }
});
