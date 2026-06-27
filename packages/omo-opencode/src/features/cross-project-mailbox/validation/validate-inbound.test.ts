import { describe, expect, it } from "bun:test"
import { CrossProjectMailboxConfigSchema, type CrossProjectMailboxConfig } from "../config"
import type { MailboxMessage } from "../envelope/schema"
import type { RejectionReason } from "./types"
import { INTENT_LADDER, validateInbound, withinBudget } from "./validate-inbound"

function makeNote(overrides: Partial<MailboxMessage> = {}): MailboxMessage {
  const base: MailboxMessage = {
    version: 1,
    messageId: "11111111-1111-1111-1111-111111111111",
    timestamp: 1700000000000,
    correlationId: "22222222-2222-2222-2222-222222222222",
    inReplyToMessageId: null,
    fromProject: "alpha",
    toProject: "beta",
    fromProjectId: "project-alpha",
    toProjectId: "project-beta",
    intent: "quick",
    priority: 0,
    hopCount: 0,
    hopPath: ["project-alpha"],
    supersedes: null,
  }
  return { ...base, ...overrides }
}

function makeConfig(overrides: Partial<CrossProjectMailboxConfig> = {}): CrossProjectMailboxConfig {
  return CrossProjectMailboxConfigSchema.parse({ ...overrides })
}

describe("INTENT_LADDER", () => {
  describe("#given the documented privilege ladder", () => {
    describe("#when read in order", () => {
      it("#then ranks question lowest and plan highest", () => {
        // given / when / then
        expect(INTENT_LADDER).toEqual(["question", "quick", "impl", "review", "work-loop", "plan"])
      })
    })
  })
})

describe("withinBudget", () => {
  describe("#given a note intent below the ceiling", () => {
    describe("#when compared", () => {
      it("#then returns true", () => {
        // given / when / then
        expect(withinBudget("quick", "impl")).toBe(true)
      })
    })
  })

  describe("#given a note intent equal to the ceiling", () => {
    describe("#when compared", () => {
      it("#then returns true", () => {
        // given / when / then
        expect(withinBudget("impl", "impl")).toBe(true)
      })
    })
  })

  describe("#given a note intent above the ceiling", () => {
    describe("#when compared", () => {
      it("#then returns false", () => {
        // given / when / then
        expect(withinBudget("plan", "impl")).toBe(false)
      })
    })
  })
})

