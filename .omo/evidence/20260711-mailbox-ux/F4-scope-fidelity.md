# F4 — Scope Fidelity Audit (mailbox-ux)

**Verdict: APPROVE**

Read-only audit tracing each of the user's six original clarifying answers to concrete shipped behavior in the diff (`fork/local..HEAD`, branch `feat/project-mailbox-ux`). All six are faithfully implemented. No scope deviations found.

Paths below are relative to `packages/omo-opencode/src/features/cross-project-mailbox/` unless otherwise noted.

---

## 1. (1b) Automatic registration on startup with first-time TUI toast — SHIPPED

**Auto-registration (server side):**
- `registry/self-registration.ts:5-23` — `ensureSelfRegistered()` calls `registry.registerProject()`, catches EVERYTHING → `log()` + `null` (session start never breaks).
- `hooks/create-mailbox-hooks.ts:106-109` — fire-and-forget `void ensureSelfRegistered({ registry, repoRoot })` inside `buildIdleDrainDeps`, reached only when `config?.enabled` (gate at `create-mailbox-hooks.ts:192`).

**First-insert detection (toast source of truth):**
- `registry/project-registry.ts:129-137` — `created = existing === undefined`; new entry gets `registeredAt: now` ONLY when `created`; existing `registeredAt` preserved via `...(existing ?? {})` spread; `lastSeen` always bumped. Legacy entries (no `registeredAt`) re-registered stay without it → never toast.

**Toast fires exactly once (not every session):**
- `dialog/registration-notice.ts:28-48` — pure `decideRegistrationToast()`: `show` only when `selfEntry.registeredAt` is a number AND prefs marker `["mailbox","registrationNoticeShown", projectId]` !== true.
- `dialog/registration-notice.ts:54-71` — `runRegistrationToastCheck()` feature-detects `api.ui?.toast`, fires toast, then `queueTuiPreferenceUpdate(markerPath, true)` — prefs marker is the dedup, so subsequent sessions see marker=true → no re-toast.
- Wired into the poll tick: `tui.ts:267-271`.

Marker-file dedup confirmed (prefs-based, not per-session). Matches 1b exactly.

## 2. (2c) Global default allow-all in USER config; project config honored; default NOT written into project stub; existing configs untouched — SHIPPED

**Seed touches ONLY the user config:**
- `config/seed-user-default.ts:12-21` — resolves the primary USER config dir via `getOpenCodeConfigDirs({ binary: "opencode" })` + `detectPluginConfigFile`; writes only to `<userDir>/oh-my-openagent.jsonc`. No project path involved.
- Absent file → created with `default_sender_access: "allow-all"` (`:28-36`). Existing file without key → timestamped `.bak.<ts>` backup (`:76-78`) + surgical `modify`+`applyEdits` insert (`:80-85`, comment-preserving). Existing file WITH key (any value) → sidecar-marked, NOTHING changed (`:69-73`). Malformed → log + skip, no write (`:43-50`).
- Idempotency: sidecar `MIGRATION_KEY` checked FIRST (`:23-26`) so a user who deletes the key later is not re-seeded.
- Wired pre-`loadPluginConfig` with implicit try/catch: `testing/create-plugin-module.ts:138`.

**Project stub omits `default_sender_access` and `enabled`:**
- `auto-provision.ts:14-26` — `stubContent` is `$schema` + `cross_project_mailbox: { "senders": {} }` + JSONC usage comments only. No `enabled`, no `default_sender_access`.
- Test pins it: `auto-provision.test.ts:56-57` asserts `raw` does NOT contain `"enabled"` or `"default_sender_access"`; `:69-71` asserts schema-resolved defaults (`enabled===true`, `default_sender_access==="allow-none"`) still valid.

**Explicit project config always honored (user→project inheritance, project wins):**
- `plugin-config/config-merger.ts:14` — `cross_project_mailbox: deepMerge(base.cross_project_mailbox, override.cross_project_mailbox)`. Project (override) wins per-key; user-level `allow-all` flows through when project omits it.

**Existing configs left as-is:**
- `auto-provision.ts:35` — `if (detected.format !== "none") return` short-circuits before any write.
- Seed idempotent + comment-preserving as above.

Matches 2c exactly.

