# Vision: AI-Generated FileMaker Solutions

## The Core Problem

FileMaker is a closed, proprietary platform. Unlike traditional software development where an AI agent can read and write source files directly, FileMaker stores everything — scripts, layouts, fields, custom functions, value lists — in a binary database format that is opaque to the outside world.

There is no source directory to commit. There is no text file to edit. There is no terminal command to deploy a change.

The only sanctioned interface between the outside world and FileMaker's internal object model is the **clipboard** — and even that is proprietary. FileMaker does not use plain text. It encodes its objects as binary descriptors keyed to four-letter class codes (`XMSS`, `XML2`, `XMFD`, etc.) that must be read and written via the macOS Pasteboard API.

## The Bridge

This project is built on a single critical insight: **FileMaker's clipboard format can be round-tripped through XML.**

Every major FileMaker object type — scripts, layout objects, field definitions, custom functions, tables, value lists, and more — has a corresponding XML representation that FileMaker will accept from the clipboard. The `clipboard.py` helper handles the binary encoding in both directions.

This creates a viable path for an AI agent to author FileMaker solutions:

```
AI generates XML  →  clipboard.py writes to clipboard  →  Developer pastes into FileMaker
```

The developer becomes the deployment mechanism — a thin human bridge between AI output and the FileMaker environment. Their only manual action is `⌘V`.

## The Object Surface

FileMaker objects fall into three categories based on how an AI agent can interact with them.

### 1. Clipboard-Generated Objects

These objects are authored as XML and transferred into FileMaker via the clipboard (`clipboard.py`). The developer pastes them directly into the appropriate FileMaker workspace:

| Object Type       | Clipboard Code | XML Element        | Paste Destination       |
| ----------------- | -------------- | ------------------ | ----------------------- |
| Script Steps      | `XMSS`         | `<Step>`           | Script Workspace        |
| Full Scripts      | `XMSC`         | `<Script>`         | Script Workspace        |
| Field Definitions | `XMFD`         | `<Field>`          | Manage Database         |
| Custom Functions  | `XMFN`         | `<CustomFunction>` | Manage Custom Functions |
| Tables            | `XMTB`         | `<BaseTable>`      | Manage Database         |
| Value Lists       | `XMVL`         | `<ValueList>`      | Manage Value Lists      |
| Themes            | `XMTH`         | `<Theme>`          | Theme browser           |
| Custom Menus      | `ut16`         | `<CustomMenu>`     | Manage Custom Menus     |
| Custom Menu Sets  | `ut16`         | `<CustomMenuSet>`  | Manage Custom Menus     |

### 2. API-Managed Schema

FileMaker exposes its schema through external interfaces that can be used programmatically against a live hosted solution. Research confirms that **OData is the clear winner** for schema creation. Here is the breakdown:

#### OData (Recommended)

OData is the primary path for automated schema management. It requires no layout, supports transactional batching, and provides full DDL capability for tables and fields:

- **Create a table**: `POST /fmi/odata/v4/{database}/FileMaker_Tables` with a JSON body defining the table name and initial fields
- **Add fields**: `PATCH /fmi/odata/v4/{database}/FileMaker_Tables/{tableName}` with an array of field definitions
- **Supported field types**: `NUMERIC`, `DECIMAL`, `INT`, `DATE`, `TIME`, `TIMESTAMP`, `VARCHAR`, `BLOB`/`VARBINARY` (container)
- **Transactional batching**: multiple schema operations can be submitted together — if one fails, all revert
- **Run scripts**: `POST /fmi/odata/v4/{database}/Script/{ScriptName}` with optional `{ "scriptParameterValue": "..." }` body; scripts run server-side and return JSON
- **Required privilege**: account must have the `fmodata` extended privilege and Full Access for schema operations

#### FileMaker Data API

The Data API is **not suitable for schema creation**. It requires an existing layout for every operation — you cannot query or create schema objects without a layout reference. It remains the best tool for record-level CRUD at runtime once a schema exists.

#### SQL via ODBC/JDBC

FileMaker supports `CREATE TABLE`, `ALTER TABLE`, and `CREATE INDEX` via ODBC/JDBC drivers. However this approach requires a client driver installed on the agent machine and a persistent connection. For automated agent use, OData REST calls are far simpler to issue and require no driver setup. SQL/ODBC is a fallback, not a primary channel.

