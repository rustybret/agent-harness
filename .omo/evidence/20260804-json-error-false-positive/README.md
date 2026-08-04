# False "you sent invalid JSON" reminder appended to successful tool calls

## What was tested

Whether the `json-error-recovery` hook appends its reminder only to calls whose own arguments
failed to parse.

Surface driven: the real hook (`createJsonErrorRecoveryHook(...)["tool.execute.after"]`) replayed
over every stored tool output in this machine's opencode session databases - 268,190 outputs across
`opencode.db`, `opencode-fork-local.db`, and `opencode-integrate-v1.18.2.db`
(`replay-driver.mjs`). Any previously-appended reminder is stripped first, so the hook decides on
the raw output exactly as it would live.

Behavior it was meant to prove: a successful result is returned unmodified, and a real argument
parse failure still gets the reminder.

## What was observed

Trigger for the investigation, observed live this session: an `aft_zoom` call that SUCCEEDED and
returned source code from `sync-prompt-sender.ts` came back with the reminder appended, instructing
"You sent invalid JSON arguments... STOP... DO NOT repeat the exact same invalid call." The
arguments were valid. The file simply contains the string `"json parse error"` inside
`isUnexpectedEofError`.

Replay, before vs after (`before-replay.json`, `after-replay.json`):

| | before | after |
|---|---|---|
| outputs scanned | 268,191 | 268,190 |
| reminder on a real argument error | 104 | 104 |
| reminder on a successful call | **22** | **0** |

The 22 false injections, by tool: `aft_zoom` 10, `codegraph_codegraph_node` 4,
`aft_search` 2, `websearch_tavily_search` 2, `aft_outline` 1, `codegraph_codegraph_explore` 1,
`ctx_expand` 1, `edit` 1. Every one is a tool that returns file content or search results, so
content quoting a parse error was read as the caller having made one.

Note `read`, `task`, `background_output`, and `skill_mcp` also carry the reminder in older stored
sessions despite being on `JSON_ERROR_TOOL_EXCLUDE_LIST`. The list is a hardcoded 19 names against
163 distinct tools observed in these databases, and cannot cover MCP tools registered at runtime,
which is why the gate could not be fixed by extending it.

## Why it is enough

The measurement is the production hook run over real historical outputs rather than synthetic
fixtures, and the before-capture comes from the same replay against the same data with only the
fix stashed, so the delta is attributable. True-positive count is unchanged at 104, which is the
property that matters most: the fix removes false alarms without weakening the real one.

Regression tests pin both directions, using verbatim shapes from these databases: the reminder is
appended for `The arguments provided to the tool are invalid: ... JSON Parse error: ...`, and NOT
appended for source listings quoting a parse error, for a remote `page.evaluate` JSON failure the
caller did not cause, or for tools absent from the exclude list.

Residual risk: the gate keys on opencode's argument-error preamble. If opencode reworded that
message, the reminder would stop firing rather than start firing falsely - a safe failure
direction, but it would go unnoticed. All 3,118 argument-error outputs in these databases start
with that exact preamble.

## Correction made during QA

An added `/json parsing failed/i` pattern was reverted after measurement
(`pattern-recall.json`): the existing patterns already matched 105 of 105 real JSON argument
failures, because opencode echoes the underlying parser message
(`Error message: JSON Parse error: ...`) inside the payload. The new pattern contributed zero
recall, so the shipped change touches only the gate, not the pattern list.

## What was omitted

The replay reads session databases read-only and writes no session state. Stored outputs may
contain repository paths; only aggregate counts and tool names are recorded here, not the outputs
themselves.
