import '../styles/main.css';
import { initMockFileMaker } from './mock-filemaker.js';
import { createDevControls } from './dev-controls.js';
import mockData from './mock-data.json';

// ── State ──────────────────────────────────────────────────────────────────
let _data  = null;
let _scope = 'day';

// ── Bootstrap ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (import.meta.env.DEV) {
    initMockFileMaker();
    createDevControls();
    // Auto-push mock data so the UI is visible immediately on dev start
    setTimeout(() => window.receiveFromFileMaker(mockData), 100);
  }

  window.receiveFromFileMaker = (data) => {
    const payload = typeof data === 'string' ? JSON.parse(data) : data;
    _data = payload;
    // Flat single-scope push from FM: {scope, grandTotal, ...}
    // Nested dev mock: {day:{...}, week:{...}, month:{...}}
    if (payload.scope && payload.grandTotal !== undefined) _scope = payload.scope;
    render();
  };
});

// ── Scope switch — called by FM-native buttons on the layout ────────────────
// In production, tabs live on the FM layout as native buttons, not in the WV.
// Each button runs WV__PushSalesDashboard with the web viewer name as parameter;
// scope switching is handled by FM re-pushing with a different date range.
// For dev, we expose window.setScope so the dev tab bar works.
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
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  if (!app) return;

  if (!_data) {
    app.innerHTML = '<div class="loading">Čeka se osvježavanje…</div>';
    return;
  }

  // Flat FM push has grandTotal at root; nested dev mock has it under scope key
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
  const komSold          = Number(d.komSold)          || 0;
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

  const profitClass = profitTotal >= 0 ? 'border-emerald-400 bg-emerald-500/10 text-slate-100' : 'border-rose-400 bg-rose-500/10 text-slate-100';
  const robaClass = 'border-cyan-600 bg-cyan-500/10 text-slate-100' ;
  const uslugaClass = 'border-slate-700 bg-slate-950/80 text-slate-100' ;
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
<div class="flex items-baseline justify-between" style="gap:0.5rem; margin-top:0.75rem;">
    <div class="flex-1 rounded-xl border shadow-sm ${returnClass}" style="padding:1rem">
        <div class="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400" style="margin-bottom:0.5rem;">Povrati</div>
        <div class="text-2xl font-bold">${num(returnCount)}</div>
        <div class="text-[11px] text-slate-400" style="margin-top:0.5rem;">${returnQty > 0 ? num(returnQty) + ' kom vraćeno' : 'bez povrata'}</div>
        <button class="${moreButtonClass}">Pogledaj povrate</button>
    </div>
    <div class="flex-1 rounded-xl border shadow-sm ${noCostClass}" style="padding:1rem">
        <div class="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400" style="margin-bottom:0.5rem;">Bez nabavne cijene</div>
        <div class="text-2xl font-bold">${num(missingCostCount)}</div>
        <div class="text-[11px] text-slate-400" style="margin-top:0.5rem;"> Projena dobiti: ${km(missingCostRev)} </div>
        <button class="${moreButtonClass}">Unesi nabavnu cijenu</button>
    </div>
</div>
      </div>

      <div class="col-span-1 rounded-xl border shadow-sm ${uslugaClass}" style="padding:1rem;">
        
        <div class="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400" style="margin-bottom:0.5rem;">Usluge</div>
        <div class="text-xl font-bold"><span class="text-slate-400 text-sm">Ukupan promet</span><br />${km(uslugaRevenue)}</div>

        </div>


    </div>
    <div class="text-[10px] text-slate-500 text-right" style="padding-bottom:0.25rem;">${_data.generatedAt ? 'Osvježeno: ' + esc(_data.generatedAt) : ''}</div>
  `;

  if (import.meta.env.DEV) injectDevTabs();
}

// ── Dev-only inline tab bar (scope switcher) ────────────────────────────────
function injectDevTabs() {
  if (document.getElementById('dev-scope-tabs')) {
    // Update active state on re-render
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
