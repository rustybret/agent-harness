import { describe, expect, it } from "bun:test"

import type { CrossProjectMailboxConfig } from "../config"
import { evaluateConfigDrainGate, evaluateDrainGate } from "./evaluate"

function makeConfig(overrides: Partial<CrossProjectMailboxConfig> = {}): CrossProjectMailboxConfig {
  return {
    enabled: true,
    intake_eligible_agents: ["sisyphus", "atlas"],
    interrupt_policy: "idle-drain",
    default_sender_access: "allow-all",
    senders: {},
    bounds: {
      max_hops: 4,
      max_notes_per_drain: 5,
      same_pair_rate_limit_per_min: 6,
      body_digest_ttl_min: 60,
      max_body_bytes: 32768,
      reservation_ttl_ms: 120000,
    },
    ...overrides,
  }
}

describe("evaluateDrainGate", () => {
  describe("#given an eligible primary and an enabled mailbox", () => {
    it("#then the drain is allowed", () => {
      // given
      const config = makeConfig()

      // when
      const verdict = evaluateDrainGate(config, "sisyphus")

      // then
      expect(verdict.allowed).toBe(true)
    })
  })

  describe("#given the mailbox is disabled", () => {
    it("#then it blocks with reason disabled, even for an otherwise eligible primary", () => {
      // given
      const config = makeConfig({ enabled: false })

      // when
      const verdict = evaluateDrainGate(config, "sisyphus")

      // then
      expect(verdict.allowed).toBe(false)
      if (verdict.allowed) throw new Error("unreachable")
      expect(verdict.reason).toBe("disabled")
      expect(verdict.detail).toContain("enabled is false")
    })
  })

  describe("#given default_sender_access is allow-none and no sender is explicitly allowed", () => {
    it("#then it blocks with reason permissionless-config", () => {
      // given
      const config = makeConfig({
        default_sender_access: "allow-none",
        senders: { "some-id": { access: "deny", intent_budget: "question" } },
      })

      // when
      const verdict = evaluateDrainGate(config, "sisyphus")

      // then
      expect(verdict.allowed).toBe(false)
      if (verdict.allowed) throw new Error("unreachable")
      expect(verdict.reason).toBe("permissionless-config")
    })
  })

  describe("#given default_sender_access is allow-none but one sender is explicitly allowed", () => {
    it("#then the drain is allowed, because that sender's notes are deliverable", () => {
      // given
      const config = makeConfig({
        default_sender_access: "allow-none",
        senders: { "some-id": { access: "allow", intent_budget: "impl" } },
      })

      // when
      const verdict = evaluateDrainGate(config, "sisyphus")

      // then
      expect(verdict.allowed).toBe(true)
    })
  })

  describe("#given the active primary is not in intake_eligible_agents", () => {
    it("#then it blocks naming the active agent, the eligible set, and the manual escape hatch", () => {
      // given
      const config = makeConfig()

      // when
      const verdict = evaluateDrainGate(config, "prometheus")

      // then
      expect(verdict.allowed).toBe(false)
      if (verdict.allowed) throw new Error("unreachable")
      expect(verdict.reason).toBe("primary-not-eligible")
      expect(verdict.activePrimary).toBe("prometheus")
      expect(verdict.detail).toContain("prometheus")
      expect(verdict.detail).toContain("sisyphus, atlas")
      expect(verdict.detail).toContain("project_mailbox_drain")
    })
  })

  describe("#given no active primary is recorded for the session", () => {
    it("#then it fails closed and says intake is held closed", () => {
      // given
      const config = makeConfig()

      // when
      const verdict = evaluateDrainGate(config, undefined)

      // then
      expect(verdict.allowed).toBe(false)
      if (verdict.allowed) throw new Error("unreachable")
      expect(verdict.reason).toBe("primary-not-eligible")
      expect(verdict.activePrimary).toBeUndefined()
      expect(verdict.detail).toContain("No active primary agent")
    })
  })

  describe("#given an eligible-looking primary that is not actually in the eligible list", () => {
    it("#then it still blocks, so no sentinel value can slip past the gate", () => {
      // given
      const config = makeConfig()

      // when
      const verdict = evaluateDrainGate(config, "__probe__")

      // then
      expect(verdict.allowed).toBe(false)
    })
  })

  describe("#given both the mailbox is disabled and the primary is ineligible", () => {
    it("#then disabled wins, so the operator is shown the outermost cause first", () => {
      // given
      const config = makeConfig({ enabled: false })

      // when
      const verdict = evaluateDrainGate(config, "prometheus")

      // then
      expect(verdict.allowed).toBe(false)
      if (verdict.allowed) throw new Error("unreachable")
      expect(verdict.reason).toBe("disabled")
    })
  })
})

describe("evaluateConfigDrainGate", () => {
  describe("#given an enabled mailbox with a permissive sender policy", () => {
    it("#then it allows, deferring the primary check to the caller", () => {
      // given
      const config = makeConfig()

      // when
      const verdict = evaluateConfigDrainGate(config)

      // then
      expect(verdict.allowed).toBe(true)
    })
  })

  describe("#given a config-level block", () => {
    it("#then it returns the same verdict the full gate would, without needing a primary", () => {
      // given
      const config = makeConfig({ enabled: false })

      // when
      const configOnly = evaluateConfigDrainGate(config)
      const full = evaluateDrainGate(config, "sisyphus")

      // then
      expect(configOnly).toEqual(full)
    })
  })
})
