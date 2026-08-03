import { describe, expect, it } from "bun:test"
import { createTodoInjector, type TodoInjectItem, type TodoItem } from "./todo-inject"

type SessionStatusMap = Record<string, { readonly type: "idle" | "busy" | "retry" }>

class FakeTodoClient {
  readonly todos = new Map<string, TodoItem[]>()
  readonly writes: Array<{ readonly sessionID: string; readonly todos: readonly TodoItem[] }> = []
  statusResponse: SessionStatusMap = {}
  missingSessions = new Set<string>()
  writeError: Error | undefined

  readonly session = {
    get: async (input: { readonly path: { readonly id: string } }): Promise<{ readonly data: { readonly id: string } }> => {
      if (this.missingSessions.has(input.path.id)) {
        throw new Error("session not found")
      }
      return { data: { id: input.path.id } }
    },
    status: async (): Promise<{ readonly data: SessionStatusMap }> => ({ data: this.statusResponse }),
    todo: async (input: { readonly path: { readonly id: string } }): Promise<{ readonly data: TodoItem[] }> => ({
      data: this.todos.get(input.path.id) ?? [],
    }),
  }

  async write(input: { readonly sessionID: string; readonly todos: readonly TodoItem[] }): Promise<void> {
    if (this.writeError) {
      throw this.writeError
    }
    const nextTodos = input.todos.map((todo) => ({ ...todo }))
    this.todos.set(input.sessionID, nextTodos)
    this.writes.push({ sessionID: input.sessionID, todos: nextTodos })
  }
}

const item: TodoInjectItem = {
  content: "mailbox todo",
  priority: "high",
}

describe("createTodoInjector", () => {
  it("appends a todo at the end when the target session is live", async () => {
    // given
    const client = new FakeTodoClient()
    client.statusResponse = { ses_live: { type: "idle" } }
    client.todos.set("ses_live", [
      { id: "one", content: "first", status: "pending", priority: "medium" },
    ])
    const injector = createTodoInjector({
      addBoulderWork: () => null,
      client,
      directory: "/workspace",
      log: () => undefined,
      todoWriter: (input) => client.write(input),
    })

    // when
    await injector.append("ses_live", item)

    // then
    expect(client.todos.get("ses_live")?.map((todo) => todo.content)).toEqual(["first", "mailbox todo"])
  })

  it("inserts a todo after the in-progress item when one exists", async () => {
    // given
    const client = new FakeTodoClient()
    client.statusResponse = { ses_live: { type: "busy" } }
    client.todos.set("ses_live", [
      { id: "one", content: "first", status: "pending", priority: "low" },
      { id: "two", content: "current", status: "in_progress", priority: "high" },
      { id: "three", content: "last", status: "pending", priority: "medium" },
    ])
    const injector = createTodoInjector({
      addBoulderWork: () => null,
      client,
      directory: "/workspace",
      log: () => undefined,
      todoWriter: (input) => client.write(input),
    })

    // when
    await injector.insertNext("ses_live", item)

    // then
    expect(client.todos.get("ses_live")?.map((todo) => todo.content)).toEqual([
      "first",
      "current",
      "mailbox todo",
      "last",
    ])
  })

  it("inserts a todo at the front when insertNext finds no in-progress item", async () => {
    // given
    const client = new FakeTodoClient()
    client.statusResponse = { ses_live: { type: "idle" } }
    client.todos.set("ses_live", [
      { id: "one", content: "first", status: "pending", priority: "low" },
    ])
    const injector = createTodoInjector({
      addBoulderWork: () => null,
      client,
      directory: "/workspace",
      log: () => undefined,
      todoWriter: (input) => client.write(input),
    })

    // when
    await injector.insertNext("ses_live", item)

    // then
    expect(client.todos.get("ses_live")?.map((todo) => todo.content)).toEqual(["mailbox todo", "first"])
  })

  it("prepends a todo at the front regardless of in-progress state", async () => {
    // given
    const client = new FakeTodoClient()
    client.statusResponse = { ses_live: { type: "busy" } }
    client.todos.set("ses_live", [
      { id: "one", content: "first", status: "in_progress", priority: "high" },
    ])
    const injector = createTodoInjector({
      addBoulderWork: () => null,
      client,
      directory: "/workspace",
      log: () => undefined,
      todoWriter: (input) => client.write(input),
    })

    // when
    await injector.prepend("ses_live", item)

    // then
    expect(client.todos.get("ses_live")?.map((todo) => todo.content)).toEqual(["mailbox todo", "first"])
  })

  it("falls back to boulder work when the target session is not live", async () => {
    // given
    const client = new FakeTodoClient()
    client.missingSessions.add("ses_dead")
    const fallbackCalls: Array<{ readonly directory: string; readonly planPath: string; readonly sessionId: string }> = []
    const injector = createTodoInjector({
      addBoulderWork: (directory, input) => {
        fallbackCalls.push({ directory, planPath: input.planPath, sessionId: input.sessionId })
        return null
      },
      client,
      directory: "/workspace",
      log: () => undefined,
      todoWriter: (input) => client.write(input),
    })

    // when
    await injector.append("ses_dead", item)

    // then
    expect(client.writes).toHaveLength(0)
    expect(fallbackCalls).toEqual([
      { directory: "/workspace", planPath: "mailbox todo", sessionId: "ses_dead" },
    ])
  })

  it("falls back to boulder work when the todo write route throws", async () => {
    // given
    const client = new FakeTodoClient()
    client.statusResponse = { ses_live: { type: "idle" } }
    client.writeError = new Error("write failed")
    const fallbackCalls: Array<{ readonly planPath: string; readonly sessionId: string }> = []
    const logs: string[] = []
    const injector = createTodoInjector({
      addBoulderWork: (_directory, input) => {
        fallbackCalls.push({ planPath: input.planPath, sessionId: input.sessionId })
        return null
      },
      client,
      directory: "/workspace",
      log: (message) => logs.push(message),
      todoWriter: (input) => client.write(input),
    })

    // when
    await injector.prepend("ses_live", item)

    // then
    expect(fallbackCalls).toEqual([{ planPath: "mailbox todo", sessionId: "ses_live" }])
    expect(logs.some((message) => message.includes("write-failed"))).toBe(true)
  })
})
