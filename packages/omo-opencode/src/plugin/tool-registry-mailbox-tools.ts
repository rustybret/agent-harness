import path from "node:path"

import type { ToolDefinition } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../config"
import { createProjectMessageTool } from "../tools"
import { projectIdForRoot } from "../features/cross-project-mailbox/envelope"
import { createProjectRegistry } from "../features/cross-project-mailbox/registry"
import type { PluginContext } from "./types"
import type { ToolRegistryFactories } from "./tool-registry-factories"

export function createMailboxToolsRecord(args: {
  readonly pluginConfig: OhMyOpenCodeConfig
  readonly ctx: PluginContext
  readonly factories?: Pick<ToolRegistryFactories, "createProjectMessageTool">
}): Record<string, ToolDefinition> {
  const { pluginConfig, ctx, factories } = args
  const config = pluginConfig.cross_project_mailbox
  if (!config?.enabled) return {}

  const factory = factories?.createProjectMessageTool ?? createProjectMessageTool
  const repoRoot = ctx.directory
  const registry = createProjectRegistry()

  return {
    project_message: factory({
      config,
      thisProjectId: projectIdForRoot(repoRoot),
      thisRepoRoot: repoRoot,
      thisProjectDisplayName: path.basename(repoRoot),
      registry: { listProjects: () => registry.listProjects() },
    }),
  }
}
