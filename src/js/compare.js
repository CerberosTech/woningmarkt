// Compare any two municipalities, client-side, from the figures embedded at build time. Mirrored bars per row.
(() => {
  const D = JSON.parse(document.getElementById('cmpdata').textContent);
  const form = document.getElementById('cmpform'), out = document.getElementById('cmpout'), A = document.getElementById('ca'), B = document.getElementById('cb');
  const loc = D.lang === 'nl' ? 'nl-NL' : 'en-GB', na = D.i18n.na;
  const nE = new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const eur = v => v == null ? na : nE.format(v);
  const pct = (v, d = 1, s = false) => v == null ? na : (s && v > 0 ? '+' : '') + new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + '%';
  const num = (v, d = 0) => v == null ? na : new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const vals = r => [[eur(r.p), r.p], [pct(r.yoy, 1, true), r.yoy], [pct(r.ten, 1, true), r.ten], [eur(r.woz), r.woz], [pct(r.own, 0), r.own], [pct(r.multi, 0), r.multi], [r.med ?? na, null], [num(r.dw), r.dw], [num(r.inh), r.inh], [num(r.cars, 1), r.cars]];
  const name = r => r.url ? `<a href="${r.url}">${esc(r.n)}</a>` : esc(r.n);
  const bar = (v, max) => v == null || !max ? '' : `<span class="bf${v < 0 ? ' neg' : ''}"><i style="--w:${(Math.abs(v) / max * 100).toFixed(1)}%"></i></span>`;
  function render() {
    const a = A.value, b = B.value;
    if (a === b) { out.innerHTML = `<p class="note">${esc(D.i18n.same)}</p>`; return; }
    const ra = D.rows[a], rb = D.rows[b], va = vals(ra), vb = vals(rb);
    const pair = D.pairs[`${a}|${b}`] || D.pairs[`${b}|${a}`];
    let sum = '';
    if (ra.p != null && rb.p != null) {
      const hi = ra.p >= rb.p ? ra : rb, lo = hi === ra ? rb : ra;
      sum = ra.p === rb.p ? D.i18n.equal.replace('{a}', esc(ra.n)).replace('{b}', esc(rb.n))
        : D.i18n.more.replace('{a}', esc(hi.n)).replace('{b}', esc(lo.n)).replace('{d}', esc(eur(hi.p - lo.p))).replace('{p}', esc(pct((hi.p - lo.p) / lo.p * 100, 1, true)));
    }
    const rows = D.labels.map((l, i) => { const [ta, x] = va[i], [tb, y] = vb[i], max = x == null && y == null ? 0 : Math.max(Math.abs(x ?? 0), Math.abs(y ?? 0));
      return `<tr><th scope="row">${esc(l)}</th><td class="n ca"><span class="v">${esc(ta)}</span>${bar(x, max)}</td><td class="cb">${bar(y, max)}<span class="v">${esc(tb)}</span></td></tr>`; }).join('');
    out.innerHTML = `<p class="cmp-sum">${sum}</p><div class="scroll"><table class="cmp butterfly"><thead><tr><th scope="col"><span class="vh">${esc(D.i18n.measure)}</span></th><th scope="col" class="n ca">${name(ra)}</th><th scope="col" class="cb">${name(rb)}</th></tr></thead><tbody>${rows}</tbody></table></div>`
      + (pair ? `<p class="more"><a href="${pair}">${esc(D.i18n.open)}</a></p>` : '');
  }
  const q = new URLSearchParams(location.search);
  A.value = D.rows[q.get('a')] ? q.get('a') : 'GM0363';
  B.value = D.rows[q.get('b')] && q.get('b') !== A.value ? q.get('b') : (A.value === 'GM0599' ? 'GM0363' : 'GM0599');
  const commit = () => { history.replaceState(null, '', `?a=${A.value}&b=${B.value}`); render(); };
  form.addEventListener('submit', e => { e.preventDefault(); commit(); });
  form.addEventListener('change', commit);
  document.getElementById('swap').addEventListener('click', () => { [A.value, B.value] = [B.value, A.value]; commit(); });
  render();
})();
