import { afterEach, describe, expect, it } from "bun:test"

import {
  _resetForTesting,
  updateSessionAgent,
} from "../../claude-code-session-state/state"
import { resolveActivePrimaryAgent } from "./resolver"

const ELIGIBLE = ["sisyphus"] as const

function isEligiblePrimary(primary: string | undefined): boolean {
  return primary !== undefined && ELIGIBLE.includes(primary as (typeof ELIGIBLE)[number])
}

describe("resolveActivePrimaryAgent", () => {
  afterEach(() => {
    _resetForTesting()
  })

  describe("#given no session agent recorded for the session", () => {
    it("#then it resolves to undefined and is not drain-eligible", () => {
      // given
      const sessionId = `unrecorded-${Math.random().toString(36).slice(2)}`

      // when
      const resolved = resolveActivePrimaryAgent(sessionId)

      // then
      expect(resolved).toBeUndefined()
      expect(isEligiblePrimary(resolved)).toBe(false)
    })
  })

  describe("#given the live store recorded a legacy display name for the session", () => {
    it("#then it canonicalizes to the config key and is drain-eligible", () => {
      // given
      const sessionId = `sid-${Math.random().toString(36).slice(2)}`
      updateSessionAgent(sessionId, "Sisyphus (Ultraworker)")

      // when
      const resolved = resolveActivePrimaryAgent(sessionId)

      // then
      expect(resolved).toBe("sisyphus")
      expect(isEligiblePrimary(resolved)).toBe(true)
    })
  })

  describe("#given the live store recorded a non-eligible agent for the session", () => {
    it("#then the config key is returned but drain is gated (false)", () => {
      // given
      const sessionId = `sid-${Math.random().toString(36).slice(2)}`
      updateSessionAgent(sessionId, "hephaestus")

      // when
      const resolved = resolveActivePrimaryAgent(sessionId)

      // then
      expect(resolved).toBe("hephaestus")
      expect(isEligiblePrimary(resolved)).toBe(false)
    })
  })
})
