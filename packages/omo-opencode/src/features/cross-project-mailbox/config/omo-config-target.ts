import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

import { resolveUserOmoConfigPath } from "@oh-my-opencode/omo-config-core"

// Mailbox settings live under the OpenCode harness block of the unified omo
// config, so every writer must agree on this prefix. `validatePluginConfig`
// reads the same block back through `loadOmoOpenCodeConfigChain`.
export const MAILBOX_HARNESS_KEY = "[opencode]"
export const MAILBOX_CONFIG_KEY = "cross_project_mailbox"

export function mailboxKeyPath(...segments: readonly string[]): string[] {
  return [MAILBOX_HARNESS_KEY, MAILBOX_CONFIG_KEY, ...segments]
}

function preferExistingJsoncPath(jsoncPath: string): string {
  if (existsSync(jsoncPath)) return jsoncPath
  const jsonPath = join(dirname(jsoncPath), "omo.json")
  return existsSync(jsonPath) ? jsonPath : jsoncPath
}

// Resolves the project-scope omo config path for a repo root. Mirrors
// `resolveWritePath` in omo-config-core: prefer an existing file, otherwise
// name the canonical `.omo/omo.jsonc` target.
export function resolveProjectOmoConfigPath(repoRoot: string): string {
  return preferExistingJsoncPath(join(repoRoot, ".omo", "omo.jsonc"))
}

// Resolves the user-scope omo config path (~/.omo/omo.jsonc), preferring an
// existing `omo.json` when the user already keeps one.
export function resolveUserOmoConfigTargetPath(): string {
  return preferExistingJsoncPath(resolveUserOmoConfigPath())
}
