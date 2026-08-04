import {
  isInternalPromptDispatchAccepted,
} from "../../../shared/prompt-async-gate"
import { log } from "../../../shared/logger"
import type {
  InternalPromptDispatchArgs,
  InternalPromptDispatchResult,
} from "../../../shared/prompt-async-gate"
import type { CrossProjectMailboxConfig } from "../config"
import type { MailboxMode } from "../envelope/schema"
import type { UnreadMessage } from "../mailbox/types"
import type { buildTriagePrompt } from "../triage/template"
import type { validateInbound } from "../validation/validate-inbound"
import type { RouteContext, RouteDecision } from "../router"
import {
  reserveValidatedDelivery,
  rollbackReservedDelivery,
  type DigestStorePort,
  type MailboxStorePort,
  type RateLimiterPort,
} from "../manual-drain/delivery-pipeline"
import {
  executeRoutedLane,
  resolveRouteDecision,
  routeMetadata,
  type ClassifyNoteDeps,
  type ClassifyResult,
  type RouteExecutionResult,
  type RoutedLaneDeps,
} from "./route-note-dispatcher"
import { traceIdentity, type MailboxTraceEmit } from "../trace"

export const IDLE_DRAIN_SOURCE = "cross-project-mailbox-idle-drain"

type AsyncDispatchArgs = Extract<InternalPromptDispatchArgs, { mode: "async" }>
export type DispatchClient = AsyncDispatchArgs["client"]

export interface IdleDrainProcessorDeps extends RoutedLaneDeps {
  directory: string
  projectDisplayName: string
  client: DispatchClient
  validateInbound: typeof validateInbound
  buildTriagePrompt: typeof buildTriagePrompt
  dispatchInternalPrompt: (
    args: InternalPromptDispatchArgs,
  ) => Promise<InternalPromptDispatchResult>
  classifyNote?: (note: UnreadMessage, deps: ClassifyNoteDeps) => Promise<ClassifyResult>
}

type DispatchMetadata = {
  readonly requestedMode?: MailboxMode
  readonly effectiveMode?: MailboxMode
  readonly downgradeReason?: string
  readonly lane?: RouteDecision["lane"]
}

