// Drives the REAL registered skill_mcp tool against a REAL stdio MCP server over the real MCP
// protocol, replaying the exact tool names that failed in production against "supermcp".
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))

const { createSkillMcpTool } = await import(
  "../../packages/omo-opencode/src/tools/skill-mcp/tools.ts"
)
const { SkillMcpManager } = await import(
  "../../packages/omo-opencode/src/features/skill-mcp-manager/index.ts"
)

const manager = new SkillMcpManager()
const skills = [
  {
    name: "unity-gamedev",
    path: "/qa/skills/unity-gamedev/SKILL.md",
    resolvedPath: "/qa/skills/unity-gamedev",
    definition: { name: "unity-gamedev", description: "qa", template: "qa" },
    scope: "opencode-project",
    mcpConfig: {
      supermcp: {
        command: process.execPath,
        args: [path.join(here, "fake-mcp-server.mjs")],
      },
    },
  },
]

const tool = createSkillMcpTool({
  manager,
  getLoadedSkills: () => skills,
  getSessionID: () => "qa-session",
})

const context = {
  sessionID: "qa-session",
  messageID: "qa-msg",
  agent: "qa",
  directory: process.cwd(),
  worktree: process.cwd(),
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

// The real names guessed against supermcp in production, per the session database.
const attempted = ["bridge_status", "oa_find", "scene_get_open", "read_console"]
const results = []

for (const name of attempted) {
  try {
    await tool.execute({ mcp_name: "supermcp", tool_name: name }, context)
    results.push({ tool_name: name, outcome: "succeeded" })
  } catch (error) {
    const msg = error.message
    results.push({
      tool_name: name,
      namesAvailableTools: /Available tools on this server/.test(msg),
      errorChars: msg.length,
      error: msg.split("\n").slice(0, 6).join(" | "),
    })
  }
}

await manager.disconnectAll()
console.log(JSON.stringify({ server: "real stdio MCP (fake-mcp-server.mjs)", results }, null, 2))
process.exit(0)
