# A busy peer was reported the same as a dead peer

## How this was found

Log mining. `[presence-reader] health probe failed` is the largest real-session error cluster in the
live plugin log: **321 occurrences, 267 of them carrying genuine `ses_`-shaped session ids** (the
rest are fixtures). The failure reason is almost entirely one thing:

| reason | count |
|---|---|
| `The operation timed out.` | 319 |
| `ECONNREFUSED` | 2 |

So essentially none of these were "the peer is gone" - they were "the peer did not answer in time".

Probing every fresh external peer directly confirmed it: **all 7 answered `http 200`**, and the one
with the most recorded timeouts (`unitysupermcp`, 101 of them) was also the slowest to answer at
406ms versus 1-20ms for the rest. Probe latency tracked how BUSY a peer was, not whether it existed.

## Root cause

`defaultProbeSession` decided liveness from a single HTTP request with a 2s deadline. That request
is served by the peer's application loop, so it queues behind whatever that session is doing. A
session mid-turn - the exact moment it is most alive - is the most likely to miss the deadline.

The consequence is inverted semantics: **the busier a peer is, the more likely it is to be declared
not-live.** Presence then reports `stale`, and `maybeLaunchOfflineTarget` reads presence to decide
whether to spawn a session for an offline target.

A TCP connect separates the two states cleanly, because the kernel accept queue answers it rather
than the application:

| target | HTTP probe | TCP connect |
|---|---|---|
| live busy server (port 4096) | may time out | `accepted` |
| unitysupermcp (port 58472) | 406ms, sometimes times out | `accepted` |
| nothing listening (port 1) | times out | `refused` |
| dead old port (4105) | times out | `refused` |

## What was tested

`drive.mjs` drives the REAL `readPresenceStatus` against three peers on real sockets:

1. a healthy HTTP server,
2. a **bound-but-unresponsive** listener - the production shape, accepts the connection and never
   replies,
3. a port nothing is bound to.

## What was observed

| peer | before | after |
|---|---|---|
| healthy | `live` (17ms) | `live` (8ms) |
| **busy (bound, no reply)** | **`stale` (2001ms)** | **`live` (1503ms)** |
| dead (nothing bound) | `stale` (1ms) | `stale` (1ms) |

Captures: `before-http-only.json`, `after-tcp-fallback.json`. Before-capture taken by reverting only
`presence-reader.ts` via `git stash`, re-running the same driver, then restoring - byte-identical
restore verified with `cmp` (`RESTORED-OK`).

## The QA caught a flaw in the fix itself

The first version of the fix produced `busy-peer: stale (2000ms)` - unchanged. The fallback was dead
code: the HTTP attempt was given the entire 2s budget, so the caller's race resolved "not live" at
the same instant the fallback became reachable. The HTTP attempt now gets
`2000 - 300 - 200 = 1500ms`, leaving real room for the TCP probe. A test pins
`TCP_LIVENESS_TIMEOUT_MS < 1000` so this cannot silently regress.

This is why the driver measures elapsed time as well as status: the status alone looked plausible.

## Why this is enough

The driver exercises real sockets through the real production entry point, and reproduces the exact
production shape (a listener that accepts and never answers). Dead peers are still reported dead -
`refused` is treated as gone, and an inconclusive TCP result (`unknown`) also stays not-live, so the
fallback can only rescue a peer whose listener demonstrably exists.

Seven regression tests: four in `tcp-liveness.test.ts` driving real ephemeral sockets (accepted /
refused / malformed url / default port), one pinning the timeout budget, and two in
`presence-reader.test.ts` for the timeout-plus-accepted and timeout-plus-unknown paths. The key test
was verified to FAIL against the reverted reader.

Full suite green, typecheck clean.

## What was omitted

No secrets involved - all sockets are loopback, and the driver writes presence records into a
`mktemp` HOME rather than the real `~/.omo/presence`. Session ids quoted from the log are local
identifiers.

Not addressed: probe results are cached per presence interval (10s) after the earlier concurrency
fix, so a peer that goes from busy to genuinely dead can be reported live for up to one interval.
That is the same staleness window the heartbeat itself has, and shortening it would restore the
per-turn probe cost that fix removed.
