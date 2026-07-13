import { unlink as unlinkAsync, readFile as readFileAsync } from "node:fs/promises"
import { dirname, join } from "node:path"

import { getSidecarPath } from "@oh-my-opencode/utils"

import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME, detectPluginConfigFile, getOpenCodeConfigDirs, log } from "../../../shared"
import { queueTuiPreferenceUpdate, readTuiPreferencesFileSync } from "../../tui-sidebar/tui-preferences"
import { createProjectRegistry } from "../registry"
import type { ProjectEntry } from "../registry/types"

const OMO_KEY = "oh-my-openagent"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export interface RegistrationToastDecision {
  show: boolean
  markerPath: string[]
}

// Pure decision function: show the first-registration toast when the self entry
// was registered through an explicit registry workflow (registeredAt present —
// legacy projects never carry this field, so they never toast) AND the prefs
// marker has not already been set true.
// markerPath is always ["mailbox","registrationNoticeShown", selfEntry.projectId]
// once an entry with registeredAt exists, regardless of show, so the caller can
// write to it unconditionally on show:true.
export function decideRegistrationToast(
  selfEntry: ProjectEntry | undefined,
  prefs: Record<string, unknown>,
): RegistrationToastDecision {
  if (!selfEntry || typeof selfEntry.registeredAt !== "number") {
    return { show: false, markerPath: [] }
  }

  const markerPath = ["mailbox", "registrationNoticeShown", selfEntry.projectId]

  let cursor: unknown = prefs[OMO_KEY]
  for (const segment of markerPath) {
    if (!isRecord(cursor)) {
      cursor = undefined
      break
    }
    cursor = cursor[segment]
  }

  return { show: cursor !== true, markerPath }
}

// I/O orchestrator wired into the poll tick. Feature-detects api.ui?.toast and
// never throws — a bad read/write here must not break the poll tick.
// `api` is typed `any` to match the existing tui-command.ts feature-detection
// pattern, since the TUI plugin API type is not exported for narrower typing.
export async function runRegistrationToastCheck(api: any, directory: string): Promise<void> {
  if (!api.ui?.toast) return
  try {
    const entries = await createProjectRegistry().listProjects()
    const selfEntry = entries.find((entry) => entry.repoRoot === directory)
    const prefs = readTuiPreferencesFileSync()
    const decision = decideRegistrationToast(selfEntry, prefs)
    if (!decision.show || !selfEntry) return

    api.ui.toast({
      variant: "success",
      message: `Mailbox: registered ${selfEntry.displayName} in the cross-project registry`,
    })
    await queueTuiPreferenceUpdate(decision.markerPath, true)
  } catch (error) {
    log("[mailbox] registration toast check failed", { error })
  }
}

export interface LegacySendersNoticeDecision {
  show: boolean
  message: string | null
}

// Pure: decides from the flag file's raw text content (null means "file absent")
// whether the legacy-senders activation toast should fire. Malformed JSON or an
// empty/non-array senders list both resolve to show:false; never throws.
export function decideLegacySendersNoticeFromContent(content: string | null): LegacySendersNoticeDecision {
  if (content === null) return { show: false, message: null }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { show: false, message: null }
  }

  const senders = isRecord(parsed) && Array.isArray(parsed.senders)
    ? parsed.senders.filter((entry): entry is string => typeof entry === "string")
    : []
  if (senders.length === 0) return { show: false, message: null }

  return {
    show: true,
    message: `Mailbox: user-level sender grants now apply to all projects: ${senders.join(", ")}`,
  }
}

