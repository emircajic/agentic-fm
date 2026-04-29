import '../styles/main.css';
import { initMockFileMaker } from './mock-filemaker.js';

// ── State ─────────────────────────────────────────────────────────────────────
let state = null;
const sel = new Set();
let filterText = '';

// ── FileMaker entry point ─────────────────────────────────────────────────────
window.receiveFromFileMaker = (data) => {
  state = typeof data === 'string' ? JSON.parse(data) : data;
  sel.clear();
  filterText = '';
  render();
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (import.meta.env.DEV) {
    initMockFileMaker();
  }
  renderWaiting();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const pk = (v) => String(v == null ? '' : v);

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmt(n) {
  if (n == null || n === '') return '—';
  const num = Number(n);
  return isNaN(num) ? esc(n) : num.toLocaleString('hr-HR');
}

function fmtPrice(n) {
  if (n == null || n === '' || Number(n) === 0) return '—';
  return Number(n).toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function statusBadge(status) {
  if (!status) return '';
  const s = String(status).toLowerCase();
  let cls = 'bg-gray-100 text-gray-500';
  let dot = 'bg-gray-400';
  if      (s.includes('slobod') || s.includes('free'))        { cls = 'bg-green-50 text-green-700';  dot = 'bg-green-500'; }
  else if (s.includes('djelomi') || s.includes('part'))       { cls = 'bg-amber-50 text-amber-700';  dot = 'bg-amber-400'; }
  else if (s.includes('prenesen') || s.includes('used'))      { cls = 'bg-gray-100 text-gray-400';   dot = 'bg-gray-300'; }
  return `
    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${cls}">
      <span class="w-1.5 h-1.5 rounded-full ${dot}"></span>
      ${esc(status)}
    </span>
  `;
}

// ── Filter matching ───────────────────────────────────────────────────────────
function matchesFilter(g) {
  if (!filterText) return true;
  const t = filterText.toLowerCase();
  if (g.brojFakture?.toLowerCase().includes(t)) return true;
  if (g.datum?.toLowerCase().includes(t)) return true;
  return (g.stavke || []).some(s =>
    s.sifra?.toLowerCase().includes(t) || s.naziv?.toLowerCase().includes(t)
  );
}

// ── Render ─────────────────────────────────────────────────────────────────────
function renderWaiting() {
  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
      <svg class="w-10 h-10 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
      </svg>
      <p class="text-sm">Čeka podatke iz FileMakera…</p>
    </div>
  `;
}

function render() {
  if (!state) return;

  // Preserve scroll position across re-renders (bug 3)
  const prevScrollTop = document.getElementById('ct')?.scrollTop ?? 0;

  const root      = document.getElementById('root');
  const groups    = state.groups || [];
  const selCount  = sel.size;
  const totalAvail = state.stavkeCount || 0;
  const visible   = groups.filter(matchesFilter);

  root.innerHTML = '';

  // ── Topbar ──────────────────────────────────────────────────────────────────
  const tb = document.createElement('div');
  tb.className = 'flex-shrink-0 bg-white border-b border-gray-200';

  // Stats + action row
  const statsRow = document.createElement('div');
  statsRow.className = 'flex items-center gap-2 px-3 py-2 text-sm';
  statsRow.innerHTML = `
    <span class="flex-1 text-gray-500">
      <strong class="text-gray-800">${groups.length}</strong> primke ·
      <strong class="text-gray-800">${totalAvail}</strong> stavki
      ${selCount > 0 ? ` · <strong class="text-blue-600">${selCount} odabrano</strong>` : ''}
    </span>
    <div class="flex items-center gap-1.5">
      ${selCount > 0 ? `<button id="btn-deselect" class="px-3 py-1 text-xs font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50">Odznači sve</button>` : ''}
      <button id="btn-attach"
        class="px-4 py-1 text-xs font-medium rounded-md text-white
               ${selCount > 0 ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-300 cursor-not-allowed'}"
        ${selCount === 0 ? 'disabled' : ''}>
        ${selCount > 0 ? `Priloži (${selCount})` : 'Priloži'}
      </button>
    </div>
  `;
  tb.appendChild(statsRow);

  // Filter row
  const filterRow = document.createElement('div');
  filterRow.className = 'flex items-center gap-2 px-3 pb-2';
  filterRow.innerHTML = `
    <div class="relative flex-1">
      <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
           viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
      </svg>
      <input id="filter-input" type="text" placeholder="Pretraži primke, šifre, nazive…"
        value="${esc(filterText)}"
        class="w-full pl-8 pr-7 py-1.5 text-xs rounded-md border border-gray-200 bg-gray-50
               focus:outline-none focus:ring-1 focus:ring-blue-400 focus:bg-white placeholder-gray-400">
      ${filterText ? `
        <button id="btn-clear-filter"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 leading-none">
          <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      ` : ''}
    </div>
  `;
  tb.appendChild(filterRow);

  root.appendChild(tb);

  // Wire topbar events
  statsRow.querySelector('#btn-attach')?.addEventListener('click', attachSelected);
  statsRow.querySelector('#btn-deselect')?.addEventListener('click', () => { sel.clear(); render(); });

  const filterInput = filterRow.querySelector('#filter-input');
  let debounceTimer;
  filterInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      filterText = filterInput.value;
      render();
    }, 150);
  });
  // Keep cursor at end after re-render
  filterInput.addEventListener('focus', () => {
    const len = filterInput.value.length;
    filterInput.setSelectionRange(len, len);
  });
  filterRow.querySelector('#btn-clear-filter')?.addEventListener('click', () => {
    filterText = '';
    render();
  });

  // Focus the filter input after render if it was focused before
  if (document.activeElement?.id === 'filter-input' || filterText !== '') {
    requestAnimationFrame(() => filterInput.focus());
  }

  // ── Content ─────────────────────────────────────────────────────────────────
  const ct = document.createElement('div');
  ct.id = 'ct';
  ct.className = 'flex-1 overflow-y-auto p-2';

  if (groups.length === 0) {
    ct.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full text-gray-400 gap-2 py-12">
        <svg class="w-8 h-8 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
        </svg>
        <p class="text-sm">Nema dostupnih stavki za ovog dobavljača.</p>
      </div>
    `;
  } else if (visible.length === 0) {
    ct.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full text-gray-400 gap-2 py-12">
        <svg class="w-8 h-8 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <p class="text-sm">Nema rezultata za "<em>${esc(filterText)}</em>".</p>
      </div>
    `;
  } else {
    visible.forEach(g => ct.appendChild(buildGroup(g)));
  }

  root.appendChild(ct);

  // Restore scroll position (bug 3)
  ct.scrollTop = prevScrollTop;
}

// ── Group card ────────────────────────────────────────────────────────────────
function buildGroup(g) {
  const stavke     = g.stavke || [];
  const selN       = stavke.filter(s => sel.has(pk(s.stavkaPK))).length;
  const allSel     = selN === stavke.length && stavke.length > 0;
  const someSel    = selN > 0 && !allSel;

  const card = document.createElement('div');
  card.className = `bg-white border rounded-lg mb-2 overflow-hidden ${allSel ? 'border-blue-300' : 'border-gray-200'}`;

  const badgeText  = selN > 0 ? `${selN} / ${stavke.length}` : stavke.length;
  const badgeCls   = allSel
    ? 'bg-blue-600 text-white'
    : selN > 0
      ? 'bg-blue-100 text-blue-700'
      : 'bg-gray-100 text-gray-600';

  card.innerHTML = `
    <div class="flex items-center gap-2 px-3 py-2 ${allSel ? 'bg-blue-50 border-b border-blue-100' : 'bg-gray-50 border-b border-gray-100'} select-none">
      <input type="checkbox" class="cb-group w-3.5 h-3.5 accent-blue-600 cursor-pointer flex-shrink-0"
        data-primka="${esc(g.primkaPK)}" ${allSel ? 'checked' : ''}>
      <span class="flex-1 font-semibold text-sm text-gray-800">${esc(g.brojFakture || '—')}</span>
      <span class="text-xs text-gray-400">${esc(g.datum || '')}</span>
      <span class="text-xs font-semibold px-2 py-0.5 rounded-full ${badgeCls}">${badgeText}</span>
    </div>
    <table class="w-full text-xs border-collapse">
      <thead>
        <tr class="bg-gray-50 text-gray-400 uppercase tracking-wide text-[10px]">
          <th class="w-7 px-2 py-1.5 border-b border-gray-100"></th>
          <th class="px-2 py-1.5 border-b border-gray-100 text-left">Šifra</th>
          <th class="px-2 py-1.5 border-b border-gray-100 text-left">Naziv</th>
          <th class="px-2 py-1.5 border-b border-gray-100 text-right">Kol.</th>
          <th class="px-2 py-1.5 border-b border-gray-100 text-right">Prodajna</th>
          <th class="px-2 py-1.5 border-b border-gray-100 text-right">Dostupno</th>
          <th class="px-2 py-1.5 border-b border-gray-100">Status</th>
        </tr>
      </thead>
      <tbody>
        ${stavke.map(s => buildRow(s)).join('')}
      </tbody>
    </table>
  `;

  // Group checkbox: toggle all stavke without scrolling (bug 3 fix: render restores scroll)
  const cbGroup = card.querySelector('.cb-group');
  if (someSel) cbGroup.indeterminate = true;
  cbGroup.addEventListener('click', e => {
    e.stopPropagation();
    stavke.forEach(s => cbGroup.checked ? sel.add(pk(s.stavkaPK)) : sel.delete(pk(s.stavkaPK)));
    render();
  });

  // Row clicks (bug 2 fix: checkbox click now also calls toggleStavka)
  card.querySelectorAll('[data-stavka]').forEach(row => {
    row.addEventListener('click', () => toggleStavka(row.dataset.stavka));
    row.querySelector('input[type=checkbox]')?.addEventListener('click', e => {
      e.stopPropagation();
      toggleStavka(row.dataset.stavka);
    });
  });

  return card;
}

function buildRow(s) {
  const isSel = sel.has(pk(s.stavkaPK));
  return `
    <tr data-stavka="${esc(pk(s.stavkaPK))}"
        class="cursor-pointer border-b border-gray-50 last:border-0 ${isSel ? 'bg-blue-50' : 'hover:bg-gray-50'}">
      <td class="px-2 py-1.5 text-center">
        <input type="checkbox" class="w-3.5 h-3.5 accent-blue-600 cursor-pointer" ${isSel ? 'checked' : ''}>
      </td>
      <td class="px-2 py-1.5 font-mono text-[11px] text-gray-500 whitespace-nowrap">${esc(s.sifra || '')}</td>
      <td class="px-2 py-1.5 text-gray-800">${esc(s.naziv || '')}</td>
      <td class="px-2 py-1.5 text-right text-gray-600 whitespace-nowrap">${fmt(s.kolicina)}</td>
      <td class="px-2 py-1.5 text-right text-gray-600 whitespace-nowrap">${fmtPrice(s.prodajna)}</td>
      <td class="px-2 py-1.5 text-right text-gray-600 whitespace-nowrap">${fmt(s.qtyAvailable)}</td>
      <td class="px-2 py-1.5">${statusBadge(s.transferStatus)}</td>
    </tr>
  `;
}

// ── Interaction ───────────────────────────────────────────────────────────────
function toggleStavka(stavkaPK) {
  const key = pk(stavkaPK);
  sel.has(key) ? sel.delete(key) : sel.add(key);
  render();
}

function attachSelected() {
  if (!sel.size || !state) return;

  const param = JSON.stringify({
    callbackScript:  state.callbackScript,
    callbackContext: state.callbackContext || {},
    stavkePKs:       Array.from(sel)
  });

  window.FileMaker?.PerformScript('PICKER__Callback', param);
}

// Called by PICKER__Callback on domain script failure
window.receiveError = (message) => {
  showError(message);
};

// ── Error banner ──────────────────────────────────────────────────────────────
function showError(message) {
  const root = document.getElementById('root');
  const existing = root.querySelector('.error-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.className = 'error-banner flex items-center gap-2 px-3 py-2 bg-red-50 border-b border-red-200 text-red-700 text-xs flex-shrink-0';
  banner.innerHTML = `
    <svg class="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
    </svg>
    <span class="flex-1">${esc(message || 'Greška pri prilaganju stavki.')}</span>
    <button onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-600 font-bold leading-none">✕</button>
  `;

  const topbar = root.querySelector('.topbar');
  if (topbar) topbar.after(banner);
  else root.prepend(banner);
}
