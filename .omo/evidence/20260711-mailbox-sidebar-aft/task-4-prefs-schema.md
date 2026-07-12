# T4 prefs schema evidence

## What was tested

- Added AFT-shaped `OmoTuiPrefs` resolution under `oh-my-openagent` in `packages/omo-opencode/src/features/tui-sidebar/tui-preferences.ts`.
- Preserved the legacy writer path for `oh-my-openagent.mailbox.collapsed` via `queueTuiPreferenceUpdate(["mailbox", "collapsed"], value)`.
- Added co-located tests for legacy collapsed resolution, new-schema precedence, watcher echo guard, malformed JSONC no-clobber behavior, and sibling comment/key preservation.

## Observed behavior

- Red check before implementation failed because `watchTuiPreferences` was not exported.
- Flaky-test follow-up replaced the watcher echo-guard test's raw `wait(300)` with a subscribe-first, timeout-bound watcher settle signal tied to the post-debounce file text.
- `bun test packages/omo-opencode/src/features/tui-sidebar/` passed: 95 pass, 0 fail, 228 expect calls, 12 files.
- `lsp_diagnostics` on `tui-preferences.ts` and `tui-preferences.test.ts`: no diagnostics.
- `bun run typecheck` passed: root `tsgo --noEmit`, script typecheck, and package typecheck all completed successfully.
- Pure LOC check: `tui-preferences.ts` 215, `tui-preferences.test.ts` 130.

## Why it is enough

- The tests cover the required back-compat read chain: new `collapsed` key, legacy `mailbox.collapsed`, and defaults for malformed input.
- The watcher test proves queued internal writes advance the echo guard and do not call `onChange` as external edits after a real debounce cycle settles.
- The existing jsonc-parser write path remains in use and is covered by comment/key preservation plus malformed-file no-clobber tests.

## Omitted

- No OpenCode live TUI QA was run for T4 because this task only extends preference parsing/watching and T7/T8 will wire the TUI component consumption.
