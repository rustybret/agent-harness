# QA evidence — make a gated idle drain observable

Date: 2026-08-03
Change: new `packages/omo-opencode/src/features/cross-project-mailbox/drain-gate/` +
`hooks/idle-drain-hook.ts` + `manual-drain/peek.ts` + `trace/` (`drain-skipped` phase).
Roadmap item: P1-4 in `.omo/plans/tooling-improvement-roadmap.md`.

## What was wrong

`shouldSkipDrain()` returned early with only a `log()` call, which lands in
`$TMPDIR/oh-my-opencode.log`. Nothing surfaced in the trace artifact, the sidebar, or any tool
response. So when the active primary was not in `intake_eligible_agents`, notes accumulated unread
and the only symptom was silence — the receiver looked idle and healthy while intake was closed.

This is the mechanism behind cloudhome's report that notes "never showed up in the mailbox in: count,
nor did cloudhome pick them up until manually bumped, even though totally idle": a manual
`project_mailbox_drain` bypasses this gate, which is why bumping worked while idling did not.

Worse, `project_mailbox_peek` reported pending notes with no indication they would never arrive on
their own, so the natural read of "2 pending" was "the target has not idled yet" rather than
"intake is gated shut".

## What changed

1. `drain-gate/evaluate.ts` — the gate logic (previously two private helpers inside the drain hook)
   is now one shared evaluator returning a verdict with a reason code and a reviewer-readable
   sentence. The drain hook and `project_mailbox_peek` both call it, so the reason an agent is shown
   cannot drift from the reason the drain actually used. `evaluateConfigDrainGate` is split out so
   config-level blocks are settled without a session lookup.
2. A blocked drain now emits one `drain-skipped` trace record carrying the cause and `waiting`, the
   number of notes the gate is holding.
3. `project_mailbox_peek` returns an `autoDrain` field: `{ enabled: true }`, or the reason, detail,
   and active primary when gated.

## What was tested

`drive.ts` writes two real notes into a fixture receiver's inbox through the real `MailboxStore`,
sets the active primary to `prometheus` (not in `intake_eligible_agents: ["sisyphus"]`), then:

1. Calls the real `project_mailbox_peek` tool built by `createProjectMailboxPeekTool`.
2. Runs the real `createIdleDrainHook` `session.idle` handler.
3. Reads back the on-disk trace artifact at `.omo/mailbox-trace.jsonl`.

The same script was run against the pre-change code by stashing the feature directory, so both
captures exercise identical fixtures.

## What was observed

`before.json` — the silent behavior:

    peek:      { pendingCount: 2 }              // no autoDrain field at all
    idleDrain: { notesDispatched: 0, traceRecords: [] }

`after.json` — the same scenario, now observable:

    peek.autoDrain: {
      enabled: false,
      reason: "primary-not-eligible",
      activePrimary: "prometheus",
      detail: "The active primary agent is 'prometheus', which is not in intake_eligible_agents
               (sisyphus). Switch to an eligible agent or drain manually with project_mailbox_drain."
    }
    idleDrain.traceRecords: [
      { phase: "drain-skipped", waiting: 2, detail: "primary-not-eligible: The active primary …" }
    ]

`notesDispatched: 0` in both: this change alters observability only. A gated drain still delivers
nothing, which is the intended safety behavior — the point is that it now says so.

## Verification run

- `bun test packages/omo-opencode/src/features/cross-project-mailbox/` — 761 pass / 0 fail.
- `bun test packages/omo-opencode/src/plugin/` — 337 pass / 0 fail.
- `bun run typecheck` — clean. `lsp_diagnostics` clean on all changed files.
- New unit coverage: `drain-gate/evaluate.test.ts` (9 cases incl. precedence when two causes apply,
  the allow-none-with-one-allowed-sender case, and that a sentinel primary cannot slip past),
  3 new cases in `idle-drain-hook.test.ts` (trace emitted with the right count, store failure while
  counting still emits, no trace when allowed), 3 new cases in `manual-drain-tools.test.ts`.

Two pre-existing tests pin that a `disabled` or permissionless mailbox performs zero session lookups
and zero store access. My first implementation counted waiting notes on every blocked path and broke
both. They were right and the code was changed, not the tests: the count is now taken only for
`primary-not-eligible`. That is also the honest split — an operator who turned the mailbox off is not
surprised that nothing drains, whereas an enabled-but-gated mailbox silently holding notes is exactly
the case worth quantifying.

## Isolation

No opencode process spawned, no session DB touched, no real project registry read. Both repos are
`mktemp` fixtures and the registry is a literal array. The trace artifact read is inside the fixture
receiver root.

## Why this is enough

Both surfaces exercised are the real ones — the tool as `createProjectMailboxPeekTool` builds it and
the hook as `createIdleDrainHook` builds it — and the trace is read back from disk rather than from
an in-memory spy, so the artifact an operator would inspect is the artifact asserted.

Residual risk: the `waiting` count is a point-in-time read taken while the gate is blocked, so it can
lag a concurrent send by one sweep. It is an observability figure, not a reservation. Also, the
resolver wired into the peek tool mirrors the drain hook's (cached primary, falling back to a session
lookup); if that lookup fails, both fail closed to "not eligible" identically, so peek can report a
gate that a subsequent successful resolution would have opened — the same conservative behavior the
drain already had.

## What was omitted

Fixture project ids are temp-directory-derived hashes. No credentials, tokens, sender grant tables,
or real registry contents appear in the captures. Trace `detail` is truncated to 100 chars by the
existing sanitizer, which also redacts absolute paths.
