---
name: script-create
description: Write a new FileMaker script from scratch — loads context, applies the response envelope framework, branches to epSQL when native FM steps would be slow or complicated, generates fmxmlsnippet XML, lints, and deploys. Triggers on "write a script", "create a script", "build a script", "new script for", or when script-preview hands off with "generate the XML".
---

# Script Create

Generate a production-ready FileMaker script as fmxmlsnippet XML, with the response envelope baked in and epSQL applied where it earns its place.

---

## Step 1: Determine the automation tier

Read `agent/config/automation.json` and check `project_tier` (preferred) or `default_tier`:

- **Tier 1** — script goes to clipboard with manual paste instructions
- **Tier 3** — agent can deploy directly into Script Workspace

---

## Step 2: Load context

Run the following in parallel:

1. Read `agent/CONTEXT.json` — extract `task`, `current_layout`, tables, fields, relationships, scripts, layouts, value lists. Confirm the task description matches the developer's request; if mismatched, suggest running Push Context on the correct layout before proceeding.
2. Read `agent/docs/CODING_CONVENTIONS.md`
3. Scan `agent/docs/knowledge/MANIFEST.md` for keyword matches against the task — read and apply any matching documents
4. Scan the `agent/library/` manifest (`library-lookup` skill) for reusable code — if found, plan to adapt it rather than write from scratch

If `CONTEXT.json` is absent or stale, ask the developer to run Push Context from the correct layout before continuing.

---

## Step 3: Choose the data tier

Read the task and decide which data access path to use. This decision is made once before writing a single step.

### Use native FM steps when:
- Operating on the current record or a small set already in context
- A single Set Field, Go to Related Record, or Commit is sufficient
- The operation is user-facing and benefits from FM's built-in record locking / conflict UI

### Use epSQL when:
- The native approach would require a navigate + find + set-field + commit loop across many records
- Bulk UPDATE or DELETE — native FM has no equivalent
- A portal field sync or cross-table write where layout switching would be slow or error-prone
- The logic would be meaningfully simpler as a SQL query than as FM script steps

If epSQL applies, proceed through the standard response envelope scaffold in Step 4, then apply the SQL conventions in Step 5B when writing the Work section. Otherwise, skip Step 5B entirely.

**Default to native FM steps.** Only branch to epSQL when you can articulate why the native approach is inadequate.

---

## Step 4: Scaffold — response envelope

Every script uses this structure. No exceptions, including one-shot and utility scripts.

```
Allow User Abort [ Off ]
Set Error Capture [ On ]
Set Variable [ $void ; Value: Params.parse ( Get ( ScriptParameter ) ; "param1|param2" ) ]
Set Variable [ $void ; Value: Response_Init ( "{}" ) ]
Set Variable [ $void ; Value: Log.add ( "info" ; "SCRIPT_START" ; "<ScriptName>" ; $params ) ]

# === VALIDATE ===
# guard clauses here — Response_AddError then Exit Script [ Text Result: Response_Finalize ] on failure

# === WORK ===
# main logic here — native FM steps or epSQL depending on Step 3 decision

# === DONE ===
Set Variable [ $void ; Value: Response_SetData ( ... ) ]
If [ $isRoot ]
    Perform Script [ "UTIL__FlushLog" ; Parameter: JSONSetElement ( "{}" ; "traceID" ; $traceID ; JSONString ) ]
End If
Exit Script [ Text Result: Response_Finalize ]
```

**Rules:**
- `Params.parse` always first — auto-detects JSON/pipe/KV, sets `$traceID` and `$isRoot`
- `Response_Init` always second
- Every exit path goes through `Response_Finalize` — never bare `Exit Script [ "" ]`
- `UTIL__FlushLog` called only when `$isRoot = True` — subscript callers must forward `traceID`
- Error exits: `Response_AddError ( code ; text ; field ; context ; "" )` then `Exit Script [ Text Result: Response_Finalize ]`
- Subscript results: `Response_Absorb ( Get ( ScriptResult ) )` then check `Response_HasErrors ( $response )` for fail-fast

Use script IDs from CONTEXT.json for all `Perform Script` references.

---

## Step 5A: Work section — native FM steps

Write the logic using standard FileMaker steps. Resolve all field, layout, and script references from CONTEXT.json.

For `Perform Find` steps: always include a `<Restore>` child element (S009 lint rule).

---

## Step 5B: Work section — epSQL (branch, only if Step 3 decided SQL)

