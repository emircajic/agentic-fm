# FileMaker Script Framework — Orchestrator / Pure Function Pattern

This document is the canonical reference for the script architecture used across all solutions in this library. Every script written under this framework follows these conventions. When AI generates code in a solution that has installed this framework, it should use this document as the primary behavioral specification.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  CALLER  (button, OnLayoutEnter trigger, test harness)          │
│  — Provides params, receives result, owns UI (dialogs, refresh) │
└────────────────────────┬────────────────────────────────────────┘
                         │  JSONSetElement("{}" ; params + traceID)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR  (e.g. INV__ProcessInvoice, TK__BuildLedger)      │
│  — Params.parse on entry                                        │
│  — Sequences calls to pure functions and effectful workers      │
│  — Collects messages via Response_Absorb or exits on fail       │
│  — If $isRoot: calls UTIL__FlushLog on exit                     │
│  — Returns Response_Finalize — never shows UI                   │
└────────────┬───────────────────────────┬────────────────────────┘
             │                           │
             ▼                           ▼
┌────────────────────────┐  ┌────────────────────────────────────┐
│  PURE FUNCTIONS        │  │  EFFECTFUL WORKERS                 │
│  — No Set Field        │  │  — Set Field, New Record, Commit   │
│  — No Go to Layout     │  │  — One transaction scope           │
│  — No side effects     │  │  — Go to Layout only if needed     │
│  — Input → JSON out    │  │  — Always return Response envelope │
└────────────────────────┘  └────────────────────────────────────┘
```

The **three invariants** that make this work:

1. Every script — orchestrator, pure function, or worker — returns a Response envelope.
2. Every script starts with `Params.parse`. No exceptions.
3. UI code lives only in the Caller layer.

---

## The Response Envelope

```json
{
  "status": "success | fail | partial_success",
  "data": { },
  "messages": {
    "error":   [ { "code": "", "text": "", "field": "", "context": {}, "script": "", "timestamp": "" } ],
    "warning": [ ],
    "info":    [ ]
  }
}
```

- **`status`** is always derived automatically by `Response_Finalize` — never set manually.
  - `fail` if any errors present
  - `partial_success` if warnings but no errors
  - `success` if neither
- **`data`** is wiped to `{}` on fail by `Response_Finalize`. Preserved when `$$~DEBUG = 1`.
- **`messages.*`** arrays are the communication channel between scripts and the caller.

---

## CF Inventory

### Building a response (side-effect CFs — mutate `$response`)

These are called inside a script to build the response being constructed.
`Response_Init` must be called first; `Response_Finalize` must be the Exit Script value.

| CF | Signature | Purpose |
|---|---|---|
| `Response_Init` | `Response_Init ( dataJSON )` | Initialise `$response`; optional seed data |
| `Response_AddError` | `Response_AddError ( code ; text ; field ; contextJSON ; script )` | Add an error message |
| `Response_AddWarning` | `Response_AddWarning ( code ; text ; field ; contextJSON ; script )` | Add a warning message |
| `Response_AddInfo` | `Response_AddInfo ( code ; text ; field ; contextJSON ; script )` | Add an info message |
| `Response_SetData` | `Response_SetData ( dataJSON )` | Set or replace the data payload |
| `Response_Absorb` | `Response_Absorb ( subResponse )` | Merge all messages from a sub-script result into `$response` |
| `Response_Finalize` | `Response_Finalize` | Derive status, wipe data on fail (unless debug), return `$response` |

### Reading a response (pure reader CFs — no side effects, take `response` param)

These are called in the CALLER or ORCHESTRATOR to inspect a result returned by `Get(ScriptResult)`.

| CF | Signature | Returns |
|---|---|---|
| `Response_IsOk` | `Response_IsOk ( response )` | Boolean — status = "success" |
| `Response_HasErrors` | `Response_HasErrors ( response )` | Boolean — any errors present |
| `Response_HasWarnings` | `Response_HasWarnings ( response )` | Boolean — any warnings present |
| `Response_GetStatus` | `Response_GetStatus ( response )` | Text — "success", "fail", "partial_success" |
| `Response_GetData` | `Response_GetData ( response )` | JSONObject — the data payload |
| `Response_GetErrors` | `Response_GetErrors ( response )` | JSONArray — all error message objects |
| `Response_GetWarnings` | `Response_GetWarnings ( response )` | JSONArray — all warning message objects |
| `Response_GetInfos` | `Response_GetInfos ( response )` | JSONArray — all info message objects |
| `Response_GetErrorCount` | `Response_GetErrorCount ( response )` | Number — count of errors |
| `Response_GetWarningCount` | `Response_GetWarningCount ( response )` | Number — count of warnings |
| `Response_FirstError` | `Response_FirstError ( response )` | Text — first error's human text |
| `Response_FirstErrorCode` | `Response_FirstErrorCode ( response )` | Text — first error's machine code |

### Params

| CF | Signature | Side effects |
|---|---|---|
| `Params.parse` | `Params.parse ( raw ; schema )` | Sets `$<key>` for all params, `$params`, `$traceID`, `$isRoot` |

### Logging

| CF | Signature | Side effect |
|---|---|---|
| `Log.add` | `Log.add ( level ; code ; message ; contextJSON )` | Appends to `$$~LOG` |

---

## The Trace ID System

Every invocation chain shares a single `$traceID` UUID. `Params.parse` handles it automatically:

- If `traceID` is absent in the incoming parameter → this script is the **root** → a UUID is generated → `$isRoot = True`
- If `traceID` is present → this script is a **sub-script** → the same ID is used → `$isRoot = False`

When calling sub-scripts, always forward the trace ID:
```
Perform Script [ "SomeWorker" ; Parameter: JSONSetElement ( $params ;
    "traceID" ; $traceID ; JSONString
) ]
```

Or when building a new param object:
```
Perform Script [ "SomeWorker" ; Parameter: JSONSetElement ( "{}" ;
    [ "invoiceID" ; $invoiceID ; JSONString ] ;
    [ "traceID"   ; $traceID   ; JSONString ]
) ]
```

The root orchestrator flushes the log on exit:
```
If [ $isRoot ]
    Perform Script [ "UTIL__FlushLog" ; Parameter: JSONSetElement ( "{}" ; "traceID" ; $traceID ; JSONString ) ]
