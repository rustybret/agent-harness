import { type ToolDefinition, tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"

import { validatePluginConfig } from "../../../config/validate"
import type { CrossProjectMailboxConfig } from "../config"
import { MAILBOX_INTENTS, MAILBOX_MODES, MAX_BODY_BYTES, type MailboxMessage } from "../envelope/schema"
import { readPresenceStatus, type PresenceStatus } from "../presence"
import type { ProjectEntry } from "../registry/types"
import type { MailboxTraceSink } from "../trace"
import { defaultWriteNote, maybeLaunchOfflineTarget } from "./offline-launch"
import { emitSendBlockedNoEnvelope, emitSendEnvelopeTrace, type SendTraceContext } from "./send-trace"
import { readDeliveryStatus, readOutboundBudget } from "../visibility"
import type {
  DeliveryStatusRegistryPort,
  DeliveryStatusReport,
  ReadDeliveryStatusOptions,
} from "../visibility"
import { buildSendEnvelope, type SendInput } from "./envelope-builder"
import { appendOutboxLog } from "./outbox-log"
import { type PreflightReason, runSendPreflight } from "./send-preflight"
import { triggerInterruptMailboxDrainNow } from "../lanes/interrupt-sender-trigger"
import type { InterruptDrainNowResult } from "../lanes/interrupt-sender-trigger"

export const IntentEnumSchema = z.enum(MAILBOX_INTENTS)

export function createProjectMessageInputSchema(maxBodyBytes: number) {
  return z
    .object({
      mode: z.enum(["send", "list", "status"]).default("send"),
      targetProjectId: z.string(),
      intent: IntentEnumSchema,
      category: z.string().optional(),
      body: z.string().max(maxBodyBytes),
      priority: z.number().default(0),
      threadId: z.string().nullable().optional(),
      supersedes: z.string().nullable().optional(),
      inReplyToMessageId: z.string().nullable().optional(),
      requested_mode: z.enum(MAILBOX_MODES).optional(),
    })
    .strict()
}

export const ProjectMessageInputSchema = createProjectMessageInputSchema(MAX_BODY_BYTES)

export interface ProjectMessageRegistry {
  listProjects(): Promise<ProjectEntry[]>
}

// Sends are no longer mode-gated: project_message is the single send path for both internal
// (portless TUI) and external sessions, superseding the deprecated project_note. The file drop
// itself never depended on sender liveness; only the optional presence probe and offline launch
// do, and those stay gated by launch_policy (default "disabled") rather than by session mode.

export interface ProjectMessageToolDeps {
  config: CrossProjectMailboxConfig
  thisProjectId: string
  thisRepoRoot: string
  thisProjectDisplayName: string
  registry: ProjectMessageRegistry
  writeNote?: (targetRepoRoot: string, fromProjectId: string, envelope: MailboxMessage, body: string) => Promise<void>
  appendOutbox?: typeof appendOutboxLog
  readPresence?: (projectId: string) => Promise<PresenceStatus>
  launchTarget?: (repoRoot: string, projectId: string, policy: CrossProjectMailboxConfig["launch_policy"]) => Promise<boolean>
  launchPermissionAsk?: (target: string) => Promise<boolean>
  liveConfigResolver?: { resolve: () => Promise<CrossProjectMailboxConfig> }
  triggerInterruptDrainNow?: (targetRepoRoot: string) => Promise<InterruptDrainNowResult>
  traceSink?: MailboxTraceSink
  /** Resolves a target's repo root so mode=status can read that target's acknowledgement dirs. */
  deliveryStatusRegistry?: DeliveryStatusRegistryPort
}

export type SendResult =
  | { ok: true; envelope: MailboxMessage; messageId: string; correlationId: string; interruptDrainNow?: InterruptDrainNowResult }
  | { error: "target-not-found" | "reply-parent-not-found" }
  | { blocked: true; reason: PreflightReason }

function traceCtx(deps: ProjectMessageToolDeps): SendTraceContext {
  return deps.traceSink === undefined
    ? { repoRoot: deps.thisRepoRoot, fromProjectId: deps.thisProjectId }
    : { repoRoot: deps.thisRepoRoot, fromProjectId: deps.thisProjectId, sink: deps.traceSink }
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
    emitSendBlockedNoEnvelope(traceCtx(deps), input.targetProjectId, "target-not-found")
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
    emitSendEnvelopeTrace({
      ctx: traceCtx(deps),
      phase: "blocked",
      envelope: built.envelope,
      toProjectId: targetEntry.projectId,
      detail: preflight.reason,
    })
    return { blocked: true, reason: preflight.reason }
  }

  await maybeLaunchOfflineTarget(targetEntry, deps)

  try {
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
  } catch (error) {
    emitSendEnvelopeTrace({
      ctx: traceCtx(deps),
      phase: "write-failed",
      envelope: built.envelope,
      toProjectId: targetEntry.projectId,
      detail: error instanceof Error ? error.message : String(error),
    })
    throw error
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
    requestedMode: built.envelope.requested_mode,
  })

  emitSendEnvelopeTrace({
    ctx: traceCtx(deps),
    phase: "sent",
    envelope: built.envelope,
    toProjectId: targetEntry.projectId,
  })

  const interruptDrainNow = built.envelope.requested_mode === "interrupt"
    ? await (deps.triggerInterruptDrainNow ?? triggerInterruptMailboxDrainNow)(targetEntry.repoRoot)
    : undefined

  return {
    ok: true,
    envelope: built.envelope,
    messageId: built.envelope.messageId,
    correlationId: built.envelope.correlationId,
    ...(interruptDrainNow === undefined ? {} : { interruptDrainNow }),
  }
}

