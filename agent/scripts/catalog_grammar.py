#!/usr/bin/env python3
"""catalog_grammar.py — shared intermediate representation (IR) and typed catalog
model for the OSS converters (P6.1 scaffold).

This module defines, once for the Python side:

  * ``StepInstance`` — the in-memory shape all four converters read or write, so a
    single grammar engine (P6.2) can serve every direction.
  * ``Value`` — a tagged union of the concrete values a parameter can hold.
  * The typed catalog model (``CatalogEntry`` / ``StepParam`` / ``DiscriminatorBranch``
    and the facet carriers) that the grammar engine reads its rules from.
  * ``param_key()`` — the ParamKey rule (a ``namedCalc`` param keys off its
    ``wrapperElement``, every other param off its ``xmlElement``), matching the
    reference converter. Every ``namedCalc`` shares ``xmlElement == "Calculation"``,
    so the wrapper is what disambiguates them.

No behaviour change ships in P6.1 — this is the type/parse scaffold that P6.2 (Python
grammar engine) and, structurally mirrored, P6.3 (TS) build on. Stdlib only; no venv.

The TS counterpart lives in ``webviewer/src/converter/catalog-types.ts`` and is kept
deliberately parallel so a facet added to one port is obviously missing from the other
(see the plan's "Python↔TS structural parity" risk).
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any, Union

# ---------------------------------------------------------------------------
# Parameter type vocabulary
# ---------------------------------------------------------------------------
# Every ``type`` value observed across the 216-step canonical catalog. The load
# test asserts no param carries a type outside this set (``unknown_typed == 0``);
# a new type appearing here is a deliberate catalog change, not a silent drop.
KNOWN_PARAM_TYPES: frozenset[str] = frozenset(
    {
        "boolean",
        "flagBoolean",
        "flagElement",
        "enum",
        "text",
        "name",
        "calculation",
        "calc",
        "namedCalc",
        "field",
        "fieldOrVariable",
        "fieldList",
        "layout",
        "script",
        "table",
        "tableOccurrence",
        "tableRef",
        "tableReference",
        "reference",
        "fileReference",
        "attrGroup",
        "repeatGroup",
        "bitmaskGroup",
        "findRequests",
        "parametersList",
        "complex",
    }
)


# ---------------------------------------------------------------------------
# Facet carriers — typed views over the advanced grammar the catalog encodes
# ---------------------------------------------------------------------------
@dataclass
class DiscriminatorBranch:
    """One branch of a ``discriminatorValues`` map (keyed by the enum value).

    ``reveal`` lists sibling ParamKeys that become live for this branch; ``hrToken``
    substitutes a fixed HR string for the whole step slot; ``labeled`` flags a branch
    whose revealed params render with their HR labels rather than positionally.
    """

    hr_token: str | None = None
    labeled: bool | None = None
    reveal: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> DiscriminatorBranch:
        return cls(
            hr_token=d.get("hrToken"),
            labeled=d.get("labeled"),
            reveal=list(d.get("reveal", [])),
        )


@dataclass
class VisibleWhen:
    """Gate: this param renders only when ``param`` holds one of ``values``."""

    param: str
    values: list[str]

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> VisibleWhen:
        return cls(param=d["param"], values=list(d.get("values", [])))


@dataclass
class HrLabelRule:
    """One entry of ``hrLabelWhen`` — swap the HR label when a sibling param matches."""

    param: str
    values: list[str]
    hr_label: str | None = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> HrLabelRule:
        return cls(
            param=d["param"],
            values=list(d.get("values", [])),
            hr_label=d.get("hrLabel"),
        )


@dataclass
class AttrField:
    """A member of an ``attrGroup`` / ``repeatGroup`` ``fields`` list.

    ``kind`` is ``"attr"`` (an XML attribute on the group element) or ``"calc"``
    (a nested ``<Calculation>``). Preserves the full source dict in ``raw``.
    """

    key: str
    kind: str | None = None
    xml_attr: str | None = None
    default_value: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> AttrField:
        return cls(
            key=d.get("key", ""),
            kind=d.get("kind"),
            xml_attr=d.get("xmlAttr"),
            default_value=d.get("defaultValue"),
            raw=dict(d),
        )


# ---------------------------------------------------------------------------
# Catalog schema — the grammar the engine reads from
# ---------------------------------------------------------------------------
@dataclass
class StepParam:
    """A single parameter definition from a catalog step's ``params[]``.

    The plan-named facet fields are typed explicitly; the untyped long tail
    (bitmask sub-keys, ``notes``/``note``, ``entryElement`` and friends) is kept
    verbatim in ``raw`` so nothing is dropped on load and P6.2 can reach it.
    """

    xml_element: str
    type: str
    hr_label: str | None
    required: bool
    xml_attr: str | None = None
    wrapper_element: str | None = None
    parent_element: str | None = None
    default_value: str | None = None
    enum_values: list[str] = field(default_factory=list)
    hr_enum_values: dict[str, str] = field(default_factory=dict)
    inverted_hr: bool | None = None
    enum_style: str | None = None
    flag_style: bool | None = None
    hr_slot: int | None = None
    hr_hidden: bool | None = None
    omit_when_empty: bool | None = None
    emit_empty_default: bool | None = None
    # Governing discriminator: string form names a sibling; map form carries branches.
    discriminator: str | None = None
    discriminator_values: dict[str, DiscriminatorBranch] = field(default_factory=dict)
    visible_when: VisibleWhen | None = None
    hr_label_when: list[HrLabelRule] = field(default_factory=list)
    attr_fields: list[AttrField] = field(default_factory=list)
    description: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> StepParam:
        dv = {
            k: DiscriminatorBranch.from_dict(v)
            for k, v in (d.get("discriminatorValues") or {}).items()
        }
        vw = d.get("visibleWhen")
        # `flagBoolean` is the catalog's label for a plain on/off flag FM still
        # serializes as <Element state="True|False"/> (the False state is kept, not
        # omitted). It is identical to `boolean` for render/parse/emit, and only
        # `boolean` has engine branches — so normalize at load, exactly as the
        # reference converter does, or every flagBoolean param renders as nothing.
        # The original label is preserved in ``raw['type']``.
        raw_type = d.get("type", "")
        norm_type = "boolean" if raw_type == "flagBoolean" else raw_type
        return cls(
            xml_element=d.get("xmlElement", ""),
            type=norm_type,
            hr_label=d.get("hrLabel"),
            required=bool(d.get("required", False)),
            xml_attr=d.get("xmlAttr"),
            wrapper_element=d.get("wrapperElement"),
            parent_element=d.get("parentElement"),
            default_value=d.get("defaultValue"),
            enum_values=list(d.get("enumValues", [])),
            hr_enum_values=dict(d.get("hrEnumValues", {})),
            inverted_hr=d.get("invertedHr"),
            enum_style=d.get("enumStyle"),
            flag_style=d.get("flagStyle"),
            hr_slot=d.get("hrSlot"),
            hr_hidden=d.get("hrHidden"),
            omit_when_empty=d.get("omitWhenEmpty"),
            emit_empty_default=d.get("emitEmptyDefault"),
            discriminator=d.get("discriminator"),
            discriminator_values=dv,
            visible_when=VisibleWhen.from_dict(vw) if vw else None,
            hr_label_when=[HrLabelRule.from_dict(x) for x in d.get("hrLabelWhen", [])],
            attr_fields=[AttrField.from_dict(x) for x in d.get("fields", [])],
            description=d.get("description"),
            raw=dict(d),
        )

    @property
    def is_known_type(self) -> bool:
        return self.type in KNOWN_PARAM_TYPES

    @property
    def key(self) -> str:
        """The ParamKey for this param — see ``param_key``."""
        return param_key(self)


@dataclass
class BlockPair:
    role: str  # "open" | "middle" | "close"
    partners: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> BlockPair:
        return cls(role=d.get("role", ""), partners=list(d.get("partners", [])))


@dataclass
class CatalogEntry:
    name: str
    id: int | None
    category: str
    snippet_file: str
    self_closing: bool
    params: list[StepParam]
    hr_signature: str | None
    block_pair: BlockPair | None
    status: str | None
    help_url: str | None
    notes: Any = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> CatalogEntry:
        bp = d.get("blockPair")
        return cls(
            name=d.get("name", ""),
            id=d.get("id"),
            category=d.get("category", ""),
            snippet_file=d.get("snippetFile", ""),
            self_closing=bool(d.get("selfClosing", False)),
            params=[StepParam.from_dict(p) for p in d.get("params", [])],
            hr_signature=d.get("hrSignature"),
            block_pair=BlockPair.from_dict(bp) if bp else None,
            status=d.get("status"),
            help_url=d.get("helpUrl"),
            notes=d.get("notes"),
            raw=dict(d),
        )


def param_key(param: StepParam) -> str:
    """ParamKey rule (matches the reference converter).

    A ``namedCalc`` param keys off its ``wrapperElement`` (every namedCalc shares
    ``xmlElement == "Calculation"``, so the wrapper disambiguates); any other param
    keys off its ``xmlElement``.
    """
    if param.type == "namedCalc" and param.wrapper_element:
        return param.wrapper_element
    return param.xml_element


# ---------------------------------------------------------------------------
# Runtime IR — StepInstance and its Value union
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Absent:
    """The param is not present in the source (distinct from an empty scalar)."""


ABSENT = Absent()


@dataclass(frozen=True)
class Scalar:
    """A raw text / enum / boolean-state value."""

    text: str


@dataclass(frozen=True)
class Calc:
    """A calculation expression (CDATA body)."""

    text: str


@dataclass(frozen=True)
class Field:
    """A field reference."""

    table: str | None = None
    id: int | None = None
    name: str | None = None


@dataclass(frozen=True)
class Ref:
    """A script or layout reference."""

    id: int | None = None
    name: str | None = None


@dataclass
class ListValue:
    """An ordered group (repeat/find requests, parameter lists)."""

    items: list[Value] = field(default_factory=list)


@dataclass
class Group:
    """An attrGroup's attribute bag (attr name → raw string)."""

    attrs: dict[str, str] = field(default_factory=dict)


