# Phase B/C worklist — ORD__ (IncomingOrders / Primke) cluster

Living worklist + audit trail for the IncomingOrders cluster modernization, under
the **dev-server + OttoFMS, repoint-in-place, no-rename** model. Source of truth
for state: `scripts.index` / `table_occurrences.index` / `layouts.index`
(regenerated 2026-07-15). Script-by-script body audit run 2026-07-15 against the
full 447-file `xml_parsed/scripts` export.

> **Migration begins Sunday 2026-07-19.** Companion rollout doc:
> `PhaseB_Primke_Rollout.md`.

> ⚠️ **This cluster carries heavy business logic** (goods receipt → stock →
> ledger posting → SO part transfer → supplier invoicing feeds) and its tables
> are read by six other clusters (UFD, KMP, S, SOL, SUPP, I). The Stage-6
> relationship-strip is gated on sweeping *all* of them.

---

## Key findings

1. **Prefix ≠ modernized (again).** 14 scripts carry `ORD__` but only
   `ORD__AssignClient` (944) and `ORD__ZakljucajProsleFakture` (663) are
   framework + epSQL. The rest are record/layout-bound UI scripts.
2. **Catcher convergence — no rename dance.** The legacy octopus TOs are already
   table-named: `Primke` (1065138), `StavkePrimke` (1065139). End-state per the
   SQL-catcher policy (PROJECT.md): **strip relationships, keep detached** as
   catchers. `SO__AttachPrimke` (809) already queries `FROM "StavkePrimke"` /
   `FROM "Primke"`-style catcher names.
3. **Dynamic dispatch is load-bearing here.** The picker framework
   (`PICKER__Callback` 794) and web viewers call scripts **by name/calculation**
   — zero static callers ≠ dead. Verify before retiring anything in the
   VERIFY list below.

---

## 1. Schema / TOs

### Scaffold — KEEP (4 TOs; covers every observed layout traversal)
| TO | ID | Base table | Serves |
|---|---|---|---|
| `ORD__ORDERS` | 1065231 | Primke | anchor |
| `ORD__OrderLines` | 1065239 | StavkePrimke | header↔lines portal |
| `ORD__Suppliers` | 1065232 | Dobavljaci | supplier fields/filter |
| `ORD__OL_Stock` | 1065230 | Artikli | article lookups on lines |

### Scaffold — DELETE (6 TOs; model drills with zero current users)
| TO | ID | Why cut |
|---|---|---|
| `ORD__OL_S_ServiceOrderLines` | 1065236 | legacy SP→SOL drill (`UF_Stavke_ServiceOrderLines` 1065243) has **zero users**; part→SO runs through SQL picker (`SO__TransferStavka`) |
| `ORD__OL_S_SOL_ServiceOrders` | 1065237 | same path |
| `ORD_OL_S_SOL_StavkePrimke` | 1065238 | same path (+ single-underscore prefix) |
| `ORD_S_Returns` | 1065233 | returns are their own mini-domain: layouts 195/196 anchor table-named `PovratiDobavljacima`/`StavkePovrata`; no supplier→returns drill used anywhere (+ prefix) |
| `ORD_S_R_ReturnedItems` | 1065234 | same (+ prefix) |
| `ORD_S_R_RI_Artikli` | 1065235 | same (+ prefix) |

Deleting these also removes every `ORD_` (single underscore) naming
inconsistency. Re-add drills when (if) a layout needs them — TOs are cheap.

### Legacy octopus — end-state: detached SQL catchers (do NOT delete)
| TO | ID | Stage 6 action |
|---|---|---|
| `Primke` | 1065138 | strip all relationships, keep detached |
| `StavkePrimke` | 1065139 | strip all relationships, keep detached |

Current octopus relationships to strip: `Dobavljaci→Primke`, `Primke→StavkePrimke`,
`Artikli→StavkePrimke`, `StavkePrimke→UF__Stavke_StavkePovrata` (1065242, zero
users), `StavkePrimke→UF_Stavke_ServiceOrderLines` (1065243, zero users),
`UF__KretanjeRobe→StavkePrimke` (1065249 — **KR cluster, verify owner first**),
`UF_Stavke_InvoiceLines→StavkePrimke` (1065290 — UF cluster).

