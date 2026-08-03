# Task 4 — Router core: pure decideRoute()

## What was tested

- Added `packages/omo-opencode/src/features/cross-project-mailbox/router/decide-route.test.ts` first and ran the focused router test before implementation.
- Implemented pure router module files: `decide-route.ts`, `types.ts`, `index.ts`.
- Focused test command run after implementation: `bun test packages/omo-opencode/src/features/cross-project-mailbox/router`.
- LSP diagnostics command run on `packages/omo-opencode/src/features/cross-project-mailbox/router`.
- Workspace typecheck command run: `bun run typecheck`.
- No-excuse and file-size checks run on the four router files.

## What was observed

- Red phase failed for the expected reason before implementation: missing `./decide-route` module.
- Green phase passed: 2 tests, 4538 `expect()` calls, 0 failures.
- Exhaustive requested-mode table covers `6 modes × 2 presence states × 3 in-flight flag states × 3 budgets × 3 allowlist shapes × 6 legacy intents × 2 category states = 3888` route cells.
- Exhaustive legacy no-mode table covers `2 presence states × 3 in-flight flag states × 3 budgets × 3 allowlist shapes × 6 legacy intents × 2 category states = 648` route cells.
- LSP diagnostics: 4 files scanned, 0 diagnostics.
- `bun run typecheck`: passed.
- No-excuse checker: no violations in 4 files.
- Pure LOC: `decide-route.ts` 64, `types.ts` 22, `index.ts` 2, `decide-route.test.ts` 176.
- Inspection of `decide-route.ts` imports showed only `../config`, `../envelope/schema`, and `./types`; no `fs`, `node:fs`, SDK client import, `async`, `await`, or `Promise` return.

## Why it is enough

- The table tests independently encode the routing oracle, including downgrade precedence, no-mode ambiguity, remote answer guard, and worker-pr local default.
- The production router has no I/O ports and delegates only to task-2's pure `decideDowngrade` gate.

## What was omitted

- No live OpenCode harness QA was run for this task because task 4 is a pure decision module and does not integrate with hooks, sessions, tools, clients, or file-system lane execution. Router integration QA belongs to task 12.
