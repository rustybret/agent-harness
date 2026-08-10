import type { Dirent } from "node:fs"
import { randomUUID } from "node:crypto"
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import { parseEnvelope, serializeEnvelope } from "../envelope/schema"
import type { MailboxMessage } from "../envelope/schema"
import { assertPathWithinRoot, safeMessageIdFilename } from "../envelope/path-guard"
import { PendingDeliveryStore } from "./pending-delivery-store"
import { DeliveryAttemptsStore } from "./delivery-attempts-store"
import type { MailboxDir, PendingEntry, QuarantineReason, UnreadMessage } from "./types"

const RESERVED_PREFIX = ".delivering-"
const NOTE_SUFFIX = ".md"

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
}

function isUnreadNoteFile(entry: Dirent): boolean {
  return entry.isFile() && entry.name.endsWith(NOTE_SUFFIX) && !entry.name.startsWith(".")
}

export class MailboxStore {
  private readonly pendingStore: PendingDeliveryStore
  private readonly attemptsStore: DeliveryAttemptsStore

  constructor(
    private readonly targetRepoRoot: string,
    private readonly fromProjectId: string,
    private readonly config: { reservation_ttl_ms: number },
  ) {
    this.pendingStore = new PendingDeliveryStore(this.targetRepoRoot)
    this.attemptsStore = new DeliveryAttemptsStore(this.targetRepoRoot)
  }

  async getAttempts(messageId: string): Promise<number> {
    return this.attemptsStore.getAttempts(messageId)
  }

  async incrementAttempts(messageId: string): Promise<number> {
    return this.attemptsStore.incrementAttempts(messageId)
  }

  async clearAttempts(messageId: string): Promise<void> {
    await this.attemptsStore.clearAttempts(messageId)
  }

  async markDispatched(entry: Omit<PendingEntry, "state">): Promise<void> {
    await this.pendingStore.addDispatchSent(entry)
  }

  private dirs(): MailboxDir {
    const inbox = path.join(this.targetRepoRoot, "coordination_notes", this.fromProjectId)
    return { inbox, processed: path.join(inbox, "processed"), rejected: path.join(inbox, "rejected") }
  }

  private guard(candidate: string): void {
    assertPathWithinRoot(this.targetRepoRoot, candidate)
  }

  async writeNote(envelope: MailboxMessage, body: string): Promise<void> {
    const { inbox } = this.dirs()
    await mkdir(inbox, { recursive: true, mode: 0o700 })
    const fileName = safeMessageIdFilename(envelope.messageId)
    const targetPath = path.join(inbox, fileName)
    this.guard(targetPath)
    const tmpPath = path.join(inbox, `.tmp-note-${randomUUID()}.md`)
    this.guard(tmpPath)
    const serialized = serializeEnvelope(envelope, body)
    try {
      const fileHandle = await open(tmpPath, "wx")
      try {
        await fileHandle.writeFile(serialized)
      } finally {
        await fileHandle.close()
      }
      await rename(tmpPath, targetPath)
    } catch (error) {
      await rm(tmpPath, { force: true })
      throw error
    }
  }

  async parseNote(filePath: string): Promise<{ envelope: MailboxMessage; body: string }> {
    this.guard(filePath)
    const fileContent = await readFile(filePath, "utf8")
    return parseEnvelope(fileContent)
  }

  async listUnread(): Promise<UnreadMessage[]> {
    const { inbox } = this.dirs()
    let entries: Dirent[]
    try {
      entries = await readdir(inbox, { withFileTypes: true })
    } catch (error) {
      if (isMissingPathError(error)) return []
      throw error
    }

    const notes: UnreadMessage[] = []
    for (const entry of entries) {
      if (!isUnreadNoteFile(entry)) continue
      const filePath = path.join(inbox, entry.name)
      try {
        const parsed = await this.parseNote(filePath)
        notes.push({ messageId: parsed.envelope.messageId, filePath, envelope: parsed.envelope, body: parsed.body })
      } catch {
        continue
      }
    }
    return notes.sort((left, right) => left.envelope.timestamp - right.envelope.timestamp)
  }

  async reserve(messageId: string): Promise<string | undefined> {
    const { inbox } = this.dirs()
    const fileName = safeMessageIdFilename(messageId)
    const inboxPath = path.join(inbox, fileName)
    const reservedPath = path.join(inbox, `${RESERVED_PREFIX}${messageId}${NOTE_SUFFIX}`)
    this.guard(inboxPath)
    this.guard(reservedPath)
    try {
      await rename(inboxPath, reservedPath)
      return reservedPath
    } catch (error) {
      if (isMissingPathError(error)) return undefined
      throw error
    }
  }

  async ack(messageId: string): Promise<void> {
    const { inbox, processed } = this.dirs()
    await mkdir(processed, { recursive: true, mode: 0o700 })
    const fileName = safeMessageIdFilename(messageId)
    const targetPath = path.join(processed, fileName)
    this.guard(targetPath)
    const sourcePaths = [
      path.join(inbox, `${RESERVED_PREFIX}${messageId}${NOTE_SUFFIX}`),
      path.join(inbox, fileName),
    ]
    for (const sourcePath of sourcePaths) {
      this.guard(sourcePath)
      try {
        await rename(sourcePath, targetPath)
        await this.attemptsStore.clearAttempts(messageId)
        return
      } catch (error) {
        if (isMissingPathError(error)) continue
        throw error
      }
    }
  }

