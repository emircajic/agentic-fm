# Library

This folder is your personal code library — a collection of reusable FileMaker objects stored as XML snippets or human readable (HR) FileMaker code. When AI composes scripts or calculation code, it can consult this library to incorporate proven patterns rather than writing everything from scratch.

The library ships empty. You populate it with code from your own solutions.

This repo now also includes a reusable Settings API package under:

- `agent/library/Functions/Settings/`
- `agent/library/Scripts/Settings/`

That package is intended to be copied into other FileMaker solutions as a starting point for a hardened key-value settings architecture.

---

## How it works

Each file in this folder is valid FileMaker code. Either an `fmxmlsnippet`, the same XML format FileMaker places on the clipboard when you copy objects, or HR FileMaker code as saved from the webviewer feature. AI reads these files on demand, guided by `MANIFEST.md`, which acts as a keyword-indexed catalog of everything in the library.

**The CLI/IDE workflow:**

1. You export objects from FileMaker as XML snippets and save them here.
2. You update `MANIFEST.md` to register the new files (AI can do this for you — see below).
3. When composing code, AI reads `MANIFEST.md`, finds keyword matches for the task at hand, and reads only the relevant files.

**The webviewer workflow:**

1. When working in the webviewer code editor select a section of code or the entire editor contents.
2. Reveal the Library and click to save the code.
3. Save the code to a target folder.
4. (optional) Update `MANIFEST.md` to register the new files (AI can do this for you — see below).

---

## Suggested folder structure

You can organize your library using any structured desired. But, there are some suggested structures that natually fit into how this project is structured. Here are the suggested subfolders by FileMaker object type. The following folder names are the canonical categories used throughout FileMaker development:

| Folder           | Contents                                                                |
| ---------------- | ----------------------------------------------------------------------- |
| `Calculations/`  | Reusable calculation expressions (HR `.txt` files)                      |
| `Fields/`        | Field definitions — data types, auto-enter options, validation rules    |
| `Functions/`     | Custom function definitions                                             |
| `Layouts/`       | Layout objects — buttons, portals, web viewers, and other UI components |
| `Menus/`         | Custom menu sets                                                        |
| `Scripts/`       | Complete scripts (XML or HR)                                            |
| `Steps/`         | Reusable step blocks and script patterns (XML or HR)                    |
| `Tables/`        | Table definitions                                                       |
| `Themes/`        | Layout themes                                                           |
| `Webviews/`      | Self-contained HTML for use in Set Web Viewer steps                     |

You may add subfolders within any category to organize further (for example, `Functions/JSON/` or `Functions/Text/`). Subfolder paths are reflected in `MANIFEST.md`.

---

## File formats

Library files can be stored in two formats:

### fmxmlsnippet (XML)

The native clipboard format for FileMaker objects. The root element is always:

```xml
<fmxmlsnippet type="FMObjectList">
  <!-- one or more FileMaker objects -->
</fmxmlsnippet>
```

FileMaker writes this format to the clipboard when you copy objects. Each object type uses a different proprietary clipboard class — FileMaker objects are **not** plain text on the clipboard.

| What you copy in FileMaker                           | Clipboard class |
| ---------------------------------------------------- | --------------- |
| One or more script steps                             | `XMSS`          |
| An entire script (from the Script Workspace list)    | `XMSC`          |
| One or more fields (from the Fields & Tables dialog) | `XMFD`          |
| A custom function (from the Custom Functions dialog) | `XMFN`          |
| Layout objects (selected on a layout)                | `XML2`          |
| A table definition (`<BaseTable>`)                   | `XMTB`          |
| A value list                                         | `XMVL`          |
| A theme                                              | `XMTH`          |

### Human-readable (HR) code

Plain-text files containing FileMaker script steps or calculation code saved from the webviewer. These use `.txt` as the file extension.

- **HR script steps** — the same indented, human-readable script notation used in `scripts_sanitized/`. The webviewer's converter handles HR→fmxmlsnippet translation when pasting into FileMaker.
- **Calculation code** — raw FileMaker calculation expressions (e.g., `Let()` blocks, custom function bodies).

HR files are useful when you want to store readable logic that can be adapted into different contexts, or when the webviewer is your primary editing environment.

### Getting a snippet out of FileMaker (XML workflow)

Because FileMaker clipboard data is binary-encoded, **do not use `pbpaste`** — it will corrupt multi-byte UTF-8 characters such as `≠`, `≤`, `≥`, and `¶` that are common in FileMaker calculations.

Use the provided helper script instead:

```bash
# 1. Copy objects in FileMaker (⌘C)
# 2. Run:
python3 agent/scripts/clipboard.py read agent/library/Scripts/script\ -\ My\ Utility.xml
```

The script auto-detects the clipboard class, extracts the binary data, decodes it to UTF-8, and writes formatted XML to the file you specify.

For full technical details on how the clipboard encoding works, see `agent/docs/CLIPBOARD.md`.

### Saving from the webviewer (HR workflow)

In the webviewer code editor, select a section of code or the entire editor contents, open the Library panel, and save the code to a target folder. The file is saved as plain text (`.txt`).

### Naming convention

Use descriptive, lowercase-with-hyphens file names that identify the object type and purpose. Use `.xml` for fmxmlsnippet files and `.txt` for HR code:

```
script - HTTP Request.xml
steps - tryCatchTransaction.xml
function - JSONIsValid.xml
fields - default.xml
steps - error handling pattern.txt
calc - invoice total.txt
```

---

## Maintaining MANIFEST.md

`MANIFEST.md` is the index AI uses to find library items without reading every file. It maps each file to a plain-English description and a set of keyword tags.

