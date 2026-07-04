import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  PRESENCE_INTERVAL_MS,
  PRESENCE_TTL_MS,
  type PresenceRecord,
  presenceRecordPath,
  writePresenceRecord,
} from "./presence-record"

function makeRecord(overrides: Partial<PresenceRecord> = {}): PresenceRecord {
  return {
    projectId: "alpha-id",
    repoRoot: "/repos/alpha",
    mode: "external",
    serverUrl: "http://127.0.0.1:4096",
    sessionId: "ses_abc",
    pid: 4242,
    heartbeatTs: 1_000_000,
    ...overrides,
  }
}

describe("presence-record constants", () => {
  describe("#given the module-level TTL/interval constants", () => {
    it("#then TTL is 30s and interval is 10s", () => {
      // then
      expect(PRESENCE_TTL_MS).toBe(30_000)
      expect(PRESENCE_INTERVAL_MS).toBe(10_000)
    })
  })
})

describe("presenceRecordPath", () => {
  describe("#given a projectId and a homeDir", () => {
    it("#then it resolves to <home>/.omo/presence/<projectId>.json", () => {
      // when
      const resolved = presenceRecordPath("alpha-id", "/home/tester")

      // then
      expect(resolved).toBe(path.join("/home/tester", ".omo", "presence", "alpha-id.json"))
    })
  })
})

describe("writePresenceRecord", () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(path.join(os.tmpdir(), "presence-record-"))
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
  })

  describe("#given a well-formed presence record", () => {
    it("#then it writes a JSON file whose parsed content matches the record", async () => {
      // given
      const record = makeRecord()

      // when
      await writePresenceRecord(record, homeDir)

      // then
      const filePath = presenceRecordPath(record.projectId, homeDir)
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as PresenceRecord
      expect(parsed).toEqual(record)
    })

    it("#then the file mode is 0o600 (owner read/write only)", async () => {
      // given
      const record = makeRecord()

      // when
      await writePresenceRecord(record, homeDir)

      // then
      const filePath = presenceRecordPath(record.projectId, homeDir)
      const mode = statSync(filePath).mode & 0o777
      expect(mode).toBe(0o600)
    })

    it("#then no leftover .tmp file remains after the atomic rename", async () => {
      // given
      const record = makeRecord()

      // when
      await writePresenceRecord(record, homeDir)

      // then
      const dir = path.join(homeDir, ".omo", "presence")
      const { readdirSync } = await import("node:fs")
      const entries = readdirSync(dir)
      expect(entries).toEqual([`${record.projectId}.json`])
    })

    it("#then a second write overwrites the record in place", async () => {
      // given
      const first = makeRecord({ heartbeatTs: 1 })
      const second = makeRecord({ heartbeatTs: 2 })

      // when
      await writePresenceRecord(first, homeDir)
      await writePresenceRecord(second, homeDir)

      // then
      const filePath = presenceRecordPath(second.projectId, homeDir)
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as PresenceRecord
      expect(parsed.heartbeatTs).toBe(2)
    })
  })

  describe("#given an external-mode record with a real serverUrl", () => {
    it("#then it round-trips through write and read unchanged", async () => {
      // given
      const record = makeRecord({ mode: "external", serverUrl: "http://127.0.0.1:4096" })

      // when
      await writePresenceRecord(record, homeDir)

      // then
      const filePath = presenceRecordPath(record.projectId, homeDir)
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as PresenceRecord
      expect(parsed).toEqual(record)
      expect(parsed.mode).toBe("external")
      expect(parsed.serverUrl).toBe("http://127.0.0.1:4096")
    })
  })

  describe("#given an internal-mode record with a null serverUrl", () => {
    it("#then it round-trips through write and read with serverUrl null", async () => {
      // given
      const record = makeRecord({ mode: "internal", serverUrl: null })

      // when
      await writePresenceRecord(record, homeDir)

      // then
      const filePath = presenceRecordPath(record.projectId, homeDir)
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as PresenceRecord
      expect(parsed).toEqual(record)
      expect(parsed.mode).toBe("internal")
      expect(parsed.serverUrl).toBeNull()
    })
  })
})
