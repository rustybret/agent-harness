import type { HookName, OhMyOpenCodeConfig } from "../../config"
import { createMailboxHooks, type MailboxHooks } from "../../features/cross-project-mailbox/hooks"
import { safeCreateHook } from "../../shared/safe-create-hook"
import type { PluginContext } from "../types"

export type MailboxSessionHooks = {
  mailboxIdleDrain: MailboxHooks["mailboxIdleDrain"]
}

export function createMailboxSessionHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
}): MailboxSessionHooks {
  const { ctx, pluginConfig, isHookEnabled, safeHookEnabled } = args
  const config = pluginConfig.cross_project_mailbox

  const mailboxIdleDrain =
    isHookEnabled("cross-project-mailbox-idle-drain") && config?.enabled
      ? safeCreateHook(
          "cross-project-mailbox-idle-drain",
          () => createMailboxHooks(ctx, config).mailboxIdleDrain,
          { enabled: safeHookEnabled },
        )
      : null

  return { mailboxIdleDrain }
}
