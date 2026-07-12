import type { MailboxSidebarRegistryPort, MailboxSidebarState } from "../cross-project-mailbox/sidebar"
import { computeView } from "./compute-view"
import { deriveAgents, deriveConfig, deriveJobBoard, deriveLoop, deriveRoster } from "./derivers"
import { readMirror } from "./mirror-io"
import type { RosterRow, SidebarView } from "./state-types"
import { log } from "../../shared/logger"

type RosterResolver = (directory: string) => RosterRow[]

export type PluginValidation = {
  readonly valid: boolean
  readonly messages: readonly string[]
  readonly config: {
    readonly tui?: {
      readonly sidebar?: {
        readonly enabled?: boolean
      }
    }
  }
}

export async function loadPluginValidation(directory: string): Promise<PluginValidation> {
  const { validatePluginConfig } = await import("../../config/validate")
  return validatePluginConfig(directory)
}

async function loadRosterRows(directory: string): Promise<readonly RosterRow[]> {
  const { resolveRoster } = await import("./roster-resolver")
  const resolver: RosterResolver = resolveRoster
  return resolver(directory)
}

async function loadMailboxSection(directory: string): Promise<MailboxSidebarState | null> {
  const { validatePluginConfig } = await import("../../config/validate")
  const { applyMailboxDefault } = await import("../cross-project-mailbox/config-defaults")
  const mailboxConfig = applyMailboxDefault(validatePluginConfig(directory).config).cross_project_mailbox
  if (!mailboxConfig || mailboxConfig.enabled === false) return null

  const { createProjectRegistry } = await import("../cross-project-mailbox/registry")
  const { readMailboxSidebarState } = await import("../cross-project-mailbox/sidebar")
  const projects = await createProjectRegistry().listProjects()
  const repoRootById = new Map(projects.map((entry) => [entry.projectId, entry.repoRoot]))
  const registry: MailboxSidebarRegistryPort = {
    getRepoRootForProjectId: (id) => repoRootById.get(id),
  }
  return readMailboxSidebarState(directory, mailboxConfig, registry)
}

export async function readView(directory: string): Promise<SidebarView> {
  const validation = await loadPluginValidation(directory)
  const mirror = readMirror(directory)
  const roster = await loadRosterRows(directory)
  const mailbox = await loadMailboxSection(directory)
  return computeView({
    config: deriveConfig(validation),
    roster: deriveRoster(roster),
    agents: deriveAgents(mirror),
    jobs: deriveJobBoard(mirror),
    loop: deriveLoop(mirror),
    mailbox,
  })
}

export function handleTuiPollError(
  error: unknown,
  reportPollError: (error: Error) => void = (pollError) => log("[tui-sidebar] polling failed", { error: pollError }),
): void {
  if (error instanceof Error) {
    reportPollError(error)
    return
  }
  throw error
}
