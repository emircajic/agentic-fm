# Script IDs Are File-Specific

FileMaker assigns internal numeric IDs to every object (scripts, fields, tables, layouts, value lists, etc.) using a monotonically incrementing counter stored inside each `.fmp12` file. These IDs are unique within a file but **not portable across files**.

## Key behaviours

- **IDs are assigned at creation time** and never reused within the same file, even if the object is deleted.
- **Copying a script (or folder of scripts) from one file to another** assigns entirely new IDs in the destination file. The script *name* is preserved but the ID changes.
- **The same script installed in two different files will have different IDs.** For example, `AGFMEvaluation` might be ID 16 in `agentic-fm.fmp12` and ID 315 in a test solution — same code, different IDs.
- **Perform Script references are stored internally by ID, not by name.** When a script calls another script, the reference is stored as `<Script id="N" name="ScriptName"/>`. If the target script is deleted and re-created, the old caller still points at the old (now non-existent) ID. This describes how FileMaker stores a reference *inside* a file — it is not how a reference is resolved when pasted from the clipboard, where the name is authoritative and the ID is ignored. See [[reference-binding-on-paste]].
- **CONTEXT.json provides the correct IDs** for the currently active solution. Always resolve IDs from CONTEXT.json or the solution's index files — never hardcode or carry forward IDs from a different file.

## Implications for documentation and planning

- **Never cite a script ID as a stable identifier** in documentation or plan files. IDs are only meaningful within the specific file they were assigned in.
- **Reference scripts by name** in documentation. If an ID must be cited (e.g., in a build log), always qualify it with the file name: "AGFMEvaluation (ID 16 in agentic-fm.fmp12)".
- **When verifying IDs**, grep the `xml_parsed/scripts_sanitized/{solution}/` directory — filenames include the ID: `AGFMEvaluation - ID 16.txt`.

## The same principle applies to all FM objects

Fields, table occurrences, layouts, value lists, custom functions, and custom menus all follow the same pattern. IDs are file-internal and change when objects are copied between files.

## References

| Name | Type | Local doc | Claris help |
|------|------|-----------|-------------|
| Perform Script | step | `agent/docs/filemaker/script-steps/perform-script.md` | [perform-script](https://help.claris.com/en/pro-help/content/perform-script.html) |
