# Outbound-budget presence probing stalled the chat turn

## How this was found

Log mining. `[presence-reader] health probe failed` appeared 238 times in the live plugin log, every
one of them `"error":"The operation timed out."`, concentrated on a handful of session ids.

The timeout wording is the tell. A **closed** port fails in ~0-5ms with "Unable to connect"; only a
port that ACCEPTS the TCP connection and never answers burns the full `AbortSignal.timeout(2000)`
and reports "The operation timed out." Measured directly:

| target | result | elapsed |
|---|---|---|
| closed port | `Unable to connect...` | 0 ms |
| hung port (accepts, never replies) | `The operation timed out.` | 2001 ms |

So each failure was a full 2s wall-clock stall, not a fast failure.

## Root cause

Two independent problems on the same path, both on `experimental.chat.messages.transform` - the
hook that runs on EVERY chat turn:

1. **Serial probing.** `readOutboundBudget` awaited `resolvePresence` inside a `for` loop, so the
   cost was the SUM of every target's timeout rather than the worst single one. This repo has 13
   allow-listed targets and the cap is 20.
2. **No caching on the chat path.** The injector called `readPresenceStatus` directly. A
   `createPresenceCache` already existed but only the sidebar used it, so every turn re-probed
   every target from scratch.

Stale presence records make this reachable in normal use: `~/.omo/presence/` on this machine holds
records up to 22 days old, several pointing at `127.0.0.1:4096`, a port other processes reuse. A
record whose port has been taken over by something that accepts but does not answer is exactly the
hung-port case.

## What was tested

`drive.mjs` drives the REAL `readOutboundBudget` with the REAL config and REAL presence records,
then repeats against a synthetic worst case: one socket that accepts and never replies, with a fake
presence record per target pointing at it, in an isolated temp HOME.

## What was observed

| | real machine state | all 13 targets hung |
|---|---|---|
| before | 897 ms | **26 023 ms** |
| after | 18 ms | **2 001 ms** |

Rows and statuses identical in every run (13 rows, 4 live / 9 offline). After the fix the worst case
is one probe timeout instead of the sum of thirteen. The real-state improvement (897 -> 140 ms) is
concurrency on the live-but-slow probes.

Full captures: `before-serial.json`, `after-concurrent.json`. Before-capture taken by reverting only
`outbound-budget.ts` via `git stash`, re-running the same driver, then restoring - byte-identical
restore verified with `cmp` (`RESTORED-OK`).

## Why this is enough

Both halves are pinned by regression tests:

- `outbound-budget.test.ts` - four probes are held open until all four have started, asserting a
  peak in-flight count of 4. This is deterministic rather than wall-clock based: verified to FAIL
  against the reverted serial implementation (test times out, since probe 4 never starts) and pass
  against the concurrent one.
- `outbound-budget-injector.test.ts` - three chat turns through the real cached presence path probe
  the target once, which fails if the cache is removed.

Cache TTL is `PRESENCE_INTERVAL_MS` (10s), the presence heartbeat interval, so a status is at most
one beat stale - the same freshness the sidebar already accepted.

Full suite green (13776 pass / 0 fail), typecheck clean. An earlier wall-clock version of the
concurrency test proved flaky under full-suite load and was replaced with the counter-based one
described above.

## What was omitted

No secrets are involved; the driver reads only presence metadata (project id, mode, localhost URL,
session id) and writes its fakes to a `mktemp` HOME it removes on exit. Session ids in the log
excerpt are local identifiers, not credentials.

Not fixed here: the stale presence records themselves. A record 22 days old still gets probed until
its heartbeat ages past `PRESENCE_TTL_MS`; the age check happens before the probe, so a genuinely
stale record short-circuits to `offline` - but a record kept fresh by a live-but-wrong process on a
reused port will still be probed. Reducing the 2s per-probe timeout was also left alone: it is the
only thing distinguishing a slow-but-live server from a dead one.
