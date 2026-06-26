---
name: omo-skill-authoring
description: "Canonical ruleset for writing OmO-native skills in the opencode + OmO-plugins stack. Load when authoring, reviewing, or installing a SKILL.md — covers frontmatter config, MCP embedding vs sidecar, tool-schema injection, description routing, context budget discipline, and native-tool preference. Triggers: write skill, author skill, omo skill, SKILL.md, mcp: frontmatter, skill mcp, install skill, opencode skill authoring, omo-native skill."
---

# OmO Skill Authoring Ruleset

This document defines the canonical ruleset for writing OmO-native skills. All skills must conform to these rules.

1. Frontmatter is config, body is guidance
2. Description is the routing signal
3. NEVER re-document injected tool schemas
4. Context is a set of compartment budgets, not a history tail
5. Prefer harness-native tools
6. Sharing one MCP server is NOT, by itself, a reason to merge skills
7. Target ~120 body lines; lead with 'When to use' + the irreducible operational layer
8. Assume the opencode + OmO-plugins stack ONLY

## 1. Frontmatter is config, body is guidance

The frontmatter of a skill file contains configuration parsed by `parseSkillMcpConfigFromFrontmatter` in `packages/skills-loader-core/src/features/opencode-skill-loader/skill-mcp-config.ts` using `js-yaml`. Verbatim body extraction is performed by `extractSkillTemplate` in `packages/skills-loader-core/src/features/opencode-skill-loader/loaded-skill-template-extractor.ts` to inject the markdown directly into the agent's system prompt. Keep configuration in the frontmatter and instructions in the body.

- **DO**: Put the skill name, description, and MCP server configurations in the YAML frontmatter.
- **DON'T**: Put configuration keys or raw YAML blocks inside the markdown body.

## 2. Description is the routing signal

The frontmatter `description` field is the primary routing signal used by the agent to match and load skills. Matching is performed by `matchSkillByName` in `packages/skills-loader-core/src/tools/skill/skill-matcher.ts`. The description must clearly define the trigger conditions and domain of the skill. This is higher-leverage than body text because the agent reads the description list to decide which skill to load.

- **DO**: Write a description that lists specific keywords, file extensions, and tasks that trigger the skill.
- **DON'T**: Write a vague description like "Helper skill for Unity" that doesn't specify trigger conditions.

## 3. NEVER re-document injected tool schemas

The `formatMcpCapabilities` function in `packages/omo-opencode/src/tools/skill/mcp-capability-formatter.ts` automatically formats and injects the tool name, description, full `inputSchema`, and the `skill_mcp` invocation hint into the agent's context. Writing parameter tables or schema details in the body is redundant and creates a drift hazard. The body should only cover what the schema cannot convey, such as multi-tool sequencing, failure modes, safety gotchas, environment gates, and cross-tool routing. Do not write sentences telling authors to copy tool params into the body.

- **DO**: Explain the high-level sequence of calling tools and how to handle errors.
- **DON'T**: Write tables listing tool parameters, types, or descriptions that are already defined in the tool's schema.

## 4. Context is a set of compartment budgets, not a history tail

The magic-context model manages context as a set of compartment budgets where tool definitions and skill instructions load and drop cheaply. Do not pre-carry tool documentation or bloat the body. Keep the body text lean so the durable cost in tokens remains small.

- **DO**: Keep instructions concise and focused on the core operational logic.
- **DON'T**: Include large code examples, full API references, or historical logs in the skill body.

## 5. Prefer harness-native tools

Always prefer harness-native tools over raw shell commands like `grep`, `find`, `sed`, or `cat`. Harness-native tools like `aft_*` (e.g., `aft_search`, `aft_outline`, `aft_zoom`, `aft_callgraph`), `lsp_*` (e.g., `lsp_diagnostics`, `lsp_goto_definition`, `lsp_find_references`, `lsp_rename`), and `look_at` are indexed, faster, and cheaper in tokens. A skill should point the agent to these native tools instead of reinventing search or navigation.

- **DO**: Instruct the agent to use `lsp_goto_definition` to navigate code.
- **DON'T**: Tell the agent to run `grep` or `find` in a bash shell to locate symbols.

## 6. Sharing one MCP server is NOT, by itself, a reason to merge skills

The HTTP transport in `http_mcp_plug.ex` serves the full tool catalog regardless of which skill loads, meaning there is no tool-scoping advantage over HTTP. However, the skill name is a load-bearing contract surface. Server-side proposal tools like `propose_skill_load`, benchmark run-cards, and CI harnesses reference skill names directly. Since `matchSkillByName` has no alias mechanism, deleting or renaming a skill will break these external integrations. Merge skills only when the tool-scoping is identical and no external name-based consumer references the names. Always grep the server's discovery tools and run-cards before removing or renaming a skill.

- **DO**: Keep separate skills for distinct domains even if they share the same underlying MCP server.
- **DON'T**: Consolidate skills just to reduce the number of files without checking for external name references in run-cards or proposal tools.

## 7. Target ~120 body lines; lead with 'When to use' + the irreducible operational layer

Target a soft budget of approximately 120 lines for the markdown body. Lead with a clear 'When to use' section and a one-line map from domain to tool family. Avoid exhaustive tables. Safety guidelines and failure-mode bullets must always survive even if the text is close to the budget limit.

- **DO**: Start with a concise bulleted list of scenarios where the skill applies.
- **DON'T**: Write long paragraphs of introductory text or exhaustive step-by-step tutorials.

## 8. Assume the opencode + OmO-plugins stack ONLY

Do not write generic instructions or try to support other IDEs or harnesses. The skill must assume it is running exclusively within the opencode and OmO-plugins environment. Use the specific tool names, environment variables, and conventions of this stack.

- **DO**: Reference `skill_mcp` and other OmO-specific tools directly.
- **DON'T**: Add fallback instructions for VS Code, Cursor, or generic command-line environments.

## Reference resources

Load these only when you need them — they expand specific aspects of skill authoring and installation:

| Resource | When to load |
|---|---|
| [`resources/format.md`](resources/format.md) | Canonical file layout, frontmatter schema, `mcp:` vs sidecar `mcp.json` tradeoffs, body guidance |
| [`resources/install.md`](resources/install.md) | How OmO discovers skills across scopes, project-local vs user-local install patterns, MCP prerequisites |
| [`resources/links.md`](resources/links.md) | Authoritative source paths in the agent-harness and OmO packages, plugin stack inventory, relevant external refs |
| [`resources/jj-workflow.md`](resources/jj-workflow.md) | Jujutsu-based multi-agent coordination model (applies to `~/Git/skills` repo; agent-harness uses git) |
