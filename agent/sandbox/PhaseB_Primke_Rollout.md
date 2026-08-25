# ORD__ (IncomingOrders / Primke) cluster — migration rollout

Ordered execution plan, **dev-server + OttoFMS, repoint-in-place, no-rename**
model. Companion to `PhaseB_Primke_Inventory.md` (the *what*); this file is the
*how and in what order*. **Start: Sunday 2026-07-19.**

Carries forward the Invoices-cluster lessons: Commit before every dispatcher
delegate; sweep conditional formatting (not just hide calcs); verify
dynamic-dispatch callers before retiring; other-cluster `TO::field` reads must
be remapped **before** the relationship strip, or they silently read empty.

---

## Gates — all green before Stage 3 touches the UI, Stage 4 touches a layout

| # | Gate | Status (2026-07-15) |
|---|---|---|
| G1 | **Router routes IncomingOrders destinations** (`incomingOrders`, supplier jump, SO jump from 193). Router is live since Invoices — verify these specific routes exist. | To verify at Stage 0 |
| G2 | Dev server holds a current live copy. | Refresh before Sunday |
| G3 | Rollback: prior dev build re-deployable via OttoFMS. | Confirm before Stage 7 |
| G4 | **Dynamic-dispatch census** — WV HTML payloads, `PICKER__Callback` targets, router Init_* calls enumerated, so "zero callers" can be trusted. | ✅ Done 2026-07-19 — see Stage 0 census results |

Stages 0–2 are headless and reversible. Stages 3–7 are gated on G1 (+G4 for
Stage 5 retirements).

---

## Stage 0 — Freeze worklist + prune scaffold (Sunday, zero risk)

- [x] Re-verify inventory against a fresh export.
- [x] **Delete the 6 unused scaffold TOs** (1065233–1065238) — removes the
      `ORD_` naming drift for free. Re-export `table_occurrences.index`, confirm.
- [x] G4: dynamic-dispatch census run 2026-07-19. Full by-name dispatch map:
      `SO__PickerConfirm` (813) → `Globals::ServiceOrderSelector.callbackScript`
      (registered only by `CopyToOrder`/`CopyLineToOrder`); `PICKER__Callback`
      (794) → param targets `SO__AttachPrimke` only; router `Navigation_` (450)
      → `Init_*` by name; SO picker WV HTML (embedded in `SO__OpenSOPicker` 815)
      calls `SO__LoadSOPage` / `SO__TransferStavka` / `SO__PickerConfirm` /
      `SO__ClosePicker`; stavke-query WV → 822/824/`WV__CreateUFDFromSelection`;
      sales-dashboard WV → 850. **Verdicts:** 624/607/608 have zero static AND
      zero dynamic callers → condemned to Stage 5 (layout-106 `id="60x"` hits
      are layout-object IDs, false positives). 822/824/850/627 confirmed live.
      `CopyToOrder` (620) live (buttons 193+220 + self-registered picker
      confirm); `CopyLineToOrder` (625) PREPARE-only confirmed, its callback
      self-registration is vestigial. Side finding (UFD scope, spawned as
      separate task): UFD picker chain passes NO callbackScript end-to-end —
      791's "PICKER callback" annotation unsupported; real workhorse is 678.
- [x] G1: confirm router routes; add missing IncomingOrders destinations.
- [x] Decide `Dobavljaci` (192) portal ownership: SUPP__ TOs vs ORD path.
- [x] Confirm returns flow stays **out of scope**: layouts 195/196 + `Vrati Dio`
      (607), `Vrati dio skripta` (608), `Odaberi za povrat` (609),
      `SOL__ReturnItem` (621).

## Stage 1 — Worker modernization (headless, reversible)

Logic first, testable via script-bridge with no window open.

- [x] **1a — `ORD__AddArticle` worker** out of `Unesi Artikal` (531) + phone
      twin (644): epSQL, params, Response envelope. Built 2026-07-19
      (`sandbox/ORD__AddArticle.xml`, lint clean, on clipboard) — modes:
      create (primkaID [+kolicina]) = 531, assign (stavkaID) = 644; artikal
      lookup UPPER-matched (FQL case-sensitivity); target verified before
      artikal find-or-create (no orphan artikal). **Litmus green 2026-07-19 (9/9).**
      Census correction: `Scan Ulazna Faktura` (584) is the NAPS2 *document*
      scan (PDF → `Primke::DocumentScan`), not article entry — it stays a
      separate `scan` verb concern, untouched by this worker.
