---
slug: unity-supermcp-subagents
status: complete-reviewed
intent: clear
review_required: true
plan_path: .omo/plans/unity-supermcp-subagents.md
plan_sha256: cross-checked-via-reviewer-echo (harness denies local shell hashing; both lanes must echo the sha256 they compute from the exact path and the two echoes must match)
review_round_id: round-unity-supermcp-20260804-2
round_status: approved
round_2_result: BOTH LANES OKAY. Momus (ses_030a2ce5bffe4RYTcNTa3mkRNE, launch-momus-2) OKAY; Oracle (ses_030a2aea1ffei6IOuwTJpCtc6J, launch-oracle-2) OKAY. Both echoed identical artifact_identity sha256 49e499f5f91cf7c127b79359ee6997377d8ae61003585525f957501f86dc334c, round round-unity-supermcp-20260804-2 — cross-lane digest match satisfies the binding check. No plan edits after the reviewed digest.
round_1_result: both lanes REJECT (sha 059b35685cc01aac212138c0eeccb0c0da0454d51d01a62fab02e5c5528f67f1). Issues fixed: [opencode] exact key in todos 3+8; evidence date unified 20260804; wave/matrix consistency (Wave 1b for todo 3; matrix rows 1-3 corrected); todoread removed (nonexistent tool); todo-10 dedup shadowing fixed via throwaway fixture project dir with scratch skills.sources.
pending-action: none — plan complete and dual-review approved; execution starts only via $start-work unity-supermcp-subagents
review:
  momus: { status: approved, workspace_root: /Volumes/Topper2TB/Git/agent-harness, target: .omo/plans/unity-supermcp-subagents.md, round_id: round-unity-supermcp-20260804-2, launch_id: launch-momus-2, session: ses_030a2ce5bffe4RYTcNTa3mkRNE, bg_task: bg_a3732d5c, result: OKAY, plan_sha256: 49e499f5f91cf7c127b79359ee6997377d8ae61003585525f957501f86dc334c, round1: { session: ses_030af966fffe9gbj6Oxjsk5gCw, result: REJECT } }
  independent: { status: approved, workspace_root: /Volumes/Topper2TB/Git/agent-harness, target: .omo/plans/unity-supermcp-subagents.md, round_id: round-unity-supermcp-20260804-2, launch_id: launch-oracle-2, session: ses_030a2aea1ffei6IOuwTJpCtc6J, bg_task: bg_cf23c026, result: OKAY, plan_sha256: 49e499f5f91cf7c127b79359ee6997377d8ae61003585525f957501f86dc334c, round1: { session: ses_030af52bbffedRl6WCrNEJPgWf, result: REJECT } }
approach: Build BOTH Option A (one restricted unity-editor agent, domain via prompt) and Option B (six domain agents) as native OpenCode markdown agents with permission allowlists; vendor the six unitySuperMCP domain skills as a manually-synced package (packages/supermcp-skills) wired via skills.sources; fast model chain gemini-3.5-flash-lite -> gpt-5.5 low -> deepseek-v4-flash-free -> claude-opus-5 low -> gemini flash tier -> gemma-4-31b-it; remediate the dead unity-gamedev.json; sandbox QA per todo plus gated live validation on webgameECS (local mac + unity-windows-vm).
---

# Draft: unity-supermcp-subagents

## Components (topology ledger)
<!-- id | outcome (one line) | status: active|deferred | evidence path -->
1. skill-wiring | Six unitySuperMCP domain skills + unity-modal-dismiss wrapper discoverable in this repo | active | packages/skills-loader-core/src/features/opencode-skill-loader/config-source-discovery.ts:98-125
2. option-a-agent | One restricted `unity-editor` .md agent (permission allowlist, domain chosen per task prompt) | active | /Volumes/Topper2TB/Git/opencode/packages/core/src/v1/config/agent.ts:12-41
3. option-b-agents | Six restricted per-domain .md agents (tighter prompts, same allowlist) | active | same loader path as component 2
4. model-routing | Corrected fast chain wired config-only (frontmatter model + agents.<name>.fallback_models) | active | utils/models.json + packages/omo-opencode/src/tools/delegate-task/subagent-model-resolution.ts:23-122
5. gamedev-json-remediation | Dead `.opencode/agents/unity-gamedev.json` replaced by a working .md agent | active | packages/claude-code-compat-core/src/features/claude-code-agent-loader/loader.ts:9-29 (isMarkdownFile filter)
6. qa-benchmark | Sandbox QA proofs (registration, permission denial, skill reachability) + comparative A/B test procedure + evidence | active | .agents/skills/opencode-qa/

