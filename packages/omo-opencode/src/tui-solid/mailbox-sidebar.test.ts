import { describe, expect, test } from "bun:test"

import type { MailboxSidebarState } from "../features/cross-project-mailbox/sidebar"
import type { ViewNode } from "../features/tui-sidebar/element-helpers"
import { buildMailboxNodes } from "../features/tui-sidebar/render-view"
import type { SidebarView } from "../features/tui-sidebar/state-types"
import { createMailboxSidebarController, deriveMailboxContentModel } from "./mailbox-sidebar"

type TextToken = {
  readonly text: string
  readonly fg: unknown
}

const theme = {
  error: "error",
  text: "text",
  textMuted: "muted",
  warning: "warning",
  success: "success",
  info: "info",
  accent: "accent",
  borderActive: "border-active",
  background: "background",
} as const

const activeMailbox: MailboxSidebarState = {
  inboundUnread: 2,
  inboundProcessed: 5,
  recentSentCount: 3,
  recentSent: [],
  outboundUnresolved: 1,
  outboundRead: 4,
  outboundFailed: 1,
  projects: [
    { projectId: "alpha", label: "Alpha", presence: "online", statusText: "online", dotColor: "success" },
    { projectId: "beta", label: "Beta", presence: "pending", statusText: "pending", dotColor: "warning" },
    { projectId: "gamma", label: "Gamma", presence: "lastSeen", statusText: "last seen", dotColor: "muted" },
  ],
}

const emptyMailbox: MailboxSidebarState = {
  inboundUnread: 0,
  inboundProcessed: 0,
  recentSentCount: 0,
  recentSent: [],
  outboundUnresolved: 0,
  outboundRead: 0,
  outboundFailed: 0,
  projects: [],
}

function viewFor(mailbox: MailboxSidebarState): SidebarView {
  return {
    kind: "idle",
    roster: { kind: "empty" },
    mailbox,
  }
}

function collectText(nodes: readonly ViewNode[]): readonly TextToken[] {
  const tokens: TextToken[] = []
  const visit = (node: ViewNode): void => {
    if (node.kind === "text") tokens.push({ text: node.text ?? "", fg: node.props.fg })
    for (const child of node.children ?? []) visit(child)
  }
  for (const node of nodes) visit(node)
  return tokens
}

function legacyTokens(mailbox: MailboxSidebarState, collapsed: boolean): readonly TextToken[] {
  return collectText(
    buildMailboxNodes(viewFor(mailbox), theme, {
      collapsed,
      onToggle: () => {},
    }),
  ).filter((token) => token.text !== `${collapsed ? "▶" : "▼"} Mailbox`)
}

describe("mailbox sidebar semantic port", () => {
  test("matches legacy expanded mailbox labels, counts, tones, and project dot colors", () => {
    // #given
    const legacy = legacyTokens(activeMailbox, false)

    // #when
    const model = deriveMailboxContentModel(activeMailbox, theme, false)

    // #then
    expect(model.kind).toBe("expanded")
    expect(model.tokens).toEqual(legacy)
  })

  test("matches legacy collapsed summary text and tone", () => {
    // #given
    const legacyActive = legacyTokens(activeMailbox, true)
    const legacyEmpty = legacyTokens(emptyMailbox, true)

    // #when
    const activeModel = deriveMailboxContentModel(activeMailbox, theme, true)
    const emptyModel = deriveMailboxContentModel(emptyMailbox, theme, true)

    // #then
    expect(activeModel).toEqual({ kind: "collapsed", tokens: legacyActive })
    expect(emptyModel).toEqual({ kind: "collapsed", tokens: legacyEmpty })
  })

  test("keeps collapse state in the controller factory closure and calls injected persistence", () => {
    // #given
    const persisted: boolean[] = []
    const controller = createMailboxSidebarController({
      getMailbox: () => activeMailbox,
      getPrefs: () => ({ header: { label: "Mailbox", showVersion: true }, rememberCollapsed: true }),
      getVersion: () => "1.2.3",
      badgeTextColor: () => "badge-fg",
      initialCollapsed: false,
      onToggle: (next) => persisted.push(next),
      requestRender: () => {},
    })

    // #when
    controller.toggle()

    // #then
    expect(controller.collapsed()).toBe(true)
    expect(persisted).toEqual([true])
  })
})
