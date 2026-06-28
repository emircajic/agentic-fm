# Solution-wide chrome toolbar — spec

**Status:** architecture locked, **not built**. Captured so it isn't re-derived.

## The problem this solves: toolbar fragmentation

Today a layout carries multiple hand-built native button bars — a list layout has the left cluster + a search bar; a detail layout adds a delete/add/search toolbar; a complex layout (kanban) can stack **4–5** bars (filters, actions, …). Each bar is a separate layout object, maintained by hand, **multiplied across every layout**. A one-button change ("all detail layouts need a 4th action") becomes a layout-mode slog × N — so changes don't get made.

The goal is **a single management point** for every toolbar in the solution.

## The solution: one config-driven chrome component that *replaces* native bars

Not a nicer bar, and **not a WV bar alongside the native ones** (that would *add* fragmentation). One web-viewer component whose button set is **pure data**, read from one central config. The renderer is generic and lives in one HTML field; everything solution-specific lives in config. Native ButtonBars get **retired**, not supplemented.

After placement, no toolbar is ever edited in Layout mode again — every change is a config edit that propagates everywhere on the next WV update.

## Three artifacts (build once each)

1. **Renderer** — one `HTML::Toolbar` field, **write-once and dumb**. `render(config)`: group buttons by `zone`, sort by `order`, each `onclick → FileMaker.PerformScript(btn.script, btn.payload)`. Exposes `window.setConfig(json)` and (optional) `window.setState(json)` for transient bits. **Knows nothing about the solution.** It does not generate config, fetch config, or hand-shake with FileMaker — it renders what it is given. (Project rule: the dumber the WV, the more reliably it works. Generation or FM round-trips from JS is where WV trouble comes from.)

2. **`ToolbarConfig ( context )`** — the brain. Reads the central Settings config, filters/resolves it against `context`, evaluates `privilege` / `showWhen` **FM-side**, and returns the final flat JSON array of `{ label, icon, script, payload, zone, order }`. **All** toolbar logic lives here.

3. **Central config in Settings** — the single source of truth: button definitions + per-cluster / per-type compositions. This is the one place you edit.

## The contract

Each button is one config row:

```
{ label, icon, script, payload, zone, order, privilege, showWhen }
```

- `label` — text (may be dynamic, resolved by the CF from context).
- `icon` — SVG **sprite symbol id** (e.g. `"icon-delete"`), never base64. Sprite uses `currentColor` so hover/active styling is pure CSS.
- `script` — FileMaker script to call. **Generalized contract:** nav buttons → `Navigation_`; generic actions (delete/add/search) → small generic action scripts; layout-specific (kanban filters) → that layout's filter script.
- `payload` — the script parameter (e.g. a destination string for `Navigation_`, or `vehicles.list|{"clientID":"…"}` for contextual relational nav).
- `zone` — render group (e.g. `left`, `right`).
- `order` — sort within zone.
- `privilege` / `showWhen` — visibility, **evaluated FM-side in the CF** so the renderer receives a pre-filtered array and stays dumb. `showWhen` as a stored expression the CF `Evaluate()`s is a later knob, not v1.

The renderer's entire job is `FileMaker.PerformScript(row.script, row.payload)`. The old "toolbar emits only to `Navigation_`" collapses into "config row → PerformScript" — the contract is just data now, so there is no per-layout branching in the renderer.

## The derivation boundary (this is what makes it a single management point)

**The layout does not author its config object — it derives it.** If each layout hand-authored a config literal in its WV calc, fragmentation would just move from button-bars to calc-literals (still N things to edit). Instead:

- **Central config** holds button definitions + per-cluster/type compositions ("detail layouts get back, forward, delete, add, search").
- **Context** is the thin thing a layout cheaply supplies: `{ cluster, entity, recordPK, privilege }` — from `LayoutSetting_Get("cluster")` + `Get()` calls. Near-zero per-layout authoring. (`LayoutSetting` keys on `Get(LayoutNumber)`, stable here — numbers only shift on a database rebuild.)
- **The CF expands** context against central config and emits the final array.

So "add a 4th action to all detail layouts" = one Settings edit; every detail layout's `ToolbarConfig` picks it up. Layout-specific bars (kanban filters tied to specific fields) don't become generic — but the **renderer** stays generic; the per-layout specifics live in config rows scoped to that layout's cluster.

## Refresh model — bake on load, push on change (no handshakes, no fetch)

Per-layout WV objects don't survive a layout switch, so the boundary matters:

