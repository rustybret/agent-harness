# Task 3 — Send tools: `requested_mode` arg + outbox audit fields

## WHAT WAS TESTED

Plumbing the optional `requested_mode` field through the cross-project-mailbox SEND surface
end-to-end (tool arg → input zod schema → `SendInput` → `buildSendEnvelope` → written envelope
frontmatter + outbox audit log line), for BOTH `project_message` and `project_note` tools.

Files changed:
- `send-tool/envelope-builder.ts` — `SendInput.requested_mode?: MailboxMode`; threaded into the
  built `envelope` object (`requested_mode: input.requested_mode`, `undefined` when absent).
- `send-tool/outbox-log.ts` — `OutboxEntry.requestedMode?: MailboxMode`; conditionally spread into
  the serialized `record` (key omitted entirely when `undefined`, matching legacy shape).
- `send-tool/project-message-tool.ts` — `requested_mode: z.enum(MAILBOX_MODES).optional()` added to
  `createProjectMessageInputSchema()`; matching `tool.schema.enum(MAILBOX_MODES).optional().describe(...)`
  arg; `requestedMode: built.envelope.requested_mode` passed into the `append(...)` call.
- `send-tool/project-note-tool.ts` — identical mirror in `createProjectNoteInputSchema()`, tool args,
  and the `runProjectNoteSend` `append(...)` call.

Tests added (TDD — written failing first, then implemented):
- `send-tool/envelope-builder.test.ts` (NEW) — requested_mode threads into built envelope; omitted → undefined.
- `send-tool/outbox-log.test.ts` — requestedMode serializes into line when present; key omitted when absent.
- `send-tool/project-message-tool.test.ts` — full send: frontmatter contains `requested_mode: subagent`
  + outbox line `requestedMode: "subagent"`; omission → neither present (legacy); invalid enum → zod
  reject at parse, nothing written.
- `send-tool/project-note-tool.test.ts` — same happy + legacy-omission pair for the note tool.

Command:
```
bun test packages/omo-opencode/src/features/cross-project-mailbox/send-tool
bun run typecheck
```

## WHAT WAS OBSERVED

```
bun test v1.3.14
 59 pass
 0 fail
 161 expect() calls
Ran 59 tests across 4 files. [333.00ms]
```

`bun run typecheck` — clean across all workspace packages (tsgo --noEmit, script, packages incl.
omo-opencode), no errors emitted.

Behavior proven:
- Sending with `requested_mode:"subagent"` → target `coordination_notes/<from>/<messageId>.md`
  frontmatter contains `requested_mode: subagent` AND the outbox jsonl line contains
  `requestedMode: "subagent"`.
- Omitting the field → envelope frontmatter has no `requested_mode` key and the outbox line has no
  `requestedMode` key (byte-shape identical to legacy, minus ids/timestamps).
- Invalid `requested_mode:"bogus"` → rejected at the strict send-side zod `.parse()` (throws), no file
  written, no outbox line (send side stays strict per task-1 contract; only the parse/receive side is
  lenient).

## WHY IT IS ENOUGH

The task is pure plumbing of one optional field through the send surface + audit log. Every hop in
that chain has a co-located given/when/then test: the builder (unit), the outbox serializer (unit),
and both tools end-to-end (writes a real note file + real outbox line to a temp repo and asserts the
on-disk bytes). Legacy backward-compat is pinned by explicit omission tests on all three surfaces, and
the pre-existing 53 send-tool tests still pass unchanged (59 total now). `mode=list` /
`readOutboundBudget` was not touched and its tests remain green. Preflight/budget/allowlist gating was
not touched (mode gating is receiver-side, task-2/4, not called here).

## WHAT WAS OMITTED

No secrets/tokens/env dumps involved — all fixtures are synthetic temp repos under `os.tmpdir()`.
No live opencode harness run needed: this change is a pure serialization/plumbing layer with no
lifecycle-hook or session interaction, fully covered by the co-located bun:test suite + typecheck.
Router/lane consumption of `requested_mode` is out of scope (tasks 4/10/12); the receiver-side
lenient parse of the field already landed in task-1.