## Open assumptions (announced defaults)
- Option B agent names | use the domain skill names verbatim (unity-scene, unity-script-roslyn, unity-asset, unity-build, unity-runtime, unity-bridge-bootstrap) | agents and skills live in separate registries; matching names maximize discoverability | reversible
- unity-gamedev.json fate | convert to a working `.md` agent kept as the UNRESTRICTED general-purpose unity agent alongside the new restricted ones | it is dead config today; both options need the .md loader path anyway | reversible
- Model wiring mechanism | config-only (agent frontmatter `model:` + `agents.<name>.fallback_models` in project omo config), NOT AGENT_MODEL_REQUIREMENTS code entries | zero product-code change, no plugin rebuild, per-project scoped | reversible
- Option A domain selection | caller passes the domain in the task prompt; agent prompt mandates loading exactly ONE domain skill before any bridge call | matches unitySuperMCP Q&A and existing unity-gamedev.md routing text | reversible

## Findings (cited - path:lines)
- **`.opencode/agents/*.json` is NEVER loaded.** omo's `loadOpencodeProjectAgents` filters `isMarkdownFile` only (claude-code-agent-loader/loader.ts:9-29 + utils/src/file-utils.ts:9-11); native opencode scans `{agent,agents}/**/*.md` only (opencode repo config/agent.ts:13). `parseJsonAgentFile` is reachable ONLY via the `agent_definitions` config key (unset here) or inline `.opencode/opencode.json` agents (file absent). => the existing `unity-gamedev.json` is dead config; the prior session's "existing precedent proves the shape" claim was wrong.
- **Custom fields `allowed_tools` / `auto_load_skills` / `is_unstable_agent` appear in ZERO agent-loader code** (repo-wide grep). They are fabricated keys nothing reads. `is_unstable_agent` exists only as a CATEGORY field (config/schema/categories.ts:36, category-resolver.ts:233).
- **Native .md agent frontmatter supports the full schema** incl. `permission` (ask/allow/deny per tool + `*` catchall), `model`, `variant`, `temperature`, `hidden`, `steps` (opencode core/v1/config/agent.ts:12-41 + permission.ts:17-38). This is the correct restriction vehicle — NOT `tools:` (deprecated, normalized into permission).
- **Custom agents resolve through task()**: `mergeWithClaudeCodeAgents` merges server agents + project/user .md agents (subagent-discovery.ts:21-49); `resolveSubagentModel` honors `matchedAgent.model` (frontmatter) and `agentOverrides` = pluginConfig.agents.<name> incl. `fallback_models` with case-insensitive catchall schema (agent-overrides.ts:83-103, subagent-model-resolution.ts:23-122).
- **Model catalog verification (utils/models.json):** `gemini-3.6-flash-lite` DOES NOT EXIST (only `opencode/gemini-3.6-flash`); `opencode/gemini-3.5-flash-lite` + `openrouter/google/gemini-3.5-flash-lite` exist; `openai/gpt-5.5` exists; `openrouter/deepseek/deepseek-v4-flash-0731` and `nvidia/deepseek-ai/deepseek-v4-flash` and `deepseek/deepseek-v4-flash` exist; `google/gemma-4-31b-it` and `nvidia/google/gemma-4-31b-it` exist.
- **Skill sourcing options:** `skills.sources` config (SkillsConfigSchema skills.ts:29-36; discoverConfigSourceSkills config-source-discovery.ts:98-125 supports dir + recursive + glob) can point straight at `/Volumes/Topper2TB/Git/unitySuperMCP/supermcp-skills/Samples~/AgentSkills` — no copying, no drift. All six domain SKILL.md files verified present there with `mcp: supermcp` remote frontmatter (tier-3, works from any path).
- **macos-cua**: user-scope skill at ~/.config/opencode/skills/macos-cua/SKILL.md embeds local MCP (`/opt/homebrew/bin/node` + absolute server.js path). unity-modal-dismiss wrapper = same MCP block, scoped prompt (bridge-first: list_pending_modals -> dismiss_modal -> bridge_safe_mode_check -> macos-cua last resort).
- **Gemini-model caveat:** models containing "gemini" are flagged unstable for CATEGORY delegation (category-resolver.ts:233 forces supervised background). Direct subagent_type dispatch is not category-routed; QA must verify sync dispatch behavior with the flash-lite model.
- unitySuperMCP spec (mailbox 48d60eda): 153 live tools; groupings scene 36 / scripting 6 / asset 8 / build 3 / profiler-runtime 21+ / ui 23 / vfx 16 / console 2 + always-on core set; `get_relevant_tools(role=...)` for runtime narrowing; timing comparison planned on cloudhome Windows VM once first agent is deployable.

