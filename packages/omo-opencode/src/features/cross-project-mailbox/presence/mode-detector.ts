import { settleAfterSessionIdle } from "@oh-my-opencode/utils"

import { log as sharedLog } from "../../../shared/logger"
import { readOwnListenerRecord, type ListenerRecord } from "./instance-registry"
import type { PresenceMode } from "./presence-record"

export type ModeDetectorLog = (message: string, data?: unknown) => void

export type MailboxMode = PresenceMode
export type MailboxModeState = MailboxMode | "unknown"

// Trigger vocabulary consumed by T4 (heartbeat wiring) and T7/T8 (tool-exec lazy fallback):
// - "start": session became active for the first time (session.created / first idle).
// - "resume": an explicit resume of an already-seen session; forces a re-detect + transition check.
// - "tool-exec": a tool executed before any detect ran; used only to lazily prime an "unknown" session.
// Re-detection runs on a NEW sessionId OR trigger === "resume"; every other call returns the memoized value.
export type ModeDetectTrigger = "start" | "resume" | "tool-exec"

const DEFAULT_SETTLE_MS = 150
const MAX_ABSENT_RETRIES = 2

// The host SDK client falls back to this placeholder when Server.url is undefined at plugin init,
// so a bare equality match means "no real bind was observed", NOT "bound on 4096". A REAL 4096 bind
// is still detected external via the listener registry; this constant only guards the legacy path.
const LEGACY_PLACEHOLDER_URLS = new Set(["http://localhost:4096", "http://localhost:4096/"])

export interface ModeDetectorDeps {
  /** Legacy fallback only: consulted when the host wrote no listener-registry record. */
  resolveServerUrl: () => string | null
  repoRoot: string
  /** Reads the opencode fork's on-disk listener record for THIS pid. */
  readOwnRecord?: () => Promise<ListenerRecord | null>
  settleMs?: number
  log?: ModeDetectorLog
}

export interface ModeDetector {
  detect(sessionId: string, trigger: ModeDetectTrigger): Promise<MailboxMode>
  currentMode(): MailboxModeState
  /** Real bound URL for external sessions (registry-first), null for internal/unknown. */
  currentServerUrl(): string | null
}

interface DetectionResult {
  mode: MailboxMode
  serverUrl: string | null
  reason: string
}

// Detection ground truth is the host's listener registry (written by Server.listen when a TCP
// socket binds, removed on stop): it is activity-independent (an idle session stays external),
// identity-exact (keyed by our own pid), and carries the REAL bound URL — unlike HTTP self-probes
// against /session/status, which the host evicts on idle, or ctx.serverUrl, which degrades to a
// localhost:4096 placeholder whenever the plugin initializes before (or without) a listener.
export function createModeDetector(deps: ModeDetectorDeps): ModeDetector {
  const settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS
  const readOwnRecord = deps.readOwnRecord ?? readOwnListenerRecord
  const log = deps.log ?? sharedLog

  let memoSessionId: string | null = null
  let memoMode: MailboxModeState = "unknown"
  let memoServerUrl: string | null = null

  function legacyFallback(): DetectionResult {
    const resolved = deps.resolveServerUrl()
    if (resolved !== null && !LEGACY_PLACEHOLDER_URLS.has(resolved)) {
      return { mode: "external", serverUrl: resolved, reason: "legacy-server-url" }
    }
    return { mode: "internal", serverUrl: null, reason: "no-listener-record" }
  }

  async function readRecordSafely(): Promise<ListenerRecord | null> {
    try {
      return await readOwnRecord()
    } catch {
      return null
    }
  }

  async function runDetection(): Promise<DetectionResult> {
    let record = await readRecordSafely()
    // Freshly-started-listener race: the record write and the first session event are
    // near-simultaneous, so settle briefly before concluding no listener exists.
    for (let attempt = 1; record === null && attempt <= MAX_ABSENT_RETRIES; attempt += 1) {
      await settleAfterSessionIdle(settleMs)
      record = await readRecordSafely()
    }
    if (record !== null) {
      return { mode: "external", serverUrl: record.url, reason: "listener-record" }
    }
    return legacyFallback()
  }

  return {
    async detect(sessionId: string, trigger: ModeDetectTrigger): Promise<MailboxMode> {
      const shouldRun = sessionId !== memoSessionId || trigger === "resume"
      if (!shouldRun && memoMode !== "unknown") return memoMode

      const from = memoMode
      const { mode, serverUrl, reason } = await runDetection()
      memoSessionId = sessionId
      memoMode = mode
      memoServerUrl = serverUrl

      log("[mailbox-mode] detected", { mode, sessionId, trigger, reason })
      if (from !== "unknown" && from !== mode) {
        log("[mailbox-mode] transition", { from, to: mode, sessionId })
      }
      return mode
    },
    currentMode(): MailboxModeState {
      return memoMode
    },
    currentServerUrl(): string | null {
      return memoServerUrl
    },
  }
}
