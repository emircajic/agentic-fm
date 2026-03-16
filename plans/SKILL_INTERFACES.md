# Skill Interface Contracts

Defines the agreed interfaces between skills — trigger phrases, inputs, outputs, and inter-skill dependencies. Agents must treat this document as authoritative before authoring any skill that calls or is called by another.

---

## Interface conventions

- **Inputs**: What the skill expects to exist or be provided before it runs
- **Outputs**: What the skill produces and where it writes it
- **Calls**: Other skills this skill invokes during execution
- **Called by**: Other skills that invoke this one

---

## Infrastructure

### Deployment module

Not a skill (not invoked by trigger phrase). A shared module (`agent/scripts/deploy.py`) called by every skill that produces fmxmlsnippet output. Documented here because it defines the interface between skills and the FileMaker deployment target.

**Interface**:
- **Input**: path to validated fmxmlsnippet XML file in `agent/sandbox/`, target script name (optional), deployment tier override (optional)
- **Output**: deployment result — success/failure, tier used, verification result (if Tier 2/3)
- **Behaviour by tier**:
  - **Tier 1** (universal): runs `clipboard.py write`, prints paste instructions to the developer
  - **Tier 2** (MBS): companion server writes XML to clipboard (`clipboard.py`), then calls `osascript` to tell FM Pro to run a MBS paste script client-side (`Clipboard.SetFileMakerData` + `ScriptWorkspace.OpenScript` + `Menubar.RunMenuCommand(57637)`); reads back via `ScriptWorkspace.ScriptText` to verify. **Note**: MBS ScriptWorkspace functions are UI automation — they require FM Pro client-side execution and cannot run via OData (server-side).
  - **Tier 3** (MBS + AppleScript): companion server additionally uses `osascript` to create N script placeholders in FM Pro's Script Workspace before pasting; otherwise identical to Tier 2
- **Tier selection**: reads `agent/config/automation.json` for the developer's default preference; skills can pass a tier override; if the requested tier fails, falls back to Tier 1
- **Config format** (`agent/config/automation.json`):
  ```json
  {
    "default_tier": 1,
    "project_tier": 3,
    "fm_app_name": "FileMaker Pro — 22.0.4.406",
    "companion_url": "http://local.hub:8765",
    "tiers": {
      "1": { "description": "Clipboard only", "requires": [] },
      "2": { "description": "MBS auto-paste", "requires": ["mbs_plugin"] },
      "3": { "description": "Full autonomy", "requires": ["mbs_plugin", "accessibility_permission"] }
    }
  }
  ```
  `fm_app_name` is used in `osascript` calls — must match the exact AppleScript application name (versioned, with em dash where applicable). `companion_url` is how the agent reaches the companion server from inside its container.

**Design constraint**: Tier 1 must always work. No skill should fail because a higher tier is unavailable.

---

### Hosting topologies

The full autonomous loop requires the agent to reach the FM solution's file system paths and (for Tier 2/3) trigger client-side script execution in FM Pro. The hosting topology determines what is possible.

| Topology | OData available | Companion → FM Pro trigger | xml_parsed accessible |
|---|---|---|---|
| **FMS in Docker container** (current) | Yes — via container URL | Yes — `osascript` on host, FM Pro opens hosted file | Yes — via volume mount |
| **FMS on local host** | Yes — via localhost | Yes — `osascript` on host | Yes — local project path |
| **FMS on network machine** | Yes — via LAN URL | Yes if companion runs on same machine as FM Pro | Yes if project is on same machine |
| **Local file only (no FMS)** | No | Yes — `osascript` triggers FM Pro directly | Yes — companion on same machine |

**Key principle**: all scenarios are valid. The agent must never assume a specific topology. The companion server and the FM-side scripts must detect and adapt.

**Detecting hosted vs local** — the `Get ( FilePath )` function reveals the hosting mode:
- `fmnet://{server}/{database}` — file is open from a FileMaker Server (any topology)
- `file:/{path}` (or `filewin:`, `filelinux:`, `filemac:`) — local file, no server

**Push Context must always run on the FM Pro client.** The `Context()` custom function captures the layout state of the client session — running it server-side (via OData) captures the server's isolated session, which is almost certainly on the wrong layout and will produce stale or incorrect context. OData is NOT a valid trigger path for Push Context.

