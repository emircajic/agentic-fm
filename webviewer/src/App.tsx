import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { Toolbar, type AppMode } from '@/ui/Toolbar';
import { StatusBar } from '@/ui/StatusBar';
import { EditorPanel } from '@/editor/EditorPanel';
import { XmlPreview } from '@/editor/xml-preview/XmlPreview';
import { ChatPanel } from '@/ai/chat/ChatPanel';
import { AISettings } from '@/ai/settings/AISettings';
import { LoadScriptDialog } from '@/ui/LoadScriptDialog';
import { LibraryPanel } from '@/ui/LibraryPanel';
import type { FMContext } from '@/context/types';
import { fetchContext, fetchSteps, fetchStepCatalog, fetchSettings, fetchDocs, fetchCustomInstructions, fetchSystemPrompt, validateSnippet, clipboardWrite, writeSandbox, fetchAgentOutput, fetchVersion } from '@/api/client';
import type { StepInfo, AgentOutput, VersionInfo } from '@/api/client';
import { AgentOutputPanel } from '@/ui/AgentOutputPanel';
import type { StepCatalogEntry } from '@/converter/catalog-types';
import { hrToXml, loadCatalog } from '@/converter/hr-to-xml';
import { saveDraft, restoreDraft } from '@/autosave';
import { loadEditorMode, saveEditorMode, loadSavedPresetId, LIGHT_PRESETS, getThemeBackgrounds } from '@/editor/language/themes';
import { loadLayoutPrefsSync, saveLayoutPrefs, loadLayoutPrefsFromServer, hasLocalPrefs } from '@/layout-prefs';

function useSplitPane(defaultPct = 50, min = 20, max = 80, direction: 'horizontal' | 'vertical' = 'horizontal') {
  const [pct, setPct] = useState(defaultPct);
  const containerRef = useRef<HTMLDivElement>(null);

  const onDividerMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const move = (me: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const newPct = direction === 'vertical'
        ? ((me.clientY - rect.top) / rect.height) * 100
        : ((me.clientX - rect.left) / rect.width) * 100;
      setPct(Math.min(max, Math.max(min, newPct)));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [min, max, direction]);

  return { pct, setPct, containerRef, onDividerMouseDown };
}

function useResizablePanel(defaultWidth: number, min: number, max: number) {
  const [width, setWidth] = useState(defaultWidth);

  const onDividerMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const move = (me: MouseEvent) => {
      const delta = me.clientX - startX;
      setWidth(Math.min(max, Math.max(min, startWidth + delta)));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [width, min, max]);

  return { width, setWidth, onDividerMouseDown };
}

