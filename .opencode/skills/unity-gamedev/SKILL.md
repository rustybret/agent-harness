---
name: unity-gamedev
description: "Drive end-to-end Unity game-development workflows — bootstrap, tool discovery, and the edit/compile/verify loop — through the Unity SuperMCP bridge. Load when an agent needs to make and verify Unity changes autonomously across scene, script, asset, and build domains."
mcp:
  supermcp:
    type: remote
    url: "http://127.0.0.1:27182/mcp"
---

# Unity Game-Dev Workflow Skill

This skill packages the Unity SuperMCP bridge into the repeatable WORKFLOW a
game-development agent runs to change a live Unity project and verify the change —
autonomously, without a human clicking buttons. It is the workflow companion to the
`unity-gamedev` subagent.

It does NOT re-document every bridge tool — the bridge owns the tool surface and the
per-domain skills (`unity-scene`, `unity-script-roslyn`, `unity-asset`,
`unity-build`, `unity-runtime`) document their own tools. This skill wires those
domains into one loop and encodes the constraints that make autonomous Unity work
safe.

## Usage

Load the skill with:
```typescript
skill(name="unity-gamedev")
```

Then invoke bridge tools through the embedded MCP:
```typescript
skill_mcp(mcp_name="supermcp", tool_name="bridge_status", arguments={})
```

## When to Use

Load this skill when an agent needs to:

- Run a full Unity change-and-verify loop (edit → compile → confirm) end to end
- Decide which domain skill to load for a given game-dev task
- Coordinate scene, script, asset, and build work in one session while keeping
  mutation discipline
- Drive Unity headless/unattended where the compile gate and modal handling must be
  respected, not assumed

If the bridge is not installed or the Unity Editor is unreachable, load
`unity-bridge-bootstrap` first and run its health checks. Do not keep this skill
loaded as a substitute for the focused domain skills once the loop is running.

## Core Workflow: Edit → Compile → Verify

1. **Bootstrap / health.** `bridge_status` — confirm the bridge is alive and read
   `editor_focused`, `last_pump_tick_age_ms`, `run_in_background`,
   `pending_modal_count`. If unhealthy, load `unity-bridge-bootstrap`.
2. **Discover the tool subset.** `get_relevant_tools` with your task description.
   Whole-surface clients hit the 128-tool cap; this meta-tool returns only the
   tools the task needs so the client stays under the limit.
3. **Pick the domain skill.** `propose_skill_load` (or `list_available_skills`) to
   confirm whether `unity-scene`, `unity-script-roslyn`, `unity-asset`,
   `unity-build`, or `unity-runtime` is the right surface for the work.
4. **Inspect before mutating.** Use safe reads — `scene_list`,
   `gameobject_get_components`, `hierarchy_get_children`, `prefab_stage_get`,
   `script_validate` — to ground the change.
5. **Mutate.** Issue the unsafe op (`gameobject_create`, `script_edit`,
   `scene_create`, …). Respect the decision flow before destructive ops.
6. **Compile gate.** After a script write the bridge auto-requests compilation —
   capture the `job_id`, poll `compile_status` until `succeeded`/`failed`, and read
   `compile_errors` on failure. The change is NOT live until `compile_status`
   reports `succeeded`.
7. **Verify.** Confirm with safe reads and the `session_changes` mutation log — do
   not assert success from the write call alone.

```typescript
skill_mcp(mcp_name="supermcp", tool_name="bridge_status", arguments={})
skill_mcp(mcp_name="supermcp", tool_name="get_relevant_tools", arguments={"task":"add a player spawner script to the main scene"})
skill_mcp(mcp_name="supermcp", tool_name="script_validate", arguments={"path":"Assets/Scripts/PlayerSpawner.cs","contents":"<csharp>"})
skill_mcp(mcp_name="supermcp", tool_name="script_create", arguments={"path":"Assets/Scripts/PlayerSpawner.cs","contents":"<csharp>"})
skill_mcp(mcp_name="supermcp", tool_name="compile_status", arguments={"job_id":"<job_id>"})
skill_mcp(mcp_name="supermcp", tool_name="session_changes", arguments={})
```

## Tool Discovery (128-tool clients)

The SuperMCP surface is 235+ tools. Clients with a 128-tool cap cannot load it
whole. Always narrow with `get_relevant_tools` (pass the concrete task), and use
`manage_tools` only where the bridge supports toggling. Never page through the full
surface blindly — it wastes context and risks tripping the cap.

## Key Constraints (do not violate)

These constraints are the difference between autonomous Unity work that succeeds and
work that silently strands.

- **Background compilation gate.** `AssetDatabase.Refresh()` does NOT reliably
  trigger a domain reload when the Editor is unfocused — the update pump throttles.
  Never assume a script change is live until `compile_status` reports `succeeded`.
  If polling stalls, check `last_pump_tick_age_ms` via `bridge_status`; if
  `> 5000ms`, `focus_editor` or `request_user_decision` to foreground Unity.
- **Scene-reload modal deadlock.** A scene/asset "reload?" dialog is captured as a
  DECISION-REQUIRED pending modal (`reason: scene_reload` / `asset_reload`), not
  auto-dismissed. Drive it with `list_pending_modals` → `request_user_decision`
  (yes / no / always_yes_session) → `dismiss_modal`. Use the DecisionRegistry; do
  not let a modal strand the session.
- **App Nap throttle (macOS).** A background Editor throttles
  `EditorApplication.update`. App Nap is auto-disabled by the bridge bootstrap, but
  responsive compilation may still require the user to foreground Unity — handle the
  timeout path with `request_user_decision`, do not spin.
- **Touchpoints only via the bridge.** All Unity reads and mutations go through
  bridge tools and skills. Never use harness file tools (`read`/`edit`/`write`/
  `aft_search`) to touch Unity scenes, scripts, prefabs, or assets directly.
- **Idempotency.** Safe = read-only, freely retryable. Unsafe = mutating; confirm
  the first call's result before a second issue, and pass an `idempotency_key`
  where supported.

## Decision & Write Safety

- Before any destructive op (delete, reload, replace, overwrite), call
  `request_user_decision` and await `record_decision`. Choose the minimum
  persistence scope: `none` (one-shot) < `session` / `always_yes_session`
  (SessionState, survives domain reload, dies on Editor quit) < `persistent`.
- `script_edit` uses a TOCTOU MD5 guard. `external_change_detected` means the file
  changed on disk since your read — re-read and reconcile, or pass
  `force_overwrite: true` only with explicit user consent. Never blind-overwrite.

## Notes

- This skill defines the agent-facing WORKFLOW surface only. It does not implement
  bridge tool logic.
- Prefer the focused domain skill once the loop is running; this skill is the
  orchestration entry point, not a permanent replacement for `unity-scene` et al.
- The bridge connects via remote HTTP at `http://127.0.0.1:27182/mcp` and starts
  automatically when the Unity Editor loads the `com.supermcp.unity-bridge` package.
  No separate server launch is required.
