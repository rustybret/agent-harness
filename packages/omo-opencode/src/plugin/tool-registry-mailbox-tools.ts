import path from "node:path"

import type { ToolDefinition } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../config"
import { createProjectMessageTool, createProjectNoteTool } from "../tools"
import { projectIdForRoot } from "../features/cross-project-mailbox/envelope"
import {
  createModeDetector,
  defaultProbeSession,
  type ModeDetector,
} from "../features/cross-project-mailbox/presence"
import { createProjectRegistry } from "../features/cross-project-mailbox/registry"
import { getServerBaseUrl } from "../shared/opencode-http-api"
import type { PluginContext } from "./types"
import type { ToolRegistryFactories } from "./tool-registry-factories"

// Both tools register whenever config.enabled; the internal/external split is enforced at execution
// time via a shared mode detector, not at registration. One detector instance keeps both tools on a
// consistent memoized mode for the session.
export function createMailboxToolsRecord(args: {
  readonly pluginConfig: OhMyOpenCodeConfig
  readonly ctx: PluginContext
  readonly factories?: Pick<ToolRegistryFactories, "createProjectMessageTool" | "createProjectNoteTool">
  readonly modeDetector?: Pick<ModeDetector, "currentMode" | "detect">
}): Record<string, ToolDefinition> {
  const { pluginConfig, ctx, factories } = args
  const config = pluginConfig.cross_project_mailbox
  if (!config?.enabled) return {}

  const messageFactory = factories?.createProjectMessageTool ?? createProjectMessageTool
  const noteFactory = factories?.createProjectNoteTool ?? createProjectNoteTool
  const repoRoot = ctx.directory
  const registry = createProjectRegistry()
  const modeDetector =
    args.modeDetector ??
    createModeDetector({
      resolveServerUrl: () => ctx.serverUrl?.toString() ?? getServerBaseUrl(ctx.client),
      repoRoot,
      probe: defaultProbeSession,
    })

  const sharedDeps = {
    config,
    thisProjectId: projectIdForRoot(repoRoot),
    thisRepoRoot: repoRoot,
    thisProjectDisplayName: path.basename(repoRoot),
    registry: { listProjects: () => registry.listProjects() },
  }

  return {
    project_message: messageFactory(sharedDeps),
    project_note: noteFactory({ ...sharedDeps, modeDetector }),
  }
}