End If
Exit Script [ Response_Finalize ]
```

---

## Script Templates

### Orchestrator

```
# PURPOSE: <what this orchestrator does>
# Expects: { "key1": ..., "key2": ..., "traceID": <forwarded automatically> }
# Returns: Response envelope, data: { ... }

Allow User Abort [ OFF ]
Set Error Capture [ ON ]
Set Variable [ $void ; Params.parse ( Get ( ScriptParameter ) ; "key1|key2" ) ]
Set Variable [ $void ; Response_Init ( "{}" ) ]
Set Variable [ $void ; Log.add ( "info" ; "START" ; Get ( ScriptName ) ; $params ) ]

# ── Validate ──────────────────────────────────────────────────────────────────
If [ IsEmpty ( $key1 ) ]
    Set Variable [ $void ; Response_AddError ( "MISSING_PARAM" ; "key1 is required" ; "key1" ; "{}" ; "" ) ]
End If
If [ Response_HasErrors ( $response ) ]
    Exit Script [ Response_Finalize ]
End If

# ── Step 1: pure function ─────────────────────────────────────────────────────
Perform Script [ "SomePureFunction" ; Parameter: JSONSetElement ( "{}" ;
    [ "key1"    ; $key1    ; JSONString ] ;
    [ "traceID" ; $traceID ; JSONString ]
) ]
Set Variable [ $r ; Get ( ScriptResult ) ]
If [ not Response_IsOk ( $r ) ]
    # Fail fast — pass sub-result straight through
    Exit Script [ $r ]
End If
Set Variable [ $computedValue ; JSONGetElement ( Response_GetData ( $r ) ; "result" ) ]

# ── Step 2: effectful worker ──────────────────────────────────────────────────
Perform Script [ "SomeWorker" ; Parameter: JSONSetElement ( "{}" ;
    [ "value"   ; $computedValue ; JSONString ] ;
    [ "traceID" ; $traceID       ; JSONString ]
) ]
Set Variable [ $r ; Get ( ScriptResult ) ]
Set Variable [ $void ; Response_Absorb ( $r ) ]
If [ not Response_IsOk ( $r ) ]
    Exit Script [ Response_Finalize ]
End If

