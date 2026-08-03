import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { CrossProjectMailboxConfigSchema, type CrossProjectMailboxConfig } from "../config"
import { type MailboxMessage, serializeEnvelope } from "../envelope/schema"
import type { PresenceStatus } from "../presence"
import type { ProjectEntry } from "../registry/types"
import type { MailboxModeState, ModeDetectTrigger, ModeDetector } from "../presence"
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

describe("runProjectMessageSend - requested_mode", () => {
  it("writes requested_mode into the target envelope frontmatter and the outbox line", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const def = createProjectMessageTool(realDeps(cfg()))

    // when
    const out = await def.execute(
      { targetProjectId: "proj-b", intent: "quick", body: "routed", requested_mode: "subagent" },
      {},
    )
    const parsed = JSON.parse(out as string) as { ok: boolean; envelope: MailboxMessage }

    // then
    expect(parsed.ok).toBe(true)
    expect(parsed.envelope.requested_mode).toBe("subagent")

    const notePath = path.join(
      targetBRoot,
      "coordination_notes",
      THIS_PROJECT_ID,
      `${parsed.envelope.messageId}.md`,
    )
    const noteContent = await readFile(notePath, "utf8")
    expect(noteContent).toContain("requested_mode: subagent")

    const outboxRaw = await readFile(path.join(thisRepoRoot, ".omo", "mailbox-outbox.jsonl"), "utf8")
    const entry = JSON.parse(outboxRaw.trim()) as { requestedMode?: string }
    expect(entry.requestedMode).toBe("subagent")
  })

  it("triggers the target mailbox drain immediately after an interrupt-mode note is written", async () => {
    // given
    const triggerCalls: string[] = []
    const handle = spyDeps(cfg())
    handle.deps.triggerInterruptDrainNow = async (targetRepoRoot) => {
      triggerCalls.push(targetRepoRoot)
      return { triggered: true }
    }

    // when
    const result = await runProjectMessageSend(
      { targetProjectId: "proj-b", intent: "plan", body: "urgent", requested_mode: "interrupt" },
      handle.deps,
    )

    // then
    if (!("ok" in result)) throw new Error("expected ok result")
    expect(result.interruptDrainNow).toEqual({ triggered: true })
    expect(triggerCalls).toEqual([targetBRoot])
    expect(handle.writeCalls).toBe(1)
  })

  it("keeps an interrupt-mode send successful when the immediate drain trigger degrades", async () => {
    // given
    const handle = spyDeps(cfg())
    handle.deps.triggerInterruptDrainNow = async () => ({ triggered: false })

    // when
    const result = await runProjectMessageSend(
      { targetProjectId: "proj-b", intent: "plan", body: "urgent", requested_mode: "interrupt" },
      handle.deps,
    )

    // then
    if (!("ok" in result)) throw new Error("expected ok result")
    expect(result.interruptDrainNow).toEqual({ triggered: false })
    expect(handle.writeCalls).toBe(1)
  })

  it("omits requested_mode from envelope frontmatter and outbox line when not requested (legacy shape)", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const def = createProjectMessageTool(realDeps(cfg()))

    // when
    const out = await def.execute(
      { targetProjectId: "proj-b", intent: "quick", body: "plain" },
      {},
    )
    const parsed = JSON.parse(out as string) as { ok: boolean; envelope: MailboxMessage }

    // then
    expect(parsed.ok).toBe(true)
    expect(parsed.envelope.requested_mode).toBeUndefined()

    const notePath = path.join(
      targetBRoot,
      "coordination_notes",
      THIS_PROJECT_ID,
      `${parsed.envelope.messageId}.md`,
    )
    const noteContent = await readFile(notePath, "utf8")
    expect(noteContent).not.toContain("requested_mode")

    const outboxRaw = await readFile(path.join(thisRepoRoot, ".omo", "mailbox-outbox.jsonl"), "utf8")
    const entry = JSON.parse(outboxRaw.trim()) as Record<string, unknown>
    expect("requestedMode" in entry).toBe(false)
  })

  it("rejects an invalid requested_mode value without writing (blocked JSON, no file)", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const def = createProjectMessageTool(realDeps(cfg()))

    // when
    let threw = false
    try {
      await def.execute(
        { targetProjectId: "proj-b", intent: "quick", body: "bogus", requested_mode: "bogus" },
        {},
      )
    } catch {
      threw = true
    }

    // then: invalid enum is rejected at zod parse (strict send side), nothing written
    expect(threw).toBe(true)
    const outboxExists = await readFile(path.join(thisRepoRoot, ".omo", "mailbox-outbox.jsonl"), "utf8")
      .then(() => true)
      .catch(() => false)
    expect(outboxExists).toBe(false)
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

describe("runSendPreflight - category gate", () => {
  const targetEntry: ProjectEntry = { projectId: "proj-b", repoRoot: "/tmp/b", displayName: "B", lastSeen: 1 }

  it("accepts category quick under an impl ceiling even when intent would map higher", async () => {
    // given
    const config = cfg({ senders: { "proj-b": { access: "allow", intent_budget: "impl" } } })

    // when
    const result = await runSendPreflight(
      { targetProjectId: "proj-b", intent: "plan", body: "x", category: "quick" },
      0,
      config,
      targetEntry,
    )

    // then
    expect(result).toEqual({ blocked: false })
  })

  it("rejects category deep under an impl ceiling even when intent would pass", async () => {
    // given
    const config = cfg({ senders: { "proj-b": { access: "allow", intent_budget: "impl" } } })

    // when
    const result = await runSendPreflight(
      { targetProjectId: "proj-b", intent: "quick", body: "x", category: "deep" },
      0,
      config,
      targetEntry,
    )

    // then
    expect(result).toEqual({ blocked: true, reason: "over-budget" })
  })

  it("falls back to the intent gate when category is omitted", async () => {
    // given
    const config = cfg({ senders: { "proj-b": { access: "allow", intent_budget: "impl" } } })

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
})

describe("createProjectMessageTool - multibyte body byte cap", () => {
  it("rejects a multibyte body whose utf8 byte length exceeds the cap even when its code-unit length does not", async () => {
    // given: "€" is 1 UTF-16 code unit but 3 UTF-8 bytes; 4 of them = 4 code units, 12 bytes
    await writeProjectMailboxConfig({
      enabled: true,
      senders: PERMISSIVE_SENDERS,
      bounds: { max_body_bytes: 10 },
    })
    const def = createProjectMessageTool(realDeps(cfg()))

    // when
    const out = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "\u20AC\u20AC\u20AC\u20AC" }, {})) as string,
    ) as { blocked?: boolean; reason?: string }

    // then
    expect(out.blocked).toBe(true)
    expect(out.reason).toContain("10")
  })

  it("accepts a multibyte body exactly at the utf8 byte cap boundary", async () => {
    // given: 3 "€" chars = 3 code units, exactly 9 bytes
    await writeProjectMailboxConfig({
      enabled: true,
      senders: PERMISSIVE_SENDERS,
      bounds: { max_body_bytes: 9 },
    })
    const def = createProjectMessageTool(realDeps(cfg()))

    // when
    const out = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "\u20AC\u20AC\u20AC" }, {})) as string,
    ) as { ok?: boolean }

    // then
    expect(out.ok).toBe(true)
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

