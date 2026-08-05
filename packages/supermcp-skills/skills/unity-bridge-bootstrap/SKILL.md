---
name: unity-bridge-bootstrap
description: "Bootstrap and self-configure the Unity SuperMCP bridge. Use when first connecting to a Unity project, installing packages, configuring project settings or LSP, handling modal dialogs, checking bridge health, running Editor menu items, setting permission tiers, taking project checkpoints, requesting typed human input, or when another Unity skill reports missing prerequisites. Also exposes batch_execute for atomic multi-tool workflows."
mcp:
  supermcp:
    type: remote
    url: "http://127.0.0.1:27182/mcp"
---

# Unity Bridge Bootstrap Skill

The bootstrap skill is the entry point for any Unity agent session. Load it first to verify bridge health, install prerequisites, configure the project environment, and then hand off to a domain skill for content work.

## When to Use

- First connecting an agent session to a Unity project
- Checking bridge health, modal state, or pump telemetry
- Installing or confirming Unity packages and bridge plugins
- Configuring project settings (`run_in_background`, `company_name`, etc.)
- Setting up LSP project-file generation for harness-native diagnostics
- Handling blocking modal dialogs (scene reload, asset reload)
- Asking for a human decision before a destructive or ambiguous action
- Invoking a Unity Editor menu item by path (`execute_menu_item`)
- Gating the session to a permission tier (`set_permission_tier`)
- Snapshotting/rolling back the project before risky work (`checkpoint_*`)
- Requesting structured typed input from the human (`request_user_input`)
- Running multiple tool calls atomically via `batch_execute`
- Listing and executing project-scoped custom tools (`list_custom_tools`, `execute_custom_tool`)

Once the bridge is healthy and the project is set up, load the relevant domain skill (`unity-scene`, `unity-asset`, `unity-script-roslyn`, etc.) for content work.

## Starting BEAM Independently (Recommended)

For reliable domain-reload survival, start the SuperMCP BEAM server **before** opening Unity, from your agent/opencode session:

```bash
# macOS arm64
unity-bridge/Editor~/server/supermcp start
# Or with explicit transport:
SUPERMCP_BRIDGE_TRANSPORT=http unity-bridge/Editor~/server/supermcp start
```

Once BEAM is running on 127.0.0.1:27182, open Unity. The bridge detects the already-running BEAM (`IsBeamAlive` `/ping` probe) and attaches without spawning a new process. Unity close/crash will NOT kill the BEAM server, satisfying Commitment #1.

When multiple Unity editors are open, each registers with the BEAM InstanceRegistry. Pass `__instance_id` in tool call params to target a specific editor.

## Team-Mode Multi-Machine Bootstrap (Opt-In)

By default, the BEAM hub and Unity Editor communicate on localhost (`127.0.0.1`). Team-mode adds environment variables to bootstrap across multiple machines over WireGuard without changing default single-machine behavior:

1. **Hub configuration (BEAM host)**:
   - `SUPERMCP_BIND`: Set to an interface IP or `0.0.0.0`.
   - `SUPERMCP_HUB_TOKENS`: Comma-separated list of accepted editor registration tokens. If blank on a non-loopback bind, boot requires `SUPERMCP_INSECURE_PUBLIC_BIND=1`.
   - `SUPERMCP_AGENT_TOKEN`: Shared bearer token required on agent requests (`Authorization: Bearer <token>`).

2. **Editor configuration (Unity host)**:
   - `SUPERMCP_BEAM_HOST`: Address of the remote BEAM hub host. When set to a remote host, local BEAM child process spawning is disabled unconditionally.
   - `SUPERMCP_ADVERTISE_HOST`: Host address advertised to the BEAM hub during registration.
   - `SUPERMCP_CALLER`: Caller identity tag attached to registration payloads (defaults to `"default"`).
   - `SUPERMCP_BRIDGE_BIND`: Inbound listener bind host (`0.0.0.0` translates to `+` on Windows).
   - `SUPERMCP_EDITOR_TOKEN`: Shared secret token matching the hub allowlist.

