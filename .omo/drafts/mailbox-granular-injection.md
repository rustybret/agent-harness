---
slug: mailbox-granular-injection
status: review-approved
intent: clear
review_required: true
pending-action: handoff delivered; awaiting user start decision
review_round_id: rr-20260802-mgi-02
round_status: active
round_1: REVISE x2 (momus: interrupt trigger contradiction; oracle: detached worker hole, e2e server mode, dep matrix, ack tradeoff) — all fixed in plan; round-1 sha 8fa973e1be60786502c6591eb9bcd25792746372a48686a39f18e528dd84f98f superseded by plan edits
plan_path: .omo/plans/mailbox-granular-injection.md
plan_sha256: 791dcb2254266841ec849c97cc4ee0f651d2d42d9cb51236bd1e8d3c2ef645f9 (dual-echo identical from both round-2 lanes)
review:
  momus: { status: approved, workspace_root: /Volumes/Topper2TB/Git/agent-harness, runtime_home: null, target: .omo/plans/mailbox-granular-injection.md, round_id: rr-20260802-mgi-02, launch_id: launch-mgi-momus-02, session: ses_03c7f6ac9ffeRSOG1WjKyAlOrb, bg: bg_e480ff52, result: OKAY, sha256: 791dcb2254266841ec849c97cc4ee0f651d2d42d9cb51236bd1e8d3c2ef645f9 }
  independent: { status: approved, workspace_root: /Volumes/Topper2TB/Git/agent-harness, runtime_home: null, target: .omo/plans/mailbox-granular-injection.md, round_id: rr-20260802-mgi-02, launch_id: launch-mgi-oracle-02, session: ses_03c7f4904ffef2VhRlXFjcT1jW, bg: bg_b00a44df, result: OKAY, sha256: 791dcb2254266841ec849c97cc4ee0f651d2d42d9cb51236bd1e8d3c2ef645f9 }
fix_retry_summary: round 1 REVISE x2 -> 5 fixes applied (drain-now trigger, worker watchdog+wrapper, e2e server mode, dep matrix, ack tradeoff doc) -> round 2 OKAY x2 on identical digest.
approach: Additive envelope requested_mode (advisory, receiver-authoritative) + deterministic intake router with 5 fulfillment lanes (side-session Q&A, todo-inject, subagent, worker-PR, safe interrupt) + cipher-relay e2e harness; TDD throughout; orchestrator/dedicated-intake-agent deferred to roadmap.
---

# Draft: mailbox-granular-injection

