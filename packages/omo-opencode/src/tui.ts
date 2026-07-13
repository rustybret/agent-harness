import type { TuiPluginModule } from "@opencode-ai/plugin/tui"

import { viewKey } from "./features/tui-sidebar/compute-view"
import { POLL_INTERVAL_MS } from "./features/tui-sidebar/constants"
import { loadHostSolidRuntime } from "./features/tui-sidebar/host-runtime"
import type { MailboxSidebarController } from "./features/tui-sidebar/mailbox-slot"
import { loadCompiledMailboxModule } from "./features/tui-sidebar/mailbox-slot"
import { buildMailboxNodes, buildViewNodes, selectMailbox } from "./features/tui-sidebar/render-view"
import type { MailboxToggleOpts } from "./features/tui-sidebar/render-view"
import { createSignalPair } from "./features/tui-sidebar/signal-pair"
import { materialize } from "./features/tui-sidebar/slot-materializer"
import { MAILBOX_SLOT_ORDER, OMO_SLOT_ORDER } from "./features/tui-sidebar/slot-orders"
import type { SidebarView } from "./features/tui-sidebar/state-types"
import {
  computeEffectiveOrder,
  queueTuiPreferenceUpdate,
  readTuiPreferencesFileSync,
  resolveOmoCollapsed,
  resolveOmoPrefs,
  watchTuiPreferences,
} from "./features/tui-sidebar/tui-preferences"
import { hasToast, isColor } from "./features/tui-sidebar/ui-guards"
import { handleTuiPollError, loadPluginValidation, readView } from "./features/tui-sidebar/view-loader"
import { log } from "./shared/logger"

import packageJson from "../../../package.json" with { type: "json" }
import { badgeTextColor } from "./features/tui-sidebar/badge-contrast"

export { handleTuiPollError }
export { MAILBOX_SLOT_ORDER, OMO_SLOT_ORDER }

const module: TuiPluginModule = {
  id: "oh-my-openagent:tui",
  tui: async (api) => {
    const hostRuntime = await loadHostSolidRuntime()
    const solid = hostRuntime.opentuiSolid
    if (!solid) {
      log("[tui-sidebar] @opentui/solid unavailable; sidebar disabled")
      return
    }
    const { solidJs } = hostRuntime

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
    const prefsRoot = readTuiPreferencesFileSync()
    const [collapsed, setCollapsed] = createSignalPair<boolean>(
      solidJs,
      resolveOmoCollapsed(prefsRoot),
    )

    const { MailboxSidebar: CompiledMailboxSidebar, createMailboxSidebarController } =
      await loadCompiledMailboxModule()

    let mailboxController: MailboxSidebarController | null = null
    let renderMailboxSlot: () => unknown

    if (CompiledMailboxSidebar && createMailboxSidebarController) {
      const controller = createMailboxSidebarController({
        getMailbox: () => selectMailbox(view()) ?? null,
        getPrefs: () => resolveOmoPrefs(readTuiPreferencesFileSync()),
        getVersion: () => packageJson.version,
        badgeTextColor: (accent: unknown, background: unknown) => {
          if (isColor(accent) && isColor(background)) {
            return badgeTextColor(accent, background)
          }
          return undefined
        },
        initialCollapsed: resolveOmoCollapsed(prefsRoot),
        onToggle: (nextCollapsed: boolean) => {
          queueTuiPreferenceUpdate(["mailbox", "collapsed"], nextCollapsed)
        },
        requestRender: () => api.renderer.requestRender(),
        watchPrefs: watchTuiPreferences,
      })
      mailboxController = controller

      const order = computeEffectiveOrder(prefsRoot, "oh-my-openagent", MAILBOX_SLOT_ORDER)

      renderMailboxSlot = () =>
        CompiledMailboxSidebar({
          controller,
          theme: api.theme.current,
        })

      api.slots.register({
        order,
        slots: {
          sidebar_content: () => renderMailboxSlot,
        },
      })
      log("[tui-sidebar] mounted compiled mailbox component", { compiled: true, order })
    } else {
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

      renderMailboxSlot = () => materialize(buildMailboxNodes(view(), api.theme.current, mailboxToggle), solid)

      api.slots.register({
        order: MAILBOX_SLOT_ORDER,
        slots: {
          sidebar_content: () => renderMailboxSlot,
        },
      })
      log("[tui-sidebar] mounted materialized mailbox component", { compiled: false, order: MAILBOX_SLOT_ORDER })
    }

    api.slots.register({
      order: OMO_SLOT_ORDER,
      slots: {
        sidebar_content: () => () => materialize(buildViewNodes(view(), api.theme.current), solid),
      },
    })
    api.renderer.requestRender()

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

        if (hasToast(api.ui)) {
          const { runRegistrationToastCheck, runLegacySendersNoticeCheck } = await import(
            "./features/cross-project-mailbox/dialog/registration-notice"
          )
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
      if (mailboxController) mailboxController.dispose()
    })
  },
}

export default module
