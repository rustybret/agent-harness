import type { MailboxMessage } from "../envelope/schema"
import type { RemoteMailboxRequest, RemoteMailboxRequestKind } from "./schema"
import type { RemotePendingRecord, RemotePendingStore } from "./remote-pending-store"

// D6 decided a DECLARED worker=cloudhome variant: agent-harness ships only the request/
// PR-intake contract side and delegates actual execution to cloudhome. A note is upgraded to
// the cloudhome variant only when the variant is EXPLICITLY declared — never inferred — either
// per-note (this category marker on the inbound note) or per-sender (senderCfg.worker_pr_variant).
// Absent any declaration the pure router's default of "worker-pr-local" is preserved.
export const CLOUDHOME_WORKER_VARIANT_CATEGORY = "worker-pr-cloudhome"

// Category applied to the OUTBOUND contract note so cloudhome can machine-consume it.
export const REMOTE_CONTRACT_CATEGORY = "machine:remote-mailbox-contract"

export type WorkerPrVariant = "worker-pr-local" | "worker-pr-cloudhome"

export interface WorkerPrVariantNote {
  readonly category?: string
}

export interface WorkerPrVariantSenderConfig {
  readonly worker_pr_variant?: "local" | "cloudhome"
}

// Pure selection helper called by task-12 AFTER decideRoute returns "worker-pr-local", to
// potentially upgrade the choice to the cloudhome variant. Note-level declaration wins over
// sender-level; both must EXPLICITLY opt in, so the safe default stays local.
export function selectWorkerPrVariant(
  note: WorkerPrVariantNote,
  senderCfg: WorkerPrVariantSenderConfig,
): WorkerPrVariant {
  if (note.category === CLOUDHOME_WORKER_VARIANT_CATEGORY) {
    return "worker-pr-cloudhome"
  }
  if (senderCfg.worker_pr_variant === "cloudhome") {
    return "worker-pr-cloudhome"
  }
  return "worker-pr-local"
}

// The minimal projection of an inbound note that the contract builder needs. Kept structural
// so callers can pass an UnreadMessage envelope+body or a synthesized shape without coupling.
export interface RoutedRemoteNote {
  readonly messageId: string
  readonly correlationId: string
  readonly fromProjectId: string
  readonly body: string
}

export interface RemoteContractConfig {
  readonly thisProjectId: string
  readonly repo: string
  readonly gitRef?: string
}

export function buildRemoteContractOutbound(
  note: RoutedRemoteNote,
  kind: RemoteMailboxRequestKind,
  config: RemoteContractConfig,
): RemoteMailboxRequest {
  const base: RemoteMailboxRequest = {
    version: 1,
    kind,
    noteRef: note.messageId,
    repo: config.repo,
    payload: note.body,
    replyRouting: {
      toProjectId: config.thisProjectId,
      correlationId: note.correlationId,
    },
  }
  if (config.gitRef === undefined) {
    return base
  }
  return { ...base, gitRef: config.gitRef }
}

export interface DispatchRemoteContractDeps {
  readonly store: RemotePendingStore
  readonly sendOutbound: (input: {
    request: RemoteMailboxRequest
    kind: RemoteMailboxRequestKind
    note: RoutedRemoteNote
  }) => Promise<{ outboundMessageId: string }>
  readonly now?: () => number
}

export type DispatchRemoteContractResult =
  | { status: "pending-remote"; deduped: false; outboundMessageId: string }
  | { status: "pending-remote"; deduped: true }

// Sends ONE outbound contract note to cloudhome and records a local pending entry so repeated
// drain passes report "pending-remote" instead of re-routing a duplicate outbound request for
// the same note. Returns deduped:true (and sends nothing) when the note is already pending.
export async function dispatchRemoteContract(
  note: RoutedRemoteNote,
  kind: RemoteMailboxRequestKind,
  config: RemoteContractConfig,
  deps: DispatchRemoteContractDeps,
): Promise<DispatchRemoteContractResult> {
  if (await deps.store.isPending(note.messageId)) {
    return { status: "pending-remote", deduped: true }
  }
  const request = buildRemoteContractOutbound(note, kind, config)
  const { outboundMessageId } = await deps.sendOutbound({ request, kind, note })
  const record: RemotePendingRecord = {
    originalMessageId: note.messageId,
    outboundMessageId,
    originalFromProjectId: note.fromProjectId,
    originalCorrelationId: note.correlationId,
    kind,
    requestPayload: request,
    createdAt: (deps.now ?? Date.now)(),
  }
  await deps.store.markPending(record)
  return { status: "pending-remote", deduped: false, outboundMessageId }
}

export interface ForwardAnswerInput {
  readonly toProjectId: string
  readonly inReplyToMessageId: string
  readonly correlationId: string
  readonly body: string
  readonly kind: RemoteMailboxRequestKind
}

export interface HandleRemoteCompletionReplyDeps {
  readonly store: RemotePendingStore
  readonly ackOriginal: (originalMessageId: string) => Promise<void>
  readonly forwardAnswer: (input: ForwardAnswerInput) => Promise<void>
}

export type HandleRemoteCompletionReplyResult =
  | { status: "completed"; originalMessageId: string }
  | { status: "ignored"; reason: "reply-missing-inreplyto" | "no-matching-pending" }
  | { status: "quarantined"; reason: "empty-remote-completion"; originalMessageId: string }

// Intake for a threaded completion reply from cloudhome. The reply's inReplyToMessageId
// references the OUTBOUND contract note's messageId; the pending record is resolved through
// that secondary index back to the ORIGINAL inbound note. On a valid match the local lifecycle
// completes exactly like a local lane: ack the original note, forward the answer to the
// original requester, then clear the pending record. Non-matching replies are ignored with a
// reason and the pending record is untouched. A matched-but-malformed reply (empty completion
// body) is quarantined and the pending record is kept for a retry.
export async function handleRemoteCompletionReply(
  reply: MailboxMessage & { body: string },
  deps: HandleRemoteCompletionReplyDeps,
): Promise<HandleRemoteCompletionReplyResult> {
  const outboundMessageId = reply.inReplyToMessageId
  if (outboundMessageId === null || outboundMessageId === "") {
    return { status: "ignored", reason: "reply-missing-inreplyto" }
  }

  const record = await deps.store.findByOutboundMessageId(outboundMessageId)
  if (record === undefined) {
    return { status: "ignored", reason: "no-matching-pending" }
  }

  if (reply.body.trim() === "") {
    return { status: "quarantined", reason: "empty-remote-completion", originalMessageId: record.originalMessageId }
  }

  await deps.ackOriginal(record.originalMessageId)
  await deps.forwardAnswer({
    toProjectId: record.originalFromProjectId,
    inReplyToMessageId: record.originalMessageId,
    correlationId: record.originalCorrelationId,
    body: reply.body,
    kind: record.kind,
  })
  await deps.store.clearPending(record.originalMessageId)
  return { status: "completed", originalMessageId: record.originalMessageId }
}
