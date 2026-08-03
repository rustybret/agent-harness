# Learnings — mailbox-granular-injection

Conventions, patterns, and successful approaches discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## 2026-08-02 - Task 5 todo-inject spike verdict

- SDK `client.session.todo` is read-only. Evidence: repo read precedent at `packages/omo-opencode/src/tools/session-manager/sdk-storage.ts:130-145`; SDK `Session.todo` is documented as “Get a session's todo list” at `node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.d.ts:136-138`; `SessionTodoData` has `body?: never` and only `url: "/session/{id}/todo"` at `node_modules/.bun/@opencode-ai+sdk@1.15.13/node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:1974-1986`, with only `200: Array<Todo>` at `types.gen.d.ts:1998-2003`.
- `Todo.update` is the repo's existing internal write precedent (`packages/omo-opencode/src/hooks/compaction-todo-preserver/hook.ts:85-94` import, `hook.ts:167-176` write call), but live isolated OpenCode v1.18.5 file-plugin QA could not resolve `opencode/session/todo` from plugin code. Artifact: `.omo/evidence/20260802-mailbox-granular-injection/task-5-todoupdate-unavailable-result.json`.
- Chosen working route for `createTodoInjector`: read current todos via `client.session.todo`, write merged list directly to the OpenCode SQLite `todo` table via `bun:sqlite`, then verify with `client.session.todo`. Live artifact: `.omo/evidence/20260802-mailbox-granular-injection/task-5-live-result.json` shows prepend/append persisted and read back through the real SDK.
- Liveness check uses `client.session.get({ path: { id: sessionID } })`, not `client.session.status()`: live QA showed a newly created idle session is retrievable by `session.get` but absent from the status map. Downstream todo lanes should treat `session.get` failure as the no-live-session condition and then accept the boulder fallback.

## Task 1 — Envelope: requested_mode + tolerant parse (Wave 1 foundation)

**Spike verdict — tolerant-parse approach chosen:** `MailboxMessageSchema.extend({ requested_mode: ... }).strip()`.
- The exported strict schema (`.strict()`) stays the send-side validator (`serializeEnvelope`) unchanged.
- Parse path uses a separate `LenientMailboxMessageSchema` derived via `.extend(...).strip()`. `.strip()` overrides the inherited `.strict()` unknown-key policy, so unknown frontmatter keys are dropped instead of throwing (verified: future-key test passes). Required fields still throw when missing (tolerance does NOT weaken required fields — verified).
- Invalid `requested_mode` enum value coerced to `undefined` via zod v4 `.catch((ctx) => { log(...); return undefined })`. This is the clean way to "log a warning + fall back" without try/catch. `ctx.value` / `ctx.issues` are the v4 ZodCatchCtx fields.

**Gotchas / conventions confirmed:**
- Logger: `import { log } from "../../../shared/logger"`; call as `log("message", { ...context })`. There is NO `log.warn` — it is a single function (matches existing `outbox-log.ts` usage).
- Zod is v4.4.3 in this repo. `.catch()` accepts a ctx callback in v4.
- Export names (downstream tasks 3/4/6-12 depend on these EXACTLY): `MAILBOX_MODES` (const tuple), `MailboxMode` (type = `(typeof MAILBOX_MODES)[number]`).
- Canonical modes order: `answer, todo-append, todo-next, subagent, worker-pr, interrupt`.
- Did NOT re-export `MAILBOX_MODES`/`MailboxMode` from `envelope/index.ts` yet — the barrel currently only re-exports `MAILBOX_INTENTS`/`MAX_BODY_BYTES`/`MailboxMessageSchema`/`parseEnvelope`/`serializeEnvelope` + `MailboxMessage` type. If a downstream task imports via the barrel rather than `./schema`, it must add those two exports to `index.ts`. (Left untouched to stay strictly within task-1 scope: envelope/schema module + its test.)
- LSP diagnostics tool doubled the package path (`packages/omo-opencode/packages/omo-opencode/...`) — use `bun run typecheck` instead for this package.

## Task 2 — Mode gating (mode→tier map + allowed_modes config + decideDowngrade)

### Exact names chosen (contract for downstream tasks 4, 12, 14)
- `permission-tiers.ts` exports: `MAILBOX_MODES` (const tuple), `MailboxMode` (type), `MODE_TIER: Record<MailboxMode, CanonicalIntent>`, `modeWithinBudget(mode, grantedCeiling): boolean`.
- `config.ts` exports: `SenderConfigSchema` (now exported — was previously module-private), `SenderConfig` type, `DowngradeDecision` interface, and the PURE `decideDowngrade(note: { requested_mode?: MailboxMode }, senderCfg: SenderConfig): DowngradeDecision`.
- `DowngradeDecision = { effectiveMode: MailboxMode | undefined; downgradeReason?: string }`.
- Config field name: **`allowed_modes`** (snake_case), `z.array(z.enum(MAILBOX_MODES)).optional()`.

### decideDowngrade rule (order matters)
1. No `requested_mode` → `{ effectiveMode: undefined }` (NO reason) = legacy triage path, byte-identical to before.
2. Over budget (`!modeWithinBudget`) → `{ effectiveMode: undefined, downgradeReason: "mode-over-budget" }`. **Budget check runs FIRST** — if a mode is both over-budget AND disallowed, the reason is `mode-over-budget`.
3. Allowlist present AND omits mode → `{ effectiveMode: undefined, downgradeReason: "mode-not-allowed" }`.
4. Otherwise → `{ effectiveMode: mode }` (kept, no reason).
Never hard-rejects — downgrade only.

### zod .transform() metadata stripping (memory #1570) — how handled
- `IntentBudgetSchema` uses `.transform().pipe(z.enum(...))` ONLY because it must fold 6 legacy tiers into 3 canonical ones (needs coercion).
- `allowed_modes` needs NO coercion, so I used a **bare `z.array(z.enum(MAILBOX_MODES)).optional()`** — no `.transform()`. This keeps the enum list intact in the generated JSON schema. Did NOT introduce a naive `.transform()`. `z.preprocess()` was not needed since no normalization is required.
- Left a comment block in config.ts explaining this for task-14 (schema regen).

