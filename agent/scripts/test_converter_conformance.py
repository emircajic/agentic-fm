#!/usr/bin/env python3
"""test_converter_conformance.py — offline cross-converter conformance gate.

Every converter in this project derives its output from one source of truth: the
step catalog grammar (``agent/catalogs/step-catalog-en.json``). Because a single
catalog or converter edit reshapes all converters at once, this gate freezes the
verified output as golden fixtures and fails the moment any converter drifts from
them — the kind of change that arrives in a pull request.

It runs with **no external services and no private dependencies** — standard
library plus pytest only — so any contributor can run it.

Golden fixtures live in ``agent/fixtures/converter/``:

  - ``xml-to-hr.json``        ``{corpus file -> HR}`` — ``snippet_to_hr`` over the
                              fmxmlsnippet corpus (``agent/snippet_examples/steps``).
  - ``saxml/*.xml``           SaXML input samples, one per step type.
  - ``saxml-to-snippet.json`` ``{sample -> fmxmlsnippet}`` — ``fm_xml_to_snippet``
                              over the samples above.

Three checks:

  1. **XML -> HR** — ``snippet_to_hr`` over the corpus equals ``xml-to-hr.json``.
  2. **SaXML -> fmxmlsnippet** — ``fm_xml_to_snippet`` over ``saxml/*.xml`` equals
     ``saxml-to-snippet.json`` and every result is well-formed XML.
  3. **Cross-converter identity** — the Python XML -> HR output equals the web
     viewer's committed ``webviewer/test/fixtures/xml-to-hr.json`` over the shared
     corpus, i.e. the Python and TypeScript readers stay in lockstep. (The HR ->
     fmxmlsnippet direction is TypeScript-only and is gated by its own vitest suite.)

Regenerate the JSON goldens after a legitimate catalog change::

    python3 agent/scripts/test_converter_conformance.py --bless

Gate::

    uvx pytest agent/scripts/test_converter_conformance.py
"""

from __future__ import annotations

import json
import os
import re
import xml.etree.ElementTree as ET

import fm_xml_to_snippet
from catalog_grammar import load_catalog, param_key
from snippet_to_hr import snippet_to_hr

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(os.path.dirname(_HERE))
_CORPUS = os.path.join(_REPO, "agent", "snippet_examples", "steps")
_FIXTURES = os.path.join(_REPO, "agent", "fixtures", "converter")
_XML_TO_HR = os.path.join(_FIXTURES, "xml-to-hr.json")
_SAXML_DIR = os.path.join(_FIXTURES, "saxml")
_SAXML_UNSUPPORTED_DIR = os.path.join(_FIXTURES, "saxml_unsupported")
_SAXML_PLACEMENT_DIR = os.path.join(_FIXTURES, "saxml_calc_placement")
_SAXML_TO_SNIPPET = os.path.join(_FIXTURES, "saxml-to-snippet.json")
_TS_XML_TO_HR = os.path.join(_REPO, "webviewer", "test", "fixtures", "xml-to-hr.json")

# Explanatory XML comments in the corpus can contain '--', which is not well-formed
# inside an XML comment; strip them before parsing (they are discarded by FileMaker
# on paste anyway).
_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)


def _corpus_files():
    out = []
    for dirpath, _dirs, files in os.walk(_CORPUS):
        for name in files:
            if name.endswith(".xml"):
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, _CORPUS)
                out.append((rel, full))
    out.sort()
    return out


def compute_xml_to_hr():
    """{corpus relpath -> HR text} from the fmxmlsnippet -> HR converter."""
    result = {}
    for rel, full in _corpus_files():
        with open(full, encoding="utf-8") as fh:
            xml = _COMMENT.sub("", fh.read())
        result[rel.replace(os.sep, "/")] = "\n".join(snippet_to_hr(xml))
    return result


def compute_saxml_to_snippet():
    """{sample filename -> fmxmlsnippet} from the SaXML -> fmxmlsnippet converter."""
    result = {}
    for name in sorted(os.listdir(_SAXML_DIR)):
        if not name.endswith(".xml"):
            continue
        stats = {"unknown": 0, "unsupported": 0}
        result[name] = fm_xml_to_snippet.translate_script(
            os.path.join(_SAXML_DIR, name), stats
        )
        assert stats["unknown"] == 0, f"{name}: {stats['unknown']} uncatalogued step(s)"
        assert stats["unsupported"] == 0, f"{name}: {stats['unsupported']} unsupported step(s)"
    return result


