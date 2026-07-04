import { describe, expect, it, jest } from "bun:test"

import type { PresenceRecord } from "./presence-record"
import {
  createPresenceHeartbeatHook,
  type PresenceHeartbeatDeps,
} from "./presence-heartbeat-hook"

function makeDeps(overrides: Partial<PresenceHeartbeatDeps> = {}): {
  deps: PresenceHeartbeatDeps
  writeRecord: ReturnType<typeof jest.fn>
} {
  const writeRecord = jest.fn(async (_record: PresenceRecord, _homeDir?: string) => undefined)
  const deps: PresenceHeartbeatDeps = {
    projectId: "alpha-id",
    repoRoot: "/repos/alpha",
    serverUrl: "http://127.0.0.1:4096",
    homeDir: "/home/tester",
    pid: 4242,
    now: () => 1_000_000,
    intervalMs: 10_000,
    writeRecord: writeRecord as never,
    ...overrides,
  }
  return { deps, writeRecord }
}

describe("createPresenceHeartbeatHook", () => {
  describe("#given a session becomes active", () => {
    it("#then it writes a well-formed presence record immediately", async () => {
      // given
      const { deps, writeRecord } = makeDeps()
      const hook = createPresenceHeartbeatHook(deps)

      // when
      hook.onSessionActive("ses_1")
      await Promise.resolve()
      await Promise.resolve()

      // then
      expect(writeRecord).toHaveBeenCalledTimes(1)
      const [record, homeDir] = writeRecord.mock.calls[0]
      expect(record).toEqual({
        projectId: "alpha-id",
        repoRoot: "/repos/alpha",
        mode: "external",
        serverUrl: "http://127.0.0.1:4096",
        sessionId: "ses_1",
        pid: 4242,
        heartbeatTs: 1_000_000,
      })
      expect(homeDir).toBe("/home/tester")

      // cleanup
      hook.dispose()
    })
  })

  describe("#given the interval fires after activation", () => {
    it("#then it writes a fresh record on each tick and stops after dispose", async () => {
      // given
      const { deps, writeRecord } = makeDeps({ intervalMs: 5 })
      const hook = createPresenceHeartbeatHook(deps)

      // when
      hook.onSessionActive("ses_1")
      await new Promise((resolve) => setTimeout(resolve, 18))
      const countBeforeDispose = writeRecord.mock.calls.length
      hook.dispose()
      await new Promise((resolve) => setTimeout(resolve, 18))
      const countAfterDispose = writeRecord.mock.calls.length

      // then
      expect(countBeforeDispose).toBeGreaterThan(1)
      expect(countAfterDispose).toBe(countBeforeDispose)
    })
  })

  describe("#given onSessionActive is called twice with different sessions", () => {
    it("#then only one interval runs and the latest sessionId is used", async () => {
      // given
      const { deps, writeRecord } = makeDeps()
      const hook = createPresenceHeartbeatHook(deps)

      // when
      hook.onSessionActive("ses_1")
      hook.onSessionActive("ses_2")
      await Promise.resolve()
      await Promise.resolve()

      // then
      const lastCall = writeRecord.mock.calls.at(-1)
      expect(lastCall?.[0].sessionId).toBe("ses_2")

      // cleanup
      hook.dispose()
    })
  })

  describe("#given a write rejects", () => {
    it("#then the error is swallowed and the interval keeps running", async () => {
      // given
      const failing = jest.fn(async () => {
        throw new Error("disk full")
      })
      const { deps } = makeDeps({ intervalMs: 5, writeRecord: failing as never })
      const hook = createPresenceHeartbeatHook(deps)

      // when
      hook.onSessionActive("ses_1")
      await new Promise((resolve) => setTimeout(resolve, 18))

      // then
      expect(failing.mock.calls.length).toBeGreaterThan(1)

      // cleanup
      hook.dispose()
    })
  })
})
