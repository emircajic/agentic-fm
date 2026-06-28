# Navigation switchboard — deployment guide

`Navigation_` is the single source of truth for all layout navigation: forward, back, forward-again, and card peeks. Each layout's state (layout + found set) is persisted with the **Snapshot Link context** technique. **Context is decoupled from history** — it lives in a per-layout keyed store, so any arrival (back/forward OR a normal nav button) can restore it.

## Architecture

```
UI button / startup
   │ Perform Script "Navigation_" with one of:
   │   "destination" | "destination|payload" | "destination.list" | "destination.card" | "back" | "forward"
   ▼
Navigation_
   ├─ if in a card window: close it first
   ├─ parse: destination, payload, .card modifier, hasRecord = payload present
   ├─ hygiene: freeze, browse mode, commit
   ├─ back/forward branch:
   │     capture current → keyed store ; pop source name-list ; push current onto other
   │     → restore target from keyed store (Restore Context) or plain navigate if none
   ├─ routing table (dot-notation) → { layout, init, mode }   ( .card forces mode=card )
   ├─ CARD branch:  New Window [Card] → navigate → [Init if exists] → [Go to Record if bare id]   (NO capture/context)
   └─ REGULAR branch:
         capture current → keyed store ; push onto $$LAYOUT.STACK ; clear FORWARD
         → if (no payload AND saved context exists): Restore Context  (return to last state)
           else:  HandleResponsiveLayout_ → [Init if exists] → [Go to Record if bare id]

Get Context      → Save Records as Snapshot Link → read file → GetContext() → { recids, layoutid }
Restore Context  → ObjectLayoutNumber → Go to Layout → Find Mode by recid (ranges) → Perform Find
```

**State globals:**
- `$$LAYOUT.CONTEXT` — **JSON object keyed by base layout name** → context blob `{recids,layoutid}`. The canonical per-layout state. Written on every leave (except from card windows).
- `$$LAYOUT.STACK` / `$$LAYOUT.STACK.FORWARD` — **¶-delimited lists of base layout names** (top = first line). Ordering only; the blob is looked up from `$$LAYOUT.CONTEXT`.
- `$$NAV.ENTITY` — the `Init_` base of the layout currently shown (e.g. `"Client"`). Used to detect same-entity view switches. Cleared by back/forward.
- `$$CONTEXT` — last-captured blob (side effect of Get Context; harmless).

## List ↔ Details share a found set

FileMaker shares a found set **per table occurrence per window**, so ClientList and ClientDetails (both on the `Clients` TO) natively share one found set — that's the List/Detail browse pattern. The router must not fight it.

When the destination's entity matches the layout you're already on (`$initScriptBase = $$NAV.ENTITY`, e.g. `clients.list` while on `ClientDetails`) **and there's no payload**, Navigation_ treats it as a **view switch**: it just changes layout and does **nothing** to the found set — no Restore Context, no Init. The shared set (and its sort/filter, applied by Init on first entry to the entity) carries over natively.

Restore/Init still run for cross-entity navigation and back/forward. A record jump (`clients|id`) within the same entity is *not* a plain view switch — it carries a payload, so `Go to Record` still narrows to that record.

> Implementation note: this replaces literal "key context by TO." TO-keying collides with Restore Context's layout coupling (a TO-shared blob could send you to List when you asked for Details). The same-entity short-circuit achieves the same observable result — shared found set — without that hazard. Edge: the first view switch immediately after a back/forward doesn't get the skip (`$$NAV.ENTITY` was cleared); harmless, since the found set is already correct natively.

`$$LAYOUT.STATE`, `$$LAYOUT.IGNORE`, the blob-in-stack model, and the `<Entity>Set` anchor schema from earlier rounds are **all retired**.

## Restore behavior (the model)

Window mode is the discriminator — every FileMaker window has its own found set, so a card peek physically cannot disturb the main window's state.

