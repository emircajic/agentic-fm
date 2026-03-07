import * as monaco from 'monaco-editor';
import { monarchLanguage, languageConfiguration } from './monarch';
import { buildMonacoTheme, loadSavedTheme, loadSavedPresetId } from './themes';
import { createCompletionProvider, createFunctionCompletionProvider, createVariableCompletionProvider } from './completion';
import { createDiagnosticsProvider } from './diagnostics';
import { loadEditorMode } from './themes';
import type { StepCatalogEntry } from '@/converter/catalog-types';

const LANGUAGE_ID = 'filemaker-script';
let registered = false;

export function registerFileMakerLanguage(): void {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, monarchLanguage);
  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, languageConfiguration);

  const savedColors = loadSavedTheme();
  const savedPreset = loadSavedPresetId();
  monaco.editor.defineTheme('filemaker-dark', buildMonacoTheme(savedColors, savedPreset === 'solarized_light'));
}

export function registerCompletionProviders(
  catalog: StepCatalogEntry[],
): monaco.IDisposable {
  const mode = loadEditorMode();
  const d1 = monaco.languages.registerCompletionItemProvider(
    LANGUAGE_ID,
    createCompletionProvider(catalog, mode),
  );
  const d2 = monaco.languages.registerCompletionItemProvider(
    LANGUAGE_ID,
    createFunctionCompletionProvider(mode),
  );
  const d3 = monaco.languages.registerCompletionItemProvider(
    LANGUAGE_ID,
    createVariableCompletionProvider(mode),
  );
  return { dispose: () => { d1.dispose(); d2.dispose(); d3.dispose(); } };
}

export function attachDiagnostics(
  editor: monaco.editor.IStandaloneCodeEditor,
  catalog?: StepCatalogEntry[],
): monaco.IDisposable {
  return createDiagnosticsProvider(editor, catalog ?? []);
}

export { LANGUAGE_ID };
