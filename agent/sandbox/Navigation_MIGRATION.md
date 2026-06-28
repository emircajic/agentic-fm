# Navigation migration audit

Scan of layout-to-layout navigation across the solution, and the plan to route it all through `Navigation_`.

## Headline

- **Main nav chrome is already migrated.** Every new entity layout (ClientList/Details, ServiceOrder*, ServiceItem*, Vehicle*, Navigacija) already binds `Navigation_`.
- **Only one layout has a raw "Go to Layout" button**: `HTML Templates` (187) — a dev/utility layout, not user nav. Effectively zero Layout-Mode rebinding to do.
- **Everything else is script-bound.** Buttons call navigation *scripts*. So migration = rewriting those **script bodies** to delegate to `Navigation_`. Buttons keep their bindings → no layout changes, pure fmxmlsnippet deploy.

Of the 104 scripts containing "Go to Layout", the vast majority are back-end (KMP__, INV__, DP__, MIGRATE__, AGENT__, processing scripts that hop to a utility layout to manipulate records and return). Those are **not** user navigation and stay as-is. The user-facing navigation surface is small.

## Migration tiers

### Tier 1 — clean, deployable now

| Script | Today | → | Status |
|---|---|---|---|
| `PrikažiDetaljeNaloga` (492) | Go to Layout SO Details → Find by PK | `Navigation_ ( "orders\|" & param )` | ✅ rewritten → `PrikaziDetaljeNaloga.xml` |

The parameter already *is* the SO PrimaryKey, so this is a 1:1 swap. Bonus: it's now stack/context-aware (back/forward + return-to-state work), where the old version just jumped. Only behavior change: loses the "Slide in from Left" animation (Navigation_ uses None).

### Tier 2 — generic relationship-walkers (cluster-split dependent)

The `View X from Y context` scripts are **not** per-screen drills — they're generic GTRR walkers bound across many detail layouts via the shared **Details Template** (123):

| Script | GTRR target (old layout) | Bound on |
|---|---|---|
| `View Client from Service Order context` (126) | Clients Details | Vehicle/ServiceItem/Staff/Client Details + template (7) |
| `View Staff from Service Order context` (150) | Staff Details | 7 layouts |
| `View Service Order from Client context` (125) | ServiceOrderDetailsOld | 3 layouts |
| `View Service Order from Staff context` (136) | ServiceOrderDetailsOld | 1 layout |

Two reasons these aren't one-line swaps:

1. **PK source differs per context.** GTRR abstracts "the related Client" via relationships; `Navigation_` needs the Client PK explicitly, and that field differs depending on which layout the button sits on. A fixed `ServiceOrders::ForeignKeyClient` only works from SO context, not from VehicleDetails/etc. **This is exactly what the octopus-cluster dismantling decides** — once each cluster exposes its own related PKs, the drill button passes that PK.
2. **One-to-many drills need a set, not a record.** `client → orders` and `staff → orders` want a *filtered found set* ("orders for this client"), which `Navigation_` doesn't express yet. Options:
   - `Navigation_ ( "orders.list|" & clientPK )` where `Init_ServiceOrder` interprets the payload as a filter, **or**
   - a dedicated "navigate to filtered set" capability.

**Decision: Tier 2 is deferred until the cluster split lands** — the drills' PK sources stabilize then, and migrating now means rewriting against FK fields that are about to move.

### Retire

| Script | Reason |
|---|---|
| `View Service Item from Service Order context` (128) | **0 bindings** — dead. Delete. |

## The 1 raw-button layout

`HTML Templates` (187) has a direct Go-to-Layout button. Low priority (utility layout). Re-point to `Navigation_` only if it's user-reachable.

## Tier 2 decisions (locked — apply when migrating post-split)

1. **One-to-many filter → payload to Init.** `Navigation_ ( "orders.list|" & JSON )` where the JSON payload carries the filter (e.g. `{"client":pk}`). The router navigates to ServiceOrderList; `Init_ServiceOrder` reads `Get(ScriptParameter)`, sees the JSON, and performs the filtered find. No new router capability — reuses the existing payload→Init path. (Note: a JSON payload is *not* treated as a bare record id, so `Go to Record` won't fire — Init owns the found set.)

2. **Single-entity "view related" → card peek.** `View Client from X`, `View Staff from X` become `Navigation_ ( "clients.card|" & pk )` / `"staff.card|" & pk`. Isolated card window, main window's found set untouched.

3. **Sequence → after the cluster split.** Each cluster will expose its own related PKs; the drill button on each layout passes that PK. Until then the FK source is unstable, so hold.

### Concrete Tier-2 targets (for later)

| Script | New body |
|---|---|
| `View Client from Service Order context` (126) | `Navigation_ ( "clients.card|" & <clientPK in context> )` |
| `View Staff from Service Order context` (150) | `Navigation_ ( "staff.card|" & <staffPK in context> )` |
| `View Service Order from Client context` (125) | `Navigation_ ( "orders.list|" & JSONSetElement("{}";"client";clientPK;JSONString) )` |
| `View Service Order from Staff context` (136) | `Navigation_ ( "orders.list|" & JSONSetElement("{}";"staff";staffPK;JSONString) )` |

`<...PK in context>` is whatever the post-split layout exposes — that's the dependency.

## Deploy (Tier 1)

`PrikaziDetaljeNaloga.xml` → paste into **PrikažiDetaljeNaloga** (492). No layout changes. Verify the calendar still opens orders, and that Back now returns to the calendar.
