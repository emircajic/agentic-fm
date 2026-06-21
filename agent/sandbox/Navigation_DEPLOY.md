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
   ├─ CARD branch:  New Window [Card] → navigate → Init   (NO capture, NO context — own found set)
   └─ REGULAR branch:
         capture current → keyed store ; push onto $$LAYOUT.STACK ; clear FORWARD
         → if (no record AND saved context exists): Restore Context  (return to last state)
           else:                                    HandleResponsiveLayout_ → Init_<entity>

Get Context      → Save Records as Snapshot Link → read file → GetContext() → { recids, layoutid }
Restore Context  → ObjectLayoutNumber → Go to Layout → Find Mode by recid (ranges) → Perform Find
```

**State globals:**
- `$$LAYOUT.CONTEXT` — **JSON object keyed by base layout name** → context blob `{recids,layoutid}`. The canonical per-layout state. Written on every leave (except from card windows).
- `$$LAYOUT.STACK` / `$$LAYOUT.STACK.FORWARD` — **¶-delimited lists of base layout names** (top = first line). Ordering only; the blob is looked up from `$$LAYOUT.CONTEXT`.
- `$$CONTEXT` — last-captured blob (side effect of Get Context; harmless).

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

Pipe-split on first `|`. Payload is passed straight to `Init_<Entity>` — Navigation_ doesn't inspect it, only notes present/absent. Modifiers: `.list` picks the List layout (routing-table row); `.card` is orthogonal — strip it, route normally, force a card window. Payload present ⇒ "specific target" ⇒ saved context disregarded for that arrival.

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
| `ValueExtract` | `data ; start ; end` | `agent/sandbox/ValueExtract.fmfn.txt` |
| `GetContext` | `fpsl` | `agent/sandbox/GetContext.fmfn.txt` (depends on ValueExtract) |

`ObjectLayoutNumber` (114) and `JSONIsValid` already exist in your solution.

## Deploy steps

### 1. Custom functions
Install `ValueExtract` then `GetContext` (order matters — GetContext calls ValueExtract).

### 2. Schema
Add the indexed `recid` field to each entity table (see above). Skip any entity you don't need found-set restore on yet.

### 3. Create placeholder scripts
In the **Layout Stack** group: `Get Context`, `Restore Context`. (Forward Button already exists from a prior round.)

### 4. Paste bodies (⌘A then ⌘V on each)

1. `Get Context.xml` → **Get Context**
2. `Restore Context.xml` → **Restore Context**
3. `Forward Button.xml` → **Forward Button** (one-liner → `Navigation_("forward")`)
4. `Back Button.xml` → **Back Button** (one-liner → `Navigation_("back")`)
5. `Navigation_.xml` → **Navigation_** (ID 450)

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
- `agent/sandbox/Get Context.xml` (NEW)
- `agent/sandbox/Restore Context.xml` (NEW)
- `agent/sandbox/ValueExtract.fmfn.txt` (NEW — custom function)
- `agent/sandbox/GetContext.fmfn.txt` (NEW — custom function)
- `agent/sandbox/Navigation_DEPLOY.md` (this file)

Retired (delete from FM, no sandbox files): Capture Layout State, Restore Layout State, Restore Found Set By PK List / Via Anchor, Add to Layout Stack, Navigation_ Copy. `CustomList` may stay installed — it's no longer used by this system.
