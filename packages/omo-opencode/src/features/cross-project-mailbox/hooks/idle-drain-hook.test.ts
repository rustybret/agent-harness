import { describe, expect, it, jest } from "bun:test"

import type { CrossProjectMailboxConfig } from "../config"
import type { MailboxMessage } from "../envelope/schema"
import type { UnreadMessage } from "../mailbox/types"
import type { ProjectEntry } from "../registry/types"
import type { ValidationResult } from "../validation/types"
import {
  createIdleDrainHook,
  type DigestStorePort,
  type IdleDrainHookDeps,
  type MailboxStorePort,
  type PendingStorePort,
  type RateLimiterPort,
} from "./idle-drain-hook"

function makeConfig(overrides: Partial<CrossProjectMailboxConfig> = {}): CrossProjectMailboxConfig {
  return {
    enabled: true,
    intake_eligible_agents: ["sisyphus"],
    interrupt_policy: "idle-drain",
    default_sender_access: "allow-all",
    senders: {},
    bounds: {
      max_hops: 4,
      max_notes_per_drain: 5,
      same_pair_rate_limit_per_min: 6,
      body_digest_ttl_min: 60,
      max_body_bytes: 32768,
      reservation_ttl_ms: 120000,
    },
    ...overrides,
  }
}

function makeEnvelope(overrides: Partial<MailboxMessage> = {}): MailboxMessage {
  return {
    version: 1,
    messageId: "11111111-1111-1111-1111-111111111111",
    timestamp: 1000,
    correlationId: "22222222-2222-2222-2222-222222222222",
    inReplyToMessageId: null,
    fromProject: "alpha",
    toProject: "beta",
    fromProjectId: "alpha-id",
    toProjectId: "beta-id",
    intent: "impl",
    priority: 0,
    hopCount: 0,
    hopPath: ["alpha-id"],
    supersedes: null,
    ...overrides,
  }
}

function makeNote(overrides: Partial<MailboxMessage> = {}, body = "hello body"): UnreadMessage {
  const envelope = makeEnvelope(overrides)
  return { messageId: envelope.messageId, filePath: `/inbox/${envelope.messageId}.md`, envelope, body }
}

function makeProject(): ProjectEntry {
  return { projectId: "alpha-id", repoRoot: "/repos/alpha", displayName: "alpha", lastSeen: 5 }
}

interface Spies {
  reclaimStale: ReturnType<typeof jest.fn>
  drainUnread: ReturnType<typeof jest.fn>
  reserve: ReturnType<typeof jest.fn>
  unreserve: ReturnType<typeof jest.fn>
  quarantine: ReturnType<typeof jest.fn>
  markDispatched: ReturnType<typeof jest.fn>
  ack: ReturnType<typeof jest.fn>
  addDispatchSent: ReturnType<typeof jest.fn>
  checkAndRecord: ReturnType<typeof jest.fn>
  rollback: ReturnType<typeof jest.fn>
  checkRateLimit: ReturnType<typeof jest.fn>
  validateInbound: ReturnType<typeof jest.fn>
  buildTriagePrompt: ReturnType<typeof jest.fn>
  dispatchInternalPrompt: ReturnType<typeof jest.fn>
  getSessionMessages: ReturnType<typeof jest.fn>
  makeMailboxStore: ReturnType<typeof jest.fn>
  makePendingStore: ReturnType<typeof jest.fn>
  resolveActivePrimaryAgent: ReturnType<typeof jest.fn>
  getRegisteredProjects: ReturnType<typeof jest.fn>
  validatePluginConfig: ReturnType<typeof jest.fn>
}

