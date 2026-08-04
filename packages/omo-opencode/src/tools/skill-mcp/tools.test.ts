import { describe, it, expect, beforeEach, spyOn } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createSkillMcpTool, applyGrepFilter } from "./tools"
import { SkillMcpManager } from "../../features/skill-mcp-manager"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

function createMockSkillWithMcp(name: string, mcpServers: Record<string, unknown>): LoadedSkill {
  return {
    name,
    path: `/test/skills/${name}/SKILL.md`,
    resolvedPath: `/test/skills/${name}`,
    definition: {
      name,
      description: `Test skill ${name}`,
      template: "Test template",
    },
    scope: "opencode-project",
    mcpConfig: mcpServers as LoadedSkill["mcpConfig"],
  }
}

const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "msg-1",
  agent: "test-agent",
  directory: "/test",
  worktree: "/test",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

describe("skill_mcp tool", () => {
  let manager: SkillMcpManager
  let loadedSkills: LoadedSkill[]
  let sessionID: string

  beforeEach(() => {
    manager = new SkillMcpManager()
    loadedSkills = []
    sessionID = "test-session-1"
  })

  describe("#given a name the server does not expose", () => {
    function toolForServer(): ReturnType<typeof createSkillMcpTool> {
      loadedSkills = [createMockSkillWithMcp("unity", { supermcp: { command: "noop" } })]
      return createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })
    }

    it("#when the call fails as not-found #then the error names the tools the server does expose", async () => {
      // given
      spyOn(manager, "callTool").mockRejectedValue(new Error("MCP error -32603: Tool not found"))
      spyOn(manager, "listTools").mockResolvedValue([
        { name: "unity_bridge_status", inputSchema: { type: "object" } },
        { name: "unity_scene_open", inputSchema: { type: "object" } },
      ])

      // when / then
      const call = toolForServer().execute(
        { mcp_name: "supermcp", tool_name: "bridge_status" },
        mockContext,
      )
      await expect(call).rejects.toThrow(/unity_bridge_status/)
      await expect(call).rejects.toThrow(/Available tools on this server/)
    })

    it("#when the operation is a prompt #then it lists prompts rather than tools", async () => {
      // given
      spyOn(manager, "getPrompt").mockRejectedValue(new Error("Prompt not found"))
      spyOn(manager, "listPrompts").mockResolvedValue([{ name: "summarize" }])

      // when / then
      await expect(
        toolForServer().execute({ mcp_name: "supermcp", prompt_name: "nope" }, mockContext),
      ).rejects.toThrow(/Available prompts on this server:\n  - summarize/)
    })

    it("#when listing also fails #then the original error is preserved", async () => {
      // given: a diagnostic must never replace the fault it describes
      spyOn(manager, "callTool").mockRejectedValue(new Error("MCP error -32603: Tool not found"))
      spyOn(manager, "listTools").mockRejectedValue(new Error("connection closed"))

      // when / then
      await expect(
        toolForServer().execute({ mcp_name: "supermcp", tool_name: "bridge_status" }, mockContext),
      ).rejects.toThrow(/^MCP error -32603: Tool not found$/)
    })

    it("#when the failure is unrelated to naming #then no tool list is fetched", async () => {
      // given
      spyOn(manager, "callTool").mockRejectedValue(new Error("Unity bridge did not respond before timeout"))
      const listTools = spyOn(manager, "listTools").mockResolvedValue([])

      // when / then
      await expect(
        toolForServer().execute({ mcp_name: "supermcp", tool_name: "bridge_status" }, mockContext),
      ).rejects.toThrow(/did not respond before timeout/)
      expect(listTools).not.toHaveBeenCalled()
    })
  })

  describe("parameter validation", () => {
    it("throws when no operation specified", async () => {
      // given
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when / #then
      await expect(
        tool.execute({ mcp_name: "test-server" }, mockContext)
      ).rejects.toThrow(/Missing operation/)
    })

    it("throws when multiple operations specified", async () => {
      // given
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when / #then
      await expect(
        tool.execute({
          mcp_name: "test-server",
          tool_name: "some-tool",
          resource_name: "some://resource",
        }, mockContext)
      ).rejects.toThrow(/Multiple operations/)
    })

    it("throws when mcp_name not found in any skill", async () => {
      // given
      loadedSkills = [
        createMockSkillWithMcp("test-skill", {
          "known-server": { command: "echo", args: ["test"] },
        }),
      ]
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when / #then
      await expect(
        tool.execute({ mcp_name: "unknown-server", tool_name: "some-tool" }, mockContext)
      ).rejects.toThrow(/not found/)
    })

    it("includes available MCP servers in error message", async () => {
      // given
      loadedSkills = [
        createMockSkillWithMcp("db-skill", {
          sqlite: { command: "uvx", args: ["mcp-server-sqlite"] },
        }),
        createMockSkillWithMcp("api-skill", {
          "rest-api": { command: "node", args: ["server.js"] },
        }),
      ]
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when / #then
      await expect(
        tool.execute({ mcp_name: "missing", tool_name: "test" }, mockContext)
      ).rejects.toThrow(/sqlite.*db-skill|rest-api.*api-skill/s)
    })

    it("throws on invalid JSON arguments", async () => {
      // given
      loadedSkills = [
        createMockSkillWithMcp("test-skill", {
          "test-server": { command: "echo" },
        }),
      ]
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when / #then
      await expect(
        tool.execute({
          mcp_name: "test-server",
          tool_name: "some-tool",
          arguments: "not valid json",
        }, mockContext)
      ).rejects.toThrow(/Invalid arguments JSON/)
    })
  })

  describe("tool description", () => {
    it("has concise description", () => {
      // given / #when
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => [],
        getSessionID: () => "session",
      })

      // then
      expect(tool.description.length).toBeLessThan(200)
      expect(tool.description).toContain("mcp_name")
    })

    it("includes grep parameter in schema", () => {
      // given / #when
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => [],
        getSessionID: () => "session",
      })

      // then
      expect(tool.description).toBeDefined()
    })

    it("mentions cdp_url support", () => {
      // given / #when
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => [],
        getSessionID: () => "session",
      })

      // then
      expect(tool.description).toContain("cdp_url")
    })

    it("includes cdp_url as an optional string in schema", () => {
      // given / #when
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => [],
        getSessionID: () => "session",
      })
      const cdpUrlSchema = tool.args.cdp_url
      const cdpUrlDef = typeof cdpUrlSchema === "object" && cdpUrlSchema !== null
        ? Reflect.get(cdpUrlSchema, "def")
        : undefined
      const cdpUrlInnerType = typeof cdpUrlDef === "object" && cdpUrlDef !== null
        ? Reflect.get(cdpUrlDef, "innerType")
        : undefined
      const cdpUrlInnerDef = typeof cdpUrlInnerType === "object" && cdpUrlInnerType !== null
        ? Reflect.get(cdpUrlInnerType, "def")
        : undefined

      // then
      expect(cdpUrlSchema).toBeDefined()
      expect(Reflect.get(cdpUrlDef as object, "type")).toBe("optional")
      expect(Reflect.get(cdpUrlInnerDef as object, "type")).toBe("string")
    })
  })

  describe("cdp_url execution", () => {
    it("passes cdpUrl options through to manager.callTool when provided", async () => {
      // given
      loadedSkills = [
        createMockSkillWithMcp("browser-skill", {
          playwright: { command: "npx", args: ["@playwright/mcp@latest"] },
        }),
      ]
      const callToolSpy = spyOn(manager, "callTool").mockResolvedValue([{ type: "text", text: "ok" }] as never)
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when
      await tool.execute({
        mcp_name: "playwright",
        tool_name: "browser_navigate",
        arguments: { url: "https://example.com" },
        cdp_url: "http://localhost:9222",
      }, mockContext)

      // then
      expect(callToolSpy).toHaveBeenCalledWith(
        expect.objectContaining({ serverName: "playwright", sessionID: mockContext.sessionID }),
        expect.any(Object),
        "browser_navigate",
        { url: "https://example.com" },
        { cdpUrl: "http://localhost:9222" },
      )
    })

    it("uses manager.callTool when cdp_url is omitted", async () => {
      // given
      loadedSkills = [
        createMockSkillWithMcp("browser-skill", {
          playwright: { command: "npx", args: ["@playwright/mcp@latest"] },
        }),
      ]
      const callToolSpy = spyOn(manager, "callTool").mockResolvedValue([{ type: "text", text: "ok" }] as never)
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when
      await tool.execute({
        mcp_name: "playwright",
        tool_name: "browser_navigate",
        arguments: { url: "https://example.com" },
      }, mockContext)

      // then
      expect(callToolSpy).toHaveBeenCalledWith(
        expect.objectContaining({ serverName: "playwright", sessionID: mockContext.sessionID }),
        expect.any(Object),
        "browser_navigate",
        { url: "https://example.com" },
        undefined,
      )
    })
  })

  describe("session resolution", () => {
    it("uses the tool context sessionID when the fallback getter is empty", async () => {
      // given
      loadedSkills = [
        createMockSkillWithMcp("test-skill", {
          "test-server": { command: "echo", args: ["test"] },
        }),
      ]
      const callToolSpy = spyOn(manager, "callTool").mockResolvedValue({ content: [] } as never)
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => "",
      })

      // when
      await tool.execute({ mcp_name: "test-server", tool_name: "some-tool" }, mockContext)

      // then
      expect(callToolSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sessionID: mockContext.sessionID }),
        expect.any(Object),
        "some-tool",
        {},
        undefined,
      )
    })

    it("passes toolContext.directory to the manager", async () => {
      // given
      loadedSkills = [
        createMockSkillWithMcp("test-skill", {
          "test-server": { command: "echo", args: ["test"] },
        }),
      ]
      const callToolSpy = spyOn(manager, "callTool").mockResolvedValue({ content: [] } as never)
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => "session-1",
      })

      // when
      await tool.execute({ mcp_name: "test-server", tool_name: "some-tool" }, mockContext)

      // then
      expect(callToolSpy).toHaveBeenCalledWith(
        expect.objectContaining({ directory: "/test" }),
        expect.any(Object),
        "some-tool",
        {},
        undefined,
      )
    })
  })
})

describe("applyGrepFilter", () => {
  it("filters lines matching pattern", () => {
    // given
    const output = `line1: hello world
line2: foo bar
line3: hello again
line4: baz qux`

    // when
    const result = applyGrepFilter(output, "hello")

    // then
    expect(result).toContain("line1: hello world")
    expect(result).toContain("line3: hello again")
    expect(result).not.toContain("foo bar")
    expect(result).not.toContain("baz qux")
  })

  it("returns original output when pattern is undefined", () => {
    // given
    const output = "some output"

    // when
    const result = applyGrepFilter(output, undefined)

    // then
    expect(result).toBe(output)
  })

  it("returns message when no lines match", () => {
    // given
    const output = "line1\nline2\nline3"

    // when
    const result = applyGrepFilter(output, "xyz")

    // then
    expect(result).toContain("[grep] No lines matched pattern")
  })

  it("handles invalid regex gracefully", () => {
    // given
    const output = "some output"

    // when
    const result = applyGrepFilter(output, "[invalid")

    // then
    expect(result).toBe(output)
  })
})
