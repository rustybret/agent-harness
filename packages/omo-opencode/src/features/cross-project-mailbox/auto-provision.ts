import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const LOCAL_SCHEMA_PATH =
  "/Volumes/Topper2TB/Git/agent-harness/assets/oh-my-opencode.schema.json"

const stubContent = (schemaPath: string) =>
  `{
  "$schema": "${schemaPath}",
  "cross_project_mailbox": {
    "enabled": false,
    "default_sender_access": "allow-none",
    "senders": {}
  }
}
`

export function autoProvisionMailboxConfig(repoRoot: string): void {
  const opencodeDirPath = path.join(repoRoot, ".opencode")
  const configPath = path.join(opencodeDirPath, "oh-my-openagent.jsonc")

  if (existsSync(configPath)) return

  const schemaPath = existsSync(LOCAL_SCHEMA_PATH)
    ? `file://${LOCAL_SCHEMA_PATH}`
    : "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json"

  try {
    if (!existsSync(opencodeDirPath)) {
      mkdirSync(opencodeDirPath, { recursive: true })
    }
    writeFileSync(configPath, stubContent(schemaPath), "utf8")
  } catch (err) {
    console.error("[cross-project-mailbox] auto-provision failed:", err)
  }
}