# Runtime alias (not an annotation): keep ``Union[...]`` rather than ``X | Y`` so it
# evaluates on Python 3.9, the stock macOS python3.
Value = Union[Absent, Scalar, Calc, Field, Ref, ListValue, Group]  # noqa: UP007


@dataclass
class StepInstance:
    """The shared in-memory shape every converter reads or writes.

    ``values`` is keyed by ParamKey (see ``param_key``); a param absent from the
    source is either omitted or mapped to ``ABSENT``.
    """

    name: str
    id: int = 0
    enable: bool = True
    values: dict[str, Value] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Loading + a self-checking load report (the P6.1 acceptance gate)
# ---------------------------------------------------------------------------
def load_catalog(path: str) -> list[CatalogEntry]:
    """Parse the step catalog JSON into typed ``CatalogEntry`` objects."""
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    steps = data["steps"] if isinstance(data, dict) and "steps" in data else data
    return [CatalogEntry.from_dict(s) for s in steps]


@dataclass
class LoadReport:
    entries: int
    params_in_json: int
    params_loaded: int
    unknown_typed: list[tuple[str, str, str]]  # (step, xmlElement, type)

    @property
    def dropped(self) -> int:
        return self.params_in_json - self.params_loaded


def load_report(path: str) -> LoadReport:
    """Load the catalog and report whether every param survived typing.

    ``dropped`` counts params present in the JSON but not built into a
    ``StepParam``; ``unknown_typed`` lists params whose ``type`` is outside
    ``KNOWN_PARAM_TYPES``. Both must be zero for P6.1 acceptance.
    """
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    steps = data["steps"] if isinstance(data, dict) and "steps" in data else data
    params_in_json = sum(len(s.get("params", [])) for s in steps)

    entries = [CatalogEntry.from_dict(s) for s in steps]
    params_loaded = sum(len(e.params) for e in entries)
    unknown = [
        (e.name, p.xml_element, p.type)
        for e in entries
        for p in e.params
        if not p.is_known_type
    ]
    return LoadReport(
        entries=len(entries),
        params_in_json=params_in_json,
        params_loaded=params_loaded,
        unknown_typed=unknown,
    )


