# Navigation switchboard — deployment guide

Six scripts. Two are new (you'll create empty placeholders first), four replace existing bodies. After deploy you'll remove three OnLayoutExit triggers. No layout XML changes are required for the navigation system to work; per-layout state Capture/Restore scripts are an opt-in extension.

## What changed (summary)

- **Navigation_ owns everything now.** It accepts `"back"` and `"forward"` as special destinations alongside the entity routes. Stack push/pop, state capture, state restore, and forward-stack invalidation all happen in one script.
- **Back Button and Forward Button shrink to one-liner wrappers** that just `Perform Script [ "Navigation_" ; "back" ]` (or `"forward"`). They exist only so existing UI button bindings on ServiceOrdersKanban / ServiceOrderDetails / ClientDetails Card don't need to be re-pointed.
- **Capture Layout State** and **Restore Layout State** stay as thin dispatchers that delegate to `Capture_<BaseLayoutName>` / `Restore_<BaseLayoutName>`.
- **`CustomList`** (Agnès Barouh's classic) — used by per-layout `Capture_<X>` to walk the found set as pure calculation (no record movement, no triggers, scales to ~500k records).
- **`Restore Found Set By PK List`** — generic counterpart. Takes a JSON array of PKs, enters Find Mode, OR-joins one request per PK, Perform Find. SQL can't rebuild a found set (it doesn't touch FM context).
- **Add to Layout Stack is fully retired.** OnLayoutExit triggers were removed from Calendar / ServiceOrderDetails / ServiceOrdersKanban; the script can be deleted in FM.
- Removed from Navigation_: the implicit Details↔List toggle, the `stock` destination, `Set Field [Globals::SearchTerm; ""]`, and the unreachable trailing "unknown destination" branch.

**Fixes from previous rounds:**

- *Inverted state-restore Set Variable* (Back/Forward Button) — fixed inside Navigation_'s back/forward branches.
- *`Capture Layout State` $README contract* was still talking about `rowid`. Updated to PrimaryKey + the helper-script restore path.

**Two new fixes prompted by Data Viewer observation:**

1. **Back never navigated.** Previous back/forward used `Go to Layout [ Layout Name by Calc: ObjectLayoutName ( $targetLayoutID ; "" ) ]`. `ObjectLayoutName` returns the layout that contains a named object — it's NOT a layout-number-to-name lookup. Feeding it a layout number like `"134"` returned `"?"`, the navigation silently no-op'd, the stack push still ran, and `$$LAYOUT.STACK.FORWARD` accumulated `134 134 134 134 ...` as Back was pressed repeatedly. Replaced with `Go to Layout [ Layout Number by Calculation: $targetLayoutID ]` — no name lookup needed since we capture and use `Get(LayoutNumber)`.

2. **`$$LAYOUT.STATE[N]` repetition pollution.** Each captured layout created its own repetition row in the Data Viewer (`$$LAYOUT.STATE[14]`, `[16]`, `[93]`, ...). Switched to a **single global JSON object** keyed by layout number: `JSONSetElement` to write, `JSONGetElement` to read. Now there's one `$$LAYOUT.STATE` row holding `{"14":{...},"16":{...},...}`.

   Side effect: `Capture Layout State` had the same `ObjectLayoutName` mistake when deriving the base layout name. Replaced with `Get(LayoutName)` directly — Capture is always called on the layout being captured, so it's already current.

## Parameter contract for Navigation_

| Call | Result |
|---|---|
| `Navigation_ ( "back" )` | Pop `$$LAYOUT.STACK`, push prev onto `$$LAYOUT.STACK.FORWARD`, navigate, restore state. Silent no-op if back stack is empty. |
| `Navigation_ ( "forward" )` | Mirror of back. |
| `Navigation_ ( "dashboard" )` | Početna |
| `Navigation_ ( "clients" )` | ClientDetails (default for entity destinations) |
| `Navigation_ ( "clients.list" )` | ClientList — dot-notation selects the variant |
| `Navigation_ ( "orders.list" )` | ServiceOrderList |
| `Navigation_ ( "orders|{\"jumpToOrderID\":\"abc-123\"}" )` | ServiceOrderDetails, payload passed to Init_ServiceOrder |
| `Navigation_ ( "settings" )` | Card Setup card window (does not touch stack) |

**Destination syntax**: `entity` or `entity.variant`. Variant lives in the routing table — currently `.list` is wired for clients / orders / items / vehicles. Adding a new variant (e.g. `orders.kanban`) is one line in Navigation_'s Case.

**Payload syntax**: optional, separated by `|`. JSON object. Navigation_ does not inspect it — passed straight through to `Init_<Entity>` as the script parameter. Use it for "open this specific record" / "pre-filter to this set" style hints; routing decisions belong in the destination string.

Back/forward accept no payload and ignore any that's passed.

## Deploy order

Do steps 1–2 first so the new scripts have IDs before Navigation_ / Back / Forward reference them by name on paste.

### 1. Install the `CustomList` custom function

File: `agent/sandbox/CustomList.fmfn.txt` — Agnès Barouh's classic, v4.8.1.

In FM: **File → Manage → Custom Functions → New**.
- Function name: `CustomList`
- Parameters (in this order): `Start`, `End`, `Function`
- Body: paste the `Case ( ... )` block from the file (everything from `// ----------- FORMULA STARTS HERE -----------` down to the matching close paren).

Save. References are by name in calculations.

If you already have a different general-purpose found-set walker in the project, fine — skip this step and substitute it in the Capture_&lt;X&gt; templates below.

### 2. Clean up current FM state (one-time housekeeping)

Drift caught in the scan — handle these before pasting the new bodies:

| Action | Why |
|---|---|
| **Delete** script `Restor Found Set By PK List` (ID 927) | Approach retired in favour of the relationship anchor below. The typo'd name no longer matters. |
| **Delete** script `Restore Layout State` ID **844** (the empty stub in Layout Stack group) | Duplicate. The real dispatcher is ID 922. |
| **Move** `Restore Layout State` ID 922 into the **Layout Stack** group | Currently orphaned in no group. |
| **Move** `Capture Layout State` ID 921 into the **Layout Stack** group | Currently orphaned. |
| **Delete** script `Navigation_ Copy` (ID 924) | Lingering backup. |
| **Delete** script `Add to Layout Stack` (ID 846) | Fully retired, no callers. |
| Confirm **`CustomList`** custom function is installed | Scan shows it's missing. Without it, per-layout `Capture_<X>` will fail. |

### 2.5. Clear polluted state from previous bad navigation

In the Data Viewer (or via a one-off Set Variable script step), reset these globals before testing the fix:

```
$$LAYOUT.STACK         = ""
$$LAYOUT.STACK.FORWARD = ""
$$LAYOUT.STATE         = ""
$$LAYOUT.IGNORE        = ""
```

Any leftover `$$LAYOUT.STATE[N]` repetitions from the previous (broken) storage model will linger as artifacts until you also clear those — easiest path is to close and reopen the file (globals don't persist across sessions).

### 3. Paste bodies (⌘A then ⌘V on each)

Create a new script `Restore Found Set Via Anchor` in the **Layout Stack** group before pasting. Then:

1. `Restore Found Set Via Anchor.xml` → into **Restore Found Set Via Anchor** (NEW — the dispatcher described above)
2. `Capture Layout State.xml` → into **Capture Layout State** (refreshes the `$README` contract block, fixes `ObjectLayoutName` and switches `$$LAYOUT.STATE` to a single JSON object)
3. `Restore Layout State.xml` → into **Restore Layout State** (ID 922 — the surviving one)
4. `Forward Button.xml` → into **Forward Button** (one-liner)
5. `Back Button.xml` → into **Back Button** (one-liner)
6. `Navigation_.xml` → into **Navigation_** (ID 450 — adds back/forward branches, fixes Go to Layout, fixes state restore)

Manual paste flow for each script:
1. Open the target script in Script Workspace
2. ⌘A — select all existing steps and delete
3. ⌘V — paste

**After paste, every Go to Layout step in the script — verify in Script Workspace** that the destination radio and the calculation match what's expected. Past experience: this step has imported malformed even when the XML looked clean.

### 4. Optional — collapse Back/Forward Button down to UI bindings

The Back/Forward Button scripts are kept as thin wrappers so existing layout buttons don't need to be re-pointed. If you want to retire them entirely:

- In Layout Mode, change each Back button's script to **Navigation_** with parameter `"back"`.
- Same for Forward, with `"forward"`.
- Then delete the Back Button and Forward Button scripts.

UI bindings I found referencing Back Button today: ServiceOrdersKanban, ServiceOrderDetails, ClientDetails Card. No bindings reference Forward Button yet — wire up your Forward UI button directly to `Navigation_("forward")` and you skip ever needing the Forward Button script.

## State capture / restore (opt-in per layout)

The dispatchers (`Capture Layout State`, `Restore Layout State`) only do something for layouts that have a matching `Capture_<BaseLayoutName>` / `Restore_<BaseLayoutName>` script. Without those, state defaults to `{}` and Back/Forward still works — you just don't get tab/record/found-set restoration.

### JSON state contract

`Capture_<X>` returns (via `Exit Script [ Result: ... ]`) a JSON object. `Restore_<X>` receives it as the script parameter. Suggested keys:

```json
{
  "tabs":      ["tabObjectName1", "panelObjectName2"],
  "record_id": "uuid-or-pk",
  "found_set": [12, 47, 88, 91],
  "custom":    { /* anything layout-specific */ }
}
```

`found_set` is an array of `rowid` values (FM's built-in row id). Restore rebuilds the find generically — `WHERE rowid IN (...)` via epSQL — so per-layout capture scripts don't need to know or store table-specific query logic. They just grab the current found set's rowids.

Layouts may add their own keys under `custom`. The dispatcher is dumb — it just hands the JSON over.

### Capturing the found_set with CustomList

CustomList is a pure-calculation iterator — internally it builds an `Evaluate`-able chain (in batches of ~1700) of `Let([CLNum=1];expr) & ¶ & Let([CLNum=2];expr) & ¶ ...`. No record movement, no triggers fire, current record is preserved.

Simplest call — list of PKs across the found set:

```
CustomList ( 1 ; Get ( FoundCount ) ;
    "GetNthRecord ( Clients::PrimaryKey ; [n] )"
)
```

Returns a `¶`-delimited list. To wrap into a JSON array of quoted strings (for the `found_set` slot in the state JSON):

```
Let ( [
    list = CustomList ( 1 ; Get ( FoundCount ) ;
                "GetNthRecord ( Clients::PrimaryKey ; [n] )" )
] ;
    If ( IsEmpty ( list ) ; "[]" ;
        "[\"" & Substitute ( list ; ¶ ; "\",\"" ) & "\"]"
    )
)
```

For multi-field capture (e.g. snapshotting PK + sort key per record in one pass), the Function arg can be a full `Let([...]; ... )` expression — CustomList substitutes `[n]` at every iteration:

```
CustomList ( 1 ; Get ( FoundCount ) ;
    "Let ( [
        pk = GetNthRecord ( Clients::PrimaryKey ; [n] ) ;
        nm = GetNthRecord ( Clients::Name ; [n] )
     ] ;
        JSONSetElement ( \"{}\" ;
            [ \"pk\" ; pk ; JSONString ] ;
            [ \"nm\" ; nm ; JSONString ]
        )
    )"
)
```

**Why PrimaryKey, not `Get(RecordID)`** — `Get(RecordID)` is a function, not a field, so `GetNthRecord` can't reach it. PrimaryKey lives on every table in this solution (per the schema), is domain-stable, and Restore can rebuild the find via `WHERE PrimaryKey IN ( ... )` through epSQL.

### Template — Capture_ClientDetails

```
# Capture_ClientDetails
Set Variable [ $pkList ; CustomList ( 1 ; Get ( FoundCount ) ;
    "GetNthRecord ( Clients::PrimaryKey ; [n] )" ) ]
Set Variable [ $foundSetJSON ; If ( IsEmpty ( $pkList ) ; "[]" ;
    "[\"" & Substitute ( $pkList ; ¶ ; "\",\"" ) & "\"]" ) ]

Exit Script [ Result: JSONSetElement ( "{}" ;
    [ "record_id" ; Clients::PrimaryKey ; JSONString ] ;
    [ "found_set" ; $foundSetJSON ; JSONArray ] ;
    [ "tabs"      ; <JSON array of active tab object names> ; JSONArray ]
) ]
```

Almost identical for every entity — just substitute the base table name in the two field references.

### The `<Entity>Set` convention

For found-set restore to work flawlessly the multi-key anchor has to be baked into every cluster, with a consistent naming scheme so callers never have to think. The convention:

- **Anchor field:** one global text field, `Globals::FoundSetKeys`.
- **Anchor TO:** every entity has a base TO named `<Entity>Set` — `ClientSet`, `ServiceOrderSet`, `ServiceItemSet`, `VehicleSet`. Layouts that participate in found-set restore sit on these TOs.
- **Anchor relationship:** every `<Entity>Set` has the relationship `Globals::FoundSetKeys = <Entity>Set::PrimaryKey` wired in.

Adding a new entity is a four-step recipe: create the `<Entity>Set` TO, wire the relationship, add one `Else If` branch in `Restore Found Set Via Anchor`, point your layouts at the TO. Done. Every layout sitting on that TO inherits found-set restore for free.

**Cost of non-conformance.** A layout whose base TO doesn't follow the `<Entity>Set` convention can't be restored. `Restore Found Set Via Anchor` falls through its `Else` silently — captured state is harmless, just unused. Either migrate the layout's base TO, or accept that found-set restore is opt-in by convention.

### Schema setup (one-time)

**1.** Globals table — add field:

```
Globals::FoundSetKeys     -- text, global storage
```

**Regular (non-repeating) text field.** Multi-key match in FM operates on return-delimited values in a single field — repetitions are not involved and would actually break the pattern.

**2.** For each entity participating in found-set restore, in Manage Database → Relationships:

- Add a TO of the base table named `<Entity>Set` (e.g. `ClientSet`).
- Add the relationship: `Globals::FoundSetKeys = <Entity>Set::PrimaryKey` (plain `=` operator).
- Point ClientList, ClientDetails, etc. at `ClientSet` as their base TO.

**3.** In `Restore Found Set Via Anchor`, the dispatcher already has `If/Else If` branches for `ClientSet`, `ServiceOrderSet`, `ServiceItemSet`, `VehicleSet`. Add more as you add entities.

### Smoke test before relying on it

Before wiring up `Restore_<X>` scripts, sanity-check the multi-key match against one entity (say, ClientSet):

1. Schema steps 1–2 done for ClientSet only.
2. On any layout, in the Data Viewer:
   ```
   Set Field [ Globals::FoundSetKeys ; "pk1¶pk2¶pk3" ]
   ```
   where pk1/pk2/pk3 are three real PrimaryKey values from Clients.
3. Inspect `ClientSet::PrimaryKey` (e.g. via `Count ( ClientSet::PrimaryKey )` in the Data Viewer or by going to a layout based on Globals and viewing related ClientSet records). You should see exactly those 3 records related, in one resolution step.
4. From a ClientSet-based layout, run `Go to Related Records [Show only related; From: ClientSet; CurrentLayout]`. Found set should be those 3 records.

If that works, the pattern works for any scale.

### Template — Restore_ClientDetails (the entire script)

```
# Restore_ClientDetails
Set Variable [ $state ; Get(ScriptParameter) ]

# Found set rebuild -- one line, the dispatcher handles GTRR per entity.
Perform Script [ "Restore Found Set Via Anchor" ; Parameter: JSONGetElement ( $state ; "found_set" ) ]

# Active record
Set Variable [ $recordID ; JSONGetElement ( $state ; "record_id" ) ]
If [ not IsEmpty ( $recordID ) ]
    # Walk the (now-restored, small) found set looking for the matching PK, then Go to Record.
End If

# Tabs
# Loop JSONListValues ( JSONGetElement ( $state ; "tabs" ) ; "" ) calling Go to Object on each.
```

That's it for the found-set part — one `Perform Script` line per `Restore_<X>`. No GTRR wiring per layout.

**Why not SQL** — `ExecuteSQL` / `epSQL` read data but can't change the active found set. FM's context layer (current record, found set, mode) is only mutated by script steps. Multi-key relationship + GTRR is the FM-idiomatic way to "rebuild this exact set" without scaling problems.

**Why not N find requests** — works for small sets (~< 100), gets slow fast, falls over completely around a few thousand. The 3500-of-4000 case you flagged would hang the UI.

**Sort order is NOT preserved.** GTRR delivers the SET of records, not the order. If a layout's UX depends on the user's sort, capture the sort criteria into `state.custom` and re-apply via Sort Records in `Restore_<X>` after the dispatcher returns.

Roll Capture_/Restore_ out per layout as the need arises. No rush — the system runs fine with zero per-layout Capture/Restore scripts.

## What I deliberately did NOT change

- **Init_ contract** is unchanged. Existing Init scripts still receive the raw payload (or `JSONNull` if none). If you later want a "navigation context" wrapper (e.g. `{"payload":..., "from":..., "via":"forward"}`), that's a separate pass touching each Init.
- **HandleResponsiveLayout_** and `_GetBaseLayoutName` are untouched.
- **Layout XML** is untouched. Removing the OnLayoutExit triggers is a click in Layout Setup, not a code change.

## Verification

After deploy, smoke-test in FM:

1. **Forward nav**: Dashboard → Calendar. `$$LAYOUT.STACK` should contain Dashboard's layout ID. `$$LAYOUT.STACK.FORWARD` should be empty.
2. **Back**: from Calendar, press Back. Returns to Dashboard. `$$LAYOUT.STACK` empty, `$$LAYOUT.STACK.FORWARD` contains Calendar's ID.
3. **Forward**: press Forward. Returns to Calendar. Stacks swap back.
4. **Fresh nav clears forward**: on Calendar with forward stack populated, press a different nav button → forward stack should clear.
5. **Toggle default**: from any layout, `Navigation_("clients")` → ClientDetails. `Navigation_("clients|{\"view\":\"list\"}")` → ClientList.
6. **Card mode**: `Navigation_("settings")` opens Card Setup. Stack untouched. Closing the card leaves you on the prior layout.
7. **Unknown destination**: `Navigation_("foo")` shows the "Nepoznata destinacija" dialog.
8. **Empty stack**: from a virgin session, Back does nothing (early Exit).
9. **No-access target**: bonus — if a user lacks access to the target layout, Back/Forward bail cleanly (no infinite loop).

Use the Data Viewer to watch `$$LAYOUT.STACK`, `$$LAYOUT.STACK.FORWARD`, `$$LAYOUT.IGNORE`, and `$$LAYOUT.STATE[*]` during the smoke tests.

## Files in this changeset

- `agent/sandbox/Navigation_.xml`
- `agent/sandbox/Back Button.xml`
- `agent/sandbox/Forward Button.xml` (NEW)
- `agent/sandbox/Capture Layout State.xml`
- `agent/sandbox/Restore Layout State.xml`
- `agent/sandbox/Restore Found Set Via Anchor.xml` (NEW — per-entity GTRR dispatcher)
- `agent/sandbox/CustomList.fmfn.txt` (Agnès Barouh's CustomList v4.8.1, installed via Manage Custom Functions)
- `agent/sandbox/Navigation_DEPLOY.md` (this file)

**Add to Layout Stack** is being retired — no sandbox file. Delete the script from FM after pasting the others.
