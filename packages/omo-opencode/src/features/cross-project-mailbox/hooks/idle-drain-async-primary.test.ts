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
    messageId: "msg-async-primary",
    fromProjectId: "alpha-id",
    toProjectId: "beta-id",
    createdAt: "2026-07-10T00:00:00.000Z",
    timestamp: 1,
    intent: "impl",
    priority: 0,
    bodyRef: "body.md",
    hops: [],
  }
  return { messageId: envelope.messageId, envelope, body: "queued note" }
}

function makeDeps(): {
  deps: IdleDrainHookDeps
  dispatchInternalPrompt: ReturnType<typeof jest.fn>
  markDispatched: ReturnType<typeof jest.fn>
  resolveActivePrimaryAgent: ReturnType<typeof jest.fn>
} {
  const config = makeConfig()
  const note = makeNote()
  const dispatchInternalPrompt = jest.fn(async () => ({ status: "dispatched", response: {} }) as const)
  const markDispatched = jest.fn(async () => undefined)
  const resolveActivePrimaryAgent = jest.fn(async () => "sisyphus")
  const store = {
    reclaimStale: jest.fn(async () => undefined),
    drainUnread: jest.fn(async () => [note]),
    reserve: jest.fn(async () => "/inbox/.delivering-msg-async-primary.md"),
    unreserve: jest.fn(async () => undefined),
    quarantine: jest.fn(async () => undefined),
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
      resolveActivePrimaryAgent,
      getRegisteredProjects: () => [{ projectId: "alpha-id", repoRoot: "/repos/alpha" }],
      makeMailboxStore: () => store,
      makePendingStore: () => ({ addDispatchSent: jest.fn(async () => undefined) }),
      makeDigestStore: () => ({
        checkAndRecord: jest.fn(async () => ({ isDuplicate: false })),
        rollback: jest.fn(async () => undefined),
      }),
      makeRateLimiter: () => ({ checkRateLimit: jest.fn(async () => ({ limited: false })) }),
      validateInbound: () => ({ valid: true }),
      buildTriagePrompt: () => "TRIAGE_TEXT",
      dispatchInternalPrompt,
      getSessionMessages: async () => [],
    } as IdleDrainHookDeps,
    dispatchInternalPrompt,
    markDispatched,
    resolveActivePrimaryAgent,
  }
}

describe("createIdleDrainHook async primary resolution", () => {
  describe("#given a todo-free idle session whose eligible primary resolves from session history", () => {
    it("#then drains the queued note instead of treating the primary as ineligible", async () => {
      // given
      const { deps, dispatchInternalPrompt, markDispatched, resolveActivePrimaryAgent } = makeDeps()
      const hook = createIdleDrainHook(deps)

      // when
      await hook["session.idle"]({ sessionId: "ses_1" })

      // then
      expect(resolveActivePrimaryAgent).toHaveBeenCalledWith("ses_1")
      expect(dispatchInternalPrompt).toHaveBeenCalledTimes(1)
      expect(markDispatched).toHaveBeenCalledTimes(1)
    })
  })
})
