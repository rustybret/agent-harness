import type { CrossProjectMailboxConfig } from "../config"
import { createPresenceCache, lastSeenLabel, type PresenceCache } from "../presence"
import type { ProjectEntry } from "../registry/types"
import type { ProjectPresenceRow } from "./mailbox-sidebar"
import { allowedSenderIds } from "./mailbox-sidebar"

export interface ProjectPresenceDeps {
  presenceCache?: PresenceCache
  projectEntries?: readonly ProjectEntry[]
}

export async function readProjectPresenceRows(
  config: CrossProjectMailboxConfig,
  listProjects?: () => Promise<ProjectEntry[]>,
  deps?: ProjectPresenceDeps,
): Promise<ProjectPresenceRow[]> {
  const senderIds = allowedSenderIds(config)
  if (senderIds.length === 0) return []

  const listFn = listProjects
  const entries = deps?.projectEntries ?? (listFn ? await listFn() : [])
  const displayNameById = new Map((entries || []).map((e) => [e.projectId, e.displayName]))

  const bareNameCounts = new Map<string, number>()
  for (const id of senderIds) {
    const bare = displayNameById.get(id) || id.replace(/-[0-9a-f]{8}$/i, "")
    bareNameCounts.set(bare, (bareNameCounts.get(bare) ?? 0) + 1)
  }

  const cache = deps?.presenceCache ?? createPresenceCache()
  const rows: ProjectPresenceRow[] = []

  for (const projectId of senderIds) {
    const bare = displayNameById.get(projectId) || projectId.replace(/-[0-9a-f]{8}$/i, "")
    const isCollision = (bareNameCounts.get(bare) ?? 0) > 1
    const label = isCollision ? projectId : bare

    let presence: "online" | "pending" | "lastSeen"
    let statusText: string
    let dotColor: "success" | "warning" | "muted"

    try {
      const detail = await cache.get(projectId)
      if (detail.status === "live" || detail.status === "internal") {
        presence = "online"
        statusText = "online"
        dotColor = "success"
      } else if (detail.status === "stale") {
        presence = "pending"
        statusText = "~"
        dotColor = "warning"
      } else {
        presence = "lastSeen"
        const ageMs = detail.heartbeatTs ? Date.now() - detail.heartbeatTs : null
        statusText = lastSeenLabel(ageMs)
        dotColor = "muted"
      }
    } catch {
      presence = "lastSeen"
      statusText = "a long time ago"
      dotColor = "muted"
    }

    rows.push({ projectId, label, presence, statusText, dotColor })
  }

  // Sort rows alphabetically by label
  rows.sort((a, b) => a.label.localeCompare(b.label))

  return rows
}
