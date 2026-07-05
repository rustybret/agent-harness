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
1. **Registry (`~/.omo/project-registry.json`)**: A local registry tracking observed repositories, mapping unique 8-character `projectId` tags to absolute filesystem paths.
2. **MailboxStore**: Manages message states (reservation, confirmation, quarantine, stale reclamation) via atomic filesystem locks to prevent race conditions.
3. **Idle-Drain Hook**: Injected into `session.idle` events. It checks incoming notes in `coordination_notes/` when the session becomes idle, then sequentially drains eligible messages into the active prompt stream via `dispatchInternalPrompt`.
4. **Project Message Tool (`project_message`)**: Surfaced to agents to send intent-budgeted, preflight-checked, envelope-wrapped notes to target repositories.

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
        "intent_budget": "impl" // Maximum intent permitted: "question" | "impl" | "plan"
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

### Step 1: Project Auto-Discovery
Repositories must register themselves so other repositories can locate them.

#### Option A: Automatic via OpenClaw
If running the OpenClaw reply listener daemon, register projects automatically by running:
```ts
// The registry auto-syncs with your OpenClaw session directory:
await registry.discoverFromOpenClaw("/path/to/openclaw/sessions.jsonl");
```

#### Option B: Manual Registration
A project registers itself with the central registry whenever its OpenCode plugin initializes. Launching an OpenCode session inside any repository registers it:
```bash
opencode run "check status"
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
    "mode": "list", // Optional mode: "list" for budget probe, or omit for normal message delivery
    "body": "Markdown text describing the task or coordination request.",
    "priority": 0, // Higher numbers are drained first
    "threadId": "optional-uuid", // Correlation thread grouping (UUID v4)
    "supersedes": "optional-message-uuid", // Optional message ID this replaces
    "inReplyToMessageId": "optional-message-uuid" // Reply parent reference
  }
}
```

##### Mode Gating Behavior

If `project_message` is called in an internal session, the send operation is blocked and returns the following guidance:
`"internal session - use project_note"`

However, calling `project_message` with `mode: "list"` (advisory outbound-budget read) remains allowed in both internal and external modes.

#### The `project_note` Tool

This tool is a fire-and-forget doc-drop tool designed for internal sessions. It writes the note directly into the target's `coordination_notes/` directory without performing presence probing or target launching.

##### Tool Schema

```json
{
  "name": "project_note",
  "arguments": {
    "targetProjectId": "abc12345", // Target project to send note to
    "body": "Markdown text describing the task or coordination request.",
    "priority": 0, // Higher numbers are drained first
    "threadId": "optional-uuid", // Correlation thread grouping (UUID v4)
    "supersedes": "optional-message-uuid", // Optional message ID this replaces
    "inReplyToMessageId": "optional-message-uuid" // Reply parent reference
  }
}
```

##### Mode Gating Behavior

If `project_note` is called in an external session, the operation is blocked and returns the following guidance:
`"external session; use project_message"`

##### Guard Parity

The `project_note` tool enforces the same receiver-protecting guards as `project_message`. These include:
* Sender preflight allowlist validation.
* Intent budget verification.
* Hop count limits.
* Outbox log appending.
* Body size limits.

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

## Session Presence

Active sessions maintain presence information to allow other projects to verify their status. The mailbox classifies each session into one of two modes:

* **Internal Mode**: Applies to plain `opencode` or `opencode --continue` TUI sessions. The mailbox is disabled by default for sending messages, and coordination is restricted to file-based doc-drops via the `project_note` tool.
* **External Mode**: Applies to sessions launched via `opencode serve`, `opencode web`, or with an explicit `--port` flag. These sessions support full presence-aware message delivery via the `project_message` tool.

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
