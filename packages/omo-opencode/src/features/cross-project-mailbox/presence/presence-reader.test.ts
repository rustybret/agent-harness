import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { writePresenceRecord, type PresenceRecord } from "./presence-record"
import { readPresenceStatus, type ReadPresenceStatusDeps } from "./presence-reader"

function makeRecord(overrides: Partial<PresenceRecord> = {}): PresenceRecord {
  return {
    projectId: "alpha-id",
    repoRoot: "/repos/alpha",
    serverUrl: "http://127.0.0.1:4096",
    sessionId: "ses_abc",
    pid: 4242,
    heartbeatTs: Date.now(),
    ...overrides,
  }
}

describe("readPresenceStatus", () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(path.join(os.tmpdir(), "presence-reader-"))
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
  })

  describe("#given no presence file exists", () => {
    it("#then it returns offline", async () => {
      // given
      const probeSession = jest.fn(async () => true)
      const deps: ReadPresenceStatusDeps = { probeSession }

      // when
      const status = await readPresenceStatus("missing-id", homeDir, deps)

      // then
      expect(status).toBe("offline")
      expect(probeSession).not.toHaveBeenCalled()
    })
  })

  describe("#given a fresh file and the session API responds OK", () => {
    it("#then it returns live", async () => {
      // given
      const record = makeRecord({ heartbeatTs: Date.now() })
      await writePresenceRecord(record, homeDir)
      const probeSession = jest.fn(async () => true)
      const deps: ReadPresenceStatusDeps = { probeSession }

      // when
      const status = await readPresenceStatus(record.projectId, homeDir, deps)

      // then
      expect(status).toBe("live")
      expect(probeSession).toHaveBeenCalledTimes(1)
      expect(probeSession.mock.calls[0][0]).toEqual(record)
    })
  })

  describe("#given a fresh file but the session API is unreachable", () => {
    it("#then it returns stale", async () => {
      // given
      const record = makeRecord({ heartbeatTs: Date.now() })
      await writePresenceRecord(record, homeDir)
      const probeSession = jest.fn(async () => false)
      const deps: ReadPresenceStatusDeps = { probeSession }

      // when
      const status = await readPresenceStatus(record.projectId, homeDir, deps)

      // then
      expect(status).toBe("stale")
    })
  })

  describe("#given a file whose heartbeat is older than the TTL", () => {
    it("#then it returns offline without probing the API", async () => {
      // given
      const record = makeRecord({ heartbeatTs: Date.now() - 60_000 })
      await writePresenceRecord(record, homeDir)
      const probeSession = jest.fn(async () => true)
      const deps: ReadPresenceStatusDeps = { probeSession }

      // when
      const status = await readPresenceStatus(record.projectId, homeDir, deps)

      // then
      expect(status).toBe("offline")
      expect(probeSession).not.toHaveBeenCalled()
    })
  })

  describe("#given a malformed presence file", () => {
    it("#then it returns offline", async () => {
      // given
      const { mkdirSync, writeFileSync } = await import("node:fs")
      const dir = path.join(homeDir, ".omo", "presence")
      mkdirSync(dir, { recursive: true })
      writeFileSync(path.join(dir, "broken-id.json"), "{ not json")
      const probeSession = jest.fn(async () => true)
      const deps: ReadPresenceStatusDeps = { probeSession }

      // when
      const status = await readPresenceStatus("broken-id", homeDir, deps)

      // then
      expect(status).toBe("offline")
      expect(probeSession).not.toHaveBeenCalled()
    })
  })

  describe("#given a fresh file and a probe that never resolves within the timeout", () => {
    it("#then it returns stale via the 2s race timeout", async () => {
      // given
      const record = makeRecord({ heartbeatTs: Date.now() })
      await writePresenceRecord(record, homeDir)
      const probeSession = jest.fn(
        () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 10_000)),
      )
      const deps: ReadPresenceStatusDeps = { probeSession, probeTimeoutMs: 10 }

      // when
      const status = await readPresenceStatus(record.projectId, homeDir, deps)

      // then
      expect(status).toBe("stale")
    })
  })
})
