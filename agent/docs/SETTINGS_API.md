# Settings API

Hardened settings architecture for FileMaker solutions using a key-value `Settings` table, a shared session cache in `$$SETTINGS`, and an optional per-layout draft wrapper in `$$LAYOUT_SETTINGS`.

This document turns the older `GetSetting` / `SetSetting` approach into a safer, reusable API that can be carried across solutions.

## Goals

- Keep reads cheap via `$$SETTINGS`
- Keep writes authoritative via native record edits, not SQL shortcuts
- Preserve typed JSON output for easy consumption
- Detect stale caches across sessions
- Provide a stable script/CF API that can be reused in other files
- Support layout-local draft settings without forcing every UI toggle to write immediately

## Runtime objects

### `$$SETTINGS`

Committed settings cache for the current client session.

- source of truth for reads during normal runtime
- rebuilt by `SETTINGS__Load`
- shared across all windows in the session

### `$$SETTINGS_VERSION`

Reserved cache-version token loaded from:

- `_system.settings_version`

Used by `SETTINGS__EnsureLoaded` to decide whether the local cache is stale.

### `$$LAYOUT_SETTINGS`

In-memory draft wrapper for layout-scope settings.

Shape:

```json
{
  "184": { "ui": { "sidebar": { "collapsed": true } } },
  "210": { "sort": { "field": "Name", "direction": "asc" } }
}
```

Rules:

- keys are layout numbers as strings
- values are draft objects for `layouts.<layoutNumber>`
- multiple instances of the same layout intentionally share one draft per client session
- drafts are committed on layout exit through `SETTINGS__LayoutExit`

## Current weaknesses

The current Autoklinika design has a strong table model, but the write path bypasses it:

- `SetSetting` updates `Settings::value` by SQL, which weakens confidence in auto-enter + validation execution
- callers cannot tell whether a key was actually updated or silently missed
- `$$SETTINGS` is session-local and can drift across users until a manual reload

## Recommended architecture

### 1. Keep the table-driven JSON model

Retain the table fields that make the pattern strong:

- `key`
- `value`
- `type`
- `default`
- `valid`
- `pairs`
- `FUNCTION`

These fields already express the core contract well: each row declares its storage value, intended JSON type, default fallback, and validation rule.

### 2. Remove SQL from the core write path

Do not use direct SQL updates for settings writes.

All writes should go through a native script that:

1. finds the setting row by `key`
2. verifies the row exists
3. sets `Settings::value`
4. commits the record
5. verifies the result is still valid
6. bumps a cache-version token
7. reloads `$$SETTINGS`

This keeps FileMaker behavior aligned with the table design instead of re-implementing rules in multiple places.

### 3. Introduce a cache-version token

`$$SETTINGS` is still the right runtime cache, but it needs staleness detection.

Use one dedicated setting key for cache invalidation:

- `_system.settings_version`

On every successful write:

- set `_system.settings_version` to `Get ( CurrentTimeUTCMilliseconds )`

Each session tracks:

- `$$SETTINGS`
- `$$SETTINGS_VERSION`

Before using cached settings in important entry points, compare:

- `$$SETTINGS_VERSION`
- `GetSetting ( "_system.settings_version" )`

If they differ, run `SETTINGS__Load`.

This is simple, portable, and does not require push notifications or server-side eventing.

## Scope model

### `app.*`

Global app settings.

Examples:

- `app.locale`
- `app.theme`
- `app.sidebar.defaultCollapsed`

Recommended behavior:

- edit on dedicated admin/settings layouts
- save explicitly with `SETTINGS__SetValue` or `SETTINGS__BulkSet`
- do not keep these in a long-lived draft variable unless you are inside a dedicated settings editor

### `layouts.<layoutNumber>.*`

Per-layout preferences and view state.

Examples:

- `layouts.184.currentView`
- `layouts.184.filters.showOpenOnly`

Recommended behavior:

