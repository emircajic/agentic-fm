import mockData from './mock-data.json';

/**
 * Mock FileMaker host for the Service Orders Kanban.
 *
 * Mirrors the real architecture: FileMaker owns the scope state ($$KANBAN_SCOPE),
 * the controls drive it through WV__KanbanControl, and every change re-runs the
 * push (WV__PushServiceOrdersKanban) which filters + paginates server-side and
 * calls window.receiveFromFileMaker({ orders, meta }). The web viewer never owns
 * the filter state — exactly like production. The search box is the one control
 * that lives in the viewer, but it too round-trips through WV__KanbanControl
 * (action "setQuery") so FM stays the single source of truth.
 */

const MONTHS = ['Januar', 'Februar', 'Mart', 'April', 'Maj', 'Juni',
                'Juli', 'Avgust', 'Septembar', 'Oktobar', 'Novembar', 'Decembar'];

// Statuses that stay on the board regardless of the date window (matches the
// WHERE clause in WV__PushServiceOrdersKanban).
const PINNED_STATUSES = ['U toku', 'Obračunat', 'Fakturisan'];

// Fixed "today" so the seeded June data is always visible regardless of the wall clock.
const DEFAULT_ANCHOR = '2026-06-06';

// Per-column lazy loading: each status column shows INITIAL_SIZE cards, and each
// "load more" (triggered by scrolling that column to the bottom) reveals PAGE_STEP
// more — independent of every other column.
const INITIAL_SIZE = 20;
const PAGE_STEP    = 10;

// Canonical pipeline order (mirrors STATUS_LIST in main.js / the SQL columns).
const STATUS_LIST = ['U toku', 'Otvoren', 'Zakazan', 'Završen', 'Obračunat', 'Fakturisan', 'Naplaćen', 'Otkazan'];

// ── date helpers ────────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

function windowFor(periodMode, anchorISO) {
  const a = parseISO(anchorISO);
  if (periodMode === 'week') {
    const dow = (a.getDay() + 6) % 7;            // Monday = 0
    const mon = new Date(a); mon.setDate(a.getDate() - dow);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: iso(mon), to: iso(sun) };
  }
  if (periodMode === 'month') {
    return { from: iso(new Date(a.getFullYear(), a.getMonth(), 1)),
             to:   iso(new Date(a.getFullYear(), a.getMonth() + 1, 0)) };
  }
  return { from: anchorISO, to: anchorISO };      // day
}

