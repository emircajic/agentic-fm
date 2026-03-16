# Deployment Module — Build Status

Session-persistent notes on what was built, every quirk discovered, and where to resume. Read this at the start of any session continuing deployment work.

---

## What was built

### `agent/scripts/deploy.py`
CLI + importable module. Reads `agent/config/automation.json`. Three tiers:
- **Tier 1**: POSTs XML to companion `/clipboard`, returns paste instructions
- **Tier 2**: `/clipboard` + `/trigger` → Agentic-fm Paste auto-pastes via MBS
- **Tier 3**: `/clipboard` (pre-load) + `raw_applescript` via `/trigger` → creates+renames+saves new script, then Cmd+A+Cmd+V inline — no Agentic-fm Paste involved

CLI usage:
```bash
python3 agent/scripts/deploy.py <xml_path> [target_script] [--tier N] [--auto-save] [--no-auto-save] [--replace | --append]
```

**Tier 2 destructive-paste protection**: When deploying to an existing script via Tier 2 without `--replace` or `--append`, the CLI prompts:
```
Script 'My Script' will be modified.
  [r] Replace — select all existing steps and paste (destructive)
  [a] Append  — paste after existing steps
  [c] Cancel
Choice [r/a/c]:
```
- `--replace`: skips prompt, always replaces (select all + paste)
- `--append`: skips prompt, always appends (paste only, no select all)
- No flag: interactive prompt required before proceeding

### `agent/config/automation.json`
Key fields: `default_tier`, `project_tier`, `auto_save`, `fm_app_name`, `companion_url`.
- `default_tier: 1` — safe default for new developers
- `project_tier: 3` — target for this project (once Tier 3 proven)
- `auto_save: false` — override per deploy with `--auto-save`
- `fm_app_name` must match the exact AppleScript application name including em dash and version: `"FileMaker Pro — 22.0.4.406"`

### `agent/sandbox/Agentic-fm Paste.xml`
MBS-powered FM script. Installed in the solution. Called by companion `/trigger` via AppleScript `do script`. Flow:
1. `GET localhost:8765/pending` → retrieves `target` (script name), `auto_save` flag, `select_all` flag
2. `Open Script Workspace` step
3. `MBS("ScriptWorkspace.OpenScript"; $target)`
4. 0.5s busy-wait loop (no Pause/Resume — it steals focus)
5. If `$selectAll`: `MBS("Menubar.RunMenuCommand"; 57636)` — Select All (replace mode)
6. `MBS("Menubar.RunMenuCommand"; 57637)` — Paste
7. If `$autoSave`: `Perform AppleScript [ tell application "System Events" to keystroke "s" using {command down} ]`

`select_all` defaults to `True` if absent from `/pending` JSON (safe default = replace). Set to `False` for append mode.

### Companion server additions (`agent/scripts/companion_server.py`)
New endpoints:
- `GET /pending` — returns and clears `{target, auto_save, select_all}` job set by last `/trigger` call
- `POST /pending` — sets the pending job directly (for testing); accepts `target`, `auto_save`, `select_all`
- `POST /clipboard` — writes XML to macOS clipboard via `clipboard.py`
- `POST /trigger` — fires `osascript` to `do script` in FM Pro; sets pending job before firing; accepts `select_all` (default `true`)

---

## Critical quirks discovered (do not re-learn these)

### System Events process name differs from AppleScript application name
`tell application "FileMaker Pro — 22.0.4.406"` uses the versioned name with em dash. But `tell process "..."` inside `tell application "System Events"` requires the base process name: `"FileMaker Pro"` — no version, no em dash. Using the versioned name in `tell process` causes a `-1728` error (object not found). Derive the process name by splitting `fm_app_name` on ` — ` and taking the first part.

### Script Workspace menu item errors when already open
`click menu item "Script Workspace..." of menu "Scripts" of menu bar 1` errors if the workspace is already open. Wrap in `try / end try` — if it errors the workspace is already open and you can proceed. If it succeeds, add `delay 1.0` before the next action.

### Save required before `do script` in Tier 3
After creating and renaming a script, it has unsaved changes. FM Pro blocks the next `do script` call (from Agentic-fm Paste) with an unsaved-scripts dialog. Always `keystroke "s" using {command down}` at the end of the Tier 3 AppleScript before returning.

