# Service Orders Kanban — FileMaker-native control header

The web viewer (`wv_ServiceOrdersKanban`) is now a passive renderer. **All filtering
is driven by FileMaker** through `WV__KanbanControl`, which mutates the global
`$$KANBAN_SCOPE` and re-pushes the board via `WV__PushServiceOrdersKanban`. Add a thin
header band of native buttons **above** the web viewer on the `ServiceOrdersKanban` layout.

Every button is a single step: `Perform Script [ WV__KanbanControl ; Parameter: <JSON> ]`.

## Deploy order (new script needs a placeholder first)

1. In Script Workspace create an **empty** script named `WV__KanbanControl`, save it
   (this gives it an ID). Then paste `agent/sandbox/WV__KanbanControl.xml` into it.
2. Re-paste `agent/sandbox/WV__PushServiceOrdersKanban.xml` over the existing
   `WV__PushServiceOrdersKanban` (ID 827).
3. `WV__UpdateSOStatus` is unchanged — it already calls the push, which now honors scope.
4. Initialize scope on layout entry: add an **OnLayoutEnter** script trigger (or a step in
   the script that opens this layout) that runs `WV__PushServiceOrdersKanban`. With an empty
   `$$KANBAN_SCOPE` it defaults to **day / today / all statuses / page 1 / 100 per page**.

## Buttons and their parameters

### Period (segmented — Dan / Sedmica / Mjesec)
| Button   | Parameter |
|----------|-----------|
| Dan      | `{"action":"setPeriod","value":"day"}` |
| Sedmica  | `{"action":"setPeriod","value":"week"}` |
| Mjesec   | `{"action":"setPeriod","value":"month"}` |

### Navigation
| Button   | Parameter |
|----------|-----------|
| ◀        | `{"action":"navigate","value":"prev"}` |
| Danas    | `{"action":"navigate","value":"today"}` |
| ▶        | `{"action":"navigate","value":"next"}` |

`prev`/`next` shift by the active period (±1 day / ±1 week / ±1 month).

### Status filter (one toggle per column + a clear button)
| Button     | Parameter |
|------------|-----------|
| U toku     | `{"action":"toggleStatus","value":"U toku"}` |
| Otvoren    | `{"action":"toggleStatus","value":"Otvoren"}` |
| Zakazan    | `{"action":"toggleStatus","value":"Zakazan"}` |
| Završen    | `{"action":"toggleStatus","value":"Završen"}` |
| Obračunat  | `{"action":"toggleStatus","value":"Obračunat"}` |
| Fakturisan | `{"action":"toggleStatus","value":"Fakturisan"}` |
| Naplaćen   | `{"action":"toggleStatus","value":"Naplaćen"}` |
| Otkazan    | `{"action":"toggleStatus","value":"Otkazan"}` |
| Sve (clear)| `{"action":"clearStatus"}` |

Toggling is additive (multi-select). With a filter active the board keeps **all 8 columns**
as drop targets — non-matching columns just show no cards (dimmed in the viewer), so you can
still drag a card into any column to change its status.

### Pagination
| Button   | Parameter |
|----------|-----------|
| ◀ str    | `{"action":"page","value":"prev"}` |
| str ▶    | `{"action":"page","value":"next"}` |

The push clamps the offset to a valid page, so "next" past the end is a no-op.

## Showing the active scope on the FM controls (optional)

The web viewer already renders a read-only header (period label, active-status chips, and a
`X–Y od N` page indicator) from the pushed `meta`. If you also want the **native** buttons to
reflect state (e.g. highlight the active period, show which statuses are on), drive their
conditional formatting from `$$KANBAN_SCOPE`, e.g.:

- active period: `JSONGetElement ( $$KANBAN_SCOPE ; "periodMode" ) = "week"`
- status on: `not IsEmpty ( FilterValues ( JSONGetElement ( $$KANBAN_SCOPE ; "statuses" ) ; "Završen" ) )`

(Refresh affected objects after each control press — a `Refresh Object` step or committing the
record — since `$$` globals don't auto-redraw conditional formatting.)
