import path from "node:path"

import { log } from "../../../shared/logger"

import { validatePluginConfig } from "../../../config/validate"
import { dispatchInternalPrompt } from "../../../shared/prompt-async-gate"
import type { PluginContext } from "../../../plugin/types"
import type { CrossProjectMailboxConfig } from "../config"
import { BodyDigestStore, SamePairRateLimiter } from "../loop-guard"
import { MailboxStore, PendingDeliveryStore } from "../mailbox"
import { resolveSessionAgent } from "../../../plugin/session-agent-resolver"
import { normalizePrimaryAgent, resolveActivePrimaryAgent } from "../primary-resolver"
import { createProjectRegistry } from "../registry"
import type { ProjectEntry } from "../registry/types"
import { buildTriagePrompt } from "../triage"
import { validateInbound } from "../validation"
import { getServerBaseUrl } from "../../../shared/opencode-http-api"
import { projectIdForRoot } from "../envelope/project-id"
import {
  createModeDetector,
  createPresenceHeartbeatHook,
  type ModeDetector,
  type ModeDetectorDeps,
  type PresenceHeartbeatDeps,
  type PresenceHeartbeatHook,
} from "../presence"
import { createIdleDrainHook, type IdleDrainHookDeps } from "./idle-drain-hook"

export type MailboxHooks = {
  mailboxIdleDrain: ReturnType<typeof createIdleDrainHook> | null
  mailboxPresenceHeartbeat: PresenceHeartbeatHook | null
}

const MAILBOX_MARKER_PATTERN = /\[mailbox-message-id: ([^\]\s]+)\]/g

function collectMarkerIds(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(MAILBOX_MARKER_PATTERN)) {
      const id = match[1]
      if (id !== undefined) into.add(id)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectMarkerIds(entry, into)
    return
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) collectMarkerIds(entry, into)
  }
}

export async function loadSessionMessageIds(
  ctx: PluginContext,
  sessionId: string,
): Promise<string[]> {
  const session = ctx.client?.session
  const messagesApi = session?.messages
  if (typeof messagesApi !== "function") return []
  try {
    const result = await messagesApi.call(session, {
      path: { id: sessionId },
      query: { directory: ctx.directory },
    })
    const data = (result as { data?: unknown })?.data ?? result
    if (!Array.isArray(data)) return []
    const ids = new Set<string>()
    for (const entry of data) {
      const id = (entry as { info?: { id?: unknown }; id?: unknown })?.info?.id
        ?? (entry as { id?: unknown })?.id
      if (typeof id === "string") ids.add(id)
      collectMarkerIds(entry, ids)
    }
    return [...ids]
  } catch (error) {
    log("mailbox load session messages failed", {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      sessionId,
    })
    return []
  }
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
    resolveActivePrimaryAgent: async (sessionId) => {
      const cachedPrimary = resolveActivePrimaryAgent(sessionId)
      if (cachedPrimary !== undefined) return cachedPrimary
      return normalizePrimaryAgent(await resolveSessionAgent(ctx.client, sessionId))
    },
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

export type PresenceHeartbeatOverrides = Pick<
  PresenceHeartbeatDeps,
  "writeRecord" | "homeDir" | "now" | "onBeat"
> &
  Pick<ModeDetectorDeps, "readOwnRecord" | "settleMs">

export function buildPresenceHeartbeatHook(
  ctx: PluginContext,
  overrides?: PresenceHeartbeatOverrides,
  sharedModeDetector?: ModeDetector,
): PresenceHeartbeatHook | null {
  const repoRoot = ctx.directory
  // Do NOT early-return on a null serverUrl: internal sessions must keep heartbeating so peers see
  // freshness; the mode detector confirms internal vs external and the record is tagged accordingly.
  const resolveServerUrl = (): string | null => ctx.serverUrl?.toString() ?? getServerBaseUrl(ctx.client)
  const serverUrl = resolveServerUrl()
  let projectId: string
  try {
    projectId = projectIdForRoot(repoRoot)
  } catch (error) {
    log("mailbox presence heartbeat disabled: projectId resolution failed", { error })
    return null
  }
  const modeDetector =
    sharedModeDetector ??
    createModeDetector({
      resolveServerUrl,
      repoRoot,
      readOwnRecord: overrides?.readOwnRecord,
      settleMs: overrides?.settleMs,
    })
  return createPresenceHeartbeatHook({
    projectId,
    repoRoot,
    serverUrl,
    modeDetector,
    writeRecord: overrides?.writeRecord,
    homeDir: overrides?.homeDir,
    now: overrides?.now,
    onBeat: overrides?.onBeat,
  })
}

export function createMailboxHooks(
  ctx: PluginContext,
  config: CrossProjectMailboxConfig | undefined,
  sharedModeDetector?: ModeDetector,
): MailboxHooks {
  if (!config?.enabled) return { mailboxIdleDrain: null, mailboxPresenceHeartbeat: null }
  const mailboxIdleDrain = createIdleDrainHook(buildIdleDrainDeps(ctx, config))
  const mailboxPresenceHeartbeat = buildPresenceHeartbeatHook(
    ctx,
    {
      onBeat: async (sessionId) => {
        await mailboxIdleDrain["session.idle"]({ sessionId })
      },
    },
    sharedModeDetector,
  )
  return {
    mailboxIdleDrain,
    mailboxPresenceHeartbeat,
  }
}