- **Cross-layout (cold arrival):** the destination layout's WV loads fresh, so config is **baked into the calc** — WV web-address calc = HTML with `{{CONFIG}}` ← `ToolbarConfig ( ToolbarContext ( ) )`. First paint is already correct: no fetch, no race, no flash of wrong state. The only visual cost is the WV repaint, killed by fully-inline HTML + page/WV background = **#4E6B7F** (same-color repaint, no white blink).
- **Within-layout (filter applied, record changed, privilege flips):** do **not** refresh the WV object (reload + flash). Call `Perform JavaScript in Web Viewer [ "toolbar" ; "setConfig(" & ToolbarConfig ( ToolbarContext ( ) ) & ")" ]` — in-place re-render, no reload. **Object refresh is not needed for live updates.**

**Push, not pull.** FM already knows the context, so FM hands it down (bake on load, `setConfig()` on change). A WV that fetches its own config (async handshake) is more moving parts for nothing — and violates the dumb-WV rule. Transient client-only state (e.g. a live found-count badge) goes via `setState`, not a round-trip.

## Renderer details

- Single inline **SVG sprite** (`<symbol id="icon-…">`, referenced by `<use href="#icon-…">`), `currentColor` for theming. Static asset; rebuilt only when a genuinely new icon is added.
- Visual: background #4E6B7F, smoke-white (#F5F5F5) foreground, full-height hit areas, hover/active = translucent overlay — matches the existing hand-built buttons so the bar reads as the same component, not a foreign frame.
- Page: `html,body{margin:0;height:100%;overflow:hidden;background:#4E6B7F}`, buttons in a flex row at `height:100%`; `justify-content: space-between` to split zones; drop labels → icons-only under a width breakpoint.

## Placement geometry (set once, never revisit)

- WV object: **full-width, anchored Top + Left + Right (stretch), fixed 50pt height.** Matches the dominant "anchor left / stretch right" convention; the one or two center/no-stretch layouts get unified to this.
- All width variation is absorbed *inside* the WV by flexbox, so the object geometry never needs adjusting again.
- WV object settings: **no border, no scroll bars, background #4E6B7F.** 50pt is ample for a 40px touch target + padding.
- **Hard per-placement requirement:** "Allow JavaScript to perform FileMaker scripts" must be checked, or `FileMaker.PerformScript` silently no-ops. Requires FM19+.

## Deploy idiom (unchanged)

Single-file HTML lives in **`HTML::Toolbar`**; every WV's web-address calc is `ToolbarUrl()` (the `{{CONFIG}}`-substituting wrapper over the field). Edit the field once → every layout reflects it. Same mechanism as `PocetnaStranica` / `SalesDashboard`. The WV *object* is pasted per layout (layout-XML × N, once), but its source is one centralized field — toolbar changes are a data update, never an N-layout edit. Never inline HTML per-WV.

## v1 scope and migration

- **v1 = the common left cluster + back/forward**, rendered from config, placed once as the full-width chrome WV. This delivers functioning back/forward immediately and is **not** a throwaway — it's the first slice of the unified component. (Native back/forward buttons would be throwaway; build v1 instead.)
- **Migration:** every other bar folds **into the same WV by config**, retiring the native bar it replaces — done opportunistically during each layout's Phase-C pass (the layout you're already touching to repoint its anchor TO). One bar object per layout, ever; it only grows through config. This is the last N-layout pass.

## Where each FM surface lands

| Surface | Disposition |
| --- | --- |
| Top chrome (left cluster, search, detail actions, kanban filters) | **This component.** All fold into one config-driven WV. |
| Side-nav drawer (global destinations) | Native today; can be WV-ified later for context (active-highlight, privilege). Separate overlay, not blocking. |
| Contextual relational nav (this client's Vehicles / Service Orders) | Config rows firing `Navigation_` with a payload — **Tier-2 routing**, cluster-split-gated. Added by config when Tier-2 lands. |
| Back/forward | v1 config rows → `Navigation_("back"/"forward")`. Lets the standalone `Back Button` / `Forward Button` scripts be retired. |

## Caveats to go in with eyes open

- **Per-layout WV reload flash** on every nav — mitigated by inline HTML + #4E6B7F background match; keep the build tiny so re-init is sub-frame.
- **Live-coupled controls** (a search box that must reflect typed input, a filter reading a current field value) are where you decide per-control how far to push into the WV vs. leave one thin native control. Don't assume everything generifies.
- **Focus/commit:** a WV button click can commit the active record / steal focus mid-edit. Decide deliberately (usually commit first) and test against in-progress edits.
- **Platform spread:** the JS→FM bridge must be verified across WebDirect, FileMaker Go/iOS, Windows (Edge WebView2) — behaves on all three, but test, don't assume.

## One-line summary

One dumb write-once renderer (`HTML::Toolbar`) + one `ToolbarConfig(context)` CF + one central Settings config — baked on arrival, `setConfig`-pushed on change. Three artifacts built once; from then on every toolbar in the solution is a Settings edit.
