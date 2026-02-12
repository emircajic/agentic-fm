# Overview

This project was created to take advantage of AI coding via agents and makes a best possible attempt at using AI to compose code which can be directly pasted into FileMaker Pro.

# Background

FileMaker Pro is a closed code environment. It does not use individual text files to store its code. All logic and schema is stored within its binary files.

FileMaker provides a few input/output methods as XML which provide a clear definition of how a FileMaker database solution is structured.

- The Database Design Report was the first method and is accessed via the Tools menu in FileMaker.
- The newer more modern output method is Save a Copy as XML. Also available in the Tools menu and most importantly a script step available for automated delivery of the XML.
- The third XML format used for input and output of FileMaker elements is the fmxmlsnippet format which is used via the OS clipboard. This is the format that will is commonly used in order to get AI generated scripts and other elements back into FileMaker via the clipboard.

# Objective

The goals of this project is to provide the guidance and context needed by agentic processes for creating reliable scripts and other FileMaker related elements which can be taken from AI back into FileMaker Pro.

# Project Structure

```
agentic-fm/
├── fmparse.sh              # CLI tool for parsing XML exports
├── agent/
│   ├── sandbox/             # Newly created scripts (output)
│   ├── scripts/             # Utility scripts for processing XML
│   ├── snippet_examples/    # Boilerplate fmxmlsnippet templates
│   └── xml_parsed/          # Exploded XML from the current solution (reference only)
└── xml_exports/             # Versioned XML exports organized by solution
    └── <Solution Name>/
        ├── 2026-02-09/
        │   ├── Solution.xml
        │   └── ddr/
        └── 2026-02-12/
            └── ...
```

- **xml_exports/** -- Contains a dedicated subfolder for each FileMaker solution. Within each solution folder, exports are archived in dated subfolders (YYYY-MM-DD). This allows multiple solutions to be managed from the same project and preserves a history of exports over time.
- **agent/xml_parsed/** -- Always contains the most recent exploded XML for the active solution. This folder is cleared and repopulated each time `fmparse.sh` is run.

# fmparse.sh

A command line tool that archives a FileMaker XML export and parses it into its component parts using [fm-xml-export-exploder](https://github.com/nicktahoe/fm-xml-export-exploder).

**Usage:**

```bash
./fmparse.sh -s "<Solution Name>" <path-to-export> [options]
```

**Required:**

- `-s, --solution` -- The solution name. Determines the subfolder under `xml_exports/` where the export is archived.

**Options:**

- `-a, --all-lines` -- Parse all lines (reduces noise filtering)
- `-l, --lossless` -- Retain all information from the XML
- `-t, --output-tree` -- Output tree format: `domain` (default) or `db`

**Examples:**

```bash
# Parse a single XML file
./fmparse.sh -s "Invoice Solution" /path/to/Invoice\ Solution.xml

# Parse a directory of exports with all lines
./fmparse.sh -s "Invoice Solution" /path/to/exports/ --all-lines
```

**Dependencies:**

- [fm-xml-export-exploder](https://github.com/bc-m/fm-xml-export-exploder) must be installed and available on your PATH.
