---
name: unity-runtime
description: "Control Unity Play Mode, pause/step runtime execution, capture Profiler frame data, verify gameplay movement, and author VFX effects (Line, Particle, Trail renderers, VFX Graph) through the Unity SuperMCP bridge."
mcp:
  supermcp:
    type: remote
    url: "http://127.0.0.1:27182/mcp"
---

# Unity Runtime Skill

This skill controls Unity Play Mode, pauses or steps runtime execution, captures Profiler frame data, verifies gameplay movement, and authors VFX effects.

## When to Use

Use this skill when you need to:
- Control Play Mode state in the Unity Editor.
- Capture and analyze performance metrics using the Profiler.
- Verify gameplay movement and physics behavior.
- Author and control visual effects like Line Renderers, Particle Systems, Trail Renderers, and VFX Graphs.

## Tool Mapping

- Play Mode control: `play_mode_*`
- Profiler suite: `profiler_*`
- Playability verification: `playability_*`
- VFX effects: `vfx_*`
- Gameplay screenshot: `game_screenshot` (base64 PNG + `mode: play|edit`; HC-2 compliant, `ScreenCapture` only)
- Async object watch: `scene_wait_for_start` → `{jobId}`, then poll `scene_wait_for_result` → `{found, path, expired}`
- Semantic action invoke: `game_invoke_action` — calls a named `[McpAction]`-annotated method on a live MonoBehaviour in the active scene

## Operational Guidance

- **OmO-Awareness**: Prefer `aft_*`, `read`, and `edit` for locating and editing repo-side scripts or configuration files. Treat the injected `## Available MCP Servers` block as the authoritative tool reference.
- **Play Mode Safety**: Entering Play Mode (`play_mode_enter`) is unsafe and mutates editor state. Ensure all scene changes are saved before entering Play Mode.
- **Pause and Step Semantics**: Use `play_mode_pause` to pause, resume, or toggle Play Mode. Use `play_mode_step` to step frame-by-frame, which is only valid while in Play Mode.
- **Profiler Frame-Capture Sequencing**: To capture performance data, first enter Play Mode, enable the Profiler using `profiler_start`, capture frame data with `profiler_capture_frame` or retrieve stats, disable the Profiler with `profiler_stop`, and then exit Play Mode.
- **Async Watch Sequencing**: For async scene loads, call `scene_wait_for_start({name, timeoutMs})` (≤25000 ms, HC-1) then poll `scene_wait_for_result({jobId})` until `found` or `expired`. Do not busy-poll `ui_find`; the watch delegates to the Editor update loop.
- **UI Interaction Cross-ref**: uGUI interaction tools `ui_tap` / `ui_set` are documented in `unity-scene` (Play Mode only; require `EventSystem.current`).
- **VFX Package Gate**: VFX Graph tools (`vfx_graph_*`) require the Visual Effect Graph package (`com.unity.visualeffectgraph`) to be installed. If the package is absent, these tools return `package_missing`. Install the package via `unity-bridge-bootstrap` if needed.
- **Semantic Action Invoke (`game_invoke_action`)**: Invokes a named `[McpAction("name")]`-annotated method on MonoBehaviours in the active scene — the target method must carry the `[McpAction]` attribute. Distinguish three failure modes: `registry_empty` (no `[McpAction]` methods exist at all — usually an HC-3 domain reload cleared the statics; re-trigger discovery), `action_not_found` (registry is populated but the requested name is unknown — check the spelling against the annotated methods), and `no_instance` (the action is an instance method but no live MonoBehaviour of that type exists in the scene — enter Play Mode or spawn the object first).
