import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import type { OhMyOpenCodeConfig } from "../../config"
import { HookNameSchema } from "../../config/schema/hooks"
import { CrossProjectMailboxConfigSchema } from "../../features/cross-project-mailbox/config"
import { CONFIG_BASENAME } from "../../shared/plugin-identity"
import type { PluginContext } from "../types"
import { createMailboxSessionHooks } from "./create-mailbox-session-hooks"

function makeCtx(directory: string = process.cwd()): PluginContext {
  return { directory, client: { session: {} } } as unknown as PluginContext
}

function makeConfig(mailbox: unknown): OhMyOpenCodeConfig {
  return { cross_project_mailbox: mailbox } as unknown as OhMyOpenCodeConfig
}

describe("createMailboxSessionHooks", () => {
  describe("#given the auto-provision trigger", () => {
    let repoRoot: string

    function stubPath(): string {
      return path.join(repoRoot, ".opencode", `${CONFIG_BASENAME}.jsonc`)
    }

    beforeEach(() => {
      repoRoot = mkdtempSync(path.join(os.tmpdir(), "cpm-trigger-"))
    })

    afterEach(() => {
      rmSync(repoRoot, { recursive: true, force: true })
    })

    it("#then a configless dir with a populated enabled-true block provisions a stub", () => {
      // given
      const pluginConfig = makeConfig(CrossProjectMailboxConfigSchema.parse({ enabled: true }))

      // when
      createMailboxSessionHooks({
        ctx: makeCtx(repoRoot),
        pluginConfig,
        isHookEnabled: () => true,
        safeHookEnabled: true,
      })

      // then
      expect(existsSync(stubPath())).toBe(true)
    })

    it("#then an explicit enabled-false block is hard-off and provisions nothing", () => {
      // given
      const pluginConfig = makeConfig({ enabled: false })

      // when
      createMailboxSessionHooks({
        ctx: makeCtx(repoRoot),
        pluginConfig,
        isHookEnabled: () => true,
        safeHookEnabled: true,
      })

      // then
      expect(existsSync(stubPath())).toBe(false)
    })
  })

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
