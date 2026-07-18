# HR Rendering Gaps — Prioritised Inventory

Every step where `snippet_to_hr.py` drops or corrupts a parameter, ranked by real-world exposure.

**Corpus:** `agent/xml_parsed/scripts/Autoklinika` — 444 scripts, 13,119 step instances,
101 distinct step types. "Uses" = instances in that corpus.

**Method:** generic-path gaps derived automatically by diffing each step's catalog `params[]` against
the 9 param types `_render_generic` can emit. Hand-coded renderers were audited by reading
`RENDERERS` — they bypass the catalog, so they drop params of *handled* types too and no automated
check catches them. Behaviour confirmed against `PROBE__TextRepresentation.xml`.

**Verdict up front:** ~840 step instances (6.4% of the corpus) render with at least one parameter
missing or wrong. Roughly half the fix is type aliases costing a line each.

---

## P0 — Corruption (wrong output, not missing output)

Worse than dropping: these produce plausible values that are wrong.

| Step | Uses | Defect |
|---|---|---|
| **Sort Records** | 24 | `NoInteract state="True"` renders as **`With dialog: On`**. Inverted. `XML_TRANSFORMATION.md` documents this element as inverted (`Boolean type="With dialog" value="False"` ↔ `<NoInteract state="True"/>`); `_render_generic`'s boolean branch applies a flat `'On' if raw == 'True'` with no inversion support. Needs `hrEnumValues` on the catalog param, or an `inverted` flag. |
| **Insert Text** | 87 | Truncates. `snippet_to_hr.py:301` cuts the `$README` doc-block branch at 117 chars + `'...'`; **line 309 cuts at 80 chars with no ellipsis at all**, so the loss is undetectable. Line 299 collapses `\r`/`\n` → ` \| `, destroying line structure — and that collapse is **ambiguous, not merely lossy**: 36 of 444 scripts already contain ` \| ` in their text (one `$README` block uses it as a parameter separator: `parent (required text) \| children (required array of {table,fk}) \| …`), so a pipe-separated doc block and a CR-separated one render to the identical string. Our own CLAUDE.md prescribes doc blocks as a disabled `Insert Text` targeting `$README` — every doc block in the project exceeds 120 chars, so **every one is mangled**. |

Audit the whole boolean surface for other inverted elements. `XML_TRANSFORMATION.md` already lists
several: `Options ShowRelated` (GTRR), `URL autoEncode`, `Boolean type="With dialog"`.

### Resolution for long text: heredoc, not truncation

**Do not simply lift the truncation** — restoring the full text inline reinstates the ` | ` ambiguity
and forces quote escaping. Use a heredoc, on the shell model, with the terminator on the step line so
the step itself stays a parseable one-liner:

```
Insert Text [ $README ; <<FMTEXT ]
PARAMETER FORMAT:
  JSONSetElement ( "{}" ;
    [ "pologID" ; $pologID ; JSONString ] ;
  )
FMTEXT
```

The win is not only fidelity — it is that the hardest content becomes the *easiest* to lex. Inside a
heredoc region the lexer scans raw to the terminator: no quote tracking, no bracket depth, no
escaping. `]`, `"[+]"`, `;`, `//`, `/* */` are all inert.

**Rules:**

- **Multi-line → heredoc. Single-line → quoted inline.** Corpus exposure is small: 44 of 87
  `Insert Text` are multi-line (**24 of those also contain quotes** — precisely the population that
  would otherwise need escape-hell), and only 26 of 2,942 comments. **70 of 13,119 instances = 0.5%
  of the corpus.** Readability cost is negligible; a general heredoc rule would hit 3,900
  `Set Variable` bodies and hide calculations from FMLint, which validates them.
- **Comments never take a heredoc** — grammar, not preference: a comment has no bracket group for
  `<<TERM` to attach to. Multi-line comments use **`#>` continuation** (ai2fm's Comment Rule, which
  also resolves our blank-line vs. empty-comment-step ambiguity).
