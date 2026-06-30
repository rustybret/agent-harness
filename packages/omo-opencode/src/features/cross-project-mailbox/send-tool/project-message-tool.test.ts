import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { CrossProjectMailboxConfigSchema, type CrossProjectMailboxConfig } from "../config"
import { type MailboxMessage, serializeEnvelope } from "../envelope/schema"
import type { ProjectEntry } from "../registry/types"
import {
  createProjectMessageTool,
  ProjectMessageInputSchema,
  type ProjectMessageToolDeps,
  runProjectMessageSend,
  runSendPreflight,
} from "./index"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const THIS_PROJECT_ID = "proj-c"

let thisRepoRoot: string
let targetBRoot: string
let targetARoot: string
let projects: ProjectEntry[]
let emptyConfigHome: string
let savedXdgConfigHome: string | undefined
let savedOpencodeConfigDir: string | undefined

const PERMISSIVE_SENDERS = {
  "proj-b": { access: "allow", intent_budget: "plan" },
  "proj-a": { access: "allow", intent_budget: "plan" },
}

async function writeProjectMailboxConfig(mailbox: Record<string, unknown>): Promise<void> {
  const dir = path.join(thisRepoRoot, ".opencode")
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, "oh-my-openagent.json"), JSON.stringify({ cross_project_mailbox: mailbox }))
}

async function writeRawProjectConfig(content: string): Promise<void> {
  const dir = path.join(thisRepoRoot, ".opencode")
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, "oh-my-openagent.json"), content)
}

beforeEach(async () => {
  thisRepoRoot = await mkdtemp(path.join(os.tmpdir(), "cpm-send-this-"))
  targetBRoot = await mkdtemp(path.join(os.tmpdir(), "cpm-send-b-"))
  targetARoot = await mkdtemp(path.join(os.tmpdir(), "cpm-send-a-"))
  emptyConfigHome = await mkdtemp(path.join(os.tmpdir(), "cpm-xdg-"))
  savedXdgConfigHome = process.env.XDG_CONFIG_HOME
  savedOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR
  process.env.XDG_CONFIG_HOME = emptyConfigHome
  delete process.env.OPENCODE_CONFIG_DIR
  projects = [
    { projectId: "proj-b", repoRoot: targetBRoot, displayName: "Project B", lastSeen: 1 },
    { projectId: "proj-a", repoRoot: targetARoot, displayName: "Project A", lastSeen: 2 },
  ]
})

