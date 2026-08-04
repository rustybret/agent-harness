import { createHash } from "node:crypto"

import type { CrossProjectMailboxConfig } from "../config"
import type { PresenceStatus } from "../presence"
import type { ProjectEntry } from "../registry/types"

export type OutboundBudgetPresence = PresenceStatus | "unknown"

export function presenceLabel(presence: OutboundBudgetPresence): string {
  return presence === "internal" ? "internal (doc-drop)" : presence
}

export interface OutboundBudgetRow {
  targetProjectId: string
  displayName: string
  grantedCeiling: string
  presence: OutboundBudgetPresence
}

export interface OutboundBudgetRegistryPort {
  listProjects(): Promise<ProjectEntry[]>
}

export const OUTBOUND_BUDGET_MAX_TARGETS = 20

export interface ReadOutboundBudgetDeps {
  readPresence: (projectId: string) => Promise<PresenceStatus>
  maxTargets?: number
}

function allowedSenderIds(config: CrossProjectMailboxConfig): string[] {
  const senders = config.senders ?? {}
  return Object.entries(senders)
    .filter(([, sender]) => sender.access === "allow")
    .map(([projectId]) => projectId)
}

async function resolvePresence(
  projectId: string,
  readPresence: (projectId: string) => Promise<PresenceStatus>,
): Promise<OutboundBudgetPresence> {
  try {
    return await readPresence(projectId)
  } catch {
    return "unknown"
  }
}

export async function readOutboundBudget(
  config: CrossProjectMailboxConfig,
  registry: OutboundBudgetRegistryPort,
  deps: ReadOutboundBudgetDeps,
): Promise<OutboundBudgetRow[]> {
  const maxTargets = deps.maxTargets ?? OUTBOUND_BUDGET_MAX_TARGETS
  const senderIds = allowedSenderIds(config).slice(0, maxTargets)
  if (senderIds.length === 0) return []

  const projects = await registry.listProjects()
  const displayNameById = new Map(projects.map((entry) => [entry.projectId, entry.displayName]))

  // Presence resolution is a per-target network probe with its own timeout, so these MUST run
  // concurrently: serially, one unresponsive target delays every target behind it, and the cost is
  // the SUM of the timeouts rather than the worst single one. This runs on the chat turn path.
  const targets = senderIds.flatMap((projectId) => {
    const sender = config.senders?.[projectId]
    return sender === undefined ? [] : [{ projectId, sender }]
  })
  return await Promise.all(
    targets.map(async ({ projectId, sender }) => ({
      targetProjectId: projectId,
      displayName: displayNameById.get(projectId) ?? projectId,
      grantedCeiling: sender.intent_budget,
      presence: await resolvePresence(projectId, deps.readPresence),
    })),
  )
}

export function renderOutboundBudgetTable(rows: readonly OutboundBudgetRow[]): string {
  const header =
    "**Cross-project outbound budget (ADVISORY - target-side inbound validation remains authoritative)**"
  const lines = [
    header,
    "",
    "| Target | Project ID | Granted ceiling | Presence |",
    "| --- | --- | --- | --- |",
  ]
  for (const row of rows) {
    lines.push(
      `| ${row.displayName} | ${row.targetProjectId} | ${row.grantedCeiling} | ${presenceLabel(row.presence)} |`,
    )
  }
  return lines.join("\n")
}

export function hashOutboundBudget(rows: readonly OutboundBudgetRow[]): string {
  const canonical = rows.map((row) => ({
    targetProjectId: row.targetProjectId,
    displayName: row.displayName,
    grantedCeiling: row.grantedCeiling,
    presence: row.presence,
  }))
  return createHash("sha1").update(JSON.stringify(canonical)).digest("hex")
}

export interface OutboundBudgetInjectionDecision {
  inject: boolean
  text?: string
}

export function selectOutboundBudgetInjection(
  sessionId: string,
  rows: readonly OutboundBudgetRow[],
  lastInjectedHashBySession: Map<string, string>,
): OutboundBudgetInjectionDecision {
  if (rows.length === 0) return { inject: false }

  const hash = hashOutboundBudget(rows)
  if (lastInjectedHashBySession.get(sessionId) === hash) {
    return { inject: false }
  }
  lastInjectedHashBySession.set(sessionId, hash)
  return { inject: true, text: renderOutboundBudgetTable(rows) }
}
