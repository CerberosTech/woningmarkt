// Inline SVG line charts, rendered at build time. No JavaScript needed to read them.
import { esc } from './markdown.mjs';

function niceStep(range, n) {
  const raw = range / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

let uid = 0;

/**
 * @param {object} o
 * @param {Array<{name:string, cls?:string, points:Array<[string, number|null]>}>} o.series  same x labels in every series
 * @param {(n:number)=>string} o.fmtY      tick and end-label formatter
 * @param {string} o.title                 accessible name
 * @param {string} [o.desc]                accessible description
 * @param {number} [o.xEvery]              label every n-th x value
 * @param {boolean} [o.zero]               start the y axis at zero
 * @param {(x:string)=>string} [o.fmtX]    x label formatter
 */
export function lineChart({ series, fmtY, title, desc = '', xEvery = 1, zero = false, fmtX = x => x, w = 560, h = 300 }) {
  const id = `c${++uid}`;
  const xs = series[0].points.map(p => p[0]);
  const vals = series.flatMap(s => s.points.map(p => p[1])).filter(v => v != null);
  let lo = zero ? 0 : Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const step = niceStep(hi - lo, 4);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const L = 74, R = 16, T = 14, B = 34, iw = w - L - R, ih = h - T - B;
  const X = i => L + (xs.length === 1 ? iw / 2 : i * iw / (xs.length - 1));
  const Y = v => T + ih - (v - lo) / (hi - lo) * ih;
  const ticks = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  const grid = ticks.map(v => `<line x1="${L}" x2="${w - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L - 8}" y="${(Y(v) + 5).toFixed(1)}" text-anchor="end">${esc(fmtY(v))}</text>`).join('');
  const xl = xs.map((x, i) => (i % xEvery === 0 || i === xs.length - 1) && !(i !== xs.length - 1 && xs.length - 1 - i < xEvery / 2)
    ? `<text x="${X(i).toFixed(1)}" y="${h - 10}" text-anchor="middle">${esc(fmtX(x))}</text>` : '').join('');
  const lines = series.map((s, k) => {
    let d = '', pen = false;
    s.points.forEach(([, v], i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; pen = true; });
    const last = [...s.points.entries()].reverse().find(([, p]) => p[1] != null);
    const dot = last ? `<circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1][1]).toFixed(1)}" r="3.5"/>` : '';
    return `<g class="s s${k}${s.cls ? ' ' + s.cls : ''}"><path d="${d}"/>${dot}</g>`;
  }).join('');
  const legend = series.length > 1 ? `<ul class="legend">${series.map((s, k) => `<li class="s${k}${s.cls ? ' ' + s.cls : ''}"><span aria-hidden="true"></span>${esc(s.name)}</li>`).join('')}</ul>` : '';
  return `<figure class="chart">${legend}<svg viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${id}t${desc ? ` ${id}d` : ''}" preserveAspectRatio="xMidYMid meet"><title id="${id}t">${esc(title)}</title>${desc ? `<desc id="${id}d">${esc(desc)}</desc>` : ''}<g class="grid">${grid}</g><g class="xl">${xl}</g>${lines}</svg></figure>`;
}

/** A data table for a chart, inside <details>, so every plotted value is readable as text. */
export function chartTable({ summary, head, rows }) {
  return `<details class="data"><summary>${esc(summary)}</summary><div class="scroll"><table><thead><tr>${head.map((h, i) => `<th scope="col"${i ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => i ? `<td class="n">${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
