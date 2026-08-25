import '../styles/main.css';
import { initMockFileMaker } from './mock-filemaker.js';
import { createDevControls } from './dev-controls.js';

// ── Pipeline (fixed order) + status metadata from the design handoff ────────
const STATUS_LIST = ['U toku', 'Otvoren', 'Zakazan', 'Završen', 'Obračunat', 'Fakturisan', 'Naplaćen', 'Otkazan'];
const STATUS_META = {
  'U toku':     { color: '#e8821a', tone: 'Aktivno u radionici' },
  'Otvoren':    { color: '#4a6b8a', tone: 'Zahtjev / upit' },
  'Zakazan':    { color: '#7b61c9', tone: 'Dogovoren termin' },
  'Završen':    { color: '#2e9e5b', tone: 'Radovi gotovi' },
  'Obračunat':  { color: '#5b7a8c', tone: 'Obračun spreman' },
  'Fakturisan': { color: '#3f6f9f', tone: 'Faktura izdana' },
  'Naplaćen':   { color: '#1f8a4c', tone: 'Plaćeno' },
  'Otkazan':    { color: '#b0392f', tone: 'Otkazano' },
  _default:     { color: '#37474f', tone: '' },
};
const PERIOD_WORD = { day: 'Dan', week: 'Sedmica', month: 'Mjesec' };

// ── Icons (thin-stroke set from the design handoff) ─────────────────────────
const ICON_PATHS = {
  car: '<path d="M5 13l1.5-4.5A2 2 0 018.4 7h7.2a2 2 0 011.9 1.5L19 13M5 13h14M5 13v4m14-4v4M6 17v1.5M18 17v1.5M7 15.5h.01M17 15.5h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-3.5-3.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5.5 19a6.5 6.5 0 0113 0"/>',
  wrench: '<path d="M15.5 7.5a4 4 0 01-5 5l-5 5 2 2 5-5a4 4 0 005-5l-2 2-2-.5-.5-2 2-2z"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 9.5h16M8 3.5v4M16 3.5v4"/>',
  inbox: '<path d="M4 13l2.5-7h11L20 13M4 13v5h16v-5M4 13h5l1 2h4l1-2h5"/>',
};

