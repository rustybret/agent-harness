import { describe, expect, it, spyOn, beforeEach, afterEach } from "bun:test"
import { createModeDetector } from "./mode-detector"
import * as loggerModule from "../../../shared/logger"
import type { PresenceRecord } from "./presence-record"

describe("ModeDetector Logging Assertions", () => {
  let logSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  describe("#given a fresh start trigger detect call", () => {
    it("#then it emits a detected log line with the resolved mode (external)", async () => {
      // given
      const detector = createModeDetector({
        resolveServerUrl: () => "http://127.0.0.1:4096",
        repoRoot: "/repos/alpha",
        probe: async (_record: PresenceRecord) => true,
        now: () => 1_000_000,
        settleMs: 0,
        probeTimeoutMs: 50,
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
        reason: "session-live",
      })
    })

    it("#then it emits a detected log line with the resolved mode (internal)", async () => {
      // given
      const detector = createModeDetector({
        resolveServerUrl: () => null,
        repoRoot: "/repos/alpha",
        probe: async (_record: PresenceRecord) => true,
        now: () => 1_000_000,
        settleMs: 0,
        probeTimeoutMs: 50,
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
        reason: "no-server-url",
      })
    })
  })

  describe("#given a resume trigger detect call where the resolved mode is UNCHANGED", () => {
    it("#then it emits ONLY the detected log and no transition log", async () => {
      // given
      const detector = createModeDetector({
        resolveServerUrl: () => "http://127.0.0.1:4096",
        repoRoot: "/repos/alpha",
        probe: async (_record: PresenceRecord) => true,
        now: () => 1_000_000,
        settleMs: 0,
        probeTimeoutMs: 50,
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
        reason: "session-live",
      })
    })
  })

  describe("#given a resume trigger detect call where the resolved mode DIFFERS", () => {
    it("#then it emits BOTH a transition log and a detected log", async () => {
      // given
      let serverUrl: string | null = "http://127.0.0.1:4096"
      const detector = createModeDetector({
        resolveServerUrl: () => serverUrl,
        repoRoot: "/repos/alpha",
        probe: async (_record: PresenceRecord) => true,
        now: () => 1_000_000,
        settleMs: 0,
        probeTimeoutMs: 50,
      })
      await detector.detect("ses_1", "start")
      logSpy.mockClear()

      // when
      serverUrl = null
      const mode = await detector.detect("ses_1", "resume")

      // then
      expect(mode).toBe("internal")
      expect(logSpy).toHaveBeenCalledTimes(2)
      expect(logSpy).toHaveBeenNthCalledWith(1, "[mailbox-mode] detected", {
        mode: "internal",
        sessionId: "ses_1",
        trigger: "resume",
        reason: "no-server-url",
      })
      expect(logSpy).toHaveBeenNthCalledWith(2, "[mailbox-mode] transition", {
        from: "external",
        to: "internal",
        sessionId: "ses_1",
      })
    })
  })
})
