# Phase B — Invoices cluster: generated scripts

Deliverables for the script portion of `agent/sandbox/PhaseB_Invoices_Inventory.md`.
All files are fmxmlsnippet XML, linted (Tier 1, ALL PASSED). Install via
`python3 agent/scripts/clipboard.py write agent/sandbox/PhaseB/<file>.xml`, then
paste into Script Workspace (⌘A, ⌘V inside the target script).

> **Gate reminder:** the worklist is BLOCKED on the cross-cluster navigation
> router for *layout repointing*. The workers below are safe to install and
> test any time (they are headless); the **dispatcher** and **WV__GoToInvoice**
> assume the `Invoices` layout (171) is repointed to `I__INVOICES` and the
> router routes `invoices` destinations.

## Install order

New scripts must exist before scripts that reference them by name are pasted
(FM resolves `<Script id="0" name="…"/>` by name on paste).

| # | File | Target script | New/Replace | Depends on |
|---|------|---------------|-------------|------------|
| 1 | [INV__LoadLastInvoices.xml](INV__LoadLastInvoices.xml) | **NEW** — create empty script `INV__LoadLastInvoices` first | new worker (from 649) | — |
| 2 | [INV__ValidateRefundEligibility.xml](INV__ValidateRefundEligibility.xml) | 729 | replace body | — |
| 3 | [INV__CreateRefundHeader.xml](INV__CreateRefundHeader.xml) | 730 | replace body | — |
| 4 | [INVL__GenerateRefundLinesForFiscalPayload.xml](INVL__GenerateRefundLinesForFiscalPayload.xml) | 731 | replace body | — |
| 5 | [INV__CalcInvoiceValue.xml](INV__CalcInvoiceValue.xml) | **NEW** — rename of `Kalkuliši vrijednost fakture` (479) or fresh script | new worker | — |
| 6 | [INV__DodajRacun.xml](INV__DodajRacun.xml) | 643 `INV__DodajRačun` | replace body | — |
| 7 | [INV__FillStatusDokumentaField.xml](INV__FillStatusDokumentaField.xml) | 728 | replace body (one-shot; supports `dryRun`) | — |
| 8 | [ORD__AssignClient.xml](ORD__AssignClient.xml) | **NEW** — re-home of `Postavi klijenta` (489) | new worker | — |
| 9 | [ORD__ZakljucajProsleFakture.xml](ORD__ZakljucajProsleFakture.xml) | 663 `ORD__ZaključajProšleFakture` | replace body | — |
| 10 | [INV__BuildFiscalPayload.xml](INV__BuildFiscalPayload.xml) | 878 | replace body (FROM-swap only) | — |
| 11 | [INV__BuildReprintPayload.xml](INV__BuildReprintPayload.xml) | 879 | replace body (FROM-swap only) | — |
| 12 | [INV__PersistFiscalResult.xml](INV__PersistFiscalResult.xml) | 881 | replace body (FROM-swap only) | — |
| 13 | [I__InvoicesDispatcher.xml](I__InvoicesDispatcher.xml) | **NEW** — create empty script `I__InvoicesDispatcher` first | new switchboard | #1 (INV__LoadLastInvoices) |
| 14 | [INV__NapraviRacunIliPredracun.xml](INV__NapraviRacunIliPredracun.xml) | 673 | replace body | #13 (dispatcher) |
| 15 | [WV__GoToInvoice.xml](WV__GoToInvoice.xml) | 823 | replace body | Navigation_ router routes `invoices` |
| 16 | [SO__CreateSingleInvoice.xml](SO__CreateSingleInvoice.xml) | 630 | replace body (headless epSQL worker) | #5 (INV__CalcInvoiceValue) |
| 17 | [SO__CreateInvoicesFromOrder.xml](SO__CreateInvoicesFromOrder.xml) | **NEW** — create empty script first | headless orchestrator (data half of 631) | #16 |
| 18 | [SO__NapraviNoviInvoice.xml](SO__NapraviNoviInvoice.xml) | 631 | replace body (thin UI shim) | #17, Navigation_ router |

## Testing notes per script

- **INV__LoadLastInvoices** — headless. Test from Script Workspace with
  `{"tip":"Račun","companyId":"<Company PK>"}`; expect `data.list` (rows
  `BrojFakture⇥dd.mm.yyyy`) and `data.count`.
- **INV__ValidateRefundEligibility / INV__CreateRefundHeader /
  INVL__GenerateRefundLines…** — the refund chain. Run in order with a
  fiscalized test Račun; CreateRefundHeader returns `data.refundInvoiceID`,
  feed it to GenerateRefundLines. PKs are generated with `TSID` (auto-enter is
  "do not replace", so explicit INSERT PKs are safe). After these pass,
  `INV__CreateRefundHeader` is off `Dev Invoices` → Dev layouts become deletable.
- **FROM-swaps (878/879/881)** — behavior-identical; only `FROM "Invoices"` →
  `I__INVOICES` and `FROM "InvoiceLines"` → `I__InvoiceLines`. `Company`/`Clients`
  TOs are intentionally untouched (not in the amputation list). Re-run
  `TEST__ProcessInvoiceHarness` (915) after pasting — it must still pass.