### MailboxMode duplication note (for task-4 / follow-up)
- Per task constraints (task-1 running in parallel, not landed), I defined a LOCAL `MAILBOX_MODES`/`MailboxMode` in `permission-tiers.ts` rather than importing from `envelope/schema.ts`.
- Task-1 (envelope) will define its own `MAILBOX_MODES`/`MailboxMode` in `envelope/schema.ts`.
- **FOLLOW-UP for task-4 (router) or a dedicated unify pass:** collapse the two `MailboxMode` definitions into ONE canonical export (likely permission-tiers re-exporting from envelope, or vice versa) once task-1 lands. The literal tuples are identical: `["answer","todo-append","todo-next","subagent","worker-pr","interrupt"]`. Kept a plain-language note in the code comment (no bare TODO token per project rules).

### Legacy path proof
- validate-inbound.ts was NOT touched. The no-`requested_mode` case in `decideDowngrade` returns `{ effectiveMode: undefined }` with no reason, and `decideDowngrade` is not yet wired into any drain path — task-4/12 do that. All pre-existing permission-matrix / config / validate-inbound tests stay green byte-identically.

### Test layout
- Extended EXISTING `permission-tiers.test.ts` (MODE_TIER/MAILBOX_MODES/modeWithinBudget with independent oracle), `permission-matrix.test.ts` (6×3×3 decideDowngrade matrix + no-mode legacy + over-budget-wins-over-allowlist), `config.test.ts` (allowed_modes parse/omit/reject + SenderConfigSchema direct). No new parallel test files created.

## Task 4 — Router core: pure decideRoute()

- New task-12 contract exports live under `packages/omo-opencode/src/features/cross-project-mailbox/router/`: `decideRoute`, `RouteContext`, `RouteDecision`, `RouteLane`, `RoutePresence`.
- `decideRoute(note, senderCfg, ctx)` imports `decideDowngrade` plus `SenderConfig`/`DowngradeDecision` from `../config`, and imports canonical `MailboxMode`/`MailboxMessage` types from `../envelope/schema`.
- Lane names are exact contract strings: `triage`, `answer-local`, `answer-remote`, `todo-append`, `todo-next`, `subagent`, `worker-pr-local`, `worker-pr-cloudhome`, `interrupt`, `classify`.
- Downgraded requested modes preserve `downgradeReason` even when the downgraded legacy ambiguity heuristic selects `classify` instead of `triage`.
- `answer` with no live presence routes to `answer-remote` unless `inFlightLocalFlag === true` and `intent === "question"`, which routes to `triage` with `remote-unsafe-for-in-flight` and no `effectiveMode`.
- `worker-pr` defaults to `worker-pr-local` in the pure router. `worker-pr-cloudhome` selection remains a task-11 contract concern where declared variant metadata can be handled without adding I/O to the pure core.
- MailboxMode duplication was not unified in `config.ts`/`permission-tiers.ts` because task-4's must-not scope says those files are read-only for this task. Router code uses the canonical envelope type locally; a dedicated follow-up can safely collapse `permission-tiers.ts` to re-export the envelope tuple/type.

## Task 3 — Send tools: requested_mode arg + outbox audit fields (Wave 1)

### Import path (contract for downstream tasks 10/12/15/16)
- `MAILBOX_MODES` and `MailboxMode` are imported DIRECTLY from `../envelope/schema` (NOT the
  `../envelope/index` barrel — task-1 confirmed the barrel does not re-export them). Exact lines used:
  - `envelope-builder.ts`: `import type { MailboxMessage, MailboxMode } from "../envelope/schema"`
  - `outbox-log.ts`: `import type { MailboxMode } from "../envelope/schema"`
  - `project-message-tool.ts` / `project-note-tool.ts`: `import { MAILBOX_INTENTS, MAILBOX_MODES, MAX_BODY_BYTES, type MailboxMessage } from "../envelope/schema"` (added `MAILBOX_MODES` to the existing combined import — kept alphabetical between INTENTS and MAX_BODY_BYTES).

### Field naming (deliberate split — matches existing repo convention)
- Wire/envelope field is snake_case `requested_mode` (matches envelope schema + all other envelope keys).
- Outbox audit field is camelCase `requestedMode` (matches existing `OutboxEntry` fields `toProjectId`/`toRepoRoot`/`correlationId` etc — outbox log is an internal audit record, not the wire).
- Call sites bridge them: `append(..., { requestedMode: built.envelope.requested_mode })`.

### Optional-field serialization style in outbox-log record
- Existing `toRepoRoot` is written unconditionally as `entry.toRepoRoot` (yields `"toRepoRoot": undefined` which `JSON.stringify` DROPS from the line — so absent = key not in JSON). For `requestedMode` I used an explicit conditional spread `...(entry.requestedMode === undefined ? {} : { requestedMode: entry.requestedMode })` to guarantee key omission and pin it with a test (`"requestedMode" in parsed === false`). Both approaches produce the same JSON, but the spread is test-provable without relying on JSON.stringify's undefined-drop.

### Send side stays STRICT (invalid enum throws)
- Input zod schemas (`createProjectMessage/NoteInputSchema`) use `z.enum(MAILBOX_MODES).optional()` — an invalid value like `"bogus"` throws at `inputSchema.parse(rawArgs)` inside `execute`, so the send NEVER writes a bogus mode. This is correct per task-1's note: lenient coerce-to-undefined is receive-side only.
- NOTE: the tool-arg schema (`tool.schema.enum(...)`) is the harness-facing declaration; the actual runtime validation gate is the separate `inputSchema.parse()` call. Both got the field.

