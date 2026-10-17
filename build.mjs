// Woningmarkt NL static site builder. Zero npm dependencies (Node >= 20). Run: node build.mjs
// Reads data/*.json and content/gidsen/*.md, writes prebuilt HTML for NL (root) and EN (/en/) into dist/.
// Rule: every figure on the site comes from data/*.json (directly or computed from it). Missing data shows as
// "geen officiële bron" / "no official source"; nothing is estimated or filled in.
import fs from 'node:fs'; import path from 'node:path';
import { ROUTES, CITIES, CURATED_PAIRS, TERMS, cityRoute, pairRoute, termRoute, guideRoute } from './lib/routes.mjs';
import { esc, squash, markdown, readGuides, fillTokens } from './lib/markdown.mjs';
import { eur, num, pct, rulePct, eurK, dateLong, monthLong, monthShort, period, NA } from './lib/format.mjs';
import { lineChart, chartTable, spark } from './lib/charts.mjs';
import { payCurve, donut } from './src/js/viz.mjs';
import { makeProjection, pathData, centroid, interiorPoint, assignParents, adjacency, distanceKm, projBBox, polygons } from './lib/geo.mjs';
import { change, yearSeries, areaDistribution, quantileBreaks, niceBreaks, classOf, yearlyAverages } from './engine/stats.mjs';
import { maxMortgage, ENERGY_LABELS } from './engine/affordability.mjs';
import { transferTax, buyingCosts, nhgFee } from './engine/costs.mjs';
import { annuitySchedule } from './engine/payments.mjs';

const SITE = 'https://cerberostech.github.io/woningmarkt';
const BASE = '/woningmarkt';
const OUT = process.env.OUT || 'dist';
const NAME = 'Woningmarkt NL';
const THEME = '#0E1A2E';

const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const housing = read('data/housing.json');
const rates = read('data/rates.json');
const lenders = read('data/lender-rates.json');
const params = read('data/params-2026.json');
const geoGm = read('data/geo-gemeente.json');
const geoPv = read('data/geo-provincie.json');

const u = p => `${BASE}/${p}`;          // site-relative URL
const abs = p => `${SITE}/${p}`;        // absolute URL
const jsonLd = d => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`;
const jsonData = (id, d) => `<script type="application/json" id="${id}">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`;
const T = lang => (nl, en) => lang === 'nl' ? nl : en;
const clip = (s, max) => { s = squash(s); if (s.length <= max) return s; const c = s.slice(0, max - 1), at = c.lastIndexOf(' '); return (at > max / 2 ? c.slice(0, at) : c).replace(/[\s,.;:–-]+$/, '') + '…'; };
const fit = (max, ...o) => o.map(squash).find(x => x.length <= max) ?? clip(o.at(-1), max);
const day = iso => String(iso).slice(0, 10);
const time = (iso, lang) => `<time datetime="${day(iso)}">${esc(dateLong(iso, lang))}</time>`;

// ---------------------------------------------------------------- data model
const S = housing.sources;
const cbsDate = t => day(S[t].modified);
const NL = 'NL01';
const years = yearSeries(housing.prices[NL]).map(([y]) => y);
const Y = years.at(-1), YP = Y - 1, Y0 = years[0];
const regionName = Object.fromEntries(housing.regions.map(r => [r.code, r.name.replace(/ \((PV|LD|gemeente)\)$/, '')]));

const pvFeat = geoPv.features, gmFeat = geoGm.features;
const parent = assignParents(gmFeat, pvFeat);
const neighbours = adjacency(gmFeat);
const cityByCode = {};
for (const c of CITIES) {
  const f = gmFeat.find(x => x.properties.name === c.cbs);
  if (!f) throw new Error(`city ${c.slug}: no municipality named ${c.cbs} in the PDOK boundaries`);
  c.code = f.properties.code; c.nameNl = c.nl || c.cbs; c.nameEn = c.en || c.cbs; cityByCode[c.code] = c;
}
const cityName = (c, lang) => lang === 'nl' ? c.nameNl : c.nameEn;
const muniName = (code, lang) => cityByCode[code] ? (lang === 'nl' ? cityByCode[code].nameNl : cityByCode[code].nameEn) : (gmFeat.find(f => f.properties.code === code)?.properties.name ?? regionName[code] ?? code);

const areaClasses = housing.area.classes;
const shareApartments = code => { const a = housing.area.data[code]; const all = a?.all?.T001116, ap = a?.apartment?.T001116; return all && ap != null ? ap / all * 100 : null; };
// Code crosswalk. The map uses the PDOK boundaries of one year; CBS tables can lag a merger or a re-coding.
// A boundary code without figures is matched by municipality name to a CBS code that has them. Whatever stays
// unmatched is drawn with the hatched "geen data" pattern and listed in the build log; nothing is filled in.
const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s*\((pv|ld|gemeente)\)$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const codeByName = new Map(housing.regions.filter(r => /^GM/.test(r.code)).map(r => [norm(r.name), r.code]));
const ALIAS = {}, CROSSWALK = { matchedByName: [], noPrice: [], noKern: [], noArea: [] };
for (const f of gmFeat) {
  const c = f.properties.code;
  if (housing.prices[c]?.[Y] == null) {
    const alt = codeByName.get(norm(f.properties.name));
    if (alt && alt !== c && housing.prices[alt]?.[Y] != null) { ALIAS[c] = alt; CROSSWALK.matchedByName.push(`${c}→${alt} ${f.properties.name}`); }
  }
}
const src = (obj, code) => obj[code] ?? (ALIAS[code] ? obj[ALIAS[code]] : undefined);
function region(code) {
  const pr = src(housing.prices, code) || {}, k = src(housing.kern, code), ar = src(housing.area.data, code);
  return {
    code, price: pr[Y] ?? null, prev: pr[YP] ?? null, first: pr[Y0] ?? null, yoy: change(pr[YP], pr[Y]), tenY: change(pr[Y0], pr[Y]),
    series: years.map(y => [String(y), pr[y] ?? null]),
    woz: k?.wozAvgK != null ? k.wozAvgK * 1000 : null, pctMulti: k?.pctMultiFamily ?? null, pctSingle: k?.pctSingleFamily ?? null,
    pctOwner: k?.pctOwner ?? null, pctRent: k?.pctRent ?? null, inhabitants: k?.inhabitants ?? null, dwellings: k?.dwellings ?? null,
    built10: k?.pctBuiltLast10y ?? null, cars: k?.carsPerHousehold ?? null,
    area: areaDistribution(ar?.all, areaClasses),
    areaHouse: areaDistribution(ar?.house, areaClasses),
    areaApt: areaDistribution(ar?.apartment, areaClasses),
  };
}
const gm = Object.fromEntries(gmFeat.map(f => { const c = f.properties.code; return [c, { ...region(c), name: f.properties.name, pv: parent[c], centroid: centroid(f.geometry), feature: f }]; }));
const pv = Object.fromEntries(pvFeat.map(f => { const c = f.properties.code; return [c, { ...region(c), name: f.properties.name, pctMultiStock: shareApartments(c), feature: f }]; }));
const nat = region(NL);
for (const [c, g] of Object.entries(gm)) { if (g.price == null) CROSSWALK.noPrice.push(`${c} ${g.name}`); if (g.woz == null) CROSSWALK.noKern.push(`${c} ${g.name}`); if (!g.area) CROSSWALK.noArea.push(`${c} ${g.name}`); }
for (const [k, v] of Object.entries(CROSSWALK)) if (v.length) console.warn(`map codes: ${k}: ${v.join(', ')}`);

// Nearby cities and comparison pairs
for (const c of CITIES) c.near = CITIES.filter(o => o !== c).map(o => ({ c: o, km: distanceKm(gm[c.code].centroid, gm[o.code].centroid) })).sort((a, b) => a.km - b.km);
const idx = s => CITIES.findIndex(c => c.slug === s);
const pairKey = (a, b) => idx(a) < idx(b) ? [a, b] : [b, a];
const pairSet = new Map();
for (const [a, b] of CURATED_PAIRS) { const p = pairKey(a, b); pairSet.set(p.join('|'), p); }
for (const c of CITIES) for (const { c: o } of c.near.slice(0, 2)) { const p = pairKey(c.slug, o.slug); pairSet.set(p.join('|'), p); }
const PAIRS = [...pairSet.values()].sort((x, y) => idx(x[0]) - idx(y[0]) || idx(x[1]) - idx(y[1]));
const bySlug = Object.fromEntries(CITIES.map(c => [c.slug, c]));

// Rates
const series = rates.series;
const lastObs = k => [...series[k].data].reverse().find(d => d.rate != null);
const obsMonthsBack = (k, n) => { const d = series[k].data.filter(x => x.rate != null); return d[d.length - 1 - n] ?? null; };
const rateMonth = lastObs('A').month;
const ratesDate = day(rates.fetchedAt);
const SERIES_ORDER = ['F', 'I', 'O', 'P'];

// ---------------------------------------------------------------- sources and footer
function sourceLine(key, lang) {
  const t = T(lang);
  if (S[key] && key !== 'pdok') { const s = S[key];
    return t(`Bron: CBS (tabel <a href="${esc(s.url)}" rel="noopener">${esc(s.table)}</a>, “${esc(s.title)}”), ${esc(s.license)}, bijgewerkt ${time(s.modified, lang)}`,
      `Source: CBS (table <a href="${esc(s.url)}" rel="noopener">${esc(s.table)}</a>, “${esc(s.title)}”), ${esc(s.license)}, updated ${time(s.modified, lang)}`); }
  if (key === 'pdok') return t(`Kaart: <a href="${esc(S.pdok.url)}" rel="noopener">${esc(S.pdok.title)}</a>, ${esc(S.pdok.license)}`, `Map: <a href="${esc(S.pdok.url)}" rel="noopener">${esc(S.pdok.title)}</a>, ${esc(S.pdok.license)}`);
  if (key === 'ecb') return t(`Bron: ECB/DNB (<a href="${esc(rates.source.url)}" rel="noopener">MIR-rentestatistiek</a>, gemiddelde rente op nieuwe woninghypotheken in Nederland), vrij herbruikbaar met bronvermelding, opgehaald ${time(rates.fetchedAt, lang)}, laatste maand ${esc(monthLong(rateMonth, lang))}`,
    `Source: ECB/DNB (<a href="${esc(rates.source.url)}" rel="noopener">MIR interest rate statistics</a>, average rate on new Dutch home loans), free reuse with attribution, fetched ${time(rates.fetchedAt, lang)}, latest month ${esc(monthLong(rateMonth, lang))}`);
  if (key === 'lenders') return lenders.lenders.filter(l => l.source).map(l => t(`Rente ${esc(l.name)}: <a href="${esc(l.source)}" rel="noopener">eigen rentepagina</a>, gecontroleerd op ${time(l.checked, lang)}`, `${esc(l.name)} rate: <a href="${esc(l.source)}" rel="noopener">lender's own rate page</a>, checked ${time(l.checked, lang)}`)).join('</li><li>');
  if (params.sources[key]) { const s = params.sources[key]; return t(`Regels: <a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a>`, `Rules: <a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a>`); }
  throw new Error('unknown source ' + key);
}
const sourceDate = key => S[key]?.modified ? cbsDate(key) : key === 'ecb' ? ratesDate : key === 'lenders' ? lenders.lenders.map(l => l.checked).filter(Boolean).sort().at(-1) : null;
const stamp = (lang, table = '83625NED') => `<p class="stamp">${T(lang)(`Laatste officiële CBS-cijfers (bijgewerkt ${time(S[table].modified, lang)})`, `Latest official CBS figures (updated ${time(S[table].modified, lang)})`)}</p>`;
const cbsCaveat = lang => `<p class="note">${T(lang)('Het CBS waarschuwt: gemiddelde verkoopprijzen zijn geen prijsindex. Het gemiddelde verandert ook als er een andere mix van woningen wordt verkocht, bijvoorbeeld meer appartementen of grotere huizen. Voor de echte prijsontwikkeling gebruikt het CBS de prijsindex (tabel 85792NED).', 'CBS warns that average sale prices are not a price index. The average also moves when a different mix of homes is sold, for example more apartments or larger houses. For the true price trend, CBS uses its price index (table 85792NED).')}</p>`;

// ---------------------------------------------------------------- page shell
const NAV = [['map', 'Kaart', 'Map'], ['prices', 'Huizenprijzen', 'House prices'], ['compare', 'Vergelijken', 'Compare'], ['mortgage', 'Maximale hypotheek', 'Mortgage calculator'], ['costs', 'Kosten koper', 'Buying costs'], ['rates', 'Hypotheekrente', 'Mortgage rates'], ['guides', 'Gidsen', 'Guides']];
const PAGES = [];
// GoatCounter: cookieless page and click counts (see /privacy/). Goes on every page, just before </body>.
const ANALYTICS = '<script data-goatcounter="https://woningmarkt.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>';

// Stable, language-neutral key for a page, used in GoatCounter click names (e.g. cta-calc-mortgage-home).
const ROUTE_KEYS = { mortgage: 'calc-mortgage', costs: 'calc-costs', forecast: 'rates-forecast' };
const KEY_PATTERNS = [[/^(?:huizenprijzen|en\/house-prices)\/([^/]+)\/$/, 'city'], [/^(?:vergelijk|en\/compare)\/([^/]+)\/$/, 'compare'],
  [/^(?:hypotheekrente\/(\d+)-jaar-vast|en\/mortgage-rates\/(\d+)-year-fixed)\/$/, 'rates'], [/^(?:gidsen|en\/guides)\/([^/]+)\/$/, 'guide']];
function pageKey(p) {
  if (p === '404.html') return '404';
  p = p.replace(/[#?].*$/, '').replace(/^\/woningmarkt\//, '');
  const k = Object.keys(ROUTES).find(k => ROUTES[k].nl === p || ROUTES[k].en === p);
  if (k) return ROUTE_KEYS[k] || k;
  for (const [re, prefix] of KEY_PATTERNS) { const m = p.match(re); if (m) return `${prefix}-${m.slice(1).find(Boolean)}`; }
  throw new Error(`pageKey: unknown route ${p}`);
}
const routeKey = route => pageKey(route.nl ?? route.en); // twins share one key; a guide uses its NL slug when it has one
const gc = name => ` data-goatcounter-click="${name}"`;
// Tag every in-page link to a tool (map, calculators, compare) that has no click name yet. Repeats on one page get -2, -3.
const CTA_TARGETS = /^(map|compare|calc-mortgage|calc-costs)(-|$)/;
function tagCtas(html, where) {
  const used = new Map();
  return html.replace(/<a ([^>]*?)href="(\/woningmarkt\/[^"]*)"([^>]*)>/g, (all, pre, href, post) => {
    if (/data-goatcounter-click=/.test(pre + post)) return all;
    let target; try { target = pageKey(href); } catch { return all; }
    if (!CTA_TARGETS.test(target)) return all;
    const base = `cta-${target}-${where}`, n = (used.get(base) || 0) + 1; used.set(base, n);
    return `<a ${pre}href="${href}"${post}${gc(n > 1 ? `${base}-${n}` : base)}>`;
  });
}

// Wordmark: a stepped canal-house gable drawn as five bars of a bar chart. The middle bar is the brand oranje.
const MARK = `<svg class="mark" viewBox="0 0 30 28" width="30" height="28" aria-hidden="true" focusable="false"><rect x="1" y="14" width="4.6" height="13" rx="1"/><rect x="6.9" y="8.5" width="4.6" height="18.5" rx="1"/><rect class="hi" x="12.8" y="2" width="4.6" height="25" rx="1"/><rect x="18.7" y="8.5" width="4.6" height="18.5" rx="1"/><rect x="24.6" y="14" width="4.6" height="13" rx="1"/></svg>`;

function page({ lang, route, title, desc, body, sources = [], crumbs = [], schema = [], robots = '', type = 'website', head = '', scripts = '', cls = '', modified = null, sitemap = true }) {
  const t = T(lang), other = lang === 'nl' ? 'en' : 'nl', self = route[lang];
  const both = route.nl != null && route.en != null;
  const fullTitle = fit(60, `${title} | ${NAME}`, title);
  const alt = both ? ['nl', 'en'].map(l => `<link rel="alternate" hreflang="${l}" href="${abs(route[l])}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${abs(route.nl)}">` : '';
  const mod = modified || sources.map(sourceDate).filter(Boolean).sort().at(-1) || null;
  const crumbLd = crumbs.length ? [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [[t('Home', 'Home'), ROUTES.home[lang]], ...crumbs].map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(p) })) }] : [];
  const navKey = Object.entries(ROUTES).find(([, r]) => self.startsWith(r[lang]) && r[lang] !== ROUTES.home[lang])?.[0];
  const activeNav = navKey === 'forecast' ? 'rates' : navKey;
  const switcher = (pos = '') => both ? `<a class="lang" href="${u(route[other])}" hreflang="${other}" lang="${other}"${gc(`nav-lang-${other}${pos}`)}>${other === 'en' ? 'English' : 'Nederlands'}</a>` : '';
  const crumbHtml = crumbs.length ? `<nav class="crumbs" aria-label="${t('Kruimelpad', 'Breadcrumb')}"><ol><li><a href="${u(ROUTES.home[lang])}">${t('Home', 'Home')}</a></li>${crumbs.slice(0, -1).map(([n, p]) => `<li><a href="${u(p)}">${esc(n)}</a></li>`).join('')}<li aria-current="page">${esc(crumbs.at(-1)[0])}</li></ol></nav>` : '';
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="google-site-verification" content="7bn98qAl45WV4Q5VrQ-9FIYiC_JNoW4Zxqb2prfntAc" />
<meta name="msvalidate.01" content="B9A9D4CCD8BC0851FDAA9F094498CF68" />
<title>${esc(fullTitle)}</title><meta name="description" content="${esc(fit(155, desc))}">${robots ? `<meta name="robots" content="${robots}">` : `<link rel="canonical" href="${abs(self)}">`}${alt}
<meta name="theme-color" content="${THEME}"><meta name="color-scheme" content="light dark">
<link rel="preload" href="${BASE}/fonts/bricolage.woff2" as="font" type="font/woff2" crossorigin>
<link rel="icon" href="${BASE}/icon.svg" type="image/svg+xml"><link rel="icon" href="${BASE}/favicon.ico" sizes="32x32"><link rel="apple-touch-icon" href="${BASE}/apple-touch-icon.png">
<meta property="og:type" content="${type}"><meta property="og:site_name" content="${NAME}"><meta property="og:locale" content="${lang === 'nl' ? 'nl_NL' : 'en_GB'}">${both ? `<meta property="og:locale:alternate" content="${lang === 'nl' ? 'en_GB' : 'nl_NL'}">` : ''}
<meta property="og:title" content="${esc(fullTitle)}"><meta property="og:description" content="${esc(fit(155, desc))}"><meta property="og:url" content="${abs(self)}">
<meta property="og:image" content="${SITE}/og-image.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(t('Woningmarkt NL: huizenprijzen per gemeente op de kaart', 'Woningmarkt NL: Dutch house prices by municipality on a map'))}">
<meta name="twitter:card" content="summary_large_image">${mod ? `<meta property="article:modified_time" content="${mod}">` : ''}
${[...crumbLd, ...schema].map(jsonLd).join('')}${head}
<link rel="stylesheet" href="${BASE}/style.css"></head><body${cls ? ` class="${cls}"` : ''}>
<a class="skip" href="#main">${t('Naar de inhoud', 'Skip to content')}</a>
<header class="site-head"><div class="wrap head-row"><a class="brand" href="${u(ROUTES.home[lang])}" aria-label="${NAME}, ${t('naar de homepage', 'go to the homepage')}">${MARK}<span class="wm">Woningmarkt<span class="wm-nl">NL</span></span></a>
<nav class="site-nav" aria-label="${t('Hoofdmenu', 'Main menu')}"><ul>${NAV.map(([k, nl, en]) => `<li><a href="${u(ROUTES[k][lang])}"${k === activeNav ? ' aria-current="page"' : ''}>${lang === 'nl' ? nl : en}</a></li>`).join('')}</ul></nav>${switcher()}</div></header>
<main id="main" tabindex="-1">${crumbHtml ? `<div class="crumbbar"><div class="wrap">${crumbHtml}</div></div>` : ''}${tagCtas(body, routeKey(route))}</main>
<footer class="site-foot"><div class="wrap foot-grid">
<div class="foot-brand"><a class="brand" href="${u(ROUTES.home[lang])}">${MARK}<span class="wm">Woningmarkt<span class="wm-nl">NL</span></span></a>
<p class="nfa"><strong>${t('Geen financieel advies.', 'Not financial advice.')}</strong> ${t('Alle cijfers en berekeningen zijn indicatief. Deze site bemiddelt niet in hypotheken of verzekeringen.', 'All figures and calculations are indicative. This site does not arrange mortgages or insurance.')}</p>
<p>${t('Onafhankelijke site. Niet verbonden aan het CBS, DNB, de ECB of een geldverstrekker.', 'Independent site. Not affiliated with CBS, DNB, the ECB or any lender.')}</p>
<ul class="foot-nav"><li><a href="${u(ROUTES.methods[lang])}">${t('Methode en bronnen', 'Methods and sources')}</a></li><li><a href="${u(ROUTES.guides[lang])}">${t('Gidsen', 'Guides')}</a></li><li><a href="${u(ROUTES.privacy[lang])}">Privacy</a></li><li><a href="${u(ROUTES.disclosure[lang])}">${t('Disclosure', 'Disclosure')}</a></li>${both ? `<li>${switcher('-footer')}</li>` : ''}</ul></div>
${sources.length ? `<div class="foot-src"><h2 class="foot-h">${t('Bronnen op deze pagina', 'Sources on this page')}</h2><ul class="sources">${sources.map(s => `<li>${sourceLine(s, lang)}</li>`).join('')}</ul></div>` : ''}
</div></footer><script src="${BASE}/js/site.js" defer></script>${scripts}${ANALYTICS}</body></html>`;
  write(self === '404.html' ? '404.html' : `${self}index.html`, html);
  if (sitemap && !robots) PAGES.push({ route, lang, both, lastmod: mod });
}

function write(rel, content) { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); }

// ---------------------------------------------------------------- shared components
const dataset = ({ lang, route, name, description, tables, spatial = 'Nederland', temporal = `${Y0}/${Y}` }) => ({
  '@context': 'https://schema.org', '@type': 'Dataset', name, description, url: abs(route[lang]), inLanguage: lang,
  creator: { '@type': 'Organization', name: 'Centraal Bureau voor de Statistiek (CBS)', url: 'https://www.cbs.nl/' },
  license: 'https://creativecommons.org/licenses/by/4.0/', isAccessibleForFree: true,
  isBasedOn: tables.map(t => S[t]?.url).filter(Boolean), dateModified: tables.map(t => S[t] ? cbsDate(t) : null).filter(Boolean).sort().at(-1),
  spatialCoverage: { '@type': 'Place', name: spatial }, temporalCoverage: temporal,
});
const webApp = ({ lang, route, name, description }) => ({ '@context': 'https://schema.org', '@type': 'WebApplication', name, description, url: abs(route[lang]), inLanguage: lang,
  applicationCategory: 'FinanceApplication', operatingSystem: 'Any', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' } });

// Affiliate / lead placeholders. Never a live link until a programme is approved and disclosed.
const SLOTS = {
  coolblue: { click: 'aff-coolblue-energie', nl: ['Coolblue Energie', 'Energiecontract of offerte voor zonnepanelen of een laadpaal, na de verhuizing.'], en: ['Coolblue Energie', 'Energy contract or a quote for solar panels or a charger, after the move.'] },
  overstappen: { click: 'aff-overstappen', nl: ['Overstappen.nl', 'Energie en verzekeringen vergelijken voor je nieuwe adres. Geen leningen.'], en: ['Overstappen.nl', 'Compare energy and insurance for your new address. No loans.'] },
  verhuismatch: { click: 'aff-verhuismatch', nl: ['VerhuisMatch', 'Offertes van verhuisbedrijven vergelijken.'], en: ['VerhuisMatch', 'Compare quotes from removal companies.'] },
  advisor: { click: 'lead-advisor', nl: ['Hypotheekadviseur of makelaar', 'Contact via het eigen formulier van de adverteerder. Deze site verzamelt geen gegevens en geeft geen advies.'], en: ['Mortgage adviser or estate agent', "Contact through the advertiser's own form. This site collects no data and gives no advice."] },
};
const adSlot = (key, lang, route) => { const t = T(lang), [name, what] = SLOTS[key][lang];
  return `<aside class="ad"${gc(`${SLOTS[key].click}-${routeKey(route)}`)} aria-label="${t('Advertentie', 'Advertisement')}"><p class="ad-label">${t('Advertentie / placeholder – nog niet actief', 'Advertisement / placeholder – not active yet')}</p><p class="ad-name">${esc(name)}</p><p>${esc(what)}</p><p class="ad-note">${t('Wordt deze plek actief, dan kunnen wij een vergoeding krijgen als je via de link iets afneemt. Dat staat dan hier.', 'If this slot becomes active, we may receive a fee when you buy through the link. It will say so here.')} <a href="${u(ROUTES.disclosure[lang])}">${t('Lees de disclosure', 'Read the disclosure')}</a></p></aside>`; };

const notShown = (lang, { city = null } = {}) => { const t = T(lang);
  return `<section class="missing" aria-labelledby="ns-${city ? 'c' : 'g'}"><h2 id="ns-${city ? 'c' : 'g'}">${t('Wat we niet tonen, en waarom', 'What we do not show, and why')}</h2><ul>
