# Learnings — unity-supermcp-subagents

Conventions, patterns, and successful approaches discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## 2026-08-04: Scoped macos-cua Wrapper for Modal Dismissal
- Created `.opencode/skills/unity-modal-dismiss/SKILL.md` as a scoped wrapper for OS-level dialog dismissal.
- Replicated the local MCP block from the user-scope `macos-cua` skill verbatim.
- Documented only `screenshot`, `click`, and `press_keys` tools to restrict the agent's capabilities.
- Mandated the 3-step dismissal priority order:
  1. Bridge `list_pending_modals` → `dismiss_modal`
  2. `bridge_safe_mode_check` for compiler-error/Safe-Mode dialogs
  3. macos-cua screenshot+click ONLY for OS-level dialogs the bridge cannot see (version-upgrade wizard, firewall prompt, terms acceptance).
- Added a `## Machine-specific` section to disclose that the absolute paths make this skill developer-local.

## Task 1 — vendored supermcp-skills package

- Source: `/Volumes/Topper2TB/Git/unitySuperMCP/supermcp-skills/Samples~/AgentSkills/`, repo `https://github.com/rustybret/unitySuperMCP.git`, rev at copy time `21b7c5e1edada80f18868a0e4d41f02c1c31b839`.
- Each of the six domain skills has ONLY a single `SKILL.md` — no sibling reference files present in source (so `skills/<name>/` dirs contain just SKILL.md).
- Vendored SKILL.md sha256 (byte-identical to source, recorded in MANIFEST.json):
  - unity-asset: `3bda3687ccaeef3117d78a5f73c4e92d75731beff86c48b3d74c7cd97e00db9b`
  - unity-bridge-bootstrap: `b2dd14f53334f9912cd76bdff10b805a55f64dc7b13a9ee6e671574a2530921a`
  - unity-build: `443073eed9df04c647ab32f2910c216bda975a9fa123075f4341b4916800fcad`
  - unity-runtime: `72dec037cf53b0d8dad2840df9f8f147552301cb4ccea387849dd7c527d812da`
  - unity-scene: `e8f06c28e83660b2aba6d19d897f13617bc3f5c67fbfefe600510629488364b5`
  - unity-script-roslyn: `b6649b1c3de7a22c5e69a93f8d6da7f7c6b4a6a77cbadaac83e38299a8cacb82`
- Frontmatter confirmed intact: `mcp: supermcp {type: remote, url: http://127.0.0.1:27182/mcp}` — do NOT rewrite when vendoring (only QA fixtures rewrite the port, on scratch copies).
- Sync script idempotency trick: only bump `synced_at` when file set or source_rev actually changes, else MANIFEST.json stays byte-identical → clean `git diff` on no-op re-runs. Validate `--source` (dir exists + all six SKILL.md present) BEFORE wiping/copying dest so a bad source causes zero partial writes.
- Package is content-only: NO package.json inside `packages/supermcp-skills/`, NOT registered in root workspaces/files. Task 3 wires it via `skills.sources` in `.omo/omo.jsonc` (relative path `packages/supermcp-skills/skills`).
- Downstream (task 10) caveat to remember: `skills.sources` entries spread FIRST in dedup, first-occurrence wins → vendored `unity-scene` (pointing at 27182) SHADOWS any project-local copy. QA must use scratch fixture dirs, not project-local skill copies.
# Learnings - Unity SuperMCP Subagents

## Task 4: Remediate dead unity-gamedev.json into a working unity-gamedev.md agent
- Both the compatibility layer (`claude-code-compat-core`) and the native OpenCode agent loader only scan for `.md` files under `{agent,agents}/**/*.md`.
- `.json` agent configurations are dead config and are never loaded.
- Remediating `.json` agents to `.md` agents with YAML frontmatter is the correct way to define agents in the new harness architecture.
- The frontmatter supports `description`, `mode`, `model`, `variant`, and `temperature`.

## Task 3: Wire vendored skills via skills.sources in project .omo/omo.jsonc
- Added the `"skills"` configuration under the existing `"[opencode]"` block in `.omo/omo.jsonc`.
- Configured `"sources"` to point to the relative path `"packages/supermcp-skills/skills"` with `"recursive": true`.
- Added a JSONC comment documenting the sync script: `// vendored unitySuperMCP domain skills, synced manually via packages/supermcp-skills/scripts/sync-from-source.mjs`.
- Validated that the configuration parses correctly as JSONC using the project's `parseJsonc` utility.

## Task 5: Option A restricted unity-editor.md agent
- Created `.opencode/agents/unity-editor.md` (native OpenCode markdown agent, mode: subagent, model: opencode/gemini-3.5-flash-lite, temperature: 0.1).
- Permission-map ORDER matters: write `"*": deny` FIRST, then per-tool `allow` (skill, skill_mcp, read, question, todowrite). OpenCode uses `propertyOrder: "original"` + last-match-wins precedence (permission.ts:17-41), so the broad deny must precede the narrow allows or it would clobber them.
- Verified permission parse with js-yaml → byte-exact match to spec. `todoread` intentionally omitted (tool does not exist in OpenCode = dead config). No `hidden`, no deprecated `tools:`, no fabricated `allowed_tools`/`auto_load_skills`.
- Discipline text adapted from `.opencode/agents/unity-gamedev.md` (NOT the stale `.opencode/prompts/unity-gamedev.md`, which todo 4 deleted). Stripped ALL filesystem-tool references (bash/edit/write/aft_) since this is the restricted variant.
- Grep-for-forbidden-tools gotcha: `\b(bash|edit|write)\b` produces false positives from the "build" Unity domain token, the "no bash" restriction phrase, and "write alone" (English verb for a bridge script write). Confirm each hit is a negation/domain-token/verb, not a tool instruction. `aft_` matched zero.
- Six-row domain→skill table + blocked-on-ambiguous-domain rule (return `Status: blocked`, never guess) are the core Option-A-specific behaviors that distinguish it from the domain-fixed Option B agents (todos 6/7).

