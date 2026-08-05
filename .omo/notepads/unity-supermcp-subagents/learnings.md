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

## 2026-08-04: Unity Subagent Benchmark Procedure Documented
- Created `docs/reference/unity-subagent-benchmark.md` detailing the A-vs-B live benchmark procedure.
- Documented preconditions including webgameECS path `/Volumes/Topper2TB/Git/webgameECS` and BEAM start command `unity-bridge/Editor~/server/supermcp start`.
- Defined a 6-task suite mapping Option A (`unity-editor` + `Domain:` line) and Option B (domain-specific subagents) with exact prompts and pass conditions.
- Established metrics (wall-clock, turns, tool calls, tokens, status, violations) and winner criteria.
- Set up results template and evidence layout path pattern `.omo/evidence/<date>-unity-ab-bench/<task>/<option>/`.
- Added the document to the `docs/AGENTS.md` index table.
- Performed a self-audit with a seeded error to verify structural linting, recorded at `.omo/evidence/20260804-unity-subagents/task-11/self-audit.md`.

## Task 9: Sandbox QA — registration, permission enforcement, dispatch mode
- Verified against opencode v1.18.11. Evidence: `.omo/evidence/20260804-unity-subagents/task-9/` (README + raw/).
- (a) REGISTRATION: isolated `opencode serve` + bootstrap `GET /agent?directory=<repo>` (lazy plugin init, memory #2092 confirmed — bootstrap request needed). All 8 unity agents register non-hidden. The `/agent` endpoint returns `permission` as an ORDERED array of `{permission, pattern, action}`; resolve effective per-tool via last-match-wins on entries where `permission==tool||"*"` and `pattern=="*"`. All 7 restricted agents evaluate EXACTLY to `*`:deny + skill/skill_mcp/read/question/todowrite:allow + bash/edit/write/task/webfetch/websearch:deny. unity-gamedev control = `*`:allow.
- (b) DENIAL — CRITICAL nuance: the restricted `permission` map is a SUBAGENT-DISPATCH-TIME control, NOT enforced by `opencode run --agent <name>` (primary mode) — bash executed for BOTH unity-editor and unity-gamedev in primary mode. Enforcement fires ONLY through `task(subagent_type=...)`: `sync-prompt-sender.ts:53-70 buildSyncPromptTools()` maps each permission deny-tool to `false`, STRIPPING bash/edit/write/task/webfetch/websearch from the child toolset before the model sees them. Proven two ways: (1) unity-editor child self-reports "bash tool is not available; available: call_omo_agent, list_mcp_resource_templates, list_mcp_resources, read, read_mcp_resource, skill, skill_mcp, todowrite"; (2) zero bash tool-parts in the child session (sandbox DB). Differential: unrestricted unity-gamedev child ran bash (status=completed, `ls -la` output) → restriction is agent-specific.
- (c) DISPATCH MODE — SYNC, flash-lite NOT forced to background. Runtime: every `task(subagent_type=...)` returned `Task completed in <N>s` inline (never `Background task launched`). Code-path proof `delegate-task/tools.ts:156-222`: forced-background (executeUnstableAgentTask) is gated on `if (delegateTaskArgs.category)` (line 156) — only the CATEGORY path checks `isUnstableAgent`. The subagent_type path is the `else` (line 196) → `executeSyncTask` (line 222), NO unstable-agent detection. `isUnstableTask()` (task-message-analyzer.ts:107-111) flags gemini/minimax models but is consulted ONLY on the category path. **Verbatim for task-12 docs: `task(subagent_type="unity-editor")` with gemini-3.5-flash-lite completes SYNCHRONOUSLY; the unstable-gemini forced-background flag does not apply to subagent_type dispatch.**
- ISOLATION: real DB before=7023 after=7052; the +29 is AMBIENT (QA ran inside a live opencode session writing the real DB). Direct proof instead of raw delta: all 6 probe session titles return 0 rows in the real DB and are present only in the sandbox mktemp DBs. Sandbox DB path = `$XDG_DATA_HOME/opencode/opencode.db`.
- HARNESS gotchas: macOS has no `timeout` binary — use a bg-pid + kill-after-N guard. `opencode serve` sandbox starts with EMPTY config (no plugin, no auth); seed it by writing `$XDG_CONFIG_HOME/opencode/opencode.json` with ONLY `plugin: [file://<repo>/dist/index.js]` and copying real `auth.json` into `$XDG_DATA_HOME/opencode/` (read) so opencode/* + anthropic/* models resolve. `opencode run --agent build` warns "build is a subagent, falling back to default agent" but still runs as a primary that dispatches task() fine. session table has `parent_id` + `agent` columns (not `parentID`); tool parts in `part.data` json (`.type=="tool"`, `.state.status`, `.state.output`).

## Task 10: Sandbox QA — skill→MCP reachability + single-skill discipline via fixture bridge

- **Fixture MCP server must speak streamable-HTTP MCP** (`StreamableHTTPClientTransport` is what `packages/mcp-client-core/src/skill-mcp-manager/http-client.ts` uses). A stateless per-request transport FAILS with `Server not initialized` — the client does initialize → notifications/initialized → tools/call and needs the SAME initialized server. Must keep transports keyed by `mcp-session-id` header (standard SDK pattern: `sessionIdGenerator` + `onsessioninitialized` map + reuse on subsequent requests). MCP SDK server exports: `McpServer` (server/mcp.js), `StreamableHTTPServerTransport` (server/streamableHttp.js), `isInitializeRequest` (types.js). SDK v1.29.0 present in repo.
- **SKILL-DEDUP SHADOWING GOTCHA — REPRODUCED LIVE (confirms task-1 prediction).** All six vendored skills declare the SAME server name `supermcp`. `skill_mcp(mcp_name="supermcp")` resolves that server name across ALL currently-loaded skills, NOT just the one skill the agent loaded. First (buggy) run rewrote only `unity-scene`'s scratch url → fixture, left the other five at 27182: `list_mcp_resources` reached the fixture but `skill_mcp bridge_status` resolved `supermcp` via a sibling skill and hit the REAL bridge on 27182 (answered `No Unity Editor instance is registered`). FIX: rewrite ALL SIX scratch skill urls to the fixture port (`rewrite-all-urls.mjs`), not just the one under test. Sandbox QA must own EVERY vendored skill's url.
- **Subagents cannot be driven with `opencode run --agent <subagent>`** — it prints `agent "X" is a subagent, not a primary agent. Falling back to default agent`. Must dispatch via the DEFAULT PRIMARY agent (Sisyphus) instructing it to call `task(subagent_type=...)`. The primary is injection-hardened: a terse "you are a relay, do exactly one thing, reply verbatim, don't verify" prompt gets REFUSED as an injection shape. A natural first-person "I want the X subagent to handle this, please call task(...)" framing works.
- **Primary also gates on project-type**: Sisyphus refuses to dispatch a Unity request unless the project looks like Unity. Seed markers: `ProjectSettings/ProjectVersion.txt`, `Assets/Scenes/` dir, `AGENTS.md` declaring it Unity + bridge-driven. DO NOT seed a readable `.unity` scene file — the subagent has `read: allow` and will filesystem-shortcut past `scene_list` (answers from the file instead of the bridge). Empty `Assets/Scenes/` forces bridge use.
- **Scenario (a) unity-scene: FULL PASS** — one skill load (`unity-scene`), fixture order `bridge_status`→`get_relevant_tools`→`scene_list`.
- **Scenario (b) unity-editor Domain:scene: PASS on discipline** (Domain line → exactly `unity-scene`, fixture reached) but the `bridge_status`/`get_relevant_tools` grounding preamble is NON-deterministic on fast `gemini-3.5-flash-lite` (one run skipped `get_relevant_tools`). Domain routing solid; grounding-order preamble is a soft instruction the fast model shortcuts.
- **Scenario (c) ambiguous: HONEST FINDING, not a clean pass.** The "blocked + zero fixture traffic" guarantee comes from DEFENSE-IN-DEPTH at the OUTER primary (which refuses to dispatch a vague/injection-shaped request), NOT from the `unity-editor` agent's own ambiguity guard. When the vague prompt IS forwarded into `unity-editor`, the flash-lite model does NOT emit `Status: blocked` — across 2 runs it guessed a domain and loaded TWO skills (`unity-bridge-bootstrap`+`unity-scene`) and drove the fixture. The restricted agent's "missing/ambiguous Domain → Status: blocked without loading a skill" instruction is ignored by the fast dispatch model. Worth tightening the agent prompt OR relying on the primary-layer guard by design. Flag for todo 12 / F-wave.
- **Failure-path: PASS** — fixture killed before run → `skill_mcp` returns readable `Failed to connect to MCP server "supermcp"... Unable to connect` (NOT a hang) → subagent returns `Status: blocked` naming the offline bridge.
- **Isolation proof shape**: real-DB raw count delta is NOT authoritative (ambient live-opencode mailbox activity moved it +36). The authoritative signals: a sample sandbox subagent session id = 0 rows in real DB, and `SELECT count(*) FROM session WHERE directory LIKE '%omo-qa-sandbox%'` = 0 in real DB.
- **Isolated sandbox DB inspection**: `$OMO_QA_ROOT/data/opencode/opencode.db`; V2 schema uses `session` (cols `id`, `parent_id`, `directory`, `title`) + `part` (cols `session_id`, `data` JSON). Subagent sessions have `parent_id NOT NULL`; tool calls are `part.data` JSON `{type:"tool", tool, state:{input,status,error}}`; text is `{type:"text", text}`. Match a scenario's subagent by its first `part` text prefix (`"text":"<prompt-prefix>`), since needles like "List the scenes" collide across scenarios.
- **Evidence**: `.omo/evidence/20260804-unity-subagents/task-10/` — per-scenario `fixture-requests.jsonl` (ordered) + `transcript.jsonl` + `subagent-trail*.txt` + assertion table in README; `fixture-scripts/` holds byte copies of the gitignored harness so evidence is self-contained. `.local-ignore/` is gitignored (verified `git check-ignore`).
- **Rule #2598 honored**: fixture PID tracked and killed individually on teardown; never bound 27182 (fixture + rewrite both hard-refuse 27182).

## Task 12: Documentation, Roadmap, and Coordination
- Created `docs/reference/unity-editor-subagents.md` detailing Option A and Option B subagents, permission model, fallback chains, and sync workflows.
- Added `unity-editor-subagents.md` to `docs/AGENTS.md` index table.
- Updated `.omo/plans/tooling-improvement-roadmap.md` to record the restricted-subagent work as landed and amended P3-9 to revisit after live A/B bench runs.
- Sent coordination `project_message` to `unitysupermcp-7b6c0482` and saved the response receipt to `.omo/evidence/20260804-unity-subagents/task-12/project-message-response.json`.


## F1: Plan Compliance Audit

Verdict: **APPROVE**. All 12 todos re-verified against actual repo state (not notepad claims). All 12 evidence folders present with tested/observed/why-enough/omitted content. Dependency matrix honored. 12 scoped commits landed on `fork/local`.

### Per-todo confirmation (verified against files/config/commits, not claims)
- **T1** `packages/supermcp-skills/` — exactly 6 skill dirs; MANIFEST.json valid, sha256 of unity-scene matched live shasum (`e8f06c28…488364b5`); sync script + README present; commit `28877dbd7`. Evidence README has all 4 sections + happy/failure logs.
- **T2** `.opencode/skills/unity-modal-dismiss/SKILL.md` — valid frontmatter (name/desc/macos-cua mcp block); documents only screenshot/click/press_keys; 3-step priority order + `## Machine-specific`; grep for type_text/drag/scroll = NONE. Commit `264ad2c93`.
- **T3** `.omo/omo.jsonc` skills.sources — inside `"[opencode]"` block, relative path `packages/supermcp-skills/skills`, recursive, JSONC comment present. Commit `602b6f13c`/`d13108de3`.
- **T4** `unity-gamedev.md` created; `.json` + `prompts/unity-gamedev.md` both deleted (confirmed absent); frontmatter model claude-sonnet-4-6/variant high; dead-config code citations. Commit `0fd6e8f97`/`5447d2158`.
- **T5** `unity-editor.md` — permission map byte-exact (`*`:deny + skill/skill_mcp/read/question/todowrite:allow); domain→skill table; blocked-on-ambiguous rule; compile gate; no forbidden-tool instructions. Commit `0fd6e8f97`.
- **T6/T7** six Option B agents — frontmatter config block byte-identical (sha `871811…f4001` across all incl. unity-editor sibling); single-skill-load-first; out-of-domain block rule; required literal grep hits (build_select_target/scene_wait_for_start/checkpoint_create). Commit `0fd6e8f97`.
- **T8** agents.*.fallback_models — all 7 agents present with identical mixed array (reasoning field, not deprecated variant); unity-gamedev has NO chain; model-core untouched (`git diff --stat` empty). Commit `602b6f13c`.
- **T9** sandbox QA README + 29 raw artifacts — registration (8 agents, none hidden), effective permission map matches spec exactly for all 7, bash-denial + differential (unity-gamedev NOT denied), sync dispatch; isolation proven by 0-row real-DB checks. Commit `1cbebda86`.
- **T10** fixture-bridge QA — 5 scenario dirs + fixture-scripts; assertion table; scenario (a) full PASS chain; (c) satisfied literal "zero fixture requests" criterion but HONESTLY flagged as PARTIAL/FINDING (ambiguity-block comes from primary-agent layer, not the restricted agent's own guard on gemini-flash-lite). Port safety (never 27182) proven. Commit `52ac4aa05`.
- **T11** `docs/reference/unity-subagent-benchmark.md` — all 7 sections + 6 tasks present; self-audit shows seeded-error caught+fixed; doc makes no "benchmark ran" claim. Commit `38ddae287`.
- **T12** `unity-editor-subagents.md` + benchmark both indexed in docs/AGENTS.md (rows 25-26); roadmap P1-10 "Landed" + P3-9 tier-1 kept open with revisit-after-bench note; project-message-response.json shows `ok:true`; link-checker happy+failure runs. Commit `ba11ddf8d`.

### Dependency matrix honored (evidence timestamps)
T1 17:57 < T3 18:13, T4 18:10 → T5 18:21 → T6 18:23 / T7 18:24 → T8 18:29 → T9 19:06 / T10 19:23 / T11 18:43 → T12 19:35/36. Wave ordering respected; no todo's evidence predates its blockers.

### Findings (non-blocking, already self-disclosed by executors)
1. **T10 scenario (c)** — restricted agent's own "ambiguous→blocked" instruction is NOT reliably honored by `gemini-3.5-flash-lite`; the zero-fixture-traffic guarantee is currently provided by the outer primary-agent guard (defense-in-depth). Prompt-adherence weakness, honestly recorded, filed for follow-up. Does not violate the literal acceptance criterion.
2. **T10 scenario (b)** — grounding-order preamble (bridge_status→get_relevant_tools) is non-deterministic on the fast model; domain routing itself is solid. Recorded as model-behavior finding, not a wiring failure.

Both are model-adherence observations, not plan-compliance gaps. Wiring/config/permission enforcement all verified correct.


## F4: Scope Fidelity Audit

Read-only audit of every "Must NOT have" guardrail (plan lines 36-44 + draft Scope OUT lines 61-66). Plan commit range: `0fd6e8f97^..fcd07d111` on `fork/local` (12 todo commits + draft archive), verified 2026-08-04.

**1. NO model-core edits — HELD.** `git log --since=2026-08-04 --until=2026-08-05 -- packages/model-core/` returns zero commits. `git diff --stat 0fd6e8f97^ fcd07d111 -- packages/model-core/` is empty. The two trailing repo commits (5f43f7244 model-cache refresh, fd41eea29 docs) also touch zero model-core files. Model routing was config-only (`.omo/omo.jsonc` agents.<name>.fallback_models), never `AGENT_MODEL_REQUIREMENTS`/`CATEGORY_MODEL_REQUIREMENTS`.

**2. NO tier-1 SuperMCP MCP promotion — HELD.** `createBuiltinMcps()` (packages/omo-opencode/src/mcp/index.ts:36-68) registers only websearch/context7/grep_app/lsp/codegraph — no supermcp entry. `McpNameSchema` (mcp/types.ts:3) enumerates the same five, no supermcp. Zero `supermcp` references anywhere under `src/mcp/`. The only `supermcp` strings in plugin src are in `tools/skill-mcp/tools.test.ts` (tier-3 skill_mcp unit test fixtures — correct layer). Tracked as roadmap P3-9, left open.

**3. NO hidden agents — HELD.** All 8 unity agent .md files (unity-editor, unity-scene, unity-script-roslyn, unity-asset, unity-build, unity-runtime, unity-bridge-bootstrap, unity-gamedev) scanned: zero `hidden` frontmatter lines in any file. All are `mode: subagent`, discoverable via task(subagent_type=).

**4. NO 27182 binding in QA artifacts — HELD.** 24 occurrences of `27182` across the evidence dir, every one classified:
   - task-1/README, task-6/evidence, task-9/README: prose stating the port was NEVER bound / lives only in vendored skill frontmatter (safe reference).
   - task-10/fixture-scripts (fake-mcp-server.mjs:33-34, rewrite-all-urls.mjs:16-17, run-scenario.sh): HARD-REFUSE guards — fixture exits 2 if asked to bind 27182; rewrite script refuses to rewrite a url TO 27182 (negative-test guards, prove non-binding).
   - task-10 scenario run.logs: every scenario bound a RANDOM free port (50902, 51061, 51957, 50079, 52581) with explicit "never 27182: ok" assertion. fixture-port.txt values confirm.
   - task-10/README:130-132: documents that in the FIRST BUGGY run, the skill-dedup shadowing caused a `skill_mcp bridge_status` to resolve `supermcp` via a sibling scratch skill whose url still pointed at the real 27182 bridge — an OUTBOUND CLIENT connection (which answered "No Unity Editor instance is registered"), NOT the QA binding/listening on 27182. The fix (rewrite ALL six scratch urls) closed that leak. This is a client-reach note, not a bound-port violation. NO QA artifact bound/listened on 27182.

**5. EXACTLY 6 vendored skills — HELD.** `packages/supermcp-skills/skills/` contains exactly 6 dirs (unity-scene, unity-script-roslyn, unity-asset, unity-build, unity-runtime, unity-bridge-bootstrap), each with exactly one SKILL.md and nothing else (counted from disk, not MANIFEST self-report). None of the excluded skills (unity-gamedev, unity-visual-qa, unity-multi-instance, unity-reflection, unity-playtest-automation, unity-filesystem-expert, unity-tilemap-generation) were vendored.

**6. NO webgameECS mutations — HELD.** Zero `webgameECS` references in the entire evidence dir. `/Volumes/Topper2TB/Git/webgameECS` is accessible and IS a git repo; `git status` shows modifications, but ALL are attributable to a DIFFERENT plan (`procgen-hierarchical-districts`: ECS runtime systems, room-streaming tests, its own .omo notepad/plan/evidence) — none reference unity-supermcp-subagents. HEAD there is `2ffe6a43 chore(supermcp): upgrade com.supermcp.unity-bridge 0.6.4 -> 0.7.0` (a package bump, unrelated to this plan's agent/skill work). The unity-supermcp-subagents plan wrote nothing to that path; live A/B benchmark on webgameECS remains the gated, un-run phase per plan design.

### F4 VERDICT: APPROVE
All six Must-NOT-Haves held. No model-core edits, no tier-1 MCP promotion, no hidden agents, no 27182 binding by any QA artifact, exactly six vendored skills, no webgameECS mutation by this plan.


## F2: Code Quality Review

Verdict: **APPROVE** (one non-blocking prose-convention finding documented below). Every substantive code-quality invariant recomputed from disk, not trusted from prior evidence.

### Frontmatter/permission byte-identity (VERIFIED)
- Full frontmatter slice `mode:` → closing `---` (agent file lines 3-13) sha256 = `e7611a32144ebc498f9c54a782c920bc4de70d045504711e45a5db16dec96de9`, **byte-identical across all 7** restricted agents (unity-editor, unity-scene, unity-script-roslyn, unity-asset, unity-build, unity-runtime, unity-bridge-bootstrap).
- Reconciled the notepad's claimed `871811709937957c99dfba3981034fb1c9b4b76fb8b29b1ab0a33fd5e49f4001`: that hash is the sub-slice lines 3-12 (`mode:` through `todowrite: allow`, WITHOUT the closing `---`). Confirmed it reproduces via both `sed -n '3,12p'` and the awk `mode:`→`todowrite` extraction. Claim is TRUE. My full-slice hash extends it by one line (the `---`) hence differs; both are internally consistent and identical across all 7.
- Permission map is EXACTLY 6 keys in every file, no extras: `"*": deny`, `skill: allow`, `skill_mcp: allow`, `read: allow`, `question: allow`, `todowrite: allow`. Order (`*` deny first, then allows) is correct for OpenCode last-match-wins.

### Fabricated config keys (VERIFIED ZERO in new files)
- `allowed_tools` / `auto_load_skills` / `todoread`: 0 matches in `.opencode/agents/`, `packages/supermcp-skills/`, `.opencode/skills/unity-modal-dismiss/`.
- `is_unstable_agent`: every repo-wide hit is legitimate — `config/schema/categories.ts:36`, `omo-config-core/src/schema/category.ts:40`, `delegate-task/category-resolver.ts:233`, tests, generated schema JSON, docs. The only occurrences in this plan's own docs (`.omo/plans/`, `.omo/drafts/`) NAME it as a forbidden key. ZERO in the 8 agent files / skill files.

### MANIFEST vendored-hash integrity (VERIFIED — recomputed, not trusted)
Live `shasum -a 256` of each `packages/supermcp-skills/skills/*/SKILL.md` matches MANIFEST.json exactly:
- unity-asset `3bda3687…00db9b` ✓  · unity-bridge-bootstrap `b2dd14f5…30921a` ✓ · unity-build `443073ee…6800fcad` ✓ · unity-runtime `72dec037…27d812da` ✓ · unity-scene `e8f06c28…488364b5` ✓ · unity-script-roslyn `b6649b1c…a8cacb82` ✓ (6/6).
- source_rev `21b7c5e1…31b839`, source_repo rustybret/unitySuperMCP. Sync script validates source before touching dest (no partial writes) and is idempotent on `synced_at`.

### JSONC parse (VERIFIED with real parser)
- `.omo/omo.jsonc` parses cleanly via the project's own `parseJsonc` (`packages/utils/src/jsonc-parser.ts`). `skills.sources` = `[{path: packages/supermcp-skills/skills, recursive: true}]`; `agents` = all 7 restricted agents with identical mixed fallback arrays (modern `reasoning` field, not deprecated `variant`); `_migrations` present. Not eyeballed — executed.

### AI-slop scan
- Banned filler words (`simply|obviously|clearly|moreover|furthermore`): **ZERO** across all 12 in-scope files (7 agents + unity-gamedev.md + modal-dismiss SKILL + sync script + 2 docs).
- No generic restated-the-code comments: sync-from-source.mjs comments are all rationale/why (idempotency guarantee, no-partial-write ordering, deliberate 6-skill scope), not restatements. Modal-dismiss + both docs clean.
- **FINDING (non-blocking): em-dashes (U+2014) in authored agent prose.** All 8 agent `.md` files use em-dashes (unity-editor 4, unity-scene 10, unity-script-roslyn 14, unity-asset 11, unity-build 8, unity-runtime 12, unity-bridge-bootstrap 7, unity-gamedev 30). The repo AGENTS.md lists "no em/en dashes in generated content" under BLOCKING anti-patterns, and this F2 brief explicitly checks "no em/en dashes in prose". Mitigating context: (1) usage is grammatically-correct parenthetical/appositive, not AI-filler; (2) it mirrors the byte-identical vendored upstream SKILL.md prose style (which also uses em-dashes and is untouchable); (3) the two authored `docs/reference/*.md` and the sync script contain ZERO em-dashes; (4) zero functional/config/permission/security impact. Recorded as a style-convention deviation for optional follow-up; does not compromise correctness, consistency, or the hash/permission invariants F2 exists to protect. en-dashes (U+2013): zero everywhere.

### Verdict rationale
Template byte-identity, permission exactness, zero fabricated keys, 6/6 vendored hash match, zero filler slop, clean JSONC parse — all PASS on recomputation. Sole deviation is em-dashes in agent prose, non-blocking per rationale above. **APPROVE.**


## F3: Fresh Manual QA Re-run

Independent, from-scratch re-execution of the task-9 + task-10 sandbox probes (NOT a re-read of existing evidence). Fresh mktemp XDG sandboxes, fresh serve port (65357), fresh fixture ports (50794, 51092), fresh sessions carrying a unique run marker (`f3fresh-20260804-195145-32494`). opencode v1.18.11, plugin `dist/index.js` (2026-08-04 18:31). Evidence: `.omo/evidence/20260804-unity-subagents/f3-fresh-rerun/` (README + raw/). Driver scripts (gitignored): `.local-ignore/qa/unity-f3-fresh/`.

- **Registration — reproduced PASS.** Bootstrap `GET /agent?directory=<repo>` (memory #2092 lazy init confirmed again). All 8 unity agents present, none hidden. `/agent` `permission` is an ORDERED array of `{permission, pattern, action}`; effective per-tool = last-match-wins where `permission==tool||"*"` and `pattern=="*"`. All 7 restricted agents evaluate EXACTLY to `*`:deny + skill/skill_mcp/read/question/todowrite:allow + bash/edit/write/task/webfetch/websearch:deny (12/12 each). unity-gamedev control = `*`:allow. Eval script `eval-permissions.mjs` handles both array and object permission shapes.
- **Permission denial — reproduced PASS.** Fresh `task(subagent_type="unity-editor")` bash-only dispatch: 0 bash tool-parts in the child session; child self-reports "bash ... denied ... available: call_omo_agent, list_mcp_resource_templates, list_mcp_resources, read, read_mcp_resource, skill, skill_mcp, todowrite". Differential control `task(subagent_type="unity-gamedev")` SAME instruction: bash `status=completed` count=1. Restriction is agent-specific (permission map), enforced only on subagent dispatch.
- **Skill reachability (unity-scene) — reproduced FULL PASS.** All SIX scratch skill urls rewritten to the fixture (shadowing gotcha honored). One skill load (`unity-scene`); fixture ordered log `bridge_status(seq14) → get_relevant_tools(seq16) → scene_list(seq18)`; subagent `skill_mcp` trail matches + `session_changes`; `Status: done`. Canonical spec flow.
- **Ambiguous domain — reproduced the task-10 FINDING (not a clean pass).** `task(subagent_type="unity-editor", "make the game better")`: the restricted agent on gemini-3.5-flash-lite did NOT emit `Status: blocked`. It guessed, loaded TWO skills (`unity-bridge-bootstrap` + `unity-scene`), drove the fixture (bridge_status → scene_list → get_relevant_tools ×2 → gameobject_get → list_custom_tools → bridge_status), and returned an unsolicited improvement plan. CONFIRMS: the "ambiguous → blocked, zero fixture traffic" guarantee comes from the OUTER primary-agent guard (defense-in-depth), NOT the restricted agent's own ambiguity guard, which the fast dispatch model ignores. This fresh run had the primary forward the vague prompt, exposing the inner-guard weakness exactly as task-10 predicted.
- **Isolation — PROVEN by negative query (authoritative), not raw delta.** Real DB 7081→7085 (+4 ambient, NOT authoritative). Authoritative: 0 rows matching the run marker / `f3fresh` dir; 0 rows under `omo-f3fresh-*` sandbox dir; 0 of 8 collected sandbox session ids present in the real DB (per-id count + explicit spot-checks on the editor/scene/ambiguous children). Pre-run baseline confirmed 0 marker hits.
- **Port safety + PID hygiene.** Fresh ports 50794/51092 — neither 27182 nor any task-10 port (runner hard-avoids `27182 50902 51061 51957 50079 52581`). 27182 stayed bound by the pre-existing real bridge `beam.smp` PID 22568 (never touched). All tracked PIDs (serve 50928, fixtures 59306/60231) killed individually (rule #2598) and confirmed dead.
- **HARNESS reuse note:** the task-10 `fake-mcp-server.mjs` + `rewrite-all-urls.mjs` were reused byte-for-byte (re-EXECUTED fresh, not replayed); the sandbox/serve/dispatch drivers were re-authored under `unity-f3-fresh/` with a single-script two-scenario runner and per-scenario avoid-port retry. macOS still has no `timeout` binary — used the bg-pid + kill-after-N guard pattern.

**Verdict: APPROVE** — fresh independent re-run reproduces every claimed behavior (registration, permission spec, denial + differential, single-skill discipline + ordered chain, and the ambiguous-domain finding), with real-DB isolation proven and no Must-NOT-Have violated.
