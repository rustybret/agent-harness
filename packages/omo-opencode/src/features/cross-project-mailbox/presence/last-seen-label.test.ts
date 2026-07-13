import { describe, expect, it } from "bun:test"

import { MAX_LAST_SEEN_AGE_MS, lastSeenLabel } from "./last-seen-label"

describe("lastSeenLabel", () => {
  describe("#given an age of 1500 seconds (1500000 ms)", () => {
    it("#then it returns '25 minutes ago'", () => {
      // given
      const ageMs = 1_500_000

      // when
      const label = lastSeenLabel(ageMs)

      // then
      expect(label).toBe("25 minutes ago")
    })
  })

  describe("#given an age of 59 seconds (59000 ms)", () => {
    it("#then it returns '59 seconds ago'", () => {
      // given
      const ageMs = 59_000

      // when
      const label = lastSeenLabel(ageMs)

      // then
      expect(label).toBe("59 seconds ago")
    })
  })

  describe("#given an age of exactly 1 second (1000 ms)", () => {
    it("#then it returns singular '1 second ago'", () => {
      // given
      const ageMs = 1_000

      // when
      const label = lastSeenLabel(ageMs)

      // then
      expect(label).toBe("1 second ago")
    })
  })

  describe("#given an age of exactly 1 minute (60000 ms)", () => {
    it("#then it returns singular '1 minute ago'", () => {
      // given
      const ageMs = 60_000

      // when
      const label = lastSeenLabel(ageMs)

      // then
      expect(label).toBe("1 minute ago")
    })
  })

  describe("#given an age of exactly 1 hour (3600000 ms)", () => {
    it("#then it returns singular '1 hour ago'", () => {
      // given
      const ageMs = 3_600_000

      // when
      const label = lastSeenLabel(ageMs)

      // then
      expect(label).toBe("1 hour ago")
    })
  })

  describe("#given an age of exactly 1 day (86400000 ms)", () => {
    it("#then it returns singular '1 day ago'", () => {
      // given
      const ageMs = 86_400_000

      // when
      const label = lastSeenLabel(ageMs)

      // then
      expect(label).toBe("1 day ago")
    })
  })

  describe("#given an age at the boundary MAX_LAST_SEEN_AGE_MS - 1 (7775999999 ms)", () => {
    it("#then it returns days form '89 days ago'", () => {
      // given
      const ageMs = MAX_LAST_SEEN_AGE_MS - 1

      // when
      const label = lastSeenLabel(ageMs)

      // then
      expect(label).toBe("89 days ago")
    })
  })

  describe("#given an age exactly at MAX_LAST_SEEN_AGE_MS (7776000000 ms)", () => {
    it("#then it returns long-time form 'a long time ago'", () => {
      // given
      const ageMs = MAX_LAST_SEEN_AGE_MS

      // when
      const label = lastSeenLabel(ageMs)

      // then
      expect(label).toBe("a long time ago")
    })
  })

  describe("#given an age greater than MAX_LAST_SEEN_AGE_MS", () => {
    it("#then it returns long-time form 'a long time ago'", () => {
      // given
      const ageMs = MAX_LAST_SEEN_AGE_MS + 100_000

      // when
      const label = lastSeenLabel(ageMs)

      // then
      expect(label).toBe("a long time ago")
    })
  })

  describe("#given null age", () => {
    it("#then it returns long-time form 'a long time ago'", () => {
      // given
      const ageMs = null

      // when
      const label = lastSeenLabel(ageMs)

      // then
      expect(label).toBe("a long time ago")
    })
  })

  describe("#given undefined age", () => {
    it("#then it returns long-time form 'a long time ago'", () => {
      // given
      const ageMs = undefined

      // when
      const label = lastSeenLabel(ageMs)

      // then
      expect(label).toBe("a long time ago")
    })
  })

  describe("#given negative age", () => {
    it("#then it returns long-time form 'a long time ago'", () => {
      // given
      const ageMs = -1000

      // when
      const label = lastSeenLabel(ageMs)

      // then
      expect(label).toBe("a long time ago")
    })
  })
})