### Out of scope (other clusters' TOs over the same base tables — untouched)
`I__IL_SP_Primke`, `I__IL_StavkePrimke`, `I__IL_SO_SOL_OrderItems`,
`KMP__SKMP_StavkePrimke`, `KMP__UF_StavkePrimke`, `KR__P`, `KR__SP`,
`KR__BatchSP`, `S__OrderedItems`, `S__OrderedItems_Orders`,
`S__KretanjeRobe_StavkeUlazneFakture`, `SOL__Primke`, `SOL__StavkePrimke`,
`SUPP__Primke`, `SUPP__Primke_Stavke`, `UFD__StavkePrimke`,
`UFD__StavkePrimke_Primke`, `UF_Stavke_*`.

---

## 2. Layouts

### Repoint in place — same layout, same name + ID, change anchor TO only
| Layout | ID | now anchored on | → repoint to | Legacy refs | Note |
|---|---|---|---|---|---|
| `IncomingOrders` | 193 | Primke | `ORD__ORDERS` | 63 | heaviest; 17 script bindings; 1 enabled **GTRR → ServiceOrders** button → replace with `Navigation_` |
| `IncomingOrders_phone` | 220 | Primke | `ORD__ORDERS` | 21 | phone twin |
| `StavkePrimke` | 194 | StavkePrimke | `ORD__OrderLines` | 5 | no script bindings |
| `StavkePrimke_phone` | 221 | StavkePrimke | `ORD__OrderLines` | 8 | |
| `StavkePrimkePicker` | 201 | StavkePrimke | `ORD__OrderLines` | 5 | picker card; 3 script bindings |
| `InspekcijaOtpremnica` | 251 | Primke | `ORD__ORDERS` | 9 | |
| `API_UlazneFakture` | 233 | Primke | `ORD__ORDERS` | 5 | ⚠️ **Data API surface** — verify integration field resolution post-repoint |
| `API_StavkeUlazneFakture` | 234 | StavkePrimke | `ORD__OrderLines` | 8 | ⚠️ same |

**Post-repoint sweep on every layout (Invoices lesson):** field objects, hide
calcs, **conditional formatting conditions**, button parameter calcs, sort/portal
definitions — all four reference surfaces held stragglers last time.

### Keep as scratch — repoint, don't delete (dev-layouts policy)
| Layout | ID | → repoint to |
|---|---|---|
| `Dev Primke` | 229 | `ORD__ORDERS` |
| `Dev StavkePrimke` | 227 | `ORD__OrderLines` |
| `Dev Stavke Ulaznih Otpremnica` | 199 | `ORD__OrderLines` |

### Cross-domain — decide, don't assume
| Layout | ID | Issue |
|---|---|---|
| `Dobavljaci` | 192 | anchored on `Dobavljaci` (1065137), 8 Primke refs via the octopus `Dobavljaci→Primke` rel. Repoint its portal to `SUPP__Primke` (SUPP cluster owns it) **or** route through ORD — decide at Stage 0. |
| `PrimkePicker` | 254 | anchored on `UFD__StavkePrimke` — UFD cluster's, untouched |
| `StavkePrimkeQuery` | 259 | Globals-anchored WV host — untouched, but its WV scripts are in the census |

---

## 3. Scripts

### ✅ DONE — framework + epSQL, headless
| Script | ID | Note |
|---|---|---|
| `SO__AttachPrimke` | 809 | epSQL ×10, Response; queries catcher names already. **Live via `PICKER__Callback` dynamic dispatch** — keep |
| `SO__LoadAvailablePrimkasSQL3` | 858 | Response + epSQL; called by `SO__PrimkaPicker` (808) |
| `ORD__AssignClient` | 944 | done in Invoices pass |
| `ORD__ZakljucajProsleFakture` | 663 | done in Invoices pass; already `FROM "Primke"` |

### 🔧 TODO — ORD cluster: modernize + fold into dispatcher
Bound on `IncomingOrders` (193) unless noted. Dispatcher: **`ORD__OrdersDispatcher`**.