# ── Exit ──────────────────────────────────────────────────────────────────────
Set Variable [ $void ; Response_SetData ( JSONSetElement ( "{}" ; "key1" ; $key1 ; JSONString ) ) ]
Set Variable [ $void ; Log.add ( "info" ; "COMPLETE" ; Get ( ScriptName ) ; $params ) ]
If [ $isRoot ]
    Perform Script [ "UTIL__FlushLog" ; Parameter: JSONSetElement ( "{}" ; "traceID" ; $traceID ; JSONString ) ]
End If
Exit Script [ Response_Finalize ]
```

### Pure Function

```
# PURPOSE: Compute <something> from input, no side effects.
# Expects: { "key1": ..., "traceID": ... }
# Returns: Response envelope, data: { "result": ... }

Allow User Abort [ OFF ]
Set Error Capture [ ON ]
Set Variable [ $void ; Params.parse ( Get ( ScriptParameter ) ; "key1" ) ]
Set Variable [ $void ; Response_Init ( "{}" ) ]

# computation only — no Set Field, no Go to Layout, no Commit
Set Variable [ $result ; $key1 & "_processed" ]

Set Variable [ $void ; Response_SetData ( JSONSetElement ( "{}" ; "result" ; $result ; JSONString ) ) ]
Exit Script [ Response_Finalize ]
```

### Effectful Worker

```
# PURPOSE: Write <something> to the database.
# Expects: { "value": ..., "traceID": ... }
# Returns: Response envelope, data: {}

Allow User Abort [ OFF ]
Set Error Capture [ ON ]
Set Variable [ $void ; Params.parse ( Get ( ScriptParameter ) ; "value" ) ]
Set Variable [ $void ; Response_Init ( "{}" ) ]

Go to Layout [ "TargetLayout" ; Animation: None ]
# ... Set Field, New Record, Commit ...
Commit Records/Requests [ With dialog: OFF ]
Set Variable [ $fmError ; Get ( LastError ) ]
If [ $fmError ≠ 0 ]
    Set Variable [ $void ; Response_AddError ( "COMMIT_FAILED" ; "Commit failed: " & $fmError ; "" ; "{}" ; "" ) ]
    Exit Script [ Response_Finalize ]
End If

Exit Script [ Response_Finalize ]
```

### Caller (button script)

```
# No Allow/Set Error Capture needed — this is UI code

Perform Script [ "SomeOrchestrator" ; Parameter: JSONSetElement ( "{}" ;
    [ "key1" ; TableOccurrence::FieldName ; JSONString ]
) ]
Set Variable [ $result ; Get ( ScriptResult ) ]

If [ Response_IsOk ( $result ) ]
    Refresh Window [ Flush cached join results: OFF ]
Else If [ Response_GetStatus ( $result ) = "partial_success" ]
    Show Custom Dialog [ Message: Response_FirstError ( $result ) ]
    Refresh Window [ Flush cached join results: OFF ]
Else
    Show Custom Dialog [ Title: "Error" ; Message: Response_FirstError ( $result ) ]