function makeHarness(opts: {
  config?: CrossProjectMailboxConfig
  freshConfigRead?: { valid: boolean; config: { cross_project_mailbox?: CrossProjectMailboxConfig } }
  notes?: UnreadMessage[]
  projects?: ProjectEntry[]
  primary?: string | undefined
  reserveResult?: string | undefined
  duplicate?: boolean
  rateLimited?: boolean
  validation?: ValidationResult
  sessionMessages?: string[]
} = {}): { deps: IdleDrainHookDeps; spies: Spies } {
  const config = opts.config ?? makeConfig()
  const notes = opts.notes ?? [makeNote()]

  const reclaimStale = jest.fn(async () => undefined)
  const drainUnread = jest.fn(async () => notes)
  const reserveResult = "reserveResult" in opts ? opts.reserveResult : "/inbox/.delivering-id.md"
  const reserve = jest.fn(async () => reserveResult)
  const unreserve = jest.fn(async () => undefined)
  const quarantine = jest.fn(async () => undefined)
  const markDispatched = jest.fn(async () => undefined)
  const ack = jest.fn(async () => undefined)
  const addDispatchSent = jest.fn(async () => undefined)
  const checkAndRecord = jest.fn(async () => ({ isDuplicate: opts.duplicate ?? false }))
  const rollback = jest.fn(async () => undefined)
  const checkRateLimit = jest.fn(async () => ({ limited: opts.rateLimited ?? false }))
  const validateInbound = jest.fn((envelope, config, validationOpts) => {
    if (validationOpts?.duplicateLoop) {
      return { valid: false, reason: "duplicate-loop", detail: "dup" }
    }
    return opts.validation ?? ({ valid: true } as ValidationResult)
  })
  const buildTriagePrompt = jest.fn(() => "TRIAGE_TEXT")
  const dispatchInternalPrompt = jest.fn(async () => ({ status: "dispatched", response: {} }) as const)
  const getSessionMessages = jest.fn(async () => opts.sessionMessages ?? [])
  const resolveActivePrimaryAgent = jest.fn(() => ("primary" in opts ? opts.primary : "sisyphus"))
  const getRegisteredProjects = jest.fn(() => opts.projects ?? [makeProject()])
  const validatePluginConfig = jest.fn(
    () => opts.freshConfigRead ?? { valid: true, config: { cross_project_mailbox: config } },
  )

  const store: MailboxStorePort = { reclaimStale, drainUnread, reserve, unreserve, quarantine, markDispatched, ack }
  const pending: PendingStorePort = { addDispatchSent }
  const digest: DigestStorePort = { checkAndRecord, rollback }
  const limiter: RateLimiterPort = { checkRateLimit }

  const makeMailboxStore = jest.fn(() => store)
  const makePendingStore = jest.fn(() => pending)

  const deps: IdleDrainHookDeps = {
    config,
    validatePluginConfig: validatePluginConfig as never,
    repoRoot: "/repos/beta",
    directory: "/repos/beta",
    projectDisplayName: "beta",
    client: { session: { promptAsync: jest.fn(async () => ({})) } },
    resolveActivePrimaryAgent: resolveActivePrimaryAgent as never,
    getRegisteredProjects: getRegisteredProjects as never,
    makeMailboxStore: makeMailboxStore as never,
    makePendingStore: makePendingStore as never,
    makeDigestStore: jest.fn(() => digest) as never,
    makeRateLimiter: jest.fn(() => limiter) as never,
    validateInbound: validateInbound as never,
    buildTriagePrompt: buildTriagePrompt as never,
    dispatchInternalPrompt: dispatchInternalPrompt as never,
    getSessionMessages: getSessionMessages as never,
  }

  return {
    deps,
    spies: {
      reclaimStale,
      drainUnread,
      reserve,
      unreserve,
      quarantine,
      markDispatched,
      ack,
      addDispatchSent,
      checkAndRecord,
      rollback,
      checkRateLimit,
      validateInbound,
      buildTriagePrompt,
      dispatchInternalPrompt,
      getSessionMessages,
      makeMailboxStore,
      makePendingStore,
      resolveActivePrimaryAgent,
      getRegisteredProjects,
      validatePluginConfig,
    },
  }
}

