import { isSessionActive } from "../../../shared/session-idle-settle"
import { log } from "../../../shared/logger"
import type { CrossProjectMailboxConfig } from "../config"
import { createLiveMailboxConfigResolver } from "../config/live-config"
import type { PendingEntry } from "../mailbox/types"
import type { ProjectEntry } from "../registry/types"
import type { buildTriagePrompt } from "../triage/template"
import type { validateInbound } from "../validation/validate-inbound"
import {
  IDLE_DRAIN_SOURCE,
  processNote,
  type DispatchClient,
  type IdleDrainProcessorDeps,
} from "./idle-drain-processor"
import type {
  DigestStorePort,
  MailboxStorePort,
  RateLimiterPort,
} from "../manual-drain/delivery-pipeline"

export { IDLE_DRAIN_SOURCE }
export type { DigestStorePort, MailboxStorePort, RateLimiterPort } from "../manual-drain/delivery-pipeline"

function isEligiblePrimary(config: CrossProjectMailboxConfig, primary: string): boolean {
  return (config.intake_eligible_agents as readonly string[]).includes(primary)
}

function isPermissionlessConfig(config: CrossProjectMailboxConfig): boolean {
  if (config.default_sender_access !== "allow-none") return false
  return !Object.values(config.senders ?? {}).some((sender) => sender.access === "allow")
}

export interface PendingStorePort {
  addDispatchSent(entry: Omit<PendingEntry, "state">): Promise<void>
}

export interface PluginConfigReadResult {
  valid: boolean
  config: { cross_project_mailbox?: CrossProjectMailboxConfig }
}

export type ValidatePluginConfigPort = (directory: string) => import("../../../config/validate").PluginConfigValidation

export interface IdleDrainHookDeps extends IdleDrainProcessorDeps {
  config: CrossProjectMailboxConfig
  validatePluginConfig: ValidatePluginConfigPort
  repoRoot: string
  directory: string
  projectDisplayName: string
  client: DispatchClient
  resolveActivePrimaryAgent: (sessionId: string) => string | undefined | Promise<string | undefined>
  getRegisteredProjects: () => ProjectEntry[]
  makeMailboxStore: (targetRoot: string, fromProjectId: string) => MailboxStorePort
  makePendingStore: (targetRoot: string) => PendingStorePort
  makeDigestStore: (repoRoot: string) => DigestStorePort
  makeRateLimiter: (repoRoot: string) => RateLimiterPort
  validateInbound: typeof validateInbound
  buildTriagePrompt: typeof buildTriagePrompt
  getSessionMessages: (sessionId: string) => Promise<string[]>
  liveConfigResolver?: { resolve: () => Promise<CrossProjectMailboxConfig> }
}

export interface IdleDrainHook {
  "session.idle": (input: { sessionId: string }) => Promise<void>
  runMailboxDrainNow: (sessionId: string) => Promise<{ triggered: boolean }>
}

async function shouldSkipDrain(input: {
  readonly deps: IdleDrainHookDeps
  readonly freshConfig: CrossProjectMailboxConfig
  readonly sessionId: string
}): Promise<boolean> {
  if (input.freshConfig.enabled === false) {
    log("[mailbox-idle-drain] skipped: disabled", { sessionId: input.sessionId })
    return true
  }
  if (isPermissionlessConfig(input.freshConfig)) {
    log("[mailbox-idle-drain] skipped: permissionless config", { sessionId: input.sessionId })
    return true
  }

  const primary = await input.deps.resolveActivePrimaryAgent(input.sessionId)
  if (primary !== undefined && isEligiblePrimary(input.freshConfig, primary)) return false
  log("[mailbox-idle-drain] skipped: primary not eligible", {
    sessionId: input.sessionId,
    primary: primary ?? null,
    eligible: input.freshConfig.intake_eligible_agents,
  })
  return true
}

export function createIdleDrainHook(deps: IdleDrainHookDeps): IdleDrainHook {
  const liveConfigResolver =
    deps.liveConfigResolver ??
    createLiveMailboxConfigResolver(deps.directory, deps.config, {
      validate: deps.validatePluginConfig,
    })
  const fallbackIds = new Set<string>()

  const runDrain = async (input: { readonly sessionId: string; readonly skipActiveCheck: boolean }): Promise<{ triggered: boolean }> => {
    const { sessionId, skipActiveCheck } = input
    if (!sessionId) return { triggered: false }

    const isActive = skipActiveCheck ? true : await isSessionActive(deps.client, sessionId).catch(() => false)
    if (!skipActiveCheck && isActive) {
      log("[mailbox-idle-drain] skipped: session is active", { sessionId })
      return { triggered: false }
    }

    const freshConfig = await liveConfigResolver.resolve()
    if (await shouldSkipDrain({ deps, freshConfig, sessionId })) return { triggered: false }

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
        log("[mailbox-idle-drain] candidates found", { sessionId, sender: sender.projectId, count: candidates.length })
      }
      for (const note of candidates) {
        if (injected >= maxNotes) break
        const dispatched = await processNote({
          deps,
          config: freshConfig,
          store,
          digestStore,
          rateLimiter,
          sessionId,
          note,
          routeContext: { presence: "live", inFlightLocalFlag: isActive },
          fallbackIds,
        })
        if (dispatched) injected += 1
      }
    }
    if (injected > 0) log("[mailbox-idle-drain] injected notes", { sessionId, injected })
    return { triggered: injected > 0 }
  }

  return {
    "session.idle": async ({ sessionId }: { sessionId: string }): Promise<void> => {
      await runDrain({ sessionId, skipActiveCheck: false })
    },
    runMailboxDrainNow: (sessionId: string): Promise<{ triggered: boolean }> =>
      runDrain({ sessionId, skipActiveCheck: true }),
  }
}