## Decisions (with rationale)
- Both options are built in ONE plan (user: "plan the work for option A and option B, we'll test both").
- Restriction vehicle = native frontmatter `permission`: `{"*": "deny", "skill": "allow", "skill_mcp": "allow", "read": "allow", "question": "allow"}` — deny bash/write/edit/task/webfetch/websearch by catchall.
- Skills for domains come from unitySuperMCP repo (pending Q1 sourcing mechanism).

## Scope IN
- 1 restricted Option A agent + 6 restricted Option B agents (.opencode/agents/*.md) + per-variant prompts
- unity-modal-dismiss skill (.opencode/skills/unity-modal-dismiss/SKILL.md)
- Skill-source wiring for the six domain skills
- Corrected fast model chain + fallbacks (config)
- unity-gamedev.json -> .md remediation
- Sandbox QA (registration, permission denial, skill reachability via fake bridge MCP) + comparative A/B benchmark procedure + evidence under .omo/evidence/
- Reply to unitySuperMCP when built (they wait to run timing comparison)

## Scope OUT (Must NOT have)
- No tier-1 built-in SuperMCP promotion (tracked separately as roadmap P3-9)
- No AGENT_MODEL_REQUIREMENTS / model-core code edits (config-only routing)
- No copying/vendoring of unitySuperMCP skill content beyond what Q1 decides
- No restricted Gemma-tier category work (separate opencode-gemini thread, closed)
- No live Unity editor driving inside the plan's automated QA (gated manual step only)

## Open questions (RESOLVED by user 2026-08-04)
1. Skill sourcing: VENDOR the SuperMCP skills as a package in agent-harness (packages/supermcp-skills/), manually synced from /Volumes/Topper2TB/Git/unitySuperMCP so skills and agents update together. Sync script + README documenting the manual sync step. Wired via skills.sources relative path.
2. Model chain (all keys verified in utils/models.json):
   1. opencode/gemini-3.5-flash-lite
   2. openai/gpt-5.5 (low)
   3. opencode/deepseek-v4-flash-free  (the "free"-named zen deepseek flash)
   4. anthropic/claude-opus-5 (low)
   5. opencode/gemini-3.6-flash, opencode/gemini-3.5-flash, opencode/gemini-3-flash (fast gemini tier before gemma)
   6. google/gemma-4-31b-it (last resort; 16k input-tokens/min caveat surfaced in config comment)
3. Test strategy: tests-after. Sandbox QA per todo proves the code exists and works (agent-executed, isolated). Live validation phase uses the webgameECS project (/Volumes/Topper2TB/Git/webgameECS) as testbed: running the agent locally on this mac against the live editor, plus the second unity-windows-vm instance (unity-windows-vm skill). Live phase is part of final verification, gated on live infra availability.

## Approval gate
status: APPROVED (user 2026-08-04: "approve, then after plan run dual review") — review_required set true.
Next: Metis gap analysis -> append todos -> TL;DR -> dual high-accuracy review (momus + oracle) -> deliver with receipts.
