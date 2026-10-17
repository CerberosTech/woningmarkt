// Inline SVG charts, rendered at build time. Every chart is readable without JavaScript; site.js adds a hover
// crosshair and tooltip from the data-chart payload (positions in viewBox units plus preformatted labels).
import { esc } from './markdown.mjs';

function niceStep(range, n) {
  const raw = range / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}
const r1 = v => Math.round(v * 10) / 10;

let uid = 0;

/**
 * @param {object} o
 * @param {Array<{name:string, cls?:string, points:Array<[string, number|null]>}>} o.series  same x labels in every series
 * @param {(n:number)=>string} o.fmtY      axis tick formatter
 * @param {(n:number)=>string} [o.fmtV]    tooltip value formatter (defaults to fmtY)
 * @param {string} o.title                 accessible name
 * @param {string} [o.desc]                accessible description
 * @param {number} [o.xEvery]              label every n-th x value
 * @param {boolean} [o.zero]               start the y axis at zero
 * @param {(x:string)=>string} [o.fmtX]    x label formatter
 * @param {(x:string)=>string} [o.fmtXTip] x label in the tooltip
 * @param {boolean} [o.area]               soft area under the first series
 */
export function lineChart({ series, fmtY, fmtV = fmtY, title, desc = '', xEvery = 1, zero = false, fmtX = x => x, fmtXTip = fmtX, w = 640, h = 320, area = true }) {
  const id = `c${++uid}`;
  const xs = series[0].points.map(p => p[0]);
  const vals = series.flatMap(s => s.points.map(p => p[1])).filter(v => v != null);
  let lo = zero ? 0 : Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const step = niceStep(hi - lo, 4);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const L = 4, R = 12, T = 26, B = 34, iw = w - L - R, ih = h - T - B;
  const X = i => L + (xs.length === 1 ? iw / 2 : i * iw / (xs.length - 1));
  const Y = v => T + ih - (v - lo) / (hi - lo) * ih;
  const ticks = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  const grid = ticks.map((v, i) => `<line x1="0" x2="${w}" y1="${r1(Y(v))}" y2="${r1(Y(v))}"${i ? '' : ' class="base"'}/><text x="0" y="${r1(Y(v) - 6)}"${i ? '' : ' class="ylo"'}>${esc(fmtY(v))}</text>`).join('');
  const last = xs.length - 1;
  const xl = xs.map((x, i) => (i % xEvery === 0 || i === last) && !(i !== last && last - i < xEvery / 2)
    ? `<text x="${r1(X(i))}" y="${h - 8}" text-anchor="${i === 0 ? 'start' : i === last ? 'end' : 'middle'}">${esc(fmtX(x))}</text>` : '').join('');
  const pathOf = s => { let d = '', pen = false; s.points.forEach(([, v], i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${r1(X(i))} ${r1(Y(v))}`; pen = true; }); return d; };
  const s0 = series[0], idx0 = s0.points.map((p, i) => p[1] != null ? i : -1).filter(i => i >= 0);
  const areaPath = area && idx0.length > 1 && s0.points.every((p, i) => i < idx0[0] || i > idx0.at(-1) || p[1] != null)
    ? `<path class="area" fill="url(#${id}g)" d="${pathOf(s0)}L${r1(X(idx0.at(-1)))} ${r1(T + ih)}L${r1(X(idx0[0]))} ${r1(T + ih)}Z"/>` : '';
  const lines = series.map((s, k) => {
    const lastPt = [...s.points.entries()].reverse().find(([, p]) => p[1] != null);
    const dot = lastPt ? `<circle cx="${r1(X(lastPt[0]))}" cy="${r1(Y(lastPt[1][1]))}" r="4"/>` : '';
    return `<g class="s s${k}${s.cls ? ' ' + s.cls : ''}"><path d="${pathOf(s)}"/>${dot}</g>`;
  }).reverse().join(''); // first series on top
  const lastPt0 = [...s0.points.entries()].reverse().find(([, p]) => p[1] != null);
  const endLabel = lastPt0 ? `<text class="endl" x="${r1(X(lastPt0[0]) - 8)}" y="${r1(Y(lastPt0[1][1]) - 12)}" text-anchor="end">${esc(fmtV(lastPt0[1][1]))}</text>` : '';
  const legend = series.length > 1 ? `<ul class="legend">${series.map((s, k) => `<li class="s${k}${s.cls ? ' ' + s.cls : ''}"><span aria-hidden="true"></span>${esc(s.name)}</li>`).join('')}</ul>` : '';
  const payload = { x: xs.map((_, i) => r1(X(i))), l: xs.map(x => fmtXTip(x)), t: [T, T + ih],
    s: series.map((s, k) => ({ n: s.name, k: `s${k}${s.cls ? ' ' + s.cls : ''}`, y: s.points.map(p => p[1] == null ? null : r1(Y(p[1]))), v: s.points.map(p => p[1] == null ? null : fmtV(p[1])) })) };
  return `<figure class="chart" data-chart="${esc(JSON.stringify(payload))}">${legend}<div class="plot"><svg viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${id}t${desc ? ` ${id}d` : ''}" preserveAspectRatio="xMidYMid meet"><title id="${id}t">${esc(title)}</title>${desc ? `<desc id="${id}d">${esc(desc)}</desc>` : ''}<defs><linearGradient id="${id}g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="g0"/><stop offset="1" class="g1"/></linearGradient></defs><g class="grid">${grid}</g><g class="xl">${xl}</g>${areaPath}${lines}${endLabel}</svg><div class="ctip" hidden></div></div></figure>`;
}

/** A data table for a chart, inside <details>, so every plotted value is readable as text. */
export function chartTable({ summary, head, rows }) {
  return `<details class="data"><summary>${esc(summary)}</summary><div class="scroll"><table><thead><tr>${head.map((h, i) => `<th scope="col"${i ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => i ? `<td class="n">${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

/** Decorative sparkline (the figures it shows are always printed next to it). ref = dashed reference series. */
export function spark(values, { w = 120, h = 34, ref = null, cls = '' } = {}) {
  const all = [...values, ...(ref || [])].filter(v => v != null);
  if (all.length < 2) return '';
  const lo = Math.min(...all), hi = Math.max(...all), pad = 3;
  const X = i => r1(pad + i * (w - 2 * pad) / (values.length - 1)), Y = v => r1(h - pad - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (h - 2 * pad));
  const d = vs => vs.map((v, i) => v == null ? '' : `${i && vs[i - 1] != null ? 'L' : 'M'}${X(i)} ${Y(v)}`).join('');
  const li = values.map((v, i) => v != null ? i : -1).filter(i => i >= 0).at(-1);
  return `<svg class="spark${cls ? ' ' + cls : ''}" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false">${ref ? `<path class="ref" d="${d(ref)}"/>` : ''}<path d="${d(values)}"/><circle cx="${X(li)}" cy="${Y(values[li])}" r="2.6"/></svg>`;
}
