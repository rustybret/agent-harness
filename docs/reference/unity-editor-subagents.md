# Unity Editor Subagents

This document describes the restricted Unity subagents, their permission model, invocation patterns, model fallback chains, and synchronization workflows.

## Overview

To support safe, fast, and focused Unity editor automation, the harness provides two restricted execution options alongside the unrestricted `unity-gamedev` agent:

1. **Option A (Generalist Router)**: A single agent (`unity-editor`) that parses a target domain from the prompt, loads the corresponding domain skill, and drives the bridge.
2. **Option B (Domain Specialists)**: Six dedicated agents, each hard-wired to a single domain skill.

### Available Agents

- **`unity-editor`** (Option A): Generalist router.
- **`unity-scene`** (Option B): Scene, hierarchy, prefab, and spatial specialist.
- **`unity-script-roslyn`** (Option B): C# script creation, editing, and compilation specialist.
- **`unity-asset`** (Option B): Asset database, materials, textures, and reserialization specialist.
- **`unity-build`** (Option B): Build target selection and build invocation specialist.
- **`unity-runtime`** (Option B): Play mode, profiler, and runtime execution specialist.
- **`unity-bridge-bootstrap`** (Option B): Bridge health, package installation, and recovery specialist.
- **`unity-gamedev`** (Unrestricted): General-purpose Unity agent with full filesystem and shell access.

---

## Invocation

Subagents are invoked via the `task` tool from a primary agent session.

### Option A Invocation Example

To invoke the generalist `unity-editor` agent, you must specify the target domain using a `Domain:` line in the prompt:

```typescript
task(
  subagent_type="unity-editor",
  prompt="Domain: scene\nList all GameObjects in the active scene."
)
```

### Option B Invocation Example

To invoke a domain specialist directly, call it by its agent name. No domain selection line is required:

```typescript
task(
  subagent_type="unity-scene",
  prompt="List all GameObjects in the active scene."
)
```

### Agent vs. Skill Disambiguation

Agent names and skill names overlap, but they reside in separate registries:
- `task(subagent_type="unity-scene")` invokes the **agent** (which runs in its own subagent session).
- `skill(name="unity-scene")` loads the **skill** instructions and tools into the current session.

---

## Permission Model

All seven restricted subagents share a strict permission model. They are completely blocked from direct filesystem writes, shell execution, and general web access. They can only interact with the Unity Editor via the bridge.

The effective permission map is evaluated using last-match-wins precedence:

| Tool / Pattern | Action | Description |
|---|---|---|
| `*` | **deny** | Deny all tools by default |
| `skill` | **allow** | Allow loading skills |
| `skill_mcp` | **allow** | Allow calling skill-embedded MCP tools |
| `read` | **allow** | Allow reading files (read-only) |
| `question` | **allow** | Allow asking questions |
| `todowrite` | **allow** | Allow writing task lists |
| `bash` | **deny** | Block shell execution |
| `edit` | **deny** | Block direct file edits |
| `write` | **deny** | Block direct file writes |
| `task` | **deny** | Block nested subagent dispatch |
| `webfetch` | **deny** | Block arbitrary web fetches |
| `websearch` | **deny** | Block arbitrary web searches |

---

## Model Fallback Chain

The restricted subagents default to `opencode/gemini-3.5-flash-lite` for fast, low-latency execution. If the primary model fails or is rate-limited, they fall back through the following chain configured in `.omo/omo.jsonc`:

1. `openai/gpt-5.5` (reasoning: low)
2. `opencode/deepseek-v4-flash-free`
3. `anthropic/claude-opus-5` (reasoning: low)
4. `opencode/gemini-3.6-flash`
5. `opencode/gemini-3.5-flash`
6. `opencode/gemini-3-flash`
7. `google/gemma-4-31b-it`

### Gemma-4 Caveat
The `google/gemma-4-31b-it` model has a strict rolling free-tier limit of **16k input-tokens/min**. It is configured as a last resort only and should only be used with short prompts.

---

## Multi-Instance Routing

