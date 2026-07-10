# cross-project-agent-mailbox - Work Plan

## TL;DR (For humans)

**What you'll get:** A way for your AI agents working in different projects to hand each other work. One project's agent drops a written request into another project's "mailbox" folder, and that second project picks it up the next time its agent is free — like the team inbox you already have, but stretched across separate repositories. It's off until you switch it on, and it shows up as a small status panel in your existing sidebar.

**Why this approach:** It's built inside your existing agent setup rather than as a separate add-on, because only the in-house plumbing can safely wake a session without doubling up messages, and only it can draw the sidebar panel. The messages themselves are plain files on disk, so if the upstream tool ever ships something similar you can turn this off and your messages are still readable, with no tangled dependency.

**What it will NOT do:** It won't interrupt an agent that's busy or that you're actively watching — by default only your main orchestrator agent picks up mail, so a focused planning or refactor session is never hijacked. It won't start a project up on its own — if nothing's running there, the message just waits. And it won't fire auto-replies back and forth, so two projects can't get stuck pinging each other.

**Effort:** Large
**Risk:** Medium - the delivery path reuses a proven, safe mechanism; the real risk is in loop-prevention and making sure a message is never processed twice, both of which are heavily tested.
**Decisions to sanity-check:** (1) Only "Sisyphus" receives mail by default — you can widen that list. (2) A message that asks for a bigger job than a project allows is rejected, not silently shrunk. (3) A request for a full planning session can't auto-start the planner agent in this first version — it gets planned by the main agent or handed to you.

Your next move: dual high-accuracy review is DONE (native Momus + isolated Codex gpt-5.5 xhigh; all fixes folded in) — say `$start-work` to hand this to the worker. Full execution detail follows below.

---

> TL;DR (machine): Large/Medium. New omo feature module (flag default OFF): per-repo file mailbox, idle-drain via dispatchInternalPrompt, intake-eligibility (default sisyphus), receive-side validation+quarantine, hop/rate/digest loop bounds, send tool, sidebar section. 14 todos / 5 waves + F1-F4 + human e2e.

## Scope
### Must have
- A first-class omo feature module `packages/omo-opencode/src/features/cross-project-mailbox/` (self-contained: types, storage, hook, tool, tui section, tests). Gated on a config flag, default OFF.
- On-disk wire: a sender agent writes ONE file into the TARGET repo only at `<target-repo>/coordination_notes/<source-projectId>/<messageId>.md` — YAML front-matter (envelope) + Markdown body. Envelope = team-core `MessageSchema` shape (which already carries `messageId`/`timestamp`/`correlationId`) + `fromProject`/`toProject`/`fromProjectId`/`toProjectId`/`intent`/`priority`/`hopCount`/`hopPath`/`supersedes`/`inReplyToMessageId`. Body byte-capped (default 32KB).
- Receive-side authoritative validation (access allowlist + intent-budget ceiling + hop cap + body-digest loop check) — enforced at DRAIN time regardless of how the file got there (manual drops bypass the send tool).
- Idle-drain delivery: a `session.idle` hook on the target repo's single live session reads the active primary, applies the intake-eligibility gate, drains the inbox in priority order through `dispatchInternalPrompt` (the mandatory gate), and acks by moving the file to `processed/` ONLY after the message is confirmed in session history. A durable pending-delivery store bridges the gap between accepted dispatch and history-confirmed ack so a crash/stale-reclaim never re-injects an already-accepted note.
- Intake-eligibility gate: config `intake_eligible_agents` (default `["sisyphus"]`). Ineligible active primary => drain suppressed, notes stay queued.
- Per-project receiver config: `default_sender_access` (`allow-all`|`allow-none`, default `allow-none`) for unlisted senders + a `senders` map keyed by SOURCE projectId, each `{ access: "allow"|"deny", intent_budget }` setting that sender's intent ceiling on the ladder `question < quick < impl < review < work-loop < plan`. Membership-with-allow IS the allowlist (no nested string[]).
- Ping-pong defense: `hopCount` hard cap, per-drain max-notes cap, same-pair rate limit, durable normalized-body digest store with TTL, quarantine of rejected/malformed/over-budget/hop-exceeded notes into `rejected/` with a reason.
- Project registry `~/.omo/project-registry.json` (source of truth) mapping `projectId` -> canonical repo root, where `projectId = projectIdForRoot(realpath(repoRoot))` (one shared canonicalizer). Discovery is exactly, in order: (1) register the current session's `ctx.directory` on load; (2) merge existing registry entries; (3) OpenClaw `reply-session-registry.jsonl` as hints only. NO broad/undefined filesystem scan, NO opencode session-DB scan. Recency-then-alpha sorted.
- A send tool (`project_message` or similar) that writes a note into a target repo inbox with send-side preflight (access + budget + hop) — defense-in-depth, not the sole gate.
- A new section in the EXISTING omo TUI sidebar showing inbound note status (unread/queued/processed for the current repo, read from its `coordination_notes/`) and outbound note status (read from the send-side outbox log `<repo>/.omo/mailbox-outbox.jsonl` the send tool appends to). No new surface, no tmux.
- `interrupt_policy` config enum, default `idle-drain`; `allow-interrupt`/`block-idle-input` declared-but-unimplemented (v2 seam).
- Tests: TDD (bun:test) per todo + an integration suite + a human-monitored e2e on real project tasks; opencode-qa real-harness proof (SSE/idle injection) with evidence under `.omo/evidence/`.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- MUST NOT auto-spawn or auto-resume an OpenCode session for a target repo in v1. If no eligible live session is idle, notes wait on disk indefinitely — no daemon, no background session creation.
- MUST NOT switch/override the live session's primary agent (no opencode API exists; primary is user-controlled via Tab/--agent). Handling is delegation-based only.
- MUST NOT auto-spawn Prometheus for a `plan`-tier note (coordinator-blocked, `constants.ts:403-413`). v1 plan-tier = Sisyphus plans inline OR surfaces to the user. Full auto-Prometheus is v2.
- MUST NOT inject a note through any path other than `dispatchInternalPrompt` (raw `session.prompt`/`promptAsync` is forbidden — memory 584).
- MUST NOT write a reply from inside the drain hook. Replies happen only via an explicit agent tool call (the no-auto-reply invariant must be test-locked).
- MUST NOT stage/commit `coordination_notes/` mailbox files in any QA or agent commit (commit hygiene).
- MUST NOT trust display project names for filesystem paths: reject `..`, path separators, and symlinks escaping the repo root; address only via sanitized `projectId`.
- MUST NOT poll on a timer/daemon (idle-drain only) or implement preempt/interrupt in v1.
- v1 RETRIGGER LIMITATION (stated, not a daemon): if the session is already idle when it becomes eligible (e.g. the user Tabs Prometheus->Sisyphus with no new prompt), queued notes drain on the NEXT `session.idle` or user-turn boundary, not instantly. No `mailbox_check_now` path, no agent-change listener in v1.
- MUST NOT leave a malformed/unauthorized/over-budget/hop-exceeded note in the unread queue to be retried forever — quarantine it.
- MUST NOT depend on any non-omo plugin or any opencode internal that breaks portability of the on-disk wire format.

