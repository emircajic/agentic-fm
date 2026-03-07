import type * as monaco from 'monaco-editor';

/**
 * Monaco editor configuration.
 * Adjust these settings to change editor behavior.
 */
export const editorConfig: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontSize: 14,
  lineNumbers: 'on',
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  tabSize: 4,
  insertSpaces: false,
  renderWhitespace: 'selection',
  bracketPairColorization: { enabled: false },
  guides: {
    indentation: true,
    bracketPairs: false,
  },
  padding: { top: 8, bottom: 8 },
  quickSuggestions: { other: true, comments: false, strings: true },
  suggestOnTriggerCharacters: true,
};
