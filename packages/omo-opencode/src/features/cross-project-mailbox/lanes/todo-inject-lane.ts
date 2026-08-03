import type { MailboxMessage, MailboxMode } from "../envelope/schema"
import type { TodoInjectItem, TodoInjectResult, TodoInjector } from "../todo-inject"

type TodoInjectMode = Extract<MailboxMode, "todo-append" | "todo-next">

export type TodoInjectLaneNote = {
  readonly envelope: MailboxMessage & { readonly requested_mode: TodoInjectMode }
  readonly body: string
}

export type TodoInjectLaneDeps = {
  readonly ack: (messageId: string) => Promise<void>
  readonly sendConfirmation?: (note: TodoInjectLaneNote, result: TodoInjectResult) => Promise<void>
}

function assertNever(value: never): never {
  throw new Error(`unhandled todo inject mode: ${value}`)
}

function normalizeBody(body: string): string {
  const normalized = body.trim().replace(/\s+/g, " ")
  return normalized.length === 0 ? "Mailbox request" : normalized
}

function buildTodoContent(note: TodoInjectLaneNote): string {
  const envelope = note.envelope
  const resultSummary = normalizeBody(note.body)
  return `[${envelope.toProject}] Add mailbox request from ${envelope.fromProject} to track requested work - expect ${resultSummary} [mailbox:${envelope.messageId}]`
}

function requestsConfirmation(note: TodoInjectLaneNote): boolean {
  const bodyRequestsConfirmation = note.body.toLowerCase().includes("[confirm]")
  const categoryRequestsConfirmation = note.envelope.category?.toLowerCase() === "confirm"
  return bodyRequestsConfirmation || categoryRequestsConfirmation
}

async function injectTodo(
  mode: TodoInjectMode,
  sessionID: string,
  injector: TodoInjector,
  item: TodoInjectItem,
): Promise<TodoInjectResult> {
  switch (mode) {
    case "todo-append":
      return injector.append(sessionID, item)
    case "todo-next":
      return injector.insertNext(sessionID, item)
    default:
      return assertNever(mode)
  }
}

export async function runTodoInjectLane(
  note: TodoInjectLaneNote,
  sessionID: string,
  injector: TodoInjector,
  deps: TodoInjectLaneDeps,
): Promise<TodoInjectResult> {
  const item: TodoInjectItem = { content: buildTodoContent(note) }
  const result = await injectTodo(note.envelope.requested_mode, sessionID, injector, item)
  await deps.ack(note.envelope.messageId)

  if (deps.sendConfirmation && requestsConfirmation(note)) {
    await deps.sendConfirmation(note, result)
  }

  return result
}
