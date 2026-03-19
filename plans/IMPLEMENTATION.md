# Gradual Implementation Plan

How to execute the agentic-fm build phases using a sequential, confidence-building approach. Each phase validates the workflow before the next scales up.

---

## Dependency graph

```
Prerequisites (Snapshot Testing)
        │
   Phase 1 (Multi-Script) ← proof-of-concept
        │
   Phase 2 (Script Tooling)
        │
   Phase 3a (Layout) ──┐
                        ├── parallel pair
   Phase 3b (OData)  ──┘
        │
   Phase 4 (Data Tooling) ← depends on Phase 3b
```

---

## Execution approach

The original plan called for 5 agents running in parallel from day one. This revision takes a gradual approach:

1. **Prove the workflow** with a single low-risk phase (Phase 1)
2. **Expand incrementally** — one phase at a time, then a parallel pair
3. **Defer ambitious orchestration** — solution-level and migration skills are future potential
4. **Validate continuously** — snapshot tests gate every merge; FM paste-testing confirms final output

This reduces coordination overhead, surfaces process issues early, and builds confidence before scaling up.

---

## Prerequisites

These must be in place before Phase 1 begins.

### 1. Snapshot testing infrastructure

Establish a lightweight test harness before any agent produces skill files:

- Compare generated fmxmlsnippet output against known-good snapshot files
- Integrate with `validate_snippet.py` as a baseline structural check
- Cover each step type used by existing skills
- Run as a pre-merge gate for every phase branch

This replaces FileMaker paste-testing as the primary development-time validation. FM paste-testing remains the final validation step before merge.

### 2. `plans/SKILL_INTERFACES.md` is final

Every agent reads this before authoring any skill that calls or is called by another skill. The interface contracts (inputs, outputs, calls, called-by) define the seams between skills.

### 3. Deployment module built

The pluggable deployment module (`agent/scripts/deploy.py` or similar) must exist before Phase 1. It dispatches fmxmlsnippet output through the appropriate automation tier:

- **Tier 1** (universal): `clipboard.py write` + paste instructions to developer
- **Tier 2** (MBS Plugin, macOS): auto-paste into existing scripts via MBS ScriptWorkspace functions
- **Tier 3** (MBS + AppleScript, macOS): create scripts via Accessibility UI automation, then auto-paste via MBS

The module detects available capabilities at runtime and reads the developer's opt-in preference from `agent/config/automation.json`. Every skill calls it after validation; no skill hardcodes a deployment tier. See `VISION.md` → Automation Tiers for the full design.

### 4. Shared infrastructure is locked

The following files must not be modified by any agent without coordinator approval:
- `agent/scripts/clipboard.py`
- `agent/scripts/validate_snippet.py`
- `agent/scripts/deploy.py` (deployment module)
- `agent/catalogs/step-catalog-en.json`
- `.claude/CLAUDE.md`
- Companion server endpoints

### 5. Webviewer output channel is wired

Every skill that produces HR output uses this channel. Build it before the first HR-output skill ships so it's never retrofitted. See `PHASES.md` → Webviewer Output Channel for scope.

**Done when**:
- `GET /webviewer/status` and `POST /webviewer/push` endpoints live in companion server
- Webviewer has persistent SSE connection to companion and renders pushed content in Monaco
- `automation.json` includes `webviewer_url`; skills check status before routing

### 6. AGFMEvaluation + snapshot infrastructure is in place

Required before `calc-eval` skill can be used. See `PHASES.md` → AGFMEvaluation + Snapshot for scope.

**Done when**:
- `AGFMEvaluation` FM script installed in solution
- Push Context writes `agent/context/snapshot.xml` and includes `snapshot_path` in CONTEXT.json output
- First reference snapshot confirmed present after a Push Context run

### 7. `fm-debug` skill is stable

Phase 2's `script-test` skill depends on it. Confirm the current `fm-debug` implementation is production-ready before Phase 2 starts.

### 8. Invoice Solution XML is current

Phase 3a (XML2 generation) validates against `xml_parsed/` layout exports. Run `solution-export` to ensure these are up to date before Phase 3a begins.

---

## Execution sequence

### Phase 1 — Multi-Script Scaffold (proof-of-concept)

**Purpose**: Validate the end-to-end workflow — worktree creation, skill authoring, snapshot testing, FM validation, merge — with the lowest-risk phase.

**Setup**:
```bash
git worktree add /worktrees/multi-script -b feature/multi-script
```

**Agent prompt**:
> You are building the `multi-script-scaffold` skill for the agentic-fm project. Read `plans/VISION.md` (Placeholder Technique and Automation Tiers sections), `plans/SKILL_INTERFACES.md`, and existing skill files in `.claude/skills/` for format reference. The skill must integrate with `context-refresh` per the interface spec and use the deployment module (`agent/scripts/deploy.py`) for all output — the developer chooses whether to paste manually (Tier 1), have MBS auto-paste (Tier 2), or run fully autonomous with script creation + auto-paste (Tier 3). Note: FileMaker names all new scripts `New Script` — the skill must instruct the developer to rename placeholders to their final names **before** running Push Context. Test against a 3-script and a 5-script interdependent scenario. Do not modify shared infrastructure files.

**Done when**:
- Skill file passes snapshot tests
- Generated fmxmlsnippet validates via `validate_snippet.py`
- Tier 1: FM paste-test confirms correct script wiring
- Tier 2/3 (if available): automated paste + read-back verification succeeds
- Branch merged to main