## Task 6: Option B agents (1/2) — unity-scene, unity-script-roslyn, unity-asset
- Created three domain-FIXED subagents: `.opencode/agents/{unity-scene,unity-script-roslyn,unity-asset}.md`.
- Config block (mode/model/temperature/permission) is byte-identical across all three AND byte-identical to sibling `unity-editor.md` (verified via `diff` on the `mode:`→`---` slice: SCENE==EDITOR IDENTICAL). Only `description` differs per agent. Confirms the shared template held across parallel tasks 5 and 6.
- Key Option-B vs Option-A distinction: NO domain-selection. Each body has a "First Action (ALWAYS)" that loads exactly ONE fixed skill (`skill(name="unity-scene"|...)`), then `bridge_status` + `get_relevant_tools(role="scene"|"scripting"|"asset")`. No `Domain:` line parsing, no domain→skill table (those are Option-A/unity-editor only).
- Out-of-domain rule is the shared safety valve: task needing another domain → `Status: blocked` naming the correct agent, with explicit "never load a second domain skill" guard. Same six-agent routing list as unity-editor, but as a REJECT path not a SELECT path.
- Domain-specific discipline only (no cross-domain bloat): scene = prefab-stage check + modal flow + idempotency + spatial/HC-7 visibility semantics; script-roslyn = script_validate preflight + TOCTOU MD5 guard + full compile gate + console_get_logs runtime-error check + test_run main-thread caveat; asset = import-ordering + UTF-8-NoBOM + reserialize async job polling (reserialize_status) + external_change_detected write safety.
- role= values used: `get_relevant_tools(role="scene")`, `role="scripting")` (NOT "script-roslyn"), `role="asset")`.
- Forbidden-tool grep gotcha (same as task 5): `\b(bash|edit|write)\b` false-positives on prose — "a write call", "external edit", the out-of-domain routing line "C# script create/edit/validate/delete", and Roslyn "before every write". Each hit confirmed prose/verb/domain-token, not a harness-tool instruction. `aft_` and `interactive_bash` matched zero.
- Evidence: `.omo/evidence/20260804-unity-subagents/task-6/evidence.md` (YAML parse, byte-identical diff, single-skill-load counts, out-of-domain counts, clean forbidden grep).

## Task 7: Option B agents (unity-build / unity-runtime / unity-bridge-bootstrap)
- Created three restricted domain subagents under `.opencode/agents/`, cloned from task-5's `unity-editor.md` template.
- Byte-identical config-block sha256 across all three AND the sibling `unity-editor.md`: `871811709937957c99dfba3981034fb1c9b4b76fb8b29b1ab0a33fd5e49f4001` (covers mode→end-of-frontmatter: `mode: subagent`, `model: opencode/gemini-3.5-flash-lite`, `temperature: 0.1`, permission map `"*": deny` + skill/skill_mcp/read/question/todowrite allow).
- Key difference from task-5 `unity-editor.md`: these load exactly ONE FIXED skill (no `Domain:` selection table) as first action `skill(name="unity-<domain>")`, and use an `## Out-of-Domain Rule` section that returns `Status: blocked` naming the correct sibling agent instead of loading a second skill.
- GOTCHA: forbidden-tool grep (`\b(bash|edit|write|aft_)\b`) false-positived on the domain phrase "C# script create/edit" in the hand-off table. Reworded to "C# script authoring" to keep grep strictly clean. When writing these agents, avoid the literal word "edit"/"write"/"bash" even in prose.
- Required plan literals confirmed present: `build_select_target` (build), `scene_wait_for_start` (runtime), `checkpoint_create` (bridge-bootstrap).
- `get_relevant_tools(role="<domain>")` role strings used: `build`, `runtime`, `bridge-bootstrap`.
- Evidence: `.omo/evidence/20260804-unity-subagents/task-7/evidence.md`.
- Verified via `bun -e` + `yaml` lib that all three frontmatters parse (perm.keys=6 each).

## Task 8: Fast model fallback chains for all seven restricted agents (config-only)
- Configured identical `fallback_models` arrays for all seven restricted agents (`unity-editor`, `unity-scene`, `unity-script-roslyn`, `unity-asset`, `unity-build`, `unity-runtime`, `unity-bridge-bootstrap`) under the existing `"[opencode]"` block in `.omo/omo.jsonc`.
- The fallback chain uses the modern `reasoning` field (not the deprecated `variant`) for reasoning-tier models: `openai/gpt-5.5` (reasoning: low) and `anthropic/claude-opus-5` (reasoning: low).
- The fallback chain consists of: `[{"model": "openai/gpt-5.5", "reasoning": "low"}, "opencode/deepseek-v4-flash-free", {"model": "anthropic/claude-opus-5", "reasoning": "low"}, "opencode/gemini-3.6-flash", "opencode/gemini-3.5-flash", "opencode/gemini-3-flash", "google/gemma-4-31b-it"]`.
- Added a JSONC comment explaining the chain rationale and the Gemma-4 16k input-tokens/min rolling free-tier caveat (short-prompt last resort only).
- Verified that `unity-gamedev` has no fallback chain configured (keeps its frontmatter-only model).
- Verified that `packages/model-core/` remains untouched.
- Verified that `.omo/omo.jsonc` parses successfully as JSONC.
- Evidence recorded at `.omo/evidence/20260804-unity-subagents/task-8/`.
