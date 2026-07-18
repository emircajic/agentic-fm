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
| G4 | **Dynamic-dispatch census** — WV HTML payloads, `PICKER__Callback` targets, router Init_* calls enumerated, so "zero callers" can be trusted. | To do at Stage 0 |

Stages 0–2 are headless and reversible. Stages 3–7 are gated on G1 (+G4 for
Stage 5 retirements).

---

## Stage 0 — Freeze worklist + prune scaffold (Sunday, zero risk)

- [ ] Re-verify inventory against a fresh export.
- [ ] **Delete the 6 unused scaffold TOs** (1065233–1065238) — removes the
      `ORD_` naming drift for free. Re-export `table_occurrences.index`, confirm.
- [ ] G4: dynamic-dispatch census (WV HTML, PICKER callbacks, router Init map).
      Resolve fate of `CopyToServiceOrderLines` (624), `Vrati Dio` (607),
      `Vrati dio skripta` (608); confirm live: `WV__QueryStavkePrimke` (822),
      `WV__GoToPrimka` (824), `WV__UpdateStavkaPrimkeNabavna` (850),
      `Init_IncomingOrders` (627).
- [ ] G1: confirm router routes; add missing IncomingOrders destinations.
- [ ] Decide `Dobavljaci` (192) portal ownership: SUPP__ TOs vs ORD path.
- [ ] Confirm returns flow stays **out of scope**: layouts 195/196 + `Vrati Dio`
      (607), `Vrati dio skripta` (608), `Odaberi za povrat` (609),
      `SOL__ReturnItem` (621).

## Stage 1 — Worker modernization (headless, reversible)

Logic first, testable via script-bridge with no window open.

- [ ] **1a — `ORD__AddArticle` worker** out of `Unesi Artikal` (531) + phone
      twin (644) + `Scan Ulazna Faktura` (584): epSQL INSERT, params
      (barcode/artikal/qty), Response envelope. The scan flow is the cluster's
      front door — keep its contract identical.
- [ ] **1b — `ORD__NewItem` worker** out of `ORD__NewItem_phone` (645): epSQL
      INSERT header line, params, Response.
- [ ] **1c — `ORD__DeleteOrderItem` (646)** → epSQL DELETE + guards (no layout hop).
- [ ] **1d — price quartet `ORD__UnesiPunuNabavnuCijenu_Start/End` (615/616) +
      `ORD__UnesiPunuProdajnuCijenu_Start/End` (617/618)** → single
      `ORD__SetLinePrices` worker (mode + value params; nabavna/prodajna ×
      start/end collapse to calc-off-params), UI stays dispatcher-side.
- [ ] **1e — `ORD__FillReceiptTemplate` (840)** → param-driven epSQL UPDATE.
- [ ] **1f — `ORD__AddVATtoPrice` (926)** → fold into 1d worker or dispatcher calc.
- [ ] **1g — Audit + classify `CopyToOrder` (620) / `CopyLineToOrder` (625) /
      `CopyToServiceOrderLines` (624)** against the SQL picker path
      (`SO__TransferStavka`). Expected outcome: `CopyToOrder` (620) and
      `CopyToServiceOrderLines` (624) retire, `CopyLineToOrder` (625) stays
      PREPARE-only. Do not build replacements before checking.
- [ ] **Lint** each + headless test; assert the Response.
- **Exit:** every Stage-1 worker passes the headless litmus.

## Stage 2 — SQL target verification (headless)

Catcher convergence means most SQL already hits table-named TOs — this stage is
**verification, not swap**:

- [ ] Enumerate every epSQL/ExecuteSQL statement in cluster + other-cluster
      census scripts: `SO__LoadAvailablePrimkasSQL3` (858),
      `SO__LoadAvailablePrimkasSQL2` (857 → retiring),
      `WV__QueryStavkePrimke` (822), `WV__UpdateStavkaPrimkeNabavna` (850),
      `UFD__AttachFromPrimka` (791), `KMP__GenerateStavke` (683),
      `UFD__Remove` (789), `SO__AttachPrimke` (809),
      `ORD__ZakljucajProsleFakture` (663);
      confirm FROM/UPDATE/INSERT targets are the catchers
      (`"Primke"`, `"StavkePrimke"`) or the owning cluster's TOs — not a
      prefixed TO slated for change.
- [ ] Fix any stragglers; re-run harness.
- **Exit:** all SQL bound to catcher/base-stable names.

## Stage 3 — Dispatcher build (gated on G1)

- [ ] Build **`ORD__OrdersDispatcher`** — action-routed switchboard for
      193/220/221/201, returns `Response_Finalize`. Verb set (from inventory):
      `init / load / scan / addArticle / newItem / deleteItem /
      priceNabavnaStart / priceNabavnaEnd / priceProdajnaStart /
      priceProdajnaEnd / addVAT / receiptTemplate / goToSupplier /
      syncLedger / transferToSO / partPickerInit /
      selectForReturn / setSpecificPart`.
- [ ] `syncLedger` **delegates** to `S__UFLine__SyncSnapshotsToLedger` (659) —
      the ledger logic stays in the Sales cluster; dispatcher only fronts it.
      **Commit before every delegate.** (`S__IncomingOrders_KnjižiUlaz` 658 is
      retired with the KR workflow — its button on 193 is removed, not rebound.)
- [ ] `goToSupplier` routes via `Navigation_`, not Find + Go to Layout.
- [ ] Rebind triggers + buttons on 193/220/221/201 with `action` params.
- [ ] Document every verb in the `$README` doc block **at build time** — verbs
      listed there must exist in the body (Invoices `print` lesson).
- **Exit:** each action smoke-tested; harness asserts by action.

## Stage 4 — Layout repoint, in place on dev (gated on G1)

Same layout, same name + ID — change the anchor TO only.

- [ ] `IncomingOrders` (193) → `ORD__ORDERS`; `IncomingOrders_phone` (220) →
      `ORD__ORDERS`; `StavkePrimke` (194) + `_phone` (221) + `StavkePrimkePicker`
      (201) → `ORD__OrderLines`; `InspekcijaOtpremnica` (251) → `ORD__ORDERS`.
- [ ] **API layouts** `API_UlazneFakture` (233) → `ORD__ORDERS`,
      `API_StavkeUlazneFakture` (234) → `ORD__OrderLines`; immediately smoke the
      Data API against both (field resolution + record routing).
- [ ] Dev layouts (keep + repoint): `Dev Primke` (229) → `ORD__ORDERS`,
      `Dev StavkePrimke` (227) + `Dev Stavke Ulaznih Otpremnica` (199) →
      `ORD__OrderLines`.
- [ ] `Dobavljaci` (192): apply the Stage-0 decision (SUPP__ portal or ORD path).
- [ ] Replace the enabled **GTRR → ServiceOrders** button on 193 with
      `Navigation_`.
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