# ===========================================================================
# XML → HR grammar engine (P6.2)
# ===========================================================================
# A faithful port of the reference converter's XML→HR path: one function per
# param type computes that param's HR fragment, and an orchestrator renders the
# fragments in hrSlot order with discriminator / visibility / label handling.
#
# Reads directly from the parsed fmxmlsnippet ``<Step>`` element (an
# ElementTree Element), mirroring the reference — which threads values inline
# rather than through an intermediate struct — so the output is byte-faithful to
# the proven grammar. The complex facets the P6.1 types keep in ``StepParam.raw``
# (bitmask tables, attrGroup field specs, repeat/list entry shapes) are read from
# there; the simple values use the typed fields.
#
# ``ComputeParamHr`` maps here to ``compute_param_hr``; ``RenderGenericXmlToHr``
# to ``render_step_hr``. Control-flow steps are NOT rendered here — they stay
# hand-coded in snippet_to_hr.py (the sanctioned exception).


def _ci_equals(a: str, b: str) -> bool:
    return a.lower() == b.lower()


def _child_text(parent: ET.Element | None, name: str) -> str:
    if parent is None:
        return ""
    c = parent.find(name)
    return c.text if (c is not None and c.text) else ""


def _child_attr(parent: ET.Element | None, name: str, attr: str) -> str:
    if parent is None:
        return ""
    c = parent.find(name)
    return c.get(attr, "") if c is not None else ""