interface LaunchSpyHandle {
  deps: ProjectMessageToolDeps
  presenceCalls: string[]
  launchCalls: Array<{ repoRoot: string; projectId: string; policy: string }>
  writeCalls: number
}

function launchSpyDeps(
  config: CrossProjectMailboxConfig,
  presence: PresenceStatus,
): LaunchSpyHandle {
  const handle: LaunchSpyHandle = {
    presenceCalls: [],
    launchCalls: [],
    writeCalls: 0,
    deps: {
      config,
      thisProjectId: THIS_PROJECT_ID,
      thisRepoRoot,
      thisProjectDisplayName: "Project C",
      registry: { listProjects: async () => projects },
      writeNote: async () => {
        handle.writeCalls += 1
      },
      appendOutbox: async () => {},
      readPresence: async (projectId: string) => {
        handle.presenceCalls.push(projectId)
        return presence
      },
      launchTarget: async (repoRoot: string, projectId: string, policy) => {
        handle.launchCalls.push({ repoRoot, projectId, policy })
        return true
      },
    },
  }
  return handle
}

describe("runProjectMessageSend - launch policy", () => {
  it("does not read presence or launch when launch_policy is disabled", async () => {
    // given
    const handle = launchSpyDeps(cfg({ launch_policy: "disabled" }), "offline")

    // when
    const result = await runProjectMessageSend(
      { targetProjectId: "proj-b", intent: "quick", body: "hello" },
      handle.deps,
    )

    // then
    expect("ok" in result && result.ok).toBe(true)
    expect(handle.presenceCalls).toEqual([])
    expect(handle.launchCalls).toEqual([])
    expect(handle.writeCalls).toBe(1)
  })

  it("never enters the launch path when the target is live", async () => {
    // given
    const handle = launchSpyDeps(cfg({ launch_policy: "auto" }), "live")

    // when
    const result = await runProjectMessageSend(
      { targetProjectId: "proj-b", intent: "quick", body: "hello" },
      handle.deps,
    )

    // then
    expect("ok" in result && result.ok).toBe(true)
    expect(handle.presenceCalls).toEqual(["proj-b"])
    expect(handle.launchCalls).toEqual([])
    expect(handle.writeCalls).toBe(1)
  })

  it("never enters the launch path when the target is stale", async () => {
    // given
    const handle = launchSpyDeps(cfg({ launch_policy: "auto" }), "stale")

    // when
    const result = await runProjectMessageSend(
      { targetProjectId: "proj-b", intent: "quick", body: "hello" },
      handle.deps,
    )

    // then
    expect("ok" in result && result.ok).toBe(true)
    expect(handle.launchCalls).toEqual([])
    expect(handle.writeCalls).toBe(1)
  })

  it("launches once with the target repoRoot/projectId/policy when offline and policy is auto", async () => {
    // given
    const handle = launchSpyDeps(cfg({ launch_policy: "auto" }), "offline")

    // when
    const result = await runProjectMessageSend(
      { targetProjectId: "proj-b", intent: "quick", body: "hello" },
      handle.deps,
    )

    // then
    expect("ok" in result && result.ok).toBe(true)
    expect(handle.presenceCalls).toEqual(["proj-b"])
    expect(handle.launchCalls).toHaveLength(1)
    expect(handle.launchCalls[0]).toEqual({ repoRoot: targetBRoot, projectId: "proj-b", policy: "auto" })
    expect(handle.writeCalls).toBe(1)
  })

  it("still sends after launching when offline (message queues via writeNote)", async () => {
    // given
    const handle = launchSpyDeps(cfg({ launch_policy: "ask" }), "offline")

    // when
    const result = await runProjectMessageSend(
      { targetProjectId: "proj-b", intent: "quick", body: "hello" },
      handle.deps,
    )

    // then
    expect("ok" in result && result.ok).toBe(true)
    expect(handle.launchCalls).toHaveLength(1)
    expect(handle.launchCalls[0]?.policy).toBe("ask")
    expect(handle.writeCalls).toBe(1)
  })
})

