import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { isRecord } from "@oh-my-opencode/utils"

import { log } from "../../../shared/logger"

// Mirror of the opencode fork's listener registry (packages/opencode/src/server/listener-registry.ts).
// The host writes <xdg-state>/opencode/instances/<pid>.json when Server.listen binds a TCP socket
// and removes it when the listener stops. A record for OUR pid is the ground truth that this
// process is externally reachable, and carries the real bound URL (never the 4096 placeholder).

export interface ListenerRecord {
  pid: number
  url: string
  hostname: string
  port: number
  startedAt: number
}

function opencodeStateDir(): string {
  const xdgState = process.env["XDG_STATE_HOME"] ?? path.join(os.homedir(), ".local", "state")
  return path.join(xdgState, "opencode")
}

export function listenerRecordPath(pid: number): string {
  return path.join(opencodeStateDir(), "instances", `${pid}.json`)
}

export function isListenerRecord(value: unknown): value is ListenerRecord {
  if (!isRecord(value)) return false
  return (
    typeof value["pid"] === "number" &&
    typeof value["url"] === "string" &&
    typeof value["hostname"] === "string" &&
    typeof value["port"] === "number" &&
    typeof value["startedAt"] === "number"
  )
}

const PROCESS_START_SLACK_MS = 15_000

// A record whose startedAt predates this process was written by a previous process that
// received the same pid after a hard kill (no finalizer ran to remove it). Trusting it
// would misclassify an internal session as external, so it is rejected.
function isFromThisProcess(record: ListenerRecord): boolean {
  const processStartMs = Date.now() - process.uptime() * 1_000
  return record.startedAt >= processStartMs - PROCESS_START_SLACK_MS
}

export async function readOwnListenerRecord(pid: number = process.pid): Promise<ListenerRecord | null> {
  try {
    const content = await readFile(listenerRecordPath(pid), "utf8")
    const parsed: unknown = JSON.parse(content)
    if (!isListenerRecord(parsed)) return null
    return parsed.pid === pid && isFromThisProcess(parsed) ? parsed : null
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
      log("[instance-registry] failed to read listener record", {
        error: error instanceof Error ? error.message : String(error),
        pid,
      })
    }
    return null
  }
}
