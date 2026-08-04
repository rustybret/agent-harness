# Harness observability roadmap

Living backlog for improving agent-harness tooling from observed behavior: sibling-project
mailbox reports, the runtime plugin log, and defects surfaced while QA'ing other fixes.

Prioritization rule: a defect that produces WRONG data outranks a missing feature, and a defect
that HIDES other defects outranks both (fixing it makes the next round of mining cheaper).

## Shipped this session

| # | Item | Source | Commit |
|---|------|--------|--------|
| P0-1 | Sidebar counted any `.md` as unread, so stale docs inflated the badge | cloudhome report #2 | `d509ff168` |
| P0-2 | Migrated `agents.*.models` silently dropped at runtime; every agent lost its model chain | QA of P0-1 | `dc958ccac` |
| P1-1 | Sender had no way to learn a note was rejected or had gone stale | cloudhome report #1 | `f238d0668` |
| P1-2 | A gated idle drain was silent: no trace, no count, no way to ask why | cloudhome "never showed up" | `c58f10603` |
| P0-3 | `readdir` on absent optional dirs logged as failure: 47.7% of a 50MB log, evicting real diagnostics | log mining | `30d0ed443` |
| P0-4 | `JSON.stringify(Error)` dropped message/stack, so 292 error diagnostics logged `{}` | log mining | `f85776a20` |
| P0-5 | `bun test` wrote fixture noise into the developer's live plugin log | log mining | `edda8fa97` |
| P0-6 | An agent dropped by an unsupported model was invisible; doctor reported the refused model as effective with 0 issues | log mining | `9373dd7e4` |
| P0-7 | `json-error-recovery` appended "you sent invalid JSON, STOP" to SUCCESSFUL calls whose content quoted a parse error: 22 false injections vs 104 real | observed live in this session | `23763f3fc` |
| P0-8 | Caller-side `String(error)` logged 74 failures as `[object Object]`, incl. ralph-loop retries and promptAsync failures | log mining | `cb1e1e10c` |
| P1-3 | Every successful native `edit` warned about missing omo metadata it never publishes (44 lines, all successes) | log mining | `a77e9f1ec` |
| P1-4 | A `supersedes` correction arriving after the original was delivered read as an ordinary note | cloudhome + art3d-pipeline | `6ea7dc12b` |
| P0-9 | Reclaimed notes quarantined as duplicates of their own failed attempt - 18 of 38 real sends (47%) rejected | dogfooding P1-1 | `ecb8a51cc` |
| P0-10 | Presence probes ran serially and uncached on every chat turn - 26s worst case on the chat path | log mining (238 timeout lines) | `7e1481b97` |
| P0-11 | `normalizeSDKResponse` returned values contradicting the caller's declared type, crashing todo continuation in 24 sessions | log mining (`[event] hook execution failed`) | `73d28ce00` |
| P0-12 | A busy peer was reported the same as a dead one - 267 real-session probe timeouts, all against servers that were alive | log mining (`[presence-reader] health probe failed`) | `a35eb1b4a` |
| P0-13 | The drain gate read the agent a session STARTED with, not its current one - 30 of 40 replayed real sessions decided wrongly | log mining (4939 skips reporting subagents as primary) | `9cdf5dd74` |
| P0-14 | A gated drain re-reported the same verdict every poll - 1593 lines/hr, ~80% of real-session output (regression from P1-2) | log mining | `1cc9fdf06` |
| P1-5 | Context injector logged every synthetic turn (157/hr) and stayed silent on the one that actually held context back | log mining | `5b3b9250d` |

P0-2 was not on any list. It was found only because the P0-1 QA driver ran the real config path
against the real user config and the sidebar came back `kind: "broken"`. Manual QA against real
inputs is what surfaced the highest-severity item of the session.

P0-7 was found the same way, one level up: the harness misbehaved against ME mid-session, appending
a false "you sent invalid JSON" instruction to a tool call that had succeeded. Treating an odd
response as a defect report rather than noise is what turned it into a fix.

## Open

### Deferred by the reporter (cloudhome, explicitly fine unscheduled)
- Structured `deliverable` field on the envelope. `category` + prose body is a workable stand-in.
- Escalation-request mode (per-message tier bump above the sender's ceiling).
- Notify-on-drain callback so a sender learns when its note was actually consumed.

### Known gaps, not yet scheduled
- **552 `String(error)` occurrences remain**, mostly outside logging (message construction,
  user-facing text). Only the 17 sites that produced observed `[object Object]` log lines were
  converted. All 10 no-op `instanceof Error ? String(error) : String(error)` ternaries are gone.
- **Hardcoded tool-name lists cannot cover MCP tools.** `JSON_ERROR_TOOL_EXCLUDE_LIST` names 19
  tools against 163 observed in stored sessions. P0-7 removed the dependency on it for correctness,
  but any other hook gating on a literal tool-name list has the same blind spot.
- **Only hephaestus declares a model constraint.** `AGENT_MODEL_CONSTRAINTS` is read by both the
  registration path and doctor, but an agent that starts refusing models without adding a registry
  entry will drop silently the same way P0-6 did. The registry test cannot detect a missing entry.

### Investigated and dropped
- **`null` primary on 4418 drain skips.** Same conclusion as the earlier `primary: null` item: the
  affected session ids exist in no database on this machine and the plugin log is machine-wide, so
  they originate in other repos' opencode instances. P0-13 fixed the *wrong-agent* half of this
  cluster, which is the part reproducible here.
- **`primary: null` drain skips (654 lines).** The three affected session ids exist in NO database
  on this machine, and the plugin log is machine-wide (`$TMPDIR`), so these came from other repos'
  opencode instances rather than this harness. Also checked whether the resolver omitting
  `query: { directory }` was the cause: 39 of 43 call sites omit it, so that is the established
  convention, not a defect. P1-2 already makes the skip observable, which is the actionable part.

## Method that worked

0. Dogfood the observability you ship. P0-9 was found by running the delivery-status mode from
   P1-1 against this repo's own outbox: 18 of 38 sends had been silently rejected. A tool that
   reports on the system is also a probe of it.

1. Mine the live plugin log for the highest-frequency lines, not the scariest-looking ones.
2. Before trusting a log-derived finding, confirm the sessions are real (`opencode.db`) and the
   payloads are production, not test fixtures. Two candidate items died at this step.
3. QA every fix by driving the real code path against real inputs, capturing before AND after.
   The before-capture is what makes the delta evidence rather than assertion.
4. Replay stored session data through a hook to measure it in production conditions. P0-7's
   false-positive rate came from running the real hook over 268k stored tool outputs; no synthetic
   fixture would have found it, and the same replay proved the fix kept every true positive.
5. Re-mine after each fix. Clearing the loudest cluster exposes the next one, and twice the newly
   exposed cluster was a regression from an earlier fix in the same session (P0-14 from P1-2).
   Observability work is iterative by nature: what you add to see with also becomes noise.
6. Verify a claim before writing it down. Three claims died in QA this session: a "the patterns
   miss 89% of real errors" figure that a recall check disproved (they matched 104 of 105), three
   log clusters that turned out to be test fixtures rather than production failures, and a
   hypothesis that P1-3's warnings came from failed edits - the database showed all 44 succeeded,
   which redirected the fix from error handling to a config gate.
