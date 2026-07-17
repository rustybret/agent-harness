/** A live session for this project, tracked via the plugin `event` hook. */
export interface LiveSession {
  readonly id: string
  readonly lastActiveAt: number
}

export interface ResolveTargetRequest {
  readonly sessionID?: string
}

export interface ResolveTargetContext {
  readonly liveSessions: readonly LiveSession[]
  readonly allowDefaultActiveSession: boolean
}

export type ResolveTargetResult =
  | { readonly ok: true; readonly sessionID: string }
  | { readonly ok: false; readonly reason: "no-active-session" | "unknown-session" | "default-addressing-disabled" }

/**
 * Resolve which session an external inject targets. Fail-closed:
 * - explicit sessionID: must be a known live session for THIS project
 * - no sessionID: the most-recently-active live session, if default addressing
 *   is allowed and any session is live.
 * The caller only ever sees sessions for the project whose port file it read,
 * so this is inherently project-scoped.
 */
export function resolveTargetSession(
  request: ResolveTargetRequest,
  context: ResolveTargetContext,
): ResolveTargetResult {
  if (request.sessionID !== undefined) {
    const known = context.liveSessions.some((session) => session.id === request.sessionID)
    return known
      ? { ok: true, sessionID: request.sessionID }
      : { ok: false, reason: "unknown-session" }
  }

  if (!context.allowDefaultActiveSession) {
    return { ok: false, reason: "default-addressing-disabled" }
  }

  const mostRecent = context.liveSessions.reduce<LiveSession | undefined>((best, session) => {
    if (!best || session.lastActiveAt > best.lastActiveAt) return session
    return best
  }, undefined)

  return mostRecent
    ? { ok: true, sessionID: mostRecent.id }
    : { ok: false, reason: "no-active-session" }
}
