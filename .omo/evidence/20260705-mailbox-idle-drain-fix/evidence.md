# Mailbox Idle Drain Fix Verification

## 1. What was tested
- The integration of the mailbox idle-drain hook with the presence heartbeat hook via a new `onBeat` callback on `PresenceHeartbeatHook`.
- Added unit tests in `packages/omo-opencode/src/features/cross-project-mailbox/hooks/idle-drain-hook.test.ts` to assert:
  - When the session is active (e.g. status is `busy`, `retry`, or `running`), the idle-drain hook skips scanning the mailbox and returns early, avoiding I/O overhead and premature notes reservation.
  - When a note is reserved but the prompt dispatch via `dispatchInternalPrompt` is not accepted (e.g. because of status or active reservations), the note is immediately unreserved (`store.unreserve`), avoiding a 15-minute stale lockout.
- Ran typechecks and the complete mailbox test suite.

## 2. What was observed
- The typecheck and build pass cleanly:
  ```bash
  $ bun run typecheck
  $ bun run build
  ```
- The 414 tests in the `cross-project-mailbox` test suite passed successfully, including the two new assertions:
  ```
  (pass) createIdleDrainHook > #given an active session status > #then the handler early-outs before resolving primary or scanning mailbox [0.18ms]
  (pass) createIdleDrainHook > #given a note reserved but dispatchInternalPrompt is rejected > #then calls unreserve to release the note immediately [0.09ms]
  ```

## 3. Why it is enough
- The `PresenceHeartbeatHook` runs periodically every 10 seconds (`PRESENCE_INTERVAL_MS`) as long as there is an active session ID.
- By binding `mailboxIdleDrain` check to the heartbeat's `onBeat` callback, the plugin now performs a periodic check for incoming coordination notes.
- This ensures that if the session is already idle (where no transition event is emitted by OpenCode), the heartbeat's beat checks if the session is still idle, scans `coordination_notes/`, and executes the drain.
- It is safe because:
  - If the session is busy/active, the `isSessionActive` check is performed at the start of the beat and returns early before listing or reserving files.
  - If a race condition occurs and dispatch is rejected, the note is immediately unreserved rather than remaining locked in the reserved state until the 15-minute stale cutoff.
