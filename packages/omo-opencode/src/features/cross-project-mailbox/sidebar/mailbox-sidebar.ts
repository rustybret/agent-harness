import type { Dirent } from "node:fs"
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
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
  } catch {
    return []
  }
}

async function readRecentSent(
  repoRoot: string,
): Promise<{ recentSent: OutboxEntry[]; recentSentCount: number }> {
  let raw: string
  try {
    raw = await readFile(outboxLogPath(repoRoot), "utf8")
  } catch {
    return { recentSent: [], recentSentCount: 0 }
  }

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
