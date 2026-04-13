# UUIDv7 Primary Key Migration Runbook

**Solution:** Autoklinika  
**Scope:** Invoices (primary), InvoiceLines (primary), all other tables (follow-on)  
**Custom functions required:** `_UUIDv7_NumToHex`, `UUIDv7`, `UUIDv7FromTimestamp` (already installed)  
**Estimated downtime window:** 1–2 hours depending on record volume  
**Execute:** Off-hours, zero connected users

---

## Pre-flight checklist

Complete every item before opening FileMaker.

- [ ] Full verified backup of the solution file(s) — confirm restore works
- [ ] Confirm zero active users (Admin Console → Connected Users)
- [ ] Note current record counts: Invoices, InvoiceLines, InvoiceLinks — for post-migration verification
- [ ] Disable any scheduled scripts that run on Invoices or InvoiceLines
- [ ] Disable any External Authentication or API integrations writing to Invoices during the window
- [ ] Verify `Invoices::PrimaryKey` auto-enter setting:  
  Open field definition → Auto-Enter tab → confirm **"Do not replace existing value"** is **checked**.  
  If unchecked, FM may overwrite your Set Field call with a fresh UUID on record commit — fix this before proceeding.
- [ ] Verify same for `InvoiceLines::PrimaryKey`

---

## Overview of changes

| Table | Operation | FK children affected |
|---|---|---|
| InvoiceLines | PK backfill in-place | None — nothing points to InvoiceLines PK |
| Invoices | PK swap via staging field | InvoiceLines::ForeignKeyInvoiceID, InvoiceLinks::ForeignKeyInvoiceID, Invoices::ForeignKeyOriginalInvoiceID (self-ref) |

InvoiceLines is done **first** — it is fully independent and serves as a low-risk warm-up.

---

## Part 1 — InvoiceLines PrimaryKey backfill

### Step 1.1 — Create the migration script

Create a new script: **MIGRATE__InvoiceLines_PKToUUIDv7**

```
Allow User Abort [ Off ]
Error Capture [ On ]

Go to Layout [ "InvoiceLines" (InvoiceLines) ]
Show All Records
Sort Records [ Restore ; No dialog ]   # optional, helps progress tracking

Set Variable [ $total ; Count ( InvoiceLines::PrimaryKey ) ]
Set Variable [ $errors ; 0 ]
Set Variable [ $i ; 1 ]

Go to Record/Request/Page [ First ]
Loop
    Set Variable [ $newPK ; UUIDv7FromTimestamp ( InvoiceLines::CreationTimestamp ) ]
    Set Field [ InvoiceLines::PrimaryKey ; $newPK ]
    
    If [ Get ( LastError ) ≠ 0 ]
        Set Variable [ $errors ; $errors + 1 ]
    End If
    
    Set Variable [ $i ; $i + 1 ]
    Go to Record/Request/Page [ Next ; Exit after last ]
End Loop

Show Custom Dialog [
    Title: "MIGRATE__InvoiceLines_PKToUUIDv7 — Done" ;
    Message: "Processed: " & $total & "¶Errors: " & $errors
]
```

### Step 1.2 — Run and verify

1. Run **MIGRATE__InvoiceLines_PKToUUIDv7**
2. Dialog must show **Errors: 0**
3. Spot-check 5–10 records: PrimaryKey should now be 36-character lowercase UUIDs starting with characters corresponding to 2020s dates (prefix `018` or higher)
4. Verify record count in InvoiceLines has not changed

---

## Part 2 — Invoices PrimaryKey migration

This is the complex part. The staging field approach means the old PK remains intact and relationships continue to function throughout Phases 2.1–2.3. Only Phase 2.4 performs the actual swap.

### Step 2.1 — Add staging field to Invoices

In FileMaker → Manage Database → Invoices table:

| Field name | Type | Options |
|---|---|---|
| `PrimaryKey_New` | Text | No auto-enter, no validation, no indexing required |

Do not add this field to any layout. It is temporary.

