import { describe, expect, it } from "bun:test"

import type { MailboxSidebarState, ProjectPresenceRow } from "../cross-project-mailbox/sidebar"
import { computeView } from "./compute-view"
import type { ViewNode } from "./element-helpers"
import { buildMailboxNodes, buildOutboundBudgetNodes, buildViewNodes, describeView } from "./render-view"
import type { ComputeViewSections } from "./compute-view"
import type { OutboundBudgetRow } from "../cross-project-mailbox/visibility"
import type { SidebarView } from "./state-types"

function flattenText(nodes: readonly ViewNode[]): { text: string; props: Readonly<Record<string, unknown>> }[] {
  const out: { text: string; props: Readonly<Record<string, unknown>> }[] = []
  const walk = (node: ViewNode): void => {
    if (node.kind === "text" && node.text !== undefined) out.push({ text: node.text, props: node.props })
    for (const child of node.children ?? []) walk(child)
  }
  for (const node of nodes) walk(node)
  return out
}

function findMailboxHeaderRow(nodes: readonly ViewNode[]): ViewNode | undefined {
  let found: ViewNode | undefined
  const walk = (node: ViewNode): void => {
    if (found) return
    const hasMailboxText = (node.children ?? []).some(
      (child) => child.kind === "text" && (child.text ?? "").includes("Mailbox"),
    )
    if (node.kind === "box" && hasMailboxText) {
      found = node
      return
    }
    for (const child of node.children ?? []) walk(child)
  }
  for (const node of nodes) walk(node)
  return found
}

const mailboxState: MailboxSidebarState = {
  inboundUnread: 2,
  inboundProcessed: 5,
  recentSentCount: 1,
  recentSent: [],
  outboundUnresolved: 1,
  outboundRead: 3,
  outboundFailed: 0,
  projects: [],
}

const theme = {
  accent: "accent",
  borderSubtle: "border",
  error: "error",
  info: "info",
  success: "success",
  text: "text",
  textMuted: "muted",
  warning: "warning",
}

const activeSections: ComputeViewSections = {
  config: { kind: "invalid", messages: ["agents.sisyphus.model: expected string"] },
  roster: { kind: "empty" },
  agents: { kind: "list", agents: [{ name: "fixer", status: "busy" }] },
  jobs: { kind: "list", jobs: [{ title: "explore repo", status: "running", toolCalls: 3, lastTool: "grep" }] },
  loop: {
    kind: "live",
    goalsDone: 0,
    goalsTotal: 1,
    pass: 1,
    fail: 1,
    pending: 0,
    blocked: 0,
    activeGoal: "g1",
  },
}

