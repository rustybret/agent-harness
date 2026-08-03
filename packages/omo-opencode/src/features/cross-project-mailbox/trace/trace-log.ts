import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"

import type { MailboxTraceSink } from "./types"

export const TRACE_DETAIL_PREVIEW_MAX = 100

export function traceLogPath(repoRoot: string): string {
  return path.join(repoRoot, ".omo", "mailbox-trace.jsonl")
}

// Append-only JSONL sink mirroring send-tool/outbox-log.ts: mkdir(dirname, recursive) then
// appendFile(JSON + "\n"). Returns a promise the caller MUST swallow so a slow/failing disk
// never stalls or fails a drain (fire-and-forget contract lives in emit-trace.ts).
export function createFileTraceSink(repoRoot: string): MailboxTraceSink {
  const logPath = traceLogPath(repoRoot)
  return {
    async append(record: Record<string, unknown>): Promise<void> {
      await mkdir(path.dirname(logPath), { recursive: true })
      await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8")
    },
  }
}
