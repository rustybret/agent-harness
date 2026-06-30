import { describe, expect, it } from "bun:test"

import { computeView, viewKey } from "./compute-view"
import type { MailboxSidebarState } from "../cross-project-mailbox/sidebar"
import type {
  AgentsState,
  ConfigState,
  JobBoardState,
  LoopState,
  RosterState,
  SidebarView,
} from "./state-types"

const validConfig: ConfigState = { kind: "valid" }
const invalidConfig: ConfigState = {
  kind: "invalid",
  messages: ["bad agent model", "unknown sidebar flag"],
}
const roster: RosterState = {
  kind: "rows",
  rows: [{ label: "sisyphus", model: "openai/gpt-5.5" }],
}
const idleAgents: AgentsState = { kind: "none" }
const idleJobs: JobBoardState = { kind: "none" }
const idleLoop: LoopState = { kind: "none" }
const activeAgents: AgentsState = {
  kind: "list",
  agents: [{ name: "sisyphus", status: "busy" }],
}
const activeJobs: JobBoardState = {
  kind: "list",
  jobs: [{ title: "Review patch", status: "running", toolCalls: 2, lastTool: "grep" }],
}
const liveLoop: LoopState = {
  kind: "live",
  goalsDone: 1,
  goalsTotal: 3,
  pass: 4,
  fail: 0,
  pending: 2,
  blocked: 1,
  activeGoal: "Ship sidebar",
}
const mailboxSection: MailboxSidebarState = {
  inboundUnread: 1,
  inboundProcessed: 0,
  recentSentCount: 2,
  recentSent: [
    {
      sentAt: 2,
      toProjectId: "proj-1",
      messageId: "msg-1",
      intent: "quick",
      correlationId: "corr-1",
      body: "hello",
    },
  ],
  outboundUnresolved: 0,
  outboundRead: 0,
  outboundFailed: 0,
}

