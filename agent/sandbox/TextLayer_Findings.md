# Text Layer — Findings

Evidence gathered 2026-07-16 while evaluating whether a plain-text canonical format can losslessly
represent FileMaker scripts, and whether ai2fm's `.fmscript` could serve as that format.

Artifacts: `PROBE__RefBinding.xml` / `PROBE__RefBinding_result.xml` (reference binding),
`PROBE__TextRepresentation.xml` (parameter representation).
Knowledge base entry: `agent/docs/knowledge/reference-binding-on-paste.md`.

---

## 1. IDs are not a loss surface

**Established by experiment, not inference.** A 15-case probe covering field, script and layout
references was pasted into FileMaker and copied straight back out. All 15 agreed:

- FileMaker resolves references **by name**. The `id` attribute is advisory and gets overwritten.
- A *valid but wrong* ID loses to the name. Sent `id="21"` (StatusDokumenta) with
  `name="BrojFakture"` → FileMaker bound BrojFakture and rewrote the ID to 6. Confirmed in both
  directions, and for scripts and layouts.
- `id="0"`, an absent `id`, and a nonexistent `id` all resolve correctly from the name.

**Consequence:** the `id` values "lost" by `scripts_sanitized` are *derived*, not lost. FileMaker
itself is the deterministic function that derives them. A names-only text format loses nothing here.
Emitting `id="0"` is correct.

This is why `fmxmlsnippet` behaves this way: it is a *transport* format between files, and object IDs
are meaningless outside the file that assigned them. Name is the only key that survives the trip.

## 2. The real loss surface is parameters, not references

Many step parameters have no representation in our HR at all — saved find requests, sort orders,
dialog buttons, window style groups, import/export mappings. See `TextLayer_HRGaps.md` for the
itemised inventory.

Two mechanisms:

- `_render_generic` handles **9** of the catalog's **24** param types. Unhandled types hit the
  `else` branch, which tries `el.text` — `None` for structured params, which hold child elements —
  and then `continue`s. Dropped with no diagnostic.
- Hand-coded renderers in `RENDERERS` bypass the catalog entirely and emit only what they were
  written to emit. These drop params of *handled* types too.

## 3. A text grammar **can** express structured params — ours just doesn't

The initial assumption that find requests have "no text form" was wrong. ai2fm encodes them fully:

```
Perform Find [ Restore ; Specified Find Requests:
Find Records; Criteria: I__INVOICES::StatusDokumenta: "Predračun" AND I__INVOICES::BrojFakture: "P-*" ;
Omit Records; Criteria: I__INVOICES::StatusDokumenta: "Storno" ]
```

Include→`Find Records`, Exclude→`Omit Records`, multiple `<Criteria>` in one `RequestRow`→`AND`,
requests separated by `;`. This survives a full round trip in their pipeline.

**So our 15 unhandled param types are unimplemented, not unrepresentable.** That makes the text layer
substantially more tractable than first assessed, and the find-request grammar above is worth
borrowing outright.

## 4. Everyone in this ecosystem fails open

The decisive finding. Four independent implementations, one shared disease — none of them fail loudly:

| Implementation | Silent failure |
|---|---|
| **FileMaker** | Unresolvable name → reference blanked to `id="0" name=""`. No error. A blanked `Set Field` target then falls back to *the active field*, writing wrong data at runtime. |
| **`snippet_to_hr.py`** | Truncates text at 117/80 chars; drops unrenderable params; renders empty param labels (`Find Requests: ` with nothing after). |
| **`hr_parser.py`** | Naive `in_quote` toggling with no escape handling — mis-scans on `\"`. **11% of our corpus** (49/444). Also comment-blind: a `]` in a trailing `//` comment decrements bracket depth (§4b). Unbalanced depth silently swallows following steps into the current one (§4a). |
| **ai2fm** | Inverts booleans, invents enum values, fabricates input fields. Parser dies on `]` inside a string — **13% of our corpus** (58/444). |

**Design consequence:** the compiler's defining feature should be that it *refuses to guess*. Unknown
param type, unresolvable name, unparseable token → error. Never default, never truncate, never omit
silently. This is the one property none of the existing tools have, and the one that matters most for
AI-authored code, where bad names are the most likely defect.

### 4a. Our own linter reports PASSED on catastrophically broken output

