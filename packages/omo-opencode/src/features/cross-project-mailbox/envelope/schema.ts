import { Buffer } from "node:buffer"

import yaml from "js-yaml"
import { z } from "zod"

import { log } from "../../../shared/logger"
import { canonicalizeLegacyIntent } from "../permission-tiers"

export const MAX_BODY_BYTES = 32768

export const MAILBOX_INTENTS = ["question", "quick", "impl", "review", "work-loop", "plan"] as const

export const MAILBOX_MODES = [
  "answer",
  "todo-append",
  "todo-next",
  "subagent",
  "worker-pr",
  "interrupt",
] as const

export type MailboxMode = (typeof MAILBOX_MODES)[number]

export const MailboxMessageSchema = z.object({
  version: z.literal(1).default(1),
  messageId: z.string().uuid(),
  timestamp: z.number().int().positive(),
  correlationId: z.string().uuid(),
  inReplyToMessageId: z.string().uuid().nullable(),
  fromProject: z.string(),
  toProject: z.string(),
  fromProjectId: z.string(),
  toProjectId: z.string(),
  intent: z.enum(MAILBOX_INTENTS),
  category: z.string().optional(),
  priority: z.number().int().default(0),
  hopCount: z.number().int().min(0),
  hopPath: z.array(z.string()),
  supersedes: z.string().uuid().nullable(),
  requested_mode: z.enum(MAILBOX_MODES).optional(),
}).strict()

export type MailboxMessage = z.infer<typeof MailboxMessageSchema>

const LenientMailboxMessageSchema = MailboxMessageSchema.extend({
  requested_mode: z
    .enum(MAILBOX_MODES)
    .optional()
    .catch((ctx) => {
      log("mailbox envelope: dropping invalid requested_mode", {
        value: ctx.value,
        issues: ctx.issues,
      })
      return undefined
    }),
}).strip()

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/

export function serializeEnvelope(envelope: MailboxMessage, body: string): string {
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    throw new Error(`body exceeds ${MAX_BODY_BYTES} bytes`)
  }

  const validated = MailboxMessageSchema.parse(envelope)
  const frontmatter = yaml.dump(validated, { schema: yaml.JSON_SCHEMA, sortKeys: false })
  return `---\n${frontmatter}---\n${body}`
}

export function parseEnvelope(fileContent: string): { envelope: MailboxMessage; body: string } {
  const match = fileContent.match(FRONTMATTER_REGEX)
  if (!match) {
    throw new Error("mailbox message missing YAML frontmatter")
  }

  const rawFrontmatter = yaml.load(match[1] ?? "", { schema: yaml.JSON_SCHEMA })
  const parsed = LenientMailboxMessageSchema.parse(rawFrontmatter)
  const canonicalIntent = canonicalizeLegacyIntent(parsed.intent) ?? parsed.intent
  const envelope: MailboxMessage = { ...parsed, intent: canonicalIntent }
  return { envelope, body: match[2] ?? "" }
}

// Cheap classifier for "is this file a real mailbox note?" without materializing the body.
// Only the frontmatter block is inspected, so callers may pass a truncated head of the file.
// Kept in lockstep with parseEnvelope: anything listUnread() would skip must classify false here.
export function hasValidEnvelopeFrontmatter(fileHead: string): boolean {
  const match = fileHead.match(FRONTMATTER_REGEX)
  if (!match) return false

  let rawFrontmatter: unknown
  try {
    rawFrontmatter = yaml.load(match[1] ?? "", { schema: yaml.JSON_SCHEMA })
  } catch {
    return false
  }

  return LenientMailboxMessageSchema.safeParse(rawFrontmatter).success
}
