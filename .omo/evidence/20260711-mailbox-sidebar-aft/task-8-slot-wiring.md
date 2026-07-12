# Task 8: Wire the mailbox slot: compiled-JSX path with materialize fallback

## What was tested
- The `tui.ts` plugin entry point was updated to attempt a dynamic import of the compiled mailbox component (`dist/tui-compiled/mailbox-sidebar.js`).
- On success, it registers the slot using the compiled component bound to the shared view signal and controller.
- On failure (e.g., in source mode where `tui-compiled` doesn't exist), it falls back to the existing `materialize` thunk.
- The OMO slot (900) keeps the `materialize` approach.
- The `tui.test.ts` file was updated to test both the compiled-present mock and the compiled-absent fallback paths.

## What was observed
- `bun test packages/omo-opencode/src/tui.test.ts` passed (6 tests).
- `bun run build` succeeded.
- `bun run typecheck` passed.
- `bunx tsgo --noEmit -p packages/omo-opencode/src/tui-solid/tsconfig.json` passed.

## Why it is enough
- The dynamic import is guarded and falls back gracefully to the existing `materialize` approach, ensuring no regressions if the compiled component is unavailable.
- The tests cover both the success and failure paths of the dynamic import, verifying that the slots are registered correctly in both cases.
- The legacy registration-order test still passes.
- The toggle-collapse writes route through the existing `queueTuiPreferenceUpdate` call.
## Fixes applied in amended commit
- **Dead badge-contrast wiring**: Imported `badgeTextColor` from `badge-contrast.ts` and wired it correctly, using a helper `isColor` to ensure the theme colors match the expected `{ r, g, b }` shape.
- **Hardcoded stale version**: Replaced the hardcoded `"4.13.0"` with `packageJson.version` imported from the root `package.json`.
- **Raw `any` types**: Replaced `any` types with proper structural types (`MailboxSidebarController`, `CreateMailboxSidebarControllerFn`, `MailboxSidebarComponent`) defined in `tui.ts` to match the compiled JS output, avoiding TS errors from importing `.tsx` files without `--jsx` enabled.
## What was omitted
## Cross-Task Fix (T3 Build Script)
- **Bug**: The dynamic import of `dist/tui-compiled/mailbox-sidebar.js` failed at runtime because T3's build script (`script/build-tui-solid.ts`) preserved the `.tsx` extension for the compiled output.
- **Fix**: Updated `script/build-tui-solid.ts` to emit `.js` files instead of `.tsx`.
- **Proof**: A real dynamic import of the compiled artifact successfully loads and exports the expected components when the virtual modules are mocked:
  ```bash
  $ bun test-load.ts
  SUCCESS [ "MailboxSidebar", "createMailboxSidebarController", "deriveMailboxContentModel" ]
  ```
- **Commit**: `b3ad0286e`
- The `POLL_INTERVAL_MS` tick/schedule loop remains unchanged.
- The OMO slot's `materialize` rendering approach remains unchanged.