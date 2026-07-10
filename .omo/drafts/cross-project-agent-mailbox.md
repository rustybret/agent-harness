# Draft: cross-project-agent-mailbox

status: awaiting-approval
pending-action: write .omo/plans/cross-project-agent-mailbox.md
intent-route: CLEAR (user owns outcome; forks resolved through interview + code-grounded feasibility)
classify: Architecture (system design, new feature module, cross-repo, TUI surface, long-term)

## Request (verbatim intent)
Build a cross-project agent communication protocol — a more rigorous successor to the ad-hoc `coordination_notes/` handoff. Per-project file mailbox: an outside agent writes a message into the TARGET project's directory only (project1 -> project2 writes `/<project2>/coordination_notes/project1/note.md`). project2 detects the new/changed note via existing file-change tracking and addresses it on a priority stack (is the user mid-task, request size/timeliness, etc). Communication should feel like team_mode inbox messaging — "a multi-project ultrateam mode." Stated unknowns: how to bound agent activity, poll cadence, how to manage switching between Sisyphus/Hephaestus/Atlas/Prometheus, while preserving magic-context's single-session-per-project + single-active-session-per-repo policy.

## Grounding findings (code-cited)
- Proven, GATED wake path already exists: `packages/omo-opencode/src/hooks/team-session-events/team-idle-wake-hint.ts` wakes an idle session on inbound mail via `dispatchInternalPrompt`.
- Mandatory injection gate is omo-internal: `packages/utils/src/prompt-async-gate.ts` (re-exported `packages/omo-opencode/src/shared/prompt-async-gate.ts`). `packages/omo-opencode` is `private:true`, NO `exports` field; `index.ts` exposes only `pluginModule` + config types. => a standalone plugin CANNOT reach the gate and would double-inject by colliding with omo idle hooks. (memory 584)
- team_mode envelope to clone: `packages/team-core/src/types.ts` `MessageSchema` { version, messageId, from, to, kind, body<=32KB, summary, references[{path,description}], timestamp, correlationId, color }. Storage: per-message JSON under `~/.omo/runtime/{teamRunId}/inboxes/{member}/`, `.delivering-` reservation file, `processed/` ack-move. Unread = file present + id not in `pendingInjectedMessageIds`. Backpressure at `recipient_unread_max_bytes` (256KB). Poll loop: `packages/team-core/src/team-mailbox/poll.ts` `pollAndBuildInjection`.
- team_mode bounds: `max_member_turns` + `max_messages_per_run` are DEFINED but NOT enforced in runtime code (only schema/tests) — ours must actually enforce. `max_parallel_members`/`max_wall_clock_minutes` enforced in `team-runtime/create.ts`.
- In-TUI sidebar IS achievable by omo plugin: `packages/omo-opencode/src/tui.ts` registers `sidebar_content` slot (`TuiPluginModule`, @opencode-ai/plugin/tui, SolidJS); existing renderer `packages/omo-opencode/src/features/tui-sidebar/` (compute-view.ts, element-helpers.ts). Toasts: `client.tui.showToast`. team_mode tmux visualization is EXTERNAL (spawns tmux windows via `packages/tmux-core` window-spawn/pane-spawn) — not in-TUI.
- magic-context single-session policy: reads opencode `opencode.global.dat` -> `state["layout.page"].lastProjectSession[<repoPath>].id`; tracks in `~/.local/share/cortexkit/magic-context/context.db` (`session_projects`, `compartment_state_lease`). So "project2's agent" = the single live session for project2's repo (may be mid-task).
- Primary-agent model (decisive for Fork 3): plugin can READ active agent (`plugin-interface.ts:40-47` chat.params, `plugin/chat-message.ts:95-97`) but CANNOT switch a live session's primary — no `client.session.update/set/patch` or agent-mutation API exists. Primary is user-only (Tab / --agent). Injecting via promptAsync CAN target an agent only when spawning a NEW child session (`features/background-agent/spawner/task-prompt-body.ts:39-63` sets `agent` in body), never re-skins the live parent. Delegation mechanisms: foreground subagent `tools/delegate-task/sync-task.ts`; background agent `tools/delegate-task/background-task.ts` -> `features/background-agent/manager.ts`.
- OpenClaw (v2 substrate, NOT v1): one global daemon/machine, cross-repo registry `reply-session-registry.jsonl` (projectPath+sessionId+tmuxPaneId), send-keys into any pane. Missing for orchestrator role: query-by-project, wake-specific-repo, spawn-session-if-none, orchestration logic.
- Existing coordination_notes today: FLAT `coordination_notes/` at repo root, no per-source subfolders, no auto-detection; codified only in `docs/reference/agent-harness-fork-customizations-roadmap.md`. Real files on disk exist. Non-destructive revision convention (filename suffix) per memory 1247.

## Resolved decisions (forks)
- FORK 1 = first-class omo feature module (NOT standalone). CONFIRMED: all repos run same omo/opencode/plugins (user, §1082), so omo-only is locked. Reasons: gate unreachable from standalone (double-inject), in-TUI sidebar reachable only via omo TUI module. Mitigations for upstream-overlap survival + auditable separation: single self-contained feature dir; config flag default OFF; wire format = plain on-disk files (coordination_notes envelope) depending on ZERO opencode internals, so it stays portable if disabled.