## Components (topology ledger)
<!-- id | outcome (one line) | status | evidence -->
- C1 | New delivery-mode vocabulary on the wire: extend envelope so sender can request HOW the note is handled (answer-in-side-session, inject-todo, subagent-task, worker-PR, interrupt), not just intent tier | active | envelope/schema.ts:10-28 (MAILBOX_INTENTS only)
- C2 | Side-session Q&A: answer `question` notes in a throwaway/forked session (or remote cloudhome session) without touching the main session | active | needs session-create surface map (bg_07cf943d)
- C3 | Live-worklist injection: append/prioritize a todo in the ACTIVE session's todo list from an inbound note (append vs next) | active | needs todo-manipulation surface map (bg_07cf943d)
- C4 | Subagent fulfillment: note handled by 1-2 background subagents (investigate+implement) without occupying the main turn | active | delegate-task/background-agent surfaces
- C5 | Worker-PR (ultrabot) mode: headless session implements in a worktree/checkout and submits a PR; main session intakes/reviews | active | launch/launch-target.ts (spawn exists, opencode --headless), cloudhome ultrabot memories #1983
- C6 | Intake routing/orchestration: hook/tool/skill that classifies inbound notes to modes and delegates; today triage is a static prompt (triage/template.ts + constants.ts INTENT_GUIDANCE) | active | triage/*
- C7 | Interrupt path: implement declared-only interrupt_policy (allow-interrupt) for urgent plan-correction notes | active | config.ts:44-47 (stub)

## Open assumptions (announced defaults)
<!-- user asked to be interviewed: adopt-default filter OFF; every surviving fork is ASKED -->

## Findings (cited - path:lines)
- Envelope: version 1, strict zod, intent enum of 6 legacy values canonicalized to 3 tiers (question/impl/plan) — envelope/schema.ts, permission-tiers.ts. Adding fields = version bump or additive-optional.
- Send path: project_message tool → registry lookup (~/.omo/project-registry.json, ProjectRegistry) → preflight (budget) → maybeLaunchOfflineTarget → MailboxStore.writeNote into TARGET repo's coordination_notes/<senderId>/ → outbox log. send-tool/project-message-tool.ts.
- launch_policy exists and launchTargetSession spawns `opencode --headless` in target repo (launch/launch-target.ts:10) — default disabled; this is the seed of the "launch a worker" capability but it launches a plain headless session, no task payload.
- Receive path: idle-drain hook (session.idle + heartbeat 10s poller per memory #1820) reserves → validates → builds STATIC triage prompt (triage/template.ts) → dispatchInternalPrompt(queueBehavior: defer) into MAIN session. hooks/idle-drain-hook.ts.
- Manual path: project_mailbox_peek/drain tools return notes synchronously as tool output in the CURRENT turn. manual-drain/index.ts. NOTE: peek uses store.drainUnread(MAX_SAFE_INTEGER) — peek is how mid-session intake currently works (memory #1911: used to bypass todo-continuation deadlock).
- interrupt_policy: 'allow-interrupt' and 'block-idle-input' are declared-only stubs (config.ts:44-47).
- INTENT_GUIDANCE already tells receiving Sisyphus to delegate via task()/oracle/atlas per intent (triage/constants.ts) — i.e., C4 partially exists as prompt-guidance only, unenforced, and blocked when main session never idles.
- Mode detection: listener-registry ground truth; internal TUI sessions have mailbox disabled (presence/mode-detector.ts; memory #1747).
- Known operational pain (memories): #2318 ebayBo idle-drain misses idle transition edge → notes sit; #1911 todo-continuation deadlock prevents idle → manual peek needed; #1745 idle-eviction race on /session/status.
- External-inject bridge exists: 127.0.0.1 loopback listener + port file <XDG_DATA_HOME>/oh-my-opencode/external-inject/rpc/<projectId>/ports/<instanceId>.json, token-auth, routes to dispatchInternalPrompt (#2095, #2129, #2174, #2101). This is a second injection route usable for near-real-time delivery to a live session.
- Prompt-async-gate: all session injections must route through dispatchInternalPrompt (packages/utils/src/prompt-async-gate.ts); audit requires inline object literal with queueBehavior (#2094, #584).
- Explorer map (bg_e705e66d) confirms: project_note = internal-mode fire-and-forget send (no presence check/launch); project_message = external-mode with presence + launch. Notes land at <targetRepoRoot>/coordination_notes/<fromProjectId>/<messageId>.md (atomic tmp+rename). Pending states dispatch_sent/history_confirmed in coordination_notes/.pending.json. Presence record ~/.omo/presence/<projectId>.json every 10s (projectId, repoRoot, mode, serverUrl, sessionId, pid, heartbeatTs). Mode ground truth = host listener registry ~/.local/state/opencode/instances/<pid>.json.
- Session-creation surface: background-agent spawner (features/background-agent/spawner.ts startTask) creates subagent sessions via client.session.create({ parentID }) — in-plugin, needs client + parentSessionId + directory. This is the natural base for side-session Q&A (C2) and subagent fulfillment (C4).
- Injection surfaces: dispatchInternalPrompt (shared/prompt-async-gate.ts, only sanctioned route) + external-inject bridge (features/external-inject/handler.ts createRequestRouter, port-file.ts writePortFile/parsePortFileRecord; loopback HTTP /rpc/ with token auth, maxTextBytes cap) — external processes can inject into a live session.
- Todo surfaces: client.session.todo({ path: { id: sessionID } }) SDK API exists (tools/session-manager/sdk-storage.ts, hooks/compaction-todo-preserver/hook.ts read todos). Write path via SDK needs verification during implementation. Boulder-state (packages/boulder-state: readBoulderState/writeBoulderState/addBoulderWork/getPlanProgress) is file-based under .omo/ and externally writable — candidate for durable todo-injection that survives sessions.
- Cross-project surveys dispatched 2026-08-02 to cloudhome, art3d-pipeline, opencode-gemini, unitySuperMCP (msg ids 2ccf6f65, 7541ca49, 003fc8b4, 2ea82092) asking for pain points; replies pending.

## Decisions (with rationale)
- D1 (Q1): Mode authority = sender REQUESTS, receiver DECIDES (advisory `requested_mode`, receiver may downgrade per local policy). Future evolution (roadmap note in plan, NOT in scope): once an orchestrator exists, sender requests → orchestrator decides → receiver follows commands. Wire field must be designed so the orchestrator phase is additive.
- D2 (Q2): Intake router = deterministic hook routing on requested_mode/intent + small classifier subagent only for ambiguous notes. Dedicated intake agent (b) is roadmap, not this plan.
- D3 (Q3): Scope = ALL of C1–C7. C7 interrupt = SAFE semantics only: external-inject-bridge priority injection + todo-prepend; NO mid-turn abort/steering of OpenCode internals.
- D4 (Q4): TDD for all modules + a NEW component C8: cipher-relay e2e harness. Design (user-specified): N test agent-session projects; each project i gets a private number→word cipher file covering numbers [10i, 10i+9] readable ONLY by that agent; a sentence string containing 10 numbers is passed agent→agent via the mailbox; each agent substitutes its numbers' words and forwards; test passes when the arbiter script receives the fully-substituted correct sentence within a time limit. Trivially easy per-agent task by design — the e2e proves the MULTI-AGENT HANDOFF chain (send→drain→fulfill→forward) is reliable, not model intelligence. Per memory #1746: e2e targets use sandbox projects (e.g. /Volumes/Topper2TB/Git/omo-finetune pattern), OpenRouter free models, alternate opencode DB — never the real agent-harness session state.
- D5 (Q5): C2 substrate routing = (a) fresh child session via client.session.create({parentID}) when local presence is up; (c) cloudhome-hosted session on current checkout when NO local server/session is active on the peer AND the question is not about in-flight local work. INTERPRETATION NOTE for gate: user wrote 'a and b' but the qualifier sentence describes a+c; recorded as a+c — fork-of-main-session (b) EXCLUDED unless user corrects at the gate.
- D6 (Q6): C5 = option c. Local headless worktree worker is the default substrate (extends launchTargetSession + work-with-pr conventions); PLUS a declared worker=cloudhome variant where agent-harness ships only the request/PR-intake contract side and actual execution is delegated to cloudhome (cross-project coordination item, routed via project_message per memory #2010).

## Scope IN

## Scope OUT (Must NOT have)

## Open questions
All rounds resolved (D1–D6). One interpretation flagged at gate: D5 'a and b' vs a+c reading.

## Scope IN
- C1 wire vocabulary: additive-optional `requested_mode` on envelope (advisory; receiver authoritative; designed so a future orchestrator can issue binding modes)
- C2 side-session Q&A: fresh child session (local presence up) / cloudhome-hosted request contract (no local presence + not in-flight-local question)
- C3 live-worklist injection: todo-append and todo-next via SDK todo API (verify write path) with boulder-state durable fallback
- C4 subagent fulfillment: single subagent or investigate+implement pair via existing task/background-agent surfaces, no main-turn occupation
- C5 worker-PR: local headless worktree worker default + declared cloudhome variant (request/PR-intake side only)
- C6 intake router: deterministic hook routing + classifier subagent for ambiguity; replaces static-triage-only path
- C7 safe interrupt: external-inject bridge priority injection + todo-prepend
- C8 cipher-relay e2e harness + arbiter script (sandboxed projects, free models, alternate DB)
- Receiver-side config additions (per-sender mode budget / downgrade policy), schema + docs

## Scope OUT (Must NOT have)
- No orchestrator implementation (roadmap only); no dedicated intake agent (roadmap only)
- No mid-turn abort/steering of a live OpenCode turn; no raw session.prompt/promptAsync outside dispatchInternalPrompt gate
- No cloudhome-side implementation (only the contract/intake half in this repo; cloudhome work delegated via project_message)
- No openclaw orchestrator integration in the critical path
- No breaking change to envelope v1 peers (requested_mode must be additive-optional; old receivers ignore it)
- No MVP/scope reduction of C1–C8

## Approval gate
status: approved 2026-08-02 (user: "approve"); plan written to .omo/plans/mailbox-granular-injection.md (16 todos, F1-F4). Metis findings (ses_03c97af87ffe) folded in: strict-schema compat fix (task 1 tolerant parse), send-surface args (task 3), canonical mode enum, mode budget schema (task 2), reply-threading ack ordering (task 6), worker-PR contract gap (task 9), interrupt=queue-jump definition (task 10), manual-drain surfacing (task 12), todo write spike (task 5), cloudhome pending contract (task 11), e2e executable constraints N=3/15min (task 15), effective_mode audit fields (tasks 3/12).
survey-note: replies from cloudhome/art3d/opencode-gemini/unitySuperMCP fold in as risk/priority input when they arrive; not blockers.