describe("createIdleDrainHook", () => {
  describe("#given an eligible idle session with one valid unread note", () => {
    it("#then validates, dispatches once, and records dispatch-sent without acking", async () => {
      // given
      const { deps, spies } = makeHarness({ primary: "sisyphus" })
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(spies.validateInbound).toHaveBeenCalled()
      expect(spies.checkAndRecord).toHaveReturned()
      expect(spies.reserve).toHaveBeenCalledTimes(1)
      expect(spies.buildTriagePrompt).toHaveBeenCalledTimes(1)
      expect(spies.dispatchInternalPrompt).toHaveBeenCalledTimes(1)
      expect(spies.markDispatched).toHaveBeenCalledTimes(1)
      expect(spies.markDispatched.mock.calls[0][0].messageId).toBe(makeNote().messageId)
    })

    it("#then SAFETY-A: dispatched prompt input carries no agent/model/variant key", async () => {
      // given
      const { deps, spies } = makeHarness({ primary: "sisyphus" })
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      const dispatchedArg = spies.dispatchInternalPrompt.mock.calls[0][0]
      const inputKeys = Object.keys(dispatchedArg.input)
      expect(inputKeys).not.toContain("agent")
      expect(inputKeys).not.toContain("model")
      expect(inputKeys).not.toContain("variant")
      expect(dispatchedArg).not.toHaveProperty("agent")
      expect(dispatchedArg).not.toHaveProperty("model")
      expect(dispatchedArg).not.toHaveProperty("variant")
    })
  })

  describe("#given the active primary is not in intake_eligible_agents", () => {
    it("#then the note is suppressed and nothing is validated or dispatched", async () => {
      // given
      const { deps, spies } = makeHarness({ primary: "prometheus" })
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(spies.validateInbound).not.toHaveBeenCalled()
      expect(spies.dispatchInternalPrompt).not.toHaveBeenCalled()
      expect(spies.reserve).not.toHaveBeenCalled()
    })

    it("#then it emits one drain-skipped trace naming the cause and how many notes are held", async () => {
      // given two notes sitting behind an ineligible primary
      const traced: { phase: string; detail?: string; waiting?: number }[] = []
      const { deps } = makeHarness({
        primary: "prometheus",
        notes: [makeNote(), makeNote({ messageId: "33333333-3333-3333-3333-333333333333" })],
      })
      deps.emitTrace = (event) => void traced.push(event)
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      const skips = traced.filter((event) => event.phase === "drain-skipped")
      expect(skips).toHaveLength(1)
      expect(skips[0]?.waiting).toBe(2)
      expect(skips[0]?.detail).toContain("primary-not-eligible")
      expect(skips[0]?.detail).toContain("prometheus")
    })

    it("#then a store failure while counting still emits the skip, reporting zero waiting", async () => {
      // given the unread listing throws while the gate is blocked
      const traced: { phase: string; waiting?: number }[] = []
      const { deps, spies } = makeHarness({ primary: "prometheus" })
      spies.drainUnread.mockImplementation(async () => {
        throw new Error("disk gone")
      })
      deps.emitTrace = (event) => void traced.push(event)
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      const skips = traced.filter((event) => event.phase === "drain-skipped")
      expect(skips).toHaveLength(1)
      expect(skips[0]?.waiting).toBe(0)
    })
  })

  describe("#given an eligible primary", () => {
    it("#then no drain-skipped trace is emitted", async () => {
      // given
      const traced: { phase: string }[] = []
      const { deps } = makeHarness({ primary: "sisyphus" })
      deps.emitTrace = (event) => void traced.push(event)
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(traced.filter((event) => event.phase === "drain-skipped")).toHaveLength(0)
    })
  })

  describe("#given reserve() returns undefined (already reserved by another drain)", () => {
    it("#then the note is not dispatched, not acked, and no pending entry is added", async () => {
      // given
      const { deps, spies } = makeHarness({ primary: "sisyphus", reserveResult: undefined })
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(spies.reserve).toHaveBeenCalledTimes(1)
      expect(spies.dispatchInternalPrompt).not.toHaveBeenCalled()
      expect(spies.markDispatched).not.toHaveBeenCalled()
    })
  })

  describe("#given there is no live session (falsy sessionId)", () => {
    it("#then SAFETY-B: the hook returns early with zero session/store activity", async () => {
      // given
      const { deps, spies } = makeHarness({ primary: "sisyphus" })
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "" })

      // then
      expect(spies.resolveActivePrimaryAgent).not.toHaveBeenCalled()
      expect(spies.makeMailboxStore).not.toHaveBeenCalled()
      expect(spies.dispatchInternalPrompt).not.toHaveBeenCalled()
      expect(spies.reserve).not.toHaveBeenCalled()
      expect(spies.quarantine).not.toHaveBeenCalled()
    })
  })

  describe("#given a full drain cycle on an eligible session", () => {
    it("#then SAFETY-C: the hook never writes a note or sends a reply", async () => {
      // given
      const { deps, spies } = makeHarness({ primary: "sisyphus" })
      const store = deps.makeMailboxStore("/repos/beta", "alpha-id") as Record<string, unknown>
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(store["writeNote"]).toBeUndefined()
      expect(spies.makeMailboxStore).toHaveBeenCalled()
    })
  })

  describe("#given an unread note with intent plan on an eligible session", () => {
    it("#then SAFETY-D: no prometheus spawn occurs and the note is dispatched normally", async () => {
      // given
      const planNote = makeNote({ intent: "plan" })
      const { deps, spies } = makeHarness({ primary: "sisyphus", notes: [planNote] })
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(spies.dispatchInternalPrompt).toHaveBeenCalledTimes(1)
      const dispatchedArg = spies.dispatchInternalPrompt.mock.calls[0][0]
      const serialized = JSON.stringify(dispatchedArg)
      expect(serialized.toLowerCase()).not.toContain("prometheus")
      expect(spies.buildTriagePrompt.mock.calls[0][0].intent).toBe("plan")
    })
  })

  describe("#given validateInbound rejects the note as unauthorized", () => {
    it("#then the note is quarantined and not dispatched", async () => {
      // given
      const { deps, spies } = makeHarness({
        primary: "sisyphus",
        validation: { valid: false, reason: "unauthorized", detail: "nope" },
      })
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(spies.quarantine).toHaveBeenCalledTimes(1)
      expect(spies.quarantine.mock.calls[0][1]).toBe("unauthorized")
      expect(spies.dispatchInternalPrompt).not.toHaveBeenCalled()
    })
  })

  describe("#given the same-pair rate limiter reports limited", () => {
    it("#then the note stays unread (not quarantined) and is not dispatched", async () => {
      // given
      const { deps, spies } = makeHarness({ primary: "sisyphus", rateLimited: true })
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(spies.quarantine).not.toHaveBeenCalled()
      expect(spies.dispatchInternalPrompt).not.toHaveBeenCalled()
      expect(spies.reserve).toHaveBeenCalledTimes(1)
      expect(spies.unreserve).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given the body digest store reports a duplicate body", () => {
    it("#then validateInbound is called with duplicateLoop and the note is quarantined duplicate-loop", async () => {
      // given
      const { deps, spies } = makeHarness({
        primary: "sisyphus",
        duplicate: true,
      })
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(spies.validateInbound).toHaveBeenCalledTimes(2)
      expect(spies.validateInbound.mock.calls[1][2]).toEqual({ duplicateLoop: true })
      expect(spies.quarantine).toHaveBeenCalledTimes(1)
      expect(spies.quarantine.mock.calls[0][1]).toBe("duplicate-loop")
      expect(spies.dispatchInternalPrompt).not.toHaveBeenCalled()
    })
  })

  describe("#given a max_notes_per_drain cap of 1 with two unread notes", () => {
    it("#then only one note is dispatched per idle cycle", async () => {
      // given
      const config = makeConfig({
        bounds: { ...makeConfig().bounds, max_notes_per_drain: 1 },
      })
      const notes = [
        makeNote({ messageId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
        makeNote({ messageId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }),
      ]
      const { deps, spies } = makeHarness({ primary: "sisyphus", config, notes: notes.slice(0, 1) })
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(spies.drainUnread.mock.calls[0][0]).toBe(1)
      expect(spies.dispatchInternalPrompt).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given a sender's access is flipped after the live-config TTL", () => {
    it("#then the next idle drain observes the new permission", async () => {
      // given
      let now = 0
      const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now)
      const denyConfig = makeConfig({
        default_sender_access: "allow-none",
        senders: { "alpha-id": { access: "deny", intent_budget: "impl" } },
      })
      const allowConfig = makeConfig({
        default_sender_access: "allow-none",
        senders: { "alpha-id": { access: "allow", intent_budget: "impl" } },
      })
      const reads = [
        { valid: true, config: { cross_project_mailbox: denyConfig } },
        { valid: true, config: { cross_project_mailbox: allowConfig } },
      ]
      const { deps, spies } = makeHarness({ primary: "sisyphus" })
      spies.validatePluginConfig.mockImplementation(() => reads.shift())
      const hook = createIdleDrainHook(deps)

      try {
        // when
        await hook["session.idle"]({ sessionId: "ses_1" })
        now = 3_000
        await hook["session.idle"]({ sessionId: "ses_1" })

        // then
        expect(spies.validateInbound).toHaveBeenCalled()
        expect(spies.validateInbound.mock.calls.at(-1)?.[1]).toBe(allowConfig)
      } finally {
        nowSpy.mockRestore()
      }
    })
  })

  describe("#given a permissionless config (allow-none with no allow senders)", () => {
    it("#then the handler early-outs before resolving primary or listing projects", async () => {
      // given
      const permissionless = makeConfig({
        default_sender_access: "allow-none",
        senders: {},
      })
      const { deps, spies } = makeHarness({
        primary: "sisyphus",
        freshConfigRead: { valid: true, config: { cross_project_mailbox: permissionless } },
      })
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(spies.resolveActivePrimaryAgent).not.toHaveBeenCalled()
      expect(spies.getRegisteredProjects).not.toHaveBeenCalled()
      expect(spies.makeMailboxStore).not.toHaveBeenCalled()
      expect(spies.dispatchInternalPrompt).not.toHaveBeenCalled()
    })
  })

  describe("#given a fresh read where the mailbox is disabled", () => {
    it("#then the handler early-outs before any scan", async () => {
      // given
      const disabled = makeConfig({ enabled: false, default_sender_access: "allow-all" })
      const { deps, spies } = makeHarness({
        primary: "sisyphus",
        freshConfigRead: { valid: true, config: { cross_project_mailbox: disabled } },
      })
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(spies.resolveActivePrimaryAgent).not.toHaveBeenCalled()
      expect(spies.getRegisteredProjects).not.toHaveBeenCalled()
      expect(spies.makeMailboxStore).not.toHaveBeenCalled()
    })
  })

  describe("#given a malformed fresh config read (valid:false)", () => {
    it("#then it falls back to the last-known-good captured config and the drain completes", async () => {
      // given
      const goodConfig = makeConfig({ default_sender_access: "allow-all" })
      const { deps, spies } = makeHarness({
        primary: "sisyphus",
        config: goodConfig,
        freshConfigRead: { valid: false, config: { cross_project_mailbox: undefined } },
      })
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(spies.dispatchInternalPrompt).toHaveBeenCalledTimes(1)
      expect(spies.validateInbound.mock.calls[0][1]).toBe(goodConfig)
    })
  })

  describe("#given an active session status", () => {
    it("#then the handler early-outs before resolving primary or scanning mailbox", async () => {
      // given
      const { deps, spies } = makeHarness({ primary: "sisyphus" })
      const busySession: NonNullable<IdleDrainHookDeps["client"]["session"]> = {
        status: jest.fn(async () => ({ data: { ses_1: { type: "busy" } } })),
        promptAsync: jest.fn(async () => ({})),
      }
      deps.client = { session: busySession }
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(spies.resolveActivePrimaryAgent).not.toHaveBeenCalled()
      expect(spies.makeMailboxStore).not.toHaveBeenCalled()
    })
  })

  describe("#given a note reserved but dispatchInternalPrompt is rejected", () => {
    it("#then calls unreserve to release the note immediately", async () => {
      // given
      const { deps, spies } = makeHarness({ primary: "sisyphus" })
      spies.dispatchInternalPrompt.mockResolvedValue({ status: "reserved" })
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(spies.dispatchInternalPrompt).toHaveBeenCalledTimes(1)
      expect(spies.unreserve).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111")
      expect(spies.markDispatched).not.toHaveBeenCalled()
    })
  })

  describe("#given requested_mode answer with live presence", () => {
    it("#then routes through the injected answer-local lane without legacy triage dispatch", async () => {
      // given
      const config = makeConfig({
        default_sender_access: "allow-none",
        senders: { "alpha-id": { access: "allow", intent_budget: "plan" } },
      })
      const note = makeNote({ requested_mode: "answer", intent: "question" })
      const answerFulfill = jest.fn(async (input: UnreadMessage) => {
        await depsForAnswer.store.ack(input.messageId)
        return { status: "replied", replyMessageId: "reply_1" } as const
      })
      const depsForAnswer: { store: MailboxStorePort } = { store: undefined as unknown as MailboxStorePort }
      const { deps, spies } = makeHarness({ primary: "sisyphus", config, notes: [note] })
      depsForAnswer.store = deps.makeMailboxStore("/repos/beta", "alpha-id")
      deps.answerLocalLane = () => ({ fulfill: answerFulfill })
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(answerFulfill).toHaveBeenCalledWith(note)
      expect(spies.buildTriagePrompt).not.toHaveBeenCalled()
      expect(spies.dispatchInternalPrompt).not.toHaveBeenCalled()
      expect(spies.markDispatched.mock.calls[0][0]).toMatchObject({
        messageId: note.messageId,
        requestedMode: "answer",
        effectiveMode: "answer",
        lane: "answer-local",
      })
    })
  })

  describe("#given requested_mode todo-next", () => {
    it("#then routes through the todo injector and records route metadata", async () => {
      // given
      const config = makeConfig({
        default_sender_access: "allow-none",
        senders: { "alpha-id": { access: "allow", intent_budget: "impl" } },
      })
      const note = makeNote({ requested_mode: "todo-next" })
      const todoInjector = {
        append: jest.fn(async () => ({ outcome: "written", count: 1 }) as const),
        insertNext: jest.fn(async () => ({ outcome: "written", count: 1 }) as const),
        prepend: jest.fn(async () => ({ outcome: "written", count: 1 }) as const),
        restore: jest.fn(async () => undefined),
        snapshot: jest.fn(async () => []),
      }
      const { deps, spies } = makeHarness({ primary: "sisyphus", config, notes: [note] })
      deps.todoInjector = todoInjector
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(todoInjector.insertNext).toHaveBeenCalledTimes(1)
      expect(spies.ack).toHaveBeenCalledWith(note.messageId)
      expect(spies.dispatchInternalPrompt).not.toHaveBeenCalled()
      expect(spies.markDispatched.mock.calls[0][0]).toMatchObject({
        requestedMode: "todo-next",
        effectiveMode: "todo-next",
        lane: "todo-next",
      })
    })
  })

  describe("#given requested_mode subagent", () => {
    it("#then routes through runSubagentLane deps and leaves completion async", async () => {
      // given
      const config = makeConfig({
        default_sender_access: "allow-none",
        senders: { "alpha-id": { access: "allow", intent_budget: "impl" } },
      })
      const note = makeNote({ requested_mode: "subagent", category: "quick" })
      const spawn = jest.fn(async () => ({ taskId: "task_1" }))
      const { deps, spies } = makeHarness({ primary: "sisyphus", config, notes: [note] })
      deps.subagentLaneDeps = {
        senderCeiling: "impl",
        spawn,
        waitForTask: jest.fn(async () => ({ status: "completed", result: "done" }) as const),
        sendReply: jest.fn(async () => undefined),
      }
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(spawn).toHaveBeenCalledTimes(1)
      expect(spies.ack).toHaveBeenCalledWith(note.messageId)
      expect(spies.dispatchInternalPrompt).not.toHaveBeenCalled()
    })
  })

  describe("#given requested_mode worker-pr with cloudhome declaration", () => {
    it("#then upgrades the local router decision to the remote worker contract lane", async () => {
      // given
      const config = makeConfig({
        default_sender_access: "allow-none",
        senders: { "alpha-id": { access: "allow", intent_budget: "plan" } },
      })
      const note = makeNote({ requested_mode: "worker-pr", category: "worker-pr-cloudhome" })
      const dispatchRemote = jest.fn(async () => ({ status: "pending-remote", deduped: false, outboundMessageId: "out_1" }) as const)
      const { deps, spies } = makeHarness({ primary: "sisyphus", config, notes: [note] })
      deps.cloudhomeContractDeps = {
        config: { thisProjectId: "beta-id", repo: "/repos/beta" },
        deps: {
          store: {
            isPending: jest.fn(async () => false),
            getPending: jest.fn(async () => undefined),
            findByOutboundMessageId: jest.fn(async () => undefined),
            markPending: jest.fn(async () => undefined),
            clearPending: jest.fn(async () => undefined),
          },
          sendOutbound: jest.fn(async () => ({ outboundMessageId: "out_1" })),
        },
        dispatchRemoteContract: dispatchRemote,
      }
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(dispatchRemote).toHaveBeenCalledTimes(1)
      expect(spies.markDispatched.mock.calls[0][0]).toMatchObject({
        effectiveMode: "worker-pr",
        lane: "worker-pr-cloudhome",
      })
    })
  })

  describe("#given a lane throws after reservation", () => {
    it("#then rolls back to unread and uses legacy triage on the next drain pass", async () => {
      // given
      const config = makeConfig({
        default_sender_access: "allow-none",
        senders: { "alpha-id": { access: "allow", intent_budget: "impl" } },
      })
      const note = makeNote({ requested_mode: "todo-append" })
      const todoInjector = {
        append: jest.fn(async () => {
          throw new Error("boom")
        }),
        insertNext: jest.fn(async () => ({ outcome: "written", count: 1 }) as const),
        prepend: jest.fn(async () => ({ outcome: "written", count: 1 }) as const),
        restore: jest.fn(async () => undefined),
        snapshot: jest.fn(async () => []),
      }
      const { deps, spies } = makeHarness({ primary: "sisyphus", config, notes: [note] })
      deps.todoInjector = todoInjector
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(spies.unreserve).toHaveBeenCalledWith(note.messageId)
      expect(spies.rollback).toHaveBeenCalled()
      expect(spies.buildTriagePrompt).toHaveBeenCalledTimes(1)
      expect(spies.dispatchInternalPrompt).toHaveBeenCalledTimes(1)
    })
  })
})
