# Mailbox menu rendered every project Disabled with no way to find out why

## What was tested

Reported live by art3d-pipeline: every project in the `project_message` menu showed as disabled,
and re-enabling one through the slash command did nothing. A restart of the server and TUI session
cleared it.

`drive.mjs` reproduces the operator-visible symptom against the real code path rather than a mock:
it builds a sandbox repo whose `.omo/omo.jsonc` is truncated mid-object (the shape a half-written
config edit leaves behind), then runs the real `createLiveMailboxConfigResolver` and the real
`buildTopMenu` over it, recording the rendered rows and everything the logger received.

The behavior under test is not the row states - it is whether the operator is given any way to tell
"the config could not be read" apart from "every sender is genuinely denied".

## What was observed

Identical symptom before and after, which is the point: the fix does not change what renders, only
whether the cause is discoverable.

| | before | after |
|---|---|---|
| rendered rows | `agent-harness=Disabled, atlas=Disabled, cloudhome=Disabled` | identical |
| `allDisabled` | `true` | `true` |
| `operatorIsTold` | **`false`** | **`true`** |
| log lines | `[]` | 1 line naming the repoRoot and `cause: "config did not validate"` |

Artifacts: `before-silent.json`, `after-reported.json`, driver at `drive.mjs`.

Root cause: `readFresh` in
`packages/omo-opencode/src/features/cross-project-mailbox/config/live-config.ts` returned the
caller's fallback from a bare `catch {}` and from an unchecked `!read.valid`. The fallback the TUI
passes carries no `senders`, and `buildTopMenu` marks a row `Disabled` whenever a sender entry is
missing - so an unreadable config renders exactly like a deliberate deny-all. A permission edit then
appears to do nothing, because the write lands correctly in `.omo/omo.jsonc` and the next read falls
back again.

Reporting is deduplicated by cause: the resolver sits behind a 3s cache on a menu that redraws, so
an undeduplicated line would arrive at render rate. This is the same non-event-at-poll-rate failure
already fixed twice today (P0-3, P0-14).

## Why it is enough

The driver exercises the real resolver and the real menu builder, so it proves the operator-visible
outcome rather than an internal call. The before/after pair isolates the change to observability -
the rows are byte-identical, so nothing about permission semantics moved.

Four regression tests in `live-config.test.ts` pin the behavior: invalid-config reporting,
throw-path cause capture, once-not-per-render deduplication, and re-reporting after a recovery.
All four fail against the original implementation and pass against the fix, so they are guards
rather than tautologies. Full suite green (13811 pass, 0 fail), typecheck clean.

Those four tests first observed reporting through the shared logger singleton, and passed alone but
failed in the full suite - another file replaces that module at import scope, so the resolver's own
tests were depending on a channel they do not own. The resolver now takes an injected `report`
callback (defaulting to `log`), matching the `reportError` injection used by the mailbox sidebar and
the project rule against `mock.module` on shared singletons. The QA driver deliberately does **not**
inject: it exercises the default path, so the production wiring through the real logger is what the
before/after artifacts prove.

Not covered: whether art3d's specific session hit the throw path or the invalid path. That session's
state is gone - it was cleared by the restart, and the machine-wide plugin log had already rotated
past it. Either path now reports itself, so the next occurrence is diagnosable from the log alone.

## What was omitted

The sandbox uses a synthetic broken config and three fabricated project ids. No real project
registry, config file, or mailbox content was read or written, so no credentials or private paths
appear in the artifacts beyond the temp directory name.
