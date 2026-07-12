import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { applyEdits, modify, parse } from "jsonc-parser"

import { log } from "../../shared/logger"
import { isRecord } from "./tui-preferences-coercers"

export const TUI_PREFS_FILE_ENV = "OPENCODE_TUI_PREFERENCES_FILE"
export const FILE_NAME = "tui-preferences.jsonc"
export const OMO_KEY = "oh-my-openagent"

export type WatchState = {
  lastSeen: string | null
}

export const preferenceWatchStates = new Set<WatchState>()

export function getTuiPreferencesFile(): string {
  const override = process.env[TUI_PREFS_FILE_ENV]
  if (override) return override
  const configDir =
    process.env.OPENCODE_CONFIG_DIR ||
    join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
  return join(configDir, FILE_NAME)
}

export function rememberWrittenPreferenceText(text: string): void {
  for (const state of preferenceWatchStates) {
    state.lastSeen = text
  }
}

export async function writePreference(path: string[], value: unknown): Promise<void> {
  const file = getTuiPreferencesFile()
  await mkdir(dirname(file), { recursive: true })

  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    log("tui preferences write read-back failed", { error })
    text = ""
  }
  if (text.trim() === "") text = "{}\n"

  let root: unknown
  try {
    root = parse(text)
  } catch (error) {
    log("tui preferences write skipped: malformed file", { error })
    return
  }
  if (!isRecord(root)) return

  const edits = modify(text, [OMO_KEY, ...path], value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })
  const next = applyEdits(text, edits)

  const tmp = `${file}.${randomUUID()}.tmp`
  await writeFile(tmp, next, "utf8")
  await rename(tmp, file)
  rememberWrittenPreferenceText(next)
}

let writeChain: Promise<void> = Promise.resolve()

export function queueTuiPreferenceUpdate(path: string[], value: unknown): Promise<void> {
  writeChain = writeChain
    .then(() => writePreference(path, value))
    .catch((error) => {
      log("tui preferences queued update failed", { error })
    })
  return writeChain
}
