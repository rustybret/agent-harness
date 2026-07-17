/// <reference types="bun-types" />

import { describe, expect, it, afterEach } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  isPidAlive,
  newInstanceId,
  newToken,
  parsePortFileRecord,
  portFileExists,
  removePortFile,
  sweepDeadPortFiles,
  writePortFile,
} from "./port-file"

const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ext-inject-portfile-"))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("external-inject port-file", () => {
  describe("#given writePortFile", () => {
    it("#then writes the record with 0600 mode", () => {
      // given
      const dir = makeTmpDir()
      const record = { port: 51234, token: newToken(), pid: process.pid, started_at: Date.now() }
      // when
      const filePath = writePortFile(dir, newInstanceId(), record)
      // then
      expect(portFileExists(filePath)).toBe(true)
      const mode = statSync(filePath).mode & 0o777
      expect(mode).toBe(0o600)
    })

    it("#then round-trips through parsePortFileRecord", () => {
      const dir = makeTmpDir()
      const record = { port: 51234, token: "abc123", pid: process.pid, started_at: 42 }
      const filePath = writePortFile(dir, newInstanceId(), record)
      const parsed = parsePortFileRecord(readFileSync(filePath, "utf-8"))
      expect(parsed).toEqual(record)
    })
  })

  describe("#given parsePortFileRecord", () => {
    it("#then rejects a record with no token", () => {
      expect(parsePortFileRecord(JSON.stringify({ port: 5, pid: 1, started_at: 0 }))).toBeNull()
    })

    it("#then rejects an out-of-range port", () => {
      expect(parsePortFileRecord(JSON.stringify({ port: 70000, token: "x", pid: 1, started_at: 0 }))).toBeNull()
    })

    it("#then rejects non-JSON", () => {
      expect(parsePortFileRecord("12345")).toBeNull()
      expect(parsePortFileRecord("")).toBeNull()
    })
  })

  describe("#given isPidAlive", () => {
    it("#then reports the current process alive", () => {
      expect(isPidAlive(process.pid)).toBe(true)
    })

    it("#then reports a bogus pid dead", () => {
      expect(isPidAlive(2_147_483_646)).toBe(false)
      expect(isPidAlive(undefined)).toBe(false)
      expect(isPidAlive(0)).toBe(false)
    })
  })

  describe("#given sweepDeadPortFiles", () => {
    it("#then removes a dead-pid sibling but keeps our own file", () => {
      // given
      const dir = makeTmpDir()
      const ours = writePortFile(dir, "self", { port: 1, token: "t", pid: process.pid, started_at: 1 })
      const deadPath = writePortFile(dir, "dead", { port: 2, token: "t", pid: 2_147_483_646, started_at: 1 })
      // when
      sweepDeadPortFiles(dir, ours)
      // then
      expect(portFileExists(ours)).toBe(true)
      expect(portFileExists(deadPath)).toBe(false)
    })

    it("#then removes an unparsable sibling", () => {
      const dir = makeTmpDir()
      const ours = writePortFile(dir, "self", { port: 1, token: "t", pid: process.pid, started_at: 1 })
      const junkPath = path.join(dir, "junk.json")
      writeFileSync(junkPath, "not json")
      sweepDeadPortFiles(dir, ours)
      expect(portFileExists(junkPath)).toBe(false)
    })
  })

  describe("#given removePortFile", () => {
    it("#then is a no-op on a missing file", () => {
      const dir = makeTmpDir()
      expect(() => removePortFile(path.join(dir, "nope.json"))).not.toThrow()
    })
  })
})
