import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import type { PresenceDetail } from "../presence"
import type { ProjectEntry } from "../registry/types"
import { CrossProjectMailboxConfigSchema } from "../config"
import { projectIdForRoot } from "../envelope/project-id"
import type { OutboxEntry } from "../send-tool"
import {
  allowedSenderIds,
  type MailboxSidebarRegistryPort,
  readMailboxSidebarState,
} from "./mailbox-sidebar"

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

  it("#given a config with deny and unlisted senders #when reading projects #then only allow entries appear", async () => {
    // given
    const senderRoot = await makeRepo()
    const config = CrossProjectMailboxConfigSchema.parse({
      enabled: true,
      senders: {
        "proj-allow": { access: "allow", intent_budget: "quick" },
        "proj-deny": { access: "deny", intent_budget: "quick" },
      },
    })
    const entries: ProjectEntry[] = [
      { projectId: "proj-allow", displayName: "Allowed", registeredAt: 1000 },
      { projectId: "proj-deny", displayName: "Denied", registeredAt: 1000 },
      { projectId: "proj-unlisted", displayName: "Unlisted", registeredAt: 1000 },
    ]

    // when
    const result = await readMailboxSidebarState(senderRoot, config, emptyRegistry(), {
      projectEntries: entries,
    })

    // then
    expect(result).not.toBeNull()
    expect(result!.projects.length).toBe(1)
    expect(result!.projects[0]!.projectId).toBe("proj-allow")
  })

  it("#given allow-all default config #when some projects have explicit deny #then deny entries are excluded", async () => {
    // given
    const senderRoot = await makeRepo()
    const config = CrossProjectMailboxConfigSchema.parse({
      enabled: true,
      senders: {
        "proj-explicit-deny": { access: "deny", intent_budget: "quick" },
      },
    })
    const entries: ProjectEntry[] = [
      { projectId: "proj-explicit-deny", displayName: "Denied", registeredAt: 1000 },
    ]

    // when
    const result = await readMailboxSidebarState(senderRoot, config, emptyRegistry(), {
      projectEntries: entries,
    })

    // then
    expect(result!.projects.length).toBe(0)
  })

  it("#given an allow entry with missing registry #when reading projects #then shows projectId with long-ago label", async () => {
    // given
    const senderRoot = await makeRepo()
    const config = CrossProjectMailboxConfigSchema.parse({
      enabled: true,
      senders: {
        "proj-unknown": { access: "allow", intent_budget: "quick" },
      },
    })

    // when
    const result = await readMailboxSidebarState(senderRoot, config, emptyRegistry(), {
      projectEntries: [],
    })

    // then
    expect(result!.projects.length).toBe(1)
    const row = result!.projects[0]!
    expect(row.projectId).toBe("proj-unknown")
    expect(row.label).toBe("proj-unknown")
    expect(row.presence).toBe("lastSeen")
    expect(row.statusText).toBe("a long time ago")
    expect(row.dotColor).toBe("muted")
  })

  it("#given an allow entry with fake presence cache #when reading projects #then maps live to online/success", async () => {
    // given
    const senderRoot = await makeRepo()
    const config = CrossProjectMailboxConfigSchema.parse({
      enabled: true,
      senders: {
        "proj-live": { access: "allow", intent_budget: "quick" },
      },
    })
    const entries: ProjectEntry[] = [
      { projectId: "proj-live", displayName: "Live Project", registeredAt: 1000 },
    ]
    const liveDetail: PresenceDetail = {
      projectId: "proj-live",
      status: "live",
      heartbeatTs: Date.now(),
      repoRoot: "/tmp/test",
      registeredAt: 1000,
      lastSeenTs: Date.now(),
    }
    const fakeCache = {
      get: async () => liveDetail,
      getMany: async () => [liveDetail],
    }

    // when
    const result = await readMailboxSidebarState(senderRoot, config, emptyRegistry(), {
      projectEntries: entries,
      presenceCache: fakeCache,
    })

    // then
    expect(result!.projects.length).toBe(1)
    const row = result!.projects[0]!
    expect(row.presence).toBe("online")
    expect(row.dotColor).toBe("success")
    expect(row.statusText).toBe("online")
  })

  it("#given an allow entry with fake presence cache #when reading projects #then maps stale to pending/warning", async () => {
    // given
    const senderRoot = await makeRepo()
    const config = CrossProjectMailboxConfigSchema.parse({
      enabled: true,
      senders: {
        "proj-stale": { access: "allow", intent_budget: "quick" },
      },
    })
    const entries: ProjectEntry[] = [
      { projectId: "proj-stale", displayName: "Stale Project", registeredAt: 1000 },
    ]
    const staleDetail: PresenceDetail = {
      projectId: "proj-stale",
      status: "stale",
      heartbeatTs: Date.now() - 300_000,
      repoRoot: "/tmp/test",
      registeredAt: 1000,
      lastSeenTs: Date.now() - 300_000,
    }
    const fakeCache = {
      get: async () => staleDetail,
      getMany: async () => [staleDetail],
    }

    // when
    const result = await readMailboxSidebarState(senderRoot, config, emptyRegistry(), {
      projectEntries: entries,
      presenceCache: fakeCache,
    })

    // then
    expect(result!.projects.length).toBe(1)
    const row = result!.projects[0]!
    expect(row.presence).toBe("pending")
    expect(row.dotColor).toBe("warning")
    expect(row.statusText).toBe("~")
  })

  it("#given an allow entry with fake presence cache #when reading projects #then maps offline to lastSeen/muted with label", async () => {
    // given
    const senderRoot = await makeRepo()
    const config = CrossProjectMailboxConfigSchema.parse({
      enabled: true,
      senders: {
        "proj-offline": { access: "allow", intent_budget: "quick" },
      },
    })
    const entries: ProjectEntry[] = [
      { projectId: "proj-offline", displayName: "Offline Project", registeredAt: 1000 },
    ]
    const offlineDetail: PresenceDetail = {
      projectId: "proj-offline",
      status: "missing",
      heartbeatTs: Date.now() - 3_600_000,
      repoRoot: "/tmp/test",
      registeredAt: 1000,
      lastSeenTs: Date.now() - 3_600_000,
    }
    const fakeCache = {
      get: async () => offlineDetail,
      getMany: async () => [offlineDetail],
    }

    // when
    const result = await readMailboxSidebarState(senderRoot, config, emptyRegistry(), {
      projectEntries: entries,
      presenceCache: fakeCache,
    })

    // then
    expect(result!.projects.length).toBe(1)
    const row = result!.projects[0]!
    expect(row.presence).toBe("lastSeen")
    expect(row.dotColor).toBe("muted")
    expect(row.statusText).toBe("1 hour ago")
  })

  it("#given two projects with same displayName #when reading projects #then collision uses full projectId as label", async () => {
    // given
    const senderRoot = await makeRepo()
    const config = CrossProjectMailboxConfigSchema.parse({
      enabled: true,
      senders: {
        "proj-a-12345678": { access: "allow", intent_budget: "quick" },
        "proj-a-abcdef01": { access: "allow", intent_budget: "quick" },
      },
    })
    const entries: ProjectEntry[] = [
      { projectId: "proj-a-12345678", displayName: "proj-a", registeredAt: 1000 },
      { projectId: "proj-a-abcdef01", displayName: "proj-a", registeredAt: 1000 },
    ]

    // when
    const result = await readMailboxSidebarState(senderRoot, config, emptyRegistry(), {
      projectEntries: entries,
    })

    // then
    expect(result!.projects.length).toBe(2)
    expect(result!.projects[0]!.label).toBe("proj-a-12345678")
    expect(result!.projects[1]!.label).toBe("proj-a-abcdef01")
  })

  it("#given a single project with bare name #when reading projects #then strips hash suffix for label", async () => {
    // given
    const senderRoot = await makeRepo()
    const config = CrossProjectMailboxConfigSchema.parse({
      enabled: true,
      senders: {
        "proj-x-12345678": { access: "allow", intent_budget: "quick" },
      },
    })
    const entries: ProjectEntry[] = [
      { projectId: "proj-x-12345678", displayName: "proj-x", registeredAt: 1000 },
    ]

    // when
    const result = await readMailboxSidebarState(senderRoot, config, emptyRegistry(), {
      projectEntries: entries,
    })

    // then
    expect(result!.projects.length).toBe(1)
    expect(result!.projects[0]!.label).toBe("proj-x")
  })

  it("#given no presence cache provided #when reading projects #then falls back to createPresenceCache and treats as missing", async () => {
    // given
    const senderRoot = await makeRepo()
    const config = CrossProjectMailboxConfigSchema.parse({
      enabled: true,
      senders: {
        "proj-fallback": { access: "allow", intent_budget: "quick" },
      },
    })

    // when
    const result = await readMailboxSidebarState(senderRoot, config, emptyRegistry(), {
      projectEntries: [],
    })

    // then
    expect(result!.projects.length).toBe(1)
    const row = result!.projects[0]!
    expect(row.presence).toBe("lastSeen")
    expect(row.dotColor).toBe("muted")
  })

  it("#given mixed access senders #when calling allowedSenderIds #then only returns allow entries", () => {
    // given
    const config = CrossProjectMailboxConfigSchema.parse({
      enabled: true,
      senders: {
        "proj-a": { access: "allow", intent_budget: "quick" },
        "proj-b": { access: "deny", intent_budget: "quick" },
        "proj-c": { access: "allow", intent_budget: "quick" },
      },
    })

    // when
    const ids = allowedSenderIds(config)

    // then
    expect(ids).toEqual(["proj-a", "proj-c"])
  })


  it("#given a project in senders but missing from registry #when reading state #then it is shown by projectId with a long time ago", async () => {
    // given
    const senderRoot = await makeRepo()
    const config = CrossProjectMailboxConfigSchema.parse({
      enabled: true,
      senders: {
        "proj-missing": { access: "allow", intent_budget: "quick" },
      },
    })

    // when
    const result = await readMailboxSidebarState(senderRoot, config, emptyRegistry(), {
      readPresenceDetail: async () => ({ status: "unknown" }),
    })

    // then
    expect(result!.projects.length).toBe(1)
    const row = result!.projects[0]!
    expect(row.projectId).toBe("proj-missing")
    expect(row.presence).toBe("lastSeen")
    expect(row.statusText).toBe("a long time ago")
  })

  it("#given mixed access senders #when reading state #then strict-set filtering applies (deny + unlisted excluded even under allow-all default)", async () => {
    // given
    const senderRoot = await makeRepo()
    const config = CrossProjectMailboxConfigSchema.parse({
      enabled: true,
      senders: {
        "proj-allow": { access: "allow", intent_budget: "quick" },
        "proj-deny": { access: "deny", intent_budget: "quick" },
      },
    })

    // when
    const result = await readMailboxSidebarState(senderRoot, config, emptyRegistry(), {
      readPresenceDetail: async () => ({ status: "unknown" }),
    })

    // then
    expect(result!.projects.length).toBe(1)
    expect(result!.projects[0]!.projectId).toBe("proj-allow")
  })
})
