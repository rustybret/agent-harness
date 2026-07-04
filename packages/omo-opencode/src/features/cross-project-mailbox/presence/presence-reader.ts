import { readFile } from "node:fs/promises"
import os from "node:os"

import { isRecord } from "@oh-my-opencode/utils"

import { log } from "../../../shared/logger"
import { getServerBasicAuthHeader } from "../../../shared/opencode-server-auth"
import {
  PRESENCE_TTL_MS,
  type PresenceRecord,
  presenceRecordPath,
} from "./presence-record"

export type PresenceStatus = "live" | "stale" | "offline"

const DEFAULT_PROBE_TIMEOUT_MS = 2_000

export interface ReadPresenceStatusDeps {
  probeSession: (record: PresenceRecord) => Promise<boolean>
  probeTimeoutMs?: number
}

export function isPresenceRecord(value: unknown): value is PresenceRecord {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  const mode = record["mode"]
  const serverUrl = record["serverUrl"]
  return (
    typeof record["projectId"] === "string" &&
    (mode === "internal" || mode === "external") &&
    (typeof serverUrl === "string" || serverUrl === null) &&
    typeof record["sessionId"] === "string" &&
    typeof record["heartbeatTs"] === "number"
  )
}

async function readRecord(projectId: string, homeDir: string): Promise<PresenceRecord | null> {
  try {
    const content = await readFile(presenceRecordPath(projectId, homeDir), "utf8")
    const parsed: unknown = JSON.parse(content)
    return isPresenceRecord(parsed) ? parsed : null
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
      log("[presence-reader] failed to read presence record", { error, projectId })
    }
    return null
  }
}

function buildSessionStatusUrl(serverUrl: string, repoRoot: string): string {
  const base = serverUrl.replace(/\/$/, "")
  const url = new URL(`${base}/session/status`)
  url.searchParams.set("directory", repoRoot)
  return url.toString()
}

export async function defaultProbeSession(record: PresenceRecord): Promise<boolean> {
  if (record.serverUrl === null) return false
  const auth = getServerBasicAuthHeader()
  const headers: Record<string, string> = { "x-opencode-directory": record.repoRoot }
  if (auth) headers["Authorization"] = auth
  try {
    const response = await fetch(buildSessionStatusUrl(record.serverUrl, record.repoRoot), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(DEFAULT_PROBE_TIMEOUT_MS),
    })
    if (!response.ok) return false
    const payload: unknown = await response.json()
    if (!isRecord(payload)) return false
    return Object.hasOwn(payload, record.sessionId)
  } catch (error) {
    log("[presence-reader] session probe failed", {
      error: error instanceof Error ? error.message : String(error),
      sessionId: record.sessionId,
    })
    return false
  }
}

async function raceProbe(
  record: PresenceRecord,
  probeSession: (record: PresenceRecord) => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  try {
    return await Promise.race([Promise.resolve(probeSession(record)).catch(() => false), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function readPresenceStatus(
  projectId: string,
  homeDir: string = os.homedir(),
  deps: ReadPresenceStatusDeps = { probeSession: defaultProbeSession },
): Promise<PresenceStatus> {
  const record = await readRecord(projectId, homeDir)
  if (record === null) return "offline"

  const age = Date.now() - record.heartbeatTs
  if (age > PRESENCE_TTL_MS) return "offline"

  const timeoutMs = deps.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const alive = await raceProbe(record, deps.probeSession, timeoutMs)
  return alive ? "live" : "stale"
}
