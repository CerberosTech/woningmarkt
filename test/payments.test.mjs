import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annuitySchedule } from '../engine/payments.mjs';
import { annuityFactor } from '../engine/affordability.mjs';

test('annuity schedule repays the whole loan and matches the annuity factor', () => {
  const s = annuitySchedule(300000, 4, 30);
  assert.equal(s.years.length, 30);
  assert.ok(Math.abs(s.monthly - 300000 * annuityFactor(4, 30)) < 1e-6);
  const repaid = s.years.reduce((a, y) => a + y.repayment, 0);
  assert.ok(Math.abs(repaid - 300000) < 0.01, `repaid ${repaid}`);
  assert.ok(s.years.at(-1).balance < 0.01);
  assert.ok(Math.abs(s.years.reduce((a, y) => a + y.interest + y.repayment, 0) - s.monthly * 360) < 0.01);
  assert.ok(s.years[0].interest > s.years[0].repayment, 'early years are mostly interest at 4%');
});

test('annuity schedule handles zero rate and zero loan', () => {
  const z = annuitySchedule(120000, 0, 30);
  assert.ok(Math.abs(z.monthly - 120000 / 360) < 1e-9);
  assert.equal(z.totalInterest, 0);
  const n = annuitySchedule(0, 4, 30);
  assert.equal(n.monthly, 0);
  assert.equal(n.years.length, 30);
});
