---
name: unity-scene
description: "Create, load, inspect, and mutate Unity scenes, GameObjects, prefabs, components, and hierarchy structure through the Unity SuperMCP bridge. Use for scene management, object placement, component inspection, hierarchy traversal, and spatial queries (raycast, line-of-sight, camera visibility, navmesh pathing)."
mcp:
  supermcp:
    type: remote
    url: "http://127.0.0.1:27182/mcp"
---

# Unity Scene Skill

Load this skill for Unity scene and hierarchy work: loading scenes, creating GameObjects, instantiating prefabs, inspecting components, and traversing the hierarchy.

## When to Use

- Discovering, loading, or navigating Unity scenes
- Creating, deleting, or inspecting GameObjects
- Instantiating prefabs into the active scene
- Inspecting or setting component properties
- Traversing the hierarchy before a script, asset, or build operation
- Auditing recent mutations via the session change log
- Spatial reasoning: raycasting, line-of-sight checks, camera-frustum visibility, and navmesh path queries

If the bridge is unavailable, load `unity-bridge-bootstrap` first.

## Tool Mapping

- Scene management: `scene_*`
  - **`scene_save`**: saves active scene to disk — call after any mutation to persist across Editor restarts
- GameObjects/hierarchy: `gameobject_*`
  - **`gameobject_get`**: deep inspector — returns a GameObject + components + nested children in one call; use `maxDepth`/`limit` to cap depth; returns `_truncated: true` when capped
- Prefabs: `prefab_*`
- Component mutation: `component_*` (including `component_set_property` with object-reference support)
- Hierarchy traversal: `hierarchy_*`
- Mutation log: `session_changes`
- uGUI enumeration: `ui_find` → `{elements[{path, name, component, isVisible, isInteractable, rect}]}` (HC-7 visibility)
- UI hierarchy snapshot: `ui_snapshot` → `{timestamp, screenSize, elements[]}` (scene only, no server state)
- uGUI interaction: `ui_tap` (click), `ui_set` (set value) — Play Mode only; see `unity-runtime` for async-watch flows
- Spatial queries: `raycast` (3D + 2D via `mode`), `check_line_of_sight`, `detect_visible_objects` / `camera_visibility` (frustum), `navmesh_query_path`

## Operational Guidance

- **OmO-Awareness**: Prefer `aft_*`, `read`, and `edit` for locating and editing repo-side `.unity` or `.asset` files. Treat the injected `## Available MCP Servers` block as the authoritative tool reference.
- **Write Safety**: The bridge guards against clobbering externally changed files. If a file was modified on disk between the agent's read and write, the bridge returns `external_change_detected`. Re-read and retry, or pass `force_overwrite: true`.
- **Scene Reload Modals**: Scene reload modals are captured as decision-required pending modals (`reason: scene_reload`). Use `list_pending_modals`, `request_user_decision`, and `dismiss_modal` (all in `unity-bridge-bootstrap`) to handle them.
- **Prefab Isolation**: Use `prefab_stage_get` before scene edits to detect whether a prefab is open in isolation.
- **UI Visibility (HC-7)**: Assert `isVisible` from `ui_find`/`ui_snapshot`, not just `path != null` — an element can be on-screen but invisible via a hidden ancestor `CanvasGroup.alpha`. For Screen Space canvases `isVisible = activeInHierarchy AND all-ancestor CanvasGroup.alpha > 0` (World Space additionally requires the camera viewport check). `CanvasRenderer.enabled` is NOT part of the test — `CanvasRenderer` exposes no public `.enabled`.
- **Spatial query semantics**: `detect_visible_objects`/`camera_visibility` are frustum + optional occlusion checks, not pixel reads. `navmesh_query_path` requires a baked NavMesh — an unbaked scene returns an empty/partial path, not an error. `raycast` defaults to 3D physics; pass `mode: "2d"` for `Physics2D`.
- **UI Interaction Preconditions**: `ui_tap`/`ui_set` are Play Mode only and require `EventSystem.current != null` (HC-5), else `no_event_system`.
- **Path Conventions**: Use project-relative paths for assets (e.g., `Assets/Scenes/Game.unity`) and hierarchy-relative paths for GameObjects (e.g., `/Player/Body`).

## Object-Reference Property Setting

When using `component_set_property` to assign object-reference fields (such as a Transform target, a prefab field, or an AudioSource), you can pass the reference in one of four formats:
- `{"instanceID": N}`: Targets a specific object by its Unity instance ID.
- `{"assetPath": "..."}`: Targets a project asset by its project-relative path.
- `{"hierarchyPath": "..."}`: Targets a GameObject in the active scene by its hierarchy path.
- `null`: Clears the reference field.

### Typed Errors
If the reference cannot be resolved or assigned, the bridge returns one of these errors:
- `reference_not_found`: The specified instance ID, asset path, or hierarchy path does not exist.
- `reference_type_mismatch`: The resolved object type does not match the expected field type.