describe("runProjectMessageSend - launch permission wiring (ask policy)", () => {
  it("passes launchPermissionAsk through the default launchTargetSession path: deny = no launch", async () => {
    // given
    let asked = 0
    const deps: ProjectMessageToolDeps = {
      config: cfg({ launch_policy: "ask" }),
      thisProjectId: THIS_PROJECT_ID,
      thisRepoRoot,
      thisProjectDisplayName: "Project C",
      registry: { listProjects: async () => projects },
      writeNote: async () => {},
      appendOutbox: async () => {},
      readPresence: async () => "offline",
      launchPermissionAsk: async () => {
        asked += 1
        return false
      },
    }

    // when
    const result = await runProjectMessageSend(
      { targetProjectId: "proj-b", intent: "quick", body: "hello" },
      deps,
    )

    // then
    expect("ok" in result && result.ok).toBe(true)
    expect(asked).toBe(1)
  })

  it("passes launchPermissionAsk through the default launchTargetSession path: allow = asked once", async () => {
    // given
    let asked = 0
    const deps: ProjectMessageToolDeps = {
      config: cfg({ launch_policy: "ask" }),
      thisProjectId: THIS_PROJECT_ID,
      thisRepoRoot,
      thisProjectDisplayName: "Project C",
      registry: { listProjects: async () => projects },
      writeNote: async () => {},
      appendOutbox: async () => {},
      readPresence: async () => "offline",
      launchPermissionAsk: async (target: string) => {
        asked += 1
        expect(target).toBe(targetBRoot)
        return false
      },
    }

    // when
    await runProjectMessageSend(
      { targetProjectId: "proj-b", intent: "quick", body: "hello" },
      deps,
    )

    // then
    expect(asked).toBe(1)
  })
})

