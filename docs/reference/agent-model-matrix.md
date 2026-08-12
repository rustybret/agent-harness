# Agent Model Preference, Reasoning & Capability Matrix

> **DOCUMENTATION METADATA**
> - **Origin**: Private Fork Reference (`rustybret/agent-harness`)
> - **Source of Truth**: `packages/model-core/src/agent-model-requirements.ts`, `packages/model-core/src/category-model-requirements.ts`, `packages/model-core/src/model-capability-heuristics.ts`, `packages/model-core/src/model-settings-compatibility.ts`, `packages/omo-opencode/src/agents/`, `.opencode/agents/`
> - **Purpose**: Canonical reference document for agent definitions, default fallback chains, reasoning settings, temperature overrides, and integration mapping for extended model families (Gemini Antigravity/CLI, NVIDIA NIM/Nemotron, Meta, Mistral, Thinking Machines). Ingestible by `uc-studio` and other workspace agents.

---

## 1. Architecture & Model Resolution Overview

In `oh-my-opencode` / `agent-harness`, model selection and execution settings are determined through a tiered resolution pipeline:

1. **User Overrides**: Walked configs (`.opencode/oh-my-openagent.jsonc`) or global user config (`~/.config/opencode/oh-my-openagent.jsonc`) under `agents.<agent_name>.fallback_models` or `categories.<category_name>.fallback_models`.
2. **Built-in Agent & Category Requirements**: Defined in `packages/model-core/src/agent-model-requirements.ts` and `packages/model-core/src/category-model-requirements.ts`.
3. **Session Model Inheritance / System Default**: If no specific model in the fallback chain is connected, the agent inherits the active session model or falls back to the system default model configured in OpenCode.
4. **Dynamic Prompt Selection**: Several agents (`sisyphus`, `atlas`, `sisyphus-junior`, `metis`, `momus`) dynamically select model-family-tailored prompts at runtime depending on the resolved model.

### Reasoning Ladder (`packages/model-core/src/reasoning-level.ts`)

The reasoning level ladder defines standard variants:
`"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"` (plus `"auto"`).

- **Variant Normalization**: Mapped per model family in `packages/model-core/src/model-settings-compatibility.ts`.
- **Reasoning Effort vs. Variant**: For OpenAI/GPT models, `variant: "high"` maps to `reasoningEffort: "high"`; `variant: "xhigh"` maps to `reasoningEffort: "xhigh"` (GPT-5.6 / GPT-5.5 / o-series).
- **Thinking Tokens**: For Claude models, `variant` maps to thinking token budgets (e.g. `max` -> maximum output tokens, `high` -> 16k tokens, `low` -> 4k tokens).
- **Temperature Handling**: Models in reasoning modes (o-series, Claude with thinking enabled) disallow or ignore custom temperatures; non-reasoning and standard generation models default to `temperature: 0.1` unless specified.

---

## 2. Reasoning Style Families

| Family | Reasoning Style & Behavioral Contract | Default Prompting Strategy |
|---|---|---|
| **Claude Family** | Mechanics-driven, strict tool sequence adherence, structured thinking blocks, explicit step-by-step verification gates. | Deep ~1,100-line operational prompts (`opus-4-7.md`, `default.md`). |
| **GPT-5 / OpenAI Family** | Principle-driven, high reasoning effort, strategic tradeoffs, explicit decision criteria, minimal AI filler. | Compact, principle-focused GPT-native prompts (`gpt.md`, `gpt-5-5`). |
| **Gemini Family** | Fast multi-tool execution, high context-window utilization, short-turn reasoning, supervised background operation. | Streamlined tool-first prompts (`gemini.md`), short-prompt compact limits for Gemma. |
| **Kimi Family** | High-throughput thinking models (K3 / K2.7 / K2.6), autonomous loops with explicit stop conditions against circular overthinking. | Calibrated Kimi-native variants (`kimi-k3.md`, `kimi-k2-7.md`). |
| **GLM / MiniMax Family** | Fast inference, cost-effective search and grep, strict format matching. | Calibrated minimal templates (`glm.md`, `minimax`). |

---

## 3. Built-In Primary & Subagents Matrix

