# "not a participant of team X" blamed membership for a mistyped id

## How this was found

Mining error classes active in the last 14 days surfaced `team_send_message denied: not a
participant of team ...` - 5 failures, all in one session.

Pulling the actual arguments from the session database made the cause obvious:

| teamRunId passed | length | calls | status |
|---|---|---|---|
| `2daf76b6-acce-4fd9-bc23-9a9eab4818d8` | 36 | 39 | completed |
| `2daf76b6-acce-4fd9-bc23-9a9eab4818d8f8` | 38 | 5 | **error** |

The same session used the correct id successfully 39 times across `team_send_message`,
`team_status`, `team_shutdown_request`, `team_approve_shutdown`, and `team_delete`. The 5 failures
carried two stray trailing characters (`f8`).

## Root cause

The caller was the team's LEAD. The message said "not a participant", which reads as a permission or
membership problem, so the natural response is to try to join or re-create the team - when the
actual fault was two characters in the id.

The hook already knows which team the caller belongs to; it resolves `participant` before the check
and then discards that information when composing the error.

## What was tested

`drive.mjs` runs the REAL `team-tool-gating` hook against a real on-disk team state file, using the
EXACT session id and both EXACT team ids from the production failure. It attempts the valid id and
the typo id in the same run.

## What was observed

| call | before | after |
|---|---|---|
| valid id (`...4818d8`) | allowed | allowed |
| typo id (`...4818d8f8`) | `denied: not a participant of team ...4818d8f8` | + `This session is the lead of team ...4818d8 - pass that teamRunId instead.` |

`namesOwnTeam` went `false` -> `true` on the denial, with the valid call unchanged.

Note on the check: the typo id CONTAINS the correct id as a prefix, so a substring test on the id
alone matches in both runs. The driver tests for the corrective sentence instead - the first version
of this driver reported a false positive before that was fixed.

Captures: `before-bare-denial.json`, `after-names-own-team.json`. Before-capture taken by reverting
only `hook.ts` via `git stash`, re-running the same driver, then restoring - byte-identical restore
verified with `cmp` (`RESTORED-OK`).

## Why this is enough

The driver exercises the real hook with the real ids that failed. Two regression tests cover both
branches, and both FAIL against the original:

- a member asking about another team is told which team it IS in, by name and role,
- a caller in no team at all is told that plainly, rather than being pointed at a team that does not
  apply to it.

The four existing denial tests still pass - the added sentence is appended, so the original message
is preserved verbatim for anything matching on it.

Full workspace suite green, typecheck clean.

## What was omitted

Not addressed: `cross-owner updates are not allowed` (5 occurrences on `team_task_update`), which is
a genuine ownership rule rather than a diagnosis problem, and the underlying question of why a
teamRunId acquired two stray characters - the id is copied from prior output, so a clearer error is
the durable fix rather than trying to prevent every mistranscription.
