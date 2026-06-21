import '../styles/main.css';
import { initMockFileMaker } from './mock-filemaker.js';

const PAGE = 25;

const state = {
  search: '',
  client: { rows: [], total: 0, hasMore: false, pendingAppend: false, loading: false },
  vehicle: { rows: [], total: 0, hasMore: false, pendingAppend: false, loading: false },
  selectedClientId: null,
  selectedClient: null,
  selectedVehicleId: null,
  selectedVehicle: null,
  scope: 'all',            // 'owned' | 'all' — only meaningful once a client is selected
  editingVehicleId: null,  // vehicle row currently in inline-edit mode
  similarityMatches: [],   // current candidates surfaced in the add-vehicle form
};

/* ---------- FileMaker bridge ---------- */
function fm(script, paramObj) {
  const param = JSON.stringify(paramObj || {});
  if (typeof FileMaker !== 'undefined' && FileMaker.PerformScript) {
    FileMaker.PerformScript(script, param);
  } else {
    console.warn('FileMaker bridge unavailable:', script, param);
  }
}

// The native FileMaker object is injected into the web viewer slightly after
// the page loads (notably in card windows). Poll for it before the first call.
function whenFileMakerReady(cb, tries = 60) {
  if (typeof FileMaker !== 'undefined' && FileMaker.PerformScript) { cb(); return; }
  if (tries <= 0) { cb(); return; } // give up (standalone/dev) — call anyway
  setTimeout(() => whenFileMakerReady(cb, tries - 1), 50);
}

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);

