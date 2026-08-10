# Mailbox Classification Agent Display Name Fix Evidence

**Date**: 2026-08-10
**Target Component**: `packages/omo-opencode/src/features/cross-project-mailbox/hooks/create-mailbox-hooks.ts`
**Commit / Change**: Standardize `backgroundManager.launch` `agent` parameter in mailbox `classify()` to use `getAgentDisplayName("sisyphus-junior")` ("Sisyphus-Junior").

## WHAT WAS TESTED
1. Source verification of `packages/omo-opencode/src/features/cross-project-mailbox/hooks/create-mailbox-hooks.ts`:
   - Line 145 previously passed unnormalized `"sisyphus-junior"`.
   - Updated to pass `getAgentDisplayName("sisyphus-junior")` -> `"Sisyphus-Junior"`.
2. Unit and integration test suite:
   - Added explicit assertion in `create-mailbox-hooks.test.ts` verifying `launchOptions.agent === "Sisyphus-Junior"`.
   - Executed `bun test packages/omo-opencode/src/features/cross-project-mailbox/` (792 tests passed across 58 files).
3. Typecheck verification:
   - Executed `bun run typecheck` (`tsgo --noEmit` across all workspace packages, exit 0).

## WHAT WAS OBSERVED
- Unit test suite `create-mailbox-hooks.test.ts` asserts `launchOptions.agent === "Sisyphus-Junior"`.
- `bun run typecheck` completed cleanly with zero errors.
- 792 cross-project mailbox tests passed cleanly without failure.

## WHY IT IS ENOUGH
- OpenCode's agent registration map indexes agents by their display names (`"Sisyphus-Junior"` via `remapAgentKeysToDisplayNames`).
- Converting the raw lowercase config key `"sisyphus-junior"` to `"Sisyphus-Junior"` ensures that `backgroundManager.launch()` matches the registered display name key in OpenCode, preventing `"Agent 'sisyphus-junior' not found"` background task failures.

## WHAT WAS OMITTED
- No private API tokens or credentials recorded.
