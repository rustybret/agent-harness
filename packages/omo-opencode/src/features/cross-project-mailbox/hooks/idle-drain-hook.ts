import { isSessionActive } from "../../../shared/session-idle-settle"
import { log } from "../../../shared/logger"
import type { CrossProjectMailboxConfig } from "../config"
import { createLiveMailboxConfigResolver } from "../config/live-config"
import type { PendingEntry, UnreadMessage } from "../mailbox/types"
import type { ProjectEntry } from "../registry/types"
import type { buildTriagePrompt } from "../triage/template"
import type { validateInbound } from "../validation/validate-inbound"
import {
  IDLE_DRAIN_SOURCE,
  processNote,
  type DispatchClient,
  type IdleDrainProcessorDeps,
} from "./idle-drain-processor"
import { evaluateConfigDrainGate, evaluateDrainGate } from "../drain-gate"
import { DRAIN_SKIP_TRACE_ID } from "../trace"
import {
  digestNoteFor,
  type DigestStorePort,
  type MailboxStorePort,
  type RateLimiterPort,
} from "../manual-drain/delivery-pipeline"

export { IDLE_DRAIN_SOURCE }
export type { DigestStorePort, MailboxStorePort, RateLimiterPort } from "../manual-drain/delivery-pipeline"

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

/**
 * Releases the body digest of every note that reclaim just returned to the inbox.
 *
 * A note records its digest when a delivery attempt begins. If that attempt never confirms, reclaim
 * puts the note back for a retry - but the digest survives, and it outlives the reservation by a
 * wide margin (60 min vs 2 min by default). Without this the retry hashes to the same key and is
 * quarantined as `duplicate-loop`: the note is rejected as a duplicate of its own failed attempt,
 * and the sender is told its message was a loop.
 *
 * Only ids reclaim actually returned are released, so a genuine resend of identical content inside
 * the TTL is still suppressed.
 */
async function releaseReclaimedDigests(input: {
  readonly digestStore: DigestStorePort
  readonly candidates: readonly UnreadMessage[]
  readonly reclaimed: readonly string[]
}): Promise<void> {
  if (input.reclaimed.length === 0) return
  const reclaimedIds = new Set(input.reclaimed)
  for (const note of input.candidates) {
    if (!reclaimedIds.has(note.messageId)) continue
    await input.digestStore.rollback(digestNoteFor(note)).catch((error) => {
      log("[mailbox-idle-drain] failed to release digest for reclaimed note", {
        error,
        messageId: note.messageId,
      })
    })
  }
}

// Counts what the gate is holding back, so a skip is reported as "3 notes waiting" rather than as
// silence. Best-effort by construction: this runs on a blocked path, so a store failure must
// degrade the trace record, never the drain.
//
// Only called for primary-not-eligible. A disabled or permissionless mailbox must stay COMPLETELY
// inert - it touches no registry and no store - so those skips report no count rather than break
// that contract. That is also the honest split: an operator who turned the mailbox off is not
// surprised that nothing drains, whereas an enabled-but-gated mailbox silently holding notes is
// exactly the case worth quantifying.
async function countWaitingNotes(deps: IdleDrainHookDeps): Promise<number> {
  let waiting = 0
  for (const sender of deps.getRegisteredProjects()) {
    const store = deps.makeMailboxStore(deps.repoRoot, sender.projectId)
    const notes = await store.drainUnread(Number.MAX_SAFE_INTEGER).catch(() => [])
    waiting += notes.length
  }
  return waiting
}

// Returns the gate verdict AND, when blocked, emits one trace record naming the cause and how many
// notes it is holding. Previously a blocked drain wrote only a tmpdir log line, so notes sat unread
// with no signal anywhere an operator or agent looks.
async function shouldSkipDrain(input: {
  readonly deps: IdleDrainHookDeps
  readonly freshConfig: CrossProjectMailboxConfig
  readonly sessionId: string
}): Promise<boolean> {
  // Config-only blocks are settled first, without resolving the primary, so a disabled or
  // permissionless mailbox performs zero session lookups and zero store access.
  const configVerdict = evaluateConfigDrainGate(input.freshConfig)
  const verdict = configVerdict.allowed
    ? evaluateDrainGate(input.freshConfig, await input.deps.resolveActivePrimaryAgent(input.sessionId))
    : configVerdict
  if (verdict.allowed) return false

  const waiting =
    verdict.reason === "primary-not-eligible"
      ? await countWaitingNotes(input.deps).catch(() => 0)
      : undefined
  log(`[mailbox-idle-drain] skipped: ${verdict.reason}`, {
    sessionId: input.sessionId,
    detail: verdict.detail,
    ...(waiting === undefined ? {} : { waiting }),
    ...(verdict.reason === "primary-not-eligible"
      ? { primary: verdict.activePrimary ?? null, eligible: input.freshConfig.intake_eligible_agents }
      : {}),
  })
  input.deps.emitTrace?.({
    phase: "drain-skipped",
    messageId: DRAIN_SKIP_TRACE_ID,
    correlationId: DRAIN_SKIP_TRACE_ID,
    detail: `${verdict.reason}: ${verdict.detail}`,
    ...(waiting === undefined ? {} : { waiting }),
    at: Date.now(),
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
      const reclaimed = await store.reclaimStale(sessionMessageIds)
      const candidates = await store.drainUnread(maxNotes)
      await releaseReclaimedDigests({ digestStore, candidates, reclaimed })
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