def _nested_text(parent: ET.Element | None, child: str, grand: str) -> str:
    if parent is None:
        return ""
    c = parent.find(child)
    if c is None:
        return ""
    g = c.find(grand)
    return g.text if (g is not None and g.text) else ""


def _descend_path(step: ET.Element | None, path: str) -> ET.Element | None:
    """Follow a '/'-delimited child path from ``step`` (direct children only)."""
    n = step
    for seg in path.split("/"):
        if not seg:
            continue
        if n is None:
            return None
        n = n.find(seg)
    return n


def _split_element_attr(xml_element: str) -> tuple[bool, str, str]:
    """G11 'Elem/@attr' notation → (True, 'Elem', 'attr'); else (False, '', '')."""
    pos = xml_element.find("/@")
    if pos == -1:
        return False, "", ""
    return True, xml_element[:pos], xml_element[pos + 2 :]


def _join_with_comma(items: list[str]) -> str:
    return ", ".join(items)


def _needs_group_quote(v: str) -> bool:
    if not v:
        return False
    ws = " \t\n\r"
    if v[0] in ws or v[-1] in ws:
        return True
    return "," in v or '"' in v


def _group_quote_value(v: str) -> str:
    if not _needs_group_quote(v):
        return v
    return '"' + v.replace('"', '""') + '"'


# --- discriminator / visibility predicates (mirror the reference) -----------
def is_governing_discriminator(param: StepParam) -> bool:
    return param.type == "enum" and bool(param.discriminator_values)


def is_driven_discriminator(entry: CatalogEntry, param: StepParam) -> bool:
    if not param.xml_element:
        return False
    return any(
        q.type == "layout" and q.discriminator == param.xml_element
        for q in entry.params
    )


def value_reveals_companion(discrim: StepParam, value: str, elem: str) -> bool:
    """Whether governing discriminator ``discrim``'s XML ``value`` reveals ``elem``.

    Port of the reference ``ValueRevealsCompanion`` (and TS ``valueRevealsCompanion``);
    shared by the HR→XML emit engine (P6.3 TS / P6.4 Python).
    """
    branch = discrim.discriminator_values.get(value)
    if branch is None:
        return False
    return elem in branch.reveal


def candidate_hr_labels(param: StepParam) -> list[str]:
    """Every label a param's HR token may carry — base ``hr_label`` plus any
    ``hr_label_when`` variant labels — longest first (lexicographic tiebreak),
    duplicates removed. Port of the reference ``CandidateHrLabels`` (TS
    ``candidateHrLabels``); the HR parse matcher tries each so a variant-labeled
    value round-trips.
    """
    labels: list[str] = []
    if param.hr_label:
        labels.append(param.hr_label)
    for v in param.hr_label_when:
        if v.hr_label:
            labels.append(v.hr_label)
    labels.sort(key=lambda s: (-len(s), s))
    out: list[str] = []
    for i, lbl in enumerate(labels):
        if i == 0 or lbl != labels[i - 1]:
            out.append(lbl)
    return out


