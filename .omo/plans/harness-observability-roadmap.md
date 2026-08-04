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

P0-2 was not on any list. It was found only because the P0-1 QA driver ran the real config path
against the real user config and the sidebar came back `kind: "broken"`. Manual QA against real
inputs is what surfaced the highest-severity item of the session.

## Open

### Deferred by the reporter (cloudhome, explicitly fine unscheduled)
- Structured `deliverable` field on the envelope. `category` + prose body is a workable stand-in.
- Escalation-request mode (per-message tier bump above the sender's ceiling).
- Notify-on-drain callback so a sender learns when its note was actually consumed.

### Known gaps, not yet scheduled
- **Cross-batch supersession.** `supersedes` only dedupes within one drain batch, so a correction
  arriving after the original was consumed does not invalidate the work already started.
- **Only hephaestus declares a model constraint.** `AGENT_MODEL_CONSTRAINTS` is read by both the
  registration path and doctor, but an agent that starts refusing models without adding a registry
  entry will drop silently the same way P0-6 did. The registry test cannot detect a missing entry.

### Investigated and dropped
- **`primary: null` drain skips (654 lines).** The three affected session ids exist in NO database
  on this machine, and the plugin log is machine-wide (`$TMPDIR`), so these came from other repos'
  opencode instances rather than this harness. Also checked whether the resolver omitting
  `query: { directory }` was the cause: 39 of 43 call sites omit it, so that is the established
  convention, not a defect. P1-2 already makes the skip observable, which is the actionable part.

## Method that worked

1. Mine the live plugin log for the highest-frequency lines, not the scariest-looking ones.
2. Before trusting a log-derived finding, confirm the sessions are real (`opencode.db`) and the
   payloads are production, not test fixtures. Two candidate items died at this step.
3. QA every fix by driving the real code path against real inputs, capturing before AND after.
   The before-capture is what makes the delta evidence rather than assertion.
