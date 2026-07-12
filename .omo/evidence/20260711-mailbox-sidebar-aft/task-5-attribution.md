# T5 badge contrast attribution evidence

## What was tested

- Ported CortexKit AFT's MIT-licensed badge contrast utility to `packages/omo-opencode/src/features/tui-sidebar/badge-contrast.ts`.
- Added unit coverage in `packages/omo-opencode/src/features/tui-sidebar/badge-contrast.test.ts` for readable foreground selection, near-transparent background fallback, near-equal background fallback, and opaque distinct background pass-through.
- Added source adoption notices for `aft-opencode@source` and `magic-context@source` in `THIRD-PARTY-NOTICES.md`.

## What was observed

### Red test before implementation

```text
$ bun test packages/omo-opencode/src/features/tui-sidebar/badge-contrast.test.ts
bun test
 0 pass
 1 fail
error: Cannot find module './badge-contrast' from '/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/tui-sidebar/badge-contrast.test.ts'
```

### Badge contrast tests

```text
$ bun test packages/omo-opencode/src/features/tui-sidebar/badge-contrast.test.ts
bun test
 4 pass
 0 fail
 5 expect() calls
Ran 4 tests across 1 file.
```

### Third-party notices ship checker

```text
$ node scripts/check-third-party-notices.mjs --ship
ship verification passed: 19 notice/license files present in root npm pack payload
```

Checker finding: `--ship` validates that `package.json` `files[]` includes the root and Codex notices, required Codex component LICENSE/NOTICE files are declared by their package `files[]`, and `npm pack --dry-run --json --ignore-scripts` includes those notice/license files. It does not validate arbitrary source-adoption headings such as `aft-opencode@source` or `magic-context@source`; the default root scope validates root `package.json` dependencies plus hardcoded bundled component headings.

### TypeScript gates

```text
$ bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/omo-opencode/src/features/tui-sidebar/badge-contrast.ts packages/omo-opencode/src/features/tui-sidebar/badge-contrast.test.ts
No violations in 2 file(s).

$ bun run typecheck
$ tsgo --noEmit && bun run typecheck:script && bun run typecheck:packages
$ tsgo --noEmit -p script/tsconfig.json
$ tsgo --noEmit -p packages/rules-engine/tsconfig.json && tsgo --noEmit -p packages/delegate-core/tsconfig.json && tsgo --noEmit -p packages/mcp-stdio-core/tsconfig.json && tsgo --noEmit -p packages/mcp-client-core/tsconfig.json && tsgo --noEmit -p packages/git-bash-mcp/tsconfig.json && tsgo --noEmit -p packages/lsp-core/tsconfig.json && tsgo --noEmit -p packages/utils/tsconfig.json && tsgo --noEmit -p packages/model-core/tsconfig.json && tsgo --noEmit -p packages/omo-config-core/tsconfig.json && tsgo --noEmit -p packages/prompts-core/tsconfig.json && tsgo --noEmit -p packages/comment-checker-core/tsconfig.json && tsgo --noEmit -p packages/hashline-core/tsconfig.json && tsgo --noEmit -p packages/tmux-core/tsconfig.json && tsgo --noEmit -p packages/team-core/tsconfig.json && tsgo --noEmit -p packages/openclaw-core/tsconfig.json && tsgo --noEmit -p packages/boulder-state/tsconfig.json && tsgo --noEmit -p packages/telemetry-core/tsconfig.json && tsgo --noEmit -p packages/claude-code-compat-core/tsconfig.json && tsgo --noEmit -p packages/skills-loader-core/tsconfig.json && tsgo --noEmit -p packages/agents-md-core/tsconfig.json && tsgo --noEmit -p packages/omo-codex/plugin/shared/tsconfig.json && tsgo --noEmit -p packages/omo-codex/tsconfig.json && tsgo --noEmit -p packages/omo-senpi/tsconfig.json && tsgo --noEmit -p packages/senpi-task/tsconfig.json && tsgo --noEmit -p packages/pi-goal/tsconfig.json && tsgo --noEmit -p packages/pi-webfetch/tsconfig.json && tsgo --noEmit -p packages/omo-opencode/tsconfig.json
```

LSP diagnostics reported no diagnostics for both new TypeScript files.

## Why it is enough

The tests exercise both exported functions and the two guard paths that protect badge readability when background color is unusable. The notices checker confirms the shipped NOTICE files remain present in the npm payload; the added CortexKit source-adoption entries are present for legal/audit review even though `--ship` does not require them.

## What was omitted

No secret-bearing logs, environment dumps, tokens, or auth headers were captured.
