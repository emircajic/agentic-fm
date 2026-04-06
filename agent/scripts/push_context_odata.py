#!/usr/bin/env python3
"""
push_context_odata.py - Refresh local CONTEXT.json via FileMaker OData.

This uses the hosted file's AGFMScriptBridge entry point to invoke the
AGFMEvaluation script, which evaluates Context(task) server-side and
returns the JSON payload over OData. The script then writes that payload
to local agent/CONTEXT.json.

This avoids exposing the companion server for context refreshes.

Credentials can come from:
1. agent/config/automation.json -> solutions.<name>.odata.username/password
2. env vars AGFM_ODATA_USERNAME / AGFM_ODATA_PASSWORD
3. interactive prompt for missing password
"""

from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
CONFIG_PATH = os.path.join(REPO_ROOT, "agent", "config", "automation.json")
CONTEXT_PATH = os.path.join(REPO_ROOT, "agent", "CONTEXT.json")


def load_config() -> dict:
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise SystemExit(f"Missing config: {CONFIG_PATH}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {CONFIG_PATH}: {exc}")


def infer_solution_name(config: dict, explicit: str | None) -> str:
    if explicit:
        return explicit

    try:
        with open(CONTEXT_PATH, "r", encoding="utf-8") as f:
            ctx = json.load(f)
        solution = ctx.get("solution", "")
        if solution:
            return solution
    except Exception:
        pass

    solutions = config.get("solutions", {})
    if len(solutions) == 1:
        return next(iter(solutions))

    available = ", ".join(sorted(solutions.keys())) or "(none configured)"
    raise SystemExit(
        "Could not infer solution name. "
        f"Pass --solution. Configured solutions: {available}"
    )


def build_bridge_url(odata_cfg: dict) -> str:
    base_url = odata_cfg.get("base_url", "").rstrip("/")
    database = odata_cfg.get("database", "")
    bridge = odata_cfg.get("script_bridge", "AGFMScriptBridge")
    if not base_url or not database:
        raise SystemExit("Missing odata.base_url or odata.database in automation.json")
    return f"{base_url}/fmi/odata/v4/{database}/Script.{bridge}"


def get_credentials(odata_cfg: dict, cli_username: str | None, cli_password: str | None) -> tuple[str, str]:
    username = (
        cli_username
        or os.environ.get("AGFM_ODATA_USERNAME")
        or odata_cfg.get("username", "")
    )
    password = (
        cli_password
        or os.environ.get("AGFM_ODATA_PASSWORD")
        or odata_cfg.get("password", "")
    )

    if not username:
        raise SystemExit(
            "Missing OData username. Pass --username, set AGFM_ODATA_USERNAME, "
            "or add odata.username to automation.json."
        )

    if not password:
        password = getpass.getpass("OData password: ")

    if not password:
        raise SystemExit("Missing OData password.")

    return username, password


def post_json(url: str, payload: dict, username: str, password: str) -> tuple[int, str]:
    auth = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def fm_string_literal(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def extract_json_payload(value: Any) -> Any:
    """Recursively unwrap JSON encoded as strings or nested fields."""
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return value
        try:
            return extract_json_payload(json.loads(text))
        except json.JSONDecodeError:
            return value

    if isinstance(value, dict):
        for key in ("scriptResult", "resultParameter", "result", "response", "value"):
            if key in value:
                return extract_json_payload(value[key])
        return value

    if isinstance(value, list) and len(value) == 1:
        return extract_json_payload(value[0])

    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh local CONTEXT.json over OData")
    parser.add_argument("task", help="Task description passed to FileMaker Context()")
    parser.add_argument("--layout", help="Optional layout name to navigate to first")
    parser.add_argument("--solution", help="Solution key from automation.json")
    parser.add_argument("--username", help="OData username override")
    parser.add_argument("--password", help="OData password override")
    parser.add_argument(
        "--repo-path",
        default=REPO_ROOT,
        help="Absolute path to the local agentic-fm repo (default: current repo)",
    )
    args = parser.parse_args()

    config = load_config()
    solution = infer_solution_name(config, args.solution)
    solution_cfg = config.get("solutions", {}).get(solution)
    if not solution_cfg:
        raise SystemExit(f"Solution '{solution}' not found in automation.json")

    odata_cfg = solution_cfg.get("odata", {})
    bridge_url = build_bridge_url(odata_cfg)
    username, password = get_credentials(odata_cfg, args.username, args.password)

    expression = f"Context ( {fm_string_literal(args.task)} )"

    inner_parameter = {
        "expression": expression,
    }
    if args.layout:
        inner_parameter["layout"] = args.layout

    payload = {
        "scriptParameterValue": json.dumps(
            {
                "script": "AGFMEvaluation",
                "parameter": json.dumps(inner_parameter, ensure_ascii=False),
            },
            ensure_ascii=False,
        )
    }

    status, raw = post_json(bridge_url, payload, username, password)
    parsed: Any = raw
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        pass

    unwrapped = extract_json_payload(parsed)
    if (
        isinstance(unwrapped, dict)
        and "current_layout" in unwrapped
        and "solution" in unwrapped
    ):
        context_obj = unwrapped
    elif isinstance(unwrapped, dict) and "success" in unwrapped:
        if not unwrapped.get("success"):
            print(json.dumps(unwrapped, ensure_ascii=False, indent=2))
            return 1
        context_json = unwrapped.get("result", "")
        try:
            context_obj = json.loads(context_json)
        except json.JSONDecodeError as exc:
            print(raw)
            print(f"\nReturned result was not valid CONTEXT.json payload: {exc}", file=sys.stderr)
            return 1
    elif isinstance(unwrapped, str):
        context_json = unwrapped
        try:
            context_obj = json.loads(context_json)
        except json.JSONDecodeError as exc:
            print(raw)
            print(f"\nReturned result was not valid CONTEXT.json payload: {exc}", file=sys.stderr)
            return 1
    else:
        print(raw)
        return 1

    os.makedirs(os.path.dirname(CONTEXT_PATH), exist_ok=True)
    with open(CONTEXT_PATH, "w", encoding="utf-8") as f:
        json.dump(context_obj, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(
        json.dumps(
            {
                "success": True,
                "path": CONTEXT_PATH,
                "solution": context_obj.get("solution", ""),
                "layout": context_obj.get("current_layout", {}).get("name", ""),
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    if 200 <= status < 300:
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
