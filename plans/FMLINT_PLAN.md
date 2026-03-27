# FMLint — FileMaker Code Linter

## Context

The agentic-fm project has validation logic scattered across three places: `validate_snippet.py` (9 XML checks), `diagnostics.ts` (3 real-time HR checks), and `hr-to-xml.ts` (conversion errors). Coding conventions in `CODING_CONVENTIONS.md` are only partially enforced. There is no calculation validation against a live FileMaker engine.

FMLint consolidates all of this into a single rule-based linter that works across both fmxmlsnippet XML and human-readable (HR) formats, is usable by both humans and agents, and is architecturally separable from agentic-fm.

---

## Package Structure

```
agent/fmlint/
├── __init__.py              # Exports: lint(), LintResult, Diagnostic, Severity
├── __main__.py              # CLI entry: python3 -m agent.fmlint
├── engine.py                # Rule registry, runner, tier detection
├── types.py                 # Diagnostic, Severity, LintResult, ParsedHRLine dataclasses
├── config.py                # Rule configuration (enable/disable, severity overrides)
├── context.py               # CONTEXT.json + index file loader
├── catalog.py               # Step catalog lazy loader (grep-style, never full read)
├── formats/
│   ├── __init__.py
│   ├── detect.py            # Auto-detect XML vs HR from content
│   ├── xml_parser.py        # XML parsing → normalized step list
│   └── hr_parser.py         # HR text parsing → ParsedHRLine list
├── rules/
│   ├── __init__.py          # Auto-imports all rule modules, populates registry
│   ├── structure.py         # S001–S011: XML well-formedness, block pairing, step attrs
│   ├── naming.py            # N001–N007: variable naming, operators, formatting
│   ├── documentation.py     # D001–D003: PURPOSE comment, $README blocks
│   ├── references.py        # R001–R009: field/layout/script cross-validation
│   ├── calculations.py      # C001–C003: unclosed strings, unbalanced parens, known functions
│   ├── best_practices.py    # B001–B005: error capture patterns, no ternary, etc.
│   └── live_eval.py         # C004–C005: AGFMEvaluation via OData (tier 3 only)
└── pyproject.toml           # Makes fmlint pip-installable for standalone extraction

webviewer/src/linter/
├── index.ts                 # Exports: createLinter(), LintResult
├── engine.ts                # Rule runner (mirrors Python engine)
├── types.ts                 # Diagnostic types (mirrors Python types.py)
├── config.ts                # Rule enable/disable
├── rules/
│   ├── structure.ts         # S005–S008 (block pairing, known steps)
│   ├── naming.ts            # N001–N002 (operators, variable naming)
│   ├── calculations.ts      # C001–C002 (unclosed strings, unbalanced parens)
│   └── documentation.ts     # D001 (PURPOSE comment)
└── diagnostics-adapter.ts   # Bridges linter output → Monaco IMarkerData
```

**Key design decisions:**
- Python side: stdlib only (no pip deps) — hard project rule
- TypeScript side: tier 1 rules only (instant feedback in Monaco); tiers 2–3 delegate to Python via `/lint` endpoint
- Both sides share identical `Diagnostic` shape so results are interchangeable
- `agent/fmlint/` imports nothing from `agent/scripts/` or `webviewer/` — only reads catalog JSON and CONTEXT.json via configurable paths

---

## Core Architecture

### Diagnostic Type

```python
@dataclass
class Diagnostic:
    rule_id: str           # "S001", "N003", "R002", etc.
    severity: Severity     # error | warning | info | hint
    message: str
    line: int              # 1-based (0 = file-level)
    column: int            # 1-based (0 = whole line)
    end_line: int
    end_column: int
    fix_hint: str | None   # Optional suggested fix

class Severity(Enum):
    ERROR = "error"        # Will break in FileMaker
    WARNING = "warning"    # Likely bug or convention violation
    INFO = "info"          # Style suggestion
    HINT = "hint"          # Optional improvement
```

### Rule Interface

