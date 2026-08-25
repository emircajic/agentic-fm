/**
 * Regression: a blank HR line becomes an empty "# (comment)" step, and that
 * step must carry the catalog comment id (89), not a Step-level id="0".
 *
 * id="0" on a <Step> fails snippet validation and forces FileMaker to resolve
 * the step by its (localized) name on paste — fragile on non-English builds.
 * stepSelfClose resolves the id from the catalog, so blank lines stay correct
 * and locale-independent. Text-bearing comments already emitted id="89"; only
 * the empty-line branch bypassed the catalog.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hrToXml, loadCatalog } from '@/converter/hr-to-xml';
import type { StepCatalogEntry } from '@/converter/catalog-types';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CATALOG_PATH = path.join(REPO_ROOT, 'agent', 'catalogs', 'step-catalog-en.json');

const rawCatalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'));
const entries: StepCatalogEntry[] = rawCatalog.steps ?? rawCatalog;
loadCatalog(entries);

describe('HR→XML blank-line comment id', () => {
  it('emits the catalog comment id (89), never a Step-level id="0"', () => {
    // A comment, a blank line, then another comment — the blank line is the
    // step under test.
    const { xml } = hrToXml('# first\n\n# second');
    expect(xml).toContain('id="89" name="# (comment)"/>');
    expect(xml).not.toContain('id="0" name="# (comment)"');
  });
});
