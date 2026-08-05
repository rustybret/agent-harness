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

## QA Evidence & Benchmarks

- **Task 9 QA Evidence**: Proves registration, permission enforcement, and sync dispatch mode. Located at `file://.omo/evidence/20260804-unity-subagents/task-9/README.md`.
- **Task 10 QA Evidence**: Proves skill-to-MCP reachability, single-skill discipline, and offline-bridge failure handling. Located at `file://.omo/evidence/20260804-unity-subagents/task-10/README.md`.
- **A-vs-B Live Benchmark Procedure**: Detailed head-to-head testing protocol to compare Option A and Option B performance. Located at `file://docs/reference/unity-subagent-benchmark.md`.
