import type { FMContext } from '@/context/types';

export type AppMode = 'editor' | 'icons';

interface ToolbarProps {
  context: FMContext | null;
  showXmlPreview: boolean;
  showChat: boolean;
  showLibrary: boolean;
  editorMode: 'script' | 'calc';
  appMode: AppMode;
  onToggleXmlPreview: () => void;
  onToggleChat: () => void;
  onToggleLibrary: () => void;
  onRefreshContext: () => void;
  onNewScript: () => void;
  onValidate: () => void;
  onClipboard: () => void;
  onLoadScript: () => void;
  onOpenSettings: () => void;
  onSetEditorMode: (mode: 'script' | 'calc') => void;
  onSetAppMode: (mode: AppMode) => void;
}

export function Toolbar({
  context,
  showXmlPreview,
  showChat,
  showLibrary,
  editorMode,
  appMode,
  onToggleXmlPreview,
  onToggleChat,
  onToggleLibrary,
  onRefreshContext,
  onNewScript,
  onValidate,
  onClipboard,
  onLoadScript,
  onOpenSettings,
  onSetEditorMode,
  onSetAppMode,
}: ToolbarProps) {
  return (
    <div class="flex items-center gap-1 px-3 py-1.5 bg-neutral-800 border-b border-neutral-700 text-sm select-none">
      <span class="font-semibold text-neutral-200 mr-1">agentic-fm</span>

      <div class="h-4 w-px bg-neutral-600 mx-1" />

      {/* App mode toggle: Editor / Icons */}
      <ModeTab active={appMode === 'editor'} onClick={() => onSetAppMode('editor')}>
        Editor
      </ModeTab>
      <ModeTab active={appMode === 'icons'} onClick={() => onSetAppMode('icons')}>
        Icons
      </ModeTab>

      {appMode === 'editor' && (
        <>
          <div class="h-4 w-px bg-neutral-600 mx-1" />

          <IconButton onClick={onNewScript} title="New script">
            <PlusIcon />
          </IconButton>

          <IconButton onClick={onValidate} title="Validate XML output">
            <FileCheckIcon />
          </IconButton>

          <IconButton onClick={onClipboard} title="Convert to XML and copy to clipboard">
            <ClipboardCopyIcon />
          </IconButton>

          <IconButton onClick={onLoadScript} title="Load an existing script">
            <FolderOpenIcon />
          </IconButton>

          <div class="h-4 w-px bg-neutral-600 mx-1" />

          {/* Script / Calculation mode toggle */}
          <IconButton
            onClick={() => onSetEditorMode('script')}
            active={editorMode === 'script'}
            title="Script mode — step completions at line start, functions inside [ ]"
          >
            <ScriptIcon />
          </IconButton>
          <IconButton
            onClick={() => onSetEditorMode('calc')}
            active={editorMode === 'calc'}
            title="Calculation mode — function completions everywhere, no step suggestions"
          >
            <CalcIcon />
          </IconButton>

          <div class="h-4 w-px bg-neutral-600 mx-1" />

          <IconButton
            onClick={onToggleLibrary}
            active={showLibrary}
            title="Toggle library panel"
          >
            <LibraryBigIcon />
          </IconButton>

          <IconButton
            onClick={onToggleXmlPreview}
            active={showXmlPreview}
            title="Toggle XML preview panel"
          >
            <CodeXmlIcon />
          </IconButton>

          <IconButton
            onClick={onToggleChat}
            active={showChat}
            title="Toggle AI chat panel"
          >
            <MessageSquareTextIcon />
          </IconButton>
        </>
      )}

      <div class="flex-1" />

      {context?.task && appMode === 'editor' && (
        <span class="text-neutral-400 text-xs truncate max-w-sm" title={context.task}>
          {context.task}
        </span>
      )}

      <IconButton onClick={onOpenSettings} title="AI provider settings">
        <SettingsIcon />
      </IconButton>

      <IconButton onClick={onRefreshContext} title="Refresh context from CONTEXT.json">
        <RefreshCwIcon />
      </IconButton>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: preact.ComponentChildren;
}) {
  return (
    <button
      onClick={onClick}
      class={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-400'
      }`}
    >
      {children}
    </button>
  );
}

function IconButton({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title?: string;
  active?: boolean;
  children: preact.ComponentChildren;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      class={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-300'
      }`}
    >
      {children}
    </button>
  );
}

const iconProps = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: '16',
  height: '16',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round' as const,
  'stroke-linejoin': 'round' as const,
};

function PlusIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

function FileCheckIcon() {
  return (
    <svg {...iconProps}>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  );
}

function ClipboardCopyIcon() {
  return (
    <svg {...iconProps}>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v4" />
      <path d="M21 14H11" />
      <path d="m15 10-4 4 4 4" />
    </svg>
  );
}

function FolderOpenIcon() {
  return (
    <svg {...iconProps}>
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function CodeXmlIcon() {
  return (
    <svg {...iconProps}>
      <path d="m18 16 4-4-4-4" />
      <path d="m6 8-4 4 4 4" />
      <path d="m14.5 4-5 16" />
    </svg>
  );
}

function MessageSquareTextIcon() {
  return (
    <svg {...iconProps}>
      <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
      <path d="M7 11h10" />
      <path d="M7 15h6" />
      <path d="M7 7h8" />
    </svg>
  );
}

function LibraryBigIcon() {
  return (
    <svg {...iconProps}>
      <rect width="8" height="18" x="3" y="3" rx="1" />
      <path d="M7 3v18" />
      <path d="M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z" />
    </svg>
  );
}

function MessageSquarePlusIcon() {
  return (
    <svg {...iconProps}>
      <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
      <path d="M12 8v6" />
      <path d="M9 11h6" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function RefreshCwIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function ScriptIcon() {
  return (
    <svg {...iconProps}>
      <path d="M15 12h-5" />
      <path d="M15 8h-5" />
      <path d="M19 17V5a2 2 0 0 0-2-2H4" />
      <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
    </svg>
  );
}

function CalcIcon() {
  return (
    <svg {...iconProps}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <path d="M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3" />
      <path d="M9 11.2h5.7" />
    </svg>
  );
}
