import '../styles/main.css';
import { initMockFileMaker } from './mock-filemaker.js';
import { createDevControls } from './dev-controls.js';
import mockData from './mock-data.json';

// ── State ──────────────────────────────────────────────────────────────────
let _data  = null;
let _scope = 'day';
let _modal = null;      // { kind, status: 'loading'|'ready'|'error', rows, error }
let _savingIds = new Set();      // rows currently being updated (missingCost modal)
let _expandedKeys = new Set();   // expanded service-summary rows

// ── Bootstrap ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (import.meta.env.DEV) {
    initMockFileMaker();
    createDevControls();
    setTimeout(() => window.receiveFromFileMaker(mockData), 100);
  }

  window.receiveFromFileMaker = (data) => {
    const payload = typeof data === 'string' ? JSON.parse(data) : data;
    _data = payload;
    if (payload.scope && payload.grandTotal !== undefined) _scope = payload.scope;
    render();
  };

  // FM pushes modal payloads here. Shape: { modal, rows, error?, generatedAt? }
  window.receiveModalData = (data) => {
    const payload = typeof data === 'string' ? JSON.parse(data) : data;
    if (!_modal || _modal.kind !== payload.modal) return;  // stale push, ignore
    if (payload.error) {
      _modal = { kind: payload.modal, status: 'error', error: payload.error };
    } else {
      _modal = { kind: payload.modal, status: 'ready', rows: payload.rows || [] };
      _savingIds.clear();
    }
    renderModal();
  };
});

window.setScope = (scope) => {
  _scope = scope;
  if (_data) render();
};

// ── Formatters ─────────────────────────────────────────────────────────────
function km(n, dec = 2) {
  return (Number(n) || 0).toLocaleString('de-DE', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }) + ' KM';
}

