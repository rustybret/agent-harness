import { createHash } from "node:crypto"

import {
  isInternalPromptDispatchAccepted,
} from "../../../shared/prompt-async-gate"
import type {
  InternalPromptDispatchArgs,
  InternalPromptDispatchResult,
} from "../../../shared/prompt-async-gate"
import type { MailboxMessage } from "../envelope/schema"
import type { UnreadMessage } from "../mailbox/types"
import type { TodoInjectItem, TodoInjector } from "../todo-inject"

const INTERRUPT_SOURCE = "mailbox-interrupt"

type AsyncDispatchArgs = Extract<InternalPromptDispatchArgs, { mode: "async" }>
type DispatchClient = AsyncDispatchArgs["client"]

type InterruptEnvelope = MailboxMessage & { readonly requested_mode: "interrupt" }

export type InterruptLaneNote = UnreadMessage & {
  readonly envelope: InterruptEnvelope
}

export type InterruptLaneResult =
  | { readonly status: "accepted" }
  | { readonly status: "rolled-back"; readonly dispatchStatus: InternalPromptDispatchResult["status"] }

export type InterruptLaneDeps = {
  readonly client: DispatchClient
  readonly directory: string
  readonly dispatchInternalPrompt: (args: InternalPromptDispatchArgs) => Promise<InternalPromptDispatchResult>
  readonly injector: TodoInjector
  readonly sessionID: string
  readonly store: {
    readonly ack: (messageId: string) => Promise<void>
    readonly unreserve: (messageId: string) => Promise<void>
  }
}

export type InterruptLane = {
  readonly fulfill: (note: InterruptLaneNote) => Promise<InterruptLaneResult>
}

function coalesceKey(sessionID: string, messageId: string): string {
  const digest = createHash("sha256").update(messageId).digest("hex").slice(0, 16)
  return `${INTERRUPT_SOURCE}:${sessionID}:${digest}`
}

function buildTodoItem(note: InterruptLaneNote): TodoInjectItem {
  const summary = note.body.trim().replace(/\s+/g, " ") || "Mailbox interrupt"
  return {
    content: `[${note.envelope.toProject}] Prepend urgent mailbox interrupt from ${note.envelope.fromProject} to re-evaluate the current plan step - expect ${summary} [mailbox:${note.envelope.messageId}]`,
    priority: "high",
  }
}

function buildPromptText(note: InterruptLaneNote): string {
  return [
    "URGENT-INTERRUPT",
    "A cross-project interrupt note arrived. Re-evaluate the current plan step at the next safe boundary before continuing.",
    "",
    note.body,
    "",
    `[mailbox:${note.envelope.messageId}]`,
  ].join("\n")
}

export function createInterruptLane(deps: InterruptLaneDeps): InterruptLane {
  return {
    fulfill: async (note): Promise<InterruptLaneResult> => {
      const snapshot = await deps.injector.snapshot(deps.sessionID)
      await deps.injector.prepend(deps.sessionID, buildTodoItem(note))

      const result = await deps.dispatchInternalPrompt({
        mode: "async",
        client: deps.client,
        sessionID: deps.sessionID,
        source: INTERRUPT_SOURCE,
        dedupeKey: coalesceKey(deps.sessionID, note.envelope.messageId),
        queueBehavior: "enqueue",
        input: {
          path: { id: deps.sessionID },
          body: { parts: [{ type: "text", text: buildPromptText(note) }] },
          query: { directory: deps.directory },
        },
      })

      if (isInternalPromptDispatchAccepted(result)) {
        await deps.store.ack(note.envelope.messageId)
        return { status: "accepted" }
      }

      await deps.injector.restore(deps.sessionID, snapshot)
      await deps.store.unreserve(note.envelope.messageId)
      return { status: "rolled-back", dispatchStatus: result.status }
    },
  }
}
