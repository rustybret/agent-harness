import type { InjectRequest, InjectResponse } from "./transport"
import { tokensMatch } from "./transport"

export const BRIDGE_VERSION = 1

export interface InjectPayload {
  readonly text: string
  readonly sessionID?: string
}

export interface DescribeCapabilities {
  readonly version: number
  readonly methods: readonly string[]
  readonly addressing_modes: readonly string[]
  readonly max_text_bytes: number
  readonly rate_limit: { readonly max: number; readonly window_ms: number }
}

export interface HandlerDeps {
  readonly token: string
  readonly maxTextBytes: number
  readonly allowDefaultActiveSession: boolean
  readonly rateLimit: { readonly max: number; readonly window_ms: number }
  /** Perform the injection; returns the HTTP status + body to relay. */
  readonly inject: (payload: InjectPayload) => Promise<InjectResponse>
}

function describe(deps: HandlerDeps): InjectResponse {
  const addressingModes = deps.allowDefaultActiveSession
    ? ["active-session", "explicit-session-id"]
    : ["explicit-session-id"]
  const capabilities: DescribeCapabilities = {
    version: BRIDGE_VERSION,
    methods: ["inject", "describe"],
    addressing_modes: addressingModes,
    max_text_bytes: deps.maxTextBytes,
    rate_limit: { max: deps.rateLimit.max, window_ms: deps.rateLimit.window_ms },
  }
  return { status: 200, body: capabilities }
}

function parseInjectPayload(body: Record<string, unknown>): InjectPayload | null {
  const text = body.text
  if (typeof text !== "string" || text.length === 0) return null
  const sessionID = typeof body.sessionID === "string" && body.sessionID.length > 0 ? body.sessionID : undefined
  return { text, sessionID }
}

/**
 * Route + authenticate an external-inject RPC request. Token is checked
 * (constant-time) for every /rpc/ method. `inject` enforces the text-byte cap
 * before delegating to the injection adapter; `describe` returns live caps.
 */
export function createRequestRouter(deps: HandlerDeps): (req: InjectRequest) => Promise<InjectResponse> {
  return async (req: InjectRequest): Promise<InjectResponse> => {
    const presented = typeof req.body.token === "string" ? req.body.token : ""
    if (!tokensMatch(presented, deps.token)) {
      return { status: 403, body: { error: "Forbidden" } }
    }

    if (req.method === "describe") {
      return describe(deps)
    }

    if (req.method === "inject") {
      const payload = parseInjectPayload(req.body)
      if (!payload) {
        return { status: 400, body: { error: "Missing or empty 'text'" } }
      }
      if (Buffer.byteLength(payload.text, "utf8") > deps.maxTextBytes) {
        return { status: 413, body: { error: "text exceeds max_text_bytes" } }
      }
      return deps.inject(payload)
    }

    return { status: 404, body: { error: `Unknown method: ${req.method}` } }
  }
}