| Invocation | Restore saved context? | Writes saved context? |
|---|---|---|
| `clients.card` / `clients.card\|id` — peek | No — Init shows the record in a card | **No** — cards never capture |
| `clients` — regular, no record | **Yes** — return to last found set | Yes, on leave |
| `clients\|client_id` — regular, specific record | No — Init finds the record | Yes, on leave (becomes new state) |
| `back` / `forward` | Yes — from the keyed store | Yes (captures current first) |

**Rule of thumb:** "show me this related record without losing my place" → `.card`. "go work on this record full-screen" → `entity|id` (regular). Saved context is never deleted — cards don't touch it, regular nav overwrites it naturally on leave.

## Why Snapshot Link (vs. the approaches we tried before)

- **N find requests** — falls over on large sets (the 3500-of-4000 case hangs the UI).
- **`<Entity>Set` multi-key anchor** — works, but forces a per-entity TO + relationship + a global field, and every layout must sit on the right TO.
- **Snapshot Link context** — FileMaker's native snapshot already encodes the found set as compact **recid ranges** (contiguous runs collapse to `"100-200"`). Restore turns each range into a find request `100...200`, so the number of requests = number of ranges, not records. A 3500-record contiguous set can be a *single* request. Schema cost: one indexed `recid` field per table. No TOs, no relationships, no globals.

## Parameter contract for Navigation_

| Call | Result |
|---|---|
| `Navigation_ ( "back" )` | Pop back stack, push current onto forward stack, restore target from keyed store. Silent no-op if empty. |
| `Navigation_ ( "forward" )` | Mirror of back. |
| `Navigation_ ( "dashboard" )` | Početna |
| `Navigation_ ( "clients" )` | ClientDetails — restores last context if saved |
| `Navigation_ ( "clients.list" )` | ClientList — `.list` variant |
| `Navigation_ ( "clients.card" )` | ClientDetails in a card window (peek, isolated) |
| `Navigation_ ( "clients|client_id" )` | ClientDetails, Init finds that client; context disregarded for this arrival |
| `Navigation_ ( "clients.card|client_id" )` | That client in a card; main window untouched |
| `Navigation_ ( "settings" )` | Card Setup card window |

Pipe-split on first `|`. Modifiers: `.list` picks the List layout (routing-table row); `.card` is orthogonal — strip it, route normally, force a card window. Payload present ⇒ "specific target" ⇒ saved context disregarded for that arrival.

**Payload is one of two things, auto-detected:**
- **Bare id** (`clients|client_id` — does **not** start with `{` or `[`) → the router calls `Go to Record`, which **positions** onto that PrimaryKey within the found set. No Init code required for record navigation.
- **JSON** (`orders|{"filter":"open"}` — starts with `{` or `[`) → passed to `Init_<Entity>` as config; the router does not auto-find.

> Discrimination is a `{`/`[` **prefix test**, not `JSONIsValid` — a numeric or all-digit id (e.g. a numeric TSID) is technically valid JSON but is still a record key. Only an actual JSON object/array is treated as Init config.

In both cases the payload is also handed to Init (if one exists) for layouts that want it.

## Init is optional

`Init_<Entity>` runs only if it exists — a missing one (error 104) is silent, no dialog. You do **not** need to create empty placeholder Init scripts for every layout. Add an `Init_<Entity>` only when a layout needs setup beyond navigation + found set (web viewer push, default sort, globals, etc.). Real errors inside an Init that *does* exist are still surfaced.

Found set is the router's job, not Init's:
- **Specific record** → `Go to Record` (centralized helper; moves the pointer, keeps the set).
- **Return to last state** → `Restore Context`.
- **Default view for a fresh visit** → that's the one found-set concern still legitimately inside Init (e.g. "open orders only"). It runs first; a bare-id `Go to Record` then positions onto the requested record **within** that set (or Show All if it's not in the set).

### Go to Record is non-destructive

