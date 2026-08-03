# F1 Plan Compliance Audit

## WHAT WAS TESTED
Plan compliance audit for the `mailbox-granular-injection` plan.
Verified every completed todo (1-15) against its acceptance criteria as actually implemented in the diff.
Confirmed the dependency/wave ordering was honored.
Confirmed NO scope-out item was built (no orchestrator implementation, no dedicated intake agent, no mid-turn abort, no raw `session.prompt`/`session.promptAsync` calls outside `prompt-async-gate.ts`).
Todo 16 is on a safety hold and is explicitly excluded from this audit's PASS/FAIL determination.

## WHAT WAS OBSERVED
**Verdict: APPROVE**

### Itemized Findings per Todo (1-15)
- **Todo 1 (Envelope):** `requested_mode` added to `MailboxMessageSchema` as optional. `parseEnvelope` uses `.strip()` to drop unknown keys. `serializeEnvelope` uses `.strict()`.
- **Todo 2 (Mode gating):** `MODE_TIER` and `modeWithinBudget` implemented in `permission-tiers.ts`. `allowed_modes` added to `SenderConfigSchema`. `decideDowngrade` implemented to silently downgrade over-budget or disallowed modes to legacy triage.
- **Todo 3 (Send tools):** `requested_mode` added to `createProjectMessageInputSchema`, `project_message`, `project_note`, `SendInput`, and `buildSendEnvelope`. `appendOutboxLog` serializes `requestedMode` when present.
- **Todo 4 (Router core):** Pure `decideRoute` function implemented in `router/decide-route.ts` with the specified routing table. No I/O or LLM used.
- **Todo 5 (Todo write-path spike):** `createTodoInjector` implemented in `todo-inject.ts` using a read-merge-write port backed by SQLite. Falls back to `addBoulderWork` when no live session exists. Spike verdict recorded in `todo-inject/README.md`.
- **Todo 6 (Side-session Q&A lane):** `createAnswerLocalLane` implemented in `lanes/answer-local.ts`. Spawns child session, ACKs note BEFORE building reply, sends threaded reply. Child failure rolls back to triage.
- **Todo 7 (Todo injection lane):** `runTodoInjectLane` implemented in `lanes/todo-inject-lane.ts`. Appends or inserts next based on mode. Composes todo text with provenance tag. ACKs note on success.
- **Todo 8 (Subagent fulfillment lane):** `runSubagentLane` implemented in `lanes/subagent.ts`. Dispatches background task(s) without occupying main turn. Handles `[investigate-then-implement]` marker. Sends threaded reply on completion/failure.
- **Todo 9 (Worker-PR lane):** `createWorkerPrLane` implemented in `lanes/worker-pr.ts`. Writes work order, creates git worktree, spawns wrapper. Watchdog implemented in `lanes/worker-pr-watchdog.ts` to handle PR-intake and cleanup policy.
- **Todo 10 (Safe interrupt lane):** `createInterruptLane` implemented in `lanes/interrupt.ts`. Prepends todo, injects prompt via `dispatchInternalPrompt` with `queueBehavior: "enqueue"`. Sender-side immediate trigger implemented via `mailbox_drain_now` RPC.
- **Todo 11 (Cloudhome contract variants):** `dispatchRemoteContract` and `handleRemoteCompletionReply` implemented in `contracts/cloudhome.ts`. Uses versioned request payload schema and local pending record.
- **Todo 12 (Router integration):** `processNote` implemented in `hooks/idle-drain-processor.ts`. Wires `decideRoute` and lane executors. Threads `effective_mode` and `downgradeReason` into pending-delivery records.
- **Todo 13 (Classifier subagent):** `classifyNote` implemented in `router/classifier.ts`. Dispatches cheap background task, caches result per messageId. Timeout/parse-failure returns triage.
- **Todo 14 (Config schema regen + docs):** `allowed_modes` and `worker_pr_variant` added to `assets/oh-my-opencode.schema.json`. `docs/reference/cross-project-mailbox.md` updated with new modes and roadmap.
- **Todo 15 (Cipher-relay e2e harness):** Implemented in `test-support/e2e/mailbox-cipher-relay/`. Includes generator, arbiter, and self-test commands.

### Guardrails Confirmation
- **NO orchestrator implementation / dedicated intake agent:** Confirmed via grep. No such code was added.
- **NO mid-turn abort:** Confirmed in `lanes/interrupt.ts`. Uses `queueBehavior: "enqueue"` to inject at the next safe boundary.
- **NO raw `session.prompt`/`session.promptAsync`:** Confirmed via grep. No calls exist outside `prompt-async-gate.ts`.
- **Dependency/wave ordering:** Honored as documented in the learnings notepad.

## WHY IT IS ENOUGH
Every completed todo was verified against its acceptance criteria by inspecting the actual code changes in the working directory. The guardrails were explicitly checked using grep and code inspection. The implementation matches the plan exactly.

## WHAT WAS OMITTED
Todo 16 is on a safety hold and was excluded from this audit. No process-management commands were run, and no source files were modified during this read-only audit.