**UPDATE / DELETE — prefer over navigate + find + set-field loops:**

```
Set Variable [ $sql ; Value:
    "UPDATE \"TableName\" SET \"FieldName\" = " & epSQLQuote ( $value ) &
    " WHERE \"ID\" = " & epSQLQuote ( $id )
]
Set Variable [ $err ; Value: epSQLExecute ( $sql ) ]
If [ not IsEmpty ( $err ) ]
    Set Variable [ $void ; Value: Response_AddError ( "DB_ERR" ; $err ; "" ; $sql ; "" ) ]
    Exit Script [ Text Result: Response_Finalize ]
End If
```

**SELECT with loop — use a named result set to protect the buffer:**

```
Set Variable [ $err ; Value: epSQLExecute ( "SELECT ..." ; "useSQLResult=mySet" ; $param ) ]
Set Variable [ $rowCount ; Value: epSQLResultRowCount ( "mySet" ) ]
# loop $i from 0 to $rowCount - 1 — read via epSQLResult ( $i ; 0 ; "mySet" )
# inner SELECTs may use the unnamed buffer safely — "mySet" is untouched
Set Variable [ $void ; Value: epSQLResultDelete ( "mySet" ) ]
```

**Quoting:**
- Values: always `epSQLQuote ( value )` — never manual single-quoting
- Table/field identifiers: always double-quoted in the SQL string — `"TableName"."FieldName"`
- `epFMNameID` for plugin call arguments (e.g. `epScriptQueue`) — not inside SQL query strings

**Hard limits:**
- JOINed SELECTs: ≤ 3 columns — silent empty-result bug above ~3; split into separate SELECTs if more are needed
- Loop exit condition: always `epSQLResultRowCount`, never `IsEmpty ( epSQLResult ( $i ; 0 ) )`
- When called from `OnObjectSave` or any trigger that leaves a record open: `Commit Records/Requests [ With dialog: Off ]` before the first `epSQLExecute` (avoids error 301)

---

## Step 6: Look up step structure

For each step type used in Steps 5A or 5B, grep the step catalog — never read the full file:

```bash
grep -A 60 '"name": "Step Name"' "agent/catalogs/step-catalog-en.json"
```

Use catalog `params`, `selfClosing`, and `id` to construct XML. Check `notes` for behavioral gotchas. Fall back to `snippet_examples` (path in `snippetFile`) only when `status` is `"auto"` or `"unfinished"`.

---

## Step 7: Preview gate (optional)

If the developer has not already confirmed logic via `script-preview`, produce an HR preview now and ask:

```
AskQuestion:
{
  "question": "Does this logic look right before I generate the XML?",
  "options": [
    { "id": "good", "label": "Looks good — generate the XML" },
    { "id": "changes", "label": "I have changes" }
  ]
}
```

If the developer already confirmed via `script-preview`, skip directly to Step 8.

---

## Step 8: Generate fmxmlsnippet XML

Write to `agent/sandbox/<ScriptName>.xml`.

**Output rules:**
- Wrapper: `<fmxmlsnippet type="FMObjectList">` only — no `<Script>` tags
- Step structure from catalog, not xml_parsed verbose format
- No XML comments — use `# (comment)` steps (id 89) for inline notes; disabled `Insert Text` steps targeting `$README` for doc blocks
- All IDs resolved from CONTEXT.json; `id="0"` is acceptable for auto-assigned elements
- Verify every `If` has a matching `End If` and every `Loop` has a matching `End Loop` before saving

---

## Step 9: Lint

```bash
python3 -m agent.fmlint agent/sandbox/<ScriptName>.xml
```

- Fix all **ERROR**-severity diagnostics before continuing
- Surface **WARNING**-severity to the developer — do not auto-fix

---

## Step 10: Deploy

Run `agent/scripts/deploy.py` at the appropriate tier.

**Tier 1 — manual paste:**

> The script is on your clipboard. To install it:
>
> 1. Open **Script Name** in Script Workspace
> 2. **⌘A** — select all existing steps and delete
> 3. **⌘V** — paste

**Tier 3 — autonomous:** deploy directly via the companion server.

---

## Handoffs

- **Before generation, complex logic:** hand off to `script-preview` to confirm steps first
- **After generation, code review requested:** hand off to `script-review`
- **After generation, tests requested:** hand off to `script-test`
- **Modifying an existing script instead of net-new:** hand off to `script-refactor`
