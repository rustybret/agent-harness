import { randomUUID } from "node:crypto"
import { access, mkdtemp, readFile, stat, utimes } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { MailboxMessageSchema, type MailboxMessage } from "../envelope/schema"
import { MailboxStore } from "./mailbox-store"
import { PendingDeliveryStore } from "./pending-delivery-store"

const FROM_PROJECT_ID = "alpha-id"
const RESERVATION_TTL_MS = 5_000

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "cpm-mailbox-"))
})

afterEach(async () => {
  await Bun.$`rm -rf ${root}`.quiet().nothrow()
})

function makeEnvelope(overrides: Partial<MailboxMessage> = {}): MailboxMessage {
  return MailboxMessageSchema.parse({
    messageId: randomUUID(),
    timestamp: Date.now(),
    correlationId: randomUUID(),
    inReplyToMessageId: null,
    fromProject: "alpha",
    toProject: "beta",
    fromProjectId: FROM_PROJECT_ID,
    toProjectId: "beta-id",
    intent: "quick",
    priority: 0,
    hopCount: 0,
    hopPath: [FROM_PROJECT_ID],
    supersedes: null,
    ...overrides,
  })
}

function makeStore(): MailboxStore {
  return new MailboxStore(root, FROM_PROJECT_ID, { reservation_ttl_ms: RESERVATION_TTL_MS })
}