function labelFor(periodMode, anchorISO, from, to) {
  const a = parseISO(anchorISO);
  if (periodMode === 'week') {
    const f = parseISO(from), t = parseISO(to);
    return f.getMonth() === t.getMonth()
      ? `Sedmica: ${f.getDate()}–${t.getDate()}. ${MONTHS[t.getMonth()]} ${t.getFullYear()}`
      : `Sedmica: ${f.getDate()}. ${MONTHS[f.getMonth()]} – ${t.getDate()}. ${MONTHS[t.getMonth()]} ${t.getFullYear()}`;
  }
  if (periodMode === 'month') return `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  return `${a.getDate()}. ${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
}

function shiftAnchor(periodMode, anchorISO, dir) {
  const a = parseISO(anchorISO);
  if (periodMode === 'week')  { a.setDate(a.getDate() + 7 * dir); return iso(a); }
  if (periodMode === 'month') { return iso(new Date(a.getFullYear(), a.getMonth() + dir, 1)); }
  a.setDate(a.getDate() + dir);                   // day
  return iso(a);
}

// ── mock host ───────────────────────────────────────────────────────────────
export class MockFileMaker {
  constructor() {
    this.scriptLog = [];
    // $$KANBAN_SCOPE equivalent — `loaded` maps status → how many cards that
    // column currently reveals (absent = INITIAL_SIZE). No global offset/limit.
    this.scope = {
      periodMode: 'day', anchorDate: DEFAULT_ANCHOR, statuses: [], query: '',
      initialSize: INITIAL_SIZE, pageStep: PAGE_STEP, loaded: {},
    };
  }

  getScope() { return { ...this.scope, statuses: [...this.scope.statuses], loaded: { ...this.scope.loaded } }; }

  PerformScript(scriptName, parameter) {
    console.log(`[Mock FM] ${scriptName}`, parameter);
    this.scriptLog.push({ timestamp: new Date().toISOString(), scriptName, parameter });
    const p = typeof parameter === 'string' && parameter ? safeParse(parameter) : parameter;

    if (scriptName === 'WV__KanbanControl') {
      this._control(p || {});
      this.push();
    } else if (scriptName === 'WV__UpdateSOStatus') {
      const order = mockData.orders.find(o => o.id === p.id);
      if (order) order.status = p.status;
      setTimeout(() => this.push(), 250);          // simulate FM round-trip latency
    }
    // WV__OpenServiceOrder: just logged
  }

  // Mirror of WV__KanbanControl: mutate $$KANBAN_SCOPE.
  // Any scope change that reshapes the result set resets every column back to
  // its initial page; `loadMore` grows a single column by one PAGE_STEP.
  _control({ action, value }) {
    const s = this.scope;
    switch (action) {
      case 'setPeriod':   s.periodMode = value; s.loaded = {}; break;
      case 'navigate':
        if (value === 'today') s.anchorDate = DEFAULT_ANCHOR;
        else                   s.anchorDate = shiftAnchor(s.periodMode, s.anchorDate, value === 'next' ? 1 : -1);
        s.loaded = {};
        break;
      case 'toggleStatus': {
        const i = s.statuses.indexOf(value);
        if (i >= 0) s.statuses.splice(i, 1); else s.statuses.push(value);
        s.loaded = {};
        break;
      }
      case 'clearStatus': s.statuses = []; s.loaded = {}; break;
      case 'setQuery':    s.query = (value || '').trim(); s.loaded = {}; break;
      case 'loadMore':    if (value) s.loaded[value] = (s.loaded[value] || s.initialSize) + s.pageStep; break;
    }
  }

  // Mirror of WV__PushServiceOrdersKanban: filter, then paginate PER COLUMN.
  // The real script does this as a GROUP BY count + one FETCH-FIRST SELECT per
  // status; here we filter once and slice each status group to its loaded count.
  push() {
    const s = this.scope;
    const { from, to } = windowFor(s.periodMode, s.anchorDate);

    // pinned OR (date window [AND status filter]) — matches the SQL WHERE
    let rows = mockData.orders.filter(o =>
      PINNED_STATUSES.includes(o.status) ||
      (o.date >= from && o.date <= to && (!s.statuses.length || s.statuses.includes(o.status))));

    if (s.query) {
      const q = s.query.toLowerCase();
      rows = rows.filter(o =>
        [o.number, o.customer, o.plate, o.make, o.model, o.service]
          .some(v => (v || '').toLowerCase().includes(q)));
    }

    rows.sort((a, b) => a.date === b.date
      ? (a.timeStart || '').localeCompare(b.timeStart || '')
      : a.date.localeCompare(b.date));

    // Group by status, then take the first `loaded` of each column.
    const groups = {};
    for (const o of rows) (groups[o.status] = groups[o.status] || []).push(o);

    const orders  = [];
    const columns = {};
    for (const status of STATUS_LIST) {
      const g = groups[status];
      if (!g || !g.length) continue;                 // absent columns == 0 (JS defaults)
      const available = g.length;
      const loaded    = Math.min(s.loaded[status] || s.initialSize, available);
      columns[status] = { loaded, available };
      for (let i = 0; i < loaded; i++) orders.push(g[i]);
    }

    const meta = {
      periodMode: s.periodMode,
      anchorDate: s.anchorDate,
      from, to,
      label: labelFor(s.periodMode, s.anchorDate, from, to),
      statuses: [...s.statuses],
      query: s.query,
      pageStep: s.pageStep,
      columns,                                        // v3: per-column { loaded, available }
    };

    if (window.receiveFromFileMaker) {
      window.receiveFromFileMaker(JSON.parse(JSON.stringify({ orders, meta })));
    }
  }

  getScriptLog() { return this.scriptLog; }
  clearLog()     { this.scriptLog = []; }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return s; } }

export function initMockFileMaker() {
  const mock = new MockFileMaker();
  window.FileMaker = mock;

  // Surface for the dev controls panel (these simulate the FM-native buttons).
  window.mockKanban = {
    dispatch: (action, value) => mock.PerformScript('WV__KanbanControl', JSON.stringify({ action, value })),
    getScope: () => mock.getScope(),
    getLog:   () => mock.getScriptLog(),
    clearLog: () => mock.clearLog(),
  };

  setTimeout(() => mock.push(), 100);              // initial render
  return mock;
}
