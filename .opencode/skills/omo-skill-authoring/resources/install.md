# OmO Skill Installation And Loading

## Loading model

OmO merges skills from multiple scopes. Priority: project-scope > user-scope.

- **`.agents/skills/<name>/`** — project-scope, preferred migration target; superset of `.opencode/skills/`
- **`.opencode/skills/<name>/`** — project-scope, legacy path; still loaded during the `oh-my-opencode → oh-my-openagent` rename transition
- **`~/.config/opencode/skills/<name>/`** — user-scope; available across all projects

Both `.agents/` and `.opencode/` load on the same session; a name collision resolves to `.agents/` winning.

## Installing a skill from `~/Git/skills`

Skills in `~/Git/skills/omo/<skill-name>/` are installed by copy or symlink into one of the scope directories above.

### Project-local (preferred)

```bash
mkdir -p .agents/skills
ln -s /Users/brethoffman/Git/skills/omo/<skill-name> .agents/skills/<skill-name>
```

Or copy if you want to customize locally:

```bash
cp -r /Users/brethoffman/Git/skills/omo/<skill-name> .agents/skills/<skill-name>
```

### User-local (available in all projects)

```bash
mkdir -p ~/.config/opencode/skills
ln -s /Users/brethoffman/Git/skills/omo/<skill-name> ~/.config/opencode/skills/<skill-name>
```

## MCP-aware skills

If a skill's `SKILL.md` has an `mcp:` frontmatter block, OmO starts the server at skill-load time. Verify prerequisites before loading:

- Runtime binary on PATH (e.g., `node`, `npx`)
- Server built / `dist/` exists at the configured path
- Required permissions granted (e.g., macOS Screen Recording for macos-cua)

For skills with a `resources/mcp.json` sidecar — that file is a portable reference only. OmO reads the `mcp:` frontmatter block exclusively.

## Validation

Skills in the `~/Git/skills` repo can be validated with that repo's own tools:

```bash
cd ~/Git/skills
node --test
node scripts/validate-skills.mjs
```

These are not agent-harness commands. Agent-harness has no equivalent skill validator at this time. Manually verify that `SKILL.md` parses (frontmatter is valid YAML, `name` and `description` fields present) and that any `mcp:` server path resolves on disk before committing.

