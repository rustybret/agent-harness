# Mailbox sidebar log spam — absent paths reported as read failures

## What was tested

The real `readMailboxSidebarState` path (`packages/omo-opencode/src/features/cross-project-mailbox/sidebar/mailbox-sidebar.ts`),
driven against a fixture repo with 3 registered senders whose `coordination_notes/<sender>/processed`
directories do not exist yet — the exact shape observed in the live plugin log.

Driver: `.local-ignore/qa/log-spam-driver.mjs` (10 sidebar reads, then one read with a genuinely
unreadable directory to confirm real faults still surface).

Behavior it was meant to prove:
1. A directory that has not been created yet produces no error output.
2. A directory that genuinely cannot be read still produces error output.

## What was observed

Field evidence that motivated the fix, from the live plugin log at
`$TMPDIR/oh-my-opencode.log`:

| measure | value |
|---|---|
| total log lines | 219,832 |
| `mailbox sidebar readdir failed` lines | 104,823 |
| share of the log | **47.7%** |
| bytes attributable | 31.2 MB of a 48.5 MB file |
| distinct missing directories | 718 |
| repeats of a single missing directory | 9,593 |

All three rotation segments (`.log`, `.log.1`, `.log.2`) sat at the 50 MB cap, so this one non-event
was actively evicting real diagnostics through rotation.

Driver before/after (`before-sidebar-poll.json`, `after-sidebar-poll.json`):

| | before | after |
|---|---|---|
| error lines across 10 polls, absent dirs | **40** | **0** |
| error lines for a genuinely unreadable dir | 5 | 2 |

Steady state went to zero while the real-fault path still reports. The residual before/after
difference on the fault case is the absent-outbox line, which is also correctly silent now.

At the sidebar's 1-second poll interval, 4 lines per poll is roughly 14k lines/hour for a 3-sender
project — consistent with the 104k lines seen in the field log.

## Why it is enough

The driver exercises the production function through its real filesystem path, not a stub, and
covers both directions of the change: absence is silent, a real fault (EACCES) still reports. Unit
coverage pins the same split at both layers — `isMissingPathError` classification in
`packages/utils/src/file-utils.test.ts` (ENOENT/ENOTDIR true, EACCES and non-errno false), and
sidebar behavior in `mailbox-sidebar.test.ts` (absent paths silent, unreadable dir reported,
`ENOTDIR` on a sender path still yields correct counts).

Full suite: 13,718 pass / 0 fail after the change. Typecheck clean.

Residual risk: other call sites still log absence as failure (for example the transcript cleanup and
tui-preferences paths visible in the same log at 2 orders of magnitude lower volume). Those are
unchanged here and remain low-volume.

## What was omitted

Raw log excerpts are summarized as counts rather than copied, since the plugin log interleaves
session ids, absolute paths from unrelated projects, and prompt fragments.
