import { z } from "zod"
import { OverridableAgentNameSchema } from "../../config/schema/agent-names"
import { LEGACY_INTENT_MAP, MAILBOX_MODES, modeWithinBudget } from "./permission-tiers"
import type { MailboxMode } from "./permission-tiers"

const IntentBudgetSchema = z
  .enum(["question", "quick", "impl", "review", "work-loop", "plan"])
  .transform((value) => LEGACY_INTENT_MAP[value] ?? "impl")
  .pipe(z.enum(["question", "impl", "plan"]))

// allowed_modes uses a plain z.enum array (NO .transform): zod .transform() strips the
// enum metadata from the generated JSON schema (memory #1570). IntentBudgetSchema above
// works around that with a .transform().pipe() only because it must fold 6 legacy tiers
// into 3 canonical ones; allowed_modes needs no coercion, so a bare enum keeps the JSON
// schema's enum list intact.
export const SenderConfigSchema = z.object({
  access: z.enum(["allow", "deny"]).default("allow").describe("Whether this source project may deliver into this mailbox"),
  intent_budget: IntentBudgetSchema.describe("Maximum intent tier this source project is permitted to request"),
  allowed_modes: z
    .array(z.enum(MAILBOX_MODES))
    .optional()
    .describe(
      "Optional allowlist of requested_mode lanes this source project may use. Absent = every mode whose tier fits within intent_budget is implicitly allowed.",
    ),
  worker_pr_variant: z
    .enum(["local", "cloudhome"])
    .optional()
    .describe(
      "Optional substrate for this source project's worker-pr notes. Absent or 'local' = local headless worktree worker (default); 'cloudhome' = delegate execution to cloudhome via the request/PR-intake contract. A note-level worker-pr-cloudhome category overrides this per-sender default.",
    ),
})

export type SenderConfig = z.infer<typeof SenderConfigSchema>

const CrossProjectMailboxBoundsSchema = z
  .object({
    max_hops: z.number().int().default(4).describe("Maximum forwarding hops a note may traverse before it is dropped"),
    max_notes_per_drain: z.number().int().default(5).describe("Maximum number of notes delivered in a single idle drain"),
    same_pair_rate_limit_per_min: z
      .number()
      .int()
      .default(6)
      .describe("Maximum notes per minute allowed between the same source/destination pair"),
    body_digest_ttl_min: z
      .number()
      .int()
      .default(60)
      .describe("Minutes a body digest is retained for duplicate-note suppression"),
    max_body_bytes: z.number().int().default(32768).describe("Maximum note body size in bytes"),
    reservation_ttl_ms: z
      .number()
      .int()
      .default(120000)
      .describe("Milliseconds a delivery reservation is held before it expires"),
    max_delivery_attempts: z
      .number()
      .int()
      .default(3)
      .describe("Maximum delivery attempts for a note before it is quarantined as max-retries-exceeded"),
  })
  .describe("Safety bounds that throttle and cap cross-project delivery")

export const CrossProjectMailboxConfigSchema = z.object({
  enabled: z.boolean().default(true).describe("Enable cross-project mailbox delivery (default: true)"),
  intake_eligible_agents: z
    .array(OverridableAgentNameSchema)
    .default(["sisyphus"])
    .describe("Agents permitted to receive cross-project notes during an idle drain"),
  interrupt_policy: z
    .enum(["idle-drain", "allow-interrupt", "block-idle-input"])
    .default("idle-drain")
    .describe("How incoming notes interact with the live session. Only idle-drain is implemented; the others are declared-only stubs."),
  default_sender_access: z
    .enum(["allow-all", "allow-none"])
    .default("allow-none")
    .describe("Default access for source projects not listed in senders. User-level config conventionally seeds 'allow-all'; the unlisted-sender ceiling is 'question'."),
  senders: z
    .record(z.string(), SenderConfigSchema)
    .default({})
    .describe("Per-source-project access and intent budget. The key is the source projectId; membership with access allow is the allowlist."),
  launch_policy: z
    .enum(["disabled", "ask", "auto"])
    .default("disabled")
    .describe("Whether the sender may launch an offline target's session before delivery: disabled never launches, ask requests permission, auto launches without asking."),
  bounds: CrossProjectMailboxBoundsSchema.default(() => CrossProjectMailboxBoundsSchema.parse({})),
})

export type CrossProjectMailboxConfig = z.infer<typeof CrossProjectMailboxConfigSchema>

export interface DowngradeDecision {
  effectiveMode: MailboxMode | undefined
  downgradeReason?: string
}

// Pure, no-I/O receiver-authoritative mode gate. Given a note's requested_mode and the
// resolved sender config, decide whether the mode is honored or downgraded to legacy
// main-session triage (effectiveMode undefined). NEVER hard-rejects an otherwise-valid
// note — an over-budget or disallowed mode is silently downgraded with a recorded reason.
// A note carrying no requested_mode returns the legacy path (undefined, no reason) so the
// existing validate-inbound accept/reject behavior is left byte-identical.
export function decideDowngrade(
  note: { requested_mode?: MailboxMode },
  senderCfg: SenderConfig,
): DowngradeDecision {
  const mode = note.requested_mode
  if (mode === undefined) {
    return { effectiveMode: undefined }
  }
  // Budget check first: an over-budget mode is downgraded regardless of the allowlist.
  if (!modeWithinBudget(mode, senderCfg.intent_budget)) {
    return { effectiveMode: undefined, downgradeReason: "mode-over-budget" }
  }
  // Allowlist gate: only when present and it omits the mode.
  if (senderCfg.allowed_modes !== undefined && !senderCfg.allowed_modes.includes(mode)) {
    return { effectiveMode: undefined, downgradeReason: "mode-not-allowed" }
  }
  return { effectiveMode: mode }
}
