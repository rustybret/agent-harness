import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { log } from "../../../shared/logger"
import { projectIdForRoot } from "../envelope/project-id"
import type { QuarantineReason } from "../mailbox/types"
import { outboxLogPath, parseOutboxLine, type OutboxEntry } from "../send-tool/outbox-log"
import { readLastLines } from "./tail-lines"

const NOTE_SUFFIX = ".md"
const OUTBOX_TAIL_BYTES = 256 * 1024
const DEFAULT_WINDOW = 50
export const DEFAULT_STALE_AFTER_HOURS = 4

export type DeliveryOutcome = "processed" | "rejected" | "pending" | "stale" | "unresolved-target"

export interface DeliveryStatusRow {
  messageId: string
  toProjectId: string
  intent: string
  sentAt: number
  ageHours: number
  outcome: DeliveryOutcome
  /** Populated only for a rejected note, read from the target's quarantine reason file. */
  rejectionReason?: QuarantineReason | string
  rejectionDetail?: string
  bodyPreview: string
}

export interface DeliveryStatusSummary {
  processed: number
  rejected: number
  pending: number
  stale: number
  unresolvedTarget: number
}

export interface DeliveryStatusReport {
  summary: DeliveryStatusSummary
  /** Rows needing sender attention (rejected / stale / unresolved target), newest first. */
  needsAttention: DeliveryStatusRow[]
  rows: DeliveryStatusRow[]
  staleAfterHours: number
}

export interface DeliveryStatusRegistryPort {
  getRepoRootForProjectId(id: string): string | undefined
}

export interface ReadDeliveryStatusOptions {
  staleAfterHours?: number
  windowSize?: number
  now?: number
}

interface QuarantineReasonFile {
  reason?: string
  detail?: string
}

function readQuarantineReason(reasonPath: string): QuarantineReasonFile | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(reasonPath, "utf8"))
    return typeof parsed === "object" && parsed !== null ? (parsed as QuarantineReasonFile) : undefined
  } catch (error) {
    log("mailbox delivery status could not read quarantine reason", { error, reasonPath })
    return undefined
  }
}

interface AckLookup {
  bucket: "processed" | "rejected" | null
  reason?: QuarantineReasonFile
}

function resolveAck(targetRepoRoot: string, senderProjectId: string, messageId: string): AckLookup {
  const base = path.join(targetRepoRoot, "coordination_notes", senderProjectId)
  const fileName = `${messageId}${NOTE_SUFFIX}`
  try {
    if (existsSync(path.join(base, "processed", fileName))) return { bucket: "processed" }
    if (existsSync(path.join(base, "rejected", fileName))) {
      const reasonPath = path.join(base, "rejected", `${messageId}.reason.json`)
      const reason = existsSync(reasonPath) ? readQuarantineReason(reasonPath) : undefined
      return reason === undefined ? { bucket: "rejected" } : { bucket: "rejected", reason }
    }
  } catch (error) {
    log("mailbox delivery status ack lookup failed", { error, messageId })
  }
  return { bucket: null }
}

function rowFor(
  entry: OutboxEntry,
  senderProjectId: string,
  registry: DeliveryStatusRegistryPort,
  now: number,
  staleAfterMs: number,
): DeliveryStatusRow {
  const ageMs = Math.max(0, now - entry.sentAt)
  const base = {
    messageId: entry.messageId,
    toProjectId: entry.toProjectId,
    intent: entry.intent,
    sentAt: entry.sentAt,
    ageHours: Math.round((ageMs / 3_600_000) * 10) / 10,
    bodyPreview: entry.body,
  }

  const targetRepoRoot = entry.toRepoRoot ?? registry.getRepoRootForProjectId(entry.toProjectId)
  if (targetRepoRoot === undefined) return { ...base, outcome: "unresolved-target" }

  const ack = resolveAck(targetRepoRoot, senderProjectId, entry.messageId)
  if (ack.bucket === "processed") return { ...base, outcome: "processed" }
  if (ack.bucket === "rejected") {
    return {
      ...base,
      outcome: "rejected",
      ...(ack.reason?.reason === undefined ? {} : { rejectionReason: ack.reason.reason }),
      ...(ack.reason?.detail === undefined || ack.reason.detail === ""
        ? {}
        : { rejectionDetail: ack.reason.detail }),
    }
  }

  return { ...base, outcome: ageMs >= staleAfterMs ? "stale" : "pending" }
}

