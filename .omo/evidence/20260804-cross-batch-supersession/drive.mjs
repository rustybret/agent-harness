// Drives the REAL MailboxStore + REAL buildTriagePrompt across two separate drain batches, which is
// the shape the in-process tests cannot prove: batch 1 delivers the original, batch 2 arrives after
// it was acked. Writes what the receiving agent would actually read.
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

const { MailboxStore } = await import(
  "../../packages/omo-opencode/src/features/cross-project-mailbox/mailbox/mailbox-store.ts"
)
const { buildTriagePrompt } = await import(
  "../../packages/omo-opencode/src/features/cross-project-mailbox/triage/template.ts"
)

const FROM = "alpha-id"
const root = mkdtempSync(path.join(os.tmpdir(), "cpm-supersede-qa-"))

function envelope(overrides = {}) {
  return {
    version: 1,
    messageId: randomUUID(),
    timestamp: Date.now(),
    correlationId: randomUUID(),
    inReplyToMessageId: null,
    fromProject: "cloudhome",
    toProject: "agent-harness",
    fromProjectId: FROM,
    toProjectId: "beta-id",
    intent: "impl",
    priority: 0,
    hopCount: 0,
    hopPath: [FROM],
    supersedes: null,
    ...overrides,
  }
}

try {
  const store = new MailboxStore(root, FROM, { reservation_ttl_ms: 120000 })

  // batch 1: original arrives and is consumed
  const original = envelope({ timestamp: 1000 })
  await store.writeNote(original, "Deploy the v3 image to prod.")
  const batch1 = await store.drainUnread(10)
  await store.reserve(original.messageId)
  await store.ack(original.messageId)

  // batch 2: correction arrives AFTER the original was already acted on
  const correction = envelope({ timestamp: 2000, supersedes: original.messageId })
  await store.writeNote(correction, "Hold the v3 deploy - it has a bad migration.")
  const batch2 = await store.drainUnread(10)

  const prompt = buildTriagePrompt(
    { ...batch2[0].envelope, body: batch2[0].body, supersedesDelivered: batch2[0].supersedesDelivered },
    { projectDisplayName: "agent-harness" },
  )

  console.log(
    JSON.stringify(
      {
        batch1Delivered: batch1.map((n) => n.messageId),
        batch2Delivered: batch2.map((n) => n.messageId),
        supersedesDelivered: batch2[0].supersedesDelivered ?? null,
        promptOpensWithCorrection: prompt.split("\n").slice(0, 6),
        namesSupersededId: prompt.includes(original.messageId),
      },
      null,
      2,
    ),
  )
} finally {
  rmSync(root, { recursive: true, force: true })
}
