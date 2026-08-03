import path from "node:path"

import { log } from "../../../shared/logger"

import { validatePluginConfig } from "../../../config/validate"
import { dispatchInternalPrompt } from "../../../shared/prompt-async-gate"
import type { PluginContext } from "../../../plugin/types"
import type { CrossProjectMailboxConfig } from "../config"
import { createLiveMailboxConfigResolver } from "../config/live-config"
import { BodyDigestStore, SamePairRateLimiter } from "../loop-guard"
import { createTodoInjector } from "../todo-inject"
import { defaultCheckWorkerReplyExists, runWorkerPrWatchdogTick } from "../lanes/worker-pr-watchdog"
import { MailboxStore, PendingDeliveryStore } from "../mailbox"
import { resolveSessionAgent } from "../../../plugin/session-agent-resolver"
import { normalizePrimaryAgent, resolveActivePrimaryAgent } from "../primary-resolver"
import { createProjectRegistry, type ProjectRegistry } from "../registry"
import type { ProjectEntry } from "../registry/types"
import { createMailboxTraceEmit } from "../trace"
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
import type { BackgroundManager } from "../../../features/background-agent"
import { getMainSessionID } from "../../../features/claude-code-session-state"
import { getTimingConfig } from "../../../tools/delegate-task/timing"
import { CLASSIFIER_CATEGORY, ClassificationCache } from "../router/classifier"
import { createProductionClassifyNote } from "../router/production-classifier-adapter"
import type { UnreadMessage } from "../mailbox/types"
import type { ClassifyNoteDeps } from "./route-note-dispatcher"
import type { RouteDecision } from "../router/types"

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

async function getTaskOutputText(client: any, sessionId: string, directory: string): Promise<string> {
  const session = client.session
  const messagesApi = session?.messages
  if (typeof messagesApi !== "function") return ""
  try {
    const result = await messagesApi.call(session, {
      path: { id: sessionId },
      query: { directory },
    })
    const data = (result as { data?: unknown })?.data ?? result
    if (!Array.isArray(data)) return ""
    
    const extractedContent: string[] = []
    for (const message of data) {
      if (message.info?.role === "assistant") {
        for (const part of message.parts ?? []) {
          if (part.type === "text" && part.text) {
            extractedContent.push(part.text)
          }
        }
      }
    }
    return extractedContent.filter((text) => text.length > 0).join("\n\n")
  } catch (error) {
    log("mailbox get task output text failed", { error })
    return ""
  }
}

export function buildClassifyNote(
  ctx: PluginContext,
  config: CrossProjectMailboxConfig,
  backgroundManager?: BackgroundManager,
): ((note: UnreadMessage, deps: ClassifyNoteDeps) => Promise<RouteDecision>) | undefined {
  if (!backgroundManager) return undefined

  const cache = new ClassificationCache({
    repoRoot: ctx.directory,
    ttlMs: config.bounds.body_digest_ttl_min * 60_000,
  })

  const classify = async (prompt: string): Promise<string> => {
    const parentSessionId = getMainSessionID()
    if (!parentSessionId) {
      throw new Error("No active main session found for classification")
    }
    const task = await backgroundManager.launch({
      description: "mailbox classification",
      prompt,
      agent: "sisyphus-junior",
      category: CLASSIFIER_CATEGORY,
      parentSessionId,
      parentMessageId: "",
    })

    const timing = getTimingConfig()
    const timeoutMs = timing.WAIT_FOR_SESSION_TIMEOUT_MS || 30000
    const intervalMs = timing.WAIT_FOR_SESSION_INTERVAL_MS || 500
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      const updated = backgroundManager.getTask(task.id)
      if (!updated) {
        throw new Error("Task disappeared")
      }
      if (updated.status === "completed") {
        return await getTaskOutputText(ctx.client, updated.sessionId || "", ctx.directory)
      }
      if (updated.status === "error" || updated.status === "cancelled" || updated.status === "interrupt") {
        throw new Error(`Task failed with status: ${updated.status}. Error: ${updated.error}`)
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    throw new Error("Classification task timed out")
  }

  return createProductionClassifyNote({ classify, cache })
}

export function buildIdleDrainDeps(
  ctx: PluginContext,
  config: CrossProjectMailboxConfig,
  registry: Pick<ProjectRegistry, "listProjects"> = createProjectRegistry(),
  backgroundManager?: BackgroundManager,
): IdleDrainHookDeps {
  const repoRoot = ctx.directory
  const liveConfigResolver = createLiveMailboxConfigResolver(repoRoot, config)
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

  const todoInjector = createTodoInjector({ client: ctx.client, directory: ctx.directory, log })
  const classifyNote = buildClassifyNote(ctx, config, backgroundManager)
  const emitTrace = createMailboxTraceEmit({ repoRoot })

  return {
    config,
    validatePluginConfig,
    repoRoot,
    directory: ctx.directory,
    projectDisplayName: path.basename(repoRoot),
    client: ctx.client as IdleDrainHookDeps["client"],
    liveConfigResolver,
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
    classifyNote,
    todoInjector,
    emitTrace,
    workerPrLaneDeps: { repoRoot },
    workerPrWatchdogDeps: {
      checkWorkerReplyExists: (messageId) => defaultCheckWorkerReplyExists(repoRoot, messageId),
      log,
      now: Date.now,
      repoRoot,
      sendFallbackReply: async (messageId, body) => {
        log("[mailbox-worker-pr] fallback reply requested", { messageId, body })
      },
    },
    interruptLaneDeps: {
      client: ctx.client as IdleDrainHookDeps["client"],
      directory: ctx.directory,
      dispatchInternalPrompt,
      injector: todoInjector,
    },
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
  backgroundManager?: BackgroundManager,
): MailboxHooks {
  if (!config?.enabled) return { mailboxIdleDrain: null, mailboxPresenceHeartbeat: null }
  const idleDrainDeps = buildIdleDrainDeps(ctx, config, undefined, backgroundManager)
  const mailboxIdleDrain = createIdleDrainHook(idleDrainDeps)
  const mailboxPresenceHeartbeat = buildPresenceHeartbeatHook(
    ctx,
    {
      onBeat: async (sessionId) => {
        if (idleDrainDeps.workerPrWatchdogDeps !== undefined) {
          await runWorkerPrWatchdogTick(idleDrainDeps.workerPrWatchdogDeps)
        }
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
