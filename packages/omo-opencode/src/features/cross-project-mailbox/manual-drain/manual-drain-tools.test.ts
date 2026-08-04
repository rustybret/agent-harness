import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "bun:test"

import { CrossProjectMailboxConfigSchema, type CrossProjectMailboxConfig } from "../config"
import { projectIdForRoot } from "../envelope/project-id"
import type { MailboxMessage } from "../envelope/schema"
import { BodyDigestStore, SamePairRateLimiter } from "../loop-guard"
import { MailboxStore } from "../mailbox"
import type { ProjectEntry } from "../registry/types"
import { validateInbound } from "../validation"
import { createProjectMailboxDrainTool, createProjectMailboxPeekTool } from "./index"

const tempRoots: string[] = []

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  }
})

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

interface ToolEnv {
  receiverRoot: string
  senderRoot: string
  receiverProjectId: string
  senderProjectId: string
  projects: ProjectEntry[]
  config: CrossProjectMailboxConfig
  makeEnvelope: (overrides?: Partial<MailboxMessage>) => MailboxMessage
  writeNote: (envelope: MailboxMessage, body: string) => Promise<void>
  unreadPath: (messageId: string) => string
  reservedPath: (messageId: string) => string
  processedPath: (messageId: string) => string
  rejectedPath: (messageId: string) => string
}

async function createToolEnv(overrides: Partial<CrossProjectMailboxConfig> = {}): Promise<ToolEnv> {
  const receiverRoot = await tempRoot("omo-manual-drain-receiver-")
  const senderRoot = await tempRoot("omo-manual-drain-sender-")
  const receiverProjectId = projectIdForRoot(receiverRoot)
  const senderProjectId = projectIdForRoot(senderRoot)
  const config = CrossProjectMailboxConfigSchema.parse({
    enabled: true,
    default_sender_access: "allow-all",
    senders: { [senderProjectId]: { access: "allow", intent_budget: "impl" } },
    ...overrides,
  })
  const projects = [{ projectId: senderProjectId, repoRoot: senderRoot, displayName: "sender", lastSeen: 1 }]
  const inboxDir = path.join(receiverRoot, "coordination_notes", senderProjectId)
  const makeEnvelope = (envelopeOverrides: Partial<MailboxMessage> = {}): MailboxMessage => ({
    version: 1,
    messageId: randomUUID(),
    timestamp: Date.now(),
    correlationId: randomUUID(),
    inReplyToMessageId: null,
    fromProject: "sender",
    toProject: "receiver",
    fromProjectId: senderProjectId,
    toProjectId: receiverProjectId,
    intent: "impl",
    priority: 0,
    hopCount: 0,
    hopPath: [senderProjectId],
    supersedes: null,
    ...envelopeOverrides,
  })
  const writeNote = async (envelope: MailboxMessage, body: string): Promise<void> => {
    const store = new MailboxStore(receiverRoot, senderProjectId, { reservation_ttl_ms: 120000 })
    await store.writeNote(envelope, body)
  }

  return {
    receiverRoot,
    senderRoot,
    receiverProjectId,
    senderProjectId,
    projects,
    config,
    makeEnvelope,
    writeNote,
    unreadPath: (messageId) => path.join(inboxDir, `${messageId}.md`),
    reservedPath: (messageId) => path.join(inboxDir, `.delivering-${messageId}.md`),
    processedPath: (messageId) => path.join(inboxDir, "processed", `${messageId}.md`),
    rejectedPath: (messageId) => path.join(inboxDir, "rejected", `${messageId}.md`),
  }
}

function toolDeps(env: ToolEnv) {
  return {
    config: env.config,
    repoRoot: env.receiverRoot,
    projectDisplayName: "receiver",
    getRegisteredProjects: () => env.projects,
    makeMailboxStore: (targetRoot: string, fromProjectId: string) =>
      new MailboxStore(targetRoot, fromProjectId, {
        reservation_ttl_ms: env.config.bounds.reservation_ttl_ms,
      }),
    makeDigestStore: (repoRoot: string) =>
      new BodyDigestStore(repoRoot, env.config.bounds.body_digest_ttl_min * 60_000),
    makeRateLimiter: (repoRoot: string) =>
      new SamePairRateLimiter(repoRoot, env.config.bounds.same_pair_rate_limit_per_min),
    validateInbound,
    validatePluginConfig: () => ({ valid: true, config: { cross_project_mailbox: env.config } }),
  }
}

