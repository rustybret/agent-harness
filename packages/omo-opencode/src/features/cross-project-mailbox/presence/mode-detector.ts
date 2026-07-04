import { settleAfterSessionIdle } from "@oh-my-opencode/utils"

import { log as sharedLog } from "../../../shared/logger"
import type { PresenceMode, PresenceRecord } from "./presence-record"

export type ModeDetectorLog = (message: string, data?: unknown) => void

export type MailboxMode = PresenceMode
export type MailboxModeState = MailboxMode | "unknown"

// Trigger vocabulary consumed by T4 (heartbeat wiring) and T7/T8 (tool-exec lazy fallback):
// - "start": session became active for the first time (session.created / first idle).
// - "resume": an explicit resume of an already-seen session; forces a re-detect + transition check.
// - "tool-exec": a tool executed before any detect ran; used only to lazily prime an "unknown" session.
// Re-detection runs on a NEW sessionId OR trigger === "resume"; every other call returns the memoized value.
export type ModeDetectTrigger = "start" | "resume" | "tool-exec"

const DEFAULT_PROBE_TIMEOUT_MS = 2_000
const DEFAULT_SETTLE_MS = 150
const MAX_ABSENT_RETRIES = 2

export interface ModeDetectorDeps {
  resolveServerUrl: () => string | null
  repoRoot: string
  probe: (record: PresenceRecord) => Promise<boolean>
  now?: () => number
  settleMs?: number
  probeTimeoutMs?: number
  log?: ModeDetectorLog
}

export interface ModeDetector {
  detect(sessionId: string, trigger: ModeDetectTrigger): Promise<MailboxMode>
  currentMode(): MailboxModeState
}

type ProbeOutcome = "present" | "absent" | "error"

interface DetectionResult {
  mode: MailboxMode
  reason: string
}

async function raceProbeTimeout(promise: Promise<boolean>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`mode-detect probe timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function createModeDetector(deps: ModeDetectorDeps): ModeDetector {
  const now = deps.now ?? Date.now
  const settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS
  const probeTimeoutMs = deps.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const log = deps.log ?? sharedLog

  let memoSessionId: string | null = null
  let memoMode: MailboxModeState = "unknown"

  function buildSelfRecord(serverUrl: string, sessionId: string): PresenceRecord {
    return {
      projectId: "self-probe",
      repoRoot: deps.repoRoot,
      mode: "external",
      serverUrl,
      sessionId,
      pid: process.pid,
      heartbeatTs: now(),
    }
  }

  async function probeOnce(record: PresenceRecord): Promise<ProbeOutcome> {
    try {
      const live = await raceProbeTimeout(deps.probe(record), probeTimeoutMs)
      return live ? "present" : "absent"
    } catch {
      return "error"
    }
  }

  async function runDetection(sessionId: string): Promise<DetectionResult> {
    const serverUrl = deps.resolveServerUrl()
    if (!serverUrl) return { mode: "internal", reason: "no-server-url" }

    const record = buildSelfRecord(serverUrl, sessionId)
    let outcome = await probeOnce(record)
    if (outcome === "present") return { mode: "external", reason: "session-live" }
    if (outcome === "error") return { mode: "internal", reason: "timeout" }

    // Freshly-created-session race: reachable-but-absent -> settle and retry before concluding internal.
    for (let attempt = 1; attempt <= MAX_ABSENT_RETRIES; attempt += 1) {
      await settleAfterSessionIdle(settleMs)
      outcome = await probeOnce(record)
      if (outcome === "present") return { mode: "external", reason: "session-live-retry" }
      if (outcome === "error") return { mode: "internal", reason: "timeout" }
    }
    return { mode: "internal", reason: "session-absent" }
  }

  return {
    async detect(sessionId: string, trigger: ModeDetectTrigger): Promise<MailboxMode> {
      const shouldRun = sessionId !== memoSessionId || trigger === "resume"
      if (!shouldRun && memoMode !== "unknown") return memoMode

      const from = memoMode
      const { mode, reason } = await runDetection(sessionId)
      memoSessionId = sessionId
      memoMode = mode

      log("[mailbox-mode] detected", { mode, sessionId, trigger, reason })
      if (from !== "unknown" && from !== mode) {
        log("[mailbox-mode] transition", { from, to: mode, sessionId })
      }
      return mode
    },
    currentMode(): MailboxModeState {
      return memoMode
    },
  }
}