## Verification strategy
> Zero human intervention for unit/integration. ONE explicitly human-monitored e2e is the user-requested exception (real cross-project task), surfaced at the final wave.
- Test decision: **TDD** with `bun:test` (co-located `*.test.ts`, given/when/then). Implementation + test = one todo.
- Layers: (1) unit per module; (2) an integration suite that drives two temp "repos" (sender + receiver) through the full write -> drain -> ack cycle in-process; (3) opencode-qa real-harness proof via the `opencode-qa` skill (SSE/idle injection) in an isolated XDG sandbox; (4) one human-monitored e2e on real project tasks.
- opencode-qa proof MUST assert: the `session.idle` hook fired, `dispatchInternalPrompt` accepted the injection, the `messageId` appears in `session.messages()` history, the file moved to `processed/`, and the isolated session DB count is unchanged except sandbox-owned state (memory 573 isolation discipline).
- Evidence: `.omo/evidence/<YYYYMMDD>-cross-project-mailbox/task-<N>.<ext>` — every QA artifact written to disk or the QA did not happen.
- Adversarial/concurrency tests are first-class (per Metis): concurrent send+drain race, stale `.delivering-*` reclaim, duplicate-filename collision, no double-injection, manual unauthorized drop quarantined, over-budget/hop-exceeded/identical-body-loop all rejected BEFORE injection.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

- **Wave 1 — Contracts & primitives (no cross-deps):** config schema (1), envelope + projectId sanitization types (2), project registry (3), active-primary resolver spike (4). These define the shapes everything else imports.
- **Wave 2 — Storage & safety core (depend on W1 types):** atomic mailbox storage + reservation/ack (5), receive-side validation + quarantine (6), ping-pong/loop bounding store (7).
- **Wave 3 — Delivery & send (depend on W2 core):** idle-drain hook + intake-eligibility + retrigger edge (8), send tool with send-side preflight (9), injected-prompt triage template (10).
- **Wave 4 — Surface & wiring (depend on W3):** TUI sidebar section (11), plugin wiring + config-flag gating + hook-order placement (12).
- **Wave 5 — Integration & real-harness QA (depend on all):** in-process two-repo integration suite (13), opencode-qa SSE/idle proof + evidence harness (14).
- **Final wave — F1-F4 review** + the human-monitored e2e.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 config schema | none | 6,8,9,12 | 2,3,4 |
| 2 envelope + projectId | none | 5,6,9,10 | 1,3,4 |
| 3 project registry | none | 8,9 | 1,2,4 |
| 4 active-primary resolver spike | none | 8 | 1,2,3 |
| 5 mailbox storage + reservation/ack + pending-store | 2 | 6,7,8,13 | none (strictly before 6,7) |
| 6 receive-side validation + quarantine | 1,2,5 | 8,9 | 7 |
| 7 ping-pong/loop store | 1,5 | 8,9 | 6 |
| 10 injected-prompt triage template | 2 | 8 | 9 |
| 8 idle-drain hook + eligibility + retrigger | 1,3,4,5,6,7,10 | 12,13,14 | 9 |
| 9 send tool + preflight + outbox | 1,2,3,6,7 | 11,12,13 | 8,10 |
| 11 TUI sidebar section | 1,5,9 | 12 | none (starts after 9; 12 depends on it) |
| 12 plugin wiring + gating | 1,8,9,11 | 13,14 | none |
| 13 integration suite (two-repo) | 5,8,9,12 | F-wave | 14 |
| 14 opencode-qa real-harness proof | 8,12 | F-wave | 13 |
> 5 lands strictly before 6/7 (they import its storage API). 10 lands before 8 (8 consumes its template). 11 needs 1 (gated on `enabled`) + 9 (reads the outbox log it writes).

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
### Wave 1 — Contracts & primitives

