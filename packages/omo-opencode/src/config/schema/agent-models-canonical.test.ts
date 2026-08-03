import { describe, expect, test } from "bun:test"

import { AgentOverrideConfigSchema, AgentOverridesSchema } from "./agent-overrides"
import { canonicalizeAgentModels } from "./agent-models-canonical"

describe("canonicalizeAgentModels", () => {
  describe("#given an agent config carrying a canonical models chain", () => {
    test("#when canonicalized #then the first entry becomes model and the rest become fallback_models", () => {
      // given
      const input = {
        models: ["anthropic/claude-sonnet-5", "openai/gpt-5.5", "nvidia/minimaxai/minimax-m3"],
      }

      // when
      const result = canonicalizeAgentModels(input)

      // then
      expect(result).toEqual({
        model: "anthropic/claude-sonnet-5",
        fallback_models: ["openai/gpt-5.5", "nvidia/minimaxai/minimax-m3"],
      })
    })

    test("#when the primary entry is an object #then its settings are hoisted onto the agent", () => {
      // given
      const input = {
        models: [
          { model: "google/antigravity-gemini-3.1-pro", reasoning: "high", temperature: 0.3 },
          { model: "openai/gpt-5.5", reasoning: "high" },
        ],
      }

      // when
      const result = canonicalizeAgentModels(input)

      // then
      expect(result).toEqual({
        model: "google/antigravity-gemini-3.1-pro",
        reasoning: "high",
        temperature: 0.3,
        fallback_models: [{ model: "openai/gpt-5.5", reasoning: "high" }],
      })
    })

    test("#when a single-entry chain is given #then no empty fallback_models is produced", () => {
      // given
      const input = { models: ["anthropic/claude-sonnet-5"] }

      // when
      const result = canonicalizeAgentModels(input)

      // then
      expect(result).toEqual({ model: "anthropic/claude-sonnet-5" })
    })
  })

  describe("#given an agent config that already sets model or fallback_models", () => {
    test("#when canonicalized #then the explicit values win over the chain", () => {
      // given
      const input = {
        model: "explicit/primary",
        fallback_models: ["explicit/fallback"],
        models: ["chain/primary", "chain/fallback"],
      }

      // when
      const result = canonicalizeAgentModels(input)

      // then
      expect(result).toEqual({
        model: "explicit/primary",
        fallback_models: ["explicit/fallback"],
      })
    })

    test("#when only model is explicit #then the chain tail still supplies the fallbacks", () => {
      // given
      // `models` documents its first entry as the primary, so an explicit `model` overrides that
      // entry rather than pushing it into the fallback list.
      const input = { model: "explicit/primary", models: ["chain/primary", "chain/fallback"] }

      // when
      const result = canonicalizeAgentModels(input)

      // then
      expect(result).toEqual({
        model: "explicit/primary",
        fallback_models: ["chain/fallback"],
      })
    })
  })

  describe("#given a config with no models chain", () => {
    test("#when canonicalized #then it is returned untouched", () => {
      // given
      const input = { model: "anthropic/claude-sonnet-5", temperature: 0.2 }

      // when
      const result = canonicalizeAgentModels(input)

      // then
      expect(result).toBe(input)
    })

    test("#when the chain is empty #then it is returned untouched", () => {
      // given
      const input = { models: [] }

      // when
      const result = canonicalizeAgentModels(input)

      // then
      expect(result).toBe(input)
    })
  })
})

describe("AgentOverrideConfigSchema canonical models", () => {
  describe("#given a migrated agent override written by the reasoning-unification migration", () => {
    test("#when parsed #then the model chain survives instead of being dropped", () => {
      // given
      const migrated = {
        models: [
          { model: "google/antigravity-gemini-3.1-pro", reasoning: "high" },
          { model: "openai/gpt-5.5", reasoning: "high" },
          "nvidia/minimaxai/minimax-m3",
        ],
      }

      // when
      const result = AgentOverrideConfigSchema.safeParse(migrated)

      // then
      expect(result.success).toBe(true)
      expect(result.success && result.data).toEqual({
        model: "google/antigravity-gemini-3.1-pro",
        reasoning: "high",
        fallback_models: [{ model: "openai/gpt-5.5", reasoning: "high" }, "nvidia/minimaxai/minimax-m3"],
      })
    })
  })

  describe("#given hephaestus, whose override extends the base shape", () => {
    test("#when parsed #then the chain is unpacked and the extra field is kept", () => {
      // given
      const overrides = {
        hephaestus: {
          allow_non_gpt_model: true,
          models: [{ model: "openai/gpt-5.5", reasoning: "medium" }, "cerebras/gpt-oss-120b"],
        },
      }

      // when
      const result = AgentOverridesSchema.safeParse(overrides)

      // then
      expect(result.success).toBe(true)
      expect(result.success && result.data.hephaestus).toEqual({
        allow_non_gpt_model: true,
        model: "openai/gpt-5.5",
        reasoning: "medium",
        fallback_models: ["cerebras/gpt-oss-120b"],
      })
    })
  })

  describe("#given an agent named only through the catchall", () => {
    test("#when parsed #then its chain is unpacked too", () => {
      // given
      const overrides = { "custom-agent": { models: ["a/primary", "b/fallback"] } }

      // when
      const result = AgentOverridesSchema.safeParse(overrides)

      // then
      expect(result.success).toBe(true)
      expect(result.success && result.data["custom-agent"]).toEqual({
        model: "a/primary",
        fallback_models: ["b/fallback"],
      })
    })
  })
})
