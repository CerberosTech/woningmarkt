// National choropleth (home hero and map page): animated metric and level switch, legend that highlights a class,
// zoom and pan (wheel, drag, pinch, buttons, keys), province drill-down, tooltip, side panel or bottom sheet,
// search and #GMxxxx deep links. All figures come from the mapdata payload written by the build.
(() => {
  const D = JSON.parse(document.getElementById('mapdata').textContent);
  const $ = id => document.getElementById(id);
  const svg = $('nlmap'), tip = $('tip'), panel = $('panel'), body = $('panel-body'), grab = panel.querySelector('.grab'), stMap = panel.closest('.st-map');
  const legendBox = $('legend'), form = $('mapctl'), find = $('find'), drillBox = $('drill'), drillName = $('drill-name'), zhint = $('zhint');
  const hov = svg.querySelector('#hl .hov'), selp = svg.querySelector('#hl .selp');
  const I = D.i18n, full = D.mode === 'full', loc = D.lang === 'nl' ? 'nl-NL' : 'en-GB';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)'), wide = matchMedia('(min-width: 60rem)');
  const IDX = { price: 2, yoy: 3, woz: 4, multi: 5 };
  const nfE = new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const nfP = new Intl.NumberFormat(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), nfI = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
  const unit = m => D.metrics[m].unit;
  const fmt = (v, m) => v == null ? I.nodata : unit(m) === 'eur' ? nfE.format(v) : (unit(m) === 'pctSigned' && v > 0 ? '+' : '') + nfP.format(v) + '%';
  const short = (v, m) => unit(m) === 'eur' ? '€' + nfI.format(v / 1000) + 'k' : (unit(m) === 'pctSigned' && v > 0 ? '+' : '') + (Number.isInteger(v) ? nfI.format(v) : nfP.format(v)) + '%';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let metric = 'price', level = 'gm', sel = null, drilled = null, hovCode = null;

  const paths = { gm: [...svg.querySelectorAll('#gm path')], pv: [...svg.querySelectorAll('#pv path')] };
  const byCode = { gm: new Map(paths.gm.map(p => [p.dataset.c, p])), pv: new Map(paths.pv.map(p => [p.dataset.c, p])) };
  const classOf = (v, b) => { if (v == null) return -1; const i = b.findIndex(x => v <= x); return i < 0 ? b.length : i; };
  const rampIdx = (i, b) => Math.round(i * (D.ramp.length - 1) / Math.max(1, b.length));
  const color = (v, b) => { const i = classOf(v, b); return i < 0 ? 'url(#hatch)' : D.ramp[rampIdx(i, b)]; };
  const val = (code, m = metric, lv = level) => D[lv][code]?.[IDX[m]] ?? null;
  const rankCache = {};
  const ranks = (lv, m) => rankCache[lv + m] ??= (() => {
    const arr = Object.keys(D[lv]).filter(c => val(c, m, lv) != null).sort((a, b) => val(b, m, lv) - val(a, m, lv)), r = new Map();
    arr.forEach((c, i) => r.set(c, i && val(arr[i - 1], m, lv) === val(c, m, lv) ? r.get(arr[i - 1]) : i + 1));
    return { r, n: arr.length };
  })();

  // ---------------------------------------------------------------- view: zoom and pan through the viewBox
  const VB = svg.viewBox.baseVal, W = VB.width, H = VB.height;
  let view = { x: 0, y: 0, w: W, h: H }, anim = 0;
  const atFull = () => view.w >= W - 0.5;
  const setView = v => { view = v; svg.setAttribute('viewBox', `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`); svg.classList.toggle('zoomed', !atFull()); };
  const mk = (cx, cy, w) => { w = Math.min(W, Math.max(W / 18, w)); const h = w * H / W; if (w >= W - 0.5) { cx = W / 2; cy = H / 2; } cx = Math.min(W, Math.max(0, cx)); cy = Math.min(H, Math.max(0, cy)); return { x: cx - w / 2, y: cy - h / 2, w, h }; };
  function animateTo(t, ms = 480) {
    cancelAnimationFrame(anim);
    if (reduce.matches || !ms) return setView(t);
    const f = { ...view }, t0 = performance.now();
    const step = now => { const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      setView({ x: f.x + (t.x - f.x) * e, y: f.y + (t.y - f.y) * e, w: f.w + (t.w - f.w) * e, h: f.h + (t.h - f.h) * e }); if (k < 1) anim = requestAnimationFrame(step); };
    anim = requestAnimationFrame(step);
  }
  const zoomBy = (f, cx = view.x + view.w / 2, cy = view.y + view.h / 2, ms = 260) => animateTo(mk(cx + (view.x + view.w / 2 - cx) / f, cy + (view.y + view.h / 2 - cy) / f, view.w / f), ms);
  // Fit a box; on wide screens the open panel covers the right side, so the box sits left of centre.
  const panelCovers = () => wide.matches && !panel.classList.contains('idle');
  function fit(b, pad = 1.2) {
    const w = Math.max(b.width * pad, b.height * pad * W / H, W / 18);
    animateTo(mk(b.x + b.width / 2 + (panelCovers() ? w * 0.2 : 0), b.y + b.height / 2 + (!wide.matches ? w * H / W * 0.12 : 0), w));
  }
  const toUser = (x, y) => new DOMPoint(x, y).matrixTransform(svg.getScreenCTM().inverse());
  const reset = () => animateTo(mk(W / 2, H / 2, W));

  // ---------------------------------------------------------------- painting and legend
  for (const lv of ['gm', 'pv']) for (const p of paths[lv]) { const b = p.getBBox(); p.style.setProperty('--d', ((b.x + b.width / 2) / W * 0.38).toFixed(3) + 's'); }
  function legend() {
    const b = D.breaks[metric][level], codes = Object.keys(D[level]);
    const count = i => codes.filter(c => classOf(val(c), b) === i).length;
    const items = b.length ? [...b.map((x, i) => [i, i === 0 ? `≤ ${fmt(x, metric)}` : `${fmt(b[i - 1], metric)} – ${fmt(x, metric)}`, i === 0 ? `≤ ${short(x, metric)}` : short(x, metric)]), [b.length, `> ${fmt(b.at(-1), metric)}`, `> ${short(b.at(-1), metric)}`]] : [];
    legendBox.innerHTML = `<p class="legend-t">${esc(D.metrics[metric].label)}</p><ul class="legend-map">${items.map(([i, l, sh]) => `<li data-k="${i}"><span class="sw" style="background:${D.ramp[rampIdx(i, b)]}"></span><span class="lb">${esc(l)}</span><span class="sh" aria-hidden="true">${esc(sh)}</span><span class="ct">${count(i)}</span></li>`).join('')}<li data-k="-1" class="nd"><span class="sw"></span><span class="lb">${esc(I.nodata)}</span><span class="sh" aria-hidden="true">${esc(I.nodata.toLowerCase())}</span><span class="ct">${codes.filter(c => val(c) == null).length}</span></li></ul>`;
  }
  let bin = null;
  function focusBin(k) {
    bin = k; const b = D.breaks[metric][level];
    legendBox.querySelectorAll('li[data-k]').forEach(li => li.classList.toggle('on', k != null && +li.dataset.k === k));
    for (const p of paths[level]) p.classList.toggle('dim', k != null && classOf(val(p.dataset.c), b) !== k);
  }
  legendBox.addEventListener('pointerover', e => { if (e.pointerType === 'mouse') { const li = e.target.closest('li[data-k]'); focusBin(li ? +li.dataset.k : null); } });
  legendBox.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') focusBin(null); });
  legendBox.addEventListener('click', e => { const li = e.target.closest('li[data-k]'); if (li) focusBin(bin === +li.dataset.k ? null : +li.dataset.k); });
  const applyDrill = () => { for (const p of paths.gm) p.classList.toggle('out', !!drilled && D.gm[p.dataset.c][1] !== drilled); };
  function paint() {
    svg.classList.toggle('pv', level === 'pv');
    const b = D.breaks[metric][level];
    for (const p of paths[level]) p.style.fill = color(val(p.dataset.c), b);
    legend(); focusBin(null); applyDrill();
  }

  // ---------------------------------------------------------------- panel
  const spark = (vals, ref) => {
    const all = [...vals, ...ref].filter(v => v != null); if (vals.filter(v => v != null).length < 2) return '';
    const lo = Math.min(...all), hi = Math.max(...all), w = 300, h = 72, X = i => 4 + i * (w - 8) / (vals.length - 1), Y = v => h - 6 - (v - lo) / (hi - lo || 1) * (h - 12);
    const d = vs => vs.map((v, i) => v == null ? '' : `${i && vs[i - 1] != null ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
    const li = vals.map((v, i) => v != null ? i : -1).filter(i => i >= 0).at(-1);
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="ref" d="${d(ref)}"/><path d="${d(vals)}"/><circle cx="${X(li).toFixed(1)}" cy="${Y(vals[li]).toFixed(1)}" r="3.5"/></svg>`;
  };
  const sparkFig = s => { const sp = spark(s, D.nl); if (!sp) return ''; const first = s.find(v => v != null), last = [...s].reverse().find(v => v != null);
    return `<figure class="p-spark">${sp}<figcaption><span>${D.y0}: ${esc(nfE.format(first))}</span><span>${D.y}: ${esc(nfE.format(last))}</span></figcaption><p class="note">${esc(I.spark)}</p></figure>`; };
  const closeBtn = () => !full && wide.matches ? `<button type="button" class="x" data-act="close" aria-label="${esc(I.close)}">×</button>` : '';
  const cards = (row, lv, code) => `<dl class="kv">${Object.keys(IDX).map(m => {
    const v = row[IDX[m]], R = ranks(lv, m), rr = code ? R.r.get(code) : null, pc = rr && R.n > 1 ? (1 - (rr - 1) / (R.n - 1)) * 100 : null;
    return `<div${m === metric ? ' class="on"' : ''}><dt>${esc(D.metrics[m].label)}</dt><dd>${esc(fmt(v, m))}</dd>${pc != null ? `<dd class="pc" title="${esc(I.pctile)}"><i style="--p:${pc.toFixed(1)}"></i></dd>` : ''}</div>`; }).join('')}</dl>`;
  function renderSel(code) {
    const isGm = level === 'gm', r = D[level][code], R = ranks(level, metric), rk = R.r.get(code);
    const pvCode = isGm ? r[1] : code, pvName = isGm ? D.pv[r[1]]?.[0] : r[0];
    body.innerHTML = `${closeBtn()}<p class="p-pre">${esc(isGm ? `${I.province} ${pvName ?? ''}` : I.province)}</p><h2>${esc(r[0])}</h2>`
      + (rk ? `<p class="p-rank"><b>#${rk}</b><span>${esc(`${I.of} ${R.n} ${isGm ? I.munis : I.provinces}: ${D.metrics[metric].short.toLowerCase()}, ${I.highFirst}`)}</span></p>` : `<p class="p-rank">${esc(I.nodata)}</p>`)
      + cards(r, level, code) + sparkFig(r[7])
      + (isGm ? '' : `<p class="note">${esc(I.multiProv)}. ${esc(I.wozProv)}.</p>`)
      + `<div class="p-links">${r[6] ? `<a class="btn" href="${r[6]}">${esc(`${I.cityPage} ${r[0]}`)}</a>` : ''}${isGm ? `<a class="btn ghost" href="${D.compare}?a=${code}">${esc(I.compare)}</a>` : ''}${drilled !== pvCode ? `<button type="button" class="btn ghost" data-drill="${pvCode}">${esc(`${I.drill} ${pvName}`)}</button>` : ''}</div>`;
  }
  function renderSummary() {
    const pvCode = drilled, row = pvCode ? D.pv[pvCode] : null;
    const codes = Object.keys(D.gm).filter(c => (!pvCode || D.gm[c][1] === pvCode) && val(c, metric, 'gm') != null).sort((a, b) => val(b, metric, 'gm') - val(a, metric, 'gm'));
    const list = cs => `<ul class="p-list">${cs.map(c => `<li><button type="button" data-pick="${c}"><span>${esc(D.gm[c][0])}</span><b>${esc(fmt(val(c, metric, 'gm'), metric))}</b></button></li>`).join('')}</ul>`;
    const nl = D.nl, nlLast = nl.at(-1), nlPrev = nl.at(-2);
    body.innerHTML = `<p class="p-pre">${esc(I.hint)}</p><h2>${esc(row ? row[0] : D.nlName)}</h2>`
      + (row ? cards(row, 'pv', pvCode) : `<dl class="kv"><div class="on"><dt>${esc(D.metrics.price.label)}</dt><dd>${esc(nfE.format(nlLast))}</dd></div><div><dt>${esc(D.metrics.yoy.label)}</dt><dd>${esc(fmt((nlLast - nlPrev) / nlPrev * 100, 'yoy'))}</dd></div></dl>`)
      + sparkFig(row ? row[7] : nl)
      + `<p class="p-h">${esc(`${I.highest}: ${D.metrics[metric].label}`)}</p>${list(codes.slice(0, 5))}<p class="p-h">${esc(I.lowest)}</p>${list(codes.slice(-5).reverse())}`;
  }
  const setSheet = open => { panel.classList.toggle('open', open); grab.setAttribute('aria-expanded', String(open)); };
  function select(code, { zoom = false } = {}) {
    sel = code;
    const p = byCode[level].get(code);
    selp.setAttribute('d', p ? p.getAttribute('d') : 'M0 0');
    panel.classList.remove('idle'); stMap.classList.add('has-sel');
    renderSel(code);
    if (zoom && p) fit(p.getBBox(), 4.5);
  }
  function clearSel() {
    sel = null; selp.setAttribute('d', 'M0 0'); stMap.classList.remove('has-sel');
    if (!full) panel.classList.add('idle');
    renderSummary();
  }
  function drill(pvCode) {
    drilled = pvCode;
    if (level !== 'gm') { level = 'gm'; form.querySelector('input[name=level][value=gm]').checked = true; }
    paint(); hideHover();
    drillBox.hidden = false; drillName.textContent = D.pv[pvCode][0];
    sel = null; selp.setAttribute('d', 'M0 0'); stMap.classList.remove('has-sel'); panel.classList.remove('idle');
    renderSummary(); setSheet(false);
    fit(byCode.pv.get(pvCode).getBBox(), 1.1);
  }
  function undrill() { drilled = null; drillBox.hidden = true; applyDrill(); reset(); if (sel) renderSel(sel); else clearSel(); }

  // ---------------------------------------------------------------- tooltip
  function hideHover() { tip.hidden = true; hovCode = null; hov.setAttribute('d', 'M0 0'); }
  function hover(e) {
    const p = e.target.closest?.('path[data-c]');
    if (!p || e.pointerType !== 'mouse') return hideHover();
    const code = p.dataset.c, r = D[level][code];
    if (hovCode !== code) {
      hovCode = code; hov.setAttribute('d', p.getAttribute('d'));
      const R = ranks(level, metric), rk = R.r.get(code), v = val(code);
      tip.innerHTML = `<b>${esc(r[0])}</b>${level === 'gm' ? `<span class="t-pv">${esc(`${I.province} ${D.pv[r[1]]?.[0] ?? ''}`)}</span>` : ''}<span class="t-v">${esc(fmt(v, metric))}</span>${rk ? `<span class="t-r">${esc(`${I.rank} ${rk} ${I.of} ${R.n}`)}</span>` : ''}`;
    }
    tip.hidden = false;
    const box = stMap.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX - box.left + 18, y = e.clientY - box.top + 18;
    if (x + tw > box.width - 8) x = e.clientX - box.left - tw - 18;
    if (y + th > box.height - 8) y = e.clientY - box.top - th - 18;
    tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }

  // ---------------------------------------------------------------- input: pointer, wheel, keys
  const pts = new Map(); let drag = null, pinch = null, moved = false;
  if (full) svg.style.touchAction = 'none';
  svg.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false;
    if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, v: { ...view }, id: e.pointerId };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, v: { ...view }, c: toUser((a.x + b.x) / 2, (a.y + b.y) / 2) }; drag = null; cancelAnimationFrame(anim); }
  });
  svg.addEventListener('pointermove', e => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()], f = Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, v = pinch.v, c = pinch.c;
      setView(mk(c.x + (v.x + v.w / 2 - c.x) / f, c.y + (v.y + v.h / 2 - c.y) / f, v.w / f)); moved = true; hideHover(); return;
    }
    if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (moved || (Math.hypot(dx, dy) > 5 && !atFull())) {
        if (!moved) { moved = true; svg.classList.add('dragging'); try { svg.setPointerCapture(e.pointerId); } catch { /* pointer gone */ } }
        const s = svg.getScreenCTM().a; cancelAnimationFrame(anim);
        setView(mk(drag.v.x + drag.v.w / 2 - dx / s, drag.v.y + drag.v.h / 2 - dy / s, drag.v.w)); hideHover(); return;
      }
    }
    hover(e);
  });
  const end = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { drag = null; svg.classList.remove('dragging'); } };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideHover(); });
  svg.addEventListener('click', e => {
    if (moved) { moved = false; return; }
    const p = e.target.closest('path[data-c]'); if (!p) return;
    if (level === 'pv') return drill(p.dataset.c);
    select(p.dataset.c);
    if (full) history.replaceState(null, '', '#' + p.dataset.c);
  });
  let hintT = 0;
  svg.addEventListener('wheel', e => {
    if (!full && !e.ctrlKey && !e.metaKey) { zhint.hidden = false; clearTimeout(hintT); hintT = setTimeout(() => { zhint.hidden = true; }, 1400); return; }
    if (e.deltaY > 0 && atFull() && !e.ctrlKey) return; // fully zoomed out: let the page scroll
    e.preventDefault();
    const p = toUser(e.clientX, e.clientY), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomBy(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0025)), p.x, p.y, 0);
  }, { passive: false });
  svg.addEventListener('keydown', e => {
    const k = e.key, step = view.w * 0.12;
    if (k === '+' || k === '=') zoomBy(1.6); else if (k === '-' || k === '_') zoomBy(1 / 1.6); else if (k === '0') reset();
    else if (k.startsWith('Arrow')) animateTo(mk(view.x + view.w / 2 + (k === 'ArrowRight' ? step : k === 'ArrowLeft' ? -step : 0), view.y + view.h / 2 + (k === 'ArrowDown' ? step : k === 'ArrowUp' ? -step : 0), view.w), 160);
    else if (k === 'Escape') { if (sel) clearSel(); else if (drilled) undrill(); }
    else return;
    e.preventDefault();
  });
  stMap.querySelector('.zoom').addEventListener('click', e => { const b = e.target.closest('button[data-z]'); if (!b) return; const z = b.dataset.z; if (z === 'in') zoomBy(1.6, undefined, undefined, 320); else if (z === 'out') zoomBy(1 / 1.6, undefined, undefined, 320); else { if (drilled) undrill(); else reset(); } });
  drillBox.addEventListener('click', e => { if (e.target.closest('[data-act=reset]')) undrill(); });
  body.addEventListener('click', e => {
    const d = e.target.closest('[data-drill]'), pk = e.target.closest('[data-pick]'), x = e.target.closest('[data-act=close]');
    if (d) drill(d.dataset.drill);
    else if (pk) { select(pk.dataset.pick, { zoom: true }); if (full) history.replaceState(null, '', '#' + pk.dataset.pick); }
    else if (x) clearSel();
  });
  // Bottom sheet: tap or drag the handle, tap the peek to open.
  let gy = null;
  grab.addEventListener('click', () => setSheet(!panel.classList.contains('open')));
  grab.addEventListener('pointerdown', e => { gy = e.clientY; });
  grab.addEventListener('pointerup', e => { if (gy != null && Math.abs(e.clientY - gy) > 24) setSheet(e.clientY < gy); gy = null; });
  body.addEventListener('click', e => { if (!wide.matches && !panel.classList.contains('open') && !e.target.closest('a,button')) setSheet(true); });

  // ---------------------------------------------------------------- controls, search, deep links
  form.addEventListener('change', e => {
    if (e.target.name === 'metric') metric = e.target.value;
    if (e.target.name === 'level') {
      level = e.target.value; hideHover();
      if (drilled) { drilled = null; drillBox.hidden = true; reset(); }
      sel = null; selp.setAttribute('d', 'M0 0'); stMap.classList.remove('has-sel'); if (!full) panel.classList.add('idle');
    }
    paint();
    if (sel && D[level][sel]) renderSel(sel); else renderSummary();
  });
  const byName = new Map(Object.entries(D.gm).map(([c, r]) => [r[0].toLowerCase(), c]));
  function pick(code) {
    if (!D.gm[code]) return false;
    if (level !== 'gm') { level = 'gm'; form.querySelector('input[name=level][value=gm]').checked = true; paint(); }
    if (drilled && D.gm[code][1] !== drilled) { drilled = null; drillBox.hidden = true; applyDrill(); }
    select(code, { zoom: true }); return true;
  }
  find.addEventListener('change', () => {
    const code = byName.get(find.value.trim().toLowerCase());
    if (code) { pick(code); if (full) history.replaceState(null, '', '#' + code); }
    else if (find.value.trim()) { body.innerHTML = `<p class="hint">${esc(I.notFound)}</p>`; panel.classList.remove('idle'); }
  });
  const fromHash = () => { const c = decodeURIComponent(location.hash.slice(1)); if (/^GM\d{4}$/.test(c)) pick(c); };
  window.addEventListener('hashchange', fromHash);
  paint(); renderSummary(); fromHash();
})();
