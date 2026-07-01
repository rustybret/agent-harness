import type { HookName, OhMyOpenCodeConfig } from "../../config"
import { autoProvisionMailboxConfig } from "../../features/cross-project-mailbox/auto-provision"
import { createMailboxHooks, type MailboxHooks } from "../../features/cross-project-mailbox/hooks"
import { safeCreateHook } from "../../shared/safe-create-hook"
import type { PluginContext } from "../types"

export type MailboxSessionHooks = {
  mailboxIdleDrain: MailboxHooks["mailboxIdleDrain"]
  mailboxPresenceHeartbeat: MailboxHooks["mailboxPresenceHeartbeat"]
}

export function createMailboxSessionHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
}): MailboxSessionHooks {
  const { ctx, pluginConfig, isHookEnabled, safeHookEnabled } = args
  const config = pluginConfig.cross_project_mailbox

  if (config?.enabled !== false) {
    autoProvisionMailboxConfig(ctx.directory)
  }

  const hooks =
    isHookEnabled("cross-project-mailbox-idle-drain") && config?.enabled
      ? safeCreateHook(
          "cross-project-mailbox-idle-drain",
          () => createMailboxHooks(ctx, config),
          { enabled: safeHookEnabled },
        )
      : null

  return {
    mailboxIdleDrain: hooks?.mailboxIdleDrain ?? null,
    mailboxPresenceHeartbeat: hooks?.mailboxPresenceHeartbeat ?? null,
  }
}
