import { describe, expect, it } from "bun:test"

import type { MailboxMessage } from "../envelope/schema"
import { createTodoInjector } from "../todo-inject"
import type { TodoInjectItem, TodoInjectResult, TodoInjector, TodoItem } from "../todo-inject"
import { runTodoInjectLane } from "./todo-inject-lane"
import type { TodoInjectLaneNote } from "./todo-inject-lane"

type TodoMode = "todo-append" | "todo-next"

type RecordedOperation = {
  readonly kind: "append" | "insertNext" | "prepend"
  readonly sessionID: string
  readonly item: TodoInjectItem
}

class RecordingTodoInjector implements TodoInjector {
  readonly operations: RecordedOperation[] = []
  result: TodoInjectResult = { outcome: "written", count: 1 }

  async append(sessionID: string, item: TodoInjectItem): Promise<TodoInjectResult> {
    this.operations.push({ kind: "append", sessionID, item })
    return this.result
  }

  async insertNext(sessionID: string, item: TodoInjectItem): Promise<TodoInjectResult> {
    this.operations.push({ kind: "insertNext", sessionID, item })
    return this.result
  }

  async prepend(sessionID: string, item: TodoInjectItem): Promise<TodoInjectResult> {
    this.operations.push({ kind: "prepend", sessionID, item })
    return this.result
  }

  async restore(): Promise<void> {
    throw new Error("restore should not be called")
  }

  async snapshot(): Promise<readonly TodoItem[]> {
    throw new Error("snapshot should not be called")
  }
}

class FakeTodoClient {
  readonly todos = new Map<string, TodoItem[]>()
  readonly writes: Array<{ readonly sessionID: string; readonly todos: readonly TodoItem[] }> = []

  readonly session = {
    get: async (input: { readonly path: { readonly id: string } }): Promise<{ readonly data: { readonly id: string } }> => ({
      data: { id: input.path.id },
    }),
    todo: async (input: { readonly path: { readonly id: string } }): Promise<{ readonly data: TodoItem[] }> => ({
      data: this.todos.get(input.path.id) ?? [],
    }),
  }

  async write(input: { readonly sessionID: string; readonly todos: readonly TodoItem[] }): Promise<void> {
    const nextTodos = input.todos.map((todo) => ({ ...todo }))
    this.todos.set(input.sessionID, nextTodos)
    this.writes.push({ sessionID: input.sessionID, todos: nextTodos })
  }
}

function makeEnvelope(mode: TodoMode, messageId = "00000000-0000-4000-8000-000000000001", category?: string): MailboxMessage & { readonly requested_mode: TodoMode } {
  return {
    version: 1,
    messageId,
    timestamp: 1,
    correlationId: "00000000-0000-4000-8000-000000000010",
    inReplyToMessageId: null,
    fromProject: "sender",
    toProject: "receiver",
    fromProjectId: "sender-id",
    toProjectId: "receiver-id",
    intent: "impl",
    ...(category === undefined ? {} : { category }),
    priority: 0,
    hopCount: 0,
    hopPath: ["sender-id"],
    supersedes: null,
    requested_mode: mode,
  }
}

function makeNote(mode: TodoMode, body: string, messageId?: string, category?: string): TodoInjectLaneNote {
  return { envelope: makeEnvelope(mode, messageId, category), body }
}

function firstOperation(injector: RecordingTodoInjector): RecordedOperation {
  const operation = injector.operations.at(0)
  if (!operation) {
    throw new Error("missing recorded injector operation")
  }
  return operation
}

const existingTodos: readonly TodoItem[] = [
  { id: "one", content: "first", status: "pending", priority: "low" },
  { id: "two", content: "current", status: "in_progress", priority: "high" },
  { id: "three", content: "last", status: "pending", priority: "medium" },
]

