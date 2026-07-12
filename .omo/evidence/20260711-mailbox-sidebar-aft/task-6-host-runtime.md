# Task 6 host runtime loader evidence

## What changed

- Added `loadHostSolidRuntime()` in `packages/omo-opencode/src/features/tui-sidebar/host-runtime.ts`.
- Rewired `packages/omo-opencode/src/tui.ts` so `tui()` resolves the runtime once before any `createSignalPair()` call, then passes that same `solidJs` instance into both mailbox `view` and `collapsed` signals.
- Kept `@opentui/solid` and `solid-js` out of top-level static imports in `tui.ts`.

## Runtime source proof

The loader emits this QA log line after selecting a runtime source:

```text
[tui-sidebar] host runtime source { source: "host-virtual" | "bare-import" | "none" }
```

The host virtual branch uses dynamically constructed specifiers only:

```text
"opentui:runtime-module:" + encodeURIComponent("solid-js")
"opentui:runtime-module:" + encodeURIComponent("@opentui/solid")
```

No static `import("opentui:runtime-module:...")` literal is present, so Bun cannot pre-resolve the host virtual IDs during plugin build.

## Cross-runtime signal risk trace

Solid signals are tied to the module instance that created them. The OpenTUI slot renderer tracks reads through the host Solid owner/context. If `tui.ts` creates signals from a host `solid-js` instance but materializes nodes through a plugin-private `@opentui/solid` instance, signal reads and writes can land in different reactive graphs and the mailbox collapsed toggle freezes.

This change avoids that split by resolving `solidJs` and `opentuiSolid` from the same source tier before slot registration:

1. Prefer the host virtual runtime registry for both `solid-js` and `@opentui/solid`.
2. Fall back to bare dynamic imports for both modules only when the host registry is unavailable.
3. Return `{ solidJs: null, opentuiSolid: null, source: "none" }` if neither tier provides the rendering runtime, preserving the existing static-signal fallback path when Solid is unavailable.

`packages/omo-opencode/src/tui.ts` now calls `loadHostSolidRuntime()` before `readView()` and before both `createSignalPair()` calls, then uses the returned `opentuiSolid` for the mailbox and OMO slot materialize calls that already shared the old local `solid` variable.

## Verification

### LSP diagnostics

No diagnostics found for:

- `packages/omo-opencode/src/features/tui-sidebar/host-runtime.ts`
- `packages/omo-opencode/src/features/tui-sidebar/host-runtime.test.ts`
- `packages/omo-opencode/src/tui.ts`

### Targeted tests and typecheck

```text
$ bun test packages/omo-opencode/src/features/tui-sidebar/host-runtime.test.ts && bun test packages/omo-opencode/src/tui.test.ts && bun run typecheck
bun test
 3 pass
 0 fail
 11 expect() calls
Ran 3 tests across 1 file.

 5 pass
 0 fail
 12 expect() calls
Ran 5 tests across 1 file. [1.89s]
$ tsgo --noEmit && bun run typecheck:script && bun run typecheck:packages
$ tsgo --noEmit -p script/tsconfig.json
$ tsgo --noEmit -p packages/rules-engine/tsconfig.json && tsgo --noEmit -p packages/delegate-core/tsconfig.json && tsgo --noEmit -p packages/mcp-stdio-core/tsconfig.json && tsgo --noEmit -p packages/mcp-client-core/tsconfig.json && tsgo --noEmit -p packages/git-bash-mcp/tsconfig.json && tsgo --noEmit -p packages/lsp-core/tsconfig.json && tsgo --noEmit -p packages/utils/tsconfig.json && tsgo --noEmit -p packages/model-core/tsconfig.json && tsgo --noEmit -p packages/omo-config-core/tsconfig.json && tsgo --noEmit -p packages/prompts-core/tsconfig.json && tsgo --noEmit -p packages/comment-checker-core/tsconfig.json && tsgo --noEmit -p packages/hashline-core/tsconfig.json && tsgo --noEmit -p packages/tmux-core/tsconfig.json && tsgo --noEmit -p packages/team-core/tsconfig.json && tsgo --noEmit -p packages/openclaw-core/tsconfig.json && tsgo --noEmit -p packages/boulder-state/tsconfig.json && tsgo --noEmit -p packages/telemetry-core/tsconfig.json && tsgo --noEmit -p packages/claude-code-compat-core/tsconfig.json && tsgo --noEmit -p packages/skills-loader-core/tsconfig.json && tsgo --noEmit -p packages/agents-md-core/tsconfig.json && tsgo --noEmit -p packages/omo-codex/plugin/shared/tsconfig.json && tsgo --noEmit -p packages/omo-codex/tsconfig.json && tsgo --noEmit -p packages/omo-senpi/tsconfig.json && tsgo --noEmit -p packages/senpi-task/tsconfig.json && tsgo --noEmit -p packages/pi-goal/tsconfig.json && tsgo --noEmit -p packages/pi-webfetch/tsconfig.json && tsgo --noEmit -p packages/omo-opencode/tsconfig.json
```

### OpenCode TUI QA smoke

```text
$ cd .agents/skills/opencode-qa
$ bash scripts/lib/common.sh --self-check && bash scripts/tui-smoke.sh --self-test
PASS: dependencies present (opencode sqlite3 curl jq tmux)
PASS: oqa_db_path -> /Users/brethoffman/.local/share/opencode/opencode.db
PASS: oqa_sql_escape quotes single quotes
PASS: oqa_free_port -> 63422
PASS: isolated XDG sandbox auto-removed on exit (/var/folders/9f/hp9ydfwn7wxcm48907jlpm3c0000gn/T/oqa-xdg.XXXXXX.jtDvMQTukQ)
PASS: isolated HOME points inside sandbox
PASS: isolated HOME preserves HOME-based opencode shim
PASS: common.sh self-check
PASS: TUI rendered under tmux (marker found; version 1.17.18)
PASS: send-keys reached the TUI composer (sentinel echoed)
PASS: tmux session torn down (has-session false)
PASS: real DB untouched (session count 5906 unchanged)
PASS: tui-smoke
```
