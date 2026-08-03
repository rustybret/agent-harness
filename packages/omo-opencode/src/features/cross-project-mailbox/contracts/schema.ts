import { z } from "zod"

export const REMOTE_MAILBOX_REQUEST_KINDS = ["remote-answer", "remote-worker-pr"] as const

export type RemoteMailboxRequestKind = (typeof REMOTE_MAILBOX_REQUEST_KINDS)[number]

// Versioned wire contract for a remote-execution request handed to cloudhome. This is the
// LOCAL half only: agent-harness constructs and sends this payload, then intakes the
// threaded completion reply. The cloudhome-side executor that consumes this payload is out
// of scope for this repo (delegated via project_message per memory #2010).
export const RemoteMailboxRequestSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(REMOTE_MAILBOX_REQUEST_KINDS),
    noteRef: z.string(),
    repo: z.string(),
    gitRef: z.string().optional(),
    payload: z.string(),
    replyRouting: z
      .object({
        toProjectId: z.string(),
        correlationId: z.string(),
      })
      .strict(),
  })
  .strict()

export type RemoteMailboxRequest = z.infer<typeof RemoteMailboxRequestSchema>
