#!/usr/bin/env python3
"""
snippet_to_hr.py — Convert fmxmlsnippet XML to human-readable (HR) script text.

Usage:
    python3 agent/scripts/snippet_to_hr.py <path-to-snippet.xml>
    python3 agent/scripts/snippet_to_hr.py <snippet.xml> --output <output.txt>
    python3 agent/scripts/snippet_to_hr.py <snippet.xml> --raw

Each <Step> element produces exactly one output line, matching what a developer
sees in FileMaker Script Workspace.

By default, output includes line numbers (tab-separated). Use --raw for plain
text without line numbers (suitable for diff payloads).

Indentation follows Script Workspace rules:
    If, Loop         → render at current level, then indent +1
    Else, Else If    → indent -1, render, then indent +1
    End If, End Loop → indent -1, render

Disabled steps are prefixed with '// '.

Step rendering is driven by agent/catalogs/step-catalog-en.json. Specific
handlers exist for structurally unique steps (block control, Set Variable,
Perform Script, Show Custom Dialog, Set Field, Go to Layout, etc.). All
other steps use a generic catalog-driven renderer.

This is the server-side Python equivalent of webviewer/src/converter/xml-to-hr.ts.
"""

import json
import os
import sys
import xml.etree.ElementTree as ET

INDENT = "    "  # 4 spaces per level


# ---------------------------------------------------------------------------
# Catalog loading
# ---------------------------------------------------------------------------

def _find_catalog():
    """Locate step-catalog-en.json relative to the repo root."""
    here = os.path.dirname(os.path.abspath(__file__))
    for _ in range(6):
        candidate = os.path.join(here, '..', 'catalogs', 'step-catalog-en.json')
        candidate = os.path.normpath(candidate)
        if os.path.isfile(candidate):
            return candidate
        here = os.path.dirname(here)
    return None


def _load_catalog():
    """Return dicts keyed by step name and step id."""
    path = _find_catalog()
    if path is None:
        return {}, {}
    with open(path, encoding='utf-8') as f:
        entries = json.load(f)
    by_name = {e['name']: e for e in entries if 'name' in e}
    by_id = {e['id']: e for e in entries if 'id' in e}
    return by_name, by_id


CATALOG_BY_NAME, CATALOG_BY_ID = _load_catalog()


# ---------------------------------------------------------------------------
# XML helpers
# ---------------------------------------------------------------------------

def _calc(el, selector='Calculation'):
    """Extract text from a <Calculation> child (handles CDATA transparently)."""
    if el is None:
        return ''
    node = el.find(selector)
    if node is not None and node.text:
        return node.text
    return ''


def _attr(el, tag, attr, default=''):
    """Get an attribute from a child element."""
    if el is None:
        return default
    child = el.find(tag)
    if child is not None:
        return child.get(attr, default)
    return default


# ---------------------------------------------------------------------------
# Step renderers — hand-coded for structurally unique steps
# ---------------------------------------------------------------------------

def _render_comment(step):
    """# (comment) — id 89"""
    text_el = step.find('Text')
    text = text_el.text if text_el is not None and text_el.text else ''
    if text:
        return f'# {text}', (False, False)
    return '', (False, False)  # blank line


def _render_if(step):
    """If — id 68"""
    calc = _calc(step)
    return f'If [ {calc} ]' if calc else 'If', (False, True)


def _render_else_if(step):
    """Else If — id 125"""
    calc = _calc(step)
    return f'Else If [ {calc} ]' if calc else 'Else If', (True, True)


def _render_else(step):
    """Else — id 69"""
    return 'Else', (True, True)


def _render_end_if(step):
    """End If — id 70"""
    return 'End If', (True, False)


def _render_loop(step):
    """Loop — id 71"""
    return 'Loop', (False, True)


def _render_exit_loop_if(step):
    """Exit Loop If — id 72"""
    calc = _calc(step)
    return f'Exit Loop If [ {calc} ]', (False, False)


def _render_end_loop(step):
    """End Loop — id 73"""
    return 'End Loop', (True, False)


def _render_exit_script(step):
    """Exit Script — id 103"""
    calc = _calc(step)
    if calc:
        return f'Exit Script [ Text Result: {calc} ]', (False, False)
    return 'Exit Script', (False, False)


