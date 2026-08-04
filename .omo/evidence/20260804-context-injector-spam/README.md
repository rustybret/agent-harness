# The context injector reported a non-event, and stayed silent on the real one

## How this was found

Log mining, continuing down the real-session frequency list after the drain-skip fix. With the two
mailbox clusters suppressed, this became the largest remaining cluster:

| message | real-session lines (last hour) |
|---|---|
| `[context-injector] Latest user message is synthetic/internal, skipping injection` | **157** |

Spanning 43 distinct sessions, so this is broad rather than one stuck session.

## Root cause

The transform hook logged whenever the latest user message was synthetic or internally marked. But
that is the NORMAL shape of an internally driven turn - every continuation, every hook-injected
prompt, every internal dispatch looks like this - and the hook runs on every transform. So it
reported a routine condition at message rate.

Worse, it was reporting the wrong half of the condition. "Injection was skipped" only carries
information when there was something TO inject. With nothing pending, the message describes a
no-op; with context waiting, it describes something being held back, which is what a reader
actually wants to know. The old line could not distinguish the two, and in the common case it was
the meaningless one.

The condition is now gated on `collector.hasPending(...)` and the wording reflects what happened:
`Pending context held back: latest user message is synthetic/internal`.

## What was tested

`drive.mjs` drives the REAL transform hook through 41 turns:

- 40 internally driven turns with NOTHING pending - the production shape,
- 1 turn where context WAS waiting and got held back.

It reads the actual log file the hook writes to, redirected to a `mktemp` dir via `OMO_LOG_DIR` so
the developer's live log is untouched.

## What was observed

| | before | after |
|---|---|---|
| turns driven | 41 | 41 |
| **context-injector log lines** | **41** | **1** |
| **the held-back turn reported** | **false** | **true** |

The second row is the more important one. Before, the one turn that genuinely held context back was
indistinguishable from the 40 no-ops. After, it is the only line in the log.

Captures: `before-every-turn.json`, `after-pending-only.json`. Before-capture taken by reverting only
`injector.ts` via `git stash`, re-running the same driver, then restoring - byte-identical restore
verified with `cmp` (`RESTORED-OK`).

## Why this is enough

The driver exercises the real hook and reads the real log sink. Two regression tests cover both
directions - silence with nothing pending, and a report when context was held - and both were
verified to FAIL against the original.

Full suite green, typecheck clean.

## What was omitted

No secrets involved; the driver uses an in-process collector and writes to a `mktemp` log dir.
Session ids are synthetic.

Not addressed: WHY 43 sessions see synthetic latest messages so often. That is the expected shape of
internally driven turns in this harness (continuations, hook injections, mailbox dispatches), not a
defect.