### Step 2.2 — Create the migration script

Create a new script: **MIGRATE__Invoices_PKToUUIDv7**

```
Allow User Abort [ Off ]
Error Capture [ On ]

#
# ─── PHASE A: Generate new UUIDs into PrimaryKey_New ────────────────────────
#

Go to Layout [ "Invoices" (Invoices) ]
Show All Records

Set Variable [ $total ; Count ( Invoices::PrimaryKey ) ]
Set Variable [ $errors ; 0 ]

Go to Record/Request/Page [ First ]
Loop
    Set Field [ Invoices::PrimaryKey_New ; UUIDv7FromTimestamp ( Invoices::CreationTimestamp ) ]
    If [ Get ( LastError ) ≠ 0 ]
        Set Variable [ $errors ; $errors + 1 ]
    End If
    Go to Record/Request/Page [ Next ; Exit after last ]
End Loop

If [ $errors > 0 ]
    Show Custom Dialog [
        Title: "MIGRATE — Phase A FAILED" ;
        Message: "Errors generating new UUIDs: " & $errors & "¶Aborting — no data has changed."
    ]
    Halt Script
End If

#
# ─── PHASE B: Update InvoiceLines::ForeignKeyInvoiceID ───────────────────────
# Set Field via relationship sets ALL related records in one step.
# Old Invoices::PrimaryKey is still active — relationship still resolves correctly.
#

Go to Record/Request/Page [ First ]
Loop
    Set Field [ InvoiceLines::ForeignKeyInvoiceID ; Invoices::PrimaryKey_New ]
    If [ Get ( LastError ) ≠ 0 ]
        Set Variable [ $errors ; $errors + 1 ]
    End If
    Go to Record/Request/Page [ Next ; Exit after last ]
End Loop

If [ $errors > 0 ]
    Show Custom Dialog [
        Title: "MIGRATE — Phase B FAILED" ;
        Message: "Errors updating InvoiceLines FKs: " & $errors & "¶Aborting.¶InvoiceLines FKs may be partially updated — restore from backup."
    ]
    Halt Script
End If

#
# ─── PHASE C: Update InvoiceLinks::ForeignKeyInvoiceID ───────────────────────
#

Go to Record/Request/Page [ First ]
Loop
    Set Field [ InvoiceLinks::ForeignKeyInvoiceID ; Invoices::PrimaryKey_New ]
    If [ Get ( LastError ) ≠ 0 ]
        Set Variable [ $errors ; $errors + 1 ]
    End If
    Go to Record/Request/Page [ Next ; Exit after last ]
End Loop

If [ $errors > 0 ]
    Show Custom Dialog [
        Title: "MIGRATE — Phase C FAILED" ;
        Message: "Errors updating InvoiceLinks FKs: " & $errors & "¶Aborting.¶InvoiceLines FKs already updated — restore from backup."
    ]
    Halt Script
End If

#
# ─── PHASE D: Update self-referential FK (ForeignKeyOriginalInvoiceID) ────────
# OriginalInvoice TO joins ForeignKeyOriginalInvoiceID = PrimaryKey.
# PrimaryKey_New is readable via OriginalInvoice::PrimaryKey_New while old PK is still active.
# Only processes records where the field is populated (refund invoices only).
#

Go to Record/Request/Page [ First ]
Loop
    If [ not IsEmpty ( Invoices::ForeignKeyOriginalInvoiceID ) ]
        Set Field [ Invoices::ForeignKeyOriginalInvoiceID ; OriginalInvoice::PrimaryKey_New ]
        If [ Get ( LastError ) ≠ 0 ]
            Set Variable [ $errors ; $errors + 1 ]
        End If
    End If
    Go to Record/Request/Page [ Next ; Exit after last ]
End Loop

If [ $errors > 0 ]
    Show Custom Dialog [
        Title: "MIGRATE — Phase D FAILED" ;
        Message: "Errors updating self-referential FKs: " & $errors & "¶Aborting — restore from backup."
    ]
    Halt Script
End If

#
# ─── PHASE E: Swap PrimaryKey = PrimaryKey_New ───────────────────────────────
# Point of no return. All FK children already point to PrimaryKey_New values.
#

Go to Record/Request/Page [ First ]
Loop
    Set Field [ Invoices::PrimaryKey ; Invoices::PrimaryKey_New ]
    If [ Get ( LastError ) ≠ 0 ]
        Set Variable [ $errors ; $errors + 1 ]
    End If
    Go to Record/Request/Page [ Next ; Exit after last ]
End Loop

If [ $errors > 0 ]
    Show Custom Dialog [
        Title: "MIGRATE — Phase E FAILED" ;
        Message: "Errors swapping PrimaryKey: " & $errors & "¶Some PKs may be swapped — restore from backup immediately."
    ]
    Halt Script
End If

#
# ─── DONE ─────────────────────────────────────────────────────────────────────
#

Show Custom Dialog [
    Title: "MIGRATE__Invoices_PKToUUIDv7 — Complete" ;
    Message: "All phases completed successfully.¶Records processed: " & $total & "¶¶Next step: delete PrimaryKey_New field from Invoices."
]
```

