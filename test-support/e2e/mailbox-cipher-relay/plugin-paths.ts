import { existsSync } from "node:fs"
import path from "node:path"

const DEFAULT_GEMINI_PLUGIN_PATH = "/Volumes/Topper2TB/Git/opencode-gemini/packages/opencode"
const DEFAULT_ANTHROPIC_PLUGIN_PATH = "/Volumes/Topper2TB/Git/anthropic-auth/packages/opencode"

export function relayPluginPaths(repoRoot: string, model: string): readonly string[] {
  const omoPluginPath = process.env["MAILBOX_E2E_PLUGIN"] ?? path.join(repoRoot, "dist", "index.js")
  const geminiPluginPath = process.env["MAILBOX_E2E_GEMINI_PLUGIN"] ?? DEFAULT_GEMINI_PLUGIN_PATH
  const anthropicPluginPath = process.env["MAILBOX_E2E_ANTHROPIC_PLUGIN"] ?? DEFAULT_ANTHROPIC_PLUGIN_PATH

  const pluginPaths = [omoPluginPath]
  if (model.toLowerCase().includes("antigravity") && existsSync(geminiPluginPath)) {
    pluginPaths.unshift(geminiPluginPath)
  }
  if (model.startsWith("anthropic/") && existsSync(anthropicPluginPath)) {
    pluginPaths.unshift(anthropicPluginPath)
  }

  return pluginPaths.map((pluginPath) => `file://${pluginPath}`)
}
