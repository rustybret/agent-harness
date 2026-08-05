---
name: unity-build
description: "Select Unity build targets, invoke synchronous player builds, and retrieve structured build reports through the Unity SuperMCP bridge. Use when producing a Unity player build for any platform or inspecting build results."
mcp:
  supermcp:
    type: remote
    url: "http://127.0.0.1:27182/mcp"
---

# Unity Build Skill

Load this skill to switch build platforms, run player builds, or inspect build results.

## When to Use

* Switching the active build target platform in Unity.
* Running player builds for standalone, mobile, or web platforms.
* Retrieving and inspecting structured build reports.
* Verifying build settings and scene lists before compilation.

If you need to modify scenes, assets, or scripts before building, use the `unity-scene`, `unity-asset`, or `unity-script-roslyn` skills first.

## Tool Mapping

* Build operations: `build_*`

## Operational Guidance

* **OmO-Awareness**: Prefer `aft_*`, `read`, and `edit` for locating and editing repo-side build scripts or configuration files. Treat the injected `## Available MCP Servers` block as the authoritative tool reference.
* **Target Selection Sequencing**: Always select the active build target platform using `build_select_target` before triggering a build with `build_invoke`.
* **HTTP Timeout Caveat**: The HTTP bridge times out at approximately 31 seconds. Long builds can exceed this request window. If a timeout occurs, the build continues in Unity. You must poll for completion or use an async pattern rather than expecting synchronous completion.
* **Build Report Availability**: Use `build_get_report` to retrieve the latest structured build report. If it returns `available: false`, no build has completed since the last domain reload.
* **Path Conventions**: Use project-relative paths for output artifacts, such as `Builds/WebGL`, and scene lists, such as `Assets/Scenes/MainMenu.unity`.