### Sisyphus (Primary Orchestrator)
- **Role**: Primary lead agent. Analyzes requests, decomposes work, coordinates specialists, tracks progress, and executes tasks.
- **Guidance Doc Description**: *"The Sociable Lead... knows everyone, goes everywhere, and gets things done through communication and coordination. Talks to other agents, understands context across the whole codebase, delegates work intelligently."*
- **Prompt Variants**:
  - `anthropic/*` -> `packages/prompts-core/prompts/sisyphus/opus-4-7.md`
  - `openai/gpt-5*` -> `packages/prompts-core/prompts/sisyphus/gpt.md`
  - `moonshotai/kimi-k3*` -> `packages/prompts-core/prompts/sisyphus/kimi-k3.md`
  - `moonshotai/kimi-k2*` -> `packages/prompts-core/prompts/sisyphus/kimi-k2-7.md`
  - `zai/glm-5*` -> `packages/prompts-core/prompts/sisyphus/glm.md`
- **Fallback Chain & Settings** (`packages/model-core/src/agent-model-requirements.ts:4`):
  1. `claude-opus-5` (Anthropic, Copilot, OpenCode, Vercel) — `variant: "max"`, `temperature: 0.1`
  2. `kimi-k3` (OpenCode-Go, Moonshot, Kimi, Bailian, Firmware, Ollama Cloud) — `variant: "max"`, `temperature: 0.1` *(Note: duplicate provider entries collapsed)*
  3. `gpt-5.6-sol` (OpenAI, Copilot, OpenCode, Vercel) — `variant: "medium"`, `temperature: 0.1`
  4. `glm-5.2` (ZAI, OpenCode, Bailian, Vercel) — `variant: "max"`, `temperature: 0.1`
  5. `big-pickle` [GLM 4.6] (OpenCode) — `variant: "off"`, `temperature: 0.1`
- **Validation**: Matches code. `requiresAnyModel: true` enforces at least one model in chain must resolve.

---

### Hephaestus (Autonomous Deep Specialist)
- **Role**: Deep autonomous coding and architecture specialist. Solves hard technical problems in isolation.
- **Guidance Doc Description**: *"The Deep Specialist... stays in their room coding all day. Give them a hard technical problem and they'll emerge three hours later with a solution nobody else could have found... Autonomous deep exploration without hand-holding, principle-driven execution."*
- **Model Allowlist Constraint** (`packages/omo-opencode/src/agents/hephaestus/agent.ts`): Strictly requires `gpt-5.3-codex`, `gpt-5.4`, `gpt-5.5`, or `gpt-5.6`. Any other model fails initialization.
- **Fallback Chain & Settings** (`packages/model-core/src/agent-model-requirements.ts:32`):
  1. `gpt-5.6-sol` (OpenAI, Copilot, Vercel, OpenCode) — `variant: "medium"`, `temperature: 0.1`, `permission: { "*": "allow" }`
- **Validation**: Matches code. Hard model allowlist enforced at registration and doctor check.

---

### Prometheus (Strategic Plan Consultant)
- **Role**: Pre-planning exploration and work-plan authoring (`.omo/plans/*.md`).
- **Guidance Doc Description**: *"Explore-first planning consultant that grounds in the codebase, asks only the forks exploration cannot resolve - or researches them to best practice when the intent is fuzzy - waits for explicit approval, then writes ONE decision-complete work plan a worker executes with zero further interview."*
- **Permissions**: Read-only + markdown-only writes (`packages/omo-opencode/src/hooks/tool-guard/prometheus-md-only.ts`).
- **Fallback Chain & Settings** (`packages/model-core/src/agent-model-requirements.ts:102`):
  1. `claude-fable-5` (Anthropic, Copilot, OpenCode, Vercel) — `variant: "xhigh"`, `temperature: 0.1`
  2. `kimi-k3` (OpenCode-Go, Moonshot, Kimi, OpenCode, Vercel) — `variant: "max"`, `temperature: 0.1`
- **Validation**: Matches code. If neither model is available, falls back to the active session model or system default.

---

### Atlas (Master Orchestrator / Todo Executor)
- **Role**: Todo list coordinator and parallel subagent dispatcher.
- **Guidance Doc Description**: *"Master Orchestrator agent that coordinates specialized agents to complete todo lists... Communicative, instruction-following. Auto-switches to dedicated GPT prompt variant when running on GPT models."*
- **Prompt Variants**: Dynamic prompt selector supporting Claude (`opus-4-7.md`), GPT (`gpt.md`), Gemini (`gemini.md`), Kimi (`kimi-k3.md`, `kimi-k2-7.md`), and GLM (`glm.md`).
- **Fallback Chain & Settings** (`packages/model-core/src/agent-model-requirements.ts:157`):
  1. `claude-sonnet-5` (Anthropic, Copilot, OpenCode, Vercel) — `variant: "low"`, `temperature: 0.1`
  2. `kimi-k3` (OpenCode-Go, Vercel) — `variant: "max"`, `temperature: 0.1`
  3. `gpt-5.6-sol` (OpenAI, Copilot, OpenCode, Vercel) — `variant: "medium"`, `temperature: 0.1`
  4. `minimax-m3` (OpenCode-Go, Vercel, MiniMax) — `variant: "max"`, `temperature: 0.1`
  5. `minimax-m2.7` (OpenCode-Go, Vercel) — `variant: "max"`, `temperature: 0.1`
