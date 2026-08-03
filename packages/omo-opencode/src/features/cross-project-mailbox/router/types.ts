import type { MailboxMode } from "../envelope/schema"

export type RoutePresence = "live" | "none"

export interface RouteContext {
  readonly presence: RoutePresence
  readonly inFlightLocalFlag?: boolean
}

export type RouteLane =
  | "triage"
  | "answer-local"
  | "answer-remote"
  | "todo-append"
  | "todo-next"
  | "subagent"
  | "worker-pr-local"
  | "worker-pr-cloudhome"
  | "interrupt"
  | "classify"

export interface RouteDecision {
  readonly lane: RouteLane
  readonly downgradeReason?: string
  readonly effectiveMode?: MailboxMode
}