### Step 2.3 — Run and verify

1. Run **MIGRATE__Invoices_PKToUUIDv7**
2. All phase dialogs must be absent (script runs to completion dialog only)
3. Spot-check:
   - 5 Invoices records: `PrimaryKey` is now UUIDv7 format
   - Related InvoiceLines for those records: `ForeignKeyInvoiceID` matches the new PK
   - Related InvoiceLinks for those records: `ForeignKeyInvoiceID` matches the new PK
   - 2–3 refund invoices (where `ForeignKeyOriginalInvoiceID` was populated): value now matches the new PK of the original invoice
4. Confirm record counts for Invoices, InvoiceLines, InvoiceLinks are unchanged

### Step 2.4 — Clean up staging field

Only after verification passes:

1. Manage Database → Invoices → delete `PrimaryKey_New`
2. Confirm no script or layout references it (the field was never added to layouts, but double-check)
3. Delete the two migration scripts (**MIGRATE__InvoiceLines_PKToUUIDv7** and **MIGRATE__Invoices_PKToUUIDv7**) or move them to a `staro` folder

---

## Abort and rollback decision tree

| When failure is detected | Action |
|---|---|
| Phase A (UUID generation) | Safe to abort — nothing changed. Fix and re-run. |
| Phase B (InvoiceLines FKs) | Partial state. Restore from backup. Do not attempt repair in-place. |
| Phase C (InvoiceLinks FKs) | Partial state. Restore from backup. |
| Phase D (self-ref FKs) | Partial state. Restore from backup. |
| Phase E (PK swap) | Partial state. Restore from backup immediately. |

The script halts at the end of each phase on error — it will never silently continue into the next phase.

---

## Post-migration tasks

- [ ] Re-enable scheduled scripts
- [ ] Re-enable external integrations — verify they handle UUIDv7 format (same text format as v4, no breaking change)
- [ ] Run a brief functional smoke test: create a new Invoice, verify its PK is UUIDv7 format
- [ ] Confirm new auto-enter on `Invoices::PrimaryKey` is producing `UUIDv7()` (not `Get(UUID)`)
- [ ] Confirm same for `InvoiceLines::PrimaryKey`
- [ ] Update `fields.index` / regenerate context via `fmcontext.sh` if needed

---

## Follow-on tables

The same in-place approach used for InvoiceLines applies to all remaining tables (no other table has a FK pointing at its PrimaryKey based on current relationship graph). Priority order is arbitrary — run one table per session if preferred.

Tables confirmed to have `CreationTimestamp` and no FK dependents on their own PK:

ServiceOrders, ServiceOrderLines, Clients, Vehicles, Artikli, StavkePrimke, Primke, UlaznaFakturaDobavljaca, KalkulacijaMP, StavkeKalkulacijeMP, DnevniPolog, KretanjeRobe, and others — check `relationships.index` before each.