- **Validation**: Matches code.

---

### Oracle (High-IQ Architecture & Debugging Consultant)
- **Role**: Read-only consultation agent for difficult architecture design, multi-system tradeoffs, and root-cause debugging.
- **Guidance Doc Description**: *"Read-only consultation agent. High-IQ reasoning specialist for debugging hard problems and high-difficulty architecture design."*
- **Permissions**: Read-only (`edit`, `write`, `bash` disallowed).
- **Fallback Chain & Settings** (`packages/model-core/src/agent-model-requirements.ts:43`):
  1. `gpt-5.6-sol` (OpenAI, OpenCode, Vercel) — `variant: "xhigh"`, `temperature: 0.1`
  2. `gpt-5.6-sol` (Copilot) — `variant: "high"`, `temperature: 0.1`
  3. `gemini-3.1-pro` (Google, Copilot, OpenCode, Vercel) — `variant: "high"`, `temperature: 0.1`
  4. `claude-opus-5` (Anthropic, Copilot, OpenCode, Vercel) — `variant: "max"`, `temperature: 0.1`
  5. `glm-5.2` (OpenCode-Go, Vercel) — `variant: "max"`, `temperature: 0.1`
- **Validation**: Matches code. High/xhigh reasoning variants prioritized.

---

### Librarian (External Reference & Documentation Search)
- **Role**: Search external reference docs, OSS implementations, library APIs, and GitHub repositories.
- **Guidance Doc Description**: *"Specialized codebase understanding agent for multi-repository analysis, searching remote codebases, retrieving official documentation, and finding implementation examples using GitHub CLI, Context7, and Web Search."*
- **Fallback Chain & Settings** (`packages/model-core/src/agent-model-requirements.ts:68`):
  1. `gpt-5.6-luna-fast` (OpenAI) — `variant: "low"`, `temperature: 0.1`
  2. `deepseek-v4-flash` (DeepSeek) — `variant: "max"`, `temperature: 0.1`
  3. `qwen3.7-plus` (OpenCode-Go, Bailian) — `variant: "max"`, `temperature: 0.1`
  4. `minimax-m2.7-highspeed` (Vercel) — `variant: "max"`, `temperature: 0.1`
  5. `minimax-m3` (OpenCode-Go, Vercel, MiniMax) — `variant: "max"`, `temperature: 0.1`
  6. `minimax-m2.7` (OpenCode-Go, Vercel) — `variant: "max"`, `temperature: 0.1`
  7. `claude-haiku-4-5` (Anthropic, Copilot, Vercel) — `variant: "off"`, `temperature: 0.1`
  8. `gpt-5.4-nano` (OpenAI, Vercel) — `variant: "off"`, `temperature: 0.1`
- **Validation**: Matches code. Fast, cost-efficient models with high concurrency.

---

### Explore (Internal Codebase Search / Contextual Grep)
- **Role**: Search internal codebase structure, discover cross-layer patterns, locate files.
- **Guidance Doc Description**: *"Contextual grep for codebases. Answers 'Where is X?', 'Which file has Y?', 'Find the code that does Z'."*
- **Fallback Chain & Settings** (`packages/model-core/src/agent-model-requirements.ts:81`):
  1. `gpt-5.6-luna-fast` (OpenAI) — `variant: "low"`, `temperature: 0.1`
  2. `deepseek-v4-flash` (DeepSeek) — `variant: "max"`, `temperature: 0.1`
  3. `qwen3.7-plus` (OpenCode-Go, Bailian) — `variant: "max"`, `temperature: 0.1`
  4. `minimax-m2.7-highspeed` (Vercel) — `variant: "max"`, `temperature: 0.1`
  5. `minimax-m3` (OpenCode-Go, Vercel, MiniMax) — `variant: "max"`, `temperature: 0.1`
  6. `minimax-m2.7` (OpenCode-Go, Vercel) — `variant: "max"`, `temperature: 0.1`
  7. `claude-haiku-4-5` (Anthropic, Copilot, Vercel) — `variant: "off"`, `temperature: 0.1`
  8. `gpt-5.4-nano` (OpenAI, Vercel) — `variant: "off"`, `temperature: 0.1`
- **Validation**: Matches code. Mirrors Librarian chain for rapid parallel execution.

---