Domain to tool family map: Bootstrap/Health/Modals -> supermcp (bridge_status, focus_editor, list_pending_modals, dismiss_modal, request_user_decision, record_decision, batch_execute, list_custom_tools, execute_custom_tool). Console -> supermcp (console_get_logs, console_clear, console_watch_start, console_watch_stop, console_watch_status).

Every tool response envelope also carries live `console` counts `{errors, warnings, logs}` (omitted, never zeroed, when unavailable); a nonzero `errors` jump after a mutation should prompt a `console_get_logs types:["error"]` read to see what broke.

Prefer harness-native tools like `aft_*` (e.g., `aft_search`, `aft_outline`, `aft_zoom`, `aft_callgraph`) and `lsp_*` for repository file search, reading, editing, and diagnostics. Treat the injected `## Available MCP Servers` block as the authoritative tool reference.

## First-Party Unity Pipeline Interop (Opt-In)

Unity 6.0+ projects with `com.unity.pipeline` installed expose an official in-editor HTTP tool surface (about 140 commands including async test runner, async bakes, `set_autotick`, and hot reload) alongside the SuperMCP bridge. Enable this by setting `SUPERMCP_FIRSTPARTY=1` on the BEAM hub.

Three tools are provided: `firstparty_status` (port-file and editor_status passthrough), `firstparty_list_tools` (GET `/api/commands`), and `firstparty_exec` (POST `/api/exec` passthrough with `{name, parameters}`). All three accept `__instance_id` and follow the same `ambiguous_instance` policy as the rest of the multi-instance surface. They use `idempotency: :unsafe` uniformly. If the package is missing or the server is not running, calls return `firstparty_not_found`. This is expected and does not indicate a bridge failure.

## Unity Launch Hygiene Rules

Most pre-load failures are self-inflicted at launch time. Follow these rules before any launch that requires a fresh compile:

- **Kill stale editors first.** Always `pkill -f "Unity.app/Contents/MacOS/Unity"` before a launch that needs a fresh compile — a lingering process holds the project lock and serves stale assemblies.
- **Never `>`-redirect a live log.** Do not truncate-redirect (`>`) a log file while Unity may still hold an fd on it — the write races the editor and corrupts the log. Use append (`>>`) or a fresh path each launch.
- **Parse for compile errors before any bridge call.** After launch, scan the log for `error CS` before attempting any bridge calls or menu triggers:
  ```bash
  grep "error CS" /tmp/unity-editor.log | head -5
  ```
  If this returns rows, fix the errors (harness file tools) before proceeding — the bridge will not start with a blocking compile-error dialog up.

## Pre-load Compilation-Error Modal Recovery

This is the most dangerous failure mode for agents. It's distinct from runtime modals and the bridge can't help.

### Symptom Signature
- `bridge_status` returns connection refused or timeout (not a stall, but a hard failure).
- Unity process is alive: `pgrep -x Unity` (or `pgrep -fl Unity.app`) returns a PID.
- Bridge has been consistently unavailable for 15+ seconds after expected launch time.

*Distinguish from pump stall:* A stalled pump means the bridge is connected but the Editor is unfocused. If `bridge_status` never connects at all and Unity is running, assume a pre-load dialog is blocking.

### Automated Detection

Before hand-rolling OS automation, stop and use a tool surface. If `bridge_status` returns connection refused AND the Unity process is alive (`pgrep -x Unity`), call:

```
bridge_safe_mode_check {"auto_dismiss": true, "timeout_ms": 15000}
```

- Returns `{dialog_detected, dismissed, platform, waited_ms, title_fragments}`.
- If `dialog_detected: true`, `auto_dismiss: true` clicks the configured button (default `"Ignore"`) automatically; omit or set `false` to only detect.
- The matcher covers Unity 2023 LTS and Unity 6.3+ launch-error titles (`"Enter Safe Mode?"` via the `"Safe Mode"` fragment) plus legacy `"Compiler Errors"` / `"Hold On"` variants.
- Detection-only calls default to one probe. `auto_dismiss: true` defaults to a 15s poll window because Unity may render the dialog several seconds after process spawn.
- **macOS only** today — implemented with Accessibility APIs, not AppleScript. Returns `platform: "unsupported"` elsewhere; fall back to Option B/C below.

