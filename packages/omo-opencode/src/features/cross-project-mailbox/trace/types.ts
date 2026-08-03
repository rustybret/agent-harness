import type { MailboxMode } from "../envelope/schema"
import type { RouteLane } from "../router"

export const MAILBOX_TRACE_PHASES = [
  "sent",
  "write-failed",
  "blocked",
  "received",
  "validated",
  "routed",
  "lane-start",
  "lane-end",
  "acked",
  "rolled-back",
] as const

export type MailboxTracePhase = (typeof MAILBOX_TRACE_PHASES)[number]

// Audit-record camelCase mirrors PendingEntry (mailbox/types.ts) so a reader can join
// .omo/mailbox-trace.jsonl against coordination_notes/.pending.json by messageId.
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
