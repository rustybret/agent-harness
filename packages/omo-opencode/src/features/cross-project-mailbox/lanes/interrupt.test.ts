import { describe, expect, it } from "bun:test"

import type { InternalPromptDispatchArgs, InternalPromptDispatchResult } from "../../../shared/prompt-async-gate"
import type { MailboxMessage } from "../envelope/schema"
import type { UnreadMessage } from "../mailbox/types"
import type { TodoInjectItem, TodoInjectResult, TodoInjector, TodoItem } from "../todo-inject"
import { createInterruptLane } from "./interrupt"

const envelope: MailboxMessage & { readonly requested_mode: "interrupt" } = {
  version: 1,
  messageId: "11111111-1111-4111-8111-111111111111",
  timestamp: 1,
  correlationId: "22222222-2222-4222-8222-222222222222",
  inReplyToMessageId: null,
  fromProject: "Sender",
  toProject: "Receiver",
  fromProjectId: "sender-project",
  toProjectId: "receiver-project",
  intent: "plan",
  priority: 9,
  hopCount: 0,
  hopPath: ["sender-project"],
  supersedes: null,
  requested_mode: "interrupt",
}

const note: UnreadMessage = {
  messageId: envelope.messageId,
  filePath: "/repo/coordination_notes/sender-project/.delivering-note.md",
  envelope,
  body: "Stop and reassess task sequencing.",
}

class RecordingTodoInjector implements TodoInjector {
  readonly events: string[]
  readonly prepended: TodoInjectItem[] = []
  readonly restored: Array<readonly TodoItem[]> = []
  snapshotTodos: readonly TodoItem[] = [{ id: "existing", content: "current work", status: "in_progress", priority: "high" }]

  constructor(events: string[]) {
    this.events = events
  }

  async append(): Promise<TodoInjectResult> {
    throw new Error("append should not be called")
  }

  async insertNext(): Promise<TodoInjectResult> {
    throw new Error("insertNext should not be called")
  }

  async prepend(_sessionID: string, item: TodoInjectItem): Promise<TodoInjectResult> {
    this.events.push("prepend")
    this.prepended.push(item)
    return { outcome: "written", count: this.snapshotTodos.length + 1 }
  }

  async snapshot(sessionID: string): Promise<readonly TodoItem[]> {
    this.events.push(`snapshot:${sessionID}`)
    return this.snapshotTodos
  }

  async restore(_sessionID: string, todos: readonly TodoItem[]): Promise<void> {
    this.events.push("restore")
    this.restored.push(todos)
  }
}

class RecordingStore {
  readonly calls: string[] = []

  async ack(messageId: string): Promise<void> {
    this.calls.push(`ack:${messageId}`)
  }

  async unreserve(messageId: string): Promise<void> {
    this.calls.push(`unreserve:${messageId}`)
  }
}

function createHarness(dispatchResult: InternalPromptDispatchResult = { status: "dispatched", response: {} }) {
  const events: string[] = []
  const dispatches: InternalPromptDispatchArgs[] = []
  const injector = new RecordingTodoInjector(events)
  const store = new RecordingStore()
  const lane = createInterruptLane({
    client: { session: { promptAsync: async () => ({}) } },
    directory: "/repo",
    dispatchInternalPrompt: async (args) => {
      events.push("dispatch")
      dispatches.push(args)
      return dispatchResult
    },
    injector,
    sessionID: "ses_live",
    store,
  })
  return { dispatches, events, injector, lane, store }
}

describe("interrupt lane", () => {
  describe("#given an interrupt-mode note", () => {
    it("#then prepends a mailbox todo before dispatching an urgent queued prompt", async () => {
      // given
      const { dispatches, events, injector, lane, store } = createHarness()

      // when
      const result = await lane.fulfill(note)

      // then
      expect(result).toEqual({ status: "accepted" })
      expect(events).toEqual(["snapshot:ses_live", "prepend", "dispatch"])
      expect(store.calls).toEqual([`ack:${note.messageId}`])
      expect(injector.prepended[0]?.content).toContain("[mailbox:11111111-1111-4111-8111-111111111111]")
      expect(dispatches[0]?.mode).toBe("async")
      expect(dispatches[0]?.queueBehavior).toBe("enqueue")
      expect(dispatches[0]?.input.body.parts[0]?.text).toContain("URGENT-INTERRUPT")
    })
  })

  describe("#given the prompt gate rejects after the todo prepend", () => {
    it("#then restores the pre-prepend snapshot and returns the note to unread", async () => {
      // given
      const { injector, lane, store } = createHarness({ status: "unavailable" })

      // when
      const result = await lane.fulfill(note)

      // then
      expect(result).toEqual({ status: "rolled-back", dispatchStatus: "unavailable" })
      expect(injector.restored).toEqual([injector.snapshotTodos])
      expect(store.calls).toEqual([`unreserve:${note.messageId}`])
    })
  })
})
