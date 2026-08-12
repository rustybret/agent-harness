import { readFile } from "node:fs/promises"
import os from "node:os"


import { describeErrorForLog, log } from "../../../shared/logger"
import { probeTcpLiveness, TCP_LIVENESS_TIMEOUT_MS, type TcpLiveness } from "./tcp-liveness"
import { getServerBasicAuthHeader } from "../../../shared/opencode-server-auth"
import {
  PRESENCE_TTL_MS,
  type PresenceRecord,
  presenceRecordPath,
} from "./presence-record"

export type PresenceStatus = "live" | "stale" | "offline" | "internal"

export interface PresenceDetail {
  status: PresenceStatus | "missing"
  heartbeatTs: number | null
  protocolVersion?: number
}

const DEFAULT_PROBE_TIMEOUT_MS = 2_000

// The HTTP attempt must finish early enough to leave room for the TCP fallback inside the caller's
// overall probe deadline. Spending the whole budget on the fetch would make the fallback dead code:
// the outer race resolves "not live" at the same instant the fetch gives up.
const HTTP_PROBE_TIMEOUT_MS = DEFAULT_PROBE_TIMEOUT_MS - TCP_LIVENESS_TIMEOUT_MS - 200

export interface ReadPresenceStatusDeps {
  probeSession: (record: PresenceRecord) => Promise<boolean>
  probeTimeoutMs?: number
}

export function isPresenceRecord(value: unknown): value is PresenceRecord {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  const mode = record["mode"]
  const serverUrl = record["serverUrl"]
  const protocolVersion = record["protocolVersion"]
  return (
    typeof record["projectId"] === "string" &&
    (mode === "internal" || mode === "external") &&
    (typeof serverUrl === "string" || serverUrl === null) &&
    typeof record["sessionId"] === "string" &&
    typeof record["heartbeatTs"] === "number" &&
    (protocolVersion === undefined || typeof protocolVersion === "number")
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

function buildHealthUrl(serverUrl: string): string {
  const base = serverUrl.replace(/\/$/, "")
  return `${base}/global/health`
}

// Reachability-only liveness: ANY HTTP response (including 401/404) proves a live opencode
// server behind the published URL; only a network-level failure means dead. Attendance is
// carried by heartbeat freshness in readPresenceStatus (the process that beats every 10s is
// alive), NOT by activity endpoints like /session/status, which the host evicts on idle — an
// idle session is the NORMAL resting state of an attended external session, never "gone".
export async function defaultProbeSession(
  record: PresenceRecord,
  probeTcp: (serverUrl: string) => Promise<TcpLiveness> = probeTcpLiveness,
): Promise<boolean> {
  if (record.serverUrl === null) return false
  const auth = getServerBasicAuthHeader()
  const headers: Record<string, string> = { "x-opencode-directory": record.repoRoot }
  if (auth) headers["Authorization"] = auth
  try {
    await fetch(buildHealthUrl(record.serverUrl), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(HTTP_PROBE_TIMEOUT_MS),
    })
    return true
  } catch (error) {
    // A busy peer and a dead peer both fail this fetch, and the busy case is the common one: a
    // session mid-turn leaves the request queued past the deadline. Falling back to a TCP connect
    // asks the kernel instead of the application, so "still bound" is answered even when the server
    // is too loaded to reply. Only a refused connection is treated as genuinely gone.
    const liveness = await probeTcp(record.serverUrl)
    if (liveness === "accepted") return true
    log("[presence-reader] health probe failed", {
      error: describeErrorForLog(error),
      tcp: liveness,
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

export async function readPresenceDetail(
  projectId: string,
  homeDir: string = os.homedir(),
  deps: ReadPresenceStatusDeps = { probeSession: defaultProbeSession },
): Promise<PresenceDetail> {
  const record = await readRecord(projectId, homeDir)
  if (record === null) {
    return { status: "missing", heartbeatTs: null, protocolVersion: undefined }
  }

  const protocolVersion = record.protocolVersion ?? 1
  const age = Date.now() - record.heartbeatTs
  if (age > PRESENCE_TTL_MS) {
    return { status: "offline", heartbeatTs: record.heartbeatTs, protocolVersion }
  }

  if (record.mode === "internal") {
    return { status: "internal", heartbeatTs: record.heartbeatTs, protocolVersion }
  }

  const timeoutMs = deps.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const alive = await raceProbe(record, deps.probeSession, timeoutMs)
  return { status: alive ? "live" : "stale", heartbeatTs: record.heartbeatTs, protocolVersion }
}

export async function readPresenceStatus(
  projectId: string,
  homeDir: string = os.homedir(),
  deps: ReadPresenceStatusDeps = { probeSession: defaultProbeSession },
): Promise<PresenceStatus> {
  const detail = await readPresenceDetail(projectId, homeDir, deps)
  return detail.status === "missing" ? "offline" : detail.status
}
