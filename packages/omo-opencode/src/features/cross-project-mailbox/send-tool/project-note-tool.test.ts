import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { CrossProjectMailboxConfigSchema, type CrossProjectMailboxConfig } from "../config"
import type { MailboxMessage } from "../envelope/schema"
import type { MailboxModeState, ModeDetectTrigger } from "../presence"
import type { ProjectEntry } from "../registry/types"
import { createProjectNoteTool, type ProjectNoteToolDeps } from "./index"

const THIS_PROJECT_ID = "proj-c"

let thisRepoRoot: string
let targetBRoot: string
let projects: ProjectEntry[]
let emptyConfigHome: string
let savedXdgConfigHome: string | undefined
let savedOpencodeConfigDir: string | undefined

const PERMISSIVE_SENDERS = {
  "proj-b": { access: "allow", intent_budget: "plan" },
}

async function writeProjectMailboxConfig(mailbox: Record<string, unknown>): Promise<void> {
  const dir = path.join(thisRepoRoot, ".opencode")
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, "oh-my-openagent.json"), JSON.stringify({ cross_project_mailbox: mailbox }))
}

beforeEach(async () => {
  thisRepoRoot = await mkdtemp(path.join(os.tmpdir(), "cpm-note-this-"))
  targetBRoot = await mkdtemp(path.join(os.tmpdir(), "cpm-note-b-"))
  emptyConfigHome = await mkdtemp(path.join(os.tmpdir(), "cpm-note-xdg-"))
  savedXdgConfigHome = process.env.XDG_CONFIG_HOME
  savedOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR
  process.env.XDG_CONFIG_HOME = emptyConfigHome
  delete process.env.OPENCODE_CONFIG_DIR
  projects = [{ projectId: "proj-b", repoRoot: targetBRoot, displayName: "Project B", lastSeen: 1 }]
})

afterEach(async () => {
  if (savedXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedXdgConfigHome
  if (savedOpencodeConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
  else process.env.OPENCODE_CONFIG_DIR = savedOpencodeConfigDir
  await rm(thisRepoRoot, { recursive: true, force: true })
  await rm(targetBRoot, { recursive: true, force: true })
  await rm(emptyConfigHome, { recursive: true, force: true })
})

function cfg(overrides: Record<string, unknown> = {}): CrossProjectMailboxConfig {
  return CrossProjectMailboxConfigSchema.parse({
    enabled: true,
    senders: { "proj-b": { access: "allow", intent_budget: "plan" } },
    ...overrides,
  })
}

interface ModeSpy {
  detector: Pick<import("../presence").ModeDetector, "currentMode" | "detect">
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
        if (mode === "internal" || mode === "external") return mode
        return "internal"
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

interface NoteSpyHandle {
  deps: ProjectNoteToolDeps
  writeCalls: number
  outboxCalls: number
}

function spyDeps(config: CrossProjectMailboxConfig, detector: ModeSpy["detector"]): NoteSpyHandle {
  const handle: NoteSpyHandle = {
    writeCalls: 0,
    outboxCalls: 0,
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
    },
  }
  return handle
}

function realDeps(config: CrossProjectMailboxConfig, detector: ModeSpy["detector"]): ProjectNoteToolDeps {
  return {
    config,
    thisProjectId: THIS_PROJECT_ID,
    thisRepoRoot,
    thisProjectDisplayName: "Project C",
    registry: { listProjects: async () => projects },
    modeDetector: detector,
  }
}

describe("createProjectNoteTool - internal-mode happy path", () => {
  it("drops an enveloped note with frontmatter and appends the outbox when mode is internal", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const spy = fixedModeDetector("internal")
    const def = createProjectNoteTool(realDeps(cfg(), spy.detector))

    // when
    const out = await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "hello note" }, { sessionID: "ses_1" })
    const parsed = JSON.parse(out as string) as { ok: boolean; envelope: MailboxMessage }

    // then
    expect(parsed.ok).toBe(true)
    expect(parsed.envelope.hopCount).toBe(0)
    expect(parsed.envelope.hopPath).toEqual([THIS_PROJECT_ID])

    const notePath = path.join(targetBRoot, "coordination_notes", THIS_PROJECT_ID, `${parsed.envelope.messageId}.md`)
    const noteContent = await readFile(notePath, "utf8")
    expect(noteContent).toContain("hello note")
    expect(noteContent).toContain(`messageId: ${parsed.envelope.messageId}`)

    const outboxRaw = await readFile(path.join(thisRepoRoot, ".omo", "mailbox-outbox.jsonl"), "utf8")
    const lines = outboxRaw.trim().split("\n")
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0] ?? "{}") as { toProjectId: string; messageId: string }
    expect(entry.toProjectId).toBe("proj-b")
    expect(entry.messageId).toBe(parsed.envelope.messageId)
  })

  it("exposes no presence or launch dependency on the note tool deps", () => {
    // given
    const spy = fixedModeDetector("internal")
    const deps = realDeps(cfg(), spy.detector)

    // then: the deps surface is a pure file drop; no sender-side liveness hooks exist to call
    expect("readPresence" in deps).toBe(false)
    expect("launchTarget" in deps).toBe(false)
    expect("launchPermissionAsk" in deps).toBe(false)
  })
})

