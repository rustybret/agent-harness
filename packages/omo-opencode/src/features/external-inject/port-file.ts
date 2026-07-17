import { randomBytes } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

import { resolveXdgDataDir } from "@oh-my-opencode/utils"

import { projectIdForRoot } from "../cross-project-mailbox/envelope/project-id"

// Port-file discovery mirrors AFT's MIT rpc-utils/rpc-server pattern
// (github.com/cortexkit/aft, packages/opencode-plugin/src/shared): per-instance
// files under a per-project dir so two plugin instances under `opencode --port 0`
// do not clobber each other, with pid + started_at for newest-live selection.

export interface PortFileRecord {
  readonly port: number
  readonly token: string
  readonly pid: number
  readonly started_at: number
}

/**
 * Per-project directory holding one `<instanceId>.json` per live plugin
 * instance. Root respects XDG_DATA_HOME (resolved Q1) — transient runtime
 * state, not tracked workspace state.
 */
export function portFileDir(repoRoot: string): string {
  const dataDir = resolveXdgDataDir("oh-my-opencode")
  return path.join(dataDir, "rpc", projectIdForRoot(repoRoot), "ports")
}

export function newInstanceId(): string {
  return randomBytes(8).toString("hex")
}

export function newToken(): string {
  return randomBytes(32).toString("hex")
}

/** Atomically write the port file (tmp + rename), dir 0700, file 0600. */
export function writePortFile(dir: string, instanceId: string, record: PortFileRecord): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const filePath = path.join(dir, `${instanceId}.json`)
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(record), { encoding: "utf-8", mode: 0o600 })
  renameSync(tmpPath, filePath)
  return filePath
}

export function removePortFile(filePath: string): void {
  try {
    unlinkSync(filePath)
  } catch {
    // best-effort; already gone or racing another sweep
  }
}

export function portFileExists(filePath: string): boolean {
  return existsSync(filePath)
}

/** `process.kill(pid, 0)` sends no signal; EPERM means alive-but-unsignalable. */
export function isPidAlive(pid: number | undefined): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

export function parsePortFileRecord(content: string): PortFileRecord | null {
  const trimmed = content.trim()
  if (trimmed.length === 0 || !trimmed.startsWith("{")) return null
  try {
    const parsed = JSON.parse(trimmed) as Partial<Record<keyof PortFileRecord, unknown>>
    const port = typeof parsed.port === "number" ? parsed.port : Number.NaN
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
    if (typeof parsed.token !== "string" || parsed.token.length === 0) return null
    const pid = typeof parsed.pid === "number" && Number.isInteger(parsed.pid) ? parsed.pid : 0
    const started_at = typeof parsed.started_at === "number" ? parsed.started_at : 0
    return { port, token: parsed.token, pid, started_at }
  } catch {
    return null
  }
}

/**
 * Remove sibling port files whose owning process is provably dead. Never
 * touches `keepPath` (our own freshly written file) or pid-less/legacy files.
 */
export function sweepDeadPortFiles(dir: string, keepPath: string): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue
    const filePath = path.join(dir, entry)
    if (filePath === keepPath) continue
    try {
      const record = parsePortFileRecord(readFileSync(filePath, "utf-8"))
      if (record === null) {
        unlinkSync(filePath)
        continue
      }
      if (record.pid > 0 && !isPidAlive(record.pid)) {
        unlinkSync(filePath)
      }
    } catch {
      // racing another sweep / permission issue — retried on next start
    }
  }
}
