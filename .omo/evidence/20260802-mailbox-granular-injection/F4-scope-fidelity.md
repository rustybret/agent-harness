# F4 - Scope Fidelity

## WHAT WAS TESTED
The complete implementation of the `mailbox-granular-injection` work plan was audited against the `## Scope / Must have` and `## Must NOT have` sections of the plan. The goal was to verify that all C1-C8 items were delivered without silent MVP reduction, envelope backward-compatibility was proven, cloudhome halves were contract-only, and all guardrails were respected.

## WHAT WAS OBSERVED
- **C1 wire vocabulary & send surface**: `requested_mode` is added to `MailboxMessageSchema` as optional (`packages/omo-opencode/src/features/cross-project-mailbox/envelope/schema.ts:40`). `LenientMailboxMessageSchema` uses `.strip()` to tolerate unknown keys (`schema.ts:56`). The send surface in `project-message-tool.ts` and `project-note-tool.ts` accepts `requested_mode` and threads it through to the envelope and outbox log (`packages/omo-opencode/src/features/cross-project-mailbox/send-tool/project-message-tool.ts:33,188`).
- **C2 side-session Q&A**: `answer-local` lane spawns a child session via `client.session.create({ parentID })`, waits for the answer, acks the note, and sends a threaded reply (`packages/omo-opencode/src/features/cross-project-mailbox/lanes/answer-local.ts:135`).
- **C2c cloudhome-hosted answer**: `dispatchRemoteContract` sends an outbound contract note to cloudhome and records a local pending entry (`packages/omo-opencode/src/features/cross-project-mailbox/contracts/cloudhome.ts:95`).
- **C3 todo-injection**: `todo-append` and `todo-next` mutate the active session's todo list via the SDK write route (`todoWriter`), with `addBoulderWork` as the durable fallback (`packages/omo-opencode/src/features/cross-project-mailbox/todo-inject/todo-inject.ts:117,148`).
- **C4 subagent**: `subagent` lane dispatches a background task (single or investigate-then-implement pair) and sends a reply upon completion (`packages/omo-opencode/src/features/cross-project-mailbox/lanes/subagent.ts:243`).
- **C5 worker-PR**: `worker-pr` lane writes a work-order file, creates a task-owned git worktree (`git worktree add`), and launches a headless worker via `bun run-worker.mjs` (`packages/omo-opencode/src/features/cross-project-mailbox/lanes/worker-pr.ts:144`).
- **C6 intake router**: `decideRoute` is a pure function (`packages/omo-opencode/src/features/cross-project-mailbox/router/decide-route.ts:67`) and is executed in the idle-drain hook via `processNote` (`packages/omo-opencode/src/features/cross-project-mailbox/hooks/idle-drain-processor.ts:226`).
- **C7 safe interrupt**: `interrupt` lane prepends a todo and dispatches an internal prompt with `queueBehavior: "enqueue"` (`packages/omo-opencode/src/features/cross-project-mailbox/lanes/interrupt.ts:75`). The sender-side trigger POSTs to `/rpc/mailbox_drain_now` (`packages/omo-opencode/src/features/cross-project-mailbox/lanes/interrupt-sender-trigger.ts:69`).
- **Classifier subagent**: `classifyNote` uses a background task to classify ambiguous notes (`packages/omo-opencode/src/features/cross-project-mailbox/router/classifier.ts:253`). It is wired into production deps via `buildClassifyNote` (`packages/omo-opencode/src/features/cross-project-mailbox/hooks/create-mailbox-hooks.ts:125`).
- **C8 cipher-relay e2e harness**: The harness is delivered in `test-support/e2e/mailbox-cipher-relay/` and its self-test passes. The live run was descoped by explicit user directive.
- **Todo 17 trace layer**: `emitMailboxTrace` is wired at real lifecycle edges in `project-message-tool.ts`, `idle-drain-processor.ts`, and `route-note-dispatcher.ts`.
- **Guardrails**: No orchestrator implementation, no mid-turn abort (interrupt uses `enqueue`), no raw `session.prompt` outside the gate (audit test passes), no cloudhome-side executor, no openclaw in the critical path, no breaking change for peers (absent `requested_mode` falls back to legacy behavior), no `mock.module` at module top level (audit test passes).
- **MAILBOX_MODES duplication**: The duplication of `MAILBOX_MODES` in `permission-tiers.ts` and `envelope/schema.ts` is an acceptable recorded debt, as it was deliberate for parallelization and the tuples are identical.

## WHY IT IS ENOUGH
Every scope item from C1-C8 has been traced to real delivered code and cited by file and line number. There is no silent MVP reduction; all features are fully implemented and reachable from production paths. Envelope backward-compatibility is proven by tests in `schema.test.ts`. Cloudhome halves are strictly contract-only. All guardrails are respected and verified by audit tests.

## WHAT WAS OMITTED
The live run of the cipher-relay e2e harness (Todo 16) was omitted as it was explicitly descoped by the user in favor of live-session observation (Todo 17 trace layer).

**Verdict: APPROVE**
