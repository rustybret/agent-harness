# Team mailbox turn-marker collision — silent peer-message drop

Date: 2026-07-31
Scope: `packages/omo-opencode/src/hooks/team-mailbox-injector/hook.ts` (`buildTurnMarker`)

## Origin: what this change is NOT

This started as an instruction to execute a hyperplan-produced fix plan naming four root causes.
Verification against the code and the live plugin log contradicted all four, so none were implemented:

1. "Members told to treat `team_task_list` as source of truth, conflicting with message-driven rounds."
   `.agents/skills/hyperplan/SKILL.md` contains zero occurrences of `task_list` / `tasklist` / `team_task`.
2. "`sisyphus-junior` idle-drain eligibility blocked recovery." `intake_eligible_agents` gates the
   CROSS-PROJECT mailbox; team delivery runs through `team-idle-wake-hint` → `findResolvedMemberSession`
   → `pollAndBuildInjection`, which never reads that setting.
3. "Transport acks mistaken for durable ingestion." Inverted: `findDeliveredMessageIds` scans real
   session messages and acks only observed deliveries, requeueing the rest.
4. "Lead never woken." Plugin log for team run `2daf76b6` shows the lead resolved, woken and acked
   (`18:25:03 memberName:"lead" unreadCount:1 ackedCount:5`; `18:53:58 unreadCount:5 ackedCount:11`),
   with zero `-gated` / `-error` / `-skipped` / `-duplicate-suppressed` events.

The single real defect found is the one fixed here.

## What was tested

The production hook `createTeamMailboxInjector`'s `experimental.chat.messages.transform`, driven over a
real on-disk team runtime (real `sendMessage`, real runtime state, real mailbox poll) — no mocks.

Driver: `compaction-repro.test.ts` in this directory.
Regression test landed in-tree: `packages/omo-opencode/src/hooks/team-mailbox-injector/hook.test.ts`
("injects on a later turn that repeats an earlier message count").

## The defect

`buildTurnMarker` returned `` `${sessionID}#${messages.length}` ``. That marker deduplicates repeated
transform invocations within one turn, but message count is not a turn identity.
`transitionRuntimeState` compares the incoming marker against `lastInjectedTurnMarker` — the single most
recent marker. So two CONSECUTIVE polls at equal message count are misread as a same-turn retry: the
second turn's peer message is never injected, while still being treated as handled. A compacted steady
state (summary + recent tail) produces equal-length windows on consecutive turns routinely.

## What was observed

Same driver, same command, only `buildTurnMarker` differing.

Before (`before-fix-output.txt`) — three consecutive 3-message turns carrying distinct messages:

```
expect(second.join("\n")).toContain("round two")
Expected to contain: "round two"
Received: ""
 0 pass, 1 fail
```

`Received: ""` is the bug: no envelope injected at all, message silently lost.

After (`after-fix-output.txt`):

```
 1 pass, 0 fail
```

Regression + existing suites: `bun test packages/team-core/src packages/omo-opencode/src/features/team-mode
packages/omo-opencode/src/hooks/team-mailbox-injector` → 450 pass, 2 skip, 0 fail.
`bun run typecheck` clean across all workspace packages.

Wider suite, baseline-controlled (`bun test packages/team-core/src
packages/omo-opencode/src/features/team-mode packages/omo-opencode/src/hooks`), changes stashed vs applied:

| run | pass | fail |
| --- | --- | --- |
| baseline (changes stashed) | 2527 | 44 |
| with fix | 2528 | 44 |

Identical failure count; the delta is exactly the one added regression test. The 44 failures are
pre-existing and unrelated (`runtime-fallback`, and others), NOT introduced here — verified by stashing
the change and re-running rather than assuming.

## An earlier draft of this evidence was wrong

The first driver framed the bug as "compaction shrinks the list, then it regrows to a previously used
count" and it PASSED against unfixed code — disproving that framing. Because dedup compares only the
immediately preceding marker, a collision with an older turn is harmless. The driver was corrected to
consecutive equal-count turns, which is what actually reproduces. Recorded because the false version
would have shipped an overstated claim behind a green test.

## Why this is enough

The failure is demonstrated on the real hook through the real mailbox path, fails before and passes
after with nothing else changed, and the in-tree regression test pins it. Fix is one function; the
count fallback retains prior behavior for messages carrying no id.

## Residual risk

- Identity now depends on `info.id`. Messages without an id fall back to the old count-only marker and
  remain exposed. All observed transform messages carry `info.id` (used the same way by
  `context-injector`, `category-skill-reminder`, `provider-quirks-normalizer`).
- If a host ever reused the last message id across two consecutive distinct turns at equal count, the
  collision would return. Not observed.
- Not addressed here: the unread backlog growth seen in the log (Round 2/3 arriving faster than turns
  consume them) is a pacing property, not a delivery failure.

## Omitted

No secrets, tokens or credentials involved. Plugin-log excerpts are quoted narrowly (member name,
counts, timestamps); no session content or env dumps copied.