- load into `$$LAYOUT_SETTINGS[layoutNumber]` on layout enter
- mutate in memory during layout use
- sync on layout exit with `SETTINGS__LayoutExit`

### `tables.<baseTableName>.*`

Shared settings used by multiple layouts that work with the same table.

Examples:

- `tables.ServiceOrders.defaultSort`
- `tables.Invoices.defaultSeries`

Recommended behavior:

- read from `$$SETTINGS`
- write through immediately with `SETTINGS__SetValue`
- avoid layout-scope drafts for these, because multiple layouts may depend on them at once

### 4. Split the API into cache reads vs table writes

Use custom functions for reading.

Use scripts for writing.

That boundary is important:

- CFs are great for pure reads inside calculations
- scripts are better for mutation, validation, error reporting, and commits

## Stable API

### Custom functions

#### `Settings_Get ( key ; defaultValue )`

Read from `$$SETTINGS`, not from SQL.

Behavior:

- returns `JSONGetElement ( $$SETTINGS ; key )`
- returns `defaultValue` if key is missing
- never mutates state

Use this as the default read API throughout the app.

#### `Settings_GetObject ( prefix ; defaultObject )`

Read an object branch from `$$SETTINGS`.

Examples:

- `Settings_GetObject ( "layouts.184" ; "{}" )`
- `Settings_GetObject ( "invoices" ; "{}" )`

Behavior:

- returns `JSONGetElement ( $$SETTINGS ; prefix )`
- returns `defaultObject` if missing or not an object

#### `Settings_CacheVersion ( )`

Returns the current cache version from `$$SETTINGS`.

Example:

- `Settings_Get ( "_system.settings_version" ; "" )`

#### `Settings_IsLoaded ( )`

Boolean helper:

- true when `$$SETTINGS` contains a valid JSON object
- false otherwise

#### `Settings_GetScopeObject ( scope ; scopeId ; defaultObject )`

Convenience wrapper for scoped object reads.

Examples:

- `Settings_GetScopeObject ( "layouts" ; Get ( LayoutNumber ) ; "{}" )`
- `Settings_GetScopeObject ( "tables" ; "ServiceOrders" ; "{}" )`

#### `LayoutSetting_Get ( key ; defaultValue )`

Reads one key from the current layout draft in `$$LAYOUT_SETTINGS`.

Examples:

- `LayoutSetting_Get ( "ui.sidebar.collapsed" ; False )`
- `LayoutSetting_Get ( "sort.field" ; "Name" )`

Notes:

- reads only from the in-memory draft for the current layout number
- falls back to `defaultValue` if the draft or key is missing

#### `LayoutSetting_Set ( key ; value ; valueType )`

Returns an updated `$$LAYOUT_SETTINGS` wrapper with the current layout draft modified.

Usage:

```filemaker
Set Variable [ $$LAYOUT_SETTINGS ; LayoutSetting_Set ( "ui.sidebar.collapsed" ; True ; JSONBoolean ) ]
```

Notes:

- this custom function does not mutate globals by itself
- callers must assign the return value back into `$$LAYOUT_SETTINGS`
- `valueType` should be a FileMaker JSON type constant such as `JSONString`, `JSONNumber`, `JSONBoolean`, `JSONObject`, `JSONArray`, or `JSONNull`

### Scripts

#### `SETTINGS__Load`

Loads the full settings JSON into `$$SETTINGS`.

Responsibilities:

- go to `Settings`
- build JSON from `Settings::FUNCTION`
- verify `JSONIsValid`
- store `$$SETTINGS`
- store `$$SETTINGS_VERSION`
- return to original layout
- return structured JSON response

#### `SETTINGS__EnsureLoaded`

Lightweight guard script for startup and major workflows.

Responsibilities:

- if cache empty, load it
- if cache version differs from `_system.settings_version`, reload it
- otherwise do nothing

#### `SETTINGS__SetValue`

Authoritative write API.

Pass a JSON parameter:

```json
{
  "key": "layouts.184.currentView",
  "value": "weekly",
  "valueType": 1,
  "reload": true
}
```

