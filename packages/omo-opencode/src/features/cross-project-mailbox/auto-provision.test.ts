import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { OhMyOpenCodeConfigSchema } from "../../config"
import { parseJsonc } from "../../shared/jsonc-parser"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "../../shared/plugin-identity"
import { autoProvisionMailboxConfig } from "./auto-provision"

let repoRoot: string

function opencodeDir(): string {
  return path.join(repoRoot, ".opencode")
}

function stubPath(): string {
  return path.join(opencodeDir(), `${CONFIG_BASENAME}.jsonc`)
}

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(os.tmpdir(), "cpm-autoprovision-"))
})

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true })
})

describe("autoProvisionMailboxConfig", () => {
  describe("#given a configless directory", () => {
    it("#then a stub config file is written", () => {
      // given
      expect(existsSync(stubPath())).toBe(false)

      // when
      autoProvisionMailboxConfig(repoRoot)

      // then
      expect(existsSync(stubPath())).toBe(true)
    })

    it("#then the written stub contains only mailbox senders and usage comments", () => {
      // given / when
      autoProvisionMailboxConfig(repoRoot)

      // then
      const raw = readFileSync(stubPath(), "utf8")
      const parsed = parseJsonc(raw)
      expect(parsed).toEqual({
        $schema: expect.any(String),
        cross_project_mailbox: { senders: {} },
      })
      expect(raw).toContain("/project-mailbox")
      expect(raw).toContain('"<source-projectId>": { "access": "allow"|"deny", "intent_budget": "question"|"impl"|"plan" }')
      expect(raw).not.toContain('"enabled"')
      expect(raw).not.toContain('"default_sender_access"')
    })

    it("#then the written stub is schema-compliant and resolves mailbox defaults", () => {
      // given / when
      autoProvisionMailboxConfig(repoRoot)

      // then
      const raw = readFileSync(stubPath(), "utf8")
      const result = OhMyOpenCodeConfigSchema.safeParse(parseJsonc(raw))
      expect(result.success).toBe(true)
      if (!result.success) throw result.error
      expect(result.data.cross_project_mailbox?.enabled).toBe(true)
      expect(result.data.cross_project_mailbox?.default_sender_access).toBe("allow-none")
      expect(result.data.cross_project_mailbox?.senders).toEqual({})
      expect(raw).toContain("/project-mailbox")
    })

    it("#then validatePluginConfig in the same process sees the new file (cache cleared)", async () => {
      // given
      const { detectPluginConfigFile } = await import("../../shared/jsonc-parser")
      // prime the detection cache with the absent state
      const before = detectPluginConfigFile(opencodeDir(), {
        basenames: [CONFIG_BASENAME],
        legacyBasenames: [LEGACY_CONFIG_BASENAME],
      })
      expect(before.format).toBe("none")

      // when
      autoProvisionMailboxConfig(repoRoot)

      // then
      const after = detectPluginConfigFile(opencodeDir(), {
        basenames: [CONFIG_BASENAME],
        legacyBasenames: [LEGACY_CONFIG_BASENAME],
      })
      expect(after.format).not.toBe("none")
    })
  })

  describe("#given an existing canonical config file", () => {
    it("#then it is a no-op and the file is unchanged", () => {
      // given
      mkdirSync(opencodeDir(), { recursive: true })
      const existing = '{ "cross_project_mailbox": { "enabled": false } }'
      writeFileSync(stubPath(), existing, "utf8")

      // when
      autoProvisionMailboxConfig(repoRoot)

      // then
      expect(readFileSync(stubPath(), "utf8")).toBe(existing)
    })
  })

  describe("#given an existing legacy-basename config file", () => {
    it("#then it is a no-op and no canonical stub is created", () => {
      // given
      mkdirSync(opencodeDir(), { recursive: true })
      const legacyPath = path.join(opencodeDir(), `${LEGACY_CONFIG_BASENAME}.json`)
      writeFileSync(legacyPath, "{}", "utf8")

      // when
      autoProvisionMailboxConfig(repoRoot)

      // then
      expect(existsSync(stubPath())).toBe(false)
    })
  })
})