- **Verbatim `<<`, never squiggly `<<~`.** Indent-stripping is a guess about intent. ai2fm strips the
  leading indent from bracket lines and that *is* their corruption — see `TextLayer_Findings.md` §5.
  Content starts at column 0; it looks wrong nested inside an `If`, and it is correct.
- **Terminator collision:** emitter scans the content and bumps the terminator if any line matches
  (`FMTEXT` → `FMTEXT2`). Deterministic, collision-free — same trick as Rust's `r#"…"#`.
- **CR vs LF is the one place heredoc can still lose.** FM text is CR-only (`knowledge/line-endings.md`),
  so newline ↔ `&#13;` maps cleanly — but text ingested from external systems can carry a literal
  `Char(10)`, and a blind newline→CR mapping would corrupt it. Escape LF explicitly or document the
  boundary. Do not let it be the silent case.
- **Heredoc does not replace the lexer.** `Set Variable [ $j ; Value: JSONSetElement ( $j ; "[+]" ; 1 ; JSONNumber ) ]`
  is single-line and still contains `"[+]"`; bracket-depth still dies on it. Heredoc eliminates
  *multi-line* complexity; the quote-aware lexer handles *string-literal* complexity. Both are needed.

Cost to name: `.fmscript` has no heredoc, so this diverges. Acceptable — their normative dictionary is
unpublished and their inline approach is the one that corrupts — but a heredoc region would need
flattening on export if interop ever matters.

---

## P1 — Hand-coded renderers, high frequency

These bypass the catalog entirely. No automated check will ever flag them.

| Step | Uses | Dropped |
|---|---|---|
| **Go to Layout** | **195** | `Animation` — **dropped from all 195**. FM's own HR renders `Go to Layout [ Layout: "X" ; Animation: None ]`; ours emits `Go to Layout [ "X" ]`. Worse: `_render_go_to_layout` special-cases only `OriginalLayout`, then falls through to reading `<Layout name>`. **By-calculation destinations have no `<Layout>` element**, so the 12 corpus instances of `Go to Layout [ Layoutname: $currentLayout ]` render as **`Go to Layout [ "" ]`** — destination gone entirely. `CurrentLayout` / `LayoutNumberByCalc` same. Likely the mechanism behind the known "Go to Layout drifts after paste" issue. |
| **Show Custom Dialog** | **139** | `Buttons` (repeatGroup) — **all of them**, including order and `CommitState`. `Get(LastMessageChoice)` branches on button order, so the HR cannot reconstruct control flow. Also `InputFields` (field/variable target, label, `UsePasswordCharacter`), plus `Height`, `Width`, `DistanceFromTop`, `DistanceFromLeft`. Renders Title + Message only. |
| **New Window** | 47 | `DistanceFromTop`, `DistanceFromLeft` (plain `namedCalc` — handled types, dropped anyway), and all `NewWndStyles` flags except `Style`: `Close`, `Minimize`, `Maximize`, `Resize`, `MenuBar`, `Toolbars`, `DimParentWindow`. |
| **Perform Script** | 433 | *Latent.* Only reads `<Script>`; the `Specified: By name` variant (`<Calculated><Calculation>`) is unhandled and would render the script name as the parameter. **0 instances in corpus** — fix when convenient. Also hardcodes `From list`. |

**Audited clean — no action:** `Set Variable` (3900, incl. repetition), `# (comment)` (2942),
`If`/`End If`/`Else`/`Else If`/`Loop`/`End Loop`/`Exit Loop If` (~2860), `Exit Script` (602, incl.
result calc), `Set Field` (513), `Set Error Capture` (190), `Allow User Abort` (170).

**Not yet audited:** `Commit Records/Requests` (101), `Close Window` (45), `Go to Object` (29).

---

## P2 — Type aliases (cheap: one line each, big payoff)

