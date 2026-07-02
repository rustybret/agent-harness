import {
  isInternalPromptDispatchAccepted,
} from "../../../shared/prompt-async-gate"
import { log } from "../../../shared/logger"
import type {
  InternalPromptDispatchArgs,
  InternalPromptDispatchResult,
} from "../../../shared/prompt-async-gate"
import type { CrossProjectMailboxConfig } from "../config"
import type { PendingEntry, QuarantineReason, UnreadMessage } from "../mailbox/types"
import type { ProjectEntry } from "../registry/types"
import type { buildTriagePrompt } from "../triage/template"
import type { validateInbound } from "../validation/validate-inbound"

export const IDLE_DRAIN_SOURCE = "cross-project-mailbox-idle-drain"

function isEligiblePrimary(config: CrossProjectMailboxConfig, primary: string): boolean {
  return (config.intake_eligible_agents as readonly string[]).includes(primary)
}

function isPermissionlessConfig(config: CrossProjectMailboxConfig): boolean {
  if (config.default_sender_access !== "allow-none") return false
  return !Object.values(config.senders ?? {}).some((sender) => sender.access === "allow")
}

function resolveFreshConfig(deps: IdleDrainHookDeps): CrossProjectMailboxConfig {
  const read = deps.validatePluginConfig(deps.directory)
  const fresh = read.config?.cross_project_mailbox
  if (read.valid && fresh) return fresh
  return deps.config
}

type AsyncDispatchArgs = Extract<InternalPromptDispatchArgs, { mode: "async" }>
type DispatchClient = AsyncDispatchArgs["client"]

export interface MailboxStorePort {
  reclaimStale(sessionMessageIds: Set<string>): Promise<void>
  drainUnread(maxNotes: number): Promise<UnreadMessage[]>
  reserve(messageId: string): Promise<string | undefined>
  quarantine(messageId: string, reason: QuarantineReason, detail?: string): Promise<void>
  markDispatched(entry: Omit<PendingEntry, "state">): Promise<void>
}

export interface PendingStorePort {
  addDispatchSent(entry: Omit<PendingEntry, "state">): Promise<void>
}

export interface DigestStorePort {
  checkAndRecord(note: {
    fromProjectId: string
    toProjectId: string
    correlationId: string
    body: string
  }): Promise<{ isDuplicate: boolean }>
}

export interface RateLimiterPort {
  checkRateLimit(fromProjectId: string, toProjectId: string): Promise<{ limited: boolean }>
}

export interface PluginConfigReadResult {
  valid: boolean
  config: { cross_project_mailbox?: CrossProjectMailboxConfig }
}

export type ValidatePluginConfigPort = (directory: string) => PluginConfigReadResult

export interface IdleDrainHookDeps {
  config: CrossProjectMailboxConfig
  validatePluginConfig: ValidatePluginConfigPort
  repoRoot: string
  directory: string
  projectDisplayName: string
  client: DispatchClient
  resolveActivePrimaryAgent: (sessionId: string) => string | undefined
  getRegisteredProjects: () => ProjectEntry[]
  makeMailboxStore: (targetRoot: string, fromProjectId: string) => MailboxStorePort
  makePendingStore: (targetRoot: string) => PendingStorePort
  makeDigestStore: (repoRoot: string) => DigestStorePort
  makeRateLimiter: (repoRoot: string) => RateLimiterPort
  validateInbound: typeof validateInbound
  buildTriagePrompt: typeof buildTriagePrompt
  dispatchInternalPrompt: (
    args: InternalPromptDispatchArgs,
  ) => Promise<InternalPromptDispatchResult>
  getSessionMessages: (sessionId: string) => Promise<string[]>
}

function buildDispatchArgs(
  deps: IdleDrainHookDeps,
  sessionId: string,
  triageText: string,
): AsyncDispatchArgs {
  return {
    mode: "async",
    client: deps.client,
    sessionID: sessionId,
    source: IDLE_DRAIN_SOURCE,
    input: {
      path: { id: sessionId },
      body: { parts: [{ type: "text", text: triageText }] },
      query: { directory: deps.directory },
    },
  }
}

