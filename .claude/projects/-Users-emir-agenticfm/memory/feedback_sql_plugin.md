---
name: epSQL plugin — usage rules and gotchas
description: epSQL (draconventions) is installed on all clients and server; use it for UPDATE/DELETE and anywhere native ExecuteSQL falls short
type: feedback
originSessionId: 433c68d1-07c1-4b2e-9049-59a6215315cd
---
The plugin is **epSQL by draconventions**, installed on all client machines and the server. Treat it as always available.

## Why prefer it over native ExecuteSQL

- Supports `INSERT`, `UPDATE`, `DELETE` — not just `SELECT`
- Returns a diagnostic error string on failure instead of bare `"?"`, making errors actionable
- Better date/time and quoting handling (document specifics as encountered)

## Call signature

```
epSQLExecute ( SQL {; "Options" {; ? param; ? param; ... } } )
```

- `?` placeholders replaced left-to-right (same as native ExecuteSQL)
- Returns `""` on success, error string on failure — check with `not IsEmpty ( $result )`
- Options string: `rowSeparator`, `columnSeparator`, `waitForIdle`, `useSQLResult`, `fileName`

## epSQLResult — 0-based indexing (confirmed gotcha)

```
epSQLResult ( row ; column {; "ResultSetName" } )
```

- **Indices are 0-based** — first cell is `epSQLResult ( 0 ; 0 )`, NOT `(1 ; 1)`
- Used after `epSQLExecute` with `useSQLResult=Yes`
- Result set is overwritten by the next `epSQLExecute` call — read all values into `$variables` before issuing another query

## Record locking before UPDATE (confirmed gotcha)

When `epSQLExecute` UPDATE is called from a script triggered by `OnObjectSave` (or any trigger that fires while a record is open), the target record is locked by the current session → error 301. Fix: `Commit Records/Requests [ With dialog: OFF ]` **before** the UPDATE call.

## When to use vs native FM steps

- **Prefer epSQL UPDATE:** bulk ops, portal field sync scripts, any case that would otherwise require navigate + find + set-field + commit loop
- **Use native FM steps:** simple single-field sets where you already have context and no locking concern

**Why:** User confirmed plugin is on all machines and SQL-based updates are the preferred pattern throughout this codebase.
