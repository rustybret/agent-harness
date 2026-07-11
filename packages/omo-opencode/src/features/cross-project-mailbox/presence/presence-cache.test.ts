import { afterEach, describe, expect, it, jest, spyOn } from "bun:test"

import { createPresenceCache } from "./presence-cache"
import type { PresenceDetail } from "./presence-reader"

describe("createPresenceCache", () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe("#given concurrent calls for the same projectId", () => {
    it("#then it single-flights them to exactly one underlying readDetail call", async () => {
      // given
      let resolveRead: (detail: PresenceDetail) => void = () => {}
      const readPromise = new Promise<PresenceDetail>((resolve) => {
        resolveRead = resolve
      })
      const readDetail = jest.fn(() => readPromise)
      const cache = createPresenceCache(10_000, { readDetail })

      // when
      const p1 = cache.get("proj-alpha")
      const p2 = cache.get("proj-alpha")
      const p3 = cache.resolve("proj-alpha")

      expect(readDetail).toHaveBeenCalledTimes(1)
      resolveRead({ status: "live", heartbeatTs: 12345 })

      const [res1, res2, res3] = await Promise.all([p1, p2, p3])

      // then
      expect(res1).toEqual({ status: "live", heartbeatTs: 12345 })
      expect(res2).toEqual({ status: "live", heartbeatTs: 12345 })
      expect(res3).toEqual({ status: "live", heartbeatTs: 12345 })
      expect(readDetail).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given sequential calls within the TTL window", () => {
    it("#then it returns the cached result without calling readDetail again", async () => {
      // given
      let currentTime = 1_000_000
      spyOn(Date, "now").mockImplementation(() => currentTime)

      const readDetail = jest.fn(async () => ({
        status: "live" as const,
        heartbeatTs: currentTime,
      }))
      const cache = createPresenceCache(10_000, { readDetail })

      // when
      const first = await cache.get("proj-alpha")
      currentTime += 5_000 // 5 seconds later (within 10s TTL)
      const second = await cache.get("proj-alpha")

      // then
      expect(first).toEqual({ status: "live", heartbeatTs: 1_000_000 })
      expect(second).toEqual({ status: "live", heartbeatTs: 1_000_000 })
      expect(readDetail).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given sequential calls after the TTL window expires", () => {
    it("#then it calls readDetail again for a fresh result", async () => {
      // given
      let currentTime = 1_000_000
      spyOn(Date, "now").mockImplementation(() => currentTime)

      let callCount = 0
      const readDetail = jest.fn(async () => {
        callCount += 1
        return {
          status: callCount === 1 ? ("live" as const) : ("stale" as const),
          heartbeatTs: currentTime,
        }
      })
      const cache = createPresenceCache(10_000, { readDetail })

      // when
      const first = await cache.get("proj-alpha")
      currentTime += 10_001 // 10.001 seconds later (past 10s TTL)
      const second = await cache.get("proj-alpha")

      // then
      expect(first).toEqual({ status: "live", heartbeatTs: 1_000_000 })
      expect(second).toEqual({ status: "stale", heartbeatTs: 1_010_001 })
      expect(readDetail).toHaveBeenCalledTimes(2)
    })
  })

  describe("#given calls for different projectIds", () => {
    it("#then it caches and single-flights them independently", async () => {
      // given
      const readDetail = jest.fn(async (projectId: string) => ({
        status: projectId === "proj-a" ? ("live" as const) : ("offline" as const),
        heartbeatTs: 12345,
      }))
      const cache = createPresenceCache(10_000, { readDetail })

      // when
      const [resA, resB] = await Promise.all([cache.get("proj-a"), cache.get("proj-b")])
      const resA2 = await cache.get("proj-a")

      // then
      expect(resA).toEqual({ status: "live", heartbeatTs: 12345 })
      expect(resB).toEqual({ status: "offline", heartbeatTs: 12345 })
      expect(resA2).toEqual({ status: "live", heartbeatTs: 12345 })
      expect(readDetail).toHaveBeenCalledTimes(2)
    })
  })

  describe("#given invalidate is called for a specific projectId", () => {
    it("#then the next call for that projectId calls readDetail again while other projectIds stay cached", async () => {
      // given
      let currentTime = 1_000_000
      spyOn(Date, "now").mockImplementation(() => currentTime)

      const readDetail = jest.fn(async (projectId: string) => ({
        status: "live" as const,
        heartbeatTs: currentTime,
      }))
      const cache = createPresenceCache(10_000, { readDetail })

      await cache.get("proj-a")
      await cache.get("proj-b")
      expect(readDetail).toHaveBeenCalledTimes(2)

      // when
      currentTime += 1_000
      cache.invalidate("proj-a")
      await cache.get("proj-a")
      await cache.get("proj-b")

      // then
      expect(readDetail).toHaveBeenCalledTimes(3)
      expect(readDetail.mock.calls[2][0]).toBe("proj-a")
    })
  })

  describe("#given invalidate is called without arguments", () => {
    it("#then all cached entries are cleared", async () => {
      // given
      const readDetail = jest.fn(async () => ({
        status: "live" as const,
        heartbeatTs: 12345,
      }))
      const cache = createPresenceCache(10_000, { readDetail })

      await cache.get("proj-a")
      await cache.get("proj-b")
      expect(readDetail).toHaveBeenCalledTimes(2)

      // when
      cache.invalidate()
      await cache.get("proj-a")
      await cache.get("proj-b")

      // then
      expect(readDetail).toHaveBeenCalledTimes(4)
    })
  })

  describe("#given readDetail throws an error", () => {
    it("#then the promise rejects and the in-flight entry is cleared so subsequent calls retry", async () => {
      // given
      let shouldThrow = true
      const readDetail = jest.fn(async () => {
        if (shouldThrow) {
          throw new Error("probe failure")
        }
        return { status: "live" as const, heartbeatTs: 12345 }
      })
      const cache = createPresenceCache(10_000, { readDetail })

      // when
      await expect(cache.get("proj-alpha")).rejects.toThrow("probe failure")

      shouldThrow = false
      const retry = await cache.get("proj-alpha")

      // then
      expect(retry).toEqual({ status: "live", heartbeatTs: 12345 })
      expect(readDetail).toHaveBeenCalledTimes(2)
    })
  })
})