**Explode XML** may be triggered via OData (it runs server-side and calls `Save a Copy as XML` + POSTs to the companion). This is fine — it does not depend on client layout context.

**The `/trigger` endpoint** (`POST /trigger` on the companion server, using `osascript do script`) is the correct mechanism for agent-initiated context refresh. It runs Push Context on the FM Pro client, which captures real client-side context and writes CONTEXT.json via FM file steps.

Push Context interactive mode (triggered with no parameter via `/trigger`) shows the task-description dialog to the developer. For silent/autonomous operation in a future enhancement, Push Context would need to fetch its task description from `GET /pending`.

The agentic-fm FM scripts should call `Get ( FilePath )` for topology awareness:
- **Hosted** (`fmnet:/`): OData triggering is available for Explode XML; `/trigger` is used for Push Context
- **Local**: OData unavailable for any script; `/trigger` is still available for Push Context; interactive mode only for Explode XML

The `/trigger` path works for both hosted and local files — it does not depend on OData.

---

### Webviewer output channel

Not a skill. A shared output routing layer consumed by every skill that produces HR script output. When the webviewer Vite server is running alongside a CLI/IDE session, skills route rich output through Monaco rather than printing plain text to the terminal. The terminal remains the primary interaction surface; Monaco is the rich display layer.

**Detection**: companion server exposes `GET /webviewer/status` — checks whether the `webviewer_url` configured in `automation.json` is reachable. Skills query this before deciding output routing.

**Interface**:
- **Config**: `automation.json` field `"webviewer_url": "http://localhost:5173"` — Vite dev server URL; omit or leave empty to disable
- **Companion endpoints** (to build):
  - `GET /webviewer/status` — returns `{ "available": true/false }`
  - `POST /webviewer/push` — forwards payload to webviewer via SSE; accepts `{ type, content, before? }`
- **Payload types**:
  - `"preview"` — display HR script in Monaco editor
  - `"diff"` — Monaco diff editor; `content` = proposed HR, `before` = current from `scripts_sanitized`
  - `"result"` — structured evaluation or other result output
- **Webviewer side**: persistent SSE connection from webviewer to companion; "Agent output" panel renders pushed content in Monaco; developer can edit inline and agent reads back via companion

**Routing rule**: skills always print a terminal summary regardless of webviewer availability. Webviewer delivery is additive, never a replacement.

**Design constraint**: every skill that produces HR output must check webviewer status and route accordingly from initial implementation — retrofitting later is costly.

| Skill | Monaco output type |
|---|---|
| `script-preview` | `preview` — HR with syntax highlighting |
| `script-refactor` | `diff` — current vs proposed side by side |
| Any script-generating skill | `preview` — HR output alongside XML in sandbox |
| `calc-eval` | `result` — expression + result + error context |
| `multi-script-scaffold` | `preview` — each script in sequence |

---

## Setup & Connectivity

### `context-refresh`

**Trigger phrases**: "refresh context", "push context", "update context", "re-export context"

**Inputs**:
- Developer is on the correct layout in FM Pro

**Outputs**:
- `agent/CONTEXT.json` written with current layout scope
- `agent/context/snapshot.xml` written alongside it (reference data snapshot)

**Workflow**:
1. Call `POST /trigger` on companion server with `{ "fm_app_name": ..., "script": "Push Context" }` — no parameter (interactive mode)
2. FM Pro activates, shows "Task description" dialog to developer
3. Developer confirms task → Push Context calls `Context()` client-side, writes CONTEXT.json via FM file steps, saves snapshot.xml
4. Agent reads updated `agent/CONTEXT.json`

**Critical constraint**: Push Context must ALWAYS be triggered via `/trigger` (client-side). Never call it via OData — `Context()` captures the client FM session layout, not the server's session.

**Calls**: `POST /trigger` on companion server

**Called by**: `multi-script-scaffold`

---

### `solution-export`

**Trigger phrases**: "explode XML", "export solution", "sync xml_parsed", "update xml_parsed"

**Inputs**:
- Developer has FM Pro open with the target solution

**Outputs**:
- `agent/xml_parsed/` fully refreshed

**Calls**: none

