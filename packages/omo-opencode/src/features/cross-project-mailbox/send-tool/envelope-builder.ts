import { randomUUID } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { parseEnvelope } from "../envelope/schema"
import type { MailboxMessage } from "../envelope/schema"
import { safeMessageIdFilename } from "../envelope/path-guard"
import type { IntentEnum } from "../validation/types"

export interface SendInput {
  targetProjectId: string
  intent: IntentEnum
  category?: string
  body: string
  priority?: number
  threadId?: string | null
  supersedes?: string | null
  inReplyToMessageId?: string | null
}

export interface BuiltEnvelope {
  envelope: MailboxMessage
  body: string
}

export interface ReplyParentNotFound {
  error: "reply-parent-not-found"
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
}

function hasReplyTarget(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value !== ""
}

export async function findProcessedParent(
  thisRepoRoot: string,
  parentId: string,
): Promise<MailboxMessage | undefined> {
  const fileName = safeMessageIdFilename(parentId)
  const baseDir = path.join(thisRepoRoot, "coordination_notes")
  let senders
  try {
    senders = await readdir(baseDir, { withFileTypes: true })
  } catch (error) {
    if (isMissingPath(error)) return undefined
    throw error
  }
  for (const sender of senders) {
    if (!sender.isDirectory()) continue
    const candidate = path.join(baseDir, sender.name, "processed", fileName)
    try {
      const content = await readFile(candidate, "utf8")
      return parseEnvelope(content).envelope
    } catch (error) {
      if (isMissingPath(error)) continue
      throw error
    }
  }
  return undefined
}

export async function buildSendEnvelope(
  input: SendInput,
  thisProjectId: string,
  thisRepoRoot: string,
  targetProjectId: string,
  targetProjectDisplayName: string,
  thisProjectDisplayName: string,
): Promise<BuiltEnvelope | ReplyParentNotFound> {
  let hopCount: number
  let hopPath: string[]
  let correlationId: string
  let inReplyToMessageId: string | null

  if (hasReplyTarget(input.inReplyToMessageId)) {
    const parent = await findProcessedParent(thisRepoRoot, input.inReplyToMessageId)
    if (parent === undefined) {
      return { error: "reply-parent-not-found" }
    }
    hopCount = parent.hopCount + 1
    hopPath = [...parent.hopPath, thisProjectId]
    correlationId = parent.correlationId
    inReplyToMessageId = input.inReplyToMessageId
  } else {
    hopCount = 0
    hopPath = [thisProjectId]
    correlationId = hasReplyTarget(input.threadId) ? input.threadId : randomUUID()
    inReplyToMessageId = null
  }

  const envelope: MailboxMessage = {
    version: 1,
    messageId: randomUUID(),
    timestamp: Date.now(),
    correlationId,
    inReplyToMessageId,
    fromProject: thisProjectDisplayName,
    toProject: targetProjectDisplayName,
    fromProjectId: thisProjectId,
    toProjectId: targetProjectId,
    intent: input.intent,
    category: input.category,
    priority: input.priority ?? 0,
    hopCount,
    hopPath,
    supersedes: input.supersedes ?? null,
  }

  return { envelope, body: input.body }
}