Responsibilities:

- require `key`
- find exactly one row
- fail if key missing
- set field natively
- commit
- verify no validation failure
- update `_system.settings_version`
- reload cache when requested
- return structured response JSON

`valueType` is optional and should be a FileMaker JSON type constant. It is mainly used so callers such as `SETTINGS__SyncScopeDraft` can preserve booleans, numbers, objects, and arrays in response payloads and intermediate JSON construction.

Suggested response:

```json
{
  "success": true,
  "key": "layouts.184.currentView",
  "value": "weekly",
  "settings_version": "1743055000000"
}
```

#### `SETTINGS__BulkSet`

Optional batch writer for setup/migrations.

Pass:

```json
{
  "items": [
    { "key": "invoices.series", "value": "A", "valueType": 1 },
    { "key": "layouts.184.currentView", "value": "weekly", "valueType": 1 }
  ]
}
```

Use native edits in a loop, then bump version once and reload once.

#### `SETTINGS__SyncScopeDraft`

Diffs a scoped draft object against committed settings and writes only changed keys.

Pass:

```json
{
  "scope": "layouts",
  "scopeId": "184",
  "draft": { "currentView": "weekly" },
  "reload": true
}
```

Responsibilities:

- verify `scope`, `scopeId`, and `draft`
- compare draft children to committed settings
- call `SETTINGS__SetValue` only for changed keys
- preserve JSON value types during writes
- optionally reload shared settings once at the end

#### `SETTINGS__LayoutEnter`

Generic layout trigger script with no parameters.

Responsibilities:

- call `SETTINGS__EnsureLoaded`
- derive current layout number using `Get ( LayoutNumber )`
- if `$$LAYOUT_SETTINGS[layoutNumber]` already exists, keep it
- otherwise load committed `layouts.<layoutNumber>` into that slot

This supports crash recovery inside the same session: if a layout exit did not fire, the in-memory draft is reused on the next enter for that layout.

#### `SETTINGS__LayoutExit`

Generic layout trigger script with no parameters.

Responsibilities:

- derive current layout number using `Get ( LayoutNumber )`
- read `$$LAYOUT_SETTINGS[layoutNumber]`
- if a draft exists, sync it through `SETTINGS__SyncScopeDraft`
- if sync succeeds, delete that layout key from `$$LAYOUT_SETTINGS`

Trade-off:

- multiple instances of the same layout share one in-memory draft intentionally
- this is acceptable for layout settings that should not diverge across windows

## Validation model

Keep validation in one place: the table row.

Recommended rule:

- `valid` contains a boolean expression using `%value%`

Examples:

- `PatternCount ( "daily¶weekly¶monthly" ; %value% ) > 0`
- `JSONGetElementType ( %value% ; "" ) = JSONObject`

Avoid duplicating these checks inside multiple custom functions.

## Install in another solution

### Required table contract

Your target solution should have a `Settings` table occurrence with at least these fields:

- `key`
- `value`
- `type`
- `default`
- `valid`
- `pairs`
- `FUNCTION`

The API assumes that evaluating `Settings::FUNCTION` produces one JSON object containing the committed settings payload.

### Required helper dependencies

The reusable scripts assume these helper custom functions already exist in the target solution:

- `Response_Init`
- `Response_AddError`
- `Response_SetData`
- `Response_Finalize`
- `GlobalSettings`

If your solution uses a different response envelope, adapt the scripts consistently rather than mixing styles.

### Install order

1. Add or confirm the `Settings` table and the `_system.settings_version` row.
2. Install helper dependencies such as `Response_*` and `GlobalSettings`.
3. Install the settings custom functions:
   - `Settings_Get`
   - `Settings_GetObject`
   - `Settings_IsLoaded`
   - `Settings_CacheVersion`
   - `Settings_GetScopeObject`
   - `LayoutSetting_Get`
   - `LayoutSetting_Set`
