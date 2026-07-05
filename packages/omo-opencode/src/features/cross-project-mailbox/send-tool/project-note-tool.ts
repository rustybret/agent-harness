import { type ToolDefinition, tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"

import { validatePluginConfig } from "../../../config/validate"
import type { CrossProjectMailboxConfig } from "../config"
import { MAILBOX_INTENTS, MAX_BODY_BYTES, type MailboxMessage } from "../envelope/schema"
import { MailboxStore } from "../mailbox/mailbox-store"
import type { MailboxModeState, ModeDetector } from "../presence"
import { buildSendEnvelope, type SendInput } from "./envelope-builder"
import { appendOutboxLog } from "./outbox-log"
import { type ProjectMessageRegistry, type SendResult } from "./project-message-tool"
import { runSendPreflight } from "./send-preflight"

export const NOTE_EXTERNAL_GUIDANCE = "external session; use project_message"

export type ProjectNoteExecResult = SendResult | { blocked: true; reason: string }

export function createProjectNoteInputSchema(maxBodyBytes: number) {
  return z
    .object({
      targetProjectId: z.string(),
      intent: z.enum(MAILBOX_INTENTS),
      category: z.string().optional(),
      body: z.string().max(maxBodyBytes),
      priority: z.number().default(0),
      threadId: z.string().nullable().optional(),
      supersedes: z.string().nullable().optional(),
      inReplyToMessageId: z.string().nullable().optional(),
    })
    .strict()
}

export const ProjectNoteInputSchema = createProjectNoteInputSchema(MAX_BODY_BYTES)

export interface ProjectNoteToolDeps {
  config: CrossProjectMailboxConfig
  thisProjectId: string
  thisRepoRoot: string
  thisProjectDisplayName: string
  registry: ProjectMessageRegistry
  modeDetector: Pick<ModeDetector, "currentMode" | "detect">
  writeNote?: (targetRepoRoot: string, fromProjectId: string, envelope: MailboxMessage, body: string) => Promise<void>
  appendOutbox?: typeof appendOutboxLog
}

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

// Fire-and-forget doc-drop: resolve target, build envelope, run receiver-protecting preflight
// (allowlist + intent-budget + hop-check), write the note into the target's coordination_notes/,
// and append the outbox log. NO presence probe and NO launch: those are sender-side liveness
// concerns irrelevant to a pure file drop.
export async function runProjectNoteSend(
  input: SendInput,
  deps: ProjectNoteToolDeps,
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

// Resolve the current session mode; lazily detect when no detect has run yet for this session
// (tool executed before the first idle/heartbeat). currentMode() is a zero-I/O memoized read;
// only "unknown" triggers a real detect via the "tool-exec" trigger.
export async function resolveNoteMode(
  modeDetector: Pick<ModeDetector, "currentMode" | "detect">,
  sessionId: string,
): Promise<MailboxModeState> {
  const current = modeDetector.currentMode()
  if (current !== "unknown") return current
  return modeDetector.detect(sessionId, "tool-exec")
}

function resolveFreshSendConfig(deps: ProjectNoteToolDeps): CrossProjectMailboxConfig {
  const read = validatePluginConfig(deps.thisRepoRoot)
  if (read.valid && read.config.cross_project_mailbox) {
    return read.config.cross_project_mailbox
  }
  return deps.config
}

export function createProjectNoteTool(deps: ProjectNoteToolDeps): ToolDefinition {
  const inputSchema = createProjectNoteInputSchema(MAX_BODY_BYTES)
  return tool({
    description:
      "Drop a fire-and-forget note into another registered project's coordination_notes/ for its idle-drain filewatcher (internal sessions only; no presence probe, no launch)",
    args: {
      targetProjectId: tool.schema
        .string()
        .optional()
        .describe("Registered projectId or display name of the destination project"),
      intent: tool.schema.enum(MAILBOX_INTENTS).optional().describe("Intent tier of this note"),
      category: tool.schema.string().optional().describe("Optional task category; when set it gates the note in place of intent"),
      body: tool.schema.string().optional().describe("Note body"),
      priority: tool.schema.number().optional().default(0).describe("Optional priority; higher drains first"),
      threadId: tool.schema.string().optional().describe("Optional correlation UUID for a fresh thread (ignored on replies)"),
      supersedes: tool.schema.string().optional().describe("Optional messageId this note supersedes"),
      inReplyToMessageId: tool.schema.string().optional().describe("Optional parent messageId when replying to a received note"),
    },
    execute: async (rawArgs, toolContext) => {
      const freshConfig = resolveFreshSendConfig(deps)
      if (freshConfig.enabled === false) {
        return JSON.stringify({ blocked: true, reason: "mailbox disabled" })
      }

      // Mode gate BEFORE preflight: an external-mode call short-circuits with guidance without
      // touching preflight/allowlist. Lazy-detect closes the tool-executes-before-first-idle race.
      const sessionId = (toolContext as { sessionID?: string })?.sessionID ?? ""
      const mode = await resolveNoteMode(deps.modeDetector, sessionId)
      if (mode === "external") {
        return JSON.stringify({ blocked: true, reason: NOTE_EXTERNAL_GUIDANCE })
      }

      const effectiveBodyCap = Math.min(freshConfig.bounds.max_body_bytes, MAX_BODY_BYTES)
      const rawBody = typeof rawArgs.body === "string" ? rawArgs.body : ""
      if (Buffer.byteLength(rawBody, "utf8") > effectiveBodyCap) {
        return JSON.stringify({ blocked: true, reason: `body exceeds max_body_bytes (${effectiveBodyCap})` })
      }

      const input = inputSchema.parse(rawArgs)
      const result = await runProjectNoteSend(input, { ...deps, config: freshConfig })
      return JSON.stringify(result)
    },
  })
}