### Test file note
- There was NO pre-existing `envelope-builder.test.ts` — created it fresh (2 tests). The other 3 test files were extended in place.
- Full send-tool suite: 59 pass / 0 fail after changes (was 53). `bun run typecheck` clean.
- Verified real call sites via codegraph_callers: only `runProjectMessageSend`, `runProjectNoteSend`, and `__tests__/two-repo-integration.test.ts`'s `createEnv` (the last passes SendInput without requested_mode — stays valid since the field is optional; not touched).

## Task 8 — Subagent lane port contract

- New lane entrypoint: `runSubagentLane(note: SubagentLaneNote, deps: SubagentLaneDeps): Promise<SubagentLaneResult>` in `packages/omo-opencode/src/features/cross-project-mailbox/lanes/subagent.ts`.
- Pure budget helper: `resolveDispatchCategory(note: SubagentLaneNote, senderCeiling: CanonicalIntent): { category: string } | { downgrade: true; reason: string }`. It keeps in-budget categories, downgrades over-budget or plan-family categories to `quick`/`unspecified-low` when the sender ceiling permits, and returns downgrade-to-triage when no non-plan-family category fits.
- Spawn port for task-12 router wiring: `spawn(input: { description: string; prompt: string; agent: string; category?: string; parentSessionId: string; parentMessageId: string }): Promise<{ taskId: string }>`.
- Completion port: `waitForTask(taskId: string): Promise<{ status: "completed" | "failed"; result?: string }>`.
- Reply port: `sendReply(note, summary)` where summary is `{ status: "completed" | "failed"; category: string; taskIds: readonly string[]; resultSummary?: string; errorSummary?: string; evidencePath?: string }`.
- Ack port: `ack(messageId: string): Promise<void>`. The lane calls it immediately after the first successful `spawn`, before any `waitForTask`; fulfillment is then tracked by threaded completion/failure replies.
- Split marker is the literal case-insensitive substring `[investigate-then-implement]`. Presence dispatches `explore` first, waits for findings, then dispatches `sisyphus-junior` with findings appended. Absence dispatches one `sisyphus-junior` task.

## Task 7 — Todo injection lane (todo-append / todo-next)

- New lane contract for task-12 wiring: `runTodoInjectLane(note: TodoInjectLaneNote, sessionID: string, injector: TodoInjector, deps: TodoInjectLaneDeps): Promise<TodoInjectResult>` from `packages/omo-opencode/src/features/cross-project-mailbox/lanes/todo-inject-lane.ts`.
- `TodoInjectLaneNote` narrows `envelope.requested_mode` to `"todo-append" | "todo-next"`, so the router must call this lane only after deciding one of those two modes.
- The lane builds exactly one `TodoInjectItem` with `content` only. It intentionally omits `status`, letting `createTodoInjector` default status to `pending`; it also omits `priority`, letting the injector default to `medium`.
- Confirmation convention kept deliberately small for task-12: send confirmation only when `sendConfirmation` is injected AND either note body contains case-insensitive `[confirm]` or `envelope.category === "confirm"` case-insensitively.

## Task 6 — Answer-local lane (side-session Q&A)

- New task-12 contract export: `createAnswerLocalLane(deps)` from `packages/omo-opencode/src/features/cross-project-mailbox/lanes/answer-local.ts`. Returned port shape is `{ fulfill(note: UnreadMessage): Promise<AnswerLocalLaneResult> }`.
- `AnswerLocalLaneDeps` exact shape: `{ answerHostSessionId?, client, directory, dispatchInternalPrompt?, log?, parentSessionId, sendReply, store, timeoutMs?, waitForAnswer }`.
- `client` must provide `session.create({ body: { parentID }, query: { directory } })` plus the `promptAsync` shape needed by `dispatchInternalPrompt`. The child parent is `answerHostSessionId ?? parentSessionId`.
- `store` is intentionally narrow: `{ ack(messageId), unreserve(messageId) }`. The lane owns ack and rollback directly because task-12 will pass an already-reserved note.
- `sendReply(input: SendInput)` is injected rather than importing `runProjectMessageSend` directly. Task-12 should bind it to project-message semantics with `targetProjectId = note.envelope.fromProjectId`, `intent = "question"`, and `inReplyToMessageId = note.messageId`.
- Prompt delivery is always through `dispatchInternalPrompt` with inline `{ mode: "async", queueBehavior: "defer", ... }`; no raw `session.promptAsync` calls were added.
- ACK ordering is pinned: wait for child completion, `store.ack(note.messageId)`, then `sendReply(...)`. Post-ack reply failure logs and returns `{ status: "answer-dropped", reason: "reply-send-failed" }` without calling `unreserve`; pre-ack child create/dispatch/wait failures call `store.unreserve(note.messageId)` and return `{ status: "rolled-back", downgradeReason: "child-session-failed" }`.

## Task 9 — Worker PR local lane substrate

- New task-12 contract exports live under `packages/omo-opencode/src/features/cross-project-mailbox/lanes/`: `createWorkerPrLane`, `resolveWorkerPrDeadlineMs`, `runWorkerPrWatchdogTick`, `buildWorkerPrWorkOrder`, `resolveWorkerPrPaths`, and `shortWorkerPrId`.
- `WorkerPrLaneDeps` exact shape: `{ execGit?, now?, repoRoot, spawn?, wrapperPath?, writeWorkOrder? }`. `execGit(args, { cwd })` owns `git worktree add`; `spawn(command, { cwd })` owns wrapper launch; `now()` drives the deadline; `writeWorkOrder(path, content)` owns `.omo/mailbox-work/<messageId>.md` writes.
- `WorkerPrWatchdogDeps` exact shape: `{ checkWorkerReplyExists, execGit?, log?, now, readRunRecords?, repoRoot, sendFallbackReply, writeRunRecord? }`. Task-12 should call `runWorkerPrWatchdogTick` from the presence heartbeat and bind `sendFallbackReply` to a direct note reply back to `fromProjectId` with `inReplyToMessageId = messageId`.
- Path/branch contract is pinned: work order `.omo/mailbox-work/<messageId>.md`; run record `.omo/mailbox-work/runs/<messageId>.json`; worktree `.local-ignore/worktrees/mailbox-<shortId>`; branch `omo/mailbox/<shortId>` where `<shortId>` is the first 8 chars of `messageId`.
- Deadline default is 60 minutes via `resolveWorkerPrDeadlineMs`; override is `OMO_MAILBOX_WORKER_DEADLINE_MIN` in minutes.
- Worker work-order text explicitly tells the internal `opencode run` worker to reply with `project_note`, not `project_message`, and to set `inReplyToMessageId` to the original messageId. It also instructs the worker to write `.omo/mailbox-work/replies/<messageId>.json` after its own reply so the watchdog can confirm success.
- Cleanup policy implemented in the watchdog: success with reply marker prunes the successful worktree; success without marker sends a `success-with-warning` fallback before pruning; failed/deadline-exceeded worktrees are kept but capped at 5, oldest first, with each cap prune logged.

