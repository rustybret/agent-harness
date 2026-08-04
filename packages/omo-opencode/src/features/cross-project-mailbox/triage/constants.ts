import type { MailboxMessage } from "../envelope/schema"

export type IntentEnum = MailboxMessage["intent"]

export const INTENT_GUIDANCE: Record<IntentEnum, string> = {
  question: `Answer inline in your response. No task delegation is needed for a simple question.`,
  quick: `Delegate via task() to the appropriate category (for example category="quick"). This is a bounded, single-session task.`,
  impl: `Delegate via task() to the appropriate category (for example category="unspecified-high" or category="deep"). This is an implementation task.`,
  review: `Delegate to oracle (subagent_type="oracle") or a review-category task() for code or design review.`,
  "work-loop": `Consider delegating to atlas (subagent_type="atlas") for multi-step orchestration of this work-loop.`,
  plan: `Plan inline as Sisyphus, or surface to user for explicit approval before any planning work begins. Prometheus is not auto-spawnable and requires explicit user intent.`,
}

/**
 * Prepended when the sender is correcting a note the receiver has ALREADY acted on. Without it the
 * correction reads as an ordinary new note, and work started from the superseded instructions keeps
 * running.
 */
export function supersessionNotice(supersededMessageId: string): string {
  return [
    `CORRECTION: this note supersedes message ${supersededMessageId}, which was already delivered to you.`,
    `Treat the earlier note's instructions as withdrawn. If you started work based on it, stop and reconcile against this note before continuing.`,
  ].join("\n")
}

export const NO_AUTO_REPLY_FOOTER = `Do NOT auto-reply. Do not call project_message() automatically from this context. If a reply is warranted, make an explicit, reasoned project_message() call only after deciding that a reply is appropriate and what it should contain.`
