# The mailbox gate read the agent a session STARTED with

## How this was found

Log mining, following the largest real-session cluster left after the earlier fixes:

| message | real-session lines |
|---|---|
| `[mailbox-idle-drain] skipped: primary not eligible` | **4939** |
| `[mailbox-idle-drain] skipped: permissionless config` | 1555 |

That is 4.9k skipped drains in roughly four hours. The payloads split three ways:

| reported primary | count |
|---|---|
| `null` | 4418 |
| `multimodal-looker` | 514 |
| `historian` | 13 |

A `multimodal-looker` or `historian` primary is not plausible as a session's CURRENT agent - those
are subagents that run briefly inside a session. That is what pointed at the resolver rather than at
the gate.

## Root cause

`resolveSessionAgent` scanned messages forward and returned the FIRST one carrying an agent:

```ts
for (const msg of messages) {
  if (msg.info?.agent) return msg.info.agent
}
```

The host returns messages oldest-first - confirmed against the live server, where
`/session/{id}/message` came back with `firstTime 1785775775297 < lastTime 1785820116528`. So the
function answered "which agent did this session START with", while every caller uses it to decide
something about the agent running NOW.

Measured against the live session database (6783 sessions carrying agent attribution):

- **175 sessions switched agents mid-run.**
- **47** went from an ineligible starting agent to an eligible current one - the mailbox gated those
  shut while they were being driven by an eligible agent.
- **28** went the other way - drained while no longer eligible.

Real examples straight from the database:

| session | started as | running as |
|---|---|---|
| `ses_33ec009eb…` | Prometheus (Plan Builder) | Atlas (Plan Executor) |
| `ses_345aa570a…` | build | Sisyphus - Ultraworker |
| `ses_0a655da73…` | Hephaestus - Deep Agent | Sisyphus - ultraworker |

The Prometheus-to-Atlas shape is the plan-then-execute workflow this repo uses constantly, so the
gate was most wrong exactly when work was progressing normally.

Two callers share the defect: the mailbox drain gate (via `create-mailbox-hooks` and
`tool-registry-mailbox-tools`) and `tool-execute-before`, which resolves `subagent_type` when
resuming a task by `task_id`.

## What was tested

`drive.mjs` replays 40 REAL sessions that switched agents, straight from the live opencode database,
through the REAL resolver and the REAL drain gate. Message rows are reshaped into the host's exact
wire form (`{ info: { role, agent, time } }`, oldest-first) so the resolver sees production input.
For each session it compares the gate's decision against the decision the session's ACTUAL current
agent warrants.

## What was observed

| | before | after |
|---|---|---|
| sessions replayed | 40 | 40 |
| **wrong gate decisions** | **30** | **0** |
| gated shut wrongly | 29 | 0 |
| drained wrongly | 1 | 0 |

Captures: `before-first-agent.json`, `after-current-agent.json`. Before-capture taken by reverting
only `session-agent-resolver.ts` via `git stash`, re-running the same driver, then restoring -
byte-identical restore verified with `cmp` (`RESTORED-OK`).

## Why this is enough

The replay uses real sessions, real message ordering, and the real gate, so the 30-to-0 delta is
measured on production data rather than fixtures. The fix also skips compaction messages, which the
host attributes to a synthetic `compaction` agent - without that skip a session would report
housekeeping as its operator. The driver initially flagged one "wrong" case that was exactly this
skip working correctly; the baseline query was corrected to exclude compaction rows rather than
weakening the fix.

Seven regression tests in `session-agent-resolver.test.ts`, including the two compaction shapes
(agent-named and parts-based). The mid-run-switch test was verified to FAIL against the original
resolver. Two pre-existing tests asserted the old first-agent behavior and were rewritten - they
encoded the defect.

Full suite green, typecheck clean.

## What was omitted

No secrets involved; the driver opens the session database read-only and prints only session id
prefixes and agent names. Session ids are local identifiers.

Not addressed: `null` primaries (4418 lines) are a separate cause. Those session ids exist in no
database on this machine, and the plugin log is machine-wide (`$TMPDIR`), so they come from other
repos' opencode instances rather than this harness. The earlier observability fix already makes
those skips visible with a waiting count.