**It ships empty.** You must populate it as you add files to the library.

### Asking AI to update the manifest

After adding or removing files, ask AI:

> "Scan the `agent/library` folder, compare it against `agent/library/MANIFEST.md`, and update the manifest — adding entries for any new files and removing entries for any deleted files. For new files, read each one to write an accurate description and relevant keyword tags."

AI will list the folder, diff it against the current manifest, read any new files, and rewrite `MANIFEST.md` in place.

### Updating the manifest manually

Open `MANIFEST.md` and add a row to the appropriate section table:

```
| `Category/filename` | One-sentence description of what the code does | keyword1, keyword2, keyword3 |
```

**Tips for writing good keywords:**

- Use the words a developer would say when asking for the code, not the filename.
- Include common synonyms and related concepts.
- For functions, include the function name itself as a keyword.
- For step patterns, include the names of the key script steps involved.

### Example manifest

A populated `MANIFEST.md` looks like this:

```markdown
# Library Manifest

All paths are relative to `agent/library/`. Each entry includes a description and keyword tags used to match the item against a task before reading the file.

---

## Scripts — Complete reusable scripts

| Path                                     | Description                                                                                                                       | Keywords                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `Scripts/script - HTTP Request.xml`      | Parameterized HTTP/API request handler; supports method, URL, headers, and body via JSON parameter; includes debug logging toggle | http, api, request, web service, fetch, post, get, insert from url |
| `Scripts/script - Server Send Email.xml` | Send HTML email via SMTP from a server-side script                                                                                | email, send email, smtp, html email, server email                  |

---

## Steps — Reusable step blocks and patterns

| Path                                    | Description                                                                                        | Keywords                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Steps/steps - tryCatchTransaction.xml` | Try/catch with Open Transaction / Commit Transaction and rollback on error; `$errorLevel` tracking | transaction, try, catch, commit, rollback, open transaction, error rollback |
| `Steps/steps - TimeoutSteps.xml`        | Polling loop with timestamp-based timeout; uses Pause/Resume Script at 1/8 second intervals        | timeout, wait, polling, pause, loop until, wait for condition               |

---

## Functions — Custom function definitions

| Path                                        | Description                                                                     | Keywords                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `Functions/JSON/function - JSONIsValid.xml` | `JSONIsValid(json)` — returns true if the value is a valid JSON object or array | json valid, validate json, json check, is json            |
| `Functions/Text/function - CSStoFMText.xml` | `CSStoFMText(text)` — converts CSS-styled HTML text to FileMaker styled text    | css, html to fm text, styled text, text format, rich text |

---

## Calculations — Reusable calculation expressions (HR)

| Path                                          | Description                                                              | Keywords                                          |
| --------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| `Calculations/calc - invoice total.txt`       | `Let()` block that computes invoice total with tax and discount          | invoice, total, tax, discount, let, calculation   |
| `Calculations/calc - parse full name.txt`     | Splits a full name into first, middle, and last components               | name, parse, split, first name, last name, text   |
```

Each category gets its own `##` section. AI reads only the sections and rows whose keywords match the current task.

---

## Using an existing snippet collection

If you maintain snippets in a separate repository, you can link it here as a git submodule:

```bash
git submodule add <repo-url> agent/library
```

After linking, run the AI manifest update described above so the new files are indexed.

---

## Reusable Settings Package

The `Settings` package in this library is a reusable pattern, not just a snapshot from one solution.

### What it contains

Custom functions:

- `Settings_Get`
- `Settings_GetObject`
- `Settings_IsLoaded`
- `Settings_CacheVersion`
- `Settings_GetScopeObject`
- `LayoutSetting_Get`
- `LayoutSetting_Set`

Scripts:

- `SETTINGS__Load`
- `SETTINGS__EnsureLoaded`
- `SETTINGS__SetValue`
- `SETTINGS__BulkSet`
- `SETTINGS__SyncScopeDraft`
- `SETTINGS__LayoutEnter`
- `SETTINGS__LayoutExit`

### What it assumes

Your target solution should already provide:

- a `Settings` table occurrence
- a `Settings::FUNCTION` field that evaluates to the committed JSON payload
- response helper CFs:
  - `Response_Init`
  - `Response_AddError`
  - `Response_SetData`
  - `Response_Finalize`
- a `GlobalSettings` helper CF returning `$$SETTINGS`

### Recommended installation order

1. Install the helper dependencies in the target file.
2. Seed the `_system.settings_version` row in the `Settings` table.
3. Install the Settings custom functions.
4. Install the Settings scripts.
5. Wire startup into `SETTINGS__EnsureLoaded`.
6. Add `SETTINGS__LayoutEnter` and `SETTINGS__LayoutExit` only to layouts that use layout-scope draft settings.

### Settings scopes

The package assumes three setting scopes:

- `app.*`
  Global app configuration. Save explicitly.
- `layouts.<layoutNumber>.*`
  Layout-specific draftable preferences. Load on layout enter, sync on layout exit.
- `tables.<baseTableName>.*`
  Shared settings used by multiple layouts for the same table. Write through immediately.

### Important trade-offs

- `$$SETTINGS` is session-local, so stale caches are detected with `_system.settings_version`.
- `$$LAYOUT_SETTINGS` is keyed by layout number, not by window.
- If the same layout is open in multiple windows, those windows intentionally share one in-memory draft.
- If the client crashes before layout exit, committed settings remain safe and unsaved draft changes are discarded.

See [SETTINGS_API.md](/Users/emircajic/agentic-fm/agent/docs/SETTINGS_API.md) for the full architecture and migration notes.
