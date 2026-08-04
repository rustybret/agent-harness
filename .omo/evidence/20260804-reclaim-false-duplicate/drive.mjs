// Proves the reclaim path leaves a stale body digest behind, so a note that was reserved but never
// confirmed is quarantined as a FALSE duplicate on its next drain. Uses the real MailboxStore and
// the real BodyDigestStore against a temp repo - no mocks.
import { mkdtempSync, rmSync, utimesSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

const { MailboxStore } = await import(
  "../../packages/omo-opencode/src/features/cross-project-mailbox/mailbox/mailbox-store.ts"
)
const { BodyDigestStore } = await import(
  "../../packages/omo-opencode/src/features/cross-project-mailbox/loop-guard/digest-store.ts"
)

const FROM = "alpha-id"
const RESERVATION_TTL_MS = 120_000
const DIGEST_TTL_MIN = 60
const root = mkdtempSync(path.join(os.tmpdir(), "cpm-reclaim-qa-"))

function envelope() {
  return {
    version: 1,
    messageId: randomUUID(),
    timestamp: Date.now(),
    correlationId: randomUUID(),
    inReplyToMessageId: null,
    fromProject: "alpha",
    toProject: "beta",
    fromProjectId: FROM,
    toProjectId: "beta-id",
    intent: "impl",
    priority: 0,
    hopCount: 0,
    hopPath: [FROM],
    supersedes: null,
  }
}

try {
  const store = new MailboxStore(root, FROM, { reservation_ttl_ms: RESERVATION_TTL_MS })
  const digests = new BodyDigestStore(root, DIGEST_TTL_MIN * 60_000)

  const note = envelope()
  const body = "Please rebuild the prod image."
  await store.writeNote(note, body)

  // drain 1: reserve + record digest, then the dispatch never confirms (process died, prompt
  // rejected, session went away). The note stays parked as .delivering-<id>.md.
  const drained1 = await store.drainUnread(5)
  const reserved = await store.reserve(note.messageId)
  const first = await digests.checkAndRecord({
    fromProjectId: note.fromProjectId,
    toProjectId: note.toProjectId,
    correlationId: note.correlationId,
    body,
  })

  // age the reservation past its TTL so reclaimStale picks it up
  const aged = (Date.now() - RESERVATION_TTL_MS - 60_000) / 1000
  utimesSync(reserved, aged, aged)
  const reclaimed = await store.reclaimStale(new Set())

  // drain 2: the note is back in the inbox. Does the digest still block it?
  const drained2 = await store.drainUnread(5)

  // what the drain hook now does for every id reclaim returned
  const reclaimedIds = new Set(Array.isArray(reclaimed) ? reclaimed : [])
  for (const candidate of drained2) {
    if (!reclaimedIds.has(candidate.messageId)) continue
    await digests.rollback({
      fromProjectId: candidate.envelope.fromProjectId,
      toProjectId: candidate.envelope.toProjectId,
      correlationId: candidate.envelope.correlationId,
      body: candidate.body,
    })
  }
  const second = await digests.checkAndRecord({
    fromProjectId: note.fromProjectId,
    toProjectId: note.toProjectId,
    correlationId: note.correlationId,
    body,
  })

  console.log(
    JSON.stringify(
      {
        reservationTtlMs: RESERVATION_TTL_MS,
        digestTtlMs: DIGEST_TTL_MIN * 60_000,
        drain1Delivered: drained1.length,
        firstCheckIsDuplicate: first.isDuplicate,
        reclaimReturnedIds: Array.isArray(reclaimed) ? reclaimed.length : "not-returned",
        reclaimedBackToInbox: drained2.length === 1,
        secondCheckIsDuplicate: second.isDuplicate,
        verdict: second.isDuplicate
          ? "FALSE DUPLICATE - reclaimed note would be quarantined as duplicate-loop"
          : "ok - reclaimed note can be redelivered",
      },
      null,
      2,
    ),
  )
} finally {
  rmSync(root, { recursive: true, force: true })
}
