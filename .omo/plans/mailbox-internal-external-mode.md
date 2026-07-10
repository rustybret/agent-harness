# mailbox-internal-external-mode - Work Plan

## AMENDMENT (2026-07-04, user-approved pivot): registry-based mode detection

The original design (self-probe against `GET /session/status`) shipped through T1-T10 and then failed T11 live e2e for a structural reason: opencode's `SessionStatus.set` DELETES a session from the status map the moment it goes idle, so `/session/status` only lists sessions actively processing a prompt. Idle is the normal resting state of an attended session, so a real external (port-bound) session self-classified as internal whenever the probe caught it idle - which is most of the time. Oracle-confirmed as a category error: activity is not presence. Two locked constraints below ("No opencode-fork edits", "mode MUST be confirmed by a live self-probe") are therefore amended by user direction ("root problems in presence makes sense... dig deep and think of a proper solution"):

- **Fork side (opencode)**: `Server.listen` now writes an on-disk listener registry record `<xdg-state>/opencode/instances/<pid>.json` `{pid,url,hostname,port,startedAt}` on bind and removes it on stop (`packages/opencode/src/server/listener-registry.ts`), with a stale-pid sweep. This was already the agreed durable design with the opencode fork session (option a+c).
- **Mode detection (omo)**: the detector reads the registry record for its OWN pid - activity-independent, identity-exact, carries the REAL bound URL (also fixing the `localhost:4096` placeholder presence bug). Legacy fallback for older hosts: non-placeholder `ctx.serverUrl` = external.
- **Remote liveness probe**: `defaultProbeSession` now checks reachability via `GET /global/health` where ANY HTTP response = alive; attendance is carried by heartbeat freshness (10s beat / 30s TTL), which beats while idle.
- T2's directory-scoped `/session/status` probe is superseded; its directory-context learning is retained in the health-probe headers.

## TL;DR (For humans)

**What you'll get.** The cross-project mailbox becomes session-mode aware, matching opencode conventions:
- A plain `opencode` / `opencode --continue` session = **internal**: presence-aware `project_message` send is turned off, and a new `project_note` tool drops a doc into the target's `coordination_notes/` for its filewatcher/idle-drain to pick up (the old-school model). It still receives (idle-drains its own inbox) and publishes an `internal`-marked presence record so peers see "internal (doc-drop)".
- An `opencode serve` / `opencode web` / `--port N` session = **external**: full presence-aware `project_message`, with a **fixed probe** that (1) passes directory context (both `?directory=` and `x-opencode-directory`) and (2) confirms the target SESSION is actually tracked live in `/session/status`, not just that the server answered.
- Detection is logged on start / resume / transition so you can validate it.

**Why this approach.** The probe was lying twice — no directory scope (wrong project under a shared serve) and treating "server up" as "session alive". Both are fixable through real opencode APIs (confirmed present). Mode can't be read from the URL (the `localhost:4096` placeholder collides with a real serve on 4096), so mode is confirmed by a live self-probe, memoized per session. Internal sessions keep working via the file-drop path you already relied on, so no session is ever mute.

**What it will NOT do.** No opencode-fork edits (its config-port + instance-registry work is separate). No pid-only local liveness (you rejected that). No cross-machine/hosted-ingress presence. No change to the envelope, permission tiers, or file-drop format.

**Effort.** 11 todos across 5 waves. ~6-8 focused implementation commits + docs + one live-e2e evidence run.

**Risk.** Medium. Main risks: a freshly-created external session not yet in `/session/status` at t0 (handled with a bounded retry before concluding internal); the async-detect vs sync-tool-registration split (resolved by gating at execution, not registration); and test isolation leaking into real `~/.omo` presence/registry (handled by HOME-redirecting the sandbox).

**Decisions (yours, locked).** 1A separate `project_note` tool; 2A internal presence record marked `mode:"internal"`; 3A internal sessions still idle-drain. Test: OpenRouter free models only, isolated `OPENCODE_DB` + throwaway project dirs, evidence under `.omo/evidence/`.

## Scope

### Objective
Make the cross-project mailbox aware of whether the current opencode session is **internal** (plain `opencode` / `opencode --continue` with no bound HTTP server) or **external** (`opencode serve` / `opencode web` / `opencode --continue --port N`, a real bound server), and adapt behavior accordingly:
- **External**: publish a real presence heartbeat and expose the presence-aware `project_message` tool. Fix the presence probe so it (a) passes directory context and (b) verifies the target SESSION is live in the server's tracked set, not merely that the server answered.
- **Internal**: gate off presence-aware send; expose a separate fire-and-forget `project_note` doc-drop tool that writes into the target's `coordination_notes/` and relies on the receiver's idle-drain filewatcher. Still publish an `internal`-marked presence record and still idle-drain its own inbox.
- Log internal/external detection on session start, resume, and any transition, to support testing/validation.