describe("createProjectMessageTool - probe mode (mode:list)", () => {
  it("returns the advisory outbound-budget rows and writes nothing", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const handle = spyDeps(cfg())
    handle.deps.readPresence = async () => "offline"
    const def = createProjectMessageTool(handle.deps)

    // when
    const out = JSON.parse(
      (await def.execute(
        { mode: "list", targetProjectId: "proj-b", intent: "quick", body: "ignored" },
        {},
      )) as string,
    ) as { mode?: string; advisory?: string; rows?: Array<{ targetProjectId: string }> }

    // then
    expect(out.mode).toBe("list")
    expect(out.advisory).toContain("ADVISORY")
    expect(out.rows?.map((row) => row.targetProjectId).sort()).toEqual(["proj-a", "proj-b"])
    expect(handle.writeCalls).toBe(0)
    expect(handle.outboxCalls).toBe(0)
  })

  it("does not append any outbox line to disk in probe mode", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const def = createProjectMessageTool(realDeps(cfg()))

    // when
    await def.execute({ mode: "list", targetProjectId: "proj-b", intent: "quick", body: "x" }, {})

    // then
    const outboxExists = await readFile(path.join(thisRepoRoot, ".omo", "mailbox-outbox.jsonl"), "utf8")
      .then(() => true)
      .catch(() => false)
    expect(outboxExists).toBe(false)
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

interface ModeSpy {
  detector: Pick<ModeDetector, "currentMode" | "detect">
  detectCalls: Array<{ sessionId: string; trigger: ModeDetectTrigger }>
}

function fixedModeDetector(mode: MailboxModeState): ModeSpy {
  const detectCalls: ModeSpy["detectCalls"] = []
  return {
    detectCalls,
    detector: {
      currentMode: () => mode,
      detect: async (sessionId: string, trigger: ModeDetectTrigger) => {
        detectCalls.push({ sessionId, trigger })
        return mode === "external" ? "external" : "internal"
      },
    },
  }
}

function lazyModeDetector(resolved: "internal" | "external"): ModeSpy {
  const detectCalls: ModeSpy["detectCalls"] = []
  let current: MailboxModeState = "unknown"
  return {
    detectCalls,
    detector: {
      currentMode: () => current,
      detect: async (sessionId: string, trigger: ModeDetectTrigger) => {
        detectCalls.push({ sessionId, trigger })
        current = resolved
        return resolved
      },
    },
  }
}

interface GateSpyHandle {
  deps: ProjectMessageToolDeps
  writeCalls: number
  outboxCalls: number
  presenceCalls: string[]
  launchCalls: number
}

function gateSpyDeps(config: CrossProjectMailboxConfig, detector: Pick<ModeDetector, "currentMode" | "detect">): GateSpyHandle {
  const handle: GateSpyHandle = {
    writeCalls: 0,
    outboxCalls: 0,
    presenceCalls: [],
    launchCalls: 0,
    deps: {
      config,
      thisProjectId: THIS_PROJECT_ID,
      thisRepoRoot,
      thisProjectDisplayName: "Project C",
      registry: { listProjects: async () => projects },
      modeDetector: detector,
      writeNote: async () => {
        handle.writeCalls += 1
      },
      appendOutbox: async () => {
        handle.outboxCalls += 1
      },
      readPresence: async (projectId: string) => {
        handle.presenceCalls.push(projectId)
        return "offline"
      },
      launchTarget: async () => {
        handle.launchCalls += 1
        return true
      },
    },
  }
  return handle
}

describe("createProjectMessageTool - internal/external mode gate", () => {
  it("blocks a send with the guidance reason and never probes/writes/launches when mode is internal", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const spy = fixedModeDetector("internal")
    const handle = gateSpyDeps(cfg({ launch_policy: "auto" }), spy.detector)
    const def = createProjectMessageTool(handle.deps)

    // when
    const out = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "internal send" }, { sessionID: "ses_int" })) as string,
    ) as { blocked?: boolean; reason?: string }

    // then
    expect(out.blocked).toBe(true)
    expect(out.reason).toBe("internal session - use project_note")
    expect(handle.writeCalls).toBe(0)
    expect(handle.outboxCalls).toBe(0)
    expect(handle.presenceCalls).toEqual([])
    expect(handle.launchCalls).toBe(0)

    const outboxExists = await readFile(path.join(thisRepoRoot, ".omo", "mailbox-outbox.jsonl"), "utf8")
      .then(() => true)
      .catch(() => false)
    expect(outboxExists).toBe(false)
  })

  it("leaves the external-mode send path unchanged (delivers, writes, appends)", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const spy = fixedModeDetector("external")
    const handle = gateSpyDeps(cfg({ launch_policy: "disabled" }), spy.detector)
    const def = createProjectMessageTool(handle.deps)

    // when
    const out = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "external send" }, { sessionID: "ses_ext" })) as string,
    ) as { ok?: boolean }

    // then
    expect(out.ok).toBe(true)
    expect(handle.writeCalls).toBe(1)
    expect(handle.outboxCalls).toBe(1)
  })

  it("lazily detects with the tool-exec trigger and blocks when detect resolves internal", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const spy = lazyModeDetector("internal")
    const handle = gateSpyDeps(cfg(), spy.detector)
    const def = createProjectMessageTool(handle.deps)

    // when
    const out = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "lazy send" }, { sessionID: "ses_lazy" })) as string,
    ) as { blocked?: boolean; reason?: string }

    // then
    expect(out.blocked).toBe(true)
    expect(out.reason).toBe("internal session - use project_note")
    expect(spy.detectCalls).toEqual([{ sessionId: "ses_lazy", trigger: "tool-exec" }])
    expect(handle.writeCalls).toBe(0)
  })

  it("allows mode:list in internal mode and returns the advisory budget table", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const spy = fixedModeDetector("internal")
    const handle = gateSpyDeps(cfg(), spy.detector)
    const def = createProjectMessageTool(handle.deps)

    // when
    const out = JSON.parse(
      (await def.execute({ mode: "list", targetProjectId: "proj-b", intent: "quick", body: "ignored" }, { sessionID: "ses_int" })) as string,
    ) as { mode?: string; advisory?: string; rows?: Array<{ targetProjectId: string }> }

    // then
    expect(out.mode).toBe("list")
    expect(out.advisory).toContain("ADVISORY")
    expect(out.rows?.map((row) => row.targetProjectId).sort()).toEqual(["proj-a", "proj-b"])
    expect(handle.writeCalls).toBe(0)
    expect(spy.detectCalls).toEqual([])
  })

  it("defaults to external (unchanged behavior) when no detector is injected", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const def = createProjectMessageTool(realDeps(cfg()))

    // when
    const out = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "no detector" }, {})) as string,
    ) as { ok?: boolean }

    // then
    expect(out.ok).toBe(true)
  })
})


describe("runProjectMessageSend - write-failed trace", () => {
  it("emits exactly one write-failed event and rethrows when the note write throws", async () => {
    // given
    const records: Record<string, unknown>[] = []
    const handle = spyDeps(cfg())
    const boom = new Error("disk full")
    handle.deps.writeNote = async () => {
      throw boom
    }
    handle.deps.traceSink = { append: (record) => void records.push(record) }

    // when
    const call = runProjectMessageSend(
      { targetProjectId: "proj-b", intent: "quick", body: "hello", threadId: undefined },
      handle.deps,
    )

    // then
    await expect(call).rejects.toBe(boom)
    const writeFailed = records.filter((r) => r["phase"] === "write-failed")
    expect(writeFailed).toHaveLength(1)
    expect(typeof writeFailed[0]?.["messageId"]).toBe("string")
    expect((writeFailed[0]?.["messageId"] as string).length).toBeGreaterThan(0)
    expect(typeof writeFailed[0]?.["correlationId"]).toBe("string")
    expect(writeFailed[0]?.["detail"]).toBe("disk full")
    expect(records.some((r) => r["phase"] === "sent")).toBe(false)
  })
})
