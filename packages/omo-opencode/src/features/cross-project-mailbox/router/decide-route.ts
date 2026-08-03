import { decideDowngrade } from "../config"
import type { DowngradeDecision, SenderConfig } from "../config"
import type { MailboxMessage, MailboxMode } from "../envelope/schema"
import type { RouteContext, RouteDecision, RouteLane } from "./types"

type RouteNote = {
  readonly requested_mode?: MailboxMode
  readonly intent: MailboxMessage["intent"]
  readonly category?: string
}

function assertNever(value: never): never {
  throw new Error(`unhandled mailbox route mode: ${value}`)
}

function legacyLane(note: RouteNote): RouteLane {
  switch (note.intent) {
    case "question":
    case "plan":
      return "triage"
    case "quick":
    case "impl":
    case "review":
    case "work-loop":
      return note.category === undefined ? "classify" : "triage"
    default:
      return assertNever(note.intent)
  }
}

function legacyDecision(note: RouteNote, downgrade: DowngradeDecision): RouteDecision {
  const lane = legacyLane(note)
  if (downgrade.downgradeReason === undefined) {
    return { lane }
  }
  return { lane, downgradeReason: downgrade.downgradeReason }
}

function effectiveModeDecision(note: RouteNote, effectiveMode: MailboxMode, ctx: RouteContext): RouteDecision {
  switch (effectiveMode) {
    case "answer":
      if (ctx.presence === "live") {
        return { lane: "answer-local", effectiveMode }
      }
      if (ctx.inFlightLocalFlag === true && note.intent === "question") {
        return { lane: "triage", downgradeReason: "remote-unsafe-for-in-flight" }
      }
      return { lane: "answer-remote", effectiveMode }
    case "todo-append":
      return { lane: "todo-append", effectiveMode }
    case "todo-next":
      return { lane: "todo-next", effectiveMode }
    case "subagent":
      return { lane: "subagent", effectiveMode }
    case "worker-pr":
      // Pure router boundary: worker-pr defaults to the local worktree substrate. The
      // worker-pr-cloudhome variant is selected by task-11 contract plumbing upstream or
      // downstream, where declared variant metadata is available without adding I/O here.
      return { lane: "worker-pr-local", effectiveMode }
    case "interrupt":
      return { lane: "interrupt", effectiveMode }
    default:
      return assertNever(effectiveMode)
  }
}

export function decideRoute(note: RouteNote, senderCfg: SenderConfig, ctx: RouteContext): RouteDecision {
  const downgrade = decideDowngrade(note, senderCfg)
  if (downgrade.effectiveMode === undefined) {
    return legacyDecision(note, downgrade)
  }
  return effectiveModeDecision(note, downgrade.effectiveMode, ctx)
}
