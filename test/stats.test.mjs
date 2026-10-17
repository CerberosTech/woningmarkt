import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { change, yearSeries, areaDistribution, quantileBreaks, classOf, niceBreaks, yearlyAverages } from '../engine/stats.mjs';

const housing = JSON.parse(fs.readFileSync(new URL('../data/housing.json', import.meta.url)));

test('change handles missing values', () => {
  assert.equal(change(100, 110), 10);
  assert.equal(change(null, 110), null);
  assert.equal(change(0, 5), null);
});

test('yearSeries sorts and skips nulls', () => {
  assert.deepEqual(yearSeries({ 2016: 2, 2015: 1, 2017: null }), [[2015, 1], [2016, 2]]);
});

test('area distribution shares sum to 100 and the median class holds the 50th percentile', () => {
  const d = areaDistribution(housing.area.data.GM0363.all, housing.area.classes);
  const sum = d.classes.reduce((s, c) => s + c.share, 0);
  assert.ok(Math.abs(sum - 100) < 1e-9);
  let cum = 0; for (const c of d.classes) { cum += c.share; if (c === d.median) break; }
  assert.ok(cum >= 50);
  assert.ok(cum - d.median.share < 50);
  assert.equal(d.total, housing.area.data.GM0363.all.T001116);
});

test('area distribution returns null when a class is missing', () => {
  assert.equal(areaDistribution({ T001116: 1 }, housing.area.classes), null);
  assert.equal(areaDistribution(undefined, housing.area.classes), null);
});

test('quantile breaks and classes', () => {
  const b = quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
  assert.equal(b.length, 4);
  assert.equal(classOf(1, b), 0);
  assert.equal(classOf(10, b), 4);
  assert.equal(classOf(null, b), -1);
  assert.deepEqual(niceBreaks([101, 149, 151], 50), [100, 150]);
});

test('yearly averages', () => {
  const y = yearlyAverages([{ month: '2025-01', rate: 2 }, { month: '2025-02', rate: 4 }, { month: '2026-01', rate: null }]);
  assert.deepEqual(y, [{ year: 2025, avg: 3, months: 2 }]);
});
