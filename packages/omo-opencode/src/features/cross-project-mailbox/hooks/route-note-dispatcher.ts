import { log } from "../../../shared/logger"
import { dispatchRemoteContract as defaultDispatchRemoteContract, selectWorkerPrVariant } from "../contracts"
import type { DispatchRemoteContractDeps, DispatchRemoteContractResult, RemoteContractConfig } from "../contracts"
import type { CrossProjectMailboxConfig, SenderConfig } from "../config"
import type { MailboxMode } from "../envelope/schema"
import { createAnswerLocalLane } from "../lanes/answer-local"
import type { AnswerLocalLane, AnswerLocalLaneDeps } from "../lanes/answer-local"
import { createInterruptLane } from "../lanes/interrupt"
import type { InterruptLaneDeps } from "../lanes/interrupt"
import { runSubagentLane } from "../lanes/subagent"
import type { SubagentLaneDeps } from "../lanes/subagent"
import { runTodoInjectLane } from "../lanes/todo-inject-lane"
import { createWorkerPrLane } from "../lanes/worker-pr"
import type { WorkerPrLaneDeps } from "../lanes/worker-pr"
import type { WorkerPrWatchdogDeps } from "../lanes/worker-pr-watchdog"
import type { UnreadMessage } from "../mailbox/types"
import type { MailboxStorePort } from "../manual-drain/delivery-pipeline"
import type { CanonicalIntent } from "../permission-tiers"
import { decideRoute } from "../router"
import type { RouteContext, RouteDecision } from "../router"
import type { TodoInjector } from "../todo-inject"
import { traceIdentity, type MailboxTraceEmit } from "../trace"

const DEFAULT_SENDER_CEILING: CanonicalIntent = "question"

export type ClassifyNoteDeps = {
  readonly senderConfig: SenderConfig
  readonly routeContext: RouteContext
}

export type ClassifyResult = RouteDecision

export type AnswerLocalLaneFactory = (context: {
  readonly sessionId: string
  readonly store: Pick<MailboxStorePort, "ack" | "unreserve">
}) => AnswerLocalLane

export type CloudhomeContractDeps = {
  readonly config: RemoteContractConfig
  readonly deps: DispatchRemoteContractDeps
  readonly dispatchRemoteContract?: (
    note: Parameters<typeof defaultDispatchRemoteContract>[0],
    kind: Parameters<typeof defaultDispatchRemoteContract>[1],
    config: RemoteContractConfig,
    deps: DispatchRemoteContractDeps,
  ) => Promise<DispatchRemoteContractResult>
}

export type RoutedLaneDeps = {
  readonly answerLocalLane?: AnswerLocalLaneFactory
  readonly answerLocalLaneDeps?: Omit<AnswerLocalLaneDeps, "parentSessionId" | "store">
  readonly classifyNote?: (note: UnreadMessage, deps: ClassifyNoteDeps) => Promise<ClassifyResult>
  readonly cloudhomeContractDeps?: CloudhomeContractDeps
  readonly interruptLaneDeps?: Omit<InterruptLaneDeps, "sessionID" | "store">
  readonly subagentLaneDeps?: Omit<SubagentLaneDeps, "ack" | "parentMessageId" | "parentSessionId" | "senderCeiling"> & {
    readonly senderCeiling?: CanonicalIntent
  }
  readonly todoInjector?: TodoInjector
  readonly workerPrLaneDeps?: WorkerPrLaneDeps
  readonly workerPrWatchdogDeps?: WorkerPrWatchdogDeps
  readonly emitTrace?: MailboxTraceEmit
}

// Base trace fields shared by lane-start/lane-end: joins the trace line to the pending record via
// messageId and reuses routeMetadata so trace and .pending.json cannot disagree on the lane verdict.
function laneTraceFields(note: UnreadMessage, decision: RouteDecision): {
  readonly messageId: string
  readonly correlationId: string
  readonly fromProjectId: string
} & ReturnType<typeof routeMetadata> {
  return {
    ...traceIdentity(note),
    ...routeMetadata(note, decision),
  }
}

export type RouteExecutionResult =
  | { readonly status: "handled" }
  | { readonly status: "fallback-triage"; readonly reason: string }
  | { readonly status: "fallback-next-drain"; readonly reason: string }