## Task 10 — Interrupt lane + sender drain-now nudge

- Interrupt receiver lane export: `createInterruptLane(deps)` from `packages/omo-opencode/src/features/cross-project-mailbox/lanes/interrupt.ts`. It snapshots todos, calls `injector.prepend(...)` first, then calls `dispatchInternalPrompt` with an inline object literal and `queueBehavior: "enqueue"`. `"enqueue"` is the real `InternalPromptQueueBehavior` member for urgent queued delivery; `"defer"` remains the next-idle-only behavior used by answer-local.
- Interrupt prompt label is literal `URGENT-INTERRUPT`; prompt body includes the note body and asks the receiver to re-evaluate the current plan step at the next safe boundary.
- Accepted dispatch means `status === "dispatched" || status === "queued"` via `isInternalPromptDispatchAccepted`. Only then does the lane call `store.ack(messageId)`. Rejected dispatch restores the exact todo snapshot with `injector.restore(sessionID, snapshot)`, then `store.unreserve(messageId)` returns the note to unread.
- Sender-side drain RPC wire contract: `POST http://127.0.0.1:<port>/rpc/mailbox_drain_now` with JSON body `{ "token": "<bridge-token>" }`; authenticated response is HTTP 200 with `{ "triggered": boolean }`. The same top-level token check in `createRequestRouter` gates `describe`, `inject`, and `mailbox_drain_now`.
- `startExternalInjectBridge` now accepts optional injected `runMailboxDrainNow`; task-12 should wire this to the real router-integration drain function. Until then, absent dependency returns `{ triggered: false }`.
- `runProjectMessageSend` only nudges after a successful interrupt-mode file write and outbox append. The nudge reads the target bridge port file from `portFileDir(targetRepoRoot)`, picks the newest live record, posts `mailbox_drain_now`, and always degrades to `{ triggered: false }` on missing port files, network errors, or non-2xx responses without failing the send.

## Task 11 — Cloudhome contract variants (answer-remote + worker-pr-cloudhome)

