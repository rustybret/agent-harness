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
  /**
   * True when this note supersedes a message that was ALREADY consumed, rather than one still
   * sitting unread beside it. Same-batch supersession is invisible to the receiver by design - the
   * superseded note is simply never delivered. Once the original has been acted on, silence is
   * wrong: the receiver needs to know the work it started is being corrected.
   */
  supersedesDelivered?: boolean
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
  | "max-retries-exceeded"
