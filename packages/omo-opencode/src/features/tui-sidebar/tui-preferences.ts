import { readFileSync } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { applyEdits, modify, parse } from "jsonc-parser"

// Shared preferences file for OpenCode TUI plugins. One top-level key per plugin
// (short, non-integer-like name). The file is OPTIONAL: every reader falls back
// to defaults when it is missing or malformed.
//
// omo persists under the top-level key "oh-my-openagent" (the cross-plugin sort
// convention). The MC reference uses comment-json for the write path; omo
// substitutes jsonc-parser's surgical modify+applyEdits so a sibling plugin's
// keys AND comments survive an update.

const TUI_PREFS_FILE_ENV = "OPENCODE_TUI_PREFERENCES_FILE"
const FILE_NAME = "tui-preferences.jsonc"
const OMO_KEY = "oh-my-openagent"

function getTuiPreferencesFile(): string {
  const override = process.env[TUI_PREFS_FILE_ENV]
  if (override) return override
  const configDir =
    process.env.OPENCODE_CONFIG_DIR ||
    join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
  return join(configDir, FILE_NAME)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Synchronous tolerant read. A missing file, parse error, or non-object root all
// resolve to {} so the sidebar never crashes on hand-edited content. Never throws.
export function readTuiPreferencesFileSync(): Record<string, unknown> {
  try {
    const raw = readFileSync(getTuiPreferencesFile(), "utf8")
    if (raw.trim() === "") return {}
    const root: unknown = parse(raw)
    return isRecord(root) ? root : {}
  } catch {
    return {}
  }
}

// Reads root["oh-my-openagent"].mailbox.collapsed, defaulting to false when any
// segment is missing or not the expected shape.
export function resolveOmoCollapsed(root: Record<string, unknown>): boolean {
  const entry = root[OMO_KEY]
  if (!isRecord(entry)) return false
  const mailbox = entry.mailbox
  if (!isRecord(mailbox)) return false
  return mailbox.collapsed === true
}

async function writePreference(path: string[], value: unknown): Promise<void> {
  const file = getTuiPreferencesFile()
  await mkdir(dirname(file), { recursive: true })

  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch {
    text = ""
  }
  // Missing or empty file: seed with an empty object so modify has a root.
  if (text.trim() === "") text = "{}\n"

  let root: unknown
  try {
    root = parse(text)
  } catch {
    // The shared file is currently malformed. Skip the write rather than clobber
    // sibling plugins' keys; the user fixes the file and persistence resumes.
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
}

let writeChain: Promise<void> = Promise.resolve()

// Writes are serialized on a promise chain: each update re-reads the file,
// applies a comment-preserving edit to one property under "oh-my-openagent", and
// replaces the file atomically (temp + rename). Best-effort by design; callers
// pass the path RELATIVE to the omo key (e.g. ["mailbox","collapsed"]) and this
// prepends "oh-my-openagent" internally. Never throws.
export function queueTuiPreferenceUpdate(path: string[], value: unknown): Promise<void> {
  writeChain = writeChain.then(() => writePreference(path, value)).catch(() => {})
  return writeChain
}
