/**
 * catalog-grammar.ts — the shared catalog grammar engine (TS port).
 *
 * A faithful TypeScript port of agent/scripts/catalog_grammar.py's XML→HR path:
 * one function per param type computes that param's HR fragment, and an
 * orchestrator renders the fragments in hrSlot order with discriminator /
 * visibility / label handling. Kept deliberately parallel to the Python module so
 * a facet added to one port is obviously missing from the other (see the plan's
 * "Python↔TS structural parity" risk).
 *
 * Like the reference converter (and the Python port), this reads directly from the
 * parsed fmxmlsnippet <Step> DOM element rather than through an intermediate
 * struct, so the output is byte-faithful to the proven grammar. Element traversal
 * uses ElementTree-`find` semantics — **direct children only** — never
 * `querySelector` (which would match descendants); see `findChild`/`findChildren`.
 *
 * The reference's per-param HR computation maps here to `computeParamHr` and its
 * whole-step renderer to `renderStepHr`.
 * Control-flow steps are NOT rendered here — they stay hand-coded in
 * steps/control.ts (the sanctioned exception), exactly as snippet_to_hr.py keeps
 * them hand-coded.
 */

import type { StepCatalogEntry } from './catalog-types';

// ---------------------------------------------------------------------------
// DOM helpers — ElementTree `.find` / `.findall` / `.text` semantics over a
// spec-compliant XML DOM (native DOMParser in the browser, linkedom in tests).
// Direct-child navigation only, matching Python's xml.etree.ElementTree.
// ---------------------------------------------------------------------------

/** First direct child element named `name` (ElementTree `parent.find(name)`). */
function findChild(parent: Element | null, name: string): Element | null {
  if (!parent) return null;
  for (const c of Array.from(parent.children)) {
    if (c.tagName === name) return c;
  }
  return null;
}

/** All direct child elements named `name` (ElementTree `parent.findall(name)`). */
function findChildren(parent: Element | null, name: string): Element[] {
  if (!parent) return [];
  return Array.from(parent.children).filter((c) => c.tagName === name);
}

/**
 * Text directly inside `el` (ElementTree `.text`). Every text-bearing element in
 * the catalog grammar (Calculation, Text, Name, UniversalPathList, field text) is
 * a leaf, so `textContent` — which decodes entities and includes CDATA content in
 * both native DOM and linkedom — is equivalent to ElementTree's leading `.text`.
 */
function elemText(el: Element | null): string {
  return el ? (el.textContent ?? '') : '';
}

/** ElementTree `_child_text`: text of the direct child named `name`. */
function childText(parent: Element | null, name: string): string {
  return elemText(findChild(parent, name));
}

/** ElementTree `_child_attr`: attribute `attr` of the direct child named `name`. */
function childAttr(parent: Element | null, name: string, attr: string): string {
  const c = findChild(parent, name);
  return c ? (c.getAttribute(attr) ?? '') : '';
}

/** ElementTree `_nested_text`: parent → child → grand → text. */
function nestedText(parent: Element | null, child: string, grand: string): string {
  return childText(findChild(parent, child), grand);
}

