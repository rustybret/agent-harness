# Idle-drain mailbox regression QA

## WHAT WAS TESTED
- Worktree: `/Volumes/Topper2TB/Git/agent-harness/.local-ignore/worktrees/idle-drain` on branch `fix/idle-drain-mailbox`, HEAD `83a797ffd40bb2dacdccc24087822b066babe7cf` at start.
- Failing-first regression: `bun test packages/omo-opencode/src/features/cross-project-mailbox/hooks/idle-drain-hook.test.ts` with new failing assertion `#then drains when the eligible primary resolves asynchronously from session history`; after red/green it was moved unchanged into `idle-drain-async-primary.test.ts` to avoid growing an already-oversized test file.
- Fixed cross-project mailbox suite: `bun test packages/omo-opencode/src/features/cross-project-mailbox`.
- Type gate: `bun run typecheck`.
- opencode-qa harness sanity: `.agents/skills/opencode-qa/scripts/lib/common.sh --self-check` from the isolated idle-drain worktree.

## WHAT WAS OBSERVED
- Red phase before fix: new regression test failed because `dispatchInternalPrompt` was called `0` times, proving the automatic idle path suppressed a queued note before dispatch when primary resolution was async/history-backed.
- Green phase after fix: targeted idle-drain hook test passed: `18 pass, 0 fail, 62 expect() calls`.
- Cross-project mailbox suite passed: `421 pass, 0 fail, 856 expect() calls, Ran 421 tests across 31 files`.
- Typecheck passed: `tsgo --noEmit && bun run typecheck:script && bun run typecheck:packages` completed with exit code 0.
- opencode-qa common self-check passed and proved the helper harness dependencies and isolated XDG sandbox behavior. See `opencode-qa-common-self-check.txt`.

## WHY IT IS ENOUGH
- The changed behavior is in `packages/omo-opencode/src/features/cross-project-mailbox/hooks/idle-drain-hook.ts`, not OpenCode core. The decisive user-visible failure was the heartbeat/session.idle automatic drain failing to surface queued notes while the manual drain succeeded.
- The regression test `idle-drain-async-primary.test.ts` drives the same automatic hook seam that heartbeat uses (`mailboxIdleDrain["session.idle"]`) and asserts a queued note reaches `dispatchInternalPrompt` and `markDispatched` when the eligible primary is resolved from session history instead of the volatile session-agent cache.
- The mailbox suite covers heartbeat wiring, mode detection, manual drain, validation, reservation, dedupe, and mailbox store behavior, reducing risk that the fallback changed delivery-pipeline semantics.
- The fix preserves prompt-async-gate invariants: delivery still goes through `dispatchInternalPrompt`, keeps `queueBehavior: "defer"`, and rollback on dispatch rejection remains unchanged.

## WHAT WAS OMITTED
- No live cloudhome mailbox notes were drained, and no cross-project messages were sent. The orchestrator explicitly owns reporting back and no project_message/project_note was sent.
- No real hosted opencode server with cloudhome state was accessed. The closest safe equivalent was the hook-level heartbeat/idle seam plus opencode-qa harness self-check in an isolated environment.
- Raw secret-bearing environment dumps and provider logs were not captured.
