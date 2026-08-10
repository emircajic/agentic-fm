import * as monaco from 'monaco-editor';
import type { StepCatalogEntry } from '@/converter/catalog-types';
import { FM_FUNCTIONS } from './fm-functions';
import { getContext } from '@/context/store';

/**
 * Autocomplete provider for FileMaker script step names.
 * In 'calc' mode, step suggestions are suppressed entirely.
 */
export function createCompletionProvider(
  catalog: StepCatalogEntry[],
  mode: 'script' | 'calc' = 'script',
): monaco.languages.CompletionItemProvider {
  type BaseSuggestion = Omit<monaco.languages.CompletionItem, 'range'>;
  const baseSuggestions: BaseSuggestion[] = catalog.map((entry, i) => {
    const isControl = controlSteps.has(entry.name);
    return {
      label: entry.name,
      kind: isControl
        ? monaco.languages.CompletionItemKind.Keyword
        : monaco.languages.CompletionItemKind.Function,
      insertText: getInsertText(entry),
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: isControl ? 'Control flow' : entry.category,
      documentation: entry.helpUrl ? { value: `[Help](${entry.helpUrl})` } : undefined,
      sortText: String(i).padStart(4, '0'),
    };
  });

  return {
    triggerCharacters: [],

    provideCompletionItems(
      model: monaco.editor.ITextModel,
      position: monaco.Position,
    ): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
      // Calc mode: suppress step completions entirely
      if (mode === 'calc') return { suggestions: [] };

      const lineContent = model.getLineContent(position.lineNumber);
      const lineUntilPosition = lineContent.substring(0, position.column - 1).trimStart();

      // Only suggest step names at the start of a line (before any bracket)
      if (lineUntilPosition.includes('[')) {
        return { suggestions: [] };
      }

      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      return { suggestions: baseSuggestions.map(s => ({ ...s, range })) };
    },
  };
}

/**
 * Autocomplete provider for FileMaker built-in functions.
 * - script mode: triggers only when cursor is inside [ ]
 * - calc mode: triggers at any position
 */
export function createFunctionCompletionProvider(
  mode: 'script' | 'calc' = 'script',
): monaco.languages.CompletionItemProvider {
  type BaseSuggestion = Omit<monaco.languages.CompletionItem, 'range'>;
  const baseSuggestions: BaseSuggestion[] = FM_FUNCTIONS.map((fn, i) => ({
    label: fn.name,
    kind: monaco.languages.CompletionItemKind.Function,
    insertText: fn.insertText,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    detail: fn.signature,
    documentation: fn.description ? { value: fn.description } : undefined,
    sortText: String(i).padStart(4, '0'),
  }));

  return {
    triggerCharacters: [],

    provideCompletionItems(
      model: monaco.editor.ITextModel,
      position: monaco.Position,
    ): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
      const lineContent = model.getLineContent(position.lineNumber);
      const lineUntilPosition = lineContent.substring(0, position.column - 1).trimStart();

      if (mode === 'script') {
        // Only suggest inside brackets
        if (!lineUntilPosition.includes('[')) return { suggestions: [] };
        // But not after a closing bracket on the same segment
        const afterBracket = lineUntilPosition.slice(lineUntilPosition.lastIndexOf('[') + 1);
        if (afterBracket.includes(']')) return { suggestions: [] };
      }

      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      return { suggestions: baseSuggestions.map(s => ({ ...s, range })) };
    },
  };
}

/**
 * Autocomplete provider for variables already used in the current editor.
 * Triggers on $ and ~ and scans the full document for existing references.
 * - script mode: only suggests inside [ ]
 * - calc mode: suggests at any position
 */
