# Webviewer Integration

This feature adds a browser-based FileMaker script editor as a third interaction method alongside the CLI and IDE. It runs inside a FileMaker WebViewer object pointed at a local Vite dev server, giving developers a Monaco-powered editor for composing and editing scripts in the human-readable (HR) format with live conversion to fmxmlsnippet XML.

The `agent/` folder can be interacted with in three ways:

1. Agentic CLI interface (e.g. Claude Code)
2. IDE with integrated agentic features (e.g. Cursor, VS Code + Copilot)
3. Via a WebViewer pointed at a local or remote hosted server

---

## Architecture Overview

Three-panel single-page application:

```
┌─────────────────────┬──────────────────────┬──────────────────┐
│  Monaco Editor      │  XML Preview         │  AI Chat         │
│  (HR script text)   │  (fmxmlsnippet)      │  (Anthropic /    │
│                     │                      │   OpenAI /       │
│  syntax highlight   │  live conversion     │   Claude Code)   │
│  completions        │  from HR             │                  │
│  diagnostics        │                      │                  │
└─────────────────────┴──────────────────────┴──────────────────┘
  Toolbar: Convert | Validate | Load Script | Clipboard | Settings
  StatusBar: validation results, unresolved refs, draft restore notice
```

**Frontend**: Preact 10 + Monaco Editor 0.52 + Tailwind CSS 4
**Build**: Vite 6 + TypeScript 5.7
**Server**: Node.js Vite dev middleware (`webviewer/server/`)
**Entry point**: `webviewer/index.html` → `src/main.tsx` → `src/App.tsx`

---

## Directory Structure

```
webviewer/
├── index.html                 # SPA entry point
├── vite.config.ts             # Vite build config (registers apiMiddleware plugin)
├── tsconfig.json
├── package.json
├── .env.example               # AGENT_DIR=../agent
├── server/
│   ├── api.ts                 # REST endpoints (Vite middleware)
│   ├── ai-proxy.ts            # AI provider routing (Anthropic / OpenAI)
│   ├── claude-cli.ts          # Claude Code CLI integration (subprocess)
│   ├── file-watcher.ts        # Watches CONTEXT.json, pushes WS event on change
│   ├── python.ts              # Python subprocess helper (spawnPython)
│   ├── settings.ts            # Persistent user settings (JSON file)
│   └── ws.ts                  # WebSocket setup for file-watcher events
└── src/
    ├── App.tsx                # Root component — layout, state, toolbar actions
    ├── main.tsx               # Preact render entry
    ├── styles.css             # Tailwind imports
    ├── autosave.ts            # Dual-layer draft persistence
    ├── ai/
    │   ├── chat/              # ChatPanel, MessageList components
    │   ├── key-store.ts       # API key management (localStorage)
    │   ├── prompt/
    │   │   └── system-prompt.ts  # System prompt for AI chat context
    │   ├── providers/         # anthropic.ts, openai.ts, claude-code.ts
    │   ├── settings/          # AISettings UI panel
    │   └── types.ts
    ├── api/
    │   └── client.ts          # Fetch wrappers for all server endpoints
    ├── bridge/
    │   ├── detection.ts       # Detect FileMaker WebViewer runtime
    │   ├── fm-bridge.ts       # FileMaker.PerformScript() bridge API
    │   └── callbacks.ts       # Callback routing for FM→browser calls
    ├── context/
    │   ├── store.ts           # CONTEXT.json state management
    │   ├── index-parser.ts    # Parse pipe-delimited index files
    │   └── types.ts
    ├── converter/
    │   ├── parser.ts          # Line parser: HR text → ParsedLine[]
    │   ├── hr-to-xml.ts       # Main HR→XML entry point
    │   ├── xml-to-hr.ts       # Reverse XML→HR converter
    │   ├── catalog-converter.ts   # Generic catalog-driven converter
    │   ├── catalog-types.ts       # TypeScript interfaces for catalog entries
    │   ├── id-resolver.ts         # Name→ID resolution via CONTEXT.json
    │   ├── step-registry.ts       # Plugin registry for step converters
    │   ├── steps/             # Hand-coded converters per category
    │   │   ├── control.ts     # If, Loop, Halt, Perform Script, etc.
    │   │   ├── fields.ts      # Set Field, Insert Text/File/PDF, etc.
    │   │   ├── navigation.ts  # Go to Layout, Portal Row, Related Record
    │   │   ├── records.ts     # Export/Import Records, Save as PDF/Excel
    │   │   ├── windows.ts     # Move/Resize, Refresh, Scroll Window
    │   │   └── miscellaneous.ts
    │   └── __tests__/
    ├── editor/
    │   ├── EditorPanel.tsx    # Monaco editor wrapper
    │   ├── language/
    │   │   ├── filemaker-script.ts   # Language registration
    │   │   ├── monarch.ts            # Syntax tokenizer (tokenizes HR script)
    │   │   ├── completion.ts         # Step name completions from catalog
    │   │   ├── diagnostics.ts        # Live validation markers
    │   │   └── theme.ts              # FileMaker dark color theme
    │   └── xml-preview/
    │       └── XmlPreview.tsx        # Side-by-side fmxmlsnippet viewer
    └── ui/
        ├── Toolbar.tsx               # Top action bar
        ├── StatusBar.tsx             # Bottom status/error display
        └── LoadScriptDialog.tsx      # Script search & load modal
```

