import type { Dirent } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import type { CrossProjectMailboxConfig } from "../config"
import { outboxLogPath } from "../send-tool"
import type { OutboxEntry } from "../send-tool"

const NOTE_SUFFIX = ".md"
const RECENT_SENT_LIMIT = 3

export interface MailboxSidebarState {
  inboundUnread: number
  inboundProcessed: number
  recentSentCount: number
  recentSent: OutboxEntry[]
}

export async function readMailboxSidebarState(
  repoRoot: string,
  config: CrossProjectMailboxConfig,
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

  return { inboundUnread, inboundProcessed, recentSentCount, recentSent }
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
  return entry.isFile() && entry.name.endsWith(NOTE_SUFFIX) && !entry.name.startsWith(".")
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

  const entries = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseOutboxLine)
    .filter((entry): entry is OutboxEntry => entry !== null)

  const recentSent = entries.slice(-RECENT_SENT_LIMIT).reverse()
  return { recentSent, recentSentCount: entries.length }
}

function parseOutboxLine(line: string): OutboxEntry | null {
  try {
    return JSON.parse(line) as OutboxEntry
  } catch {
    return null
  }
}