### IN scope (agent-harness / this fork only)
- `packages/omo-opencode/src/features/cross-project-mailbox/presence/*` — probe rewrite, PresenceRecord schema (`mode` + nullable serverUrl), reader status extension.
- `packages/omo-opencode/src/features/cross-project-mailbox/` — new mode-detector module; new `project_note` tool; execution-time mode gating of `project_message`.
- `packages/omo-opencode/src/plugin/tool-registry-mailbox-tools.ts` — register `project_note`.
- `packages/omo-opencode/src/plugin/event.ts` + heartbeat wiring — run detection, emit transition logs.
- `packages/omo-opencode/src/features/cross-project-mailbox/visibility/*` + TUI sidebar — render the `internal / doc-drop only` presence state.
- Unit tests (TDD) co-located; live e2e evidence under `.omo/evidence/`.

### OUT of scope
- opencode fork changes (config-port threading, instance registry). Tracked separately via mailbox; this plan consumes whatever `serverUrl` opencode provides but does not depend on the registry landing.
- Cross-machine / hosted-ingress presence (public URL discovery). Same-host only.
- Changing the file-drop wire format, envelope schema fields, or the 3-tier permission model.
- Local-only (pid-only) presence liveness — explicitly rejected by the user; probe-based liveness is retained and fixed.

### Must-NOT-Have
- No removal of the HTTP probe in favor of pid-only liveness.
- No inference of mode from the `serverUrl` string alone (4096 is ambiguous) — mode MUST be confirmed by a live self-probe.
- No `as any` / `@ts-ignore` / `@ts-expect-error`; no empty catch blocks; no em/en dashes or AI-filler in code or docs.
- No test run that writes to agent-harness's real `~/.local/share/opencode/opencode.db` or adds sessions to agent-harness's own session list.
- No non-free model used in any live test session.

## Verification strategy
- **TDD**: each implementation todo ships with co-located `*.test.ts` (given/when/then) written first where practical, covering the happy path and at least one failure/edge path.
- **Diagnostics gate**: `bun run typecheck` and `bun test` green (excepting known pre-existing model-snapshot drift) before any commit.
- **Live e2e (the completion bar)**: a real two-session round-trip proving internal vs external behavior, driven with the `opencode-qa` skill, using **OpenRouter free models only**, against an **isolated `OPENCODE_DB` + isolated XDG dirs** in a **throwaway project dir** (never agent-harness). Evidence written under `.omo/evidence/<YYYYMMDD>-mailbox-internal-external/`.

## Execution strategy
Task-owned git worktree off `dev` (per repo `work-with-pr` discipline). Waves run in dependency order; independent todos within a wave run in parallel. Every implementation todo = implementation + tests in ONE commit. QA evidence per repo AGENTS.md rules.

Dependency matrix:
- T1 (probe) depends on T2 (record carries directory/mode) for the fields it reads -> T2 first or same wave.
- T3 (detector) depends on T1 (self-probe reuses the fixed probe).
- T4 (heartbeat wiring) depends on T2 + T3.
- T5 (reader status) depends on T2.
- T6 (visibility/TUI) depends on T5.
- T7 (project_note) depends on T2 (mode) + reuses existing MailboxStore/envelope.
- T8 (project_message gate) depends on T3 (detector) + T7 (guidance target).
- T9 (detection logging) folded into T3/T4 but verified independently.
- T10 (schema/docs) depends on all.
- T11 (live e2e) depends on all.

## Todos

### Wave 1 - Presence record schema + directory-scoped session-live probe

#### T1: PresenceRecord schema - add `mode` + nullable `serverUrl` [x]
- WHERE: `packages/omo-opencode/src/features/cross-project-mailbox/presence/presence-record.ts`
- HOW: Add `mode: "internal" | "external"` to `PresenceRecord`; change `serverUrl: string` to `serverUrl: string | null`. Update `writePresenceRecord` (no logic change beyond serialization). Update any inline record builders.
- References: presence-record.ts:11-18 (interface), presence-heartbeat-hook.ts:33-40 (buildRecord), presence-reader.ts:21-30 (isPresenceRecord guard).
- Acceptance: type compiles; `isPresenceRecord` accepts a record with `mode:"internal"` + `serverUrl:null` and one with `mode:"external"` + string url; rejects a record missing `mode`.
- QA happy: unit test writes+reads both record shapes round-trip. QA failure: a record with `serverUrl:123` (number) is rejected by the guard. Evidence: test output captured.
- Commit: `feat(mailbox): add mode + nullable serverUrl to presence record`