**Called by**: `solution-audit` (future), `solution-docs` (future), `migrate-out` (future), `migrate-native` (future)

---

## Schema & Data Model

### `schema-plan`

**Trigger phrases**: "design schema", "plan data model", "create ERD", "design tables"

**Inputs**:
- Natural language description of the application
- Optionally: existing SQL DDL, spreadsheet structure, or legacy schema

**Outputs**:
- `plans/schema/{solution-name}-erd.md` — Mermaid ERD (base tables only)
- `plans/schema/{solution-name}-fm-model.md` — FM-specific model with table occurrences and relationship specs

**Calls**: none

**Called by**: `solution-blueprint` (future)

---

### `schema-build`

**Trigger phrases**: "build schema", "create tables", "create fields", "run schema", "set up OData", "connect OData", "configure OData", "OData walkthrough", "relationship spec", "specify relationships", "define relationships", "relationship checklist"

A single skill with three sub-modes covering OData connection setup, schema creation, and relationship specification. This consolidates what was originally three separate skills (`odata-connect`, `schema-build`, `relationship-spec`) into one workflow to reduce interface overhead.

**Inputs**:
- `plans/schema/{solution-name}-fm-model.md` produced by `schema-plan`
- FM database name and server details (for OData connection)

**Outputs**:
- OData connectivity verified (account with `fmodata` extended privilege confirmed)
- Tables and fields created in live FM solution via OData
- `plans/schema/{solution-name}-build-log.md` — record of what was created
- `plans/schema/{solution-name}-relationships.md` — click-through checklist: TO names, join fields, cardinality, cascade delete settings

**Sub-modes**:
- **connect** — walk developer through OData setup (Docker-hosted FM Server, account and privilege setup, SSL handling, connection verification)
- **build** — execute table and field creation via OData REST calls, with transactional batching
- **relationships** — derive relationship specification from the FM model: TO names, join fields, cardinality, cascade delete settings, formatted as a click-through checklist

**Calls**: none

**Called by**: `solution-blueprint` (future)

---

## Scripts

### `multi-script-scaffold`

**Trigger phrases**: "multi-script", "scaffold scripts", "placeholder technique", "untitled placeholder"

**Inputs**:
- Description of the script system to build (number of scripts, interdependencies)
- Developer has FM Pro open
- Deployment tier preference (optional — defaults to `agent/config/automation.json`)

**Outputs**:
- All N scripts generated as fmxmlsnippet in `agent/sandbox/`
- Deployment via the deployment module, tier-dependent:
  - **Tier 1**: instruction to developer on how many placeholders to create, paste instructions per script, rename checklist
  - **Tier 2**: instruction to developer on how many placeholders to create; MBS auto-pastes into each; rename checklist
  - **Tier 3**: AppleScript creates N scripts automatically; MBS auto-pastes into each; agent renames via AppleScript; developer approves
- Rename checklist (Tiers 1–2) or verification summary (Tier 3)

**Calls**: `context-refresh` (to capture script IDs), deployment module (for output)

**Called by**: `solution-blueprint` (future)

---

### `calc-eval`

**Trigger phrases**: "evaluate this calculation", "check this calc", "validate expression", "test this formula", "does this calculation work", "is this calc valid"

**Inputs**:
- A calculation expression (inline in conversation or from current context)
- `agent/CONTEXT.json` — provides `current_layout.name` for navigation and `snapshot_path` for context reference
- OData connection available

**Outputs**:
- Terminal: validation summary — valid/invalid, result value, FM error code and description if any
- Webviewer (if available): full result in Monaco via `POST /webviewer/push` with `type: "result"`
- If invalid: identified cause (bad field ref, syntax error, unknown function) and proposed fix

**Workflow**:
1. Read `current_layout.name` from `CONTEXT.json`; note `snapshot_path` if present
2. Call `AGFMEvaluation` via OData → AGFMScriptBridge with `{ expression, layout }`
3. Interpret result:
   - Real value + `error_code: 0` → ✅ confirmed valid
   - `"?"` + `error_code: 0` → ⚠️ unverifiable — expression may be invalid OR valid with no data in server context; flag it, do not treat as confirmed
   - `error_code > 0` → ❌ FM error; report code and likely cause
   - Guard fired → ❌ bad parameter