describe("tui sidebar renderView", () => {
  it("#given active view #when building nodes #then it renders ULW agents jobs and invalid banner in order", () => {
    // given
    const view = computeView(activeSections)

    // when
    const description = describeView(view)
    const nodes = buildViewNodes(view, theme)

    // then
    expect(description).toContain("config invalid")
    expect(description.indexOf("ULW")).toBeLessThan(description.indexOf("Agents"))
    expect(description.indexOf("Agents")).toBeLessThan(description.indexOf("Jobs"))
    expect(description).toContain("0/1")
    expect(description).toContain("pass 1")
    expect(description).toContain("fail 1")
    expect(description).toContain("fixer")
    expect(description).toContain("explore repo")
    expect(nodes[0]?.kind).toBe("box")
  })

  it("#given a redacted active goal #when describing #then it reports the active goal as private", () => {
    // given
    const view = computeView({
      ...activeSections,
      loop: { ...activeSections.loop, activeGoal: null },
    })

    // when
    const description = describeView(view)

    // then
    expect(description).toContain("active private")
    expect(description).not.toContain("active none")
  })

  it("#given broken view #when describing #then it includes config invalid and run doctor", () => {
    // given
    const view = computeView({
      config: { kind: "invalid", messages: ["agents.sisyphus.model: expected string"] },
      roster: { kind: "empty" },
      agents: { kind: "none" },
      jobs: { kind: "none" },
      loop: { kind: "none" },
    })

    // when
    const description = describeView(view)

    // then
    expect(view.kind).toBe("broken")
    expect(description).toContain("config invalid")
    expect(description).toContain("run doctor")
    expect(description).toContain("agents.sisyphus.model")
  })

  it("#given idle roster #when rendering #then it lists configured model rows", () => {
    // given
    const view: SidebarView = {
      kind: "idle",
      roster: { kind: "rows", rows: [{ label: "sisyphus", model: "gpt-5.5" }] },
    }

    // when
    const description = describeView(view)
    const nodes = buildViewNodes(view, theme)

    // then
    expect(description).toContain("sisyphus")
    expect(description).toContain("gpt-5.5")
    expect(nodes[0]?.kind).toBe("box")
  })

  it("#given active view with mailbox #when building nodes #then it renders two-column label/count rows", () => {
    // given
    const view = computeView({ ...activeSections, mailbox: mailboxState })

    // when
    const nodes = buildMailboxNodes(view, theme)
    const texts = flattenText(nodes).map((entry) => entry.text)
    const description = describeView(view)

    // then
    expect(texts.some((value) => value.includes("Mailbox"))).toBe(true)
    expect(texts).toContain("In")
    expect(texts).toContain("Unread")
    expect(texts).toContain("Done")
    expect(texts).toContain("Out")
    expect(texts).toContain("Pending")
    expect(texts).toContain("Read")
    expect(texts).toContain("Failed")
    expect(description).toContain("Mailbox")
    expect(description).toContain("Unread 2")
    expect(description).toContain("Pending 1")
  })

  it("#given active populated mailbox #when building nodes #then labels and counts are separate two-column cells", () => {
    // given
    const view = computeView({ ...activeSections, mailbox: mailboxState })

    // when
    const texts = flattenText(buildMailboxNodes(view, theme)).map((entry) => entry.text)

    // then
    expect(texts).toEqual([
      "\u25bc Mailbox",
      "In", "Unread", "2", "Done", "5",
      "Out", "Pending", "1", "Read", "3", "Failed", "0",
      "Projects", "(0/0)", "No connected projects",
    ])
  })

  it("#given a populated mailbox #when building nodes #then each count row is a space-between row box", () => {
    // given
    const view = computeView({ ...activeSections, mailbox: mailboxState })

    // when
    const nodes = buildMailboxNodes(view, theme)
    const rowBoxes: ViewNode[] = []
    const walk = (node: ViewNode): void => {
      if (
        node.kind === "box" &&
        node.props.justifyContent === "space-between" &&
        node.props.marginTop !== 1
      ) rowBoxes.push(node)
      for (const child of node.children ?? []) walk(child)
    }
    for (const node of nodes) walk(node)

    // then: 5 count rows (Unread, Done, Pending, Read, Failed)
    expect(rowBoxes.length).toBe(5)
    for (const row of rowBoxes) {
      expect(row.props.flexDirection).toBe("row")
      expect(row.props.width).toBe("100%")
      expect(row.children?.length).toBe(2)
      expect(row.children?.[0]?.kind).toBe("text")
      expect(row.children?.[1]?.kind).toBe("text")
    }
  })

  it("#given an inbound-only mailbox #when building nodes #then it renders all three group headers with zero counts for empty groups", () => {
    // given
    const inboundOnly: MailboxSidebarState = {
      inboundUnread: 4,
      inboundProcessed: 1,
      recentSentCount: 0,
      recentSent: [],
      outboundUnresolved: 0,
      outboundRead: 0,
      outboundFailed: 0,
      projects: [],
    }
    const view = computeView({ ...activeSections, mailbox: inboundOnly })

    // when
    const texts = flattenText(buildMailboxNodes(view, theme)).map((entry) => entry.text)

    // then
    expect(texts).toEqual([
      "\u25bc Mailbox",
      "In", "Unread", "4", "Done", "1",
      "Out", "Pending", "0", "Read", "0", "Failed", "0",
      "Projects", "(0/0)", "No connected projects",
    ])
  })

  it("#given an outbound-fail mailbox #when building nodes #then the fail row shows its count with the error color", () => {
    // given
    const failMailbox: MailboxSidebarState = {
      inboundUnread: 0,
      inboundProcessed: 0,
      recentSentCount: 0,
      recentSent: [],
      outboundUnresolved: 0,
      outboundRead: 2,
      outboundFailed: 3,
      projects: [],
    }
    const view = computeView({ ...activeSections, mailbox: failMailbox })

    // when
    const entries = flattenText(buildMailboxNodes(view, theme))
    const texts = entries.map((entry) => entry.text)

    // then
    expect(texts).toEqual([
      "\u25bc Mailbox",
      "In", "Unread", "0", "Done", "0",
      "Out", "Pending", "0", "Read", "2", "Failed", "3",
      "Projects", "(0/0)", "No connected projects",
    ])
    const failIndex = texts.indexOf("Failed")
    const failCount = entries[failIndex + 1]
    expect(failCount?.text).toBe("3")
    expect(failCount?.props.fg).toBe("error")
  })

  it("#given idle view with mailbox #when building nodes #then it renders a Mailbox section after the model roster", () => {
    // given
    const view: SidebarView = {
      kind: "idle",
      roster: { kind: "rows", rows: [{ label: "sisyphus", model: "gpt-5.5" }] },
      mailbox: mailboxState,
    }

    // when
    const rosterTexts = flattenText(buildViewNodes(view, theme)).map((entry) => entry.text)
    const mailboxTexts = flattenText(buildMailboxNodes(view, theme)).map((entry) => entry.text)
    const description = describeView(view)

    // then
    expect(rosterTexts).toContain("sisyphus gpt-5.5")
    expect(mailboxTexts.some((value) => value.includes("Mailbox"))).toBe(true)
    expect(description.indexOf("sisyphus")).toBeLessThan(description.indexOf("Mailbox"))
  })

  it("#given a mailbox #when collapsed #then it renders the header only and omits the rows but keeps the toggle prop", () => {
    // given
    const view = computeView({ ...activeSections, mailbox: mailboxState })
    const onToggle = (): void => {}

    // when
    const collapsed = buildMailboxNodes(view, theme, { collapsed: true, onToggle })
    const expanded = buildMailboxNodes(view, theme, { collapsed: false, onToggle })
    const collapsedTexts = flattenText(collapsed)
    const expandedTexts = flattenText(expanded)

    // then
    expect(collapsedTexts.length).toBeLessThan(expandedTexts.length)
    expect(collapsedTexts.some((entry) => entry.text.includes("Mailbox"))).toBe(true)
    expect(collapsedTexts.some((entry) => entry.text.includes("Unread"))).toBe(false)
    const headerRow = findMailboxHeaderRow(collapsed)
    expect(headerRow?.props.onMouseDown).toBe(onToggle)
  })

  it("#given an expanded mailbox with a toggle #when building nodes #then the header row box carries onMouseDown", () => {
    // given
    const view = computeView({ ...activeSections, mailbox: mailboxState })
    const onToggle = (): void => {}

    // when
    const nodes = buildMailboxNodes(view, theme, { collapsed: false, onToggle })
    const headerRow = findMailboxHeaderRow(nodes)

    // then
    expect(headerRow?.props.onMouseDown).toBe(onToggle)
    expect(headerRow?.props.width).toBe("100%")
  })

  it("#given a collapsed mailbox with activity #when building nodes #then header shows In/Out/Projects summary line", () => {
    // given
    const view = computeView({ ...activeSections, mailbox: mailboxState })
    const onToggle = (): void => {}

    // when
    const collapsed = buildMailboxNodes(view, theme, { collapsed: true, onToggle })
    const collapsedTexts = flattenText(collapsed)

    // then: summary line present in collapsed view
    const summaryLine = collapsedTexts.find((entry) => entry.text.includes("in:"))
    expect(summaryLine).toBeDefined()
    expect(summaryLine?.text).toBe("in:2 out:1 Projects (0/0 active)")
    // rows not visible
    expect(collapsedTexts.some((entry) => entry.text.includes("Unread"))).toBe(false)
  })

  it("#given an all-zero mailbox #when collapsed #then it renders a single idle summary line", () => {
    // given
    const zeroMailbox: MailboxSidebarState = {
      inboundUnread: 0,
      inboundProcessed: 0,
      recentSentCount: 0,
      recentSent: [],
      outboundUnresolved: 0,
      outboundRead: 0,
      outboundFailed: 0,
      projects: [],
    }
    const view = computeView({ ...activeSections, mailbox: zeroMailbox })
    const onToggle = (): void => {}

    // when
    const collapsedTexts = flattenText(buildMailboxNodes(view, theme, { collapsed: true, onToggle })).map(
      (entry) => entry.text,
    )

    // then
    expect(collapsedTexts).toEqual(["\u25b6 Mailbox", "idle"])
  })

  it("#given an all-zero mailbox #when expanded #then it renders all three group headers with zero counts", () => {
    // given
    const zeroMailbox: MailboxSidebarState = {
      inboundUnread: 0,
      inboundProcessed: 0,
      recentSentCount: 0,
      recentSent: [],
      outboundUnresolved: 0,
      outboundRead: 0,
      outboundFailed: 0,
      projects: [],
    }
    const view = computeView({ ...activeSections, mailbox: zeroMailbox })

    // when
    const nodes = buildMailboxNodes(view, theme)
    const texts = flattenText(nodes).map((entry) => entry.text)

    // then
    expect(texts).toEqual([
      "\u25bc Mailbox",
      "In", "Unread", "0", "Done", "0",
      "Out", "Pending", "0", "Read", "0", "Failed", "0",
      "Projects", "(0/0)", "No connected projects",
    ])
  })

  it("#given active view without mailbox #when building nodes #then it renders no Mailbox section", () => {
    // given
    const view = computeView({ ...activeSections, mailbox: null })

    // when
    const mailboxTexts = flattenText(buildMailboxNodes(view, theme)).map((entry) => entry.text)
    const description = describeView(view)

    // then
    expect(mailboxTexts.some((value) => value.includes("Mailbox"))).toBe(false)
    expect(description).not.toContain("Mailbox")
  })

  it("#given a mailbox with projects #when expanded #then it renders Projects header and rows with dot-color layout", () => {
    // given
    const projectRows: ProjectPresenceRow[] = [
      { projectId: "proj-a", label: "Alpha", presence: "online", statusText: "~", dotColor: "success" },
      { projectId: "proj-b", label: "Beta", presence: "lastSeen", statusText: "5 minutes ago", dotColor: "muted" },
    ]
    const withProjects: MailboxSidebarState = { ...mailboxState, projects: projectRows }
    const view = computeView({ ...activeSections, mailbox: withProjects })

    // when
    const texts = flattenText(buildMailboxNodes(view, theme)).map((entry) => entry.text)

    // then
    expect(texts).toContain("Projects")
    expect(texts).toContain("(1/2)")
    expect(texts).toContain("Alpha")
    expect(texts).toContain("~")
    expect(texts).toContain("Beta")
    expect(texts).toContain("5 minutes ago")
  })

  it("#given no active projects #when expanded #then the project count uses the muted tone", () => {
    // given
    const projectRows: ProjectPresenceRow[] = [
      { projectId: "proj-a", label: "Alpha", presence: "pending", statusText: "pending", dotColor: "warning" },
      { projectId: "proj-b", label: "Beta", presence: "lastSeen", statusText: "5 minutes ago", dotColor: "muted" },
    ]
    const view = computeView({ ...activeSections, mailbox: { ...mailboxState, projects: projectRows } })

    // when
    const entries = flattenText(buildMailboxNodes(view, theme))

    // then
    const count = entries.find((entry) => entry.text === "(0/2)")
    expect(count?.props.fg).toBe("muted")
  })

  it("#given a mailbox with projects #when expanded #then each project row is a space-between box", () => {
    // given
    const projectRows: ProjectPresenceRow[] = [
      { projectId: "proj-a", label: "Alpha", presence: "online", statusText: "~", dotColor: "success" },
    ]
    const withProjects: MailboxSidebarState = { ...mailboxState, projects: projectRows }
    const view = computeView({ ...activeSections, mailbox: withProjects })

    // when
    const nodes = buildMailboxNodes(view, theme)
    const projectRowBoxes: ViewNode[] = []
    const walk = (node: ViewNode): void => {
      if (node.kind === "box" && node.props.justifyContent === "space-between") {
        const firstChild = node.children?.[0]
        if (firstChild?.kind === "box" && firstChild.props.flexDirection === "row") {
          const dotText = firstChild.children?.[0]
          if (dotText?.kind === "text" && dotText.text === "•") {
            projectRowBoxes.push(node)
          }
        }
      }
      for (const child of node.children ?? []) walk(child)
    }
    for (const node of nodes) walk(node)

    // then
    expect(projectRowBoxes.length).toBe(1)
    const row = projectRowBoxes[0]
    expect(row.props.flexDirection).toBe("row")
    expect(row.props.width).toBe("100%")
    expect(row.props.gap).toBe(1)
    expect(row.children?.length).toBe(2)
    const label = row.children?.[0]?.children?.[1]
    expect(label?.props.wrapMode).toBe("none")
    expect(label?.props.truncate).toBe(true)
  })

  it("#given a mailbox with projects #when collapsed #then summary includes Projects a/t active counter", () => {
    // given
    const projectRows: ProjectPresenceRow[] = [
      { projectId: "proj-a", label: "Alpha", presence: "online", statusText: "~", dotColor: "success" },
      { projectId: "proj-b", label: "Beta", presence: "lastSeen", statusText: "5 minutes ago", dotColor: "muted" },
    ]
    const withProjects: MailboxSidebarState = { ...mailboxState, projects: projectRows }
    const view = computeView({ ...activeSections, mailbox: withProjects })
    const onToggle = (): void => {}

    // when
    const collapsed = buildMailboxNodes(view, theme, { collapsed: true, onToggle })
    const collapsedTexts = flattenText(collapsed)

    // then
    const summaryLine = collapsedTexts.find((entry) => entry.text.includes("Projects"))
    expect(summaryLine).toBeDefined()
    expect(summaryLine?.text).toBe("in:2 out:1 Projects (1/2 active)")
  })

  it("#given a mailbox with projects #when describing #then the Projects section appears in text output", () => {
    // given
    const projectRows: ProjectPresenceRow[] = [
      { projectId: "proj-a", label: "Alpha", presence: "online", statusText: "~", dotColor: "success" },
    ]
    const withProjects: MailboxSidebarState = { ...mailboxState, projects: projectRows }
    const view = computeView({ ...activeSections, mailbox: withProjects })

    // when
    const description = describeView(view)

    // then
    expect(description).toContain("Projects")
    expect(description).toContain("Alpha ~")
  })

  it("#given a project with collision label #when rendering #then the full projectId is used as label", () => {
    // given
    const projectRows: ProjectPresenceRow[] = [
      { projectId: "proj-a-12345678", label: "proj-a-12345678", presence: "online", statusText: "~", dotColor: "success" },
      { projectId: "proj-a-abcdef01", label: "proj-a-abcdef01", presence: "online", statusText: "~", dotColor: "success" },
    ]
    const withProjects: MailboxSidebarState = { ...mailboxState, projects: projectRows }
    const view = computeView({ ...activeSections, mailbox: withProjects })

    // when
    const texts = flattenText(buildMailboxNodes(view, theme)).map((entry) => entry.text)

    // then
    expect(texts).toContain("proj-a-12345678")
    expect(texts).toContain("proj-a-abcdef01")
  })

  it("#given a mailbox with online projects #when collapsed #then active count reflects only online rows", () => {
    // given
    const projectRows: ProjectPresenceRow[] = [
      { projectId: "p1", label: "A", presence: "online", statusText: "~", dotColor: "success" },
      { projectId: "p2", label: "B", presence: "pending", statusText: "~", dotColor: "warning" },
      { projectId: "p3", label: "C", presence: "lastSeen", statusText: "1 hour ago", dotColor: "muted" },
    ]
    const withProjects: MailboxSidebarState = { ...mailboxState, projects: projectRows }
    const view = computeView({ ...activeSections, mailbox: withProjects })
    const onToggle = (): void => {}

    // when
    const collapsed = buildMailboxNodes(view, theme, { collapsed: true, onToggle })
    const collapsedTexts = flattenText(collapsed)

    // then
    const summaryLine = collapsedTexts.find((entry) => entry.text.includes("Projects"))
    expect(summaryLine?.text).toBe("in:2 out:1 Projects (1/3 active)")
  })

  it("#given a mailbox with projects #when building nodes #then no presence probe is executed during render", () => {
    // given
    let probeCalls = 0
    const projectRows: ProjectPresenceRow[] = [
      { projectId: "proj-a", label: "Alpha", presence: "online", statusText: "~", dotColor: "success" },
    ]
    const withProjects: MailboxSidebarState = { ...mailboxState, projects: projectRows }
    const view = computeView({ ...activeSections, mailbox: withProjects })

    // when
    flattenText(buildMailboxNodes(view, theme))

    // then
    expect(probeCalls).toBe(0)
  })
})

