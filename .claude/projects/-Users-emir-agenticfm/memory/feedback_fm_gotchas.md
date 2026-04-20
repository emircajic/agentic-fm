---
name: FileMaker gotchas confirmed in Autoklinika sessions
description: Bugs and surprises we hit in practice — Loop XML, portal TOs, SQL dates, JSON pipe keys
type: feedback
originSessionId: 0a7e9d44-1113-4590-93ea-bcfe659b8acb
---
## Loop XML — FlushType not Restore

`<Restore state="True"/>` on a Loop step sets Collapsed=On — scripts visually "explode" (expand all nested steps) when opened in Script Workspace.

Correct XML:
```xml
<Step enable="True" id="71" name="Loop">
  <FlushType value="Always"/>
</Step>
```

**Why:** FM's internal Loop param is FlushType, not Restore. The Restore attribute maps to a different visual state.

## Portal TO vs base layout TO

When navigating to a layout (e.g. "Dev Primke", base TO = `Primke`), all field references in Set Field and calculations must use `Primke::` — the layout's base TO. If you use a portal TO like `UFD__Primke::`, field reads go through the portal relationship. For a new parent record with no related children, the portal is empty → all fields return "" → comparisons fail silently.

**How to apply:** Always match field table prefix to the layout's base TO when doing finds/sets. Use portal TOs only when you explicitly need portal-context reads.

## ExecuteSQL date comparisons

String literals like `'2026-01-01'` are not parsed as dates in FM SQL — comparison is lexicographic and unreliable.

Use:
- `DATE '2026-01-01'` literal
- `?` parameter with a native FM Date value: `Date ( 1 ; 1 ; 2026 )`

Never use bare quoted date strings.

## ExecuteSQL GetAsDate on results

SQL date columns return values in FM's internal format for the current locale. `GetAsDate()` works when the column is a Date type. However, JS-style dates (e.g. from JSON or text fields) passed back from SQL may not parse correctly with GetAsDate — they'll silently return `?`. Always verify format before using GetAsDate on SQL output.

## JSON pipe characters in keys break JSONGetElement

If a JSON object key contains `|`, FM's JSONGetElement treats `|` as a path separator and returns wrong/empty results.

**Never use pipe characters in JSON keys.** For grouping keys, use integer-indexed arrays (`"[0].field"`) not string keys like `dobavljacID|companyID|month`.

## ExecuteSQL queries Table Occurrences, not base tables

`ExecuteSQL` references TO names (e.g. `KMP__KalkulacijaMP`), not the base table name (e.g. `KalkulacijaMP`). Using the base table name silently returns `"?"`.

**How to apply:** Always use the TO name in `FROM` clauses. Pick a TO that is accessible from the script's execution context (e.g. the layout it's on, or any TO in the same file).

## ExecuteSQL IS NOT NULL AND <> '' returns no rows

In FM SQL, combining `IS NOT NULL AND field <> ''` on a text field returns no rows even when all rows have values. Use one or the other, or remove the condition entirely if you know all rows are populated.
