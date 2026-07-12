# I__ (Invoices) cluster — migration rollout

Ordered execution plan for the Invoices cluster, under the **dev-server +
OttoFMS, repoint-in-place, no-rename** model. Companion to the inventory
(`PhaseB_Invoices_Inventory.md` — the *what*: done / todo / remove by ID). This
file is the *how and in what order*. Timing (calendar slots) is left open at the
bottom — to be set together.

Reconciled against current indexes 2026-06-23. State source of truth:
`scripts.index` / `table_occurrences.index` / `layouts.index`.

---

## Gates — all green before Stage 3 touches the UI, Stage 4 touches a layout

| # | Gate | Status (2026-06-23) |
|---|---|---|
| G1 | **Navigation router deployed to dev**, routing `invoices` (and the payload form). Repoint replaces cross-cluster GTRR with `Navigation_` — the layout can't move onto an `I__` TO until the router carries its traffic. | ✅ **MET (2026-06-23)** — router deployed sufficiently for Invoices; `invoices` route live. Stages 4–7 unblocked. |
| G2 | **Dev server holds a current live copy** (post-Phase-A TSID data). | Assumed current; refresh from live if drifted before starting. |
| G3 | **Rollback path**: prior dev build re-deployable via OttoFMS (current data re-migrated). | Model-level; confirm the previous build is retained before Stage 7. |

Stages 0–2 are **headless and reversible** — they can proceed before G1 (no
layout or UI touched). Stages 3–7 are **gated on G1**.

---

## Stage 0 — Freeze the worklist (planning, zero risk)

- [ ] Re-verify the inventory against dev (indexes may be newer than 06-20).
- [ ] Confirm the 7 "done" (877–882, 915), the TODO worker set, the remove set.
- [ ] Confirm the WV toolbar is **out of scope** for this pass (separate,
      router-gated workstream — it rides Stage 4 layouts *later*, not now).

## Stage 1 — Worker modernization (headless, reversible, no UI impact)

Do the logic first: workers are the risk and they're testable in isolation via
`TEST__ProcessInvoiceHarness` / the script bridge, with no window open.

- [ ] **1a — Create path: `INV__NapraviRacunIliPredracun` (673)** → repoint from
      old `Process Invoice` (593) to `INV__ProcessInvoice` (877); modernize to
      framework + epSQL + Response. *Unblocks retiring the whole old pipeline.*
- [ ] **1b — `INV__RegeneratePDF` (650)** → route to 877, take `invoiceId` as a
      param (drop the current-record read).
- [ ] **1c — `INV__CreateRefundHeader` (730)** → epSQL INSERT + full params +
      Response envelope (drops the `Go to Layout [Dev Invoices]` + New Record
      pattern). `Dev Invoices` is *kept* as scratch (repointed in Stage 4), so
      this no longer gates any layout deletion — modernize it on its own merit.
- [ ] **1d — `INV__RecalculateLastInvoicesList` (649)** → new
      `INV__LoadLastInvoices` worker: epSQL, `companyId`+`status` params, returns
      via Response. The `Refresh Object` moves to the dispatcher (Stage 3).
- [ ] **1e — `Kalkuliši vrijednost fakture` (479)** → `INV__CalcInvoiceValue`
      worker (calc off params, not current record).
- [ ] **1f — Audit + confirm/modernize:** `INV__ValidateRefundEligibility` (729),
      `INVL__GenerateRefundLinesForFiscalPayload` (731),
      `INV__PostStockMovements` (776), `INV__DodajRačun` (643),
      `INV__FillStatusDokumentaField` (728). Modernize any still context-bound.
- [ ] **1g — Shared worker `ORD__ZaključajProšleFakture` (663)** — modernize on
      first encounter; **do not re-prefix** (re-homing rule already named it).
- [ ] **Lint** each (`python3 -m agent.fmlint`) + **headless test** via harness /
      script-bridge; assert the Response.