### AppleScript parameter passing is broken in FM Pro 22
`do script "ScriptName" given parameter:"value"` compiles without error but `Get(ScriptParameter)` returns empty inside the triggered script. `with parameter "string"` gives a syntax error. **Workaround**: companion server stores the target in `/pending` before firing `do script`. FM script GETs `/pending` via Insert from URL.

### `Pause/Resume Script` steals focus
Using `Pause/Resume Script [Duration: 0.5]` between `ScriptWorkspace.OpenScript` and the MBS menubar commands causes a system beep — the pause yields UI focus away from Script Workspace. **Use a busy-wait loop instead**:
```
Set Variable [ $waitUntil ; Get(CurrentHostTimestamp) + .5 / 86400 ]
Loop
  Exit Loop If [ Get(CurrentHostTimestamp) ≥ $waitUntil ]
End Loop
```

### `menu bar` and `menu bar 1` both fail in Perform AppleScript
`tell me to do menu item "Save All Scripts" of menu "Scripts" of menu bar` → "variable bar not found"
`tell me to do menu item "Save All Scripts" of menu "Scripts" of menu bar 1` → "A number can't go after this identifier"
FileMaker's built-in AppleScript parser rejects both. **Use System Events keystroke instead**:
`tell application "System Events" to keystroke "s" using {command down}`
Requires FM Pro to have Accessibility access in System Preferences → Privacy & Security → Accessibility.

### `MBS("ScriptWorkspace.SaveScript")` does not exist
Not a real MBS function. Use the System Events keystroke approach above.

### Agentic-fm Paste cannot deploy itself via Tier 2
`do script "Agentic-fm Paste"` triggers the script, which then opens itself in Script Workspace and attempts to replace its own steps while it is currently executing. FileMaker reverts or blocks changes to a running script's steps. Small pastes (1 step) may appear to succeed; larger replacements silently fail. **Always use Tier 1 (manual paste) to update Agentic-fm Paste itself.** This is not a real-world limitation — in normal use Agentic-fm Paste deploys other scripts.

### Script Workspace paste does NOT replace a selection — must delete first
Cmd+A selects all script steps, but Cmd+V does **not** overwrite the selection. The new steps are appended instead. The correct replace sequence is:
1. `Cmd+A` — select all steps
2. `Delete` (key code 51) — delete selected steps
3. `Cmd+V` — paste new steps

This is unlike standard text editors. Skipping the Delete step results in silent append regardless of what is selected.

### `Open Script Workspace` FM step requires FM to be frontmost
When FM is backgrounded, `Open Script Workspace` runs but the workspace either doesn't open or opens behind other windows, making subsequent MBS and System Events operations unreliable. Fix: `tell me to activate` with `delay 1.0` must run **before** `Open Script Workspace`, giving macOS time to fully bring FM to front.

### `window 1` and `front window` are unreliable in System Events for Script Workspace
`tell window 1` errors with "Invalid index" when FM is backgrounded and the Script Workspace is not the first window in the accessibility tree. `front window` has the same underlying issue. **Use `windows whose title contains "Script Workspace"` to find the window by name.**

### Script Workspace focus: sidebar vs step editor
The Script Workspace split group contains two distinct focus zones:
1. **Script list sidebar** (left) — `Cmd+A` here selects all scripts; `Delete` shows "delete all N scripts?" dialog
2. **Step editor** (right) — `Cmd+A` here selects all steps; `Delete` removes them

After `MBS("ScriptWorkspace.OpenScript")`, focus remains in the sidebar. The script tab opens (visible in the tab bar as `button [Scripting TabView]`) but is not active. Two clicks are required to get focus into the step editor:
1. Click the tab button: `click button "$target" of splitter group 1` — activates the tab
2. Click the SEFabricView: iterate `scroll areas` of the split group, `click table 1 of sa` — focuses the step editor

**Current state**: two-click approach implemented in `agent/sandbox/Agentic-fm Paste.xml` but **not yet confirmed working**. This is where testing was left off.

### Cmd+S shortcut opens Script Workspace but hits layout window when backgrounded
`keystroke "s" using {command down, shift down}` was attempted as an alternative to the `Open Script Workspace` FM step. When FM layouts are frontmost, the keystroke is misinterpreted — FM shows the "Before typing, press Tab or click in a field" dialog. Do not use this approach; rely on the `Open Script Workspace` FM step with `tell me to activate` + `delay 1.0` before it.

