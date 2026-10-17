// Browser check of the built site, served under /woningmarkt/ like GitHub Pages.
// Loads every sitemap URL (plus 404) at desktop and mobile widths and reports console errors, failed
// requests and horizontal overflow. Then drives the map, both calculators and the comparison tool.
// Screenshots of key pages go to verify/. Usage: node build.mjs && node scripts/check.mjs
import fs from 'node:fs'; import { serve } from './serve.mjs'; import { launch } from './chrome.mjs';
const PORT = 4179, ORIGIN = `http://127.0.0.1:${PORT}`, SITE = 'https://cerberostech.github.io';
const server = await serve(PORT);
const urls = [...fs.readFileSync('dist/sitemap.xml', 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace(SITE, ORIGIN));
urls.push(`${ORIGIN}/woningmarkt/does-not-exist/`);
const VIEWS = [['desktop', 1280, 900, false], ['mobile', 375, 812, true]];
// GoatCounter's count.js is answered locally by a stub, so the check never counts a visit and runs offline.
// The stub records that the script loaded and how many elements carry a click name.
const stubs = { '*://gc.zgo.at/*': 'window.__gc = { loaded: (window.__gc?.loaded || 0) + 1, clicks: document.querySelectorAll("[data-goatcounter-click]").length };' };
const SHOTS = ['/woningmarkt/', '/woningmarkt/kaart/', '/woningmarkt/huizenprijzen/utrecht/', '/woningmarkt/maximale-hypotheek-berekenen/', '/woningmarkt/kosten-koper-berekenen/', '/woningmarkt/hypotheekrente/', '/woningmarkt/en/compare/amsterdam-vs-rotterdam/', '/woningmarkt/gidsen/kosten-koper/', '/woningmarkt/en/house-prices/'];
fs.mkdirSync('verify', { recursive: true });
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
    const p = new URL(url).pathname;
    if (SHOTS.includes(p)) fs.writeFileSync(`verify/${name}-${p.replace(/^\/woningmarkt\//, '').replace(/\/$/, '').replace(/\//g, '_') || 'home'}.png`, await tab.shot({ fullPage: true }));
  }
  await tab.close();
}

// Interactions (desktop and mobile)
const results = [];
for (const [name, w, h, mobile] of VIEWS) {
  const tab = await b.open(w, h, { mobile, stubs });
  await tab.goto(`${ORIGIN}/woningmarkt/kaart/`);
  const pt = await tab.eval(`(() => { const p = document.querySelector('#gm path[data-c="GM0344"]'); p.scrollIntoView({block:'center'}); const r = p.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
  await tab.click(pt[0], pt[1]);
  results.push([`${name} map click → panel`, await tab.eval(`document.querySelector('#panel h2')?.textContent`)]);
  await tab.eval(`document.querySelector('input[name=metric][value=woz]').click()`);
  results.push([`${name} map WOZ legend`, await tab.eval(`document.querySelector('#legend li')?.textContent`)]);
  await tab.eval(`document.querySelector('input[name=level][value=pv]').click()`);
  results.push([`${name} map province level`, await tab.eval(`document.getElementById('nlmap').classList.contains('pv') + ' / ' + document.querySelector('#legend').textContent.slice(0,40)`)]);
  await tab.goto('about:blank'); await tab.goto(`${ORIGIN}/woningmarkt/kaart/#GM0363`);
  results.push([`${name} map deep link`, await tab.eval(`document.querySelector('#panel h2')?.textContent`)]);
  if (tab.errors.length) problems.push(`${name} map interaction: ${tab.errors.join(' | ')}`);
  if (name === 'desktop') fs.writeFileSync('verify/desktop-kaart-selected.png', await tab.shot());

  await tab.goto(`${ORIGIN}/woningmarkt/maximale-hypotheek-berekenen/`);
  await tab.eval(`(() => { const s = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', {bubbles:true})); }; s('rate', '5'); s('income', '46500'); })()`);
  results.push([`${name} mortgage 46,500 @ 5% 10y`, await tab.eval(`document.getElementById('o-total').textContent + ' / ' + document.getElementById('o-fl').textContent`)]);
  await tab.eval(`(() => { const f = document.getElementById('fixed'); f.value = '5'; f.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  results.push([`${name} mortgage 5y fixed (min test rate)`, await tab.eval(`document.getElementById('o-tr').textContent + ' / ' + document.getElementById('o-note').textContent.slice(0, 60)`)]);
  if (tab.errors.length) problems.push(`${name} mortgage interaction: ${tab.errors.join(' | ')}`);

  await tab.goto(`${ORIGIN}/woningmarkt/en/buying-costs-calculator/`);
  await tab.eval(`(() => { const s = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', {bubbles:true})); }; s('price', '400000'); s('age', '30'); s('x-notary', '1500'); })()`);
  results.push([`${name} costs starter 400k + notary 1500`, await tab.eval(`document.getElementById('k-total').textContent + ' / tax ' + document.getElementById('k-tax').textContent + ' / ' + document.getElementById('k-reason').textContent`)]);
  if (tab.errors.length) problems.push(`${name} costs interaction: ${tab.errors.join(' | ')}`);

  await tab.goto(`${ORIGIN}/woningmarkt/vergelijk/?a=GM0344&b=GM0307`);
  results.push([`${name} compare Utrecht/Amersfoort`, await tab.eval(`[...document.querySelectorAll('#cmpout thead th')].map(t => t.textContent).join(' | ') + ' / ' + (document.querySelector('#cmpout a[href*="-vs-"]')?.getAttribute('href') || 'no pair link')`)]);
  if (tab.errors.length) problems.push(`${name} compare interaction: ${tab.errors.join(' | ')}`);
  await tab.close();
}
await b.close(); server.close();
for (const [k, v] of results) console.log(`${k}: ${v}`);
console.log(`\nGoatCounter stub loaded once on each of ${loads} page loads; ${gcClicks} click-named elements seen in total`);
console.log(`${loads} page loads (${urls.length} URLs x ${VIEWS.length} widths), ${problems.length} problems`);
for (const p of problems) console.log(' - ' + p);
process.exit(problems.length ? 1 : 0);
