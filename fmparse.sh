#!/usr/bin/env bash
#
# fmparse.sh - Parse FileMaker XML exports into exploded components
#
# Usage:
#   ./fmparse.sh -s <solution-name> <path-to-export> [options]
#
# Arguments:
#   -s, --solution     Solution name (required). Used as the subfolder under xml_exports/.
#   <path-to-export>   Path to a .xml file or directory containing XML exports
#
# Options (passed through to fm-xml-export-exploder):
#   -a, --all-lines    Parse all lines (skip less important ones by default)
#   -l, --lossless     Retain all information from the main XML
#   -t, --output-tree  Specify the output tree root folder: domain or db (default: domain)
#   -h, --help         Show this help message
#
# Environment Variables:
#   FM_XML_EXPLODER_BIN  Full path to fm-xml-export-exploder (if not in PATH)
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Output helpers -- all messages go to stdout so FileMaker can capture them
# ---------------------------------------------------------------------------
msg()   { echo "==> $1"; }
error() { echo "ERROR: $1"; exit 1; }

# ---------------------------------------------------------------------------
# Resolve project root relative to this script's location
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

XML_EXPORTS_DIR="$PROJECT_ROOT/xml_exports"
XML_PARSED_DIR="$PROJECT_ROOT/agent/xml_parsed"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
OUTPUT_TREE="domain"
EXPLODER_FLAGS=()

# Optional: Specify the full path to fm-xml-export-exploder if it's not in PATH
# Can also be set as an environment variable before calling this script
# Example: FM_XML_EXPLODER_BIN="$HOME/bin/fm-xml-export-exploder"
FM_XML_EXPLODER_BIN="${FM_XML_EXPLODER_BIN:-}"

# ---------------------------------------------------------------------------
# Usage / help
# ---------------------------------------------------------------------------
usage() {
    cat <<EOF
Usage: $(basename -- "$0") -s <solution-name> <path-to-export> [options]

Parse a FileMaker XML export and archive it under a solution-specific, dated
folder in xml_exports/. The export is then exploded into agent/xml_parsed/
using fm-xml-export-exploder.

Supports the FileMaker data separation model: each solution file (e.g.
UI.fmp12, Data.fmp12) is parsed independently. Only the subdirectories
matching the given solution name are cleared — other solutions' data in
xml_parsed/ is preserved.

Exports are archived as:  xml_exports/<solution-name>/YYYY-MM-DD/

Arguments:
  <path-to-export>                Path to a .xml file or a directory containing XML exports

Required:
  -s, --solution SOLUTION_NAME    Solution name used as the subfolder under xml_exports/

Options:
  -a, --all-lines                 Parse all lines (reduces noise filtering)
  -l, --lossless                  Retain all information from the XML
  -t, --output-tree TYPE          Output tree format: domain (default) or db
  -h, --help                      Show this help message

Environment Variables:
  FM_XML_EXPLODER_BIN             Full path to fm-xml-export-exploder binary
                                  Use this if the binary is not in PATH (e.g., ~/bin/fm-xml-export-exploder)

Examples:
  $(basename -- "$0") -s "Invoice Solution" /path/to/export.xml
  $(basename -- "$0") -s "Invoice Solution" /path/to/exports/ --all-lines
  FM_XML_EXPLODER_BIN=~/bin/fm-xml-export-exploder $(basename -- "$0") -s "Invoice Solution" /path/to/export.xml
EOF
    exit 0
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
EXPORT_PATH=""
SOLUTION_NAME=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            ;;
        -s|--solution)
            if [[ -z "${2:-}" ]]; then
                error "--solution requires a solution name"
            fi
            SOLUTION_NAME="$2"
            shift 2
            ;;
        -a|--all-lines)
            EXPLODER_FLAGS+=("--all-lines")
            shift
            ;;
        -l|--lossless)
            EXPLODER_FLAGS+=("--lossless")
            shift
            ;;
        -t|--output-tree)
            if [[ -z "${2:-}" ]]; then
                error "--output-tree requires a value (domain or db)"
            fi
            OUTPUT_TREE="$2"
            shift 2
            ;;
        -*)
            error "Unknown option '$1'. Run '$(basename -- "$0") --help' for usage."
            ;;
        *)
            if [[ -n "$EXPORT_PATH" ]]; then
                error "Multiple export paths provided. Only one is allowed."
            fi
            EXPORT_PATH="$1"
            shift
            ;;
    esac