def governing_discriminator_for(
    entry: CatalogEntry, companion: StepParam
) -> StepParam | None:
    if not companion.xml_element:
        return None
    ck = param_key(companion)
    for p in entry.params:
        if p is companion or not is_governing_discriminator(p):
            continue
        for branch in p.discriminator_values.values():
            if ck in branch.reveal:
                return p
    return None


def read_enum_raw_value(step: ET.Element, p: StepParam) -> str:
    base = step if not p.parent_element else _descend_path(step, p.parent_element)
    if p.enum_style == "text":
        return _child_text(base, p.xml_element)
    attr = p.xml_attr or "value"
    return _child_attr(base, p.xml_element, attr)


def effective_hr_label(entry: CatalogEntry, step: ET.Element, param: StepParam) -> str:
    for variant in param.hr_label_when:
        for q in entry.params:
            if param_key(q) != variant.param:
                continue
            v = read_enum_raw_value(step, q) or (q.default_value or "")
            if v in variant.values:
                return variant.hr_label or ""
            break
    return param.hr_label or ""


def param_visible(entry: CatalogEntry, step: ET.Element, param: StepParam) -> bool:
    vw = param.visible_when
    if vw is None or not vw.param:
        return True
    for q in entry.params:
        if param_key(q) != vw.param:
            continue
        v = read_enum_raw_value(step, q) or (q.default_value or "")
        return v in vw.values
    return True


def hr_param_order(entry: CatalogEntry) -> list[int]:
    """Indices in HR render order — catalog order unless some param sets hrSlot."""
    order = list(range(len(entry.params)))
    if not any(p.hr_slot is not None and p.hr_slot >= 0 for p in entry.params):
        return order

    def key(i: int) -> int:
        s = entry.params[i].hr_slot
        return s if (s is not None and s >= 0) else i

    return sorted(order, key=key)  # Python's sort is stable


# --- group / repeat / list renderers ----------------------------------------
def _render_group_element(node: ET.Element, fields: list[dict]) -> str:
    """Render one attrGroup element to its HR body ('k=v, k=v'); mirrors the ref."""
    parts: list[str] = []
    for f in fields:
        kind = f.get("kind", "")
        key = f.get("key", "")
        if kind == "attr":
            a = node.get(f.get("xmlAttr", ""))
            if a is not None:
                parts.append(key + "=" + _group_quote_value(a))
        elif kind == "text":
            child = node.find(f.get("childElement", ""))
            if child is not None:
                parts.append(key + "=" + _group_quote_value(child.text or ""))
        elif kind == "calc":
            child_el = f.get("childElement", "")
            if not child_el:
                c = node.find("Calculation")
                if c is not None:
                    parts.append(key + "=" + (c.text or ""))
            else:
                child = node.find(child_el)
                if child is not None:
                    parts.append(key + "=" + _child_text(child, "Calculation"))
        elif kind == "field":
            fld = node.find("Field")
            if fld is not None:
                table = fld.get("table", "")
                name = fld.get("name", "")
                if name:
                    parts.append(key + "=" + (name if not table else table + "::" + name))
        elif kind == "script":
            sc = node.find(f.get("element", ""))
            if sc is not None:
                name = sc.get("name", "")
                if name:
                    parts.append(key + "=" + _group_quote_value(name))
        elif kind == "fieldOrVariable":
            fld = node.find("Field")
            if fld is not None:
                text = (fld.text or "").strip()
                if text:
                    parts.append(key + "=" + _group_quote_value(text))
                else:
                    table = fld.get("table", "")
                    name = fld.get("name", "")
                    if name:
                        ref = name if not table else table + "::" + name
                        parts.append(key + "=" + _group_quote_value(ref))
        elif kind == "group":
            sub = node.find(f.get("element", ""))
            if sub is not None:
                parts.append(
                    key + "=(" + _render_group_element(sub, f.get("fields", [])) + ")"
                )
    return _join_with_comma(parts)


