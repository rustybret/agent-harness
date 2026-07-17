/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { ExternalInjectConfigSchema } from "./external-inject"

describe("ExternalInjectConfigSchema", () => {
  describe("#given an empty object", () => {
    it("#then defaults enabled to false (fail-closed)", () => {
      // when
      const parsed = ExternalInjectConfigSchema.parse({})
      // then
      expect(parsed.enabled).toBe(false)
    })

    it("#then defaults allow_default_active_session to true", () => {
      const parsed = ExternalInjectConfigSchema.parse({})
      expect(parsed.allow_default_active_session).toBe(true)
    })

    it("#then defaults max_text_bytes to 8192", () => {
      const parsed = ExternalInjectConfigSchema.parse({})
      expect(parsed.max_text_bytes).toBe(8192)
    })

    it("#then defaults rate_limit to 20 per 60000ms", () => {
      const parsed = ExternalInjectConfigSchema.parse({})
      expect(parsed.rate_limit.max).toBe(20)
      expect(parsed.rate_limit.window_ms).toBe(60_000)
    })
  })

  describe("#given explicit overrides", () => {
    it("#then honors enabled true", () => {
      const parsed = ExternalInjectConfigSchema.parse({ enabled: true })
      expect(parsed.enabled).toBe(true)
    })

    it("#then honors custom max_text_bytes and rate_limit", () => {
      const parsed = ExternalInjectConfigSchema.parse({
        max_text_bytes: 4096,
        rate_limit: { max: 5, window_ms: 10_000 },
      })
      expect(parsed.max_text_bytes).toBe(4096)
      expect(parsed.rate_limit.max).toBe(5)
      expect(parsed.rate_limit.window_ms).toBe(10_000)
    })
  })

  describe("#given invalid values", () => {
    it("#then rejects a non-positive max_text_bytes", () => {
      // when / then
      expect(() => ExternalInjectConfigSchema.parse({ max_text_bytes: 0 })).toThrow()
    })

    it("#then rejects a non-positive rate_limit.max", () => {
      expect(() => ExternalInjectConfigSchema.parse({ rate_limit: { max: 0, window_ms: 1000 } })).toThrow()
    })

    it("#then rejects a rate_limit.window_ms below 1000", () => {
      expect(() => ExternalInjectConfigSchema.parse({ rate_limit: { max: 1, window_ms: 500 } })).toThrow()
    })
  })

  describe("#given the config is wired into the root schema", () => {
    it("#then external_inject is an optional field on OhMyOpenCodeConfigSchema", async () => {
      // given
      const { OhMyOpenCodeConfigSchema } = await import("./oh-my-opencode-config")
      // when
      const parsed = OhMyOpenCodeConfigSchema.parse({ external_inject: { enabled: true } })
      // then
      expect(parsed.external_inject?.enabled).toBe(true)
    })
  })
})
