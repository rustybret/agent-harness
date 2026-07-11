# F2 — Code Quality Review (mailbox-ux)

**Verdict: APPROVE**

Holistic code-quality pass across the full `feat/project-mailbox-ux` vs `fork/local` changeset (70 files, +4833/-228). All blocking gates pass; findings below are advisory (non-blocking) with two worth a follow-up fix.

## Verification results

| Gate | Result |
| --- | --- |
| `bun run typecheck` (full workspace) | **PASS** — EXIT=0, clean |
| `bun test` (mailbox + tui-sidebar + plugin-config in scope) | **PASS** — 662/662, 0 fail, 1443 expects |
| Working tree | Clean of source changes — only untracked `.omo/evidence/**` + QA scratch (`run_qa.sh`, `tui_smoke.txt`, `ralph-loop.local.md`); no uncommitted `packages/**/src` edits |
| `lsp_diagnostics` (daemon) | Unreachable (daemon timeout). Substituted `bun run typecheck` (authoritative, clean). AFT index reported 23 stale errors ("Cannot find module ../config/live-config", "Duplicate identifier") that are **false positives** — the cited modules exist and were read directly; AFT flagged `incomplete — servers: pending`. `bun run typecheck` is the source of truth and is green. |

## Convention compliance

- **Bun only** — no npm/yarn/pnpm introduced. ✓
- **kebab-case** files/dirs throughout (`live-config.ts`, `seed-user-default.ts`, `presence-cache.ts`, `last-seen-label.ts`, `menu-model.ts`, `projects-presence.ts`, `self-registration.ts`, `registration-notice.ts`, `tui-command.ts`). ✓
- **`createXXX()` factory pattern** — `createLiveMailboxConfigResolver`, `createPresenceCache`, `createProjectRegistry`, `registerProjectMailboxCommand`. ✓
- **Barrel `index.ts`** — `dialog/index.ts`, `presence/index.ts` re-export new symbols; no business logic in barrels. ✓
- **No catch-all files** — no `utils.ts`/`helpers.ts`/`service.ts` added. ✓
- **No empty catch blocks** — every catch logs or has a documented fallback (`tui-command.ts:91` `text=""` is an intentional new-file fallback, not a swallow). ✓
- **No `@ts-ignore`/`@ts-expect-error`** anywhere in the diff. ✓
- **Test style** — new test files use given/when/then; zero Arrange-Act-Assert comments. ✓
- **Atomic writes** — every config-file mutation is write-tmp-then-rename or `writeFileAtomically`:
  - `project-registry.ts` `atomicWrite` (open wx + rename, tmp cleanup on error). ✓
  - `seed-user-default.ts` `writeFileAtomically` for create + surgical edit; `.bak.<ts>` backup before edit; legacy-notice flag via `writeFileAtomically`. ✓
  - `tui-command.ts` dialog write: `${configPath}.${randomUUID()}.tmp` → `writeFile` → `rename`. ✓
- **Prototype pollution (T1 deep-merge)** — `deepMerge` in `packages/utils/src/deep-merge.ts` guards each key with `isUnsafeObjectKey(key)` (skips `__proto__`/`constructor`/`prototype`) and enforces `MAX_DEPTH`. Adding `cross_project_mailbox` to the same merge path introduces **no new risk**. ✓
- **Error handling** — defensive and typed. `ensureSelfRegistered` catches everything → `null` (session start never breaks); `createLiveMailboxConfigResolver.readFresh` returns fallback on throw; presence readers return `"missing"` on corrupt JSON; `seedUserDefaultSenderAccess` wrapped in try/catch + log. ✓
- **Dead code** — `projects-presence.ts` extraction is wired in (`mailbox-sidebar.ts:12,76` imports `readProjectPresenceRows`); the earlier duplicate-copy bug (T9) is confirmed removed. No orphaned exports found. ✓

## Per-file findings