export function App() {
  // Load layout prefs once on mount — localStorage is sync so no flash
  const [initialPrefs] = useState(loadLayoutPrefsSync);

  const [context, setContext] = useState<FMContext | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState('Ready');
  const [editorContent, setEditorContent] = useState(sampleScript);
  const [scriptName, setScriptName] = useState('');
  const [showXmlPreview, setShowXmlPreview] = useState(initialPrefs.showXmlPreview);
  const [showChat, setShowChat] = useState(initialPrefs.showChat);
  const [showSettings, setShowSettings] = useState(false);
  const [showLoadScript, setShowLoadScript] = useState(false);
  const [showLibrary, setShowLibrary] = useState(initialPrefs.showLibrary);
  const [appMode, setAppMode] = useState<AppMode>(initialPrefs.showIconBrowser ? 'icons' : 'editor');
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [catalog, setCatalog] = useState<StepCatalogEntry[]>([]);
  const [promptMarker, setPromptMarker] = useState('prompt');
  const [codingConventions, setCodingConventions] = useState('');
  const [knowledgeDocs, setKnowledgeDocs] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [baseSystemPrompt, setBaseSystemPrompt] = useState('');
  const [chatKey, setChatKey] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<VersionInfo | null>(null);
  const [editorMode, setEditorMode] = useState<'script' | 'calc'>(loadEditorMode);
  const [presetId, setPresetId] = useState(() => loadSavedPresetId());
  const isLightTheme = LIGHT_PRESETS.has(presetId);
  const themeBg = getThemeBackgrounds(presetId);
  const scriptNameRef = useRef('');
  const editorContentRef = useRef(editorContent);
  const getLiveContent = useRef<(() => string) | null>(null);
  const mainSplit = useSplitPane(initialPrefs.editorPct);
  const editorXmlSplit = useSplitPane(initialPrefs.editorXmlPct, 15, 85, 'vertical');
  const library = useResizablePanel(initialPrefs.libraryWidth, 140, 480);

  // Keep refs in sync so callbacks always have the latest values
  scriptNameRef.current = scriptName;
  editorContentRef.current = editorContent;

  useEffect(() => {
    fetchContext().then(ctx => {
      setContext(ctx);
      setGeneratedAt(ctx.generated_at);
    }).catch(() => {
      setStatus('No CONTEXT.json found');
    });
    fetchSteps().then(setSteps).catch(() => {});
    fetchStepCatalog().then(cat => {
      setCatalog(cat);
      loadCatalog(cat);
    }).catch(() => {});
    fetchSettings().then(s => setPromptMarker(s.promptMarker || 'prompt')).catch(() => {});
    fetchDocs().then(d => {
      setCodingConventions(d.conventions);
      setKnowledgeDocs(d.knowledge);
    }).catch(() => {});
    fetchCustomInstructions().then(setCustomInstructions).catch(() => {});
    fetchSystemPrompt().then(setBaseSystemPrompt).catch(() => {});
    fetchVersion().then(v => { if (v.updateAvailable) setUpdateInfo(v); }).catch(() => {});
  }, []);

  // Restore draft on mount — skip if it's just the sample boilerplate
  useEffect(() => {
    restoreDraft().then(draft => {
      if (draft && draft.hr.trim() !== sampleScript.trim()) {
        setEditorContent(draft.hr);
        if (draft.scriptName) {
          setScriptName(draft.scriptName);
          setStatus(`Restored draft: ${draft.scriptName}`);
        } else {
          setStatus('Restored draft');
        }
      }
    }).catch(() => {});
  }, []);

  // Auto-save on editor changes (debounced via saveDraft)
  useEffect(() => {
    saveDraft(editorContent, scriptNameRef.current);
  }, [editorContent]);

  // Persist layout prefs whenever any panel visibility or size changes
  useEffect(() => {
    saveLayoutPrefs({
      showXmlPreview,
      showChat,
      showLibrary,
      showIconBrowser: appMode === 'icons',
      editorPct: mainSplit.pct,
      editorXmlPct: editorXmlSplit.pct,
      libraryWidth: library.width,
    });
  }, [showXmlPreview, showChat, showLibrary, appMode, mainSplit.pct, editorXmlSplit.pct, library.width]);

  // Server fallback: restore layout prefs when localStorage has no saved state
  useEffect(() => {
    if (hasLocalPrefs()) return;
    loadLayoutPrefsFromServer().then(prefs => {
      if (!prefs) return;
      setShowXmlPreview(prefs.showXmlPreview);
      setShowChat(prefs.showChat);
      setShowLibrary(prefs.showLibrary);
      setAppMode(prefs.showIconBrowser ? 'icons' : 'editor');
      mainSplit.setPct(prefs.editorPct);
      editorXmlSplit.setPct(prefs.editorXmlPct);
      library.setWidth(prefs.libraryWidth);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose global callbacks for FileMaker JS bridge
  useEffect(() => {
    (window as any).pushContext = (jsonString: string) => {
      try {
        const ctx = JSON.parse(jsonString) as FMContext;
        setContext(ctx);
        setGeneratedAt(ctx.generated_at);
        setStatus(`Context loaded: ${ctx.solution ?? 'unknown'}`);
      } catch {
        setStatus('Error parsing context');
      }
    };

    (window as any).loadScript = (content: string) => {
      setEditorContent(content);
    };

    return () => {
      delete (window as any).pushContext;
      delete (window as any).loadScript;
      delete (window as any).triggerAppAction;
    };
  }, []);

  // Listen for postMessage from the icon browser iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://elemental-svg.com') return;
      const { type, xml } = event.data ?? {};
      if (!xml || typeof xml !== 'string') return;
      if (type === 'copy-button-bar' || type === 'copy-button') {
        clipboardWrite(xml).then(result => {
          if (result.ok) {
            setStatus('Icon copied to clipboard — ready to paste into FileMaker');
          } else {
            setStatus(`Clipboard error: ${result.error}`);
          }
        }).catch(() => {
          setStatus('Clipboard write failed (server error)');
        });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleNewScript = useCallback(async () => {
    const name = prompt('Script name:');
    if (!name) return;
    const hr = `# ${name} - 00\n`;
    const { xml } = hrToXml(hr, context);
    const filename = `${name} - 00.xml`;
    setEditorContent(hr);
    setScriptName(name);
    try {
      await writeSandbox(filename, xml);
      setStatus(`New script: ${name}`);
    } catch {
      setStatus(`New script: ${name} (failed to save file)`);
    }
  }, [context]);

  const handleValidate = useCallback(async () => {
    setStatus('Validating...');
    setStatusDetail(null);
    const content = getLiveContent.current?.() ?? editorContent;
    const { xml, errors, warnings } = hrToXml(content, context);
    if (errors.length > 0) {
      console.warn('[validate] conversion errors:', errors);
      const detail = errors.map((e: { line: number; message: string }) => `L${e.line}: ${e.message}`).join('\n');
      setStatus(`Conversion failed — ${errors.length} error(s)`);
      setStatusDetail(detail);
      return;
    }
    try {
      const result = await validateSnippet(xml);
      if (result.valid) {
        if (warnings.length > 0) {
          const detail = warnings.map((w: { line: number; message: string }) => `L${w.line}: ${w.message}`).join('\n');
          setStatus(`Validation passed (${warnings.length} unresolved reference(s) — FM resolves by name)`);
          setStatusDetail(detail);
        } else {
          setStatus('Validation passed');
          setStatusDetail(null);
        }
      } else {
        const fullOutput = result.errors.join('\n');
        const countMatch = fullOutput.match(/FAILED \((\d+) error/);
        const errorCount = countMatch ? parseInt(countMatch[1]) : result.errors.filter(l => l.trim().startsWith('FAIL')).length;
        setStatus(`Validation failed — ${errorCount} error(s)`);
        setStatusDetail(fullOutput);
      }
    } catch {
      setStatus('Validation failed (server error)');
    }
  }, [editorContent, context]);

  const handleClipboard = useCallback(async () => {
    setStatus('Converting & copying to clipboard...');
    const { xml, errors, warnings } = hrToXml(editorContent, context);
    if (errors.length > 0) {
      setStatus(`Cannot copy: ${errors.length} conversion error(s)`);
      return;
    }
    try {
      const result = await clipboardWrite(xml);
      if (result.ok) {
        const warnMsg = warnings.length > 0
          ? ` (${warnings.length} unresolved reference(s) — FM will resolve by name)`
          : '';
        setStatus('Copied to clipboard — ready to paste into FileMaker' + warnMsg);
        window.onClipboardReady?.();
      } else {
        setStatus(`Clipboard error: ${result.error}`);
      }
    } catch {
      setStatus('Clipboard write failed (server error)');
    }
  }, [editorContent, context]);

  const handleInsertScript = useCallback((script: string, lineRange?: { start: number; end: number }) => {
    const before = editorContentRef.current;
    let content: string;

    if (lineRange) {
      // Splice the suggestion into the specific line range
      const lines = before.split('\n');
      const { start, end } = lineRange;
      // start and end are 1-based inclusive.
      // When start > end (e.g. lines=5-4), it's a pure insertion before line `start`.
      const deleteCount = end >= start ? end - start + 1 : 0;
      const insertLines = script.split('\n');
      const spliced = [...lines];
      spliced.splice(start - 1, deleteCount, ...insertLines);
      content = spliced.join('\n');
    } else {
      // No line range — full replacement (original behavior)
      content = script;
    }

    setAgentOutput({
      type: 'diff',
      content,
      before,
      available: true,
    });
  }, []);

  const [showInsertWarning, setShowInsertWarning] = useState(false);
  const [agentOutput, setAgentOutput] = useState<AgentOutput | null>(null);
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [showStatusDetail, setShowStatusDetail] = useState(false);

  const handleLibraryInsert = useCallback((content: string) => {
    const inserted = (window as any).insertAtEditorCursor?.(content) ?? false;
    if (!inserted) {
      setShowInsertWarning(true);
    }
  }, []);

  const handleScriptLoaded = useCallback((hr: string, name: string, options: { resetChat: boolean }) => {
    setEditorContent(hr);
    setScriptName(name);
    setShowLoadScript(false);
    setStatus(`Loaded: ${name}`);
    if (options.resetChat) setChatKey(k => k + 1);
  }, []);

  // Poll for agent output — skip polling while panel is already open to avoid re-render churn
  useEffect(() => {
    if (agentOutput) return;
    const poll = async () => {
      const output = await fetchAgentOutput();
      if (output.available !== false) {
        setAgentOutput(output);
      }
    };
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [agentOutput]);

  // Expose app-level toolbar actions for FileMaker JS bridge (agfm.* action IDs)
  useEffect(() => {
    (window as any).triggerAppAction = (actionId: string) => {
      switch (actionId) {
        case 'agfm.newScript':       handleNewScript(); break;
        case 'agfm.validate':        handleValidate(); break;
        case 'agfm.clipboard':       handleClipboard(); break;
        case 'agfm.loadScript':      setShowLoadScript(true); break;
        case 'agfm.toggleXmlPreview': setShowXmlPreview(v => !v); break;
        case 'agfm.toggleChat':      setShowChat(v => !v); break;
        case 'agfm.toggleLibrary':   setShowLibrary(v => !v); break;
        case 'agfm.toggleIcons':     setAppMode(m => m === 'icons' ? 'editor' : 'icons'); break;
      }
    };
  }, [handleNewScript, handleValidate, handleClipboard]);

  return (
    <div
      class="flex flex-col h-full"
      data-ui-theme={isLightTheme ? 'light' : 'dark'}
      style={{ '--color-neutral-900': themeBg.panel, '--color-neutral-800': themeBg.chrome } as any}
    >
      <Toolbar
        context={context}
        showXmlPreview={showXmlPreview}
        showChat={showChat}
        showLibrary={showLibrary}
        editorMode={editorMode}
        appMode={appMode}
        onToggleXmlPreview={() => setShowXmlPreview(v => !v)}
        onToggleChat={() => setShowChat(v => !v)}
        onToggleLibrary={() => setShowLibrary(v => !v)}
        onRefreshContext={() => {
          fetchContext().then(setContext).catch(() => {
            setStatus('Failed to refresh context');
          });
        }}
        onNewScript={handleNewScript}
        onValidate={handleValidate}
        onClipboard={handleClipboard}
        onLoadScript={() => setShowLoadScript(true)}
        onOpenSettings={() => setShowSettings(true)}
        onSetEditorMode={(mode) => { setEditorMode(mode); saveEditorMode(mode); }}
        onSetAppMode={setAppMode}
      />

      {/* Icon browser — kept mounted to preserve state when toggling */}
      <div class="flex-1 min-h-0" style={{ display: appMode === 'icons' ? 'flex' : 'none' }}>
        <iframe
          src="https://elemental-svg.com"
          style={{ width: '100%', height: '100%', border: 'none' }}
          allow="clipboard-read; clipboard-write"
          title="Elemental SVG Icon Browser"
        />
      </div>

      {/* Editor panels */}
      <div class="flex-1 min-h-0 flex" style={{ display: appMode === 'editor' ? 'flex' : 'none' }}>
        {showLibrary && (
          <>
            <div style={{ width: library.width, flexShrink: 0 }} class="h-full min-w-0 overflow-hidden">
              <LibraryPanel
                onInsert={handleLibraryInsert}
                onStatus={setStatus}
                getEditorContent={() => editorContentRef.current}
                getEditorSelection={() => (window as any).getEditorSelection?.() ?? null}
              />
            </div>
            <div
              class="w-1 shrink-0 h-full bg-neutral-700 hover:bg-blue-500 cursor-col-resize transition-colors"
              onMouseDown={library.onDividerMouseDown}
            />
          </>
        )}
        {/* Main resizable area: left column | chat */}
        <div ref={mainSplit.containerRef} class="flex-1 min-h-0 h-full flex">
          {/* Left column: editor stacked above optional XML preview */}
          <div
            ref={editorXmlSplit.containerRef}
            style={showChat ? { flexBasis: `${mainSplit.pct}%`, flexShrink: 0, flexGrow: 0, minWidth: 0 } : undefined}
            class={`${showChat ? '' : 'flex-1'} h-full min-w-0 flex flex-col`}
          >
            {/* Editor */}
            <div
              style={showXmlPreview ? { flexBasis: `${editorXmlSplit.pct}%`, flexShrink: 0, flexGrow: 0, minHeight: 0 } : undefined}
              class={`${showXmlPreview ? '' : 'flex-1'} w-full min-h-0`}
            >
              <EditorPanel
                value={editorContent}
                onChange={setEditorContent}
                context={context}
                getLiveContent={getLiveContent}
                editorMode={editorMode}
              />
            </div>

            {/* Horizontal divider between editor and XML preview */}
            {showXmlPreview && (
              <div
                class="h-1 shrink-0 w-full bg-neutral-700 hover:bg-blue-500 cursor-row-resize transition-colors"
                onMouseDown={editorXmlSplit.onDividerMouseDown}
              />
            )}

            {/* XML preview below editor */}
            {showXmlPreview && (
              <div class="flex-1 w-full min-h-0">
                <XmlPreview hrText={editorContent} context={context} />
              </div>
            )}
          </div>

          {/* Vertical divider between left column and chat */}
          {showChat && (
            <div
              class="w-1 shrink-0 h-full bg-neutral-700 hover:bg-blue-500 cursor-col-resize transition-colors"
              onMouseDown={mainSplit.onDividerMouseDown}
            />
          )}

          {/* Chat panel */}
          {showChat && (
            <div class="flex-1 min-w-0 h-full">
              <ChatPanel
                key={chatKey}
                context={context}
                steps={steps}
                catalog={catalog}
                editorContent={editorContent}
                promptMarker={promptMarker}
                codingConventions={codingConventions}
                knowledgeDocs={knowledgeDocs}
                customInstructions={customInstructions}
                baseSystemPrompt={baseSystemPrompt}
                onInsertScript={handleInsertScript}
                onClearChat={() => setChatKey(k => k + 1)}
                scriptName={scriptName}
              />
            </div>
          )}
        </div>
      </div>
      <StatusBar
        status={status}
        solution={context?.solution}
        layout={context?.current_layout?.name}
        generatedAt={generatedAt}
        contextVersion={context?.context_version}
        onDetail={statusDetail ? () => setShowStatusDetail(true) : undefined}
      />

      {showSettings && (
        <AISettings
          onClose={() => {
            setShowSettings(false);
            // Refresh custom instructions in case they were edited
            fetchCustomInstructions().then(setCustomInstructions).catch(() => {});
          }}
          onPresetChange={setPresetId}
        />
      )}
      {showLoadScript && (
        <LoadScriptDialog
          context={context}
          editorContent={editorContent}
          onLoad={handleScriptLoaded}
          onContextUpdate={setContext}
          onClose={() => setShowLoadScript(false)}
        />
      )}

      <AgentOutputPanel
        output={agentOutput}
        visible={agentOutput !== null}
        onClose={() => setAgentOutput(null)}
        onAccept={(content) => { setEditorContent(content); setAgentOutput(null); }}
      />

      {showStatusDetail && statusDetail && (
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div class="bg-neutral-800 rounded-lg shadow-xl w-[600px] max-w-[90vw] flex flex-col max-h-[70vh]">
            <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-700 shrink-0">
              <h2 class="text-sm font-semibold text-neutral-200">Validation Details</h2>
              <button
                onClick={() => setShowStatusDetail(false)}
                class="text-neutral-400 hover:text-neutral-200 text-lg leading-none"
              >
                &times;
              </button>
            </div>
            <div class="flex-1 overflow-auto p-4">
              <pre class="text-xs text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed">{statusDetail}</pre>
            </div>
            <div class="flex justify-end px-4 py-3 border-t border-neutral-700 shrink-0">
              <button
                onClick={() => setShowStatusDetail(false)}
                class="px-3 py-1 rounded text-xs bg-neutral-600 hover:bg-neutral-500 text-neutral-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showInsertWarning && (
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div class="bg-neutral-800 rounded-lg shadow-xl w-80 max-w-[90vw]">
            <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-700">
              <h2 class="text-sm font-semibold text-neutral-200">No cursor position</h2>
              <button
                onClick={() => setShowInsertWarning(false)}
                class="text-neutral-400 hover:text-neutral-200 text-lg leading-none"
              >
                &times;
              </button>
            </div>
            <div class="px-4 py-4 text-xs text-neutral-300 leading-relaxed">
              Click inside the editor first to establish a cursor position, then insert from the library.
            </div>
            <div class="flex justify-end px-4 py-3 border-t border-neutral-700">
              <button
                onClick={() => setShowInsertWarning(false)}
                class="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {updateInfo && (
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div class="bg-neutral-800 rounded-lg shadow-xl w-96 max-w-[90vw]">
            <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-700">
              <h2 class="text-sm font-semibold text-neutral-200">Update available</h2>
              <button
                onClick={() => setUpdateInfo(null)}
                class="text-neutral-400 hover:text-neutral-200 text-lg leading-none"
              >
                &times;
              </button>
            </div>
            <div class="px-4 py-4 text-xs text-neutral-300 leading-relaxed space-y-2">
              <p>
                A new version of agentic-fm is available: <span class="text-blue-400 font-semibold">v{updateInfo.remote}</span> (you have v{updateInfo.local}).
              </p>
              <p>
                Run <code class="bg-neutral-700 px-1.5 py-0.5 rounded text-neutral-200">git pull --ff-only</code> in your agentic-fm folder to update, then restart the server.
              </p>
              <p>See <code class="bg-neutral-700 px-1.5 py-0.5 rounded text-neutral-200">UPDATES.md</code> for details.</p>
            </div>
            <div class="flex justify-end px-4 py-3 border-t border-neutral-700">
              <button
                onClick={() => setUpdateInfo(null)}
                class="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const sampleScript = `# New Line Item for Invoice
Set Error Capture [ On ]
Allow User Abort [ Off ]
Freeze Window

Set Variable [ $invoiceId ; Invoices::PrimaryKey ]

If [ IsEmpty ( $invoiceId ) ]
    Show Custom Dialog [ "Error" ; "No invoice selected." ]
    Exit Script [ Result: False ]
End If

Go to Layout [ "Card Line Item Details" ]
New Record/Request
Set Field [ Line Items::ForeignKeyInvoice ; $invoiceId ]
Commit Records/Requests [ With dialog: Off ]
`;
