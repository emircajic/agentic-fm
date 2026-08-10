# ORD__OrdersDispatcher — rebind spec for layouts 193 / 220 / 221

Stage-3 companion to `PhaseB_Primke_Rollout.md`. Every button and trigger below
was read from the fresh 2026-07-20 layout export — this list is exhaustive; any
binding not listed here is intentionally untouched. Layout 201
(`StavkePrimkePicker`) and API layouts 233/234 are deleted — no work there.

**Install order (paste checklist) — see §5.**

Binding parameters follow one pattern:

```
JSONSetElement ( "{}" ; [ "action" ; "<verb>" ; JSONString ] )
```

Trigger bindings add `[ "trigger" ; 1 ; JSONNumber ]` — the dispatcher then
exits with `True` instead of the JSON envelope, so OnObjectSave / Validate /
Keystroke / Exit events are never cancelled by a JSON result being read as
false. **Do not omit this on triggers.**

---

## 1. IncomingOrders (193)

### Triggers

| Object | Trigger | Currently | Rebind to |
|---|---|---|---|
| `Globals::SifraProizvoda` edit box | OnObjectExit | `Unesi Artikal` (531) | `ORD__OrdersDispatcher` — `JSONSetElement ( "{}" ; [ "action" ; "addArticle" ; JSONString ] ; [ "trigger" ; 1 ; JSONNumber ] )` |
| `ORD__OrderLines::NabavnaCijenaStavke` edit box | OnObjectSave | `S__UFLine__SyncSnapshotsToLedger` (659) | **REMOVE trigger** — retired KR/ledger workflow (rollout Stage-3 comment) |
| `ORD__OrderLines::ProdajnaCijena` edit box | OnObjectSave | `S__UFLine__SyncSnapshotsToLedger` (659) | **REMOVE trigger** — same |
| `ORD__OrderLines::ProdajnaCijena` edit box | OnObjectKeystroke | `ORD__AddVATtoPrice` (926) | `JSONSetElement ( "{}" ; [ "action" ; "addVAT" ; JSONString ] ; [ "trigger" ; 1 ; JSONNumber ] )` |
| `ORD__OrderLines::NabavnaTotal_Calculation` edit box | OnObjectEnter | 615 | `JSONSetElement ( "{}" ; [ "action" ; "priceNabavnaStart" ; JSONString ] ; [ "trigger" ; 1 ; JSONNumber ] )` |
| `NabavnaEnter` (named object, `NabavnaTotal_Global`) | OnObjectSave **and** OnObjectValidate | 616 (both) | both → `JSONSetElement ( "{}" ; [ "action" ; "priceNabavnaEnd" ; JSONString ] ; [ "trigger" ; 1 ; JSONNumber ] )` (double-fire is idempotent — second run sees empty state and no-ops) |
| `ORD__OrderLines::ProdajnaTotal_Calculation` edit box | OnObjectEnter | 617 | `JSONSetElement ( "{}" ; [ "action" ; "priceProdajnaStart" ; JSONString ] ; [ "trigger" ; 1 ; JSONNumber ] )` |
| `ProdajnaEnter` (named object, `ProdajnaTotal_Global`) | OnObjectValidate | 618 | `JSONSetElement ( "{}" ; [ "action" ; "priceProdajnaEnd" ; JSONString ] ; [ "trigger" ; 1 ; JSONNumber ] )` |
| `ORD__ORDERS::ForeignKeyDobavljacID` pop-up | OnObjectExit | **empty (dangling)** — old `ORD__FillReceiptTemplate` 840 reference died when 840 was replaced | `JSONSetElement ( "{}" ; [ "action" ; "receiptTemplate" ; JSONString ] ; [ "trigger" ; 1 ; JSONNumber ] )` |
| Layout | OnLayoutEnter | — (none) | *(optional, recommended for symmetry)* `JSONSetElement ( "{}" ; [ "action" ; "init" ; JSONString ] ; [ "trigger" ; 1 ; JSONNumber ] )` |
| Layout | OnLayoutKeystroke | `KeyShortcutHandler` (859) | keep — app-wide, not ORD scope |

### Buttons

