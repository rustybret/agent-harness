import type { MailboxMessage, MailboxMode } from "../envelope/schema"
import type { RouteLane } from "../router"

export type PendingState = "dispatch_sent" | "history_confirmed"

export interface PendingEntry {
  messageId: string
  sessionId: string
  reservedPath: string
  dispatchedAt: number
  state: PendingState
  requestedMode?: MailboxMode
  effectiveMode?: MailboxMode
  downgradeReason?: string
  lane?: RouteLane
}

export interface UnreadMessage {
  messageId: string
  filePath: string
  envelope: MailboxMessage
  body: string
}

export interface MailboxDir {
  inbox: string
  processed: string
  rejected: string
}

export type QuarantineReason =
  | "unauthorized"
  | "over-budget"
  | "hop-exceeded"
  | "malformed"
  | "duplicate-loop"
