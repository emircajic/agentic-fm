/**
 * Engine-level regression net for the governed-visibility boolean in
 * catalog-emit.ts, mirroring the Python agent/scripts/test_catalog_emit.py cases
 * of the same name so the two ports stay structurally parallel.
 *
 * The facet: an `hrHidden` boolean that a sibling's `visibleWhen` gates on
 * carries no HR token of its own, so HR→XML must DERIVE its state from whether
 * a gated companion contributed a token. Letting `defaultValue` answer instead
 * turns "no stored import order" into "restore the stored order" on every
 * round-trip — and FileMaker obeys that flag, discarding what it gated.
 *
 * The 216-step byte-identity suite cannot catch a regression here: every corpus
 * step that carries one of these gates also carries its companion, so the
 * derived value and the catalog default agree. Only the companion-absent case
 * below separates them.
 *
 * Test 4 of the shared list (a SaXML reading of the gate survives unchanged) has
 * no counterpart here — the SaXML reader is Python-only. It lives in
 * agent/scripts/test_catalog_emit.py.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hrToXml, loadCatalog } from '@/converter/hr-to-xml';
import { xmlToHr } from '@/converter/xml-to-hr';
import type { StepCatalogEntry } from '@/converter/catalog-types';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CATALOG_PATH = path.join(REPO_ROOT, 'agent', 'catalogs', 'step-catalog-en.json');

beforeAll(() => {
  const rawCatalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'));
  const entries: StepCatalogEntry[] = rawCatalog.steps ?? rawCatalog;
  loadCatalog(entries);
});

describe('governed-visibility boolean (hrHidden gate derived on emit)', () => {
  it('derives the gate OPEN when a gated companion carries a token', () => {
    // A companion token present => the gate must serialize True, or FileMaker
    // would drop the import order the HR just described.
    expect(hrToXml('Import Records [ Table: Customers ]').xml).toContain(
      '<Restore state="True"/>',
    );
    expect(
      hrToXml('Export Records [ Export options: CharacterSet=UTF-8 ]').xml,
    ).toContain('<Restore state="True"/>');
  });

  it('derives the gate CLOSED when no gated companion does — not defaultValue', () => {
    // Both Restore params default to True in the catalog. This is the case the
    // byte-identity corpus never exercises and the only one that catches a
    // regression.
    expect(
      hrToXml('Import Records [ Import fields: Customers::Name ]').xml,
    ).toContain('<Restore state="False"/>');
    expect(hrToXml('Export Records [ Create folders: On ]').xml).toContain(
      '<Restore state="False"/>',
    );
  });

  it('survives an XML → HR → XML round-trip in both states', () => {
    // The gate carries no HR token, so the round-trip can only preserve it via
    // the companions.
    const head =
      '<fmxmlsnippet type="FMObjectList">' +
      '<Step enable="True" id="35" name="Import Records">';
    const tail =
      '<ImportOptions CharacterSet="UTF-8" method="Add"/>' +
      '<Table id="7" name="Customers"/></Step></fmxmlsnippet>';

    for (const state of ['True', 'False']) {
      const hr = xmlToHr(`${head}<Restore state="${state}"/>${tail}`);
      expect(hrToXml(hr).xml).toContain(`<Restore state="${state}"/>`);
    }
  });

  it('leaves an hrHidden boolean with no gating sibling on its catalog default', () => {
    // The derive rule must fire ONLY for a gate something actually gates on. A
    // plain hidden flag keeps the established behaviour: emit the catalog
    // default and let FileMaker re-canonicalize.
    expect(
      hrToXml('Insert from URL [ Select ; With dialog: Off ; Target: $file ; $url ]').xml,
    ).toContain('<DontEncodeURL state="False"/>');
  });
});
