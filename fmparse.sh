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

set -euo pipefail

# ---------------------------------------------------------------------------
# Output helpers -- all messages go to stdout so FileMaker can capture them
# ---------------------------------------------------------------------------
msg()   { echo "==> $1"; }
error() { echo "ERROR: $1"; exit 1; }

# ---------------------------------------------------------------------------
# Resolve project root relative to this script's location
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

XML_EXPORTS_DIR="$PROJECT_ROOT/xml_exports"
XML_PARSED_DIR="$PROJECT_ROOT/agent/xml_parsed"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
OUTPUT_TREE="domain"
EXPLODER_FLAGS=()

# ---------------------------------------------------------------------------
# Usage / help
# ---------------------------------------------------------------------------
usage() {
    cat <<EOF
Usage: $(basename "$0") -s <solution-name> <path-to-export> [options]

Parse a FileMaker XML export and archive it under a solution-specific, dated
folder in xml_exports/. The export is then exploded into agent/xml_parsed/
using fm-xml-export-exploder.

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

Examples:
  $(basename "$0") -s "Invoice Solution" /path/to/export.xml
  $(basename "$0") -s "Invoice Solution" /path/to/exports/ --all-lines
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
            error "Unknown option '$1'. Run '$(basename "$0") --help' for usage."
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
    error "No solution name provided. Use -s <solution-name>. Run '$(basename "$0") --help' for usage."
fi

if [[ -z "$EXPORT_PATH" ]]; then
    error "No export path provided. Run '$(basename "$0") --help' for usage."
fi

# Resolve to absolute path
EXPORT_PATH="$(cd "$(dirname "$EXPORT_PATH")" && pwd)/$(basename "$EXPORT_PATH")"

if [[ ! -e "$EXPORT_PATH" ]]; then
    error "Path does not exist: $EXPORT_PATH"
fi

# ---------------------------------------------------------------------------
# Verify fm-xml-export-exploder is available
# ---------------------------------------------------------------------------
if ! command -v fm-xml-export-exploder &>/dev/null; then
    error "fm-xml-export-exploder is not installed or not in PATH. Install it from https://github.com/nicktahoe/fm-xml-export-exploder and ensure the binary is available on your PATH."
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
msg "Created archive folder: xml_exports/$SOLUTION_NAME/$(basename "$ARCHIVE_DIR")"

# ---------------------------------------------------------------------------
# Step 2: Copy export to archive
# ---------------------------------------------------------------------------
if [[ -f "$EXPORT_PATH" ]]; then
    cp "$EXPORT_PATH" "$ARCHIVE_DIR/"
    msg "Copied file: $(basename "$EXPORT_PATH") -> xml_exports/$SOLUTION_NAME/$(basename "$ARCHIVE_DIR")/"
elif [[ -d "$EXPORT_PATH" ]]; then
    cp -R "$EXPORT_PATH"/* "$ARCHIVE_DIR"/
    msg "Copied directory contents -> xml_exports/$SOLUTION_NAME/$(basename "$ARCHIVE_DIR")/"
else
    error "Path is neither a file nor a directory: $EXPORT_PATH"
fi

# ---------------------------------------------------------------------------
# Step 3: Clear xml_parsed
# ---------------------------------------------------------------------------
if [[ -d "$XML_PARSED_DIR" ]]; then
    rm -rf "$XML_PARSED_DIR"/*
    msg "Cleared agent/xml_parsed/"
else
    mkdir -p "$XML_PARSED_DIR"
    msg "Created agent/xml_parsed/"
fi

# ---------------------------------------------------------------------------
# Step 4: Run fm-xml-export-exploder
# ---------------------------------------------------------------------------
msg "Running fm-xml-export-exploder..."
msg "  Source: xml_exports/$SOLUTION_NAME/$(basename "$ARCHIVE_DIR")"
msg "  Target: agent/xml_parsed/"
msg "  Output tree: $OUTPUT_TREE"
if [[ ${#EXPLODER_FLAGS[@]} -gt 0 ]]; then
    msg "  Flags: ${EXPLODER_FLAGS[*]}"
fi

fm-xml-export-exploder \
    --output_tree "$OUTPUT_TREE" \
    ${EXPLODER_FLAGS[@]+"${EXPLODER_FLAGS[@]}"} \
    "$ARCHIVE_DIR" \
    "$XML_PARSED_DIR"

# ---------------------------------------------------------------------------
# Step 5: Report results
# ---------------------------------------------------------------------------
FILE_COUNT="$(find "$XML_PARSED_DIR" -type f | wc -l | tr -d ' ')"
DIR_COUNT="$(find "$XML_PARSED_DIR" -type d | wc -l | tr -d ' ')"

echo ""
msg "Done!"
msg "  Archived to: xml_exports/$SOLUTION_NAME/$(basename "$ARCHIVE_DIR")/"
msg "  Parsed into: agent/xml_parsed/ ($FILE_COUNT files in $DIR_COUNT directories)"
