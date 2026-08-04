import { isHephaestusSupportedModel } from "./hephaestus"

/**
 * A hard model requirement that decides whether an agent can register at all.
 *
 * This is distinct from AGENT_MODEL_REQUIREMENTS, which describes the fallback chain used to PICK a
 * model. A constraint describes the models an agent will REFUSE, and refusing means the agent is
 * dropped from the session entirely. Both the registration path and any diagnostic surface read
 * from here so a user-visible report cannot drift from the behavior it reports on.
 */
export interface AgentModelConstraint {
  readonly agent: string
  readonly supports: (model: string | undefined) => boolean
  readonly requirement: string
}

export const AGENT_MODEL_CONSTRAINTS: readonly AgentModelConstraint[] = [
  {
    agent: "hephaestus",
    supports: isHephaestusSupportedModel,
    requirement: "GPT-5.3 Codex, GPT-5.4, GPT-5.5, or GPT-5.6",
  },
]

export function findAgentModelConstraint(agent: string): AgentModelConstraint | undefined {
  return AGENT_MODEL_CONSTRAINTS.find((constraint) => constraint.agent === agent)
}

/**
 * Reports whether a configured model would cause the agent to be dropped during registration.
 *
 * Returns undefined when the agent has no constraint or the model satisfies it, so a caller can
 * treat any returned value as "this configuration silently loses an agent".
 */
export function findUnsupportedAgentModel(input: {
  readonly agent: string
  readonly model: string | undefined
}): AgentModelConstraint | undefined {
  const constraint = findAgentModelConstraint(input.agent)
  if (constraint === undefined) return undefined
  return constraint.supports(input.model) ? undefined : constraint
}