function clearSearch() {
  state.search = '';
  const s = $('search');
  if (s) s.value = '';
  $('search-clear').classList.add('hidden');
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
function toast(msg, ok = true) {
  const t = $('toast');
  t.textContent = msg;
  t.className = `fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-md text-sm text-white shadow-lg z-50 ${ok ? 'bg-slate-800' : 'bg-red-600'}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
}

function clientName(c) {
  if (!c) return '—';
  return c.DisplayName_Display || [c.FirstName, c.LastName].filter(Boolean).join(' ') || c.CompanyName || '(bez imena)';
}
function vehicleName(v) {
  if (!v) return '—';
  const base = [v.Manufacturer, v.Model].filter(Boolean).join(' ');
  const plate = formatPlate(v.PlateNumber);
  return [base, plate ? `(${plate})` : ''].filter(Boolean).join(' ') || '(bez naziva)';
}

// Keep only valid VIN characters (uppercase alphanumerics); strip spaces/punctuation.
// This is what gets stored — applied before any save.
function sanitizeVin(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
// Display-only grouping: 3-3-5-6 (e.g. "WVW ZZZ 1KEP3 907895"). Never stored.
function formatVin(s) {
  const v = sanitizeVin(s);
  if (!v) return '';
  const groups = [];
  let i = 0;
  for (const n of [3, 3, 5, 6]) {
    if (i >= v.length) break;
    groups.push(v.slice(i, i + n));
    i += n;
  }
  if (i < v.length) groups.push(v.slice(i)); // anything beyond 17 chars
  return groups.join(' ');
}

// Plate is stored normalised (uppercase alphanumeric, no dashes/spaces) — A12-T-123 ≡ A12T123.
function sanitizePlate(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
// Display-only formatting back to dashes for known Bosnian patterns.
// Normal civilian: [AEMKOT]\d\d[AEMKOT]\d\d\d → "A12-T-123"
// Taxi:           TA\d{6}                    → "TA-123456"
// Anything else (foreign, army, CD, partial) → shown as stored.
function formatPlate(s) {
  const p = sanitizePlate(s);
  if (/^[AEMKOT]\d\d[AEMKOT]\d{3}$/.test(p)) return `${p.slice(0, 3)}-${p[3]}-${p.slice(4)}`;
  if (/^TA\d{6}$/.test(p)) return `TA-${p.slice(2)}`;
  return p;
}

/* ---------- queries ---------- */
function loadClients(append = false) {
  if (append && (state.client.loading || !state.client.hasMore)) return;
  state.client.loading = true;
  state.client.pendingAppend = append;
  if (append) showLoadingRow('client-list');
  fm('SearchClients', { offset: append ? state.client.rows.length : 0, limit: PAGE, search: state.search });
}
function loadVehicles(append = false) {
  if (append && (state.vehicle.loading || !state.vehicle.hasMore)) return;
  state.vehicle.loading = true;
  state.vehicle.pendingAppend = append;
  if (append) showLoadingRow('vehicle-list');
  fm('SearchVehicles', {
    offset: append ? state.vehicle.rows.length : 0,
    limit: PAGE,
    search: state.search,
    clientId: state.selectedClientId || '',
    scope: state.selectedClientId ? state.scope : 'all',
  });
}

function showLoadingRow(listId) {
  const list = $(listId);
  if (list && !list.querySelector('.picker-loading')) {
    list.insertAdjacentHTML('beforeend', '<div class="picker-loading text-center text-xs text-slate-400 py-2">Učitavanje…</div>');
  }
}

// Auto-load the next page when a list is scrolled near its bottom.
function onListScroll(pane, listId, loadFn) {
  const el = $(listId);
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) loadFn(true);
}

/* ---------- FM → JS callbacks ---------- */
window.receiveClientData = (payload) => {
  const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const rows = p.results || [];
  state.client.total = p.totalCount || 0;
  state.client.hasMore = !!p.hasMore;
  state.client.rows = state.client.pendingAppend ? state.client.rows.concat(rows) : rows;
  state.client.pendingAppend = false;
  state.client.loading = false;
  renderClients();
};

window.receiveVehicleData = (payload) => {
  const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const rows = p.results || [];
  state.vehicle.total = p.totalCount || 0;
  state.vehicle.hasMore = !!p.hasMore;
  state.vehicle.rows = state.vehicle.pendingAppend ? state.vehicle.rows.concat(rows) : rows;
  state.vehicle.pendingAppend = false;
  state.vehicle.loading = false;
  renderVehicles();
};

window.receiveClientSaved = (payload) => {
  const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (p.error) { toast(p.error, false); return; }
  hideClientForm();
  toast('Klijent sačuvan');
  if (p.client) selectClient(p.client);
  loadClients(false);
};

window.receiveVehicleSaved = (payload) => {
  const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (p.error) { toast(p.error, false); return; }
  hideVehicleForm();
  state.editingVehicleId = null;
  toast('Vozilo sačuvano');
  if (p.vehicle && p.vehicle.PrimaryKey) {
    state.selectedVehicleId = p.vehicle.PrimaryKey;
    state.selectedVehicle = p.vehicle;
  }
  loadVehicles(false);
  updateSelectionBar();
};

window.receiveVehicleSimilarity = (payload) => {
  const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (p.error) { toast(p.error, false); return; }
  state.similarityMatches = p.matches || [];
  renderSimilarityMatches();
};

window.receiveVehicleOwnerChanged = (payload) => {
  const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (p.error) { toast(p.error, false); return; }
  toast(p.clientId ? 'Vozilo povezano s klijentom' : 'Veza s klijentom uklonjena');
  loadVehicles(false);
};

// Optional initial state pushed from FileMaker (current ServiceOrder FKs).
window.receiveFromFileMaker = (payload) => {
  const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (p && p.client) selectClient(p.client);
  if (p && p.vehicle) { state.selectedVehicleId = p.vehicle.PrimaryKey; state.selectedVehicle = p.vehicle; }
  updateSelectionBar();
  loadClients(false);
  loadVehicles(false);
};

/* ---------- selection ---------- */
function selectClient(c) {
  const same = state.selectedClientId === c.PrimaryKey;
  state.selectedClientId = same ? null : c.PrimaryKey;
  state.selectedClient = same ? null : c;
  state.scope = state.selectedClientId ? 'owned' : 'all';
  // A search term is always aimed at one pane; once a client is picked, clear it
  // so the other pane (and the client's own vehicles) are visible unfiltered.
  clearSearch();
  updateScopeToggle();
  updateSelectionBar();
  loadClients(false);
  loadVehicles(false);
}

function selectVehicle(v) {
  const same = state.selectedVehicleId === v.PrimaryKey;
  state.selectedVehicleId = same ? null : v.PrimaryKey;
  state.selectedVehicle = same ? null : v;
  clearSearch();
  updateSelectionBar();
  loadClients(false);
  loadVehicles(false);
}

function updateSelectionBar() {
  $('sel-client').textContent = clientName(state.selectedClient);
  $('sel-vehicle').textContent = vehicleName(state.selectedVehicle);
  $('confirm').disabled = !state.selectedClientId && !state.selectedVehicleId;
}

function updateScopeToggle() {
  const wrap = $('scope-toggle');
  if (!state.selectedClientId) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  wrap.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.scope === state.scope;
    b.className = `px-2 py-1 ${on ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 text-slate-600'}`;
  });
}