- **I__InvoicesDispatcher** — needs the repointed layout. Smoke by action:
  `init`, `load`, `filter` (+`tip`), `toggleType`, `togglePayment`,
  `changeCompany`, `recalcList`, `regeneratePDF`, `refund`, `print`,
  `printOptions`, `pickClient`, `setPaymentDate`, `removeProforma`,
  `proformaPopover`. Then rebind layout buttons/triggers to it with
  `JSONSetElement ( "{}" ; "action" ; "<verb>" ; JSONString )`.
- **INV__FillStatusDokumentaField** — run once with `{"dryRun":1}` and check
  counts before the real run. Improvement vs 728: `Reklamacija` rows are excluded.
- **ORD__AssignClient** — ⚠️ the sanitized 489 body wrote
  `Invoices::ForeignKeyClientID`, but the worklist note says "writes order, not
  invoice". The worker supports both via `target` = `"invoice"` (default) or
  `"order"`. **Audit the live 489 body** and set the picker callback's `target`
  accordingly. The picker's `Close Window` moves to the caller.
- **ORD__ZaključajProšleFakture** — `{"cutoffDate":""}` defaults to 1.1.2026;
  idempotent. Note it sets `Primke.Locked = 1` (kept from the original body);
  the buying-price lock elsewhere uses `Primke.Status = "Knjižena"` — do not
  conflate.

- **SO__NapraviNoviInvoice chain (631 → SO__CreateInvoicesFromOrder → 630)** —
  same three-way split as the fiscal stack: dialog + navigation in the shim,
  data assembly in the orchestrator, INSERTs in the worker.
  - Parity: the old `Constrain Found Set [omit LineStatus_Calculation = "Returned"]`
    is reproduced by netting `Qty − SUM(StavkePovrata.Kolicina)` per line in SQL
    and skipping rows ≤ 0 (`LineStatus_Calculation`/`QtyInstalled_Calculation` are
    unstored — not queryable directly).
  - Changes: PKs via `TSID`; `Kalkuliši vrijednost fakture` call replaced by
    `INV__CalcInvoiceValue`; the worker's final GTRR replaced by
    `Navigation_ ( "invoices|id" )` in the shim (lands on the last created
    invoice); writes go through `I__INVOICES` / `I__InvoiceLines` / `I__InvoiceLinks`.
  - Test: order with Roba+Usluga lines → SPLIT should produce 2 invoices
    (DOO materijal, OD usluge); an order with a fully-returned line should skip
    it (`data.skippedReturned`); ALL_DOO / ALL_OD produce 1 invoice each.
  - Note: 630 also used `Dev Invoices` — this replacement removes another
    blocker for deleting the Dev layouts (the worklist only gated on 730).

## Retired into the dispatcher (do NOT regenerate — rebind buttons, then fold to `_RETIRED/Invoices/`)

| Old script | ID | Dispatcher action |
|---|---|---|
| INV__RegeneratePDF | 650 | `regeneratePDF` |
| INV__RecalculateLastInvoicesList | 649 | `recalcList` (worker: INV__LoadLastInvoices) |
| INV__ToggleInvoiceType | 648 | `toggleType` |
| INV__TogglePaymentType | 672 | `togglePayment` |
| INV__ChangeCompany | 639 | `changeCompany` |
| INV__OpenInvoicePrintOptions | 680 | `printOptions` |
| INV__RemoveProforma | 651 | `removeProforma` |
| Filtriraj Dokumente | 505 | `filter` |
| PredracuniPopoverScript | 642 | `proformaPopover` |
| Odaberi klijenta dugme | 488 | `pickClient` |
| Unesi datum plaćanja | 484 | `setPaymentDate` |
| ŠtampajRačun | 490 | `print` |

## Intentionally not generated

- **INV__PostStockMovements (776)** — the worklist says "confirm framework/epSQL",
  but 881 records the decision that stock movements are part of the **abandoned
  KR__ approach** ("intentionally NOT triggered … out of scope for
  fiscalization") and KR__ dies in C.9. Recommendation: fold 776 to
  `_RETIRED/Invoices/` with the KR__ cluster instead of modernizing. If you
  want it modernized anyway, say so and I'll generate it.
- The `_` parallel set, old fiscal pieces, and Phase A migration helpers —
  removal/foldering tasks, not script generation.
- Layout repoints, TO amputation, OttoFMS deploy — manual FM operations per
  the worklist.

## Layout-object dependencies the dispatcher expects

- Object names on the Invoices layout: `lastInvoicesList`, `showInvoice`,
  `showProforma`, `generateProforma` (same names the old scripts used).
- Layouts: `Card Invoice Print` (239), `Card Odabir Klijenta` (181),
  `RačunŠtampa` (183 — must repoint to `I__InvoiceLines`).
- Settings keys: `invoices.currentType`, `invoices.currentCompany`
  (via SETTINGS__SetValue 757 / SETTINGS__EnsureLoaded 758 / `Settings_Get`).