- [x] 1. Config schema for the mailbox feature
  What to do: Add a Zod v4 schema `CrossProjectMailboxConfigSchema` and wire it into the root config. Fields: `enabled` (bool, default false); `intake_eligible_agents` (array of agent names, default `["sisyphus"]`); `interrupt_policy` (enum `idle-drain`|`allow-interrupt`|`block-idle-input`, default `idle-drain`, only `idle-drain` implemented); a top-level `default_sender_access` (enum `allow-all`|`allow-none`, default `allow-none`) governing senders NOT in the map; a `senders` map keyed by SOURCE (sender) projectId, each entry `{ access: enum "allow"|"deny" (default "allow"), intent_budget: enum question|quick|impl|review|work-loop|plan }` (the per-sender intent ceiling). No nested string[] allowlist — membership in `senders` with `access:"allow"` IS the allowlist; bounds `{ max_hops (default 4), max_notes_per_drain (default 5), same_pair_rate_limit_per_min (default 6), body_digest_ttl_min (default 60), max_body_bytes (default 32768), reservation_ttl_ms (default 120000) }`.
  Must NOT do: do not implement `allow-interrupt`/`block-idle-input` behavior (declared-only); do not put any secret/path in defaults.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 6,8,9,12
  References (VERIFIED — Codex review corrected these): the real 11-field team schema lives in `packages/team-core/src/config.ts` (NOT `schema/team-mode.ts`, which is a one-line `export * from "@oh-my-opencode/team-core/config"`); mirror its style + `.describe()`. Add the field to `OhMyOpenCodeConfigSchema` in `packages/omo-opencode/src/config/schema/oh-my-opencode-config.ts` (note the `experimental` nesting precedent). Barrel is `packages/omo-opencode/src/config/schema.ts` (there is NO `schema/index.ts`). Validate `intake_eligible_agents` entries against `OverridableAgentNameSchema` in `packages/omo-opencode/src/config/schema/agent-names.ts`. Schema autogen: `bun run build:schema`.
  Acceptance criteria (agent-executable): `bun run build:schema` regenerates `assets/oh-my-opencode.schema.json` containing `cross_project_mailbox`; `bun test packages/omo-opencode/src/config` green; a Zod parse test asserts defaults (enabled=false, intake_eligible_agents=["sisyphus"], interrupt_policy="idle-drain").
  QA scenarios: happy — parse a config with a full `cross_project_mailbox` block, assert typed result; failure — parse `intake_eligible_agents:["bogus-agent"]` and an out-of-enum `intent_budget`, assert Zod rejects. Evidence `.omo/evidence/<date>-cross-project-mailbox/task-1-schema.txt`.
  Commit: Y | feat(mailbox): add cross-project mailbox config schema

- [x] 2. Envelope schema + projectId sanitization
  What to do: Define `MailboxMessageSchema` (clone team-core `MessageSchema` (`packages/team-core/src/types.ts`), which ALREADY provides `messageId`(`z.string().uuid()`),`timestamp`(`z.number().int().positive()` — a numeric epoch-ms integer, NOT ISO8601; it is the todo-5 supersede-chain tiebreak where larger=newer),`correlationId`(`z.string().uuid().optional()` in team-core — the mailbox schema OVERRIDES it to REQUIRED, see below) + add `fromProject`,`toProject`(display names, metadata-only, NEVER path segments),`fromProjectId`,`toProjectId`(sanitized ids, the ONLY path-eligible identifiers),`intent`,`priority`(number),`hopCount`(int>=0),`hopPath`(string[]),`supersedes`(messageId|null),`inReplyToMessageId`(messageId|null — set only on replies; PERSISTED in the envelope so the chain is auditable on disk)). `correlationId` is a REQUIRED persisted envelope field (never optional in the stored note); `hopCount`/`hopPath`/`correlationId`/`inReplyToMessageId` are written by the send tool (todo 9), never hand-authored. Define a canonical body rule: front-matter holds metadata only; the Markdown body below the front-matter IS `Message.body`, byte-capped at `max_body_bytes`. Implement ONE shared canonicalizer `projectIdForRoot(repoRoot)` = `<lowercase-kebab-slug-of-basename>-<short-hash(realpath(repoRoot))>` (slug for humans, hash for collision-safety); todo 3's registry MUST key on this exact function. Implement `assertPathWithinRoot(targetRoot, candidatePath)` that resolves the final mailbox path and throws if it escapes `targetRoot` (via `..`, absolute, or a symlinked mailbox dir), plus a `safeMessageIdFilename()` guard rejecting separators/control chars.
  Must NOT do: do not duplicate `body` in both front-matter and Markdown; do not accept a display name (`fromProject`/`toProject`) as a path segment; do not build any path from an unsanitized id.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 5,6,9,10
  References: `packages/team-core/src/types.ts` (`MessageSchema` fields), `packages/team-core/src/team-mailbox/` (envelope serialize/parse patterns), memory 1247 (revision-suffix non-destructive), front-matter parse via existing skill frontmatter parser pattern in `packages/skills-loader-core/` (YAML). New files under `packages/omo-opencode/src/features/cross-project-mailbox/envelope/`.
  Acceptance criteria: `bun test` for envelope round-trip (serialize->parse equals input); body >32KB rejected; `projectIdForRoot` is deterministic and collision-distinct for two different roots with the same basename; `assertPathWithinRoot(root, root+"/coordination_notes/../../etc")` throws; a symlinked `coordination_notes/` pointing outside the root is rejected; a 32768-byte body passes and 32769 fails.
  QA scenarios: happy — serialize a note, write to temp, re-parse, deep-equal; failure — feed `toProjectId` containing `../escape`, a path-separator messageId, and a symlink-escape mailbox dir, assert all three rejected. Evidence task-2-envelope.txt.
  Commit: Y | feat(mailbox): message envelope schema + projectId/path sanitization

