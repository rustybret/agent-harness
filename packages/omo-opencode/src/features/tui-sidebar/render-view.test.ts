import { describe, expect, it } from "bun:test"

import type { MailboxSidebarState } from "../cross-project-mailbox/sidebar"
import { computeView } from "./compute-view"
import type { ViewNode } from "./element-helpers"
import { buildMailboxNodes, buildViewNodes, describeView } from "./render-view"
import type { ComputeViewSections } from "./compute-view"
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

const mailboxState: MailboxSidebarState = {
  inboundUnread: 2,
  inboundProcessed: 5,
  recentSentCount: 1,
  recentSent: [],
  outboundUnresolved: 1,
  outboundRead: 3,
  outboundFailed: 0,
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

  it("#given active view with mailbox #when building nodes #then it renders a Mailbox section with inbox and outbox rows", () => {
    // given
    const view = computeView({ ...activeSections, mailbox: mailboxState })

    // when
    const nodes = buildMailboxNodes(view, theme)
    const texts = flattenText(nodes).map((entry) => entry.text)
    const description = describeView(view)

    // then
    expect(texts.some((value) => value.startsWith("Mailbox"))).toBe(true)
    expect(texts.some((value) => value.includes("in 2 unread 5 done"))).toBe(true)
    expect(texts.some((value) => value.includes("out 1 pending 3 read 0 fail"))).toBe(true)
    expect(description).toContain("Mailbox")
    expect(description).toContain("in 2 unread 5 done")
    expect(description).toContain("out 1 pending 3 read 0 fail")
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
    expect(mailboxTexts.some((value) => value.startsWith("Mailbox"))).toBe(true)
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
    expect(collapsedTexts.some((entry) => entry.text.startsWith("Mailbox"))).toBe(true)
    expect(collapsedTexts.some((entry) => entry.text.includes("in 2 unread"))).toBe(false)
    const header = collapsedTexts.find((entry) => entry.text.startsWith("Mailbox"))
    expect(header?.props.onMouseDown).toBe(onToggle)
  })

  it("#given an expanded mailbox with a toggle #when building nodes #then the header carries onMouseDown", () => {
    // given
    const view = computeView({ ...activeSections, mailbox: mailboxState })
    const onToggle = (): void => {}

    // when
    const nodes = buildMailboxNodes(view, theme, { collapsed: false, onToggle })
    const header = flattenText(nodes).find((entry) => entry.text.startsWith("Mailbox"))

    // then
    expect(header?.props.onMouseDown).toBe(onToggle)
  })

  it("#given a collapsed mailbox with activity #when building nodes #then header shows In/Out summary line", () => {
    // given
    const view = computeView({ ...activeSections, mailbox: mailboxState })
    const onToggle = (): void => {}

    // when
    const collapsed = buildMailboxNodes(view, theme, { collapsed: true, onToggle })
    const collapsedTexts = flattenText(collapsed)

    // then: summary line present in collapsed view
    const summaryLine = collapsedTexts.find((entry) => entry.text.startsWith("In "))
    expect(summaryLine).toBeDefined()
    expect(summaryLine?.text).toBe("In 2 / Out 1")
    // rows not visible
    expect(collapsedTexts.some((entry) => entry.text.includes("unread"))).toBe(false)
  })

  it("#given an all-zero mailbox #when expanded #then it renders the idle placeholder", () => {
    // given
    const zeroMailbox: MailboxSidebarState = {
      inboundUnread: 0,
      inboundProcessed: 0,
      recentSentCount: 0,
      recentSent: [],
      outboundUnresolved: 0,
      outboundRead: 0,
      outboundFailed: 0,
    }
    const view = computeView({ ...activeSections, mailbox: zeroMailbox })

    // when
    const nodes = buildMailboxNodes(view, theme)
    const texts = flattenText(nodes).map((entry) => entry.text)

    // then
    expect(texts.some((t) => t === "Mailbox idle")).toBe(true)
    expect(texts.some((t) => t.includes("unread"))).toBe(false)
  })

  it("#given active view without mailbox #when building nodes #then it renders no Mailbox section", () => {
    // given
    const view = computeView({ ...activeSections, mailbox: null })

    // when
    const mailboxTexts = flattenText(buildMailboxNodes(view, theme)).map((entry) => entry.text)
    const description = describeView(view)

    // then
    expect(mailboxTexts.some((value) => value.startsWith("Mailbox"))).toBe(false)
    expect(description).not.toContain("Mailbox")
  })
})