### MBS `Menubar.RunMenuCommand` is panel-focus-sensitive in Script Workspace
`MBS("Menubar.RunMenuCommand"; 57636)` (Select All) operates on whatever panel is active in the Script Workspace. If focus lands on the script list panel (left) rather than the step editor (right), it selects scripts rather than steps — paste then treats it as an empty selection and appends silently. **Use System Events keystrokes instead**: `keystroke "a" using {command down}` and `keystroke "v" using {command down}` go directly to the frontmost FM Pro window and are not affected by which panel is focused.

### System beep after deploy = paste likely failed
`Cmd+S` (auto_save) beeps when the script has no unsaved changes. If a developer hears a system beep immediately after a Tier 2 deploy with `auto_save` on, it almost certainly means the paste step didn't land — the script opened correctly but no steps were written, so FileMaker had nothing to save. Check that FM Pro was frontmost and the Script Workspace had focus.

### Use `tell me to activate` inside `Perform AppleScript`, not `tell application "FileMaker Pro" to activate`
When FileMaker executes a `Perform AppleScript` step, the script context is already inside FileMaker. `tell me` refers directly to the running FM application object. Using `tell application "FileMaker Pro" to activate` spawns an external AppleScript process talking back to FM, which can behave differently (slower, or not bringing the correct window to front). Always use `tell me to activate` in `Perform AppleScript` steps when the intent is to bring FileMaker itself to the foreground.

### AppleScript `activate` is required
Without `activate` in the AppleScript template, FM Pro stays in the background. MBS commands execute against whatever window is frontmost (not FM). Added to all `/trigger` AppleScript templates.

### FM blocks script execution with unsaved-scripts dialog
FileMaker will show a dialog and block `do script` if any scripts have unsaved changes in the Script Workspace. Agentic-fm Paste itself must be saved before running deployments. The `--auto-save` flag calls "Save All Scripts" at the end to clean up for subsequent runs.

### `fmextscriptaccess` required
The extended privilege "Allow Apple events and ActiveX to perform FileMaker operations" must be enabled on the account's privilege set in Manage Security. Without it, `do script` returns `-10004` at runtime. No compile error.

### Script Workspace must be open before paste (cold-start timing)
When Script Workspace is closed, `Open Script Workspace` + `ScriptWorkspace.OpenScript` triggers it to open and navigate. The 0.5s busy-wait is essential here — without it, the MBS paste commands fire before the workspace has finished rendering and either beep or paste into the wrong location.

### MBS menubar command IDs for Script Workspace
- `57636` = Select All (Edit menu in Script Workspace context)
- `57637` = Paste (Edit menu in Script Workspace context)
These were verified working for Tier 2. Do not change without testing.

### MBS paste does not work after System Events manipulation of Script Workspace
`Menubar.RunMenuCommand(57637)` (Paste) fails silently after System Events has been used to create/rename a script in Tier 3. System Events `keystroke "v" using {command down}` works correctly in the same state. Tier 3 therefore does not delegate to Agentic-fm Paste — it performs `Cmd+A` + `Cmd+V` inline at the end of the same AppleScript block, with the clipboard pre-loaded before the script fires.

---

## Current status

| Feature | Status |
|---|---|
| Tier 1 (clipboard + manual paste) | ✅ Working |
| Tier 2 (auto-paste into existing script) | ✅ Working |
| Tier 2 auto-save (`--auto-save`) | ✅ Working |
| Tier 2 destructive-paste prompt (`--replace` / `--append`) | ✅ Working |
| Tier 2 replace mode (Cmd+A → Delete → Cmd+V) | ✅ Working (FM foregrounded) |
| Tier 2 replace mode with FM backgrounded | 🔴 In progress — focus not landing in step editor |
| Tier 2 append mode (`select_all=false`) | ✅ Working |
| `/pending` endpoint | ✅ Working |
| Tier 3 (create + rename + save + inline paste via host AppleScript) | ✅ Working |
| Context refresh via `/trigger` → Push Context (client-side) | ✅ Working |

---

## What to do next

### 🔴 Fix Tier 2 replace with FM backgrounded (in progress)
The two-click approach (tab button + SEFabricView) is implemented in `agent/sandbox/Agentic-fm Paste.xml` but not yet tested. To resume:

