import * as fs from "node:fs"
import * as path from "node:path"
import { parse, modify, applyEdits } from "jsonc-parser"
import { readAppliedMigrations, writeAppliedMigrations, getSidecarPath } from "@oh-my-opencode/utils"

import { OMO_SCHEMA_URL } from "../../../config-migration"
import { log } from "../../../shared"
import { writeFileAtomically } from "../../../shared/write-file-atomically"
import {
  MAILBOX_CONFIG_KEY,
  MAILBOX_HARNESS_KEY,
  mailboxKeyPath,
  resolveUserOmoConfigTargetPath,
} from "./omo-config-target"

const MIGRATION_KEY = "2026-07-mailbox-default-sender-access-allow-all"

const INITIAL_CONTENT = `{
  "$schema": "${OMO_SCHEMA_URL}",
  "${MAILBOX_HARNESS_KEY}": {
    "${MAILBOX_CONFIG_KEY}": {
      // Allow inbound cross-project messages by default
      "default_sender_access": "allow-all"
    }
  }
}
`

export function seedUserDefaultSenderAccess(): void {
  try {
    const configPath = resolveUserOmoConfigTargetPath()

    const applied = readAppliedMigrations(configPath)
    if (applied.has(MIGRATION_KEY)) {
      return
    }

    if (!fs.existsSync(configPath)) {
      // 1. absent-file -> created with key
      fs.mkdirSync(path.dirname(configPath), { recursive: true })
      writeFileAtomically(configPath, INITIAL_CONTENT)
      applied.add(MIGRATION_KEY)
      writeAppliedMigrations(configPath, applied)
      return
    }

    const text = fs.readFileSync(configPath, "utf-8")
    let root: unknown
    try {
      const errors: unknown[] = []
      root = parse(text, errors as Parameters<typeof parse>[1])
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

    const config = root as Record<string, Record<string, unknown> | undefined>
    const harness = config[MAILBOX_HARNESS_KEY]
    const mailbox =
      harness && typeof harness === "object" && !Array.isArray(harness)
        ? (harness[MAILBOX_CONFIG_KEY] as Record<string, unknown> | undefined)
        : undefined

    if (mailbox && typeof mailbox === "object" && !Array.isArray(mailbox)) {
      const senders = mailbox.senders
      if (senders && typeof senders === "object" && Object.keys(senders).length > 0) {
        const senderIds = Object.keys(senders)
        log("Legacy cross_project_mailbox.senders detected", { senders: senderIds })
        const sidecarPath = getSidecarPath(configPath)
        const noticePath = path.join(path.dirname(sidecarPath), "legacy-senders-notice.json")
        writeFileAtomically(noticePath, JSON.stringify({ senders: senderIds }, null, 2) + "\n")
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

    const edits = modify(text, mailboxKeyPath("default_sender_access"), "allow-all", {
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
