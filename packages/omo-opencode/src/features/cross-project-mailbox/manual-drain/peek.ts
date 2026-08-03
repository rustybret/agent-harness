import type { UnreadMessage } from "../mailbox/types"
import type { ManualMailboxToolDeps, PendingMailboxPreview } from "./types"

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

export async function runProjectMailboxPeek(deps: ManualMailboxToolDeps): Promise<{ pending: PendingMailboxPreview[] }> {
  const pending: PendingMailboxPreview[] = []
  for (const sender of await deps.getRegisteredProjects()) {
    const store = deps.makeMailboxStore(deps.repoRoot, sender.projectId)
    const notes = await store.drainUnread(Number.MAX_SAFE_INTEGER)
    pending.push(...notes.map(preview))
  }
  return { pending }
}
