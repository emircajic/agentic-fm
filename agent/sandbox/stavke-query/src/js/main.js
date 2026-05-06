// Import styles
import '../styles/main.css';

// Import mock FileMaker for development
import { initMockFileMaker } from './mock-filemaker.js';
import { createDevControls } from './dev-controls.js';
import mockData from './mock-data.json';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const statusText    = document.getElementById('status-text');
const totalText     = document.getElementById('total-text');
const stateBox      = document.getElementById('state-box');
const stateIcon     = document.getElementById('state-icon');
const stateMsg      = document.getElementById('state-msg');
const resultsTable  = document.getElementById('results-table');
const tbody         = document.getElementById('tbody');
const thead         = resultsTable.querySelector('thead tr');
const selectAllCb   = document.getElementById('select-all');
const actionBar     = document.getElementById('action-bar');
const selectionCount = document.getElementById('selection-count');
const btnNapraviUFD = document.getElementById('btn-napravi-ufd');
const btnClearSel   = document.getElementById('btn-clear-selection');

// Modal refs
const modalBackdrop  = document.getElementById('ufd-modal-backdrop');
const modalClose     = document.getElementById('ufd-modal-close');
const modalCancel    = document.getElementById('ufd-modal-cancel');
const modalSubmit    = document.getElementById('ufd-modal-submit');
const fieldDobavljac = document.getElementById('ufd-dobavljac');
const fieldCount     = document.getElementById('ufd-count');
const fieldBrojFakture  = document.getElementById('ufd-broj-fakture');
const fieldDatumFakture = document.getElementById('ufd-datum-fakture');
const fieldNapomena     = document.getElementById('ufd-napomena');

// ─── Sort state ───────────────────────────────────────────────────────────────
const NUM_COLS = new Set(['kolicina', 'cijena', 'ukupno', 'fakturisana']);

let allRows  = [];
let sortCol  = null;
let sortAsc  = true;

// ─── Selection state ─────────────────────────────────────────────────────────
// Map from rendered row index → row data object
const selectedRows = new Map();

function updateActionBar() {
  const n = selectedRows.size;
  if (n > 0) {
    actionBar.classList.remove('hidden');
    selectionCount.textContent = `${n} stavki odabrano`;
  } else {
    actionBar.classList.add('hidden');
  }
}

function updateSelectAll() {
  const total   = tbody.querySelectorAll('input[type=checkbox]').length;
  const checked = selectedRows.size;
  selectAllCb.indeterminate = checked > 0 && checked < total;
  selectAllCb.checked       = total > 0 && checked === total;
}

function setRowSelected(tr, on) {
  if (on) {
    tr.classList.add('!bg-indigo-50', 'ring-1', 'ring-inset', 'ring-indigo-200');
  } else {
    tr.classList.remove('!bg-indigo-50', 'ring-1', 'ring-inset', 'ring-indigo-200');
  }
}

function clearSelection() {
  tbody.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.checked = false;
    setRowSelected(cb.closest('tr'), false);
  });
  selectedRows.clear();
  selectAllCb.checked       = false;
  selectAllCb.indeterminate = false;
  updateActionBar();
}

selectAllCb.addEventListener('change', () => {
  selectedRows.clear();
  tbody.querySelectorAll('input[type=checkbox]').forEach((cb, i) => {
    cb.checked = selectAllCb.checked;
    setRowSelected(cb.closest('tr'), selectAllCb.checked);
    if (selectAllCb.checked) selectedRows.set(i, cb._rowData);
  });
  updateActionBar();
});

btnClearSel.addEventListener('click', clearSelection);

// ─── FM Bridge ───────────────────────────────────────────────────────────────
window.receiveFromFileMaker = (data) => {
  const payload = typeof data === 'string' ? JSON.parse(data) : data;

  if (payload.error) { showError(payload.error); return; }

  const rows = payload.rows || [];
  if (rows.length === 0) { showEmpty(); return; }

  allRows = rows;
  sortCol = null;
  sortAsc = true;
  clearSortIndicators();
  clearSelection();

  renderTable(allRows, payload.rowCount ?? rows.length);
};


// ─── Sorting ─────────────────────────────────────────────────────────────────
function getSortValue(row, col) {
  const v = row[col];
  if (NUM_COLS.has(col)) return parseFloat(v) || 0;
  return String(v ?? '').toLowerCase();
}

function sortAndRender(col) {
  if (sortCol === col) {
    sortAsc = !sortAsc;
  } else {
    sortCol = col;
    sortAsc = true;
  }
  const sorted = [...allRows].sort((a, b) => {
    const va = getSortValue(a, col);
    const vb = getSortValue(b, col);
    if (va < vb) return sortAsc ? -1 :  1;
    if (va > vb) return sortAsc ?  1 : -1;
    return 0;
  });
  clearSelection();
  updateSortIndicators(col, sortAsc);
  renderRows(sorted);
}