- [x] **1b — `ORD__NewItem` worker** out of `ORD__NewItem_phone` (645). Built
      2026-07-20 (`sandbox/ORD__NewItem.xml`, lint clean) — verify-then-INSERT,
      returns `data.stavkaID`; phone navigation stays dispatcher-side.
      **Litmus green 2026-07-20.**
- [x] **1c — `ORD__DeleteOrderItem` (646)** → epSQL DELETE + guards. Built
      2026-07-20 (`sandbox/ORD__DeleteOrderItem.xml`, lint clean) — replaces
      646 **in place**; guards: LINE_IN_USE (SOL), LINE_HAS_RETURNS
      (StavkePovrata), LINE_INVOICED (InvoiceLines), LINE_POSTED
      (KR__KretanjeRobe — no table-named catcher TO exists), PRIMKA_LOCKED;
      all violations reported at once. Confirm dialog stays dispatcher-side.
      **Litmus green 2026-07-20** (all five guards exercised).
- [x] **1d — price quartet (615/616/617/618)** → `ORD__SetLinePrices`. Built
      2026-07-20 (`sandbox/ORD__SetLinePrices.xml`, lint clean) — params
      mode (nabavna|prodajna) + value + valueType (total default, legacy
      popover semantics | unit) + addVAT; NO_QUANTITY guard on total÷0. Params renamed value/valueType →
      amount/basis; $vatRate uses 117/100 (locale-proof).
      **Litmus green 2026-07-20.**
- [x] **1e — `ORD__FillReceiptTemplate` (840)** → param-driven epSQL UPDATE.
      Built 2026-07-20 (`sandbox/ORD__FillReceiptTemplate.xml`, lint clean) —
      replaces 840 **in place**; contract preserved (fills only when empty,
      ALREADY_SET warning); templates keep the hardcoded year — flagged in
      README for Settings-driven templates at the next rollover.
      **Litmus green 2026-07-20** (fill, ALREADY_SET/partial_success, no-template).
- [x] **1f — `ORD__AddVATtoPrice` (926)** → folded into 1d as the `addVAT`
      param ($vatRate 1.17 hoisted in the worker). 926 retires at Stage 5.
- [x] **1g — copy-flow classification (2026-07-20, from G4 census bodies):**
      `CopyToServiceOrderLines` (624) → RETIRE (zero callers). `CopyToOrder`
      (620) → RETIRE at Stage 5 *after* Stage 3: its confirm branch (bulk-copy
      all available lines) is exactly `SO__AttachPrimke` (809) with the full
      stavkePK list — the `transferToSO` verb should route the picker's header
      path callback to 809 and drop the `Globals::ServiceOrderSelector` legacy
      state + `SO__PickerConfirm` (813) dispatch. `CopyLineToOrder` (625) →
      KEEP PREPARE-only (body verified = PROJECT.md description); its vestigial
      `callbackScript` self-registration goes away with the Stage-3 rewire.
      No replacement builds needed in Stage 1.
- [x] **Lint** each + headless test. 1a: Test_ORD__AddArticle 9/9 (2026-07-19).
      1b-1e: Test_ORD__Workers 17/18 (2026-07-20); the single miss was a test
      assertion not knowing the `partial_success` envelope status — worker
      behavior verified correct. Lessons banked in CODING_CONVENTIONS: no
      decimal literals in pasted calcs (comma-locale blanks them silently);
      duplicate-named scripts hijack by-name paste binding.
- **Exit: ✅ reached 2026-07-20** — every Stage-1 worker passes the headless litmus.

## Stage 2 — SQL target verification (headless)

Catcher convergence means most SQL already hits table-named TOs — this stage is
**verification, not swap**:

