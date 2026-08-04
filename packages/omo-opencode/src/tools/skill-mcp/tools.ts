import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { BUILTIN_MCP_TOOL_HINTS, SKILL_MCP_DESCRIPTION } from "./constants"
import { parseSkillMcpArguments } from "./parse-skill-mcp-arguments"
import type { SkillMcpArgs } from "./types"
import type {
  SkillMcpClientInfo,
  SkillMcpClientOptions,
  SkillMcpManager,
  SkillMcpServerContext,
} from "../../features/skill-mcp-manager"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

interface SkillMcpToolOptions {
  manager: SkillMcpManager
  getLoadedSkills: () => LoadedSkill[] | Promise<LoadedSkill[]>
  getSessionID?: () => string | undefined
}

type OperationType = { type: "tool" | "resource" | "prompt"; name: string }

function validateOperationParams(args: SkillMcpArgs): OperationType {
  const operations: OperationType[] = []
  if (args.tool_name) operations.push({ type: "tool", name: args.tool_name })
  if (args.resource_name) operations.push({ type: "resource", name: args.resource_name })
  if (args.prompt_name) operations.push({ type: "prompt", name: args.prompt_name })

  if (operations.length === 0) {
    throw new Error(
      `Missing operation. Exactly one of tool_name, resource_name, or prompt_name must be specified.\n\n` +
        `Examples:\n` +
        `  skill_mcp(mcp_name="sqlite", tool_name="query", arguments='{"sql": "SELECT * FROM users"}')\n` +
        `  skill_mcp(mcp_name="memory", resource_name="memory://notes")\n` +
        `  skill_mcp(mcp_name="helper", prompt_name="summarize", arguments='{"text": "..."}')`,
    )
  }

  if (operations.length > 1) {
    const provided = [
      args.tool_name && `tool_name="${args.tool_name}"`,
      args.resource_name && `resource_name="${args.resource_name}"`,
      args.prompt_name && `prompt_name="${args.prompt_name}"`,
    ]
      .filter(Boolean)
      .join(", ")

    throw new Error(
      `Multiple operations specified. Exactly one of tool_name, resource_name, or prompt_name must be provided.\n\n` +
        `Received: ${provided}\n\n` +
        `Use separate calls for each operation.`,
    )
  }

  return operations[0]
}

function findMcpServer(
  mcpName: string,
  skills: LoadedSkill[],
): { skill: LoadedSkill; config: NonNullable<LoadedSkill["mcpConfig"]>[string] } | null {
  for (const skill of skills) {
    if (skill.mcpConfig && mcpName in skill.mcpConfig) {
      return { skill, config: skill.mcpConfig[mcpName] }
    }
  }
  return null
}

function formatAvailableMcps(skills: LoadedSkill[]): string {
  const mcps: string[] = []
  for (const skill of skills) {
    if (skill.mcpConfig) {
      for (const serverName of Object.keys(skill.mcpConfig)) {
        mcps.push(`  - "${serverName}" from skill "${skill.name}"`)
      }
    }
  }
  return mcps.length > 0 ? mcps.join("\n") : "  (none found)"
}

function formatBuiltinMcpHint(mcpName: string): string | null {
  const nativeTools = BUILTIN_MCP_TOOL_HINTS[mcpName]
  if (!nativeTools) return null
  return (
    `"${mcpName}" is a builtin MCP, not a skill MCP.\n` +
    `skill_mcp can only call MCP servers declared by loaded skills; do not retry this builtin through skill_mcp.\n` +
    `Use the native builtin tool names when OpenCode exposes them:\n` +
    nativeTools.map((toolName) => `  - ${toolName}`).join("\n")
  )
}

const NOT_FOUND_PATTERN = /(tool|resource|prompt|method)\s+not\s+found|unknown\s+(tool|resource|prompt)/i

const MAX_LISTED_NAMES = 60

function formatNameList(names: readonly string[]): string {
  if (names.length === 0) return "  (the server reports none)"
  const shown = names.slice(0, MAX_LISTED_NAMES).map((name) => `  - ${name}`)
  if (names.length > MAX_LISTED_NAMES) {
    shown.push(`  ... and ${names.length - MAX_LISTED_NAMES} more`)
  }
  return shown.join("\n")
}

async function listNamesForOperation(input: {
  readonly manager: SkillMcpManager
  readonly info: SkillMcpClientInfo
  readonly context: SkillMcpServerContext
  readonly operation: OperationType
  readonly options: SkillMcpClientOptions | undefined
}): Promise<string[]> {
  const { manager, info, context, options } = input
  switch (input.operation.type) {
    case "tool":
      return (await manager.listTools(info, context, options)).map((entry) => entry.name)
    case "resource":
      return (await manager.listResources(info, context, options)).map((entry) => entry.uri)
    case "prompt":
      return (await manager.listPrompts(info, context, options)).map((entry) => entry.name)
  }
}

