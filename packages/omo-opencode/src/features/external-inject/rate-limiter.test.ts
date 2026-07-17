/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { createRateLimiter } from "./rate-limiter"

function fixedClock(start = 1000): { now: () => number; advance: (ms: number) => void } {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe("external-inject rate-limiter", () => {
  describe("#given a token bucket of max 3 / 1000ms", () => {
    it("#then admits up to max within the window", () => {
      // given
      const clock = fixedClock()
      const limiter = createRateLimiter({ max: 3, window_ms: 1000 }, clock.now)
      // when / then
      expect(limiter.tryAcquire()).toBe(true)
      expect(limiter.tryAcquire()).toBe(true)
      expect(limiter.tryAcquire()).toBe(true)
      expect(limiter.tryAcquire()).toBe(false)
    })

    it("#then refills after the window elapses", () => {
      const clock = fixedClock()
      const limiter = createRateLimiter({ max: 3, window_ms: 1000 }, clock.now)
      limiter.tryAcquire()
      limiter.tryAcquire()
      limiter.tryAcquire()
      expect(limiter.tryAcquire()).toBe(false)
      // when
      clock.advance(1001)
      // then
      expect(limiter.tryAcquire()).toBe(true)
    })
  })

  describe("#given the coalescer with a 500ms window", () => {
    it("#then treats an identical key within the window as a duplicate", () => {
      const clock = fixedClock()
      const limiter = createRateLimiter({ max: 100, window_ms: 1000 }, clock.now, 500)
      // when
      const first = limiter.isDuplicate("k1")
      const second = limiter.isDuplicate("k1")
      // then
      expect(first).toBe(false)
      expect(second).toBe(true)
    })

    it("#then a different key is never a duplicate", () => {
      const clock = fixedClock()
      const limiter = createRateLimiter({ max: 100, window_ms: 1000 }, clock.now, 500)
      expect(limiter.isDuplicate("k1")).toBe(false)
      expect(limiter.isDuplicate("k2")).toBe(false)
    })

    it("#then the same key after the dedupe window is not a duplicate", () => {
      const clock = fixedClock()
      const limiter = createRateLimiter({ max: 100, window_ms: 1000 }, clock.now, 500)
      expect(limiter.isDuplicate("k1")).toBe(false)
      clock.advance(501)
      expect(limiter.isDuplicate("k1")).toBe(false)
    })
  })

  describe("#given a burst of identical events", () => {
    it("#then only the first passes the duplicate gate", () => {
      const clock = fixedClock()
      const limiter = createRateLimiter({ max: 100, window_ms: 1000 }, clock.now, 500)
      let passed = 0
      for (let i = 0; i < 5; i += 1) {
        if (!limiter.isDuplicate("same")) passed += 1
      }
      expect(passed).toBe(1)
    })
  })
})
