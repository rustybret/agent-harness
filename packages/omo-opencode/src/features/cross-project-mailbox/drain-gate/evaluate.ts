import type { CrossProjectMailboxConfig } from "../config"

export type DrainBlockReason = "disabled" | "permissionless-config" | "primary-not-eligible"

export type DrainGateVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false
      readonly reason: DrainBlockReason
      // Reviewer-readable sentence naming what is blocking and what would unblock it. This is the
      // string surfaced to an agent, so it must stand alone without the reason code.
      readonly detail: string
      readonly activePrimary?: string
    }

function isEligiblePrimary(config: CrossProjectMailboxConfig, primary: string): boolean {
  return (config.intake_eligible_agents as readonly string[]).includes(primary)
}

// A permissionless config accepts nothing: no sender is explicitly allowed and the default is
// allow-none, so draining could only ever quarantine. Treated as a gate rather than per-note
// rejection so the operator sees one cause instead of N identical rejections.
function isPermissionlessConfig(config: CrossProjectMailboxConfig): boolean {
  if (config.default_sender_access !== "allow-none") return false
  return !Object.values(config.senders ?? {}).some((sender) => sender.access === "allow")
}

// Config-level blocks only: the two cases that hold regardless of which agent is active. Split out
// so a caller can settle them WITHOUT a session lookup, keeping a disabled or permissionless
// mailbox completely inert (no primary resolution, no registry read, no store access).
export function evaluateConfigDrainGate(config: CrossProjectMailboxConfig): DrainGateVerdict {
  if (config.enabled === false) {
    return {
      allowed: false,
      reason: "disabled",
      detail: "cross_project_mailbox.enabled is false, so inbound notes are never drained.",
    }
  }
  if (isPermissionlessConfig(config)) {
    return {
      allowed: false,
      reason: "permissionless-config",
      detail:
        "No sender is allowed: default_sender_access is allow-none and no entry in senders has access allow, so every inbound note would be rejected.",
    }
  }
  return { allowed: true }
}

// THE single source of truth for "would an automatic drain deliver anything right now".
// Both the idle-drain hook (which acts on it) and project_mailbox_peek (which reports it) call
// this, so the reason an agent is shown can never drift from the reason the drain actually used.
export function evaluateDrainGate(
  config: CrossProjectMailboxConfig,
  activePrimary: string | undefined,
): DrainGateVerdict {
  const configVerdict = evaluateConfigDrainGate(config)
  if (!configVerdict.allowed) return configVerdict
  if (activePrimary !== undefined && isEligiblePrimary(config, activePrimary)) return { allowed: true }

  const eligible = (config.intake_eligible_agents as readonly string[]).join(", ")
  return {
    allowed: false,
    reason: "primary-not-eligible",
    ...(activePrimary === undefined ? {} : { activePrimary }),
    detail:
      activePrimary === undefined
        ? `No active primary agent is recorded for this session, so intake is held closed. Eligible agents: ${eligible}.`
        : `The active primary agent is '${activePrimary}', which is not in intake_eligible_agents (${eligible}). Switch to an eligible agent or drain manually with project_mailbox_drain.`,
  }
}
