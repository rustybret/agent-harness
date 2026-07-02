import type { MailboxMessage } from "../envelope/schema"
import { INTENT_GUIDANCE, NO_AUTO_REPLY_FOOTER } from "./constants"

export interface TriageConfig {
  projectDisplayName: string
}

export function buildTriagePrompt(note: MailboxMessage & { body: string }, config: TriageConfig): string {
  const header = `Cross-project note from ${note.fromProject} (received by ${config.projectDisplayName}) — intent=${note.intent}, priority=${note.priority}`
  const guidance = INTENT_GUIDANCE[note.intent]

  return [
    header,
    `[mailbox-message-id: ${note.messageId}]`,
    "",
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