- **Exit:** every Stage-1 worker passes the headless litmus.

## Stage 2 — epSQL FROM-swap (headless)

- [ ] Move `FROM "Invoices"` → `FROM "I__INVOICES"` in `INV__BuildFiscalPayload`
      (878), `INV__BuildReprintPayload` (879), `INV__PersistFiscalResult` (881),
      and any Stage-1 worker reading the legacy TO via epSQL. (Any TO over the
      base table returns identical rows — behaviour-neutral.)
- [ ] Re-run the harness.
- **Exit:** harness passes with all epSQL bound to `I__INVOICES`. *This is what
  makes the legacy `Invoices` TO deletable in Stage 6.*

## Stage 3 — Dispatcher build (gated on G1)

- [ ] Build **`I__InvoicesDispatcher`** — action-routed switchboard, returns
      `Response_Finalize`, rendering centralized here. Verbs: `init / load /
      filter / toggleType / togglePayment / changeCompany / recalcList /
      regeneratePDF / print / printOptions / pickClient / setPaymentDate /
      refund / removeProforma / proformaPopover`.
- [ ] Fold the UI scripts into it: `INV__ToggleInvoiceType` (648),
      `INV__TogglePaymentType` (672), `INV__ChangeCompany` (639),
      `INV__OpenInvoicePrintOptions` (680), `INV__RemoveProforma` (651),
      `Filtriraj Dokumente` (505), `PredracuniPopoverScript` (642),
      `Unesi datum plaćanja` (484), `ŠtampajRačun` (490),
      `Odaberi klijenta dugme` (488), plus the `regeneratePDF` (→650 worker) and
      `recalcList` (→649 worker + the moved `Refresh Object`) actions.
- [ ] Rebind the Invoices layout's triggers + buttons to the dispatcher with an
      `action`. Cross-layout jumps go through `Navigation_`, not GTRR.
- **Exit:** each action smoke-tested; harness asserts the dispatcher by action.

## Stage 4 — Layout repoint, in place on dev (gated on G1)

Same layout, same name + ID — change the anchor TO only.

- [ ] `Invoices` (171) → `I__INVOICES`; `InvoiceLines` (178) → `I__InvoiceLines`;
      `InvoiceLinks` (172) → `I__InvoiceLinks`.
- [ ] Print/util: `Card Invoice Print` (239), `ŠtampaFiskalnogRačuna` (188),
      `Invoice PDF Display` (222), `Mjesečni pregled` (204) → `I__INVOICES`;
      `RačunŠtampa` (183) → `I__InvoiceLines`.
- [ ] **Scratch layouts (keep) — repoint too:** `Dev Invoices` (179) →
      `I__INVOICES`, `Dev InvoiceLines` (225) → `I__InvoiceLines`. Kept as
      experiment layouts against the new cluster; must leave the legacy TOs
      regardless (Stage 6 can't amputate a TO anything still anchors on).
- [ ] Replace any residual context-bound `Go to Layout` / GTRR on these layouts
      with `Navigation_(<destination>)` — the hard-rewire onto the router.
- [ ] Verify field references resolve through the new TO (relationship-context
      fields need a look; same-named fields remap automatically).
- **Exit:** layouts open on dev, data displays, dispatcher actions run, nav in/out
  works via the router.

## Stage 5 — Retire & delete on dev

- [ ] Fold to `_RETIRED/Invoices/` (foldering breaks no caller — FM tracks by ID):
      the `_` parallel set (831, 832, 833, 834, 835, 836, 837, 848, 870); the old
      fiscal pipeline (593, 594, 595, 596, 597, 598, 599, 732); spent migration
      helpers (777, 778, 779, 853, 855). Stamp the date → 1-month clock starts.
- [ ] Delete the abandoned parallel layouts `Invoices_` (262),
      `Card Invoice Print _` (263), plus the redundant dev layouts
      `Dev I__Invoices` (249, duplicates kept `Dev Invoices`) and
      `Dev InvoiceLinks` (253). `trace` 249/253 for zero readers first.
      **Keep** `Dev Invoices` (179) + `Dev InvoiceLines` (225) — repointed in
      Stage 4 as scratch layouts.
- [ ] `trace` the retired scripts → confirm zero live callers remain.
- **Exit:** worklist rows stamped; parallel + dev layouts gone; trace clean.

## Stage 6 — Legacy TO amputation on dev (needs Stage 2 + Stage 4)

- [ ] `trace` each legacy TO → zero readers, then delete: `Invoices` (1065125),
      `InvoiceLines` (1065130), `InvoiceLinks` (1065126), `InvoicesFilter`
      (1065245), `OriginalInvoice` (1065276), `RefundInvoices` (1065277) + the
      relationships exclusive to them.
- [ ] Leave other clusters' invoice TOs untouched (`C__`, `DP__`, `S__`, `KR__`,
      `UF_*`, `InvoiceLinesStavkaPrimke`). KR__ dies in C.9.
