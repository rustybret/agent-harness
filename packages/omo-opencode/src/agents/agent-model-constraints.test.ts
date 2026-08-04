import { describe, expect, it } from "bun:test"

import {
  AGENT_MODEL_CONSTRAINTS,
  findAgentModelConstraint,
  findUnsupportedAgentModel,
} from "./agent-model-constraints"

describe("findUnsupportedAgentModel", () => {
  describe("#given an agent with no hard model constraint", () => {
    it("#when asked about any model #then reports nothing to surface", () => {
      // given
      const agent = "oracle"

      // when
      const unsupported = findUnsupportedAgentModel({ agent, model: "anthropic/claude-opus-5" })

      // then
      expect(unsupported).toBeUndefined()
    })
  })

  describe("#given hephaestus, which refuses non-GPT-5.x models", () => {
    it("#when the model satisfies the constraint #then reports nothing", () => {
      // given
      const model = "openai/gpt-5.6-sol"

      // when
      const unsupported = findUnsupportedAgentModel({ agent: "hephaestus", model })

      // then
      expect(unsupported).toBeUndefined()
    })

    it("#when the model is refused #then reports the constraint so a caller can surface it", () => {
      // given
      const model = "anthropic/claude-opus-5"

      // when
      const unsupported = findUnsupportedAgentModel({ agent: "hephaestus", model })

      // then
      expect(unsupported?.agent).toBe("hephaestus")
      expect(unsupported?.requirement).toContain("GPT-5")
    })

    it("#when no model is configured at all #then still reports the constraint", () => {
      // given
      const model = undefined

      // when
      const unsupported = findUnsupportedAgentModel({ agent: "hephaestus", model })

      // then
      expect(unsupported).toBeDefined()
    })
  })

  describe("#given the registry is the single source both doctor and registration read", () => {
    it("#when a constraint is declared #then it exposes a human-readable requirement", () => {
      // given
      const constraints = AGENT_MODEL_CONSTRAINTS

      // when
      const missingRequirement = constraints.filter((entry) => entry.requirement.length === 0)

      // then
      expect(constraints.length).toBeGreaterThan(0)
      expect(missingRequirement).toEqual([])
    })

    it("#when looking up an unknown agent #then returns undefined rather than throwing", () => {
      // given
      const agent = "not-a-real-agent"

      // when
      const constraint = findAgentModelConstraint(agent)

      // then
      expect(constraint).toBeUndefined()
    })
  })
})
