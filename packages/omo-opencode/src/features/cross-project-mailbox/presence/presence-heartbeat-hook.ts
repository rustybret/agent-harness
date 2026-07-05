import { log } from "../../../shared/logger"
import type { ModeDetectTrigger, ModeDetector } from "./mode-detector"
import {
  PRESENCE_INTERVAL_MS,
  type PresenceRecord,
  writePresenceRecord,
} from "./presence-record"

export interface PresenceHeartbeatDeps {
  projectId: string
  repoRoot: string
  serverUrl: string | null
  homeDir?: string
  pid?: number
  now?: () => number
  intervalMs?: number
  writeRecord?: (record: PresenceRecord, homeDir?: string) => Promise<void>
  modeDetector?: Pick<ModeDetector, "detect" | "currentMode" | "currentServerUrl">
}

export interface PresenceHeartbeatHook {
  onSessionActive: (sessionId: string, trigger?: ModeDetectTrigger) => void
  dispose: () => void
}

export function createPresenceHeartbeatHook(deps: PresenceHeartbeatDeps): PresenceHeartbeatHook {
  const now = deps.now ?? (() => Date.now())
  const pid = deps.pid ?? process.pid
  const intervalMs = deps.intervalMs ?? PRESENCE_INTERVAL_MS
  const writeRecord = deps.writeRecord ?? writePresenceRecord
  const detector = deps.modeDetector

  let interval: ReturnType<typeof setInterval> | undefined
  let currentSessionId: string | undefined

  const buildRecord = (sessionId: string): PresenceRecord => {
    // "unknown" (no detector, or a detect not yet resolved) keeps the legacy external default so
    // peers still see freshness; only a confirmed "internal" mode publishes the null-url record.
    const isExternal = (detector?.currentMode() ?? "external") !== "internal"
    // Registry-resolved URL wins: it is the REAL bound address. deps.serverUrl is the legacy
    // client-derived value, which can be the localhost:4096 placeholder on older hosts.
    const resolvedUrl = detector?.currentServerUrl() ?? deps.serverUrl
    return {
      projectId: deps.projectId,
      repoRoot: deps.repoRoot,
      mode: isExternal ? "external" : "internal",
      serverUrl: isExternal ? resolvedUrl : null,
      sessionId,
      pid,
      heartbeatTs: now(),
    }
  }

  const beat = (): void => {
    if (currentSessionId === undefined) return
    void writeRecord(buildRecord(currentSessionId), deps.homeDir).catch((error) => {
      log("[presence-heartbeat] failed to write presence record", {
        error: error instanceof Error ? error.message : String(error),
        projectId: deps.projectId,
      })
    })
  }

  return {
    onSessionActive: (sessionId: string, trigger: ModeDetectTrigger = "start"): void => {
      if (!sessionId) return
      currentSessionId = sessionId
      if (detector) {
        // Resolve the live mode BEFORE the first beat so the record is mode-tagged from the start.
        // detect() memoizes per session, so recurring idle beats never re-probe.
        detector.detect(sessionId, trigger).then(beat, beat)
      } else {
        beat()
      }
      if (interval === undefined) {
        interval = setInterval(beat, intervalMs)
        if (typeof interval.unref === "function") interval.unref()
      }
    },
    dispose: (): void => {
      if (interval !== undefined) {
        clearInterval(interval)
        interval = undefined
      }
      currentSessionId = undefined
    },
  }
}
