/// <reference path="../../../../bun-test.d.ts" />
import { describe, it, expect, afterEach, mock } from "bun:test"

import { createEventHandler } from "./event"
import { _resetForTesting } from "../features/claude-code-session-state"

type EventInput = { event: { type: string; properties?: unknown } }
type EventHandlerArgs = Parameters<typeof createEventHandler>[0]
type EventHandlerInput = Parameters<ReturnType<typeof createEventHandler>>[0]

function cast<T>(value: unknown): T {
  return value as T
}

interface TrackerCalls {
  recorded: string[]
  removed: string[]
}

function createHandlerWithTracker(calls: TrackerCalls): ReturnType<typeof createEventHandler> {
  return createEventHandler({
    ctx: cast<EventHandlerArgs["ctx"]>({ directory: "/tmp", client: { session: {} } }),
    pluginConfig: cast<EventHandlerArgs["pluginConfig"]>({}),
    firstMessageVariantGate: {
      markSessionCreated: () => {},
      clear: () => {},
    } as EventHandlerArgs["firstMessageVariantGate"],
    managers: cast<EventHandlerArgs["managers"]>({
      tmuxSessionManager: { onEvent: () => {}, onSessionCreated: async () => {}, onSessionDeleted: async () => {} },
    }),
    hooks: cast<EventHandlerArgs["hooks"]>({}),
    externalInjectTracker: {
      recordActivity: (sessionID: string) => calls.recorded.push(sessionID),
      remove: (sessionID: string) => calls.removed.push(sessionID),
    },
  })
}

function fire(handler: ReturnType<typeof createEventHandler>, type: string, sessionID: string): Promise<void> {
  const input: EventInput = { event: { type, properties: { sessionID, info: { id: sessionID } } } }
  return handler(cast<EventHandlerInput>(input))
}

afterEach(() => {
  mock.restore()
  _resetForTesting()
})

describe("event handler external-inject session tracker", () => {
  it("#given a session.created event #then records the session as active", async () => {
    // given
    const calls: TrackerCalls = { recorded: [], removed: [] }
    const handler = createHandlerWithTracker(calls)
    // when
    await fire(handler, "session.created", "ses_created")
    // then
    expect(calls.recorded).toContain("ses_created")
  })

  it("#given a session.idle event #then records the session as active", async () => {
    const calls: TrackerCalls = { recorded: [], removed: [] }
    const handler = createHandlerWithTracker(calls)
    await fire(handler, "session.idle", "ses_idle")
    expect(calls.recorded).toContain("ses_idle")
  })

  it("#given a session.deleted event #then removes the session from the tracker", async () => {
    const calls: TrackerCalls = { recorded: [], removed: [] }
    const handler = createHandlerWithTracker(calls)
    // The tracker.remove runs before handleSessionDeletedEvent (which needs a
    // fuller managers mock than this seam test provides); tolerate its throw
    // since we only assert the removal seam fired.
    await fire(handler, "session.deleted", "ses_gone").catch(() => {})
    expect(calls.removed).toContain("ses_gone")
  })

  it("#given no tracker is provided #then lifecycle events do not throw", async () => {
    // given
    const handler = createEventHandler({
      ctx: cast<EventHandlerArgs["ctx"]>({ directory: "/tmp", client: { session: {} } }),
      pluginConfig: cast<EventHandlerArgs["pluginConfig"]>({}),
      firstMessageVariantGate: {
        markSessionCreated: () => {},
        clear: () => {},
      } as EventHandlerArgs["firstMessageVariantGate"],
      managers: cast<EventHandlerArgs["managers"]>({
        tmuxSessionManager: { onEvent: () => {}, onSessionCreated: async () => {}, onSessionDeleted: async () => {} },
      }),
      hooks: cast<EventHandlerArgs["hooks"]>({}),
    })
    // when / then
    await fire(handler, "session.created", "ses_x")
    expect(true).toBe(true)
  })
})