export function resolveSenderConfig(note: UnreadMessage, config: CrossProjectMailboxConfig): SenderConfig {
  const sender = config.senders[note.envelope.fromProjectId]
  if (sender !== undefined) return sender
  return { access: config.default_sender_access === "allow-all" ? "allow" : "deny", intent_budget: DEFAULT_SENDER_CEILING }
}

export async function resolveRouteDecision(input: {
  readonly note: UnreadMessage
  readonly config: CrossProjectMailboxConfig
  readonly routeContext: RouteContext
  readonly forceLegacyTriage?: boolean
  readonly classifyNote?: RoutedLaneDeps["classifyNote"]
}): Promise<RouteDecision> {
  if (input.forceLegacyTriage === true) return { lane: "triage" }
  const senderConfig = resolveSenderConfig(input.note, input.config)
  const decision = decideRoute(input.note.envelope, senderConfig, input.routeContext)
  if (decision.lane !== "classify") return upgradeWorkerVariant(input.note, senderConfig, decision)
  if (input.classifyNote === undefined) return decision
  const classified = await input.classifyNote(input.note, { senderConfig, routeContext: input.routeContext })
  return classified.lane === "classify" ? { lane: "triage", downgradeReason: "classifier-returned-classify" } : classified
}

export async function executeRoutedLane(input: {
  readonly deps: RoutedLaneDeps
  readonly decision: RouteDecision
  readonly note: UnreadMessage
  readonly sessionId: string
  readonly store: MailboxStorePort
}): Promise<RouteExecutionResult> {
  const emit = input.deps.emitTrace
  emit?.({ phase: "lane-start", ...laneTraceFields(input.note, input.decision), at: Date.now() })
  const result = await runRoutedLane(input)
  emit?.({
    phase: "lane-end",
    ...laneTraceFields(input.note, input.decision),
    detail: result.status === "handled" ? result.status : `${result.status}:${result.reason}`,
    at: Date.now(),
  })
  return result
}

async function runRoutedLane(input: {
  readonly deps: RoutedLaneDeps
  readonly decision: RouteDecision
  readonly note: UnreadMessage
  readonly sessionId: string
  readonly store: MailboxStorePort
}): Promise<RouteExecutionResult> {
  const { decision, deps, note, sessionId, store } = input
  switch (decision.lane) {
    case "triage":
    case "classify":
      return { status: "fallback-triage", reason: decision.lane === "classify" ? "classifier-unavailable" : "legacy-triage" }
    case "answer-local":
      return fulfillAnswerLocal({ deps, note, sessionId, store })
    case "answer-remote":
      return dispatchRemote(note, "remote-answer", deps.cloudhomeContractDeps)
    case "todo-append":
    case "todo-next": {
      if (deps.todoInjector === undefined) return missingDeps(decision.lane)
      await runTodoInjectLane(withRequestedMode(note, decision.lane), sessionId, deps.todoInjector, {
        ack: (messageId) => store.ack(messageId),
      })
      return { status: "handled" }
    }
    case "subagent":
      return dispatchSubagent({ deps, note, sessionId, store })
    case "worker-pr-local": {
      if (deps.workerPrLaneDeps === undefined) return missingDeps(decision.lane)
      await createWorkerPrLane(deps.workerPrLaneDeps).fulfill(note)
      await store.ack(note.messageId)
      return { status: "handled" }
    }
    case "worker-pr-cloudhome":
      return dispatchRemote(note, "remote-worker-pr", deps.cloudhomeContractDeps)
    case "interrupt":
      return dispatchInterrupt({ deps, note, sessionId, store })
  }
}

export function routeMetadata(note: UnreadMessage, decision: RouteDecision): {
  readonly requestedMode?: MailboxMode
  readonly effectiveMode?: MailboxMode
  readonly downgradeReason?: string
  readonly lane: RouteDecision["lane"]
} {
  return {
    ...(note.envelope.requested_mode === undefined ? {} : { requestedMode: note.envelope.requested_mode }),
    ...(decision.effectiveMode === undefined ? {} : { effectiveMode: decision.effectiveMode }),
    ...(decision.downgradeReason === undefined ? {} : { downgradeReason: decision.downgradeReason }),
    lane: decision.lane,
  }
}

