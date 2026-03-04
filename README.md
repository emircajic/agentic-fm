# agentic-fm 🗄️ » 📂 » 🧠

AI-powered script development for FileMaker Pro. Generate, modify, and validate `fmxmlsnippet` code that pastes directly into FileMaker with a high degree of confidence.

# Background

FileMaker Pro is a closed environment — logic and schema live inside a binary file, not text files. Three XML formats provide the bridge between FileMaker and external tooling:

- **Database Design Report (DDR)** — a full solution export accessed via **Tools > Database Design Report...**. An older format that Claris is moving away from; not used by this project.
- **Save a Copy as XML** — the modern export format accessed via **Tools > Save a Copy as XML...**. Covers scripts, layouts, schema, and more. Can also be triggered programmatically via the Save a Copy as XML script step. This is the format this project uses.
- **fmxmlsnippet** — the clipboard format FileMaker uses to copy and paste individual objects (script steps, fields, layouts, etc.). This is the format AI uses to deliver generated code back into FileMaker.

# 🔧 How to Install

See **[filemaker/README.md](filemaker/README.md)** for the full dependency list and step-by-step setup guide, including how to install `fm-xml-export-exploder`, configure the MBS Plugin, and set up the Python virtual environment.

**Dependencies at a glance:**

| Dependency                                                                               | Required By                       | Notes                                                      |
| ---------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| FileMaker Pro 21.0+                                                                      | Everything                        | `GetTableDDL`, `While`, and data file steps required       |
| [MBS FileMaker Plugin](https://www.monkeybreadsoftware.com/filemaker/)                   | Explode XML script                | Free trial available; other scripts use native steps only  |
| [fm-xml-export-exploder](https://github.com/bc-m/fm-xml-export-exploder/releases/latest) | Explode XML, fmparse.sh           | Download binary; place at `~/bin/fm-xml-export-exploder`   |
| Python 3 + `.venv`                                                                       | clipboard.py, validate_snippet.py | `source .venv/bin/activate` before use                     |
| xmllint                                                                                  | fmcontext.sh                      | Ships with macOS; `apt-get install libxml2-utils` on Linux |

**Setup steps:**

1. **Install the Context custom function** — open your solution, go to **File > Manage > Custom Functions**, create a function named `Context` with one `task` parameter, and paste in the contents of `filemaker/Context.fmfn`.

2. **Install the companion scripts** — load `filemaker/agentic-fm.xml` onto the clipboard using the `clipboard.py write` command, then paste into the Script Workspace in FileMaker:

   ```bash
   source .venv/bin/activate
   python agent/scripts/clipboard.py write filemaker/agentic-fm.xml
   ```

3. **Configure the repo path** — run the **Get agentic-fm path** script once. It will prompt you to select the agentic-fm folder on disk and store the path in `$$AGENTIC.FM` for use by the other scripts.

4. **Explode the XML** — run the **Explode XML** script to perform your first Save as XML export and populate `agent/xml_parsed/`. Re-run it any time the solution schema changes.

5. **Push context before each session** — navigate to the layout you are working on, run **Push Context**, enter a task description, and the current context will be written to `agent/CONTEXT.json`. You are now ready to work with AI.

# ⚡ Workflow

```
1. In FileMaker, run "Explode XML" to export and parse the current solution into agent/xml_parsed/
2. Navigate to the target layout and run "Push Context" with a task description → writes agent/CONTEXT.json
3. AI reads CONTEXT.json + step catalog (+ snippet_examples for complex steps) to generate fmxmlsnippet output in agent/sandbox/
4. validate_snippet.py runs automatically as part of the AI toolchain to check for errors
5. clipboard.py writes the validated snippet to the clipboard
6. Paste fmxmlsnippet into FileMaker at the desired insertion point
```

# Agent Skills

Skills are opt-in workflows that extend an agent's default behavior. Invoke them naturally in conversation — no special syntax required.

| Skill              | What it does                                                                                                                                                                                                          | Example triggers                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **script-lookup**  | Locates a specific script in the parsed XML export by ID or name, resolving the matched pair of human-readable (`scripts_sanitized`) and Save-As-XML (SaXML) (`scripts`) files. Confirms the match before proceeding. | "review script ID 123", "show me the invoice script", "open the New Invoice script"      |
| **script-preview** | Generates a human-readable, numbered step outline of a proposed script for review and iteration before any XML is generated. Loops until you approve, then hands off to full generation.                              | "preview the script", "outline the steps", "draft the logic before you generate"         |
| **script-review**  | Performs a code review of an existing script — evaluating logic flow, efficiency, and correctness. Interactive; works alongside the FileMaker debugger.                                                               | "review this script", "check the logic in X script"                                      |
| **library-lookup** | Searches the curated snippet library for reusable fmxmlsnippet code matching the current task. Used proactively by AI before writing significant logic, and on direct request.                                        | "use the HTTP request script", "add a timeout loop", "is there a library item for this?" |

# Objectives

The goals of this project are to provide the guidance and context needed by agentic processes for creating reliable scripts and other FileMaker related code that can be taken from AI back into FileMaker Pro.

## Design Philosophy: Step-level editing, not whole-script generation

The primary unit of work in this project is the **individual script step**, not the full script. Iterating on whole scripts is impractical because FileMaker has no diff/merge and every paste adds new steps to what is already in the script. Working at the step level is much faster and far less destructive or duplicative.

Most of a developer's script work (creation, updates, optimizations, and debugging) happens within `agent/sandbox/`. This is the shared workspace for both the developer and AI. When working on an existing script, reference it by name using the editor's file search; AI will copy it into the sandbox as needed.

**Creating new scripts:** AI generates a sequence of steps as an `fmxmlsnippet` which is pasted directly into FileMaker via the clipboard.

**Modifying existing scripts:** Reference the human-readable script in `agent/xml_parsed/scripts_sanitized/` to understand the logic and identify the lines you want to change. AI uses line numbers from that sanitized version as an unambiguous reference. When the full Save As XML source of a script is needed (e.g. to produce steps for a section of the script), `agent/scripts/fm_xml_to_snippet.py` converts the Save As XML format found in `agent/xml_parsed/scripts/` into valid `fmxmlsnippet` output ready for the clipboard. This conversion is handled automatically by AI as part of its toolchain, not something the developer does manually.

# Architecture

For a detailed view of the data pipeline, the context hierarchy, artifact inventory, and guidelines for adding new features, see [ARCHITECTURE.md](ARCHITECTURE.md).

# Step Catalog

`agent/catalogs/step-catalog-en.json` is a structured JSON reference for all FileMaker script steps. It provides step IDs, parameter definitions (XML element names, types, enums, defaults), HR signatures, and Monaco snippets. The step catalog is the primary source for step XML structure -- agents grep it before falling back to `snippet_examples/` for complex or incomplete steps. See [ARCHITECTURE.md](ARCHITECTURE.md) for full details.

# Webviewer

The `webviewer/` directory contains a browser-based visual script editor built with Preact, Monaco, and Vite. Its three-panel layout provides a Monaco script editor (with autocomplete from the step catalog), a live XML preview, and integrated AI chat.

**Quick start:**

```bash
cd webviewer
npm install
npm run dev
# Open http://localhost:8080
```

The webviewer can run as a standalone browser app or embedded inside a FileMaker WebViewer object. When embedded, FileMaker can push context and load scripts via the bridge API. AI providers include Anthropic API, OpenAI API, and Claude Code CLI proxy.

See `webviewer/WEBVIEWER_INTEGRATION.md` for full details.

# Project Structure

```
agentic-fm/
├── fmparse.sh              # CLI tool for parsing XML exports
├── fmcontext.sh            # CLI tool for generating AI-optimized context indexes
├── filemaker/
│   ├── Context.fmfn        # Custom function source — install into your solution
│   ├── agentic-fm.xml      # Companion script group — paste into Script Workspace
│   └── README.md           # Full dependency and setup guide
├── agent/
│   ├── CONTEXT.json         # Scoped context for the current task (generated in FileMaker)
│   ├── CONTEXT.example.json # Schema reference and example for CONTEXT.json
│   ├── catalogs/            # Step catalog — structured step definitions
│   ├── context/             # Pre-extracted index files (generated by fmcontext.sh)
│   ├── sandbox/             # Work area for AI-generated scripts (output)
│   ├── scripts/             # Utility scripts (validation, XML conversion, clipboard)
│   ├── snippet_examples/    # Canonical fmxmlsnippet templates for every step type
│   ├── docs/
│   │   ├── filemaker/       # FileMaker help reference (functions, script steps, errors)
│   │   └── knowledge/       # Curated behavioral intelligence about FileMaker
│   ├── library/             # Proven, reusable fmxmlsnippet patterns
│   └── xml_parsed/          # Exploded XML from parsed solutions (reference only)
├── webviewer/               # Visual script editor (Preact + Monaco)
└── xml_exports/             # Versioned XML exports organized by solution
    └── <Solution Name>/
        ├── 2026-02-08/
        │   └── Solution.xml
        └── 2026-02-18/
            └── ...
```

- **filemaker/** -- FileMaker artifacts to install into your solution. See [filemaker/README.md](filemaker/README.md).
- **agent/catalogs/** -- Structured JSON reference for all FileMaker script steps. Primary source for step XML structure.
- **webviewer/** -- Browser-based script editor with Monaco, live XML preview, and AI chat. See `webviewer/WEBVIEWER_INTEGRATION.md`.
- **agent/sandbox/** -- The primary working folder. All AI output lands here; paste from here into FileMaker.
- **agent/xml_parsed/** -- Contains the exploded XML for all parsed solution files. Supports the FileMaker data separation model -- each solution file (e.g. UI.fmp12, Data.fmp12) is parsed independently, and only that solution's subdirectories are cleared on re-parse.
- **agent/context/** -- Compact, pipe-delimited index files generated by `fmcontext.sh`. Provide fast lookups of all fields, relationships, layouts, scripts, table occurrences, and value lists.
- **agent/CONTEXT.json** -- Generated by FileMaker's `Context()` function before each session. Scoped to the current layout and task so AI has exactly the IDs it needs.
- **xml_exports/** -- Archived XML exports, one subfolder per solution, dated subfolders per run.

# Coding Conventions

All AI-generated FileMaker code (scripts and calculations) follows the conventions defined in `agent/docs/CODING_CONVENTIONS.md`. These are "initially set" based on the community standard at [filemakerstandards.org](https://filemakerstandards.org/code) and cover variable naming prefixes (`$`, `$$`, `~`, `$$~`), `Let()` formatting, operator spacing, boolean values, and control structure style.

**You can, and probably should, customize these conventions to your preferred style.** Edit `agent/docs/CODING_CONVENTIONS.md` to match your team's standards. AI reads this file before writing any calculation or script logic and will follow whatever rules you define there. Common customizations include:

- Changing variable naming conventions or casing style
- Adding project-specific prefixes or naming patterns
- Specifying preferred patterns for error handling or transaction structure
- Documenting custom functions that should always be used instead of inline logic

# Knowledge Base

`agent/docs/knowledge/` contains curated behavioral intelligence about FileMaker Pro — nuances, gotchas, and practical insights that go beyond what standard help references cover. While AI is good at logic and control flow, FileMaker has platform-specific behaviors (found set mechanics, context switching, transaction scope, window management) that are easy to get wrong without domain-specific guidance.

Each knowledge document captures what an experienced FileMaker developer knows intuitively but AI would otherwise miss. AI consults these documents before composing scripts, leading to higher-quality output that avoids common pitfalls.

**Current topics:**

| Document        | Covers                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `found-sets.md` | Found set attributes, actions on found sets, collecting field values, restoring found sets, snapshot links |

A keyword-indexed manifest at `agent/docs/knowledge/MANIFEST.md` enables fast lookup. AI scans it for keyword matches against the current task and reads any matching documents before writing script steps.

**Contributing knowledge:** This is one of the most impactful ways to contribute. If you know of a FileMaker behavior that AI commonly gets wrong — or a nuance that would help AI write better scripts — see the [Contributing](#contributions) section below.

# 📋 FileMaker Companion Scripts

`filemaker/agentic-fm.xml` is an `fmxmlsnippet` containing a script folder group named **agentic-fm**. Paste it into your FileMaker solution's Script Workspace to install the three companion scripts that connect FileMaker to the agentic-fm toolchain.

| Script                  | Purpose                                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Get agentic-fm path** | One-time setup. Prompts you to select the agentic-fm repo folder and stores the path in `$$AGENTIC.FM`. All other scripts depend on this global being set.                                                |
| **Explode XML**         | Saves a copy of the current solution as XML and calls `fmparse.sh` via MBS Shell to archive and explode it into `agent/xml_parsed/`. Run this whenever the solution schema or scripts change.             |
| **Push Context**        | Prompts for a task description, calls `Context($task)`, and writes the result directly to `agent/CONTEXT.json`. Run this from whatever layout you are working on before starting an AI scripting session. |

**Requirement:** The **Explode XML** script uses the [MBS FileMaker Plugin](https://www.monkeybreadsoftware.com/filemaker/) for its shell execution functions (`Shell.New`, `Shell.Execute`, etc.). The other two scripts use only native FileMaker steps.

# fmparse.sh

A command line tool, called from within FileMaker, that archives a FileMaker XML export and parses it into its component parts using [fm-xml-export-exploder](https://github.com/bc-m/fm-xml-export-exploder). Supports the data separation model -- each solution file is parsed independently and only its subdirectories are cleared on re-parse, preserving other solutions' data in `agent/xml_parsed/`.

**Usage:**

```bash
./fmparse.sh -s "<Solution Name>" <path-to-export> [options]
```

**Required:**

- `-s, --solution` -- The solution name. Determines the subfolder under `xml_exports/` where the export is archived.

**Options:**

- `-a, --all-lines` -- Parse all lines (reduces noise filtering)
- `-l, --lossless` -- Retain all information from the XML
- `-t, --output-tree` -- Output tree format: `domain` (default) or `db`

**Examples:**

```bash
# Parse a single XML file
./fmparse.sh -s "Invoice Solution" /path/to/Invoice\ Solution.xml

# Parse a directory of exports with all lines
./fmparse.sh -s "Invoice Solution" /path/to/exports/ --all-lines
```

# fmcontext.sh

A command line tool that generates AI-optimized index files from the exploded XML in `agent/xml_parsed/`. Uses `xmllint` to extract only the useful data (IDs, names, types, references) and discard noise (UUIDs, hashes, timestamps, visual positioning).

**Usage:**

```bash
./fmcontext.sh
```

This is run at the end of `fmparse.sh`. It reads `agent/xml_parsed/` and writes to `agent/context/`.

**Generated files:**

| File                      | Contents                                                           |
| ------------------------- | ------------------------------------------------------------------ |
| `fields.index`            | All fields across all tables (name, ID, type, auto-enter, flags)   |
| `relationships.index`     | Relationship graph (TOs, join type, join fields, cascade settings) |
| `layouts.index`           | Layouts with name, ID, base TO, and folder path                    |
| `scripts.index`           | Scripts with name, ID, and folder path                             |
| `table_occurrences.index` | Table occurrence to base table mapping                             |
| `value_lists.index`       | Value list names, sources, and values                              |

Each file is pipe-delimited with a header comment documenting the column format.

# validate_snippet.py

A post-generation validation tool that checks `fmxmlsnippet` output for common errors before pasting into FileMaker. Runs automatically as part of the AI toolchain — rarely needed directly.

**Usage:**

```bash
python agent/scripts/validate_snippet.py [file_or_directory] [options]
```

With no arguments it validates all files in `agent/sandbox/`. It auto-detects `agent/CONTEXT.json` when present.

**Checks performed:**

| Check                 | Description                                                                |
| --------------------- | -------------------------------------------------------------------------- |
| Well-formed XML       | File parses as valid XML                                                   |
| Root element          | Must be `<fmxmlsnippet type="FMObjectList">`                               |
| No Script wrapper     | Output must not be wrapped in `<Script>` tags                              |
| Step attributes       | Every `<Step>` has `enable`, `id`, and `name`                              |
| Paired steps          | If/End If, Loop/End Loop, Open Transaction/Commit Transaction are balanced |
| Else/Else If ordering | No Else If after Else, no duplicate Else within an If block                |
| Known step names      | All step names exist in snippet_examples                                   |
| Reference cross-check | Field, layout, and script IDs match CONTEXT.json                           |

**Options:**

- `--context <path>` -- Path to CONTEXT.json (auto-detected by default)
- `--snippets <path>` -- Path to snippet_examples directory
- `--quiet, -q` -- Only show errors and warnings

# Context.fmfn

`filemaker/Context.fmfn` is a FileMaker custom function that generates `CONTEXT.json` at runtime. Install it via **File > Manage > Custom Functions** (see [How to Install](#-how-to-install) above). Once the companion scripts are installed, use **Push Context** rather than evaluating the function manually.

The function introspects the live FileMaker solution using design functions and `ExecuteSQL` queries against system tables. It automatically discovers:

- The current layout, its base table occurrence, and its named objects
- All table occurrences referenced on the layout with complete field lists (name, ID, type)
- Relationship information via `GetTableDDL` (FOREIGN KEY constraints and field comments)
- All scripts, layouts, and value lists in the solution (name + ID)

Because the output is scoped to the current layout's context, the AI receives exactly the information it needs without unnecessary noise. See `docs/Context.fmfn.md` for the full technical reference.

# CONTEXT.json

Generated by the `Context` custom function in FileMaker before each script generation request. Contains scoped context — only the tables, fields, layouts, scripts, relationships, and value lists relevant to the current task.

See `agent/CONTEXT.example.json` for the full schema and a realistic example.

# FileMaker Reference Documentation (Optional)

The `agent/docs/filemaker/` directory contains a script that fetches the official FileMaker Pro reference documentation from the Claris help site and converts it to Markdown. This is useful for giving AI agents accurate, up-to-date information about script step options, function syntax, and error codes without relying solely on training data.

> **Legal notice:** The generated Markdown files are copyrighted by Claris International Inc. They are excluded from this repository via `.gitignore` and may only be generated for personal, non-commercial use in accordance with the [Claris Website Terms of Use](https://claris.com/company/legal/terms). Do not commit, redistribute, or publish the generated files.

**Usage:**

```bash
cd agent/docs/filemaker
python fetch_docs.py              # fetch everything
python fetch_docs.py --steps      # script steps only
python fetch_docs.py --functions  # functions only
python fetch_docs.py --errors     # error codes only
python fetch_docs.py --force      # re-download cached files
```

**Outputs** (written relative to `agent/docs/filemaker/`):

| Path                             | Contents                                                 |
| -------------------------------- | -------------------------------------------------------- |
| `script-steps/<slug>.md`         | One file per script step (options, compatibility, notes) |
| `functions/<category>/<slug>.md` | One file per calculation function                        |
| `error-codes.md`                 | Full FileMaker error code reference                      |

Dependencies (`requests` and `beautifulsoup4`) are installed automatically on first run if not already present.

# Dependencies

See [filemaker/README.md](filemaker/README.md) for full installation instructions for each dependency.

- **[fm-xml-export-exploder](https://github.com/bc-m/fm-xml-export-exploder/releases/latest)** — required by `fmparse.sh` and the **Explode XML** FileMaker script. Place the binary at `~/bin/fm-xml-export-exploder` or set `FM_XML_EXPLODER_BIN` to the full path.
- **xmllint** — required by `fmcontext.sh`. Ships with macOS via libxml2. On Linux: `apt-get install libxml2-utils`.
- **Python 3** — required by `clipboard.py` and `validate_snippet.py`. Activate the included virtual environment: `source .venv/bin/activate`.
- **MBS FileMaker Plugin** — required by the **Explode XML** companion script for shell execution. See [monkeybreadsoftware.com](https://www.monkeybreadsoftware.com/filemaker/).
- **Node.js 18+** — required by the webviewer (`webviewer/`). Optional if you only use the CLI/IDE workflow.

# Project Website

The project website is at [agentic-fm.com](https://agentic-fm.com), built with Astro and Tailwind CSS. Source is in the `website/` folder.

**Local development:**

```bash
cd website
npm install
npm run dev
```

**Deploy:** Automatic via GitHub Actions on push to `main`. See `website/.github/workflows/deploy.yml`.

# Contributions

Contributions are welcome. This project is intended to grow through collaboration with the FileMaker developer community.

- **Knowledge base articles** -- The more complete the knowledge base is, the higher the quality of AI-generated code. If you know of a FileMaker behavior, nuance, or gotcha that AI commonly gets wrong, write it up as a Markdown file and add it to `agent/docs/knowledge/`. Use lowercase-kebab-case filenames (e.g., `record-locking.md`, `window-management.md`) and add an entry to `agent/docs/knowledge/MANIFEST.md`. Good candidates include context switching, transaction scope, server-side vs. client-side compatibility, sort order persistence, and any platform-specific behavior that isn't obvious from the help files alone.
- **Bug reports and corrections** -- If you find an error, an omission, or a snippet that produces incorrect output, please open an issue.
- **Updated snippet examples** -- Additional and/or updated `fmxmlsnippet` templates for step types not yet covered are among the most valuable contributions.
- **Editor and workflow support** -- The core toolchain should be editor-agnostic. It was developed using Cursor. If you build support for a specific editor, IDE, or automation workflow, a pull request is welcome.
- **Webviewer and HR converter** -- Improvements to the webviewer UI, the HR-to-XML converter, Monaco autocomplete definitions, or AI chat integration. If you add or modify step catalog entries, verify the webviewer's converter handles the changes correctly.
- **Improvements to the companion scripts** -- The FileMaker scripts in `filemaker/agentic-fm.xml` are early versions. Better path handling, error reporting, and cross-platform support are all good targets.

Please follow the standard fork-and-pull-request workflow. For significant changes, open an issue first to discuss the approach.