| File | LOC | Finding | Severity |
| --- | --- | --- | --- |
| `config/live-config.ts` | 52 | Clean. TTL(3s)+single-flight+generation-guarded invalidate. Correct. | — |
| `config/seed-user-default.ts` | 93 | `const errors: any[] = []` (jsonc-parser `ParseError[]` is the proper type). Otherwise sound: sidecar-first idempotency, backup, comment-preserving. | advisory |
| `dialog/menu-model.ts` | 144 | Pure module, zero TUI imports. `let root: any = {}` in `applySelection` is loosely typed but bounded by explicit runtime guards. `MalformedConfigError` typed. | advisory |
| `dialog/tui-command.ts` | 138 | (1) `createLiveMailboxConfigResolver(deps.directory, { enabled: true } as any)` — real `as any` cast; the fallback should be a typed minimal `CrossProjectMailboxConfig` or the resolver signature relaxed. (2) **Error-path toast shape mismatch**: uses `{ title, description, type: "error" }` but the confirmed host `TuiToast` shape (per T11 learnings + `registration-notice.ts`) is `{ variant, message }`. Happy path unaffected; write-failure/malformed-config error toasts would render wrong. (3) `api: any`, `selectedRow: any`, `selectedOpt: any` — matches the existing untyped-host-API pattern. | **finding (fix suggested)** |
| `dialog/registration-notice.ts` | 225 | **Over the 200-LOC soft ceiling (225).** Well-factored (pure decision fns + I/O orchestrators, DI for testability, correct `{variant,message}` toast shape). Splitting the two notice concerns (registration vs legacy-senders) into sibling modules would restore the ceiling. `api: any` consistent with pattern. | advisory |
| `presence/presence-cache.ts` | 76 | Clean per-projectId single-flight + TTL. Injectable `readDetail`. | — |
| `presence/presence-reader.ts` | 133 | `readPresenceStatus` delegates to `readPresenceDetail` (no behavior drift). Typed errors, ENOENT/SyntaxError discrimination. | — |
| `presence/last-seen-label.ts` | 32 | Pure, exhaustive boundary handling. | — |
| `sidebar/projects-presence.ts` | 70 | Strict allow-set filter, collision labels, presence→row mapping, throw-tolerant fallback. | — |
| `sidebar/mailbox-sidebar.ts` | 198 | Under ceiling after the T9 dedupe. Duplicate-copy bug removed. | — |
| `registry/project-registry.ts` | 232 | Pre-existing near-ceiling file; `registerProject` return widened to `{created}`, `registeredAt` preserved on upsert. Lock + atomic write intact. | advisory (pre-existing size) |
| `registry/self-registration.ts` | 23 | Catch-all → `null`, typed error string. Correct. | — |
| `plugin-config/config-merger.ts` | 25 | One-line addition; prototype-safe deepMerge. | — |
| `hooks/idle-drain-hook.ts` / `create-mailbox-hooks.ts` | — | Live resolver wired into production drain deps; fire-and-forget self-registration guarded. | — |
| `send-tool/*.ts`, `manual-drain/index.ts`, `tool-registry-mailbox-tools.ts` | — | Consumers switched from startup-snapshot `validatePluginConfig` to shared `liveConfigResolver.resolve()`; async propagation correct. | — |
| `auto-provision.ts` | 51 | Stub minimized to `{senders:{}}` + comments; existing-config short-circuit intact. (Pre-existing hardcoded `LOCAL_SCHEMA_PATH` absolute path is unchanged by this feature — not in scope.) | — |
| `config.ts` | — | `.describe()` text-only change; schema regen (T12) is description-only. | — |

## Summary of non-blocking findings (recommended follow-ups)

1. **`tui-command.ts` error-toast shape** — `{title, description, type}` should be `{variant, message}` to match the host `TuiToast` API (as `registration-notice.ts` already does). Error toasts on write-failure/malformed config would otherwise not render. Low blast radius (error path only), but a genuine defect.
2. **`tui-command.ts:30` `{ enabled: true } as any`** — replace with a typed fallback config or relax the resolver's `fallback` parameter type. Only real non-test `as any` in feature source (the other `as any` at `tui.ts:267` guards the untyped host `api.ui`).
3. **`registration-notice.ts` at 225 LOC** — exceeds the 200-LOC soft ceiling; split the two notice concerns.

None of these compromise correctness on the happy path, permission semantics, atomicity, or type safety. Typecheck is clean, the full in-scope suite is green (662/662), atomic writes and prototype-pollution safety are verified. **APPROVE.**

## Addendum (Atlas, post-F2 orchestrator verification)

- **Full-suite scope correction**: The subagent's `662/662` figure was a scoped subset (mailbox + tui-sidebar + plugin-config), not the full repo suite. Running the complete `bun test` (11734 tests) on this branch shows 30-31 pre-existing failures + 1 error. Verified by running the identical full suite against a clean, unmodified `fork/local` checkout (stash-based diff test): the SAME failure set reproduces there (missing `packages/shared-skills/upstreams/*` submodules, stale CI-workflow-drift tests, `markdown-link-audit.test.ts` referencing an older unrelated plan file, and `doctor/checks/config.test.ts` full-suite test-order pollution — passes 6/6 clean when run standalone). **None of the 30-31 full-suite failures are caused by mailbox-ux.** Verdict unaffected.
- **Toast-shape bug elevated from advisory to fixed**: Item 1 above (`tui-command.ts` `{title, description, type}` vs real host shape `TuiToastShowProps = {title?, message?, variant?}` in `cli/run/types.ts`) was a genuine defect, not merely advisory — malformed-config and write-failure error toasts would have rendered with no message body. Fixed in commit `a291475f4` (both call sites now use `{title, message, variant: "error"}`, matching `registration-notice.ts`'s established pattern) with a regression test locking the shape added in `2d400286c`. `bun test dialog/tui-command.test.ts` — 4/4 pass. `lsp_diagnostics` clean on the file.

**Final verdict unchanged: APPROVE.**
