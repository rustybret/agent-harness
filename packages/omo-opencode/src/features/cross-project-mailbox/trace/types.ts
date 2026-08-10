import type { MailboxMode } from "../envelope/schema"
import type { RouteLane } from "../router"

export const MAILBOX_TRACE_PHASES = [
  "sent",
  "write-failed",
  "blocked",
  "drain-skipped",
  "received",
  "validated",
  "routed",
  "lane-start",
  "lane-end",
  "acked",
  "rolled-back",
  "quarantined",
] as const

export type MailboxTracePhase = (typeof MAILBOX_TRACE_PHASES)[number]

// Audit-record camelCase mirrors PendingEntry (mailbox/types.ts) so a reader can join
// .omo/mailbox-trace.jsonl against coordination_notes/.pending.json by messageId.
// A drain-gate skip is not about one message, so `drain-skipped` records carry the sentinel
// messageId/correlationId below rather than a real envelope id. Everything else is per-message.
export const DRAIN_SKIP_TRACE_ID = "drain-gate"

export interface MailboxTraceEvent {
  readonly phase: MailboxTracePhase
  readonly messageId: string
  readonly correlationId: string
  readonly fromProjectId?: string
  readonly toProjectId?: string
  readonly requestedMode?: MailboxMode
  readonly effectiveMode?: MailboxMode
  readonly lane?: RouteLane
  readonly downgradeReason?: string
  readonly detail?: string
  // Present on `drain-skipped`: how many notes were sitting unread behind the gate.
  readonly waiting?: number
  readonly at: number
}

export interface MailboxTraceSink {
  append(record: Record<string, unknown>): void | Promise<void>
}

export type MailboxTraceLogger = (message: string, context: Record<string, unknown>) => void

export interface EmitMailboxTraceDeps {
  readonly repoRoot: string
  readonly sink?: MailboxTraceSink
  readonly logger?: MailboxTraceLogger
}
