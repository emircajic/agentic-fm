// Chrome toolbar — DUMB renderer.
// Renders the config array it is handed. No fetching, no generation, no handshakes.
//   - Cold load (production): ToolbarUrl() bakes window.__TOOLBAR_CONFIG__ before this runs.
//   - Live update: FM calls window.receiveFromFileMaker(json) (canonical entry point).
// Each clickable row fires FileMaker.PerformScript(script, payload); rows without a
// `script` render as static labels (e.g. the friendly layout name).

import '../styles/main.css';
import seedConfig from './mock-data.json';
import { initMockFileMaker } from './mock-filemaker.js';
import { createDevControls } from './dev-controls.js';

const SVGNS = 'http://www.w3.org/2000/svg';

function perform(script, payload) {
  if (!script) return;
  try {
    if (window.FileMaker && window.FileMaker.PerformScript) {
      window.FileMaker.PerformScript(script, payload == null ? '' : String(payload));
    }
  } catch (e) { /* a dumb renderer never throws back into FM */ }
}

function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }

function makeItem(row) {
  const hasScript = !!row.script;
  const node = el(hasScript ? 'button' : 'div', 'item' + (hasScript ? '' : ' label'));
  if (row.icon) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'ico');
    const use = document.createElementNS(SVGNS, 'use');
    use.setAttributeNS(null, 'href', '#' + row.icon);
    svg.appendChild(use);
    node.appendChild(svg);
  }
  if (row.label) {
    const t = el('span', 'txt');
    t.textContent = row.label;
    node.appendChild(t);
  }
  if (hasScript) node.addEventListener('click', () => perform(row.script, row.payload));
  return node;
}

// Search input — fires the find ONLY on Enter. Running the find steals focus and
// repaints the WV, so a live/debounced field can never hold focus to keep typing;
// on Enter that focus loss is harmless (the user is done typing). Clearing the field
// and pressing Enter resets to the full list (empty term -> Show All).
function makeSearch(row) {
  const wrap = el('div', 'searchwrap');
  const input = el('input', 'search');
  input.type = 'search';
  input.placeholder = row.placeholder || 'Search…';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); perform(row.script, input.value); }
  });
  wrap.appendChild(input);
  return wrap;
}

function render(config) {
  const bar = document.getElementById('bar');
  if (!bar) return;
  bar.textContent = '';
  const rows = Array.isArray(config) ? config.slice() : [];
  const zones = {};
  rows.forEach((r) => { const z = r.zone || 'left'; (zones[z] = zones[z] || []).push(r); });
  ['left', 'center', 'right'].forEach((z) => {
    if (!zones[z]) return;
    const zn = el('div', 'zone ' + z);
    zones[z].sort((a, b) => (a.order || 0) - (b.order || 0))
            .forEach((r) => zn.appendChild(r.type === 'search' ? makeSearch(r) : makeItem(r)));
    bar.appendChild(zn);
  });
}

// Canonical FM -> WV entry point. Used for within-layout live updates.
window.receiveFromFileMaker = (data) => {
  try { render(typeof data === 'string' ? JSON.parse(data) : data); } catch (e) { /* ignore bad payload */ }
};

document.addEventListener('DOMContentLoaded', () => {
  if (import.meta.env.DEV) {
    // No FM bake in the browser — stub FileMaker + seed from mock config so the bar renders.
    initMockFileMaker();
    window.__devConfig = seedConfig;
    createDevControls(render);
    render(window.__TOOLBAR_CONFIG__ || seedConfig);

    // faint faux page so the strip reads as top chrome during dev
    const page = el('div');
    page.style.cssText = 'height:140px;display:flex;align-items:center;justify-content:center;color:#9aa3ad;background:#fff;font:13px sans-serif';
    page.textContent = 'layout body (dev preview)';
    document.body.appendChild(page);
  } else {
    // Production: real FileMaker injects window.FileMaker; ToolbarUrl baked the config.
    render(window.__TOOLBAR_CONFIG__ || []);
  }
});
