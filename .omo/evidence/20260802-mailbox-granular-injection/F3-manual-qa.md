# F3 — Manual QA (mailbox granular injection)

Date: 2026-08-03
Scope: T17 trace observability layer + full mailbox feature tree
Performed by: Atlas (orchestrator), driving real modules and real disk directly.

---

## WHAT WAS TESTED

F3 was redefined mid-plan. The original form (cipher-relay E2E re-run) was descoped by user
directive ("lets skip e2e test, and instead rely on observation of live session behavior").
This record covers what was actually driven.

### (a) Automated gates — RUN BY ORCHESTRATOR, NOT REPORTED BY A SUBAGENT

| Gate | Command | Result |
|---|---|---|
| Mailbox suite | `bun test packages/omo-opencode/src/features/cross-project-mailbox` | **729 pass / 0 fail**, 6151 expect() |
| Typecheck | `bun run typecheck` | **exit 0** |
| Architectural audits | `bun test .../prompt-async-route-audit.test.ts .../mock-module-lifecycle-audit.test.ts` | **11 pass / 0 fail** |

### (b) Trace layer driven against REAL disk (not mocks)

Driver scripts imported the REAL production modules
(`createMailboxTraceEmit` → real `createFileTraceSink` → real `.omo/mailbox-trace.jsonl`)
against a real temp repoRoot. No stubbing of the sink.

Behaviors exercised: full 7-phase receiver lifecycle for one message; a `write-failed`
detail carrying a host-absolute secret path; a throwing sink; a promise-rejecting sink.

---

## WHAT WAS OBSERVED

### Artifact shape (verbatim first record)

```json
{"phase":"acked","messageId":"msg-live-drive-0001","correlationId":"corr-live-drive-0001","at":"2026-08-03T07:02:12.620Z","fromProjectId":"agent-harness-0367cd71","toProjectId":"cloudhome-5aa53d2c"}
```

Path resolved to `<repoRoot>/.omo/mailbox-trace.jsonl`.

### Assertions observed true

| Property | Observed |
|---|---|
| every record carries messageId + correlationId | true |
| detail truncated to <=100 chars | true (len=100) |
| host secret path redacted | true (`/Users/...` → `[redacted-abs-path]`) |
| repoRoot relativized out of detail | true |
| throwing sink did NOT propagate | true |
| rejecting sink did NOT propagate | true |
| failed-sink phases absent from file | true |
| declared phases reachable | 10 |
| all log lines carry `[mailbox-trace]` prefix | true |

Redacted detail, verbatim:
`EACCES open [redacted-abs-path] while writing .omo/x yyyyyyyy...`

### DEFECT FOUND BY RUNNING (missed by both F2 and F4 static review)

Driving a strict 7-phase lifecycle exposed that the per-message timeline was
**not reconstructable** — the entire purpose of this layer (gap #4 of the
observability audit).

Before fix:

```
lane-start / validated / sent / received / lane-end / acked / routed   <- on-disk order
distinct timestamps : 1 of 7
on-disk order correct : false
sort-by-at recovers   : false
```

Two compounding causes: (1) the emit is deliberately fire-and-forget so appends land
out of order; (2) `at` is millisecond-resolution and a full lifecycle completes inside
one millisecond, so `at` cannot break the tie.

Fix: a synchronous module-level monotonic `seq`, stamped at emit time
(`emit-trace.ts:72`) strictly before the async append is scheduled.

After fix — two messages deliberately interleaved to prove the counter is global:

```
seq=  1 m1 sent       seq= 12 m2 lane-end    seq=  7 m1 routed
seq=  2 m2 sent       seq= 11 m1 lane-end    seq=  4 m2 received
total records            : 14
distinct timestamps      : 1 of 14
every record has seq     : true
m1 timeline recovered    : true
m2 timeline recovered    : true
seq strictly increasing  : true
seq globally shared      : true

m1 recovered timeline : sent -> received -> validated -> routed -> lane-start -> lane-end -> acked
```

On-disk order is still scrambled (correct — the async contract is preserved), but the
timeline is now fully recoverable by sorting.

### Unrelated full-suite failure — PROVEN NOT OURS

Root `bun test` shows 13125 pass / **1 fail**:
`packages/omo-opencode/src/hooks/write-existing-file-guard/lazy-canonical-path-init.test.ts`.

| Probe | Result |
|---|---|
| that test in isolation | 2 pass / 0 fail |
| its whole directory | 26 pass / 0 fail |
| our mailbox tree + that test | 727 pass / 0 fail |
| ALL 140 files in every dir this plan touched + that test | **1488 pass / 0 fail** |
| `git diff HEAD` for that dir | empty (untouched by this plan) |
| last commit touching it | `fee4c6547` 2026-06-28 (predates this work) |

Fails only inside the 1635-file single-process run. Signature matches cross-file
module-mock pollution (memory #2177), not a regression from this plan.

---

## WHY IT IS ENOUGH

The trace layer's contract is that it is observable, redacting, order-recoverable, and
incapable of failing a send or drain. Every one of those was exercised against the real
file sink rather than asserted from a mock, and the one property that static review
could not catch (timeline recoverability) was caught precisely because the code was run.

---

## WHAT WAS OMITTED — and why F3 is NOT fully closed

Live-session observation of the trace layer inside a running opencode session was
**not** achieved. Reason, established by direct measurement:

| Process | Started | Plugin in memory |
|---|---|---|
| PID 18923 `opencode serve` | 21:50:58 | old dist |
| PID 12517 `opencode serve` | 23:32:12 | old dist |
| dist rebuilt (trace code lands) | **23:59:35** | — |

Before rebuild: `grep -c "mailbox-trace" dist/index.js` = **0**. After: **2**.

Both live servers, and this session, loaded the plugin BEFORE the trace code existed in
dist. A running process holds its plugin in memory from load time, so no currently-live
session can emit trace. Observing it requires a session restart, which is destructive to
live session state and requires explicit user approval (standing rule; project memory
#1873). Not taken unilaterally.

No secret-bearing logs, tokens, or auth headers are reproduced in this record; the one
credential-shaped path encountered was captured only in its already-redacted form.

**Residual risk:** the emit call sites are proven correct by unit tests and by direct
module drive, but the end-to-end path inside a live opencode session (hook fires → trace
lands on disk) is unproven until a session runs on the rebuilt dist.