done

if [[ -z "$SOLUTION_NAME" ]]; then
    error "No solution name provided. Use -s <solution-name>. Run '$(basename -- "$0") --help' for usage."
fi

if [[ -z "$EXPORT_PATH" ]]; then
    error "No export path provided. Run '$(basename -- "$0") --help' for usage."
fi

# Resolve to absolute path
EXPORT_PATH="$(cd "$(dirname -- "$EXPORT_PATH")" && pwd)/$(basename -- "$EXPORT_PATH")"

if [[ ! -e "$EXPORT_PATH" ]]; then
    error "Path does not exist: $EXPORT_PATH"
fi

# ---------------------------------------------------------------------------
# Verify fm-xml-export-exploder is available
# ---------------------------------------------------------------------------
EXPLODER_CMD=""

# First check if a custom path is specified
if [[ -n "$FM_XML_EXPLODER_BIN" ]]; then
    # Expand tilde if present (handle environments where HOME is not set)
    if [[ "$FM_XML_EXPLODER_BIN" =~ ^~ ]]; then
        # If HOME is not set, try to determine it
        if [[ -z "${HOME:-}" ]]; then
            HOME="$(eval echo ~$(whoami))"
        fi
        FM_XML_EXPLODER_BIN="${FM_XML_EXPLODER_BIN/#\~/$HOME}"
    fi

    if [[ -x "$FM_XML_EXPLODER_BIN" ]]; then
        EXPLODER_CMD="$FM_XML_EXPLODER_BIN"
        msg "Using fm-xml-export-exploder from: $EXPLODER_CMD"
    else
        error "Specified FM_XML_EXPLODER_BIN is not executable or does not exist: $FM_XML_EXPLODER_BIN"
    fi
else
    # Fall back to PATH lookup
    if command -v fm-xml-export-exploder &>/dev/null; then
        EXPLODER_CMD="fm-xml-export-exploder"
    else
        error "fm-xml-export-exploder is not installed or not in PATH. Install it from https://github.com/bc-m/fm-xml-export-exploder and ensure the binary is available on your PATH, or set FM_XML_EXPLODER_BIN to the full path."
    fi
fi