def _load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #

def test_xml_to_hr_matches_golden():
    golden = _load(_XML_TO_HR)
    actual = compute_xml_to_hr()
    assert actual == golden, "fmxmlsnippet -> HR output drifted from xml-to-hr.json"


def test_saxml_to_snippet_matches_golden():
    golden = _load(_SAXML_TO_SNIPPET)
    actual = compute_saxml_to_snippet()
    assert set(actual) == set(golden), "SaXML sample set drifted from the golden"
    for name, snippet in actual.items():
        ET.fromstring(snippet)  # well-formed
        assert snippet == golden[name], f"{name}: SaXML -> fmxmlsnippet output drifted"


_MARKER = re.compile(r"CP\d+_([A-Za-z0-9]+)")

# Steps whose calcs reach the right param but are then dropped by the emitter, because
# the reader reads their governing enum positionally and FileMaker exports it out of
# catalog order. Placement is not the defect here; enum matching is.
_PLACEMENT_KNOWN_GAPS = {"Perform RAG Action", "Set Web Viewer"}


def test_saxml_calc_placement():
    """Every calculation must reach the param it was ENTERED into, by value.

    The other SaXML tests compare output to a golden, which cannot see this class of
    defect: reading calcs positionally emits a well-formed, confident document no
    matter which param each one lands on, so a golden generated from a misplaced read
    is stable and green forever.

    ``saxml_calc_placement/`` holds FileMaker's own export of a script in which every
    calculation holds a literal naming the param it belongs to, so the check is direct:
    find each literal in the emitted fmxmlsnippet and assert it sits under that param's
    element. A step the reader refuses outright is allowed — refusing is the documented
    answer to a shape it cannot place — but placing a value on the wrong param is not.

    ``_PLACEMENT_KNOWN_GAPS`` names the steps whose calcs are placed correctly and then
    lost further down, because the reader still matches ENUMS positionally: FileMaker
    exports Perform RAG Action's data source ahead of its action, the two swap, and the
    emitter drops every param the (now wrong) branch would have revealed. The list is
    asserted, not skipped — a step that leaves it, or joins it, fails here.
    """
    catalog = {e.name: e for e in load_catalog(fm_xml_to_snippet._find_catalog())}
    calc_types = {"calculation", "calc", "namedCalc"}
    names = sorted(n for n in os.listdir(_SAXML_PLACEMENT_DIR) if n.endswith(".xml"))
    assert names, "no calc-placement fixtures found"

    checked = 0
    gaps_seen: set[str] = set()
    for name in names:
        root = ET.parse(os.path.join(_SAXML_PLACEMENT_DIR, name)).getroot()
        for step in root.findall("ObjectList/Step"):
            entry = catalog.get(step.get("name"))
            if entry is None:
                continue
            present = set(_MARKER.findall(ET.tostring(step, encoding="unicode")))
            if not present:
                continue
            stats = {"unknown": 0, "unsupported": 0}
            emitted = fm_xml_to_snippet.tx_engine(step, stats)
            if stats["unsupported"]:
                continue                      # refused as a whole — covered elsewhere
            tree = ET.fromstring("<w>" + emitted + "</w>")
            parents = {c: p for p in tree.iter() for c in p}

            # element path of every marker in the emitted snippet
            where: dict[str, set[str]] = {}
            for el in tree.iter():
                for text in (el.text, el.tail):
                    hit = _MARKER.search(text or "")
                    if hit is None:
                        continue
                    chain, cur = set(), el
                    while cur is not None:
                        chain.add(cur.tag)
                        cur = parents.get(cur)
                    where.setdefault(hit.group(1), set()).update(chain)

            for param in entry.params:
                if param.type not in calc_types:
                    continue
                key = re.sub(r"[^A-Za-z0-9]", "", param_key(param))
                if key not in present:
                    continue                  # FileMaker did not export this one
                want = param.wrapper_element or param.xml_element
                got = where.get(key)
                if got is None:
                    assert entry.name in _PLACEMENT_KNOWN_GAPS, (
                        f"{entry.name}: {param_key(param)} was exported by FileMaker as "
                        f"{key!r} but reached no param — the value was dropped")
                    gaps_seen.add(entry.name)
                    continue
                assert want in got, (
                    f"{entry.name}: {key!r} belongs to {param_key(param)} "
                    f"(<{want}>) but was placed under {sorted(got)}")
                checked += 1

    # a floor, not an exact count: it catches a fixture that lost its steps
    assert checked >= 90, f"only {checked} calc placements checked — fixture shrank?"
    assert gaps_seen == _PLACEMENT_KNOWN_GAPS, (
        "the known-gap list no longer matches reality: "
        f"still dropping {sorted(gaps_seen)}, listed {sorted(_PLACEMENT_KNOWN_GAPS)}")