describe("createProjectNoteTool - external-mode blocked", () => {
  it("returns guidance and writes nothing when mode is external", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const spy = fixedModeDetector("external")
    const handle = spyDeps(cfg(), spy.detector)
    const def = createProjectNoteTool(handle.deps)

    // when
    const out = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "hello" }, { sessionID: "ses_1" })) as string,
    ) as { blocked?: boolean; reason?: string }

    // then
    expect(out.blocked).toBe(true)
    expect(out.reason).toContain("project_message")
    expect(handle.writeCalls).toBe(0)
    expect(handle.outboxCalls).toBe(0)

    const outboxExists = await readFile(path.join(thisRepoRoot, ".omo", "mailbox-outbox.jsonl"), "utf8")
      .then(() => true)
      .catch(() => false)
    expect(outboxExists).toBe(false)
  })
})

describe("createProjectNoteTool - unknown-mode lazy detect", () => {
  it("lazily detects with the tool-exec trigger then proceeds when detect resolves internal", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const spy = lazyModeDetector("internal")
    const def = createProjectNoteTool(realDeps(cfg(), spy.detector))

    // when
    const out = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "lazy note" }, { sessionID: "ses_lazy" })) as string,
    ) as { ok?: boolean }

    // then
    expect(out.ok).toBe(true)
    expect(spy.detectCalls).toEqual([{ sessionId: "ses_lazy", trigger: "tool-exec" }])
  })

  it("lazily detects then blocks when detect resolves external", async () => {
    // given
    await writeProjectMailboxConfig({ enabled: true, senders: PERMISSIVE_SENDERS })
    const spy = lazyModeDetector("external")
    const handle = spyDeps(cfg(), spy.detector)
    const def = createProjectNoteTool(handle.deps)

    // when
    const out = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "lazy" }, { sessionID: "ses_lazy2" })) as string,
    ) as { blocked?: boolean; reason?: string }

    // then
    expect(out.blocked).toBe(true)
    expect(out.reason).toContain("project_message")
    expect(spy.detectCalls).toEqual([{ sessionId: "ses_lazy2", trigger: "tool-exec" }])
    expect(handle.writeCalls).toBe(0)
  })
})

describe("createProjectNoteTool - preflight-blocked", () => {
  it("returns the preflight reason and writes nothing when the target is not allowlisted", async () => {
    // given
    await writeProjectMailboxConfig({
      enabled: true,
      senders: { "proj-b": { access: "deny", intent_budget: "plan" } },
    })
    const spy = fixedModeDetector("internal")
    const handle = spyDeps(cfg({ senders: { "proj-b": { access: "deny", intent_budget: "plan" } } }), spy.detector)
    const def = createProjectNoteTool(handle.deps)

    // when
    const out = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "quick", body: "blocked" }, { sessionID: "ses_1" })) as string,
    ) as { blocked?: boolean; reason?: string }

    // then
    expect(out.blocked).toBe(true)
    expect(out.reason).toBe("unauthorized")
    expect(handle.writeCalls).toBe(0)
    expect(handle.outboxCalls).toBe(0)
  })

  it("blocks an over-budget intent before any write", async () => {
    // given
    await writeProjectMailboxConfig({
      enabled: true,
      senders: { "proj-b": { access: "allow", intent_budget: "quick" } },
    })
    const spy = fixedModeDetector("internal")
    const handle = spyDeps(cfg({ senders: { "proj-b": { access: "allow", intent_budget: "quick" } } }), spy.detector)
    const def = createProjectNoteTool(handle.deps)

    // when
    const out = JSON.parse(
      (await def.execute({ targetProjectId: "proj-b", intent: "plan", body: "big" }, { sessionID: "ses_1" })) as string,
    ) as { blocked?: boolean; reason?: string }

    // then
    expect(out.blocked).toBe(true)
    expect(out.reason).toBe("over-budget")
    expect(handle.writeCalls).toBe(0)
  })
})