```python
class LintRule(ABC):
    rule_id: str
    name: str
    category: str
    default_severity: Severity
    formats: set[str]      # {"xml"}, {"hr"}, or {"xml", "hr"}
    tier: int              # 1=offline, 2=context, 3=live FM

    def check_xml(self, steps, ctx) -> list[Diagnostic]: ...
    def check_hr(self, lines, ctx) -> list[Diagnostic]: ...
```

Rules declare which formats they support. The engine calls the appropriate method. Rules self-register via decorator; `rules/__init__.py` imports all modules to trigger registration.

### Progressive Enhancement Tiers

| Tier | Available When | Rules | Data Needed |
|------|---------------|-------|-------------|
| **1 — Offline** | Always | S001–S011, N001–N007, D001–D003, B001–B005, C001–C003 | Step catalog only |
| **2 — Context** | CONTEXT.json or index files present | + R001–R009 | CONTEXT.json and/or `context/{solution}/*.index` |
| **3 — Live FM** | OData configured + FMS reachable | + C004–C005 | `automation.json` OData credentials |

Auto-detection: engine checks for OData connectivity → CONTEXT.json → index files → falls back to tier 1.

---

## Rule Taxonomy

### S: Structure (tier 1)

| ID | Name | Formats | Sev | What It Checks |
|----|------|---------|-----|----------------|
| S001 | well-formed-xml | xml | error | XML parses without error |
| S002 | correct-root | xml | error | Root is `<fmxmlsnippet type="FMObjectList">` |
| S003 | no-script-wrapper | xml | error | No `<Script>` tags wrapping steps |
| S004 | step-attributes | xml | error | Every `<Step>` has enable, id, name |
| S005 | paired-blocks | xml, hr | error | If/End If, Loop/End Loop, Transaction balanced |
| S006 | else-ordering | xml, hr | error | Else If before Else; no duplicate Else |
| S007 | inner-step-context | xml, hr | error | Exit Loop If inside Loop; Else inside If |
| S008 | known-step-name | xml, hr | warning | Step name exists in step catalog |
| S009 | self-closing-match | xml | warning | Matches catalog's selfClosing flag |
| S010 | empty-script | xml, hr | info | File contains no steps |
| S011 | xml-comments | xml | warning | XML comments detected (FM silently discards) |

### N: Naming & Conventions (tier 1)

| ID | Name | Formats | Sev | What It Checks |
|----|------|---------|-----|----------------|
| N001 | unicode-operators | xml, hr | warning | `≠ ≤ ≥` not `<> <= >=` in calcs |
| N002 | variable-naming | xml, hr | warning | `$camelCase`, `$$ALL_CAPS`, `~camelCase`, `$$~ALL_CAPS` |
| N003 | boolean-var-naming | xml, hr | info | Boolean vars use `$isX`, `~hasY` |
| N004 | hard-tabs-in-calcs | xml | warning | CDATA calcs use tabs not spaces |
| N005 | function-spacing | xml, hr | info | Space after semicolons in function calls |
| N006 | no-alignment-padding | xml, hr | hint | No extra spaces for column alignment |
| N007 | let-formatting | xml, hr | info | Let() brackets on own lines |

### D: Documentation (tier 1)

| ID | Name | Formats | Sev | What It Checks |
|----|------|---------|-----|----------------|
| D001 | purpose-comment | xml, hr | warning | First step is `# PURPOSE: ...` |
| D002 | readme-block | xml, hr | info | Parameterized scripts have $README doc block |
| D003 | section-separation | xml, hr | info | Logical sections separated by blank comments |

### R: References (tier 2)

| ID | Name | Formats | Sev | What It Checks |
|----|------|---------|-----|----------------|
| R001 | field-exists | xml, hr | warning | Field name found in context/index |
| R002 | field-id-match | xml | warning | Field ID matches CONTEXT.json |
| R003 | layout-exists | xml, hr | warning | Layout name found in context/index |
| R004 | layout-id-match | xml | warning | Layout ID matches CONTEXT.json |
| R005 | script-exists | xml, hr | warning | Script name found in context/index |
| R006 | script-id-match | xml | warning | Script ID matches CONTEXT.json |
| R007 | table-occurrence | xml, hr | warning | TO name is valid |
| R008 | context-staleness | xml, hr | warning | CONTEXT.json > 60 min old |
| R009 | scope-mismatch | xml, hr | info | References outside CONTEXT.json scope |