afterEach(async () => {
  if (savedXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedXdgConfigHome
  if (savedOpencodeConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
  else process.env.OPENCODE_CONFIG_DIR = savedOpencodeConfigDir
  await rm(thisRepoRoot, { recursive: true, force: true })
  await rm(targetBRoot, { recursive: true, force: true })
  await rm(targetARoot, { recursive: true, force: true })
  await rm(emptyConfigHome, { recursive: true, force: true })
})

function cfg(overrides: Record<string, unknown> = {}): CrossProjectMailboxConfig {
  return CrossProjectMailboxConfigSchema.parse({
    enabled: true,
    senders: {
      "proj-b": { access: "allow", intent_budget: "plan" },
      "proj-a": { access: "allow", intent_budget: "plan" },
    },
    ...overrides,
  })
}

interface SpyHandle {
  deps: ProjectMessageToolDeps
  writeCalls: number
  outboxCalls: number
}

function spyDeps(config: CrossProjectMailboxConfig): SpyHandle {
  const handle: SpyHandle = {
    writeCalls: 0,
    outboxCalls: 0,
    deps: {
      config,
      thisProjectId: THIS_PROJECT_ID,
      thisRepoRoot,
      thisProjectDisplayName: "Project C",
      registry: { listProjects: async () => projects },
      writeNote: async () => {
        handle.writeCalls += 1
      },
      appendOutbox: async () => {
        handle.outboxCalls += 1
      },
    },
  }
  return handle
}

function realDeps(config: CrossProjectMailboxConfig): ProjectMessageToolDeps {
  return {
    config,
    thisProjectId: THIS_PROJECT_ID,
    thisRepoRoot,
    thisProjectDisplayName: "Project C",
    registry: { listProjects: async () => projects },
  }
}

async function writeParentNote(senderId: string, parent: MailboxMessage): Promise<void> {
  const dir = path.join(thisRepoRoot, "coordination_notes", senderId, "processed")
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${parent.messageId}.md`), serializeEnvelope(parent, "parent body"))
}

function makeParent(overrides: Partial<MailboxMessage> = {}): MailboxMessage {
  return {
    version: 1,
    messageId: randomUUID(),
    timestamp: Date.now(),
    correlationId: randomUUID(),
    inReplyToMessageId: null,
    fromProject: "Project A",
    toProject: "Project B",
    fromProjectId: "proj-a",
    toProjectId: "proj-b",
    intent: "quick",
    priority: 0,
    hopCount: 1,
    hopPath: ["proj-a", "proj-b"],
    supersedes: null,
    ...overrides,
  }
}

describe("runProjectMessageSend - fresh send", () => {
  it("writes the note, originates at hop 0, and appends one outbox line when no threadId given", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const def = createProjectMessageTool(realDeps(cfg()))

    // when
    const out = await def.execute(
      { targetProjectId: "proj-b", intent: "quick", body: "hello" },
      {},
    )
    const parsed = JSON.parse(out as string) as {
      ok: boolean
      envelope: MailboxMessage
    }

    // then
    expect(parsed.ok).toBe(true)
    expect(parsed.envelope.hopCount).toBe(0)
    expect(parsed.envelope.hopPath).toEqual([THIS_PROJECT_ID])
    expect(parsed.envelope.correlationId).toMatch(UUID_REGEX)

    const notePath = path.join(
      targetBRoot,
      "coordination_notes",
      THIS_PROJECT_ID,
      `${parsed.envelope.messageId}.md`,
    )
    const noteContent = await readFile(notePath, "utf8")
    expect(noteContent).toContain("hello")

    const outboxRaw = await readFile(path.join(thisRepoRoot, ".omo", "mailbox-outbox.jsonl"), "utf8")
    const lines = outboxRaw.trim().split("\n")
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0] ?? "{}") as {
      sentAt: number
      toProjectId: string
      messageId: string
      intent: string
      correlationId: string
    }
    expect(entry.toProjectId).toBe("proj-b")
    expect(entry.messageId).toBe(parsed.envelope.messageId)
    expect(entry.intent).toBe("quick")
    expect(entry.correlationId).toBe(parsed.envelope.correlationId)
  })

  it("honors threadId as correlationId on a fresh send", async () => {
    // given
    const customThread = randomUUID()
    const handle = spyDeps(cfg())

    // when
    const result = await runProjectMessageSend(
      { targetProjectId: "proj-b", intent: "quick", body: "hello", threadId: customThread },
      handle.deps,
    )

    // then
    if (!("ok" in result)) throw new Error("expected ok result")
    expect(result.envelope.correlationId).toBe(customThread)
    expect(result.envelope.hopCount).toBe(0)
  })
})

describe("runProjectMessageSend - reply", () => {
  it("appends a hop, extends the hopPath, and inherits the parent correlationId", async () => {
    // given
    const originalCorr = randomUUID()
    const parent = makeParent({ correlationId: originalCorr, hopCount: 1, hopPath: ["proj-a", "proj-b"] })
    await writeParentNote("proj-a", parent)

    // when
    const result = await runProjectMessageSend(
      {
        targetProjectId: "proj-a",
        intent: "quick",
        body: "reply",
        inReplyToMessageId: parent.messageId,
      },
      spyDeps(cfg()).deps,
    )

    // then
    if (!("ok" in result)) throw new Error("expected ok result")
    expect(result.envelope.hopCount).toBe(2)
    expect(result.envelope.hopPath).toEqual(["proj-a", "proj-b", THIS_PROJECT_ID])
    expect(result.envelope.correlationId).toBe(originalCorr)
    expect(result.envelope.inReplyToMessageId).toBe(parent.messageId)
  })

  it("ignores threadId input on a reply (parent correlationId wins)", async () => {
    // given
    const originalCorr = randomUUID()
    const parent = makeParent({ correlationId: originalCorr })
    await writeParentNote("proj-a", parent)

    // when
    const result = await runProjectMessageSend(
      {
        targetProjectId: "proj-a",
        intent: "quick",
        body: "reply",
        threadId: randomUUID(),
        inReplyToMessageId: parent.messageId,
      },
      spyDeps(cfg()).deps,
    )

    // then
    if (!("ok" in result)) throw new Error("expected ok result")
    expect(result.envelope.correlationId).toBe(originalCorr)
  })

  it("returns a typed error and writes nothing when the reply parent is not found", async () => {
    // given
    const handle = spyDeps(cfg())

    // when
    const result = await runProjectMessageSend(
      {
        targetProjectId: "proj-a",
        intent: "quick",
        body: "reply",
        inReplyToMessageId: randomUUID(),
      },
      handle.deps,
    )

    // then
    expect(result).toEqual({ error: "reply-parent-not-found" })
    expect(handle.writeCalls).toBe(0)
    expect(handle.outboxCalls).toBe(0)
  })
})

describe("ProjectMessageInputSchema - strict", () => {
  it("rejects raw hopCount input", () => {
    // given
    const raw = { targetProjectId: "proj-b", intent: "quick", body: "hello", hopCount: 5 }

    // when
    const parsed = ProjectMessageInputSchema.safeParse(raw)

    // then
    expect(parsed.success).toBe(false)
  })

  it("rejects raw hopPath and correlationId inputs", () => {
    // given
    const raw = {
      targetProjectId: "proj-b",
      intent: "quick",
      body: "hello",
      hopPath: ["proj-c"],
      correlationId: randomUUID(),
    }

    // when
    const parsed = ProjectMessageInputSchema.safeParse(raw)

    // then
    expect(parsed.success).toBe(false)
  })
})

describe("runSendPreflight", () => {
  const targetEntry: ProjectEntry = { projectId: "proj-b", repoRoot: "/tmp/b", displayName: "B", lastSeen: 1 }

  it("blocks an over-budget intent", async () => {
    // given
    const config = cfg({ senders: { "proj-b": { access: "allow", intent_budget: "quick" } } })

    // when
    const result = await runSendPreflight(
      { targetProjectId: "proj-b", intent: "plan", body: "x" },
      0,
      config,
      targetEntry,
    )

    // then
    expect(result).toEqual({ blocked: true, reason: "over-budget" })
  })

  it("blocks an unauthorized sender", async () => {
    // given
    const config = cfg({ senders: { "proj-b": { access: "deny", intent_budget: "plan" } } })

    // when
    const result = await runSendPreflight(
      { targetProjectId: "proj-b", intent: "quick", body: "x" },
      0,
      config,
      targetEntry,
    )

    // then
    expect(result).toEqual({ blocked: true, reason: "unauthorized" })
  })

  it("blocks when the hop cap would be reached", async () => {
    // given
    const config = cfg({ bounds: { max_hops: 2 } })

    // when
    const result = await runSendPreflight(
      { targetProjectId: "proj-b", intent: "quick", body: "x" },
      2,
      config,
      targetEntry,
    )

    // then
    expect(result).toEqual({ blocked: true, reason: "hop-exceeded" })
  })

  it("blocks when the target is not registered", async () => {
    // given
    const config = cfg()

    // when
    const result = await runSendPreflight(
      { targetProjectId: "proj-b", intent: "quick", body: "x" },
      0,
      config,
      undefined,
    )

    // then
    expect(result).toEqual({ blocked: true, reason: "target-not-found" })
  })
})

describe("runProjectMessageSend - target not in registry", () => {
  it("returns target-not-found and writes nothing", async () => {
    // given
    const handle = spyDeps(cfg())

    // when
    const result = await runProjectMessageSend(
      { targetProjectId: "unknown-project", intent: "quick", body: "hello" },
      handle.deps,
    )

    // then
    expect(result).toEqual({ error: "target-not-found" })
    expect(handle.writeCalls).toBe(0)
    expect(handle.outboxCalls).toBe(0)
  })

  it("resolves target by display name (case-insensitive) when projectId has no match", async () => {
    // given
    const handle = spyDeps(cfg({ senders: { "proj-b": { access: "allow", intent_budget: "plan" } } }))

    // when: pass "Project B" (display name) instead of "proj-b" (projectId)
    const result = await runProjectMessageSend(
      { targetProjectId: "Project B", intent: "quick", body: "display name fallback test" },
      handle.deps,
    )

    // then
    expect("ok" in result && result.ok).toBe(true)
    expect(handle.writeCalls).toBe(1)
  })

  it("logs the canonical projectId and target repoRoot in the outbox when resolved by display name", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const def = createProjectMessageTool(realDeps(cfg()))

    // when: target by display name "Project B", which resolves to canonical "proj-b"
    const out = await def.execute(
      { targetProjectId: "Project B", intent: "quick", body: "canonical outbox test" },
      {},
    )
    const parsed = JSON.parse(out as string) as { ok: boolean }

    // then
    expect(parsed.ok).toBe(true)
    const outboxRaw = await readFile(path.join(thisRepoRoot, ".omo", "mailbox-outbox.jsonl"), "utf8")
    const line = outboxRaw.trim().split("\n").at(-1) ?? "{}"
    const entry = JSON.parse(line) as { toProjectId: string; toRepoRoot?: string }
    expect(entry.toProjectId).toBe("proj-b")
    expect(entry.toRepoRoot).toBe(targetBRoot)
  })
})

describe("runProjectMessageSend - preflight blocks before write", () => {
  it("does not write or append when preflight blocks", async () => {
    // given
    const handle = spyDeps(cfg({ senders: { "proj-b": { access: "deny", intent_budget: "plan" } } }))

    // when
    const result = await runProjectMessageSend(
      { targetProjectId: "proj-b", intent: "quick", body: "hello" },
      handle.deps,
    )

    // then
    expect(result).toEqual({ blocked: true, reason: "unauthorized" })
    expect(handle.writeCalls).toBe(0)
    expect(handle.outboxCalls).toBe(0)
  })
})

describe("createProjectMessageTool - lazy per-send config reload", () => {
  it("observes a newly-allowed sender written to disk between two execute calls without rebuilding the tool", async () => {
    // given
    await writeProjectMailboxConfig({
      enabled: true,
      senders: {
        "proj-b": { access: "deny", intent_budget: "plan" },
        "proj-a": { access: "allow", intent_budget: "plan" },
      },
    })
    const def = createProjectMessageTool(realDeps(cfg()))

    // when
    const first = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "first" }, {})) as string,
    ) as { blocked?: boolean; reason?: string }

    // then
    expect(first.blocked).toBe(true)
    expect(first.reason).toBe("unauthorized")

    // when
    await writeProjectMailboxConfig({
      enabled: true,
      senders: {
        "proj-b": { access: "allow", intent_budget: "plan" },
        "proj-a": { access: "allow", intent_budget: "plan" },
      },
    })
    const second = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "second" }, {})) as string,
    ) as { ok?: boolean }

    // then
    expect(second.ok).toBe(true)
  })

  it("rejects a body above the runtime min-cap with a clean blocked result when max_body_bytes is lowered", async () => {
    // given
    await writeProjectMailboxConfig({
      enabled: true,
      senders: PERMISSIVE_SENDERS,
      bounds: { max_body_bytes: 1000 },
    })
    const def = createProjectMessageTool(realDeps(cfg()))

    // when
    const out = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "x".repeat(2000) }, {})) as string,
    ) as { blocked?: boolean; reason?: string }

    // then
    expect(out.blocked).toBe(true)
    expect(out.reason).toContain("1000")
  })

  it("still rejects a 40000-byte body when max_body_bytes is raised to 99999 (hard cap 32768)", async () => {
    // given
    await writeProjectMailboxConfig({
      enabled: true,
      senders: PERMISSIVE_SENDERS,
      bounds: { max_body_bytes: 99999 },
    })
    const def = createProjectMessageTool(realDeps(cfg()))

    // when
    const out = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "x".repeat(40000) }, {})) as string,
    ) as { blocked?: boolean; reason?: string }

    // then
    expect(out.blocked).toBe(true)
    expect(out.reason).toContain("32768")
  })

  it("falls back to last-good config and still completes the send when the on-disk config is malformed", async () => {
    // given
    await writeRawProjectConfig("{ this is not valid json")
    const def = createProjectMessageTool(realDeps(cfg()))

    // when
    const out = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "fallback body" }, {})) as string,
    ) as { ok?: boolean }

    // then
    expect(out.ok).toBe(true)
  })

  it("returns a blocked result when a fresh on-disk read reports the mailbox disabled", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: false, senders: PERMISSIVE_SENDERS })
    const def = createProjectMessageTool(realDeps(cfg()))

    // when
    const out = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "disabled body" }, {})) as string,
    ) as { blocked?: boolean }

    // then
    expect(out.blocked).toBe(true)
  })
})