def _render_repeat_group(container: ET.Element, param: StepParam) -> str:
    entry_el = param.raw.get("entryElement", "")
    fields = param.raw.get("fields", [])
    entries = [
        _render_group_element(e, fields) for e in container.findall(entry_el)
    ]
    return " | ".join(entries)


def _render_field_list(container: ET.Element, param: StepParam) -> str:
    entry_el = param.raw.get("entryElement", "")
    entry_attr = param.raw.get("entryAttr", "")
    field_wrapper = param.raw.get("fieldWrapper", "")
    tokens: list[str] = []

    def emit(entry_node: ET.Element | None, field_node: ET.Element | None) -> None:
        if field_node is None:
            return
        table = field_node.get("table", "")
        name = field_node.get("name", "")
        fieldref = "" if not name else (name if not table else table + "::" + name)
        token = _group_quote_value(fieldref)
        if entry_attr:
            attr_node = field_node if not entry_el else entry_node
            if attr_node is not None:
                token += "=" + (attr_node.get(entry_attr, "") or "")
        tokens.append(token)

    if entry_el:
        for e in container.findall(entry_el):
            if field_wrapper:
                w = e.find(field_wrapper)
                fld = w.find("Field") if w is not None else None
            else:
                fld = e.find("Field")
            emit(e, fld)
    else:
        for fld in container.findall("Field"):
            emit(None, fld)
    return ", ".join(tokens)


# --- bitmask helpers --------------------------------------------------------
def _bitmask_style_by_xml(param: StepParam, v: str) -> dict | None:
    for s in param.raw.get("bitmaskStyles", []):
        if s.get("xmlValue") == v:
            return s
    return None


def _bitmask_mask_for_flags(param: StepParam, labels: list[str]) -> int:
    m = 0
    for lbl in labels:
        for f in param.raw.get("bitmaskFlags", []):
            if _ci_equals(f.get("hrLabel", ""), lbl):
                m |= f.get("bit", 0)
                break
    return m


