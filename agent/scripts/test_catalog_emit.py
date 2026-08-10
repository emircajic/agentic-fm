#!/usr/bin/env python3
"""test_catalog_emit.py — gate the P6.4 emit engine against the reference fixtures.

``catalog_emit.py`` is a faithful port of the reference HR→fmxmlsnippet emit path and a
line-for-line counterpart of the shipped TS ``catalog-emit.ts``. Since no C++ reference
converter exists for the SaXML direction (P6.4's defining constraint), the emitter is
gated the same way the TS port was: byte-identity against the committed
``webviewer/test/fixtures/hr-to-xml.json`` — the reference ``/api/hr-to-xml`` output.

For each corpus step: parse the fixture HR into bracket params, run
``match_param_values`` → ``convert_step_with_catalog`` (empty-context resolver → the
``id="0"`` name-only refs the fixtures use), and assert the emitted ``<Step>`` block is
byte-identical to the fixture's XML. Control-flow steps (hand-coded, not the engine's
job) and the 3 FM26-AI grammar-gap steps are excluded — mirroring the TS routing.

Run: ``uvx pytest agent/scripts/test_catalog_emit.py`` (stdlib + pytest only).
"""

from __future__ import annotations

import json
import os
import re

from catalog_emit import (
    EmptyResolver,
    convert_step_with_catalog,
    esc_xml,
    match_param_values,
)
from catalog_grammar import load_catalog

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(os.path.dirname(_HERE))
_CATALOG = os.path.join(_REPO, "agent", "catalogs", "step-catalog-en.json")
_FIXTURES = os.path.join(_REPO, "webviewer", "test", "fixtures", "hr-to-xml.json")

# Control-flow steps are hand-coded in the converters (the sanctioned exception), not
# rendered by the engine — exactly as catalog-converter.ts routes them to control.ts.
CONTROL_FLOW = {
    "# (comment)", "If", "Else If", "Else", "End If",
    "Loop", "Exit Loop If", "End Loop", "Exit Script", "Set Variable",
}
# The 3 FM26-AI grammar-gap steps stay excluded from every gate (plan §"known gap").
FM26_AI_SKIP = {"Fine-Tune Model", "Generate Response from Model", "Install Menu Set"}


# --- minimal HR line parser (port of parser.ts parseLine + splitParams) ---------
def _find_top_level_bracket(text: str) -> int:
    in_quote = False
    for i, c in enumerate(text):
        if c == '"':
            in_quote = not in_quote
        if not in_quote and c == "[":
            return i
    return -1


def _find_matching_bracket(text: str, open_idx: int) -> int:
    depth = 0
    in_quote = False
    for i in range(open_idx, len(text)):
        c = text[i]
        if c == '"':
            in_quote = not in_quote
        if in_quote:
            continue
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return i
    return -1


def _split_params(content: str) -> list[str]:
    params: list[str] = []
    cur = ""
    in_quote = False
    paren = bracket = 0
    for c in content:
        if c == '"':
            in_quote = not in_quote
            cur += c
            continue
        if in_quote:
            cur += c
            continue
        if c == "(":
            paren += 1
        elif c == ")":
            paren -= 1
        elif c == "[":
            bracket += 1
        elif c == "]":
            bracket -= 1
        if c == ";" and paren == 0 and bracket == 0:
            params.append(cur.strip())
            cur = ""
            continue
        cur += c
    if cur.strip():
        params.append(cur.strip())
    return params


def _parse_hr_line(raw: str) -> tuple[bool, str, list[str]]:
    trimmed = raw.lstrip()
    if not trimmed.strip():
        return (False, "", [])
    if trimmed.startswith("#"):
        return (False, "# (comment)", [])
    disabled = False
    work = trimmed
    if trimmed.startswith("//"):
        disabled = True
        work = trimmed[2:].strip()
    bi = _find_top_level_bracket(work)
    if bi < 0:
        return (disabled, work.strip(), [])
    step_name = work[:bi].strip()
    close = _find_matching_bracket(work, bi)
    content = work[bi + 1 : close].strip() if close >= 0 else work[bi + 1 :].strip()
    return (disabled, step_name, _split_params(content))


def _extract_step_block(xml: str) -> str | None:
    m = re.search(r"^  <Step\b.*?</Step>", xml, re.DOTALL | re.MULTILINE)
    if m:
        return m.group(0)
    m = re.search(r"^  <Step\b[^>]*/>", xml, re.MULTILINE)
    return m.group(0) if m else None


def _emit_self_close(entry, disabled: bool) -> str:
    step_id = entry.id if entry.id is not None else 0
    return (
        '  <Step enable="'
        + ("False" if disabled else "True")
        + f'" id="{step_id}" name="'
        + esc_xml(entry.name)
        + '"/>'
    )


def _load():
    catalog = load_catalog(_CATALOG)
    by_name = {e.name: e for e in catalog}
    for e in catalog:  # trim-tolerant: the one trailing-space name "Configure RAG Account "
        by_name.setdefault(e.name.strip(), e)
    with open(_FIXTURES, encoding="utf-8") as fh:
        fixtures = json.load(fh)
    return by_name, fixtures


def test_emit_byte_identical_to_reference():
    """Every non-control corpus step emits byte-identically to /api/hr-to-xml."""
    by_name, fixtures = _load()
    resolver = EmptyResolver()
    checked = 0
    mismatches: list[str] = []

    for relpath in sorted(fixtures):
        hr = fixtures[relpath]["hr"]
        xml = fixtures[relpath]["xml"]
        disabled, step_name, params = _parse_hr_line(hr)
        if step_name in CONTROL_FLOW or step_name in FM26_AI_SKIP:
            continue
        entry = by_name.get(step_name)
        assert entry is not None, f"{relpath}: no catalog entry for {step_name!r}"

        if entry.self_closing and not entry.params:
            got = _emit_self_close(entry, disabled)
        else:
            values = match_param_values(entry, params)
            got = convert_step_with_catalog(entry, disabled, values, resolver)
        want = _extract_step_block(xml)
        checked += 1
        if got != want:
            mismatches.append(f"{relpath} ({step_name})")

    assert not mismatches, f"{len(mismatches)} emit mismatches: {mismatches[:10]}"
    # Guard against the corpus silently shrinking (203 engine steps at time of writing).
    assert checked >= 200, f"only {checked} engine steps checked — corpus shrank?"
