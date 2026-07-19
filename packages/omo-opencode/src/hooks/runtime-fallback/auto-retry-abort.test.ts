import { afterEach, describe, expect, test } from "bun:test"

import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { getPromptReservation, setPromptReservation } from "../../shared/prompt-async-gate/reservations"
import { createAbortSessionRequest, markInternalAbortSession } from "./auto-retry-abort"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

function createContext(): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({}),
      },
      tui: {
        showToast: async () => ({}),
      },
    },
    directory: "/test/dir",
  }
}

function createDeps(): HookDeps {
  return {
    ctx: createContext(),
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 0,
      notify_on_fallback: false,
    },
    options: undefined,
    pluginConfig: undefined,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
    internalAbortSources: new Map(),
    internalAbortResumeAttempts: new Map(),
    internalAbortBudgetExhaustedMessages: new Map(),
  }
}

function reserveSession(sessionID: string, source: string): void {
  setPromptReservation(sessionID, {
    source,
    dedupeKey: "in-flight-stream",
    reservedAt: Date.now(),
    token: Symbol("in-flight-stream"),
    expiresAt: Date.now() + 60_000,
  })
}

describe("createAbortSessionRequest reservation release", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given a session reserved by model-suggestion-retry on a provider retry signal #when the runtime-fallback abort fires #then the reservation is released so the fallback dispatch can acquire the session", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-model-suggestion-retry-held"
    reserveSession(sessionID, "model-suggestion-retry")
    const abortSessionRequest = createAbortSessionRequest(deps)

    // when
    await abortSessionRequest(sessionID, "session.status.retry-signal")

    // then
    expect(getPromptReservation(sessionID)).toBeUndefined()
  })

  test("#given a session reserved by model-suggestion-retry:sync #when the runtime-fallback abort fires #then the reservation is released", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-model-suggestion-retry-sync-held"
    reserveSession(sessionID, "model-suggestion-retry:sync")
    const abortSessionRequest = createAbortSessionRequest(deps)

    // when
    await abortSessionRequest(sessionID, "message.updated.retry-signal")

    // then
    expect(getPromptReservation(sessionID)).toBeUndefined()
  })

  test("#given a session reserved by the runtime-fallback path itself #when the abort fires #then the reservation is still released", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-runtime-fallback-held"
    reserveSession(sessionID, "runtime-fallback:session.status.retry-signal")
    const abortSessionRequest = createAbortSessionRequest(deps)

    // when
    await abortSessionRequest(sessionID, "session.status.retry-signal")

    // then
    expect(getPromptReservation(sessionID)).toBeUndefined()
  })

  test("#given a session reserved by an unrelated user prompt #when the runtime-fallback abort fires #then the reservation is preserved (abort must not steal a foreground user turn)", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-user-prompt-held"
    reserveSession(sessionID, "user-prompt")
    const abortSessionRequest = createAbortSessionRequest(deps)

    // when
    await abortSessionRequest(sessionID, "session.status.retry-signal")

    // then
    expect(getPromptReservation(sessionID)?.source).toBe("user-prompt")
  })
})

describe("createAbortSessionRequest internal abort source tracking", () => {
  test("#given runtime-fallback tracking is active #when background teardown marks internal abort #then the shared internal abort registry records the session", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-background-teardown"
    const abortSessionRequest = createAbortSessionRequest(deps)

    // when
    await abortSessionRequest(sessionID, "background-agent.completion-teardown")

    // then
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(true)
    expect(deps.sessionLastAccess.has(sessionID)).toBe(true)
  })

  test("#given runtime-fallback tracking is active #when quota watchdog marks internal abort #then the shared internal abort registry records the session", () => {
    // given
    const deps = createDeps()
    const sessionID = "session-quota-watchdog"
    createAbortSessionRequest(deps)

    // when
    const marked = markInternalAbortSession(deps, sessionID, "background-agent.quota-watchdog")

    // then
    expect(marked).toBe(true)
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(true)
  })

  test("#given two runtime-fallback dependency sets #when marking with the first set after the second initializes #then the second set is not polluted", () => {
    // given
    const firstDeps = createDeps()
    const secondDeps = createDeps()
    const sessionID = "session-explicit-registry"
    createAbortSessionRequest(firstDeps)
    createAbortSessionRequest(secondDeps)

    // when
    const marked = markInternalAbortSession(firstDeps, sessionID, "background-agent.quota-watchdog")

    // then
    expect(marked).toBe(true)
    expect(firstDeps.internallyAbortedSessions.has(sessionID)).toBe(true)
    expect(secondDeps.internallyAbortedSessions.has(sessionID)).toBe(false)
  })

  test("#given runtime-fallback tracking is active #when background_cancel or cleanup abort sources fire #then they remain external aborts", () => {
    // given
    const deps = createDeps()
    createAbortSessionRequest(deps)
    const externalSources = [
      "background_cancel",
      "cancelled pre-start cleanup",
      "cancelled during launch setup",
      "stale attempt binding cleanup",
      "task cancellation (background_cancel)",
      "session.stop",
      "shutdown",
    ]

    // when
    const marked = externalSources.map((source) => markInternalAbortSession(deps, `session-${source}`, source))

    // then
    expect(marked).toEqual(externalSources.map(() => false))
    expect(deps.internallyAbortedSessions.size).toBe(0)
  })
})
