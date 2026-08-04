# Cross-batch supersession: a correction arriving after delivery is now announced

## What was tested

`supersedes` only ever deduped within a single drain batch. If the superseded note had already been
delivered in an earlier batch, the correction arrived as an ordinary new note, with nothing marking
it as invalidating instructions the receiver had already acted on.

Reported independently by two projects: cloudhome ("nothing surfaces that it invalidates work") and
art3d-pipeline ("no interrupt/correction semantics").

Driver: `drive.mjs` exercises the REAL `MailboxStore` and the REAL `buildTriagePrompt` across TWO
separate drain batches, which is the case the in-process tests cannot reach:

1. Batch 1 - original note arrives, is drained, reserved, and acked into `processed/`.
2. Batch 2 - a note superseding it arrives and is drained.
3. The batch-2 note is rendered through the actual triage prompt builder.

## What was observed

| | `supersedesDelivered` | prompt names superseded id | receiver sees |
|---|---|---|---|
| before | `null` | no | an ordinary new note |
| after | `true` | yes | `CORRECTION: ... already delivered to you` above the body |

Full captures: `before-two-batch-drive.json`, `after-two-batch-drive.json`.

The after-prompt opens with the correction BEFORE the note body:

```
CORRECTION: this note supersedes message b2771000-…, which was already delivered to you.
Treat the earlier note's instructions as withdrawn. If you started work based on it, stop and
reconcile against this note before continuing.
```

Before-capture taken by reverting only `mailbox-store.ts` and `triage/template.ts` via `git stash`,
re-running the same driver, then restoring - byte-identical restore verified with `cmp`
(`RESTORED-OK`).

## Why this is enough

The two supersession cases are now distinguished by where the superseded note physically lives:
still in the inbox (silent replacement, unchanged behavior) versus already in `processed/` (a
correction that must be announced). Both directions are pinned by tests:

- `mailbox-store.test.ts` - 4 cases: still-unread (no flag), already-delivered (flag), superseding
  an id never seen (no flag), superseding nothing (no flag).
- `triage/template.test.ts` - 3 cases: banner present and ordered above the body, absent for
  same-batch supersession, absent for an ordinary note.
- `idle-drain-hook.test.ts` - 2 cases proving the flag survives the dispatcher and reaches the
  prompt builder, and that an ordinary note does not acquire it.

Full suite green (13761 pass / 0 fail). Scoped mailbox suite 773 pass / 0 fail.

## What was omitted

No secrets, tokens, or env dumps are involved - the driver runs entirely in a `mktemp` directory
that it removes on exit. Message ids in the captures are freshly generated UUIDs from the driver
run, not real inter-project traffic.

Not covered: reconciling work already in flight is left to the receiving agent's judgment. The fix
tells the agent the earlier instruction was withdrawn; it does not attempt to cancel a running
subagent or revert a partially applied change, which would require a cancellation channel that does
not exist today.
