import type { MailboxMessage } from "../envelope/schema"
import { emitMailboxTrace } from "../trace"
import type { MailboxTraceSink } from "../trace"

export interface SendTraceContext {
  readonly repoRoot: string
  readonly fromProjectId: string
  readonly sink?: MailboxTraceSink
}

type SendTracePhase = "blocked" | "sent" | "write-failed"

function traceEmitDeps(ctx: SendTraceContext): { repoRoot: string; sink?: MailboxTraceSink } {
  return ctx.sink === undefined ? { repoRoot: ctx.repoRoot } : { repoRoot: ctx.repoRoot, sink: ctx.sink }
}

// Blocked before an envelope is built (no messageId/correlationId yet): target resolution failure.
export function emitSendBlockedNoEnvelope(ctx: SendTraceContext, toProjectId: string, detail: string): void {
  emitMailboxTrace(
    {
      phase: "blocked",
      messageId: "",
      correlationId: "",
      fromProjectId: ctx.fromProjectId,
      toProjectId,
      detail,
      at: Date.now(),
    },
    traceEmitDeps(ctx),
  )
}

// Envelope-scoped send emit shared by preflight-blocked, sent, and write-failed. Bridges the
// wire field requested_mode (snake_case) to the camelCase audit field via conditional spread.
export function emitSendEnvelopeTrace(input: {
  readonly ctx: SendTraceContext
  readonly phase: SendTracePhase
  readonly envelope: MailboxMessage
  readonly toProjectId: string
  readonly detail?: string
}): void {
  emitMailboxTrace(
    {
      phase: input.phase,
      messageId: input.envelope.messageId,
      correlationId: input.envelope.correlationId,
      fromProjectId: input.ctx.fromProjectId,
      toProjectId: input.toProjectId,
      ...(input.envelope.requested_mode === undefined ? {} : { requestedMode: input.envelope.requested_mode }),
      ...(input.detail === undefined ? {} : { detail: input.detail }),
      at: Date.now(),
    },
    traceEmitDeps(input.ctx),
  )
}