- [x] 3. Project registry + discovery
  What to do: Implement `~/.omo/project-registry.json` as source of truth: `{ projects: [{ projectId, repoRoot, displayName, lastSeen }] }` with atomic write (temp+rename) + lock. `projectId` MUST be produced by todo 2's `projectIdForRoot()` (shared canonicalizer) — no separate id scheme. Discovery is EXACTLY, in this order: (1) `registerProject(ctx.directory)` for the current session on load; (2) merge existing registry entries; (3) read OpenClaw `reply-session-registry.jsonl` as hints only. NO broad filesystem scan, NO opencode session-DB scan. Merge + sort recency-then-alpha. Provide `resolveTargetRepoRoot(projectId)` and `registerProject(repoRoot)`.
  Must NOT do: do not treat OpenClaw registry as authoritative; do not write outside `~/.omo/`; do not scan the filesystem or opencode DB for projects; do not invent a projectId scheme divergent from `projectIdForRoot()`.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 8,9
  References: `packages/omo-opencode/src/openclaw/` (reply-session-registry.jsonl shape, projectPath+sessionId+tmuxPaneId), atomic-write pattern in `packages/omo-opencode/src/features/boulder-state/` or team-state-store atomic locks (`packages/omo-opencode/src/features/team-mode/team-state-store/`), `~/.omo` workspace conventions.
  Acceptance criteria: `bun test` — registry round-trips, concurrent `registerProject` calls do not corrupt the file (atomic), sort order recency-then-alpha asserted, `resolveTargetRepoRoot` returns canonical root or throws on unknown id, and a registered repo's key equals `projectIdForRoot(realpath(repoRoot))` (round-trips with envelope `toProjectId`).
  QA scenarios: happy — register two repos, resolve both; failure — resolve unknown projectId asserts a typed not-found error; concurrent-write test asserts no JSON corruption. Evidence task-3-registry.txt.
  Commit: Y | feat(mailbox): project registry with atomic writes + discovery

- [x] 4. Active-primary resolver spike (UNVALIDATED-ASSUMPTION lock)
  What to do: DECISION (made now, not deferred): v1 resolves the active primary from the LAST-KNOWN agent observed on the session's most recent `chat.message`/`chat.params` edge (the `agent` field), cached per `sessionID`. Implement `resolveActivePrimaryAgent(sessionID)` returning that last-known value (or `undefined` if never observed -> treated as ineligible). The probe is VALIDATION ONLY: run an `opencode-qa` check to record whether a Tab switch updates that field before the next idle; document the measured accuracy in the module README. If the probe shows Tab switches are observable in real time, note it as a future precision win — but v1 ships on last-known regardless and never blocks on the probe outcome.
  Must NOT do: do not make v1 behavior conditional on the probe result (the decision is last-known); do not infer the agent by parsing message history heuristically beyond the cached `agent` field.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 8
  References: `packages/omo-opencode/src/plugin-interface.ts` (~L39-48, chat.params/message input carries `agent`), `packages/omo-opencode/src/plugin/chat-message.ts` (~L95-97, agent read), opencode SDK `client.session` surface (confirmed: no agent-set API). The per-session cache should live in the feature module, updated from the existing chat-message hook input.
  Acceptance criteria: `bun test` — `resolveActivePrimaryAgent` returns the cached last-known agent after a simulated `chat.message` with `agent:"sisyphus"`, and `undefined` before any observation; PLUS a recorded `opencode-qa` probe transcript documenting real-harness Tab-switch timing. The module exports a single source-of-truth resolver with the accuracy guarantee written in its README.
  QA scenarios: happy — observe `agent:sisyphus`, resolver returns `sisyphus`; failure/edge — no observation yet returns `undefined` (=> ineligible => no drain). Evidence task-4-primary-resolver.txt (include the probe transcript).
  Commit: Y | feat(mailbox): active-primary agent resolver + accuracy probe

### Wave 2 — Storage & safety core

- [x] 5. Atomic mailbox storage + reservation + ack + pending-delivery store
  What to do: Implement the on-disk mailbox under `<target-repo>/coordination_notes/<source-projectId>/`. Send-write = temp-write + atomic rename to `<messageId>.md`. Drain = rename to `.delivering-<messageId>.md` (reservation) -> dispatch -> on history-confirmed injection, move to `processed/<messageId>.md`; stale `.delivering-*` older than `reservation_ttl_ms` reclaimed. CRITICAL exactly-once bridge: maintain a durable pending-delivery store `<target-repo>/coordination_notes/.pending.json` recording `{ messageId, sessionId, reservedPath, dispatchedAt, state }` where `state` is `dispatch_sent` (the gate ACCEPTED the injection but the messageId is not yet seen in history) or `history_confirmed` (messageId observed in `session.messages()`). ONLY `history_confirmed` may `ack()` (move to `processed/`) — this matches the Scope rule 'ack only after history-confirm'. Gate results of `reserved`/`queued`/`failed` are NOT a dispatch and write NO pending record. Reclaim (`reclaimStale`) on a stale `.delivering-*`: (a) messageId `history_confirmed` in pending => `ack()` (no re-inject); (b) messageId `dispatch_sent` => re-check `session.messages()`: if now present => mark `history_confirmed` + `ack()`; if still absent AND older than `reservation_ttl_ms` => return to unread for ONE retry (a later late-landing dispatch is caught by the body-digest dup-guard, todo 7); (c) no pending record => never dispatched => return to unread. Revisions: unique `messageId` per revision + `supersedes`; drain picks latest-only per supersede-chain, where "latest" = highest `timestamp`, ties broken by lexically-greatest `messageId`. Define dirs: `processed/`, `rejected/`. Provide `listUnread()`, `reserve()`, `markDispatched()`, `ack()`, `quarantine(reason)`, `reclaimStale()`.
  Must NOT do: do not edit a note in place; do not inject before reservation; do not leave a reserved file un-reclaimed; do not re-inject a note recorded `history_confirmed` in `.pending.json`; do not `ack()` a `dispatch_sent` note without first re-confirming its messageId in session history.
  Parallelization: Wave 2 | Blocked by: 2 | Blocks: 6,7,8,13 | parallel with: none (6,7 import this storage API; land 5 first)
  References: `packages/team-core/src/team-mailbox/` (reservation `.delivering-` + `processed/` move + stale reclaim — clone this exactly), `packages/team-core/src/team-mailbox/poll.ts` (`pollAndBuildInjection`), memory 1247 (non-destructive revision suffix).
  Acceptance criteria: `bun test` — concurrent send+drain never double-injects and never loses a note; stale `.delivering-*` with a `history_confirmed` pending record acks (no re-inject); stale `.delivering-*` with a `dispatch_sent` record re-checks history (confirmed=>ack, still-absent-past-TTL=>requeue once); stale `.delivering-*` with NO pending record returns to unread; supersede-chain drains latest only (timestamp then messageId tiebreak); ack moves to `processed/`.
  QA scenarios: happy — write+drain+ack one note, assert in `processed/` and absent from `.pending.json`; failure — simulate crash AFTER dispatch but BEFORE ack with a `history_confirmed` pending entry, assert next reclaim acks it exactly once and does NOT re-inject; AND a `dispatch_sent`-but-never-landed entry past TTL requeues exactly once (dup-guard blocks a double if the original later lands); concurrency — fire N concurrent sends + 1 drain, assert exactly-once. Evidence task-5-storage.txt.
  Commit: Y | feat(mailbox): atomic mailbox storage with reservation + ack + reclaim

