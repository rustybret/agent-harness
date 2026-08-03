# Task 17 — Mailbox trace observability layer

## WHAT WAS TESTED

The trace layer that instruments the cross-project mailbox lifecycle so a human can
`tail -f .omo/mailbox-trace.jsonl` on two projects and watch one message's journey.

Surfaces / commands driven:

- `bun test packages/omo-opencode/src/features/cross-project-mailbox/trace` — the two new
  test files exercising `emitMailboxTrace` and `createFileTraceSink` directly.
- `bun test packages/omo-opencode/src/features/cross-project-mailbox` — the full feature
  suite, to prove the four instrumented host files (`project-message-tool.ts`,
  `project-note-tool.ts`, `idle-drain-processor.ts`, `route-note-dispatcher.ts`) plus the
  production wiring in `create-mailbox-hooks.ts` regress nothing.
- `bun run typecheck` — whole-workspace `tsgo --noEmit` across every package.
- `bun test .../shared/prompt-async-route-audit.test.ts` and
  `.../shared/mock-module-lifecycle-audit.test.ts` — the two static architectural audits.

Behavior the trace tests are meant to prove:

1. Each of the 10 phases (`sent | write-failed | blocked | received | validated | routed |
   lane-start | lane-end | acked | rolled-back`) emits exactly ONE sink line carrying
   `messageId` + `correlationId`, and one `[mailbox-trace] <phase>` log line.
2. A synchronously-throwing sink, an async-rejecting sink, and a throwing logger each never
   propagate out of `emitMailboxTrace` (fire-and-forget contract — a trace failure can never
   fail a send or a drain).
3. `detail` is truncated at 100 chars (`TRACE_DETAIL_PREVIEW_MAX`, same value as outbox
   `BODY_PREVIEW_MAX`).
4. No absolute filesystem path outside `repoRoot` survives in an emitted field: a
   repoRoot-anchored path is relativized, any other `/...` path is redacted to
   `[redacted-abs-path]`.
5. Absent optional fields are omitted (no `undefined` keys on the JSON line), so the trace
   record joins cleanly against `coordination_notes/.pending.json`.

## WHAT WAS OBSERVED

- Trace module suite: `10 pass / 0 fail / 56 expect() calls` across 2 files.
- Full mailbox feature suite AFTER the change AND after the LOC refactor:
  `723 pass / 0 fail / 6120 expect() calls` across 54 files. No reduced count (task added
  +10 trace tests; prior head baseline ~713).
- `bun run typecheck`: `TYPECHECK_EXIT=0`.
- Static audits: `11 pass / 0 fail` (prompt-async-route-audit + mock-module-lifecycle-audit).
  No raw `session.prompt`/`promptAsync` introduced; no module-top-level `mock.module` — the
  throwing/rejecting sinks are injected via the `MailboxTraceSink` DI port.
- Pure LOC of every touched/created file, post-refactor:
  - `trace/types.ts` 37, `trace/trace-log.ts` 16, `trace/emit-trace.ts` 66, `trace/index.ts` 11
    — all under the 200 soft limit.
  - `hooks/idle-drain-processor.ts` 247, `hooks/route-note-dispatcher.ts` 246 — both back
    under the 250 ceiling. The trace additions initially pushed them to 258/249; extracting the
    shared `traceIdentity(note)` mapping into the trace module (removing the duplicated local
    note→identity helpers in both hosts) restored them.
- `.gitignore`: `.omo/mailbox-trace.jsonl` added immediately after `.omo/mailbox-outbox.jsonl`
  under the `# cross-project agent mailbox` comment.

Isolation: no live opencode/codex process was spawned or killed; the file-sink test writes only
into a `mkdtemp()` temp dir and removes it in `afterEach`. No real `.omo/mailbox-trace.jsonl`
was written by the suite.

## WHY IT IS ENOUGH

The task descopes the cipher-relay e2e in favor of live-session observation, so the trace layer
IS the instrument under verification. The tests assert the machine-consumable contract that a
live `tail` depends on: every lifecycle edge emits one structured line, the identity keys
(`messageId`/`correlationId`) are always present to join sender and receiver artifacts, the
routing verdict fields are sourced from the same `routeMetadata()` the pending record uses (so
trace and `.pending.json` cannot disagree), and the fire-and-forget guarantee is proven against
three distinct failure modes (sync throw, async reject, logger throw). The security assertions
(100-char cap, absolute-path redaction) are the ones that matter for a repo whose maintainer had
a prior token leak. The full 723-test suite proves the four instrumented host functions and the
production `emitTrace` wiring changed no existing behavior.