<li><strong>${t('Aantal kamers', 'Number of rooms')}:</strong> ${t('er is geen vrije officiële bron per regio. We tonen het daarom niet.', 'there is no free official source by region, so we do not show it.')}</li>
<li><strong>${t('Parkeren', 'Parking')}:</strong> ${t('er is geen vrije officiële bron per regio. Het aantal auto’s per huishouden (CBS) staat er alleen als context. Het is geen maat voor parkeerruimte.', 'there is no free official source by region. Cars per household (CBS) appears only as context. It is not a measure of parking space.')}</li>
<li><strong>${t('Overbieden, prijs per m² en verkooptijd', 'Overbidding, price per m² and time on market')}:</strong> ${t('het CBS publiceert deze cijfers niet per gemeente als open data. Bronnen zoals de NVM of het Kadaster zijn niet vrij herbruikbaar.', 'CBS does not publish these figures by municipality as open data. Sources such as NVM or Kadaster are not free to reuse.')}</li>
<li><strong>${t('Gemiddelde woonoppervlakte', 'Average floor area')}:</strong> ${t('het CBS telt woningen per oppervlakteklasse. We tonen die verdeling en de klasse van de middelste woning, geen exact gemiddelde in m².', 'CBS counts homes by floor-area class. We show that distribution and the class of the middle home, not an exact average in m².')}</li>
<li><strong>${t('Prijs van appartementen en eengezinswoningen', 'Prices of apartments and houses')}:</strong> ${t(`deze uitsplitsing bestaat alleen voor heel Nederland (CBS 85791NED)${city ? `, niet voor ${esc(city)}` : ', niet per gemeente'}.`, `this split exists only for the Netherlands as a whole (CBS 85791NED)${city ? `, not for ${esc(city)}` : ', not by municipality'}.`)}</li>
</ul></section>`; };


// Choropleth: 7 quantile classes on a viridis ramp (colour-blind safe, ordered in lightness). It is drawn on the dark
// "night" map stage, so higher values glow brighter. Missing values get a hatched pattern with its own legend entry.
const RAMP = ['#424488', '#31688e', '#21888c', '#25a884', '#51c567', '#a6db33', '#fce721'];
const HATCH = 'url(#hatch)';
const hatchDef = `<defs><pattern id="hatch" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)"><rect width="5" height="5" fill="#1b2a44"/><rect width="1.8" height="5" fill="#5d6f92"/></pattern></defs>`;
const METRICS = {
  price: { step: 5000, unit: 'eur', nl: `Gemiddelde verkoopprijs ${Y}`, en: `Average sale price ${Y}`, short: ['Prijs', 'Price'], src: '83625NED' },
  yoy: { step: 0.5, unit: 'pctSigned', nl: `Prijsverandering ${YP}–${Y}`, en: `Price change ${YP}–${Y}`, short: ['Verandering', 'Change'], src: '83625NED' },
  woz: { step: 5000, unit: 'eur', nl: 'Gemiddelde WOZ-waarde', en: 'Average WOZ value', short: ['WOZ', 'WOZ'], src: '86165NED' },
  multi: { step: 1, unit: 'pct', nl: 'Aandeel meergezinswoningen (appartementen)', en: 'Share of multi-family homes (apartments)', short: ['Appartementen', 'Apartments'], src: '86165NED' },
};
const gmVal = (r, m) => m === 'price' ? r.price : m === 'yoy' ? r.yoy : m === 'woz' ? r.woz : r.pctMulti;
const pvVal = (r, m) => m === 'price' ? r.price : m === 'yoy' ? r.yoy : m === 'woz' ? null : r.pctMultiStock;
// Quantile breaks; for the price change a break at 0 keeps falling and rising municipalities in separate classes.
const breaksFor = (vals, m) => {
  const v = vals.filter(x => x != null);
  if (m === 'yoy' && v.some(x => x < 0)) return [0, ...niceBreaks(quantileBreaks(v.filter(x => x > 0), 6), METRICS[m].step).filter(x => x > 0)];
  return niceBreaks(quantileBreaks(v, 7), METRICS[m].step);
};
const BREAKS = {};
for (const m of Object.keys(METRICS)) BREAKS[m] = { gm: breaksFor(Object.values(gm).map(r => gmVal(r, m)), m), pv: breaksFor(Object.values(pv).map(r => pvVal(r, m)), m) };
const rampIdx = (i, breaks) => Math.round(i * (RAMP.length - 1) / Math.max(1, breaks.length));
const fillFor = (v, breaks) => { const i = classOf(v, breaks); return i < 0 ? HATCH : RAMP[rampIdx(i, breaks)]; };
const fmtMetric = (v, m, lang) => METRICS[m].unit === 'eur' ? eur(v, lang) : pct(v, lang, 1, METRICS[m].unit === 'pctSigned');
const fmtShort = (v, m, lang) => METRICS[m].unit === 'eur' ? `€${num(v / 1000, lang)}k` : pct(v, lang, Number.isInteger(v) ? 0 : 1, METRICS[m].unit === 'pctSigned');
const legend = (m, layer, lang) => { const t = T(lang), b = BREAKS[m][layer], f = v => fmtMetric(v, m, lang), vals = Object.values(layer === 'gm' ? gm : pv).map(r => (layer === 'gm' ? gmVal : pvVal)(r, m));
  const count = i => vals.filter(v => classOf(v, b) === i).length, nd = vals.filter(v => v == null).length;
  const items = b.length ? [...b.map((x, i) => [i, i === 0 ? `≤ ${f(x)}` : `${f(b[i - 1])} – ${f(x)}`, i === 0 ? `≤ ${fmtShort(x, m, lang)}` : fmtShort(x, m, lang)]), [b.length, `> ${f(b.at(-1))}`, `> ${fmtShort(b.at(-1), m, lang)}`]] : [];
  return `<p class="legend-t">${esc(METRICS[m][lang])}</p><ul class="legend-map">${items.map(([i, l, sh]) => `<li data-k="${i}"><span class="sw" style="background:${RAMP[rampIdx(i, b)]}"></span><span class="lb">${esc(l)}</span><span class="sh" aria-hidden="true">${esc(sh)}</span><span class="ct">${count(i)}</span></li>`).join('')}<li data-k="-1" class="nd"><span class="sw"></span><span class="lb">${t('Geen data', 'No data')}</span><span class="sh" aria-hidden="true">${t('geen data', 'no data')}</span><span class="ct">${nd}</span></li></ul>`; };

// Ranks (1 = highest) among all municipalities, for badges on city pages.
const rankOf = (code, m) => { const v = gmVal(gm[code], m); if (v == null) return null; return 1 + Object.values(gm).filter(r => (gmVal(r, m) ?? -Infinity) > v).length; };
const NGM = gmFeat.length;

// Projections and paths
const projNL = makeProjection(geoGm.bbox, 800);
const gmPaths = Object.fromEntries(gmFeat.map(f => [f.properties.code, pathData(f.geometry, projNL, { tol: 0.35 })]));
const pvPaths = Object.fromEntries(pvFeat.map(f => [f.properties.code, pathData(f.geometry, projNL, { tol: 0.45 })]));
const pvPathsLite = Object.fromEntries(pvFeat.map(f => [f.properties.code, pathData(f.geometry, projNL, { tol: 0.9, minArea: 4 })]));

function localMap(city, lang) {
  const code = city.code, ring = [code, ...neighbours[code]];
  let [x0, y0, x1, y1] = projBBox(gm[code].feature.geometry, projNL);
  for (const n of neighbours[code]) { const b = projBBox(gm[n].feature.geometry, projNL); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
  const pad = 4; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const scale = 420 / Math.max(x1 - x0, (y1 - y0) * 1.2);
  const W = Math.round((x1 - x0) * scale), H = Math.round((y1 - y0) * scale);
  const p = { p: pt => { const [x, y] = projNL.p(pt); return [(x - x0) * scale, (y - y0) * scale]; } };
  const shown = gmFeat.filter(f => { const b = projBBox(f.geometry, projNL); return b[2] >= x0 && b[0] <= x1 && b[3] >= y0 && b[1] <= y1; });
  const br = BREAKS.price.gm;
  const shapes = shown.map(f => { const c = f.properties.code, d = pathData(f.geometry, p, { tol: 0.4, minArea: 1 }); if (!d) return '';
    const href = cityByCode[c] && c !== code ? u(cityRoute(cityByCode[c].slug)[lang]) : `${u(ROUTES.map[lang])}#${c}`;
    return `<a href="${href}"${gc(`cta-localmap-city-${city.slug}`)}><path d="${d}" fill="${fillFor(gm[c].price, br)}"${c === code ? ' class="self"' : ''}><title>${esc(muniName(c, lang))}: ${esc(eur(gm[c].price, lang))}</title></path></a>`; }).join('');
  // Labels: the city first, then neighbours by size; a label that would overlap a placed one is left out.
  const placed = [];
  const labels = [code, ...neighbours[code].slice().sort((a, b) => (gm[b].dwellings ?? 0) - (gm[a].dwellings ?? 0))].map(c => { const [x, y] = p.p(interiorPoint(gm[c].feature.geometry)); if (x < 0 || y < 0 || x > W || y > H) return '';
    const name = muniName(c, lang).replace(/ \(Den Bosch\)$/, ''), fs = c === code ? 14 : 11, bw = name.length * fs * 0.56 + 6, box = [x - bw / 2, y - fs, x + bw / 2, y + 4];
    if (placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return '';
    placed.push(box);
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}"${c === code ? ' class="self"' : ''}>${esc(name)}</text>`; }).join('');
  return `<figure class="localmap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="lm-t"><title id="lm-t">${esc(T(lang)(`Gemiddelde verkoopprijs ${Y} in ${cityName(city, lang)} en buurgemeenten`, `Average sale price ${Y} in ${cityName(city, lang)} and neighbouring municipalities`))}</title>${hatchDef}<g class="shapes">${shapes}</g><g class="labels" aria-hidden="true">${labels}</g></svg><figcaption>${legend('price', 'gm', lang)}</figcaption></figure>`;
}

// The national map: one component for the home hero and the map page. Returns the control column and the map box.
function mapStage(lang, mode) {
  const t = T(lang), full = mode === 'full';
  const svg = `<svg id="nlmap" viewBox="0 0 ${projNL.width} ${projNL.height}" role="img" aria-labelledby="map-t map-d" tabindex="0"><title id="map-t">${esc(t(`Kaart: gemiddelde verkoopprijs per gemeente, ${Y}`, `Map: average sale price by municipality, ${Y}`))}</title><desc id="map-d">${esc(full ? t('Dezelfde cijfers staan in de tabel onder de kaart. Zoom met plus en min, verschuif met de pijltjestoetsen.', 'The same figures are in the table below the map. Zoom with plus and minus, pan with the arrow keys.') : t('Alle cijfers staan ook in de tabel op de kaartpagina. Zoom met plus en min, verschuif met de pijltjestoetsen.', 'All figures are also in the table on the map page. Zoom with plus and minus, pan with the arrow keys.'))}</desc>${hatchDef}
<g id="gm">${gmFeat.map(f => { const c = f.properties.code; return `<path d="${gmPaths[c]}" data-c="${c}" fill="${fillFor(gm[c].price, BREAKS.price.gm)}"/>`; }).join('')}</g>
<g id="pv">${pvFeat.map(f => { const c = f.properties.code; return `<path d="${pvPaths[c]}" data-c="${c}" fill="${fillFor(pv[c].price, BREAKS.price.pv)}"/>`; }).join('')}</g><g id="hl" aria-hidden="true"><path class="hov" d="M0 0"/><path class="selp" d="M0 0"/></g></svg>`;
  const metricRadios = Object.entries(METRICS).map(([k, m], i) => `<label><input type="radio" name="metric" value="${k}"${i ? '' : ' checked'}><span class="full">${esc(m[lang])}</span><span class="short" aria-hidden="true">${esc(m.short[lang === 'nl' ? 0 : 1])}</span></label>`).join('');
  const ctl = `<form class="mapctl" id="mapctl" onsubmit="return false">
<fieldset class="seg seg-metric"><legend>${t('Kaartlaag', 'Layer')}</legend><div class="track">${metricRadios}</div></fieldset>
<div class="ctl-row"><fieldset class="seg seg-level"><legend>${t('Niveau', 'Level')}</legend><div class="track"><label><input type="radio" name="level" value="gm" checked><span>${t('Gemeenten', 'Municipalities')}</span></label><label><input type="radio" name="level" value="pv"><span>${t('Provincies', 'Provinces')}</span></label></div></fieldset>
<div class="find"><label for="find">${t('Zoek een gemeente', 'Find a municipality')}</label><input id="find" type="search" list="munis" autocomplete="off" enterkeyhint="search" placeholder="${t('Bijv. Utrecht', 'E.g. Utrecht')}"><datalist id="munis">${Object.keys(gm).sort((a, b) => muniName(a, lang).localeCompare(muniName(b, lang), lang)).map(c => `<option value="${esc(muniName(c, lang))}">`).join('')}</datalist></div></div>
</form>
<div id="legend" class="maplegend">${legend('price', 'gm', lang)}</div>`;
  const map = `<div class="mapbox" id="mapbox">
<div class="drill" id="drill" hidden><button type="button" data-act="reset">${t('Nederland', 'Netherlands')}</button><span aria-hidden="true">/</span><strong id="drill-name"></strong></div>
${svg}
<div id="tip" class="tip" hidden></div>
<div class="zoom" role="group" aria-label="Zoom"><button type="button" data-z="in" aria-label="${t('Inzoomen', 'Zoom in')}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg></button><button type="button" data-z="out" aria-label="${t('Uitzoomen', 'Zoom out')}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12"/></svg></button><button type="button" data-z="reset" aria-label="${t('Heel Nederland tonen', 'Show the whole country')}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4"/></svg></button></div>
<p class="zhint" id="zhint" hidden>${t('Zoom met Ctrl + scrollen, of met de knoppen.', 'Zoom with Ctrl + scroll, or with the buttons.')}</p>
</div>
<aside id="panel" class="panel${full ? '' : ' idle'}" aria-label="${t('Gegevens van de gekozen gemeente', 'Figures for the selected municipality')}"><button class="grab" type="button" aria-expanded="false" aria-controls="panel-body"><span class="vh">${t('Paneel openen of sluiten', 'Open or close the panel')}</span></button><div class="panel-body" id="panel-body" aria-live="polite"><p class="hint">${t('Klik op een gemeente op de kaart, of zoek er een.', 'Click a municipality on the map, or search for one.')}</p></div></aside>`;
  const data = {
    lang, mode, y: Y, yp: YP, y0: Y0, ramp: RAMP, breaks: BREAKS, n: NGM,
    metrics: Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, { label: m[lang], short: m.short[lang === 'nl' ? 0 : 1], unit: m.unit }])),
    gm: Object.fromEntries(Object.entries(gm).map(([c, g]) => [c, [muniName(c, lang), g.pv, g.price, g.yoy == null ? null : +g.yoy.toFixed(2), g.woz, g.pctMulti, cityByCode[c] ? u(cityRoute(cityByCode[c].slug)[lang]) : null, g.series.map(p => p[1])]])),
    pv: Object.fromEntries(Object.entries(pv).map(([c, g]) => [c, [g.name, null, g.price, g.yoy == null ? null : +g.yoy.toFixed(2), null, g.pctMultiStock == null ? null : +g.pctMultiStock.toFixed(1), null, g.series.map(p => p[1])]])),
    nl: nat.series.map(p => p[1]), nlName: t('Nederland', 'Netherlands'),
    compare: u(ROUTES.compare[lang]), mapUrl: u(ROUTES.map[lang]),
    i18n: { province: t('Provincie', 'Province'), nodata: t('Geen data', 'No data'), cityPage: t('Bekijk', 'Open'), compare: t('Vergelijk', 'Compare'),
      multiProv: t(`Aandeel meergezinswoningen per provincie: woningvoorraad (CBS 83704NED, ${housing.area.year})`, `Share of multi-family homes by province: housing stock (CBS 83704NED, ${housing.area.year})`), wozProv: t('WOZ-waarde: geen cijfer per provincie in deze bron', 'WOZ value: no province figure in this source'),
      close: t('Sluiten', 'Close'), notFound: t('Geen gemeente gevonden met die naam.', 'No municipality found with that name.'), of: t('van', 'of'), highFirst: t('hoogste eerst', 'highest first'),
      rank: t('Plaats', 'Rank'), drill: t('Gemeenten in', 'Municipalities in'), highest: t('Hoogste', 'Highest'), lowest: t('Laagste', 'Lowest'),
      spark: t(`Gemiddelde verkoopprijs ${Y0}–${Y}, gestippeld: Nederland`, `Average sale price ${Y0}–${Y}, dotted: the Netherlands`), munis: t('gemeenten', 'municipalities'), provinces: t('provincies', 'provinces'),
      hint: t('Klik op een gemeente op de kaart, of zoek er een.', 'Click a municipality on the map, or search for one.'), pctile: t('Positie tussen alle gemeenten', 'Position among all municipalities'), country: t('Heel Nederland', 'Whole country') } };
  return { ctl, map, data: jsonData('mapdata', data) };
}

// Stat band: [label, text, countValue|null, countFormat, subHtml]. Counters animate in site.js; the text is final.
const statBand = items => `<dl class="stats">${items.map(([label, txt, count, f, sub]) => `<div class="stat"><dt>${esc(label)}</dt><dd class="stat-v">${count != null && Number.isFinite(count) ? `<span data-count="${count}" data-f="${f}">${esc(txt)}</span>` : esc(txt)}</dd>${sub ? `<dd class="stat-sub">${sub}</dd>` : ''}</div>`).join('')}</dl>`;
// Floor-area bars; ref = the national distribution, drawn as a thin marker in each row.
const areaBars = (d, lang, id, ref = null) => { if (!d) return `<p>${NA[lang]}</p>`;
  const max = Math.max(...d.classes.map(c => c.share), ...(ref ? ref.classes.map(c => c.share) : []));
  return `<ul class="bars${ref ? ' has-ref' : ''}" aria-labelledby="${id}">${d.classes.map((c, i) => `<li${c === d.median ? ' class="median"' : ''}><span class="bl">${esc(c.name)}</span><span class="bb"><i style="--w:${(c.share / max * 100).toFixed(1)}%"></i>${ref ? `<b style="--r:${(ref.classes[i].share / max * 100).toFixed(1)}%"></b>` : ''}</span><span class="bv">${pct(c.share, lang)}${ref ? `<small>${T(lang)('NL', 'NL')} ${pct(ref.classes[i].share, lang)}</small>` : ''}</span></li>`).join('')}</ul>`; };