Several catalog type names look like drift for concepts `_render_generic` already handles. If so,
these are one-line additions to the existing branches — no new rendering logic.

| Alias | Probably | Uses unlocked | Steps |
|---|---|---|---|
| `calc` | = `calculation` | **112** | Go to Record/Request/Page (80), Insert from URL (18), Go to Portal Row (14) |
| `fieldOrVariable` | = `field` + variable target | **123** | Insert Text (87), Insert from URL (18), Execute FileMaker Data API (4), Get File Exists (4), Insert from Device (4), Open Data File (3), Read from Data File (2), Write to Data File (1) |
| `flagBoolean` | = `boolean` / `flagElement` | **51** | Sort Records (24), Select Window (11), Show/Hide Toolbars (7), Save a Copy as XML (4), Save Records as Snapshot Link (3), Save a Copy as (1), Set Window Title (1) |
| `tableOccurrence` / `tableRef` / `tableReference` | = TO reference | 20 | Go to Related Record (13), Import Records (7) |

**~306 instances for what is likely under 20 lines.** Verify the equivalence before aliasing —
if the semantics genuinely differ, they belong in P3 instead. Consider normalising the catalog's
type names at the same time so this drift stops recurring.

---

## P3 — Structural params (real work, needs syntax design)

No existing branch fits. Each needs a grammar decision.

| Type | Uses | Steps | Notes |
|---|---|---|---|
| `findRequests` | **170** | Perform Find (84), Enter Find Mode (83), Constrain Found Set (3) | Currently renders the **label with nothing after it**: `Perform Find [ Restore: On ; Find Requests: ` — it knows the param exists and emits an empty placeholder. **ai2fm's grammar is proven and worth borrowing verbatim** (see `TextLayer_Findings.md` §3). Structure documented in `agent/catalogs/find-requests.md`. |
| `repeatGroup` | 139 | Show Custom Dialog | See P1. Ordered, repeating sub-elements with attributes. |
| `parametersList` | **54** | Perform JavaScript in Web Viewer | Ordered list of calculation parameters. |
| `fieldList` | 38 | Sort Records (24), Export Records (7), Import Records (7) | Ordered field refs with per-entry attributes (sort direction, export order). Sort Records currently renders `Sort: ` and nothing. |
| `attrGroup` | 35 | Go to Related Record (13), Export Records (7), Import Records (7), Perform Script on Server with Callback (4), Insert from Device (4), Print (4) | Attribute bundles — `NewWndStyles`, `ExportOptions`, `ImportOptions`, `PrintSettings`. ai2fm decomposes the `Styles` bitmask into named flags and drops the number; worth copying, but note their recomputed bitmask differed from the input on round trip. |

**Go to Related Record** (13) deserves a line of its own: we drop `Table` — the step's **required**
parameter, the source relationship — plus `NewWndStyles` and `Animation`. ai2fm keeps the table.

---

## Suggested order

1. **P0 truncation + inversion.** Active data corruption, and the doc-block bug hits our own convention.
2. **P2 aliases.** ~306 instances, trivial effort, no design decisions.
3. **P1 Go to Layout + Show Custom Dialog.** 334 instances; both drop semantically load-bearing state
   (navigation destination, control flow).
4. **P3 `findRequests`.** 170 instances, and the grammar is already proven — borrow it.
5. **P3 remainder** as the harness surfaces them.

Steps 1–3 cover ~640 of the ~840 affected instances.

## Whatever gets fixed, fix the failure mode first

Every gap above is silent. `_render_generic`'s `else` branch `continue`s; the hand-coded renderers
simply never look. **Make loss visible before making it smaller** — a warning to stderr and a marker
in the HR output on any dropped param or truncated text. That converts an unknown-unknown into a
grep, turns the 444-script corpus into a coverage report immediately, and it is the same
fail-loud principle the whole text layer needs (`TextLayer_Findings.md` §4).

Tracked separately as the `snippet_to_hr.py` background task.
