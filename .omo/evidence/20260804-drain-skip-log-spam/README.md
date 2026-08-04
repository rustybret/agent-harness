# A gated drain re-reported the same verdict on every poll

## How this was found

Log mining, and it is a regression I introduced. After the earlier fixes cleared the noise, drain
skips became by far the largest real-session cluster:

| message | real-session lines (last hour) |
|---|---|
| `[mailbox-idle-drain] skipped: primary not eligible` | **1593** |
| `[mailbox-idle-drain] skipped: permissionless config` | 497 |
| everything else, combined | ~500 |

So roughly 80% of all real-session log output was drain skips. Worse, the P1-2 fix that made a gated
drain observable also emits a trace record on every skip, so the same non-event was being written to
two places at poll rate.

This is the same defect class as the `readdir` spam fixed earlier: a steady, expected state reported
at polling frequency, drowning the diagnostics an operator actually reads and aging the log toward
its 50MB rotation cap.

## Root cause

`shouldSkipDrain` logged and traced unconditionally whenever the gate blocked. An idle session is
polled continuously, so an unchanged gated state re-reported an identical verdict every few seconds.

The useful signal is a CHANGE, not a poll. A skip is now reported when its signature changes, where
the signature covers everything a reader would act on: the cause, its detail, and how many notes are
being held. The tracking map is cleared when a session becomes eligible, so suppression cannot
outlive the state it describes, and it is bounded at 500 sessions so a long-lived process does not
accumulate an entry per session forever.

## What was tested

`drive.mjs` drives the REAL idle-drain hook through 90 polls across three phases that mirror the
production shape:

1. 30 polls with a steady gated state (ineligible primary, one note held),
2. 30 polls after a second note arrives - the held count changed,
3. 30 polls for a second, different session.

It reads the actual log file the hook writes to, redirected to a `mktemp` dir via `OMO_LOG_DIR` so
the developer's live log is untouched.

## What was observed

| | before | after |
|---|---|---|
| polls | 90 | 90 |
| **skip log lines** | **90** | **3** |
| distinct signatures | 3 | 3 |

`distinctSignatures: 3` in BOTH runs is the important number: the before-run wrote the same three
facts ninety times. All three situations - first skip, held-count change, and a second session - are
still reported after the fix.

Captures: `before-every-poll.json`, `after-suppressed.json`. Before-capture taken by reverting only
`idle-drain-hook.ts` via `git stash`, re-running the same driver, then restoring - byte-identical
restore verified with `cmp` (`RESTORED-OK`).

## Why this is enough

The driver exercises the real hook and reads the real log sink, and the four regression tests cover
both directions of the risk:

- suppression works (repeated identical polls report once) - verified to FAIL against the original,
- a newly arrived note reports again,
- a session that drains and is later gated again reports the new skip,
- a different session still reports its own first skip.

Three of the four guard against OVER-suppression, which is the real hazard when adding a filter like
this: silence is what the P1-2 fix existed to remove.

Full suite green, typecheck clean.

## What was omitted

No secrets involved; the driver uses stub stores and writes into a `mktemp` log dir. Session ids are
synthetic.

Not addressed: the `permissionless config` skips (497/hr) come from OTHER repos' opencode instances
sharing the machine-wide `$TMPDIR` log - this repo's own config resolves that gate as allowed. They
get the same suppression treatment through the shared code path, but their volume is not measurable
from here.