1. Load and manually install the latest Agentic-fm Paste:
   ```bash
   python3 agent/scripts/deploy.py "agent/sandbox/Agentic-fm Paste.xml" --tier 1
   ```
   Then open **Agentic-fm Paste** in Script Workspace → **⌘A** → **⌘V**

2. Use **Sandbox (ID 269)** as the test target — it's safe to overwrite
3. Close workspace, background FM, run:
   ```bash
   python3 agent/scripts/deploy.py "agent/sandbox/test-steps.xml" "Sandbox" --tier 2 --replace
   ```
4. Check Sandbox has the 3 comments + 2 Set Variable steps
5. If focus still lands in script list, open Accessibility Inspector and check where the scroll area containing SEFabricView sits in the split group index — may need to adjust which scroll area index is iterated

**Do NOT use Agentic-fm Paste itself as the test target** — a script cannot reliably replace its own steps while executing (FM reverts or blocks changes to the running script).

### Test context refresh via `/trigger`
Verify the full Tier 2/3 context refresh path:
1. Make sure FM Pro is open on the desired layout
2. Call `POST /trigger` on companion with `{ "fm_app_name": "FileMaker Pro — 22.0.4.406", "script": "Push Context" }`
3. Confirm FM Pro activates and shows the task-description dialog
4. Confirm `agent/CONTEXT.json` is written with the correct layout and `snapshot_path`/`snapshot_timestamp` fields
5. Confirm `agent/context/snapshot.xml` exists

Expected failure mode: if Push Context (interactive mode) is not yet installed with the snapshot additions, `snapshot_path` will be absent from the output. Tier 1-install the updated `agent/sandbox/Push Context.xml` first.

### Run Explode XML
Once Agentic-fm Paste is confirmed stable, run `Explode XML` in FM Pro to export the solution and get Agentic-fm Paste (and any other agentic-fm scripts) into `xml_parsed/`. This is the canonical record of what's installed in the solution.

### Set `auto_save: true` in automation.json for project use
When confident in the deployment loop, flip `auto_save` to `true` in `automation.json` to remove the `--auto-save` flag requirement.

### Build AGFMEvaluation script
Once the deployment loop is stable, build the `AGFMEvaluation` FM script (see design below) and install it in the Invoice Solution. Then update `Push Context` to save a reference snapshot alongside `CONTEXT.json`.

---

## AGFMEvaluation + Snapshot (planned)

### Purpose
Allows the agent to validate FileMaker calculation expressions at runtime against a live hosted solution. Bridges the gap between static XML generation and confirmed-correct calculation code.

### Confirmed: `Save Records as Snapshot Link` works server-side
Tested via OData → Sandbox script. The step executes without error and writes the file to `Get(DocumentsPath)` inside the FMS container. This enables both client-side reference snapshots and server-side verification snapshots.

### Context refresh architecture

**Push Context must always run on the FM Pro client.** `Context()` captures the layout state of the active client FM session. Running it server-side via OData produces the server's isolated session context (wrong layout, wrong data). Confirmed: OData call to Push Context produced `"Dashboard"` when the client was on `"Invoices Details"`.

**Correct Tier 2/3 context refresh flow**:
1. Agent calls `POST /trigger` → `{ "fm_app_name": ..., "script": "Push Context" }` (no parameter = interactive mode)
2. Companion fires `osascript do script "Push Context"` on FM Pro client
3. FM Pro shows task-description dialog; developer confirms
4. Push Context calls `Context()` client-side, writes CONTEXT.json via FM file steps, saves snapshot.xml
5. Agent reads updated CONTEXT.json

**OData is not a valid context refresh path.** Use OData only for Explode XML (server-side, topology-correct) and AGFMEvaluation (server-side calc evaluator — intentionally server context).

### Path decisions
- **`CONTEXT.json` stays at `agent/CONTEXT.json`** — no refactor. The context subdirectory (`agent/context/`) holds index files and will also hold the reference snapshot.
- **Client reference snapshot**: `agent/context/snapshot.xml` — written by Push Context (client-side, via `/trigger` + `do script`), readable directly by the agent from the repo filesystem
- **Server verification snapshot**: `Get(DocumentsPath) & "snapshot-eval.xml"` — written by AGFMEvaluation server-side, readable by companion (same path mechanism as Explode XML)
- **`snapshot_path` field added to `CONTEXT.json`** — Push Context writes the absolute path of the reference snapshot so the agent always knows where to find it without guessing

