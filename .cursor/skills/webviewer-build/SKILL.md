---
name: webviewer-build
description: Generate a complete web application inside a FileMaker Web Viewer — cloned from ExampleProject template, built with Vite/Tailwind, plus companion FM scripts for the data push. Use when the developer says "web viewer", "webviewer app", "HTML in FileMaker", "build web viewer", or when the layout-design skill delegates to the web-first output path. Recommended for modern, responsive UI, complex interactions (drag-and-drop, charts, rich text), or solutions considering future migration off FileMaker.
---

# WebViewer Build

Generate a web application that runs inside a FileMaker Web Viewer, along with the companion FM scripts that push data into it.

---

## Architecture — read this first

### The web viewer is purely reactive. It never initiates data requests.

**All user controls (date pickers, text inputs, dropdowns, buttons) live on the FM layout as native FileMaker objects.** The web viewer receives data and renders it — nothing more. This eliminates the FM→WV→FM race condition entirely.

```
User interacts with FM native controls
    ↓
FM script runs (triggered by button / OnObjectSave / OnLayoutEnter)
    ↓ Perform JavaScript in Web Viewer
    ↓ calls window.receiveFromFileMaker(data)
Web Viewer renders the result
    ↓ FileMaker.PerformScript() — navigation/actions only
FM handles navigation or side-effects
```

**The web viewer may call FM scripts only for:**
- Navigating to a related record (Go to Related Record pattern)
- Triggering a side-effect action (print, export, open a card window)

**The web viewer must never call FM to fetch or refresh data.** If data needs to refresh, the FM script re-runs and pushes again.

### Bridge functions

| Direction | Mechanism | Function name |
|-----------|-----------|---------------|
| FM → WV | `Perform JavaScript in Web Viewer` | `window.receiveFromFileMaker(data)` |
| WV → FM | `FileMaker.PerformScript()` | script name as string |

Always use `window.receiveFromFileMaker` as the JS entry point — this matches the ExampleProject template and the mock FileMaker dev environment.

---

## Step 1: Determine the automation tier

Read `agent/config/automation.json` and check `project_tier` (preferred) or `default_tier`:

- **Tier 1** — FM scripts go to clipboard with paste instructions
- **Tier 2/3** — agent can deploy FM scripts via companion server automation

Also read `companion_url` for preview.

---

## Step 2: Gather context

1. Read `agent/CONTEXT.json` for:
   - `current_layout` — the layout where the Web Viewer will be placed
   - `tables` — schema for fields the FM push script will query
   - `scripts` — existing scripts the WV may need to call for navigation/actions
   - `value_lists` — if the FM layout needs dropdowns to drive the query

2. If CONTEXT.json is absent or scoped to the wrong layout, ask the developer to run **Push Context** on the target layout.

3. Read theme data from `agent/context/{solution}/`:
   ```bash
   cat agent/context/*/theme.css 2>/dev/null
   cat agent/context/*/theme-manifest.json 2>/dev/null
   ```

4. Clarify the **data contract**: what JSON shape will FM push? What columns/fields? What does a row object look like? Document this before touching any code.

---

## Step 3: Design conversation

Before building, confirm with the developer:

1. **What does the WV display?** — table, cards, chart, detail view?
2. **What FM native controls drive it?** — which global fields on the layout feed the query?
3. **What FM script pushes the data?** — is it a button trigger, OnLayoutEnter, or OnObjectSave?
4. **What navigation actions does the WV need?** — which records to jump to, which layouts?
5. **What does an empty/loading/error state look like?**

If a spec from `layout-spec` exists, extract answers from that.

---

## Step 4: Clone and customise the ExampleProject template

The web viewer app is built from the template at `agent/library/ExampleProject/`. **Never write a self-contained HTML from scratch.** Clone the template, rename it, then customise.

### 4a — Clone

```bash
cp -r agent/library/ExampleProject agent/sandbox/{app-name}
```

Replace `{app-name}` with a kebab-case name matching the feature (e.g. `stavke-query`, `inventory-dashboard`).

### 4b — Install dependencies

```bash
cd agent/sandbox/{app-name}
npm install
```

### 4c — Edit the application files

| File | What to change |
|------|---------------|
| `index.html` | Page structure, layout, Tailwind classes |
| `src/js/main.js` | `receiveFromFileMaker(data)` handler, render logic, FM script calls |
| `src/styles/main.css` | Custom CSS beyond Tailwind |
| `src/js/mock-data.json` | Realistic sample data matching the real JSON shape FM will push |

#### main.js patterns

```javascript
// FM pushes data here — this is the ONLY entry point
window.receiveFromFileMaker = (data) => {
  // data is already a parsed object (the mock) or a JSON string (real FM)
  const payload = typeof data === 'string' ? JSON.parse(data) : data;
  renderTable(payload.rows);
};

// WV calls FM only for navigation / side-effects — never for data
function goToRecord(id) {
  if (typeof FileMaker !== 'undefined') {
    FileMaker.PerformScript('WV__GoToInvoice', id);
  }
}
```