#### Critical Limitation: Relationships Cannot Be Created via Any API

**No external API — OData, Data API, or SQL — can create or modify the FileMaker relationship graph.** This is a hard platform constraint as of FileMaker 2025. Relationships must be defined manually in the Manage Database / Relationships dialog. The OData API can _traverse_ existing relationships in queries, but cannot create them.

This means the schema creation workflow for a new solution is:

1. Agent creates tables and fields via OData
2. **Developer manually creates relationships** in the relationship graph
3. Agent continues with scripts, menus, custom functions, and layout objects via clipboard

### 3. Layout Objects — Composable; Layouts Themselves — Not

There is an important distinction between a **layout** and the **objects on a layout**.

**Layouts cannot be programmatically created.** FileMaker provides no API, clipboard format, or external interface for creating a new layout. The developer must create the layout manually in Layout Mode first.

**Layout objects, however, can be AI-composed and pasted.** Once a layout exists, the `XML2` clipboard class allows arbitrary layout objects — fields, portals, buttons, text labels, rectangles, web viewers, popovers, tab controls, slide controls, and more — to be authored as XML and pasted directly onto the layout. The full XML structure for every layout object type is documented in `xml_parsed/`, which contains complete exports from the Invoice Solution.

| Object Type    | Clipboard Code | Notes                                        |
| -------------- | -------------- | -------------------------------------------- |
| Layout Objects | `XML2`         | Paste into an existing layout in Layout Mode |

What the project can do with layouts:

- **Compose layout objects**: Generate `XML2`-formatted XML for fields, portals, buttons, and other UI elements, loaded onto the clipboard and pasted into a layout the developer has already created
- **Read and understand existing layouts**: `xml_parsed/` contains the full XML export of every layout in the solution, including object positions, styles, field bindings, portal definitions, and conditional formatting — a complete reference for composing new objects that match the solution's conventions
- **Inform script generation**: Layout object IDs, field placements, and portal configurations from `xml_parsed/` can inform scripts that interact with specific layout elements
- **Specify new layouts**: When a net-new layout is needed, the agent can produce a precise specification — object list, field bindings, portal configuration, button wiring — that the developer uses as a build guide before the agent populates the layout with composed objects

## Scope: All of FileMaker Development

agentic-fm is not a greenfield solution generator. It is an AI development partner designed to assist at every stage and scale of FileMaker work — from a single script fix to a complete application build.

**Day-to-day development assistance** is the immediate and primary use case:

- A developer is building a feature and needs a script written, reviewed, or refactored
- A calculation isn't returning the right value and needs debugging
- A set of custom functions needs to be authored and loaded into the solution
- A value list, custom menu, or privilege set needs to be created or updated
- A layout needs new objects — a portal, a popover, a set of fields — placed and wired up
- An existing script needs to be extended without breaking what already works

**Enhancement of existing solutions** is equally central:

- Reading existing scripts from `xml_parsed/` to understand current behavior before proposing changes
- Identifying logic that can be simplified, consolidated, or made more robust
- Adding error handling, logging, or parameterization to scripts that currently have none
- Generating missing pieces that a solution needs — a utility script, a missing field, a complementary menu item — without touching what already exists

**Full solution generation** is the long-horizon capability:

- Designing the data model, scripting the workflows, specifying the layouts, and configuring the menus for an entirely new application from a natural language description
- Assembling a solution in sequenced steps across OData schema calls and clipboard paste operations

The project is designed to serve all three scales. Every tool, catalog, context file, and convention in the project exists to make the agent effective at any of them — not just the ambitious end of the spectrum.

## The Grand Vision

The goal is to enable an AI agent to **design and generate a complete FileMaker solution from a natural language description** — not just individual scripts, but the entire application — using every available channel to its fullest extent:

- **Data model** (OData + one manual step): tables and fields created programmatically via OData REST calls; relationships specified by the agent but created manually by the developer — the one operation no external API supports
- **Business logic** (clipboard): scripts for every workflow, with error handling, parameter conventions, and modular design
- **Configuration** (clipboard): value lists, custom functions, custom menus, and privilege set logic
- **UI objects** (clipboard): fields, portals, buttons, popovers, tab controls, and other layout objects composed as `XML2` XML and pasted onto layouts the developer has already created; the full object vocabulary is available in `xml_parsed/`
- **Layout scaffolding** (agent-specified): since the layout container itself cannot be created programmatically, the agent specifies what each new layout needs — name, base table occurrence, object list — so the developer can create it in seconds before the agent populates it

