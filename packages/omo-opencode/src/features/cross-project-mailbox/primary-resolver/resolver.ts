import { getAgentConfigKey } from "../../../shared/agent-display-names"
import { getSessionAgent, resolveRegisteredAgentName } from "../../claude-code-session-state/state"

export function normalizePrimaryAgent(agent: string | undefined): string | undefined {
  if (!agent) return undefined
  const resolved = resolveRegisteredAgentName(agent)
  return resolved ? getAgentConfigKey(resolved) : getAgentConfigKey(agent)
}

export function resolveActivePrimaryAgent(sessionId: string): string | undefined {
  const raw = getSessionAgent(sessionId)
  return normalizePrimaryAgent(raw)
}
