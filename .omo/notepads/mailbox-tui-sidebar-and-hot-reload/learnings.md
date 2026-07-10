# Learnings — mailbox-tui-sidebar-and-hot-reload

## [2026-06-30] Session start
- Plan has 20 design blockers resolved over 8 review rounds — do NOT revisit B1-B5, C1-C4, D1-D6, E1-E2, F6, F7
- jsonc-parser: IMPORT `{ parse, modify, applyEdits }` FROM NPM PACKAGE DIRECTLY, not from packages/utils/src/jsonc-parser.ts (that only exports omo wrappers)
- ROOT cross_project_mailbox field STAYS `.optional()` in oh-my-opencode-config.ts (no .default()); default injected post-merge via applyMailboxDefault()
- T6 hot-reload: use deps.thisRepoRoot (NOT deps.directory - does not exist on ProjectMessageToolDeps)
- T4 auto-provision: uses detectPluginConfigFile() not hardcoded existsSync(); clears cache after write
- T10 queueTuiPreferenceUpdate path arg: ["mailbox","collapsed"] NOT ["oh-my-openagent","mailbox","collapsed"] (helper prepends root internally)
- Static inputSchema in project-message-tool.ts: use MAX_BODY_BYTES (32768) not config.bounds.max_body_bytes
- magic-context tui-preferences.ts reference: /Volumes/Topper2TB/Git/magic-context/packages/plugin/src/shared/tui-preferences.ts
- Bun runtime only (never npm/yarn); given/when/then test style; no empty catch; no as any

## T3 — omo TUI preferences helper (jsonc-parser, comment-safe)

- New file `packages/omo-opencode/src/features/tui-sidebar/tui-preferences.ts`. No barrel index.ts in that dir (siblings import directly from `./module`), so exported nothing extra.
- `jsonc-parser` already at `packages/omo-opencode/package.json:33` (`^3.3.1`). Import `parse, modify, applyEdits` DIRECTLY from `"jsonc-parser"` — `packages/utils` wrapper only re-exports `parseJsonc`/`readJsoncFile` etc, NOT `modify`/`applyEdits`.
- `queueTuiPreferenceUpdate(path, value)` PREPENDS `["oh-my-openagent"]` internally — callers pass `["mailbox","collapsed"]`. Top-level key is exactly `"oh-my-openagent"`.
- Two distinct file states handled differently: missing/empty -> seed `"{}\n"` then write; malformed non-empty -> `parse` throws -> SKIP write, file unchanged. Tested both.
- `modify`+`applyEdits` is surgical: a sibling `"magic-context"` key with a `// comment` survives byte-for-byte (verified via `toContain`). No JSON.parse->stringify (would strip comments).
- Atomic write = temp file with `randomUUID()` suffix + `rename`. Serialized via module-level `writeChain` promise chain with `.catch(() => {})` so it never throws.
- Tests use `OPENCODE_TUI_PREFERENCES_FILE` env to redirect to a per-test temp file; restore/delete in afterEach.
- `bun test` 5/5 green; `bun run typecheck` exit 0.

## T2 — Outbox canonical projectId + repoRoot (done)
- `parseOutboxLine` previously lived as a private fn in `sidebar/mailbox-sidebar.ts`. Moved canonical impl to `send-tool/outbox-log.ts` (exported), sidebar now imports it — single source of truth.
- Fix in `project-message-tool.ts`: outbox append used `input.targetProjectId` (raw, possibly display name). Now uses resolved `targetEntry.projectId` (canonical) + `targetEntry.repoRoot`. `targetEntry` already in scope from the display-name fallback lookup at :65-70.
- `OutboxEntry.toRepoRoot` is OPTIONAL for back-compat; parser tolerant (missing field -> undefined, garbage -> null).
- T5 (C1 reader) depends on this canonical data to resolve ack dirs.


## T1 — inject populated mailbox default post-merge (commit 26984744b)

