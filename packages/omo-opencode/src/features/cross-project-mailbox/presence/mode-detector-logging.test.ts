import { describe, expect, it, jest, beforeEach } from "bun:test"
import { createModeDetector } from "./mode-detector"
import type { ListenerRecord } from "./instance-registry"

function makeRecord(): ListenerRecord {
  return {
    pid: process.pid,
    url: "http://127.0.0.1:14096/",
    hostname: "127.0.0.1",
    port: 14096,
    startedAt: 1_000_000,
  }
}

describe("ModeDetector Logging Assertions", () => {
  let logSpy: ReturnType<typeof jest.fn>

  beforeEach(() => {
    logSpy = jest.fn()
  })

  describe("#given a fresh start trigger detect call", () => {
    it("#then it emits a detected log line with the resolved mode (external)", async () => {
      // given
      const detector = createModeDetector({
        resolveServerUrl: () => "http://localhost:4096",
        repoRoot: "/repos/alpha",
        readOwnRecord: async () => makeRecord(),
        settleMs: 0,
        log: logSpy,
      })

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("external")
      expect(logSpy).toHaveBeenCalledTimes(1)
      expect(logSpy).toHaveBeenCalledWith("[mailbox-mode] detected", {
        mode: "external",
        sessionId: "ses_1",
        trigger: "start",
        reason: "listener-record",
      })
    })

    it("#then it emits a detected log line with the resolved mode (internal)", async () => {
      // given
      const detector = createModeDetector({
        resolveServerUrl: () => null,
        repoRoot: "/repos/alpha",
        readOwnRecord: async () => null,
        settleMs: 0,
        log: logSpy,
      })

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("internal")
      expect(logSpy).toHaveBeenCalledTimes(1)
      expect(logSpy).toHaveBeenCalledWith("[mailbox-mode] detected", {
        mode: "internal",
        sessionId: "ses_1",
        trigger: "start",
        reason: "no-listener-record",
      })
    })
  })

  describe("#given a resume trigger detect call where the resolved mode is UNCHANGED", () => {
    it("#then it emits ONLY the detected log and no transition log", async () => {
      // given
      const detector = createModeDetector({
        resolveServerUrl: () => "http://localhost:4096",
        repoRoot: "/repos/alpha",
        readOwnRecord: async () => makeRecord(),
        settleMs: 0,
        log: logSpy,
      })
      await detector.detect("ses_1", "start")
      logSpy.mockClear()

      // when
      const mode = await detector.detect("ses_1", "resume")

      // then
      expect(mode).toBe("external")
      expect(logSpy).toHaveBeenCalledTimes(1)
      expect(logSpy).toHaveBeenCalledWith("[mailbox-mode] detected", {
        mode: "external",
        sessionId: "ses_1",
        trigger: "resume",
        reason: "listener-record",
      })
    })
  })

  describe("#given a resume trigger detect call where the resolved mode DIFFERS", () => {
    it("#then it emits BOTH a transition log and a detected log", async () => {
      // given
      let record: ListenerRecord | null = makeRecord()
      const detector = createModeDetector({
        resolveServerUrl: () => null,
        repoRoot: "/repos/alpha",
        readOwnRecord: async () => record,
        settleMs: 0,
        log: logSpy,
      })
      await detector.detect("ses_1", "start")
      logSpy.mockClear()

      // when
      record = null
      const mode = await detector.detect("ses_1", "resume")

      // then
      expect(mode).toBe("internal")
      expect(logSpy).toHaveBeenCalledTimes(2)
      expect(logSpy).toHaveBeenNthCalledWith(1, "[mailbox-mode] detected", {
        mode: "internal",
        sessionId: "ses_1",
        trigger: "resume",
        reason: "no-listener-record",
      })
      expect(logSpy).toHaveBeenNthCalledWith(2, "[mailbox-mode] transition", {
        from: "external",
        to: "internal",
        sessionId: "ses_1",
      })
    })
  })
})