def _render_set_variable(step):
    """Set Variable — id 141"""
    name = ''
    name_el = step.find('Name')
    if name_el is not None and name_el.text:
        name = name_el.text

    value = _calc(step, 'Value/Calculation')
    rep = _calc(step, 'Repetition/Calculation')

    rep_suffix = ''
    if rep and rep.strip() != '1':
        rep_suffix = f'[{rep.strip()}]'

    return f'Set Variable [ {name}{rep_suffix} ; Value: {value} ]', (False, False)


def _render_allow_user_abort(step):
    """Allow User Abort — id 85"""
    state = _attr(step, 'Set', 'state', 'False')
    label = 'On' if state == 'True' else 'Off'
    return f'Allow User Abort [ {label} ]', (False, False)


def _render_set_error_capture(step):
    """Set Error Capture — id 86"""
    state = _attr(step, 'Set', 'state', 'True')
    label = 'On' if state == 'True' else 'Off'
    return f'Set Error Capture [ {label} ]', (False, False)


def _render_perform_script(step):
    """Perform Script — id 1"""
    script_el = step.find('Script')
    script_name = script_el.get('name', '') if script_el is not None else ''
    calc = _calc(step)

    # Check for external file reference
    file_ref = step.find('FileReference')
    file_name = file_ref.get('name', '') if file_ref is not None else ''
    file_str = f' ; File: "{file_name}"' if file_name else ''

    parts = [f'From list ; "{script_name}"']
    if calc:
        parts.append(f'Parameter: {calc}')
    if file_str:
        parts.append(file_str.lstrip(' ; '))

    return f'Perform Script [ {" ; ".join(parts)} ]', (False, False)


def _render_set_field(step):
    """Set Field — id 76"""
    field_el = step.find('Field')
    table = field_el.get('table', '') if field_el is not None else ''
    fname = field_el.get('name', '') if field_el is not None else ''
    field_ref = f'{table}::{fname}' if table else fname
    calc = _calc(step)
    return f'Set Field [ {field_ref} ; {calc} ]', (False, False)


def _render_go_to_layout(step):
    """Go to Layout — id 6"""
    dest = _attr(step, 'LayoutDestination', 'value', '')
    if dest == 'OriginalLayout':
        return 'Go to Layout [ original layout ]', (False, False)
    layout_el = step.find('Layout')
    name = layout_el.get('name', '') if layout_el is not None else ''
    return f'Go to Layout [ "{name}" ]', (False, False)


def _render_show_custom_dialog(step):
    """Show Custom Dialog — id 87"""
    title = _calc(step, 'Title/Calculation')
    message = _calc(step, 'Message/Calculation')
    parts = []
    if title:
        parts.append(f'Title: {title}')
    if message:
        parts.append(f'Message: {message}')
    if parts:
        return f'Show Custom Dialog [ {" ; ".join(parts)} ]', (False, False)
    return 'Show Custom Dialog', (False, False)


def _render_commit_records(step):
    """Commit Records/Requests — id 75"""
    no_interact = _attr(step, 'NoInteract', 'state', 'False')
    dialog = 'Off' if no_interact == 'True' else 'On'
    return f'Commit Records/Requests [ With dialog: {dialog} ]', (False, False)


def _render_go_to_object(step):
    """Go to Object — id 124"""
    obj_calc = _calc(step, 'ObjectName/Calculation')
    # Strip surrounding quotes from calc
    name = obj_calc.strip('"')
    return f'Go to Object [ Object Name: "{name}" ]', (False, False)


def _render_new_window(step):
    """New Window — id 122"""
    parts = []
    name_calc = _calc(step, 'Name/Calculation')
    if name_calc:
        parts.append(f'Name: {name_calc}')
    styles = step.find('NewWndStyles')
    if styles is not None:
        style = styles.get('Style', 'Document')
        if style != 'Document':
            parts.append(f'Style: {style}')
    layout_el = step.find('Layout')
    if layout_el is not None:
        lname = layout_el.get('name', '')
        if lname:
            parts.append(f'Layout: "{lname}"')
    height = _calc(step, 'Height/Calculation')
    width = _calc(step, 'Width/Calculation')
    if height:
        parts.append(f'Height: {height}')
    if width:
        parts.append(f'Width: {width}')
    if parts:
        return f'New Window [ {" ; ".join(parts)} ]', (False, False)
    return 'New Window', (False, False)


