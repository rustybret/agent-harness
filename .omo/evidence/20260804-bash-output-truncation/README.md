# A single bash command could return more than the whole context window

## How this was found

Mining the stored session database rather than the log - asking which tools produce outputs large
enough to matter, across 272k recorded tool calls.

| tool | calls | max output | over 200k chars |
|---|---|---|---|
| **bash** | 93,771 | **4,287,531 chars (~1.07M tokens)** | 1 |
| task | 5,348 | 674,612 | 7 |
| read | 69,355 | 155,669 | 0 |

The largest bash output was a plain `git log` with no pager limit. At roughly a million tokens it is
larger than any context window this harness targets, so ingesting it cannot be recovered from - the
session is over.

`bash` was not in `TRUNCATABLE_TOOLS`, so nothing capped it.

## Root cause

`TRUNCATABLE_TOOLS` listed `grep`, `glob`, `webfetch`, `interactive_bash`, and friends - tools whose
output size is bounded by what they are pointed at rather than by anything the caller controls.
`bash` has exactly that property and the highest call volume of any tool in the database, but was
absent from the list.

`interactive_bash` being present while `bash` was missing is the tell: the same hazard was already
recognized for the tmux variant.

## What was tested

`drive.mjs` drives the REAL truncator hook against the REAL 4.29 MB output pulled from the live
session database, plus a representative typical bash output from the same table. It reports the
before and after size of each.

## What was observed

| case | before | after |
|---|---|---|
| **largest real bash output (`git log`)** | 4,287,531 chars (~1,071,883 tokens) | **192,369 chars (~48,092 tokens)** |
| typical bash output | 507 chars | 507 chars, unchanged |

Captures: `before-bash-untouched.json`, `after-bash-truncatable.json`. Before-capture taken by
reverting only `tool-output-truncator.ts` via `git stash`, re-running the same driver, then
restoring - byte-identical restore verified with `cmp` (`RESTORED-OK`).

## Why this is enough

The oversized case is real production data, not a synthetic string, and the small case proves the
change is not a blanket rewrite: 99.5% of the 93,771 recorded bash calls are under 20k chars and the
average is 1,341, so almost every call is untouched.

The truncator is also context-aware in a live session - it caps at half the remaining context window
or 50k tokens, whichever is smaller. The QA run exercises the conservative fallback path (no session
context available offline), which is the more pessimistic of the two.

Two regression tests: the oversized case (verified to FAIL against the original list) and the small
case that must stay unchanged.

Full suite green, typecheck clean.

## What was omitted

No secrets involved; the driver opens the session database read-only and prints only sizes and a
40-character command prefix. The tool output itself is never written to disk.

Not addressed: `task` outputs reached 674k chars (7 calls over 200k). Subagent results are a
different shape - they are a summary the parent asked for rather than an unbounded dump - so capping
them needs its own judgment about what to keep, and is not folded into this change.