- [x] 6. Receive-side authoritative validation + quarantine
  What to do: At drain time, before injection, validate each note against the RECEIVER's config (todo 1 shape): access check (sender projectId in `senders` with `access:"allow"` => allowed; in `senders` with `access:"deny"` => unauthorized; NOT in `senders` => follow `default_sender_access` allow-all/allow-none), intent-budget ceiling (the matched sender's `intent_budget`, or for unlisted-but-allowed senders the lowest ceiling `question`) (**reject over-ceiling** — the chosen deterministic v1 behavior, never silently downgrade), `hopCount > max_hops` reject, malformed/unparseable reject. Rejected/malformed/unauthorized/over-budget/hop-exceeded/duplicate-loop => `quarantine()`: move the note to `rejected/<messageId>.md` and write a sibling `rejected/<messageId>.reason.json` = `{ reason: enum("unauthorized"|"over-budget"|"hop-exceeded"|"malformed"|"duplicate-loop"), detail: string, at: ISO8601 }`. This is authoritative even for manual file drops. EXPLICIT boundary (resolves the todo-6/todo-7 overlap): `rate-limited` is NOT a quarantine reason — a rate-limited note is a TRANSIENT re-queue handled entirely in todo 7 (it stays unread and is retried on a later drain), never moved to `rejected/`. Only `duplicate-loop` (a confirmed identical-normalized-body replay within the digest TTL, todo 7) is the terminal loop outcome and DOES quarantine here.
  Must NOT do: do not rely on send-side checks; do not leave invalid notes in the unread queue to retry forever; do not silently drop (always quarantine with reason).
  Parallelization: Wave 2 | Blocked by: 1,2,5 | Blocks: 8,9 | parallel with 7
  References: team-core `listUnreadMessages()` malformed-skip behavior (improve to quarantine), config schema from todo 1, envelope from todo 2.
  Acceptance criteria: `bun test` — each rejection class (unauthorized/over-budget/hop-exceeded/malformed/duplicate-loop) lands in `rejected/` with reason; an allowed in-budget note passes; decision is deterministic (over-ceiling always rejected in v1); a rate-limited note is asserted to STAY unread (NOT in `rejected/`).
  QA scenarios: happy — in-budget allowed note validates; failure — unauthorized sender, over-ceiling intent, hopCount=max+1, malformed YAML, duplicate-loop replay each quarantined with correct reason; AND a rate-limited note asserted absent from `rejected/` and still unread. Evidence task-6-validation.txt.
  Commit: Y | feat(mailbox): receive-side authoritative validation + quarantine

- [x] 7. Ping-pong / loop-bounding store
  What to do: Durable per-(sender,target,correlationId) normalized-body digest store with TTL (`body_digest_ttl_min`); reject duplicate body hashes within window. NORMALIZATION for the digest is defined: trim leading/trailing whitespace, collapse internal runs of whitespace to a single space, normalize line endings to `\n`, then `sha256`. Same-pair rate limiter (`same_pair_rate_limit_per_min`). Per-drain max-notes cap (`max_notes_per_drain`) with priority-desc then timestamp-asc ordering and starvation-safe queueing (low priority stays queued, never dropped). When a high-priority note is from a rate-limited pair, it stays queued (rate-limit wins) rather than blocking the whole drain — the drain skips it and processes the next eligible note. Rate-limit is a TRANSIENT re-queue (note stays unread, retried next drain), NEVER a quarantine; the ONLY terminal loop outcome that quarantines (via todo 6) is `duplicate-loop` = a confirmed identical-normalized-body replay within `body_digest_ttl_min`.
  Must NOT do: do not store digests only in-memory (must survive restart); do not drop low-priority notes.
  Parallelization: Wave 2 | Blocked by: 1,5 | Blocks: 8,9 | parallel with 6
  References: storage API from todo 5, bounds config from todo 1, team-core poll ordering.
  Acceptance criteria: `bun test` — identical-body within TTL rejected; rate limiter blocks the 7th same-pair note in a minute; drain caps at max_notes_per_drain and leaves the rest queued in priority order.
  QA scenarios: happy — distinct notes pass; failure — replay identical body asserts loop-reject; flood same-pair asserts rate-limit; priority test asserts low-pri queued not dropped. Evidence task-7-loopbound.txt.
  Commit: Y | feat(mailbox): durable loop/ping-pong bounding + priority drain order

### Wave 3 — Delivery & send