**Policy:** "No osascript" is shorthand for "no ad hoc terminal UI hacks." Do not solve Unity liveness by writing one-off shell scripts, parsing intermittent logs, or running focus-stealing bash loops. `bridge_safe_mode_check` is allowed because it is a typed SuperMCP tool that reports live modal state; `macos-cua` is allowed because it is a tool-backed OS automation surface with screenshots, window metadata, and targeted input.

**Enhanced path (if macos-cua skill is available):** Load the `macos-cua` skill and use:
1. `get_windows` — check for a Unity window with title containing "Safe Mode" or a pre-launch dialog
2. `screenshot` + `look_at` — visually confirm the dialog and identify button coordinates
3. `click {"x": ..., "y": ..., "targetPid": <unity_pid>}` — click "Ignore" without stealing focus

This is more reliable than ad hoc shell automation because it uses the accessibility tree, returns structured window data, and per-PID targeting avoids the focus-steal → throttled update-loop failure mode.

### Recovery Options

- **Option A: Server-side Accessibility click (macOS)**, fastest path when Ignore is available:
  ```
  bridge_safe_mode_check {"auto_dismiss": true, "timeout_ms": 15000}
  ```
  This clicks "Ignore" and lets Unity continue loading with errors. The scripting domain loads, the bridge starts, and you can then use `compile_errors` to see what failed. Don't use "Enter Safe Mode", the bridge still won't start.

- **Option B: Fix errors first, then relaunch**, cleanest path:
  1. Kill the blocked Unity process: `pkill -x Unity` or `pkill -f "Unity.app/Contents/MacOS/Unity"`.
  2. Find compile errors without the bridge, use harness-native LSP diagnostics on the project's `.csproj` files or read the `.cs` files directly.
  3. Fix the errors using harness file editing tools (NOT bridge script tools, those require the bridge, which requires the scripting domain, which is blocked).
  4. Relaunch Unity, without compile errors the dialog won't appear: `open -a Unity /path/to/project`.
  5. Await the readiness EVENT (see "Awaiting Bridge Readiness" below) — do not wall-clock sleep.

- **Option C: Enter Safe Mode, fix via harness, relaunch:**
  Clicking "Enter Safe Mode" loads the Editor in a restricted state. The bridge still won't start (Safe Mode disables all managed project code). Fix errors via harness file tools, then quit Unity and relaunch normally.

### What NOT to Do
- Don't retry `bridge_status` in a loop, it won't become available until the dialog is dismissed.
- Don't call `list_pending_modals` or `dismiss_modal`, they require the bridge.
- Don't try `focus_editor`, the Editor main loop isn't running.
- Don't use `script_create` or `script_edit`, they require the bridge.

### Preventing the Problem
Before triggering any workflow that will cause Unity to restart (package install, project switch), run `script_validate` (standalone via Roslyn, no bridge required) on modified scripts. If the Roslyn validator confirms errors, fix them before restarting Unity.

## Awaiting Bridge Readiness (do NOT wall-clock sleep)

Any time Unity restarts the scripting domain — first launch, package install, project switch, or play-mode enter/exit — the bridge briefly goes down and comes back. Do NOT `sleep N` and hope. Poll the readiness EVENT and proceed the instant it fires.

The canonical readiness signal is `.tmp/bridge-reload-state.json` (relative to the project root), surfaced two ways:

- **`bridge_reload_token` tool** — returns `{ status, reload_count, timestamp }` straight from the token file, server-side, with no bridge round-trip (works even while the bridge is mid-restart).
- **`bridge_status` → `result.readiness`** — the same `{ status, reload_count, timestamp }` mirrored atomically into the health response once the bridge is back up.

