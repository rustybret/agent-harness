import { describe, expect, it } from "bun:test"

import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "../config"
import {
  CrossProjectMailboxConfigSchema,
  type CrossProjectMailboxConfig,
} from "../features/cross-project-mailbox/config"
import { mergeConfigs } from "./config-merger"

type MailboxLayer = Partial<Omit<CrossProjectMailboxConfig, "bounds">> & {
  readonly bounds?: Partial<CrossProjectMailboxConfig["bounds"]>
}

const MAILBOX_KEYS = [
  "enabled",
  "intake_eligible_agents",
  "interrupt_policy",
  "default_sender_access",
  "senders",
  "launch_policy",
  "bounds",
] as const satisfies readonly (keyof CrossProjectMailboxConfig)[]

const BOUNDS_KEYS = [
  "max_hops",
  "max_notes_per_drain",
  "same_pair_rate_limit_per_min",
  "body_digest_ttl_min",
  "max_body_bytes",
  "reservation_ttl_ms",
] as const satisfies readonly (keyof CrossProjectMailboxConfig["bounds"])[]

function createMailboxLayer(input: MailboxLayer): CrossProjectMailboxConfig {
  const config = CrossProjectMailboxConfigSchema.parse(input)

  for (const key of MAILBOX_KEYS) {
    if (!(key in input)) {
      Reflect.deleteProperty(config, key)
    }
  }

  if (input.bounds !== undefined) {
    for (const key of BOUNDS_KEYS) {
      if (!(key in input.bounds)) {
        Reflect.deleteProperty(config.bounds, key)
      }
    }
  }

  return config
}

function mergeMailboxLayers(
  userMailbox: MailboxLayer | undefined,
  projectMailbox: MailboxLayer | undefined,
): CrossProjectMailboxConfig | undefined {
  const base = OhMyOpenCodeConfigSchema.parse({})
  const override: Partial<OhMyOpenCodeConfig> = {}

  if (userMailbox !== undefined) {
    base.cross_project_mailbox = createMailboxLayer(userMailbox)
  }
  if (projectMailbox !== undefined) {
    override.cross_project_mailbox = createMailboxLayer(projectMailbox)
  }

  return mergeConfigs(base, override).cross_project_mailbox
}

describe("mergeConfigs cross_project_mailbox", () => {
  describe("#given a user allow-all default and a project sender stub", () => {
    describe("#when merging config layers", () => {
      it("#then preserves the user default_sender_access", () => {
        // given
        const userMailbox = { default_sender_access: "allow-all" } satisfies MailboxLayer
        const projectMailbox = { senders: {} } satisfies MailboxLayer

        // when
        const result = mergeMailboxLayers(userMailbox, projectMailbox)

        // then
        expect(result?.default_sender_access).toBe("allow-all")
      })
    })
  })

  describe("#given the project explicitly denies unknown senders", () => {
    describe("#when merging over a user allow-all default", () => {
      it("#then the project allow-none value wins", () => {
        // given
        const userMailbox = { default_sender_access: "allow-all" } satisfies MailboxLayer
        const projectMailbox = { default_sender_access: "allow-none" } satisfies MailboxLayer

        // when
        const result = mergeMailboxLayers(userMailbox, projectMailbox)

        // then
        expect(result?.default_sender_access).toBe("allow-none")
      })
    })
  })

  describe("#given user and project sender entries", () => {
    describe("#when merging sender maps", () => {
      it("#then unions distinct keys and lets the project win on the same key", () => {
        // given
        const userMailbox = {
          senders: {
            "user-only": { access: "allow", intent_budget: "question" },
            shared: { access: "allow", intent_budget: "impl" },
          },
        } satisfies MailboxLayer
        const projectMailbox = {
          senders: {
            "project-only": { access: "allow", intent_budget: "plan" },
            shared: { access: "deny", intent_budget: "question" },
          },
        } satisfies MailboxLayer

        // when
        const result = mergeMailboxLayers(userMailbox, projectMailbox)

        // then
        expect(result?.senders).toEqual({
          "user-only": { access: "allow", intent_budget: "question" },
          "project-only": { access: "allow", intent_budget: "plan" },
          shared: { access: "deny", intent_budget: "question" },
        })
      })
    })
  })

  describe("#given neither layer defines cross_project_mailbox", () => {
    describe("#when merging config layers", () => {
      it("#then leaves the mailbox undefined for post-merge default injection", () => {
        // given
        const userMailbox = undefined
        const projectMailbox = undefined

        // when
        const result = mergeMailboxLayers(userMailbox, projectMailbox)

        // then
        expect(result).toBeUndefined()
      })
    })
  })

  describe("#given user bounds and a partial project bounds override", () => {
    describe("#when merging config layers", () => {
      it("#then merges bounds per key", () => {
        // given
        const userMailbox = {
          bounds: { max_hops: 8, max_body_bytes: 64_000 },
        } satisfies MailboxLayer
        const projectMailbox = {
          bounds: { max_hops: 2 },
        } satisfies MailboxLayer

        // when
        const result = mergeMailboxLayers(userMailbox, projectMailbox)

        // then
        expect(result?.bounds.max_hops).toBe(2)
        expect(result?.bounds.max_body_bytes).toBe(64_000)
      })
    })
  })

  describe("#given a legacy user sender grant and a project stub", () => {
    describe("#when merging config layers", () => {
      it("#then intentionally activates the legacy sender entry announced by T3", () => {
        // given: T3 warns users that this previously inert grant becomes globally active.
        const userMailbox = {
          senders: {
            "legacy-x": { access: "allow", intent_budget: "impl" },
          },
        } satisfies MailboxLayer
        const projectMailbox = { senders: {} } satisfies MailboxLayer

        // when
        const result = mergeMailboxLayers(userMailbox, projectMailbox)

        // then
        expect(result?.senders["legacy-x"]).toEqual({
          access: "allow",
          intent_budget: "impl",
        })
      })
    })
  })
})