function num(n, dec = 0) {
  return (Number(n) || 0).toLocaleString('de-DE', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function formatPct(value) {
  const pct = Number.isFinite(value) ? value / 100 : 0;
  return new Intl.NumberFormat('de-DE', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
    .format(pct)
    .replace(/\s?%$/, '%');
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(s) {
  if (!s) return '';
  // FM dates arrive as MM/DD/YYYY or YYYY-MM-DD — normalise to DD.MM.YYYY
  const m = String(s).match(/^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})$/);
  if (!m) return esc(s);
  let dd, mm, yyyy;
  if (m[1].length === 4) { yyyy = m[1]; mm = m[2]; dd = m[3]; }
  else                   { mm = m[1]; dd = m[2]; yyyy = m[3]; }
  return `${dd.padStart(2,'0')}.${mm.padStart(2,'0')}.${yyyy}`;
}

// ── FM bridge ──────────────────────────────────────────────────────────────
function callFM(scriptName, parameter) {
  const param = typeof parameter === 'string' ? parameter : JSON.stringify(parameter);
  if (window.FileMaker && typeof window.FileMaker.PerformScript === 'function') {
    window.FileMaker.PerformScript(scriptName, param);
  } else {
    console.warn('[FM] FileMaker.PerformScript not available', scriptName, param);
  }
}

// ── Modal open/close ───────────────────────────────────────────────────────
window.openModal = (kind) => {
  _modal = { kind, status: 'loading' };
  renderModal();
  callFM('WV__SalesDashboardModal', { modal: kind, scope: _scope });
};

window.closeModal = () => {
  _modal = null;
  _savingIds.clear();
  _expandedKeys.clear();
  renderModal();
};

window.saveStavkaCost = (id, value) => {
  const numVal = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(numVal) || numVal <= 0) return;
  _savingIds.add(id);
  renderModal();
  callFM('WV__UpdateStavkaPrimkeNabavna', { id, value: numVal, scope: _scope });
};

window.toggleServiceRow = (key) => {
  if (_expandedKeys.has(key)) _expandedKeys.delete(key);
  else                        _expandedKeys.add(key);
  renderModal();
};

window.openServiceOrder = (soId, event) => {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  if (!soId) return;
  callFM('WV__OpenServiceOrderCard', soId);
};

function soLink(soId, soNumber) {
  if (!soId) return esc(soNumber);
  return `<a href="#" class="so-link" onclick="openServiceOrder('${esc(soId).replace(/'/g, "\\'")}', event)">${esc(soNumber)} <span class="so-arrow">↗</span></a>`;
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  if (!app) return;

  if (!_data) {
    app.innerHTML = '<div class="loading">Čeka se osvježavanje…</div>';
    return;
  }

  const d = (_data.grandTotal !== undefined) ? _data : _data[_scope];
  if (!d) {
    app.innerHTML = '<div class="loading">Nema podataka za ovaj period.</div>';
    return;
  }

  if (d.error) {
    app.innerHTML = `
      <div class="grid grid-cols-3" style="gap:0.75rem;">
        <div class="col-span-3 rounded-xl border border-rose-400 bg-rose-500/10 text-rose-200 text-sm" style="padding:1rem;">
          SQL greška: ${esc(d.error)}
        </div>
      </div>
      <div class="text-[10px] text-slate-500 text-right" style="padding-bottom:0.25rem;">${_data.generatedAt ? 'Osvježeno: ' + esc(_data.generatedAt) : ''}</div>
    `;
    return;
  }

  const grandTotal       = Number(d.grandTotal)       || 0;
  const robaRevenue      = Number(d.robaRevenue)      || 0;
  const uslugaRevenue    = Number(d.uslugaRevenue)    || 0;
  const profitKnown      = Number(d.profitKnown)      || 0;
  const missingCostRev   = Number(d.missingCostRev)   || 0;
  const missingCostCount = Number(d.missingCostCount) || 0;
  const returnCount      = Number(d.returnCount)      || 0;
  const returnQty        = Number(d.returnQty)        || 0;

  const profitEstimated = missingCostRev * 0.30;
  const profitTotal     = profitKnown + profitEstimated;
  const robaCostBase    = robaRevenue - missingCostRev;
  const robaSharePct    = grandTotal > 0 ? (robaRevenue / grandTotal * 100) : 0;
  const marginTotal     = robaRevenue  > 0 ? (profitTotal  / robaRevenue  * 100) : 0;
  const marginKnown     = robaCostBase > 0 ? (profitKnown  / robaCostBase * 100) : 0;

  let profitBreakdown = '';
  if (missingCostCount > 0) {
    profitBreakdown = `
        <div style="margin-top:0.75rem; border-top:1px solid #334155; padding-top:0.75rem;">
        <div class="flex items-baseline justify-between text-[11px]" style="gap:0.5rem; margin-bottom:0.5rem;">
          <span class="text-slate-400 flex-1 min-w-0">Poznata nabavna</span>
          <span class="text-emerald-400 font-semibold">${km(profitKnown)} (${marginKnown.toFixed(1)}%)</span>
        </div>
        <div class="flex items-baseline justify-between text-[11px]" style="gap:0.5rem; margin-bottom:0.5rem;">
          <span class="text-slate-400 flex-1 min-w-0">Procijenjena 30%<span class="ml-1 inline-block rounded-sm border border-amber-400/30 bg-amber-400/10 px-1 text-[9px] text-amber-400">~</span></span>
          <span class="text-amber-400 font-semibold">${km(profitEstimated)}</span>
        </div>
        <div class="flex items-baseline justify-between text-[11px] text-slate-500" style="gap:0.5rem;">
          <span class="flex-1 min-w-0">${missingCostCount} stavki bez nabavne</span>
        </div>
      </div>`;
  }

  const robaClass = 'border-cyan-600 bg-cyan-500/10 text-slate-100';
  const uslugaClass = 'border-slate-700 bg-slate-950/80 text-slate-100';
  const returnClass = returnCount > 0 ? 'border-rose-400 bg-rose-500/10 text-slate-100' : 'border-slate-700 bg-slate-950/80 text-slate-100';
  const noCostClass = missingCostCount > 0 ? 'border-amber-400/30 bg-amber-400/10 text-amber-400' : 'border-slate-700 bg-slate-950/80 text-slate-100';
  const moreButtonClass = 'border-blue-400 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20';
  const robaShareLabel = formatPct(robaSharePct);
  const uslugaShareLabel = formatPct(100 - robaSharePct);

  app.innerHTML = `
    <div class="grid grid-cols-3" style="gap:0.75rem;">

      <div class="col-span-3 rounded-xl border border-slate-700 bg-slate-950/80 shadow-sm" style="padding:1rem;">
        <div class="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400" style="margin-bottom:0.5rem;">Ukupno promet</div>
        <div class="text-3xl font-bold text-slate-100">${km(grandTotal)}</div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-teal-700" style="margin-top:1rem;">
          <div class="h-full bg-blue-500 transition-all duration-300" style="width:${robaSharePct.toFixed(1)}%"></div>
          <div class="h-full bg-teal-500 transition-all duration-300" style="width:${(100 - robaSharePct).toFixed(1)}%"></div>
        </div>
        <div class="flex items-center justify-between text-[11px] text-slate-400" style="margin-top:0.75rem; gap:0.75rem;">
          <span>Roba ${km(robaRevenue)} (${robaShareLabel})</span>
          <span>Usluge ${km(uslugaRevenue)} (${uslugaShareLabel})</span>
        </div>
      </div>

      <div class="col-span-2 rounded-xl border shadow-sm ${robaClass}" style="padding:1rem;">
        <div class="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400" style="margin-bottom:0.5rem;">Roba</div>
        <div class="text-xl font-bold"><span class="text-slate-400 text-sm">Ukupan promet</span><br />${km(robaRevenue)}</div>
        <div class="text-2xl font-bold"><span class="text-slate-400 text-sm">Ukupan profit</span><br />${km(profitTotal)}</div>
        <div class="text-[11px] text-slate-200" style="margin-top:0.5rem;">${marginTotal.toFixed(1)}% od prometa robe ${missingCostCount > 0 ? ' (procjena)' : ''}</div>
        ${profitBreakdown}
        <button class="${moreButtonClass}" style="margin-top:0.75rem;" onclick="openModal('goods')">Pogledaj svu robu</button>
        <div class="flex items-baseline justify-between" style="gap:0.5rem; margin-top:0.75rem;">
          <div class="flex-1 rounded-xl border shadow-sm ${returnClass}" style="padding:1rem">
            <div class="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400" style="margin-bottom:0.5rem;">Povrati</div>
            <div class="text-2xl font-bold">${num(returnCount)}</div>
            <div class="text-[11px] text-slate-400" style="margin-top:0.5rem;">${returnQty > 0 ? num(returnQty) + ' kom vraćeno' : 'bez povrata'}</div>
            <button class="${moreButtonClass}" onclick="openModal('returns')">Pogledaj povrate</button>
          </div>
          <div class="flex-1 rounded-xl border shadow-sm ${noCostClass}" style="padding:1rem">
            <div class="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400" style="margin-bottom:0.5rem;">Bez nabavne cijene</div>
            <div class="text-2xl font-bold">${num(missingCostCount)}</div>
            <div class="text-[11px] text-slate-400" style="margin-top:0.5rem;"> Projena dobiti: ${km(missingCostRev)} </div>
            <button class="${moreButtonClass}" onclick="openModal('missingCost')">Unesi nabavnu cijenu</button>
          </div>
        </div>
      </div>

      <div class="col-span-1 rounded-xl border shadow-sm ${uslugaClass}" style="padding:1rem;">
        <div class="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400" style="margin-bottom:0.5rem;">Usluge</div>
        <div class="text-xl font-bold"><span class="text-slate-400 text-sm">Ukupan promet</span><br />${km(uslugaRevenue)}</div>
        <button class="${moreButtonClass}" style="margin-top:1rem;" onclick="openModal('services')">Pogledaj usluge</button>
      </div>

    </div>
    <div class="text-[10px] text-slate-500 text-right" style="padding-bottom:0.25rem;">${_data.generatedAt ? 'Osvježeno: ' + esc(_data.generatedAt) : ''}</div>
    <div id="modal-root"></div>
  `;

  if (import.meta.env.DEV) injectDevTabs();
  renderModal();
}

// ── Modal render ───────────────────────────────────────────────────────────
function renderModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  if (!_modal) { root.innerHTML = ''; return; }

  const titles = {
    returns:     'Povrati u periodu',
    missingCost: 'Stavke bez nabavne cijene',
    services:    'Sumarizacija usluga',
    goods:       'Sva roba u periodu',
  };
  const title = titles[_modal.kind] || 'Detalji';

  let body = '';
  if (_modal.status === 'loading') {
    body = `<div class="loading" style="padding:32px;">Učitavanje…</div>`;
  } else if (_modal.status === 'error') {
    body = `<div class="rounded-xl border border-rose-400 bg-rose-500/10 text-rose-200 text-sm" style="padding:1rem;">SQL greška: ${esc(_modal.error)}</div>`;
  } else if (_modal.kind === 'returns') {
    body = renderReturnsTable(_modal.rows);
  } else if (_modal.kind === 'missingCost') {
    body = renderMissingCostTable(_modal.rows);
  } else if (_modal.kind === 'services') {
    body = renderServicesTable(_modal.rows);
  } else if (_modal.kind === 'goods') {
    body = renderGoodsTable(_modal.rows);
  }

  root.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal-window">
        <div class="modal-header">
          <div class="modal-title">${esc(title)}</div>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">${body}</div>
      </div>
    </div>
  `;
}

function renderReturnsTable(rows) {
  if (!rows || rows.length === 0) {
    return `<div class="loading">Nema povrata u ovom periodu.</div>`;
  }
  const totalQty = rows.reduce((s, r) => s + (Number(r.kolicina) || 0), 0);
  const totalValue = rows.reduce((s, r) => s + (Number(r.kolicina) || 0) * (Number(r.rate) || 0), 0);

  const rowsHtml = rows.map(r => `
    <tr>
      <td>${formatDate(r.jobDate)}</td>
      <td>${soLink(r.serviceOrderId, r.serviceOrderNumber)}</td>
      <td>${esc(r.description)}</td>
      <td class="num">${num(r.kolicina, 2)}</td>
      <td class="num">${km(r.rate)}</td>
      <td class="num">${km((Number(r.kolicina) || 0) * (Number(r.rate) || 0))}</td>
    </tr>
  `).join('');

  return `
    <table class="modal-table">
      <thead><tr>
        <th>Datum</th><th>Nalog</th><th>Opis</th>
        <th class="num">Kol.</th><th class="num">Cijena</th><th class="num">Vrijednost</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr>
        <td colspan="3">Ukupno (${rows.length})</td>
        <td class="num">${num(totalQty, 2)}</td>
        <td></td>
        <td class="num">${km(totalValue)}</td>
      </tr></tfoot>
    </table>
  `;
}

function renderMissingCostTable(rows) {
  if (!rows || rows.length === 0) {
    return `<div class="loading">Sve stavke u periodu imaju nabavnu cijenu. 🎉</div>`;
  }
  const rowsHtml = rows.map(r => {
    const saving = _savingIds.has(r.id);
    return `
      <tr ${saving ? 'class="saving"' : ''}>
        <td>${formatDate(r.datumPrimitka)}</td>
        <td>${esc(r.brojFakture)}</td>
        <td>${esc(r.sifraArtikla)}</td>
        <td>${esc(r.nazivArtikla)}</td>
        <td class="num">${num(r.kolicina, 2)} ${esc(r.jm || '')}</td>
        <td class="num">${km(r.prodajnaCijena)}</td>
        <td class="num">
          <input type="text" inputmode="decimal" class="cost-input"
                 data-id="${esc(r.id)}"
                 ${saving ? 'disabled' : ''}
                 onkeydown="if(event.key==='Enter'){this.blur();}"
                 oninput="this.value=this.value.replace(/[^0-9.,]/g,'')"
                 onblur="if(this.value)saveStavkaCost('${esc(r.id)}', this.value)"
                 placeholder="${saving ? 'Sprema…' : '0,00'}" />
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="modal-hint">Unesi nabavnu cijenu i izađi iz polja (Tab ili Enter) — sprema se automatski.</div>
    <table class="modal-table">
      <thead><tr>
        <th>Datum</th><th>Faktura</th><th>Šifra</th><th>Naziv</th>
        <th class="num">Kol.</th><th class="num">Prodajna</th><th class="num">Nabavna</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

function renderServicesTable(rows) {
  if (!rows || rows.length === 0) {
    return `<div class="loading">Nema usluga u ovom periodu.</div>`;
  }
  const sorted = [...rows].sort((a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0));
  const grand = sorted.reduce((s, r) => s + (Number(r.revenue) || 0), 0);

  const rowsHtml = sorted.map(r => {
    const key = String(r.key ?? r.description);
    const rev = Number(r.revenue) || 0;
    const pct = grand > 0 ? (rev / grand * 100) : 0;
    const expanded = _expandedKeys.has(key);
    const lines = Array.isArray(r.lines) ? r.lines : [];

    const summary = `
      <tr class="expandable" onclick="toggleServiceRow('${esc(key).replace(/'/g, "\\'")}')">
        <td><span class="caret">${expanded ? '▾' : '▸'}</span> ${esc(r.description)}</td>
        <td class="num">${num(r.qty, 2)}</td>
        <td class="num">${num(r.lineCount)}</td>
        <td class="num">${km(rev)}</td>
        <td class="num">${pct.toFixed(1)}%</td>
      </tr>
    `;

    if (!expanded) return summary;

    const sublinesHtml = lines.length === 0
      ? `<tr class="subrow-empty"><td colspan="5">Nema detalja.</td></tr>`
      : lines.map(l => `
          <tr class="subrow">
            <td>${formatDate(l.jobDate)} &middot; ${soLink(l.serviceOrderId, l.serviceOrderNumber)}</td>
            <td>${esc(l.description)}</td>
            <td class="num">${num(l.qty, 2)}</td>
            <td class="num">${km(l.rate)}</td>
            <td class="num">${km((Number(l.qty) || 0) * (Number(l.rate) || 0))}</td>
          </tr>
        `).join('');

    const detail = `
      <tr class="subrow-wrap"><td colspan="5">
        <table class="subtable">
          <thead><tr>
            <th>Nalog</th><th>Opis linije</th>
            <th class="num">Kol.</th><th class="num">Cijena</th><th class="num">Iznos</th>
          </tr></thead>
          <tbody>${sublinesHtml}</tbody>
        </table>
      </td></tr>
    `;

    return summary + detail;
  }).join('');

  return `
    <div class="modal-hint">Klikni red da raširiš/sakriješ pojedinačne linije.</div>
    <table class="modal-table">
      <thead><tr>
        <th>Usluga</th><th class="num">Kol.</th><th class="num">Br. linija</th>
        <th class="num">Promet</th><th class="num">% udio</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr>
        <td>Ukupno (${sorted.length})</td>
        <td></td><td></td>
        <td class="num">${km(grand)}</td>
        <td class="num">100%</td>
      </tr></tfoot>
    </table>
  `;
}

function renderGoodsTable(rows) {
  if (!rows || rows.length === 0) {
    return `<div class="loading">Nema robe u ovom periodu.</div>`;
  }
  const totalQty   = rows.reduce((s, r) => s + (Number(r.qty)  || 0), 0);
  const totalRev   = rows.reduce((s, r) => s + (Number(r.qty)  || 0) * (Number(r.rate) || 0), 0);
  const totalCost  = rows.reduce((s, r) => s + (Number(r.qty)  || 0) * (Number(r.nabavna) || 0), 0);

  const rowsHtml = rows.map(r => {
    const qty       = Number(r.qty) || 0;
    const rate      = Number(r.rate) || 0;
    const nabavna   = Number(r.nabavna) || 0;
    const lineTotal = qty * rate;
    const noCost    = nabavna <= 0;
    return `
      <tr>
        <td>${formatDate(r.jobDate)}</td>
        <td>${soLink(r.serviceOrderId, r.serviceOrderNumber)}</td>
        <td>${esc(r.sifraArtikla)}</td>
        <td>${esc(r.description)}</td>
        <td class="num">${num(qty, 2)} ${esc(r.jm || '')}</td>
        <td class="num">${km(rate)}</td>
        <td class="num ${noCost ? 'no-cost' : ''}">${noCost ? '—' : km(nabavna)}</td>
        <td class="num">${km(lineTotal)}</td>
      </tr>
    `;
  }).join('');

  return `
    <table class="modal-table">
      <thead><tr>
        <th>Datum</th><th>Nalog</th><th>Šifra</th><th>Naziv</th>
        <th class="num">Kol.</th><th class="num">Prodajna</th>
        <th class="num">Nabavna</th><th class="num">Promet</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr>
        <td colspan="4">Ukupno (${rows.length})</td>
        <td class="num">${num(totalQty, 2)}</td>
        <td></td>
        <td class="num">${km(totalCost)}</td>
        <td class="num">${km(totalRev)}</td>
      </tr></tfoot>
    </table>
  `;
}

// ── Dev-only inline tab bar (scope switcher) ────────────────────────────────
function injectDevTabs() {
  if (document.getElementById('dev-scope-tabs')) {
    document.querySelectorAll('#dev-scope-tabs button').forEach(btn => {
      const active = btn.dataset.scope === _scope;
      btn.style.background = active ? 'var(--accent)' : 'var(--surface)';
      btn.style.color      = active ? '#fff' : 'var(--muted)';
    });
    return;
  }

  const bar = document.createElement('div');
  bar.id = 'dev-scope-tabs';
  bar.style.cssText = 'display:flex;gap:4px;margin-bottom:10px;';

  const labels = { day: 'Dan', week: 'Sedmica', month: 'Mjesec' };
  Object.keys(labels).forEach(s => {
    const btn = document.createElement('button');
    btn.dataset.scope = s;
    btn.textContent   = labels[s];
    btn.style.cssText = `
      border:1px solid var(--border); border-radius:6px; padding:4px 12px;
      background:${s === _scope ? 'var(--accent)' : 'var(--surface)'};
      color:${s === _scope ? '#fff' : 'var(--muted)'};
      cursor:pointer; font-size:12px; font-weight:500;
    `;
    btn.onclick = () => { _scope = s; if (_data) render(); };
    bar.appendChild(btn);
  });

  const app = document.getElementById('app');
  app.insertBefore(bar, app.firstChild);
}
