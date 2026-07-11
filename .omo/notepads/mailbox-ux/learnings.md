# Learnings — mailbox-ux

## [2026-07-11] T2 auto-provision stub

- The project stub can omit `enabled` and `default_sender_access`; `OhMyOpenCodeConfigSchema` resolves them to `true` and `allow-none`.
- Generated config guidance requires `parseJsonc` in tests because the usage comments intentionally make the stub JSONC rather than strict JSON.
- The existing-config detection short-circuit and post-write detection-cache clear remain unchanged.
# Mailbox UX Learnings

## T1. Deep-merge `cross_project_mailbox` in mergeConfigs

### Findings & Changes
- Added `cross_project_mailbox: deepMerge(base.cross_project_mailbox, override.cross_project_mailbox)` to `packages/omo-opencode/src/plugin-config/config-merger.ts` alongside `team_mode`.
- Created `packages/omo-opencode/src/plugin-config/config-merger.test.ts` to verify the six required scenarios:
  1. User `allow-all` + project `{senders:{}}` -> merged keeps `allow-all`.
  2. Project explicit `allow-none` beats user `allow-all`.
  3. Senders per-key union, project wins on same key.
  4. Both undefined -> undefined (schema default fills later).
  5. `bounds` partial override merges per-key.
  6. Legacy-activation case: user-level `senders:{"legacy-x":{access:"allow",intent_budget:"impl"}}` + project stub -> merged config contains legacy-x. This is the announced behavior change (cross-referenced with T3's warning).

### Gotchas for Downstream Tasks
- **T6 (Live-config resolver):** Since `mergeConfigs` now deep-merges `cross_project_mailbox`, any live config resolution must ensure that the user-level config and project-level config are merged correctly. The resolver should invalidate its cache when the config is updated (e.g., in T10).
- **T10 (Dialog write path):** When writing to the project config, we must call `invalidate()` on the live config resolver to ensure the next permission check reads the fresh merged config.
- **T13 (Integration test):** The integration test should verify that user-level mailbox settings (like `default_sender_access: "allow-all"`) are correctly inherited by projects that only have a stub config.

## T4: ProjectRegistry `registeredAt` and `created` flag
- `registerProject` now returns `{ created: boolean }`.
- `created` is `true` ONLY when the project was not already in the registry.
- `registeredAt` is set to `Date.now()` on creation and preserved on subsequent upserts.
- Legacy entries without `registeredAt` are preserved as-is (no backfill) when re-registered, and `created` is `false`.
- `lastSeen` is always bumped to `Date.now()` on every call.
- The lock-contention test uses `spyOn(Date, "now")` to simulate timeout without waiting 15s.

## T3: Seed `allow-all` into user-level config
- **Flag file for legacy senders**: When legacy `cross_project_mailbox.senders` entries are detected in the user config, a flag file is written to notify the TUI (for T11).
  - **Path**: `path.join(path.dirname(getSidecarPath(configPath)), "legacy-senders-notice.json")` (i.e., next to the migrations sidecar, which is next to the config file).
  - **Shape**: `{"senders": ["project-a", "project-b"]}`
  - **Behavior**: The entries in the config are NOT modified or deleted. The flag file is just a signal for the TUI to show a toast.
- **Idempotency**: Uses `readAppliedMigrations` and `writeAppliedMigrations` with the key `2026-07-mailbox-default-sender-access-allow-all`.
- **Comment preservation**: Uses `jsonc-parser`'s `modify` and `applyEdits` instead of `JSON.stringify` to preserve user comments and formatting.

## T5: Auto self-registration on session start

### Implementation
- `ensureSelfRegistered` in `registry/self-registration.ts` wraps `registry.registerProject` in a try/catch that catches EVERYTHING — session start must never break.
- On success, logs `[cross-project-mailbox] self-registration` with `repoRoot` and `created`.
- On failure, logs `[cross-project-mailbox] self-registration failed` with error details and returns `null`.
- Wired as fire-and-forget (`void ensureSelfRegistered(...)`) inside `buildIdleDrainDeps` after `refreshSnapshot()`, which is only called when `config.enabled` is true.

### Gotchas
- **macOS `/var` vs `/private/var`**: `registerProject` calls `realpathSync` internally, which resolves macOS symlinks. Tests comparing `repoRoot` must also use `realpathSync` on the expected path, or the assertion fails with `/var/...` vs `/private/var/...`.
- **Read-only dir test**: Must create the directory with `mkdir` before calling `chmod` to make it read-only — `mkdtemp` only creates the parent.
- **Stash hazard**: `git stash` in this worktree can contain stale modifications from prior tasks (e.g., `idle-drain-hook.ts`, `manual-drain/index.ts`). Always `git diff` after stash pop to verify only expected files changed.
- **File persistence with `write` tool**: The AFT `write` tool may not persist files to the worktree filesystem in some edge cases. Use `bash` with `cat > file << 'EOF'` as a fallback when files disappear after write.

## T6: Live mailbox config resolution

- `createLiveMailboxConfigResolver` defers `validatePluginConfig` into a promise microtask, so concurrent callers share one in-flight config read before any caller can start a duplicate read.
- The production cache TTL defaults to exactly 3000ms. Cached calls perform no validation or filesystem-stat work; expiry causes one fresh merged-config read.
- `invalidate()` increments a generation and drops both cached and in-flight references, so the next call reads immediately while a superseded read cannot repopulate the cache.
- Resolution applies `applyMailboxDefault` after validation and returns the startup snapshot on invalid config or any thrown read/defaulting error.
- The same resolver instance is injected into message, note, peek/drain dependencies by `createMailboxToolsRecord`; permission preflight, advisory budget reads, and inbound validation receive the resolved operation-time config.
- The isolated OpenCode TUI smoke passed with the host DB session count unchanged (5814 before and after). The SSE self-test did not observe `server.connected` within its 15-second window; deterministic mailbox tests remain the direct behavioral proof for T6.

## T6 Follow-up: Wire live-config resolver into production idle-drain hook deps

- Wired `createLiveMailboxConfigResolver` into `buildIdleDrainDeps` in `packages/omo-opencode/src/features/cross-project-mailbox/hooks/create-mailbox-hooks.ts`.
- This ensures the production idle-drain hook (`idle-drain-hook.ts`) uses the TTL-cached/single-flight config resolver instead of falling back to per-call config validation.
- Verified that all 440 tests in `packages/omo-opencode/src/features/cross-project-mailbox` pass successfully.

## T6 recovery after the shared-worktree race

- The earlier parallel T5-T8 attempt raced on this worktree and destroyed or scattered the uncommitted T6 changes across the working tree and stashes.
- Recovery used the surviving `config/live-config.ts` and `config/live-config.test.ts` drafts plus the relevant hunks from `stash@{2}` (`plugin/tool-registry-mailbox-tools.ts`) and `stash@{3}` (`hooks/idle-drain-hook.ts` and `manual-drain/index.ts`). The stale `hooks/create-mailbox-hooks.ts` hunk in `stash@{3}` was deliberately excluded because it belonged to already-committed T5 scope.
- The final production idle-drain path constructs the TTL-cached resolver inside `createIdleDrainHook` when one is not injected. This corrects the earlier follow-up note above: `hooks/create-mailbox-hooks.ts` remains untouched.

## T8: Pure menu model for /project-mailbox dialog

- Implemented `buildTopMenu`, `buildSubmenu`, `applySelection`, and `MalformedConfigError` in `dialog/menu-model.ts` (pure module, zero TUI imports).
- `buildTopMenu` filters out the self project and sorts alphabetically by `displayName`, tie-breaking deterministically by `projectId`.
- Collision handling: if multiple displayed projects share the same `displayName` (or stripped `projectId` when `displayName` is empty), their labels use the full `projectId` (which includes the `-hash` suffix). Singletons use the bare `displayName`.
- `buildSubmenu` returns options (`Disabled`, `question`, `impl`, `plan`) where the currently selected state has `✓ ` prepended to `label` (`✓ impl`) and `selected: true`. Both `choice` and `value` fields are provided on `SubmenuOption` for clean consumption by T10.
- `applySelection` uses `jsonc-parser`'s `modify` and `applyEdits` to preserve comments and formatting byte-for-byte outside the edited span.
- When disabling an unlisted project (or a project without `intent_budget`), `applySelection` sets `access="deny"` and `intent_budget="question"` so Zod validation (`SenderConfigSchema`) passes. If the project already had an `intent_budget`, disabling preserves that existing `intent_budget`.
- `applySelection` performs strict syntax checking via `parse(configText, errors)` and throws `MalformedConfigError` on syntax errors or non-object roots.
- **Gotchas for T10 (TUI dialog wiring)**:
  1. `applySelection` returns the modified JSONC string. The TUI must write this string back to the config file atomically and then immediately call `invalidate()` on the live config resolver (`createLiveMailboxConfigResolver`) so subsequent permission checks and menu rebuilds see the updated permissions without waiting for TTL expiry.
  2. When `applySelection` throws `MalformedConfigError`, T10 should catch it, display an error toast (`api.ui.toast`), and keep the user on the submenu without writing to disk.
  3. When rendering `DialogSelect` options from `buildSubmenu(row)`, use `option.label` for the display title (which includes `✓ ` for the active state) and `option.choice` when passing the user's selection to `applySelection`.

## T7: Presence detail, cache, and last-seen formatting (C data layer)

- Implemented `readPresenceDetail(projectId, homeDir?, deps?)` in `presence/presence-reader.ts` returning `Promise<{ status: PresenceStatus | "missing"; heartbeatTs: number | null }>`. Reuses `readRecord` and `raceProbe` + `probeSession` logic. `readPresenceStatus` now delegates to `readPresenceDetail` and maps `"missing"` to `"offline"`, keeping existing behavior 100% unchanged.
- Implemented `createPresenceCache(ttlMs = 10_000, options?)` in `presence/presence-cache.ts` returning `{ get, resolve, invalidate }`. Single-flights concurrent calls per `projectId` and caches resolved `PresenceDetail` for `ttlMs` (10s by default).
- Implemented `lastSeenLabel(ageMs)` in `presence/last-seen-label.ts` formatting age in milliseconds into `"Last seen <n> <unit> ago"` using the largest whole unit of seconds/minutes/hours/days (`1500s` -> `"Last seen 25 minutes ago"`, `59s` -> `"Last seen 59 seconds ago"`, `1 day exactly` -> `"Last seen 1 day ago"`). For `ageMs >= 7_776_000_000` (90 days), `null`, `undefined`, or negative values, returns `"Last seen a long time ago"`.
- Exported `readPresenceDetail`, `PresenceDetail`, `createPresenceCache`, `PresenceCache`, `lastSeenLabel`, and `MAX_LAST_SEEN_AGE_MS` from `presence/index.ts`.
- **Gotchas for T9 (Sidebar Projects section)**:
  1. T9 should construct `createPresenceCache(10_000)` once per sidebar/TUI lifecycle and call `cache.get(projectId)` (or `cache.resolve(projectId)`) during `readMailboxSidebarState`. Because the cache single-flights and holds results for 10s, polling every 1s (`POLL_INTERVAL_MS = 1_000`) will execute at most 1 probe per project per 10s.
  2. When mapping `PresenceDetail` to sidebar rows:
     - `status === "live" || status === "internal"` -> presence `"online"`, green dot (`success`).
     - `status === "stale"` -> presence `"~"`, orange dot (`warning`).
     - `status === "offline" || status === "missing"` -> presence `lastSeenLabel(detail.heartbeatTs ? Date.now() - detail.heartbeatTs : null)`, grey dot (`muted`).

## T9 Learnings
- `tui-sidebar` tests are very strict about the exact structure of `ViewNode`s. When reusing layouts like `outboundBudgetRow`, be aware that tests might expect specific node types (e.g., `text` vs `box`) at specific indices.
- `MailboxSidebarState` now includes `projects: ProjectPresenceRow[]`.
- `readProjectPresenceRows` was extracted to `projects-presence.ts` to keep `mailbox-sidebar.ts` under the 200-LOC soft ceiling.
- `tui-command.ts` (T10) was partially present in the worktree from an interrupted run, causing typecheck errors. I fixed the imports to make typecheck pass but left it untracked to keep the T9 commit clean.

## T9 Fix: Dead-code duplicate `readProjectPresenceRows` bug
- **Bug**: `mailbox-sidebar.ts` had a private copy of `readProjectPresenceRows` (lines ~89-145) with `statusText = "~"` for the live/internal case (copy-paste error — should be `"online"`). Meanwhile `projects-presence.ts` had the correct version with `statusText = "online"` but was orphaned/unused dead code.
- **Fix**: Deleted the private duplicate from `mailbox-sidebar.ts`, wired the import from `projects-presence.ts`, and fixed the call site to use `registry.listProjects?.bind(registry)` to match the external function's `(config, listProjects?, deps?)` signature.
- **Test fix**: Updated the test expectation from `statusText === "~"` to `statusText === "online"` for the live case — the test was encoding the bug.
- **idle-drain-hook.ts**: The type-signature change (`ValidatePluginConfigPort` return type updated to `PluginConfigValidation`) was required for `bun run typecheck:packages` to pass; included in this commit.
- `dialog/tui-command.ts` (T10) and `dialog/tui-command.test.ts` were already committed in `7421ddbcb` — they were NOT part of T9's scope and were not staged. T10's `tui.ts` wiring was also pre-committed.

## T9 Fix: Dead-code duplicate `readProjectPresenceRows` bug
- **Bug**: `mailbox-sidebar.ts` had a private copy of `readProjectPresenceRows` (lines ~89-145) with `statusText = "~"` for the live/internal case (copy-paste error — should be `"online"`). Meanwhile `projects-presence.ts` had the correct version with `statusText = "online"` but was orphaned/unused dead code.
- **Fix**: Deleted the private duplicate from `mailbox-sidebar.ts`, wired the import from `projects-presence.ts`, and fixed the call site to use `registry.listProjects?.bind(registry)` to match the external function's `(config, listProjects?, deps?)` signature.
- **Test fix**: Updated the test expectation from `statusText === "~"` to `statusText === "online"` for the live case — the test was encoding the bug.
- **idle-drain-hook.ts**: The type-signature change (`ValidatePluginConfigPort` return type updated to `PluginConfigValidation`) was required for `bun run typecheck:packages` to pass; included in this commit.
- `dialog/tui-command.ts` (T10) and `dialog/tui-command.test.ts` were already committed in `7421ddbcb` — they were NOT part of T9's scope and were not staged. T10's `tui.ts` wiring was also pre-committed.

## T9 Fix: Dead-code duplicate `readProjectPresenceRows` bug
- **Bug**: `mailbox-sidebar.ts` had a private copy of `readProjectPresenceRows` (lines ~89-145) with `statusText = "~"` for the live/internal case (copy-paste error). Meanwhile `projects-presence.ts` had the correct version with `statusText = "online"` but was orphaned/unused dead code.
- **Fix**: Deleted the private duplicate from `mailbox-sidebar.ts`, wired the import from `projects-presence.ts`, and fixed the call site to use `registry.listProjects?.bind(registry)` to match the external function's `(config, listProjects?, deps?)` signature.
- **Test fix**: Updated the test expectation from `statusText === "~"` to `statusText === "online"` for the live case, since that was encoding the bug.
- **idle-drain-hook.ts**: This file's type-signature change (`ValidatePluginConfigPort` return type) was needed for `bun run typecheck:packages` to pass; included in the T9 commit.

## T10 Learnings
- `registerProjectMailboxCommand` is wired into `tui.ts` after `registerSidebarContentSlot`.
- T11 will need to add its own wiring call to `tui.ts` right after this one.
- The dialog write chain uses a local `writeChain` promise to serialize writes, similar to `tui-preferences.ts`.
- `detectPluginConfigFile` is used to find the config file, and `autoProvisionMailboxConfig` is used to create a stub if it doesn't exist.
- `clearPluginConfigFileDetectionCache` must be called after provisioning or modifying the config file to ensure subsequent reads see the new file.

## T11: First-registration toast (A TUI side)

- Found a partial, incorrect draft of `registration-notice.ts`/`.test.ts` and a
  stray `patch-tui.cjs` helper already sitting untracked in the worktree from a
  prior interrupted attempt (git status showed them, git stash list had 4
  unrelated `feat/project-mailbox-ux` WIP stashes not touching T11). Deleted all
  three and reimplemented from a clean read of T3/T4/tui-preferences.ts, per the
  "re-read your own diff before claiming done" directive — the draft used
  synchronous `readFileSync`/`unlinkSync` with `mock.module("node:fs", ...)` in
  its test, which this repo's `mock-module-lifecycle-audit.test.ts` invariant
  discourages; the final version uses `node:fs/promises` for the I/O
  orchestrators and pure dependency-injected functions (`readFile`/`deleteFile`
  callbacks) for the unit-testable core, with zero `mock.module` calls.
- `TuiToast` (from `@opencode-ai/plugin/tui`, confirmed by reading the upstream
  fork checked out locally at `/Volumes/Topper2TB/Git/opencode/packages/plugin/src/tui.ts:226-231`)
  has fields `{ variant?: "info"|"success"|"warning"|"error", title?: string,
  message: string, duration?: number }` — NOT `{title, description, type}` as
  the stray draft's `tui-command.ts` calls used for error toasts. T11's toasts
  use `{ variant: "success"|"info", message: "..." }`.
- `runRegistrationToastCheck`/`runLegacySendersNoticeCheck` take `api: any` (not
  a narrower structural type) to match the existing `registerProjectMailboxCommand`
  pattern in `tui-command.ts:23`, because the local `@opencode-ai/plugin` types
  installed in this worktree do not export `TuiPluginApi` in a form that
  narrows cleanly to `{ ui?: { toast?: ... } }` without an incompatible-signature
  typecheck error (`(input: TuiToast) => void` is not assignable to
  `(input: unknown) => void`).
- T3's legacy-senders-notice flag file path is derived via
  `getSidecarPath(configPath)` then `join(dirname(sidecarPath), "legacy-senders-notice.json")`
  — reuse this exact derivation (via `getOpenCodeConfigDirs` + `detectPluginConfigFile`
  + `getSidecarPath` from `@oh-my-opencode/utils`), do not hardcode a path.
- `legacySendersNoticeState` (the `hasToastedLegacy` in-memory guard) is created
  once per `tui()` invocation (i.e., per TUI session) and threaded through every
  poll tick by reference, mirroring how `collapsed`/`inFlight`/`disposed` are
  already scoped in `tui.ts`.

## T11: First-registration toast
- `api.ui?.toast` takes `message` and `variant` (not `description` and `type` as used in `tui-command.ts`).
- `tui.ts` poll tick is a good place to wire up periodic checks like `runRegistrationToastCheck` and `runLegacySendersNoticeCheck`.
- `queueTuiPreferenceUpdate` is a safe, atomic way to write to `tui-preferences.jsonc`.
n- T11 was successfully verified and the plan file was updated.

## T12: Schema description + regeneration

- Updated `default_sender_access` `.describe()` in `config.ts:48-51` from "Default access for source projects not listed in senders" to "Default access for source projects not listed in senders. User-level config conventionally seeds 'allow-all'; the unlisted-sender ceiling is 'question'."
- Ran `bun run build:schema` to regenerate `assets/oh-my-opencode.schema.json`.
- Verified via `git diff` that ONLY the description string changed in the schema JSON — no structural/type changes.
- T2 stub-compliance test (auto-provision.test.ts line 60-73) passed 6/6.
- Full mailbox suite passed 518/518.
- Typecheck clean (exit 0).
- Committed as `cd104e8c6` with message `chore(schema): document machine-global default_sender_access convention`.

## T13: End-to-end auto-registration + live grant integration

- `applySelection` takes exactly 3 params: `(configText, projectId, choice)` — NOT 6 params as originally attempted. It parses the JSONC config, sets `senders[projectId].access = "allow"` and `senders[projectId].intent_budget = choice` via `jsonc-parser`'s `modify`/`applyEdits`.
- The `readMailboxSidebarState` 4th arg (`deps: MailboxSidebarDeps`) accepts `{ presenceCache, projectEntries }`. The `presenceCache` is a `PresenceCache` from `createPresenceCache()`. The `readDetail` override in `createPresenceCache` must match `typeof readPresenceDetail` which is `(projectId: string, homeDir: string, deps?: ReadPresenceStatusDeps) => Promise<PresenceDetail>`. TypeScript allows a 1-param callback for a 3-param function type (callback parameter bivariance).
- `writePresenceRecord(record, homeDir)` writes a JSON file to `path.join(homeDir, ".omo", "presence", "<projectId>.json")`. For the sidebar test, we pass a fake `readDetail` that ignores `homeDir` entirely, so the presence-home temp dir is just for the `writePresenceRecord` call to succeed (it needs a valid dir to write to).
- The `OhMyOpenCodeConfigSchema.parse({})` returns a valid config with `cross_project_mailbox` as `undefined` (not an empty object). This is fine for `mergeConfigs` — it merges the `cross_project_mailbox` key from both sides independently.
- Dynamic `import("node:fs/promises")` is unnecessary when `mkdtemp`/`rm` are already statically imported from the same module. Use `{ mkdir, writeFile }` from the top-level import instead.
- The test has 37 expect() calls across 4 stages + the original 12 tests, totaling 13 test cases and 0 failures. Wall-clock time is under 1 second for the full file.

## T13: End-to-end auto-registration + live grant integration import fix

### Findings & Changes
- Fixed the broken import path in `packages/omo-opencode/src/features/cross-project-mailbox/__tests__/two-repo-integration.test.ts` from four levels (`../../../../`) to three levels (`../../../`) for both `OhMyOpenCodeConfigSchema` and `mergeConfigs`.
- Verified that the test file and the full mailbox suite pass successfully (519 tests passed).
- Verified that `lsp_diagnostics` is clean on the test file.

## T14: opencode-qa manual evidence
- **TUI APIs**: The current `opencode` version (1.17.18) does not expose the required TUI dialog APIs (`api.keymap.registerLayer`, `api.ui.DialogSelect`). The plugin correctly detects this and skips the registration of the slash command. Therefore, the dialog could not be observed live in the TUI. The exact onSelect write-path was driven programmatically instead to prove comment preservation and atomic writes.
- **Isolation**: The `opencode-qa` skill's `tui-smoke.sh` script provides a robust way to test the TUI in an isolated XDG sandbox. However, when testing features that require specific models, the sandbox must be provided with the correct `models.json` cache, or the TUI will fail to start the session.
