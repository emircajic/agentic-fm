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

## Named result sets — the correct pattern for multi-SELECT loops

When a loop body needs to issue a second `epSQLExecute` SELECT (e.g. fetching per-row detail), use a **named result set** for the outer query so the buffer isn't overwritten:

```
// Outer SELECT — stored under a named key
epSQLExecute ( "SELECT ..." ; "useSQLResult=stavke" ; $param )

// Row count — loop termination
$rowCount = epSQLResultRowCount ( "stavke" )   // 0 rows → loop never runs

// Loop: $i from 0 to $rowCount - 1
epSQLResult ( $i ; 0 ; "stavke" )   // read from named set
epSQLResult ( $i ; 1 ; "stavke" )

// Inner SELECT — uses default unnamed buffer, does NOT touch "stavke"
epSQLExecute ( "SELECT ..." ; "useSQLResult=Yes" ; $innerParam )
epSQLResult ( 0 ; 0 )   // default buffer

// Cleanup after loop
epSQLResultDelete ( "stavke" )
```

**Never** use `IsEmpty ( epSQLResult ( $i ; 0 ) )` as a loop exit condition — it is unreliable and can cause infinite loops. Always use `epSQLResultRowCount` for the termination check.

## SELECT column count — silent failure above ~3 columns with JOIN (confirmed gotcha)

A SELECT with an `INNER JOIN` that returns more than ~3 columns can silently return an empty result — `epSQLExecute` returns `""` (looks like success) but `epSQLResultRowCount` is 0 and all `epSQLResult` calls return `""`. No error is surfaced.

**Rule:** Keep JOINed SELECTs to **≤ 3 columns**. If you need more values, split into two separate SELECTs (the named result set pattern above handles the buffer safely).

Simple single-table SELECTs are not affected.

## Record locking before UPDATE (confirmed gotcha)

When `epSQLExecute` UPDATE is called from a script triggered by `OnObjectSave` (or any trigger that fires while a record is open), the target record is locked by the current session → error 301. Fix: `Commit Records/Requests [ With dialog: OFF ]` **before** the UPDATE call.

## When to use vs native FM steps

- **Prefer epSQL UPDATE:** bulk ops, portal field sync scripts, any case that would otherwise require navigate + find + set-field + commit loop
- **Use native FM steps:** simple single-field sets where you already have context and no locking concern

**Why:** User confirmed plugin is on all machines and SQL-based updates are the preferred pattern throughout this codebase.

---

## Quoting table/field names

Always double-quote table occurrence names and field names in SQL: `SELECT "MyTable"."MyField" FROM "MyTable"`. Mandatory when names contain spaces or match FM keywords (e.g. `"Date"`). Field double-quotes come after the alias: `alias."My Field"`.

Most field and table names in this solution are SQL-safe — use them as plain strings in queries. Only quote identifiers that contain spaces or collide with SQL reserved words. Use `epSQLQuote` for values, not for identifiers. Avoid `epFMNameID` in SQL strings — it obscures queries and is hard to debug.

**Why:** SQL silently breaks if a table/field name is renamed and bare strings were used.

**How to apply:** Use double-quoted names always; use epFMNameID when IDs are available.

---

## Quoting values (INSERT/UPDATE)

Always use `epSQLQuote(value)` instead of manually quoting values. It handles the correct syntax per data type and FileMaker version automatically:
- Text: wraps in single quotes, doubles internal single quotes
- Number: no quotes
- Empty string: returns `NULL`
- Date/Time/Timestamp: version-appropriate CAST syntax

Use typed variants when coercion is needed:
- `epSQLQuote(GetAsText(field))` — force Number field → Text column
- `epSQLQuote(GetAsNumber(field))` — force Text field → Number column
- `epSQLQuoteDate`, `epSQLQuoteTime`, `epSQLQuoteTimestamp` for explicit type forcing

**Why:** Manual quoting breaks on special characters, type mismatches, and FileMaker version differences.

**How to apply:** Never manually single-quote values in INSERT/UPDATE — always delegate to epSQLQuote.

## Date values in WHERE clauses — use epSQLQuoteDate, not ? params

When filtering by date in a WHERE clause, **do not pass FM Date values as `?` parameters** — epSQL does not reliably coerce them. Instead, inline the date using `epSQLQuoteDate()` directly in the SQL string:

```
// ✅ Correct
epSQLExecute (
    "SELECT ... WHERE MyTable.Datum >= " & epSQLQuoteDate ( $datumOd ) &
    " AND MyTable.Datum <= " & epSQLQuoteDate ( $datumDo ) &
    " AND MyTable.Name LIKE ?" ;
    "useSQLResult=rs" ;
    $nameParam   // text params still use ?
)

// ❌ Wrong — date ? params silently fail or miscompare
epSQLExecute ( "SELECT ... WHERE Datum >= ? AND Datum <= ?" ; "" ; $datumOd ; $datumDo )
```

`epSQLQuoteDate ( date )` handles FM-version-appropriate CAST syntax automatically. It accepts FM Date values or date strings. Returns `NULL` for empty input — guard against that if the date is required.

**How to convert an ISO string (YYYY-MM-DD) from a web viewer/JSON to an FM Date before quoting:**
```
$date = Date (
    GetAsNumber ( Middle ( $isoStr ; 6 ; 2 ) ) ;  // month
    GetAsNumber ( Right  ( $isoStr ; 2 ) ) ;       // day
    GetAsNumber ( Left   ( $isoStr ; 4 ) )         // year
)
// then: epSQLQuoteDate ( $date )
```

---

## Smart quotes

SQL statements will silently fail if smart (curly) quotes appear instead of straight quotes around table/field names. Disable smart quotes in File > File Options > Text tab, or use `ReplaceSmartQuotes()` custom function.

**Why:** FM's autocorrect can substitute `"` with `"` or `"`, which SQL does not recognize.

**How to apply:** Confirm smart quotes are disabled when writing SQL with inline string literals.

---

## epFMNameID — name/ID translation

`epFMNameID( nameOrID ; type {; fileName} {; layoutName} )` — given a name returns its numeric ID, given an ID returns its name. Types: `"T"` Table, `"L"` Layout, `"F"` Field, `"S"` Script, `"V"` ValueList.

**Why use it:** FM object IDs never change even after renaming, duplicating, or format-converting the file. Using IDs instead of string names means renames never break SQL queries or plugin calls like `epScriptQueue`.

**Key gotchas:**
- Fields require a `layoutName` parameter — without it, the current layout is used and calls can break if the layout changes. Pass a stable layout ID: `epFMNameID("6"; "F"; ""; epFMNameID("3"; "L"))`.
- For fields in FM10+, prefer native `GetFieldName(Table::Field)` — it doesn't need a layout context.
- IDs are unique per type only — a script and a field can share the same numeric ID, so always pass the type parameter.
- Tip: append the ID to the script/object name (e.g. `My Script (37)`) so you don't have to look it up repeatedly.

**How to apply:** In SQL queries and plugin calls that reference FM object names by string, wrap with `epFMNameID` using the object's numeric ID to make the reference rename-safe.
