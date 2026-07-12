# Task 2: OpenTUI dependency bump and runtime smoke

## What changed

- Updated root `package.json` production dependencies `@opentui/core`, `@opentui/keymap`, and `@opentui/solid` from `^0.2.16` to exact `0.4.3`.
- Left `solid-js` unchanged at `1.9.12`.
- Ran `bun install`, updating `bun.lock` to the `@opentui/*@0.4.3` graph.
- Deleted `packages/omo-opencode/src/types/opentui-solid.d.ts` because `@opentui/solid@0.4.3` exports real types for `createElement`, `insert`, and `setProp` via `src/reconciler.d.ts`.
- Added `packages/omo-opencode/src/features/tui-sidebar/opentui-solid-runtime.test.ts`, which imports the real `@opentui/solid` runtime without `mock.module` and verifies `createElement("box")`, `setProp`, and `insert` build a renderable node tree inside `testRender()`.

## Dependency evidence

- Host fork pins read from `/Volumes/Topper2TB/Git/opencode/package.json:43-45`: all three `@opentui/*` packages are `0.4.3`.
- AFT plugin combo read from `/Volumes/Topper2TB/Git/aft/packages/opencode-plugin/package.json:38-41`: `@opentui/core` and `@opentui/solid` are `0.4.3`; `solid-js` is `1.9.12`.
- Installed `@opentui/solid@0.4.3` package exports `types: ./index.d.ts`, and `index.d.ts` re-exports `./src/reconciler.js`; `src/reconciler.d.ts` declares `createElement`, `insert`, and `setProp`.
- Direct `createElement()` outside a renderer context throws `No renderer found`; the real-runtime smoke uses `testRender()` to provide the same renderer context that the legacy materialize path needs at runtime.

## Commands run and observed

```text
bun install
```

Observed: completed and saved `bun.lock`. The run printed existing `packages/shared-skills/upstreams/*` git pathspec warnings from this repo's pre-existing untracked upstream state; no upstream files were changed or committed for this task.

```text
bun test packages/omo-opencode/src/features/tui-sidebar/opentui-solid-runtime.test.ts
```

Observed: `1 pass`, `0 fail`, `7 expect() calls`.

```text
lsp_diagnostics packages/omo-opencode/src/features/tui-sidebar/opentui-solid-runtime.test.ts
lsp_diagnostics package.json
```

Observed: no diagnostics found.

```text
bun test packages/omo-opencode/src/tui.test.ts packages/omo-opencode/src/features/cross-project-mailbox/dialog/tui-command.test.ts
```

Observed: `11 pass`, `0 fail`, `28 expect() calls` across 2 files. This covers the existing TUI mock test and the `Layer.commands[]` registration shape used by `tui-command.ts`.

```text
bun run typecheck
```

Observed: `tsgo --noEmit`, `typecheck:script`, and `typecheck:packages` all completed successfully.

```text
bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/omo-opencode/src/features/tui-sidebar/opentui-solid-runtime.test.ts
```

Observed: `No violations in 1 file(s).`

```text
awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/|#|--)/' packages/omo-opencode/src/features/tui-sidebar/opentui-solid-runtime.test.ts | wc -l
```

Observed: `35` pure LOC.

## Why this is enough

- The runtime smoke exercises the real `@opentui/solid` package, not the old mock in `tui.test.ts`, so it would fail if the 0.4.3 runtime removed or renamed `createElement`, `insert`, or `setProp`.
- The targeted `tui-command.test.ts` run proves the existing `commands: []` layer registration shape still passes under the bumped `@opentui/keymap` dependency.
- Typecheck and LSP diagnostics prove the deleted ambient shim is no longer required for the codebase to compile.

## Omitted

- No harness QA was run because this task only changes dependencies and a package-level runtime smoke test. No OpenCode or Codex hook/tool implementation was changed.
- No private environment or credential output was captured.
