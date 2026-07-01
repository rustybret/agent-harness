# T13 - Live opencode-qa e2e for cross-project mailbox drain

QA-only task. Drove the real compiled worktree plugin (`dist/index.js`, rebuilt
at 14:14) in an isolated XDG sandbox and captured concrete file/log/test
artifacts proving the cross-project mailbox drain works end to end after the T1
fix.

## WHAT WAS TESTED

1. **Real drain e2e (genuine filesystem artifacts).** A driver
   (`/tmp/omo-qa-e2e-driver.ts`) imports the REAL worktree modules
   (`buildSendEnvelope`, `MailboxStore`, `createIdleDrainHook`, `appendOutboxLog`,
   `readMailboxSidebarState`, `createProjectRegistry`) and runs a full sender to
   receiver flow inside the sandbox:
   - sender builds an envelope and writes a note into the receiver inbox
     (`coordination_notes/<senderProjectId>/<msgId>.md`) plus an outbox log line,
   - receiver runs `createIdleDrainHook(...)["session.idle"]` twice: drain 1
     dispatches the note body into the receiver session; drain 2 (with the
     dispatched message id now present in session history) acks it via
     `reclaimStale` into `processed/`.
   Surfaces: real mailbox store, real idle-drain hook, real sidebar ack
   derivation.

2. **Live opencode server + SSE.** Booted the receiver opencode server from the
   real `dist/index.js` plugin (wired via `receiver2/opencode.json`) in the
   isolated XDG sandbox, confirmed the plugin loaded (GET `/agent` returns the
   OmO "Sisyphus - ultraworker" primary, `native:false`), and captured the live
   SSE stream (GET `/event`) showing `server.connected` + `session.created`.

3. **Idle-drain hook + resolver + two-repo integration tests.** Ran the hook's
   own suites against the real modules.

4. **Over-ceiling rejection.** Drove the real `runSendPreflight` with a sender
   granted only ceiling `question` requesting intent `plan` -> blocked
   `over-budget`; plus the tool + validation test suites.

5. **Permission matrix.** Ran the full 113-test permission-combination matrix.

6. **TUI two-column mailbox panel.** Rendered the real production sidebar panel
   (`readMailboxSidebarState` -> `computeView` -> `buildMailboxNodes`) against a
   seeded hub with both inbound and outbound state, and captured a PNG showing
   the mailbox panel above Magic Context. Also booted the real TUI under tmux for
   a live smoke.

7. **Isolation.** Compared real-DB `SELECT count(*) FROM session` before/after
   and ran a directory-based leak query.

## WHAT WAS OBSERVED

- `inbox-before.txt`: receiver inbox holds the unread note; `processed/` absent.
- `inbox-after.txt`: after the two idle drains, `processed/<msgId>.md` appeared
  (418b) and the unread note is gone. `dispatched into receiver session: true`,
  `processed appeared: true`, `inbox consumed: true`.
- `outbox-ack.txt`: sidebar `resolveOutboundAck` reports `outboundRead: 1`,
  `outboundUnresolved: 0`, `outboundFailed: 0` once the note is in the receiver
  `processed/`. This IS the "read" transition (the JSONL log has no mutable read
  field; ack is derived from the receiver processed/ bucket).
- `sse-hook.txt`: live `server.connected` + `session.created` SSE events; plus
  `idle-drain-hook.test.ts` 3/3, `primary-resolver/resolver.test.ts` 3/3 (the T1
  fix), and `__tests__/two-repo-integration.test.ts` 12/12 all pass. The
  integration suite explicitly asserts "the idle drain dispatches the note body
  into the receiver session" and "a second idle cycle acks the dispatched note
  into processed/".
- `e2e-reject.txt`: live `runSendPreflight` returns
  `{"blocked":true,"reason":"over-budget"}` for plan @ question ceiling; control
  in-budget question is allowed. Tool + validation suites pass (over-budget is
  not downgraded).
- `matrix-pass.txt`: 113 pass, 0 fail across all 18 subjects x 3 ceilings for
  both the sender preflight and inbound validation gates, including legacy-intent
  canonicalization (quick->impl, review/work-loop->plan) and the matrix-guard
  self-check.
- `mailbox-panel-render.txt` + `tui-screenshot.png` (= `terminal.png`): the
  panel renders `in { unread 1, done 1 }` and `out { pending 1, read 1, fail 1 }`
  in the two-column label/count layout; slot order 150 (mailbox) < 200 (Magic
  Context) < 900 (OmO), so the mailbox sits above Magic Context. `look_at`
  visual verification confirmed the panel is above Magic Context with the
  in/out counts.
- `tui-live-capture.txt`: the real TUI booted (Sisyphus - Ultraworker, hub
  project, 4 MCP connected). The omo log confirms the mailbox sidebar code runs
  live (it iterates registered projects calling `readMailboxSidebarState`).
- `isolation-proof.txt`: real-DB session count 5027 -> 5030 (+3), but the
  directory leak query returns 0 sessions under the QA sandbox or any fake
  project. The +3 are this QA agent's own sessions under real repo paths
  (agent-harness / webgameECS / cloudhome), not the sandbox. Isolation holds.

## WHY IT IS ENOUGH

The drain path is exercised end to end against the real modules with genuine
on-disk artifacts (inbox note -> dispatch -> processed ack -> derived outbound
read), which is the exact behavior the T1 fix enables. The live opencode server
proves the compiled build + config stack load the plugin and its hooks in a real
harness, and the SSE capture proves the session lifecycle events the idle-drain
hook binds to actually reach the wire. The permission ceiling behavior (accept /
over-budget reject) is proven both by a live preflight call and by the exhaustive
113-case matrix. The TUI panel is rendered through the real production render
code and verified visually for the T8 slot placement and T9 two-column layout.
Isolation is proven by a directory-scoped leak query, which is stronger than the
raw count delta.

## WHAT WAS OMITTED (honest limitations)

- **No live model turn.** The headless sandbox has no configured API model, so a
  drain triggered by a real end-to-end session-idle edge inside a live opencode
  turn was not exercised. The `session.idle` -> drain wiring is instead proven by
  (a) the live SSE session lifecycle events and (b) the hook/integration suites
  driving the real `createIdleDrainHook`. The plan explicitly allows this
  substitution for the headless path.
- **Live TUI pane did not surface the OmO mailbox panel.** In the running TUI the
  sidebar was dominated by other globally installed sidebar plugins (AFT, Magic
  Context). The mailbox panel is therefore captured via the real production
  render code (same functions the TUI slot calls) and verified as a PNG, rather
  than screenshotted from the live pane. The omo log confirms the mailbox sidebar
  code executes live.
- **Outbox "read" is derived, not a stored field.** The outbox JSONL has no
  mutable status column; the sidebar derives read/pending/fail from the receiver
  processed/rejected buckets. `outbox-ack.txt` documents this and shows
  `outboundRead == 1`.
- Raw env dumps and any secret-bearing logs were not copied; the sandbox used no
  real provider credentials for the headless server.