- [x] Sweep run 2026-07-20 over ALL 77 SQL-bearing scripts (not just the nine):
      every FROM/JOIN/UPDATE/INSERT/DELETE target extracted and validated
      against the current `table_occurrences.index`. All nine census scripts
      clean — targets are the catchers (`"Primke"`, `"StavkePrimke"`) or
      table-named/owning-cluster TOs (`Artikli`, `ServiceOrderLines`,
      `StavkePovrata`, `Dobavljaci`, `InvoiceLinks`, `KMP__SKMP_StavkePrimke`
      etc.). Zero references to the 6 deleted scaffold TOs anywhere.
      `I__Invoices` vs `I__INVOICES` casing is harmless (FQL identifiers are
      case-insensitive).
- [x] Stragglers: none in ORD scope. Side observation: `S__Knjiženje` (657)
      queries `FROM KretanjeRobe` (base-table name, no such TO) so its
      "already posted" guard never fires — **moot per developer 2026-07-20:
      657 is part of the dormant KR cluster and retires with it.**
- **Exit: ✅ reached 2026-07-20** — all SQL bound to catcher/base-stable names.

## Stage 3 — Dispatcher build (gated on G1)

- [x] Build **`ORD__OrdersDispatcher`** — built 2026-07-20
      (`sandbox/ORD__OrdersDispatcher.xml`, lint clean). 15 verbs:
      `init / load / scan / addArticle / newItem / deleteItem /
      priceNabavnaStart / priceNabavnaEnd / priceProdajnaStart /
      priceProdajnaEnd / addVAT / receiptTemplate / goToSupplier /
      transferToSO / transferToSOConfirm (internal)`.
      **Verb-set deltas vs inventory:** `partPickerInit / selectForReturn /
      setSpecificPart` dropped — host layout `StavkePrimkePicker` (201) was
      deleted from the file (fresh 2026-07-20 index confirms; 233/234 also
      gone) and scripts 662/543/609 have zero remaining references → straight
      to Stage 5. `transferToSOConfirm` added for the 1g picker rewire.
      Every record-bound verb takes explicit IDs with current-record fallback
      (headless-testable); trigger bindings pass `trigger=1` so the envelope
      never cancels an OnObjectSave/Validate/Keystroke event.
- [x] ~~`syncLedger` **delegates** to `S__UFLine__SyncSnapshotsToLedger` (659) —
      the ledger logic stays in the Sales cluster; dispatcher only fronts it.~~ Leave this one out: retired workflow.
      **Commit before every delegate** — done in every delegating branch.
      (658's button on 193: already absent from the fresh layout export —
      nothing to remove. The two 659 OnObjectSave triggers on the price
      fields are flagged REMOVE in the rebind spec.)
- [x] `goToSupplier` routes via `Navigation_`. The router had **no supplier
      destination** (fresh export, G1 gap) — `suppliers` route added in
      `sandbox/Navigation_.xml` (layout `SUPP__SUPPLIERS`, bare-id payload →
      Go to Record; Dobavljaci has `recid`). Same file also repairs the SaXML→
      snippet converter's dropped `Perform Script [By name]` calcs (`<Calculated>`
      form) — do not regenerate it without re-applying that fix.
- [x] **1g picker rewire:** `SO__PickerConfirm` (813) rewritten
      (`sandbox/SO__PickerConfirm.xml`) — drops the ServiceOrderSelector
      state + by-name callback dispatch; now statically calls the dispatcher's
      `transferToSOConfirm`, which rebuilds available stavkePKs fresh and
      delegates to `SO__AttachPrimke` (809). `CopyLineToOrder` (625) updated
      (`sandbox/CopyLineToOrder.xml`): vestigial `callbackScript`
      self-registration + dead selector keys dropped, **and its portal-row
      reads remapped to `ORD__OrderLines`/`ORD__OL_Stock`/`ORD__ORDERS`** —
      the legacy `StavkePrimke::` reads had no graph path from the repointed
      193 (line transfer was silently broken since the Stage-4 repoint).
      `currentWindow` key kept — `SO__ClosePicker` (817) still reads it.
- [ ] Rebind triggers + buttons on 193/220/221 with `action` params — **full
      per-object spec ready**: `sandbox/ORD__OrdersRebind-CONTROLS.md`
      (exhaustive against the fresh layout export; includes the dangling
      840 popup trigger → `receiptTemplate`, and the GTRR/`Primke::` sweep
      fixes on 220/221). Layout edits are manual (Layout Mode).
