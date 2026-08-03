import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { OMO_SCHEMA_URL } from "../../config-migration"
import { log } from "../../shared/logger"
import { resolveProjectOmoConfigPath } from "./config/omo-config-target"

const stubContent = `{
  "$schema": "${OMO_SCHEMA_URL}",
  "[opencode]": {
    // The cross-project mailbox receives notes and requests from other registered projects.
    // Use /project-mailbox to manage project connections interactively.
    "cross_project_mailbox": {
      // Sender entries use this shape:
      // "<source-projectId>": { "access": "allow"|"deny", "intent_budget": "question"|"impl"|"plan" }
      // The machine-global sender default comes from the user-level config.
      "senders": {}
    }
  }
}
`

// Creates a project-scope `.omo/omo.jsonc` stub when the repo has no omo config
// yet, so `/project-mailbox` has a commented file to write into. Never touches
// an existing config: callers rely on this being a no-op once one is present.
export function autoProvisionMailboxConfig(repoRoot: string): void {
  const configPath = resolveProjectOmoConfigPath(repoRoot)
  if (existsSync(configPath)) return

  try {
    const configDir = path.dirname(configPath)
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
    writeFileSync(configPath, stubContent, "utf8")
  } catch (err) {
    log("[cross-project-mailbox] auto-provision failed", { error: err })
  }
}
