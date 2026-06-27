import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm } from "node:fs/promises"
import path from "node:path"

import type { RateLimitEntry } from "./types"

interface RateLimitFileData {
  windows: RateLimitEntry[]
}

const WINDOW_MS = 60_000

function isRateLimitEntry(value: unknown): value is RateLimitEntry {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record["pairKey"] === "string" &&
    typeof record["count"] === "number" &&
    typeof record["windowStart"] === "number"
  )
}

function parseRateLimitData(content: string): RateLimitFileData {
  const parsed: unknown = JSON.parse(content)
  if (typeof parsed !== "object" || parsed === null) return { windows: [] }
  const windows = (parsed as Record<string, unknown>)["windows"]
  if (!Array.isArray(windows)) return { windows: [] }
  return { windows: windows.filter(isRateLimitEntry) }
}

export class SamePairRateLimiter {
  constructor(
    private readonly repoRoot: string,
    private readonly limitPerMin: number,
    private readonly now: () => number = Date.now,
  ) {}

  private get rateLimitPath(): string {
    return path.join(this.repoRoot, "coordination_notes", ".rate-limits.json")
  }

  async checkRateLimit(fromProjectId: string, toProjectId: string): Promise<{ limited: boolean }> {
    const pairKey = `${fromProjectId}:${toProjectId}`
    const data = await this.read()
    const entry = this.loadOrReset(pairKey, data)

    if (entry.count >= this.limitPerMin) {
      const others = data.windows.filter((window) => window.pairKey !== pairKey)
      await this.atomicWrite({ windows: [...others, entry] })
      return { limited: true }
    }

    const next: RateLimitEntry = { ...entry, count: entry.count + 1 }
    const others = data.windows.filter((window) => window.pairKey !== pairKey)
    await this.atomicWrite({ windows: [...others, next] })
    return { limited: false }
  }

  private loadOrReset(pairKey: string, data: RateLimitFileData): RateLimitEntry {
    const nowMs = this.now()
    const existing = data.windows.find((window) => window.pairKey === pairKey)
    if (existing === undefined || nowMs - existing.windowStart > WINDOW_MS) {
      return { pairKey, count: 0, windowStart: nowMs }
    }
    return existing
  }

  private async read(): Promise<RateLimitFileData> {
    try {
      const content = await readFile(this.rateLimitPath, "utf8")
      return parseRateLimitData(content)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === "ENOENT") return { windows: [] }
      if (error instanceof SyntaxError) return { windows: [] }
      throw error
    }
  }

  private async atomicWrite(data: RateLimitFileData): Promise<void> {
    await mkdir(path.dirname(this.rateLimitPath), { recursive: true, mode: 0o700 })
    const tmpPath = path.join(path.dirname(this.rateLimitPath), `.tmp-rate-limits-${randomUUID()}.json`)
    const content = `${JSON.stringify(data, null, 2)}\n`
    try {
      const fileHandle = await open(tmpPath, "wx")
      try {
        await fileHandle.writeFile(content)
      } finally {
        await fileHandle.close()
      }
      await rename(tmpPath, this.rateLimitPath)
    } catch (error) {
      await rm(tmpPath, { force: true })
      throw error
    }
  }
}