describe("project_mailbox_peek", () => {
  describe("#given pending unread notes", () => {
    it("#then returns metadata previews without reserving or consuming files", async () => {
      // given
      const env = await createToolEnv()
      const envelope = env.makeEnvelope({ intent: "review" })
      await env.writeNote(envelope, "x".repeat(250))
      const toolDef = createProjectMailboxPeekTool(toolDeps(env))

      // when
      const result = JSON.parse((await toolDef.execute({}, { sessionID: "ses_1" })) as string) as {
        pending: Array<{ fromProjectId: string; messageId: string; intent: string; bodyPreview: string }>
      }

      // then
      expect(result.pending).toHaveLength(1)
      expect(result.pending[0]).toMatchObject({
        fromProjectId: env.senderProjectId,
        messageId: envelope.messageId,
        intent: "plan",
      })
      expect(result.pending[0]?.bodyPreview.length).toBe(200)
      expect(existsSync(env.unreadPath(envelope.messageId))).toBe(true)
      expect(existsSync(env.reservedPath(envelope.messageId))).toBe(false)
      expect(existsSync(env.processedPath(envelope.messageId))).toBe(false)
    })
  })

  describe("#given no pending notes", () => {
    it("#then returns an empty pending list", async () => {
      // given
      const env = await createToolEnv()
      const toolDef = createProjectMailboxPeekTool(toolDeps(env))

      // when
      const result = JSON.parse((await toolDef.execute({}, { sessionID: "ses_1" })) as string) as { pending: unknown[] }

      // then
      expect(result.pending).toEqual([])
    })
  })

  describe("#given the active primary is eligible for intake", () => {
    it("#then it reports automatic drain as enabled", async () => {
      // given
      const env = await createToolEnv()
      const toolDef = createProjectMailboxPeekTool({
        ...toolDeps(env),
        resolveActivePrimaryAgent: () => "sisyphus",
      })

      // when
      const result = JSON.parse((await toolDef.execute({}, { sessionID: "ses_1" })) as string) as {
        autoDrain: { enabled: boolean; reason?: string }
      }

      // then
      expect(result.autoDrain.enabled).toBe(true)
      expect(result.autoDrain.reason).toBeUndefined()
    })
  })

  describe("#given notes are pending but the active primary is not intake-eligible", () => {
    it("#then it reports the notes AND why they will never drain on their own", async () => {
      // given a note waiting behind an ineligible primary
      const env = await createToolEnv()
      await env.writeNote(env.makeEnvelope(), "stuck behind the gate")
      const toolDef = createProjectMailboxPeekTool({
        ...toolDeps(env),
        resolveActivePrimaryAgent: () => "prometheus",
      })

      // when
      const result = JSON.parse((await toolDef.execute({}, { sessionID: "ses_1" })) as string) as {
        pending: unknown[]
        autoDrain: { enabled: boolean; reason?: string; detail?: string; activePrimary?: string }
      }

      // then
      expect(result.pending).toHaveLength(1)
      expect(result.autoDrain.enabled).toBe(false)
      expect(result.autoDrain.reason).toBe("primary-not-eligible")
      expect(result.autoDrain.activePrimary).toBe("prometheus")
      expect(result.autoDrain.detail).toContain("project_mailbox_drain")
    })
  })

  describe("#given no resolver is wired in", () => {
    it("#then it fails closed and reports intake as gated, matching the drain hook", async () => {
      // given
      const env = await createToolEnv()
      const toolDef = createProjectMailboxPeekTool(toolDeps(env))

      // when
      const result = JSON.parse((await toolDef.execute({}, { sessionID: "ses_1" })) as string) as {
        autoDrain: { enabled: boolean; reason?: string }
      }

      // then
      expect(result.autoDrain.enabled).toBe(false)
      expect(result.autoDrain.reason).toBe("primary-not-eligible")
    })
  })
})