describe("runTodoInjectLane", () => {
  describe("#given a todo-append mailbox note", () => {
    it("#then appends a pending todo-shaped item with mailbox provenance and acks the note", async () => {
      // given
      const injector = new RecordingTodoInjector()
      const acks: string[] = []
      const note = makeNote("todo-append", "Update the dashboard copy")

      // when
      const result = await runTodoInjectLane(note, "ses_live", injector, {
        ack: async (messageId) => {
          acks.push(messageId)
        },
      })

      // then
      const operation = firstOperation(injector)
      expect(result).toEqual({ outcome: "written", count: 1 })
      expect(operation.kind).toBe("append")
      expect(operation.sessionID).toBe("ses_live")
      expect(operation.item.content).toContain("Update the dashboard copy")
      expect(operation.item.content.endsWith("[mailbox:00000000-0000-4000-8000-000000000001]")).toBe(true)
      expect("status" in operation.item).toBe(false)
      expect(acks).toEqual(["00000000-0000-4000-8000-000000000001"])
    })
  })

  describe("#given a todo-next mailbox note", () => {
    it("#then delegates to insertNext without marking the injected item in progress", async () => {
      // given
      const injector = new RecordingTodoInjector()
      const note = makeNote("todo-next", "Review the new router wiring")

      // when
      await runTodoInjectLane(note, "ses_live", injector, { ack: async () => undefined })

      // then
      const operation = firstOperation(injector)
      expect(operation.kind).toBe("insertNext")
      expect("status" in operation.item).toBe(false)
    })
  })

  describe("#given the todo injector falls back to durable storage", () => {
    it("#then treats fallback as success and acks the note", async () => {
      // given
      const injector = new RecordingTodoInjector()
      injector.result = { outcome: "fallback", reason: "session-not-live" }
      const acks: string[] = []
      const note = makeNote("todo-append", "Handle this when the session returns")

      // when
      const result = await runTodoInjectLane(note, "ses_dead", injector, {
        ack: async (messageId) => {
          acks.push(messageId)
        },
      })

      // then
      expect(result).toEqual({ outcome: "fallback", reason: "session-not-live" })
      expect(acks).toEqual(["00000000-0000-4000-8000-000000000001"])
    })
  })

  describe("#given confirmation is explicitly requested", () => {
    it("#then sends one confirmation reply with the injection result", async () => {
      // given
      const injector = new RecordingTodoInjector()
      const confirmations: TodoInjectResult[] = []
      const note = makeNote("todo-next", "[confirm] Add a follow-up check")

      // when
      await runTodoInjectLane(note, "ses_live", injector, {
        ack: async () => undefined,
        sendConfirmation: async (_note, result) => {
          confirmations.push(result)
        },
      })

      // then
      expect(confirmations).toEqual([{ outcome: "written", count: 1 }])
    })

    it("#then also honors the simple metadata category signal", async () => {
      // given
      const injector = new RecordingTodoInjector()
      const confirmedMessageIds: string[] = []
      const note = makeNote("todo-append", "Add a follow-up check", "00000000-0000-4000-8000-000000000002", "confirm")

      // when
      await runTodoInjectLane(note, "ses_live", injector, {
        ack: async () => undefined,
        sendConfirmation: async (confirmedNote) => {
          confirmedMessageIds.push(confirmedNote.envelope.messageId)
        },
      })

      // then
      expect(confirmedMessageIds).toEqual(["00000000-0000-4000-8000-000000000002"])
    })
  })

  describe("#given confirmation is not requested", () => {
    it("#then does not send a confirmation reply", async () => {
      // given
      const injector = new RecordingTodoInjector()
      const confirmations: TodoInjectResult[] = []
      const note = makeNote("todo-next", "Add a follow-up check")

      // when
      await runTodoInjectLane(note, "ses_live", injector, {
        ack: async () => undefined,
        sendConfirmation: async (_note, result) => {
          confirmations.push(result)
        },
      })

      // then
      expect(confirmations).toEqual([])
    })
  })

  describe("#given the real todo injector receives a todo-append lane item", () => {
    it("#then existing todos keep their order and the new todo lands last", async () => {
      // given
      const client = new FakeTodoClient()
      client.todos.set("ses_live", existingTodos.map((todo) => ({ ...todo })))
      const injector = createTodoInjector({
        addBoulderWork: () => null,
        client,
        directory: "/workspace",
        log: () => undefined,
        todoWriter: (input) => client.write(input),
      })
      const note = makeNote("todo-append", "Append this mailbox work")

      // when
      await runTodoInjectLane(note, "ses_live", injector, { ack: async () => undefined })

      // then
      expect(client.todos.get("ses_live")?.map((todo) => todo.content)).toEqual([
        "first",
        "current",
        "last",
        expect.stringContaining("[mailbox:00000000-0000-4000-8000-000000000001]"),
      ])
    })
  })

  describe("#given the real todo injector receives a todo-next lane item", () => {
    it("#then existing todos keep their relative order and the new todo follows in-progress", async () => {
      // given
      const client = new FakeTodoClient()
      client.todos.set("ses_live", existingTodos.map((todo) => ({ ...todo })))
      const injector = createTodoInjector({
        addBoulderWork: () => null,
        client,
        directory: "/workspace",
        log: () => undefined,
        todoWriter: (input) => client.write(input),
      })
      const note = makeNote("todo-next", "Run the next mailbox check")

      // when
      await runTodoInjectLane(note, "ses_live", injector, { ack: async () => undefined })

      // then
      expect(client.todos.get("ses_live")?.map((todo) => todo.content)).toEqual([
        "first",
        "current",
        expect.stringContaining("[mailbox:00000000-0000-4000-8000-000000000001]"),
        "last",
      ])
    })
  })
})