- [x] Document every verb in the `$README` doc block **at build time** — done,
      dropped verbs documented too (Invoices `print` lesson).
- [ ] **Deploy + smoke:** 5 files ready + lint clean; paste checklist in the
      rebind spec §5 (order matters — dispatcher before 813).
      Tier-2/3 auto-paste unavailable 2026-07-20: osascript has no
      Accessibility permission (native + companion both -1728) — Tier 1 it is.
      Harness `sandbox/Test_ORD__OrdersDispatcher.xml` (lint clean) asserts
      20 cases by action headlessly via the OData bridge once pasted.
- **Exit:** each action smoke-tested; harness asserts by action. Headless set
  covered by the harness; UI-only verbs have the manual checklist in the
  rebind spec §6.

## Stage 4 — Layout repoint, in place on dev (gated on G1)

Same layout, same name + ID — change the anchor TO only.

- [x] `IncomingOrders` (193) → `ORD__ORDERS`; `IncomingOrders_phone` (220) →
      `ORD__ORDERS`; `StavkePrimke` (194) + `_phone` (221) + `StavkePrimkePicker`
      (201) → `ORD__OrderLines`; `InspekcijaOtpremnica` (251) → `ORD__ORDERS`.
- [x] **API layouts** `API_UlazneFakture` (233) → `ORD__ORDERS`,
      `API_StavkeUlazneFakture` (234) → `ORD__OrderLines`; immediately smoke the
      Data API against both (field resolution + record routing). (Note: deleted, no use for it.)
- [x] Dev layouts (keep + repoint): `Dev Primke` (229) → `ORD__ORDERS`,
      `Dev StavkePrimke` (227) + `Dev Stavke Ulaznih Otpremnica` (199) →
      `ORD__OrderLines`.
- [x] `Dobavljaci` (192): apply the Stage-0 decision (SUPP__ portal or ORD path). (Will use SUPP__ cluster, since there is more than incoming orders that should be managed with suppliers.)
- [ ] Replace the enabled **GTRR → ServiceOrders** button on 193 with
      `Navigation_`. (Spec ready: rebind doc §1 button 112 — `"orders|" &`
      SOL lookup via ExecuteSQL. Do together with the Stage-3 rebind pass.)
- [ ] **Full reference sweep per layout** (Invoices lesson — four surfaces):
      field objects, hide calcs, **conditional formatting conditions**, button
      parameter calcs / sort definitions. Zero `Primke::` / `StavkePrimke::`
      refs may remain on repointed layouts.
- **Exit:** layouts open on dev, data displays, dispatcher actions run, nav via
  router, API smoke green.

## Stage 5 — Retire & delete on dev (gated on G4)

- [ ] Fold to `Retired/IncomingOrders/`: `SO__LoadAvailablePrimkas` (807),
      `SO__LoadAvailablePrimkasSQL` (856), `SO__LoadAvailablePrimkasSQL2` (857),
      `SO__AttachPrimke Copy` (925), `DB__WipeKretanjeRobePrimke` (785),
      `S__IncomingOrders_KnjižiUlaz` (658, KR workflow retirement) + whichever
      of `CopyToOrder` (620) / `CopyToServiceOrderLines` (624) / `Vrati Dio`
      (607) / `Vrati dio skripta` (608) the audits condemned + UI scripts folded
      into the dispatcher as each verb goes live:
      `ORD__UnesiPunuNabavnuCijenu_Start/End` (615/616),
      `ORD__UnesiPunuProdajnuCijenu_Start/End` (617/618),
      `ORD__GoToSupplier` (619), `ORD__NewItem_phone` (645),
      `ORD__DeleteOrderItem` (646), `ORD__phoneLayoutEnter` (647),
      `Unesi Artikal` (531), `Scan Ulazna Faktura` (584), `Scan Button` (585),
      `ORD__FillReceiptTemplate` (840), `ORD__AddVATtoPrice` (926),
      `Postavi Specifican Dio` (543), `Odaberi za povrat` (609),
      `SO__PartPickerInit` (662). Stamp the date → 1-month clock.
- [ ] `trace` each retired script → zero live callers (static **and** dynamic).
- **Exit:** worklist rows stamped; trace clean.

