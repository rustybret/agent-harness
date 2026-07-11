import type { TuiPluginModule } from "@opencode-ai/plugin/tui"

import type {
  MailboxSidebarRegistryPort,
  MailboxSidebarState,
} from "./features/cross-project-mailbox/sidebar"
import { computeView, viewKey } from "./features/tui-sidebar/compute-view"
import { POLL_INTERVAL_MS } from "./features/tui-sidebar/constants"
import { deriveAgents, deriveConfig, deriveJobBoard, deriveLoop, deriveRoster } from "./features/tui-sidebar/derivers"
import type { ViewNode } from "./features/tui-sidebar/element-helpers"
import { readMirror } from "./features/tui-sidebar/mirror-io"
import { buildMailboxNodes, buildViewNodes } from "./features/tui-sidebar/render-view"
import type { MailboxToggleOpts } from "./features/tui-sidebar/render-view"
import type { RosterRow } from "./features/tui-sidebar/state-types"
import type { SidebarView } from "./features/tui-sidebar/state-types"
import {
  queueTuiPreferenceUpdate,
  readTuiPreferencesFileSync,
  resolveOmoCollapsed,
} from "./features/tui-sidebar/tui-preferences"
import { log } from "./shared/logger"

type SolidRuntime<Node> = {
  readonly createElement: (tag: string) => Node
  readonly insert: (parent: Node, child: Node | string) => unknown
  readonly setProp: (node: Node, name: string, value: unknown) => unknown
}

type SolidSignals = Pick<typeof import("solid-js"), "createSignal">

// Signals must come from the HOST's solid-js instance (the OpenCode TUI rewrites
// the "solid-js" specifier to its runtime module) so the slot's children() memo
// tracks our reads and re-renders on writes. Without solid-js the sidebar still
// renders, just statically (no live updates until remount).
function createSignalPair<T>(runtime: SolidSignals | null, initial: T): readonly [() => T, (value: T) => void] {
  if (runtime) {
    const [get, set] = runtime.createSignal(initial)
    return [
      get,
      (value: T): void => {
        set(() => value)
      },
    ]
  }
  let current = initial
  return [
    () => current,
    (value: T): void => {
      current = value
    },
  ]
}

// Lower order renders higher: 150 sorts the mailbox above Magic Context (external DEFAULT_SLOT_ORDER 200).
export const MAILBOX_SLOT_ORDER = 150
export const OMO_SLOT_ORDER = 900

type SidebarSlotRegistration<Node> = {
  readonly order: number
  readonly slots: {
    readonly sidebar_content: () => () => Node
  }
}

type RegisterSidebarContentSlotInput<Node> = {
  readonly registerSlot: (registration: SidebarSlotRegistration<Node>) => void
  readonly requestRender: () => void
  readonly renderSidebar: () => Node
  readonly renderMailbox: () => Node
}

// The slot registry invokes each renderer ONCE and resolves the result through
// solid's children() memo. Returning the render thunk (instead of a materialized
// tree) lets that memo re-run whenever a signal read inside the thunk changes,
// which is what makes live count updates and the collapse toggle repaint.
function registerSidebarContentSlot<Node>({
  registerSlot,
  requestRender,
  renderSidebar,
  renderMailbox,
}: RegisterSidebarContentSlotInput<Node>): void {
  registerSlot({
    order: MAILBOX_SLOT_ORDER,
    slots: {
      sidebar_content: () => renderMailbox,
    },
  })
  registerSlot({
    order: OMO_SLOT_ORDER,
    slots: {
      sidebar_content: () => renderSidebar,
    },
  })
  requestRender()
}

function materialize<Node>(nodes: readonly ViewNode[], solid: SolidRuntime<Node>): Node {
  const root = solid.createElement("box")
  solid.setProp(root, "flexDirection", "column")
  for (const node of nodes) {
    solid.insert(root, materializeNode(node, solid))
  }
  return root
}

function materializeNode<Node>(node: ViewNode, solid: SolidRuntime<Node>): Node {
  const element = solid.createElement(node.kind)
  for (const [name, value] of Object.entries(node.props)) {
    solid.setProp(element, name, value)
  }
  if (node.kind === "text") {
    solid.insert(element, node.text ?? "")
  }
  for (const child of node.children ?? []) {
    solid.insert(element, materializeNode(child, solid))
  }
  return element
}

