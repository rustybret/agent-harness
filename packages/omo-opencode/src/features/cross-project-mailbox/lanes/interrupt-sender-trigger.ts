import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import {
  isPidAlive,
  parsePortFileRecord,
  portFileDir,
} from "../../external-inject/port-file"
import type { PortFileRecord } from "../../external-inject/port-file"

export type InterruptDrainNowResult = { readonly triggered: boolean }

type InterruptDrainFetch = (url: string, init: RequestInit) => Promise<Response>
type InterruptDrainLog = (message: string, data?: Record<string, unknown>) => void

export type InterruptDrainTriggerDeps = {
  readonly fetch?: InterruptDrainFetch
  readonly log?: InterruptDrainLog
  readonly readPortFile?: (targetRepoRoot: string) => Promise<PortFileRecord | null>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function liveRecord(record: PortFileRecord): boolean {
  return record.pid <= 0 || isPidAlive(record.pid)
}

export async function readLatestLivePortFile(targetRepoRoot: string): Promise<PortFileRecord | null> {
  const dir = portFileDir(targetRepoRoot)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null
    }
    throw error
  }

  const records = await Promise.all(entries
    .filter((entry) => entry.endsWith(".json"))
    .map(async (entry): Promise<PortFileRecord | null> => {
      const record = parsePortFileRecord(await readFile(path.join(dir, entry), "utf8"))
      return record && liveRecord(record) ? record : null
    }))

  return records
    .filter((record) => record !== null)
    .sort((left, right) => right.started_at - left.started_at)
    .at(0) ?? null
}

export async function triggerInterruptMailboxDrainNow(
  targetRepoRoot: string,
  deps: InterruptDrainTriggerDeps = {},
): Promise<InterruptDrainNowResult> {
  const log = deps.log ?? (() => undefined)
  const readPortFile = deps.readPortFile ?? readLatestLivePortFile
  const portFile = await readPortFile(targetRepoRoot)
  if (portFile === null) {
    log("[mailbox-interrupt] no external-inject bridge port found", { targetRepoRoot })
    return { triggered: false }
  }

  const fetcher = deps.fetch ?? globalThis.fetch
  try {
    const response = await fetcher(`http://127.0.0.1:${portFile.port}/rpc/mailbox_drain_now`, {
      method: "POST",
      body: JSON.stringify({ token: portFile.token }),
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(1_500),
    })
    if (!response.ok) {
      log("[mailbox-interrupt] drain-now nudge failed", { status: response.status, targetRepoRoot })
      return { triggered: false }
    }
    return { triggered: true }
  } catch (error) {
    log("[mailbox-interrupt] drain-now nudge failed", { error: errorMessage(error), targetRepoRoot })
    return { triggered: false }
  }
}
