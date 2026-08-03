import type { ClassifierDeps } from "./classifier"
import { classifyNote } from "./classifier"
import type { UnreadMessage } from "../mailbox/types"
import type { ClassifyNoteDeps } from "../hooks/route-note-dispatcher"
import type { RouteDecision } from "./types"
import { decideRoute } from "./decide-route"

export function createProductionClassifyNote(
  classifierDeps: ClassifierDeps
): (note: UnreadMessage, deps: ClassifyNoteDeps) => Promise<RouteDecision> {
  return async (note, deps) => {
    try {
      const result = await classifyNote(note, classifierDeps)
      if (result.mode !== undefined) {
        const clonedEnvelope = {
          ...note.envelope,
          requested_mode: result.mode,
        }
        const decision = decideRoute(clonedEnvelope, deps.senderConfig, deps.routeContext)
        if (decision.lane === "classify") {
          return {
            ...decision,
            lane: "triage",
          }
        }
        return decision
      }
      const reason = "reason" in result ? result.reason : "classifier-unavailable"
      return {
        lane: "triage",
        downgradeReason: reason,
      }
    } catch (error) {
      return {
        lane: "triage",
        downgradeReason: "classifier-error",
      }
    }
  }
}