export function createVariableCompletionProvider(
  mode: 'script' | 'calc' = 'script',
): monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters: ['$', '~'],

    provideCompletionItems(
      model: monaco.editor.ITextModel,
      position: monaco.Position,
    ): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
      const lineContent = model.getLineContent(position.lineNumber);
      const lineUntilPosition = lineContent.substring(0, position.column - 1);

      if (mode === 'script') {
        const trimmed = lineUntilPosition.trimStart();
        if (!trimmed.includes('[')) return { suggestions: [] };
        const afterBracket = trimmed.slice(trimmed.lastIndexOf('[') + 1);
        if (afterBracket.includes(']')) return { suggestions: [] };
      }

      // Detect which sigil the user is currently typing
      const typingMatch = lineUntilPosition.match(/(\$\$|\$|~)[a-zA-Z_~0-9.]*$/);
      if (!typingMatch) return { suggestions: [] };
      const sigil = typingMatch[1]; // '$$', '$', or '~'

      // Scan the full document for all matching variable references
      const fullText = model.getValue();
      const variables = new Set<string>();
      let re: RegExp;

      if (sigil === '$$') {
        re = /\$\$[a-zA-Z_~][a-zA-Z0-9_.~]*/g;
      } else if (sigil === '~') {
        re = /~[a-zA-Z_][a-zA-Z0-9_.]+/g;
      } else {
        // Local $ — exclude $$ globals via negative lookbehind
        re = /(?<!\$)\$(?!\$)[a-zA-Z_~][a-zA-Z0-9_.~]*/g;
      }

      let m: RegExpExecArray | null;
      while ((m = re.exec(fullText)) !== null) variables.add(m[0]);

      if (variables.size === 0) return { suggestions: [] };

      // Replacement range: the token the user is typing (sigil + partial name)
      const tokenStartCol = position.column - typingMatch[0].length;
      const afterCursor = lineContent.substring(position.column - 1);
      const afterMatch = afterCursor.match(/^[a-zA-Z0-9_.~]*/);
      const tokenEndCol = position.column + (afterMatch ? afterMatch[0].length : 0);

      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: tokenStartCol,
        endColumn: tokenEndCol,
      };

      const detail = sigil === '$$' ? 'Global variable'
        : sigil === '~' ? 'Let variable'
        : 'Local variable';

      const suggestions: monaco.languages.CompletionItem[] = [...variables].map((v, i) => ({
        label: v,
        kind: monaco.languages.CompletionItemKind.Variable,
        insertText: v,
        detail,
        sortText: String(i).padStart(4, '0'),
        range,
      }));

      return { suggestions };
    },
  };
}

/**
 * Autocomplete provider for FileMaker field references (TO::FieldName).
 * - script mode: triggers only when cursor is inside [ ]
 * - calc mode: triggers at any position
 * Reads context dynamically from the context store on each invocation.
 */
export function createFieldCompletionProvider(
  mode: 'script' | 'calc' = 'script',
): monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters: [':'],

    provideCompletionItems(
      model: monaco.editor.ITextModel,
      position: monaco.Position,
    ): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
      const lineContent = model.getLineContent(position.lineNumber);
      const lineUntilPos = lineContent.substring(0, position.column - 1);
      const trimmed = lineUntilPos.trimStart();

      if (mode === 'script') {
        if (!trimmed.includes('[')) return { suggestions: [] };
        const afterBracket = trimmed.slice(trimmed.lastIndexOf('[') + 1);
        if (afterBracket.includes(']')) return { suggestions: [] };
      }

      const context = getContext();
      if (!context?.tables) return { suggestions: [] };

      // Detect if cursor is inside a "TO::partial" token
      const doubleColonMatch = lineUntilPos.match(/([\w][\w ]*)::([\w ]*)$/);

      // Triggered by single ':' but not '::' — suppress
      if (!doubleColonMatch && lineUntilPos.endsWith(':')) return { suggestions: [] };

      let range: monaco.IRange;
      let filterTO: string | null = null;

      if (doubleColonMatch) {
        // Cursor is inside "TO::partial" — extend range to cover the full token
        filterTO = doubleColonMatch[1].trimEnd();
        const tokenLen = doubleColonMatch[0].length;
        const afterCursor = lineContent.substring(position.column - 1);
        const trailingMatch = afterCursor.match(/^[\w]*/);
        const trailingLen = trailingMatch ? trailingMatch[0].length : 0;
        range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - tokenLen,
          endColumn: position.column + trailingLen,
        };
      } else {
        const word = model.getWordUntilPosition(position);
        range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
      }

      const suggestions: monaco.languages.CompletionItem[] = [];
      let i = 0;

      for (const [toKey, table] of Object.entries(context.tables)) {
        const to = table.to ?? toKey;
        // Match against both the JSON key and the .to field (supports
        // both old format keyed by base table and new format keyed by TO)
        if (filterTO !== null
            && to.toLowerCase() !== filterTO.toLowerCase()
            && toKey.toLowerCase() !== filterTO.toLowerCase()) continue;

        // Use the matched name for field labels (prefer filterTO if it matched)
        const displayTO = filterTO ?? to;
        for (const [fieldName, field] of Object.entries(table.fields)) {
          const label = `${displayTO}::${fieldName}`;
          suggestions.push({
            label,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: label,
            detail: field.type,
            sortText: String(i++).padStart(5, '0'),
            range,
          });
        }
      }

      return { suggestions };
    },
  };
}