### Multimodal-Looker (Media & Diagram Extractor)
- **Role**: Interpret and extract data from media files (PDFs, images, diagrams, screenshots).
- **Guidance Doc Description**: *"Analyze media files (PDFs, images, diagrams) that require interpretation beyond raw text. Extracts specific information or summaries from documents, describes visual content."*
- **Permissions**: Read-only media extraction (`read`, `look_at` only).
- **Fallback Chain & Settings** (`packages/model-core/src/agent-model-requirements.ts:94`):
  1. `gpt-5.6-sol` (OpenAI, OpenCode, Vercel) — `variant: "low"`, `temperature: 0.1`
  2. `kimi-k3` (OpenCode-Go, Vercel) — `variant: "max"`, `temperature: 0.1`
  3. `glm-4.6v` [Vision] (ZAI, Vercel) — `variant: "max"`, `temperature: 0.1`
  4. `gpt-5-nano` (OpenAI, Copilot, OpenCode, Vercel) — `variant: "off"`, `temperature: 0.1`
- **Validation**: Matches code. Vision-capable models prioritized.

---

### Metis (Pre-Planning Consultant)
- **Role**: Analyze requirements to identify hidden intentions, ambiguities, and AI failure points before planning.
- **Guidance Doc Description**: *"Pre-planning consultant that analyzes requests to identify hidden intentions, ambiguities, and AI failure points."*
- **Prompt Variants**: Full prompt vs `METIS_K2_7_SYSTEM_PROMPT` for Kimi models.
- **Fallback Chain & Settings** (`packages/model-core/src/agent-model-requirements.ts:112`):
  1. `claude-opus-5` (Anthropic, Copilot, OpenCode, Vercel) — `variant: "high"`, `temperature: 0.3` (Claude thinking enabled)
  2. `kimi-k3` (OpenCode-Go, Kimi, Moonshot, OpenCode, Vercel) — `variant: "low"`, `temperature: 0.3`
- **Validation**: Matches code. Note higher `temperature: 0.3` to encourage analytical exploration.

---

### Momus (Work Plan Critic & Reviewer)
- **Role**: Evaluate written work plans against clarity, verifiability, and completeness standards.
- **Guidance Doc Description**: *"Expert reviewer for evaluating work plans against rigorous clarity, verifiability, and completeness standards."*
- **Prompt Variants**: `MOMUS_GPT_5_6_PROMPT` (high reasoning effort + high text verbosity) vs `MOMUS_DEFAULT_PROMPT`.
- **Fallback Chain & Settings** (`packages/model-core/src/agent-model-requirements.ts:122`):
  1. `gpt-5.6-terra` (OpenAI, Vercel) — `variant: "high"`, `temperature: 0.1`
  2. `gpt-5.6-terra` (Copilot) — `variant: "high"`, `temperature: 0.1`
  3. `gpt-5.6-sol` (OpenAI, OpenCode, Vercel) — `variant: "xhigh"`, `temperature: 0.1`
  4. `gpt-5.6-sol` (Copilot) — `variant: "high"`, `temperature: 0.1`
  5. `claude-opus-5` (Anthropic, Copilot, OpenCode, Vercel) — `variant: "max"`, `temperature: 0.1`
  6. `gemini-3.1-pro` (Google, Copilot, OpenCode, Vercel) — `variant: "high"`, `temperature: 0.1`
  7. `glm-5.2` (OpenCode-Go, Vercel) — `variant: "max"`, `temperature: 0.1`
- **Validation**: Matches code.

---

### Sisyphus-Junior (Focused Subagent Executor)
- **Role**: Focused single-task executor spawned by category delegations.
- **Guidance Doc Description**: *"Focused task executor. Same discipline, no delegation."*
- **Prompt Variants**: Dynamic prompt router for Claude, GPT-5.5/5.6, GPT-5.4, Gemini, Kimi (K3, K2.7, K2.6), and GLM.
- **Fallback Chain & Settings** (`packages/model-core/src/agent-model-requirements.ts:171`):
  1. `claude-sonnet-5` (Anthropic, Copilot, OpenCode, Vercel) — `variant: "low"`, `temperature: 0.1`, `maxTokens: 64000`
  2. `kimi-k3` (OpenCode-Go, Vercel) — `variant: "max"`, `temperature: 0.1`
  3. `gpt-5.6-sol` (OpenAI, Copilot, OpenCode, Vercel) — `variant: "medium"`, `temperature: 0.1`
  4. `minimax-m3` (OpenCode-Go, Vercel, MiniMax) — `variant: "max"`, `temperature: 0.1`
  5. `minimax-m2.7` (OpenCode-Go, Vercel) — `variant: "max"`, `temperature: 0.1`
  6. `big-pickle` [GLM 4.6] (OpenCode) — `variant: "off"`, `temperature: 0.1`
