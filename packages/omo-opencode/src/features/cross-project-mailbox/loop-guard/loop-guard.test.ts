import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { MailboxMessage } from "../envelope/schema"
import type { UnreadMessage } from "../mailbox/types"
import { BodyDigestStore } from "./digest-store"
import { normalizeBody } from "./digest-store"
import { orderForDrain } from "./drain-order"
import { SamePairRateLimiter } from "./rate-limiter"

let repoRoot: string

beforeEach(async () => {
  repoRoot = await mkdtemp(path.join(tmpdir(), "loop-guard-"))
})

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true })
})

function makeUnread(overrides: { priority: number; timestamp: number; messageId?: string }): UnreadMessage {
  const messageId = overrides.messageId ?? `id-${overrides.priority}-${overrides.timestamp}`
  const envelope: MailboxMessage = {
    version: 1,
    messageId,
    timestamp: overrides.timestamp,
    correlationId: "00000000-0000-0000-0000-000000000000",
    inReplyToMessageId: null,
    fromProject: "a",
    toProject: "b",
    fromProjectId: "pa",
    toProjectId: "pb",
    intent: "impl",
    priority: overrides.priority,
    hopCount: 0,
    hopPath: [],
    supersedes: null,
  }
  return { messageId, filePath: `${messageId}.md`, envelope, body: "body" }
}

describe("normalizeBody", () => {
  test("#given a body with surrounding whitespace, internal runs, and CRLF #when normalizeBody #then trimmed, collapsed, LF-normalized", () => {
    // given
    const body = "  hello   world\r\n  next   line  \t\r\n  "
    // when
    const result = normalizeBody(body)
    // then
    expect(result.startsWith(" ")).toBe(false)
    expect(result.endsWith(" ")).toBe(false)
    expect(result.includes("\r")).toBe(false)
    expect(result).toBe("hello world\nnext line")
  })
})

describe("BodyDigestStore", () => {
  test("#given a fresh store and a note pair #when checkAndRecord #then not duplicate and persisted to disk", async () => {
    // given
    const store = new BodyDigestStore(repoRoot, 60 * 60_000)
    const note = { fromProjectId: "pa", toProjectId: "pb", correlationId: "c1", body: "hi there" }
    // when
    const result = await store.checkAndRecord(note)
    // then
    expect(result.isDuplicate).toBe(false)
    const raw = await readFile(path.join(repoRoot, "coordination_notes", ".digests.json"), "utf8")
    expect(raw).toContain("pa:pb:c1:")
  })

  test("#given same body + pair + correlationId within TTL #when checkAndRecord twice #then second is duplicate", async () => {
    // given
    const store = new BodyDigestStore(repoRoot, 60 * 60_000)
    const note = { fromProjectId: "pa", toProjectId: "pb", correlationId: "c1", body: "  hi   there \r\n" }
    // when
    const first = await store.checkAndRecord(note)
    const second = await store.checkAndRecord(note)
    // then
    expect(first.isDuplicate).toBe(false)
    expect(second.isDuplicate).toBe(true)
  })

  test("#given same body + pair but expired TTL #when checkAndRecord #then not duplicate", async () => {
    // given
    let clock = 1_000_000
    const store = new BodyDigestStore(repoRoot, 60_000, () => clock)
    const note = { fromProjectId: "pa", toProjectId: "pb", correlationId: "c1", body: "hi there" }
    await store.checkAndRecord(note)
    // when
    clock += 60_001
    const result = await store.checkAndRecord(note)
    // then
    expect(result.isDuplicate).toBe(false)
  })

  test("#given same body and pair but different correlationId #when checkAndRecord #then not duplicate", async () => {
    // given
    const store = new BodyDigestStore(repoRoot, 60 * 60_000)
    const base = { fromProjectId: "pa", toProjectId: "pb", body: "hi there" }
    // when
    const first = await store.checkAndRecord({ ...base, correlationId: "c1" })
    const second = await store.checkAndRecord({ ...base, correlationId: "c2" })
    // then
    expect(first.isDuplicate).toBe(false)
    expect(second.isDuplicate).toBe(false)
  })

  test("#given an entry recorded by a prior instance #when a new instance checks the same body #then duplicate (survives restart)", async () => {
    // given
    const note = { fromProjectId: "pa", toProjectId: "pb", correlationId: "c1", body: "hi there" }
    const first = new BodyDigestStore(repoRoot, 60 * 60_000)
    await first.checkAndRecord(note)
    // when
    const second = new BodyDigestStore(repoRoot, 60 * 60_000)
    const result = await second.checkAndRecord(note)
    // then
    expect(result.isDuplicate).toBe(true)
  })
})

