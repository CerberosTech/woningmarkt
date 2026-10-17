// Choropleth map: switch metric and level, tooltip, click panel, search and #GMxxxx deep links.
(() => {
  const D = JSON.parse(document.getElementById('mapdata').textContent);
  const svg = document.getElementById('nlmap'), tip = document.getElementById('tip'), panel = document.getElementById('panel');
  const legendBox = document.getElementById('legend'), form = document.getElementById('mapctl'), find = document.getElementById('find');
  const loc = D.lang === 'nl' ? 'nl-NL' : 'en-GB', I = D.i18n;
  const IDX = { price: 2, yoy: 3, woz: 4, multi: 5 };
  const nfE = new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const nfP = new Intl.NumberFormat(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmt = (v, m) => { if (v == null) return I.nodata; const u = D.metrics[m].unit;
    return u === 'eur' ? nfE.format(v) : (u === 'pctSigned' && v > 0 ? '+' : '') + nfP.format(v) + '%'; };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let metric = 'price', level = 'gm', sel = null;

  const classOf = (v, b) => { if (v == null) return -1; const i = b.findIndex(x => v <= x); return i < 0 ? b.length : i; };
  const color = (v, b) => { const i = classOf(v, b); return i < 0 ? 'var(--nodata)' : D.ramp[Math.round(i * (D.ramp.length - 1) / Math.max(1, b.length))]; };
  const val = (code, m = metric, lv = level) => D[lv][code]?.[IDX[m]] ?? null;

  function legend() {
    const b = D.breaks[metric][level];
    let items = '';
    if (b.length) {
      items = b.map((x, i) => `<li><span style="background:${color(x, b)}"></span>${esc(i === 0 ? '≤ ' + fmt(x, metric) : fmt(b[i - 1], metric) + ' – ' + fmt(x, metric))}</li>`).join('')
        + `<li><span style="background:${color(Infinity, b)}"></span>${esc('> ' + fmt(b[b.length - 1], metric))}</li>`;
    }
    legendBox.innerHTML = `<ul class="legend-map">${items}<li><span class="nd"></span>${esc(I.nodata)}</li></ul>`;
  }
  function paint() {
    svg.classList.toggle('pv', level === 'pv');
    const b = D.breaks[metric][level];
    for (const p of svg.querySelectorAll(`#${level} path`)) p.setAttribute('fill', color(val(p.dataset.c), b));
    legend();
    if (sel && D[level][sel]) show(sel); else if (sel) { sel = null; panel.innerHTML = `<p class="hint">${esc(panel.dataset.hint)}</p>`; }
  }
  function show(code) {
    sel = code;
    svg.querySelectorAll('path.sel').forEach(p => p.classList.remove('sel'));
    const p = svg.querySelector(`#${level} path[data-c="${code}"]`);
    if (p) { p.classList.add('sel'); p.parentNode.appendChild(p); }
    const r = D[level][code];
    const rows = Object.keys(IDX).map(m => `<div${m === metric ? ' class="on"' : ''}><dt>${esc(D.metrics[m].label)}</dt><dd>${esc(fmt(r[IDX[m]], m))}</dd></div>`).join('');
    const pvName = level === 'gm' && r[1] ? D.pv[r[1]]?.[0] : null;
    panel.innerHTML = `<h2>${esc(r[0])}</h2>${pvName ? `<p class="pv-name">${esc(I.province)}: ${esc(pvName)}</p>` : ''}<dl class="facts small">${rows}</dl>`
      + (level === 'pv' ? `<p class="note">${esc(I.multiProv)}. ${esc(I.wozProv)}.</p>` : '')
      + (r[6] ? `<p><a href="${r[6]}">${esc(I.cityPage)} ${esc(r[0])}</a></p>` : '')
      + (level === 'gm' ? `<p><a href="${D.compare}?a=${code}">${esc(I.compare)}</a></p>` : '');
  }
  panel.dataset.hint = panel.textContent.trim();

  form.addEventListener('change', e => {
    if (e.target.name === 'metric') metric = e.target.value;
    if (e.target.name === 'level') { level = e.target.value; svg.querySelectorAll('path.sel').forEach(p => p.classList.remove('sel')); }
    paint();
  });
  svg.addEventListener('click', e => { const p = e.target.closest('path[data-c]'); if (p) { show(p.dataset.c); if (level === 'gm') history.replaceState(null, '', '#' + p.dataset.c); } });
  svg.addEventListener('pointermove', e => {
    const p = e.target.closest('path[data-c]'); if (!p || e.pointerType === 'touch') { tip.hidden = true; return; }
    const box = svg.parentNode.getBoundingClientRect(), code = p.dataset.c;
    tip.textContent = `${D[level][code][0]}: ${fmt(val(code), metric)}`;
    tip.style.left = (e.clientX - box.left) + 'px'; tip.style.top = (e.clientY - box.top) + 'px'; tip.hidden = false;
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });

  const byName = new Map(Object.entries(D.gm).map(([c, r]) => [r[0].toLowerCase(), c]));
  function pick(code) {
    if (!D.gm[code]) return false;
    if (level !== 'gm') { level = 'gm'; form.querySelector('input[name=level][value=gm]').checked = true; paint(); }
    show(code); return true;
  }
  find.addEventListener('change', () => {
    const code = byName.get(find.value.trim().toLowerCase());
    if (code) { pick(code); history.replaceState(null, '', '#' + code); panel.focus?.(); }
    else if (find.value.trim()) panel.innerHTML = `<p class="hint">${esc(I.notFound)}</p>`;
  });
  const fromHash = () => { const c = decodeURIComponent(location.hash.slice(1)); if (/^GM\d{4}$/.test(c)) pick(c); };
  window.addEventListener('hashchange', fromHash);
  legend(); fromHash();
})();
