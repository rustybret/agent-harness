# Cross-Project Mailbox Runbook & Configuration Reference

The Cross-Project Mailbox is an OmO feature that enables independent OpenCode repositories and agent sessions to coordinate asynchronously. It utilizes a file-based, atomic message-passing protocol to deliver structured notes across boundaries, gated by customizable trust policies and loop-prevention guards.

---

## Architecture Overview

```
[Source Repository]
   │
   ├── (Agent calls project_message tool)
   ▼
[Target Repository]
   ├── coordination_notes/
   │   └── <source-projectId>/
   │       ├── <uuid>.md         <-- Active Note (frontmatter + markdown body)
   │       ├── processed/
   │       │   └── <uuid>.md     <-- Handled Notes (archived on drain)
   │       └── rejected/
   │           ├── <uuid>.md     <-- Quarantine (failed validation)
   │           └── <uuid>.reason.json <-- Audit trail (rejection details)
```

### Key Subsystems
1. **Registry (`~/.omo/project-registry.json`)**: A local registry of explicitly enrolled repositories, mapping unique 8-character `projectId` tags to absolute filesystem paths.
2. **MailboxStore**: Manages message states (reservation, confirmation, quarantine, stale reclamation) via atomic filesystem locks to prevent race conditions.
3. **Idle-Drain Hook**: Injected into `session.idle` events. It checks incoming notes in `coordination_notes/` when the session becomes idle, then sequentially drains eligible messages into the active prompt stream via `dispatchInternalPrompt`.
4. **Manual Receive Tools (`project_mailbox_peek`, `project_mailbox_drain`)**: Let agents inspect or consume inbound notes on demand when work cannot wait for a `session.idle` edge.
5. **Project Message Tool (`project_message`)**: Surfaced to agents to send intent-budgeted, preflight-checked, envelope-wrapped notes to target repositories.

---

## Configuration Reference

Configure the mailbox by adding the `cross_project_mailbox` block to your user config (`~/.config/opencode/oh-my-openagent.jsonc`) or project-level config (`.opencode/oh-my-openagent.jsonc`).

```jsonc
{
  "cross_project_mailbox": {
    // 1. Feature Toggle
    "enabled": false, // Default is false. Set to true to activate.

    // 2. Intake Policy
    "intake_eligible_agents": ["sisyphus"], // Only idle sessions running these primaries will ingest notes.
    "interrupt_policy": "idle-drain", // Inbound notes are queued and delivered during idle transitions.

    // 3. Sender Trust Settings
    "default_sender_access": "allow-none", // "allow-all" or "allow-none". Gated default for unconfigured projects.
    "senders": {
      "abc12345": {
        "access": "allow", // "allow" or "deny" access to deliver to this mailbox
        "intent_budget": "impl", // Maximum intent permitted: "question" | "impl" | "plan"
        "allowed_modes": ["todo-append", "subagent"], // Optional. Allowlist of requested_mode lanes this sender may use. Absent = every mode whose tier fits intent_budget is implicitly allowed.
        "worker_pr_variant": "local" // Optional. Substrate for this sender's worker-pr notes: "local" (default, headless worktree worker) | "cloudhome" (delegate execution to cloudhome).
      }
    },

    // 4. Concurrency & Safety Bounds
    "bounds": {
      "max_hops": 4, // Drop messages traversing more than 4 forward hops (loop prevention)
      "max_notes_per_drain": 5, // Maximum notes processed per idle transition
      "same_pair_rate_limit_per_min": 6, // Throttle limit between a source and target repository
      "body_digest_ttl_min": 60, // Duration to retain body hashes to suppress duplicate delivery
      "max_body_bytes": 32768, // Body size ceiling (default: 32KB)
      "reservation_ttl_ms": 120000 // Milliseconds a note reservation is locked before auto-reclaiming (2 minutes)
    }
  }
}
```

---

## SURFACING THE TOOL: User Setup Guide

Follow this runbook to enable cross-project coordination across your local workspace.

### Step 1: Explicit Project Registration
Repositories must be registered deliberately so other repositories can locate them. Starting OpenCode in a repository does not add it to the global registry.

#### Option A: Import from OpenClaw
If running the OpenClaw reply listener daemon, explicitly import its known projects:
```ts
await registry.discoverFromOpenClaw("/path/to/openclaw/sessions.jsonl");
```

#### Option B: Manual Registration
Register only the repository roots that should participate:
```ts
await registry.registerProject("/absolute/path/to/repository");
```
Check the registered projects list by inspecting `~/.omo/project-registry.json`.