def test_saxml_unsupported_fixtures_fail_loud():
    """A SaXML shape the reader cannot place must be COUNTED, never guessed at.

    ``agent/fixtures/converter/saxml_unsupported/`` holds real FileMaker exports
    carrying a value the reader cannot attach to any catalog param. Two shapes:

    *A boolean with no param to land on.* ``Revert Transaction``'s Condition / Error
    Code are presence flags for its optional calcs, and ``Print PDF``'s Password / Use
    print options from / Save print options to belong to params marked ``hrHidden``
    (which the reader skips, leaving their booleans unclaimed).

    *A calculation no address accounts for.* ``Generate Response from Model`` exports
    its Web Viewer call's parameter list as calcs under ``LLMWebScript``, and the
    catalog models only that call's object name and function name — the arguments
    themselves have no param, so there is nowhere to put them.

    Before the reader refused, each of these silently produced a plausible
    ``<Elem state="…"/>`` or ``<Calculation>`` carrying a value that means something
    else entirely. They are kept OUT of ``saxml/`` — that corpus asserts zero
    unsupported — and pinned here instead, the same way the reader's other
    missing-decoder steps are left uncommitted rather than frozen wrong.
    """
    names = sorted(n for n in os.listdir(_SAXML_UNSUPPORTED_DIR) if n.endswith(".xml"))
    assert names, "no unsupported SaXML fixtures found"
    for name in names:
        stats = {"unknown": 0, "unsupported": 0}
        out = fm_xml_to_snippet.translate_script(
            os.path.join(_SAXML_UNSUPPORTED_DIR, name), stats)
        assert stats["unsupported"] == 1, f"{name}: expected 1 unsupported, got {stats}"
        assert stats["unknown"] == 0, f"{name}: unexpected uncatalogued step"
        # Fail loud means a marked placeholder, not silently-wrong XML.
        assert "TODO: unsupported SaXML shape" in out, name
        assert ("unclaimed SaXML booleans" in out
                or "no catalog param addresses" in out), \
            f"{name}: not a refusal to place a value"
        ET.fromstring(out)  # still well-formed


def test_python_xml_to_hr_matches_web_viewer():
    """The Python and TypeScript XML -> HR readers produce identical HR."""
    ts = _load(_TS_XML_TO_HR)
    actual = compute_xml_to_hr()
    assert set(actual) == set(ts), "corpus differs between the Python and TS fixtures"
    diffs = [rel for rel, hr in actual.items() if ts[rel]["hr"] != hr]
    assert not diffs, f"Python and TS XML -> HR diverge on: {diffs}"


# --------------------------------------------------------------------------- #
# Bless (regenerate goldens after a legitimate catalog change)
# --------------------------------------------------------------------------- #

def _bless():
    for path, data in (
        (_XML_TO_HR, compute_xml_to_hr()),
        (_SAXML_TO_SNIPPET, compute_saxml_to_snippet()),
    ):
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        print(f"blessed {os.path.relpath(path, _REPO)}")


if __name__ == "__main__":
    import sys

    if "--bless" in sys.argv:
        _bless()
    else:
        print("run via: uvx pytest agent/scripts/test_converter_conformance.py")
        print("or regenerate goldens with: --bless")
