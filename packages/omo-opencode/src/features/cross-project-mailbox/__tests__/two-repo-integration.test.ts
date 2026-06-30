import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "bun:test"

import { CrossProjectMailboxConfigSchema } from "../config"
import type { CrossProjectMailboxConfig } from "../config"
import { projectIdForRoot } from "../envelope/project-id"
import type { MailboxMessage } from "../envelope/schema"
import { createIdleDrainHook } from "../hooks/idle-drain-hook"
import type { IdleDrainHookDeps } from "../hooks/idle-drain-hook"
import { BodyDigestStore, SamePairRateLimiter } from "../loop-guard"
import { MailboxStore, PendingDeliveryStore } from "../mailbox"
import { createProjectRegistry } from "../registry"
import { appendOutboxLog, buildSendEnvelope, outboxLogPath } from "../send-tool"
import { buildTriagePrompt } from "../triage"
import { validateInbound } from "../validation"

const tempRoots: string[] = []

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root === undefined) continue
    await rm(root, { recursive: true, force: true })
  }
})

interface RunOpts {
  primary?: string | undefined
  sessionMessages?: string[]
  sessionId?: string
}

interface TwoRepoEnv {
  senderRoot: string
  receiverRoot: string
  registryHome: string
  senderProjectId: string
  receiverProjectId: string
  dispatched: string[]
  buildConfig: (overrides?: Partial<Record<string, unknown>>) => CrossProjectMailboxConfig
  makeEnvelope: (overrides?: Partial<MailboxMessage>) => MailboxMessage
  writeRawNote: (envelope: MailboxMessage, body: string) => Promise<void>
  sendMessage: (input: { intent: MailboxMessage["intent"]; body: string }) => Promise<MailboxMessage>
  runIdle: (config: CrossProjectMailboxConfig, opts?: RunOpts) => Promise<void>
  inboxNotePath: (messageId: string) => string
  processedNotePath: (messageId: string) => string
  rejectedNotePath: (messageId: string) => string
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

function extractDispatchedText(input: unknown): string | undefined {
  const typed = input as { body?: { parts?: ReadonlyArray<{ text?: unknown }> } }
  const text = typed.body?.parts?.[0]?.text
  return typeof text === "string" ? text : undefined
}

async function createEnv(): Promise<TwoRepoEnv> {
  const senderRoot = await createTempDir("omo-mailbox-sender-")
  const receiverRoot = await createTempDir("omo-mailbox-receiver-")
  const registryHome = await createTempDir("omo-mailbox-registry-")

  const senderProjectId = projectIdForRoot(senderRoot)
  const receiverProjectId = projectIdForRoot(receiverRoot)

  const registry = createProjectRegistry(path.join(registryHome, ".omo", "project-registry.json"))
  await registry.registerProject(senderRoot)
  await registry.registerProject(receiverRoot)

  const dispatched: string[] = []

  const buildConfig = (overrides: Partial<Record<string, unknown>> = {}): CrossProjectMailboxConfig =>
    CrossProjectMailboxConfigSchema.parse({
      enabled: true,
      intake_eligible_agents: ["sisyphus"],
      default_sender_access: "allow-all",
      senders: { [senderProjectId]: { access: "allow", intent_budget: "impl" } },
      ...overrides,
    })

  const makeEnvelope = (overrides: Partial<MailboxMessage> = {}): MailboxMessage => ({
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
    ...overrides,
  })

  const writeRawNote = async (envelope: MailboxMessage, body: string): Promise<void> => {
    const store = new MailboxStore(receiverRoot, senderProjectId, { reservation_ttl_ms: 120000 })
    await store.writeNote(envelope, body)
  }

  const sendMessage = async (input: {
    intent: MailboxMessage["intent"]
    body: string
  }): Promise<MailboxMessage> => {
    const built = await buildSendEnvelope(
      { targetProjectId: receiverProjectId, intent: input.intent, body: input.body },
      senderProjectId,
      senderRoot,
      receiverProjectId,
      "receiver",
      "sender",
    )
    if ("error" in built) {
      throw new Error(`buildSendEnvelope failed: ${built.error}`)
    }
    await writeRawNote(built.envelope, input.body)
    await appendOutboxLog(senderRoot, {
      sentAt: Date.now(),
      toProjectId: receiverProjectId,
      messageId: built.envelope.messageId,
      intent: input.intent,
      correlationId: built.envelope.correlationId,
      body: input.body,
    })
    return built.envelope
  }

  const runIdle = async (config: CrossProjectMailboxConfig, opts: RunOpts = {}): Promise<void> => {
    const projects = (await registry.listProjects()).filter(
      (entry) => entry.projectId !== receiverProjectId,
    )

    const deps: IdleDrainHookDeps = {
      config,
      validatePluginConfig: () => ({ valid: true, config: { cross_project_mailbox: config } }),
      repoRoot: receiverRoot,
      directory: receiverRoot,
      projectDisplayName: "receiver",
      client: { session: { promptAsync: async () => ({}) } },
      resolveActivePrimaryAgent: () => ("primary" in opts ? opts.primary : "sisyphus"),
      getRegisteredProjects: () => projects,
      makeMailboxStore: (targetRoot, fromProjectId) =>
        new MailboxStore(targetRoot, fromProjectId, {
          reservation_ttl_ms: config.bounds.reservation_ttl_ms,
        }),
      makePendingStore: (targetRoot) => new PendingDeliveryStore(targetRoot),
      makeDigestStore: (root) => new BodyDigestStore(root, config.bounds.body_digest_ttl_min * 60_000),
      makeRateLimiter: (root) =>
        new SamePairRateLimiter(root, config.bounds.same_pair_rate_limit_per_min),
      validateInbound,
      buildTriagePrompt,
      dispatchInternalPrompt: async (args) => {
        const text = extractDispatchedText(args.input)
        if (text !== undefined) dispatched.push(text)
        return { status: "dispatched", response: {} }
      },
      getSessionMessages: async () => opts.sessionMessages ?? [],
    }

    await createIdleDrainHook(deps)["session.idle"]({ sessionId: opts.sessionId ?? "ses_test" })
  }

  const inboxDir = path.join(receiverRoot, "coordination_notes", senderProjectId)

  return {
    senderRoot,
    receiverRoot,
    registryHome,
    senderProjectId,
    receiverProjectId,
    dispatched,
    buildConfig,
    makeEnvelope,
    writeRawNote,
    sendMessage,
    runIdle,
    inboxNotePath: (messageId) => path.join(inboxDir, `${messageId}.md`),
    processedNotePath: (messageId) => path.join(inboxDir, "processed", `${messageId}.md`),
    rejectedNotePath: (messageId) => path.join(inboxDir, "rejected", `${messageId}.md`),
  }
}

describe("cross-project mailbox two-repo integration", () => {
  describe("#given a sender and receiver repo wired through the registry", () => {
    describe("#when the sender delivers a note and the receiver drains while idle", () => {
      it("#then the note lands in the receiver mailbox directory", async () => {
        // given
        const env = await createEnv()

        // when
        const envelope = await env.sendMessage({ intent: "impl", body: "please implement the thing" })

        // then
        expect(existsSync(env.inboxNotePath(envelope.messageId))).toBe(true)
      })

      it("#then the idle drain dispatches the note body into the receiver session", async () => {
        // given
        const env = await createEnv()
        await env.sendMessage({ intent: "impl", body: "ship the cross-project feature" })

        // when
        await env.runIdle(env.buildConfig())

        // then
        expect(env.dispatched).toHaveLength(1)
        expect(env.dispatched[0]).toContain("ship the cross-project feature")
      })

      it("#then the sender outbox log records the sent message", async () => {
        // given
        const env = await createEnv()

        // when
        const envelope = await env.sendMessage({ intent: "impl", body: "log me to the outbox" })

        // then
        const logPath = outboxLogPath(env.senderRoot)
        expect(existsSync(logPath)).toBe(true)
        expect(readFileSync(logPath, "utf8")).toContain(envelope.messageId)
      })

      it("#then a second idle cycle acks the dispatched note into processed/", async () => {
        // given
        const env = await createEnv()
        const config = env.buildConfig({
          bounds: CrossProjectMailboxConfigSchema.parse({}).bounds,
        })
        const ackConfig = env.buildConfig({
          bounds: { ...config.bounds, reservation_ttl_ms: 0 },
        })
        const envelope = await env.sendMessage({ intent: "impl", body: "drain then ack me" })

        // when
        await env.runIdle(ackConfig)
        await env.runIdle(ackConfig, { sessionMessages: [envelope.messageId] })

        // then
        expect(env.dispatched).toHaveLength(1)
        expect(existsSync(env.processedNotePath(envelope.messageId))).toBe(true)
        expect(existsSync(env.inboxNotePath(envelope.messageId))).toBe(false)
      })
    })
  })

  describe("#given the receiver primary agent is ineligible for intake", () => {
    describe("#when the active primary is not in intake_eligible_agents", () => {
      it("#then nothing is dispatched and the note stays unread", async () => {
        // given
        const env = await createEnv()
        const envelope = await env.sendMessage({ intent: "impl", body: "should not drain" })

        // when
        await env.runIdle(env.buildConfig(), { primary: "prometheus" })

        // then
        expect(env.dispatched).toHaveLength(0)
        expect(existsSync(env.inboxNotePath(envelope.messageId))).toBe(true)
      })
    })

    describe("#when the session has no active primary", () => {
      it("#then nothing is dispatched and the note stays unread", async () => {
        // given
        const env = await createEnv()
        const envelope = await env.sendMessage({ intent: "impl", body: "no primary present" })

        // when
        await env.runIdle(env.buildConfig(), { primary: undefined })

        // then
        expect(env.dispatched).toHaveLength(0)
        expect(existsSync(env.inboxNotePath(envelope.messageId))).toBe(true)
      })
    })
  })

  describe("#given an inbound note that fails authorization policy", () => {
    describe("#when the source project is not in the allowlist", () => {
      it("#then the note is quarantined to rejected/ and never dispatched", async () => {
        // given
        const env = await createEnv()
        const envelope = env.makeEnvelope({ intent: "question" })
        await env.writeRawNote(envelope, "unauthorized sender body")
        const config = env.buildConfig({
          default_sender_access: "allow-none",
          senders: { "some-other-allowed-project-id": { access: "allow", intent_budget: "impl" } },
        })

        // when
        await env.runIdle(config)

        // then
        expect(env.dispatched).toHaveLength(0)
        expect(existsSync(env.rejectedNotePath(envelope.messageId))).toBe(true)
      })
    })

    describe("#when the note intent exceeds the sender intent budget", () => {
      it("#then the note is quarantined over-budget and never dispatched", async () => {
        // given
        const env = await createEnv()
        const envelope = env.makeEnvelope({ intent: "impl" })
        await env.writeRawNote(envelope, "over budget body")
        const config = env.buildConfig({
          senders: { [env.senderProjectId]: { access: "allow", intent_budget: "question" } },
        })

        // when
        await env.runIdle(config)

        // then
        expect(env.dispatched).toHaveLength(0)
        expect(existsSync(env.rejectedNotePath(envelope.messageId))).toBe(true)
      })
    })
  })

  describe("#given loop-guard bounds on inbound delivery", () => {
    describe("#when a note has already traversed the maximum hops", () => {
      it("#then the note is quarantined hop-exceeded and never dispatched", async () => {
        // given
        const env = await createEnv()
        const config = env.buildConfig()
        const envelope = env.makeEnvelope({ hopCount: config.bounds.max_hops })
        await env.writeRawNote(envelope, "too many hops body")

        // when
        await env.runIdle(config)

        // then
        expect(env.dispatched).toHaveLength(0)
        expect(existsSync(env.rejectedNotePath(envelope.messageId))).toBe(true)
      })
    })

    describe("#when two distinct notes exceed the same-pair rate limit in one window", () => {
      it("#then only the first note is dispatched and the second stays unread", async () => {
        // given
        const env = await createEnv()
        const baseConfig = env.buildConfig()
        const config = env.buildConfig({
          bounds: { ...baseConfig.bounds, same_pair_rate_limit_per_min: 1 },
        })
        const first = env.makeEnvelope({ timestamp: 1000 })
        const second = env.makeEnvelope({ timestamp: 2000 })
        await env.writeRawNote(first, "first body")
        await env.writeRawNote(second, "second body")

        // when
        await env.runIdle(config)

        // then
        expect(env.dispatched).toHaveLength(1)
        expect(env.dispatched[0]).toContain("first body")
        expect(existsSync(env.inboxNotePath(second.messageId))).toBe(true)
      })
    })

    describe("#when a second note repeats an already-seen body digest", () => {
      it("#then the duplicate is quarantined duplicate-loop and only the original dispatches", async () => {
        // given
        const env = await createEnv()
        const correlationId = randomUUID()
        const first = env.makeEnvelope({ timestamp: 1000, correlationId })
        const second = env.makeEnvelope({ timestamp: 2000, correlationId })
        await env.writeRawNote(first, "identical duplicate body")
        await env.writeRawNote(second, "identical duplicate body")

        // when
        await env.runIdle(env.buildConfig())

        // then
        expect(env.dispatched).toHaveLength(1)
        expect(existsSync(env.rejectedNotePath(second.messageId))).toBe(true)
      })
    })
  })

  describe("#given two idle drains racing on the same single note", () => {
    describe("#when both drains run concurrently", () => {
      it("#then the note is delivered exactly once", async () => {
        // given
        const env = await createEnv()
        const config = env.buildConfig()
        await env.sendMessage({ intent: "impl", body: "deliver exactly once" })

        // when
        await Promise.all([env.runIdle(config), env.runIdle(config)])

        // then
        expect(env.dispatched).toHaveLength(1)
      })
    })
  })
})
