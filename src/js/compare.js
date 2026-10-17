// Compare any two municipalities, client-side, from the figures embedded at build time.
(() => {
  const D = JSON.parse(document.getElementById('cmpdata').textContent);
  const form = document.getElementById('cmpform'), out = document.getElementById('cmpout'), A = document.getElementById('ca'), B = document.getElementById('cb');
  const loc = D.lang === 'nl' ? 'nl-NL' : 'en-GB', na = D.i18n.na;
  const eur = v => v == null ? na : new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
  const pct = (v, d = 1, s = false) => v == null ? na : (s && v > 0 ? '+' : '') + new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + '%';
  const num = (v, d = 0) => v == null ? na : new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const vals = r => [eur(r.p), pct(r.yoy, 1, true), pct(r.ten, 1, true), eur(r.woz), pct(r.own, 0), pct(r.multi, 0), r.med ?? na, num(r.dw), num(r.inh), num(r.cars, 1)];
  const name = (r) => r.url ? `<a href="${r.url}">${esc(r.n)}</a>` : esc(r.n);
  function render() {
    const a = A.value, b = B.value;
    if (a === b) { out.innerHTML = `<p class="note">${esc(D.i18n.same)}</p>`; return; }
    const ra = D.rows[a], rb = D.rows[b], va = vals(ra), vb = vals(rb);
    const pair = D.pairs[`${a}|${b}`] || D.pairs[`${b}|${a}`];
    out.innerHTML = `<div class="scroll"><table class="cmp"><thead><tr><th scope="col"></th><th scope="col" class="n">${name(ra)}</th><th scope="col" class="n">${name(rb)}</th></tr></thead><tbody>`
      + D.labels.map((l, i) => `<tr><th scope="row">${esc(l)}</th><td class="n">${esc(va[i])}</td><td class="n">${esc(vb[i])}</td></tr>`).join('') + `</tbody></table></div>`
      + (pair ? `<p><a href="${pair}">${esc(D.i18n.open)}</a></p>` : '');
  }
  const q = new URLSearchParams(location.search);
  A.value = D.rows[q.get('a')] ? q.get('a') : 'GM0363';
  B.value = D.rows[q.get('b')] && q.get('b') !== A.value ? q.get('b') : (A.value === 'GM0599' ? 'GM0363' : 'GM0599');
  form.addEventListener('submit', e => { e.preventDefault(); history.replaceState(null, '', `?a=${A.value}&b=${B.value}`); render(); });
  form.addEventListener('change', render);
  render();
})();
