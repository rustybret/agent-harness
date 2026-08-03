import { describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadPluginConfig } from "../plugin-config"
import { OhMyOpenCodeConfigSchema } from "./schema"
import { validatePluginConfig } from "./validate"

type EnvSnapshot = {
  readonly HOME: string | undefined
  readonly OPENCODE_CONFIG_DIR: string | undefined
  readonly XDG_CONFIG_HOME: string | undefined
}

const ENV_KEYS = ["HOME", "OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME"] as const

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function withIsolatedConfig<T>(name: string, run: (root: string) => T): T {
  const original: EnvSnapshot = {
    HOME: process.env.HOME,
    OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  }
  const root = join(tmpdir(), `omo-mailbox-default-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  try {
    mkdirSync(root, { recursive: true })
    process.env.HOME = root
    process.env.OPENCODE_CONFIG_DIR = join(root, "custom-config")
    process.env.XDG_CONFIG_HOME = join(root, "xdg-config")
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
    restoreEnv(original)
  }
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(join(filePath, ".."), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

describe("cross_project_mailbox default injection", () => {
  describe("#given the root schema is parsed with an empty object", () => {
    describe("#when reading cross_project_mailbox", () => {
      it("#then the root field stays undefined with no per-layer default", () => {
        // given
        const input = {}

        // when
        const parsed = OhMyOpenCodeConfigSchema.parse(input)

        // then
        expect(parsed.cross_project_mailbox).toBeUndefined()
      })
    })
  })

  describe("#given a configless directory", () => {
    describe("#when validatePluginConfig runs", () => {
      it("#then it injects a populated mailbox default post-merge", () => {
        withIsolatedConfig("validate-configless", (root) => {
          // given
          const project = join(root, "project")
          mkdirSync(project, { recursive: true })

          // when
          const result = validatePluginConfig(project)

          // then
          expect(result.config.cross_project_mailbox?.enabled).toBe(true)
          expect(result.config.cross_project_mailbox?.default_sender_access).toBe("allow-none")
          expect(result.config.cross_project_mailbox?.senders).toEqual({})
        })
      })
    })

    describe("#when loadPluginConfig runs", () => {
      it("#then it injects a populated mailbox default post-merge", () => {
        withIsolatedConfig("load-configless", (root) => {
          // given
          const project = join(root, "project")
          mkdirSync(project, { recursive: true })

          // when
          const config = loadPluginConfig(project, {})

          // then
          expect(config.cross_project_mailbox?.enabled).toBe(true)
          expect(config.cross_project_mailbox?.default_sender_access).toBe("allow-none")
          expect(config.cross_project_mailbox?.senders).toEqual({})
        })
      })
    })
  })

  describe("#given a user layer disabling mailbox and a project layer omitting the block", () => {
    describe("#when validatePluginConfig merges the layers", () => {
      it("#then the explicit enabled false survives untouched", () => {
        withIsolatedConfig("validate-explicit-false", (root) => {
          // given
          const project = join(root, "project")
          writeJson(join(root, ".omo", "omo.jsonc"), {
            "[opencode]": { cross_project_mailbox: { enabled: false } },
          })
          writeJson(join(project, ".omo", "omo.jsonc"), {
            "[opencode]": { tui: { sidebar: { enabled: true } } },
          })

          // when
          const result = validatePluginConfig(project)

          // then
          expect(result.config.cross_project_mailbox?.enabled).toBe(false)
        })
      })
    })

    describe("#when loadPluginConfig merges the layers", () => {
      it("#then the explicit enabled false survives untouched", () => {
        withIsolatedConfig("load-explicit-false", (root) => {
          // given
          const project = join(root, "project")
          writeJson(join(root, ".omo", "omo.jsonc"), {
            "[opencode]": { cross_project_mailbox: { enabled: false } },
          })
          writeJson(join(project, ".omo", "omo.jsonc"), {
            "[opencode]": { tui: { sidebar: { enabled: true } } },
          })

          // when
          const config = loadPluginConfig(project, {})

          // then
          expect(config.cross_project_mailbox?.enabled).toBe(false)
        })
      })
    })
  })
})