**Retrospective**: After merge, assess what worked and what to adjust before Phase 2.

---

### Phase 2 — Script Tooling

**Purpose**: Expand the core script development capabilities with four complementary skills.

**Setup**:
```bash
git worktree add /worktrees/script-tooling -b feature/script-tooling
```

**Agent prompt**:
> You are building the script tooling skills for the agentic-fm project. Your scope is: `script-refactor`, `script-test`, `script-debug`, and `implementation-plan`. Read `plans/VISION.md` (Skills section), `plans/SKILL_INTERFACES.md`, and existing skill files for format reference. `script-test` must use `fm-debug` per the interface spec. Do not modify shared infrastructure files.

**Done when**:
- All four skill files pass snapshot tests
- `script-test` companion scripts validate in FM via `fm-debug`
- Branch merged to main

---

### Phase 3 — Layout & OData (parallel pair)

**Purpose**: Two independent workstreams that can run concurrently. This is the first use of parallelism, after the workflow has been proven in Phases 1–2.

**Setup**:
```bash
git worktree add /worktrees/layout-design -b feature/layout-design
git worktree add /worktrees/schema-tooling -b feature/schema-tooling
```

**Agent prompt (3a — Layout & XML2)**:
> You are building the layout skills for the agentic-fm project. Your scope is: `layout-design`, `layout-spec`, and `webviewer-build`. Read `plans/VISION.md` (Layout Objects section and Tooling Infrastructure → Layout Object Reference), `plans/SKILL_INTERFACES.md`, and existing skill files for format reference. Validate XML2 output against `agent/xml_parsed/` layout exports. Do not modify shared infrastructure files.

**Agent prompt (3b — OData Schema)**:
> You are building the schema tooling skills for the agentic-fm project. Your scope is: `schema-plan` and `schema-build` (a single skill covering OData connection, table/field creation, and relationship specification). Read `plans/VISION.md` (API-Managed Schema section), `plans/SKILL_INTERFACES.md`, and existing skill files for format reference. Document OData field type mappings. Do not modify shared infrastructure files.

**Done when**:
- Layout: XML2 objects paste correctly into FM Layout Mode
- OData: Tables and fields created successfully via OData against a live FM Server
- Both branches merged to main

---

### Phase 4 — Data Tooling

**Purpose**: Complete the data lifecycle — seed and migrate records via OData.

**Depends on**: Phase 3b merged (OData connectivity proven).

**Setup**:
```bash
git worktree add /worktrees/data-tooling -b feature/data-tooling
```

**Agent prompt**:
> You are building the data tooling skills for the agentic-fm project. Your scope is: `data-seed` and `data-migrate`. Read `plans/VISION.md` (Skills → Data section), `plans/SKILL_INTERFACES.md`, and existing skill files for format reference. Both skills require OData connectivity — reference the `schema-build` skill for connection patterns. Do not modify shared infrastructure files.

**Done when**:
- Seed data creates realistic records in a live FM solution
- Data migration handles field mapping and type coercion correctly
- Branch merged to main

---

## FM validation

Agents can produce skill files and fmxmlsnippet artifacts autonomously. They cannot validate them in FileMaker. This creates a testing bottleneck.

**Handling it**:
- Snapshot tests are the primary development-time gate — agents don't block on FM validation
- FM validation is batched per phase — paste and verify each artifact as a phase nears completion
- Each agent flags artifacts as ready for FM validation when produced
- The agent continues with non-FM-dependent work (prompt logic, edge cases) rather than blocking

**Validation checklist per skill**:
- [ ] Trigger phrases invoke the skill correctly
- [ ] Generated fmxmlsnippet passes `validate_snippet.py`
- [ ] Generated XML matches snapshot expectations
- [ ] Clipboard write succeeds without corruption
- [ ] Pasted result appears correctly in the target FM workspace
- [ ] Generated FM objects behave as expected at runtime

---

## Merge sequence

Phases merge in order: 1 → 2 → 3a/3b (either order) → 4.

Each merge includes:
1. Snapshot tests pass
2. FM validation checklist complete
3. Skill interfaces match `SKILL_INTERFACES.md` contracts
4. `PHASES.md` status updated (`planned` → `merged`)

---

## Coordinator responsibilities

One human should own:

- Approving any proposed changes to locked shared infrastructure files
- Reviewing and merging PRs in sequence
- Running the FM validation queue and unblocking agents when results are ready
- Updating `plans/PHASES.md` status as work progresses
- Resolving any interface contract disagreements before they diverge
- Conducting a brief retrospective after Phase 1 to adjust process for subsequent phases

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Phase 1 reveals workflow issues | Medium | Low | That's the point — fix process before scaling |
| FM validation bottleneck delays merge | High | Medium | Snapshot tests gate development; FM validation is batched |
| XML2 format assumptions incorrect | Medium | Medium | Phase 3a validates against `xml_parsed/` before finalising |
| OData API behaviour differs from docs | Medium | Medium | Phase 3b documents deviations in `plans/schema/odata-notes.md` |
| `fm-debug` instability blocks Phase 2 | Low | Medium | Confirm fm-debug stability as prerequisite |
| Combined `schema-build` skill too large | Low | Medium | Sub-modes keep concerns separated within one skill file |
