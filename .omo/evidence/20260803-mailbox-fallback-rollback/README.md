# Mailbox idle-drain: `fallback-next-drain` leaked reservation + body digest

## What was tested

The reported bug: notes sent from `opencode-release-watch` (ORW) to `cloudhome` never
appeared in cloudhome's unread count and were not drained while the session sat idle,
until the mailbox was manually bumped.

Investigated against the live on-disk mailbox state in
`/Volumes/Topper2TB/Git/cloudhome/coordination_notes/opencode-release-watch-4543544f/`
(sender directory for ORW inside cloudhome), then reproduced the defect as a unit
regression test driving the real `createIdleDrainHook` → `processNote` path.

## What was observed

### Live state (root-cause evidence)

The sender directory showed notes split across `processed/` and `rejected/`, with
`*.reason.json` sidecars on the rejected ones citing duplicate-body rejection — even
though the rejected notes carried **distinct** `messageId`s and distinct bodies from
anything previously delivered. `coordination_notes/.digests.json` held **zero** entries
for the ORW sender, i.e. the digest that caused the rejection was recorded and then
never observable, consistent with a record-without-rollback path.

### Defect

In `packages/omo-opencode/src/features/cross-project-mailbox/hooks/idle-drain-processor.ts`,
`completeRouteExecution()` handled the `fallback-next-drain` lane result by adding the
message id to `fallbackIds` and returning `false` — without calling
`rollbackReservedDelivery()`.

Every other non-delivering branch (`rolled-back`, lane exception) rolls back. This one
did not, so a note deferred to the next drain left behind:

1. its `.delivering-<id>.md` reservation, so the note no longer counted as unread
   (`drainUnread` skips reserved entries) — the note vanished from the unread count; and
2. its recorded body digest, so when the note *was* retried, the loop guard saw the
   digest it had itself recorded on the previous attempt and rejected the redelivery as
   a duplicate.

That is precisely the reported symptom pair: missing from the unread count, and not
drained on idle until manually bumped.

### Fix

`fallback-next-drain` now calls `rollbackReservedDelivery()` (releasing the reservation
and rolling back the body digest) and emits a `rolled-back` trace with detail
`fallback-next-drain:<reason>`, matching the existing rollback branches.

### Verification

Regression test: `hooks/idle-drain-fallback-rollback.test.ts`, driving the real
`createIdleDrainHook` with a lane stub that returns a rollback/downgrade result.

- Against **pre-fix** code (fix stashed): FAILS —
  `expect(unreserve).toHaveBeenCalledWith("msg-rolled-back")` → "But it was not called."
  (1 pass / 1 fail)
- Against **fixed** code: PASSES (2 pass / 0 fail)

The second case pins the redelivery contract: on the following drain the note is retried
as legacy triage (`forceLegacyTriage`) and dispatches, rather than being rejected as a
duplicate — `markDispatched` called exactly once across two idle drains.

Suite gates after the fix:

- `bun test` (full): 13672 pass / 7 skip / 0 fail across 1753 files
- `bun run typecheck`: exit 0
- mailbox feature suite: 731 pass / 0 fail across 55 files

## Why it is enough

The failing-then-passing regression test isolates the exact branch at fault and proves
the two leaked resources (reservation, digest) are both released, which are the two
mechanisms behind the two reported symptoms. The live on-disk state independently
corroborates the same conclusion: distinct-id notes rejected as duplicates with an empty
digest store.

## What was omitted

No live cross-project send was replayed between ORW and cloudhome — that would mutate
another project's real mailbox state. Note bodies from the live cloudhome mailbox are
summarized rather than copied here; no credentials, tokens, or note payloads are
reproduced in this file.
