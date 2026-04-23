# PROJECT.md — Autoklinika / agentic-fm

Cross-session journal. Updated by Claude Code as decisions are made, tasks completed, or agreements reached. Read automatically at every session start.

---

## Active tasks

- [x] UFD → KMP creation chain — reviewed and complete (see KMP section below)
- [ ] UFD__Process — paste final patched version into FM and verify (sandbox is up to date)
- [ ] Push fresh xml_parsed snapshot — schema changes not yet reflected in index files
- [ ] Run `Test__UFD_Flow` (id 692) and `Test__KMP_Flow` (id 693) to smoke-test the full chain

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

### Identifying relationships — shared PK pattern

Where a record cannot exist without its parent and the relationship is strictly 1:1, we use the parent's PrimaryKey as the child's PrimaryKey. No separate UUID, no FK field.

Established instances:
- `StavkeKalkulacijeMP.PrimaryKey = StavkePrimke.PrimaryKey` — a KMP line IS a StavkaPrimke seen through the KMP lens
- `KalkulacijaMP.PrimaryKey = UlaznaFakturaDobavljaca.PrimaryKey` — a KalkulacijaMP IS a UFD's calculation view

Consequences:
- Remove `auto:Get(UUID)` from the child PrimaryKey — creation script sets it explicitly
- Remove the redundant FK field (`ForeignKeyStavkaPrimkeID`, `ForeignKeyUlaznaFakturaID`) from the child
- RG relationship becomes `PrimaryKey = PrimaryKey`, self-documenting

---

## KMP (KalkulacijaMP) workflow

Retail price calculation derived from a UFD. Only created via `UFD__Process` — no standalone entry.

### Scripts

| Script | ID | Status | Purpose |
|---|---|---|---|
| KMP__CreateFromUlaznaFaktura | 679 | ✅ Rewritten | Create KalkulacijaMP header — PK = ulaznaFakturaID |
| KMP__GenerateStavke | 683 | ✅ Reviewed | Create StavkeKalkulacijeMP lines from UFD's StavkePrimke |
| KMP__Post | 684 | ✅ Rewritten | Validate, compute SUM(Kolicina*MPCijena), stamp DatumKnjizenja, set Status=Knjižena |
| KMP__RefreshTotal | 695 | not reviewed | — |
| KMP__RefreshTotals | 696 | not reviewed | — |

### KalkulacijaMP status lifecycle

`Otvorena` → (after Post) → `Knjižena`

`KMP__CreateFromUlaznaFaktura` sets Status = `"Otvorena"`.
`KMP__GenerateStavke` guards: rejects if Status ≠ `"Otvorena"`.
`KMP__Post` guards: rejects if Status ≠ `"Otvorena"`. Sets Status = `"Knjižena"` on success.

### Schema — KalkulacijaMP (table 174)

Shared PK with UFD. Fields after cleanup:
`PrimaryKey` (= UFD PK, no auto-UUID), `BrojKalkulacije` (serial/manual, always editable),
`DatumKalkulacije`, `UkupnoMP_Roba` (stored, set by Post), `Status`, `DatumKnjizenja`, `Napomena`, `ForeignKeyCompanyID`

Dropped: `ForeignKeyUlaznaFakturaID` (redundant — PK is the link)

### Schema — StavkeKalkulacijeMP (table 175)

Shared PK with StavkaPrimke. Fields after cleanup:
`PrimaryKey` (= StavkaPrimke PK, no auto-UUID), `ForeignKeyKalkulacijaID`, `Kolicina`,
`NabavnaCijena`, `MPCijena`, `IznosMP` (unstored calc: Kolicina * MPCijena)

Dropped: `ForeignKeyArtikalID`, `ForeignKeyStavkaPrimkeID`
Artikli accessible via: `KMP__SKMP_StavkePrimke (PK=PK) → KMP__SKMP_StavkePrimke_Artikli`

### Key SQL note for KMP__Post

`IznosMP` is an unstored calc — cannot be aggregated with `SUM(IznosMP)`.
Always use `SUM(Kolicina * MPCijena)` directly.

---

## PrimkaPicker system

Card window UI for attaching StavkePrimke to a UFD. Built 2026-04-15.

| Script | ID | Purpose |
|---|---|---|
| UFD__PrimkaPicker | 796 | Entry: runs LoadSupplierPrimkas on server, opens picker card |
| UFD__LoadSupplierPrimkas | 792 | PSoS: finds unattached StavkePrimke by supplier, groups by Primka, returns payload |
| PICKER__Open | 793 | Generic: opens PrimkePicker card window (layout id 254), pushes data to web viewer |
| PICKER__Callback | 794 | Generic: dispatches stavkePKs to domain callback script, closes card on success |
| PICKER__Close | 795 | Close card window |
| UFD__AttachFromPrimka | 791 | Domain callback: attaches selected stavke to UFD |
| UFD__ReleaseStavkaPrimkeFromInvoice | 797 | Detach a stavka from UFD |

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
| 2026-04-16 | KMP creation chain reviewed end-to-end. KMP__CreateFromUlaznaFaktura and KMP__Post rewritten to framework. Schema: shared PK pattern applied to both KalkulacijaMP (PK=UFD PK) and StavkeKalkulacijeMP (PK=StavkaPrimke PK), redundant FK and ArtikalID fields dropped. UFD__Process patched (data.kalkulacijaID path, error message extraction). 3 boilerplate templates added to sandbox. |
| 2026-04-18 | **KR__KretanjeRobe consumption flow not yet implemented.** `ForeignKeyStavkaUlazaID` (which StavkaPrimke was consumed) is only populated for 2 records — the tables and scripts exist but writing KretanjeRobe IZLAZ rows from ServiceOrderLines is not fully wired up. Do NOT query `KR__KretanjeRobe` to trace StavkePrimke consumed by Invoice/ServiceOrder until this is fixed. |