### D6 selectWorkerPrVariant criterion (task-12 MUST use this)
- **D6 verbatim** (from `.omo/drafts/mailbox-granular-injection.md:58`): "C5 = option c. Local
  headless worktree worker is the default substrate ...; PLUS a declared worker=cloudhome variant
  where agent-harness ships only the request/PR-intake contract side and actual execution is
  delegated to cloudhome (cross-project coordination item, routed via project_message per memory
  #2010)."
- Key word is **"declared"** — cloudhome is chosen ONLY when EXPLICITLY declared, never inferred.
  `selectWorkerPrVariant(note, senderCfg)` in `contracts/cloudhome.ts`:
  1. `note.category === "worker-pr-cloudhome"` (const `CLOUDHOME_WORKER_VARIANT_CATEGORY`) → cloudhome.
  2. else `senderCfg.worker_pr_variant === "cloudhome"` → cloudhome.
  3. else → `"worker-pr-local"` (preserves the pure router's default).
  Note-level declaration wins over sender-level. Pure fn, no I/O.
- **Task-12 call site:** after `decideRoute` returns `worker-pr-local`, call
  `selectWorkerPrVariant(note, senderCfg)` to potentially upgrade the lane. `senderCfg` needs an
  OPTIONAL `worker_pr_variant?: "local"|"cloudhome"` field added to `SenderConfigSchema` in
  `config.ts` (task-14 schema regen) — NOT added by task-11 (config.ts was read-only for me).
  The helper accepts a structural `WorkerPrVariantSenderConfig` so it works before that lands.

### Pending-record file layout (task-12 needs both keys)
- `createRemotePendingStore({ baseDir, fs })` — `fs` is an INJECTED `RemotePendingFsPort`
  (mkdir/readFile/writeFile/rename/rm/readdir). Task-12 supplies a real fs adapter + baseDir.
- **baseDir**: use `.omo/mailbox-work/remote-pending/` (per task spec). One JSON file per pending
  contract: `<baseDir>/<sanitizedOriginalMessageId>.json`. Atomic tmp+rename, mirrors
  `mailbox/pending-delivery-store.ts`.
- **RemotePendingRecord** fields: `originalMessageId` (PRIMARY key = inbound note being fulfilled),
  `outboundMessageId` (SECONDARY index — the contract note sent to cloudhome), `originalFromProjectId`,
  `originalCorrelationId`, `kind` ("remote-answer"|"remote-worker-pr"), `requestPayload`
  (the full `RemoteMailboxRequest`), `createdAt`.
- **Threading direction (critical):** the remote completion reply's `inReplyToMessageId` references
  the OUTBOUND contract note's messageId → `store.findByOutboundMessageId(outboundMessageId)` resolves
  back to the original note. Pending is keyed by originalMessageId for dedupe (`isPending`), indexed by
  outboundMessageId for intake.

### API surface exported from contracts/index.ts (task-12 imports)
- `dispatchRemoteContract(note, kind, config, deps)` → `{status:"pending-remote", deduped:bool, outboundMessageId?}`.
  Dedupes: if already pending, returns `deduped:true` and sends nothing. Otherwise sends via injected
  `deps.sendOutbound({request,kind,note}) → {outboundMessageId}` then `markPending`.
- `handleRemoteCompletionReply(reply, deps)` where deps = `{store, ackOriginal, forwardAnswer}`.
  Returns `completed | ignored(reply-missing-inreplyto|no-matching-pending) | quarantined(empty-remote-completion)`.
  Malformed/non-matching → pending untouched. Match → ack original, forward to `originalFromProjectId`
  with `inReplyToMessageId=originalMessageId`, then `clearPending`.
- `buildRemoteContractOutbound(note, kind, {thisProjectId,repo,gitRef?})` → `RemoteMailboxRequest`.
- `RemoteMailboxRequestSchema` (zod, strict, v1) from `contracts/schema.ts`.
- `REMOTE_CONTRACT_CATEGORY = "machine:remote-mailbox-contract"` — category to stamp on the outbound
  cloudhome note so it is machine-consumable.

### Real cloudhome note: NOT sent — fixture produced
- Did NOT invoke live `project_message` (I am an implementation subagent, not the live orchestrator
  session). Produced `contracts/cloudhome-contract-note.md` with the exact args + body to send.
  Orchestrator should send it to `cloudhome-5aa53d2c` (grant=plan), category
  `machine:remote-mailbox-contract`, intent `plan`. Honors memory #1416 (no plaintext secrets).

### Results
- `bun test …/contracts` → 17 pass / 0 fail. `bun run typecheck` clean. No as-any/ts-ignore, DI-only
  (no mock.module), barrel index, all files <200 LOC.

## Task 12 — Router integration wiring

- Optional classifier port shape chosen for task-13: `classifyNote?: (note: UnreadMessage, deps: { senderConfig: SenderConfig; routeContext: RouteContext }) => Promise<RouteDecision>`. `ClassifyResult` is currently an alias of `RouteDecision`; returning `lane:"classify"` is normalized to legacy triage to avoid classifier recursion.
- Pending delivery records gained additive optional camelCase fields: `requestedMode`, `effectiveMode`, `downgradeReason`, and `lane`. Existing `messageId/sessionId/reservedPath/dispatchedAt/state` fields remain unchanged.
- Idle drain now keeps a per-hook in-memory fallback set for thrown lane exceptions: thrown lane → rollback reserved note + rollback digest + add messageId; the next drain pass forces legacy triage for that messageId. This is intentionally at the dispatch boundary, not inside individual lanes.
- Manual drain reports route metadata without changing its raw-return contract: each drained note includes `requestedMode`, `effectiveMode`, `downgradeReason`, `routeLane`, and `guidance` (for example `routed to worker-pr-local lane`).
- `runMailboxDrainNow(sessionId)` is exposed on the idle-drain hook and wired from the external-inject bridge after hooks are created, so bridge nudges call the same routed drain path used by idle and heartbeat. Heartbeat also runs `runWorkerPrWatchdogTick` before the idle-drain callback.

## Task 13 — Classifier subagent port

- New router export: `classifyNote(note: { envelope: MailboxMessage; body: string }, deps: ClassifierDeps): Promise<ClassifyResult>` from `packages/omo-opencode/src/features/cross-project-mailbox/router/classifier.ts`.
- `ClassifierDeps` exact shape: `{ classify(prompt: string): Promise<string>; cache: ClassificationCache; timeoutMs?: number; timer?: ClassifierTimerPort }`. The injected `classify` port is intentionally a narrow quick-category background dispatch seam; the module never imports BackgroundManager and never touches the main receiver session.
- `ClassifyResult` shape: success is `{ mode: MailboxMode }` for canonical modes or `{ mode: undefined }` for explicit classifier `triage`; failure is `{ mode: undefined; reason: "timeout" | "parse-failure" | "classifier-error" }`. Task-12 should treat `mode: undefined` as triage fallback and keep budget gating outside this module.
- `ClassificationCache` mirrors the BodyDigestStore pattern: constructor options `{ repoRoot, ttlMs, fs?, now? }`, file path `<repoRoot>/coordination_notes/.classification-cache.json`, atomic tmp+rename writes, TTL pruning, injectable fs for tests. Cache is keyed by `messageId`; a hit returns without redispatch.
- Defensive guard: if `note.envelope.requested_mode` is already present, `classifyNote` returns `{ mode: undefined, reason: "parse-failure" }` and does not call `deps.classify`. Caller should still enforce the router-level precondition and only invoke this after `decideRoute` returns lane `classify`.
- `CLASSIFIER_CATEGORY = "quick"` is exported so task-12 can bind the injected dispatch port to the cheap category explicitly.

## Task 14 — Config schema regen + docs + roadmap

### `worker_pr_variant` field — exact location
- Added to `SenderConfigSchema` in `packages/omo-opencode/src/features/cross-project-mailbox/config.ts`
  (right after `allowed_modes`, before the closing `})`). Definition:
  `worker_pr_variant: z.enum(["local", "cloudhome"]).optional().describe(...)`.
  Bare enum, NO `.transform()` — mirrors task-2's `allowed_modes` (memory #1570; JSON-schema enum
  metadata preserved). Runtime type is `"local" | "cloudhome" | undefined`, matching task-11's
  structural `WorkerPrVariantSenderConfig` — task-11's `selectWorkerPrVariant` now works against the
  real field with no further change.
- Tests: 3 given/when/then cases appended to `config.test.ts` (`#given a sender with worker_pr_variant`):
  valid `cloudhome`/`local` kept, omitted → undefined, invalid `remote` → throws. TDD RED (3 fail)
  → GREEN (16 pass). Broader config+permission suite: 234 pass / 0 fail.

### Single source of truth confirmed (no duplicate schema)
- `packages/omo-opencode/src/config/schema/oh-my-opencode-config.ts:93` references
  `CrossProjectMailboxConfigSchema` DIRECTLY (imported at :12 from
  `../../features/cross-project-mailbox/config`). There is NO parallel/duplicate mailbox schema in
  `config/schema/`. The feature's own `config.ts` IS the single source consumed by the global schema
  build. Only `config.ts` needed editing.

### Schema regen — additive-only proof
- `bun run build:schema` → diff before/after = `6748a6749,6771` (pure APPEND hunk). 0 removals, 23
  additions. Both `allowed_modes` and `worker_pr_variant` landed under `senders` additionalProperties.
- `requested_mode` is an ENVELOPE/tool-arg field (task-1/task-3), NOT a user-config field, so it does
  NOT appear as a config-schema property (schema only models user config). Expected, not a gap.

### Docs — path touched
- `docs/reference/cross-project-mailbox.md` (the existing page). Added: `allowed_modes` +
  `worker_pr_variant` to the config example, `requested_mode` to both tool schema blocks, a new
  "Requested Delivery Modes & Routing Lanes" section (6 modes + required tiers + 10 routing lanes +
  manual-drain surfacing note), and a "Roadmap" section (Phase 1 = sender requests / receiver decides;
  Phase 2 = orchestrator authority model / dedicated intake agent — from draft D1/D2).
- NO `docs/guide/` edit: the only guide mailbox mentions are Team Mode's internal team mailbox
  (`docs/guide/team-mode.md`), a different feature. NO `AGENTS.md` edit: TOOL CATALOG lists tool
  names + gating only, no per-tool arg detail for any tool (step-6 guard).

### Typecheck note
- `bun run typecheck` sole error is `router/classifier.ts` — task-13's untracked file (parallel work,
  not in HEAD, not task-14 scope). Task-14's four files introduce zero typecheck errors.

