// Small, pure statistics helpers for the published CBS series. No rounding for display here.

/** Percentage change from a to b, or null when a value is missing. */
export function change(a, b) {
  if (a == null || b == null || a === 0) return null;
  return (b - a) / a * 100;
}

/** Sorted [year, value] pairs of a { year: value } object, skipping nulls. */
export function yearSeries(obj = {}) {
  return Object.entries(obj).filter(([, v]) => v != null).map(([y, v]) => [Number(y), v]).sort((a, b) => a[0] - b[0]);
}

/**
 * Floor-area distribution from a CBS 83704NED row: { classKey: count }.
 * classes: [{ key, name }] in CBS order; the first ("Totaal") and "Onbekend" are excluded from shares.
 * Returns shares of known classes and the class that holds the median dwelling.
 */
export function areaDistribution(row, classes) {
  if (!row) return null;
  const known = classes.filter(c => c.key !== 'T001116' && !/onbekend/i.test(c.name));
  const unknownClass = classes.find(c => /onbekend/i.test(c.name));
  const counts = known.map(c => ({ key: c.key, name: c.name, count: row[c.key] ?? null }));
  if (counts.some(c => c.count == null)) return null;
  const sum = counts.reduce((s, c) => s + c.count, 0);
  if (!sum) return null;
  let cum = 0, median = null;
  for (const c of counts) { c.share = c.count / sum * 100; cum += c.count; if (median == null && cum >= sum / 2) median = c; }
  return { classes: counts, total: row.T001116 ?? null, known: sum, unknown: unknownClass ? row[unknownClass.key] ?? null : null, median };
}

/** k-1 quantile breaks (upper bounds of the first k-1 classes) of the non-null values. */
export function quantileBreaks(values, k) {
  const v = values.filter(x => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return [];
  const out = [];
  for (let i = 1; i < k; i++) out.push(v[Math.min(v.length - 1, Math.floor(i * v.length / k))]);
  return out;
}

/** Round each break to a step and drop duplicates, keeping order. */
export function niceBreaks(breaks, step) {
  return [...new Set(breaks.map(b => Math.round(b / step) * step))];
}

/** Class index of value for breaks (value <= breaks[i] goes to class i). */
export function classOf(value, breaks) {
  if (value == null) return -1;
  const i = breaks.findIndex(b => value <= b);
  return i < 0 ? breaks.length : i;
}

/** Monthly series to yearly averages: [{ year, avg, months }]. */
export function yearlyAverages(data) {
  const m = new Map();
  for (const d of data) if (d.rate != null) { const y = d.month.slice(0, 4); const e = m.get(y) || { sum: 0, n: 0 }; e.sum += d.rate; e.n++; m.set(y, e); }
  return [...m].map(([year, e]) => ({ year: Number(year), avg: e.sum / e.n, months: e.n }));
}
