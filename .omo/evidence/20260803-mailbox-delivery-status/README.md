# QA evidence — sender-side delivery-failure feedback (`project_message mode=status`)

Date: 2026-08-03
Change: `packages/omo-opencode/src/features/cross-project-mailbox/visibility/` +
`send-tool/project-message-tool.ts` — a read-only `mode=status` reporting whether recent sends were
processed, rejected (with the receiver's recorded reason), or are still undelivered.
Roadmap item: P1-3 in `.omo/plans/tooling-improvement-roadmap.md`.

## What was asked for

cloudhome, note `621af36b-7ef7-4436-8ead-7f7c752ecc84`, ranked this their #1 item: "it's the one that
actually erodes trust in the channel — we've had real 'did this ever land' uncertainty with ORW
exchanges." Their stated minimum was (a) a sender-side receipt when a hard reject happens, and (b) a
way to check "still undelivered after N hours".

## What the sender could see before

A hard reject quarantines the note entirely on the RECEIVER side: `MailboxStore.quarantine()` moves
it to `coordination_notes/<sender>/rejected/<id>.md` and writes `<id>.reason.json` carrying the
reason and detail. Nothing is written back toward the sender.

The only sender-visible signal was the TUI sidebar's aggregate `outboundFailed` counter.
`before-sidebar.json` captures exactly that, for a note rejected 6 hours earlier with a recorded
`over-budget` reason sitting on disk:

    outboundFailed: 1
    rejectionReasonAvailable: false
    ageAvailable: false
    messageIdAvailable: false

So: a number, with no way to tell *which* note, *why*, or *how long ago*. And an unacknowledged send
was indistinguishable from a rejected one at any granularity finer than that counter.

## What was tested

`drive.ts` builds the `project_message` tool exactly as `tool-registry-mailbox-tools.ts` does (same
factory, same deps shape) but with a fixture project registry, then drives the real flow across two
temp repos:

1. `mode=send` a `question`-intent note from sender to target — real envelope, real note file, real
   outbox log line.
2. `mode=status` — expect the note reported as `pending`.
3. The receiver rejects it through the real hard-reject path: `MailboxStore.quarantine(messageId,
   "over-budget", detail)`.
4. `mode=status` again — expect `rejected`, carrying the receiver's own reason and detail.

## What was observed

`after.json`:

    sentOk: true
    beforeReject: summary { pending: 1, rejected: 0 },  needsAttention: []
    afterReject:  summary { pending: 0, rejected: 1 },  needsAttention: [
      { messageId: cd2762d8-…, intent: question, outcome: "rejected",
        rejectionReason: "over-budget",
        rejectionDetail: "intent question above ceiling for this sender",
        ageHours: 0 }
    ]

Both halves of cloudhome's ask are covered: the reject surfaces with the receiver's reason attached,
and `staleAfterHours` (default 4) ages any unacknowledged send from `pending` into `stale` so
"still undelivered after N hours" is a single call. `unresolved-target` is reported separately, since
"the target repo root is not resolvable from this machine" is a different failure than "the target
has not acknowledged".

## Verification run

- `bun test packages/omo-opencode/src/features/cross-project-mailbox/ packages/omo-opencode/src/plugin/`
  — 1082 pass / 0 fail.
- `bun run typecheck` — clean.
- `lsp_diagnostics` — clean on all changed/added files.
- Unit coverage in `visibility/delivery-status.test.ts` (9 cases): rejected-with-reason,
  processed, the pending/stale threshold boundary in both directions, registry-resolved target,
  unresolved target, absent outbox log, and a rejected note whose `reason.json` the receiver never
  wrote. Tool-level coverage in `send-tool/project-message-tool.test.ts` (4 cases) including an
  assertion that `mode=status` writes no note and no outbox line.

## Isolation

No opencode process was spawned and no session DB was touched. Both repos are `mktemp` fixtures; the
machine-wide project registry at `~/.omo/project-registry.json` is deliberately bypassed by injecting
a fixture registry, so the QA neither reads nor writes real project state. `mode=status` is read-only
by construction — it stats the target's acknowledgement directories and reads the sender's own outbox
log, and the "does not send or write a note" test pins that.

## Why this is enough

The rejection path exercised is the real one (`MailboxStore.quarantine`), not a hand-placed marker
file, so the reason surfaced is genuinely the receiver's own artifact. The before/after pair is
captured against the same rejected-note scenario, showing the sender going from a bare count to the
message id, reason, detail, and age.

Residual risk: this is a pull, not a push — the sender must ask. That matches what was requested
("a way to check"), but a note rejected while the sender is idle still produces no unsolicited
notification. Also, resolution depends on the sender being able to reach the target's repo root on
this filesystem; a target on another machine reports `unresolved-target` rather than a true outcome,
which is reported distinctly rather than being conflated with a successful delivery.

## What was omitted

Fixture project ids are temp-directory-derived hashes, not real project identities. No credentials,
tokens, mailbox grant tables, or real project registry contents are included in the captures.
