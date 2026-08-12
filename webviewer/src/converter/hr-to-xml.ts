/**
 * Human-Readable -> fmxmlsnippet XML converter.
 *
 * Parses HR script text line-by-line and emits valid fmxmlsnippet XML.
 */

import { parseScript } from './parser';
import { getHrToXmlConverter, stepOpen, stepSelfClose, cdata } from './step-registry';
import type { IdResolver } from './id-resolver';
import { createIdResolver } from './id-resolver';
import type { FMContext } from '@/context/types';
import type { StepCatalogEntry } from './catalog-types';
import { registerCatalogConverters } from './catalog-converter';
import { initGrammar } from './catalog-grammar';

// Control-flow hand-coders (the sanctioned catalog exception) — side-effect
// import, must come before catalog registration so they win over the engine.
// Every other step (data steps) is now rendered from the catalog grammar by the
// shared engine; their former steps/*.ts hand-coders were retired in P6.3.
import './steps/control';

let catalogLoaded = false;

/** Load catalog entries into both converter registries (idempotent). */
export function loadCatalog(catalog: StepCatalogEntry[]): void {
  if (catalogLoaded) return;
  catalogLoaded = true;
  initGrammar(catalog); // grammar registry (catalog-grammar.ts) — powers both directions
  registerCatalogConverters(catalog); // HR→XML: engine for every non-control step
}

export interface ConversionResult {
  xml: string;
  errors: ConversionError[];
  warnings: ConversionError[];
}

export interface ConversionError {
  line: number;
  message: string;
}

/**
 * Convert human-readable FileMaker script text to fmxmlsnippet XML.
 */
export function hrToXml(hrText: string, context?: FMContext | null): ConversionResult {
  // Trim trailing blank lines so they don't produce extra empty comments
  const trimmedText = hrText.replace(/\n+$/, '');
  const lines = parseScript(trimmedText);
  const resolver = createIdResolver(context ?? null);
  const errors: ConversionError[] = [];
  const stepXmls: string[] = [];

  for (const line of lines) {
    // Empty lines become empty # (comment) steps. The step id must be the
    // catalog id for a comment (89), not 0: a Step-level id="0" fails snippet
    // validation and forces FileMaker to resolve the step by its (localized)
    // name on paste, which is fragile on non-English builds. stepSelfClose
    // resolves the id from the catalog, so it stays correct and locale-independent.
    if (!line.stepName) {
      stepXmls.push(stepSelfClose('# (comment)', !line.disabled));
      continue;
    }

    const converter = getHrToXmlConverter(line.stepName);
    if (converter) {
      try {
        stepXmls.push(converter.toXml(line, resolver));
      } catch (err) {
        errors.push({
          line: line.lineNumber,
          message: `Error converting "${line.stepName}": ${err}`,
        });
        // Emit a comment with the error
        stepXmls.push(unknownStepXml(line.stepName, line.raw.trim(), !line.disabled));
      }
    } else {
      // Unknown step — emit as comment placeholder
      errors.push({
        line: line.lineNumber,
        message: `Unknown step: "${line.stepName}"`,
      });
      stepXmls.push(unknownStepXml(line.stepName, line.raw.trim(), !line.disabled));
    }
  }

  // Report unresolved references as warnings (not errors).
  // The XML is still valid — FileMaker resolves by name on paste.
  const warnings: ConversionError[] = [];
  for (const ref of resolver.getUnresolved()) {
    warnings.push({
      line: 0,
      message: `Unresolved ${ref.type}: "${ref.name}" (id will be 0)`,
    });
  }

  const xml = [
    '<?xml version="1.0"?>',
    '<fmxmlsnippet type="FMObjectList">',
    ...stepXmls,
    '</fmxmlsnippet>',
  ].join('\n');

  return { xml, errors, warnings };
}

/** Generate a comment step for unrecognized steps */
function unknownStepXml(stepName: string, rawText: string, enabled: boolean): string {
  return [
    stepOpen('# (comment)', enabled),
    `    <Text>[UNKNOWN STEP: ${stepName}] ${rawText}</Text>`,
    '  </Step>',
  ].join('\n');
}

export { createIdResolver };