# --- per-param HR fragment (ComputeParamHr) ---------------------------------
def compute_param_hr(entry: CatalogEntry, step: ET.Element, param: StepParam) -> str:
    """Compute one param's HR fragment ('' = no token). Port of ComputeParamHr."""
    val = ""
    base = step if not param.parent_element else _descend_path(step, param.parent_element)
    if base is None:
        base = step  # a missing wrapper reads nothing; keep base usable
    is_elem_attr, g11_elem, g11_attr = _split_element_attr(param.xml_element)
    label = param.hr_label or ""
    ptype = param.type

    if ptype == "boolean":
        battr = g11_attr if is_elem_attr else (param.xml_attr or "state")
        belem = g11_elem if is_elem_attr else param.xml_element
        state = _child_attr(base, belem, battr)
        if state:
            state_true = state == "True"
            if param.inverted_hr:
                state_true = not state_true
            if param.flag_style:
                if state_true and label:
                    val = label
            elif param.hr_enum_values:
                val = param.hr_enum_values.get(state, "On" if state_true else "Off")
                if label:
                    val = label + ": " + val
            else:
                val = "On" if state_true else "Off"
                if label:
                    val = label + ": " + val
    elif ptype == "enum" and is_driven_discriminator(entry, param):
        pass  # silent companion of a layout param
    elif ptype == "enum":
        if param.enum_style == "text":
            val = _child_text(base, param.xml_element)
        else:
            eattr = g11_attr if is_elem_attr else (param.xml_attr or "value")
            eelem = g11_elem if is_elem_attr else param.xml_element
            val = _child_attr(base, eelem, eattr)
        if not param.flag_style and param.hr_enum_values:
            mapped = param.hr_enum_values.get(val)
            if mapped:
                val = mapped
        if param.flag_style:
            val = (
                label
                if (val and val != (param.default_value or "") and label)
                else ""
            )
        elif val and label:
            val = label + ": " + val
    elif ptype == "calculation":
        val = _child_text(base, "Calculation")
        if val and param.omit_when_empty and label:
            val = label + ": " + val
    elif ptype == "attrGroup":
        group_node = base.find(param.xml_element)
        if group_node is not None:
            inner = _render_group_element(group_node, param.raw.get("fields", []))
            val = inner if not label else (label + ": " + inner)
    elif ptype == "bitmaskGroup":
        g = base.find(param.xml_element)
        styles = param.raw.get("bitmaskStyles", [])
        if g is not None and styles:
            xml_style = g.get(param.raw.get("bitmaskStyleAttr", ""), "")
            st = _bitmask_style_by_xml(param, xml_style) or styles[0]
            chrome = 0
            for f in param.raw.get("bitmaskFlags", []):
                yn = g.get(f.get("xmlAttr", ""), "No")
                if _ci_equals(yn, "Yes"):
                    chrome |= f.get("bit", 0)
            chrome &= _bitmask_mask_for_flags(param, st.get("legalFlags", []))
            parts: list[str] = []
            if label:
                parts.append(label + ": " + st.get("hrToken", ""))
            if chrome != _bitmask_mask_for_flags(param, st.get("defaultFlags", [])):
                lst = [
                    f.get("hrLabel", "")
                    for f in param.raw.get("bitmaskFlags", [])
                    if chrome & f.get("bit", 0)
                ]
                controls_label = param.raw.get("hrControlsLabel", "")
                parts.append(controls_label + ": " + (", ".join(lst) if lst else "None"))
            val = " ; ".join(parts)
    elif ptype == "repeatGroup":
        container = base.find(param.xml_element)
        if container is not None:
            inner = _render_repeat_group(container, param)
            if inner:
                val = inner if not label else (label + ": " + inner)
    elif ptype == "fieldList":
        container = base.find(param.xml_element)
        if container is not None:
            inner = _render_field_list(container, param)
            if inner:
                val = inner if not label else (label + ": " + inner)
    elif ptype == "namedCalc":
        wrapper = param.wrapper_element or param.xml_element
        val = _nested_text(base, wrapper, "Calculation")
        if val:
            lbl = effective_hr_label(entry, step, param)
            if lbl:
                val = lbl + ": " + val
    elif ptype == "parametersList":
        wrapper_name = param.xml_element or "Parameters"
        wrapper = base.find(wrapper_name)
        if wrapper is not None:
            items = [
                _child_text(p, "Calculation")
                for p in wrapper.findall("P")
                if _child_text(p, "Calculation")
            ]
            if items:
                val = _join_with_comma(items)
                if label:
                    val = label + ": " + val
    elif ptype == "findRequests":
        query = base.find("Query")
        if query is not None:
            rows: list[str] = []
            for rr in query.findall("RequestRow"):
                op = rr.get("operation", "")
                crits: list[str] = []
                for cr in rr.findall("Criteria"):
                    fld = cr.find("Field")
                    table = fld.get("table", "") if fld is not None else ""
                    name = fld.get("name", "") if fld is not None else ""
                    text = _child_text(cr, "Text")
                    fieldref = ""
                    if name:
                        fieldref = name if not table else table + "::" + name
                    crits.append(text if not fieldref else (fieldref + ": " + text))
                joined = " & ".join(crits)
                if op == "Exclude":
                    joined = "Omit " + joined
                rows.append(joined)
            val = " | ".join(rows)
            if val and label:
                val = label + ": " + val
    elif ptype == "fieldOrVariable":
        field_node = base.find(param.xml_element)
        if field_node is None:
            field_node = base.find("Field")
        if field_node is not None:
            table = field_node.get("table", "")
            name = field_node.get("name", "")
            text = field_node.text or ""
            if text and text[0] == "$":
                val = text
            elif name:
                val = name if not table else table + "::" + name
            elif text:
                val = text
            if val and label:
                val = label + ": " + val
    elif ptype == "flagElement":
        if base.find(param.xml_element) is not None and label:
            val = label
    elif ptype == "calc":
        val = _child_text(base, "Calculation")
    elif ptype == "field":
        field_node = base.find(param.xml_element)
        if field_node is None:
            field_node = base.find("Field")
        if field_node is not None:
            table = field_node.get("table", "")
            name = field_node.get("name", "")
            val = name if not table else table + "::" + name
    elif ptype in ("tableRef", "tableOccurrence"):
        table_node = base.find("Table")
        if table_node is not None:
            name = table_node.get("name", "")
            if name:
                val = name if not label else (label + ": " + name)
    elif ptype == "fileReference":
        fr_node = base.find(param.xml_element)
        if fr_node is not None:
            path = _child_text(fr_node, "UniversalPathList")
            if path:
                val = path if not label else (label + ": " + path)
    elif ptype == "reference":
        ref_node = base.find(param.xml_element)
        if ref_node is not None:
            name = ref_node.get("name", "")
            if name:
                val = ('"' + name + '"') if not label else (label + ": " + name)
    elif ptype == "layout":
        layout_node = base.find("Layout")
        if param.discriminator:
            dest = _child_attr(base, param.discriminator, "value")
            if _ci_equals(dest, "OriginalLayout"):
                val = "original layout"
            elif _ci_equals(dest, "CurrentLayout"):
                val = "current layout"
            elif _ci_equals(dest, "LayoutNameByCalc"):
                val = "by name: " + _child_text(layout_node, "Calculation")
            elif _ci_equals(dest, "LayoutNumberByCalc"):
                val = "by number: " + _child_text(layout_node, "Calculation")
            else:
                name = layout_node.get("name", "") if layout_node is not None else ""
                if name:
                    val = '"' + name + '"'
        elif layout_node is not None or param.required:
            name = layout_node.get("name", "") if layout_node is not None else ""
            tok = ""
            if name:
                tok = '"' + name + '"'
            elif param.required:
                tok = "<unknown>"
            if tok:
                val = tok if not label else (label + ": " + tok)
    elif ptype == "script":
        script_node = base.find("Script")
        if script_node is not None:
            name = script_node.get("name", "")
            if name:
                val = '"' + name + '"'
    elif ptype in ("text", "name"):
        val = _child_text(base, param.xml_element)
        if val and param.parent_element and label:
            val = label + ": " + val

    return val


