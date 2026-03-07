import * as monaco from 'monaco-editor';
import type { StepCatalogEntry } from '@/converter/catalog-types';
import { FM_FUNCTIONS } from './fm-functions';

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

const controlSteps = new Set([
  'If', 'Else If', 'Else', 'End If',
  'Loop', 'Exit Loop If', 'End Loop',
  'Exit Script', 'Halt Script',
]);

/** Generate snippet insert text from catalog entry */
function getInsertText(entry: StepCatalogEntry): string {
  if (entry.monacoSnippet) return entry.monacoSnippet;
  if (entry.hrSignature) {
    return `${entry.name} ${entry.hrSignature.replace(/\$/g, '\\$')}`;
  }
  if (controlSteps.has(entry.name)) return entry.name;
  if (entry.selfClosing && entry.params.length === 0) return entry.name;
  return `${entry.name} [ $0 ]`;
}
