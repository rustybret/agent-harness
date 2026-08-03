import type { FallbackModelObject } from "./fallback-models"

/**
 * Settings a canonical `models[0]` entry can carry that also exist as top-level
 * agent-override fields. Hoisting these keeps the primary model's settings
 * attached to the agent once the entry is unpacked into `model`.
 */
const HOISTED_PRIMARY_SETTINGS = [
  "reasoning",
  "variant",
  "reasoningEffort",
  "temperature",
  "top_p",
  "maxTokens",
  "thinking",
] as const satisfies readonly (keyof FallbackModelObject)[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Rewrites a canonical agent `models` chain into the `model` + `fallback_models`
 * shape every agent reader already understands.
 *
 * The 2026-08 reasoning-unification migration collapses an agent's `model`,
 * `variant`, and `fallback_models` into one ordered `models` array (matching the
 * category shape). Agent readers were never taught that shape, so a migrated
 * config parsed to an empty override and the user's whole model chain was
 * silently dropped. Normalizing on the way in restores it without touching each
 * reader.
 *
 * An explicit `model` wins over `models[0]`, and an explicit `fallback_models`
 * wins over the chain tail, so a hand-written config is never rewritten.
 */
export function canonicalizeAgentModels(value: unknown): unknown {
  if (!isRecord(value)) return value
  const models = value["models"]
  if (!Array.isArray(models) || models.length === 0) return value

  const { models: _chain, ...rest } = value
  const normalized: Record<string, unknown> = { ...rest }
  const [primary, ...tail] = models

  if (normalized["model"] === undefined) {
    if (typeof primary === "string") {
      normalized["model"] = primary
    } else if (isRecord(primary) && typeof primary["model"] === "string") {
      normalized["model"] = primary["model"]
      for (const key of HOISTED_PRIMARY_SETTINGS) {
        if (normalized[key] === undefined && primary[key] !== undefined) normalized[key] = primary[key]
      }
    }
  }

  if (normalized["fallback_models"] === undefined && tail.length > 0) {
    normalized["fallback_models"] = tail
  }

  return normalized
}
