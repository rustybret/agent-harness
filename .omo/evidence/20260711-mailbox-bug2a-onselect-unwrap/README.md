# Bug 2a fix: /project-mailbox submenu selection not accepted

## What was tested

User report: "using slash command to select a project works, but input is not
accepted on subsequent step. user cannot choose disabled, plan, impl, or
question. slash command is therefore useless."

Root cause: `registerProjectMailboxCommand` in
`packages/omo-opencode/src/features/cross-project-mailbox/dialog/tui-command.ts`
passed `onSelect` callbacks that treated the argument AS the selected row/option
(`selectedRow.projectId`, `selectedOpt.choice`). The real host
(`api.ui.DialogSelect`, opencode's `packages/tui/src/plugin/adapters.tsx`
`mapOptionCb()`) always invokes `onSelect` with the FULL wrapped option object
`{ title, value, description, ... }`, never the bare value. Both fields were
therefore `undefined`, so `applySelection(text, undefined, undefined)` wrote to
a bogus `senders.undefined` key and the visible menu never reflected the
selection — exactly the "input is not accepted" symptom.

Fix: unwrap `selected.value` in both the top-menu and submenu `onSelect`
handlers.

## What was observed

1. Rebuilt the plugin (`bun run build`) after the fix, closed the stale
   OpenCode TUI pane (loaded the pre-fix plugin at boot) and launched a fresh
   `opencode` session driven live via `cmux` (SGR/keystroke injection over a
   real terminal pane, workspace 4, surface:40) inside the actual project.
2. Ran `/project-mailbox`, filtered to `art3d-pipeline` (baseline state
   `plan`, confirmed via `.opencode/oh-my-openagent.jsonc` before the run).
3. Selected the row: submenu title correctly rendered
   `Project Mailbox > art3d-pipeline` (previously rendered
   `Project Mailbox > undefined`, itself proof the row was unresolved before
   the fix).
4. Selected `impl` from the submenu (previously ✓-marked `plan`). The TUI
   returned to the top menu with the row now showing `art3d-pipeline impl`.
5. Confirmed the write landed on disk:
   `.opencode/oh-my-openagent.jsonc` → `"art3d-pipeline-6e240ea8": { "access":
   "allow", "intent_budget": "impl" }` (was `"plan"`).
6. Reverted the test value back to `"plan"` to restore the pre-test state
   (the project's real sender configuration).

## Why it is enough

This is a real, live write through the actual production code path (real
`DialogSelect` host API, real JSONC edit via `applySelection`/`jsonc-parser`,
real atomic rename), not a unit-test mock. The unit test suite was also
extended (`tui-command.test.ts`) with a regression test asserting the wrapped
`{ value: ... }` shape reaches the write path correctly and that
`senders.undefined` is never created — this pins the contract so the bug
cannot silently regress if a future edit reverts the unwrap.

## What was omitted

No secrets or credentials were involved. The full live TUI session transcript
(via `cmux read-screen`) additionally showed unrelated sidebar panels
(Magic Context, AFT, MCP status) — omitted here as noise; only the Project
Mailbox submenu and the resulting disk diff are relevant to this fix.