function clearSortIndicators() {
  thead.querySelectorAll('th[data-col]').forEach(th => th.querySelector('.sort-icon')?.remove());
}

function updateSortIndicators(activeCol, asc) {
  thead.querySelectorAll('th[data-col]').forEach(th => {
    th.querySelector('.sort-icon')?.remove();
    if (th.dataset.col === activeCol) {
      const icon = document.createElement('span');
      icon.className = 'sort-icon ml-1 opacity-80';
      icon.textContent = asc ? '↑' : '↓';
      th.appendChild(icon);
    }
  });
}

resultsTable.addEventListener('click', (e) => {
  const th = e.target.closest('th[data-col]');
  if (!th || allRows.length === 0) return;
  sortAndRender(th.dataset.col);
});

// ─── Navigation (WV → FM) ────────────────────────────────────────────────────
function callFM(script, param) {
  if (typeof FileMaker !== 'undefined') {
    FileMaker.PerformScript(script, param);
  } else {
    console.log(`[Dev] ${script}`, param);
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────────
function renderTable(rows, rowCount) {
  renderRows(rows);
  stateBox.classList.add('hidden');
  resultsTable.classList.remove('hidden');
  statusText.textContent = `${rowCount} stavki`;
  totalText.textContent  = formatTotal(allRows);
}

function renderRows(rows) {
  tbody.innerHTML = '';
  selectedRows.clear();
  updateActionBar();

  rows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.className = idx % 2 === 0
      ? 'bg-white hover:bg-slate-50 transition-colors'
      : 'bg-slate-50/60 hover:bg-slate-100 transition-colors';

    // Fakturisana
    const fakt = Number(row.fakturisana) === 1;
    const svgCheck = `<svg class="inline w-4 h-4 text-emerald-500" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>`;
    const svgX    = `<svg class="inline w-4 h-4 text-slate-300" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>`;
    const faktHtml = row.ufdID
      ? `<a class="cursor-pointer" title="Otvori UFD" data-ufd-id="${esc(row.ufdID)}">${fakt ? svgCheck : svgX}</a>`
      : (fakt ? svgCheck : svgX);

    tr.innerHTML = `
      <td class="px-3 py-2.5 border-r border-slate-100 text-center w-8">
        <input type="checkbox" data-idx="${idx}"
               class="cursor-pointer accent-indigo-500 w-3.5 h-3.5">
      </td>
      <td class="px-3 py-2.5 whitespace-nowrap border-r border-slate-100 text-slate-500">${formatDate(row.datumPrimke)}</td>
      <td class="px-3 py-2.5 whitespace-nowrap border-r border-slate-100">
        <a class="text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer font-mono"
           data-primka-id="${esc(row.primkaID)}">${esc(row.brojFakturaDobavljaca) || '—'}</a>
      </td>
      <td class="px-3 py-2.5 border-r border-slate-100 max-w-[180px] truncate text-slate-600" title="${esc(row.dobavljac)}">${esc(row.dobavljac)}</td>
      <td class="px-3 py-2.5 whitespace-nowrap border-r border-slate-100 font-mono text-slate-500">${esc(row.sifra)}</td>
      <td class="px-3 py-2.5 border-r border-slate-100 max-w-[220px] truncate" title="${esc(row.naziv)}">${esc(row.naziv)}</td>
      <td class="px-3 py-2.5 whitespace-nowrap border-r border-slate-100 text-center text-slate-500">${esc(row.jm)}</td>
      <td class="px-3 py-2.5 whitespace-nowrap border-r border-slate-100 text-right tabular-nums">${formatNum(row.kolicina, 3)}</td>
      <td class="px-3 py-2.5 whitespace-nowrap border-r border-slate-100 text-right tabular-nums text-slate-600">${formatNum(row.cijena, 2)}</td>
      <td class="px-3 py-2.5 whitespace-nowrap border-r border-slate-100 text-right tabular-nums font-semibold">${formatNum(row.ukupno, 2)}</td>
      <td class="px-3 py-2.5 whitespace-nowrap border-r border-slate-100">
        <a class="text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer font-mono"
           data-invoice-id="${esc(row.invoiceID)}">${esc(row.brojFakture)}</a>
      </td>
      <td class="px-3 py-2.5 whitespace-nowrap border-r border-slate-100 text-slate-500">${formatDate(row.datumFakture)}</td>
      <td class="px-3 py-2.5 whitespace-nowrap text-center">${faktHtml}</td>
    `;

    // Attach row data to the checkbox for later retrieval
    const cb = tr.querySelector('input[type=checkbox]');
    cb._rowData = row;

    tbody.appendChild(tr);
  });

  // ── Row checkbox ──
  tbody.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type=checkbox]');
    if (!cb) return;
    const tr  = cb.closest('tr');
    const idx = parseInt(cb.dataset.idx, 10);
    if (cb.checked) {
      selectedRows.set(idx, cb._rowData);
    } else {
      selectedRows.delete(idx);
    }
    setRowSelected(tr, cb.checked);
    updateSelectAll();
    updateActionBar();
  });

  // ── Navigation links ──
  tbody.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-invoice-id], a[data-primka-id], a[data-ufd-id]');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.invoiceId) callFM('WV__GoToInvoice', a.dataset.invoiceId);
    if (a.dataset.primkaId)  callFM('WV__GoToPrimka',  a.dataset.primkaId);
    if (a.dataset.ufdId)     callFM('WV__GoToUFD',     a.dataset.ufdId);
  });
}

