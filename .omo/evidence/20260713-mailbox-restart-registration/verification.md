# Verification Receipt

## Focused tests

```text
bun test packages/omo-opencode/src/cli/config-manager/add-tui-plugin-to-tui-config.test.ts packages/omo-opencode/src/features/cross-project-mailbox/hooks/create-mailbox-hooks.test.ts packages/omo-opencode/src/features/cross-project-mailbox/registry/project-registry.test.ts
26 pass, 0 fail, 60 assertions
```

After correcting the user-facing registration runbook and its first-registration comment, the final focused set also included `dialog/registration-notice.test.ts`:

```text
42 pass, 0 fail, 86 assertions across 4 files
```

The final regression pass added the two-repository integration flow after its stale auto-registration labels were corrected:

```text
55 pass, 0 fail, 123 assertions across 5 files
```

## Type and build gates

```text
bun run typecheck
exit 0

bun run build
exit 0; dist/index.js, dist/cli/index.js, dist/tui.js and the compiled mailbox sidebar were produced. The fork's expected missing-upstream materialization warnings were emitted before the build continued successfully.

git diff --check
exit 0
```

LSP diagnostics were clean for all changed TypeScript files.

## Full repository suite

```text
bun test
11822 pass, 2 skip, 32 fail, 1 error across 1491 files
```

This exactly matches the known pre-change repository baseline. The failures are pre-existing workflow/submodule/test-order issues, including publish-workflow marker drift, absent shared-skill upstream materialization, and `config.test.ts` environment/order pollution. No new failure was introduced by this change.

## Explicit-registry proof

```text
PASS: prompted isolated OpenCode session did not create project-registry.json
```

## TUI visual geometry

```json
{
  "expectedColumns": 180,
  "lineCount": 48,
  "maxWidth": 180,
  "overflowLines": [],
  "borderMisaligned": false,
  "wideCharColumns": [],
  "hasAnsi": false
}
```

## Compiled component proof

The plugin runtime log for the captured process records:

```text
[2026-07-13T07:55:02.309Z] [tui-sidebar] mounted compiled mailbox component {"compiled":true,"order":150}
```

The live screenshot therefore came from the precompiled Solid sidebar path, not the materialized fallback.
