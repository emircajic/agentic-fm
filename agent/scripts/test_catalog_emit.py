#!/usr/bin/env python3
"""test_catalog_emit.py — gate the P6.4 emit engine against the reference fixtures.

``catalog_emit.py`` is a faithful port of the reference HR→fmxmlsnippet emit path and a
line-for-line counterpart of the shipped TS ``catalog-emit.ts``. Since the reference
converter has no SaXML direction (P6.4's defining constraint), the emitter is
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


# ---------------------------------------------------------------------------
# Governed-visibility boolean — the hrHidden gate derived on emit.
#
# The facet: an ``hrHidden`` boolean that a sibling's ``visibleWhen`` gates on
# carries no HR token of its own, so HR→XML must DERIVE its state from whether a
# gated companion contributed a token. Letting ``defaultValue`` answer instead
# turns "no stored import order" into "restore the stored order" on every
# round-trip — and FileMaker obeys that flag, discarding what it gated.
#
# The byte-identity gate above cannot catch a regression here: every corpus step
# carrying one of these gates also carries its companion, so the derived value
# and the catalog default agree. Only the companion-absent case separates them.
#
# Mirrors webviewer/test/catalog-emit.engine.test.ts (tests 1-3) — test 4 is
# Python-only because the SaXML reader is.
# ---------------------------------------------------------------------------
def _emit_hr(by_name, hr: str) -> str:
    """HR line -> emitted <Step> block, context-free (the fixtures' id="0" shape)."""
    _disabled, step_name, params = _parse_hr_line(hr)
    entry = by_name[step_name]
    values = match_param_values(entry, params)
    return convert_step_with_catalog(entry, False, values, EmptyResolver())


def test_governed_visibility_derives_gate_open_from_companion():
    """A companion token present => the gate serializes the gate-open value."""
    by_name, _ = _load()
    assert '<Restore state="True"/>' in _emit_hr(
        by_name, "Import Records [ Table: Customers ]")
    assert '<Restore state="True"/>' in _emit_hr(
        by_name, "Export Records [ Export options: CharacterSet=UTF-8 ]")


def test_governed_visibility_derives_gate_closed_not_default_value():
    """No companion token => the closed value, NOT the catalog default of True."""
    by_name, _ = _load()
    assert '<Restore state="False"/>' in _emit_hr(
        by_name, "Import Records [ Import fields: Customers::Name ]")
    assert '<Restore state="False"/>' in _emit_hr(
        by_name, "Export Records [ Create folders: On ]")


def test_governed_visibility_survives_xml_hr_xml_round_trip():
    """The gate carries no HR token — only the companions can preserve it."""
    from snippet_to_hr import snippet_to_hr

    by_name, _ = _load()
    head = ('<fmxmlsnippet type="FMObjectList">'
            '<Step enable="True" id="35" name="Import Records">')
    tail = ('<ImportOptions CharacterSet="UTF-8" method="Add"/>'
            '<Table id="7" name="Customers"/></Step></fmxmlsnippet>')
    for state in ("True", "False"):
        hr = "\n".join(snippet_to_hr(f'{head}<Restore state="{state}"/>{tail}'))
        assert f'<Restore state="{state}"/>' in _emit_hr(by_name, hr), state


def test_hr_hidden_without_gating_sibling_keeps_catalog_default():
    """The derive rule fires ONLY for a gate something actually gates on."""
    by_name, _ = _load()
    out = _emit_hr(
        by_name, "Insert from URL [ Select ; With dialog: Off ; Target: $file ; $url ]")
    assert '<DontEncodeURL state="False"/>' in out


def test_saxml_reading_of_the_gate_wins_over_the_derived_value():
    """A SaXML decoder that read the gate itself keeps its value — the emitter
    derives only into an EMPTY slot.

    ``convert_step_with_catalog`` has two callers in this repo and one in the
    reference: the SaXML reader feeds it a values[] built from a <Step>, where
    the gate may already carry the source's own reading. Export Records' decoder
    sets Restore explicitly; an unconditional derive would throw that away and
    substitute a value derived from HR semantics that never applied here.
    """
    import xml.etree.ElementTree as ET

    from saxml_read import read_saxml_step

    by_name, _ = _load()
    entry = by_name["Export Records"]
    sample = os.path.join(
        _REPO, "agent", "fixtures", "converter", "saxml", "export-records.xml")
    step_el = ET.parse(sample).getroot().find(".//Step")
    assert step_el is not None

    disabled, values, resolver = read_saxml_step(entry, step_el)
    gi = next(i for i, p in enumerate(entry.params) if p.xml_element == "Restore")
    assert values[gi] == "On", "decoder no longer seeds Restore — test premise stale"

    out = convert_step_with_catalog(entry, disabled, values, resolver)
    assert '<Restore state="True"/>' in out

    # And the guard is load-bearing: with the decoder's reading blanked, the
    # derive takes over rather than the slot silently emitting a default.
    values[gi] = ""
    blanked = convert_step_with_catalog(entry, disabled, values, resolver)
    assert '<Restore state="True"/>' in blanked  # this sample DOES carry ExportOptions
