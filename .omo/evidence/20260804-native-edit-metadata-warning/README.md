# Missing-metadata warning on every successful native edit

## What was tested

Whether `tool.execute.after` warns about unrecoverable omo metadata for a tool that never publishes
omo metadata in the first place.

Surface driven: the real handler `createToolExecuteAfterHandler(...)` invoked with the tool name,
metadata shape, and config combination observed live (`driver.mjs`), plus a database check
correlating each warned call id against its stored tool result.

Behavior it was meant to prove: the warning marks a real recovery failure, not a supported
configuration.

## What was observed

The live plugin log carried 44 instances of
`[tool-execute-after] Unable to recover stored metadata and no native session linkage was present`,
all for `"tool":"edit"`.

Correlating those 44 call ids against the session databases:

| property | value |
|---|---|
| call ids found in a database | 44 / 44 |
| whose output starts with `Error` | 0 |
| whose output was a successful edit | 44 |
| whose final metadata was present | 44 (keys `diagnostics,diff,filediff,truncated`) |

So every warned call SUCCEEDED and carried complete metadata - opencode's own `edit` metadata. The
`edit` entry in `METADATA_LINKED_TOOLS` describes omo's `hashline_edit` tool, which replaces `edit`
only when `experimental.hashline_edit` is enabled. That flag is absent from the live config, so the
native tool was running, and it neither stores nor needs omo metadata.

Driver, before vs after (`before-warning-matrix.json`, `after-warning-matrix.json`):

| case | before | after |
|---|---|---|
| native `edit`, `hashline_edit` off (the live config) | warned | **silent** |
| `edit` with `hashline_edit` on, metadata missing | warned | warned |
| `task` with no stored metadata | warned | warned |
| `read` (never metadata-linked) | silent | silent |

Only the case that was wrong changed.

## Why it is enough

The correlation is the load-bearing part: it rules out the alternative explanation that these were
genuine failures on error paths. Every warned call is present in a database with a successful
output and populated native metadata, so a store lookup failing for them is expected rather than a
defect being reported.

The driver exercises the production handler, and the before-capture is the same driver with only
the changed file stashed. Regression tests pin both directions of the config gate, so re-adding an
unconditional expectation for `edit` fails the suite.

Residual risk: the gate keys on `hashline_edit`. If another tool later becomes conditionally
replaced by an omo equivalent, it needs an entry in `CONFIG_GATED_METADATA_TOOLS` or it will warn
the same way.

## What was omitted

The database correlation reads session stores read-only. Only call ids, tool names, metadata key
names, and output prefixes were recorded; no file contents or diffs from those sessions appear
here.
