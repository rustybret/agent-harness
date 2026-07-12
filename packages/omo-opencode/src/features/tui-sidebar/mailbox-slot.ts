import type { MailboxSidebarState } from "../cross-project-mailbox/sidebar"
import type { OmoTuiPrefs } from "./tui-preferences"

export type MailboxSidebarController = {
  readonly dispose: () => void
}

export type CreateMailboxSidebarControllerFn = (deps: {
  readonly getMailbox: () => MailboxSidebarState | null | undefined
  readonly getPrefs: () => OmoTuiPrefs
  readonly getVersion: () => string
  readonly badgeTextColor: (accent: unknown, background: unknown) => unknown
  readonly initialCollapsed: boolean
  readonly onToggle: (collapsed: boolean) => void
  readonly requestRender: () => void
  readonly watchPrefs: (onChange: () => void) => () => void
}) => MailboxSidebarController

export type MailboxSidebarComponent = (props: {
  readonly controller: MailboxSidebarController
  readonly theme: Record<string, unknown>
}) => unknown

export type CompiledMailboxModule = {
  readonly MailboxSidebar: MailboxSidebarComponent | null
  readonly createMailboxSidebarController: CreateMailboxSidebarControllerFn | null
}

export async function loadCompiledMailboxModule(): Promise<CompiledMailboxModule> {
  try {
    const compiledUrl = new URL("./tui-compiled/mailbox-sidebar.js", import.meta.url).href
    const mod = await import(compiledUrl)
    return {
      MailboxSidebar: mod.MailboxSidebar ?? null,
      createMailboxSidebarController: mod.createMailboxSidebarController ?? null,
    }
  } catch {
    return { MailboxSidebar: null, createMailboxSidebarController: null }
  }
}
