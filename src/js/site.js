// Every page: sortable tables, count-up figures, chart crosshair and tooltip, slider and number-field sync.
(() => {
  const lang = document.documentElement.lang, loc = lang === 'nl' ? 'nl-NL' : 'en-GB';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Sortable tables: click a column header to sort. Numeric cells carry data-v.
  for (const table of document.querySelectorAll('table.sortable')) {
    const ths = [...table.tHead.rows[0].cells], body = table.tBodies[0];
    const coll = new Intl.Collator(lang, { numeric: true, sensitivity: 'base' });
    ths.forEach((th, i) => {
      const b = document.createElement('button'); b.type = 'button';
      while (th.firstChild) b.appendChild(th.firstChild);
      th.appendChild(b);
      b.addEventListener('click', () => {
        const dir = th.getAttribute('aria-sort') === 'descending' ? 'ascending' : th.getAttribute('aria-sort') === 'ascending' ? 'descending' : (th.classList.contains('n') ? 'descending' : 'ascending');
        ths.forEach(x => x.removeAttribute('aria-sort')); th.setAttribute('aria-sort', dir);
        const rows = [...body.rows], key = r => { const c = r.cells[i]; return c.dataset.v !== undefined ? (c.dataset.v === '' || c.dataset.v === 'undefined' ? null : +c.dataset.v) : c.textContent.trim(); };
        rows.sort((x, y) => { const a = key(x), b2 = key(y); if (a === null) return 1; if (b2 === null) return -1;
          const r = typeof a === 'number' ? a - b2 : coll.compare(a, b2); return dir === 'ascending' ? r : -r; });
        body.append(...rows);
      });
    });
  }

  // Count-up figures. The prebuilt text is the final value; it is put back exactly when the animation ends.
  const nf = o => new Intl.NumberFormat(loc, o);
  const F = { eur: nf({ style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }), int: nf({ maximumFractionDigits: 0 }), p1: nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 }), p2: nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }) };
  const fmt = (v, f) => f === 'eur' ? F.eur.format(Math.round(v)) : f === 'int' ? F.int.format(Math.round(v)) : f === 'pct1s' ? (v > 0.05 ? '+' : '') + F.p1.format(v) + '%' : f === 'pct2' ? F.p2.format(v) + '%' : String(v);
  const counters = [...document.querySelectorAll('[data-count]')];
  if (!reduce && counters.length && 'IntersectionObserver' in window) {
    const run = el => {
      const to = +el.dataset.count, f = el.dataset.f, final = el.textContent, t0 = performance.now(), ms = 1100;
      const from = f === 'pct2' ? to * 0.6 : 0;
      const step = now => { const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 4); el.textContent = k < 1 ? fmt(from + (to - from) * e, f) : final; if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); run(e.target); } }, { threshold: 0.4 });
    counters.forEach(el => io.observe(el));
  }

  // Charts: crosshair and tooltip from the data-chart payload; keyboard with the arrow keys.
  for (const fig of document.querySelectorAll('figure.chart[data-chart]')) {
    const D = JSON.parse(fig.dataset.chart), svg = fig.querySelector('svg'), tip = fig.querySelector('.ctip'), plot = fig.querySelector('.plot');
    const vb = svg.viewBox.baseVal, NS = 'http://www.w3.org/2000/svg';
    if ('ResizeObserver' in window) new ResizeObserver(() => { const w = svg.getBoundingClientRect().width; if (w) svg.style.setProperty('--k', Math.min(1.9, Math.max(0.7, vb.width / w)).toFixed(3)); }).observe(svg);
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'xh'); g.style.display = 'none';
    const line = document.createElementNS(NS, 'line'); line.setAttribute('y1', D.t[0]); line.setAttribute('y2', D.t[1]); g.appendChild(line);
    const dots = D.s.map(s => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('r', 5); c.setAttribute('class', s.k); g.appendChild(c); return c; });
    svg.appendChild(g);
    plot.tabIndex = 0; plot.setAttribute('aria-describedby', svg.getAttribute('aria-labelledby').split(' ')[0]);
    let cur = -1;
    const show = i => {
      if (i < 0 || i >= D.x.length) return;
      cur = i; const x = D.x[i];
      line.setAttribute('x1', x); line.setAttribute('x2', x); g.style.display = '';
      D.s.forEach((s, k) => { const y = s.y[i]; dots[k].style.display = y == null ? 'none' : ''; if (y != null) { dots[k].setAttribute('cx', x); dots[k].setAttribute('cy', y); } });
      tip.innerHTML = `<b>${esc(D.l[i])}</b><ul>${D.s.map(s => s.v[i] == null ? '' : `<li class="${esc(s.k)}"><span><i></i>${esc(s.n)}</span><strong>${esc(s.v[i])}</strong></li>`).join('')}</ul>`;
      tip.hidden = false;
      const r = svg.getBoundingClientRect(), pr = plot.getBoundingClientRect(), px = r.left - pr.left + x / vb.width * r.width;
      const tw = tip.offsetWidth, left = px + 14 + tw > pr.width ? px - 14 - tw : px + 14;
      tip.style.transform = `translate(${Math.max(0, left)}px, ${Math.max(0, (D.t[0] / vb.height) * r.height)}px)`;
    };
    const hide = () => { g.style.display = 'none'; tip.hidden = true; cur = -1; };
    const nearest = clientX => { const r = svg.getBoundingClientRect(), x = (clientX - r.left) * vb.width / r.width; let best = 0; D.x.forEach((v, i) => { if (Math.abs(v - x) < Math.abs(D.x[best] - x)) best = i; }); return best; };
    svg.addEventListener('pointermove', e => show(nearest(e.clientX)));
    svg.addEventListener('pointerdown', e => show(nearest(e.clientX)));
    svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
    plot.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(cur < 0 ? D.x.length - 1 : Math.min(D.x.length - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1)))); }
      if (e.key === 'Home') { e.preventDefault(); show(0); } if (e.key === 'End') { e.preventDefault(); show(D.x.length - 1); }
      if (e.key === 'Escape') hide();
    });
    plot.addEventListener('blur', hide);
  }

  // Sliders mirror their number field. The calculators listen to the number field.
  for (const r of document.querySelectorAll('input.range[data-for]')) {
    const n = document.getElementById(r.dataset.for);
    const fill = () => r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min) * 100).toFixed(2) + '%');
    r.addEventListener('input', () => { n.value = r.value; fill(); n.dispatchEvent(new Event('input', { bubbles: true })); });
    n.addEventListener('input', () => { if (n.value !== '') { r.value = n.value; fill(); } });
    fill();
  }
})();
