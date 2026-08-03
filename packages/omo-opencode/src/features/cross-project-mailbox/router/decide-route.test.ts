import { describe, expect, it } from "bun:test"

import { SenderConfigSchema } from "../config"
import type { SenderConfig } from "../config"
import { MAILBOX_INTENTS, MAILBOX_MODES } from "../envelope/schema"
import type { MailboxMessage, MailboxMode } from "../envelope/schema"
import { decideRoute } from "./decide-route"
import type { RouteContext, RouteDecision, RouteLane, RoutePresence } from "./types"

type Intent = MailboxMessage["intent"]
type Ceiling = "question" | "impl" | "plan"
type AllowlistShape = "absent" | "present-including" | "present-excluding"
type CategoryShape = "absent" | "present"

interface InFlightState {
  readonly label: string
  readonly value: boolean | undefined
}

const PRESENCES: readonly RoutePresence[] = ["live", "none"]
const CEILINGS: readonly Ceiling[] = ["question", "impl", "plan"]
const ALLOWLIST_SHAPES: readonly AllowlistShape[] = ["absent", "present-including", "present-excluding"]
const CATEGORY_SHAPES: readonly CategoryShape[] = ["absent", "present"]
const IN_FLIGHT_STATES: readonly InFlightState[] = [
  { label: "omitted", value: undefined },
  { label: "false", value: false },
  { label: "true", value: true },
]

const TIER_RANK: Record<Ceiling, number> = { question: 0, impl: 1, plan: 2 }
const MODE_TIER_ORACLE: Record<MailboxMode, Ceiling> = {
  answer: "question",
  "todo-append": "impl",
  "todo-next": "impl",
  subagent: "impl",
  "worker-pr": "plan",
  interrupt: "plan",
}
const MODE_LANE_ORACLE: Record<Exclude<MailboxMode, "answer" | "worker-pr">, RouteLane> = {
  "todo-append": "todo-append",
  "todo-next": "todo-next",
  subagent: "subagent",
  interrupt: "interrupt",
}

function assertNever(value: never): never {
  throw new Error(`unhandled value: ${value}`)
}

function hasCategory(shape: CategoryShape): boolean {
  switch (shape) {
    case "absent":
      return false
    case "present":
      return true
    default:
      return assertNever(shape)
  }
}

function legacyLane(intent: Intent, shape: CategoryShape): RouteLane {
  switch (intent) {
    case "question":
    case "plan":
      return "triage"
    case "quick":
    case "impl":
    case "review":
    case "work-loop":
      return hasCategory(shape) ? "triage" : "classify"
    default:
      return assertNever(intent)
  }
}

function makeContext(presence: RoutePresence, inFlight: InFlightState): RouteContext {
  if (inFlight.value === undefined) {
    return { presence }
  }
  return { presence, inFlightLocalFlag: inFlight.value }
}

function makeNote(intent: Intent, shape: CategoryShape, mode?: MailboxMode): Parameters<typeof decideRoute>[0] {
  return {
    ...(mode === undefined ? {} : { requested_mode: mode }),
    ...(hasCategory(shape) ? { category: "quick" } : {}),
    intent,
  }
}

function makeSenderCfg(ceiling: Ceiling, mode: MailboxMode, shape: AllowlistShape): SenderConfig {
  if (shape === "absent") {
    return SenderConfigSchema.parse({ access: "allow", intent_budget: ceiling })
  }
  if (shape === "present-including") {
    return SenderConfigSchema.parse({ access: "allow", intent_budget: ceiling, allowed_modes: [mode] })
  }
  return SenderConfigSchema.parse({
    access: "allow",
    intent_budget: ceiling,
    allowed_modes: MAILBOX_MODES.filter((candidate) => candidate !== mode),
  })
}

function downgradeReason(mode: MailboxMode, ceiling: Ceiling, shape: AllowlistShape): string | undefined {
  if (TIER_RANK[MODE_TIER_ORACLE[mode]] > TIER_RANK[ceiling]) {
    return "mode-over-budget"
  }
  if (shape === "present-excluding") {
    return "mode-not-allowed"
  }
  return undefined
}

function expectedKeptDecision(mode: MailboxMode, intent: Intent, ctx: RouteContext): RouteDecision {
  switch (mode) {
    case "answer":
      if (ctx.presence === "live") {
        return { lane: "answer-local", effectiveMode: "answer" }
      }
      if (ctx.inFlightLocalFlag === true && intent === "question") {
        return { lane: "triage", downgradeReason: "remote-unsafe-for-in-flight" }
      }
      return { lane: "answer-remote", effectiveMode: "answer" }
    case "worker-pr":
      return { lane: "worker-pr-local", effectiveMode: "worker-pr" }
    case "todo-append":
    case "todo-next":
    case "subagent":
    case "interrupt":
      return { lane: MODE_LANE_ORACLE[mode], effectiveMode: mode }
    default:
      return assertNever(mode)
  }
}

describe("decideRoute", () => {
  describe("#given every requested-mode routing cell", () => {
    it("#then maps the full mode x presence x in-flight x budget x allowlist x intent x category matrix", () => {
      // given
      let covered = 0

      for (const mode of MAILBOX_MODES) {
        for (const presence of PRESENCES) {
          for (const inFlight of IN_FLIGHT_STATES) {
            for (const ceiling of CEILINGS) {
              for (const allowlistShape of ALLOWLIST_SHAPES) {
                for (const intent of MAILBOX_INTENTS) {
                  for (const categoryShape of CATEGORY_SHAPES) {
                    const ctx = makeContext(presence, inFlight)
                    const reason = downgradeReason(mode, ceiling, allowlistShape)
                    const expected =
                      reason === undefined
                        ? expectedKeptDecision(mode, intent, ctx)
                        : { lane: legacyLane(intent, categoryShape), downgradeReason: reason }

                    // when
                    const result = decideRoute(makeNote(intent, categoryShape, mode), makeSenderCfg(ceiling, mode, allowlistShape), ctx)

                    // then
                    expect(result).toEqual(expected)
                    covered += 1
                  }
                }
              }
            }
          }
        }
      }

      expect(covered).toBe(6 * 2 * 3 * 3 * 3 * 6 * 2)
    })
  })

  describe("#given every legacy no-mode routing cell", () => {
    it("#then uses only intent/category ambiguity and ignores presence, in-flight, budget, and allowlist", () => {
      // given
      let covered = 0

      for (const presence of PRESENCES) {
        for (const inFlight of IN_FLIGHT_STATES) {
          for (const ceiling of CEILINGS) {
            for (const allowlistShape of ALLOWLIST_SHAPES) {
              for (const intent of MAILBOX_INTENTS) {
                for (const categoryShape of CATEGORY_SHAPES) {
                  const ctx = makeContext(presence, inFlight)
                  const expected: RouteDecision = { lane: legacyLane(intent, categoryShape) }

                  // when
                  const result = decideRoute(makeNote(intent, categoryShape), makeSenderCfg(ceiling, "answer", allowlistShape), ctx)

                  // then
                  expect(result).toEqual(expected)
                  covered += 1
                }
              }
            }
          }
        }
      }

      expect(covered).toBe(2 * 3 * 3 * 3 * 6 * 2)
    })
  })
})
