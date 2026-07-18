# Reference Binding on Paste: Name Wins, ID Is Advisory

When FileMaker reads an fmxmlsnippet from the clipboard, it resolves every object reference **by name**, not by the `id` attribute. The `id` in a pasted snippet is advisory: FileMaker overwrites it with whatever the name resolves to in the destination file.

This holds uniformly for field, script, and layout references. There is no per-class exception.

## The rule

| Snippet contains | FileMaker does |
|---|---|
| Correct `id` + correct `name` | Binds by name. ID unchanged (it already agreed). |
| `id="0"` or no `id` attribute + valid `name` | Binds by name, **writes the correct ID**. |
| Nonexistent `id` (e.g. `99999`) + valid `name` | Binds by name, **writes the correct ID**. |
| **Valid but wrong `id` + valid `name`** | **Binds by name.** The wrong ID is discarded. |
| Any `id` + **name that does not exist** | **Reference is silently blanked** to `id="0" name=""`. No error. |

## Why this is the only design that could work

`fmxmlsnippet` is a *transport* format — its purpose is moving objects between files. Object IDs are assigned from a per-file counter and are meaningless outside the file that assigned them (see [[script-ids]]). A snippet pasted into a different file would bind to arbitrary wrong objects if IDs were authoritative. Name is the only key that survives the trip.

FileMaker emits IDs when you *copy* because it is serialising internal state. It discards them when you *paste* because it is re-resolving into a new namespace.

## Do not confuse paste binding with internal storage

These are two different mechanisms, and conflating them leads to exactly the wrong priorities:

- **Internally**, FileMaker stores a resolved reference by ID. This is why renaming a field or script does not break callers, and why deleting and re-creating an object *does* break them — the old ID is gone.
- **On paste**, FileMaker resolves by name to *produce* that internal ID.

So the ID matters *inside* the file, and the name matters *on the wire*. When authoring fmxmlsnippet, only the name is load-bearing.

## The failure mode that matters

An unresolvable name does **not** raise an error, refuse the paste, or emit an `<Unknown>` marker. The reference is silently emptied and the step is kept.

For `Set Field`, a blanked target is especially dangerous. Per the step's own documented behaviour, *if the field target is omitted, the active field in Browse or Find mode is used*. So a single mistyped or hallucinated field name yields a `Set Field` that silently writes to **whatever field happens to be focused at runtime** — wrong data, no diagnostic, no error code.

This is a fail-open design. FileMaker will not catch a bad name for you.

## Practical consequences for generated code

- **Get names right; do not fuss over IDs.** Emitting `id="0"` is safe and correct. Emitting a *wrong-but-valid* ID is also harmless, because the name overrides it — but see the caution below.
- **Validating names before paste is a safety requirement, not a style preference.** It is the only guard that exists. Resolve every TO, field, script, and layout name against `CONTEXT.json` or the solution's `*.index` files before generating a step. FMLint rules `R004`/`R006`/`R007` are this guard.
- **A stale or wrongly-scoped `CONTEXT.json` makes the guard fail open**, which is precisely the condition this behaviour punishes. Refresh context before generating field references rather than after.
- **Caution on carrying IDs:** since names win, IDs in generated snippets are decorative. Their only real value is as a *cross-check* — a name/ID disagreement caught by FMLint is a strong signal that the context is stale or the name is wrong. Carrying them is defensible for that reason alone; relying on them is not.

## Scope — what this does not cover

This behaviour is about **object references**. It does not imply that a names-only text representation of a script is lossless.

Many script step parameters have no textual form at all: saved find requests (`Perform Find [ Restore ]`), sort orders (`Sort Records [ Restore ]`), import/export field mappings, print setup state, and `Show Custom Dialog` button definitions all live as structured XML with no text rendering. Reference binding says nothing about those — they are a separate and genuine loss surface.

Also untested here: references across external data sources / file references, duplicate object names within one file, and value list / custom function references.

## Evidence

Established by direct experiment against a live solution (2026-07-16), not inference. A 15-case probe covering field, script, and layout references was pasted into FileMaker and copied straight back out, and the returned snippet was diffed against the sent one. All 15 cases agreed: name authoritative, ID rewritten, unresolvable name blanked.

The decisive pair sent a *valid* ID pointing at one object alongside the name of a different object, in both directions. FileMaker bound the name and rewrote the ID both times.

Probe and readback: `agent/sandbox/PROBE__RefBinding.xml`, `agent/sandbox/PROBE__RefBinding_result.xml`.

## References

| Name | Type | Local doc | Claris help |
|------|------|-----------|-------------|
| Set Field | step | `agent/docs/filemaker/script-steps/set-field.md` | [set-field](https://help.claris.com/en/pro-help/content/set-field.html) |
| Perform Script | step | `agent/docs/filemaker/script-steps/perform-script.md` | [perform-script](https://help.claris.com/en/pro-help/content/perform-script.html) |
| Go to Layout | step | `agent/docs/filemaker/script-steps/go-to-layout.md` | [go-to-layout](https://help.claris.com/en/pro-help/content/go-to-layout.html) |
| Perform Find | step | `agent/docs/filemaker/script-steps/perform-find.md` | [perform-find](https://help.claris.com/en/pro-help/content/perform-find.html) |
| Show Custom Dialog | step | `agent/docs/filemaker/script-steps/show-custom-dialog.md` | [show-custom-dialog](https://help.claris.com/en/pro-help/content/show-custom-dialog.html) |

Related knowledge: [[script-ids]], [[paste-dependency-order]], [[disambiguation]] (fmxmlsnippet vs SaXML).
