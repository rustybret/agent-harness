# mailbox-ux - Work Plan

## TL;DR (For humans)

**What you'll get:** Cross-project mailbox becomes self-managing. (A) Every mailbox-enabled session auto-registers its project into `~/.omo/project-registry.json` — no more manual registry edits — with a one-time TUI toast on first registration. (B) The machine-global default becomes `allow-all` (ceiling `question`) via a one-time, comment-preserving seed of the **user-level** config; project stubs shrink to `{"senders": {}}` + explanatory comments; a deep-merge fix makes user-level mailbox settings actually flow into projects. Sender/permission changes take effect **live** (no restart). (C) The Mailbox sidebar gains a third heading — `In / Out / Projects` — with an MCP-style presence list (green `online` / orange `~` / grey `Last seen …`) and a collapsed `Projects (a/t active)` counter counting only explicitly-connected projects. (D) A new `/project-mailbox` slash command opens a native `/mcps`-style dialog: pick any registered project, set `Disabled` / `question` / `impl` / `plan`; every selection writes the project JSONC immediately; esc just closes.

**Why this approach:** Everything rides on surfaces that already exist and are verified: `registerProject()` (locked, atomic, zero callers today), the plugin TUI slot + poll loop, `api.keymap.registerLayer` + `api.ui.DialogSelect` + `api.ui.toast` (all confirmed in the user's opencode fork), the `_migrations` sidecar infra, and the repo's jsonc-parser surgical-edit pattern. No opencode-core changes; plugin-only.

**What it will NOT do:** No web-UI parity (future roadmap). No new agent tools or CLI subcommands. No edits to any existing project config. No Zod schema-default flip (stays `allow-none`; the allow-all default lives as an explicit value in the user-level config). No registry pruning/deregistration. No intent-tier semantic changes.

**Effort:** ~14 todos across 4 waves + final verification wave. **Risk:** medium — the deep-merge change and live-config resolution touch permission-relevant paths; both are fenced with dedicated regression tests. **Decisions:** all six interview forks resolved by user (1b, 2c, 3a-strict, 4a, TUI-only, TDD); mechanics recorded in `.omo/drafts/mailbox-ux.md`.

## Scope

**IN:**
- Auto self-registration on mailbox-enabled session start (server-side), `registeredAt` on true first insert, `lastSeen` refresh, first-registration TUI toast (TUI-side, pref-deduped).
- `mergeConfigs` deep-merges `cross_project_mailbox` (user→project inheritance; per-key senders merge, project wins).
- Auto-provision stub rewrite: `$schema` + `cross_project_mailbox: { "senders": {} }` + JSONC comments; schema-compliance test.
- One-time seed of `cross_project_mailbox.default_sender_access: "allow-all"` into the user-level config (`~/.config/opencode/oh-my-openagent.jsonc` or detected equivalent), sidecar-tracked, comment-preserving, create-if-missing, never overwrite.
- Live (per-operation) mailbox config resolution for send preflight, manual + idle drain, and inbound validation.
- Sidebar: `In / Out / Projects` always-rendered headings; collapsed `Projects (a/t active)`; presence rows per `docs/examples/cross-proejct mailbox - Presence TUI panel.md`; presence cache (10s TTL, single-flight).
- `/project-mailbox` slash command: plugin-registered, native DialogSelect, all registry projects except self, submenu Disabled/question/impl/plan, immediate atomic comment-preserving writes to the project config, esc closes.
- Schema description touch-up + `bun run build:schema`.
- TDD tests throughout + integration test + opencode-qa evidence.

**OUT (Must-NOT-Have):**
- No opencode-core (fork) changes; plugin repo only.
- No web UI work. No new agent-facing tools, no CLI subcommands.
- No AUTOMATED/background modification of existing project-level configs: the seed (T3) touches ONLY the user-level file and only when the key is absent; the new-stub template (T2) affects only projects with no config at all. The ONE sanctioned write path to an existing project config is an explicit, user-driven selection inside the /project-mailbox dialog (T10).
- No change to Zod schema defaults (`default_sender_access` stays `allow-none` at schema layer).
- No registry entry deletion/pruning, no deregistration UI.
- No changes to permission-tier semantics (`question|impl|plan`, legacy map) or to envelope/delivery formats.
- Do not touch `.omo/run-continuation/`, do not commit to `fork/local` directly (worktree branch only until final merge).

## Verification strategy

- **Unit (TDD, bun test, co-located, given/when/then):** every todo lands tests with its implementation; red-first for new modules.
- **Typecheck:** `bun run typecheck` clean at every wave boundary.
- **Schema:** `bun run build:schema` produces a committed, in-sync `assets/oh-my-opencode.schema.json`; stub-compliance test parses the stub and `OhMyOpenCodeConfigSchema.safeParse` succeeds.
- **Integration:** two-temp-repo end-to-end test (register → grant via menu-model → live preflight honors grant → sidebar state reflects).
- **Manual QA (mandatory, opencode-qa skill):** isolated XDG sandbox; tmux TUI smoke proving sidebar Projects section renders, `/project-mailbox` opens/toggles/writes comment-preserved JSONC, first-registration toast fires. Evidence under `.omo/evidence/<YYYYMMDD>-mailbox-ux/` in AGENTS.md format (what tested / observed / why enough / omitted).
- **Fork QA policy:** this is fork-local maintenance (memory 1789) — no PR flow; evidence-bound QA still mandatory because the change is OpenCode-connected.

## Execution strategy

- Worktree: `.local-ignore/worktrees/mailbox-ux`, branch `feat/project-mailbox-ux` off `fork/local` (create via `git worktree add`).
- Waves execute in order; todos INSIDE a wave are independent and may run as parallel `deep`-category subagents (user's staffing suggestion), each owning disjoint files. Wave barrier = all todos green (`bun test` + typecheck) before the next wave starts.
- File-size discipline: 200-LOC soft ceiling → new logic lands as small modules (`registry/self-registration.ts`, `presence/presence-cache.ts`, `presence/last-seen-label.ts`, `dialog/menu-model.ts`, `config/live-config.ts`, `config/seed-user-default.ts`), barrel-exported from their feature `index.ts`.
- The TUI entry (`tui.ts`, 277 lines) is near ceiling: TUI-side additions go into `features/tui-sidebar/` + `features/cross-project-mailbox/dialog/` modules; `tui.ts` gains only wiring calls.
- Feature-detect ALL new host TUI APIs (`api.keymap?.registerLayer`, `api.ui?.DialogSelect`, `api.ui?.dialog`, `api.ui?.toast`) — absent ⇒ skip silently + `log()`, never throw.

## Todos

### Wave 0 — workspace

**T0. Create the feature worktree** — ✅ DONE (worktree `.local-ignore/worktrees/mailbox-ux` on `feat/project-mailbox-ux`; baseline 421/421 green; evidence `T0-baseline.txt`)
- Do: `git worktree add .local-ignore/worktrees/mailbox-ux -b feat/project-mailbox-ux fork/local` from repo root; `bun install` inside it; verify `bun test packages/omo-opencode/src/features/cross-project-mailbox` green as baseline.
- References: memory 1789 (fork trunk = fork/local); `.local-ignore/` is untracked dev space (AGENTS.md STRUCTURE).
- Acceptance: worktree exists on new branch; baseline mailbox suite green; `git status` clean.
- QA happy: baseline test run output saved → `.omo/evidence/<date>-mailbox-ux/T0-baseline.txt`. QA failure: if baseline red, STOP and report (do not build on a broken base) — record failing names in same file.
- Commit: none (setup only).

### Wave 1 — foundations (4 todos, parallel-safe: disjoint files)

**T1. Deep-merge `cross_project_mailbox` in mergeConfigs**
- Do: in `packages/omo-opencode/src/plugin-config/config-merger.ts` add `cross_project_mailbox: deepMerge(base.cross_project_mailbox, override.cross_project_mailbox),` alongside `team_mode` (line 13). `deepMerge` from `@oh-my-opencode/utils` already handles undefined sides (same usage as agents/categories).
- **Legacy-activation caveat (deliberate behavior change, must be announced not silent):** any `cross_project_mailbox.senders` entries ALREADY present in a user-level config are inert today (project stubs shadow them via override-replace) and will become globally active once deep-merged. T3's seed pass detects this and warns (see T3); this todo's job is only to make the merge correct.
- Why: user-level mailbox values (2c) currently never flow through — every project auto-provisions a stub and the override replaces the whole object (verified `config-merger.ts:8-24`).
- Tests (extend `config-merger` tests / add `config-merger.test.ts` if absent): (1) user `{default_sender_access:"allow-all"}` + project `{senders:{}}` → merged keeps `allow-all`; (2) project explicit `allow-none` beats user `allow-all`; (3) senders per-key union, project wins on same key; (4) both undefined → undefined (schema default fills later); (5) `bounds` partial override merges per-key; (6) legacy-activation case pinned as INTENDED: user-level `senders:{"legacy-x":{access:"allow",intent_budget:"impl"}}` + project stub → merged config contains legacy-x (test name states this is the announced behavior change, cross-referencing T3's warning).
- References: `plugin-config/config-merger.ts:4-25`; `plugin-config/layered-config-loader.ts:122-204` (merge order: defaults ← user layers ← ancestors nearest-last; validate happens per-file BEFORE merge in `single-config-loader.ts:56-58` — note merged objects are already-validated partials, so deepMerge of two parsed configs is safe); `config/mailbox-default.test.ts` (existing expectations must stay green).
- Acceptance: new tests green; ALL existing config tests green (`bun test packages/omo-opencode/src/plugin-config packages/omo-opencode/src/config`).
- QA happy: targeted test output → `T1-merge.txt`. QA failure: any existing merge-behavior test regressing must be fixed, never loosened.
- Commit: `fix(config): deep-merge cross_project_mailbox across config layers`

**T2. Rewrite the auto-provision stub (2a)**
- Do: in `packages/omo-opencode/src/features/cross-project-mailbox/auto-provision.ts` replace `stubContent` with: `$schema` (existing LOCAL_SCHEMA_PATH/file:// fallback logic UNCHANGED) + `cross_project_mailbox: { "senders": {} }` and JSONC comments: what the mailbox is, that `/project-mailbox` manages connections interactively, the sender-entry shape (`"<source-projectId>": { "access": "allow"|"deny", "intent_budget": "question"|"impl"|"plan" }`), and that the machine default comes from the user-level config. NO `enabled`, NO `default_sender_access` keys.
- Tests: update `auto-provision.test.ts` (currently expects `senders: {}` — keep; drop/replace any `default_sender_access` expectation; assert absent keys). ADD schema-compliance test: parse the written stub with `parseJsonc`, `OhMyOpenCodeConfigSchema.safeParse` succeeds AND resolved defaults give `enabled === true`, `default_sender_access === "allow-none"` (schema layer unchanged). Assert comments survive in the raw file text (`/project-mailbox` mentioned).
- References: `auto-provision.ts:14-48`; `auto-provision.test.ts:51`; `config.ts:38-61`; `shared/jsonc-parser` detect/clear cache calls (keep).
- Acceptance: tests green; stub file byte-content contains no `default_sender_access` and no `enabled`.
- QA happy: run in temp dir, capture written stub → `T2-stub.jsonc`. QA failure: existing-config short-circuit (`detected.format !== "none"`) still returns without writing — test asserts an existing config is never touched.
- Commit: `feat(mailbox): minimal schema-compliant auto-provision stub with usage comments`

**T3. Seed `allow-all` into the user-level config (2c)** — ✅ DONE (module `config/seed-user-default.ts`; 6/6 tests green; wired in `create-plugin-module.ts:138` pre-`loadPluginConfig`; commit `aad196d4a` after scope-creep amend removing unrelated `utils/models*.json`)
- Do: new module `packages/omo-opencode/src/features/cross-project-mailbox/config/seed-user-default.ts` exporting `seedUserDefaultSenderAccess(): void`. Behavior: resolve the primary user config dir via `getOpenCodeConfigDirs({ binary: "opencode" })` + `detectPluginConfigFile` (same pattern as `layered-config-loader.ts:42-63`). If NO user config exists → create `<dir>/oh-my-openagent.jsonc` containing `$schema` (raw.githubusercontent URL) + `cross_project_mailbox: { "default_sender_access": "allow-all" }` + one comment line explaining it. If config exists → parse with jsonc-parser; if `cross_project_mailbox.default_sender_access` is present (ANY value) → record sidecar migration key and change NOTHING; if absent → timestamped `.bak.<ts>` copy, surgical `modify`+`applyEdits` insert (comment-preserving), atomic temp+rename write. Idempotency: sidecar tracking via `readAppliedMigrations`/`writeAppliedMigrations` (`packages/utils/src/migration/migrations-sidecar.ts`) with key `2026-07-mailbox-default-sender-access-allow-all` — checked FIRST so a user who later deletes the key is not re-seeded. DO NOT route through `migrateConfigFile` (its `JSON.stringify` rewrite strips user comments — `config-migration.ts:171-244`).
- Wire: call once in `serverPlugin()` before `loadPluginConfig()` (in `packages/omo-opencode/src/testing/create-plugin-module.ts`, alongside `migrateLegacyWorkspaceDirectory()`-style init steps), guarded try/catch+log — a seed failure must never block plugin init.
- **Legacy-senders activation warning (guaranteed-visible, not log-only):** during the same pass (regardless of whether the seed key is written), if the user-level config contains a non-empty `cross_project_mailbox.senders`: (1) `log()` the full detail naming each entry, AND (2) persist a pending-notice flag (sidecar-adjacent JSON next to the migrations sidecar, e.g. `legacy-senders-notice.json` with the entry names) that the TUI consumes: T11's toast pass shows a ONE-TIME toast — `Mailbox: user-level sender grants now apply to all projects: <names>` — then clears the flag (marker dedup like the registration toast). Log-only would be effectively silent for TUI users; the toast makes the permission-relevant change unmissable. Never delete or modify the entries themselves (user data).
- Tests (temp HOME/config dirs): absent-file → created with key; file-without-key → key inserted, comments+other keys byte-preserved, backup exists; file-with-key(`allow-none`) → untouched + sidecar marked; sidecar-already-marked + key deleted by user → untouched (no re-seed); malformed JSONC → skip + log, no write, no crash; user config with non-empty legacy `senders` → warning logged naming the entries + pending-notice flag file written with those names, config content untouched; empty/absent senders → no flag file.
- References: `layered-config-loader.ts:42-63` (dir/file detection), `tui-preferences.ts:62-96` (modify/applyEdits/atomic pattern to copy), `migrations-sidecar.ts:39-88`, `config-migration.ts:190-207` (backup naming convention), user decision Q2=2c.
- Acceptance: all five test scenarios green; wired call present in create-plugin-module with try/catch.
- QA happy: before/after user-config diff in temp env → `T3-seed.diff`. QA failure: malformed-file scenario logged, file untouched.
- Commit: `feat(mailbox): one-time comment-preserving seed of user-level default_sender_access allow-all`

**T4. `registeredAt` + first-insert detection in ProjectRegistry**
- Do: `registry/types.ts` → `ProjectEntry.registeredAt?: number`. `registry/project-registry.ts` → `registerProject(repoRoot: string): Promise<{ created: boolean }>`: inside the existing `withRegistryLock`, `created` = no existing entry with this projectId; new entry gets `registeredAt: Date.now()` when created; upsert PRESERVES an existing `registeredAt` (and sets `lastSeen: Date.now()` always, as today). Existing callers (`discoverFromOpenClaw:177`, tests) tolerate the richer return (was `Promise<void>`).
- Tests (extend `project-registry.test.ts`): first insert → `created:true` + `registeredAt` set; re-register → `created:false`, `registeredAt` unchanged, `lastSeen` bumped; legacy entry without `registeredAt` re-registered → stays without? NO — decide: legacy entry re-registered keeps NO `registeredAt` (it was not created now; preserves "toast only for genuinely new projects", user 1b); concurrency: 5 parallel registerProject same root → exactly one `created:true`; readers (`listProjects`, `resolveTargetRepoRoot`) unaffected by the optional field.
- References: `project-registry.ts:110-224`; `registry/types.ts:1-17`; existing concurrency test `project-registry.test.ts:102-111`.
- Acceptance: registry suite green incl. new cases; `resolveOutboundBudget`/sidebar readers compile untouched.
- QA happy: test output → `T4-registry.txt`. QA failure: lock-contention case (`withRegistryLock` timeout path) returns without corrupting the file — assert file parses after simulated contention.
- Commit: `feat(mailbox): registeredAt + created-flag on project registry upsert`

### Wave 2 — wiring + live semantics (4 todos)

**T5. Auto self-registration on session start (1b, server side)** — ✅ DONE (commit `1cd182d40`; `registry/self-registration.ts` wired into `hooks/create-mailbox-hooks.ts`; verified via `bun test` in worktree)
- Do: new `registry/self-registration.ts` exporting `ensureSelfRegistered(args: { registry: ProjectRegistry; repoRoot: string }): Promise<{ created: boolean } | null>` — calls `registerProject`, catches EVERYTHING → `log()` + `null` (session start must never break). Wire in `hooks/create-mailbox-hooks.ts` (registry already at line 89): fire-and-forget `void ensureSelfRegistered(...)` at hook creation when `config.enabled`. NOT wired when mailbox disabled (`create-mailbox-session-hooks.ts:27-34` gate already handles: hooks aren't created).
- Tests: enabled → registry contains self with fresh `lastSeen` after hook creation (temp HOME); disabled → registry untouched; registry write failure (read-only dir) → hook creation still succeeds, error logged; second session same project → `created:false`, no duplicate entry.
- References: `hooks/create-mailbox-hooks.ts:80-160`; `plugin/hooks/create-mailbox-session-hooks.ts:13-40`; T4 return shape; envelope/project-id.ts (id derivation happens inside registerProject).
- Acceptance: tests green; no new raw fs writes outside ProjectRegistry.
- QA happy: fresh temp project session-start → registry gains entry → `T5-selfreg.txt`. QA failure: read-only `~/.omo` simulation shows logged error + intact session.
- Commit: `feat(mailbox): auto-register project on mailbox-enabled session start`

**T6. Live mailbox-config resolution for permission paths** — ✅ DONE (commits `472d9e982`, `b8f4f7b5f`, `3258479f5`; `config/live-config.ts` TTL+single-flight resolver wired into all consumers incl. production idle-drain hook deps; 440/440 tests green, 0 LSP errors)
- Do: new `packages/omo-opencode/src/features/cross-project-mailbox/config/live-config.ts` exporting `createLiveMailboxConfigResolver(repoRoot: string, fallback: CrossProjectMailboxConfig): { resolve: () => Promise<CrossProjectMailboxConfig>; invalidate: () => void }` — wraps `validatePluginConfig(repoRoot)` (`config/validate.ts:145`, full layered re-read) + `applyMailboxDefault` behind a **strict TTL cache (3_000 ms) + single-flight**: within the TTL window the resolver performs ZERO I/O (no reads, no stat — a per-call stat would itself be an amplification vector under message flood, and 1s mtime granularity makes stat-based invalidation unreliable anyway); concurrent callers share one in-flight read. **Coherence with the dialog write path is explicit, not inferred: `invalidate()` clears the cache, and T10 calls it immediately after every atomic config write**, so the next permission check re-reads fresh. Inbound/drain frequency is externally controlled, so worst case is bounded at ≤1 full config read per 3s per process regardless of flood, while dialog edits are effective IMMEDIATELY via invalidation (and ≤3s for edits made by other processes/hand-editing — still "no restart", satisfying 4a/6c). Returns fallback on any throw. Consume it at permission-decision time in: `send-tool/project-message-tool.ts` + `project-note-tool.ts` (preflight + budget table), `manual-drain` tools, and `hooks/idle-drain-hook.ts` (senders gate + validateInbound call), replacing the startup-captured `config` for THOSE reads only (bounds/enabled may stay snapshot). Rationale: `tool-registry-mailbox-tools.ts:41` and hook deps capture config at plugin init — verified — so `/project-mailbox` edits would otherwise need a restart, contradicting approved 4a/6c semantics.
- Tests: edit senders in a temp project config AFTER tool construction → next `runSendPreflight`/`validateInbound` sees the new grant within one TTL window (no restart); config read throwing → falls back to snapshot; **flood guard: 100 concurrent/sequential resolver calls inside one TTL window perform exactly 1 underlying `validatePluginConfig` read AND zero stat calls (injected spies)**; TTL expiry → exactly one fresh read; single-flight: N concurrent callers during a slow read share one promise; **write coherence: write → `invalidate()` → immediate `resolve()` returns the NEW config (no TTL wait)**.
- References: `tool-registry-mailbox-tools.ts:28-87`; `send-tool/send-preflight.ts:29-53`; `validation/validate-inbound.ts:34-41`; `hooks/idle-drain-hook.ts:33`; `config/validate.ts:145`; `config-defaults.ts`.
- Acceptance: the integration-style unit test proves live effect; all mailbox suites green.
- QA happy: `T6-live-config.txt` with before/after preflight decisions. QA failure: unreadable config mid-session → operations continue on snapshot (logged).
- Commit: `feat(mailbox): resolve sender permissions from live config at operation time`

**T7. Presence detail, cache, and last-seen formatting (C data layer)** — ✅ DONE (commit `1cd182d40`; `readPresenceDetail`, `createPresenceCache`, `lastSeenLabel` implemented and barrel-exported; 487/487 tests green, 0 LSP errors)
- Do: (1) `presence/presence-reader.ts`: add `readPresenceDetail(projectId, homeDir?, deps?): Promise<{ status: PresenceStatus | "missing"; heartbeatTs: number | null }>` reusing the existing private `readRecord` + probe logic (status semantics IDENTICAL to `readPresenceStatus`; `"missing"` when record absent/invalid). (2) New `presence/presence-cache.ts`: `createPresenceCache(ttlMs = 10_000)` with per-projectId single-flight + TTL (sidebar polls at `POLL_INTERVAL_MS = 1_000` — `tui-sidebar/constants.ts:5` — and probes cost up to 2s each; cache keeps ≤1 probe per project per 10s). (3) New `presence/last-seen-label.ts`: `lastSeenLabel(ageMs): string` per spec doc: `< 7_776_000_000 ms` → `Last seen <n> <unit> ago` with largest whole unit of seconds/minutes/hours/days (1500s → `25 minutes`, singular unit when n=1); `>= 7_776_000_000` OR unknown ts → `Last seen a long time ago`.
- Tests: detail returns heartbeatTs for live/stale/offline records and `missing` on absent/corrupt file; cache single-flights concurrent readers + expires after TTL (fake timers); label: 1500s→"25 minutes", 59s→"59 seconds", 1 day exactly, boundary 7_776_000_000-1 → days form, exactly 7_776_000_000 → long-time form, null → long-time form.
- References: `presence/presence-reader.ts:36-113`; `presence/presence-record.ts` (PRESENCE_TTL_MS); spec `docs/examples/cross-proejct mailbox - Presence TUI panel.md` rows 1-4.
- Acceptance: all new units green; `readPresenceStatus` behavior unchanged (existing tests untouched).
- QA happy: `T7-presence.txt`. QA failure: corrupt presence JSON → `missing` (not throw), verified by test.
- Commit: `feat(mailbox): presence detail reader, TTL cache, and last-seen labels`

**T8. `/project-mailbox` menu model (pure, D logic)** — ✅ DONE (commit `1cd182d40`; `buildTopMenu`/`buildSubmenu`/`applySelection` + `MalformedConfigError` implemented and barrel-exported; 487/487 tests green, 0 LSP errors; file had a duplicate-declaration corruption artifact from an interrupted write, verified fixed on resume)
- Do: new `packages/omo-opencode/src/features/cross-project-mailbox/dialog/menu-model.ts` (+ `index.ts` barrel):
  - `buildTopMenu(entries: ProjectEntry[], config: CrossProjectMailboxConfig, selfProjectId: string): TopMenuRow[]` — ALL registry projects EXCEPT self, alphabetical by displayName; row = `{ projectId, label, state }` where `label` strips the `-hash` suffix unless another DISPLAYED row shares the displayName (spec collision rule), and `state` = `senders[projectId].intent_budget` when `access === "allow"`, else literal `"Disabled"` (deny OR unlisted).
  - `buildSubmenu(row): SubmenuOption[]` — `Disabled`, `question`, `impl`, `plan`, current state marked (`✓`).
  - `applySelection(configText: string, projectId: string, choice: "Disabled"|"question"|"impl"|"plan"): string` — jsonc-parser `modify`+`applyEdits`: tier choice sets `["cross_project_mailbox","senders",projectId,"access"]="allow"` + `[...,"intent_budget"]=choice`; `Disabled` sets `access="deny"` and adds `intent_budget:"question"` ONLY when the entry did not exist (existing intent_budget preserved — user 6b). Comment-preserving by construction.
- Tests (TDD, exhaustive): state mapping (allow+plan→"plan"; deny→"Disabled"; unlisted→"Disabled"); self excluded; collision labels (two `cloudhome-*` entries → both full ids; singleton → bare name); applySelection all 8 transitions (unlisted→each tier, unlisted→Disabled, allow→Disabled keeps tier, deny→tier flips access) asserting OUTPUT TEXT preserves unrelated comments/keys; idempotent re-apply; config text MISSING the `cross_project_mailbox` key entirely (hand-edited file) → modify creates the nested path (jsonc-parser inserts missing parents) and the result validates.
- References: registry `types.ts`; `config.ts:10-13` (SenderConfigSchema); spec doc collision rule; `tui-preferences.ts:88-91` (modify options pattern); user answers 6a/6b/4a.
- Acceptance: 100% of menu-model branches covered; zero TUI imports (pure module).
- QA happy: `T8-menu-model.txt`. QA failure: malformed configText → applySelection throws typed error (caller toasts; test asserts message).
- Commit: `feat(mailbox): pure menu model for /project-mailbox dialog`

### Wave 3 — surfaces (3 todos)

**T9. Sidebar Projects section (C render)** — ✅ DONE (commit `1cd182d40`; fixed a dead-code duplicate `readProjectPresenceRows` bug found in manual review — `mailbox-sidebar.ts` had its own private buggy copy with `statusText="~"` for the online case instead of importing the correct `projects-presence.ts` copy; wired the import, file dropped from 255→198 LOC; 593/593 tests green, 0 LSP errors)
- Do: (1) extend `MailboxSidebarState` (`sidebar/mailbox-sidebar.ts:25-33`) with `projects: ProjectPresenceRow[]` where row = `{ projectId, label, presence: "online"|"pending"|"lastSeen", statusText, dotColor: "success"|"warning"|"muted" }` — computed in `readMailboxSidebarState` from STRICT connected set (`access === "allow"` entries only — reuse `allowedSenderIds` pattern `visibility/outbound-budget.ts:31-36`), presence via T7 cache+detail, labels via T7 + collision rule (within displayed set), mapping: live|internal→online/success; stale→`~`/warning; offline+known ts→`lastSeenLabel`/muted; missing/expired→`Last seen a long time ago`/muted. (2) `tui-sidebar/render-view.ts` `mailboxNodes` (285-342): ALWAYS render the three group headers `In`, `Out`, `Projects` (drop the hide-empty-group and bare "Mailbox idle" behavior; zero counts render muted). Reviewer advisory acknowledged: this costs vertical space when idle — accepted deliberately because the user's feature 3 specifies the three headings as the Mailbox's structure, and the existing collapse toggle (persisted via tui-preferences) remains the space-saving mechanism; Projects rows = `• name` left + statusText right (reuse `outboundBudgetRow` space-between layout :95-100; dot = `•` colored via theme success/warning/textMuted). (3) collapsed summary (`mailboxCollapsedSummary` :355-358) gains `Projects (a/t active)` where `t` = connected count, `a` = rows with presence online. (4) `compute-view.ts` `viewKey` must include the projects rows so poll repaints. (5) `describeView`/`mailboxLines` text forms updated in kind.
- Tests: update `render-view.test.ts` (existing In/Out cases now expect always-rendered headers) + new cases: 0/0 counter renders; a/t math; dot color mapping per state; collision label; describeView text stability. `mailbox-sidebar.test.ts`: strict-set filtering (deny + unlisted excluded even under allow-all default), registry-missing project (in senders but not registry) → shown by projectId with `Last seen a long time ago`.
- References: files/lines above; `tui.ts:144-158` (loadMailboxSection wiring — pass registry port + presence deps); spec doc table; user answers Q3=3a, feature 3/4/5.
- Acceptance: full tui-sidebar + sidebar suites green; no probe executed during render (only via cache — assert via injected fake).
- QA happy: `T9-sidebar.txt` + rendered describeView snapshot. QA failure: presence reader throwing → row falls back to `Last seen a long time ago` (test).
- Commit: `feat(tui): Mailbox sidebar Projects presence section with active counter`

**T10. `/project-mailbox` TUI command + dialog wiring (D surface)** — ✅ DONE (commit `1cd182d40`; `registerProjectMailboxCommand` wired into `tui.ts`, write-chain serialization, resolver invalidate-after-write, error toasts on write failure and malformed config; verified alongside T9)
- Do: new `features/cross-project-mailbox/dialog/tui-command.ts` exporting `registerProjectMailboxCommand(api, deps)`: feature-detect `api.keymap?.registerLayer && api.ui?.DialogSelect && api.ui?.dialog` (absent → `log()` + return). Register `{ name: "omo.mailbox.projects", title: "Project Mailbox", slashName: "project-mailbox", description: "manage connected projects" }`. `run()`: read registry + LIVE config (T6 resolver), `buildTopMenu` (T8), `api.ui.dialog.replace(() => api.ui.DialogSelect({ title: "Project Mailbox", options, onSelect }))` — options carry state text right-aligned via the same option field `/mcps` uses (mirror `packages/tui/src/component/dialog-mcp.tsx` in the opencode fork: options {title, description/footer}, non-closing onSelect). Selecting a project → `dialog.replace` submenu (T8 buildSubmenu); selecting a submenu option → resolve project config file via `detectPluginConfigFile` (create stub first via `autoProvisionMailboxConfig` when none), `applySelection` on file text, atomic temp+rename write, then `dialog.replace` back to a REBUILT top menu (fresh read). Serialize all dialog writes through an in-process promise write-chain (pattern: `tui-preferences.ts:98-112`) so rapid selections never interleave read-modify-write; the cross-PROCESS race (two TUI sessions editing the same project config) is accepted last-writer-wins — name the test accordingly. **After every successful atomic write, call the T6 resolver's `invalidate()`** (the resolver instance is shared via the mailbox feature wiring) so permission checks and the rebuilt top menu see the new state immediately — the menu rebuild itself reads the file fresh, and the invalidation closes the resolver-side staleness window. Esc → host default close (writes already persisted; nothing else). Write failure → `api.ui.toast` error + stay on submenu. Wire the call from `tui.ts` module `tui(api)` after slot registration.
- Tests: wiring smoke with a fake `api` object (registerLayer captured; run() builds options from fixtures; selection pipeline calls applySelection with expected args; feature-detect path: absent APIs → no throw + no registration). File-write path unit: temp dir with legacy-basename config → edits THAT file (never creates a parallel canonical file); no config → stub created THEN edited.
- References: T8 model; explorer receipts: opencode fork `packages/plugin/src/tui.ts:161,171,512-517,600-609` (TuiDialogSelectProps/TuiToast/slots/ui), `packages/tui/src/component/dialog-mcp.tsx` (behavioral template), `packages/tui/src/app.tsx:686-694` (/mcps registration shape), `specs/tui-plugins.md:76-115`; `auto-provision.ts` (stub creation); `shared/jsonc-parser` detect + cache-clear after write; user answers 6a-6d, Q4=4a.
- Acceptance: smoke tests green; command absent on feature-detect failure; JSONC comments in a fixture config survive a toggle byte-for-byte outside the edited span.
- QA happy: wiring-smoke + write-path unit test outputs captured → `.omo/evidence/<date>-mailbox-ux/T10-dialog.txt`, including a fixture JSONC before/after diff proving comment preservation (live tmux confirmation additionally lands in T14). QA failure: write to read-only config → toast path exercised via injected fs error → same T10-dialog.txt.
- Commit: `feat(tui): /project-mailbox interactive connection manager dialog`

**T11. First-registration toast (A TUI side)** — ✅ DONE (commit `d68e78f2c`; `decideRegistrationToast` + legacy-senders flag-consume orchestration in `dialog/registration-notice.ts`, wired into `tui.ts`'s existing poll tick via `runRegistrationToastCheck`/`runLegacySendersNoticeCheck`; 16/16 new unit tests + 518/518 full mailbox suite + 5/5 tui.test.ts green, 0 LSP errors, clean workspace typecheck)
- Do: new `features/cross-project-mailbox/dialog/registration-notice.ts` (or `tui-sidebar/`): pure `decideRegistrationToast(selfEntry: ProjectEntry | undefined, prefs: Record<string, unknown>): { show: boolean; markerPath: string[] }` — show when `selfEntry?.registeredAt` exists AND prefs marker `["mailbox","registrationNoticeShown", selfEntry.projectId]` !== true (projectId comes from the entry itself). Wire into `tui.ts` poll tick: on show → `api.ui.toast({ ...one-line: `Mailbox: registered <displayName> in the cross-project registry` })` (exact TuiToast fields read from opencode fork `packages/plugin/src/tui.ts:226` at implementation time) + `queueTuiPreferenceUpdate(marker, true)`. Feature-detect `api.ui?.toast`. Multi-TUI race (two sessions toast once each) is ACCEPTED as benign — document in code comment-free test name instead.
- **Second notice source — legacy-senders activation (from T3):** same poll pass also checks T3's pending-notice flag file; when present → one-time toast `Mailbox: user-level sender grants now apply to all projects: <names>` → delete the flag file (single consumer; deletion is the dedup). Pure decision function + flag-consume path unit-tested (flag present → show+delete; absent → nothing; delete failure → logged AND an in-memory `hasToastedLegacy` guard prevents re-toasting on retries within the session — the file delete is retried next poll silently; corrupted/unparseable flag JSON → caught, logged, file deleted, never crashes the tick).
- Tests: decision function matrix (no entry / no registeredAt / marker set / fresh) — pure; marker write path via existing `queueTuiPreferenceUpdate` test seam.
- References: T4 `registeredAt` semantics (legacy projects never toast); `tui.ts:212-241` (signal/poll wiring), `tui-preferences.ts:105-112`; user answer Q1=1b.
- Acceptance: decision tests green; toast fires at most once per project per prefs file.
- QA happy: decision-matrix + marker-write unit test outputs → `.omo/evidence/<date>-mailbox-ux/T11-toast.txt` (live toast additionally confirmed in T14). QA failure: prefs file malformed → decide returns show (tolerant read yields {}) and marker write no-ops safely → asserted in the same run, same evidence file.
- Commit: `feat(tui): one-time toast on first project mailbox registration`

### Wave 4 — integration, schema, evidence (3 todos)

**T12. Schema description + regeneration**
- Do: update `config.ts` `default_sender_access` `.describe()` to note the machine-global convention (user-level config seeds `allow-all`; unlisted-sender ceiling is `question`). Run `bun run build:schema`; commit regenerated `assets/oh-my-opencode.schema.json`. Re-run T2 stub-compliance test.
- References: `config.ts:48-51`; AGENTS.md COMMANDS (build:schema); assets schema :6704-6711.
- Acceptance: schema JSON contains the new description; git diff shows ONLY description-level changes; stub test green.
- QA happy: `T12-schema.diff`. QA failure: any structural (non-description) schema diff → investigate before commit.
- Commit: `chore(schema): document machine-global default_sender_access convention`

**T13. Two-repo end-to-end integration test**
- Do: extend `features/cross-project-mailbox/__tests__/two-repo-integration.test.ts` (pattern at :76-77) with a full new-world flow: temp HOME + two temp repos → (1) simulate session start on both → both auto-registered (T5), `created:true` once each; (2) receiver has NO senders entry + user-level seeded `allow-all` (T3 output as fixture) + deep-merge (T1) → sender's `question`-tier note passes `validateInbound`, `impl`-tier rejected over-budget; (3) apply `applySelection(receiverConfig, sender, "plan")` (T8) → LIVE resolver (T6) → `impl` now passes without any restart/rebuild of tools; (4) `readMailboxSidebarState` (T9) reports the sender as connected with presence from a written presence record.
- References: files per todo above; `two-repo-integration.test.ts` harness.
- Acceptance: single test file proves A+B+D+C interlock; runs in `bun test` under 30s.
- QA happy: `T13-integration.txt`. QA failure: each numbered stage asserts independently so a break localizes.
- Commit: `test(mailbox): end-to-end auto-registration + live grant integration`

**T14. opencode-qa manual evidence (MANDATORY)**
- Do: run the `opencode-qa` skill in an isolated XDG sandbox (`source script/agent/qa-sandbox.sh` conventions): fresh temp project + built plugin. Capture: (1) tmux TUI smoke — Mailbox sidebar shows `In / Out / Projects` and `Projects (a/t active)` collapsed line; (2) `/project-mailbox` — open, select a project, set `plan`, submenu returns to top with state reflected; capture the project JSONC before/after showing comment preservation; (3) esc closes with state persisted; (4) fresh-project first session → registration toast observed + `~/.omo/project-registry.json` (sandboxed HOME) gains the entry; (5) isolation proof (session-count comparison per skill). Write `.omo/evidence/<YYYYMMDD>-mailbox-ux/{what-tested,observed,why-enough,omitted}.md` + raw captures.
- References: AGENTS.md QA section; `.agents/skills/opencode-qa/`; `script/agent/qa-sandbox.sh`.
- Acceptance: evidence dir exists with all four AGENTS.md-required sections; every feature 1-6 claim maps to a captured artifact.
- QA happy: the evidence IS the artifact. QA failure: any observed deviation from spec → fix todo loops back before final wave.
- Commit: `docs(evidence): opencode-qa evidence for mailbox-ux` (evidence is tracked per fork policy).

## Final verification wave

Run in parallel after ALL todos; ALL must APPROVE; surface results and wait for the user's explicit okay before declaring complete:
- **F1 plan compliance audit:** every todo's acceptance criteria re-checked against the diff; Must-NOT-Have list verified (no web, no new tools/CLI, no existing-project-config edits, no schema-default flip, no opencode-fork changes).
- **F2 code quality review:** conventions (kebab-case, barrels, no catch-all files, 200-LOC ceiling, no `as any`/`@ts-ignore`, given/when/then tests, comment-checker clean), `bun run typecheck` + full `bun test` green.
- **F3 real manual QA:** T14 evidence reviewed for authenticity (isolation proof present, artifacts match claims); spot re-run of the tmux dialog flow.
- **F4 scope fidelity:** user's six answers (1b / 2c / 3a / 4a / TUI-only / TDD) each traced to shipped behavior; deviations enumerated or "none".

## Commit strategy

- One atomic commit per todo (messages given above), on `feat/project-mailbox-ux` in `.local-ignore/worktrees/mailbox-ux`.
- No commits to `fork/local` until the final verification wave passes AND the user approves; then `git merge --no-ff feat/project-mailbox-ux` into `fork/local` + push origin (fork policy: direct to fork/local, no PR).
- Schema regen (T12) and evidence (T14) are separate commits so behavior commits stay reviewable.

## Success criteria

1. A brand-new project's first mailbox-enabled session appears in `~/.omo/project-registry.json` with `registeredAt`, and the TUI shows the one-line toast exactly once (evidence T14-4).
2. With the user-level seed present and NO project senders entry, a foreign `question`-tier note is accepted and an `impl`-tier note is rejected over-budget (T13-2).
3. Granting `plan` via `/project-mailbox` takes effect for the very next send/drain with NO restart (T13-3, T14-2).
4. New projects receive the minimal commented stub; `OhMyOpenCodeConfigSchema.safeParse` accepts it; no `default_sender_access`/`enabled` keys written (T2).
5. Existing project configs and any user config that already sets the key are byte-untouched by the seed (T3 tests).
6. Sidebar shows `In / Out / Projects` always; collapsed `Projects (a/t active)` counts ONLY explicit `access:"allow"` senders; expanded rows match the spec table incl. the 90-day boundary and collision-suffix rule (T7/T9 tests + T14-1).
7. All dialog writes are comment-preserving and atomic; esc never discards a made selection (T8/T10 tests + T14-2/3 diff).
8. `bun test`, `bun run typecheck`, `bun run build:schema` all clean; no regression in existing mailbox/config/sidebar suites.
