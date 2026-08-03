import { addBoulderWork as addBoulderWorkDefault } from "@oh-my-opencode/boulder-state"
import { createSqliteTodoWriter } from "./sqlite-todo-writer"

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"
export type TodoPriority = "low" | "medium" | "high"

export type TodoItem = {
  readonly id?: string
  readonly content: string
  readonly status: TodoStatus
  readonly priority?: TodoPriority
}

export type TodoInjectItem = {
  readonly id?: string
  readonly content: string
  readonly status?: TodoStatus
  readonly priority?: TodoPriority
}

export type TodoWriter = (input: { readonly sessionID: string; readonly todos: readonly TodoItem[] }) => Promise<void>

type TodoClient = {
  readonly session: {
    readonly get?: (input: { readonly path: { readonly id: string } }) => Promise<unknown>
    readonly status?: () => Promise<unknown>
    readonly todo: (input: { readonly path: { readonly id: string } }) => Promise<unknown>
  }
}

type BoulderFallback = (
  directory: string,
  input: { readonly planPath: string; readonly sessionId: string; readonly agent?: string },
) => unknown

type Logger = (message: string, data?: Record<string, unknown>) => void

export type TodoInjectDeps = {
  readonly addBoulderWork?: BoulderFallback
  readonly client: TodoClient
  readonly directory: string
  readonly log?: Logger
  readonly todoWriter?: TodoWriter
}

export type TodoInjectResult =
  | { readonly outcome: "written"; readonly count: number }
  | { readonly outcome: "fallback"; readonly reason: string }

export type TodoInjector = {
  readonly append: (sessionID: string, item: TodoInjectItem) => Promise<TodoInjectResult>
  readonly insertNext: (sessionID: string, item: TodoInjectItem) => Promise<TodoInjectResult>
  readonly prepend: (sessionID: string, item: TodoInjectItem) => Promise<TodoInjectResult>
  readonly restore: (sessionID: string, todos: readonly TodoItem[]) => Promise<void>
  readonly snapshot: (sessionID: string) => Promise<readonly TodoItem[]>
}

const FALLBACK_AGENT = "mailbox-todo-inject"
function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null
}

function readString(value: object, key: string): string | undefined {
  const field = Reflect.get(value, key)
  return typeof field === "string" ? field : undefined
}

function isTodoStatus(value: string): value is TodoStatus {
  return value === "pending" || value === "in_progress" || value === "completed" || value === "cancelled"
}

function isTodoPriority(value: string): value is TodoPriority {
  return value === "low" || value === "medium" || value === "high"
}

function normalizeTodo(value: unknown): TodoItem | undefined {
  if (!isObject(value)) return undefined
  const content = readString(value, "content")
  if (!content) return undefined
  const statusValue = readString(value, "status")
  const priorityValue = readString(value, "priority")
  return {
    ...(readString(value, "id") ? { id: readString(value, "id") } : {}),
    content,
    status: statusValue && isTodoStatus(statusValue) ? statusValue : "pending",
    ...(priorityValue && isTodoPriority(priorityValue) ? { priority: priorityValue } : {}),
  }
}

function extractArrayPayload(response: unknown): readonly unknown[] {
  if (Array.isArray(response)) return response
  if (!isObject(response)) return []
  const data = Reflect.get(response, "data")
  return Array.isArray(data) ? data : []
}

function extractStatusMap(response: unknown): Record<string, unknown> {
  const payload = isObject(response) && isObject(Reflect.get(response, "data")) ? Reflect.get(response, "data") : response
  if (!isObject(payload)) return {}
  return Object.fromEntries(Object.entries(payload))
}

function toTodoItem(item: TodoInjectItem): TodoItem {
  return {
    id: item.id ?? globalThis.crypto.randomUUID(),
    content: item.content,
    priority: item.priority ?? "medium",
    status: item.status ?? "pending",
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createTodoInjector(deps: TodoInjectDeps): TodoInjector {
  const addBoulderWork = deps.addBoulderWork ?? addBoulderWorkDefault
  const log = deps.log ?? (() => undefined)
  const todoWriter = deps.todoWriter ?? createSqliteTodoWriter()

  const fallback = (sessionID: string, item: TodoInjectItem, reason: string): TodoInjectResult => {
    log(`[todo-inject] falling back to boulder work: ${reason}`, { reason, sessionID })
    addBoulderWork(deps.directory, { agent: FALLBACK_AGENT, planPath: item.content, sessionId: sessionID })
    return { outcome: "fallback", reason }
  }

  const isLiveSession = async (sessionID: string): Promise<boolean> => {
    if (deps.client.session.get) {
      try {
        await deps.client.session.get({ path: { id: sessionID } })
        return true
      } catch (error) {
        log("[todo-inject] session lookup failed", { error: errorMessage(error), sessionID })
        return false
      }
    }
    if (!deps.client.session.status) return true
    const statuses = extractStatusMap(await deps.client.session.status())
    return Object.hasOwn(statuses, sessionID)
  }

  const readTodos = async (sessionID: string): Promise<readonly TodoItem[]> => {
    const response = await deps.client.session.todo({ path: { id: sessionID } })
    return extractArrayPayload(response).map(normalizeTodo).filter((todo) => todo !== undefined)
  }

  const writeTodos = async (sessionID: string, todos: readonly TodoItem[]): Promise<void> => {
    await todoWriter({ sessionID, todos })
  }

  const mutate = async (
    sessionID: string,
    item: TodoInjectItem,
    insert: (currentTodos: readonly TodoItem[], nextTodo: TodoItem) => readonly TodoItem[],
  ): Promise<TodoInjectResult> => {
    try {
      if (!await isLiveSession(sessionID)) {
        return fallback(sessionID, item, "session-not-live")
      }
      const currentTodos = await readTodos(sessionID)
      const nextTodos = insert(currentTodos, toTodoItem(item))
      await writeTodos(sessionID, nextTodos)
      return { outcome: "written", count: nextTodos.length }
    } catch (error) {
      return fallback(sessionID, item, `write-failed: ${errorMessage(error)}`)
    }
  }

  return {
    append: (sessionID, item) => mutate(sessionID, item, (currentTodos, nextTodo) => [...currentTodos, nextTodo]),
    insertNext: (sessionID, item) => mutate(sessionID, item, (currentTodos, nextTodo) => {
      const currentIndex = currentTodos.findIndex((todo) => todo.status === "in_progress")
      const insertAt = currentIndex === -1 ? 0 : currentIndex + 1
      return [...currentTodos.slice(0, insertAt), nextTodo, ...currentTodos.slice(insertAt)]
    }),
    prepend: (sessionID, item) => mutate(sessionID, item, (currentTodos, nextTodo) => [nextTodo, ...currentTodos]),
    restore: writeTodos,
    snapshot: readTodos,
  }
}