/* ---------- rendering: clients ---------- */
function renderClients() {
  const list = $('client-list');
  $('client-count').textContent = state.client.total ? `(${state.client.total})` : '';
  if (!state.client.rows.length) {
    list.innerHTML = `<p class="text-xs text-slate-400 italic p-3">Nema rezultata.</p>`;
  } else {
    list.innerHTML = state.client.rows.map((c) => {
      const sel = c.PrimaryKey === state.selectedClientId;
      const type = (c.Type || '').includes('Pravno') ? 'Pravno' : 'Fizičko';
      const sub = [c.Phone, c.Email].filter(Boolean).join(' · ');
      const vc = Number(c.VehicleCount_Calculation || 0);
      return `
        <div data-client="${esc(c.PrimaryKey)}"
          class="client-row cursor-pointer rounded-md border px-3 py-2 ${sel ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:bg-slate-50'}">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium truncate">${esc(clientName(c))}</span>
            <span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded ${type === 'Pravno' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}">${type}</span>
          </div>
          <div class="flex items-center justify-between gap-2 mt-0.5">
            <span class="text-xs text-slate-400 truncate">${esc(sub) || '—'}</span>
            <span class="shrink-0 text-[10px] text-slate-400">${vc} vozila</span>
          </div>
        </div>`;
    }).join('');
  }
}

/* ---------- rendering: vehicles ---------- */
function vehicleRowDisplay(v) {
  const sel = v.PrimaryKey === state.selectedVehicleId;
  const owned = state.selectedClientId && v.ForeignKeyClient === state.selectedClientId;
  const ownedByOther = state.selectedClientId && v.ForeignKeyClient && v.ForeignKeyClient !== state.selectedClientId;
  const title = [v.Manufacturer, v.Model].filter(Boolean).join(' ') || '(bez naziva)';
  const meta = [v.YearManufactured, formatPlate(v.PlateNumber), formatVin(v.VIN)].filter(Boolean).join(' · ');

  let assocBtn = '';
  if (state.selectedClientId) {
    if (owned) {
      assocBtn = `<button data-assoc="off" data-vehicle="${esc(v.PrimaryKey)}" class="text-[10px] px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50">Ukloni vezu</button>`;
    } else {
      assocBtn = `<button data-assoc="on" data-vehicle="${esc(v.PrimaryKey)}" class="text-[10px] px-2 py-1 rounded border border-blue-200 text-blue-600 hover:bg-blue-50">Poveži</button>`;
    }
  }

  return `
    <div data-vehicle="${esc(v.PrimaryKey)}"
      class="vehicle-row rounded-md border px-3 py-2 ${sel ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:bg-slate-50'}">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0 cursor-pointer vehicle-pick" data-vehicle="${esc(v.PrimaryKey)}">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium truncate">${esc(title)}</span>
            ${owned ? '<span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">vlasnik</span>' : ''}
            ${ownedByOther ? '<span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400">drugi vlasnik</span>' : ''}
          </div>
          <div class="text-xs text-slate-400 truncate mt-0.5">${esc(meta) || '—'}</div>
        </div>
        <div class="shrink-0 flex items-center gap-1">
          ${assocBtn}
          <button data-edit="${esc(v.PrimaryKey)}" class="text-[10px] px-2 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-100">Uredi</button>
        </div>
      </div>
    </div>`;
}

function vehicleRowEdit(v) {
  const f = (name, val, ph) =>
    `<input data-f="${name}" value="${esc(val)}" placeholder="${ph}" class="w-full px-2 py-1 rounded border border-slate-300 text-xs">`;
  return `
    <div class="rounded-md border border-blue-300 bg-blue-50/40 px-3 py-2" data-editrow="${esc(v.PrimaryKey)}">
      <div class="grid grid-cols-2 gap-2">
        ${f('manufacturer', v.Manufacturer, 'Proizvođač')}
        ${f('model', v.Model, 'Model')}
        ${f('year', v.YearManufactured, 'Godina')}
        ${f('plate', v.PlateNumber, 'Tablica')}
      </div>
      <div class="mt-2">${f('vin', v.VIN, 'VIN')}</div>
      <div class="mt-2 flex justify-end gap-2">
        <button data-edit-cancel class="text-xs px-3 py-1 rounded border border-slate-300 text-slate-600 hover:bg-white">Otkaži</button>
        <button data-edit-save="${esc(v.PrimaryKey)}" class="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">Sačuvaj</button>
      </div>
    </div>`;
}