### AGFMEvaluation script design

**Triggered via**: OData → AGFMScriptBridge → `do script "AGFMEvaluation"`

**Parameter** (JSON):
```json
{ "expression": "Sum ( LineItems::ExtendedPrice )", "layout": "Invoices Details" }
```

**Script flow**:
1. Parse parameter JSON → `$expression`, `$layout`
2. `Go to Layout [ $layout ]`
3. `Set Variable [ $errorCode ; EvaluationError ( Evaluate ( $expression ) ) ]`
4. `Set Variable [ $result ; If ( $errorCode = 0 ; Evaluate ( $expression ) ; "" ) ]`
5. `Save Records as Snapshot Link [ Get(DocumentsPath) & "snapshot-eval.xml" ]`
6. `Exit Script [ { success, error_code, result, expression } ]`

**Return** (confirmed valid — result is a real value):
```json
{ "success": true, "error_code": 0, "result": "4", "expression": "2 + 2", "layout": "Dashboard" }
```

**Return** (ambiguous — `"?"` with error_code 0):
```json
{ "success": true, "error_code": 0, "result": "?", "expression": "Sum ( LineItems::ExtendedPrice )", "layout": "Invoices Details" }
```

**Return** (parameter error — bad JSON):
```json
{ "success": false, "error": "Invalid parameter: expected JSON object" }
```

### Critical limitation: `EvaluationError` catches almost nothing

Tested and confirmed: FM returns `"?"` with `error_code: 0` for all of the following:
- Invalid `Get()` parameter name (`Get(NonExistentFunc)` → `"?"`, code 0)
- Syntax errors / unbalanced expressions (`If ( 1 = 1 ; "yes"` → `"?"`, code 0)
- Non-existent field references (`Invoices::NonExistentField999` → `"?"`, code 0)
- Division by zero (`1 / 0` → `"?"`, code 0)

FM converts most expression problems to `"?"` rather than raising a numbered error. `EvaluationError` is not a reliable syntax checker.

### Agent interpretation rules for `calc-eval`

| result | error_code | Interpretation |
|---|---|---|
| Real value (not `"?"`) | 0 | ✅ Confirmed valid — expression ran and produced data |
| `"?"` | 0 | ⚠️ Unverifiable — expression may be invalid OR valid with no data in context |
| `"?"` | 0 on `Sum`/aggregate | ℹ️ Likely valid but no records in found set server-side — needs client context |
| Any | > 0 | ❌ FM error — check error code |
| (guard fired) | — | ❌ Bad parameter — not a JSON object |

When result is `"?"`: agent should flag it as unverifiable and note that a real-value confirmation requires the developer to have data in context (via a reference snapshot from Push Context).

### Push Context update (planned)
Add two steps after the existing CONTEXT.json write:
1. `Save Records as Snapshot Link [ $$AGENTIC.FM & "/agent/context/snapshot.xml" ; Records being browsed ]`
2. Include `snapshot_path` and `snapshot_timestamp` in the CONTEXT.json output

### Agent verification (optional)
After `AGFMEvaluation` returns, the agent can ask the companion to read `snapshot-eval.xml` and confirm the layout name matches `CONTEXT.json current_layout.name`. A mismatch means context was not established correctly — developer needs to re-run Push Context.

---

## Key files

| File | Purpose |
|---|---|
| `agent/scripts/deploy.py` | Deployment module — CLI + importable |
| `agent/scripts/companion_server.py` | HTTP companion server on host |
| `agent/config/automation.json` | Tier config, fm_app_name, companion_url, auto_save, webviewer_url |
| `agent/sandbox/Agentic-fm Paste.xml` | FM script — MBS auto-paste (install in solution) |
| `agent/sandbox/AGFMEvaluation.xml` | FM script — server-side calc evaluator (planned, install in solution) |
| `agent/CONTEXT.json` | Schema/layout context — written by Push Context, read by agent |
| `agent/context/snapshot.xml` | Reference data snapshot — written by Push Context (planned) |
| `agent/docs/COMPANION_SERVER.md` | Full endpoint reference |
| `plans/SKILL_INTERFACES.md` | Deployment module contract for skills |
| `plans/WEBVIEWER_STATUS.md` | Webviewer output channel build status and test plan |
