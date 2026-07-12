## T2 @opentui 0.4.3 runtime smoke

- Host opencode fork pins `@opentui/core`, `@opentui/keymap`, and `@opentui/solid` to `0.4.3`; AFT plugin pins `@opentui/core`/`@opentui/solid` `0.4.3` with `solid-js` `1.9.12`.
- `@opentui/solid@0.4.3` exports real types for `createElement`, `insert`, and `setProp` from `src/reconciler.d.ts`, so the legacy ambient shim can be removed.
- `createElement` requires an OpenTUI renderer context. A direct top-level call throws `No renderer found`; wrapping the legacy createElement/insert/setProp path inside `testRender()` provides the real runtime context and produces a renderable tree.

## T3 TUI Solid precompile pipeline

- `@opentui/solid@0.4.3` has `scripts/solid-transform.js` on disk but does not export `./scripts/solid-transform.js` through package exports, so `script/build-tui-solid.ts` resolves it by package root fallback. In this workspace it resolved to `node_modules/.bun/@opentui+solid@0.4.3+ce339767e1198fc7/node_modules/@opentui/solid/scripts/solid-transform.js`.
- `dist/tui-compiled/placeholder.tsx` preserves runtime bindings as `opentui:runtime-module:solid-js` and `opentui:runtime-module:%40opentui%2Fsolid%2Fjsx-runtime`; it has no literal `from "solid-js"` import.
- `dist/tui.js` still contains 8 `init_server` matches after externalizing `solid-js`, but now leaves a bare dynamic `import("solid-js")` bridge in the bundled TUI output.

## T4 TUI preferences schema and watcher

- `tui-preferences.ts` now resolves an AFT-shaped `oh-my-openagent` entry with defaults `{ order: 150, header.label: "Mailbox", sections: inbound/outbound/projects }` while keeping the existing jsonc-parser `modify`/`applyEdits` write path.
- Collapsed back-compat is pinned as `entry.collapsed` first, legacy `entry.mailbox.collapsed` second, then `startCollapsed`; `queueTuiPreferenceUpdate(["mailbox", "collapsed"], value)` still writes the legacy key for old readers.
- The watcher keeps per-watcher `lastSeen` state and advances it after successful queued writes, so an internal temp+rename write is not surfaced as an external `onChange` event.

## T5 badge contrast attribution

- `badge-contrast.ts` is a direct AFT/CortexKit MIT-licensed pure utility port with a terse legal attribution header; the source sync note is factual and intentionally retained for Magic Context parity.
- `badgeTextColor()` returns the supplied opaque distinct background object, but falls back to `readableTextColorOn(accent)` when the background alpha is below `0.5` or all RGB channels are within `0.06` of the accent.
- `node scripts/check-third-party-notices.mjs --ship` only verifies ship packaging for root/Codex NOTICE files and required component LICENSE/NOTICE payloads; it does not require the new `aft-opencode@source` or `magic-context@source` headings, so those entries are legal/audit coverage rather than checker-driven dependencies.

## T6 host runtime loader

- OpenCode registers OpenTUI runtime plugin support process-wide at `packages/opencode/src/plugin/tui/runtime.ts:47` before plugin loading, so probing `opentui:runtime-module:*` inside `tui()` is late enough for the host registry to exist.
- `loadHostSolidRuntime()` must build virtual specifiers with string concatenation plus `encodeURIComponent()` for both `solid-js` and `@opentui/solid`; static virtual import literals would let Bun try to resolve the host-only IDs during build.
- The mailbox frozen-toggle root cause is a split Solid graph risk: signals and `@opentui/solid` reconciliation utilities must come from the same source tier, so `tui.ts` now resolves once before any signal creation and feeds the same `solidJs` into both mailbox signals.

## T7: Mailbox TSX Component
- The Solid TSX component was successfully implemented with strict adherence to the zero-relative-import constraint.
- `@opentui/solid`'s `fg` and `borderColor` props expect `string | RGBA | undefined`. Since `ThemeLike` uses `unknown` for colors, casting to `string | undefined` is necessary to satisfy the type checker without using `as any`.
- The `createMailboxSidebarController` factory pattern effectively isolates the Solid state and allows it to survive remounts, matching the magic-context pattern.
- The root `tsconfig.json` needed `"jsx": "preserve"` and `"jsxImportSource": "@opentui/solid"` to allow `tsc --emitDeclarationOnly` to process the new TSX files during the build pipeline.