End If
```

---

## Error Codes — Convention

Use `SCREAMING_SNAKE_CASE` for machine-readable codes. Recommended prefixes:

| Prefix | Meaning |
|---|---|
| `MISSING_` | Required parameter or field is empty |
| `INVALID_` | Value is present but fails validation |
| `NOT_FOUND_` | Record lookup returned nothing |
| `LOCKED_` | Record is locked by another user |
| `COMMIT_` | Database write failure |
| `AUTH_` | Permission or authentication issue |
| `CONFLICT_` | Business rule violation |

---

## Proposed Upgrade to Response_Finalize

The existing `Response_Finalize` wipes `data` unconditionally on fail:
```
$response = Case ( _errorCount > 0 ; JSONSetElement($response;"data";"{}";JSONObject) ; $response )
```

Upgrade to preserve data during debug sessions:
```
$response = Case (
    _errorCount > 0 and not GetAsBoolean ( $$~DEBUG ) ;
    JSONSetElement ( $response ; "data" ; "{}" ; JSONObject ) ;
    $response
)
```

Set `$$~DEBUG = 1` from the Script Debugger or a dev menu to inspect partial data on failures.

---

## UTIL__FlushLog — Log Table Schema

Create this table in every solution that installs the framework:

| Field | Type | Notes |
|---|---|---|
| `PrimaryKey` | Text | Auto-enter UUID |
| `TraceID` | Text | Groups all entries for one invocation chain |
| `LogJSON` | Text | Full `$$~LOG` batch for this trace as a JSON array |
| `SessionID` | Text | `Get(PersistentID)` — which client |
| `RootScript` | Text | Name of the script that initiated the trace |
| `CreatedAt` | Timestamp | Auto-enter creation timestamp |
| `RowCount` | Number | Number of log entries in this batch |

Layout name must be `UTIL__ScriptLog`. The script uses this name to construct the Data API URL.

---

## Planned Additions

These are designed and documented but not yet built. Implement them as needed.

### `Response_GetDataKey ( response ; key )`
Reader CF that combines `Response_GetData` + `JSONGetElement` into one call. Eliminates the two-step pattern that appears after every sub-script call:
```
// Before
Set Variable [ $id ; JSONGetElement ( Response_GetData ( $r ) ; "invoiceID" ) ]
// After
Set Variable [ $id ; Response_GetDataKey ( $r ; "invoiceID" ) ]
```

### `Response_ForwardFail ( subResponse )`
Names the pass-through fail pattern. Sets `$response = subResponse` and returns it, so the caller can write:
```
If [ not Response_IsOk ( $r ) ]
    Exit Script [ Response_ForwardFail ( $r ) ]
End If
```
Instead of the raw three-line `Exit Script [ $r ]` block. Makes the pattern scannable at a glance.

### `UTIL__ValidateParams` script
Takes `{ "params": $params, "required": ["key1","key2"] }`, returns a full Response envelope. Replaces the repeated per-key `IsEmpty` validation block in every orchestrator with three lines:
```
Perform Script [ "UTIL__ValidateParams" ; Parameter: JSONSetElement ( "{}" ;
    [ "params"   ; $params                                          ; JSONObject ] ;
    [ "required" ; JSONSetElement ( "[]" ; "[+]" ; "key1" ; JSONString ) ; JSONArray ]
) ]
If [ not Response_IsOk ( Get ( ScriptResult ) ) ]
    Exit Script [ Get ( ScriptResult ) ]
End If
```

### `OnError` flush convention
`UTIL__FlushLog` is called at normal orchestrator exit. If FM throws an uncaught error mid-execution the log for that trace is never written. Convention (no new CF): the **caller** script also checks `Get(LastError) ≠ 0` after the orchestrator returns and calls `UTIL__FlushLog` directly if so. Document this in any solution that needs high-reliability audit trails.

### `UTIL__ScriptLog` viewer layout spec
Recommended layout structure for querying the log table during debugging:
- **List layout** (`UTIL__ScriptLog`): columns `RootScript`, `CreatedAt`, `TraceID`, `RowCount` — sorted by `CreatedAt` descending
- **Detail layout** or popover: renders `LogJSON` formatted (e.g. via a web viewer using `JSONFormatElements`) so individual log entries are readable
- **Quick filter**: global field to filter by `RootScript` or `TraceID`

### `$README` param schema convention
Every script using `Params.parse` should include a disabled `Insert Text` step targeting `$README` immediately after the header, documenting schema, types, and return shape. Makes the script self-describing and grepp-able without reading the full body:
```xml
<Step enable="False" id="61" name="Insert Text">
    <SelectAll state="False"/>
    <Text>PARAMS: dobavljacID (text, required) | datumFakture (date) | napomena (text)&#xD;RETURNS: data.ulaznaFakturaID (text)</Text>
    <Field>$README</Field>
</Step>
```

---

## Installation Checklist for a New Solution

- [ ] Install dependencies: `JSONMergeArrays`, `jsonToVars`
- [ ] Install existing CFs: `Response_Init`, `Response_AddError/Warning/Info`, `Response_SetData`, `Response_Finalize`
- [ ] Install new reader CFs from this library (all `Framework/Functions/Response/` files)
- [ ] Install `Params.parse` (`Framework/Functions/Params/`)
- [ ] Install `Log.add` (`Framework/Functions/Log/`)
- [ ] Create `UTIL__ScriptLog` table and layout
- [ ] Install `UTIL__FlushLog` script — wire `$$DATA_API_TOKEN` to solution's auth mechanism
- [ ] Apply `Response_Finalize` debug upgrade (see above)
