# Task 11 — Cloudhome contract variants (answer-remote + worker-pr-cloudhome)

## WHAT WAS TESTED
Contract-only local half of the cloudhome remote-execution mailbox lanes. New module
`packages/omo-opencode/src/features/cross-project-mailbox/contracts/`:
- `schema.ts` — `RemoteMailboxRequestSchema` (zod v4, `.strict()`, `version: z.literal(1)`,
  `kind: z.enum(["remote-answer","remote-worker-pr"])`, `noteRef`, `repo`, `gitRef?`,
  `payload`, `replyRouting {toProjectId, correlationId}`).
- `cloudhome.ts` — `selectWorkerPrVariant` (pure D6 selection helper),
  `buildRemoteContractOutbound`, `dispatchRemoteContract` (send-once + pending dedupe),
  `handleRemoteCompletionReply` (threaded-reply intake lifecycle).
- `remote-pending-store.ts` — file-based pending store with an INJECTED fs port
  (`RemotePendingFsPort`), atomic tmp+rename mirroring `mailbox/pending-delivery-store.ts`.
- `cloudhome.test.ts` — 17 given/when/then tests.
- `cloudhome-contract-note.md` — the coordination-note fixture (see "real note" note below).

Commands:
- `bun test packages/omo-opencode/src/features/cross-project-mailbox/contracts`
- `bun run typecheck`

Behaviors proven:
1. Payload schema round-trips; `gitRef` optional; unknown `kind` rejected; extra top-level key
   rejected (`.strict()`).
2. `selectWorkerPrVariant` against the D6 declared-variant criterion: default `worker-pr-local`;
   per-note category `worker-pr-cloudhome` → upgrade; per-sender `worker_pr_variant:"cloudhome"`
   → upgrade; note-level declaration wins over a per-sender `"local"`; unrelated category stays
   local.
3. Pending dedupe: first `answer-remote` decision sends once and records pending
   (`isPending → true`); a second identical decision for the same messageId sends NOTHING and
   returns `{status:"pending-remote", deduped:true}`.
4. Intake completes the lifecycle on a matching threaded reply (ack original note → forward the
   answer to the original requester with `inReplyToMessageId=originalMessageId` → clear pending)
   and leaves pending intact on a non-matching reply (`no-matching-pending`), a reply missing
   `inReplyToMessageId` (`reply-missing-inreplyto`), and a matched-but-empty-body reply
   (`quarantined: empty-remote-completion`, pending kept for retry).

## WHAT WAS OBSERVED
- `bun test …/contracts` → **17 pass / 0 fail**, 31 expect() calls, 1 file.
- `bun run typecheck` → clean across all workspace packages (tsgo, no errors).
- No `as any` / `@ts-ignore` / `@ts-expect-error`. All fs I/O dependency-injected; no
  `mock.module` (memory #2177). Barrel-only `index.ts`. Files under 200 LOC each.

## WHY IT IS ENOUGH
The task is contract-only (local half). Every acceptance-criteria bullet has a dedicated test:
schema round-trip, D6 `selectWorkerPrVariant`, pending dedupe, intake complete + non-match +
malformed. The pending store's fs port is faked in-memory, so the atomic-write/dedupe/secondary-
index (outboundMessageId → original note) logic is exercised without disk. Threading direction
matches `envelope-builder.ts::findProcessedParent` convention: the remote reply's
`inReplyToMessageId` references the OUTBOUND contract note, and the pending record is keyed by
the original messageId with a secondary index by outboundMessageId. Router integration and the
live cloudhome executor are explicitly out of scope (task-12 and cloudhome respectively).

Residual risk: the real cross-project wiring (which `sendOutbound`/`ackOriginal`/`forwardAnswer`
implementations are injected, and where the pending `baseDir` points —
`.omo/mailbox-work/remote-pending/`) is task-12's job; this module only defines the ports.

## REAL CLOUDHOME NOTE — NOT SENT (fixture produced instead)
I did **not** invoke a live `project_message` send to cloudhome. Rationale: this task is being
executed by a delegated implementation subagent authoring library code, not the orchestrator's
live routing session. Sending a real cross-project coordination note is an orchestration-time
side effect that should be issued from the live session with the confirmed outbound grant
(`cloudhome-5aa53d2c`, grant=plan). Per the task's explicit allowance for exactly this case, I
produced the full fixture instead: `contracts/cloudhome-contract-note.md` documents the exact
`project_message` args and body that WOULD be sent, so the orchestrator can send it verbatim.
The fixture honors memory #1416 (no plaintext secrets; reference OCI Vault secret names only)
and marks the note machine-consumable via `category: "machine:remote-mailbox-contract"`
(`REMOTE_CONTRACT_CATEGORY`).

## WHAT WAS OMITTED
No secrets, tokens, or credentials appear in any file or the contract note. No live network
send performed. No router/idle-drain wiring (task-12). No cloudhome-side executor (out of scope).
