import { log } from "../../../shared/logger"
import {
  PRESENCE_INTERVAL_MS,
  type PresenceRecord,
  writePresenceRecord,
} from "./presence-record"

export interface PresenceHeartbeatDeps {
  projectId: string
  repoRoot: string
  serverUrl: string
  homeDir?: string
  pid?: number
  now?: () => number
  intervalMs?: number
  writeRecord?: (record: PresenceRecord, homeDir?: string) => Promise<void>
}

export interface PresenceHeartbeatHook {
  onSessionActive: (sessionId: string) => void
  dispose: () => void
}

export function createPresenceHeartbeatHook(deps: PresenceHeartbeatDeps): PresenceHeartbeatHook {
  const now = deps.now ?? (() => Date.now())
  const pid = deps.pid ?? process.pid
  const intervalMs = deps.intervalMs ?? PRESENCE_INTERVAL_MS
  const writeRecord = deps.writeRecord ?? writePresenceRecord

  let interval: ReturnType<typeof setInterval> | undefined
  let currentSessionId: string | undefined

  const buildRecord = (sessionId: string): PresenceRecord => ({
    projectId: deps.projectId,
    repoRoot: deps.repoRoot,
    mode: "external",
    serverUrl: deps.serverUrl,
    sessionId,
    pid,
    heartbeatTs: now(),
  })

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
    onSessionActive: (sessionId: string): void => {
      if (!sessionId) return
      currentSessionId = sessionId
      beat()
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