#### T2: Directory-scoped, session-live probe (concerns #2 + #3) [x]
- WHERE: `packages/omo-opencode/src/features/cross-project-mailbox/presence/presence-reader.ts`
- HOW: Replace `defaultProbeSession` so it GETs `${serverUrl}/session/status` with `?directory=<record.repoRoot>` query AND `x-opencode-directory: <record.repoRoot>` header AND `Authorization` (existing auth helper). Parse the returned map; return live IFF `record.sessionId` is a key in the map (server actively tracks it as a live session, not a mere stored record). Optionally capture the session `type` for richer status but gate liveness on membership. A `mode:"internal"` record (serverUrl null) short-circuits: never HTTP-probe it (handled in T5).
- References: presence-reader.ts:46-63 (current probe), opencode workspace-routing.ts:87 (directory resolution), opencode groups/session.ts:80 + handlers/session.ts:77 (/session/status), packages/utils/src/session-idle-settle.ts:29-47 (active-status set, reuse the membership-parsing shape).
- Acceptance: probe sends both `?directory=` and `x-opencode-directory`; returns true only when sessionId present in status map; false when server 200s but sessionId absent (abandoned/wrong-project); false on connect error/timeout.
- QA happy: mocked fetch returns `{ "<sid>": {type:"idle"} }` -> live. QA failure: mocked fetch returns `{}` (session not tracked) -> stale; mocked fetch for wrong directory returns 200 without sid -> stale. Evidence: test output.
- Commit: `fix(mailbox): directory-scoped session-live presence probe`

### Wave 2 - Mode detection + heartbeat integration

#### T3: Mode-detector module (self-probe, memoize-per-active, transition log) [x]
- WHERE: new `packages/omo-opencode/src/features/cross-project-mailbox/presence/mode-detector.ts` (+ index export)
- HOW: `createModeDetector({ resolveServerUrl, repoRoot, client, probe, now })`. Expose `detect(sessionId, trigger): Promise<"internal"|"external">` and a synchronous `currentMode(): "internal"|"external"|"unknown"` for tool-execution reads. On `detect`: if no resolvable serverUrl -> `internal`. Else self-probe OUR OWN serverUrl WITH directory (reuse T2 probe against our own {serverUrl, repoRoot, sessionId}); reachable + our sessionId present in `/session/status` -> `external`, else `internal`.
  - **Detect ONCE per session-active transition, not per heartbeat beat.** The heartbeat beats every 10s (presence-record.ts:7) and idle events fire often; the detector MUST memoize the result for a session and only re-run `detect` on a NEW sessionId or an explicit resume trigger — never on every beat. `currentMode()` returns the memoized value for tool reads with zero I/O.
  - **Freshly-created-session race:** a just-created session may not yet appear in `/session/status`. On the FIRST detect for a session, if serverUrl is reachable but our sessionId is absent, retry the status probe up to 2 times with a short settle (reuse `settleAfterSessionIdle` ~150ms) before concluding `internal`. This avoids a real external session being misclassified internal at t0.
  - **Timeout/first-probe:** self-probe timeout <=2s; on timeout/connect-error default to `internal` (safe: doc-drop still delivers). Record that this was a timeout-default (distinct log detail) so a slow server on startup is diagnosable.
  - **Logging:** emit `log("[mailbox-mode] detected", {mode, sessionId, trigger, reason})` on every first-detect and resume; emit `log("[mailbox-mode] transition", {from, to, sessionId})` ONLY when the memoized mode actually changes.
- References: create-mailbox-hooks.ts:126-141 (serverUrl resolution + getServerBaseUrl), opencode-http-api.ts:49-86 (getServerBaseUrl), presence-reader.ts probe (T2), packages/utils/src/session-idle-settle.ts:5-7 (settleAfterSessionIdle), shared/logger.
- Acceptance: internal when serverUrl null/placeholder-unreachable; external when self-probe finds our session; detect runs once per session and is memoized (a second detect with the same sessionId and no resume does NOT re-probe); transition log only on change; detected log on every start/resume; first-detect retries before concluding internal.
- QA happy: injected probe -> true => external, log "detected external"; second detect same session => no new probe call (spy asserts probe called once). QA failure: injected probe throws/times out => internal with reason "timeout"; probe returns reachable-but-absent then present on retry => external (retry path); memoized external then resume flips to internal => one transition log. Evidence: test output.
- Commit: `feat(mailbox): session internal/external mode detector`