/**
 * Turns a bare "Tool not found" into one that names what the server actually offers.
 *
 * An unknown SERVER already gets a list of the available ones, but an unknown tool ON a known
 * server does not - the caller is told the name is wrong and nothing else, so the only way forward
 * is to guess again. Observed across 89 failures spanning 63 distinct guessed names against a
 * single server.
 *
 * The list is fetched only after a failure, so the success path is unchanged. If listing also fails
 * the original error is preserved: a diagnostic must never replace the fault it is describing.
 */
async function enrichNotFoundError(input: {
  readonly error: unknown
  readonly manager: SkillMcpManager
  readonly info: SkillMcpClientInfo
  readonly context: SkillMcpServerContext
  readonly operation: OperationType
  readonly options: SkillMcpClientOptions | undefined
}): Promise<never> {
  const error = input.error
  if (!(error instanceof Error) || !NOT_FOUND_PATTERN.test(error.message)) throw error

  const names = await listNamesForOperation(input).catch(() => undefined)
  if (names === undefined) throw error

  const label = input.operation.type === "resource" ? "resources" : `${input.operation.type}s`
  throw new Error(
    `${error.message}\n\n` +
      `"${input.operation.name}" is not exposed by MCP server "${input.info.serverName}".\n` +
      `Available ${label} on this server:\n` +
      formatNameList(names),
  )
}

export function applyGrepFilter(output: string, pattern: string | undefined): string {
  if (!pattern) return output
  try {
    const regex = new RegExp(pattern, "i")
    const lines = output.split("\n")
    const filtered = lines.filter((line) => regex.test(line))
    return filtered.length > 0 ? filtered.join("\n") : `[grep] No lines matched pattern: ${pattern}`
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return output
  }
}

export function createSkillMcpTool(options: SkillMcpToolOptions): ToolDefinition {
  const { manager, getLoadedSkills, getSessionID } = options

  return tool({
    description: `${SKILL_MCP_DESCRIPTION} Optional cdp_url connects Playwright to a runtime CDP endpoint.`,
    args: {
      mcp_name: tool.schema.string().describe("Name of the MCP server from skill config"),
      tool_name: tool.schema.string().optional().describe("MCP tool to call"),
      resource_name: tool.schema.string().optional().describe("MCP resource URI to read"),
      prompt_name: tool.schema.string().optional().describe("MCP prompt to get"),
      arguments: tool.schema
        .union([tool.schema.string(), tool.schema.object({})])
        .optional()
        .describe("JSON string or object of arguments"),
      grep: tool.schema
        .string()
        .optional()
        .describe("Regex pattern to filter output lines (only matching lines returned)"),
      cdp_url: tool.schema
        .string()
        .optional()
        .describe(
          "CDP endpoint URL to connect Playwright to an existing browser (e.g. http://localhost:9222). Creates a separate MCP instance per unique URL."
        ),
    },
    async execute(args: SkillMcpArgs, toolContext: ToolContext) {
      const operation = validateOperationParams(args)
      const skills = await getLoadedSkills()
      const found = findMcpServer(args.mcp_name, skills)

      if (!found) {
        const builtinHint = formatBuiltinMcpHint(args.mcp_name)
        if (builtinHint) {
          throw new Error(builtinHint)
        }

        throw new Error(
          `MCP server "${args.mcp_name}" not found.\n\n` +
            `Available MCP servers in loaded skills:\n` +
            formatAvailableMcps(skills) +
            `\n\n` +
            `Hint: Load the skill first using the 'skill' tool, then call skill_mcp.`,
        )
      }

      const sessionID = toolContext.sessionID || getSessionID?.()
      if (!sessionID) {
        throw new Error("No active session available for skill MCP call.")
      }

      const info: SkillMcpClientInfo = {
        serverName: args.mcp_name,
        skillName: found.skill.name,
        sessionID,
        scope: found.skill.scope,
        directory: toolContext.directory,
      }

      const context: SkillMcpServerContext = {
        config: found.config,
        skillName: found.skill.name,
      }

      const parsedArgs = parseSkillMcpArguments(args.arguments)

      let output: string
      const cdpOptions = args.cdp_url ? { cdpUrl: args.cdp_url } : undefined
      const onFailure = (error: unknown): Promise<never> =>
        enrichNotFoundError({ error, manager, info, context, operation, options: cdpOptions })

      switch (operation.type) {
        case "tool": {
          const result = await manager
            .callTool(info, context, operation.name, parsedArgs, cdpOptions)
            .catch(onFailure)
          output = JSON.stringify(result, null, 2)
          break
        }
        case "resource": {
          const result = await manager
            .readResource(info, context, operation.name, cdpOptions)
            .catch(onFailure)
          output = JSON.stringify(result, null, 2)
          break
        }
        case "prompt": {
          const stringArgs: Record<string, string> = {}
          for (const [key, value] of Object.entries(parsedArgs)) {
            stringArgs[key] = String(value)
          }
          const result = await manager
            .getPrompt(info, context, operation.name, stringArgs, cdpOptions)
            .catch(onFailure)
          output = JSON.stringify(result, null, 2)
          break
        }
      }
      return applyGrepFilter(output, args.grep)
    },
  })
}
