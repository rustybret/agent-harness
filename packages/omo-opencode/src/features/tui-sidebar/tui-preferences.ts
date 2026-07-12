import { readFileSync, watch } from "node:fs"
import { readFile } from "node:fs/promises"
import { basename, dirname } from "node:path"
import { parse } from "jsonc-parser"

import { log } from "../../shared/logger"
import { bool, int, isRecord, label } from "./tui-preferences-coercers"
import {
  OMO_KEY,
  getTuiPreferencesFile,
  preferenceWatchStates,
  queueTuiPreferenceUpdate,
  WatchState,
} from "./tui-preferences-writer"

const DEFAULT_SLOT_ORDER = 150
const FORCE_TOP_BASE = -100000
const WATCH_DEBOUNCE_MS = 150

export type OmoTuiPrefs = {
  forceToTop: boolean
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

export function readTuiPreferencesFileSync(): Record<string, unknown> {
  try {
    const raw = readFileSync(getTuiPreferencesFile(), "utf8")
    if (raw.trim() === "") return {}
    const root: unknown = parse(raw)
    return isRecord(root) ? root : {}
  } catch (error) {
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

export { queueTuiPreferenceUpdate }

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
