import { type ToolDefinition, tool } from "@opencode-ai/plugin/tool"

import { validatePluginConfig as defaultValidatePluginConfig } from "../../../config/validate"
import type { CrossProjectMailboxConfig } from "../config"
import type { MailboxMessage } from "../envelope/schema"
import type { PendingEntry, UnreadMessage } from "../mailbox/types"
import type { ProjectEntry } from "../registry/types"
import type { validateInbound } from "../validation/validate-inbound"
import {
  reserveValidatedDelivery,
  rollbackReservedDelivery,
  type DigestStorePort,
  type MailboxStorePort,
  type RateLimiterPort,
} from "./delivery-pipeline"

const BODY_PREVIEW_MAX = 200

export interface ManualDrainMailboxStorePort extends MailboxStorePort {
  ack(messageId: string): Promise<void>
}

export interface ManualMailboxToolDeps {
  config: CrossProjectMailboxConfig
  repoRoot: string
  projectDisplayName: string
  getRegisteredProjects: () => ProjectEntry[] | Promise<ProjectEntry[]>
  makeMailboxStore: (targetRoot: string, fromProjectId: string) => ManualDrainMailboxStorePort
  makeDigestStore: (repoRoot: string) => DigestStorePort
  makeRateLimiter: (repoRoot: string) => RateLimiterPort
  validateInbound: typeof validateInbound
  validatePluginConfig?: (directory: string) => {
    valid: boolean
    config: { cross_project_mailbox?: CrossProjectMailboxConfig }
  }
}

export interface PendingMailboxPreview {
  fromProjectId: string
  messageId: string
  timestamp: number
  intent: MailboxMessage["intent"]
  bodyPreview: string
}

export interface DrainedMailboxNote extends PendingMailboxPreview {
  envelope: MailboxMessage
  body: string
}

export interface SkippedMailboxNote {
  messageId: string
  reason: string
}

function resolveFreshConfig(deps: ManualMailboxToolDeps): CrossProjectMailboxConfig {
  const validatePluginConfig = deps.validatePluginConfig ?? defaultValidatePluginConfig
  const read = validatePluginConfig(deps.repoRoot)
  if (read.valid && read.config.cross_project_mailbox) return read.config.cross_project_mailbox
  return deps.config
}

function preview(note: UnreadMessage): PendingMailboxPreview {
  return {
    fromProjectId: note.envelope.fromProjectId,
    messageId: note.messageId,
    timestamp: note.envelope.timestamp,
    intent: note.envelope.intent,
    bodyPreview: note.body.slice(0, BODY_PREVIEW_MAX),
  }
}

export async function runProjectMailboxPeek(deps: ManualMailboxToolDeps): Promise<{ pending: PendingMailboxPreview[] }> {
  const pending: PendingMailboxPreview[] = []
  for (const sender of await deps.getRegisteredProjects()) {
    const store = deps.makeMailboxStore(deps.repoRoot, sender.projectId)
    const notes = await store.drainUnread(Number.MAX_SAFE_INTEGER)
    pending.push(...notes.map(preview))
  }
  return { pending }
}

function drainedNote(note: UnreadMessage): DrainedMailboxNote {
  return { ...preview(note), envelope: note.envelope, body: note.body }
}

export async function runProjectMailboxDrain(deps: ManualMailboxToolDeps): Promise<{
  drained: DrainedMailboxNote[]
  skipped: SkippedMailboxNote[]
}> {
  const config = resolveFreshConfig(deps)
  if (config.enabled === false) return { drained: [], skipped: [{ messageId: "", reason: "mailbox disabled" }] }

  const maxNotes = config.bounds.max_notes_per_drain
  const digestStore = deps.makeDigestStore(deps.repoRoot)
  const rateLimiter = deps.makeRateLimiter(deps.repoRoot)
  const drained: DrainedMailboxNote[] = []
  const skipped: SkippedMailboxNote[] = []

  for (const sender of await deps.getRegisteredProjects()) {
    if (drained.length >= maxNotes) break
    const store = deps.makeMailboxStore(deps.repoRoot, sender.projectId)
    const notes = await store.drainUnread(maxNotes - drained.length)
    for (const note of notes) {
      if (drained.length >= maxNotes) break
      const reserved = await reserveValidatedDelivery({ deps, config, store, digestStore, rateLimiter, note })
      if (reserved.status !== "reserved") {
        if (reserved.status === "rejected") skipped.push({ messageId: note.messageId, reason: reserved.reason })
        continue
      }
      try {
        const pendingEntry: Omit<PendingEntry, "state"> = {
          messageId: note.messageId,
          sessionId: "manual-drain",
          reservedPath: reserved.reservedPath,
          dispatchedAt: Date.now(),
        }
        await store.markDispatched(pendingEntry)
        await store.ack(note.messageId)
        drained.push(drainedNote(note))
      } catch (error) {
        await rollbackReservedDelivery({
          store,
          digestStore,
          note,
          logPrefix: "[mailbox-manual-drain] delivery failure",
        })
        throw error
      }
    }
  }

  return { drained, skipped }
}

export function createProjectMailboxPeekTool(deps: ManualMailboxToolDeps): ToolDefinition {
  return tool({
    description: "List unread inbound cross-project mailbox notes without reserving or consuming them",
    args: {},
    execute: async () => JSON.stringify(await runProjectMailboxPeek(deps)),
  })
}

export function createProjectMailboxDrainTool(deps: ManualMailboxToolDeps): ToolDefinition {
  return tool({
    description: "Drain unread inbound cross-project mailbox notes synchronously without waiting for session.idle",
    args: {},
    execute: async () => JSON.stringify(await runProjectMailboxDrain(deps)),
  })
}
