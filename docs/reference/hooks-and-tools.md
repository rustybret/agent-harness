# Agent Harness Extension Guide: Hooks and Tools

This reference guide establishes the architecture, taxonomy, and implementation rules for extending the agent harness. It details the existing hooks and tools, their execution phases, semantic purposes, and release history.

---

## 1. Hooks Architecture and Taxonomy

Hooks intercept and modify execution state across the session, message, tool, and parameter pipelines. They are categorized into five distinct tiers based on their lifecycle phase and trigger conditions.

### The Five Hook Tiers

1. **Session Hooks (Tier 1)**: Bind to session events (`session.created`, `session.idle`, `session.error`, `chat.message`, `chat.params`). They govern model selection, API fallbacks, and TUI notifications.
2. **Tool Guard Hooks (Tier 2)**: Bind to `tool.execute.before` and `tool.execute.after`. They inspect input arguments, truncate output, validate filesystem rules, and recover from execution faults.
3. **Transform Hooks (Tier 3)**: Bind to `experimental.chat.messages.transform` and `experimental.chat.system.transform`. They inject workspace context (README/AGENTS metadata) and normalize provider message shapes.
4. **Continuation Hooks (Tier 4)**: Bind to session idle boundaries. They enforce multi-step progress, manage loop state (ralph/ulw), and coordinate background notifications.
5. **Skill Hooks (Tier 5)**: Bind to early user input parsing (`chat.message`). They match keywords, inject skill-specific guidelines, and automate slash commands.

---

## 2. Hook Catalog (Existing Built Hooks Only)

Below is the complete inventory of built-in hooks currently implemented in the harness, categorized by their tier.

### Tier 1: Session Hooks

| Hook Name | Lifecycle Phase / Trigger | Purpose | Era Added |
| :--- | :--- | :--- | :--- |
| `auto-update-checker` | `session.created` | Compares the local version against npm registry at startup; triggers update toasts. | OMO v1.0 |
| `legacy-plugin-toast` | `chat.message` | Detects legacy plugin name invocations and displays compatibility toasts. | OMO v1.0 |
| `session-notification` | `session.idle` | Dispatches OS-native notifications (macOS/Linux/Windows) on task completion. | OMO v1.0 |
| `question-label-truncator`| `tool.execute.before` | Truncates over-long label strings displayed in interactive Question tool UIs. | OMO v1.0 |
| `edit-error-recovery` | `tool.execute.after` | Catches write failures, repairs path paths, and prompts model correction. | OMO v1.0 |
| `interactive-bash-session`| `tool.execute` | Handles tmux window allocation and lifecycle for stateful interactive terminal tasks. | OMO v1.5 |
| `ralph-loop` | `event` + `chat.message` | Manages continuation counters and terminal signals for the self-referential loop. | OMO v2.0 |
| `delegate-task-retry` | `tool.execute.after` + `event`| Intercepts failed task actions and retries them automatically up to limit. | OMO v2.0 |
| `start-work` | `chat.message` | Parses the `/start-work` command to transition the session into execution mode. | OMO v2.0 |
| `prometheus-md-only` | `tool.execute.before` | restrains the Prometheus planner to writing only markdown files under planning folders. | OMO v2.0 |
| `sisyphus-junior-notepad` | `chat.message` | Injects subagent-specific notepad state into the execution context. | OMO v2.0 |
| `task-resume-info` | `chat.message` | Recovers and injects structural task parameters on session resumption. | OMO v2.0 |
| `model-fallback` | `chat.params` | Preemptively overrides model configurations based on fallback chains in user configs. | OMO v2.0 |
| `preemptive-compaction` | `session.idle` | Analyzes context token weight; triggers compaction before API limit boundaries. | OMO v2.5 |
| `runtime-fallback` | `session.error` | Reactively recovers from 429, 5xx, or key failure errors by switching to backup pools. | OMO v2.5 |
| `anthropic-context-window-limit-recovery` | `session.error` | Handles Claude context window limits by triggering compaction or prompt truncation. | OMO v2.5 |
| `think-mode` | `chat.params` | Switches model parameters dynamically when deep reasoning keywords are detected. | OMO v3.0 |
| `hephaestus-agents-md-injector` | `chat.message` | Injects local directory `AGENTS.md` context for Hephaestus deep-work scopes. | OMO v3.0 |
| `no-sisyphus-gpt` | `chat.message` | Blocks the Sisyphus orchestrator from executing on incompatible GPT model endpoints. | OMO v3.1 |
| `no-hephaestus-non-gpt` | `chat.message` | restrains Hephaestus from executing on non-GPT model endpoints to prevent tool failures. | OMO v3.1 |
| `session-presence-heartbeat` | `session.created` + `session.dispose` | Writes the presence heartbeat file at session start and clears it on session dispose. | OMO v4.10 |

