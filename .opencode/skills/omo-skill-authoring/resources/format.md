# OmO Skill Format

OmO-native skills for **agent-harness** live under one of two scope directories:

- **Project-scope (preferred during transition):** `.agents/skills/<skill-name>/` — this is the `oh-my-openagent` migration target and is a superset of `.opencode/skills/`. Both load; `.agents/` wins on name collision.
- **Project-scope (legacy):** `.opencode/skills/<skill-name>/`
- **User-scope:** `~/.config/opencode/skills/<skill-name>/`

Skills in `~/Git/skills` live under `omo/<skill-name>/` (that repo's own layout) and are imported here by copy or symlink.

## Required structure

```text
<skill-name>/
  SKILL.md
```

Optional companions:

```text
references/     # long-form docs, workflows, troubleshooting
scripts/        # deterministic helpers used by the skill
assets/         # templates or bundled files
```

## `SKILL.md` frontmatter

```yaml
---
name: skill-name
description: >
  Explain what the skill does and when to use it.
---
```

Required fields: `name`, `description`. All other fields are optional.

## MCP configuration — frontmatter `mcp:` vs sidecar `mcp.json`

**For OmO/OpenCode: use `mcp:` in SKILL.md frontmatter. This is the only path OmO reads.**

`parseSkillMcpConfigFromFrontmatter` in `packages/skills-loader-core/src/features/opencode-skill-loader/skill-mcp-config.ts` reads the `mcp:` YAML block and starts the server. A sibling `mcp.json` is **invisible to OmO** — it is used only by external tooling (the `~/Git/skills` validator, Claude Desktop config references, etc.).

```yaml
---
name: skill-name
description: "…"
mcp:
  server-name:
    type: local           # local (stdio) or remote (HTTP)
    command: ["node", "/abs/path/to/server.js"]
    enabled: true
---
```

For a remote HTTP MCP:

```yaml
mcp:
  server-name:
    type: remote
    url: "http://127.0.0.1:PORT/mcp"
```

After load, `formatMcpCapabilities` in `packages/omo-opencode/src/tools/skill/mcp-capability-formatter.ts` auto-injects every tool's name, description, and full `inputSchema` into the agent context. **Do not manually document tool parameters in the skill body** — it will drift and waste tokens.

When a skill also ships a `mcp.json` sidecar (e.g., for Claude Desktop or the `~/Git/skills` validator), keep it in `resources/mcp.json` and treat it as a documentation artifact, not the active config.

| | `mcp:` frontmatter | `mcp.json` sidecar |
|---|---|---|
| OmO loader reads it | ✅ yes | ❌ no |
| Auto-injects tool catalog | ✅ yes | ❌ no |
| Per-session isolation | ✅ keyed by sessionID:skillName:serverName | N/A |
| Non-OmO reuse (Claude Desktop) | ❌ | ✅ |
| Single file | ✅ | ❌ two files, can desync |

## Description writing rules

The description is the primary routing signal — `matchSkillByName` in `packages/skills-loader-core/src/tools/skill/skill-matcher.ts` uses it to decide which skill to load. Good descriptions say:

1. what the skill enables
2. the task signals that should trigger it
3. the nearby cases where it should win over generic tools alone

Prefer direct language like "Use this whenever the task touches…" or "Load this skill before…".
Avoid descriptions that only name a technology without saying when it applies.

## Skill body guidance

Keep `SKILL.md` focused on:
- first-contact steps
- required checks and guardrails
- normal workflow, failure modes, safety gotchas
- pointers to `references/` and `scripts/`

Target ~120 body lines. Move long catalogs, troubleshooting, and examples into `references/`.

## Effective OmO skills in practice

Strong OmO skills usually have:
- a specific trigger description
- a short bootstrap procedure
- clear division between built-in OmO tools and skill-specific MCP/tooling
- references for workflows and troubleshooting
- no fake completeness: stubs should say they are stubs

