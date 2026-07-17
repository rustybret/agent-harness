import type { LiveSession } from "./session-resolver"

/**
 * In-memory registry of live sessions for this project, fed by the plugin
 * `event` hook (session.created / session.idle / message.updated record
 * activity; session.deleted removes). Read by the session-resolver to pick the
 * "active session for this project" target.
 */
export interface SessionTracker {
  recordActivity(sessionID: string, now?: number): void
  remove(sessionID: string): void
  liveSessions(): LiveSession[]
}

export function createSessionTracker(clock: () => number = Date.now): SessionTracker {
  const lastActive = new Map<string, number>()

  return {
    recordActivity(sessionID: string, now: number = clock()): void {
      if (!sessionID) return
      lastActive.set(sessionID, now)
    },
    remove(sessionID: string): void {
      lastActive.delete(sessionID)
    },
    liveSessions(): LiveSession[] {
      return [...lastActive.entries()].map(([id, lastActiveAt]) => ({ id, lastActiveAt }))
    },
  }
}
