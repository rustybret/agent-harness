import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { projectIdForRoot } from "../envelope/project-id"
import { outboxLogPath, type OutboxEntry } from "../send-tool/outbox-log"
import { readDeliveryStatus, renderDeliveryStatus, type DeliveryStatusRegistryPort } from "./delivery-status"

const NOW = 1_700_000_000_000
const HOUR = 3_600_000
const createdRoots: string[] = []

function makeRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "mailbox-delivery-status-"))
  createdRoots.push(root)
  return root
}

function outboxEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    sentAt: NOW - HOUR,
    toProjectId: "cloudhome-1234abcd",
    messageId: "msg-1",
    intent: "question",
    correlationId: "corr-1",
    body: "a note body",
    ...overrides,
  }
}

function writeOutbox(root: string, entries: readonly OutboxEntry[]): void {
  const logPath = outboxLogPath(root)
  mkdirSync(path.dirname(logPath), { recursive: true })
  writeFileSync(logPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8")
}

function writeAck(
  targetRoot: string,
  senderProjectId: string,
  bucket: "processed" | "rejected",
  messageId: string,
  reason?: { reason: string; detail?: string },
): void {
  const dir = path.join(targetRoot, "coordination_notes", senderProjectId, bucket)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${messageId}.md`), "note\n", "utf8")
  if (reason !== undefined) {
    writeFileSync(
      path.join(dir, `${messageId}.reason.json`),
      `${JSON.stringify({ ...reason, at: new Date(NOW).toISOString() })}\n`,
      "utf8",
    )
  }
}

function registryFor(map: Record<string, string>): DeliveryStatusRegistryPort {
  return { getRepoRootForProjectId: (id) => map[id] }
}

describe("readDeliveryStatus", () => {
  afterEach(() => {
    while (createdRoots.length > 0) {
      const root = createdRoots.pop()
      if (root !== undefined) rmSync(root, { recursive: true, force: true })
    }
  })

  describe("#given a send the target quarantined with a recorded reason", () => {
    it("#when reading status #then the outcome is rejected and the receiver's reason surfaces", () => {
      // given
      const senderRoot = makeRepo()
      const targetRoot = makeRepo()
      const senderProjectId = projectIdForRoot(senderRoot)
      writeOutbox(senderRoot, [outboxEntry({ messageId: "rejected-1", toRepoRoot: targetRoot })])
      writeAck(targetRoot, senderProjectId, "rejected", "rejected-1", {
        reason: "unauthorized",
        detail: "sender not in allowlist",
      })

      // when
      const report = readDeliveryStatus(senderRoot, registryFor({}), { now: NOW })

      // then
      expect(report.summary.rejected).toBe(1)
      expect(report.needsAttention).toHaveLength(1)
      expect(report.needsAttention[0]?.outcome).toBe("rejected")
      expect(report.needsAttention[0]?.rejectionReason).toBe("unauthorized")
      expect(report.needsAttention[0]?.rejectionDetail).toBe("sender not in allowlist")
    })
  })

  describe("#given a send the target processed", () => {
    it("#when reading status #then it is counted as processed and needs no attention", () => {
      // given
      const senderRoot = makeRepo()
      const targetRoot = makeRepo()
      writeOutbox(senderRoot, [outboxEntry({ messageId: "ok-1", toRepoRoot: targetRoot })])
      writeAck(targetRoot, projectIdForRoot(senderRoot), "processed", "ok-1")

      // when
      const report = readDeliveryStatus(senderRoot, registryFor({}), { now: NOW })

      // then
      expect(report.summary.processed).toBe(1)
      expect(report.needsAttention).toHaveLength(0)
    })
  })

  describe("#given an unacknowledged send older than the stale threshold", () => {
    it("#when reading status #then it ages from pending into stale", () => {
      // given
      const senderRoot = makeRepo()
      const targetRoot = makeRepo()
      writeOutbox(senderRoot, [
        outboxEntry({ messageId: "old-1", toRepoRoot: targetRoot, sentAt: NOW - 6 * HOUR }),
      ])

      // when
      const strict = readDeliveryStatus(senderRoot, registryFor({}), { now: NOW, staleAfterHours: 4 })
      const lenient = readDeliveryStatus(senderRoot, registryFor({}), { now: NOW, staleAfterHours: 12 })

      // then
      expect(strict.summary.stale).toBe(1)
      expect(strict.needsAttention[0]?.ageHours).toBe(6)
      expect(lenient.summary.stale).toBe(0)
      expect(lenient.summary.pending).toBe(1)
      expect(lenient.needsAttention).toHaveLength(0)
    })
  })

  describe("#given an entry whose target repo root only the registry knows", () => {
    it("#when reading status #then the registry resolves it instead of reporting an unresolved target", () => {
      // given
      const senderRoot = makeRepo()
      const targetRoot = makeRepo()
      writeOutbox(senderRoot, [outboxEntry({ messageId: "reg-1", toProjectId: "known-target" })])
      writeAck(targetRoot, projectIdForRoot(senderRoot), "processed", "reg-1")

      // when
      const report = readDeliveryStatus(senderRoot, registryFor({ "known-target": targetRoot }), { now: NOW })

      // then
      expect(report.summary.processed).toBe(1)
      expect(report.summary.unresolvedTarget).toBe(0)
    })
  })

  describe("#given an entry whose target cannot be resolved at all", () => {
    it("#when reading status #then it is flagged as an unresolved target", () => {
      // given
      const senderRoot = makeRepo()
      writeOutbox(senderRoot, [outboxEntry({ messageId: "lost-1", toProjectId: "nowhere" })])

      // when
      const report = readDeliveryStatus(senderRoot, registryFor({}), { now: NOW })

      // then
      expect(report.summary.unresolvedTarget).toBe(1)
      expect(report.needsAttention[0]?.outcome).toBe("unresolved-target")
    })
  })

  describe("#given no outbox log at all", () => {
    it("#when reading status #then it reports an empty summary instead of throwing", () => {
      // given
      const senderRoot = makeRepo()

      // when
      const report = readDeliveryStatus(senderRoot, registryFor({}), { now: NOW })

      // then
      expect(report.rows).toHaveLength(0)
      expect(report.summary).toEqual({
        processed: 0,
        rejected: 0,
        pending: 0,
        stale: 0,
        unresolvedTarget: 0,
      })
    })
  })

  describe("#given a rejected note whose reason file the receiver never wrote", () => {
    it("#when reading status #then it still reports rejected without a reason", () => {
      // given
      const senderRoot = makeRepo()
      const targetRoot = makeRepo()
      writeOutbox(senderRoot, [outboxEntry({ messageId: "bare-1", toRepoRoot: targetRoot })])
      writeAck(targetRoot, projectIdForRoot(senderRoot), "rejected", "bare-1")

      // when
      const report = readDeliveryStatus(senderRoot, registryFor({}), { now: NOW })

      // then
      expect(report.summary.rejected).toBe(1)
      expect(report.needsAttention[0]?.rejectionReason).toBeUndefined()
    })
  })
})

describe("renderDeliveryStatus", () => {
  afterEach(() => {
    while (createdRoots.length > 0) {
      const root = createdRoots.pop()
      if (root !== undefined) rmSync(root, { recursive: true, force: true })
    }
  })

  describe("#given a report where everything landed", () => {
    it("#when rendered #then it says nothing needs attention", () => {
      // given
      const senderRoot = makeRepo()
      const targetRoot = makeRepo()
      writeOutbox(senderRoot, [outboxEntry({ messageId: "ok-2", toRepoRoot: targetRoot })])
      writeAck(targetRoot, projectIdForRoot(senderRoot), "processed", "ok-2")

      // when
      const rendered = renderDeliveryStatus(readDeliveryStatus(senderRoot, registryFor({}), { now: NOW }))

      // then
      expect(rendered).toContain("Nothing needs attention")
    })
  })

  describe("#given a report containing a rejection", () => {
    it("#when rendered #then the row carries the receiver's reason", () => {
      // given
      const senderRoot = makeRepo()
      const targetRoot = makeRepo()
      writeOutbox(senderRoot, [outboxEntry({ messageId: "bad-2", toRepoRoot: targetRoot })])
      writeAck(targetRoot, projectIdForRoot(senderRoot), "rejected", "bad-2", {
        reason: "over-budget",
        detail: "intent plan above ceiling impl",
      })

      // when
      const rendered = renderDeliveryStatus(readDeliveryStatus(senderRoot, registryFor({}), { now: NOW }))

      // then
      expect(rendered).toContain("bad-2")
      expect(rendered).toContain("over-budget: intent plan above ceiling impl")
    })
  })
})
