import { describe, expect, it } from "bun:test"
import { CrossProjectMailboxConfigSchema, SenderConfigSchema } from "./config"

describe("CrossProjectMailboxConfigSchema", () => {
  describe("#given no config provided", () => {
    describe("#when parsing an empty object", () => {
      it("#then applies the documented defaults", () => {
        // given
        const input = {}

        // when
        const result = CrossProjectMailboxConfigSchema.parse(input)

        // then
        expect(result.enabled).toBe(true)
        expect(result.intake_eligible_agents).toEqual(["sisyphus"])
        expect(result.interrupt_policy).toBe("idle-drain")
        expect(result.default_sender_access).toBe("allow-none")
        expect(result.senders).toEqual({})
        expect(result.launch_policy).toBe("disabled")
      })

      it("#then accepts the launch_policy enum values", () => {
        // given / when / then
        expect(CrossProjectMailboxConfigSchema.parse({ launch_policy: "ask" }).launch_policy).toBe("ask")
        expect(CrossProjectMailboxConfigSchema.parse({ launch_policy: "auto" }).launch_policy).toBe("auto")
        expect(CrossProjectMailboxConfigSchema.safeParse({ launch_policy: "invalid" }).success).toBe(false)
      })

      it("#then applies the documented bounds defaults", () => {
        // given
        const input = {}

        // when
        const result = CrossProjectMailboxConfigSchema.parse(input)

        // then
        expect(result.bounds).toEqual({
          max_hops: 4,
          max_notes_per_drain: 5,
          same_pair_rate_limit_per_min: 6,
          body_digest_ttl_min: 60,
          max_body_bytes: 32768,
          reservation_ttl_ms: 120000,
          max_delivery_attempts: 3,
        })
      })
    })
  })

  describe("#given a full valid config block", () => {
    describe("#when parsing with every field provided", () => {
      it("#then returns the typed result with the provided values", () => {
        // given
        const input = {
          enabled: true,
          intake_eligible_agents: ["sisyphus", "atlas"],
          interrupt_policy: "allow-interrupt",
          default_sender_access: "allow-all",
          senders: {
            "project-alpha": { access: "allow", intent_budget: "impl" },
            "project-beta": { access: "deny", intent_budget: "review" },
          },
          bounds: {
            max_hops: 2,
            max_notes_per_drain: 10,
            same_pair_rate_limit_per_min: 12,
            body_digest_ttl_min: 30,
            max_body_bytes: 16384,
            reservation_ttl_ms: 60000,
          },
        }

        // when
        const result = CrossProjectMailboxConfigSchema.parse(input)

        // then
        expect(result.enabled).toBe(true)
        expect(result.intake_eligible_agents).toEqual(["sisyphus", "atlas"])
        expect(result.interrupt_policy).toBe("allow-interrupt")
        expect(result.default_sender_access).toBe("allow-all")
        expect(result.senders["project-alpha"]).toEqual({ access: "allow", intent_budget: "impl" })
        expect(result.senders["project-beta"]).toEqual({ access: "deny", intent_budget: "plan" })
        expect(result.bounds.max_hops).toBe(2)
      })

      it("#then defaults sender access to allow when omitted", () => {
        // given
        const input = {
          senders: {
            "project-gamma": { intent_budget: "question" },
          },
        }

        // when
        const result = CrossProjectMailboxConfigSchema.parse(input)

        // then
        expect(result.senders["project-gamma"]?.access).toBe("allow")
      })
    })
  })

  describe("#given an unknown agent in intake_eligible_agents", () => {
    describe("#when parsing", () => {
      it("#then throws because OverridableAgentNameSchema rejects it", () => {
        // given
        const input = { intake_eligible_agents: ["bogus-agent"] }

        // when / then
        expect(() => CrossProjectMailboxConfigSchema.parse(input)).toThrow()
      })
    })
  })

  describe("#given a sender with allowed_modes", () => {
    describe("#when parsing a valid mode allowlist", () => {
      it("#then keeps the provided modes", () => {
        // given
        const input = {
          senders: {
            "project-eps": { access: "allow", intent_budget: "plan", allowed_modes: ["answer", "worker-pr"] },
          },
        }

        // when
        const result = CrossProjectMailboxConfigSchema.parse(input)

        // then
        expect(result.senders["project-eps"]?.allowed_modes).toEqual(["answer", "worker-pr"])
      })
    })

    describe("#when allowed_modes is omitted", () => {
      it("#then the field is undefined (implicitly all budget-fitting modes)", () => {
        // given
        const input = {
          senders: {
            "project-zeta": { access: "allow", intent_budget: "impl" },
          },
        }

        // when
        const result = CrossProjectMailboxConfigSchema.parse(input)

        // then
        expect(result.senders["project-zeta"]?.allowed_modes).toBeUndefined()
      })
    })

    describe("#when allowed_modes contains an invalid mode", () => {
      it("#then throws because the enum rejects it", () => {
        // given
        const input = {
          senders: {
            "project-eta": { access: "allow", intent_budget: "plan", allowed_modes: ["bogus-mode"] },
          },
        }

        // when / then
        expect(() => CrossProjectMailboxConfigSchema.parse(input)).toThrow()
      })
    })
  })

  describe("#given SenderConfigSchema directly", () => {
    describe("#when parsing a minimal sender", () => {
      it("#then defaults access to allow and leaves allowed_modes undefined", () => {
        // given / when
        const result = SenderConfigSchema.parse({ intent_budget: "question" })

        // then
        expect(result.access).toBe("allow")
        expect(result.allowed_modes).toBeUndefined()
      })
    })
  })

  describe("#given a sender with worker_pr_variant", () => {
    describe("#when parsing a valid variant value", () => {
      it("#then keeps the provided variant", () => {
        // given
        const input = {
          senders: {
            "project-theta": { access: "allow", intent_budget: "plan", worker_pr_variant: "cloudhome" },
          },
        }

        // when
        const result = CrossProjectMailboxConfigSchema.parse(input)

        // then
        expect(result.senders["project-theta"]?.worker_pr_variant).toBe("cloudhome")
      })

      it("#then accepts the local variant", () => {
        // given / when
        const result = SenderConfigSchema.parse({ intent_budget: "plan", worker_pr_variant: "local" })

        // then
        expect(result.worker_pr_variant).toBe("local")
      })
    })

    describe("#when worker_pr_variant is omitted", () => {
      it("#then the field is undefined (router keeps the local default)", () => {
        // given / when
        const result = SenderConfigSchema.parse({ intent_budget: "impl" })

        // then
        expect(result.worker_pr_variant).toBeUndefined()
      })
    })

    describe("#when worker_pr_variant contains an invalid value", () => {
      it("#then throws because the enum rejects it", () => {
        // given
        const input = {
          senders: {
            "project-iota": { access: "allow", intent_budget: "plan", worker_pr_variant: "remote" },
          },
        }

        // when / then
        expect(() => CrossProjectMailboxConfigSchema.parse(input)).toThrow()
      })
    })
  })

  describe("#given a sender with an invalid intent_budget tier", () => {
    describe("#when parsing", () => {
      it("#then throws because the enum rejects it", () => {
        // given
        const input = {
          senders: {
            "project-delta": { access: "allow", intent_budget: "not-a-real-tier" },
          },
        }

        // when / then
        expect(() => CrossProjectMailboxConfigSchema.parse(input)).toThrow()
      })
    })
  })

  describe("#given an invalid interrupt_policy", () => {
    describe("#when parsing", () => {
      it("#then throws because the enum rejects it", () => {
        // given
        const input = { interrupt_policy: "bogus-policy" }

        // when / then
        expect(() => CrossProjectMailboxConfigSchema.parse(input)).toThrow()
      })
    })
  })
})
