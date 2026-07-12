import { readFileSync, watch } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { applyEdits, modify, parse } from "jsonc-parser"

import { log } from "../../shared/logger"

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
const DEFAULT_SLOT_ORDER = 150
const FORCE_TOP_BASE = -100000
const WATCH_DEBOUNCE_MS = 150

export type OmoTuiPrefs = {
  forceToTop: boolean
  // order and forceToTop are read once during slot registration; changes require restart.
  order: number
  startCollapsed: boolean
  rememberCollapsed: boolean
  collapsed: boolean | null
  header: {
    label: string
    showVersion: boolean
  }
  sections: {
    inbound: boolean
    outbound: boolean
    projects: boolean
  }
}

export const DEFAULT_PREFS: OmoTuiPrefs = {
  forceToTop: false,
  order: DEFAULT_SLOT_ORDER,
  startCollapsed: false,
  rememberCollapsed: true,
  collapsed: null,
  header: { label: "Mailbox", showVersion: true },
  sections: {
    inbound: true,
    outbound: true,
    projects: true,
  },
}

type WatchState = {
  lastSeen: string | null
}

const preferenceWatchStates = new Set<WatchState>()

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

// Adapted from CortexKit AFT's MIT-licensed TUI preference helpers.
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.round(value), min), max)
}

function label(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0) return fallback
  return value.slice(0, maxLength)
}

// Synchronous tolerant read. A missing file, parse error, or non-object root all
// resolve to {} so the sidebar never crashes on hand-edited content. Never throws.
export function readTuiPreferencesFileSync(): Record<string, unknown> {
  try {
    const raw = readFileSync(getTuiPreferencesFile(), "utf8")
    if (raw.trim() === "") return {}
    const root: unknown = parse(raw)
    return isRecord(root) ? root : {}
  } catch (error) {
    // A missing file is expected before any preference is written; log at the
    // file level for diagnostics without treating it as a fault.
    log("tui preferences read failed", { error })
    return {}
  }
}

export function resolveOmoPrefs(root: Record<string, unknown>): OmoTuiPrefs {
  const entry = root[OMO_KEY]
  if (!isRecord(entry)) return structuredClone(DEFAULT_PREFS)

  const d = DEFAULT_PREFS
  const header = isRecord(entry.header) ? entry.header : {}
  const sections = isRecord(entry.sections) ? entry.sections : {}
  const startCollapsed = bool(entry.startCollapsed, d.startCollapsed)
  const mailbox = isRecord(entry.mailbox) ? entry.mailbox : {}
  const legacyCollapsed = mailbox.collapsed

  return {
    forceToTop: bool(entry.forceToTop, d.forceToTop),
    order: int(entry.order, d.order, -10000, 10000),
    startCollapsed,
    rememberCollapsed: bool(entry.rememberCollapsed, d.rememberCollapsed),
    collapsed:
      typeof entry.collapsed === "boolean"
        ? entry.collapsed
        : typeof legacyCollapsed === "boolean"
          ? legacyCollapsed
          : startCollapsed,
    header: {
      label: label(header.label, d.header.label, 20),
      showVersion: bool(header.showVersion, d.header.showVersion),
    },
    sections: {
      inbound: bool(sections.inbound, d.sections.inbound),
      outbound: bool(sections.outbound, d.sections.outbound),
      projects: bool(sections.projects, d.sections.projects),
    },
  }
}

// Adapted from CortexKit AFT's MIT-licensed force-to-top ordering helper.
export function computeEffectiveOrder(
  root: Record<string, unknown>,
  pluginKey: string,
  defaultOrder: number,
): number {
  const entry = root[pluginKey]
  if (!isRecord(entry)) return defaultOrder
  if (entry.forceToTop === true) {
    return FORCE_TOP_BASE + Object.keys(root).indexOf(pluginKey)
  }
  return int(entry.order, defaultOrder, -10000, 10000)
}

export function resolveOmoCollapsed(root: Record<string, unknown>): boolean {
  return resolveOmoPrefs(root).collapsed ?? DEFAULT_PREFS.startCollapsed
}

function rememberWrittenPreferenceText(text: string): void {
  for (const state of preferenceWatchStates) {
    state.lastSeen = text
  }
}

async function writePreference(path: string[], value: unknown): Promise<void> {
  const file = getTuiPreferencesFile()
  await mkdir(dirname(file), { recursive: true })

  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    // Missing file is expected on first write; seed an empty root below.
    log("tui preferences write read-back failed", { error })
    text = ""
  }
  // Missing or empty file: seed with an empty object so modify has a root.
  if (text.trim() === "") text = "{}\n"

  let root: unknown
  try {
    root = parse(text)
  } catch (error) {
    // The shared file is currently malformed. Skip the write rather than clobber
    // sibling plugins' keys; the user fixes the file and persistence resumes.
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

// Writes are serialized on a promise chain: each update re-reads the file,
// applies a comment-preserving edit to one property under "oh-my-openagent", and
// replaces the file atomically (temp + rename). Best-effort by design; callers
// pass the path RELATIVE to the omo key (e.g. ["mailbox","collapsed"]) and this
// prepends "oh-my-openagent" internally. Never throws.
export function queueTuiPreferenceUpdate(path: string[], value: unknown): Promise<void> {
  writeChain = writeChain
    .then(() => writePreference(path, value))
    .catch((error) => {
      log("tui preferences queued update failed", { error })
    })
  return writeChain
}

// Adapted from CortexKit AFT's MIT-licensed fs.watch debounce pattern.
export function watchTuiPreferences(onChange: () => void, onSettled?: (text: string | null) => void): () => void {
  const file = getTuiPreferencesFile()
  const name = basename(file)
  const state: WatchState = { lastSeen: null }
  preferenceWatchStates.add(state)
  let timer: ReturnType<typeof setTimeout> | null = null

  void readFile(file, "utf8")
    .then((text) => {
      if (state.lastSeen === null) state.lastSeen = text
    })
    .catch((error) => {
      log("tui preferences watcher initial read failed", { error })
    })

  try {
    const watcher = watch(dirname(file), (_event, filename) => {
      const isOurs = filename == null || filename === name || (filename.startsWith(`${name}.`) && filename.endsWith(".tmp"))
      if (filename != null && !isOurs) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void readFile(file, "utf8")
          .catch(() => null)
          .then((text) => {
            if (text === null) {
              onSettled?.(text)
              return
            }
            if (text === state.lastSeen) {
              onSettled?.(text)
              return
            }
            state.lastSeen = text
            onChange()
            onSettled?.(text)
          })
      }, WATCH_DEBOUNCE_MS)
    })
    return () => {
      if (timer) clearTimeout(timer)
      preferenceWatchStates.delete(state)
      watcher.close()
    }
  } catch (error) {
    log("tui preferences watcher unavailable", { error })
    preferenceWatchStates.delete(state)
    return () => {}
  }
}