async function processNote(
  deps: IdleDrainHookDeps,
  config: CrossProjectMailboxConfig,
  store: MailboxStorePort,
  digestStore: DigestStorePort,
  rateLimiter: RateLimiterPort,
  sessionId: string,
  note: UnreadMessage,
): Promise<boolean> {
  const envelope = note.envelope

  const duplicate = await digestStore.checkAndRecord({
    fromProjectId: envelope.fromProjectId,
    toProjectId: envelope.toProjectId,
    correlationId: envelope.correlationId,
    body: note.body,
  })
  if (duplicate.isDuplicate) {
    const dupResult = deps.validateInbound(envelope, config, { duplicateLoop: true })
    await store.quarantine(note.messageId, dupResult.reason ?? "duplicate-loop", dupResult.detail ?? "")
    return false
  }

  const rateLimit = await rateLimiter.checkRateLimit(envelope.fromProjectId, envelope.toProjectId)
  if (rateLimit.limited) {
    return false
  }

  const validation = deps.validateInbound(envelope, config)
  if (!validation.valid) {
    await store.quarantine(note.messageId, validation.reason ?? "malformed", validation.detail ?? "")
    return false
  }

  const reservedPath = await store.reserve(note.messageId)
  if (reservedPath === undefined) {
    return false
  }

  const triageText = deps.buildTriagePrompt(
    { ...envelope, body: note.body },
    { projectDisplayName: deps.projectDisplayName },
  )
  const dispatchResult = await deps.dispatchInternalPrompt({
    ...buildDispatchArgs(deps, sessionId, triageText),
    queueBehavior: "defer",
  })
  if (!isInternalPromptDispatchAccepted(dispatchResult)) {
    return false
  }

  await store.markDispatched({
    messageId: note.messageId,
    sessionId,
    reservedPath,
    dispatchedAt: Date.now(),
  })
  return true
}

export function createIdleDrainHook(deps: IdleDrainHookDeps): {
  "session.idle": (input: { sessionId: string }) => Promise<void>
} {
  return {
    "session.idle": async ({ sessionId }: { sessionId: string }): Promise<void> => {
      if (!sessionId) return

      const freshConfig = resolveFreshConfig(deps)

      if (freshConfig.enabled === false) {
        log("[mailbox-idle-drain] skipped: disabled", { sessionId })
        return
      }
      if (isPermissionlessConfig(freshConfig)) {
        log("[mailbox-idle-drain] skipped: permissionless config", { sessionId })
        return
      }

      const primary = deps.resolveActivePrimaryAgent(sessionId)
      if (primary === undefined || !isEligiblePrimary(freshConfig, primary)) {
        log("[mailbox-idle-drain] skipped: primary not eligible", {
          sessionId,
          primary: primary ?? null,
          eligible: freshConfig.intake_eligible_agents,
        })
        return
      }

      const maxNotes = freshConfig.bounds.max_notes_per_drain
      const projects = deps.getRegisteredProjects()
      const sessionMessageIds = new Set(await deps.getSessionMessages(sessionId))
      const digestStore = deps.makeDigestStore(deps.repoRoot)
      const rateLimiter = deps.makeRateLimiter(deps.repoRoot)

      let injected = 0
      for (const sender of projects) {
        if (injected >= maxNotes) break
        const store = deps.makeMailboxStore(deps.repoRoot, sender.projectId)
        await store.reclaimStale(sessionMessageIds)
        const candidates = await store.drainUnread(maxNotes)
        if (candidates.length > 0) {
          log("[mailbox-idle-drain] candidates found", {
            sessionId,
            sender: sender.projectId,
            count: candidates.length,
          })
        }
        for (const note of candidates) {
          if (injected >= maxNotes) break
          const dispatched = await processNote(deps, freshConfig, store, digestStore, rateLimiter, sessionId, note)
          if (dispatched) injected += 1
        }
      }
      if (injected > 0) {
        log("[mailbox-idle-drain] injected notes", { sessionId, injected })
      }
    },
  }
}
