# OmO Links

## Oh My OpenAgent — skill-loader source (post-package-layering refactor)

Skill loading moved from `src/` (root) to `packages/skills-loader-core/` and `packages/omo-opencode/src/`:

| What | Path in agent-harness |
|---|---|
| Skill loader core (discovery, matching, MCP config parse) | `packages/skills-loader-core/src/` |
| Skill matcher | `packages/skills-loader-core/src/tools/skill/skill-matcher.ts` |
| MCP config parser | `packages/skills-loader-core/src/features/opencode-skill-loader/skill-mcp-config.ts` |
| Skill template extractor | `packages/skills-loader-core/src/features/opencode-skill-loader/loaded-skill-template-extractor.ts` |
| MCP capability formatter (auto-injects tool schemas) | `packages/omo-opencode/src/tools/skill/mcp-capability-formatter.ts` |
| `skill_mcp` tool | `packages/omo-opencode/src/tools/skill-mcp/` |
| `skill` tool | `packages/omo-opencode/src/tools/skill/` |
| Built-in skills | `packages/omo-opencode/src/features/builtin-skills/` |
| Skill MCP manager (per-session lifecycle) | `packages/omo-opencode/src/features/skill-mcp-manager/` |
| All tools AGENTS.md | `packages/omo-opencode/src/tools/AGENTS.md` (individual tool dirs have their own) |
| All hooks AGENTS.md | `packages/omo-opencode/src/hooks/AGENTS.md` |
| All features AGENTS.md | `packages/omo-opencode/src/features/AGENTS.md` |
| Built-in MCPs AGENTS.md | `packages/omo-opencode/src/mcp/AGENTS.md` |

> Note: the old paths `oh-my-openagent/src/tools/`, `src/hooks/`, etc. are obsolete — the package layering refactor was a 100% git rename into `packages/omo-opencode/src/`.

## Rustybret's OpenCode and Oh-My-OpenAgent forks

- https://github.com/rustybret/agent-harness — main fork of code-yeongyu/oh-my-openagent (this repo)
  - Supporting sub-repos:
    - https://github.com/rustybret/lsp-tools-mcp — fork of code-yeongyu/lsp-tools-mcp
    - https://github.com/rustybret/opencode — fork of anomalyco/opencode
    - https://github.com/rustybret/magic-context — local fork of cortexkit/magic-context (no divergent commits yet)
    - https://github.com/rustybret/macos-cua — fork of code-yeongyu/macos-cua

## Plugins in our agent stack

All of these are available as tools in an agent session running against this stack:

| Plugin | Repo | Notes |
|---|---|---|
| **oh-my-openagent** | https://github.com/rustybret/agent-harness | This repo — OmO plugin, agents, skills, MCP |
| **magic-context** | https://github.com/cortexkit/magic-context | Unbounded context + memory. Dreamer tasks, session upgrade |
| **AFT** | https://github.com/cortexkit/aft | `aft_*` tools: semantic search, symbol-aware edits, code health, bash compression, background tasks, PTY |
| **opencode-interceptor** | https://github.com/cortexkit/opencode-interceptor | Runtime HTTP interception diagnostics |
| **anthropic-auth** | https://github.com/cortexkit/anthropic-auth | Anthropic OAuth. Local compiled fork (no divergent commits): https://github.com/rustybret/anthropic-auth |
| **openai-auth** | https://github.com/cortexkit/openai-auth | OpenAI/ChatGPT OAuth. Local compiled fork (no divergent commits): https://github.com/rustybret/openai-auth-experimental |
| **opencode-gemini** | https://github.com/rustybret/opencode-gemini | Google Gemini/Antigravity OAuth. Local compiled divergent fork of https://github.com/cortexkit/antigravity-auth |

## Supporting CI tools

- https://github.com/cortexkit/orw — OpenCode release integration watcher

## Skill-specific links

- macos-cua MCP server built at: `~/Git/macos-cua/packages/mcp/dist/server.js`
- macos-cua CLI built at: `~/Git/macos-cua/packages/cli/dist/cli.js`
- macos-cua skill (upstream): `~/Git/macos-cua/skills/macos-cua/SKILL.md`

## Relevant external references

- OpenCode docs: https://opencode.ai/docs
- Context7 MCP: https://mcp.context7.com/mcp
- Grep.app MCP: https://mcp.grep.app
- Codegraph MCP: ?
- Jujutsu tutorial: https://steveklabnik.github.io/jujutsu-tutorial/
- Jujutsu GitHub/GitLab workflow: https://docs.jj-vcs.dev/latest/github/

## `~/Git/skills` repo — migration inputs (legacy)

These were source-of-truth for the original skill authoring guides and contain skills being migrated into agent-harness or unitySuperMCP:

- `src/xcode-mcp.md`
- `src/mcp-for-unity.md`
- `oh-my-opencode_configs/` — archived local config examples (legacy naming retained for migration context)
- `packages/McpAutomation.unitypackage`

