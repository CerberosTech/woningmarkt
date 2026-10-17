// Woningmarkt NL static site builder. Zero npm dependencies (Node >= 20). Run: node build.mjs
// Reads data/*.json and content/gidsen/*.md, writes prebuilt HTML for NL (root) and EN (/en/) into dist/.
// Rule: every figure on the site comes from data/*.json (directly or computed from it). Missing data shows as
// "geen officiële bron" / "no official source"; nothing is estimated or filled in.
import fs from 'node:fs'; import path from 'node:path';
import { ROUTES, CITIES, CURATED_PAIRS, TERMS, cityRoute, pairRoute, termRoute, guideRoute } from './lib/routes.mjs';
import { esc, squash, markdown, readGuides, fillTokens } from './lib/markdown.mjs';
import { eur, num, pct, rulePct, eurK, dateLong, monthLong, monthShort, period, NA } from './lib/format.mjs';
import { lineChart, chartTable } from './lib/charts.mjs';
import { makeProjection, pathData, centroid, interiorPoint, assignParents, adjacency, distanceKm, projBBox, polygons } from './lib/geo.mjs';
import { change, yearSeries, areaDistribution, quantileBreaks, niceBreaks, classOf, yearlyAverages } from './engine/stats.mjs';
import { maxMortgage, ENERGY_LABELS } from './engine/affordability.mjs';
import { transferTax, buyingCosts, nhgFee } from './engine/costs.mjs';

const SITE = 'https://cerberostech.github.io/woningmarkt';
const BASE = '/woningmarkt';
const OUT = process.env.OUT || 'dist';
const NAME = 'Woningmarkt NL';
const THEME = '#14272D';

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
function region(code) {
  const pr = housing.prices[code] || {}, k = housing.kern[code];
  return {
    code, price: pr[Y] ?? null, prev: pr[YP] ?? null, first: pr[Y0] ?? null, yoy: change(pr[YP], pr[Y]), tenY: change(pr[Y0], pr[Y]),
    series: years.map(y => [String(y), pr[y] ?? null]),
    woz: k?.wozAvgK != null ? k.wozAvgK * 1000 : null, pctMulti: k?.pctMultiFamily ?? null, pctSingle: k?.pctSingleFamily ?? null,
    pctOwner: k?.pctOwner ?? null, pctRent: k?.pctRent ?? null, inhabitants: k?.inhabitants ?? null, dwellings: k?.dwellings ?? null,
    built10: k?.pctBuiltLast10y ?? null, cars: k?.carsPerHousehold ?? null,
    area: areaDistribution(housing.area.data[code]?.all, areaClasses),
    areaHouse: areaDistribution(housing.area.data[code]?.house, areaClasses),
    areaApt: areaDistribution(housing.area.data[code]?.apartment, areaClasses),
  };
}
const gm = Object.fromEntries(gmFeat.map(f => { const c = f.properties.code; return [c, { ...region(c), name: f.properties.name, pv: parent[c], centroid: centroid(f.geometry), feature: f }]; }));
const pv = Object.fromEntries(pvFeat.map(f => { const c = f.properties.code; return [c, { ...region(c), name: f.properties.name, pctMultiStock: shareApartments(c), feature: f }]; }));
const nat = region(NL);

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

