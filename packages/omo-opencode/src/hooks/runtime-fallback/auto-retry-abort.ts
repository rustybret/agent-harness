import type { HookDeps } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { releasePromptAsyncReservation } from "../shared/prompt-async-gate"

export const BACKGROUND_COMPLETION_TEARDOWN_ABORT_SOURCE = "background-agent.completion-teardown"
export const BACKGROUND_QUOTA_WATCHDOG_ABORT_SOURCE = "background-agent.quota-watchdog"

const INTERNAL_ABORT_SOURCES: ReadonlySet<string> = new Set([
  "session.status.retry-signal",
  "message.updated.retry-signal",
  "message.updated.quota-fallback",
  "session.timeout",
  BACKGROUND_COMPLETION_TEARDOWN_ABORT_SOURCE,
  BACKGROUND_QUOTA_WATCHDOG_ABORT_SOURCE,
])

let activeInternallyAbortedSessions: Set<string> | undefined
let activeSessionLastAccess: Map<string, number> | undefined

export function markInternalAbortSession(sessionID: string, source: string): boolean {
  if (!INTERNAL_ABORT_SOURCES.has(source)) return false
  if (!activeInternallyAbortedSessions || !activeSessionLastAccess) return false

  activeInternallyAbortedSessions.add(sessionID)
  activeSessionLastAccess.set(sessionID, Date.now())
  return true
}

export function createAbortSessionRequest(deps: HookDeps) {
  const { ctx } = deps
  activeInternallyAbortedSessions = deps.internallyAbortedSessions
  activeSessionLastAccess = deps.sessionLastAccess

  return async (sessionID: string, source: string): Promise<void> => {
    markInternalAbortSession(sessionID, source)
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