The sharpest demonstration of §4, found by accident while reviewing a fix in
`.claude/worktrees/dreamy-wozniak-7a51ff`.

Render `PROBE__TextRepresentation.xml` (30 `<Step>` elements) through `snippet_to_hr.py` on `main`,
then feed the HR back to `python3 -m agent.fmlint`. It reports **PASSED**.

It is not passing. It is two bugs cancelling:

1. `_render_insert_text` truncates the T4 doc block mid-token — `… JSONString ] ; | [ "invoiceIDs" ; $i...`
   — leaving **one `[` unclosed**. Measured `bracket_depth` for that line, counting outside quotes: **1**.
2. `hr_parser._merge_multiline` therefore never closes the step and **swallows T5, T6, T7 and T8** into
   the T4 blob.
3. FMLint consequently never parses T8's calculation *as* a calculation, so `C002` never fires.

Lint T8 in isolation and it fails immediately — `C002: Unclosed parenthesis in calculation` — from
**both** the `main` and the fixed renderer, identically. The bug was always there. Truncation was
hiding it by destroying the parse before it could be reached.

**The truncation was load-bearing.** Removing it does not "break" anything; it lets the parser get far
enough to reach a defect that was always present. A `FAILED` here is progress over a fraudulent `PASS`.

Two lessons:

- **Fail-open compounds.** One silent failure (truncation) manufactured a second (step swallowing),
  which suppressed the diagnostic for a third (comment-blind bracket counting). Each is individually
  survivable; composed, they turn a linter into a rubber stamp.
- **A green test on a fail-open pipeline is not evidence.** The conformance harness (§8) must assert
  **step count in == step count out** as a precondition, before comparing any content. Without it, the
  harness inherits exactly this failure: it would compare 22 recovered steps against 30 and, if the
  comparison is per-step, find nothing wrong with the 22.

### 4b. `hr_parser` is quote-aware but comment-blind

Related, and the concrete case for the lexer. `hr_parser.py:39-50` tracks `in_quote` and correctly
skips bracket counting inside strings — so it survives the `]` in `"… Status <> ']' "`. It then dies on
the `]` in the *trailing line comment* (`// note the ] inside the string`), which is outside any quote
and decrements depth.

Same class as ai2fm's failure, through a different door. Quote-awareness alone is insufficient: the
lexer must tokenize line comments and block comments as first-class token types too, not just strings.
It also still lacks escape handling for `\"` (§4, 11% of corpus).

## 5. ai2fm round-trip results

Torture test (`PROBE__TextRepresentation.xml`), 9 cases: **4 clean, 4 silently corrupted, 1 crash.**

**Clean:** Set Field; Perform Find (all criteria); Sort Records (both keys + directions);
`Set Variable [ $buffer[3] ]`. Field IDs returned as `id="0"` — correct, see §1.

**Corrupted:**

| Case | Sent | Returned |
|---|---|---|
| Go to Related Record | `<Option state="True"/>` | `<Option state="False"/>` — boolean inverted |
| Go to Related Record | `<Animation value="ZoomIn"/>` | `<Animation value="SlideFromLeft"/>` — **dropped on emit, defaulted to enum[0] on parse** |
| Go to Related Record | `Styles="3606018"` | `Styles="3222339600"` |
| New Window | `Styles="1076299266"` | `Styles="3221292548"` |
| Show Custom Dialog | 2 input fields | **3** — a phantom empty `<InputField>` fabricated |
| Insert Text | `&#xD;    [ "pologID"` | `&#13;[ "pologID"` — leading indent stripped on bracket lines |
| Insert Text | `epSQLExecute; commit` | `epSQLExecute ; commit` — **their Semicolon Rule applied to prose inside a literal** |

The `Animation` case is the sharpest: never present in the `.fmscript` text, so on the way back there
was nothing to read and it defaulted to the first enum value. You get a different animation that looks
deliberate. No error, no empty value.

**Crash:** a `]` inside a string literal (`"… Status <> ']' "`) closed the bracket group early and
orphaned the next line. Their README names the mechanism: *"multi-line step handling via a
**bracket-depth parser**."* Trigger frequency in our corpus: `"[]"` (58 scripts), `"[+]"` (28) — the
`JSONSetElement` array-append idiom. Any script building a JSON array breaks it.

## 6. ai2fm cannot resolve schema, and fabricates instead

