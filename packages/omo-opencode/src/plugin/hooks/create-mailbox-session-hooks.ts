import type { HookName, OhMyOpenCodeConfig } from "../../config"
import { autoProvisionMailboxConfig } from "../../features/cross-project-mailbox/auto-provision"
import { createMailboxHooks, type MailboxHooks } from "../../features/cross-project-mailbox/hooks"
import type { ModeDetector } from "../../features/cross-project-mailbox/presence"
import { safeCreateHook } from "../../shared/safe-create-hook"
import type { PluginContext } from "../types"
import type { BackgroundManager } from "../../features/background-agent"

export type MailboxSessionHooks = {
  mailboxIdleDrain: MailboxHooks["mailboxIdleDrain"]
  mailboxPresenceHeartbeat: MailboxHooks["mailboxPresenceHeartbeat"]
}

export function createMailboxSessionHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  mailboxModeDetector?: ModeDetector
  backgroundManager?: BackgroundManager
}): MailboxSessionHooks {
  const { ctx, pluginConfig, isHookEnabled, safeHookEnabled, mailboxModeDetector, backgroundManager } = args
  const config = pluginConfig.cross_project_mailbox

  if (config?.enabled !== false) {
    autoProvisionMailboxConfig(ctx.directory)
  }

  const hooks =
    isHookEnabled("cross-project-mailbox-idle-drain") && config?.enabled
      ? safeCreateHook(
          "cross-project-mailbox-idle-drain",
          () => createMailboxHooks(ctx, config, mailboxModeDetector, backgroundManager),
          { enabled: safeHookEnabled },
        )
      : null

  return {
    mailboxIdleDrain: hooks?.mailboxIdleDrain ?? null,
    mailboxPresenceHeartbeat: hooks?.mailboxPresenceHeartbeat ?? null,
  }
}
