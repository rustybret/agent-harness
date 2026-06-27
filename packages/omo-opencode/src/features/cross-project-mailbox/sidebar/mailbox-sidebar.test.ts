import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { CrossProjectMailboxConfigSchema } from "../config"
import type { OutboxEntry } from "../send-tool"
import { readMailboxSidebarState } from "./mailbox-sidebar"

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
    const result = await readMailboxSidebarState(root, enabledConfig())

    // then
    expect(result).not.toBeNull()
    expect(result?.inboundUnread).toBe(2)
    expect(result?.inboundProcessed).toBe(1)
  })

  it("#given an empty coordination_notes dir #when reading sidebar state #then inbound counts are zero", async () => {
    // given
    const root = await makeRepo()
    await mkdir(path.join(root, "coordination_notes"), { recursive: true })

    // when
    const result = await readMailboxSidebarState(root, enabledConfig())

    // then
    expect(result).not.toBeNull()
    expect(result?.inboundUnread).toBe(0)
    expect(result?.inboundProcessed).toBe(0)
  })

  it("#given five outbox entries #when reading sidebar state #then it returns total count and the last three most recent first", async () => {
    // given
    const root = await makeRepo()
    const entries = [0, 1, 2, 3, 4].map((index) => outboxEntry(index))
    await writeOutboxLog(root, entries)

    // when
    const result = await readMailboxSidebarState(root, enabledConfig())

    // then
    expect(result).not.toBeNull()
    expect(result?.recentSentCount).toBe(5)
    expect(result?.recentSent.map((entry) => entry.messageId)).toEqual(["msg-4", "msg-3", "msg-2"])
  })

  it("#given no outbox log file #when reading sidebar state #then recent sent is empty", async () => {
    // given
    const root = await makeRepo()

    // when
    const result = await readMailboxSidebarState(root, enabledConfig())

    // then
    expect(result).not.toBeNull()
    expect(result?.recentSentCount).toBe(0)
    expect(result?.recentSent).toEqual([])
  })

  it("#given a disabled config #when reading sidebar state #then it returns null", async () => {
    // given
    const root = await makeRepo()
    await writeNote(root, "alpha", "msg-1.md")

    // when
    const result = await readMailboxSidebarState(root, disabledConfig())

    // then
    expect(result).toBeNull()
  })
})
