import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  isListenerRecord,
  listenerRecordPath,
  readOwnListenerRecord,
  type ListenerRecord,
} from "./instance-registry"

function makeRecord(overrides: Partial<ListenerRecord> = {}): ListenerRecord {
  return {
    pid: process.pid,
    url: "http://127.0.0.1:14231/",
    hostname: "127.0.0.1",
    port: 14231,
    startedAt: Date.now(),
    ...overrides,
  }
}

describe("isListenerRecord", () => {
  describe("#given a complete record", () => {
    it("#then it accepts", () => {
      expect(isListenerRecord(makeRecord())).toBe(true)
    })
  })

  describe("#given a record missing url", () => {
    it("#then it rejects", () => {
      const { url: _url, ...rest } = makeRecord()
      expect(isListenerRecord(rest)).toBe(false)
    })
  })

  describe("#given a non-object", () => {
    it("#then it rejects", () => {
      expect(isListenerRecord("nope")).toBe(false)
    })
  })
})

describe("readOwnListenerRecord", () => {
  let stateHome: string
  const originalXdgState = process.env["XDG_STATE_HOME"]

  beforeEach(() => {
    stateHome = mkdtempSync(path.join(os.tmpdir(), "instance-registry-"))
    process.env["XDG_STATE_HOME"] = stateHome
  })

  afterEach(() => {
    if (originalXdgState === undefined) delete process.env["XDG_STATE_HOME"]
    else process.env["XDG_STATE_HOME"] = originalXdgState
    rmSync(stateHome, { recursive: true, force: true })
  })

  function writeRecord(record: ListenerRecord): void {
    const filePath = listenerRecordPath(record.pid)
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(record))
  }

  describe("#given no record file exists", () => {
    it("#then it returns null", async () => {
      expect(await readOwnListenerRecord()).toBeNull()
    })
  })

  describe("#given a fresh record for this pid", () => {
    it("#then it returns the record", async () => {
      // given
      const record = makeRecord()
      writeRecord(record)

      // when
      const result = await readOwnListenerRecord()

      // then
      expect(result).toEqual(record)
    })
  })

  describe("#given a record whose startedAt predates this process (pid reuse)", () => {
    it("#then it returns null instead of trusting the stale record", async () => {
      // given
      writeRecord(makeRecord({ startedAt: Date.now() - process.uptime() * 1_000 - 60_000 }))

      // when
      const result = await readOwnListenerRecord()

      // then
      expect(result).toBeNull()
    })
  })

  describe("#given a malformed record file", () => {
    it("#then it returns null", async () => {
      // given
      const filePath = listenerRecordPath(process.pid)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, "{ not json")

      // when
      const result = await readOwnListenerRecord()

      // then
      expect(result).toBeNull()
    })
  })
})
