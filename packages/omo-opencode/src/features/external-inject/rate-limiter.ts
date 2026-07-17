export interface RateLimitConfig {
  readonly max: number
  readonly window_ms: number
}

export interface RateLimiter {
  /** True if a token was available (and consumed); false when over-limit. */
  tryAcquire(): boolean
  /** True if `key` was already seen within the coalesce window. */
  isDuplicate(key: string): boolean
}

const DEFAULT_DEDUPE_WINDOW_MS = 2000

/**
 * Sliding-window token bucket + short-window coalescer for one project.
 * The bucket admits `max` acquisitions per `window_ms`; the coalescer
 * suppresses an identical key seen again within `dedupeWindowMs`.
 */
export function createRateLimiter(
  config: RateLimitConfig,
  now: () => number = Date.now,
  dedupeWindowMs: number = DEFAULT_DEDUPE_WINDOW_MS,
): RateLimiter {
  const acquisitions: number[] = []
  const seen = new Map<string, number>()

  return {
    tryAcquire(): boolean {
      const cutoff = now() - config.window_ms
      while (acquisitions.length > 0 && acquisitions[0]! <= cutoff) {
        acquisitions.shift()
      }
      if (acquisitions.length >= config.max) return false
      acquisitions.push(now())
      return true
    },

    isDuplicate(key: string): boolean {
      const current = now()
      const last = seen.get(key)
      if (last !== undefined && current - last < dedupeWindowMs) {
        return true
      }
      seen.set(key, current)
      for (const [seenKey, seenAt] of seen) {
        if (current - seenAt >= dedupeWindowMs) seen.delete(seenKey)
      }
      return false
    },
  }
}
