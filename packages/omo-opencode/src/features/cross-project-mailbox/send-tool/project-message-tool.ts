import { type ToolDefinition, tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"

import { validatePluginConfig } from '../../../config/validate';
import type { CrossProjectMailboxConfig } from "../config"
import { MAILBOX_INTENTS, MAX_BODY_BYTES, type MailboxMessage } from "../envelope/schema"
import { MailboxStore } from "../mailbox/mailbox-store"
import type { ProjectEntry } from "../registry/types"
import { buildSendEnvelope, type SendInput } from "./envelope-builder"
import { appendOutboxLog } from "./outbox-log"
import { type PreflightReason, runSendPreflight } from "./send-preflight"

export const IntentEnumSchema = z.enum(MAILBOX_INTENTS)

export function createProjectMessageInputSchema(maxBodyBytes: number) {
  return z
    .object({
      targetProjectId: z.string(),
      intent: IntentEnumSchema,
      category: z.string().optional(),
      body: z.string().max(maxBodyBytes),
      priority: z.number().default(0),
      threadId: z.string().nullable().optional(),
      supersedes: z.string().nullable().optional(),
      inReplyToMessageId: z.string().nullable().optional(),
    })
    .strict()
}

export const ProjectMessageInputSchema = createProjectMessageInputSchema(MAX_BODY_BYTES)

export interface ProjectMessageRegistry {
  listProjects(): Promise<ProjectEntry[]>
}

export interface ProjectMessageToolDeps {
  config: CrossProjectMailboxConfig
  thisProjectId: string
  thisRepoRoot: string
  thisProjectDisplayName: string
  registry: ProjectMessageRegistry
  writeNote?: (targetRepoRoot: string, fromProjectId: string, envelope: MailboxMessage, body: string) => Promise<void>
  appendOutbox?: typeof appendOutboxLog
}

export type SendResult =
  | { ok: true; envelope: MailboxMessage; messageId: string; correlationId: string }
  | { error: "target-not-found" | "reply-parent-not-found" }
  | { blocked: true; reason: PreflightReason }

async function defaultWriteNote(
  targetRepoRoot: string,
  fromProjectId: string,
  envelope: MailboxMessage,
  body: string,
  reservationTtlMs: number,
): Promise<void> {
  const store = new MailboxStore(targetRepoRoot, fromProjectId, { reservation_ttl_ms: reservationTtlMs })
  await store.writeNote(envelope, body)
}

export async function runProjectMessageSend(
  input: SendInput,
  deps: ProjectMessageToolDeps,
): Promise<SendResult> {
  const projects = await deps.registry.listProjects()
  const targetEntry =
    projects.find((entry) => entry.projectId === input.targetProjectId) ??
    projects.find((entry) => entry.displayName.toLowerCase() === input.targetProjectId.toLowerCase())
  if (targetEntry === undefined) {
    return { error: "target-not-found" }
  }

  const normalizedInput: SendInput = { ...input, targetProjectId: targetEntry.projectId }

  const built = await buildSendEnvelope(
    normalizedInput,
    deps.thisProjectId,
    deps.thisRepoRoot,
    targetEntry.projectId,
    targetEntry.displayName,
    deps.thisProjectDisplayName,
  )
  if ("error" in built) {
    return { error: built.error }
  }

  const preflight = await runSendPreflight(normalizedInput, built.envelope.hopCount, deps.config, targetEntry)
  if (preflight.blocked) {
    return { blocked: true, reason: preflight.reason }
  }

  if (deps.writeNote) {
    await deps.writeNote(targetEntry.repoRoot, deps.thisProjectId, built.envelope, built.body)
  } else {
    await defaultWriteNote(
      targetEntry.repoRoot,
      deps.thisProjectId,
      built.envelope,
      built.body,
      deps.config.bounds.reservation_ttl_ms,
    )
  }

  const append = deps.appendOutbox ?? appendOutboxLog
  await append(deps.thisRepoRoot, {
    sentAt: built.envelope.timestamp,
    toProjectId: targetEntry.projectId,
    toRepoRoot: targetEntry.repoRoot,
    messageId: built.envelope.messageId,
    intent: built.envelope.intent,
    correlationId: built.envelope.correlationId,
    body: built.body,
  })

  return {
    ok: true,
    envelope: built.envelope,
    messageId: built.envelope.messageId,
    correlationId: built.envelope.correlationId,
  }
}

function resolveFreshSendConfig(deps: ProjectMessageToolDeps): CrossProjectMailboxConfig {
  const read = validatePluginConfig(deps.thisRepoRoot)
  if (read.valid && read.config.cross_project_mailbox) {
    return read.config.cross_project_mailbox
  }
  return deps.config
}

export function createProjectMessageTool(deps: ProjectMessageToolDeps): ToolDefinition {
  const inputSchema = createProjectMessageInputSchema(MAX_BODY_BYTES)
  return tool({
    description: "Send a note to another registered project's agent session",
    args: {
      targetProjectId: tool.schema.string().describe("Registered projectId or display name of the destination project"),
      intent: tool.schema.enum(MAILBOX_INTENTS).describe("Intent tier of this note"),
      category: tool.schema.string().optional().describe("Optional task category; when set it gates the note in place of intent"),
      body: tool.schema.string().describe("Note body"),
      priority: tool.schema.number().optional().default(0).describe("Optional priority; higher drains first"),
      threadId: tool.schema.string().optional().describe("Optional correlation UUID for a fresh thread (ignored on replies)"),
      supersedes: tool.schema.string().optional().describe("Optional messageId this note supersedes"),
      inReplyToMessageId: tool.schema.string().optional().describe("Optional parent messageId when replying to a received note"),
    },
    execute: async (rawArgs) => {
      const freshConfig = resolveFreshSendConfig(deps)
      if (freshConfig.enabled === false) {
        return JSON.stringify({ blocked: true, reason: "mailbox disabled" })
      }

      const effectiveBodyCap = Math.min(freshConfig.bounds.max_body_bytes, MAX_BODY_BYTES)
      const rawBody = typeof rawArgs.body === "string" ? rawArgs.body : ""
      if (Buffer.byteLength(rawBody, "utf8") > effectiveBodyCap) {
        return JSON.stringify({ blocked: true, reason: `body exceeds max_body_bytes (${effectiveBodyCap})` })
      }

      const input = inputSchema.parse(rawArgs)
      const result = await runProjectMessageSend(input, { ...deps, config: freshConfig })
      return JSON.stringify(result)
    },
  })
}
