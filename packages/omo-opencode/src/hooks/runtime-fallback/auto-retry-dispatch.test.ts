import { afterEach, describe, expect, test } from "bun:test"

import { DEFAULT_PROMPT_QUEUE_RETRY_MS, releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { setPromptReservation } from "../../shared/prompt-async-gate/reservations"
import {
  BACKGROUND_COMPLETION_TEARDOWN_ABORT_SOURCE,
  getInternalAbortResumeBudgetExhaustedMessage,
  markInternalAbortSession,
} from "./auto-retry-abort"
import { createAutoRetryHelpers } from "./auto-retry"
import { createFallbackState } from "./fallback-state"
import { installRuntimeFallbackTestClock, restoreRuntimeFallbackTestClock } from "./test-timeout-clock.test-support"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

function createContext(promptCalls: { count: number }): RuntimeFallbackPluginInput {
  const session = {
    abort: async () => ({}),
    messages: async () => ({
      data: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "retry this" }],
        },
      ],
    }),
    promptAsync: async () => {
      promptCalls.count += 1
      return {}
    },
    status: async () => ({ data: {} }),
  }
  return {
    client: {
      session,
      tui: {
        showToast: async () => ({}),
      },
    },
    directory: "/test/dir",
  }
}

function createDeps(promptCalls: { count: number }): HookDeps {
  return {
    ctx: createContext(promptCalls),
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 0,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
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

function reserveSession(sessionID: string, holdMs: number): void {
  setPromptReservation(sessionID, {
    source: "user-prompt",
    dedupeKey: "stale-cancelled-stream",
    reservedAt: Date.now(),
    token: Symbol("stale-cancelled-stream"),
    expiresAt: Date.now() + holdMs,
  })
}

async function flushPromptGateMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve()
  }
}

describe("createAutoRetryDispatcher reserved-session retry (#5109)", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
    restoreRuntimeFallbackTestClock()
  })

  test("#given a stale promptAsync reservation that releases shortly after #when auto retry runs #then the fallback dispatch is retried instead of silently abandoned", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-reserved-then-released"
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)
    reserveSession(sessionID, 250)
    const clock = installRuntimeFallbackTestClock()

    // when
    const retryPromise = helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.error")
    await flushPromptGateMicrotasks()
    await clock.advanceBy(500)
    await retryPromise

    // then
    expect(promptCalls.count).toBe(1)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(state.pendingFallbackModel).toBe("openai/gpt-5.4")
  })

  test("#given the retried dispatch fails ambiguously after the reservation releases #when auto retry runs #then the pending fallback is preserved as possibly accepted", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    deps.ctx.client.session.promptAsync = async () => {
      promptCalls.count += 1
      throw new Error("JSON Parse error: Unexpected EOF")
    }
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-reserved-then-ambiguous-failure"
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)
    reserveSession(sessionID, 250)
    const clock = installRuntimeFallbackTestClock()

    // when
    const retryPromise = helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.error")
    await flushPromptGateMicrotasks()
    await clock.advanceBy(500)
    await retryPromise

    // then
    expect(promptCalls.count).toBe(1)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(state.pendingFallbackPromptMayHaveBeenAccepted).toBe(true)
  })

  test("#given the failed assistant is still active #when auto retry runs #then the fallback dispatch is queued until the assistant unblocks", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const sessionID = "session-active-assistant-then-unblocked"
    let assistantIsActive = true
    deps.ctx.client.session.messages = async () => ({
      data: assistantIsActive
        ? [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "retry this" }],
            },
            {
              info: { role: "assistant" },
              parts: [{ type: "reasoning", text: "still resolving failed stream" }],
            },
          ]
        : [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "retry this" }],
            },
            {
              info: { role: "assistant", finish: true },
              parts: [],
            },
          ],
    })
    deps.ctx.client.session.promptAsync = async () => {
      promptCalls.count += 1
      return {}
    }
    const helpers = createAutoRetryHelpers(deps)
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)
    const clock = installRuntimeFallbackTestClock()

    // when
    await helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.error")
    expect(promptCalls.count).toBe(0)
    assistantIsActive = false
    await flushPromptGateMicrotasks()
    await clock.advanceBy(DEFAULT_PROMPT_QUEUE_RETRY_MS)
    await flushPromptGateMicrotasks()

    // then
    expect(promptCalls.count).toBe(1)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(state.pendingFallbackModel).toBe("openai/gpt-5.4")
  })

  test("#given a session WE internally aborted whose dangling assistant turn has no finish, no output and no terminal error #when auto retry runs #then the fallback dispatch fires immediately instead of looping forever on active-queue", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const sessionID = "session-internally-aborted-dangling-assistant"
    expect(markInternalAbortSession(deps, sessionID, "session.status.retry-signal")).toBe(true)
    deps.ctx.client.session.messages = async () => ({
      data: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "retry this" }],
        },
        {
          info: { role: "assistant" },
          parts: [{ type: "reasoning", text: "aborted mid-reasoning" }],
        },
      ],
    })
    const helpers = createAutoRetryHelpers(deps)
    const state = createFallbackState("openai/gpt-5.5")
    state.pendingFallbackModel = "anthropic/claude-opus-4-8"
    deps.sessionStates.set(sessionID, state)

    // when
    await helpers.autoRetryWithFallback(sessionID, "anthropic/claude-opus-4-8", undefined, "session.status")

    // then
    expect(promptCalls.count).toBe(1)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
  })

  test("#given a session NOT internally aborted whose assistant turn is genuinely active #when auto retry runs #then the dispatch is still withheld (active-check preserved for live turns)", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const sessionID = "session-genuinely-active-not-aborted"
    deps.ctx.client.session.messages = async () => ({
      data: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "retry this" }],
        },
        {
          info: { role: "assistant" },
          parts: [{ type: "reasoning", text: "genuinely still working" }],
        },
      ],
    })
    const helpers = createAutoRetryHelpers(deps)
    const state = createFallbackState("openai/gpt-5.5")
    state.pendingFallbackModel = "anthropic/claude-opus-4-8"
    deps.sessionStates.set(sessionID, state)

    // when
    await helpers.autoRetryWithFallback(sessionID, "anthropic/claude-opus-4-8", undefined, "session.status")

    // then
    expect(promptCalls.count).toBe(0)
  })

  test("#given a stale internal-abort marker without an allowlisted source #when auto retry sees an active assistant #then it does not bypass the active-turn dispatch guard", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const sessionID = "session-stale-internal-marker-no-source"
    deps.internallyAbortedSessions.add(sessionID)
    deps.ctx.client.session.messages = async () => ({
      data: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "retry this" }],
        },
        {
          info: { role: "assistant" },
          parts: [{ type: "reasoning", text: "cancelled stream is still active" }],
        },
      ],
    })
    const helpers = createAutoRetryHelpers(deps)
    const state = createFallbackState("openai/gpt-5.5")
    state.pendingFallbackModel = "anthropic/claude-opus-4-8"
    deps.sessionStates.set(sessionID, state)

    // when
    await helpers.autoRetryWithFallback(sessionID, "anthropic/claude-opus-4-8", undefined, "session.status")

    // then
    expect(promptCalls.count).toBe(0)
    expect(deps.internalAbortResumeAttempts.has(sessionID)).toBe(false)
  })
})