## 2026-08-02 - Task 12 & 13 Wiring Fix

- Created `createProductionClassifyNote` adapter in `packages/omo-opencode/src/features/cross-project-mailbox/router/production-classifier-adapter.ts` to bridge the `ClassifyResult` from `classifier.ts` and `RouteDecision` from `route-note-dispatcher.ts`.
- The adapter re-runs `decideRoute` with a shallow-cloned envelope carrying the classified `requested_mode` to ensure budget gating is respected.
- If the re-run decision returns `lane: "classify"`, it is normalized to `lane: "triage"` to prevent infinite recursion.
- Built a real `classify` port that launches a `"quick"`-category background task via `backgroundManager.launch` and polls for completion, extracting the final text result from the session messages.
- Wired the real classifier into `buildIdleDrainDeps` in `create-mailbox-hooks.ts` and `ManualMailboxToolDeps` in `tool-registry-mailbox-tools.ts`.
- Added unit tests in `create-mailbox-hooks.test.ts` and `production-classifier-adapter.test.ts` to verify the wiring and adapter behavior.

## 2026-08-02 - Task 15 Cipher relay E2E harness interface

- Harness path: `test-support/e2e/mailbox-cipher-relay/`. It is manual and opt-in only. No `*.test.ts` files were added, so default `bun test` does not discover or run the live relay harness.
- Self-test command: `bun test-support/e2e/mailbox-cipher-relay/cli.ts --self-test`. It generates 3 sandbox projects, writes per-project `.omo/cipher/words.json`, writes schema-valid seed envelopes with `serializeEnvelope`, simulates relay hops without LLMs, validates correct and wrong final drops, asserts `mode=external` presence records, and proves the real `~/.omo/project-registry.json` hash is unchanged.
- Live task-16 setup command: `bun test-support/e2e/mailbox-cipher-relay/cli.ts --generate --root /tmp/mailbox-cipher-relay-live`. The JSON output contains `contextPath` plus `driver-manifest.json`. Start each `opencode serve --hostname 127.0.0.1 --port <port>` from the listed project cwd with the listed env. Each env sets isolated `HOME`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, `OPENCODE_DB`, `OPENCODE_DISABLE_AUTOUPDATE=1`, and `OPENCODE_DISABLE_MODELS_FETCH=1`.
- Before seeding live agents, run `bun test-support/e2e/mailbox-cipher-relay/cli.ts --assert-external <contextPath>` and require success. This checks each sandbox's `.omo/presence/<projectId>.json` for `mode: "external"` and a non-empty `serverUrl`.
- Seed command for task-16: `bun test-support/e2e/mailbox-cipher-relay/cli.ts --seed <contextPath>`. This writes the arbiter's v1 envelope into project A's `coordination_notes/cipher-relay-arbiter/` inbox.
- Arbiter command for task-16: `MAILBOX_E2E_TIMEOUT_MIN=15 bun test-support/e2e/mailbox-cipher-relay/cli.ts --arbiter <contextPath>`. It polls `<sandbox>/arbiter/drop/final.json`, expects JSON `{ "sentence": string, "hops": [...] }`, compares exactly against the independently computed sentence, writes `<sandbox>/arbiter/report.json`, and exits 0 only on exact match.
- Default hop modes are parameterized as `todo-append` for A to B and `subagent` for B to C. The generator accepts `hopModes` programmatically for alternate mode matrices.
- The generated OpenCode config uses the free OpenRouter model `qwen/qwen3-coder:free` by default. Override with `MAILBOX_E2E_MODEL` or `generateRelaySandbox({ model })` if task-16 needs another known-free model.

## 2026-08-02 - Task 16 live-run preflight observations