### Tier 2: Tool Guard Hooks

| Hook Name | Lifecycle Phase / Trigger | Purpose | Era Added |
| :--- | :--- | :--- | :--- |
| `comment-checker` | `tool.execute.after` | Scans modified files for AI-slop comments and blocks commits containing them. | OMO v1.0 |
| `tool-output-truncator` | `tool.execute.after` | Limits output size from Grep, Glob, and LSP tools based on remaining context window. | OMO v1.0 |
| `write-existing-file-guard`| `tool.execute.before` | Enforces that a file must be read before the agent attempts to write or edit it. | OMO v1.0 |
| `bash-file-read-guard` | `tool.execute.before` | Catches and blocks attempts to run `cat`, `grep`, or `sed` through raw bash commands. | OMO v1.0 |
| `json-error-recovery` | `tool.execute.after` | Intercepts malformed JSON returned by tool outputs and suggests corrections. | OMO v1.0 |
| `todo-description-override`| `tool.execute.before` | Rewrites user-facing todo descriptions to follow structured formatting conventions. | OMO v1.0 |
| `webfetch-redirect-guard` | `tool.execute.before` | Detects and blocks redirect loops or unsafe domains during remote fetches. | OMO v1.0 |
| `directory-agents-injector`| `tool.execute.before` | Traverses directories upward to inject local `AGENTS.md` rules into context. | OMO v2.0 |
| `directory-readme-injector`| `tool.execute.before` | Traverses directories upward to inject local `README.md` context. | OMO v2.0 |
| `rules-injector` | `tool.execute.before` | Scans workspace paths to dynamically append `.rules` and `.claude/rules` configs. | OMO v2.0 |
| `empty-task-response-detector`| `tool.execute.after` | Flags delegated tasks that return zero output or fail to perform expected work. | OMO v2.0 |
| `tasks-todowrite-disabler` | `tool.execute.before` | Disables the legacy `TodoWrite` tool when the Sisyphus task system is active. | OMO v2.0 |
| `fsync-skip-warning` | `tool.execute.after` | Warns if atomic write operations skip disk sync constraints. | OMO v2.0 |
| `notepad-write-guard` | `tool.execute.before` | restrains direct writes to append-only `.omo/notepads` files. | OMO v2.0 |
| `plan-format-validator` | `tool.execute.before` | Confirms checkbox format syntax is valid on `Write`/`Edit` of boulder plan files. | OMO v2.0 |
| `read-image-resizer` | `tool.execute.after` | Resizes large image buffers to optimize prompt tokens. | OMO v2.0 |
| `hashline-read-enhancer` | `tool.execute.after` | Injects `LINE#ID` hashes into file read outputs for verification. | OMO v3.0 |
| `team-tool-gating` | `tool.execute.before` | Restricts access to `team_*` tools based on active member roles. | OMO v4.0 |

### Tier 3: Transform Hooks

| Hook Name | Lifecycle Phase / Trigger | Purpose | Era Added |
| :--- | :--- | :--- | :--- |
| `claude-code-hooks` | `messages.transform` | Evaluates project-local hooks declared in Claude Code compatibility configurations. | OMO v1.0 |
| `keyword-detector` | `messages.transform` | Scans user prompts for mode keywords (ultrawork, search, team) and injects presets. | OMO v1.0 |
| `tool-pair-validator` | `messages.transform` | Validates that tool invocation structures correspond to schema specifications. | OMO v1.0 |
| `context-injector-messages-transform` | `messages.transform` | Injects directory agents and readmes gathered during the PreToolUse phase. | OMO v2.0 |
| `provider-quirks-normalizer`| `messages.transform` | Strips reasoning blocks for incompatible backends and normalizes output formats. | OMO v2.0 |
| `monitor-status-injector` | `messages.transform` | Appends real-time process monitoring state to the system prompt. | OMO v3.0 |
| `team-mode-status-injector`| `messages.transform` | Appends active multi-agent layouts and execution grids to member prompts. | OMO v4.0 |
| `team-mailbox-injector` | `messages.transform` | Injects unread lead and colleague messages into the active agent context. | OMO v4.0 |
| `cross-project-mailbox-outbound-budget-injector` | `messages.transform` | Injects the advisory budget table at session start. | OMO v4.10 |

