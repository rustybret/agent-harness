import { log } from "../../../shared/logger"

import type { ProjectRegistry } from "./project-registry"

export async function ensureSelfRegistered(args: {
  registry: ProjectRegistry
  repoRoot: string
}): Promise<{ created: boolean } | null> {
  try {
    const result = await args.registry.registerProject(args.repoRoot)
    log("[cross-project-mailbox] self-registration", {
      repoRoot: args.repoRoot,
      created: result.created,
    })
    return result
  } catch (error) {
    log("[cross-project-mailbox] self-registration failed", {
      repoRoot: args.repoRoot,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    })
    return null
  }
}
