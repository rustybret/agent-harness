import { z } from "zod"
import { OverridableAgentNameSchema } from "../../config/schema/agent-names"

const IntentBudgetSchema = z.enum(["question", "quick", "impl", "review", "work-loop", "plan"])

const SenderConfigSchema = z.object({
  access: z.enum(["allow", "deny"]).default("allow").describe("Whether this source project may deliver into this mailbox"),
  intent_budget: IntentBudgetSchema.describe("Maximum intent tier this source project is permitted to request"),
})

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
    .describe("Default access for source projects not listed in senders"),
  senders: z
    .record(z.string(), SenderConfigSchema)
    .default({})
    .describe("Per-source-project access and intent budget. The key is the source projectId; membership with access allow is the allowlist."),
  bounds: CrossProjectMailboxBoundsSchema.default(() => CrossProjectMailboxBoundsSchema.parse({})),
})

export type CrossProjectMailboxConfig = z.infer<typeof CrossProjectMailboxConfigSchema>
