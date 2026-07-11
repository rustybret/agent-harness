import { validatePluginConfig } from "../../../config/validate"
import type { CrossProjectMailboxConfig } from "../config"
import { applyMailboxDefault } from "../config-defaults"

const CACHE_TTL_MS = 3_000

export function createLiveMailboxConfigResolver(
  repoRoot: string,
  fallback: CrossProjectMailboxConfig,
  options: { readonly validate?: typeof validatePluginConfig } = {},
): { resolve: () => Promise<CrossProjectMailboxConfig>; invalidate: () => void } {
  const validate = options.validate ?? validatePluginConfig
  let cached: { readonly value: CrossProjectMailboxConfig; readonly expiresAt: number } | undefined
  let inFlight: Promise<CrossProjectMailboxConfig> | undefined
  let generation = 0

  function readFresh(): CrossProjectMailboxConfig {
    try {
      const read = validate(repoRoot)
      if (!read.valid) return fallback
      return applyMailboxDefault(read.config).cross_project_mailbox ?? fallback
    } catch {
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