- [x] 8. Idle-drain hook + intake-eligibility + retrigger edge
  What to do: A `session.idle` hook (cross-repo sibling of team-idle-wake-hint). On idle: resolve active primary via `resolveActivePrimaryAgent` (todo 4, last-known); if NOT in `intake_eligible_agents` => suppress (leave queued). If eligible: validate (todo 6) + loop-bound (todo 7), build injection from up to `max_notes_per_drain` notes (todo 10 template), inject via `dispatchInternalPrompt`, `markDispatched` then `ack` on history-confirm (todo 5). RETRIGGER EDGE — DECIDED for v1: drain ONLY on `session.idle`. If the session is already idle when it becomes eligible (Tab Prometheus->Sisyphus with no new prompt), the notes wait for the NEXT `session.idle`/user-turn. NO `mailbox_check_now` tool, NO agent-change listener — this is the stated v1 limitation (Scope). The mailbox prompt body passed to `dispatchInternalPrompt` MUST omit `agent`/`model`/`variant` (never override the live primary).
  Must NOT do: never inject outside `dispatchInternalPrompt`; never set `agent`/`model`/`variant` on the dispatched prompt; never write a reply or call `project_message` from the hook; never ack before a history-confirmed injection; never create/resume a session if none is live (return early).
  Parallelization: Wave 3 | Blocked by: 1,3,4,5,6,7,10 | Blocks: 12,13,14 | parallel with 9
  References: `packages/omo-opencode/src/hooks/team-session-events/team-idle-wake-hint.ts` (idle wake + `pendingInjectedMessageIds` + `findDeliveredMessageIds` ack-confirm pattern — clone, but STRIP any `agent`/routing fields from the prompt body), `packages/omo-opencode/src/shared/prompt-async-gate.ts` + `packages/utils/src/prompt-async-gate.ts` (`dispatchInternalPrompt` options: reserve-before-dispatch, postDispatchHold — memory 584), hook tier registration `packages/omo-opencode/src/plugin/hooks/create-session-hooks.ts` or event handlers `packages/omo-opencode/src/plugin/event.ts`, hook-order vs `todoContinuationEnforcer`/background-wake/`teamIdleWakeHint`.
  Acceptance criteria: `bun test` + opencode-qa — eligible idle drains & acks; ineligible leaves queued; ack only after `messageId` confirmed in session history; gate reserved/queued/failed result does NOT ack or lose the note. SAFETY-INVARIANT TESTS (all in this todo): (a) the dispatched prompt input is asserted to contain NO `agent`/`model`/`variant` key (no primary-switch); (b) with NO live session, the hook returns without calling any session-create/resume API (spy asserts zero calls = no auto-spawn); (c) the hook never calls the send/`project_message`/mailbox-write API during a drain (spy asserts zero = no auto-reply); (d) a `plan`-intent note does NOT trigger any Prometheus spawn (spy on `task()`/session-create asserts no prometheus target).
  QA scenarios: happy — sisyphus idle, note drained+acked; failure — prometheus active => suppressed, note still unread; gate-busy => no ack, note retried next idle; already-idle-then-eligible => note waits for next idle (documented limitation), asserted. Evidence task-8-drain.txt.
  Commit: Y | feat(mailbox): idle-drain hook with intake-eligibility + gated injection

- [x] 9. Send tool + send-side preflight
  What to do: A tool `project_message` with this exact input schema (all camelCase): `{ targetProjectId: string (required, must resolve in registry), intent: enum(question|quick|impl|review|work-loop|plan), body: string (<= max_body_bytes), priority?: number (default 0), threadId?: string|null (default null), supersedes?: string|null, inReplyToMessageId?: string|null }`. EXPLICIT input contract (resolves the round-2 correlationId ambiguity): `hopCount` and `hopPath` are NEVER tool inputs — they do not appear in the schema and are always derived. The thread id IS settable, but ONLY via the optional `threadId` input (never via a raw `correlationId` field), and ONLY honored on a FRESH send; on a reply it is ignored in favor of the parent's. Derivation: (a) FRESH origination (`inReplyToMessageId` null/absent) => `hopCount = 0`, `hopPath = [thisProjectId]`, envelope `correlationId = input.threadId ?? new uuid`, `inReplyToMessageId = null`. (b) REPLY (`inReplyToMessageId` set) => the tool READS the parent note's envelope from THIS repo's own `coordination_notes/**/processed/<id>.md` (the trusted on-disk record of a note this project actually received); it derives `hopCount = parent.hopCount + 1`, `hopPath = [...parent.hopPath, thisProjectId]`, envelope `correlationId = parent.correlationId` (any `threadId` input is IGNORED with no error), `inReplyToMessageId` persisted as given; if the parent id is not found in this repo's processed store => typed `reply-parent-not-found` error (NO write). This makes hop counting tamper-evident: a reply can only escalate hops from a note the sender provably received, and the agent can never forge `hopCount`/`hopPath` or hijack a reply's thread id. Behavior: resolve target repoRoot (todo 3), build envelope (todo 2) with the trusted hop fields above, run send-side preflight (access + budget + hop cap — defense in depth, NOT the sole gate), atomic-write into the target inbox (todo 5), AND append one line to the SENDER's outbox log `<sender-repo>/.omo/mailbox-outbox.jsonl` = `{ messageId, targetProjectId, intent, priority, sentAt }` (this is the data source for the TUI outbound section, todo 11). Register gated on `enabled`.
  Must NOT do: do not bypass receive-side validation; do not write to a non-registered/unsafe path; do not auto-call itself from a hook; do not accept a display name or raw path as `targetProjectId`.
  Parallelization: Wave 3 | Blocked by: 1,2,3,6,7 | Blocks: 11,12,13 | parallel with 8,10
  References: tool factory pattern `packages/omo-opencode/src/tools/*/` + `tool({...})` from `@opencode-ai/plugin`, registry `packages/omo-opencode/src/plugin/tool-registry.ts` + `tool-registry-factories.ts` + `tool-registry-gated-tools.ts`, team_mode `team_send_message` tool for shape (`packages/omo-opencode/src/features/team-mode/tools/`).
  Acceptance criteria: `bun test` — a FRESH send with no `threadId` writes a note with `hopCount=0` + `hopPath=[thisProjectId]` + a freshly-generated envelope `correlationId` AND appends the outbox-log line; a FRESH send WITH a `threadId` persists `correlationId === input.threadId`; a REPLY (`inReplyToMessageId` pointing at a note in this repo's `processed/`) derives `hopCount=parent+1`, appends `thisProjectId` to `hopPath`, persists `correlationId === parent.correlationId` AND `inReplyToMessageId === input.inReplyToMessageId`, and a `threadId` passed ALONGSIDE a reply is IGNORED (envelope `correlationId` still equals the parent's, no error); an `inReplyToMessageId` with no matching processed note => `reply-parent-not-found` (no file, no outbox line); the schema REJECTS a raw `hopCount`/`hopPath`/`correlationId` input key (unknown-key/strict parse); preflight rejects over-budget/over-hop/unauthorized BEFORE writing (no file, no outbox line); `targetProjectId` not in registry => typed not-found error.
  QA scenarios: happy — fresh quick-intent note to an allowed project asserts file on disk (hopCount=0, generated correlationId) + outbox line; fresh send with explicit `threadId` asserts envelope `correlationId === threadId`; reply note asserts hopCount=parent+1, carried `parent.correlationId`, persisted `inReplyToMessageId`; failure — plan-intent note to a quick-ceiling project asserts preflight reject and NO outbox line; reply to an unknown parent asserts `reply-parent-not-found`; a reply carrying a stray `threadId` asserts the parent's correlationId still wins; hop at cap asserts reject. Evidence task-9-sendtool.txt.
  Commit: Y | feat(mailbox): project_message send tool with send-side preflight