When multiple Unity editors are registered with the BEAM hub, tool calls require
an `__instance_id` (8-char lowercase hex) to disambiguate the target editor.
Omit it for single-editor sessions. All seven restricted subagents pass this
through transparently; if it's omitted while multiple editors are registered,
the bridge returns `ambiguous_instance` (see Failure Escalation Contract below).

## Failure Escalation Contract

When a bridge tool call fails, it returns a structured
`{"error": {"code": "...", "message": "..."}}` envelope. All seven restricted
subagents are instructed to surface this upward verbatim rather than retry
blindly or attempt self-recovery. Four codes are cross-cutting across the whole
bridge surface (domain-specific codes, e.g. `roslyn_preflight_failed` or
`external_change_detected`, layer on top of these):

| Code | Meaning | Expected agent behavior |
|---|---|---|
| `safe_mode` | Editor is in Safe Mode; compile errors are blocking the bridge | Hand off to `unity-bridge-bootstrap`; do not attempt content work |
| `unknown_tool` | Tool unavailable — satellite package absent, or its env gate (`SUPERMCP_FIRSTPARTY`, `SUPERMCP_EXTERNAL_INJECT`) is off | Not a bridge failure; report as expected-unavailable |
| `ambiguous_instance` | Multiple editors registered, `__instance_id` required | Retry once with an explicit `__instance_id`; never guess |
| `timeout` | Bridge did not respond within its window (Editor backgrounded or frozen) | Do not blind-retry a mutation; check `bridge_status` / `last_pump_tick_age_ms` first |

Env-gated tool sets (`firstparty_*` behind `SUPERMCP_FIRSTPARTY`,
`console_watch_*` behind `SUPERMCP_EXTERNAL_INJECT`) require no special agent
awareness — a gated-off tool simply returns `unknown_tool` like any other
unavailable tool.

---

## Dispatch Mode Finding

Empirical testing in Task 9(c) confirmed that `task(subagent_type="unity-editor")` (and the Option B subagents) using the `opencode/gemini-3.5-flash-lite` model completes **synchronously** (inline). The unstable-gemini forced-background behavior only applies to category-routed dispatches (e.g., `task(category="deep")`), not to direct `subagent_type` dispatches.

---

## Synchronization Workflow

The domain skills used by these subagents are vendored in `packages/supermcp-skills/`. The upstream repository `unitySuperMCP` remains the source of truth.

To sync the local skills with the upstream source, run:

```bash
node packages/supermcp-skills/scripts/sync-from-source.mjs
```

---

## Installation & Registration Timing

### Installing Agent Definitions in Downstream Repositories

The 8 Unity subagents (`unity-gamedev.md`, `unity-editor.md`, `unity-scene.md`, `unity-script-roslyn.md`, `unity-asset.md`, `unity-build.md`, `unity-runtime.md`, `unity-bridge-bootstrap.md`) are stored under `.opencode/agents/`.

When adopting these subagents in another project repository:
- **Symlinking (recommended)**: Symlink the agent files from `agent-harness` into your project's `.opencode/agents/`:
  ```bash
  ln -sf /path/to/agent-harness/.opencode/agents/unity-*.md .opencode/agents/
  ```
- **Copying**: Copy the `.md` files directly into `.opencode/agents/`. Note that if your project gitignores `.opencode/`, newly copied agent files will remain untracked in git.

### Server Restart Requirement

OpenCode loads and registers custom agent definitions from `.opencode/agents/` at **server bootstrap/start time**.

> **Important**: Newly added, copied, or linked agent `.md` files will NOT be recognized by OpenCode until the OpenCode server is restarted. Attempting to invoke a newly added agent before restarting the server will produce an error such as:
> `Unknown agent: "unity-editor". Available agents: Metis - Plan Consultant, Momus - Plan Critic, ...`
> To resolve this, simply restart the OpenCode server (`opencode serve` / restart TUI session) after adding agent files.

---

## Code Intelligence Strategy: AFT Read-Only Tools vs. SuperMCP Engine Mutations

A critical architectural distinction for Unity subagents is separating **Code Intelligence (Reading & Search)** from **Engine & Asset Mutation**:

### 1. Code Intelligence & Search (AFT Tools)
Dedicated Unity subagents (`unity-script-roslyn`, `unity-scene`, `unity-gamedev`, etc.) are empowered with read-only AFT tools (`aft_search`, `aft_outline`, `aft_zoom`, `aft_callgraph`, `ast_grep_search`) to:
- Perform high-speed, AST-aware searches across C# scripts and workspace files.
- Generate structural symbol outlines (`aft_outline`) and zoom into C# classes/methods with call-graph context (`aft_zoom`).
- Trace callers, callees, and refactoring blast radius (`aft_callgraph`) before modifying C# APIs.
- Execute structural AST pattern matching (`ast_grep_search`) across `.cs` files.

### 2. Engine & Asset Mutation (SuperMCP Bridge Tools)
All Unity engine modifications (editing C# scripts for compilation, creating GameObjects, mutating scenes/materials, setting up prefabs, building targets) MUST go through SuperMCP bridge tools (`script_create`, `script_edit`, `scene_create`, `material_create`, etc.):
- Ensures Roslyn pre-flight validation runs before writes.
- Triggers Unity's native compilation loop and domain reload.
- Forces AssetDatabase updates and serializes Unity meta files correctly.

This split guarantees subagents have complete code vision without compromising Unity engine state integrity.

---

## Cross-Platform Remote Verification Protocol (macOS Host vs. Windows Instance)

When OpenCode runs locally on macOS (Apple Silicon arm64) while the Unity Editor and project code live remotely on a cloud-hosted Windows instance (x86_64), local host LSP tools (`lsp_diagnostics`, `csharp-ls`) cannot validate Unity code because the Mac host lacks Unity C# assemblies ("local C# LSP (no Unity on Mac)").

### Rules & Authoritative Gate

1. **Host LSP Exemption**: Parent agents (Sisyphus, Atlas, Hephaestus) and Unity subagents MUST NOT invoke local host `lsp_diagnostics` for Unity / SuperMCP code verification.
2. **Authoritative Verification Gate**:
   - `script_validate` (Roslyn pre-flight validation on the SuperMCP bridge) for pre-write syntax/type checking.
   - `compile_status` (job_id state `succeeded`) / `compile_errors` for Unity Editor compilation.
   - `console_get_logs` for runtime error verification post-domain-reload.
3. **Evidence of Correctness**: Returning `Verification: Validate: script_validate passed, Compile: compile_status succeeded` in the subagent output provides 100% complete evidence of correctness for parent agents.

### Project-Local AFT LSP Configuration

Do **NOT** globally disable C# LSP in `~/.config/cortexkit/aft.jsonc`, as local macOS projects running a local Unity Editor need local C# LSP.

For remote-driven Unity projects (e.g. `salvage`, `webgameECS`), configure C# LSP **per project repository** in `.cortexkit/aft.jsonc` at the project root:

```jsonc
// <project-root>/.cortexkit/aft.jsonc (Project-Local Scoping)
{
  "lsp": {
    // Option A: Remote SSH tunnel to Windows instance
    "servers": {
      "csharp": {
        "binary": "ssh",
        "args": ["user@altos-worker-02", "csharp-ls"]
      }
    }
    // Option B: Disable host C# LSP for this remote-only project root
    // "disabled": ["csharp"]
  }
}
```

This ensures local Mac Unity projects retain native local C# LSP, while remote-hosted Unity projects suppress or tunnel host LSP requests cleanly per repository.

---

## QA Evidence & Benchmarks

- **Task 9 QA Evidence**: Proves registration, permission enforcement, and sync dispatch mode. Located at `file://.omo/evidence/20260804-unity-subagents/task-9/README.md`.
- **Task 10 QA Evidence**: Proves skill-to-MCP reachability, single-skill discipline, and offline-bridge failure handling. Located at `file://.omo/evidence/20260804-unity-subagents/task-10/README.md`.
- **A-vs-B Live Benchmark Procedure**: Detailed head-to-head testing protocol to compare Option A and Option B performance. Located at `file://docs/reference/unity-subagent-benchmark.md`.
