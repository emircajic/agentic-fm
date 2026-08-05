/**
 * catalog-emit.ts — the shared catalog grammar engine, HR→XML direction (TS port).
 *
 * A faithful TypeScript port of the reference converter's HR→fmxmlsnippet path
 * (its HR-param matcher, its step orchestrator and every per-type emit helper): parse an
 * HR bracket line into per-param values (two-phase label/flag then positional),
 * then emit the step's XML in **catalog param order** with the full grammar —
 * discriminators, attrGroup/repeatGroup/fieldList/findRequests/parametersList,
 * bitmaskGroup packing, wrapper (parentElement) stacks, and the G10/G11 attribute
 * grammars.
 *
 * The inverse of catalog-grammar.ts (XML→HR). Both read the same catalog grammar
 * model (`GrammarEntry`/`GrammarParam`, incl. the untyped `raw` facet tail) and
 * are kept deliberately parallel to the Python port and the reference so a facet added to
 * one direction is obviously missing from the other (plan's structural-parity
 * risk). Control-flow steps are NOT emitted here — they stay hand-coded in
 * steps/control.ts (the sanctioned exception).
 */

import type { ParsedLine } from './parser';
import type { IdResolver } from './id-resolver';
import { cdata, escXml } from './step-registry';
import {
  type GrammarEntry,
  type GrammarParam,
  paramKey,
  isGoverningDiscriminator,
  isDrivenDiscriminator,
  governingDiscriminatorFor,
  valueRevealsCompanion,
  candidateHrLabels,
  hrParamOrder,
} from './catalog-grammar';

// ---------------------------------------------------------------------------
// String helpers — ported to match the reference exactly (Trim strips only
// spaces/tabs, not newlines, so multi-line calcs survive).
// ---------------------------------------------------------------------------
function trim(s: string): string {
  return s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
}

function ciEquals(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function startsWithCi(s: string, prefix: string): boolean {
  return s.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
}

/** G11 'Elem/@attr' notation → [true, 'Elem', 'attr']; else [false, '', '']. */
function splitElementAttr(xmlElement: string): [boolean, string, string] {
  const pos = xmlElement.indexOf('/@');
  if (pos === -1) return [false, '', ''];
  return [true, xmlElement.slice(0, pos), xmlElement.slice(pos + 2)];
}

/** Attribute-value escaping: like escXml but numeric-refs whitespace (FM `&#9;`). */
function escXmlAttr(s: string): string {
  let r = '';
  for (const c of s) {
    switch (c) {
      case '&': r += '&amp;'; break;
      case '<': r += '&lt;'; break;
      case '>': r += '&gt;'; break;
      case '"': r += '&quot;'; break;
      case '\t': r += '&#9;'; break;
      case '\n': r += '&#10;'; break;
      case '\r': r += '&#13;'; break;
      default: r += c;
    }
  }
  return r;
}

/** Split on top-level commas, respecting paren/bracket/brace depth + quotes. */
function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  if (!s) return out;
  let cur = '';
  let paren = 0, bracket = 0, brace = 0;
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      cur += c;
      if (c === '"') {
        if (i + 1 < s.length && s[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      }
      continue;
    }
    if (c === '"') { inQuote = true; cur += c; continue; }
    if (c === '(') paren++;
    else if (c === ')') { if (paren > 0) paren--; }
    else if (c === '[') bracket++;
    else if (c === ']') { if (bracket > 0) bracket--; }
    else if (c === '{') brace++;
    else if (c === '}') { if (brace > 0) brace--; }
    if (c === ',' && paren === 0 && bracket === 0 && brace === 0) {
      const item = trim(cur);
      if (item) out.push(item);
      cur = '';
      continue;
    }
    cur += c;
  }
  const tail = trim(cur);
  if (tail) out.push(tail);
  return out;
}

/** Split `s` on every top-level occurrence of multi-char `delim` (quote-aware). */
function splitOnDelim(s: string, delim: string): string[] {
  const out: string[] = [];
  if (!delim) { out.push(s); return out; }
  let start = 0;
  let inQuote = false;
  let i = 0;
  while (i + delim.length <= s.length) {
    if (s[i] === '"') { inQuote = !inQuote; i++; continue; }
    if (!inQuote && s.slice(i, i + delim.length) === delim) {
      const piece = trim(s.slice(start, i));
      if (piece) out.push(piece);
      i += delim.length;
      start = i;
      continue;
    }
    i++;
  }
  const tail = trim(s.slice(start));
  if (tail) out.push(tail);
  return out;
}