A developer should be able to describe an application in plain English and receive:

1. A schema built automatically via API calls to a hosted FileMaker solution
2. A set of clipboard-ready XML artifacts (scripts, custom functions, value lists, menus) to paste in sequence
3. For each layout: a brief manual step to create the layout, followed by AI-composed layout objects pasted directly onto it

## Migrations

A significant class of work in the FileMaker ecosystem involves moving — either bringing a solution onto the platform or taking it off. agentic-fm is designed to support both directions, treating the exported XML and the live API surface as the raw material for migration tooling.

### Migrating Out of FileMaker

Many FileMaker solutions represent years of business logic, UI design, and workflow knowledge. When an organization decides to move to a different technology, that knowledge should not be thrown away — it should be translated. The agent can read the full XML export of a solution and use it as a specification for rebuilding the application in another environment.

**WebDirect → Web Application**

FileMaker WebDirect renders layouts as HTML in a browser. That rendered HTML — combined with the layout XML in `xml_parsed/` — provides a complete template for replicating the UI in a modern web stack:

- The layout XML describes field placement, portal structure, tab panels, button wiring, and conditional formatting rules
- The WebDirect HTML output captures the rendered visual result, including applied styles and layout structure
- Together these give the agent enough information to produce semantically equivalent HTML, CSS, and component structure in any target framework (React, Vue, HTMX, plain HTML/CSS, etc.)
- Business logic encoded in FileMaker scripts can be analyzed and rewritten as server-side or client-side code in the target language

**Layout XML → Native Application (iOS/macOS/Android)**

The `xml_parsed/` layout exports contain precise specifications: object positions, dimensions, field bindings, portal definitions, button actions, and visual styling. This is sufficient to drive generation of a native application UI:

- Layout objects map to native UI components — fields become text inputs, portals become list/table views, tab panels become tab bars or segmented controls, popovers become sheets or popovers
- The agent can read a layout export and produce Xcode project scaffolding with UIKit view controllers or SwiftUI views that replicate the layout's structure and behavior
- FileMaker scripts translate to Swift functions or view model methods
- Relationships and data access patterns translate to Core Data models or API client calls

### Migrating Into FileMaker

Organizations moving from spreadsheets, legacy databases, or custom web applications into FileMaker need the reverse: their existing data model and workflows need to become FileMaker tables, fields, relationships, scripts, and layouts. The agent can:

- Analyze an existing schema (SQL DDL, an ORM model, a spreadsheet structure) and generate the equivalent FileMaker table and field definitions via OData
- Translate existing business logic (formulas, stored procedures, server-side scripts) into FileMaker scripts delivered via clipboard
- Map an existing UI to a set of FileMaker layout specifications ready for the developer to implement

### Migrations to Other Technologies

Beyond FileMaker-specific targets, the agent can use the solution export as a source of truth for migrating to any technology where the target has an equivalent concept:

- **Database**: FileMaker tables and fields → PostgreSQL/MySQL DDL, Supabase schema, Airtable base structure
- **Backend logic**: FileMaker scripts → Node.js, Python, or Ruby functions
- **UI**: Layouts → React Native, Flutter, or Android Jetpack Compose components

In every case the approach is the same: read what FileMaker knows about the solution through its XML exports and live API, and use that as a complete, authoritative specification for the target environment.

## What Makes This Hard

FileMaker's closed nature creates specific challenges that shape how this project operates:

1. **No file system access**: FileMaker cannot read text files at design time. Everything must flow through the clipboard.
2. **ID dependencies**: Every object reference in FileMaker uses internal numeric IDs. Scripts reference other scripts by ID, layout objects reference fields by table occurrence and field ID, and custom menus reference their UUIDs. These IDs must be known before generation.

   > **The Placeholder Technique** — a practical resolution for multi-script systems: the `Perform Script` step references a target script by its internal numeric ID, which FileMaker assigns at creation time. A developer can click the **+** button N times to create N blank placeholder scripts (FileMaker names each one `New Script`), then immediately rename each to its final target name — then run **Push Context**, which returns all their IDs. The agent now has the real script IDs it needs for `Perform Script` calls and can generate all N interdependent scripts in one pass, with correct wiring between them. Each generated snippet is pasted into its corresponding script. The only manual steps are clicking + N times and typing the rename for each — everything else is AI-authored. This technique scales to arbitrarily complex multi-script architectures.
   >
   > **Important**: FileMaker names every new script `New Script` regardless of how many are created. Because `Context()` keys scripts by name, duplicate names cause earlier entries to be overwritten. Scripts must be renamed to unique final names **before** running Push Context.