- ROOT `cross_project_mailbox` field at `oh-my-opencode-config.ts:90` was ALREADY `.optional()` with no `.default()` — no change needed there. The B1 clobber risk (a nearer per-layer `.default()` overriding a farther explicit `enabled:false` via the shallow `...override` spread in `config-merger.ts:8-10`) is structurally avoided by keeping the root optional and injecting ONLY post-merge.
- Inner default flip lives at `features/cross-project-mailbox/config.ts` `enabled: z.boolean().default(true)` (was false). Safe because it only fires when the block IS present in a layer.
- New helper `features/cross-project-mailbox/config-defaults.ts` `applyMailboxDefault(config)`: returns config untouched if `cross_project_mailbox !== undefined` (honors explicit false), else injects `CrossProjectMailboxConfigSchema.parse({})` (enabled:true, default_sender_access:"allow-none", senders:{}).
- Wired ONCE post-merge in BOTH loaders:
  - `config/validate.ts` mergeLoadedConfig: `return applyMailboxDefault(applyDisabledProviders(config))`
  - `plugin-config/layered-config-loader.ts` loadPluginConfig: after `applyDisabledProviders(config)`, `config = applyMailboxDefault(config)` (helper is non-mutating, reassign).
- `create-mailbox-session-hooks.test.ts` needed NO change: its "unset" case passes `cross_project_mailbox:undefined` straight to the hook factory, bypassing the loader, so the populated-default injection (which lives in the loaders only) doesn't reach it.
- Full `bun test` has 25 PRE-EXISTING unrelated failures (DMCA submodule HEAD pins, codex installer/Git-Bash preflight, model snapshot guardrails, omo-codex telemetry bundle guard, model-resolution-config env-timing). None touch mailbox config. Scoped suites + typecheck + build:schema all green.


## T4 — Auto-provision trigger fix + enabled:true stub (commit 01711c5cf)

- After T1 the merged `cross_project_mailbox` block is ALWAYS populated, so the old `if (!config)` provisioning trigger in `create-mailbox-session-hooks.ts` went dead. New trigger: `if (config?.enabled !== false)` — unconditional except explicit hard-off.
- `auto-provision.ts` idempotent gate must use `detectPluginConfigFile(opencodeDirPath, { basenames:[CONFIG_BASENAME], legacyBasenames:[LEGACY_CONFIG_BASENAME] })` and skip on `format !== "none"`. The old `existsSync(".opencode/oh-my-openagent.jsonc")` missed `.json` and legacy `oh-my-opencode.*` basenames — would overwrite when a legacy config existed.
- MUST call `clearPluginConfigFileDetectionCache()` after a successful write; `detectPluginConfigFile` memoizes per `dir::basenames::legacy` key, so a same-process `validatePluginConfig` would otherwise still see "none".
- Stub now writes `"enabled": true` (was false); root `OhMyOpenCodeConfigSchema.parse` of the stub yields enabled:true / allow-none / empty senders.
- Both helpers imported from `../../shared/jsonc-parser` (re-exports `@oh-my-opencode/utils`).
- Pre-existing worktree state: uncommitted edits to `hooks/idle-drain-hook.ts` + test (separate fresh-config-read task). Kept OUT of the T4 commit.
- Full `bun test`: 25 pre-existing unrelated failures (codex installer, omo-codex telemetry bundle guard, model-resolution-config OPENCODE_CONFIG_DIR, Qwen snapshot). Confirmed pre-existing via `git stash`. None touch cross-project-mailbox. Typecheck clean.
- `.omo/evidence/` is gitignored — evidence file lives on disk only, never staged.


## T5 — C1 reader: registry injection + 3-state outbound ack (commit e5d9a0a1b)

- `readMailboxSidebarState` signature is now `(repoRoot, config, registry)` where
  `registry: MailboxSidebarRegistryPort { getRepoRootForProjectId(id): string | undefined }`.
  Exported from `sidebar/index.ts` for T8 to consume.
- `MailboxSidebarState` gained `outboundUnresolved`, `outboundRead`, `outboundFailed`.
- Outbound ack path: `<targetRepoRoot>/coordination_notes/<senderProjectId>/{processed|rejected}/<msgId>.md`,
  `senderProjectId = projectIdForRoot(repoRoot)`. Resolution per entry:
  `entry.toRepoRoot ?? registry.getRepoRootForProjectId(entry.toProjectId)`; undefined → unresolved (no throw).
  `existsSync` wrapped in try/catch that logs (no throw, no empty catch).
