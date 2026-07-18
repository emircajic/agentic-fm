# I__ (Invoices) cluster — post-migration audit

Audited 2026-07-13 against the fresh XML export (indexes + xml_parsed regenerated
2026-07-13 09:52). References: `PhaseB_Invoices_Rollout.md` (stages),
`PhaseB_Invoices_Inventory.md` (worklist). Method: index diff + full grep of
`xml_parsed/scripts` (447 files, complete) and `xml_parsed/layouts`.

**Verdict: ~85% landed. Stages 1–5 substantially done; Stage 6 (TO amputation)
incomplete and worked around with an undocumented rename+recreate; a class of
relationship-context references was left behind and is now silently broken at
runtime.** Do not consider Stage 7 (OttoFMS live deploy) safe until the 🔴 items
are fixed.

Key structural fact driving most defects: legacy TO 1065125 was **renamed
`Invoices` → `Invoices_`** (not deleted) and **stripped of all relationships**,
and a **new TO `Invoices` (1065300)** was created over the same base table.
Because `Invoices_` is related to nothing and anchors no layout, **every
remaining `Invoices_::` field reference evaluates empty, and every GTRR through
it fails**.

---

## 🔴 Runtime breakage (fix before deploy)

1. **`ServiceOrderDetails` (186) — SO→invoice jump broken.** Two *enabled*
   buttons do `Go to Related Record [Invoices_ (1065125) ; layout Invoices (171)]`.
   With zero relationships on `Invoices_`, both fail. Plan required
   `Navigation_("invoices|…")` here.
2. **Non-fiscal print path severed.** Dispatcher 945's own doc block advertises
   `print — GTRR to RačunŠtampa in new window, Print with dialog, close`, but
   **no `print` branch exists in the body**; old `ŠtampajRačun` (490) is retired
   with no live caller; and `RačunŠtampa` (183) was **not repointed** — still
   anchored on legacy `InvoiceLines` (1065130, zero relationships) with 7
   `Invoices_::` refs, so even reached manually it prints empty header fields.
3. **`Invoices` (171) — permanently hidden objects.** Hide conditions still
   reference `Invoices_::BrojReklamiranogRacuna` (1×) and legacy
   `InvoiceLines::PrimaryKey` (4×, the x/=/− calc glyphs). Both now evaluate
   empty → condition always true → objects never show.
4. **`Mjesečni pregled` (204) — empty fields.** Two edit boxes bound to
   `Invoices_::NacinPlacanja` and `Invoices_::Mjesec` render blank.
5. **`Card Invoice Print` (239) — mixed breakage.** 8 refs to
   `Invoices_::NacinPlacanja / PrimaryKey / StatusDokumenta` (fields + hide
   calcs), and its buttons still call unmodernized 650 / 651 / 642 directly
   instead of dispatcher verbs.
6. **Layout 171 double wiring.** Mostly rebound to dispatcher 945 (7 bindings ✅),
   but two objects still bind old UI scripts directly: `Unesi datum plaćanja`
   (484 — whose enabled Set Field targets `Invoices_::`, i.e. a broken write)
   and `INV__OpenInvoicePrintOptions` (680), duplicating dispatcher
   `setPaymentDate` / `printOptions`.
7. **Live scripts still reading `Invoices_::` in enabled steps** (all reads now
   empty; GTRRs fail): `S__IncomingOrders_KnjižiIzlaz` (669 — stock posting,
   incl. GTRR), `MergePDFs` (707 — `::PDFFile` export), `UTIL__IzuzmiPDFBase64`
   (674 — `::FiskalniOdgovor`), `INV__PostStockMovements` (776 — GTRR + legacy
   `InvoiceLines`), plus leftovers 484 / 648 / 672. None of these has a
   script/layout/custom-menu caller in the export — but verify triggers, WV
   callbacks, and OData/bridge calls before declaring them dead; then retire.

## 🟠 Plan deviations (structural)

8. **Stage 6 only ⅓ done.** Deleted: `InvoicesFilter` (1065245),
   `OriginalInvoice` (1065276), `RefundInvoices` (1065277) ✅. Not deleted:
   `Invoices` (1065125 — renamed `Invoices_` instead, violating the no-rename
   model), `InvoiceLines` (1065130), `InvoiceLinks` (1065126).
9. **Undocumented new TO `Invoices` (1065300)**, wired into
   `InvoiceLinks → Invoices` and used by `ServiceOrderDetails` (7 refs). Not in
   either planning doc. Hazard: it silently absorbs any un-swapped
   `FROM "Invoices"` SQL, masking missed swaps. Document it or give it a
   cluster prefix.
10. **877 missed the FROM-swap.** `INV__ProcessInvoice` still has two SELECTs
    `FROM "Invoices"` (lines: fiscal-header read + PDF read). Today they resolve
    to TO 1065300 (same base table → correct rows), but it's an accident waiting
    for that TO to change. 878/879/881 are swapped ✅.
11. **Dev-layout swap inverted.** Plan: keep+repoint `Dev Invoices` (179),
    delete `Dev I__Invoices` (249). Actual: 179 deleted, 249 kept. End state
    equivalent for Invoices — but **`Dev InvoiceLinks` (253) was to be deleted
    and still exists**, anchored on legacy 1065126, blocking that TO's deletion.
12. **`ORD__AssignClient` (944) is dead code.** Built and modernized ✅, but zero
    callers; `Card Odabir Klijenta` (181) — which dispatcher `pickClient`
    opens — still binds old unmodernized `Postavi klijenta` (489). The re-home
    never swapped the binding.