- **Validation**: Matches code.

---

## 4. Subagent Task Categories Matrix (`CATEGORY_MODEL_REQUIREMENTS`)

Source: `packages/model-core/src/category-model-requirements.ts`

| Category | Domain & Guidance | Fallback Chain (in order) | Default Settings |
|---|---|---|---|
| **`visual-engineering`** | Frontend, UI/UX, Design, CSS, Animation. Enforces design-system-first protocol. | 1. `claude-opus-5`<br>2. `kimi-k3`<br>3. `glm-5.2`<br>4. `gpt-5.6-sol` | `variant: "max"` (Claude/Kimi/GLM), `variant: "medium"` (GPT), `temperature: 0.1` |
| **`ultrabrain`** | Hard logic, complex algorithms, multi-system tradeoffs. Strategic advisor mindset. | 1. `gpt-5.6-sol` | `variant: "max"`, `temperature: 0.1`, `requiresModel: "gpt-5.6-sol"` |
| **`deep`** | Goal-oriented autonomous problem-solving. Extended exploration budget. | 1. `gpt-5.6-sol` | `variant: "medium"`, `temperature: 0.1`, `requiresModel: "gpt-5.6-sol"` |
| **`artistry`** | Complex creative problem-solving beyond standard patterns. | 1. `claude-fable-5`<br>2. `kimi-k3`<br>3. `claude-opus-5` | `variant: "xhigh"` (Fable/Opus), `variant: "max"` (Kimi), `temperature: 0.1` |
| **`quick`** | Trivial tasks, single-file edits, typo fixes. Low overhead. | 1. `kimi-for-coding-highspeed`<br>2. `gpt-5.6-luna-fast`<br>3. `deepseek-v4-flash`<br>4. `qwen3.6-flash`<br>5. `minimax-m3`<br>6. `minimax-m2.7`<br>7. `grok-4.20-0309-non-reasoning`<br>8. `claude-haiku-4-5` | `variant: "off"` (Kimi/Grok/Haiku), `variant: "low"` (Luna/Qwen), `variant: "max"` (DeepSeek/MiniMax), `temperature: 0.1` |
| **`unspecified-low`** | Moderate unclassified tasks with low-to-medium effort. | 1. `gpt-5.6-terra`<br>2. `claude-sonnet-5`<br>3. `qwen3.8-max-preview`<br>4. `deepseek-v4-pro`<br>5. `mimo-v2.5-pro` | `variant: "high"` (Terra), `variant: "low"` (Sonnet), `variant: "max"` (Qwen/DeepSeek/MiMo), `temperature: 0.1` |
| **`unspecified-high`** | Broad unclassified tasks with cross-module impact. | 1. `kimi-k3`<br>2. `claude-opus-5`<br>3. `gpt-5.6-sol` | `variant: "max"` (Kimi), `variant: "xhigh"` (Opus), `variant: "high"` (GPT), `temperature: 0.1` |
| **`writing`** | Technical prose, documentation, release notes, clean markdown. | 1. `kimi-k3`<br>2. `claude-opus-5`<br>3. `gemini-3.6-flash` | `variant: "low"` (Kimi/Opus), `variant: "off"` (Gemini), `temperature: 0.1` |

---

## 5. Custom Unity Game-Dev Subagents Matrix

All Unity subagents live in `.opencode/agents/` and enforce the SuperMCP bridge-only architecture (Roslyn pre-flight validation, domain reload awareness, zero host filesystem write permissions).

