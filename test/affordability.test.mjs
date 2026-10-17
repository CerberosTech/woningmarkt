import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { maxMortgage, toetsrente, financieringslast, bandIndex, annuityFactor, bruteringsfactor } from '../engine/affordability.mjs';

const params = JSON.parse(fs.readFileSync(new URL('../data/params-2026.json', import.meta.url)));
const a = params.affordability;

test('SEH verification case: income 46,500 at 5% gives 24.6% and 177,573', () => {
  const r = maxMortgage({ income: 46500, ratePct: 5, fixedYears: 10 }, params);
  assert.equal(r.financieringslastPct, 24.6);
  assert.equal(Math.round(r.onIncome), 177573);
  assert.equal(Math.round(r.total), 177573);
});

test('rate bands are inclusive upper bounds', () => {
  assert.equal(bandIndex(1.5, a.rateBandsUpperPct), 0);
  assert.equal(bandIndex(1.51, a.rateBandsUpperPct), 1);
  assert.equal(bandIndex(5, a.rateBandsUpperPct), 7);
  assert.equal(bandIndex(5.01, a.rateBandsUpperPct), 8);
  assert.equal(bandIndex(12, a.rateBandsUpperPct), a.rateBandsUpperPct.length - 1);
});

test('minimum test rate applies below 10 years fixed only', () => {
  assert.equal(toetsrente(3.9, 5, a), a.minToetsrente);
  assert.equal(toetsrente(3.9, 10, a), 3.9);
  assert.equal(toetsrente(6.1, 5, a), 6.1);
  const short = maxMortgage({ income: 60000, ratePct: 3.9, fixedYears: 5 }, params);
  assert.equal(short.toetsrente, a.minToetsrente);
  assert.equal(short.minApplied, true);
});

test('table row: income at or above the row lower bound; top row for high incomes', () => {
  assert.equal(financieringslast(46999, 5, false, a).rowFrom, 46000);
  assert.equal(financieringslast(47000, 5, false, a).rowFrom, 47000);
  assert.equal(financieringslast(500000, 5, false, a).rowFrom, a.flTableBelowAOW.at(-1)[0]);
  assert.equal(financieringslast(10000, 5, false, a).rowFrom, 0);
  assert.notEqual(financieringslast(60000, 5, true, a).pct, financieringslast(60000, 5, false, a).pct);
});

test('annuity factor matches the closed form and handles zero rate', () => {
  assert.ok(Math.abs(annuityFactor(5, 30) - 0.005368216) < 1e-8);
  assert.equal(annuityFactor(0, 30), 1 / 360);
});

test('study debt reduces the result by the grossed-up monthly charge', () => {
  const base = maxMortgage({ income: 60000, ratePct: 4, fixedYears: 10 }, params);
  const debt = maxMortgage({ income: 60000, ratePct: 4, fixedYears: 10, studyDebtMonthly: 100 }, params);
  assert.equal(debt.bruteringsfactor, bruteringsfactor(4, a));
  assert.ok(Math.abs(debt.studyDebtCharge - 100 * debt.bruteringsfactor) < 1e-9);
  assert.ok(Math.abs((base.onIncome - debt.onIncome) - debt.studyDebtCharge / debt.annuityFactor) < 1e-6);
});

test('energy label extras come from params; saving extra only when chosen', () => {
  const r = maxMortgage({ income: 60000, ratePct: 4, fixedYears: 10, energyLabel: 'A+++', energySaving: true }, params);
  assert.equal(r.labelExtra, a.energyLabelExtra['A+++']);
  assert.equal(r.savingExtra, a.energySavingExtra['A+++']);
  const n = maxMortgage({ income: 60000, ratePct: 4, fixedYears: 10, energyLabel: 'EFG' }, params);
  assert.equal(n.savingExtra, 0);
  const u = maxMortgage({ income: 60000, ratePct: 4, fixedYears: 10, energyLabel: 'bogus' }, params);
  assert.equal(u.labelExtra, 0);
});

test('home value caps the income-based part at ltvMax', () => {
  const r = maxMortgage({ income: 120000, ratePct: 4, fixedYears: 10, homeValue: 200000 }, params);
  assert.equal(r.base, 200000 * a.ltvMax);
  assert.equal(r.limitedByValue, true);
});

test('zero or missing income gives zero, never NaN', () => {
  const r = maxMortgage({ income: '', ratePct: 4, fixedYears: 10 }, params);
  assert.equal(r.total, 0);
});

test('short fixed period is flagged even when the entered rate is at or above the minimum', () => {
  const r = maxMortgage({ income: 60000, ratePct: 5, fixedYears: 5 }, params);
  assert.equal(r.minApplied, false);
  assert.equal(r.shortFixed, true);
  assert.equal(maxMortgage({ income: 60000, ratePct: 5, fixedYears: 10 }, params).shortFixed, false);
});
