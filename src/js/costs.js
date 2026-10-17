// Buying-costs calculator UI. The rules live in engine/costs.mjs (shared with the build and the tests).
import { buyingCosts } from '../engine/costs.mjs';

const D = JSON.parse(document.getElementById('calcdata').textContent);
const loc = D.lang === 'nl' ? 'nl-NL' : 'en-GB';
const eur = new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const p1 = new Intl.NumberFormat(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const $ = id => document.getElementById(id);
const form = $('costs'), I = D.i18n;
const EXTRAS = ['notary', 'valuation', 'advice', 'guarantee', 'other'];
let mortgageTouched = false;

function update() {
  const use = form.querySelector('input[name=use]:checked').value;
  const r = buyingCosts({
    price: +$('price').value, mortgage: +$('mortgage-amt').value, use, age: $('age').value === '' ? null : +$('age').value,
    usedExemptionBefore: $('used').checked, nhg: $('nhg').checked, energySaving: $('ebv').checked,
    extras: Object.fromEntries(EXTRAS.map(k => [k, +$('x-' + k).value])),
  }, D.params);
  $('k-total').textContent = eur.format(Math.round(r.total));
  $('k-pct').textContent = r.pctOfPrice == null ? '' : (D.lang === 'nl' ? `${p1.format(r.pctOfPrice)}% van de koopsom` : `${p1.format(r.pctOfPrice)}% of the price`);
  $('k-tax').textContent = eur.format(Math.round(r.tax.amount));
  $('k-nhg').textContent = eur.format(Math.round(r.nhg?.fee ?? 0));
  $('k-extras').textContent = eur.format(Math.round(r.extrasTotal));
  let why = I.reason[r.tax.reason];
  if (r.tax.reason === 'own') { const c = r.tax.starterChecks, fails = ['age', 'firstTime', 'price'].filter(k => !c[k]).map(k => I.fail[k]); why += ` ${I.noStarter}: ${fails.join(', ')}.`; }
  $('k-reason').textContent = why;
  $('k-nhgnote').textContent = !r.nhg ? I.nhgOff : `${r.nhg.eligible ? I.nhgOk : I.nhgNo} ${eur.format(r.nhg.limit)}.`;
  $('k-extrasnote').textContent = r.extrasTotal ? '' : I.extrasEmpty;
}
$('mortgage-amt').addEventListener('input', () => { mortgageTouched = true; });
$('price').addEventListener('input', () => { if (!mortgageTouched) $('mortgage-amt').value = $('price').value; });
form.addEventListener('input', update);
form.addEventListener('change', update);
update();
