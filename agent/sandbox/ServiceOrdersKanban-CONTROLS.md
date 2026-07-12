# Service Orders Kanban — FileMaker-native control header

The web viewer (`wv_ServiceOrdersKanban`) is a passive renderer. **All filtering
is driven by FileMaker** through `WV__KanbanControl`, which mutates the global
`$$KANBAN_SCOPE` and re-pushes the board via `WV__PushServiceOrdersKanban`. Add a thin
header band of native buttons **above** the web viewer on the `ServiceOrdersKanban` layout.

The one control that lives *inside* the viewer is the **search box** (redesign, 2026-07):
it round-trips through `WV__KanbanControl` with `{"action":"setQuery","value":"<text>"}`,
so FM still owns the scope. No native search button is needed.

Every native button is a single step: `Perform Script [ WV__KanbanControl ; Parameter: <JSON> ]`.

## FM ⇄ JS contract (v2 — kanban redesign)

**FM → JS** — the push script calls `receiveFromFileMaker(payload)` in the viewer:

```json
{
  "orders": [{
    "id": "...", "number": "0222129", "status": "U toku",
    "customer": "...", "phone": "...",
    "plate": "K58-O-219", "make": "BMW", "model": "320d", "year": 2019,
    "service": "...", "note": "...",
    "date": "...", "timeStart": "HH:MM:SS", "timeEnd": "HH:MM:SS",
    "rush": 0, "price": 340
  }],
  "meta": {
    "periodMode": "day|week|month", "anchorDate": "YYYY-MM-DD",
    "from": "...", "to": "...", "label": "6. Juni 2026",
    "statuses": [], "query": "",
    "page": { "offset": 0, "limit": 100, "total": 137, "hasMore": true }
  }
}
```

Retrieval is one epSQL SELECT with `LEFT OUTER JOIN Vehicles v` / `LEFT OUTER JOIN Clients c`
(headless — no layout hops). `rush` maps to the HITNO flag, `price` (OrderTotalLive) shows on
the card footer when > 0. The search filters stored fields only: order number, description,
plate, manufacturer, model, and client first/last/company name (case-insensitive `LIKE`).

**JS → FM** — the viewer calls three scripts:

| Script | Parameter | Fired by |
|--------|-----------|----------|
| `WV__KanbanControl` | `{"action":"setQuery","value":"..."}` | search box (debounced 300 ms) |
| `WV__UpdateSOStatus` | `{"id":"...","status":"..."}` | card drag-drop |
| `Navigation_` | `orders\|<PrimaryKey>` | card click — FM-native navigation opens the order detail (no in-viewer drawer) |

Each column header also shows the **sum of its orders' prices** — computed in the
viewer from the pushed page, no extra FM call.

## Deploy order

1. Paste `agent/sandbox/WV__PushServiceOrdersKanban.xml` over the existing
   `WV__PushServiceOrdersKanban` (ID 827).
2. Paste `agent/sandbox/WV__KanbanControl.xml` over the existing `WV__KanbanControl` (ID 920).
3. `WV__UpdateSOStatus` is unchanged — it already calls the push, which now honors scope.
4. Rebuild the web viewer HTML: `npm run build` in `agent/sandbox/service-orders-kanban/`,
   then install `dist/index.html` into the viewer the usual way.
5. Initialize scope on layout entry: an **OnLayoutEnter** script trigger (or a step in
   the script that opens this layout) that runs `WV__PushServiceOrdersKanban`. With an empty
   `$$KANBAN_SCOPE` it defaults to **day / today / all statuses / no search / page 1 / 100 per page**.

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

### Search (no native button)
Handled by the viewer's own search box via `{"action":"setQuery","value":"<text>"}`.
An empty value clears the search. Any change resets to page 1.

## Showing the active scope on the FM controls (optional)

The web viewer already renders a read-only header (period label, active-status chips, and a
`X–Y od N` page indicator) from the pushed `meta`. If you also want the **native** buttons to
reflect state (e.g. highlight the active period, show which statuses are on), drive their
conditional formatting from `$$KANBAN_SCOPE`, e.g.:

- active period: `JSONGetElement ( $$KANBAN_SCOPE ; "periodMode" ) = "week"`
- status on: `not IsEmpty ( FilterValues ( JSONGetElement ( $$KANBAN_SCOPE ; "statuses" ) ; "Završen" ) )`

(Refresh affected objects after each control press — a `Refresh Object` step or committing the
record — since `$$` globals don't auto-redraw conditional formatting.)