| Script | ID | Dispatcher verb / new home | Why / what's wrong |
|---|---|---|---|
| `ORD__UnesiPunuNabavnuCijenu_Start` | 615 | `priceNabavnaStart` | record-bound popover flow (SP ×4) |
| `ORD__UnesiPunuNabavnuCijenuEnd` | 616 | `priceNabavnaEnd` | record-bound |
| `ORD__UnesiPunuProdajnuCijenu_Start` | 617 | `priceProdajnaStart` | record-bound |
| `ORD__UnesiPunuProdajnuCijenuEnd` | 618 | `priceProdajnaEnd` | record-bound |
| `ORD__AddVATtoPrice` | 926 | `addVAT` | small calc-on-record |
| `ORD__GoToSupplier` | 619 | `goToSupplier` → `Navigation_` | Go to Layout + Find (also bound on 220) |
| `ORD__FillReceiptTemplate` | 840 | `receiptTemplate` | P ×5 field writes on current record |
| `ORD__NewItem_phone` | 645 | `newItem` (phone, layout 220) | New Record pattern → epSQL INSERT worker |
| `ORD__phoneLayoutEnter` | 647 | `init` (phone) | OnLayoutEnter |
| `ORD__DeleteOrderItem` | 646 | `deleteItem` (layout 221) | GoLay + Find → epSQL DELETE worker |
| `Unesi Artikal` | 531 | `addArticle` → worker | scan/add flow: GoLay + Find + New Record ×2 |
| `Unesi Artikal phone` | 644 | `addArticle` (phone, layout 221) | Find + New Record |
| `Scan Button` | 585 | `scan` (193 + 220) | wraps 584 |
| `Scan Ulazna Faktura` | 584 | worker under `scan` | 38 steps, current-record |
| `CopyToOrder` | 620 | **classify first** | 100 steps, GoLay ×9 — likely superseded by SO picker (`SO__TransferStavka`); bound on 193 + 220 |
| `CopyLineToOrder` | 625 | keep (PREPARE-only per 2026-04-29 rework) | verify body matches PROJECT.md description; SP ×9 refs |
| `Init_IncomingOrders` | 627 | keep — router-called | **VERIFY dynamic dispatch** (router calls Init_* by name) |
| `SO__PartPickerInit` | 662 | picker verb (layout 201) | Find on legacy TOs |
| `Postavi Specifican Dio` | 543 | picker verb (layout 201) | SP ×4, record-bound |
| `Odaberi za povrat` | 609 | picker verb (layout 201) | 1-step trigger |

**Dispatcher(s) to build:** `ORD__OrdersDispatcher` — action-routed switchboard
for 193/220 (phone shares it; `init` branches on `Get(SystemPlatform)` or layout).
Picker layout 201 verbs ride the same dispatcher (`partPickerInit`,
`selectForReturn`, `setSpecificPart`) unless it grows — then split. Include a
`generate`-style Commit before every delegate (Invoices lesson).

### 🔄 OTHER-CLUSTER — remap off the octopus before Stage 6 strip (not ORD work, but ORD-gating)
| Script | ID | Cluster | Legacy refs | Action |
|---|---|---|---|---|
| `S__UFLine__SyncSnapshotsToLedger` | 659 | Sales/ledger | P ×1, SP ×2 | bound on 193 ×2 — remap reads to ORD TOs or epSQL catchers; business-critical, test hard |
| `SOL__ReturnItem` | 621 | SO | P ×3, 67 steps | bound on ServiceOrderDetails |
| `SUPP__Otvori Fakturu` | 612 | SUPP | P ×1 | GoLay + Find |
| `UFD__AttachPrimke` | 678 | UFD | SP ×5 | modern otherwise (Resp ×6) — swap the SP refs |
| `UFD__LockPrimke` | 783 | UFD | SP ×4 | same |
| `UFD__SyncNabavnaCijena` | 781 | UFD | SP ×7 | same |
| `UFD__Remove` | 789 | UFD | SP ×5 | same |
| `UFD__LoadSupplierPrimkas` | 792 | UFD | P ×6, SP ×9 | live (← `UFD__PrimkaPicker`) |
| `UFD__OtvoriPrimku` | 788 | UFD | P ×1 | |
| `KMP__GenerateStavke` | 683 | KMP | SP ×4 | modern otherwise — swap refs |
| `CopyToServiceOrderLines` | 624 | SO picker legacy | SP ×8 | zero static callers — **VERIFY dynamic**, likely REMOVE |
| `Vrati Dio` | 607 | returns | SP ×4 | zero static callers — **VERIFY** (returns popover?), else REMOVE |
| `Vrati dio skripta` | 608 | returns | SP ×1 | same |

