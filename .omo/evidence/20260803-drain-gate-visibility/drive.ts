// Drives the REAL registered project_mailbox_peek tool and the REAL idle-drain hook against a
// filesystem fixture, with an ineligible active primary, to prove a gated drain is now observable.
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { MailboxStore } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/mailbox"
import { projectIdForRoot } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/envelope"
import { CrossProjectMailboxConfigSchema } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/config"
import { createProjectMailboxPeekTool } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/manual-drain"
import { createIdleDrainHook } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/hooks/idle-drain-hook"
import { createMailboxTraceEmit, traceLogPath } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/trace"
import { BodyDigestStore, SamePairRateLimiter } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/loop-guard"
import { validateInbound } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/validation"
import { buildTriagePrompt } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/triage/template"
import { PendingDeliveryStore } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/mailbox/pending-delivery-store"

const receiverRoot = mkdtempSync(path.join(tmpdir(), "omo-qa-gate-receiver-"))
const senderRoot = mkdtempSync(path.join(tmpdir(), "omo-qa-gate-sender-"))
mkdirSync(path.join(receiverRoot, ".omo"), { recursive: true })
const senderId = projectIdForRoot(senderRoot)
const receiverId = projectIdForRoot(receiverRoot)

const config = CrossProjectMailboxConfigSchema.parse({
  enabled: true,
  intake_eligible_agents: ["sisyphus"],
  default_sender_access: "allow-all",
})

// Two real notes land in the receiver's inbox via the real store.
const store = new MailboxStore(receiverRoot, senderId, { reservation_ttl_ms: 120000 })
for (const body of ["first waiting note", "second waiting note"]) {
  await store.writeNote({
    version: 1, messageId: randomUUID(), timestamp: Date.now(), correlationId: randomUUID(),
    inReplyToMessageId: null, fromProject: "qa-sender", toProject: "qa-receiver",
    fromProjectId: senderId, toProjectId: receiverId, intent: "question",
    priority: 0, hopCount: 0, hopPath: [senderId], supersedes: null,
  }, body)
}

const projects = [{ projectId: senderId, repoRoot: senderRoot, displayName: "qa-sender", lastSeen: Date.now() }]
const manualDeps = {
  config, repoRoot: receiverRoot, projectDisplayName: "qa-receiver",
  getRegisteredProjects: () => projects,
  makeMailboxStore: (targetRoot: string, fromProjectId: string) =>
    new MailboxStore(targetRoot, fromProjectId, { reservation_ttl_ms: config.bounds.reservation_ttl_ms }),
  makeDigestStore: (root: string) => new BodyDigestStore(root, config.bounds.body_digest_ttl_min * 60_000),
  makeRateLimiter: (root: string) => new SamePairRateLimiter(root, config.bounds.same_pair_rate_limit_per_min),
  validateInbound,
  // The real wiring resolves this from live session state; here the session's primary is prometheus.
  resolveActivePrimaryAgent: () => "prometheus",
}

const peek = createProjectMailboxPeekTool(manualDeps)
const peekResult = JSON.parse((await peek.execute({}, { sessionID: "ses_qa" })) as string)

// Now run the REAL idle-drain hook with the same ineligible primary and read the trace artifact.
let dispatched = 0
const hook = createIdleDrainHook({
  ...manualDeps,
  validatePluginConfig: () => ({ valid: true, messages: [], config: { cross_project_mailbox: config } }),
  directory: receiverRoot,
  client: { session: { promptAsync: async () => ({}) } },
  makePendingStore: (targetRoot: string) => new PendingDeliveryStore(targetRoot),
  buildTriagePrompt,
  dispatchInternalPrompt: async () => { dispatched += 1; return { status: "dispatched", response: {} } },
  getSessionMessages: async () => [],
  emitTrace: createMailboxTraceEmit({ repoRoot: receiverRoot }),
} as never)

await hook["session.idle"]({ sessionId: "ses_qa" })
await new Promise((resolve) => setTimeout(resolve, 200))

const tracePath = traceLogPath(receiverRoot)
const traceLines = existsSync(tracePath)
  ? readFileSync(tracePath, "utf8").trim().split("\n").map((l) => JSON.parse(l))
  : []

console.log(JSON.stringify({
  peek: {
    pendingCount: peekResult.pending.length,
    autoDrain: peekResult.autoDrain,
  },
  idleDrain: {
    notesDispatched: dispatched,
    traceRecords: traceLines.map((r) => ({ phase: r.phase, waiting: r.waiting, detail: r.detail })),
  },
}, null, 2))