const controlSteps = new Set([
  'If', 'Else If', 'Else', 'End If',
  'Loop', 'Exit Loop If', 'End Loop',
  'Exit Script', 'Halt Script',
]);

/**
 * Wrap a single signature value token in an ordered Monaco tab-stop.
 * Quoted strings keep their quotes ("${N:inner}"); a `{a|b}` group becomes a
 * choice dropdown (${N|a,b|}); a leading `$` stays literal outside the stop
 * (\$${N:name}); anything else becomes a plain placeholder (${N:token}).
 * `next()` yields the running tab-stop index so numbering is left-to-right.
 */
function wrapValue(core: string, next: () => number): string {
  if (!core) return core;
  if (core.length >= 2 && core.startsWith('"') && core.endsWith('"')) {
    return `"\${${next()}:${core.slice(1, -1)}}"`;
  }
  if (core.startsWith('{') && core.endsWith('}')) {
    const opts = core.slice(1, -1).split('|').map((o) => o.trim()).join(',');
    return `\${${next()}|${opts}|}`;
  }
  if (core.startsWith('$')) {
    return `\\$\${${next()}:${core.slice(1)}}`;
  }
  return `\${${next()}:${core}}`;
}

/**
 * Derive a Monaco snippet from a catalog entry's hrSignature — the sole snippet
 * source now that monacoSnippet is retired (no per-step snippet data). Each
 * fill-in slot inside the `[ … ]` body becomes an ordered tab-stop (labels like
 * "Title:" stay literal); a block-opening step (blockPair.role === 'open') gets
 * its body plus a `$0` cursor plus the closing partner appended, so If/Loop
 * still auto-scaffold on insert.
 */
function deriveSnippet(entry: StepCatalogEntry): string {
  const sig = entry.hrSignature ?? '';
  let n = 0;
  const next = () => (n += 1);

  // Wrap the first `[ … ]` bracket body; a bodiless signature (Else, End If)
  // passes through untouched.
  const m = /^(.*?\[)(.*)(\][^\]]*)$/s.exec(sig);
  let body: string;
  if (m) {
    const [, head, inner, tail] = m;
    body =
      head +
      inner
        .split(';')
        .map((seg) => {
          const sm = /^(\s*)(.*?)(\s*)$/s.exec(seg);
          if (!sm) return seg;
          const [, lead, mid, trail] = sm;
          const li = mid.indexOf(': ');
          if (li >= 0) {
            return lead + mid.slice(0, li + 2) + wrapValue(mid.slice(li + 2), next) + trail;
          }
          return lead + wrapValue(mid, next) + trail;
        })
        .join(';') +
      tail;
  } else {
    body = sig;
  }

  let text = sig.startsWith(entry.name) ? body : `${entry.name} ${body}`;

  const bp = entry.blockPair;
  if (bp && bp.role === 'open' && bp.partners.length > 0) {
    text += `\n\t$0\n${bp.partners[bp.partners.length - 1]}`;
  }
  return text;
}

/** Generate snippet insert text from catalog entry. */
function getInsertText(entry: StepCatalogEntry): string {
  if (entry.hrSignature) return deriveSnippet(entry);
  if (controlSteps.has(entry.name)) return entry.name;
  if (entry.selfClosing && entry.params.length === 0) return entry.name;
  return `${entry.name} [ $0 ]`;
}
