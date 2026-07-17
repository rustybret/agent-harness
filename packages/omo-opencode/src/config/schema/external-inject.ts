import { z } from "zod"

/** Per-project rate-limit bucket for external injections. */
export const ExternalInjectRateLimitSchema = z.object({
  /** Max injections per window before 429 (default: 20) */
  max: z.number().int().positive().default(20),
  /** Rate-limit window in milliseconds, floor 1000 (default: 60000) */
  window_ms: z.number().int().min(1000).default(60_000),
})

/**
 * External-event → active-session injection bridge config.
 *
 * Off by default (fail-closed): the loopback listener only starts when
 * `enabled` is true. A third-party MCP server POSTs to the plugin-hosted
 * loopback listener, which routes through the sanctioned dispatchInternalPrompt
 * gate. See docs / .omo/plans/external-event-session-inject.md.
 */
export const ExternalInjectConfigSchema = z.object({
  /** Master gate for the loopback inject listener (default: false) */
  enabled: z.boolean().default(false),
  /** Permit "active session for this project" addressing when no sessionID is given (default: true) */
  allow_default_active_session: z.boolean().default(true),
  /** Per-injection text-part byte cap; 413 on overflow (default: 8192) */
  max_text_bytes: z.number().int().positive().default(8192),
  /** Per-project token bucket */
  rate_limit: ExternalInjectRateLimitSchema.default({ max: 20, window_ms: 60_000 }),
})

export type ExternalInjectRateLimit = z.infer<typeof ExternalInjectRateLimitSchema>
export type ExternalInjectConfig = z.infer<typeof ExternalInjectConfigSchema>
