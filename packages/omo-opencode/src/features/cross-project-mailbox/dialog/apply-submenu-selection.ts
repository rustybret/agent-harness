import { readFile, writeFile, rename, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"

import { autoProvisionMailboxConfig } from "../auto-provision"
import { resolveProjectOmoConfigPath } from "../config/omo-config-target"
import { applySelection, MalformedConfigError, type SubmenuOption } from "./menu-model"

export interface ApplySubmenuSelectionDeps {
  directory: string
  projectId: string
  choice: SubmenuOption["choice"]
  resolver: { invalidate: () => void }
}

// Persists a permission-level change to the project's unified omo config
// (.omo/omo.jsonc), under the "[opencode]" harness block that
// `loadOmoOpenCodeConfigChain` reads back. Returns null on success, or a
// user-facing message on a recoverable malformed-config error (the caller
// decides how to surface it).
export async function applySubmenuSelection(deps: ApplySubmenuSelectionDeps): Promise<string | null> {
  autoProvisionMailboxConfig(deps.directory)
  const configPath = resolveProjectOmoConfigPath(deps.directory)

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

  deps.resolver.invalidate()
  return null
}