- [ ] Re-export `table_occurrences.index` → confirm the six names are gone.
- **Exit:** index clean; dev smoke still green.

## Stage 7 — OttoFMS deploy + live verification

- [ ] Confirm G3 (prior build retained as rollback).
- [ ] **OttoFMS data-migration deploy** dev → live (dev structure up, current
      live data migrates in — scripts ride the migration).
- [ ] **Live smoke:** round-trip (create invoice → refund), harness on live,
      fiscal print, `Init_Invoices` (638) clean, Sales Dashboard WV loads.
- [ ] Short soak. **Rollback = redeploy the prior dev build.**
- **Exit:** live green; cluster is Phase-B/C-done except the retirement soak.

## Post-soak → feeds C.9

- [ ] After the 1-month clock: delete `_RETIRED/Invoices/` scripts + the retired
      layouts, re-tracing each for zero callers first.

---

## Dependency spine (what blocks what)

```
G1 router ─────────────┐
                       ▼
Stage 0 ─ Stage 1 ─ Stage 2 ─ Stage 3 ─ Stage 4 ─ Stage 5 ─┐
                       │                   │                 ▼
                       └──────────┬────────┘             Stage 6 ─ Stage 7 ─ (soak) C.9
                          (S2 + S4 both gate S6)
```

- Stages **0–2 can run before G1** (headless, no UI).
- **1a + 1b** gate retiring the old fiscal pipeline in Stage 5.
- **Stage 2 + Stage 4** both gate Stage 6 (TO amputation) — including repointing
  the *kept* scratch layouts `Dev Invoices` / `Dev InvoiceLines` off the legacy TOs.

---

## Timing — TO BE SET TOGETHER

Effort is a first-pass estimate for sizing, not a commitment. Fill the calendar
column together.

| Stage | Scope | Rough effort | Risk | Calendar slot |
|---|---|---|---|---|
| 0 | Freeze worklist | ~0.5 session | none | TBD |
| 1 | Modernize ~7 workers + audits | **bulk of the work** — ~2–3 sessions | med (logic) | TBD |
| 2 | epSQL FROM-swap (3 scripts) | ~0.5 session | low | TBD |
| 3 | Build dispatcher + fold ~10 UI scripts + rebind | ~1–2 sessions | med (UI wiring) | TBD |
| 4 | Repoint 8 layouts on dev | ~1 session | low (dev) | TBD — **after G1** |
| 5 | Retire/fold ~22 scripts + delete 6 layouts | ~0.5 session | low | TBD |
| 6 | Amputate 6 TOs + relationships | ~0.5 session | low (trace-gated) | TBD |
| 7 | OttoFMS deploy + live smoke + soak | ~0.5 session + soak | **live** | TBD |

**Hard external dependency:** ✅ cleared — the navigation router deploy (G1) is
**met (2026-06-23)**. All seven stages are now schedulable; only the internal
dependency spine (0→1→2→3→4→5→6→7) constrains ordering.
