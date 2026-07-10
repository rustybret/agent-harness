---
slug: mailbox-internal-external-mode
status: plan-written-awaiting-delivery-choice
pending-action: user picks start-work vs dual high-accuracy review
intent: CLEAR
classify: Architecture (multi-module, cross-repo-aware, long-term)
---

# Draft: mailbox internal/external mode detection + directory-scoped presence probe

## Request (verbatim intent)
Adapt mailbox functional behavior to broad opencode conventions:
- plain `opencode` / `opencode --continue` (no port) = INTERNAL session, presence-aware mailbox disabled.
- `opencode serve` / `opencode web` / `opencode --continue --port N` = EXTERNAL session, project mailbox enabled.
Fix the presence probe to: (1) pass the directory with the probe (concern #2), (2) detect that the project/SESSION is alive/idle, not just the server (concern #3). Internal sessions get an ALTERNATE toolset for sharing non-interactive docs (resembles the old drop-a-note-into-coordination_notes + filewatcher model). Log when the mailbox detects internal/external on start/resume/change to aid test+validation.

## Approved decisions (user, this session)
- **1A**: Separate `project_note` doc-drop tool exposed in internal mode; presence-aware `project_message` hidden/gated there.
- **2A**: Internal-mode presence record written but marked `mode:"internal"` (null serverUrl) so peers' outbound-budget shows a distinct "internal / doc-drop only" state.
- **3A**: Internal sessions STILL idle-drain their own inbox (receiving is full-duplex); only presence-publishing + live-send-awareness gated off.
- **Test strategy**: TDD + live e2e with recorded evidence under `.omo/evidence/`. OpenRouter FREE models only. Live test sessions run against an ALTERNATE opencode.db (OPENCODE_DB / isolated XDG) and a DIFFERENT project dir so agent-harness session list is not polluted.

## Grounded facts (paths in agent-harness unless noted)
- Broken probe: presence/presence-reader.ts:46 `defaultProbeSession` — GET `${serverUrl}/session/${sessionId}`, Authorization only, no directory, 200==live.
- Directory routing (opencode): workspace-routing.ts:87 reads `?directory=` OR `x-opencode-directory` header.
- Session activity (opencode): GET /session/status -> map sessionId->{type}. Helper packages/utils/src/session-idle-settle.ts:49 `isSessionActive` treats type in {busy,retry,running} as active.
- serverUrl resolution: hooks/create-mailbox-hooks.ts:128 `ctx.serverUrl ?? getServerBaseUrl(client)`; internal -> placeholder http://localhost:4096 (AMBIGUOUS with real serve on 4096 -> must self-probe).
- Tool gate: plugin/tool-registry-mailbox-tools.ts:18 registers project_message sync on config.enabled. Mode detection async -> split enforced at EXECUTION, not registration.
- Heartbeat: presence/presence-heartbeat-hook.ts fired from event.ts:83,155 on session.created + idle. PresenceRecord {projectId,repoRoot,serverUrl,sessionId,pid,heartbeatTs}.
- Old delivery model = file-drop into target coordination_notes/<fromId>/<msgId>.md + receiver idle-drain. project_note reuses this.

## Approach (approved)
1. Fix probe: send directory (query + header) and gate "live" on /session/status active type for our sessionId.
2. Mode detection: self-probe own serverUrl w/ directory on session-active; reachable + our session present => external else internal; cache + re-eval on resume.
3. External: heartbeat ON (real url), presence-aware project_message ON.
4. Internal: project_message send gated OFF; project_note doc-drop ON (fire-and-forget file write); still idle-drain inbox.
5. Presence record carries mode; reader/outbound-budget/TUI handle mode:"internal".
6. Log detection on start/resume/transition.

## Gate
User approved 1A/2A/3A + test strategy at msg §4490§. Past gate -> writing plan. Metis dispatched (bg_32d49b2a).

## Open verification (fold Metis)
- async detection vs sync registration contradiction
- 4096 placeholder disambiguation via self-probe
- mode-change mid-session / slow first probe race
- PresenceRecord schema change blast radius (reader, outbound-budget injector, TUI sidebar)
- project_note guard parity (allowlist/intent/hop/rate-limit) vs intentionally-lighter
- presence-reader treatment of mode:"internal" (new status?)
- test-isolation leak surface
