# Task 9 — mailbox worker-pr local lane

## What was tested

- Added red tests first for `worker-order`, `worker-pr`, and `worker-pr-watchdog`.
- Ran worker lane tests with fake git/spawn/clock/fs-style ports.
- Ran `bun run typecheck` for the workspace.

## Observed

- Red run before implementation failed on missing modules: `worker-order`, `worker-pr`, `worker-pr-watchdog`.
- Green focused run: `bun test packages/omo-opencode/src/features/cross-project-mailbox/lanes/worker-order.test.ts packages/omo-opencode/src/features/cross-project-mailbox/lanes/worker-pr.test.ts packages/omo-opencode/src/features/cross-project-mailbox/lanes/worker-pr-watchdog.test.ts` → 8 pass / 0 fail.
- Full typecheck: `bun run typecheck` → clean.
- OpenCode QA harness check: `bash scripts/lib/common.sh --self-check` from `.agents/skills/opencode-qa` → PASS, including dependency presence and isolated XDG sandbox auto-removal.
- Full lane directory run currently has unrelated pre-existing missing task-10 modules (`./interrupt`, `./interrupt-sender-trigger`), outside task-9 scope.

## Why it is enough

- Tests pin work-order reply contract, path/branch naming, wrapper argv shape, deadline override/default, success cleanup, success-with-warning fallback, nonzero failure reply, deadline failure marking, and failed-worktree cap enforcement.
- Typecheck proves the new TypeScript modules and build script change are type-clean.
- The OpenCode QA harness check proves the available harness can run isolated QA without touching the real OpenCode DB; the worker-pr lane itself is not router-wired until task-12, so focused fake-port tests are the behavior gate for this substrate task.

## Omitted

- No live worker `opencode run` was launched from this checkout. The lane is intentionally fire-and-forget and all effects are port-injected for task-12 integration.
- Did not implement interrupt lane modules that are unrelated to task 9.
