import { log } from "../../../shared/logger"
import type { CrossProjectMailboxConfig } from "../config"
import type { PendingEntry, QuarantineReason, UnreadMessage } from "../mailbox/types"
import type { validateInbound } from "../validation/validate-inbound"

export interface MailboxStorePort {
  /** Resolves the ids returned to the inbox for a retry; see `MailboxStore.reclaimStale`. */
  reclaimStale(sessionMessageIds: Set<string>): Promise<string[]>
  drainUnread(maxNotes: number): Promise<UnreadMessage[]>
  reserve(messageId: string): Promise<string | undefined>
  ack(messageId: string): Promise<void>
  unreserve(messageId: string): Promise<void>
  quarantine(messageId: string, reason: QuarantineReason, detail?: string): Promise<void>
  markDispatched(entry: Omit<PendingEntry, "state">): Promise<void>
}

export interface DigestStorePort {
  checkAndRecord(note: DigestNote): Promise<{ isDuplicate: boolean }>
  rollback(note: DigestNote): Promise<void>
}

export interface RateLimiterPort {
  checkRateLimit(fromProjectId: string, toProjectId: string): Promise<{ limited: boolean }>
}

export interface PipelineDeps {
  validateInbound: typeof validateInbound
}

export interface DigestNote {
  fromProjectId: string
  toProjectId: string
  correlationId: string
  body: string
}

export type DeliveryPipelineResult =
  | { status: "reserved"; reservedPath: string; digestNote: DigestNote }
  | { status: "already-reserved" }
  | { status: "rejected"; reason: QuarantineReason | "rate-limited" }

export function digestNoteFor(note: UnreadMessage): DigestNote {
  return {
    fromProjectId: note.envelope.fromProjectId,
    toProjectId: note.envelope.toProjectId,
    correlationId: note.envelope.correlationId,
    body: note.body,
  }
}

export async function rollbackReservedDelivery(args: {
  store: Pick<MailboxStorePort, "unreserve">
  digestStore: Pick<DigestStorePort, "rollback">
  note: UnreadMessage
  logPrefix: string
}): Promise<void> {
  await args.store.unreserve(args.note.messageId).catch((error) => {
    log(`${args.logPrefix} failed to unreserve note`, {
      error: error instanceof Error ? error.message : String(error),
      messageId: args.note.messageId,
    })
  })
  await args.digestStore.rollback(digestNoteFor(args.note)).catch((error) => {
    log(`${args.logPrefix} failed to rollback digest`, { error, messageId: args.note.messageId })
  })
}

export async function reserveValidatedDelivery(args: {
  deps: PipelineDeps
  config: CrossProjectMailboxConfig
  store: MailboxStorePort
  digestStore: DigestStorePort
  rateLimiter: RateLimiterPort
  note: UnreadMessage
}): Promise<DeliveryPipelineResult> {
  const { deps, config, store, digestStore, rateLimiter, note } = args
  const envelope = note.envelope
  const reservedPath = await store.reserve(note.messageId)
  if (reservedPath === undefined) return { status: "already-reserved" }

  const validation = deps.validateInbound(envelope, config)
  if (!validation.valid) {
    const reason = validation.reason ?? "malformed"
    await store.quarantine(note.messageId, reason, validation.detail ?? "")
    return { status: "rejected", reason }
  }

  const rateLimit = await rateLimiter.checkRateLimit(envelope.fromProjectId, envelope.toProjectId)
  if (rateLimit.limited) {
    await store.unreserve(note.messageId).catch((error) => {
      log("[mailbox-delivery-pipeline] failed to unreserve note on rate limit", { error, messageId: note.messageId })
    })
    return { status: "rejected", reason: "rate-limited" }
  }

  const digestNote = digestNoteFor(note)
  const duplicate = await digestStore.checkAndRecord(digestNote)
  if (duplicate.isDuplicate) {
    const dupResult = deps.validateInbound(envelope, config, { duplicateLoop: true })
    const reason = dupResult.reason ?? "duplicate-loop"
    await store.quarantine(note.messageId, reason, dupResult.detail ?? "")
    return { status: "rejected", reason }
  }

  return { status: "reserved", reservedPath, digestNote }
}
