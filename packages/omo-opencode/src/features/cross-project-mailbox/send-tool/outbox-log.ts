import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"

import type { IntentEnum } from "../validation/types"

const BODY_PREVIEW_MAX = 100

export interface OutboxEntry {
  sentAt: number
  toProjectId: string
  messageId: string
  intent: IntentEnum
  correlationId: string
  body: string
}

export function outboxLogPath(repoRoot: string): string {
  return path.join(repoRoot, ".omo", "mailbox-outbox.jsonl")
}

export async function appendOutboxLog(repoRoot: string, entry: OutboxEntry): Promise<void> {
  const logPath = outboxLogPath(repoRoot)
  await mkdir(path.dirname(logPath), { recursive: true })
  const record = {
    sentAt: entry.sentAt,
    toProjectId: entry.toProjectId,
    messageId: entry.messageId,
    intent: entry.intent,
    correlationId: entry.correlationId,
    body: entry.body.slice(0, BODY_PREVIEW_MAX),
  }
  await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8")
}