def _render_close_window(step):
    """Close Window — id 53"""
    mode = _attr(step, 'Window', 'value', 'Current')
    if mode == 'ByName':
        name = _calc(step, 'Name/Calculation')
        return f'Close Window [ Name: {name} ]', (False, False)
    return 'Close Window [ Current ]', (False, False)


def _render_insert_text(step):
    """Insert Text — id 61 (used for doc blocks)"""
    text_el = step.find('Text')
    text = text_el.text if text_el is not None and text_el.text else ''
    field_el = step.find('Field')
    if field_el is not None:
        # Variable target (e.g. $README doc block)
        field_text = field_el.text if field_el.text else ''
        if field_text:
            # Collapse multi-line for single-line display
            collapsed = text.replace('\r', ' | ').replace('\n', ' | ')
            if len(collapsed) > 120:
                collapsed = collapsed[:117] + '...'
            return f'Insert Text [ {field_text} ; {collapsed} ]', (False, False)
    # Regular Insert Text with field target element attributes
    if field_el is not None:
        table = field_el.get('table', '')
        fname = field_el.get('name', '')
        field_ref = f'{table}::{fname}' if table else fname
        return f'Insert Text [ {field_ref} ]', (False, False)
    return f'Insert Text [ {text[:80] if text else ""} ]', (False, False)


# Hand-coded renderer dispatch — keyed by step name (from XML name attribute)
RENDERERS = {
    '# (comment)': _render_comment,
    'If': _render_if,
    'Else If': _render_else_if,
    'Else': _render_else,
    'End If': _render_end_if,
    'Loop': _render_loop,
    'Exit Loop If': _render_exit_loop_if,
    'End Loop': _render_end_loop,
    'Exit Script': _render_exit_script,
    'Set Variable': _render_set_variable,
    'Allow User Abort': _render_allow_user_abort,
    'Set Error Capture': _render_set_error_capture,
    'Perform Script': _render_perform_script,
    'Set Field': _render_set_field,
    'Go to Layout': _render_go_to_layout,
    'Show Custom Dialog': _render_show_custom_dialog,
    'Commit Records/Requests': _render_commit_records,
    'Go to Object': _render_go_to_object,
    'New Window': _render_new_window,
    'Close Window': _render_close_window,
    'Insert Text': _render_insert_text,
}


# ---------------------------------------------------------------------------
# Generic catalog-driven renderer (fallback)
# ---------------------------------------------------------------------------

def _find_el(step, xml_el):
    """Find an element by xmlElement path, handling '@attr' paths gracefully.

    Catalog paths like 'UniversalPathList/@type' use XPath attribute syntax
    that ET.find() does not support.  Split on '/@' and find the parent
    element instead, returning it (the caller reads the attribute separately).
    Plain paths are passed through to ET.find() unchanged.
    """
    if not xml_el:
        return None
    if '/@' in xml_el:
        el_path = xml_el.split('/@')[0]
        return step.find(el_path) if el_path else step
    return step.find(xml_el)