function buildDispatchArgs(
  deps: IdleDrainProcessorDeps,
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

async function dispatchLegacyTriage(input: {
  readonly deps: IdleDrainProcessorDeps
  readonly sessionId: string
  readonly note: UnreadMessage
  readonly reservedPath: string
  readonly store: MailboxStorePort
  readonly digestStore: DigestStorePort
  readonly metadata?: DispatchMetadata
}): Promise<boolean> {
  const triageText = input.deps.buildTriagePrompt(
    {
      ...input.note.envelope,
      body: input.note.body,
      ...(input.note.supersedesDelivered === true ? { supersedesDelivered: true } : {}),
    },
    { projectDisplayName: input.deps.projectDisplayName },
  )
  const dispatchResult = await input.deps.dispatchInternalPrompt({
    ...buildDispatchArgs(input.deps, input.sessionId, triageText),
    queueBehavior: "defer",
  })
  if (!isInternalPromptDispatchAccepted(dispatchResult)) {
    await rollbackReservedDelivery({
      store: input.store,
      digestStore: input.digestStore,
      note: input.note,
      logPrefix: "[mailbox-idle-drain] dispatch rejection",
    })
    input.deps.emitTrace?.({
      phase: "rolled-back",
      ...traceIdentity(input.note),
      ...(input.metadata ?? {}),
      detail: "legacy-triage-dispatch-rejected",
      at: Date.now(),
    })
    return false
  }

  await input.store.markDispatched({
    messageId: input.note.messageId,
    sessionId: input.sessionId,
    reservedPath: input.reservedPath,
    dispatchedAt: Date.now(),
    ...input.metadata,
  })
  return true
}

async function handleLaneException(input: {
  readonly error: unknown
  readonly store: MailboxStorePort
  readonly digestStore: DigestStorePort
  readonly note: UnreadMessage
  readonly fallbackIds: Set<string>
  readonly lane: RouteDecision["lane"]
  readonly emitTrace?: MailboxTraceEmit
}): Promise<void> {
  log("[mailbox-idle-drain] routed lane threw; note will fall back to triage on next drain", {
    error: input.error instanceof Error ? input.error.message : String(input.error),
    lane: input.lane,
    messageId: input.note.messageId,
  })
  input.fallbackIds.add(input.note.messageId)
  await rollbackReservedDelivery({
    store: input.store,
    digestStore: input.digestStore,
    note: input.note,
    logPrefix: "[mailbox-idle-drain] routed lane exception",
  })
  input.emitTrace?.({
    phase: "rolled-back",
    ...traceIdentity(input.note),
    lane: input.lane,
    detail: "routed-lane-threw",
    at: Date.now(),
  })
}

async function finalizeHandledLane(input: {
  readonly store: MailboxStorePort
  readonly note: UnreadMessage
  readonly sessionId: string
  readonly reservedPath: string
  readonly decision: RouteDecision
  readonly emitTrace?: MailboxTraceEmit
}): Promise<void> {
  await input.store.markDispatched({
    messageId: input.note.messageId,
    sessionId: input.sessionId,
    reservedPath: input.reservedPath,
    dispatchedAt: Date.now(),
    ...routeMetadata(input.note, input.decision),
  })
  input.emitTrace?.({
    phase: "acked",
    ...traceIdentity(input.note),
    ...routeMetadata(input.note, input.decision),
    at: Date.now(),
  })
}

async function completeRouteExecution(input: {
  readonly result: RouteExecutionResult
  readonly deps: IdleDrainProcessorDeps
  readonly sessionId: string
  readonly note: UnreadMessage
  readonly reservedPath: string
  readonly store: MailboxStorePort
  readonly digestStore: DigestStorePort
  readonly decision: RouteDecision
  readonly fallbackIds: Set<string>
}): Promise<boolean> {
  switch (input.result.status) {
    case "handled":
      await finalizeHandledLane({ ...input, emitTrace: input.deps.emitTrace })
      return true
    case "fallback-triage":
      log("[mailbox-idle-drain] routed lane downgraded to triage", {
        messageId: input.note.messageId,
        lane: input.decision.lane,
        reason: input.result.reason,
      })
      return dispatchLegacyTriage({
        deps: input.deps,
        sessionId: input.sessionId,
        note: input.note,
        reservedPath: input.reservedPath,
        store: input.store,
        digestStore: input.digestStore,
        metadata: routeMetadata(input.note, input.decision),
      })
    case "fallback-next-drain":
      input.fallbackIds.add(input.note.messageId)
      await rollbackReservedDelivery({
        store: input.store,
        digestStore: input.digestStore,
        note: input.note,
        logPrefix: "[mailbox-idle-drain] lane deferred to next drain",
      })
      input.deps.emitTrace?.({
        phase: "rolled-back",
        ...traceIdentity(input.note),
        ...routeMetadata(input.note, input.decision),
        detail: `fallback-next-drain:${input.result.reason}`,
        at: Date.now(),
      })
      return false
  }
}

export async function processNote(input: {
  readonly deps: IdleDrainProcessorDeps
  readonly config: CrossProjectMailboxConfig
  readonly store: MailboxStorePort
  readonly digestStore: DigestStorePort
  readonly rateLimiter: RateLimiterPort
  readonly sessionId: string
  readonly note: UnreadMessage
  readonly routeContext: RouteContext
  readonly fallbackIds: Set<string>
}): Promise<boolean> {
  const reserved = await reserveValidatedDelivery(input)
  if (reserved.status !== "reserved") return false

  input.deps.emitTrace?.({ phase: "received", ...traceIdentity(input.note), at: Date.now() })
  input.deps.emitTrace?.({ phase: "validated", ...traceIdentity(input.note), at: Date.now() })

  const forceLegacyTriage = input.fallbackIds.delete(input.note.messageId)
  const decision = await resolveRouteDecision({
    note: input.note,
    config: input.config,
    routeContext: input.routeContext,
    forceLegacyTriage,
    classifyNote: input.deps.classifyNote,
  })
  input.deps.emitTrace?.({
    phase: "routed",
    ...traceIdentity(input.note),
    ...routeMetadata(input.note, decision),
    at: Date.now(),
  })
  try {
    const result = await executeRoutedLane({
      deps: input.deps,
      decision,
      note: input.note,
      sessionId: input.sessionId,
      store: input.store,
    })
    return completeRouteExecution({ ...input, result, reservedPath: reserved.reservedPath, decision })
  } catch (error) {
    await handleLaneException({
      error,
      store: input.store,
      digestStore: input.digestStore,
      note: input.note,
      fallbackIds: input.fallbackIds,
      lane: decision.lane,
      emitTrace: input.deps.emitTrace,
    })
    return false
  }
}