4. Optionally ask companion to read `snapshot-eval.xml` and confirm layout matches `CONTEXT.json`
5. Route result to webviewer if channel available

**Known limitation**: `EvaluationError` does not catch most expression problems — bad field refs, division by zero, unknown functions, and unbalanced syntax all return `"?"` with `error_code: 0`. A real non-`"?"` result is the only reliable confirmation of a valid, executable expression.

**Calls**: none (direct OData call to `AGFMEvaluation` FM script)

**Called by**: agent proactively during script generation for any calculation it wants to verify — especially complex `Let()` blocks, JSON path expressions, field cross-references, and WebViewer data-passing expressions

---

### `implementation-plan`

**Trigger phrases**: "plan this", "plan before coding", "decompose requirements", "implementation plan"

**Inputs**:
- Natural language description of the script or feature to build
- `agent/CONTEXT.json` (current layout context)

**Outputs**:
- Written plan in conversation: steps, dependencies, edge cases, FM-specific constraints
- No file artifact unless developer requests one

**Calls**: none

**Called by**: `script-refactor`, `multi-script-scaffold`, `solution-blueprint` (future)

---

### `script-refactor`

**Trigger phrases**: "refactor", "improve this script", "clean up script", "modernise script"

**Inputs**:
- Target script identified (via `script-lookup` or direct sandbox path)
- `agent/CONTEXT.json` or index files for field/layout references

**Outputs**:
- Refactored script in `agent/sandbox/` as fmxmlsnippet
- Summary of changes made

**Calls**: `script-lookup` (if target script not already in sandbox), `implementation-plan`

**Called by**: `solution-audit` (future)

---

### `script-test`

**Trigger phrases**: "test this script", "write a test", "verification script", "assert results"

**Inputs**:
- Target script identified
- Expected inputs and outputs documented

**Outputs**:
- Companion verification script in `agent/sandbox/` as fmxmlsnippet
- Uses `fm-debug` companion server to report pass/fail

**Calls**: `fm-debug`

**Called by**: none (terminal skill)

---

### `script-debug`

**Trigger phrases**: "debug this", "script not working", "wrong output", "script error"

**Inputs**:
- Target script identified
- Error description or unexpected behaviour

**Outputs**:
- Diagnosis and fixed script in `agent/sandbox/`
- May produce debug instrumentation steps as interim output

**Calls**: `fm-debug`

**Called by**: none (terminal skill)

---

## Layout & UI

### `layout-design`

**Trigger phrases**: "design layout", "create layout objects", "build layout", "add fields to layout"

**Inputs**:
- Layout already exists in FM (developer has created the shell)
- `agent/CONTEXT.json` scoped to the target layout
- Design brief (fields, portals, buttons, UI intent)

**Outputs**:
- XML2-formatted layout objects in `agent/sandbox/` ready for clipboard
- Loaded to clipboard via `clipboard.py write`

**Calls**: none

**Called by**: `solution-blueprint` (future)

---

### `layout-spec`

**Trigger phrases**: "layout spec", "layout blueprint", "spec out layout", "describe layout"

**Inputs**:
- Design brief or feature description

**Outputs**:
- Written layout blueprint in conversation: object list, field bindings, portal config, button wiring, conditional formatting rules

**Calls**: none

**Called by**: `layout-design`, `solution-blueprint` (future)

---

### `webviewer-build`

**Trigger phrases**: "web viewer", "webviewer app", "HTML in FileMaker", "build web viewer"

**Inputs**:
- Feature description
- Data schema (from `agent/CONTEXT.json` or `schema-plan` output)

**Outputs**:
- HTML/CSS/JS web viewer content — either inline `Set Web Viewer` step or external file
- FM bridge scripts in `agent/sandbox/` (Perform JavaScript, JSON data passing)

**Calls**: none

**Called by**: `solution-blueprint` (future)

---

## Data

### `data-seed`

**Trigger phrases**: "seed data", "test data", "populate solution", "generate records"

**Inputs**:
- Schema exists in live FM solution
- OData connection verified (via `schema-build` connect sub-mode)
- Description of data volume and realism requirements

**Outputs**:
- Records created in live FM solution via OData
- Summary of what was seeded

**Calls**: none

**Called by**: none (entry point skill)

---

### `data-migrate`

