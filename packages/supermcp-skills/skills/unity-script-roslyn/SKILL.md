---
name: unity-script-roslyn
description: "Create, edit, validate, and delete Unity C# scripts through the Unity SuperMCP bridge. Roslyn pre-flight validation runs before any write, blocking on real errors and passing through when the dotnet validator is unavailable."
mcp:
  supermcp:
    type: remote
    url: "http://127.0.0.1:27182/mcp"
---

# Unity Script Roslyn Skill

This skill guides C# script creation, editing, validation, and deletion workflows.

## When to Use

Use this skill when you need to:
- Create a new Unity C# script in the correct project-relative location.
- Edit an existing script while preserving Unity and assembly-definition conventions.
- Run Roslyn pre-flight validation before allowing Unity's compilation loop to compile.
- Delete a script after confirming references and user intent.

For GameObject creation, prefab instantiation, or hierarchy traversal, use `unity-scene`. Use `unity-asset` for asset database, material, or UI Toolkit workflows. If the bridge isn't running, load `unity-bridge-bootstrap` first.

Domain to tool family map: Script Validation & Mutation: supermcp (`script_validate`, `script_create`, `script_edit`, `script_delete`).

## Code Intelligence vs. Engine Mutation

- **Code Intelligence & Inspection**: Use harness-native AFT tools (`aft_search`, `aft_outline`, `aft_zoom`, `aft_callgraph`, `ast_grep_search`) for high-speed, AST-aware code search, reading existing C# scripts, mapping class outlines, and tracing call graphs across the codebase.
- **Engine & File Mutation**: All C# script mutations MUST go through `script_create`, `script_edit`, `script_delete` via the SuperMCP bridge to trigger Roslyn pre-flight validation, Unity domain reload, and asset database refresh.

## Verification & LSP Protocol (CRITICAL)

- **Do NOT run host LSP tools** (`lsp_diagnostics`, `lsp_*`) or local filesystem diagnostics. OpenCode runs locally on macOS (Apple Silicon) while the Unity Editor and project code live remotely on a Windows x86_64 instance. Local host LSP tools will fail or misreport missing assemblies ("local C# LSP (no Unity on Mac)").
- **Authoritative Verification Gate**:
  - `script_validate` (Roslyn pre-flight validation on the SuperMCP bridge) catches syntax/type errors before writing.
  - `compile_status` / `compile_errors` (Unity Editor compilation gate on the bridge) is the authoritative compile check.
  - `console_get_logs` catches runtime errors after domain reload.
- **Evidence of Correctness**: Passing `script_validate` and `compile_status` (job state `succeeded`) is the complete and mandatory verification proof required for parent agents.

Treat the injected `## Available MCP Servers` block as the authoritative tool reference.

## Roslyn Validation Behavior

Roslyn validation runs automatically before writing files:
- Always call `script_validate` before calling `script_create` or `script_edit`.
- If the dotnet validator is found and returns errors, the write is blocked with a `roslyn_preflight_failed` error.
- When the dotnet validator is not found, the write proceeds anyway. This is a graceful pass-through where `fallback` is true and `validator_available` is false.
- The validator is an optional external companion at `tools/roslyn-validator/` and is not bundled in the Burrito binary.
- You can call `script_validate` standalone to pre-check source code before passing it to create or edit.

## Compilation Loop

After `script_create` or `script_edit`:
1. The bridge auto-requests compilation and returns a `compile_job_id` in the response.
2. Poll `compile_status` with the job ID until the state is `"succeeded"` or `"failed"`.
3. If the state is `"failed"`, call `compile_errors` with the job ID to retrieve diagnostics.
4. After a script edit lands and Play Mode or domain reload runs it, a script can throw at runtime rather than compile time. Call `console_get_logs` with `types: ["error"]` to catch this class of failure that `compile_status` and `compile_errors` cannot see.
5. To manually trigger compilation when automatic compile does not trigger, call `asset_refresh` to import assets, then call `compile_request` to get a job ID.

> Pre-load compile-error modal blocking the bridge? See `unity-bridge-bootstrap` → Pre-load Compilation-Error Modal Recovery.

> ⚠️ **BACKGROUND CAVEAT:** When the Unity Editor window is unfocused, the update pump throttles and may stall. If polling `compile_status` times out, check `last_pump_tick_age_ms` via `bridge_status`. Should it be greater than 5000, the Editor needs to be brought to the foreground by the user. `bridge_status` and `focus_editor` live in the `unity-bridge-bootstrap` skill.
