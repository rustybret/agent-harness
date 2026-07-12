# Task 7: Mailbox TSX Component

## What was tested
- Semantic regression guard: `packages/omo-opencode/src/tui-solid/mailbox-sidebar.test.ts` verifies that the new `deriveMailboxContentModel` produces byte-identical count/label/tone/summary-text values to the legacy `buildMailboxNodes` function for both active and empty mailbox states.
- Controller factory closure: The test verifies that `createMailboxSidebarController` correctly holds the collapse state and calls the injected persistence callback (`onToggle`).
- Module boundary constraint: The `tui-solid` package was typechecked with a scoped `tsconfig.json` to ensure no relative imports outside the allowed boundaries.
- Build pipeline: `bun run build` successfully compiled the TSX files into `dist/tui-compiled/mailbox-sidebar.js` with `opentui:runtime-module:` virtual ids.

## What was observed
- The semantic regression tests passed, confirming that the new Solid TSX component logic matches the legacy AFT logic exactly.
- The scoped typecheck (`bunx tsgo --noEmit -p packages/omo-opencode/src/tui-solid/tsconfig.json`) passed after resolving `@opentui/solid` type strictness issues by casting to `string | undefined`.
- The build pipeline successfully emitted the compiled files.

## Why it is enough
- The semantic regression guard ensures that the visual and interaction semantics of the mailbox sidebar remain unchanged during the port to Solid TSX.
- The module boundary constraint is strictly enforced by the scoped `tsconfig.json` and the absence of relative imports in the source files.
- The controller factory pattern successfully isolates the Solid state from the rest of the plugin, allowing it to survive remounts.

## T8 Example: Wiring `createMailboxSidebarController`

```typescript
// Example of how T8 should call the factory from tui.ts
import { createMailboxSidebarController } from "./tui-solid/mailbox-sidebar"
import { badgeTextColor } from "./features/tui-sidebar/badge-contrast"
import { resolveOmoPrefs, queueTuiPreferenceUpdate } from "./features/tui-sidebar/tui-preferences"

const controller = createMailboxSidebarController({
  getMailbox: () => view().mailbox,
  getPrefs: () => resolveOmoPrefs(readTuiPreferencesFileSync()),
  getVersion: () => "4.17.0", // Or however version is resolved
  badgeTextColor: badgeTextColor,
  initialCollapsed: resolveOmoCollapsed(readTuiPreferencesFileSync()),
  onToggle: (collapsed) => queueTuiPreferenceUpdate(["mailbox", "collapsed"], collapsed),
  requestRender: () => api.renderer.requestRender(),
  watchPrefs: (onChange) => watchTuiPreferences(onChange),
})
```

## Fix: Root tsconfig.json Exclusion
- The root `packages/omo-opencode/tsconfig.json` was updated to exclude `"src/tui-solid/**"`.
- This prevents the main package's `typecheck:packages` step from attempting to parse the TSX files without the `--jsx` flag, which previously caused a `TS17004` error.
- The full `bun run typecheck` command was verified to pass with zero errors.
- The scoped `bunx tsgo --noEmit -p packages/omo-opencode/src/tui-solid/tsconfig.json` check continues to independently validate the JSX code.