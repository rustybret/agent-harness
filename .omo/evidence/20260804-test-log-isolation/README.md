# `bun test` wrote fixture noise into the developer's live plugin log

## What was tested

The real plugin logger path used by an installed plugin
(`packages/utils/src/logging/logger.ts` → `packages/omo-opencode/src/shared/logger.ts`), and the
test preload `test-setup.ts` that is supposed to keep test runs hermetic.

Method: measure the live log at `$TMPDIR/oh-my-opencode.log` immediately before and after a real
`bun test` run, counting both total lines and lines carrying test-fixture session ids
(`parent-session`, `ses-active`, `parent-cancel`).

Behavior it was meant to prove: running the suite leaves the developer's live diagnostic log
untouched.

## What was observed

The plugin logger defaults to `<tmpdir>/oh-my-opencode.log`. `test-setup.ts` already isolates HOME,
the cache dir, and rules storage — but not the log. So every test that exercises a code path with a
`log()` call appended to the same file an operator reads when diagnosing a real session.

Scoped measurement, one directory (`packages/omo-opencode/src/features/background-agent`, 758 tests):

| | before | after |
|---|---|---|
| lines added to the live log | **3,437** | **282** |
| fixture-id lines added | **525** | **0** |

Full suite (13,740 tests), after the fix: **0** fixture lines added
(`after-live-log-delta.json`). The residual live-log lines during that window are not from the test
run — `residual-live-log-lines.txt` shows they are `mailbox sidebar readdir failed` and
`[mailbox-idle-drain] skipped` from the developer's own live TUI session running concurrently.

This is why the earlier log mining pass initially misread three high-count entries as production
defects:

| log line | count | actual source |
|---|---|---|
| `[background-agent] Failed to inspect parent session messages` | 509 | test fixture `parent-session` |
| `[tui-sidebar] mirror flush failed` | 456 | test fixture, stub client without `session.status` |
| `[background-agent] Failed to read session activity` | 2 | test fixture `ses-active` |

All three are tests deliberately exercising failure paths. They were indistinguishable from
production failures in the log, and combined with the 50 MB rotation cap they evict real
diagnostics.

## Why it is enough

The measurement drives the real suite against the real default log path and counts bytes actually
written, before and after, at both scoped and full-suite level. The before-capture was produced by
reverting only the preload line, so the delta isolates this change.

Unit coverage pins the mechanism at both layers: `packages/utils/src/logging/logger.test.ts`
(override honoured, override applied *after* construction still honoured — the case that matters
since loggers are created at module scope, and default path unchanged when unset) and
`packages/omo-opencode/src/shared/logger-path.pin.test.ts` (the historical installed-plugin path
`<tmpdir>/oh-my-opencode.log` is still pinned with no override, and the shim redirects when set).

Full suite: 13,733 pass / 0 fail. Typecheck clean.

Note: resolution had to be made lazy. The first attempt set the env var in the preload and still
leaked 525 lines, because hoisted imports construct the module-scope logger before the assignment
runs.

Residual risk: a process that sets `OMO_LOG_DIR` to an unwritable directory silently loses log
output. That matches the logger's existing behavior of swallowing write failures.

## What was omitted

Live log contents are reported as counts and message prefixes rather than copied, since the file
interleaves real session ids, absolute paths from unrelated projects, and prompt fragments.