function inboxDir(): string {
  return path.join(root, "coordination_notes", FROM_PROJECT_ID)
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

describe("MailboxStore#storage", () => {
  describe("#given an empty inbox", () => {
    describe("#when writeNote is called", () => {
      it("#then the note exists as front-matter + body and round-trips", async () => {
        const store = makeStore()
        const envelope = makeEnvelope()
        const body = "Please review the auth change."

        await store.writeNote(envelope, body)

        const filePath = path.join(inboxDir(), `${envelope.messageId}.md`)
        expect(await exists(filePath)).toBe(true)

        const fileContent = await readFile(filePath, "utf8")
        expect(fileContent.startsWith("---\n")).toBe(true)
        expect(fileContent.includes("\n---\n")).toBe(true)

        const parsed = await store.parseNote(filePath)
        expect(parsed.envelope.messageId).toBe(envelope.messageId)
        expect(parsed.body).toBe(body)
      })
    })
  })
})

describe("MailboxStore#reservation", () => {
  describe("#given an inbox with one unread note", () => {
    describe("#when reserve is called", () => {
      it("#then the file is renamed to .delivering and dropped from listUnread", async () => {
        const store = makeStore()
        const envelope = makeEnvelope()
        await store.writeNote(envelope, "body")

        const reservedPath = await store.reserve(envelope.messageId)

        expect(reservedPath).toBeDefined()
        expect(path.basename(reservedPath ?? "")).toBe(`.delivering-${envelope.messageId}.md`)
        expect(await exists(reservedPath ?? "")).toBe(true)
        const unread = await store.listUnread()
        expect(unread.some((message) => message.messageId === envelope.messageId)).toBe(false)
      })
    })
  })

  describe("#given a note already reserved", () => {
    describe("#when reserve is called again", () => {
      it("#then it returns undefined without crashing", async () => {
        const store = makeStore()
        const envelope = makeEnvelope()
        await store.writeNote(envelope, "body")
        await store.reserve(envelope.messageId)

        const second = await store.reserve(envelope.messageId)

        expect(second).toBeUndefined()
      })
    })
  })
})

describe("MailboxStore#ack", () => {
  describe("#given a reserved note and a matching dispatch_sent pending entry", () => {
    describe("#when history is confirmed and ack is called", () => {
      it("#then the note moves to processed and pending becomes history_confirmed", async () => {
        const store = makeStore()
        const pending = new PendingDeliveryStore(root)
        const envelope = makeEnvelope()
        await store.writeNote(envelope, "body")
        const reservedPath = await store.reserve(envelope.messageId)
        await pending.addDispatchSent({
          messageId: envelope.messageId,
          sessionId: "ses_1",
          reservedPath: reservedPath ?? "",
          dispatchedAt: Date.now(),
        })

        await pending.markHistoryConfirmed(envelope.messageId)
        await store.ack(envelope.messageId)

        const processedPath = path.join(inboxDir(), "processed", `${envelope.messageId}.md`)
        expect(await exists(processedPath)).toBe(true)
        const entry = await pending.getEntry(envelope.messageId)
        expect(entry?.state).toBe("history_confirmed")
        expect(await store.listUnread()).toHaveLength(0)
      })
    })
  })
})

describe("MailboxStore#markDispatched", () => {
  describe("#given a reserved note", () => {
    describe("#when markDispatched is called", () => {
      it("#then it delegates to PendingDeliveryStore and adds a dispatch_sent entry", async () => {
        const store = makeStore()
        const pending = new PendingDeliveryStore(root)
        const envelope = makeEnvelope()
        await store.writeNote(envelope, "body")
        const reservedPath = await store.reserve(envelope.messageId)

        await store.markDispatched({
          messageId: envelope.messageId,
          sessionId: "ses_1",
          reservedPath: reservedPath ?? "",
          dispatchedAt: Date.now(),
        })

        const entry = await pending.getEntry(envelope.messageId)
        expect(entry?.state).toBe("dispatch_sent")
      })
    })
  })
})

describe("MailboxStore#quarantine", () => {
  describe("#given an unread note", () => {
    describe("#when quarantine is called", () => {
      it("#then the file moves to rejected and a reason JSON is written", async () => {
        const store = makeStore()
        const envelope = makeEnvelope()
        await store.writeNote(envelope, "body")

        await store.quarantine(envelope.messageId, "unauthorized", "some detail")

        const rejectedPath = path.join(inboxDir(), "rejected", `${envelope.messageId}.md`)
        const reasonPath = path.join(inboxDir(), "rejected", `${envelope.messageId}.reason.json`)
        expect(await exists(rejectedPath)).toBe(true)
        expect(await exists(reasonPath)).toBe(true)
        const reason = JSON.parse(await readFile(reasonPath, "utf8")) as Record<string, unknown>
        expect(reason.reason).toBe("unauthorized")
        expect(reason.detail).toBe("some detail")
        expect(typeof reason.at).toBe("string")
        expect(reason.messageId).toBeUndefined()
      })
    })
  })
})

async function makeStaleReservation(store: MailboxStore, envelope: MailboxMessage): Promise<string> {
  await store.writeNote(envelope, "body")
  const reservedPath = await store.reserve(envelope.messageId)
  const past = new Date(Date.now() - RESERVATION_TTL_MS * 4)
  await utimes(reservedPath ?? "", past, past)
  return reservedPath ?? ""
}

describe("MailboxStore#reclaimStale", () => {
  describe("#given a stale reservation whose pending entry is history_confirmed (case A)", () => {
    describe("#when reclaimStale runs", () => {
      it("#then it acks without re-adding to unread", async () => {
        const store = makeStore()
        const pending = new PendingDeliveryStore(root)
        const envelope = makeEnvelope()
        const reservedPath = await makeStaleReservation(store, envelope)
        await pending.addDispatchSent({
          messageId: envelope.messageId,
          sessionId: "ses_1",
          reservedPath,
          dispatchedAt: Date.now() - RESERVATION_TTL_MS * 4,
        })
        await pending.markHistoryConfirmed(envelope.messageId)

        const reclaimed = await store.reclaimStale(new Set<string>())

        const processedPath = path.join(inboxDir(), "processed", `${envelope.messageId}.md`)
        expect(await exists(processedPath)).toBe(true)
        expect(await store.listUnread()).toHaveLength(0)
        expect(reclaimed).toEqual([])
      })
    })
  })

  describe("#given a stale dispatch_sent reservation now present in history (case B)", () => {
    describe("#when reclaimStale runs", () => {
      it("#then it confirms history, acks, and does not re-add to unread", async () => {
        const store = makeStore()
        const pending = new PendingDeliveryStore(root)
        const envelope = makeEnvelope()
        const reservedPath = await makeStaleReservation(store, envelope)
        await pending.addDispatchSent({
          messageId: envelope.messageId,
          sessionId: "ses_1",
          reservedPath,
          dispatchedAt: Date.now() - RESERVATION_TTL_MS * 4,
        })

        const reclaimed = await store.reclaimStale(new Set<string>([envelope.messageId]))

        const processedPath = path.join(inboxDir(), "processed", `${envelope.messageId}.md`)
        expect(await exists(processedPath)).toBe(true)
        expect((await pending.getEntry(envelope.messageId))?.state).toBe("history_confirmed")
        expect(await store.listUnread()).toHaveLength(0)
        expect(reclaimed).toEqual([])
      })
    })
  })

  describe("#given a stale dispatch_sent reservation absent from history past TTL (case C)", () => {
    describe("#when reclaimStale runs", () => {
      it("#then it returns the file to unread and removes the pending entry", async () => {
        const store = makeStore()
        const pending = new PendingDeliveryStore(root)
        const envelope = makeEnvelope()
        const reservedPath = await makeStaleReservation(store, envelope)
        await pending.addDispatchSent({
          messageId: envelope.messageId,
          sessionId: "ses_1",
          reservedPath,
          dispatchedAt: Date.now() - RESERVATION_TTL_MS * 4,
        })

        const reclaimed = await store.reclaimStale(new Set<string>())

        const unread = await store.listUnread()
        expect(unread.some((message) => message.messageId === envelope.messageId)).toBe(true)
        expect(await pending.getEntry(envelope.messageId)).toBeUndefined()
        expect(reclaimed).toEqual([envelope.messageId])
      })
    })
  })

  describe("#given a stale reservation with no pending entry (case D)", () => {
    describe("#when reclaimStale runs", () => {
      it("#then it returns the file to unread", async () => {
        const store = makeStore()
        const envelope = makeEnvelope()
        await makeStaleReservation(store, envelope)

        const reclaimed = await store.reclaimStale(new Set<string>())

        const unread = await store.listUnread()
        expect(unread.some((message) => message.messageId === envelope.messageId)).toBe(true)
        expect(reclaimed).toEqual([envelope.messageId])
      })
    })
  })
})

describe("MailboxStore#drainUnread", () => {
  describe("#given two notes where B supersedes A from the same source", () => {
    describe("#when listUnread and drainUnread are called", () => {
      it("#then listUnread shows both but drainUnread picks only the latest", async () => {
        const store = makeStore()
        const noteA = makeEnvelope({ timestamp: 1_000 })
        const noteB = makeEnvelope({ timestamp: 2_000, supersedes: noteA.messageId })
        await store.writeNote(noteA, "first")
        await store.writeNote(noteB, "second")

        const listed = await store.listUnread()
        const drained = await store.drainUnread(5)

        expect(listed).toHaveLength(2)
        expect(drained).toHaveLength(1)
        expect(drained[0]?.messageId).toBe(noteB.messageId)
        expect(await exists(path.join(inboxDir(), `${noteA.messageId}.md`))).toBe(true)
      })
    })
  })

  describe("#given B supersedes A and A is still sitting unread", () => {
    describe("#when drainUnread runs", () => {
      it("#then B is not flagged as a correction, because A was never delivered", async () => {
        const store = makeStore()
        const noteA = makeEnvelope({ timestamp: 1_000 })
        const noteB = makeEnvelope({ timestamp: 2_000, supersedes: noteA.messageId })
        await store.writeNote(noteA, "first")
        await store.writeNote(noteB, "second")

        const drained = await store.drainUnread(5)

        expect(drained).toHaveLength(1)
        expect(drained[0]?.messageId).toBe(noteB.messageId)
        expect(drained[0]?.supersedesDelivered).toBeUndefined()
      })
    })
  })

  describe("#given B supersedes A in a LATER batch, after A was already delivered", () => {
    describe("#when drainUnread runs", () => {
      it("#then B is flagged as superseding a delivered note", async () => {
        const store = makeStore()
        const noteA = makeEnvelope({ timestamp: 1_000 })
        await store.writeNote(noteA, "first")
        await store.reserve(noteA.messageId)
        await store.ack(noteA.messageId)

        const noteB = makeEnvelope({ timestamp: 2_000, supersedes: noteA.messageId })
        await store.writeNote(noteB, "correction")
        const drained = await store.drainUnread(5)

        expect(drained).toHaveLength(1)
        expect(drained[0]?.messageId).toBe(noteB.messageId)
        expect(drained[0]?.supersedesDelivered).toBe(true)
      })
    })
  })

  describe("#given B supersedes a messageId that was never seen at all", () => {
    describe("#when drainUnread runs", () => {
      it("#then B is delivered without a correction flag", async () => {
        const store = makeStore()
        const noteB = makeEnvelope({ timestamp: 2_000, supersedes: randomUUID() })
        await store.writeNote(noteB, "correction for a ghost")

        const drained = await store.drainUnread(5)

        expect(drained).toHaveLength(1)
        expect(drained[0]?.supersedesDelivered).toBeUndefined()
      })
    })
  })

  describe("#given a note that supersedes nothing", () => {
    describe("#when drainUnread runs", () => {
      it("#then no correction flag is set and no processed lookup is implied", async () => {
        const store = makeStore()
        await store.writeNote(makeEnvelope({ timestamp: 1_000 }), "plain")

        const drained = await store.drainUnread(5)

        expect(drained).toHaveLength(1)
        expect(drained[0]?.supersedesDelivered).toBeUndefined()
      })
    })
  })

  describe("#given notes with mixed priorities", () => {
    describe("#when drainUnread runs", () => {
      it("#then it orders priority-desc then timestamp-asc", async () => {
        const store = makeStore()
        const low = makeEnvelope({ priority: 0, timestamp: 1_000 })
        const highEarly = makeEnvelope({ priority: 5, timestamp: 2_000 })
        const highLate = makeEnvelope({ priority: 5, timestamp: 3_000 })
        await store.writeNote(low, "low")
        await store.writeNote(highEarly, "high-early")
        await store.writeNote(highLate, "high-late")

        const drained = await store.drainUnread(5)

        expect(drained.map((message) => message.messageId)).toEqual([
          highEarly.messageId,
          highLate.messageId,
          low.messageId,
        ])
      })
    })
  })
})

describe("MailboxStore#concurrentSends", () => {
  describe("#given five concurrent writeNote calls to the same inbox", () => {
    describe("#when all resolve", () => {
      it("#then five distinct note files are present", async () => {
        const store = makeStore()
        const envelopes = Array.from({ length: 5 }, () => makeEnvelope())

        await Promise.all(envelopes.map((envelope) => store.writeNote(envelope, "body")))

        const unread = await store.listUnread()
        expect(unread).toHaveLength(5)
        for (const envelope of envelopes) {
          expect(await exists(path.join(inboxDir(), `${envelope.messageId}.md`))).toBe(true)
        }
      })
    })
  })
})

describe("PendingDeliveryStore", () => {
  describe("#given an empty store", () => {
    describe("#when entries are added and transitioned", () => {
      it("#then they persist durably and round-trip", async () => {
        const pending = new PendingDeliveryStore(root)
        const messageId = randomUUID()
        await pending.addDispatchSent({
          messageId,
          sessionId: "ses_1",
          reservedPath: "/x",
          dispatchedAt: 100,
        })

        expect((await pending.getEntry(messageId))?.state).toBe("dispatch_sent")

        await pending.markHistoryConfirmed(messageId)
        const reloaded = new PendingDeliveryStore(root)
        expect((await reloaded.getEntry(messageId))?.state).toBe("history_confirmed")

        await pending.removeEntry(messageId)
        expect(await pending.getEntry(messageId)).toBeUndefined()
        expect(await pending.listAll()).toHaveLength(0)
      })
    })
  })
})
