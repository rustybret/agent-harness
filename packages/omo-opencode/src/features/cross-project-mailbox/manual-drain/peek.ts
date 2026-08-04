import { evaluateDrainGate } from "../drain-gate"
import type { UnreadMessage } from "../mailbox/types"
import type { AutoDrainStatus, ManualMailboxToolDeps, PendingMailboxPreview } from "./types"

const BODY_PREVIEW_MAX = 200

export function preview(note: UnreadMessage): PendingMailboxPreview {
  return {
    fromProjectId: note.envelope.fromProjectId,
    messageId: note.messageId,
    timestamp: note.envelope.timestamp,
    intent: note.envelope.intent,
    bodyPreview: note.body.slice(0, BODY_PREVIEW_MAX),
  }
}

// Reports whether the idle drain would deliver anything right now, using the SAME gate the drain
// hook uses. Without this an agent seeing pending notes has no way to tell "the target has not
// idled yet" from "intake is gated shut and these will never arrive on their own".
async function autoDrainStatus(deps: ManualMailboxToolDeps, sessionId: string): Promise<AutoDrainStatus> {
  const config = deps.liveConfigResolver ? await deps.liveConfigResolver.resolve() : deps.config
  const primary = await deps.resolveActivePrimaryAgent?.(sessionId)
  const verdict = evaluateDrainGate(config, primary)
  if (verdict.allowed) return { enabled: true }
  return {
    enabled: false,
    reason: verdict.reason,
    detail: verdict.detail,
    ...(verdict.activePrimary === undefined ? {} : { activePrimary: verdict.activePrimary }),
  }
}

export async function runProjectMailboxPeek(
  deps: ManualMailboxToolDeps,
  sessionId = "manual-peek",
): Promise<{ pending: PendingMailboxPreview[]; autoDrain: AutoDrainStatus }> {
  const pending: PendingMailboxPreview[] = []
  for (const sender of await deps.getRegisteredProjects()) {
    const store = deps.makeMailboxStore(deps.repoRoot, sender.projectId)
    const notes = await store.drainUnread(Number.MAX_SAFE_INTEGER)
    pending.push(...notes.map(preview))
  }
  return { pending, autoDrain: await autoDrainStatus(deps, sessionId) }
}
