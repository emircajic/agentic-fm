# Phase B/C worklist — I__ (Invoices) cluster

Living worklist + audit trail for the Invoices cluster modernization, under the
**dev-server + OttoFMS, repoint-in-place, no-rename** model. "Done" is checkable
against this file. Source of truth for state is `scripts.index` /
`table_occurrences.index` / `layouts.index` (regenerated 2026-06-20); the
`scripts_sanitized/` export is partial (131 of 441) and stale in places
(scripts `873`/`475` no longer exist).

> **BLOCKED until the cross-cluster navigation router ships.** See the plan's
> "Blocking prerequisite — cross-cluster navigation router" gate and
> `agent/sandbox/Navigation_DEPLOY.md`. Repointing any layout onto an `I__` TO
> breaks GTRR-based cross-cluster jumps; `Navigation_` must already route every
> Invoices destination (`invoices`, `invoices.list`, payload form) by
> destination-string + layout number before this cluster starts. Do not begin
> repointing until that is met.

---

## Key finding — prefix ≠ modernized

In this cluster the `INV__` prefix was applied ahead of the rewrite. Reading the
bodies (650, 649, 730) shows most are still current-record / found-set / native
ExecuteSQL / Dev-layout bound. Only the `Invoices/New API 2` fiscal stack is a
true framework + epSQL + headless set (proven by `TEST__ProcessInvoiceHarness`
915 passing). Treat the prefix as intent, not status.

---

## 1. Schema / TOs

### Target TOG (built — repoint onto these)
`I__INVOICES` (1065183, anchor), `I__InvoiceLines` (1065173),
`I__InvoiceLinks` (1065175), `I__OriginalInvoice` (1065278),
`I__RefundInvoices` (1065279), `I__Clients`, `I__Company`,
`I__InvoiceLines_Stock`, and the `I__IL_SO_*` drill path. Nothing to build.

### Legacy TOs to amputate (this cluster's exclusive octopus TOs)
Only after every layout is repointed **and** every epSQL `FROM`-clause is moved
off them (see worker note below):

| Legacy TO | ID |
|---|---|
| `Invoices` | 1065125 |
| `InvoiceLines` | 1065130 |
| `InvoiceLinks` | 1065126 |
| `InvoicesFilter` | 1065245 |
| `OriginalInvoice` | 1065276 |
| `RefundInvoices` | 1065277 |

