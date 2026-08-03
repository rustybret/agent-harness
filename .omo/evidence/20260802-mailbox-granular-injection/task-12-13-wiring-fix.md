# QA Evidence — Task 12 & 13 Wiring Fix

## What was tested
- Unit tests for `createProductionClassifyNote` adapter in `production-classifier-adapter.test.ts` covering:
  - Valid classified mode within budget (re-runs `decideRoute` and returns correct lane/effectiveMode).
  - Classified mode over budget (downgrades to triage with `mode-over-budget` reason).
  - Classifier failure/garbage response (falls back to triage with `parse-failure` reason).
  - Classifier throwing an error (gracefully falls back to triage with `classifier-error` reason).
- Unit tests for `buildClassifyNote` in `create-mailbox-hooks.test.ts` verifying that:
  - The real classifier is successfully built and wired.
  - It launches a background task, polls for completion, and returns the correct decision.
- Full `cross-project-mailbox` test suite and workspace typecheck.

## What was observed
- All unit tests passed successfully:
  ```bash
  bun test packages/omo-opencode/src/features/cross-project-mailbox
  713 pass
  0 fail
  ```
- Workspace typecheck is completely clean:
  ```bash
  bun run typecheck
  (exit 0)
  ```

## Why it is enough
- The tests cover all the required adapter logic, budget gating re-entry, error handling, and background task dispatch/polling.
- The typecheck ensures no signature mismatches or compilation errors exist across the workspace.
