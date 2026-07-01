import { log } from "../../../shared/logger"
import type { CrossProjectMailboxConfig } from "../config"
import { readPresenceStatus } from "../presence"
import { createProjectRegistry } from "../registry"
import {
  OUTBOUND_BUDGET_MAX_TARGETS,
  readOutboundBudget,
  selectOutboundBudgetInjection,
  type OutboundBudgetRegistryPort,
} from "./outbound-budget"

type TransformPart = {
  type: string
  text?: string
  synthetic?: boolean
  [key: string]: unknown
}

type TransformMessageInfo = {
  role: string
  sessionID?: string
  [key: string]: unknown
}

type MessageWithParts = {
  info: TransformMessageInfo
  parts: TransformPart[]
}

type OutboundBudgetInjectorInput = {
  sessionID?: string
  [key: string]: unknown
}

type OutboundBudgetInjectorOutput = {
  messages: MessageWithParts[]
}

export type OutboundBudgetInjectorHook = {
  "experimental.chat.messages.transform"?: (
    input: OutboundBudgetInjectorInput,
    output: OutboundBudgetInjectorOutput,
  ) => Promise<void>
}

export interface OutboundBudgetInjectorDeps {
  config: CrossProjectMailboxConfig
  directory: string
  registry?: OutboundBudgetRegistryPort
  readPresence?: (projectId: string) => Promise<import("../presence").PresenceStatus>
}

function resolveSessionID(
  input: OutboundBudgetInjectorInput,
  messages: MessageWithParts[],
): string | undefined {
  if (typeof input.sessionID === "string" && input.sessionID.length > 0) {
    return input.sessionID
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const sessionID = messages[index]?.info.sessionID
    if (typeof sessionID === "string" && sessionID.length > 0) {
      return sessionID
    }
  }
  return undefined
}

function findLastUserMessageIndex(messages: MessageWithParts[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.info.role === "user") {
      return index
    }
  }
  return -1
}

function createInjectedMessage(sessionID: string, content: string): MessageWithParts {
  return {
    info: { role: "user", sessionID },
    parts: [{ type: "text", text: content, synthetic: true }],
  }
}

export function createOutboundBudgetInjector(
  deps: OutboundBudgetInjectorDeps,
): OutboundBudgetInjectorHook {
  const lastInjectedHashBySession = new Map<string, string>()
  const registry = deps.registry ?? createProjectRegistry()
  const readPresence =
    deps.readPresence ?? ((projectId: string) => readPresenceStatus(projectId))

  return {
    "experimental.chat.messages.transform": async (input, output) => {
      if (deps.config.enabled === false || output.messages.length === 0) {
        return
      }

      const sessionID = resolveSessionID(input, output.messages)
      if (sessionID === undefined) {
        return
      }

      try {
        const rows = await readOutboundBudget(deps.config, registry, {
          readPresence,
          maxTargets: OUTBOUND_BUDGET_MAX_TARGETS,
        })
        const decision = selectOutboundBudgetInjection(sessionID, rows, lastInjectedHashBySession)
        if (!decision.inject || decision.text === undefined) {
          return
        }

        const injectedMessage = createInjectedMessage(sessionID, decision.text)
        const lastUserMessageIndex = findLastUserMessageIndex(output.messages)
        if (lastUserMessageIndex === -1) {
          output.messages.unshift(injectedMessage)
          return
        }
        output.messages.splice(lastUserMessageIndex, 0, injectedMessage)
      } catch (error) {
        log("[outbound-budget-injector] Failed to inject advisory outbound budget", {
          error: error instanceof Error ? error.message : String(error),
          sessionID,
        })
      }
    },
  }
}