---

### Step 2: Configure Allowlists & Budgets
By default, the mailbox rejects deliveries from unconfigured sources. You must authorize sender repositories.

1. Locate the sender project's ID in `~/.omo/project-registry.json` (e.g., `"projectId": "xyz98765"`).
2. Add the sender to the destination project's `.opencode/oh-my-openagent.jsonc`:

```jsonc
{
  "cross_project_mailbox": {
    "enabled": true,
    "senders": {
      "xyz98765": {
        "access": "allow",
        "intent_budget": "impl"
      }
    }
  }
}
```

---

### Step 3: Driving Delivery (The Agent Tools)

Once configured, Sisyphus (or Hephaestus/Atlas) will automatically discover the coordination tools when `cross_project_mailbox.enabled` is `true`.

#### The `project_message` Tool

This tool is used in external sessions to send asynchronous, presence-aware coordination messages to target projects.

##### Tool Schema
```json
{
  "name": "project_message",
  "arguments": {
    "targetProjectId": "abc12345", // Target project to send note to
    "intent": "impl", // "question" | "impl" | "plan" (optional if category is provided)
    "category": "quick", // Optional category to route the task
    "mode": "list", // Optional mode: "list" for budget probe, "status" for delivery status, or omit for normal message delivery
    "staleAfterHours": 4, // mode="status" only: hours without acknowledgement before a send counts as stale (default 4)
    "requested_mode": "subagent", // Optional advisory delivery mode: "answer" | "todo-append" | "todo-next" | "subagent" | "worker-pr" | "interrupt". See Requested Delivery Modes.
    "body": "Markdown text describing the task or coordination request.",
    "priority": 0, // Higher numbers are drained first
    "threadId": "optional-uuid", // Correlation thread grouping (UUID v4)
    "supersedes": "optional-message-uuid", // Optional message ID this replaces
    "inReplyToMessageId": "optional-message-uuid" // Reply parent reference
  }
}
```

##### Mode Behavior

`project_message` sends from both internal (plain TUI) and external (served) sessions. Internal sessions have no reachable HTTP port, so a live handoff is not attempted; the note is written to the target's `coordination_notes/` directory and drains on the receiver's next idle sweep. External sessions additionally probe target presence and may launch the target per `launch_policy`.

Calling `project_message` with `mode: "list"` (advisory outbound-budget read) is allowed in both modes.

##### Checking Whether Notes Landed (`mode: "status"`)

A hard reject quarantines the note entirely on the receiver side (`coordination_notes/<sender>/rejected/<id>.md` plus an `<id>.reason.json` recording the reason and detail) and writes nothing back toward the sender. Without a status read, a rejected note looks identical to one still waiting for the target to idle.

`mode: "status"` is a read-only report over the sender's own outbox log, resolving each recent send against the target's acknowledgement directories:

| Outcome | Meaning |
| --- | --- |
| `processed` | The target drained and acknowledged the note. |
| `rejected` | The target quarantined it. `rejectionReason` and `rejectionDetail` carry the receiver's own recorded reason (for example `unauthorized`, `over-budget`, `hop-exceeded`, `duplicate-loop`). |
| `pending` | Sent, not yet acknowledged, still inside the wait window. |
| `stale` | Sent, not yet acknowledged, older than `staleAfterHours`. |
| `unresolved-target` | The target's repo root is not resolvable from this machine, so no outcome can be determined. |

The response carries a `summary` count per outcome, a `needsAttention` list (rejected, stale, and unresolved-target rows only, newest first), and the full `rows` window. Rate-limited notes are *not* reported as rejected: the receiver unreserves rather than quarantining them, so they remain deliverable and stay `pending`/`stale`.

This mode never sends, never writes a note, and never appends to the outbox log.

#### The `project_note` Tool (deprecated)

**Deprecated - use `project_message`,** which now sends from both internal and external sessions. `project_note` is retained only so existing callers keep working.

This tool is a fire-and-forget doc-drop tool. It writes the note directly into the target's `coordination_notes/` directory without performing presence probing or target launching.

##### Tool Schema

```json
{
  "name": "project_note",
  "arguments": {
    "targetProjectId": "abc12345", // Target project to send note to
    "requested_mode": "todo-append", // Optional advisory delivery mode: "answer" | "todo-append" | "todo-next" | "subagent" | "worker-pr" | "interrupt". See Requested Delivery Modes.
    "body": "Markdown text describing the task or coordination request.",
    "priority": 0, // Higher numbers are drained first
    "threadId": "optional-uuid", // Correlation thread grouping (UUID v4)
    "supersedes": "optional-message-uuid", // Optional message ID this replaces
    "inReplyToMessageId": "optional-message-uuid" // Reply parent reference
  }
}
```