#### mock-data.json

Populate with realistic sample data that matches exactly the JSON shape the FM push script will produce. The dev server uses this to simulate FM pushes so the UI can be developed without FM open.

### 4d — Build for production

```bash
cd agent/sandbox/{app-name}
npm run build
```

Output: `agent/sandbox/{app-name}/dist/index.html` — a single self-contained HTML file with all CSS and JS inlined. This is what goes into the FM Web Viewer.

### 4e — Develop iteratively

Use the dev server for fast iteration:

```bash
npm run dev
```

The dev server includes the **Mock FileMaker Environment**: a panel in the bottom-right corner that lets you send mock data to the app and see script calls logged — no FM needed. When the UI looks right, run `npm run build` for the production artifact.

---

## Step 5: Generate the FM push script

This script runs on the FM side — triggered by a button or script trigger — reads native FM field values, queries the data, builds a JSON payload, and pushes it to the web viewer.

### Structure

```
PURPOSE: Query and push data to wv_{appName}.
PARAMS: (none — reads from global fields on the layout)

Allow User Abort [ Off ]
Set Error Capture [ On ]

# MARK: Read filter values from FM global fields
Set Variable [ $datumOd  ; {GlobalTable}::g_DatumOd ]
Set Variable [ $datumDo  ; {GlobalTable}::g_DatumDo ]
Set Variable [ $filter   ; {GlobalTable}::g_Filter ]

# MARK: Run query (epSQLExecute with named result set)
Set Variable [ $sel ; epSQLExecute ( "SELECT ..." ; "useSQLResult=rs" ; params ) ]
If [ not IsEmpty ( $sel ) ]   // error
  Perform JavaScript in Web Viewer [ "wv_{appName}" ; "receiveFromFileMaker" ; $errPayload ]
  Exit Script [ ... ]
End If

# MARK: Build JSON rows array
Set Variable [ $rowCount ; epSQLResultRowCount ( "rs" ) ]
Set Variable [ $i ; 0 ]
Set Variable [ $rows ; "[]" ]
Loop [ Flush: Always ]
  Exit Loop If [ $i ≥ $rowCount ]
  Set Variable [ $row ; JSONSetElement ( "{}" ; ... ) ]
  Set Variable [ $rows ; JSONSetElement ( $rows ; "[" & $i & "]" ; $row ; JSONObject ) ]
  Set Variable [ $i ; $i + 1 ]
End Loop
Set Variable [ $void ; epSQLResultDelete ( "rs" ) ]

# MARK: Push to web viewer
Set Variable [ $payload ; JSONSetElement ( "{}" ; [ "rows" ; $rows ; JSONArray ] ) ]
Perform JavaScript in Web Viewer [ Object Name: "wv_{appName}" ;
  Function Name: "receiveFromFileMaker" ; Parameters: $payload ]

Exit Script [ JSONSetElement ( "{}" ; "status" ; "ok" ; JSONString ) ]
```

### Date handling in SQL

**Always use `epSQLQuoteDate()` to inline date values — never pass FM Date values as `?` params.** See `memory/feedback_sql_plugin.md` for the full rule and the ISO-string-to-FM-Date conversion pattern.

```
// Correct — dates inlined via epSQLQuoteDate
"WHERE MyTable.Datum >= " & epSQLQuoteDate ( $datumOd ) &
" AND  MyTable.Datum <= " & epSQLQuoteDate ( $datumDo ) &
" AND  MyTable.Name  LIKE ?"  ;  // text params still use ?
"useSQLResult=rs" ; $nameParam
```

### Script generation rules

1. Grep the step catalog for each step type used
2. Resolve field/layout/script IDs from CONTEXT.json
3. Follow `agent/docs/CODING_CONVENTIONS.md`
4. Write to `agent/sandbox/`
5. Validate with `python3 -m agent.fmlint agent/sandbox/{script}.xml`

---

## Step 6: Generate navigation/action scripts (if needed)

If the web viewer has buttons that navigate to related records, generate one lightweight script per destination:

```
PURPOSE: Navigate to Invoice record by PrimaryKey. Called from WV navigation button.
PARAMS: PrimaryKey (text, UUID)

Allow User Abort [ Off ]
Set Error Capture [ On ]
Set Variable [ $id ; Get ( ScriptParameter ) ]
Go to Layout [ "TargetLayout" ]
Enter Find Mode [ Pause: Off ]
Set Field [ Table::PrimaryKey ; $id ]
Perform Find
Exit Script [ JSONSetElement ( "{}" ; "status" ; "ok" ; JSONString ) ]
```

These scripts are one-way — the web viewer calls them and does not expect a response.

---

## Step 7: Preview and iterate

After `npm run build`:

1. Open `agent/sandbox/{app-name}/dist/index.html` in a browser to verify the static shell.
2. In FM, load it in the Web Viewer:
   - Web Viewer URL: `"file:" & Get ( DocumentsPath ) & "{app-name}/index.html"`  
     (place the `dist/index.html` in the Documents folder, or use the full path)
3. Trigger the FM push script manually to push data and verify `receiveFromFileMaker` renders correctly.

Iterate: edit source → `npm run build` → refresh the Web Viewer in FM (re-trigger push script).

---

## Step 8: Output and deployment

### Files produced

| Path | Purpose |
|------|---------|
| `agent/sandbox/{app-name}/` | Full Vite project — source of truth for future edits |
| `agent/sandbox/{app-name}/dist/index.html` | Production artifact — loaded into `HTML::{fieldName}` |
| `agent/sandbox/{push-script-name}.xml` | fmxmlsnippet — FM push script |
| `agent/sandbox/{nav-script-name}.xml` | fmxmlsnippet — navigation/action scripts |

### Preferred HTML deployment — `HTML` table + `displayHTMLfrom`

**Never store the HTML in a global field.** Global fields cause multi-user initialisation problems and pollute the globals namespace. Instead, the solution has a dedicated single-record `HTML` table where each web viewer gets its own named field.

**Check the `HTML` table first:**
```bash
grep "^HTML|" agent/context/Autoklinika/fields.index
```

If a field matching your feature already exists (e.g. `StavkePrimkeQuery`), use it. If not, add a new `Text` field with a descriptive name (e.g. `InvoiceDashboard`) via `schema-build`.

**Web Viewer URL formula:**
```
displayHTMLfrom ( "HTML" ; "StavkePrimkeQuery" )
```

The `displayHTMLfrom` custom function (ID 96) does:
```
ExecuteSQL ( "SELECT HTML.{fieldName} FROM HTML FETCH FIRST 1 ROWS ONLY" ; "" ; "" )
```
and wraps the result as a `data:text/html,` URL. No globals, no initialization script, no multi-user conflict.

**Load the HTML into the field:**

After `npm run build`, copy the contents of `dist/index.html` into `HTML::{fieldName}`.

Tier 1 — manual:
> 1. Open the `HTML` table's admin layout (or any layout with `HTML::{fieldName}`)
> 2. Select all content in the field and paste the contents of `dist/index.html`
> 3. Commit the record

Tier 2/3 — use the OData API to PATCH the field:
```bash
python3 agent/scripts/odata_patch.py \
  --table HTML \
  --field {fieldName} \
  --file agent/sandbox/{app-name}/dist/index.html
```
(Check `agent/docs/AUTOMATION.md` for the OData patch pattern.)

### Deploy FM scripts (Tier 1)

```bash
python3 agent/scripts/clipboard.py write agent/sandbox/{push-script-name}.xml
```

> Create new script **`{PushScriptName}`** in Script Workspace → **⌘V** paste

Repeat for each navigation script.

### Install the Web Viewer on the FM layout

> 1. Open **{Layout Name}** in Layout Mode
> 2. Add native FM fields/buttons for each filter parameter (regular or global fields on the layout)
> 3. Add a **Web Viewer** object sized to the display area
> 4. Set the Web Viewer's **Object Name** to **`wv_{appName}`** (Inspector → Position → Name)
> 5. Set the URL formula: `displayHTMLfrom ( "HTML" ; "{fieldName}" )`
> 6. Wire the **Pretraži / Refresh button** to run **`{PushScriptName}`**
> 7. Optionally set **OnLayoutEnter** trigger to also run the push script for auto-load

---

## When to use the Web Viewer path

**Stronger than native FM when:**
- Scrollable result tables with many columns
- Data visualisations — charts, KPIs, Gantt, calendars
- Complex row-level interactions — expandable rows, tooltips, inline icons
- Future migration off FileMaker — the HTML/CSS/JS is portable

**Native FM is stronger when:**
- Printing — FM's print engine handles sub-summaries and page breaks natively
- Simple forms and detail views — native fields are faster to build
- Privilege-based field access — FM security controls field visibility automatically
- Accessibility — native FM objects have built-in a11y support

---

## Constraints

- **WV is purely reactive** — no user input controls inside the web viewer. All controls are native FM objects.
- **No WV-initiated data fetch** — the WV never calls FM to request data. FM always pushes.
- The `dist/index.html` must be fully self-contained — Vite's build step handles this automatically.
- `Perform JavaScript in Web Viewer` requires the Web Viewer object to have a **named Object Name** set in the Inspector.
- `window.receiveFromFileMaker` is the standard entry-point name — do not change it; it matches the ExampleProject template and mock environment.
- All FM script output follows fmxmlsnippet conventions — steps only, no `<Script>` wrapper, validated with fmlint before delivery.
- Field IDs and script IDs must come from CONTEXT.json — never invent references.
- Follow `agent/docs/CODING_CONVENTIONS.md` for all FM script calculations.