#### T4: Wire detection into heartbeat + write mode-tagged record [x]
- WHERE: `packages/omo-opencode/src/features/cross-project-mailbox/presence/presence-heartbeat-hook.ts`, `hooks/create-mailbox-hooks.ts`, `packages/omo-opencode/src/plugin/event.ts`
- HOW: On session-active (session.created + idle events at event.ts:83,155), run `modeDetector.detect(sessionId)`; build the presence record with `mode` and `serverUrl` = real url when external, `null` when internal. Heartbeat keeps beating in both modes (so peers see freshness), but internal records carry `mode:"internal"`/null url. Emit the start/resume detection log here.
- References: event.ts:78-93,153-157, presence-heartbeat-hook.ts:24-69, create-mailbox-hooks.ts:126-152.
- Acceptance: external session writes record with real serverUrl + mode:external; internal session writes record with null serverUrl + mode:internal; both refresh heartbeatTs on interval.
- QA happy: simulate external detect -> record.mode==="external" && serverUrl truthy. QA failure: simulate internal detect -> record.mode==="internal" && serverUrl===null. Evidence: test output + (live) inspect `~/.omo/presence/<sandbox-project>.json`.
- Commit: `feat(mailbox): heartbeat writes mode-tagged presence record`

### Wave 3 - Reader + visibility for the internal state

#### T5: presence-reader returns a distinct `internal` status [x]
- WHERE: `presence/presence-reader.ts`
- HOW: Extend `PresenceStatus` to `"live" | "stale" | "offline" | "internal"`. In `readPresenceStatus`: record null -> offline; heartbeat age > TTL -> offline; `mode:"internal"` (fresh) -> `internal` (no HTTP probe); else run the T2 probe -> live/stale.
- References: presence-reader.ts:12,81-95, presence-record.ts PRESENCE_TTL_MS.
- Acceptance: fresh internal record -> "internal" without any fetch call; fresh external record present-in-status -> "live"; external not-in-status -> "stale"; stale heartbeat -> "offline".
- QA happy: internal record + spy on fetch asserts fetch NOT called -> "internal". QA failure: external record with empty status map -> "stale". Evidence: test output.
- Commit: `feat(mailbox): presence reader reports internal doc-drop state`

#### T6: outbound-budget + TUI sidebar render `internal / doc-drop` [x]
- WHERE: `visibility/outbound-budget.ts`, `visibility/outbound-budget-injector.ts`, `features/tui-sidebar/render-view.ts` (+ tests)
- HOW: Add the `internal` presence value to `OutboundBudgetPresence`; render label (e.g. `internal (doc-drop)`) in the advisory table and the TUI outbound rows. Keep two-column sidebar layout.
- References: outbound-budget.ts:7 (OutboundBudgetPresence), :34-70 (resolvePresence/readOutboundBudget), :72-85 (renderOutboundBudgetTable), tui-sidebar/render-view.ts.
- Acceptance: a target whose presence reads "internal" renders the doc-drop label in both the injected budget table and the TUI sidebar.
- QA happy: readOutboundBudget with a mocked internal presence -> row.presence==="internal" and table text contains the label. QA failure: unknown/offline still renders offline (no regression). Evidence: test output + live TUI screenshot under evidence dir.
- Commit: `feat(mailbox): surface internal doc-drop presence in budget + sidebar`

### Wave 4 - project_note tool + project_message gating

