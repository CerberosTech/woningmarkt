// Small SVG builders shared by the build (prebuilt HTML) and the calculators in the browser.
const r1 = v => Math.round(v * 10) / 10;

/** Yearly split of an annuity: repayment (bottom) and interest (top) per year. Every bar has the same height. */
export function payCurve(schedule, { w = 360, h = 150, tick = 'jr' } = {}) {
  const ys = schedule.years, n = ys.length, top = 8, bottom = h - 20, gap = 1.6;
  const bw = (w - gap * (n - 1)) / n, max = Math.max(1, ...ys.map(y => y.interest + y.repayment));
  const bars = ys.map((y, i) => {
    const x = r1(i * (bw + gap)), hr = (bottom - top) * y.repayment / max, hi = (bottom - top) * y.interest / max;
    return `<rect class="rep" x="${x}" y="${r1(bottom - hr)}" width="${r1(bw)}" height="${r1(hr)}"/><rect class="int" x="${x}" y="${r1(bottom - hr - hi)}" width="${r1(bw)}" height="${r1(hi)}"/>`;
  }).join('');
  const ticks = [1, 10, 20, n].filter((v, i, a) => v <= n && a.indexOf(v) === i)
    .map(v => `<text x="${r1((v - 1) * (bw + gap) + bw / 2)}" y="${h - 4}" text-anchor="${v === 1 ? 'start' : v === n ? 'end' : 'middle'}">${v === 1 ? `${tick} 1` : v}</text>`).join('');
  return `<svg class="paycurve" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false">${bars}${ticks}</svg>`;
}

/** Donut of parts [{ k, v }]; k becomes the segment class. A zero total gives an empty ring. */
export function donut(parts, { r = 64, t = 20 } = {}) {
  const C = 2 * Math.PI * r, total = parts.reduce((s, p) => s + Math.max(0, p.v || 0), 0);
  let off = 0;
  const segs = total ? parts.filter(p => p.v > 0).map(p => { const len = p.v / total * C, s = `<circle class="seg ${p.k}" r="${r}" stroke-dasharray="${r1(len)} ${r1(C - len)}" stroke-dashoffset="${r1(-off)}"/>`; off += len; return s; }).join('') : '';
  return `<svg class="donut" viewBox="${-r - t} ${-r - t} ${2 * (r + t)} ${2 * (r + t)}" aria-hidden="true" focusable="false"><g transform="rotate(-90)" stroke-width="${t}" fill="none"><circle class="track" r="${r}"/>${segs}</g></svg>`;
}
