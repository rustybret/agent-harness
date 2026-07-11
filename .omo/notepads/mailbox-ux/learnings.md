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
