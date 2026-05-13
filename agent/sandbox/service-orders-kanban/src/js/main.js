import '../styles/main.css';
import { initMockFileMaker } from './mock-filemaker.js';
import { createDevControls } from './dev-controls.js';

// ── Fixed column order ─────────────────────────────────────────────────────
const COLUMN_ORDER = ['U toku', 'Otvoren', 'Zakazan', 'Završen', 'Obračunat', 'Fakturisan', 'Naplaćen', 'Otkazan'];

// ── Status accent colours (MD3 tonal palette) ──────────────────────────────
const ACCENT = {
  'U toku':    '#1565c0',
  'Otvoren':   '#2e7d32',
  'Zakazan':   '#e65100',
  'Završen':   '#006064',
  'Obračunat': '#4527a0',
  'Fakturisan':'#283593',
  'Naplaćen':  '#2e7d32',
  'Otkazan':   '#b71c1c',
  _default:    '#37474f',
};

// ── App state ──────────────────────────────────────────────────────────────
let currentOrders = [];
let draggedId    = null;
let wasDragging  = false;   // prevents tap-click firing after a drag release

// ── Bootstrap ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (import.meta.env.DEV) {
    initMockFileMaker();
    createDevControls();
  }

  window.receiveFromFileMaker = (data) => {
    const payload = typeof data === 'string' ? JSON.parse(data) : data;
    if (Array.isArray(payload.orders)) {
      currentOrders = payload.orders;
      renderKanban();
    }
  };
});

// ── Column list ────────────────────────────────────────────────────────────
function buildColumnList() {
  return COLUMN_ORDER;
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderKanban() {
  const app = document.getElementById('app');
  if (!app) return;

  const columns = buildColumnList();
  const byStatus = groupByStatus(currentOrders);

  app.innerHTML = `
    <div class="kanban-board">
      ${columns.map(s => columnHTML(s, byStatus[s] || [])).join('')}
    </div>
  `;

  attachDragHandlers();
}

function groupByStatus(orders) {
  return orders.reduce((acc, o) => {
    (acc[o.status] = acc[o.status] || []).push(o);
    return acc;
  }, {});
}

function columnHTML(status, orders) {
  const accent = ACCENT[status] || ACCENT._default;
  return `
    <div class="column" data-drop-zone="${esc(status)}" style="--col-accent:${accent}">
      <div class="column-header">
        <div class="column-accent"></div>
        <span class="column-title">${esc(status)}</span>
        <span class="column-count">${orders.length}</span>
      </div>
      <div class="column-body">
        ${orders.length
          ? orders.map(o => cardHTML(o)).join('')
          : '<div class="empty-column">Nema naloga</div>'}
      </div>
    </div>
  `;
}

function cardHTML(order) {
  const rows = [];
  if (order.clientName)  rows.push(`<div class="card-client">${esc(order.clientName)}</div>`);
  if (order.vehicle)     rows.push(`<div class="card-vehicle">🚗 ${esc(order.vehicle)}</div>`);
  if (order.description) rows.push(`<div class="card-description">${esc(order.description)}</div>`);
  const timeStr = formatTimeRange(order.timeStart, order.timeEnd);
  if (timeStr) rows.push(`<div class="card-time">🕐 ${esc(timeStr)}</div>`);

  return `
    <div class="card-wrap">
      <div class="card" draggable="true" data-id="${esc(order.id)}" data-status="${esc(order.status)}">
        <div class="card-header">
          <span class="card-number">${esc(order.number || '')}</span>
          <span class="card-dot"></span>
        </div>
        ${rows.join('')}
      </div>
      <button class="card-open-btn" onclick="FileMaker.PerformScript('WV__OpenServiceOrder','${esc(order.id)}')">Otvori</button>
    </div>
  `;
}

function formatTimeRange(start, end) {
  const s = (start || '').trim();
  const e = (end || '').trim();
  if (s && e) return `${s} – ${e}`;
  if (s)      return `od ${s}`;
  if (e)      return `do ${e}`;
  return null;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Drag-and-drop ──────────────────────────────────────────────────────────
function attachDragHandlers() {
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('dragstart', onDragStart);
    card.addEventListener('dragend',   onDragEnd);
  });

  document.querySelectorAll('.card-open-btn').forEach(btn => {
    btn.addEventListener('click', onOpenBtnClick);
  });

  document.querySelectorAll('[data-drop-zone]').forEach(zone => {
    zone.addEventListener('dragover',  onDragOver);
    zone.addEventListener('dragleave', onDragLeave);
    zone.addEventListener('drop',      onDrop);
  });
}

function onDragStart(e) {
  draggedId = this.dataset.id;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragEnd() {
  this.classList.remove('dragging');
  draggedId   = null;
  wasDragging = true;
  document.querySelectorAll('.column').forEach(z => z.classList.remove('drag-over'));
  // clear flag after all pending mouse events have fired
  setTimeout(() => { wasDragging = false; }, 0);
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  this.classList.add('drag-over');
}

function onDragLeave(e) {
  if (!this.contains(e.relatedTarget)) {
    this.classList.remove('drag-over');
  }
}

function onDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over');

  const newStatus = this.dataset.dropZone;
  const order = currentOrders.find(o => o.id === draggedId);
  if (!order || order.status === newStatus) return;

  callFM('WV__UpdateSOStatus', JSON.stringify({ id: order.id, status: newStatus }));
}

function onOpenBtnClick() {
  FileMaker.PerformScript('WV__OpenServiceOrder', this.dataset.id);
}

// ── FM bridge ──────────────────────────────────────────────────────────────
function callFM(scriptName, param) {
  if (typeof FileMaker !== 'undefined' && FileMaker.PerformScript) {
    FileMaker.PerformScript(scriptName, param);
  }
}
