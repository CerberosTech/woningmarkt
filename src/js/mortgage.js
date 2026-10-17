// Mortgage calculator UI. The rules live in engine/affordability.mjs (shared with the build and the tests).
import { maxMortgage } from '../engine/affordability.mjs';

const D = JSON.parse(document.getElementById('calcdata').textContent);
const loc = D.lang === 'nl' ? 'nl-NL' : 'en-GB';
const eur = new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const pc = d => new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
const $ = id => document.getElementById(id);
const form = $('mortgage');
const seriesFor = y => (y <= 1 ? 'F' : y <= 5 ? 'I' : y <= 10 ? 'O' : 'P');
let rateTouched = false;

function update() {
  const r = maxMortgage({
    income: +$('income').value, ratePct: +$('rate').value, fixedYears: +$('fixed').value, aow: $('aow').checked,
    studyDebtMonthly: +$('debt').value, energyLabel: $('label').value, energySaving: $('saving').checked, homeValue: +$('value').value,
  }, D.params);
  $('o-total').textContent = eur.format(Math.round(r.total));
  $('o-tr').textContent = pc(2).format(r.toetsrente) + '%';
  $('o-fl').textContent = pc(1).format(r.financieringslastPct) + '%';
  $('o-month').textContent = eur.format(Math.round(r.monthlyMax));
  $('o-debt').textContent = eur.format(Math.round(r.studyDebtCharge));
  $('o-income').textContent = eur.format(Math.round(r.onIncome));
  $('o-label').textContent = eur.format(r.labelExtra);
  $('o-saving').textContent = eur.format(r.savingExtra);
  $('o-note').textContent = (r.minApplied ? D.i18n.minApplied : r.shortFixed ? D.i18n.aboveMin : D.i18n.actual) + (r.limitedByValue ? ' ' + D.i18n.byValue : '');
  $('o-nhg').textContent = r.total > 0 ? (r.withinNhg ? D.i18n.nhgYes : D.i18n.nhgNo) : '';
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
