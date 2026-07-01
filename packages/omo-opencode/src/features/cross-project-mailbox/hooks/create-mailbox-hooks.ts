import path from "node:path"

import { log } from "../../../shared/logger"

import { validatePluginConfig } from "../../../config/validate"
import { dispatchInternalPrompt } from "../../../shared/prompt-async-gate"
import type { PluginContext } from "../../../plugin/types"
import type { CrossProjectMailboxConfig } from "../config"
import { BodyDigestStore, SamePairRateLimiter } from "../loop-guard"
import { MailboxStore, PendingDeliveryStore } from "../mailbox"
import { resolveActivePrimaryAgent } from "../primary-resolver"
import { createProjectRegistry } from "../registry"
import type { ProjectEntry } from "../registry/types"
import { buildTriagePrompt } from "../triage"
import { validateInbound } from "../validation"
import { getServerBaseUrl } from "../../../shared/opencode-http-api"
import { projectIdForRoot } from "../envelope/project-id"
import {
  createPresenceHeartbeatHook,
  type PresenceHeartbeatHook,
} from "../presence"
import { createIdleDrainHook, type IdleDrainHookDeps } from "./idle-drain-hook"

export type MailboxHooks = {
  mailboxIdleDrain: ReturnType<typeof createIdleDrainHook> | null
  mailboxPresenceHeartbeat: PresenceHeartbeatHook | null
}

function loadSessionMessageIds(
  ctx: PluginContext,
  sessionId: string,
): Promise<string[]> {
  const messagesApi = ctx.client?.session?.messages
  if (typeof messagesApi !== "function") return Promise.resolve([])
  return Promise.resolve(
    messagesApi({ path: { id: sessionId }, query: { directory: ctx.directory } }),
  )
    .then((result) => {
      const data = (result as { data?: unknown })?.data ?? result
      if (!Array.isArray(data)) return []
      const ids: string[] = []
      for (const entry of data) {
        const id = (entry as { info?: { id?: unknown }; id?: unknown })?.info?.id
          ?? (entry as { id?: unknown })?.id
        if (typeof id === "string") ids.push(id)
      }
      return ids
    })
    .catch((error) => {
      log("mailbox load session messages failed", { error, sessionId })
      return []
    })
}

function buildIdleDrainDeps(
  ctx: PluginContext,
  config: CrossProjectMailboxConfig,
): IdleDrainHookDeps {
  const repoRoot = ctx.directory
  const registry = createProjectRegistry()
  let projectsSnapshot: ProjectEntry[] = []
  const refreshSnapshot = (): void => {
    registry
      .listProjects()
      .then((projects) => {
        projectsSnapshot = projects.filter((entry) => entry.repoRoot !== repoRoot)
      })
      .catch((error) => {
        log("mailbox refresh snapshot failed", { error })
      })
  }
  refreshSnapshot()

  return {
    config,
    validatePluginConfig,
    repoRoot,
    directory: ctx.directory,
    projectDisplayName: path.basename(repoRoot),
    client: ctx.client as IdleDrainHookDeps["client"],
    resolveActivePrimaryAgent,
    getRegisteredProjects: () => {
      refreshSnapshot()
      return projectsSnapshot
    },
    makeMailboxStore: (targetRoot, fromProjectId) =>
      new MailboxStore(targetRoot, fromProjectId, {
        reservation_ttl_ms: config.bounds.reservation_ttl_ms,
      }),
    makePendingStore: (targetRoot) => new PendingDeliveryStore(targetRoot),
    makeDigestStore: (root) =>
      new BodyDigestStore(root, config.bounds.body_digest_ttl_min * 60_000),
    makeRateLimiter: (root) =>
      new SamePairRateLimiter(root, config.bounds.same_pair_rate_limit_per_min),
    validateInbound,
    buildTriagePrompt,
    dispatchInternalPrompt,
    getSessionMessages: (sessionId) => loadSessionMessageIds(ctx, sessionId),
  }
}

function buildPresenceHeartbeatHook(ctx: PluginContext): PresenceHeartbeatHook | null {
  const repoRoot = ctx.directory
  const serverUrl = getServerBaseUrl(ctx.client)
  if (serverUrl === null) {
    log("mailbox presence heartbeat disabled: no server base url")
    return null
  }
  let projectId: string
  try {
    projectId = projectIdForRoot(repoRoot)
  } catch (error) {
    log("mailbox presence heartbeat disabled: projectId resolution failed", { error })
    return null
  }
  return createPresenceHeartbeatHook({ projectId, repoRoot, serverUrl })
}

export function createMailboxHooks(
  ctx: PluginContext,
  config: CrossProjectMailboxConfig | undefined,
): MailboxHooks {
  if (!config?.enabled) return { mailboxIdleDrain: null, mailboxPresenceHeartbeat: null }
  return {
    mailboxIdleDrain: createIdleDrainHook(buildIdleDrainDeps(ctx, config)),
    mailboxPresenceHeartbeat: buildPresenceHeartbeatHook(ctx),
  }
}
