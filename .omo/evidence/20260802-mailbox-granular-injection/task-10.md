# Task 10 evidence — mailbox interrupt lane + drain-now nudge

## What was tested

- Added failing TDD coverage first for:
  - receiver interrupt lane prepend-before-dispatch, inline `queueBehavior: "enqueue"`, accepted-dispatch ack, rejected-dispatch todo restore + unreserve;
  - sender-side drain-now trigger POST contract, newest live port-file selection, missing-port graceful degrade, network-error graceful degrade;
  - external-inject `mailbox_drain_now` RPC auth and injected drain invocation;
  - `runProjectMessageSend` interrupt-mode send result preserving send success with `interruptDrainNow` side-channel.
- Initial red run command:
  - `bun test packages/omo-opencode/src/features/cross-project-mailbox/lanes/interrupt.test.ts packages/omo-opencode/src/features/cross-project-mailbox/lanes/interrupt-sender-trigger.test.ts packages/omo-opencode/src/features/external-inject/transport.test.ts packages/omo-opencode/src/features/cross-project-mailbox/send-tool/project-message-tool.test.ts`

## What was observed

- Initial red result: expected failures for missing `./interrupt`, missing `./interrupt-sender-trigger`, missing `mailbox_drain_now`, and missing `interruptDrainNow` result field.
- Post-implementation focused result:
  - `bun test packages/omo-opencode/src/features/cross-project-mailbox/lanes/interrupt.test.ts packages/omo-opencode/src/features/cross-project-mailbox/lanes/interrupt-sender-trigger.test.ts packages/omo-opencode/src/features/external-inject/transport.test.ts packages/omo-opencode/src/features/external-inject/bridge.test.ts packages/omo-opencode/src/features/cross-project-mailbox/send-tool/project-message-tool.test.ts`
  - `68 pass, 0 fail, 174 expect() calls`.
- Required verification results:
  - `bun test packages/omo-opencode/src/features/cross-project-mailbox`: `689 pass, 0 fail, 6023 expect() calls`.
  - `bun test packages/omo-opencode/src/features/external-inject`: `52 pass, 0 fail, 92 expect() calls`.
  - `bun test packages/omo-opencode/src/shared/prompt-async-route-audit.test.ts`: `10 pass, 0 fail, 10 expect() calls`.
  - `bun run typecheck`: clean.
  - LSP diagnostics for changed source files: clean.
- OpenCode QA skill evidence:
  - `bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check`: passed dependency, DB-path, SQL escaping, free-port, isolated-XDG, and isolated-HOME checks.
  - `bash .agents/skills/opencode-qa/scripts/server-smoke.sh --self-test`: isolated opencode server returned `/global/health` healthy on version `1.18.5+f235ba6`, `/doc` listed 162 paths, and unauthenticated `/session` was rejected with HTTP 401.

## Why it is enough

- The receiver lane tests pin the unsafe ordering and rollback behavior: snapshot, prepend, dispatch, then ack only on accepted gate result; rejected gate restores exactly the pre-prepend snapshot and unreserves the reserved note.
- The RPC tests prove `mailbox_drain_now` is part of the same `/rpc/<method>` JSON POST transport and uses the same token gate before the injected drain port runs.
- The sender trigger tests prove interrupt sends can wake a live target bridge but never turn bridge absence or failure into a send failure.

## What was omitted

- No real `runMailboxDrainNow` integration was tested because task-12 owns wiring that function to router integration. This task only added the injected port and standalone sender nudge.
- No secrets, tokens, or host config were copied; tests used synthetic bridge tokens and temp directories.
