#!/usr/bin/env python3
"""test_catalog_grammar.py — P6.1 IR load test.

Parses all catalog entries into the ``catalog_grammar`` IR and asserts that no
parameter is dropped and none carries an unknown type. Runs under pytest, or
standalone: ``python3 agent/scripts/test_catalog_grammar.py``.
"""

import os

from catalog_grammar import (
    ABSENT,
    KNOWN_PARAM_TYPES,
    CatalogEntry,
    ListValue,
    Scalar,
    StepInstance,
    load_report,
    param_key,
)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
CATALOG = os.path.join(REPO_ROOT, "agent", "catalogs", "step-catalog-en.json")


def test_no_params_dropped():
    rep = load_report(CATALOG)
    assert rep.entries == 216, f"expected 216 entries, got {rep.entries}"
    assert rep.dropped == 0, f"{rep.dropped} params dropped on load"


def test_no_unknown_param_types():
    rep = load_report(CATALOG)
    assert not rep.unknown_typed, (
        f"{len(rep.unknown_typed)} params carry a type outside KNOWN_PARAM_TYPES: "
        f"{rep.unknown_typed[:5]}"
    )


def test_every_type_seen_is_declared():
    # Guards the vocabulary: if the catalog introduces a new type, this fails
    # loudly rather than silently classifying it as unknown at conversion time.
    rep = load_report(CATALOG)
    assert not rep.unknown_typed


def test_param_key_rule():
    from catalog_grammar import StepParam

    named = StepParam.from_dict(
        {"xmlElement": "Calculation", "type": "namedCalc", "wrapperElement": "Name"}
    )
    plain = StepParam.from_dict({"xmlElement": "SelectAll", "type": "boolean"})
    assert param_key(named) == "Name"
    assert param_key(plain) == "SelectAll"
    # A namedCalc with no wrapper falls back to its xmlElement.
    bare = StepParam.from_dict({"xmlElement": "Calculation", "type": "namedCalc"})
    assert param_key(bare) == "Calculation"


def test_step_instance_ir_roundtrips_values():
    inst = StepInstance(
        name="Set Variable",
        values={"Name": Scalar("$x"), "Value": ListValue([Scalar("42")])},
    )
    assert inst.name == "Set Variable"
    assert inst.enable is True
    assert isinstance(inst.values["Value"], ListValue)
    assert inst.values.get("Missing", ABSENT) is ABSENT


def test_discriminator_branches_parse():
    entries = [
        CatalogEntry.from_dict(s)
        for s in _load_steps()
        if s["name"] == "Close Window"
    ]
    assert entries, "Close Window should be in the catalog"
    window = next(p for p in entries[0].params if p.xml_element == "Window")
    assert set(window.discriminator_values) == {"ByName", "Current"}
    assert window.discriminator_values["ByName"].reveal == ["Name", "LimitToWindowsOfCurrentFile"]
    assert window.discriminator_values["Current"].hr_token == "Current Window"


def _load_steps():
    import json

    with open(CATALOG, encoding="utf-8") as fh:
        data = json.load(fh)
    return data["steps"] if isinstance(data, dict) and "steps" in data else data


if __name__ == "__main__":
    test_no_params_dropped()
    test_no_unknown_param_types()
    test_every_type_seen_is_declared()
    test_param_key_rule()
    test_step_instance_ir_roundtrips_values()
    test_discriminator_branches_parse()
    print(f"all catalog_grammar tests passed ({len(KNOWN_PARAM_TYPES)} known types)")