- `opencode serve` plus `GET /agent?directory=<sandbox-project>` loads the plugin and returns agents, but it does not by itself write cross-project mailbox presence records. A real session turn is still needed to trigger the presence heartbeat's `onSessionActive` path.
- `opencode run --attach ... --dir <sandbox-project>` can create a live session and presence record even when the model request later fails. This is enough for `--assert-external`, but not enough for relay progress.
- The installed `opencode` v1.18.5 server returns `503 {"_tag":"ServiceUnavailableError","message":"Session wait is not available yet","service":"session.wait"}` for `/api/session/{sessionID}/wait`; task-16 driving should poll DB events, SSE, mailbox files, or arbiter output instead of relying on that wait route.
- If `OPENROUTER_API_KEY` is absent from the isolated server environment, the first real OpenRouter free-model turn fails before tool execution with HTTP 401 `No cookie auth credentials found`; this is a credentials blocker, not a mailbox route result.

## 2026-08-02 - Task 16 google antigravity harness retry

- The real opencode model config shape for antigravity is `model: "google/antigravity-gemini-3.5-flash"` with provider id `google`, model id `antigravity-gemini-3.5-flash`, npm package `@ai-sdk/google`, and `apiKey: "{env:GLOBAL_GEMINI_KEY}"`.
- The cipher relay generator now treats provider-prefixed `google/...` models as first-class google provider configs instead of wrapping them as `openrouter/google/...`. It still preserves OpenRouter fallback behavior for unprefixed or `openrouter/...` model strings.
- `GLOBAL_GEMINI_KEY` must be visible to the process running `bun test-support/e2e/mailbox-cipher-relay/cli.ts --generate`; the generator copies that value into each isolated project env. If it is missing there, live google calls fail with HTTP 403 before any mailbox tool can execute.

## 2026-08-03 - Task 16 OAuth-vs-sandbox resolution and Claude Sonnet 4.6 success

- **OAuth-vs-sandbox root cause:** The sandbox redirects `XDG_DATA_HOME` to isolate the databases and state. However, OpenCode's host OAuth credentials live at `~/.local/share/opencode/auth.json` (under the real `XDG_DATA_HOME`). Because of the redirection, the sandboxed instances saw no auth at all and failed with `ProviderAuthError: Anthropic API key is missing`.
- **Seeding fix:** Patched `generator.ts` to programmatically copy only the `anthropic` key from the host's `~/.local/share/opencode/auth.json` to each sandbox's `<xdg.dataHome>/opencode/auth.json` with mode `0o600` (parent dir `0o700`). This allows the sandboxed servers to read the host's OAuth credentials without exposing them to stdout or logs.
- **Plugin build requirement:** The `anthropic-auth` plugin must be built (`bun run build` in its package directory) so its build artifacts are available under `dist/index.js`.
- **Model selection:** Driven all 3 sandbox cipher-relay agent sessions with `anthropic/claude-sonnet-4-6` using the host's seeded OAuth credentials. The run completed successfully end-to-end, and the arbiter validated the final drop with `"passed": true`.

---

## F2 hard-violation fixes (barrel split + as any + empty catch)

