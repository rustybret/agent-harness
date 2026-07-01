import { describe, expect, it, jest } from "bun:test"

import { launchTargetSession, type LaunchSpawn, type LaunchSpawnResult } from "./launch-target"

function makeSpawn(): { spawn: LaunchSpawn; calls: Array<{ command: string[]; cwd: string; logPath: string }> } {
  const calls: Array<{ command: string[]; cwd: string; logPath: string }> = []
  const spawn: LaunchSpawn = (command, options) => {
    calls.push({ command, cwd: options.cwd, logPath: options.logPath })
    const result: LaunchSpawnResult = { pid: 4242, unref: () => {} }
    return result
  }
  return { spawn, calls }
}

describe("launchTargetSession", () => {
  describe("#given policy disabled", () => {
    it("#then returns false immediately without spawning or asking", async () => {
      // given
      const { spawn, calls } = makeSpawn()
      const ask = jest.fn(async () => true)

      // when
      const launched = await launchTargetSession("/repos/target", {
        policy: "disabled",
        projectId: "target-id",
        launchPermissionAsk: ask,
        deps: { spawn },
      })

      // then
      expect(launched).toBe(false)
      expect(calls).toHaveLength(0)
      expect(ask).not.toHaveBeenCalled()
    })
  })

  describe("#given policy ask and the permission callback denies", () => {
    it("#then returns false and never spawns", async () => {
      // given
      const { spawn, calls } = makeSpawn()
      const ask = jest.fn(async () => false)

      // when
      const launched = await launchTargetSession("/repos/target", {
        policy: "ask",
        projectId: "target-id",
        launchPermissionAsk: ask,
        deps: { spawn },
      })

      // then
      expect(launched).toBe(false)
      expect(ask).toHaveBeenCalledTimes(1)
      expect(ask.mock.calls[0][0]).toBe("/repos/target")
      expect(calls).toHaveLength(0)
    })
  })

  describe("#given policy ask and the permission callback allows", () => {
    it("#then spawns exactly once with cwd=repoRoot and returns true", async () => {
      // given
      const { spawn, calls } = makeSpawn()
      const ask = jest.fn(async () => true)

      // when
      const launched = await launchTargetSession("/repos/target", {
        policy: "ask",
        projectId: "target-id",
        launchPermissionAsk: ask,
        deps: { spawn },
      })

      // then
      expect(launched).toBe(true)
      expect(ask).toHaveBeenCalledTimes(1)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.cwd).toBe("/repos/target")
      expect(calls[0]?.logPath).toContain("target-id")
    })
  })

  describe("#given policy ask but no permission callback is provided", () => {
    it("#then fails closed and returns false without spawning", async () => {
      // given
      const { spawn, calls } = makeSpawn()

      // when
      const launched = await launchTargetSession("/repos/target", {
        policy: "ask",
        projectId: "target-id",
        deps: { spawn },
      })

      // then
      expect(launched).toBe(false)
      expect(calls).toHaveLength(0)
    })
  })

  describe("#given policy auto", () => {
    it("#then spawns without asking and returns true", async () => {
      // given
      const { spawn, calls } = makeSpawn()
      const ask = jest.fn(async () => true)

      // when
      const launched = await launchTargetSession("/repos/target", {
        policy: "auto",
        projectId: "target-id",
        launchPermissionAsk: ask,
        deps: { spawn },
      })

      // then
      expect(launched).toBe(true)
      expect(ask).not.toHaveBeenCalled()
      expect(calls).toHaveLength(1)
    })
  })

  describe("#given the injected spawn throws", () => {
    it("#then returns false rather than propagating the error", async () => {
      // given
      const spawn: LaunchSpawn = () => {
        throw new Error("spawn failed")
      }

      // when
      const launched = await launchTargetSession("/repos/target", {
        policy: "auto",
        projectId: "target-id",
        deps: { spawn },
      })

      // then
      expect(launched).toBe(false)
    })
  })

  describe("#given the injected spawn hangs past the timeout", () => {
    it("#then returns false via the confirm timeout instead of blocking", async () => {
      // given
      const spawn: LaunchSpawn = () =>
        ({
          pid: 4242,
          confirm: new Promise<void>(() => {}),
        }) as LaunchSpawnResult

      // when
      const launched = await launchTargetSession("/repos/target", {
        policy: "auto",
        projectId: "target-id",
        deps: { spawn, spawnTimeoutMs: 20 },
      })

      // then
      expect(launched).toBe(false)
    })
  })
})
