# FileMaker Setup

This folder contains the FileMaker artifacts that connect your solution to the agentic-fm toolchain.

| File | Purpose |
| ---- | ------- |
| `Context.fmfn` | Custom function source — install into your FileMaker solution |
| `agentic-fm.xml` | Companion script group — paste into your Script Workspace |

---

## Dependencies

### FileMaker Pro 21.0+

The minimum version is **21.0**. Earlier versions lack:

- `GetTableDDL` — used by `Context.fmfn` to discover foreign key relationships
- `While` — used by `Context.fmfn` for iteration
- `Create Data File` / `Open Data File` / `Write to Data File` / `Close Data File` — used by the **Push Context** script to write `CONTEXT.json` to disk

### MBS FileMaker Plugin

Required for the **Explode XML** companion script only. The other two scripts (**Get agentic-fm path** and **Push Context**) use only native FileMaker steps.

The plugin provides the shell execution functions the script relies on:

- `Shell.New` / `Shell.Execute` / `Shell.Wait` / `Shell.Release`
- `Shell.AddEnvironment` / `Shell.SetArgumentsList`
- `Shell.ReadOutputText` / `Shell.ReadErrorText`
- `Path.FileMakerPathToNativePath`
- `IsError`

Download from [monkeybreadsoftware.com/filemaker](https://www.monkeybreadsoftware.com/filemaker/). A free trial is available. Without this plugin, you can still run `fmparse.sh` manually from the terminal — only the in-FileMaker automation is unavailable.

### fm-xml-export-exploder

A Rust binary that parses FileMaker XML exports into individual files. Used by both the **Explode XML** companion script and by `fmparse.sh` when called from the terminal.

**Installation:**

1. Download the macOS binary from the [releases page](https://github.com/bc-m/fm-xml-export-exploder/releases/latest)
2. On first run, macOS Gatekeeper will block it. Right-click the binary and choose **Open** once to clear the restriction.
3. Create `~/bin/` if it does not exist:
   ```bash
   mkdir -p ~/bin
   ```
4. Move the binary there and make it executable:
   ```bash
   mv fm-xml-export-exploder ~/bin/
   chmod +x ~/bin/fm-xml-export-exploder
   ```

> **Why `~/bin`?** The **Explode XML** companion script passes `~/bin/fm-xml-export-exploder` as the `FM_XML_EXPLODER_BIN` environment variable to `fmparse.sh`. If you want to place the binary elsewhere, open the **Explode XML** script in FileMaker and update the `Set Variable [$env ; MBS("Shell.AddEnvironment" ...)]` step to reflect your actual path.

When calling `fmparse.sh` directly from the terminal you can also override the path via the environment variable:

```bash
FM_XML_EXPLODER_BIN=/your/path/fm-xml-export-exploder ./fmparse.sh -s "My Solution" /path/to/export.xml
```

### Python 3

Required for `agent/scripts/clipboard.py` (loading snippets onto the FileMaker clipboard) and `agent/scripts/validate_snippet.py` (post-generation validation).

Python 3 ships with macOS or can be installed via [Homebrew](https://brew.sh):

```bash
brew install python
```

A virtual environment is included in the repo at `.venv/`. Always activate it before running Python scripts:

```bash
source .venv/bin/activate
```

### xmllint

Required by `fmcontext.sh` to extract data from the exploded XML. Ships with macOS as part of libxml2. On Linux:

```bash
apt-get install libxml2-utils
```

---

## Installation Steps

### 1. Install the Context custom function

1. Open your FileMaker solution in FileMaker Pro.
2. Go to **File > Manage > Custom Functions**.
3. Click **New** and create a function named `Context` with one parameter: `task` (type: Text).
4. Copy the entire contents of `filemaker/Context.fmfn` and paste it into the calculation editor.
5. Click **OK** and save.

### 2. Install the companion scripts

Load `filemaker/agentic-fm.xml` onto the FileMaker clipboard using `clipboard.py`, then paste into the Script Workspace:

```bash
source .venv/bin/activate
python agent/scripts/clipboard.py write filemaker/agentic-fm.xml
```

Switch to FileMaker, open the **Script Workspace** (**Scripts > Script Workspace**), click in the script list, and press **⌘V**. A folder named **agentic-fm** containing the three scripts will appear.

### 3. Configure the repo path

Run the **Get agentic-fm path** script once (from the Scripts menu or Script Workspace). A folder picker will appear. Select the root of the agentic-fm repo folder. The path is stored in `$$AGENTIC.FM` and persists for the session.

> This script must be run again each time FileMaker is relaunched, as global variables do not persist across sessions. Consider adding a call to it in your solution's startup script.

### 4. Run Explode XML

Run the **Explode XML** script to perform the first Save as XML export and populate `agent/xml_parsed/`. Re-run it any time the solution schema or scripts change.

> The script derives the `fmparse.sh` path from the `$$AGENTIC.FM` global variable set by **Get agentic-fm path**, so the repo can be located anywhere on disk.

### 5. Push Context before each AI session

Navigate to the layout you are working on and run the **Push Context** script. A dialog will prompt you for a task description. After you click OK, the context is written to `agent/CONTEXT.json` and you are ready to work with AI.

---

## Dependency Summary

| Dependency | Required By | Where to Get |
| ---------- | ----------- | ------------ |
| FileMaker Pro 21.0+ | Everything | [claris.com](https://www.claris.com) |
| MBS FileMaker Plugin | Explode XML script | [monkeybreadsoftware.com](https://www.monkeybreadsoftware.com/filemaker/) |
| fm-xml-export-exploder | Explode XML script, fmparse.sh | [GitHub releases](https://github.com/bc-m/fm-xml-export-exploder/releases/latest) |
| Python 3 | clipboard.py, validate_snippet.py | Ships with macOS or `brew install python` |
| xmllint | fmcontext.sh | Ships with macOS; `apt-get install libxml2-utils` on Linux |
