import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm } from "node:fs/promises"
import path from "node:path"

import type { DigestEntry } from "./types"

interface DigestFileData {
  entries: DigestEntry[]
}

export function normalizeBody(body: string): string {
  return body
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n /g, "\n")
}

function sha256(input: string): string {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(input)
  return hasher.digest("hex")
}

function isDigestEntry(value: unknown): value is DigestEntry {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record["key"] === "string" &&
    typeof record["digest"] === "string" &&
    typeof record["fromProjectId"] === "string" &&
    typeof record["toProjectId"] === "string" &&
    typeof record["correlationId"] === "string" &&
    typeof record["recordedAt"] === "number" &&
    typeof record["ttlMs"] === "number"
  )
}

function parseDigestData(content: string): DigestFileData {
  const parsed: unknown = JSON.parse(content)
  if (typeof parsed !== "object" || parsed === null) return { entries: [] }
  const entries = (parsed as Record<string, unknown>)["entries"]
  if (!Array.isArray(entries)) return { entries: [] }
  return { entries: entries.filter(isDigestEntry) }
}

export class BodyDigestStore {
  constructor(
    private readonly repoRoot: string,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private get digestPath(): string {
    return path.join(this.repoRoot, "coordination_notes", ".digests.json")
  }

  async checkAndRecord(note: {
    fromProjectId: string
    toProjectId: string
    correlationId: string
    body: string
  }): Promise<{ isDuplicate: boolean }> {
    const digest = sha256(normalizeBody(note.body))
    const key = `${note.fromProjectId}:${note.toProjectId}:${note.correlationId}:${digest}`
    const nowMs = this.now()

    const data = await this.read()
    const live = data.entries.filter((entry) => nowMs - entry.recordedAt <= entry.ttlMs)
    const existing = live.find((entry) => entry.key === key)
    if (existing !== undefined) {
      await this.atomicWrite({ entries: live })
      return { isDuplicate: true }
    }

    live.push({
      key,
      digest,
      fromProjectId: note.fromProjectId,
      toProjectId: note.toProjectId,
      correlationId: note.correlationId,
      recordedAt: nowMs,
      ttlMs: this.ttlMs,
    })
    await this.atomicWrite({ entries: live })
    return { isDuplicate: false }
  }

  async pruneExpired(): Promise<void> {
    const nowMs = this.now()
    const data = await this.read()
    const live = data.entries.filter((entry) => nowMs - entry.recordedAt <= entry.ttlMs)
    await this.atomicWrite({ entries: live })
  }

  private async read(): Promise<DigestFileData> {
    try {
      const content = await readFile(this.digestPath, "utf8")
      return parseDigestData(content)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === "ENOENT") return { entries: [] }
      if (error instanceof SyntaxError) return { entries: [] }
      throw error
    }
  }

  private async atomicWrite(data: DigestFileData): Promise<void> {
    await mkdir(path.dirname(this.digestPath), { recursive: true, mode: 0o700 })
    const tmpPath = path.join(path.dirname(this.digestPath), `.tmp-digests-${randomUUID()}.json`)
    const content = `${JSON.stringify(data, null, 2)}\n`
    try {
      const fileHandle = await open(tmpPath, "wx")
      try {
        await fileHandle.writeFile(content)
      } finally {
        await fileHandle.close()
      }
      await rename(tmpPath, this.digestPath)
    } catch (error) {
      await rm(tmpPath, { force: true })
      throw error
    }
  }
}
