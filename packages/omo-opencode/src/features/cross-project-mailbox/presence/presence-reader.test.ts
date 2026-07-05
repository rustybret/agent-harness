import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { writePresenceRecord, type PresenceRecord } from "./presence-record"
import {
  defaultProbeSession,
  isPresenceRecord,
  readPresenceStatus,
  type ReadPresenceStatusDeps,
} from "./presence-reader"

function makeRecord(overrides: Partial<PresenceRecord> = {}): PresenceRecord {
  return {
    projectId: "alpha-id",
    repoRoot: "/repos/alpha",
    mode: "external",
    serverUrl: "http://127.0.0.1:4096",
    sessionId: "ses_abc",
    pid: 4242,
    heartbeatTs: Date.now(),
    ...overrides,
  }
}

describe("isPresenceRecord", () => {
  describe("#given an internal record with a null serverUrl", () => {
    it("#then it accepts the record", () => {
      // given
      const record = makeRecord({ mode: "internal", serverUrl: null })

      // then
      expect(isPresenceRecord(record)).toBe(true)
    })
  })

  describe("#given an external record with a string serverUrl", () => {
    it("#then it accepts the record", () => {
      // given
      const record = makeRecord({ mode: "external", serverUrl: "http://127.0.0.1:4096" })

      // then
      expect(isPresenceRecord(record)).toBe(true)
    })
  })

  describe("#given a record missing the mode field", () => {
    it("#then it rejects the record", () => {
      // given
      const { mode: _mode, ...rest } = makeRecord()

      // then
      expect(isPresenceRecord(rest)).toBe(false)
    })
  })

  describe("#given a record whose mode is not a known literal", () => {
    it("#then it rejects the record", () => {
      // given
      const record = { ...makeRecord(), mode: "hybrid" }

      // then
      expect(isPresenceRecord(record)).toBe(false)
    })
  })

  describe("#given a record whose serverUrl is a number", () => {
    it("#then it rejects the record", () => {
      // given
      const record = { ...makeRecord(), serverUrl: 123 }

      // then
      expect(isPresenceRecord(record)).toBe(false)
    })
  })
})

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

  describe("#given a fresh internal-mode record", () => {
    it("#then it returns internal without invoking the probe", async () => {
      // given
      const record = makeRecord({ mode: "internal", serverUrl: null, heartbeatTs: Date.now() })
      await writePresenceRecord(record, homeDir)
      const probeSession = jest.fn(async () => true)
      const deps: ReadPresenceStatusDeps = { probeSession }

      // when
      const status = await readPresenceStatus(record.projectId, homeDir, deps)

      // then
      expect(status).toBe("internal")
      expect(probeSession).not.toHaveBeenCalled()
    })
  })

  describe("#given a fresh internal-mode record and the default probe (real fetch)", () => {
    const realFetch = globalThis.fetch

    afterEach(() => {
      globalThis.fetch = realFetch
    })

    it("#then it returns internal and never calls fetch", async () => {
      // given
      const record = makeRecord({ mode: "internal", serverUrl: null, heartbeatTs: Date.now() })
      await writePresenceRecord(record, homeDir)
      const fetchSpy = jest.fn(async () => new Response("{}", { status: 200 }))
      globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch

      // when
      const status = await readPresenceStatus(record.projectId, homeDir)

      // then
      expect(status).toBe("internal")
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe("#given a stale-heartbeat internal-mode record", () => {
    it("#then it returns offline, not internal", async () => {
      // given
      const record = makeRecord({ mode: "internal", serverUrl: null, heartbeatTs: Date.now() - 60_000 })
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

  describe("#given a fresh external-mode record and an empty status map (probe absent)", () => {
    it("#then it returns stale", async () => {
      // given
      const record = makeRecord({ mode: "external", heartbeatTs: Date.now() })
      await writePresenceRecord(record, homeDir)
      const probeSession = jest.fn(async () => false)
      const deps: ReadPresenceStatusDeps = { probeSession }

      // when
      const status = await readPresenceStatus(record.projectId, homeDir, deps)

      // then
      expect(status).toBe("stale")
      expect(probeSession).toHaveBeenCalledTimes(1)
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

describe("defaultProbeSession", () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function stubFetch(
    handler: (url: string, init?: RequestInit) => Promise<Response>,
  ): jest.Mock<(url: string, init?: RequestInit) => Promise<Response>> {
    const fetchMock = jest.fn(handler)
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    return fetchMock
  }

  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  describe("#given the server responds to the health endpoint", () => {
    it("#then it probes /global/health with directory header and returns live", async () => {
      // given
      const record = makeRecord({ serverUrl: "http://127.0.0.1:4096", repoRoot: "/repos/alpha" })
      const fetchMock = stubFetch(async () => jsonResponse({ healthy: true, version: "1.0.0" }))

      // when
      const live = await defaultProbeSession(record)

      // then
      expect(live).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [calledUrl, init] = fetchMock.mock.calls[0]
      const parsedUrl = new URL(calledUrl)
      expect(parsedUrl.pathname).toBe("/global/health")
      const headers = new Headers(init?.headers)
      expect(headers.get("x-opencode-directory")).toBe(record.repoRoot)
    })
  })

  describe("#given an idle session behind a live server (status map would be empty)", () => {
    it("#then it still returns live because reachability, not activity, is the liveness signal", async () => {
      // given: /global/health responds fine even when every session is idle
      const record = makeRecord({ serverUrl: "http://127.0.0.1:4096" })
      stubFetch(async () => jsonResponse({ healthy: true, version: "1.0.0" }))

      // when
      const live = await defaultProbeSession(record)

      // then
      expect(live).toBe(true)
    })
  })

  describe("#given the fetch rejects with a connect error", () => {
    it("#then it returns false", async () => {
      // given
      const record = makeRecord({ serverUrl: "http://127.0.0.1:4096" })
      stubFetch(async () => {
        throw new Error("ECONNREFUSED")
      })

      // when
      const live = await defaultProbeSession(record)

      // then
      expect(live).toBe(false)
    })
  })

  describe("#given the server responds non-200 (e.g. auth-gated 401)", () => {
    it("#then it still returns live: any HTTP response proves a reachable server", async () => {
      // given
      const record = makeRecord({ serverUrl: "http://127.0.0.1:4096" })
      stubFetch(async () => new Response("unauthorized", { status: 401 }))

      // when
      const live = await defaultProbeSession(record)

      // then
      expect(live).toBe(true)
    })
  })

  describe("#given an internal record with a null serverUrl", () => {
    it("#then it returns false and never attempts a fetch", async () => {
      // given
      const record = makeRecord({ mode: "internal", serverUrl: null })
      const fetchMock = stubFetch(async () => jsonResponse({ [record.sessionId]: { type: "idle" } }))

      // when
      const live = await defaultProbeSession(record)

      // then
      expect(live).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
