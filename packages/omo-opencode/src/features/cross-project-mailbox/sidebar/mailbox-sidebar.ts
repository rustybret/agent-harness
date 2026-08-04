import type { Dirent } from "node:fs"
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs"
import { readdir } from "node:fs/promises"
import path from "node:path"

import { isMissingPathError } from "@oh-my-opencode/utils"

import { log } from "../../../shared/logger"
import type { CrossProjectMailboxConfig } from "../config"
import { hasValidEnvelopeFrontmatter } from "../envelope/schema"
import { projectIdForRoot } from "../envelope/project-id"
import type { PresenceCache } from "../presence"
import type { ProjectEntry } from "../registry/types"
import { outboxLogPath, parseOutboxLine } from "../send-tool"
import { readProjectPresenceRows } from "./projects-presence"
import type { OutboxEntry } from "../send-tool"

const NOTE_SUFFIX = ".md"
const RESERVED_PREFIX = ".delivering-"
const RECENT_SENT_LIMIT = 3
const OUTBOX_ACK_WINDOW = 50
const OUTBOX_TAIL_BYTES = 64 * 1024
// An envelope frontmatter block is ~16 short scalar fields plus a hopPath array; 4 KiB is far more
// than any real note needs, and bounds the per-file read the sidebar does on every poll.
const NOTE_HEAD_BYTES = 4 * 1024

export interface MailboxSidebarRegistryPort {
  getRepoRootForProjectId(id: string): string | undefined
  listProjects?(): Promise<ProjectEntry[]>
}

export interface ProjectPresenceRow {
  projectId: string
  label: string
  presence: "online" | "pending" | "lastSeen"
  statusText: string
  dotColor: "success" | "warning" | "muted"
}

export interface MailboxSidebarState {
  inboundUnread: number
  inboundProcessed: number
  recentSentCount: number
  recentSent: OutboxEntry[]
  outboundUnresolved: number
  outboundRead: number
  outboundFailed: number
  projects: ProjectPresenceRow[]
}

export interface MailboxSidebarDeps {
  presenceCache?: PresenceCache
  projectEntries?: readonly ProjectEntry[]
  // Injected so tests can observe what the sidebar would report without reaching through the shared
  // logger singleton, which other test files replace wholesale via mock.module.
  reportError?: ErrorReporter
}

type ErrorReporter = (message: string, data?: unknown) => void

export function allowedSenderIds(config: CrossProjectMailboxConfig): string[] {
  const senders = config.senders ?? {}
  return Object.entries(senders)
    .filter(([, sender]) => sender.access === "allow")
    .map(([projectId]) => projectId)
}

export async function readMailboxSidebarState(
  repoRoot: string,
  config: CrossProjectMailboxConfig,
  registry: MailboxSidebarRegistryPort,
  deps?: MailboxSidebarDeps,
): Promise<MailboxSidebarState | null> {
  if (!config.enabled) return null

  const report = deps?.reportError ?? log
  const senderDirs = await readSenderDirs(repoRoot, report)
  let inboundUnread = 0
  let inboundProcessed = 0
  for (const sender of senderDirs) {
    const senderPath = path.join(repoRoot, "coordination_notes", sender)
    inboundUnread += await countNotes(senderPath, report)
    inboundProcessed += await countNotes(path.join(senderPath, "processed"), report)
  }

  const { recentSent, recentSentCount } = await readRecentSent(repoRoot, report)
  const ack = resolveOutboundAck(repoRoot, recentSent, registry, report)
  const projects = await readProjectPresenceRows(config, registry.listProjects?.bind(registry), deps)

  return {
    inboundUnread,
    inboundProcessed,
    recentSentCount,
    recentSent: recentSent.slice(0, RECENT_SENT_LIMIT),
    outboundUnresolved: ack.outboundUnresolved,
    outboundRead: ack.outboundRead,
    outboundFailed: ack.outboundFailed,
    projects,
  }
}

async function readSenderDirs(repoRoot: string, report: ErrorReporter): Promise<string[]> {
  const notesRoot = path.join(repoRoot, "coordination_notes")
  const entries = await readDirSafe(notesRoot, report)
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

async function countNotes(dir: string, report: ErrorReporter): Promise<number> {
  const entries = await readDirSafe(dir, report)
  return entries.filter((entry) => isNoteFile(path.join(dir, entry.name), entry, report)).length
}

// Must agree with MailboxStore.listUnread(): a file only counts as a note if the delivery path would
// actually hand it to an agent. Matching on the .md suffix alone let hand-authored legacy docs
// sitting in coordination_notes/<sender>/ inflate inboundUnread even though they are never delivered.
function isNoteFile(filePath: string, entry: Dirent, report: ErrorReporter): boolean {
  if (!entry.isFile()) return false
  if (!entry.name.endsWith(NOTE_SUFFIX)) return false
  if (entry.name.startsWith(RESERVED_PREFIX)) return false
  if (entry.name.startsWith(".")) return false
  return hasValidEnvelopeFrontmatter(readFirstBytes(filePath, NOTE_HEAD_BYTES, report))
}

// The sidebar polls every second across every registered project, and most of those directories are
// created lazily on first delivery. Treating "not there yet" as a failure logged one line per
// missing directory per poll, which grew to roughly half of the plugin log and evicted real
// diagnostics through rotation. Absence is an expected empty result; only real faults are logged.
async function readDirSafe(dir: string, report: ErrorReporter): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (!isMissingPathError(error)) report("mailbox sidebar readdir failed", { error, dir })
    return []
  }
}

function readFirstBytes(filePath: string, maxBytes: number, report: ErrorReporter): string {
  let fd: number | null = null
  try {
    fd = openSync(filePath, "r")
    const buf = Buffer.alloc(maxBytes)
    const bytesRead = readSync(fd, buf, 0, maxBytes, 0)
    return buf.toString("utf8", 0, bytesRead)
  } catch (error) {
    if (!isMissingPathError(error)) report("mailbox sidebar note head read failed", { error, filePath })
    return ""
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function readLastBytes(filePath: string, maxBytes: number, report: ErrorReporter): string {
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
    if (!isMissingPathError(error)) report("mailbox sidebar outbox tail read failed", { error, filePath })
    return ""
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

async function readRecentSent(
  repoRoot: string,
  report: ErrorReporter,
): Promise<{ recentSent: OutboxEntry[]; recentSentCount: number }> {
  const raw = readLastBytes(outboxLogPath(repoRoot), OUTBOX_TAIL_BYTES, report)

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
  report: ErrorReporter,
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
    const bucket = ackBucket(targetRepoRoot, senderProjectId, entry.messageId, report)
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
  report: ErrorReporter,
): "processed" | "rejected" | null {
  const base = path.join(targetRepoRoot, "coordination_notes", senderProjectId)
  const fileName = `${messageId}${NOTE_SUFFIX}`
  try {
    if (existsSync(path.join(base, "processed", fileName))) return "processed"
    if (existsSync(path.join(base, "rejected", fileName))) return "rejected"
  } catch (error) {
    report("mailbox sidebar ack stat failed", { error, messageId })
  }
  return null
}
