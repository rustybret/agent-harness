import { describe, expect, it, jest } from "bun:test"

import type { CrossProjectMailboxConfig } from "../config"
import type { MailboxMessage } from "../envelope/schema"
import type { UnreadMessage } from "../mailbox/types"
import { createIdleDrainHook, type IdleDrainHookDeps } from "./idle-drain-hook"

function makeConfig(): CrossProjectMailboxConfig {
  return {
    enabled: true,
    intake_eligible_agents: ["sisyphus"],
    interrupt_policy: "idle-drain",
    default_sender_access: "allow-none",
    senders: { "alpha-id": { access: "allow", intent_budget: "impl" } },
    launch_policy: "disabled",
    bounds: {
      max_hops: 4,
      max_notes_per_drain: 5,
      same_pair_rate_limit_per_min: 6,
      body_digest_ttl_min: 60,
      max_body_bytes: 32768,
      reservation_ttl_ms: 120000,
    },
  }
}

function makeNote(): UnreadMessage {
  const envelope: MailboxMessage = {
    version: 1,
    messageId: "msg-rolled-back",
    fromProjectId: "alpha-id",
    toProjectId: "beta-id",
    createdAt: "2026-08-03T00:00:00.000Z",
    timestamp: 1,
    intent: "question",
    requested_mode: "answer",
    priority: 0,
    bodyRef: "body.md",
    hops: [],
  }
  return { messageId: envelope.messageId, envelope, body: "answer me" }
}

function makeDeps(): {
  deps: IdleDrainHookDeps
  unreserve: ReturnType<typeof jest.fn>
  rollback: ReturnType<typeof jest.fn>
  markDispatched: ReturnType<typeof jest.fn>
  checkAndRecord: ReturnType<typeof jest.fn>
} {
  const config = makeConfig()
  const note = makeNote()
  const unreserve = jest.fn(async () => undefined)
  const rollback = jest.fn(async () => undefined)
  const markDispatched = jest.fn(async () => undefined)
  const checkAndRecord = jest.fn(async () => ({ isDuplicate: false }))
  const store = {
    reclaimStale: jest.fn(async () => [] as string[]),
    drainUnread: jest.fn(async () => [note]),
    reserve: jest.fn(async () => "/inbox/.delivering-msg-rolled-back.md"),
    unreserve,
    quarantine: jest.fn(async () => undefined),
    ack: jest.fn(async () => undefined),
    markDispatched,
  }

  return {
    deps: {
      config,
      validatePluginConfig: () => ({ valid: true, config: { cross_project_mailbox: config } }),
      repoRoot: "/repos/beta",
      directory: "/repos/beta",
      projectDisplayName: "beta",
      client: { session: { promptAsync: jest.fn(async () => ({})) } },
      resolveActivePrimaryAgent: jest.fn(async () => "sisyphus"),
      getRegisteredProjects: () => [{ projectId: "alpha-id", repoRoot: "/repos/alpha" }],
      makeMailboxStore: () => store,
      makePendingStore: () => ({ addDispatchSent: jest.fn(async () => undefined) }),
      makeDigestStore: () => ({ checkAndRecord, rollback }),
      makeRateLimiter: () => ({ checkRateLimit: jest.fn(async () => ({ limited: false })) }),
      validateInbound: () => ({ valid: true }),
      buildTriagePrompt: () => "TRIAGE_TEXT",
      dispatchInternalPrompt: jest.fn(async () => ({ status: "dispatched", response: {} }) as const),
      getSessionMessages: async () => [],
      answerLocalLane: () => ({
        fulfill: async () => ({ status: "rolled-back", downgradeReason: "child-session-failed" }) as const,
      }),
    } as unknown as IdleDrainHookDeps,
    unreserve,
    rollback,
    markDispatched,
    checkAndRecord,
  }
}

describe("createIdleDrainHook fallback-next-drain rollback", () => {
  describe("#given a routed lane that rolls back and defers the note to the next drain", () => {
    it("#then the reservation is released and the body digest is rolled back", async () => {
      // given
      const { deps, unreserve, rollback, markDispatched } = makeDeps()
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(markDispatched).not.toHaveBeenCalled()
      expect(unreserve).toHaveBeenCalledWith("msg-rolled-back")
      expect(rollback).toHaveBeenCalledTimes(1)
    })

    it("#then the next drain redelivers the same body instead of rejecting it as a duplicate", async () => {
      // given
      const { deps, checkAndRecord, markDispatched } = makeDeps()
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(checkAndRecord).toHaveBeenCalledTimes(2)
      expect(checkAndRecord.mock.results.every((result) => result.type === "return")).toBe(true)
      expect(markDispatched).toHaveBeenCalledTimes(1)
    })
  })
})
