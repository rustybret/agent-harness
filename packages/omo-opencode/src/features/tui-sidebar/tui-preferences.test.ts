import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  queueTuiPreferenceUpdate,
  readTuiPreferencesFileSync,
  resolveOmoCollapsed,
} from "./tui-preferences"

const TUI_PREFS_FILE_ENV = "OPENCODE_TUI_PREFERENCES_FILE"

const originalEnv = process.env[TUI_PREFS_FILE_ENV]
const tempDirs: string[] = []

function makeTempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-tui-prefs-"))
  tempDirs.push(dir)
  return join(dir, "tui-preferences.jsonc")
}

beforeEach(() => {
  const file = makeTempFile()
  process.env[TUI_PREFS_FILE_ENV] = file
})

afterEach(() => {
  if (originalEnv === undefined) delete process.env[TUI_PREFS_FILE_ENV]
  else process.env[TUI_PREFS_FILE_ENV] = originalEnv
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("readTuiPreferencesFileSync + resolveOmoCollapsed", () => {
  it("#given a missing file #when resolving collapsed #then returns false without throwing", () => {
    // given a temp path with no file written
    // when reading the prefs and resolving collapsed
    const root = readTuiPreferencesFileSync()
    const collapsed = resolveOmoCollapsed(root)

    // then the read is an empty record and collapsed defaults to false
    expect(root).toEqual({})
    expect(collapsed).toBe(false)
  })

  it("#given a malformed-root file #when reading #then returns {} without throwing", () => {
    // given a non-empty malformed file
    const file = process.env[TUI_PREFS_FILE_ENV] as string
    writeFileSync(file, '"broken json {{', "utf8")

    // when reading the prefs
    const root = readTuiPreferencesFileSync()

    // then it tolerantly resolves to an empty record
    expect(root).toEqual({})
    expect(resolveOmoCollapsed(root)).toBe(false)
  })
})

describe("queueTuiPreferenceUpdate", () => {
  it("#given a missing file #when queueing collapsed=true #then re-read returns true under oh-my-openagent.mailbox.collapsed", async () => {
    // given a missing prefs file
    // when persisting the collapsed flag
    await queueTuiPreferenceUpdate(["mailbox", "collapsed"], true)

    // then a fresh read reports collapsed true under the oh-my-openagent key
    const root = readTuiPreferencesFileSync()
    expect(resolveOmoCollapsed(root)).toBe(true)
    const omo = root["oh-my-openagent"] as Record<string, unknown>
    const mailbox = omo.mailbox as Record<string, unknown>
    expect(mailbox.collapsed).toBe(true)
  })

  it("#given a pre-existing magic-context key with a comment #when queueing an update #then the sibling comment survives byte-for-byte", async () => {
    // given a prefs file with a sibling plugin key and an inline comment
    const file = process.env[TUI_PREFS_FILE_ENV] as string
    const initial = ['{', '  // keep me intact', '  "magic-context": {', '    "order": 200', '  }', '}', ""].join("\n")
    writeFileSync(file, initial, "utf8")

    // when persisting an omo preference
    await queueTuiPreferenceUpdate(["mailbox", "collapsed"], true)

    // then the sibling comment and key are still present, and the omo write landed
    const text = readFileSync(file, "utf8")
    expect(text).toContain("// keep me intact")
    expect(text).toContain('"magic-context"')
    const root = readTuiPreferencesFileSync()
    expect(resolveOmoCollapsed(root)).toBe(true)
  })

  it("#given a malformed-root file #when queueing an update #then the write is skipped and the file is unchanged", async () => {
    // given a non-empty malformed file
    const file = process.env[TUI_PREFS_FILE_ENV] as string
    const broken = '"broken json {{'
    writeFileSync(file, broken, "utf8")

    // when attempting to persist a preference
    await queueTuiPreferenceUpdate(["mailbox", "collapsed"], true)

    // then the malformed file is left byte-for-byte unchanged
    expect(readFileSync(file, "utf8")).toBe(broken)
  })
})
