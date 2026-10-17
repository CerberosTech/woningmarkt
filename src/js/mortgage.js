// Mortgage calculator UI. The rules live in engine/affordability.mjs (shared with the build and the tests).
import { maxMortgage } from '../engine/affordability.mjs';
import { annuitySchedule } from '../engine/payments.mjs';
import { payCurve } from './viz.mjs';

const D = JSON.parse(document.getElementById('calcdata').textContent);
const loc = D.lang === 'nl' ? 'nl-NL' : 'en-GB';
const eur = new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const pc = d => new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
const $ = id => document.getElementById(id);
const form = $('mortgage');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const seriesFor = y => (y <= 1 ? 'F' : y <= 5 ? 'I' : y <= 10 ? 'O' : 'P');
let rateTouched = false, shown = null, raf = 0, liveT = 0;

// The big figure counts to its new value, so a change in input reads as a change in result.
function tweenTotal(to) {
  const el = $('o-total');
  $('o-peek').textContent = eur.format(Math.round(to));
  clearTimeout(liveT); liveT = setTimeout(() => { $('o-live').textContent = `${document.querySelector('#mortgage-out .big-label').textContent}: ${eur.format(Math.round(to))}`; }, 700);
  if (shown == null || reduce.matches) { shown = to; el.textContent = eur.format(Math.round(to)); return; }
  cancelAnimationFrame(raf);
  const from = shown, t0 = performance.now();
  const step = now => { const k = Math.min(1, (now - t0) / 380), e = 1 - Math.pow(1 - k, 3); shown = from + (to - from) * e; el.textContent = eur.format(Math.round(k < 1 ? shown : to)); if (k < 1) raf = requestAnimationFrame(step); };
  raf = requestAnimationFrame(step);
}

function syncRanges() {
  for (const r of form.querySelectorAll('input.range[data-for]')) {
    const n = $(r.dataset.for);
    if (document.activeElement !== r && n.value !== '') r.value = n.value;
    r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min) * 100).toFixed(2) + '%');
  }
}

function update() {
  const rate = +$('rate').value;
  const r = maxMortgage({
    income: +$('income').value, ratePct: rate, fixedYears: +$('fixed').value, aow: $('aow').checked,
    studyDebtMonthly: +$('debt').value, energyLabel: $('label').value, energySaving: $('saving').checked, homeValue: +$('value').value,
  }, D.params);
  tweenTotal(r.total);
  $('o-tr').textContent = pc(2).format(r.toetsrente) + '%';
  $('o-fl').textContent = pc(1).format(r.financieringslastPct) + '%';
  $('o-month').textContent = eur.format(Math.round(r.monthlyMax));
  $('o-debt').textContent = eur.format(Math.round(r.studyDebtCharge));
  $('o-income').textContent = eur.format(Math.round(r.onIncome));
  $('o-label').textContent = eur.format(r.labelExtra);
  $('o-saving').textContent = eur.format(r.savingExtra);
  $('o-note').textContent = (r.minApplied ? D.i18n.minApplied : r.shortFixed ? D.i18n.aboveMin : D.i18n.actual) + (r.limitedByValue ? ' ' + D.i18n.byValue : '');
  $('o-nhg').textContent = r.total > 0 ? (r.withinNhg ? D.i18n.nhgYes : D.i18n.nhgNo) : '';
  const share = v => r.total > 0 ? (v / r.total * 100).toFixed(2) + '%' : '0%';
  const st = $('o-stack').children;
  st[0].style.setProperty('--w', share(r.onIncome)); st[1].style.setProperty('--w', share(r.labelExtra)); st[2].style.setProperty('--w', share(r.savingExtra));
  // Payment curve at the rate the user entered (not the test rate), over the regulated term.
  const s = annuitySchedule(r.total, rate, D.params.affordability.termYears);
  $('o-pay').textContent = eur.format(Math.round(s.monthly));
  $('o-curve').innerHTML = payCurve(s, { tick: D.i18n.year });
  $('o-paynote').textContent = D.i18n.pay.replace('{n}', D.params.affordability.termYears).replace('{r}', pc(2).format(rate) + '%').replace('{i}', eur.format(Math.round(s.totalInterest)));
  syncRanges();
}
$('rate').addEventListener('input', () => { rateTouched = true; });
$('fixed').addEventListener('change', () => {
  const k = seriesFor(+$('fixed').value);
  if (!rateTouched) $('rate').value = D.rates[k];
  $('ratehelp').textContent = D.rateHelp[k];
});
form.addEventListener('input', update);
form.addEventListener('change', update);
update();