function renderVehicles() {
  const list = $('vehicle-list');
  $('vehicle-count').textContent = state.vehicle.total ? `(${state.vehicle.total})` : '';
  if (!state.vehicle.rows.length) {
    list.innerHTML = `<p class="text-xs text-slate-400 italic p-3">Nema rezultata.</p>`;
  } else {
    list.innerHTML = state.vehicle.rows.map((v) =>
      v.PrimaryKey === state.editingVehicleId ? vehicleRowEdit(v) : vehicleRowDisplay(v)).join('');
  }
}

/* ---------- add-client form ---------- */
function showClientForm() {
  const box = $('client-form');
  box.dataset.type = 'Fizičko lice';
  box.classList.remove('hidden');
  renderClientForm();
}
function hideClientForm() { $('client-form').classList.add('hidden'); }

function renderClientForm() {
  const box = $('client-form');
  const type = box.dataset.type || 'Fizičko lice';
  const isLegal = type === 'Pravno lice';
  const fld = (name, ph) => `<input data-cf="${name}" placeholder="${ph}" class="w-full px-2 py-1 rounded border border-slate-300 text-xs">`;
  const tab = (val, label) =>
    `<button data-ctype="${val}" class="px-3 py-1 text-xs ${type === val ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}">${label}</button>`;
  box.innerHTML = `
    <div class="inline-flex rounded-md border border-slate-200 overflow-hidden mb-2">
      ${tab('Fizičko lice', 'Fizičko lice')}${tab('Pravno lice', 'Pravno lice')}
    </div>
    <div class="grid grid-cols-2 gap-2">
      ${isLegal
        ? `${fld('companyName', 'Naziv firme')}${fld('idBroj', 'ID broj')}${fld('pdvBroj', 'PDV broj')}`
        : `${fld('firstName', 'Ime')}${fld('lastName', 'Prezime')}`}
      ${fld('phone', 'Telefon')}
      ${fld('email', 'Email')}
    </div>
    <div class="grid grid-cols-2 gap-2 mt-2">
      ${fld('street', 'Ulica')}${fld('city', 'Grad')}
    </div>
    <div class="mt-2 flex justify-end gap-2">
      <button data-cf-cancel class="text-xs px-3 py-1 rounded border border-slate-300 text-slate-600 hover:bg-white">Otkaži</button>
      <button data-cf-save class="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">Sačuvaj klijenta</button>
    </div>`;
}

function saveClientForm() {
  const box = $('client-form');
  const type = box.dataset.type || 'Fizičko lice';
  const get = (n) => { const el = box.querySelector(`[data-cf="${n}"]`); return el ? el.value.trim() : ''; };
  const payload = {
    type,
    firstName: get('firstName'), lastName: get('lastName'),
    companyName: get('companyName'), idBroj: get('idBroj'), pdvBroj: get('pdvBroj'),
    phone: get('phone'), email: get('email'), street: get('street'), city: get('city'),
  };
  if (type === 'Pravno lice' ? !payload.companyName : !(payload.firstName || payload.lastName)) {
    toast('Unesite ime klijenta', false); return;
  }
  fm('PICKER__SaveClient', payload);
}

/* ---------- add-vehicle form ---------- */
function showVehicleForm() {
  $('vehicle-form').classList.remove('hidden');
  state.similarityMatches = [];
  const f = (name, ph) => `<input data-vf="${name}" placeholder="${ph}" class="w-full px-2 py-1 rounded border border-slate-300 text-xs">`;
  const assoc = state.selectedClientId
    ? `<label class="flex items-center gap-1.5 text-xs text-slate-600 mt-2"><input type="checkbox" data-vf="associate" checked> Poveži s: ${esc(clientName(state.selectedClient))}</label>`
    : '';
  $('vehicle-form').innerHTML = `
    <div class="grid grid-cols-2 gap-2">
      ${f('manufacturer', 'Proizvođač')}${f('model', 'Model')}
      ${f('year', 'Godina')}${f('plate', 'Tablica')}
    </div>
    <div class="mt-2">${f('vin', 'VIN')}</div>
    ${assoc}
    <div class="mt-2 flex justify-end gap-2">
      <button data-vf-cancel class="text-xs px-3 py-1 rounded border border-slate-300 text-slate-600 hover:bg-white">Otkaži</button>
      <button data-vf-save class="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">Sačuvaj vozilo</button>
    </div>
    <div id="vehicle-form-matches" class="mt-3"></div>`;
}
function hideVehicleForm() {
  $('vehicle-form').classList.add('hidden');
  state.similarityMatches = [];
}

