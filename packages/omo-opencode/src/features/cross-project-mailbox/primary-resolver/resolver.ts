import { getAgentConfigKey } from "../../../shared/agent-display-names"
import { getSessionAgent, resolveRegisteredAgentName } from "../../claude-code-session-state/state"

export function resolveActivePrimaryAgent(sessionId: string): string | undefined {
  const raw = getSessionAgent(sessionId)
  if (!raw) return undefined
  const resolved = resolveRegisteredAgentName(raw)
  return resolved ? getAgentConfigKey(resolved) : getAgentConfigKey(raw)
}