Token states: `reloading` (domain reload in progress), `ready` (scripting domain loaded, bridge serving), plus `play_mode_enter_reload` / `play_mode_exit_reload` transitional states. `reload_count` increments by exactly 1 on every transition to `ready` and never advances while `reloading`.

### Bring-up poll loop

1. Record the `reload_count` you last saw as `N` (use `0` on a cold first launch).
2. Poll `bridge_reload_token` (or read `.tmp/bridge-reload-state.json` directly) every ~500 ms.
3. **Ready when `status == "ready"` AND `reload_count >= 1`** (cold launch), or `reload_count > N` (after a restart you triggered). This guarantees you observe the NEW domain, not a stale `ready` from before the reload.
4. Only then resume tool calls. Falling back to `bridge_status` is fine once it connects — its `result.readiness` carries the identical token.

This replaces every "wait 30–60 seconds" or `sleep` bring-up heuristic: the agent now knows *when* the bridge is ready, not *guesses*.

### Simpler alternative: `bridge_wait_for_ready`

Instead of hand-rolling the poll loop, let the server block for you:

```
bridge_wait_for_ready {"expected_reload_count": 1}
```

- With default params it blocks server-side up to 20s, polling the token file, and returns `{status: "ready"|"timeout", reload_count, waited_ms}`.
- Pass `expected_reload_count: N` when you know how many reloads to expect (e.g. a package install that triggers several).
- `timeout_ms` defaults to 20000 (max 25000). If you expect bring-up to exceed ~25s, fall back to the manual poll loop above.

## Session Loss Recovery

**Symptom:** JSON-RPC error `-32600` with message `Session not found` or `Session ID is required`—appears after any BEAM restart (domain reload, binary swap, kill+relaunch).

**Root cause:** A BEAM restart invalidates all StreamableHTTP session IDs. Cached session IDs in the agent harness become stale, causing every subsequent call to fail.

**Recovery:**
1. On receiving `-32600 Session not found`: call `initialize` to get a fresh session ID before retrying. Never reuse a stale `MCP-Session-Id`.
2. Prefer the stateless `POST /mcp` path when your harness supports it—no session ID required, immune to session loss (server routes this directly, commit `de61dc0`).
3. After re-initializing, poll `.tmp/bridge-reload-state.json` until `status == "ready"` before issuing tool calls.

## Runtime Modal Handling and Decision Pattern

When the bridge is connected (`bridge_status` succeeds), handle runtime modals using the following pattern:
1. Call `list_pending_modals` to list all blocking Unity Editor modal dialogs.
2. Call `request_user_decision` to register a decision prompt with a key, prompt, and options.
3. Call `dismiss_modal` with the modal `id` and a `button` matching one of the modal's `ButtonOptions` (e.g., `"Reload"`, `"Cancel"`, `"Save"`, `"Don't Save"`).

### Decision Persistence Tiers
- `none`: applies to this single call only.
- `session` / `always_yes_session`: survives domain reloads, cleared on Editor quit (SessionState).
- `persistent`: persists across Editor sessions (EditorPrefs).

## Console Log Access

`console_get_logs {types, count, offset, filter_text, include_stacktrace}` reads Unity Console entries (safe, freely retryable). `console_clear {}` clears the console (unsafe). Every bridge response envelope also carries live `console: {errors, warnings, logs}` counts, which are omitted and never zeroed when unavailable. Treat a nonzero `errors` jump after any mutation as a signal to call `console_get_logs types:["error"]` before assuming a change succeeded silently. On Unity 6, counts come from the public `ConsoleWindowUtility` API. For 2022.3/2023.2, they come from reflection over internal `UnityEditor.LogEntries`. Behavior is identical to the caller either way.

For opt-in console error alerting, set the environment variable `SUPERMCP_EXTERNAL_INJECT=1` and call `console_watch_start`. This starts a background watcher that pushes a system reminder into your opencode session when new Unity Console errors appear. The consuming opencode project must separately have `external_inject.enabled: true` in its own config. It's a peer-project feature dependency from agent-harness or oh-my-opencode, not part of the bridge itself. Check status with `console_watch_status` and stop it with `console_watch_stop`.