function icon(name, size = 16, stroke = 1.8) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ''}</svg>`;
}

// ── App state ────────────────────────────────────────────────────────────────
let currentOrders = [];
let currentMeta   = null;    // scope/pagination pushed by FileMaker (read-only here)
let draggedId     = null;
let toastTimer    = null;
let searchTimer   = null;    // debounce for the JS→FM setQuery round-trip
let loadingCols   = new Set(); // columns with an in-flight loadMore (guards duplicate scroll fires)
let prevScopeSig  = null;      // detects scope changes so we only keep scroll pos on loadMore/drag re-renders

// ── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (import.meta.env.DEV) {
    initMockFileMaker();
    createDevControls();
  }

  buildSkeleton();

  window.receiveFromFileMaker = (data) => {
    const payload = typeof data === 'string' ? JSON.parse(data) : data;
    if (Array.isArray(payload.orders)) {
      currentOrders = payload.orders.map(normalizeOrder);
      currentMeta   = payload.meta || null;
      render();
    }
  };
});

// Derive presentation fields once per push so render code stays declarative.
function normalizeOrder(o) {
  return {
    ...o,
    priority: Number(o.rush) ? 'hitno' : 'normalno',
    price: Number(o.price) > 0 ? Number(o.price) : null,
    year: Number(o.year) > 0 ? Number(o.year) : null,
    timeStart: trimSeconds((o.timeStart || '').trim()),
    timeEnd: trimSeconds((o.timeEnd || '').trim()),
  };
}

// ── Static skeleton (built once so the search input keeps focus on re-push) ──
function buildSkeleton() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="strip">
      <div class="stat">
        <div class="stat-label">${icon('calendar', 13)} <span id="strip-period">—</span></div>
        <div class="stat-val" id="strip-label">—</div>
      </div>
      <div class="strip-chips" id="strip-chips"></div>
      <div class="strip-filter">
        <span class="strip-page" id="strip-page"></span>
        <div class="search" id="search-box">
          <span style="color:var(--ink-3);display:inline-flex">${icon('search', 16)}</span>
          <input id="search-input" placeholder="Traži nalog, kupca, vozilo…">
          <span class="clear" id="search-clear">${icon('x', 15)}</span>
        </div>
      </div>
    </div>
    <div class="board-scroll"><div class="board" id="board"></div></div>
    <div class="toast" id="toast"><span class="t-dot"></span><span id="toast-msg"></span></div>
  `;

  const input = document.getElementById('search-input');
  input.addEventListener('input', () => {
    document.getElementById('search-box').classList.toggle('has-text', !!input.value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setQuery(input.value), 300);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') clearSearch(); });
  document.getElementById('search-clear').addEventListener('click', clearSearch);
}

function clearSearch() {
  const input = document.getElementById('search-input');
  if (!input.value && !(currentMeta && currentMeta.query)) return;
  input.value = '';
  document.getElementById('search-box').classList.remove('has-text');
  clearTimeout(searchTimer);
  setQuery('');
}

function setQuery(q) {
  callFM('WV__KanbanControl', JSON.stringify({ action: 'setQuery', value: q }));
}

// ── Render (strip + board) ───────────────────────────────────────────────────
function render() {
  renderStrip(currentMeta);
  renderBoard();
}

function renderStrip(meta) {
  if (!meta) return;
  document.getElementById('strip-period').textContent = PERIOD_WORD[meta.periodMode] || 'Prikaz';
  // FM sends week labels as "Sedmica: 1–7. Juni 2026" — the period word already says it
  document.getElementById('strip-label').textContent = (meta.label || '—').replace(/^Sedmica:\s*/, '');

  const statuses = Array.isArray(meta.statuses) ? meta.statuses : [];
  document.getElementById('strip-chips').innerHTML = statuses.map(s =>
    `<span class="strip-chip" style="--st:${statusColor(s)}">${esc(s)}</span>`
  ).join('');

  // Board total across all columns (per-column paging lives in each column head).
  const cols = meta.columns || {};
  const totalAvail = Object.values(cols).reduce((n, c) => n + (Number(c.available) || 0), 0);
  document.getElementById('strip-page').textContent =
    totalAvail > 0 ? `${totalAvail} ${totalAvail === 1 ? 'nalog' : 'naloga'}` : '';

  // reflect FM-owned query state, but never clobber what the user is typing
  const input = document.getElementById('search-input');
  if (document.activeElement !== input) {
    input.value = meta.query || '';
    document.getElementById('search-box').classList.toggle('has-text', !!input.value);
  }
}

function renderBoard() {
  const byStatus = groupByStatus(currentOrders);
  const activeStatuses = (currentMeta && Array.isArray(currentMeta.statuses)) ? currentMeta.statuses : [];
  const cols = (currentMeta && currentMeta.columns) || {};
  const board = document.getElementById('board');

  // A scope change (period/nav/filter/query) resets every column to its first
  // page and should snap back to the top. Only a same-scope re-render (loadMore
  // or a drag-drop status move) preserves each column's scroll position — else
  // restoring an old bottom-of-column offset onto a freshly-shortened column
  // would re-trigger loadMore in a loop.
  const sig = currentMeta
    ? JSON.stringify([currentMeta.periodMode, currentMeta.anchorDate, currentMeta.statuses, currentMeta.query])
    : '';
  const sameScope = sig === prevScopeSig;
  prevScopeSig = sig;

  const scrollPos = {};
  if (sameScope) {
    board.querySelectorAll('.col-body').forEach(b => {
      const st = b.closest('[data-drop-zone]')?.dataset.dropZone;
      if (st) scrollPos[st] = b.scrollTop;
    });
  }

  board.innerHTML =
    STATUS_LIST.map(s => columnHTML(s, byStatus[s] || [], activeStatuses, cols[s])).join('');

  if (sameScope) {
    board.querySelectorAll('.col-body').forEach(b => {
      const st = b.closest('[data-drop-zone]')?.dataset.dropZone;
      if (st && scrollPos[st] != null) b.scrollTop = scrollPos[st];
    });
  }

  attachBoardHandlers();
  loadingCols.clear();       // fresh data arrived — any pending loadMore is satisfied
}

function groupByStatus(orders) {
  return orders.reduce((acc, o) => {
    (acc[o.status] = acc[o.status] || []).push(o);
    return acc;
  }, {});
}

function statusColor(s) { return (STATUS_META[s] || STATUS_META._default).color; }

function columnHTML(status, orders, activeStatuses, colMeta) {
  const dimmed = activeStatuses.length && !activeStatuses.includes(status) ? ' dimmed' : '';
  const sum = orders.reduce((acc, o) => acc + (o.price || 0), 0);

  // Per-column paging counts (fall back to what's rendered if meta is absent).
  const available = colMeta ? Number(colMeta.available) || 0 : orders.length;
  const loaded    = colMeta ? Number(colMeta.loaded)    || 0 : orders.length;
  const hasMore   = available > loaded;
  const countLabel = hasMore ? `${loaded} / ${available}` : `${available}`;

  const moreRow = hasMore
    ? `<div class="col-more" data-more="${esc(status)}"><span>Još ${available - loaded} naloga · skrolaj za još</span></div>`
    : '';

  return `
    <section class="col${dimmed}" data-drop-zone="${esc(status)}" style="--st:${statusColor(status)}">
      <div class="col-head">
        <span class="col-dot"></span>
        <span class="col-title">${esc(status)}</span>
        <span class="col-sum">${sum > 0 ? `${fmtKM(sum)} KM` : ''}</span>
        <span class="col-count${hasMore ? ' has-more' : ''}">${countLabel}</span>
      </div>
      <div class="col-body">
        ${orders.length
          ? orders.map(cardHTML).join('') + moreRow
          : `<div class="col-empty"><span class="ce-icon">${icon('inbox', 26, 1.5)}</span><span>Nema naloga</span></div>`}
      </div>
    </section>
  `;
}

function cardHTML(order) {
  const urgent = order.priority === 'hitno';
  const vehName = [order.make, order.model].filter(Boolean).join(' ');
  const rows = [];
  if (vehName || order.year) {
    rows.push(`<div class="sc-row sc-row-veh">
      <span class="sc-key" title="Vozilo">${icon('car', 15)}</span>
      <span class="sc-val">${esc(vehName || '—')}</span>
      ${order.year ? `<span class="sc-year">${order.year}</span>` : ''}
    </div>`);
  }
  if (order.customer) {
    rows.push(`<div class="sc-row">
      <span class="sc-key" title="Vlasnik">${icon('user', 14)}</span>
      <span class="sc-val">${esc(order.customer)}</span>
    </div>`);
  }
  if (order.service) {
    rows.push(`<div class="sc-row">
      <span class="sc-key" title="Usluga">${icon('wrench', 14)}</span>
      <span class="sc-val sc-usluga">${esc(order.service)}</span>
    </div>`);
  }

  return `
    <div class="card${urgent ? ' urgent' : ''}" draggable="true" data-id="${esc(order.id)}" data-status="${esc(order.status)}">
      <div class="sc-head">
        <span class="sc-nalog">#${esc(order.number || order.id)}</span>
        ${order.plate ? `<span class="plate"><span class="plate-eu"></span><span class="plate-num">${esc(order.plate)}</span></span>` : ''}
      </div>
      <div class="sc-body">${rows.join('')}</div>
      <div class="sc-foot">
        <span class="sc-foot-left">
          <span class="sc-foot-k">${icon('clock', 14)}</span>
          <span class="sc-time">${esc(formatTimeRange(order.timeStart, order.timeEnd) || '—')}</span>
        </span>
        <span class="sc-foot-right">
          ${order.price != null ? `<span class="sc-price">${fmtKM(order.price)} KM</span>` : ''}
          ${urgent ? '<span class="flag-hitno">Hitno</span>' : ''}
        </span>
      </div>
    </div>
  `;
}

// ── Card open — FM-native navigation (Navigation_ owns the sidebar/detail) ──
function openOrder(id) {
  callFM('Navigation_', `orders|${id}`);
}

// ── Status move (drag-drop) ─────────────────────────────────────────────────
function moveOrder(order, newStatus) {
  callFM('WV__UpdateSOStatus', JSON.stringify({ id: order.id, status: newStatus }));
  showToast(`Nalog #${order.number || order.id} → ${newStatus}`);
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// ── Formatting helpers ───────────────────────────────────────────────────────
function formatTimeRange(start, end) {
  if (start && end) return `${start} – ${end}`;
  if (start) return `od ${start}`;
  if (end) return `do ${end}`;
  return null;
}

// FileMaker SQL returns TIME fields as "HH:MM:SS" — show just "HH:MM".
function trimSeconds(t) {
  return /^\d{1,2}:\d{2}:\d{2}$/.test(t) ? t.slice(0, t.lastIndexOf(':')) : t;
}

function fmtKM(n) { return Number(n).toLocaleString('de-DE', { minimumFractionDigits: 0 }); }

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Drag-and-drop ────────────────────────────────────────────────────────────
function attachBoardHandlers() {
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('dragstart', onDragStart);
    card.addEventListener('dragend', onDragEnd);
    card.addEventListener('click', () => { if (!draggedId) openOrder(card.dataset.id); });
  });

  document.querySelectorAll('[data-drop-zone]').forEach(zone => {
    zone.addEventListener('dragover', onDragOver);
    zone.addEventListener('dragleave', onDragLeave);
    zone.addEventListener('drop', onDrop);
  });

  // Per-column infinite scroll: near the bottom → ask FM for one more page.
  document.querySelectorAll('.col-body').forEach(body => {
    body.addEventListener('scroll', onColScroll, { passive: true });
  });
}