## Stage 6 — Octopus relationship strip (needs Stages 2 + 4 + other-cluster remaps)

**Not a deletion.** `Primke` (1065138) and `StavkePrimke` (1065139) stay as
detached SQL catchers per policy.

- [ ] **Precondition — other-cluster remap sweep** (the KnjižiIzlaz lesson):
      UFD: `UFD__AttachPrimke` (678), `UFD__SyncNabavnaCijena` (781),
      `UFD__LockPrimke` (783), `UFD__Remove` (789),
      `UFD__LoadSupplierPrimkas` (792), `UFD__OtvoriPrimku` (788);
      KMP: `KMP__GenerateStavke` (683);
      S: `S__UFLine__SyncSnapshotsToLedger` (659); SOL: `SOL__ReturnItem` (621);
      SUPP: `SUPP__Otvori Fakturu` (612); SO: `SO__PartPickerInit` (662),
      `Postavi Specifican Dio` (543) if not already dispatcher-folded. Every enabled
      `Primke::`/`StavkePrimke::` read or GTRR in live scripts must be gone.
      Verification: `grep -rl 'id="106513[89]"' xml_parsed/scripts` (excl.
      Retired) returns **empty**.
- [ ] Same grep over layouts returns only the catchers' zero-layout state.
- [ ] Strip the octopus relationships (list in inventory §1). For
      `UF__KretanjeRobe→StavkePrimke` (cascade-delete!) and
      `UF_Stavke_InvoiceLines`: confirm owning-cluster sign-off before touching.
- [ ] Re-export `relationships.index` → `Primke`/`StavkePrimke` appear in zero rows.
- **Exit:** index clean; dev smoke still green; catchers verified by running one
  epSQL SELECT against each.

## Stage 7 — OttoFMS deploy + live verification

- [ ] Confirm G3 (prior build retained).
- [ ] OttoFMS data-migration deploy dev → live.
- [ ] **Live smoke — the business-logic gauntlet:** scan → add article →
      receipt template → price entry (both) → **ledger snapshot sync**
      (`S__UFLine__SyncSnapshotsToLedger` 659, rows verified) → SO part transfer via picker → UFD attach round-trip →
      WV bridges (`StavkePrimkeQuery`, GoToPrimka) → **Data API on 233/234** →
      `Init_IncomingOrders` clean.
- [ ] Short soak. Rollback = redeploy the prior dev build.
- **Exit:** live green; cluster Phase-B/C-done except the retirement soak.

## Post-soak → C-phase

- [ ] After the 1-month clock: delete `Retired/IncomingOrders/` scripts,
      re-tracing each (static + dynamic) first.

---

## Dependency spine

```
G1 router verify ──┐        G4 dynamic census ──┐
                   ▼                            ▼
Stage 0 ─ Stage 1 ─ Stage 2 ─ Stage 3 ─ Stage 4 ─ Stage 5 ─┐
                        │                  │                ▼
                        └────────┬─────────┘            Stage 6 ─ Stage 7 ─ (soak)
                    (S2 + S4 + other-cluster remaps gate S6)
```

## Timing — first-pass sizing (start Sunday 2026-07-19)

| Stage | Scope | Rough effort | Risk | Slot |
|---|---|---|---|---|
| 0 | Freeze + prune TOs + G1/G4 census | ~0.5 session | none | Sun |
| 1 | ~7 workers + copy-flow classification | ~2–3 sessions | med (logic) | TBD |
| 2 | SQL verification pass | ~0.5 session | low | TBD |
| 3 | Dispatcher (~19 verbs) + rebind 4 layouts | ~2 sessions | med-high (UI wiring, phone) | TBD |
| 4 | Repoint 8 + 3 dev layouts + sweeps + API smoke | ~1–1.5 sessions | med (**API surface**) | TBD |
| 5 | Retire ~20 scripts | ~0.5 session | low (G4-gated) | TBD |
| 6 | Relationship strip + other-cluster sweep | ~1 session | **med-high (6 clusters touch these tables)** | TBD |
| 7 | OttoFMS deploy + business-logic gauntlet + soak | ~0.5 session + soak | **live** | TBD |