Out of scope (other clusters' own TOs over the same base tables, untouched here):
`C__Invoices`, `C__Invoices_InvoiceLines`, `DP__Invoices`, `DP__InvoiceLines`,
`S__InvoiceLines`, `S__InvoiceLines_Invoices`, `KR__INV`, `KR__IL`,
`UF_Stavke_InvoiceLines`, `InvoiceLinesStavkaPrimke`,
`KMP__UlaznaFakturaDobavljaca`, `UFD__UlaznaFakturaDobavljaca`. (KR__ dies in C.9.)

---

## 2. Layouts

### Repoint in place — same layout, same name + ID, change anchor TO only
| Layout | ID | now anchored on | → repoint to |
|---|---|---|---|
| `Invoices` | 171 | Invoices (1065125) | `I__INVOICES` |
| `InvoiceLines` | 178 | InvoiceLines (1065130) | `I__InvoiceLines` |
| `InvoiceLinks` | 172 | InvoiceLinks (1065126) | `I__InvoiceLinks` |
| `Card Invoice Print` | 239 | Invoices | `I__INVOICES` |
| `ŠtampaFiskalnogRačuna` | 188 | Invoices | `I__INVOICES` |
| `Invoice PDF Display` | 222 | Invoices | `I__INVOICES` |
| `Mjesečni pregled` | 204 | Invoices | `I__INVOICES` |
| `RačunŠtampa` | 183 | InvoiceLines | `I__InvoiceLines` |

### Keep as scratch — repoint, don't delete
Kept deliberately as experiment/scratch layouts against the new cluster. They
must come off the legacy TOs anyway (Stage 6 can't amputate a TO anything still
anchors on), so repointing is required either way.
| Layout | ID | → repoint to |
|---|---|---|
| `Dev Invoices` | 179 | `I__INVOICES` |
| `Dev InvoiceLines` | 225 | `I__InvoiceLines` |

### Remove (parallel + redundant dev)
| Layout | ID | note |
|---|---|---|
| `Invoices_` | 262 | parallel layout on `I__INVOICES` — redundant once `Invoices` (171) repoints |
| `Card Invoice Print _` | 263 | parallel print on `I__INVOICES` |
| `Dev I__Invoices` | 249 | already on `I__INVOICES` — duplicates the kept `Dev Invoices` (179) |
| `Dev InvoiceLinks` | 253 | dev scaffold, not kept |

---

## 3. Scripts

### ✅ DONE — `Invoices/New API 2` fiscal stack (framework + epSQL + headless)
| Script | ID | Tier | Note |
|---|---|---|---|
| `INV__ProcessInvoice` | 877 | orchestrator | |
| `INV__BuildFiscalPayload` | 878 | worker | epSQL `FROM "Invoices"` — **swap to `I__INVOICES`** so the legacy TO can drop |
| `INV__BuildReprintPayload` | 879 | worker | epSQL FROM-swap to do |
| `INV__CallFiscalAPI` | 880 | worker | |
| `INV__PersistFiscalResult` | 881 | worker | epSQL FROM-swap to do |
| `Process Invoice (UI)` | 882 | dispatcher | returns `Response_Finalize`; harness asserts by action |
| `TEST__ProcessInvoiceHarness` | 915 | test | proforma→generate→save-pdf→print-pdf ladder, passing |

### 🔧 TODO — modernize to the worker contract (prefix applied, body not)
| Script | ID | New home | Tier | Why / what's wrong |
|---|---|---|---|---|
| `INV__RegeneratePDF` | 650 | dispatcher `regeneratePDF` → 877 | UI→worker | wraps **old** `Process Invoice` (593); reads current record |
| `INV__RecalculateLastInvoicesList` | 649 | `INV__LoadLastInvoices` | worker | native ExecuteSQL + current-record + writes `Globals`; refresh stays in dispatcher |
| `INV__CreateRefundHeader` | 730 | keep name | worker | half-done: JSON params for some inputs, but current-record reads + `Go to Layout [Dev Invoices]` + New Record → epSQL INSERT + full params + Response envelope |
| `INV__ValidateRefundEligibility` | 729 | keep | worker | confirm framework/epSQL |
| `INVL__GenerateRefundLinesForFiscalPayload` | 731 | keep | worker | confirm framework/epSQL |
| `INV__PostStockMovements` | 776 | keep | worker | confirm framework/epSQL |
| `INV__ToggleInvoiceType` | 648 | dispatcher `toggleType` | UI | record-bound |
| `INV__TogglePaymentType` | 672 | dispatcher `togglePayment` | UI | record-bound |
| `INV__ChangeCompany` | 639 | dispatcher `changeCompany` | UI | layout/record-bound |
| `INV__OpenInvoicePrintOptions` | 680 | dispatcher `printOptions` | UI | UI |
| `INV__RemoveProforma` | 651 | dispatcher `removeProforma` | UI | UI |
| `Kalkuliši vrijednost fakture` | 479 | `INV__CalcInvoiceValue` | worker | calc-on-record |
| `Filtriraj Dokumente` | 505 | dispatcher `filter` | UI | found-set filter |
| `PredracuniPopoverScript` | 642 | dispatcher `proformaPopover` | UI | UI |
| `INV__NapraviRacunIliPredracun` | 673 | keep | worker | confirm |
| `INV__DodajRačun` | 643 | keep | worker | confirm |
| `INV__FillStatusDokumentaField` | 728 | keep | worker | confirm |
| `Odaberi klijenta dugme` | 488 | dispatcher `pickClient` | UI | picker trigger |
| `Postavi klijenta` | 489 | `ORD__AssignClient` (re-home) | worker | writes order, not invoice |
| `Unesi datum plaćanja` | 484 | dispatcher `setPaymentDate` | UI | |
| `ŠtampajRačun` | 490 | dispatcher `print` | UI | |
| `WV__GoToInvoice` | 823 | route via `Navigation_("invoices|{...}")` | UI | replace any GTRR with router |
| `ORD__ZaključajProšleFakture` | 663 | keep (shared) | worker | modernize on first encounter; do not re-prefix |

**Dispatcher to build:** `I__InvoicesDispatcher` — action-routed switchboard for
the repointed `Invoices` layout, returns `Response_Finalize`. Verb vocabulary:
`init / load / filter / toggleType / togglePayment / changeCompany / recalcList
/ regeneratePDF / print / printOptions / pickClient / setPaymentDate / refund /
removeProforma / proformaPopover`. Triggers + buttons rebind to it with an
`action`.

### 🗑️ REMOVE — superseded (fold to `Retired/Invoices/`, 1-month clock, delete in C.9)

**The entire `_` parallel set** (folder `I__INVOICES` — the abandoned approach):
| Script | ID |
|---|---|
| `Filtriraj Dokumente _` | 831 |
| `INV__ChangeCompany_` | 848 |
| `INV__OpenInvoicePrintOptions _` | 837 |
| `INV__RecalculateLastInvoicesList _` | 834 |
| `INV__RegeneratePDF _` | 836 |
| `INV__ToggleInvoiceType _` | 833 |
| `INV__TogglePaymentType _` | 835 |
| `Kalkuliši vrijednost fakture _` | 832 |
| `PredracuniPopoverScript _` | 870 |

**Old fiscal pieces superseded by New API 2:**
| Script | ID |
|---|---|
| `Process Invoice` | 593 |
| `Process Invoice Copy` | 732 |
| `Build Invoice JSON` | 594 |
| `Build Reprint JSON` | 595 |
| `Call Fiscal API` | 596 |
| `Handle Success Response` | 597 |
| `Handle Partial Success Response` | 598 |
| `Handle Error Response` | 599 |

**One-shot migration helpers (Phase A complete — retire):**
| Script | ID |
|---|---|
| `INV__BackfillFK__DryRun` | 853 |
| `INV__BackFillFKExecute` | 855 |
| `INV__BackfillReklamacije` | 777 |
| `MIGRATE__InvoiceLines_PKToUUIDv7` | 778 |
| `MIGRATE__InvoicesFromPKToUUIDv7` | 779 |

**To classify before action (audit bodies — may be old or superseded):**
`Fiskaliziraj Račun ili štampaj kopiju fiskalnog računa` (480),
`Reklamiraj Račun ili štampaj kopiju` (481), `ObradaFiskalnogOdgovora` (463),
`Izračunaj Iznos Rabata` (482) + `Copy` (871),
`Izračunaj Procenat Rabata` (483) + `Copy` (872), `INV__UpdateSettings` (641).
The `... Copy` pairs are almost certainly stale duplicates.

---

## Exit criteria (cluster Phase-B-done, then C trivial)

- [ ] Navigation router ships and routes all Invoices destinations (gate).
- [ ] Every TODO worker passes the headless litmus (harness/script-bridge).
- [ ] `I__InvoicesDispatcher` built; triggers/buttons rebound; smokes by action.
- [ ] epSQL `FROM`-clauses in 878/879/881 moved to `I__INVOICES`.
- [ ] Layouts 171/178/172/239/188/222/204/183 repointed on dev; field refs resolve.
- [ ] `_` parallel set + old fiscal pieces + migration helpers foldered to `Retired/`.
- [ ] `Invoices_` (262) + `Card Invoice Print _` (263) + `Dev I__Invoices` (249)
      + `Dev InvoiceLinks` (253) deleted on dev.
- [ ] `Dev Invoices` (179) + `Dev InvoiceLines` (225) repointed to `I__` and kept.
- [ ] Legacy TOs (table above) amputated; `table_occurrences.index` re-export clean.
- [ ] OttoFMS deploy → post-deploy smoke on live.