function onColScroll(e) {
  const body = e.currentTarget;
  const status = body.closest('[data-drop-zone]')?.dataset.dropZone;
  if (!status || loadingCols.has(status)) return;

  const col = currentMeta && currentMeta.columns && currentMeta.columns[status];
  if (!col || col.loaded >= col.available) return;   // nothing more to load

  if (body.scrollHeight - body.scrollTop - body.clientHeight < 140) {
    loadingCols.add(status);
    const more = body.querySelector('.col-more span');
    if (more) more.textContent = 'Učitavanje…';
    loadMore(status);
  }
}

function loadMore(status) {
  callFM('WV__KanbanControl', JSON.stringify({ action: 'loadMore', value: status }));
}

function onDragStart(e) {
  draggedId = this.dataset.id;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragEnd() {
  this.classList.remove('dragging');
  document.querySelectorAll('.col').forEach(z => z.classList.remove('drop-target'));
  document.querySelectorAll('.col-empty').forEach(z => z.classList.remove('dragging-here'));
  // clear after pending click events so the drop's click doesn't open the drawer
  setTimeout(() => { draggedId = null; }, 0);
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  this.classList.add('drop-target');
  const empty = this.querySelector('.col-empty');
  if (empty) { empty.classList.add('dragging-here'); empty.querySelector('span:last-child').textContent = 'Pusti ovdje'; }
}

function onDragLeave(e) {
  if (!this.contains(e.relatedTarget)) {
    this.classList.remove('drop-target');
    const empty = this.querySelector('.col-empty');
    if (empty) { empty.classList.remove('dragging-here'); empty.querySelector('span:last-child').textContent = 'Nema naloga'; }
  }
}

function onDrop(e) {
  e.preventDefault();
  this.classList.remove('drop-target');
  const newStatus = this.dataset.dropZone;
  const order = currentOrders.find(o => o.id === draggedId);
  if (!order || order.status === newStatus) return;
  moveOrder(order, newStatus);
}

// ── FM bridge ────────────────────────────────────────────────────────────────
function callFM(scriptName, param) {
  if (typeof FileMaker !== 'undefined' && FileMaker.PerformScript) {
    FileMaker.PerformScript(scriptName, param);
  }
}
