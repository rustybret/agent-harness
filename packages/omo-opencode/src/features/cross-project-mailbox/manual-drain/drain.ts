import type { CrossProjectMailboxConfig } from "../config"
import { resolveRouteDecision, routeMetadata } from "../hooks/route-note-dispatcher"
import type { PendingEntry, UnreadMessage } from "../mailbox/types"
import type { RouteLane } from "../router"
import { reserveValidatedDelivery, rollbackReservedDelivery } from "./delivery-pipeline"
import { preview } from "./peek"
import type { DrainedMailboxNote, ManualMailboxToolDeps, SkippedMailboxNote } from "./types"

async function resolveFreshConfig(deps: ManualMailboxToolDeps): Promise<CrossProjectMailboxConfig> {
  if (deps.liveConfigResolver) {
    return deps.liveConfigResolver.resolve()
  }
  return deps.config
}

function guidanceFor(lane: RouteLane): string {
  switch (lane) {
    case "triage":
    case "classify":
      return "routed to legacy triage"
    case "answer-local":
      return "routed to answer-local lane"
    case "answer-remote":
      return "routed to answer-remote lane"
    case "todo-append":
      return "routed to todo-append lane"
    case "todo-next":
      return "routed to todo-next lane"
    case "subagent":
      return "routed to subagent lane"
    case "worker-pr-local":
      return "routed to worker-pr-local lane"
    case "worker-pr-cloudhome":
      return "routed to worker-pr-cloudhome lane"
    case "interrupt":
      return "routed to interrupt lane"
  }
}

async function drainedNote(
  deps: ManualMailboxToolDeps,
  config: CrossProjectMailboxConfig,
  note: UnreadMessage,
): Promise<DrainedMailboxNote> {
  const decision = await resolveRouteDecision({
    note,
    config,
    routeContext: { presence: "live", inFlightLocalFlag: false },
    classifyNote: deps.classifyNote,
  })
  return {
    ...preview(note),
    envelope: note.envelope,
    body: note.body,
    ...routeMetadata(note, decision),
    routeLane: decision.lane,
    guidance: guidanceFor(decision.lane),
  }
}

export async function runProjectMailboxDrain(deps: ManualMailboxToolDeps, sessionId = "manual-drain"): Promise<{
  drained: DrainedMailboxNote[]
  skipped: SkippedMailboxNote[]
}> {
  const config = await resolveFreshConfig(deps)
  if (config.enabled === false) return { drained: [], skipped: [{ messageId: "", reason: "mailbox disabled" }] }

  const maxNotes = config.bounds.max_notes_per_drain
  const digestStore = deps.makeDigestStore(deps.repoRoot)
  const rateLimiter = deps.makeRateLimiter(deps.repoRoot)
  const drained: DrainedMailboxNote[] = []
  const skipped: SkippedMailboxNote[] = []

  for (const sender of await deps.getRegisteredProjects()) {
    if (drained.length >= maxNotes) break
    const store = deps.makeMailboxStore(deps.repoRoot, sender.projectId)
    const notes = await store.drainUnread(maxNotes - drained.length)
    for (const note of notes) {
      if (drained.length >= maxNotes) break
      const reserved = await reserveValidatedDelivery({ deps, config, store, digestStore, rateLimiter, note })
      if (reserved.status !== "reserved") {
        if (reserved.status === "rejected") skipped.push({ messageId: note.messageId, reason: reserved.reason })
        continue
      }
      try {
        const routedNote = await drainedNote(deps, config, note)
        const pendingEntry: Omit<PendingEntry, "state"> = {
          messageId: note.messageId,
          sessionId,
          reservedPath: reserved.reservedPath,
          dispatchedAt: Date.now(),
          ...(routedNote.requestedMode === undefined ? {} : { requestedMode: routedNote.requestedMode }),
          ...(routedNote.effectiveMode === undefined ? {} : { effectiveMode: routedNote.effectiveMode }),
          ...(routedNote.downgradeReason === undefined ? {} : { downgradeReason: routedNote.downgradeReason }),
          lane: routedNote.routeLane,
        }
        await store.markDispatched(pendingEntry)
        await store.ack(note.messageId)
        drained.push(routedNote)
      } catch (error) {
        await rollbackReservedDelivery({
          store,
          digestStore,
          note,
          logPrefix: "[mailbox-manual-drain] delivery failure",
        })
        throw error
      }
    }
  }

  return { drained, skipped }
}