- `readRecentSent` now tail-slices `slice(-OUTBOX_ACK_WINDOW)` (50) BEFORE `parseOutboxLine` (Codex B5 fix).
  Verified via a counting registry: 60 entries → exactly 50 `getRepoRootForProjectId` calls.
- `.delivering-*.md` inbound notes excluded via explicit `RESERVED_PREFIX` guard in `isNoteFile`
  (the old `!startsWith(".")` already covered it, but the guard is now intentional).
- `parseOutboxLine` imported from `../send-tool` barrel (re-exports outbox-log.ts), NOT locally.
- GOTCHA: pre-commit hook refreshes models cache + a global `git add -A` would sweep in other
  in-flight task files (idle-drain-hook etc.). Stage ONLY the 3 sidebar files explicitly.
- `.omo/evidence/` is gitignored — evidence file lives on disk only, not in the commit (expected).
- 7/7 reader tests green; `bun run typecheck` clean.

## T7 (C4): idle-drain lazy config re-read + permissionless early-out

- `session.idle` handler now re-reads config per-drain via a new injected
  port `validatePluginConfig(deps.directory)` on `IdleDrainHookDeps`.
  Wired in `create-mailbox-hooks.ts` from `config/validate.ts`. Read-only;
  `loadPluginConfig` is NOT called on the hot-path (no migration side effects).
- `resolveFreshConfig(deps)`: trusts `read.config.cross_project_mailbox` only
  when `valid && present`; otherwise falls back to captured `deps.config`
  (last-known-good — never the partial parse on `valid:false`).
- Two cheap early-outs at the TOP of the handler (before resolving primary /
  listing projects / any I/O):
  - `freshConfig.enabled === false` -> return (hard-off).
  - permissionless (`default_sender_access === "allow-none"` AND no sender
    with `access === "allow"`) -> return. This is the documented emulated-off
    state; now a true no-op.
- `freshConfig` threaded into eligibility, maxNotes, and `processNote` ->
  `validateInbound` uses the fresh config.
- GOTCHA: two-repo-integration.test.ts builds `IdleDrainHookDeps` inline, so
  it needed the new `validatePluginConfig` field (echo the provided config).
  Its old "unauthorized sender" case used `allow-none` + empty senders, which
  is now the permissionless early-out; added a decoy allow-sender so the
  authorization-reject path it actually tests still executes.
- Use `deps.directory`, never `ctx.directory` (no ctx in session.idle scope).
- Evidence: .omo/evidence/task-7-mailbox-tui-sidebar-and-hot-reload.txt


## [2026-06-30] T6 / C4 — send-tool lazy config re-read
- `execute()` now re-reads merged config per send via `validatePluginConfig(deps.thisRepoRoot)` (read-only loader at config/validate.ts:145). NOT loadPluginConfig (side-effecting migrations).
- Static `inputSchema` MUST use `MAX_BODY_BYTES` (32768 hard cap), NOT `deps.config.bounds.max_body_bytes` — built once at registration, cannot hot-reload.
- Body cap check runs BEFORE `inputSchema.parse` so an oversize body is a clean `{blocked:true}` JSON result, not an uncaught ZodError. Effective cap = `Math.min(freshConfig.bounds.max_body_bytes, MAX_BODY_BYTES)`.
- Preflight gets fresh senders/budget via `runProjectMessageSend(input, { ...deps, config: freshConfig })`.
- TEST GOTCHA: once execute() reads real merged config from disk, the 2 pre-existing execute() tests (configless temp dir → default allow-none → blocked) break. Fix: isolate config discovery by pointing `XDG_CONFIG_HOME` at empty temp + `delete OPENCODE_CONFIG_DIR` in beforeEach (restore in afterEach), and write `.opencode/oh-my-openagent.json` under thisRepoRoot.
- 25 full-suite failures are PRE-EXISTING (DMCA provenance, model-family/GPT-5.5 snapshot, install-codex, lazycodex, model-resolution OPENCODE_CONFIG_DIR). Confirmed by stashing only the 2 changed files — the env-touching model-resolution-config test fails identically without my change.