def _render_generic(step):
    """
    Render any step not in RENDERERS using the catalog's param definitions.
    Extracts child elements based on catalog param types and builds bracket content.
    """
    step_name = step.get('name', 'Unknown')
    entry = CATALOG_BY_NAME.get(step_name, {})
    params = entry.get('params', [])

    if not params:
        # No-param step — check if self-closing
        if entry.get('selfClosing', False):
            return step_name, (False, False)
        # Check for any child elements that might have content
        if len(list(step)) == 0:
            return step_name, (False, False)

    parts = []

    for param in params:
        xml_el = param.get('xmlElement', '')
        param_type = param.get('type', '')
        wrapper = param.get('wrapperElement', '')
        hr_label = param.get('hrLabel', '')

        value = ''

        if param_type == 'boolean':
            attr_name = param.get('xmlAttr', 'state')
            el = _find_el(step, xml_el)
            if el is not None:
                raw = el.get(attr_name, param.get('defaultValue', 'False'))
                # Map XML state to HR label
                enum_map = param.get('hrEnumValues', {})
                if enum_map:
                    value = enum_map.get(raw, raw)
                else:
                    value = 'On' if raw == 'True' else 'Off'
            else:
                continue

        elif param_type == 'calculation':
            if wrapper:
                value = _calc(step, f'{wrapper}/Calculation')
            else:
                value = _calc(step)
            if not value:
                continue

        elif param_type == 'namedCalc':
            search = f'{wrapper}/Calculation' if wrapper else f'{xml_el}/Calculation'
            value = _calc(step, search)
            if not value:
                continue

        elif param_type == 'text':
            el = _find_el(step, xml_el)
            if el is not None and el.text:
                value = el.text
            else:
                continue

        elif param_type == 'field':
            el = _find_el(step, xml_el)
            if el is not None:
                table = el.get('table', '')
                fname = el.get('name', '')
                value = f'{table}::{fname}' if table else fname
            else:
                continue

        elif param_type == 'enum':
            attr_name = param.get('xmlAttr', 'value')
            el = _find_el(step, xml_el)
            if el is not None:
                value = el.get(attr_name, '')
            else:
                continue

        elif param_type == 'layout':
            el = _find_el(step, xml_el) or step.find('Layout')
            if el is not None:
                value = f'"{el.get("name", "")}"'
            else:
                continue

        elif param_type == 'script':
            el = _find_el(step, xml_el) or step.find('Script')
            if el is not None:
                value = f'"{el.get("name", "")}"'
            else:
                continue

        elif param_type == 'flagElement':
            el = _find_el(step, xml_el)
            if el is not None:
                value = 'On'
            else:
                continue

        else:
            # Unhandled param type — try to extract text
            el = _find_el(step, xml_el)
            if el is not None and el.text:
                value = el.text
            else:
                continue

        if value:
            if hr_label:
                parts.append(f'{hr_label}: {value}')
            else:
                parts.append(value)

    if parts:
        return f'{step_name} [ {" ; ".join(parts)} ]', (False, False)
    return step_name, (False, False)


# ---------------------------------------------------------------------------
# Main renderer
# ---------------------------------------------------------------------------

def render_step(step):
    """
    Render a single <Step> element to HR text.

    Returns:
        (line_text, (close_before, open_after))
    """
    step_name = step.get('name', '')

    renderer = RENDERERS.get(step_name)
    if renderer:
        return renderer(step)

    return _render_generic(step)


def snippet_to_hr(xml_string):
    """
    Convert an fmxmlsnippet XML string to human-readable script text.

    Returns a list of HR lines (without line numbers).
    """
    root = ET.fromstring(xml_string)

    steps = root.findall('Step')
    lines = []
    indent = 0

    for step in steps:
        enabled = step.get('enable', 'True') == 'True'

        text, (close_before, open_after) = render_step(step)

        if close_before:
            indent = max(0, indent - 1)

        # Add disabled prefix
        if not enabled:
            text = f'// {text}'

        lines.append(INDENT * indent + text)

        if open_after:
            indent += 1

    return lines


def convert_file(xml_path, raw=False):
    """Parse an fmxmlsnippet file and return HR text."""
    with open(xml_path, encoding='utf-8') as f:
        xml_string = f.read()

    lines = snippet_to_hr(xml_string)

    if raw:
        return '\n'.join(lines)

    numbered = []
    for i, line in enumerate(lines, 1):
        numbered.append(f'{i}\t{line}')
    return '\n'.join(numbered)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(
        description='Convert fmxmlsnippet XML to human-readable script text.'
    )
    parser.add_argument('input', help='Path to fmxmlsnippet XML file')
    parser.add_argument('--output', '-o', help='Write output to file instead of stdout')
    parser.add_argument('--raw', action='store_true',
                        help='Plain text without line numbers (for diff payloads)')
    args = parser.parse_args()

    result = convert_file(args.input, raw=args.raw)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(result)
            f.write('\n')
        print(f'Written to {args.output}', file=sys.stderr)
    else:
        print(result)
