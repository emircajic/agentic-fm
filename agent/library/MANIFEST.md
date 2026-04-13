# Library Manifest

All paths are relative to `agent/library/`. Each entry includes a description and keyword tags used to match the item against a task before reading the file.

---

## Framework — Orchestrator / Pure Function Pattern

The Framework package is the canonical script architecture for all solutions. Install it first. See `Framework/FRAMEWORK.md` for the full reference, patterns, and installation checklist.

| Path | Description | Keywords |
|---|---|---|
| `Framework/FRAMEWORK.md` | Canonical reference: architecture, CF inventory, script templates, trace ID system, log table schema, installation checklist | framework, pattern, orchestrator, pure function, architecture, response, params, logging, trace, template |

---

## Functions — Response (Builder CFs, mutate `$response`)

These CFs are already installed in Autoklinika. Listed here for cross-solution installation reference.

| Path | Description | Keywords |
|---|---|---|
| `Framework/Functions/Response/function - Response_IsOk.txt` | `Response_IsOk(response)` — returns True if status = "success" | response, isok, success, check status, reader |
| `Framework/Functions/Response/function - Response_HasErrors.txt` | `Response_HasErrors(response)` — returns True if the response contains any error messages | response, has errors, check errors, reader |
| `Framework/Functions/Response/function - Response_HasWarnings.txt` | `Response_HasWarnings(response)` — returns True if the response contains any warning messages | response, has warnings, check warnings, reader |
| `Framework/Functions/Response/function - Response_GetStatus.txt` | `Response_GetStatus(response)` — returns the status string: "success", "fail", or "partial_success" | response, get status, status string, reader |
| `Framework/Functions/Response/function - Response_GetData.txt` | `Response_GetData(response)` — returns the data payload object from the response | response, get data, data payload, reader |
| `Framework/Functions/Response/function - Response_GetErrors.txt` | `Response_GetErrors(response)` — returns the full error message array | response, get errors, error array, reader |
| `Framework/Functions/Response/function - Response_GetWarnings.txt` | `Response_GetWarnings(response)` — returns the full warning message array | response, get warnings, warning array, reader |
| `Framework/Functions/Response/function - Response_GetInfos.txt` | `Response_GetInfos(response)` — returns the full info message array | response, get infos, info array, reader |
| `Framework/Functions/Response/function - Response_GetErrorCount.txt` | `Response_GetErrorCount(response)` — returns the number of errors in the response | response, error count, count errors, reader |
| `Framework/Functions/Response/function - Response_GetWarningCount.txt` | `Response_GetWarningCount(response)` — returns the number of warnings in the response | response, warning count, count warnings, reader |
| `Framework/Functions/Response/function - Response_FirstError.txt` | `Response_FirstError(response)` — returns the human-readable text of the first error | response, first error, error message, display error, reader |
| `Framework/Functions/Response/function - Response_FirstErrorCode.txt` | `Response_FirstErrorCode(response)` — returns the machine-readable code of the first error | response, first error code, error code, branch on error, reader |
| `Framework/Functions/Response/function - Response_Absorb.txt` | `Response_Absorb(subResponse)` — merges all messages from a sub-script result into `$response` | response, absorb, merge messages, propagate errors, sub-script |

---

## Functions — Params

| Path | Description | Keywords |
|---|---|---|
| `Framework/Functions/Params/function - Params.parse.txt` | `Params.parse(raw;schema)` — auto-detects JSON/pipe/key=value, unpacks params as `$variables`, sets `$traceID` and `$isRoot` | params, parse, parameter, json, pipe, key value, trace id, unpack, variables |

---

## Functions — Log

| Path | Description | Keywords |
|---|---|---|
| `Framework/Functions/Log/function - Log.add.txt` | `Log.add(level;code;message;contextJSON)` — appends a structured entry to `$$~LOG` tagged with `$traceID`; zero I/O cost | log, logging, trace, debug, append log, script log |

---

## Scripts — UTIL

| Path | Description | Keywords |
|---|---|---|
| `Framework/Scripts/script - UTIL__FlushLog.txt` | Writes `$$~LOG` entries for the current `$traceID` to `UTIL__ScriptLog` via Data API, then purges them from `$$~LOG`; called by root orchestrators on exit | flush log, write log, data api, script log, persist log, util |