describe("validateInbound", () => {
  describe("#given an explicit allow sender", () => {
    describe("#when validating a note within budget", () => {
      it("#then result is valid", () => {
        // given
        const config = makeConfig({
          senders: { "project-alpha": { access: "allow", intent_budget: "plan" } },
        })
        const note = makeNote({ intent: "quick" })

        // when
        const result = validateInbound(note, config)

        // then
        expect(result.valid).toBe(true)
      })
    })
  })

  describe("#given an explicit deny sender", () => {
    describe("#when validating", () => {
      it("#then result is unauthorized", () => {
        // given
        const config = makeConfig({
          senders: { "project-alpha": { access: "deny", intent_budget: "plan" } },
        })
        const note = makeNote({ intent: "quick" })

        // when
        const result = validateInbound(note, config)

        // then
        expect(result.valid).toBe(false)
        expect(result.reason).toBe("unauthorized")
      })
    })
  })

  describe("#given an unlisted sender with default allow-all", () => {
    describe("#when validating a question-intent note", () => {
      it("#then result is valid", () => {
        // given
        const config = makeConfig({ default_sender_access: "allow-all", senders: {} })
        const note = makeNote({ fromProjectId: "project-unknown", intent: "question" })

        // when
        const result = validateInbound(note, config)

        // then
        expect(result.valid).toBe(true)
      })
    })
  })

  describe("#given an unlisted sender with default allow-none", () => {
    describe("#when validating", () => {
      it("#then result is unauthorized", () => {
        // given
        const config = makeConfig({ default_sender_access: "allow-none", senders: {} })
        const note = makeNote({ fromProjectId: "project-unknown", intent: "question" })

        // when
        const result = validateInbound(note, config)

        // then
        expect(result.valid).toBe(false)
        expect(result.reason).toBe("unauthorized")
      })
    })
  })

  describe("#given an explicit sender with an impl budget ceiling", () => {
    describe("#when the note intent is below the ceiling", () => {
      it("#then result is valid", () => {
        // given
        const config = makeConfig({
          senders: { "project-alpha": { access: "allow", intent_budget: "impl" } },
        })
        const note = makeNote({ intent: "quick" })

        // when
        const result = validateInbound(note, config)

        // then
        expect(result.valid).toBe(true)
      })
    })

    describe("#when the note intent is at the ceiling", () => {
      it("#then result is valid", () => {
        // given
        const config = makeConfig({
          senders: { "project-alpha": { access: "allow", intent_budget: "impl" } },
        })
        const note = makeNote({ intent: "impl" })

        // when
        const result = validateInbound(note, config)

        // then
        expect(result.valid).toBe(true)
      })
    })

    describe("#when the note intent is over the ceiling", () => {
      it("#then result is over-budget and is not downgraded", () => {
        // given
        const config = makeConfig({
          senders: { "project-alpha": { access: "allow", intent_budget: "impl" } },
        })
        const note = makeNote({ intent: "plan" })

        // when
        const result = validateInbound(note, config)

        // then
        expect(result.valid).toBe(false)
        expect(result.reason).toBe("over-budget")
      })
    })
  })

  describe("#given an unlisted sender allowed by allow-all", () => {
    describe("#when the note intent is quick (above the lowest ceiling)", () => {
      it("#then result is over-budget", () => {
        // given
        const config = makeConfig({ default_sender_access: "allow-all", senders: {} })
        const note = makeNote({ fromProjectId: "project-unknown", intent: "quick" })

        // when
        const result = validateInbound(note, config)

        // then
        expect(result.valid).toBe(false)
        expect(result.reason).toBe("over-budget")
      })
    })

    describe("#when the note intent is question (the lowest ceiling)", () => {
      it("#then result is valid", () => {
        // given
        const config = makeConfig({ default_sender_access: "allow-all", senders: {} })
        const note = makeNote({ fromProjectId: "project-unknown", intent: "question" })

        // when
        const result = validateInbound(note, config)

        // then
        expect(result.valid).toBe(true)
      })
    })
  })

  describe("#given a note at the max hop count", () => {
    describe("#when validating", () => {
      it("#then result is hop-exceeded", () => {
        // given
        const config = makeConfig({
          senders: { "project-alpha": { access: "allow", intent_budget: "plan" } },
        })
        const note = makeNote({ intent: "quick", hopCount: config.bounds.max_hops })

        // when
        const result = validateInbound(note, config)

        // then
        expect(result.valid).toBe(false)
        expect(result.reason).toBe("hop-exceeded")
      })
    })
  })

  describe("#given a note below the max hop count", () => {
    describe("#when access and budget also pass", () => {
      it("#then result is valid", () => {
        // given
        const config = makeConfig({
          senders: { "project-alpha": { access: "allow", intent_budget: "plan" } },
        })
        const note = makeNote({ intent: "quick", hopCount: config.bounds.max_hops - 1 })

        // when
        const result = validateInbound(note, config)

        // then
        expect(result.valid).toBe(true)
      })
    })
  })

  describe("#given a note missing a required field", () => {
    describe("#when validating a note with an undefined messageId", () => {
      it("#then result is malformed", () => {
        // given
        const config = makeConfig({
          senders: { "project-alpha": { access: "allow", intent_budget: "plan" } },
        })
        const malformed = makeNote()
        delete (malformed as { messageId?: string }).messageId

        // when
        const result = validateInbound(malformed, config)

        // then
        expect(result.valid).toBe(false)
        expect(result.reason).toBe("malformed")
      })
    })
  })

  describe("#given the rate-limit concern that belongs to todo 7", () => {
    describe("#when inspecting the rejection reason type", () => {
      it("#then RejectionReason never includes rate-limited", () => {
        // given / when
        type RateLimitedExcluded = "rate-limited" extends RejectionReason ? never : true
        const rateLimitedExcluded: RateLimitedExcluded = true

        // then
        expect(rateLimitedExcluded).toBe(true)
      })
    })
  })

  describe("#given a note flagged as a duplicate loop", () => {
    describe("#when validating with duplicateLoop true", () => {
      it("#then result is duplicate-loop", () => {
        // given
        const config = makeConfig({
          senders: { "project-alpha": { access: "allow", intent_budget: "plan" } },
        })
        const note = makeNote({ intent: "quick" })

        // when
        const result = validateInbound(note, config, { duplicateLoop: true })

        // then
        expect(result.valid).toBe(false)
        expect(result.reason).toBe("duplicate-loop")
      })
    })
  })
})
