#!/usr/bin/env python3
"""
switch_layout_themes.py - Switch all layouts to the target theme.

Enters Layout mode, navigates to layout #1, then steps through every layout
via Layouts > Go to Layout > Next, applying Change Theme on each one.

No navigation by name needed — works entirely via FileMaker's UI.
Requires FileMaker Pro to be open with the solution active.

Usage:
    python3 agent/scripts/switch_layout_themes.py
    python3 agent/scripts/switch_layout_themes.py --count 137
    python3 agent/scripts/switch_layout_themes.py --theme Druga
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
AGENT_ROOT = HERE.parent
LAYOUTS_BASE = AGENT_ROOT / "xml_parsed" / "layouts"

DEFAULT_THEME = "Druga"


def count_layouts(solution: str) -> int:
    layouts_dir = LAYOUTS_BASE / solution
    if not layouts_dir.is_dir():
        return 0
    return sum(1 for _ in layouts_dir.rglob("*.xml"))


def infer_solution() -> str:
    context_path = AGENT_ROOT / "CONTEXT.json"
    try:
        import json
        with open(context_path, "r", encoding="utf-8") as f:
            return json.load(f).get("solution", "")
    except Exception:
        pass
    # Fall back to first folder found under layouts/
    for d in sorted(LAYOUTS_BASE.iterdir()):
        if d.is_dir():
            return d.name
    raise SystemExit("Cannot infer solution name.")


def build_applescript(layout_count: int, theme: str) -> str:
    return f"""\
set totalLayouts to {layout_count}
set themeName to "{theme}"
set changeThemeKeyword to "Change Theme"
set successCount to 0
set failCount to 0

-- Bring FileMaker to front
tell application "FileMaker Pro"
    activate
end tell
delay 1.0

-- Enter Layout Mode if not already there
tell application "System Events"
    tell process "FileMaker Pro"
        if (name of menus of menu bar 1) does not contain "Layouts" then
            repeat with mi in menu items of menu "View" of menu bar 1
                try
                    if (name of mi) = "Layout Mode" then
                        click mi
                        exit repeat
                    end if
                end try
            end repeat
        end if
    end tell
end tell

-- Wait for Layout mode
repeat 20 times
    delay 0.4
    tell application "System Events"
        tell process "FileMaker Pro"
            try
                if (name of menus of menu bar 1) contains "Layouts" then
                    exit repeat
                end if
            end try
        end tell
    end tell
end repeat
delay 0.3

-- Navigate to layout #1 via Layouts > Go to Layout > Go To...
tell application "System Events"
    tell process "FileMaker Pro"
        click menu item "Go To..." of menu 1 of menu item "Go to Layout" of menu "Layouts" of menu bar 1
    end tell
end tell
delay 3.0
tell application "System Events"
    tell process "FileMaker Pro"
        try
            set tf to text field 1 of sheet 1 of window 1
            set value of tf to "1"
            key code 36
        on error
            key code 53
        end try
    end tell
end tell
delay 3.0

-- Loop through all layouts: change theme, then go to next
repeat with i from 1 to totalLayouts

    -- Change Theme
    tell application "System Events"
        tell process "FileMaker Pro"
            try
                repeat with mi in menu items of menu "Layouts" of menu bar 1
                    if (name of mi) contains changeThemeKeyword then
                        click mi
                        exit repeat
                    end if
                end repeat
            on error errMsg
                set failCount to failCount + 1
            end try
        end tell
    end tell
    delay 3.0

    -- Type theme name, arrow down to first result, confirm
    tell application "System Events"
        tell process "FileMaker Pro"
            try
                keystroke themeName
                delay 1.0
                -- Try to find and click the confirm button
                try
                    set targetSheet to sheet 1 of window 1
                    set foundBtn to false
                    repeat with btn in buttons of targetSheet
                        try
                            if (name of btn) contains changeThemeKeyword then
                                click btn
                                set foundBtn to true
                                exit repeat
                            end if
                        end try
                    end repeat
                    if not foundBtn then
                        key code 36
                    end if
                on error
                    key code 36
                end try
                set successCount to successCount + 1
            on error errMsg
                key code 53
                set failCount to failCount + 1
            end try
        end tell
    end tell
    delay 3.0

    -- Go to next layout (skip on the last one)
    if i < totalLayouts then
        tell application "System Events"
            tell process "FileMaker Pro"
                try
                    click menu item "Next" of menu 1 of menu item "Go to Layout" of menu "Layouts" of menu bar 1
                end try
            end tell
        end tell
        delay 3.0
    end if

end repeat

-- Exit Layout Mode
tell application "System Events"
    tell process "FileMaker Pro"
        try
            repeat with mi in menu items of menu "View" of menu bar 1
                if (name of mi) = "Browse Mode" then
                    click mi
                    exit repeat
                end if
            end repeat
        end try
    end tell
end tell

return "Done: " & successCount & " OK, " & failCount & " failed"
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Switch all layouts to the target theme."
    )
    parser.add_argument("--theme", default=DEFAULT_THEME, help="Theme name to apply")
    parser.add_argument("--count", type=int, help="Number of layouts (auto-detected if omitted)")
    parser.add_argument("--solution", help="Solution folder name under xml_parsed/layouts/")
    args = parser.parse_args()

    solution = args.solution or infer_solution()
    layout_count = args.count or count_layouts(solution)

    if layout_count == 0:
        raise SystemExit("Could not determine layout count. Pass --count N.")

    print(f"Solution : {solution}")
    print(f"Theme    : {args.theme}")
    print(f"Layouts  : {layout_count}")
    print()
    print("Starting — do not touch mouse or keyboard...")
    print("(Close Script Workspace in FileMaker before running)")
    print()

    script = build_applescript(layout_count, args.theme)
    result = subprocess.run(["osascript"], input=script, capture_output=True, text=True)

    if result.returncode != 0:
        err = result.stderr.strip().splitlines()[0] if result.stderr.strip() else "unknown"
        print(f"AppleScript error: {err}", file=sys.stderr)
        return 1

    print(result.stdout.strip() or "Completed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