def render_discriminator_group(
    entry: CatalogEntry, step: ET.Element, param: StepParam
) -> str:
    """Render a governing discriminator's HR fragment. Port of RenderDiscriminatorGroup."""
    value = read_enum_raw_value(step, param) or (param.default_value or "")
    branch = param.discriminator_values.get(value)
    if branch is None:
        mapped = param.hr_enum_values.get(value) or value
        label = param.hr_label or ""
        return mapped if not label else (label + ": " + mapped)
    if branch.hr_token:
        return branch.hr_token
    parts: list[str] = []
    if branch.labeled and param.hr_label:
        mapped = param.hr_enum_values.get(value) or value
        parts.append(param.hr_label + ": " + mapped)
    for elem in branch.reveal:
        for c in entry.params:
            if param_key(c) != elem:
                continue
            v = compute_param_hr(entry, step, c)
            if v:
                parts.append(v)
            break
    return " ; ".join(parts)


def render_step_hr(entry: CatalogEntry, step: ET.Element) -> str:
    """Render a full step to its HR bracket line. Port of RenderGenericXmlToHr.

    Returns ``entry.name`` alone when no param contributes a token, else
    ``Name [ tok ; tok ; … ]``. Does not handle control-flow steps.
    """
    parts: list[str] = []
    for pi in hr_param_order(entry):
        param = entry.params[pi]
        if param.hr_hidden:
            continue
        if governing_discriminator_for(entry, param):
            continue
        if not param_visible(entry, step, param):
            continue
        val = (
            render_discriminator_group(entry, step, param)
            if is_governing_discriminator(param)
            else compute_param_hr(entry, step, param)
        )
        if val:
            parts.append(val)
    if not parts:
        return entry.name
    return entry.name + " [ " + " ; ".join(parts) + " ]"


if __name__ == "__main__":
    import os
    import sys

    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(os.path.dirname(here))
    catalog = os.path.join(repo_root, "agent", "catalogs", "step-catalog-en.json")
    rep = load_report(catalog)
    print(f"entries          : {rep.entries}")
    print(f"params in JSON   : {rep.params_in_json}")
    print(f"params loaded    : {rep.params_loaded}")
    print(f"dropped          : {rep.dropped}")
    print(f"unknown-typed    : {len(rep.unknown_typed)}")
    for step, el, ty in rep.unknown_typed:
        print(f"  ! {step} / {el} : {ty!r}")
    ok = rep.dropped == 0 and not rep.unknown_typed
    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)