- [x] 10. Injected-prompt triage template
  What to do: Build the system/context text injected into the eligible primary, per `intent`. Tells the agent: this is a cross-project work REQUEST from `<fromProject>`; here is the body + references; triage by intent — question=answer inline; quick/impl/review=delegate via `task()` (categories or eligible subagents incl. atlas/hephaestus); work-loop=consider atlas; plan=plan inline as Sisyphus OR surface to the user (Prometheus is NOT auto-spawnable). Explicitly: do NOT auto-reply; replies require an explicit `project_message` call.
  Must NOT do: do not instruct spawning Prometheus; do not imply the note auto-spawns anything.
  Parallelization: Wave 3 | Blocked by: 2 | Blocks: 8 | parallel with 9
  References: `packages/omo-opencode/src/tools/delegate-task/constants.ts:403-413` (coordinator block — Prometheus unspawnable), prompt-build patterns in `packages/prompts-core/`, intent ladder from todo 1.
  Acceptance criteria: `bun test` snapshot — template renders correct guidance per intent; plan-intent text contains the "surface to user / inline Sisyphus, not Prometheus" instruction and the no-auto-reply clause.
  QA scenarios: happy — render each intent, assert correct delegation hint; failure — assert plan-intent never says "spawn Prometheus". Evidence task-10-template.txt.
  Commit: Y | feat(mailbox): per-intent injected triage template

### Wave 4 — Surface & wiring

- [x] 11. TUI sidebar mailbox section
  What to do: Add a section to the EXISTING omo sidebar. INBOUND counts (unread/queued/processed) derive from the current repo's `coordination_notes/*/` + `processed/` dirs. OUTBOUND counts (recently sent) derive from the current repo's `<repo>/.omo/mailbox-outbox.jsonl` (written by todo 9) — last N entries. Render only when `enabled`. Both reads are cheap/cached, never blocking.
  Must NOT do: do not create a new sidebar surface; do not spawn tmux; do not block render on disk I/O (read cheaply/cached); do not attempt to read other repos' mailboxes for outbound status (use the local outbox log only).
  Parallelization: Wave 4 | Blocked by: 1,5,9 | Blocks: 12 | parallel with: none (gated on 9, which is Wave 3; 12 depends on 11 so nothing in Wave 4 runs alongside it)
  References: `packages/omo-opencode/src/tui.ts` (`sidebar_content` slot, `TuiPluginModule`, @opencode-ai/plugin/tui SolidJS), `packages/omo-opencode/src/features/tui-sidebar/` (`compute-view.ts`, `element-helpers.ts` — existing active-agents/background-jobs/ralph sections to mirror), the outbox log shape from todo 9.
  Acceptance criteria: `bun test` for the compute-view section: inbound counts derived from a fixture mailbox AND outbound counts derived from a fixture `mailbox-outbox.jsonl`; the section is absent when feature disabled.
  QA scenarios: happy — fixture mailbox with 2 unread/1 processed + an outbox with 3 sent renders correct inbound AND outbound counts; failure/disabled — flag off => section omitted. Evidence task-11-tui.txt.
  Commit: Y | feat(mailbox): TUI sidebar mailbox status section

- [x] 12. Plugin wiring + config-flag gating + hook order
  What to do: Register the idle-drain hook in the correct tier and place it deterministically relative to `todoContinuationEnforcer`, background wake, and `teamIdleWakeHint`; register `project_message` in the tool registry as a gated tool; gate hook+tool+TUI on `cross_project_mailbox.enabled`. COMMIT HYGIENE (concrete, not a note): (1) append `coordination_notes/` and `.omo/mailbox-outbox.jsonl` to the repo-root `.gitignore` (create if absent); (2) add a guard in the QA/commit flow that runs `git diff --cached --name-only` and FAILS if any path matches `coordination_notes/` or `mailbox-outbox.jsonl`. STATIC-AUDIT OWNERSHIP: run `bun test packages/omo-opencode/src/shared/prompt-async-route-audit.test.ts` and confirm green; since the drain hook uses `dispatchInternalPrompt` (not raw promptAsync) it needs NO allowlist entry — assert the audit passes without adding the new files to any raw-prompt allowlist.
  Must NOT do: do not register anything when disabled; do not reorder existing hooks destructively; do not add the new feature files to the raw-prompt allowlist (they must route through the gate).
  Parallelization: Wave 4 | Blocked by: 1,8,9,11 | Blocks: 13,14 | parallel with none
  References: `packages/omo-opencode/src/plugin/hooks/create-session-hooks.ts` / `create-tool-guard-hooks.ts` / `create-transform-hooks.ts` (tiers + `safeHook()`), `packages/omo-opencode/src/plugin/tool-registry.ts` (gated records), `packages/omo-opencode/src/config/schema/hooks.ts` (`HookNameSchema`), `packages/omo-opencode/src/plugin/event.ts` (direct event handlers if event-tier), `packages/omo-opencode/src/shared/prompt-async-route-audit.test.ts` (static audit that must stay green).
  Acceptance criteria: `bun test` — with flag off, neither the hook nor the tool is registered (assert tool list + hook composition); with flag on, both present; hook-order test asserts placement; `git check-ignore coordination_notes/` and `git check-ignore .omo/mailbox-outbox.jsonl` both succeed; the staged-path guard fails a commit containing a `coordination_notes/` path; the prompt-async-route-audit stays green.
  QA scenarios: happy — flag on, `opencode run` lists `project_message`; failure — flag off, tool absent + idle produces no drain; hygiene — attempt to stage a `coordination_notes/` file, assert the guard blocks it. Evidence task-12-wiring.txt.
  Commit: Y | feat(mailbox): wire hook + tool + TUI behind config flag