| Object id | Label / where | Currently | Rebind to |
|---|---|---|---|
| 39 | "Dodaj fakturu" (top bar) | `Scan Button` (585) | `JSONSetElement ( "{}" ; [ "action" ; "scan" ; JSONString ] )` |
| 110 | "Prebaci" | `CopyToOrder` (620) | `JSONSetElement ( "{}" ; [ "action" ; "transferToSO" ; JSONString ] )` |
| 63 | supplier icon | `ORD__GoToSupplier` (619) | `JSONSetElement ( "{}" ; [ "action" ; "goToSupplier" ; JSONString ] )` |
| 112 | portal row → SO jump | **GTRR → `ServiceOrders` / ServiceOrderDetails** (octopus graph — the Stage-4 bullet) | Perform Script `Navigation_` with parameter: `"orders|" & ExecuteSQL ( "SELECT \"ForeignKeyServiceOrder\" FROM \"ServiceOrderLines\" WHERE \"ForeignKeyStavkaPrimkeID\" = ? FETCH FIRST 1 ROWS ONLY" ; "" ; "" ; ORD__OrderLines::PrimaryKey )` |
| 64 | portal row ✕ (delete line) | raw `Delete Portal Row` step — **bypasses every guard** | `ORD__OrdersDispatcher` — `JSONSetElement ( "{}" ; [ "action" ; "deleteItem" ; JSONString ] ; [ "stavkaID" ; ORD__OrderLines::PrimaryKey ; JSONString ] )` (worker guards: LINE_IN_USE / LINE_HAS_RETURNS / LINE_INVOICED / LINE_POSTED / PRIMKA_LOCKED) |
| 65 | portal row → line transfer | `CopyLineToOrder` (625) | keep — 625 stays (PREPARE-only), updated in place this stage |
| 114 | "Ukloni" (remove scan) | Set Field on **`Primke::`** target | Stage-4 sweep fix: change target to `ORD__ORDERS::DocumentScan` (same `""` calc) |
| 113 | lock toggle | Set Field `ORD__ORDERS::Locked` | keep — already repointed |
| 49/50, 53/54 | "+PDV" / "−PDV" (both price pairs) | direct Set Field calcs on `ORD__OrderLines` | keep — UI-layer one-liners on the scaffold TO; optional later: "+PDV" → `addVAT` (964 covers it programmatically), "−PDV" has no verb by design |

Note: the `S__IncomingOrders_KnjižiUlaz` (658) button is **already gone** from
the layout — the fresh export shows no binding. Nothing to remove.

## 2. IncomingOrders_phone (220)

| Object | Trigger/Button | Currently | Rebind to |
|---|---|---|---|
| Layout | OnLayoutEnter | `ORD__phoneLayoutEnter` (647) | `JSONSetElement ( "{}" ; [ "action" ; "init" ; JSONString ] ; [ "trigger" ; 1 ; JSONNumber ] )` |
| 44 | transfer button | `CopyToOrder` (620) | `JSONSetElement ( "{}" ; [ "action" ; "transferToSO" ; JSONString ] )` |
| 113 | new line button | `ORD__NewItem_phone` (645) | `JSONSetElement ( "{}" ; [ "action" ; "newItem" ; JSONString ] )` |
| 109 | portal row drill | GTRR via **`StavkePrimke`** octopus TO → StavkePrimke_phone | Stage-4 sweep fix: repoint the GTRR's "Get related record from" to `ORD__OrderLines` (same target layout) — currently broken/unrelated from the `ORD__ORDERS` anchor |
| 96 | nav menu | New Window (Navigacija) | keep — app navigation, not ORD scope |
| 116–119 | "Stavke"/"Sken" panel switch | Go to Object | keep |

## 3. StavkePrimke_phone (221)

| Object | Currently | Rebind to |
|---|---|---|
| 29 — barcode scan button | `Unesi Artikal phone` (644) | `ORD__OrdersDispatcher` — `JSONSetElement ( "{}" ; [ "action" ; "addArticle" ; JSONString ] ; [ "scan" ; 1 ; JSONNumber ] ; [ "stavkaID" ; ORD__OrderLines::PrimaryKey ; JSONString ] )` |
| 28 — back button | GTRR via **`Primke`** octopus TO → IncomingOrders_phone | Stage-4 sweep fix: repoint GTRR TO to `ORD__ORDERS` (same target layout). Alternative: Perform Script `Navigation_` param `"incomingorders|" & ORD__OrderLines::ForeignKeyPrimkaID` |

