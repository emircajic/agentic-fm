---
name: UFD Workflow Architecture
description: Architecture decisions for UlaznaFakturaDobavljaca → KMP → Ledger workflow in Autoklinika
type: project
---

Full architecture agreed and ready to build.

**Why:** Three months of unattached Primke need backfilling, and the full UFD→KMP→Ledger chain needs hardening with price locks and state machines.

**How to apply:** Use this as the specification when generating any UFD__, KMP__, or INV__ scripts touching this workflow.

---

## Domain model

```
Primke (goods receipt, per delivery)
  → StavkePrimke (line items: article, qty, NabavnaCijenaStavke, ProdajnaCijena)
    → UFD (header groups multiple Primke into one supplier invoice)
      → KMP__KalkulacijaMP (retail calculation: buying + selling price, legal doc)
        → ledger entry (zaduženje in TK)

StavkePrimke also links to:
  → ServiceOrderLines.ForeignKeyStavkaPrimkeID (part consumed on service order)
  → InvoiceLines.ForeignKeyStavkaUlazneFakture (direct FK to StavkePrimke)
```

## Two independent locks on StavkePrimke

| Field | Lock event | Lock flag | Who triggers |
|---|---|---|---|
| NabavnaCijenaStavke | UFD posted (KMP created) | Knjizeno = 1 | UFD__LockPrimke |
| ProdajnaCijena | Invoice fiscalized | Locked = 1 | INV__LockStavkePrimkeProdajna |

## State machines

**Primke.Status:** Otvorena → Priložena (UFD attached) → Knjižena (KMP posted)
**UFD.Status:** Otvorena → Knjižena (KMP posted)
**KMP.Status:** Otvorena → Knjižena (KMP__Post called)

## Price sync rule

When NabavnaCijenaStavke is set on a StavkaPrimke that belongs to a UFD:
- Find all other StavkePrimke for the same ArtikalID under the same UFD (via parent Primka.ForeignKeyUlaznaFakturaID)
- Update NabavnaCijenaStavke to match on all unlocked records
- Trigger: field exit script on the layout

## Script inventory

| Script | Type | Status |
|---|---|---|
| UFD__SyncNabavnaCijena | Effectful worker | New |
| UFD__ValidatePrices | Pure function | New |
| UFD__LockPrimke | Effectful worker | New |
| UFD__Process | Root orchestrator | New |
| UFD__Backfill | Orchestrator | New (simple: group by supplier+month, create headers, attach Primke, no dialog flow — UI handles add/remove) |
| INV__LockStavkePrimkeProdajna | Effectful worker | New |
| Handle Success Response | Effectful worker | Amend — call INV__LockStavkePrimkeProdajna after fiscal success |
| UFD__Create | Effectful worker | Amend — migrate to Response envelope |
| UFD__AttachPrimke | Effectful worker | Amend — set Primke.Status = "Priložena" on attach |

## Key relationship IDs (from relationships.index)

- InvoiceLines → StavkePrimke: TO InvoiceLinesStavkaPrimke, FK InvoiceLines.ForeignKeyStavkaUlazneFakture = StavkePrimke.PrimaryKey
- ServiceOrderLines → StavkePrimke: TO SOL__StavkePrimke, FK ServiceOrderLines.ForeignKeyStavkaPrimkeID = StavkePrimke.PrimaryKey
- StavkePrimke → ServiceOrderLines: TO UF_Stavke_ServiceOrderLines
- InvoiceLinks: joins Invoices ↔ ServiceOrders
- UFD__Primke: TO for UFD → Primke via ForeignKeyUlaznaFakturaID
- KMP__StavkePrimke: TO used by KMP__GenerateStavke to reach StavkePrimke via UFD chain
