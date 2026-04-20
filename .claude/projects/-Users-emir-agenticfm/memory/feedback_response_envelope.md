---
name: Response envelope framework
description: The script response/logging pattern used in all Autoklinika scripts — CFs, conventions, and gotchas
type: feedback
---

All scripts in this project use the Response envelope pattern. This is non-negotiable — always apply it.

## Custom Functions (response envelope)

- `Params.parse ( Get ( ScriptParameter ) ; "param1|param2|..." )` — always first line. Auto-detects JSON/pipe/KV, sets `$traceID` and `$isRoot` as side effects. Named params become `$param1`, `$param2` etc.
- `Response_Init ( "{}" )` — initialises the `$response` global
- `Response_AddError ( code ; text ; field ; context ; "" )` — adds to error array
- `Response_AddWarning ( code ; text ; field ; context ; "" )` — adds to warning array
- `Response_HasErrors ( $response )` — returns 1 if errors exist; use for fail-fast guards
- `Response_SetData ( jsonObject )` — sets `data` key on response
- `Response_Absorb ( $r )` — merges child script response warnings/errors into current response
- `Response_Finalize` — used in `Exit Script [ Response_Finalize ]` — serialises and returns envelope

## Response envelope shape

```json
{
  "status": "success|fail",
  "data": {},
  "messages": {
    "error": [ { "code": "", "text": "", "field": "", "context": {}, "script": "", "timestamp": "" } ],
    "warning": [],
    "info": []
  }
}
```

## Logging

- `Log.add ( level ; code ; message ; context )` — accumulates to `$~LOG` global, zero I/O
- `UTIL__FlushLog` (id 780) — writes batch log on root script exit only
- Pattern: always check `$isRoot` before calling FlushLog, pass `traceID`

## Script structure template

```
Allow User Abort [ OFF ]
Set Error Capture [ ON ]
Set Variable [ $void ; Params.parse ( Get ( ScriptParameter ) ; "param1|param2" ) ]
Set Variable [ $void ; Response_Init ( "{}" ) ]
Set Variable [ $void ; Log.add ( "info" ; "SCRIPT_START" ; "..." ; $params ) ]
# validate...
# work...
Set Variable [ $void ; Response_SetData ( ... ) ]
If [ $isRoot ]
  Perform Script [ "UTIL__FlushLog" ; JSONSetElement ( "{}" ; "traceID" ; $traceID ; JSONString ) ]
End If
Exit Script [ Response_Finalize ]
```

**Why:** Consistent error surface for all callers. Response_Absorb lets orchestrators collect warnings from workers without losing their own errors.

**How to apply:** Every script gets this structure. No exceptions, including one-shot backfill scripts.