### Tier 4: Continuation Hooks

| Hook Name | Lifecycle Phase / Trigger | Purpose | Era Added |
| :--- | :--- | :--- | :--- |
| `background-notification` | `session.idle` | Triggers a console alert when a background task completes. | OMO v1.0 |
| `stop-continuation-guard` | `chat.message` | Handles the `/stop-continuation` command to halt loops and background agents. | OMO v2.0 |
| `todo-continuation-enforcer`| `session.idle` | Compares current todo status; restarts idle agents if work is incomplete. | OMO v2.0 |
| `atlas` | `event` | Directs the planning phase execution workflow for Sisyphus. | OMO v2.0 |
| `compaction-context-injector`| `session.compacted` | Restores essential context parameters immediately after history compaction. | OMO v2.5 |
| `compaction-todo-preserver` | `session.compacted` | Preserves and restructures active todo check-boxes across compaction. | OMO v2.5 |
| `unstable-agent-babysitter` | `session.idle` | Intercepts rapid looping states and forces background throttling. | OMO v3.0 |
| `cross-project-mailbox-idle-drain` | `session.idle` | Inspects target directories and drains incoming coordination notes into active sessions. | OMO v4.10 |

### Tier 5: Skill Hooks

| Hook Name | Lifecycle Phase / Trigger | Purpose | Era Added |
| :--- | :--- | :--- | :--- |
| `auto-slash-command` | `chat.message` | Translates user prompts matching command patterns into template executions. | OMO v1.0 |
| `category-skill-reminder` | `chat.message` | Displays warnings if category tasks are triggered without recommended skills. | OMO v3.0 |

---

## 3. Tools Architecture and Taxonomy

The tools system exposes capabilities to agents based on configuration profiles. The harness divides tools into three tiers.

### Tool Tiers

1. **Core Tools**: Always available to primary agents. These cover search, session management, background tasks, delegation, and skill loading.
2. **Gated / Conditional Tools**: Enabled dynamically via config flags (`team_mode.enabled`, `hashline_edit`, `experimental.task_system`).
3. **MCP-Served Tools (Tier 1 & 3)**: Serviced via Model Context Protocol. Stdio or SSE.

---

## 4. Tool Catalog

### Core Tools (Always On)

| Tool Name | Type | Description | Purpose | Era Added |
| :--- | :--- | :--- | :--- | :--- |
| `grep` | Search | Content search using regex pattern matchers. | Fast file content querying. | OMO v1.0 |
| `glob` | Search | Traversing directory structure matching wildcards. | File presence checking. | OMO v1.0 |
| `session_list` | Sessions | Returns a list of past and active OpenCode sessions. | History auditing. | OMO v1.0 |
| `session_read` | Sessions | Reads formatted exchange logs from a target session. | Extracting past context. | OMO v1.0 |
| `session_search` | Sessions | Searches message bodies across all sessions. | Searching historical decisions. | OMO v1.0 |
| `session_info` | Sessions | Fetches metrics and metadata for a session. | Verifying execution duration. | OMO v1.0 |
| `background_output`| Background | Returns stdout/stderr/thinking from a task. | Monitoring background execution. | OMO v1.0 |
| `background_cancel`| Background | Terminates a running background task. | Halting runaway processes. | OMO v1.0 |
| `skill` | Skills | Loads a skill template or executes a slash command. | Enforcing workflow rules. | OMO v1.0 |
| `call_omo_agent` | Delegation | Invokes Explore or Librarian directly in background. | Scoped exploration tasks. | OMO v2.0 |
| `task` | Delegation | Spawns category-routed subagents with skills. | delegating multi-step tasks. | OMO v2.0 |
| `skill_mcp` | Skills | Executes a tool from a skill-embedded MCP. | Stateful domain automation. | OMO v3.0 |

### Conditional / Gated Tools

