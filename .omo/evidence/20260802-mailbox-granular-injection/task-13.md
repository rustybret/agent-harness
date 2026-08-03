# Task 13 — classifier subagent for ambiguous notes

## What was tested

- Added red-first unit coverage in `packages/omo-opencode/src/features/cross-project-mailbox/router/classifier.test.ts` before implementation; initial router suite failed with missing `./classifier`.
- Implemented `router/classifier.ts` plus router barrel exports, then ran `bun test packages/omo-opencode/src/features/cross-project-mailbox/router`.

## What was observed

- Red run: `bun test packages/omo-opencode/src/features/cross-project-mailbox/router` failed with `Cannot find module './classifier'` from `classifier.test.ts`.
- Green run: `bun test packages/omo-opencode/src/features/cross-project-mailbox/router` passed: 11 pass, 0 fail, 4551 expect calls across 2 files.
- Final gate: router tests passed again, no-excuse TypeScript audit reported no violations in 3 files, pure LOC measured `classifier.ts` 231 and `classifier.test.ts` 161, and `bun run typecheck` completed clean.

## Why it is enough

- Unit tests cover constrained-output parsing for all canonical mailbox modes, normalized casing, explicit `triage`, malformed extra text, timeout, classifier rejection, cache-hit dispatch suppression, and the defensive `requested_mode` no-classify guard.
- The classifier dispatch is dependency-injected through `deps.classify`, with `CLASSIFIER_CATEGORY = "quick"` exported for task-12 wiring. No main-session prompt/client APIs are imported or called.

## What was omitted

- No live opencode harness run was performed for this isolated router port; task-12 owns live drain integration and task-16 owns end-to-end mailbox QA.
- No secret-bearing logs or environment dumps were captured.
