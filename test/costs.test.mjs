import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transferTax, nhgFee, buyingCosts } from '../engine/costs.mjs';

const params = JSON.parse(fs.readFileSync(new URL('../data/params-2026.json', import.meta.url)));
const t = params.transferTax;

test('own home pays the ownHome rate', () => {
  const r = transferTax({ price: 400000, use: 'own', age: 40 }, params);
  assert.equal(r.ratePct, t.ownHome);
  assert.equal(r.amount, 400000 * t.ownHome / 100);
});

test('starter exemption: age window [min, max), price cap inclusive, first time only', () => {
  const [min, max] = t.starterAge;
  assert.equal(transferTax({ price: t.starterMaxValue, age: min }, params).reason, 'starter');
  assert.equal(transferTax({ price: t.starterMaxValue + 1, age: min }, params).reason, 'own');
  assert.equal(transferTax({ price: 300000, age: max }, params).reason, 'own');
  assert.equal(transferTax({ price: 300000, age: min - 1 }, params).reason, 'own');
  assert.equal(transferTax({ price: 300000, age: max - 1, usedExemptionBefore: true }, params).reason, 'own');
  assert.equal(transferTax({ price: 300000, age: null }, params).reason, 'own');
  assert.equal(transferTax({ price: 300000, age: 30 }, params).amount, 300000 * t.starter / 100);
});

test('not main residence and other property rates', () => {
  assert.equal(transferTax({ price: 300000, use: 'notMain', age: 25 }, params).ratePct, t.notMainResidence);
  assert.equal(transferTax({ price: 300000, use: 'other' }, params).ratePct, t.other);
});

test('NHG fee within the limit only; higher limit with energy-saving measures', () => {
  const n = params.nhg;
  assert.equal(nhgFee(n.limit, {}, params).fee, n.limit * n.feePct / 100);
  assert.equal(nhgFee(n.limit + 1, {}, params).eligible, false);
  assert.equal(nhgFee(n.limit + 1, { energySaving: true }, params).eligible, n.limit + 1 <= n.limitWithEBV);
  assert.equal(nhgFee(0, {}, params).eligible, false);
});

test('total adds tax, NHG fee and user-entered extras', () => {
  const r = buyingCosts({ price: 400000, mortgage: 400000, use: 'own', age: 40, nhg: true, extras: { notary: 1000, valuation: '500', advice: -5 } }, params);
  assert.equal(r.extrasTotal, 1500);
  assert.equal(r.total, 400000 * t.ownHome / 100 + 400000 * params.nhg.feePct / 100 + 1500);
  assert.ok(Math.abs(r.pctOfPrice - r.total / 400000 * 100) < 1e-12);
});

test('no extras entered means no assumed market prices', () => {
  const r = buyingCosts({ price: 400000, mortgage: 400000, use: 'own', age: 40 }, params);
  assert.equal(r.extrasTotal, 0);
  assert.equal(r.nhg, null);
});