3. **Context must be exported**: The `CONTEXT.json` file bridges this gap — FileMaker exports the IDs and metadata for the objects relevant to a given task, giving the agent the reference data it needs.
4. **Runtime observation requires explicit instrumentation**: The agent cannot run scripts or observe FM state directly. Three feedback loops bridge this gap: **Push Context** (current layout state → `CONTEXT.json`), **Explode XML** (full solution → `xml_parsed/`), and **Agentic-fm Debug** (runtime state → `debug/output.json`). When the developer has set up an OData connection to the hosted solution, the agent can trigger these scripts programmatically via `POST /fmi/odata/v4/{database}/Script/{ScriptName}` — closing the loop without any manual step. Without OData, the developer runs them manually in FM Pro.
5. **XML format complexity**: The fmxmlsnippet format has its own rules distinct from FileMaker's internal XML. The step catalog and snippet examples codify these rules.

## Automation Tiers — Pluggable Deployment

The core workflow described in [The Bridge](#the-bridge) positions the developer as the deployment mechanism: the agent generates XML, `clipboard.py` loads it, and the developer pastes with `⌘V`. This works universally and has no dependencies.

However, two macOS-specific technologies can progressively automate the paste step, reducing or eliminating human involvement for script operations. **These are optional modules, not core dependencies.** Every skill must work without them; when present, they accelerate the workflow.

### Tier 1: Clipboard (universal, no dependencies)

The current default. The agent generates fmxmlsnippet XML, `clipboard.py` writes it to the clipboard, and the developer pastes it into the appropriate FileMaker workspace. Works on macOS and Windows, requires no plugins, and is the universal fallback for every operation.

```
Agent generates XML  →  clipboard.py writes to clipboard  →  Developer pastes (⌘V)
```

### Tier 2: MBS Plugin (macOS, requires commercial plugin)

The [MBS Plugin](https://www.mbsplugins.eu/) (~€228/year) provides 32 ScriptWorkspace functions that give programmatic access to FileMaker's Script Workspace. The critical capability: **automated paste into existing scripts without human intervention.**

The pattern:

```
1. MBS("Clipboard.SetFileMakerData"; "ScriptStep"; $xml)    // load XML to clipboard
2. MBS("ScriptWorkspace.OpenScript"; "TargetScript")         // navigate to script
3. MBS("ScriptWorkspace.SelectLine"; -1)                     // position cursor
4. MBS("Menubar.RunMenuCommand"; 57637)                      // trigger Paste
```

Key MBS capabilities for agent workflows:

| Function | What it enables |
|---|---|
| `ScriptWorkspace.OpenScript` | Navigate to any script by name (with folder support) |
| `ScriptWorkspace.SelectLine` / `SelectLines` | Position cursor or select a range for replacement |
| `ScriptWorkspace.ScriptText` | Read back script content for verification |
| `ScriptWorkspace.ScriptNames` / `ScriptPaths` | Discover all scripts in the solution |
| `ScriptWorkspace.SetScriptListSearch` | Search the script list programmatically |
| `ScriptWorkspace.SetFocusToScriptList` | Ensure focus is correct before paste |
| `Clipboard.SetFileMakerData` | Write fmxmlsnippet XML to clipboard in FM's binary format (**works on Mac and Windows**) |
| `Menubar.RunMenuCommand` | Trigger any FM menu command by ID (**works on Mac and Windows**) |
| `SyntaxColoring.AddContextMenuCommand` | Install custom right-click commands in the Script Workspace |

Constraints:
- `ScriptWorkspace.*` functions are **macOS only** (Clipboard and Menubar functions work cross-platform)
- **Cannot create new scripts** — can only paste into existing ones
- **Cannot rename, delete, or reorder scripts**
- **Paste cannot execute while a FM script is running** — must use `Schedule.EvaluateAfterDelay` to defer execution until the triggering script exits and the workspace regains focus

### Tier 3: MBS + macOS Accessibility / AppleScript (macOS, requires plugin + Accessibility permission)

macOS Accessibility APIs (AXUIElement) expose FileMaker Pro's UI elements — windows, menus, buttons, tabs, text fields — to programmatic control via AppleScript or JXA. This fills the gaps that MBS cannot cover.

What AppleScript adds beyond MBS:
- **Create new scripts** — `Cmd+N` in the Script Workspace, type name, Enter
- **Create and rename script folders**
- **Navigate Manage Database dialogs** — Tables and Fields tabs (feasible but complex)
- **Navigate Manage Custom Functions** — proven by [FmClipTools](https://github.com/DanShockley/FmClipTools), an existing MIT-licensed toolkit
- **Trigger any keyboard shortcut** — save (`Cmd+S`), run (`Cmd+R`), duplicate (`Cmd+D`)

Constraints:
- **Fragile** — sensitive to FM version changes, element naming, timing, and modal dialogs
- **Accessibility permission is required** — the terminal app (Terminal.app, iTerm2, VS Code, etc.) executing the deploy script must be granted Accessibility access in **System Settings → Privacy & Security → Accessibility**. macOS may present an authorization dialog the first time; if the dialog is dismissed without granting access, Tier 3 will fail. `deploy.py` performs a pre-flight check and returns a clear remediation message if permission is missing.
- **Cannot automate the relationship graph** — it's a custom-rendered canvas, not individual accessible elements
- **Cannot reliably automate layout object placement** — spatial positioning is too brittle
- **Cannot automate drag-and-drop operations**
- Process name has changed across FM versions ("FileMaker Pro" vs "FileMaker Pro Advanced" vs "Claris FileMaker Pro") — use bundle identifier for resilience

### The webviewer as a rich output channel

When the developer runs the Vite dev server alongside their CLI/IDE session, skills gain a fourth output path beyond Tiers 1–3. Rather than printing HR script output as plain terminal text, skills route it through the companion server to the webviewer, where Monaco renders it with full syntax highlighting. Two output types are available:

- **Preview** (`type: "preview"`) — displays the generated HR script in Monaco; the developer sees exactly what will be deployed before it lands in the Script Workspace
- **Diff** (`type: "diff"`) — displays a side-by-side diff of the current script (from `scripts_sanitized`) against the agent's proposed version; Monaco's diff editor makes changes immediately readable in a way that is impossible in the Script Workspace itself

Detection is automatic: if the companion server can reach the configured `webviewer_url`, the channel is available. Skills always produce terminal output regardless — the webviewer is additive, never a dependency.

This channel is particularly valuable for `script-refactor` (diff view) and any skill used from CLI/IDE while the webviewer editor is open — the developer can see and edit the proposed HR output in Monaco before approving deployment.

### The pluggable deployment model

Skills should not hardcode a deployment tier. Instead, every skill that produces fmxmlsnippet output follows a common pattern:

1. **Generate** — produce XML to `agent/sandbox/`
2. **Validate** — run `validate_snippet.py`
3. **Deploy** — call the deployment module, which selects the appropriate tier:
   - If MBS + AppleScript are available and the developer has opted in to full automation: create scripts if needed (AppleScript), navigate + paste (MBS), verify (MBS read-back or Explode XML)
   - If MBS is available: navigate + paste into existing scripts (MBS), developer handles script creation
   - If neither: load clipboard (`clipboard.py write`), instruct developer to paste

The deployment tier is a **runtime decision**, not a build-time one. A developer can opt in to full automation for a multi-script scaffold workflow and fall back to manual paste for a one-off script fix. The agent should ask once per session (or read from a config) and adjust its instructions accordingly.

This model means the Placeholder Technique described above becomes a spectrum:

| Tier | Script creation & naming | Paste | Verification |
|---|---|---|---|
| Tier 1 | Developer clicks **+** N times, renames each to final name | Developer pastes (`⌘V`) | Developer confirms |
| Tier 2 | Developer clicks **+** N times, renames each to final name | MBS auto-pastes | MBS reads back script text |
| Tier 3 | AppleScript creates N scripts with final names | MBS auto-pastes | MBS reads back + Explode XML |

At Tier 3, the full multi-script scaffold workflow — from "build me an invoicing system with 5 scripts" to verified scripts in the Script Workspace — requires no human intervention beyond approval.

### MBS menu command IDs (reference)

| ID | Command |
|---|---|
| 57634 | Copy |
| 57635 | Cut |
| 57637 | Paste |
| 57632 | Delete |
| 57642 | Select All |
| 49182 | Duplicate |

## Skills

Skills are the primary unit of capability in agentic-fm. Each skill is a focused, invocable workflow that the agent executes on demand. Together they form the toolkit the agent uses to cover the full scope of FileMaker development described in this vision.

### Existing Skills

| Skill            | Purpose                                                                                                                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-lookup`  | Locate an existing script in `xml_parsed/`, resolving to both the human-readable and SaXML versions                                                                                                                                                                                                              |
| `script-preview` | Generate a human-readable preview of a proposed script before committing to XML output                                                                                                                                                                                                                           |
| `script-review`  | Code review a script and all subscripts it calls                                                                                                                                                                                                                                                                 |
| `fm-debug`       | Close the feedback loop after a script is created — the script calls a companion "Agentic-fm Debug" script which POSTs runtime state (variables, error codes, `Get(LastErrorLocation)`) to the local companion server; the agent reads `agent/debug/output.json` directly without the developer copying anything |
| `menu-lookup`    | Locate custom menus and menu sets in `xml_parsed/`, extracting real UUIDs required before any paste operation                                                                                                                                                                                                    |
| `library-lookup` | Search the curated library of reusable fmxmlsnippet code across scripts, steps, functions, fields, layouts, and webviews                                                                                                                                                                                         |

### In Development

| Skill                 | Purpose                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `calc-eval`           | Validate FileMaker calculation expressions at runtime via OData — evaluates against a live solution, returns result and FM error code; agent uses proactively for any calculation it generates |
| `script-debug`        | Systematic debugging workflow — reproduce, isolate, hypothesise, verify, fix                                                        |
| `implementation-plan` | Structured planning before script creation — decompose requirements, identify dependencies, confirm approach before generating code |
| `schema-build`        | Create and modify database schema via OData against a live hosted solution (supersedes `modify-schema`)                             |

### Proposed Skills

**Setup & Connectivity**

| Skill             | Purpose                                                                                                                                                                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `odata-connect`   | Walk a developer through setting up OData connectivity for a FileMaker file hosted on a local FileMaker Server running in Docker — covers file creation, server upload, account and privilege setup, SSL handling, and connection verification. Prerequisite for all OData-dependent skills. |
| `context-refresh` | Instruct the developer to run the **Push Context** script in FM Pro on the target layout — writes a fresh `CONTEXT.json` scoped to that layout. Required any time the FM state changes before the agent generates code referencing FM object IDs.                                            |
| `solution-export` | Instruct the developer to run the **Explode XML** script in FM Pro — exports the full solution XML and parses it into `xml_parsed/` via the companion server. Use to verify what was pasted, inspect any script, or sync reference material after FM changes.                                |

**Schema & Data Model**

| Skill               | Purpose                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema-plan`       | Design the data model for a new solution — produce an ERD as a Mermaid diagram stored in `plans/`, then extend it to a FileMaker-specific model showing base tables, table occurrences, and the relationships the developer will need to implement manually |
| `schema-build`      | Execute a planned schema against a live solution via OData — create tables and fields transactionally, report what was created                                                                                                                              |
| `relationship-spec` | Derive a precise relationship specification from the ERD: table occurrence names, join fields, cardinality, cascade delete settings — formatted as a click-through checklist for the developer                                                              |

**Scripts**

| Skill                   | Purpose                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-refactor`       | Analyse an existing script and produce an improved version — better error handling, cleaner variable naming, consolidation of repeated logic — while preserving observable behaviour                                                                                                                                                                                              |
| `script-test`           | Generate a companion verification script that exercises a target script and asserts expected results, using the `fm-debug` companion server to report pass/fail back to the agent                                                                                                                                                                                                 |
| `multi-script-scaffold` | Guide the developer through the placeholder technique for multi-script systems — calculate how many placeholder scripts are needed, instruct the developer to create them with their final names (FM names all new scripts `New Script` — rename before Push Context), trigger a context refresh to capture their IDs, then generate all scripts with correct inter-script `Perform Script` wiring in one pass |

**Layout & UI**

| Skill             | Purpose                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `layout-design`   | Guide the developer through a layout design conversation drawing on AI knowledge of UI/UX, web design, and FM layout conventions; produce `XML2` layout objects ready to paste onto an existing layout                   |
| `webviewer-build` | Generate a complete web viewer application — HTML, CSS, JavaScript, and any framework — plus the FileMaker bridge scripts (`Perform JavaScript`, JSON data passing) that connect the viewer to FM data                   |
| `layout-spec`     | Produce a written layout blueprint (object list, field bindings, portal configuration, button wiring, conditional formatting rules) for a developer to build against manually when object-level generation is not needed |

**Custom Functions & Configuration**

| Skill              | Purpose                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `function-create`  | Generate custom functions from a plain-English description, or translate an equivalent formula from another language or environment into FileMaker calculation syntax |
| `privilege-design` | Design privilege sets, extended privileges, and account structure for a solution — output as a specification and, where possible, as pasteable FM objects             |

**Solution-Level**

| Skill                | Purpose                                                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solution-blueprint` | Decompose a plain-English application description into a complete, ordered build sequence: schema plan → relationship spec → scripts → custom functions → value lists → menus → layout specs |
| `solution-audit`     | Analyse an existing solution via DDR or `xml_parsed/` for technical debt, naming inconsistencies, missing error handling, anti-patterns, and modernisation opportunities                     |

**Migration**

| Skill            | Purpose                                                                                                                                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrate-out`    | Migrate a FileMaker/WebDirect solution to a modern web stack — parse the DDR XML, conduct requirements discovery, recommend a target stack, produce SQL schema, REST API design, and UI component specifications; builds on the `migrate-filemaker` open-source foundation |
| `migrate-native` | Translate FileMaker layout XML into a native iOS/macOS Xcode project — UIKit view controllers or SwiftUI views replicating layout structure, field bindings, portal/list views, and button actions                                                                         |
| `migrate-in`     | Bring an external schema (SQL DDL, ORM model, spreadsheet) into FileMaker — generate OData calls to create tables and fields, translate business logic into FM scripts, map existing UI to layout specifications                                                           |

**Data**

| Skill          | Purpose                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-seed`    | Generate realistic seed or test data and load it into a live solution via OData — useful for populating a new schema before scripts and layouts are built |
| `data-migrate` | Move records from an external source into a live FM solution via OData — map source fields to FM fields and handle type coercion                          |

**Documentation**

| Skill           | Purpose                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solution-docs` | Generate human-readable documentation from DDR or `xml_parsed/` — covering schema, relationships, script inventory, custom functions, and privilege sets |

## Tooling Infrastructure Roadmap

The project today is well-equipped for script work. Expanding to the full scope described in this vision requires building out reference material, catalogs, and skills in a deliberate sequence. This section describes what needs to exist and why.

### Layout Object Reference

Layout objects do not need a formal catalog equivalent to the step catalog. The `xml_parsed/` layout exports are rich enough to serve as the structural reference. What the project needs instead is a **design-guided interaction model**:

- The agent draws on its knowledge of web design, HTML/CSS, and software UI patterns to guide the developer through a layout design conversation
- Once the design is agreed, the agent generates `XML2`-formatted layout objects and loads them onto the clipboard
- The developer creates the layout shell manually (a seconds-long step), then pastes the objects in

Two important constraints shape this model, and the right approach depends on whether the solution is existing or new.

**For existing solutions — traditional layout design:**

The majority of FileMaker solutions in active use are deeply embedded in company infrastructure. Their developers and users are familiar with native FM layouts, and switching to a web viewer architecture would be a significant and unwanted disruption. For these solutions, the agent works within the native layout model: designing with autosizing (anchoring) for fixed or anchor-relative positioning, generating `XML2` layout objects, and guiding the developer through the paste workflow. Responsive design is not possible in native FM layouts — the agent designs accordingly.

**For new solutions — FileMaker as data layer, web viewer as UI layer:**

When a solution is being built from scratch, a compelling architecture emerges: use FileMaker exclusively for what it does best — local file storage, schema management, relationships, and scripting — while placing all user interaction inside a Web Viewer object. The web viewer hosts a full HTML/CSS/JavaScript application; FileMaker scripts are called via the `Perform JavaScript` script step; data flows in and out via JSON.

This pattern has a significant strategic advantage: **migration to a standalone web application becomes trivial.** The UI is already web-native. When the time comes to move off FileMaker, the only work is migrating the data — the front-end is already done. The agent is well-positioned to support this architecture because it can generate both the web viewer content (HTML, CSS, JavaScript, and any framework) and the FileMaker scripts that bridge between the viewer and the data layer.

The agent should be fluent in both tracks and help developers understand the trade-off when starting a new project.

### Field Definition and Schema Reference

The `xml_parsed/` field and table exports, combined with OData field type documentation, provide sufficient reference for field generation. No separate catalog is planned. The priority is tooling to issue OData calls and validate the results — not a static reference document.

### Relationship Graph

Relationships remain permanently manual. No plugin, AppleScript, or API workaround exists. The agent's responsibility is to produce a **precise relationship specification** — table occurrences, join fields, cardinality, and cascade delete settings — that the developer can implement without ambiguity. The spec should be concrete enough to click through in a single focused pass.

### Migration Tooling

**FileMaker → Web Application** is the highest-priority migration path. WebDirect is resource-intensive and expensive to host; the demand to replace it with a modern web stack is the dominant migration scenario in the ecosystem.

A migration skill for this path already exists as an open-source starting point: [migrate-filemaker](https://github.com/solutionscay/migrate-filemaker). It uses the FileMaker Database Design Report (DDR) XML as its source, parses it into structured JSON specifications (tables, relationships, layouts, scripts, security), conducts a requirements discovery conversation, recommends a technology stack, and produces SQL schemas, REST API designs, and UI specifications.

agentic-fm should build on and extend this approach:

- **DDR as the source of truth**: The DDR XML export is more complete than `xml_parsed/` for migration purposes — it includes table occurrences, relationships, value lists, scripts, and layouts in a single document
- **WebDirect HTML as a UI template**: The rendered WebDirect output captures the visual result; combined with layout XML it gives the agent a complete picture for replicating the UI in a target framework
- **Script translation**: FileMaker scripts translate to backend or frontend logic; the agent's deep knowledge of FM script semantics makes it well-positioned to do this accurately
- **Prioritised target stacks**: Rather than recommending from an open-ended list, the skill should develop strong, opinionated patterns for the most common replacement targets (e.g. a React + Supabase stack, a Next.js full-stack approach)

Other migration paths — layout XML to SwiftUI/UIKit for native iOS/macOS, and inbound migrations from spreadsheets or SQL databases — follow as secondary priorities once the web migration path is mature.

### Skill Expansion Sequence

The build order for new skills, based on dependency, demand, and a gradual confidence-building approach. See `plans/PHASES.md` for the active implementation schedule and `plans/IMPLEMENTATION.md` for execution details.

**Current implementation cycle:**

1. **Multi-script scaffold** — proof-of-concept; validates the workflow with the lowest-risk skill
2. **Script tooling** (refactor, test, debug, implementation-plan) — expands core script development capabilities
3. **Layout design + XML2 generation** and **OData schema tooling** — parallel pair; unlocks UI authoring and programmatic schema creation
4. **Data tooling** (seed, migrate) — completes the data lifecycle via OData

**Future potential** (deferred until core skills are mature):

5. **Solution-level skills** — orchestration, auditing, documentation, custom functions, privilege design
6. **Web migration** — highest-demand migration path, existing open-source foundation to build on
7. **Native & inbound migration** — layout XML → SwiftUI/UIKit; external schema → FileMaker

## The Path Forward

To move from "script generator" to "solution generator," the project needs to expand in several directions:

- **OData schema tooling**: Build out the agent's ability to issue OData REST calls to create tables and fields against a live hosted solution; generate a precise relationship specification for the developer to implement manually (the one step that cannot be automated)
- **Solution blueprints**: High-level templates for common application patterns (CRM, invoicing, inventory, etc.) that decompose into the correct sequence of API calls and clipboard paste operations
- **Sequenced assembly**: A guided workflow that respects the dependency order — schema first (via API), then scripts and functions (via clipboard), then layout specifications (delivered as developer instructions) — so a full solution can be assembled without ambiguity
- **Layout blueprint output**: A structured format for describing layouts (field placement, portal configuration, button wiring, conditional formatting rules) that gives a developer a complete spec to implement without guesswork
- **Round-trip fidelity**: Better tooling to read existing FM objects from the clipboard back into the agent's context, enabling editing and refactoring workflows on existing solutions
- **Automated context extraction**: Reduced reliance on manual CONTEXT.json exports — the agent can derive more context from the exported XML and index files, and eventually query a live solution directly via oData schema introspection
