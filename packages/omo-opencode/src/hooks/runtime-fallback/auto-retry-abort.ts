import type { HookDeps, InternalAbortSessionRegistry } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { releasePromptAsyncReservation } from "../shared/prompt-async-gate"

export const BACKGROUND_COMPLETION_TEARDOWN_ABORT_SOURCE = "background-agent.completion-teardown"
export const BACKGROUND_QUOTA_WATCHDOG_ABORT_SOURCE = "background-agent.quota-watchdog"
export const INTERNAL_ABORT_RESUME_BUDGET = 2
export const INTERNAL_ABORT_RESUME_BUDGET_EXHAUSTED_MESSAGE = `resume budget exhausted (${INTERNAL_ABORT_RESUME_BUDGET}) — internal interruptions kept recurring`

const INTERNAL_ABORT_SOURCES: ReadonlySet<string> = new Set([
  "session.status.retry-signal",
  "message.updated.retry-signal",
  "message.updated.quota-fallback",
  "session.timeout",
  BACKGROUND_COMPLETION_TEARDOWN_ABORT_SOURCE,
  BACKGROUND_QUOTA_WATCHDOG_ABORT_SOURCE,
])

const INTERNAL_ABORT_RESUME_BUDGET_SOURCES: ReadonlySet<string> = new Set([
  BACKGROUND_COMPLETION_TEARDOWN_ABORT_SOURCE,
  BACKGROUND_QUOTA_WATCHDOG_ABORT_SOURCE,
])

function isResumeBudgetedInternalAbortSource(source: string | undefined): boolean {
  return source !== undefined && INTERNAL_ABORT_RESUME_BUDGET_SOURCES.has(source)
}

export function recordInternalAbortRedispatch(
  registry: InternalAbortSessionRegistry,
  sessionID: string,
): number | undefined {
  if (!isResumeBudgetedInternalAbortSource(registry.internalAbortSources.get(sessionID))) {
    return undefined
  }

  const nextAttempt = (registry.internalAbortResumeAttempts.get(sessionID) ?? 0) + 1
  registry.internalAbortResumeAttempts.set(sessionID, nextAttempt)
  registry.sessionLastAccess.set(sessionID, Date.now())
  return nextAttempt
}

export function resetInternalAbortResumeBudget(
  registry: InternalAbortSessionRegistry,
  sessionID: string,
): void {
  registry.internalAbortSources.delete(sessionID)
  registry.internalAbortResumeAttempts.delete(sessionID)
  registry.internalAbortBudgetExhaustedMessages.delete(sessionID)
}

export function getInternalAbortResumeBudgetExhaustedMessage(
  registry: InternalAbortSessionRegistry,
  sessionID: string,
): string | undefined {
  return registry.internalAbortBudgetExhaustedMessages.get(sessionID)
}

export function markInternalAbortSession(
  registry: InternalAbortSessionRegistry,
  sessionID: string,
  source: string,
): boolean {
  if (!INTERNAL_ABORT_SOURCES.has(source)) return false

  registry.sessionLastAccess.set(sessionID, Date.now())
  registry.internalAbortSources.set(sessionID, source)
  registry.internalAbortBudgetExhaustedMessages.delete(sessionID)

  if (
    isResumeBudgetedInternalAbortSource(source) &&
    (registry.internalAbortResumeAttempts.get(sessionID) ?? 0) >= INTERNAL_ABORT_RESUME_BUDGET
  ) {
    registry.internallyAbortedSessions.delete(sessionID)
    registry.internalAbortBudgetExhaustedMessages.set(
      sessionID,
      INTERNAL_ABORT_RESUME_BUDGET_EXHAUSTED_MESSAGE,
    )
    return false
  }

  registry.internallyAbortedSessions.add(sessionID)
  return true
}

export function createAbortSessionRequest(deps: HookDeps) {
  const { ctx } = deps

  return async (sessionID: string, source: string): Promise<void> => {
    markInternalAbortSession(deps, sessionID, source)
    try {
      await ctx.client.session.abort({ path: { id: sessionID } })
      releasePromptAsyncReservation(sessionID, `runtime-fallback-abort:${source}`, {
        reservedBy: `runtime-fallback:${source}`,
        reservedByPrefix: "runtime-fallback:",
        supersedeTransientRetryOwners: true,
      })
      log(`[${HOOK_NAME}] Aborted in-flight session request (${source})`, { sessionID })
    } catch (error) {
      if (!(error instanceof Error)) {
        log(`[${HOOK_NAME}] Failed to abort in-flight session request (${source})`, {
          sessionID,
          error: String(error),
        })
        return
      }
      log(`[${HOOK_NAME}] Failed to abort in-flight session request (${source})`, {
        sessionID,
        error: String(error),
      })
    }
  }
}