`<Layout id="171" name="Invoices"/>` rendered as `Using layout: "Invoices" (Invoices)`. Layout 171's
actual base TO is **`I__INVOICES`**. With no solution context they had nothing to resolve from, so
they echoed the layout name into the TO slot — a plausible wrong value rather than an omission.
The same layout renders as `("Invoices")` in one step and `(Invoices)` in another.

Combined with §4: a fabricated TO name reaching FileMaker becomes a silent mis-bind, because
FileMaker will not report an unresolvable name either.

`CONTEXT.json` plus `fields.index` / `scripts.index` / `layouts.index` answer this in one grep.
This is the one capability ai2fm structurally cannot match, and it is the argument for building.

## 7. Standing decisions

- **Format carries names only.** No IDs, no binding frontmatter. §1 settles it.
- **No opaque escape hatch needed** for find requests / sort lists — §3 shows they are expressible.
  Reserve the idea for genuinely opaque state (print setup blobs) if any turns up.
- **Conform to `.fmscript` surface grammar where it is free** (bracket/semicolon/comment
  conventions). Note that fmscript.org publishes six prose rules and defers the normative step
  dictionary to the proprietary compiler; there is no RFC and no conformance fixtures yet. Their own
  `Sort Records` output emits two bracket groups, violating their published Bracket Rule.
- **Adopt their comment convention.** `#` comment step, `#>` continuation, `//` disabled. This
  resolves our blank-line ambiguity, where a blank line and an empty comment step are
  indistinguishable. Comments never take a heredoc — they have no bracket group to attach one to.
- **Heredoc for multi-line text params; quoted inline for single-line.** Not a general rule: it fires
  on 70 of 13,119 instances (0.5%), so readability is untouched, while covering exactly the 24
  multi-line `Insert Text` steps that contain quotes. Verbatim `<<`, never squiggly `<<~` —
  indent-stripping is a guess, and it is precisely ai2fm's corruption (§5). Full rules in
  `TextLayer_HRGaps.md` §P0.

  Rationale beyond fidelity: inside a heredoc the lexer scans raw to the terminator, so the hardest
  content becomes the easiest to parse. Also note the current ` | ` collapse is **ambiguous, not just
  lossy** — 36 of 444 scripts already contain ` | ` in their text, one `$README` block using it as a
  parameter separator. A pipe-separated doc block and a CR-separated one render identically today.
- **Parse what's code, quote what's data.** Text params are opaque payloads — heredoc them, never
  interpret them. Calculations are code we want lexed and validated (FMLint already does), so they
  stay inline. Heredoc'ing calcs would hide 3,900 `Set Variable` bodies from our own validator.
- **Write a real lexer, not a character scanner.** Tokenize strings (with escapes), block comments,
  line comments, and brackets as distinct token types, *then* count depth. This kills both our `\"`
  bug and their `]`-in-string bug as a class. Retrofitting it onto `hr_parser.py` is the same work as
  building it for the compiler. **Heredoc does not remove this requirement** — `"[+]"` in a
  single-line calc still breaks bracket-depth. Heredoc kills multi-line complexity; the lexer kills
  string-literal complexity.
- **Fail loud.** §4.

## 8. Conformance harness

444 matched pairs exist in `agent/xml_parsed/` (`scripts_sanitized/Autoklinika` + `scripts/Autoklinika`),
giving a no-FileMaker-required regression suite: SaXML → snippet → text → snippet′, diffed against
snippet. Normalise `id` attributes away in the diff — §1 says they are FileMaker's to assign.

**Assert step count in == step count out as a precondition, before comparing any content.** §4a is the
reason: a single unbalanced bracket silently merges following steps into the current one, and a
per-step content comparison over the survivors will find nothing wrong with them. The harness would
inherit the exact failure it exists to catch. Count first, then compare.

Caveat: leg one (`fm_xml_to_snippet.py`) is itself partial — `XML_TRANSFORMATION.md` shows 49 ✅ vs
159 ⬜, and unhandled steps emit a TODO comment plus a warning. The harness must report per-leg
results so a leg-one gap does not read as a text-layer bug.

Scoping: the corpus uses **101 distinct step types across 13,119 instances**, and the distribution is
a hard power law — 8 step types cover 83% of real code, 25 cover 97%. The 214-step catalog is not the
target; 25 steps is.
