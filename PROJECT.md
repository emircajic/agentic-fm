# PROJECT.md — Autoklinika / agentic-fm

Cross-session journal. Updated by Claude Code as decisions are made, tasks completed, or agreements reached. Read automatically at every session start.

---

## Active tasks

- [ ] Database reorganization — in progress (details TBD as sessions continue)

---

## Architecture decisions

### Response envelope — mandatory for all scripts

Every script uses the response envelope pattern. No exceptions.

```
Params.parse ( Get ( ScriptParameter ) ; "param1|param2|..." )
Response_Init ( "{}" )
Log.add ( "info" ; "SCRIPT_START" ; ... ; $params )
# ... work ...
Response_SetData ( ... )
If [ $isRoot ]
  Perform Script [ "UTIL__FlushLog" ; JSONSetElement ( "{}" ; "traceID" ; $traceID ; JSONString ) ]
End If
Exit Script [ Response_Finalize ]
```

Key CFs: `Params.parse`, `Response_Init`, `Response_AddError`, `Response_AddWarning`,
`Response_HasErrors`, `Response_SetData`, `Response_Absorb`, `Response_Finalize`

Logging: `Log.add` accumulates to `$~LOG` (zero I/O). `UTIL__FlushLog` (id 780) writes on root exit only. Always gate on `$isRoot`.

### Buying/selling price lock strategy

- Buying price locked via `Primke.Status = "Knjižena"` (Option B — derived from parent UFD status, no bitmask)
- Selling price locked via `StavkePrimke.Locked = 1` after fiscalization

### SQL conventions

- Date params: use `Date(1;1;2026)` or `DATE '2026-01-01'` — never bare quoted string literals
- `IS NOT NULL AND field <> ''` returns no rows in FM SQL — use one condition or neither
- JSON keys must never contain `|` — FM treats it as a path separator in `JSONGetElement`
- SQL date columns: use `GetAsDate()` only on native FM Date columns, not on text/JSON dates

### Portal TO vs layout base TO

Always use the layout's base TO for field references in Set Field / finds. Portal TOs (e.g. `UFD__Primke::`) only work when in portal context — on the base layout they return empty for unlinked records.

### Loop XML

Correct Loop XML uses `<FlushType value="Always"/>`, not `<Restore state="True"/>`. The Restore attribute maps to a different visual state (collapsed/expanded) and "explodes" the script in Script Workspace.

---

## UFD (UlaznaFakturaDobavljaca) workflow

Groups Primke (incoming goods receipts) by supplier + month into invoice headers for bookkeeping.

### Scripts built

| Script | ID | Purpose |
|---|---|---|
| UFD__Create | 677 | Create UFD header record |
| UFD__AttachPrimke | 678 | Attach Primke to UFD, set Status="Priložena" |
| UFD__Remove | 789 | Release all Primke (clear FK + reset Status="Otvorena"), delete UFD |
| UFD__SyncNabavnaCijena | 781 | Sync buying price from UFD to StavkePrimke |
| UFD__ValidatePrices | 782 | Pure function — validate price consistency across Primke |
| UFD__LockPrimke | 783 | Set Primke.Status="Knjižena" (buying price lock) |
| UFD__Process | 784 | Orchestrator — validate → KMP → lock → close UFD |
| UFD__Backfill | 787 | One-shot retroactive grouping of unattached Primke |

### Layouts

| Layout | ID | Base TO |
|---|---|---|
| UFD__UlaznaFakturaDobavljaca | 240 | UFD__UlaznaFakturaDobavljaca (1065262) |
| Dev Primke | 229 | Primke (1065138) — use `Primke::` here, NOT `UFD__Primke::` |
| Dev StavkePrimke | 227 | StavkePrimke |

Portal TO `UFD__Primke` (1065267) is only valid in the UFD→Primke portal. Using it on Dev Primke causes silent empty reads for unlinked records.

### Backfill design

Groups by dobavljacID + companyID + yearMonth using SQL ORDER BY + last-seen boundary detection. SQL date params must use `Date(1;1;2026)` not string literals.

### Pre-2026 stock cleanup

Ran `DB__ConsumePreYearStock` (id 786) — created a dummy ServiceOrder dated 2025-12-31 17:00-18:00 with number "ZATVARANJE-ZALIHA-2025" that consumed all available pre-2026 StavkePrimke stock via existing KretanjeRobe IZLAZ flow. Confirmed working.

---

## Session log

| Date | Decision / outcome |
|---|---|
| 2026-04-15 | PROJECT.md created, unignored, and pushed to repo for cross-session/cross-workspace sync |