function upgradeWorkerVariant(note: UnreadMessage, senderConfig: SenderConfig, decision: RouteDecision): RouteDecision {
  if (decision.lane !== "worker-pr-local") return decision
  const variant = selectWorkerPrVariant(note.envelope, senderConfig)
  return variant === "worker-pr-cloudhome" ? { ...decision, lane: "worker-pr-cloudhome" } : decision
}

function missingDeps(lane: RouteDecision["lane"]): RouteExecutionResult {
  log("[mailbox-router] lane deps missing; falling back to triage", { lane })
  return { status: "fallback-triage", reason: "lane-deps-missing" }
}

async function fulfillAnswerLocal(input: {
  readonly deps: RoutedLaneDeps
  readonly note: UnreadMessage
  readonly sessionId: string
  readonly store: MailboxStorePort
}): Promise<RouteExecutionResult> {
  const lane = input.deps.answerLocalLane?.({ sessionId: input.sessionId, store: input.store }) ??
    (input.deps.answerLocalLaneDeps === undefined
      ? undefined
      : createAnswerLocalLane({ ...input.deps.answerLocalLaneDeps, parentSessionId: input.sessionId, store: input.store }))
  if (lane === undefined) return missingDeps("answer-local")
  const result = await lane.fulfill(input.note)
  return result.status === "rolled-back"
    ? { status: "fallback-next-drain", reason: result.downgradeReason }
    : { status: "handled" }
}

async function dispatchSubagent(input: {
  readonly deps: RoutedLaneDeps
  readonly note: UnreadMessage
  readonly sessionId: string
  readonly store: MailboxStorePort
}): Promise<RouteExecutionResult> {
  if (input.deps.subagentLaneDeps === undefined) return missingDeps("subagent")
  const result = await runSubagentLane(input.note, {
    ...input.deps.subagentLaneDeps,
    senderCeiling: input.deps.subagentLaneDeps.senderCeiling ?? "impl",
    parentSessionId: input.sessionId,
    parentMessageId: input.note.messageId,
    ack: (messageId) => input.store.ack(messageId),
  })
  if (result.status === "downgraded") return { status: "fallback-triage", reason: result.reason }
  result.completion.catch((error: unknown) => {
    log("[mailbox-router] subagent completion failed", {
      error: error instanceof Error ? error.message : String(error),
      messageId: input.note.messageId,
    })
  })
  return { status: "handled" }
}

async function dispatchInterrupt(input: {
  readonly deps: RoutedLaneDeps
  readonly note: UnreadMessage
  readonly sessionId: string
  readonly store: MailboxStorePort
}): Promise<RouteExecutionResult> {
  if (input.deps.interruptLaneDeps === undefined) return missingDeps("interrupt")
  const result = await createInterruptLane({
    ...input.deps.interruptLaneDeps,
    sessionID: input.sessionId,
    store: { ack: (messageId) => input.store.ack(messageId), unreserve: (messageId) => input.store.unreserve(messageId) },
  }).fulfill({ ...input.note, envelope: { ...input.note.envelope, requested_mode: "interrupt" } })
  return result.status === "accepted"
    ? { status: "handled" }
    : { status: "fallback-next-drain", reason: `interrupt-dispatch-${result.dispatchStatus}` }
}

function withRequestedMode(note: UnreadMessage, mode: Extract<MailboxMode, "todo-append" | "todo-next">) {
  return { ...note, envelope: { ...note.envelope, requested_mode: mode } }
}

async function dispatchRemote(
  note: UnreadMessage,
  kind: "remote-answer" | "remote-worker-pr",
  deps: CloudhomeContractDeps | undefined,
): Promise<RouteExecutionResult> {
  if (deps === undefined) return missingDeps(kind === "remote-answer" ? "answer-remote" : "worker-pr-cloudhome")
  const dispatchRemoteContract = deps.dispatchRemoteContract ?? defaultDispatchRemoteContract
  await dispatchRemoteContract(
    {
      messageId: note.messageId,
      correlationId: note.envelope.correlationId,
      fromProjectId: note.envelope.fromProjectId,
      body: note.body,
    },
    kind,
    deps.config,
    deps.deps,
  )
  return { status: "handled" }
}
