import type { MailboxSidebarState } from "../cross-project-mailbox/sidebar"
import { assertNever } from "./state-types"
import type {
  AgentsState,
  ConfigState,
  JobBoardState,
  LoopLive,
  LoopState,
  RosterState,
  SidebarView,
} from "./state-types"

export type ComputeViewSections = {
  readonly config: ConfigState
  readonly roster: RosterState
  readonly agents: AgentsState
  readonly jobs: JobBoardState
  readonly loop: LoopState
  readonly mailbox?: MailboxSidebarState | null
}

export function computeView(sections: ComputeViewSections): SidebarView {
  if (isActive(sections)) {
    return {
      kind: "active",
      loop: sections.loop,
      agents: sections.agents,
      jobs: sections.jobs,
      configBanner: sections.config.kind === "invalid" ? { kind: "invalid" } : { kind: "none" },
      ...(sections.mailbox === undefined ? {} : { mailbox: sections.mailbox }),
    }
  }

  if (sections.config.kind === "invalid") {
    return { kind: "broken", messages: sections.config.messages }
  }

  return {
    kind: "idle",
    roster: sections.roster,
    ...(sections.mailbox === undefined ? {} : { mailbox: sections.mailbox }),
  }
}

export function viewKey(view: SidebarView): string {
  switch (view.kind) {
    case "active":
      return stableKey([
        "active",
        loopKeyParts(view.loop),
        agentsKeyParts(view.agents),
        jobsKeyParts(view.jobs),
        ["configBanner", view.configBanner.kind],
        ["mailbox", stableMailboxKey(view.mailbox ?? null)],
      ])
    case "broken":
      return stableKey(["broken", [...view.messages]])
    case "idle":
      return stableKey([
        "idle",
        rosterKeyParts(view.roster),
        ["mailbox", stableMailboxKey(view.mailbox ?? null)],
      ])
    default:
      return assertNever(view)
  }
}

function isActive(sections: ComputeViewSections): boolean {
  return sections.agents.kind === "list" || sections.jobs.kind === "list" || sections.loop.kind === "live"
}

function stableKey(parts: readonly unknown[]): string {
  return JSON.stringify(parts)
}

function stableMailboxKey(mailbox: MailboxSidebarState | null): readonly unknown[] | null {
  return mailbox
    ? [
        mailbox.inboundUnread,
        mailbox.inboundProcessed,
        mailbox.recentSentCount,
        mailbox.outboundUnresolved,
        mailbox.outboundRead,
        mailbox.outboundFailed,
        mailbox.projects.map(p => [p.projectId, p.label, p.presence, p.statusText, p.dotColor]),
      ]
    : null
}

function rosterKeyParts(roster: RosterState): readonly unknown[] {
  switch (roster.kind) {
    case "empty":
      return ["roster", "empty"]
    case "rows":
      return ["roster", "rows", roster.rows.map((row) => [row.label, row.model])]
    default:
      return assertNever(roster)
  }
}

function agentsKeyParts(agents: AgentsState): readonly unknown[] {
  switch (agents.kind) {
    case "none":
      return ["agents", "none"]
    case "list":
      return ["agents", "list", agents.agents.map((agent) => [agent.name, agent.status])]
    default:
      return assertNever(agents)
  }
}

function jobsKeyParts(jobs: JobBoardState): readonly unknown[] {
  switch (jobs.kind) {
    case "none":
      return ["jobs", "none"]
    case "list":
      return [
        "jobs",
        "list",
        jobs.jobs.map((job) => [job.title, job.status, job.toolCalls, job.lastTool]),
      ]
    default:
      return assertNever(jobs)
  }
}

function loopKeyParts(loop: LoopState): readonly unknown[] {
  switch (loop.kind) {
    case "none":
      return ["loop", "none"]
    case "live":
      return ["loop", "live", liveLoopKeyParts(loop)]
    default:
      return assertNever(loop)
  }
}

function liveLoopKeyParts(loop: LoopLive): readonly unknown[] {
  return [
    loop.goalsDone,
    loop.goalsTotal,
    loop.pass,
    loop.fail,
    loop.pending,
    loop.blocked,
    loop.activeGoal,
  ]
}
