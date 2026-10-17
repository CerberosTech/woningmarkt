// Sortable tables: click a column header to sort. Numeric cells carry data-v.
(() => {
  for (const table of document.querySelectorAll('table.sortable')) {
    const ths = [...table.tHead.rows[0].cells], body = table.tBodies[0];
    const coll = new Intl.Collator(document.documentElement.lang, { numeric: true, sensitivity: 'base' });
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
})();
