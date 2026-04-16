import '../styles/main.css';
import { initMockFileMaker } from './mock-filemaker.js';

// ── State ─────────────────────────────────────────────────────────────────────
let state = null;
const sel = new Set();

// ── FileMaker entry point ─────────────────────────────────────────────────────
window.receiveFromFileMaker = (data) => {
  state = typeof data === 'string' ? JSON.parse(data) : data;
  sel.clear();
  render();
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (import.meta.env.DEV) {
    initMockFileMaker();
  }
  renderWaiting();
});

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

  const root      = document.getElementById('root');
  const groups    = state.groups || [];
  const selCount  = sel.size;
  const totalAvail = state.stavkeCount || 0;

  root.innerHTML = '';

  // ── Topbar ──────────────────────────────────────────────────────────────────
  const tb = document.createElement('div');
  tb.className = 'flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200 flex-shrink-0 text-sm';
  tb.innerHTML = `
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
  root.appendChild(tb);

  tb.querySelector('#btn-attach')?.addEventListener('click', attachSelected);
  tb.querySelector('#btn-deselect')?.addEventListener('click', () => { sel.clear(); render(); });

  // ── Content ─────────────────────────────────────────────────────────────────
  const ct = document.createElement('div');
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
  } else {
    groups.forEach(g => ct.appendChild(buildGroup(g)));
  }

  root.appendChild(ct);
}

// ── Group card ────────────────────────────────────────────────────────────────
function buildGroup(g) {
  const stavke     = g.stavke || [];
  const selN       = stavke.filter(s => sel.has(s.stavkaPK)).length;
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

  // Group checkbox
  const cbGroup = card.querySelector('.cb-group');
  if (someSel) cbGroup.indeterminate = true;
  cbGroup.addEventListener('click', e => {
    e.stopPropagation();
    stavke.forEach(s => cbGroup.checked ? sel.add(s.stavkaPK) : sel.delete(s.stavkaPK));
    render();
  });

  // Row clicks
  card.querySelectorAll('[data-stavka]').forEach(row => {
    row.addEventListener('click', () => { toggleStavka(row.dataset.stavka); });
    row.querySelector('input[type=checkbox]')?.addEventListener('click', e => e.stopPropagation());
  });

  return card;
}

function buildRow(s) {
  const isSel = sel.has(s.stavkaPK);
  return `
    <tr data-stavka="${esc(s.stavkaPK)}"
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
function toggleStavka(pk) {
  sel.has(pk) ? sel.delete(pk) : sel.add(pk);
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
  loading = false;
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

  // Insert after topbar (first child) so it appears below the buttons
  const topbar = root.querySelector('.topbar');
  if (topbar) topbar.after(banner);
  else root.prepend(banner);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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