---

## Server API Reference

All endpoints are served by the Vite dev middleware in `server/api.ts`. The `agentDir()` function resolves to the sibling `agent/` folder; `mainAgentDir()` follows worktree links to the main repo (see [Path Resolution](#path-resolution) below).

| Method | Endpoint                                | Description                                                                       |
| ------ | --------------------------------------- | --------------------------------------------------------------------------------- |
| GET    | `/api/context`                          | Returns `agent/CONTEXT.json`                                                      |
| GET    | `/api/settings`                         | Returns user settings                                                             |
| POST   | `/api/settings`                         | Updates user settings                                                             |
| POST   | `/api/chat`                             | Streams AI chat (SSE) via `ai-proxy.ts`                                           |
| GET    | `/api/index/:name`                      | Parses and returns `agent/context/<name>.index` as JSON rows                      |
| GET    | `/api/step-catalog`                     | Returns `agent/catalogs/step-catalog-en.json`                                     |
| GET    | `/api/steps`                            | Lists all snippet XML files from `snippet_examples/steps/`                        |
| GET    | `/api/snippet/:category/:step`          | Returns XML content of a specific snippet file                                    |
| POST   | `/api/validate`                         | Runs `validate_snippet.py` on posted XML; returns `{valid, errors, warnings}`     |
| POST   | `/api/clipboard/write`                  | Writes posted XML to macOS clipboard via `clipboard.py write`                     |
| POST   | `/api/clipboard/read`                   | Reads FM objects from macOS clipboard via `clipboard.py read`                     |
| POST   | `/api/convert/hr-to-xml`                | Stub (conversion is client-side; exists for headless use)                         |
| POST   | `/api/convert/xml-to-hr`                | Stub (conversion is client-side; exists for headless use)                         |
| GET    | `/api/scripts/search?q=<query>`         | Searches `scripts.index` by ID, exact name, or token match; returns top 20        |
| GET    | `/api/scripts/load?id=<id>&name=<name>` | Loads script HR (`.txt`) and converts SaXML to snippet via `fm_xml_to_snippet.py` |
| GET    | `/api/autosave`                         | Returns `agent/sandbox/.autosave.json`                                            |
| POST   | `/api/autosave`                         | Saves draft to `agent/sandbox/.autosave.json`                                     |
| DELETE | `/api/autosave`                         | Deletes the autosave file                                                         |
| GET    | `/api/sandbox`                          | Lists `.xml` files in `agent/sandbox/`                                            |
| GET    | `/api/sandbox/:filename`                | Returns contents of a sandbox XML file                                            |
| POST   | `/api/sandbox/:filename`                | Writes content to a sandbox XML file                                              |

---

## Converter System

HR script text is converted to fmxmlsnippet client-side (in the browser) so the conversion is always available without a server round-trip.

```
HR text
  ↓
parseScript()              [converter/parser.ts]
  — line-by-line → ParsedLine[]
  ↓
hrToXml()                  [converter/hr-to-xml.ts]
  — for each line:
  ├─ look up converter in step-registry
  ├─ hand-coded?  → steps/{control,fields,navigation,...}.ts
  └─ fallback?    → catalog-converter.ts (generic, catalog-driven)
       — maps StepParam types to XML emission
       — handles boolean, enum, calculation, namedCalc, field/layout/script
  ↓
ID resolution              [converter/id-resolver.ts]
  — resolveField(), resolveLayout(), resolveScript(), resolveTable()
  — looks up in CONTEXT.json; falls back to id=0
  — tracks failures as UnresolvedRef[] for status bar display
  ↓
fmxmlsnippet XML
```

**Reverse path** (`xml-to-hr.ts`): fmxmlsnippet → HR. Used when loading a script from the solution via the Load Script dialog.

**UnresolvedRef tracking**: When an ID cannot be resolved from CONTEXT.json, the converter records it. The StatusBar displays these as warnings (e.g. `Unresolved layout: "Dashboard" (id will be 0)`).

---

## Step Catalog

`agent/catalogs/step-catalog-en.json` is the canonical index for all FileMaker script steps. The file was bootstrapped by `generate-step-catalog.ts` (now archived as `.old`) which seeded entries from `snippet_examples/` XML files — that generator is not part of the repo and should never be run again.

**The catalog is maintained manually.** All additions and modifications follow the process in `agent/catalogs/UPDATING_CATALOGS.md`. Key points from that process:

- Never read the full JSON file (it is large). Use `grep -A 60 '"name": "Step Name"' agent/catalogs/step-catalog-en.json` to extract a single entry.
- Status values: `"auto"` (seeded, not reviewed) · `"complete"` (reviewed with authoritative HR data) · `"unfinished"` (partially reviewed)
- Updates set the correct `id`, `hrSignature`, `hrLabel` values, enum lists in HR display order, and `status: "complete"`.
- Shared enum reference files (`animation-enums.md`, `window-enums.md`, `language-enums.md`, `shared-enums.md`, `find-requests.md`) live alongside the catalog in `agent/catalogs/` to avoid duplication across step entries — do not inline these into the JSON; reference them during editing only.

**In the webviewer, the catalog serves three roles:**

1. **Monaco completions** (`src/editor/language/completion.ts`) — step names offered as autocomplete suggestions
2. **Live diagnostics** (`src/editor/language/diagnostics.ts`) — unknown step names flagged as errors
3. **Converter registration** (`catalog-converter.ts`) — any step without a hand-coded handler gets a generic converter generated from its catalog entry at startup

**Architecture note — why a single file**: The catalog is a compiled lookup index over all steps. A single JSON file is the natural shape for a lookup table: one GET request at startup, one in-memory parse, O(1) lookup by step name. The `snippet_examples/` folder is split because each file is a discrete XML artifact used individually — do not mirror that structure for the catalog. If the catalog grows significantly, the natural split would be per-category (14 files) with a `?category=` filter on the API, not per-step.

### Multi-Language Support

The `en` in `step-catalog-en.json` is the ISO 639-1 two-character language code for English. FileMaker's Script Workspace displays step names and parameter labels in the user's application language, so each supported language requires its own catalog file.

To add a language:

1. Duplicate `step-catalog-en.json` and rename it using the appropriate ISO 639-1 code (e.g., `step-catalog-de.json` for German, `step-catalog-fr.json` for French).
2. Open `agent/catalogs/UPDATING_CATALOGS.md` and note at the top which language file you are working on — the process is otherwise identical to the English catalog.
3. Work through the entries, replacing English `name`, `hrSignature`, `hrLabel`, and `enumValues` with their localized equivalents.

The webviewer's `/api/step-catalog` endpoint would need to be updated to accept a `?lang=` parameter (or read from user settings) to serve the appropriate file.

---

## AI Integration

Three provider options, selected in the AI Settings panel:

| Provider        | Implementation                                             | Notes                                                                  |
| --------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| Anthropic       | `src/ai/providers/anthropic.ts`                            | Direct API key, streams via SSE                                        |
| OpenAI          | `src/ai/providers/openai.ts`                               | Direct API key, streams via SSE                                        |
| Claude Code CLI | `server/claude-cli.ts` + `src/ai/providers/claude-code.ts` | Spawns `claude` subprocess; no API key needed if already authenticated |

The system prompt (`src/ai/prompt/system-prompt.ts`) provides the AI with context about the current CONTEXT.json, the step catalog, and FileMaker script conventions.

---

## FileMaker Bridge

When running inside a FileMaker WebViewer object (vs. a browser), the bridge layer enables bidirectional communication:

- **Detection** (`src/bridge/detection.ts`): Checks for `window.FileMaker` to determine runtime context
- **FM → Browser**: FileMaker calls a named JavaScript function via the WebViewer's `Perform JavaScript in Web Viewer` step
- **Browser → FM** (`src/bridge/fm-bridge.ts`): Calls `FileMaker.PerformScript(name, param)` to trigger FM scripts
- **Callbacks** (`src/bridge/callbacks.ts`): Routes incoming FileMaker calls to registered handlers

The app functions fully in a browser without FileMaker present; the bridge layer degrades gracefully.

---

## Autosave

FileMaker WebViewer objects reinitialize frequently (layout changes, window switches), which wipes any in-memory state. The autosave system persists the editor content across these cycles.

**Dual-layer storage:**

1. **localStorage** — written immediately on every edit (fast, synchronous)
2. **Server** (`agent/sandbox/.autosave.json`) — written via debounced POST (2s delay), survives localStorage wipes

**Restore logic on init:**

1. Try localStorage first
2. Fall back to server GET `/api/autosave`
3. Skip restore if content matches the default boilerplate

The StatusBar displays `Restored draft: <ScriptName>` when a draft is recovered.

---

## Development Workflow

```bash
# Start the dev server
cd webviewer
npm install          # first time only
npm run dev          # Vite dev server at http://localhost:8080

# In FileMaker: set the WebViewer URL to http://localhost:8080
# Or open in any browser for standalone use
```

The port is set to `8080` with `strictPort: true` in `vite.config.ts`. Change the `port` value there if a different port is needed.

**Environment** (copy `.env.example` → `.env.local`):

```
AGENT_DIR=../agent   # path to agent/ relative to webviewer/
```

**Build for production:**

```bash
npm run build        # outputs to webviewer/dist/
```

---

## Path Resolution

If a feature for the webviewer is being worked on within a git worktree, gitignored directories (`agent/context/`, `agent/xml_parsed/`) exist only in the main repository, not in the worktree copy. The `mainAgentDir()` function in `server/api.ts` handles this transparently:

1. Reads `.git` at the repo root
2. If `.git` is a _file_ (worktree indicator), parses the `gitdir:` path
3. Follows `<gitdir>/../..` to find the main repo root
4. Returns `<main-repo>/agent/`

Any endpoint that reads context or xml_parsed data uses `mainAgentDir()`. Endpoints that write (sandbox, autosave) use the local `agentDir()` so worktree writes don't bleed into the main repo.

---

## Catalogs Folder

`agent/catalogs/` contains the pre-compiled step catalog. The webviewer is the primary consumer; CLI agents also reference it for `hrSignature` lookups and parameter validation when composing scripts.

- `step-catalog-en.json` — one entry per FileMaker script step
- Originally generated from `snippet_examples/` + hardcoded step IDs and HR signatures

---

## Known Gaps / Future Work

- **Index file fallback in id-resolver**: Unresolved layout/field/script names that are absent from CONTEXT.json currently emit `id=0`. Adding a fallback to `agent/context/*.index` files would resolve names from the full solution.
- **Go to Related Record converter**: The hand-coded converter for this step is not yet implemented; falls back to catalog-driven (partial support).
- **Set Variable repetition syntax**: `$name[rep]` repetition notation is passed through as-is without validation.
- **Server-side conversion**: The `/api/convert/hr-to-xml` and `/api/convert/xml-to-hr` endpoints are stubs. A server-side converter would enable headless script conversion (CI pipelines, CLI calls without a browser).