| Agent | Purpose | Primary Model | Temperature | Reasoning / Variant | Tool Whitelist / Permissions |
|---|---|---|---|---|---|
| **`unity-gamedev`** | End-to-end game dev orchestrator across scene, script, asset, and build. | `anthropic/claude-sonnet-4-6` | `0.1` | `variant: "high"` | SuperMCP bridge tools + AFT search/zoom (`edit`/`write`/`bash` denied). |
| **`unity-editor`** | Scoped single-domain executor (scene, script, asset, build, runtime, bootstrap). | `opencode/gemini-3.5-flash-lite` | `0.1` | `variant: "off"` (default) | Bridge domain skills + AFT search/zoom (`*`: deny). |
| **`unity-script-roslyn`** | C# script specialist with Roslyn AST pre-flight and compile-status verification. | `opencode/gemini-3.5-flash-lite` | `0.1` | `variant: "off"` (default) | `script_*`, `compile_*`, `console_get_logs`, `test_run_*`, AFT tools. |
| **`unity-scene`** | Hierarchy, GameObject, prefab, and spatial query specialist (~45 tools). | `opencode/gemini-3.5-flash-lite` | `0.1` | `variant: "off"` (default) | `scene_*`, `gameobject_*`, `prefab_*`, `component_*`, spatial/raycast, AFT tools. |
| **`unity-asset`** | Asset database, material/texture authoring, UXML/USS visual trees. | `opencode/gemini-3.5-flash-lite` | `0.1` | `variant: "off"` (default) | `asset_*`, `material_*`, `texture_*`, `reserialize*`, `ui_*`, `vfx_*`, AFT tools. |
| **`unity-build`** | Synchronous player build target selection and structured report parser. | `opencode/gemini-3.5-flash-lite` | `0.1` | `variant: "off"` (default) | `build_*`, AFT tools. |
| **`unity-runtime`** | Play mode lifecycle control, frame stepping, CPU/GPU profiler capture. | `opencode/gemini-3.5-flash-lite` | `0.1` | `variant: "off"` (default) | `play_mode_*`, `profiler_*`, `game_invoke_action`, `vfx_*`, AFT tools. |
| **`unity-bridge-bootstrap`** | Bridge health check, package installation, modal dialog recovery. | `opencode/gemini-3.5-flash-lite` | `0.1` | `variant: "off"` (default) | `bridge_*`, `checkpoint_*`, `batch_execute`, `modal_*`, `package_*`, AFT tools. |

---

## 6. Extended Models & Ingestion Mapping Matrix

This section maps new model candidates (Gemini Antigravity/CLI, NVIDIA NIM/Nemotron, Meta, Mistral, Thinking Machines) into agent and category slots, with binary instruction-type annotations:
- **`fits-existing`**: Operates effectively using an existing prompt path (`claude-family`, `gpt-family`, or `gemini-family`).
- **`needs-custom`**: Requires a bespoke agent instruction template to prevent format drift, infinite loops, or tool calling failures.

| Model ID | Provider / Engine | Target Agent / Category Slots | Reasoning Family | Instruction Type Annotation | Target Prompt Path / Implementation Notes | Recommended Settings |
|---|---|---|---|---|---|---|
| `google/gemini-3.1-pro` | Google Antigravity / Vertex | `oracle`, `momus`, `ultrabrain`, `unspecified-high` | Gemini-Native | **`fits-existing`** | Maps to `gemini.md` prompt family with thinking enabled. High reasoning depth. | `variant: "high"`, `temperature: 0.1` |
| `google/gemini-3.6-flash` | Google Antigravity / API | `writing`, `atlas`, `sisyphus-junior`, `unspecified-low` | Gemini-Native | **`fits-existing`** | Maps to `gemini.md`. Fast structured generation and markdown formatting. | `variant: "off"`, `temperature: 0.1` |
| `opencode/gemini-3.5-flash-lite` | Gemini CLI / OpenCode | `explore`, `librarian`, `quick`, `unity-editor` (all sub-executors) | Gemini-Native | **`fits-existing`** | Maps to `gemini.md`. High throughput, low cost for atomic tool operations. | `variant: "off"`, `temperature: 0.1` |
| `google/gemma-4-31b-it` | Google Free-Tier / CLI | `quick` (short-prompt only) | Gemini-Native | **`needs-custom`** | Strict 16k rolling token ceiling. Rejects thinking blocks. Requires compact prompt without multi-turn history. | `variant: "off"`, `temperature: 0.1`, `maxTokens: 8192` |
| `nvidia/nemotron-3-ultra-550b-a55b` | NVIDIA NIM | `oracle`, `momus`, `ultrabrain`, `unspecified-high` | GPT-Reasoning Compatible | **`fits-existing`** | Maps to `gpt.md` prompt family. Strong structured reasoning and formal logic. | `variant: "high"`, `temperature: 0.1` |
| `nvidia/nemotron-3-super-120b-a12b` | NVIDIA NIM | `sisyphus`, `atlas`, `unspecified-low`, `deep` | GPT-Reasoning Compatible | **`fits-existing`** | Maps to `gpt.md`. Excellent balance of code intelligence and orchestration throughput. | `variant: "medium"`, `temperature: 0.1` |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | NVIDIA NIM | `explore`, `librarian`, `quick`, `unity-script-roslyn` | GPT-Reasoning Compatible | **`fits-existing`** | Maps to `gpt.md` (fast variant). High-speed tool caller for search and atomic edits. | `variant: "low"`, `temperature: 0.1` |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | NVIDIA NIM | `multimodal-looker`, `quick`, `unity-scene` | GPT-Reasoning Compatible | **`needs-custom`** | Multimodal reasoning model. Needs custom vision+reasoning prompt to balance image analysis and structured output. | `variant: "medium"`, `temperature: 0.1` |
| `meta/muse-glimmer-30b` | Meta / OpenCode-Go | `artistry`, `writing`, `unspecified-low` | Claude Compatible | **`fits-existing`** | Maps to `default.md` / Claude-style creative instruction path. Strong unconventional ideation. | `variant: "low"`, `temperature: 0.2` |
| `mistralai/mistral-nemotron` | Mistral / NVIDIA | `explore`, `librarian`, `quick`, `unity-editor` | GPT-Reasoning Compatible | **`fits-existing`** | Maps to `gpt.md`. High compliance on JSON schemas and strict tool-call constraints. | `variant: "low"`, `temperature: 0.1` |
| `thinkingmachines/inkling` | Thinking Machines | `oracle`, `metis`, `momus`, `ultrabrain` | Dedicated Reasoning | **`needs-custom`** | Pure chain-of-thought engine. Requires custom deliberation harness with explicit step boundaries to prevent token exhaustion. | `variant: "max"`, `temperature: 0.1` |

