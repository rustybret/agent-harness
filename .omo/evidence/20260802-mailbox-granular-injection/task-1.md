# Task 1 Evidence — Envelope: `requested_mode` + tolerant parse

Plan: `.omo/plans/mailbox-granular-injection.md` (Todos item 1). Wave 1 foundation.

## WHAT WAS TESTED
Module: `packages/omo-opencode/src/features/cross-project-mailbox/envelope/schema.ts`
(pure TypeScript / Zod v4 schema module — not a live OpenCode harness surface, so
harness-driving QA does not apply; the correct QA surface is the module's own
`bun test` + full `typecheck`).

Commands run:
- `bun test packages/omo-opencode/src/features/cross-project-mailbox/envelope`
- `bun run typecheck` (tsgo --noEmit across all workspace packages incl. omo-opencode)

New/extended tests (given/when/then) in `schema.test.ts`:
1. `MAILBOX_MODES` const equals the six canonical modes in order.
2. Envelope WITH `requested_mode` round-trips serialize→parse (field preserved, deep-equal).
3. Envelope WITHOUT `requested_mode` parses with field `undefined` (unchanged behavior, deep-equal).
4. Frontmatter with an UNKNOWN key does not throw at parse and the unknown key is stripped.
5. Invalid `requested_mode` enum value (`bogus`) coerces to `undefined` at parse (no throw).
6. Still-missing REQUIRED field still throws (tolerance does not weaken required fields).

Intended behavior proven: additive `requested_mode` field round-trips; parse path
tolerates unknown keys and invalid enum without throwing; send/serialize path stays
strict; existing envelopes remain byte-for-byte functionally equivalent.

## WHAT WAS OBSERVED
- `bun test ... envelope`: **28 pass / 0 fail**, 41 expect() calls, 3 files. (Pre-existing
  16 tests all still green — no regression; +12 new assertions across the 6 new cases.)
- `bun run typecheck`: completed with **no errors** (all `tsgo --noEmit -p ...` package
  passes emitted no diagnostics), including `packages/omo-opencode/tsconfig.json`.
- `codegraph_callers` on `parseEnvelope` + `MailboxMessageSchema`: the two production
  call sites (`send-tool/envelope-builder.ts:findProcessedParent`,
  `mailbox/mailbox-store.ts:parseNote`) consume `parseEnvelope`'s return shape only;
  `MailboxMessageSchema` has no external callers in the live tree (only the local test).
  The additive optional field + unchanged return type means neither call site breaks.

## WHY IT IS ENOUGH
- The change is purely additive (one optional field) plus a widened parse tolerance;
  the strict serialize path is untouched, so the write contract is unchanged and proven
  by the still-green pre-existing round-trip + strict-validation tests.
- Both new behaviors required by the spec (tolerate unknown keys; coerce invalid enum to
  `undefined` with a logged warning) are asserted directly, and the negative case
  (missing required field still throws) guards against over-loosening.
- `version` unchanged, body handling unchanged, `canonicalizeLegacyIntent` path unchanged
  (still exercised by the existing intent round-trip tests).
- Full `typecheck` is the real type gate (AGENTS.md notes AFT's LSP is a checkpoint, not
  the authority); it is clean.

## WHAT WAS OMITTED
- No live OpenCode harness / SSE / TUI QA: this module is a leaf schema with no lifecycle
  hook or tool wiring changed by this task; downstream wiring (tasks 3/4/6-12) is where
  harness QA becomes relevant.
- No secrets, tokens, env dumps, or auth headers were produced or recorded.
- Did not modify consumers (`envelope-builder.ts`, `mailbox-store.ts`) or the `index.ts`
  barrel — out of task-1 scope by the plan.
