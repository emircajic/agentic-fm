/**
 * Catalog-driven HR→XML registration.
 *
 * Registers a converter for every catalog step that has no hand-coded converter
 * (the control-flow set in steps/control.ts). A self-closing step with no params
 * emits `<Step .../>`; every other step is rendered by the shared grammar engine
 * `convertStepWithCatalog` (catalog-emit.ts) — the faithful port of the reference
 * converter's HR→fmxmlsnippet path. No per-step emit logic lives here anymore; the
 * catalog `params[]` grammar is the single source of truth.
 */

import type { StepCatalogEntry } from './catalog-types';
import type { ParsedLine } from './parser';
import type { IdResolver } from './id-resolver';
import { getHrToXmlConverter, registerHrToXml, stepSelfClose } from './step-registry';
import { getGrammarEntry } from './catalog-grammar';
import { convertStepWithCatalog } from './catalog-emit';

/**
 * Register catalog-driven converters for all steps not already handled by a
 * hand-coded converter. Call this AFTER the hand-coded step imports (so the
 * control-flow set wins) and after `initGrammar` (the engine reads the grammar
 * registry, looked up lazily at conversion time).
 */
export function registerCatalogConverters(catalog: StepCatalogEntry[]): void {
  for (const entry of catalog) {
    // A hand-coded converter (control-flow set) already owns this step.
    if (getHrToXmlConverter(entry.name)) continue;

    // Trim-tolerant registration: a few FM steps carry significant trailing
    // whitespace in their canonical name (e.g. "Configure RAG Account "), which
    // the HR parser trims before lookup. Register under the trimmed name too so
    // the parsed name resolves; emission still uses the real (spaced) grammar
    // entry, reproducing FM's `name=` faithfully. Mirrors the reference's
    // trim-tolerant LookupCatalogEntry.
    const trimmed = entry.name.trim();
    const stepNames = trimmed === entry.name ? [entry.name] : [entry.name, trimmed];

    if (entry.selfClosing && entry.params.length === 0) {
      // Self-closing, no params → `<Step .../>` (mirrors the reference wrapper).
      const realName = entry.name;
      registerHrToXml({
        stepNames,
        toXml(line: ParsedLine): string {
          return stepSelfClose(realName, !line.disabled);
        },
      });
    } else {
      // Everything else → the shared grammar engine. Resolve the GrammarEntry
      // lazily so registration order relative to initGrammar does not matter.
      const stepName = entry.name;
      registerHrToXml({
        stepNames,
        toXml(line: ParsedLine, resolver: IdResolver): string {
          const grammar = getGrammarEntry(stepName);
          if (!grammar) throw new Error(`no grammar entry for step "${stepName}"`);
          return convertStepWithCatalog(grammar, line, resolver);
        },
      });
    }
  }
}