### 6.1 OpenCode Free Tier Models Matrix

The following models are hosted directly via the OpenCode free-tier infrastructure and are available with zero token cost for workspace agents.

| Model ID | Provider / Engine | Target Agent / Category Slots | Reasoning Family | Instruction Type Annotation | Target Prompt Path / Implementation Notes | Recommended Settings |
|---|---|---|---|---|---|---|
| `opencode/deepseek-v4-flash-free` | OpenCode Free Tier | `explore`, `librarian`, `quick`, `unity-script-roslyn` | DeepSeek / GPT Compatible | **`fits-existing`** | Maps to `packages/prompts-core/prompts/sisyphus/gpt.md` (fast variant). High throughput for search, grep, and atomic line editing. | `variant: "max"`, `temperature: 0.1` |
| `opencode/hy3-free` | OpenCode Free Tier (Hunyuan-3) | `quick`, `writing`, `unspecified-low` | Claude / GLM Compatible | **`fits-existing`** | Maps to `packages/prompts-core/prompts/sisyphus/default.md`. Excellent multilingual coding and technical writing. | `variant: "low"`, `temperature: 0.1` |
| `opencode/laguna-s-2.1-free` | OpenCode Free Tier (Laguna S) | `explore`, `librarian`, `quick`, `unity-editor` | GPT-Reasoning Compatible | **`fits-existing`** | Maps to `packages/prompts-core/prompts/sisyphus/gpt.md`. Lightweight model for structural code search and schema inspection. | `variant: "low"`, `temperature: 0.1` |
| `opencode/ling-3.0-tiny-free` | OpenCode Free Tier (Ling 3.0) | `quick`, `unity-bridge-bootstrap` | Minimal Lightweight | **`needs-custom`** | Ultra-lightweight model for trivial tasks. Requires concise, tool-call-constrained prompt without deep reasoning sections to prevent hallucinations. | `variant: "off"`, `temperature: 0.1`, `maxTokens: 4096` |
| `opencode/longcat-2.0-free` | OpenCode Free Tier (LongCat 2.0) | `librarian`, `writing`, `unspecified-low` | Extended Context | **`fits-existing`** | Maps to `packages/prompts-core/prompts/sisyphus/default.md`. Optimized for long context window ingestion and large reference doc synthesis. | `variant: "low"`, `temperature: 0.1` |
| `opencode/mimo-v2.5-free` | OpenCode Free Tier (MiMo v2.5) | `unspecified-low`, `quick`, `writing`, `sisyphus-junior` | DeepSeek / GLM Compatible | **`fits-existing`** | Maps to `packages/prompts-core/prompts/sisyphus/glm.md`. Matches `mimo-v2.5-pro` in the built-in `unspecified-low` fallback chain. | `variant: "max"`, `temperature: 0.1` |
| `opencode/nemotron-3-ultra-free` | OpenCode Free Tier (Nemotron 3 Ultra) | `oracle`, `momus`, `ultrabrain`, `unspecified-high` | GPT-Reasoning Compatible | **`fits-existing`** | Maps to `packages/prompts-core/prompts/sisyphus/gpt.md`. High-IQ reasoning for complex architecture and verification without API cost. | `variant: "high"`, `temperature: 0.1` |
| `opencode/nemotron-3.5-lightning-free` | OpenCode Free Tier (Nemotron 3.5) | `explore`, `librarian`, `quick`, `unity-editor` (all sub-executors) | GPT-Reasoning Compatible | **`fits-existing`** | Maps to `packages/prompts-core/prompts/sisyphus/gpt.md` (fast variant). High-speed tool execution engine for parallel subagent swarms. | `variant: "low"`, `temperature: 0.1` |

