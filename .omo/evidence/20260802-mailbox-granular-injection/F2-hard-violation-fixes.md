# F2 Hard Violation Fixes

Fixes for the three HARD (blocking) findings in `F2-code-quality.md`. SOFT/advisory 200-LOC
findings deferred (out of scope).

## WHAT WAS TESTED

- **Command:** `bun test packages/omo-opencode/src/features/cross-project-mailbox`
  - Surface: the entire cross-project-mailbox feature suite (52 files), including the manual-drain
    tool tests (`manual-drain/manual-drain-tools.test.ts`) that import the split barrel, and the
    idle-drain hook tests whose two `as any` casts were removed.
  - Behavior it proves: the file split of `manual-drain/index.ts` into `types.ts` / `peek.ts` /
    `drain.ts` / `tools.ts` preserved every public symbol and its behavior, and the two retyped
    idle-drain test cases (busy-session early-out; reserved-but-rejected unreserve) still assert
    the same behavior.
- **Command:** `bun run typecheck` (full workspace: tsgo --noEmit across all packages)
  - Behavior it proves: the barrel split re-exports resolve for every downstream importer
    (`tools/index.ts`, `hooks/idle-drain-processor.ts`, `hooks/route-note-dispatcher.ts`,
    `hooks/idle-drain-hook.ts`), the retyped test constructs are sound (no `as any`, no
    `@ts-ignore`), and the new `log(...)` call in `remote-pending-store.ts` typechecks.
- **Command:** ast-grep `$X as any` over `packages/omo-opencode/src/features/cross-project-mailbox`
  - Behavior it proves: zero `as any` remain in the feature dir except one pre-existing,
    out-of-scope occurrence in `dialog/tui-command.ts:29` (not part of this task's three targets).

## WHAT WAS OBSERVED

- **Finding 1 — barrel business logic:** `manual-drain/index.ts` is now a pure barrel — 10 lines,
  only `export { ... } from "./..."` / `export type { ... } from "./..."`. Moved code:
  - `manual-drain/types.ts` — `ManualDrainMailboxStorePort`, `ManualMailboxToolDeps`,
    `PendingMailboxPreview`, `DrainedMailboxNote`, `SkippedMailboxNote`.
  - `manual-drain/peek.ts` — `runProjectMailboxPeek` + `preview` + `BODY_PREVIEW_MAX`.
  - `manual-drain/drain.ts` — `runProjectMailboxDrain`, `drainedNote`, `guidanceFor`,
    `resolveFreshConfig`.
  - `manual-drain/tools.ts` — `createProjectMailboxPeekTool`, `createProjectMailboxDrainTool`.
  - `manual-drain/delivery-pipeline.ts` — unchanged (was already a concern file; consumers still
    import its ports directly from `./delivery-pipeline`, so the barrel does NOT re-export them —
    matches today's behavior).
- **Finding 2 — `as any`:** `hooks/idle-drain-hook.test.ts` lines ~499 and ~516 rewritten.
  - Busy-session case now types the stub as
    `NonNullable<IdleDrainHookDeps["client"]["session"]>` and assigns `deps.client = { session }`.
  - Reserved-but-rejected case now asserts on the DI'd spies (`spies.unreserve`,
    `spies.markDispatched`) — the same jest.fn instances the store is built from — removing the
    `deps.makeMailboxStore(...) as any` cast without weakening the assertion (still asserts
    `unreserve` called with the exact messageId and `markDispatched` NOT called).
- **Finding 3 — empty catch:** `contracts/remote-pending-store.ts:132` empty
  `.catch(() => {})` replaced with a `.catch((cleanupError) => log(...))` that logs
  `"[remote-pending-store] failed to clean up temp file after write failure"` with
  `{ error, tmpPath }`. Cleanup failure is now observable but still swallowed; the original write
  error is re-thrown unchanged (`throw error`), matching the sibling
  `mailbox/pending-delivery-store.ts` best-effort-cleanup-then-rethrow shape plus the shared
  `log()` contract used by `outbox-log.ts` / `delivery-pipeline.ts`.
- **Test result:** `713 pass, 0 fail, 6064 expect() calls, 52 files` (no regression, no reduced
  count vs the prior 630+ baseline — the suite grew).
- **Typecheck result:** `EXIT=0`.
- **ast-grep result:** 1 match, in the out-of-scope `dialog/tui-command.ts` only.

## WHY IT IS ENOUGH

- The barrel violation is a structural change; the full feature suite plus a workspace-wide
  typecheck exercise every import path of the moved symbols, so any broken re-export or lost symbol
  would fail typecheck or a test. Both are green. Public symbol names are byte-identical (a split,
  not a rename), so downstream files named in MUST DO are untouched and still compile.
- The two retyped tests keep identical `expect(...)` assertions (same messageId, same
  called/not-called expectations), so behavior coverage is unchanged; only the escape hatch was
  removed. The busy-session stub is now type-checked against the real client shape, which is
  strictly stronger than `as any`.
- The catch-block fix keeps the error-path contract (rm is best-effort, original error rethrown)
  and adds observability via the project's single shared `log` function — the exact pattern the
  inherited wisdom prescribed.

## WHAT WAS OMITTED

- SOFT/advisory 200-LOC findings — explicitly deferred, out of scope.
- The pre-existing `as any` in `dialog/tui-command.ts:29` — not one of the three F2 targets, left
  untouched to avoid scope creep.
- `lsp_diagnostics` per-file was unusable here (it doubled the package path to
  `packages/omo-opencode/packages/omo-opencode/...`, ENOENT); fell back to the authoritative
  `bun run typecheck` for the package, as the inherited wisdom anticipated.
- No secrets, tokens, or env dumps were produced by these commands; nothing to redact.
