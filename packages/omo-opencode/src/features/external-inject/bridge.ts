import type { ExternalInjectConfig } from "../../config/schema/external-inject"
import type {
  InternalPromptDispatchArgs,
  InternalPromptDispatchResult,
} from "../../shared/prompt-async-gate"
import type { MailboxDrainNowResult } from "./handler"
import { createInjectAdapter } from "./inject-adapter"
import {
  newInstanceId,
  newToken,
  portFileDir,
  removePortFile,
  sweepDeadPortFiles,
  writePortFile,
} from "./port-file"
import { createRateLimiter, type RateLimiter } from "./rate-limiter"
import { resolveTargetSession } from "./session-resolver"
import { createSessionTracker, type SessionTracker } from "./session-tracker"
import { createRequestRouter } from "./handler"
import { startLoopbackServer, type InjectResponse, type LoopbackServer } from "./transport"

type AsyncDispatchArgs = Extract<InternalPromptDispatchArgs, { mode: "async" }>
type DispatchClient = AsyncDispatchArgs["client"]

export interface ExternalInjectBridgeDeps {
  readonly config: ExternalInjectConfig
  readonly client: DispatchClient
  readonly directory: string
  readonly dispatchInternalPrompt: (
    args: InternalPromptDispatchArgs,
  ) => Promise<InternalPromptDispatchResult>
  readonly runMailboxDrainNow?: () => Promise<MailboxDrainNowResult>
}

export interface ExternalInjectBridge {
  readonly port: number
  readonly tracker: SessionTracker
  stop(): void
}

function mapResolveFailure(reason: string): InjectResponse {
  if (reason === "no-active-session") {
    return { status: 409, body: { status: "no-active-session" } }
  }
  if (reason === "unknown-session") {
    return { status: 409, body: { status: "unknown-session" } }
  }
  return { status: 400, body: { status: reason } }
}

/**
 * Start the external-inject bridge: a loopback listener whose inject handler
 * resolves the target session, rate-limits + coalesces, and routes through the
 * sanctioned prompt-async gate. Returns the bound port + the session tracker
 * (the plugin `event` hook feeds it) + a stop() that tears down the listener
 * and removes the port file.
 */
export async function startExternalInjectBridge(
  deps: ExternalInjectBridgeDeps,
): Promise<ExternalInjectBridge> {
  const tracker = createSessionTracker()
  const rateLimiter: RateLimiter = createRateLimiter(deps.config.rate_limit)
  const adapter = createInjectAdapter({
    client: deps.client,
    directory: deps.directory,
    dispatchInternalPrompt: deps.dispatchInternalPrompt,
  })

  const token = newToken()
  const router = createRequestRouter({
    token,
    maxTextBytes: deps.config.max_text_bytes,
    allowDefaultActiveSession: deps.config.allow_default_active_session,
    rateLimit: deps.config.rate_limit,
    runMailboxDrainNow: deps.runMailboxDrainNow,
    inject: async (payload) => {
      const resolved = resolveTargetSession(
        { sessionID: payload.sessionID },
        {
          liveSessions: tracker.liveSessions(),
          allowDefaultActiveSession: deps.config.allow_default_active_session,
        },
      )
      if (!resolved.ok) return mapResolveFailure(resolved.reason)
      if (rateLimiter.isDuplicate(`${resolved.sessionID}:${payload.text}`)) {
        return { status: 202, body: { status: "coalesced" } }
      }
      if (!rateLimiter.tryAcquire()) {
        return { status: 429, body: { status: "rate-limited" } }
      }
      return adapter.inject(resolved.sessionID, payload.text)
    },
  })

  const server: LoopbackServer = await startLoopbackServer(router)

  const dir = portFileDir(deps.directory)
  const instanceId = newInstanceId()
  const filePath = writePortFile(dir, instanceId, {
    port: server.port,
    token,
    pid: process.pid,
    started_at: Date.now(),
  })
  sweepDeadPortFiles(dir, filePath)

  return {
    port: server.port,
    tracker,
    stop: (): void => {
      server.stop()
      removePortFile(filePath)
    },
  }
}
