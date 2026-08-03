import { randomUUID } from "node:crypto"
import path from "node:path"

import { log } from "../../../shared/logger"
import type { RemoteMailboxRequest, RemoteMailboxRequestKind } from "./schema"

// A single outbound-remote-contract that is awaiting cloudhome's completion reply. Keyed on
// the ORIGINAL inbound note's messageId (the note being fulfilled), with a secondary index
// back through outboundMessageId so a threaded reply (whose inReplyToMessageId references the
// OUTBOUND contract note) can be resolved to the original note it fulfills.
export interface RemotePendingRecord {
  readonly originalMessageId: string
  readonly outboundMessageId: string
  readonly originalFromProjectId: string
  readonly originalCorrelationId: string
  readonly kind: RemoteMailboxRequestKind
  readonly requestPayload: RemoteMailboxRequest
  readonly createdAt: number
}

// Injected filesystem port so tests never touch disk and never use mock.module (memory #2177).
export interface RemotePendingFsPort {
  mkdir(dir: string): Promise<void>
  readFile(filePath: string): Promise<string>
  writeFile(filePath: string, content: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  rm(filePath: string): Promise<void>
  readdir(dir: string): Promise<string[]>
}

export interface RemotePendingStoreOptions {
  readonly baseDir: string
  readonly fs: RemotePendingFsPort
}

export interface RemotePendingStore {
  isPending(originalMessageId: string): Promise<boolean>
  getPending(originalMessageId: string): Promise<RemotePendingRecord | undefined>
  findByOutboundMessageId(outboundMessageId: string): Promise<RemotePendingRecord | undefined>
  markPending(record: RemotePendingRecord): Promise<void>
  clearPending(originalMessageId: string): Promise<void>
}

const RECORD_SUFFIX = ".json"

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
}

function safeRecordFilename(originalMessageId: string): string {
  const sanitized = originalMessageId.replace(/[^A-Za-z0-9._-]/g, "_")
  return `${sanitized}${RECORD_SUFFIX}`
}

function isRemotePendingRecord(value: unknown): value is RemotePendingRecord {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record["originalMessageId"] === "string" &&
    typeof record["outboundMessageId"] === "string" &&
    typeof record["originalFromProjectId"] === "string" &&
    typeof record["originalCorrelationId"] === "string" &&
    typeof record["kind"] === "string" &&
    typeof record["requestPayload"] === "object" &&
    record["requestPayload"] !== null &&
    typeof record["createdAt"] === "number"
  )
}

// File-based store mirroring pending-delivery-store.ts's atomic tmp+rename convention. One
// JSON file per pending remote contract under <baseDir>/<sanitizedOriginalMessageId>.json so
// concurrent drain passes never trample a shared file.
export function createRemotePendingStore(options: RemotePendingStoreOptions): RemotePendingStore {
  const { baseDir, fs } = options

  function recordPath(originalMessageId: string): string {
    return path.join(baseDir, safeRecordFilename(originalMessageId))
  }

  async function readRecord(filePath: string): Promise<RemotePendingRecord | undefined> {
    let content: string
    try {
      content = await fs.readFile(filePath)
    } catch (error) {
      if (isMissingPath(error)) return undefined
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      return undefined
    }
    return isRemotePendingRecord(parsed) ? parsed : undefined
  }

  async function getPending(originalMessageId: string): Promise<RemotePendingRecord | undefined> {
    return readRecord(recordPath(originalMessageId))
  }

  return {
    getPending,

    async isPending(originalMessageId: string): Promise<boolean> {
      return (await getPending(originalMessageId)) !== undefined
    },

    async findByOutboundMessageId(outboundMessageId: string): Promise<RemotePendingRecord | undefined> {
      let names: string[]
      try {
        names = await fs.readdir(baseDir)
      } catch (error) {
        if (isMissingPath(error)) return undefined
        throw error
      }
      for (const name of names) {
        if (!name.endsWith(RECORD_SUFFIX)) continue
        const record = await readRecord(path.join(baseDir, name))
        if (record?.outboundMessageId === outboundMessageId) return record
      }
      return undefined
    },

    async markPending(record: RemotePendingRecord): Promise<void> {
      await fs.mkdir(baseDir)
      const targetPath = recordPath(record.originalMessageId)
      const tmpPath = path.join(baseDir, `.tmp-remote-pending-${randomUUID()}.json`)
      const content = `${JSON.stringify(record, null, 2)}\n`
      try {
        await fs.writeFile(tmpPath, content)
        await fs.rename(tmpPath, targetPath)
      } catch (error) {
        await fs.rm(tmpPath).catch((cleanupError) => {
          log("[remote-pending-store] failed to clean up temp file after write failure", {
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            tmpPath,
          })
        })
        throw error
      }
    },

    async clearPending(originalMessageId: string): Promise<void> {
      try {
        await fs.rm(recordPath(originalMessageId))
      } catch (error) {
        if (isMissingPath(error)) return
        throw error
      }
    },
  }
}
