/**
 * Dev-only controls (stripped from the production bundle via the import.meta.env.PROD
 * guard + terser dead-code elimination). Two things:
 *   1. Live log of every FileMaker.PerformScript the toolbar fires (click a button → see
 *      the exact script + payload it would run in FM).
 *   2. A config editor that calls window.receiveFromFileMaker(json) so the live-update
 *      path can be exercised without FileMaker.
 * Styles are inline so no Tailwind utilities leak into the production CSS.
 */
export function createDevControls(render) {
  if (import.meta.env.PROD) return;

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;bottom:12px;right:12px;width:330px;background:#111827;color:#e5e7eb;' +
    'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;border-radius:10px;padding:12px;' +
    'z-index:9999;box-shadow:0 10px 34px rgba(0,0,0,.45)';
  panel.innerHTML =
    '<div style="font-weight:600;margin-bottom:8px">Mock FileMaker</div>' +
    '<div style="color:#9ca3af;margin-bottom:4px">PerformScript log</div>' +
    '<div id="fm-log" style="background:#0b1220;border-radius:6px;padding:6px;max-height:120px;overflow:auto;margin-bottom:10px">—</div>' +
    '<div style="color:#9ca3af;margin-bottom:4px">Push config &rarr; receiveFromFileMaker</div>' +
    '<textarea id="cfg-in" spellcheck="false" style="width:100%;height:84px;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:6px;padding:6px;font:11px/1.4 ui-monospace,monospace;resize:vertical"></textarea>' +
    '<button id="cfg-apply" style="margin-top:6px;width:100%;background:#2563eb;color:#fff;border:0;border-radius:6px;padding:8px;cursor:pointer;font:inherit">Apply</button>';
  document.body.appendChild(panel);

  const logEl = panel.querySelector('#fm-log');
  window.__devLogFM = (entry) => {
    if (logEl.textContent === '—') logEl.textContent = '';
    const d = document.createElement('div');
    d.style.marginBottom = '3px';
    d.innerHTML =
      '<span style="color:#6b7280">[' + entry.t + ']</span> ' +
      '<span style="color:#34d399">' + entry.script + '</span>' +
      '(<span style="color:#fbbf24">' + JSON.stringify(entry.parameter) + '</span>)';
    logEl.prepend(d);
  };

  const cfgIn = panel.querySelector('#cfg-in');
  cfgIn.value = JSON.stringify(window.__devConfig || [], null, 0);
  panel.querySelector('#cfg-apply').addEventListener('click', () => {
    try { render(JSON.parse(cfgIn.value)); }
    catch (e) { alert('Bad JSON: ' + e.message); }
  });
}
