import { describe, expect, it } from "bun:test"

import type { OhMyOpenCodeConfig } from "../../config"
import { HookNameSchema } from "../../config/schema/hooks"
import { CrossProjectMailboxConfigSchema } from "../../features/cross-project-mailbox/config"
import type { PluginContext } from "../types"
import { createMailboxSessionHooks } from "./create-mailbox-session-hooks"

function makeCtx(): PluginContext {
  return { directory: process.cwd(), client: { session: {} } } as unknown as PluginContext
}

function makeConfig(mailbox: unknown): OhMyOpenCodeConfig {
  return { cross_project_mailbox: mailbox } as unknown as OhMyOpenCodeConfig
}

describe("createMailboxSessionHooks", () => {
  describe("#given cross_project_mailbox is disabled", () => {
    it("#then mailboxIdleDrain is null", () => {
      // given
      const pluginConfig = makeConfig({ enabled: false })

      // when
      const result = createMailboxSessionHooks({
        ctx: makeCtx(),
        pluginConfig,
        isHookEnabled: () => true,
        safeHookEnabled: true,
      })

      // then
      expect(result.mailboxIdleDrain).toBeNull()
    })
  })

  describe("#given cross_project_mailbox is unset", () => {
    it("#then mailboxIdleDrain is null", () => {
      // given
      const pluginConfig = makeConfig(undefined)

      // when
      const result = createMailboxSessionHooks({
        ctx: makeCtx(),
        pluginConfig,
        isHookEnabled: () => true,
        safeHookEnabled: true,
      })

      // then
      expect(result.mailboxIdleDrain).toBeNull()
    })
  })

  describe("#given cross_project_mailbox is enabled", () => {
    it("#then mailboxIdleDrain is present with a session.idle handler", () => {
      // given
      const config = CrossProjectMailboxConfigSchema.parse({ enabled: true })
      const pluginConfig = makeConfig(config)

      // when
      const result = createMailboxSessionHooks({
        ctx: makeCtx(),
        pluginConfig,
        isHookEnabled: () => true,
        safeHookEnabled: true,
      })

      // then
      expect(result.mailboxIdleDrain).not.toBeNull()
      expect(typeof result.mailboxIdleDrain?.["session.idle"]).toBe("function")
    })
  })

  describe("#given the hook name registry", () => {
    it("#then HookNameSchema includes cross-project-mailbox-idle-drain", () => {
      // given / when
      const options = HookNameSchema.options

      // then
      expect(options).toContain("cross-project-mailbox-idle-drain")
    })
  })
})
