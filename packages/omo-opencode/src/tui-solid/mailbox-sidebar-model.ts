import { createSignal } from "solid-js"

export type Accessor<T> = () => T
export type TuiColor = unknown

export type ProjectPresenceRow = {
  readonly projectId: string
  readonly label: string
  readonly presence: "online" | "pending" | "lastSeen"
  readonly statusText: string
  readonly dotColor: "success" | "warning" | "muted"
}

export type MailboxSidebarState = {
  readonly inboundUnread: number
  readonly inboundProcessed: number
  readonly outboundUnresolved: number
  readonly outboundRead: number
  readonly outboundFailed: number
  readonly projects: readonly ProjectPresenceRow[]
}

export type MailboxSidebarTheme = {
  readonly error?: TuiColor
  readonly text?: TuiColor
  readonly textMuted?: TuiColor
  readonly warning?: TuiColor
  readonly success?: TuiColor
  readonly accent?: TuiColor
  readonly borderActive?: TuiColor
  readonly background?: TuiColor
}

export type MailboxSidebarPrefs = {
  readonly rememberCollapsed: boolean
  readonly collapsed?: boolean | null
  readonly header: { readonly label: string; readonly showVersion: boolean }
}

export type MailboxTextToken = {
  readonly text: string
  readonly fg: TuiColor | undefined
}

export type MailboxContentModel =
  | { readonly kind: "collapsed"; readonly tokens: readonly MailboxTextToken[] }
  | { readonly kind: "expanded"; readonly tokens: readonly MailboxTextToken[] }

export type MailboxSidebarControllerDeps = {
  readonly getMailbox: Accessor<MailboxSidebarState | null | undefined>
  readonly getPrefs: Accessor<MailboxSidebarPrefs>
  readonly getVersion?: Accessor<string>
  readonly badgeTextColor: (accent: TuiColor | undefined, background: TuiColor | undefined) => TuiColor | undefined
  readonly initialCollapsed?: boolean
  readonly onToggle?: (collapsed: boolean) => void
  readonly requestRender?: () => void
  readonly watchPrefs?: (onChange: () => void) => () => void
}

export type MailboxSidebarController = {
  readonly prefs: Accessor<MailboxSidebarPrefs>
  readonly version: Accessor<string>
  readonly collapsed: Accessor<boolean>
  readonly toggle: () => void
  readonly badgeFg: (theme: MailboxSidebarTheme) => TuiColor | undefined
  readonly contentModel: (theme: MailboxSidebarTheme) => MailboxContentModel | null
  readonly dispose: () => void
}

export function createMailboxSidebarController(deps: MailboxSidebarControllerDeps): MailboxSidebarController {
  const [collapsed, setCollapsed] = createSignal(deps.initialCollapsed ?? deps.getPrefs().collapsed ?? false)
  const disposeWatch = deps.watchPrefs?.(() => {
    const next = deps.getPrefs().collapsed
    if (typeof next === "boolean") setCollapsed(next)
    deps.requestRender?.()
  })

  const toggle = (): void => {
    const next = !collapsed()
    setCollapsed(next)
    if (deps.getPrefs().rememberCollapsed) deps.onToggle?.(next)
    deps.requestRender?.()
  }

  return {
    prefs: deps.getPrefs,
    version: () => deps.getVersion?.() ?? "",
    collapsed,
    toggle,
    badgeFg: (theme) => deps.badgeTextColor(theme.accent, theme.background),
    contentModel: (theme) => {
      const mailbox = deps.getMailbox()
      return mailbox ? deriveMailboxContentModel(mailbox, theme, collapsed()) : null
    },
    dispose: () => disposeWatch?.(),
  }
}

export function deriveMailboxContentModel(
  mailbox: MailboxSidebarState,
  theme: MailboxSidebarTheme,
  collapsed: boolean,
): MailboxContentModel {
  if (collapsed) return { kind: "collapsed", tokens: [collapsedSummaryToken(mailbox, theme)] }
  const activeProjects = mailbox.projects.filter((project) => project.presence === "online").length
  return {
    kind: "expanded",
    tokens: [
      { text: "In", fg: theme.text },
      { text: "Unread", fg: theme.textMuted },
      { text: String(mailbox.inboundUnread), fg: mailbox.inboundUnread > 0 ? theme.warning : theme.textMuted },
      { text: "Done", fg: theme.textMuted },
      { text: String(mailbox.inboundProcessed), fg: theme.textMuted },
      { text: "Out", fg: theme.text },
      { text: "Pending", fg: theme.textMuted },
      { text: String(mailbox.outboundUnresolved), fg: mailbox.outboundUnresolved > 0 ? theme.warning : theme.textMuted },
      { text: "Read", fg: theme.textMuted },
      { text: String(mailbox.outboundRead), fg: theme.textMuted },
      { text: "Failed", fg: theme.textMuted },
      { text: String(mailbox.outboundFailed), fg: mailbox.outboundFailed > 0 ? theme.error : theme.textMuted },
      { text: "Projects", fg: theme.text },
      { text: `(${activeProjects}/${mailbox.projects.length})`, fg: activeProjects > 0 ? theme.warning : theme.textMuted },
      ...projectTokens(mailbox.projects, theme),
    ],
  }
}

export function collapsedSummaryToken(mailbox: MailboxSidebarState, theme: MailboxSidebarTheme): MailboxTextToken {
  return {
    text: mailboxCollapsedSummary(mailbox),
    fg: mailboxAllZero(mailbox)
      ? theme.textMuted
      : mailbox.inboundUnread > 0 || mailbox.outboundUnresolved > 0
        ? theme.warning
        : theme.textMuted,
  }
}

export function projectTokens(projects: readonly ProjectPresenceRow[], theme: MailboxSidebarTheme): readonly MailboxTextToken[] {
  if (projects.length === 0) return [{ text: "No connected projects", fg: theme.textMuted }]
  return projects.flatMap((row) => [
    { text: "•", fg: projectDotColor(row.dotColor, theme) },
    { text: row.label, fg: theme.textMuted },
    { text: row.statusText, fg: theme.textMuted },
  ])
}

export function projectDotColor(color: ProjectPresenceRow["dotColor"], theme: MailboxSidebarTheme): TuiColor | undefined {
  switch (color) {
    case "success":
      return theme.success
    case "warning":
      return theme.warning
    case "muted":
      return theme.textMuted
  }
}

export function mailboxCollapsedSummary(mailbox: MailboxSidebarState): string {
  if (mailboxAllZero(mailbox)) return "idle"
  const active = mailbox.projects.filter((project) => project.presence === "online").length
  const total = mailbox.projects.length
  return `in:${mailbox.inboundUnread} out:${mailbox.outboundUnresolved} Projects (${active}/${total} active)`
}

export function mailboxAllZero(mailbox: MailboxSidebarState): boolean {
  return (
    mailbox.inboundUnread === 0 &&
    mailbox.inboundProcessed === 0 &&
    mailbox.outboundUnresolved === 0 &&
    mailbox.outboundRead === 0 &&
    mailbox.outboundFailed === 0 &&
    mailbox.projects.length === 0
  )
}
