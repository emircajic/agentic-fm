import { useRef, useEffect, useState } from 'preact/hooks';
import * as monaco from 'monaco-editor';
import { registerFileMakerLanguage, registerCompletionProviders, attachDiagnostics, LANGUAGE_ID } from './language/filemaker-script';
import { updateConversionDiagnostics } from './language/diagnostics';
import { editorConfig } from './editor.config';
import { fetchStepCatalog } from '@/api/client';
import type { StepCatalogEntry } from '@/converter/catalog-types';
import type { FMContext } from '@/context/types';
import { setContext as syncContextStore } from '@/context/store';
import { hrToXml } from '@/converter/hr-to-xml';

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
  getLiveContent?: { current: (() => string) | null };
}

export function EditorPanel({ value, onChange, context, getLiveContent }: EditorPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const settingValueRef = useRef(false);
  // Tracks the last value propagated FROM Monaco → parent via onChange.
  // The sync effect only calls editor.setValue when value differs from this,
  // meaning the change came from an external source (accept diff, load script).
  const lastMonacoValue = useRef(value);
  const completionDisposable = useRef<monaco.IDisposable | null>(null);
  const lastSelectionRef = useRef<monaco.Selection | null>(null);
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

    // Expose live content getter for validation (bypasses debounce/state lag)
    if (getLiveContent) getLiveContent.current = () => editor.getValue();

    // Expose global trigger for FileMaker "Perform JavaScript in Web Viewer"
    (window as any).triggerEditorAction = (actionId: string) => {
      editor.trigger('fm', actionId, null);
    };

    // Track last known cursor position so inserts work even after focus leaves the editor
    editor.onDidChangeCursorSelection(e => {
      lastSelectionRef.current = e.selection;
    });

    // Expose selection accessor for LibraryPanel
    (window as any).getEditorSelection = (): string | null => {
      const selection = editor.getSelection();
      if (!selection || selection.isEmpty()) return null;
      return editor.getModel()?.getValueInRange(selection) ?? null;
    };

    // Insert text at last known cursor position; returns false only if editor was never used
    (window as any).insertAtEditorCursor = (text: string): boolean => {
      const selection = lastSelectionRef.current ?? editor.getSelection();
      if (!selection) return false;
      editor.pushUndoStop();
      editor.executeEdits('editor-insert', [{ range: selection, text, forceMoveMarkers: true }]);
      editor.pushUndoStop();
      // Scroll to reveal cursor if the edit pushed it outside the viewport —
      // without this, Monaco's input handler stalls on unrendered positions
      const pos = editor.getPosition();
      if (pos) {
        editor.revealPositionInCenterIfOutsideViewport(pos);
      }
      editor.focus();
      return true;
    };

    // Listen for changes — debounced to avoid re-rendering App on every keystroke
    // Skip notifications triggered by our own setValue calls (settingValueRef guard)
    let changeTimer: ReturnType<typeof setTimeout> | undefined;
    editor.onDidChangeModelContent(() => {
      if (settingValueRef.current) return;
      if (changeTimer) clearTimeout(changeTimer);
      changeTimer = setTimeout(() => {
        const val = editor.getValue();
        lastMonacoValue.current = val;
        onChange(val);
      }, 150);
    });

    // Attach diagnostics
    const diagDisposable = attachDiagnostics(editor, catalog);

    return () => {
      if (changeTimer) clearTimeout(changeTimer);
      delete (window as any).triggerEditorAction;
      delete (window as any).getEditorSelection;
      delete (window as any).insertAtEditorCursor;
      diagDisposable.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, [containerRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync context prop into the store so completion providers can read it via getContext()
  useEffect(() => {
    syncContextStore(context);
  }, [context]);

  // Update conversion diagnostics whenever editor content or context changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    const result = hrToXml(editor.getValue(), context);
    updateConversionDiagnostics(model, result.errors);
  }, [value, context]);

  // Sync value from parent only when it changed from an external source
  // (accept diff, load script) — not when it echoes back from Monaco's own onChange.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && value !== lastMonacoValue.current) {
      settingValueRef.current = true;
      editor.setValue(value);
      settingValueRef.current = false;
      lastMonacoValue.current = value;
    }
  }, [value]);


  return (
    <div
      ref={containerRef}
      class="h-full w-full"
    />
  );
}