## 3. (3a) Strict presence denominator — only explicitly-allowed senders, NOT the allow-all population — SHIPPED

- `sidebar/mailbox-sidebar.ts:50-55` — `allowedSenderIds()` filters `sender.access === "allow"` only (deny + unlisted excluded even under allow-all default).
- `sidebar/projects-presence.ts:17-18` — `readProjectPresenceRows` derives its whole row set from `allowedSenderIds(config)`; empty → no rows.
- Collapsed counter `Projects (a/t active)`: `tui-sidebar/render-view.ts:372-377` — `total = mailbox.projects.length` (strict allow set), `active = projects.filter(p => p.presence === "online").length`. Denominator is the strict connected set, never the full population.

Matches 3a-strict exactly.

## 4. (4a) All dialog saves on-selection; esc only closes, never cancels/discards — SHIPPED

- `dialog/tui-command.ts:67-119` — the submenu `onSelect` immediately enters `queueWrite(...)`: read config text → `applySelection` → atomic temp+rename write (`:110-113`) → `resolver.invalidate()` (`:116`) → re-render top menu. The write happens on selection; there is no staged/commit-on-close buffer.
- No cancel/revert/discard path exists anywhere in the file. Esc is not intercepted — it falls through to the host's default dialog close; already-persisted writes stand.
- `dialog/menu-model.ts:84-143` — `applySelection` is a pure text transform applied at selection time; the write chain (`:12-21`) serializes rapid selections so read-modify-write never interleaves.

Matches 4a exactly.

## 5. (TUI-only, no web/API surface expansion) — SHIPPED / NONE ADDED

- Full diff stat reviewed: only files under `features/cross-project-mailbox/`, `features/tui-sidebar/`, `plugin-config/`, `plugin/tool-registry-mailbox-tools.ts`, `tui.ts`, `config.ts`, the schema JSON, and `packages/utils/src/migration.ts` were touched.
- No new agent tools: `plugin/tool-registry-mailbox-tools.ts` diff only swaps `validatePluginConfig` for the live-config resolver (`:57,+liveConfigResolver`); the tool set (`project_message`, `project_note`, mailbox drain/peek) is unchanged — no additions.
- No CLI subcommand, no HTTP/route/API/web files in the diff (verified: no `cli/`, `api/`, `route`, or `web/` source files changed).

Matches "TUI only for now" exactly.

## 6. (`/project-mailbox` command mechanics: top menu → submenu → back to top on selection, esc closes) — SHIPPED

State machine in `dialog/tui-command.ts`:
- Registered as slash command `project-mailbox` via `api.keymap.registerLayer` with feature-detect guard (`:24-27`, absent APIs → `log()` + return).
- `run()` → `renderTopMenu()` (`:37-135`): `buildTopMenu` → `api.ui.dialog.replace(() => DialogSelect(top menu))` (`:52-54`).
- Top-menu `onSelect` (project) → `buildSubmenu(selectedRow)` → `api.ui.dialog.replace(() => DialogSelect(submenu))` (`:56-64`) — non-closing replace, i.e. top → submenu.
- Submenu `onSelect` (tier) → write via `queueWrite`, then `await renderTopMenu()` (`:119`) — returns to a freshly-rebuilt top menu reflecting the new state. Matches "back to top menu on selection."
- Esc → host default close; already-persisted writes stand (no revert). Matches "esc closes menu."
- Menu model states: `dialog/menu-model.ts:45-62` maps `senders[projectId].intent_budget` when `access==="allow"` else `"Disabled"`; `buildSubmenu` (`:65-82`) offers Disabled/question/impl/plan with `✓` on current.

Live keypress capture was not possible (documented in `T14-omitted.md`), but the STATE MACHINE in code implements the specified navigation. Matches item 6.

---

## Deviations

**None found.** All six user answers (1b, 2c, 3a-strict, 4a, TUI-only, and the `/project-mailbox` mechanics) trace to concrete shipped behavior at the file:line evidence cited above. The Must-NOT-Have boundaries (no web/API, no new tools/CLI, no auto-edit of existing project configs, no schema-default flip — `config.ts:50` keeps `.default("allow-none")`) are all respected.

Evidence directory `.omo/evidence/20260711-mailbox-ux/` exists with T1–T14 artifacts including the T14 manual-QA captures and `T14-omitted.md`.
