import { describe, expect, it } from "bun:test"

import { describeErrorForLog } from "./describe-error"

describe("describeErrorForLog", () => {
  describe("#given a thrown Error", () => {
    it("#when described #then it reports name and message", () => {
      // given
      const error = new TypeError("client.session.messages is not a function")

      // when
      const described = describeErrorForLog(error)

      // then
      expect(described).toBe("TypeError: client.session.messages is not a function")
    })
  })

  describe("#given a rejection value that is a plain object", () => {
    it("#when described #then the payload survives instead of collapsing to [object Object]", () => {
      // given
      // Observed live: 74 log lines carried error:"[object Object]", reporting that something
      // failed while withholding what. SDK and transport layers reject with shapes like this.
      const rejection = { status: 429, body: { message: "rate limited" } }

      // when
      const described = describeErrorForLog(rejection)

      // then
      expect(described).not.toBe("[object Object]")
      expect(described).toContain("429")
      expect(described).toContain("rate limited")
    })
  })

  describe("#given an object with a meaningful toString", () => {
    it("#when described #then its own rendering is kept", () => {
      // given
      const rejection = {
        toString() {
          return "ProviderError: quota exhausted"
        },
      }

      // when
      const described = describeErrorForLog(rejection)

      // then
      expect(described).toBe("ProviderError: quota exhausted")
    })
  })

  describe("#given a primitive rejection", () => {
    it("#when described #then it is rendered directly", () => {
      // given
      const values: unknown[] = ["boom", 42, null, undefined, false]

      // when
      const described = values.map(describeErrorForLog)

      // then
      expect(described).toEqual(["boom", "42", "null", "undefined", "false"])
    })
  })

  describe("#given an object that cannot be serialized", () => {
    it("#when described #then it degrades rather than throwing", () => {
      // given
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic

      // when
      const described = describeErrorForLog(cyclic)

      // then
      expect(described).toBe("[object Object]")
    })
  })

  describe("#given an oversized payload", () => {
    it("#when described #then it is truncated so one rejection cannot flood the log", () => {
      // given
      const rejection = { body: "x".repeat(5000) }

      // when
      const described = describeErrorForLog(rejection)

      // then
      expect(described.length).toBeLessThanOrEqual(403)
      expect(described.endsWith("...")).toBe(true)
    })
  })
})