describe("createAutoRetryDispatcher internal abort resume budget", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
    restoreRuntimeFallbackTestClock()
  })

  test("#given repeated background internal aborts for one session #when two internal abort re-dispatches have already run #then the third background abort is left terminal with a budget message", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-internal-abort-resume-budget"
    const state = createFallbackState("openai/gpt-5.5")
    state.pendingFallbackModel = "anthropic/claude-opus-4-8"
    deps.sessionStates.set(sessionID, state)

    expect(markInternalAbortSession(deps, sessionID, BACKGROUND_COMPLETION_TEARDOWN_ABORT_SOURCE)).toBe(true)
    await helpers.autoRetryWithFallback(sessionID, "anthropic/claude-opus-4-8", undefined, "session.status")
    releaseAllPromptAsyncReservationsForTesting()

    expect(markInternalAbortSession(deps, sessionID, BACKGROUND_COMPLETION_TEARDOWN_ABORT_SOURCE)).toBe(true)
    await helpers.autoRetryWithFallback(sessionID, "anthropic/claude-opus-4-8", undefined, "session.status")
    releaseAllPromptAsyncReservationsForTesting()

    const thirdMark = markInternalAbortSession(deps, sessionID, BACKGROUND_COMPLETION_TEARDOWN_ABORT_SOURCE)

    // then
    expect(promptCalls.count).toBe(2)
    expect(thirdMark).toBe(false)
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
    expect(getInternalAbortResumeBudgetExhaustedMessage(deps, sessionID)).toContain("resume budget exhausted (2)")
  })

  test("#given a model-fallback internal abort source #when background internal abort resume budget is exhausted #then model fallback marking is still allowed", () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const sessionID = "session-model-fallback-not-budgeted"
    deps.internalAbortResumeAttempts.set(sessionID, 2)

    // when
    const marked = markInternalAbortSession(deps, sessionID, "session.status.retry-signal")

    // then
    expect(marked).toBe(true)
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(true)
  })
})