`StavkePrimke` (194) has zero script bindings — nothing to do.

---

## 4. Script changes shipped alongside (this stage)

| Sandbox file | Target | Change |
|---|---|---|
| `ORD__OrdersDispatcher.xml` | **new script** | 15 verbs, envelope framework, commit-before-delegate, explicit-ID fallbacks |
| `Test_ORD__OrdersDispatcher.xml` | **new script** | 20 headless asserts by action, tagged fixtures + teardown, reports via Agentic-fm Debug |
| `SO__PickerConfirm.xml` | 813, replace in place | drops the `Globals::ServiceOrderSelector.callbackScript` by-name dispatch → static `ORD__OrdersDispatcher` `transferToSOConfirm` call. Header path becomes statically traceable. |
| `CopyLineToOrder.xml` | 625, replace in place | drops vestigial `callbackScript` self-registration + dead selector keys; **remaps `StavkePrimke::`/`Artikli::`/`Primke::` reads to `ORD__OrderLines::`/`ORD__OL_Stock::`/`ORD__ORDERS::`** — the old reads have no graph path from the repointed 193 and were broken since the Stage-4 repoint |
| `Navigation_.xml` | 450, replace in place | adds the `suppliers` destination (`SUPP__SUPPLIERS` layout, no Init, bare-id payload → Go to Record). G1's "supplier jump" route — it did not exist in the router. |

## 5. Install order (Tier-1 paste checklist)

Paste order matters — `SO__PickerConfirm` references `ORD__OrdersDispatcher`
by name, so the dispatcher must exist first.

For each file: `python3 agent/scripts/clipboard.py write agent/sandbox/<file>` →
then in Script Workspace paste as instructed.

1. `ORD__OrdersDispatcher.xml` → **new script** named exactly `ORD__OrdersDispatcher` (suggested folder: with the other `ORD__` scripts). ⌘V into the empty script.
2. `Test_ORD__OrdersDispatcher.xml` → **new script** named exactly `Test_ORD__OrdersDispatcher` (next to `Test_ORD__Workers`).
3. `SO__PickerConfirm.xml` → open **SO__PickerConfirm** (813) → ⌘A, delete, ⌘V.
4. `CopyLineToOrder.xml` → open **CopyLineToOrder** (625) → ⌘A, delete, ⌘V.
5. `Navigation_.xml` → open **Navigation_** (450) → ⌘A, delete, ⌘V. ⚠️ App-wide router — verify the two `Perform Script [ By name ; $initScriptName ]` steps pasted intact before saving.

Then run `Test_ORD__OrdersDispatcher` (from Script Workspace, or ask the agent —
it triggers via the OData bridge and reads `agent/debug/output.json`).

## 6. Manual smoke checklist (UI verbs the headless harness cannot reach)

On dev, after rebinding:

- [ ] 193: type a šifra into the entry field, tab out → line appears in portal (addArticle desktop)
- [ ] 193: "Dodaj fakturu" → NAPS2 scan flow starts; a primka with an existing scan gets a new record first (scan)
- [ ] 193: click nabavna/prodajna total → popover opens pre-seeded, enter total, commit → unit price = total ÷ kolicina (price popovers)
- [ ] 193: Ctrl-Shift-+ inside ProdajnaCijena → value × 1.17 in place (addVAT)
- [ ] 193: pick a supplier in the popup → receipt template fills when empty (receiptTemplate)
- [ ] 193: supplier button → lands on SUPP__SUPPLIERS on the right record via router (goToSupplier)
- [ ] 193: "Prebaci" → picker opens (header mode), choose SO → success dialog with count, "Da" navigates to the SO via router (transferToSO end-to-end)
- [ ] 193: portal ✕ on a line referenced by an SO → guard dialog lists violations; on a free line → confirm dialog then delete (deleteItem)
- [ ] 193: portal line transfer (625) still opens the picker in line mode with qty modal (CopyLineToOrder + remap)
- [ ] 220: layout enter shows toolbar (init); new-line button lands on 221 on the new row (newItem phone)
- [ ] 221: barcode button scans and assigns artikal to the current line (addArticle scan=1)
- [ ] router: `Navigation_` "back" after a supplier jump returns to IncomingOrders with found set intact (context capture regression check)
