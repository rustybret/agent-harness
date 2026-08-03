// Drives the REAL production sidebar path (readView -> loadMailboxSection ->
// readMailboxSidebarState) against a fixture repo containing one genuine
// mailbox envelope note and three stale hand-authored markdown docs.
import { mkdirSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { readView } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/tui-sidebar/view-loader"
import { serializeEnvelope } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/envelope/schema"

const root = mkdtempSync(path.join(tmpdir(), "omo-qa-sidebar-"))
const sender = "cloudhome-a1b2c3d4"
const inbox = path.join(root, "coordination_notes", sender)
mkdirSync(inbox, { recursive: true })
mkdirSync(path.join(root, ".omo"), { recursive: true })
writeFileSync(
  path.join(root, ".omo", "omo.jsonc"),
  JSON.stringify({ "[opencode]": { cross_project_mailbox: { enabled: true } } }, null, 2),
)

// 1 REAL note - a proper enveloped mailbox message
const realNote = serializeEnvelope(
  {
    version: 1,
    messageId: crypto.randomUUID(),
    timestamp: Date.now(),
    correlationId: crypto.randomUUID(),
    inReplyToMessageId: null,
    fromProject: "cloudhome",
    toProject: "agent-harness",
    fromProjectId: sender,
    toProjectId: "agent-harness-deadbeef",
    intent: "question",
    priority: 0,
    hopCount: 0,
    hopPath: [sender],
    supersedes: null,
  },
  "This is a genuine inbound mailbox note.\n",
)
writeFileSync(path.join(inbox, "real-note.md"), realNote)

// 3 STALE docs - exactly the shape cloudhome reported polluting their count
writeFileSync(path.join(inbox, "NOTES.md"), "# Scratchpad\n\nhand-authored, never delivered\n")
writeFileSync(path.join(inbox, "design.md"), "---\ntitle: a design doc\nauthor: a human\n---\nbody\n")
writeFileSync(path.join(inbox, "handoff.md"), "plain text with no frontmatter at all\n")

const view = await readView(root)
const mailbox = (view as { mailbox?: { inboundUnread?: number } }).mailbox
console.log(JSON.stringify({
  fixtureRoot: root,
  filesInInbox: 4,
  genuineEnvelopes: 1,
  staleDocs: 3,
  observedInboundUnread: mailbox?.inboundUnread ?? null,
  mailboxSection: mailbox ?? null,
}, null, 2))