// Look up existing vehicles whose plate or VIN partially matches what the user
// is typing into the add-vehicle form — surfaces likely duplicates before save.
let _simTimer;
function checkVehicleSimilarity() {
  clearTimeout(_simTimer);
  _simTimer = setTimeout(() => {
    const box = $('vehicle-form');
    if (!box || box.classList.contains('hidden')) return;
    // Similarity is a prefix LIKE — pass the input lightly normalised (uppercase + trim)
    // so dashes/spaces survive ("du 1354" → "DU 1354%"). The save path still sanitises strictly.
    const plate = (box.querySelector('[data-vf="plate"]')?.value || '').trim().toUpperCase();
    const vin = (box.querySelector('[data-vf="vin"]')?.value || '').trim().toUpperCase();
    if (plate.length < 3 && vin.length < 4) {
      state.similarityMatches = [];
      renderSimilarityMatches();
      return;
    }
    fm('PICKER__VehicleSimilarity', { plate, vin });
  }, 300);
}

function renderSimilarityMatches() {
  const box = $('vehicle-form-matches');
  if (!box) return;
  const matches = state.similarityMatches;
  if (!matches.length) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="text-xs font-semibold text-amber-700 mb-1 border-t border-amber-200 pt-2">
      Slično postojeće vozilo? Kliknite da odaberete:
    </div>
    <div class="space-y-1">
      ${matches.map((m) => {
        const plate = formatPlate(m.PlateNumber);
        const title = [m.Manufacturer, m.Model].filter(Boolean).join(' ');
        return `
          <button data-sim="${esc(m.PrimaryKey)}"
            class="w-full text-left px-2 py-1.5 rounded border border-amber-200 bg-amber-50 hover:bg-amber-100 text-xs">
            <div class="flex items-center gap-2">
              <span class="font-medium">${esc(plate) || '—'}</span>
              <span class="text-slate-700">${esc(title)}</span>
              ${m.YearManufactured ? `<span class="text-slate-400">${esc(m.YearManufactured)}</span>` : ''}
            </div>
            <div class="text-slate-500 mt-0.5 truncate">
              ${m.ClientName ? esc(m.ClientName) : '<i>bez vlasnika</i>'}
              ${m.VIN ? ` · <span class="text-slate-400">${esc(formatVin(m.VIN))}</span>` : ''}
            </div>
          </button>`;
      }).join('')}
    </div>`;
}

function saveVehicleForm() {
  const box = $('vehicle-form');
  const get = (n) => { const el = box.querySelector(`[data-vf="${n}"]`); return el ? el.value.trim() : ''; };
  const associate = box.querySelector('[data-vf="associate"]')?.checked;
  const payload = {
    mode: 'create',
    manufacturer: get('manufacturer'), model: get('model'),
    year: get('year'), vin: sanitizeVin(get('vin')), plate: sanitizePlate(get('plate')),
    clientId: associate ? state.selectedClientId : '',
  };
  if (!payload.manufacturer && !payload.model && !payload.plate) {
    toast('Unesite barem marku ili tablicu', false); return;
  }
  fm('PICKER__SaveVehicle', payload);
}

function saveVehicleEdit(vehicleId) {
  const row = document.querySelector(`[data-editrow="${CSS.escape(vehicleId)}"]`);
  if (!row) return;
  const get = (n) => { const el = row.querySelector(`[data-f="${n}"]`); return el ? el.value.trim() : ''; };
  fm('PICKER__SaveVehicle', {
    mode: 'update', vehicleId,
    manufacturer: get('manufacturer'), model: get('model'),
    year: get('year'), vin: sanitizeVin(get('vin')), plate: sanitizePlate(get('plate')),
  });
}

/* ---------- associate / dissociate ---------- */
function setOwner(vehicleId, on) {
  const v = state.vehicle.rows.find((x) => x.PrimaryKey === vehicleId);
  if (on && v && v.ForeignKeyClient && v.ForeignKeyClient !== state.selectedClientId) {
    if (!confirm(`Ovo vozilo već pripada drugom klijentu. Prebaciti ga na "${clientName(state.selectedClient)}"?`)) return;
  }
  fm('PICKER__SetVehicleOwner', { vehicleId, clientId: on ? state.selectedClientId : '' });
}

/* ---------- events ---------- */
function wire() {
  let dq;
  $('search').addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    $('search-clear').classList.toggle('hidden', !state.search);
    clearTimeout(dq);
    dq = setTimeout(() => { loadClients(false); loadVehicles(false); }, 250);
  });
  $('search-clear').addEventListener('click', () => {
    $('search').value = ''; state.search = '';
    $('search-clear').classList.add('hidden');
    loadClients(false); loadVehicles(false);
  });

  $('client-list').addEventListener('scroll', () => onListScroll('client', 'client-list', loadClients));
  $('vehicle-list').addEventListener('scroll', () => onListScroll('vehicle', 'vehicle-list', loadVehicles));

  $('add-client-btn').addEventListener('click', showClientForm);
  $('add-vehicle-btn').addEventListener('click', showVehicleForm);

  $('confirm').addEventListener('click', () => {
    fm('PICKER__CommitClientVehicle', {
      clientId: state.selectedClientId || '',
      vehicleId: state.selectedVehicleId || '',
    });
  });
  $('cancel').addEventListener('click', () => fm('PICKER__CommitClientVehicle', { cancel: true }));

  $('scope-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scope]'); if (!b) return;
    state.scope = b.dataset.scope; updateScopeToggle(); loadVehicles(false);
  });

  // Client list (delegated)
  $('client-list').addEventListener('click', (e) => {
    const row = e.target.closest('[data-client]'); if (!row) return;
    const c = state.client.rows.find((x) => x.PrimaryKey === row.dataset.client);
    if (c) selectClient(c);
  });

  // Client form (delegated)
  $('client-form').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-ctype]');
    if (tab) { $('client-form').dataset.type = tab.dataset.ctype; renderClientForm(); return; }
    if (e.target.closest('[data-cf-cancel]')) { hideClientForm(); return; }
    if (e.target.closest('[data-cf-save]')) { saveClientForm(); return; }
  });

  // Vehicle list (delegated)
  $('vehicle-list').addEventListener('click', (e) => {
    const assoc = e.target.closest('[data-assoc]');
    if (assoc) { setOwner(assoc.dataset.vehicle, assoc.dataset.assoc === 'on'); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) { state.editingVehicleId = edit.dataset.edit; renderVehicles(); return; }
    if (e.target.closest('[data-edit-cancel]')) { state.editingVehicleId = null; renderVehicles(); return; }
    const save = e.target.closest('[data-edit-save]');
    if (save) { saveVehicleEdit(save.dataset.editSave); return; }
    const pick = e.target.closest('.vehicle-pick');
    if (pick) { const v = state.vehicle.rows.find((x) => x.PrimaryKey === pick.dataset.vehicle); if (v) selectVehicle(v); }
  });

  // Vehicle form (delegated)
  $('vehicle-form').addEventListener('click', (e) => {
    if (e.target.closest('[data-vf-cancel]')) { hideVehicleForm(); return; }
    if (e.target.closest('[data-vf-save]')) { saveVehicleForm(); return; }
    const sim = e.target.closest('[data-sim]');
    if (sim) {
      const m = state.similarityMatches.find((x) => x.PrimaryKey === sim.dataset.sim);
      if (m) { hideVehicleForm(); selectVehicle(m); }
    }
  });
  $('vehicle-form').addEventListener('input', (e) => {
    const t = e.target;
    if (t && (t.dataset.vf === 'plate' || t.dataset.vf === 'vin')) checkVehicleSimilarity();
  });
}

/* ---------- boot ---------- */
document.addEventListener('DOMContentLoaded', () => {
  if (import.meta.env.DEV) initMockFileMaker();
  wire();
  updateSelectionBar();
  whenFileMakerReady(() => { loadClients(false); loadVehicles(false); });
});
