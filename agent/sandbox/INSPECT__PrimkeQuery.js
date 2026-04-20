import '@fontsource/pt-sans';
import '@fontsource/pt-sans/700.css';
import mockData from './mock-data.json';

// ── Inject styles ─────────────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'PT Sans', sans-serif;
    background: #ebebf0;
  }

  #app {
    height: 100vh;
    padding: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .tbl-wrap {
    flex: 1;
    overflow: auto;
    border-radius: 8px;
    border: 1px solid #d1d1d6;
    box-shadow: 0 1px 4px rgba(0,0,0,0.10);
    background: #fff;
  }

  .tbl {
    width: 100%;
    border-collapse: collapse;
    font-family: 'PT Sans', sans-serif;
    font-size: 12px;
  }

  .tbl thead { position: sticky; top: 0; z-index: 10; }

  .tbl th {
    background: #2c3e50;
    color: #ecf0f1;
    padding: 9px 12px;
    text-align: left;
    font-size: 11px;
    font-weight: 700;
    font-family: 'PT Sans', sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    border-right: 1px solid #3d5166;
  }
  .tbl th:last-child { border-right: none; }
  .tbl th:hover      { background: #3d5166; }
  .tbl th.r          { text-align: right; }

  .sort-icon        { margin-left: 4px; opacity: 0.3; }
  .sort-icon.active { opacity: 1; color: #5dade2; }

  .tbl tbody tr {
    border-left: 3px solid transparent;
    cursor: pointer;
    transition: background 0.08s;
  }
  .tbl tbody tr.even     { background: #ffffff; }
  .tbl tbody tr.odd      { background: #f4f5f7; }
  .tbl tbody tr:hover    { background: #ebf5fb; }
  .tbl tbody tr.selected {
    background: #d6eaf8;
    border-left-color: #2980b9;
  }

  .tbl td {
    padding: 6px 12px;
    border-bottom: 1px solid #e8e8ed;
    white-space: nowrap;
    color: #1c1c1e;
    font-family: 'PT Sans', sans-serif;
  }
  .tbl td.r {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .tbl tfoot tr {
    background: #eaecee;
    border-top: 2px solid #bdc3c7;
  }
  .tbl tfoot td {
    padding: 7px 12px;
    font-weight: 700;
    color: #2c3e50;
    font-family: 'PT Sans', sans-serif;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #aeaeb2;
    font-size: 13px;
    font-family: 'PT Sans', sans-serif;
  }
`;
document.head.appendChild(style);

// ── State ─────────────────────────────────────────────────────────────────────
let _rows     = [];
let _sort     = { key: null, asc: true };
let _selected = new Set();

// ── FM bridge ─────────────────────────────────────────────────────────────────
window.receiveFromFileMaker = (data) => {
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  _rows     = parsed.rows ?? [];
  _sort     = { key: null, asc: true };
  _selected = new Set();
  render();
};

function callFM(script, param) {
  window.FileMaker?.PerformScript?.(script, typeof param === 'string' ? param : JSON.stringify(param));
}

// ── Formatting ────────────────────────────────────────────────────────────────
function num(v) {
  return (v === '' || v == null)
    ? ''
    : Number(v).toLocaleString('bs-BA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Columns ───────────────────────────────────────────────────────────────────
const COLS = [
  { key: 'dobavljac',           label: 'Dobavljač',       minW: '130px' },
  { key: 'brFaktureDobavljaca', label: 'Br. fakt. dob.',  minW: '120px' },
  { key: 'opis',                label: 'Opis',            minW: '180px' },
  { key: 'kolicina',            label: 'Kol.',            minW: '55px',  cls: 'r' },
  { key: 'nabavnaCijena',       label: 'Nab. cij.',       minW: '90px',  cls: 'r', fmt: num },
  { key: 'prodajnaCijena',      label: 'Prod. cij.',      minW: '90px',  cls: 'r', fmt: num },
  { key: 'brFakture',           label: 'Br. fakture',     minW: '110px' },
  { key: 'datum',               label: 'Datum',           minW: '88px'  },
];

// ── Sort ──────────────────────────────────────────────────────────────────────
function sortBy(key) {
  _sort = _sort.key === key ? { key, asc: !_sort.asc } : { key, asc: true };
  render();
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  const root = document.getElementById('app');

  if (!_rows.length) {
    root.innerHTML = `<div class="empty-state">Nema rezultata.</div>`;
    return;
  }

  const rows = [..._rows].sort((a, b) => {
    if (!_sort.key) return 0;
    const va = a[_sort.key] ?? '', vb = b[_sort.key] ?? '';
    const c  = typeof va === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb), 'bs');
    return _sort.asc ? c : -c;
  });

  const totalKol  = rows.reduce((s, r) => s + (Number(r.kolicina)      || 0), 0);
  const totalNab  = rows.reduce((s, r) => s + (Number(r.nabavnaCijena)  || 0) * (Number(r.kolicina) || 0), 0);
  const totalProd = rows.reduce((s, r) => s + (Number(r.prodajnaCijena) || 0) * (Number(r.kolicina) || 0), 0);

  const thead = `<thead><tr>${COLS.map(c => {
    const icon = _sort.key === c.key
      ? `<span class="sort-icon active">${_sort.asc ? '↑' : '↓'}</span>`
      : `<span class="sort-icon">↕</span>`;
    return `<th data-key="${c.key}" class="${c.cls || ''}" style="min-width:${c.minW}">${c.label}${icon}</th>`;
  }).join('')}</tr></thead>`;

  const tbody = `<tbody>${rows.map((r, i) => {
    const isSel = _selected.has(r.stavkaPK);
    const cls   = isSel ? 'selected' : (i % 2 === 0 ? 'even' : 'odd');
    return `<tr class="${cls}" data-pk="${r.stavkaPK}">
      ${COLS.map(c => `<td class="${c.cls || ''}">${c.fmt ? c.fmt(r[c.key] ?? '') : (r[c.key] ?? '')}</td>`).join('')}
    </tr>`;
  }).join('')}</tbody>`;

  const tfoot = `<tfoot><tr>
    <td colspan="3">${rows.length} stavki</td>
    <td class="r">${totalKol}</td>
    <td class="r">${num(totalNab)}</td>
    <td class="r">${num(totalProd)}</td>
    <td colspan="2"></td>
  </tr></tfoot>`;

  root.innerHTML = `<div class="tbl-wrap"><table class="tbl">${thead}${tbody}${tfoot}</table></div>`;

  root.querySelectorAll('th[data-key]').forEach(th =>
    th.addEventListener('click', () => sortBy(th.dataset.key))
  );

  root.querySelectorAll('tr[data-pk]').forEach(tr =>
    tr.addEventListener('click', () => {
      const pk = tr.dataset.pk;
      _selected.has(pk) ? _selected.delete(pk) : _selected.add(pk);
      render();
    })
  );
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  render();
  if (import.meta.env.DEV) {
    window.receiveFromFileMaker(mockData);
  }
});