/** Follow a '/'-delimited direct-child path from `step` (ElementTree find path). */
function descendPath(step: Element | null, path: string): Element | null {
  let n: Element | null = step;
  for (const seg of path.split('/')) {
    if (!seg) continue;
    if (n === null) return null;
    n = findChild(n, seg);
  }
  return n;
}

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------
function ciEquals(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** G11 'Elem/@attr' notation → [true, 'Elem', 'attr']; else [false, '', '']. */
function splitElementAttr(xmlElement: string): [boolean, string, string] {
  const pos = xmlElement.indexOf('/@');
  if (pos === -1) return [false, '', ''];
  return [true, xmlElement.slice(0, pos), xmlElement.slice(pos + 2)];
}

function joinWithComma(items: string[]): string {
  return items.join(', ');
}

function needsGroupQuote(v: string): boolean {
  if (!v) return false;
  const ws = ' \t\n\r';
  if (ws.includes(v[0]) || ws.includes(v[v.length - 1])) return true;
  return v.includes(',') || v.includes('"');
}

function groupQuoteValue(v: string): string {
  if (!needsGroupQuote(v)) return v;
  return '"' + v.replace(/"/g, '""') + '"';
}

// ---------------------------------------------------------------------------
// Grammar model — mirrors Python catalog_grammar.py's StepParam / CatalogEntry:
// typed fields for the common facets + `raw` for the untyped long tail (bitmask
// tables, attrGroup/repeat field specs, entryElement/childElement, …).
// ---------------------------------------------------------------------------

/** One branch of a `discriminatorValues` map (mirrors DiscriminatorBranch). */
interface DiscriminatorBranch {
  hrToken: string | null;
  labeled: boolean | null;
  reveal: string[];
}

interface VisibleWhenRule {
  param: string;
  values: string[];
}

interface HrLabelRule {
  param: string;
  values: string[];
  hrLabel: string | null;
}

/** Faithful counterpart of Python's StepParam (typed fields + raw dict). */
export interface GrammarParam {
  xmlElement: string;
  type: string;
  hrLabel: string | null;
  required: boolean;
  xmlAttr: string | null;
  wrapperElement: string | null;
  parentElement: string | null;
  defaultValue: string | null;
  hrEnumValues: Record<string, string>;
  invertedHr: boolean | null;
  enumStyle: string | null;
  flagStyle: boolean | null;
  hrSlot: number | null;
  hrHidden: boolean | null;
  omitWhenEmpty: boolean | null;
  discriminator: string | null;
  discriminatorValues: Record<string, DiscriminatorBranch>;
  visibleWhen: VisibleWhenRule | null;
  hrLabelWhen: HrLabelRule[];
  /** The full source object, for the untyped facet tail (matches Python `raw`). */
  raw: Record<string, unknown>;
}

export interface GrammarEntry {
  name: string;
  /** FileMaker's universal step-type id (the `<Step id="N">` constant), 0 if unknown. */
  id: number;
  params: GrammarParam[];
  /** Block role (open/close/middle/inner) for control-flow indentation, or null. */
  blockRole: string | null;
}

/**
 * Control-flow indentation for a step, derived from its catalog `blockPair` role
 * (replacing the former hard-coded name sets in xml-to-hr.ts):
 *   open   → indent the following lines (openAfter)
 *   close  → outdent this line (closeBefore)
 *   middle → both (Else / Else If)
 *   inner / none → neither (Exit Loop If, Revert Transaction, every data step)
 * This mirrors the (close_before, open_after) tuples snippet_to_hr.py hand-codes,
 * and additionally covers Open/Commit Transaction blocks via the same rule.
 */
export function blockIndent(name: string): { closeBefore: boolean; openAfter: boolean } {
  const role = grammarRegistry.get(name)?.blockRole ?? null;
  return {
    closeBefore: role === 'close' || role === 'middle',
    openAfter: role === 'open' || role === 'middle',
  };
}

/**
 * The param-key rule (matches the reference converter and Python `param_key`): a
 * `namedCalc` param keys off its `wrapperElement`; any other param off its
 * `xmlElement`.
 */
export function paramKey(p: GrammarParam): string {
  if (p.type === 'namedCalc' && p.wrapperElement) return p.wrapperElement;
  return p.xmlElement;
}

function buildDiscriminatorBranch(d: Record<string, unknown>): DiscriminatorBranch {
  return {
    hrToken: (d.hrToken as string) ?? null,
    labeled: (d.labeled as boolean) ?? null,
    reveal: Array.isArray(d.reveal) ? (d.reveal as string[]) : [],
  };
}

function buildParam(d: Record<string, unknown>): GrammarParam {
  const dvRaw = (d.discriminatorValues as Record<string, Record<string, unknown>>) ?? {};
  const discriminatorValues: Record<string, DiscriminatorBranch> = {};
  for (const [k, v] of Object.entries(dvRaw)) {
    discriminatorValues[k] = buildDiscriminatorBranch(v);
  }
  const vw = d.visibleWhen as Record<string, unknown> | undefined;
  const hlw = (d.hrLabelWhen as Record<string, unknown>[]) ?? [];
  // `flagBoolean` is normalized to `boolean` at load, exactly as the reference
  // converter does — the engine only has a `boolean` branch, so without this ~21
  // flag params (Paste, Sort Records, Save as*, …) would render as nothing. The
  // original label survives in `raw.type`. (This was the one real P6.2 port bug.)
  const rawType = (d.type as string) ?? '';
  const type = rawType === 'flagBoolean' ? 'boolean' : rawType;
  return {
    xmlElement: (d.xmlElement as string) ?? '',
    type,
    hrLabel: (d.hrLabel as string) ?? null,
    required: Boolean(d.required),
    xmlAttr: (d.xmlAttr as string) ?? null,
    wrapperElement: (d.wrapperElement as string) ?? null,
    parentElement: (d.parentElement as string) ?? null,
    defaultValue: (d.defaultValue as string) ?? null,
    hrEnumValues: (d.hrEnumValues as Record<string, string>) ?? {},
    invertedHr: (d.invertedHr as boolean) ?? null,
    enumStyle: (d.enumStyle as string) ?? null,
    flagStyle: (d.flagStyle as boolean) ?? null,
    hrSlot: typeof d.hrSlot === 'number' ? (d.hrSlot as number) : null,
    hrHidden: (d.hrHidden as boolean) ?? null,
    omitWhenEmpty: (d.omitWhenEmpty as boolean) ?? null,
    discriminator: (d.discriminator as string) ?? null,
    discriminatorValues,
    visibleWhen: vw ? { param: vw.param as string, values: (vw.values as string[]) ?? [] } : null,
    hrLabelWhen: hlw.map((x) => ({
      param: x.param as string,
      values: (x.values as string[]) ?? [],
      hrLabel: (x.hrLabel as string) ?? null,
    })),
    raw: d,
  };
}

function buildEntry(entry: StepCatalogEntry): GrammarEntry {
  const params = (entry.params as unknown as Record<string, unknown>[]) ?? [];
  return {
    name: entry.name,
    id: entry.id ?? 0,
    params: params.map(buildParam),
    blockRole: entry.blockPair?.role ?? null,
  };
}

// ---------------------------------------------------------------------------
// Grammar registry — populated once from the fetched catalog (see loadCatalog in
// hr-to-xml.ts). xmlToHr reads step rules from here.
// ---------------------------------------------------------------------------
const grammarRegistry = new Map<string, GrammarEntry>();

/** Build grammar entries from the catalog and register them (idempotent per call). */
export function initGrammar(catalog: StepCatalogEntry[]): void {
  for (const entry of catalog) {
    grammarRegistry.set(entry.name, buildEntry(entry));
  }
}

export function getGrammarEntry(name: string): GrammarEntry | undefined {
  return grammarRegistry.get(name);
}

/**
 * FileMaker's universal step-type id for `name` (the `<Step id="N">` constant),
 * resolved from the loaded catalog — 0 when the catalog isn't loaded or the name
 * is unknown. Mirrors the reference converter's own step-id lookup; shared so the
 * HR→XML emit path and control-flow hand-coders write the same real id FM does.
 */
export function resolveStepId(name: string): number {
  return grammarRegistry.get(name)?.id ?? 0;
}

// ---------------------------------------------------------------------------
// Discriminator / visibility predicates (mirror the reference + Python port)
// ---------------------------------------------------------------------------
export function isGoverningDiscriminator(param: GrammarParam): boolean {
  return param.type === 'enum' && Object.keys(param.discriminatorValues).length > 0;
}

export function isDrivenDiscriminator(entry: GrammarEntry, param: GrammarParam): boolean {
  if (!param.xmlElement) return false;
  return entry.params.some((q) => q.type === 'layout' && q.discriminator === param.xmlElement);
}

/** Whether governing discriminator `discrim`'s XML `value` reveals companion `elem`. */
export function valueRevealsCompanion(
  discrim: GrammarParam,
  value: string,
  elem: string,
): boolean {
  const branch = discrim.discriminatorValues[value];
  if (branch === undefined) return false;
  return branch.reveal.includes(elem);
}

/**
 * Every label a param's HR token may carry — its base hrLabel plus any
 * `hrLabelWhen` variant labels — longest first (lexicographic tiebreak) with
 * duplicates removed. Ports the reference converter's candidate-label rule; the HR parse
 * matcher tries each so a variant-labeled value round-trips.
 */
export function candidateHrLabels(param: GrammarParam): string[] {
  const labels: string[] = [];
  if (param.hrLabel) labels.push(param.hrLabel);
  for (const v of param.hrLabelWhen) if (v.hrLabel) labels.push(v.hrLabel);
  labels.sort((a, b) => (a.length !== b.length ? b.length - a.length : a < b ? -1 : a > b ? 1 : 0));
  return labels.filter((l, i) => i === 0 || l !== labels[i - 1]);
}

export function governingDiscriminatorFor(
  entry: GrammarEntry,
  companion: GrammarParam,
): GrammarParam | null {
  if (!companion.xmlElement) return null;
  const ck = paramKey(companion);
  for (const p of entry.params) {
    if (p === companion || !isGoverningDiscriminator(p)) continue;
    for (const branch of Object.values(p.discriminatorValues)) {
      if (branch.reveal.includes(ck)) return p;
    }
  }
  return null;
}

function readEnumRawValue(step: Element, p: GrammarParam): string {
  const base = !p.parentElement ? step : descendPath(step, p.parentElement);
  if (p.enumStyle === 'text') return childText(base, p.xmlElement);
  const attr = p.xmlAttr || 'value';
  return childAttr(base, p.xmlElement, attr);
}

function effectiveHrLabel(entry: GrammarEntry, step: Element, param: GrammarParam): string {
  for (const variant of param.hrLabelWhen) {
    for (const q of entry.params) {
      if (paramKey(q) !== variant.param) continue;
      const v = readEnumRawValue(step, q) || (q.defaultValue || '');
      if (variant.values.includes(v)) return variant.hrLabel || '';
      break;
    }
  }
  return param.hrLabel || '';
}

function paramVisible(entry: GrammarEntry, step: Element, param: GrammarParam): boolean {
  const vw = param.visibleWhen;
  if (vw === null || !vw.param) return true;
  for (const q of entry.params) {
    if (paramKey(q) !== vw.param) continue;
    const v = readEnumRawValue(step, q) || (q.defaultValue || '');
    return vw.values.includes(v);
  }
  return true;
}

/** Indices in HR render order — catalog order unless some param sets hrSlot. */
export function hrParamOrder(entry: GrammarEntry): number[] {
  const order = entry.params.map((_, i) => i);
  if (!entry.params.some((p) => p.hrSlot !== null && p.hrSlot >= 0)) return order;
  // Stable sort by hrSlot (falling back to catalog index) — mirrors Python's
  // stable `sorted`; JS Array.sort is stable per spec (ES2019+).
  return order.sort((a, b) => {
    const sa = entry.params[a].hrSlot;
    const sb = entry.params[b].hrSlot;
    const ka = sa !== null && sa >= 0 ? sa : a;
    const kb = sb !== null && sb >= 0 ? sb : b;
    return ka - kb;
  });
}

// ---------------------------------------------------------------------------
// Group / repeat / list renderers
// ---------------------------------------------------------------------------
function renderGroupElement(node: Element, fields: Record<string, unknown>[]): string {
  const parts: string[] = [];
  for (const f of fields) {
    const kind = (f.kind as string) ?? '';
    const key = (f.key as string) ?? '';
    if (kind === 'attr') {
      const a = node.getAttribute((f.xmlAttr as string) ?? '');
      if (a !== null) parts.push(key + '=' + groupQuoteValue(a));
    } else if (kind === 'text') {
      const child = findChild(node, (f.childElement as string) ?? '');
      if (child !== null) parts.push(key + '=' + groupQuoteValue(elemText(child)));
    } else if (kind === 'calc') {
      const childEl = (f.childElement as string) ?? '';
      if (!childEl) {
        const c = findChild(node, 'Calculation');
        if (c !== null) parts.push(key + '=' + elemText(c));
      } else {
        const child = findChild(node, childEl);
        if (child !== null) parts.push(key + '=' + childText(child, 'Calculation'));
      }
    } else if (kind === 'field') {
      const fld = findChild(node, 'Field');
      if (fld !== null) {
        const table = fld.getAttribute('table') ?? '';
        const name = fld.getAttribute('name') ?? '';
        if (name) parts.push(key + '=' + (!table ? name : table + '::' + name));
      }
    } else if (kind === 'script') {
      const sc = findChild(node, (f.element as string) ?? '');
      if (sc !== null) {
        const name = sc.getAttribute('name') ?? '';
        if (name) parts.push(key + '=' + groupQuoteValue(name));
      }
    } else if (kind === 'fieldOrVariable') {
      const fld = findChild(node, 'Field');
      if (fld !== null) {
        const text = elemText(fld).trim();
        if (text) {
          parts.push(key + '=' + groupQuoteValue(text));
        } else {
          const table = fld.getAttribute('table') ?? '';
          const name = fld.getAttribute('name') ?? '';
          if (name) {
            const ref = !table ? name : table + '::' + name;
            parts.push(key + '=' + groupQuoteValue(ref));
          }
        }
      }
    } else if (kind === 'group') {
      const sub = findChild(node, (f.element as string) ?? '');
      if (sub !== null) {
        parts.push(
          key + '=(' + renderGroupElement(sub, (f.fields as Record<string, unknown>[]) ?? []) + ')',
        );
      }
    }
  }
  return joinWithComma(parts);
}

function renderRepeatGroup(container: Element, param: GrammarParam): string {
  const entryEl = (param.raw.entryElement as string) ?? '';
  const fields = (param.raw.fields as Record<string, unknown>[]) ?? [];
  const entries = findChildren(container, entryEl).map((e) => renderGroupElement(e, fields));
  return entries.join(' | ');
}

function renderFieldList(container: Element, param: GrammarParam): string {
  const entryEl = (param.raw.entryElement as string) ?? '';
  const entryAttr = (param.raw.entryAttr as string) ?? '';
  const fieldWrapper = (param.raw.fieldWrapper as string) ?? '';
  const tokens: string[] = [];

  const emit = (entryNode: Element | null, fieldNode: Element | null): void => {
    if (fieldNode === null) return;
    const table = fieldNode.getAttribute('table') ?? '';
    const name = fieldNode.getAttribute('name') ?? '';
    const fieldref = !name ? '' : !table ? name : table + '::' + name;
    let token = groupQuoteValue(fieldref);
    if (entryAttr) {
      const attrNode = !entryEl ? fieldNode : entryNode;
      if (attrNode !== null) token += '=' + (attrNode.getAttribute(entryAttr) ?? '');
    }
    tokens.push(token);
  };

  if (entryEl) {
    for (const e of findChildren(container, entryEl)) {
      let fld: Element | null;
      if (fieldWrapper) {
        const w = findChild(e, fieldWrapper);
        fld = w !== null ? findChild(w, 'Field') : null;
      } else {
        fld = findChild(e, 'Field');
      }
      emit(e, fld);
    }
  } else {
    for (const fld of findChildren(container, 'Field')) emit(null, fld);
  }
  return tokens.join(', ');
}

// ---------------------------------------------------------------------------
// Bitmask helpers
// ---------------------------------------------------------------------------
function bitmaskStyleByXml(
  param: GrammarParam,
  v: string,
): Record<string, unknown> | null {
  for (const s of (param.raw.bitmaskStyles as Record<string, unknown>[]) ?? []) {
    if (s.xmlValue === v) return s;
  }
  return null;
}

function bitmaskMaskForFlags(param: GrammarParam, labels: string[]): number {
  let m = 0;
  for (const lbl of labels) {
    for (const f of (param.raw.bitmaskFlags as Record<string, unknown>[]) ?? []) {
      if (ciEquals((f.hrLabel as string) ?? '', lbl)) {
        m |= (f.bit as number) ?? 0;
        break;
      }
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Per-param HR fragment
// ---------------------------------------------------------------------------
/** Compute one param's HR fragment ('' = no token), as the reference does. */
export function computeParamHr(entry: GrammarEntry, step: Element, param: GrammarParam): string {
  let val = '';
  let base = !param.parentElement ? step : descendPath(step, param.parentElement);
  if (base === null) base = step; // a missing wrapper reads nothing; keep base usable
  const [isElemAttr, g11Elem, g11Attr] = splitElementAttr(param.xmlElement);
  const label = param.hrLabel || '';
  const ptype = param.type;

  if (ptype === 'boolean') {
    const battr = isElemAttr ? g11Attr : param.xmlAttr || 'state';
    const belem = isElemAttr ? g11Elem : param.xmlElement;
    const state = childAttr(base, belem, battr);
    if (state) {
      let stateTrue = state === 'True';
      if (param.invertedHr) stateTrue = !stateTrue;
      if (param.flagStyle) {
        if (stateTrue && label) val = label;
      } else if (Object.keys(param.hrEnumValues).length > 0) {
        val = param.hrEnumValues[state] ?? (stateTrue ? 'On' : 'Off');
        if (label) val = label + ': ' + val;
      } else {
        val = stateTrue ? 'On' : 'Off';
        if (label) val = label + ': ' + val;
      }
    }
  } else if (ptype === 'enum' && isDrivenDiscriminator(entry, param)) {
    // silent companion of a layout param
  } else if (ptype === 'enum') {
    if (param.enumStyle === 'text') {
      val = childText(base, param.xmlElement);
    } else {
      const eattr = isElemAttr ? g11Attr : param.xmlAttr || 'value';
      const eelem = isElemAttr ? g11Elem : param.xmlElement;
      val = childAttr(base, eelem, eattr);
    }
    if (!param.flagStyle && Object.keys(param.hrEnumValues).length > 0) {
      const mapped = param.hrEnumValues[val];
      if (mapped) val = mapped;
    }
    if (param.flagStyle) {
      val = val && val !== (param.defaultValue || '') && label ? label : '';
    } else if (val && label) {
      val = label + ': ' + val;
    }
  } else if (ptype === 'calculation') {
    val = childText(base, 'Calculation');
    if (val && param.omitWhenEmpty && label) val = label + ': ' + val;
  } else if (ptype === 'attrGroup') {
    const groupNode = findChild(base, param.xmlElement);
    if (groupNode !== null) {
      const inner = renderGroupElement(groupNode, (param.raw.fields as Record<string, unknown>[]) ?? []);
      val = !label ? inner : label + ': ' + inner;
    }
  } else if (ptype === 'bitmaskGroup') {
    const g = findChild(base, param.xmlElement);
    const styles = (param.raw.bitmaskStyles as Record<string, unknown>[]) ?? [];
    if (g !== null && styles.length > 0) {
      const xmlStyle = g.getAttribute((param.raw.bitmaskStyleAttr as string) ?? '') ?? '';
      const st = bitmaskStyleByXml(param, xmlStyle) ?? styles[0];
      let chrome = 0;
      for (const f of (param.raw.bitmaskFlags as Record<string, unknown>[]) ?? []) {
        const yn = g.getAttribute((f.xmlAttr as string) ?? '') ?? 'No';
        if (ciEquals(yn, 'Yes')) chrome |= (f.bit as number) ?? 0;
      }
      chrome &= bitmaskMaskForFlags(param, (st.legalFlags as string[]) ?? []);
      const parts: string[] = [];
      if (label) parts.push(label + ': ' + ((st.hrToken as string) ?? ''));
      if (chrome !== bitmaskMaskForFlags(param, (st.defaultFlags as string[]) ?? [])) {
        const lst = ((param.raw.bitmaskFlags as Record<string, unknown>[]) ?? [])
          .filter((f) => chrome & ((f.bit as number) ?? 0))
          .map((f) => (f.hrLabel as string) ?? '');
        const controlsLabel = (param.raw.hrControlsLabel as string) ?? '';
        parts.push(controlsLabel + ': ' + (lst.length > 0 ? lst.join(', ') : 'None'));
      }
      val = parts.join(' ; ');
    }
  } else if (ptype === 'repeatGroup') {
    const container = findChild(base, param.xmlElement);
    if (container !== null) {
      const inner = renderRepeatGroup(container, param);
      if (inner) val = !label ? inner : label + ': ' + inner;
    }
  } else if (ptype === 'fieldList') {
    const container = findChild(base, param.xmlElement);
    if (container !== null) {
      const inner = renderFieldList(container, param);
      if (inner) val = !label ? inner : label + ': ' + inner;
    }
  } else if (ptype === 'namedCalc') {
    const wrapper = param.wrapperElement || param.xmlElement;
    val = nestedText(base, wrapper, 'Calculation');
    if (val) {
      const lbl = effectiveHrLabel(entry, step, param);
      if (lbl) val = lbl + ': ' + val;
    }
  } else if (ptype === 'parametersList') {
    const wrapperName = param.xmlElement || 'Parameters';
    const wrapper = findChild(base, wrapperName);
    if (wrapper !== null) {
      const items = findChildren(wrapper, 'P')
        .map((p) => childText(p, 'Calculation'))
        .filter((t) => t);
      if (items.length > 0) {
        val = joinWithComma(items);
        if (label) val = label + ': ' + val;
      }
    }
  } else if (ptype === 'findRequests') {
    const query = findChild(base, 'Query');
    if (query !== null) {
      const rows: string[] = [];
      for (const rr of findChildren(query, 'RequestRow')) {
        const op = rr.getAttribute('operation') ?? '';
        const crits: string[] = [];
        for (const cr of findChildren(rr, 'Criteria')) {
          const fld = findChild(cr, 'Field');
          const table = fld !== null ? fld.getAttribute('table') ?? '' : '';
          const name = fld !== null ? fld.getAttribute('name') ?? '' : '';
          const text = childText(cr, 'Text');
          let fieldref = '';
          if (name) fieldref = !table ? name : table + '::' + name;
          crits.push(!fieldref ? text : fieldref + ': ' + text);
        }
        let joined = crits.join(' & ');
        if (op === 'Exclude') joined = 'Omit ' + joined;
        rows.push(joined);
      }
      val = rows.join(' | ');
      if (val && label) val = label + ': ' + val;
    }
  } else if (ptype === 'fieldOrVariable') {
    let fieldNode = findChild(base, param.xmlElement);
    if (fieldNode === null) fieldNode = findChild(base, 'Field');
    if (fieldNode !== null) {
      const table = fieldNode.getAttribute('table') ?? '';
      const name = fieldNode.getAttribute('name') ?? '';
      const text = elemText(fieldNode);
      if (text && text[0] === '$') val = text;
      else if (name) val = !table ? name : table + '::' + name;
      else if (text) val = text;
      if (val && label) val = label + ': ' + val;
    }
  } else if (ptype === 'flagElement') {
    if (findChild(base, param.xmlElement) !== null && label) val = label;
  } else if (ptype === 'calc') {
    val = childText(base, 'Calculation');
  } else if (ptype === 'field') {
    let fieldNode = findChild(base, param.xmlElement);
    if (fieldNode === null) fieldNode = findChild(base, 'Field');
    if (fieldNode !== null) {
      const table = fieldNode.getAttribute('table') ?? '';
      const name = fieldNode.getAttribute('name') ?? '';
      val = !table ? name : table + '::' + name;
    }
  } else if (ptype === 'tableRef' || ptype === 'tableOccurrence') {
    const tableNode = findChild(base, 'Table');
    if (tableNode !== null) {
      const name = tableNode.getAttribute('name') ?? '';
      if (name) val = !label ? name : label + ': ' + name;
    }
  } else if (ptype === 'fileReference') {
    const frNode = findChild(base, param.xmlElement);
    if (frNode !== null) {
      const path = childText(frNode, 'UniversalPathList');
      if (path) val = !label ? path : label + ': ' + path;
    }
  } else if (ptype === 'reference') {
    const refNode = findChild(base, param.xmlElement);
    if (refNode !== null) {
      const name = refNode.getAttribute('name') ?? '';
      if (name) val = !label ? '"' + name + '"' : label + ': ' + name;
    }
  } else if (ptype === 'layout') {
    const layoutNode = findChild(base, 'Layout');
    if (param.discriminator) {
      const dest = childAttr(base, param.discriminator, 'value');
      if (ciEquals(dest, 'OriginalLayout')) val = 'original layout';
      else if (ciEquals(dest, 'CurrentLayout')) val = 'current layout';
      else if (ciEquals(dest, 'LayoutNameByCalc')) val = 'by name: ' + childText(layoutNode, 'Calculation');
      else if (ciEquals(dest, 'LayoutNumberByCalc')) val = 'by number: ' + childText(layoutNode, 'Calculation');
      else {
        const name = layoutNode !== null ? layoutNode.getAttribute('name') ?? '' : '';
        if (name) val = '"' + name + '"';
      }
    } else if (layoutNode !== null || param.required) {
      const name = layoutNode !== null ? layoutNode.getAttribute('name') ?? '' : '';
      let tok = '';
      if (name) tok = '"' + name + '"';
      else if (param.required) tok = '<unknown>';
      if (tok) val = !label ? tok : label + ': ' + tok;
    }
  } else if (ptype === 'script') {
    const scriptNode = findChild(base, 'Script');
    if (scriptNode !== null) {
      const name = scriptNode.getAttribute('name') ?? '';
      if (name) val = '"' + name + '"';
    }
  } else if (ptype === 'text' || ptype === 'name') {
    val = childText(base, param.xmlElement);
    if (val && param.parentElement && label) val = label + ': ' + val;
  }

  return val;
}

/** Render a governing discriminator's HR fragment. Port of RenderDiscriminatorGroup. */
function renderDiscriminatorGroup(entry: GrammarEntry, step: Element, param: GrammarParam): string {
  const value = readEnumRawValue(step, param) || (param.defaultValue || '');
  const branch = param.discriminatorValues[value];
  if (branch === undefined) {
    const mapped = param.hrEnumValues[value] || value;
    const label = param.hrLabel || '';
    return !label ? mapped : label + ': ' + mapped;
  }
  if (branch.hrToken) return branch.hrToken;
  const parts: string[] = [];
  if (branch.labeled && param.hrLabel) {
    const mapped = param.hrEnumValues[value] || value;
    parts.push(param.hrLabel + ': ' + mapped);
  }
  for (const elem of branch.reveal) {
    for (const c of entry.params) {
      if (paramKey(c) !== elem) continue;
      const v = computeParamHr(entry, step, c);
      if (v) parts.push(v);
      break;
    }
  }
  return parts.join(' ; ');
}

/**
 * Render a full step to its HR bracket line, as the reference does.
 * Returns `entry.name` alone when no param contributes a token, else
 * `Name [ tok ; tok ; … ]`. Does not handle control-flow steps.
 */
export function renderStepHr(entry: GrammarEntry, step: Element): string {
  const parts: string[] = [];
  for (const pi of hrParamOrder(entry)) {
    const param = entry.params[pi];
    if (param.hrHidden) continue;
    if (governingDiscriminatorFor(entry, param)) continue;
    if (!paramVisible(entry, step, param)) continue;
    const val = isGoverningDiscriminator(param)
      ? renderDiscriminatorGroup(entry, step, param)
      : computeParamHr(entry, step, param);
    if (val) parts.push(val);
  }
  if (parts.length === 0) return entry.name;
  return entry.name + ' [ ' + parts.join(' ; ') + ' ]';
}