## Agent-capability facts (code-cited, decide Fork 3 handling)
- Core primary `.mode`: sisyphus, hephaestus, atlas, prometheus ALL = primary (agents/AGENTS.md modes table). Subagents: oracle, librarian, explore, multimodal-looker, metis, momus, sisyphus-junior.
- task() delegation block: `COORDINATOR_AGENT_NAMES = ["prometheus"]` + `isCoordinatorAgent` (tools/delegate-task/constants.ts:403-413). ONLY prometheus is blocked as a task() subagent_type target. Comment is explicit: sisyphus + atlas are `verdict:"eligible"` and deliberately NOT blocked.
- => Sisyphus CAN spawn Atlas and Hephaestus via task(); Sisyphus CANNOT spawn Prometheus via task() (coordinator block, "duplicate orchestration" issue #4027). User's assumption ("sisyphus can't spawn atlas") is FALSE; the truly-unspawnable one is Prometheus.
- Atlas: mode=primary (todo-loop designed for Atlas-as-primary) BUT also delegatable as a child via task(). So not exclusively-primary.
- Spawn-with-agent body builder `features/background-agent/spawner/task-prompt-body.ts` `buildTaskPromptBody({agent,...})` sets `agent` with NO per-name validation at the body layer; the coordinator guard lives at the resolver/preflight layer (subagent-resolver -> validateSubagentRequest). Injecting into a LIVE session (dispatchInternalPrompt) does NOT let you override the live primary; only spawning a NEW child session can target an agent.
- CONSEQUENCE for design: a `prometheus-plan`-tier inbound intent CANNOT auto-spawn Prometheus in v1 (coordinator-blocked). v1 handling of plan-tier = eligible primary (Sisyphus) plans inline OR surfaces it for the user to run Prometheus; full auto-Prometheus = v2 orchestrator (dedicated primary session).
- FORK 2 = idle-drain for v1. Add config enum `interrupt_policy` default `idle-drain`; declared-but-unimplemented future values `allow-interrupt` / `block-idle-input` (the state machine the user described). Preempt/orchestrator variant = v2 on OpenClaw + 4 gaps.
- FORK 3 = 3A + INTAKE-ELIGIBILITY GATE (user refinement §1079). B is IMPOSSIBLE (no primary-swap API). NOT blindly primary-agnostic: a config `intake_eligible_agents` (default `["sisyphus"]`) lists which PRIMARY agents may intake inbound notes. When the active+idle primary is on the list, drain proceeds; when it is NOT (user tabbed to Prometheus mid-plan / Atlas mid-work-loop / Hephaestus mid-refactor), the idle-drain is SUPPRESSED and the note stays QUEUED until an eligible primary is the active+idle session. This both (a) protects a focused agent from being waylaid while the user is away, and (b) cleanly answers "what if user tabs to an unexpected agent" = intake suppressed, note waits. Handling by the eligible primary = native delegation per `intent`: quick/impl/review/question -> task() (categories or eligible subagents incl. atlas/hephaestus); plan-tier -> NOT auto-spawnable (Prometheus coordinator-blocked) so v1 = inline-plan-by-Sisyphus OR surface-to-user. The note itself is NEVER a spawn — it is a prompt injected into the live eligible session.
- FORK 4 = project-level config, TWO axes:
  (a) ACCESS allowlist: `allow-all` / `allow-none` / enumerated allowlist. Allowlist ideally AUTO-DISCOVERED + auto-maintained list of opencode projects, sorted recency-then-alphabetical.
  (b) INTENT BUDGET / ceiling (user refinement §1079): per sender-project max intent tier, e.g. `quick` only ... up to `prometheus-plan`. Inbound notes whose intent exceeds the ceiling are rejected/downgraded. Ladder (low->high): question < quick < impl < review < work-loop < plan.
  Ping-pong defense (strong, user is "definitely concerned"): `correlationId` hop counter (hard cap, drop on exceed) + per-drain max-notes cap + same-pair rate limit + no auto-reply without explicit agent action + loop-detection on identical bodies.
- TEST STRATEGY = TDD + integration test-suite + human-monitored e2e using real project tasks. (QA via opencode-qa skill, evidence under .omo/evidence/, memory 573.)

## Defaults adopted (reversible internals)
- Envelope = team-core MessageSchema clone + `fromProject`/`toProject` + `intent` + `priority`. On-disk: `<target>/coordination_notes/<source-project>/<id>.md`, YAML front-matter + Markdown body, new file per message, suffix-revisions never in-place (memory 1247).
- Detection = check-on-idle drain at each `session.idle`; no polling daemon; optional debounced fs.watch only to nudge an idle-quiet session. (Dissolves "how often to poll".)
- Project discovery/addressing = `~/.omo/project-registry.json` (or reuse OpenClaw registry data) name->repo-root, recency+alpha.
- TUI = new section in EXISTING omo sidebar (`features/tui-sidebar/`), not a new surface.

## Open confirmations before plan generation
1. Confirm the all-repos-run-omo assumption (else Fork 1 flips to standalone).
2. (already answered) test strategy.

## Approval brief presented: yes (this turn)
## Next on approval: run scaffold-plan.mjs cross-project-agent-mailbox --clear, mandatory Metis, append todos, fill TL;DR last, then dual high-accuracy review per delivery question.

## Approval gate
status: PLAN-GENERATED (user §1098 "approve"). Plan written to .omo/plans/cross-project-agent-mailbox.md: 8 template headers in order, 14 todos / 5 waves + F1-F4 + human e2e, Metis (22 findings) folded in. Awaiting delivery decision: start-work now vs dual high-accuracy review (native momus + Codex gpt-5.5 xhigh) first. NOT authorized to implement — execution belongs to worker on explicit $start-work.
