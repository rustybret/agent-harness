# Mailbox idle-drain: full-lifecycle fix + live proof (2026-07-02)

## Symptom (reported from the cloudhome session)

`[event] hook execution failed {"hook":"mailboxIdleDrain","eventType":"session.idle","sessionID":"ses_12661ff52ffe...","error":{}}`

Inbound notes from cloudhome sat unread in `coordination_notes/cloudhome-5aa53d2c/`; nothing
ever moved to `processed/` and outbox entries never advanced past "pending".

## Root causes found (three, stacked)

1. **Logger swallowed the error.** `JSON.stringify(new Error(...))` serializes to `{}`, so every
   hook failure was logged as `error:{}` — undiagnosable. Fixed the catch site in
   `packages/omo-opencode/src/plugin/event-hook-dispatcher.ts` to log `name: message` + a
   5-frame stack.
2. **Unbound SDK method call.** `loadSessionMessageIds` in
   `features/cross-project-mailbox/hooks/create-mailbox-hooks.ts` destructured
   `ctx.client.session.messages` off the SDK object and invoked it bare, losing `this`.
   The generated SDK client dereferences `this._client` internally →
   `TypeError: undefined is not an object (evaluating 'this._client')` on EVERY drain attempt.
   Fixed with `messagesApi.call(session, ...)`. Regression test added
   (`create-mailbox-hooks.test.ts`): binds a `messages` function whose `this` must be the
   session object.
3. **History-confirm could never see the mailbox messageId.** The drain dispatches through
   `dispatchInternalPrompt` which generates its own OpenCode message id; the mailbox
   `messageId` (a UUID) never appears in `session.messages()` ids, so pending entries stayed
   `dispatch_sent` forever and `reclaimStale` would eventually re-queue (double-inject risk).
   Fixed by embedding a marker line `[mailbox-message-id: <uuid>]` in the triage prompt
   (`triage/template.ts`) and teaching `loadSessionMessageIds` to also extract marker ids from
   message part text (recursive scan). Tests updated in both modules.

Note: the seeded legacy test note used a non-UUID `messageId` (`qa-drain-test-0001`), which the
envelope schema (`z.string().uuid()`) rejects at parse — `drainUnread` silently skips
unparseable notes. Real notes written by `project_message` always have UUID ids; only
hand-written notes hit this. Trace logging (`[mailbox-idle-drain] skipped/candidates/injected`)
was added to make silent-skip paths observable.

## What was tested (live, real harness — not unit tests)

Command surface: real `opencode` TUI launched under tmux (`drain-qa6`) in this repo, with the
local build (`dist/index.js`) registered via `file://` plugin entry in
`~/.config/opencode/opencode.json`.

1. Seeded a valid inbound note (UUID `0941a3e0-5879-466e-832f-e65a2c480987`) into
   `coordination_notes/cloudhome-5aa53d2c/` with intent=question from allowed sender
   `cloudhome-5aa53d2c`.
2. Prompted the session, let it go idle.

## What was observed

- Log: `[mailbox-idle-drain] candidates found {sessionId: ses_0de024cc0ffe..., sender: cloudhome-5aa53d2c, count: 1}`
- Log: `[mailbox-idle-drain] injected notes {injected: 1}`
- TUI (captured pane): the triage prompt rendered in the conversation, including the
  marker line `[mailbox-message-id: 0941a3e0-...]`, the note body, and intent guidance.
- The session answered inline: "Acknowledged — synthetic idle-drain QA note received, no action taken."
- Next idle: pending entry advanced `dispatch_sent` → `history_confirmed` (marker id found in
  session history via the new extraction) and the note file moved to
  `coordination_notes/cloudhome-5aa53d2c/processed/0941a3e0-....md`.
- `.pending.json` retains the `history_confirmed` entry (pruned by later reclaims); no
  re-injection occurred on subsequent idles.
- Full pane capture: `tui-capture.txt`. Log slice: `log-slice.txt`.

## Why this is enough

The full designed lifecycle — unread → reserve → validate → dispatch (gate) → TUI injection →
history-confirm (marker) → ack to processed/ — was exercised end-to-end against the real
harness with the real build, matching the plan's T13 contract. The unbound-method regression
is locked by a unit test that fails against the old call shape. Remaining risk: other repos
(cloudhome, atlas) run stale builds until their sessions restart on a rebuilt plugin.

## Omitted

Raw logs contain full merged model configs (provider lists); only relevant slices copied.
No secrets in evidence.