### Wave 5 — Integration & real-harness QA

- [x] 13. Two-repo integration suite (in-process)
  What to do: Drive two temp "repos" (sender + receiver) through the FULL cycle in-process: register both, send a note sender->receiver, simulate receiver `session.idle` with an eligible primary, assert injection built + acked to `processed/`. Cover concurrency (concurrent send+drain), eligibility suppression, quarantine paths, loop-bound rejection, hop cap.
  Must NOT do: do not hit the real opencode binary here (that's todo 14); do not use the host's real `~/.omo` (use temp HOME/registry).
  Parallelization: Wave 5 | Blocked by: 5,8,9,12 | Blocks: F-wave | parallel with 14
  References: all module APIs (todos 2,5,6,7,8,9), bun:test temp-dir patterns, `test-setup.ts` state reset.
  Acceptance criteria: `bun test` integration file green covering happy cycle + 5 adversarial cases; no reliance on host state.
  QA scenarios: happy — full send->drain->ack; failure — unauthorized + over-budget + hop-exceeded + identical-body + ineligible-primary each asserted. Evidence task-13-integration.txt.
  Commit: Y | test(mailbox): two-repo end-to-end integration suite

- [x] 14. opencode-qa real-harness proof + evidence harness
  What to do: Use the `opencode-qa` skill to drive the REAL harness in an isolated XDG sandbox: enable the flag, place a note in a sandbox target repo, trigger a real `session.idle`, and PROVE via SSE/`session.messages()` that the hook fired, `dispatchInternalPrompt` accepted, the `messageId` is in history, and the file moved to `processed/`. Assert isolation precisely: the REAL `~/.local/share/opencode/opencode.db` session `count(*)` is identical before vs after (the isolation receipt) because the test runs under an isolated `XDG_DATA_HOME`; the test session exists ONLY in the sandbox XDG DB, which is the sole DB that grows. Write all artifacts under `.omo/evidence/`.
  Must NOT do: do not run against the real `~/.local/share/opencode/opencode.db`; do not skip the isolation proof.
  Parallelization: Wave 5 | Blocked by: 8,12 | Blocks: F-wave | parallel with 13
  References: `opencode-qa` skill (`.claude/skills/opencode-qa/`, scripts `sse-hook-probe.sh`, `tui-smoke.sh`), `script/agent/qa-sandbox.sh` (isolated XDG + disable autoupdate/models-fetch), memory 573 isolation discipline.
  Acceptance criteria: an evidence dir `.omo/evidence/<date>-cross-project-mailbox/` containing the SSE transcript proving idle->inject->ack, the before/after session-count isolation receipt, and the exact commands run.
  QA scenarios: happy — real idle drains a real note, evidence captured; failure — ineligible primary in the real harness leaves the note unread (captured). Evidence task-14-opencode-qa/ (folder).
  Commit: Y | test(mailbox): real-harness opencode-qa proof + isolation evidence

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
- [x] F2. Code quality review
- [x] F3. Real manual QA
- [x] F4. Scope fidelity

## Commit strategy
- Deliver through the `work-with-pr` skill in an isolated worktree (memory 574); never hand-commit to `dev`. Branch targets `dev`, merged with a merge commit (memory 575/576).
- One atomic commit per todo (the `Commit:` line on each). Implementation + its tests land together in the same commit.
- Each commit message: `feat(mailbox): ...` / `test(mailbox): ...`. No version bumps, no `package.json` edits (memory 577/578).
- QA evidence under `.omo/evidence/<date>-cross-project-mailbox/` is committed with the PR (it is the gate per memory 573). `coordination_notes/` mailbox runtime files are NEVER staged (todo 12 hygiene).
- Do not commit until the user approves the diffs (memory 1262) — this plan authorizes worker execution only on explicit `$start-work`, and commit approval is still required.

## Success criteria
- `cross_project_mailbox.enabled=false` by default; with the flag off, zero new hooks/tools/TUI register and behavior is identical to today (regression-safe).
- With the flag on: a note written by a sender agent into `<target>/coordination_notes/<source-projectId>/<id>.md` is drained by the target repo's single live session at `session.idle` ONLY when the active primary is in `intake_eligible_agents`, injected exclusively through `dispatchInternalPrompt`, and acked to `processed/`.
- All adversarial cases pass: concurrent send+drain is exactly-once, stale reservations reclaim, unauthorized/over-budget/hop-exceeded/identical-body notes quarantine to `rejected/` with a reason, low-priority notes never starve-drop.
- No double-injection (memory 584 invariant holds — the `prompt-async-route-audit.test.ts` static audit stays green).
- v1 never auto-spawns a session, never switches the live primary, never auto-spawns Prometheus, never auto-replies from a hook.
- `bun test` + the two-repo integration suite green; `opencode-qa` real-harness evidence on disk proving idle->inject->ack with an isolation receipt; one human-monitored e2e on a real cross-project task observed to work.
- F1-F4 final-wave reviewers all APPROVE.
