import type { CrossProjectMailboxConfig } from "../config"
import type { ProjectEntry } from "../registry/types"
import type { IntentEnum } from "../validation/types"
import { withinBudget } from "../validation/validate-inbound"
import type { SendInput } from "./envelope-builder"

export type ProjectRegistryEntry = ProjectEntry

export type PreflightReason = "unauthorized" | "over-budget" | "hop-exceeded" | "target-not-found"

export type PreflightResult = { blocked: false } | { blocked: true; reason: PreflightReason }

const LOWEST_CEILING: IntentEnum = "question"

interface SenderDecision {
  allowed: boolean
  ceiling: IntentEnum
}

function resolveSenderDecision(input: SendInput, config: CrossProjectMailboxConfig): SenderDecision {
  const sender = config.senders[input.targetProjectId]
  if (sender !== undefined) {
    return { allowed: sender.access === "allow", ceiling: sender.intent_budget }
  }
  const allowed = config.default_sender_access === "allow-all"
  return { allowed, ceiling: LOWEST_CEILING }
}

export async function runSendPreflight(
  input: SendInput,
  proposedHopCount: number,
  config: CrossProjectMailboxConfig,
  targetEntry: ProjectRegistryEntry | undefined,
): Promise<PreflightResult> {
  if (targetEntry === undefined) {
    return { blocked: true, reason: "target-not-found" }
  }

  const decision = resolveSenderDecision(input, config)
  if (!decision.allowed) {
    return { blocked: true, reason: "unauthorized" }
  }

  if (!withinBudget(input.intent, decision.ceiling)) {
    return { blocked: true, reason: "over-budget" }
  }

  if (proposedHopCount >= config.bounds.max_hops) {
    return { blocked: true, reason: "hop-exceeded" }
  }

  return { blocked: false }
}