const deltaChip = (label, v, lang, href = null) => { const txt = `<span class="chip-l">${esc(label)}</span><span class="chip-v">${pct(v, lang, 1, true)}</span>`; return `<li>${href ? `<a class="chip" href="${href}">${txt}</a>` : `<span class="chip">${txt}</span>`}</li>`; };

// ---------------------------------------------------------------- build
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync('src', OUT, { recursive: true });
fs.cpSync('engine', path.join(OUT, 'engine'), { recursive: true });
write('.nojekyll', '');

const pctStr = (v, lang) => pct(v, lang, 1, true);
const latestKW = s => s.filter(r => /KW/.test(r.period) && r.avg != null).at(-1);
const nlRecent = housing.recent[NL].filter(r => /KW/.test(r.period));
const nlLastQ = nlRecent.at(-1);
const typeSeries = key => housing.byType.find(t => t.key === key);
const TYPE_KEYS = ['ZW10290', 'ZW25805', 'ZW25806', 'ZW10300', 'ZW10320', 'ZW25810'];
const typeLatest = TYPE_KEYS.map(k => ({ k, name: typeSeries(k).name, last: latestKW(typeSeries(k).series) }));
const TYPE_EN = { ZW10290: 'Single-family homes (all)', ZW25805: 'Terraced house', ZW25806: 'End-of-terrace house', ZW10300: 'Semi-detached house', ZW10320: 'Detached house', ZW25810: 'Apartment' };
const typeName = (t, lang) => lang === 'nl' ? t.name : TYPE_EN[t.k] || t.name;
const nationalSplit = { house: latestKW(typeSeries('ZW10290').series), apt: latestKW(typeSeries('ZW25810').series) };
const annualType = key => years.map(y => [String(y), typeSeries(key).series.find(r => r.period === `${y}JJ00`)?.avg ?? null]);

