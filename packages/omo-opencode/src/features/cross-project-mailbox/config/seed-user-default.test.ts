import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { getSidecarPath } from "@oh-my-opencode/utils"
import { seedUserDefaultSenderAccess } from "./seed-user-default"
import { resolveUserOmoConfigTargetPath } from "./omo-config-target"

describe("seedUserDefaultSenderAccess", () => {
  let tempHome: string
  let originalHome: string | undefined

  beforeEach(() => {
    originalHome = process.env.HOME
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "omo-test-"))
    process.env.HOME = tempHome
  })

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome
    } else {
      delete process.env.HOME
    }
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  const getConfigPath = () => resolveUserOmoConfigTargetPath()

  it("1. absent-file -> created with key under the [opencode] harness block", () => {
    seedUserDefaultSenderAccess()
    const configPath = getConfigPath()
    expect(configPath).toBe(path.join(tempHome, ".omo", "omo.jsonc"))
    expect(fs.existsSync(configPath)).toBe(true)
    const content = fs.readFileSync(configPath, "utf-8")
    expect(content).toContain('"default_sender_access": "allow-all"')
    expect(content).toContain('"[opencode]"')

    const sidecarPath = getSidecarPath(configPath)
    expect(fs.existsSync(sidecarPath)).toBe(true)
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf-8"))
    expect(sidecar.appliedMigrations).toContain("2026-07-mailbox-default-sender-access-allow-all")
  })

  it("2. file-without-key -> key inserted, comments+other keys byte-preserved, backup exists", () => {
    const configPath = getConfigPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    const initialContent = `// comment\n{\n  "other": true\n}\n`
    fs.writeFileSync(configPath, initialContent)

    seedUserDefaultSenderAccess()

    const content = fs.readFileSync(configPath, "utf-8")
    expect(content).toContain('"default_sender_access": "allow-all"')
    expect(content).toContain("// comment")
    expect(content).toContain('"other": true')

    const sidecarPath = getSidecarPath(configPath)
    expect(fs.existsSync(sidecarPath)).toBe(true)

    const dir = path.dirname(configPath)
    const files = fs.readdirSync(dir)
    const backup = files.find((f) => f.includes(".bak."))
    expect(backup).toBeDefined()
  })

  it("3. file-with-key(allow-none) -> untouched + sidecar marked", () => {
    const configPath = getConfigPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    const initialContent = `{\n  "[opencode]": {\n    "cross_project_mailbox": {\n      "default_sender_access": "allow-none"\n    }\n  }\n}\n`
    fs.writeFileSync(configPath, initialContent)

    seedUserDefaultSenderAccess()

    const content = fs.readFileSync(configPath, "utf-8")
    expect(content).toBe(initialContent)

    const sidecarPath = getSidecarPath(configPath)
    expect(fs.existsSync(sidecarPath)).toBe(true)
  })

  it("4. sidecar-already-marked + key deleted by user -> untouched (no re-seed)", () => {
    const configPath = getConfigPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    const initialContent = `{\n  "other": true\n}\n`
    fs.writeFileSync(configPath, initialContent)

    const sidecarPath = getSidecarPath(configPath)
    fs.writeFileSync(
      sidecarPath,
      JSON.stringify({ appliedMigrations: ["2026-07-mailbox-default-sender-access-allow-all"] }),
    )

    seedUserDefaultSenderAccess()

    const content = fs.readFileSync(configPath, "utf-8")
    expect(content).toBe(initialContent)
  })

  it("5. malformed JSONC -> skip + log, no write, no crash", () => {
    const configPath = getConfigPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    const initialContent = `{\n  "other": true\n` // missing closing brace
    fs.writeFileSync(configPath, initialContent)

    expect(() => seedUserDefaultSenderAccess()).not.toThrow()

    const content = fs.readFileSync(configPath, "utf-8")
    expect(content).toBe(initialContent)
  })

  it("6. user config with non-empty legacy senders -> warning logged + pending-notice flag file written", () => {
    const configPath = getConfigPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    const initialContent = `{\n  "[opencode]": {\n    "cross_project_mailbox": {\n      "senders": {\n        "project-a": "allow"\n      }\n    }\n  }\n}\n`
    fs.writeFileSync(configPath, initialContent)

    seedUserDefaultSenderAccess()

    const content = fs.readFileSync(configPath, "utf-8")
    expect(content).toContain('"senders": {')
    expect(content).toContain('"default_sender_access": "allow-all"')

    const noticePath = path.join(path.dirname(getSidecarPath(configPath)), "legacy-senders-notice.json")
    expect(fs.existsSync(noticePath)).toBe(true)
    const notice = JSON.parse(fs.readFileSync(noticePath, "utf-8"))
    expect(notice.senders).toEqual(["project-a"])
  })
})
