import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test"

import type { CrossProjectMailboxConfig } from "../config"
import { createLiveMailboxConfigResolver } from "./live-config"

type ConfigRead = {
  readonly valid: boolean
  readonly config: { readonly cross_project_mailbox?: CrossProjectMailboxConfig }
}

const FALLBACK_CONFIG: CrossProjectMailboxConfig = {
  enabled: true,
  intake_eligible_agents: ["sisyphus"],
  interrupt_policy: "idle-drain",
  default_sender_access: "allow-none",
  senders: {},
  bounds: {
    max_hops: 4,
    max_notes_per_drain: 5,
    same_pair_rate_limit_per_min: 6,
    body_digest_ttl_min: 60,
    max_body_bytes: 32_768,
    reservation_ttl_ms: 120_000,
  },
  launch_policy: "disabled",
}

const CONFIG_V1: CrossProjectMailboxConfig = {
  ...FALLBACK_CONFIG,
  default_sender_access: "allow-all",
  senders: { "project-a": { access: "allow", intent_budget: "impl" } },
}

const CONFIG_V2: CrossProjectMailboxConfig = {
  ...CONFIG_V1,
  senders: {
    ...CONFIG_V1.senders,
    "project-b": { access: "allow", intent_budget: "question" },
  },
}

let readConfig: (directory: string) => ConfigRead = () => ({
  valid: true,
  config: { cross_project_mailbox: CONFIG_V1 },
})
const validatePluginConfig = mock((directory: string): ConfigRead => readConfig(directory))

let logged: string[] = []

/**
 * Captures reports through the injected reporter rather than the shared logger singleton, which
 * other suites replace at module scope — an observation channel the resolver's own tests must not
 * depend on.
 */
const report = (message: string, data: Record<string, unknown>): void =>
  void logged.push(`${message} ${JSON.stringify(data)}`)

beforeEach(() => {
  validatePluginConfig.mockClear()
  readConfig = () => ({ valid: true, config: { cross_project_mailbox: CONFIG_V1 } })
  logged = []
})