4. Install the scripts:
   - `SETTINGS__Load`
   - `SETTINGS__EnsureLoaded`
   - `SETTINGS__SetValue`
   - `SETTINGS__BulkSet`
   - `SETTINGS__SyncScopeDraft`
   - `SETTINGS__LayoutEnter`
   - `SETTINGS__LayoutExit`
5. Wire startup or primary navigation into `SETTINGS__EnsureLoaded`.
6. Add `SETTINGS__LayoutEnter` and `SETTINGS__LayoutExit` to layouts that own draft-style preferences.

### Trigger recommendations

- OnFirstWindowOpen or equivalent startup path:
  - `SETTINGS__EnsureLoaded`
- OnLayoutEnter for draft-enabled layouts:
  - `SETTINGS__LayoutEnter`
- OnLayoutExit for draft-enabled layouts:
  - `SETTINGS__LayoutExit`

Do not attach layout enter/exit triggers to layouts that only consume `app.*` or `tables.*` settings and never use layout drafts.

## Known trade-offs

- `$$SETTINGS` is still session-local, so staleness is detected rather than pushed.
- `$$LAYOUT_SETTINGS` is layout-number scoped, not window scoped.
- If the client session crashes, unsaved layout drafts are lost by design and committed settings remain authoritative.
- Shared `tables.*` settings should be write-through, not draft-based.

## Migration plan for Autoklinika

### Phase 1. Introduce new API without breaking callers

- add new CFs:
  - `Settings_Get`
  - `Settings_GetObject`
  - `Settings_IsLoaded`
  - `Settings_CacheVersion`
  - `Settings_GetScopeObject`
  - `LayoutSetting_Get`
  - `LayoutSetting_Set`
- add new scripts:
  - `SETTINGS__Load`
  - `SETTINGS__EnsureLoaded`
  - `SETTINGS__SetValue`
  - `SETTINGS__BulkSet`
  - `SETTINGS__SyncScopeDraft`
  - `SETTINGS__LayoutEnter`
  - `SETTINGS__LayoutExit`

Keep existing `GetSetting` and `SetSetting` temporarily.

### Phase 2. Repoint callers

Replace:

- `GetSetting(...)` with `Settings_Get(...)` where scalar reads are intended
- `GetSettingsObject(...)` can stay if it already matches the new semantics, or alias it to `Settings_GetObject(...)`
- `SetSetting(...)` direct writes with `Perform Script [ "SETTINGS__SetValue" ]`
- layout-local ad hoc globals with `$$LAYOUT_SETTINGS` plus `LayoutSetting_Get` / `LayoutSetting_Set`

### Phase 3. Add stale-cache checks

Run `SETTINGS__EnsureLoaded`:

- on startup
- before settings-heavy workflows

### Phase 4. Adopt layout drafts where useful

Use layout-scope drafts only for settings that should be edited locally and committed on exit.

Examples:

- current tab
- sort choice
- local filters
- collapsed/expanded UI panels

Do not use layout drafts for table-shared operational settings.
- after returning from admin settings screens

### Phase 4. Retire unsafe writes

After all callers move:

- deprecate `SetSetting`
- remove direct SQL writes from the settings layer

## Reuse rules for future solutions

When copying this pattern to a new solution:

1. Install the `Settings` table fields and auto-enter logic first.
2. Install custom functions next.
3. Install scripts after that.
4. Add `_system.settings_version` seed record.
5. Run `SETTINGS__Load` in the startup path.

Keep solution-specific settings keys separate from API internals:

- reserved keys start with `_system.`
- application keys use business namespaces:
  - `layouts.184.currentView`
  - `invoices.series`
  - `printing.receipt.copies`

## Recommendation

Use this architecture broadly for application settings, layout preferences, toggles, and typed config.

Do not treat the current SQL-backed `SetSetting` as the final reusable API.

The stable reusable version should be:

- cache-backed on reads
- native-script-backed on writes
- versioned for staleness detection
- row-validated at the table level