  async quarantine(messageId: string, reason: QuarantineReason, detail = ""): Promise<void> {
    const { inbox, rejected } = this.dirs()
    await mkdir(rejected, { recursive: true, mode: 0o700 })
    const fileName = safeMessageIdFilename(messageId)
    const targetPath = path.join(rejected, fileName)
    this.guard(targetPath)
    const sourcePaths = [
      path.join(inbox, fileName),
      path.join(inbox, `${RESERVED_PREFIX}${messageId}${NOTE_SUFFIX}`),
    ]
    for (const sourcePath of sourcePaths) {
      this.guard(sourcePath)
      try {
        await rename(sourcePath, targetPath)
        break
      } catch (error) {
        if (isMissingPathError(error)) continue
        throw error
      }
    }
    await this.attemptsStore.clearAttempts(messageId)
    const reasonPath = path.join(rejected, `${messageId}.reason.json`)
    this.guard(reasonPath)
    await writeFile(reasonPath, `${JSON.stringify({ reason, detail, at: new Date().toISOString() }, null, 2)}\n`)
  }

  /**
   * Whether a message has already been handed to the receiver, i.e. acked into `processed/`.
   *
   * Used to tell the two supersession cases apart: superseding a note still sitting unread is a
   * silent replacement, while superseding one already consumed is a correction the receiver has to
   * be told about.
   */
  private async wasDelivered(messageId: string): Promise<boolean> {
    const { processed } = this.dirs()
    const candidate = path.join(processed, safeMessageIdFilename(messageId))
    this.guard(candidate)
    try {
      await stat(candidate)
      return true
    } catch (error) {
      if (isMissingPathError(error)) return false
      throw error
    }
  }

  async drainUnread(maxNotes: number): Promise<UnreadMessage[]> {
    const unread = await this.listUnread()
    const supersededIds = new Set(
      unread
        .map((message) => message.envelope.supersedes)
        .filter((value): value is string => value !== null),
    )
    const latest = unread.filter((message) => !supersededIds.has(message.messageId))
    latest.sort(
      (left, right) =>
        right.envelope.priority - left.envelope.priority ||
        left.envelope.timestamp - right.envelope.timestamp,
    )
    const selected = latest.slice(0, maxNotes)
    const stillUnread = new Set(unread.map((message) => message.messageId))
    return Promise.all(
      selected.map(async (message) => {
        const supersedes = message.envelope.supersedes
        if (supersedes === null || stillUnread.has(supersedes)) return message
        if (!(await this.wasDelivered(supersedes))) return message
        return { ...message, supersedesDelivered: true }
      }),
    )
  }

  /**
   * Returns the ids of notes that were put BACK into the inbox for another attempt, as opposed to
   * the ones reclaim acked because delivery turned out to have succeeded.
   *
   * The caller needs this distinction: a returned note already recorded a body digest on its failed
   * attempt, and that digest outlives the reservation by a wide margin (60 min vs 2 min by default),
   * so unless the digest is released too the retry is quarantined as a duplicate of itself.
   */
  async reclaimStale(sessionMessageIds: Set<string>): Promise<string[]> {
    const { inbox } = this.dirs()
    const cutoff = Date.now() - this.config.reservation_ttl_ms
    let entries: Dirent[]
    try {
      entries = await readdir(inbox, { withFileTypes: true })
    } catch (error) {
      if (isMissingPathError(error)) return []
      throw error
    }

    const returnedToUnread: string[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.startsWith(RESERVED_PREFIX) || !entry.name.endsWith(NOTE_SUFFIX)) continue
      const filePath = path.join(inbox, entry.name)
      const fileStat = await stat(filePath)
      if (fileStat.mtimeMs > cutoff) continue
      const messageId = entry.name.slice(RESERVED_PREFIX.length, -NOTE_SUFFIX.length)
      if (await this.reclaimOne(messageId, this.pendingStore, sessionMessageIds)) {
        returnedToUnread.push(messageId)
      }
    }
    return returnedToUnread
  }

  /** Resolves true when the note was returned to the inbox for a retry rather than acked. */
  private async reclaimOne(
    messageId: string,
    pending: PendingDeliveryStore,
    sessionMessageIds: Set<string>,
  ): Promise<boolean> {
    const entry = await pending.getEntry(messageId)
    if (entry?.state === "history_confirmed") {
      await this.ack(messageId)
      return false
    }
    if (entry?.state === "dispatch_sent" && sessionMessageIds.has(messageId)) {
      await pending.markHistoryConfirmed(messageId)
      await this.ack(messageId)
      return false
    }
    await this.returnToUnread(messageId)
    if (entry !== undefined) {
      await pending.removeEntry(messageId)
    }
    return true
  }

  async unreserve(messageId: string): Promise<void> {
    await this.returnToUnread(messageId)
  }

  private async returnToUnread(messageId: string): Promise<void> {
    const { inbox } = this.dirs()
    const reservedPath = path.join(inbox, `${RESERVED_PREFIX}${messageId}${NOTE_SUFFIX}`)
    const inboxPath = path.join(inbox, safeMessageIdFilename(messageId))
    this.guard(reservedPath)
    this.guard(inboxPath)
    try {
      await rename(reservedPath, inboxPath)
    } catch (error) {
      if (isMissingPathError(error)) return
      throw error
    }
  }
}