const LOGO = `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" focusable="false"><path d="M4 29V15l4-4V7h4v4l4-4 4 4V7h4v4l4 4v14z" fill="currentColor"/><path d="M13 29v-7h6v7" fill="#fff"/><path d="M10 18h3v3h-3zM19 18h3v3h-3z" fill="#fff"/></svg>`;

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
<title>${esc(fullTitle)}</title><meta name="description" content="${esc(fit(155, desc))}">${robots ? `<meta name="robots" content="${robots}">` : `<link rel="canonical" href="${abs(self)}">`}${alt}
<meta name="theme-color" content="${THEME}"><meta name="color-scheme" content="light">
<link rel="icon" href="${BASE}/icon.svg" type="image/svg+xml"><link rel="icon" href="${BASE}/favicon.ico" sizes="32x32"><link rel="apple-touch-icon" href="${BASE}/apple-touch-icon.png">
<meta property="og:type" content="${type}"><meta property="og:site_name" content="${NAME}"><meta property="og:locale" content="${lang === 'nl' ? 'nl_NL' : 'en_GB'}">${both ? `<meta property="og:locale:alternate" content="${lang === 'nl' ? 'en_GB' : 'nl_NL'}">` : ''}
<meta property="og:title" content="${esc(fullTitle)}"><meta property="og:description" content="${esc(fit(155, desc))}"><meta property="og:url" content="${abs(self)}">
<meta property="og:image" content="${SITE}/og-image.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(t('Woningmarkt NL: huizenprijzen per gemeente op de kaart', 'Woningmarkt NL: Dutch house prices by municipality on a map'))}">
<meta name="twitter:card" content="summary_large_image">${mod ? `<meta property="article:modified_time" content="${mod}">` : ''}
${[...crumbLd, ...schema].map(jsonLd).join('')}${head}
<link rel="stylesheet" href="${BASE}/style.css"></head><body${cls ? ` class="${cls}"` : ''}>
<a class="skip" href="#main">${t('Naar de inhoud', 'Skip to content')}</a>
<header class="site-head"><div class="wrap head-row"><a class="brand" href="${u(ROUTES.home[lang])}">${LOGO}<span>${NAME}</span></a>${switcher()}</div>
<nav class="site-nav" aria-label="${t('Hoofdmenu', 'Main menu')}"><ul class="wrap">${NAV.map(([k, nl, en]) => `<li><a href="${u(ROUTES[k][lang])}"${k === activeNav ? ' aria-current="page"' : ''}>${lang === 'nl' ? nl : en}</a></li>`).join('')}</ul></nav></header>
<main id="main" tabindex="-1"><div class="wrap">${crumbHtml}</div>${tagCtas(body, routeKey(route))}</main>
<footer class="site-foot"><div class="wrap">
${sources.length ? `<h2 class="foot-h">${t('Bronnen op deze pagina', 'Sources on this page')}</h2><ul class="sources">${sources.map(s => `<li>${sourceLine(s, lang)}</li>`).join('')}</ul>` : ''}
<p class="nfa"><strong>${t('Geen financieel advies.', 'Not financial advice.')}</strong> ${t('Alle cijfers en berekeningen zijn indicatief. Deze site bemiddelt niet in hypotheken of verzekeringen.', 'All figures and calculations are indicative. This site does not arrange mortgages or insurance.')}</p>
<p>${t('Onafhankelijke site. Niet verbonden aan het CBS, DNB, de ECB of een geldverstrekker.', 'Independent site. Not affiliated with CBS, DNB, the ECB or any lender.')}</p>
<ul class="foot-nav"><li><a href="${u(ROUTES.methods[lang])}">${t('Methode en bronnen', 'Methods and sources')}</a></li><li><a href="${u(ROUTES.guides[lang])}">${t('Gidsen', 'Guides')}</a></li><li><a href="${u(ROUTES.privacy[lang])}">Privacy</a></li><li><a href="${u(ROUTES.disclosure[lang])}">${t('Disclosure', 'Disclosure')}</a></li>${both ? `<li>${switcher('-footer')}</li>` : ''}</ul>
</div></footer>${scripts}${ANALYTICS}</body></html>`;
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

const areaBars = (d, lang, id) => { if (!d) return `<p>${NA[lang]}</p>`;
  return `<ul class="bars" aria-labelledby="${id}">${d.classes.map(c => `<li${c === d.median ? ' class="median"' : ''}><span class="bl">${esc(c.name)}</span><span class="bv">${pct(c.share, lang)}</span><span class="bb" style="--w:${(c.share).toFixed(2)}%"></span></li>`).join('')}</ul>`; };

// Choropleth ramp (7 classes, light to dark)
const RAMP = ['#e8f2ee', '#c8e3d9', '#9fcfc1', '#6db5a8', '#3f968f', '#1f7478', '#0d4e5b'];
const METRICS = {
  price: { step: 5000, unit: 'eur', nl: `Gemiddelde verkoopprijs ${Y}`, en: `Average sale price ${Y}`, src: '83625NED' },
  yoy: { step: 0.5, unit: 'pctSigned', nl: `Prijsverandering ${YP}–${Y}`, en: `Price change ${YP}–${Y}`, src: '83625NED' },
  woz: { step: 5000, unit: 'eur', nl: 'Gemiddelde WOZ-waarde', en: 'Average WOZ value', src: '86165NED' },
  multi: { step: 1, unit: 'pct', nl: 'Aandeel meergezinswoningen (appartementen)', en: 'Share of multi-family homes (apartments)', src: '86165NED' },
};
const gmVal = (r, m) => m === 'price' ? r.price : m === 'yoy' ? r.yoy : m === 'woz' ? r.woz : r.pctMulti;
const pvVal = (r, m) => m === 'price' ? r.price : m === 'yoy' ? r.yoy : m === 'woz' ? null : r.pctMultiStock;
const BREAKS = {};
for (const m of Object.keys(METRICS)) BREAKS[m] = {
  gm: niceBreaks(quantileBreaks(Object.values(gm).map(r => gmVal(r, m)), 7), METRICS[m].step),
  pv: niceBreaks(quantileBreaks(Object.values(pv).map(r => pvVal(r, m)), 7), METRICS[m].step),
};
const fillFor = (v, breaks) => { const i = classOf(v, breaks); return i < 0 ? 'var(--nodata)' : RAMP[Math.round(i * (RAMP.length - 1) / Math.max(1, breaks.length))]; };
const fmtMetric = (v, m, lang) => METRICS[m].unit === 'eur' ? eur(v, lang) : pct(v, lang, 1, METRICS[m].unit === 'pctSigned');
const legend = (m, layer, lang) => { const b = BREAKS[m][layer], f = v => fmtMetric(v, m, lang);
  const items = [...b.map((x, i) => [fillFor(x, b), i === 0 ? `≤ ${f(x)}` : `${f(b[i - 1])} – ${f(x)}`]), [fillFor(Infinity, b), `> ${f(b.at(-1))}`]];
  return `<ul class="legend-map">${items.map(([c, l]) => `<li><span style="background:${c}"></span>${esc(l)}</li>`).join('')}<li><span class="nd"></span>${T(lang)('Geen gegevens', 'No data')}</li></ul>`; };

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
  const labels = ring.map(c => { const [x, y] = p.p(interiorPoint(gm[c].feature.geometry)); if (x < 0 || y < 0 || x > W || y > H) return '';
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}"${c === code ? ' class="self"' : ''}>${esc(muniName(c, lang).replace(/ \(Den Bosch\)$/, ''))}</text>`; }).join('');
  return `<figure class="localmap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="lm-t"><title id="lm-t">${esc(T(lang)(`Gemiddelde verkoopprijs ${Y} in ${cityName(city, lang)} en buurgemeenten`, `Average sale price ${Y} in ${cityName(city, lang)} and neighbouring municipalities`))}</title><g class="shapes">${shapes}</g><g class="labels" aria-hidden="true">${labels}</g></svg>${legend('price', 'gm', lang)}</figure>`;
}

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
    const r = ROUTES.home, A = lastObs('A');
    const svg = `<svg viewBox="0 0 ${projNL.width} ${projNL.height}" role="img" aria-labelledby="hm-t"><title id="hm-t">${esc(t(`Gemiddelde verkoopprijs per provincie in ${Y}`, `Average sale price by province in ${Y}`))}</title>${pvFeat.map(f => { const c = f.properties.code; return `<path d="${pvPathsLite[c]}" fill="${fillFor(pv[c].price, BREAKS.price.pv)}"><title>${esc(pv[c].name)}: ${esc(eur(pv[c].price, lang))}</title></path>`; }).join('')}</svg>`;
    const body = `<section class="hero"><div class="wrap hero-grid">
<div class="hero-text">
<h1>${t('Wat kost een huis in Nederland?', 'What does a home cost in the Netherlands?')}</h1>
<p class="lead">${t(`In ${Y} kostte een bestaande koopwoning gemiddeld <strong>${eur(nat.price, lang)}</strong>. Dat is ${pctStr(nat.yoy, lang)} ten opzichte van ${YP}.`, `In ${Y} an existing owner-occupied home sold for <strong>${eur(nat.price, lang)}</strong> on average. That is ${pctStr(nat.yoy, lang)} compared with ${YP}.`)}</p>
<p>${t(`In het ${period(nlLastQ.period, lang)} was de gemiddelde verkoopprijs ${eur(nlLastQ.avg, lang)}. De prijsindex lag ${pct(Math.abs(nlLastQ.yoy), lang)} ${nlLastQ.yoy >= 0 ? 'hoger' : 'lager'} dan een jaar eerder.`, `In ${period(nlLastQ.period, lang)} the average sale price was ${eur(nlLastQ.avg, lang)}. The price index was ${pct(Math.abs(nlLastQ.yoy), lang)} ${nlLastQ.yoy >= 0 ? 'higher' : 'lower'} than a year earlier.`)}</p>
${stamp(lang, '85792NED')}
<ul class="actions"><li><a class="btn" href="${u(L('map'))}"${gc('cta-map-home-hero')}>${t('Bekijk de kaart per gemeente', 'Open the map by municipality')}</a></li><li><a class="btn alt" href="${u(L('mortgage'))}"${gc('cta-calc-mortgage-home-hero')}>${t('Bereken je maximale hypotheek', 'Calculate your maximum mortgage')}</a></li></ul>
</div>
<a class="hero-map" href="${u(L('map'))}"${gc('cta-map-home-hero-map')} aria-label="${t('Naar de kaart', 'Go to the map')}">${svg}</a>
</div></section>
<div class="wrap">
<section class="tools" aria-labelledby="tools-h"><h2 id="tools-h">${t('Rekenhulpen en overzichten', 'Calculators and overviews')}</h2><dl class="toollist">
<div><dt><a href="${u(L('mortgage'))}">${t('Maximale hypotheek berekenen', 'Mortgage calculator')}</a></dt><dd>${t(`Met de financieringslasttabellen ${params.year} en een toetsrente van minimaal ${rulePct(params.affordability.minToetsrente, lang)}.`, `Uses the ${params.year} Dutch lending tables and a minimum test rate of ${rulePct(params.affordability.minToetsrente, lang)}.`)}</dd></div>
<div><dt><a href="${u(L('costs'))}">${t('Kosten koper berekenen', 'Buying costs calculator')}</a></dt><dd>${t(`Overdrachtsbelasting (${rulePct(params.transferTax.ownHome, lang)}, ${rulePct(params.transferTax.starter, lang)} voor starters tot ${eur(params.transferTax.starterMaxValue, lang)}) en de NHG-kosten.`, `Transfer tax (${rulePct(params.transferTax.ownHome, lang)}, ${rulePct(params.transferTax.starter, lang)} for first-time buyers up to ${eur(params.transferTax.starterMaxValue, lang)}) and the NHG fee.`)}</dd></div>
<div><dt><a href="${u(L('rates'))}">${t('Hypotheekrente', 'Mortgage rates')}</a></dt><dd>${t(`Gemiddelde rente op nieuwe hypotheken in ${monthLong(A.month, lang)}: ${pct(A.rate, lang, 2)} (alle looptijden, ECB/DNB).`, `Average rate on new mortgages in ${monthLong(A.month, lang)}: ${pct(A.rate, lang, 2)} (all fixed periods, ECB/DNB).`)}</dd></div>
<div><dt><a href="${u(L('compare'))}">${t('Steden vergelijken', 'Compare cities')}</a></dt><dd>${t('Twee gemeenten naast elkaar: prijs, WOZ-waarde, woningvoorraad en oppervlakte.', 'Two municipalities side by side: price, WOZ value, housing stock and floor area.')}</dd></div>
</dl></section>
<section aria-labelledby="cities-h"><h2 id="cities-h">${t(`Huizenprijzen in de 25 grootste gemeenten (${Y})`, `House prices in the 25 largest municipalities (${Y})`)}</h2>
<div class="scroll"><table class="sortable"><thead><tr><th scope="col">${t('Gemeente', 'Municipality')}</th><th scope="col" class="n">${t('Gemiddelde prijs', 'Average price')}</th><th scope="col" class="n">${t(`t.o.v. ${YP}`, `vs ${YP}`)}</th><th scope="col" class="n">${t('WOZ-waarde', 'WOZ value')}</th></tr></thead><tbody>
${CITIES.map(c => { const g = gm[c.code]; return `<tr><th scope="row">${cityLink(c)}</th><td class="n" data-v="${g.price}">${eur(g.price, lang)}</td><td class="n" data-v="${g.yoy?.toFixed(3)}">${pctStr(g.yoy, lang)}</td><td class="n" data-v="${g.woz}">${eur(g.woz, lang)}</td></tr>`; }).join('')}
</tbody></table></div>
<p class="more"><a href="${u(L('prices'))}">${t('Alle provincies en de landelijke trend', 'All provinces and the national trend')}</a></p></section>
${cbsCaveat(lang)}
</div>`;
    page({ lang, route: r, title: t('Woningmarkt Nederland: huizenprijzen, kaart en hypotheek', 'Dutch housing market: house prices, map and mortgage'),
      desc: t(`Gemiddelde huizenprijs per gemeente op de kaart, 10 jaar prijsontwikkeling, maximale hypotheek en kosten koper. Officiële CBS-cijfers, bijgewerkt ${dateLong(S['85792NED'].modified, lang)}.`, `Average house price by municipality on a map, 10-year trend, mortgage and buying-costs calculators. Official CBS figures, updated ${dateLong(S['85792NED'].modified, lang)}.`),
      body, sources: ['83625NED', '85792NED', '86165NED', 'ecb', 'pdok', 'trhk', 'obtarief'], cls: 'home', scripts: `<script src="${BASE}/js/site.js" defer></script>`,
      schema: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: NAME, url: abs(r[lang]), inLanguage: lang }] });
  }

  // ---------------- map
  {
    const r = ROUTES.map;
    const pvOf = c => gm[c].pv;
    const svg = `<svg id="nlmap" viewBox="0 0 ${projNL.width} ${projNL.height}" role="img" aria-labelledby="map-t map-d"><title id="map-t">${esc(t(`Kaart: gemiddelde verkoopprijs per gemeente, ${Y}`, `Map: average sale price by municipality, ${Y}`))}</title><desc id="map-d">${esc(t('Dezelfde cijfers staan in de tabel onder de kaart.', 'The same figures are in the table below the map.'))}</desc>
<g id="gm">${gmFeat.map(f => { const c = f.properties.code; return `<path d="${gmPaths[c]}" data-c="${c}" fill="${fillFor(gm[c].price, BREAKS.price.gm)}"/>`; }).join('')}</g>
<g id="pv">${pvFeat.map(f => { const c = f.properties.code; return `<path d="${pvPaths[c]}" data-c="${c}" fill="${fillFor(pv[c].price, BREAKS.price.pv)}"/>`; }).join('')}</g></svg>`;
    const data = {
      lang, y: Y, yp: YP, ramp: RAMP, breaks: BREAKS,
      metrics: Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, { label: m[lang], unit: m.unit }])),
      gm: Object.fromEntries(Object.entries(gm).map(([c, g]) => [c, [muniName(c, lang), g.pv, g.price, g.yoy == null ? null : +g.yoy.toFixed(2), g.woz, g.pctMulti, cityByCode[c] ? u(cityRoute(cityByCode[c].slug)[lang]) : null]])),
      pv: Object.fromEntries(Object.entries(pv).map(([c, g]) => [c, [g.name, null, g.price, g.yoy == null ? null : +g.yoy.toFixed(2), null, g.pctMultiStock == null ? null : +g.pctMultiStock.toFixed(1), null]])),
      compare: u(L('compare')),
      i18n: { province: t('Provincie', 'Province'), nodata: t('Geen gegevens', 'No data'), cityPage: t('Bekijk de pagina over', 'Open the page about'), compare: t('Vergelijk met een andere gemeente', 'Compare with another municipality'), multiProv: t(`Provincie: aandeel meergezinswoningen in de woningvoorraad (CBS 83704NED, ${housing.area.year})`, `Province: share of multi-family homes in the housing stock (CBS 83704NED, ${housing.area.year})`), wozProv: t('WOZ-waarde: geen cijfer per provincie in deze bron', 'WOZ value: no province figure in this source'), close: t('Sluiten', 'Close'), notFound: t('Geen gemeente gevonden met die naam.', 'No municipality found with that name.') },
    };
    const metricRadios = Object.entries(METRICS).map(([k, m], i) => `<label><input type="radio" name="metric" value="${k}"${i ? '' : ' checked'}> ${esc(m[lang])}</label>`).join('');
    const rows = Object.entries(gm).sort((a, b) => muniName(a[0], lang).localeCompare(muniName(b[0], lang), lang)).map(([c, g]) =>
      `<tr id="row-${c}"><th scope="row">${cityByCode[c] ? cityLink(cityByCode[c]) : esc(muniName(c, lang))}</th><td>${esc(pv[g.pv]?.name ?? '')}</td><td class="n" data-v="${g.price ?? ''}">${eur(g.price, lang)}</td><td class="n" data-v="${g.yoy?.toFixed(3) ?? ''}">${pctStr(g.yoy, lang)}</td><td class="n" data-v="${g.woz ?? ''}">${eur(g.woz, lang)}</td><td class="n" data-v="${g.pctMulti ?? ''}">${pct(g.pctMulti, lang, 0)}</td></tr>`).join('');
    const body = `<div class="wrap">
<h1>${t('Huizenprijzen per gemeente: de kaart', 'House prices by municipality: the map')}</h1>
<p class="lead">${t(`De gemiddelde verkoopprijs van bestaande koopwoningen in alle ${gmFeat.length} gemeenten in ${Y}. Kies een andere kaartlaag voor de WOZ-waarde, het aandeel appartementen of de prijsverandering. Klik op een gemeente voor de cijfers.`, `The average sale price of existing owner-occupied homes in all ${gmFeat.length} municipalities in ${Y}. Choose another layer for the WOZ value, the share of apartments or the price change. Click a municipality for its figures.`)}</p>
${stamp(lang)}
<div class="mapui">
<form class="mapctl" id="mapctl" onsubmit="return false">
<fieldset><legend>${t('Kaartlaag', 'Layer')}</legend>${metricRadios}</fieldset>
<fieldset><legend>${t('Niveau', 'Level')}</legend><label><input type="radio" name="level" value="gm" checked> ${t('Gemeenten', 'Municipalities')}</label><label><input type="radio" name="level" value="pv"> ${t('Provincies', 'Provinces')}</label></fieldset>
<div class="find"><label for="find">${t('Zoek een gemeente', 'Find a municipality')}</label><input id="find" list="munis" autocomplete="off" placeholder="${t('Bijv. Utrecht', 'E.g. Utrecht')}"><datalist id="munis">${Object.keys(gm).map(c => `<option value="${esc(muniName(c, lang))}">`).join('')}</datalist></div>
</form>
<div class="mapwrap"><div class="mapbox">${svg}<div id="tip" class="tip" hidden></div></div><div id="legend">${legend('price', 'gm', lang)}</div></div>
<aside id="panel" class="panel" aria-live="polite"><p class="hint">${t('Klik op de kaart of zoek een gemeente.', 'Click the map or search for a municipality.')}</p></aside>
</div>
<noscript><p class="note">${t('De kaart toont zonder JavaScript alleen de gemiddelde prijs. Alle cijfers staan ook in de tabel hieronder.', 'Without JavaScript the map shows the average price only. All figures are also in the table below.')}</p></noscript>
<p class="note">${t(`Prijsverandering = verandering van de gemiddelde verkoopprijs van ${YP} naar ${Y}. WOZ-waarde en aandeel meergezinswoningen: CBS Kerncijfers wijken en buurten (86165NED). Op provincieniveau komt het aandeel meergezinswoningen uit de woningvoorraad (83704NED).`, `Price change = change of the average sale price from ${YP} to ${Y}. WOZ value and share of multi-family homes: CBS key figures for districts and neighbourhoods (86165NED). At province level the share of multi-family homes comes from the housing stock table (83704NED).`)}</p>
${cbsCaveat(lang)}
${notShown(lang)}
<section aria-labelledby="tbl-h"><h2 id="tbl-h">${t(`Alle ${gmFeat.length} gemeenten`, `All ${gmFeat.length} municipalities`)}</h2>
<p>${t('Klik op een kolomkop om te sorteren.', 'Click a column header to sort.')}</p>
<div class="scroll tall"><table class="sortable" id="munitable"><thead><tr><th scope="col">${t('Gemeente', 'Municipality')}</th><th scope="col">${t('Provincie', 'Province')}</th><th scope="col" class="n">${t(`Prijs ${Y}`, `Price ${Y}`)}</th><th scope="col" class="n">${t(`t.o.v. ${YP}`, `vs ${YP}`)}</th><th scope="col" class="n">WOZ</th><th scope="col" class="n">${t('Meergezins', 'Multi-family')}</th></tr></thead><tbody>${rows}</tbody></table></div></section>
</div>${jsonData('mapdata', data)}`;
    page({ lang, route: r, title: t('Huizenprijzen per gemeente: kaart van Nederland', 'Netherlands house prices map by municipality'),
      desc: t(`Interactieve kaart met de gemiddelde huizenprijs per gemeente (${Y}), WOZ-waarde, aandeel appartementen en prijsverandering. CBS-cijfers voor alle ${gmFeat.length} gemeenten.`, `Interactive map of the average house price by municipality (${Y}), WOZ value, share of apartments and price change. CBS figures for all ${gmFeat.length} municipalities.`),
      body, sources: ['83625NED', '86165NED', '83704NED', 'pdok'], crumbs: [[t('Kaart', 'Map'), r[lang]]], cls: 'mappage',
      schema: [dataset({ lang, route: r, name: t(`Gemiddelde verkoopprijs per gemeente ${Y}`, `Average sale price by municipality ${Y}`), description: t(`Gemiddelde verkoopprijs van bestaande koopwoningen, WOZ-waarde en aandeel meergezinswoningen voor alle ${gmFeat.length} gemeenten, uit CBS-tabellen 83625NED, 86165NED en 83704NED.`, `Average sale price of existing owner-occupied homes, WOZ value and share of multi-family homes for all ${gmFeat.length} municipalities, from CBS tables 83625NED, 86165NED and 83704NED.`), tables: ['83625NED', '86165NED', '83704NED'] })],
      scripts: `<script src="${BASE}/js/site.js" defer></script><script src="${BASE}/js/map.js" defer></script>` });
  }

  // ---------------- national prices
  {
    const r = ROUTES.prices;
    const chart = lineChart({ series: [{ name: t('Nederland', 'Netherlands'), points: nat.series }], fmtY: v => eurK(v, lang), title: t(`Gemiddelde verkoopprijs Nederland ${Y0}–${Y}`, `Average sale price Netherlands ${Y0}–${Y}`), xEvery: 2 });
    const typeChart = lineChart({ series: [{ name: typeName({ k: 'ZW10290', name: typeSeries('ZW10290').name }, lang), points: annualType('ZW10290') }, { name: typeName({ k: 'ZW25810', name: typeSeries('ZW25810').name }, lang), points: annualType('ZW25810') }], fmtY: v => eurK(v, lang), title: t(`Eengezinswoningen en appartementen, gemiddelde verkoopprijs ${Y0}–${Y}`, `Houses and apartments, average sale price ${Y0}–${Y}`), xEvery: 2 });
    const q = nlRecent.slice(-8);
    const pvRows = Object.entries(pv).sort((a, b) => b[1].price - a[1].price);
    const body = `<div class="wrap">
<h1>${t('Huizenprijzen in Nederland', 'House prices in the Netherlands')}</h1>
<p class="lead">${t(`De gemiddelde verkoopprijs van een bestaande koopwoning was ${eur(nat.price, lang)} in ${Y}. In ${Y0} was dat ${eur(nat.first, lang)}: ${pctStr(nat.tenY, lang)} in ${Y - Y0} jaar.`, `The average sale price of an existing owner-occupied home was ${eur(nat.price, lang)} in ${Y}. In ${Y0} it was ${eur(nat.first, lang)}: ${pctStr(nat.tenY, lang)} in ${Y - Y0} years.`)}</p>
${stamp(lang)}
<section aria-labelledby="trend-h"><h2 id="trend-h">${t(`Prijsontwikkeling ${Y0}–${Y}`, `Price trend ${Y0}–${Y}`)}</h2>${chart}
${chartTable({ summary: t('Cijfers in de grafiek', 'Figures in the chart'), head: [t('Jaar', 'Year'), t('Gemiddelde prijs', 'Average price'), t('Verandering', 'Change')], rows: nat.series.map(([y, v], i) => [y, eur(v, lang), i ? pctStr(change(nat.series[i - 1][1], v), lang) : '–']) })}</section>
<section aria-labelledby="q-h"><h2 id="q-h">${t('De laatste kwartalen', 'The latest quarters')}</h2>
<p>${t('De prijsindex corrigeert voor de mix van verkochte woningen. Daarom is dit de betere maat voor de prijsontwikkeling.', 'The price index corrects for the mix of homes sold. That makes it the better measure of the price trend.')}</p>
<div class="scroll"><table><thead><tr><th scope="col">${t('Periode', 'Period')}</th><th scope="col" class="n">${t('Gemiddelde prijs', 'Average price')}</th><th scope="col" class="n">${t('Prijsindex t.o.v. een jaar eerder', 'Price index vs a year earlier')}</th><th scope="col" class="n">${t('Verkochte woningen', 'Homes sold')}</th></tr></thead><tbody>
${q.map(x => `<tr><th scope="row">${esc(period(x.period, lang))}</th><td class="n">${eur(x.avg, lang)}</td><td class="n">${pctStr(x.yoy, lang)}</td><td class="n">${num(x.sold, lang)}</td></tr>`).join('')}</tbody></table></div>
<p class="src-inline">${t('Bron: CBS 85792NED.', 'Source: CBS 85792NED.')}</p></section>
<section aria-labelledby="type-h"><h2 id="type-h">${t('Appartement of eengezinswoning', 'Apartment or house')}</h2>
<p>${t(`Deze uitsplitsing publiceert het CBS alleen voor heel Nederland (tabel 85791NED), niet per gemeente. Cijfers voor het ${period(typeLatest[0].last.period, lang)}:`, `CBS publishes this split only for the Netherlands as a whole (table 85791NED), not by municipality. Figures for ${period(typeLatest[0].last.period, lang)}:`)}</p>
<div class="scroll"><table><thead><tr><th scope="col">${t('Woningtype', 'Dwelling type')}</th><th scope="col" class="n">${t('Gemiddelde prijs', 'Average price')}</th><th scope="col" class="n">${t('Verkocht', 'Sold')}</th></tr></thead><tbody>
${typeLatest.map(x => `<tr><th scope="row">${esc(typeName(x, lang))}</th><td class="n">${eur(x.last.avg, lang)}</td><td class="n">${num(x.last.sold, lang)}</td></tr>`).join('')}</tbody></table></div>
${typeChart}</section>
<section aria-labelledby="pv-h"><h2 id="pv-h">${t('Per provincie', 'By province')}</h2>
<div class="scroll"><table class="sortable"><thead><tr><th scope="col">${t('Provincie', 'Province')}</th><th scope="col" class="n">${Y0}</th><th scope="col" class="n">${Y}</th><th scope="col" class="n">${t(`t.o.v. ${YP}`, `vs ${YP}`)}</th><th scope="col" class="n">${t(`t.o.v. ${Y0}`, `vs ${Y0}`)}</th></tr></thead><tbody>
${pvRows.map(([c, g]) => `<tr><th scope="row">${esc(g.name)}</th><td class="n" data-v="${g.first}">${eur(g.first, lang)}</td><td class="n" data-v="${g.price}">${eur(g.price, lang)}</td><td class="n" data-v="${g.yoy?.toFixed(3)}">${pctStr(g.yoy, lang)}</td><td class="n" data-v="${g.tenY?.toFixed(3)}">${pctStr(g.tenY, lang)}</td></tr>`).join('')}</tbody></table></div></section>
<section aria-labelledby="c-h"><h2 id="c-h">${t('Huizenprijzen per stad', 'House prices by city')}</h2><ul class="citylist">${CITIES.map(c => `<li>${cityLink(c)} <span>${eur(gm[c.code].price, lang)}</span></li>`).join('')}</ul>
<p class="more"><a href="${u(L('map'))}">${t(`Alle ${gmFeat.length} gemeenten op de kaart`, `All ${gmFeat.length} municipalities on the map`)}</a></p></section>
${cbsCaveat(lang)}
<p>${t('We doen geen voorspelling van huizenprijzen. Lees in de gidsen wat officiële instanties verwachten, met bronvermelding.', 'We do not forecast house prices. The guides explain what official bodies expect, with sources.')}</p>
</div>`;
    page({ lang, route: r, title: t(`Huizenprijzen Nederland: grafiek ${Y0}–${Y} (CBS)`, `House prices Netherlands: chart and history ${Y0}–${Y}`),
      desc: t(`Gemiddelde huizenprijs in Nederland: ${eur(nat.price, lang)} in ${Y}. Grafiek over ${Y - Y0} jaar, laatste kwartalen, appartement vs eengezinswoning en alle provincies. Bron: CBS.`, `Average house price in the Netherlands: ${eur(nat.price, lang)} in ${Y}. ${Y - Y0}-year chart, latest quarters, apartments vs houses and every province. Source: CBS.`),
      body, sources: ['83625NED', '85792NED', '85791NED'], crumbs: [[t('Huizenprijzen', 'House prices'), r[lang]]],
      schema: [dataset({ lang, route: r, name: t(`Huizenprijzen Nederland ${Y0}–${Y}`, `House prices Netherlands ${Y0}–${Y}`), description: t('Gemiddelde verkoopprijzen van bestaande koopwoningen in Nederland en per provincie, kwartaalcijfers met prijsindex en prijzen per woningtype, uit CBS-tabellen.', 'Average sale prices of existing owner-occupied homes in the Netherlands and by province, quarterly figures with the price index, and prices by dwelling type, from CBS tables.'), tables: ['83625NED', '85792NED', '85791NED'] })],
      scripts: `<script src="${BASE}/js/site.js" defer></script>` });
  }

  // ---------------- city pages
  for (const c of CITIES) {
    const r = cityRoute(c.slug), g = gm[c.code], P = pv[g.pv], name = cityName(c, lang);
    const chart = lineChart({ series: [{ name, points: g.series }, { name: t(`provincie ${P.name}`, `province of ${P.name}`), points: P.series, cls: 'muted' }, { name: t('Nederland', 'Netherlands'), points: nat.series, cls: 'muted2' }], fmtY: v => eurK(v, lang), title: t(`Gemiddelde verkoopprijs ${name}, provincie ${P.name} en Nederland, ${Y0}–${Y}`, `Average sale price ${name}, province of ${P.name} and the Netherlands, ${Y0}–${Y}`), xEvery: 2 });
    const rec = housing.recent[c.code]?.filter(x => /KW/.test(x.period)).slice(-6);
    const nb = neighbours[c.code].map(n => ({ c: n, g: gm[n] })).sort((a, b) => (b.g.price ?? -1) - (a.g.price ?? -1));
    const pairs = PAIRS.filter(p => p.includes(c.slug));
    const vsNat = change(nat.price, g.price), vsPv = change(P.price, g.price);
    const d = g.area, dh = g.areaHouse, da = g.areaApt;
    const kv = [
      [t('Gemiddelde WOZ-waarde', 'Average WOZ value'), eur(g.woz, lang)],
      [t('Woningen', 'Dwellings'), num(g.dwellings, lang)],
      [t('Inwoners', 'Inhabitants'), num(g.inhabitants, lang)],
      [t('Koopwoningen / huurwoningen', 'Owner-occupied / rented'), `${pct(g.pctOwner, lang, 0)} / ${pct(g.pctRent, lang, 0)}`],
      [t('Eengezins / meergezins', 'Single-family / multi-family'), `${pct(g.pctSingle, lang, 0)} / ${pct(g.pctMulti, lang, 0)}`],
      [t('Gebouwd in de laatste 10 jaar', 'Built in the last 10 years'), pct(g.built10, lang, 0)],
      [t('Auto’s per huishouden (context, geen maat voor parkeren)', 'Cars per household (context, not a parking measure)'), num(g.cars, lang, 1)],
    ];
    const body = `<div class="wrap">
<h1>${t(`Huizenprijzen ${name}`, `House prices ${name}`)}</h1>
<p class="lead">${t(`In ${Y} was de gemiddelde verkoopprijs van een bestaande koopwoning in ${name} <strong>${eur(g.price, lang)}</strong>. Dat is ${pctStr(g.yoy, lang)} ten opzichte van ${YP} en ${pctStr(g.tenY, lang)} ten opzichte van ${Y0}.`, `In ${Y} the average sale price of an existing owner-occupied home in ${name} was <strong>${eur(g.price, lang)}</strong>. That is ${pctStr(g.yoy, lang)} compared with ${YP} and ${pctStr(g.tenY, lang)} compared with ${Y0}.`)}</p>
<p>${t(`Dat is ${pctStr(vsNat, lang)} ten opzichte van het landelijke gemiddelde (${eur(nat.price, lang)}) en ${pctStr(vsPv, lang)} ten opzichte van de provincie ${esc(P.name)} (${eur(P.price, lang)}).`, `That is ${pctStr(vsNat, lang)} compared with the national average (${eur(nat.price, lang)}) and ${pctStr(vsPv, lang)} compared with the province of ${esc(P.name)} (${eur(P.price, lang)}).`)}</p>
${stamp(lang)}
<section aria-labelledby="trend-h"><h2 id="trend-h">${t(`Prijsontwikkeling ${Y0}–${Y}`, `Price trend ${Y0}–${Y}`)}</h2>${chart}
${chartTable({ summary: t('Cijfers in de grafiek', 'Figures in the chart'), head: [t('Jaar', 'Year'), name, t(`provincie ${P.name}`, `province of ${P.name}`), t('Nederland', 'Netherlands')], rows: years.map((y, i) => [String(y), eur(g.series[i][1], lang), eur(P.series[i][1], lang), eur(nat.series[i][1], lang)]) })}</section>
${rec?.length ? `<section aria-labelledby="q-h"><h2 id="q-h">${t('De laatste kwartalen', 'The latest quarters')}</h2><p>${t(`Voor ${name} publiceert het CBS ook kwartaalcijfers met een prijsindex (tabel 85792NED).`, `For ${name}, CBS also publishes quarterly figures with a price index (table 85792NED).`)}</p>
<div class="scroll"><table><thead><tr><th scope="col">${t('Periode', 'Period')}</th><th scope="col" class="n">${t('Gemiddelde prijs', 'Average price')}</th><th scope="col" class="n">${t('Prijsindex t.o.v. een jaar eerder', 'Price index vs a year earlier')}</th><th scope="col" class="n">${t('Verkocht', 'Sold')}</th></tr></thead><tbody>
${rec.map(x => `<tr><th scope="row">${esc(period(x.period, lang))}</th><td class="n">${eur(x.avg, lang)}</td><td class="n">${pctStr(x.yoy, lang)}</td><td class="n">${num(x.sold, lang)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
<section aria-labelledby="stock-h"><h2 id="stock-h">${t('WOZ-waarde en woningvoorraad', 'WOZ value and housing stock')}</h2>
<dl class="facts">${kv.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
<p class="src-inline">${t(`Bron: CBS Kerncijfers wijken en buurten (${housing.kernTable}).`, `Source: CBS key figures for districts and neighbourhoods (${housing.kernTable}).`)}</p></section>
<section aria-labelledby="area-h"><h2 id="area-h">${t('Hoe groot zijn de woningen?', 'How big are the homes?')}</h2>
<p>${d ? t(`De middelste woning in ${name} valt in de klasse <strong>${esc(d.median.name)}</strong>. Bij eengezinswoningen is dat ${esc(dh?.median.name ?? NA[lang])}, bij meergezinswoningen ${esc(da?.median.name ?? NA[lang])}.`, `The middle home in ${name} falls in the <strong>${esc(d.median.name)}</strong> class. For single-family homes it is ${esc(dh?.median.name ?? NA[lang])}, for multi-family homes ${esc(da?.median.name ?? NA[lang])}.`) : NA[lang]}</p>
<h3 id="bars-${c.slug}">${t(`Woningvoorraad naar oppervlakte (begin ${housing.area.year}), alle woningen`, `Housing stock by floor area (start of ${housing.area.year}), all homes`)}</h3>
${areaBars(d, lang, `bars-${c.slug}`)}
<p>${t(`Prijzen per woningtype publiceert het CBS alleen voor heel Nederland, niet voor ${name}. Landelijk kostte een eengezinswoning in het ${period(nationalSplit.house.period, lang)} gemiddeld ${eur(nationalSplit.house.avg, lang)} en een appartement ${eur(nationalSplit.apt.avg, lang)} (CBS 85791NED).`, `CBS publishes prices by dwelling type only for the Netherlands as a whole, not for ${name}. Nationally, a single-family home sold for ${eur(nationalSplit.house.avg, lang)} on average in ${period(nationalSplit.house.period, lang)} and an apartment for ${eur(nationalSplit.apt.avg, lang)} (CBS 85791NED).`)}</p>
<p class="src-inline">${t(`Bron: CBS 83704NED. Woningen met onbekende oppervlakte (${num(d?.unknown, lang)}) tellen niet mee in de percentages.`, `Source: CBS 83704NED. Homes with unknown floor area (${num(d?.unknown, lang)}) are left out of the percentages.`)}</p></section>
<section aria-labelledby="nb-h"><h2 id="nb-h">${t(`${name} en de buurgemeenten`, `${name} and neighbouring municipalities`)}</h2>
${localMap(c, lang)}
<div class="scroll"><table class="sortable"><thead><tr><th scope="col">${t('Gemeente', 'Municipality')}</th><th scope="col" class="n">${t(`Prijs ${Y}`, `Price ${Y}`)}</th><th scope="col" class="n">${t(`t.o.v. ${YP}`, `vs ${YP}`)}</th><th scope="col" class="n">WOZ</th></tr></thead><tbody>
${[{ c: c.code, g }, ...nb].map(x => `<tr${x.c === c.code ? ' class="self"' : ''}><th scope="row">${cityByCode[x.c] && x.c !== c.code ? cityLink(cityByCode[x.c]) : esc(muniName(x.c, lang))}</th><td class="n" data-v="${x.g.price}">${eur(x.g.price, lang)}</td><td class="n" data-v="${x.g.yoy?.toFixed(3)}">${pctStr(x.g.yoy, lang)}</td><td class="n" data-v="${x.g.woz}">${eur(x.g.woz, lang)}</td></tr>`).join('')}</tbody></table></div></section>
<section aria-labelledby="cmp-h"><h2 id="cmp-h">${t('Vergelijken', 'Compare')}</h2><ul class="links">
${pairs.map(([a, b]) => `<li><a href="${u(pairRoute(a, b)[lang])}">${esc(cityName(bySlug[a], lang))} ${t('of', 'vs')} ${esc(cityName(bySlug[b], lang))}</a></li>`).join('')}</ul>
<h3>${t('Steden in de buurt', 'Nearby cities')}</h3><ul class="links">${c.near.slice(0, 4).map(x => `<li>${cityLink(x.c)} <span class="muted">(${num(x.km, lang)} km)</span></li>`).join('')}</ul></section>
${cbsCaveat(lang)}
${notShown(lang, { city: name })}
${adSlot('advisor', lang, r)}
</div>`;
    page({ lang, route: r, title: t(`Huizenprijzen ${name} ${Y}: gemiddelde prijs en trend`, `House prices ${name} ${Y}: average price and trend`),
      desc: t(`Gemiddelde huizenprijs in ${name}: ${eur(g.price, lang)} in ${Y} (${pctStr(g.yoy, lang)}). Trend sinds ${Y0}, WOZ-waarde, woninggrootte en buurgemeenten. Bron: CBS.`, `Average house price in ${name}: ${eur(g.price, lang)} in ${Y} (${pctStr(g.yoy, lang)}). Trend since ${Y0}, WOZ value, home sizes and neighbouring municipalities. Source: CBS.`),
      body, sources: ['83625NED', ...(rec?.length ? ['85792NED'] : []), '85791NED', '86165NED', '83704NED', 'pdok'], crumbs: [[t('Huizenprijzen', 'House prices'), ROUTES.prices[lang]], [name, r[lang]]],
      schema: [dataset({ lang, route: r, name: t(`Huizenprijzen ${name} ${Y0}–${Y}`, `House prices ${name} ${Y0}–${Y}`), description: t(`Gemiddelde verkoopprijs van bestaande koopwoningen in ${name} per jaar, WOZ-waarde, woningvoorraad en oppervlakteklassen, uit CBS-tabellen.`, `Average sale price of existing owner-occupied homes in ${name} by year, WOZ value, housing stock and floor-area classes, from CBS tables.`), tables: ['83625NED', '86165NED', '83704NED'], spatial: name })],
      scripts: `<script src="${BASE}/js/site.js" defer></script>` });
  }

  // ---------------- compare pairs and hub
  const compareRows = (a, b) => [
    [t(`Gemiddelde verkoopprijs ${Y}`, `Average sale price ${Y}`), eur(a.price, lang), eur(b.price, lang)],
    [t(`Verandering t.o.v. ${YP}`, `Change vs ${YP}`), pctStr(a.yoy, lang), pctStr(b.yoy, lang)],
    [t(`Verandering t.o.v. ${Y0}`, `Change vs ${Y0}`), pctStr(a.tenY, lang), pctStr(b.tenY, lang)],
    [t('Gemiddelde WOZ-waarde', 'Average WOZ value'), eur(a.woz, lang), eur(b.woz, lang)],
    [t('Koopwoningen', 'Owner-occupied'), pct(a.pctOwner, lang, 0), pct(b.pctOwner, lang, 0)],
    [t('Meergezinswoningen', 'Multi-family homes'), pct(a.pctMulti, lang, 0), pct(b.pctMulti, lang, 0)],
    [t('Klasse van de middelste woning', 'Floor-area class of the middle home'), a.area?.median.name ?? NA[lang], b.area?.median.name ?? NA[lang]],
    [t('Woningen', 'Dwellings'), num(a.dwellings, lang), num(b.dwellings, lang)],
    [t('Inwoners', 'Inhabitants'), num(a.inhabitants, lang), num(b.inhabitants, lang)],
    [t('Auto’s per huishouden (context)', 'Cars per household (context)'), num(a.cars, lang, 1), num(b.cars, lang, 1)],
  ];
  for (const [sa, sb] of PAIRS) {
    const A = bySlug[sa], B = bySlug[sb], a = gm[A.code], b = gm[B.code], na = cityName(A, lang), nb = cityName(B, lang), r = pairRoute(sa, sb);
    const diff = a.price - b.price, rel = change(b.price, a.price);
    const chart = lineChart({ series: [{ name: na, points: a.series }, { name: nb, points: b.series, cls: 'second' }], fmtY: v => eurK(v, lang), title: t(`Gemiddelde verkoopprijs ${na} en ${nb}, ${Y0}–${Y}`, `Average sale price ${na} and ${nb}, ${Y0}–${Y}`), xEvery: 2 });
    const others = PAIRS.filter(p => p !== undefined && (p.includes(sa) || p.includes(sb)) && !(p[0] === sa && p[1] === sb));
    const body = `<div class="wrap">
<h1>${t(`${na} of ${nb}: huizenprijzen vergeleken`, `${na} vs ${nb}: house prices compared`)}</h1>
<p class="lead">${t(`In ${Y} was een bestaande koopwoning in ${diff >= 0 ? na : nb} gemiddeld ${eur(Math.abs(diff), lang)} duurder dan in ${diff >= 0 ? nb : na}. Gemiddeld ${eur(a.price, lang)} in ${na} tegen ${eur(b.price, lang)} in ${nb} (${pctStr(rel, lang)}).`, `In ${Y} an existing owner-occupied home in ${diff >= 0 ? na : nb} cost ${eur(Math.abs(diff), lang)} more on average than in ${diff >= 0 ? nb : na}. On average ${eur(a.price, lang)} in ${na} against ${eur(b.price, lang)} in ${nb} (${pctStr(rel, lang)}).`)}</p>
${stamp(lang)}
<div class="scroll"><table class="cmp"><thead><tr><th scope="col"><span class="vh">${t('Kenmerk', 'Measure')}</span></th><th scope="col" class="n">${cityLink(A)}</th><th scope="col" class="n">${cityLink(B)}</th></tr></thead><tbody>
${compareRows(a, b).map(([k, x, y]) => `<tr><th scope="row">${esc(k)}</th><td class="n">${esc(x)}</td><td class="n">${esc(y)}</td></tr>`).join('')}</tbody></table></div>
<section aria-labelledby="trend-h"><h2 id="trend-h">${t(`Prijsontwikkeling ${Y0}–${Y}`, `Price trend ${Y0}–${Y}`)}</h2>${chart}
${chartTable({ summary: t('Cijfers in de grafiek', 'Figures in the chart'), head: [t('Jaar', 'Year'), na, nb], rows: years.map((y, i) => [String(y), eur(a.series[i][1], lang), eur(b.series[i][1], lang)]) })}</section>
<section aria-labelledby="area-h"><h2 id="area-h">${t('Woninggrootte', 'Home sizes')}</h2><div class="two">
<div><h3 id="ba-${sa}">${esc(na)}</h3>${areaBars(a.area, lang, `ba-${sa}`)}</div><div><h3 id="bb-${sb}">${esc(nb)}</h3>${areaBars(b.area, lang, `bb-${sb}`)}</div></div>
<p class="src-inline">${t(`Woningvoorraad naar oppervlakteklasse, begin ${housing.area.year} (CBS 83704NED).`, `Housing stock by floor-area class, start of ${housing.area.year} (CBS 83704NED).`)}</p></section>
${others.length ? `<section aria-labelledby="more-h"><h2 id="more-h">${t('Meer vergelijkingen', 'More comparisons')}</h2><ul class="links">${others.map(([x, y]) => `<li><a href="${u(pairRoute(x, y)[lang])}">${esc(cityName(bySlug[x], lang))} ${t('of', 'vs')} ${esc(cityName(bySlug[y], lang))}</a></li>`).join('')}</ul><p class="more"><a href="${u(L('compare'))}">${t('Vergelijk twee andere gemeenten', 'Compare two other municipalities')}</a></p></section>` : ''}
${cbsCaveat(lang)}
<p class="note">${t('Woonlasten, kamers, parkeren en prijs per m² staan hier niet: daarvoor is geen vrije officiële bron per gemeente.', 'Living costs, rooms, parking and price per m² are not shown: there is no free official source for them by municipality.')} <a href="${u(L('methods'))}">${t('Methode en bronnen', 'Methods and sources')}</a></p>
${adSlot('verhuismatch', lang, r)}
</div>`;
    page({ lang, route: r, title: t(`${na} of ${nb}: huizenprijzen vergeleken`, `${na} vs ${nb}: house prices compared`),
      desc: t(`${na} of ${nb}? Gemiddelde huizenprijs ${Y}: ${eur(a.price, lang)} tegen ${eur(b.price, lang)}. Trend, WOZ-waarde, koopwoningen en woninggrootte naast elkaar. Bron: CBS.`, `${na} or ${nb}? Average house price ${Y}: ${eur(a.price, lang)} against ${eur(b.price, lang)}. Trend, WOZ value, ownership and home sizes side by side. Source: CBS.`),
      body, sources: ['83625NED', '86165NED', '83704NED'], crumbs: [[t('Vergelijken', 'Compare'), ROUTES.compare[lang]], [`${na} ${t('of', 'vs')} ${nb}`, r[lang]]],
      schema: [dataset({ lang, route: r, name: t(`Huizenprijzen ${na} en ${nb}`, `House prices ${na} and ${nb}`), description: t(`Gemiddelde verkoopprijs, WOZ-waarde, woningvoorraad en oppervlakteklassen van ${na} en ${nb} naast elkaar, uit CBS-tabellen.`, `Average sale price, WOZ value, housing stock and floor-area classes of ${na} and ${nb} side by side, from CBS tables.`), tables: ['83625NED', '86165NED', '83704NED'], spatial: `${na}, ${nb}` })] });
  }
  {
    const r = ROUTES.compare;
    const opts = Object.keys(gm).sort((a, b) => muniName(a, lang).localeCompare(muniName(b, lang), lang)).map(c => `<option value="${c}">${esc(muniName(c, lang))}</option>`).join('');
    const pairUrl = Object.fromEntries(PAIRS.map(([a, b]) => [`${bySlug[a].code}|${bySlug[b].code}`, u(pairRoute(a, b)[lang])]));
    const data = { lang, y: Y, yp: YP, y0: Y0, pairs: pairUrl,
      rows: Object.fromEntries(Object.entries(gm).map(([c, g]) => [c, { n: muniName(c, lang), p: g.price, yoy: g.yoy, ten: g.tenY, woz: g.woz, own: g.pctOwner, multi: g.pctMulti, med: g.area?.median.name ?? null, dw: g.dwellings, inh: g.inhabitants, cars: g.cars, url: cityByCode[c] ? u(cityRoute(cityByCode[c].slug)[lang]) : null }])),
      labels: compareRows(gm[CITIES[0].code], gm[CITIES[1].code]).map(r => r[0]),
      i18n: { na: NA[lang], open: t('Open de uitgebreide vergelijking', 'Open the full comparison'), same: t('Kies twee verschillende gemeenten.', 'Choose two different municipalities.') } };
    const body = `<div class="wrap">
<h1>${t('Huizenprijzen vergelijken', 'Compare house prices')}</h1>
<p class="lead">${t(`Zet twee van de ${gmFeat.length} gemeenten naast elkaar: gemiddelde verkoopprijs, WOZ-waarde, woningvoorraad en woninggrootte.`, `Put two of the ${gmFeat.length} municipalities side by side: average sale price, WOZ value, housing stock and home sizes.`)}</p>
${stamp(lang)}
<form id="cmpform" class="cmpform" action="" method="get"><div><label for="ca">${t('Gemeente 1', 'Municipality 1')}</label><select id="ca" name="a">${opts}</select></div><div><label for="cb">${t('Gemeente 2', 'Municipality 2')}</label><select id="cb" name="b">${opts}</select></div><button type="submit" class="btn"${gc('cta-compare-submit')}>${t('Vergelijk', 'Compare')}</button></form>
<div id="cmpout" aria-live="polite"></div>
<noscript><p class="note">${t('Deze vergelijker werkt met JavaScript. Zonder JavaScript kun je de vaste vergelijkingen hieronder gebruiken.', 'This tool needs JavaScript. Without it, use the fixed comparisons below.')}</p></noscript>
<section aria-labelledby="pairs-h"><h2 id="pairs-h">${t('Populaire vergelijkingen', 'Popular comparisons')}</h2><ul class="links cols">
${PAIRS.map(([a, b]) => `<li><a href="${u(pairRoute(a, b)[lang])}">${esc(cityName(bySlug[a], lang))} ${t('of', 'vs')} ${esc(cityName(bySlug[b], lang))}</a></li>`).join('')}</ul></section>
${cbsCaveat(lang)}
${adSlot('verhuismatch', lang, r)}
</div>${jsonData('cmpdata', data)}`;
    page({ lang, route: r, title: t('Huizenprijzen vergelijken per gemeente', 'Compare house prices between Dutch cities'),
      desc: t(`Vergelijk de gemiddelde huizenprijs, WOZ-waarde en woningvoorraad van twee gemeenten. Alle ${gmFeat.length} gemeenten, officiële CBS-cijfers.`, `Compare the average house price, WOZ value and housing stock of two Dutch municipalities. All ${gmFeat.length} municipalities, official CBS figures.`),
      body, sources: ['83625NED', '86165NED', '83704NED'], crumbs: [[t('Vergelijken', 'Compare'), r[lang]]],
      scripts: `<script src="${BASE}/js/compare.js" defer></script>` });
  }

  // ---------------- mortgage calculator
  {
    const r = ROUTES.mortgage, a = params.affordability;
    const defRate = { F: lastObs('F'), I: lastObs('I'), O: lastObs('O'), P: lastObs('P') };
    const ex = maxMortgage({ income: 46500, ratePct: defRate.O.rate, fixedYears: 10 }, params);
    const exSeh = maxMortgage({ income: 46500, ratePct: 5, fixedYears: 10 }, params);
    const labelOpt = { '': t('Onbekend of geen label', 'Unknown or no label'), EFG: 'E, F, G', CD: 'C, D', AB: 'A, B', 'A+/A++': 'A+, A++', 'A+++': 'A+++', 'A++++': 'A++++', 'A++++ garantie': t('A++++ met energieprestatiegarantie', 'A++++ with energy performance guarantee') };
    const data = { lang, params: { affordability: a, nhg: params.nhg }, rates: Object.fromEntries(Object.entries(defRate).map(([k, v]) => [k, v.rate])),
      rateHelp: Object.fromEntries(SERIES_ORDER.map(k => [k, t(`Standaard: gemiddelde rente op nieuwe hypotheken, reeks “${series[k].label.nl}” (ECB/DNB, ${monthLong(defRate[k].month, lang)}). Vul de rente uit je offerte in.`, `Default: average rate on new mortgages, series “${series[k].label.en}” (ECB/DNB, ${monthLong(defRate[k].month, lang)}). Enter the rate from your offer.`)])),
      i18n: { minApplied: t(`De toetsrente is verhoogd naar het minimum van ${rulePct(a.minToetsrente, lang)}, omdat de rentevaste periode korter is dan 10 jaar.`, `The test rate was raised to the minimum of ${rulePct(a.minToetsrente, lang)} because the fixed period is shorter than 10 years.`), actual: t('De toetsrente is je eigen rente, omdat de rente 10 jaar of langer vastligt.', 'The test rate is your own rate, because it is fixed for 10 years or longer.'), aboveMin: t(`De rentevaste periode is korter dan 10 jaar. Je rente is niet lager dan het minimum van ${rulePct(a.minToetsrente, lang)}, dus we toetsen met je eigen rente.`, `The fixed period is shorter than 10 years. Your rate is not below the minimum of ${rulePct(a.minToetsrente, lang)}, so we test at your own rate.`), byValue: t('Begrensd door de woningwaarde.', 'Capped by the home value.'), nhgYes: t(`Binnen de NHG-grens van ${eur(params.nhg.limit, lang)}.`, `Within the NHG limit of ${eur(params.nhg.limit, lang)}.`), nhgNo: t(`Boven de NHG-grens van ${eur(params.nhg.limit, lang)}.`, `Above the NHG limit of ${eur(params.nhg.limit, lang)}.`), none: '–' } };
    const ratesNote = SERIES_ORDER.map(k => `${esc(series[k].label[lang])}: ${pct(defRate[k].rate, lang, 2)}`).join('; ');
    const body = `<div class="wrap">
<h1>${t('Maximale hypotheek berekenen', 'Mortgage calculator: how much can I borrow?')}</h1>
<p class="lead">${t(`Bereken hoeveel je maximaal kunt lenen op basis van je inkomen. De rekenhulp gebruikt de financieringslasttabellen van de Tijdelijke regeling hypothecair krediet ${params.year}. De uitkomst is indicatief en geen advies.`, `Calculate the most you can borrow based on your income. The calculator uses the lending tables of the Dutch Temporary Regulation on Mortgage Credit (Trhk) ${params.year}. The result is indicative and not advice.`)}</p>
<div class="calc">
<form id="mortgage" class="calc-form" onsubmit="return false">
<div class="f"><label for="income">${t('Bruto toetsinkomen per jaar (samen)', 'Gross test income per year (combined)')}</label><input id="income" name="income" type="number" inputmode="numeric" min="0" step="500" value="46500"><p class="help">${t('Voorbeeldbedrag; vul je eigen inkomen in. Heb je een partner, vul dan het totaal in.', 'Example amount; enter your own income. With a partner, enter the total.')}</p></div>
<div class="f"><label for="fixed">${t('Rentevaste periode', 'Fixed-rate period')}</label><select id="fixed" name="fixed"><option value="1">${t('1 jaar of variabel', '1 year or variable')}</option><option value="5">${t('5 jaar', '5 years')}</option><option value="10" selected>${t('10 jaar', '10 years')}</option><option value="15">${t('15 jaar', '15 years')}</option><option value="20">${t('20 jaar', '20 years')}</option><option value="30">${t('30 jaar', '30 years')}</option></select></div>
<div class="f"><label for="rate">${t('Hypotheekrente (%)', 'Mortgage interest rate (%)')}</label><input id="rate" name="rate" type="number" inputmode="decimal" min="0" max="15" step="0.01" value="${defRate.O.rate}"><p class="help" id="ratehelp">${t(`Standaard: gemiddelde rente op nieuwe hypotheken, reeks “${series.O.label.nl}” (ECB/DNB, ${monthLong(defRate.O.month, lang)}). Vul de rente uit je offerte in.`, `Default: average rate on new mortgages, series “${series.O.label.en}” (ECB/DNB, ${monthLong(defRate.O.month, lang)}). Enter the rate from your offer.`)}</p></div>
<div class="f"><label for="debt">${t('Studieschuld: maandbedrag aan DUO (€)', 'Student debt: monthly payment to DUO (€)')}</label><input id="debt" name="debt" type="number" inputmode="numeric" min="0" step="10" value="0"></div>
<div class="f"><label for="label">${t('Energielabel van de woning', 'Energy label of the home')}</label><select id="label" name="label">${['', ...ENERGY_LABELS].map(k => `<option value="${esc(k)}">${esc(labelOpt[k])}</option>`).join('')}</select></div>
<div class="f check"><label><input id="saving" name="saving" type="checkbox"> ${t('Ik wil energiebesparende maatregelen meefinancieren', 'I want to finance energy-saving measures')}</label></div>
<div class="f check"><label><input id="aow" name="aow" type="checkbox"> ${t('Ik heb de AOW-leeftijd bereikt', 'I have reached the Dutch state pension (AOW) age')}</label></div>
<div class="f"><label for="value">${t('Woningwaarde (optioneel, €)', 'Home value (optional, €)')}</label><input id="value" name="value" type="number" inputmode="numeric" min="0" step="1000" placeholder="${t('Bijv. de koopsom', 'E.g. the purchase price')}"></div>
</form>
<div class="calc-out" id="mortgage-out" aria-live="polite">
<p class="big-label">${t('Maximale hypotheek (indicatief)', 'Maximum mortgage (indicative)')}</p><p class="big" id="o-total">${eur(ex.total, lang)}</p>
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
      body, sources: ['trhk', 'trhk_wet', 'nibud', 'nhg', 'ecb'], crumbs: [[t('Maximale hypotheek', 'Mortgage calculator'), r[lang]]],
      schema: [webApp({ lang, route: r, name: t('Maximale hypotheek berekenen', 'Mortgage calculator Netherlands'), description: t(`Indicatieve maximale hypotheek op basis van de Trhk ${params.year}.`, `Indicative maximum mortgage based on the Dutch Trhk ${params.year}.`) })],
      scripts: `<script type="module" src="${BASE}/js/mortgage.js"></script>` });
  }

  // ---------------- buying costs calculator
  {
    const r = ROUTES.costs, tt = params.transferTax;
    const defPrice = nat.price;
    const ex = buyingCosts({ price: defPrice, mortgage: defPrice, use: 'own', age: null, nhg: true }, params);
    const extras = [['notary', t('Notaris (akte van levering en hypotheekakte)', 'Notary (transfer deed and mortgage deed)')], ['valuation', t('Taxatie', 'Valuation')], ['advice', t('Hypotheekadvies en bemiddeling', 'Mortgage advice and arrangement')], ['guarantee', t('Bankgarantie', 'Bank guarantee')], ['other', t('Overig (bijv. aankoopmakelaar, bouwkundige keuring)', 'Other (e.g. buying agent, building survey)')]];
    const reason = { starter: t('Startersvrijstelling: 0%.', 'First-time buyer exemption: 0%.'), own: t(`Eigen woning: ${rulePct(tt.ownHome, lang)}.`, `Own home: ${rulePct(tt.ownHome, lang)}.`), notMain: t(`Geen hoofdverblijf: ${rulePct(tt.notMainResidence, lang)}.`, `Not a main residence: ${rulePct(tt.notMainResidence, lang)}.`), other: t(`Overig vastgoed: ${rulePct(tt.other, lang)}.`, `Other property: ${rulePct(tt.other, lang)}.`) };
    const data = { lang, params: { transferTax: tt, nhg: params.nhg }, i18n: { reason,
      fail: { age: t(`leeftijd niet ${tt.starterAge[0]} tot ${tt.starterAge[1]} jaar`, `age not ${tt.starterAge[0]} to under ${tt.starterAge[1]}`), firstTime: t('vrijstelling al eerder gebruikt', 'exemption used before'), price: t(`koopsom boven ${eur(tt.starterMaxValue, lang)}`, `price above ${eur(tt.starterMaxValue, lang)}`) },
      noStarter: t('Geen startersvrijstelling', 'No first-time buyer exemption'), nhgOk: t('NHG mogelijk: lening binnen de grens van', 'NHG possible: loan within the limit of'), nhgNo: t('Geen NHG: lening boven de grens van', 'No NHG: loan above the limit of'), nhgOff: t('Geen NHG gekozen.', 'NHG not selected.'), extrasEmpty: t('Nog niet ingevuld. Vraag offertes op en vul de bedragen in.', 'Not filled in yet. Ask for quotes and enter the amounts.') } };
    const body = `<div class="wrap">
<h1>${t('Kosten koper berekenen', 'Buying costs calculator (kosten koper)')}</h1>
<p class="lead">${t(`Bereken de overdrachtsbelasting, de startersvrijstelling en de NHG-kosten volgens de regels van ${params.year}. Kosten die per aanbieder verschillen, zoals notaris en taxatie, vul je zelf in uit je offertes.`, `Calculate the transfer tax, the first-time buyer exemption and the NHG fee under the ${params.year} rules. Costs that differ per provider, such as notary and valuation, you enter yourself from your quotes.`)}</p>
<div class="calc">
<form id="costs" class="calc-form" onsubmit="return false">
<div class="f"><label for="price">${t('Koopsom (€)', 'Purchase price (€)')}</label><input id="price" name="price" type="number" inputmode="numeric" min="0" step="1000" value="${defPrice}"><p class="help">${t(`Standaard: gemiddelde verkoopprijs in Nederland in ${Y} (CBS). Vul je eigen koopsom in.`, `Default: average sale price in the Netherlands in ${Y} (CBS). Enter your own price.`)}</p></div>
<fieldset class="f"><legend>${t('Gebruik van de woning', 'Use of the home')}</legend>
<label><input type="radio" name="use" value="own" checked> ${t('Ik ga er zelf wonen (hoofdverblijf)', 'I will live there (main residence)')}</label>
<label><input type="radio" name="use" value="notMain"> ${t('Geen hoofdverblijf (bijv. verhuur of tweede woning)', 'Not my main residence (e.g. to let or a second home)')}</label>
<label><input type="radio" name="use" value="other"> ${t('Ander vastgoed (geen woning)', 'Other property (not a home)')}</label></fieldset>
<div class="f"><label for="age">${t('Je leeftijd bij de overdracht', 'Your age at transfer')}</label><input id="age" name="age" type="number" inputmode="numeric" min="0" max="120" placeholder="${t('Voor de startersvrijstelling', 'For the starter exemption')}"></div>
<div class="f check"><label><input id="used" name="used" type="checkbox"> ${t('Ik heb de startersvrijstelling al eerder gebruikt', 'I have used the first-time buyer exemption before')}</label></div>
<div class="f"><label for="mortgage-amt">${t('Hypotheekbedrag (€)', 'Mortgage amount (€)')}</label><input id="mortgage-amt" name="mortgage" type="number" inputmode="numeric" min="0" step="1000" value="${defPrice}"><p class="help">${t('Standaard gelijk aan de koopsom. Pas aan.', 'Defaults to the purchase price. Adjust it.')}</p></div>
<div class="f check"><label><input id="nhg" name="nhg" type="checkbox" checked> ${t('Ik wil een hypotheek met NHG', 'I want a mortgage with NHG')}</label></div>
<div class="f check"><label><input id="ebv" name="ebv" type="checkbox"> ${t('Met energiebesparende maatregelen (hogere NHG-grens)', 'With energy-saving measures (higher NHG limit)')}</label></div>
<fieldset class="f"><legend>${t('Kosten uit je offertes (€)', 'Costs from your quotes (€)')}</legend>
<p class="help">${t('Deze kosten zijn marktprijzen en staan niet in de wet. Wij vullen geen bedrag voor je in.', 'These are market prices and are not set by law. We do not fill in an amount for you.')}</p>
${extras.map(([k, l]) => `<label class="sub" for="x-${k}">${esc(l)}</label><input id="x-${k}" name="${k}" type="number" inputmode="numeric" min="0" step="50" placeholder="0">`).join('')}</fieldset>
</form>
<div class="calc-out" id="costs-out" aria-live="polite">
<p class="big-label">${t('Kosten koper (indicatief)', 'Buying costs (indicative)')}</p><p class="big" id="k-total">${eur(ex.total, lang)}</p>
<p class="muted" id="k-pct">${t(`${pct(ex.pctOfPrice, lang, 1)} van de koopsom`, `${pct(ex.pctOfPrice, lang, 1)} of the price`)}</p>
<dl class="facts small">
<div><dt>${t('Overdrachtsbelasting', 'Transfer tax')}</dt><dd id="k-tax">${eur(ex.tax.amount, lang)}</dd></div>
<div><dt>${t('NHG-kosten', 'NHG fee')}</dt><dd id="k-nhg">${eur(ex.nhg?.fee ?? 0, lang)}</dd></div>
<div><dt>${t('Kosten uit offertes', 'Costs from quotes')}</dt><dd id="k-extras">${eur(0, lang)}</dd></div>
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
      body, sources: ['obtarief', 'starter', 'wbr', 'nhg', '83625NED'], crumbs: [[t('Kosten koper', 'Buying costs'), r[lang]]],
      schema: [webApp({ lang, route: r, name: t('Kosten koper berekenen', 'Buying costs calculator Netherlands'), description: t(`Indicatieve kosten koper volgens de regels van ${params.year}.`, `Indicative Dutch buying costs under the ${params.year} rules.`) })],
      scripts: `<script type="module" src="${BASE}/js/costs.js"></script>` });
  }

  // ---------------- mortgage rates hub, terms, forecast
  const rateChart = (keys, title, from = 0) => lineChart({ series: keys.map((k, i) => ({ name: series[k].label[lang], points: series[k].data.slice(from).map(d => [d.month, d.rate]), cls: i ? '' : '' })), fmtY: v => pct(v, lang, 1), title, xEvery: 24, fmtX: m => m.slice(0, 4), zero: true });
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
    const body = `<div class="wrap">
<h1>${t('Hypotheekrente in Nederland', 'Mortgage rates in the Netherlands')}</h1>
<p class="lead">${t(`De gemiddelde rente op nieuwe woninghypotheken was ${pct(lastObs('A').rate, lang, 2)} in ${monthLong(rateMonth, lang)} (alle rentevaste perioden). Dit zijn gemiddelden van banken, gemeten door DNB en gepubliceerd door de ECB. Het zijn geen actuele aanbiedingen.`, `The average rate on new home loans was ${pct(lastObs('A').rate, lang, 2)} in ${monthLong(rateMonth, lang)} (all fixed periods). These are bank averages, measured by DNB and published by the ECB. They are not current offers.`)}</p>
<p class="stamp">${t(`Laatste maand in de ECB-statistiek: ${esc(monthLong(rateMonth, lang))} (opgehaald ${time(rates.fetchedAt, lang)})`, `Latest month in the ECB statistics: ${esc(monthLong(rateMonth, lang))} (fetched ${time(rates.fetchedAt, lang)})`)}</p>
<section aria-labelledby="avg-h"><h2 id="avg-h">${t('Gemiddelde rente per rentevaste periode', 'Average rate by fixed period')}</h2>
${rateTable([...SERIES_ORDER, 'A'])}
${rateChart(SERIES_ORDER, t('Gemiddelde hypotheekrente per rentevaste periode, laatste 10 jaar', 'Average mortgage rate by fixed period, last 10 years'))}
<ul class="links">${TERMS.map(x => `<li><a href="${u(termRoute(x.years)[lang])}">${t(`Hypotheekrente ${x.years} jaar vast`, `${x.years}-year fixed rate`)}</a></li>`).join('')}<li><a href="${u(L('forecast'))}">${t('Hypotheekrente: verwachting en historie', 'Mortgage rates: forecast and history')}</a></li></ul></section>
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
      body, sources: ['ecb', 'lenders'], crumbs: [[t('Hypotheekrente', 'Mortgage rates'), r[lang]]],
      schema: [rateDataset(lang, r)] });
  }
  for (const term of TERMS) {
    const r = termRoute(term.years), k = term.series, l = lastObs(k), y = obsMonthsBack(k, 12);
    const ys = series[k].data.filter(d => d.rate != null), lo = ys.reduce((a, b) => b.rate < a.rate ? b : a), hi = ys.reduce((a, b) => b.rate > a.rate ? b : a);
    const bucket = series[k].label[lang];
    const show10 = term.years === 10;
    const body = `<div class="wrap">
