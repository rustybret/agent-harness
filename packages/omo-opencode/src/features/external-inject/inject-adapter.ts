import { createHash } from "node:crypto"

import {
  isInternalPromptDispatchAccepted,
} from "../../shared/prompt-async-gate"
import type {
  InternalPromptDispatchArgs,
  InternalPromptDispatchResult,
} from "../../shared/prompt-async-gate"
import type { InjectResponse } from "./transport"

export const EXTERNAL_INJECT_SOURCE = "external-inject"

type AsyncDispatchArgs = Extract<InternalPromptDispatchArgs, { mode: "async" }>
type DispatchClient = AsyncDispatchArgs["client"]

export interface InjectAdapterDeps {
  readonly client: DispatchClient
  readonly directory: string
  readonly dispatchInternalPrompt: (
    args: InternalPromptDispatchArgs,
  ) => Promise<InternalPromptDispatchResult>
}

export interface InjectAdapter {
  inject(sessionID: string, text: string): Promise<InjectResponse>
}

/** Stable coalesce key so a chatty watcher's repeated identical events collapse. */
function coalesceKey(sessionID: string, text: string): string {
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 16)
  return `${EXTERNAL_INJECT_SOURCE}:${sessionID}:${digest}`
}

/**
 * Maps the prompt-async-gate dispatch result to an HTTP response for the
 * external caller. Accepted (dispatched|queued) -> 202. Reserved (a dispatch is
 * already in flight for this session) -> 429. Everything else (unavailable,
 * failed) -> 503.
 */
function mapDispatchResult(result: InternalPromptDispatchResult): InjectResponse {
  if (isInternalPromptDispatchAccepted(result)) {
    return { status: 202, body: { status: "accepted" } }
  }
  if (result.status === "reserved") {
    return { status: 429, body: { status: "reserved", reservedBy: result.reservedBy } }
  }
  return { status: 503, body: { status: result.status } }
}

/**
 * Wraps the sanctioned dispatchInternalPrompt gate (AGENTS.md #584). All
 * external injections route through this single caller — never a raw
 * session.promptAsync — so reservation/dedupe/hold invariants hold. Uses
 * `defer`: the reminder lands at the session's next idle, not mid-turn.
 */
export function createInjectAdapter(deps: InjectAdapterDeps): InjectAdapter {
  return {
    inject: async (sessionID: string, text: string): Promise<InjectResponse> => {
      // Inline object literal (not a hoisted variable) so the prompt-async
      // route audit (AGENTS.md #584) can statically see queueBehavior on the
      // call. queueBehavior "defer": the reminder lands at next idle, not
      // mid-turn.
      const result = await deps.dispatchInternalPrompt({
        mode: "async",
        client: deps.client,
        sessionID,
        source: EXTERNAL_INJECT_SOURCE,
        dedupeKey: coalesceKey(sessionID, text),
        queueBehavior: "defer",
        input: {
          path: { id: sessionID },
          body: { parts: [{ type: "text", text }] },
          query: { directory: deps.directory },
        },
      })
      return mapDispatchResult(result)
    },
  }
}
