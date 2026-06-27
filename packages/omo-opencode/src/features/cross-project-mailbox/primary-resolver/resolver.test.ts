import { describe, expect, it } from "bun:test"

import { AgentPrimaryCache, resolveActivePrimaryAgent } from "./resolver"

describe("AgentPrimaryCache", () => {
  describe("#given a fresh cache with no observations", () => {
    it("#then resolve returns undefined for an unknown session", () => {
      // given
      const cache = new AgentPrimaryCache()

      // when
      const resolved = cache.resolve("session-xyz")

      // then
      expect(resolved).toBeUndefined()
    })
  })

  describe("#given a cache that observed agent sisyphus for a session", () => {
    it("#then resolve returns the observed agent name", () => {
      // given
      const cache = new AgentPrimaryCache()
      cache.observe("session-xyz", "sisyphus")

      // when
      const resolved = cache.resolve("session-xyz")

      // then
      expect(resolved).toBe("sisyphus")
    })
  })

  describe("#given a cache that observed sisyphus then hephaestus for the same session", () => {
    it("#then resolve returns the last-known agent (hephaestus)", () => {
      // given
      const cache = new AgentPrimaryCache()
      cache.observe("session-xyz", "sisyphus")
      cache.observe("session-xyz", "hephaestus")

      // when
      const resolved = cache.resolve("session-xyz")

      // then
      expect(resolved).toBe("hephaestus")
    })
  })

  describe("#given an observation for session-a and a resolve for session-b", () => {
    it("#then resolve returns undefined because sessions are isolated", () => {
      // given
      const cache = new AgentPrimaryCache()
      cache.observe("session-a", "sisyphus")

      // when
      const resolved = cache.resolve("session-b")

      // then
      expect(resolved).toBeUndefined()
    })
  })

  describe("#given a session that was observed then cleared", () => {
    it("#then resolve returns undefined after clear", () => {
      // given
      const cache = new AgentPrimaryCache()
      cache.observe("session-xyz", "sisyphus")

      // when
      cache.clear("session-xyz")

      // then
      expect(cache.resolve("session-xyz")).toBeUndefined()
    })
  })
})

describe("resolveActivePrimaryAgent", () => {
  describe("#given the process singleton has not observed a session", () => {
    it("#then resolveActivePrimaryAgent returns undefined", () => {
      // given
      const sessionId = `unobserved-${Math.random().toString(36).slice(2)}`

      // when
      const resolved = resolveActivePrimaryAgent(sessionId)

      // then
      expect(resolved).toBeUndefined()
    })
  })
})
