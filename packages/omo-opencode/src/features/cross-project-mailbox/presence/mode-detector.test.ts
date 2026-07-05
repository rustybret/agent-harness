import { describe, expect, it, jest } from "bun:test"

import { createModeDetector, type ModeDetectorDeps } from "./mode-detector"
import type { ListenerRecord } from "./instance-registry"

type LogEntry = { message: string; data: unknown }

function makeRecord(overrides: Partial<ListenerRecord> = {}): ListenerRecord {
  return {
    pid: process.pid,
    url: "http://127.0.0.1:14096/",
    hostname: "127.0.0.1",
    port: 14096,
    startedAt: 1_000_000,
    ...overrides,
  }
}

function makeDeps(
  overrides: Partial<ModeDetectorDeps> = {},
): ModeDetectorDeps & { logs: LogEntry[] } {
  const logs: LogEntry[] = []
  return {
    resolveServerUrl: () => "http://localhost:4096",
    repoRoot: "/repos/alpha",
    readOwnRecord: async () => makeRecord(),
    settleMs: 0,
    log: (message: string, data?: unknown) => logs.push({ message, data }),
    logs,
    ...overrides,
  }
}

describe("createModeDetector", () => {
  describe("#given a listener-registry record exists for this pid", () => {
    it("#then detect returns external with the record url and logs it", async () => {
      // given
      const deps = makeDeps()
      const detector = createModeDetector(deps)

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("external")
      expect(detector.currentServerUrl()).toBe("http://127.0.0.1:14096/")
      const detected = deps.logs.find((entry) => entry.message === "[mailbox-mode] detected")
      expect(detected?.data).toMatchObject({
        mode: "external",
        sessionId: "ses_1",
        trigger: "start",
        reason: "listener-record",
      })
    })
  })

  describe("#given no listener record and only the placeholder legacy url", () => {
    it("#then detect returns internal without any HTTP work", async () => {
      // given
      const readOwnRecord = jest.fn(async () => null)
      const deps = makeDeps({ readOwnRecord, resolveServerUrl: () => "http://localhost:4096" })
      const detector = createModeDetector(deps)

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("internal")
      expect(detector.currentServerUrl()).toBeNull()
      const detected = deps.logs.find((entry) => entry.message === "[mailbox-mode] detected")
      expect(detected?.data).toMatchObject({ mode: "internal", reason: "no-listener-record" })
    })
  })

  describe("#given no listener record and a null legacy url", () => {
    it("#then detect returns internal", async () => {
      // given
      const detector = createModeDetector(
        makeDeps({ readOwnRecord: async () => null, resolveServerUrl: () => null }),
      )

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("internal")
    })
  })

  describe("#given no listener record but a REAL non-placeholder legacy url (older host)", () => {
    it("#then detect falls back to external via legacy-server-url", async () => {
      // given
      const deps = makeDeps({
        readOwnRecord: async () => null,
        resolveServerUrl: () => "http://127.0.0.1:7719",
      })
      const detector = createModeDetector(deps)

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("external")
      expect(detector.currentServerUrl()).toBe("http://127.0.0.1:7719")
      const detected = deps.logs.find((entry) => entry.message === "[mailbox-mode] detected")
      expect(detected?.data).toMatchObject({ mode: "external", reason: "legacy-server-url" })
    })
  })

  describe("#given detect already ran for a session", () => {
    it("#then a second detect with the same sessionId and no resume does not re-read", async () => {
      // given
      const readOwnRecord = jest.fn(async () => makeRecord())
      const detector = createModeDetector(makeDeps({ readOwnRecord }))
      await detector.detect("ses_1", "start")

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("external")
      expect(readOwnRecord).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given currentMode read before any detect", () => {
    it("#then it returns unknown with zero io", () => {
      // given
      const readOwnRecord = jest.fn(async () => makeRecord())
      const detector = createModeDetector(makeDeps({ readOwnRecord }))

      // when
      const mode = detector.currentMode()

      // then
      expect(mode).toBe("unknown")
      expect(detector.currentServerUrl()).toBeNull()
      expect(readOwnRecord).not.toHaveBeenCalled()
    })
  })

  describe("#given detect resolved external", () => {
    it("#then currentMode returns the memoized value synchronously", async () => {
      // given
      const detector = createModeDetector(makeDeps())

      // when
      await detector.detect("ses_1", "start")

      // then
      expect(detector.currentMode()).toBe("external")
    })
  })

  describe("#given the record is absent at first then appears on retry (fresh-listener race)", () => {
    it("#then detect returns external via the retry path", async () => {
      // given
      let call = 0
      const readOwnRecord = jest.fn(async () => {
        call += 1
        return call >= 2 ? makeRecord() : null
      })
      const detector = createModeDetector(makeDeps({ readOwnRecord, settleMs: 0 }))

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("external")
      expect(readOwnRecord.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe("#given the record stays absent across all retries", () => {
    it("#then detect concludes internal after bounded retries", async () => {
      // given
      const readOwnRecord = jest.fn(async () => null)
      const detector = createModeDetector(makeDeps({ readOwnRecord, settleMs: 0 }))

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("internal")
      // first read + 2 retries
      expect(readOwnRecord).toHaveBeenCalledTimes(3)
    })
  })

  describe("#given a memoized external session that resumes as internal", () => {
    it("#then it emits exactly one transition log plus a detected log", async () => {
      // given
      let record: ListenerRecord | null = makeRecord()
      const deps = makeDeps({
        readOwnRecord: async () => record,
        resolveServerUrl: () => null,
        settleMs: 0,
      })
      const detector = createModeDetector(deps)
      await detector.detect("ses_1", "start")

      // when
      record = null
      const mode = await detector.detect("ses_1", "resume")

      // then
      expect(mode).toBe("internal")
      expect(detector.currentServerUrl()).toBeNull()
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
      const deps = makeDeps({ settleMs: 0 })
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
    it("#then detect re-reads even without a resume trigger", async () => {
      // given
      const readOwnRecord = jest.fn(async () => makeRecord())
      const detector = createModeDetector(makeDeps({ readOwnRecord }))
      await detector.detect("ses_1", "start")

      // when
      await detector.detect("ses_2", "start")

      // then
      expect(readOwnRecord).toHaveBeenCalledTimes(2)
    })
  })

  describe("#given a readOwnRecord that throws", () => {
    it("#then detect degrades to the legacy fallback instead of crashing", async () => {
      // given
      const detector = createModeDetector(
        makeDeps({
          readOwnRecord: async () => {
            throw new Error("EACCES")
          },
          resolveServerUrl: () => null,
          settleMs: 0,
        }),
      )

      // when
      const mode = await detector.detect("ses_1", "start")

      // then
      expect(mode).toBe("internal")
    })
  })
})
