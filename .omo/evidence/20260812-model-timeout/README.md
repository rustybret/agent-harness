# QA Evidence: Model Prompt Timeout

Date: 2026-08-12
Target: `packages/omo-opencode/src/shared/prompt-timeout-context.ts`

## WHAT WAS TESTED

- `bun test packages/omo-opencode/src/shared/prompt-timeout-context.test.ts` verifies the default model prompt timeout is 5 minutes (`300000` ms).
- `bun test packages/omo-opencode/src/shared/model-suggestion-retry.test.ts` verifies the async and sync prompt retry paths still pass after inheriting the updated default timeout.
- `aft_inspect` was run on the changed source and test files.
- `bun test packages/omo-opencode/src/shared` was run as a wider package-level check.

## WHAT WAS OBSERVED

- Focused timeout test: pass.
- Model suggestion retry suite: 33 pass, 0 fail.
- AFT diagnostics for changed files: 0 errors, 0 warnings.
- Wider shared suite: 1084 pass, 1 fail. The failure is `markdown-link-audit.test.ts` reporting pre-existing missing documentation links (`CONTRIBUTING.md`, `.github/workflows/publish.yml`, `README.ru.md`) unrelated to the timeout change.

## WHY IT IS ENOUGH

- The changed constant is directly pinned by a new test, and the prompt retry call paths that consume it continue to pass.
- Diagnostics on the changed files are clean.
- The wider suite was executed and its only failure is outside the timeout path and references missing markdown targets, not model dispatch or prompt timeout behavior.

## WHAT WAS OMITTED

- No live provider request was run, because proving a 5-minute wait against a real slow provider would burn quota/time and the behavior is a deterministic local timeout constant consumed by existing prompt dispatch tests.