## WHAT WAS OMITTED

- No live two-project `tail -f` capture is included here — that is F3's live-session
  observation step, which this layer enables; running it requires spawning real sessions, which
  this subagent is under a standing safety hold NOT to do.
- Raw log/env dumps are not copied; the tests use an injected collecting logger, and no secret
  material (bridge tokens, API keys, auth headers) is ever passed to the trace layer — only
  `detail` is free-form and it is capped + path-redacted.
- `lsp_diagnostics` was not used for the changed files: it doubles the package path
  (`packages/omo-opencode/packages/omo-opencode/...`) in this workspace; `bun run typecheck`
  (exit 0) is the authoritative type gate used instead.


---

## ADDENDUM — write-failed emit (F-review DEFECT 2 correction)

### WHAT WAS TESTED

The `write-failed` phase was declared in `MAILBOX_TRACE_PHASES` in the original task but had
ZERO production emit sites — dead vocabulary. Because the cipher-relay live e2e is descoped and
`.omo/mailbox-trace.jsonl` is now the sole verification instrument, a note that fails to LAND on
the receiver is the single most important failure a live observer needs to see, and it produced
no trace line. This correction wires the emit at the note-write boundary in both send tools and
proves it.

Surfaces / commands driven:

- `bun test packages/omo-opencode/src/features/cross-project-mailbox` — full feature suite,
  now including the two new `write-failed` tests (one per send tool).
- `bun run typecheck` — whole-workspace `tsgo --noEmit`.
- `grep -rn '"write-failed"' --include="*.ts" packages/.../cross-project-mailbox` — to prove
  production emit sites now exist in BOTH send tools, not just `types.ts`.

Behavior the two new tests prove (each asserts all three):

1. the note write throws → exactly ONE `write-failed` event is emitted;
2. that event carries a non-empty `messageId` and a `correlationId`;
3. the ORIGINAL error still propagates out of the send call
   (`await expect(call).rejects.toBe(boom)` — same instance, proving no swallow).

### WHAT WAS OBSERVED

- `grep '"write-failed"'` now returns production emit sites in BOTH send tools plus the shared
  helper:
  - `send-tool/project-message-tool.ts:139  phase: "write-failed"`
  - `send-tool/project-note-tool.ts:125      phase: "write-failed"`
  - `send-tool/send-trace.ts:11  type SendTracePhase = "blocked" | "sent" | "write-failed"`
  (the pre-existing unrelated `todo-inject.test.ts:186` log-string hit remains; `types.ts:6`
  remains the union declaration.)
- Full mailbox feature suite: `725 pass / 0 fail / 6134 expect()` across 54 files
  (was 723; +2 write-failed tests). No reduced count.
- `bun run typecheck`: `TYPECHECK_EXIT=0`.
- Static audits: `11 pass / 0 fail` (prompt-async-route-audit + mock-module-lifecycle-audit) —
  no raw prompt call, no module-top-level `mock.module` (the throwing sink is DI'd via the new
  optional `traceSink` dep).
- Pure LOC after the correction + its refactor:
  - `send-tool/send-trace.ts` 47 (new; collapses the 4 duplicated emit blocks across both tools),
  - `send-tool/offline-launch.ts` 41 (new; extracted `defaultWriteNote` + `maybeLaunchOfflineTarget`
    to pull `project-message-tool.ts` back under the ceiling),
  - `send-tool/project-message-tool.ts` 231 (was 261 mid-correction, baseline 218),
  - `send-tool/project-note-tool.ts` 192.
  All under the 250 hard ceiling.

### WHY IT IS ENOUGH

The `write-failed` line is the receiver-never-got-it signal a human watching two tails depends
on. Control flow is provably unchanged: the try/catch emits then rethrows the exact same error
instance, and the 725-test suite (every pre-existing send/preflight/outbox behavior) stays green,
so this is pure observability. The DI sink lets the test observe the emit without a real disk or
`mock.module`, and asserting `.rejects.toBe(boom)` (identity, not just rejection) proves the send
still fails exactly as before.

### WHAT WAS OMITTED

- No live two-project capture of a `write-failed` line — that is F3's live-session step, which
  this emit enables; producing it requires spawning real sessions, which is under the standing
  safety hold.
- `write-failed` is emitted only for the note-WRITE boundary (the `deps.writeNote` /
  `defaultWriteNote` branch), per the task scope. A later `appendOutboxLog` failure is out of
  scope for this phase and intentionally not traced as `write-failed` (the note already landed).
