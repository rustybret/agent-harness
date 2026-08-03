# Task 12 — mailbox granular injection router integration

## What was tested

- Added integration coverage in `idle-drain-hook.test.ts` for answer-local, todo-next, subagent, worker-pr cloudhome upgrade, and thrown-lane rollback to next-pass triage.
- Added manual-drain coverage for requested/effective route metadata and guidance.
- Ran focused tests while implementing: `bun test packages/omo-opencode/src/features/cross-project-mailbox/hooks/idle-drain-hook.test.ts`, `bun test packages/omo-opencode/src/features/cross-project-mailbox/manual-drain/manual-drain-tools.test.ts`, and hook/bridge smoke tests.

## What was observed

- Legacy idle-drain tests still pass after the routed dispatcher was inserted after reservation/validation/rate-limit/digest guards.
- Requested-mode notes route to injected lane ports and record `requestedMode`, `effectiveMode`, and `lane` in pending dispatch records.
- A thrown lane rolls the reservation back and the next drain pass dispatches the same note through legacy triage.

## Why it is enough

- The tests exercise the real idle-drain hook path with fake lane ports, proving the integration seam without re-testing each lane's internals.
- Manual drain output now exposes the route decision fields needed by downstream e2e evidence.

## Verification commands

- `bun test packages/omo-opencode/src/features/cross-project-mailbox` → 708 pass / 0 fail.
- `bun test packages/omo-opencode/src/features/external-inject` → 52 pass / 0 fail.
- `bun test packages/omo-opencode/src/shared/prompt-async-route-audit.test.ts packages/omo-opencode/src/shared/mock-module-lifecycle-audit.test.ts` → 11 pass / 0 fail.
- `bun run typecheck` → clean.
- `aft_inspect` on changed TypeScript files → 0 errors / 0 warnings / 0 hints.
- `bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check` → PASS, isolated XDG sandbox auto-removed.
- `bash .agents/skills/opencode-qa/scripts/server-smoke.sh --self-test` → PASS, isolated server `/global/health`, `/doc`, and auth rejection verified.
- `bash .agents/skills/opencode-qa/scripts/sse-hook-probe.sh --self-test` → FAIL twice: stream opened but no `server.connected` event within 15s. This is recorded as a QA caveat, not used as the task gate because the task's routed hook behavior is covered by the real hook Bun integration tests above.

## What was omitted

- No live per-lane OpenCode conversation was run for this integration task; the next e2e wave owns live lane execution evidence. No secret-bearing logs or environment dumps were copied.
