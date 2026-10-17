// Browser check of the built site, served under /woningmarkt/ like GitHub Pages.
// Loads every sitemap URL (plus 404) at desktop (1440 px) and mobile (390 px) widths and reports console errors,
// failed requests and horizontal overflow. Then drives the map, both calculators, the comparison tool and a chart.
// Full-page screenshots of key pages go to verify/v3/. Usage: node build.mjs && node scripts/check.mjs
import fs from 'node:fs'; import { serve } from './serve.mjs'; import { launch } from './chrome.mjs';
const PORT = 4179, ORIGIN = `http://127.0.0.1:${PORT}`, SITE = 'https://cerberostech.github.io';
const server = await serve(PORT);
const urls = [...fs.readFileSync('dist/sitemap.xml', 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace(SITE, ORIGIN));
urls.push(`${ORIGIN}/woningmarkt/does-not-exist/`);
const VIEWS = [['desktop', 1440, 900, false], ['mobile', 390, 844, true]];
// GoatCounter's count.js is answered locally by a stub, so the check never counts a visit and runs offline.
// The stub records that the script loaded and how many elements carry a click name.
const stubs = { '*://gc.zgo.at/*': 'window.__gc = { loaded: (window.__gc?.loaded || 0) + 1, clicks: document.querySelectorAll("[data-goatcounter-click]").length };' };
const OUTDIR = 'verify/v3';
const SHOTS = [['home', ''], ['kaart-selected', 'kaart/#GM0363'], ['city-amsterdam', 'huizenprijzen/amsterdam/'], ['maximale-hypotheek', 'maximale-hypotheek-berekenen/'],
  ['kosten-koper', 'kosten-koper-berekenen/'], ['hypotheekrente', 'hypotheekrente/'], ['vergelijk-amsterdam-vs-utrecht', 'vergelijk/amsterdam-vs-utrecht/'],
  ['en-house-prices', 'en/house-prices/'], ['guide-kosten-koper', 'gidsen/kosten-koper/']];
fs.mkdirSync(OUTDIR, { recursive: true });
const settle = ms => `document.fonts.ready.then(() => new Promise(r => setTimeout(r, ${ms})))`;
const b = await launch();
const problems = [];
let loads = 0, gcClicks = 0;
for (const [name, w, h, mobile] of VIEWS) {
  const tab = await b.open(w, h, { mobile, stubs });
  for (const url of urls) {
    await tab.goto(url); loads++;
    const overflow = await tab.eval('document.documentElement.scrollWidth - window.innerWidth');
    const errs = tab.errors.filter(e => !(url.includes('does-not-exist') && /404/.test(e)));
    if (errs.length) problems.push(`${name} ${url}: ${errs.join(' | ')}`);
    if (overflow > 1) problems.push(`${name} ${url}: horizontal overflow ${overflow}px`);
    const gc = await tab.eval('new Promise(r => { const t = Date.now(), w = () => window.__gc || Date.now() - t > 3000 ? r(window.__gc || null) : setTimeout(w, 20); w(); })');
    if (gc?.loaded !== 1) problems.push(`${name} ${url}: GoatCounter script loaded ${gc?.loaded ?? 0} times`);
    else gcClicks += gc.clicks;
  }
  // Screenshots after fonts and the count-up animations have settled.
  for (const [slug, path] of SHOTS) {
    await tab.goto(`${ORIGIN}/woningmarkt/${path}`); await tab.eval(settle(1500));
    fs.writeFileSync(`${OUTDIR}/${name}-${slug}.png`, await tab.shot({ fullPage: true }));
  }
  await tab.close();
}
{ // Dark mode (prefers-color-scheme: dark)
  const tab = await b.open(1440, 900, { stubs, scheme: 'dark' });
  for (const [slug, path] of [['home', ''], ['city-amsterdam', 'huizenprijzen/amsterdam/']]) {
    await tab.goto(`${ORIGIN}/woningmarkt/${path}`); await tab.eval(settle(1500));
    if (tab.errors.length) problems.push(`dark ${path}: ${tab.errors.join(' | ')}`);
    fs.writeFileSync(`${OUTDIR}/desktop-dark-${slug}.png`, await tab.shot({ fullPage: true }));
  }
  await tab.close();
}

// Interactions (desktop and mobile)
const results = [];
const wait = ms => `new Promise(r => setTimeout(r, ${ms}))`;
for (const [name, w, h, mobile] of VIEWS) {
  const tab = await b.open(w, h, { mobile, stubs });
  await tab.goto(`${ORIGIN}/woningmarkt/kaart/`);
  // No municipality may render without a fill: every path is a ramp colour or the hatched "geen data" pattern.
  const unfilled = await tab.eval(`(async () => { const bad = []; for (const lv of ['gm', 'pv']) for (const m of ['price', 'yoy', 'woz', 'multi']) {
    document.querySelector('input[name=level][value=' + lv + ']').click(); document.querySelector('input[name=metric][value=' + m + ']').click(); await ${wait(30)};
    for (const p of document.querySelectorAll('#' + lv + ' path')) { const f = p.style.fill || ''; if (!/^(rgb|#|url)/.test(f)) bad.push(lv + '/' + m + '/' + p.dataset.c + ':' + f); } }
    document.querySelector('input[name=level][value=gm]').click(); document.querySelector('input[name=metric][value=price]').click(); return bad; })()`);
  results.push([`${name} map paths without fill (all metrics, both levels)`, unfilled.length]);
  if (unfilled.length) problems.push(`${name} map: unfilled paths ${unfilled.slice(0, 5).join(', ')}`);
  results.push([`${name} map province WOZ legend`, await tab.eval(`(() => { document.querySelector('input[name=level][value=pv]').click(); document.querySelector('input[name=metric][value=woz]').click(); const t = document.querySelector('#legend li.nd')?.textContent; document.querySelector('input[name=level][value=gm]').click(); document.querySelector('input[name=metric][value=price]').click(); return t; })()`)]);
  const pt = await tab.eval(`(() => { const p = document.querySelector('#gm path[data-c="GM0344"]'); p.scrollIntoView({block:'center'}); const r = p.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
  await tab.click(pt[0], pt[1]);
  results.push([`${name} map click → panel`, await tab.eval(`document.querySelector('#panel h2')?.textContent`)]);
  await tab.eval(`document.querySelector('input[name=metric][value=woz]').click()`);
  results.push([`${name} map WOZ legend`, await tab.eval(`document.querySelector('#legend li')?.textContent`)]);
  const vb0 = await tab.eval(`document.getElementById('nlmap').getAttribute('viewBox')`);
  await tab.eval(`document.querySelector('.zoom button[data-z=in]').click()`); await tab.eval(wait(500));
  results.push([`${name} map zoom button`, `${vb0} → ${await tab.eval(`document.getElementById('nlmap').getAttribute('viewBox')`)}`]);
  await tab.eval(`document.querySelector('.zoom button[data-z=reset]').click()`); await tab.eval(wait(600));
  await tab.eval(`document.querySelector('input[name=level][value=pv]').click()`);
  results.push([`${name} map province level`, await tab.eval(`document.getElementById('nlmap').classList.contains('pv') + ' / ' + document.querySelector('#legend').textContent.slice(0,40)`)]);
  const pp = await tab.eval(`(() => { const p = document.querySelector('#pv path[data-c="PV26"]'); p.scrollIntoView({block:'center'}); const r = p.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
  await tab.click(pp[0], pp[1]); await tab.eval(wait(600));
  results.push([`${name} map province drill-down`, await tab.eval(`document.getElementById('drill').hidden + ' / ' + document.getElementById('drill-name').textContent + ' / ' + document.querySelector('#panel h2')?.textContent + ' / dimmed ' + document.querySelectorAll('#gm path.out').length`)]);
  await tab.goto('about:blank'); await tab.goto(`${ORIGIN}/woningmarkt/kaart/#GM0363`);
  results.push([`${name} map deep link`, await tab.eval(`document.querySelector('#panel h2')?.textContent`)]);
  if (tab.errors.length) problems.push(`${name} map interaction: ${tab.errors.join(' | ')}`);

  await tab.goto(`${ORIGIN}/woningmarkt/`);
  const hp = await tab.eval(`(() => { const p = document.querySelector('#gm path[data-c="GM0363"]'); p.scrollIntoView({block:'center'}); const r = p.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
  await tab.click(hp[0], hp[1]);
  results.push([`${name} home map click → panel`, await tab.eval(`document.querySelector('#panel h2')?.textContent + ' / idle ' + document.getElementById('panel').classList.contains('idle')`)]);
  if (tab.errors.length) problems.push(`${name} home map: ${tab.errors.join(' | ')}`);

  await tab.goto(`${ORIGIN}/woningmarkt/maximale-hypotheek-berekenen/`);
  await tab.eval(`(() => { const s = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', {bubbles:true})); }; s('rate', '5'); s('income', '46500'); })()`); await tab.eval(wait(600));
  results.push([`${name} mortgage 46,500 @ 5% 10y`, await tab.eval(`document.getElementById('o-total').textContent + ' / ' + document.getElementById('o-fl').textContent + ' / slider ' + document.getElementById('income-r').value`)]);
  await tab.eval(`(() => { const f = document.getElementById('fixed'); f.value = '5'; f.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  results.push([`${name} mortgage 5y fixed (min test rate)`, await tab.eval(`document.getElementById('o-tr').textContent + ' / ' + document.getElementById('o-note').textContent.slice(0, 60)`)]);
  await tab.eval(`(() => { const r = document.getElementById('income-r'); r.value = '80000'; r.dispatchEvent(new Event('input', {bubbles:true})); })()`); await tab.eval(wait(600));
  results.push([`${name} mortgage slider 80,000`, await tab.eval(`document.getElementById('income').value + ' / ' + document.getElementById('o-total').textContent + ' / pay ' + document.getElementById('o-pay').textContent + ' / bars ' + document.querySelectorAll('#o-curve rect').length`)]);
  if (tab.errors.length) problems.push(`${name} mortgage interaction: ${tab.errors.join(' | ')}`);

  await tab.goto(`${ORIGIN}/woningmarkt/en/buying-costs-calculator/`);
  await tab.eval(`(() => { const s = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', {bubbles:true})); }; s('price', '400000'); s('age', '30'); s('x-notary', '1500'); })()`); await tab.eval(wait(600));
  results.push([`${name} costs starter 400k + notary 1500`, await tab.eval(`document.getElementById('k-total').textContent + ' / tax ' + document.getElementById('k-tax').textContent + ' / donut ' + [...document.querySelectorAll('#k-donut circle.seg')].map(c => c.classList[1]).join(',') + ' / ' + document.getElementById('k-reason').textContent`)]);
  if (tab.errors.length) problems.push(`${name} costs interaction: ${tab.errors.join(' | ')}`);

  await tab.goto(`${ORIGIN}/woningmarkt/vergelijk/?a=GM0344&b=GM0307`);
  results.push([`${name} compare Utrecht/Amersfoort`, await tab.eval(`[...document.querySelectorAll('#cmpout thead th')].map(t => t.textContent).join(' | ') + ' / ' + (document.querySelector('#cmpout a[href*="-vs-"]')?.getAttribute('href') || 'no pair link') + ' / bars ' + document.querySelectorAll('#cmpout .bf').length`)]);
  await tab.eval(`document.getElementById('swap').click()`);
  results.push([`${name} compare swap`, await tab.eval(`document.getElementById('cmpsum')?.textContent || document.querySelector('.cmp-sum').textContent`)]);
  if (tab.errors.length) problems.push(`${name} compare interaction: ${tab.errors.join(' | ')}`);

  await tab.goto(`${ORIGIN}/woningmarkt/huizenprijzen/amsterdam/`);
  const cp = await tab.eval(`(() => { const s = document.querySelector('figure.chart svg'); s.scrollIntoView({block:'center'}); const r = s.getBoundingClientRect(); return [r.x + r.width * .5, r.y + r.height * .5]; })()`);
  await tab.move(cp[0], cp[1]); await tab.click(cp[0], cp[1]);
  results.push([`${name} chart crosshair tooltip`, await tab.eval(`(() => { const t = document.querySelector('figure.chart .ctip'); return t.hidden ? 'hidden' : t.textContent; })()`)]);
  if (tab.errors.length) problems.push(`${name} chart interaction: ${tab.errors.join(' | ')}`);
  await tab.close();
}
await b.close(); server.close();
for (const [k, v] of results) console.log(`${k}: ${v}`);
console.log(`\nGoatCounter stub loaded once on each of ${loads} page loads; ${gcClicks} click-named elements seen in total`);
console.log(`${loads} page loads (${urls.length} URLs x ${VIEWS.length} widths), ${problems.length} problems`);
for (const p of problems) console.log(' - ' + p);
process.exit(problems.length ? 1 : 0);
