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