function resolveLegacySendersNoticePath(): string | null {
  try {
    const userConfigDirs = [...getOpenCodeConfigDirs({ binary: "opencode" })].reverse()
    const primaryConfigDir = userConfigDirs[0]
    if (!primaryConfigDir) return null

    const detected = detectPluginConfigFile(primaryConfigDir, {
      basenames: [CONFIG_BASENAME],
      legacyBasenames: [LEGACY_CONFIG_BASENAME],
    })
    const configPath =
      detected.format !== "none" ? detected.path : join(primaryConfigDir, `${CONFIG_BASENAME}.jsonc`)

    const sidecarPath = getSidecarPath(configPath)
    return join(dirname(sidecarPath), "legacy-senders-notice.json")
  } catch (error) {
    log("[mailbox] failed to resolve legacy-senders-notice path", { error })
    return null
  }
}

export interface ConsumeLegacySendersNoticeDeps {
  readFile: (filePath: string) => Promise<string>
  deleteFile: (filePath: string) => Promise<void>
  hasToastedLegacy: boolean
}

export interface ConsumeLegacySendersNoticeResult {
  show: boolean
  message: string | null
  hasToastedLegacy: boolean
}

// Flag-consume path: single consumer, deletion is the dedup. Tolerates a missing
// file (no-op), corrupted/unparseable JSON (logged, file deleted, never throws),
// and delete failure (logged; hasToastedLegacy flips true so the caller does not
// re-toast this session while the delete is retried silently on the next poll).
// Once hasToastedLegacy is already true, only a best-effort delete retry runs.
export async function consumeLegacySendersNotice(
  flagPath: string,
  deps: ConsumeLegacySendersNoticeDeps,
): Promise<ConsumeLegacySendersNoticeResult> {
  if (deps.hasToastedLegacy) {
    try {
      await deps.deleteFile(flagPath)
    } catch {
      // retried silently on the next poll
    }
    return { show: false, message: null, hasToastedLegacy: true }
  }

  let content: string
  try {
    content = await deps.readFile(flagPath)
  } catch {
    return { show: false, message: null, hasToastedLegacy: false }
  }

  let parseFailed = false
  try {
    JSON.parse(content)
  } catch {
    parseFailed = true
  }

  if (parseFailed) {
    log("[mailbox] legacy-senders-notice flag corrupted, deleting")
    try {
      await deps.deleteFile(flagPath)
    } catch (error) {
      log("[mailbox] legacy-senders-notice flag delete failed", { error })
    }
    return { show: false, message: null, hasToastedLegacy: false }
  }

  const decision = decideLegacySendersNoticeFromContent(content)
  if (!decision.show) {
    try {
      await deps.deleteFile(flagPath)
    } catch (error) {
      log("[mailbox] legacy-senders-notice flag delete failed", { error })
    }
    return { show: false, message: null, hasToastedLegacy: false }
  }

  try {
    await deps.deleteFile(flagPath)
    return { show: true, message: decision.message, hasToastedLegacy: false }
  } catch (error) {
    log("[mailbox] legacy-senders-notice flag delete failed", { error })
    return { show: true, message: decision.message, hasToastedLegacy: true }
  }
}

export interface LegacySendersNoticeState {
  hasToastedLegacy: boolean
}

// I/O orchestrator wired into the poll tick: resolves the flag path, consumes
// it, and fires the toast on show. The caller owns `state` across ticks so the
// in-memory guard persists for the TUI session's lifetime. `api` is typed `any`
// to match the tui-command.ts feature-detection pattern (no exported narrow type).
export async function runLegacySendersNoticeCheck(
  api: any,
  state: LegacySendersNoticeState,
): Promise<void> {
  if (!api.ui?.toast) return
  const flagPath = resolveLegacySendersNoticePath()
  if (!flagPath) return

  try {
    const result = await consumeLegacySendersNotice(flagPath, {
      readFile: (filePath) => readFileAsync(filePath, "utf8"),
      deleteFile: (filePath) => unlinkAsync(filePath),
      hasToastedLegacy: state.hasToastedLegacy,
    })
    state.hasToastedLegacy = result.hasToastedLegacy
    if (result.show && result.message) {
      api.ui.toast({ variant: "info", message: result.message })
    }
  } catch (error) {
    log("[mailbox] legacy senders notice check failed", { error })
  }
}
