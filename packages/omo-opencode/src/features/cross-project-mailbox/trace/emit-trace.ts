import { log as defaultLog } from "../../../shared/logger"
import type { UnreadMessage } from "../mailbox/types"
import { createFileTraceSink, TRACE_DETAIL_PREVIEW_MAX } from "./trace-log"
import type { EmitMailboxTraceDeps, MailboxTraceEvent } from "./types"

export const MAILBOX_TRACE_PREFIX = "[mailbox-trace]"

export type MailboxTraceEmit = (event: MailboxTraceEvent) => void

// One shared per-process monotonic counter. Wall-clock `at` collapses to a single millisecond
// across a full message lifecycle and the append is fire-and-forget, so on-disk order is
// nondeterministic; a synchronous `seq` assigned at EMIT time is the only stable sort key that
// recovers true emit order. Spans ALL messages, never resets.
let traceSeqCounter = 0

function nextTraceSeq(): number {
  traceSeqCounter += 1
  return traceSeqCounter
}

// Shared note→trace-identity mapping so the drain and dispatch hosts cannot drift on which
// envelope fields identify a message (messageId + correlationId + fromProjectId).
export function traceIdentity(note: UnreadMessage): {
  readonly messageId: string
  readonly correlationId: string
  readonly fromProjectId: string
} {
  return {
    messageId: note.messageId,
    correlationId: note.envelope.correlationId,
    fromProjectId: note.envelope.fromProjectId,
  }
}

// Pre-bind repoRoot/sink/logger once at a lifecycle host, then hand the thin emit callback to
// deeper functions (e.g. executeRoutedLane) that must stay ignorant of repoRoot and the sink port.
export function createMailboxTraceEmit(deps: EmitMailboxTraceDeps): MailboxTraceEmit {
  return (event: MailboxTraceEvent) => emitMailboxTrace(event, deps)
}

const ABSOLUTE_PATH_TOKEN = /(^|\s)(\/[^\s]+)/g

// Relativize any repoRoot-anchored path to a repo-relative form, then redact any remaining
// absolute filesystem path so no host path outside repoRoot leaks into the trace artifact.
function sanitizeDetail(detail: string, repoRoot: string): string {
  const rootPrefix = repoRoot.endsWith("/") ? repoRoot : `${repoRoot}/`
  const relativized = detail.split(rootPrefix).join("")
  const redacted = relativized.replace(ABSOLUTE_PATH_TOKEN, "$1[redacted-abs-path]")
  return redacted.slice(0, TRACE_DETAIL_PREVIEW_MAX)
}

function buildRecord(event: MailboxTraceEvent, repoRoot: string): Record<string, unknown> {
  return {
    phase: event.phase,
    messageId: event.messageId,
    correlationId: event.correlationId,
    at: event.at,
    ...(event.fromProjectId === undefined ? {} : { fromProjectId: event.fromProjectId }),
    ...(event.toProjectId === undefined ? {} : { toProjectId: event.toProjectId }),
    ...(event.requestedMode === undefined ? {} : { requestedMode: event.requestedMode }),
    ...(event.effectiveMode === undefined ? {} : { effectiveMode: event.effectiveMode }),
    ...(event.lane === undefined ? {} : { lane: event.lane }),
    ...(event.downgradeReason === undefined ? {} : { downgradeReason: event.downgradeReason }),
    ...(event.waiting === undefined ? {} : { waiting: event.waiting }),
    ...(event.detail === undefined ? {} : { detail: sanitizeDetail(event.detail, repoRoot) }),
  }
}

// Fire-and-forget observability emit. NEVER throws, NEVER returns a rejected promise. A sink or
// logger failure is swallowed (logged once at most) so a trace failure can never fail a send,
// fail a drain, or roll back a note. The disk append is not awaited by the caller.
export function emitMailboxTrace(event: MailboxTraceEvent, deps: EmitMailboxTraceDeps): void {
  const record = { ...buildRecord(event, deps.repoRoot), seq: nextTraceSeq() }
  const logger = deps.logger ?? defaultLog
  try {
    logger(`${MAILBOX_TRACE_PREFIX} ${event.phase}`, record)
  } catch {
    // logger failure must not surface to the lifecycle caller
  }
  const sink = deps.sink ?? createFileTraceSink(deps.repoRoot)
  try {
    void Promise.resolve(sink.append(record)).catch((error: unknown) => {
      swallowSinkError(error, logger)
    })
  } catch (error) {
    swallowSinkError(error, logger)
  }
}

function swallowSinkError(error: unknown, logger: EmitMailboxTraceDeps["logger"]): void {
  try {
    logger?.(`${MAILBOX_TRACE_PREFIX} sink-error`, {
      error: error instanceof Error ? error.message : String(error),
    })
  } catch {
    // last-resort: never propagate
  }
}
