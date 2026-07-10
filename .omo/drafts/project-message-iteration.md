# project-message-iteration — Draft

status: interviewing
pending-action: (after approval) write .omo/plans/project-message-iteration.md
intent-route: CLEAR

## Request (user, verbatim intent)
Iterate on the `project_message` cross-project mailbox tool. Triggered by cloudhome↔atlas
messages not draining. Requirements:
1. Triage + fix why messages aren't getting drained/processed.
2. Active agent sessions must see RECIPROCAL send permissions (know before sending whether they have authority).
3. Revisit permission levels — current ladder question<quick<impl<review<work-loop<plan doesn't fit
   real cross-project needs. Proposed minimal set mapped to omo task semantics:
   - question = info gathering, NO code/file writes (read-only subagent-style work / direct answer)
   - impl     = small task (omo "quick"-class subagent / small implementation fix)
   - plan     = full feature request (Prometheus plan + Atlas work-loop; any category/subagent)
   Model cross-project requests like internal omo tasks/subagents (a project can request e.g. a
   momus subagent or a sisyphus-jr category=quick task, but running in the TARGET project's session).
4. Adjust core omo agent + subagent/category prompts so project_message is a first-class part of
   the task flow and acceptance.
5. Testing must prove EVERY combination of config permission levels works as expected.
6. Agents must know if a target session is running/available to intake.
7. If a session isn't running, agents can ask the USER for permission to launch the target session.
8. TUI Mailbox at TOP of the sidebar stack, sorted ABOVE Magic Context.
9. TUI Mailbox in TWO columns: label (in/unread/done/out/pending/fail) left, count right.
10. (added) Point jsonc `$schema` at agent-harness schema; ensure schema covers project_message config params.

## Components ledger (each can pass/fail independently)
- C1 drain-root-cause-fix — the idle drain never fires in prod (see FINDING-1). status: open
- C2 permission-taxonomy — collapse ladder to 3 tiers + omo-task mapping + config/schema migration. status: open
- C3 reciprocal-visibility — sending agent learns its outbound budget per target before sending. status: open
- C4 session-presence+launch — detect target liveness; user-gated launch when absent. status: open
- C5 prompt-integration — project_message as first-class task flow in agent/category prompts. status: open
- C6 tui-layout — mailbox to top-above-MagicContext + two-column label/count. status: open
- C7 schema+config — $schema pointer + schema coverage; migrate 7+ project jsonc configs. status: open
- C8 test-matrix+live-e2e — permission-combination matrix + live evidence run. status: open

## FINDINGS (verified from source)
FINDING-1 (ROOT CAUSE — reframes atlas's analysis): the idle-drain hook NEVER fires in production.
  - `idle-drain-hook.ts:178` gates on `deps.resolveActivePrimaryAgent(sessionId)`.
  - `primary-resolver/resolver.ts`: `resolveActivePrimaryAgent` → `agentPrimaryCache.resolve()` → Map.get.
  - The cache is populated ONLY via `agentPrimaryCache.observe()`. Grep of all production src:
    `.observe(` / `agentPrimaryCache` appears ONLY in resolver.ts (definition), its barrel, and TESTS.
    There is NO production caller of `.observe()`. The README claims it is fed from chat.message/chat.params
    but that wiring was never added.
  - `chat-message.ts:95-96` calls `updateSessionAgent()` → writes `sessionAgentMap` in
    claude-code-session-state (a DIFFERENT store), NOT agentPrimaryCache.
  - Therefore `resolveActivePrimaryAgent` ALWAYS returns undefined → line 179 fail-closed early return →
    notes NEVER drain, in EVERY project. This explains cloudhome AND atlas both showing processed/ = 0.
  - FIX (candidate): make `resolveActivePrimaryAgent` read the already-populated `getSessionAgent`
    (claude-code-session-state), OR wire `agentPrimaryCache.observe()` into chat.message next to
    updateSessionAgent. Prefer eliminating the redundant parallel cache.

FINDING-2: envelope-less manual file drops (7 in cloudhome inbox) can never drain — `parseEnvelope`
  (envelope/schema.ts:41-49) throws on missing YAML frontmatter; `listUnread` swallows the throw and skips.
  These are permanently "unread". Separate from FINDING-1.

FINDING-3: outbox "pending" is unconfirmed-drained, not undelivered. `resolveOutboundAck`
  (mailbox-sidebar.ts:139) flips to read/fail only when target writes processed/ or rejected/.
  Because of FINDING-1 no target ever drains → nothing ever acks → all outbound stuck "pending".
  FINDING-1 fix cascades to fix this.

FINDING-4: intent ladder lives in 3 places that must stay in sync:
  - envelope MAILBOX_INTENTS (envelope/schema.ts:8) — also the send-tool arg enum.
  - validation INTENT_LADDER (validate-inbound.ts:5) + send-preflight withinBudget.
  - config SenderConfigSchema.intent_budget (config.ts:4) + generated assets schema enum.
  Existing project jsonc configs use `plan`/`impl`/`quick` today.

FINDING-5: TUI mailbox slot registered at order:900 (tui.ts:48 — bottom). Rendered LAST within the
  active/idle view (render-view.ts buildViewNodes → mailboxNodes appended last). Magic Context is an
  EXTERNAL plugin registering its own slot; cross-plugin ordering depends on OpenCode's slot sort — needs
  its order value discovered to guarantee "above MC". Two-column format: current mailboxLines
  (render-view.ts:299) emits single-line "in N unread N done" strings; needs label/count column layout.

FINDING-6: no existing per-project session-presence mechanism. `checkSessionExistence`
  (session-existence.ts) checks a sessionID via client within THE SAME process — not cross-project liveness.
  Cross-project presence needs a new heartbeat/presence file (e.g. ~/.omo/presence/<projectId>.json + TTL).

## Forks — RESOLVED (user answers + grounded spikes)
Q1 → "Sender names omo category, gated by tier." Sender specifies an omo category OR subagent_type;
     a category→required-tier map gates it against the receiver's granted ceiling for that sender.
Q2 → "Presence via OpenCode server API." SPIKE FINDING (see FINDING-7): pure server-API is not
     reachable cross-project without a discovery record, because each session binds an ephemeral
     per-session port with no shared registry. Adopt hybrid: sessions publish a presence record
     (projectId, serverUrl, sessionId, pid, heartbeat-ts) to ~/.omo/presence/<projectId>.json; the
     sender confirms LIVENESS by hitting that published server URL's API (the user's chosen mechanism),
     treating stale-file / no-API-answer as offline. Launch when absent = user-gated (ask the sending
     agent's user), then spawn headless server in target repo. No auto-launch.
Q3 → "Both: injected summary + probe tool." Passive outbound-budget table injected at session
     start/idle PLUS a read-only probe mode on the mailbox tool.
Q4 → "Primaries + shared task contract, but NOT Prometheus." Add cross-project flow text to
     Sisyphus, Atlas, Hephaestus + the shared delegate-task/category contract. EXCLUDE Prometheus
     (planner stays out of the send/intake acceptance loop; consistent with prometheus-md-only guard).

## Category → required-tier map (Q1 contract)
- question (read-only, no code/file writes): explore, librarian, oracle, metis, momus, + direct answer
- impl (small fix): quick, unspecified-low
- plan (full feature): deep, ultrabrain, unspecified-high, visual-engineering, artistry, writing,
                       + "prometheus-plan" / "atlas-work-loop"
Gate rule: requiredTier(requestedCategory) <= grantedCeiling(sender). Unknown category → reject.

FINDING-7 (SPIKE — Q2 server-API discovery gap): `getServerBaseUrl(client)` (shared/opencode-http-api.ts:49)
  reads only the CURRENT session's own baseUrl. `resolveServerUrl` (tmux-subagent) defaults to
  OPENCODE_PORT or 4096 — a guess, not a per-project lookup. There is NO cross-project port/URL registry.
  => server-API liveness REQUIRES a published presence record carrying each session's serverUrl. Hybrid
  above is the minimal design that satisfies the user's "server API" intent.
FINDING-8 (Q1 taxonomy): builtin categories = visual-engineering, ultrabrain, deep, artistry, quick,
  unspecified-low, unspecified-high, writing (config/schema/categories.ts:30). Subagent_types add
  explore/librarian/oracle/metis/momus. The map above covers both surfaces.

## Locked (from user, not asking)
- Test strategy: TDD + full permission-combination integration matrix + LIVE e2e with recorded evidence
  under .omo/evidence/ (user rule: "project isn't done until a live test is completed in evidence").
- $schema pointer → agent-harness assets/oh-my-opencode.schema.json (already partly done in this repo's config).
- TUI: top-above-MagicContext + two-column label/count (exact copy given).


## LAUNCH POLICY (user-approved — flag 2 resolution)
New config/session flag `launch_policy`, SENDER-side, modeled on the .env-permission ask mechanism.
THREE states:
- "disabled" (DEFAULT = "not allowed"): send-only; the agent can NEVER launch the target session and
  NEVER stops to ask the user. Offline target → message "queued for next idle drain".
- "ask": agent may prompt the user via the OpenCode permission surface (same as .env-var permission)
  for approval to launch an inactive target session; on approval → spawn headless server in target repo.
- "auto": auto-allow launch; never asks; launches the target session directly.
Settable per-project in config AND overridable as a session flag. This is the SENDING project's
authority to launch OTHERS (not a receiver opt-in).
Reference pattern: env-permission allowlist at
packages/claude-code-compat-core/src/features/claude-code-mcp-loader/configure-allowed-env-vars.ts
and applyMcpEnvAllowlist (hooks/claude-code-hooks/config.ts:174).

## Flag 1 (config migration) — APPROVED
Collapse intent_budget quick→impl with a back-compat alias so existing configs don't hard-fail.

status: approved — proceed to scaffold + Metis + plan generation


## METIS RESOLUTIONS (20 findings folded)
- M1/C1: getSessionAgent stores normalizeStoredAgentName (NOT config key). Drain fix MUST canonicalize
  via getAgentConfigKey before comparing to intake_eligible_agents. Reuse resolveRegisteredAgentName
  (state.ts:55) which already does config-key resolution. Tests: config-key, display-name, legacy
  parenthesized "Sisyphus (Ultraworker)", custom display name.
- M2/M3/C2: full legacy intent map (not just quick→impl): quick→impl, review→plan, work-loop→plan.
  Keep legacy intent parsing at the ENVELOPE boundary (parseEnvelope accepts 6 legacy values) and
  canonicalize to 3-tier AFTER parse, so old queued notes are never stranded. Never shrink
  MAILBOX_INTENTS enum at the parse gate.
- M4/M5/C2: transport contract — ADD optional `category` to envelope + tool schema. Two source-of-truth
  maps keyed by REAL schema names only: CATEGORY_TIER (builtin categories → tier) + AGENT_TIER
  (subagent_types → tier). Drop pseudo-names direct-answer/prometheus-plan/atlas-work-loop from schema;
  they are conceptual (map to the tier directly). intent = derived/declared tier (the ceiling unit);
  category = optional richer subject. Gate: requiredTier(category ?? intent) <= grantedCeiling(sender).
  Unknown category/agent → reject.
- M6/C3: outbound preflight is ADVISORY (sender-local view); target-side inbound validation stays
  AUTHORITATIVE. C3 table reads sender-local allowlist + registry presence, labeled "advisory".
  Acceptance must still prove target-side rejection works even when sender's advisory view disagrees.
- M7/M8/C4 presence: define TTL (default 30s), heartbeat interval (10s), atomic write (tmp+rename),
  file mode 0600, multi-session conflict = last-writer-wins on same projectId, cleanup on dispose +
  stale-file ignore. Record fields: projectId, repoRoot, serverUrl, sessionId, pid, heartbeatTs.
  Liveness = fresh file AND serverUrl API answers session.get for sessionId within timeout(2s).
- M9/C4 launch: permission via injected callback (pattern: monitor/permission.ts bashPermissionAsk),
  NOT direct config read. Tests: disabled(send-only), ask-deny, ask-allow, auto — all with injected
  fake permission fn, no real user config.
- M10/C4: launch is its OWN wave, isolated; presence-only path works without launch. launch_policy
  default "disabled".
- M11/M12/C6: mailbox becomes its OWN sidebar slot (currently a section inside omo slot order:900).
  New slot order < 200 (magic-context DEFAULT_SLOT_ORDER=200) — use 150. Add slot-order test with a
  mocked external slot at 200 asserting mailbox sorts above it.
- M13/M14/C7: in-repo dev configs → local file schema (auto-provision.ts already points at
  agent-harness assets path); EXTERNAL project configs → remote schema URL (portable). Migration wave
  lists exact config paths + backup + rollback; do NOT rewrite external-machine paths into portables' configs.
- M15/C8: live e2e names exact commands + evidence paths: unit matrix cmd, isolated opencode-qa live
  session (XDG sandbox), before/after mailbox files, TUI screenshot/log, drain-fired SSE proof,
  .omo/evidence/<date>-project-message-iteration/summary.md.
- M16/C3: cap outbound table (max targets, sorted), redact nothing sensitive (only ceilings/presence),
  inject-only-when-changed to avoid prompt bloat.
- M17/C5: remove prometheus-plan from taxonomy schema (conceptual only) — resolves the "exclude
  Prometheus in C5 but name prometheus-plan in C2" contradiction.
- M18/M19/M20/C6+C8: two-column TUI exact-label snapshot tests (active/idle/collapsed/all-zero/
  inbound-only/outbound-fail); define "done" label semantics (processed-on-disk); body-size tests use
  Buffer.byteLength utf8 (Korean/emoji), not string length.