describe("tui sidebar computeView", () => {
  it("#given inactive sections and valid config #when computing view #then it returns idle with roster and no banner", () => {
    // given
    const sections = {
      config: validConfig,
      roster,
      agents: idleAgents,
      jobs: idleJobs,
      loop: idleLoop,
    }

    // when
    const view = computeView(sections)

    // then
    expect(view).toEqual({ kind: "idle", roster })
    expect("configBanner" in view).toBe(false)
  })

  it("#given inactive sections and invalid config #when computing view #then it returns broken messages", () => {
    // given
    const sections = {
      config: invalidConfig,
      roster,
      agents: idleAgents,
      jobs: idleJobs,
      loop: idleLoop,
    }

    // when
    const view = computeView(sections)

    // then
    expect(view).toEqual({ kind: "broken", messages: ["bad agent model", "unknown sidebar flag"] })
  })

  it("#given active agents and valid config #when computing view #then active precedence wins with no banner", () => {
    // given
    const sections = {
      config: validConfig,
      roster,
      agents: activeAgents,
      jobs: idleJobs,
      loop: idleLoop,
    }

    // when
    const view = computeView(sections)

    // then
    expect(view).toEqual({
      kind: "active",
      loop: idleLoop,
      agents: activeAgents,
      jobs: idleJobs,
      configBanner: { kind: "none" },
    })
  })

  it("#given active jobs and invalid config #when computing view #then active precedence wins with invalid banner", () => {
    // given
    const sections = {
      config: invalidConfig,
      roster,
      agents: idleAgents,
      jobs: activeJobs,
      loop: idleLoop,
    }

    // when
    const view = computeView(sections)

    // then
    expect(view).toEqual({
      kind: "active",
      loop: idleLoop,
      agents: idleAgents,
      jobs: activeJobs,
      configBanner: { kind: "invalid" },
    })
  })

  it("#given only a live loop #when computing view #then loop activity also selects active", () => {
    // given
    const sections = {
      config: validConfig,
      roster,
      agents: idleAgents,
      jobs: idleJobs,
      loop: liveLoop,
    }

    // when
    const view = computeView(sections)

    // then
    expect(view).toEqual({
      kind: "active",
      loop: liveLoop,
      agents: idleAgents,
      jobs: idleJobs,
      configBanner: { kind: "none" },
    })
  })

  it("#given equivalent views built with different literal key order #when computing keys #then viewKey is stable", () => {
    // given
    const first: SidebarView = {
      kind: "active",
      loop: liveLoop,
      agents: activeAgents,
      jobs: activeJobs,
      configBanner: { kind: "invalid" },
    }
    const second: SidebarView = {
      configBanner: { kind: "invalid" },
      jobs: {
        jobs: [{ lastTool: "grep", toolCalls: 2, status: "running", title: "Review patch" }],
        kind: "list",
      },
      agents: { agents: [{ status: "busy", name: "sisyphus" }], kind: "list" },
      loop: {
        activeGoal: "Ship sidebar",
        blocked: 1,
        pending: 2,
        fail: 0,
        pass: 4,
        goalsTotal: 3,
        goalsDone: 1,
        kind: "live",
      },
      kind: "active",
    }

    // when
    const firstKey = viewKey(first)
    const secondKey = viewKey(second)

    // then
    expect(secondKey).toBe(firstKey)
  })

  it("#given a changed view value #when computing keys #then viewKey changes", () => {
    // given
    const original: SidebarView = { kind: "idle", roster }
    const changed: SidebarView = {
      kind: "idle",
      roster: { kind: "rows", rows: [{ label: "atlas", model: "openai/gpt-5.5" }] },
    }

    // when
    const originalKey = viewKey(original)
    const changedKey = viewKey(changed)

    // then
    expect(changedKey).not.toBe(originalKey)
  })

  it("#given active sections with an enabled mailbox section #when computing view #then the view carries the mailbox state", () => {
    // given
    const sections = {
      config: validConfig,
      roster,
      agents: activeAgents,
      jobs: idleJobs,
      loop: idleLoop,
      mailbox: mailboxSection,
    }

    // when
    const view = computeView(sections)

    // then
    expect(view.kind).toBe("active")
    if (view.kind === "active") {
      expect(view.mailbox).toEqual(mailboxSection)
    }
  })

  it("#given active sections with a null mailbox section #when computing view #then the view mailbox is null", () => {
    // given
    const sections = {
      config: validConfig,
      roster,
      agents: activeAgents,
      jobs: idleJobs,
      loop: idleLoop,
      mailbox: null,
    }

    // when
    const view = computeView(sections)

    // then
    expect(view.kind).toBe("active")
    if (view.kind === "active") {
      expect(view.mailbox ?? null).toBeNull()
    }
  })

  it("#given idle sections with an enabled mailbox section #when computing view #then the idle view carries the mailbox state", () => {
    // given
    const sections = {
      config: validConfig,
      roster,
      agents: idleAgents,
      jobs: idleJobs,
      loop: idleLoop,
      mailbox: mailboxSection,
    }

    // when
    const view = computeView(sections)

    // then
    expect(view.kind).toBe("idle")
    if (view.kind === "idle") {
      expect(view.mailbox).toEqual(mailboxSection)
    }
  })

  it("#given idle sections with a null mailbox section #when computing view #then the idle view mailbox is null", () => {
    // given
    const sections = {
      config: validConfig,
      roster,
      agents: idleAgents,
      jobs: idleJobs,
      loop: idleLoop,
      mailbox: null,
    }

    // when
    const view = computeView(sections)

    // then
    expect(view.kind).toBe("idle")
    if (view.kind === "idle") {
      expect(view.mailbox ?? null).toBeNull()
    }
  })

  it("#given two idle views differing only in mailbox outbound counts #when computing keys #then viewKey differs", () => {
    // given
    const first: SidebarView = {
      kind: "idle",
      roster,
      mailbox: { ...mailboxSection, outboundRead: 3 },
    }
    const second: SidebarView = {
      kind: "idle",
      roster,
      mailbox: { ...mailboxSection, outboundUnresolved: 3 },
    }

    // when
    const firstKey = viewKey(first)
    const secondKey = viewKey(second)

    // then
    expect(secondKey).not.toBe(firstKey)
  })

  it("#given two active views differing only in mailbox unread count #when computing keys #then viewKey differs", () => {
    // given
    const first: SidebarView = {
      kind: "active",
      loop: idleLoop,
      agents: activeAgents,
      jobs: idleJobs,
      configBanner: { kind: "none" },
      mailbox: { ...mailboxSection, inboundUnread: 1 },
    }
    const second: SidebarView = {
      kind: "active",
      loop: idleLoop,
      agents: activeAgents,
      jobs: idleJobs,
      configBanner: { kind: "none" },
      mailbox: { ...mailboxSection, inboundUnread: 2 },
    }

    // when
    const firstKey = viewKey(first)
    const secondKey = viewKey(second)

    // then
    expect(secondKey).not.toBe(firstKey)
  })
})
