import type { MailboxMessage } from "../envelope/schema"
import { INTENT_GUIDANCE, NO_AUTO_REPLY_FOOTER, supersessionNotice } from "./constants"

export interface TriageConfig {
  projectDisplayName: string
}

export type TriageNote = MailboxMessage & {
  body: string
  /** Set when the superseded message was already delivered, so the correction needs calling out. */
  supersedesDelivered?: boolean
}

export function buildTriagePrompt(note: TriageNote, config: TriageConfig): string {
  const header = `Cross-project note from ${note.fromProject} (received by ${config.projectDisplayName}) — intent=${note.intent}, priority=${note.priority}`
  const guidance = INTENT_GUIDANCE[note.intent]
  const correction =
    note.supersedesDelivered === true && note.supersedes !== null
      ? [supersessionNotice(note.supersedes), ""]
      : []

  return [
    header,
    `[mailbox-message-id: ${note.messageId}]`,
    "",
    ...correction,
    "--- inbound note ---",
    note.body.trimEnd(),
    "--- end note ---",
    "",
    `How to triage (intent=${note.intent}):`,
    guidance,
    "",
    NO_AUTO_REPLY_FOOTER,
  ].join("\n")
}
