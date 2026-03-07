import { useRef, useEffect, useState } from 'preact/hooks';
import * as monaco from 'monaco-editor';
import { registerFileMakerLanguage, registerCompletionProviders, attachDiagnostics, LANGUAGE_ID } from './language/filemaker-script';
import { editorConfig } from './editor.config';
import { fetchStepCatalog } from '@/api/client';
import type { StepCatalogEntry } from '@/converter/catalog-types';
import type { FMContext } from '@/context/types';

// Configure Monaco workers
self.MonacoEnvironment = {
  getWorker(_: unknown, _label: string) {
    return new Worker(
      new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
      { type: 'module' },
    );
  },
};

interface EditorPanelProps {
  value: string;
  onChange: (value: string) => void;
  context: FMContext | null;
}

export function EditorPanel({ value, onChange, context }: EditorPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const completionDisposable = useRef<monaco.IDisposable | null>(null);
  const [catalog, setCatalog] = useState<StepCatalogEntry[]>([]);

  // Register language once (no catalog dependency)
  useEffect(() => {
    registerFileMakerLanguage();
  }, []);

  // Fetch step catalog for autocomplete and diagnostics
  useEffect(() => {
    fetchStepCatalog()
      .then(setCatalog)
      .catch(() => {
        // Catalog not available — autocomplete/diagnostics won't have step data
      });
  }, []);

  // Register completion providers once catalog is loaded
  useEffect(() => {
    if (catalog.length === 0) return;
    completionDisposable.current?.dispose();
    completionDisposable.current = registerCompletionProviders(catalog);
    return () => {
      completionDisposable.current?.dispose();
      completionDisposable.current = null;
    };
  }, [catalog]);

  // Create editor
  useEffect(() => {
    if (!containerRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      ...editorConfig,
      value,
      language: LANGUAGE_ID,
      theme: 'filemaker-dark',
      automaticLayout: true,
    });

    editorRef.current = editor;

    // Expose global trigger for FileMaker "Perform JavaScript in Web Viewer"
    (window as any).triggerEditorAction = (actionId: string) => {
      editor.trigger('fm', actionId, null);
    };

    // Listen for changes — debounced to avoid re-rendering App on every keystroke
    let changeTimer: ReturnType<typeof setTimeout> | undefined;
    editor.onDidChangeModelContent(() => {
      if (changeTimer) clearTimeout(changeTimer);
      changeTimer = setTimeout(() => onChange(editor.getValue()), 150);
    });

    // Attach diagnostics
    const diagDisposable = attachDiagnostics(editor, catalog);

    return () => {
      if (changeTimer) clearTimeout(changeTimer);
      delete (window as any).triggerEditorAction;
      diagDisposable.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, [containerRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync value from parent (e.g. when loading a script)
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      editor.setValue(value);
    }
  }, [value]);

  // Update context-aware completions when context changes
  useEffect(() => {
    // Future: update completion providers with context data
    // (field references, layout names, script names, etc.)
  }, [context]);

  return (
    <div
      ref={containerRef}
      class="h-full w-full"
    />
  );
}