#### T7: `project_note` fire-and-forget doc-drop tool [x]
- WHERE: new `packages/omo-opencode/src/features/cross-project-mailbox/send-tool/project-note-tool.ts` (+ tools index + registry)
- HOW: A tool that builds the same envelope (`buildSendEnvelope`) and writes the note via `MailboxStore.writeNote` into the target's `coordination_notes/`, but with NO presence probe and NO launch — pure file drop. Register alongside project_message in `tool-registry-mailbox-tools.ts` (both registered whenever `config.enabled`; the internal/external split is enforced at execution, not registration — resolves the async-detect vs sync-registration contradiction).
  - **Guard parity (decision: same receiver-protecting guards as project_message, minus presence/launch):** retain sender preflight allowlist + intent-budget + hop check + outbox-log append. Rationale: these guards protect the RECEIVER and keep the receiver-side `validateInbound` + TUI outbound counters correct; dropping them would let an internal session bypass the allowlist/budget that an external session must honor. Only the presence probe and `maybeLaunchOfflineTarget` are removed (they are sender-side liveness concerns irrelevant to a fire-and-forget drop). Body-cap (`min(config.bounds.max_body_bytes, MAX_BODY_BYTES)`) also retained.
  - **Mode gate with lazy fallback:** consult `modeDetector.currentMode()`. If `external` -> return guidance "external session; use project_message". If `internal` -> proceed. If `unknown` (no detect has run yet for this session) -> `await modeDetector.detect(sessionId, "tool-exec")` first, then branch. This closes the tool-executes-before-first-idle race.
- References: send-tool/project-message-tool.ts:91-153 (send flow to mirror, minus maybeLaunchOfflineTarget), send-tool/envelope-builder.ts, mailbox/mailbox-store.ts writeNote, send-tool/send-preflight.ts (runSendPreflight), send-tool/outbox-log.ts, tool-registry-mailbox-tools.ts, mode-detector.ts (T3).
- Acceptance: project_note writes a valid enveloped note into target coordination_notes/, appends outbox, runs preflight allowlist+budget+hop, never calls presence/launch; blocked with guidance when detector says external; unknown mode triggers a lazy detect before branching.
- QA happy: internal-mode exec -> note file exists with frontmatter, outbox appended, preflight ran (spy), no presence/launch calls (spies). QA failure: external-mode exec -> returns guidance, writes nothing; preflight-blocked (not-allowlisted target) -> blocked reason, no note written. Evidence: test output.
- Commit: `feat(mailbox): project_note doc-drop tool for internal sessions`

#### T8: gate `project_message` send to external mode [x]
- WHERE: `send-tool/project-message-tool.ts`
- HOW: In `execute`, after resolving fresh config, consult `modeDetector.currentMode()` (lazy-detect on `unknown`, same pattern as T7). If internal, return `{ blocked:true, reason:"internal session - use project_note" }` without probing/sending/launching. External path unchanged. `mode:"list"` (advisory outbound-budget read) remains allowed in BOTH modes — an internal session must still be able to see its budget table.
  - **Backward-compat guard:** existing `project-message-tool.test.ts` fixtures do not inject a mode detector. Provide a detector default that resolves `external` when a real serverUrl is present (preserving current behavior) so pre-existing send tests stay green; only an explicitly-internal detector blocks. Document this default in the tool deps.
- References: project-message-tool.ts:196-216 (execute), project-message-tool.ts deps type, mode-detector.ts (T3).
- Acceptance: internal-mode send blocked with the guidance reason (no note/presence/launch); external-mode send unchanged; list mode works in both modes; existing send tests pass unmodified via the external-default detector.
- QA happy: external send still delivers (existing tests green); list mode returns budget in internal mode. QA failure: internal send returns blocked reason, no note written, no presence probe called (spy). Evidence: test output.
- Commit: `feat(mailbox): gate project_message send to external sessions`

### Wave 5 - Schema/docs + live end-to-end

#### T9: detection-logging assertions (validation aid) [x]
- WHERE: covered by T3/T4; add a focused test file `presence/mode-detector-logging.test.ts`
- HOW: Assert the exact log lines fire on start, resume (no change -> detected only), and transition (-> transition + detected). This is the user-requested testability hook.
- Acceptance: start emits detected; resume-same emits detected (no transition); resume-changed emits transition+detected.
- QA: spy on logger; assert call args. Evidence: test output.
- Commit: `test(mailbox): assert mode detection/transition logging`

#### T10: docs + reference update [x]
- WHERE: `docs/reference/cross-project-mailbox.md`, `docs/reference/hooks-and-tools.md`
- HOW: Document internal vs external modes, the `project_note` tool, the `internal` presence state, and the directory-scoped probe. Generic/reusable phrasing.
- Acceptance: both docs describe the new behavior; `project_note` listed in the tools catalog.
- QA: markdown link/section audit. Evidence: rendered section diff.
- Commit: `docs(mailbox): document internal/external modes + project_note`