type RosterResolver = (directory: string) => RosterRow[]
type PluginValidation = {
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

async function loadPluginValidation(directory: string): Promise<PluginValidation> {
  const { validatePluginConfig } = await import("./config/validate")
  return validatePluginConfig(directory)
}

async function loadRosterRows(directory: string): Promise<readonly RosterRow[]> {
  const { resolveRoster } = await import("./features/tui-sidebar/roster-resolver")
  const resolver: RosterResolver = resolveRoster
  return resolver(directory)
}

async function loadMailboxSection(directory: string): Promise<MailboxSidebarState | null> {
  const { validatePluginConfig } = await import("./config/validate")
  const { applyMailboxDefault } = await import("./features/cross-project-mailbox/config-defaults")
  const mailboxConfig = applyMailboxDefault(validatePluginConfig(directory).config).cross_project_mailbox
  if (!mailboxConfig || mailboxConfig.enabled === false) return null

  const { createProjectRegistry } = await import("./features/cross-project-mailbox/registry")
  const { readMailboxSidebarState } = await import("./features/cross-project-mailbox/sidebar")
  const projects = await createProjectRegistry().listProjects()
  const repoRootById = new Map(projects.map((entry) => [entry.projectId, entry.repoRoot]))
  const registry: MailboxSidebarRegistryPort = {
    getRepoRootForProjectId: (id) => repoRootById.get(id),
  }
  return readMailboxSidebarState(directory, mailboxConfig, registry)
}

async function readView(directory: string): Promise<SidebarView> {
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

const module: TuiPluginModule = {
  id: "oh-my-openagent:tui",
  tui: async (api) => {
    const solid = await import("@opentui/solid").catch((error) => {
      log("[tui-sidebar] @opentui/solid unavailable; sidebar disabled", { error })
      return null
    })
    if (!solid) {
      return
    }
    const solidJs = await import("solid-js").catch((error) => {
      log("[tui-sidebar] solid-js unavailable; sidebar renders statically", { error })
      return null
    })

    const directory = api.state.path.directory
    if ((await loadPluginValidation(directory)).config.tui?.sidebar?.enabled === false) {
      return
    }

    const initialView = await readView(directory)
    let currentKey = viewKey(initialView)
    let disposed = false
    let inFlight = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const [view, setView] = createSignalPair<SidebarView>(solidJs, initialView)
    const [collapsed, setCollapsed] = createSignalPair<boolean>(
      solidJs,
      resolveOmoCollapsed(readTuiPreferencesFileSync()),
    )

    const toggleMailbox = (): void => {
      const next = !collapsed()
      setCollapsed(next)
      queueTuiPreferenceUpdate(["mailbox", "collapsed"], next)
      api.renderer.requestRender()
    }

    const mailboxToggle: MailboxToggleOpts = {
      get collapsed() {
        return collapsed()
      },
      onToggle: toggleMailbox,
    }

    registerSidebarContentSlot({
      registerSlot: (registration) => {
        api.slots.register(registration)
      },
      requestRender: () => {
        api.renderer.requestRender()
      },
      renderSidebar: () => materialize(buildViewNodes(view(), api.theme.current), solid),
      renderMailbox: () => materialize(buildMailboxNodes(view(), api.theme.current, mailboxToggle), solid),
    })

    const { registerProjectMailboxCommand } = await import("./features/cross-project-mailbox/dialog/tui-command")
    registerProjectMailboxCommand(api, { directory })

    const schedule = (): void => {
      timer = setTimeout(tick, POLL_INTERVAL_MS)
    }

    const legacySendersState = { hasToastedLegacy: false }

    const tick = async (): Promise<void> => {
      if (disposed || inFlight) {
        if (!disposed) schedule()
        return
      }
      inFlight = true
      try {
        const nextView = await readView(directory)
        const nextKey = viewKey(nextView)
        if (nextKey !== currentKey) {
          currentKey = nextKey
          setView(nextView)
          api.renderer.requestRender()
        }

        if ((api.ui as any)?.toast) {
          const { runRegistrationToastCheck, runLegacySendersNoticeCheck } = await import("./features/cross-project-mailbox/dialog/registration-notice")
          await runLegacySendersNoticeCheck(api, legacySendersState)
          await runRegistrationToastCheck(api, directory)
        }
      } catch (error) {
        handleTuiPollError(error)
      } finally {
        inFlight = false
        if (!disposed) schedule()
      }
    }

    schedule()
    api.lifecycle.onDispose(() => {
      disposed = true
      if (timer) clearTimeout(timer)
    })
  },
}

export default module
