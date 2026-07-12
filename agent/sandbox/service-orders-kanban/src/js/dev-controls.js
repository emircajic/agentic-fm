/**
 * Development Controls — simulate the FileMaker-native scope controls.
 *
 * In production these buttons live on the FileMaker layout and call
 * WV__KanbanControl. Here they call the same script through the mock host, so the
 * data path being exercised is identical to production.
 */

const PERIODS  = [['day', 'Dan'], ['week', 'Sedmica'], ['month', 'Mjesec']];
const STATUSES = ['U toku', 'Otvoren', 'Zakazan', 'Završen', 'Obračunat', 'Fakturisan', 'Naplaćen', 'Otkazan'];

export function createDevControls() {
  if (import.meta.env.PROD) return;

  const panel = document.createElement('div');
  panel.id = 'dev-controls';
  panel.className = 'fixed bottom-4 right-4 bg-gray-900/95 text-white p-3 rounded-lg shadow-2xl z-30 text-xs';
  panel.style.width = '320px';
  document.body.appendChild(panel);

  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, value } = btn.dataset;
    if (action === 'minimize') { panel.classList.toggle('minimized'); render(panel); return; }
    if (action === 'clearLog') { window.mockKanban?.clearLog(); render(panel); return; }
    window.mockKanban?.dispatch(action, value);
    render(panel);
  });

  render(panel);
}

function render(panel) {
  const minimized = panel.classList.contains('minimized');
  const scope = window.mockKanban?.getScope?.() || {};

  const periodBtns = PERIODS.map(([v, label]) =>
    btn('setPeriod', v, label, scope.periodMode === v)).join('');

  const statusBtns = STATUSES.map(s =>
    btn('toggleStatus', s, s, (scope.statuses || []).includes(s))).join('') +
    btn('clearStatus', '', 'Sve', !(scope.statuses || []).length);

  panel.innerHTML = `
    <div class="flex justify-between items-center mb-2">
      <h3 class="font-bold">🔧 Kanban scope (mock FM)</h3>
      <button data-action="minimize" class="bg-gray-700 px-2 py-0.5 rounded hover:bg-gray-600">${minimized ? '+' : '–'}</button>
    </div>
    ${minimized ? '' : `
      <div class="space-y-2">
        <div>
          <div class="text-gray-400 mb-1">Period</div>
          <div class="flex gap-1">${periodBtns}</div>
        </div>
        <div>
          <div class="text-gray-400 mb-1">Navigacija</div>
          <div class="flex gap-1">
            ${btn('navigate', 'prev', '◀')}
            ${btn('navigate', 'today', 'Danas')}
            ${btn('navigate', 'next', '▶')}
          </div>
        </div>
        <div>
          <div class="text-gray-400 mb-1">Status filter</div>
          <div class="flex flex-wrap gap-1">${statusBtns}</div>
        </div>
        <div>
          <div class="text-gray-400 mb-1">Stranica</div>
          <div class="flex gap-1">
            ${btn('page', 'prev', '◀ str')}
            ${btn('page', 'next', 'str ▶')}
          </div>
        </div>
        <pre class="bg-gray-800 rounded p-2 text-[10px] leading-tight overflow-x-auto">${esc(JSON.stringify(scope))}</pre>
      </div>
    `}
  `;
}

function btn(action, value, label, active = false) {
  const base = active ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600';
  return `<button data-action="${action}" data-value="${esc(value)}" class="${base} px-2 py-1 rounded">${esc(label)}</button>`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
