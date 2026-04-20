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

## Script inventory (built — all in agent/sandbox/)

| Script | ID | Status |
|---|---|---|
| UFD__Create | 677 | Built |
| UFD__AttachPrimke | 678 | Built — sets Primke.Status = "Priložena" on attach |
| UFD__Remove | 789 | Built — releases all Primke (clear FK + reset Status="Otvorena"), deletes UFD |
| UFD__SyncNabavnaCijena | 781 | Built |
| UFD__ValidatePrices | 782 | Built — pure function |
| UFD__LockPrimke | 783 | Built |
| UFD__Process | 784 | Built — orchestrator: validate → KMP → lock → close UFD |
| UFD__Backfill | 787 | Built — one-shot retroactive grouping of unattached Primke |

## Layouts used

- UFD__UlaznaFakturaDobavljaca (id 240) — base TO: UFD__UlaznaFakturaDobavljaca (1065262)
- Dev Primke (id 229) — base TO: Primke (1065138) ← use `Primke::` here, NOT `UFD__Primke::`
- Dev StavkePrimke (id 227)

**Why:** Portal TO `UFD__Primke` (1065267) is only accessible via the UFD→Primke portal relationship. Using it on Dev Primke layout causes empty reads for unlinked records.

## Pre-2026 stock cleanup

Ran `DB__ConsumePreYearStock` (id 786) — created a dummy ServiceOrder dated 2025-12-31 17:00-18:00 with number "ZATVARANJE-ZALIHA-2025" that consumed all available pre-2026 StavkePrimke stock via existing KretanjeRobe IZLAZ flow.

## Key relationship IDs (from relationships.index)

- InvoiceLines → StavkePrimke: TO InvoiceLinesStavkaPrimke, FK InvoiceLines.ForeignKeyStavkaUlazneFakture = StavkePrimke.PrimaryKey
- ServiceOrderLines → StavkePrimke: TO SOL__StavkePrimke, FK ServiceOrderLines.ForeignKeyStavkaPrimkeID = StavkePrimke.PrimaryKey
- StavkePrimke → ServiceOrderLines: TO UF_Stavke_ServiceOrderLines
- InvoiceLinks: joins Invoices ↔ ServiceOrders
- UFD__Primke: TO for UFD → Primke via ForeignKeyUlaznaFakturaID
- KMP__StavkePrimke: TO used by KMP__GenerateStavke to reach StavkePrimke via UFD chain