describe("project_mailbox_drain", () => {
  describe("#given a valid unread note", () => {
    it("#then consumes it into processed and returns the full body", async () => {
      // given
      const env = await createToolEnv()
      const envelope = env.makeEnvelope()
      await env.writeNote(envelope, "deliver this body")
      const toolDef = createProjectMailboxDrainTool(toolDeps(env))

      // when
      const result = JSON.parse((await toolDef.execute({}, { sessionID: "ses_1" })) as string) as {
        drained: Array<{ messageId: string; body: string }>
      }

      // then
      expect(result.drained).toMatchObject([{ messageId: envelope.messageId, body: "deliver this body" }])
      expect(existsSync(env.unreadPath(envelope.messageId))).toBe(false)
      expect(existsSync(env.reservedPath(envelope.messageId))).toBe(false)
      expect(existsSync(env.processedPath(envelope.messageId))).toBe(true)
    })
  })

  describe("#given a valid unread note with requested_mode", () => {
    it("#then reports requested and effective route guidance in the drain output", async () => {
      // given
      const env = await createToolEnv({
        senders: { ["pending"]: { access: "allow", intent_budget: "plan" } },
      })
      const config = CrossProjectMailboxConfigSchema.parse({
        ...env.config,
        senders: { [env.senderProjectId]: { access: "allow", intent_budget: "plan" } },
      })
      const envelope = env.makeEnvelope({ requested_mode: "worker-pr", intent: "impl" })
      await env.writeNote(envelope, "build a PR")
      const toolDef = createProjectMailboxDrainTool({ ...toolDeps({ ...env, config }), config })

      // when
      const result = JSON.parse((await toolDef.execute({}, { sessionID: "ses_manual" })) as string) as {
        drained: Array<{
          requestedMode?: string
          effectiveMode?: string
          routeLane?: string
          guidance?: string
        }>
      }

      // then
      expect(result.drained).toMatchObject([
        {
          requestedMode: "worker-pr",
          effectiveMode: "worker-pr",
          routeLane: "worker-pr-local",
          guidance: "routed to worker-pr-local lane",
        },
      ])
    })
  })

  describe("#given the same-pair rate limiter blocks delivery", () => {
    it("#then leaves the note unread and does not quarantine it", async () => {
      // given
      const env = await createToolEnv({
        bounds: { ...CrossProjectMailboxConfigSchema.parse({}).bounds, same_pair_rate_limit_per_min: 0 },
      })
      const envelope = env.makeEnvelope()
      await env.writeNote(envelope, "try later")
      const toolDef = createProjectMailboxDrainTool(toolDeps(env))

      // when
      const result = JSON.parse((await toolDef.execute({}, { sessionID: "ses_1" })) as string) as {
        drained: unknown[]
        skipped: Array<{ messageId: string; reason: string }>
      }

      // then
      expect(result.drained).toEqual([])
      expect(result.skipped).toEqual([{ messageId: envelope.messageId, reason: "rate-limited" }])
      expect(existsSync(env.unreadPath(envelope.messageId))).toBe(true)
      expect(existsSync(env.reservedPath(envelope.messageId))).toBe(false)
      expect(existsSync(env.rejectedPath(envelope.messageId))).toBe(false)
    })
  })

  describe("#given a duplicate-loop digest is already recorded", () => {
    it("#then quarantines the duplicate without returning it as drained", async () => {
      // given
      const env = await createToolEnv()
      const correlationId = randomUUID()
      const first = env.makeEnvelope({ correlationId })
      const duplicate = env.makeEnvelope({ correlationId })
      await env.writeNote(first, "same body")
      let toolDef = createProjectMailboxDrainTool(toolDeps(env))
      await toolDef.execute({}, { sessionID: "ses_1" })
      await env.writeNote(duplicate, "same body")
      toolDef = createProjectMailboxDrainTool(toolDeps(env))

      // when
      const result = JSON.parse((await toolDef.execute({}, { sessionID: "ses_2" })) as string) as {
        drained: unknown[]
        skipped: Array<{ messageId: string; reason: string }>
      }

      // then
      expect(result.drained).toEqual([])
      expect(result.skipped).toEqual([{ messageId: duplicate.messageId, reason: "duplicate-loop" }])
      expect(existsSync(env.rejectedPath(duplicate.messageId))).toBe(true)
    })
  })

  describe("#given max_notes_per_drain is lower than unread note count", () => {
    it("#then drains only the configured per-call cap", async () => {
      // given
      const env = await createToolEnv({
        bounds: { ...CrossProjectMailboxConfigSchema.parse({}).bounds, max_notes_per_drain: 1 },
      })
      const first = env.makeEnvelope({ priority: 2 })
      const second = env.makeEnvelope({ priority: 1 })
      await env.writeNote(first, "first")
      await env.writeNote(second, "second")
      const toolDef = createProjectMailboxDrainTool(toolDeps(env))

      // when
      const result = JSON.parse((await toolDef.execute({}, { sessionID: "ses_1" })) as string) as {
        drained: Array<{ messageId: string }>
      }

      // then
      expect(result.drained).toMatchObject([{ messageId: first.messageId, body: "first" }])
      expect(existsSync(env.processedPath(first.messageId))).toBe(true)
      expect(existsSync(env.unreadPath(second.messageId))).toBe(true)
    })
  })
})
