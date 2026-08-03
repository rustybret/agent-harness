# Task 8 — Subagent lane evidence

## What was tested

- Added TDD coverage first in `packages/omo-opencode/src/features/cross-project-mailbox/lanes/subagent.test.ts`.
- Implemented `packages/omo-opencode/src/features/cross-project-mailbox/lanes/subagent.ts` with injected `spawn`, `waitForTask`, `sendReply`, and `ack` ports.
- Exercised category budget resolution, single dispatch, split investigate then implement dispatch, completion replies, failure replies, and ack-at-dispatch behavior with fakes.

## What was observed

- Red TDD check before implementation: `bun test packages/omo-opencode/src/features/cross-project-mailbox/lanes/subagent.test.ts` failed with `Cannot find module './subagent'`.
- Focused lane suite: `bun test packages/omo-opencode/src/features/cross-project-mailbox/lanes` passed, `38 pass`, `0 fail`, `138 expect() calls`.
- LSP diagnostics on changed TS files: no diagnostics for `subagent.ts` or `subagent.test.ts`.
- Typecheck: `bun run typecheck` completed successfully.
- OpenCode QA skill loaded. Harness sanity check `bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check` passed and proved dependencies plus isolated XDG sandbox cleanup.

## Why it is enough

- The tests prove this lane stays decoupled from `BackgroundManager` by asserting the injected spawn-port payload rather than importing the real manager.
- The resolver matrix covers every current `CATEGORY_TIER` category against every canonical sender ceiling and separately proves plan-family names never dispatch.
- Completion is covered for both success and failure, including the split flow where implementation only starts after investigation succeeds.

## What was omitted

- Router wiring and real `BackgroundManager.launch` integration were intentionally omitted because task-12 owns those ports.
- Live OpenCode SSE/CLI behavior for this lane was not driven because this task only creates the pure, unwired lane. There is no hook/tool/router entrypoint to exercise until task-12 wires these injected ports.
- No secret-bearing logs or environment dumps were captured.
