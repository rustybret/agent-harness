import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { OhMyOpenCodeConfigSchema } from "../../config"
import { validatePluginConfig } from "../../config/validate"
import { parseJsonc } from "../../shared/jsonc-parser"
import { autoProvisionMailboxConfig } from "./auto-provision"
import { MAILBOX_HARNESS_KEY } from "./config/omo-config-target"

let repoRoot: string
let tempHome: string
let originalHome: string | undefined

function omoDir(): string {
  return path.join(repoRoot, ".omo")
}

function stubPath(): string {
  return path.join(omoDir(), "omo.jsonc")
}

function harnessBlock(raw: string): unknown {
  const parsed = parseJsonc(raw) as Record<string, unknown>
  return parsed[MAILBOX_HARNESS_KEY]
}

beforeEach(() => {
  originalHome = process.env.HOME
  tempHome = mkdtempSync(path.join(os.tmpdir(), "cpm-autoprovision-home-"))
  process.env.HOME = tempHome
  repoRoot = mkdtempSync(path.join(os.tmpdir(), "cpm-autoprovision-"))
})

afterEach(() => {
  if (originalHome !== undefined) {
    process.env.HOME = originalHome
  } else {
    delete process.env.HOME
  }
  rmSync(repoRoot, { recursive: true, force: true })
  rmSync(tempHome, { recursive: true, force: true })
})

describe("autoProvisionMailboxConfig", () => {
  describe("#given a configless directory", () => {
    it("#then a stub config file is written at .omo/omo.jsonc", () => {
      // given
      expect(existsSync(stubPath())).toBe(false)

      // when
      autoProvisionMailboxConfig(repoRoot)

      // then
      expect(existsSync(stubPath())).toBe(true)
    })

    it("#then the written stub nests mailbox senders under the [opencode] harness key", () => {
      // given / when
      autoProvisionMailboxConfig(repoRoot)

      // then
      const raw = readFileSync(stubPath(), "utf8")
      expect(parseJsonc(raw)).toEqual({
        $schema: expect.any(String),
        [MAILBOX_HARNESS_KEY]: {
          cross_project_mailbox: { senders: {} },
        },
      })
      expect(raw).toContain("/project-mailbox")
      expect(raw).toContain('"<source-projectId>": { "access": "allow"|"deny", "intent_budget": "question"|"impl"|"plan" }')
      expect(raw).not.toContain('"enabled"')
      expect(raw).not.toContain('"default_sender_access"')
    })

    it("#then the harness block is schema-compliant and resolves mailbox defaults", () => {
      // given / when
      autoProvisionMailboxConfig(repoRoot)

      // then
      const raw = readFileSync(stubPath(), "utf8")
      const result = OhMyOpenCodeConfigSchema.safeParse(harnessBlock(raw))
      expect(result.success).toBe(true)
      if (!result.success) throw result.error
      expect(result.data.cross_project_mailbox?.enabled).toBe(true)
      expect(result.data.cross_project_mailbox?.default_sender_access).toBe("allow-none")
      expect(result.data.cross_project_mailbox?.senders).toEqual({})
    })

    it("#then validatePluginConfig reads the provisioned file back", () => {
      // given
      const before = validatePluginConfig(repoRoot, { HOME: tempHome })
      expect(before.config.cross_project_mailbox?.senders).toEqual({})

      // when
      autoProvisionMailboxConfig(repoRoot)

      // then
      const after = validatePluginConfig(repoRoot, { HOME: tempHome })
      expect(after.valid).toBe(true)
      expect(after.config.cross_project_mailbox?.senders).toEqual({})
    })
  })

  describe("#given an existing omo.jsonc config file", () => {
    it("#then it is a no-op and the file is unchanged", () => {
      // given
      mkdirSync(omoDir(), { recursive: true })
      const existing = '{ "[opencode]": { "cross_project_mailbox": { "enabled": false } } }'
      writeFileSync(stubPath(), existing, "utf8")

      // when
      autoProvisionMailboxConfig(repoRoot)

      // then
      expect(readFileSync(stubPath(), "utf8")).toBe(existing)
    })
  })

  describe("#given an existing omo.json config file", () => {
    it("#then it is a no-op and no .jsonc stub is created", () => {
      // given
      mkdirSync(omoDir(), { recursive: true })
      const jsonPath = path.join(omoDir(), "omo.json")
      writeFileSync(jsonPath, "{}", "utf8")

      // when
      autoProvisionMailboxConfig(repoRoot)

      // then
      expect(existsSync(stubPath())).toBe(false)
      expect(readFileSync(jsonPath, "utf8")).toBe("{}")
    })
  })
})