describe("createLiveMailboxConfigResolver", () => {
  it("#given a live config edit #when the strict 3000ms TTL elapses #then the edit takes effect", async () => {
    // given
    let now = 0
    let current = CONFIG_V1
    const nowSpy = spyOn(Date, "now").mockImplementation(() => now)
    readConfig = () => ({ valid: true, config: { cross_project_mailbox: current } })
    const resolver = createLiveMailboxConfigResolver("/repo", FALLBACK_CONFIG, { validate: validatePluginConfig })

    // when
    const first = await resolver.resolve()
    current = CONFIG_V2
    now = 2_999
    const cached = await resolver.resolve()
    now = 3_000
    const fresh = await resolver.resolve()

    // then
    expect(first).toEqual(CONFIG_V1)
    expect(cached).toEqual(CONFIG_V1)
    expect(fresh).toEqual(CONFIG_V2)
    expect(validatePluginConfig).toHaveBeenCalledTimes(2)
    nowSpy.mockRestore()
  })

  it("#given config resolution throws #when resolved #then the startup snapshot is returned", async () => {
    // given
    readConfig = () => {
      throw new Error("config read failed")
    }
    const resolver = createLiveMailboxConfigResolver("/repo", FALLBACK_CONFIG, { validate: validatePluginConfig })

    // when
    const result = await resolver.resolve()

    // then
    expect(result).toEqual(FALLBACK_CONFIG)
  })

  it("#given one TTL window #when resolve is called 100 times #then one read and no extra stat-triggering reads occur", async () => {
    // given
    const resolver = createLiveMailboxConfigResolver("/repo", FALLBACK_CONFIG, { validate: validatePluginConfig })

    // when
    const first = await resolver.resolve()
    const remaining = await Promise.all(Array.from({ length: 99 }, () => resolver.resolve()))

    // then
    expect(first).toEqual(CONFIG_V1)
    expect(remaining).toHaveLength(99)
    expect(validatePluginConfig).toHaveBeenCalledTimes(1)
  })

  it("#given an expired cache #when resolved #then exactly one fresh read occurs", async () => {
    // given
    let now = 10
    const nowSpy = spyOn(Date, "now").mockImplementation(() => now)
    const resolver = createLiveMailboxConfigResolver("/repo", FALLBACK_CONFIG, { validate: validatePluginConfig })
    await resolver.resolve()
    now = 3_010

    // when
    await resolver.resolve()

    // then
    expect(validatePluginConfig).toHaveBeenCalledTimes(2)
    nowSpy.mockRestore()
  })

  it("#given concurrent callers during a deferred read #when all resolve #then they share one underlying read", async () => {
    // given
    const resolver = createLiveMailboxConfigResolver("/repo", FALLBACK_CONFIG, { validate: validatePluginConfig })

    // when
    const pending = Array.from({ length: 50 }, () => resolver.resolve())
    expect(validatePluginConfig).toHaveBeenCalledTimes(0)
    const results = await Promise.all(pending)

    // then
    expect(results.every((config) => config === CONFIG_V1)).toBe(true)
    expect(validatePluginConfig).toHaveBeenCalledTimes(1)
  })

  it("#given a cached value #when invalidated and resolved #then a fresh read happens immediately", async () => {
    // given
    let current = CONFIG_V1
    readConfig = () => ({ valid: true, config: { cross_project_mailbox: current } })
    const resolver = createLiveMailboxConfigResolver("/repo", FALLBACK_CONFIG, { validate: validatePluginConfig })
    await resolver.resolve()
    current = CONFIG_V2

    // when
    resolver.invalidate()
    const result = await resolver.resolve()

    // then
    expect(result).toEqual(CONFIG_V2)
    expect(validatePluginConfig).toHaveBeenCalledTimes(2)
  })

  describe("#given the config cannot be read", () => {
    it("#when validation reports it invalid #then the fallback is reported, not silent", async () => {
      // given
      readConfig = () => ({ valid: false, config: {} })
      const resolver = createLiveMailboxConfigResolver("/repo", FALLBACK_CONFIG, {
        validate: validatePluginConfig,
        report,
      })

      // when
      const result = await resolver.resolve()

      // then
      expect(result).toEqual(FALLBACK_CONFIG)
      expect(logged.filter((line) => line.includes("[mailbox-live-config]"))).toHaveLength(1)
      expect(logged.join("\n")).toContain("sender permissions unavailable")
      expect(logged.join("\n")).toContain("/repo")
    })

    it("#when the read throws #then the cause is named rather than swallowed", async () => {
      // given
      readConfig = () => {
        throw new Error("EACCES: permission denied")
      }
      const resolver = createLiveMailboxConfigResolver("/repo", FALLBACK_CONFIG, {
        validate: validatePluginConfig,
        report,
      })

      // when
      const result = await resolver.resolve()

      // then
      expect(result).toEqual(FALLBACK_CONFIG)
      expect(logged.join("\n")).toContain("EACCES: permission denied")
    })

    it("#when the same failure repeats across renders #then it is reported once, not per render", async () => {
      // given
      let now = 0
      const nowSpy = spyOn(Date, "now").mockImplementation(() => now)
      readConfig = () => ({ valid: false, config: {} })
      const resolver = createLiveMailboxConfigResolver("/repo", FALLBACK_CONFIG, {
        validate: validatePluginConfig,
        report,
      })

      // when
      for (let render = 0; render < 5; render += 1) {
        now += 3_000
        await resolver.resolve()
      }

      // then
      expect(validatePluginConfig).toHaveBeenCalledTimes(5)
      expect(logged.filter((line) => line.includes("[mailbox-live-config]"))).toHaveLength(1)
      nowSpy.mockRestore()
    })

    it("#when the config recovers and breaks again #then the second failure is reported too", async () => {
      // given
      let now = 0
      const nowSpy = spyOn(Date, "now").mockImplementation(() => now)
      let broken = true
      readConfig = () =>
        broken
          ? { valid: false, config: {} }
          : { valid: true, config: { cross_project_mailbox: CONFIG_V1 } }
      const resolver = createLiveMailboxConfigResolver("/repo", FALLBACK_CONFIG, {
        validate: validatePluginConfig,
        report,
      })

      // when
      await resolver.resolve()
      broken = false
      now += 3_000
      const recovered = await resolver.resolve()
      broken = true
      now += 3_000
      await resolver.resolve()

      // then
      expect(recovered).toEqual(CONFIG_V1)
      expect(logged.filter((line) => line.includes("[mailbox-live-config]"))).toHaveLength(2)
      nowSpy.mockRestore()
    })
  })
})