**Trigger phrases**: "migrate data", "import records", "move data into FileMaker"

**Inputs**:
- Source data (CSV, SQL dump, JSON, API)
- Field mapping between source and FM fields
- OData connection verified (via `schema-build` connect sub-mode)

**Outputs**:
- Records created in live FM solution via OData
- Migration summary with error count and field mapping log

**Calls**: none

**Called by**: none (entry point skill)

---

## Future Potential

The following skill interfaces are defined for completeness but are **not part of the current implementation cycle**. They will be activated when the current phases are merged and stable. See `plans/PHASES.md` for status.

---

### `function-create`

**Trigger phrases**: "create custom function", "write a custom function", "translate formula", "new function"

**Inputs**:
- Plain-English description or equivalent formula from another language

**Outputs**:
- Custom function XML in `agent/sandbox/` as fmxmlsnippet (`XMFN` class)
- Loaded to clipboard via `clipboard.py write`

**Calls**: none

**Called by**: `solution-blueprint` (future)

---

### `privilege-design`

**Trigger phrases**: "privilege set", "access control", "design privileges", "account structure"

**Inputs**:
- Description of roles and access requirements

**Outputs**:
- Written privilege specification (roles, record-level access rules, extended privileges)
- Where possible: pasteable FM objects

**Calls**: none

**Called by**: `solution-blueprint` (future)

---

### `solution-blueprint`

**Trigger phrases**: "build a solution", "design an app", "full solution", "blueprint"

**Inputs**:
- Plain-English application description

**Outputs**:
- Ordered build sequence document in `plans/`
- Calls sub-skills in sequence to produce all artifacts

**Calls**: `schema-plan`, `schema-build`, `multi-script-scaffold`, `function-create`, `layout-spec`, `layout-design`, `webviewer-build`, `privilege-design`

**Called by**: none (entry point skill)

**Implementation note**: Ship first as a planning-only skill that produces a build sequence document and guides the developer through manual invocations of each sub-skill. Full orchestration follows once all sub-skills are proven stable.

---

### `solution-audit`

**Trigger phrases**: "audit solution", "review solution", "technical debt", "anti-patterns"

**Inputs**:
- `agent/xml_parsed/` populated (via `solution-export`)

**Outputs**:
- Written audit report: naming inconsistencies, missing error handling, anti-patterns, modernisation opportunities

**Calls**: `solution-export` (if xml_parsed is stale), `script-refactor` (for targeted fixes)

**Called by**: none (entry point skill)

---

### `solution-docs`

**Trigger phrases**: "document solution", "generate docs", "solution documentation"

**Inputs**:
- `agent/xml_parsed/` populated

**Outputs**:
- `plans/docs/{solution-name}-documentation.md` — schema, relationships, script inventory, custom functions, privilege sets

**Calls**: `solution-export` (if xml_parsed is stale)

**Called by**: none (entry point skill)

---

### `migrate-out`

**Trigger phrases**: "migrate out of FileMaker", "replace FileMaker", "WebDirect to web", "export to web"

**Inputs**:
- DDR XML export from FileMaker
- Optionally: WebDirect rendered HTML captures

**Outputs**:
- SQL schema DDL
- REST API design document
- UI component specifications
- Technology stack recommendation

**Calls**: `solution-export` (if xml_parsed needed as supplement)

**Called by**: none (entry point skill)

---

### `migrate-native`

**Trigger phrases**: "migrate to iOS", "native app", "SwiftUI from FileMaker", "Xcode project"

**Inputs**:
- `agent/xml_parsed/` layouts populated

**Outputs**:
- Xcode project scaffold with SwiftUI or UIKit views replicating layout structure

**Calls**: `solution-export` (if xml_parsed stale)

**Called by**: none (entry point skill)

---

### `migrate-in`

**Trigger phrases**: "migrate into FileMaker", "import schema", "bring data into FileMaker"

**Inputs**:
- Source schema (SQL DDL, ORM model, or spreadsheet)
- OData connection verified

**Outputs**:
- OData calls to create tables and fields
- FM script equivalents of source business logic in `agent/sandbox/`
- Layout specifications for source UI equivalents

**Calls**: `schema-build` (connect + build sub-modes)

**Called by**: none (entry point skill)