### 🌐 VERIFY dynamic dispatch — ✅ census run 2026-07-19 (G4 closed)
Verdicts:
- **Live, keep:** `SO__AttachPrimke` (809 — `callbackScript` in `SO__PrimkaPicker`
  808 payload), `WV__QueryStavkePrimke` (822 — layout 259 WV + stavke-query
  HTML), `WV__GoToPrimka` (824 — stavke-query link handler),
  `WV__UpdateStavkaPrimkeNabavna` (850 — sales-dashboard `main.js`),
  `Init_IncomingOrders` (627 — router `Navigation_` 450 builds `"Init_" & base`).
- **Dead, condemned → REMOVE:** `CopyToServiceOrderLines` (624), `Vrati Dio`
  (607), `Vrati dio skripta` (608) — zero static + zero dynamic callers
  (layouts, menus, callbackScript registrations, WV JS all clean; the
  `id="607/608/624"` hits on layout 106 are layout-object IDs, not scripts).
- **⚠️ Correction:** `UFD__AttachFromPrimka` (791) is NOT a picker callback —
  zero callers anywhere in the export; the UFD picker chain (240 button → 796 →
  792 → 793) passes no `callbackScript` at all (latent bug, UFD scope, spawned
  as separate task). Real attach workhorse: `UFD__AttachPrimke` (678) via
  `WV__CreateUFDFromSelection` (826).
- SO picker WV HTML (embedded in `SO__OpenSOPicker` 815) calls `SO__LoadSOPage`,
  `SO__TransferStavka` (line path, direct), `SO__PickerConfirm` (header path →
  dispatches `Globals::ServiceOrderSelector.callbackScript` = `CopyToOrder`),
  `SO__ClosePicker`. `CopyLineToOrder` (625) PREPARE-only confirmed; its
  callback self-registration is vestigial.

### 🗑️ REMOVE — superseded / dead (fold to `Retired/IncomingOrders/`, 1-month clock)
| Script | ID | Why |
|---|---|---|
| `SO__LoadAvailablePrimkas` | 807 | superseded by SQL3 (858); zero callers |
| `SO__LoadAvailablePrimkasSQL` | 856 | iteration 1; zero callers |
| `SO__LoadAvailablePrimkasSQL2` | 857 | iteration 2 (twin of 858); zero callers |
| `SO__AttachPrimke Copy` | 925 | stale duplicate of 809; zero callers |
| `S__IncomingOrders_KnjižiUlaz` | 658 | part of the retiring KR workflow, not actively used (per developer 2026-07-15) — **remove its button binding on layout 193 at Stage 4 rebind** |
| `DB__WipeKretanjeRobePrimke` | 785 | one-shot dev wipe util |
| `CopyToServiceOrderLines` | 624 | ✅ census 2026-07-19: zero static + dynamic callers |
| `Vrati Dio` | 607 | ✅ census 2026-07-19: zero static + dynamic callers |
| `Vrati dio skripta` | 608 | ✅ census 2026-07-19: zero static + dynamic callers |

---

## Exit criteria (cluster Phase-B-done)

- [ ] Scaffold pruned: 6 drill/returns TOs deleted; 4 core TOs remain.
- [ ] Router routes `incomingOrders` destinations (+ supplier jump) — verify before Stage 3.
- [ ] Every TODO worker passes the headless litmus; dispatcher smokes by action.
- [ ] `ORD__OrdersDispatcher` built; 193/220/221/201 triggers + buttons rebound.
- [ ] GTRR → ServiceOrders button on 193 replaced with `Navigation_`.
- [ ] Layouts 193/220/194/221/201/251/233/234 repointed; Dev 229/227/199 repointed; 192 decided + fixed.
- [ ] Post-repoint sweep clean: field objects, hide calcs, **conditional formatting**, button params.
- [ ] Data API smoke on 233/234 after repoint.
- [ ] Other-cluster remaps done (UFD ×6, KMP ×1, S ×1, SOL ×1, SUPP ×1, copy flows).
- [ ] Dynamic-dispatch verification complete; REMOVE set foldered to `Retired/IncomingOrders/`.
- [ ] Stage 6: octopus relationships stripped; `Primke`/`StavkePrimke` kept detached as catchers; index re-export confirms.
- [ ] OttoFMS deploy → live smoke (scan→receipt→price→knjiži ulaz→SO transfer round-trip; UFD attach; WV bridges; API layouts).
