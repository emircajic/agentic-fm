/**
 * fmxmlsnippet XML -> Human-Readable converter.
 *
 * Parses fmxmlsnippet XML and emits formatted HR text with proper indentation
 * for control-flow nesting. Step rendering is driven by the shared catalog
 * grammar engine (catalog-grammar.ts) — a faithful port of the reference grammar
 * interpreter. Only control-flow steps, Set Variable, and '# (comment)' stay
 * hand-coded (steps/control.ts, the sanctioned exception); every other step is
 * rendered generically from the catalog. This is the browser counterpart of the
 * server-side agent/scripts/snippet_to_hr.py and must produce byte-identical HR.
 *
 * Requires the catalog to be loaded first (loadCatalog in hr-to-xml.ts calls
 * initGrammar). Control-flow indentation is derived from each step's catalog
 * blockPair role, not a hard-coded name set (see blockIndent).
 */

import { getXmlToHrConverter } from './step-registry';
import { getGrammarEntry, renderStepHr, blockIndent } from './catalog-grammar';

// Import the sanctioned hand-coded control-flow converters (side-effect import).
// The former per-family data step modules were retired in P6.3 — their coverage
// now comes from the catalog grammar engine.
import './steps/control';

/**
 * Convert fmxmlsnippet XML to human-readable script text.
 */
export function xmlToHr(xml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    return `# XML Parse Error: ${parseError.textContent}`;
  }

  const steps = doc.querySelectorAll('fmxmlsnippet > Step');
  const lines: string[] = [];
  let indent = 0;

  for (const step of steps) {
    const stepName = step.getAttribute('name') ?? '';
    const enabled = step.getAttribute('enable') !== 'False';

    // Indentation is governed by the step's catalog blockPair role.
    const { closeBefore, openAfter } = blockIndent(stepName);
    if (closeBefore) {
      indent = Math.max(0, indent - 1);
    }

    // Hand-coded control-flow converter wins; every other step renders from the
    // catalog grammar engine (matching snippet_to_hr.py's RENDERERS/engine split).
    const converter = getXmlToHrConverter(stepName);
    let hrLine: string;
    if (converter) {
      hrLine = converter.toHR(step as Element);
    } else {
      const entry = getGrammarEntry(stepName);
      hrLine = entry ? renderStepHr(entry, step as Element) : `[UNKNOWN STEP: ${stepName}]`;
    }

    // Add disabled prefix
    if (!enabled) {
      hrLine = `// ${hrLine}`;
    }

    // Apply indentation
    const prefix = '    '.repeat(indent);
    lines.push(`${prefix}${hrLine}`);

    if (openAfter) {
      indent++;
    }
  }

  return lines.join('\n');
}
