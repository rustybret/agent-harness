import path from "node:path"

import type { ToolDefinition } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../config"
import {
  createProjectMailboxDrainTool,
  createProjectMailboxPeekTool,
  createProjectMessageTool,
  createProjectNoteTool,
} from "../tools"
import { projectIdForRoot } from "../features/cross-project-mailbox/envelope"
import { createLiveMailboxConfigResolver } from "../features/cross-project-mailbox/config/live-config"
import { BodyDigestStore, SamePairRateLimiter } from "../features/cross-project-mailbox/loop-guard"
import { MailboxStore } from "../features/cross-project-mailbox/mailbox"
import { createProjectRegistry } from "../features/cross-project-mailbox/registry"
import { validateInbound } from "../features/cross-project-mailbox/validation"
import type { PluginContext } from "./types"
import type { ToolRegistryFactories } from "./tool-registry-factories"
import type { BackgroundManager } from "../features/background-agent"
import { buildClassifyNote } from "../features/cross-project-mailbox/hooks/create-mailbox-hooks"

// Both tools register whenever config.enabled. project_message sends from either session mode;
// project_note is deprecated and kept only so existing callers keep working.
export function createMailboxToolsRecord(args: {
  readonly pluginConfig: OhMyOpenCodeConfig
  readonly ctx: PluginContext
  readonly factories?: Pick<
    ToolRegistryFactories,
    | "createProjectMailboxDrainTool"
    | "createProjectMailboxPeekTool"
    | "createProjectMessageTool"
    | "createProjectNoteTool"
  >
  readonly backgroundManager?: BackgroundManager
}): Record<string, ToolDefinition> {
  const { pluginConfig, ctx, factories, backgroundManager } = args
  const config = pluginConfig.cross_project_mailbox
  if (!config?.enabled) return {}

  const drainFactory = factories?.createProjectMailboxDrainTool ?? createProjectMailboxDrainTool
  const peekFactory = factories?.createProjectMailboxPeekTool ?? createProjectMailboxPeekTool
  const messageFactory = factories?.createProjectMessageTool ?? createProjectMessageTool
  const noteFactory = factories?.createProjectNoteTool ?? createProjectNoteTool
  const repoRoot = ctx.directory
  const registry = createProjectRegistry()

  const liveConfigResolver = createLiveMailboxConfigResolver(repoRoot, config)

  const sharedDeps = {
    config,
    thisProjectId: projectIdForRoot(repoRoot),
    thisRepoRoot: repoRoot,
    thisProjectDisplayName: path.basename(repoRoot),
    registry: { listProjects: () => registry.listProjects() },
    liveConfigResolver,
  }
  const manualDeps = {
    config,
    repoRoot,
    projectDisplayName: path.basename(repoRoot),
    getRegisteredProjects: async () => (await registry.listProjects()).filter((entry) => entry.repoRoot !== repoRoot),
    makeMailboxStore: (targetRoot: string, fromProjectId: string) =>
      new MailboxStore(targetRoot, fromProjectId, {
        reservation_ttl_ms: config.bounds.reservation_ttl_ms,
      }),
    makeDigestStore: (root: string) =>
      new BodyDigestStore(root, config.bounds.body_digest_ttl_min * 60_000),
    makeRateLimiter: (root: string) =>
      new SamePairRateLimiter(root, config.bounds.same_pair_rate_limit_per_min),
    validateInbound,
    liveConfigResolver,
    classifyNote: buildClassifyNote(ctx, config, backgroundManager),
  }

  return {
    project_mailbox_peek: peekFactory(manualDeps),
    project_mailbox_drain: drainFactory(manualDeps),
    project_message: messageFactory(sharedDeps),
    project_note: noteFactory(sharedDeps),
  }
}