describe("SamePairRateLimiter", () => {
  test("#given 5 notes from a pair in the window with limit 6 #when checkRateLimit #then not limited", async () => {
    // given
    const limiter = new SamePairRateLimiter(repoRoot, 6)
    for (let i = 0; i < 5; i += 1) {
      await limiter.checkRateLimit("pa", "pb")
    }
    // when
    const result = await limiter.checkRateLimit("pa", "pb")
    // then
    expect(result.limited).toBe(false)
  })

  test("#given 6 notes from a pair with limit 6 #when 7th checkRateLimit #then limited", async () => {
    // given
    const limiter = new SamePairRateLimiter(repoRoot, 6)
    for (let i = 0; i < 6; i += 1) {
      await limiter.checkRateLimit("pa", "pb")
    }
    // when
    const result = await limiter.checkRateLimit("pa", "pb")
    // then
    expect(result.limited).toBe(true)
  })

  test("#given pair A saturated #when checkRateLimit for a different pair B #then not limited", async () => {
    // given
    const limiter = new SamePairRateLimiter(repoRoot, 6)
    for (let i = 0; i < 10; i += 1) {
      await limiter.checkRateLimit("pa", "pb")
    }
    // when
    const result = await limiter.checkRateLimit("pb", "pc")
    // then
    expect(result.limited).toBe(false)
  })

  test("#given window elapsed beyond 60s #when checkRateLimit #then window resets and not limited", async () => {
    // given
    let clock = 5_000_000
    const limiter = new SamePairRateLimiter(repoRoot, 6, () => clock)
    for (let i = 0; i < 6; i += 1) {
      await limiter.checkRateLimit("pa", "pb")
    }
    expect((await limiter.checkRateLimit("pa", "pb")).limited).toBe(true)
    // when
    clock += 60_001
    const result = await limiter.checkRateLimit("pa", "pb")
    // then
    expect(result.limited).toBe(false)
  })
})

describe("orderForDrain", () => {
  test("#given notes with varying priority and timestamp #when orderForDrain #then priority desc then timestamp asc", () => {
    // given
    const notes = [
      makeUnread({ priority: 1, timestamp: 100 }),
      makeUnread({ priority: 5, timestamp: 300 }),
      makeUnread({ priority: 5, timestamp: 200 }),
      makeUnread({ priority: 3, timestamp: 50 }),
      makeUnread({ priority: 1, timestamp: 10 }),
    ]
    // when
    const result = orderForDrain(notes, 5)
    // then
    expect(result.map((n) => [n.envelope.priority, n.envelope.timestamp])).toEqual([
      [5, 200],
      [5, 300],
      [3, 50],
      [1, 10],
      [1, 100],
    ])
  })

  test("#given 8 notes and max 3 #when orderForDrain #then exactly 3 returned and input not mutated", () => {
    // given
    const notes = Array.from({ length: 8 }, (_, i) => makeUnread({ priority: i, timestamp: i }))
    // when
    const result = orderForDrain(notes, 3)
    // then
    expect(result).toHaveLength(3)
    expect(notes).toHaveLength(8)
  })

  test("#given 4 high + 4 low priority notes and max 4 #when orderForDrain #then all 4 high returned and low not dropped from input", () => {
    // given
    const high = Array.from({ length: 4 }, (_, i) => makeUnread({ priority: 10, timestamp: i, messageId: `h${i}` }))
    const low = Array.from({ length: 4 }, (_, i) => makeUnread({ priority: 1, timestamp: i, messageId: `l${i}` }))
    const notes = [...low, ...high]
    // when
    const result = orderForDrain(notes, 4)
    // then
    expect(result.every((n) => n.envelope.priority === 10)).toBe(true)
    expect(notes.filter((n) => n.envelope.priority === 1)).toHaveLength(4)
  })
})