##### Mode Behavior

`project_note` runs in any session mode. It never probes presence and never launches the target.

##### Guard Parity

The `project_note` tool enforces the same receiver-protecting guards as `project_message`. These include:
* Sender preflight allowlist validation.
* Intent budget verification.
* Hop count limits.
* Outbox log appending.
* Body size limits.

#### The `project_mailbox_peek` Tool

This read-only receive-side tool lists unread inbound notes across registered sender projects without reserving, renaming, or consuming any files. It returns `fromProjectId`, `messageId`, `timestamp`, `intent`, and a 200-character `bodyPreview` for each pending note.

##### Tool Schema

```json
{
  "name": "project_mailbox_peek",
  "arguments": {}
}
```

#### The `project_mailbox_drain` Tool

This receive-side tool explicitly consumes unread notes without waiting for `session.idle`. It applies the same inbound validation, same-pair rate limit, and duplicate-loop digest checks as the idle-drain hook, archives delivered notes under `processed/`, and returns each delivered envelope plus full body in the tool result. It is denied for Prometheus sessions; `project_mailbox_peek` remains available to every agent.

##### Tool Schema

```json
{
  "name": "project_mailbox_drain",
  "arguments": {}
}
```

#### File Inbound Structure
The tool writes an envelope-wrapped Markdown file to `<target>/coordination_notes/<source-projectId>/<messageId>.md`:

```markdown
---
version: 1
messageId: "2eb4a19c-851f-4d94-a4f7-7b2a95c9603f"
timestamp: 1782523200000
correlationId: "5d9f3f4c-1122-3344-5566-778899aabbcc"
inReplyToMessageId: null
fromProject: "art3d-pipeline"
toProject: "ComfyUI-Manager"
fromProjectId: "xyz98765"
toProjectId: "abc12345"
intent: "impl"
priority: 0
hopCount: 0
hopPath: []
supersedes: null
---
Implement new SDXL fallback route.
```

---

## Permission Tiers

The mailbox enforces a three tier permission model to gate incoming messages. The three tiers are:

* `question`: lowest tier, mapped to agents (explore, librarian, oracle, metis, momus) or explicit `intent: "question"`.
* `impl`: medium tier, mapped to categories `quick` or `unspecified-low`, legacy `intent: "quick"`, or explicit `intent: "impl"`.
* `plan`: highest tier, mapped to categories `deep`, `ultrabrain`, `unspecified-high`, `visual-engineering`, `artistry`, or `writing`, legacy `intent: "review"` or `intent: "work-loop"`, or explicit `intent: "plan"`.

### Gating Rule
The gating rule is defined as:
`requiredTier(category ?? intent) <= grantedCeiling(sender)`

The `category` field on `project_message` is optional. If omitted, the `intent` determines the required tier.

---

## Requested Delivery Modes & Routing Lanes

