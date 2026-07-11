import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { log } from "../../shared/logger"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "../../shared/plugin-identity"
import {
  clearPluginConfigFileDetectionCache,
  detectPluginConfigFile,
} from "../../shared/jsonc-parser"

const LOCAL_SCHEMA_PATH =
  "/Volumes/Topper2TB/Git/agent-harness/assets/oh-my-opencode.schema.json"

const stubContent = (schemaPath: string) =>
  `{
  "$schema": "${schemaPath}",
  // The cross-project mailbox receives notes and requests from other registered projects.
  // Use /project-mailbox to manage project connections interactively.
  "cross_project_mailbox": {
    // Sender entries use this shape:
    // "<source-projectId>": { "access": "allow"|"deny", "intent_budget": "question"|"impl"|"plan" }
    // The machine-global sender default comes from the user-level config.
    "senders": {}
  }
}
`

export function autoProvisionMailboxConfig(repoRoot: string): void {
  const opencodeDirPath = path.join(repoRoot, ".opencode")

  const detected = detectPluginConfigFile(opencodeDirPath, {
    basenames: [CONFIG_BASENAME],
    legacyBasenames: [LEGACY_CONFIG_BASENAME],
  })
  if (detected.format !== "none") return

  const configPath = path.join(opencodeDirPath, `${CONFIG_BASENAME}.jsonc`)
  const schemaPath = existsSync(LOCAL_SCHEMA_PATH)
    ? `file://${LOCAL_SCHEMA_PATH}`
    : "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json"

  try {
    if (!existsSync(opencodeDirPath)) {
      mkdirSync(opencodeDirPath, { recursive: true })
    }
    writeFileSync(configPath, stubContent(schemaPath), "utf8")
    clearPluginConfigFileDetectionCache()
  } catch (err) {
    log("[cross-project-mailbox] auto-provision failed", { error: err })
  }
}
