// Drives the REAL registered project_message tool end to end across two fixture repos:
// send a note -> have the receiver's real MailboxStore.quarantine() reject it -> ask mode=status.
// Proves the sender can now see WHY a note never landed, which was previously invisible.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { MailboxStore } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/mailbox"
import { projectIdForRoot } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/envelope"
import { validatePluginConfig } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/config/validate"

function makeRepo(name: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `omo-qa-status-${name}-`))
  mkdirSync(path.join(root, ".omo"), { recursive: true })
  return root
}

const senderRoot = makeRepo("sender")
const targetRoot = makeRepo("target")
const senderId = projectIdForRoot(senderRoot)
const targetId = projectIdForRoot(targetRoot)

writeFileSync(
  path.join(senderRoot, ".omo", "omo.jsonc"),
  JSON.stringify({
    "[opencode]": {
      cross_project_mailbox: {
        enabled: true,
        senders: { [targetId]: { access: "allow", intent_budget: "plan" } },
      },
    },
  }),
)

const pluginConfig = validatePluginConfig(senderRoot).config
const registryEntries = [
  { projectId: targetId, repoRoot: targetRoot, displayName: "qa-target", lastSeen: Date.now() },
]
const deps = { listProjects: async () => registryEntries }

// Build the tool exactly as tool-registry-mailbox-tools does, but with a fixture registry so the QA
// exercises the tool code rather than this machine's real project registry.
const { createProjectMessageTool } = await import(
  "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/cross-project-mailbox/send-tool/project-message-tool"
)
const tool = createProjectMessageTool({
  config: pluginConfig.cross_project_mailbox!,
  thisProjectId: senderId,
  thisRepoRoot: senderRoot,
  thisProjectDisplayName: "qa-sender",
  registry: deps,
})

const sent = JSON.parse(
  (await tool.execute({ targetProjectId: targetId, intent: "question", body: "does this land?" }, {})) as string,
) as { ok?: boolean; messageId?: string }

const statusPending = JSON.parse((await tool.execute({ mode: "status" }, {})) as string)

// Receiver rejects it through the REAL store path that a hard reject uses.
const store = new MailboxStore(targetRoot, senderId, { reservation_ttl_ms: 120000 })
await store.quarantine(sent.messageId!, "over-budget", "intent question above ceiling for this sender")

const statusRejected = JSON.parse((await tool.execute({ mode: "status" }, {})) as string)

console.log(JSON.stringify({
  sentOk: sent.ok === true,
  messageId: sent.messageId,
  beforeReject: { summary: statusPending.summary, needsAttention: statusPending.needsAttention },
  afterReject: { summary: statusRejected.summary, needsAttention: statusRejected.needsAttention },
}, null, 2))