/**
 * Answers the two questions a sender cannot currently ask: "was my note rejected, and why?" and
 * "is anything still undelivered after N hours?".
 *
 * A hard reject quarantines the note on the RECEIVER side (`rejected/<id>.md` plus a
 * `<id>.reason.json`) and writes nothing back to the sender, so a send that never lands looks
 * identical to one still waiting for the target to idle. This reads the sender's own outbox log and
 * resolves each entry against the target's acknowledgement directories, surfacing the receiver's
 * recorded reason and ageing anything unacknowledged past the threshold into "stale".
 *
 * Read-only: it never writes to either side, so calling it cannot perturb delivery.
 */
export function readDeliveryStatus(
  repoRoot: string,
  registry: DeliveryStatusRegistryPort,
  options: ReadDeliveryStatusOptions = {},
): DeliveryStatusReport {
  const now = options.now ?? Date.now()
  const staleAfterHours = options.staleAfterHours ?? DEFAULT_STALE_AFTER_HOURS
  const staleAfterMs = staleAfterHours * 3_600_000
  const windowSize = options.windowSize ?? DEFAULT_WINDOW
  const senderProjectId = projectIdForRoot(repoRoot)

  const entries = readLastLines(outboxLogPath(repoRoot), OUTBOX_TAIL_BYTES)
    .slice(-windowSize)
    .map(parseOutboxLine)
    .filter((entry): entry is OutboxEntry => entry !== null)

  const rows = entries
    .map((entry) => rowFor(entry, senderProjectId, registry, now, staleAfterMs))
    .reverse()

  const summary: DeliveryStatusSummary = {
    processed: rows.filter((row) => row.outcome === "processed").length,
    rejected: rows.filter((row) => row.outcome === "rejected").length,
    pending: rows.filter((row) => row.outcome === "pending").length,
    stale: rows.filter((row) => row.outcome === "stale").length,
    unresolvedTarget: rows.filter((row) => row.outcome === "unresolved-target").length,
  }

  return {
    summary,
    needsAttention: rows.filter(
      (row) => row.outcome === "rejected" || row.outcome === "stale" || row.outcome === "unresolved-target",
    ),
    rows,
    staleAfterHours,
  }
}

export function renderDeliveryStatus(report: DeliveryStatusReport): string {
  const { summary } = report
  const lines = [
    `**Cross-project delivery status** (${summary.processed} processed, ${summary.rejected} rejected, ` +
      `${summary.pending} pending, ${summary.stale} stale >${report.staleAfterHours}h, ` +
      `${summary.unresolvedTarget} unresolved target)`,
  ]

  if (report.needsAttention.length === 0) {
    lines.push("", "Nothing needs attention: every recent send is processed or still within the wait window.")
    return lines.join("\n")
  }

  lines.push("", "| Message | Target | Intent | Age (h) | Outcome | Why |", "| --- | --- | --- | --- | --- | --- |")
  for (const row of report.needsAttention) {
    const why = row.outcome === "rejected"
      ? [row.rejectionReason ?? "rejected", row.rejectionDetail].filter(Boolean).join(": ")
      : row.outcome === "unresolved-target"
        ? "target repo root not resolvable from this machine"
        : "no acknowledgement from the target yet"
    lines.push(
      `| ${row.messageId} | ${row.toProjectId} | ${row.intent} | ${row.ageHours} | ${row.outcome} | ${why} |`,
    )
  }
  return lines.join("\n")
}