---

## 7. Recommended Integration Checklist for `uc-studio`

When configuring agent models in `uc-studio` or extending `agent-harness` configurations:

1. **Verify Provider Credentials**: Ensure API keys or OAuth headers for `google`, `nvidia`, `anthropic`, and `openai` are populated in the environment.
2. **Set Category Fallbacks**: In `.opencode/oh-my-openagent.jsonc`, declare preferred models under `categories` to take advantage of available high-throughput NIM or Gemini CLI models.
3. **Guard Reasoning Settings**: For models marked `variant: "off"` or `variant: "low"`, do not configure `variant: "xhigh"` as it may cause 400 Bad Request errors on providers that disallow extended thinking.
4. **Enforce Hephaestus Invariant**: Keep Hephaestus pinned strictly to `openai/gpt-5.6-sol` (or compatible `gpt-5.*` engines); do not assign non-GPT models to Hephaestus.
5. **Use Gemini CLI for Sub-Agents**: For rapid subagent tasks (`explore`, `librarian`, Unity sub-executors), `opencode/gemini-3.5-flash-lite` provides the optimal balance of speed, zero token cost, and tool precision.

---

## 8. Research Topic: Dynamic Stage-Aware LLM Gateway (Switchyard Evaluation)

> **RESEARCH & EVALUATION TOPIC ONLY**
> This section documents exploratory research and architectural evaluation of **NVIDIA NeMo Switchyard** (`~/Git/Switchyard` / `NVIDIA-NeMo/Switchyard`). This is a **research topic**, **not** an established execution plan, committed roadmap item, or scheduled implementation. Any future testing would be strictly experimental and feature-flagged.

### 8.1 Concept & Capability Overview

Switchyard is an experimental Rust proxy and embeddable library (`switchyard-libsy`) designed to mediate between coding agents and LLM backends:

- **Protocol Translation**: Translates between OpenAI Chat Completions, Anthropic Messages, and OpenAI Responses formats, allowing agents using Anthropic-specific prompt formats to run against OpenAI-compatible backends (vLLM, NVIDIA NIM, Ollama, OpenCode).
- **Signal-Driven Stage Routing (`stage_router`)**: Dynamically shifts individual turns between a **capable tier** and an **efficient tier** based on tool execution history:
  - *Escalation signals* (pushes to Capable): Tool error severity, repetitive churn without writes (`spinning`), read-only loops (`exploring`).
  - *De-escalation signals* (pushes to Efficient): Sustained file writes and edits (`recent_production_intensity`).
- **Confidence Scoring**: Uses corroborative `tanh`-squashed confidence metrics in `[0, 1]` evaluated against a tunable `confidence_threshold`.

### 8.2 Architectural Tradeoffs & System Fit

| Dimension | Native `agent-harness` Approach | Switchyard Experimental Gateway | Research Considerations |
|---|---|---|---|
| **Routing Granularity** | Static, role-based delegation per agent / category lifecycle. | Dynamic per-turn tiering based on conversational momentum. | Dynamic tiering could reduce expensive model spend during mechanical implementation phases. |
| **Error Recovery** | Reactive fallback upon API failure / quota exhaustion. | Proactive model escalation upon observing code-level error output. | Escalates to high-IQ models as soon as tests fail without waiting for provider errors. |
| **Prompt Caching** | Predictable session prefix retains high cache-hit ratios. | Bouncing between different model families per turn invalidates provider-side prompt caches. | Homogeneous pairing (e.g. Nemotron Ultra <-> Nemotron Lightning) is needed to avoid cache-bust penalties. |
| **Operational Overhead** | In-process TypeScript / OpenCode provider architecture. | Out-of-process Rust daemon (`switchyard-server`) or native FFI binding. | Adds a network hop and external process dependency requiring supervision. |

### 8.3 Open Research Questions for Future Exploration

1. **Prompt Cache Retention**: Does the cost saving from down-tiering to efficient models outweigh the token penalty of busting provider prompt caches when switching models mid-session?
2. **Reasoning Block Normalization**: How reliably does protocol translation handle proprietary thinking blocks (`thought: true`, thought signatures, Anthropic `thinking` structures) without triggering schema rejections?
3. **Tool Call Fidelity**: Does protocol translation between Anthropic `input_schema` and OpenAI `parameters` introduce subtle schema degradation for complex multi-tool calls?
4. **Latency Budget**: What is the net latency impact of the proxy translation layer during rapid parallel subagent dispatch?