| Tool Name | Gate | Purpose | Era Added |
| :--- | :--- | :--- | :--- |
| `look_at` | `multimodal-looker` | Leverages vision models to extract data from PDFs and images. | OMO v2.0 |
| `interactive_bash` | `tmux` enabled | Spawns a stateful interactive terminal pane inside tmux for TUIs. | OMO v1.5 |
| `task_create` | `experimental.task_system` | Spawns a persistent, file-locked task in the Sisyphus task system. | OMO v2.0 |
| `task_get` | `experimental.task_system` | Retrieves details and blocking parameters for a specific task. | OMO v2.0 |
| `task_list` | `experimental.task_system` | Lists all pending, active, and completed task cards. | OMO v2.0 |
| `task_update` | `experimental.task_system` | Modifies the status or dependencies of a task. | OMO v2.0 |
| `edit` | `hashline_edit: true` | Applies surgical edits using `LINE#ID` hashes to prevent collision. | OMO v3.0 |
| `team_create` | `team_mode.enabled: true` | Configures and spawns parallel team member sessions. | OMO v4.0 |
| `team_delete` | `team_mode.enabled: true` | Cleans up session records, mailboxes, and worktrees. | OMO v4.0 |
| `team_status` | `team_mode.enabled: true` | Inspects status and active mailbox queues for a team. | OMO v4.0 |
| `team_list` | `team_mode.enabled: true` | Lists all active and configured teams. | OMO v4.0 |
| `team_send_message`| `team_mode.enabled: true` | Posts an asynchronous message to a member or team broadcast. | OMO v4.0 |
| `team_task_create` | `team_mode.enabled: true` | Adds a task card to the shared team task board. | OMO v4.0 |
| `team_task_list` | `team_mode.enabled: true` | Retrieves all tasks on the team board. | OMO v4.0 |
| `team_task_get` | `team_mode.enabled: true` | Gets status details for a team task. | OMO v4.0 |
| `team_task_update` | `team_mode.enabled: true` | Claims, completes, or updates a task on the board. | OMO v4.0 |
| `team_shutdown_request`| `team_mode.enabled: true`| Requests lead or member termination on task completion. | OMO v4.0 |
| `team_approve_shutdown`| `team_mode.enabled: true`| Lead acknowledges and executes a member's shutdown request. | OMO v4.0 |
| `team_reject_shutdown` | `team_mode.enabled: true`| Lead denies a member's shutdown, providing reason feedback. | OMO v4.0 |
| `project_mailbox_peek` | `cross_project_mailbox.enabled: true` | Lists unread inbound coordination notes without reserving or consuming files. | OMO v4.10 |
| `project_mailbox_drain` | `cross_project_mailbox.enabled: true` | Consumes unread inbound notes synchronously, returning envelope metadata and full bodies without waiting for `session.idle`. Denied for Prometheus. | OMO v4.10 |
| `project_message` | `cross_project_mailbox.enabled: true` | Sends an asynchronous, intent budgeted coordination note to another registered project. Supports `mode: "list"` probe mode, optional `category` field, and `launch_policy` behavior. Gated to external sessions; blocked in internal sessions with guidance to use `project_note`. | OMO v4.10 |
| `project_note` | `cross_project_mailbox.enabled: true` | Sends a fire-and-forget coordination note directly to a target project's mailbox. Gated to internal sessions; blocked in external sessions with guidance to use `project_message`. | OMO v4.10 |

---

## 5. Guide for Future Extension

When extending the agent harness, developers must adhere to the following workflow rules to prevent duplication and preserve taxonomy.

### Step 1: Hook Implementation

1. **Create the Directory**: Create `packages/omo-opencode/src/hooks/{name}/` containing an `index.ts` file exporting `createXXXHook(deps)`.
2. **Select the Lifecycle Phase**: Determine which tier best fits the hook:
   - Session lifecycle → Session Hook (`create-session-hooks.ts`)
   - Pre/post tool execution → Tool Guard Hook (`create-tool-guard-hooks.ts`)
   - Message transforms → Transform Hook (`create-transform-hooks.ts`)
   - Continuation and loops → Continuation Hook (`create-continuation-hooks.ts`)
3. **Register the Hook**:
   - Add the hook name to `HookNameSchema` in `packages/omo-opencode/src/config/schema/hooks.ts`.
   - Import and wire the hook inside the target tier creator file under `packages/omo-opencode/src/plugin/hooks/`.
4. **Validation**: Write co-located `*.test.ts` files verifying behavior using `bun test`.

### Step 2: Tool Implementation

1. **Create the Directory**: Create `packages/omo-opencode/src/tools/{name}/`.
2. **Export the Factory**: Implement `createXXXTool(ctx): ToolDefinition` and export it in `packages/omo-opencode/src/tools/index.ts`.
3. **Define Type Schemas**: Place parameter validation schemas using Zod in a dedicated `types.ts` file.
4. **Register the Tool**:
   - Register the factory in `packages/omo-opencode/src/plugin/tool-registry-factories.ts`.
   - Wire the tool into the appropriate section inside `packages/omo-opencode/src/plugin/tool-registry.ts`.
   - If conditional, add the config gate parameters to the registry wrapper.
