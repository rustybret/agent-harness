import * as fs from "node:fs"
import * as path from "node:path"
import { parse, modify, applyEdits } from "jsonc-parser"
import { getOpenCodeConfigDirs, detectPluginConfigFile, CONFIG_BASENAME, LEGACY_CONFIG_BASENAME, log } from "../../../shared"
import { readAppliedMigrations, writeAppliedMigrations, getSidecarPath } from "@oh-my-opencode/utils"
import { writeFileAtomically } from "../../../shared/write-file-atomically"

const MIGRATION_KEY = "2026-07-mailbox-default-sender-access-allow-all"

export function seedUserDefaultSenderAccess(): void {
  try {
    const userConfigDirs = [...getOpenCodeConfigDirs({ binary: "opencode" })].reverse()
    const primaryConfigDir = userConfigDirs[0]
    if (!primaryConfigDir) return

    const detected = detectPluginConfigFile(primaryConfigDir, {
      basenames: [CONFIG_BASENAME],
      legacyBasenames: [LEGACY_CONFIG_BASENAME],
    })

    const configPath = detected.format !== "none" ? detected.path : path.join(primaryConfigDir, `${CONFIG_BASENAME}.jsonc`)

    const applied = readAppliedMigrations(configPath)
    if (applied.has(MIGRATION_KEY)) {
      return
    }

    if (!fs.existsSync(configPath)) {
      // 1. absent-file -> created with key
      const initialContent = `// https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json\n{\n  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json",\n  "cross_project_mailbox": {\n    // Allow inbound cross-project messages by default\n    "default_sender_access": "allow-all"\n  }\n}\n`
      fs.mkdirSync(path.dirname(configPath), { recursive: true })
      writeFileAtomically(configPath, initialContent)
      applied.add(MIGRATION_KEY)
      writeAppliedMigrations(configPath, applied)
      return
    }

    const text = fs.readFileSync(configPath, "utf-8")
    let root: unknown
    try {
      const errors: any[] = []
      root = parse(text, errors)
      if (errors.length > 0) {
        log("seedUserDefaultSenderAccess skipped: malformed file", { errors })
        return
      }
    } catch (error) {
      log("seedUserDefaultSenderAccess skipped: malformed file", { error })
      return
    }

    if (!root || typeof root !== "object" || Array.isArray(root)) {
      log("seedUserDefaultSenderAccess skipped: root is not an object")
      return
    }

    const config = root as Record<string, any>
    const mailbox = config.cross_project_mailbox

    if (mailbox && typeof mailbox === "object" && !Array.isArray(mailbox)) {
      if (mailbox.senders && Object.keys(mailbox.senders).length > 0) {
        const senders = Object.keys(mailbox.senders)
        log("Legacy cross_project_mailbox.senders detected", { senders })
        const sidecarPath = getSidecarPath(configPath)
        const noticePath = path.join(path.dirname(sidecarPath), "legacy-senders-notice.json")
        writeFileAtomically(noticePath, JSON.stringify({ senders }, null, 2) + "\n")
      }

      if ("default_sender_access" in mailbox) {
        applied.add(MIGRATION_KEY)
        writeAppliedMigrations(configPath, applied)
        return
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupPath = `${configPath}.bak.${timestamp}`
    fs.copyFileSync(configPath, backupPath)

    const edits = modify(text, ["cross_project_mailbox", "default_sender_access"], "allow-all", {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
    const next = applyEdits(text, edits)

    writeFileAtomically(configPath, next)
    
    applied.add(MIGRATION_KEY)
    writeAppliedMigrations(configPath, applied)

  } catch (error) {
    log("seedUserDefaultSenderAccess failed", { error })
  }
}
