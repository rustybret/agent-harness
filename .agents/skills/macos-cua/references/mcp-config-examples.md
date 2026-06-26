# macos-cua MCP Configuration Examples

Three patterns for wiring the macos-cua MCP server into OpenCode. Pick one — do not use
multiple patterns at the same time or the server will start multiple stdio processes.

---

## Pattern 1: Global MCP (available in every project)

Add to `~/.config/opencode/opencode.json`. The server starts automatically for every session.
The `mcp:` block is NOT needed in a SKILL.md if this is configured — the tools are always present.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "macos-cua": {
      "type": "local",
      "command": ["node", "/Users/brethoffman/Git/macos-cua/packages/mcp/dist/server.js"]
    }
  }
}
```

**Trade-off:** The MCP process starts on every OpenCode session, even when you don't need desktop
automation. Adds a small startup cost and one idle node process per session.

---

## Pattern 2: Project-level MCP (one project only)

Add to `.opencode/opencode.json` in a specific repo. Active only when OpenCode opens from inside
that project tree.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "macos-cua": {
      "type": "local",
      "command": ["node", "/Users/brethoffman/Git/macos-cua/packages/mcp/dist/server.js"]
    }
  }
}
```

Same JSON shape as global; the difference is the file location. Project config overrides user
config on name collision (closest scope wins).

**Trade-off:** Scoped to one project — won't bleed into unrelated sessions. Requires adding to
every project that needs it.

---

## Pattern 3: Skill-embedded MCP (on-demand, OmO-native) ← recommended

The skill's `mcp:` frontmatter block tells OmO to start the server at skill-load time and stop
it when the session ends. Nothing runs until an agent explicitly loads the `macos-cua` skill.

```yaml
# Inside SKILL.md frontmatter:
mcp:
  macos-cua:
    type: local
    command: ["node", "/Users/brethoffman/Git/macos-cua/packages/mcp/dist/server.js"]
    enabled: true
```

After the skill loads, all MCP tools are available via `skill_mcp` and auto-injected into context
by `formatMcpCapabilities`. The server shuts down at session end.

**Trade-off:** Best fit for a context-aware tool like macos-cua — the server only runs when the
agent is actively doing desktop automation. Requires the agent to explicitly load the skill (which
happens automatically when the description matches the task or when you load it manually).

---

## Which pattern to use

| Situation | Pattern |
|---|---|
| Desktop automation is frequent across many projects | Global (Pattern 1) |
| Only needed in one specific repo | Project (Pattern 2) |
| On-demand, context-sensitive — general case | Skill-embedded (Pattern 3) |
| Want to document the config for other stack users | Skill-embedded + this reference file |

---

## Verify the server starts

After configuring (any pattern), confirm the MCP registers correctly:

```bash
# For global or project MCP: check opencode logs after startup
# Look for the server name 'macos-cua' in the plugin init events

# For skill-embedded: load the skill in a session, then call:
skill_mcp(mcp_name="macos-cua", tool_name="check_permissions", arguments="{}")
```

If the server fails to start, the most common causes are:
- `node` not on PATH at OpenCode's launch environment (use absolute `/usr/local/bin/node` or
  `/opt/homebrew/bin/node` in `command`)
- `dist/server.js` not built — run `pnpm --filter @macos-cua/mcp build` in `~/Git/macos-cua`
- macOS Screen Recording permission not granted for the OpenCode terminal/app binary
