import { describeErrorForLog, log } from "../shared"
import { normalizeSDKResponse } from "../shared"
import { isCompactionMessage } from "../shared/compaction-marker"

interface SessionMessage {
  info?: {
    agent?: string
    role?: string
  }
  parts?: unknown
}

type SessionClient = {
  session: {
    messages: (opts: { path: { id: string } }) => Promise<{ data?: SessionMessage[] }>
  }
}

/**
 * Resolves the agent a session is running RIGHT NOW.
 *
 * The host returns messages oldest-first, so scanning forward answers a different question: which
 * agent the session STARTED with. A session that switched agents mid-run then reports the agent it
 * has moved on from, and every caller comparing that against an allowlist decides on stale data.
 * Walking backwards answers the question the callers actually ask.
 *
 * Compaction messages are skipped because the host attributes them to a synthetic "compaction"
 * agent; treating that as the active agent would report a housekeeping step as the operator.
 */
export async function resolveSessionAgent(
  client: SessionClient,
  sessionId: string,
): Promise<string | undefined> {
  try {
    const messagesResp = await client.session.messages({ path: { id: sessionId } })
    const messages = normalizeSDKResponse(messagesResp, [] as SessionMessage[])

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const msg = messages[index]
      if (msg === undefined || isCompactionMessage(msg)) continue
      if (msg.info?.agent) {
        return msg.info.agent
      }
    }
  } catch (error) {
    log("[session-agent-resolver] Failed to resolve agent from session", {
      sessionId,
      error: describeErrorForLog(error),
    })
  }
  return undefined
}
