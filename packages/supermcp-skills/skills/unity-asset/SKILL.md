---
name: unity-asset
description: "Import, find, query, create, and assign Unity project assets and materials through the Unity SuperMCP bridge. Also handles UI Toolkit authoring (UXML/USS) and VFX effects (Trail, Particle, Line renderers, VFX Graph)."
mcp:
  supermcp:
    type: remote
    url: "http://127.0.0.1:27182/mcp"
---

# Unity Asset Skill

This skill guides asset database, material, and UI Toolkit workflows.

## When to Use

Use this skill when you need to:
- Find existing assets before creating duplicates.
- Import external files into the `Assets/` folder.
- Create materials with specific shaders and properties.
- Assign materials to renderers on scene objects.
- Import textures with custom importer settings.
- Query the AssetDatabase for GUIDs, paths, labels, or dependencies.
- Force-reserialize scene/prefab/material/asset YAML after an external or version-upgrade edit.
- Author UI Toolkit documents (UXML) and stylesheets (USS).
- Attach, detach, or modify UI documents and panel settings.

For GameObject creation, prefab instantiation, or hierarchy traversal, use `unity-scene`. C# script creation or validation requires `unity-script-roslyn`. If the bridge isn't running, load `unity-bridge-bootstrap` first.

## Domain to Tool Family Map

- Asset Database & Materials: `asset_*` and `material_*` tools.
- YAML maintenance: `reserialize` — rewrites asset YAML to the current Unity serialization format.
- UI Toolkit (UXML/USS): `ui_*` tools.

## Operational Guidance & Safety Gotchas

Prefer `aft_*`, `read`, and `edit` tools for repo-side `.asset`, `.uxml`, and `.uss` files. Treat the injected `## Available MCP Servers` section as the authoritative tool reference.

### UTF-8 NoBOM Requirement
All UXML and USS files must be written as UTF-8 without a Byte Order Mark (BOM). Unity's parser can fail or behave unpredictably if a BOM is present.

### UI Toolkit & VFX Sequencing
Before authoring VFX effects, ensure the Visual Effect Graph package is installed in the project. Creating or modifying VFX assets before the package is active will result in broken script references and import errors.

### Reserialize After External Edits
`reserialize` wraps `AssetDatabase.ForceReserializeAssets` — use it to normalize YAML after editing `.unity`/`.prefab`/`.mat`/`.asset` files on disk, or after a Unity version upgrade rewrites the format. A multi-path call runs async and returns a `job_id`; poll `reserialize_status` until done. It mutates files on disk, so commit or checkpoint first if the result must be reversible.

### Import Pipeline Ordering
When importing textures or other dependencies that a material or UI document references, always import the dependency first. Let the AssetDatabase finish importing the texture before you create or update the material that uses it. This prevents missing reference warnings and broken material setups.