13. **`INV__RecalculateLastInvoicesList` (649) still live**, called by 642 and
    648 (themselves probable dead leftovers). Dispatcher correctly uses
    `INV__LoadLastInvoices` (943) ✅.
14. **673 / 650 half-modernized.** Both correctly reroute through 882 → 877 ✅,
    but neither has the Response envelope required by plan items 1a/1b.
15. **`_` parallel set (831–837, 870) hard-deleted** instead of foldering to
    Retired with the 1-month clock (only 848 was retired). Irreversible but the
    set was abandoned.
16. **Renames dropped diacritics**: `INV__DodajRačun` → `INV__DodajRacun` (643),
    `ORD__ZaključajProšleFakture` → `ORD__ZakljucajProsleFakture` (663). Check
    any Perform-Script-by-name / OData / bridge callers.
17. Retired folder is `Retired/Invoices` while the planning docs said
    `_RETIRED/Invoices/` — cosmetic; docs updated to match the file.

## ✅ Confirmed done

- Layout anchors repointed: 171, 178, 172, 239, 188, 222, 204 → `I__*` (7 of 8;
  183 missed). `Invoices_` (262) + `Card Invoice Print _` (263) deleted.
- Dispatcher `I__InvoicesDispatcher` (945) built — 16 verbs (adds `addNew`,
  `recalculateInvoiceValue`; drops `print`, `refund`/`regeneratePDF` delegate to
  882), calls 479 / 643 / 882 / 943 + settings + FlushLog. Layout 171 carries 7
  dispatcher bindings + `Navigation_`.
- Fully modernized workers (Response + epSQL + `I__` TOs, no layout hops):
  943, 730, 729, 731, 643, 728, 479 (renamed from `Kalkuliši vrijednost
  fakture`, same ID ✅), 944, 663. Refund chain wired: 877 → 729/730/731 ✅.
- epSQL FROM-swap done in 878 / 879 / 881 ✅ (877 missed — item 10).
- Retirement: old fiscal pipeline (593–599, 732), migration helpers (777–779,
  853, 855), and the classified set (463, 480, 481, 871, 872) all in
  `Retired/Invoices` ✅. 482/483 classified as keepers ✅.
- `WV__GoToInvoice` (823) routes via `Navigation_` ✅. Value lists, custom
  functions, custom menus: zero legacy-TO references ✅. `Init_Invoices` (638)
  legacy refs are in **disabled** steps only (cosmetic).

## Recommended fix order

1. Repoint `RačunŠtampa` (183) → `I__InvoiceLines`, remap its `Invoices_::`
   refs → `I__INVOICES`; implement the dispatcher `print` branch (or correct
   the doc block and wire printing explicitly).
2. Replace the two GTRR buttons on `ServiceOrderDetails` (186) with
   `Navigation_("invoices|…")`.
3. Sweep residual `Invoices_::` / legacy `InvoiceLines::` refs on layouts
   171 / 204 / 239 (hide calcs + field objects) → `I__` equivalents.
4. Rebind stragglers: 171's 484→`setPaymentDate`, 680→`printOptions`; 239's
   650/651/642 → dispatcher verbs; 181's 489 → 944.
5. Finish 877's two `FROM "Invoices"` → `I__INVOICES`.
6. Trace + clean/retire 669, 707, 674, 776, 484, 648, 672, 642, 649, 489.
7. Then complete Stage 6: delete `Invoices_` (1065125), `InvoiceLines`
   (1065130; needs #1 + #6), `InvoiceLinks` (1065126; needs `Dev InvoiceLinks`
   253 deleted — note it still carries relationships incl. to new TO 1065300
   serving ServiceOrderDetails, so coordinate with the SO cluster).
8. Document or prefix the new `Invoices` TO (1065300).
9. Re-run `TEST__ProcessInvoiceHarness` (915) + smoke every dispatcher verb,
   then proceed to Stage 7.

---

## Deviation resolutions (discussed 2026-07-13)

| # | Disposition |
|---|---|
| 8, 9 | **Policy, not deviation.** Detached table-named TOs are kept as SQL catchers (`Invoices` 1065300, `InvoiceLines` 1065130, `InvoiceLinks` 1065126); `Invoices_` + `InvoiceLinks` parked for the final-phase anchor-buoy renaming. Recorded in PROJECT.md. |
| 10 | 877 swapped to `I__INVOICES` (done); under catcher policy, `FROM "Invoices"` would also have been acceptable. |
| 11 | `Dev InvoiceLinks` (253) kept for now. InvoiceLinks itself is a retirement candidate in favor of SOL↔InvoiceLines linking (no-maintenance). |
| 12 | Operational — `C__HandleClientSelect` (956) → `ORD__AssignClient` (944); 489 marked for deletion. |
| 13 | 649 retired ✅ |
| 14 | **Open work item.** 650 has zero callers → retire directly. 673 has one caller: Button id 14 (Button Bar 13 at (316,497), `generateProforma` panel, Card Invoice Print 239) — param calc already builds the 882 payload (`operation` invoice/proforma + `invoiceId`, on `I__INVOICES` ✅). Reroute that button (dispatcher verb or 882 direct), then retire 673. |
| 15 | `_` parallel set never ran in production — hard delete was safe. Closed. |
| 16 | Old diacritic names appear only in 643/663's own doc-block comments; no name-based callers anywhere. Closed. |
| 17 | Docs updated to `Retired/Invoices/`. Closed. |

Remaining open: item 14 reroute, DP__AttachInvoices (686) + DP__ResolveInvoicesFromRange (687) remap, 489 deletion, verify 877 swap on next export.
