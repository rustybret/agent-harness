import type { Dirent } from "node:fs"
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs"
import { readdir } from "node:fs/promises"
import path from "node:path"

import { log } from "../../../shared/logger"
import type { CrossProjectMailboxConfig } from "../config"
import { projectIdForRoot } from "../envelope/project-id"
import { outboxLogPath, parseOutboxLine } from "../send-tool"
import type { OutboxEntry } from "../send-tool"

const NOTE_SUFFIX = ".md"
const RESERVED_PREFIX = ".delivering-"
const RECENT_SENT_LIMIT = 3
const OUTBOX_ACK_WINDOW = 50
// Tail budget for the outbox log: large enough to comfortably hold more than
// OUTBOX_ACK_WINDOW JSONL lines (body preview capped at 100 chars), bounded so a
// huge log is never loaded in full.
const OUTBOX_TAIL_BYTES = 64 * 1024

export interface MailboxSidebarRegistryPort {
  getRepoRootForProjectId(id: string): string | undefined
}

export interface MailboxSidebarState {
  inboundUnread: number
  inboundProcessed: number
  recentSentCount: number
  recentSent: OutboxEntry[]
  outboundUnresolved: number
  outboundRead: number
  outboundFailed: number
}

export async function readMailboxSidebarState(
  repoRoot: string,
  config: CrossProjectMailboxConfig,
  registry: MailboxSidebarRegistryPort,
): Promise<MailboxSidebarState | null> {
  if (!config.enabled) return null

  const senderDirs = await readSenderDirs(repoRoot)
  let inboundUnread = 0
  let inboundProcessed = 0
  for (const sender of senderDirs) {
    const senderPath = path.join(repoRoot, "coordination_notes", sender)
    inboundUnread += await countNotes(senderPath)
    inboundProcessed += await countNotes(path.join(senderPath, "processed"))
  }

  const { recentSent, recentSentCount } = await readRecentSent(repoRoot)
  const ack = resolveOutboundAck(repoRoot, recentSent, registry)

  return {
    inboundUnread,
    inboundProcessed,
    recentSentCount,
    recentSent: recentSent.slice(0, RECENT_SENT_LIMIT),
    outboundUnresolved: ack.outboundUnresolved,
    outboundRead: ack.outboundRead,
    outboundFailed: ack.outboundFailed,
  }
}

async function readSenderDirs(repoRoot: string): Promise<string[]> {
  const notesRoot = path.join(repoRoot, "coordination_notes")
  const entries = await readDirSafe(notesRoot)
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

async function countNotes(dir: string): Promise<number> {
  const entries = await readDirSafe(dir)
  return entries.filter(isNoteFile).length
}

function isNoteFile(entry: Dirent): boolean {
  if (!entry.isFile()) return false
  if (!entry.name.endsWith(NOTE_SUFFIX)) return false
  if (entry.name.startsWith(RESERVED_PREFIX)) return false
  return !entry.name.startsWith(".")
}

async function readDirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch (error) {
    // A missing directory is expected (no notes yet); record it for diagnostics
    // rather than swallowing silently.
    log("mailbox sidebar readdir failed", { error, dir })
    return []
  }
}

// Reads at most maxBytes from the END of a file without loading the whole file.
// The outbox log is newline-separated JSONL, so a truncated leading line is
// discarded by the caller's window slice + parse filter. Never throws.
function readLastBytes(filePath: string, maxBytes: number): string {
  let fd: number | null = null
  try {
    const size = statSync(filePath).size
    fd = openSync(filePath, "r")
    const length = Math.min(size, maxBytes)
    const offset = Math.max(0, size - maxBytes)
    const buf = Buffer.alloc(length)
    if (length > 0) readSync(fd, buf, 0, length, offset)
    return buf.toString("utf8")
  } catch (error) {
    log("mailbox sidebar outbox tail read failed", { error, filePath })
    return ""
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

async function readRecentSent(
  repoRoot: string,
): Promise<{ recentSent: OutboxEntry[]; recentSentCount: number }> {
  const raw = readLastBytes(outboxLogPath(repoRoot), OUTBOX_TAIL_BYTES)

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const windowed = lines.slice(-OUTBOX_ACK_WINDOW)
  const entries = windowed
    .map(parseOutboxLine)
    .filter((entry): entry is OutboxEntry => entry !== null)

  return { recentSent: entries.reverse(), recentSentCount: entries.length }
}

interface OutboundAckCounts {
  outboundUnresolved: number
  outboundRead: number
  outboundFailed: number
}

function resolveOutboundAck(
  repoRoot: string,
  windowedEntries: readonly OutboxEntry[],
  registry: MailboxSidebarRegistryPort,
): OutboundAckCounts {
  const senderProjectId = projectIdForRoot(repoRoot)
  let outboundUnresolved = 0
  let outboundRead = 0
  let outboundFailed = 0

  for (const entry of windowedEntries) {
    const targetRepoRoot = entry.toRepoRoot ?? registry.getRepoRootForProjectId(entry.toProjectId)
    if (targetRepoRoot === undefined) {
      outboundUnresolved += 1
      continue
    }
    const bucket = ackBucket(targetRepoRoot, senderProjectId, entry.messageId)
    if (bucket === "processed") outboundRead += 1
    else if (bucket === "rejected") outboundFailed += 1
    else outboundUnresolved += 1
  }

  return { outboundUnresolved, outboundRead, outboundFailed }
}

function ackBucket(
  targetRepoRoot: string,
  senderProjectId: string,
  messageId: string,
): "processed" | "rejected" | null {
  const base = path.join(targetRepoRoot, "coordination_notes", senderProjectId)
  const fileName = `${messageId}${NOTE_SUFFIX}`
  try {
    if (existsSync(path.join(base, "processed", fileName))) return "processed"
    if (existsSync(path.join(base, "rejected", fileName))) return "rejected"
  } catch (error) {
    log("mailbox sidebar ack stat failed", { error, messageId })
  }
  return null
}
