import type { CrossProjectMailboxConfig } from "../config"
import type { MailboxMessage } from "../envelope/schema"
import { requiredTier, withinBudget } from "../permission-tiers"
import type { CanonicalIntent } from "../permission-tiers"
import type { ValidateOptions, ValidationResult } from "./types"

const LOWEST_CEILING: CanonicalIntent = "question"

const REQUIRED_FIELDS = [
  "messageId",
  "fromProjectId",
  "intent",
  "hopCount",
  "hopPath",
  "correlationId",
  "timestamp",
] as const

function findMissingField(note: MailboxMessage): string | undefined {
  for (const field of REQUIRED_FIELDS) {
    const value = note[field]
    if (value === undefined || value === null) {
      return field
    }
  }
  return undefined
}

interface SenderDecision {
  allowed: boolean
  ceiling: CanonicalIntent
}

function resolveSenderDecision(note: MailboxMessage, config: CrossProjectMailboxConfig): SenderDecision {
  const sender = config.senders[note.fromProjectId]
  if (sender !== undefined) {
    return { allowed: sender.access === "allow", ceiling: sender.intent_budget }
  }
  const allowed = config.default_sender_access === "allow-all"
  return { allowed, ceiling: LOWEST_CEILING }
}

export function validateInbound(
  note: MailboxMessage,
  config: CrossProjectMailboxConfig,
  opts: ValidateOptions = {},
): ValidationResult {
  const missingField = findMissingField(note)
  if (missingField !== undefined) {
    return { valid: false, reason: "malformed", detail: `missing required field: ${missingField}` }
  }

  if (note.hopCount >= config.bounds.max_hops) {
    return {
      valid: false,
      reason: "hop-exceeded",
      detail: `hopCount ${note.hopCount} >= max_hops ${config.bounds.max_hops}`,
    }
  }

  if (opts.duplicateLoop === true) {
    return { valid: false, reason: "duplicate-loop", detail: "note flagged as duplicate loop" }
  }

  const decision = resolveSenderDecision(note, config)
  if (!decision.allowed) {
    return { valid: false, reason: "unauthorized", detail: `sender ${note.fromProjectId} is not authorized` }
  }

  if (!withinBudget(requiredTier(note.category ?? note.intent), decision.ceiling)) {
    return {
      valid: false,
      reason: "over-budget",
      detail: `intent ${note.category ?? note.intent} exceeds ceiling ${decision.ceiling}`,
    }
  }

  return { valid: true }
}
