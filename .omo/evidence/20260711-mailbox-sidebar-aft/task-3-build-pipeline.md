# Task 3 build pipeline evidence

## What was tested

- `bun test script/build-tui-solid.test.ts` for the build precompiler behavior: TSX transform, plain TS copy, and `*.test.*` exclusion.
- `bunx tsgo --noEmit -p packages/omo-opencode/src/tui-solid/tsconfig.json` for the scoped TUI Solid TSX config with `jsx=preserve` and `jsxImportSource=@opentui/solid`.
- `bun run build` for the full BuildNode graph, including the new `tui-solid` node before the existing `tui` bundle.
- `bun run typecheck` for the root, script, and package typecheck gates.
- Build output inspection of `dist/tui-compiled/placeholder.tsx` and `dist/tui.js`.

## What was observed

- Red test first failed because `script/build-tui-solid.ts` did not exist: `Module not found "script/build-tui-solid.ts"`.
- Green test result: `1 pass, 0 fail, 8 expect() calls`.
- Scoped TUI Solid typecheck completed with exit code 0.
- `bun run build` completed with `build: all steps completed`.
- `bun run typecheck` completed with exit code 0.
- Solid transform resolution path used by the build:
  `node_modules/.bun/@opentui+solid@0.4.3+ce339767e1198fc7/node_modules/@opentui/solid/scripts/solid-transform.js`.
- `dist/tui-compiled/` contents after build:
  - `dist/tui-compiled/placeholder.tsx`
- Relevant transformed placeholder imports:
  - `import { createSignal } from "opentui:runtime-module:solid-js";`
  - `import { jsx } from "opentui:runtime-module:%40opentui%2Fsolid%2Fjsx-runtime";`
- No literal `from "solid-js"` or `from "solid-js/store"` imports were present in the transformed placeholder.
- `grep -c 'init_server' dist/tui.js` returned `8`.
- A bare dynamic Solid import remains in `dist/tui.js`:
  `const solidJs = await import("solid-js").catch((error95) => {`

## Why it is enough

The test locks the precompiler contract that later sidebar TSX work depends on: shipped `.tsx` files are transformed through OpenTUI's Solid transform, plain `.ts` files are copied, and test fixtures are excluded from `dist/tui-compiled/`. The full build proves the new BuildNode executes before the TUI bundle without changing `dist/tui.js`'s output path. The output inspection proves the compiled placeholder binds through `opentui:runtime-module:` virtual ids instead of bundling a private Solid runtime into the precompiled output.

## What was omitted

No secret-bearing logs, environment dumps, auth headers, or private credentials were captured.
## Cross-Task Fix (T8)
- **Bug**: The build script originally preserved the `.tsx` extension for compiled output, which caused the dynamic import in `tui.ts` (expecting `.js`) to fail at runtime.
- **Fix**: Updated `script/build-tui-solid.ts` to replace `.tsx` with `.js` for the output file, and updated `script/build-tui-solid.test.ts` to assert `.js` output.
- **Commit**: `b3ad0286e`