<h1>${t(`Hypotheekrente ${term.years} jaar vast`, `${term.years}-year fixed mortgage rate in the Netherlands`)}</h1>
<p class="lead">${t(`De ECB/DNB-statistiek kent geen aparte reeks voor ${term.years} jaar vast. De dichtstbijzijnde reeks is <strong>${esc(bucket)}</strong>. Daarin was de gemiddelde rente op nieuwe hypotheken ${pct(l.rate, lang, 2)} in ${monthLong(l.month, lang)}.`, `The ECB/DNB statistics have no separate series for ${term.years} years fixed. The closest series is <strong>${esc(bucket)}</strong>. In that series the average rate on new mortgages was ${pct(l.rate, lang, 2)} in ${monthLong(l.month, lang)}.`)}</p>
<p class="stamp">${t(`Laatste maand in de ECB-statistiek: ${esc(monthLong(rateMonth, lang))} (opgehaald ${time(rates.fetchedAt, lang)})`, `Latest month in the ECB statistics: ${esc(monthLong(rateMonth, lang))} (fetched ${time(rates.fetchedAt, lang)})`)}</p>
<dl class="facts">
<div><dt>${esc(monthLong(l.month, lang))}</dt><dd>${pct(l.rate, lang, 2)}</dd></div>
<div><dt>${t('Een jaar eerder', 'A year earlier')} (${esc(monthLong(y.month, lang))})</dt><dd>${pct(y.rate, lang, 2)}</dd></div>
<div><dt>${t('Laagste maand in de reeks', 'Lowest month in the series')} (${esc(monthLong(lo.month, lang))})</dt><dd>${pct(lo.rate, lang, 2)}</dd></div>
<div><dt>${t('Hoogste maand in de reeks', 'Highest month in the series')} (${esc(monthLong(hi.month, lang))})</dt><dd>${pct(hi.rate, lang, 2)}</dd></div>
</dl>
<section aria-labelledby="ch-h"><h2 id="ch-h">${t('Ontwikkeling', 'Trend')}</h2>
${rateChart([k, 'A'], t(`Gemiddelde hypotheekrente, ${bucket} en alle looptijden`, `Average mortgage rate, ${bucket} and all fixed periods`))}
${chartTable({ summary: t('Jaargemiddelden', 'Yearly averages'), head: [t('Jaar', 'Year'), bucket, t('Maanden in de data', 'Months in the data')], rows: yearlyAverages(series[k].data).map(x => [String(x.year), pct(x.avg, lang, 2), String(x.months)]) })}</section>
<section class="prose" aria-labelledby="map-h"><h2 id="map-h">${t('Hoe we de looptijden indelen', 'How we map fixed periods')}</h2>
<ul><li>${t('5 jaar vast → reeks “1–5 jaar vast”', '5 years fixed → series “1–5 years fixed”')}</li><li>${t('10 jaar vast → reeks “5–10 jaar vast”', '10 years fixed → series “5–10 years fixed”')}</li><li>${t('20 en 30 jaar vast → reeks “meer dan 10 jaar vast”', '20 and 30 years fixed → series “over 10 years fixed”')}</li></ul>
<p>${t('Een reeks is een gemiddelde over alle leningen in die groep. Voor 20 en 30 jaar vast is het dus hetzelfde cijfer.', 'A series is an average over all loans in that group. For 20 and 30 years fixed it is the same figure.')}</p></section>
<section aria-labelledby="lend-h"><h2 id="lend-h">${t('Tarieven van geldverstrekkers', 'Lender rates')}</h2>
${show10 ? lenderTable() : `<p>${t(`We hebben nog geen gecontroleerde tarieven van geldverstrekkers voor ${term.years} jaar vast. Zie de <a href="${u(L('rates'))}">hypotheekrente-pagina</a> voor de tarieven die we wel hebben.`, `We have no checked lender rates for ${term.years} years fixed yet. See the <a href="${u(L('rates'))}">mortgage rates page</a> for the rates we do have.`)}</p>`}</section>
<ul class="links">${TERMS.filter(x => x !== term).map(x => `<li><a href="${u(termRoute(x.years)[lang])}">${t(`${x.years} jaar vast`, `${x.years} years fixed`)}</a></li>`).join('')}<li><a href="${u(L('rates'))}">${t('Alle rentevaste perioden', 'All fixed periods')}</a></li><li><a href="${u(L('mortgage'))}">${t('Maximale hypotheek berekenen', 'Mortgage calculator')}</a></li></ul>
<p class="nfa-inline"><strong>${t('Geen advies.', 'Not advice.')}</strong> ${t('Gemiddelden zijn geen aanbod.', 'Averages are not offers.')}</p>
</div>`;
    page({ lang, route: r, title: t(`Hypotheekrente ${term.years} jaar vast: gemiddelde en trend`, `${term.years}-year fixed mortgage rate Netherlands: average and trend`),
      desc: t(`Hypotheekrente ${term.years} jaar vast: gemiddeld ${pct(l.rate, lang, 2)} in ${monthLong(l.month, lang)} (reeks ${bucket}, ECB/DNB). Ontwikkeling sinds ${series[k].data[0].month.slice(0, 4)}, laagste en hoogste maand. Geen advies.`, `${term.years}-year fixed mortgage rate: average ${pct(l.rate, lang, 2)} in ${monthLong(l.month, lang)} (series ${bucket}, ECB/DNB). Trend since ${series[k].data[0].month.slice(0, 4)}, lowest and highest month. Not advice.`),
      body, sources: show10 ? ['ecb', 'lenders'] : ['ecb'], schema: [rateDataset(lang, r, bucket)], crumbs: [[t('Hypotheekrente', 'Mortgage rates'), ROUTES.rates[lang]], [t(`${term.years} jaar vast`, `${term.years} years fixed`), r[lang]]] });
  }
  {
    const r = ROUTES.forecast;
    const yrs = yearlyAverages(series.A.data);
    const body = `<div class="wrap">
<h1>${t('Hypotheekrente: verwachting en historie', 'Dutch mortgage rates: forecast and history')}</h1>
<p class="lead">${t('Wij publiceren geen renteverwachting. Niemand kan de rente betrouwbaar voorspellen. Op deze pagina staat wat de officiële cijfers laten zien over de afgelopen 10 jaar.', 'We do not publish a rate forecast. Nobody can predict rates reliably. This page shows what the official figures say about the past 10 years.')}</p>
<p class="stamp">${t(`Laatste maand in de ECB-statistiek: ${esc(monthLong(rateMonth, lang))} (opgehaald ${time(rates.fetchedAt, lang)})`, `Latest month in the ECB statistics: ${esc(monthLong(rateMonth, lang))} (fetched ${time(rates.fetchedAt, lang)})`)}</p>
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
      body, sources: ['ecb', 'trhk'], crumbs: [[t('Hypotheekrente', 'Mortgage rates'), ROUTES.rates[lang]], [t('Verwachting', 'Forecast'), r[lang]]] });
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