## Write-Safety Guard

Every destructive write is guarded against clobbering externally changed files. If a file changed between the agent's read and write, the bridge returns `external_change_detected`. Resolve by re-reading the file and retrying, or pass `force_overwrite: true` on the write.

## Background Pump-Stall Caveat

When the Unity Editor is unfocused, the update pump throttles (and macOS App Nap may suppress it further). If `bridge_status` returns `last_pump_tick_age_ms > 5000`, background compile and asset work may be stalled. Call `focus_editor` or ask the user to bring the Editor to the foreground. If `focus_editor` is unreliable (macOS App Nap), use `macos-cua` skill: `get_windows` to find Unity PID, then send a no-op click to the Unity window with `targetPid` to nudge the OS into keeping the Editor active without actually stealing focus.

## Editor Menu Execution

`execute_menu_item` invokes a Unity Editor menu item by full path (e.g. `"Window/General/Console"`). The C# bridge rejects a hardcoded denylist of destructive/irreversible paths (`File/Quit`, `Assets/Delete`, etc.) before `ExecuteMenuItem` runs. A path that is unknown or disabled in the current context returns `menu_item_not_found`. Use it for editor actions that have no dedicated tool; prefer a typed tool when one exists.

## Permission Tiers

`set_permission_tier` gates the whole session: `observe` (read-only — all `:unsafe` tools blocked pre-dispatch), `standard` (default), `unrestricted` (everything). `get_permission_tier` reports the current tier. Drop to `observe` for inspection-only sweeps; the gate is enforced server-side before any tool dispatch, so a blocked call never reaches Unity.

## Project Checkpoints

For reversible safety around risky edits or version upgrades:
1. `checkpoint_create {project_path[, label]}` — async snapshot of `Assets/` + `ProjectSettings/`; returns a `job_id`.
2. Poll `checkpoint_status {job_id}` until done; `checkpoint_list` shows known checkpoints newest-first (in-process for this BEAM lifetime).
3. `checkpoint_diff {checkpoint_id, project_path}` to preview drift; `checkpoint_restore {checkpoint_id, project_path}` overwrites only files in the snapshot manifest.

Restore needs an explicit `checkpoint_id` (never implicit “last”) — confirm the id with the user before restoring, since it overwrites on-disk project files.

## Typed Human Input (Elicitation)

When a decision needs a structured value rather than a yes/no modal: `request_user_input {inputId, kind}` registers a typed prompt (`toggle`, `slider`, `dropdown`, `text`, `vector3`, `object_ref`) and returns immediately. The human's answer is supplied via `record_input {inputId, value}`; poll `get_input {inputId}` for pending-vs-recorded state. This is distinct from `request_user_decision`/`dismiss_modal`, which handle Unity's own blocking modal dialogs.

## Atomic Batch Execution

Use `batch_execute` to execute multiple tool calls as a unit (array of `{tool, params}`). On failure of an unsafe tool, previously executed operations are rolled back. Safe tools are retried up to `max_retries` times (default 3). Non-batchable tools (asset pipeline ops) are rejected before execution begins.

## Custom Project Tools

You can list and run project-specific custom tools using `list_custom_tools` and `execute_custom_tool`. These tools are registered under the `automation` role.

### Registration and Scoping
Custom tools are defined in your project's Editor assemblies. Mark static methods with the `[McpCustomTool]` attribute to register them. The bridge auto-discovers these methods via reflection.

### Shipped Example
The bridge includes a reference tool named `create_main_menu`. You can run it to generate a default main menu structure in the active scene.

### Typed Errors
When running custom tools, you might encounter these errors:
- `tool_not_found`: The requested custom tool name is not registered.
- `execution_failed`: The custom tool method threw an exception during execution.

## MCP Connection

Remote HTTP at `http://127.0.0.1:27182/mcp`. The bridge starts automatically when Unity Editor loads with `com.supermcp.unity-bridge` installed.
