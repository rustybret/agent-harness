import { describe, expect, it, jest } from "bun:test"

import { createModeDetector, type ModeDetectorDeps } from "./mode-detector"
import type { PresenceRecord } from "./presence-record"

type LogEntry = { message: string; data: unknown }

function makeDeps(
  overrides: Partial<ModeDetectorDeps> = {},
): ModeDetectorDeps & { logs: LogEntry[] } {
  const logs: LogEntry[] = []
  return {
    resolveServerUrl: () => "http://127.0.0.1:4096",
    repoRoot: "/repos/alpha",
    probe: async (_record: PresenceRecord) => true,
    now: () => 1_000_000,
    settleMs: 0,
    probeTimeoutMs: 50,
    log: (message: string, data?: unknown) => logs.push({ message, data }),
    logs,
    ...overrides,
  }
}

describe("createModeDetector", () => {
  describe("#given no resolvable serverUrl", () => {
    it("#then detect returns internal without probing", async () => {
      // given
      const probe = jest.fn(async (_record: PresenceRecord) => true)
      const detector = createModeDetector(makeDeps({ resolveServerUrl: () => null, probe }))

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("internal")
      expect(probe).not.toHaveBeenCalled()
    })
  })

  describe("#given a self-probe that finds our session", () => {
    it("#then detect returns external and logs detected external", async () => {
      // given
      const deps = makeDeps()
      const probe = jest.spyOn(deps, "probe")
      const detector = createModeDetector(deps)

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("external")
      expect(probe).toHaveBeenCalledTimes(1)
      const detected = deps.logs.find((entry) => entry.message === "[mailbox-mode] detected")
      expect(detected?.data).toMatchObject({ mode: "external", sessionId: "ses_1", trigger: "start" })
    })
  })

  describe("#given detect already ran for a session", () => {
    it("#then a second detect with the same sessionId and no resume does not re-probe", async () => {
      // given
      const probe = jest.fn(async (_record: PresenceRecord) => true)
      const detector = createModeDetector(makeDeps({ probe }))
      await detector.detect("ses_1", "start")

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("external")
      expect(probe).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given currentMode read before any detect", () => {
    it("#then it returns unknown with zero io", () => {
      // given
      const probe = jest.fn(async (_record: PresenceRecord) => true)
      const detector = createModeDetector(makeDeps({ probe }))

      // when
      const mode = detector.currentMode()

      // then
      expect(mode).toBe("unknown")
      expect(probe).not.toHaveBeenCalled()
    })
  })

  describe("#given detect resolved external", () => {
    it("#then currentMode returns the memoized value synchronously", async () => {
      // given
      const detector = createModeDetector(makeDeps({ probe: async () => true }))

      // when
      await detector.detect("ses_1", "start")

      // then
      expect(detector.currentMode()).toBe("external")
    })
  })

  describe("#given the probe throws or times out", () => {
    it("#then detect defaults to internal with reason timeout", async () => {
      // given
      const deps = makeDeps({
        probe: async (_record: PresenceRecord) => {
          throw new Error("connect refused")
        },
      })
      const detector = createModeDetector(deps)

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("internal")
      const detected = deps.logs.find((entry) => entry.message === "[mailbox-mode] detected")
      expect(detected?.data).toMatchObject({ mode: "internal", reason: "timeout" })
    })
  })

  describe("#given the probe hangs past the timeout", () => {
    it("#then detect defaults to internal with reason timeout", async () => {
      // given
      const probe = jest.fn(
        (_record: PresenceRecord) => new Promise<boolean>(() => undefined),
      )
      const detector = createModeDetector(makeDeps({ probe, probeTimeoutMs: 20 }))

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("internal")
    })
  })

  describe("#given the session is reachable-but-absent then present on retry", () => {
    it("#then detect returns external via the retry path", async () => {
      // given
      let call = 0
      const probe = jest.fn(async (_record: PresenceRecord) => {
        call += 1
        return call >= 2
      })
      const detector = createModeDetector(makeDeps({ probe, settleMs: 0 }))

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("external")
      expect(probe.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe("#given the session stays absent across all retries", () => {
    it("#then detect concludes internal after bounded retries", async () => {
      // given
      const probe = jest.fn(async (_record: PresenceRecord) => false)
      const detector = createModeDetector(makeDeps({ probe, settleMs: 0 }))

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("internal")
      // first probe + 2 retries
      expect(probe).toHaveBeenCalledTimes(3)
    })
  })

  describe("#given a memoized external session that resumes as internal", () => {
    it("#then it emits exactly one transition log plus a detected log", async () => {
      // given
      let serverUrl: string | null = "http://127.0.0.1:4096"
      const deps = makeDeps({ resolveServerUrl: () => serverUrl, probe: async () => true, settleMs: 0 })
      const detector = createModeDetector(deps)
      await detector.detect("ses_1", "start")

      // when
      serverUrl = null
      const mode = await detector.detect("ses_1", "resume")

      // then
      expect(mode).toBe("internal")
      const transitions = deps.logs.filter((entry) => entry.message === "[mailbox-mode] transition")
      expect(transitions).toHaveLength(1)
      expect(transitions[0]?.data).toMatchObject({ from: "external", to: "internal", sessionId: "ses_1" })
      const detectedResume = deps.logs.filter(
        (entry) => entry.message === "[mailbox-mode] detected" && (entry.data as { trigger?: string }).trigger === "resume",
      )
      expect(detectedResume).toHaveLength(1)
    })
  })

  describe("#given a resume that does not change the mode", () => {
    it("#then it emits a detected log but no transition log", async () => {
      // given
      const deps = makeDeps({ probe: async () => true, settleMs: 0 })
      const detector = createModeDetector(deps)
      await detector.detect("ses_1", "start")

      // when
      await detector.detect("ses_1", "resume")

      // then
      const transitions = deps.logs.filter((entry) => entry.message === "[mailbox-mode] transition")
      expect(transitions).toHaveLength(0)
      const detected = deps.logs.filter((entry) => entry.message === "[mailbox-mode] detected")
      expect(detected).toHaveLength(2)
    })
  })

  describe("#given a new sessionId", () => {
    it("#then detect re-probes even without a resume trigger", async () => {
      // given
      const probe = jest.fn(async (_record: PresenceRecord) => true)
      const detector = createModeDetector(makeDeps({ probe }))
      await detector.detect("ses_1", "start")

      // when
      await detector.detect("ses_2", "start")

      // then
      expect(probe).toHaveBeenCalledTimes(2)
    })
  })
})
