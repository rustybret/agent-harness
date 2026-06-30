import type { OhMyOpenCodeConfig } from "../../config"
import { CrossProjectMailboxConfigSchema } from "./config"

export function applyMailboxDefault(config: OhMyOpenCodeConfig): OhMyOpenCodeConfig {
  if (config.cross_project_mailbox !== undefined) return config
  return {
    ...config,
    cross_project_mailbox: CrossProjectMailboxConfigSchema.parse({}),
  }
}
