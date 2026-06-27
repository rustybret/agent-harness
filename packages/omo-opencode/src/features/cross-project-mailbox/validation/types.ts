import type { MailboxMessage } from "../envelope/schema"
import type { QuarantineReason } from "../mailbox/types"

export type IntentEnum = MailboxMessage["intent"]

export type RejectionReason = QuarantineReason

export interface ValidationResult {
  valid: boolean
  reason?: RejectionReason
  detail?: string
}

export interface ValidateOptions {
  duplicateLoop?: boolean
}
