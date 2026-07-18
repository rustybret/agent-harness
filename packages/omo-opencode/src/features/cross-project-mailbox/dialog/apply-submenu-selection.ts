import { readFile, writeFile, rename, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

import { detectPluginConfigFile, clearPluginConfigFileDetectionCache } from "../../../shared/jsonc-parser"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "../../../shared/plugin-identity"
import { autoProvisionMailboxConfig } from "../auto-provision"
import { applySelection, MalformedConfigError, type SubmenuOption } from "./menu-model"

export interface ApplySubmenuSelectionDeps {
  directory: string
  projectId: string
  choice: SubmenuOption["choice"]
  resolver: { invalidate: () => void }
}

// Persists a permission-level change to the project's .opencode config file.
// Returns null on success, or a user-facing message on a recoverable
// malformed-config error (the caller decides how to surface it).
export async function applySubmenuSelection(deps: ApplySubmenuSelectionDeps): Promise<string | null> {
  const opencodeDirPath = join(deps.directory, ".opencode")
  let detected = detectPluginConfigFile(opencodeDirPath, {
    basenames: [CONFIG_BASENAME],
    legacyBasenames: [LEGACY_CONFIG_BASENAME],
  })

  if (detected.format === "none") {
    autoProvisionMailboxConfig(deps.directory)
    detected = detectPluginConfigFile(opencodeDirPath, {
      basenames: [CONFIG_BASENAME],
      legacyBasenames: [LEGACY_CONFIG_BASENAME],
    })
  }

  if (detected.format === "none") {
    throw new Error("Failed to provision config file")
  }

  const configPath = detected.path
  let text = ""
  try {
    text = await readFile(configPath, "utf8")
  } catch {
    text = ""
  }

  let nextText: string
  try {
    nextText = applySelection(text, deps.projectId, deps.choice)
  } catch (err) {
    if (err instanceof MalformedConfigError) return err.message
    throw err
  }

  const tmp = `${configPath}.${randomUUID()}.tmp`
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(tmp, nextText, "utf8")
  await rename(tmp, configPath)

  clearPluginConfigFileDetectionCache()
  deps.resolver.invalidate()
  return null
}