#### T11: live end-to-end proof (the completion bar) [~] — BLOCKED 2026-07-05: v11 e2e (fresh isolated sandbox, corrected unambiguous prompt, functional fork-binary check, dist rebuilt after dual-detector fix) proves the internal-mode gate does NOT block `project_message`. `mailbox_mode_logs.txt` shows `mode:"internal"` detected correctly at session start, yet the same session's `project_message` call delivered `hello-internal-blocked-v7` into `receiver-repo/coordination_notes/`. Reproduced 3x (v8, v10-debug, v11) across two attempted fixes (placeholder-URL exclusion, dual-ModeDetector-instance threading). See notepad issues.md for full diagnostic history and next steps.
- WHERE: `.omo/evidence/<YYYYMMDD>-mailbox-internal-external/`
- HOW: Using the `opencode-qa` skill with a FULLY isolated sandbox (source `script/agent/qa-sandbox.sh` conventions), OpenRouter FREE models only, TWO throwaway project dirs under `mktemp` (a sender repo + a receiver repo — NEVER agent-harness or any registered project):
  - **Isolation surfaces (all must be redirected so no real cross-project state is touched):**
    - `OPENCODE_DB` -> temp path; isolated `XDG_DATA_HOME`/`XDG_CONFIG_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME` under the mktemp root.
    - **`~/.omo` shared state**: presence records (`~/.omo/presence/`) and the project registry (`~/.omo/project-registry.json`) are HOME-anchored, not XDG. Point them at the sandbox by overriding `HOME` for the spawned sessions (or the mailbox base-dir override if one exists) so presence + registry write under the temp root, not the real `~/.omo`. Verify the two temp projects are registered ONLY in the sandbox registry.
    - **`coordination_notes/`**: lives inside each target repo; the two temp repos contain their own, so drops land in temp, not in any real project. Confirm no write occurs under any `/Volumes/Topper2TB/Git/*/coordination_notes/`.
  - **Scenario 1 (external):** launch the sender as an EXTERNAL session (`opencode --continue --port <N>`); assert its presence record `mode:external` + real serverUrl under the sandbox presence dir; from the receiver, assert `project_message` delivers and the probe reads "live" only when the session is in `/session/status` with the correct directory (also assert a wrong-directory probe reads NOT live).
  - **Scenario 2 (internal):** launch the sender as a plain INTERNAL session; assert record `mode:internal` + null serverUrl; assert `project_message` send is blocked; assert `project_note` drops a note the receiver idle-drains (processed/); assert the receiver's outbound-budget/TUI shows the sender as `internal (doc-drop)`.
  - **Scenario 3 (logging):** assert `[mailbox-mode] detected` on start/resume and `[mailbox-mode] transition` when a session is relaunched across modes.
  - **Isolation proof:** capture agent-harness's real session count (`SELECT count(*) FROM session` on the real `~/.local/share/opencode/opencode.db`) and the real `~/.omo/presence/` + `~/.omo/project-registry.json` contents BEFORE and AFTER — all unchanged.
- Acceptance: every assertion observed and captured to disk; isolation proven across DB, `~/.omo`, and `coordination_notes/`.
- QA: this todo IS the QA; record WHAT/OBSERVED/WHY-ENOUGH/OMITTED per AGENTS.md. Evidence: the evidence dir.
- Commit: `test(mailbox): live internal/external e2e evidence`

## Final verification wave
Runs in parallel after all todos; ALL must APPROVE:
- **F1** plan-compliance audit: every todo delivered as specified, dependency order honored.
- **F2** code-quality review: no `as any`/ts-ignore, no empty catch, no em/en dashes, barrel/exports discipline, file-size sanity.
- **F3** real manual QA: re-run the T11 live e2e independently; confirm evidence exists and isolation held.
- **F4** scope fidelity: no opencode-fork edits, no model-file scope creep, no local-only-liveness drift, no out-of-scope schema changes.

## Commit strategy
One commit per todo (implementation + tests together), messages as listed. Task-owned worktree off `dev`; merge via merge commit (`gh pr merge --merge --delete-branch`) after F1-F4 + CI. Never squash/rebase-merge. Never `--no-verify` except the known model-file pre-commit hook false-positive (document if used).

## Success criteria
- Plain `opencode` session: `project_message` send blocked, `project_note` works, presence record `mode:internal`/null url, own inbox still idle-drains, peers see `internal (doc-drop)`.
- External session: presence record `mode:external`/real url, probe reads "live" only when the session is tracked in `/session/status` with correct directory, `project_message` works.
- Detection logged on start/resume/transition.
- Live e2e evidence recorded under `.omo/evidence/`, proven isolated (free models, alternate DB, throwaway project), agent-harness session list unpolluted.