/** Split a fieldList body on top-level commas, PRESERVING empty entries. */
function splitListEntries(s: string): string[] {
  const out: string[] = [];
  if (!trim(s)) return out;
  let cur = '';
  let paren = 0, bracket = 0, brace = 0;
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      cur += c;
      if (c === '"') {
        if (i + 1 < s.length && s[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      }
      continue;
    }
    if (c === '"') { inQuote = true; cur += c; continue; }
    if (c === '(') paren++;
    else if (c === ')') { if (paren > 0) paren--; }
    else if (c === '[') bracket++;
    else if (c === ']') { if (bracket > 0) bracket--; }
    else if (c === '{') brace++;
    else if (c === '}') { if (brace > 0) brace--; }
    if (c === ',' && paren === 0 && bracket === 0 && brace === 0) {
      out.push(trim(cur));
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(trim(cur));
  return out;
}

/** Split a parentElement path into wrapper segments (empty path → no segments). */
function splitPath(path: string): string[] {
  return (path ?? '').split('/').filter((seg) => seg.length > 0);
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

function lowerKey(k: string): string {
  return k.toLowerCase();
}

function stripParens(s: string): string {
  const t = trim(s);
  if (t.length >= 2 && t.startsWith('(') && t.endsWith(')')) return trim(t.slice(1, -1));
  return t;
}

/** A target string is a variable ($local / $$global) when its first non-blank char is '$'. */
function isVariable(s: string): boolean {
  const t = s.replace(/^[ \t]+/, '');
  return t.length > 0 && t[0] === '$';
}

/**
 * True when `s`, after trimming and stripping one layer of matching quotes
 * (straight "…" or smart “…”), is a single variable token; returns the bare
 * variable via the tuple's second element.
 */
function isQuotedLoneVariable(v: string): [boolean, string] {
  let t = trim(v);
  const lq = '“', rq = '”';
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    t = t.slice(1, -1);
  } else if (t.length >= 2 && t.startsWith(lq) && t.endsWith(rq)) {
    t = t.slice(1, -1);
  } else {
    return [false, ''];
  }
  if (!t || t[0] !== '$') return [false, ''];
  if (/[ \t"]/.test(t)) return [false, ''];
  return [true, t];
}

// ---------------------------------------------------------------------------
// Group-value quoting (attr / text kinds) — mirrors the XML→HR side.
// ---------------------------------------------------------------------------
function groupUnquoteValue(v: string): string {
  if (v.length < 2 || v[0] !== '"' || v[v.length - 1] !== '"') return v;
  let out = '';
  const last = v.length - 1;
  for (let i = 1; i < last; i++) {
    if (v[i] === '"' && i + 1 < last && v[i + 1] === '"') { out += '"'; i++; }
    else out += v[i];
  }
  return out;
}

/** Parse one group body ("k1=v1, k2=(…)") into a lower-cased key→raw-value map. */
function parseGroupKV(body: string): Map<string, string> {
  const kv = new Map<string, string>();
  for (const item of splitTopLevelCommas(body)) {
    const eq = item.indexOf('=');
    if (eq === -1) { kv.set(lowerKey(trim(item)), ''); continue; }
    kv.set(lowerKey(trim(item.slice(0, eq))), trim(item.slice(eq + 1)));
  }
  return kv;
}

// ---------------------------------------------------------------------------
// Raw-facet accessors (the untyped tail on GrammarParam.raw).
// ---------------------------------------------------------------------------
type Rec = Record<string, unknown>;
function rawStr(r: Rec, k: string): string {
  const v = r[k];
  return typeof v === 'string' ? v : '';
}
function rawBool(r: Rec, k: string): boolean {
  return r[k] === true;
}
function rawNum(r: Rec, k: string): number {
  const v = r[k];
  return typeof v === 'number' ? v : 0;
}
function rawArr(r: Rec, k: string): Rec[] {
  const v = r[k];
  return Array.isArray(v) ? (v as Rec[]) : [];
}
function rawStrArr(r: Rec, k: string): string[] {
  const v = r[k];
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : [];
}

// ---------------------------------------------------------------------------
// Table resolution — the TS IdResolver has no resolveTable; offline (no context)
// a name resolves to id 0 with the name passed through, matching the reference's
// empty-context behaviour (both corpus Table refs are the unconfigured default).
// ---------------------------------------------------------------------------
function resolveTable(name: string): { toId: number; toName: string } {
  return { toId: 0, toName: name };
}

// ---------------------------------------------------------------------------
// Value resolvers (HR token → XML value)
// ---------------------------------------------------------------------------
function resolveEnumXmlValue(param: GrammarParam, hrValue: string): string {
  const enumValues = rawStrArr(param.raw, 'enumValues');
  if (param.flagStyle) {
    const flagged =
      hrValue === 'True' ||
      (hrValue !== '' && !!param.hrLabel && ciEquals(hrValue, param.hrLabel));
    if (flagged) {
      for (const v of enumValues) if (v !== (param.defaultValue ?? '')) return v;
    }
    return param.defaultValue ?? '';
  }
  // Reverse the hrEnumValues map (FM-friendly HR token → raw XML value). std::map
  // iterates keys ascending; sort to match on a (rare) shared-label collision.
  if (Object.keys(param.hrEnumValues).length > 0 && hrValue !== '') {
    for (const k of Object.keys(param.hrEnumValues).sort()) {
      const label = param.hrEnumValues[k];
      if (label && ciEquals(label, hrValue)) return k;
    }
  }
  return hrValue === '' ? (param.defaultValue ?? '') : hrValue;
}

function resolveBoolState(param: GrammarParam, hrValue: string): string {
  let state = param.defaultValue ? param.defaultValue : 'False';
  if (hrValue !== '') {
    const lower = hrValue.toLowerCase();
    let hrMeansTrue: boolean;
    if (lower === 'on' || lower === 'true' || lower === 'yes') {
      hrMeansTrue = true;
    } else if (lower === 'off' || lower === 'false' || lower === 'no') {
      hrMeansTrue = false;
    } else {
      hrMeansTrue = state === 'True';
      for (const xmlState of Object.keys(param.hrEnumValues).sort()) {
        if (param.hrEnumValues[xmlState].toLowerCase() === lower) {
          hrMeansTrue = xmlState === 'True';
          break;
        }
      }
    }
    if (param.invertedHr) hrMeansTrue = !hrMeansTrue;
    state = hrMeansTrue ? 'True' : 'False';
  }
  return state;
}

/** Whether a param renders bare (positional) in HR — the pass-2 eligibility test. */
function rendersBareInHr(param: GrammarParam): boolean {
  if (!param.hrLabel) return true;
  if (param.type === 'calc' || param.type === 'field' || param.type === 'script') return true;
  if (param.type === 'layout') return !param.hrLabel;
  if ((param.type === 'text' || param.type === 'name') && !param.parentElement) return true;
  if (param.type === 'calculation' && !param.omitWhenEmpty) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Layout token (self-describing) → LayoutDestination value + <Layout> child XML
// ---------------------------------------------------------------------------
function resolveLayoutToken(
  hrValue: string,
  resolver: IdResolver,
): { dest: string; piece: string } {
  const tok = trim(hrValue);
  if (ciEquals(tok, 'original layout') || ciEquals(tok, '<original layout>')) {
    return { dest: 'OriginalLayout', piece: '' };
  }
  if (ciEquals(tok, 'current layout') || ciEquals(tok, '<current layout>')) {
    return { dest: 'CurrentLayout', piece: '' };
  }
  const byCalc = (kw: string, dest: string): { dest: string; piece: string } | null => {
    if (startsWithCi(tok, kw)) {
      const calc = trim(tok.slice(kw.length));
      return {
        dest,
        piece: `    <Layout>\n      <Calculation>${cdata(calc)}</Calculation>\n    </Layout>`,
      };
    }
    return null;
  };
  let r = byCalc('by name:', 'LayoutNameByCalc');
  if (r) return r;
  r = byCalc('by number:', 'LayoutNumberByCalc');
  if (r) return r;
  {
    const [quoted, loneVar] = isQuotedLoneVariable(tok);
    let calc = '';
    if (quoted) calc = loneVar;
    else if (isVariable(tok)) calc = tok;
    if (calc) {
      return {
        dest: 'LayoutNameByCalc',
        piece: `    <Layout>\n      <Calculation>${cdata(calc)}</Calculation>\n    </Layout>`,
      };
    }
  }
  const resolved = resolver.resolveLayout(unquote(tok));
  const piece =
    resolved.id === 0 && resolved.name
      ? `    <Layout name="${escXml(resolved.name)}"/>`
      : `    <Layout id="${resolved.id}" name="${escXml(resolved.name)}"/>`;
  return { dest: 'SelectedLayout', piece };
}

// ---------------------------------------------------------------------------
// Two-phase HR-param matching (parse-HR): pass 1 flags/labels, pass 2 positional.
// ---------------------------------------------------------------------------
function matchParamValues(entry: GrammarEntry, hrParams: string[]): string[] {
  const values: string[] = new Array(entry.params.length).fill('');
  const resolved: boolean[] = new Array(entry.params.length).fill(false);
  const consumed: boolean[] = new Array(hrParams.length).fill(false);

  for (let pi = 0; pi < entry.params.length; pi++) {
    const param = entry.params[pi];
    if (param.hrHidden) { resolved[pi] = true; continue; }
    if (param.type === 'complex') { resolved[pi] = true; continue; }
    if (isDrivenDiscriminator(entry, param)) { resolved[pi] = true; continue; }

    if (param.type === 'bitmaskGroup') {
      resolved[pi] = true;
      let styleVal = '', controlsVal = '';
      let styleFound = false, ctrlPresent = false;
      const controlsLabel = rawStr(param.raw, 'hrControlsLabel');
      const sp = (param.hrLabel ?? '') + ':';
      const cp = controlsLabel + ':';
      for (let i = 0; i < hrParams.length; i++) {
        if (consumed[i]) continue;
        const t = trim(hrParams[i]);
        if (!styleFound && param.hrLabel && startsWithCi(t, sp)) {
          styleVal = trim(t.slice(sp.length)); styleFound = true; consumed[i] = true;
        } else if (!ctrlPresent && controlsLabel && startsWithCi(t, cp)) {
          controlsVal = trim(t.slice(cp.length)); ctrlPresent = true; consumed[i] = true;
        }
      }
      values[pi] = styleVal;
      if (ctrlPresent) values[pi] += '\x1e' + controlsVal;
      continue;
    }

    if (isGoverningDiscriminator(param)) {
      resolved[pi] = true;
      for (let i = 0; i < hrParams.length && values[pi] === ''; i++) {
        if (consumed[i]) continue;
        const t = trim(hrParams[i]);
        for (const [value, spec] of Object.entries(param.discriminatorValues)) {
          if (spec.hrToken && ciEquals(t, spec.hrToken)) {
            consumed[i] = true;
            values[pi] = value;
            break;
          }
        }
      }
      // Claim the enum's own "hrLabel: value" token (Set Web Viewer "Action: …").
      if (values[pi] === '' && param.hrLabel) {
        const prefix = param.hrLabel + ':';
        for (let i = 0; i < hrParams.length; i++) {
          if (consumed[i]) continue;
          const t = trim(hrParams[i]);
          if (startsWithCi(t, prefix)) {
            consumed[i] = true;
            values[pi] = resolveEnumXmlValue(param, trim(t.slice(prefix.length)));
            break;
          }
        }
      }
      continue;
    }

    const isFlag = (param.flagStyle || param.type === 'flagElement') && !!param.hrLabel;
    if (isFlag) {
      resolved[pi] = true;
      for (let i = 0; i < hrParams.length; i++) {
        if (consumed[i]) continue;
        if (ciEquals(trim(hrParams[i]), param.hrLabel!)) {
          consumed[i] = true;
          values[pi] = 'True';
          break;
        }
      }
      continue;
    }

    if (param.hrLabel) {
      for (const label of candidateHrLabels(param)) {
        const prefix = label + ':';
        for (let i = 0; i < hrParams.length; i++) {
          if (consumed[i]) continue;
          const t = trim(hrParams[i]);
          if (startsWithCi(t, prefix)) {
            consumed[i] = true;
            values[pi] = trim(t.slice(prefix.length));
            resolved[pi] = true;
            break;
          }
        }
        if (resolved[pi]) break;
      }
    }
  }

  // Pass 2 — positional for the remaining bare-rendering params, in HR order.
  let pos = 0;
  for (const pi of hrParamOrder(entry)) {
    if (resolved[pi]) continue;
    if (!rendersBareInHr(entry.params[pi])) continue;
    const gov = governingDiscriminatorFor(entry, entry.params[pi]);
    if (gov) {
      const gi = entry.params.indexOf(gov);
      const gval = values[gi] === '' ? (gov.defaultValue ?? '') : values[gi];
      if (!valueRevealsCompanion(gov, gval, paramKey(entry.params[pi]))) continue;
    }
    while (pos < hrParams.length && consumed[pos]) pos++;
    if (pos < hrParams.length) {
      consumed[pos] = true;
      values[pi] = trim(hrParams[pos]);
      resolved[pi] = true;
      pos++;
    }
  }

  return values;
}

// ---------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------
function emitBoolean(param: GrammarParam, hrValue: string): string {
  const state = resolveBoolState(param, hrValue);
  const attr = param.xmlAttr || 'state';
  return `    <${param.xmlElement} ${attr}="${state}"/>`;
}

function emitEnum(param: GrammarParam, hrValue: string): string {
  const value = resolveEnumXmlValue(param, hrValue);
  if (param.enumStyle === 'text') {
    return `    <${param.xmlElement}>${escXml(value)}</${param.xmlElement}>`;
  }
  const attr = param.xmlAttr || 'value';
  return `    <${param.xmlElement} ${attr}="${escXml(value)}"/>`;
}

function emitNamedCalc(param: GrammarParam, hrValue: string): string {
  const wrapper = param.wrapperElement || param.xmlElement;
  const wa = rawStr(param.raw, 'wrapperAttr');
  const openAttr = wa ? ' ' + wa : '';
  return `    <${wrapper}${openAttr}>\n      <Calculation>${cdata(hrValue)}</Calculation>\n    </${wrapper}>`;
}

function emitParametersList(param: GrammarParam, hrValue: string): string {
  if (!trim(hrValue)) return '';
  const items = splitTopLevelCommas(hrValue);
  if (items.length === 0) return '';
  const wrapper = param.xmlElement || 'Parameters';
  let out = `    <${wrapper} Count="${items.length}">\n`;
  for (const item of items) {
    out += '      <P>\n';
    out += `        <Calculation>${cdata(item)}</Calculation>\n`;
    out += '      </P>\n';
  }
  out += `    </${wrapper}>`;
  return out;
}

function emitFindRequests(hrValue: string, resolver: IdResolver): string {
  const v = trim(hrValue);
  if (!v) return '';
  const rows = splitOnDelim(v, ' | ');
  if (rows.length === 0) return '';
  let out = '    <Query>\n';
  for (const row of rows) {
    let r = trim(row);
    let op = 'Include';
    if (startsWithCi(r, 'Omit ')) { op = 'Exclude'; r = trim(r.slice(5)); }
    else if (startsWithCi(r, 'Include ')) { r = trim(r.slice(8)); }
    out += `      <RequestRow operation="${op}">\n`;
    const crits = splitOnDelim(r, ' & ');
    if (crits.length === 0) crits.push('');
    for (const crit of crits) {
      const c = trim(crit);
      let field = '', text = '';
      const colon = c.indexOf(': ');
      if (colon !== -1) { field = trim(c.slice(0, colon)); text = trim(c.slice(colon + 2)); }
      else text = c;
      out += '        <Criteria>\n';
      if (!field) {
        out += '          <Field table="" id="0" name=""/>\n';
      } else {
        const rf = resolver.resolveField(field);
        out += `          <Field table="${escXml(rf.table)}" id="${rf.fieldId}" name="${escXml(rf.fieldName)}"/>\n`;
      }
      out += `          <Text>${escXml(text)}</Text>\n`;
      out += '        </Criteria>\n';
    }
    out += '      </RequestRow>\n';
  }
  out += '    </Query>';
  return out;
}

function emitFieldOrVariable(
  param: GrammarParam,
  hrValue: string,
  resolver: IdResolver,
  precededByTextElement: boolean,
): string {
  if (!hrValue) {
    if (rawBool(param.raw, 'emitEmptyDefault')) return '    <Field table="" id="0" name=""/>';
    return '';
  }
  if (isVariable(hrValue)) {
    const trimmed = trim(hrValue);
    let out = '';
    if (!precededByTextElement) out += '    <Text/>\n';
    out += `    <Field>${escXml(trimmed)}</Field>`;
    return out;
  }
  let out = '';
  if (rawBool(param.raw, 'textMarker') && !precededByTextElement) out += '    <Text/>\n';
  const resolved = resolver.resolveField(hrValue);
  out += `    <Field table="${escXml(resolved.table)}" id="${resolved.fieldId}" name="${escXml(resolved.fieldName)}"/>`;
  return out;
}

// ── attrGroup / repeatGroup ──────────────────────────────────────────────────
function emitGroupElement(
  element: string,
  fields: Rec[],
  kv: Map<string, string>,
  indent: string,
  resolver: IdResolver,
): string {
  let attrs = '';
  let children = '';
  const ci = indent + '  ';
  for (const f of fields) {
    const kind = rawStr(f, 'kind');
    const key = rawStr(f, 'key');
    const it = kv.get(lowerKey(key));
    const present = it !== undefined && it !== '';
    if (kind === 'attr') {
      if (rawBool(f, 'optional') && !present) continue;
      const v = present ? groupUnquoteValue(it!) : rawStr(f, 'defaultValue');
      attrs += ` ${rawStr(f, 'xmlAttr')}="${escXmlAttr(v)}"`;
    } else if (kind === 'text') {
      if (present) {
        const el = rawStr(f, 'childElement');
        children += `${ci}<${el}>${escXml(groupUnquoteValue(it!))}</${el}>\n`;
      }
    } else if (kind === 'calc') {
      const requireAttr = rawStr(f, 'requireAttr');
      if (requireAttr) attrs += ` ${requireAttr}="${present ? 'True' : 'False'}"`;
      if (present) {
        const childElement = rawStr(f, 'childElement');
        if (!childElement) {
          children += `${ci}<Calculation>${cdata(it!)}</Calculation>\n`;
        } else {
          children += `${ci}<${childElement}>\n`;
          children += `${ci}  <Calculation>${cdata(it!)}</Calculation>\n`;
          children += `${ci}</${childElement}>\n`;
        }
      }
    } else if (kind === 'field') {
      if (present) {
        const rf = resolver.resolveField(it!);
        children += `${ci}<Field table="${escXml(rf.table)}" id="${rf.fieldId}" name="${escXml(rf.fieldName)}"/>\n`;
      }
    } else if (kind === 'script') {
      if (present) {
        const rs = resolver.resolveScript(groupUnquoteValue(it!));
        children += `${ci}<${rawStr(f, 'element')} id="${rs.id}" name="${escXml(rs.name)}"/>\n`;
      }
    } else if (kind === 'fieldOrVariable') {
      const v = present ? groupUnquoteValue(it!) : '';
      if (v && isVariable(v)) {
        children += `${ci}<Field>${escXml(trim(v))}</Field>\n`;
      } else if (v) {
        const rf = resolver.resolveField(v);
        children += `${ci}<Field table="${escXml(rf.table)}" id="${rf.fieldId}" name="${escXml(rf.fieldName)}"/>\n`;
      } else {
        children += `${ci}<Field table="" id="0" name=""/>\n`;
      }
    } else if (kind === 'group') {
      if (present) {
        children += emitGroupElement(
          rawStr(f, 'element'), rawArr(f, 'fields'),
          parseGroupKV(stripParens(it!)), ci, resolver,
        ) + '\n';
      }
    }
  }
  const open = `${indent}<${element}${attrs}`;
  if (!children) return open + '/>';
  return `${open}>\n${children}${indent}</${element}>`;
}

function emitRepeatGroup(param: GrammarParam, hrValue: string, resolver: IdResolver): string {
  if (!trim(hrValue)) return '';
  const entries = splitOnDelim(hrValue, ' | ');
  let out = `    <${param.xmlElement}>\n`;
  for (const e of entries) {
    out += emitGroupElement(
      rawStr(param.raw, 'entryElement'), rawArr(param.raw, 'fields'),
      parseGroupKV(trim(e)), '      ', resolver,
    ) + '\n';
  }
  out += `    </${param.xmlElement}>`;
  return out;
}

function emitAttrGroup(param: GrammarParam, hrValue: string, resolver: IdResolver): string {
  if (!trim(hrValue) && !param.hrHidden) return '';
  return emitGroupElement(
    param.xmlElement, rawArr(param.raw, 'fields'),
    parseGroupKV(hrValue), '    ', resolver,
  );
}

// ── bitmaskGroup ─────────────────────────────────────────────────────────────
function bitmaskStyleByHr(param: GrammarParam, tok: string): Rec | null {
  for (const s of rawArr(param.raw, 'bitmaskStyles')) {
    if (ciEquals(tok, rawStr(s, 'hrToken'))) return s;
    for (const a of rawStrArr(s, 'aliases')) if (ciEquals(tok, a)) return s;
  }
  return null;
}

function bitmaskMaskForFlags(param: GrammarParam, labels: string[]): number {
  let m = 0;
  for (const lbl of labels) {
    for (const f of rawArr(param.raw, 'bitmaskFlags')) {
      if (ciEquals(rawStr(f, 'hrLabel'), lbl)) { m |= rawNum(f, 'bit'); break; }
    }
  }
  return m;
}

function bitmaskBitForFlag(param: GrammarParam, label: string): number {
  if (!label) return 0;
  for (const f of rawArr(param.raw, 'bitmaskFlags')) {
    if (ciEquals(rawStr(f, 'hrLabel'), label)) return rawNum(f, 'bit');
  }
  return 0;
}

function computeBitmaskInteger(param: GrammarParam, style: Rec, chrome: number): number {
  let v = rawNum(param.raw, 'bitmaskBase') | rawNum(style, 'baseBit') | chrome;
  const resizeBit = bitmaskBitForFlag(param, rawStr(param.raw, 'bitmaskResizeFlag'));
  const userResizable = rawBool(style, 'docResizable') && (chrome & resizeBit) !== 0;
  if (!userResizable) v |= rawNum(param.raw, 'bitmaskFixedBit');
  return v >>> 0;
}

function parseControlsMask(param: GrammarParam, list: string): number {
  const v = trim(list);
  if (!v || ciEquals(v, 'None')) return 0;
  let m = 0;
  for (const tok of splitTopLevelCommas(v)) {
    const t = trim(tok);
    for (const f of rawArr(param.raw, 'bitmaskFlags')) {
      if (ciEquals(t, rawStr(f, 'hrLabel'))) { m |= rawNum(f, 'bit'); break; }
    }
  }
  return m;
}

function emitBitmaskGroup(param: GrammarParam, packed: string): string {
  const styles = rawArr(param.raw, 'bitmaskStyles');
  if (styles.length === 0) return '';
  let styleTok = packed, controlsTok = '';
  let ctrlPresent = false;
  const sep = packed.indexOf('\x1e');
  if (sep !== -1) { styleTok = packed.slice(0, sep); controlsTok = packed.slice(sep + 1); ctrlPresent = true; }
  styleTok = trim(styleTok);
  const st = (styleTok === '' ? styles[0] : bitmaskStyleByHr(param, styleTok)) ?? styles[0];
  const legal = bitmaskMaskForFlags(param, rawStrArr(st, 'legalFlags'));
  let chrome = ctrlPresent
    ? parseControlsMask(param, controlsTok)
    : bitmaskMaskForFlags(param, rawStrArr(st, 'defaultFlags'));
  chrome &= legal;
  const integer = computeBitmaskInteger(param, st, chrome);
  const styleAttr = rawStr(param.raw, 'bitmaskStyleAttr');
  const valueAttr = rawStr(param.raw, 'bitmaskValueAttr');
  let out = `    <${param.xmlElement}`;
  for (const attr of rawStrArr(param.raw, 'bitmaskAttrOrder')) {
    if (attr === styleAttr) {
      out += ` ${attr}="${escXmlAttr(rawStr(st, 'xmlValue'))}"`;
    } else if (attr === valueAttr) {
      out += ` ${attr}="${integer}"`;
    } else {
      let on = false;
      for (const f of rawArr(param.raw, 'bitmaskFlags')) {
        if (rawStr(f, 'xmlAttr') === attr) { on = (chrome & rawNum(f, 'bit')) !== 0; break; }
      }
      out += ` ${attr}="${on ? 'Yes' : 'No'}"`;
    }
  }
  out += '/>';
  return out;
}

// ── fieldList ────────────────────────────────────────────────────────────────
function emitFieldList(param: GrammarParam, hrValue: string, resolver: IdResolver): string {
  let cattrs = '';
  for (const f of rawArr(param.raw, 'fields')) {
    cattrs += ` ${rawStr(f, 'xmlAttr')}="${escXmlAttr(rawStr(f, 'defaultValue'))}"`;
  }
  const entryElement = rawStr(param.raw, 'entryElement');
  const fieldWrapper = rawStr(param.raw, 'fieldWrapper');
  const entryAttr = rawStr(param.raw, 'entryAttr');
  const entryAttrDefault = rawStr(param.raw, 'entryAttrDefault');
  const fieldFixedAttrs = rawArr(param.raw, 'fieldFixedAttrs');
  let children = '';
  for (const raw of splitListEntries(hrValue)) {
    const entryStr = trim(raw);
    let fieldref = entryStr;
    let attrval = entryAttrDefault;
    const eq = entryStr.indexOf('=');
    if (eq !== -1) { fieldref = trim(entryStr.slice(0, eq)); attrval = trim(entryStr.slice(eq + 1)); }
    const rf = resolver.resolveField(groupUnquoteValue(fieldref));
    let fattrs = '';
    for (const ff of fieldFixedAttrs) {
      fattrs += ` ${rawStr(ff, 'xmlAttr')}="${escXmlAttr(rawStr(ff, 'defaultValue'))}"`;
    }
    if (entryAttr && !entryElement) fattrs += ` ${entryAttr}="${escXmlAttr(attrval)}"`;
    let node = `<Field${fattrs} table="${escXml(rf.table)}" id="${rf.fieldId}" name="${escXml(rf.fieldName)}"/>`;
    if (fieldWrapper) node = `<${fieldWrapper}>${node}</${fieldWrapper}>`;
    if (entryElement) {
      const eattr = entryAttr ? ` ${entryAttr}="${escXmlAttr(attrval)}"` : '';
      node = `<${entryElement}${eattr}>${node}</${entryElement}>`;
    }
    children += `      ${node}\n`;
  }
  const out = `    <${param.xmlElement}${cattrs}`;
  if (!children) return out + '/>';
  return `${out}>\n${children}    </${param.xmlElement}>`;
}

// ---------------------------------------------------------------------------
// The orchestrator: parse-HR → emit-XML in catalog param order.
// ---------------------------------------------------------------------------
export function convertStepWithCatalog(
  entry: GrammarEntry,
  line: ParsedLine,
  resolver: IdResolver,
): string {
  const params = entry.params;
  let xml = `  <Step enable="${!line.disabled ? 'True' : 'False'}" id="${entry.id}" name="${escXml(entry.name)}">\n`;

  const values = matchParamValues(entry, line.params);

  // G10 attribute-bearing wrapper: a wrapper element may carry an enum value as an
  // attribute (FM serializes <Action value="Queue"> holding children).
  const wrapperAttr = new Map<string, string>();
  const skipParam: boolean[] = new Array(params.length).fill(false);
  {
    const isWrapper = new Set<string>();
    for (const p of params) {
      const segs = splitPath(p.parentElement ?? '');
      if (segs.length > 0) isWrapper.add(segs[0]);
    }
    for (let pi = 0; pi < params.length; pi++) {
      const p = params[pi];
      if (p.type === 'enum' && !p.parentElement && isWrapper.has(p.xmlElement)) {
        const v = values[pi] === '' ? (p.defaultValue ?? '') : values[pi];
        if (v === '') continue;
        const attr = p.xmlAttr || 'value';
        wrapperAttr.set(p.xmlElement, ` ${attr}="${escXml(v)}"`);
        skipParam[pi] = true;
      }
    }
  }

  // G11 attribute-on-element: an enum/boolean param whose xmlElement uses "Elem/@attr"
  // contributes the attribute to the body element emitted by a sibling text/name param.
  const elementAttr = new Map<string, string>();
  for (let pi = 0; pi < params.length; pi++) {
    const p = params[pi];
    const [isEA, elem, attr] = splitElementAttr(p.xmlElement);
    if (!isEA) continue;
    let v: string;
    if (p.type === 'enum') v = resolveEnumXmlValue(p, values[pi]);
    else if (p.type === 'boolean') v = resolveBoolState(p, values[pi]);
    else continue;
    if (v === '') { skipParam[pi] = true; continue; }
    elementAttr.set(elem, (elementAttr.get(elem) ?? '') + ` ${attr}="${escXml(v)}"`);
    skipParam[pi] = true;
  }

  // Discriminator-driven layout: pre-resolve destination + <Layout> piece.
  const discrimValue = new Map<string, string>();
  const layoutPiece = new Map<number, string>();
  for (let pi = 0; pi < params.length; pi++) {
    const p = params[pi];
    if (p.type !== 'layout' || !p.discriminator) continue;
    const { dest, piece } = resolveLayoutToken(values[pi], resolver);
    discrimValue.set(p.discriminator, dest);
    layoutPiece.set(pi, piece);
  }

  // Governing-discriminator pre-pass: resolve each governing enum's XML value.
  const govDiscrimValue = new Map<string, string>();
  for (let pi = 0; pi < params.length; pi++) {
    const p = params[pi];
    if (!isGoverningDiscriminator(p)) continue;
    govDiscrimValue.set(p.xmlElement, values[pi] === '' ? (p.defaultValue ?? '') : values[pi]);
  }

  // Governed-visibility boolean: an `hrHidden` boolean that some sibling's
  // `visibleWhen` gates on carries NO HR token of its own — FileMaker's HR shows
  // none either — so it cannot be read back from HR the way a flag-style boolean
  // can. Its state is instead DERIVED on emit from whether any gated sibling
  // contributed a token, which is exactly how FileMaker's own HR encodes it:
  // Import Records shows Table/method/charset only under Restore=True, and
  // FileMaker discards the stored import order when the flag is off.
  //
  // Without this the flag falls through to its catalog `defaultValue` (True for
  // both Restore params), so HR that says "no stored import order" would
  // serialize as "restore the stored order".
  //
  // The `values[gi] === ''` guard is what keeps the SaXML reader whole: on the
  // HR path a hidden param is excluded from matching so its slot is always
  // empty, but a SaXML decoder may have read the gate's real value from the
  // source (Export Records sets its own Restore), and that reading wins.
  const impliedBool = new Map<number, string>(); // param idx -> state
  for (let gi = 0; gi < params.length; gi++) {
    const gate = params[gi];
    if (!gate.hrHidden || gate.type !== 'boolean' || values[gi] !== '') continue;
    const gateKey = paramKey(gate);
    let onValue = ''; // the gate value that REVEALS a companion
    let gates = false, anyContent = false;
    for (let pi = 0; pi < params.length; pi++) {
      const vw = params[pi].visibleWhen;
      if (!vw || vw.param !== gateKey || vw.values.length === 0) continue;
      gates = true;
      if (onValue === '') onValue = vw.values[0];
      if (trim(values[pi]) !== '') anyContent = true;
    }
    if (!gates) continue; // hrHidden but nothing gates on it: default emit
    const offValue = onValue === 'True' ? 'False' : 'True';
    impliedBool.set(gi, anyContent ? onValue : offValue);
  }

  let prevWasTextElement = false;
  const openGroups: string[] = [];

  for (let pi = 0; pi < params.length; pi++) {
    const param = params[pi];
    const hrValue = values[pi];
    if (skipParam[pi]) continue;

    const isTextElement =
      (param.type === 'text' || param.type === 'name') && param.xmlElement === 'Text';

    let piece = '';
    const gov = governingDiscriminatorFor(entry, param);
    let govHandled = false;
    if (gov) {
      const dval = govDiscrimValue.has(gov.xmlElement)
        ? govDiscrimValue.get(gov.xmlElement)!
        : (gov.defaultValue ?? '');
      const revealed = valueRevealsCompanion(gov, dval, paramKey(param));
      if (param.type === 'boolean' && !revealed && param.omitWhenEmpty) {
        govHandled = true;
      } else if (param.type === 'boolean') {
        const attr = param.xmlAttr || 'state';
        let st: string;
        if (!revealed) st = param.defaultValue ? param.defaultValue : 'False';
        else st = resolveBoolState(param, hrValue === '' ? 'Off' : hrValue);
        piece = `    <${param.xmlElement} ${attr}="${st}"/>`;
        govHandled = true;
      } else if (!revealed) {
        govHandled = true;
      }
    }

    if (govHandled) {
      // piece already decided (a value or intentionally empty).
    } else if (param.type === 'boolean') {
      if (impliedBool.has(pi)) {
        const attr = param.xmlAttr || 'state';
        piece = `    <${param.xmlElement} ${attr}="${impliedBool.get(pi)!}"/>`;
      } else {
        piece = emitBoolean(param, hrValue);
      }
    } else if (param.type === 'enum') {
      if (discrimValue.has(param.xmlElement)) {
        const attr = param.xmlAttr || 'value';
        piece = `    <${param.xmlElement} ${attr}="${escXml(discrimValue.get(param.xmlElement)!)}"/>`;
      } else if (isGoverningDiscriminator(param)) {
        const v = govDiscrimValue.has(param.xmlElement)
          ? govDiscrimValue.get(param.xmlElement)!
          : (param.defaultValue ?? '');
        if (param.enumStyle === 'text') {
          piece = `    <${param.xmlElement}>${escXml(v)}</${param.xmlElement}>`;
        } else {
          const attr = param.xmlAttr || 'value';
          piece = `    <${param.xmlElement} ${attr}="${escXml(v)}"/>`;
        }
      } else if (param.omitWhenEmpty && !trim(hrValue)) {
        // present-driven enum omitted when unset.
      } else {
        piece = emitEnum(param, hrValue);
      }
    } else if (param.type === 'calculation' || param.type === 'calc') {
      if (!param.omitWhenEmpty || trim(hrValue)) {
        piece = `    <Calculation>${cdata(hrValue)}</Calculation>`;
      }
    } else if (param.type === 'attrGroup') {
      piece = emitAttrGroup(param, hrValue, resolver);
    } else if (param.type === 'bitmaskGroup') {
      piece = emitBitmaskGroup(param, hrValue);
    } else if (param.type === 'repeatGroup') {
      piece = emitRepeatGroup(param, hrValue, resolver);
    } else if (param.type === 'fieldList') {
      if (trim(hrValue)) piece = emitFieldList(param, hrValue, resolver);
    } else if (param.type === 'namedCalc') {
      if (hrValue !== '' || param.required) piece = emitNamedCalc(param, hrValue);
    } else if (param.type === 'parametersList') {
      piece = emitParametersList(param, hrValue);
    } else if (param.type === 'findRequests') {
      piece = emitFindRequests(hrValue, resolver);
    } else if (param.type === 'fieldOrVariable') {
      piece = emitFieldOrVariable(param, hrValue, resolver, prevWasTextElement);
    } else if (param.type === 'flagElement') {
      if (hrValue !== '') piece = `    <${param.xmlElement}/>`;
    } else if (param.type === 'field') {
      if (!param.omitWhenEmpty || trim(hrValue)) {
        const resolved = resolver.resolveField(hrValue);
        piece = `    <Field table="${escXml(resolved.table)}" id="${resolved.fieldId}" name="${escXml(resolved.fieldName)}"/>`;
      }
    } else if (param.type === 'tableRef') {
      if (!trim(hrValue)) {
        piece = '    <Table id="" name=""/>';
      } else {
        const rt = resolveTable(unquote(hrValue));
        piece = `    <Table id="${rt.toId}" name="${escXml(rt.toName)}"/>`;
      }
    } else if (param.type === 'tableOccurrence') {
      const rt = resolveTable(unquote(hrValue));
      piece = `    <Table id="${rt.toId}" name="${escXml(rt.toName)}"/>`;
    } else if (param.type === 'fileReference') {
      if (trim(hrValue)) {
        const [quoted, bare] = isQuotedLoneVariable(hrValue);
        const emitValue = quoted ? bare : hrValue;
        piece =
          `    <${param.xmlElement} id="0" name="">\n` +
          `      <UniversalPathList>${escXml(emitValue)}</UniversalPathList>\n    </${param.xmlElement}>`;
      }
    } else if (param.type === 'reference') {
      const name = unquote(hrValue);
      if (name !== '' || param.required) {
        const wa = rawStr(param.raw, 'wrapperAttr');
        const extra = wa ? ' ' + wa : '';
        piece = `    <${param.xmlElement} name="${escXml(name)}"${extra}/>`;
      }
    } else if (param.type === 'layout') {
      if (param.discriminator) {
        if (layoutPiece.has(pi)) piece = layoutPiece.get(pi)!;
      } else {
        const layoutName = unquote(hrValue);
        if (layoutName === '' || ciEquals(layoutName, '<unknown>')) {
          piece = '    <Layout id="0" name=""/>';
        } else {
          const resolved = resolver.resolveLayout(layoutName);
          if (resolved.id === 0 && resolved.name) {
            piece = `    <Layout name="${escXml(resolved.name)}"/>`;
          } else {
            piece = `    <Layout id="${resolved.id}" name="${escXml(resolved.name)}"/>`;
          }
        }
      }
    } else if (param.type === 'script') {
      if (!param.omitWhenEmpty || trim(hrValue)) {
        const scriptName = unquote(hrValue);
        const resolved = resolver.resolveScript(scriptName);
        piece = `    <Script id="${resolved.id}" name="${escXml(resolved.name)}"/>`;
      }
    } else if (param.type === 'text' || param.type === 'name') {
      if (!param.omitWhenEmpty || trim(hrValue)) {
        const [quoted, bare] = isQuotedLoneVariable(hrValue);
        const emitValue = quoted ? bare : hrValue;
        const attrs = elementAttr.get(param.xmlElement) ?? '';
        piece = `    <${param.xmlElement}${attrs}>${escXml(emitValue)}</${param.xmlElement}>`;
      }
    }
    // complex + unhandled types yield no piece.

    if (piece === '') continue;

    // Reconcile the open-wrapper stack with this param's parentElement path.
    const want = splitPath(param.parentElement ?? '');
    let common = 0;
    while (common < openGroups.length && common < want.length && openGroups[common] === want[common]) {
      common++;
    }
    for (let k = openGroups.length; k > common; k--) {
      xml += `    </${openGroups[k - 1]}>\n`;
    }
    openGroups.length = common;
    for (let k = common; k < want.length; k++) {
      const wa = wrapperAttr.get(want[k]) ?? '';
      xml += `    <${want[k]}${wa}>\n`;
      openGroups.push(want[k]);
    }

    xml += piece + '\n';
    prevWasTextElement = isTextElement;
  }

  for (let k = openGroups.length; k > 0; k--) {
    xml += `    </${openGroups[k - 1]}>\n`;
  }

  xml += '  </Step>';
  return xml;
}