`Go to Record` no longer does a `Perform Find` (which would collapse the found set to one record). Instead: epSQL looks up the record's `recid` for the PrimaryKey, then it walks the **current** found set to position onto it (`Get(RecordID) = recid`, no field read). Only if the record isn't in the current set does it `Show All Records` and position there. So clicking a row in your 50-record search lands on that record **inside the 50** — the List→Details browse pattern holds for record jumps too. (Walk is O(found count) under Freeze Window — fine for normal sets; on a very large Show-All fallback it's a linear scan.)

## Schema requirement — `recid` field

`Restore Context` rebuilds the found set by finding on a field literally named **`recid`** on the destination layout's base table:

```
Set Field By Name [ Get(LayoutTableName) & "::recid" ; <recid or range> ]
```

For every entity you want found-set restore on (Clients, ServiceOrders, ServiceItems, Vehicles, …), add a field named exactly **`recid`** (lowercase):

```
recid   -- Calculation, = Get ( RecordID ), result Number, STORED + INDEXED
```

**Must be stored + indexed** — range finds (`100...200`) need the index. A *calculation* of `Get(RecordID)` is fine: uncheck **"Do not store calculation results — recalculate when needed"** in Storage Options, and FileMaker will let you index it. `Get(RecordID)` is constant per record, so storing it is safe. (You can also use an auto-enter calc on a Number field — same result; the stored calc is simpler.)

⚠️ Your solution today defines `recid` calc `Get(RecordID)` only on utility tables (AgentExports, KretanjeRobe, Settings, TR__LedgerRows) and `RecID` — wrong case — on Primke. The entity tables (Clients, ServiceOrders, ServiceItems, Vehicles) have none. Two things to check/do:
1. **Verify the existing fields are actually stored + indexed** (they may currently be unstored — the default).
2. **Add `recid` to the entity tables**, lowercase, stored, indexed.

Layouts whose base table lacks `recid`: back/forward still restores the **layout** (graceful), just not the found set.

## Custom functions

Install via **Manage → Custom Functions → New**:

| CF | Params | File |
|---|---|---|
| `GetContext` | `fpsl` | `agent/sandbox/GetContext.fmfn.txt` |

`GetContext` parses the snapshot XML with **BaseElements `BE_XPath`** (plugin already installed on server + clients). `ObjectLayoutNumber` (114) and `JSONIsValid` already exist in your solution.

`ValueExtract` is **no longer required** by the nav system — `GetContext` was switched from text-slicing to proper XPath. The CF is harmless to keep as a generic helper, or retire it if nothing else uses it.

## Deploy steps

### 1. Custom functions
Install `GetContext`. (Requires the BaseElements plugin for `BE_XPath` — already deployed in your environment.)

### 2. Schema
Add the indexed `recid` field to each entity table (see above). Skip any entity you don't need found-set restore on yet.

### 3. Create placeholder scripts
In the **Layout Stack** group: `Get Context`, `Restore Context`, `Go to Record`. (Forward Button already exists from a prior round.)

### 4. Paste bodies (⌘A then ⌘V on each)

1. `Go to Record.xml` → **Go to Record**
2. `Get Context.xml` → **Get Context**
3. `Restore Context.xml` → **Restore Context**
4. `Forward Button.xml` → **Forward Button** (one-liner → `Navigation_("forward")`)
5. `Back Button.xml` → **Back Button** (one-liner → `Navigation_("back")`)
6. `Navigation_.xml` → **Navigation_** (ID 450)

**After paste, verify every Go to Layout step** in Get Context / Restore Context / Navigation_ — open in Script Workspace and confirm the destination radio + calculation. This step has imported malformed before even when the XML looked clean.

### 5. Retire obsolete scripts (one-time cleanup from earlier rounds)

| Action | Reason |
|---|---|
| Delete `Capture Layout State` (921) | Superseded by Get Context |
| Delete `Restore Layout State` (844 stub **and** 922 dispatcher) | Superseded by Restore Context |
| Delete `Restor Found Set By PK List` (927) | Approach retired |
| Delete `Add to Layout Stack` (846) | Fully retired |
| Delete `Navigation_ Copy` (924) | Lingering backup |

`<Entity>Set` TOs / `Globals::FoundSetKeys` were never built — nothing to undo there.

### 6. Clear stale globals before testing

In the Data Viewer:
```
$$LAYOUT.STACK         = ""
$$LAYOUT.STACK.FORWARD = ""
$$LAYOUT.CONTEXT       = ""
$$NAV.ENTITY           = ""
$$CONTEXT              = ""
```
Old `$$LAYOUT.STATE[N]` / `$$LAYOUT.IGNORE` artifacts clear on file close/reopen (globals don't persist across sessions).

### 7. Optional — collapse the Back/Forward Button wrappers

They exist only so existing UI bindings keep working. To retire them: in Layout Mode point each Back button at `Navigation_` param `"back"` (Forward → `"forward"`), then delete the two scripts. Bindings found referencing Back Button today: ServiceOrdersKanban, ServiceOrderDetails, ClientDetails Card. Forward Button isn't bound anywhere yet — wire your Forward UI button straight to `Navigation_("forward")` and skip the wrapper entirely.

## Behavior notes & caveats

- **Capture cost.** Get Context writes + reads + parses a temp snapshot file on every navigation. It's native and fast (faster than iterating a big found set in calc), but it is disk I/O per nav. Fine for interactive use.
- **Snapshot path.** `Get(TemporaryPath) & Get(UUID)` — no `.fmpsl` extension, matching the source pattern. If your FM build appends the extension and the subsequent `Get File Exists` fails, add `& ".fmpsl"` in `Get Context` (verify on first run).
- **Active record not pinned.** Restore rebuilds the *set*; current record lands on the first found. Snapshot doesn't carry the active row in this implementation.
- **Single-record found sets.** `Restore Context` exits `False` when `recids` holds exactly one value (`$requests = ValueCount - 1 = 0`). A 1-record found set isn't restored as such. Edit the `If [ not $requests ]` guard if you need that case.
- **Sort order not preserved.** Find Mode + Perform Find returns the set, not the ordering. Re-sort in a per-layout OnLayoutEnter if a layout's UX depends on sort.
- **Device variant on restore.** A restored blob navigates via its captured `layoutid` (the exact variant active at capture). If the session switched devices since capture (e.g. captured on `_phone`, restoring on desktop), you land on the captured variant. Rare within a session; note if multi-device.
- **Context is "latest per layout," not point-in-time.** Visiting a layout twice with different found sets keeps only the most recent in `$$LAYOUT.CONTEXT`. Back to that layout restores the latest, not the historical snapshot at that stack position. Simpler and almost always what users expect.
- **Tabs / scroll / UI state.** Not captured — Context covers layout + found set only. If you later need tab restoration, layer a per-layout hook on top; out of scope for this round.

## Files in this changeset

- `agent/sandbox/Navigation_.xml`
- `agent/sandbox/Back Button.xml`
- `agent/sandbox/Forward Button.xml`
- `agent/sandbox/Go to Record.xml` (NEW — centralized record browse)
- `agent/sandbox/Get Context.xml` (NEW)
- `agent/sandbox/Restore Context.xml` (NEW)
- `agent/sandbox/ValueExtract.fmfn.txt` (NEW — custom function)
- `agent/sandbox/GetContext.fmfn.txt` (NEW — custom function)
- `agent/sandbox/Navigation_DEPLOY.md` (this file)

Retired (delete from FM, no sandbox files): Capture Layout State, Restore Layout State, Restore Found Set By PK List / Via Anchor, Add to Layout Stack, Navigation_ Copy. `CustomList` may stay installed — it's no longer used by this system.