// ─── Napravi UFD — validation & modal ────────────────────────────────────────
btnNapraviUFD.addEventListener('click', () => {
  const rows = [...selectedRows.values()];

  // Check 1: all rows must be free (no existing UFD)
  const alreadyLinked = rows.filter(r => r.ufdID);
  if (alreadyLinked.length > 0) {
    alert(`${alreadyLinked.length} odabranih stavki već ima pripisanu ulaznu fakturu (zelena kvačica). Uklonite ih iz odabira i pokušajte ponovo.`);
    return;
  }

  // Check 2: single supplier
  const suppliers = new Set(rows.map(r => r.dobavljacID));
  if (suppliers.size > 1) {
    alert('Odabrane stavke su od više dobavljača. UFD možete kreirati samo za jednog dobavljača odjednom.');
    return;
  }

  // Pre-fill and open modal
  openModal(rows);
});

function openModal(rows) {
  const first = rows[0];
  fieldDobavljac.textContent = first.dobavljac;
  fieldCount.textContent     = `${rows.length} stavki`;
  fieldBrojFakture.value     = '';
  fieldDatumFakture.value    = '';
  fieldNapomena.value        = '';
  modalError.classList.add('hidden');
  modalError.textContent     = '';
  modalSubmit.disabled       = false;
  modalSubmit.textContent    = 'Napravi UFD';
  modalBackdrop.classList.remove('hidden');
  fieldBrojFakture.focus();
}

function closeModal() {
  modalBackdrop.classList.add('hidden');
}

modalClose.addEventListener('click',  closeModal);
modalCancel.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) closeModal();
});

modalSubmit.addEventListener('click', () => {
  const rows = [...selectedRows.values()];
  if (rows.length === 0) { closeModal(); return; }

  const stavkePKs = rows.map(r => r.spID);

  const param = {
    dobavljacID:       rows[0].dobavljacID,
    datumFakture:      fieldDatumFakture.value || '',
    napomena:          fieldNapomena.value.trim(),
    brojUlazneFakture: fieldBrojFakture.value.trim(),
    stavkePKs
  };

  closeModal();
  clearSelection();
  callFM('WV__CreateUFDFromSelection', JSON.stringify(param));
});

// ─── State helpers ────────────────────────────────────────────────────────────
function showEmpty() {
  stateIcon.textContent = '🔍';
  stateMsg.textContent  = 'Nema rezultata za zadane filtre.';
  stateBox.classList.remove('hidden');
  resultsTable.classList.add('hidden');
  statusText.textContent = '0 stavki';
  totalText.textContent  = '';
  allRows = [];
}

function showError(msg) {
  stateIcon.textContent = '⚠️';
  stateMsg.textContent  = `Greška: ${msg}`;
  stateBox.classList.remove('hidden');
  resultsTable.classList.add('hidden');
  statusText.textContent = 'Greška';
  totalText.textContent  = '';
  allRows = [];
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(val) {
  if (!val) return '';
  const s = String(val).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[2].padStart(2,'0')}.${mdy[1].padStart(2,'0')}.${mdy[3]}`;
  return s;
}

function formatNum(val, decimals = 2) {
  if (val == null || val === '') return '';
  const n = parseFloat(val);
  if (isNaN(n)) return String(val);
  return n.toLocaleString('hr-HR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatTotal(rows) {
  const sum = rows.reduce((acc, r) => acc + (parseFloat(r.ukupno) || 0), 0);
  return 'Ukupno: ' + formatNum(sum, 2) + ' €';
}

// ─── Dev bootstrap ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (import.meta.env.DEV) {
    const mock = initMockFileMaker();
    mock.setMockResponse('WV__QueryStavkePrimke', mockData);
    createDevControls();
    setTimeout(() => {
      if (window.receiveFromFileMaker) window.receiveFromFileMaker(mockData);
    }, 600);
    console.log('🔧 Dev mode: mock data pushes in 600ms');
  }
});
