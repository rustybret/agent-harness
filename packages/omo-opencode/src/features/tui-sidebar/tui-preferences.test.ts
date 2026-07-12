import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  queueTuiPreferenceUpdate,
  readTuiPreferencesFileSync,
  resolveOmoPrefs,
  resolveOmoCollapsed,
  watchTuiPreferences,
} from "./tui-preferences"

const TUI_PREFS_FILE_ENV = "OPENCODE_TUI_PREFERENCES_FILE"

const originalEnv = process.env[TUI_PREFS_FILE_ENV]
const tempDirs: string[] = []

function makeTempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-tui-prefs-"))
  tempDirs.push(dir)
  return join(dir, "tui-preferences.jsonc")
}

function getPrefsFile(): string {
  const file = process.env[TUI_PREFS_FILE_ENV]
  if (file === undefined) throw new Error("test prefs file was not configured")
  return file
}

function waitForWatcherSettle(settled: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("waited 5s for tui preference watcher settle, never fired")), 5000)
  })
  return Promise.race([settled, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
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

describe("resolveOmoPrefs", () => {
  it("#given a legacy-only mailbox collapsed value #when resolving prefs #then collapsed resolves from the legacy key", () => {
    // given the current persisted legacy mailbox shape
    const root = { "oh-my-openagent": { mailbox: { collapsed: true } } }

    // when resolving the full preference schema
    const prefs = resolveOmoPrefs(root)

    // then the new collapsed field is hydrated from mailbox.collapsed
    expect(prefs.collapsed).toBe(true)
  })

  it("#given both new and legacy collapsed values #when resolving prefs #then the new schema key wins", () => {
    // given a root with both schemas present and disagreeing
    const root = { "oh-my-openagent": { collapsed: false, mailbox: { collapsed: true } } }

    // when resolving the full preference schema
    const prefs = resolveOmoPrefs(root)

    // then entry.collapsed takes precedence over mailbox.collapsed
    expect(prefs.collapsed).toBe(false)
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

  it("#given a collapsed=true write followed by collapsed=false #when re-read from disk #then the collapse state round-trips both ways", async () => {
    // given a persisted collapsed=true flag
    await queueTuiPreferenceUpdate(["mailbox", "collapsed"], true)
    expect(resolveOmoCollapsed(readTuiPreferencesFileSync())).toBe(true)

    // when overwriting with collapsed=false
    await queueTuiPreferenceUpdate(["mailbox", "collapsed"], false)

    // then a fresh read reports collapsed false
    expect(resolveOmoCollapsed(readTuiPreferencesFileSync())).toBe(false)
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

  it("#given a watcher is active #when queueing an omo update #then its own write does not emit onChange", async () => {
    // given an active watcher on an existing preferences file
    const file = getPrefsFile()
    writeFileSync(file, "{}\n", "utf8")
    let changes = 0
    let resolveSettled: (() => void) | undefined
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve
    })
    const stop = watchTuiPreferences(
      () => {
        changes += 1
      },
      (text) => {
        if (text?.includes('"mailbox"')) resolveSettled?.()
      },
    )

    try {
      // when the module writes through its queued update path
      await queueTuiPreferenceUpdate(["mailbox", "collapsed"], true)
      await waitForWatcherSettle(settled)

      // then the echo guard treats that write as internal, not external
      expect(changes).toBe(0)
    } finally {
      stop()
    }
  })

  it("#given a malformed-root file #when queueing an update #then the write is skipped and the file is unchanged", async () => {
    // given a non-empty malformed file
    const file = getPrefsFile()
    const broken = '"broken json {{'
    writeFileSync(file, broken, "utf8")

    // when attempting to persist a preference
    await queueTuiPreferenceUpdate(["mailbox", "collapsed"], true)

    // then resolving returns defaults and the malformed file is left byte-for-byte unchanged
    expect(resolveOmoPrefs(readTuiPreferencesFileSync())).toEqual({
      forceToTop: false,
      order: 150,
      startCollapsed: false,
      rememberCollapsed: true,
      collapsed: null,
      header: { label: "Mailbox", showVersion: true },
      sections: { inbound: true, outbound: true, projects: true },
    })
    expect(readFileSync(file, "utf8")).toBe(broken)
  })
})