function budgetRow(overrides: Partial<OutboundBudgetRow>): OutboundBudgetRow {
  return {
    targetProjectId: "proj-1",
    displayName: "Project One",
    grantedCeiling: "quick",
    presence: "offline",
    ...overrides,
  }
}

describe("tui sidebar buildOutboundBudgetNodes", () => {
  it("#given a row whose presence is internal #when building nodes #then the doc-drop label renders in a two-column row", () => {
    // given
    const rows: OutboundBudgetRow[] = [budgetRow({ displayName: "Internal Peer", presence: "internal" })]

    // when
    const nodes = buildOutboundBudgetNodes(rows, theme)
    const entries = flattenText(nodes)
    const texts = entries.map((entry) => entry.text)

    // then
    expect(texts).toEqual(["Outbound", "Internal Peer", "internal (doc-drop)"])
    const statusEntry = entries.find((entry) => entry.text === "internal (doc-drop)")
    expect(statusEntry?.props.fg).toBe("info")
  })

  it("#given internal and non-internal rows #when building nodes #then each is a space-between row with label left and status right", () => {
    // given
    const rows: OutboundBudgetRow[] = [
      budgetRow({ displayName: "Live Peer", presence: "live" }),
      budgetRow({ displayName: "Internal Peer", presence: "internal" }),
    ]

    // when
    const nodes = buildOutboundBudgetNodes(rows, theme)
    const rowBoxes: ViewNode[] = []
    const walk = (node: ViewNode): void => {
      if (node.kind === "box" && node.props.justifyContent === "space-between") rowBoxes.push(node)
      for (const child of node.children ?? []) walk(child)
    }
    for (const node of nodes) walk(node)

    // then
    expect(rowBoxes.length).toBe(2)
    for (const row of rowBoxes) {
      expect(row.props.flexDirection).toBe("row")
      expect(row.props.width).toBe("100%")
      expect(row.children?.length).toBe(2)
      expect(row.children?.[0]?.kind).toBe("text")
      expect(row.children?.[1]?.kind).toBe("text")
    }
  })

  it("#given live stale offline and unknown rows #when building nodes #then each renders its own label unchanged", () => {
    // given
    const rows: OutboundBudgetRow[] = [
      budgetRow({ displayName: "L", presence: "live" }),
      budgetRow({ displayName: "S", presence: "stale" }),
      budgetRow({ displayName: "O", presence: "offline" }),
      budgetRow({ displayName: "U", presence: "unknown" }),
    ]

    // when
    const texts = flattenText(buildOutboundBudgetNodes(rows, theme)).map((entry) => entry.text)

    // then
    expect(texts).toEqual(["Outbound", "L", "live", "S", "stale", "O", "offline", "U", "unknown"])
  })

  it("#given no rows #when building nodes #then it renders nothing", () => {
    // given
    const rows: OutboundBudgetRow[] = []

    // when
    const nodes = buildOutboundBudgetNodes(rows, theme)

    // then
    expect(nodes).toEqual([])
  })
})