- **`manual-drain/index.ts` barrel split.** Split the dumped-logic barrel into four concern files
  (`types.ts`, `peek.ts`, `drain.ts`, `tools.ts`); `delivery-pipeline.ts` was already a concern
  file and stayed put. Key gotcha: consumers (`hooks/idle-drain-processor.ts`,
  `hooks/idle-drain-hook.ts`, `hooks/route-note-dispatcher.ts`) import the pipeline ports directly
  from `../manual-drain/delivery-pipeline`, NOT via the barrel — so the pure barrel must NOT
  re-export them (adding them would be a divergence from today's public surface). `preview` had to
  become exported from `peek.ts` because `drain.ts`'s `drainedNote` reuses it.
- **`as any` in `idle-drain-hook.test.ts`.** Line ~499 busy-session stub: type it as
  `NonNullable<IdleDrainHookDeps["client"]["session"]>` and reassign `deps.client = { session }`
  instead of casting. Line ~516: the store returned by `deps.makeMailboxStore(...)` is built from
  the same DI'd jest.fn spies, so assert directly on `spies.unreserve` / `spies.markDispatched` —
  drops the cast AND the redundant re-invocation of `makeMailboxStore`, with identical assertions.
- **Empty catch in `contracts/remote-pending-store.ts:132`.** Replace `.catch(() => {})` with
  `.catch((cleanupError) => log("[remote-pending-store] failed to clean up temp file after write
  failure", { error, tmpPath }))`. Import `{ log }` from `../../../shared/logger` (single function,
  no `.warn`). Still rethrows the original write error — best-effort cleanup, now observable.
- **Verify:** `bun test packages/omo-opencode/src/features/cross-project-mailbox` = 713 pass / 0
  fail (52 files); `bun run typecheck` EXIT=0. `lsp_diagnostics` path-doubling bug reproduced again
  (`packages/omo-opencode/packages/omo-opencode/...`) — used `bun run typecheck` as authoritative.

## Task 17 — Mailbox trace observability layer

- New module `features/cross-project-mailbox/trace/`: `types.ts` (37 LOC), `trace-log.ts` (16), `emit-trace.ts` (66), `index.ts` (11). Barrel + concern files, DI-only, no `as any`.
- `emitMailboxTrace(event, deps)` is fire-and-forget: NEVER throws, NEVER surfaces a rejected promise. Dual sink = shared `log()` with literal prefix `[mailbox-trace]` + append-one-JSON-line to `<repoRoot>/.omo/mailbox-trace.jsonl` (modeled byte-for-byte on `send-tool/outbox-log.ts`: `mkdir(dirname,{recursive})` + `appendFile(JSON+"\n")`). Disk append is NOT awaited by caller (`void Promise.resolve(sink.append(...)).catch(...)`), so a slow disk cannot stall a drain.
- Sink + logger are DI ports (`MailboxTraceSink`, `MailboxTraceLogger` on `EmitMailboxTraceDeps`) so tests supply a throwing/rejecting sink WITHOUT `mock.module` (memory #2177). Default sink = `createFileTraceSink(repoRoot)`, default logger = shared `log`.
- Field names are camelCase audit-record style (`requestedMode`/`effectiveMode`/`downgradeReason`/`lane`) matching `mailbox/types.ts` `PendingEntry`, so a reader can join `.omo/mailbox-trace.jsonl` against `coordination_notes/.pending.json` by `messageId`. Optional keys omitted via explicit conditional spread (task-3 style), test-pinned (`"lane" in record === false`).
- Security: `sanitizeDetail(detail, repoRoot)` relativizes any repoRoot-anchored path then redacts any remaining absolute `/...` path token to `[redacted-abs-path]`, then truncates at `TRACE_DETAIL_PREVIEW_MAX = 100` (same constant value as outbox `BODY_PREVIEW_MAX`). Only `detail` is a free-form field; bodies are never traced.
- `traceIdentity(note)` (exported from trace barrel) is the SHARED note→{messageId,correlationId,fromProjectId} mapping. Extracting it removed the duplicated local `traceBase`/`laneTraceFields` mappings in both hosts AND pulled `idle-drain-processor.ts` (was 258) and `route-note-dispatcher.ts` (was 249) back under the 250 pure-LOC ceiling (now 247 / 246).
- Lane tracing pattern: `executeRoutedLane` now wraps an inner `runRoutedLane` — emits `lane-start` on entry, `lane-end` on the single return with `detail = status | status:reason`. This covers ALL return paths including the `missingDeps()` downgrade (traced as `lane-end` detail `fallback-triage:lane-deps-missing`) without instrumenting each `case`. `emitTrace` is an optional `RoutedLaneDeps` field so manual-drain (which does not pass it) is unaffected.
- Drain lifecycle emits in `processNote`: `received` + `validated` right after `reserveValidatedDelivery` returns reserved, `routed` after `resolveRouteDecision`. `acked` in `finalizeHandledLane` (handled path). `rolled-back` in `handleLaneException` (thrown lane) and in `dispatchLegacyTriage` dispatch-rejection rollback.
- Production wiring: `createMailboxTraceEmit({ repoRoot })` in `buildIdleDrainDeps` (`create-mailbox-hooks.ts`), passed as `emitTrace` in the returned deps → flows into both `IdleDrainProcessorDeps` and `RoutedLaneDeps` (same object).
- `.gitignore`: added `.omo/mailbox-trace.jsonl` immediately after `.omo/mailbox-outbox.jsonl` under the `# cross-project agent mailbox` comment (runtime artifact, per memory #1907 .omo is tracked EXCEPT explicit runtime artifacts).
- Results: trace 10 pass; full mailbox package 723 pass / 0 fail (baseline was 630+, task-3 era; current head baseline already ~713, +10 from this task); `bun run typecheck` exit 0; prompt-async-route-audit + mock-module-lifecycle-audit 11 pass. `lsp_diagnostics` still doubles the package path — used `bun run typecheck`.


## Task 17 — CORRECTION: write-failed was declared but never emitted (F-review DEFECT 2)

- `write-failed` was in `MAILBOX_TRACE_PHASES` but had ZERO production emit sites — dead vocabulary. Since the cipher-relay e2e is descoped, a note that fails to LAND on the receiver is the single most important thing a live `tail -f .omo/mailbox-trace.jsonl` observer must see, and it produced no line at all.
- Fix: wrapped the `deps.writeNote(...) / defaultWriteNote(...)` branch in BOTH `runProjectMessageSend` and `runProjectNoteSend` in try/catch. On throw: emit `phase: "write-failed"` (messageId, correlationId, fromProjectId, toProjectId, conditional requestedMode spread, detail = error.message) then **RETHROW** — observability only, control flow unchanged. The `sent` emit stays after the successful `appendOutboxLog`.
- DI for tests: added optional `traceSink?: MailboxTraceSink` to `ProjectMessageToolDeps` + `ProjectNoteToolDeps`; threaded via a `traceCtx(deps)` builder into `emitMailboxTrace`. No `mock.module` (memory #2177) — tests pass a `{ append: (r) => records.push(r) }` sink.
- Tests (one per tool): write throws → exactly ONE `write-failed` event with correct messageId+correlationId, original error propagates (`await expect(call).rejects.toBe(boom)`), and no `sent` event. Both use `.rejects.toBe` on the SAME error instance to prove no swallow.
- LOC discipline: the four repetitive emit blocks (blocked-no-envelope, blocked, sent, write-failed) were duplicated across both send tools. Extracted `send-tool/send-trace.ts` (`emitSendBlockedNoEnvelope` + `emitSendEnvelopeTrace`, 47 LOC) to collapse them. That still left `project-message-tool.ts` at 261 (>250 hard ceiling; baseline was 218), so I extracted the offline-launch concern (`defaultWriteNote` + `maybeLaunchOfflineTarget` + `OfflineLaunchDeps`) into `send-tool/offline-launch.ts` (41 LOC). Final: message-tool 231, note-tool 192, both under ceiling.
- Results: mailbox suite 725 pass / 0 fail (was 723; +2 write-failed tests); `bun run typecheck` exit 0; prompt-async-route-audit + mock-module-lifecycle-audit 11 pass. `grep '"write-failed"'` now shows production emit sites in BOTH send tools.

## 2026-08-03 - Trace records need a synchronous monotonic seq

Fire-and-forget observability sinks need a synchronous monotonic sequence field. Wall-clock `at` timestamps collapse at sub-millisecond speed (a full 7-phase message lifecycle completes inside one millisecond, so `at` cannot break ties), and fire-and-forget async appends land on disk out of order. `emitMailboxTrace` now stamps every record with `seq` from one shared module-level counter, assigned synchronously at emit time BEFORE the async append is scheduled — so `seq` reflects EMIT order, not append-completion order. Sorting by `seq` recovers the true per-message timeline even when every `at` is identical and on-disk order is scrambled. The fire-and-forget contract (returns void, never throws, never rejects) is preserved; `seq` is generated internally and is NOT part of the `MailboxTraceEvent` input type, so no call site changed.
