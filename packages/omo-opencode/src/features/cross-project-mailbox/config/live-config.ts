import { validatePluginConfig } from "../../../config/validate"
import { describeErrorForLog, log } from "../../../shared"
import type { CrossProjectMailboxConfig } from "../config"
import { applyMailboxDefault } from "../config-defaults"

const CACHE_TTL_MS = 3_000

export function createLiveMailboxConfigResolver(
  repoRoot: string,
  fallback: CrossProjectMailboxConfig,
  options: {
    readonly validate?: typeof validatePluginConfig
    /**
     * Injected so tests observe reporting without touching the shared logger singleton, which
     * other suites replace at module scope (see .omo/rules and the sidebar's reportError).
     */
    readonly report?: (message: string, data: Record<string, unknown>) => void
  } = {},
): { resolve: () => Promise<CrossProjectMailboxConfig>; invalidate: () => void } {
  const validate = options.validate ?? validatePluginConfig
  const report = options.report ?? log
  let cached: { readonly value: CrossProjectMailboxConfig; readonly expiresAt: number } | undefined
  let inFlight: Promise<CrossProjectMailboxConfig> | undefined
  let generation = 0
  let lastReportedCause: string | undefined

  /**
   * Reports a fallback once per distinct cause.
   *
   * The fallback carries no `senders`, and a missing sender entry is indistinguishable from a
   * denied one at every consumer: the TUI menu renders every project `Disabled`, so an unreadable
   * config looks exactly like a deliberate deny-all. A permission edit then appears to do nothing,
   * because the write lands correctly and the next read falls back again.
   *
   * Deduplicated by cause because this runs behind a 3s cache on a redrawn menu, and the same
   * broken config would otherwise be reported at render rate.
   */
  function reportFallback(cause: string): void {
    if (cause === lastReportedCause) return
    lastReportedCause = cause
    report("[mailbox-live-config] falling back to defaults, sender permissions unavailable", {
      repoRoot,
      cause,
    })
  }

  function readFresh(): CrossProjectMailboxConfig {
    try {
      const read = validate(repoRoot)
      if (!read.valid) {
        reportFallback("config did not validate")
        return fallback
      }
      const resolved = applyMailboxDefault(read.config).cross_project_mailbox
      if (resolved === undefined) {
        reportFallback("config validated but carried no cross_project_mailbox block")
        return fallback
      }
      lastReportedCause = undefined
      return resolved
    } catch (error) {
      reportFallback(`config read threw: ${describeErrorForLog(error)}`)
      return fallback
    }
  }

  function resolve(): Promise<CrossProjectMailboxConfig> {
    const now = Date.now()
    if (cached !== undefined && now < cached.expiresAt) return Promise.resolve(cached.value)
    if (inFlight !== undefined) return inFlight

    const readGeneration = generation
    const flight = Promise.resolve().then(readFresh).then((value) => {
      if (generation === readGeneration) {
        cached = { value, expiresAt: Date.now() + CACHE_TTL_MS }
      }
      return value
    }).finally(() => {
      if (inFlight === flight) inFlight = undefined
    })
    inFlight = flight
    return flight
  }

  function invalidate(): void {
    generation += 1
    cached = undefined
    inFlight = undefined
  }

  return { resolve, invalidate }
}
