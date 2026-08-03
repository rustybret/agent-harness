import type { CrossProjectMailboxConfig } from "../config"
import type { MailboxMessage } from "../envelope/schema"
import { launchTargetSession } from "../launch"
import { MailboxStore } from "../mailbox/mailbox-store"
import { readPresenceStatus, type PresenceStatus } from "../presence"
import type { ProjectEntry } from "../registry/types"

export async function defaultWriteNote(
  targetRepoRoot: string,
  fromProjectId: string,
  envelope: MailboxMessage,
  body: string,
  reservationTtlMs: number,
): Promise<void> {
  const store = new MailboxStore(targetRepoRoot, fromProjectId, { reservation_ttl_ms: reservationTtlMs })
  await store.writeNote(envelope, body)
}

export interface OfflineLaunchDeps {
  config: CrossProjectMailboxConfig
  readPresence?: (projectId: string) => Promise<PresenceStatus>
  launchTarget?: (repoRoot: string, projectId: string, policy: CrossProjectMailboxConfig["launch_policy"]) => Promise<boolean>
  launchPermissionAsk?: (target: string) => Promise<boolean>
}

export async function maybeLaunchOfflineTarget(
  targetEntry: ProjectEntry,
  deps: OfflineLaunchDeps,
): Promise<void> {
  const policy = deps.config.launch_policy
  if (policy === "disabled") return

  const readPresence = deps.readPresence ?? ((projectId: string) => readPresenceStatus(projectId))
  const status = await readPresence(targetEntry.projectId)
  if (status !== "offline") return

  const launch =
    deps.launchTarget ??
    ((repoRoot: string, projectId: string, launchPolicy: CrossProjectMailboxConfig["launch_policy"]) =>
      launchTargetSession(repoRoot, {
        policy: launchPolicy,
        projectId,
        launchPermissionAsk: deps.launchPermissionAsk,
      }))
  await launch(targetEntry.repoRoot, targetEntry.projectId, policy)
}
