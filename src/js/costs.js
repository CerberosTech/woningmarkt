// Buying-costs calculator UI. The rules live in engine/costs.mjs (shared with the build and the tests).
import { buyingCosts } from '../engine/costs.mjs';
import { donut } from './viz.mjs';

const D = JSON.parse(document.getElementById('calcdata').textContent);
const loc = D.lang === 'nl' ? 'nl-NL' : 'en-GB';
const eur = new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const p1 = new Intl.NumberFormat(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const $ = id => document.getElementById(id);
const form = $('costs'), I = D.i18n;
const EXTRAS = ['notary', 'valuation', 'advice', 'guarantee', 'other'];
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let mortgageTouched = false, shown = null, raf = 0, liveT = 0;

function tweenTotal(to) {
  const el = $('k-total');
  $('k-peek').textContent = eur.format(Math.round(to));
  clearTimeout(liveT); liveT = setTimeout(() => { $('k-live').textContent = `${document.querySelector('#costs-out .big-label').textContent}: ${eur.format(Math.round(to))}`; }, 700);
  if (shown == null || reduce.matches) { shown = to; el.textContent = eur.format(Math.round(to)); return; }
  cancelAnimationFrame(raf);
  const from = shown, t0 = performance.now();
  const step = now => { const k = Math.min(1, (now - t0) / 380), e = 1 - Math.pow(1 - k, 3); shown = from + (to - from) * e; el.textContent = eur.format(Math.round(k < 1 ? shown : to)); if (k < 1) raf = requestAnimationFrame(step); };
  raf = requestAnimationFrame(step);
}

// Update the donut in place, so the segments animate (stroke-dasharray transitions in CSS).
function drawDonut(parts) {
  const box = $('k-donut'), fresh = new DOMParser().parseFromString(donut(parts), 'image/svg+xml').documentElement;
  const g = box.querySelector('svg g'), ng = fresh.querySelector('g');
  if (!g) { box.innerHTML = donut(parts); return; }
  const old = new Map([...g.querySelectorAll('circle.seg')].map(c => [c.classList[1], c]));
  for (const c of ng.querySelectorAll('circle.seg')) {
    const k = c.classList[1], o = old.get(k);
    if (o) { o.setAttribute('stroke-dasharray', c.getAttribute('stroke-dasharray')); o.setAttribute('stroke-dashoffset', c.getAttribute('stroke-dashoffset')); old.delete(k); }
    else g.appendChild(document.importNode(c, true));
  }
  for (const o of old.values()) o.remove();
}

function syncRanges() {
  for (const r of form.querySelectorAll('input.range[data-for]')) {
    const n = $(r.dataset.for);
    if (document.activeElement !== r && n.value !== '') r.value = n.value;
    r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min) * 100).toFixed(2) + '%');
  }
}

function update() {
  const use = form.querySelector('input[name=use]:checked').value;
  const extras = Object.fromEntries(EXTRAS.map(k => [k, +$('x-' + k).value]));
  const r = buyingCosts({
    price: +$('price').value, mortgage: +$('mortgage-amt').value, use, age: $('age').value === '' ? null : +$('age').value,
    usedExemptionBefore: $('used').checked, nhg: $('nhg').checked, energySaving: $('ebv').checked, extras,
  }, D.params);
  tweenTotal(r.total);
  $('k-pct').textContent = r.pctOfPrice == null ? '' : `${p1.format(r.pctOfPrice)}% ${I.ofPrice}`;
  $('k-tax').textContent = eur.format(Math.round(r.tax.amount));
  $('k-nhg').textContent = eur.format(Math.round(r.nhg?.fee ?? 0));
  for (const k of EXTRAS) $('k-x-' + k).textContent = eur.format(Math.round(Math.max(0, extras[k] || 0)));
  $('k-extras').textContent = eur.format(Math.round(r.extrasTotal));
  let why = I.reason[r.tax.reason];
  if (r.tax.reason === 'own') { const c = r.tax.starterChecks, fails = ['age', 'firstTime', 'price'].filter(k => !c[k]).map(k => I.fail[k]); why += ` ${I.noStarter}: ${fails.join(', ')}.`; }
  $('k-reason').textContent = why;
  $('k-nhgnote').textContent = !r.nhg ? I.nhgOff : `${r.nhg.eligible ? I.nhgOk : I.nhgNo} ${eur.format(r.nhg.limit)}.`;
  $('k-extrasnote').textContent = r.extrasTotal ? '' : I.extrasEmpty;
  drawDonut([{ k: 'tax', v: r.tax.amount }, { k: 'nhg', v: r.nhg?.fee ?? 0 }, ...EXTRAS.map(k => ({ k, v: Math.max(0, extras[k] || 0) }))]);
  syncRanges();
}
$('mortgage-amt').addEventListener('input', () => { mortgageTouched = true; });
$('price').addEventListener('input', () => { if (!mortgageTouched) $('mortgage-amt').value = $('price').value; });
form.addEventListener('input', update);
form.addEventListener('change', update);
update();