for (const lang of ['nl', 'en']) {
  const t = T(lang);
  const L = k => ROUTES[k][lang];
  const cityLink = c => `<a href="${u(cityRoute(c.slug)[lang])}">${esc(cityName(c, lang))}</a>`;

  // ---------------- home
  {
    const r = ROUTES.home, A = lastObs('A'), A12 = obsMonthsBack('A', 12);
    const { ctl, map, data } = mapStage(lang, 'home');
    const nlYear = housing.recent[NL].find(x => x.period === `${Y}JJ00`), soldYears = years.map(y => housing.recent[NL].find(x => x.period === `${y}JJ00`)?.sold ?? null);
    const qIdx = nlRecent.slice(-12).map(x => x.yoy);
    const aSeries = series.A.data.filter(d => d.rate != null).slice(-36).map(d => d.rate);
    const kpis = [
      { label: t(`Gemiddelde verkoopprijs ${Y}`, `Average sale price ${Y}`), v: nat.price, f: 'eur', txt: eur(nat.price, lang), sub: t(`${eur(nat.first, lang)} in ${Y0}`, `${eur(nat.first, lang)} in ${Y0}`), sp: spark(nat.series.map(p => p[1])), src: 'CBS 83625NED' },
      { label: t(`Prijsverandering ${YP}–${Y}`, `Price change ${YP}–${Y}`), v: +nat.yoy.toFixed(1), f: 'pct1s', txt: pctStr(nat.yoy, lang), sub: t(`Prijsindex ${period(nlLastQ.period, lang, true)}: ${pctStr(nlLastQ.yoy, lang)} op jaarbasis`, `Price index ${period(nlLastQ.period, lang, true)}: ${pctStr(nlLastQ.yoy, lang)} year on year`), sp: spark(qIdx), src: 'CBS 83625NED, 85792NED' },
      { label: t(`Hypotheekrente ${monthShort(A.month, lang)}`, `Mortgage rate ${monthShort(A.month, lang)}`), v: A.rate, f: 'pct2', txt: pct(A.rate, lang, 2), sub: A12 ? t(`Gemiddelde van nieuwe hypotheken; ${(A.rate - A12.rate >= 0 ? '+' : '') + num(A.rate - A12.rate, lang, 2)} %-punt in een jaar`, `Average of new mortgages; ${(A.rate - A12.rate >= 0 ? '+' : '') + num(A.rate - A12.rate, lang, 2)} pp in a year`) : '', sp: spark(aSeries), src: 'ECB/DNB' },
      ...(nlYear?.sold ? [{ label: t(`Verkochte woningen ${Y}`, `Homes sold ${Y}`), v: nlYear.sold, f: 'int', txt: num(nlYear.sold, lang), sub: t(`${period(nlLastQ.period, lang)}: ${num(nlLastQ.sold, lang)}`, `${period(nlLastQ.period, lang)}: ${num(nlLastQ.sold, lang)}`), sp: spark(soldYears), src: 'CBS 85792NED' }] : []),
    ];
    const maxP = Math.max(...CITIES.map(c => gm[c.code].price ?? 0));
    const tools = [
      ['mortgage', t('Maximale hypotheek', 'Maximum mortgage'), t(`Met de leennormen van ${params.year}. Toetsrente minimaal ${rulePct(params.affordability.minToetsrente, lang)} bij korter dan 10 jaar vast.`, `With the ${params.year} lending rules. Test rate at least ${rulePct(params.affordability.minToetsrente, lang)} below 10 years fixed.`), `<span class="tool-fig">${rulePct(params.affordability.minToetsrente, lang)}</span>`],
      ['costs', t('Kosten koper', 'Buying costs'), t(`Overdrachtsbelasting ${rulePct(params.transferTax.ownHome, lang)}, of ${rulePct(params.transferTax.starter, lang)} voor starters tot ${eur(params.transferTax.starterMaxValue, lang)}. Plus NHG en je offertes.`, `Transfer tax ${rulePct(params.transferTax.ownHome, lang)}, or ${rulePct(params.transferTax.starter, lang)} for first-time buyers up to ${eur(params.transferTax.starterMaxValue, lang)}. Plus NHG and your quotes.`), `<span class="tool-fig">${rulePct(params.transferTax.ownHome, lang)}</span>`],
      ['rates', t('Hypotheekrente', 'Mortgage rates'), t(`Gemiddelde rente op nieuwe hypotheken per rentevaste periode, ${Y0} tot nu (ECB/DNB).`, `Average rate on new mortgages by fixed period, ${Y0} to now (ECB/DNB).`), spark(aSeries, { w: 96, h: 30 })],
      ['compare', t('Twee gemeenten vergelijken', 'Compare two municipalities'), t(`Prijs, WOZ-waarde, woningvoorraad en woninggrootte naast elkaar. Alle ${NGM} gemeenten.`, `Price, WOZ value, housing stock and home sizes side by side. All ${NGM} municipalities.`), `<span class="tool-bars" aria-hidden="true"><i style="--w:92%"></i><i style="--w:64%"></i></span>`],
    ];
    const body = `<section class="stage stage-home">
<div class="st-intro">
<h1>${t('Wat kost een huis in Nederland?', 'What does a home cost in the Netherlands?')}</h1>
<p class="lead">${t(`In ${Y} kostte een bestaande koopwoning gemiddeld <strong>${eur(nat.price, lang)}</strong>, ${pctStr(nat.yoy, lang)} ten opzichte van ${YP}. De kaart toont alle ${NGM} gemeenten.`, `In ${Y} an existing owner-occupied home sold for <strong>${eur(nat.price, lang)}</strong> on average, ${pctStr(nat.yoy, lang)} compared with ${YP}. The map shows all ${NGM} municipalities.`)}</p>
${stamp(lang, '85792NED')}
</div>
<div class="st-ctl">${ctl}</div>
<div class="st-map">${map}</div>
<div class="st-kpi"><dl class="kpis">${kpis.map(k => `<div class="kpi"><dt>${esc(k.label)}</dt><dd class="kpi-v"><span data-count="${k.v}" data-f="${k.f}">${esc(k.txt)}</span></dd><dd class="kpi-sub">${esc(k.sub)}</dd><dd class="kpi-sp">${k.sp}</dd><dd class="kpi-src">${esc(k.src)}</dd></div>`).join('')}</dl>
<ul class="actions"><li><a class="btn" href="${u(L('map'))}"${gc('cta-map-home-hero')}>${t('Open de volledige kaart', 'Open the full map')}</a></li><li><a class="btn ghost" href="${u(L('mortgage'))}"${gc('cta-calc-mortgage-home-hero')}>${t('Bereken je maximale hypotheek', 'Calculate your maximum mortgage')}</a></li></ul></div>
</section>
<div class="wrap">
<section class="tools" aria-labelledby="tools-h"><h2 id="tools-h">${t('Rekenen en vergelijken', 'Calculate and compare')}</h2>
<ul class="toolrow">${tools.map(([k, name, txt, fig]) => `<li><a class="tool" href="${u(L(k))}"><span class="tool-vis">${fig}</span><span class="tool-name">${esc(name)}</span><span class="tool-txt">${esc(txt)}</span></a></li>`).join('')}</ul></section>
<section aria-labelledby="cities-h"><div class="sec-head"><h2 id="cities-h">${t(`De 25 grootste gemeenten in ${Y}`, `The 25 largest municipalities in ${Y}`)}</h2><p class="sec-note">${t('Klik op een kolomkop om te sorteren.', 'Click a column header to sort.')}</p></div>
<div class="scroll"><table class="sortable ranked"><thead><tr><th scope="col">${t('Gemeente', 'Municipality')}</th><th scope="col" class="n bar-col">${t('Gemiddelde prijs', 'Average price')}</th><th scope="col" class="n">${t(`t.o.v. ${YP}`, `vs ${YP}`)}</th><th scope="col" class="n">${t('WOZ-waarde', 'WOZ value')}</th></tr></thead><tbody>
${CITIES.map(c => { const g = gm[c.code]; return `<tr><th scope="row">${cityLink(c)}</th><td class="n bar-col" data-v="${g.price}"><span class="cellbar" style="--w:${(g.price / maxP * 100).toFixed(1)}%"></span>${eur(g.price, lang)}</td><td class="n" data-v="${g.yoy?.toFixed(3)}">${pctStr(g.yoy, lang)}</td><td class="n" data-v="${g.woz}">${eur(g.woz, lang)}</td></tr>`; }).join('')}
</tbody></table></div>
<p class="more"><a href="${u(L('prices'))}">${t('Alle provincies en de landelijke trend', 'All provinces and the national trend')}</a></p></section>
${cbsCaveat(lang)}
</div>${data}`;
    page({ lang, route: r, title: t('Woningmarkt Nederland: huizenprijzen, kaart en hypotheek', 'Dutch housing market: house prices, map and mortgage'),
      desc: t(`Gemiddelde huizenprijs per gemeente op de kaart, 10 jaar prijsontwikkeling, maximale hypotheek en kosten koper. Officiële CBS-cijfers, bijgewerkt ${dateLong(S['85792NED'].modified, lang)}.`, `Average house price by municipality on a map, 10-year trend, mortgage and buying-costs calculators. Official CBS figures, updated ${dateLong(S['85792NED'].modified, lang)}.`),
      body, sources: ['83625NED', '85792NED', '86165NED', '83704NED', 'ecb', 'pdok', 'trhk', 'obtarief'], cls: 'home has-stage', scripts: `<script src="${BASE}/js/map.js" defer></script>`,
      schema: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: NAME, url: abs(r[lang]), inLanguage: lang }] });
  }

  // ---------------- map
  {
    const r = ROUTES.map;
    const { ctl, map, data } = mapStage(lang, 'full');
    const rows = Object.entries(gm).sort((a, b) => muniName(a[0], lang).localeCompare(muniName(b[0], lang), lang)).map(([c, g]) =>
      `<tr id="row-${c}"><th scope="row">${cityByCode[c] ? cityLink(cityByCode[c]) : esc(muniName(c, lang))}</th><td>${esc(pv[g.pv]?.name ?? '')}</td><td class="n" data-v="${g.price ?? ''}">${eur(g.price, lang)}</td><td class="n" data-v="${g.yoy?.toFixed(3) ?? ''}">${pctStr(g.yoy, lang)}</td><td class="n" data-v="${g.woz ?? ''}">${eur(g.woz, lang)}</td><td class="n" data-v="${g.pctMulti ?? ''}">${pct(g.pctMulti, lang, 0)}</td></tr>`).join('');
    const body = `<section class="stage stage-full">
<div class="st-intro">
<h1>${t('Huizenprijzen per gemeente', 'House prices by municipality')}</h1>
<p class="lead">${t(`De gemiddelde verkoopprijs van bestaande koopwoningen in alle ${NGM} gemeenten in ${Y}. Wissel van kaartlaag, zoom in op een provincie of klik op een gemeente.`, `The average sale price of existing owner-occupied homes in all ${NGM} municipalities in ${Y}. Switch layers, zoom into a province or click a municipality.`)}</p>
${stamp(lang)}
</div>
<div class="st-ctl">${ctl}</div>
<div class="st-map">${map}</div>
</section>
<div class="wrap">
<noscript><p class="note">${t('De kaart toont zonder JavaScript alleen de gemiddelde prijs. Alle cijfers staan ook in de tabel hieronder.', 'Without JavaScript the map shows the average price only. All figures are also in the table below.')}</p></noscript>
<div class="notes2">
<p class="note">${t(`Prijsverandering = verandering van de gemiddelde verkoopprijs van ${YP} naar ${Y}. WOZ-waarde en aandeel meergezinswoningen: CBS Kerncijfers wijken en buurten (86165NED). Op provincieniveau komt het aandeel meergezinswoningen uit de woningvoorraad (83704NED). De kleuren delen de gemeenten in zeven groepen van ongeveer even veel gemeenten. Gearceerd = geen cijfer in de bron.`, `Price change = change of the average sale price from ${YP} to ${Y}. WOZ value and share of multi-family homes: CBS key figures for districts and neighbourhoods (86165NED). At province level the share of multi-family homes comes from the housing stock table (83704NED). The colours split the municipalities into seven groups of about the same size. Hatched = no figure in the source.`)}</p>
${cbsCaveat(lang)}
</div>
${notShown(lang)}
<section aria-labelledby="tbl-h"><div class="sec-head"><h2 id="tbl-h">${t(`Alle ${NGM} gemeenten`, `All ${NGM} municipalities`)}</h2><p class="sec-note">${t('Klik op een kolomkop om te sorteren.', 'Click a column header to sort.')}</p></div>
<div class="scroll tall"><table class="sortable" id="munitable"><thead><tr><th scope="col">${t('Gemeente', 'Municipality')}</th><th scope="col">${t('Provincie', 'Province')}</th><th scope="col" class="n">${t(`Prijs ${Y}`, `Price ${Y}`)}</th><th scope="col" class="n">${t(`t.o.v. ${YP}`, `vs ${YP}`)}</th><th scope="col" class="n">WOZ</th><th scope="col" class="n">${t('Meergezins', 'Multi-family')}</th></tr></thead><tbody>${rows}</tbody></table></div></section>
</div>${data}`;
    page({ lang, route: r, title: t('Huizenprijzen per gemeente: kaart van Nederland', 'Netherlands house prices map by municipality'),
      desc: t(`Interactieve kaart met de gemiddelde huizenprijs per gemeente (${Y}), WOZ-waarde, aandeel appartementen en prijsverandering. CBS-cijfers voor alle ${NGM} gemeenten.`, `Interactive map of the average house price by municipality (${Y}), WOZ value, share of apartments and price change. CBS figures for all ${NGM} municipalities.`),
      body, sources: ['83625NED', '86165NED', '83704NED', 'pdok'], crumbs: [[t('Kaart', 'Map'), r[lang]]], cls: 'mappage has-stage',
      schema: [dataset({ lang, route: r, name: t(`Gemiddelde verkoopprijs per gemeente ${Y}`, `Average sale price by municipality ${Y}`), description: t(`Gemiddelde verkoopprijs van bestaande koopwoningen, WOZ-waarde en aandeel meergezinswoningen voor alle ${NGM} gemeenten, uit CBS-tabellen 83625NED, 86165NED en 83704NED.`, `Average sale price of existing owner-occupied homes, WOZ value and share of multi-family homes for all ${NGM} municipalities, from CBS tables 83625NED, 86165NED and 83704NED.`), tables: ['83625NED', '86165NED', '83704NED'] })],
      scripts: `<script src="${BASE}/js/map.js" defer></script>` });
  }

  // ---------------- national prices
  {
    const r = ROUTES.prices;
    const chart = lineChart({ series: [{ name: t('Nederland', 'Netherlands'), points: nat.series }], fmtY: v => eurK(v, lang), fmtV: v => eur(v, lang), title: t(`Gemiddelde verkoopprijs Nederland ${Y0}–${Y}`, `Average sale price Netherlands ${Y0}–${Y}`), xEvery: 2 });
    const typeChart = lineChart({ series: [{ name: typeName({ k: 'ZW10290', name: typeSeries('ZW10290').name }, lang), points: annualType('ZW10290') }, { name: typeName({ k: 'ZW25810', name: typeSeries('ZW25810').name }, lang), points: annualType('ZW25810') }], fmtY: v => eurK(v, lang), fmtV: v => eur(v, lang), title: t(`Eengezinswoningen en appartementen, gemiddelde verkoopprijs ${Y0}–${Y}`, `Houses and apartments, average sale price ${Y0}–${Y}`), xEvery: 2, area: false });
    const q = nlRecent.slice(-8);
    const pvRows = Object.entries(pv).sort((a, b) => b[1].price - a[1].price), maxPv = pvRows[0][1].price;
    const maxType = Math.max(...typeLatest.map(x => x.last.avg));
    const body = `<section class="band"><div class="wrap band-grid">
<div class="band-main">
<h1>${t('Huizenprijzen in Nederland', 'House prices in the Netherlands')}</h1>
<p class="lead">${t(`De gemiddelde verkoopprijs van een bestaande koopwoning was ${eur(nat.price, lang)} in ${Y}. In ${Y0} was dat ${eur(nat.first, lang)}: ${pctStr(nat.tenY, lang)} in ${Y - Y0} jaar.`, `The average sale price of an existing owner-occupied home was ${eur(nat.price, lang)} in ${Y}. In ${Y0} it was ${eur(nat.first, lang)}: ${pctStr(nat.tenY, lang)} in ${Y - Y0} years.`)}</p>
${stamp(lang)}
${statBand([[t(`Gemiddelde prijs ${Y}`, `Average price ${Y}`), eur(nat.price, lang), nat.price, 'eur'], [t(`t.o.v. ${YP}`, `vs ${YP}`), pctStr(nat.yoy, lang), +nat.yoy.toFixed(1), 'pct1s'], [t(`t.o.v. ${Y0}`, `vs ${Y0}`), pctStr(nat.tenY, lang), +nat.tenY.toFixed(1), 'pct1s'], [t(`Prijsindex ${period(nlLastQ.period, lang, true)}`, `Price index ${period(nlLastQ.period, lang, true)}`), pctStr(nlLastQ.yoy, lang), nlLastQ.yoy, 'pct1s', esc(t('t.o.v. een jaar eerder', 'vs a year earlier'))]])}
</div>
<div class="band-fig"><h2 id="trend-h" class="fig-h">${t(`Prijsontwikkeling ${Y0}–${Y}`, `Price trend ${Y0}–${Y}`)}</h2>${chart}
${chartTable({ summary: t('Cijfers in de grafiek', 'Figures in the chart'), head: [t('Jaar', 'Year'), t('Gemiddelde prijs', 'Average price'), t('Verandering', 'Change')], rows: nat.series.map(([y, v], i) => [y, eur(v, lang), i ? pctStr(change(nat.series[i - 1][1], v), lang) : '–']) })}</div>
</div></section>
<div class="wrap">
<div class="cols2">
<section aria-labelledby="q-h"><h2 id="q-h">${t('De laatste kwartalen', 'The latest quarters')}</h2>
<p>${t('De prijsindex corrigeert voor de mix van verkochte woningen. Daarom is dit de betere maat voor de prijsontwikkeling.', 'The price index corrects for the mix of homes sold. That makes it the better measure of the price trend.')}</p>
<div class="scroll"><table><thead><tr><th scope="col">${t('Periode', 'Period')}</th><th scope="col" class="n">${t('Gemiddelde prijs', 'Average price')}</th><th scope="col" class="n">${t('Prijsindex t.o.v. een jaar eerder', 'Price index vs a year earlier')}</th><th scope="col" class="n">${t('Verkochte woningen', 'Homes sold')}</th></tr></thead><tbody>
${q.map(x => `<tr><th scope="row"><span class="lg">${esc(period(x.period, lang))}</span><span class="sm" aria-hidden="true">${esc(period(x.period, lang, true))}</span></th><td class="n">${eur(x.avg, lang)}</td><td class="n">${pctStr(x.yoy, lang)}</td><td class="n">${num(x.sold, lang)}</td></tr>`).join('')}</tbody></table></div>
<p class="src-inline">${t('Bron: CBS 85792NED.', 'Source: CBS 85792NED.')}</p></section>
<section aria-labelledby="type-h"><h2 id="type-h">${t('Appartement of eengezinswoning', 'Apartment or house')}</h2>
<p>${t(`Deze uitsplitsing publiceert het CBS alleen voor heel Nederland (tabel 85791NED), niet per gemeente. Cijfers voor het ${period(typeLatest[0].last.period, lang)}:`, `CBS publishes this split only for the Netherlands as a whole (table 85791NED), not by municipality. Figures for ${period(typeLatest[0].last.period, lang)}:`)}</p>
<div class="scroll"><table class="ranked"><thead><tr><th scope="col">${t('Woningtype', 'Dwelling type')}</th><th scope="col" class="n bar-col">${t('Gemiddelde prijs', 'Average price')}</th><th scope="col" class="n">${t('Verkocht', 'Sold')}</th></tr></thead><tbody>
${typeLatest.map(x => `<tr><th scope="row">${esc(typeName(x, lang))}</th><td class="n bar-col"><span class="cellbar" style="--w:${(x.last.avg / maxType * 100).toFixed(1)}%"></span>${eur(x.last.avg, lang)}</td><td class="n">${num(x.last.sold, lang)}</td></tr>`).join('')}</tbody></table></div></section>
</div>
<section aria-labelledby="type2-h"><h2 id="type2-h">${t(`Eengezinswoning en appartement, ${Y0}–${Y}`, `House and apartment, ${Y0}–${Y}`)}</h2>${typeChart}</section>
<section aria-labelledby="pv-h"><div class="sec-head"><h2 id="pv-h">${t('Per provincie', 'By province')}</h2><p class="sec-note">${t('Klik op een kolomkop om te sorteren.', 'Click a column header to sort.')}</p></div>
<div class="scroll"><table class="sortable ranked"><thead><tr><th scope="col">${t('Provincie', 'Province')}</th><th scope="col" class="n">${Y0}</th><th scope="col" class="n bar-col">${Y}</th><th scope="col" class="n">${t(`t.o.v. ${YP}`, `vs ${YP}`)}</th><th scope="col" class="n">${t(`t.o.v. ${Y0}`, `vs ${Y0}`)}</th></tr></thead><tbody>
${pvRows.map(([c, g]) => `<tr><th scope="row">${esc(g.name)}</th><td class="n" data-v="${g.first}">${eur(g.first, lang)}</td><td class="n bar-col" data-v="${g.price}"><span class="cellbar" style="--w:${(g.price / maxPv * 100).toFixed(1)}%"></span>${eur(g.price, lang)}</td><td class="n" data-v="${g.yoy?.toFixed(3)}">${pctStr(g.yoy, lang)}</td><td class="n" data-v="${g.tenY?.toFixed(3)}">${pctStr(g.tenY, lang)}</td></tr>`).join('')}</tbody></table></div></section>
<section aria-labelledby="c-h"><h2 id="c-h">${t('Huizenprijzen per stad', 'House prices by city')}</h2><ul class="citylist">${CITIES.map(c => `<li>${cityLink(c)} <span>${eur(gm[c.code].price, lang)}</span></li>`).join('')}</ul>
<p class="more"><a href="${u(L('map'))}">${t(`Alle ${NGM} gemeenten op de kaart`, `All ${NGM} municipalities on the map`)}</a></p></section>
${cbsCaveat(lang)}
<p>${t('We doen geen voorspelling van huizenprijzen. Lees in de gidsen wat officiële instanties verwachten, met bronvermelding.', 'We do not forecast house prices. The guides explain what official bodies expect, with sources.')}</p>
</div>`;
    page({ lang, route: r, title: t(`Huizenprijzen Nederland: grafiek ${Y0}–${Y} (CBS)`, `House prices Netherlands: chart and history ${Y0}–${Y}`),
      desc: t(`Gemiddelde huizenprijs in Nederland: ${eur(nat.price, lang)} in ${Y}. Grafiek over ${Y - Y0} jaar, laatste kwartalen, appartement vs eengezinswoning en alle provincies. Bron: CBS.`, `Average house price in the Netherlands: ${eur(nat.price, lang)} in ${Y}. ${Y - Y0}-year chart, latest quarters, apartments vs houses and every province. Source: CBS.`),
      body, sources: ['83625NED', '85792NED', '85791NED'], crumbs: [[t('Huizenprijzen', 'House prices'), r[lang]]], cls: 'has-band',
      schema: [dataset({ lang, route: r, name: t(`Huizenprijzen Nederland ${Y0}–${Y}`, `House prices Netherlands ${Y0}–${Y}`), description: t('Gemiddelde verkoopprijzen van bestaande koopwoningen in Nederland en per provincie, kwartaalcijfers met prijsindex en prijzen per woningtype, uit CBS-tabellen.', 'Average sale prices of existing owner-occupied homes in the Netherlands and by province, quarterly figures with the price index, and prices by dwelling type, from CBS tables.'), tables: ['83625NED', '85792NED', '85791NED'] })] });
  }

  // ---------------- city pages
  const natArea = region(NL).area;
  for (const c of CITIES) {
    const r = cityRoute(c.slug), g = gm[c.code], P = pv[g.pv], name = cityName(c, lang);
    const chart = lineChart({ series: [{ name, points: g.series }, { name: t(`provincie ${P.name}`, `province of ${P.name}`), points: P.series, cls: 'muted' }, { name: t('Nederland', 'Netherlands'), points: nat.series, cls: 'muted2' }], fmtY: v => eurK(v, lang), fmtV: v => eur(v, lang), title: t(`Gemiddelde verkoopprijs ${name}, provincie ${P.name} en Nederland, ${Y0}–${Y}`, `Average sale price ${name}, province of ${P.name} and the Netherlands, ${Y0}–${Y}`), xEvery: 2 });
    const rec = housing.recent[c.code]?.filter(x => /KW/.test(x.period)).slice(-6);
    const nb = neighbours[c.code].map(n => ({ c: n, g: gm[n] })).sort((a, b) => (b.g.price ?? -1) - (a.g.price ?? -1));
    const pairs = PAIRS.filter(p => p.includes(c.slug));
    const vsNat = change(nat.price, g.price), vsPv = change(P.price, g.price);
    const d = g.area, dh = g.areaHouse, da = g.areaApt;
    const inPv = Object.values(gm).filter(x => x.pv === g.pv), rkPv = 1 + inPv.filter(x => (x.price ?? -Infinity) > g.price).length;
    const rkP = rankOf(c.code, 'price'), rkY = rankOf(c.code, 'yoy'), rkW = rankOf(c.code, 'woz');
    const facts = [
      [t('Gemiddelde WOZ-waarde', 'Average WOZ value'), eur(g.woz, lang)],
      [t('Woningen', 'Dwellings'), num(g.dwellings, lang)],
      [t('Inwoners', 'Inhabitants'), num(g.inhabitants, lang)],
      [t('Koopwoningen / huurwoningen', 'Owner-occupied / rented'), `${pct(g.pctOwner, lang, 0)} / ${pct(g.pctRent, lang, 0)}`, g.pctOwner],
      [t('Eengezins / meergezins', 'Single-family / multi-family'), `${pct(g.pctSingle, lang, 0)} / ${pct(g.pctMulti, lang, 0)}`, g.pctSingle],
      [t('Gebouwd in de laatste 10 jaar', 'Built in the last 10 years'), pct(g.built10, lang, 0), g.built10],
      [t('Auto’s per huishouden (context, geen maat voor parkeren)', 'Cars per household (context, not a parking measure)'), num(g.cars, lang, 1)],
    ];
    const nbMax = Math.max(g.price ?? 0, ...nb.map(x => x.g.price ?? 0));
    const chips = [deltaChip(t('t.o.v. Nederland', 'vs the Netherlands'), vsNat, lang), deltaChip(t(`t.o.v. provincie ${P.name}`, `vs province of ${P.name}`), vsPv, lang),
      ...c.near.slice(0, 3).map(x => { const pr = pairs.find(p => p.includes(x.c.slug)); return deltaChip(t(`t.o.v. ${cityName(x.c, lang)}`, `vs ${cityName(x.c, lang)}`), change(gm[x.c.code].price, g.price), lang, pr ? u(pairRoute(...pr)[lang]) : u(cityRoute(x.c.slug)[lang])); })];
    const body = `<section class="band"><div class="wrap band-grid">
<div class="band-main">
<p class="band-pre">${t(`Gemeente in de provincie ${esc(P.name)}`, `Municipality in the province of ${esc(P.name)}`)}</p>
<h1>${t(`Huizenprijzen ${name}`, `House prices ${name}`)}</h1>
<p class="lead">${t(`In ${Y} was de gemiddelde verkoopprijs van een bestaande koopwoning in ${name} <strong>${eur(g.price, lang)}</strong>. Dat is ${pctStr(g.yoy, lang)} ten opzichte van ${YP} en ${pctStr(g.tenY, lang)} ten opzichte van ${Y0}.`, `In ${Y} the average sale price of an existing owner-occupied home in ${name} was <strong>${eur(g.price, lang)}</strong>. That is ${pctStr(g.yoy, lang)} compared with ${YP} and ${pctStr(g.tenY, lang)} compared with ${Y0}.`)}</p>
<ul class="badges">${rkP ? `<li><b>#${rkP}</b> ${t(`van ${NGM} gemeenten op prijs`, `of ${NGM} municipalities by price`)}</li>` : ''}<li><b>#${rkPv}</b> ${t(`van ${inPv.length} in ${esc(P.name)}`, `of ${inPv.length} in ${esc(P.name)}`)}</li>${rkY ? `<li><b>#${rkY}</b> ${t(`van ${NGM} op prijsstijging`, `of ${NGM} by price rise`)}</li>` : ''}${rkW ? `<li><b>#${rkW}</b> ${t(`van ${NGM} op WOZ-waarde`, `of ${NGM} by WOZ value`)}</li>` : ''}</ul>
${statBand([[t(`Gemiddelde prijs ${Y}`, `Average price ${Y}`), eur(g.price, lang), g.price, 'eur'], [t(`t.o.v. ${YP}`, `vs ${YP}`), pctStr(g.yoy, lang), g.yoy == null ? null : +g.yoy.toFixed(1), 'pct1s'], [t(`t.o.v. ${Y0}`, `vs ${Y0}`), pctStr(g.tenY, lang), g.tenY == null ? null : +g.tenY.toFixed(1), 'pct1s'], [t('Gemiddelde WOZ-waarde', 'Average WOZ value'), eur(g.woz, lang), g.woz, 'eur']])}
${stamp(lang)}
</div>
<div class="band-fig">${localMap(c, lang)}</div>
</div></section>
<div class="wrap">
<section aria-labelledby="trend-h"><div class="sec-head"><h2 id="trend-h">${t(`Prijsontwikkeling ${Y0}–${Y}`, `Price trend ${Y0}–${Y}`)}</h2></div>
<ul class="chips" aria-label="${t(`Gemiddelde prijs in ${name} vergeleken`, `Average price in ${name} compared`)}">${chips.join('')}</ul>
${chart}
${chartTable({ summary: t('Cijfers in de grafiek', 'Figures in the chart'), head: [t('Jaar', 'Year'), name, t(`provincie ${P.name}`, `province of ${P.name}`), t('Nederland', 'Netherlands')], rows: years.map((y, i) => [String(y), eur(g.series[i][1], lang), eur(P.series[i][1], lang), eur(nat.series[i][1], lang)]) })}</section>
${rec?.length ? `<section aria-labelledby="q-h"><h2 id="q-h">${t('De laatste kwartalen', 'The latest quarters')}</h2><p>${t(`Voor ${name} publiceert het CBS ook kwartaalcijfers met een prijsindex (tabel 85792NED).`, `For ${name}, CBS also publishes quarterly figures with a price index (table 85792NED).`)}</p>
<div class="scroll"><table><thead><tr><th scope="col">${t('Periode', 'Period')}</th><th scope="col" class="n">${t('Gemiddelde prijs', 'Average price')}</th><th scope="col" class="n">${t('Prijsindex t.o.v. een jaar eerder', 'Price index vs a year earlier')}</th><th scope="col" class="n">${t('Verkocht', 'Sold')}</th></tr></thead><tbody>
${rec.map(x => `<tr><th scope="row"><span class="lg">${esc(period(x.period, lang))}</span><span class="sm" aria-hidden="true">${esc(period(x.period, lang, true))}</span></th><td class="n">${eur(x.avg, lang)}</td><td class="n">${pctStr(x.yoy, lang)}</td><td class="n">${num(x.sold, lang)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
<div class="cols2">
<section aria-labelledby="stock-h"><h2 id="stock-h">${t('WOZ-waarde en woningvoorraad', 'WOZ value and housing stock')}</h2>
<dl class="facts tiles">${facts.map(([k, v, share]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd>${share != null ? `<dd class="meter" aria-hidden="true"><i style="--w:${share}%"></i></dd>` : ''}</div>`).join('')}</dl>
<p class="src-inline">${t(`Bron: CBS Kerncijfers wijken en buurten (${housing.kernTable}).`, `Source: CBS key figures for districts and neighbourhoods (${housing.kernTable}).`)}</p></section>
<section aria-labelledby="area-h"><h2 id="area-h">${t('Hoe groot zijn de woningen?', 'How big are the homes?')}</h2>
<p>${d ? t(`De middelste woning in ${name} valt in de klasse <strong>${esc(d.median.name)}</strong>. Bij eengezinswoningen is dat ${esc(dh?.median.name ?? NA[lang])}, bij meergezinswoningen ${esc(da?.median.name ?? NA[lang])}.`, `The middle home in ${name} falls in the <strong>${esc(d.median.name)}</strong> class. For single-family homes it is ${esc(dh?.median.name ?? NA[lang])}, for multi-family homes ${esc(da?.median.name ?? NA[lang])}.`) : NA[lang]}</p>
<h3 id="bars-${c.slug}">${t(`Woningvoorraad naar oppervlakte (begin ${housing.area.year}), alle woningen. Streep: Nederland.`, `Housing stock by floor area (start of ${housing.area.year}), all homes. Line: the Netherlands.`)}</h3>
${areaBars(d, lang, `bars-${c.slug}`, natArea)}
<p class="src-inline">${t(`Bron: CBS 83704NED. Woningen met onbekende oppervlakte (${num(d?.unknown, lang)}) tellen niet mee in de percentages.`, `Source: CBS 83704NED. Homes with unknown floor area (${num(d?.unknown, lang)}) are left out of the percentages.`)}</p></section>
</div>
<p class="note">${t(`Prijzen per woningtype publiceert het CBS alleen voor heel Nederland, niet voor ${name}. Landelijk kostte een eengezinswoning in het ${period(nationalSplit.house.period, lang)} gemiddeld ${eur(nationalSplit.house.avg, lang)} en een appartement ${eur(nationalSplit.apt.avg, lang)} (CBS 85791NED).`, `CBS publishes prices by dwelling type only for the Netherlands as a whole, not for ${name}. Nationally, a single-family home sold for ${eur(nationalSplit.house.avg, lang)} on average in ${period(nationalSplit.house.period, lang)} and an apartment for ${eur(nationalSplit.apt.avg, lang)} (CBS 85791NED).`)}</p>
<section aria-labelledby="nb-h"><h2 id="nb-h">${t(`${name} en de buurgemeenten`, `${name} and neighbouring municipalities`)}</h2>
<div class="scroll"><table class="sortable ranked"><thead><tr><th scope="col">${t('Gemeente', 'Municipality')}</th><th scope="col" class="n bar-col">${t(`Prijs ${Y}`, `Price ${Y}`)}</th><th scope="col" class="n">${t(`t.o.v. ${YP}`, `vs ${YP}`)}</th><th scope="col" class="n">WOZ</th></tr></thead><tbody>
${[{ c: c.code, g }, ...nb].map(x => `<tr${x.c === c.code ? ' class="self"' : ''}><th scope="row">${cityByCode[x.c] && x.c !== c.code ? cityLink(cityByCode[x.c]) : esc(muniName(x.c, lang))}</th><td class="n bar-col" data-v="${x.g.price}"><span class="cellbar" style="--w:${((x.g.price ?? 0) / nbMax * 100).toFixed(1)}%"></span>${eur(x.g.price, lang)}</td><td class="n" data-v="${x.g.yoy?.toFixed(3)}">${pctStr(x.g.yoy, lang)}</td><td class="n" data-v="${x.g.woz}">${eur(x.g.woz, lang)}</td></tr>`).join('')}</tbody></table></div>
<p class="more"><a href="${u(L('map'))}#${c.code}">${t(`${name} op de grote kaart`, `${name} on the full map`)}</a></p></section>
<section aria-labelledby="cmp-h"><h2 id="cmp-h">${t('Vergelijken', 'Compare')}</h2><ul class="chips links-chips">
${pairs.map(([a, b]) => `<li><a class="chip" href="${u(pairRoute(a, b)[lang])}">${esc(cityName(bySlug[a], lang))} ${t('of', 'vs')} ${esc(cityName(bySlug[b], lang))}</a></li>`).join('')}</ul>
<h3>${t('Steden in de buurt', 'Nearby cities')}</h3><ul class="chips links-chips">${c.near.slice(0, 4).map(x => `<li><a class="chip" href="${u(cityRoute(x.c.slug)[lang])}">${esc(cityName(x.c, lang))} <span class="chip-v">${num(x.km, lang)} km</span></a></li>`).join('')}</ul></section>
${cbsCaveat(lang)}
${notShown(lang, { city: name })}
${adSlot('advisor', lang, r)}
</div>`;
    page({ lang, route: r, title: t(`Huizenprijzen ${name} ${Y}: gemiddelde prijs en trend`, `House prices ${name} ${Y}: average price and trend`),
      desc: t(`Gemiddelde huizenprijs in ${name}: ${eur(g.price, lang)} in ${Y} (${pctStr(g.yoy, lang)}). Trend sinds ${Y0}, WOZ-waarde, woninggrootte en buurgemeenten. Bron: CBS.`, `Average house price in ${name}: ${eur(g.price, lang)} in ${Y} (${pctStr(g.yoy, lang)}). Trend since ${Y0}, WOZ value, home sizes and neighbouring municipalities. Source: CBS.`),
      body, sources: ['83625NED', ...(rec?.length ? ['85792NED'] : []), '85791NED', '86165NED', '83704NED', 'pdok'], crumbs: [[t('Huizenprijzen', 'House prices'), ROUTES.prices[lang]], [name, r[lang]]], cls: 'has-band',
      schema: [dataset({ lang, route: r, name: t(`Huizenprijzen ${name} ${Y0}–${Y}`, `House prices ${name} ${Y0}–${Y}`), description: t(`Gemiddelde verkoopprijs van bestaande koopwoningen in ${name} per jaar, WOZ-waarde, woningvoorraad en oppervlakteklassen, uit CBS-tabellen.`, `Average sale price of existing owner-occupied homes in ${name} by year, WOZ value, housing stock and floor-area classes, from CBS tables.`), tables: ['83625NED', '86165NED', '83704NED'], spatial: name })] });
  }

  // ---------------- compare pairs and hub
  // Rows: [label, textA, textB, numA, numB]. Numeric rows get mirrored bars, scaled per row.
  const compareRows = (a, b) => [
    [t(`Gemiddelde verkoopprijs ${Y}`, `Average sale price ${Y}`), eur(a.price, lang), eur(b.price, lang), a.price, b.price],
    [t(`Verandering t.o.v. ${YP}`, `Change vs ${YP}`), pctStr(a.yoy, lang), pctStr(b.yoy, lang), a.yoy, b.yoy],
    [t(`Verandering t.o.v. ${Y0}`, `Change vs ${Y0}`), pctStr(a.tenY, lang), pctStr(b.tenY, lang), a.tenY, b.tenY],
    [t('Gemiddelde WOZ-waarde', 'Average WOZ value'), eur(a.woz, lang), eur(b.woz, lang), a.woz, b.woz],
    [t('Koopwoningen', 'Owner-occupied'), pct(a.pctOwner, lang, 0), pct(b.pctOwner, lang, 0), a.pctOwner, b.pctOwner],
    [t('Meergezinswoningen', 'Multi-family homes'), pct(a.pctMulti, lang, 0), pct(b.pctMulti, lang, 0), a.pctMulti, b.pctMulti],
    [t('Klasse van de middelste woning', 'Floor-area class of the middle home'), a.area?.median.name ?? NA[lang], b.area?.median.name ?? NA[lang], null, null],
    [t('Woningen', 'Dwellings'), num(a.dwellings, lang), num(b.dwellings, lang), a.dwellings, b.dwellings],
    [t('Inwoners', 'Inhabitants'), num(a.inhabitants, lang), num(b.inhabitants, lang), a.inhabitants, b.inhabitants],
    [t('Auto’s per huishouden (context)', 'Cars per household (context)'), num(a.cars, lang, 1), num(b.cars, lang, 1), a.cars, b.cars],
  ];
  const bfBar = (v, max) => v == null || !max ? '' : `<span class="bf${v < 0 ? ' neg' : ''}"><i style="--w:${(Math.abs(v) / max * 100).toFixed(1)}%"></i></span>`;
  const cmpTable = (rows, headA, headB) => `<div class="scroll"><table class="cmp butterfly"><thead><tr><th scope="col"><span class="vh">${t('Kenmerk', 'Measure')}</span></th><th scope="col" class="n ca">${headA}</th><th scope="col" class="cb">${headB}</th></tr></thead><tbody>
${rows.map(([k, x, y, va, vb]) => { const max = va == null && vb == null ? 0 : Math.max(Math.abs(va ?? 0), Math.abs(vb ?? 0)); return `<tr><th scope="row">${esc(k)}</th><td class="n ca"><span class="v">${esc(x)}</span>${bfBar(va, max)}</td><td class="cb">${bfBar(vb, max)}<span class="v">${esc(y)}</span></td></tr>`; }).join('')}</tbody></table></div>`;
  for (const [sa, sb] of PAIRS) {
    const A = bySlug[sa], B = bySlug[sb], a = gm[A.code], b = gm[B.code], na = cityName(A, lang), nb = cityName(B, lang), r = pairRoute(sa, sb);
    const diff = a.price - b.price, rel = change(b.price, a.price);
    const chart = lineChart({ series: [{ name: na, points: a.series }, { name: nb, points: b.series, cls: 'second' }], fmtY: v => eurK(v, lang), fmtV: v => eur(v, lang), title: t(`Gemiddelde verkoopprijs ${na} en ${nb}, ${Y0}–${Y}`, `Average sale price ${na} and ${nb}, ${Y0}–${Y}`), xEvery: 2, area: false });
    const others = PAIRS.filter(p => (p.includes(sa) || p.includes(sb)) && !(p[0] === sa && p[1] === sb));
    const body = `<section class="band band-cmp"><div class="wrap">
<h1>${t(`${na} of ${nb}: huizenprijzen vergeleken`, `${na} vs ${nb}: house prices compared`)}</h1>
<p class="lead">${t(`In ${Y} was een bestaande koopwoning in ${diff >= 0 ? na : nb} gemiddeld ${eur(Math.abs(diff), lang)} duurder dan in ${diff >= 0 ? nb : na}. Gemiddeld ${eur(a.price, lang)} in ${na} tegen ${eur(b.price, lang)} in ${nb} (${pctStr(rel, lang)}).`, `In ${Y} an existing owner-occupied home in ${diff >= 0 ? na : nb} cost ${eur(Math.abs(diff), lang)} more on average than in ${diff >= 0 ? nb : na}. On average ${eur(a.price, lang)} in ${na} against ${eur(b.price, lang)} in ${nb} (${pctStr(rel, lang)}).`)}</p>
<div class="versus"><div class="vs-a"><span class="vs-n">${esc(na)}</span><span class="vs-v" data-count="${a.price}" data-f="eur">${eur(a.price, lang)}</span></div><div class="vs-mid" aria-hidden="true">${t('of', 'vs')}</div><div class="vs-b"><span class="vs-n">${esc(nb)}</span><span class="vs-v" data-count="${b.price}" data-f="eur">${eur(b.price, lang)}</span></div></div>
${stamp(lang)}
</div></section>
<div class="wrap">
${cmpTable(compareRows(a, b), cityLink(A), cityLink(B))}
<section aria-labelledby="trend-h"><h2 id="trend-h">${t(`Prijsontwikkeling ${Y0}–${Y}`, `Price trend ${Y0}–${Y}`)}</h2>${chart}
${chartTable({ summary: t('Cijfers in de grafiek', 'Figures in the chart'), head: [t('Jaar', 'Year'), na, nb], rows: years.map((y, i) => [String(y), eur(a.series[i][1], lang), eur(b.series[i][1], lang)]) })}</section>
<section aria-labelledby="area-h"><h2 id="area-h">${t('Woninggrootte', 'Home sizes')}</h2><div class="two">
<div><h3 id="ba-${sa}">${esc(na)}</h3>${areaBars(a.area, lang, `ba-${sa}`)}</div><div><h3 id="bb-${sb}">${esc(nb)}</h3>${areaBars(b.area, lang, `bb-${sb}`)}</div></div>
<p class="src-inline">${t(`Woningvoorraad naar oppervlakteklasse, begin ${housing.area.year} (CBS 83704NED).`, `Housing stock by floor-area class, start of ${housing.area.year} (CBS 83704NED).`)}</p></section>
${others.length ? `<section aria-labelledby="more-h"><h2 id="more-h">${t('Meer vergelijkingen', 'More comparisons')}</h2><ul class="chips links-chips">${others.map(([x, y]) => `<li><a class="chip" href="${u(pairRoute(x, y)[lang])}">${esc(cityName(bySlug[x], lang))} ${t('of', 'vs')} ${esc(cityName(bySlug[y], lang))}</a></li>`).join('')}</ul><p class="more"><a href="${u(L('compare'))}">${t('Vergelijk twee andere gemeenten', 'Compare two other municipalities')}</a></p></section>` : ''}
${cbsCaveat(lang)}
<p class="note">${t('Woonlasten, kamers, parkeren en prijs per m² staan hier niet: daarvoor is geen vrije officiële bron per gemeente.', 'Living costs, rooms, parking and price per m² are not shown: there is no free official source for them by municipality.')} <a href="${u(L('methods'))}">${t('Methode en bronnen', 'Methods and sources')}</a></p>
${adSlot('verhuismatch', lang, r)}
</div>`;
    page({ lang, route: r, title: t(`${na} of ${nb}: huizenprijzen vergeleken`, `${na} vs ${nb}: house prices compared`),
      desc: t(`${na} of ${nb}? Gemiddelde huizenprijs ${Y}: ${eur(a.price, lang)} tegen ${eur(b.price, lang)}. Trend, WOZ-waarde, koopwoningen en woninggrootte naast elkaar. Bron: CBS.`, `${na} or ${nb}? Average house price ${Y}: ${eur(a.price, lang)} against ${eur(b.price, lang)}. Trend, WOZ value, ownership and home sizes side by side. Source: CBS.`),
      body, sources: ['83625NED', '86165NED', '83704NED'], crumbs: [[t('Vergelijken', 'Compare'), ROUTES.compare[lang]], [`${na} ${t('of', 'vs')} ${nb}`, r[lang]]], cls: 'has-band',
      schema: [dataset({ lang, route: r, name: t(`Huizenprijzen ${na} en ${nb}`, `House prices ${na} and ${nb}`), description: t(`Gemiddelde verkoopprijs, WOZ-waarde, woningvoorraad en oppervlakteklassen van ${na} en ${nb} naast elkaar, uit CBS-tabellen.`, `Average sale price, WOZ value, housing stock and floor-area classes of ${na} and ${nb} side by side, from CBS tables.`), tables: ['83625NED', '86165NED', '83704NED'], spatial: `${na}, ${nb}` })] });
  }
  {
    const r = ROUTES.compare;
    const opts = Object.keys(gm).sort((a, b) => muniName(a, lang).localeCompare(muniName(b, lang), lang)).map(c => `<option value="${c}">${esc(muniName(c, lang))}</option>`).join('');
    const pairUrl = Object.fromEntries(PAIRS.map(([a, b]) => [`${bySlug[a].code}|${bySlug[b].code}`, u(pairRoute(a, b)[lang])]));
    const data = { lang, y: Y, yp: YP, y0: Y0, pairs: pairUrl,
      rows: Object.fromEntries(Object.entries(gm).map(([c, g]) => [c, { n: muniName(c, lang), p: g.price, yoy: g.yoy, ten: g.tenY, woz: g.woz, own: g.pctOwner, multi: g.pctMulti, med: g.area?.median.name ?? null, dw: g.dwellings, inh: g.inhabitants, cars: g.cars, url: cityByCode[c] ? u(cityRoute(cityByCode[c].slug)[lang]) : null }])),
      labels: compareRows(gm[CITIES[0].code], gm[CITIES[1].code]).map(r => r[0]),
      i18n: { na: NA[lang], open: t('Open de uitgebreide vergelijking', 'Open the full comparison'), same: t('Kies twee verschillende gemeenten.', 'Choose two different municipalities.'), measure: t('Kenmerk', 'Measure'),
        more: t('{a} is gemiddeld {d} duurder dan {b} ({p}).', 'On average {a} costs {d} more than {b} ({p}).'), equal: t('{a} en {b} hebben dezelfde gemiddelde prijs.', '{a} and {b} have the same average price.') } };
    const [d0, d1] = [CITIES[0].code, CITIES[1].code];
    const body = `<div class="wrap">
<h1>${t('Huizenprijzen vergelijken', 'Compare house prices')}</h1>
<p class="lead">${t(`Zet twee van de ${NGM} gemeenten naast elkaar: gemiddelde verkoopprijs, WOZ-waarde, woningvoorraad en woninggrootte.`, `Put two of the ${NGM} municipalities side by side: average sale price, WOZ value, housing stock and home sizes.`)}</p>
${stamp(lang)}
</div>
<div class="cmpbar"><form id="cmpform" class="wrap cmpform" action="" method="get"><div class="sel sel-a"><label for="ca">${t('Gemeente 1', 'Municipality 1')}</label><select id="ca" name="a">${opts}</select></div><button type="button" class="swap" id="swap" aria-label="${t('Wissel de twee gemeenten om', 'Swap the two municipalities')}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4 3 7l3 3M3 7h11M14 10l3 3-3 3M17 13H6"/></svg></button><div class="sel sel-b"><label for="cb">${t('Gemeente 2', 'Municipality 2')}</label><select id="cb" name="b">${opts}</select></div><button type="submit" class="btn"${gc('cta-compare-submit')}>${t('Vergelijk', 'Compare')}</button></form></div>
<div class="wrap">
<div id="cmpout" aria-live="polite"><p class="cmp-sum" id="cmpsum"></p>${cmpTable(compareRows(gm[d0], gm[d1]), esc(muniName(d0, lang)), esc(muniName(d1, lang)))}</div>
<noscript><p class="note">${t('Deze vergelijker werkt met JavaScript. Zonder JavaScript kun je de vaste vergelijkingen hieronder gebruiken.', 'This tool needs JavaScript. Without it, use the fixed comparisons below.')}</p></noscript>
<section aria-labelledby="pairs-h"><h2 id="pairs-h">${t('Populaire vergelijkingen', 'Popular comparisons')}</h2><ul class="chips links-chips">
${PAIRS.map(([a, b]) => `<li><a class="chip" href="${u(pairRoute(a, b)[lang])}">${esc(cityName(bySlug[a], lang))} ${t('of', 'vs')} ${esc(cityName(bySlug[b], lang))}</a></li>`).join('')}</ul></section>
${cbsCaveat(lang)}
${adSlot('verhuismatch', lang, r)}
</div>${jsonData('cmpdata', data)}`;
    page({ lang, route: r, title: t('Huizenprijzen vergelijken per gemeente', 'Compare house prices between Dutch cities'),
      desc: t(`Vergelijk de gemiddelde huizenprijs, WOZ-waarde en woningvoorraad van twee gemeenten. Alle ${NGM} gemeenten, officiële CBS-cijfers.`, `Compare the average house price, WOZ value and housing stock of two Dutch municipalities. All ${NGM} municipalities, official CBS figures.`),
      body, sources: ['83625NED', '86165NED', '83704NED'], crumbs: [[t('Vergelijken', 'Compare'), r[lang]]], cls: 'cmppage',
      scripts: `<script src="${BASE}/js/compare.js" defer></script>` });
  }

  // ---------------- mortgage calculator
  // Number input with an optional slider. The slider mirrors the number field (calculator JS keeps them in sync).
  const field = ({ id, name = id, label, value = '', min = 0, max = null, step, help = '', range = null, pre = '', suf = '', placeholder = '', mode = 'numeric' }) =>
    `<div class="f"><label for="${id}">${label}</label><div class="inp${pre ? ' has-pre' : ''}${suf ? ' has-suf' : ''}">${pre ? `<span class="pre" aria-hidden="true">${pre}</span>` : ''}<input id="${id}" name="${name}" type="number" inputmode="${mode}" min="${min}"${max != null ? ` max="${max}"` : ''} step="${step}"${value !== '' ? ` value="${value}"` : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${help ? ` aria-describedby="${id}-h"` : ''}>${suf ? `<span class="suf" aria-hidden="true">${suf}</span>` : ''}</div>${range ? `<input class="range" type="range" id="${id}-r" min="${range[0]}" max="${range[1]}" step="${range[2]}" value="${value === '' ? range[0] : Math.min(range[1], value)}" aria-label="${esc(label.replace(/<[^>]+>/g, ''))}" data-for="${id}">` : ''}${help ? `<p class="help" id="${id}-h">${help}</p>` : ''}</div>`;
  const toggle = (id, label, checked = false) => `<div class="f check"><label class="tgl"><input id="${id}" name="${id}" type="checkbox"${checked ? ' checked' : ''}><span class="tgl-ui" aria-hidden="true"></span><span>${label}</span></label></div>`;
  {
    const r = ROUTES.mortgage, a = params.affordability;
    const defRate = { F: lastObs('F'), I: lastObs('I'), O: lastObs('O'), P: lastObs('P') };
    const ex = maxMortgage({ income: 46500, ratePct: defRate.O.rate, fixedYears: 10 }, params);
    const exSeh = maxMortgage({ income: 46500, ratePct: 5, fixedYears: 10 }, params);
    const sched = annuitySchedule(ex.total, defRate.O.rate, a.termYears);
    const labelOpt = { '': t('Onbekend of geen label', 'Unknown or no label'), EFG: 'E, F, G', CD: 'C, D', AB: 'A, B', 'A+/A++': 'A+, A++', 'A+++': 'A+++', 'A++++': 'A++++', 'A++++ garantie': t('A++++ met energieprestatiegarantie', 'A++++ with energy performance guarantee') };
    const payNote = (rate, total) => t(`Annuïteit over ${a.termYears} jaar tegen ${pct(rate, lang, 2)}. Totale rente: ${eur(total, lang)}. Zonder hypotheekrenteaftrek.`, `Annuity over ${a.termYears} years at ${pct(rate, lang, 2)}. Total interest: ${eur(total, lang)}. Before mortgage interest tax relief.`);
    const data = { lang, params: { affordability: a, nhg: params.nhg }, rates: Object.fromEntries(Object.entries(defRate).map(([k, v]) => [k, v.rate])),
      rateHelp: Object.fromEntries(SERIES_ORDER.map(k => [k, t(`Standaard: gemiddelde rente op nieuwe hypotheken, reeks “${series[k].label.nl}” (ECB/DNB, ${monthLong(defRate[k].month, lang)}). Vul de rente uit je offerte in.`, `Default: average rate on new mortgages, series “${series[k].label.en}” (ECB/DNB, ${monthLong(defRate[k].month, lang)}). Enter the rate from your offer.`)])),
      i18n: { minApplied: t(`De toetsrente is verhoogd naar het minimum van ${rulePct(a.minToetsrente, lang)}, omdat de rentevaste periode korter is dan 10 jaar.`, `The test rate was raised to the minimum of ${rulePct(a.minToetsrente, lang)} because the fixed period is shorter than 10 years.`), actual: t('De toetsrente is je eigen rente, omdat de rente 10 jaar of langer vastligt.', 'The test rate is your own rate, because it is fixed for 10 years or longer.'), aboveMin: t(`De rentevaste periode is korter dan 10 jaar. Je rente is niet lager dan het minimum van ${rulePct(a.minToetsrente, lang)}, dus we toetsen met je eigen rente.`, `The fixed period is shorter than 10 years. Your rate is not below the minimum of ${rulePct(a.minToetsrente, lang)}, so we test at your own rate.`), byValue: t('Begrensd door de woningwaarde.', 'Capped by the home value.'), nhgYes: t(`Binnen de NHG-grens van ${eur(params.nhg.limit, lang)}.`, `Within the NHG limit of ${eur(params.nhg.limit, lang)}.`), nhgNo: t(`Boven de NHG-grens van ${eur(params.nhg.limit, lang)}.`, `Above the NHG limit of ${eur(params.nhg.limit, lang)}.`), none: '–',
        pay: t('Annuïteit over {n} jaar tegen {r}. Totale rente: {i}. Zonder hypotheekrenteaftrek.', 'Annuity over {n} years at {r}. Total interest: {i}. Before mortgage interest tax relief.'), year: t('jr', 'yr') } };
    const ratesNote = SERIES_ORDER.map(k => `${esc(series[k].label[lang])}: ${pct(defRate[k].rate, lang, 2)}`).join('; ');
    const share = v => ex.total ? (v / ex.total * 100).toFixed(2) : 0;
    const body = `<div class="wrap">
<div class="tool-head"><h1>${t('Maximale hypotheek berekenen', 'Mortgage calculator: how much can I borrow?')}</h1>
<p class="lead">${t(`Bereken hoeveel je maximaal kunt lenen op basis van je inkomen. De rekenhulp gebruikt de financieringslasttabellen van de Tijdelijke regeling hypothecair krediet ${params.year}. De uitkomst is indicatief en geen advies.`, `Calculate the most you can borrow based on your income. The calculator uses the lending tables of the Dutch Temporary Regulation on Mortgage Credit (Trhk) ${params.year}. The result is indicative and not advice.`)}</p></div>
<div class="calc">
<form id="mortgage" class="calc-form" onsubmit="return false">
${field({ id: 'income', label: t('Bruto toetsinkomen per jaar (samen)', 'Gross test income per year (combined)'), value: 46500, step: 500, pre: '€', range: [0, 200000, 500], help: t('Voorbeeldbedrag; vul je eigen inkomen in. Heb je een partner, vul dan het totaal in.', 'Example amount; enter your own income. With a partner, enter the total.') })}
<div class="f"><label for="fixed">${t('Rentevaste periode', 'Fixed-rate period')}</label><select id="fixed" name="fixed"><option value="1">${t('1 jaar of variabel', '1 year or variable')}</option><option value="5">${t('5 jaar', '5 years')}</option><option value="10" selected>${t('10 jaar', '10 years')}</option><option value="15">${t('15 jaar', '15 years')}</option><option value="20">${t('20 jaar', '20 years')}</option><option value="30">${t('30 jaar', '30 years')}</option></select></div>
${field({ id: 'rate', label: t('Hypotheekrente (%)', 'Mortgage interest rate (%)'), value: defRate.O.rate, min: 0, max: 15, step: 0.01, suf: '%', mode: 'decimal', range: [0.5, 8, 0.01], help: t(`Standaard: gemiddelde rente op nieuwe hypotheken, reeks “${series.O.label.nl}” (ECB/DNB, ${monthLong(defRate.O.month, lang)}). Vul de rente uit je offerte in.`, `Default: average rate on new mortgages, series “${series.O.label.en}” (ECB/DNB, ${monthLong(defRate.O.month, lang)}). Enter the rate from your offer.`) }).replace('id="rate-h"', 'id="rate-h"').replace('<p class="help" id="rate-h">', '<p class="help" id="ratehelp">').replace('aria-describedby="rate-h"', 'aria-describedby="ratehelp"')}
${field({ id: 'debt', label: t('Studieschuld: maandbedrag aan DUO (€)', 'Student debt: monthly payment to DUO (€)'), value: 0, step: 10, pre: '€', range: [0, 1000, 10] })}
<div class="f"><label for="label">${t('Energielabel van de woning', 'Energy label of the home')}</label><select id="label" name="label">${['', ...ENERGY_LABELS].map(k => `<option value="${esc(k)}">${esc(labelOpt[k])}</option>`).join('')}</select></div>
${toggle('saving', t('Ik wil energiebesparende maatregelen meefinancieren', 'I want to finance energy-saving measures'))}
${toggle('aow', t('Ik heb de AOW-leeftijd bereikt', 'I have reached the Dutch state pension (AOW) age'))}
${field({ id: 'value', label: t('Woningwaarde (optioneel, €)', 'Home value (optional, €)'), step: 1000, pre: '€', placeholder: t('Bijv. de koopsom', 'E.g. the purchase price') })}
</form>
<a class="calc-peek" href="#mortgage-out" aria-hidden="true" tabindex="-1"><span>${t('Maximale hypotheek', 'Maximum mortgage')}</span><strong id="o-peek">${eur(ex.total, lang)}</strong></a>
<div class="calc-out" id="mortgage-out"><p class="vh" id="o-live" aria-live="polite"></p>
<p class="big-label">${t('Maximale hypotheek (indicatief)', 'Maximum mortgage (indicative)')}</p><p class="big" id="o-total">${eur(ex.total, lang)}</p>
<div class="stack" id="o-stack" aria-hidden="true"><i class="inc" style="--w:${share(ex.onIncome)}%"></i><i class="lab" style="--w:${share(ex.labelExtra)}%"></i><i class="sav" style="--w:${share(ex.savingExtra)}%"></i></div>
<ul class="stack-key" aria-hidden="true"><li class="inc">${t('Inkomen', 'Income')}</li><li class="lab">${t('Energielabel', 'Energy label')}</li><li class="sav">${t('Energiebesparing', 'Energy saving')}</li></ul>
<dl class="facts small">
<div><dt>${t('Toetsrente', 'Test rate')}</dt><dd id="o-tr">${pct(ex.toetsrente, lang, 2)}</dd></div>
<div><dt>${t('Financieringslast (woonquote)', 'Housing-cost ratio (woonquote)')}</dt><dd id="o-fl">${pct(ex.financieringslastPct, lang, 1)}</dd></div>
<div><dt>${t('Maximale bruto maandlast', 'Maximum gross monthly cost')}</dt><dd id="o-month">${eur(ex.monthlyMax, lang)}</dd></div>
<div><dt>${t('Aftrek studieschuld per maand', 'Student-debt deduction per month')}</dt><dd id="o-debt">${eur(ex.studyDebtCharge, lang)}</dd></div>
<div><dt>${t('Op basis van inkomen', 'Based on income')}</dt><dd id="o-income">${eur(ex.onIncome, lang)}</dd></div>
<div><dt>${t('Extra voor energielabel', 'Extra for energy label')}</dt><dd id="o-label">${eur(ex.labelExtra, lang)}</dd></div>
<div><dt>${t('Extra voor energiebesparing', 'Extra for energy saving')}</dt><dd id="o-saving">${eur(ex.savingExtra, lang)}</dd></div>
</dl>
<p id="o-note" class="note">${t('De toetsrente is je eigen rente, omdat de rente 10 jaar of langer vastligt.', 'The test rate is your own rate, because it is fixed for 10 years or longer.')}</p>
<p id="o-nhg" class="note">${ex.withinNhg ? t(`Binnen de NHG-grens van ${eur(params.nhg.limit, lang)}.`, `Within the NHG limit of ${eur(params.nhg.limit, lang)}.`) : ''}</p>
<figure class="pay"><figcaption><span>${t('Bruto maandlast als je dit bedrag leent', 'Gross monthly payment if you borrow this amount')}</span><strong id="o-pay">${eur(sched.monthly, lang)}</strong></figcaption>
<div id="o-curve">${payCurve(sched, { tick: t('jr', 'yr') })}</div>
<ul class="pay-key" aria-hidden="true"><li class="rep">${t('Aflossing per jaar', 'Repayment per year')}</li><li class="int">${t('Rente per jaar', 'Interest per year')}</li></ul>
<p class="help" id="o-paynote">${payNote(defRate.O.rate, sched.totalInterest)}</p></figure>
<p class="nfa-inline">${t('Indicatief, geen advies. Een geldverstrekker of adviseur rekent met jouw volledige situatie.', 'Indicative, not advice. A lender or adviser calculates with your full situation.')}</p>
</div></div>
<noscript><p class="note">${t('De rekenhulp werkt met JavaScript. Zonder JavaScript zie je alleen de uitkomst voor de standaardinvoer hierboven.', 'The calculator needs JavaScript. Without it you only see the result for the default input above.')}</p></noscript>
<section class="prose" aria-labelledby="how-h"><h2 id="how-h">${t('Zo rekent deze rekenhulp', 'How this calculator works')}</h2>
<ol>
<li>${t(`<strong>Toetsrente.</strong> Ligt de rente korter dan 10 jaar vast, dan rekenen we met minimaal ${rulePct(a.minToetsrente, lang)}. Bij 10 jaar of langer rekenen we met de rente die je invult.`, `<strong>Test rate.</strong> If the rate is fixed for less than 10 years, we use at least ${rulePct(a.minToetsrente, lang)}. For 10 years or longer we use the rate you enter.`)}</li>
<li>${t(`<strong>Financieringslast.</strong> Bij je inkomen en de toetsrente hoort een percentage uit tabel 1 (of tabel 2 vanaf de AOW-leeftijd) van de Trhk ${params.year}. Inkomens boven de hoogste rij (${eur(a.flTableBelowAOW.at(-1)[0], lang)}) gebruiken die rij.`, `<strong>Housing-cost ratio.</strong> Your income and the test rate give a percentage from table 1 (or table 2 from AOW age) of the Trhk ${params.year}. Incomes above the top row (${eur(a.flTableBelowAOW.at(-1)[0], lang)}) use that row.`)}</li>
<li>${t('<strong>Maximale maandlast.</strong> Inkomen × percentage ÷ 12.', '<strong>Maximum monthly cost.</strong> Income × percentage ÷ 12.')}</li>
<li>${t('<strong>Studieschuld.</strong> Het maandbedrag aan DUO gaat eraf, vermenigvuldigd met de bruteringsfactor uit de Trhk (afhankelijk van de toetsrente).', '<strong>Student debt.</strong> The monthly DUO payment is deducted, multiplied by the gross-up factor from the Trhk (which depends on the test rate).')}</li>
<li>${t(`<strong>Hypotheekbedrag.</strong> De resterende maandlast rekenen we om naar een annuïteitenhypotheek met een looptijd van ${a.termYears} jaar tegen de toetsrente.`, `<strong>Mortgage amount.</strong> We turn the remaining monthly cost into an annuity mortgage over ${a.termYears} years at the test rate.`)}</li>
<li>${t('<strong>Energielabel.</strong> Afhankelijk van het label mag je een vast bedrag extra lenen. Met energiebesparende maatregelen komt daar per label nog een bedrag bij. Bedragen uit de Trhk:', '<strong>Energy label.</strong> Depending on the label you may borrow a fixed extra amount. Energy-saving measures add another amount per label. Amounts from the Trhk:')}
<ul>${Object.keys(a.energyLabelExtra).map(k => `<li>${esc(labelOpt[k] || k)}: ${eur(a.energyLabelExtra[k], lang)}${a.energySavingExtra[k] != null ? t(`, met maatregelen nog ${eur(a.energySavingExtra[k], lang)}`, `, with measures another ${eur(a.energySavingExtra[k], lang)}`) : ''}</li>`).join('')}</ul></li>
<li>${t(`<strong>Woningwaarde.</strong> Vul je een woningwaarde in, dan is het deel op basis van inkomen maximaal ${pct(a.ltvMax * 100, lang, 0)} van die waarde.`, `<strong>Home value.</strong> If you enter a home value, the income-based part is capped at ${pct(a.ltvMax * 100, lang, 0)} of that value.`)}</li>
</ol>
<h3>${t('Rekenvoorbeeld', 'Worked example')}</h3>
<p>${t(`Toetsinkomen ${eur(46500, lang)} en toetsrente ${rulePct(5, lang)}: de tabel geeft ${pct(exSeh.financieringslastPct, lang, 1)}. De maximale maandlast is ${eur(exSeh.monthlyMax, lang)}, en de maximale hypotheek is ${eur(exSeh.total, lang)}.`, `Test income ${eur(46500, lang)} and test rate ${rulePct(5, lang)}: the table gives ${pct(exSeh.financieringslastPct, lang, 1)}. The maximum monthly cost is ${eur(exSeh.monthlyMax, lang)}, and the maximum mortgage is ${eur(exSeh.total, lang)}.`)}</p>
<h3>${t('Wat deze rekenhulp niet doet', 'What this calculator does not do')}</h3>
<ul>
<li>${t('Het rekent niet met andere schulden (zoals een autolening of creditcard), partneralimentatie of erfpacht.', 'It does not include other debts (such as a car loan or credit card), partner alimony or ground lease.')}</li>
<li>${t('Het bepaalt niet hoe een geldverstrekker je inkomen vaststelt (bijvoorbeeld bij een tijdelijk contract of als ondernemer).', 'It does not decide how a lender assesses your income (for example with a temporary contract or when self-employed).')}</li>
<li>${t('Het geeft geen advies en vergelijkt geen producten.', 'It gives no advice and compares no products.')}</li>
</ul>
<h3>${t('Standaardrente per rentevaste periode', 'Default rate by fixed period')}</h3>
<p>${t(`Gemiddelde rente op nieuwe woninghypotheken in Nederland in ${monthLong(rateMonth, lang)} (ECB/DNB): ${ratesNote}. Zie ook <a href="${u(L('rates'))}">hypotheekrente</a>.`, `Average rate on new Dutch home loans in ${monthLong(rateMonth, lang)} (ECB/DNB): ${ratesNote}. See also <a href="${u(L('rates'))}">mortgage rates</a>.`)}</p>
<p>${t(`Daarna: <a href="${u(L('costs'))}">bereken de kosten koper</a>.`, `Next: <a href="${u(L('costs'))}">calculate the buying costs</a>.`)}</p>
</section>
${adSlot('advisor', lang, r)}
</div>${jsonData('calcdata', data)}`;
    page({ lang, route: r, title: t(`Maximale hypotheek berekenen ${params.year}`, 'Mortgage calculator Netherlands: how much can I borrow?'),
      desc: t(`Bereken je maximale hypotheek met de financieringslasttabellen ${params.year}, toetsrente, studieschuld en energielabel. Elke aanname uitgelegd. Indicatief, geen advies.`, `How much can you borrow in the Netherlands? Uses the ${params.year} lending tables, test rate, student debt and energy label. Every assumption explained. Indicative, not advice.`),
      body, sources: ['trhk', 'trhk_wet', 'nibud', 'nhg', 'ecb'], crumbs: [[t('Maximale hypotheek', 'Mortgage calculator'), r[lang]]], cls: 'toolpage',
      schema: [webApp({ lang, route: r, name: t('Maximale hypotheek berekenen', 'Mortgage calculator Netherlands'), description: t(`Indicatieve maximale hypotheek op basis van de Trhk ${params.year}.`, `Indicative maximum mortgage based on the Dutch Trhk ${params.year}.`) })],
      scripts: `<script type="module" src="${BASE}/js/mortgage.js"></script>` });
  }

  // ---------------- buying costs calculator
  {
    const r = ROUTES.costs, tt = params.transferTax;
    const defPrice = nat.price;
    const ex = buyingCosts({ price: defPrice, mortgage: defPrice, use: 'own', age: null, nhg: true }, params);
    const extras = [['notary', t('Notaris (akte van levering en hypotheekakte)', 'Notary (transfer deed and mortgage deed)'), t('Notaris', 'Notary')], ['valuation', t('Taxatie', 'Valuation'), t('Taxatie', 'Valuation')], ['advice', t('Hypotheekadvies en bemiddeling', 'Mortgage advice and arrangement'), t('Advies', 'Advice')], ['guarantee', t('Bankgarantie', 'Bank guarantee'), t('Bankgarantie', 'Bank guarantee')], ['other', t('Overig (bijv. aankoopmakelaar, bouwkundige keuring)', 'Other (e.g. buying agent, building survey)'), t('Overig', 'Other')]];
    const reason = { starter: t('Startersvrijstelling: 0%.', 'First-time buyer exemption: 0%.'), own: t(`Eigen woning: ${rulePct(tt.ownHome, lang)}.`, `Own home: ${rulePct(tt.ownHome, lang)}.`), notMain: t(`Geen hoofdverblijf: ${rulePct(tt.notMainResidence, lang)}.`, `Not a main residence: ${rulePct(tt.notMainResidence, lang)}.`), other: t(`Overig vastgoed: ${rulePct(tt.other, lang)}.`, `Other property: ${rulePct(tt.other, lang)}.`) };
    const data = { lang, params: { transferTax: tt, nhg: params.nhg }, i18n: { reason,
      fail: { age: t(`leeftijd niet ${tt.starterAge[0]} tot ${tt.starterAge[1]} jaar`, `age not ${tt.starterAge[0]} to under ${tt.starterAge[1]}`), firstTime: t('vrijstelling al eerder gebruikt', 'exemption used before'), price: t(`koopsom boven ${eur(tt.starterMaxValue, lang)}`, `price above ${eur(tt.starterMaxValue, lang)}`) },
      noStarter: t('Geen startersvrijstelling', 'No first-time buyer exemption'), nhgOk: t('NHG mogelijk: lening binnen de grens van', 'NHG possible: loan within the limit of'), nhgNo: t('Geen NHG: lening boven de grens van', 'No NHG: loan above the limit of'), nhgOff: t('Geen NHG gekozen.', 'NHG not selected.'), extrasEmpty: t('Nog niet ingevuld. Vraag offertes op en vul de bedragen in.', 'Not filled in yet. Ask for quotes and enter the amounts.'), ofPrice: t('van de koopsom', 'of the price') } };
    const parts = [{ k: 'tax', v: ex.tax.amount }, { k: 'nhg', v: ex.nhg?.fee ?? 0 }, ...extras.map(([k]) => ({ k, v: 0 }))];
    const body = `<div class="wrap">
<div class="tool-head"><h1>${t('Kosten koper berekenen', 'Buying costs calculator (kosten koper)')}</h1>
<p class="lead">${t(`Bereken de overdrachtsbelasting, de startersvrijstelling en de NHG-kosten volgens de regels van ${params.year}. Kosten die per aanbieder verschillen, zoals notaris en taxatie, vul je zelf in uit je offertes.`, `Calculate the transfer tax, the first-time buyer exemption and the NHG fee under the ${params.year} rules. Costs that differ per provider, such as notary and valuation, you enter yourself from your quotes.`)}</p></div>
<div class="calc">
<form id="costs" class="calc-form" onsubmit="return false">
${field({ id: 'price', label: t('Koopsom (€)', 'Purchase price (€)'), value: defPrice, step: 1000, pre: '€', range: [50000, 1500000, 1000], help: t(`Standaard: gemiddelde verkoopprijs in Nederland in ${Y} (CBS). Vul je eigen koopsom in.`, `Default: average sale price in the Netherlands in ${Y} (CBS). Enter your own price.`) })}
<fieldset class="f seg-f"><legend>${t('Gebruik van de woning', 'Use of the home')}</legend><div class="seg seg-use">
<label><input type="radio" name="use" value="own" checked><span>${t('Ik ga er zelf wonen (hoofdverblijf)', 'I will live there (main residence)')}</span></label>
<label><input type="radio" name="use" value="notMain"><span>${t('Geen hoofdverblijf (bijv. verhuur of tweede woning)', 'Not my main residence (e.g. to let or a second home)')}</span></label>
<label><input type="radio" name="use" value="other"><span>${t('Ander vastgoed (geen woning)', 'Other property (not a home)')}</span></label></div></fieldset>
${field({ id: 'age', label: t('Je leeftijd bij de overdracht', 'Your age at transfer'), max: 120, step: 1, placeholder: t('Voor de startersvrijstelling', 'For the starter exemption') })}
${toggle('used', t('Ik heb de startersvrijstelling al eerder gebruikt', 'I have used the first-time buyer exemption before'))}
${field({ id: 'mortgage-amt', name: 'mortgage', label: t('Hypotheekbedrag (€)', 'Mortgage amount (€)'), value: defPrice, step: 1000, pre: '€', range: [0, 1500000, 1000], help: t('Standaard gelijk aan de koopsom. Pas aan.', 'Defaults to the purchase price. Adjust it.') })}
${toggle('nhg', t('Ik wil een hypotheek met NHG', 'I want a mortgage with NHG'), true)}
${toggle('ebv', t('Met energiebesparende maatregelen (hogere NHG-grens)', 'With energy-saving measures (higher NHG limit)'))}
<fieldset class="f quotes"><legend>${t('Kosten uit je offertes (€)', 'Costs from your quotes (€)')}</legend>
<p class="help">${t('Deze kosten zijn marktprijzen en staan niet in de wet. Wij vullen geen bedrag voor je in.', 'These are market prices and are not set by law. We do not fill in an amount for you.')}</p>
${extras.map(([k, l]) => `<div class="q q-${k}"><label class="sub" for="x-${k}">${esc(l)}</label><div class="inp has-pre"><span class="pre" aria-hidden="true">€</span><input id="x-${k}" name="${k}" type="number" inputmode="numeric" min="0" step="50" placeholder="0"></div></div>`).join('')}</fieldset>
</form>
<a class="calc-peek" href="#costs-out" aria-hidden="true" tabindex="-1"><span>${t('Kosten koper', 'Buying costs')}</span><strong id="k-peek">${eur(ex.total, lang)}</strong></a>
<div class="calc-out" id="costs-out"><p class="vh" id="k-live" aria-live="polite"></p>
<p class="big-label">${t('Kosten koper (indicatief)', 'Buying costs (indicative)')}</p><p class="big" id="k-total">${eur(ex.total, lang)}</p>
<div class="donut-wrap"><div id="k-donut">${donut(parts)}</div><p class="donut-c" id="k-pct">${t(`${pct(ex.pctOfPrice, lang, 1)} van de koopsom`, `${pct(ex.pctOfPrice, lang, 1)} of the price`)}</p></div>
<dl class="facts small dkey">
<div class="tax"><dt>${t('Overdrachtsbelasting', 'Transfer tax')}</dt><dd id="k-tax">${eur(ex.tax.amount, lang)}</dd></div>
<div class="nhg"><dt>${t('NHG-kosten', 'NHG fee')}</dt><dd id="k-nhg">${eur(ex.nhg?.fee ?? 0, lang)}</dd></div>
${extras.map(([k, , s]) => `<div class="${k} sub"><dt>${esc(s)}</dt><dd id="k-x-${k}">${eur(0, lang)}</dd></div>`).join('')}
<div class="sum"><dt>${t('Kosten uit offertes', 'Costs from quotes')}</dt><dd id="k-extras">${eur(0, lang)}</dd></div>
</dl>
<p class="note" id="k-reason">${esc(reason[ex.tax.reason])}</p>
<p class="note" id="k-nhgnote">${ex.nhg?.eligible ? '' : t(`Geen NHG: lening boven de grens van ${eur(params.nhg.limit, lang)}.`, `No NHG: loan above the limit of ${eur(params.nhg.limit, lang)}.`)}</p>
<p class="note" id="k-extrasnote">${t('Nog niet ingevuld. Vraag offertes op en vul de bedragen in.', 'Not filled in yet. Ask for quotes and enter the amounts.')}</p>
<p class="nfa-inline">${t('Indicatief, geen advies. De notaris berekent de definitieve overdrachtsbelasting.', 'Indicative, not advice. The notary calculates the final transfer tax.')}</p>
</div></div>
<section class="prose" aria-labelledby="rules-h"><h2 id="rules-h">${t(`De regels in ${params.year}`, `The rules in ${params.year}`)}</h2>
<ul>
<li>${t(`<strong>Overdrachtsbelasting eigen woning:</strong> ${rulePct(tt.ownHome, lang)} van de koopsom, als je er zelf gaat wonen.`, `<strong>Transfer tax on your own home:</strong> ${rulePct(tt.ownHome, lang)} of the price, if you will live there.`)}</li>
<li>${t(`<strong>Startersvrijstelling:</strong> ${rulePct(tt.starter, lang)} als je ${tt.starterAge[0]} jaar of ouder en jonger dan ${tt.starterAge[1]} bent, de vrijstelling nog niet eerder hebt gebruikt, er zelf gaat wonen en de koopsom niet hoger is dan ${eur(tt.starterMaxValue, lang)}. Is de koopsom hoger, dan betaal je ${rulePct(tt.ownHome, lang)} over het hele bedrag.`, `<strong>First-time buyer exemption:</strong> ${rulePct(tt.starter, lang)} if you are ${tt.starterAge[0]} or older and younger than ${tt.starterAge[1]}, have not used the exemption before, will live in the home and the price is not above ${eur(tt.starterMaxValue, lang)}. Above that, you pay ${rulePct(tt.ownHome, lang)} on the whole amount.`)}</li>
<li>${t(`<strong>Geen hoofdverblijf:</strong> ${rulePct(tt.notMainResidence, lang)}. <strong>Ander vastgoed:</strong> ${rulePct(tt.other, lang)}.`, `<strong>Not a main residence:</strong> ${rulePct(tt.notMainResidence, lang)}. <strong>Other property:</strong> ${rulePct(tt.other, lang)}.`)}</li>
<li>${t(`<strong>NHG:</strong> de borgtochtprovisie is ${rulePct(params.nhg.feePct, lang)} van het hypotheekbedrag. De lening mag niet hoger zijn dan ${eur(params.nhg.limit, lang)}, of ${eur(params.nhg.limitWithEBV, lang)} met energiebesparende maatregelen.`, `<strong>NHG:</strong> the guarantee fee is ${rulePct(params.nhg.feePct, lang)} of the mortgage amount. The loan may not exceed ${eur(params.nhg.limit, lang)}, or ${eur(params.nhg.limitWithEBV, lang)} with energy-saving measures.`)}</li>
<li>${t('<strong>Notaris, taxatie, advies en bankgarantie:</strong> marktprijzen. Er is geen officiële bron voor een vast bedrag, dus vul je de bedragen uit je offertes in.', '<strong>Notary, valuation, advice and bank guarantee:</strong> market prices. No official source sets a fixed amount, so you enter the amounts from your quotes.')}</li>
</ul>
<h3>${t('Rekenvoorbeeld', 'Worked example')}</h3>
<p>${t(`Koopsom ${eur(defPrice, lang)} (het landelijke gemiddelde in ${Y}), eigen woning, geen starter: overdrachtsbelasting ${eur(transferTax({ price: defPrice, use: 'own' }, params).amount, lang)}. ${nhgFee(defPrice, {}, params).eligible ? `NHG-kosten ${eur(nhgFee(defPrice, {}, params).fee, lang)}.` : `NHG is niet mogelijk: het bedrag ligt boven de grens van ${eur(params.nhg.limit, lang)}.`} Een starter die aan alle voorwaarden voldoet, betaalt ${defPrice <= tt.starterMaxValue ? eur(0, lang) + ' overdrachtsbelasting' : 'toch ' + rulePct(tt.ownHome, lang)}.`,
  `Price ${eur(defPrice, lang)} (the national average in ${Y}), own home, not a first-time buyer: transfer tax ${eur(transferTax({ price: defPrice, use: 'own' }, params).amount, lang)}. ${nhgFee(defPrice, {}, params).eligible ? `NHG fee ${eur(nhgFee(defPrice, {}, params).fee, lang)}.` : `NHG is not possible: the amount is above the limit of ${eur(params.nhg.limit, lang)}.`} A first-time buyer who meets every condition pays ${defPrice <= tt.starterMaxValue ? eur(0, lang) + ' transfer tax' : rulePct(tt.ownHome, lang) + ' all the same'}.`)}</p>
<p>${t(`Lees meer in de gids <a href="${u(guideRoute('nl', 'kosten-koper'))}">kosten koper</a>, of <a href="${u(L('mortgage'))}">bereken je maximale hypotheek</a>.`, `Read more in the guide <a href="${u(guideRoute('en', 'buying-costs-netherlands'))}">buying costs in the Netherlands</a>, or <a href="${u(L('mortgage'))}">calculate your maximum mortgage</a>.`)}</p>
</section>
<div class="ads">${adSlot('coolblue', lang, r)}${adSlot('overstappen', lang, r)}</div>
</div>${jsonData('calcdata', data)}`;
    page({ lang, route: r, title: t(`Kosten koper berekenen ${params.year}`, 'Buying costs calculator Netherlands (kosten koper)'),
      desc: t(`Bereken de kosten koper: overdrachtsbelasting (${rulePct(tt.ownHome, lang)}, startersvrijstelling tot ${eur(tt.starterMaxValue, lang)}), NHG-kosten en je eigen offertes. Regels ${params.year}, indicatief.`, `Calculate Dutch buying costs: transfer tax (${rulePct(tt.ownHome, lang)}, first-time buyer exemption up to ${eur(tt.starterMaxValue, lang)}), NHG fee and your own quotes. ${params.year} rules, indicative.`),
      body, sources: ['obtarief', 'starter', 'wbr', 'nhg', '83625NED'], crumbs: [[t('Kosten koper', 'Buying costs'), r[lang]]], cls: 'toolpage',
      schema: [webApp({ lang, route: r, name: t('Kosten koper berekenen', 'Buying costs calculator Netherlands'), description: t(`Indicatieve kosten koper volgens de regels van ${params.year}.`, `Indicative Dutch buying costs under the ${params.year} rules.`) })],
      scripts: `<script type="module" src="${BASE}/js/costs.js"></script>` });
  }

  // ---------------- mortgage rates hub, terms, forecast
  const rateChart = (keys, title, from = 0) => lineChart({ series: keys.map(k => ({ name: series[k].label[lang], points: series[k].data.slice(from).map(d => [d.month, d.rate]), cls: k === 'A' ? 'muted2' : '' })), fmtY: v => pct(v, lang, 1), fmtV: v => pct(v, lang, 2), title, xEvery: 24, fmtX: m => m.slice(0, 4), fmtXTip: m => monthLong(m, lang), zero: true, area: keys.length === 1 || keys[1] === 'A' });
  // Rate tiles: latest month, change vs a year earlier, 24-month sparkline.
  const rateTiles = keys => `<dl class="stats rate-tiles">${keys.map(k => { const l = lastObs(k), y = obsMonthsBack(k, 12), d = y ? l.rate - y.rate : null; return `<div class="stat"><dt>${esc(series[k].label[lang])}</dt><dd class="stat-v"><span data-count="${l.rate}" data-f="pct2">${pct(l.rate, lang, 2)}</span></dd><dd class="stat-sub">${d == null ? NA[lang] : esc(`${d >= 0 ? '+' : ''}${num(d, lang, 2)}${t(' %-punt in een jaar', ' pp in a year')}`)}</dd><dd class="stat-sp">${spark(series[k].data.filter(x => x.rate != null).slice(-24).map(x => x.rate))}</dd></div>`; }).join('')}</dl>`;
  const rateRows = keys => keys.map(k => { const l = lastObs(k), y = obsMonthsBack(k, 12); return `<tr><th scope="row">${esc(series[k].label[lang])}</th><td class="n">${pct(l.rate, lang, 2)}</td><td class="n">${y ? pct(y.rate, lang, 2) : NA[lang]}</td><td class="n">${y ? (l.rate - y.rate >= 0 ? '+' : '') + num(l.rate - y.rate, lang, 2) + t(' %-punt', ' pp') : NA[lang]}</td></tr>`; }).join('');
  const rateTable = keys => `<div class="scroll"><table><thead><tr><th scope="col">${t('Rentevaste periode', 'Fixed period')}</th><th scope="col" class="n">${esc(monthShort(rateMonth, lang))}</th><th scope="col" class="n">${t('Een jaar eerder', 'A year earlier')}</th><th scope="col" class="n">${t('Verschil', 'Difference')}</th></tr></thead><tbody>${rateRows(keys)}</tbody></table></div>`;
  const rateDataset = (lang, r, bucket = null) => ({ ...dataset({ lang, route: r, name: bucket ? t(`Gemiddelde hypotheekrente ${bucket}`, `Average mortgage rate ${bucket}`) : t('Gemiddelde hypotheekrente Nederland', 'Average mortgage rates Netherlands'), description: t('Gemiddelde rente op nieuwe woninghypotheken in Nederland per rentevaste periode, maandcijfers van DNB via het ECB Data Portal.', 'Average interest rate on new Dutch home loans by fixed period, monthly figures from DNB via the ECB Data Portal.'), tables: [], temporal: `${series.A.data[0].month}/${rateMonth}` }),
    creator: { '@type': 'Organization', name: 'De Nederlandsche Bank / European Central Bank' }, license: rates.source.url, isBasedOn: [rates.source.url, rates.source.dnb], dateModified: ratesDate });
  const labelsOrder = ['A++++', 'A+++', 'A++', 'A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const lenderTable = (opts = {}) => { const live = lenders.lenders.filter(l => l.ratesByEnergyLabel), pend = lenders.lenders.filter(l => !l.ratesByEnergyLabel);
    return `<div class="scroll"><table class="lenders"><caption>${t('Tarieven zoals gepubliceerd op de eigen rentepagina van de geldverstrekker. Geen advies.', "Rates as published on the lender's own rate page. Not advice.")}</caption><thead><tr><th scope="col">${t('Geldverstrekker en product', 'Lender and product')}</th>${labelsOrder.map(l => `<th scope="col" class="n">${l}</th>`).join('')}<th scope="col">${t('Bron en datum', 'Source and date')}</th></tr></thead><tbody>
${live.map(l => `<tr><th scope="row">${esc(l.name)}<span class="x">${esc(l.product)}</span></th>${labelsOrder.map(k => `<td class="n">${l.ratesByEnergyLabel[k] != null ? pct(l.ratesByEnergyLabel[k], lang, 2) : '–'}</td>`).join('')}<td><a href="${esc(l.source)}" rel="noopener nofollow">${t('rentepagina', 'rate page')}</a>, ${t('gecontroleerd', 'checked')} ${time(l.checked, lang)}</td></tr>`).join('')}
${pend.map(l => `<tr class="pending"><th scope="row">${esc(l.name)}</th><td colspan="${labelsOrder.length + 1}">${t('Nog niet opgenomen: we controleren eerst de gebruiksvoorwaarden van de rentepagina. Geen tarief getoond.', 'Not included yet: we first check the terms of use of the rate page. No rate shown.')}</td></tr>`).join('')}
</tbody></table></div><p class="note">${t('Volgorde: geldverstrekkers met een gecontroleerd tarief eerst, daarna alfabetisch zoals aangeleverd. Rentes zijn de tarieven voor het genoemde product en de genoemde voorwaarden; jouw rente kan anders zijn. Deze tabel bevat geen advertenties en geen affiliate-links.', 'Order: lenders with a checked rate first, then as listed. Rates apply to the product and conditions named; your rate may differ. This table contains no advertising and no affiliate links.')}</p>`; };
  {
    const r = ROUTES.rates;
    const body = `<section class="band"><div class="wrap">
<h1>${t('Hypotheekrente in Nederland', 'Mortgage rates in the Netherlands')}</h1>
<p class="lead">${t(`De gemiddelde rente op nieuwe woninghypotheken was ${pct(lastObs('A').rate, lang, 2)} in ${monthLong(rateMonth, lang)} (alle rentevaste perioden). Dit zijn gemiddelden van banken, gemeten door DNB en gepubliceerd door de ECB. Het zijn geen actuele aanbiedingen.`, `The average rate on new home loans was ${pct(lastObs('A').rate, lang, 2)} in ${monthLong(rateMonth, lang)} (all fixed periods). These are bank averages, measured by DNB and published by the ECB. They are not current offers.`)}</p>
<p class="stamp">${t(`Laatste maand in de ECB-statistiek: ${esc(monthLong(rateMonth, lang))} (opgehaald ${time(rates.fetchedAt, lang)})`, `Latest month in the ECB statistics: ${esc(monthLong(rateMonth, lang))} (fetched ${time(rates.fetchedAt, lang)})`)}</p>
${rateTiles([...SERIES_ORDER, 'A'])}
</div></section>
<div class="wrap">
<section aria-labelledby="avg-h"><h2 id="avg-h">${t('Gemiddelde rente per rentevaste periode', 'Average rate by fixed period')}</h2>
${rateChart(SERIES_ORDER, t('Gemiddelde hypotheekrente per rentevaste periode, laatste 10 jaar', 'Average mortgage rate by fixed period, last 10 years'))}
${rateTable([...SERIES_ORDER, 'A'])}
<ul class="chips links-chips">${TERMS.map(x => `<li><a class="chip" href="${u(termRoute(x.years)[lang])}">${t(`Hypotheekrente ${x.years} jaar vast`, `${x.years}-year fixed rate`)}</a></li>`).join('')}<li><a class="chip" href="${u(L('forecast'))}">${t('Hypotheekrente: verwachting en historie', 'Mortgage rates: forecast and history')}</a></li></ul></section>
<section aria-labelledby="lend-h"><h2 id="lend-h">${t('Tarieven van geldverstrekkers', 'Lender rates')}</h2>
<p>${t('We nemen tarieven alleen over van de eigen rentepagina van een geldverstrekker, met link en datum. We scrapen geen sites. Een geldverstrekker staat er pas met een tarief als we de gebruiksvoorwaarden hebben gecontroleerd.', "We copy rates only from a lender's own rate page, with a link and date. We do not scrape sites. A lender shows a rate only after we have checked the terms of use.")}</p>
${lenderTable()}</section>
<section class="prose" aria-labelledby="why-h"><h2 id="why-h">${t('Waarom het gemiddelde afwijkt van je offerte', 'Why the average differs from your offer')}</h2>
<ul><li>${t('Het gemiddelde gaat over alle nieuwe leningen in een maand, met en zonder NHG en bij elke verhouding tussen lening en woningwaarde.', 'The average covers all new loans in a month, with and without NHG and at every loan-to-value ratio.')}</li>
<li>${t('Het cijfer komt met vertraging: de laatste maand ligt altijd enkele weken in het verleden.', 'The figure has a lag: the latest month is always a few weeks in the past.')}</li>
<li>${t('Energielabel, NHG en de hoogte van de lening beïnvloeden je eigen rente.', 'Energy label, NHG and the loan amount affect your own rate.')}</li></ul>
<p>${t('Grote banken zoals ABN AMRO, Rabobank, ING en de Volksbank publiceren hun tarieven op hun eigen sites. Wij geven geen advies over een geldverstrekker of product.', 'Major banks such as ABN AMRO, Rabobank, ING and de Volksbank publish their rates on their own sites. We do not give advice about any lender or product.')}</p></section>
<p class="nfa-inline"><strong>${t('Geen advies.', 'Not advice.')}</strong> ${t('Deze pagina vergelijkt geen producten en bemiddelt niet.', 'This page does not compare products and does not arrange loans.')}</p>
</div>`;
    page({ lang, route: r, title: t('Hypotheekrente: gemiddelde per rentevaste periode', 'Mortgage rates Netherlands: averages by fixed period'),
      desc: t(`Gemiddelde hypotheekrente in Nederland in ${monthLong(rateMonth, lang)}: ${pct(lastObs('A').rate, lang, 2)}. Per rentevaste periode, 10 jaar historie (ECB/DNB) en gecontroleerde tarieven met bron en datum. Geen advies.`, `Average Dutch mortgage rate in ${monthLong(rateMonth, lang)}: ${pct(lastObs('A').rate, lang, 2)}. By fixed period, 10-year history (ECB/DNB) and checked lender rates with source and date. Not advice.`),
      body, sources: ['ecb', 'lenders'], crumbs: [[t('Hypotheekrente', 'Mortgage rates'), r[lang]]], cls: 'has-band',
      schema: [rateDataset(lang, r)] });
  }
  for (const term of TERMS) {
    const r = termRoute(term.years), k = term.series, l = lastObs(k), y = obsMonthsBack(k, 12);
    const ys = series[k].data.filter(d => d.rate != null), lo = ys.reduce((a, b) => b.rate < a.rate ? b : a), hi = ys.reduce((a, b) => b.rate > a.rate ? b : a);
    const bucket = series[k].label[lang];
    const show10 = term.years === 10;
    const body = `<section class="band"><div class="wrap">
<h1>${t(`Hypotheekrente ${term.years} jaar vast`, `${term.years}-year fixed mortgage rate in the Netherlands`)}</h1>
<p class="lead">${t(`De ECB/DNB-statistiek kent geen aparte reeks voor ${term.years} jaar vast. De dichtstbijzijnde reeks is <strong>${esc(bucket)}</strong>. Daarin was de gemiddelde rente op nieuwe hypotheken ${pct(l.rate, lang, 2)} in ${monthLong(l.month, lang)}.`, `The ECB/DNB statistics have no separate series for ${term.years} years fixed. The closest series is <strong>${esc(bucket)}</strong>. In that series the average rate on new mortgages was ${pct(l.rate, lang, 2)} in ${monthLong(l.month, lang)}.`)}</p>
<p class="stamp">${t(`Laatste maand in de ECB-statistiek: ${esc(monthLong(rateMonth, lang))} (opgehaald ${time(rates.fetchedAt, lang)})`, `Latest month in the ECB statistics: ${esc(monthLong(rateMonth, lang))} (fetched ${time(rates.fetchedAt, lang)})`)}</p>
${statBand([[monthLong(l.month, lang), pct(l.rate, lang, 2), l.rate, 'pct2', esc(bucket)], [t('Een jaar eerder', 'A year earlier'), pct(y.rate, lang, 2), y.rate, 'pct2', esc(monthLong(y.month, lang))], [t('Laagste maand in de reeks', 'Lowest month in the series'), pct(lo.rate, lang, 2), lo.rate, 'pct2', esc(monthLong(lo.month, lang))], [t('Hoogste maand in de reeks', 'Highest month in the series'), pct(hi.rate, lang, 2), hi.rate, 'pct2', esc(monthLong(hi.month, lang))]])}
</div></section>
<div class="wrap">
<section aria-labelledby="ch-h"><h2 id="ch-h">${t('Ontwikkeling', 'Trend')}</h2>
${rateChart([k, 'A'], t(`Gemiddelde hypotheekrente, ${bucket} en alle looptijden`, `Average mortgage rate, ${bucket} and all fixed periods`))}
${chartTable({ summary: t('Jaargemiddelden', 'Yearly averages'), head: [t('Jaar', 'Year'), bucket, t('Maanden in de data', 'Months in the data')], rows: yearlyAverages(series[k].data).map(x => [String(x.year), pct(x.avg, lang, 2), String(x.months)]) })}</section>
<section class="prose" aria-labelledby="map-h"><h2 id="map-h">${t('Hoe we de looptijden indelen', 'How we map fixed periods')}</h2>
<ul><li>${t('5 jaar vast → reeks “1–5 jaar vast”', '5 years fixed → series “1–5 years fixed”')}</li><li>${t('10 jaar vast → reeks “5–10 jaar vast”', '10 years fixed → series “5–10 years fixed”')}</li><li>${t('20 en 30 jaar vast → reeks “meer dan 10 jaar vast”', '20 and 30 years fixed → series “over 10 years fixed”')}</li></ul>
<p>${t('Een reeks is een gemiddelde over alle leningen in die groep. Voor 20 en 30 jaar vast is het dus hetzelfde cijfer.', 'A series is an average over all loans in that group. For 20 and 30 years fixed it is the same figure.')}</p></section>
<section aria-labelledby="lend-h"><h2 id="lend-h">${t('Tarieven van geldverstrekkers', 'Lender rates')}</h2>
${show10 ? lenderTable() : `<p>${t(`We hebben nog geen gecontroleerde tarieven van geldverstrekkers voor ${term.years} jaar vast. Zie de <a href="${u(L('rates'))}">hypotheekrente-pagina</a> voor de tarieven die we wel hebben.`, `We have no checked lender rates for ${term.years} years fixed yet. See the <a href="${u(L('rates'))}">mortgage rates page</a> for the rates we do have.`)}</p>`}</section>
<ul class="chips links-chips">${TERMS.filter(x => x !== term).map(x => `<li><a class="chip" href="${u(termRoute(x.years)[lang])}">${t(`${x.years} jaar vast`, `${x.years} years fixed`)}</a></li>`).join('')}<li><a class="chip" href="${u(L('rates'))}">${t('Alle rentevaste perioden', 'All fixed periods')}</a></li><li><a class="chip" href="${u(L('mortgage'))}">${t('Maximale hypotheek berekenen', 'Mortgage calculator')}</a></li></ul>
<p class="nfa-inline"><strong>${t('Geen advies.', 'Not advice.')}</strong> ${t('Gemiddelden zijn geen aanbod.', 'Averages are not offers.')}</p>
</div>`;
    page({ lang, route: r, title: t(`Hypotheekrente ${term.years} jaar vast: gemiddelde en trend`, `${term.years}-year fixed mortgage rate Netherlands: average and trend`),
      desc: t(`Hypotheekrente ${term.years} jaar vast: gemiddeld ${pct(l.rate, lang, 2)} in ${monthLong(l.month, lang)} (reeks ${bucket}, ECB/DNB). Ontwikkeling sinds ${series[k].data[0].month.slice(0, 4)}, laagste en hoogste maand. Geen advies.`, `${term.years}-year fixed mortgage rate: average ${pct(l.rate, lang, 2)} in ${monthLong(l.month, lang)} (series ${bucket}, ECB/DNB). Trend since ${series[k].data[0].month.slice(0, 4)}, lowest and highest month. Not advice.`),
      body, cls: 'has-band', sources: show10 ? ['ecb', 'lenders'] : ['ecb'], schema: [rateDataset(lang, r, bucket)], crumbs: [[t('Hypotheekrente', 'Mortgage rates'), ROUTES.rates[lang]], [t(`${term.years} jaar vast`, `${term.years} years fixed`), r[lang]]] });
  }
  {
    const r = ROUTES.forecast;
    const yrs = yearlyAverages(series.A.data);
    const body = `<section class="band"><div class="wrap">
<h1>${t('Hypotheekrente: verwachting en historie', 'Dutch mortgage rates: forecast and history')}</h1>
<p class="lead">${t('Wij publiceren geen renteverwachting. Niemand kan de rente betrouwbaar voorspellen. Op deze pagina staat wat de officiële cijfers laten zien over de afgelopen 10 jaar.', 'We do not publish a rate forecast. Nobody can predict rates reliably. This page shows what the official figures say about the past 10 years.')}</p>
<p class="stamp">${t(`Laatste maand in de ECB-statistiek: ${esc(monthLong(rateMonth, lang))} (opgehaald ${time(rates.fetchedAt, lang)})`, `Latest month in the ECB statistics: ${esc(monthLong(rateMonth, lang))} (fetched ${time(rates.fetchedAt, lang)})`)}</p>
${rateTiles([...SERIES_ORDER])}
</div></section>
<div class="wrap">
<section aria-labelledby="h-h"><h2 id="h-h">${t('Historie', 'History')}</h2>
${rateChart([...SERIES_ORDER], t('Gemiddelde hypotheekrente per rentevaste periode', 'Average mortgage rate by fixed period'))}
<div class="scroll"><table><thead><tr><th scope="col">${t('Jaar', 'Year')}</th>${SERIES_ORDER.map(k => `<th scope="col" class="n">${esc(series[k].label[lang])}</th>`).join('')}<th scope="col" class="n">${esc(series.A.label[lang])}</th><th scope="col" class="n">${t('Maanden', 'Months')}</th></tr></thead><tbody>
${yrs.map(x => `<tr><th scope="row">${x.year}</th>${[...SERIES_ORDER, 'A'].map(k => { const a = yearlyAverages(series[k].data).find(z => z.year === x.year); return `<td class="n">${a ? pct(a.avg, lang, 2) : NA[lang]}</td>`; }).join('')}<td class="n">${x.months}</td></tr>`).join('')}</tbody></table></div>
<p class="note">${t('Jaren met minder dan 12 maanden zijn gemiddelden over de beschikbare maanden.', 'Years with fewer than 12 months average the months available.')}</p></section>
<section class="prose" aria-labelledby="d-h"><h2 id="d-h">${t('Waar de hypotheekrente van afhangt', 'What drives mortgage rates')}</h2>
<ul><li>${t('<strong>Rente op de kapitaalmarkt.</strong> Banken financieren lange leningen met geld dat ze voor lange tijd lenen. Die rente (onder meer de swaprente) beweegt mee met verwachtingen over inflatie en economie.', '<strong>Capital market rates.</strong> Banks fund long loans with money they borrow for a long time. That rate (including swap rates) moves with expectations about inflation and the economy.')}</li>
<li>${t('<strong>Beleid van de ECB.</strong> De beleidsrente werkt vooral door in korte rentes, zoals variabele hypotheekrente.', '<strong>ECB policy.</strong> The policy rate mostly affects short rates, such as variable mortgage rates.')}</li>
<li>${t('<strong>Concurrentie en risico.</strong> Opslagen van banken verschillen per periode, per NHG-status en per verhouding tussen lening en woningwaarde.', '<strong>Competition and risk.</strong> Bank margins differ by period, NHG status and loan-to-value ratio.')}</li></ul>
<p>${t('Wil je verwachtingen lezen, kijk dan bij de bron: publicaties van DNB, de ECB en de economische afdelingen van banken. Die vermelden hun aannames.', 'For forecasts, read the source: publications by DNB, the ECB and the economics teams of banks. They state their assumptions.')} <a href="${esc(rates.source.dnb)}" rel="noopener">${t('DNB: hypotheekrentes van banken', 'DNB: bank mortgage rates')}</a></p>
<h3>${t('Vast of variabel?', 'Fixed or variable?')}</h3>
<p>${t(`Een langere rentevaste periode geeft zekerheid over je maandlast. Bij minder dan 10 jaar vast toetst de geldverstrekker met minimaal ${rulePct(params.affordability.minToetsrente, lang)}, wat je maximale hypotheek kan verlagen. Zie de <a href="${u(L('mortgage'))}">rekenhulp</a>.`, `A longer fixed period gives certainty about your monthly cost. With less than 10 years fixed, lenders test at a minimum of ${rulePct(params.affordability.minToetsrente, lang)}, which can lower your maximum mortgage. See the <a href="${u(L('mortgage'))}">calculator</a>.`)}</p></section>
<p class="nfa-inline"><strong>${t('Geen advies.', 'Not advice.')}</strong></p>
</div>`;
    page({ lang, route: r, title: t('Hypotheekrente verwachting: historie en duiding', 'Dutch mortgage rate forecast: history and context'),
      desc: t('Hypotheekrente verwachting: wij voorspellen niet, maar tonen 10 jaar historie per rentevaste periode (ECB/DNB), jaargemiddelden en wat de rente bepaalt. Geen advies.', 'Dutch mortgage rate forecast: we do not predict, but show 10 years of history by fixed period (ECB/DNB), yearly averages and what drives rates. Not advice.'),
      body, cls: 'has-band', sources: ['ecb', 'trhk'], crumbs: [[t('Hypotheekrente', 'Mortgage rates'), ROUTES.rates[lang]], [t('Verwachting', 'Forecast'), r[lang]]] });
  }

  // ---------------- methods, privacy, disclosure
  {
    const r = ROUTES.methods;
    const cbsList = ['83625NED', '85792NED', '85791NED', '86165NED', '83704NED'];
    const body = `<div class="wrap prose">
<h1>${t('Methode en bronnen', 'Methods and sources')}</h1>
<p class="lead">${t('Alle cijfers op deze site komen uit openbare, officiële bronnen. We vullen niets aan en schatten niets bij. Ontbreekt een cijfer, dan staat er “geen officiële bron”.', 'Every figure on this site comes from public, official sources. We fill in nothing and estimate nothing. If a figure is missing, the site says “no official source”.')}</p>
<h2>${t('Bronnen', 'Sources')}</h2>
<ul>${cbsList.map(k => `<li>${sourceLine(k, lang)}</li>`).join('')}<li>${sourceLine('pdok', lang)}</li><li>${sourceLine('ecb', lang)}</li><li>${sourceLine('lenders', lang)}</li>${Object.keys(params.sources).map(k => `<li>${sourceLine(k, lang)}</li>`).join('')}</ul>
<p>${t(`De CBS-data is opgehaald op ${dateLong(housing.fetchedAt, lang)}. Een automatische taak haalt de data elke dag opnieuw op. Lukt dat niet, dan blijft de laatst opgehaalde versie staan.`, `The CBS data was fetched on ${dateLong(housing.fetchedAt, lang)}. An automatic job fetches the data again every day. If that fails, the last fetched version stays in place.`)}</p>
<h2>${t('Wat de cijfers betekenen', 'What the figures mean')}</h2>
<ul>
<li>${t(`<strong>Gemiddelde verkoopprijs</strong> (83625NED): het gemiddelde van alle verkochte bestaande koopwoningen in een jaar, op basis van Kadaster-registraties. Per gemeente zijn er jaarcijfers ${Y0}–${Y}.`, `<strong>Average sale price</strong> (83625NED): the average of all existing owner-occupied homes sold in a year, based on Kadaster registrations. Municipalities have yearly figures ${Y0}–${Y}.`)}</li>
<li>${t('<strong>Prijsindex en kwartaalcijfers</strong> (85792NED): voor Nederland, de landsdelen, de provincies en de vier grootste gemeenten.', '<strong>Price index and quarterly figures</strong> (85792NED): for the Netherlands, its regions, the provinces and the four largest municipalities.')}</li>
<li>${t('<strong>Woningtype</strong> (85791NED): prijzen per woningtype, alleen voor heel Nederland.', '<strong>Dwelling type</strong> (85791NED): prices by dwelling type, for the Netherlands only.')}</li>
<li>${t(`<strong>WOZ-waarde en woningvoorraad</strong> (${housing.kernTable}): de gemiddelde WOZ-waarde staat in de bron in duizenden euro’s.`, `<strong>WOZ value and housing stock</strong> (${housing.kernTable}): the source gives the average WOZ value in thousands of euros.`)}</li>
<li>${t(`<strong>Oppervlakte</strong> (83704NED, ${housing.area.year}): het aantal woningen per oppervlakteklasse. We tonen het aandeel per klasse en de klasse van de middelste woning (de mediaanklasse). Woningen met onbekende oppervlakte tellen niet mee.`, `<strong>Floor area</strong> (83704NED, ${housing.area.year}): the number of homes per floor-area class. We show the share per class and the class of the middle home (the median class). Homes with unknown floor area are left out.`)}</li>
<li>${t('<strong>Prijsverandering</strong>: de procentuele verandering van de gemiddelde verkoopprijs tussen twee jaren, door ons berekend.', '<strong>Price change</strong>: the percentage change of the average sale price between two years, calculated by us.')}</li>
</ul>
${cbsCaveat(lang)}
${notShown(lang)}
<h2>${t('Kaart', 'Map')}</h2>
<p>${t(`Grenzen: CBS Gebiedsindelingen via PDOK (gegeneraliseerd). De kleuren delen de gemeenten in zeven groepen van ongeveer even veel gemeenten (kwantielen). Elke gemeente ligt in één provincie; die koppeling berekenen we uit de grenzen.`, `Boundaries: CBS area divisions via PDOK (generalised). The colours split the municipalities into seven groups of about the same size (quantiles). Every municipality lies in one province; we derive that link from the boundaries.`)}</p>
<h2>${t('Hypotheekrente', 'Mortgage rates')}</h2>
<p>${t('De ECB-reeksen zijn gemiddelden van nieuwe leningen per rentevaste periode: variabel tot 1 jaar, 1–5 jaar, 5–10 jaar en meer dan 10 jaar. Onze pagina’s voor 5, 10, 20 en 30 jaar vast gebruiken de reeks waar die looptijd in valt. 20 en 30 jaar delen dus één reeks.', 'The ECB series are averages of new loans by fixed period: variable up to 1 year, 1–5 years, 5–10 years and over 10 years. Our pages for 5, 10, 20 and 30 years fixed use the series that period falls into. 20 and 30 years therefore share one series.')}</p>
<p>${t(`Tarieven van geldverstrekkers nemen we met de hand over van hun eigen rentepagina, met link en datum. ${esc(lenders.lenders.filter(l => !l.source).map(l => l.name).join(', '))}: nog niet opgenomen, omdat we eerst de gebruiksvoorwaarden controleren.`, `We copy lender rates by hand from their own rate pages, with a link and date. ${esc(lenders.lenders.filter(l => !l.source).map(l => l.name).join(', '))}: not included yet, because we first check the terms of use.`)}</p>
<h2>${t('Rekenhulpen', 'Calculators')}</h2>
<p>${t(`De rekenregels staan in de code in de map engine/ en worden getest. De maximale hypotheek volgt de Trhk ${params.year}. Controle: bij een toetsinkomen van ${eur(46500, lang)} en een toetsrente van ${rulePct(5, lang)} geeft de tabel ${pct(maxMortgage({ income: 46500, ratePct: 5, fixedYears: 10 }, params).financieringslastPct, lang, 1)} en een maximale hypotheek van ${eur(maxMortgage({ income: 46500, ratePct: 5, fixedYears: 10 }, params).total, lang)}.`, `The calculation rules live in the engine/ folder and are tested. The maximum mortgage follows the Trhk ${params.year}. Check: with a test income of ${eur(46500, lang)} and a test rate of ${rulePct(5, lang)} the table gives ${pct(maxMortgage({ income: 46500, ratePct: 5, fixedYears: 10 }, params).financieringslastPct, lang, 1)} and a maximum mortgage of ${eur(maxMortgage({ income: 46500, ratePct: 5, fixedYears: 10 }, params).total, lang)}.`)}</p>
<p>${t('Kosten zoals notaris, taxatie en advies zijn marktprijzen. Er is geen officiële bron voor een vast bedrag, dus de rekenhulp vult ze niet voor je in.', 'Costs such as notary, valuation and advice are market prices. No official source sets a fixed amount, so the calculator does not fill them in for you.')}</p>
<h2>${t('Licentie', 'Licence')}</h2>
<p>${t('CBS-data valt onder CC BY 4.0. Je mag de cijfers hergebruiken met de bronvermelding “Bron: CBS”.', 'CBS data is licensed CC BY 4.0. You may reuse the figures with the attribution “Source: CBS”.')}</p>
</div>`;
    page({ lang, route: r, title: t('Methode en bronnen', 'Methods and sources'), desc: t('Waar de cijfers van Woningmarkt NL vandaan komen: CBS-tabellen, ECB/DNB-rentes, PDOK-grenzen en de regels van de Trhk en de Belastingdienst. Plus wat we bewust niet tonen.', 'Where the figures on Woningmarkt NL come from: CBS tables, ECB/DNB rates, PDOK boundaries and the Dutch lending and tax rules. Plus what we choose not to show.'),
      body, sources: [...cbsList, 'pdok', 'ecb', 'lenders', ...Object.keys(params.sources)], crumbs: [[t('Methode en bronnen', 'Methods and sources'), r[lang]]] });
  }
  page({ lang, route: ROUTES.privacy, title: t('Privacyverklaring', 'Privacy statement'), desc: t('Privacyverklaring van Woningmarkt NL: geen cookies, geen persoonsgegevens en geen formulieren. Bezoekers tellen we met GoatCounter. Wat GitHub Pages registreert.', 'Privacy statement of Woningmarkt NL: no cookies, no personal data and no forms. We count visits with GoatCounter. What GitHub Pages logs.'), crumbs: [['Privacy', ROUTES.privacy[lang]]],
    body: `<div class="wrap prose"><h1>${t('Privacyverklaring', 'Privacy statement')}</h1>
<p class="lead">${t('Deze site volgt je niet. Er zijn geen cookies en geen formulieren die gegevens opslaan. We tellen bezoeken met GoatCounter, zonder cookies en zonder persoonsgegevens.', 'This site does not track you. There are no cookies and no forms that store data. We count visits with GoatCounter, without cookies and without personal data.')}</p>
<h2>${t('Wat we verwerken', 'What we process')}</h2><ul>
<li>${t('Wat je in de rekenhulpen invult. De rekenhulpen rekenen in je eigen browser. Wat je invult, verlaat je apparaat niet en wordt niet geteld.', 'What you enter in the calculators. The calculators run in your own browser. What you enter does not leave your device and is not counted.')}</li>
<li>${t('De site staat op GitHub Pages. GitHub registreert technische gegevens, zoals IP-adressen, om de dienst te beveiligen. Zie de privacyverklaring van GitHub.', 'The site is hosted on GitHub Pages. GitHub logs technical data, such as IP addresses, to secure the service. See the GitHub privacy statement.')} <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement" rel="noopener">GitHub Privacy Statement</a></li></ul>
<h2>${t('Bezoekersstatistieken: GoatCounter', 'Visitor statistics: GoatCounter')}</h2><ul>
<li>${t('We gebruiken GoatCounter om te tellen hoe vaak een pagina wordt bekeken. We tellen ook klikken op de knoppen naar de rekenhulpen, de kaart en de vergelijker, op de taalkeuze en op de advertentieplekken. Zo zien we welke pagina’s nuttig zijn.', 'We use GoatCounter to count how often a page is viewed. We also count clicks on the buttons to the calculators, the map and the comparison tool, on the language switch and on the advertising slots. This shows us which pages are useful.')}</li>
<li>${t('GoatCounter plaatst geen cookies en slaat niets op in je browser. Het slaat geen IP-adressen, geen volledige browsergegevens (User-Agent) en geen volg-ID op. Er gaan dus geen persoonsgegevens naar ons of naar GoatCounter.', 'GoatCounter sets no cookies and stores nothing in your browser. It does not store IP addresses, the full browser string (User-Agent) or any tracking ID. So no personal data goes to us or to GoatCounter.')}</li>
<li>${t('Wat we zien: de pagina, de verwijzende site, browser en systeem, schermbreedte, land en taal. Alleen als totalen, niet per persoon.', 'What we see: the page, the referring site, browser and system, screen width, country and language. Only as totals, not per person.')}</li>
<li>${t('GoatCounter is een Europese dienst. De gegevens staan op servers van Hetzner in Finland en Duitsland. Zie de privacyverklaring van GoatCounter.', 'GoatCounter is a European service. The data is stored on Hetzner servers in Finland and Germany. See the GoatCounter privacy policy.')} <a href="https://www.goatcounter.com/help/privacy" rel="noopener">GoatCounter privacy</a></li>
<li>${t('Blokkeer je gc.zgo.at in je browser, dan werkt de site gewoon. Je wordt dan niet geteld.', 'If you block gc.zgo.at in your browser, the site still works. You are then not counted.')}</li></ul>
<h2>${t('Als er advertenties komen', 'If advertising is added')}</h2>
<p>${t('Op sommige pagina’s staan plekken voor advertenties. Die zijn nu niet actief. Wordt een plek actief, dan kan de adverteerder op zijn eigen site een cookie plaatsen als je op de link klikt. Deze site verzamelt dan nog steeds geen persoonsgegevens: contact loopt via het eigen formulier van de adverteerder. We werken deze pagina bij voordat een plek actief wordt.', 'Some pages have advertising slots. They are not active now. If a slot becomes active, the advertiser may set a cookie on its own site when you click the link. This site will still collect no personal data: contact goes through the advertiser’s own form. We update this page before any slot becomes active.')}</p>
<h2>${t('Vragen', 'Questions')}</h2><p>${t('Open een issue in de GitHub-repository van deze site.', 'Open an issue in the GitHub repository of this site.')} <a href="https://github.com/cerberostech/woningmarkt" rel="noopener">github.com/cerberostech/woningmarkt</a></p></div>` });
  page({ lang, route: ROUTES.disclosure, title: t('Disclosure en verdienmodel', 'Disclosure and how this site is funded'), desc: t('Hoe Woningmarkt NL geld wil verdienen: duidelijk gemarkeerde advertenties, geen advies, geen bemiddeling en geen affiliate-links bij rentetabellen.', 'How Woningmarkt NL plans to earn money: clearly labelled advertising, no advice, no brokering and no affiliate links near rate tables.'), crumbs: [[t('Disclosure', 'Disclosure'), ROUTES.disclosure[lang]]],
    body: `<div class="wrap prose"><h1>${t('Disclosure en verdienmodel', 'Disclosure and how this site is funded')}</h1>
<p class="lead">${t('Woningmarkt NL is een onafhankelijke informatiesite. Er zijn op dit moment geen actieve advertenties of affiliate-links.', 'Woningmarkt NL is an independent information site. There are no active advertisements or affiliate links at the moment.')}</p>
<h2>${t('Advertentieplekken', 'Advertising slots')}</h2>
<p>${t('Op sommige pagina’s staat een vak met het label “Advertentie / placeholder – nog niet actief”. Daar kan later een advertentie of affiliate-link komen, bijvoorbeeld voor energie, verhuizen of een adviseur. Wij kunnen dan een vergoeding krijgen als je via die link iets afneemt. Dat staat dan duidelijk bij de link.', 'Some pages have a box labelled “Advertisement / placeholder – not active yet”. An advertisement or affiliate link may appear there later, for example for energy, moving or an adviser. We may then receive a fee if you buy through that link. It will say so clearly next to the link.')}</p>
<h2>${t('Wat we niet doen', 'What we do not do')}</h2><ul>
<li>${t('We geven geen financieel advies en bemiddelen niet in hypotheken, leningen of verzekeringen. We hebben geen AFM-vergunning.', 'We give no financial advice and do not arrange mortgages, loans or insurance. We have no AFM licence.')}</li>
<li>${t('We plaatsen geen advertenties of affiliate-links in of naast de tabel met rentetarieven.', 'We place no advertising or affiliate links in or next to the table of interest rates.')}</li>
<li>${t('We maken geen reclame voor leningen.', 'We do not advertise loans.')}</li>
<li>${t('Een vergoeding verandert nooit de cijfers. Die komen van het CBS, DNB/ECB en de officiële regels.', 'A fee never changes the figures. They come from CBS, DNB/ECB and the official rules.')}</li>
<li>${t('We verzamelen geen contactgegevens. Contact met een adverteerder loopt via het eigen formulier van de adverteerder.', 'We collect no contact details. Contact with an advertiser goes through the advertiser’s own form.')}</li></ul>
<p><a href="${u(ROUTES.privacy[lang])}">Privacy</a> · <a href="${u(ROUTES.methods[lang])}">${t('Methode en bronnen', 'Methods and sources')}</a></p></div>` });
}

// ---------------------------------------------------------------- guides
const guides = readGuides('content/gidsen');
// Which footer source belongs to each guide token, so a guide cites exactly the sources it uses.
const TOKEN_SOURCES = { ttOwn: ['obtarief'], ttStarter: ['starter'], ttNotMain: ['obtarief'], ttOther: ['obtarief'], starterMax: ['starter'], starterAgeMin: ['starter'], starterAgeMax: ['starter'],
  nhgLimit: ['nhg'], nhgLimitEBV: ['nhg'], nhgFeePct: ['nhg'], toetsrenteMin: ['trhk'], ltvMax: ['trhk_wet'], avgPriceNL: ['83625NED'], dataYear: ['83625NED'], cbsUpdated: ['83625NED'],
  exTaxOwn: ['83625NED', 'obtarief'], exStarterOk: ['83625NED', 'starter'], exNhgOk: ['83625NED', 'nhg'], exNhgLoan: ['nhg'], exNhgFeeAtLimit: ['nhg'], year: [] };
for (const lang of ['nl', 'en']) {
  const t = T(lang), tt = params.transferTax, avg = nat.price;
  const tokens = {
    year: String(params.year), dataYear: String(Y),
    ttOwn: rulePct(tt.ownHome, lang), ttStarter: rulePct(tt.starter, lang), ttNotMain: rulePct(tt.notMainResidence, lang), ttOther: rulePct(tt.other, lang),
    starterMax: eur(tt.starterMaxValue, lang), starterAgeMin: String(tt.starterAge[0]), starterAgeMax: String(tt.starterAge[1]),
    nhgLimit: eur(params.nhg.limit, lang), nhgLimitEBV: eur(params.nhg.limitWithEBV, lang), nhgFeePct: rulePct(params.nhg.feePct, lang),
    toetsrenteMin: rulePct(params.affordability.minToetsrente, lang), ltvMax: pct(params.affordability.ltvMax * 100, lang, 0),
    avgPriceNL: eur(avg, lang), exTaxOwn: eur(transferTax({ price: avg, use: 'own' }, params).amount, lang),
    exStarterOk: avg <= tt.starterMaxValue ? t('ja', 'yes') : t('nee', 'no'),
    exNhgOk: nhgFee(avg, {}, params).eligible ? t('ja', 'yes') : t('nee', 'no'),
    exNhgLoan: eur(params.nhg.limit, lang), exNhgFeeAtLimit: eur(nhgFee(params.nhg.limit, {}, params).fee, lang),
    cbsUpdated: dateLong(S['83625NED'].modified, lang),
  };
  const list = guides.filter(g => g.lang === lang);
  const hub = ROUTES.guides;
  page({ lang, route: hub, title: t('Gidsen over huis kopen en hypotheek', 'Guides to buying a home in the Netherlands'), desc: t('Uitleg in gewone taal over kosten koper, maximale hypotheek, NHG en huizenprijzen, met bronnen en de datum van de laatste update.', 'Plain-language guides to Dutch buying costs, mortgages, NHG and house prices, with sources and the date of the last update.'),
    crumbs: [[t('Gidsen', 'Guides'), hub[lang]]],
    body: `<div class="wrap prose"><h1>${t('Gidsen', 'Guides')}</h1><p class="lead">${t('Uitleg in gewone taal, met bronnen. Geen advies.', 'Plain-language explanations, with sources. Not advice.')}</p>
${list.length ? `<ul class="guides">${list.map(g => `<li><h2><a href="${u(guideRoute(lang, g.slug))}">${esc(g.title)}</a></h2><p>${esc(g.description)}</p>${g.updated ? `<p class="muted">${t('Bijgewerkt', 'Updated')} ${time(g.updated, lang)}</p>` : ''}</li>`).join('')}</ul>` : `<p>${t('Er staan nog geen gidsen in deze taal.', 'There are no guides in this language yet.')}</p>`}</div>` });
  for (const g of list) {
    const route = g.twin ? { [lang]: guideRoute(lang, g.slug), [lang === 'nl' ? 'en' : 'nl']: guideRoute(lang === 'nl' ? 'en' : 'nl', g.twin) } : { [lang]: guideRoute(lang, g.slug) };
    const md = fillTokens(g.body, tokens, g.file);
    const html = markdown(md, { guideBase: u(lang === 'nl' ? 'gidsen/' : 'en/guides/'), base: BASE });
    for (const [, to] of html.matchAll(new RegExp(`href="${BASE}/(?:en/guides|gidsen)/([^/"#]+)/`, 'g'))) if (!guides.some(x => x.lang === lang && x.slug === to)) console.warn(`gidsen: ${g.file}: link to guide "${to}" that does not exist (yet)`);
    const url = abs(route[lang]);
    page({ lang, route, type: 'article', title: g.title, desc: g.description, modified: g.updated,
      crumbs: [[t('Gidsen', 'Guides'), hub[lang]], [g.title, route[lang]]],
      sources: [...new Set([...g.body.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].flatMap(m => TOKEN_SOURCES[m[1]] || []))],
      schema: [{ '@context': 'https://schema.org', '@type': 'Article', headline: clip(g.title, 110), description: g.description, ...(g.updated && { dateModified: g.updated }), url, mainEntityOfPage: url, inLanguage: lang, image: `${SITE}/og-image.png`,
        author: { '@type': 'Organization', name: g.author || NAME }, publisher: { '@type': 'Organization', name: NAME, url: abs(ROUTES.home[lang]) } }],
      body: `<article class="wrap prose md"><h1>${esc(g.title)}</h1><p class="lead">${esc(g.description)}</p>
<p class="byline">${[g.author && `${t('Tekst', 'Written by')}: ${esc(g.author)}`, g.reviewer && `${t('Gecontroleerd door', 'Reviewed by')}: ${esc(g.reviewer)}`, g.updated && `${t('Bijgewerkt', 'Updated')} ${time(g.updated, lang)}`].filter(Boolean).join('. ')}</p>
${html}
<p class="nfa-inline"><strong>${t('Geen financieel advies.', 'Not financial advice.')}</strong> ${t('Deze gids legt regels uit; je persoonlijke situatie kan anders uitpakken.', 'This guide explains rules; your own situation may work out differently.')}</p>
${g.slots.filter(s => SLOTS[s]).map(s => adSlot(s, lang, route)).join('')}
<p class="more"><a href="${u(hub[lang])}">${t('Alle gidsen', 'All guides')}</a></p></article>` });
  }
}

// ---------------------------------------------------------------- 404, sitemap, robots
page({ lang: 'nl', route: { nl: '404.html' }, title: 'Pagina niet gevonden / Page not found', desc: 'Deze pagina bestaat niet. This page does not exist.', robots: 'noindex', sitemap: false,
  body: `<div class="wrap prose"><h1>Pagina niet gevonden</h1><p class="lead">Deze pagina bestaat niet (meer). Misschien is het adres verkeerd getypt.</p>
<ul class="links"><li><a href="${u('')}">Naar de homepage</a></li><li><a href="${u(ROUTES.map.nl)}"${gc('cta-map-404-nl')}>Huizenprijzen per gemeente op de kaart</a></li></ul>
<h2 lang="en">Page not found</h2><p lang="en">This page does not exist (any more). Perhaps the address was mistyped.</p>
<ul class="links" lang="en"><li><a href="${u('en/')}">Go to the English homepage</a></li><li><a href="${u(ROUTES.map.en)}"${gc('cta-map-404-en')}>House prices by municipality on the map</a></li></ul></div>` });

const seen = new Set();
const urls = PAGES.filter(p => { const k = p.route[p.lang]; if (seen.has(k)) return false; seen.add(k); return true; });
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.map(p => `<url><loc>${abs(p.route[p.lang])}</loc>${p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : ''}${p.both ? ['nl', 'en'].map(l => `<xhtml:link rel="alternate" hreflang="${l}" href="${abs(p.route[l])}"/>`).join('') + `<xhtml:link rel="alternate" hreflang="x-default" href="${abs(p.route.nl)}"/>` : ''}</url>`).join('\n')}\n</urlset>\n`);
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
const counts = { nl: urls.filter(p => p.lang === 'nl').length, en: urls.filter(p => p.lang === 'en').length };
console.log(`wrote ${urls.length} indexable pages (nl ${counts.nl}, en ${counts.en}) + 404; ${CITIES.length} cities, ${PAIRS.length} comparisons, ${guides.length} guides; data year ${Y}`);
