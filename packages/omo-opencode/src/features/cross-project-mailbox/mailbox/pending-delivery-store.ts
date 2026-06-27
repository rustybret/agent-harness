import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm } from "node:fs/promises"
import path from "node:path"

import type { PendingEntry } from "./types"

interface PendingFileData {
  pending: PendingEntry[]
}

const PENDING_STATES = new Set(["dispatch_sent", "history_confirmed"])

function isPendingEntry(value: unknown): value is PendingEntry {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record["messageId"] === "string" &&
    typeof record["sessionId"] === "string" &&
    typeof record["reservedPath"] === "string" &&
    typeof record["dispatchedAt"] === "number" &&
    typeof record["state"] === "string" &&
    PENDING_STATES.has(record["state"])
  )
}

function parsePendingData(content: string): PendingFileData {
  const parsed: unknown = JSON.parse(content)
  if (typeof parsed !== "object" || parsed === null) return { pending: [] }
  const pending = (parsed as Record<string, unknown>)["pending"]
  if (!Array.isArray(pending)) return { pending: [] }
  return { pending: pending.filter(isPendingEntry) }
}

export class PendingDeliveryStore {
  constructor(private readonly targetRepoRoot: string) {}

  private get pendingPath(): string {
    return path.join(this.targetRepoRoot, "coordination_notes", ".pending.json")
  }

  async addDispatchSent(entry: Omit<PendingEntry, "state">): Promise<void> {
    const data = await this.read()
    const next = data.pending.filter((existing) => existing.messageId !== entry.messageId)
    next.push({ ...entry, state: "dispatch_sent" })
    await this.atomicWrite({ pending: next })
  }

  async markHistoryConfirmed(messageId: string): Promise<void> {
    const data = await this.read()
    const next = data.pending.map((existing) =>
      existing.messageId === messageId ? { ...existing, state: "history_confirmed" as const } : existing,
    )
    await this.atomicWrite({ pending: next })
  }

  async getEntry(messageId: string): Promise<PendingEntry | undefined> {
    const data = await this.read()
    return data.pending.find((existing) => existing.messageId === messageId)
  }

  async removeEntry(messageId: string): Promise<void> {
    const data = await this.read()
    const next = data.pending.filter((existing) => existing.messageId !== messageId)
    await this.atomicWrite({ pending: next })
  }

  async listAll(): Promise<PendingEntry[]> {
    const data = await this.read()
    return data.pending
  }

  private async read(): Promise<PendingFileData> {
    try {
      const content = await readFile(this.pendingPath, "utf8")
      return parsePendingData(content)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === "ENOENT") return { pending: [] }
      if (error instanceof SyntaxError) return { pending: [] }
      throw error
    }
  }

  private async atomicWrite(data: PendingFileData): Promise<void> {
    await mkdir(path.dirname(this.pendingPath), { recursive: true, mode: 0o700 })
    const tmpPath = path.join(
      path.dirname(this.pendingPath),
      `.tmp-pending-${randomUUID()}.json`,
    )
    const content = `${JSON.stringify(data, null, 2)}\n`
    try {
      const fileHandle = await open(tmpPath, "wx")
      try {
        await fileHandle.writeFile(content)
      } finally {
        await fileHandle.close()
      }
      await rename(tmpPath, this.pendingPath)
    } catch (error) {
      await rm(tmpPath, { force: true })
      throw error
    }
  }
}