export async function runProjectMessageList(deps: ProjectMessageToolDeps): Promise<{
  mode: "list"
  advisory: string
  rows: Awaited<ReturnType<typeof readOutboundBudget>>
}> {
  const readPresence = deps.readPresence ?? ((projectId: string) => readPresenceStatus(projectId))
  const rows = await readOutboundBudget(deps.config, deps.registry, { readPresence })
  return {
    mode: "list",
    advisory: "ADVISORY - target-side inbound validation remains authoritative.",
    rows,
  }
}

/**
 * Answers "did my notes land?" for the sender. A hard reject quarantines the note on the receiver
 * side and writes nothing back, so without this a dropped note is indistinguishable from one still
 * waiting for the target to idle.
 */
export async function runProjectMessageStatus(
  deps: ProjectMessageToolDeps,
  options: ReadDeliveryStatusOptions = {},
): Promise<DeliveryStatusReport & { mode: "status" }> {
  const registry = deps.deliveryStatusRegistry ?? (await registrySnapshot(deps))
  return { mode: "status", ...readDeliveryStatus(deps.thisRepoRoot, registry, options) }
}

// The project registry is async while the status read is a synchronous filesystem walk, so the
// project list is snapshotted once up front rather than awaited per outbox entry.
async function registrySnapshot(deps: ProjectMessageToolDeps): Promise<DeliveryStatusRegistryPort> {
  const projects = await deps.registry.listProjects().catch(() => [])
  const rootById = new Map(projects.map((entry) => [entry.projectId, entry.repoRoot]))
  return { getRepoRootForProjectId: (id) => rootById.get(id) }
}

async function resolveFreshSendConfig(deps: ProjectMessageToolDeps): Promise<CrossProjectMailboxConfig> {
  if (deps.liveConfigResolver) {
    return deps.liveConfigResolver.resolve()
  }
  const read = validatePluginConfig(deps.thisRepoRoot)
  if (read.valid && read.config.cross_project_mailbox) {
    return read.config.cross_project_mailbox
  }
  return deps.config
}

export function createProjectMessageTool(deps: ProjectMessageToolDeps): ToolDefinition {
  const inputSchema = createProjectMessageInputSchema(MAX_BODY_BYTES)
  return tool({
    description:
      "Send a note to another registered project's agent session. Works from both internal (TUI) and external (served) sessions; supersedes the deprecated project_note tool.",
    args: {
      mode: tool.schema
        .enum(["send", "list", "status"])
        .optional()
        .default("send")
        .describe(
          "send delivers the note; list returns the ADVISORY outbound-budget table without sending; " +
            "status reports whether recent sends were processed, rejected (with the receiver's reason), or are still undelivered",
        ),
      staleAfterHours: tool.schema
        .number()
        .optional()
        .describe("mode=status only: hours without acknowledgement before a send counts as stale (default 4)"),
      targetProjectId: tool.schema.string().optional().describe("Registered projectId or display name of the destination project (required for mode=send)"),
      intent: tool.schema.enum(MAILBOX_INTENTS).optional().describe("Intent tier of this note (required for mode=send)"),
      category: tool.schema.string().optional().describe("Optional task category; when set it gates the note in place of intent"),
      body: tool.schema.string().optional().describe("Note body (required for mode=send)"),
      priority: tool.schema.number().optional().default(0).describe("Optional priority; higher drains first"),
      threadId: tool.schema.string().optional().describe("Optional correlation UUID for a fresh thread (ignored on replies)"),
      supersedes: tool.schema.string().optional().describe("Optional messageId this note supersedes"),
      inReplyToMessageId: tool.schema.string().optional().describe("Optional parent messageId when replying to a received note"),
      requested_mode: tool.schema.enum(MAILBOX_MODES).optional().describe("Optional fulfillment mode hint for the receiver (advisory; receiver may downgrade)"),
    },
    execute: async (rawArgs, toolContext) => {
      const freshConfig = await resolveFreshSendConfig(deps)
      if (freshConfig.enabled === false) {
        return JSON.stringify({ blocked: true, reason: "mailbox disabled" })
      }

      if (rawArgs.mode === "list") {
        const listResult = await runProjectMessageList({ ...deps, config: freshConfig })
        return JSON.stringify(listResult)
      }

      if (rawArgs.mode === "status") {
        const staleAfterHours = typeof rawArgs.staleAfterHours === "number" ? rawArgs.staleAfterHours : undefined
        return JSON.stringify(
          await runProjectMessageStatus(
            { ...deps, config: freshConfig },
            staleAfterHours === undefined ? {} : { staleAfterHours },
          ),
        )
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