### B: Best Practices (tier 1)

| ID | Name | Formats | Sev | What It Checks |
|----|------|---------|-----|----------------|
| B001 | error-capture-paired | xml, hr | warning | Set Error Capture [On] followed by error check |
| B002 | commit-before-nav | xml, hr | info | Commit Records before Go to Layout |
| B003 | param-validation | xml, hr | info | Scripts reading ScriptParameter should validate |
| B004 | exit-script-result | xml, hr | info | Scripts should Exit Script with result |
| B005 | no-ternary | xml, hr | error | No `? :` operator (FM doesn't support it) |

### C: Calculations (tier 1 offline + tier 3 live)

| ID | Name | Formats | Sev | What It Checks |
|----|------|---------|-----|----------------|
| C001 | unclosed-string | xml, hr | error | Unclosed `"` in calculation |
| C002 | unbalanced-parens | xml, hr | error | Unbalanced `(` `)` in calculation |
| C003 | known-function | xml, hr | warning | Function name in FM function reference |
| C004 | live-eval-error | xml, hr | error | AGFMEvaluation returns error (tier 3) |
| C005 | live-eval-warning | xml, hr | warning | AGFMEvaluation returns non-fatal issue (tier 3) |

---

## AGFMEvaluation Integration (Tier 3)

This is the agent-specific "gold standard" — calculations are evaluated by the actual FileMaker engine via OData.

**Flow:**
1. Extract all `<Calculation>` CDATA blocks (XML) or bracket expressions (HR)
2. Determine layout context from Go to Layout steps or CONTEXT.json `current_layout`
3. Call AGFMScriptBridge → AGFMEvaluation for each unique expression
4. Map results: `success: false` → C004 error; `success: true` → valid
5. Cache by (expression, layout) to avoid duplicate eval calls

**Safeguards:**
- `live_eval.py` sets `requires_confirmation = True` — engine prompts before OData calls
- Batch + deduplicate calculations to minimize OData round-trips
- Connectivity pre-check: quick AGFMScriptBridge health test before enabling tier 3
- Uses `urllib.request` (stdlib) for HTTP — no external dependencies

**Agent skill integration:** The FMLint skill runs tier 3 when available, presenting findings like:
```
FMLint: 12 calculations validated against live FM engine
  C004 ERROR line 15: Expression invalid — "Get ( CallerScriptName )" → FM error 1204
  C004 ERROR line 28: Field "Invoices::oldField" not found on layout "Invoice Detail"
  ✓ 10 calculations valid
```

---

## Integration Points

### 1. CLI (`python3 -m agent.fmlint`)

```bash
python3 -m agent.fmlint agent/sandbox/MyScript.xml          # single file
python3 -m agent.fmlint agent/sandbox/                       # directory
python3 -m agent.fmlint --format json script.xml             # JSON output
python3 -m agent.fmlint --tier 2 script.xml                  # force tier
python3 -m agent.fmlint --disable N003,D002 script.xml       # skip rules
python3 -m agent.fmlint --hr script.fmscript                 # force HR format
```

Exit codes: 0 = clean, 1 = errors, 2 = warnings only.

### 2. Agent Skill (`.claude/skills/fmlint/SKILL.md`)

Replaces steps 6–7 in CLAUDE.md's "Script creation" workflow. Runs `python3 -m agent.fmlint --format json` after generation, parses results, fixes issues before presenting to developer.

### 3. Monaco Diagnostics (`webviewer/src/linter/diagnostics-adapter.ts`)

Replaces current `diagnostics.ts`. Client-side TypeScript linter handles tier 1 rules for instant feedback (debounced 300ms). For tier 2–3, calls `POST /lint` on companion server.

### 4. Companion Server (`POST /lint`)

New endpoint on `companion_server.py`. Accepts `{ content, format, tier, rules }`, runs Python linter, returns diagnostics as JSON. Enables the webviewer to access full tier 2–3 validation.

### 5. validate_snippet.py (backward compat shim)

Becomes a thin wrapper importing `agent.fmlint`. Same CLI interface and exit codes preserved. Eventually deprecated.

### 6. Claude Code Hook (optional future)

A settings.json hook that runs `python3 -m agent.fmlint` on any file written to `agent/sandbox/`, surfacing diagnostics automatically.

---

## Extraction Strategy

For standalone use outside agentic-fm:

- **Zero deps**: Core engine + tier 1 rules use Python stdlib only
- **Catalog as data**: `step-catalog-en.json` is the only required data file — it's FM-generic, not agentic-fm-specific
- **Injected paths**: `context.py` and `catalog.py` accept configurable paths; default to agentic-fm layout but overridable
- **No inward imports**: `agent/fmlint/` never imports from `agent/scripts/`, `agent/docs/`, or `webviewer/`
- **npm package potential**: `webviewer/src/linter/` could publish as `@agentic-fm/fmlint` with bundled catalog

---

## Migration Path

### Phase 1: Core Engine + Port Existing Rules
- Create `agent/fmlint/` package skeleton: `types.py`, `engine.py`, `config.py`, `catalog.py`
- Build `formats/xml_parser.py` (extract from validate_snippet.py)
- Port validate_snippet.py checks → rules: S001–S008, N001–N002, R001–R009, R008
- `__main__.py` CLI with same output format as validate_snippet.py
- Verify: run both old and new on same files, results should match

### Phase 2: HR Parser + New Rules
- Build `formats/hr_parser.py` (Python port of webviewer parser.ts concepts)
- Add dual-format support to S005–S008, N001–N002
- Add new rules: D001–D003, B001–B005, C001–C003, N003–N007
- `formats/detect.py` auto-detection

### Phase 3: Integrate + Replace
- Make validate_snippet.py a thin shim over `agent.fmlint`
- Add `POST /lint` to companion_server.py
- Create `.claude/skills/fmlint/SKILL.md`
- Update CLAUDE.md script creation workflow

### Phase 4: Live Eval + TypeScript
- Implement `live_eval.py` (C004–C005) with OData integration
- Build `webviewer/src/linter/` TypeScript package
- Replace `diagnostics.ts` with `diagnostics-adapter.ts`
- Wire webviewer to call `/lint` for tier 2–3

---

## Verification

After each phase:
1. **Phase 1**: Run `python3 -m agent.fmlint agent/sandbox/` on existing sandbox files; compare output with `python3 agent/scripts/validate_snippet.py` — should flag the same issues
2. **Phase 2**: Create test HR scripts with known issues (unmatched If, bad variable names, missing PURPOSE); verify all flagged
3. **Phase 3**: Run the full script creation workflow end-to-end (create script → fmlint validates → deploy); verify validate_snippet.py shim still works
4. **Phase 4**: With OData connected, validate a script containing an intentionally invalid calculation; verify C004 fires with the FM engine error message. In webviewer, verify Monaco markers appear for tier 1 rules in real-time

---

## Critical Files

| File | Role |
|------|------|
| `agent/scripts/validate_snippet.py` | Primary source to port (9 checks, stack algorithm, context loading) |
| `webviewer/src/editor/language/diagnostics.ts` | TypeScript diagnostics to replace |
| `webviewer/src/converter/parser.ts` | Reference for HR parser (ParsedLine interface) |
| `agent/docs/CODING_CONVENTIONS.md` | Authoritative rule definitions for N and D categories |
| `agent/catalogs/step-catalog-en.json` | Canonical step reference (never read fully — grep only) |
| `agent/scripts/companion_server.py` | Integration target for `/lint` endpoint |
| `agent/docs/SCHEMA_GUIDANCE.md` | XML emission rules for validation logic |