## T8 — readView+viewKey mailbox wiring (commit 88fd6471e)
- Idle SidebarView variant gained `readonly mailbox?: MailboxSidebarState | null`; active variant already had it. computeView idle branch now mirrors active's optional spread `...(sections.mailbox === undefined ? {} : { mailbox: sections.mailbox })` so `enabled:false` (which yields null section) still renders mailbox-null, while a truly absent section omits the key.
- `stableMailboxKey` MUST hash all 6 fields now: [inboundUnread, inboundProcessed, recentSentCount, outboundUnresolved, outboundRead, outboundFailed]. viewKey idle case wraps it as `["mailbox", stableMailboxKey(view.mailbox ?? null)]` — same shape as active. Two idle views with identical inbound but different outbound categories now key-differ.
- tui.ts readView: added `loadMailboxSection(directory)` using the existing lazy dynamic-import pattern. Loads config via `validatePluginConfig(dir)` + `applyMailboxDefault(...).cross_project_mailbox`; returns null when missing OR `enabled === false`. Registry port built synchronously from `createProjectRegistry().listProjects()` -> Map(projectId->repoRoot) -> `{ getRepoRootForProjectId: id => map.get(id) }`. readView was already async; just awaited the new section.
- Existing compute-view.test fixture `mailboxSection` lacked outbound fields (MailboxSidebarState requires all 6) — had to add outboundUnresolved/Read/Failed:0 to the fixture or typecheck fails.
- Verified: scoped `bun test tui-sidebar/ + tui.test.ts` = 71 pass/0 fail; `bun run typecheck` clean. TDD red (2 fail) -> green (13 pass) on compute-view.test.ts.

## T9 — buildViewNodes mailbox section + collapse toggle (commit b039c6db7)
- `buildViewNodes` now takes optional 3rd param `mailboxToggle?: MailboxToggleOpts { collapsed, onToggle }`; existing 2-arg caller in `tui.ts:165` stays valid (T10 wires the toggle).
- Idle case had to change from returning `[section("Models", ...)]` to wrapping `idleNodes + mailboxNodes` in a `box({flexDirection:"column", gap:1}, ...)` so a mailbox section can append; when mailbox is null `mailboxNodes` returns `[]`, so output is structurally the Models box alone inside the wrapper.
- Collapse: `onMouseDown` is set on the header `text()` props ONLY when `toggle?.onToggle` exists; collapsed=true renders a header-only box (rows omitted) but the header KEEPS the onMouseDown prop — verified via a flattenText test helper walking the node tree.
- `describeView`/`linesForView` plaintext variant got `mailboxLines()` (no collapse logic in text) wired into both active and idle; outbox line is conditional on any of read/unresolved/failed > 0, mirroring the node renderer.
- Evidence written to `.omo/evidence/` (dir is gitignored — committed code+test only; evidence stays on disk as required).


## T10 — tui.ts collapse closure (commit daebef8c7)
- Task spec referenced `readTuiPreference`, but `tui-preferences.ts` (do-not-modify) actually exports `readTuiPreferencesFileSync()` + `resolveOmoCollapsed(root)` for reads. Seed adapted to `resolveOmoCollapsed(readTuiPreferencesFileSync())`, which defaults to false on any missing/malformed segment.
- `MailboxToggleOpts.collapsed` is a readonly value field, not a getter callsite — used an object literal with a `get collapsed()` accessor so the renderSidebar closure always reads the live `mailboxCollapsed` value at render time rather than a frozen snapshot.
- `queueTuiPreferenceUpdate(["mailbox","collapsed"], value)` prepends the `"oh-my-openagent"` root key internally; pass the path WITHOUT the root prefix.
- tui.ts is a plugin entrypoint (not unit-testable in isolation). Proved persistence via round-trip test driving the real prefs helpers against an isolated file (`OPENCODE_TUI_PREFERENCES_FILE` env override → mktemp dir).
- bun test (scoped tui.test.ts): 4 pass / 0 fail. `bun run typecheck`: clean across all packages.