# ---------------------------------------------------------------------------
# Check exploder version — enable --obfuscate-passwords for versions > 0.6.1
# ---------------------------------------------------------------------------
_exploder_version="$("$EXPLODER_CMD" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
if [[ -n "$_exploder_version" ]]; then
    _ver_gt() {
        local IFS=.
        local i v1=($1) v2=($2)
        for ((i=0; i<${#v1[@]} || i<${#v2[@]}; i++)); do
            local a="${v1[i]:-0}" b="${v2[i]:-0}"
            if ((a > b)); then return 0; fi
            if ((a < b)); then return 1; fi
        done
        return 1  # equal is not greater
    }
    if _ver_gt "$_exploder_version" "0.6.1"; then
        EXPLODER_FLAGS+=("--obfuscate-passwords")
        msg "Exploder v$_exploder_version: enabling --obfuscate-passwords"
    fi
fi

# ---------------------------------------------------------------------------
# Step 1: Create dated archive folder in xml_exports/<solution>/
# ---------------------------------------------------------------------------
TODAY="$(date +%Y-%m-%d)"
SOLUTION_DIR="$XML_EXPORTS_DIR/$SOLUTION_NAME"
ARCHIVE_DIR="$SOLUTION_DIR/$TODAY"

if [[ -d "$ARCHIVE_DIR" ]]; then
    COUNTER=2
    while [[ -d "$SOLUTION_DIR/${TODAY}-${COUNTER}" ]]; do
        ((COUNTER++))
    done
    ARCHIVE_DIR="$SOLUTION_DIR/${TODAY}-${COUNTER}"
fi

mkdir -p "$ARCHIVE_DIR"
msg "Created archive folder: xml_exports/$SOLUTION_NAME/$(basename -- "$ARCHIVE_DIR")"

# ---------------------------------------------------------------------------
# Step 2: Copy export to archive
# ---------------------------------------------------------------------------
if [[ -f "$EXPORT_PATH" ]]; then
    cp -- "$EXPORT_PATH" "$ARCHIVE_DIR/"
    msg "Copied file: $(basename -- "$EXPORT_PATH") -> xml_exports/$SOLUTION_NAME/$(basename -- "$ARCHIVE_DIR")/"
elif [[ -d "$EXPORT_PATH" ]]; then
    # Copy directory contents robustly (includes dotfiles, safe with odd names).
    cp -R -- "$EXPORT_PATH"/. "$ARCHIVE_DIR"/
    msg "Copied directory contents -> xml_exports/$SOLUTION_NAME/$(basename -- "$ARCHIVE_DIR")/"
else
    error "Path is neither a file nor a directory: $EXPORT_PATH"
fi

# ---------------------------------------------------------------------------
# Step 3: Clear xml_parsed for this solution only
# ---------------------------------------------------------------------------
# Supports multi-file solutions (data separation model). Each domain
# subdirectory (scripts/, tables/, layouts/, etc.) contains a subfolder per
# solution name. Only the current solution's subfolders are removed so that
# other solution files (e.g. Data.fmp12 alongside UI.fmp12) are preserved.
# ---------------------------------------------------------------------------
if [[ -d "$XML_PARSED_DIR" ]]; then
    # Remove only subdirectories named after this solution, preserving other solutions
    find "$XML_PARSED_DIR" -mindepth 2 -maxdepth 2 -type d -name "$SOLUTION_NAME" -exec rm -rf {} +
    msg "Cleared agent/xml_parsed/*/$SOLUTION_NAME/"
else
    mkdir -p "$XML_PARSED_DIR"
    msg "Created agent/xml_parsed/"
fi

# ---------------------------------------------------------------------------
# Step 4: Run fm-xml-export-exploder
# ---------------------------------------------------------------------------
msg "Running fm-xml-export-exploder..."
msg "  Source: xml_exports/$SOLUTION_NAME/$(basename -- "$ARCHIVE_DIR")"
msg "  Target: agent/xml_parsed/"
msg "  Output tree: $OUTPUT_TREE"
if [[ ${#EXPLODER_FLAGS[@]} -gt 0 ]]; then
    msg "  Flags: ${EXPLODER_FLAGS[*]}"
fi

"$EXPLODER_CMD" \
    --output_tree "$OUTPUT_TREE" \
    ${EXPLODER_FLAGS[@]+"${EXPLODER_FLAGS[@]}"} \
    "$ARCHIVE_DIR" \
    "$XML_PARSED_DIR"

# ---------------------------------------------------------------------------
# Step 5: Report parse results
# ---------------------------------------------------------------------------
FILE_COUNT="$(find "$XML_PARSED_DIR" -type f | wc -l | tr -d ' ')"
DIR_COUNT="$(find "$XML_PARSED_DIR" -type d | wc -l | tr -d ' ')"

echo ""
msg "Parse complete."
msg "  Archived to: xml_exports/$SOLUTION_NAME/$(basename -- "$ARCHIVE_DIR")/"
msg "  Parsed into: agent/xml_parsed/ ($FILE_COUNT files in $DIR_COUNT directories)"

# ---------------------------------------------------------------------------
# Step 6: Remove sensitive items listed in agent/config/removals.json
# ---------------------------------------------------------------------------
# agent/config/removals.json is a developer-maintained, gitignored file that
# lists scripts and custom functions to delete after every export for a given
# solution. Use it for any items that contain passwords, API keys, or other
# credentials that must not be readable by AI agents.
#
# Format:
#   {
#     "Solution Name": {
#       "scripts": ["Script One", "Script Two"],
#       "custom_functions": ["FunctionName"]
#     }
#   }
#
# See agent/config/removals.json.example for a full template.
# ---------------------------------------------------------------------------

_REMOVALS_FILE="$PROJECT_ROOT/agent/config/removals.json"

if [[ -f "$_REMOVALS_FILE" ]]; then
    _PYTHON=""
    if command -v python3 &>/dev/null; then
        _PYTHON="python3"
    elif command -v python &>/dev/null; then
        _PYTHON="python"
    fi

    if [[ -n "$_PYTHON" ]]; then
        _removals="$("$_PYTHON" - "$SOLUTION_NAME" "$_REMOVALS_FILE" <<'PYEOF'
import json, sys
solution, path = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
entries = data.get(solution, {})
for item in entries.get("scripts", []):
    if isinstance(item, int):
        print("script:id:" + str(item))
    else:
        print("script:name:" + str(item))
for item in entries.get("custom_functions", []):
    if isinstance(item, int):
        print("custom_function:id:" + str(item))
    else:
        print("custom_function:name:" + str(item))
PYEOF
)"
        if [[ -n "$_removals" ]]; then
            echo ""
            msg "Removing sensitive items (agent/config/removals.json)..."
            while IFS= read -r _entry; do
                _obj_type="${_entry%%:*}"          # script | custom_function
                _rest="${_entry#*:}"
                _lookup_type="${_rest%%:*}"        # name | id
                _value="${_rest#*:}"

                case "$_obj_type" in
                    script)
                        _search_dirs=(
                            "$XML_PARSED_DIR/scripts/$SOLUTION_NAME"
                            "$XML_PARSED_DIR/scripts_sanitized/$SOLUTION_NAME"
                            "$XML_PARSED_DIR/script_stubs/$SOLUTION_NAME"
                        )
                        ;;
                    custom_function)
                        _search_dirs=(
                            "$XML_PARSED_DIR/custom_function_calcs/$SOLUTION_NAME"
                            "$XML_PARSED_DIR/custom_function_stubs/$SOLUTION_NAME"
                            "$XML_PARSED_DIR/custom_functions_sanitized/$SOLUTION_NAME"
                        )
                        ;;
                    *) continue ;;
                esac

                # Files are named "Object Name - ID NNN.ext"
                if [[ "$_lookup_type" == "id" ]]; then
                    _pattern="* - ID $_value.*"
                else
                    _pattern="$_value - ID *.*"
                fi

                _removed=0
                for _dir in "${_search_dirs[@]}"; do
                    [[ -d "$_dir" ]] || continue
                    while IFS= read -r _file; do
                        rm -f -- "$_file"
                        ((_removed++)) || true
                    done < <(find "$_dir" -type f -name "$_pattern" 2>/dev/null)
                done

                if [[ $_removed -gt 0 ]]; then
                    msg "  Removed [$_lookup_type=$_value]: ($_removed file(s))"
                else
                    msg "  Not found (skipped): [$_lookup_type=$_value]"
                fi
            done <<< "$_removals"
        fi
    else
        msg "Warning: Python not found — skipping removals.json. Remove sensitive items from agent/xml_parsed/ manually."
    fi
fi

# ---------------------------------------------------------------------------
# Step 7: Regenerate context index files
# ---------------------------------------------------------------------------
echo ""
msg "Running fmcontext.sh to regenerate agent/context/$SOLUTION_NAME/..."
"$SCRIPT_DIR/fmcontext.sh" -s "$SOLUTION_NAME"
