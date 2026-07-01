export const CANONICAL_INTENTS = ["question", "impl", "plan"] as const

export type CanonicalIntent = (typeof CANONICAL_INTENTS)[number]

export const TIER_ORDER: Record<CanonicalIntent, number> = {
  question: 0,
  impl: 1,
  plan: 2,
}

/**
 * Maps all 6 legacy + canonical intent values to the canonical 3-tier value.
 * quick -> impl, review -> plan, work-loop -> plan; the 3 canonical values are identity.
 */
export const LEGACY_INTENT_MAP: Record<string, CanonicalIntent> = {
  question: "question",
  quick: "impl",
  impl: "impl",
  review: "plan",
  "work-loop": "plan",
  plan: "plan",
}

/** Maps the 8 builtin omo task categories to their required tier. */
export const CATEGORY_TIER: Record<string, CanonicalIntent> = {
  quick: "impl",
  "unspecified-low": "impl",
  deep: "plan",
  ultrabrain: "plan",
  "unspecified-high": "plan",
  "visual-engineering": "plan",
  artistry: "plan",
  writing: "plan",
}

/** Maps omo subagent types to their required tier. */
export const AGENT_TIER: Record<string, CanonicalIntent> = {
  explore: "question",
  librarian: "question",
  oracle: "question",
  metis: "question",
  momus: "question",
}

export function canonicalizeLegacyIntent(intent: string): CanonicalIntent | null {
  return LEGACY_INTENT_MAP[intent] ?? null
}

export function requiredTier(categoryOrAgent: string): CanonicalIntent {
  const category = CATEGORY_TIER[categoryOrAgent]
  if (category !== undefined) return category
  const agent = AGENT_TIER[categoryOrAgent]
  if (agent !== undefined) return agent
  const direct = LEGACY_INTENT_MAP[categoryOrAgent]
  if (direct !== undefined) return direct
  throw new Error(`Unknown category/agent/intent: "${categoryOrAgent}"`)
}

export function withinBudget(requiredIntent: CanonicalIntent, grantedCeiling: CanonicalIntent): boolean {
  return TIER_ORDER[requiredIntent] <= TIER_ORDER[grantedCeiling]
}