Beyond the intent tier (which gates *whether* a note is accepted), a sender may attach an optional `requested_mode` to a `project_message` or `project_note` call to advise *how* the note should be handled on arrival. The field is additive and optional: a note without it behaves exactly as before (legacy main-session triage). The receiver is always authoritative — a `requested_mode` is a request, never a command (see [Roadmap](#roadmap)).

### The Six Mode Values

`requested_mode` is one of the following canonical kebab-case values:

| Mode | Required tier | What the receiver does |
| :--- | :--- | :--- |
| `answer` | `question` | Answers the note in a fresh side session (or a cloudhome-hosted session when no local presence exists) and sends the answer back as a threaded reply. Never touches the main session. |
| `todo-append` | `impl` | Appends a todo built from the note body to the *end* of the active session's todo list. Falls back to durable boulder-state when no live session exists. |
| `todo-next` | `impl` | Inserts the todo immediately *after* the current in-progress item instead of at the end. |
| `subagent` | `impl` | Fulfills the note with one or more background subagents (single, or an investigate-then-implement pair) without occupying the main turn; reports back with a threaded reply. |
| `worker-pr` | `plan` | Runs a headless worker in a task-owned git worktree that implements, QAs, and opens a PR; the PR URL is reported back for main-session review. See `worker_pr_variant` below. |
| `interrupt` | `plan` | Queue-jumps the drain poller and prepends an urgent todo, injecting a re-evaluation prompt at the next safe boundary. It is **not** a mid-turn abort — it never interrupts a running turn, only cuts the queue for the next safe injection point. |

The required tier is checked against the sender's `intent_budget` ceiling. An over-budget or disallowed mode is **silently downgraded** to legacy main-session triage with a recorded reason (`mode-over-budget` or `mode-not-allowed`) — a valid note is never hard-rejected because of its requested mode.

### Receiver-Side Mode Configuration

Two optional per-sender fields shape mode handling:

* **`allowed_modes`** (`string[]`, optional): An explicit allowlist of the modes this sender may use. When absent, every mode whose required tier fits within the sender's `intent_budget` is implicitly allowed. When present, any mode not in the list is downgraded to triage with reason `mode-not-allowed`. Budget is still checked first, so an over-budget mode downgrades with `mode-over-budget` even if it appears in the allowlist.
* **`worker_pr_variant`** (`"local" | "cloudhome"`, optional): Selects the substrate for this sender's `worker-pr` notes. Absent or `"local"` uses the default local headless-worktree worker. `"cloudhome"` delegates execution to cloudhome through the request/PR-intake contract (agent-harness ships only the contract half; cloudhome performs the actual work). A note whose category is `worker-pr-cloudhome` overrides this per-sender default for that single note.

### Routing Lanes

Inbound notes route deterministically to one of these lanes based on `requested_mode`, sender budget, and target presence:

* **`triage`** — legacy/fallback: the note is surfaced to the main session as a static triage prompt. This is the lane for notes with no `requested_mode`, for downgraded notes, and for the manual `project_mailbox_drain` output.
* **`answer-local`** / **`answer-remote`** — side-session Q&A locally, or a cloudhome-hosted answer contract when no local presence exists and the question is not about in-flight local work.
* **`todo-append`** / **`todo-next`** — live-worklist injection into the active session's todo list.
* **`subagent`** — background subagent fulfillment.
* **`worker-pr-local`** / **`worker-pr-cloudhome`** — headless worker-PR, local or cloudhome-delegated per `worker_pr_variant`.
* **`interrupt`** — safe queue-jump injection.
* **`classify`** — a cheap classifier subagent runs only for notes that carry *no* `requested_mode` and whose intent is ambiguous; its constrained output re-enters the same budget gating.

The manual `project_mailbox_drain` tool remains a raw synchronous return; it surfaces each note's `requested_mode` plus per-mode guidance in its output rather than executing the lane automatically.

---

## Roadmap

**Current (Phase 1) — sender requests, receiver decides.** The `requested_mode` field is advisory. The sender asks for a lane, and the receiving project's own budget and per-sender config (`intent_budget`, `allowed_modes`, `worker_pr_variant`) decide the mode that actually runs, silently downgrading anything over-budget or disallowed. This keeps the trust model intact: the receiver is always the authority on what executes.

**Phase 2 (future) — orchestrator authority model.** A sender requests a mode, an orchestrator decides the actual mode, and the receiver follows the orchestrator's commands. The wire format is deliberately additive so this evolution needs no breaking change. This is likely implemented as either a full orchestrator or a dedicated intake agent (undecided; tracked here for future work). Neither the orchestrator nor a dedicated intake agent is implemented in Phase 1.

---

## Session Presence

Active sessions maintain presence information to allow other projects to verify their status. The mailbox classifies each session into one of two modes:

* **Internal Mode**: Applies to plain `opencode` or `opencode --continue` TUI sessions. No HTTP port is bound, so live handoff is not attempted; `project_message` still sends, writing a file-based doc-drop that drains on the receiver's next idle sweep.
* **External Mode**: Applies to sessions launched via `opencode serve`, `opencode web`, or with an explicit `--port` flag. These sessions additionally support presence probing and target launch on delivery.

### Mode Detection via the Listener Registry

The opencode fork writes an on-disk listener registry record at `<xdg-state>/opencode/instances/<pid>.json` (`{pid, url, hostname, port, startedAt}`) whenever `Server.listen` binds a TCP socket, and removes it when the listener stops. The mode detector reads the record for its own pid on session start or resume:

* Record present: the session is **external**, and the record's `url` is the real bound address published in the presence heartbeat.
* Record absent (after two brief retries covering the fresh-listener race): the session is **internal**. A legacy fallback classifies the session external when an older host exposes a non-placeholder `ctx.serverUrl`.
* Records whose `startedAt` predates the current process are rejected as pid-reuse leftovers from a hard kill.

Activity endpoints are deliberately NOT used for detection: the host evicts idle sessions from `/session/status`, and idle is the normal resting state of an attended session.

### Heartbeat File and Fields

A JSON file located at `~/.omo/presence/<projectId>.json` is updated every 10 seconds while the session is active (30 second TTL). The heartbeat file contains the following fields:

* `projectId`: The unique 8-character identifier of the project.
* `repoRoot`: The absolute path to the repository root.
* `mode`: The session mode, either `"internal"` or `"external"`.
* `serverUrl`: The URL of the local server, or `null` for internal sessions.
* `sessionId`: The unique identifier of the active session.
* `pid`: The process ID of the session.
* `heartbeatTs`: The timestamp of the last update.

### Reachability Liveness Check

The sender confirms a target's server is reachable with a `GET <serverUrl>/global/health` probe carrying the `x-opencode-directory: <repoRoot>` header. Any HTTP response (including auth-gated 401s) proves a live server; only a network-level failure marks the target unreachable. Attendance is carried by heartbeat freshness: a process that beats every 10 seconds is alive, whether or not its session is actively processing a prompt. If the target is in internal mode, the server URL is `null`, and the probe is bypassed.

### Presence Statuses

The presence reader resolves a target's status into one of the following values:

* `live`: The target is in external mode, its heartbeat is fresh, and the health probe got an HTTP response.
* `internal`: The target is in internal mode, and its heartbeat is fresh. The outbound budget table and TUI sidebar display this status as `internal (doc-drop)`.
* `stale`: The target is in external mode with a fresh heartbeat, but the health probe could not connect.
* `offline`: No heartbeat file exists, or the heartbeat timestamp is older than the TTL.

---

## Launch Policy

The launch policy controls how a sender behaves when the target project session is not running.

* **Configuration**: `launch_policy: "disabled" | "ask" | "auto"` (default: `"disabled"`)
* `disabled`: Messages queue in the target mailbox. The sender does not launch the target or ask the user.
* `ask`: The sender asks the user before launching a headless server in the target repository.
* `auto`: The sender automatically launches the target session without asking.
* **Safety Note**: The default is set to `disabled` because automatic launching creates background processes that the user might not expect.

---

## Advisory Outbound Budget

The mailbox supports a probe mode to inspect allowed targets and budgets.

* **Probe Mode**: Call the `project_message` tool with `mode: "list"` to enumerate allowed targets and their granted budgets without sending a message.
* **Budget Table**: An advisory budget table is injected at session start showing the ceiling tier for each allowed target.

---

## Operational Troubleshooting

### 1. Lock Cleanup
If an agent crash occurs during registry updates, a stale lock file might prevent updates:
- **Registry Lock**: Clean up `~/.omo/project-registry.json.lock`.
- **Note Lock**: Clean up `<target>/coordination_notes/<source-projectId>/<messageId>.lock` files if they persist past their TTL.

### 2. Message Quarantine
If notes are missing from the inbox, check `<target>/coordination_notes/<source-projectId>/rejected/`.
A rejected message produces two files:
1. `<messageId>.md`: The original note.
2. `<messageId>.reason.json`: Diagnostic metadata explaining the rejection.

**Example Rejection Reason:**
```json
{
  "reason": "rate-limit-exceeded",
  "detail": "Rate limit of 6 notes/min exceeded between source xyz98765 and target abc12345",
  "at": "2026-06-27T05:42:00.000Z"
}
```

Other validation codes:
- `hop-limit-exceeded`: Note exceeded `max_hops` forwarding limit.
- `duplicate-detected`: Message body matched a recently processed note digest.
- `invalid-envelope`: Frontmatter failed Zod schema checks.
- `unauthorized-sender`: Sender is blocked or not in the allowlist.
- `intent-budget-exceeded`: Sent intent exceeds authorized budget.

### 3. TUI Mailbox Sidebar
The TUI includes a dedicated sidebar slot for monitoring the mailbox.

* **Sidebar Slot**: Positioned at order 150, which is directly above the Magic Context slot at order 200.
* **Layout**: Uses a two column layout with the label on the left and the count on the right.
* **Idle State**: When all counts are zero, the sidebar displays "Mailbox idle" in muted text.
* **Collapsibility**: The sidebar is collapsible, and its collapse state persists to `tui-preferences.jsonc`.

If a message is queued but not draining, verify that:
* The session is in an idle state.
* The active primary agent is listed in the `intake_eligible_agents` array (default: Sisyphus only).
