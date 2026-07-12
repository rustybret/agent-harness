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

## T10 Live QA (tmux send-keys -H fallback path)

- **TUI local-build wiring (memory #1533 resolved):** to point an isolated sandbox TUI at a local dev
  build, `tui.json` must list the repo DIRECTORY (`file://<repo>`), NOT `dist/index.js`. OpenCode's
  TUI resolver (`packages/opencode/src/plugin/shared.ts resolvePackageEntrypoint`) reads
  `package.json` `exports["./tui"]` → `dist/tui.js` only when the spec resolves to a directory with a
  package.json. A file spec pointing at `dist/index.js` loads the SERVER module (no `.tui`), so the
  sidebar silently never mounts. `opencode.jsonc` server plugin still uses `file://<repo>/dist/index.js`.
- **Proof the sandbox runs local code, not npm:** grep the isolated plugin log
  (`$TMPDIR/oh-my-opencode.log`, since the logger uses `os.tmpdir()` which honors `TMPDIR`) for
  `[tui-sidebar] mounted compiled mailbox component {"compiled":true}` + `host runtime source
  {"source":"host-virtual"}`. Both strings are post-T8-only.
- **Real SGR click via tmux:** set `tmux set -g mouse on`, measure the badge cell column with a
  wcwidth-aware pass over `capture-pane` (box-drawing + triangle are wide chars, byte offset ≠ cell
  col), then `send-keys -H` the SGR press `1b5b3c30 3b<col>3b<row>4d` + release `...6d`. The badge sat
  at row 12 / cell col ~186 at 220x55. Click flips `▼`↔`▶` AND the `oh-my-openagent.mailbox.collapsed`
  pref true↔false together — verified 3 clicks.
- **Sidebar only renders in the session view**, not the home/splash screen — submit one prompt first.
- **`/project-mailbox` dialog** filters out the self-project (`buildTopMenu` drops the entry whose
  repoRoot == cwd), so a SECOND registry project is needed for the top menu to show any row. The
  plugin rewrites `~/.omo/project-registry.json` on launch (self-registration), so seed the extra
  project AFTER launch. Submenu order: Disabled/question/impl/plan. Typing into an open DialogSelect
  goes to its Search filter — use arrow keys, and `ctrl-u` (send-keys -H `15`) to clear a stray filter.
- **Isolation:** dedicated tmux socket `-L omot10qa` (never the user's default server); isolated
  `HOME/XDG_*/TMPDIR`; host DB session count 5927 unchanged, sandbox DB count 0.
- **Honest gap:** expanded In/Out/Projects rows render empty when `getMailbox()` is null (no seeded
  inbox/outbox digest). Toggle mechanics (the bug) work regardless; body content is a fixture-data
  condition, already locked by T7's semantic-regression suite.
