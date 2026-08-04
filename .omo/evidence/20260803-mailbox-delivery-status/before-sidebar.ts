// What the sender could see about a rejected note BEFORE mode=status: only the sidebar's
// aggregate outboundFailed counter - no messageId, no reason, no age.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { readMailboxSidebarState } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/sidebar"
import { CrossProjectMailboxConfigSchema } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/config"
import { projectIdForRoot } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/envelope"

const senderRoot = mkdtempSync(path.join(tmpdir(), "omo-qa-before-sender-"))
const targetRoot = mkdtempSync(path.join(tmpdir(), "omo-qa-before-target-"))
const senderId = projectIdForRoot(senderRoot)

mkdirSync(path.join(senderRoot, ".omo"), { recursive: true })
writeFileSync(
  path.join(senderRoot, ".omo", "mailbox-outbox.jsonl"),
  `${JSON.stringify({
    sentAt: Date.now() - 6 * 3600_000,
    toProjectId: "qa-target",
    toRepoRoot: targetRoot,
    messageId: "rejected-1",
    intent: "question",
    correlationId: "corr-1",
    body: "does this land?",
  })}\n`,
)

const rejectedDir = path.join(targetRoot, "coordination_notes", senderId, "rejected")
mkdirSync(rejectedDir, { recursive: true })
writeFileSync(path.join(rejectedDir, "rejected-1.md"), "quarantined\n")
writeFileSync(
  path.join(rejectedDir, "rejected-1.reason.json"),
  JSON.stringify({ reason: "over-budget", detail: "intent question above ceiling for this sender" }),
)

const state = await readMailboxSidebarState(
  senderRoot,
  CrossProjectMailboxConfigSchema.parse({ enabled: true }),
  { getRepoRootForProjectId: () => undefined },
)

console.log(JSON.stringify({
  note: "everything the sender could observe about the rejected note before mode=status",
  outboundRead: state?.outboundRead,
  outboundFailed: state?.outboundFailed,
  outboundUnresolved: state?.outboundUnresolved,
  rejectionReasonAvailable: false,
  ageAvailable: false,
  messageIdAvailable: false,
}, null, 2))
