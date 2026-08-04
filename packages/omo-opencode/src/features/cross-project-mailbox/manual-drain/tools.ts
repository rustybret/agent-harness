import { type ToolDefinition, tool } from "@opencode-ai/plugin/tool"

import { runProjectMailboxDrain } from "./drain"
import { runProjectMailboxPeek } from "./peek"
import type { ManualMailboxToolDeps } from "./types"

export function createProjectMailboxPeekTool(deps: ManualMailboxToolDeps): ToolDefinition {
  return tool({
    description:
      "List unread inbound cross-project mailbox notes without reserving or consuming them, and report whether automatic idle drain is currently gated shut",
    args: {},
    execute: async (_rawArgs, toolContext) => {
      const sessionId = (toolContext as { sessionID?: string }).sessionID ?? "manual-peek"
      return JSON.stringify(await runProjectMailboxPeek(deps, sessionId))
    },
  })
}

export function createProjectMailboxDrainTool(deps: ManualMailboxToolDeps): ToolDefinition {
  return tool({
    description: "Drain unread inbound cross-project mailbox notes synchronously without waiting for session.idle",
    args: {},
    execute: async (_rawArgs, toolContext) => {
      const sessionId = (toolContext as { sessionID?: string }).sessionID ?? "manual-drain"
      return JSON.stringify(await runProjectMailboxDrain(deps, sessionId))
    },
  })
}
