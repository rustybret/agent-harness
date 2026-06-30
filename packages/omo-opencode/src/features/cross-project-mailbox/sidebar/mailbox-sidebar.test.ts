import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { CrossProjectMailboxConfigSchema } from "../config"
import { projectIdForRoot } from "../envelope/project-id"
import type { OutboxEntry } from "../send-tool"
import { type MailboxSidebarRegistryPort, readMailboxSidebarState } from "./mailbox-sidebar"

const createdRoots: string[] = []

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "mailbox-sidebar-"))
  createdRoots.push(root)
  return root
}

function enabledConfig() {
  return CrossProjectMailboxConfigSchema.parse({ enabled: true })
}

function disabledConfig() {
  return CrossProjectMailboxConfigSchema.parse({ enabled: false })
}

function emptyRegistry(): MailboxSidebarRegistryPort {
  return { getRepoRootForProjectId: () => undefined }
}

function countingRegistry(resolver: (id: string) => string | undefined): {
  registry: MailboxSidebarRegistryPort
  calls: () => number
} {
  let calls = 0
  return {
    registry: {
      getRepoRootForProjectId: (id) => {
        calls += 1
        return resolver(id)
      },
    },
    calls: () => calls,
  }
}

async function writeNote(root: string, sender: string, name: string): Promise<void> {
  const dir = path.join(root, "coordination_notes", sender)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, name), "note body\n", "utf8")
}

async function writeProcessed(root: string, sender: string, name: string): Promise<void> {
  const dir = path.join(root, "coordination_notes", sender, "processed")
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, name), "processed body\n", "utf8")
}

function outboxEntry(index: number): OutboxEntry {
  return {
    sentAt: 1_000 + index,
    toProjectId: `proj-${index}`,
    messageId: `msg-${index}`,
    intent: "quick",
    correlationId: `corr-${index}`,
    body: `body ${index}`,
  }
}

async function writeOutboxLog(root: string, entries: readonly OutboxEntry[]): Promise<void> {
  const dir = path.join(root, ".omo")
  await mkdir(dir, { recursive: true })
  const lines = entries.map((entry) => JSON.stringify(entry)).join("\n")
  await writeFile(path.join(dir, "mailbox-outbox.jsonl"), `${lines}\n`, "utf8")
}

// places a processed/rejected marker note in the target's inbox-from-sender dir
async function writeTargetAck(
  targetRoot: string,
  senderProjectId: string,
  bucket: "processed" | "rejected",
  messageId: string,
): Promise<void> {
  const dir = path.join(targetRoot, "coordination_notes", senderProjectId, bucket)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${messageId}.md`), "acked\n", "utf8")
}

describe("readMailboxSidebarState", () => {
  afterEach(async () => {
    const { rm } = await import("node:fs/promises")
    while (createdRoots.length > 0) {
      const root = createdRoots.pop()
      if (root !== undefined) await rm(root, { recursive: true, force: true })
    }
  })

  it("#given two unread and one processed note #when reading sidebar state #then it counts inbound unread and processed", async () => {
    // given
    const root = await makeRepo()
    await writeNote(root, "alpha", "msg-1.md")
    await writeNote(root, "alpha", "msg-2.md")
    await writeProcessed(root, "alpha", "msg-0.md")

    // when
    const result = await readMailboxSidebarState(root, enabledConfig(), emptyRegistry())

    // then
    expect(result).not.toBeNull()
    expect(result?.inboundUnread).toBe(2)
    expect(result?.inboundProcessed).toBe(1)
  })

  it("#given a disabled config #when reading sidebar state #then it returns null", async () => {
    // given
    const root = await makeRepo()
    await writeNote(root, "alpha", "msg-1.md")

    // when
    const result = await readMailboxSidebarState(root, disabledConfig(), emptyRegistry())

    // then
    expect(result).toBeNull()
  })

  it("#given a reserved delivering note in the inbox #when reading sidebar state #then it is excluded from inbound unread", async () => {
    // given
    const root = await makeRepo()
    await writeNote(root, "alpha", "msg-1.md")
    await writeNote(root, "alpha", ".delivering-msg-2.md")

    // when
    const result = await readMailboxSidebarState(root, enabledConfig(), emptyRegistry())

    // then
    expect(result?.inboundUnread).toBe(1)
  })

  it("#given three sent notes acked rejected and pending #when reading sidebar state #then outbound counts split 1 read 1 failed 1 unresolved", async () => {
    // given
    const senderRoot = await makeRepo()
    const targetRoot = await makeRepo()
    const senderProjectId = projectIdForRoot(senderRoot)

    const acked: OutboxEntry = { ...outboxEntry(1), toRepoRoot: targetRoot, messageId: "acked-1" }
    const rejected: OutboxEntry = { ...outboxEntry(2), toRepoRoot: targetRoot, messageId: "rejected-1" }
    // pending entry resolves its target via the registry by a display-name id (legacy log)
    const pending: OutboxEntry = { ...outboxEntry(3), toProjectId: "Legacy Display Name", messageId: "pending-1" }

    await writeOutboxLog(senderRoot, [acked, rejected, pending])
    await writeTargetAck(targetRoot, senderProjectId, "processed", "acked-1")
    await writeTargetAck(targetRoot, senderProjectId, "rejected", "rejected-1")

    const registry: MailboxSidebarRegistryPort = {
      getRepoRootForProjectId: (id) => (id === "Legacy Display Name" ? targetRoot : undefined),
    }

    // when
    const result = await readMailboxSidebarState(senderRoot, enabledConfig(), registry)

    // then
    expect(result?.outboundRead).toBe(1)
    expect(result?.outboundFailed).toBe(1)
    expect(result?.outboundUnresolved).toBe(1)
  })

  it("#given a target repoRoot that cannot be resolved #when reading sidebar state #then it does not throw and counts as unresolved", async () => {
    // given
    const senderRoot = await makeRepo()
    const orphan: OutboxEntry = { ...outboxEntry(1), messageId: "orphan-1" }
    await writeOutboxLog(senderRoot, [orphan])

    // when
    const result = await readMailboxSidebarState(senderRoot, enabledConfig(), emptyRegistry())

    // then
    expect(result?.outboundUnresolved).toBe(1)
    expect(result?.outboundRead).toBe(0)
    expect(result?.outboundFailed).toBe(0)
  })

  it("#given a resolved target whose repoRoot dir is missing #when reading sidebar state #then it does not throw and counts as unresolved", async () => {
    // given
    const senderRoot = await makeRepo()
    const missingRoot = path.join(senderRoot, "does", "not", "exist")
    const entry: OutboxEntry = { ...outboxEntry(1), toRepoRoot: missingRoot, messageId: "ghost-1" }
    await writeOutboxLog(senderRoot, [entry])

    // when
    const result = await readMailboxSidebarState(senderRoot, enabledConfig(), emptyRegistry())

    // then
    expect(result?.outboundUnresolved).toBe(1)
  })

  it("#given more than the ack window of entries #when reading sidebar state #then only the last window is stat checked", async () => {
    // given
    const senderRoot = await makeRepo()
    const total = 60
    const entries = Array.from({ length: total }, (_unused, index) => outboxEntry(index))
    await writeOutboxLog(senderRoot, entries)
    const { registry, calls } = countingRegistry(() => undefined)

    // when
    const result = await readMailboxSidebarState(senderRoot, enabledConfig(), registry)

    // then
    expect(calls()).toBe(50)
    expect(result?.outboundUnresolved).toBe(50)
  })
})
